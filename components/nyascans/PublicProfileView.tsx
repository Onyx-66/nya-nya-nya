"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowRight,
  BookmarkSimple,
  Books,
  CalendarBlank,
  ChatCircle,
  Trophy,
  UserMinus,
  UserPlus,
  UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

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
  librarySummary: Array<{ status?: string; count?: number }>;
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
          <section className="public-profile-panel">
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
            <div className="section-heading">
              <div>
                <h2>Favorite series</h2>
                <p>This reader&apos;s ordered top {profile.favorites.length}.</p>
              </div>
            </div>
            <div className="public-profile-series-grid">
              {profile.favorites.map((favorite, index) => (
                <a
                  href={`/title/${favorite.seriesSlug}`}
                  key={favorite.seriesId}
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
          <div className="section-heading">
            <div>
              <h2>Activity</h2>
              <p>Shared by this reader according to their privacy settings.</p>
            </div>
          </div>
          {profile.readingActivity.length ? (
            <div className="public-reading-grid">
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
                >
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
                  <span>
                    <strong>{activity.seriesTitle}</strong>
                    <small>
                      {activity.chapterNumber
                        ? `Chapter ${activity.chapterNumber} · `
                        : ""}
                      {timeLabel(activity.readAt)}
                    </small>
                  </span>
                  <ArrowRight size={17} />
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
            <div className="section-heading">
              <div>
                <h2>Bookmarks</h2>
                <p>Public series this reader saved to their Library.</p>
              </div>
            </div>
            <div className="public-reading-grid">
              {profile.bookmarks.map((bookmark) => (
                <a
                  href={`/title/${bookmark.seriesSlug}`}
                  key={bookmark.seriesId}
                >
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
                      <BookmarkSimple size={20} />
                    </span>
                  )}
                  <span>
                    <strong>{bookmark.seriesTitle}</strong>
                    <small>
                      {bookmark.listType.replaceAll("_", " ").toLowerCase()} ·{" "}
                      {timeLabel(bookmark.savedAt)}
                    </small>
                  </span>
                  <ArrowRight size={17} />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {profile.comments.length ? (
          <section className="public-profile-panel">
            <div className="section-heading">
              <div>
                <h2>Comments</h2>
                <p>Recent visible comments and community reactions.</p>
              </div>
            </div>
            <div className="public-profile-comments">
              {profile.comments.map((comment) => (
                <article key={comment.id}>
                  <ChatCircle size={20} weight="duotone" />
                  <div>
                    <a
                      href={`/title/${comment.seriesSlug}${
                        comment.chapterSlug
                          ? `/chapter/${comment.chapterSlug}`
                          : ""
                      }`}
                    >
                      {comment.seriesTitle}
                      {comment.chapterNumber
                        ? ` · Chapter ${comment.chapterNumber}`
                        : ""}
                    </a>
                    <p>{comment.body}</p>
                    <small>
                      {timeLabel(comment.createdAt)} · {comment.upvotes} up ·{" "}
                      {comment.downvotes} down · {comment.reactionCount}{" "}
                      reactions
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {profile.librarySummary.length ? (
          <section className="public-profile-panel">
            <h2>Library summary</h2>
            <div className="public-library-summary">
              {profile.librarySummary.map((entry) => (
                <span key={entry.status}>
                  <strong>{Number(entry.count ?? 0)}</strong>
                  <small>
                    {(entry.status ?? "saved").replaceAll("_", " ").toLowerCase()}
                  </small>
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
