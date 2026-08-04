"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowFatDown,
  ArrowFatUp,
  BookOpen,
  ChatCircle,
  Crown,
  Diamond,
  Medal,
  Trophy,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type RankingPeriod = "weekly" | "monthly" | "all";

type LeaderboardEntry = {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  communityVisible: boolean;
  commentCount: number;
  shardsCollected: number;
  chaptersRead: number;
  upvotes: number;
  downvotes: number;
  reputation: number;
  score: number;
};

type RankingResponse = {
  data?: LeaderboardEntry[];
  viewer?: LeaderboardEntry | null;
  period?: RankingPeriod;
  error?: { message?: string };
};

function rankingTier(rank: number) {
  if (rank === 1) return "Nya Champion";
  if (rank <= 3) return "Mythic";
  if (rank <= 10) return "Diamond";
  if (rank <= 25) return "Platinum";
  if (rank <= 50) return "Gold";
  if (rank <= 100) return "Silver";
  return "Challenger";
}

function RankingEntry({
  entry,
  viewer,
}: {
  entry: LeaderboardEntry;
  viewer?: boolean;
}) {
  return (
    <li
      className={[
        entry.rank <= 3 ? `is-top-${entry.rank}` : "",
        viewer ? "is-viewer" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <a href={`/u/${encodeURIComponent(entry.username)}`}>
        <span
          className="user-leaderboard-rank"
          aria-label={`Rank ${entry.rank.toLocaleString("en-US")}, ${rankingTier(entry.rank)}`}
        >
          {entry.rank === 1 ? (
            <Crown size={20} weight="fill" aria-hidden="true" />
          ) : entry.rank <= 3 ? (
            <Medal size={19} weight="fill" aria-hidden="true" />
          ) : null}
          {entry.rank.toLocaleString("en-US")}
          <small>{rankingTier(entry.rank)}</small>
        </span>
        <span
          className="user-leaderboard-reader"
          aria-label={`Reader ${entry.displayName}, at ${entry.username}`}
        >
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
          data-label="Score"
          aria-label={`Score ${entry.score.toLocaleString("en-US")}`}
        >
          <Trophy size={17} weight="duotone" aria-hidden="true" />
          <strong>{entry.score.toLocaleString("en-US")}</strong>
        </span>
        <span
          data-label="Shards"
          aria-label={`Shards collected ${entry.shardsCollected.toLocaleString("en-US")}`}
        >
          <Diamond size={17} weight="duotone" aria-hidden="true" />
          {entry.shardsCollected.toLocaleString("en-US")}
        </span>
        <span
          data-label="Comments"
          aria-label={
            entry.communityVisible
              ? `Comments ${entry.commentCount.toLocaleString("en-US")}`
              : "Comments private"
          }
        >
          <ChatCircle size={17} aria-hidden="true" />
          {entry.communityVisible
            ? entry.commentCount.toLocaleString("en-US")
            : "Private"}
        </span>
        <span
          data-label="Votes"
          aria-label={
            entry.communityVisible
              ? `${entry.upvotes.toLocaleString("en-US")} upvotes and ${entry.downvotes.toLocaleString("en-US")} downvotes`
              : "Votes private"
          }
          className={
            entry.reputation > 0
              ? "is-positive"
              : entry.reputation < 0
                ? "is-negative"
                : ""
          }
        >
          {entry.communityVisible ? (
            <>
              <ArrowFatUp size={15} weight="fill" aria-hidden="true" />
              {entry.upvotes.toLocaleString("en-US")}
              <ArrowFatDown size={15} weight="fill" aria-hidden="true" />
              {entry.downvotes.toLocaleString("en-US")}
            </>
          ) : (
            "Private"
          )}
        </span>
        <span
          data-label="Read"
          aria-label={`Chapters read ${entry.chaptersRead.toLocaleString("en-US")}`}
        >
          <BookOpen size={17} aria-hidden="true" />
          {entry.chaptersRead.toLocaleString("en-US")}
        </span>
      </a>
    </li>
  );
}

export function UserLeaderboardView() {
  const [period, setPeriod] = useState<RankingPeriod>("weekly");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [viewer, setViewer] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/leaderboard?period=${period}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as RankingResponse;
        if (!response.ok || !payload.data) {
          throw new Error(
            payload.error?.message ?? "The ranking could not be loaded.",
          );
        }
        setEntries(payload.data);
        setViewer(payload.viewer ?? null);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The ranking could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [period]);

  return (
    <section className="user-leaderboard" aria-label="Top 100 users">
      <header className="ranking-toolbar">
        <div>
          <p className="eyebrow">Top 100</p>
          <h2>Community ranking</h2>
          <span>
            Score = Shards + community activity. Upvotes raise it; downvotes
            lower it.
          </span>
        </div>
        <div role="group" aria-label="Ranking period">
          {(
            [
              ["weekly", "Weekly"],
              ["monthly", "Monthly"],
              ["all", "All time"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={period === value}
              onClick={() => {
                if (period === value) return;
                setLoading(true);
                setError("");
                setPeriod(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="user-leaderboard-state" role="status">
          Loading the top 100 users…
        </div>
      ) : error ? (
        <div className="user-leaderboard-state" role="alert">
          <Trophy size={24} />
          <strong>Ranking unavailable</strong>
          <span>{error}</span>
        </div>
      ) : !entries.length ? (
        <div className="user-leaderboard-state">
          <Trophy size={24} />
          <strong>No ranked users yet</strong>
          <span>Read, collect Shards, and join discussions to rank.</span>
        </div>
      ) : (
        <>
          <header className="user-leaderboard-columns">
            <span>Rank</span>
            <span>Reader</span>
            <span>Score</span>
            <span>Shards</span>
            <span>Comments</span>
            <span>Votes</span>
            <span>Read</span>
          </header>
          <ol>
            {entries.map((entry) => (
              <RankingEntry
                entry={entry}
                viewer={viewer?.userId === entry.userId}
                key={entry.userId}
              />
            ))}
            {viewer && viewer.rank > 100 ? (
              <>
                <li
                  className="user-leaderboard-ellipsis"
                  aria-label="Ranks between 100 and your position are omitted"
                >
                  <span aria-hidden="true">•••</span>
                </li>
                <RankingEntry entry={viewer} viewer />
              </>
            ) : null}
          </ol>
        </>
      )}
    </section>
  );
}
