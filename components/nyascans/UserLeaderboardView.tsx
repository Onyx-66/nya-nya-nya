"use client";
/* eslint-disable @next/next/no-img-element */

import {
  BookOpen,
  ChatCircle,
  Crown,
  Diamond,
  Trophy,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type LeaderboardEntry = {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  commentCount: number;
  lifetimeShards: number;
  chaptersRead: number;
};

export function UserLeaderboardView() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/leaderboard", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: LeaderboardEntry[];
          error?: { message?: string };
        };
        if (!response.ok || !payload.data) {
          throw new Error(
            payload.error?.message ?? "The leaderboard could not be loaded.",
          );
        }
        setEntries(payload.data);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The leaderboard could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="user-leaderboard-state" role="status">
        Loading the top 100 readers…
      </div>
    );
  }
  if (error) {
    return (
      <div className="user-leaderboard-state" role="alert">
        <Trophy size={24} />
        <strong>Leaderboard unavailable</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (!entries.length) {
    return (
      <div className="user-leaderboard-state">
        <Trophy size={24} />
        <strong>No ranked readers yet</strong>
        <span>Complete chapters and join discussions to enter the ranking.</span>
      </div>
    );
  }

  return (
    <section className="user-leaderboard" aria-label="Top 100 readers">
      <header className="user-leaderboard-columns">
        <span>Rank & reader</span>
        <span>Comments</span>
        <span>Shards collected</span>
        <span>Chapters read</span>
      </header>
      <ol>
        {entries.map((entry) => (
          <li
            className={entry.rank <= 3 ? `is-top-${entry.rank}` : ""}
            key={entry.userId}
          >
            <a href={`/u/${encodeURIComponent(entry.username)}`}>
              <span className="user-leaderboard-rank">
                {entry.rank === 1 ? <Crown size={20} weight="fill" /> : null}
                {String(entry.rank).padStart(2, "0")}
              </span>
              <span className="user-leaderboard-reader">
                <span className="user-leaderboard-avatar">
                  {entry.avatarUrl ? (
                    <img src={entry.avatarUrl} alt="" loading="lazy" />
                  ) : (
                    entry.displayName.slice(0, 2).toUpperCase()
                  )}
                </span>
                <span>
                  <strong>{entry.displayName}</strong>
                  <small>@{entry.username}</small>
                </span>
              </span>
              <span
                data-label="Comments"
                aria-label={`${entry.commentCount.toLocaleString("en-US")} comments`}
              >
                <ChatCircle size={17} />
                {entry.commentCount.toLocaleString("en-US")}
              </span>
              <span
                data-label="Shards collected"
                aria-label={`${entry.lifetimeShards.toLocaleString("en-US")} Shards collected`}
              >
                <Diamond size={17} weight="duotone" />
                {entry.lifetimeShards.toLocaleString("en-US")}
              </span>
              <span
                data-label="Chapters read"
                aria-label={`${entry.chaptersRead.toLocaleString("en-US")} chapters read`}
              >
                <BookOpen size={17} />
                {entry.chaptersRead.toLocaleString("en-US")}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
