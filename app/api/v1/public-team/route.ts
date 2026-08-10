import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { getCommercialSettingsDocument } from "@/lib/server/commercial-settings";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

type TeamRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoKey: string | null;
  bannerKey: string | null;
  revision: number;
  createdAt: string;
};

type SeriesRow = {
  id: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  coverKey: string | null;
  revision: number;
  latestChapter: string | null;
  latestChapterSlug: string | null;
};

type LatestReleaseRow = {
  id: string;
  seriesSlug: string;
  seriesTitle: string;
  chapterSlug: string;
  chapterNumber: string;
  chapterTitle: string;
  publishedAt: string;
  thumbnailKey: string | null;
  revision: number;
};

type PinnedCommentRow = {
  id: string;
  body: string;
  spoiler: number;
  createdAt: string;
  displayName: string;
  seriesSlug: string;
  seriesTitle: string;
  chapterSlug: string | null;
};

type SupportSummaryRow = {
  totalAmount: number;
  giftCount: number;
  supporterCount: number;
};

type FocusedLanguageRow = {
  language: string;
  releaseCount: number;
};

type TeamMemberRow = {
  displayName: string;
  username: string;
  avatarKey: string | null;
  profileRevision: number;
  membershipRole: string;
  joinedAt: string;
};

type TeamLinkRow = {
  label: string;
  url: string;
  linkType: string;
};

function directMediaUrl(key: string | null) {
  const normalized = key?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function teamMediaUrl(
  team: Pick<TeamRow, "id" | "revision">,
  slot: "logo" | "banner",
  key: string | null,
) {
  return (
    directMediaUrl(key) ??
    (key
      ? `/api/v1/team-media?id=${encodeURIComponent(team.id)}&slot=${slot}&v=${team.revision}`
      : null)
  );
}

function seriesCoverUrl(
  series: Pick<SeriesRow, "id" | "revision" | "coverKey">,
) {
  return (
    directMediaUrl(series.coverKey) ??
    (series.coverKey
      ? `/api/v1/series-media?id=${encodeURIComponent(series.id)}&slot=cover&v=${series.revision}`
      : null)
  );
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Publishing team details are temporarily unavailable.",
      );
    }

    const url = new URL(request.url);
    const { slug } = querySchema.parse({
      slug: url.searchParams.get("slug"),
    });

    const team = await env.DB.prepare(
      `SELECT id, slug, name, description,
              logo_key AS logoKey,
              banner_key AS bannerKey,
              revision,
              created_at AS createdAt
         FROM teams
        WHERE slug = ?
          AND is_archived = 0
          AND verification_status = 'VERIFIED'
        LIMIT 1`,
    )
      .bind(slug)
      .first<TeamRow>();

    if (!team) {
      throw new ApiError(
        404,
        "TEAM_NOT_FOUND",
        "This publishing team is not available.",
      );
    }

    const commercial = await getCommercialSettingsDocument().catch(() => null);
    const premiumEconomyPublic = Boolean(
      commercial &&
        !commercial.recoveredFromInvalid &&
        commercial.settings.economy.premiumEconomyPublic,
    );

    const [
      seriesRows,
      releaseCountRow,
      followerCountRow,
      latestReleaseRows,
      pinnedCommentRows,
      focusedLanguageRows,
      memberRows,
      linkRows,
      supportSummaryRow,
    ] = await Promise.all([
      env.DB.prepare(
        `SELECT s.id, s.slug, s.title, s.type, s.status,
                s.cover_key AS coverKey,
                s.revision,
                latest.chapter_number AS latestChapter,
                latest.slug AS latestChapterSlug
           FROM (
             SELECT DISTINCT series_id
               FROM chapters
              WHERE team_id = ?
                AND state = 'PUBLISHED'
                AND visibility = 'PUBLIC'
                AND published_at IS NOT NULL
                AND datetime(published_at) <= datetime('now')
           ) participation
           JOIN series s ON s.id = participation.series_id
           LEFT JOIN chapters latest
             ON latest.id = (
               SELECT newest.id
                 FROM chapters newest
                WHERE newest.series_id = s.id
                  AND newest.team_id = ?
                  AND newest.state = 'PUBLISHED'
                  AND newest.visibility = 'PUBLIC'
                  AND newest.published_at IS NOT NULL
                  AND datetime(newest.published_at) <= datetime('now')
                ORDER BY datetime(newest.published_at) DESC,
                         datetime(newest.created_at) DESC,
                         newest.id DESC
                LIMIT 1
             )
          WHERE s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          ORDER BY
            CASE WHEN latest.published_at IS NULL THEN 1 ELSE 0 END,
            datetime(latest.published_at) DESC,
            s.title COLLATE NOCASE,
            s.id`,
      )
        .bind(team.id, team.id)
        .all<SeriesRow>(),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT c.id) AS count
           FROM chapters c
           JOIN series s ON s.id = c.series_id
          WHERE c.team_id = ?
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND c.published_at IS NOT NULL
            AND datetime(c.published_at) <= datetime('now')`,
      )
        .bind(team.id)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT f.user_id) AS count
           FROM (
             SELECT DISTINCT series_id
               FROM chapters
              WHERE team_id = ?
                AND state = 'PUBLISHED'
                AND visibility = 'PUBLIC'
                AND published_at IS NOT NULL
                AND datetime(published_at) <= datetime('now')
           ) participation
           JOIN series s ON s.id = participation.series_id
           JOIN follows f ON f.series_id = s.id
          WHERE s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')`,
      )
        .bind(team.id)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT c.id,
                s.slug AS seriesSlug,
                s.title AS seriesTitle,
                c.slug AS chapterSlug,
                c.chapter_number AS chapterNumber,
                c.title AS chapterTitle,
                c.published_at AS publishedAt,
                c.thumbnail_key AS thumbnailKey,
                c.revision
           FROM chapters c
           JOIN series s ON s.id = c.series_id
          WHERE c.team_id = ?
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND c.published_at IS NOT NULL
            AND datetime(c.published_at) <= datetime('now')
          ORDER BY datetime(c.published_at) DESC,
                   datetime(c.created_at) DESC,
                   c.id DESC
          LIMIT 8`,
      )
        .bind(team.id)
        .all<LatestReleaseRow>(),
      env.DB.prepare(
        `SELECT dc.id,
                dc.body,
                dc.spoiler,
                dc.created_at AS createdAt,
                u.display_name AS displayName,
                dc.series_slug AS seriesSlug,
                s.title AS seriesTitle,
                dc.chapter_slug AS chapterSlug
           FROM discussion_comments dc
           JOIN users u ON u.id = dc.user_id
           JOIN series s ON s.slug = dc.series_slug
           JOIN team_memberships tm
             ON tm.team_id = dc.affiliation_team_id
            AND tm.user_id = dc.user_id
            AND tm.status = 'ACTIVE'
          WHERE dc.affiliation_team_id = ?
            AND dc.pinned_at IS NOT NULL
            AND dc.parent_id IS NULL
            AND dc.moderation_status = 'VISIBLE'
            AND dc.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
                FROM chapters team_release
               WHERE team_release.series_id = s.id
                 AND team_release.team_id = dc.affiliation_team_id
                 AND team_release.state = 'PUBLISHED'
                 AND team_release.visibility = 'PUBLIC'
                 AND team_release.published_at IS NOT NULL
                 AND datetime(team_release.published_at) <= datetime('now')
            )
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
            AND (
              dc.chapter_slug IS NULL
              OR EXISTS (
                SELECT 1
                  FROM chapters pinned_chapter
                 WHERE pinned_chapter.series_id = s.id
                   AND pinned_chapter.slug = dc.chapter_slug
                   AND pinned_chapter.state = 'PUBLISHED'
                   AND pinned_chapter.visibility = 'PUBLIC'
                   AND pinned_chapter.published_at IS NOT NULL
                   AND datetime(pinned_chapter.published_at) <= datetime('now')
                   AND (
                     pinned_chapter.access_type = 'FREE'
                     OR (
                       pinned_chapter.free_at IS NOT NULL
                       AND datetime(pinned_chapter.free_at) <= datetime('now')
                     )
                   )
              )
            )
          ORDER BY datetime(dc.pinned_at) DESC,
                   datetime(dc.created_at) DESC,
                   dc.id DESC
          LIMIT 6`,
      )
        .bind(team.id)
        .all<PinnedCommentRow>(),
      env.DB.prepare(
        `SELECT c.language,
                COUNT(*) AS releaseCount
           FROM chapters c
           JOIN series s ON s.id = c.series_id
          WHERE c.team_id = ?
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND c.published_at IS NOT NULL
            AND datetime(c.published_at) <= datetime('now')
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
          GROUP BY c.language
          ORDER BY releaseCount DESC, c.language`,
      )
        .bind(team.id)
        .all<FocusedLanguageRow>(),
      env.DB.prepare(
        `SELECT u.display_name AS displayName,
                up.username,
                up.avatar_key AS avatarKey,
                up.revision AS profileRevision,
                tm.membership_role AS membershipRole,
                tm.created_at AS joinedAt
           FROM team_memberships tm
           JOIN users u ON u.id = tm.user_id
           JOIN user_profiles up
             ON up.user_id = tm.user_id
            AND up.profile_visibility = 'PUBLIC'
          WHERE tm.team_id = ?
            AND tm.status = 'ACTIVE'
            AND u.status = 'ACTIVE'
          ORDER BY
            CASE upper(tm.membership_role)
              WHEN 'OWNER' THEN 0
              WHEN 'LEADER' THEN 1
              WHEN 'TEAM_LEADER' THEN 1
              WHEN 'MANAGER' THEN 2
              WHEN 'UPLOADER' THEN 3
              ELSE 4
            END,
            u.display_name COLLATE NOCASE,
            u.id`,
      )
        .bind(team.id)
        .all<TeamMemberRow>(),
      env.DB.prepare(
        `SELECT label, url, link_type AS linkType
           FROM team_links
          WHERE team_id = ?
          ORDER BY sort_order, created_at, id`,
      )
        .bind(team.id)
        .all<TeamLinkRow>(),
      premiumEconomyPublic
        ? env.DB.prepare(
            `SELECT COALESCE(SUM(coin_amount), 0) AS totalAmount,
                    COUNT(*) AS giftCount,
                    COUNT(DISTINCT supporter_user_id) AS supporterCount
               FROM team_support_receipts
              WHERE team_id = ?`,
          )
            .bind(team.id)
            .first<SupportSummaryRow>()
        : Promise.resolve(null),
    ]);

    return json(
      requestId,
      {
        data: {
          id: team.id,
          slug: team.slug,
          name: team.name,
          description: team.description,
          createdAt: team.createdAt,
          logoUrl: teamMediaUrl(team, "logo", team.logoKey),
          bannerUrl: teamMediaUrl(team, "banner", team.bannerKey),
          publicSeriesCount: seriesRows.results.length,
          releaseCount: Number(releaseCountRow?.count ?? 0),
          followerCount: Number(followerCountRow?.count ?? 0),
          series: seriesRows.results.map((series) => ({
            id: series.id,
            slug: series.slug,
            title: series.title,
            type: series.type,
            status: series.status,
            coverUrl: seriesCoverUrl(series),
            latestChapter: series.latestChapter,
            latestChapterSlug: series.latestChapterSlug,
          })),
          latestReleases: latestReleaseRows.results.map((release) => ({
            id: release.id,
            seriesSlug: release.seriesSlug,
            seriesTitle: release.seriesTitle,
            chapterSlug: release.chapterSlug,
            chapterNumber: release.chapterNumber,
            chapterTitle: release.chapterTitle,
            publishedAt: release.publishedAt,
            thumbnailUrl: release.thumbnailKey
              ? `/api/v1/chapter-thumbnail?id=${encodeURIComponent(release.id)}&v=${release.revision}`
              : null,
          })),
          pinnedComments: pinnedCommentRows.results.map((comment) => ({
            id: comment.id,
            body: comment.body,
            spoiler: Boolean(comment.spoiler),
            createdAt: comment.createdAt,
            displayName: comment.displayName,
            seriesSlug: comment.seriesSlug,
            seriesTitle: comment.seriesTitle,
            chapterSlug: comment.chapterSlug,
          })),
          focusedLanguages: focusedLanguageRows.results.map((language) => ({
            language: language.language,
            releaseCount: Number(language.releaseCount),
          })),
          members: memberRows.results.map((member) => ({
            displayName: member.displayName,
            username: member.username,
            avatarUrl:
              member.username && member.avatarKey
                ? `/api/v1/profile-media?username=${encodeURIComponent(member.username)}&slot=avatar&v=${Number(member.profileRevision ?? 1)}`
                : null,
            membershipRole: member.membershipRole,
            joinedAt: member.joinedAt,
          })),
          links: linkRows.results,
          support:
            premiumEconomyPublic && supportSummaryRow
              ? {
                  totalAmount: Number(supportSummaryRow.totalAmount ?? 0),
                  giftCount: Number(supportSummaryRow.giftCount ?? 0),
                  supporterCount: Number(
                    supportSummaryRow.supporterCount ?? 0,
                  ),
                  coinPlural:
                    commercial?.settings.economy.coinPlural ?? "Paw Coins",
                }
              : null,
        },
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
