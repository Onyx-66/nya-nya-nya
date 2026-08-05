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
  FilmStrip,
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
  type ReactNode,
} from "react";
import {
  defaultDiscussionSettings,
  parseDiscussionSettings,
  type DiscussionSettings,
} from "@/lib/discussion-settings";
import { optimizeStaticMedia } from "@/lib/client/media-optimizer";
import type { EmojiCatalogEntry } from "@/lib/emoji-catalog";

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

type CuratedGif = {
  id: string;
  name: string;
  label: string;
  category: string;
  url: string;
};

type CommentGif = {
  id: string;
  name: string;
  altText: string;
  url: string;
};

type CommentCosmetic = {
  id: string;
  name: string;
  category: "COMMENT_EFFECT" | "COMMENT_GRADIENT";
  previewUrl: string | null;
  config: {
    from?: unknown;
    to?: unknown;
    accent?: unknown;
    commentOpacity?: unknown;
  };
};

type DiscussionComment = {
  id: string;
  chapterSlug: string | null;
  chapterNumber: string | null;
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
  avatarUrl: string | null;
  voteScore: number;
  viewerVote: -1 | 0 | 1;
  ownedByViewer: number | boolean;
  reactions: DiscussionReaction[];
  media: DiscussionMedia[];
  gifs: CommentGif[];
  commentCosmetic: CommentCosmetic | null;
  teamAffiliation: TeamAffiliation | null;
};

type PendingMedia = DiscussionMedia & {
  uploadState: "ready" | "removing";
};

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

function cosmeticColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : fallback;
}

export function EnhancedDiscussionSection({
  actor,
  seriesSlug,
  chapterSlug = null,
  reactionPrompt = null,
  showToast,
}: {
  actor: DiscussionActor | null;
  seriesSlug: string;
  chapterSlug?: string | null;
  reactionPrompt?: ReactNode;
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
  const [curatedGifs, setCuratedGifs] = useState<CuratedGif[]>([]);
  const [selectedGifIds, setSelectedGifIds] = useState<string[]>([]);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifCategory, setGifCategory] = useState("ALL");
  const [viewerAvatarUrl, setViewerAvatarUrl] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiCatalog, setEmojiCatalog] = useState<EmojiCatalogEntry[]>([]);
  const [emojiGroupOptions, setEmojiGroupOptions] = useState<
    Array<{ slug: string; name: string }>
  >([{ slug: "all", name: "All" }]);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [emojiGroup, setEmojiGroup] = useState("all");
  const [emojiLimit, setEmojiLimit] = useState(240);
  const [emojiLoading, setEmojiLoading] = useState(false);
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
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const scopeLabel = chapterSlug ? "Chapter comments" : "Series discussion";
  const gifCategories = useMemo(
    () => [
      "ALL",
      ...Array.from(
        new Set(curatedGifs.map((gif) => gif.category).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right)),
    ],
    [curatedGifs],
  );
  const visibleGifs = useMemo(() => {
    const term = gifQuery.trim().toLowerCase();
    return curatedGifs.filter(
      (gif) =>
        (gifCategory === "ALL" || gif.category === gifCategory) &&
        (!term ||
          gif.name.toLowerCase().includes(term) ||
          gif.label.toLowerCase().includes(term) ||
          gif.category.toLowerCase().includes(term)),
    );
  }, [curatedGifs, gifCategory, gifQuery]);
  const matchingEmojis = useMemo(() => {
    const terms = emojiQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return emojiCatalog.filter(
      (entry) =>
        (emojiGroup === "all" || entry.groupSlug === emojiGroup) &&
        terms.every((term) => entry.searchText.includes(term)),
    );
  }, [emojiCatalog, emojiGroup, emojiQuery]);
  const visibleEmojis = matchingEmojis.slice(0, emojiLimit);

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
          viewer?: { avatarUrl?: string | null } | null;
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
        const rawSettings = payload.settings as
          | (DiscussionSettings & { gifs?: CuratedGif[] })
          | undefined;
        setSettings(parseDiscussionSettings(rawSettings));
        setCuratedGifs(rawSettings?.gifs ?? []);
        setViewerAvatarUrl(payload.viewer?.avatarUrl ?? null);
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
    if (!emojiOpen || emojiCatalog.length > 0 || emojiLoading) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setEmojiLoading(true);
      void import("@/lib/emoji-catalog")
        .then((catalog) => {
          if (cancelled) return;
          setEmojiCatalog(catalog.emojiCatalog);
          setEmojiGroupOptions(catalog.emojiGroups);
        })
        .catch(() => {
          if (!cancelled) {
            showToast("The emoji catalog could not be loaded.");
          }
        })
        .finally(() => {
          if (!cancelled) setEmojiLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [emojiCatalog.length, emojiLoading, emojiOpen, showToast]);

  useEffect(() => {
    if (!gifPickerOpen && !emojiOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [emojiOpen, gifPickerOpen]);

  useEffect(() => {
    if (!gifPickerOpen && !emojiOpen) return;
    function closeMediaPicker(event: KeyboardEvent) {
      if (event.key === "Escape") {
        const focusTarget = gifPickerOpen
          ? gifButtonRef.current
          : emojiButtonRef.current;
        setGifPickerOpen(false);
        setEmojiOpen(false);
        window.requestAnimationFrame(() => focusTarget?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const picker = document.getElementById(
        gifPickerOpen ? "comment-gif-picker" : "discussion-emoji-picker",
      );
      const focusable = Array.from(
        picker?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
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
    document.addEventListener("keydown", closeMediaPicker);
    return () => document.removeEventListener("keydown", closeMediaPicker);
  }, [emojiOpen, gifPickerOpen]);

  useEffect(() => {
    if (!gifPickerOpen && !emojiOpen) return;
    const pickerId = gifPickerOpen
      ? "comment-gif-picker"
      : "discussion-emoji-picker";
    const focusFrame = window.requestAnimationFrame(() => {
      document
        .getElementById(pickerId)
        ?.querySelector<HTMLElement>(
          'input[type="search"], input, select, button',
        )
        ?.focus();
    });
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      const picker = document.getElementById(pickerId);
      const trigger = gifPickerOpen
        ? gifButtonRef.current
        : emojiButtonRef.current;
      if (picker?.contains(event.target) || trigger?.contains(event.target)) {
        return;
      }
      setGifPickerOpen(false);
      setEmojiOpen(false);
      window.requestAnimationFrame(() => trigger?.focus());
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [emojiOpen, gifPickerOpen]);

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
    setGifPickerOpen(false);
    setEmojiOpen(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function cancelReply() {
    setReplyTo(null);
    setBody("");
    setSpoiler(false);
    setGifPickerOpen(false);
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
      const isGif =
        file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
      const typedFile =
        isGif && file.type !== "image/gif"
          ? new File([file], file.name, {
              type: "image/gif",
              lastModified: file.lastModified,
            })
          : file;
      if (isGif) {
        throw new Error(
          "Choose a GIF from the NyaScans GIF library instead.",
        );
      }
      const uploadFile = await optimizeStaticMedia(typedFile, {
        maxWidth: 2_048,
        maxHeight: 2_048,
        maxBytes: 2_500_000,
      });
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("altText", file.name.replace(/\.[^.]+$/, "").replaceAll("_", " "));
      const response = await fetch("/api/v1/discussion-media", {
        method: "POST",
        body: form,
      });
      const responseText = await response.text();
      let payload:
        | (DiscussionMedia & { error?: { message?: string } })
        | null = null;
      try {
        payload = JSON.parse(responseText) as DiscussionMedia & {
          error?: { message?: string };
        };
      } catch {
        // Some hosts return a plain-text body for request-size failures.
      }
      if (!response.ok) {
        if (
          response.status === 413 ||
          /payload too large/i.test(responseText)
        ) {
          throw new Error(
            "This attachment is too large to upload. Try a shorter GIF or a smaller image.",
          );
        }
        throw new Error(
          payload?.error?.message ?? "The attachment could not be uploaded.",
        );
      }
      if (!payload?.id) {
        throw new Error("The attachment could not be uploaded.");
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
    if (
      nextBody.length < 2 &&
      pendingMedia.length === 0 &&
      selectedGifIds.length === 0
    ) {
      showToast("Write at least two characters or attach an image or GIF.");
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
          gifIds: selectedGifIds,
          affiliationTeamId: affiliationTeamId || null,
        }),
      });
      const payload = (await response.json()) as {
        id?: string;
        rewardAmount?: number;
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
      setSelectedGifIds([]);
      setGifPickerOpen(false);
      setMediaError("");
      setRefreshKey((value) => value + 1);
      let rewardAmount = Number(payload.rewardAmount ?? 0);
      if (payload.id) {
        const rewardResponse = await fetch("/api/v1/rewards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "CLAIM_COMMENT",
            commentId: payload.id,
          }),
        }).catch(() => null);
        if (rewardResponse?.ok) {
          const reward = (await rewardResponse.json()) as {
            awarded?: boolean;
            amount?: number;
          };
          if (reward.awarded) rewardAmount = Number(reward.amount ?? 0);
        }
      }
      showToast(
        `${postedReply ? "Reply" : "Comment"} posted.${
          rewardAmount > 0 ? ` +${rewardAmount} Shards` : ""
        }`,
      );
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
      if (desiredVote === 1) {
        void fetch("/api/v1/rewards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "CLAIM_UPVOTE",
            commentId: comment.id,
          }),
        }).catch(() => {
          // The author's reward can be retried without affecting the vote.
        });
      }
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

  function closeGifPicker() {
    setGifPickerOpen(false);
    window.requestAnimationFrame(() => gifButtonRef.current?.focus());
  }

  function closeEmojiPicker() {
    setEmojiOpen(false);
    window.requestAnimationFrame(() => emojiButtonRef.current?.focus());
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
          <div className="comment-gif-picker-wrap">
            <button
              ref={gifButtonRef}
              type="button"
              aria-expanded={gifPickerOpen}
              aria-controls="comment-gif-picker"
              onClick={() => {
                setEmojiOpen(false);
                setGifPickerOpen((current) => !current);
              }}
              disabled={
                uploadingMedia ||
                pendingMedia.length + selectedGifIds.length >=
                  settings.maxAttachments
              }
            >
              <FilmStrip size={18} /> GIF
            </button>
            {gifPickerOpen ? (
              <div className="media-picker-backdrop">
                <div
                  className="comment-gif-picker"
                  id="comment-gif-picker"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Choose a GIF"
                >
                <header>
                  <div>
                    <strong>NyaScans GIFs</strong>
                    <span>Curated by the community team</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Close GIF picker"
                    onClick={closeGifPicker}
                  >
                    <X size={16} />
                  </button>
                </header>
                <div className="comment-gif-filters">
                  <label>
                    <span className="sr-only">Search GIFs</span>
                    <input
                      type="search"
                      value={gifQuery}
                      placeholder="Search GIFs"
                      onChange={(event) => setGifQuery(event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="sr-only">GIF category</span>
                    <select
                      value={gifCategory}
                      onChange={(event) => setGifCategory(event.target.value)}
                    >
                      {gifCategories.map((category) => (
                        <option value={category} key={category}>
                          {category === "ALL" ? "All categories" : category}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {curatedGifs.length === 0 ? (
                  <p className="comment-gif-empty" role="status">
                    The community team has not published any GIFs yet.
                  </p>
                ) : visibleGifs.length === 0 ? (
                  <p className="comment-gif-empty" role="status">
                    No curated GIF matches this search.
                  </p>
                ) : (
                  <div className="comment-gif-grid">
                  {visibleGifs.map((gif) => {
                    const selected = selectedGifIds.includes(gif.id);
                    return (
                      <button
                        type="button"
                        key={gif.id}
                        aria-pressed={selected}
                        title={`${gif.category} · ${gif.name}`}
                        onClick={() =>
                          setSelectedGifIds((current) =>
                            selected
                              ? current.filter((id) => id !== gif.id)
                              : pendingMedia.length + current.length <
                                  settings.maxAttachments
                                ? [...current, gif.id]
                                : current,
                          )
                        }
                      >
                        <img src={gif.url} alt={gif.label} loading="lazy" />
                        <span>{gif.name}</span>
                      </button>
                    );
                  })}
                  </div>
                )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="emoji-picker-wrap">
          <button
            ref={emojiButtonRef}
            type="button"
            aria-expanded={emojiOpen}
            aria-controls="discussion-emoji-picker"
            onClick={() => {
              setGifPickerOpen(false);
              setEmojiOpen((current) => !current);
            }}
          >
            <Smiley size={18} /> Emoji
          </button>
          {emojiOpen ? (
            <div className="media-picker-backdrop">
              <div
                className="emoji-picker"
                id="discussion-emoji-picker"
                role="dialog"
                aria-modal="true"
                aria-label="Choose an emoji"
              >
                <header>
                  <div>
                    <strong>Emoji</strong>
                    <span>{emojiCatalog.length || "Full Unicode"} emoji catalog</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Close emoji picker"
                    onClick={closeEmojiPicker}
                  >
                    <X size={16} />
                  </button>
                </header>
                <div className="emoji-picker-filters">
                  <label>
                    <span className="sr-only">Search emoji by name</span>
                    <input
                      type="search"
                      value={emojiQuery}
                      placeholder="Search emoji by name or keyword"
                      onChange={(event) => {
                        setEmojiQuery(event.target.value);
                        setEmojiLimit(240);
                      }}
                    />
                  </label>
                  <label>
                    <span className="sr-only">Emoji category</span>
                    <select
                      value={emojiGroup}
                      onChange={(event) => {
                        setEmojiGroup(event.target.value);
                        setEmojiLimit(240);
                      }}
                    >
                      {emojiGroupOptions.map((group) => (
                        <option value={group.slug} key={group.slug}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {emojiLoading ? (
                  <p className="emoji-picker-status" role="status">
                    <SpinnerGap size={17} className="spin" /> Loading emoji…
                  </p>
                ) : visibleEmojis.length === 0 ? (
                  <p className="emoji-picker-status" role="status">
                    No emoji matches this search.
                  </p>
                ) : (
                  <>
                    <div className="emoji-catalog-grid">
                      {visibleEmojis.map((entry) => (
                      <button
                        type="button"
                          key={entry.emoji}
                          aria-label={`Insert ${entry.name}`}
                          title={entry.name}
                          onClick={() => insertEmoji(entry.emoji)}
                      >
                          {entry.emoji}
                      </button>
                      ))}
                    </div>
                    <footer>
                      <span aria-live="polite">
                        Showing {visibleEmojis.length} of {matchingEmojis.length}
                      </span>
                      {visibleEmojis.length < matchingEmojis.length ? (
                        <button
                          type="button"
                          onClick={() =>
                            setEmojiLimit((current) => current + 240)
                          }
                        >
                          Show more
                        </button>
                      ) : null}
                    </footer>
                  </>
                )}
              </div>
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
    if (
      pendingMedia.length === 0 &&
      selectedGifIds.length === 0 &&
      !mediaError
    ) {
      return null;
    }
    const selectedGifs = selectedGifIds
      .map((id) => curatedGifs.find((gif) => gif.id === id))
      .filter((gif): gif is CuratedGif => Boolean(gif));
    return (
      <>
        {pendingMedia.length > 0 || selectedGifs.length > 0 ? (
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
            {selectedGifs.map((gif) => (
              <article key={gif.id}>
                <img src={gif.url} alt={gif.label} />
                <div>
                  <strong>{gif.name}</strong>
                  <span>{gif.category} · Curated GIF</span>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${gif.name}`}
                  onClick={() =>
                    setSelectedGifIds((current) =>
                      current.filter((id) => id !== gif.id),
                    )
                  }
                >
                  <X size={16} />
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
            <span>{actor.displayName.slice(0, 2).toUpperCase()}</span>
            {viewerAvatarUrl ? (
              <img
                src={viewerAvatarUrl}
                alt=""
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            ) : null}
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
                (body.trim().length < 2 &&
                  pendingMedia.length === 0 &&
                  selectedGifIds.length === 0)
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
    const cosmetic = comment.commentCosmetic;
    const cosmeticOpacity = Math.min(
      1,
      Math.max(
        0.1,
        Number(cosmetic?.config.commentOpacity ?? 65) / 100,
      ),
    );
    const cosmeticFrom = cosmeticColor(
      cosmetic?.config.from,
      "#0b4f7d",
    );
    const cosmeticTo = cosmeticColor(cosmetic?.config.to, "#07111f");
    const effectStyle =
      teamEffect || cosmetic
        ? ({
            ...(teamEffect
              ? {
          "--comment-team-accent":
            teamEffect.config.accentColor ?? "#2d8cff",
          "--comment-team-border-mix": `${18 + teamIntensity * 8}%`,
          "--comment-team-background-mix": `${3 + teamIntensity * 2}%`,
          "--comment-team-glow": `${teamIntensity * 7}px`,
                }
              : {}),
            ...(cosmetic
              ? {
                  "--comment-cosmetic-opacity": cosmeticOpacity,
                  "--comment-cosmetic-background": cosmetic.previewUrl
                    ? `url("${cosmetic.previewUrl}")`
                    : `linear-gradient(135deg, ${cosmeticFrom}, ${cosmeticTo})`,
                  "--comment-cosmetic-accent": cosmeticColor(
                    cosmetic.config.accent,
                    "#68d5ff",
                  ),
                }
              : {}),
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
          cosmetic ? "comment-cosmetic" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        key={comment.id}
        id={`comment-${comment.id}`}
        style={effectStyle}
      >
        <div className="comment-avatar" aria-hidden="true">
          <span>{comment.displayName.slice(0, 2).toUpperCase()}</span>
          {comment.avatarUrl ? (
            <img
              src={comment.avatarUrl}
              alt=""
              loading="lazy"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          ) : null}
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
              Chapter{" "}
              {comment.chapterNumber
                ? comment.chapterNumber
                : "discussion"}
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
              {comment.media.length > 0 || comment.gifs.length > 0 ? (
                <div
                  className={`comment-media-grid media-count-${Math.min(
                    comment.media.length + comment.gifs.length,
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
                  {comment.gifs.map((gif) => (
                    <a
                      href={gif.url}
                      target="_blank"
                      rel="noreferrer"
                      key={`gif:${gif.id}`}
                      aria-label={`Open ${gif.name} GIF`}
                    >
                      <img
                        src={gif.url}
                        loading="lazy"
                        alt={gif.altText}
                      />
                      <span>GIF</span>
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
          {reactionPrompt}
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
