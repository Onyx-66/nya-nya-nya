"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowRight,
  Books,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Heart,
  Trophy,
  UploadSimple,
  UserMinus,
  UserPlus,
  UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

type ProfileRecord = {
  username: string;
  displayName: string;
  bio: string;
  preferredLanguage: string;
  socialLinks: Array<{ label?: string; url?: string }>;
  createdAt: string;
  revision: number;
  isSelf: boolean;
  isFollowing: boolean;
  followerCount: number | null;
  followingCount: number | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  teams: Array<{ slug?: string; name?: string }>;
  readingActivity: Array<{
    seriesSlug: string;
    seriesTitle: string;
    chapterSlug: string | null;
    chapterNumber: string | null;
    readAt: string;
    coverUrl: string | null;
  }>;
  uploads: Array<{
    id: string;
    chapterSlug: string;
    chapterNumber: string;
    language: string;
    version: number;
    accessType: string;
    publishedAt: string;
    seriesSlug: string;
    seriesTitle: string;
    coverUrl: string | null;
    teamSlug: string | null;
    teamName: string | null;
  }>;
  favorites: Array<{
    seriesId: string;
    seriesSlug: string;
    seriesTitle: string;
    coverUrl: string | null;
    position: number;
  }>;
  achievements: Array<{
    slug: string;
    name: string;
    description: string;
    rarity: string;
    earnedAt: string;
  }>;
  bookmarks: Array<{
    seriesId: string;
    seriesSlug: string;
    seriesTitle: string;
    coverUrl: string | null;
    listType: string;
    savedAt: string;
  }>;
  comments: Array<{
    id: string;
    body: string;
    seriesSlug: string;
    seriesTitle: string;
    chapterSlug: string | null;
    chapterNumber: string | null;
    createdAt: string;
    upvotes: number;
    downvotes: number;
    reactionCount: number;
    spoiler: boolean;
    coverUrl: string | null;
    media: Array<{
      id: string;
      filename: string;
      contentType: string;
      kind: string;
      altText: string;
      url: string;
    }>;
    gifs: Array<{
      id: string;
      name: string;
      altText: string;
      url: string;
    }>;
  }>;
};

function timeLabel(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Recently";
  const days = Math.max(0, Math.round((Date.now() - time) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function PublicProfileView({ username }: { username: string }) {
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [followBusy, setFollowBusy] = useState(false);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const favoritesRailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/profiles?username=${encodeURIComponent(username)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const payload = (await response.json()) as {
          data?: ProfileRecord;
          error?: { message?: string };
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message ?? "This profile is unavailable.");
        }
        setProfile({
          ...payload.data,
          favorites: payload.data.favorites ?? [],
          achievements: payload.data.achievements ?? [],
          bookmarks: payload.data.bookmarks ?? [],
          comments: payload.data.comments ?? [],
          uploads: payload.data.uploads ?? [],
        });
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "This profile is unavailable.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [username]);

  async function toggleFollow() {
    if (!profile || profile.isSelf || followBusy) return;
    setFollowBusy(true);
    try {
      const response = await fetch("/api/v1/profile-follow", {
        method: profile.isFollowing ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: profile.username }),
      });
      const payload = (await response.json()) as {
        following?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || typeof payload.following !== "boolean") {
        throw new Error(payload.error?.message ?? "Follow could not be updated.");
      }
      setProfile((current) =>
        current
          ? {
              ...current,
              isFollowing: payload.following!,
              followerCount:
                current.followerCount === null
                  ? null
                  : Math.max(
                      0,
                      current.followerCount +
                        (payload.following === current.isFollowing
                          ? 0
                          : payload.following
                            ? 1
                            : -1),
                    ),
            }
          : current,
      );
    } catch (followError) {
      setError(
        followError instanceof Error
          ? followError.message
          : "Follow could not be updated.",
      );
    } finally {
      setFollowBusy(false);
    }
  }

  function moveFavorites(direction: -1 | 1) {
    const rail = favoritesRailRef.current;
    if (!rail) return;
    const firstCard = rail.querySelector<HTMLElement>(
      ".public-profile-series-card",
    );
    const gap = Number.parseFloat(getComputedStyle(rail).columnGap) || 0;
    const cardStep = firstCard
      ? firstCard.getBoundingClientRect().width + gap
      : 220;
    const visibleCards = Math.max(1, Math.floor(rail.clientWidth / cardStep));
    rail.scrollBy({
      left: direction * cardStep * visibleCards,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  function commentContent(comment: ProfileRecord["comments"][number]) {
    const assets = [
      ...(comment.media ?? []).map((media) => ({
        id: media.id,
        url: media.url,
        alt: media.altText || media.filename,
        label: media.filename,
      })),
      ...(comment.gifs ?? []).map((gif) => ({
        id: gif.id,
        url: gif.url,
        alt: gif.altText || gif.name,
        label: gif.name,
      })),
    ];
    return (
      <div className="public-profile-comment-content">
        {comment.body ? <p>{comment.body}</p> : null}
        {assets.length ? (
          <div className="public-profile-comment-media">
            {assets.map((asset) => (
              <a
                key={`${comment.id}-${asset.id}`}
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${asset.label}`}
              >
                <img src={asset.url} alt={asset.alt} loading="lazy" />
                <span>Open image</span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return (
      <main className="page-main page-wrap public-profile-state" role="status">
        Loading profile…
      </main>
    );
  }
  if (error && !profile) {
    return (
      <main className="page-main page-wrap public-profile-state">
        <strong>Profile unavailable</strong>
        <p>{error}</p>
        <a href="/browse">Browse NyaScans</a>
      </main>
    );
  }
  if (!profile) return null;
  const visibleComments = commentsExpanded
    ? profile.comments
    : profile.comments.slice(0, 6);

  return (
    <main className="page-main public-profile-page">
      <section className="public-profile-hero">
        <span className="public-profile-banner">
          {profile.bannerUrl ? <img src={profile.bannerUrl} alt="" /> : null}
        </span>
        <div className="page-wrap public-profile-identity">
          <span className="public-profile-avatar">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={`${profile.displayName} avatar`}
              />
            ) : (
              <span aria-hidden="true">
                {profile.displayName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </span>
          <div>
            <p className="eyebrow">@{profile.username}</p>
            <h1>{profile.displayName}</h1>
            <p>{profile.bio || "This reader has not added a bio yet."}</p>
            <span className="public-profile-meta">
              {profile.followerCount !== null ? (
                <small>
                  <UsersThree size={15} /> {profile.followerCount} followers
                </small>
              ) : null}
              {profile.followingCount !== null ? (
                <small>{profile.followingCount} following</small>
              ) : null}
              <small>
                <CalendarBlank size={15} /> Joined{" "}
                {new Date(profile.createdAt).toLocaleDateString()}
              </small>
            </span>
          </div>
          {profile.isSelf ? (
            <a className="button button-secondary" href="/account?tab=profile">
              Edit profile
            </a>
          ) : (
            <button
              className="button button-primary"
              type="button"
              disabled={followBusy}
              onClick={() => void toggleFollow()}
            >
              {profile.isFollowing ? (
                <UserMinus size={17} />
              ) : (
                <UserPlus size={17} />
              )}
              {followBusy
                ? "Saving…"
                : profile.isFollowing
                  ? "Unfollow"
                  : "Follow"}
            </button>
          )}
        </div>
      </section>
      <div className="page-wrap public-profile-content">
        {error ? (
          <div className="public-profile-alert" role="alert">
            {error}
          </div>
        ) : null}
        {profile.teams.length ? (
          <section className="public-profile-panel public-profile-teams-panel">
            <h2>Teams</h2>
            <div className="public-profile-teams">
              {profile.teams.map((team) => (
                <a href={`/team/${team.slug}`} key={team.slug}>
                  {team.name}
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {profile.favorites.length ? (
          <section className="public-profile-panel">
            <div className="section-heading public-profile-section-heading">
              <div>
                <h2>Favorite series</h2>
                <p>This reader&apos;s ordered top {profile.favorites.length}.</p>
              </div>
              <div
                className="public-profile-rail-controls"
                role="group"
                aria-label="Favorite series controls"
              >
                <button
                  type="button"
                  aria-label="Show previous favorite series"
                  aria-controls="favorite-series-rail"
                  onClick={() => moveFavorites(-1)}
                >
                  <CaretLeft size={18} weight="bold" />
                </button>
                <button
                  type="button"
                  aria-label="Show next favorite series"
                  aria-controls="favorite-series-rail"
                  onClick={() => moveFavorites(1)}
                >
                  <CaretRight size={18} weight="bold" />
                </button>
              </div>
            </div>
            <div
              id="favorite-series-rail"
              ref={favoritesRailRef}
              className="public-profile-series-grid"
              role="region"
              aria-label="Favorite series carousel"
              tabIndex={0}
            >
              {profile.favorites.map((favorite, index) => (
                <a
                  href={`/title/${favorite.seriesSlug}`}
                  key={favorite.seriesId}
                  className="public-profile-series-card"
                >
                  <span className="public-profile-series-rank">
                    #{index + 1}
                  </span>
                  {favorite.coverUrl ? (
                    <img
                      src={favorite.coverUrl}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        const fallback = "/art/series-cover-placeholder.svg";
                        if (!event.currentTarget.src.endsWith(fallback)) {
                          event.currentTarget.src = fallback;
                        }
                      }}
                    />
                  ) : (
                    <span className="public-reading-cover-placeholder">
                      <Books size={22} />
                    </span>
                  )}
                  <strong>{favorite.seriesTitle}</strong>
                </a>
              ))}
            </div>
          </section>
        ) : null}
        <section className="public-profile-panel">
          <div className="section-heading public-profile-section-heading">
            <div>
              <h2>Activity</h2>
              <p>Shared by this reader according to their privacy settings.</p>
            </div>
          </div>
          {profile.readingActivity.length ? (
            <div className="public-profile-record-list public-profile-activity">
              {profile.readingActivity.map((activity) => (
                <a
                  href={`/title/${activity.seriesSlug}${
                    activity.chapterNumber
                      ? `/chapter/${activity.chapterSlug}`
                      : ""
                  }`}
                  key={`${activity.seriesSlug}:${
                    activity.chapterSlug ?? activity.readAt
                  }`}
                  className="public-profile-record-card"
                >
                  <span className="public-profile-record-cover">
                    {activity.coverUrl ? (
                      <img
                        src={activity.coverUrl}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          const fallback = "/art/series-cover-placeholder.svg";
                          if (!event.currentTarget.src.endsWith(fallback)) {
                            event.currentTarget.src = fallback;
                          }
                        }}
                      />
                    ) : (
                      <span className="public-reading-cover-placeholder">
                        <Books size={20} />
                      </span>
                    )}
                  </span>
                  <span className="public-profile-record-copy">
                    <span className="public-profile-record-label">
                      <Books size={14} weight="duotone" /> Reading activity
                    </span>
                    <strong>{activity.seriesTitle}</strong>
                    <small>
                      {activity.chapterNumber
                        ? `Chapter ${activity.chapterNumber} · `
                        : ""}
                      {timeLabel(activity.readAt)}
                    </small>
                  </span>
                  <span className="public-profile-record-action" aria-hidden="true">
                    <ArrowRight size={17} weight="bold" />
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="public-profile-empty">
              <Books size={25} />
              <strong>No public activity</strong>
              <span>Activity is private or has not started yet.</span>
            </div>
          )}
        </section>
        {profile.achievements.length ? (
          <section className="public-profile-panel">
            <div className="section-heading">
              <div>
                <h2>Achievements</h2>
                <p>Badges earned across reading and community activity.</p>
              </div>
            </div>
            <div className="public-profile-achievements">
              {profile.achievements.map((achievement) => (
                <article key={achievement.slug}>
                  <Trophy size={22} weight="duotone" />
                  <span>
                    <strong>{achievement.name}</strong>
                    <small>{achievement.description}</small>
                  </span>
                  <small>{achievement.rarity.toLowerCase()}</small>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {profile.bookmarks.length ? (
          <section className="public-profile-panel">
            <div className="section-heading public-profile-section-heading">
              <div>
                <h2>Followed series</h2>
                <p>Public series this reader follows.</p>
              </div>
            </div>
            <div className="public-profile-record-list public-profile-bookmarks">
              {profile.bookmarks.map((bookmark) => (
                <a
                  href={`/title/${bookmark.seriesSlug}`}
                  key={bookmark.seriesId}
                  className="public-profile-record-card"
                >
                  <span className="public-profile-record-cover">
                    {bookmark.coverUrl ? (
                      <img
                        src={bookmark.coverUrl}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          const fallback = "/art/series-cover-placeholder.svg";
                          if (!event.currentTarget.src.endsWith(fallback)) {
                            event.currentTarget.src = fallback;
                          }
                        }}
                      />
                    ) : (
                      <span className="public-reading-cover-placeholder">
                        <Heart size={20} />
                      </span>
                    )}
                  </span>
                  <span className="public-profile-record-copy">
                    <span className="public-profile-record-label">
                      <Heart size={14} weight="duotone" />
                      {bookmark.listType.replaceAll("_", " ").toLowerCase()}
                    </span>
                    <strong>{bookmark.seriesTitle}</strong>
                    <small>Followed {timeLabel(bookmark.savedAt).toLowerCase()}</small>
                  </span>
                  <span className="public-profile-record-action" aria-hidden="true">
                    <ArrowRight size={17} weight="bold" />
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {profile.uploads.length ? (
          <section className="public-profile-panel public-profile-uploads-panel">
            <div className="section-heading public-profile-section-heading">
              <div>
                <h2>Uploads</h2>
                <p>Latest public chapters released by this uploader.</p>
              </div>
              <span className="public-profile-section-count">
                <UploadSimple size={18} /> {profile.uploads.length}
              </span>
            </div>
            <div className="public-profile-uploads">
              {profile.uploads.map((upload) => (
                <a
                  key={upload.id}
                  href={`/title/${upload.seriesSlug}/chapter/${upload.chapterSlug}`}
                >
                  <span className="public-profile-upload-cover">
                    {upload.coverUrl ? (
                      <img src={upload.coverUrl} alt="" loading="lazy" />
                    ) : (
                      <Books size={20} />
                    )}
                  </span>
                  <span>
                    <strong>{upload.seriesTitle}</strong>
                    <small>
                      Chapter {upload.chapterNumber} · {upload.language.toUpperCase()}
                      {upload.version > 1 ? ` · v${upload.version}` : ""}
                    </small>
                    <small>
                      {upload.teamName ?? "Independent release"} · {timeLabel(upload.publishedAt)}
                    </small>
                  </span>
                  <span className={`public-profile-upload-access is-${upload.accessType.toLowerCase()}`}>
                    {upload.accessType === "FREE" ? "Free" : "Paid"}
                  </span>
                  <ArrowRight size={17} />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {profile.comments.length ? (
          <section className="public-profile-panel">
            <div className="section-heading public-profile-section-heading">
              <div>
                <h2>Comments</h2>
                <p>Recent visible comments and community reactions.</p>
              </div>
              {profile.comments.length > 6 ? (
                <button
                  className="button button-secondary"
                  type="button"
                  aria-expanded={commentsExpanded}
                  onClick={() => setCommentsExpanded((current) => !current)}
                >
                  {commentsExpanded ? "Show fewer" : `Show all ${profile.comments.length}`}
                </button>
              ) : null}
            </div>
            <div className="public-profile-comments">
              {visibleComments.map((comment) => {
                const commentHref = `/title/${comment.seriesSlug}${
                  comment.chapterSlug ? `/chapter/${comment.chapterSlug}` : ""
                }#comment-${comment.id}`;
                return (
                  <article key={comment.id} id={`profile-comment-${comment.id}`}>
                    <span
                      className="public-profile-comment-cover"
                      aria-hidden="true"
                    >
                      {comment.coverUrl ? (
                        <img
                          src={comment.coverUrl}
                          alt=""
                          loading="lazy"
                          onError={(event) => {
                            const fallback =
                              "/art/series-cover-placeholder.svg";
                            if (!event.currentTarget.src.endsWith(fallback)) {
                              event.currentTarget.src = fallback;
                            }
                          }}
                        />
                      ) : (
                        <span className="public-reading-cover-placeholder">
                          <Books size={20} />
                        </span>
                      )}
                    </span>
                    <div className="public-profile-comment-copy">
                      <div className="public-profile-comment-title">
                        <ChatCircle size={19} weight="duotone" />
                        <a href={commentHref}>
                          {comment.seriesTitle}
                          {comment.chapterNumber
                            ? ` · Chapter ${comment.chapterNumber}`
                            : ""}
                        </a>
                      </div>
                      {comment.spoiler ? (
                        <details className="public-profile-comment-spoiler">
                          <summary>Reveal spoiler comment</summary>
                          {commentContent(comment)}
                        </details>
                      ) : (
                        commentContent(comment)
                      )}
                      <small>
                        {timeLabel(comment.createdAt)} · {comment.upvotes} up ·{" "}
                        {comment.downvotes} down · {comment.reactionCount}{" "}
                        reactions
                      </small>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
