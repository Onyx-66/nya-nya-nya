"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  ArrowFatDown,
  ArrowFatUp,
  ArrowRight,
  CaretDown,
  ChatCircle,
  Eye,
  Gif,
  ImageSquare,
  PencilSimple,
  PushPin,
  Smiley,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  defaultDiscussionSettings,
  parseDiscussionSettings,
  type DiscussionSettings,
} from "@/lib/discussion-settings";

type DiscussionActor = {
  displayName: string;
  email: string;
  role: string;
};

type DiscussionReaction = {
  key: string;
  label?: string;
  emoji?: string;
  assetUrl?: string | null;
  count: number;
  reactedByViewer: boolean;
};

type TeamAffiliation = {
  id: string;
  name: string;
  badgeUrl: string | null;
  effect: {
    type: "BORDER" | "GLOW" | "ACCENT" | "SPARKLE" | "VERIFIED";
    config: {
      accentColor?: string;
      intensity?: number;
      motion?: "NONE" | "SUBTLE";
    };
  } | null;
};

type AffiliationOption = {
  id: string;
  name: string;
};

type DiscussionMedia = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  kind: "IMAGE" | "GIF";
  altText: string;
  url: string;
};

type DiscussionComment = {
  id: string;
  chapterSlug: string | null;
  parentId: string | null;
  depth: number;
  body: string;
  spoiler: number | boolean;
  moderationStatus: "VISIBLE" | "DELETED";
  pinnedAt: string | null;
  editedAt: string | null;
  deletionReason: "AUTHOR" | "MODERATION" | null;
  createdAt: string;
  updatedAt: string;
  displayName: string;
  role: string;
  voteScore: number;
  viewerVote: -1 | 0 | 1;
  ownedByViewer: number | boolean;
  reactions: DiscussionReaction[];
  media: DiscussionMedia[];
  teamAffiliation: TeamAffiliation | null;
};

type PendingMedia = DiscussionMedia & {
  uploadState: "ready" | "removing";
};

const emojiGroups = [
  {
    label: "Manga",
    values: ["🔥", "💯", "👑", "⚔️", "🗡️", "🌙", "✨", "🫶"],
  },
  {
    label: "Reactions",
    values: ["😀", "😂", "😍", "🤯", "😭", "😡", "😮", "🤔"],
  },
  {
    label: "Community",
    values: ["👍", "👎", "👏", "🙏", "❤️", "💔", "🧠", "🗿"],
  },
];

const COMMENTS_PAGE_SIZE = 10;

function roleLabel(role: string) {
  return {
    OWNER: "Owner",
    ADMINISTRATOR: "Admin",
    MODERATOR: "Moderator",
    TEAM_LEADER: "Team leader",
    UPLOADER: "Uploader",
    USER: "Reader",
  }[role] ?? "Reader";
}

function relativeDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "recently";
  const difference = date.getTime() - Date.now();
  const minutes = Math.round(difference / 60_000);
  const hours = Math.round(difference / 3_600_000);
  const days = Math.round(difference / 86_400_000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  if (Math.abs(days) < 7) return formatter.format(days, "day");
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function exactDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function EnhancedDiscussionSection({
  actor,
  seriesSlug,
  chapterSlug = null,
  showToast,
}: {
  actor: DiscussionActor | null;
  seriesSlug: string;
  chapterSlug?: string | null;
  showToast: (text: string) => void;
}) {
  const [comments, setComments] = useState<DiscussionComment[]>([]);
  const [count, setCount] = useState(0);
  const [settings, setSettings] = useState<DiscussionSettings>(
    defaultDiscussionSettings,
  );
  const [sort, setSort] = useState<"top" | "newest" | "oldest">("top");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [body, setBody] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<{
    id: string;
    name: string;
    depth: number;
  } | null>(null);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [eligibleAffiliations, setEligibleAffiliations] = useState<
    AffiliationOption[]
  >([]);
  const [affiliationTeamId, setAffiliationTeamId] = useState("");
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(
    new Set(),
  );
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(
    new Set(),
  );
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState(
    "Spoilers without a warning",
  );
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSpoiler, setEditSpoiler] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [visibleRootCount, setVisibleRootCount] = useState(
    COMMENTS_PAGE_SIZE,
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);
  const scopeLabel = chapterSlug ? "Chapter comments" : "Series discussion";

  const loadComments = useCallback(
    async ({
      background = false,
      signal,
    }: {
      background?: boolean;
      signal?: AbortSignal;
    } = {}) => {
      if (!background) {
        setLoading(true);
        setLoadError("");
      }
      const query = new URLSearchParams({ series: seriesSlug });
      if (chapterSlug) query.set("chapter", chapterSlug);
      try {
        const response = await fetch(
          `/api/v1/discussion-comments?${query.toString()}`,
          { signal },
        );
        const payload = (await response.json()) as {
          data?: DiscussionComment[];
          count?: number;
          settings?: DiscussionSettings;
          eligibleAffiliations?: AffiliationOption[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Comments could not be loaded.",
          );
        }
        setComments(payload.data ?? []);
        setCount(Number(payload.count ?? 0));
        setSettings(parseDiscussionSettings(payload.settings));
        const affiliations = payload.eligibleAffiliations ?? [];
        setEligibleAffiliations(affiliations);
        setAffiliationTeamId((current) =>
          affiliations.some((team) => team.id === current) ? current : "",
        );
      } catch (error) {
        if ((error as Error).name !== "AbortError" && !background) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Comments could not be loaded.",
          );
        }
      } finally {
        if (!signal?.aborted && !background) setLoading(false);
      }
    },
    [chapterSlug, seriesSlug],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadComments({ signal: controller.signal });
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadComments, refreshKey]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadComments({ background: true });
      }
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [loadComments]);

  const childrenByParent = useMemo(() => {
    const grouped = new Map<string, DiscussionComment[]>();
    for (const comment of comments) {
      if (!comment.parentId) continue;
      grouped.set(comment.parentId, [
        ...(grouped.get(comment.parentId) ?? []),
        comment,
      ]);
    }
    for (const children of grouped.values()) {
      children.sort(
        (left, right) =>
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime(),
      );
    }
    return grouped;
  }, [comments]);

  const rootComments = useMemo(() => {
    const roots = comments.filter((comment) => !comment.parentId);
    return [...roots].sort((left, right) => {
      if (Boolean(left.pinnedAt) !== Boolean(right.pinnedAt)) {
        return left.pinnedAt ? -1 : 1;
      }
      if (sort === "top") {
        const scoreDifference =
          Number(right.voteScore) - Number(left.voteScore);
        if (scoreDifference !== 0) return scoreDifference;
      }
      const leftDate = new Date(left.createdAt).getTime();
      const rightDate = new Date(right.createdAt).getTime();
      return sort === "oldest" ? leftDate - rightDate : rightDate - leftDate;
    });
  }, [comments, sort]);

  const visibleRoots = rootComments.slice(0, visibleRootCount);
  const enabledReactions = settings.reactions.filter(
    (reaction) => reaction.enabled,
  );

  function signInToComment() {
    const returnTo = chapterSlug
      ? `/title/${seriesSlug}/chapter/${chapterSlug}#comments`
      : `/title/${seriesSlug}#comments`;
    window.location.assign(
      `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`,
    );
  }

  function startReply(comment: DiscussionComment) {
    if (!actor) {
      signInToComment();
      return;
    }
    setReplyTo({
      id: comment.id,
      name: comment.displayName,
      depth: Number(comment.depth),
    });
    setBody("");
    setSpoiler(false);
    setEmojiOpen(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function cancelReply() {
    setReplyTo(null);
    setBody("");
    setSpoiler(false);
    setEmojiOpen(false);
  }

  function insertEmoji(emoji: string) {
    const textarea = composerRef.current;
    if (!textarea) {
      setBody((current) => `${current}${emoji}`);
      return;
    }
    const start = textarea.selectionStart ?? body.length;
    const end = textarea.selectionEnd ?? start;
    const next = `${body.slice(0, start)}${emoji}${body.slice(end)}`.slice(
      0,
      2500,
    );
    setBody(next);
    setEmojiOpen(false);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const cursor = Math.min(start + emoji.length, next.length);
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  async function uploadMedia(file: File | undefined) {
    if (!file || uploadingMedia) return;
    if (pendingMedia.length >= settings.maxAttachments) {
      setMediaError(
        `You can add up to ${settings.maxAttachments} attachments.`,
      );
      return;
    }
    setUploadingMedia(true);
    setMediaError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("altText", file.name.replace(/\.[^.]+$/, "").replaceAll("_", " "));
      const response = await fetch("/api/v1/discussion-media", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as DiscussionMedia & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "The attachment could not be uploaded.",
        );
      }
      setPendingMedia((current) => [
        ...current,
        { ...payload, uploadState: "ready" },
      ]);
    } catch (error) {
      setMediaError(
        error instanceof Error
          ? error.message
          : "The attachment could not be uploaded.",
      );
    } finally {
      setUploadingMedia(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (gifInputRef.current) gifInputRef.current.value = "";
    }
  }

  async function removePendingMedia(media: PendingMedia) {
    setPendingMedia((current) =>
      current.map((entry) =>
        entry.id === media.id ? { ...entry, uploadState: "removing" } : entry,
      ),
    );
    try {
      const response = await fetch(
        `/api/v1/discussion-media?id=${encodeURIComponent(media.id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "The attachment could not be removed.",
        );
      }
      setPendingMedia((current) =>
        current.filter((entry) => entry.id !== media.id),
      );
    } catch (error) {
      setPendingMedia((current) =>
        current.map((entry) =>
          entry.id === media.id ? { ...entry, uploadState: "ready" } : entry,
        ),
      );
      setMediaError(
        error instanceof Error
          ? error.message
          : "The attachment could not be removed.",
      );
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actor) {
      signInToComment();
      return;
    }
    const nextBody = body.trim();
    if (nextBody.length < 2 && pendingMedia.length === 0) {
      showToast("Write at least two characters or attach an image.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/discussion-comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesSlug,
          chapterSlug,
          parentId: replyTo?.id ?? null,
          body: nextBody,
          spoiler,
          mediaIds: pendingMedia.map((media) => media.id),
          affiliationTeamId: affiliationTeamId || null,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Comment could not be posted.",
        );
      }
      const postedReply = Boolean(replyTo);
      setBody("");
      setSpoiler(false);
      setReplyTo(null);
      setPendingMedia([]);
      setMediaError("");
      setRefreshKey((value) => value + 1);
      showToast(postedReply ? "Reply posted." : "Comment posted.");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Comment could not be posted.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function setVote(comment: DiscussionComment, nextVote: -1 | 1) {
    if (!actor) {
      signInToComment();
      return;
    }
    const previousVote = Number(comment.viewerVote) as -1 | 0 | 1;
    const desiredVote: -1 | 0 | 1 =
      previousVote === nextVote ? 0 : nextVote;
    const optimisticScore =
      Number(comment.voteScore) - previousVote + desiredVote;
    setBusyAction(`vote:${comment.id}`);
    setComments((current) =>
      current.map((entry) =>
        entry.id === comment.id
          ? {
              ...entry,
              viewerVote: desiredVote,
              voteScore: optimisticScore,
            }
          : entry,
      ),
    );
    try {
      const response = await fetch("/api/v1/discussion-votes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commentId: comment.id,
          value: desiredVote,
        }),
      });
      const payload = (await response.json()) as {
        viewerVote?: -1 | 0 | 1;
        voteScore?: number;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Vote could not be saved.");
      }
      setComments((current) =>
        current.map((entry) =>
          entry.id === comment.id
            ? {
                ...entry,
                viewerVote: payload.viewerVote ?? 0,
                voteScore: Number(payload.voteScore ?? 0),
              }
            : entry,
        ),
      );
    } catch (error) {
      setComments((current) =>
        current.map((entry) =>
          entry.id === comment.id
            ? {
                ...entry,
                viewerVote: previousVote,
                voteScore: Number(comment.voteScore),
              }
            : entry,
        ),
      );
      showToast(
        error instanceof Error ? error.message : "Vote could not be saved.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function setReaction(comment: DiscussionComment, reactionKey: string) {
    if (!actor) {
      signInToComment();
      return;
    }
    setReactionPickerId(null);
    setBusyAction(`reaction:${comment.id}`);
    try {
      const response = await fetch("/api/v1/discussion-reactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commentId: comment.id,
          reaction: reactionKey,
        }),
      });
      const payload = (await response.json()) as {
        reactions?: DiscussionReaction[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Reaction could not be saved.",
        );
      }
      setComments((current) =>
        current.map((entry) =>
          entry.id === comment.id
            ? { ...entry, reactions: payload.reactions ?? [] }
            : entry,
        ),
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Reaction could not be saved.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function saveEdit(comment: DiscussionComment) {
    const nextBody = editBody.trim();
    if (nextBody.length < 2) {
      showToast("Write at least two characters.");
      return;
    }
    setBusyAction(`edit:${comment.id}`);
    try {
      const response = await fetch("/api/v1/discussion-comments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commentId: comment.id,
          body: nextBody,
          spoiler: editSpoiler,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Comment could not be edited.");
      }
      setComments((current) =>
        current.map((entry) =>
          entry.id === comment.id
            ? {
                ...entry,
                body: nextBody,
                spoiler: editSpoiler,
                editedAt: new Date().toISOString(),
              }
            : entry,
        ),
      );
      setEditingId(null);
      showToast("Comment updated.");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Comment could not be edited.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function reportComment(commentId: string) {
    if (!actor) {
      signInToComment();
      return;
    }
    setBusyAction(`report:${commentId}`);
    try {
      const response = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetType: "COMMENT",
          targetId: commentId,
          category: reportReason,
          detail: `Reader report from the ${
            chapterSlug ? "chapter" : "series"
          } discussion: ${reportReason}.`,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Report could not be sent.");
      }
      setReportedIds((current) => new Set(current).add(commentId));
      setReportingId(null);
      showToast("Report sent for moderator review.");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Report could not be sent.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function removeComment(commentId: string) {
    setBusyAction(`delete:${commentId}`);
    try {
      const response = await fetch(
        `/api/v1/discussion-comments?id=${encodeURIComponent(commentId)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Comment could not be removed.",
        );
      }
      setDeletingId(null);
      setRefreshKey((value) => value + 1);
      showToast("Comment removed.");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Comment could not be removed.",
      );
    } finally {
      setBusyAction("");
    }
  }

  async function togglePin(comment: DiscussionComment) {
    if (
      !actor ||
      !["OWNER", "ADMINISTRATOR", "MODERATOR"].includes(actor.role)
    ) return;
    const pinned = !comment.pinnedAt;
    setBusyAction(`pin:${comment.id}`);
    try {
      const response = await fetch("/api/v1/discussion-pin", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commentId: comment.id, pinned }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Pinned state could not be changed.",
        );
      }
      setComments((current) =>
        current.map((entry) =>
          entry.id === comment.id
            ? {
                ...entry,
                pinnedAt: pinned ? new Date().toISOString() : null,
              }
            : entry,
        ),
      );
      showToast(pinned ? "Comment pinned." : "Comment unpinned.");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Pinned state could not be changed.",
      );
    } finally {
      setBusyAction("");
    }
  }

  function renderMediaToolbar() {
    return (
      <div className="composer-media-toolbar">
        {settings.allowImages ? (
          <>
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={
                uploadingMedia ||
                pendingMedia.length >= settings.maxAttachments
              }
            >
              <ImageSquare size={18} /> Image
            </button>
            <input
              ref={imageInputRef}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) =>
                void uploadMedia(event.target.files?.[0])
              }
            />
          </>
        ) : null}
        {settings.allowGifs ? (
          <>
            <button
              type="button"
              onClick={() => gifInputRef.current?.click()}
              disabled={
                uploadingMedia ||
                pendingMedia.length >= settings.maxAttachments
              }
            >
              <Gif size={18} /> GIF
            </button>
            <input
              ref={gifInputRef}
              className="sr-only"
              type="file"
              accept="image/gif"
              onChange={(event) =>
                void uploadMedia(event.target.files?.[0])
              }
            />
          </>
        ) : null}
        <div className="emoji-picker-wrap">
          <button
            type="button"
            aria-expanded={emojiOpen}
            aria-controls="discussion-emoji-picker"
            onClick={() => setEmojiOpen((current) => !current)}
          >
            <Smiley size={18} /> Emoji
          </button>
          {emojiOpen ? (
            <div
              className="emoji-picker"
              id="discussion-emoji-picker"
              role="dialog"
              aria-label="Choose an emoji"
            >
              <header>
                <strong>Emoji</strong>
                <button
                  type="button"
                  aria-label="Close emoji picker"
                  onClick={() => setEmojiOpen(false)}
                >
                  <X size={16} />
                </button>
              </header>
              {emojiGroups.map((group) => (
                <section key={group.label}>
                  <span>{group.label}</span>
                  <div>
                    {group.values.map((emoji) => (
                      <button
                        type="button"
                        key={emoji}
                        aria-label={`Insert ${emoji}`}
                        onClick={() => insertEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </div>
        {uploadingMedia ? (
          <span className="media-uploading" role="status">
            <SpinnerGap size={16} className="spin" /> Uploading…
          </span>
        ) : null}
      </div>
    );
  }

  function renderPendingMedia() {
    if (pendingMedia.length === 0 && !mediaError) return null;
    return (
      <>
        {pendingMedia.length > 0 ? (
          <div className="pending-media-tray" aria-label="Comment attachments">
            {pendingMedia.map((media) => (
              <article key={media.id}>
                <img src={media.url} alt={media.altText || media.filename} />
                <div>
                  <strong>{media.kind === "GIF" ? "GIF" : "Image"}</strong>
                  <span>{formatBytes(media.byteSize)}</span>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${media.filename}`}
                  disabled={media.uploadState === "removing"}
                  onClick={() => void removePendingMedia(media)}
                >
                  {media.uploadState === "removing" ? (
                    <SpinnerGap size={16} className="spin" />
                  ) : (
                    <X size={16} />
                  )}
                </button>
              </article>
            ))}
          </div>
        ) : null}
        {mediaError ? (
          <p className="comment-media-error" role="alert">
            <WarningCircle size={16} /> {mediaError}
          </p>
        ) : null}
      </>
    );
  }

  function renderComposer(inline = false) {
    if (!actor) return null;
    return (
      <form
        className={`comment-composer ${
          inline ? "comment-composer-inline" : ""
        }`}
        onSubmit={submitComment}
        aria-busy={submitting || uploadingMedia}
      >
          <div className="comment-composer-heading">
          <div className="comment-avatar" aria-hidden="true">
            {actor.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <strong>{inline ? `Reply to ${replyTo?.name}` : "Join the discussion"}</strong>
            <span>Posting as {actor.displayName}</span>
          </div>
          {inline ? (
            <button
              className="composer-close"
              type="button"
              aria-label="Cancel reply"
              onClick={cancelReply}
            >
              <X size={17} />
            </button>
          ) : null}
        </div>
        <label className="comment-field">
          <span className="sr-only">{inline ? "Reply" : "Comment"}</span>
          <textarea
            ref={composerRef}
            value={body}
            maxLength={2500}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              inline
                ? `Reply to ${replyTo?.name}`
                : chapterSlug
                  ? "What did you think of this chapter?"
                  : "Share a theory, reaction, or recommendation"
            }
          />
        </label>
        {renderPendingMedia()}
        <div className="comment-composer-tools">
          {renderMediaToolbar()}
          <div className="comment-composer-actions">
            <label>
              <input
                type="checkbox"
                checked={spoiler}
                onChange={(event) => setSpoiler(event.target.checked)}
              />
              Contains spoilers
            </label>
            <span>{body.length} / 2500</span>
            <button
              className="button button-primary"
              type="submit"
              disabled={
                submitting ||
                uploadingMedia ||
                (body.trim().length < 2 && pendingMedia.length === 0)
              }
            >
              {submitting ? (
                <>
                  <SpinnerGap size={16} className="spin" /> Posting…
                </>
              ) : (
                <>
                  {inline ? "Post reply" : "Post comment"}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
            </div>
            {eligibleAffiliations.length > 1 ? (
              <label className="comment-affiliation-select">
                <span>Team affiliation</span>
                <select
                  value={affiliationTeamId}
                  onChange={(event) =>
                    setAffiliationTeamId(event.target.value)
                  }
                >
                  <option value="">Automatic</option>
                  {eligibleAffiliations.map((team) => (
                    <option value={team.id} key={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
      </form>
    );
  }

  function renderComment(comment: DiscussionComment) {
    const removed = comment.moderationStatus === "DELETED";
    const hiddenSpoiler =
      Boolean(comment.spoiler) && !revealedSpoilers.has(comment.id);
    const replies = childrenByParent.get(comment.id) ?? [];
    const repliesExpanded = expandedReplies.has(comment.id);
    const visibleReplies = repliesExpanded ? replies : [];
    const repliesId = `comment-replies-${comment.id}`;
    const canReply =
      !removed && Number(comment.depth) < settings.maxReplyDepth;
    const selectedReaction = comment.reactions.find(
      (reaction) => reaction.reactedByViewer,
    )?.key;
    const enabledByKey = new Map(
      enabledReactions.map((reaction) => [reaction.key, reaction]),
    );
    const displayedReactions = [
      ...new Set([
        ...enabledReactions.map((reaction) => reaction.key),
        ...comment.reactions.map((reaction) => reaction.key),
      ]),
    ]
      .map((key) => {
        const active = enabledByKey.get(key);
        const historical = comment.reactions.find(
          (reaction) => reaction.key === key,
        );
        return {
          key,
          label: active?.label ?? historical?.label ?? key,
          emoji: active?.emoji ?? historical?.emoji ?? "",
          assetUrl: active?.assetUrl ?? historical?.assetUrl ?? null,
          enabled: Boolean(active),
          count: historical?.count ?? 0,
          reactedByViewer: Boolean(historical?.reactedByViewer),
        };
      })
      .filter((reaction) => reaction.count > 0 || reaction.reactedByViewer);
    const teamEffect = comment.teamAffiliation?.effect;
    const teamIntensity = Math.min(
      3,
      Math.max(1, Number(teamEffect?.config.intensity ?? 1)),
    );
    const effectStyle = teamEffect
      ? ({
          "--comment-team-accent":
            teamEffect.config.accentColor ?? "#2d8cff",
          "--comment-team-border-mix": `${18 + teamIntensity * 8}%`,
          "--comment-team-background-mix": `${3 + teamIntensity * 2}%`,
          "--comment-team-glow": `${teamIntensity * 7}px`,
        } as CSSProperties)
      : undefined;

    return (
      <article
        className={[
          "comment-item",
          `comment-depth-${Math.min(Number(comment.depth), 4)}`,
          teamEffect
            ? `comment-team-effect comment-team-effect-${teamEffect.type.toLowerCase()}`
            : "",
          teamEffect?.config.motion === "SUBTLE"
            ? "comment-team-effect-motion"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        key={comment.id}
        id={`comment-${comment.id}`}
        style={effectStyle}
      >
        <div className="comment-avatar" aria-hidden="true">
          {comment.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="comment-content">
          <header className="comment-meta">
            <div>
              <strong>{comment.displayName}</strong>
              {comment.teamAffiliation?.badgeUrl ? (
                <img
                  className="comment-team-badge"
                  src={comment.teamAffiliation.badgeUrl}
                  alt={`${comment.teamAffiliation.name} team`}
                  title={comment.teamAffiliation.name}
                  loading="lazy"
                />
              ) : null}
              <span
                className={`comment-role comment-role-${comment.role.toLowerCase()}`}
              >
                {roleLabel(comment.role)}
              </span>
              {comment.editedAt ? <em>edited</em> : null}
            </div>
            <time
              dateTime={comment.createdAt}
              title={exactDate(comment.createdAt)}
            >
              {relativeDate(comment.createdAt)}
            </time>
          </header>

          {comment.pinnedAt ? (
            <span className="comment-pinned">
              <PushPin size={14} weight="fill" /> Pinned by moderation
            </span>
          ) : null}

          {!chapterSlug && comment.chapterSlug ? (
            <a
              className="comment-source-link"
              href={`/title/${seriesSlug}/chapter/${comment.chapterSlug}#comment-${comment.id}`}
            >
              Chapter discussion
              <ArrowRight size={14} />
            </a>
          ) : null}

          {removed ? (
            <p className="comment-removed">
              {comment.deletionReason === "MODERATION"
                ? "Comment removed by a moderator."
                : "Comment removed by its author."}
            </p>
          ) : editingId === comment.id ? (
            <div className="comment-edit-form">
              <textarea
                value={editBody}
                maxLength={2500}
                onChange={(event) => setEditBody(event.target.value)}
                aria-label="Edit comment"
              />
              <div>
                <label>
                  <input
                    type="checkbox"
                    checked={editSpoiler}
                    onChange={(event) => setEditSpoiler(event.target.checked)}
                  />
                  Contains spoilers
                </label>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={busyAction === `edit:${comment.id}`}
                  onClick={() => void saveEdit(comment)}
                >
                  Save edit
                </button>
              </div>
            </div>
          ) : hiddenSpoiler ? (
            <button
              className="spoiler-cover"
              type="button"
              onClick={() =>
                setRevealedSpoilers((current) =>
                  new Set(current).add(comment.id),
                )
              }
            >
              <Eye size={17} />
              Spoiler hidden. Tap to reveal.
            </button>
          ) : (
            <>
              {comment.body ? (
                <p className="comment-body">{comment.body}</p>
              ) : null}
              {comment.media.length > 0 ? (
                <div
                  className={`comment-media-grid media-count-${Math.min(
                    comment.media.length,
                    4,
                  )}`}
                >
                  {comment.media.map((media) => (
                    <a
                      href={media.url}
                      target="_blank"
                      rel="noreferrer"
                      key={media.id}
                      aria-label={`Open ${media.kind === "GIF" ? "GIF" : "image"}`}
                    >
                      <img
                        src={media.url}
                        loading="lazy"
                        alt={
                          media.altText ||
                          `${comment.displayName} shared an attachment`
                        }
                      />
                      {media.kind === "GIF" ? <span>GIF</span> : null}
                    </a>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {!removed && editingId !== comment.id ? (
            <>
              <div className="comment-engagement">
                <div
                  className="comment-votes"
                  aria-label={`Vote score ${comment.voteScore}`}
                >
                  <button
                    type="button"
                    aria-label="Upvote"
                    aria-pressed={Number(comment.viewerVote) === 1}
                    disabled={busyAction === `vote:${comment.id}`}
                    onClick={() => void setVote(comment, 1)}
                  >
                    <ArrowFatUp
                      size={17}
                      weight={
                        Number(comment.viewerVote) === 1 ? "fill" : "regular"
                      }
                    />
                  </button>
                  <strong>{Number(comment.voteScore)}</strong>
                  <button
                    type="button"
                    aria-label="Downvote"
                    aria-pressed={Number(comment.viewerVote) === -1}
                    disabled={busyAction === `vote:${comment.id}`}
                    onClick={() => void setVote(comment, -1)}
                  >
                    <ArrowFatDown
                      size={17}
                      weight={
                        Number(comment.viewerVote) === -1 ? "fill" : "regular"
                      }
                    />
                  </button>
                </div>

                <div className="comment-reaction-summary">
                  {displayedReactions.map((reaction) => (
                    <button
                      type="button"
                      key={reaction.key}
                      aria-pressed={reaction.reactedByViewer}
                      aria-label={`${reaction.label}: ${reaction.count}`}
                      disabled={
                        !reaction.enabled ||
                        busyAction === `reaction:${comment.id}`
                      }
                      onClick={() => void setReaction(comment, reaction.key)}
                    >
                      <span>
                        {reaction.assetUrl ? (
                          <img
                            src={reaction.assetUrl}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          reaction.emoji
                        )}
                      </span>
                      {reaction.count}
                    </button>
                  ))}
                  <div className="comment-reaction-picker-wrap">
                    <button
                      type="button"
                      className="add-reaction"
                      aria-label="Add a reaction"
                      aria-expanded={reactionPickerId === comment.id}
                      disabled={busyAction === `reaction:${comment.id}`}
                      onClick={() =>
                        setReactionPickerId((current) =>
                          current === comment.id ? null : comment.id,
                        )
                      }
                    >
                      <Smiley size={17} />
                      {displayedReactions.length === 0 ? "React" : null}
                    </button>
                    {reactionPickerId === comment.id ? (
                      <div
                        className="comment-reaction-picker"
                        role="dialog"
                        aria-label="Choose a reaction"
                      >
                        {enabledReactions.map((reaction) => (
                          <button
                            type="button"
                            key={reaction.key}
                            aria-pressed={selectedReaction === reaction.key}
                            disabled={busyAction === `reaction:${comment.id}`}
                            onClick={() =>
                              void setReaction(comment, reaction.key)
                            }
                          >
                            <span>
                              {reaction.assetUrl ? (
                                <img
                                  src={reaction.assetUrl}
                                  alt=""
                                  loading="lazy"
                                />
                              ) : (
                                reaction.emoji
                              )}
                            </span>
                            {reaction.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="comment-actions">
                {!comment.parentId &&
                actor &&
                ["OWNER", "ADMINISTRATOR", "MODERATOR"].includes(actor.role) ? (
                  <button
                    type="button"
                    aria-pressed={Boolean(comment.pinnedAt)}
                    disabled={busyAction === `pin:${comment.id}`}
                    onClick={() => void togglePin(comment)}
                  >
                    <PushPin size={16} />
                    {comment.pinnedAt ? "Unpin" : "Pin"}
                  </button>
                ) : null}
                {canReply ? (
                  <button
                    type="button"
                    aria-expanded={replyTo?.id === comment.id}
                    onClick={() => startReply(comment)}
                  >
                    <ChatCircle size={16} /> Reply
                  </button>
                ) : null}
                {Boolean(comment.ownedByViewer) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(comment.id);
                      setEditBody(comment.body);
                      setEditSpoiler(Boolean(comment.spoiler));
                    }}
                  >
                    <PencilSimple size={16} /> Edit
                  </button>
                ) : null}
                {reportedIds.has(comment.id) ? (
                  <span>Reported</span>
                ) : (
                  <button
                    type="button"
                    aria-expanded={reportingId === comment.id}
                    onClick={() =>
                      setReportingId((current) =>
                        current === comment.id ? null : comment.id,
                      )
                    }
                  >
                    <WarningCircle size={16} /> Report
                  </button>
                )}
                {Boolean(comment.ownedByViewer) ||
                (actor &&
                  ["OWNER", "ADMINISTRATOR", "MODERATOR"].includes(
                    actor.role,
                  )) ? (
                  <button
                    className="comment-delete"
                    type="button"
                    aria-expanded={deletingId === comment.id}
                    onClick={() =>
                      setDeletingId((current) =>
                        current === comment.id ? null : comment.id,
                      )
                    }
                  >
                    <Trash size={16} /> Remove
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {reportingId === comment.id ? (
            <div className="comment-inline-action">
              <label>
                <span>Reason</span>
                <select
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value)}
                >
                  <option>Spoilers without a warning</option>
                  <option>Harassment or hate</option>
                  <option>Spam or promotion</option>
                  <option>Illegal content</option>
                </select>
              </label>
              <button
                type="button"
                disabled={busyAction === `report:${comment.id}`}
                onClick={() => void reportComment(comment.id)}
              >
                Send report
              </button>
              <button type="button" onClick={() => setReportingId(null)}>
                Cancel
              </button>
            </div>
          ) : null}

          {deletingId === comment.id ? (
            <div className="comment-inline-action comment-remove-confirm">
              <span>
                {actor &&
                ["OWNER", "ADMINISTRATOR", "MODERATOR"].includes(actor.role) &&
                !Boolean(comment.ownedByViewer)
                  ? "Remove this comment as moderator?"
                  : "Remove this comment?"}
              </span>
              <button
                type="button"
                disabled={busyAction === `delete:${comment.id}`}
                onClick={() => void removeComment(comment.id)}
              >
                Remove
              </button>
              <button type="button" onClick={() => setDeletingId(null)}>
                Keep it
              </button>
            </div>
          ) : null}

          {replyTo?.id === comment.id ? renderComposer(true) : null}

          {visibleReplies.length > 0 ? (
            <div className="comment-replies" id={repliesId}>
              {visibleReplies.map((reply) => renderComment(reply))}
            </div>
          ) : null}
          {replies.length > 0 ? (
            <button
              className="show-replies"
              type="button"
              aria-expanded={repliesExpanded}
              aria-controls={repliesId}
              onClick={() =>
                setExpandedReplies((current) => {
                  const next = new Set(current);
                  if (next.has(comment.id)) {
                    next.delete(comment.id);
                  } else {
                    next.add(comment.id);
                  }
                  return next;
                })
              }
            >
              <CaretDown size={15} />
              {repliesExpanded
                ? "Hide replies"
                : `Show ${replies.length} ${
                    replies.length === 1 ? "reply" : "replies"
                  }`}
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <section
      className={`series-comments enhanced-comments ${
        chapterSlug ? "chapter-comments" : ""
      }`}
      id="comments"
      aria-labelledby="comments-title"
    >
      <header className="comments-header">
        <div>
          <p className="eyebrow">{count} comments</p>
          <h2 id="comments-title">{scopeLabel}</h2>
          <span>
            Discuss the story, share panels and GIFs, and mark every spoiler.
          </span>
        </div>
        <div className="comments-toolbar">
          <div className="comment-sort" role="group" aria-label="Sort comments">
            {(["top", "newest", "oldest"] as const).map((option) => (
              <button
                type="button"
                key={option}
                aria-pressed={sort === option}
                onClick={() => {
                  setSort(option);
                  setVisibleRootCount(COMMENTS_PAGE_SIZE);
                }}
              >
                {option === "top"
                  ? "Best"
                  : option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
          <button
            className="comments-refresh"
            type="button"
            aria-label="Refresh comments"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <ArrowClockwise size={17} />
          </button>
        </div>
      </header>

      {actor && !replyTo ? renderComposer() : null}
      {!actor ? (
        <div className="comment-signin">
          <ChatCircle size={27} />
          <div>
            <strong>Sign in to join the discussion</strong>
            <span>
              Vote, react, reply, and share images with your reader profile.
            </span>
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={signInToComment}
          >
            Sign in
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="comment-loading" role="status" aria-label="Loading comments">
          <span />
          <span />
          <span />
        </div>
      ) : loadError ? (
        <div className="comment-error" role="alert">
          <WarningCircle size={21} />
          <div>
            <strong>Comments are temporarily unavailable</strong>
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : visibleRoots.length > 0 ? (
        <>
          <div className="comment-list">
            {visibleRoots.map((comment) => renderComment(comment))}
          </div>
          {visibleRootCount < rootComments.length ? (
            <button
              className="load-more-comments"
              type="button"
              onClick={() =>
                setVisibleRootCount((value) => value + COMMENTS_PAGE_SIZE)
              }
            >
              Load more comments
              <span>
                {rootComments.length - visibleRootCount} remaining
              </span>
            </button>
          ) : null}
        </>
      ) : (
        <div className="comment-empty">
          <ChatCircle size={30} />
          <strong>Start the discussion</strong>
          <span>
            Be the first reader to leave a theory, reaction, image, or GIF.
          </span>
        </div>
      )}
    </section>
  );
}
