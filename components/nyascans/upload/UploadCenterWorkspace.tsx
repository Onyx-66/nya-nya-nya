"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
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
  Plus,
  ShieldCheck,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import {
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
  pathParent,
  UPLOAD_LIMITS,
  type SupportedUploadMethod,
  uploadStatusLabel,
} from "@/lib/uploads";
import {
  AddSeriesRequestPanel,
  SeriesRequestsPanel,
} from "@/components/nyascans/upload/SeriesRequestWorkspace";

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

type UploadOptions = {
  series: Array<{
    id: string;
    slug: string;
    title: string;
    teamId?: string;
    teamName?: string;
    canPublish?: number;
    uploadRequiresReview?: number;
    allowedLanguagesJson?: string;
  }>;
  teams: Array<{ id: string; slug: string; name: string }>;
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
};

type LocalPage = {
  id: string;
  file: File;
  path: string;
  group: string;
  previewUrl: string;
};

type ApiFailure = {
  error?: { message?: string; fields?: Array<{ message?: string }> };
};

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
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiFailure;
  if (!response.ok) {
    throw new Error(
      payload.error?.fields?.[0]?.message ??
        payload.error?.message ??
        "The upload request failed.",
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
              <span>Review up to ten chapter folders before publishing.</span>
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
          emptyBody="Start with an approved series and an active team right."
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
}: {
  item: ComposerItem;
  onChange(next: ComposerItem): void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "upload-batch-fields" : "upload-form-grid"}>
      <label>
        <span>Volume</span>
        <input
          value={item.volume}
          maxLength={40}
          onChange={(event) => onChange({ ...item, volume: event.target.value })}
        />
      </label>
      <label>
        <span>Chapter number</span>
        <input
          value={item.chapterNumber}
          maxLength={40}
          required
          onChange={(event) =>
            onChange({ ...item, chapterNumber: event.target.value })
          }
        />
      </label>
      <label>
        <span>Chapter title</span>
        <input
          value={item.title}
          maxLength={240}
          onChange={(event) => onChange({ ...item, title: event.target.value })}
        />
      </label>
      <label>
        <span>Language</span>
        <input
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
      <label>
        <span>Availability</span>
        <select
          value={item.accessType}
          onChange={(event) =>
            onChange({
              ...item,
              accessType: event.target.value as "FREE" | "PAID",
              priceOnyx: event.target.value === "FREE" ? 0 : Math.max(1, item.priceOnyx),
            })
          }
        >
          <option value="FREE">Free</option>
          <option value="PAID">Paid</option>
        </select>
      </label>
      <label>
        <span>Onyx price</span>
        <input
          type="number"
          min="1"
          max="100000"
          disabled={item.accessType !== "PAID"}
          value={item.accessType === "PAID" ? item.priceOnyx : 0}
          onChange={(event) =>
            onChange({ ...item, priceOnyx: Math.max(1, Number(event.target.value)) })
          }
        />
      </label>
      <label>
        <span>Visibility</span>
        <select
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
          type="datetime-local"
          value={item.scheduledAt}
          onChange={(event) =>
            onChange({ ...item, scheduledAt: event.target.value })
          }
        />
      </label>
      <label className="upload-check">
        <input
          type="checkbox"
          checked={item.commentsEnabled}
          onChange={(event) =>
            onChange({ ...item, commentsEnabled: event.target.checked })
          }
        />
        Comments enabled
      </label>
      {!compact ? (
        <>
          <label className="upload-field-wide">
            <span>Release notes</span>
            <textarea
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
    </div>
  );
}

function UploadComposer({
  kind,
  options,
}: {
  kind: "SINGLE" | "BATCH";
  options: UploadOptions;
}) {
  const initialQuery =
    typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const initialSeries =
    initialQuery.get("series") ??
    options.series[0]?.id ??
    "";
  const initialTeam =
    initialQuery.get("team") ??
    options.series.find((entry) => entry.id === initialSeries)?.teamId ??
    options.teams[0]?.id ??
    "";
  const [seriesId, setSeriesId] = useState(initialSeries);
  const [teamId, setTeamId] = useState(initialTeam);
  const [sourceType, setSourceType] =
    useState<SupportedUploadMethod>(kind === "BATCH" ? "DIRECT_FOLDER" : "DIRECT_IMAGES");
  const [items, setItems] = useState<ComposerItem[]>([newComposerItem()]);
  const [localPages, setLocalPages] = useState<LocalPage[]>([]);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [draggedId, setDraggedId] = useState("");
  const folderRef = useRef<HTMLInputElement | null>(null);
  const resumeJobId = initialQuery.get("job") ?? "";

  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute("webkitdirectory", "");
      folderRef.current.setAttribute("directory", "");
    }
  }, [sourceType, kind]);

  useEffect(() => {
    if (!resumeJobId) return;
    let cancelled = false;
    void fetch(`/api/v1/upload-jobs?jobId=${encodeURIComponent(resumeJobId)}`, {
      cache: "no-store",
    })
      .then((response) => readJson<{ data: UploadJob }>(response))
      .then((payload) => {
        if (cancelled) return;
        setJob(payload.data);
        setSeriesId(payload.data.seriesId);
        setTeamId(payload.data.teamId ?? "");
        setSourceType(payload.data.sourceType);
        setItems(
          (payload.data.items ?? []).map((item) => ({
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
            commentsEnabled: item.commentsEnabled,
          })),
        );
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The upload draft could not be resumed.",
        ),
      );
    return () => {
      cancelled = true;
    };
  }, [resumeJobId]);

  useEffect(
    () => () => localPages.forEach((page) => URL.revokeObjectURL(page.previewUrl)),
    [localPages],
  );

  function updateItem(clientKey: string, next: ComposerItem) {
    setItems((current) =>
      current.map((entry) => (entry.clientKey === clientKey ? next : entry)),
    );
  }

  function choosePages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.size > 0);
    setError("");
    if (!files.length) return;
    if (files.some((file) => file.size > UPLOAD_LIMITS.maxPageBytes)) {
      setError("Every page must be 25 MB or smaller.");
      return;
    }
    const selected = files
      .map((file) => {
        const path = file.webkitRelativePath || file.name;
        return {
          id: crypto.randomUUID(),
          file,
          path,
          group: kind === "BATCH" ? pathParent(path) : items[0]!.sourceLabel,
          previewUrl: URL.createObjectURL(file),
        };
      })
      .sort((left, right) => naturalCompare(left.path, right.path));
    if (kind === "BATCH") {
      const groups = [...new Set(selected.map((page) => page.group))];
      if (groups.length > UPLOAD_LIMITS.maxChaptersPerJob) {
        selected.forEach((page) => URL.revokeObjectURL(page.previewUrl));
        setError(`Select no more than ${UPLOAD_LIMITS.maxChaptersPerJob} chapter folders.`);
        return;
      }
      const detected = groups.map((group, index) => {
        const metadata = detectBatchChapter(group, index + 1);
        return {
          ...newComposerItem(metadata.chapterNumber, metadata.sourceLabel),
          volume: metadata.volume,
          title: metadata.title,
        };
      });
      setItems(detected);
    }
    setLocalPages((current) => {
      current.forEach((page) => URL.revokeObjectURL(page.previewUrl));
      return selected;
    });
  }

  function localPagesFor(item: ComposerItem) {
    return localPages.filter(
      (page) => kind === "SINGLE" || page.group === item.sourceLabel,
    );
  }

  function moveLocal(pageId: string, direction: -1 | 1) {
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
    if (!draggedId || draggedId === targetId) return;
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

  async function saveAndUpload(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!seriesId) throw new Error("Choose an approved series.");
      if (!options.admin && !teamId) throw new Error("Choose your active team.");
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
              idempotencyKey: crypto.randomUUID(),
              items: items.map(wireItem),
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
        for (const item of items) {
          const stored = current.items?.find(
            (entry) => entry.clientKey === item.clientKey,
          );
          if (!stored) continue;
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
                item: wireItem(item),
              }),
            }),
          );
          current = updated.data;
          setJob(current);
        }
      }
      if (!localPages.length) {
        setMessage("Private upload draft saved. Add pages when ready.");
        return;
      }
      const totalPages = localPages.length;
      setProgress({ done: 0, total: totalPages });
      for (const item of items) {
        const stored = current.items?.find(
          (entry) => entry.clientKey === item.clientKey,
        );
        if (!stored) continue;
        const pages = localPagesFor(item);
        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
          const page = pages[pageIndex]!;
          const form = new FormData();
          form.set("jobId", current.id);
          form.set("itemId", stored.id);
          form.set("expectedRevision", String(current.revision));
          form.set("sourcePath", page.path);
          form.set("pageIndex", String(pageIndex));
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
          } catch (uploadError) {
            current = await refreshJob(current.id);
            setError(
              uploadError instanceof Error
                ? `${page.path}: ${uploadError.message}`
                : `${page.path} failed validation.`,
            );
          }
          setProgress((value) => ({ ...value, done: value.done + 1 }));
        }
      }
      current = await refreshJob(current.id);
      setLocalPages((pages) => {
        pages.forEach((page) => URL.revokeObjectURL(page.previewUrl));
        return [];
      });
      setMessage(
        current.status === "READY"
          ? "All pages are validated. Review the release summary before publishing."
          : "Successful pages were preserved. Resolve failed pages before publishing.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The upload draft could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function reorderServer(item: UploadItem, nextFiles: UploadFileRecord[]) {
    if (!job) return;
    setBusy(true);
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
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
      );
      setJob(payload.data);
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
      options.admin || !teamId
        ? options.series
        : options.series.filter(
            (entry) => !entry.teamId || entry.teamId === teamId,
          ),
    [options.admin, options.series, teamId],
  );

  return (
    <section>
      <header className="upload-section-heading">
        <div>
          <span>{kind === "BATCH" ? "Folder batch" : "One release"}</span>
          <h2>{kind === "BATCH" ? "Multi-chapter upload" : "Single chapter upload"}</h2>
          <p>
            Pages stay private until the atomic publish or review submission succeeds.
          </p>
        </div>
        {job ? <StatusBadge status={job.status} /> : null}
      </header>
      {error ? (
        <div className="upload-alert is-error" role="alert">
          <WarningCircle size={19} /> {error}
        </div>
      ) : null}
      {message ? (
        <div className="upload-alert is-success" role="status">
          <CheckCircle size={19} /> {message}
        </div>
      ) : null}
      <form className="upload-composer" onSubmit={saveAndUpload}>
        <section className="upload-composer-card">
          <div className="upload-card-heading">
            <span>1</span>
            <div><strong>Release context</strong><small>Approved series and active team right</small></div>
          </div>
          <div className="upload-form-grid">
            <label>
              <span>Active team</span>
              <select
                value={teamId}
                disabled={Boolean(job)}
                onChange={(event) => {
                  setTeamId(event.target.value);
                  const first = options.series.find(
                    (entry) => entry.teamId === event.target.value,
                  );
                  if (first) setSeriesId(first.id);
                }}
              >
                {options.admin ? <option value="">Platform / independent</option> : null}
                {options.teams.map((team) => (
                  <option value={team.id} key={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Approved series</span>
              <select
                required
                value={seriesId}
                disabled={Boolean(job)}
                onChange={(event) => setSeriesId(event.target.value)}
              >
                {!eligibleSeries.length ? <option value="">No eligible series</option> : null}
                {eligibleSeries.map((series) => (
                  <option value={series.id} key={`${series.id}:${series.teamId ?? ""}`}>
                    {series.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>File method</span>
              <select
                value={sourceType}
                disabled={Boolean(job) || kind === "BATCH"}
                onChange={(event) =>
                  setSourceType(event.target.value as SupportedUploadMethod)
                }
              >
                <option value="DIRECT_IMAGES">Direct images</option>
                <option value="DIRECT_FOLDER">Folder selection</option>
              </select>
            </label>
          </div>
        </section>
        <section className="upload-composer-card">
          <div className="upload-card-heading">
            <span>2</span>
            <div>
              <strong>{kind === "BATCH" ? "Chapter review table" : "Chapter metadata"}</strong>
              <small>Detection is a suggestion; confirm every chapter</small>
            </div>
          </div>
          {kind === "BATCH" ? (
            <div className="upload-batch-table">
              {items.map((item, index) => (
                <article key={item.clientKey}>
                  <header>
                    <span>{index + 1}</span>
                    <div><strong>{item.sourceLabel}</strong><small>{localPagesFor(item).length} selected pages</small></div>
                  </header>
                  <ChapterMetadataFields
                    compact
                    item={item}
                    onChange={(next) => updateItem(item.clientKey, next)}
                  />
                </article>
              ))}
            </div>
          ) : (
            <ChapterMetadataFields
              item={items[0]!}
              onChange={(next) => updateItem(items[0]!.clientKey, next)}
            />
          )}
        </section>
        <section className="upload-composer-card">
          <div className="upload-card-heading">
            <span>3</span>
            <div><strong>Pages and ordering</strong><small>Natural order first, explicit order saved exactly</small></div>
          </div>
          {!job || ["DRAFT", "UPLOADING", "READY", "FAILED"].includes(job.status) ? (
            <label className="upload-dropzone">
              {sourceType === "DIRECT_FOLDER" || kind === "BATCH" ? (
                <FolderOpen size={35} />
              ) : (
                <FileImage size={35} />
              )}
              <strong>
                {kind === "BATCH"
                  ? "Choose a parent folder containing one folder per chapter"
                  : sourceType === "DIRECT_FOLDER"
                    ? "Choose the chapter folder"
                    : "Choose ordered chapter images"}
              </strong>
              <span>Verified JPEG, PNG, or WebP only · 25 MB per page</span>
              <span className="upload-file-cta">
                {sourceType === "DIRECT_FOLDER" || kind === "BATCH"
                  ? "Choose folder"
                  : "Choose files"}
              </span>
              <input
                className="upload-native-file"
                ref={sourceType === "DIRECT_FOLDER" || kind === "BATCH" ? folderRef : undefined}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={choosePages}
              />
            </label>
          ) : null}
          {localPages.length ? (
            <div className="upload-local-pages">
              {items.map((item) => (
                <section key={item.clientKey}>
                  <h4>{item.sourceLabel}</h4>
                  <ol>
                    {localPagesFor(item).map((page, index) => (
                      <li
                        key={page.id}
                        draggable
                        onDragStart={() => setDraggedId(page.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => dropLocal(page.id, event)}
                      >
                        <span>{index + 1}</span>
                        <img src={page.previewUrl} alt="" />
                        <div><strong>{page.path}</strong><small>{formatBytes(page.file.size)}</small></div>
                        <button type="button" aria-label="Move page up" onClick={() => moveLocal(page.id, -1)}><ArrowUp size={16} /></button>
                        <button type="button" aria-label="Move page down" onClick={() => moveLocal(page.id, 1)}><ArrowDown size={16} /></button>
                        <button
                          type="button"
                          aria-label="Remove selected page"
                          onClick={() =>
                            setLocalPages((current) => {
                              const target = current.find((entry) => entry.id === page.id);
                              if (target) URL.revokeObjectURL(target.previewUrl);
                              return current.filter((entry) => entry.id !== page.id);
                            })
                          }
                        ><X size={16} /></button>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          ) : null}
          {job?.items?.map((item) => (
            <section className="upload-server-pages" key={item.id}>
              <h4>{item.sourceLabel} · {item.files.length} validated source{item.files.length === 1 ? "" : "s"}</h4>
              <ol>
                {[...item.files]
                  .sort((left, right) => left.pageIndex - right.pageIndex)
                  .map((file, index, ordered) => (
                    <li key={file.id}>
                      <span>{index + 1}</span>
                      {file.status === "READY" ? (
                        <img
                          src={`/api/v1/upload-page-preview?jobId=${encodeURIComponent(job.id)}&fileId=${encodeURIComponent(file.id)}`}
                          alt={`Page ${index + 1}`}
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
                            disabled={busy || index === 0}
                            aria-label="Move validated page up"
                            onClick={() => {
                              const next = [...ordered];
                              [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                              void reorderServer(item, next);
                            }}
                          ><ArrowUp size={16} /></button>
                          <button
                            type="button"
                            disabled={busy || index === ordered.length - 1}
                            aria-label="Move validated page down"
                            onClick={() => {
                              const next = [...ordered];
                              [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
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
            </section>
          ))}
          {progress.total ? (
            <div className="upload-progress" role="status" aria-live="polite">
              <div><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
              <strong>{progress.done} of {progress.total} pages processed</strong>
            </div>
          ) : null}
        </section>
        {job?.status === "READY" ? (
          <section className="upload-composer-card upload-final-review">
            <div className="upload-card-heading">
              <span>4</span>
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
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I confirmed metadata, team, price, visibility, schedule, and page order.
            </label>
            <button
              type="button"
              className="button button-primary"
              disabled={!confirmed || busy}
              onClick={() => void publish()}
            >
              <Check size={18} /> Publish or submit for required review
            </button>
          </section>
        ) : null}
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
            disabled={busy || !seriesId}
          >
            {busy ? <SpinnerGap className="spin" size={18} /> : <CloudArrowUp size={18} />}
            {job ? (localPages.length ? "Validate selected pages" : "Save metadata") : "Save draft and validate"}
          </button>
        </div>
      </form>
    </section>
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
          <span>Approved release targets</span>
          <h2>Series</h2>
          <p>Only approved series with current server-side upload rights appear here.</p>
        </div>
      </header>
      {grouped.length ? (
        <div className="upload-series-grid">
          {grouped.map((series) => (
            <article key={`${series.id}:${series.teamId ?? ""}`}>
              <Books size={22} />
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
          title="No approved upload targets"
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
                <div><dt>Languages</dt><dd>{Array.isArray(record.allowedLanguages) && record.allowedLanguages.length ? record.allowedLanguages.join(", ") : "All approved"}</dd></div>
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
        <article><strong>2 GB</strong><span>per private upload job</span></article>
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
