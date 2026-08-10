"use client";

import {
  Bell,
  CheckCircle,
  Gift,
  Medal,
  ShieldCheck,
  SlidersHorizontal,
  SpinnerGap,
  Ticket,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdminPageScaffold,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";

type GovernanceData = {
  area: "registry" | "achievements" | "moderation" | "access" | "security";
  permissions: {
    features: boolean;
    achievements: boolean;
    reviews: boolean;
    teamPosts: boolean;
    access: boolean;
    notifications: boolean;
    securityRead: boolean;
    sessionsManage: boolean;
  };
  featureFlags: Array<{ key: string; enabled: boolean; wired: boolean; description: string; updatedAt: string }>;
  achievements: Array<{ id: string; slug: string; name: string; description: string; rarity: string; iconKey: string | null; isActive: boolean; sortOrder: number; updatedAt: string; awardedCount: number }>;
  reviews: Array<{ id: string; rating: number; body: string; spoiler: number; moderationStatus: "VISIBLE" | "HIDDEN"; createdAt: string; updatedAt: string; authorName: string; authorEmail: string; seriesTitle: string }>;
  teamPosts: Array<{ id: string; body: string; moderationStatus: "VISIBLE" | "HIDDEN" | "DELETED"; revision: number; createdAt: string; authorName: string; authorEmail: string; teamName: string }>;
  entitlements: Array<{ id: string; sourceType: string; sourceId: string; startsAt: string; expiresAt: string | null; revokedAt: string | null; userName: string; email: string; seriesTitle: string; chapterNumber: string }>;
  giftCards: Array<{ id: string; codeSuffix: string; coinAmount: number; recipientLabel: string; status: "ACTIVE" | "REDEEMED" | "EXPIRED"; expiresAt: string | null; redeemedAt: string | null; createdAt: string; purchaserName: string; purchaserEmail: string; recipientName: string | null }>;
  notifications: Array<{ id: string; kind: string; title: string; readAt: string | null; actionUrl: string | null; createdAt: string; userName: string; email: string }>;
  sessions: Array<{ id: string; expiresAt: string; lastSeenAt: string; revokedAt: string | null; createdAt: string; userName: string; email: string }>;
  loginEvents: Array<{ id: string; result: string; reason: string; createdAt: string; userName: string | null; email: string | null }>;
  pagination: { page: number; limit: number; hasMore: boolean };
  generatedAt: string;
};

type Tab = "registry" | "community" | "moderation" | "access" | "security";

type AchievementDraft = {
  id?: string;
  expectedUpdatedAt?: string;
  slug: string;
  name: string;
  description: string;
  rarity: string;
  iconKey: string;
  isActive: boolean;
  sortOrder: number;
  reason: string;
};

const emptyAchievement: AchievementDraft = {
  slug: "",
  name: "",
  description: "",
  rarity: "COMMON",
  iconKey: "",
  isActive: true,
  sortOrder: 0,
  reason: "",
};

const areaForTab: Record<Tab, GovernanceData["area"]> = {
  registry: "registry",
  community: "achievements",
  moderation: "moderation",
  access: "access",
  security: "security",
};

function humanDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function Reference({ id }: { id: string }) {
  return <details className="technical-reference"><summary>Technical reference</summary><code>{id}</code></details>;
}

export function SiteCoveragePanel() {
  const [data, setData] = useState<GovernanceData | null>(null);
  const [tab, setTab] = useState<Tab>("registry");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const mutationLock = useRef(false);
  const loadSequence = useRef(0);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [reasons, setReasons] = useState({ feature: "", moderation: "", security: "" });
  const [achievement, setAchievement] = useState<AchievementDraft>(emptyAchievement);
  const [award, setAward] = useState({ achievementId: "", email: "", reason: "" });
  const [notice, setNotice] = useState({ email: "", title: "", body: "", actionUrl: "", reason: "", clientMutationId: "" });
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
    run: () => Promise<unknown>;
  } | null>(null);

  const dirty = Boolean(
    achievement.id
    || achievement.slug
    || achievement.name
    || achievement.description
    || achievement.iconKey
    || achievement.reason
    || award.email
    || award.reason
    || notice.email
    || notice.title
    || notice.body
    || notice.actionUrl
    || notice.reason
    || reasons.feature
    || reasons.moderation
    || reasons.security,
  );
  useUnsavedChanges(dirty, "platform governance drafts");

  const load = useCallback(async () => {
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        area: areaForTab[tab],
        page: String(page),
        limit: "30",
      });
      if (appliedQuery) params.set("q", appliedQuery);
      const response = await fetch(`/api/v1/admin/platform-governance?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as { data?: GovernanceData; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Platform controls could not be loaded.");
      if (sequence !== loadSequence.current) return false;
      setData(payload.data);
      setAward((current) => ({ ...current, achievementId: current.achievementId || payload.data!.achievements[0]?.id || "" }));
      return true;
    } catch (error) {
      if (sequence !== loadSequence.current) return false;
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Platform controls could not be loaded." });
      return false;
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [appliedQuery, page, tab]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const tabs = useMemo(() => {
    if (!data) return [{ key: "registry", label: "Registry" }];
    return [
      { key: "registry", label: "Registry" },
      ...(data.permissions.achievements ? [{ key: "community", label: "Achievements" }] : []),
      ...(data.permissions.reviews || data.permissions.teamPosts ? [{ key: "moderation", label: "Moderation" }] : []),
      ...(data.permissions.access ? [{ key: "access", label: "Access & gift cards" }] : []),
      ...(data.permissions.securityRead ? [{ key: "security", label: "Admin security" }] : []),
    ];
  }, [data]);

  async function mutate(actionKey: string, body: Record<string, unknown>, success: string) {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setBusy(actionKey);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/platform-governance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "The operation could not be saved.");
      const refreshed = await load();
      setMessage(refreshed
        ? { kind: "success", text: success }
        : { kind: "error", text: "The operation was saved, but the current registry could not be reloaded. Retry the page before making another change." });
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "The operation could not be saved." });
      return false;
    } finally {
      mutationLock.current = false;
      setBusy("");
    }
  }

  function requireReason(value: string) {
    if (value.trim().length >= 10) return true;
    setMessage({ kind: "error", text: "Write a precise operational reason of at least 10 characters." });
    return false;
  }

  async function saveAchievement() {
    if (!requireReason(achievement.reason)) return;
    const saved = await mutate("achievement-save", {
      action: "ACHIEVEMENT_SAVE",
      ...achievement,
      iconKey: achievement.iconKey.trim() || null,
    }, achievement.id ? "Achievement definition updated and audited." : "Achievement definition created and audited.");
    if (saved) setAchievement(emptyAchievement);
  }

  async function changeAward(action: "ACHIEVEMENT_ASSIGN" | "ACHIEVEMENT_REVOKE") {
    if (!award.achievementId || !award.email || !requireReason(award.reason)) return;
    await mutate("achievement-award", { action, ...award }, action === "ACHIEVEMENT_ASSIGN" ? "Achievement assigned." : "Achievement award revoked.");
  }

  const state = loading
    ? { kind: "loading" as const, message: "Loading durable platform records…" }
    : data
      ? { kind: "ready" as const }
      : { kind: "error" as const, title: "Platform registry unavailable", message: "The durable controls could not be loaded.", onRetry: () => void load() };

  return <><AdminPageScaffold
    breadcrumbs={["Administration", "Platform controls"]}
    kicker="Operational registry"
    title="Site coverage"
    description="Operate the durable systems that do not belong to a publishing, commerce, or account workspace. Every mutation is capability-gated, conflict-safe, reasoned, and audited."
    tabs={tabs}
    activeTab={tab}
    onTabChange={(key) => {
      if (busy) return;
      setTab(key as Tab);
      setPage(1);
      setQuery("");
      setAppliedQuery("");
    }}
    message={message}
    state={state}
  >
    {data ? <div className="platform-governance-workspace">
      <form className="governance-inline-form" onSubmit={(event) => {
        event.preventDefault();
        setPage(1);
        setAppliedQuery(query.trim());
      }}>
        <input aria-label="Search this registry" placeholder="Search the active registry" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className="button button-primary" type="submit" disabled={loading}>Search</button>
        {appliedQuery ? <button className="button button-secondary" type="button" onClick={() => { setQuery(""); setAppliedQuery(""); setPage(1); }}>Clear</button> : null}
      </form>
      {tab === "registry" ? <>
        <section className="governance-section">
          <header><SlidersHorizontal /><div><h3>Feature flags</h3><p>Durable platform switches. Provider-dependent capabilities still fail closed when their integration is absent.</p></div></header>
          {data.permissions.features ? <label className="governance-reason"><span>Reason for the next flag change</span><input value={reasons.feature} onChange={(event) => setReasons((current) => ({ ...current, feature: event.target.value }))} placeholder="Why is this production switch changing?" /></label> : <p className="admin-notice"><WarningCircle /> Your role can inspect the registry but cannot change feature flags.</p>}
          <div className="governance-card-grid">{data.featureFlags.map((flag) => <article key={flag.key}><div><strong>{flag.key.replaceAll("_", " ")}</strong><span>{flag.description}</span><small>{flag.wired ? "Connected to runtime" : "Legacy record · not connected"} · Updated {humanDate(flag.updatedAt)}</small></div><label className="settings-check"><input type="checkbox" checked={flag.enabled} disabled={!data.permissions.features || !flag.wired || Boolean(busy)} onChange={() => {
            if (!requireReason(reasons.feature)) return;
            void mutate(`flag:${flag.key}`, { action: "FEATURE_FLAG", key: flag.key, enabled: !flag.enabled, expectedUpdatedAt: flag.updatedAt, reason: reasons.feature }, `${flag.key} ${flag.enabled ? "disabled" : "enabled"}.`);
          }} /><span>{flag.enabled ? "Enabled" : "Disabled"}</span></label></article>)}</div>
        </section>
        {data.permissions.notifications ? <section className="governance-section">
          <header><Bell /><div><h3>Notification delivery record</h3><p>Recent database-backed notifications. Message bodies and metadata remain private.</p></div></header>
          <div className="notification-admin-form"><input type="email" aria-label="Recipient email" placeholder="reader@example.com" value={notice.email} onChange={(event) => setNotice((current) => ({ ...current, email: event.target.value, clientMutationId: "" }))} /><input aria-label="Notice title" placeholder="Notice title" value={notice.title} onChange={(event) => setNotice((current) => ({ ...current, title: event.target.value, clientMutationId: "" }))} /><textarea aria-label="Notice body" placeholder="Private notice body" value={notice.body} onChange={(event) => setNotice((current) => ({ ...current, body: event.target.value, clientMutationId: "" }))} /><input aria-label="Action path" placeholder="/account (optional)" value={notice.actionUrl} onChange={(event) => setNotice((current) => ({ ...current, actionUrl: event.target.value, clientMutationId: "" }))} /><input aria-label="Notice reason" placeholder="Administrative reason" value={notice.reason} onChange={(event) => setNotice((current) => ({ ...current, reason: event.target.value, clientMutationId: "" }))} /><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => {
            if (!requireReason(notice.reason)) return;
            const clientMutationId = notice.clientMutationId || window.crypto.randomUUID();
            if (!notice.clientMutationId) setNotice((current) => ({ ...current, clientMutationId }));
            void mutate("notice-send", { action: "NOTIFICATION_SEND", ...notice, clientMutationId, actionUrl: notice.actionUrl.trim() || null }, "Targeted administrator notice stored for delivery.").then((sent) => { if (sent) setNotice({ email: "", title: "", body: "", actionUrl: "", reason: "", clientMutationId: "" }); });
          }}>Send notice</button></div>
          <div className="governance-record-list">{data.notifications.length ? data.notifications.map((notification) => <article key={notification.id}><div><strong>{notification.title}</strong><span>{notification.kind} · {notification.userName} · {notification.email}</span><small>{notification.readAt ? `Read ${humanDate(notification.readAt)}` : "Unread"} · Created {humanDate(notification.createdAt)}</small></div><Reference id={notification.id} /></article>) : <p className="admin-empty-copy">No notification has been recorded yet.</p>}</div>
        </section> : null}
      </> : null}

      {tab === "community" && data.permissions.achievements ? <>
        <section className="governance-section">
          <header><Medal /><div><h3>{achievement.id ? "Edit achievement" : "New achievement"}</h3><p>Definitions remain linked to existing awards when their label or icon changes.</p></div></header>
          <div className="achievement-admin-form">
            <label><span>Slug</span><input value={achievement.slug} onChange={(event) => setAchievement((current) => ({ ...current, slug: event.target.value }))} /></label>
            <label><span>Name</span><input value={achievement.name} onChange={(event) => setAchievement((current) => ({ ...current, name: event.target.value }))} /></label>
            <label><span>Description</span><textarea value={achievement.description} onChange={(event) => setAchievement((current) => ({ ...current, description: event.target.value }))} /></label>
            <label><span>Rarity</span><select value={achievement.rarity} onChange={(event) => setAchievement((current) => ({ ...current, rarity: event.target.value }))}>{["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC", "EXCLUSIVE"].map((rarity) => <option key={rarity}>{rarity}</option>)}</select></label>
            <label><span>Icon reference (stored; public cards currently use the standard trophy)</span><input value={achievement.iconKey} onChange={(event) => setAchievement((current) => ({ ...current, iconKey: event.target.value }))} /></label>
            <label><span>Sort order</span><input type="number" min="0" value={achievement.sortOrder} onChange={(event) => setAchievement((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label>
            <label className="settings-check"><input type="checkbox" checked={achievement.isActive} onChange={(event) => setAchievement((current) => ({ ...current, isActive: event.target.checked }))} /><span>Visible achievement</span></label>
            <label><span>Change reason</span><input value={achievement.reason} onChange={(event) => setAchievement((current) => ({ ...current, reason: event.target.value }))} /></label>
            <div><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => void saveAchievement()}>{busy === "achievement-save" ? <SpinnerGap className="spin" /> : <CheckCircle />} {achievement.id ? "Save definition" : "Create definition"}</button>{achievement.id ? <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => setAchievement(emptyAchievement)}>Cancel edit</button> : null}</div>
          </div>
          <div className="governance-card-grid">{data.achievements.map((entry) => <article key={entry.id}><div><strong>{entry.name}</strong><span>{entry.rarity} · {entry.awardedCount} awards · {entry.isActive ? "Visible" : "Hidden"}</span><small>{entry.description || "No description"}</small></div><button className="button button-secondary" type="button" onClick={() => setAchievement({ id: entry.id, expectedUpdatedAt: entry.updatedAt, slug: entry.slug, name: entry.name, description: entry.description, rarity: entry.rarity, iconKey: entry.iconKey ?? "", isActive: entry.isActive, sortOrder: entry.sortOrder, reason: "" })}>Edit</button></article>)}</div>
        </section>
        <section className="governance-section">
          <header><UsersThree /><div><h3>Award or revoke</h3><p>Target an active account by email. Existing counter relationships are preserved.</p></div></header>
          <div className="governance-inline-form"><select aria-label="Achievement" value={award.achievementId} onChange={(event) => setAward((current) => ({ ...current, achievementId: event.target.value }))}>{data.achievements.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select><input aria-label="Reader email" type="email" placeholder="reader@example.com" value={award.email} onChange={(event) => setAward((current) => ({ ...current, email: event.target.value }))} /><input aria-label="Award reason" placeholder="Operational reason" value={award.reason} onChange={(event) => setAward((current) => ({ ...current, reason: event.target.value }))} /><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => void changeAward("ACHIEVEMENT_ASSIGN")}>Assign</button><button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => {
            if (!award.achievementId || !award.email || !requireReason(award.reason)) return;
            setConfirmation({ title: "Revoke this achievement award?", description: `The award will be removed from ${award.email}. The definition and other readers' awards are unchanged.`, confirmLabel: "Revoke award", run: () => changeAward("ACHIEVEMENT_REVOKE") });
          }}>Revoke</button></div>
        </section>
      </> : null}

      {tab === "moderation" ? <>
        <label className="governance-reason"><span>Moderation reason</span><input value={reasons.moderation} onChange={(event) => setReasons((current) => ({ ...current, moderation: event.target.value }))} placeholder="Explain the policy decision" /></label>
        {data.permissions.reviews ? <section className="governance-section"><header><ShieldCheck /><div><h3>Series reviews</h3><p>Moderation changes visibility without deleting the reader’s durable record.</p></div></header><div className="governance-record-list">{data.reviews.map((review) => <article key={review.id}><div><strong>{review.seriesTitle} · {review.rating}/5</strong><span>{review.authorName} · {review.authorEmail}</span><p>{review.body || "No written review."}</p><small>{review.moderationStatus} · {humanDate(review.createdAt)}</small></div><div><button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => {
          if (!requireReason(reasons.moderation)) return;
          const nextStatus = review.moderationStatus === "VISIBLE" ? "HIDDEN" : "VISIBLE";
          setConfirmation({ title: `${nextStatus === "HIDDEN" ? "Hide" : "Restore"} this review?`, description: `This changes public visibility for ${review.authorName}'s review of ${review.seriesTitle}.`, confirmLabel: nextStatus === "HIDDEN" ? "Hide review" : "Restore review", destructive: nextStatus === "HIDDEN", run: () => mutate(`review:${review.id}`, { action: "REVIEW_STATUS", id: review.id, expectedStatus: review.moderationStatus, expectedUpdatedAt: review.updatedAt, status: nextStatus, reason: reasons.moderation }, `Review ${nextStatus === "HIDDEN" ? "hidden" : "restored"}.`) });
        }}>{review.moderationStatus === "VISIBLE" ? "Hide" : "Restore"}</button><Reference id={review.id} /></div></article>)}</div></section> : null}
        {data.permissions.teamPosts ? <section className="governance-section"><header><ShieldCheck /><div><h3>Team discussion posts</h3><p>Hide or restore live posts with optimistic revision control. Author-deleted tombstones are never resurrected.</p></div></header><div className="governance-record-list">{data.teamPosts.map((post) => <article key={post.id}><div><strong>{post.teamName}</strong><span>{post.authorName} · {post.authorEmail}</span><p>{post.body}</p><small>{post.moderationStatus} · revision {post.revision} · {humanDate(post.createdAt)}</small></div><div><button className="button button-secondary" type="button" disabled={Boolean(busy) || post.moderationStatus === "DELETED"} onClick={() => {
          if (!requireReason(reasons.moderation)) return;
          const nextStatus = post.moderationStatus === "VISIBLE" ? "HIDDEN" : "VISIBLE";
          setConfirmation({ title: `${nextStatus === "HIDDEN" ? "Hide" : "Restore"} this team post?`, description: `This changes the post visibility in ${post.teamName}. Author-deleted posts cannot be restored.`, confirmLabel: nextStatus === "HIDDEN" ? "Hide post" : "Restore post", destructive: nextStatus === "HIDDEN", run: () => mutate(`post:${post.id}`, { action: "TEAM_POST_STATUS", id: post.id, expectedRevision: post.revision, status: nextStatus, reason: reasons.moderation }, `Team post ${nextStatus === "HIDDEN" ? "hidden" : "restored"}.`) });
        }}>{post.moderationStatus === "VISIBLE" ? "Hide" : post.moderationStatus === "HIDDEN" ? "Restore" : "Author deleted"}</button><Reference id={post.id} /></div></article>)}</div></section> : null}
      </> : null}

      {tab === "access" && data.permissions.access ? <>
        <section className="governance-section"><header><Ticket /><div><h3>Chapter entitlements</h3><p>Source references, expiry, and revocation state are visible here. Paid unlocks remain read-only until a durable refund workflow can reverse the ledger atomically.</p></div></header><div className="governance-record-list">{data.entitlements.map((entry) => <article key={entry.id}><div><strong>{entry.seriesTitle} · Chapter {entry.chapterNumber}</strong><span>{entry.userName} · {entry.email}</span><small>{entry.sourceType} · {entry.revokedAt ? `Revoked ${humanDate(entry.revokedAt)}` : entry.expiresAt ? `Expires ${humanDate(entry.expiresAt)}` : "No expiry"}</small></div><Reference id={entry.id} /></article>)}</div></section>
        <section className="governance-section"><header><Gift /><div><h3>Gift cards</h3><p>Only non-sensitive suffixes are shown. Cards are read-only here because cancellation without an escrow refund would destroy reader value.</p></div></header><div className="governance-record-list">{data.giftCards.map((card) => <article key={card.id}><div><strong>•••• {card.codeSuffix} · {card.coinAmount} Onyx</strong><span>{card.purchaserName} · {card.purchaserEmail}</span><small>{card.status} · {card.recipientName || card.recipientLabel || "No recipient assigned"}</small></div><Reference id={card.id} /></article>)}</div></section>
      </> : null}

      {tab === "security" && data.permissions.securityRead ? <>
        <label className="governance-reason"><span>Session-revocation reason</span><input value={reasons.security} onChange={(event) => setReasons((current) => ({ ...current, security: event.target.value }))} placeholder="Explain the security response" /></label>
        <section className="governance-section"><header><ShieldCheck /><div><h3>Administrator MFA sessions</h3><p>One-hour assurance sessions. Token hashes and fingerprints are never returned to the browser.{data.permissions.sessionsManage ? " Owner-only revocation is enabled." : " Your role has read-only access."}</p></div></header><div className="governance-record-list">{data.sessions.map((session) => { const expired = Date.parse(session.expiresAt) <= Date.parse(data.generatedAt); return <article key={session.id}><div><strong>{session.userName}</strong><span>{session.email}</span><small>{session.revokedAt ? `Revoked ${humanDate(session.revokedAt)}` : expired ? `Expired ${humanDate(session.expiresAt)}` : `Expires ${humanDate(session.expiresAt)}`} · last seen {humanDate(session.lastSeenAt)}</small></div><div><button className="button button-secondary" type="button" disabled={!data.permissions.sessionsManage || Boolean(session.revokedAt) || expired || Boolean(busy)} onClick={() => {
          if (!requireReason(reasons.security)) return;
          setConfirmation({ title: "Revoke this administrator session?", description: `${session.userName} will have to complete TOTP again before any further administrator action.`, confirmLabel: "Revoke session", run: () => mutate(`session:${session.id}`, { action: "MFA_SESSION_REVOKE", id: session.id, reason: reasons.security }, "Administrator session revoked.") });
        }}>Revoke session</button><Reference id={session.id} /></div></article>; })}</div></section>
        <section className="governance-section"><header><WarningCircle /><div><h3>Administrator login events</h3><p>Recent success, failure, lockout, and suspicious-login records.</p></div></header><div className="governance-record-list">{data.loginEvents.map((event) => <article key={event.id}><div><strong>{event.result}</strong><span>{event.userName || "Unresolved account"} · {event.email || "No account email"}</span><small>{event.reason || "No additional reason"} · {humanDate(event.createdAt)}</small></div><Reference id={event.id} /></article>)}</div></section>
      </> : null}
      <div className="admin-pagination" aria-label="Platform registry pages">
        <span>Page {data.pagination.page}{appliedQuery ? ` · Filter: ${appliedQuery}` : ""}</span>
        <button type="button" disabled={loading || Boolean(busy) || data.pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <button type="button" disabled={loading || Boolean(busy) || !data.pagination.hasMore} onClick={() => setPage((current) => current + 1)}>Next</button>
      </div>
    </div> : null}
  </AdminPageScaffold><ConfirmActionDialog open={Boolean(confirmation)} title={confirmation?.title ?? "Confirm action"} description={confirmation?.description ?? "Confirm this administrative action."} confirmLabel={confirmation?.confirmLabel ?? "Confirm"} destructive={confirmation?.destructive ?? true} busy={Boolean(busy)} onCancel={() => { if (!busy) setConfirmation(null); }} onConfirm={() => { const pending = confirmation; if (!pending) return; void pending.run().finally(() => setConfirmation(null)); }} /></>;
}
