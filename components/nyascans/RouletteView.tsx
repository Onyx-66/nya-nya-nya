"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";
/* eslint-disable @next/next/no-html-link-for-pages */
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  CheckCircle,
  Clock,
  Coins,
  Gift,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type RouletteReward = {
  id: string;
  label: string;
  type: "SHARDS" | "ONYX" | "STORE_ITEM";
  amount: number;
  weight: number;
  itemId: string | null;
  imageKey: string | null;
  imageUrl?: string | null;
  enabled: boolean;
};

type RouletteTask = {
  id: string;
  label: string;
  description: string;
  metric: "CHAPTERS_READ" | "COMMENTS_POSTED" | "UPVOTES_RECEIVED";
  target: number;
  rewardSpins: number;
  progress: number;
  complete: boolean;
  claimed: boolean;
  claimedAt: string | null;
};

type SpinKey = "DAILY" | "TASK" | "PAID_SHARDS" | "PAID_ONYX";

type Spin = {
  id: string;
  rewardKey: string;
  rewardType: "SHARDS" | "ONYX" | "STORE_ITEM";
  rewardAmount: number;
  storeItemId: string | null;
  spinMode: "DAILY" | "TASK" | "PAID";
  costShards: number;
  costCurrency: "SHARDS" | "ONYX" | null;
  costAmount: number;
  label: string | null;
  nextEligibleAt: string;
  spunAt: string;
};

type RouletteState = {
  premiumEconomyPublic?: boolean;
  coin?: {
    name: string;
    plural: string;
    icon: string;
    iconUrl: string | null;
  } | null;
  settings?: {
    shardIcon: string;
    shardPlural: string;
    rouletteCooldownHours: number;
    roulettePaidSpinsEnabled: boolean;
    roulettePaidSpinShardCost: number;
    roulettePaidSpinOnyxCost: number;
    roulettePaidCurrencies: Array<"SHARDS" | "ONYX">;
    rouletteRewards: RouletteReward[];
    roulettePaidRewards: RouletteReward[];
  };
  eligible?: boolean;
  canSpin?: boolean;
  canDailySpin?: boolean;
  canTaskSpin?: boolean;
  canPaidSpin?: boolean;
  freeSpinBalance?: number;
  paidSpinCosts?: { SHARDS: number; ONYX: number };
  paidSpinCurrencies?: Array<"SHARDS" | "ONYX">;
  paidSpinCostShards?: number;
  unavailableReason?: string | null;
  availableRewards?: RouletteReward[];
  freeRewards?: RouletteReward[];
  paidRewards?: RouletteReward[];
  weekly?: { weekStart: string; tasks: RouletteTask[] };
  nextEligibleAt?: string;
  history?: Spin[];
  balances?: {
    onyx?: { balance?: number };
    shards?: { balance?: number };
  };
  spin?: Spin;
  state?: RouletteState;
  claimedTaskId?: string;
  error?: { message?: string };
};

function compactSpinTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return `${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} · ${date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function RouletteCoinMark({
  coin,
  size = 18,
}: {
  coin: RouletteState["coin"];
  size?: number;
}) {
  return (
    <span
      className="roulette-coin-mark"
      style={{ "--roulette-coin-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {coin?.iconUrl ? (
        <img src={coin.iconUrl} alt="" />
      ) : (
        coin?.icon ?? <Coins size={size} weight="fill" />
      )}
    </span>
  );
}

function clientId() {
  const values = crypto.getRandomValues(new Uint32Array(3));
  return `roulette:${Array.from(values).join("-")}`;
}

function remainingTime(value: string | undefined, now: number) {
  const remaining = Math.max(0, Date.parse(value ?? "") - now);
  if (!Number.isFinite(remaining) || remaining <= 0) return "Ready now";
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.ceil((remaining % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function RouletteView({
  signedIn,
  showToast,
}: {
  signedIn: boolean;
  showToast: (message: string) => void;
}) {
  const [data, setData] = useState<RouletteState | null>(null);
  const [loading, setLoading] = useState(signedIn);
  const [loadError, setLoadError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastSpin, setLastSpin] = useState<Spin | null>(null);
  const [track, setTrack] = useState<"FREE" | "PAID">("FREE");
  const [paidCurrency, setPaidCurrency] = useState<"SHARDS" | "ONYX">(
    "SHARDS",
  );
  const [claimingTask, setClaimingTask] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const animationTimer = useRef<number | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const mutationLock = useRef(false);
  const mounted = useRef(true);
  const spinKeys = useRef<Record<SpinKey, string | null>>({
    DAILY: null,
    TASK: null,
    PAID_SHARDS: null,
    PAID_ONYX: null,
  });

  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      mounted.current = false;
      mutationLock.current = false;
      mutationController.current?.abort();
      window.clearInterval(timer);
      if (animationTimer.current !== null) {
        window.clearTimeout(animationTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void fetch("/api/v1/roulette", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as RouletteState;
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Roulette could not be loaded.",
          );
        }
        setData(payload);
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const message =
            error instanceof Error
              ? error.message
              : "Roulette could not be loaded.";
          setLoadError(message);
          showToast(message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadRevision, showToast, signedIn]);

  const freeRewards = useMemo(
    () =>
      data?.freeRewards ??
      data?.availableRewards ??
      data?.settings?.rouletteRewards.filter((reward) => reward.enabled) ??
      [],
    [data?.availableRewards, data?.freeRewards, data?.settings?.rouletteRewards],
  );
  const paidRewards = useMemo(
    () =>
      data?.paidRewards ??
      data?.settings?.roulettePaidRewards?.filter((reward) => reward.enabled) ??
      [],
    [data?.paidRewards, data?.settings?.roulettePaidRewards],
  );
  const rewards = track === "FREE" ? freeRewards : paidRewards;
  const nextEligibleAt = Date.parse(
    data?.nextEligibleAt ?? "1970-01-01T00:00:00.000Z",
  );
  const cooldownReady =
    Boolean(data) &&
    Number.isFinite(nextEligibleAt) &&
    nextEligibleAt <= now;
  const canDailySpin =
    Boolean(data?.canDailySpin ?? data?.canSpin) &&
    cooldownReady &&
    freeRewards.length > 0;
  const canTaskSpin =
    Boolean(data?.canTaskSpin) &&
    Number(data?.freeSpinBalance ?? 0) > 0 &&
    freeRewards.length > 0;
  const paidCurrencies =
    data?.paidSpinCurrencies ?? data?.settings?.roulettePaidCurrencies ?? [];
  const selectedPaidCurrency = paidCurrencies.includes(paidCurrency)
    ? paidCurrency
    : paidCurrencies[0] ?? paidCurrency;
  const paidCost =
    data?.paidSpinCosts?.[selectedPaidCurrency] ??
    (selectedPaidCurrency === "SHARDS"
      ? data?.settings?.roulettePaidSpinShardCost ?? 0
      : data?.settings?.roulettePaidSpinOnyxCost ?? 0);
  const paidBalance =
    selectedPaidCurrency === "SHARDS"
      ? Number(data?.balances?.shards?.balance ?? 0)
      : Number(data?.balances?.onyx?.balance ?? 0);
  const canPaidSpin =
    data?.canPaidSpin !== false &&
    Boolean(data?.settings?.roulettePaidSpinsEnabled) &&
    paidRewards.length > 0 &&
    paidBalance >= paidCost;
  const mutationBusy = spinning || claimingTask !== null;
  const premiumEconomyPublic = data?.premiumEconomyPublic !== false;
  const coinPlural = data?.coin?.plural ?? "Premium coins";

  async function spin(mode: "DAILY" | "TASK" | "PAID") {
    if (
      mutationLock.current ||
      mutationBusy ||
      (mode === "DAILY"
        ? !canDailySpin
        : mode === "TASK"
          ? !canTaskSpin
          : !canPaidSpin)
    ) {
      return;
    }
    mutationLock.current = true;
    setSpinning(true);
    const controller = new AbortController();
    mutationController.current = controller;
    const spinKey: SpinKey =
      mode === "PAID" ? `PAID_${selectedPaidCurrency}` : mode;
    const idempotencyKey = spinKeys.current[spinKey] ?? clientId();
    spinKeys.current[spinKey] = idempotencyKey;
    try {
      const response = await fetch("/api/v1/roulette", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          idempotencyKey,
          mode,
          currency: mode === "PAID" ? selectedPaidCurrency : undefined,
        }),
      });
      const payload = (await response.json()) as RouletteState;
      if (!response.ok || !payload.spin || !payload.state) {
        throw new Error(
          payload.error?.message ?? "The Roulette spin could not be completed.",
        );
      }
      const selectedIndex = rewards.findIndex(
        (reward) => reward.id === payload.spin?.rewardKey,
      );
      const slice = rewards.length ? 360 / rewards.length : 360;
      const finish = () => {
        if (!mounted.current) return;
        spinKeys.current[spinKey] = null;
        setLastSpin(payload.spin ?? null);
        setData(payload.state ?? null);
        setSpinning(false);
        mutationLock.current = false;
        mutationController.current = null;
        animationTimer.current = null;
      };
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (selectedIndex < 0 || reduceMotion) {
        finish();
      } else {
        const target = 360 - (selectedIndex * slice + slice / 2);
        setRotation(
          (current) => current + 1_800 + target - (current % 360),
        );
        animationTimer.current = window.setTimeout(finish, 1_850);
      }
    } catch (error) {
      mutationLock.current = false;
      mutationController.current = null;
      if (!controller.signal.aborted && mounted.current) {
        setSpinning(false);
        showToast(
          error instanceof Error
            ? error.message
            : "The Roulette spin could not be completed.",
        );
      }
    }
  }

  async function claimTask(taskId: string) {
    if (mutationLock.current || mutationBusy) return;
    mutationLock.current = true;
    setClaimingTask(taskId);
    const controller = new AbortController();
    mutationController.current = controller;
    try {
      const response = await fetch("/api/v1/roulette", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          action: "CLAIM_TASK",
          taskId,
          idempotencyKey: clientId(),
        }),
      });
      const payload = (await response.json()) as RouletteState;
      if (!response.ok || !payload.state) {
        throw new Error(
          payload.error?.message ?? "The free spin could not be claimed.",
        );
      }
      if (mounted.current) {
        setData(payload.state);
        showToast("Free spin added to your balance.");
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        showToast(
          error instanceof Error
            ? error.message
            : "The free spin could not be claimed.",
        );
      }
    } finally {
      mutationLock.current = false;
      mutationController.current = null;
      if (mounted.current) setClaimingTask(null);
    }
  }

  if (!signedIn) {
    return (
      <main className="page-main page-wrap roulette-page">
        <section className="roulette-signin">
          <Sparkle size={38} weight="duotone" />
          <h1>Daily Roulette</h1>
          <p>Sign in to spin once every 24 hours and collect your reward.</p>
          <a className="button button-primary" href="/login?return_to=/roulette">
            Sign in to spin
          </a>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="page-main page-wrap roulette-page">
        <div className="dots-ring-loading settings-loading" role="status"><DotsRing size="lg" label={null} /><span>Loading Roulette…</span></div>
      </main>
    );
  }

  if (loadError || !data) {
    return (
      <main className="page-main page-wrap roulette-page">
        <section className="roulette-signin" role="alert">
          <WarningCircle size={38} weight="duotone" />
          <h1>Roulette unavailable</h1>
          <p>{loadError || "Roulette could not be loaded."}</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              setLoading(true);
              setLoadError("");
              setLoadRevision((value) => value + 1);
            }}
          >
            <ArrowClockwise size={18} />
            Try again
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-main page-wrap roulette-page">
      <header className="roulette-page-header">
        <div>
          <p className="eyebrow">NyaScans reward arcade</p>
          <h1>Roulette</h1>
          <p>
            {premiumEconomyPublic
              ? "Earn free chances every week or choose a paid draw with a separate premium reward pool."
              : "Earn free chances every week or spend collected Shards on a separate reward draw."}
          </p>
        </div>
        <div className="roulette-balances" aria-label="Wallet balances">
          {premiumEconomyPublic ? (
            <span>
              <RouletteCoinMark coin={data.coin} />
              <strong>{Number(data.balances?.onyx?.balance ?? 0).toLocaleString("en-US")}</strong>
              {coinPlural}
            </span>
          ) : null}
          <span>
            <Sparkle size={18} weight="fill" />
            <strong>{Number(data.balances?.shards?.balance ?? 0).toLocaleString("en-US")}</strong>
            {data.settings?.shardPlural ?? "Shards"}
          </span>
        </div>
      </header>

      <div className="roulette-mode-tabs" role="group" aria-label="Roulette mode">
        <button
          type="button"
          aria-pressed={track === "FREE"}
          className={track === "FREE" ? "active" : ""}
          disabled={mutationBusy}
          onClick={() => setTrack("FREE")}
        >
          <Gift size={19} weight="duotone" />
          <span><strong>Free Spins</strong><small>Daily reward + weekly tasks</small></span>
          <b>{Number(data.freeSpinBalance ?? 0)} banked</b>
        </button>
        <button
          type="button"
          aria-pressed={track === "PAID"}
          className={track === "PAID" ? "active" : ""}
          disabled={mutationBusy}
          onClick={() => setTrack("PAID")}
        >
          {premiumEconomyPublic ? (
            <RouletteCoinMark coin={data.coin} size={19} />
          ) : (
            <Sparkle size={19} weight="duotone" />
          )}
          <span>
            <strong>{premiumEconomyPublic ? "Pay to Spin" : "Shard Spins"}</strong>
            <small>{premiumEconomyPublic ? "Premium reward pool" : "Earned Shard draw"}</small>
          </span>
          <b>{premiumEconomyPublic ? `${coinPlural} or Shards` : "Shards"}</b>
        </button>
      </div>

      <section className="roulette-hero" aria-busy={mutationBusy}>
        <div className="roulette-copy">
          <p className="eyebrow">
            {track === "FREE"
              ? "Free reward track"
              : premiumEconomyPublic
                ? "Premium reward track"
                : "Shard reward track"}
          </p>
          <h2>
            {track === "FREE"
              ? "Play for free"
              : premiumEconomyPublic
                ? "Choose how to pay"
                : "Spend earned Shards"}
          </h2>
          <p>
            {track === "FREE"
              ? "Use your daily draw, then finish weekly community tasks to bank more free spins."
              : premiumEconomyPublic
                ? "Paid spins use a distinct administrator-curated reward pool. Pick the wallet that works for you."
                : "Shard spins use a distinct administrator-curated reward pool funded only with Shards earned on the site."}{" "}
            The server chooses the reward before the wheel animates.
          </p>

          {track === "PAID" ? (
            <div className="roulette-currency-picker" role="group" aria-label="Payment currency">
              {paidCurrencies.map((currency) => (
                <button
                  type="button"
                  aria-pressed={selectedPaidCurrency === currency}
                  className={selectedPaidCurrency === currency ? "active" : ""}
                  disabled={mutationBusy}
                  key={currency}
                  onClick={() => setPaidCurrency(currency)}
                >
                  {currency === "SHARDS" ? (
                    <Sparkle size={18} />
                  ) : (
                    <RouletteCoinMark coin={data.coin} />
                  )}
                  <span>
                    <strong>{Number(data.paidSpinCosts?.[currency] ?? (currency === "SHARDS" ? data.settings?.roulettePaidSpinShardCost : data.settings?.roulettePaidSpinOnyxCost) ?? 0).toLocaleString("en-US")}</strong>
                    <small>{currency === "SHARDS" ? data.settings?.shardPlural ?? "Shards" : coinPlural}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <section className="roulette-reward-list" aria-labelledby="roulette-rewards-title">
            <header>
              <strong id="roulette-rewards-title">
                {track === "FREE"
                  ? "Free-spin rewards"
                  : premiumEconomyPublic
                    ? "Paid-spin rewards"
                    : "Shard-spin rewards"}
              </strong>
              <span>{rewards.length}</span>
            </header>
            {rewards.length ? (
              <ul>
                {rewards.map((reward, index) => (
                  <li key={reward.id}>
                    <span className="roulette-reward-icon">
                      {reward.imageUrl ? (
                        <img src={reward.imageUrl} alt="" />
                      ) : reward.type === "STORE_ITEM" ? (
                        <Gift size={18} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="roulette-reward-copy">
                      <strong>{reward.label}</strong>
                      <small>
                        {reward.type === "STORE_ITEM"
                          ? "Cosmetic"
                          : `${reward.amount.toLocaleString("en-US")} ${
                              reward.type === "ONYX"
                                ? coinPlural
                                : data.settings?.shardPlural ?? "Shards"
                            }`}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No unowned rewards are available right now.</p>
            )}
          </section>
          <div className="roulette-spin-actions">
            {track === "FREE" ? (
              <>
                <button
                  className="button button-primary roulette-spin-button"
                  type="button"
                  disabled={!canDailySpin || mutationBusy}
                  onClick={() => void spin("DAILY")}
                >
                  {spinning ? <DotsRing size="sm" label={null} /> : <ArrowClockwise size={19} />}
                  {spinning
                    ? "Spinning…"
                    : canDailySpin
                      ? "Use daily spin"
                      : `Daily spin in ${remainingTime(data.nextEligibleAt, now)}`}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={!canTaskSpin || mutationBusy}
                  onClick={() => void spin("TASK")}
                >
                  <Gift size={18} />
                  Use banked spin · {Number(data.freeSpinBalance ?? 0)}
                </button>
              </>
            ) : data.settings?.roulettePaidSpinsEnabled ? (
              <button
                className="button button-primary roulette-paid-spin-button"
                type="button"
                disabled={!canPaidSpin || mutationBusy}
                onClick={() => void spin("PAID")}
              >
                <Sparkle size={18} weight="fill" />
                {spinning ? "Spinning…" : `Spin for ${paidCost.toLocaleString("en-US")} ${
                  selectedPaidCurrency === "SHARDS"
                    ? data.settings.shardPlural
                    : coinPlural
                }`}
              </button>
            ) : null}
          </div>
          {track === "FREE" && !canDailySpin ? (
            <small className="roulette-cooldown">
              <Clock size={15} />
              {data.unavailableReason ??
                `Available ${new Date(data.nextEligibleAt ?? "").toLocaleString()}`}
            </small>
          ) : null}
        </div>

        <div className="roulette-stage-card">
          <header>
            <span>
              {track === "FREE"
                ? "Free draw"
                : premiumEconomyPublic
                  ? "Premium draw"
                  : "Shard draw"}
            </span>
            <strong>
              {track === "FREE"
                ? canDailySpin || canTaskSpin
                  ? "Ready"
                  : remainingTime(data.nextEligibleAt, now)
                : canPaidSpin
                  ? "Ready"
                  : "Wallet balance required"}
            </strong>
          </header>
          <div className="roulette-stage">
            <span className="roulette-pointer" aria-hidden="true" />
            <div
              className="roulette-wheel"
              role="img"
              style={
                {
                  "--roulette-count": Math.max(rewards.length, 1),
                  "--roulette-slice": `${360 / Math.max(rewards.length, 1)}deg`,
                  "--roulette-rotation": `${rotation}deg`,
                } as CSSProperties
              }
              aria-label={`Roulette wheel with ${rewards.length} available rewards`}
            >
              {rewards.map((reward, index) => (
                <span
                  className="roulette-segment-label"
                  key={reward.id}
                  title={reward.label}
                  aria-hidden="true"
                  style={
                    {
                      "--segment-index": index,
                    } as CSSProperties
                  }
                >
                  {reward.imageUrl ? (
                    <img src={reward.imageUrl} alt="" />
                  ) : reward.type === "STORE_ITEM" ? (
                    <Gift size={17} />
                  ) : (
                    <>
                      <strong>{reward.amount.toLocaleString("en-US")}</strong>
                      <small>
                        {reward.type === "ONYX"
                          ? <RouletteCoinMark coin={data.coin} size={14} />
                          : data.settings?.shardIcon ?? "✦"}
                      </small>
                    </>
                  )}
                </span>
              ))}
              <span className="roulette-hub" aria-hidden="true">
                <Sparkle size={30} weight="fill" />
              </span>
            </div>
          </div>
          <p>{spinning ? "Recording your verified result…" : "The pointer marks the winning segment."}</p>
        </div>
      </section>

      {track === "FREE" ? (
        <section className="roulette-tasks" aria-labelledby="weekly-spin-tasks">
          <header>
            <div>
              <p className="eyebrow">Refreshes every Monday</p>
              <h2 id="weekly-spin-tasks">Finish tasks, earn free spins</h2>
            </div>
            <span>Week of {data.weekly?.weekStart ? new Date(`${data.weekly.weekStart}T00:00:00Z`).toLocaleDateString() : "this week"}</span>
          </header>
          <div>
            {data.weekly?.tasks?.length ? data.weekly.tasks.map((task) => {
              const percent = Math.min(100, Math.round((task.progress / task.target) * 100));
              const taskStatus = task.claimed
                ? "Claimed"
                : task.complete
                  ? "Ready to claim"
                  : "In progress";
              return (
                <article
                  key={task.id}
                  className={
                    task.claimed
                      ? "is-claimed"
                      : task.complete
                        ? "is-ready"
                        : "is-progress"
                  }
                >
                  <header className="roulette-task-title-row">
                    <span className={task.claimed ? "complete" : ""}>
                      {task.claimed ? <CheckCircle size={22} weight="fill" /> : <Sparkle size={22} />}
                    </span>
                    <strong>{task.label}</strong>
                    <em>{taskStatus}</em>
                  </header>
                  <div className="roulette-task-body">
                    <p>{task.description}</p>
                    <div className="roulette-task-progress-meta">
                      <span>
                        {Math.min(task.progress, task.target)}/{task.target}
                      </span>
                      <strong>{percent}%</strong>
                    </div>
                    <div
                      className="roulette-task-progress"
                      role="progressbar"
                      aria-label={`${task.label} progress`}
                      aria-valuemin={0}
                      aria-valuemax={task.target}
                      aria-valuenow={Math.min(task.progress, task.target)}
                    >
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <small>
                      Reward: {task.rewardSpins} free spin
                      {task.rewardSpins === 1 ? "" : "s"}
                    </small>
                  </div>
                  <button
                    type="button"
                    className={
                      task.complete && !task.claimed
                        ? undefined
                        : "roulette-task-status"
                    }
                    aria-label={`${task.label}: ${taskStatus}`}
                    disabled={
                      task.claimed || !task.complete || mutationBusy
                    }
                    onClick={() => void claimTask(task.id)}
                  >
                    {claimingTask === task.id
                      ? "Claiming…"
                      : task.complete && !task.claimed
                        ? "Claim free spin"
                        : taskStatus}
                  </button>
                </article>
              );
            }) : (
              <div className="roulette-tasks-empty">
                <Sparkle size={24} weight="duotone" />
                <strong>No weekly tasks are active</strong>
                <span>New ways to earn free spins will appear here.</span>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {lastSpin ? (
        <section className="roulette-result" role="status">
          <CheckCircle size={24} weight="fill" />
          <div>
            <strong>{lastSpin.label ?? "Reward unlocked"}</strong>
            <span>Added to your account successfully.</span>
          </div>
        </section>
      ) : null}

      <section className="roulette-history">
        <header>
          <h2>Recent spins</h2>
          <p>Your last twelve server-verified rewards.</p>
        </header>
        {data.history?.length ? (
          <div>
            {data.history.map((spinItem) => (
              <article key={spinItem.id}>
                <span className="roulette-history-icon">
                  {spinItem.rewardType === "STORE_ITEM" ? (
                    <Gift size={18} />
                  ) : (
                    <Sparkle size={18} />
                  )}
                </span>
                <span className="roulette-history-copy">
                  <strong>{spinItem.label ?? spinItem.rewardKey}</strong>
                  <small>
                    {spinItem.spinMode === "PAID"
                      ? `${spinItem.costAmount || spinItem.costShards} ${
                          spinItem.costCurrency === "ONYX" ? coinPlural : "Shards"
                        }`
                      : spinItem.spinMode === "TASK"
                        ? "Weekly-task spin"
                        : "Daily free spin"}
                  </small>
                </span>
                <time dateTime={spinItem.spunAt}>
                  {compactSpinTime(spinItem.spunAt)}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <p className="roulette-empty">Your first reward will appear here.</p>
        )}
      </section>
    </main>
  );
}
