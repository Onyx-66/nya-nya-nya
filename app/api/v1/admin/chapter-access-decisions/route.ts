import { env } from "cloudflare:workers";
import { z } from "zod";
import { normalizeChapterNumber } from "@/lib/chapter-number";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requireActor, requireAdminConsole } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["ALL", "PENDING", "RESOLVED"]).default("PENDING"),
  decision: z.string().trim().max(180).default(""),
});

const resolveSchema = z.object({
  decisionId: z.string().trim().min(3).max(180),
  expectedRevision: z.number().int().min(1),
  action: z.enum(["KEEP_PAID", "MAKE_REFERENCE_FREE"]),
  note: z.string().trim().max(1_000).default(""),
});

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Chapter access decisions are temporarily unavailable.",
    );
  }
  return env.DB;
}

async function requireManagerPlus() {
  const actor = await requireActor();
  requireAdminConsole(actor);
  return actor;
}

async function readDecisions(
  status: "ALL" | "PENDING" | "RESOLVED",
  decisionId = "",
) {
  const statusSql =
    status === "PENDING"
      ? "AND d.status = 'PENDING'"
      : status === "RESOLVED"
        ? "AND d.status <> 'PENDING'"
        : "";
  const idSql = decisionId ? "AND d.id = ?" : "";
  const bindings = decisionId ? [decisionId] : [];
  const rows = await database()
    .prepare(
      `SELECT d.id, d.upload_job_id AS uploadJobId,
              d.upload_job_item_id AS uploadJobItemId,
              d.chapter_id AS chapterId,
              d.reference_chapter_id AS referenceChapterId,
              d.reference_chapter_number AS referenceChapterNumber,
              d.reason, d.requested_access_type AS requestedAccessType,
              d.forced_price_onyx AS forcedPriceOnyx, d.status,
              d.resolution_note AS resolutionNote, d.revision,
              d.resolved_at AS resolvedAt, d.created_at AS createdAt,
              d.updated_at AS updatedAt,
              s.id AS seriesId, s.slug AS seriesSlug, s.title AS seriesTitle,
              trigger_chapter.chapter_number AS chapterNumber,
              trigger_chapter.language AS chapterLanguage,
              trigger_team.name AS teamName,
              uploader.display_name AS uploaderName,
              reference_chapter.language AS referenceLanguage,
              reference_team.name AS referenceTeamName,
              resolver.display_name AS resolvedByName
         FROM chapter_access_decisions d
         JOIN series s ON s.id = d.series_id
         JOIN chapters trigger_chapter ON trigger_chapter.id = d.chapter_id
         LEFT JOIN teams trigger_team ON trigger_team.id = trigger_chapter.team_id
         LEFT JOIN users uploader ON uploader.id = trigger_chapter.uploader_user_id
         LEFT JOIN chapters reference_chapter
           ON reference_chapter.id = d.reference_chapter_id
         LEFT JOIN teams reference_team ON reference_team.id = reference_chapter.team_id
         LEFT JOIN users resolver ON resolver.id = d.resolved_by_user_id
        WHERE 1 = 1
          ${statusSql}
          ${idSql}
        ORDER BY CASE d.status WHEN 'PENDING' THEN 0 ELSE 1 END,
                 datetime(d.created_at) DESC
        LIMIT 100`,
    )
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return rows.results;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    await requireManagerPlus();
    const url = new URL(request.url);
    const query = querySchema.parse({
      status: url.searchParams.get("status") || "PENDING",
      decision: url.searchParams.get("decision") || "",
    });
    const data = await readDecisions(query.status, query.decision);
    return json(
      requestId,
      {
        data,
        summary: {
          pending: data.filter((entry) => entry.status === "PENDING").length,
          returned: data.length,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireManagerPlus();
    const input = resolveSchema.parse(await request.json());
    const db = database();
    const current = await db
      .prepare(
        `SELECT d.id, d.chapter_id AS chapterId, d.series_id AS seriesId,
                d.reference_chapter_number AS referenceChapterNumber,
                d.status, d.revision, d.forced_price_onyx AS forcedPriceOnyx,
                s.slug AS seriesSlug, s.title AS seriesTitle,
                trigger_chapter.chapter_number AS chapterNumber,
                trigger_chapter.uploader_user_id AS uploaderUserId
           FROM chapter_access_decisions d
           JOIN series s ON s.id = d.series_id
           JOIN chapters trigger_chapter ON trigger_chapter.id = d.chapter_id
          WHERE d.id = ?
          LIMIT 1`,
      )
      .bind(input.decisionId)
      .first<{
        id: string;
        chapterId: string;
        seriesId: string;
        referenceChapterNumber: string;
        status: string;
        revision: number;
        forcedPriceOnyx: number;
        seriesTitle: string;
        seriesSlug: string;
        chapterNumber: string;
        uploaderUserId: string | null;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "ACCESS_DECISION_NOT_FOUND",
        "This chapter access decision was not found.",
      );
    }
    if (
      current.status !== "PENDING" ||
      current.revision !== input.expectedRevision
    ) {
      throw new ApiError(
        409,
        "ACCESS_DECISION_CHANGED",
        "This decision was already resolved or changed. Reload the queue.",
      );
    }
    const nextStatus =
      input.action === "KEEP_PAID" ? "KEPT_PAID" : "MADE_FREE";
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE chapter_access_decisions
              SET status = ?, resolved_by_user_id = ?, resolution_note = ?,
                  resolved_at = CURRENT_TIMESTAMP,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revision = ? AND status = 'PENDING'`,
        )
        .bind(
          nextStatus,
          actor.id,
          input.note,
          input.decisionId,
          input.expectedRevision,
        ),
    ];

    if (input.action === "MAKE_REFERENCE_FREE") {
      const candidates = await db
        .prepare(
          `SELECT id, chapter_number AS chapterNumber
             FROM chapters
            WHERE series_id = ?
              AND id <> ?
              AND state IN ('READY_FOR_REVIEW', 'PUBLISHED')`,
        )
        .bind(current.seriesId, current.chapterId)
        .all<{ id: string; chapterNumber: string }>();
      const referenceIds = candidates.results
        .filter(
          (chapter) =>
            normalizeChapterNumber(chapter.chapterNumber) ===
            normalizeChapterNumber(current.referenceChapterNumber),
        )
        .map((chapter) => chapter.id);
      for (const chapterId of referenceIds) {
        statements.push(
          db
            .prepare(
              `UPDATE chapters
                  SET access_type = 'FREE', price_onyx = 0,
                      free_at = CASE
                        WHEN state = 'PUBLISHED' THEN CURRENT_TIMESTAMP
                        ELSE free_at
                      END,
                      revision = revision + 1,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND access_type = 'PAID'
                  AND EXISTS (
                    SELECT 1 FROM chapter_access_decisions resolved
                     WHERE resolved.id = ?
                       AND resolved.status = 'MADE_FREE'
                       AND resolved.resolved_by_user_id = ?
                  )`,
            )
            .bind(chapterId, input.decisionId, actor.id),
        );
      }
    }

    statements.push(
      db
        .prepare(
          `UPDATE notifications
              SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
            WHERE dedupe_key = ?
              AND EXISTS (
                SELECT 1 FROM chapter_access_decisions resolved
                 WHERE resolved.id = ?
                   AND resolved.status <> 'PENDING'
              )`,
        )
        .bind(
          `CHAPTER_ACCESS_DECISION:${input.decisionId}`,
          input.decisionId,
        ),
      db
        .prepare(
          `INSERT INTO notifications
           (id, user_id, kind, title, body, dedupe_key, action_url,
            metadata_json)
           SELECT ?, ?, 'CHAPTER_ACCESS_RESOLVED',
                  'Chapter access decision resolved', ?, ?, ?, ?
            WHERE ? IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM chapter_access_decisions resolved
                 WHERE resolved.id = ?
                   AND resolved.status = ?
              )
              AND NOT EXISTS (
                SELECT 1 FROM notifications existing
                 WHERE existing.user_id = ? AND existing.dedupe_key = ?
              )`,
        )
        .bind(
          `ntf_${randomId()}`,
          current.uploaderUserId,
          input.action === "KEEP_PAID"
            ? `${current.seriesTitle} chapter ${current.chapterNumber} remains Paid at ${current.forcedPriceOnyx} paws. The reference chapter stays Paid.`
            : `${current.seriesTitle} chapter ${current.chapterNumber} remains Paid at ${current.forcedPriceOnyx} paws. The reference chapter is now Free.`,
          `CHAPTER_ACCESS_RESOLVED:${input.decisionId}`,
          `/title/${encodeURIComponent(current.seriesSlug)}`,
          JSON.stringify({
            decisionId: input.decisionId,
            resolution: input.action,
          }),
          current.uploaderUserId,
          input.decisionId,
          nextStatus,
          current.uploaderUserId,
          `CHAPTER_ACCESS_RESOLVED:${input.decisionId}`,
        ),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action:
            input.action === "KEEP_PAID"
              ? "chapter.access.keep_paid"
              : "chapter.access.reference_make_free",
          category: "SERIES_CHAPTERS",
          sourceArea: "CHAPTER_ACCESS_DECISIONS",
          targetType: "CHAPTER_ACCESS_DECISION",
          targetId: input.decisionId,
          targetLabel: `${current.seriesTitle} · Chapter ${current.chapterNumber}`,
          reason: input.note || null,
          oldValue: { status: "PENDING" },
          newValue: { status: nextStatus },
        },
        `EXISTS (
          SELECT 1 FROM chapter_access_decisions resolved
           WHERE resolved.id = '${input.decisionId.replaceAll("'", "''")}'
             AND resolved.status = '${nextStatus}'
        )`,
      ),
    );

    const results = await db.batch(statements);
    if (!results[0]?.meta.changes) {
      throw new ApiError(
        409,
        "ACCESS_DECISION_CHANGED",
        "This decision changed while it was being resolved.",
      );
    }
    const data = await readDecisions("ALL", input.decisionId);
    return json(requestId, { data: data[0] ?? null });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
