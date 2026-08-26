"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
/* eslint-disable @next/next/no-html-link-for-pages */

import {
  ArrowRight,
  CheckCircle,
  Copy,
  Gift,
  Heart,
  PaperPlaneTilt,
  UsersThree,
} from "@/components/nyascans/heroicons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";

type GiftCard = {
  id: string;
  code: string;
  amount: number;
  currency: "ONYX";
  recipientLabel: string;
  message: string;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED";
  valid: boolean;
  createdAt: string;
};

type SupportTeam = {
  id: string;
  slug: string;
  name: string;
  description: string;
  series: Array<{
    id: string;
    slug: string;
    title: string;
  }>;
};

type FollowedReader = {
  id: string;
  displayName: string;
  username: string | null;
};

type GiftStorePayload = {
  cards?: GiftCard[];
  teams?: SupportTeam[];
  followedReaders?: FollowedReader[];
  balances?: {
    onyx?: { balance?: number };
    shards?: { balance?: number };
  };
  card?: GiftCard;
  error?: { message?: string };
};

function requestKey(prefix: string) {
  const values = crypto.getRandomValues(new Uint32Array(3));
  return `${prefix}:${Array.from(values).join("-")}`;
}

export function GiftStorePanel({
  signedIn,
  showToast,
  onBalances,
}: {
  signedIn: boolean;
  showToast: (message: string) => void;
  onBalances: (onyx: number, shards: number) => void;
}) {
  const { settings: commercial } = useCommercialSettings();
  const coinName = commercial.economy.coinName;
  const coinPlural = commercial.economy.coinPlural;
  const [teams, setTeams] = useState<SupportTeam[]>([]);
  const [followedReaders, setFollowedReaders] = useState<FollowedReader[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [giftAmount, setGiftAmount] = useState(250);
  const [recipientMode, setRecipientMode] = useState<"FOLLOWED" | "EMAIL">(
    "FOLLOWED",
  );
  const [recipientUserId, setRecipientUserId] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [createdCard, setCreatedCard] = useState<GiftCard | null>(null);
  const [teamId, setTeamId] = useState("");
  const [supportSeriesIds, setSupportSeriesIds] = useState<string[]>([]);
  const [supportAmount, setSupportAmount] = useState(250);
  const [supportMessage, setSupportMessage] = useState("");
  const [busy, setBusy] = useState<"gift" | "team" | null>(null);
  const giftIdempotencyKey = useRef(requestKey("gift"));
  const teamIdempotencyKey = useRef(requestKey("team-support"));

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void fetch("/api/v1/gifts", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as GiftStorePayload;
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Gifts could not be loaded.",
          );
        }
        setTeams(payload.teams ?? []);
        setTeamId((current) => current || payload.teams?.[0]?.id || "");
        const nextReaders = payload.followedReaders ?? [];
        setFollowedReaders(nextReaders);
        setRecipientUserId(
          (current) => current || nextReaders[0]?.id || "",
        );
        if (!nextReaders.length) setRecipientMode("EMAIL");
        onBalances(
          Number(payload.balances?.onyx?.balance ?? 0),
          Number(payload.balances?.shards?.balance ?? 0),
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          showToast(
            error instanceof Error ? error.message : "Gifts could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onBalances, showToast, signedIn]);

  const chosenTeam = useMemo(
    () => teams.find((team) => team.id === teamId) ?? null,
    [teamId, teams],
  );

  function touchGiftDraft() {
    giftIdempotencyKey.current = requestKey("gift");
    setCreatedCard(null);
  }

  function touchTeamDraft() {
    teamIdempotencyKey.current = requestKey("team-support");
  }

  async function submit(body: Record<string, unknown>) {
    const response = await fetch("/api/v1/gifts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as GiftStorePayload;
    if (!response.ok) {
      throw new Error(
        payload.error?.message ?? "This Gift purchase could not be completed.",
      );
    }
    onBalances(
      Number(payload.balances?.onyx?.balance ?? 0),
      Number(payload.balances?.shards?.balance ?? 0),
    );
    return payload;
  }

  async function createGift() {
    setCreatedCard(null);
    setBusy("gift");
    try {
      const payload = await submit({
        action: "CREATE_GIFT",
        amount: giftAmount,
        recipientMode,
        recipientUserId:
          recipientMode === "FOLLOWED" ? recipientUserId : "",
        recipientEmail:
          recipientMode === "EMAIL" ? recipientEmail.trim() : "",
        message: giftMessage,
        idempotencyKey: giftIdempotencyKey.current,
      });
      if (payload.card) {
        setCreatedCard(payload.card);
        showToast("Gift Card created. The code is ready to share.");
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "The Gift Card was not created.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function supportTeam() {
    if (!chosenTeam) return;
    setBusy("team");
    try {
      await submit({
        action: "SUPPORT_TEAM",
        teamId: chosenTeam.id,
        seriesIds: supportSeriesIds,
        amount: supportAmount,
        message: supportMessage,
        idempotencyKey: teamIdempotencyKey.current,
      });
      showToast(
        `${supportAmount.toLocaleString("en-US")} ${coinPlural} sent to ${chosenTeam.name}${
          supportSeriesIds.length
            ? ` for ${supportSeriesIds.length} selected series`
            : ""
        }.`,
      );
      setSupportMessage("");
      setSupportSeriesIds([]);
      touchTeamDraft();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "The Translation Team could not be supported.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!signedIn) {
    return (
      <section className="gift-store page-wrap">
        <div className="gift-store-signin">
          <Gift size={34} weight="duotone" />
          <div>
            <h2>Send a Gift or support a Translation Team.</h2>
            <p>Sign in to use your verified {coinName} balance securely.</p>
          </div>
          <a className="button button-primary" href="/login?return_to=/store/gifts">
            Sign in <ArrowRight size={17} />
          </a>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="gift-store page-wrap" aria-live="polite">
        <div className="dots-ring-loading settings-loading" role="status"><DotsRing size="lg" label={null} /><span>Loading Gifts…</span></div>
      </section>
    );
  }

  return (
    <section className="gift-store page-wrap" aria-labelledby="gifts-title">
      <header className="gift-store-heading">
        <p className="eyebrow">Balance-funded gifts</p>
        <h2 id="gifts-title">Give someone their next chapter.</h2>
        <p>
          Gift Cards and team support use {coinPlural} from your current wallet. Every
          Gift Code is private and can be redeemed once.
        </p>
      </header>
      <div className="gift-store-grid">
        <article className="gift-purchase-card">
          <span className="gift-card-icon"><Gift size={28} weight="duotone" /></span>
          <div>
            <p className="eyebrow">Gift to user</p>
            <h3>Create a custom Gift Card</h3>
            <p>Choose the amount and add a note before sharing the 18-character code.</p>
          </div>
          <label>
            <span>{coinName} amount</span>
            <input
              type="number"
              min={1}
              max={1_000_000}
              disabled={busy !== null}
              value={giftAmount}
              onChange={(event) => {
                touchGiftDraft();
                setGiftAmount(Number(event.target.value));
              }}
            />
          </label>
          <fieldset
            className="gift-recipient-fieldset"
            disabled={busy !== null}
          >
            <legend>Recipient</legend>
            <div className="gift-recipient-tabs" role="group" aria-label="Choose recipient method">
              <button
                type="button"
                aria-pressed={recipientMode === "FOLLOWED"}
                disabled={!followedReaders.length}
                onClick={() => {
                  touchGiftDraft();
                  setRecipientMode("FOLLOWED");
                }}
              >
                <UsersThree size={16} />
                People you follow
              </button>
              <button
                type="button"
                aria-pressed={recipientMode === "EMAIL"}
                onClick={() => {
                  touchGiftDraft();
                  setRecipientMode("EMAIL");
                }}
              >
                <PaperPlaneTilt size={16} />
                Email address
              </button>
            </div>
            {recipientMode === "FOLLOWED" ? (
              <label>
                <span>Followed reader</span>
                <UnifiedSingleSelect
                  value={recipientUserId}
                  onChange={(event) => {
                    touchGiftDraft();
                    setRecipientUserId(event.target.value);
                  }}
                >
                  {followedReaders.map((reader) => (
                    <option value={reader.id} key={reader.id}>
                      {reader.displayName}
                      {reader.username ? ` (@${reader.username})` : ""}
                    </option>
                  ))}
                </UnifiedSingleSelect>
              </label>
            ) : (
              <label>
                <span>Reader email</span>
                <input
                  type="email"
                  value={recipientEmail}
                  maxLength={254}
                  autoComplete="email"
                  placeholder="reader@example.com"
                  onChange={(event) => {
                    touchGiftDraft();
                    setRecipientEmail(event.target.value);
                  }}
                />
              </label>
            )}
            <small>
              Email recipients must have an active NyaScans account. The code
              can be redeemed once, only by the selected reader.
            </small>
          </fieldset>
          <label>
            <span>Message (optional)</span>
            <textarea
              value={giftMessage}
              maxLength={320}
              rows={3}
              disabled={busy !== null}
              placeholder="Enjoy your next story."
              onChange={(event) => {
                touchGiftDraft();
                setGiftMessage(event.target.value);
              }}
            />
          </label>
          <button
            className="button button-primary"
            type="button"
            disabled={
              busy !== null ||
              giftAmount < 1 ||
              (recipientMode === "FOLLOWED" && !recipientUserId) ||
              (recipientMode === "EMAIL" && !recipientEmail.trim())
            }
            onClick={() => void createGift()}
          >
            <PaperPlaneTilt size={18} />
            {busy === "gift" ? "Creating…" : "Create Gift Code"}
          </button>
          {createdCard ? (
            <div className="gift-code-result" role="status">
              <CheckCircle size={20} weight="fill" />
              <div>
                <small>
                  For {createdCard.recipientLabel} · {createdCard.amount} {coinPlural}
                </small>
                <code>{createdCard.code}</code>
              </div>
              <button
                type="button"
                aria-label="Copy Gift Code"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    createdCard.code.replaceAll(" ", ""),
                  );
                  showToast("Gift Code copied.");
                }}
              >
                <Copy size={18} /> Copy
              </button>
            </div>
          ) : null}
        </article>

        <article className="gift-purchase-card team-support-card">
          <span className="gift-card-icon"><UsersThree size={28} weight="duotone" /></span>
          <div>
            <p className="eyebrow">Support a Translation Team</p>
            <h3>Fund the people behind the release</h3>
            <p>The full virtual support amount is posted to the verified team ledger.</p>
          </div>
          {teams.length ? (
            <>
              <label>
                <span>Translation Team</span>
                <UnifiedSingleSelect
                  value={teamId}
                  disabled={busy !== null}
                  onChange={(event) => {
                    touchTeamDraft();
                    setTeamId(event.target.value);
                    setSupportSeriesIds([]);
                  }}
                >
                  {teams.map((team) => (
                    <option value={team.id} key={team.id}>{team.name}</option>
                  ))}
                </UnifiedSingleSelect>
              </label>
              {chosenTeam?.series.length ? (
                <fieldset
                  className="gift-recipient-fieldset"
                  disabled={busy !== null}
                >
                  <legend>Series focus (optional)</legend>
                  <div className="gift-series-options">
                    {chosenTeam.series.map((series) => {
                      const selected = supportSeriesIds.includes(series.id);
                      return (
                        <label key={series.id}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              touchTeamDraft();
                              setSupportSeriesIds((current) =>
                                selected
                                  ? current.filter((id) => id !== series.id)
                                  : [...current, series.id],
                              );
                            }}
                          />
                          <span>{series.title}</span>
                        </label>
                      );
                    })}
                  </div>
                  <small>
                    Select one or more releases for targeted support, or leave
                    everything unselected to support the whole team.
                  </small>
                </fieldset>
              ) : (
                <p className="field-help">
                  This team has no assigned public series yet. Your support
                  will go to the whole team.
                </p>
              )}
              <div className="support-pack-options" aria-label="Support amount">
                {[100, 250, 500, 1_000].map((amount) => (
                  <button
                    type="button"
                    key={amount}
                    aria-pressed={supportAmount === amount}
                    disabled={busy !== null}
                    onClick={() => {
                      touchTeamDraft();
                      setSupportAmount(amount);
                    }}
                  >
                    <Heart size={15} weight={supportAmount === amount ? "fill" : "regular"} />
                    {amount.toLocaleString("en-US")}
                  </button>
                ))}
              </div>
              <label>
                <span>Custom {coinName} amount</span>
                <input
                  type="number"
                  min={1}
                  max={1_000_000}
                  disabled={busy !== null}
                  value={supportAmount}
                  onChange={(event) => {
                    touchTeamDraft();
                    setSupportAmount(Number(event.target.value));
                  }}
                />
              </label>
              <label>
                <span>Message (optional)</span>
                <textarea
                  value={supportMessage}
                  maxLength={320}
                  rows={3}
                  disabled={busy !== null}
                  placeholder={`A note for ${chosenTeam?.name ?? "the team"}`}
                  onChange={(event) => {
                    touchTeamDraft();
                    setSupportMessage(event.target.value);
                  }}
                />
              </label>
              <button
                className="button button-primary"
                type="button"
                disabled={busy !== null || supportAmount < 1}
                onClick={() => void supportTeam()}
              >
                <Heart size={18} weight="fill" />
                {busy === "team" ? "Sending…" : "Support this Team"}
              </button>
            </>
          ) : (
            <div className="gift-empty-teams">
              Verified Translation Teams will appear here.
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
