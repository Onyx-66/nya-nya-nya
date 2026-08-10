"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowClockwise,
  ArrowRight,
  Books,
  ChatCircle,
  Eye,
  Fire,
  Heart,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

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
};

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

export function HotThisWeek() {
  const [records, setRecords] = useState<HotSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/v1/hot-this-week", {
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: HotSeries[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Weekly activity could not be loaded.",
          );
        }
        if (!controller.signal.aborted) setRecords(payload.data ?? []);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Weekly activity could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);

  return (
    <section className="content-section page-wrap hot-this-week" aria-labelledby="hot-this-week-title">
      <header className="hot-week-heading">
        <div>
          <span aria-hidden="true"><Fire size={21} weight="fill" /></span>
          <div>
            <h2 id="hot-this-week-title">Hot This Week</h2>
            <p>Stories with the strongest real reader activity over the last 7 days.</p>
          </div>
        </div>
        <a href="/browse?sort=viewed">Browse popular series <ArrowRight size={16} /></a>
      </header>

      {loading ? (
        <div className="hot-week-grid is-loading" aria-label="Loading weekly rankings">
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
        <div className="hot-week-grid">
          {records.map((record) => (
            <article className="hot-week-card" key={record.id}>
              <span className={`hot-week-rank rank-${Math.min(record.rank, 4)}`}>
                {record.rank}
              </span>
              <a className="hot-week-cover" href={`/title/${record.slug}`}>
                <HotCover record={record} />
              </a>
              <div className="hot-week-copy">
                <a href={`/title/${record.slug}`}><h3>{record.title}</h3></a>
                <span className="hot-week-metrics">
                  <small title="Distinct readers in the last 7 days"><Eye size={14} /> {record.uniqueReaders.toLocaleString("en-US")}</small>
                  <small title="Chapter starts in the last 7 days"><Books size={14} /> {record.chapterStarts.toLocaleString("en-US")}</small>
                  <small title="Comments in the last 7 days"><ChatCircle size={14} /> {record.commentCount.toLocaleString("en-US")}</small>
                  <small title="Reactions in the last 7 days"><Heart size={14} /> {record.reactionCount.toLocaleString("en-US")}</small>
                </span>
                {record.genres.length ? (
                  <span className="hot-week-genres">
                    {record.genres.map((genre) => <small key={genre}>{genre}</small>)}
                  </span>
                ) : null}
                <a className="hot-week-read" href={`/title/${record.slug}`}>
                  Read series <ArrowRight size={15} />
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
