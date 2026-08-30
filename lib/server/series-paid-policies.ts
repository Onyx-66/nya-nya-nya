import { ApiError } from "@/lib/server/api";
import { auditStatement } from "@/lib/server/admin-utils";
import type { Actor } from "@/lib/server/policy";

export type SeriesPaidPolicyInput = {
  seriesId: string;
  paidChapterCount: number;
  priceOnyx: number;
  autoFreeAfterDays: number | null;
  expectedRevision?: number;
};

export async function listSeriesPaidPolicies(db: D1Database, query = "") {
  const like = `%${query.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const rows = await db.prepare(`
    SELECT s.id AS seriesId, s.title AS seriesTitle,
           COUNT(CASE WHEN c.state IN ('READY_FOR_REVIEW','PUBLISHED') THEN 1 END) AS chapterCount,
           COALESCE(p.paid_chapter_count, 0) AS paidChapterCount,
           COALESCE(p.price_onyx, 50) AS priceOnyx,
           p.auto_free_after_days AS autoFreeAfterDays,
           COALESCE(p.revision, 0) AS revision
      FROM series s
      LEFT JOIN chapters c ON c.series_id = s.id
      LEFT JOIN series_paid_policies p ON p.series_id = s.id
     WHERE s.title LIKE ? ESCAPE '\\' COLLATE NOCASE
     GROUP BY s.id, s.title, p.paid_chapter_count, p.price_onyx, p.auto_free_after_days, p.revision
     ORDER BY s.title COLLATE NOCASE
     LIMIT 100
  `).bind(like).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    seriesId: String(row.seriesId),
    seriesTitle: String(row.seriesTitle),
    chapterCount: Number(row.chapterCount ?? 0),
    paidChapterCount: Number(row.paidChapterCount ?? 0),
    priceOnyx: Number(row.priceOnyx ?? 50),
    autoFreeAfterDays: row.autoFreeAfterDays == null ? null : Number(row.autoFreeAfterDays),
    revision: Number(row.revision ?? 0),
  }));
}

export async function saveSeriesPaidPolicy(db: D1Database, actor: Actor, requestId: string, input: SeriesPaidPolicyInput) {
  if (!Number.isInteger(input.paidChapterCount) || input.paidChapterCount < 0 || input.paidChapterCount > 1000) {
    throw new ApiError(422, "PAID_CHAPTER_COUNT_INVALID", "Paid chapter count must be between 0 and 1000.");
  }
  if (!Number.isInteger(input.priceOnyx) || input.priceOnyx < 1 || input.priceOnyx > 1_000_000) {
    throw new ApiError(422, "PAID_CHAPTER_PRICE_INVALID", "Paid chapter price must be at least 1 Paw.");
  }
  if (input.autoFreeAfterDays !== null && (!Number.isInteger(input.autoFreeAfterDays) || input.autoFreeAfterDays < 1 || input.autoFreeAfterDays > 3650)) {
    throw new ApiError(422, "AUTO_FREE_PERIOD_INVALID", "Auto-Free must be between 1 and 3650 days.");
  }
  const current = await db.prepare("SELECT revision FROM series_paid_policies WHERE series_id = ?").bind(input.seriesId).first<{ revision: number }>();
  if (input.expectedRevision != null && Number(current?.revision ?? 0) !== input.expectedRevision) {
    throw new ApiError(409, "SERIES_PAID_POLICY_STALE", "This series paid policy changed. Reload and retry.");
  }
  const nextRevision = Number(current?.revision ?? 0) + 1;
  const statements = [
    db.prepare(`INSERT INTO series_paid_policies (series_id, paid_chapter_count, price_onyx, auto_free_after_days, revision, updated_by_user_id)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(series_id) DO UPDATE SET paid_chapter_count=excluded.paid_chapter_count, price_onyx=excluded.price_onyx,
                  auto_free_after_days=excluded.auto_free_after_days, revision=excluded.revision, updated_by_user_id=excluded.updated_by_user_id, updated_at=CURRENT_TIMESTAMP`)
      .bind(input.seriesId, input.paidChapterCount, input.priceOnyx, input.autoFreeAfterDays, nextRevision, actor.id),
    auditStatement(db, actor, requestId, {
      action: "content.visibility.series_policy.update", category: "COMMERCE_STORE", sourceArea: "CONTENT_VISIBILITY",
      targetType: "SERIES", targetId: input.seriesId, newValue: input,
    }),
  ];
  const results = await db.batch(statements);
  if (!results[0]?.meta.changes) throw new ApiError(409, "SERIES_PAID_POLICY_STALE", "This series paid policy could not be saved.");
  return { ok: true, revision: nextRevision };
}

export async function syncLastPaidForSeries(db: D1Database, seriesId: string, defaultAutoFreeDays: number | null) {
  await db.prepare(`
    UPDATE chapters
       SET access_type = CASE WHEN id IN (
             SELECT id FROM (
               SELECT c.id, ROW_NUMBER() OVER (ORDER BY CAST(c.chapter_number AS REAL) DESC, datetime(COALESCE(c.published_at, c.created_at)) DESC, c.id DESC) AS rn
                 FROM chapters c
                WHERE c.series_id = ? AND c.state IN ('READY_FOR_REVIEW','PUBLISHED')
                  AND NOT EXISTS (SELECT 1 FROM content_visibility_overrides o WHERE o.chapter_id = c.id)
             ) ranked
             WHERE ranked.rn <= COALESCE((SELECT NULLIF(paid_chapter_count, 0) FROM series_paid_policies WHERE series_id = ?), 1)
           ) THEN 'PAID' ELSE 'FREE' END,
           price_onyx = CASE WHEN id IN (
             SELECT id FROM (
               SELECT c.id, ROW_NUMBER() OVER (ORDER BY CAST(c.chapter_number AS REAL) DESC, datetime(COALESCE(c.published_at, c.created_at)) DESC, c.id DESC) AS rn
                 FROM chapters c
                WHERE c.series_id = ? AND c.state IN ('READY_FOR_REVIEW','PUBLISHED')
                  AND NOT EXISTS (SELECT 1 FROM content_visibility_overrides o WHERE o.chapter_id = c.id)
             ) ranked
             WHERE ranked.rn <= COALESCE((SELECT NULLIF(paid_chapter_count, 0) FROM series_paid_policies WHERE series_id = ?), 1)
           ) THEN COALESCE((SELECT price_onyx FROM series_paid_policies WHERE series_id = ?), 50) ELSE 0 END,
           free_at = CASE WHEN access_type = 'PAID' AND state = 'PUBLISHED' AND published_at IS NOT NULL
             THEN datetime(published_at, '+' || COALESCE((SELECT auto_free_after_days FROM series_paid_policies WHERE series_id = ?), ?) || ' days') ELSE NULL END,
           revision = revision + 1, updated_at = CURRENT_TIMESTAMP
     WHERE series_id = ? AND state IN ('READY_FOR_REVIEW','PUBLISHED')
       AND NOT EXISTS (SELECT 1 FROM content_visibility_overrides o WHERE o.chapter_id = chapters.id)
  `).bind(seriesId, seriesId, seriesId, seriesId, seriesId, seriesId, defaultAutoFreeDays ?? 7, seriesId).run();
}
