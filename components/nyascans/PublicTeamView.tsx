"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowRight,
  BookOpenText,
  Books,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type PublicTeamSeries = {
  id: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  coverUrl: string | null;
  latestChapter: string | null;
  latestChapterSlug: string | null;
};

type PublicTeam = {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  publicSeriesCount: number;
  releaseCount: number;
  series: PublicTeamSeries[];
};

type PublicTeamResponse = {
  data?: PublicTeam;
  error?: {
    message?: string;
  };
};

type PublicTeamLoadState = {
  slug: string;
  team: PublicTeam | null;
  error: string;
};

function displayLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function teamInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const value = words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();

  return value || "NS";
}

function chapterLabel(chapter: string) {
  const value = chapter.trim();
  return /^chapter\b/i.test(value) ? value : `Chapter ${value}`;
}

function TeamBanner({ team }: { team: PublicTeam }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(
    team.bannerUrl && failedUrl !== team.bannerUrl,
  );

  return (
    <span className="public-team-banner">
      {showImage ? (
        <img
          src={team.bannerUrl!}
          alt={`${team.name} banner`}
          onError={() => setFailedUrl(team.bannerUrl)}
        />
      ) : (
        <span className="public-team-banner-fallback" aria-hidden="true" />
      )}
    </span>
  );
}

function TeamLogo({ team }: { team: PublicTeam }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(team.logoUrl && failedUrl !== team.logoUrl);

  return (
    <span className="public-team-logo">
      {showImage ? (
        <img
          src={team.logoUrl!}
          alt={`${team.name} logo`}
          onError={() => setFailedUrl(team.logoUrl)}
        />
      ) : (
        <span
          className="public-team-logo-fallback"
          aria-label={`${team.name} logo`}
        >
          {teamInitials(team.name)}
        </span>
      )}
    </span>
  );
}

function SeriesCover({ series }: { series: PublicTeamSeries }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(
    series.coverUrl && failedUrl !== series.coverUrl,
  );

  return (
    <span className="public-team-series-cover">
      {showImage ? (
        <img
          src={series.coverUrl!}
          alt={`Cover art for ${series.title}`}
          loading="lazy"
          decoding="async"
          width={320}
          height={480}
          onError={() => setFailedUrl(series.coverUrl)}
        />
      ) : (
        <span
          className="public-team-series-cover-fallback"
          aria-label={`Cover unavailable for ${series.title}`}
        >
          <Books size={28} aria-hidden="true" />
          <small>Cover unavailable</small>
        </span>
      )}
    </span>
  );
}

function PublicTeamSeriesCard({ series }: { series: PublicTeamSeries }) {
  const titleHref = `/title/${encodeURIComponent(series.slug)}`;
  const latestHref = series.latestChapterSlug
    ? `${titleHref}/chapter/${encodeURIComponent(series.latestChapterSlug)}`
    : null;

  return (
    <article className="public-team-series-card">
      <a
        className="public-team-series-cover-link"
        href={titleHref}
        aria-label={`View ${series.title}`}
      >
        <SeriesCover series={series} />
      </a>
      <div className="public-team-series-copy">
        <a className="public-team-series-title" href={titleHref}>
          {series.title}
        </a>
        <span className="public-team-series-meta">
          <small>{displayLabel(series.type)}</small>
          <small>{displayLabel(series.status)}</small>
        </span>
        {series.latestChapter ? (
          latestHref ? (
            <a className="public-team-series-latest" href={latestHref}>
              <span>{chapterLabel(series.latestChapter)}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          ) : (
            <span className="public-team-series-latest">
              {chapterLabel(series.latestChapter)}
            </span>
          )
        ) : (
          <span className="public-team-series-latest is-empty">
            No public chapters yet
          </span>
        )}
      </div>
    </article>
  );
}

export function PublicTeamView({ slug }: { slug?: string }) {
  const requestedSlug = slug?.trim() ?? "";
  const [loadState, setLoadState] = useState<PublicTeamLoadState>({
    slug: "",
    team: null,
    error: "",
  });

  useEffect(() => {
    if (!requestedSlug) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/public-team?slug=${encodeURIComponent(requestedSlug)}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as PublicTeamResponse;

        if (!response.ok || !payload.data) {
          throw new Error(
            payload.error?.message ?? "This publishing team is unavailable.",
          );
        }

        setLoadState({
          slug: requestedSlug,
          error: "",
          team: {
            ...payload.data,
            series: Array.isArray(payload.data.series)
              ? payload.data.series
              : [],
          },
        });
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setLoadState({
            slug: requestedSlug,
            team: null,
            error:
              loadError instanceof Error
                ? loadError.message
                : "This publishing team is unavailable.",
          });
        }
      }
    })();

    return () => controller.abort();
  }, [requestedSlug]);

  if (!requestedSlug) {
    return (
      <main className="page-main page-wrap public-team-state public-team-error">
        <Books size={30} aria-hidden="true" />
        <strong>Publishing team unavailable</strong>
        <p>No publishing team was specified.</p>
        <a href="/browse">
          Browse NyaScans
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </main>
    );
  }

  if (loadState.slug !== requestedSlug) {
    return (
      <main
        className="page-main page-wrap public-team-state public-team-loading"
        role="status"
        aria-live="polite"
      >
        <span className="public-team-loading-banner" aria-hidden="true" />
        <span className="public-team-loading-logo" aria-hidden="true" />
        <strong>Loading publishing team...</strong>
      </main>
    );
  }

  if (loadState.error || !loadState.team) {
    return (
      <main className="page-main page-wrap public-team-state public-team-error">
        <Books size={30} aria-hidden="true" />
        <strong>Publishing team unavailable</strong>
        <p>
          {loadState.error || "This publishing team could not be loaded."}
        </p>
        <a href="/browse">
          Browse NyaScans
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </main>
    );
  }

  const team = loadState.team;

  return (
    <main className="page-main public-team-page">
      <section
        className="public-team-hero"
        aria-labelledby="public-team-title"
      >
        <TeamBanner team={team} />
        <div className="page-wrap public-team-identity">
          <TeamLogo team={team} />
          <div className="public-team-summary">
            <h1 id="public-team-title">{team.name}</h1>
            <p>
              {team.description ||
                "This publishing team has not added a description yet."}
            </p>
            <dl className="public-team-metrics">
              <div className="public-team-metric">
                <dt>
                  <Books size={18} aria-hidden="true" />
                  Public series
                </dt>
                <dd>{team.publicSeriesCount}</dd>
              </div>
              <div className="public-team-metric">
                <dt>
                  <BookOpenText size={18} aria-hidden="true" />
                  Releases
                </dt>
                <dd>{team.releaseCount}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section
        className="content-section page-wrap public-team-series"
        aria-labelledby="public-team-series-title"
      >
        <div className="section-heading public-team-series-heading">
          <div>
            <h2 id="public-team-series-title">Published series</h2>
            <p>
              {team.series.length === 1
                ? "1 public series from this team."
                : `${team.series.length} public series from this team.`}
            </p>
          </div>
        </div>

        {team.series.length ? (
          <div className="public-team-series-grid">
            {team.series.map((series) => (
              <PublicTeamSeriesCard key={series.id} series={series} />
            ))}
          </div>
        ) : (
          <div className="public-team-empty">
            <Books size={30} aria-hidden="true" />
            <strong>No public series yet</strong>
            <span>Approved series from this team will appear here.</span>
          </div>
        )}
      </section>
    </main>
  );
}
