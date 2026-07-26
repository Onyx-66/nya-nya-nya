"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import {
  ArrowRight,
  CheckCircle,
  Copy,
  Gift,
  Heart,
  PaperPlaneTilt,
  UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

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
};

type GiftStorePayload = {
  cards?: GiftCard[];
  teams?: SupportTeam[];
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
  const [teams, setTeams] = useState<SupportTeam[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [giftAmount, setGiftAmount] = useState(250);
  const [recipientLabel, setRecipientLabel] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [createdCard, setCreatedCard] = useState<GiftCard | null>(null);
  const [teamId, setTeamId] = useState("");
  const [supportAmount, setSupportAmount] = useState(250);
  const [supportMessage, setSupportMessage] = useState("");
  const [busy, setBusy] = useState<"gift" | "team" | null>(null);

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
    setBusy("gift");
    try {
      const payload = await submit({
        action: "CREATE_GIFT",
        amount: giftAmount,
        recipientLabel,
        message: giftMessage,
        idempotencyKey: requestKey("gift"),
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
        amount: supportAmount,
        message: supportMessage,
        idempotencyKey: requestKey("team-support"),
      });
      showToast(
        `${supportAmount.toLocaleString("en-US")} Onyx sent to ${chosenTeam.name}.`,
      );
      setSupportMessage("");
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
            <p>Sign in to use your verified Onyx balance securely.</p>
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
        <div className="settings-loading">Loading Gifts…</div>
      </section>
    );
  }

  return (
    <section className="gift-store page-wrap" aria-labelledby="gifts-title">
      <header className="gift-store-heading">
        <p className="eyebrow">Balance-funded gifts</p>
        <h2 id="gifts-title">Give someone their next chapter.</h2>
        <p>
          Gift Cards and team support use Onyx from your current wallet. Every
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
            <span>Onyx amount</span>
            <input
              type="number"
              min={1}
              max={1_000_000}
              value={giftAmount}
              onChange={(event) => setGiftAmount(Number(event.target.value))}
            />
          </label>
          <label>
            <span>For (optional)</span>
            <input
              value={recipientLabel}
              maxLength={80}
              placeholder="Reader name"
              onChange={(event) => setRecipientLabel(event.target.value)}
            />
          </label>
          <label>
            <span>Message (optional)</span>
            <textarea
              value={giftMessage}
              maxLength={320}
              rows={3}
              placeholder="Enjoy your next story."
              onChange={(event) => setGiftMessage(event.target.value)}
            />
          </label>
          <button
            className="button button-primary"
            type="button"
            disabled={busy !== null || giftAmount < 1}
            onClick={() => void createGift()}
          >
            <PaperPlaneTilt size={18} />
            {busy === "gift" ? "Creating…" : "Create Gift Code"}
          </button>
          {createdCard ? (
            <div className="gift-code-result" role="status">
              <CheckCircle size={20} weight="fill" />
              <div>
                <small>Ready to share · {createdCard.amount} Onyx</small>
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
                <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                  {teams.map((team) => (
                    <option value={team.id} key={team.id}>{team.name}</option>
                  ))}
                </select>
              </label>
              <div className="support-pack-options" aria-label="Support amount">
                {[100, 250, 500, 1_000].map((amount) => (
                  <button
                    type="button"
                    key={amount}
                    aria-pressed={supportAmount === amount}
                    onClick={() => setSupportAmount(amount)}
                  >
                    <Heart size={15} weight={supportAmount === amount ? "fill" : "regular"} />
                    {amount.toLocaleString("en-US")}
                  </button>
                ))}
              </div>
              <label>
                <span>Custom Onyx amount</span>
                <input
                  type="number"
                  min={1}
                  max={1_000_000}
                  value={supportAmount}
                  onChange={(event) => setSupportAmount(Number(event.target.value))}
                />
              </label>
              <label>
                <span>Message (optional)</span>
                <textarea
                  value={supportMessage}
                  maxLength={320}
                  rows={3}
                  placeholder={`A note for ${chosenTeam?.name ?? "the team"}`}
                  onChange={(event) => setSupportMessage(event.target.value)}
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
