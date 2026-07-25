"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowRight,
  Books,
  CalendarBlank,
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
  followerCount: number;
  followingCount: number | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  teams: Array<{ slug?: string; name?: string }>;
  readingActivity: Array<{
    seriesSlug: string;
    seriesTitle: string;
    chapterSlug: string;
    chapterNumber: string | null;
    readAt: string;
    coverUrl: string | null;
  }>;
  librarySummary: Array<{ status?: string; count?: number }>;
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
        setProfile(payload.data);
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
              followerCount: Math.max(
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
              <small>
                <UsersThree size={15} /> {profile.followerCount} followers
              </small>
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
        <section className="public-profile-panel">
          <div className="section-heading">
            <div>
              <h2>Recent reading</h2>
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
                  key={`${activity.seriesSlug}:${activity.chapterSlug}`}
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
              <strong>No public reading activity</strong>
              <span>Reading history is private or has not started yet.</span>
            </div>
          )}
        </section>
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
