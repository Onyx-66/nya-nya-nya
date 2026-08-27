"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowClockwise,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Books,
  ChatCircle,
  Eye,
  Fire,
  Heart,
  Minus,
  Star,
} from "@/components/nyascans/heroicons";
import { type ReactNode, useEffect, useState } from "react";
import { DotsRing } from "@/components/nyascans/DotsRing";
import { fetchWithHomeTimeout, homeRequestMessage } from "@/lib/home-fetch";

type HotSeries = {
  id: string;
  rank: number;
  slug: string;
  title: string;
  coverUrl: string | null;
  rating: number;
  genres: string[];
  viewCount: number;
  chapterCount: number;
  commentTotal: number;
  followerCount: number;
  uniqueReaders: number;
  chapterStarts: number;
  commentCount: number;
  reactionCount: number;
  rankMovement: number | null;
};

const HOT_WEEK_SNAPSHOT_KEY = "nyascans:hot-week-ranks";
type HotPeriod = "weekly" | "monthly" | "all";
const HOT_PERIODS: Array<{ key: HotPeriod; label: string }> = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "all", label: "All" },
];

function HotCover({ record }: { record: HotSeries }) {
  const [failed, setFailed] = useState(false);
  return record.coverUrl && !failed ? (
    <img
      src={record.coverUrl}
      alt={`Cover art for ${record.title}`}
      loading="lazy"
      width={180}
      height={270}
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="hot-week-cover-fallback" aria-label={`${record.title} cover unavailable`}>
      <Books size={24} />
    </span>
  );
}

function HotMovement({ movement }: { movement: number | null }) {
  if (movement === null) {
    return           <span className="hot-week-movement is-new"><Fire size={13} weight="fill" /> New</span>;
  }
  if (movement > 0) {
    return <span className="hot-week-movement is-up"><ArrowUp size={14} weight="bold" /> {movement}</span>;
  }
  if (movement < 0) {
    return <span className="hot-week-movement is-down"><ArrowDown size={14} weight="bold" /> {Math.abs(movement)}</span>;
  }
  return <span className="hot-week-movement is-steady"><Minus size={14} weight="bold" /> —</span>;
}

function HotMetric({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <span title={label}>
      {icon}
      <strong>{value.toLocaleString("en-US")}</strong>
    </span>
  );
}

export function HotThisWeek() {
  const [records, setRecords] = useState<HotSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [period, setPeriod] = useState<HotPeriod>("weekly");
  const periodLabel = HOT_PERIODS.find((option) => option.key === period)?.label ?? "Weekly";

  useEffect(() => {
    const controller = new AbortController();
    let firstLoad = true;

    async function loadWeeklyRankings() {
      if (firstLoad) setLoading(true);
      setError("");
      try {
        const response = await fetchWithHomeTimeout(`/api/v1/hot-this-week?period=${period}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data?: Omit<HotSeries, "rankMovement">[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Most Popular data could not be loaded.",
          );
        }

        let previousRanks: Record<string, number> = {};
        try {
          previousRanks = JSON.parse(
            window.localStorage.getItem(`${HOT_WEEK_SNAPSHOT_KEY}:${period}`) ?? "{}",
          ) as Record<string, number>;
        } catch {
          previousRanks = {};
        }

        const nextRecords = (payload.data ?? []).map((record) => ({
          ...record,
          rankMovement:
            previousRanks[record.id] === undefined
              ? null
              : previousRanks[record.id] - record.rank,
        }));
        setRecords(nextRecords);
        try {
          window.localStorage.setItem(
            `${HOT_WEEK_SNAPSHOT_KEY}:${period}`,
            JSON.stringify(
              Object.fromEntries(
                nextRecords.map((record) => [record.id, record.rank]),
              ),
            ),
          );
        } catch {
          // Rank movement remains available for the current session.
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            homeRequestMessage(
            loadError,
              "Most Popular data could not be loaded.",
          ),
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          firstLoad = false;
        }
      }
    }

    void loadWeeklyRankings();
    const timer = window.setInterval(loadWeeklyRankings, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [period, revision]);

  return (
    <section className="content-section page-wrap hot-this-week" aria-labelledby="most-popular-title">
      <header className="hot-week-heading">
        <div className="hot-week-title-group">
          <span className="hot-week-heading-icon" aria-hidden="true"><Fire size={20} weight="fill" /></span>
          <span className="section-heading-divider" aria-hidden="true" />
          <div>
            <h2 id="most-popular-title">Most Popular</h2>
          </div>
        </div>
        <a className="button button-secondary latest-all-action" href="/browse?sort=viewed">Browse <ArrowRight size={16} /></a>
      </header>
      <nav className="hot-week-tabs" aria-label="Hot ranking period">
        {HOT_PERIODS.map((option) => (
          <button
            className={period === option.key ? "is-active" : ""}
            key={option.key}
            type="button"
            aria-pressed={period === option.key}
            onClick={() => setPeriod(option.key)}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="dots-ring-loading hot-week-list hot-week-list-loading" role="status" aria-label={`Loading ${periodLabel.toLowerCase()} Most Popular titles`}>
          <DotsRing size="lg" label={null} />
          <span>Loading {periodLabel.toLowerCase()} Most Popular titles…</span>
        </div>
      ) : error ? (
        <div className="hot-week-state" role="alert">
          <strong>Most Popular is unavailable</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            <ArrowClockwise size={16} /> Try again
          </button>
        </div>
      ) : records.length ? (
        <div className="hot-week-list">
          {records.map((record) => (
            <article
              className={`hot-week-card hot-week-list-card${record.rank <= 3 ? ` is-top-${record.rank}` : ""}`}
              key={record.id}
            >
              <a className="hot-week-cover" href={`/title/${record.slug}`}>
                <span className="hot-week-rank" aria-label={`Rank ${record.rank}`}>
                  <b>{record.rank}</b>
                  <small>rank</small>
                </span>
                <HotMovement movement={record.rankMovement} />
                <span className="hot-week-cover-art">
                  <HotCover record={record} />
                </span>
              </a>
              <div className="hot-week-copy">
                <a className="hot-week-title-link" href={`/title/${record.slug}`}><h3>{record.title}</h3></a>
                {record.genres.length ? (
                  <span className="hot-week-genres">
                    <strong>Genres:</strong>{" "}
                    {record.genres.map((genre) => <small key={genre}>{genre}</small>)}
                  </span>
                ) : null}
                <span className="hot-week-metrics" aria-label={`${record.title} current catalog totals`}>
                  <HotMetric icon={<Eye size={16} />} value={record.viewCount} label="Views" />
                  <HotMetric icon={<Books size={16} />} value={record.chapterCount} label="Chapters" />
                  <HotMetric icon={<ChatCircle size={16} />} value={record.commentTotal} label="Comments" />
                  <HotMetric icon={<Heart size={16} />} value={record.followerCount} label="Followers" />
                </span>
                <span className="hot-week-rating" aria-label={`${record.title} rating ${record.rating.toFixed(1)} out of 10`}>
                  <span className="hot-week-stars" aria-hidden="true">
                    {Array.from({ length: 5 }, (_, index) => <Star key={index} size={15} weight="fill" />)}
                  </span>
                  <strong>{record.rating > 0 ? record.rating.toFixed(1) : "—"}</strong>
                </span>
                <a className="hot-week-read" href={`/title/${record.slug}`}>
                  Read <ArrowRight size={15} />
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="hot-week-state">
          <Fire size={25} />
            <strong>No {periodLabel.toLowerCase()} Most Popular titles yet</strong>
            <span>Reader activity will build this list as chapters are read and discussed.</span>
        </div>
      )}
    </section>
  );
}
