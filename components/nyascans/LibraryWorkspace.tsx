"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowClockwise,
  DownloadSimple,
  GridFour,
  ListBullets,
  Rows,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

type LibraryMode = "cover" | "compact" | "list";

type LibraryRecord = {
  seriesId: string;
  slug: string;
  title: string;
  status: string;
  listType: string;
  favorite: boolean;
  addedAt: string;
  updatedAt: string;
  latestChapter: string | null;
  lastReadChapter: string | null;
  lastActivity: string | null;
  unreadCount: number;
  progress: number;
  coverUrl: string | null;
};

const modes: Array<{
  value: LibraryMode;
  label: string;
  icon: typeof GridFour;
}> = [
  { value: "cover", label: "Cover grid", icon: GridFour },
  { value: "compact", label: "Compact grid", icon: Rows },
  { value: "list", label: "List view", icon: ListBullets },
];

function relativeDate(value: string | null) {
  if (!value) return "Not started";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Recently";
  const days = Math.max(0, Math.round((Date.now() - time) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function LibraryWorkspace() {
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [mode, setMode] = useState<LibraryMode>("cover");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState("ACTIVITY");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/library-data", {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data?: LibraryRecord[];
          preferences?: { viewMode?: LibraryMode };
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Library could not be loaded.");
        }
        setRecords(payload.data ?? []);
        const stored = window.localStorage.getItem("nyascans:library-view");
        const preferred =
          stored === "compact" || stored === "list" || stored === "cover"
            ? stored
            : payload.preferences?.viewMode;
        if (preferred) setMode(preferred);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Library could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const visibleRecords = useMemo(() => {
    const filtered =
      status === "ALL"
        ? records
        : status === "UNREAD"
          ? records.filter((record) => record.unreadCount > 0)
          : records.filter((record) => record.listType === status);
    return [...filtered].sort((a, b) => {
      if (sort === "TITLE") return a.title.localeCompare(b.title);
      if (sort === "ADDED") return b.addedAt.localeCompare(a.addedAt);
      if (sort === "LATEST") {
        return (b.latestChapter ?? "").localeCompare(a.latestChapter ?? "", undefined, {
          numeric: true,
        });
      }
      if (sort === "PROGRESS") return b.progress - a.progress;
      return (b.lastActivity ?? b.updatedAt).localeCompare(
        a.lastActivity ?? a.updatedAt,
      );
    });
  }, [records, sort, status]);

  async function chooseMode(nextMode: LibraryMode) {
    setMode(nextMode);
    window.localStorage.setItem("nyascans:library-view", nextMode);
    try {
      await fetch("/api/v1/library-data", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewMode: nextMode }),
      });
    } catch {
      // Local persistence remains available when account sync is interrupted.
    }
  }

  return (
    <section className="library-workspace" aria-labelledby="library-workspace-title">
      <header className="library-workspace-head">
        <div>
          <p className="eyebrow">Reading collection</p>
          <h2 id="library-workspace-title">Saved series</h2>
          <p>Your private progress, followed titles, and unread releases.</p>
        </div>
        <a className="button button-secondary" href="/api/v1/library-export">
          <DownloadSimple size={17} />
          Export Library Data
        </a>
      </header>
      <div className="library-workspace-controls">
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">All</option>
            <option value="READING">Reading</option>
            <option value="COMPLETED">Completed</option>
            <option value="PLANNING">Plan to read</option>
            <option value="ON_HOLD">On hold</option>
            <option value="DROPPED">Dropped</option>
            <option value="UNREAD">Unread updates</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="ACTIVITY">Recently read</option>
            <option value="ADDED">Recently added</option>
            <option value="TITLE">Title</option>
            <option value="LATEST">Latest update</option>
            <option value="PROGRESS">Reading progress</option>
          </select>
        </label>
        <div className="library-view-switcher" aria-label="Library view mode">
          {modes.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              key={value}
              aria-label={label}
              title={label}
              aria-pressed={mode === value}
              onClick={() => void chooseMode(value)}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="library-workspace-state" role="status">
          Loading your library…
        </div>
      ) : error ? (
        <div className="library-workspace-state" role="alert">
          <strong>Library unavailable</strong>
          <span>{error}</span>
          <button type="button" onClick={() => window.location.reload()}>
            <ArrowClockwise size={16} /> Try again
          </button>
        </div>
      ) : visibleRecords.length ? (
        <div className={`library-records is-${mode}`}>
          {visibleRecords.map((record) => (
            <article className="library-record" key={record.seriesId}>
              <a className="library-record-cover" href={`/title/${record.slug}`}>
                {record.coverUrl ? (
                  <img
                    src={record.coverUrl}
                    alt={`Cover art for ${record.title}`}
                    loading="lazy"
                    width={240}
                    height={360}
                    onError={(event) => {
                      const fallback = "/art/series-cover-placeholder.svg";
                      if (!event.currentTarget.src.endsWith(fallback)) {
                        event.currentTarget.src = fallback;
                      }
                    }}
                  />
                ) : (
                  <span className="library-cover-placeholder">
                    {record.title.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </a>
              <div className="library-record-copy">
                <a href={`/title/${record.slug}`}>
                  <h3>{record.title}</h3>
                </a>
                <p>
                  {record.lastReadChapter
                    ? `Last read: Chapter ${record.lastReadChapter}`
                    : "Not started"}
                </p>
                <span>
                  {record.latestChapter
                    ? `Latest: Chapter ${record.latestChapter}`
                    : "No published chapters"}
                </span>
                <span>{relativeDate(record.lastActivity)}</span>
                <div
                  className="library-record-progress"
                  aria-label={`${Math.round(record.progress)} percent read`}
                >
                  <i style={{ width: `${Math.min(100, record.progress)}%` }} />
                </div>
              </div>
              <span className="library-record-status">
                {record.unreadCount > 0
                  ? `${record.unreadCount} unread`
                  : record.listType.replaceAll("_", " ").toLowerCase()}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <div className="library-workspace-state">
          <strong>No matching series</strong>
          <span>Try another status or browse the catalogue.</span>
          <a href="/browse">Browse series</a>
        </div>
      )}
    </section>
  );
}
