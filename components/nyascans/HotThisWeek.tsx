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
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";

type HotSeries = {
  id: string;
  rank: number;
  slug: string;
  title: string;
  coverUrl: string | null;
  genres: string[];
  uniqueReaders: number;
  chapterStarts: number;
  commentCount: number;
  reactionCount: number;
  rankMovement: number | null;
};

const HOT_WEEK_SNAPSHOT_KEY = "nyascans:hot-week-ranks";

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
    return <span className="hot-week-movement is-new"><Fire size={13} weight="fill" /> New</span>;
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

  useEffect(() => {
    const controller = new AbortController();
    let firstLoad = true;

    async function loadWeeklyRankings() {
      if (firstLoad) setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/v1/hot-this-week", {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data?: Omit<HotSeries, "rankMovement">[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Weekly activity could not be loaded.",
          );
        }

        let previousRanks: Record<string, number> = {};
        try {
          previousRanks = JSON.parse(
            window.localStorage.getItem(HOT_WEEK_SNAPSHOT_KEY) ?? "{}",
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
            HOT_WEEK_SNAPSHOT_KEY,
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
            loadError instanceof Error
              ? loadError.message
              : "Weekly activity could not be loaded.",
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
  }, [revision]);

  return (
    <section className="content-section page-wrap hot-this-week" aria-labelledby="hot-this-week-title">
      <header className="hot-week-heading">
        <div className="hot-week-title-group">
          <span className="hot-week-heading-icon" aria-hidden="true"><Fire size={20} weight="fill" /></span>
          <div>
            <h2 id="hot-this-week-title">Hot This Week</h2>
          </div>
        </div>
        <a href="/browse?sort=viewed">Browse Series <ArrowRight size={16} /></a>
      </header>

      {loading ? (
        <div className="hot-week-list hot-week-list-loading" aria-label="Loading weekly rankings">
          {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
        </div>
      ) : error ? (
        <div className="hot-week-state" role="alert">
          <strong>Weekly rankings are unavailable</strong>
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
              <div className="hot-week-card-topline">
                <span className="hot-week-rank" aria-label={`Rank ${record.rank}`}>
                  <b>{String(record.rank).padStart(2, "0")}</b>
                  <small>rank</small>
                </span>
                <HotMovement movement={record.rankMovement} />
              </div>
              <a className="hot-week-cover" href={`/title/${record.slug}`}>
                <HotCover record={record} />
              </a>
              <div className="hot-week-copy">
                <a className="hot-week-title-link" href={`/title/${record.slug}`}><h3>{record.title}</h3></a>
                <span className="hot-week-metrics" aria-label={`${record.title} weekly activity`}>
                  <HotMetric icon={<Eye size={16} />} value={record.uniqueReaders} label="Distinct readers in the last 7 days" />
                  <HotMetric icon={<Books size={16} />} value={record.chapterStarts} label="Chapter starts in the last 7 days" />
                  <HotMetric icon={<ChatCircle size={16} />} value={record.commentCount} label="Comments in the last 7 days" />
                  <HotMetric icon={<Heart size={16} />} value={record.reactionCount} label="Reactions in the last 7 days" />
                </span>
                {record.genres.length ? (
                  <span className="hot-week-genres">
                    {record.genres.map((genre) => <small key={genre}>{genre}</small>)}
                  </span>
                ) : null}
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
          <strong>No weekly ranking yet</strong>
          <span>Real reader activity will build this list as chapters are read and discussed.</span>
        </div>
      )}
    </section>
  );
}
