"use client";
/* eslint-disable @next/next/no-img-element */

import {
  CalendarBlank,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Power,
  SpinnerGap,
  Tag,
  Trash,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AdminPageScaffold,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";
import { coinLabel } from "@/lib/commercial-settings";

export type DiscountAdminStatus =
  | "INACTIVE"
  | "SCHEDULED"
  | "ACTIVE"
  | "EXPIRED";

export type DiscountAdminRecord = {
  id: string;
  targetType: "SERIES" | "CHAPTER";
  seriesId: string;
  chapterId: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  originalPrice: number;
  reducedPrice: number;
  percentage: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  status: DiscountAdminStatus;
  revision: number;
  seriesSlug: string;
  seriesTitle: string;
  chapterSlug: string | null;
  chapterNumber: string | null;
  chapterTitle: string | null;
  targetLabel: string;
  coverUrl: string | null;
  href: string;
};

export type DiscountTargetOption = {
  targetType: "SERIES" | "CHAPTER";
  seriesId: string;
  chapterId: string | null;
  seriesSlug: string;
  seriesTitle: string;
  chapterSlug: string | null;
  chapterNumber: string | null;
  chapterTitle: string | null;
  originalPrice: number;
  coverUrl: string | null;
};

export type DiscountsAdminPayload = {
  discounts: DiscountAdminRecord[];
  targets: DiscountTargetOption[];
  paidSystemEnabled: boolean;
};

export type DiscountsPanelProps = {
  endpoint?: string;
  onSaved?: (payload: DiscountsAdminPayload) => void;
};

type DiscountDraft = {
  id?: string;
  revision?: number;
  targetType: "SERIES" | "CHAPTER";
  seriesId: string;
  chapterId: string | null;
  targetLabel: string;
  seriesTitle: string;
  originalPrice: number;
  coverUrl: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

type AdminErrorPayload = {
  error?: { message?: string; code?: string };
};

const EMPTY_PAYLOAD: DiscountsAdminPayload = {
  discounts: [],
  targets: [],
  paidSystemEnabled: false,
};

async function readPayload(response: Response) {
  const payload = (await response.json()) as
    | DiscountsAdminPayload
    | AdminErrorPayload;
  if (!response.ok) {
    throw new Error(
      "error" in payload
        ? payload.error?.message ?? "The discount could not be saved."
        : "The discount could not be saved.",
    );
  }
  return payload as DiscountsAdminPayload;
}

function dateTimeInputValue(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function defaultDateInput(offsetDays: number) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function blankDraft(): DiscountDraft {
  return {
    targetType: "CHAPTER",
    seriesId: "",
    chapterId: null,
    targetLabel: "",
    seriesTitle: "",
    originalPrice: 0,
    coverUrl: null,
    discountType: "PERCENT",
    discountValue: "",
    startsAt: defaultDateInput(0),
    endsAt: defaultDateInput(14),
    active: true,
  };
}

function draftFromRecord(record: DiscountAdminRecord): DiscountDraft {
  return {
    id: record.id,
    revision: record.revision,
    targetType: record.targetType,
    seriesId: record.seriesId,
    chapterId: record.chapterId,
    targetLabel: record.targetLabel,
    seriesTitle: record.seriesTitle,
    originalPrice: record.originalPrice,
    coverUrl: record.coverUrl,
    discountType: record.discountType,
    discountValue: String(record.discountValue),
    startsAt: dateTimeInputValue(record.startsAt),
    endsAt: dateTimeInputValue(record.endsAt),
    active: record.active,
  };
}

function draftSignature(draft: DiscountDraft | null) {
  if (!draft) return "";
  return JSON.stringify({
    id: draft.id,
    revision: draft.revision,
    targetType: draft.targetType,
    seriesId: draft.seriesId,
    chapterId: draft.chapterId,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    active: draft.active,
  });
}

function targetKey(target: Pick<DiscountTargetOption, "targetType" | "seriesId" | "chapterId">) {
  return `${target.targetType}:${target.seriesId}:${target.chapterId ?? ""}`;
}

function draftTargetKey(draft: DiscountDraft) {
  return `${draft.targetType}:${draft.seriesId}:${draft.chapterId ?? ""}`;
}

function targetLabel(target: DiscountTargetOption) {
  return target.targetType === "CHAPTER"
    ? `${target.seriesTitle} · Chapter ${target.chapterNumber}${
        target.chapterTitle ? ` · ${target.chapterTitle}` : ""
      }`
    : `${target.seriesTitle} · All paid chapters`;
}

function readableStatus(status: DiscountAdminStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatScheduleDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

export function DiscountsPanel({
  endpoint = "/api/v1/admin/discounts",
  onSaved,
}: DiscountsPanelProps = {}) {
  const { settings } = useCommercialSettings();
  const [payload, setPayload] = useState<DiscountsAdminPayload>(EMPTY_PAYLOAD);
  const [draft, setDraft] = useState<DiscountDraft | null>(null);
  const [initialDraftSignature, setInitialDraftSignature] = useState("");
  const [query, setQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DiscountAdminRecord | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);

  const dirty = Boolean(
    draft && draftSignature(draft) !== initialDraftSignature,
  );
  const editorOpen = Boolean(draft);
  useUnsavedChanges(dirty, "discount changes");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const next = await readPayload(
        await fetch(endpoint, { cache: "no-store", signal }),
      );
      setPayload(next);
      setMessage(null);
    } catch (error) {
      if (signal?.aborted) return;
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Discounts could not be loaded.",
      });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    if (loading || !editorOpen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void (async () => {
        try {
          const next = await readPayload(
            await fetch(`${endpoint}?q=${encodeURIComponent(query.trim())}`, {
              cache: "no-store",
              signal: controller.signal,
            }),
          );
          setPayload((current) => ({ ...current, targets: next.targets }));
        } catch (error) {
          if (!controller.signal.aborted) {
            setMessage({
              kind: "error",
              text:
                error instanceof Error
                  ? error.message
                  : "Content search could not be completed.",
            });
          }
        } finally {
          if (!controller.signal.aborted) setSearching(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editorOpen, endpoint, loading, query]);

  const visibleTargets = useMemo(
    () => payload.targets.filter((target) => target.targetType === draft?.targetType),
    [draft?.targetType, payload.targets],
  );

  const visibleDiscounts = useMemo(() => {
    const normalized = listQuery.trim().toLocaleLowerCase("en-US");
    if (!normalized) return payload.discounts;
    return payload.discounts.filter((record) =>
      `${record.seriesTitle} ${record.targetLabel} ${record.status}`
        .toLocaleLowerCase("en-US")
        .includes(normalized),
    );
  }, [listQuery, payload.discounts]);

  const activeCount = payload.discounts.filter(
    (record) => record.status === "ACTIVE",
  ).length;
  const scheduledCount = payload.discounts.filter(
    (record) => record.status === "SCHEDULED",
  ).length;

  const reducedPrice = useMemo(() => {
    if (!draft) return null;
    const value = Number(draft.discountValue);
    if (!Number.isFinite(value) || value <= 0 || draft.originalPrice <= 0) return null;
    return draft.discountType === "PERCENT"
      ? Math.max(
          1,
          Math.floor((draft.originalPrice * (100 - value)) / 100),
        )
      : value;
  }, [draft]);

  const draftIsValid = Boolean(
    draft &&
      draft.seriesId &&
      (draft.targetType === "SERIES" || draft.chapterId) &&
      Number(draft.discountValue) >= 1 &&
      (draft.discountType === "FIXED" || Number(draft.discountValue) <= 99) &&
      reducedPrice !== null &&
      reducedPrice > 0 &&
      reducedPrice < draft.originalPrice &&
      draft.startsAt &&
      draft.endsAt &&
      new Date(draft.endsAt).getTime() > new Date(draft.startsAt).getTime(),
  );

  function openNew() {
    const next = blankDraft();
    setDraft(next);
    setInitialDraftSignature(draftSignature(next));
    setQuery("");
  }

  function openEdit(record: DiscountAdminRecord) {
    const next = draftFromRecord(record);
    setDraft(next);
    setInitialDraftSignature(draftSignature(next));
    setQuery("");
  }

  function closeEditor() {
    setDraft(null);
    setInitialDraftSignature("");
    setQuery("");
  }

  function selectTarget(key: string) {
    const selected = payload.targets.find((target) => targetKey(target) === key);
    if (!selected) return;
    setDraft((current) => current ? {
      ...current,
      targetType: selected.targetType,
      seriesId: selected.seriesId,
      chapterId: selected.chapterId,
      targetLabel: targetLabel(selected),
      seriesTitle: selected.seriesTitle,
      originalPrice: selected.originalPrice,
      coverUrl: selected.coverUrl,
    } : current);
  }

  function applyPayload(next: DiscountsAdminPayload) {
    setPayload(next);
    onSaved?.(next);
  }

  async function saveDraft() {
    if (!draft || !draftIsValid) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await readPayload(
        await fetch(endpoint, {
          method: draft.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(draft.id ? { id: draft.id, revision: draft.revision } : {}),
            targetType: draft.targetType,
            seriesId: draft.seriesId,
            chapterId: draft.targetType === "CHAPTER" ? draft.chapterId : null,
            discountType: draft.discountType,
            discountValue: Number(draft.discountValue),
            startsAt: new Date(draft.startsAt).toISOString(),
            endsAt: new Date(draft.endsAt).toISOString(),
            active: draft.active,
          }),
        }),
      );
      applyPayload(next);
      setMessage({
        kind: "success",
        text: draft.id ? "Discount updated." : "Discount created.",
      });
      closeEditor();
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The discount could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleDiscount(record: DiscountAdminRecord) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await readPayload(
        await fetch(endpoint, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: record.id,
            revision: record.revision,
            targetType: record.targetType,
            seriesId: record.seriesId,
            chapterId: record.chapterId,
            discountType: record.discountType,
            discountValue: record.discountValue,
            startsAt: record.startsAt,
            endsAt: record.endsAt,
            active: !record.active,
          }),
        }),
      );
      applyPayload(next);
      setMessage({
        kind: "success",
        text: record.active ? "Discount deactivated." : "Discount activated.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The discount state could not be changed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeDiscount() {
    if (!deleteTarget) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await readPayload(
        await fetch(endpoint, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: deleteTarget.id,
            revision: deleteTarget.revision,
          }),
        }),
      );
      applyPayload(next);
      setDeleteTarget(null);
      setMessage({ kind: "success", text: "Discount deleted." });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The discount could not be deleted.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminPageScaffold
        breadcrumbs={["Admin", "Finance"]}
        kicker="Paid content merchandising"
        title="Discounts"
        description="Schedule a reduced chapter price or a series-wide offer for every eligible paid chapter. Original prices always come from current server data."
        message={message}
        primaryAction={
          <button className="button button-primary" type="button" disabled={busy || Boolean(draft)} onClick={openNew}>
            <Plus /> New discount
          </button>
        }
        state={
          loading
            ? { kind: "loading", message: "Loading discounts and paid content…" }
            : { kind: "ready" }
        }
      >
        <DiscountsAdminStyles />
        {!payload.paidSystemEnabled ? (
          <div className="v481-paid-private" role="status">
            <Power weight="fill" />
            <div>
              <strong>Paid system is private</strong>
              <p>Discounts can still be prepared here, but neither this section nor its public route is visible until Paid system is enabled.</p>
            </div>
          </div>
        ) : null}

        <div className="v481-discount-summary">
          <div><strong>{payload.discounts.length}</strong><span>total records</span></div>
          <div><strong>{activeCount}</strong><span>Active</span></div>
          <div><strong>{scheduledCount}</strong><span>Scheduled</span></div>
        </div>

        {draft ? (
          <section className="admin-form-section v481-discount-editor">
            <header>
              <span className="v481-admin-icon"><Tag /></span>
              <div>
                <h3>{draft.id ? "Edit discount" : "Create discount"}</h3>
                <p>Select published paid content, set the reduction, then define its exact public window.</p>
              </div>
            </header>
            <div className="v481-discount-editor-layout">
              <div className="admin-form-grid v481-discount-form">
                <label>
                  Target type
                  <select
                    value={draft.targetType}
                    disabled={Boolean(draft.id)}
                    onChange={(event) => setDraft((current) => current ? {
                      ...current,
                      targetType: event.target.value as "SERIES" | "CHAPTER",
                      seriesId: "",
                      chapterId: null,
                      targetLabel: "",
                      seriesTitle: "",
                      originalPrice: 0,
                      coverUrl: null,
                    } : current)}
                  >
                    <option value="CHAPTER">Paid chapter</option>
                    <option value="SERIES">All paid chapters in a series</option>
                  </select>
                </label>
                <label>
                  Search content
                  <span className="v481-search-field">
                    <MagnifyingGlass size={17} aria-hidden="true" />
                    <input
                      type="search"
                      value={query}
                      placeholder="Series title or chapter"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {searching ? <SpinnerGap className="spin" aria-label="Searching" /> : null}
                  </span>
                </label>
                <label className="v481-span-two">
                  Content
                  <select
                    value={draft.seriesId ? draftTargetKey(draft) : ""}
                    disabled={Boolean(draft.id)}
                    onChange={(event) => selectTarget(event.target.value)}
                  >
                    <option value="">Select content…</option>
                    {draft.id && !visibleTargets.some((target) => targetKey(target) === draftTargetKey(draft)) ? (
                      <option value={draftTargetKey(draft)}>{draft.seriesTitle} · {draft.targetLabel}</option>
                    ) : null}
                    {visibleTargets.map((target) => (
                      <option key={targetKey(target)} value={targetKey(target)}>
                        {targetLabel(target)} · {coinLabel(target.originalPrice, settings)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reduction type
                  <select
                    value={draft.discountType}
                    onChange={(event) => setDraft((current) => current ? {
                      ...current,
                      discountType: event.target.value as "PERCENT" | "FIXED",
                      discountValue: "",
                    } : current)}
                  >
                    <option value="PERCENT">Percentage off</option>
                    <option value="FIXED">Fixed reduced price</option>
                  </select>
                </label>
                <label>
                  {draft.discountType === "PERCENT" ? "Discount percentage" : "Reduced price"}
                  <input
                    type="number"
                    min="1"
                    max={draft.discountType === "PERCENT" ? 99 : Math.max(1, draft.originalPrice - 1)}
                    step="1"
                    value={draft.discountValue}
                    placeholder={draft.discountType === "PERCENT" ? "20" : "25"}
                    onChange={(event) => setDraft((current) => current ? { ...current, discountValue: event.target.value } : current)}
                  />
                </label>
                <label>
                  Start date
                  <input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft((current) => current ? { ...current, startsAt: event.target.value } : current)} />
                </label>
                <label>
                  End date
                  <input
                    type="datetime-local"
                    aria-invalid={Boolean(draft.endsAt && draft.startsAt && new Date(draft.endsAt).getTime() <= new Date(draft.startsAt).getTime())}
                    value={draft.endsAt}
                    onChange={(event) => setDraft((current) => current ? { ...current, endsAt: event.target.value } : current)}
                  />
                </label>
                <label className="admin-toggle-row v481-span-two">
                  <input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => current ? { ...current, active: event.target.checked } : current)} />
                  <span>Active — make this discount eligible during its scheduled window</span>
                </label>
              </div>
              <aside className="v481-discount-preview">
                <span className="v481-discount-preview-cover">
                  {draft.coverUrl ? <img src={draft.coverUrl} alt="" /> : <Tag size={30} />}
                  {draft.discountType === "PERCENT" && Number(draft.discountValue) > 0 ? <b>−{draft.discountValue}%</b> : null}
                </span>
                <div>
                  <small>{draft.targetType === "CHAPTER" ? draft.seriesTitle || "Paid chapter" : "Series-wide chapter offer"}</small>
                  <strong>{draft.targetLabel || "Select content to preview the offer"}</strong>
                  <span><s>{draft.originalPrice ? coinLabel(draft.originalPrice, settings) : "Original price"}</s><b>{reducedPrice !== null ? coinLabel(reducedPrice, settings) : "Reduced price"}</b></span>
                  <em><CalendarBlank /> {draft.endsAt ? `Ends ${formatScheduleDate(new Date(draft.endsAt).toISOString())}` : "Choose an end date"}</em>
                </div>
              </aside>
            </div>
            <footer className="v481-editor-actions">
              <button className="button button-secondary" type="button" disabled={busy} onClick={closeEditor}>Cancel</button>
              <button className="button button-primary" type="button" disabled={busy || !draftIsValid} onClick={() => void saveDraft()}>
                {busy ? <SpinnerGap className="spin" /> : <Tag />}
                {busy ? "Saving…" : draft.id ? "Update discount" : "Create discount"}
              </button>
            </footer>
          </section>
        ) : null}

        <section className="admin-form-section v481-discount-list-section">
          <header>
            <span className="v481-admin-icon"><Tag /></span>
            <div>
              <h3>Discount schedule</h3>
              <p>Statuses are calculated from the active toggle and the exact start/end dates.</p>
            </div>
          </header>
          <label>
            Search discounts
            <span className="v481-search-field">
              <MagnifyingGlass size={17} aria-hidden="true" />
              <input type="search" value={listQuery} placeholder="Series, chapter or status" onChange={(event) => setListQuery(event.target.value)} />
            </span>
          </label>
          {visibleDiscounts.length ? (
            <div className="v481-discount-admin-list">
              {visibleDiscounts.map((record) => (
                <article key={record.id}>
                  <span className="v481-discount-list-cover">
                    {record.coverUrl ? <img src={record.coverUrl} alt="" /> : <Tag />}
                    <b>−{record.percentage}%</b>
                  </span>
                  <div className="v481-discount-list-copy">
                    <span>
                      <small>{record.targetType === "CHAPTER" ? record.seriesTitle : "Series-wide chapter offer"}</small>
                      <strong>{record.targetLabel}</strong>
                    </span>
                    <span className="v481-discount-list-price">
                      <s>{coinLabel(record.originalPrice, settings)}</s>
                      <b>{coinLabel(record.reducedPrice, settings)}</b>
                    </span>
                    <span className="v481-admin-status" data-status={record.status.toLowerCase()}>{readableStatus(record.status)}</span>
                    <small className="v481-discount-dates">{formatScheduleDate(record.startsAt)} — {formatScheduleDate(record.endsAt)}</small>
                  </div>
                  <div className="v481-discount-row-actions">
                    <button type="button" aria-label={`Edit discount for ${record.targetLabel}`} disabled={busy || Boolean(draft)} onClick={() => openEdit(record)}><PencilSimple /></button>
                    <button type="button" aria-label={`${record.active ? "Deactivate" : "Activate"} discount for ${record.targetLabel}`} disabled={busy} data-active={record.active} onClick={() => void toggleDiscount(record)}><Power weight={record.active ? "fill" : "regular"} /></button>
                    <button type="button" className="is-danger" aria-label={`Delete discount for ${record.targetLabel}`} disabled={busy} onClick={() => setDeleteTarget(record)}><Trash /></button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="v481-discount-empty">
              <Tag size={26} />
              <strong>{payload.discounts.length ? "No matching discounts" : "No discounts yet"}</strong>
              <p>{payload.discounts.length ? "Try a broader search." : "Create the first scheduled offer with the button above."}</p>
            </div>
          )}
        </section>
      </AdminPageScaffold>
      <ConfirmActionDialog
        open={Boolean(deleteTarget)}
        title="Delete this discount?"
        description={deleteTarget ? `${deleteTarget.targetLabel} will immediately lose this scheduled offer. This cannot be undone.` : "This scheduled offer will be deleted."}
        confirmLabel="Delete discount"
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void removeDiscount()}
      />
    </>
  );
}

const DISCOUNTS_ADMIN_CSS = `
  .v481-admin-icon { display:grid; width:2.25rem; height:2.25rem; flex:0 0 auto; place-items:center; border:1px solid color-mix(in srgb,var(--accent) 34%,var(--line)); border-radius:var(--site-button-radius,var(--radius-small)); color:var(--accent); }
  .v481-paid-private { display:flex; align-items:flex-start; gap:.7rem; margin-bottom:1rem; padding:1rem; border:1px solid color-mix(in srgb,var(--warning) 42%,var(--line)); border-radius:var(--site-card-radius,var(--radius)); background:color-mix(in srgb,var(--warning) 8%,var(--surface)); color:var(--warning); }
  .v481-paid-private div { display:grid; gap:.2rem; }
  .v481-paid-private p { margin:0; color:var(--text-soft); font-size:.75rem; line-height:1.55; }
  .v481-discount-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:.75rem; margin-bottom:1rem; }
  .v481-discount-summary > div { display:grid; gap:.2rem; min-height:5rem; align-content:center; padding:1rem; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:var(--surface); }
  .v481-discount-summary strong { font-size:1.45rem; }
  .v481-discount-summary span { color:var(--muted); font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; }
  .v481-discount-editor,.v481-discount-list-section { margin-bottom:1rem; }
  .v481-discount-editor-layout { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(16rem,.75fr); gap:1rem; align-items:start; }
  .v481-discount-form .v481-span-two { grid-column:1 / -1; }
  .v481-search-field { position:relative; display:flex; align-items:center; }
  .v481-search-field > svg:first-child { position:absolute; z-index:1; left:.8rem; color:var(--muted); }
  .v481-search-field > input { padding-left:2.45rem !important; }
  .v481-search-field > svg:last-child { position:absolute; right:.8rem; color:var(--accent); }
  .v481-discount-preview { display:grid; grid-template-columns:minmax(6.8rem,.7fr) minmax(0,1.3fr); min-height:13rem; overflow:hidden; border:1px solid color-mix(in srgb,var(--warning) 35%,var(--line)); border-radius:var(--site-card-radius,var(--radius)); background:color-mix(in srgb,var(--warning) 6%,var(--surface)); }
  .v481-discount-preview-cover { position:relative; display:grid; min-height:13rem; place-items:center; overflow:hidden; border-right:1px dashed color-mix(in srgb,var(--warning) 60%,var(--line)); background:var(--surface-strong); color:var(--muted); }
  .v481-discount-preview-cover img { width:100%; height:100%; object-fit:cover; }
  .v481-discount-preview-cover b { position:absolute; top:.6rem; left:-2.1rem; width:7rem; padding:.28rem 0; transform:rotate(-42deg); background:var(--danger); color:#fff; font-size:.67rem; text-align:center; }
  .v481-discount-preview > div { display:grid; min-width:0; align-content:center; gap:.45rem; padding:1rem; }
  .v481-discount-preview small { color:var(--muted); font-size:.66rem; font-weight:750; text-transform:uppercase; }
  .v481-discount-preview strong { line-height:1.35; }
  .v481-discount-preview > div > span { display:flex; align-items:baseline; flex-wrap:wrap; gap:.45rem; }
  .v481-discount-preview s { color:var(--muted); font-size:.72rem; }
  .v481-discount-preview > div > span b { color:var(--accent); }
  .v481-discount-preview em { display:flex; align-items:center; gap:.3rem; color:var(--warning); font-size:.68rem; font-style:normal; }
  .v481-editor-actions { display:flex; justify-content:flex-end; gap:.6rem; padding-top:1rem; border-top:1px solid var(--line); }
  .v481-discount-admin-list { display:grid; gap:.65rem; }
  .v481-discount-admin-list > article { display:grid; grid-template-columns:3.8rem minmax(0,1fr) auto; align-items:center; gap:.75rem; min-width:0; padding:.7rem; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:var(--surface-2); }
  .v481-discount-list-cover { position:relative; display:grid; width:3.8rem; height:4.8rem; place-items:center; overflow:hidden; border-radius:var(--site-card-radius,var(--radius-small)); background:var(--surface-strong); color:var(--muted); }
  .v481-discount-list-cover img { width:100%; height:100%; object-fit:cover; }
  .v481-discount-list-cover b { position:absolute; right:.18rem; bottom:.18rem; padding:.2rem .3rem; border-radius:.28rem; background:var(--danger); color:#fff; font-size:.6rem; }
  .v481-discount-list-copy { display:grid; min-width:0; grid-template-columns:minmax(10rem,1.4fr) minmax(8rem,.7fr) auto minmax(10rem,.65fr); align-items:center; gap:.75rem; }
  .v481-discount-list-copy > span:first-child { display:grid; min-width:0; gap:.15rem; }
  .v481-discount-list-copy > span:first-child strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .v481-discount-list-copy small { color:var(--muted); font-size:.65rem; }
  .v481-discount-list-price { display:flex; align-items:baseline; flex-wrap:wrap; gap:.4rem; }
  .v481-discount-list-price s { color:var(--muted); font-size:.68rem; }
  .v481-discount-list-price b { color:var(--accent); font-size:.82rem; }
  .v481-admin-status { display:inline-flex; min-height:1.7rem; align-items:center; justify-content:center; padding:0 .55rem; border:1px solid var(--line); border-radius:999px; color:var(--muted); font-size:.62rem; font-weight:800; text-transform:uppercase; }
  .v481-admin-status[data-status='active'] { border-color:color-mix(in srgb,var(--success) 45%,var(--line)); color:var(--success); }
  .v481-admin-status[data-status='scheduled'] { border-color:color-mix(in srgb,var(--warning) 45%,var(--line)); color:var(--warning); }
  .v481-admin-status[data-status='expired'] { color:var(--muted); }
  .v481-admin-status[data-status='inactive'] { border-color:color-mix(in srgb,var(--danger) 32%,var(--line)); color:var(--danger); }
  .v481-discount-dates { text-align:right; }
  .v481-discount-row-actions { display:flex; align-items:center; gap:.35rem; }
  .v481-discount-row-actions button { display:grid; width:2.35rem; height:2.35rem; place-items:center; border:1px solid var(--line); border-radius:var(--site-button-radius,var(--radius-small)); background:var(--surface); color:var(--text-soft); cursor:pointer; }
  .v481-discount-row-actions button[data-active='true'] { border-color:color-mix(in srgb,var(--success) 42%,var(--line)); color:var(--success); }
  .v481-discount-row-actions button.is-danger { border-color:color-mix(in srgb,var(--danger) 42%,var(--line)); color:var(--danger); }
  .v481-discount-row-actions button:disabled { opacity:.4; cursor:not-allowed; }
  .v481-discount-empty { display:grid; min-height:11rem; place-content:center; justify-items:center; gap:.35rem; border:1px dashed var(--line); border-radius:var(--site-card-radius,var(--radius)); color:var(--muted); text-align:center; }
  .v481-discount-empty p { margin:0; font-size:.75rem; }
  @media (max-width:1080px) { .v481-discount-editor-layout { grid-template-columns:1fr; } .v481-discount-preview { max-width:35rem; } .v481-discount-list-copy { grid-template-columns:minmax(0,1fr) auto auto; } .v481-discount-dates { grid-column:1 / -1; text-align:left; } }
  @media (max-width:720px) { .v481-discount-summary { grid-template-columns:repeat(3,minmax(0,1fr)); } .v481-discount-summary > div { min-height:4.3rem; padding:.75rem; } .v481-discount-admin-list > article { grid-template-columns:3.2rem minmax(0,1fr); align-items:start; } .v481-discount-list-cover { width:3.2rem; height:4.2rem; } .v481-discount-list-copy { grid-template-columns:minmax(0,1fr) auto; } .v481-discount-list-price { grid-column:1; } .v481-discount-dates { grid-column:1 / -1; } .v481-discount-row-actions { grid-column:1 / -1; justify-content:flex-end; } }
  @media (max-width:520px) { .v481-discount-summary { grid-template-columns:1fr; } .v481-discount-form { grid-template-columns:1fr; } .v481-discount-form .v481-span-two { grid-column:auto; } .v481-discount-preview { grid-template-columns:5.6rem minmax(0,1fr); } .v481-discount-preview-cover { min-height:11rem; } .v481-editor-actions > button { flex:1; } }
`;

function DiscountsAdminStyles() {
  return <style>{DISCOUNTS_ADMIN_CSS}</style>;
}
