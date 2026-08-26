"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
import { PremiumDateRangePicker } from "@/components/nyascans/PremiumDateRangePicker";

import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  FileText,
  LockKey,
  X,
} from "@/components/nyascans/heroicons";
import { useEffect, useId, useRef, useState } from "react";
import {
  AdminCombobox,
  AdminPageScaffold,
} from "@/components/nyascans/admin/AdminPageScaffold";

type AuditEvent = {
  id: string;
  action: string;
  category: string;
  actor: {
    id: string;
    name: string | null;
    email: string | null;
    role: string | null;
  } | null;
  target: {
    type: string;
    id: string;
    label: string | null;
    href: string | null;
  };
  result: string;
  sourceArea: string;
  requestId: string | null;
  reason: string | null;
  metadata?: unknown;
  before?: unknown;
  after?: unknown;
  timestamp: string;
};

type Filters = {
  start: string;
  end: string;
  category: string;
  actor: string;
  action: string;
  targetType: string;
  result: string;
  query: string;
};

const emptyFilters: Filters = {
  start: "",
  end: "",
  category: "ALL",
  actor: "",
  action: "",
  targetType: "",
  result: "ALL",
  query: "",
};

const auditCategoryOptions = [
  { value: "ALL", label: "All categories" },
  { value: "AUTHENTICATION_SECURITY", label: "Authentication & security" },
  { value: "USERS_ROLES", label: "Users & roles" },
  { value: "SERIES_CHAPTERS", label: "Series & chapters" },
  { value: "TEAMS_PERMISSIONS", label: "Teams & permissions" },
  {
    value: "DISCUSSIONS_MODERATION",
    label: "Discussions & moderation",
  },
  { value: "COMMERCE_STORE", label: "Commerce & Store" },
  { value: "APPEARANCE_SETTINGS", label: "Appearance & settings" },
  { value: "UPLOADS_IMPORTS", label: "Uploads & imports" },
  { value: "SYSTEM_MAINTENANCE", label: "System & maintenance" },
] as const;

async function api<T>(input: string) {
  const response = await fetch(input, { cache: "no-store" });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    const error = new Error(
      payload.error?.message ?? "The audit log could not be loaded.",
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function safeJson(value: unknown) {
  if (value === null || value === undefined) return "Not recorded";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "This metadata could not be displayed.";
  }
}

function auditUrlState() {
  if (typeof window === "undefined") {
    return { filters: emptyFilters, page: 1 };
  }
  const parameters = new URLSearchParams(window.location.search);
  const filters = Object.fromEntries(
    (Object.keys(emptyFilters) as Array<keyof Filters>).map((key) => [
      key,
      parameters.get(key) ?? emptyFilters[key],
    ]),
  ) as Filters;
  const requestedPage = Number(parameters.get("page") ?? "1");
  return {
    filters,
    page:
      Number.isInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1,
  };
}

function auditParameters(filters: Filters, page: number, includeLimit = false) {
  const parameters = new URLSearchParams({ page: String(page) });
  if (includeLimit) parameters.set("limit", "40");
  for (const [key, value] of Object.entries(filters)) {
    if (value) parameters.set(key, value);
  }
  return parameters;
}

function StructuredValues({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 20);
  if (!entries.length) return null;
  return (
    <dl className="audit-structured-values">
      {entries.map(([key, entry]) => (
        <div key={key}>
          <dt>{key.replaceAll("_", " ")}</dt>
          <dd>
            {entry === null || entry === undefined
              ? "Not recorded"
              : typeof entry === "object"
                ? safeJson(entry)
                : String(entry)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditLogPanel({
  actorRole,
  embedded = false,
  displayTitle = "Audit Log",
}: {
  actorRole: string;
  embedded?: boolean;
  displayTitle?: string;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(actorRole !== "OWNER");
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const detailLoadingRef = useRef(detailLoading);
  const detailOpen = Boolean(selected);
  const detailTitleId = useId();
  const detailDescriptionId = useId();

  useEffect(() => {
    detailLoadingRef.current = detailLoading;
  }, [detailLoading]);

  function setUrlState(nextFilters: Filters, nextPage: number) {
    const nextUrl = new URL(window.location.href);
    nextUrl.search = auditParameters(nextFilters, nextPage).toString();
    window.history.pushState({}, "", nextUrl);
    setFilters(nextFilters);
    setApplied(nextFilters);
    setPage(nextPage);
  }

  async function load() {
    if (actorRole !== "OWNER") {
      setDenied(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const parameters = auditParameters(applied, page, true);
      const payload = await api<{
        data: AuditEvent[];
        pagination: { total: number };
      }>(`/api/v1/admin/audit-events?${parameters}`);
      setEvents(payload.data);
      setTotal(payload.pagination.total);
      setDenied(false);
    } catch (reason) {
      if ((reason as Error & { status?: number }).status === 403) {
        setDenied(true);
      } else {
        setError(
          reason instanceof Error
            ? reason.message
            : "The audit log could not be loaded.",
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(event: AuditEvent) {
    setSelected(event);
    setDetailLoading(true);
    setDetailError("");
    try {
      const payload = await api<{ data: AuditEvent }>(
        `/api/v1/admin/audit-events?id=${encodeURIComponent(event.id)}`,
      );
      setSelected(payload.data);
    } catch (reason) {
      setDetailError(
        reason instanceof Error
          ? reason.message
          : "The audit event detail could not be loaded.",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    function syncFromUrl() {
      const next = auditUrlState();
      setFilters(next.filters);
      setApplied(next.filters);
      setPage(next.page);
      setHydrated(true);
    }
    const frame = window.requestAnimationFrame(syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, []);

  useEffect(() => {
    if (!detailOpen) return;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    function onKeyDown(event: KeyboardEvent) {
      const drawer = drawerRef.current;
      if (!drawer) return;
      if (event.key === "Escape" && !detailLoadingRef.current) {
        event.preventDefault();
        setSelected(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      detailTriggerRef.current?.focus();
    };
  }, [detailOpen]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorRole, applied, hydrated, page]);

  return (
    <AdminPageScaffold
      breadcrumbs={["Administration", "Audit Log"]}
      kicker="Owner-only security record"
      title={displayTitle}
      description="Review immutable administrative and security events with server-side filters. Sensitive values are redacted before storage."
      embedded={embedded}
      state={
        denied
          ? {
              kind: "denied",
              title: "Owner access required",
              message:
                "Only the highest administrative role may open or query the Audit Log.",
            }
          : loading
            ? { kind: "loading", message: "Loading immutable audit events…" }
            : error
              ? {
                  kind: "error",
                  title: "Audit events unavailable",
                  message: error,
                  onRetry: () => void load(),
                }
              : { kind: "ready" }
      }
      primaryAction={
        actorRole === "OWNER" ? (
          <button className="button button-secondary" type="button" onClick={() => void load()}>
            <ArrowClockwise size={17} /> Refresh
          </button>
        ) : null
      }
    >
      <form
        className="audit-filter-grid"
        onSubmit={(event) => {
          event.preventDefault();
          setUrlState(filters, 1);
        }}
      >
        <div className="audit-date-range-field"><span>Date range</span><PremiumDateRangePicker start={filters.start} end={filters.end} label="Audit date range" valueFormat="date" onChange={({ start, end }) => setFilters((current) => ({ ...current, start: start ?? "", end: end ?? "" }))} /></div>
        <label>
          Category
          <AdminCombobox
            ariaLabel="Filter technical activity by category"
            value={filters.category}
            options={auditCategoryOptions}
            placeholder="Search activity categories…"
            onChange={(category) =>
              setFilters((current) => ({ ...current, category }))
            }
          />
        </label>
        <label>
          Result
          <UnifiedSingleSelect
            value={filters.result}
            onChange={(event) =>
              setFilters((current) => ({ ...current, result: event.target.value }))
            }
          >
            <option value="ALL">All results</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILURE">Failure</option>
            <option value="DENIED">Denied</option>
          </UnifiedSingleSelect>
        </label>
        <label>
          Actor
          <input
            value={filters.actor}
            placeholder="Name, email, or ID"
            onChange={(event) =>
              setFilters((current) => ({ ...current, actor: event.target.value }))
            }
          />
        </label>
        <label>
          Action
          <input
            value={filters.action}
            placeholder="series.update"
            onChange={(event) =>
              setFilters((current) => ({ ...current, action: event.target.value }))
            }
          />
        </label>
        <label>
          Target type
          <input
            value={filters.targetType}
            placeholder="SERIES, TEAM, PRODUCT…"
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                targetType: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Safe identifier search
          <input
            value={filters.query}
            placeholder="Target, label, request ID"
            onChange={(event) =>
              setFilters((current) => ({ ...current, query: event.target.value }))
            }
          />
        </label>
        <div className="audit-filter-actions">
          <button className="button button-secondary" type="button" onClick={() => {
            setUrlState(emptyFilters, 1);
          }}>
            Reset
          </button>
          <button className="button button-primary" type="submit">Apply filters</button>
        </div>
      </form>

      {events.length === 0 ? (
        <div className="admin-state-card">
          <h3>No events match these filters</h3>
          <p>
            Adjust the date range, category, actor, result, or safe identifier
            search.
          </p>
        </div>
      ) : (
      <div className="audit-event-table" role="table" aria-label="Audit events">
        <div role="row" className="audit-event-head">
          <span>Timestamp</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Target</span>
          <span>Result</span>
        </div>
        {events.map((event) => (
          <button
            type="button"
            role="row"
            key={event.id}
            onClick={(clickEvent) => {
              detailTriggerRef.current = clickEvent.currentTarget;
              void openDetail(event);
            }}
          >
            <time>{new Date(event.timestamp).toLocaleString()}</time>
            <span>
              <strong>{event.actor?.name || "System"}</strong>
              <small>{event.actor?.role || "SYSTEM"}</small>
            </span>
            <span>
              <strong>{event.action}</strong>
              <small>{event.category.replaceAll("_", " ").toLowerCase()}</small>
            </span>
            <span>
              <strong>{event.target.label || event.target.id || "—"}</strong>
              <small>{event.target.type}</small>
            </span>
            <em className={`audit-result result-${event.result.toLowerCase()}`}>
              {event.result}
            </em>
          </button>
        ))}
      </div>
      )}

      {events.length ? (
      <footer className="admin-pagination">
        <span>
          {total ? (page - 1) * 40 + 1 : 0}–{Math.min(total, page * 40)} of {total}
        </span>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setUrlState(applied, Math.max(1, page - 1))}
        >
          <CaretLeft size={17} /> Previous
        </button>
        <button
          type="button"
          disabled={page * 40 >= total}
          onClick={() => setUrlState(applied, page + 1)}
        >
          Next <CaretRight size={17} />
        </button>
      </footer>
      ) : null}

      {selected ? (
        <div className="admin-drawer-backdrop" role="presentation">
          <aside
            ref={drawerRef}
            tabIndex={-1}
            className="audit-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={detailTitleId}
            aria-describedby={detailDescriptionId}
          >
            <header>
              <div>
                <span>{selected.category.replaceAll("_", " ")}</span>
                <h3 id={detailTitleId}>{selected.action}</h3>
              </div>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close detail"
                onClick={() => setSelected(null)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="audit-detail-summary">
              <FileText size={24} />
              <p id={detailDescriptionId}>
                <strong>{selected.actor?.name || "The system"}</strong>{" "}
                performed <code>{selected.action}</code> on{" "}
                {selected.target.href ? (
                  <a href={selected.target.href}>
                    {selected.target.label || selected.target.id || "a target"}
                  </a>
                ) : (
                  <strong>
                    {selected.target.label || selected.target.id || "a target"}
                  </strong>
                )}
                .
              </p>
            </div>
            <dl>
              <div><dt>Timestamp</dt><dd>{new Date(selected.timestamp).toLocaleString()}</dd></div>
              <div><dt>Actor role</dt><dd>{selected.actor?.role || "SYSTEM"}</dd></div>
              <div><dt>Result</dt><dd>{selected.result}</dd></div>
              <div><dt>Source area</dt><dd>{selected.sourceArea}</dd></div>
              <div><dt>Request ID</dt><dd>{selected.requestId || "Not recorded"}</dd></div>
              <div><dt>Target ID</dt><dd>{selected.target.id || "Not recorded"}</dd></div>
            </dl>
            {selected.reason ? <p className="audit-reason"><LockKey size={17} /> {selected.reason}</p> : null}
            {detailLoading ? (
              <div className="dots-ring-loading settings-loading" role="status"><DotsRing size="md" label={null} /><span>Loading event detail…</span></div>
            ) : null}
            {detailError ? (
              <div className="admin-state-card" role="alert">
                <h4>Event detail unavailable</h4>
                <p>{detailError}</p>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => void openDetail(selected)}
                >
                  Retry
                </button>
              </div>
            ) : null}
            <section>
              <h4>Before</h4>
              <StructuredValues value={selected.before} />
              <pre>{safeJson(selected.before)}</pre>
            </section>
            <section>
              <h4>After</h4>
              <StructuredValues value={selected.after} />
              <pre>{safeJson(selected.after)}</pre>
            </section>
            <section>
              <h4>Safe metadata</h4>
              <StructuredValues value={selected.metadata} />
              <pre>{safeJson(selected.metadata)}</pre>
            </section>
          </aside>
        </div>
      ) : null}
    </AdminPageScaffold>
  );
}
