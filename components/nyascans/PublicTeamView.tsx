"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowRight,
  BookOpenText,
  Books,
  CalendarBlank,
  ChatCircle,
  Gift,
  IdentificationCard,
  PushPin,
  Sparkle,
  Translate,
  UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { FormattedCommentText } from "@/components/nyascans/EnhancedDiscussionSection";
import { LanguageFlag } from "@/components/nyascans/LanguageFlag";
import { TeamDiscussionPanel } from "@/components/nyascans/TeamDiscussionPanel";
import { languageName } from "@/lib/language-flags";
import { mockAvatarUrl, mockTeamBannerUrl, mockTeamLogoUrl } from "@/lib/mock-media";

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
  createdAt: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  publicSeriesCount: number;
  releaseCount: number;
  followerCount: number;
  series: PublicTeamSeries[];
  latestReleases: PublicTeamLatestRelease[];
  pinnedComments: PublicTeamPinnedComment[];
  focusedLanguages: Array<{
    language: string;
    releaseCount: number;
  }>;
  members: Array<{
    displayName: string;
    username: string;
    avatarUrl: string | null;
    membershipRole: string;
    joinedAt: string;
  }>;
  links: Array<{
    label: string;
    url: string;
    linkType: string;
  }>;
  support: PublicTeamSupport | null;
};

type PublicTeamLatestRelease = {
  id: string;
  seriesSlug: string;
  seriesTitle: string;
  chapterSlug: string;
  chapterNumber: string;
  chapterTitle: string;
  publishedAt: string;
  thumbnailUrl: string | null;
};

type PublicTeamPinnedComment = {
  id: string;
  body: string;
  spoiler: boolean;
  createdAt: string;
  displayName: string;
  seriesSlug: string;
  seriesTitle: string;
  chapterSlug: string | null;
};

type PublicTeamSupport = {
  totalAmount: number;
  giftCount: number;
  supporterCount: number;
  coinPlural: string;
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
  const fallbackUrl = mockTeamBannerUrl(team.id || team.name);
  const imageUrl = failedUrl ? fallbackUrl : team.bannerUrl || fallbackUrl;
  const showImage = Boolean(imageUrl);

  return (
    <span className="public-team-banner">
      {showImage ? (
        <img
          src={imageUrl}
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
  const fallbackUrl = mockTeamLogoUrl(team.id || team.name);
  const imageUrl = failedUrl ? fallbackUrl : team.logoUrl || fallbackUrl;
  const showImage = Boolean(imageUrl);

  return (
    <span className="public-team-logo">
      {showImage ? (
        <img
          src={imageUrl}
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

export function PublicTeamView({
  slug,
  signedIn = false,
}: {
  slug?: string;
  signedIn?: boolean;
}) {
  const requestedSlug = slug?.trim() ?? "";
  const [tab, setTab] = useState<
    "info" | "titles" | "members" | "discussion"
  >("info");
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
            latestReleases: Array.isArray(payload.data.latestReleases)
              ? payload.data.latestReleases
              : [],
            pinnedComments: Array.isArray(payload.data.pinnedComments)
              ? payload.data.pinnedComments
              : [],
            focusedLanguages: Array.isArray(payload.data.focusedLanguages)
              ? payload.data.focusedLanguages
              : [],
            members: Array.isArray(payload.data.members)
              ? payload.data.members
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
              <div className="public-team-metric">
                <dt>
                  <UsersThree size={18} aria-hidden="true" />
                  Readers reached
                </dt>
                <dd>{team.followerCount}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <div
        className="page-wrap public-team-tabs"
        role="tablist"
        aria-label={`${team.name} sections`}
      >
        {(
          [
            ["info", "Info", IdentificationCard],
            ["titles", `Titles (${team.series.length})`, Books],
            ["members", `Members (${team.members.length})`, UsersThree],
            ["discussion", "Discussion", ChatCircle],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            type="button"
            key={value}
            id={`public-team-${value}-tab`}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`public-team-${value}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === "info" ? (
        <>
          <section className="content-section page-wrap public-team-info" id="public-team-info-panel" role="tabpanel" aria-labelledby="public-team-info-tab">
            <article className="public-team-description-card">
              <p className="eyebrow">About the group</p>
              <h2>Group description</h2>
              <p>
                {team.description ||
                  "This publishing team has not added a description yet."}
              </p>
            </article>
            <aside className="public-team-facts" aria-label="Group information">
              <div>
                <span>
                  <ArrowRight size={18} aria-hidden="true" />
                  Official links
                </span>
                <p className="public-team-link-list">
                  {team.links.map((link) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener">
                      {link.label}
                    </a>
                  ))}
                </p>
              </div>
              <div>
                <span>
                  <Translate size={18} aria-hidden="true" />
                  Focused languages
                </span>
                {team.focusedLanguages.length ? (
                  <p className="public-team-language-list">
                    {team.focusedLanguages.map((language) => (
                      <span key={language.language}>
                        <LanguageFlag
                          language={language.language}
                          showCode={false}
                        />
                        {languageName(language.language)} ·{" "}
                        {language.releaseCount.toLocaleString("en-US")} releases
                      </span>
                    ))}
                  </p>
                ) : (
                  <strong>No public releases yet</strong>
                )}
              </div>
              <div>
                <span>
                  <IdentificationCard size={18} aria-hidden="true" />
                  Group ID
                </span>
                <strong>{team.id}</strong>
              </div>
              <div>
                <span>
                  <CalendarBlank size={18} aria-hidden="true" />
                  Established
                </span>
                <strong>
                  {new Date(team.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                  })}
                </strong>
              </div>
              <div>
                <span>
                  <UsersThree size={18} aria-hidden="true" />
                  Active members
                </span>
                <strong>{team.members.length.toLocaleString("en-US")}</strong>
              </div>
            </aside>
          </section>

          <section
            className="content-section page-wrap public-team-releases"
            aria-labelledby="public-team-releases-title"
          >
            <div className="section-heading">
              <div>
                <h2 id="public-team-releases-title">Latest releases</h2>
                <p>The newest public chapters released by {team.name}.</p>
              </div>
            </div>
            {team.latestReleases.length ? (
              <div className="public-team-release-list">
                {team.latestReleases.map((release) => (
                  <a
                    href={`/title/${encodeURIComponent(release.seriesSlug)}/chapter/${encodeURIComponent(release.chapterSlug)}`}
                    className="public-team-release-card"
                    key={release.id}
                  >
                    <span className="public-team-release-thumbnail">
                      {release.thumbnailUrl ? (
                        <img
                          src={release.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <BookOpenText size={24} aria-hidden="true" />
                      )}
                    </span>
                    <span>
                      <small>{release.seriesTitle}</small>
                      <strong>{chapterLabel(release.chapterNumber)}</strong>
                      {release.chapterTitle ? (
                        <em>{release.chapterTitle}</em>
                      ) : null}
                      <time dateTime={release.publishedAt}>
                        {new Date(release.publishedAt).toLocaleDateString()}
                      </time>
                    </span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="public-team-empty is-compact">
                <BookOpenText size={28} aria-hidden="true" />
                <strong>No public releases yet</strong>
                <span>New chapters from this team will appear here.</span>
              </div>
            )}
          </section>

          <section className="content-section page-wrap public-team-community">
            <article
              className="public-team-community-card public-team-pins"
              aria-labelledby="public-team-pins-title"
            >
              <header>
                <span>
                  <PushPin size={20} weight="fill" aria-hidden="true" />
                </span>
                <div>
                  <h2 id="public-team-pins-title">Pinned team comments</h2>
                  <p>Highlights from {team.name} staff across series pages.</p>
                </div>
              </header>
              {team.pinnedComments.length ? (
                <div className="public-team-pin-list">
                  {team.pinnedComments.map((comment) => {
                    const sourceHref = comment.chapterSlug
                      ? `/title/${encodeURIComponent(comment.seriesSlug)}/chapter/${encodeURIComponent(comment.chapterSlug)}#comments`
                      : `/title/${encodeURIComponent(comment.seriesSlug)}#comments`;
                    return (
                      <article key={comment.id}>
                        <div>
                          <strong>{comment.displayName}</strong>
                          <a href={sourceHref}>
                            {comment.seriesTitle}
                            {comment.chapterSlug
                              ? " · Chapter discussion"
                              : ""}
                          </a>
                          <time dateTime={comment.createdAt}>
                            {new Date(
                              comment.createdAt,
                            ).toLocaleDateString()}
                          </time>
                        </div>
                        {comment.spoiler ? (
                          <details>
                            <summary>Spoiler-tagged team note</summary>
                            <FormattedCommentText value={comment.body} />
                          </details>
                        ) : (
                          <FormattedCommentText value={comment.body} />
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="public-team-community-empty">
                  <ChatCircle size={24} aria-hidden="true" />
                  <span>No series notes are pinned right now.</span>
                </div>
              )}
            </article>

            {team.support ? (
              <article
                className="public-team-community-card public-team-support"
                aria-labelledby="public-team-support-title"
              >
                <header>
                  <span>
                    <Gift size={20} weight="duotone" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 id="public-team-support-title">Community support</h2>
                    <p>Support sent through the NyaScans Store.</p>
                  </div>
                </header>
                <strong className="public-team-support-total">
                  <Sparkle size={22} weight="fill" aria-hidden="true" />
                  {team.support.totalAmount.toLocaleString("en-US")}{" "}
                  {team.support.coinPlural}
                </strong>
                <dl>
                  <div>
                    <dt>Support gifts</dt>
                    <dd>
                      {team.support.giftCount.toLocaleString("en-US")}
                    </dd>
                  </div>
                  <div>
                    <dt>Supporters</dt>
                    <dd>
                      {team.support.supporterCount.toLocaleString("en-US")}
                    </dd>
                  </div>
                </dl>
                <a className="button button-primary" href="/store/gifts">
                  Support this team
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
              </article>
            ) : null}
          </section>
        </>
      ) : null}

      {tab === "titles" ? (
        <section
          className="content-section page-wrap public-team-series"
          aria-labelledby="public-team-series-title"
          id="public-team-titles-panel"
          role="tabpanel"
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
      ) : null}

      {tab === "members" ? (
        <section
          className="content-section page-wrap public-team-members"
          aria-labelledby="public-team-members-title"
          id="public-team-members-panel"
          role="tabpanel"
        >
          <div className="section-heading">
            <div>
              <h2 id="public-team-members-title">Group members</h2>
              <p>Active staff and contributors in {team.name}.</p>
            </div>
          </div>
          {team.members.length ? (
            <div className="public-team-member-grid">
              {team.members.map((member) => {
                const content = (
                  <>
                    <span className="public-team-member-avatar">
                      <img
                        src={member.avatarUrl || mockAvatarUrl(member.username || member.displayName)}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          const fallback = mockAvatarUrl(member.username || member.displayName);
                          if (event.currentTarget.src !== new URL(fallback, window.location.href).href) {
                            event.currentTarget.src = fallback;
                          }
                        }}
                      />
                    </span>
                    <span>
                      <strong>{member.displayName}</strong>
                      <small>
                        {member.username
                          ? `@${member.username}`
                          : "Private profile"}
                      </small>
                    </span>
                    <em>{displayLabel(member.membershipRole)}</em>
                  </>
                );
                return (
                  <a
                    className="public-team-member-card"
                    href={`/u/${encodeURIComponent(member.username)}`}
                    key={member.username}
                  >
                    {content}
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="public-team-empty">
              <UsersThree size={30} aria-hidden="true" />
              <strong>No active members to display</strong>
            </div>
          )}
        </section>
      ) : null}

      {tab === "discussion" ? (
        <div className="content-section page-wrap" id="public-team-discussion-panel" role="tabpanel" aria-labelledby="public-team-discussion-tab">
          <TeamDiscussionPanel
            teamSlug={team.slug}
            teamName={team.name}
            signedIn={signedIn}
          />
        </div>
      ) : null}
    </main>
  );
}
