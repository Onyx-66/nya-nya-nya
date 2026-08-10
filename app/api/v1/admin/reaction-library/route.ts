import { env } from "cloudflare:workers";
import { z } from "zod";
import { slugSchema } from "@/lib/admin-metadata";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const chapterReactionSlots = new Set(["upvote", "laugh", "heart", "surprised", "angry", "sad"]);

const reactionSchema = z.object({
  id: z.string().trim().min(3).max(160).optional(),
  revision: z.coerce.number().int().min(1).optional(),
  slug: slugSchema.max(32),
  name: z.string().trim().min(1).max(80),
  accessibleLabel: z.string().trim().min(2).max(120),
  emojiFallback: z.string().trim().max(16).default(""),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).max(10_000),
  category: z.string().trim().max(80).nullable().default(null),
  usageKind: z.enum(["REACTION", "COMMENT_GIF"]).default("REACTION"),
  availability: z
    .object({
      scope: z.enum(["GLOBAL", "SIGNED_IN", "TEAM"]).default("GLOBAL"),
      teamIds: z.array(z.string().min(3).max(160)).max(30).default([]),
    })
    .default({ scope: "GLOBAL", teamIds: [] }),
}).superRefine((value, context) => {
  if (
    value.availability.scope === "TEAM" &&
    value.availability.teamIds.length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["availability", "teamIds"],
      message: "Choose at least one active team for a team-only reaction.",
    });
  }
});

type ReactionRow = {
  id: string;
  slug: string;
  name: string;
  accessibleLabel: string;
  emojiFallback: string;
  assetKey: string | null;
  contentType: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  isAnimated: number;
  isActive: number;
  isArchived: number;
  displayOrder: number;
  category: string | null;
  usageKind: "REACTION" | "COMMENT_GIF";
  availabilityJson: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Reaction management is temporarily unavailable.",
    );
  }
  return env.DB;
}

function parseAvailability(value: string) {
  try {
    const parsed = JSON.parse(value) as { scope?: unknown; teamIds?: unknown };
    return {
      scope: ["GLOBAL", "SIGNED_IN", "TEAM"].includes(String(parsed.scope))
        ? parsed.scope
        : "GLOBAL",
      teamIds: Array.isArray(parsed.teamIds)
        ? parsed.teamIds.filter((teamId): teamId is string => typeof teamId === "string")
        : [],
    };
  } catch {
    return { scope: "GLOBAL", teamIds: [] };
  }
}

function mapReaction(row: ReactionRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    accessibleLabel: row.accessibleLabel,
    emojiFallback: row.emojiFallback,
    assetUrl: row.assetKey
      ? `/api/v1/reaction-asset?id=${encodeURIComponent(row.id)}&v=${row.revision}`
      : null,
    contentType: row.contentType,
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    byteSize: row.byteSize === null ? null : Number(row.byteSize),
    isAnimated: Boolean(row.isAnimated),
    isActive: Boolean(row.isActive),
    isArchived: Boolean(row.isArchived),
    displayOrder: Number(row.displayOrder),
    category: row.category,
    usageKind: row.usageKind,
    availability: parseAvailability(row.availabilityJson),
    revision: Number(row.revision),
    usageCount: Number(row.usageCount),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const reactionSelect = `
  SELECT cr.id, cr.slug, cr.name,
         cr.accessible_label AS accessibleLabel,
         cr.emoji_fallback AS emojiFallback,
         cr.asset_key AS assetKey, cr.content_type AS contentType,
         cr.width, cr.height, cr.byte_size AS byteSize,
         cr.is_animated AS isAnimated, cr.is_active AS isActive,
         cr.is_archived AS isArchived, cr.display_order AS displayOrder,
         cr.category, cr.usage_kind AS usageKind,
         cr.availability_json AS availabilityJson,
         cr.revision, cr.created_at AS createdAt, cr.updated_at AS updatedAt,
         (
           (SELECT COUNT(*) FROM discussion_reactions dr
             WHERE dr.reaction = cr.slug)
           +
           (SELECT COUNT(*) FROM discussion_comment_gifs dcg
             WHERE dcg.gif_id = cr.id)
           +
           (SELECT COUNT(*) FROM chapter_reactions chr
             WHERE chr.reaction_id = cr.id)
         ) AS usageCount
  FROM custom_reactions cr
`;

async function getReaction(id: string) {
  const row = await database()
    .prepare(`${reactionSelect} WHERE cr.id = ? LIMIT 1`)
    .bind(id)
    .first<ReactionRow>();
  if (!row) {
    throw new ApiError(
      404,
      "REACTION_NOT_FOUND",
      "This reaction no longer exists.",
    );
  }
  return mapReaction(row);
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "comments.moderate.global");
    const db = database();
    const url = new URL(request.url);
    const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
    const state = z
      .enum(["ALL", "ACTIVE", "INACTIVE", "ARCHIVED"])
      .catch("ALL")
      .parse(url.searchParams.get("state"));
    const usageKind = z
      .enum(["ALL", "REACTION", "COMMENT_GIF"])
      .catch("ALL")
      .parse(url.searchParams.get("usageKind"));
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
      .catch(24)
      .parse(url.searchParams.get("limit"));
    const term = `%${query}%`;
    const stateClause =
      state === "ACTIVE"
        ? "AND cr.is_active = 1 AND cr.is_archived = 0"
        : state === "INACTIVE"
          ? "AND cr.is_active = 0 AND cr.is_archived = 0"
          : state === "ARCHIVED"
            ? "AND cr.is_archived = 1"
            : "";
    const usageClause =
      usageKind === "ALL" ? "" : "AND cr.usage_kind = ?";
    const usageBindings = usageKind === "ALL" ? [] : [usageKind];
    const [rows, count] = await Promise.all([
      db
        .prepare(
          `${reactionSelect}
           WHERE (? = '%%' OR LOWER(cr.name) LIKE ? OR cr.slug LIKE ?)
           ${stateClause}
           ${usageClause}
           ORDER BY cr.is_archived, cr.display_order, cr.name COLLATE NOCASE
           LIMIT ? OFFSET ?`,
        )
        .bind(
          term,
          term,
          term,
          ...usageBindings,
          limit,
          (page - 1) * limit,
        )
        .all<ReactionRow>(),
      db
        .prepare(
          `SELECT COUNT(*) AS count
             FROM custom_reactions cr
            WHERE (? = '%%' OR LOWER(cr.name) LIKE ? OR cr.slug LIKE ?)
            ${stateClause}
            ${usageClause}`,
        )
        .bind(term, term, term, ...usageBindings)
        .first<{ count: number }>(),
    ]);
    return json(
      requestId,
      {
        data: rows.results.map(mapReaction),
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

async function saveReaction(
  actor: Awaited<ReturnType<typeof requireActor>>,
  requestId: string,
  payload: z.infer<typeof reactionSchema>,
) {
  const db = database();
  const id = payload.id ?? `reaction_${randomId()}`;
  const current = payload.id
    ? await db
        .prepare(
          `SELECT cr.name, cr.slug, cr.asset_key AS assetKey,
                  cr.is_animated AS isAnimated, cr.usage_kind AS usageKind,
                  cr.is_active AS isActive, cr.display_order AS displayOrder,
                  cr.category, cr.availability_json AS availabilityJson,
                  cr.revision,
                  (
                    (SELECT COUNT(*) FROM discussion_reactions dr
                     WHERE dr.reaction = cr.slug)
                    +
                    (SELECT COUNT(*) FROM chapter_reactions chr
                     WHERE chr.reaction_id = cr.id)
                  ) AS reactionUsageCount,
                  (
                    SELECT COUNT(*) FROM discussion_comment_gifs dcg
                     WHERE dcg.gif_id = cr.id
                  ) AS gifUsageCount
             FROM custom_reactions cr WHERE cr.id = ? LIMIT 1`,
        )
        .bind(payload.id)
        .first<{
          name: string;
          slug: string;
          assetKey: string | null;
          isAnimated: number;
          usageKind: "REACTION" | "COMMENT_GIF";
          isActive: number;
          displayOrder: number;
          category: string;
          availabilityJson: string;
          reactionUsageCount: number;
          gifUsageCount: number;
          revision: number;
        }>()
    : null;
  if (payload.id && !current) {
    throw new ApiError(
      404,
      "REACTION_NOT_FOUND",
      "This reaction no longer exists.",
    );
  }
  if (current && Number(current.revision) !== payload.revision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed this reaction. Reload it before saving.",
    );
  }
  if (current && current.slug !== payload.slug) {
    throw new ApiError(
      409,
      "REACTION_SLUG_IMMUTABLE",
      "A reaction identifier cannot change after creation because historical reactions reference it.",
    );
  }
  if (current && chapterReactionSlots.has(current.slug)) {
    let currentAvailability: { scope?: string; teamIds?: unknown } = {};
    try { currentAvailability = JSON.parse(current.availabilityJson) as { scope?: string; teamIds?: unknown }; } catch { currentAvailability = {}; }
    const normalizedCurrentAvailability = {
      scope: ["GLOBAL", "SIGNED_IN", "TEAM"].includes(String(currentAvailability.scope))
        ? currentAvailability.scope
        : "GLOBAL",
      teamIds: Array.isArray(currentAvailability.teamIds)
        ? currentAvailability.teamIds.filter((teamId): teamId is string => typeof teamId === "string")
        : [],
    };
    if (
      payload.usageKind !== "REACTION" ||
      !payload.isActive ||
      payload.displayOrder !== Number(current.displayOrder) ||
      payload.category !== current.category ||
      JSON.stringify(payload.availability) !== JSON.stringify(normalizedCurrentAvailability)
    ) {
      throw new ApiError(409, "CHAPTER_REACTION_SLOT_PROTECTED", "The six chapter-reaction slots keep their type, visibility, order, and availability. Edit only the label, accessible label, emoji, or asset.");
    }
  }
  if (
    current &&
    current.usageKind !== payload.usageKind &&
    (Number(current.reactionUsageCount) > 0 ||
      Number(current.gifUsageCount) > 0)
  ) {
    throw new ApiError(
      409,
      "REACTION_USAGE_KIND_IMMUTABLE",
      "A reaction or comment GIF type cannot change after readers have used it.",
    );
  }
  if (
    payload.isActive &&
    !payload.emojiFallback.trim() &&
    !current?.assetKey
  ) {
    throw new ApiError(
      422,
      "REACTION_VISUAL_REQUIRED",
      "Add an image or emoji fallback before activating this reaction.",
    );
  }
  if (
    payload.isActive &&
    payload.usageKind === "COMMENT_GIF" &&
    !Boolean(current?.isAnimated)
  ) {
    throw new ApiError(
      422,
      "COMMENT_GIF_ANIMATION_REQUIRED",
      "An active comment GIF must use an animated GIF asset.",
    );
  }
  if (payload.availability.scope === "TEAM") {
    const teamIds = [...new Set(payload.availability.teamIds)];
    const placeholders = teamIds.map(() => "?").join(",");
    const eligible = await db
      .prepare(
        `SELECT id FROM teams
         WHERE id IN (${placeholders})
           AND is_archived = 0
           AND verification_status <> 'SUSPENDED'`,
      )
      .bind(...teamIds)
      .all<{ id: string }>();
    if (eligible.results.length !== teamIds.length) {
      throw new ApiError(
        422,
        "REACTION_TEAM_INVALID",
        "One or more selected teams are unavailable.",
      );
    }
  }
  const availability = JSON.stringify(payload.availability);
  const mutation = current
    ? db
        .prepare(
          `UPDATE custom_reactions
           SET slug = ?, name = ?, accessible_label = ?,
               emoji_fallback = ?, is_active = ?, display_order = ?,
               category = ?, usage_kind = ?, availability_json = ?,
               revision = revision + 1, updated_by_user_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND revision = ?`,
        )
        .bind(
          payload.slug,
          payload.name,
          payload.accessibleLabel,
          payload.emojiFallback,
          payload.isActive ? 1 : 0,
          payload.displayOrder,
          payload.category,
          payload.usageKind,
          availability,
          actor.id,
          id,
          payload.revision,
        )
    : db
        .prepare(
          `INSERT INTO custom_reactions
           (id, slug, name, accessible_label, emoji_fallback, is_active,
            display_order, category, usage_kind, availability_json,
            created_by_user_id,
            updated_by_user_id, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          id,
          payload.slug,
          payload.name,
          payload.accessibleLabel,
          payload.emojiFallback,
          payload.isActive ? 1 : 0,
          payload.displayOrder,
          payload.category,
          payload.usageKind,
          availability,
          actor.id,
          actor.id,
        );
  const results = await db.batch([
    mutation,
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: current ? "reaction.update" : "reaction.create",
        category: "DISCUSSIONS_MODERATION",
        sourceArea: "REACTION_LIBRARY",
        targetType: "REACTION",
        targetId: id,
        targetLabel: payload.name,
        oldValue: current,
        newValue: {
          slug: payload.slug,
          active: payload.isActive,
          order: payload.displayOrder,
          category: payload.category,
          availability: payload.availability,
        },
      },
      "changes() = 1",
    ),
  ]);
  if (!results[0]?.meta.changes) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed this reaction. Reload it before saving.",
    );
  }
  return getReaction(id);
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "comments.moderate.global");
    const payload = reactionSchema.parse(await request.json());
    if (payload.id) {
      throw new ApiError(
        422,
        "REACTION_ID_UNEXPECTED",
        "Use PUT to edit an existing reaction.",
      );
    }
    return json(
      requestId,
      { data: await saveReaction(actor, requestId, payload) },
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
    requireAdminCapability(actor, "comments.moderate.global");
    const payload = reactionSchema.parse(await request.json());
    if (!payload.id || !payload.revision) {
      throw new ApiError(
        422,
        "REACTION_VERSION_REQUIRED",
        "Reload this reaction before saving changes.",
      );
    }
    return json(requestId, {
      data: await saveReaction(actor, requestId, payload),
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "comments.moderate.global");
    const db = database();
    const url = new URL(request.url);
    const id = z.string().min(3).max(160).parse(url.searchParams.get("id"));
    const revision = z.coerce
      .number()
      .int()
      .min(1)
      .parse(url.searchParams.get("revision"));
    const current = await db
      .prepare(
        `SELECT name, slug, asset_key AS assetKey, revision,
                ((SELECT COUNT(*) FROM discussion_reactions
                  WHERE reaction = custom_reactions.slug)
                 + (SELECT COUNT(*) FROM chapter_reactions
                  WHERE reaction_id = custom_reactions.id)) AS usageCount
         FROM custom_reactions WHERE id = ? LIMIT 1`,
      )
      .bind(id)
      .first<{
        name: string;
        slug: string;
        assetKey: string | null;
        revision: number;
        usageCount: number;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "REACTION_NOT_FOUND",
        "This reaction no longer exists.",
      );
    }
    if (Number(current.revision) !== revision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this reaction. Reload it before archiving.",
      );
    }
    if (chapterReactionSlots.has(current.slug)) {
      throw new ApiError(409, "CHAPTER_REACTION_SLOT_PROTECTED", "The six default chapter-reaction slots cannot be archived.");
    }
    const results = await db.batch([
      db
        .prepare(
        `UPDATE custom_reactions
         SET is_active = 0, is_archived = 1, revision = revision + 1,
             updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revision = ?`,
      )
        .bind(actor.id, id, revision),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: "reaction.archive",
          category: "DISCUSSIONS_MODERATION",
          sourceArea: "REACTION_LIBRARY",
          targetType: "REACTION",
          targetId: id,
          targetLabel: current.name,
          metadata: { usageCount: Number(current.usageCount) },
        },
        "changes() = 1",
      ),
    ]);
    if (!results[0]?.meta.changes) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this reaction. Reload it before archiving.",
      );
    }
    return json(requestId, {
      data: { id, archived: true, deleted: false },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
