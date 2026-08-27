"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowUp,
  DotsSixVertical,
  MagnifyingGlass,
  Plus,
  PushPin,

  Star,
  Trash,
} from "@/components/nyascans/heroicons";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PremiumDateRangePicker } from "@/components/nyascans/PremiumDateRangePicker";
import {
  AdminPageScaffold,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";

export type PinnedSeriesAdminRecord = {
  id: string;
  seriesId: string;
  displayOrder: number;
  featured: boolean;
  startsAt: string | null;
  endsAt: string | null;
  scheduleStatus: "SCHEDULED" | "ACTIVE" | "EXPIRED";
  slug: string;
  title: string;
  type: string;
  status: string;
  chapterCount: number;
  coverUrl: string | null;
};

export type PinnedSeriesOption = {
  id: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  coverUrl: string | null;
};

export type PinnedSeriesAdminPayload = {
  revision: number;
  pins: PinnedSeriesAdminRecord[];
  series: PinnedSeriesOption[];
};

export type PinnedSeriesPanelProps = {
  endpoint?: string;
  onSaved?: (payload: PinnedSeriesAdminPayload) => void;
};

type PinnedDraft = {
  id?: string;
  seriesId: string;
  featured: boolean;
  startsAt: string | null;
  endsAt: string | null;
  title: string;
  slug: string;
  type: string;
  status: string;
  chapterCount: number;
  coverUrl: string | null;
};

type AdminErrorPayload = {
  error?: { message?: string; code?: string };
};

const EMPTY_PAYLOAD: PinnedSeriesAdminPayload = {
  revision: 1,
  pins: [],
  series: [],
};

async function readPayload(response: Response) {
  const payload = (await response.json()) as
    | PinnedSeriesAdminPayload
    | AdminErrorPayload;
  if (!response.ok) {
    throw new Error(
      "error" in payload
        ? payload.error?.message ?? "Pinned Series could not be saved."
        : "Pinned Series could not be saved.",
    );
  }
  return payload as PinnedSeriesAdminPayload;
}

function fromRecord(record: PinnedSeriesAdminRecord): PinnedDraft {
  return {
    id: record.id,
    seriesId: record.seriesId,
    featured: record.featured,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    title: record.title,
    slug: record.slug,
    type: record.type,
    status: record.status,
    chapterCount: record.chapterCount,
    coverUrl: record.coverUrl,
  };
}

function serializedItems(items: PinnedDraft[]) {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      seriesId: item.seriesId,
      featured: item.featured,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    })),
  );
}

function scheduleStatus(item: Pick<PinnedDraft, "startsAt" | "endsAt">) {
  const now = Date.now();
  if (item.startsAt && Date.parse(item.startsAt) > now) return "Scheduled";
  if (item.endsAt && Date.parse(item.endsAt) <= now) return "Expired";
  return "Active";
}

function datesAreValid(item: PinnedDraft) {
  return !(
    item.startsAt &&
    item.endsAt &&
    Date.parse(item.endsAt) <= Date.parse(item.startsAt)
  );
}

function maximumConcurrentPins(items: PinnedDraft[]) {
  const now = Date.now();
  const checkpoints = [
    now,
    ...items
      .map((item) => (item.startsAt ? Date.parse(item.startsAt) : now))
      .filter((value) => Number.isFinite(value) && value >= now),
  ];
  return [...new Set(checkpoints)].reduce((maximum, checkpoint) => {
    const active = items.filter((item) => {
      const startsAt = item.startsAt
        ? Date.parse(item.startsAt)
        : Number.NEGATIVE_INFINITY;
      const endsAt = item.endsAt
        ? Date.parse(item.endsAt)
        : Number.POSITIVE_INFINITY;
      return startsAt <= checkpoint && checkpoint < endsAt;
    }).length;
    return Math.max(maximum, active);
  }, 0);
}

export function PinnedSeriesPanel({
  endpoint = "/api/v1/admin/pinned-series",
  onSaved,
}: PinnedSeriesPanelProps = {}) {
  const [payload, setPayload] = useState<PinnedSeriesAdminPayload>(EMPTY_PAYLOAD);
  const [items, setItems] = useState<PinnedDraft[]>([]);
  const [savedSignature, setSavedSignature] = useState("[]");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);
  const [activeView, setActiveView] = useState<"select" | "schedule">("select");

  const currentSignature = useMemo(() => serializedItems(items), [items]);
  const dirty = !loading && currentSignature !== savedSignature;
  const activeCount = items.filter((item) => scheduleStatus(item) === "Active").length;
  const invalidDates = items.some((item) => !datesAreValid(item));
  const overlapLimitExceeded = maximumConcurrentPins(items) > 9;
  useUnsavedChanges(dirty, "Pinned Series changes");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const next = await readPayload(
        await fetch(endpoint, { cache: "no-store", signal }),
      );
      const nextItems = next.pins.map(fromRecord);
      setPayload(next);
      setItems(nextItems);
      setSavedSignature(serializedItems(nextItems));
      setMessage(null);
    } catch (error) {
      if (signal?.aborted) return;
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Pinned Series could not be loaded.",
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
    if (loading) return;
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
          setPayload((current) => ({ ...current, series: next.series }));
        } catch (error) {
          if (!controller.signal.aborted) {
            setMessage({
              kind: "error",
              text:
                error instanceof Error
                  ? error.message
                  : "Series search could not be completed.",
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
  }, [endpoint, loading, query]);

  const selectedIds = useMemo(
    () => new Set(items.map((item) => item.seriesId)),
    [items],
  );
  const availableSeries = payload.series.filter(
    (series) => !selectedIds.has(series.id),
  );

  function addSeries(series: PinnedSeriesOption) {
    if (items.length >= 12 || selectedIds.has(series.id)) return;
    setItems((current) => [
      ...current,
      {
        seriesId: series.id,
        featured: true,
        startsAt: null,
        endsAt: null,
        title: series.title,
        slug: series.slug,
        type: series.type,
        status: series.status,
        chapterCount: 0,
        coverUrl: series.coverUrl,
      },
    ]);
    if (activeCount >= 9) {
      setMessage({
        kind: "neutral",
        text: "Pin added as a draft. Schedule it for after an active pin ends before saving.",
      });
    }
    setQuery("");
  }

  function updateItem(
    seriesId: string,
    updater: (item: PinnedDraft) => PinnedDraft,
  ) {
    setItems((current) =>
      current.map((item) =>
        item.seriesId === seriesId ? updater(item) : item,
      ),
    );
  }

  function moveItem(index: number, nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= items.length || index === nextIndex) return;
    setItems((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) return current;
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function dropBefore(targetSeriesId: string) {
    if (!draggingId || draggingId === targetSeriesId) return;
    setItems((current) => {
      const from = current.findIndex((item) => item.seriesId === draggingId);
      const to = current.findIndex((item) => item.seriesId === targetSeriesId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (!moved) return current;
      next.splice(from < to ? to - 1 : to, 0, moved);
      return next;
    });
    setDraggingId(null);
  }

  async function save() {
    if (!dirty || invalidDates || overlapLimitExceeded) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await readPayload(
        await fetch(endpoint, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            revision: payload.revision,
            items: items.map((item) => ({
              ...(item.id ? { id: item.id } : {}),
              seriesId: item.seriesId,
              featured: item.featured,
              startsAt: item.startsAt,
              endsAt: item.endsAt,
            })),
          }),
        }),
      );
      const nextItems = next.pins.map(fromRecord);
      setPayload(next);
      setItems(nextItems);
      setSavedSignature(serializedItems(nextItems));
      setMessage({ kind: "success", text: "Pinned Series saved." });
      onSaved?.(next);
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Pinned Series could not be saved.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminPageScaffold
      breadcrumbs={["Admin", "Content"]}
      kicker="Homepage curation"
      title="Pinned Series"
      description="Curate up to nine simultaneously active Featured titles and schedule future homepage rotations. Every pin is Featured automatically."
      tabs={[
        { key: "select", label: "Select series" },
        { key: "schedule", label: "Order & schedule", count: items.length },
      ]}
      activeTab={activeView}
      onTabChange={(value) => setActiveView(value as "select" | "schedule")}
      message={message}
      primaryAction={
        <button
          className="button button-primary"
          type="button"
          disabled={!dirty || busy || invalidDates || overlapLimitExceeded}
          onClick={() => void save()}
        >
          {busy ? <DotsRing /> : <PushPin />}
          {busy ? "Saving…" : "Save pins"}
        </button>
      }
      state={
        loading
          ? { kind: "loading", message: "Loading homepage pins…" }
          : { kind: "ready" }
      }
    >
      <PinnedSeriesAdminStyles />
      <div className="v481-pin-admin-summary">
        <div><strong>{items.length} / 12</strong><span>saved records</span></div>
        <div><strong>{activeCount} / 9</strong><span>Active Featured pins</span></div>
        <p>Every pin is Featured. Order is shared by the homepage bento and the complete Pinned Series directory.</p>
        {overlapLimitExceeded ? (
          <p className="v481-pin-limit-warning" role="alert">
            More than nine pins overlap. Adjust start or end dates before saving.
          </p>
        ) : null}
      </div>

      {activeView === "select" ? (
      <section className="admin-form-section v481-pin-picker">
        <header>
          <span className="v481-admin-icon"><MagnifyingGlass /></span>
          <div>
            <h3>Add a published series</h3>
            <p>Search the current catalog, then add a series to the end of the collection.</p>
          </div>
        </header>
        <label>
          Search series
          <span className="v481-search-field">
            <MagnifyingGlass size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Title or native title"
              onChange={(event) => setQuery(event.target.value)}
            />
            {searching ? <DotsRing label="Searching" /> : null}
          </span>
        </label>
        <div className="v481-series-results">
          {availableSeries.length ? availableSeries.map((series) => (
            <article key={series.id}>
              <span className="v481-admin-cover">
                {series.coverUrl ? <img src={series.coverUrl} alt="" /> : <PushPin />}
              </span>
              <div>
                <strong>{series.title}</strong>
                <small>{series.type} · {series.status}</small>
              </div>
              <button
                className="button button-secondary"
                type="button"
                disabled={items.length >= 12}
                onClick={() => addSeries(series)}
              >
                <Plus /> Add
              </button>
            </article>
          )) : (
            <p className="admin-inline-empty">
              {items.length >= 12
                ? "The collection already contains the maximum of 12 pins."
                : "No additional published series matches this search."}
            </p>
          )}
        </div>
      </section>
      ) : null}

      {activeView === "schedule" ? (
      <section className="admin-form-section v481-pin-order">
        <header>
          <span className="v481-admin-icon"><DotsSixVertical /></span>
          <div>
            <h3>Order and schedule</h3>
            <p>Drag records to reorder them. Arrow controls provide the same action from a keyboard or touch screen.</p>
          </div>
        </header>
        {items.length ? (
          <div className="v481-pin-admin-list">
            {items.map((item, index) => {
              const validDates = datesAreValid(item);
              const status = scheduleStatus(item);
              return (
                <article
                  key={item.seriesId}
                  draggable
                  data-dragging={draggingId === item.seriesId}
                  onDragStart={() => setDraggingId(item.seriesId)}
                  onDragEnd={() => setDraggingId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropBefore(item.seriesId)}
                >
                  <span className="v481-drag-handle" aria-hidden="true"><DotsSixVertical /></span>
                  <span className="v481-admin-cover">
                    {item.coverUrl ? <img src={item.coverUrl} alt="" /> : <PushPin />}
                    <b>{index + 1}</b>
                  </span>
                  <div className="v481-pin-admin-copy">
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.type} · {item.chapterCount} chapters</small>
                    </span>
                    <span className="v481-schedule-badge" data-status={status.toLowerCase()}>
                      {status}
                    </span>
                  </div>
                  <div className="v481-pin-date-grid">
                    <div className="admin-date-picker-field v481-pin-range-field">
                      <span>Schedule window (optional)</span>
                      <PremiumDateRangePicker
                        start={item.startsAt}
                        end={item.endsAt}
                        label="Schedule window"
                        includeTime
                        onChange={({ start, end }) => updateItem(item.seriesId, (current) => ({ ...current, startsAt: start, endsAt: end }))}
                      />
                      {!validDates ? <em>End must be after start.</em> : null}
                    </div>
                  </div>
                  <div className="v481-pin-row-actions">
                    <span className="v481-feature-toggle is-active" aria-label={`${item.title} is Featured`}>
                      <Star weight="fill" /> Featured
                    </span>
                    <span className="v481-order-buttons">
                      <button type="button" disabled={index === 0} aria-label={`Move ${item.title} up`} onClick={() => moveItem(index, index - 1)}><ArrowUp /></button>
                      <button type="button" disabled={index === items.length - 1} aria-label={`Move ${item.title} down`} onClick={() => moveItem(index, index + 1)}><ArrowDown /></button>
                    </span>
                    <button
                      type="button"
                      className="v481-remove-button"
                      aria-label={`Remove ${item.title}`}
                      onClick={() => setItems((current) => current.filter((entry) => entry.seriesId !== item.seriesId))}
                    >
                      <Trash />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="v481-pin-empty">
            <PushPin size={26} />
            <strong>No series pinned yet</strong>
            <p>Use the catalog search above to create the homepage collection.</p>
          </div>
        )}
      </section>
      ) : null}
    </AdminPageScaffold>
  );
}

const PINNED_ADMIN_CSS = `
  .v481-pin-admin-summary { display:grid; grid-template-columns:repeat(2,minmax(10rem,.35fr)) minmax(16rem,1fr); gap:.75rem; margin-bottom:1rem; }
  .v481-pin-admin-summary > * { display:grid; gap:.2rem; align-content:center; min-height:5rem; margin:0; padding:1rem; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:var(--surface); }
  .v481-pin-admin-summary strong { font-size:1.45rem; }
  .v481-pin-admin-summary span,.v481-pin-admin-summary p { color:var(--muted); font-size:.75rem; }
  .v481-admin-icon { display:grid; width:2.25rem; height:2.25rem; flex:0 0 auto; place-items:center; border:1px solid color-mix(in srgb,var(--accent) 34%,var(--line)); border-radius:var(--site-button-radius,var(--radius-small)); color:var(--accent); }
  .v481-pin-picker,.v481-pin-order { margin-bottom:1rem; }
  .v481-search-field { position:relative; display:flex; align-items:center; }
  .v481-search-field > svg:first-child { position:absolute; z-index:1; left:.8rem; color:var(--muted); }
  .v481-search-field > input { padding-left:2.45rem !important; }
  .v481-search-field > svg:last-child { position:absolute; right:.8rem; color:var(--accent); }
  .v481-series-results { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.65rem; }
  .v481-series-results > article { display:grid; grid-template-columns:3rem minmax(0,1fr) auto; align-items:center; gap:.7rem; min-width:0; padding:.65rem; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:var(--surface-2); }
  .v481-series-results > article > div,.v481-pin-admin-copy > span:first-child { display:grid; min-width:0; gap:.15rem; }
  .v481-series-results strong,.v481-pin-admin-copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .v481-series-results small,.v481-pin-admin-copy small { color:var(--muted); font-size:.68rem; }
  .v481-admin-cover { position:relative; display:grid; width:3rem; height:3.8rem; flex:0 0 auto; place-items:center; overflow:hidden; border-radius:var(--site-card-radius,var(--radius-small)); background:var(--surface-strong); color:var(--muted); }
  .v481-admin-cover img { width:100%; height:100%; object-fit:cover; }
  .v481-admin-cover b { position:absolute; right:.2rem; bottom:.2rem; display:grid; min-width:1.35rem; height:1.35rem; place-items:center; border-radius:.35rem; background:rgb(2 9 20 / 82%); color:#fff; font-size:.65rem; }
  .v481-pin-admin-list { display:grid; gap:.7rem; }
  .v481-pin-admin-list > article { display:grid; grid-template-columns:auto 3rem minmax(10rem,.8fr) minmax(22rem,1.5fr) auto; align-items:center; gap:.7rem; min-width:0; padding:.75rem; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:var(--surface-2); transition:border-color .2s ease,opacity .2s ease; }
  .v481-pin-admin-list > article[data-dragging='true'] { border-color:var(--accent); opacity:.55; }
  .v481-drag-handle { display:grid; width:1.7rem; place-items:center; color:var(--muted); cursor:grab; }
  .v481-pin-admin-copy { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:.5rem; }
  .v481-schedule-badge { display:inline-flex; min-height:1.6rem; align-items:center; padding:0 .55rem; border:1px solid var(--line); border-radius:999px; color:var(--text-soft); font-size:.62rem; font-weight:800; text-transform:uppercase; }
  .v481-schedule-badge[data-status='active'] { border-color:color-mix(in srgb,var(--success) 45%,var(--line)); color:var(--success); }
  .v481-schedule-badge[data-status='scheduled'] { border-color:color-mix(in srgb,var(--warning) 45%,var(--line)); color:var(--warning); }
  .v481-schedule-badge[data-status='expired'] { color:var(--muted); }
  .v481-pin-date-grid { display:grid; grid-template-columns:minmax(0,1fr); gap:.55rem; }
  .v481-pin-range-field { display:grid; gap:.3rem; min-width:0; color:var(--muted); font-size:.62rem; font-weight:700; }
  .v481-pin-range-field > span { display:flex; align-items:center; gap:.25rem; }
  .v481-pin-range-field .premium-picker { width:100%; }
  .v481-pin-date-grid em { color:var(--danger); font-size:.6rem; font-style:normal; }
  .v481-pin-row-actions,.v481-order-buttons { display:flex; align-items:center; gap:.35rem; }
  .v481-feature-toggle,.v481-order-buttons button,.v481-remove-button { display:inline-flex; min-height:2.35rem; align-items:center; justify-content:center; gap:.32rem; padding:0 .65rem; border:1px solid var(--line); border-radius:var(--site-button-radius,var(--radius-small)); background:var(--surface); color:var(--text-soft); cursor:pointer; font-size:.68rem; font-weight:750; }
  .v481-feature-toggle.is-active { border-color:color-mix(in srgb,var(--warning) 48%,var(--line)); background:color-mix(in srgb,var(--warning) 9%,var(--surface)); color:var(--warning); }
  .v481-order-buttons button,.v481-remove-button { width:2.35rem; padding:0; }
  .v481-remove-button { border-color:color-mix(in srgb,var(--danger) 42%,var(--line)); color:var(--danger); }
  .v481-order-buttons button:disabled { opacity:.35; cursor:not-allowed; }
  .v481-pin-empty { display:grid; min-height:11rem; place-content:center; justify-items:center; gap:.35rem; border:1px dashed var(--line); border-radius:var(--site-card-radius,var(--radius)); color:var(--muted); text-align:center; }
  .v481-pin-empty p { margin:0; font-size:.75rem; }
  @media (max-width:1180px) { .v481-pin-admin-list > article { grid-template-columns:auto 3rem minmax(0,1fr) auto; } .v481-pin-date-grid { grid-column:3 / -1; width:100%; } }
  @media (max-width:760px) { .v481-pin-admin-summary { grid-template-columns:repeat(2,minmax(0,1fr)); } .v481-pin-admin-summary > p { grid-column:1 / -1; } .v481-series-results { grid-template-columns:1fr; } .v481-pin-admin-list > article { grid-template-columns:auto 3rem minmax(0,1fr); align-items:start; } .v481-pin-admin-copy { padding-top:.35rem; } .v481-pin-date-grid { grid-column:2 / -1; grid-template-columns:1fr; } .v481-pin-row-actions { grid-column:2 / -1; flex-wrap:wrap; } }
  @media (max-width:480px) { .v481-pin-admin-summary { grid-template-columns:1fr; } .v481-pin-admin-summary > p { grid-column:auto; } .v481-series-results > article { grid-template-columns:2.6rem minmax(0,1fr); } .v481-series-results > article > button { grid-column:1 / -1; width:100%; } .v481-pin-admin-list > article { grid-template-columns:2.6rem minmax(0,1fr); } .v481-drag-handle { display:none; } .v481-pin-date-grid,.v481-pin-row-actions { grid-column:1 / -1; } .v481-feature-toggle { flex:1; } }
`;

function PinnedSeriesAdminStyles() {
  return <style>{PINNED_ADMIN_CSS}</style>;
}
