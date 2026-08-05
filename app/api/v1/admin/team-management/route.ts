import { env } from "cloudflare:workers";
import { z } from "zod";
import { slugSchema } from "@/lib/admin-metadata";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdmin } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const effectSchema = z.object({
  type: z.enum(["NONE", "BORDER", "GLOW", "ACCENT", "SPARKLE", "VERIFIED"]),
  enabled: z.boolean(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color.")
    .default("#2d8cff"),
  intensity: z.coerce.number().int().min(1).max(3).default(1),
  motion: z.enum(["NONE", "SUBTLE"]).default("NONE"),
});

const teamSchema = z.object({
  id: z.string().trim().min(3).max(160).optional(),
  revision: z.coerce.number().int().min(1).optional(),
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
  description: z.string().trim().min(12).max(2_000),
  verificationStatus: z
    .enum(["PENDING", "VERIFIED", "SUSPENDED"])
    .default("PENDING"),
  isArchived: z.boolean().default(false),
  canControlFixedReaderPages: z.boolean().default(false),
  effect: effectSchema,
});

type TeamRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoKey: string | null;
  bannerKey: string | null;
  staffBadgeKey: string | null;
  commentEffectType: string;
  commentEffectConfigJson: string;
  commentEffectEnabled: number;
  verificationStatus: string;
  isArchived: number;
  canControlFixedReaderPages: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  seriesCount: number;
  membersJson: string;
  seriesJson: string;
  activityJson: string;
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Team management is temporarily unavailable.",
    );
  }
  return env.DB;
}

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function assetUrl(
  teamId: string,
  slot: "logo" | "banner" | "badge",
  key: string | null,
  revision: number,
) {
  const normalized = key?.trim() ?? "";
  if (!normalized) return null;
  if (
    normalized.startsWith("/") ||
    /^https?:\/\//i.test(normalized)
  ) {
    return normalized;
  }
  return `/api/v1/team-media?id=${encodeURIComponent(teamId)}&slot=${slot}&v=${revision}`;
}

function mapTeam(row: TeamRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    logoUrl: assetUrl(row.id, "logo", row.logoKey, row.revision),
    bannerUrl: assetUrl(row.id, "banner", row.bannerKey, row.revision),
    staffBadgeUrl: assetUrl(
      row.id,
      "badge",
      row.staffBadgeKey,
      row.revision,
    ),
    effect: {
      type: row.commentEffectType,
      enabled: Boolean(row.commentEffectEnabled),
      ...parseObject(row.commentEffectConfigJson),
    },
    verificationStatus: row.verificationStatus,
    isArchived: Boolean(row.isArchived),
    canControlFixedReaderPages: Boolean(row.canControlFixedReaderPages),
    revision: Number(row.revision),
    memberCount: Number(row.memberCount),
    seriesCount: Number(row.seriesCount),
    members: parseArray(row.membersJson),
    series: parseArray(row.seriesJson),
    activity: parseArray(row.activityJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const teamSelect = `
  SELECT t.id, t.slug, t.name, t.description,
         t.logo_key AS logoKey, t.banner_key AS bannerKey,
         t.staff_badge_key AS staffBadgeKey,
         t.comment_effect_type AS commentEffectType,
         t.comment_effect_config_json AS commentEffectConfigJson,
         t.comment_effect_enabled AS commentEffectEnabled,
         t.verification_status AS verificationStatus,
         t.is_archived AS isArchived,
         t.can_control_fixed_reader_pages AS canControlFixedReaderPages,
         t.revision,
         t.created_at AS createdAt, t.updated_at AS updatedAt,
         (SELECT COUNT(*) FROM team_memberships tm
           WHERE tm.team_id = t.id AND tm.status = 'ACTIVE') AS memberCount,
         (SELECT COUNT(*) FROM series_team_assignments sta
           WHERE sta.team_id = t.id) AS seriesCount,
         COALESCE((
           SELECT json_group_array(json_object(
             'userId', u.id,
             'displayName', u.display_name,
             'email', u.email,
             'role', tm.membership_role,
             'status', tm.status,
             'isPrimary', tm.is_primary,
             'revision', tm.revision
           ))
           FROM team_memberships tm
           JOIN users u ON u.id = tm.user_id
           WHERE tm.team_id = t.id
           ORDER BY tm.status = 'ACTIVE' DESC, u.display_name COLLATE NOCASE
         ), '[]') AS membersJson,
         COALESCE((
           SELECT json_group_array(json_object(
             'seriesId', s.id,
             'title', s.title,
             'slug', s.slug,
             'canUpload', sta.can_upload,
             'canPublish', sta.can_publish,
             'isPrimary', sta.is_primary
           ))
           FROM series_team_assignments sta
           JOIN series s ON s.id = sta.series_id
           WHERE sta.team_id = t.id
           ORDER BY s.title COLLATE NOCASE
         ), '[]') AS seriesJson,
         COALESCE((
           SELECT json_group_array(json_object(
             'chapterId', recent.chapterId,
             'chapterSlug', recent.chapterSlug,
             'chapterNumber', recent.chapterNumber,
             'chapterTitle', recent.chapterTitle,
             'language', recent.language,
             'version', recent.version,
             'state', recent.state,
             'visibility', recent.visibility,
             'accessType', recent.accessType,
             'revision', recent.revision,
             'pageCount', recent.pageCount,
             'createdAt', recent.createdAt,
             'publishedAt', recent.publishedAt,
             'seriesId', recent.seriesId,
             'seriesSlug', recent.seriesSlug,
             'seriesTitle', recent.seriesTitle,
             'uploaderName', recent.uploaderName,
             'commentCount', recent.commentCount,
             'reportCount', recent.reportCount,
             'reactionCount', recent.reactionCount
           ))
           FROM (
             SELECT c.id AS chapterId, c.slug AS chapterSlug,
                    c.chapter_number AS chapterNumber,
                    c.title AS chapterTitle, c.language, c.version,
                    c.state, c.visibility, c.access_type AS accessType,
                    c.revision, c.page_count AS pageCount,
                    c.created_at AS createdAt,
                    c.published_at AS publishedAt,
                    s.id AS seriesId, s.slug AS seriesSlug,
                    s.title AS seriesTitle,
                    u.display_name AS uploaderName,
                    (SELECT COUNT(*) FROM discussion_comments dc
                      WHERE dc.series_slug = s.slug
                        AND dc.chapter_slug = c.slug
                        AND dc.deleted_at IS NULL) AS commentCount,
                    (SELECT COUNT(*) FROM reports r
                      WHERE r.status IN ('OPEN', 'IN_REVIEW')
                        AND (
                          (r.target_type = 'CHAPTER' AND r.target_id = c.id)
                          OR (r.target_type = 'COMMENT' AND r.target_id IN (
                            SELECT dc2.id FROM discussion_comments dc2
                             WHERE dc2.series_slug = s.slug
                               AND dc2.chapter_slug = c.slug
                          ))
                        )) AS reportCount,
                    (SELECT COUNT(*) FROM chapter_reactions cr
                      WHERE cr.chapter_id = c.id) AS reactionCount
               FROM chapters c
               JOIN series s ON s.id = c.series_id
               LEFT JOIN users u ON u.id = c.uploader_user_id
              WHERE c.team_id = t.id
              ORDER BY datetime(COALESCE(c.published_at, c.updated_at)) DESC,
                       c.id DESC
              LIMIT 15
           ) recent
         ), '[]') AS activityJson
  FROM teams t
`;

const quickActionSchema = z.object({
  action: z.literal("HIDE_CHAPTER"),
  teamId: z.string().trim().min(3).max(160),
  chapterId: z.string().trim().min(3).max(160),
  expectedRevision: z.coerce.number().int().min(1),
  reason: z.string().trim().min(8).max(500),
});

async function getTeam(id: string) {
  const row = await database()
    .prepare(`${teamSelect} WHERE t.id = ? LIMIT 1`)
    .bind(id)
    .first<TeamRow>();
  if (!row) {
    throw new ApiError(
      404,
      "TEAM_NOT_FOUND",
      "This team no longer exists.",
    );
  }
  return mapTeam(row);
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdmin(actor);
    const db = database();
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    if (id) {
      return json(
        requestId,
        { data: await getTeam(id) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .catch(1)
      .parse(url.searchParams.get("page"));
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .catch(20)
      .parse(url.searchParams.get("limit"));
    const term = `%${query}%`;
    const rows = await db
      .prepare(
        `${teamSelect}
         WHERE (? = '%%' OR LOWER(t.name) LIKE ? OR LOWER(t.slug) LIKE ?)
         ORDER BY t.is_archived, t.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(term, term, term, limit, (page - 1) * limit)
      .all<TeamRow>();
    const count = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM teams
         WHERE (? = '%%' OR LOWER(name) LIKE ? OR LOWER(slug) LIKE ?)`,
      )
      .bind(term, term, term)
      .first<{ count: number }>();
    return json(
      requestId,
      {
        data: rows.results.map(mapTeam),
        pagination: {
          page,
          limit,
          total: Number(count?.count ?? 0),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

async function saveTeam(
  actor: Awaited<ReturnType<typeof requireActor>>,
  requestId: string,
  payload: z.infer<typeof teamSchema>,
) {
  const db = database();
  const id = payload.id ?? `team_${randomId()}`;
  const current = payload.id
    ? await db
        .prepare(
          "SELECT name, revision FROM teams WHERE id = ? LIMIT 1",
        )
        .bind(payload.id)
        .first<{ name: string; revision: number }>()
    : null;
  if (payload.id && !current) {
    throw new ApiError(
      404,
      "TEAM_NOT_FOUND",
      "This team no longer exists.",
    );
  }
  if (current && Number(current.revision) !== payload.revision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed this team. Reload it before saving.",
    );
  }
  const effectConfig = JSON.stringify({
    accentColor: payload.effect.accentColor,
    intensity: payload.effect.intensity,
    motion: payload.effect.motion,
  });
  const mutation = current
    ? db
        .prepare(
          `UPDATE teams
           SET slug = ?, name = ?, description = ?,
               verification_status = ?, is_archived = ?,
               can_control_fixed_reader_pages = ?,
               comment_effect_type = ?, comment_effect_enabled = ?,
               comment_effect_config_json = ?, revision = revision + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND revision = ?`,
        )
        .bind(
          payload.slug,
          payload.name,
          payload.description,
          payload.verificationStatus,
          payload.isArchived ? 1 : 0,
          payload.canControlFixedReaderPages ? 1 : 0,
          payload.effect.type,
          payload.effect.enabled ? 1 : 0,
          effectConfig,
          id,
          payload.revision,
        )
    : db
        .prepare(
          `INSERT INTO teams
           (id, slug, name, description, verification_status, is_archived,
            can_control_fixed_reader_pages,
            comment_effect_type, comment_effect_enabled,
            comment_effect_config_json, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          id,
          payload.slug,
          payload.name,
          payload.description,
          payload.verificationStatus,
          payload.isArchived ? 1 : 0,
          payload.canControlFixedReaderPages ? 1 : 0,
          payload.effect.type,
          payload.effect.enabled ? 1 : 0,
          effectConfig,
        );
  const results = await db.batch([
    mutation,
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: current ? "team.update" : "team.create",
        category: "TEAMS_PERMISSIONS",
        sourceArea: "TEAM_MANAGEMENT",
        targetType: "TEAM",
        targetId: id,
        targetLabel: payload.name,
        oldValue: current,
        newValue: {
          name: payload.name,
          verificationStatus: payload.verificationStatus,
          isArchived: payload.isArchived,
          canControlFixedReaderPages: payload.canControlFixedReaderPages,
          effect: payload.effect,
        },
      },
      "changes() = 1",
    ),
  ]);
  if (!results[0]?.meta.changes) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed this team. Reload it before saving.",
    );
  }
  return getTeam(id);
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = teamSchema.parse(await request.json());
    if (payload.id) {
      throw new ApiError(
        422,
        "TEAM_ID_UNEXPECTED",
        "Use PUT to edit an existing team.",
      );
    }
    return json(
      requestId,
      { data: await saveTeam(actor, requestId, payload) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = teamSchema.parse(await request.json());
    if (!payload.id || !payload.revision) {
      throw new ApiError(
        422,
        "TEAM_VERSION_REQUIRED",
        "Reload this team before saving changes.",
      );
    }
    return json(requestId, {
      data: await saveTeam(actor, requestId, payload),
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = quickActionSchema.parse(await request.json());
    const db = database();
    const chapter = await db
      .prepare(
        `SELECT c.id, c.team_id AS teamId, c.state, c.visibility,
                c.revision, c.series_id AS seriesId,
                c.chapter_number AS chapterNumber, s.title AS seriesTitle
           FROM chapters c
           JOIN series s ON s.id = c.series_id
          WHERE c.id = ? AND c.team_id = ?
          LIMIT 1`,
      )
      .bind(payload.chapterId, payload.teamId)
      .first<{
        id: string;
        teamId: string;
        state: string;
        visibility: string;
        revision: number;
        seriesId: string;
        chapterNumber: string;
        seriesTitle: string;
      }>();
    if (!chapter) {
      throw new ApiError(404, "TEAM_CHAPTER_NOT_FOUND", "This chapter is not assigned to the selected team.");
    }
    if (Number(chapter.revision) !== payload.expectedRevision) {
      throw new ApiError(409, "STALE_VERSION", "This chapter changed. Reload team activity before hiding it.");
    }
    const results = await db.batch([
      db.prepare(
        `UPDATE chapters
            SET state = 'DRAFT', visibility = 'HIDDEN', published_at = NULL,
                revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND team_id = ? AND revision = ?`,
      ).bind(payload.chapterId, payload.teamId, payload.expectedRevision),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: "chapter.hide-to-draft",
          category: "CATALOG_PUBLISHING",
          sourceArea: "TEAM_MANAGEMENT",
          targetType: "CHAPTER",
          targetId: payload.chapterId,
          targetLabel: `${chapter.seriesTitle} chapter ${chapter.chapterNumber}`,
          reason: payload.reason,
          oldValue: { state: chapter.state, visibility: chapter.visibility, revision: chapter.revision },
          newValue: { state: "DRAFT", visibility: "HIDDEN", revision: chapter.revision + 1 },
        },
        "changes() = 1",
      ),
    ]);
    if (!results[0]?.meta.changes) {
      throw new ApiError(409, "STALE_VERSION", "This chapter changed before it could be hidden.");
    }
    return json(requestId, { ok: true, chapterId: payload.chapterId });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
