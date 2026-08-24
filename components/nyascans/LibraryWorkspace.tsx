"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowClockwise,
  CheckCircle,
  DownloadSimple,
  GridFour,
  ListBullets,
  Rows,
  SpinnerGap,
  UploadSimple,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readingProgressTone } from "@/lib/reading-progress";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";

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
  chaptersRead: number;
  chaptersTotal: number;
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

type LibraryOption = { value: string; label: string };

function LibraryDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: LibraryOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="library-dropdown-field">
      <span>{label}</span>
      <UnifiedSingleSelect
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </UnifiedSingleSelect>
    </label>
  );
}

const libraryStatusOptions: LibraryOption[] = [
  { value: "ALL", label: "All" },
  { value: "READING", label: "Reading" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PLANNING", label: "Plan to read" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "DROPPED", label: "Dropped" },
  { value: "UNREAD", label: "Unread updates" },
];

const librarySortOptions: LibraryOption[] = [
  { value: "ACTIVITY", label: "Recently read" },
  { value: "ADDED", label: "Recently added" },
  { value: "TITLE", label: "Title" },
  { value: "LATEST", label: "Latest update" },
  { value: "PROGRESS", label: "Reading progress" },
];

export function LibraryWorkspace() {
  const [records, setRecords] = useState<LibraryRecord[]>([]);
  const [mode, setMode] = useState<LibraryMode>("cover");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState("ACTIVITY");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

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

  async function importLibrary(file?: File) {
    if (!file || importing) return;
    if (file.size > 5_000_000) {
      setImportMessage("Choose a NyaScans library export smaller than 5 MB.");
      return;
    }
    setImporting(true);
    setImportMessage("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const response = await fetch("/api/v1/library-import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const payload = (await response.json()) as {
        imported?: { series?: number; progress?: number };
        skipped?: number;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Library data could not be imported.",
        );
      }
      setImportMessage(
        `Imported ${Number(payload.imported?.series ?? 0)} series and ${Number(
          payload.imported?.progress ?? 0,
        )} progress records${
          Number(payload.skipped ?? 0)
            ? ` · ${Number(payload.skipped)} unmatched`
            : ""
        }. Refreshing…`,
      );
      window.setTimeout(() => window.location.reload(), 650);
    } catch (importError) {
      setImportMessage(
        importError instanceof SyntaxError
          ? "This file is not valid JSON."
          : importError instanceof Error
            ? importError.message
            : "Library data could not be imported.",
      );
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
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
        <div className="library-data-actions">
          <a className="button button-secondary" href="/api/v1/library-export">
            <DownloadSimple size={17} />
            Export Library Data
          </a>
          <button
            className="button button-secondary"
            type="button"
            disabled={importing}
            onClick={() => importInput.current?.click()}
          >
            {importing ? (
              <SpinnerGap className="spin" size={17} />
            ) : (
              <UploadSimple size={17} />
            )}
            {importing ? "Importing…" : "Import Library Data"}
          </button>
          <input
            ref={importInput}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            onChange={(event) =>
              void importLibrary(event.target.files?.[0])
            }
          />
        </div>
      </header>
      {importMessage ? (
        <p
          className="library-import-message"
          role="status"
        >
          {!importMessage.toLowerCase().includes("could not") &&
          !importMessage.toLowerCase().includes("not valid") &&
          !importMessage.toLowerCase().includes("smaller") ? (
            <CheckCircle size={17} weight="fill" />
          ) : null}
          {importMessage}
        </p>
      ) : null}
      <div className="library-workspace-controls">
        <LibraryDropdown
          label="Status"
          value={status}
          options={libraryStatusOptions}
          onChange={setStatus}
        />
        <LibraryDropdown
          label="Sort"
          value={sort}
          options={librarySortOptions}
          onChange={setSort}
        />
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
                <span className="library-record-chapter-count">
                  {record.chaptersRead}/{record.chaptersTotal} chapters read
                </span>
                <span className="library-record-activity">
                  {relativeDate(record.lastActivity)}
                </span>
                <div
                  className="library-record-progress"
                  data-progress-tone={readingProgressTone(record.progress)}
                  role="progressbar"
                  aria-label={`${record.title} reading progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(record.progress)}
                  aria-valuetext={`${record.chaptersRead} of ${record.chaptersTotal} chapters read`}
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
