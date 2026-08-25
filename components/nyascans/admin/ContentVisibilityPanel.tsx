"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";

import {
  ArrowClockwise,
  ArrowRight,
  CheckCircle,
  LockKey,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminPageScaffold,
  AdminSectionCard,
  AdminStatusBadge,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";

type AccessType = "FREE" | "PAID" | "PREMIUM";

type VisibilityRules = {
  defaultAccessType: "FREE" | "PAID";
  defaultPriceOnyx: number;
  autoFreeAfterDays: number | null;
  revision: number;
  updatedAt: string | null;
};

type VisibilityItem = {
  id: string;
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  chapterNumber: string;
  title: string | null;
  state: string;
  publishedAt: string | null;
  accessType: AccessType;
  effectiveAccessType: AccessType;
  priceOnyx: number;
  freeAt: string | null;
  autoFreeExempt: boolean;
  overrideRevision: number | null;
  revision: number;
  chapterAccessUrl: string;
};

type VisibilityPayload = {
  readiness: {
    enabled: boolean;
    reason: string | null;
    paymentsReady: boolean;
  };
  rules: VisibilityRules;
  summary: {
    series: number;
    chapters: number;
    free: number;
    paid: number;
    premium: number;
    scheduled: number;
  };
  items: VisibilityItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
};

type ApiEnvelope = {
  data?: VisibilityPayload;
  error?: { code?: string; message?: string };
};

type PaidVisibilityState = {
  enabled: boolean;
  revision: number;
  updatedAt: string | null;
};

type PaidVisibilityEnvelope = {
  data?: PaidVisibilityState;
  error?: { code?: string; message?: string };
};

type ItemDraft = Pick<
  VisibilityItem,
  "accessType" | "priceOnyx" | "autoFreeExempt"
>;

async function readVisibilityResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope;
  if (!response.ok) {
    const error = new Error(
      payload.error?.message ?? "Content visibility could not be loaded.",
    ) as Error & { code?: string };
    error.code = payload.error?.code;
    throw error;
  }
  if (!payload.data) throw new Error("Content visibility returned no data.");
  return payload.data;
}

async function readPaidVisibilityResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as PaidVisibilityEnvelope;
  if (!response.ok) {
    const error = new Error(
      payload.error?.message ?? "Paid content visibility could not be loaded.",
    ) as Error & { code?: string; status?: number };
    error.code = payload.error?.code;
    error.status = response.status;
    throw error;
  }
  if (!payload.data) throw new Error("Paid content visibility returned no data.");
  return payload.data;
}

export function ContentVisibilityPanel(_props: {
  onNavigate?: (section: string) => void;
}) {
  void _props;
  const [payload, setPayload] = useState<VisibilityPayload | null>(null);
  const [rulesDraft, setRulesDraft] = useState<VisibilityRules | null>(null);
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [access, setAccess] = useState<"ALL" | AccessType>("ALL");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [busy, setBusy] = useState("");
  const [paidVisibility, setPaidVisibility] =
    useState<PaidVisibilityState | null>(null);
  const [paidVisibilityAccess, setPaidVisibilityAccess] = useState<
    "loading" | "allowed" | "denied" | "error"
  >("loading");
  const [paidVisibilityBusy, setPaidVisibilityBusy] = useState(false);
  const [paidVisibilityNotice, setPaidVisibilityNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [confirmPrivateOpen, setConfirmPrivateOpen] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);

  const rulesDirty = Boolean(
    payload &&
      rulesDraft &&
      (rulesDraft.defaultAccessType !== payload.rules.defaultAccessType ||
        rulesDraft.defaultPriceOnyx !== payload.rules.defaultPriceOnyx ||
        rulesDraft.autoFreeAfterDays !== payload.rules.autoFreeAfterDays),
  );
  const itemDirty = Boolean(
    payload?.items.some((item) => {
      const draft = itemDrafts[item.id];
      return Boolean(
        draft &&
          (draft.accessType !== item.accessType ||
            draft.priceOnyx !== item.priceOnyx ||
            draft.autoFreeExempt !== item.autoFreeExempt),
      );
    }),
  );
  useUnsavedChanges(
    rulesDirty || itemDirty,
    rulesDirty ? "content visibility defaults" : "chapter visibility override",
  );

  const loadPaidVisibility = useCallback(async () => {
    setPaidVisibilityAccess("loading");
    setPaidVisibilityNotice(null);
    try {
      const next = await readPaidVisibilityResponse(
        await fetch("/api/v1/admin/lock-and-pay", { cache: "no-store" }),
      );
      setPaidVisibility(next);
      setPaidVisibilityAccess("allowed");
    } catch (reason) {
      const error = reason as Error & { status?: number };
      if (error.status === 401 || error.status === 403) {
        setPaidVisibility(null);
        setPaidVisibilityAccess("denied");
        return;
      }
      setPaidVisibilityAccess("error");
      setPaidVisibilityNotice({
        kind: "error",
        text:
          error.message || "Paid content visibility could not be loaded.",
      });
    }
  }, []);

  const load = useCallback(async () => {
    const controller = new AbortController();
    setLoading(true);
    try {
      const search = new URLSearchParams({
        q: appliedQuery,
        access,
        page: String(page),
        limit: "25",
      });
      const next = await readVisibilityResponse(
        await fetch(`/api/v1/admin/content-visibility?${search}`, {
          cache: "no-store",
          signal: controller.signal,
        }),
      );
      setPayload(next);
      setRulesDraft(next.rules);
      setItemDrafts(
        Object.fromEntries(
          next.items.map((item) => [
            item.id,
            {
              accessType: item.accessType,
              priceOnyx: item.priceOnyx,
              autoFreeExempt: item.autoFreeExempt,
            },
          ]),
        ),
      );
      setDisabled(!next.readiness.enabled);
      setMessage(null);
    } catch (reason) {
      if (controller.signal.aborted) return;
      const error = reason as Error & { code?: string };
      if (error.code === "CONTENT_VISIBILITY_DISABLED") {
        setDisabled(true);
        setPayload(null);
        setMessage(null);
      } else {
        setMessage({
          kind: "error",
          text: error.message || "Content visibility could not be loaded.",
        });
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
    return () => controller.abort();
  }, [access, appliedQuery, page]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadPaidVisibility(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadPaidVisibility]);

  async function savePaidVisibility(enabled: boolean) {
    if (!paidVisibility || paidVisibilityAccess !== "allowed") return;
    setPaidVisibilityBusy(true);
    setPaidVisibilityNotice(null);
    try {
      const next = await readPaidVisibilityResponse(
        await fetch("/api/v1/admin/lock-and-pay", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled,
            expectedRevision: paidVisibility.revision,
          }),
        }),
      );
      setPaidVisibility(next);
      setConfirmPrivateOpen(false);
      setPaidVisibilityNotice({
        kind: "success",
        text: enabled
          ? "Paid content is public on the reader site."
          : "Paid content and related commercial surfaces are now private.",
      });
    } catch (reason) {
      const error = reason as Error & { code?: string };
      setPaidVisibilityNotice({
        kind: "error",
        text:
          error.message || "Paid content visibility could not be updated.",
      });
      if (error.code === "STALE_VERSION") void loadPaidVisibility();
    } finally {
      setPaidVisibilityBusy(false);
    }
  }

  async function update(body: Record<string, unknown>, success: string) {
    setBusy(String(body.chapterId ?? body.action ?? "visibility"));
    setMessage(null);
    try {
      await readVisibilityResponse(
        await fetch("/api/v1/admin/content-visibility", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      await load();
      setMessage({ kind: "success", text: success });
    } catch (reason) {
      setMessage({
        kind: "error",
        text:
          reason instanceof Error
            ? reason.message
            : "The visibility change could not be saved.",
      });
    } finally {
      setBusy("");
    }
  }

  function saveDefaults(event: FormEvent) {
    event.preventDefault();
    if (!payload || !rulesDraft) return;
    void update(
      {
        action: "SAVE_DEFAULTS",
        expectedRevision: payload.rules.revision,
        defaultAccessType: rulesDraft.defaultAccessType,
        defaultPriceOnyx: rulesDraft.defaultPriceOnyx,
        autoFreeAfterDays: rulesDraft.autoFreeAfterDays,
      },
      "Default access rules were saved and audited.",
    );
  }

  const metrics = useMemo(
    () =>
      payload
        ? [
            ["Series", payload.summary.series],
            ["Chapters", payload.summary.chapters],
            ["Free", payload.summary.free],
            ["Paid", payload.summary.paid],
            ["Premium", payload.summary.premium],
            ["Scheduled", payload.summary.scheduled],
          ]
        : [],
    [payload],
  );

  return (
    <AdminPageScaffold
      breadcrumbs={["Monetization", "Content Access Control"]}
      kicker="Global access control"
      title="Content Access Control"
      description="Review public and paid chapters in one place, set safe defaults, and keep fine-grained chapter editing in Chapter Access."
      primaryAction={
        <button
          className="button button-secondary"
          type="button"
          disabled={loading || paidVisibilityAccess === "loading"}
          onClick={() => {
            void load();
            void loadPaidVisibility();
          }}
        >
          <ArrowClockwise size={17} /> Refresh
        </button>
      }
      message={paidVisibilityNotice ?? message}
    >
      <AdminSectionCard
        icon={<LockKey size={18} />}
        title="Paid content visibility"
        summary="Owner master control for every paid-content surface"
        action={
          <AdminStatusBadge
            tone={
              paidVisibilityAccess === "denied"
                ? "warning"
                : paidVisibilityAccess === "error"
                  ? "danger"
                  : paidVisibility?.enabled
                    ? "success"
                    : "neutral"
            }
            label={
              paidVisibilityAccess === "loading"
                ? "Checking…"
                : paidVisibilityAccess === "denied"
                  ? "Owner only"
                  : paidVisibilityAccess === "error"
                    ? "Unavailable"
                    : paidVisibility?.enabled
                      ? "Public"
                      : "Private"
            }
          />
        }
      >
        {paidVisibilityAccess === "loading" ? (
          <div className="dots-ring-loading admin-paid-visibility-loading" role="status">
            <DotsRing size="md" label={null} />
            <span>Checking the live reader-site policy…</span>
          </div>
        ) : paidVisibilityAccess === "denied" ? (
          <div className="admin-paid-visibility-denied" role="status">
            <strong>Owner access required</strong>
            <p>
              Only the site owner can make paid content public or private.
              Chapter-level controls remain governed by your assigned permissions.
            </p>
          </div>
        ) : paidVisibilityAccess === "error" || !paidVisibility ? (
          <div className="admin-paid-visibility-denied" role="alert">
            <strong>Policy status could not be confirmed</strong>
            <p>
              The control is locked until the current revision can be loaded safely.
            </p>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void loadPaidVisibility()}
            >
              Try again
            </button>
          </div>
        ) : (
          <div
            className="admin-paid-visibility-control"
            data-visibility={paidVisibility.enabled ? "public" : "private"}
          >
            <div className="admin-paid-visibility-copy">
              <strong>{paidVisibility.enabled ? "Public" : "Private"}</strong>
              <p>
                {paidVisibility.enabled
                  ? "Paid chapters, Paw Coins, wallets, packages, memberships, discounts, purchase actions, and related notifications appear on the reader site."
                  : "Hide every paid-content surface from the reader site. Existing chapters, balances, purchases, settings, and entitlements are preserved."}
              </p>
              <small>
                Existing prices, unlocks, purchases, chapter settings, and entitlements
                are never deleted by this control.
              </small>
            </div>
            <div
              className="admin-paid-visibility-options"
              role="group"
              aria-label="Paid content visibility"
            >
              <button
                className={`button ${paidVisibility.enabled ? "button-primary is-selected" : "button-secondary"}`}
                type="button"
                aria-pressed={paidVisibility.enabled}
                disabled={paidVisibilityBusy}
                onClick={() => {
                  if (!paidVisibility.enabled) void savePaidVisibility(true);
                }}
              >
                Public
              </button>
              <button
                className={`button ${paidVisibility.enabled ? "button-secondary" : "button-primary is-selected"}`}
                type="button"
                aria-pressed={!paidVisibility.enabled}
                disabled={paidVisibilityBusy}
                onClick={() => {
                  if (paidVisibility.enabled) setConfirmPrivateOpen(true);
                }}
              >
                Private
              </button>
            </div>
            <small className="admin-paid-visibility-meta">
              Revision {paidVisibility.revision}
              {paidVisibility.updatedAt
                ? ` · Updated ${new Date(paidVisibility.updatedAt).toLocaleString()}`
                : ""}
            </small>
          </div>
        )}
      </AdminSectionCard>

      {loading ? (
        <section className="admin-state-card dots-ring-loading" role="status" aria-live="polite">
          <DotsRing size="lg" label={null} />
          <h3>Loading content visibility</h3>
          <p>Loading the latest chapter access policy and exceptions…</p>
        </section>
      ) : message?.kind === "error" && !payload && !disabled ? (
        <section className="admin-state-card" role="alert">
          <h3>Content visibility is unavailable</h3>
          <p>{message.text}</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void load()}
          >
            Try again
          </button>
        </section>
      ) : disabled ? (
        <section className="admin-state-card" role="status">
          <LockKey size={28} />
          <h3>Paid content controls are inactive</h3>
          <p>
            Enable the commercial economy and premium unlocks before changing
            global visibility. Existing chapter access settings remain intact.
          </p>
          <Link className="button button-secondary" href="/onyx/admin/access/chapters">
            Open Chapter Access <ArrowRight size={16} />
          </Link>
        </section>
      ) : payload && rulesDraft ? (
        <>
          <div className="control-metrics" aria-label="Content visibility summary">
            {metrics.map(([label, value]) => (
              <article key={String(label)}>
                <CheckCircle size={20} />
                <span>{label}</span>
                <strong>{Number(value).toLocaleString()}</strong>
                <small>Current effective access</small>
              </article>
            ))}
          </div>

          <form className="settings-section-grid" onSubmit={saveDefaults}>
            <div className="control-section-heading">
              <div>
                <span>Default policy</span>
                <h3>New chapter access and automatic release</h3>
              </div>
            </div>
            <label>
              <span>Default access</span>
              <UnifiedSingleSelect
                value={rulesDraft.defaultAccessType}
                onChange={(event) =>
                  setRulesDraft({
                    ...rulesDraft,
                    defaultAccessType: event.target.value as "FREE" | "PAID",
                  })
                }
              >
                <option value="FREE">Free</option>
                <option value="PAID">Paid</option>
              </UnifiedSingleSelect>
            </label>
            <label>
              <span>Default Onyx price</span>
              <input
                type="number"
                min={0}
                step={1}
                value={rulesDraft.defaultPriceOnyx}
                disabled={rulesDraft.defaultAccessType === "FREE"}
                onChange={(event) =>
                  setRulesDraft({
                    ...rulesDraft,
                    defaultPriceOnyx: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Make chapters free after days</span>
              <input
                type="number"
                min={1}
                step={1}
                value={rulesDraft.autoFreeAfterDays ?? ""}
                placeholder="Never"
                onChange={(event) =>
                  setRulesDraft({
                    ...rulesDraft,
                    autoFreeAfterDays: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
              />
            </label>
            <div className="admin-sticky-actions store-admin-wide">
              <small>Changes apply to the default policy; chapter exceptions remain intact.</small>
              <button
                className="button button-primary"
                type="submit"
                disabled={!rulesDirty || Boolean(busy)}
              >
                Save default policy
              </button>
            </div>
          </form>

          <div className="control-section-heading">
            <div>
              <span>Series and chapters</span>
              <h3>Effective access and exceptions</h3>
            </div>
            <form
              className="control-search"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setAppliedQuery(query.trim());
              }}
            >
              <MagnifyingGlass size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search series or chapter"
              />
              <button type="submit">Search</button>
            </form>
          </div>
          <div className="analytics-range-tabs" role="group" aria-label="Access filter">
            {(["ALL", "FREE", "PAID", "PREMIUM"] as const).map((value) => (
              <button
                type="button"
                className={access === value ? "active" : ""}
                aria-pressed={access === value}
                onClick={() => {
                  setAccess(value);
                  setPage(1);
                }}
                key={value}
              >
                {value === "ALL" ? "All access" : value.toLowerCase()}
              </button>
            ))}
          </div>

          {payload.items.length ? (
            <div className="users-control-table-wrap">
              <table className="users-control-table">
                <thead>
                  <tr>
                    <th>Series / chapter</th>
                    <th>Effective</th>
                    <th>Override</th>
                    <th>Price / release</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.items.map((item) => {
                    const draft = itemDrafts[item.id] ?? item;
                    const changed =
                      draft.accessType !== item.accessType ||
                      draft.priceOnyx !== item.priceOnyx ||
                      draft.autoFreeExempt !== item.autoFreeExempt;
                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.seriesTitle}</strong>
                          <small>
                            Chapter {item.chapterNumber}
                            {item.title ? ` · ${item.title}` : ""}
                          </small>
                        </td>
                        <td>{item.effectiveAccessType}</td>
                        <td>
                          <UnifiedSingleSelect
                            aria-label={`Access for ${item.seriesTitle} chapter ${item.chapterNumber}`}
                            value={draft.accessType}
                            onChange={(event) =>
                              setItemDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...draft,
                                  accessType: event.target.value as AccessType,
                                },
                              }))
                            }
                          >
                            <option value="FREE">Free</option>
                            <option value="PAID">Paid</option>
                            <option value="PREMIUM">Premium</option>
                          </UnifiedSingleSelect>
                          <label>
                            <input
                              type="checkbox"
                              checked={draft.autoFreeExempt}
                              onChange={(event) =>
                                setItemDrafts((current) => ({
                                  ...current,
                                  [item.id]: {
                                    ...draft,
                                    autoFreeExempt: event.target.checked,
                                  },
                                }))
                              }
                            />
                            Exempt from auto-free
                          </label>
                        </td>
                        <td>
                          <input
                            aria-label={`Onyx price for ${item.seriesTitle} chapter ${item.chapterNumber}`}
                            type="number"
                            min={0}
                            step={1}
                            value={draft.priceOnyx}
                            disabled={draft.accessType === "FREE"}
                            onChange={(event) =>
                              setItemDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...draft,
                                  priceOnyx: Number(event.target.value),
                                },
                              }))
                            }
                          />
                          <small>
                            {item.freeAt
                              ? `Free ${new Date(item.freeAt).toLocaleDateString()}`
                              : "No scheduled release"}
                          </small>
                        </td>
                        <td>
                          <button
                            className="button button-primary button-compact"
                            type="button"
                            disabled={!changed || Boolean(busy)}
                            onClick={() =>
                              void update(
                                {
                                  action: "SET_OVERRIDE",
                                  chapterId: item.id,
                                  expectedChapterRevision: item.revision,
                                  accessType: draft.accessType,
                                  priceOnyx: draft.priceOnyx,
                                  autoFreeExempt: draft.autoFreeExempt,
                                  reason: "Updated from Content Visibility control.",
                                },
                                `Chapter ${item.chapterNumber} visibility was updated.`,
                              )
                            }
                          >
                            Save
                          </button>
                          {item.overrideRevision != null ? (
                            <button
                              className="button button-secondary button-compact"
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() =>
                                void update(
                                  {
                                    action: "CLEAR_OVERRIDE",
                                    chapterId: item.id,
                                    expectedChapterRevision: item.revision,
                                    expectedOverrideRevision: item.overrideRevision,
                                    reason: "Cleared from Content Visibility control.",
                                  },
                                  `Chapter ${item.chapterNumber} now follows the default policy.`,
                                )
                              }
                            >
                              Use default
                            </button>
                          ) : null}
                          <Link
                            className="button button-secondary button-compact"
                            href={item.chapterAccessUrl || "/onyx/admin/access/chapters"}
                          >
                            Chapter Access <ArrowRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <section className="admin-state-card">
              <h3>No chapters match these filters</h3>
              <p>Change the access filter or search for another series.</p>
            </section>
          )}

          {payload.pagination.pages > 1 ? (
            <div className="admin-pagination" aria-label="Content visibility pages">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <span>
                Page {payload.pagination.page} of {payload.pagination.pages} · {payload.pagination.total} chapters
              </span>
              <button
                type="button"
                disabled={page >= payload.pagination.pages || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <ConfirmActionDialog
        open={confirmPrivateOpen}
        title="Make paid content private?"
        description="This hides paid content and every related commercial surface without deleting data."
        confirmLabel="Make private"
        busy={paidVisibilityBusy}
        onCancel={() => setConfirmPrivateOpen(false)}
        onConfirm={() => void savePaidVisibility(false)}
      />
    </AdminPageScaffold>
  );
}
