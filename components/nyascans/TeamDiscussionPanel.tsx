"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  ArrowFatDown,
  ArrowFatUp,
  ChatCircle,
  PaperPlaneTilt,
  Trash,
  UsersThree,
  X,
} from "@/components/nyascans/heroicons";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type TeamPost = {
  id: string;
  parentId: string | null;
  depth: number;
  body: string;
  moderationStatus: "VISIBLE" | "DELETED" | "HIDDEN";
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: {
    userId: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
    teamRole: string | null;
  };
  upvotes: number;
  downvotes: number;
  score: number;
  viewerVote: number;
  ownedByViewer: boolean;
};

type TeamDiscussionResponse = {
  data?: TeamPost[];
  viewer?: {
    signedIn: boolean;
    canModerate: boolean;
  };
  pagination?: {
    page: number;
    pageCount: number;
    hasNext: boolean;
  };
  error?: { message?: string };
};

type MentionSuggestion = {
  kind: "series" | "user";
  token: string;
  label: string;
  href: string;
};

function relativeTime(value: string) {
  const timestamp = new Date(value.endsWith("Z") ? value : `${value}Z`).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(value).toLocaleDateString();
}

function roleLabel(value: string | null) {
  if (!value) return "Reader";
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderMentions(body: string) {
  const pieces = body.split(/(@series\/[a-z0-9]+(?:-[a-z0-9]+)*|@[a-z0-9_.-]+)/gi);
  return pieces.map((piece, index) => {
    if (/^@series\//i.test(piece)) {
      const slug = piece.slice("@series/".length);
      return (
        <a href={`/title/${encodeURIComponent(slug)}`} key={`${piece}-${index}`}>
          {piece}
        </a>
      );
    }
    if (/^@[a-z0-9_.-]+$/i.test(piece)) {
      const username = piece.slice(1);
      return (
        <a href={`/u/${encodeURIComponent(username)}`} key={`${piece}-${index}`}>
          {piece}
        </a>
      );
    }
    return <Fragment key={`${index}-${piece.slice(0, 8)}`}>{piece}</Fragment>;
  });
}

export function TeamDiscussionPanel({
  teamSlug,
  teamName,
  signedIn,
}: {
  teamSlug: string;
  teamName: string;
  signedIn: boolean;
}) {
  const [sort, setSort] = useState<"top" | "recent">("top");
  const [posts, setPosts] = useState<TeamPost[]>([]);
  const [viewer, setViewer] = useState({
    signedIn,
    canModerate: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const postRequestKey = useRef("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const mutationLock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      mutationLock.current = false;
      mutationController.current?.abort();
    };
  }, []);

  const fetchPosts = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(
      `/api/v1/team-discussion?slug=${encodeURIComponent(teamSlug)}&sort=${sort}&page=${page}`,
      { cache: "no-store", signal },
    );
    const payload = (await response.json()) as TeamDiscussionResponse;
    if (!response.ok || !payload.data) {
      throw new Error(
        payload.error?.message ?? "The team discussion could not be loaded.",
      );
    }
    return {
      posts: payload.data,
      viewer: payload.viewer ?? { signedIn, canModerate: false },
      hasNext: Boolean(payload.pagination?.hasNext),
    };
  }, [page, signedIn, sort, teamSlug]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await fetchPosts(controller.signal);
        if (!controller.signal.aborted) {
          if (page === 1) {
            setPosts(result.posts);
          } else {
            setPosts((current) => {
              const existing = new Set(current.map((post) => post.id));
              return [
                ...current,
                ...result.posts.filter((post) => !existing.has(post.id)),
              ];
            });
          }
          setViewer(result.viewer);
          setHasNext(result.hasNext);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The team discussion could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    })();
    return () => controller.abort();
  }, [fetchPosts, page, refreshKey]);

  useEffect(() => {
    const match = body.match(/(?:^|\s)@([^\s@]{1,50})$/);
    const query = match?.[1]?.replace(/^series\//i, "") ?? "";
    if (!query) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/v1/team-discussion?slug=${encodeURIComponent(teamSlug)}&suggest=${encodeURIComponent(query)}`,
            { cache: "no-store", signal: controller.signal },
          );
          const payload = (await response.json()) as {
            data?: {
              series?: Array<{ slug: string; title: string }>;
              users?: Array<{ username: string; displayName: string }>;
            };
          };
          if (!response.ok || !payload.data) return;
          setSuggestions([
            ...(payload.data.series ?? []).map((series) => ({
              kind: "series" as const,
              token: `@series/${series.slug}`,
              label: series.title,
              href: `/title/${series.slug}`,
            })),
            ...(payload.data.users ?? []).map((user) => ({
              kind: "user" as const,
              token: `@${user.username}`,
              label: user.displayName,
              href: `/u/${user.username}`,
            })),
          ]);
        } catch {
          if (!controller.signal.aborted) setSuggestions([]);
        }
      })();
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [body, teamSlug]);

  const replies = useMemo(() => {
    const grouped = new Map<string, TeamPost[]>();
    for (const post of posts) {
      if (!post.parentId) continue;
      const existing = grouped.get(post.parentId) ?? [];
      existing.push(post);
      grouped.set(post.parentId, existing);
    }
    return grouped;
  }, [posts]);

  function insertSuggestion(suggestion: MentionSuggestion) {
    postRequestKey.current = "";
    setBody((value) =>
      `${value.replace(/(?:^|\s)@[^\s@]*$/, (match) =>
        match.startsWith(" ") ? " " : "",
      )}${suggestion.token} `,
    );
    setSuggestions([]);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function mutate(
    method: "POST" | "PATCH" | "DELETE",
    payload: Record<string, unknown>,
    key: string,
  ) {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    const controller = new AbortController();
    mutationController.current = controller;
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/v1/team-discussion", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const mutationResult = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          mutationResult.error?.message ??
            "The discussion could not be updated.",
        );
      }
      if (mounted.current) {
        setPage(1);
        setRefreshKey((value) => value + 1);
      }
      return true;
    } catch (mutationError) {
      if (!controller.signal.aborted && mounted.current) {
        setError(
          mutationError instanceof Error
            ? mutationError.message
            : "The discussion could not be updated.",
        );
      }
      return false;
    } finally {
      mutationLock.current = false;
      mutationController.current = null;
      if (mounted.current) setBusy("");
    }
  }

  async function submit() {
    const message = body.trim();
    if (!message) return;
    if (!postRequestKey.current) {
      postRequestKey.current = window.crypto.randomUUID();
    }
    const saved = await mutate(
      "POST",
      {
        teamSlug,
        body: message,
        parentId: replyingTo,
        idempotencyKey: postRequestKey.current,
      },
      "submit",
    );
    if (saved) {
      postRequestKey.current = "";
      setBody("");
      setReplyingTo(null);
      setSuggestions([]);
    }
  }

  function renderPost(post: TeamPost, reply = false) {
    const removed = post.moderationStatus === "DELETED";
    const profileHref = post.author.username
      ? `/u/${encodeURIComponent(post.author.username)}`
      : null;
    return (
      <article
        className={`team-discussion-post${reply ? " is-reply" : ""}`}
        key={post.id}
      >
        <span className="team-discussion-avatar" aria-hidden="true">
          {post.author.avatarUrl ? (
            <img src={post.author.avatarUrl} alt="" loading="lazy" />
          ) : (
            post.author.displayName.slice(0, 2).toUpperCase()
          )}
        </span>
        <div className="team-discussion-post-main">
          <header>
            <span>
              {profileHref ? (
                <a href={profileHref}>{post.author.displayName}</a>
              ) : (
                <strong>{post.author.displayName}</strong>
              )}
              <em>{roleLabel(post.author.teamRole)}</em>
            </span>
            <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>
              {relativeTime(post.createdAt)}
            </time>
          </header>
          <p className={removed ? "is-removed" : ""}>
            {removed ? "This message was removed." : renderMentions(post.body)}
          </p>
          {!removed ? (
            <footer>
              <button
                type="button"
                aria-label={`Upvote ${post.author.displayName}`}
                aria-pressed={post.viewerVote === 1}
                disabled={!viewer.signedIn || post.ownedByViewer || Boolean(busy)}
                onClick={() =>
                  void mutate(
                    "PATCH",
                    {
                      postId: post.id,
                      value: post.viewerVote === 1 ? 0 : 1,
                    },
                    `vote-${post.id}`,
                  )
                }
              >
                <ArrowFatUp size={16} weight={post.viewerVote === 1 ? "fill" : "regular"} />
                {post.upvotes}
              </button>
              <span className={post.score < 0 ? "is-negative" : ""}>
                {post.score >= 0 ? "+" : ""}
                {post.score}
              </span>
              <button
                type="button"
                aria-label={`Downvote ${post.author.displayName}`}
                aria-pressed={post.viewerVote === -1}
                disabled={!viewer.signedIn || post.ownedByViewer || Boolean(busy)}
                onClick={() =>
                  void mutate(
                    "PATCH",
                    {
                      postId: post.id,
                      value: post.viewerVote === -1 ? 0 : -1,
                    },
                    `vote-${post.id}`,
                  )
                }
              >
                <ArrowFatDown size={16} weight={post.viewerVote === -1 ? "fill" : "regular"} />
                {post.downvotes}
              </button>
              {!reply && viewer.signedIn ? (
                <button
                  type="button"
                  onClick={() => {
                    postRequestKey.current = "";
                    setReplyingTo(post.id);
                    setBody(
                      post.author.username ? `@${post.author.username} ` : "",
                    );
                    window.requestAnimationFrame(() =>
                      composerRef.current?.focus(),
                    );
                  }}
                >
                  Reply
                </button>
              ) : null}
              {post.ownedByViewer || viewer.canModerate ? (
                <button
                  className="is-danger"
                  type="button"
                  aria-label="Delete message"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void mutate(
                      "DELETE",
                      { postId: post.id },
                      `delete-${post.id}`,
                    )
                  }
                >
                  <Trash size={15} />
                </button>
              ) : null}
            </footer>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <section className="team-discussion" aria-labelledby="team-discussion-title">
      <header className="team-discussion-header">
        <div>
          <p className="eyebrow">General chat</p>
          <h2 id="team-discussion-title">{teamName} Discussion</h2>
          <span>
            Staff and readers can talk here. Use <b>@username</b> or{" "}
            <b>@series/title-slug</b> to tag people and series.
          </span>
        </div>
        <div>
          <button
            type="button"
            aria-pressed={sort === "top"}
            disabled={Boolean(busy)}
            onClick={() => {
              if (sort === "top") return;
              setLoading(true);
              setError("");
              setPage(1);
              setSort("top");
            }}
          >
            Top
          </button>
          <button
            type="button"
            aria-pressed={sort === "recent"}
            disabled={Boolean(busy)}
            onClick={() => {
              if (sort === "recent") return;
              setLoading(true);
              setError("");
              setPage(1);
              setSort("recent");
            }}
          >
            Recent
          </button>
          <button
            type="button"
            aria-label="Refresh discussion"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setError("");
              setPage(1);
              setRefreshKey((value) => value + 1);
            }}
          >
            <ArrowClockwise size={17} />
          </button>
        </div>
      </header>

      {viewer.signedIn ? (
        <div className="team-discussion-composer">
          {replyingTo ? (
            <span className="team-discussion-replying">
              Replying to a message
              <button
                type="button"
                aria-label="Cancel reply"
                onClick={() => {
                  postRequestKey.current = "";
                  setReplyingTo(null);
                  setBody("");
                  setSuggestions([]);
                  window.requestAnimationFrame(() =>
                    composerRef.current?.focus(),
                  );
                }}
              >
                <X size={15} />
              </button>
            </span>
          ) : null}
          <textarea
            ref={composerRef}
            aria-label={`Write a message in ${teamName} Discussion`}
            value={body}
            maxLength={2_000}
            placeholder={`Share something with ${teamName} readers…`}
            onChange={(event) => {
              const nextBody = event.target.value;
              postRequestKey.current = "";
              setBody(nextBody);
              if (!/(?:^|\s)@[^\s@]{1,50}$/.test(nextBody)) {
                setSuggestions([]);
              }
            }}
          />
          {suggestions.length ? (
            <div
              className="team-mention-suggestions"
              aria-label="Mention suggestions"
            >
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={`${suggestion.kind}-${suggestion.token}`}
                  aria-label={`Mention ${suggestion.kind} ${suggestion.label}`}
                  onClick={() => insertSuggestion(suggestion)}
                >
                  <span>{suggestion.kind === "series" ? "Series" : "User"}</span>
                  <strong>{suggestion.label}</strong>
                  <small>{suggestion.token}</small>
                </button>
              ))}
            </div>
          ) : null}
          <footer>
            <span>{body.length.toLocaleString("en-US")} / 2,000</span>
            <button
              className="button button-primary"
              type="button"
              disabled={body.trim().length < 2 || Boolean(busy)}
              onClick={() => void submit()}
            >
              <PaperPlaneTilt size={17} />
              {busy === "submit" ? "Posting…" : replyingTo ? "Post reply" : "Post message"}
            </button>
          </footer>
        </div>
      ) : (
        <div className="team-discussion-signin">
          <UsersThree size={22} />
          <span>Sign in to join this team’s general discussion.</span>
          <a className="button button-primary" href={`/login?returnTo=${encodeURIComponent(`/team/${teamSlug}`)}`}>
            Sign in
          </a>
        </div>
      )}

      {error ? (
        <div className="team-discussion-error" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="team-discussion-state" role="status">
          Loading discussion…
        </div>
      ) : posts.filter((post) => !post.parentId).length ? (
        <div className="team-discussion-list">
          {posts
            .filter((post) => !post.parentId)
            .map((post) => (
              <div className="team-discussion-thread" key={post.id}>
                {renderPost(post)}
                {(replies.get(post.id) ?? [])
                  .slice()
                  .reverse()
                  .map((reply) => renderPost(reply, true))}
              </div>
            ))}
          {hasNext ? (
            <button
              className="button button-secondary team-discussion-more"
              type="button"
              disabled={loadingMore || Boolean(busy)}
              onClick={() => {
                setLoadingMore(true);
                setError("");
                setPage((value) => value + 1);
              }}
            >
              {loadingMore ? "Loading…" : "Load older discussions"}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="team-discussion-state">
          <ChatCircle size={26} />
          <strong>Start the discussion</strong>
          <span>The first public message for this team can be yours.</span>
        </div>
      )}
    </section>
  );
}
