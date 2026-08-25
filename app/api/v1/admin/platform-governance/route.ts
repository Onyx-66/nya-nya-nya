import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import {
  actorHasCapability,
  requireActor,
  requireAdminCapability,
  type Actor,
} from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import {
  assertFeatureCanEnable,
  FEATURE_KEYS,
  getFeatureStates,
} from "@/lib/server/feature-flags";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("FEATURE_FLAG"),
    key: z.enum(FEATURE_KEYS),
    enabled: z.boolean(),
    expectedUpdatedAt: z.string().min(1).max(80),
    reason: z.string().trim().min(10).max(1_000),
  }),
  z.object({
    action: z.literal("ACHIEVEMENT_SAVE"),
    id: z.string().trim().min(3).max(160).optional(),
    expectedUpdatedAt: z.string().min(1).max(80).optional(),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(100),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1_000),
    rarity: z.enum(["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC", "EXCLUSIVE"]),
    iconKey: z.string().trim().max(120).nullable(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
    reason: z.string().trim().min(10).max(1_000),
  }),
  z.object({
    action: z.enum(["ACHIEVEMENT_ASSIGN", "ACHIEVEMENT_REVOKE"]),
    achievementId: z.string().trim().min(3).max(160),
    email: z.string().trim().email().max(320),
    reason: z.string().trim().min(10).max(1_000),
  }),
  z.object({
    action: z.literal("REVIEW_STATUS"),
    id: z.string().trim().min(3).max(160),
    expectedStatus: z.enum(["VISIBLE", "HIDDEN"]),
    expectedUpdatedAt: z.string().min(1).max(80),
    status: z.enum(["VISIBLE", "HIDDEN"]),
    reason: z.string().trim().min(10).max(1_000),
  }),
  z.object({
    action: z.literal("TEAM_POST_STATUS"),
    id: z.string().trim().min(3).max(160),
    expectedRevision: z.number().int().min(1),
    status: z.enum(["VISIBLE", "HIDDEN"]),
    reason: z.string().trim().min(10).max(1_000),
  }),
  z.object({
    action: z.literal("NOTIFICATION_SEND"),
    clientMutationId: z.string().uuid(),
    email: z.string().trim().email().max(320),
    title: z.string().trim().min(3).max(160),
    body: z.string().trim().min(3).max(2_000),
    actionUrl: z.string().trim().regex(/^\/(?!\/)/u, "Use a relative NyaScans path.").max(500).nullable(),
    reason: z.string().trim().min(10).max(1_000),
  }),
]);

const governanceQuerySchema = z.object({
  area: z.enum(["registry", "achievements", "moderation", "access", "security"]).default("registry"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(10).max(50).default(30),
  q: z.string().trim().max(160).default(""),
});

type GovernanceArea = z.infer<typeof governanceQuerySchema>["area"];

type GovernanceAction = z.infer<typeof actionSchema>;

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Platform governance controls are temporarily unavailable.",
    );
  }
  return env.DB;
}

const capabilityByAction: Record<GovernanceAction["action"], string> = {
  FEATURE_FLAG: "platform.features.manage",
  ACHIEVEMENT_SAVE: "community.achievements.manage",
  ACHIEVEMENT_ASSIGN: "community.achievements.manage",
  ACHIEVEMENT_REVOKE: "community.achievements.manage",
  REVIEW_STATUS: "reviews.moderate.global",
  TEAM_POST_STATUS: "comments.moderate.global",
  NOTIFICATION_SEND: "notifications.manage",
};

async function rows<T>(allowed: boolean, query: string, ...bindings: unknown[]) {
  if (!allowed) return [] as T[];
  const result = await database().prepare(query).bind(...bindings).all<T>();
  return result.results ?? [];
}

function visiblePage<T>(entries: T[], limit: number) {
  return entries.slice(0, limit);
}

async function snapshot(
  actor: Actor,
  area: GovernanceArea,
  page: number,
  limit: number,
  query: string,
) {
  const permissions = {
    features: actorHasCapability(actor, "platform.features.manage"),
    achievements: actorHasCapability(actor, "community.achievements.manage"),
    reviews: actorHasCapability(actor, "reviews.moderate.global"),
    teamPosts: actorHasCapability(actor, "comments.moderate.global"),
    access: actorHasCapability(actor, "commerce.entitlements.read"),
    notifications: actorHasCapability(actor, "notifications.manage"),
    securityRead: actorHasCapability(actor, "security.read"),
  };
  const offset = (page - 1) * limit;
  const fetchLimit = limit + 1;
  const pattern = `%${query}%`;
  const [runtimeFeatures, featureFlagsRaw, achievementsRaw, reviewsRaw, teamPostsRaw, entitlementsRaw, giftCardsRaw, notificationsRaw, passkeysRaw] = await Promise.all([
    getFeatureStates(),
    rows<Record<string, unknown>>(area === "registry",
      `SELECT key, enabled, description, updated_at AS updatedAt
         FROM feature_flags
        WHERE (? = '' OR key LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)
        ORDER BY key`, query, pattern, pattern),
    rows<Record<string, unknown>>(area === "achievements" && permissions.achievements,
      `SELECT a.id, a.slug, a.name, a.description, a.rarity, a.icon_key AS iconKey,
              a.is_active AS isActive, a.sort_order AS sortOrder, a.updated_at AS updatedAt,
              COUNT(ua.user_id) AS awardedCount
         FROM achievement_definitions a
         LEFT JOIN user_achievements ua ON ua.achievement_id = a.id
        WHERE (? = '' OR a.slug LIKE ? COLLATE NOCASE OR a.name LIKE ? COLLATE NOCASE OR a.description LIKE ? COLLATE NOCASE)
        GROUP BY a.id
        ORDER BY a.sort_order, a.name COLLATE NOCASE
        LIMIT ? OFFSET ?`, query, pattern, pattern, pattern, fetchLimit, offset),
    rows<Record<string, unknown>>(area === "moderation" && permissions.reviews,
      `SELECT r.id, r.rating, r.body, r.spoiler, r.moderation_status AS moderationStatus,
              r.created_at AS createdAt, r.updated_at AS updatedAt, u.display_name AS authorName, u.email AS authorEmail,
              s.title AS seriesTitle
         FROM reviews r JOIN users u ON u.id = r.user_id JOIN series s ON s.id = r.series_id
        WHERE (? = '' OR r.body LIKE ? COLLATE NOCASE OR u.display_name LIKE ? COLLATE NOCASE OR u.email LIKE ? COLLATE NOCASE OR s.title LIKE ? COLLATE NOCASE)
        ORDER BY datetime(r.updated_at) DESC LIMIT ? OFFSET ?`, query, pattern, pattern, pattern, pattern, fetchLimit, offset),
    rows<Record<string, unknown>>(area === "moderation" && permissions.teamPosts,
      `SELECT p.id, p.body, p.moderation_status AS moderationStatus, p.revision,
              p.created_at AS createdAt, u.display_name AS authorName, u.email AS authorEmail,
              t.name AS teamName
         FROM team_discussion_posts p JOIN users u ON u.id = p.user_id JOIN teams t ON t.id = p.team_id
        WHERE (? = '' OR p.body LIKE ? COLLATE NOCASE OR u.display_name LIKE ? COLLATE NOCASE OR u.email LIKE ? COLLATE NOCASE OR t.name LIKE ? COLLATE NOCASE)
        ORDER BY datetime(p.updated_at) DESC LIMIT ? OFFSET ?`, query, pattern, pattern, pattern, pattern, fetchLimit, offset),
    rows<Record<string, unknown>>(area === "access" && permissions.access,
      `SELECT e.id, e.source_type AS sourceType, e.source_id AS sourceId,
              e.starts_at AS startsAt, e.expires_at AS expiresAt, e.revoked_at AS revokedAt,
              u.display_name AS userName, u.email, s.title AS seriesTitle,
              c.chapter_number AS chapterNumber
         FROM entitlements e JOIN users u ON u.id = e.user_id
         JOIN chapters c ON c.id = e.chapter_id JOIN series s ON s.id = c.series_id
        WHERE (? = '' OR u.display_name LIKE ? COLLATE NOCASE OR u.email LIKE ? COLLATE NOCASE OR s.title LIKE ? COLLATE NOCASE OR e.source_type LIKE ? COLLATE NOCASE)
        ORDER BY datetime(e.created_at) DESC LIMIT ? OFFSET ?`, query, pattern, pattern, pattern, pattern, fetchLimit, offset),
    rows<Record<string, unknown>>(area === "access" && permissions.access,
      `SELECT g.id, g.code_suffix AS codeSuffix, g.coin_amount AS coinAmount,
              g.recipient_label AS recipientLabel,
              CASE WHEN g.status = 'ACTIVE' AND datetime(g.expires_at) <= CURRENT_TIMESTAMP THEN 'EXPIRED' ELSE g.status END AS status,
              g.expires_at AS expiresAt,
              g.redeemed_at AS redeemedAt, g.created_at AS createdAt,
              purchaser.display_name AS purchaserName, purchaser.email AS purchaserEmail,
              recipient.display_name AS recipientName
         FROM gift_cards g JOIN users purchaser ON purchaser.id = g.purchaser_user_id
         LEFT JOIN users recipient ON recipient.id = g.recipient_user_id
        WHERE (? = '' OR g.code_suffix LIKE ? COLLATE NOCASE OR purchaser.display_name LIKE ? COLLATE NOCASE OR purchaser.email LIKE ? COLLATE NOCASE OR g.recipient_label LIKE ? COLLATE NOCASE)
        ORDER BY datetime(g.created_at) DESC LIMIT ? OFFSET ?`, query, pattern, pattern, pattern, pattern, fetchLimit, offset),
    rows<Record<string, unknown>>(area === "registry" && permissions.notifications,
      `SELECT n.id, n.kind, n.title, n.read_at AS readAt, n.action_url AS actionUrl,
              n.created_at AS createdAt, u.display_name AS userName, u.email
         FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE (? = '' OR n.title LIKE ? COLLATE NOCASE OR u.display_name LIKE ? COLLATE NOCASE OR u.email LIKE ? COLLATE NOCASE)
        ORDER BY datetime(n.created_at) DESC LIMIT ? OFFSET ?`, query, pattern, pattern, pattern, fetchLimit, offset),
    rows<Record<string, unknown>>(area === "security" && permissions.securityRead,
      `SELECT p.id, p.device_name AS deviceName, p.device_type AS deviceType,
              p.backed_up AS backedUp, p.created_at AS createdAt,
              p.last_used_at AS lastUsedAt,
              u.display_name AS userName, u.email
         FROM account_passkeys p JOIN users u ON u.id = p.user_id
        WHERE (? = '' OR p.device_name LIKE ? COLLATE NOCASE OR u.display_name LIKE ? COLLATE NOCASE OR u.email LIKE ? COLLATE NOCASE)
        ORDER BY datetime(p.created_at) DESC LIMIT ? OFFSET ?`, query, pattern, pattern, pattern, fetchLimit, offset),
  ]);
  const hasMore = [achievementsRaw, reviewsRaw, teamPostsRaw, entitlementsRaw, giftCardsRaw, notificationsRaw, passkeysRaw]
    .some((entries) => entries.length > limit);
  return {
    area,
    permissions,
    featureFlags: featureFlagsRaw.map((entry) => {
      const runtime = runtimeFeatures[String(entry.key) as keyof typeof runtimeFeatures];
      return {
        ...entry,
        enabled: Boolean(entry.enabled),
        wired: runtime?.wired ?? false,
        available: runtime?.available ?? false,
        effective: runtime?.effective ?? false,
        readinessReason: runtime?.reason ?? "FEATURE_UNKNOWN",
      };
    }),
    achievements: visiblePage(achievementsRaw, limit).map((entry) => ({ ...entry, isActive: Boolean(entry.isActive) })),
    reviews: visiblePage(reviewsRaw, limit),
    teamPosts: visiblePage(teamPostsRaw, limit),
    entitlements: visiblePage(entitlementsRaw, limit),
    giftCards: visiblePage(giftCardsRaw, limit),
    notifications: visiblePage(notificationsRaw, limit),
    passkeys: visiblePage(passkeysRaw, limit),
    pagination: { page, limit, hasMore },
    generatedAt: new Date().toISOString(),
  };
}

async function userIdForEmail(email: string) {
  const user = await database().prepare(
    "SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND status = 'ACTIVE' LIMIT 1",
  ).bind(email).first<{ id: string }>();
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "No active reader account uses that email address.");
  return user.id;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "platform.operations.read");
    const url = new URL(request.url);
    const query = governanceQuerySchema.parse({
      area: url.searchParams.get("area") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    return json(requestId, { data: await snapshot(actor, query.area, query.page, query.limit, query.q) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = actionSchema.parse(await request.json());
    requireAdminCapability(actor, capabilityByAction[payload.action]);
    const db = database();
    let mutation: D1PreparedStatement;
    let auditTarget: string = payload.action;
    let auditLabel: string | null = null;
    let oldValue: unknown = null;
    let newValue: unknown = payload;
    const followUpStatements: D1PreparedStatement[] = [];

    if (payload.action === "FEATURE_FLAG") {
      const runtimeState = (await getFeatureStates(db))[payload.key];
      if (payload.enabled) {
        await assertFeatureCanEnable(payload.key, db);
      } else if (!runtimeState.wired && !runtimeState.enabled) {
        throw new ApiError(409, "FEATURE_FLAG_NOT_CONNECTED", "This legacy flag is not connected to the runtime and is already disabled.");
      }
      const current = await db.prepare("SELECT enabled, description, updated_at AS updatedAt FROM feature_flags WHERE key = ? LIMIT 1").bind(payload.key).first<Record<string, unknown>>();
      if (!current) throw new ApiError(404, "FEATURE_FLAG_NOT_FOUND", "This feature flag no longer exists.");
      if (Boolean(current.enabled) === payload.enabled) {
        throw new ApiError(409, "FEATURE_FLAG_UNCHANGED", "Choose a different feature-flag state.");
      }
      oldValue = current;
      auditTarget = payload.key;
      auditLabel = payload.key;
      mutation = db.prepare(`UPDATE feature_flags SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ? AND updated_at = ?`).bind(payload.enabled ? 1 : 0, payload.key, payload.expectedUpdatedAt);
    } else if (payload.action === "ACHIEVEMENT_SAVE") {
      const duplicate = await db.prepare("SELECT id FROM achievement_definitions WHERE slug = ? AND id <> ? LIMIT 1").bind(payload.slug, payload.id ?? "").first();
      if (duplicate) throw new ApiError(409, "ACHIEVEMENT_SLUG_EXISTS", "Another achievement already uses that slug.");
      const achievementId = payload.id ?? `achievement_${randomId()}`;
      auditTarget = achievementId;
      auditLabel = payload.name;
      if (payload.id) {
        if (!payload.expectedUpdatedAt) throw new ApiError(422, "ACHIEVEMENT_VERSION_REQUIRED", "Reload this achievement before saving it.");
        oldValue = await db.prepare("SELECT slug, name, description, rarity, icon_key AS iconKey, is_active AS isActive, sort_order AS sortOrder, updated_at AS updatedAt FROM achievement_definitions WHERE id = ? LIMIT 1").bind(payload.id).first();
        mutation = db.prepare(`UPDATE achievement_definitions SET slug = ?, name = ?, description = ?, rarity = ?, icon_key = ?, is_active = ?, sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND updated_at = ?`).bind(payload.slug, payload.name, payload.description, payload.rarity, payload.iconKey || null, payload.isActive ? 1 : 0, payload.sortOrder, payload.id, payload.expectedUpdatedAt);
      } else {
        mutation = db.prepare("INSERT INTO achievement_definitions (id, slug, name, description, rarity, icon_key, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(achievementId, payload.slug, payload.name, payload.description, payload.rarity, payload.iconKey || null, payload.isActive ? 1 : 0, payload.sortOrder);
      }
    } else if (payload.action === "ACHIEVEMENT_ASSIGN" || payload.action === "ACHIEVEMENT_REVOKE") {
      const userId = await userIdForEmail(payload.email);
      const definition = await db.prepare("SELECT name FROM achievement_definitions WHERE id = ? LIMIT 1").bind(payload.achievementId).first<{ name: string }>();
      if (!definition) throw new ApiError(404, "ACHIEVEMENT_NOT_FOUND", "This achievement no longer exists.");
      auditTarget = `${userId}:${payload.achievementId}`;
      auditLabel = `${payload.email} · ${definition.name}`;
      mutation = payload.action === "ACHIEVEMENT_ASSIGN"
        ? db.prepare("INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, metadata_json) VALUES (?, ?, ?)").bind(userId, payload.achievementId, JSON.stringify({ source: "MANUAL" }))
        : db.prepare("DELETE FROM user_achievements WHERE user_id = ? AND achievement_id = ?").bind(userId, payload.achievementId);
    } else if (payload.action === "REVIEW_STATUS") {
      if (payload.status === payload.expectedStatus) {
        throw new ApiError(422, "REVIEW_STATUS_UNCHANGED", "Choose a different moderation status.");
      }
      const current = await db.prepare("SELECT moderation_status AS moderationStatus FROM reviews WHERE id = ? LIMIT 1").bind(payload.id).first<Record<string, unknown>>();
      if (!current) throw new ApiError(404, "REVIEW_NOT_FOUND", "This review no longer exists.");
      oldValue = current;
      auditTarget = payload.id;
      mutation = db.prepare(`UPDATE reviews SET moderation_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND moderation_status = ? AND updated_at = ?`).bind(payload.status, payload.id, payload.expectedStatus, payload.expectedUpdatedAt);
      followUpStatements.push(db.prepare(`UPDATE series
          SET rating_tenths = COALESCE((
            SELECT CAST(ROUND(AVG(rating) * 10) AS INTEGER)
              FROM reviews
             WHERE series_id = (SELECT series_id FROM reviews WHERE id = ?)
               AND moderation_status = 'VISIBLE'
          ), 0), updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT series_id FROM reviews WHERE id = ?) AND changes() = 1` ).bind(payload.id, payload.id));
    } else if (payload.action === "TEAM_POST_STATUS") {
      const current = await db.prepare("SELECT moderation_status AS moderationStatus, revision FROM team_discussion_posts WHERE id = ? LIMIT 1").bind(payload.id).first<Record<string, unknown>>();
      if (!current) throw new ApiError(404, "TEAM_POST_NOT_FOUND", "This team discussion post no longer exists.");
      if (current.moderationStatus === payload.status) {
        throw new ApiError(409, "TEAM_POST_STATUS_UNCHANGED", "Choose a different moderation status.");
      }
      oldValue = current;
      auditTarget = payload.id;
      mutation = db.prepare(`UPDATE team_discussion_posts
          SET moderation_status = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision = ? AND moderation_status IN ('VISIBLE', 'HIDDEN')
          AND (? = 'HIDDEN' OR (
            EXISTS (SELECT 1 FROM teams t WHERE t.id = team_discussion_posts.team_id AND t.verification_status = 'VERIFIED' AND t.is_archived = 0)
            AND (parent_id IS NULL OR EXISTS (SELECT 1 FROM team_discussion_posts parent WHERE parent.id = team_discussion_posts.parent_id AND parent.moderation_status = 'VISIBLE'))
          ))`).bind(payload.status, payload.id, payload.expectedRevision, payload.status);
    } else if (payload.action === "NOTIFICATION_SEND") {
      const userId = await userIdForEmail(payload.email);
      const notificationId = `ntf_${randomId()}`;
      auditTarget = notificationId;
      auditLabel = payload.title;
      newValue = { email: payload.email, title: payload.title, actionUrl: payload.actionUrl, bodyLength: payload.body.length };
      mutation = db.prepare(`INSERT OR IGNORE INTO notifications
          (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
        VALUES (?, ?, 'SYSTEM_ADMIN_NOTICE', ?, ?, ?, ?, '{}')`).bind(
        notificationId,
        userId,
        payload.title,
        payload.body,
        `admin-notice:${actor.id}:${payload.clientMutationId}`,
        payload.actionUrl,
      );
    } else {
      throw new ApiError(422, "GOVERNANCE_ACTION_INVALID", "This governance action is not supported.");
    }

    const reason = "reason" in payload ? payload.reason : null;
    const results = await db.batch([
      mutation,
      auditStatement(db, actor, requestId, {
        action: `platform.${payload.action.toLowerCase()}`,
        category: payload.action === "REVIEW_STATUS" || payload.action === "TEAM_POST_STATUS"
            ? "DISCUSSIONS_MODERATION"
            : payload.action.startsWith("ACHIEVEMENT")
              ? "USERS_ROLES"
              : payload.action === "FEATURE_FLAG" || payload.action === "NOTIFICATION_SEND"
                ? "SYSTEM_MAINTENANCE"
                : "COMMERCE_STORE",
        sourceArea: "PLATFORM_GOVERNANCE",
        targetType: ({
          FEATURE_FLAG: "FEATURE_FLAG",
          ACHIEVEMENT_SAVE: "ACHIEVEMENT",
          ACHIEVEMENT_ASSIGN: "ACHIEVEMENT_AWARD",
          ACHIEVEMENT_REVOKE: "ACHIEVEMENT_AWARD",
          REVIEW_STATUS: "REVIEW",
          TEAM_POST_STATUS: "TEAM_DISCUSSION_POST",
          NOTIFICATION_SEND: "NOTIFICATION",
        } as const)[payload.action],
        targetId: auditTarget,
        targetLabel: auditLabel,
        reason,
        oldValue,
        newValue,
      }, "changes() = 1"),
      ...followUpStatements,
    ]);
    if (payload.action === "NOTIFICATION_SEND" && !results[0]?.meta.changes) {
      const existing = await db.prepare("SELECT id FROM notifications WHERE dedupe_key = ? LIMIT 1")
        .bind(`admin-notice:${actor.id}:${payload.clientMutationId}`)
        .first();
      if (existing) return json(requestId, { ok: true, idempotent: true });
    }
    if (!results[0]?.meta.changes) {
      throw new ApiError(409, "STALE_VERSION", "This record changed or the requested action was already applied. Reload before trying again.");
    }
    return json(requestId, { ok: true });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
