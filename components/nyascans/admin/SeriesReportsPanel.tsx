"use client";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretLeft,
  CaretRight,
  CheckCircle,
  MagnifyingGlass,
  ShieldWarning,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  AdminCombobox,
  AdminPageScaffold,
} from "@/components/nyascans/admin/AdminPageScaffold";
import {
  SERIES_REPORT_CATEGORIES,
  SERIES_REPORT_CATEGORY_LABELS,
  SERIES_REPORT_STATUSES,
  SERIES_REPORT_STATUS_LABELS,
  type SeriesReportCategory,
  type SeriesReportStatus,
} from "@/lib/series-reports";

type SeriesReport = {
  id: string;
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  seriesCoverUrl: string | null;
  category: SeriesReportCategory;
  detail: string;
  status: SeriesReportStatus;
  resolutionNote: string | null;
  revision: number;
  reporterName: string | null;
  reporterEmail: string | null;
  moderatorName: string | null;
  createdAt: string;
  updatedAt: string;
  moderatedAt: string | null;
};

type ReportSummary = Partial<Record<SeriesReportStatus, number>>;

type Pagination = {
  page: number;
  limit: number;
  total: number;
  pages: number;
};

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    fields?: Array<{ path: string; message: string }>;
  };
};

type ReportResponse = ErrorPayload & {
  data?: SeriesReport[];
  summary?: ReportSummary;
  pagination?: Pagination;
};

type ModerationResponse = ErrorPayload & {
  data?: {
    id: string;
    status: SeriesReportStatus;
    revision: number;
  };
};

type StatusFilter = "ALL" | SeriesReportStatus;
type CategoryFilter = "ALL" | SeriesReportCategory;

const reportCategoryOptions = [
  { value: "ALL", label: "All categories" },
  ...SERIES_REPORT_CATEGORIES.map((entry) => ({
    value: entry,
    label: SERIES_REPORT_CATEGORY_LABELS[entry],
  })),
];

const defaultPagination: Pagination = {
  page: 1,
  limit: 20,
  total: 0,
  pages: 1,
};

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function statusDataValue(status: SeriesReportStatus) {
  return status === "IN_REVIEW" ? "IN_PROGRESS" : status;
}

function initialFor(value: string | null, fallback: string) {
  return (value?.trim() || fallback).slice(0, 1).toUpperCase();
}

export function SeriesReportsPanel() {
  const moderationNoteId = useId();
  const [reports, setReports] = useState<SeriesReport[]>([]);
  const [summary, setSummary] = useState<ReportSummary>({});
  const [pagination, setPagination] =
    useState<Pagination>(defaultPagination);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);

  const selected = useMemo(
    () => reports.find((report) => report.id === selectedId) ?? null,
    [reports, selectedId],
  );
  const moderationNote = selected ? (notes[selected.id] ?? "") : "";
  const openCount = Number(summary.OPEN ?? 0);
  const reviewCount = Number(summary.IN_REVIEW ?? 0);
  const resolvedCount = Number(summary.RESOLVED ?? 0);
  const dismissedCount = Number(summary.DISMISSED ?? 0);
  const totalCount =
    openCount + reviewCount + resolvedCount + dismissedCount;

  const loadReports = useCallback(
    async (signal?: AbortSignal, background = false) => {
      if (!background) setLoading(true);
      try {
        const params = new URLSearchParams({
          status,
          category,
          query,
          page: String(pagination.page),
          limit: String(pagination.limit),
        });
        const response = await fetch(
          `/api/v1/admin/series-reports?${params.toString()}`,
          { cache: "no-store", signal },
        );
        const payload = (await response.json()) as ReportResponse;
        if (!response.ok) {
          throw new Error(
            payload.error?.fields?.[0]?.message ??
              payload.error?.message ??
              "Series reports could not be loaded.",
          );
        }
        const nextReports = payload.data ?? [];
        setReports(nextReports);
        setSummary(payload.summary ?? {});
        if (payload.pagination) setPagination(payload.pagination);
        setSelectedId((current) =>
          current && nextReports.some((report) => report.id === current)
            ? current
            : (nextReports[0]?.id ?? ""),
        );
        setHasLoaded(true);
        setError("");
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Series reports could not be loaded.",
          );
        }
      } finally {
        if (!background && !signal?.aborted) setLoading(false);
      }
    },
    [
      category,
      pagination.limit,
      pagination.page,
      query,
      status,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadReports(controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadReports]);

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    setPagination((current) => ({ ...current, page: 1 }));
    setQuery(queryDraft.trim());
  }

  function clearFilters() {
    setStatus("ALL");
    setCategory("ALL");
    setQueryDraft("");
    setQuery("");
    setPagination((current) => ({ ...current, page: 1 }));
  }

  function updateModerationNote(value: string) {
    if (!selected) return;
    setNotes((current) => ({ ...current, [selected.id]: value }));
  }

  async function moderate(nextStatus: SeriesReportStatus) {
    if (!selected || nextStatus === selected.status) return;
    const note = moderationNote.trim();
    if (
      (nextStatus === "RESOLVED" || nextStatus === "DISMISSED") &&
      note.length < 8
    ) {
      setError(
        "Add a moderation note of at least eight characters before closing this report.",
      );
      return;
    }
    setBusyId(selected.id);
    setError("");
    setNotice(null);
    try {
      const response = await fetch("/api/v1/admin/series-reports", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          expectedRevision: selected.revision,
          status: nextStatus,
          note,
        }),
      });
      const payload = (await response.json()) as ModerationResponse;
      if (!response.ok) {
        throw new Error(
          payload.error?.fields?.[0]?.message ??
            payload.error?.message ??
            "The moderation decision could not be saved.",
        );
      }
      setNotes((current) => {
        const next = { ...current };
        delete next[selected.id];
        return next;
      });
      setNotice({
        kind: "success",
        text: `Report marked ${SERIES_REPORT_STATUS_LABELS[nextStatus].toLowerCase()}.`,
      });
      await loadReports(undefined, true);
    } catch (moderationError) {
      setError(
        moderationError instanceof Error
          ? moderationError.message
          : "The moderation decision could not be saved.",
      );
    } finally {
      setBusyId("");
    }
  }

  const scaffoldState =
    !hasLoaded && loading
      ? ({
          kind: "loading",
          message: "Loading the series moderation queue…",
        } as const)
      : !hasLoaded && error
        ? ({
            kind: "error",
            title: "Series Reports is unavailable",
            message: error,
            onRetry: () => void loadReports(),
          } as const)
        : ({ kind: "ready" } as const);

  return (
    <AdminPageScaffold
      breadcrumbs={["Community", "Reports"]}
      kicker="Content safety"
      title="Reports"
      description="Review reader concerns about published series, record a clear decision, and preserve every status change in the audit trail."
      state={scaffoldState}
      message={notice}
      primaryAction={
        <button
          className="button button-secondary"
          type="button"
          disabled={loading || Boolean(busyId)}
          onClick={() => void loadReports()}
        >
          <ArrowClockwise size={17} />
          Refresh reports
        </button>
      }
    >
      <div className="admin-summary-grid" aria-label="Series report summary">
        <div>
          <span>Active reports</span>
          <strong>{(openCount + reviewCount).toLocaleString("en-US")}</strong>
          <small>{openCount} open · {reviewCount} in review</small>
        </div>
        <div>
          <span>Resolved</span>
          <strong>{resolvedCount.toLocaleString("en-US")}</strong>
          <small>Action completed</small>
        </div>
        <div>
          <span>Dismissed</span>
          <strong>{dismissedCount.toLocaleString("en-US")}</strong>
          <small>Closed without action</small>
        </div>
        <div>
          <span>All reports</span>
          <strong>{totalCount.toLocaleString("en-US")}</strong>
          <small>Across every status</small>
        </div>
      </div>

      <form className="audit-filter-grid" onSubmit={submitFilters}>
        <label>
          Search reports
          <span className="support-admin-search">
            <MagnifyingGlass size={17} />
            <input
              value={queryDraft}
              maxLength={160}
              placeholder="Series, reporter, email, or description"
              onChange={(event) => setQueryDraft(event.target.value)}
            />
          </span>
        </label>
        <label>
          Status
          <UnifiedSingleSelect
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
              setPagination((current) => ({ ...current, page: 1 }));
            }}
          >
            <option value="ALL">All statuses</option>
            {SERIES_REPORT_STATUSES.map((entry) => (
              <option value={entry} key={entry}>
                {SERIES_REPORT_STATUS_LABELS[entry]}
              </option>
            ))}
          </UnifiedSingleSelect>
        </label>
        <label>
          Category
          <AdminCombobox
            ariaLabel="Filter reports by category"
            value={category}
            options={reportCategoryOptions}
            placeholder="Search report categories…"
            onChange={(nextCategory) => {
              setCategory(nextCategory as CategoryFilter);
              setPagination((current) => ({ ...current, page: 1 }));
            }}
          />
        </label>
        <label>
          Results per page
          <UnifiedSingleSelect
            value={pagination.limit}
            onChange={(event) =>
              setPagination((current) => ({
                ...current,
                page: 1,
                limit: Number(event.target.value),
              }))
            }
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </UnifiedSingleSelect>
        </label>
        <div className="audit-filter-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={
              status === "ALL" &&
              category === "ALL" &&
              !queryDraft &&
              !query
            }
            onClick={clearFilters}
          >
            Clear filters
          </button>
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
        </div>
      </form>

      {error && hasLoaded ? (
        <p className="support-admin-error" role="alert">
          <WarningCircle size={18} />
          {error}
        </p>
      ) : null}

      <div className="support-admin-layout">
        <section className="support-admin-queue" aria-busy={loading}>
          <div className="support-admin-queue-meta">
            <strong>
              {pagination.total.toLocaleString("en-US")} matching reports
            </strong>
            <span>
              Page {pagination.page} of {pagination.pages}
            </span>
          </div>
          {loading ? (
            <p className="support-admin-empty" role="status">
              Loading series reports…
            </p>
          ) : reports.length ? (
            <div className="support-admin-ticket-list">
              {reports.map((report) => (
                <button
                  className={selectedId === report.id ? "is-active" : ""}
                  type="button"
                  key={report.id}
                  aria-current={selectedId === report.id ? "true" : undefined}
                  onClick={() => setSelectedId(report.id)}
                >
                  <span className="support-admin-ticket-topline">
                    <strong>
                      {SERIES_REPORT_CATEGORY_LABELS[report.category]}
                    </strong>
                    <small data-status={statusDataValue(report.status)}>
                      {SERIES_REPORT_STATUS_LABELS[report.status]}
                    </small>
                  </span>
                  <span className="support-admin-ticket-subject">
                    {report.seriesTitle}
                  </span>
                  <span className="support-admin-ticket-person">
                    <span className="support-admin-avatar" aria-hidden="true">
                      {report.seriesCoverUrl ? (
                        <img
                          src={report.seriesCoverUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        initialFor(report.seriesTitle, "S")
                      )}
                    </span>
                    <span>
                      <strong>{report.reporterName ?? "Unknown reader"}</strong>
                      <small>{report.reporterEmail ?? "Email unavailable"}</small>
                    </span>
                  </span>
                  <span className="support-admin-ticket-foot">
                    <small>Report {report.id.slice(-8)}</small>
                    <time dateTime={report.createdAt}>
                      {formatDate(report.createdAt)}
                    </time>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="support-admin-empty">
              No series reports match these filters.
            </p>
          )}
          <div className="support-admin-pagination">
            <button
              type="button"
              aria-label="Previous reports page"
              disabled={loading || pagination.page <= 1}
              onClick={() =>
                setPagination((current) => ({
                  ...current,
                  page: Math.max(1, current.page - 1),
                }))
              }
            >
              <CaretLeft size={17} />
            </button>
            <span>
              {pagination.page} / {pagination.pages}
            </span>
            <button
              type="button"
              aria-label="Next reports page"
              disabled={loading || pagination.page >= pagination.pages}
              onClick={() =>
                setPagination((current) => ({
                  ...current,
                  page: Math.min(current.pages, current.page + 1),
                }))
              }
            >
              <CaretRight size={17} />
            </button>
          </div>
        </section>

        <article className="support-admin-detail" aria-busy={Boolean(busyId)}>
          {selected ? (
            <>
              <header>
                <div>
                  <span className="support-admin-requester">
                    <span
                      className="support-admin-avatar is-large"
                      aria-hidden="true"
                    >
                      {selected.seriesCoverUrl ? (
                        <img src={selected.seriesCoverUrl} alt="" />
                      ) : (
                        initialFor(selected.seriesTitle, "S")
                      )}
                    </span>
                    <span>
                      <small>Report {selected.id.slice(-8)}</small>
                      <strong>{selected.seriesTitle}</strong>
                      <a
                        href={`/title/${encodeURIComponent(selected.seriesSlug)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open public series
                      </a>
                    </span>
                  </span>
                  <h3>{SERIES_REPORT_STATUS_LABELS[selected.status]}</h3>
                </div>
                <span className="support-admin-category">
                  {SERIES_REPORT_CATEGORY_LABELS[selected.category]}
                </span>
              </header>

              {selected.category === "CHILD_SEXUAL_ABUSE_MATERIAL" ? (
                <p className="admin-notice is-warning">
                  <ShieldWarning size={18} />
                  Treat this report as high priority. Do not download, copy, or
                  redistribute suspected illegal material.
                </p>
              ) : null}

              <div className="admin-summary-grid">
                <div>
                  <span>Reporter</span>
                  <strong>{selected.reporterName ?? "Unknown reader"}</strong>
                  <small>{selected.reporterEmail ?? "Email unavailable"}</small>
                </div>
                <div>
                  <span>Submitted</span>
                  <strong>{formatDate(selected.createdAt)}</strong>
                  <small>Revision {selected.revision}</small>
                </div>
                <div>
                  <span>Last moderation</span>
                  <strong>{formatDate(selected.moderatedAt)}</strong>
                  <small>{selected.moderatorName ?? "No moderator yet"}</small>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>{formatDate(selected.updatedAt)}</strong>
                  <small>{SERIES_REPORT_STATUS_LABELS[selected.status]}</small>
                </div>
              </div>

              <div className="support-admin-messages">
                <article>
                  <header>
                    <span className="support-admin-message-author">
                      <span className="support-admin-avatar" aria-hidden="true">
                        {initialFor(selected.reporterName, "R")}
                      </span>
                      <strong>{selected.reporterName ?? "Reader report"}</strong>
                    </span>
                    <time dateTime={selected.createdAt}>
                      {formatDate(selected.createdAt)}
                    </time>
                  </header>
                  <p>{selected.detail}</p>
                </article>
                {selected.resolutionNote ? (
                  <article className="is-staff">
                    <header>
                      <span className="support-admin-message-author">
                        <span className="support-admin-avatar" aria-hidden="true">
                          {initialFor(selected.moderatorName, "M")}
                        </span>
                        <strong>
                          {selected.moderatorName ?? "Moderator"} · Staff
                        </strong>
                      </span>
                      <time dateTime={selected.moderatedAt ?? selected.updatedAt}>
                        {formatDate(
                          selected.moderatedAt ?? selected.updatedAt,
                        )}
                      </time>
                    </header>
                    <p>{selected.resolutionNote}</p>
                  </article>
                ) : null}
              </div>

              <form
                className="support-admin-reply"
                onSubmit={(event) => event.preventDefault()}
              >
                <label htmlFor={moderationNoteId}>
                  Moderation note
                </label>
                <textarea
                  id={moderationNoteId}
                  value={moderationNote}
                  maxLength={1000}
                  disabled={busyId === selected.id}
                  placeholder="Explain the action for the audit trail. Required when resolving or dismissing."
                  onChange={(event) =>
                    updateModerationNote(event.target.value)
                  }
                />
                <small>
                  {moderationNote.length} / 1000 · Closing actions require at
                  least 8 characters.
                </small>
                <div className="admin-header-actions">
                  {selected.status === "OPEN" ? (
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => void moderate("IN_REVIEW")}
                    >
                      <ShieldWarning size={17} />
                      Mark in review
                    </button>
                  ) : selected.status === "IN_REVIEW" ? (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => void moderate("OPEN")}
                    >
                      <ArrowCounterClockwise size={17} />
                      Return to open
                    </button>
                  ) : (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => void moderate("OPEN")}
                    >
                      <ArrowCounterClockwise size={17} />
                      Reopen report
                    </button>
                  )}
                  {selected.status === "OPEN" ||
                  selected.status === "IN_REVIEW" ? (
                    <>
                      <button
                        className="button button-primary"
                        type="button"
                        disabled={Boolean(busyId) || moderationNote.trim().length < 8}
                        onClick={() => void moderate("RESOLVED")}
                      >
                        <CheckCircle size={17} />
                        Resolve
                      </button>
                      <button
                        className="button button-danger"
                        type="button"
                        disabled={Boolean(busyId) || moderationNote.trim().length < 8}
                        onClick={() => void moderate("DISMISSED")}
                      >
                        <X size={17} />
                        Dismiss
                      </button>
                    </>
                  ) : null}
                </div>
              </form>
            </>
          ) : (
            <div className="support-admin-empty support-admin-empty-detail">
              <ShieldWarning size={30} />
              <strong>Select a series report</strong>
              <span>The report and moderation controls will open here.</span>
            </div>
          )}
        </article>
      </div>
    </AdminPageScaffold>
  );
}
