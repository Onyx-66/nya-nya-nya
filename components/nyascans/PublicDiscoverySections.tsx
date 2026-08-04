"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowRight,
  BookOpenText,
  Books,
  UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { LanguageFlag } from "@/components/nyascans/LanguageFlag";
import { normalizeChapterNumber } from "@/lib/chapter-number";

type NewSeriesRecord = {
  id: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  publicAt: string;
  genres: string[];
  latestChapter: string | null;
  coverUrl: string | null;
};

type PublicTeamRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  publicSeriesCount: number;
  releaseCount: number;
  followerCount: number;
  logoUrl: string | null;
  bannerUrl: string | null;
};

function label(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SeriesTypeLabel({ type }: { type: string }) {
  const normalized =
    type.toUpperCase() === "MANHWA"
      ? "Manhwa"
      : type.toUpperCase() === "MANHUA"
        ? "Manhua"
        : "Manga";
  const country =
    normalized === "Manhwa" ? "kr" : normalized === "Manhua" ? "cn" : "jp";
  return (
    <span
      className={`series-type-badge type-${normalized.toLowerCase()} is-flag-only`}
      aria-label={normalized}
      title={normalized}
    >
      <LanguageFlag country={country} label={normalized} showCode={false} />
    </span>
  );
}

function SeriesStatusLabel({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const tone =
    normalized === "COMPLETED"
      ? "completed"
      : normalized === "HIATUS" || normalized === "PAUSED"
        ? "paused"
        : normalized === "ONGOING"
          ? "ongoing"
          : "upcoming";
  return (
    <span className={`series-status-badge status-${tone}`}>
      <i aria-hidden="true" />
      {label(status)}
    </span>
  );
}

function NewSeriesCover({ record }: { record: NewSeriesRecord }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = Boolean(record.coverUrl && failedUrl === record.coverUrl);

  return (
    <span className="new-series-cover">
      {record.coverUrl && !failed ? (
        <img
          src={record.coverUrl}
          alt={`Cover art for ${record.title}`}
          loading="lazy"
          width={320}
          height={480}
          onError={() => setFailedUrl(record.coverUrl)}
        />
      ) : (
        <span className="new-series-cover-placeholder" aria-label={`${record.title} cover unavailable`}>
          <Books size={30} />
          <em>Cover pending</em>
        </span>
      )}
      <small>New</small>
      <span className="new-series-badges">
        <SeriesTypeLabel type={record.type} />
        <SeriesStatusLabel status={record.status} />
      </span>
    </span>
  );
}

function PublishingTeamCard({
  active,
  index,
  record,
}: {
  active: boolean;
  index: number;
  record: PublicTeamRecord;
}) {
  const [failedBannerUrl, setFailedBannerUrl] = useState<string | null>(null);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const bannerFailed = Boolean(
    record.bannerUrl && failedBannerUrl === record.bannerUrl,
  );
  const logoFailed = Boolean(
    record.logoUrl && failedLogoUrl === record.logoUrl,
  );

  return (
    <article
      className="team-carousel-card"
      data-active={active ? "true" : "false"}
      data-team-index={index}
    >
      <span className="team-carousel-banner">
        {record.bannerUrl && !bannerFailed ? (
          <img
            src={record.bannerUrl}
            alt={`${record.name} banner`}
            loading="lazy"
            onError={() => setFailedBannerUrl(record.bannerUrl)}
          />
        ) : (
          <span aria-hidden="true" />
        )}
      </span>
      <span className="team-carousel-logo">
        {record.logoUrl && !logoFailed ? (
          <img
            src={record.logoUrl}
            alt={`${record.name} logo`}
            loading="lazy"
            onError={() => setFailedLogoUrl(record.logoUrl)}
          />
        ) : (
          <span aria-hidden="true">
            {record.name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </span>
      <div>
        <h3>{record.name}</h3>
        <p>
          {record.description ||
            "Verified publishing team on NyaScans."}
        </p>
        <span className="team-public-metrics">
          <small>
            <Books size={15} /> {record.publicSeriesCount} series
          </small>
          <small>
            <BookOpenText size={15} /> {record.releaseCount} releases
          </small>
          <small>
            <UsersThree size={15} /> {record.followerCount} followers
          </small>
        </span>
        <a href={`/team/${record.slug}`}>
          View team <ArrowRight size={16} />
        </a>
      </div>
    </article>
  );
}

export function NewSeriesSection() {
  const [records, setRecords] = useState<NewSeriesRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const railRef = useRef<HTMLDivElement | null>(null);

  function move(direction: -1 | 1) {
    railRef.current?.scrollBy({
      left: direction * Math.max(260, railRef.current.clientWidth * 0.78),
      behavior: "smooth",
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/new-series?limit=8", {
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: NewSeriesRecord[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "New series are unavailable.");
        }
        setRecords(payload.data ?? []);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "New series are unavailable.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <section
      className="content-section page-wrap public-new-series"
      aria-labelledby="new-series-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="new-series-title">New Series</h2>
          <p>Recently published titles, newest additions first.</p>
        </div>
        <div className="new-series-heading-actions">
          <a href="/browse?sort=added">
            View all <ArrowRight size={17} />
          </a>
        </div>
      </div>
      {loading ? (
        <div className="public-discovery-loading" role="status">
          Loading new series…
        </div>
      ) : error ? (
        <div className="public-discovery-error" role="alert">
          <strong>New series could not be loaded</strong>
          <span>{error}</span>
        </div>
      ) : records.length ? (
        <div
          className="new-series-grid"
          ref={railRef}
          tabIndex={0}
          aria-label="New series carousel"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              move(1);
            }
          }}
        >
          {records.map((record) => (
            <a
              className="new-series-card"
              href={`/title/${record.slug}`}
              key={record.id}
              title={record.title}
            >
              <NewSeriesCover record={record} />
              <span className="new-series-copy">
                <strong>{record.title}</strong>
                <small>
                  {record.genres.length
                    ? record.genres.join(" · ")
                    : "Genres pending"}
                </small>
                {record.latestChapter ? (
                  <em>
                    Latest: Chapter {normalizeChapterNumber(record.latestChapter)}
                  </em>
                ) : null}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="public-discovery-empty">
          <Books size={28} />
          <strong>No newly published series yet</strong>
          <span>Approved public titles will appear here.</span>
        </div>
      )}
    </section>
  );
}

export function PublishingTeamsCarousel() {
  const [records, setRecords] = useState<PublicTeamRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/public-teams?limit=10", {
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: PublicTeamRecord[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Publishing teams are unavailable.",
          );
        }
        setRecords(payload.data ?? []);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Publishing teams are unavailable.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  function goTo(index: number) {
    const rail = railRef.current;
    if (!rail || records.length === 0) return;
    const nextIndex = (index + records.length) % records.length;
    const card = rail.querySelector<HTMLElement>(
      `[data-team-index="${nextIndex}"]`,
    );
    if (!card) return;
    rail.scrollTo({
      left: Math.max(
        0,
        card.offsetLeft - (rail.clientWidth - card.clientWidth) / 2,
      ),
      behavior: "smooth",
    });
    setActiveIndex(nextIndex);
  }

  function move(direction: -1 | 1) {
    goTo(activeIndex + direction);
  }

  function syncActiveCard() {
    const rail = railRef.current;
    if (!rail) return;
    const center = rail.scrollLeft + rail.clientWidth / 2;
    const cards = Array.from(
      rail.querySelectorAll<HTMLElement>("[data-team-index]"),
    );
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const card of cards) {
      const distance = Math.abs(
        card.offsetLeft + card.clientWidth / 2 - center,
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = Number(card.dataset.teamIndex ?? 0);
      }
    }
    setActiveIndex(closestIndex);
  }

  if (!loading && !error && records.length === 0) return null;

  return (
    <section
      className="content-section page-wrap public-teams"
      aria-labelledby="publishing-teams-title"
    >
      <div className="section-heading teams-heading">
        <div>
          <h2 id="publishing-teams-title">Publishing Teams</h2>
          <p>Meet the verified teams producing releases across NyaScans.</p>
        </div>
      </div>
      {loading ? (
        <div className="public-discovery-loading" role="status">
          Loading publishing teams…
        </div>
      ) : error ? (
        <div className="public-discovery-error" role="alert">
          <strong>Publishing teams could not be loaded</strong>
          <span>{error}</span>
        </div>
      ) : (
        <div className="teams-carousel-shell">
          <div
            className={`teams-carousel ${records.length === 1 ? "is-single" : ""}`}
            ref={railRef}
            tabIndex={0}
            aria-label="Publishing teams carousel"
            onScroll={syncActiveCard}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              }
            }}
          >
            {records.map((record, index) => (
              <PublishingTeamCard
                active={index === activeIndex}
                index={index}
                key={record.id}
                record={record}
              />
            ))}
          </div>
        </div>
      )}
      {!loading && !error && records.length > 1 ? (
        <div className="teams-carousel-dots" aria-label="Choose publishing team">
          {records.map((record, index) => (
            <button
              type="button"
              key={record.id}
              aria-label={`Show ${record.name}`}
              aria-pressed={index === activeIndex}
              onClick={() => goTo(index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
