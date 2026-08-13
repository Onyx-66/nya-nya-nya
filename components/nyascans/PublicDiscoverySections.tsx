"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowRight,
  BookOpenText,
  Books,
  UsersThree,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  List,
  Medal,
  Plus,
  SquaresFour,
  Translate,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LanguageFlag } from "@/components/nyascans/LanguageFlag";
import { normalizeChapterNumber } from "@/lib/chapter-number";
import { languageName } from "@/lib/language-flags";

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
  releaseLanguages: string[];
  totalViews: number;
  commentCount: number;
  rank: number;
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
    normalized === "CANCELLED"
      ? "cancelled"
      : normalized === "COMPLETED"
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
  position = 0,
  variant = "carousel",
}: {
  active: boolean;
  index: number;
  position?: -1 | 0 | 1;
  record: PublicTeamRecord;
  variant?: "carousel" | "directory";
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
      className={`team-carousel-card${variant === "directory" ? " team-directory-card" : ""}${record.rank <= 3 ? ` is-ranked-${record.rank}` : ""}`}
      data-active={active ? "true" : "false"}
      data-team-index={index}
      data-team-position={position}
      data-site-rank={record.rank}
    >
      {record.rank <= 3 ? (
        <span className={`team-rank-badge rank-${record.rank}`} aria-label={`Top team rank ${record.rank}`}>
          <Medal size={17} weight="fill" /> {record.rank}
        </span>
      ) : null}
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
        {record.releaseLanguages.length ? (
          <span className="team-release-languages" aria-label="Published release languages">
            {record.releaseLanguages.map((language) => (
              <span key={language} title={languageName(language)}>
                <LanguageFlag language={language} showCode={false} />
                <small>{languageName(language)}</small>
              </span>
            ))}
          </span>
        ) : null}
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
        <a className="team-card-action" href={`/team/${record.slug}`}>
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
            View All <ArrowRight size={17} />
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
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [language, setLanguage] = useState("");
  const teamPointerStartRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/public-teams?limit=7", {
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
        setRecords(
          (payload.data ?? []).slice(0, 7).map((record, index) => ({
            ...record,
            rank: Number(record.rank || index + 1),
          })),
        );
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

  const visibleRecords = language
    ? records.filter((record) => record.releaseLanguages.includes(language))
    : records;

  function goTo(index: number) {
    if (!visibleRecords.length) return;
    setIsTransitioning(true);
    setActiveIndex((index + visibleRecords.length) % visibleRecords.length);
    window.setTimeout(() => setIsTransitioning(false), 420);
  }

  function move(direction: -1 | 1) {
    goTo(activeIndex + direction);
  }

  const teamSlots = useMemo(() => {
    if (!visibleRecords.length) return [];
    if (visibleRecords.length === 1) {
      return [{ record: visibleRecords[0]!, index: 0, position: 0 as const }];
    }
    const leftIndex = activeIndex === 0
      ? Math.min(2, visibleRecords.length - 1)
      : (activeIndex - 1 + visibleRecords.length) % visibleRecords.length;
    const rightIndex = (activeIndex + 1) % visibleRecords.length;
    return [
      { record: visibleRecords[leftIndex]!, index: leftIndex, position: -1 as const },
      { record: visibleRecords[activeIndex]!, index: activeIndex, position: 0 as const },
      { record: visibleRecords[rightIndex]!, index: rightIndex, position: 1 as const },
    ];
  }, [activeIndex, visibleRecords]);

  function selectLanguage(nextLanguage: string) {
    setLanguage(nextLanguage);
    setActiveIndex(0);
      window.requestAnimationFrame(() => {
        setActiveIndex(0);
      });
    document
      .querySelector(".public-teams .compact-language-menu[open]")
      ?.removeAttribute("open");
  }

  if (!loading && !error && records.length === 0) return null;

  return (
    <section
      className="content-section page-wrap public-teams"
      aria-labelledby="publishing-teams-title"
    >
      <div className="section-heading teams-heading">
        <div>
          <h2 id="publishing-teams-title">Top Publishing Teams</h2>
          <p>Verified teams ranked by real releases and reader activity.</p>
        </div>
          <div className="teams-heading-actions">
          <details className="compact-language-menu">
            <summary aria-label={language ? `Language: ${languageName(language)}` : "Choose team language"}>
              {language ? <LanguageFlag language={language} showCode={false} /> : <Translate size={18} />}
              <CaretDown size={12} />
            </summary>
            <div>
              <button type="button" aria-pressed={!language} onClick={() => selectLanguage("")}><span>All languages</span>{!language ? <Check size={15} /> : null}</button>
              {[...new Set(records.flatMap((record) => record.releaseLanguages))].sort().map((entry) => (
                <button type="button" key={entry} aria-pressed={language === entry} onClick={() => selectLanguage(entry)}>
                  <LanguageFlag language={entry} showCode={false} /> <span>{languageName(entry)}</span>{language === entry ? <Check size={15} /> : null}
                </button>
              ))}
            </div>
          </details>
          <a href="/teams">Browse Teams <ArrowRight size={16} /></a>
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
      ) : visibleRecords.length ? (
        <div className="teams-carousel-shell">
          {visibleRecords.length > 1 ? (
            <div className="teams-carousel-controls" aria-label="Publishing team controls">
              <button type="button" aria-label="Previous publishing team" disabled={visibleRecords.length < 2} onClick={() => move(-1)}><CaretLeft size={17} /></button>
              <button type="button" aria-label="Next publishing team" disabled={visibleRecords.length < 2} onClick={() => move(1)}><CaretRight size={17} /></button>
            </div>
          ) : null}
          <div
            className={`teams-carousel ${visibleRecords.length === 1 ? "is-single" : "is-circular"}${isTransitioning ? " is-transitioning" : ""}`}
            tabIndex={0}
            aria-label="Top Publishing Teams carousel"
            onPointerDown={(event) => {
              if (event.pointerType !== "mouse") teamPointerStartRef.current = event.clientX;
            }}
            onPointerUp={(event) => {
              const start = teamPointerStartRef.current;
              teamPointerStartRef.current = null;
              if (start === null || Math.abs(event.clientX - start) < 42) return;
              move(event.clientX < start ? 1 : -1);
            }}
            onPointerCancel={() => {
              teamPointerStartRef.current = null;
            }}
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
            {teamSlots.map(({ record, index, position }) => (
              <PublishingTeamCard
                active={position === 0}
                index={index}
                key={`${record.id}:${position}`}
                position={position}
                record={record}
              />
            ))}
            {visibleRecords.slice(3).map((record, index) => (
              <span className="team-carousel-behind" data-team-index={index + 3} key={`behind-${record.id}`} aria-hidden="true" />
            ))}
          </div>
        </div>
      ) : (
        <div className="public-discovery-empty">
          <UsersThree size={28} />
          <strong>No teams publish in this language yet</strong>
          <span>Choose another language or view all verified publishing teams.</span>
          <button type="button" onClick={() => selectLanguage("")}>
            Show all teams
          </button>
        </div>
      )}
      {!loading && !error && visibleRecords.length > 1 ? (
        <div className="teams-carousel-dots" aria-label="Choose publishing team">
          {visibleRecords.map((record, index) => (
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

export function PublishingTeamsDirectory() {
  const [records, setRecords] = useState<PublicTeamRecord[]>([]);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [view, setView] = useState<"GRID" | "LIST">("GRID");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/public-teams?limit=24", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: PublicTeamRecord[]; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? "Publishing teams are unavailable.");
        setRecords(
          (payload.data ?? []).map((record, index) => ({
            ...record,
            rank: Number(record.rank || index + 1),
          })),
        );
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Publishing teams are unavailable.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const languages = useMemo(
    () => [...new Set(records.flatMap((record) => record.releaseLanguages))].sort(),
    [records],
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return records.filter((record) =>
      (!term || `${record.name} ${record.description}`.toLowerCase().includes(term)) &&
      (!language || record.releaseLanguages.includes(language)),
    );
  }, [language, query, records]);

  return (
    <main className="page-main page-wrap teams-directory">
      <header>
        <div><p className="eyebrow">Verified publishers</p><h1>Publishing teams</h1><p>Search teams, filter by their actual release languages, and compare their public activity.</p></div>
        <a className="button button-primary" href="/dashboard/my-teams"><Plus size={17} /> Create or manage a team</a>
      </header>
      <section className="teams-directory-controls" aria-label="Team directory controls">
        <label><span className="sr-only">Search teams</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teams" /></label>
        <details className="compact-language-menu teams-directory-language">
          <summary aria-label={language ? `Language: ${languageName(language)}` : "Choose release language"}>
            {language ? <LanguageFlag language={language} showCode={false} /> : <Translate size={19} />}
            <CaretDown size={12} />
          </summary>
          <div>
            <button type="button" aria-pressed={!language} onClick={(event) => { setLanguage(""); event.currentTarget.closest("details")?.removeAttribute("open"); }}><span>All languages</span>{!language ? <Check size={15} /> : null}</button>
            {languages.map((entry) => <button type="button" key={entry} aria-pressed={language === entry} onClick={(event) => { setLanguage(entry); event.currentTarget.closest("details")?.removeAttribute("open"); }}><LanguageFlag language={entry} showCode={false} /><span>{languageName(entry)}</span>{language === entry ? <Check size={15} /> : null}</button>)}
          </div>
        </details>
        <div className="view-mode-toggle" role="group" aria-label="Team list view">
          <button type="button" aria-label="Grid view" title="Grid view" aria-pressed={view === "GRID"} onClick={() => setView("GRID")}><SquaresFour size={18} /></button>
          <button type="button" aria-label="List view" title="List view" aria-pressed={view === "LIST"} onClick={() => setView("LIST")}><List size={18} /></button>
        </div>
      </section>
      {loading ? <div className="public-discovery-loading">Loading teams…</div> : error ? <div className="public-discovery-error" role="alert">{error}</div> : (
        <section className={`teams-directory-results is-${view.toLowerCase()}`} aria-label={`${filtered.length} publishing teams`}>
          {filtered.map((record, index) => <PublishingTeamCard key={record.id} record={record} index={index} active variant="directory" />)}
        </section>
      )}
    </main>
  );
}
