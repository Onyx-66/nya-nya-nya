"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import {
  ArrowClockwise,
  CheckCircle,
  Clock,
  Coins,
  Gift,
  Sparkle,
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
  enabled: boolean;
};

type Spin = {
  id: string;
  rewardKey: string;
  rewardType: "SHARDS" | "ONYX" | "STORE_ITEM";
  rewardAmount: number;
  storeItemId: string | null;
  label: string | null;
  nextEligibleAt: string;
  spunAt: string;
};

type RouletteState = {
  settings?: {
    shardIcon: string;
    shardPlural: string;
    rouletteCooldownHours: number;
    rouletteRewards: RouletteReward[];
  };
  eligible?: boolean;
  nextEligibleAt?: string;
  history?: Spin[];
  balances?: {
    onyx?: { balance?: number };
    shards?: { balance?: number };
  };
  spin?: Spin;
  state?: RouletteState;
  error?: { message?: string };
};

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
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastSpin, setLastSpin] = useState<Spin | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const animationTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
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
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          showToast(
            error instanceof Error
              ? error.message
              : "Roulette could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [showToast, signedIn]);

  const rewards = useMemo(
    () => data?.settings?.rouletteRewards.filter((reward) => reward.enabled) ?? [],
    [data?.settings?.rouletteRewards],
  );
  const nextEligibleAt = Date.parse(
    data?.nextEligibleAt ?? "1970-01-01T00:00:00.000Z",
  );
  const eligible =
    Boolean(data) &&
    Number.isFinite(nextEligibleAt) &&
    nextEligibleAt <= now;

  async function spin() {
    if (!eligible || spinning) return;
    setSpinning(true);
    try {
      const response = await fetch("/api/v1/roulette", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: clientId() }),
      });
      const payload = (await response.json()) as RouletteState;
      if (!response.ok || !payload.spin || !payload.state) {
        throw new Error(
          payload.error?.message ?? "The Roulette spin could not be completed.",
        );
      }
      const selectedIndex = Math.max(
        0,
        rewards.findIndex((reward) => reward.id === payload.spin?.rewardKey),
      );
      const slice = rewards.length ? 360 / rewards.length : 360;
      const target = 360 - (selectedIndex * slice + slice / 2);
      setRotation((current) => current + 1_800 + target - (current % 360));
      animationTimer.current = window.setTimeout(() => {
        setLastSpin(payload.spin ?? null);
        setData(payload.state ?? null);
        setSpinning(false);
        showToast(`Roulette reward: ${payload.spin?.label ?? "Prize"}.`);
        animationTimer.current = null;
      }, 1_850);
    } catch (error) {
      setSpinning(false);
      showToast(
        error instanceof Error
          ? error.message
          : "The Roulette spin could not be completed.",
      );
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

  if (loading || !data) {
    return (
      <main className="page-main page-wrap roulette-page">
        <div className="settings-loading" role="status">Loading Roulette…</div>
      </main>
    );
  }

  return (
    <main className="page-main page-wrap roulette-page">
      <section className="roulette-hero">
        <div className="roulette-copy">
          <p className="eyebrow">One server-verified spin every 24 hours</p>
          <h1>Your daily plot twist.</h1>
          <p>
            Win {data.settings?.shardPlural ?? "Shards"}, Onyx Coins, or a
            published Store cosmetic. The server chooses the reward before the
            wheel animates.
          </p>
          <div className="roulette-balances">
            <span>
              <Coins size={18} weight="fill" />
              <strong>{Number(data.balances?.onyx?.balance ?? 0).toLocaleString("en-US")}</strong>
              Onyx
            </span>
            <span>
              <Sparkle size={18} weight="fill" />
              <strong>{Number(data.balances?.shards?.balance ?? 0).toLocaleString("en-US")}</strong>
              {data.settings?.shardPlural ?? "Shards"}
            </span>
          </div>
          <button
            className="button button-primary roulette-spin-button"
            type="button"
            disabled={!eligible || spinning || rewards.length === 0}
            onClick={() => void spin()}
          >
            <ArrowClockwise size={19} className={spinning ? "is-spinning" : ""} />
            {spinning
              ? "Spinning…"
              : eligible
                ? "Spin the Roulette"
                : `Next spin in ${remainingTime(data.nextEligibleAt, now)}`}
          </button>
          {!eligible ? (
            <small className="roulette-cooldown">
              <Clock size={15} /> Available{" "}
              {new Date(data.nextEligibleAt ?? "").toLocaleString()}
            </small>
          ) : null}
        </div>

        <div className="roulette-stage">
          <span className="roulette-pointer" aria-hidden="true" />
          <div
            className="roulette-wheel"
            style={
              {
                "--roulette-count": Math.max(rewards.length, 1),
                "--roulette-rotation": `${rotation}deg`,
              } as CSSProperties
            }
            aria-label="Roulette reward wheel"
          >
            {rewards.map((reward, index) => (
              <span
                className="roulette-segment-label"
                key={reward.id}
                style={
                  {
                    "--segment-index": index,
                  } as CSSProperties
                }
              >
                {reward.type === "STORE_ITEM" ? <Gift size={16} /> : null}
                {reward.label}
              </span>
            ))}
            <span className="roulette-hub"><Sparkle size={30} weight="fill" /></span>
          </div>
        </div>
      </section>

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
                <span>
                  {spinItem.rewardType === "STORE_ITEM" ? (
                    <Gift size={18} />
                  ) : (
                    <Sparkle size={18} />
                  )}
                </span>
                <strong>{spinItem.label ?? spinItem.rewardKey}</strong>
                <time>{new Date(spinItem.spunAt).toLocaleString()}</time>
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
