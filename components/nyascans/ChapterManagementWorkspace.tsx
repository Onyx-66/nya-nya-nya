"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle,
  CloudArrowUp,
  Coins,
  Eye,
  FloppyDisk,
  Image as ImageIcon,
  LockSimple,
  ShieldCheck,
  SpinnerGap,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ConfirmActionDialog } from "@/components/nyascans/admin/AdminPageScaffold";

type Credits = {
  translator: string;
  cleaner: string;
  redrawer: string;
  typesetter: string;
  proofreader: string;
  qualityControl: string;
};

type ManagedPage = {
  id: string;
  pageIndex: number;
  width: number;
  height: number;
  sha256: string;
  processingStatus: string;
  previewUrl: string;
};

type ManagedChapter = {
  id: string;
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  teamId: string | null;
  teamName: string | null;
  slug: string;
  chapterNumber: string;
  volume: string | null;
  title: string;
  language: string;
  format: string;
  version: number;
  releaseNotes: string;
  credits: Credits;
  state: "DRAFT" | "READY_FOR_REVIEW" | "PUBLISHED";
  visibility: "PUBLIC" | "UNLISTED" | "HIDDEN";
  commentsEnabled: boolean;
  accessType: "FREE" | "PAID";
  priceOnyx: number;
  pageCount: number;
  publishedAt: string | null;
  revision: number;
  pages: ManagedPage[];
  permissions: {
    administrator: boolean;
    canEditMetadata: boolean;
    canManagePages: boolean;
    canPublish: boolean;
    canManageCommerce: boolean;
  };
};

type FormState = {
  chapterNumber: string;
  volume: string;
  title: string;
  language: string;
  version: number;
  releaseNotes: string;
  credits: Credits;
  state: ManagedChapter["state"];
  visibility: ManagedChapter["visibility"];
  commentsEnabled: boolean;
  accessType: ManagedChapter["accessType"];
  priceOnyx: number;
  publishedAt: string;
  reason: string;
};

const emptyCredits: Credits = {
  translator: "",
  cleaner: "",
  redrawer: "",
  typesetter: "",
  proofreader: "",
  qualityControl: "",
};

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

async function responseData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? "The chapter request could not be completed.",
    );
  }
  return payload;
}

function formFromChapter(chapter: ManagedChapter): FormState {
  return {
    chapterNumber: chapter.chapterNumber,
    volume: chapter.volume ?? "",
    title: chapter.title,
    language: chapter.language,
    version: Number(chapter.version),
    releaseNotes: chapter.releaseNotes,
    credits: { ...emptyCredits, ...chapter.credits },
    state: chapter.state,
    visibility: chapter.visibility,
    commentsEnabled: chapter.commentsEnabled,
    accessType: chapter.accessType,
    priceOnyx: Number(chapter.priceOnyx),
    publishedAt: localDateTime(chapter.publishedAt),
    reason: "",
  };
}

export function ChapterManagementWorkspace({
  seriesId,
  chapterId,
  actor,
  administration,
}: {
  seriesId: string;
  chapterId: string;
  actor: { displayName: string; role: string };
  administration: boolean;
}) {
  const [chapter, setChapter] = useState<ManagedChapter | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [pages, setPages] = useState<ManagedPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">(
    "success",
  );
  const [baseline, setBaseline] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<ManagedPage | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<{
    page: ManagedPage;
    file: File;
  } | null>(null);
  const addInput = useRef<HTMLInputElement>(null);

  const snapshot = useMemo(
    () =>
      form
        ? JSON.stringify({
            ...form,
            reason: "",
            pageOrder: pages.map((page) => page.id),
          })
        : "",
    [form, pages],
  );
  const dirty = Boolean(form && baseline && snapshot !== baseline);

  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const payload = await fetch(
        `/api/v1/chapter-management?seriesId=${encodeURIComponent(seriesId)}&chapterId=${encodeURIComponent(chapterId)}`,
        { cache: "no-store" },
      ).then((response) =>
        responseData<{ data: ManagedChapter }>(response),
      );
      const nextForm = formFromChapter(payload.data);
      const nextPages = payload.data.pages ?? [];
      setChapter(payload.data);
      setForm(nextForm);
      setPages(nextPages);
      setBaseline(JSON.stringify({
        ...nextForm,
        reason: "",
        pageOrder: nextPages.map((page) => page.id),
      }));
    } catch (error) {
      setMessageKind("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Chapter management could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [chapterId, seriesId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  function updateForm<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateCredit(key: keyof Credits, value: string) {
    setForm((current) =>
      current
        ? {
            ...current,
            credits: { ...current.credits, [key]: value },
          }
        : current,
    );
  }

  function movePage(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= pages.length) return;
    setPages((current) => {
      const next = [...current];
      [next[index], next[destination]] = [
        next[destination]!,
        next[index]!,
      ];
      return next;
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chapter || !form) return;
    setBusy("save");
    setMessage("");
    try {
      await fetch("/api/v1/chapter-management", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesId,
          chapterId,
          expectedRevision: chapter.revision,
          ...form,
          publishedAt: form.publishedAt
            ? new Date(form.publishedAt).toISOString()
            : null,
          priceOnyx: form.accessType === "PAID" ? form.priceOnyx : 0,
          pageOrder: pages.map((page) => page.id),
        }),
      }).then((response) => responseData(response));
      setMessageKind("success");
      setMessage("Chapter changes saved and added to the audit history.");
      await load();
    } catch (error) {
      setMessageKind("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Chapter changes could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }

  async function mutatePage(
    action: "ADD" | "REPLACE",
    file: File,
    targetPage?: ManagedPage,
  ) {
    if (!chapter || !form) return;
    if (form.reason.trim().length < 6) {
      setMessageKind("error");
      setMessage("Add a short audit reason before changing chapter pages.");
      return;
    }
    setBusy(action === "ADD" ? "add-page" : `replace-${targetPage?.id}`);
    setMessage("");
    const data = new FormData();
    data.set("action", action);
    data.set("seriesId", seriesId);
    data.set("chapterId", chapterId);
    data.set("expectedRevision", String(chapter.revision));
    data.set("reason", form.reason);
    data.set("file", file);
    if (targetPage) data.set("targetPageId", targetPage.id);
    try {
      await fetch("/api/v1/chapter-management-page", {
        method: "POST",
        body: data,
      }).then((response) => responseData(response));
      setMessageKind("success");
      setMessage(
        action === "ADD"
          ? "Page added. Review its position before saving."
          : `Page ${targetPage!.pageIndex + 1} replaced safely.`,
      );
      if (addInput.current) addInput.current.value = "";
      await load();
    } catch (error) {
      setMessageKind("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The chapter page could not be changed.",
      );
    } finally {
      setBusy("");
      setPendingReplacement(null);
    }
  }

  async function removePage() {
    if (!chapter || !form || !pendingRemoval) return;
    if (form.reason.trim().length < 6) {
      setPendingRemoval(null);
      setMessageKind("error");
      setMessage("Add a short audit reason before removing a chapter page.");
      return;
    }
    const target = pendingRemoval;
    setPendingRemoval(null);
    setBusy(`remove-${target.id}`);
    try {
      await fetch("/api/v1/chapter-management-page", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesId,
          chapterId,
          pageId: target.id,
          expectedRevision: chapter.revision,
          reason: form.reason,
        }),
      }).then((response) => responseData(response));
      setMessageKind("success");
      setMessage(`Page ${target.pageIndex + 1} removed safely.`);
      await load();
    } catch (error) {
      setMessageKind("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The page could not be removed.",
      );
    } finally {
      setBusy("");
    }
  }

  const backHref = administration
    ? "/onyx/admin/access/chapter-access"
    : "/dashboard/upload-center/history";

  if (loading) {
    return (
      <main className="chapter-management-page">
        <div className="chapter-management-loading" role="status">
          <SpinnerGap size={28} className="is-spinning" />
          <strong>Loading chapter management…</strong>
          <span>Release ownership and permissions are being verified.</span>
        </div>
      </main>
    );
  }

  if (!chapter || !form) {
    return (
      <main className="chapter-management-page">
        <section className="chapter-management-error" role="alert">
          <WarningCircle size={32} />
          <h1>Chapter management is unavailable</h1>
          <p>{message || "This release could not be opened."}</p>
          <a className="button button-secondary" href={backHref}>
            <ArrowLeft size={17} /> Return to workspace
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="chapter-management-page">
      <header className="chapter-management-header">
        <a href={backHref}>
          <ArrowLeft size={18} />
          {administration ? "Chapter access" : "Upload history"}
        </a>
        <div>
          <p className="eyebrow">
            {administration ? "Administrator release control" : "Team release control"}
          </p>
          <h1>{chapter.seriesTitle}</h1>
          <p>
            Chapter {chapter.chapterNumber}
            {chapter.title ? ` · ${chapter.title}` : ""} ·{" "}
            {chapter.teamName ?? "Independent release"}
          </p>
        </div>
        <div className="chapter-management-header-actions">
          <span className={`control-status status-${chapter.state.toLowerCase()}`}>
            {chapter.state.replaceAll("_", " ")}
          </span>
          <a
            className="button button-secondary"
            href={`/title/${chapter.seriesSlug}/chapter/${chapter.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            <Eye size={17} /> Open Reader
          </a>
        </div>
      </header>

      <div className="chapter-management-context">
        <span><ShieldCheck size={16} /> {actor.displayName}</span>
        <span>{actor.role.replaceAll("_", " ")}</span>
        <span>{chapter.pageCount} verified pages</span>
        <span>Revision {chapter.revision}</span>
      </div>

      <form className="chapter-management-form" onSubmit={save}>
        <section className="chapter-management-card">
          <div className="chapter-management-section-heading">
            <div>
              <span>Release metadata</span>
              <h2>Chapter information</h2>
            </div>
            <p>Changes apply only to this team release.</p>
          </div>
          <div className="chapter-management-grid">
            <label>
              <span>Chapter number</span>
              <input
                value={form.chapterNumber}
                maxLength={40}
                required
                onChange={(event) =>
                  updateForm("chapterNumber", event.target.value)
                }
              />
            </label>
            <label>
              <span>Volume</span>
              <input
                value={form.volume}
                maxLength={40}
                onChange={(event) => updateForm("volume", event.target.value)}
              />
            </label>
            <label className="chapter-management-wide">
              <span>Chapter title</span>
              <input
                value={form.title}
                maxLength={240}
                onChange={(event) => updateForm("title", event.target.value)}
              />
            </label>
            <label>
              <span>Language</span>
              <input
                value={form.language}
                pattern="[a-z]{2,3}(-[a-z0-9]{2,8})?"
                required
                onChange={(event) =>
                  updateForm("language", event.target.value.toLowerCase())
                }
              />
            </label>
            <label>
              <span>Version</span>
              <input
                type="number"
                min={1}
                max={99}
                value={form.version}
                required
                onChange={(event) =>
                  updateForm("version", Number(event.target.value))
                }
              />
            </label>
            <label className="chapter-management-wide">
              <span>Release notes</span>
              <textarea
                value={form.releaseNotes}
                maxLength={2000}
                onChange={(event) =>
                  updateForm("releaseNotes", event.target.value)
                }
              />
            </label>
          </div>
        </section>

        <section className="chapter-management-card">
          <div className="chapter-management-section-heading">
            <div>
              <span>Release credits</span>
              <h2>Contributors</h2>
            </div>
          </div>
          <div className="chapter-management-grid">
            {(
              [
                ["translator", "Translator"],
                ["cleaner", "Cleaner"],
                ["redrawer", "Redrawer"],
                ["typesetter", "Typesetter"],
                ["proofreader", "Proofreader"],
                ["qualityControl", "Quality control"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  value={form.credits[key]}
                  maxLength={120}
                  onChange={(event) => updateCredit(key, event.target.value)}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="chapter-management-card">
          <div className="chapter-management-section-heading">
            <div>
              <span>Publication</span>
              <h2>Visibility &amp; reader behavior</h2>
            </div>
            {!chapter.permissions.canPublish ? (
              <p>Publishing and schedule changes require team-leader approval.</p>
            ) : null}
          </div>
          <div className="chapter-management-grid">
            <label>
              <span>Publication state</span>
              <select
                value={form.state}
                disabled={
                  !chapter.permissions.canPublish &&
                  chapter.state === "PUBLISHED"
                }
                onChange={(event) =>
                  updateForm(
                    "state",
                    event.target.value as ManagedChapter["state"],
                  )
                }
              >
                <option value="DRAFT">Draft</option>
                <option value="READY_FOR_REVIEW">Ready for review</option>
                {chapter.permissions.canPublish ||
                chapter.state === "PUBLISHED" ? (
                  <option value="PUBLISHED">Published</option>
                ) : null}
              </select>
            </label>
            <label>
              <span>Visibility</span>
              <select
                value={form.visibility}
                disabled={!chapter.permissions.canPublish}
                onChange={(event) =>
                  updateForm(
                    "visibility",
                    event.target.value as ManagedChapter["visibility"],
                  )
                }
              >
                <option value="PUBLIC">Public</option>
                <option value="UNLISTED">Unlisted</option>
                <option value="HIDDEN">Hidden</option>
              </select>
            </label>
            <label>
              <span>Release schedule</span>
              <input
                type="datetime-local"
                value={form.publishedAt}
                disabled={!chapter.permissions.canPublish}
                onChange={(event) =>
                  updateForm("publishedAt", event.target.value)
                }
              />
            </label>
            <label className="chapter-management-check">
              <input
                type="checkbox"
                checked={form.commentsEnabled}
                onChange={(event) =>
                  updateForm("commentsEnabled", event.target.checked)
                }
              />
              <span>
                Allow chapter comments
                <small>Moderation policies still apply.</small>
              </span>
            </label>
          </div>
        </section>

        <section className="chapter-management-card">
          <div className="chapter-management-section-heading">
            <div>
              <span>Reader entitlement</span>
              <h2>Free or paid access</h2>
            </div>
            {!chapter.permissions.canManageCommerce ? (
              <p>Only administrators can change pricing.</p>
            ) : null}
          </div>
          <div className="chapter-management-grid">
            <label>
              <span>Access type</span>
              <select
                value={form.accessType}
                disabled={!chapter.permissions.canManageCommerce}
                onChange={(event) =>
                  updateForm(
                    "accessType",
                    event.target.value as ManagedChapter["accessType"],
                  )
                }
              >
                <option value="FREE">Free</option>
                <option value="PAID">Paid</option>
              </select>
            </label>
            {form.accessType === "PAID" ? (
              <label>
                <span>Onyx price</span>
                <div className="chapter-price-input">
                  <Coins size={17} />
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={form.priceOnyx}
                    disabled={!chapter.permissions.canManageCommerce}
                    onChange={(event) =>
                      updateForm("priceOnyx", Number(event.target.value))
                    }
                  />
                </div>
              </label>
            ) : null}
          </div>
          <div className="chapter-entitlement-note">
            <LockSimple size={18} />
            <p>
              Reader page URLs are issued only after server-side publication,
              visibility, role, and entitlement checks.
            </p>
          </div>
        </section>

        <section className="chapter-management-card">
          <div className="chapter-management-section-heading">
            <div>
              <span>Reader assets</span>
              <h2>Pages &amp; order</h2>
            </div>
            <p>Fixed first and last pages remain controlled by site policy.</p>
          </div>
          {pages.length ? (
            <div className="chapter-management-pages">
              {pages.map((page, index) => (
                <article key={page.id}>
                  <img
                    src={page.previewUrl}
                    alt={`Chapter page ${index + 1}`}
                    width={110}
                    height={156}
                    loading="lazy"
                  />
                  <div>
                    <strong>Page {index + 1}</strong>
                    <span>
                      {page.width} × {page.height} ·{" "}
                      {page.processingStatus.toLowerCase()}
                    </span>
                    <small>SHA {page.sha256.slice(0, 12)}</small>
                  </div>
                  <div className="chapter-page-actions">
                    <button
                      type="button"
                      disabled={index === 0 || Boolean(busy)}
                      aria-label={`Move page ${index + 1} up`}
                      onClick={() => movePage(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={index === pages.length - 1 || Boolean(busy)}
                      aria-label={`Move page ${index + 1} down`}
                      onClick={() => movePage(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <label className="chapter-page-file-button">
                      <ImageIcon size={16} />
                      <span>Replace</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={Boolean(busy)}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) setPendingReplacement({ page, file });
                        }}
                      />
                    </label>
                    <button
                      className="is-danger"
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => setPendingRemoval(page)}
                    >
                      <Trash size={16} /> Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="chapter-management-empty">
              <ImageIcon size={28} />
              <div>
                <strong>No verified pages</strong>
                <span>Add at least one page before publishing.</span>
              </div>
            </div>
          )}
          <label className="chapter-page-add">
            <CloudArrowUp size={22} />
            <span>
              <strong>
                {busy === "add-page" ? "Adding page…" : "Add chapter page"}
              </strong>
              <small>JPEG, PNG, or WebP · 25 MB maximum</small>
            </span>
            <input
              ref={addInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={Boolean(busy)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void mutatePage("ADD", file);
              }}
            />
          </label>
        </section>

        <section className="chapter-management-card chapter-management-save">
          <label>
            <span>Reason for audit history</span>
            <textarea
              value={form.reason}
              minLength={6}
              maxLength={500}
              required
              placeholder="Example: Corrected page order and contributor credits"
              onChange={(event) => updateForm("reason", event.target.value)}
            />
          </label>
          <div>
            <span className={dirty ? "is-dirty" : ""}>
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <button
              className="button button-primary"
              type="submit"
              disabled={Boolean(busy) || !dirty}
            >
              {busy === "save" ? (
                <SpinnerGap size={18} className="is-spinning" />
              ) : (
                <FloppyDisk size={18} />
              )}
              {busy === "save" ? "Saving…" : "Save Chapter"}
            </button>
          </div>
        </section>
      </form>

      {message ? (
        <div
          className={`chapter-management-message ${messageKind}`}
          role={messageKind === "error" ? "alert" : "status"}
        >
          {messageKind === "success" ? (
            <CheckCircle size={18} weight="fill" />
          ) : (
            <WarningCircle size={18} />
          )}
          {message}
        </div>
      ) : null}

      <ConfirmActionDialog
        open={Boolean(pendingRemoval)}
        title="Remove this chapter page?"
        description={
          pendingRemoval
            ? `Page ${pendingRemoval.pageIndex + 1} will be removed from this release. This cannot be undone from the reader.`
            : ""
        }
        confirmLabel="Remove page"
        destructive
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => void removePage()}
      />
      <ConfirmActionDialog
        open={Boolean(pendingReplacement)}
        title="Replace this chapter page?"
        description={
          pendingReplacement
            ? `Page ${pendingReplacement.page.pageIndex + 1} will be replaced with ${pendingReplacement.file.name}. The previous object will be cleaned safely after the database update succeeds.`
            : ""
        }
        confirmLabel="Replace page"
        destructive
        onCancel={() => setPendingReplacement(null)}
        onConfirm={() => {
          const replacement = pendingReplacement;
          if (replacement) {
            void mutatePage("REPLACE", replacement.file, replacement.page);
          }
        }}
      />
    </main>
  );
}
