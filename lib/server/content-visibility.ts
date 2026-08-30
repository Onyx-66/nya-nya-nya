import type { D1Database } from "@cloudflare/workers-types";
import { ApiError } from "@/lib/server/api";
import { auditStatement } from "@/lib/server/admin-utils";
import { getFeatureStates } from "@/lib/server/feature-flags";
import type { Actor } from "@/lib/server/policy";
import { effectiveChapterAccessSql } from "@/lib/server/public-content-visibility";
import { syncLastPaidForSeries } from "@/lib/server/series-paid-policies";

export type ContentVisibilityQuery = {
  q: string;
  access: "ALL" | "FREE" | "PAID" | "PREMIUM";
  page: number;
  limit: number;
};

function escapeLike(value: string) {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function escapedSql(value: string) {
  return value.replaceAll("'", "''");
}

async function requireVisibilityEnabled(db: D1Database) {
  const states = await getFeatureStates(db);
  if (
    !states.premium_unlocks.effective ||
    !states.payments.effective
  ) {
    throw new ApiError(
      404,
      "CONTENT_VISIBILITY_DISABLED",
      "Content Visibility is hidden while paid chapter access is disabled.",
    );
  }
  return states;
}

const effectiveAccessSql = effectiveChapterAccessSql(
  "c",
  "visibility_override",
);

export async function listContentVisibility(
  db: D1Database,
  query: ContentVisibilityQuery,
) {
  const states = await getFeatureStates(db);
  const offset = (query.page - 1) * query.limit;
  const search = escapeLike(query.q.trim());
  const accessClause =
    query.access === "ALL"
      ? "1 = 1"
      : `${effectiveAccessSql} = ?`;
  const accessBindings = query.access === "ALL" ? [] : [query.access];
  const where = `
    (? = '' OR s.title LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR c.chapter_number LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR c.title LIKE ? ESCAPE '\\' COLLATE NOCASE)
    AND ${accessClause}`;
  const bindings = [query.q.trim(), search, search, search, ...accessBindings];
  const [settings, summary, count, rows] = await Promise.all([
    db.prepare(
      `SELECT mode,
              default_access_type AS defaultAccessType,
              default_price_onyx AS defaultPriceOnyx,
              auto_free_after_days AS autoFreeAfterDays,
              revision, updated_at AS updatedAt
         FROM content_visibility_settings WHERE id = 'active' LIMIT 1`,
    ).first<{
      mode: "NORMAL" | "LAST_PAID";
      defaultAccessType: "FREE" | "PAID";
      defaultPriceOnyx: number;
      autoFreeAfterDays: number | null;
      revision: number;
      updatedAt: string;
    }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT c.series_id) AS series,
              COUNT(*) AS chapters,
              SUM(CASE WHEN ${effectiveAccessSql} = 'FREE' THEN 1 ELSE 0 END) AS free,
              SUM(CASE WHEN ${effectiveAccessSql} = 'PAID' THEN 1 ELSE 0 END) AS paid,
              SUM(CASE WHEN ${effectiveAccessSql} = 'PREMIUM' THEN 1 ELSE 0 END) AS premium,
              SUM(CASE WHEN c.access_type = 'PAID' AND c.free_at IS NOT NULL
                        AND datetime(c.free_at) > datetime('now')
                        AND COALESCE(visibility_override.auto_free_exempt, 0) = 0
                       THEN 1 ELSE 0 END) AS scheduled
         FROM chapters c
         LEFT JOIN content_visibility_overrides visibility_override
           ON visibility_override.chapter_id = c.id`,
    ).first<Record<string, number>>(),
    db.prepare(
      `SELECT COUNT(*) AS count
         FROM chapters c
         JOIN series s ON s.id = c.series_id
         LEFT JOIN content_visibility_overrides visibility_override
           ON visibility_override.chapter_id = c.id
        WHERE ${where}`,
    )
      .bind(...bindings)
      .first<{ count: number }>(),
    db.prepare(
      `SELECT c.id, c.series_id AS seriesId, s.slug AS seriesSlug,
              s.title AS seriesTitle, c.chapter_number AS chapterNumber,
              c.title, c.state, c.published_at AS publishedAt,
              COALESCE(visibility_override.access_type, c.access_type) AS accessType,
              ${effectiveAccessSql} AS effectiveAccessType,
              CASE WHEN ${effectiveAccessSql} = 'FREE' THEN 0 ELSE c.price_onyx END AS priceOnyx,
              c.free_at AS freeAt,
              COALESCE(visibility_override.auto_free_exempt, 0) AS autoFreeExempt,
              visibility_override.revision AS overrideRevision,
              c.revision
         FROM chapters c
         JOIN series s ON s.id = c.series_id
         LEFT JOIN content_visibility_overrides visibility_override
           ON visibility_override.chapter_id = c.id
        WHERE ${where}
        ORDER BY s.title COLLATE NOCASE,
                 CAST(c.chapter_number AS REAL) DESC,
                 c.version DESC, c.id DESC
        LIMIT ? OFFSET ?`,
    )
      .bind(...bindings, query.limit, offset)
      .all<Record<string, unknown>>(),
  ]);
  if (!settings) {
    throw new ApiError(503, "CONTENT_VISIBILITY_NOT_INITIALIZED", "Content Visibility settings are unavailable.");
  }
  const total = Number(count?.count ?? 0);
  return {
    data: {
      readiness: {
        enabled: true,
        reason: null,
        paymentsReady: states.payments.effective,
      },
      rules: {
        ...settings,
        mode: settings.mode === "LAST_PAID" ? "LAST_PAID" : "NORMAL",
        defaultPriceOnyx: Number(settings.defaultPriceOnyx),
        autoFreeAfterDays:
          settings.autoFreeAfterDays == null ? null : Number(settings.autoFreeAfterDays),
        revision: Number(settings.revision),
      },
      summary: {
        series: Number(summary?.series ?? 0),
        chapters: Number(summary?.chapters ?? 0),
        free: Number(summary?.free ?? 0),
        paid: Number(summary?.paid ?? 0),
        premium: Number(summary?.premium ?? 0),
        scheduled: Number(summary?.scheduled ?? 0),
      },
      items: rows.results.map((row) => ({
        ...row,
        autoFreeExempt: Boolean(row.autoFreeExempt),
        overrideRevision:
          row.overrideRevision == null ? null : Number(row.overrideRevision),
        chapterAccessUrl: "/onyx/admin/access/chapters",
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    },
  };
}

export async function saveContentVisibilityDefaults(
  db: D1Database,
  actor: Actor,
  requestId: string,
  input: {
    expectedRevision: number;
    mode: "NORMAL" | "LAST_PAID";
    defaultAccessType: "FREE" | "PAID";
    defaultPriceOnyx: number;
    autoFreeAfterDays: number | null;
  },
) {
  const nextRevision = input.expectedRevision + 1;
  const schedule = input.autoFreeAfterDays == null
    ? db.prepare("SELECT 1 WHERE changes() = 1")
    : db.prepare(
        `UPDATE chapters
            SET free_at = CASE
              WHEN state = 'PUBLISHED' AND published_at IS NOT NULL
                THEN datetime(published_at, '+' || ? || ' days')
              ELSE NULL END,
                updated_at = updated_at
          WHERE changes() = 1
            AND access_type = 'PAID'
            AND free_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM content_visibility_overrides visibility_override
               WHERE visibility_override.chapter_id = chapters.id
                 AND visibility_override.auto_free_exempt = 1
            )`,
      ).bind(input.autoFreeAfterDays);
  const results = await db.batch([
    db.prepare(
      `UPDATE content_visibility_settings
          SET mode = ?, default_access_type = ?, default_price_onyx = ?,
              auto_free_after_days = ?, revision = revision + 1,
              updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = 'active' AND revision = ?`,
    ).bind(
      input.mode,
      input.defaultAccessType,
      input.defaultPriceOnyx,
      input.autoFreeAfterDays,
      actor.id,
      input.expectedRevision,
    ),
    schedule,
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "content.visibility.defaults.update",
        category: "COMMERCE_STORE",
        sourceArea: "CONTENT_VISIBILITY",
        targetType: "CONTENT_VISIBILITY_SETTINGS",
        targetId: "active",
        oldValue: { revision: input.expectedRevision },
        newValue: input,
      },
      `EXISTS (SELECT 1 FROM content_visibility_settings WHERE id = 'active' AND revision = ${nextRevision})`,
    ),
  ]);
  if (!results[0]?.meta.changes) {
    throw new ApiError(409, "CONTENT_VISIBILITY_STALE", "Content Visibility rules changed. Reload and retry.");
  }
  if (input.mode === "LAST_PAID") {
    const seriesRows = await db.prepare("SELECT id FROM series WHERE archived_at IS NULL").all<{ id: string }>();
    for (const row of seriesRows.results) await syncLastPaidForSeries(db, row.id, input.autoFreeAfterDays ?? 7);
  }
  return { ok: true, revision: nextRevision };
}

export async function setContentVisibilityOverride(
  db: D1Database,
  actor: Actor,
  requestId: string,
  input: {
    chapterId: string;
    expectedChapterRevision: number;
    accessType: "FREE" | "PAID" | "PREMIUM";
    priceOnyx: number;
    autoFreeExempt: boolean;
    reason: string;
  },
) {
  const states = await getFeatureStates(db);
  if (input.accessType === "PREMIUM" && !states.memberships.effective) {
    throw new ApiError(
      409,
      "MEMBERSHIPS_DISABLED",
      "Premium-only access requires the memberships feature to be active.",
    );
  }
  const nextRevision = input.expectedChapterRevision + 1;
  const chapterIdSql = escapedSql(input.chapterId);
  const results = await db.batch([
    db.prepare(
      `UPDATE chapters
          SET access_type = ?, price_onyx = ?, free_at = NULL,
              revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision = ?`,
    ).bind(
      input.accessType === "FREE" ? "FREE" : "PAID",
      input.accessType === "PAID" ? input.priceOnyx : 0,
      input.chapterId,
      input.expectedChapterRevision,
    ),
    db.prepare(
      `INSERT INTO content_visibility_overrides
       (chapter_id, access_type, price_onyx, auto_free_exempt, reason,
        revision, updated_by_user_id)
       SELECT ?, ?, ?, ?, ?, 1, ?
        WHERE changes() = 1
          AND EXISTS (SELECT 1 FROM chapters WHERE id = ? AND revision = ?)
       ON CONFLICT(chapter_id) DO UPDATE SET
         access_type = excluded.access_type,
         price_onyx = excluded.price_onyx,
         auto_free_exempt = excluded.auto_free_exempt,
         reason = excluded.reason,
         revision = content_visibility_overrides.revision + 1,
         updated_by_user_id = excluded.updated_by_user_id,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      input.chapterId,
      input.accessType,
      input.accessType === "PAID" ? input.priceOnyx : 0,
      input.autoFreeExempt ? 1 : 0,
      input.reason,
      actor.id,
      input.chapterId,
      nextRevision,
    ),
    db.prepare(
      `UPDATE chapters
          SET free_at = CASE
            WHEN access_type = 'PAID' AND state = 'PUBLISHED'
             AND published_at IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM content_visibility_settings settings
                WHERE settings.id = 'active'
                  AND settings.auto_free_after_days IS NOT NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM content_visibility_overrides visibility_override
                WHERE visibility_override.chapter_id = chapters.id
                  AND visibility_override.auto_free_exempt = 1
             )
            THEN datetime(
              published_at,
              '+' || (SELECT auto_free_after_days
                         FROM content_visibility_settings WHERE id = 'active') || ' days'
            )
            ELSE NULL END
        WHERE changes() = 1 AND id = ? AND revision = ?`,
    ).bind(input.chapterId, nextRevision),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "content.visibility.override.set",
        category: "COMMERCE_STORE",
        sourceArea: "CONTENT_VISIBILITY",
        targetType: "CHAPTER",
        targetId: input.chapterId,
        reason: input.reason,
        oldValue: { revision: input.expectedChapterRevision },
        newValue: input,
      },
      `changes() = 1 AND EXISTS (SELECT 1 FROM chapters WHERE id = '${chapterIdSql}' AND revision = ${nextRevision})`,
    ),
  ]);
  if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
    throw new ApiError(409, "CONTENT_VISIBILITY_STALE", "This chapter changed. Reload and retry.");
  }
  return { ok: true, chapterId: input.chapterId, revision: nextRevision };
}

export async function clearContentVisibilityOverride(
  db: D1Database,
  actor: Actor,
  requestId: string,
  input: {
    chapterId: string;
    expectedChapterRevision: number;
    expectedOverrideRevision: number;
    reason: string;
  },
) {
  const nextRevision = input.expectedChapterRevision + 1;
  const chapterIdSql = escapedSql(input.chapterId);
  const results = await db.batch([
    db.prepare(
      `DELETE FROM content_visibility_overrides
        WHERE chapter_id = ? AND revision = ?`,
    ).bind(input.chapterId, input.expectedOverrideRevision),
    db.prepare(
      `UPDATE chapters
          SET access_type = (
                SELECT settings.default_access_type
                  FROM content_visibility_settings settings
                 WHERE settings.id = 'active'
              ),
              price_onyx = CASE
                WHEN (SELECT settings.default_access_type
                        FROM content_visibility_settings settings
                       WHERE settings.id = 'active') = 'PAID'
                THEN (SELECT settings.default_price_onyx
                        FROM content_visibility_settings settings
                       WHERE settings.id = 'active')
                ELSE 0
              END,
              revision = revision + 1,
              free_at = CASE
                WHEN (SELECT settings.default_access_type
                        FROM content_visibility_settings settings
                       WHERE settings.id = 'active') = 'PAID'
                 AND state = 'PUBLISHED'
                 AND published_at IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM content_visibility_settings settings
                    WHERE settings.id = 'active'
                      AND settings.auto_free_after_days IS NOT NULL
                 )
                THEN datetime(
                  published_at,
                  '+' || (SELECT auto_free_after_days
                             FROM content_visibility_settings WHERE id = 'active') || ' days'
                )
                ELSE NULL END,
              updated_at = CURRENT_TIMESTAMP
        WHERE changes() = 1 AND id = ? AND revision = ?
          AND NOT EXISTS (
            SELECT 1 FROM content_visibility_overrides visibility_override
             WHERE visibility_override.chapter_id = chapters.id
          )`,
    ).bind(input.chapterId, input.expectedChapterRevision),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "content.visibility.override.clear",
        category: "COMMERCE_STORE",
        sourceArea: "CONTENT_VISIBILITY",
        targetType: "CHAPTER",
        targetId: input.chapterId,
        reason: input.reason,
        oldValue: { overrideRevision: input.expectedOverrideRevision },
        newValue: { inherited: true, revision: nextRevision },
      },
      `changes() = 1 AND EXISTS (SELECT 1 FROM chapters WHERE id = '${chapterIdSql}' AND revision = ${nextRevision})`,
    ),
  ]);
  if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
    throw new ApiError(409, "CONTENT_VISIBILITY_STALE", "This override changed. Reload and retry.");
  }
  return { ok: true, chapterId: input.chapterId, revision: nextRevision };
}
