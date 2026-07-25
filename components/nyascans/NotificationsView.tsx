"use client";
/* eslint-disable @next/next/no-html-link-for-pages */

import {
  ArrowClockwise,
  ArrowLeft,
  Bell,
  CaretLeft,
  CaretRight,
  CheckCircle,
  MegaphoneSimple,
  Pulse,
  SignIn,
  SpinnerGap,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

type NotificationActor = {
  displayName: string;
  email: string;
};

type NotificationCategory = "ALL" | "UPDATES" | "ANNOUNCEMENTS" | "SOCIAL";
type NotificationReadState = "UNREAD" | "READ" | "ALL";
type NotificationMutation = "READ" | "UNREAD" | "READ_ALL";

type NotificationRecord = {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  actionUrl: string | null;
  metadataJson: string | null;
  createdAt: string;
  category: Exclude<NotificationCategory, "ALL">;
};

type NotificationPagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

const PAGE_SIZE = 20;

const categoryTabs = [
  { value: "ALL", label: "All", icon: Bell },
  { value: "UPDATES", label: "Updates", icon: Pulse },
  {
    value: "ANNOUNCEMENTS",
    label: "Announcements",
    icon: MegaphoneSimple,
  },
  { value: "SOCIAL", label: "Social", icon: UsersThree },
] as const;

const stateChips = [
  { value: "UNREAD", label: "Unread" },
  { value: "READ", label: "Read" },
  { value: "ALL", label: "All" },
] as const;

function safeRelativeActionUrl(value: string | null) {
  const candidate = value?.trim() ?? "";
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return null;
  }
  try {
    const base = "https://nyascans.local";
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";
  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - timestamp) / 1_000),
  );
  if (elapsedSeconds < 60) return "Just now";
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hr`;
  const elapsedDays = Math.round(elapsedHours / 24);
  if (elapsedDays < 30) return `${elapsedDays}d`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: new Date(timestamp).getUTCFullYear() === new Date().getUTCFullYear()
      ? undefined
      : "numeric",
    timeZone: "UTC",
  });
}

function absoluteTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";
  return new Date(timestamp).toISOString();
}

function categoryIcon(category: NotificationRecord["category"]) {
  if (category === "SOCIAL") return UsersThree;
  if (category === "ANNOUNCEMENTS") return MegaphoneSimple;
  return Pulse;
}

function emptyCopy(
  category: NotificationCategory,
  readState: NotificationReadState,
) {
  if (readState === "UNREAD") {
    return {
      title: "You’re all caught up",
      body:
        category === "ALL"
          ? "New notifications will appear here."
          : `No unread ${category.toLowerCase()} notifications.`,
    };
  }
  if (readState === "READ") {
    return {
      title: "No read notifications",
      body: "Notifications you have opened will appear here.",
    };
  }
  return {
    title: "No notifications found",
    body:
      category === "ALL"
        ? "Updates, announcements, and social activity will appear here."
        : `There are no ${category.toLowerCase()} notifications yet.`,
  };
}

export function NotificationsView({
  actor,
}: {
  actor: NotificationActor | null;
}) {
  const [category, setCategory] = useState<NotificationCategory>("ALL");
  const [readState, setReadState] =
    useState<NotificationReadState>("UNREAD");
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [pagination, setPagination] = useState<NotificationPagination>({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    pageCount: 1,
    hasPrevious: false,
    hasNext: false,
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(Boolean(actor));
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [updatingKey, setUpdatingKey] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!actor) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const parameters = new URLSearchParams({
          category,
          state: readState,
          page: String(page),
          pageSize: String(PAGE_SIZE),
        });
        const response = await fetch(
          `/api/v1/notifications?${parameters.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = (await response.json()) as {
          data?: NotificationRecord[];
          pagination?: NotificationPagination;
          summary?: { unreadCount?: number };
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Notifications could not be loaded.",
          );
        }
        if (controller.signal.aborted) return;
        setRecords(payload.data ?? []);
        setPagination(
          payload.pagination ?? {
            page,
            pageSize: PAGE_SIZE,
            total: payload.data?.length ?? 0,
            pageCount: 1,
            hasPrevious: false,
            hasNext: false,
          },
        );
        setUnreadCount(Math.max(0, Number(payload.summary?.unreadCount ?? 0)));
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Notifications could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [actor, category, page, readState, revision]);

  const pageNumbers = useMemo(() => {
    const pageCount = Math.max(1, pagination.pageCount);
    const first = Math.max(1, Math.min(page - 2, pageCount - 4));
    return Array.from(
      { length: Math.min(5, pageCount) },
      (_, index) => first + index,
    );
  }, [page, pagination.pageCount]);

  async function updateNotification(
    action: NotificationMutation,
    id?: string,
  ) {
    if (!actor || updatingKey) return false;
    const key = action === "READ_ALL" ? "all" : (id ?? "");
    setUpdatingKey(key);
    setActionError("");
    try {
      const response = await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(id ? { id } : {}) }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.error?.message ?? "The notification could not be updated.",
        );
      }
      if (action === "READ_ALL") setUnreadCount(0);
      window.dispatchEvent(
        new CustomEvent("nyascans:notifications-changed", {
          detail: { action, id: id ?? null },
        }),
      );
      if (action === "READ_ALL") {
        if (page === 1) {
          setRevision((current) => current + 1);
        } else {
          setPage(1);
        }
      } else if (page > 1 && records.length === 1 && readState !== "ALL") {
        setPage((current) => Math.max(1, current - 1));
      } else {
        setRevision((current) => current + 1);
      }
      return true;
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The notification could not be updated.",
      );
      return false;
    } finally {
      setUpdatingKey("");
    }
  }

  async function openNotification(
    event: React.MouseEvent<HTMLAnchorElement>,
    record: NotificationRecord,
    href: string,
  ) {
    if (record.readAt) return;
    event.preventDefault();
    await updateNotification("READ", record.id);
    window.location.assign(href);
  }

  function selectCategory(nextCategory: NotificationCategory) {
    setCategory(nextCategory);
    setPage(1);
  }

  function selectReadState(nextState: NotificationReadState) {
    setReadState(nextState);
    setPage(1);
  }

  function handleCategoryKeys(
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentCategory: NotificationCategory,
  ) {
    const currentIndex = categoryTabs.findIndex(
      ({ value }) => value === currentCategory,
    );
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % categoryTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + categoryTabs.length) % categoryTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = categoryTabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextCategory = categoryTabs[nextIndex].value;
    selectCategory(nextCategory);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
      '[role="tab"]',
    );
    tabs?.[nextIndex]?.focus();
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign("/");
  }

  const empty = emptyCopy(category, readState);

  return (
    <main className="page-main notifications-page">
      <div className="page-wrap notifications-page-inner">
        <header className="notifications-page-head">
          <button
            className="notifications-back"
            type="button"
            aria-label="Go back"
            onClick={goBack}
          >
            <ArrowLeft size={22} />
          </button>
          <div>
            <p className="eyebrow">Your activity</p>
            <h1>Notifications</h1>
            <p>
              {actor
                ? `Updates for ${actor.displayName}.`
                : "Sign in to see your NyaScans activity."}
            </p>
          </div>
        </header>

        {!actor ? (
          <section className="notifications-auth-state">
            <span className="notifications-empty-icon" aria-hidden="true">
              <Bell size={30} />
            </span>
            <h2>Your notifications are private</h2>
            <p>
              Sign in to see new chapters, account updates, announcements, and
              social activity.
            </p>
            <a
              className="button button-primary"
              href="/login?returnTo=%2Fnotifications"
            >
              <SignIn size={18} />
              Sign in
            </a>
          </section>
        ) : (
          <>
            <nav
              className="notifications-category-tabs"
              role="tablist"
              aria-label="Notification categories"
            >
              {categoryTabs.map(({ value, label, icon: Icon }) => (
                <button
                  id={`notifications-tab-${value.toLowerCase()}`}
                  type="button"
                  role="tab"
                  key={value}
                  aria-controls="notifications-panel"
                  aria-selected={category === value}
                  tabIndex={category === value ? 0 : -1}
                  onClick={() => selectCategory(value)}
                  onKeyDown={(event) => handleCategoryKeys(event, value)}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </nav>

            <section
              className="notifications-panel"
              id="notifications-panel"
              role="tabpanel"
              aria-labelledby={`notifications-tab-${category.toLowerCase()}`}
              tabIndex={0}
            >
              <div className="notifications-toolbar">
                <div
                  className="notifications-state-chips"
                  aria-label="Notification read status"
                >
                  {stateChips.map(({ value, label }) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={readState === value}
                      onClick={() => selectReadState(value)}
                    >
                      {label}
                      {value === "UNREAD" && unreadCount > 0 ? (
                        <span>{unreadCount}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <button
                  className="notifications-mark-all"
                  type="button"
                  disabled={unreadCount === 0 || Boolean(updatingKey)}
                  onClick={() => void updateNotification("READ_ALL")}
                >
                  <CheckCircle size={17} />
                  {updatingKey === "all" ? "Marking…" : "Mark all as read"}
                </button>
              </div>

              {actionError ? (
                <div className="notifications-action-error" role="alert">
                  <WarningCircle size={18} />
                  <span>{actionError}</span>
                  <button type="button" onClick={() => setActionError("")}>
                    Dismiss
                  </button>
                </div>
              ) : null}

              {loading ? (
                <div
                  className="notifications-loading"
                  role="status"
                  aria-live="polite"
                >
                  <SpinnerGap className="is-spinning" size={24} />
                  <span>Loading notifications…</span>
                  <div aria-hidden="true">
                    {Array.from({ length: 4 }, (_, index) => (
                      <i key={index} />
                    ))}
                  </div>
                </div>
              ) : loadError ? (
                <div className="notifications-error" role="alert">
                  <WarningCircle size={28} />
                  <strong>Notifications unavailable</strong>
                  <p>{loadError}</p>
                  <button
                    type="button"
                    onClick={() => setRevision((current) => current + 1)}
                  >
                    <ArrowClockwise size={17} />
                    Try again
                  </button>
                </div>
              ) : records.length ? (
                <div
                  className="notifications-list"
                  aria-live="polite"
                  aria-busy={Boolean(updatingKey)}
                >
                  {records.map((record) => {
                    const href = safeRelativeActionUrl(record.actionUrl);
                    const Icon = categoryIcon(record.category);
                    return (
                      <article
                        className={`notification-card ${
                          record.readAt ? "is-read" : "is-unread"
                        }`}
                        key={record.id}
                      >
                        <span
                          className={`notification-card-icon is-${record.category.toLowerCase()}`}
                          aria-hidden="true"
                        >
                          <Icon size={20} />
                        </span>
                        <div className="notification-card-copy">
                          <span className="notification-card-meta">
                            <small>{record.category.toLowerCase()}</small>
                            {!record.readAt ? <i>Unread</i> : null}
                            <time
                              dateTime={record.createdAt}
                              title={absoluteTime(record.createdAt)}
                            >
                              {relativeTime(record.createdAt)}
                            </time>
                          </span>
                          {href ? (
                            <a
                              href={href}
                              onClick={(event) =>
                                void openNotification(event, record, href)
                              }
                            >
                              <strong>{record.title}</strong>
                              <p>{record.body}</p>
                            </a>
                          ) : (
                            <div>
                              <strong>{record.title}</strong>
                              <p>{record.body}</p>
                            </div>
                          )}
                        </div>
                        <button
                          className="notification-read-toggle"
                          type="button"
                          disabled={Boolean(updatingKey)}
                          aria-label={`Mark “${record.title}” ${
                            record.readAt ? "unread" : "read"
                          }`}
                          onClick={() =>
                            void updateNotification(
                              record.readAt ? "UNREAD" : "READ",
                              record.id,
                            )
                          }
                        >
                          {updatingKey === record.id
                            ? "Saving…"
                            : record.readAt
                              ? "Mark unread"
                              : "Mark read"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="notifications-empty">
                  <span
                    className="notifications-empty-icon"
                    aria-hidden="true"
                  >
                    <Bell size={30} />
                  </span>
                  <strong>{empty.title}</strong>
                  <p>{empty.body}</p>
                  {category !== "ALL" || readState !== "ALL" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCategory("ALL");
                        setReadState("ALL");
                        setPage(1);
                      }}
                    >
                      Show all notifications
                    </button>
                  ) : null}
                </div>
              )}

              {!loading && !loadError && pagination.pageCount > 1 ? (
                <nav
                  className="notifications-pagination"
                  aria-label="Notification pages"
                >
                  <button
                    type="button"
                    disabled={!pagination.hasPrevious}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                  >
                    <CaretLeft size={16} />
                    Previous
                  </button>
                  <span>
                    Page {page} of {pagination.pageCount}
                  </span>
                  <div>
                    {pageNumbers.map((pageNumber) => (
                      <button
                        type="button"
                        key={pageNumber}
                        aria-current={
                          pageNumber === page ? "page" : undefined
                        }
                        aria-label={`Page ${pageNumber}`}
                        onClick={() => setPage(pageNumber)}
                      >
                        {pageNumber}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={!pagination.hasNext}
                    onClick={() =>
                      setPage((current) =>
                        Math.min(pagination.pageCount, current + 1),
                      )
                    }
                  >
                    Next
                    <CaretRight size={16} />
                  </button>
                </nav>
              ) : null}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
