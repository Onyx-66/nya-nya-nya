"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Books,
  Check,
  CheckCircle,
  Clock,
  CloudArrowUp,
  FileImage,
  FileText,
  FolderOpen,
  Gauge,
  Info,
  ListChecks,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import {
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  detectBatchChapter,
  naturalCompare,
  normalizeUploadPath,
  UPLOAD_LIMITS,
  type ClientUploadMethod,
  type SupportedUploadMethod,
  uploadStatusLabel,
} from "@/lib/uploads";
import { extractZipPages } from "@/lib/client/archive-import";
import {
  AddSeriesRequestPanel,
  SeriesRequestsPanel,
} from "@/components/nyascans/upload/SeriesRequestWorkspace";
import { ConfirmActionDialog } from "@/components/nyascans/admin/AdminPageScaffold";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";

type UploadMode =
  | "dashboard"
  | "add-series"
  | "series-requests"
  | "series"
  | "single"
  | "multi"
  | "drafts"
  | "history"
  | "review-status"
  | "rights"
  | "rules";

type UploadTeamOption = {
  id: string;
  slug: string;
  name: string;
  revision: number;
  logoUrl: string | null;
  bannerUrl: string | null;
  membershipRole: string;
  canPublish: boolean;
  requiresReview: boolean;
  canControlFixedReaderPages: boolean;
};

type UploadOptions = {
  series: Array<{
    id: string;
    slug: string;
    title: string;
    coverUrl?: string | null;
    teamId?: string;
    teamName?: string;
    canPublish?: number;
    uploadRequiresReview?: number;
    allowedLanguagesJson?: string;
  }>;
  teams: UploadTeamOption[];
  methods: Array<{
    id: string;
    label: string;
    supported: boolean;
    reason: string;
  }>;
  limits: typeof UPLOAD_LIMITS;
  admin: boolean;
};

type UploadFileRecord = {
  id: string;
  itemId: string;
  filename: string;
  sourcePath: string;
  contentType: string;
  byteSize: number;
  pageIndex: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  status: string;
  validationJson: string;
  retryCount: number;
};

type UploadItem = {
  id: string;
  clientKey: string;
  sourceLabel: string;
  seriesId: string;
  teamId: string | null;
  chapterId: string | null;
  replacementChapterId: string | null;
  thumbnailKey?: string | null;
  thumbnailUrl?: string | null;
  volume: string | null;
  chapterNumber: string;
  title: string;
  language: string;
  version: number;
  releaseNotes: string;
  credits: Credits;
  accessType: "FREE" | "PAID";
  priceOnyx: number;
  visibility: "PUBLIC" | "UNLISTED" | "HIDDEN";
  scheduledAt: string | null;
  commentsEnabled: boolean;
  includeFixedFirstPage: boolean;
  includeFixedLastPage: boolean;
  status: string;
  pageCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  revision: number;
  files: UploadFileRecord[];
};

type UploadJob = {
  id: string;
  kind: "SINGLE" | "BATCH";
  sourceType: SupportedUploadMethod;
  status: string;
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  teamId: string | null;
  teamName: string | null;
  uploaderName: string;
  totalBytes: number;
  pageCount: number;
  chapterCount?: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string;
  items?: UploadItem[];
};

const PAGE_PREVIEW_LIMIT = 30;
const DROP_MAX_DEPTH = 12;
const DROP_MAX_FILES =
  UPLOAD_LIMITS.maxPagesPerChapter * UPLOAD_LIMITS.maxChaptersPerJob;
const DROP_MAX_ENTRIES =
  DROP_MAX_FILES + UPLOAD_LIMITS.maxChaptersPerJob * DROP_MAX_DEPTH;

type UploadListResponse = {
  data: UploadJob[];
  summary: Record<string, number>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
};

type Credits = {
  translator: string;
  cleaner: string;
  redrawer: string;
  typesetter: string;
  proofreader: string;
  qualityControl: string;
};

type ComposerItem = {
  clientKey: string;
  sourceLabel: string;
  volume: string;
  chapterNumber: string;
  title: string;
  language: string;
  version: number;
  releaseNotes: string;
  credits: Credits;
  accessType: "FREE" | "PAID";
  priceOnyx: number;
  visibility: "PUBLIC" | "UNLISTED" | "HIDDEN";
  scheduledAt: string;
  commentsEnabled: boolean;
  includeFixedFirstPage: boolean;
  includeFixedLastPage: boolean;
  replacementChapterId: string | null;
};

type LocalPage = {
  id: string;
  file: File;
  path: string;
  group: string;
  previewUrl: string;
};

type DroppedFileEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (
    success: (file: File) => void,
    failure?: (error: DOMException) => void,
  ) => void;
  createReader?: () => {
    readEntries(
      success: (entries: DroppedFileEntry[]) => void,
      failure?: (error: DOMException) => void,
    ): void;
  };
};

type UploadSourceFile = File & {
  uploadBatchGroup?: string;
};

type DropTraversalState = {
  entries: number;
  files: number;
  totalBytes: number;
};

type ApiFailure = {
  error?: {
    code?: string;
    message?: string;
    fields?: Array<{ message?: string }>;
    details?: Record<string, unknown> | null;
  };
};

class UploadApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

const emptyCredits: Credits = {
  translator: "",
  cleaner: "",
  redrawer: "",
  typesetter: "",
  proofreader: "",
  qualityControl: "",
};

function newComposerItem(
  chapterNumber = "1",
  sourceLabel = "Chapter 1",
): ComposerItem {
  return {
    clientKey: crypto.randomUUID(),
    sourceLabel,
    volume: "",
    chapterNumber,
    title: "",
    language: "en",
    version: 1,
    releaseNotes: "",
    credits: { ...emptyCredits },
    accessType: "FREE",
    priceOnyx: 0,
    visibility: "PUBLIC",
    scheduledAt: "",
    commentsEnabled: true,
    includeFixedFirstPage: true,
    includeFixedLastPage: true,
    replacementChapterId: null,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiFailure;
  if (!response.ok) {
    throw new UploadApiError(
      payload.error?.fields?.[0]?.message ??
        payload.error?.message ??
        "The upload request failed.",
      payload.error?.code ?? "UPLOAD_REQUEST_FAILED",
      payload.error?.details ?? null,
    );
  }
  return payload;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function normalizedPaidPrice(value: number) {
  return Number.isFinite(value)
    ? Math.min(100_000, Math.max(1, Math.round(value)))
    : 1;
}

function batchDirectoryParts(value: string) {
  const normalized = normalizeUploadPath(value);
  if (!normalized) return [];
  const parts = normalized.split("/");
  parts.pop();
  return parts;
}

function looksLikeChapterFolder(value: string) {
  return /^(?:(?:ch(?:apter)?|episode|ep)[\s._#-]*\d+(?:\.\d+)?(?:[a-z])?(?:[\s._-]+.*)?|(?:vol(?:ume)?[\s._#-]*)?\d+(?:\.\d+)?(?:[a-z])?(?:[\s._-]+.*)?|(?:prologue|epilogue|one[\s._-]*shot|special)(?:[\s._-]+.*)?)$/iu.test(
    value.normalize("NFKC").trim(),
  );
}

function batchContainerRoots(files: File[]) {
  const roots = new Map<
    string,
    { hasDirectPage: boolean; children: Set<string> }
  >();
  for (const file of files) {
    if ((file as UploadSourceFile).uploadBatchGroup) continue;
    const directories = batchDirectoryParts(
      file.webkitRelativePath || file.name,
    );
    if (!directories.length) continue;
    const root = directories[0]!;
    const record = roots.get(root) ?? {
      hasDirectPage: false,
      children: new Set<string>(),
    };
    if (directories.length === 1) {
      record.hasDirectPage = true;
    } else {
      record.children.add(directories[1]!);
    }
    roots.set(root, record);
  }
  return new Set(
    [...roots.entries()]
      .filter(
        ([, record]) =>
          !record.hasDirectPage &&
          record.children.size > 0 &&
          [...record.children].every(looksLikeChapterFolder),
      )
      .map(([root]) => root),
  );
}

function batchGroupForPath(value: string, containerRoots: Set<string>) {
  const directories = batchDirectoryParts(value);
  if (!directories.length) return "Chapter 1";
  const root = directories[0]!;
  if (containerRoots.has(root) && directories.length > 1) {
    return directories[1]!;
  }
  return root;
}

function fileWithRelativePath(
  file: File,
  relativePath: string,
  batchGroup?: string,
) {
  if (relativePath && file.webkitRelativePath !== relativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: relativePath,
    });
  }
  if (batchGroup) {
    Object.defineProperty(file, "uploadBatchGroup", {
      configurable: true,
      value: batchGroup,
    });
  }
  return file;
}

async function droppedEntryFiles(
  entry: DroppedFileEntry,
  state: DropTraversalState,
  parentPath = "",
  depth = 0,
  counted = false,
): Promise<File[]> {
  if (depth > DROP_MAX_DEPTH) {
    throw new Error(
      `Dropped folders may be nested no more than ${DROP_MAX_DEPTH} levels deep.`,
    );
  }
  if (!counted) {
    state.entries += 1;
    if (state.entries > DROP_MAX_ENTRIES) {
      throw new Error("The dropped folder contains too many nested entries.");
    }
  }
  const nextPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile && entry.file) {
    return new Promise<File[]>((resolve, reject) => {
      entry.file!(
        (file) => {
          state.files += 1;
          state.totalBytes += file.size;
          if (state.files > DROP_MAX_FILES) {
            reject(new Error("The dropped selection contains too many pages."));
            return;
          }
          if (state.totalBytes > UPLOAD_LIMITS.maxJobBytes) {
            reject(new Error("The dropped selection exceeds the 7 GB job limit."));
            return;
          }
          resolve([fileWithRelativePath(file, nextPath)]);
        },
        reject,
      );
    });
  }
  if (!entry.isDirectory || !entry.createReader) return [];
  const reader = entry.createReader();
  const children: DroppedFileEntry[] = [];
  while (true) {
    const batch = await new Promise<DroppedFileEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    if (state.entries + batch.length > DROP_MAX_ENTRIES) {
      throw new Error("The dropped folder contains too many nested entries.");
    }
    state.entries += batch.length;
    children.push(...batch);
  }
  const files: File[] = [];
  for (const child of children) {
    files.push(
      ...(await droppedEntryFiles(child, state, nextPath, depth + 1, true)),
    );
  }
  return files;
}

function isDroppedFileEntry(value: unknown): value is DroppedFileEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DroppedFileEntry>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.isFile === "boolean" &&
    typeof candidate.isDirectory === "boolean"
  );
}

async function filesFromDrop(dataTransfer: DataTransfer) {
  const state: DropTraversalState = {
    entries: 0,
    files: 0,
    totalBytes: 0,
  };
  const files: File[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    const withEntry = item as unknown as {
      webkitGetAsEntry?: () => unknown;
      getAsFile?: () => File | null;
    };
    const entry = withEntry.webkitGetAsEntry?.() ?? null;
    if (isDroppedFileEntry(entry)) {
      files.push(...(await droppedEntryFiles(entry, state)));
      continue;
    }
    const file = withEntry.getAsFile?.() ?? null;
    if (!file) continue;
    state.files += 1;
    state.totalBytes += file.size;
    if (state.files > DROP_MAX_FILES) {
      throw new Error("The dropped selection contains too many pages.");
    }
    if (state.totalBytes > UPLOAD_LIMITS.maxJobBytes) {
      throw new Error("The dropped selection exceeds the 7 GB job limit.");
    }
    files.push(file);
  }
  if (files.length) return files;
  const fallback = Array.from(dataTransfer.files);
  if (fallback.length > DROP_MAX_FILES) {
    throw new Error("The dropped selection contains too many pages.");
  }
  if (
    fallback.reduce((total, file) => total + file.size, 0) >
    UPLOAD_LIMITS.maxJobBytes
  ) {
    throw new Error("The dropped selection exceeds the 7 GB job limit.");
  }
  return fallback;
}

function routeFor(mode: UploadMode) {
  if (typeof window === "undefined") return `/upload-chapter/${mode}`;
  if (window.location.pathname.startsWith("/onyx/admin/access")) {
    return `/onyx/admin/access/upload-center/${mode}`;
  }
  if (window.location.pathname.startsWith("/dashboard")) {
    return `/dashboard/upload-center/${mode}`;
  }
  return `/upload-chapter/${mode}`;
}

function chapterManagementRoute(seriesId: string, chapterId: string) {
  const base =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/onyx/admin/access")
      ? "/onyx/admin/access"
      : "/dashboard";
  return `${base}/series/${encodeURIComponent(seriesId)}/chapters/${encodeURIComponent(chapterId)}`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`upload-status upload-status-${status.toLowerCase()}`}>
      {uploadStatusLabel(status)}
    </span>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="upload-empty">
      <CloudArrowUp size={30} />
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

function JobList({
  jobs,
  emptyTitle,
  emptyBody,
  onRefresh,
}: {
  jobs: UploadJob[];
  emptyTitle: string;
  emptyBody: string;
  onRefresh(): void;
}) {
  if (!jobs.length) {
    return (
      <EmptyState
        title={emptyTitle}
        body={emptyBody}
        action={
          <a className="button button-primary" href={routeFor("single")}>
            Upload a chapter
          </a>
        }
      />
    );
  }
  return (
    <div className="upload-job-list">
      {jobs.map((job) => (
        <article key={job.id}>
          <span className="upload-job-kind">
            {job.kind === "BATCH" ? <ListChecks size={20} /> : <FileImage size={20} />}
          </span>
          <div>
            <strong>{job.seriesTitle}</strong>
            <small>
              {job.teamName ?? "Platform release"} · {job.chapterCount ?? job.items?.length ?? 1}{" "}
              chapter{(job.chapterCount ?? job.items?.length ?? 1) === 1 ? "" : "s"} ·{" "}
              {job.pageCount} pages
            </small>
            {job.lastErrorMessage ? <em>{job.lastErrorMessage}</em> : null}
          </div>
          <StatusBadge status={job.status} />
          <time dateTime={job.updatedAt}>
            {new Date(job.updatedAt).toLocaleString()}
          </time>
          {["DRAFT", "UPLOADING", "READY", "FAILED"].includes(job.status) ? (
            <a
              className="button button-secondary"
              href={`${routeFor(job.kind === "BATCH" ? "multi" : "single")}?job=${encodeURIComponent(job.id)}`}
            >
              Resume <ArrowRight size={16} />
            </a>
          ) : job.items?.[0]?.chapterId ? (
            <a
              className="button button-secondary"
              href={chapterManagementRoute(
                job.seriesId,
                job.items[0].chapterId,
              )}
            >
              Manage
            </a>
          ) : (
            <button className="button button-secondary" type="button" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function UploadDashboard({
  jobs,
  summary,
  canUpload,
  canRequestSeries,
}: {
  jobs: UploadJob[];
  summary: Record<string, number>;
  canUpload: boolean;
  canRequestSeries: boolean;
}) {
  const attention = jobs.filter((job) =>
    ["FAILED", "REJECTED"].includes(job.status),
  );
  return (
    <section>
      <header className="upload-section-heading">
        <div>
          <span>Publishing operations</span>
          <h2>Upload Center dashboard</h2>
          <p>Real drafts, review states, failures, and releases for your current scope.</p>
        </div>
      </header>
      {canUpload ? (
        <div className="upload-metric-grid">
          {([
            ["Drafts", summary.DRAFT ?? 0, FileText],
            ["Ready", summary.READY ?? 0, CheckCircle],
            ["Pending review", summary.PENDING_REVIEW ?? 0, Clock],
            ["Published", summary.PUBLISHED ?? 0, CloudArrowUp],
          ] as Array<[string, number, PhosphorIcon]>).map(([label, value, Icon]) => (
            <article key={String(label)}>
              <Icon size={22} />
              <span>{String(label)}</span>
              <strong>{Number(value).toLocaleString()}</strong>
            </article>
          ))}
        </div>
      ) : null}
      <div className="upload-primary-actions">
        {canRequestSeries ? (
          <a href={routeFor("add-series")}>
            <Plus size={20} /> <strong>Create new series</strong>
            <span>Save a draft, then submit it for administrator approval.</span>
          </a>
        ) : null}
        {canUpload ? (
          <>
            <a href={routeFor("single")}>
              <FileImage size={20} /> <strong>Upload one chapter</strong>
              <span>Validate and preview an ordered release.</span>
            </a>
            <a href={routeFor("multi")}>
              <FolderOpen size={20} /> <strong>Upload a batch</strong>
              <span>
                Review up to {UPLOAD_LIMITS.maxChaptersPerJob} chapter folders
                before publishing.
              </span>
            </a>
          </>
        ) : null}
      </div>
      {canUpload && attention.length ? (
        <section className="upload-attention">
          <div className="upload-section-heading">
            <div>
              <span>Action required</span>
              <h3>Failed or returned uploads</h3>
            </div>
          </div>
          <JobList
            jobs={attention}
            emptyTitle=""
            emptyBody=""
            onRefresh={() => window.location.reload()}
          />
        </section>
      ) : null}
      {canUpload ? <section>
        <div className="upload-section-heading">
          <div>
            <span>Latest activity</span>
            <h3>Recent uploads</h3>
          </div>
          <a href={routeFor("history")}>View all <ArrowRight size={16} /></a>
        </div>
        <JobList
          jobs={jobs.slice(0, 6)}
          emptyTitle="No upload activity yet"
          emptyBody="Choose any public series and one of your verified publishing teams."
          onRefresh={() => window.location.reload()}
        />
      </section> : null}
    </section>
  );
}

function ChapterMetadataFields({
  item,
  onChange,
  compact = false,
  showCommerce = true,
  duplicateInvalid = false,
  thumbnailFile = null,
  thumbnailUrl = null,
  onThumbnailChange,
  coinName = "Paw Coin",
  disabled = false,
  showFixedPageChoices = false,
}: {
  item: ComposerItem;
  onChange(next: ComposerItem): void;
  compact?: boolean;
  showCommerce?: boolean;
  duplicateInvalid?: boolean;
  thumbnailFile?: File | null;
  thumbnailUrl?: string | null;
  onThumbnailChange?(file: File | null): void;
  coinName?: string;
  disabled?: boolean;
  showFixedPageChoices?: boolean;
}) {
  return (
    <div
      className={compact ? "upload-batch-fields" : "upload-form-grid"}
      data-upload-item={item.clientKey}
    >
      <label>
        <span>Volume</span>
        <input
          disabled={disabled}
          value={item.volume}
          maxLength={40}
          onChange={(event) => onChange({ ...item, volume: event.target.value })}
        />
      </label>
      <label>
        <span>Chapter number</span>
        <input
          disabled={disabled}
          value={item.chapterNumber}
          maxLength={40}
          required
          aria-invalid={duplicateInvalid || undefined}
          aria-describedby={
            duplicateInvalid
              ? `duplicate-chapter-${item.clientKey}`
              : undefined
          }
          onChange={(event) =>
            onChange({ ...item, chapterNumber: event.target.value })
          }
        />
        {duplicateInvalid ? (
          <small id={`duplicate-chapter-${item.clientKey}`}>
            Choose a different chapter number before continuing.
          </small>
        ) : null}
      </label>
      <label>
        <span>Chapter title</span>
        <input
          disabled={disabled}
          value={item.title}
          maxLength={240}
          onChange={(event) => onChange({ ...item, title: event.target.value })}
        />
      </label>
      <label>
        <span>Language</span>
        <input
          disabled={disabled}
          value={item.language}
          pattern="[a-z]{2,3}(?:-[a-z0-9]{2,8})?"
          required
          onChange={(event) =>
            onChange({ ...item, language: event.target.value.toLowerCase() })
          }
        />
      </label>
      <label>
        <span>Version</span>
        <input
          disabled={disabled}
          type="number"
          min="1"
          max="99"
          value={item.version}
          onChange={(event) =>
            onChange({
              ...item,
              version: Math.min(99, Math.max(1, Number(event.target.value))),
            })
          }
        />
      </label>
      {showCommerce ? (
        <>
          <label>
            <span>Availability</span>
            <select
              disabled={disabled}
              value={item.accessType}
              onChange={(event) =>
                onChange({
                  ...item,
                  accessType: event.target.value as "FREE" | "PAID",
                  priceOnyx:
                    event.target.value === "FREE"
                      ? 0
                      : Math.max(1, item.priceOnyx),
                })
              }
            >
              <option value="FREE">Free</option>
              <option value="PAID">Paid</option>
            </select>
          </label>
          <label>
            <span>{coinName} price</span>
            <input
              type="number"
              min="1"
              max="100000"
              disabled={disabled || item.accessType !== "PAID"}
              value={item.accessType === "PAID" ? item.priceOnyx : 0}
              onChange={(event) =>
                onChange({
                  ...item,
                  priceOnyx: Math.max(1, Number(event.target.value)),
                })
              }
            />
          </label>
        </>
      ) : null}
      <label>
        <span>Visibility</span>
        <select
          disabled={disabled}
          value={item.visibility}
          onChange={(event) =>
            onChange({
              ...item,
              visibility: event.target.value as ComposerItem["visibility"],
            })
          }
        >
          <option value="PUBLIC">Public</option>
          <option value="UNLISTED">Unlisted</option>
          <option value="HIDDEN">Hidden</option>
        </select>
      </label>
      <label>
        <span>Schedule</span>
        <input
          disabled={disabled}
          type="datetime-local"
          value={item.scheduledAt}
          onChange={(event) =>
            onChange({ ...item, scheduledAt: event.target.value })
          }
        />
      </label>
      {showFixedPageChoices ? (
        <fieldset className="upload-fixed-page-options upload-field-wide">
          <legend>Reader intro and outro</legend>
          <p>Choose whether the site-wide release pages appear around this chapter.</p>
          <label>
            <input
              type="checkbox"
              disabled={disabled}
              checked={item.includeFixedFirstPage}
              onChange={(event) => onChange({ ...item, includeFixedFirstPage: event.target.checked })}
            />
            <span><strong>Add first page</strong><small>Enabled by default</small></span>
          </label>
          <label>
            <input
              type="checkbox"
              disabled={disabled}
              checked={item.includeFixedLastPage}
              onChange={(event) => onChange({ ...item, includeFixedLastPage: event.target.checked })}
            />
            <span><strong>Add last page</strong><small>Enabled by default</small></span>
          </label>
        </fieldset>
      ) : null}
      {!compact ? (
        <>
          <label className="upload-field-wide">
            <span>Release notes</span>
            <textarea
              disabled={disabled}
              rows={3}
              maxLength={2000}
              value={item.releaseNotes}
              onChange={(event) =>
                onChange({ ...item, releaseNotes: event.target.value })
              }
            />
          </label>
          <details className="upload-field-wide upload-credits">
            <summary>Release credits</summary>
            <div>
              {[
                ["translator", "Translator"],
                ["cleaner", "Cleaner"],
                ["redrawer", "Redrawer"],
                ["typesetter", "Typesetter"],
                ["proofreader", "Proofreader"],
                ["qualityControl", "Quality control"],
              ].map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    disabled={disabled}
                    value={item.credits[key as keyof Credits]}
                    onChange={(event) =>
                      onChange({
                        ...item,
                        credits: { ...item.credits, [key]: event.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
        </>
      ) : null}
      {onThumbnailChange ? (
        <section
          className="upload-field-wide upload-thumbnail-field upload-thumbnail-card"
          aria-label="Chapter thumbnail"
          data-thumbnail-state={thumbnailFile || thumbnailUrl ? "selected" : "empty"}
        >
          <div className="upload-thumbnail-control">
            <AdminMediaField
              busy={disabled}
              label="Chapter thumbnail"
              helperText="Optional square artwork used in chapter cards and release previews."
              recommendedDimensions="Square · 600 × 600"
              currentUrl={thumbnailUrl}
              file={thumbnailFile}
              accept="image/jpeg,image/png,image/webp"
              cropProfile={{
                aspect: 1,
                outputWidth: 600,
                outputHeight: 600,
                maxBytes: 900_000,
              }}
              onSelect={onThumbnailChange}
              onRemove={() => onThumbnailChange(null)}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

const teamOptionCardStyle: CSSProperties = {
  gridTemplateColumns: "minmax(0, 1fr)",
  alignItems: "stretch",
  gap: 0,
  padding: 0,
  overflow: "hidden",
};

const teamOptionBannerStyle: CSSProperties = {
  display: "block",
  width: "100%",
  aspectRatio: "16 / 9",
  overflow: "hidden",
};

const teamOptionImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

function publishingMembershipLabel(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function publishingTeamInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "NY";
}

function PublishingTeamVisual({
  team,
  selected,
  accessDescriptionId,
}: {
  team: UploadTeamOption | null;
  selected: boolean;
  accessDescriptionId: string;
}) {
  const independent = team === null;
  const canPublish = independent || team.canPublish;
  const requiresReview = !independent && team.requiresReview;
  const name = team?.name ?? "Platform / independent";

  return (
    <>
      <span
        className={`upload-team-option-banner${team?.bannerUrl ? " has-image" : " is-placeholder"}`}
        style={teamOptionBannerStyle}
        aria-hidden="true"
      >
        {team?.bannerUrl ? (
          <img
            src={team.bannerUrl}
            alt=""
            loading="lazy"
            style={teamOptionImageStyle}
          />
        ) : (
          <span
            className="upload-team-option-banner-placeholder"
            style={{
              display: "grid",
              width: "100%",
              height: "100%",
              placeItems: "center",
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, var(--surface-2)), var(--bg-soft))",
            }}
          >
            <ShieldCheck size={34} weight="duotone" />
          </span>
        )}
      </span>
      <span
        className="upload-team-option-content"
        style={{
          display: "grid",
          minWidth: 0,
          gridTemplateColumns: "54px minmax(0, 1fr) 28px",
          alignItems: "center",
          gap: 12,
          marginTop: -27,
          padding: "0 14px 14px",
          position: "relative",
        }}
      >
        <span
          className="upload-team-option-logo"
          aria-hidden="true"
          style={{
            display: "grid",
            width: 54,
            height: 54,
            placeItems: "center",
            overflow: "hidden",
            border: "3px solid var(--surface-2)",
            borderRadius: "50%",
            background: "var(--surface)",
          }}
        >
          {team?.logoUrl ? (
            <img
              src={team.logoUrl}
              alt=""
              loading="lazy"
              style={teamOptionImageStyle}
            />
          ) : independent ? (
            <CloudArrowUp size={23} weight="duotone" />
          ) : (
            <span>{publishingTeamInitials(name)}</span>
          )}
        </span>
        <span
          className="upload-team-option-copy"
          style={{
            display: "grid",
            minWidth: 0,
            gap: 3,
            paddingTop: 30,
          }}
        >
          <strong>{name}</strong>
          <small>
            {team
              ? `@${team.slug} · ${publishingMembershipLabel(team.membershipRole)}`
              : "Administrator release without team attribution"}
          </small>
          <span
            id={accessDescriptionId}
            className={`upload-team-option-access ${canPublish ? "is-direct" : "is-review"}`}
            style={{
              width: "fit-content",
              maxWidth: "100%",
              marginTop: 4,
              color: canPublish ? "var(--accent)" : "var(--warning)",
              fontSize: 11,
              fontWeight: 750,
            }}
          >
            {canPublish
              ? "Direct publishing access"
              : requiresReview
                ? "Submission requires review"
                : "Publishing access unavailable"}
          </span>
        </span>
        <span
          className="upload-team-option-check"
          aria-hidden="true"
          style={{ marginTop: 30 }}
        >
          {selected ? <Check size={16} weight="bold" /> : null}
        </span>
      </span>
    </>
  );
}

function BatchTeamStep({
  teams,
  selectedTeamId,
  onSelect,
  onContinue,
}: {
  teams: UploadOptions["teams"];
  selectedTeamId: string;
  onSelect(teamId: string): void;
  onContinue(): void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const visibleTeams = teams.filter((team) =>
    `${team.name} ${team.slug} ${team.membershipRole}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  return (
    <section className="upload-team-step" aria-labelledby="upload-team-step-title">
      <div className="upload-team-step-copy">
        <span>Step 1 of 2</span>
        <h3 id="upload-team-step-title">Choose your publishing team</h3>
        <p>
          Every chapter in this batch will be attributed to the verified team
          you select here.
        </p>
      </div>
      <label className="upload-team-search">
        <MagnifyingGlass size={19} />
        <span className="sr-only">Search verified teams</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search verified teams"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {visibleTeams.length ? (
        <div
          className="upload-team-options"
          role="radiogroup"
          aria-label="Verified publishing teams"
        >
          {visibleTeams.map((team) => {
            const selected = team.id === selectedTeamId;
            return (
              <label
                className={`upload-team-option-card${selected ? " is-selected" : ""}`}
                key={team.id}
                style={teamOptionCardStyle}
              >
                <input
                  className="upload-team-native-radio"
                  type="radio"
                  name="batch-publishing-team"
                  value={team.id}
                  checked={selected}
                  aria-describedby={`batch-team-access-${team.id}`}
                  onChange={() => onSelect(team.id)}
                />
                <PublishingTeamVisual
                  team={team}
                  selected={selected}
                  accessDescriptionId={`batch-team-access-${team.id}`}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <div className="upload-empty upload-team-empty">
          <ShieldCheck size={26} />
          <strong>No verified team found</strong>
          <p>
            Only active uploaders from verified publishing teams can create a
            multi-chapter batch.
          </p>
        </div>
      )}
      <div className="upload-team-step-actions">
        <a className="button button-secondary" href={routeFor("dashboard")}>
          <ArrowLeft size={17} /> Back
        </a>
        <button
          type="button"
          className="button button-primary"
          disabled={!selectedTeamId}
          onClick={onContinue}
        >
          Continue to upload <ArrowRight size={17} />
        </button>
      </div>
    </section>
  );
}

function SingleTeamChooser({
  teams,
  selectedTeamId,
  allowIndependent,
  disabled,
  onSelect,
}: {
  teams: UploadOptions["teams"];
  selectedTeamId: string;
  allowIndependent: boolean;
  disabled: boolean;
  onSelect(teamId: string): void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTeams = teams.filter((team) =>
    `${team.name} ${team.slug} ${team.membershipRole}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
  const independentVisible =
    allowIndependent &&
    (!normalizedQuery ||
      "platform independent administrator"
        .toLowerCase()
        .includes(normalizedQuery));

  return (
    <section
      className="upload-field-wide upload-single-team-chooser"
      aria-labelledby="single-publishing-team-title"
    >
      <div className="upload-single-team-heading">
        <div>
          <strong id="single-publishing-team-title">Publishing team</strong>
          <small>
            Choose the verified team that will own this chapter release.
          </small>
        </div>
        <span>{teams.length} eligible</span>
      </div>
      {teams.length > 3 ? (
        <label className="upload-team-search upload-single-team-search">
          <MagnifyingGlass size={19} />
          <span className="sr-only">Search your eligible publishing teams</span>
          <input
            type="search"
            value={query}
            placeholder="Search your teams"
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}
      {independentVisible || visibleTeams.length ? (
        <div
          className="upload-team-options upload-team-options-compact"
          role="radiogroup"
          aria-labelledby="single-publishing-team-title"
        >
          {independentVisible ? (
            <label
              className={`upload-team-option-card upload-team-option-independent${selectedTeamId ? "" : " is-selected"}`}
              style={teamOptionCardStyle}
            >
              <input
                className="upload-team-native-radio"
                type="radio"
                name="single-publishing-team"
                value=""
                checked={!selectedTeamId}
                disabled={disabled}
                aria-describedby="single-team-access-independent"
                onChange={() => onSelect("")}
              />
              <PublishingTeamVisual
                team={null}
                selected={!selectedTeamId}
                accessDescriptionId="single-team-access-independent"
              />
            </label>
          ) : null}
          {visibleTeams.map((team) => {
            const selected = team.id === selectedTeamId;
            return (
              <label
                className={`upload-team-option-card${selected ? " is-selected" : ""}`}
                key={team.id}
                style={teamOptionCardStyle}
              >
                <input
                  className="upload-team-native-radio"
                  type="radio"
                  name="single-publishing-team"
                  value={team.id}
                  checked={selected}
                  disabled={disabled}
                  aria-describedby={`single-team-access-${team.id}`}
                  onChange={() => onSelect(team.id)}
                />
                <PublishingTeamVisual
                  team={team}
                  selected={selected}
                  accessDescriptionId={`single-team-access-${team.id}`}
                />
              </label>
            );
          })}
        </div>
      ) : (
        <div className="upload-empty upload-team-empty">
          <ShieldCheck size={26} />
          <strong>No eligible publishing team found</strong>
          <p>Try another search or ask a team leader to review your access.</p>
        </div>
      )}
    </section>
  );
}

function UploadComposer({
  kind,
  options,
}: {
  kind: "SINGLE" | "BATCH";
  options: UploadOptions;
}) {
  const { settings: commercial, loaded: commercialLoaded } =
    useCommercialSettings();
  const initialQuery =
    typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const resumeJobId = initialQuery.get("job") ?? "";
  const requestedSeries = initialQuery.get("series");
  const initialSeries =
    requestedSeries &&
    options.series.some((entry) => entry.id === requestedSeries)
      ? requestedSeries
      : options.series[0]?.id ?? "";
  const requestedTeam = initialQuery.get("team");
  const requestedTeamIsValid = Boolean(
    requestedTeam && options.teams.some((team) => team.id === requestedTeam),
  );
  const initialTeam =
    (requestedTeamIsValid ? requestedTeam : null) ??
    (kind === "SINGLE"
      ? options.series.find((entry) => entry.id === initialSeries)?.teamId ??
        options.teams[0]?.id
      : "") ??
    "";
  const [seriesId, setSeriesId] = useState(initialSeries);
  const [teamId, setTeamId] = useState(initialTeam);
  const [teamStepComplete, setTeamStepComplete] = useState(
    kind === "SINGLE",
  );
  const [resumeLoading, setResumeLoading] = useState(Boolean(resumeJobId));
  const [resumeFailed, setResumeFailed] = useState(false);
  const [ingestMethod, setIngestMethod] = useState<ClientUploadMethod>(
    kind === "BATCH" ? "DIRECT_FOLDER" : "DIRECT_IMAGES",
  );
  const sourceType: SupportedUploadMethod =
    ingestMethod === "ZIP"
      ? kind === "BATCH"
        ? "DIRECT_FOLDER"
        : "DIRECT_IMAGES"
      : ingestMethod;
  const [items, setItems] = useState<ComposerItem[]>([newComposerItem()]);
  const [localPages, setLocalPages] = useState<LocalPage[]>([]);
  const [batchPaidEnabled, setBatchPaidEnabled] = useState(false);
  const [batchPaidPrice, setBatchPaidPrice] = useState(1);
  const [batchVisibility, setBatchVisibility] =
    useState<ComposerItem["visibility"]>("PUBLIC");
  const [dropActive, setDropActive] = useState(false);
  const [composerDirty, setComposerDirty] = useState(!resumeJobId);
  const [thumbnailFiles, setThumbnailFiles] = useState<Record<string, File | null>>({});
  const [thumbnailRemovals, setThumbnailRemovals] = useState<Set<string>>(
    () => new Set(),
  );
  const [job, setJob] = useState<UploadJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [draggedId, setDraggedId] = useState("");
  const [duplicateRejectedKey, setDuplicateRejectedKey] = useState("");
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    clientKey: string;
    existingChapterId: string;
    chapterNumber: string;
  } | null>(null);
  const [activePreviewGroup, setActivePreviewGroup] = useState("");
  const [previewOffsets, setPreviewOffsets] = useState<Record<string, number>>(
    {},
  );
  const folderRef = useRef<HTMLInputElement | null>(null);
  const archiveRef = useRef<HTMLInputElement | null>(null);
  const batchContextRef = useRef<HTMLFormElement | null>(null);
  const localPagesRef = useRef<LocalPage[]>([]);
  const createIntentKeyRef = useRef(crypto.randomUUID());
  const publishIntentKeyRef = useRef(crypto.randomUUID());
  const persistingRef = useRef(false);
  const revealingInvalidRef = useRef(false);

  useEffect(() => {
    if (!folderRef.current) return;
    if (
      kind === "BATCH" ||
      (ingestMethod !== "ZIP" && ingestMethod === "DIRECT_FOLDER")
    ) {
      folderRef.current.setAttribute("webkitdirectory", "");
      folderRef.current.setAttribute("directory", "");
    } else {
      folderRef.current.removeAttribute("webkitdirectory");
      folderRef.current.removeAttribute("directory");
    }
  }, [ingestMethod, kind]);

  useEffect(() => {
    if (!resumeJobId || !commercialLoaded) return;
    let cancelled = false;
    void fetch(`/api/v1/upload-jobs?jobId=${encodeURIComponent(resumeJobId)}`, {
      cache: "no-store",
    })
      .then((response) => readJson<{ data: UploadJob }>(response))
      .then((payload) => {
        if (cancelled) return;
        setResumeFailed(false);
        if (payload.data.kind !== kind) {
          throw new Error(
            `This is a ${payload.data.kind.toLowerCase()} upload, not a ${kind.toLowerCase()} upload.`,
          );
        }
        const resumedTeamIsEligible = payload.data.teamId
          ? options.teams.some((team) => team.id === payload.data.teamId)
          : options.admin && kind === "SINGLE";
        if (!resumedTeamIsEligible) {
          throw new Error(
            "This draft no longer belongs to one of your active verified publishing teams.",
          );
        }
        setJob(payload.data);
        setSeriesId(payload.data.seriesId);
        setTeamId(payload.data.teamId ?? "");
        setTeamStepComplete(true);
        setIngestMethod(payload.data.sourceType);
        const resumedCanControlFixedPages = Boolean(
          options.teams.find((team) => team.id === payload.data.teamId)
            ?.canControlFixedReaderPages,
        );
        const nextItems = (payload.data.items ?? []).map((item) => ({
            clientKey: item.clientKey,
            sourceLabel: item.sourceLabel,
            volume: item.volume ?? "",
            chapterNumber: item.chapterNumber,
            title: item.title,
            language: item.language,
            version: item.version,
            releaseNotes: item.releaseNotes,
            credits: { ...emptyCredits, ...item.credits },
            accessType: item.accessType,
            priceOnyx: item.priceOnyx,
            visibility: item.visibility,
            scheduledAt: item.scheduledAt
              ? new Date(item.scheduledAt).toISOString().slice(0, 16)
              : "",
            commentsEnabled: true,
            includeFixedFirstPage: resumedCanControlFixedPages
              ? (item.includeFixedFirstPage ?? true)
              : true,
            includeFixedLastPage: resumedCanControlFixedPages
              ? (item.includeFixedLastPage ?? true)
              : true,
            replacementChapterId: item.replacementChapterId ?? null,
          }));
        const firstPaidItem = nextItems.find(
          (item) => item.accessType === "PAID",
        );
        const resumedPaidPrices = new Set(
          nextItems
            .filter((item) => item.accessType === "PAID")
            .map((item) => item.priceOnyx),
        );
        const resumedPrice = normalizedPaidPrice(firstPaidItem?.priceOnyx ?? 1);
        const premiumAllowed = commercial.economy.premiumEconomyPublic;
        const priceNeedsCleanup = resumedPaidPrices.size > 1;
        const privacyNeedsCleanup = Boolean(firstPaidItem) && !premiumAllowed;
        const visibleItems = premiumAllowed
          ? nextItems
          : nextItems.map((item) => ({
              ...item,
              accessType: "FREE" as const,
              priceOnyx: 0,
            }));
        setBatchPaidEnabled(premiumAllowed && Boolean(firstPaidItem));
        setBatchPaidPrice(resumedPrice);
        setBatchVisibility(visibleItems[0]?.visibility ?? "PUBLIC");
        setItems(visibleItems);
        setComposerDirty(priceNeedsCleanup || privacyNeedsCleanup);
        if (priceNeedsCleanup) {
          setError(
            "This legacy draft contains different paid prices. Choose one batch price and save the queue before publishing.",
          );
        } else if (privacyNeedsCleanup) {
          setError(
            "Paid access is currently private. This draft was changed to free access and must be saved before publishing.",
          );
        }
      })
      .catch((loadError) => {
        if (cancelled) return;
        setResumeFailed(true);
        setTeamStepComplete(false);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The upload draft could not be resumed.",
        );
      })
      .finally(() => {
        if (!cancelled) setResumeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    commercial.economy.premiumEconomyPublic,
    commercialLoaded,
    kind,
    options.admin,
    options.teams,
    resumeJobId,
  ]);

  useEffect(() => {
    localPagesRef.current = localPages;
  }, [localPages]);

  useEffect(
    () => () =>
      localPagesRef.current.forEach((page) =>
        URL.revokeObjectURL(page.previewUrl),
      ),
    [],
  );

  function markComposerDirty() {
    if (busy || persistingRef.current) return;
    setComposerDirty(true);
    setConfirmed(false);
  }

  function updateItem(clientKey: string, next: ComposerItem) {
    if (busy || persistingRef.current) return;
    const previous = items.find((entry) => entry.clientKey === clientKey);
    const identityChanged =
      previous?.chapterNumber !== next.chapterNumber ||
      previous?.language !== next.language ||
      previous?.version !== next.version;
    setItems((current) =>
      current.map((entry) => {
        if (entry.clientKey !== clientKey) return entry;
        const itemIdentityChanged =
          entry.chapterNumber !== next.chapterNumber ||
          entry.language !== next.language ||
          entry.version !== next.version;
        return itemIdentityChanged
          ? { ...next, replacementChapterId: null }
          : next;
      }),
    );
    markComposerDirty();
    if (duplicateRejectedKey === clientKey && identityChanged) {
      setDuplicateRejectedKey("");
      setError("");
    }
  }

  function changeBatchPaidEnabled(enabled: boolean) {
    if (busy || persistingRef.current) return;
    setBatchPaidEnabled(enabled);
    markComposerDirty();
    if (!enabled) {
      setItems((current) =>
        current.map((item) => ({
          ...item,
          accessType: "FREE",
          priceOnyx: 0,
        })),
      );
    }
  }

  function changeBatchPaidPrice(value: number) {
    if (busy || persistingRef.current) return;
    const nextPrice = normalizedPaidPrice(value);
    setBatchPaidPrice(nextPrice);
    markComposerDirty();
    setItems((current) =>
      current.map((item) =>
        item.accessType === "PAID"
          ? { ...item, priceOnyx: nextPrice }
          : item,
      ),
    );
  }

  function changeBatchItemPaid(clientKey: string, enabled: boolean) {
    if (busy || persistingRef.current) return;
    markComposerDirty();
    setItems((current) =>
      current.map((item) =>
        item.clientKey === clientKey
          ? {
              ...item,
              accessType: enabled ? "PAID" : "FREE",
              priceOnyx: enabled ? batchPaidPrice : 0,
            }
          : item,
      ),
    );
  }

  function changeBatchVisibility(visibility: ComposerItem["visibility"]) {
    if (busy || persistingRef.current) return;
    setBatchVisibility(visibility);
    markComposerDirty();
    setItems((current) =>
      current.map((item) => ({ ...item, visibility })),
    );
  }

  function continueToBatchUpload() {
    setTeamStepComplete(true);
    window.requestAnimationFrame(() => {
      const firstSelect = batchContextRef.current?.querySelector(
        ".upload-quick-settings select",
      );
      if (firstSelect instanceof HTMLSelectElement) firstSelect.focus();
    });
  }

  function revealInvalidField(event: FormEvent<HTMLFormElement>) {
    if (revealingInvalidRef.current) return;
    const field = event.target;
    if (!(field instanceof HTMLElement)) return;
    revealingInvalidRef.current = true;
    const disclosure = field.closest("details");
    if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
    window.requestAnimationFrame(() => {
      field.focus();
      revealingInvalidRef.current = false;
    });
  }

  function changeThumbnail(clientKey: string, file: File | null) {
    if (busy || persistingRef.current) return;
    markComposerDirty();
    setThumbnailFiles((current) => ({ ...current, [clientKey]: file }));
    setThumbnailRemovals((current) => {
      const next = new Set(current);
      if (file) {
        next.delete(clientKey);
      } else if (
        job?.items?.find((item) => item.clientKey === clientKey)?.thumbnailUrl
      ) {
        next.add(clientKey);
      } else {
        next.delete(clientKey);
      }
      return next;
    });
  }

  function choosePages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter(
      (file) => file.size > 0,
    );
    event.currentTarget.value = "";
    if (busy || persistingRef.current) return;
    setMessage("");
    if (ingestFiles(files)) {
      setMessage(
        `${files.length.toLocaleString()} page${files.length === 1 ? "" : "s"} added to the private queue.`,
      );
    }
  }

  function ingestFiles(files: File[]) {
    setError("");
    if (!files.length) return false;
    if (files.some((file) => file.size > UPLOAD_LIMITS.maxPageBytes)) {
      setError("Every page must be 25 MB or smaller.");
      return false;
    }
    const containerRoots =
      kind === "BATCH" ? batchContainerRoots(files) : new Set<string>();
    const prepared = files
      .map((file) => {
        const rawPath = file.webkitRelativePath || file.name;
        const path = normalizeUploadPath(rawPath);
        const explicitGroup = (file as UploadSourceFile).uploadBatchGroup;
        const group =
          kind === "BATCH"
            ? explicitGroup || batchGroupForPath(rawPath, containerRoots)
            : items[0]!.sourceLabel;
        if (!path || !group) return null;
        return {
          id: crypto.randomUUID(),
          file,
          path,
          group,
        };
      })
      .filter(
        (
          page,
        ): page is {
          id: string;
          file: File;
          path: string;
          group: string;
        } => Boolean(page),
      );
    if (prepared.length !== files.length) {
      setError(
        "One or more source paths are hidden, unsafe, or longer than 500 characters.",
      );
      return false;
    }
    const selectedPathSet = new Set<string>();
    const duplicatePath = prepared.find((page) => {
      const key = page.path.toLocaleLowerCase();
      if (selectedPathSet.has(key)) return true;
      selectedPathSet.add(key);
      return false;
    });
    if (duplicatePath) {
      setError(
        `Two selected sources resolve to ${duplicatePath.path}. Rename one source folder or archive before adding it.`,
      );
      return false;
    }
    const prospectiveLocal = new Map(
      localPages.map((page) => [
        page.path.toLocaleLowerCase(),
        { group: page.group, bytes: page.file.size },
      ]),
    );
    prepared.forEach((page) =>
      prospectiveLocal.set(page.path.toLocaleLowerCase(), {
        group: page.group,
        bytes: page.file.size,
      }),
    );
    const prospectiveLocalBytes = [...prospectiveLocal.values()].reduce(
      (total, page) => total + page.bytes,
      0,
    );
    const replacedStoredBytes = (job?.items ?? []).reduce(
      (total, storedItem) =>
        total +
        storedItem.files.reduce((itemTotal, page) => {
          const storedPath = normalizeUploadPath(page.sourcePath);
          const local = storedPath
            ? prospectiveLocal.get(storedPath.toLocaleLowerCase())
            : undefined;
          return (
            page.status === "READY" &&
            local &&
            local.group === storedItem.sourceLabel
          )
            ? itemTotal + Number(page.byteSize)
            : itemTotal;
        }, 0),
      0,
    );
    if (
      Math.max(0, Number(job?.totalBytes ?? 0) - replacedStoredBytes) +
        prospectiveLocalBytes >
      UPLOAD_LIMITS.maxJobBytes
    ) {
      setError("This upload queue exceeds the 7 GB job limit.");
      return false;
    }
    const chapterTotals = new Map<string, { pages: number; bytes: number }>();
    for (const page of prospectiveLocal.values()) {
      const total = chapterTotals.get(page.group) ?? { pages: 0, bytes: 0 };
      total.pages += 1;
      total.bytes += page.bytes;
      chapterTotals.set(page.group, total);
    }
    for (const storedItem of job?.items ?? []) {
      const total = chapterTotals.get(storedItem.sourceLabel) ?? {
        pages: 0,
        bytes: 0,
      };
      for (const page of storedItem.files) {
        const storedPath = normalizeUploadPath(page.sourcePath);
        const local = storedPath
          ? prospectiveLocal.get(storedPath.toLocaleLowerCase())
          : undefined;
        if (local && local.group === storedItem.sourceLabel) continue;
        total.pages += 1;
        total.bytes += Number(page.byteSize);
      }
      chapterTotals.set(storedItem.sourceLabel, total);
    }
    const oversizedChapter = [...chapterTotals.entries()].find(
      ([, total]) =>
        total.pages > UPLOAD_LIMITS.maxPagesPerChapter ||
        total.bytes > UPLOAD_LIMITS.maxChapterBytes,
    );
    if (oversizedChapter) {
      setError(
        `${oversizedChapter[0]} exceeds the ${UPLOAD_LIMITS.maxPagesPerChapter}-page or 250 MB chapter limit.`,
      );
      return false;
    }
    if (kind === "BATCH") {
      const groups = [...new Set(prepared.map((page) => page.group))];
      const existingItems =
        !job &&
        localPages.length === 0 &&
        items.length === 1 &&
        items[0]?.sourceLabel === "Chapter 1"
          ? []
          : items;
      const allGroups = [
        ...new Set([
          ...existingItems.map((item) => item.sourceLabel),
          ...groups,
        ]),
      ];
      if (allGroups.length > UPLOAD_LIMITS.maxChaptersPerJob) {
        setError(
          `Select no more than ${UPLOAD_LIMITS.maxChaptersPerJob} chapter folders.`,
        );
        return false;
      }
      if (job) {
        const knownGroups = new Set(items.map((item) => item.sourceLabel));
        const unknownGroup = groups.find((group) => !knownGroups.has(group));
        if (unknownGroup) {
          setError(
            `${unknownGroup} is not part of this saved batch. Add pages inside one of the existing chapter folders.`,
          );
          return false;
        }
      } else {
        const existingByGroup = new Map(
          existingItems.map((item) => [item.sourceLabel, item]),
        );
        const detected = allGroups.map((group, index) => {
          const existing = existingByGroup.get(group);
          if (existing) return existing;
          const metadata = detectBatchChapter(group, index + 1);
          return {
            ...newComposerItem(metadata.chapterNumber, metadata.sourceLabel),
            volume: metadata.volume,
            title: metadata.title,
            visibility: batchVisibility,
          };
        });
        setItems(detected);
      }
    }
    const selected = prepared.map((page) => ({
      ...page,
      previewUrl: URL.createObjectURL(page.file),
    }));
    const merged = new Map(
      localPages.map((page) => [page.path.toLocaleLowerCase(), page]),
    );
    const replaced: LocalPage[] = [];
    for (const page of selected) {
      const key = page.path.toLocaleLowerCase();
      const previous = merged.get(key);
      if (previous) replaced.push(previous);
      merged.set(key, page);
    }
    replaced.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    setLocalPages(
      [...merged.values()].sort((left, right) =>
        naturalCompare(left.path, right.path),
      ),
    );
    setComposerDirty(true);
    setConfirmed(false);
    return true;
  }

  async function extractArchives(archives: File[]) {
    const extracted: File[] = [];
    let extractedBytes = 0;
    const usedLabels = new Set(
      items
        .filter(
          (item) =>
            Boolean(job) ||
            item.sourceLabel !== "Chapter 1" ||
            localPages.some((page) => page.group === item.sourceLabel),
        )
        .map((item) => item.sourceLabel.normalize("NFKC").toLowerCase()),
    );
    if (
      kind === "BATCH" &&
      archives.length + usedLabels.size > UPLOAD_LIMITS.maxChaptersPerJob
    ) {
      throw new Error(
        `Select no more than ${UPLOAD_LIMITS.maxChaptersPerJob} chapter archives per queue.`,
      );
    }
    for (const archive of archives) {
      const pages = await extractZipPages(archive, kind);
      const archiveBytes = pages.reduce(
        (total, page) => total + page.file.size,
        0,
      );
      if (
        extracted.length + pages.length >
        UPLOAD_LIMITS.maxPagesPerChapter * UPLOAD_LIMITS.maxChaptersPerJob
      ) {
        throw new Error("The extracted archive selection contains too many pages.");
      }
      if (
        extractedBytes + archiveBytes + Number(job?.totalBytes ?? 0) >
        UPLOAD_LIMITS.maxJobBytes
      ) {
        throw new Error("The extracted archive selection exceeds the 7 GB job limit.");
      }
      extractedBytes += archiveBytes;
      const archivePath = archive.webkitRelativePath || archive.name;
      const baseLabel = archivePath
        .replace(/\.(?:zip|cbz)$/i, "")
        .replaceAll("\\", " · ")
        .replaceAll("/", " · ")
        .trim();
      let archiveLabel = baseLabel || "Chapter";
      let suffix = 2;
      while (usedLabels.has(archiveLabel.normalize("NFKC").toLowerCase())) {
        archiveLabel = `${baseLabel || "Chapter"} (${suffix})`;
        suffix += 1;
      }
      usedLabels.add(archiveLabel.normalize("NFKC").toLowerCase());
      for (const page of pages) {
        const cleanPath = page.path.replace(/^\/+/u, "");
        extracted.push(
          fileWithRelativePath(
            page.file,
            kind === "BATCH" ? `${archiveLabel}/${cleanPath}` : cleanPath,
            kind === "BATCH" ? archiveLabel : undefined,
          ),
        );
      }
    }
    return extracted;
  }

  async function chooseArchive(event: ChangeEvent<HTMLInputElement>) {
    const archives = Array.from(event.target.files ?? []).filter(
      (file) => file.size > 0,
    );
    event.currentTarget.value = "";
    if (!archives.length) return;
    setBusy(true);
    setError("");
    setMessage("Inspecting archive paths and extraction limits…");
    try {
      const extracted = await extractArchives(archives);
      if (ingestFiles(extracted)) {
        setMessage(
          `${extracted.length.toLocaleString()} verified image files extracted locally. Confirm metadata and ordering before upload.`,
        );
      } else {
        setMessage("");
      }
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "The ZIP / CBZ archive could not be imported.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  async function handleBatchDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropActive(false);
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("Inspecting dropped folders and archives…");
    try {
      const dropped = (await filesFromDrop(event.dataTransfer)).filter(
        (file) => file.size > 0,
      );
      const archives = dropped.filter((file) =>
        /\.(?:zip|cbz)$/i.test(file.name),
      );
      const images = dropped.filter(
        (file) =>
          /^image\/(?:jpeg|png|webp)$/i.test(file.type) ||
          /\.(?:jpe?g|png|webp)$/i.test(file.name),
      );
      const extracted = await extractArchives(archives);
      const accepted = [...images, ...extracted];
      if (!accepted.length) {
        throw new Error(
          "Drop ZIP / CBZ files or folders containing JPEG, PNG, or WebP pages.",
        );
      }
      if (ingestFiles(accepted)) {
        setMessage(
          `${accepted.length.toLocaleString()} pages added from ${archives.length.toLocaleString()} archive${archives.length === 1 ? "" : "s"} and folder selection.`,
        );
      } else {
        setMessage("");
      }
    } catch (dropError) {
      setError(
        dropError instanceof Error
          ? dropError.message
          : "The dropped upload batch could not be inspected.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  function clearLocalQueue() {
    if (busy || persistingRef.current) return;
    localPages.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    setLocalPages([]);
    if (!job) {
      setItems([
        {
          ...newComposerItem(),
          visibility: batchVisibility,
        },
      ]);
      setThumbnailFiles({});
      setThumbnailRemovals(new Set());
      setBatchPaidEnabled(false);
    }
    markComposerDirty();
    setMessage(
      job
        ? "The new local selection was cleared. Saved draft pages were preserved."
        : "Local upload queue cleared.",
    );
    setError("");
  }

  function localPagesFor(item: ComposerItem) {
    return localPages.filter(
      (page) => kind === "SINGLE" || page.group === item.sourceLabel,
    );
  }

  function moveLocal(pageId: string, direction: -1 | 1) {
    if (busy) return;
    markComposerDirty();
    setLocalPages((current) => {
      const index = current.findIndex((page) => page.id === pageId);
      const target = index + direction;
      if (
        index < 0 ||
        target < 0 ||
        target >= current.length ||
        current[index]!.group !== current[target]!.group
      ) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function dropLocal(targetId: string, event: DragEvent) {
    event.preventDefault();
    if (busy || !draggedId || draggedId === targetId) return;
    markComposerDirty();
    setLocalPages((current) => {
      const from = current.findIndex((page) => page.id === draggedId);
      const to = current.findIndex((page) => page.id === targetId);
      if (
        from < 0 ||
        to < 0 ||
        current[from]!.group !== current[to]!.group
      ) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
    setDraggedId("");
  }

  function removeLocalPage(pageId: string) {
    if (busy) return;
    markComposerDirty();
    setLocalPages((current) => {
      const target = current.find((entry) => entry.id === pageId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((entry) => entry.id !== pageId);
    });
  }

  function wireItem(item: ComposerItem) {
    return {
      ...item,
      scheduledAt: item.scheduledAt
        ? new Date(item.scheduledAt).toISOString()
        : null,
      priceOnyx: item.accessType === "PAID" ? item.priceOnyx : 0,
    };
  }

  async function refreshJob(jobId: string) {
    const payload = await readJson<{ data: UploadJob }>(
      await fetch(`/api/v1/upload-jobs?jobId=${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      }),
    );
    setJob(payload.data);
    return payload.data;
  }

  async function persistUpload(selectedItems: ComposerItem[] = items) {
    if (persistingRef.current) return;
    persistingRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (duplicateRejectedKey) {
        throw new Error(
          "Change the existing chapter number before saving this upload.",
        );
      }
      if (!seriesId) throw new Error("Choose a public series.");
      if ((kind === "BATCH" || !options.admin) && !teamId) {
        throw new Error("Choose your active team.");
      }
      let current = job;
      if (!current) {
        const created = await readJson<{ data: UploadJob }>(
          await fetch("/api/v1/upload-jobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              kind,
              sourceType,
              seriesId,
              teamId: teamId || null,
              idempotencyKey: createIntentKeyRef.current,
              items: selectedItems.map(wireItem),
            }),
          }),
        );
        current = created.data;
        setJob(current);
        window.history.replaceState(
          {},
          "",
          `${routeFor(kind === "BATCH" ? "multi" : "single")}?job=${encodeURIComponent(current.id)}`,
        );
      }
      if (!current) {
        throw new Error("The upload draft could not be initialized.");
      }
      if (job) {
        for (const item of selectedItems) {
          const stored = current.items?.find(
            (entry) => entry.clientKey === item.clientKey,
          );
          if (!stored) continue;
          const itemForMetadata =
            kind === "BATCH"
              ? {
                  ...item,
                  accessType: stored.accessType,
                  priceOnyx: stored.priceOnyx,
                }
              : item;
          const updated: { data: UploadJob } = await readJson<{
            data: UploadJob;
          }>(
            await fetch("/api/v1/upload-jobs", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "UPDATE_ITEM",
                jobId: current.id,
                itemId: stored.id,
                expectedRevision: stored.revision,
                item: wireItem(itemForMetadata),
              }),
            }),
          );
          current = updated.data;
          setJob(current);
        }
        if (kind === "BATCH") {
          const paidClientKeys = new Set(
            selectedItems
              .filter((item) => item.accessType === "PAID")
              .map((item) => item.clientKey),
          );
          const updated = await readJson<{ data: UploadJob }>(
            await fetch("/api/v1/upload-jobs", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "UPDATE_BATCH_COMMERCE",
                jobId: current.id,
                expectedRevision: current.revision,
                priceOnyx: batchPaidPrice,
                paidItemIds: (current.items ?? [])
                  .filter((item) => paidClientKeys.has(item.clientKey))
                  .map((item) => item.id),
              }),
            }),
          );
          current = updated.data;
          setJob(current);
        }
      }
      for (const clientKey of thumbnailRemovals) {
        const stored = current.items?.find(
          (entry) => entry.clientKey === clientKey,
        );
        if (!stored?.thumbnailUrl) continue;
        const removed = await readJson<{ job: { revision: number } }>(
          await fetch("/api/v1/upload-job-thumbnail", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jobId: current.id,
              itemId: stored.id,
              expectedRevision: current.revision,
            }),
          }),
        );
        current = { ...current, revision: removed.job.revision };
        current = await refreshJob(current.id);
        setThumbnailRemovals((pending) => {
          const next = new Set(pending);
          next.delete(clientKey);
          return next;
        });
      }
      for (const [clientKey, file] of Object.entries(thumbnailFiles)) {
        if (!file) continue;
        const stored = current.items?.find(
          (entry) => entry.clientKey === clientKey,
        );
        if (!stored) continue;
        const thumbnail = new FormData();
        thumbnail.set("jobId", current.id);
        thumbnail.set("itemId", stored.id);
        thumbnail.set("expectedRevision", String(current.revision));
        thumbnail.set("file", file);
        const uploaded = await readJson<{ job: { revision: number } }>(
          await fetch("/api/v1/upload-job-thumbnail", {
            method: "PUT",
            body: thumbnail,
          }),
        );
        current = {
          ...current,
          revision: uploaded.job.revision,
        };
        current = await refreshJob(current.id);
        setJob(current);
        setThumbnailFiles((files) => ({ ...files, [clientKey]: null }));
      }
      if (!localPages.length) {
        setComposerDirty(false);
        setMessage("Private upload draft saved. Add pages when ready.");
        return;
      }
      const priorFileIdsByClientKey = new Map(
        (current.items ?? []).map((item) => [
          item.clientKey,
          new Set(item.files.map((file) => file.id)),
        ]),
      );
      const totalPages = localPages.length;
      const successfulLocalPageIds = new Set<string>();
      setProgress({ done: 0, total: totalPages });
      for (const item of selectedItems) {
        const stored = current.items?.find(
          (entry) => entry.clientKey === item.clientKey,
        );
        if (!stored) continue;
        const pages = localPagesFor(item);
        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
          const page = pages[pageIndex]!;
          let attempt = 0;
          while (attempt < 3) {
            const activeStored = current.items?.find(
              (entry) => entry.clientKey === item.clientKey,
            );
            if (!activeStored) break;
            const committed = activeStored.files.find(
              (file) =>
                file.status === "READY" &&
                normalizeUploadPath(file.sourcePath) === page.path,
            );
            if (committed) {
              successfulLocalPageIds.add(page.id);
              break;
            }
            const form = new FormData();
            form.set("jobId", current.id);
            form.set("itemId", activeStored.id);
            form.set("expectedRevision", String(current.revision));
            form.set("sourcePath", page.path);
            const replaceFile = activeStored.files.find(
              (file) =>
                file.status !== "READY" &&
                normalizeUploadPath(file.sourcePath) === page.path,
            );
            if (replaceFile) form.set("replaceFileId", replaceFile.id);
            if (!activeStored.files.length) {
              form.set("pageIndex", String(pageIndex));
            }
            form.set("file", page.file);
            try {
              const uploaded = await readJson<{
                job: { revision: number; status: string };
              }>(
                await fetch("/api/v1/upload-job-files", {
                  method: "POST",
                  body: form,
                }),
              );
              current = {
                ...current,
                revision: uploaded.job.revision,
                status: uploaded.job.status,
              };
              successfulLocalPageIds.add(page.id);
              break;
            } catch (uploadError) {
              current = await refreshJob(current.id);
              const reconciled = current.items
                ?.find((entry) => entry.clientKey === item.clientKey)
                ?.files.some(
                  (file) =>
                    file.status === "READY" &&
                    normalizeUploadPath(file.sourcePath) === page.path,
                );
              if (reconciled) {
                successfulLocalPageIds.add(page.id);
                break;
              }
              attempt += 1;
              if (
                uploadError instanceof UploadApiError &&
                uploadError.code === "UPLOAD_RATE_LIMITED" &&
                attempt < 3
              ) {
                const retryAfter = Math.min(
                  3_600,
                  Math.max(
                    1,
                    Number(uploadError.details?.retryAfterSeconds ?? 61),
                  ),
                );
                if (retryAfter > 65) {
                  setError(
                    `${page.path}: upload pacing is active. This page remains selected; resume this private draft in about ${Math.ceil(retryAfter / 60)} minutes.`,
                  );
                  break;
                }
                setMessage(
                  `Upload pacing is active. ${page.path} will retry automatically in ${retryAfter} seconds.`,
                );
                await new Promise((resolve) =>
                  window.setTimeout(resolve, retryAfter * 1_000),
                );
                continue;
              }
              setError(
                uploadError instanceof Error
                  ? `${page.path}: ${uploadError.message}`
                  : `${page.path} failed validation.`,
              );
              break;
            }
          }
          setProgress((value) => ({ ...value, done: value.done + 1 }));
        }
      }
      current = await refreshJob(current.id);
      for (const item of current.items ?? []) {
        const priorIds =
          priorFileIdsByClientKey.get(item.clientKey) ?? new Set<string>();
        const ordered = item.files
          .filter((file) => priorIds.has(file.id))
          .sort((left, right) => left.pageIndex - right.pageIndex);
        const added = item.files
          .filter((file) => !priorIds.has(file.id))
          .sort((left, right) => {
            const pathOrder = naturalCompare(left.sourcePath, right.sourcePath);
            return pathOrder || left.pageIndex - right.pageIndex;
          });
        for (const file of added) {
          const insertAt = ordered.findIndex(
            (existing) =>
              naturalCompare(file.sourcePath, existing.sourcePath) < 0,
          );
          ordered.splice(insertAt < 0 ? ordered.length : insertAt, 0, file);
        }
        const needsNaturalReorder = ordered.some(
          (file, pageIndex) => file.pageIndex !== pageIndex,
        );
        if (!needsNaturalReorder || ordered.length === 0) continue;
        const activeJob = current;
        if (!activeJob) {
          throw new Error("The upload draft could not be refreshed.");
        }
        const reordered: { data: UploadJob } = await readJson<{
          data: UploadJob;
        }>(
          await fetch("/api/v1/upload-jobs", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "REORDER",
              jobId: activeJob.id,
              itemId: item.id,
              expectedRevision: activeJob.revision,
              fileIds: ordered.map((file) => file.id),
            }),
          }),
        );
        current = reordered.data;
        setJob(current);
      }
      setLocalPages((pages) => {
        const failedPages: LocalPage[] = [];
        pages.forEach((page) => {
          if (successfulLocalPageIds.has(page.id)) {
            URL.revokeObjectURL(page.previewUrl);
          } else {
            failedPages.push(page);
          }
        });
        return failedPages;
      });
      if (!current) {
        throw new Error("The upload draft could not be refreshed.");
      }
      const failedPageCount = totalPages - successfulLocalPageIds.size;
      setComposerDirty(failedPageCount > 0);
      setMessage(
        failedPageCount === 0 && current.status === "READY"
          ? "All pages are validated. Review the release summary before publishing."
          : `${successfulLocalPageIds.size.toLocaleString()} pages were preserved. ${failedPageCount.toLocaleString()} failed pages remain selected for retry.`,
      );
    } catch (saveError) {
      if (
        saveError instanceof UploadApiError &&
        saveError.code === "DUPLICATE_RELEASE" &&
        typeof saveError.details?.clientKey === "string" &&
        typeof saveError.details?.existingChapterId === "string"
      ) {
        setDuplicatePrompt({
          clientKey: saveError.details.clientKey,
          existingChapterId: saveError.details.existingChapterId,
          chapterNumber: String(saveError.details.chapterNumber ?? ""),
        });
        return;
      }
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The upload draft could not be saved.",
      );
    } finally {
      persistingRef.current = false;
      setBusy(false);
    }
  }

  function saveAndUpload(event: FormEvent) {
    event.preventDefault();
    if (duplicateRejectedKey) {
      setError("Change the existing chapter number before saving this upload.");
      return;
    }
    void persistUpload();
  }

  async function reorderServer(item: UploadItem, nextFiles: UploadFileRecord[]) {
    if (!job) return;
    setBusy(true);
    setConfirmed(false);
    setError("");
    try {
      const payload = await readJson<{ data: UploadJob }>(
        await fetch("/api/v1/upload-jobs", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "REORDER",
            jobId: job.id,
            itemId: item.id,
            expectedRevision: job.revision,
            fileIds: nextFiles.map((file) => file.id),
          }),
        }),
      );
      setJob(payload.data);
    } catch (reorderError) {
      setError(
        reorderError instanceof Error
          ? reorderError.message
          : "Pages could not be reordered.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeServerPage(item: UploadItem, file: UploadFileRecord) {
    if (!job || !window.confirm(`Remove ${file.filename} from this draft?`)) return;
    setBusy(true);
    setConfirmed(false);
    setError("");
    try {
      await readJson(
        await fetch("/api/v1/upload-job-files", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "DELETE",
            jobId: job.id,
            itemId: item.id,
            fileId: file.id,
            expectedRevision: job.revision,
          }),
        }),
      );
      await refreshJob(job.id);
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "The page could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!job || !confirmed) return;
    if (composerDirty || localPages.length) {
      setConfirmed(false);
      setError("Save and validate the latest queue changes before publishing.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = await readJson<{ data: UploadJob }>(
        await fetch("/api/v1/upload-jobs", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "PUBLISH",
            jobId: job.id,
            expectedRevision: job.revision,
            idempotencyKey: publishIntentKeyRef.current,
          }),
        }),
      );
      setJob(payload.data);
      publishIntentKeyRef.current = crypto.randomUUID();
      setConfirmed(false);
      setMessage(
        payload.data.status === "PENDING_REVIEW"
          ? "Release submitted to the chapter review queue."
          : payload.data.status === "SCHEDULED"
            ? "Release published with its scheduled visibility time."
            : "Release published successfully.",
      );
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "The release could not be published.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (
      !job ||
      !window.confirm(
        "Discard this draft and remove its temporary page objects? This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await readJson(
        await fetch("/api/v1/upload-jobs", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "DISCARD",
            jobId: job.id,
            expectedRevision: job.revision,
          }),
        }),
      );
      window.location.href = routeFor("drafts");
    } catch (discardError) {
      setError(
        discardError instanceof Error
          ? discardError.message
          : "The draft could not be discarded.",
      );
      setBusy(false);
    }
  }

  const eligibleSeries = useMemo(
    () =>
      options.series.filter(
        (entry, index, all) =>
          all.findIndex((candidate) => candidate.id === entry.id) === index,
      ),
    [options.series],
  );
  const selectedTeam = options.teams.find((team) => team.id === teamId) ?? null;
  function selectPublishingTeam(nextTeamId: string) {
    setTeamId(nextTeamId);
    const nextTeam = options.teams.find((team) => team.id === nextTeamId);
    if (!nextTeam?.canControlFixedReaderPages) {
      setItems((current) => current.map((item) => ({
        ...item,
        includeFixedFirstPage: true,
        includeFixedLastPage: true,
      })));
    }
  }
  const localQueueBytes = localPages.reduce(
    (total, page) => total + page.file.size,
    0,
  );
  const queuedPageCount = localPages.length + Number(job?.pageCount ?? 0);
  const queuedChapterCount = items.filter((item) => {
    const localCount = localPagesFor(item).length;
    const storedCount =
      job?.items?.find((stored) => stored.clientKey === item.clientKey)?.files
        .length ?? 0;
    return localCount + storedCount > 0;
  }).length;
  const hasQueuedPages = queuedPageCount > 0;

  return (
    <>
    <section className={`upload-workflow upload-workflow-${kind.toLowerCase()}`}>
      <header className="upload-section-heading">
        <div>
          <span>{kind === "BATCH" ? "Folder batch" : "One release"}</span>
          <h2>{kind === "BATCH" ? "Multi-chapter upload" : "Single chapter upload"}</h2>
          {kind === "BATCH" ? (
            <p>Prepare up to {UPLOAD_LIMITS.maxChaptersPerJob} chapter folders, then review every release before submission.</p>
          ) : null}
        </div>
        {job ? <StatusBadge status={job.status} /> : null}
      </header>
      {error ? (
        <SystemNoticeBridge message={error} kind="error" />
      ) : null}
      {message ? (
        <SystemNoticeBridge message={message} kind="success" />
      ) : null}
      {resumeLoading ? (
        <div className="upload-empty upload-resume-state" role="status">
          <SpinnerGap className="spin" size={28} />
          <strong>Loading your private upload draft</strong>
          <p>Restoring the saved team, chapters, pages, and access settings…</p>
        </div>
      ) : resumeFailed ? (
        <div className="upload-empty upload-resume-state" role="alert">
          <WarningCircle size={28} />
          <strong>This private draft could not be restored</strong>
          <p>
            Keep the error details above for support, or return to a safe upload
            starting point.
          </p>
          <div className="upload-team-step-actions">
            <a className="button button-secondary" href={routeFor("drafts")}>
              Back to drafts
            </a>
            <a
              className="button button-primary"
              href={routeFor(kind === "BATCH" ? "multi" : "single")}
            >
              Start a new upload
            </a>
          </div>
        </div>
      ) : kind === "BATCH" && !teamStepComplete ? (
        <BatchTeamStep
          teams={options.teams}
          selectedTeamId={teamId}
          onSelect={selectPublishingTeam}
          onContinue={continueToBatchUpload}
        />
      ) : (
        <>
      {kind === "SINGLE" ? (
        <div className="upload-single-overview">
          <FileImage size={28} />
          <div>
            <strong>Single-chapter studio</strong>
          </div>
          <span>250 MB chapter limit</span>
        </div>
      ) : (
        <div className="upload-batch-overview">
          <div>
            <FolderOpen size={25} />
            <strong>Folder-first batch</strong>
            <span>One subfolder becomes one editable chapter row.</span>
          </div>
          <dl>
            <div><dt>Maximum</dt><dd>{UPLOAD_LIMITS.maxChaptersPerJob} chapters</dd></div>
            <div><dt>Per chapter</dt><dd>250 MB</dd></div>
            <div><dt>Review</dt><dd>Row by row</dd></div>
          </dl>
        </div>
      )}
      <form
        ref={batchContextRef}
        className={`upload-composer upload-composer-${kind.toLowerCase()}`}
        onSubmit={saveAndUpload}
        onInvalid={revealInvalidField}
      >
        <section className="upload-composer-card">
          <div className="upload-card-heading">
            <span>{kind === "BATCH" ? "2" : "1"}</span>
            <div>
              <strong>{kind === "BATCH" ? "Quick upload settings" : "Release context"}</strong>
              <small>Public series and verified publishing team</small>
            </div>
          </div>
          {kind === "BATCH" ? (
            <div className="upload-quick-settings">
              <div className="upload-active-team">
                <span
                  className="upload-team-option-icon upload-active-team-logo"
                  style={{ overflow: "hidden" }}
                >
                  {selectedTeam?.logoUrl ? (
                    <img
                      src={selectedTeam.logoUrl}
                      alt=""
                      style={teamOptionImageStyle}
                    />
                  ) : (
                    <ShieldCheck size={21} weight="fill" />
                  )}
                </span>
                <span>
                  <small>Publishing team</small>
                  <strong>{selectedTeam?.name ?? "Verified team"}</strong>
                  {selectedTeam ? (
                    <small>
                      {selectedTeam.canPublish
                        ? "Direct publishing access"
                        : "Submission requires review"}
                    </small>
                  ) : null}
                </span>
                {!job ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => setTeamStepComplete(false)}
                  >
                    Change team
                  </button>
                ) : null}
              </div>
              <div className="upload-quick-grid">
                <label>
                  <span>Series</span>
                  <select
                    required
                    value={seriesId}
                    disabled={busy || Boolean(job)}
                    onChange={(event) => setSeriesId(event.target.value)}
                  >
                    {!eligibleSeries.length ? (
                      <option value="">No public series available</option>
                    ) : null}
                    {eligibleSeries.map((series) => (
                      <option value={series.id} key={series.id}>
                        {series.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Release visibility</span>
                  <select
                    value={batchVisibility}
                    disabled={busy}
                    onChange={(event) =>
                      changeBatchVisibility(
                        event.target.value as ComposerItem["visibility"],
                      )
                    }
                  >
                    <option value="PUBLIC">Public</option>
                    <option value="UNLISTED">Unlisted</option>
                    <option value="HIDDEN">Hidden</option>
                  </select>
                </label>
                <div className="upload-quick-format">
                  <span>Accepted sources</span>
                  <strong>ZIP / CBZ or folders</strong>
                  <small>Multiple sources can be combined in one queue.</small>
                </div>
              </div>
              {commercialLoaded &&
              commercial.economy.premiumEconomyPublic ? (
                <div className="upload-batch-paid-panel">
                <div>
                  <span className="upload-paid-icon" aria-hidden="true">
                    {commercial.economy.coinIconKey ? (
                      <img
                        src={`/api/v1/coin-icon?v=${commercial.economy.coinIconRevision}`}
                        alt=""
                      />
                    ) : (
                      <span>{commercial.economy.coinIcon}</span>
                    )}
                  </span>
                  <span>
                    <strong>Paid chapters</strong>
                    <small>
                      Set one price, then enable it only on the chapters you
                      want to lock.
                    </small>
                  </span>
                </div>
                <label className="upload-switch">
                  <input
                    type="checkbox"
                    checked={batchPaidEnabled}
                    disabled={busy}
                    onChange={(event) =>
                      changeBatchPaidEnabled(event.target.checked)
                    }
                  />
                  <span aria-hidden="true" />
                  <b>{batchPaidEnabled ? "Enabled" : "Disabled"}</b>
                </label>
                <label className="upload-batch-price">
                  <span>{commercial.economy.coinName} price</span>
                  <input
                    type="number"
                    min="1"
                    max="100000"
                    disabled={busy || !batchPaidEnabled}
                    value={batchPaidPrice}
                    onChange={(event) =>
                      changeBatchPaidPrice(Number(event.target.value))
                    }
                  />
                </label>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="upload-form-grid">
              <SingleTeamChooser
                teams={options.teams}
                selectedTeamId={teamId}
                allowIndependent={options.admin}
                disabled={busy || Boolean(job)}
                onSelect={selectPublishingTeam}
              />
              <label>
                <span>Series</span>
                <select
                  required
                  value={seriesId}
                  disabled={busy || Boolean(job)}
                  onChange={(event) => setSeriesId(event.target.value)}
                >
                  {!eligibleSeries.length ? (
                    <option value="">No public series available</option>
                  ) : null}
                  {eligibleSeries.map((series) => (
                    <option value={series.id} key={series.id}>
                      {series.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>File method</span>
                <select
                  value={ingestMethod}
                  disabled={busy || Boolean(job)}
                  onChange={(event) =>
                    setIngestMethod(event.target.value as ClientUploadMethod)
                  }
                >
                  <option value="DIRECT_IMAGES">Direct images</option>
                  <option value="DIRECT_FOLDER">Folder selection</option>
                  <option value="ZIP">ZIP / CBZ archive</option>
                </select>
              </label>
            </div>
          )}
        </section>
        {kind === "SINGLE" ? (
          <section className="upload-composer-card">
            <div className="upload-card-heading">
              <span>2</span>
              <div>
                <strong>Chapter metadata</strong>
                <small>Detection is a suggestion; confirm every chapter</small>
              </div>
            </div>
            <ChapterMetadataFields
              disabled={busy}
              coinName={commercial.economy.coinName}
              showCommerce={
                commercialLoaded &&
                commercial.economy.premiumEconomyPublic
              }
              item={items[0]!}
              showFixedPageChoices={Boolean(selectedTeam?.canControlFixedReaderPages)}
              duplicateInvalid={duplicateRejectedKey === items[0]!.clientKey}
              onChange={(next) => updateItem(items[0]!.clientKey, next)}
              thumbnailFile={thumbnailFiles[items[0]!.clientKey] ?? null}
              thumbnailUrl={job?.items?.[0]?.thumbnailUrl ?? null}
              onThumbnailChange={(file) =>
                changeThumbnail(items[0]!.clientKey, file)
              }
            />
          </section>
        ) : null}
        <section className="upload-composer-card">
          <div className="upload-card-heading">
            <span>3</span>
            <div><strong>Pages and ordering</strong><small>Natural order first, explicit order saved exactly</small></div>
          </div>
          {!job || ["DRAFT", "UPLOADING", "READY", "FAILED"].includes(job.status) ? (
            kind === "BATCH" ? (
              <div
                className={`upload-batch-dropzone${dropActive ? " is-dragging" : ""}`}
                aria-busy={busy}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (busy) return;
                  setDropActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (busy) return;
                  event.dataTransfer.dropEffect = "copy";
                  setDropActive(true);
                }}
                onDragLeave={(event) => {
                  if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                  ) {
                    setDropActive(false);
                  }
                }}
                onDrop={(event) => void handleBatchDrop(event)}
              >
                <span className="upload-batch-drop-icon">
                  <CloudArrowUp size={31} weight="duotone" />
                </span>
                <strong>
                  {job?.pageCount
                    ? "Add ZIPs or chapter folders to this saved queue"
                    : "Drag and drop ZIPs or folders"}
                </strong>
                <p>
                  Drop several sources together. Every top-level folder or
                  archive becomes an editable chapter in the queue.
                </p>
                <div className="upload-source-chips" aria-label="Supported sources">
                  <span>ZIP / CBZ</span>
                  <span>Folder</span>
                  <span>Multi-select</span>
                  <span>Queue ready</span>
                </div>
                <div className="upload-batch-drop-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => archiveRef.current?.click()}
                  >
                    <FileText size={18} /> Add ZIP files
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => folderRef.current?.click()}
                  >
                    <FolderOpen size={18} /> Add folders
                  </button>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={busy || !seriesId || !hasQueuedPages}
                  >
                    {busy ? (
                      <SpinnerGap className="spin" size={18} />
                    ) : (
                      <CloudArrowUp size={18} />
                    )}
                    Upload all
                  </button>
                  {localPages.length ? (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={clearLocalQueue}
                    >
                      <X size={17} />{" "}
                      {job ? "Clear new selection" : "Clear queue"}
                    </button>
                  ) : null}
                  {job ? (
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={busy}
                      onClick={() => void discard()}
                    >
                      <Trash size={17} /> Discard draft
                    </button>
                  ) : null}
                </div>
                <input
                  className="upload-native-file"
                  ref={archiveRef}
                  type="file"
                  tabIndex={-1}
                  aria-hidden="true"
                  disabled={busy}
                  multiple
                  accept=".zip,.cbz,application/zip,application/vnd.comicbook+zip"
                  onChange={chooseArchive}
                />
                <input
                  className="upload-native-file"
                  ref={folderRef}
                  type="file"
                  tabIndex={-1}
                  aria-hidden="true"
                  disabled={busy}
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={choosePages}
                />
                <dl className="upload-queue-summary">
                  <div>
                    <dt>Queued chapters</dt>
                    <dd>{queuedChapterCount}</dd>
                  </div>
                  <div>
                    <dt>Queued pages</dt>
                    <dd>{queuedPageCount.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>New selection</dt>
                    <dd>{formatBytes(localQueueBytes)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <label className="upload-dropzone">
                {ingestMethod === "ZIP" ? (
                  <FileText size={35} />
                ) : sourceType === "DIRECT_FOLDER" ? (
                  <FolderOpen size={35} />
                ) : (
                  <FileImage size={35} />
                )}
                <strong>
                  {job?.pageCount
                    ? "Add missing pages to this saved draft"
                    : ingestMethod === "ZIP"
                      ? "Choose the chapter ZIP / CBZ archive"
                      : sourceType === "DIRECT_FOLDER"
                        ? "Choose the chapter folder"
                        : "Choose ordered chapter images"}
                </strong>
                <span>
                  {ingestMethod === "ZIP"
                    ? "ZIP / CBZ is extracted locally with path, ratio, count, and byte safety limits"
                    : "Verified JPEG, PNG, or WebP · 25 MB per page · 250 MB per chapter"}
                  {job?.pageCount
                    ? " · existing validated pages stay in place"
                    : ""}
                </span>
                <span className="upload-file-cta">
                  {job?.pageCount
                    ? "Add pages"
                    : ingestMethod === "ZIP"
                      ? "Choose archive"
                      : sourceType === "DIRECT_FOLDER"
                        ? "Choose folder"
                        : "Choose files"}
                </span>
                <input
                  className="upload-native-file"
                  ref={folderRef}
                  type="file"
                  disabled={busy}
                  multiple={ingestMethod !== "ZIP"}
                  accept={
                    ingestMethod === "ZIP"
                      ? ".zip,.cbz,application/zip,application/vnd.comicbook+zip"
                      : "image/jpeg,image/png,image/webp"
                  }
                  onChange={
                    ingestMethod === "ZIP" ? chooseArchive : choosePages
                  }
                />
              </label>
            )
          ) : null}
          {localPages.length ? (
            <div className="upload-local-pages">
              {items.map((item) => {
                const itemPages = localPagesFor(item);
                if (!itemPages.length) return null;
                const previewKey = `local:${item.clientKey}`;
                const isOpen = activePreviewGroup === previewKey;
                const maxOffset =
                  Math.floor(
                    Math.max(0, itemPages.length - 1) / PAGE_PREVIEW_LIMIT,
                  ) * PAGE_PREVIEW_LIMIT;
                const offset = Math.min(
                  previewOffsets[previewKey] ?? 0,
                  maxOffset,
                );
                const visiblePages = itemPages.slice(
                  offset,
                  offset + PAGE_PREVIEW_LIMIT,
                );
                return (
                  <details
                    className="upload-page-disclosure"
                    key={item.clientKey}
                    open={isOpen}
                    onToggle={(event) => {
                      const nextOpen = event.currentTarget.open;
                      setActivePreviewGroup((current) =>
                        nextOpen
                          ? previewKey
                          : current === previewKey
                            ? ""
                            : current,
                      );
                    }}
                  >
                    <summary>
                      <span>{item.sourceLabel}</span>
                      <small>
                        {itemPages.length.toLocaleString()} selected pages
                      </small>
                    </summary>
                    {isOpen ? (
                      <>
                      <ol>
                      {visiblePages.map((page, index) => (
                        <li
                          key={page.id}
                          draggable={!busy}
                          onDragStart={() => {
                            if (!busy) setDraggedId(page.id);
                          }}
                          onDragOver={(event) => {
                            if (!busy) event.preventDefault();
                          }}
                          onDrop={(event) => dropLocal(page.id, event)}
                        >
                          <span>{offset + index + 1}</span>
                          <img src={page.previewUrl} alt="" loading="lazy" />
                          <div>
                            <strong>{page.path}</strong>
                            <small>{formatBytes(page.file.size)}</small>
                          </div>
                          <button
                            type="button"
                            disabled={busy || offset + index === 0}
                            aria-label="Move page up"
                            onClick={() => moveLocal(page.id, -1)}
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            type="button"
                            disabled={
                              busy ||
                              offset + index === itemPages.length - 1
                            }
                            aria-label="Move page down"
                            onClick={() => moveLocal(page.id, 1)}
                          >
                            <ArrowDown size={16} />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label="Remove selected page"
                            onClick={() => removeLocalPage(page.id)}
                          >
                            <X size={16} />
                          </button>
                        </li>
                      ))}
                      </ol>
                    {itemPages.length > PAGE_PREVIEW_LIMIT ? (
                      <nav
                        className="upload-page-pagination"
                        aria-label={`${item.sourceLabel} selected page preview`}
                      >
                        <button
                          type="button"
                          disabled={offset === 0}
                          onClick={() =>
                            setPreviewOffsets((current) => ({
                              ...current,
                              [previewKey]: Math.max(
                                0,
                                offset - PAGE_PREVIEW_LIMIT,
                              ),
                            }))
                          }
                        >
                          <ArrowLeft size={16} /> Previous
                        </button>
                        <span>
                          {offset + 1}–
                          {Math.min(
                            itemPages.length,
                            offset + PAGE_PREVIEW_LIMIT,
                          )}{" "}
                          of {itemPages.length.toLocaleString()}
                        </span>
                        <button
                          type="button"
                          disabled={
                            offset + PAGE_PREVIEW_LIMIT >= itemPages.length
                          }
                          onClick={() =>
                            setPreviewOffsets((current) => ({
                              ...current,
                              [previewKey]: Math.min(
                                maxOffset,
                                offset + PAGE_PREVIEW_LIMIT,
                              ),
                            }))
                          }
                        >
                          Next <ArrowRight size={16} />
                        </button>
                      </nav>
                    ) : null}
                      </>
                    ) : null}
                  </details>
                );
              })}
            </div>
          ) : null}
          {job?.items?.map((item) => {
            const ordered = [...item.files].sort(
              (left, right) => left.pageIndex - right.pageIndex,
            );
            const previewKey = `server:${item.id}`;
            const isOpen = activePreviewGroup === previewKey;
            const maxOffset =
              Math.floor(
                Math.max(0, ordered.length - 1) / PAGE_PREVIEW_LIMIT,
              ) * PAGE_PREVIEW_LIMIT;
            const offset = Math.min(
              previewOffsets[previewKey] ?? 0,
              maxOffset,
            );
            const visibleFiles = ordered.slice(
              offset,
              offset + PAGE_PREVIEW_LIMIT,
            );
            return (
              <details
                className="upload-server-pages upload-page-disclosure"
                key={item.id}
                open={isOpen}
                onToggle={(event) => {
                  const nextOpen = event.currentTarget.open;
                  setActivePreviewGroup((current) =>
                    nextOpen
                      ? previewKey
                      : current === previewKey
                        ? ""
                        : current,
                  );
                }}
              >
                <summary>
                  <span>{item.sourceLabel}</span>
                  <small>
                    {item.files.length.toLocaleString()} validated source
                    {item.files.length === 1 ? "" : "s"}
                  </small>
                </summary>
                {isOpen ? (
                  <>
                  <ol>
                  {visibleFiles.map((file, index) => (
                    <li key={file.id}>
                      <span>{offset + index + 1}</span>
                      {file.status === "READY" ? (
                        <img
                          src={`/api/v1/upload-page-preview?jobId=${encodeURIComponent(job.id)}&fileId=${encodeURIComponent(file.id)}`}
                          alt={`Page ${offset + index + 1}`}
                          loading="lazy"
                        />
                      ) : (
                        <WarningCircle size={24} />
                      )}
                      <div>
                        <strong>{file.sourcePath}</strong>
                        <small>
                          {file.status === "READY"
                            ? `${file.width}×${file.height} · ${formatBytes(file.byteSize)}`
                            : "Failed validation · reselect this page to replace it"}
                        </small>
                      </div>
                      {file.status === "READY" ? (
                        <>
                          <button
                            type="button"
                            disabled={busy || offset + index === 0}
                            aria-label="Move validated page up"
                            onClick={() => {
                              const next = [...ordered];
                              const absoluteIndex = offset + index;
                              [next[absoluteIndex - 1], next[absoluteIndex]] = [next[absoluteIndex]!, next[absoluteIndex - 1]!];
                              void reorderServer(item, next);
                            }}
                          ><ArrowUp size={16} /></button>
                          <button
                            type="button"
                            disabled={
                              busy ||
                              offset + index === ordered.length - 1
                            }
                            aria-label="Move validated page down"
                            onClick={() => {
                              const next = [...ordered];
                              const absoluteIndex = offset + index;
                              [next[absoluteIndex + 1], next[absoluteIndex]] = [next[absoluteIndex]!, next[absoluteIndex + 1]!];
                              void reorderServer(item, next);
                            }}
                          ><ArrowDown size={16} /></button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        aria-label="Remove page"
                        disabled={busy}
                        onClick={() => void removeServerPage(item, file)}
                      ><Trash size={16} /></button>
                    </li>
                  ))}
                  </ol>
                {ordered.length > PAGE_PREVIEW_LIMIT ? (
                  <nav
                    className="upload-page-pagination"
                    aria-label={`${item.sourceLabel} validated page preview`}
                  >
                    <button
                      type="button"
                      disabled={offset === 0}
                      onClick={() =>
                        setPreviewOffsets((current) => ({
                          ...current,
                          [previewKey]: Math.max(
                            0,
                            offset - PAGE_PREVIEW_LIMIT,
                          ),
                        }))
                      }
                    >
                      <ArrowLeft size={16} /> Previous
                    </button>
                    <span>
                      {offset + 1}–
                      {Math.min(
                        ordered.length,
                        offset + PAGE_PREVIEW_LIMIT,
                      )}{" "}
                      of {ordered.length.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      disabled={
                        offset + PAGE_PREVIEW_LIMIT >= ordered.length
                      }
                      onClick={() =>
                        setPreviewOffsets((current) => ({
                          ...current,
                          [previewKey]: Math.min(
                            maxOffset,
                            offset + PAGE_PREVIEW_LIMIT,
                          ),
                        }))
                      }
                    >
                      Next <ArrowRight size={16} />
                    </button>
                  </nav>
                ) : null}
                  </>
                ) : null}
              </details>
            );
          })}
          {progress.total ? (
            <div className="upload-progress" role="status" aria-live="polite">
              <div><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
              <strong>{progress.done} of {progress.total} pages processed</strong>
            </div>
          ) : null}
        </section>
        {kind === "BATCH" ? (
          <section className="upload-composer-card">
            <div className="upload-card-heading">
              <span>4</span>
              <div>
                <strong>Upload queue</strong>
                <small>
                  Confirm each detected chapter and enable paid access only
                  where needed
                </small>
              </div>
            </div>
            {hasQueuedPages ? (
              <div className="upload-batch-table">
                {items.map((item, index) => {
                  const storedItem = job?.items?.find(
                    (stored) => stored.clientKey === item.clientKey,
                  );
                  const pageCount =
                    localPagesFor(item).length + (storedItem?.files.length ?? 0);
                  return (
                    <article key={item.clientKey}>
                      <header>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{item.sourceLabel}</strong>
                          <small>
                            {pageCount.toLocaleString()} page
                            {pageCount === 1 ? "" : "s"} · Chapter{" "}
                            {item.chapterNumber}
                          </small>
                        </div>
                        {commercialLoaded &&
                        commercial.economy.premiumEconomyPublic ? (
                          <label className="upload-queue-paid-toggle">
                          <input
                            type="checkbox"
                            checked={item.accessType === "PAID"}
                            disabled={busy || !batchPaidEnabled}
                            onChange={(event) =>
                              changeBatchItemPaid(
                                item.clientKey,
                                event.target.checked,
                              )
                            }
                          />
                          <span aria-hidden="true" />
                          <b>
                            {item.accessType === "PAID"
                              ? `Paid · ${batchPaidPrice.toLocaleString()} ${commercial.economy.coinName}`
                              : batchPaidEnabled
                                ? "Free chapter"
                                : "Paid option off"}
                          </b>
                          </label>
                        ) : null}
                      </header>
                      <details className="upload-queue-details">
                        <summary>Edit chapter metadata</summary>
                        <ChapterMetadataFields
                          disabled={busy}
                          coinName={commercial.economy.coinName}
                          compact={false}
                          showCommerce={false}
                          item={item}
                          showFixedPageChoices={Boolean(selectedTeam?.canControlFixedReaderPages)}
                          duplicateInvalid={
                            duplicateRejectedKey === item.clientKey
                          }
                          onChange={(next) =>
                            updateItem(item.clientKey, next)
                          }
                          thumbnailFile={
                            thumbnailFiles[item.clientKey] ?? null
                          }
                          thumbnailUrl={storedItem?.thumbnailUrl ?? null}
                          onThumbnailChange={(file) =>
                            changeThumbnail(item.clientKey, file)
                          }
                        />
                      </details>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="upload-empty upload-batch-settings-gate">
                <FolderOpen size={26} />
                <strong>The queue is empty</strong>
                <p>
                  Drop files above or use the add buttons to build your
                  multi-chapter upload.
                </p>
              </div>
            )}
          </section>
        ) : null}
        {job?.status === "READY" ? (
          <section className="upload-composer-card upload-final-review">
            <div className="upload-card-heading">
              <span>{kind === "BATCH" ? "5" : "4"}</span>
              <div><strong>Final review</strong><small>Nothing becomes public before this confirmation</small></div>
            </div>
            <dl>
              <div><dt>Series</dt><dd>{job.seriesTitle}</dd></div>
              <div><dt>Team</dt><dd>{job.teamName ?? "Platform"}</dd></div>
              <div><dt>Chapters</dt><dd>{job.items?.length ?? 0}</dd></div>
              <div><dt>Pages</dt><dd>{job.pageCount}</dd></div>
              <div><dt>Size</dt><dd>{formatBytes(job.totalBytes)}</dd></div>
            </dl>
            <label className="upload-check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={
                  busy || composerDirty || Boolean(localPages.length)
                }
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I confirmed metadata, team, price, visibility, schedule, and page order.
            </label>
            {composerDirty || localPages.length ? (
              <p className="upload-review-warning">
                Save and validate the latest queue changes before confirming
                publication.
              </p>
            ) : null}
            <button
              type="button"
              className="button button-primary"
              disabled={
                !confirmed ||
                busy ||
                composerDirty ||
                Boolean(localPages.length)
              }
              onClick={() => void publish()}
            >
              <Check size={18} /> Publish or submit for required review
            </button>
          </section>
        ) : null}
        {kind === "SINGLE" ? (
          <div className="upload-action-bar">
          {job && ["DRAFT", "UPLOADING", "READY", "FAILED"].includes(job.status) ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void discard()}
            >
              <Trash size={17} /> Discard draft
            </button>
          ) : <span />}
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || !seriesId || Boolean(duplicateRejectedKey)}
          >
            {busy ? <SpinnerGap className="spin" size={18} /> : <CloudArrowUp size={18} />}
            {job ? (localPages.length ? "Validate selected pages" : "Save metadata") : "Save draft and validate"}
          </button>
          </div>
        ) : null}
      </form>
        </>
      )}
    </section>
    <ConfirmActionDialog
      open={Boolean(duplicatePrompt)}
      title="Do you want to replace existing chapter?"
      description={`Chapter ${duplicatePrompt?.chapterNumber || ""} already exists with the same team, language, and version. Replacing it creates a private request for an administrator; the published chapter stays unchanged until approval.`}
      confirmLabel="Yes, request replacement"
      cancelLabel="No, change chapter number"
      destructive={false}
      busy={busy}
      onCancel={() => {
        const clientKey = duplicatePrompt?.clientKey ?? "";
        setDuplicatePrompt(null);
        setDuplicateRejectedKey(clientKey);
        setItems((current) =>
          current.map((item) =>
            item.clientKey === clientKey
              ? { ...item, replacementChapterId: null }
              : item,
          ),
        );
        setError(
          "Choose a different chapter number before saving this upload.",
        );
        window.requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>(
              `[data-upload-item="${CSS.escape(clientKey)}"] input[aria-invalid="true"]`,
            )
            ?.focus(),
        );
      }}
      onConfirm={() => {
        if (!duplicatePrompt) return;
        const nextItems = items.map((item) =>
          item.clientKey === duplicatePrompt.clientKey
            ? {
                ...item,
                replacementChapterId: duplicatePrompt.existingChapterId,
              }
            : item,
        );
        setItems(nextItems);
        setDuplicateRejectedKey("");
        setDuplicatePrompt(null);
        setMessage(
          "Replacement intent saved. It will be forced into administrator review after page validation.",
        );
        void persistUpload(nextItems);
      }}
    />
    </>
  );
}

function SeriesAccessPanel({ options }: { options: UploadOptions }) {
  const grouped = options.series.reduce<
    Array<UploadOptions["series"][number]>
  >((items, record) => {
    if (
      !items.some(
        (entry) => entry.id === record.id && entry.teamId === record.teamId,
      )
    ) {
      items.push(record);
    }
    return items;
  }, []);
  return (
    <section>
      <header className="upload-section-heading">
        <div>
          <span>Available release targets</span>
          <h2>Series</h2>
          <p>Every public, rights-safe series appears for your active verified teams.</p>
        </div>
      </header>
      {grouped.length ? (
        <div className="upload-series-grid">
          {grouped.map((series) => (
            <article key={`${series.id}:${series.teamId ?? ""}`}>
              <span className="upload-series-cover" aria-hidden="true">
                {series.coverUrl ? (
                  <img src={series.coverUrl} alt="" loading="lazy" />
                ) : (
                  <Books size={22} />
                )}
              </span>
              <div><strong>{series.title}</strong><small>{series.teamName ?? "Platform-managed"}</small></div>
              <span>
                {series.uploadRequiresReview
                  ? "Review required"
                  : series.canPublish
                    ? "Trusted publish"
                    : "Review required"}
              </span>
              <a
                className="button button-secondary"
                href={`${routeFor("single")}?series=${encodeURIComponent(series.id)}${series.teamId ? `&team=${encodeURIComponent(series.teamId)}` : ""}`}
              >
                Upload <ArrowRight size={16} />
              </a>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No upload targets available"
          body="Ask an administrator to approve a series request or grant your team upload rights."
          action={<a href={routeFor("add-series")}>Create new series</a>}
        />
      )}
    </section>
  );
}

function RightsPanel() {
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/v1/upload-rights?limit=100", { cache: "no-store" })
      .then((response) => readJson<{ data: Array<Record<string, unknown>> }>(response))
      .then((payload) => setRecords(payload.data ?? []))
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Publishing rights could not be loaded.",
        ),
      );
  }, []);
  return (
    <section>
      <header className="upload-section-heading">
        <div>
          <span>Release ownership</span>
          <h2>Rights and restrictions</h2>
          <p>Revoking access blocks future uploads without deleting historical releases.</p>
        </div>
      </header>
      {error ? <div className="upload-alert is-error">{error}</div> : null}
      {records.length ? (
        <div className="upload-rights-list">
          {records.map((record, index) => (
            <article key={String(record.id ?? `${record.seriesId}:${record.teamId}:${index}`)}>
              <ShieldCheck size={22} />
              <div>
                <strong>{String(record.seriesTitle ?? "Series")}</strong>
                <small>{String(record.teamName ?? "Publishing team")}</small>
              </div>
              <dl>
                <div><dt>Upload</dt><dd>{record.canUpload ? "Allowed" : "Blocked"}</dd></div>
                <div><dt>Publish</dt><dd>{record.canPublish ? "Direct" : "Review"}</dd></div>
                <div><dt>Languages</dt><dd>{Array.isArray(record.allowedLanguages) && record.allowedLanguages.length ? record.allowedLanguages.join(", ") : "All supported"}</dd></div>
              </dl>
              {record.revokedAt ? <StatusBadge status="REVOKED" /> : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No publishing rights in this scope"
          body="Rights appear after an administrator approves a team-series relationship."
        />
      )}
    </section>
  );
}

function UploadRules({ options }: { options: UploadOptions }) {
  return (
    <section>
      <header className="upload-section-heading">
        <div>
          <span>Deployment capabilities</span>
          <h2>Upload rules and supported methods</h2>
          <p>Unavailable methods are explained here and never presented as working actions.</p>
        </div>
      </header>
      <div className="upload-method-list">
        {options.methods.map((method) => (
          <article key={method.id} className={method.supported ? "is-supported" : ""}>
            {method.supported ? <CheckCircle size={22} /> : <Info size={22} />}
            <div><strong>{method.label}</strong><p>{method.reason}</p></div>
            <span>{method.supported ? "Available" : "Unavailable"}</span>
          </article>
        ))}
      </div>
      <div className="upload-rule-grid">
        <article><strong>{options.limits.maxChaptersPerJob}</strong><span>chapters per batch</span></article>
        <article><strong>{options.limits.maxPagesPerChapter}</strong><span>pages per chapter</span></article>
        <article><strong>25 MB</strong><span>per verified page</span></article>
        <article><strong>250 MB</strong><span>per chapter</span></article>
        <article><strong>7 GB</strong><span>per private upload job</span></article>
      </div>
      <ul className="upload-rules-copy">
        <li>JPEG, PNG, and WebP signatures must match the actual file content.</li>
        <li>Animated images, SVG, HTML, executables, hidden files, traversal paths, and duplicate page content are rejected.</li>
        <li>Team membership, series rights, language scope, suspension state, and duplicate releases are rechecked at publish time.</li>
        <li>Paid page objects remain private and are served only through entitlement-checked reader routes after publication.</li>
      </ul>
    </section>
  );
}

const navItems: Array<[UploadMode, string, typeof Gauge]> = [
  ["dashboard", "Dashboard", Gauge],
  ["add-series", "Create New Series", Plus],
  ["series-requests", "My Series Requests", FileText],
  ["series", "Series", Books],
  ["single", "Single Chapter", FileImage],
  ["multi", "Multi-Chapter", FolderOpen],
  ["drafts", "Drafts", FileText],
  ["history", "Upload History", Clock],
  ["review-status", "Review Status", ListChecks],
  ["rights", "Rights", ShieldCheck],
  ["rules", "Upload Rules", Info],
];

export function UploadCenterWorkspace({
  admin,
  initialMode,
  initialSection,
  canUpload,
  canRequestSeries,
  canManageTeam,
}: {
  admin: boolean;
  initialMode?: "SINGLE" | "BATCH";
  initialSection?: string;
  canUpload: boolean;
  canRequestSeries: boolean;
  canManageTeam: boolean;
}) {
  const requestedMode = (
    initialMode === "SINGLE"
      ? "single"
      : initialMode === "BATCH"
        ? "multi"
        : navItems.some(([id]) => id === initialSection)
          ? initialSection
          : "dashboard"
  ) as UploadMode;
  const availableNavItems = navItems.filter(([id]) => {
    if (admin || id === "dashboard") return true;
    if (id === "add-series" || id === "series-requests") {
      return canRequestSeries;
    }
    if (id === "rights") {
      return canManageTeam || canUpload || canRequestSeries;
    }
    return canUpload;
  });
  const selectedMode = availableNavItems.some(([id]) => id === requestedMode)
    ? requestedMode
    : "dashboard";
  const [options, setOptions] = useState<UploadOptions | null>(null);
  const [list, setList] = useState<UploadListResponse>({
    data: [],
    summary: {},
    pagination: { page: 1, pageSize: 20, total: 0, pageCount: 1 },
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [optionPayload, listPayload] = await Promise.all([
        readJson<UploadOptions>(
          await fetch("/api/v1/upload-jobs?view=options", { cache: "no-store" }),
        ),
        readJson<UploadListResponse>(
          await fetch("/api/v1/upload-jobs?pageSize=50", { cache: "no-store" }),
        ),
      ]);
      setOptions(optionPayload);
      setList(listPayload);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The Upload Center could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (
      canUpload &&
      !["add-series", "series-requests", "rights"].includes(selectedMode)
    ) {
      const timeout = window.setTimeout(() => {
        void load();
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [canUpload, selectedMode]);

  const visibleJobs =
    selectedMode === "drafts"
      ? list.data.filter((job) =>
          ["DRAFT", "UPLOADING", "READY", "FAILED"].includes(job.status),
        )
      : selectedMode === "review-status"
        ? list.data.filter((job) =>
            ["PENDING_REVIEW", "REJECTED", "PUBLISHED", "SCHEDULED"].includes(
              job.status,
            ),
          )
        : list.data.filter((job) =>
            ["PUBLISHED", "SCHEDULED", "PENDING_REVIEW", "REJECTED", "CANCELLED"].includes(
              job.status,
            ),
          );

  return (
    <section
      className="upload-center-workspace"
      data-administrator={admin ? "true" : "false"}
    >
      <aside className="upload-center-nav">
        <div>
          <CloudArrowUp size={23} />
          <span><strong>Upload Center</strong><small>Team publishing workspace</small></span>
        </div>
        <nav aria-label="Upload Center sections">
          {availableNavItems.map(([id, label, Icon]) => (
            <a
              href={routeFor(id)}
              key={id}
              aria-current={selectedMode === id ? "page" : undefined}
            >
              <Icon size={18} /><span>{label}</span>
            </a>
          ))}
        </nav>
      </aside>
      <main className="upload-center-main">
        <label className="upload-center-mobile-nav">
          <span>Upload Center section</span>
          <select
            value={selectedMode}
            onChange={(event) => {
              window.location.href = routeFor(event.target.value as UploadMode);
            }}
          >
            {availableNavItems.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
          </select>
        </label>
        {error ? (
          <div className="upload-alert is-error" role="alert">
            <WarningCircle size={19} /> {error}
            <button type="button" onClick={() => void load()}>Retry</button>
          </div>
        ) : null}
        {selectedMode === "add-series" ? (
          <AddSeriesRequestPanel />
        ) : selectedMode === "series-requests" ? (
          <SeriesRequestsPanel />
        ) : selectedMode === "rights" ? (
          <RightsPanel />
        ) : selectedMode === "dashboard" && !canUpload ? (
          <UploadDashboard
            jobs={[]}
            summary={{}}
            canUpload={false}
            canRequestSeries={canRequestSeries}
          />
        ) : loading && !options ? (
          <div className="upload-loading">
            <SpinnerGap className="spin" size={24} /> Loading publishing workspace…
          </div>
        ) : options ? (
          selectedMode === "dashboard" ? (
            <UploadDashboard
              jobs={list.data}
              summary={list.summary}
              canUpload={canUpload}
              canRequestSeries={canRequestSeries}
            />
          ) : selectedMode === "series" ? (
            <SeriesAccessPanel options={options} />
          ) : selectedMode === "single" ? (
            <UploadComposer kind="SINGLE" options={options} />
          ) : selectedMode === "multi" ? (
            <UploadComposer kind="BATCH" options={options} />
          ) : selectedMode === "rules" ? (
            <UploadRules options={options} />
          ) : (
            <section>
              <header className="upload-section-heading">
                <div>
                  <span>Publishing records</span>
                  <h2>
                    {selectedMode === "drafts"
                      ? "Upload drafts"
                      : selectedMode === "review-status"
                        ? "Review status"
                        : "Upload history"}
                  </h2>
                  <p>
                    {selectedMode === "drafts"
                      ? "Resume private jobs or safely discard temporary media."
                      : selectedMode === "review-status"
                        ? "See review outcomes without exposing internal reviewer notes."
                        : "Real completed, submitted, and cancelled upload records."}
                  </p>
                </div>
                <button className="button button-secondary" type="button" onClick={() => void load()}>
                  Refresh
                </button>
              </header>
              <JobList
                jobs={visibleJobs}
                emptyTitle={
                  selectedMode === "drafts"
                    ? "No upload drafts"
                    : selectedMode === "review-status"
                      ? "No reviewed uploads"
                      : "No upload history"
                }
                emptyBody="Records appear here after a real upload action."
                onRefresh={() => void load()}
              />
            </section>
          )
        ) : null}
      </main>
    </section>
  );
}
