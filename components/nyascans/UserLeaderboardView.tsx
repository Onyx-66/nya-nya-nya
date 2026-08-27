"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowFatUp,
  ChatCircle,
  Crown,
  Fire,
  Medal,
  Trophy,
} from "@/components/nyascans/heroicons";
import { useEffect, useState, type ReactNode } from "react";
import { DotsRing } from "@/components/nyascans/DotsRing";

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

function rankingTier(entry: LeaderboardEntry) {
  const score = Number(entry.score);
  const upvotes = Number(entry.upvotes);
  if (score >= 10000 || upvotes >= 10000) return "Legend";
  if (score >= 5000 || upvotes >= 5000) return "Mythic";
  if (score >= 2000 || upvotes >= 2000) return "Elite";
  if (score >= 500 || upvotes >= 500) return "Veteran";
  return "Rising";
}

function number(value: number) {
  return value.toLocaleString("en-US");
}

function profileHref(entry: LeaderboardEntry) {
  return `/u/${encodeURIComponent(entry.username)}`;
}

function accessibleEntryLabel(entry: LeaderboardEntry) {
  if (entry.rank > 3) {
    return `Rank ${entry.rank}: ${entry.displayName}. Score ${number(entry.score)}.`;
  }
  return `Rank ${entry.rank}: ${entry.displayName}. Score ${number(entry.score)}, ${
    entry.communityVisible
      ? `${number(entry.commentCount)} comments and ${number(entry.upvotes)} upvotes`
      : "community metrics private"
  }.`;
}

function RankingAvatar({ entry, featured = false }: { entry: LeaderboardEntry; featured?: boolean }) {
  return (
    <span className={`user-ranking-avatar${featured ? " is-featured" : ""}`}>
      {entry.avatarUrl ? (
        <img src={entry.avatarUrl} alt="" loading={featured ? "eager" : "lazy"} />
      ) : (
        entry.displayName
          .split(/\s+/)
          .map((part) => part[0])
          .join("")
          .slice(0, 2)
          .toUpperCase()
      )}
    </span>
  );
}

function RankingMetric({
  icon,
  label,
  value,
  accent = false,
  expanded = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent?: boolean;
  expanded?: boolean;
}) {
  return (
    <span
      className={`user-ranking-metric${accent ? " is-accent" : ""}`}
      data-label={label}
      data-visibility={expanded ? "expanded" : "all"}
    >
      {icon}
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </span>
  );
}

function PodiumCard({ entry }: { entry: LeaderboardEntry }) {
  return (
    <li className={`user-ranking-podium-card is-rank-${entry.rank}`}>
      <a href={profileHref(entry)} aria-label={accessibleEntryLabel(entry)}>
        <span className="user-ranking-place" aria-hidden="true">
          {entry.rank === 1 ? <Crown weight="fill" /> : <Medal weight="fill" />}
          <strong>{entry.rank}</strong>
        </span>
        <RankingAvatar entry={entry} featured />
        <strong className="user-ranking-podium-name">{entry.displayName}</strong>
        <span className="user-ranking-tier">{rankingTier(entry)}</span>
        <div className="user-ranking-podium-metrics">
          <RankingMetric
            icon={<Fire weight="fill" aria-hidden="true" />}
            label="Score"
            value={number(entry.score)}
            accent
          />
          <RankingMetric
            icon={<ChatCircle weight="fill" aria-hidden="true" />}
            label="Comments"
            value={entry.communityVisible ? number(entry.commentCount) : "Private"}
            expanded
          />
          <RankingMetric
            icon={<ArrowFatUp weight="fill" aria-hidden="true" />}
            label="Reacts"
            value={entry.communityVisible ? number(entry.upvotes) : "Private"}
            expanded
          />
          <RankingMetric
            icon={<Fire weight="fill" aria-hidden="true" />}
            label="Chapters"
            value={number(entry.chaptersRead)}
            expanded
          />
        </div>
      </a>
    </li>
  );
}

function RankingListRow({ entry, viewer = false }: { entry: LeaderboardEntry; viewer?: boolean }) {
  return (
    <li className={`user-ranking-list-row${viewer ? " is-viewer" : ""}`}>
      <a href={profileHref(entry)} aria-label={accessibleEntryLabel(entry)}>
        <span className="user-ranking-row-rank" aria-label={`Rank ${entry.rank}`}>
          {entry.rank.toLocaleString("en-US")}
        </span>
        <RankingAvatar entry={entry} />
        <span className="user-ranking-row-person">
          <strong>{entry.displayName}</strong>
          <small>@{entry.username}</small>
        </span>
        <div className="user-ranking-row-metrics">
          <RankingMetric
            icon={<Fire weight="fill" aria-hidden="true" />}
            label="Score"
            value={number(entry.score)}
            accent
          />
          <RankingMetric
            icon={<ChatCircle weight="fill" aria-hidden="true" />}
            label="Comments"
            value={entry.communityVisible ? number(entry.commentCount) : "Private"}
            expanded
          />
          <RankingMetric
            icon={<ArrowFatUp weight="fill" aria-hidden="true" />}
            label="Reacts"
            value={entry.communityVisible ? number(entry.upvotes) : "Private"}
            expanded
          />
          <RankingMetric
            icon={<Fire weight="fill" aria-hidden="true" />}
            label="Chapters"
            value={number(entry.chaptersRead)}
            expanded
          />
        </div>
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
          throw new Error(payload.error?.message ?? "The leaderboard could not be loaded.");
        }
        setEntries(payload.data);
        setViewer(payload.viewer ?? null);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "The leaderboard could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [period]);

  const podiumEntries = entries
    .filter((entry) => entry.rank <= 3)
    .sort((a, b) => {
      const visualOrder: Record<number, number> = { 1: 1, 2: 0, 3: 2 };
      return (visualOrder[a.rank] ?? a.rank) - (visualOrder[b.rank] ?? b.rank);
    });
  const listEntries = entries.filter((entry) => entry.rank > 3);

  return (
    <section className="user-leaderboard" aria-labelledby="leaderboard-title">
      <header className="user-ranking-hero">
        <div className="user-ranking-hero-mark" aria-hidden="true">
          <Fire weight="fill" />
        </div>
        <h1 id="leaderboard-title">Leaderboard</h1>
        <p>Top 100 users ranked by Score earned through community activity, comments, reacts, and chapters read.</p>
      </header>

      <div className="user-ranking-controls">
        <div className="user-ranking-controls-copy">
          <span className="user-ranking-kicker">Community leaderboard</span>
          <strong>{period === "weekly" ? "This week" : period === "monthly" ? "This month" : "All time"}</strong>
        </div>
        <div className="user-ranking-periods" role="group" aria-label="Leaderboard period">
          {([
            ["weekly", "Weekly"],
            ["monthly", "Monthly"],
            ["all", "All time"],
          ] as const).map(([value, label]) => (
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
      </div>

      {loading ? (
        <div className="dots-ring-loading user-leaderboard-state" role="status">
          <DotsRing size="lg" label={null} />
          <strong>Loading the top 100 users…</strong>
        </div>
      ) : error ? (
        <div className="user-leaderboard-state" role="alert">
          <Trophy size={24} />
          <strong>Leaderboard unavailable</strong>
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
          {podiumEntries.length ? (
            <section className="user-ranking-podium" aria-labelledby="user-ranking-podium-title">
              <h2 id="user-ranking-podium-title" className="sr-only">Top three users</h2>
              <ol>{podiumEntries.map((entry) => <PodiumCard entry={entry} key={entry.userId} />)}</ol>
            </section>
          ) : null}
          <section className="user-ranking-list" aria-labelledby="user-ranking-list-title">
            <div className="user-ranking-list-heading">
              <div>
                <span className="user-ranking-kicker">The rest of the board</span>
                  <h2 id="user-ranking-list-title">Leaderboard entries</h2>
              </div>
              <div className="user-ranking-list-labels" aria-hidden="true">
                <span>Score</span>
                <span>Comments</span>
                <span>Reacts</span>
                <span>Chapters</span>
              </div>
            </div>
            <ol>
              {listEntries.map((entry) => (
                <RankingListRow entry={entry} viewer={viewer?.userId === entry.userId} key={entry.userId} />
              ))}
              {viewer && viewer.rank > 100 ? (
                <>
                  <li className="user-ranking-ellipsis" aria-label="Ranks between 100 and your position are omitted">•••</li>
                  <RankingListRow entry={viewer} viewer />
                </>
              ) : null}
            </ol>
          </section>
        </>
      )}
    </section>
  );
}
