import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requireActor, requireAdmin } from "@/lib/server/policy";
import {
  SERIES_REPORT_CATEGORIES,
  SERIES_REPORT_STATUSES,
} from "@/lib/series-reports";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z
    .enum(["ALL", ...SERIES_REPORT_STATUSES] as const)
    .default("ALL"),
  category: z
    .enum(["ALL", ...SERIES_REPORT_CATEGORIES] as const)
    .default("ALL"),
  query: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const moderationSchema = z.object({
  id: z.string().trim().min(3).max(160),
  expectedRevision: z.number().int().min(1),
  status: z.enum(SERIES_REPORT_STATUSES),
  note: z.string().trim().max(1_000).default(""),
});

async function requireSeriesReportStaff() {
  const actor = await requireActor("admin.console.access");
  requireAdmin(actor);
  return actor;
}

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Series Reports is temporarily unavailable.",
    );
  }
  return env.DB;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    await requireSeriesReportStaff();
    const url = new URL(request.url);
    const filters = querySchema.parse({
      status: url.searchParams.get("status") ?? "ALL",
      category: url.searchParams.get("category") ?? "ALL",
      query: url.searchParams.get("query") ?? "",
      page: url.searchParams.get("page") ?? 1,
      limit: url.searchParams.get("limit") ?? 20,
    });
    const conditions = ["r.target_type = 'SERIES'"];
    const bindings: unknown[] = [];
    if (filters.status !== "ALL") {
      conditions.push("r.status = ?");
      bindings.push(filters.status);
    }
    if (filters.category !== "ALL") {
      conditions.push("r.category = ?");
      bindings.push(filters.category);
    }
    if (filters.query) {
      conditions.push(`(
        LOWER(s.title) LIKE ?
        OR LOWER(COALESCE(reporter.display_name, '')) LIKE ?
        OR LOWER(COALESCE(reporter.email, '')) LIKE ?
        OR LOWER(r.detail) LIKE ?
      )`);
      const term = `%${filters.query.toLowerCase()}%`;
      bindings.push(term, term, term, term);
    }
    const where = conditions.join(" AND ");
    const offset = (filters.page - 1) * filters.limit;
    const db = database();
    const [rows, totalRow, summaryRows] = await db.batch([
      db.prepare(
        `SELECT r.id, r.target_id AS seriesId, r.category, r.detail,
                r.status, r.resolution_note AS resolutionNote,
                r.revision, r.created_at AS createdAt,
                r.updated_at AS updatedAt, r.moderated_at AS moderatedAt,
                s.slug AS seriesSlug, s.title AS seriesTitle,
                CASE WHEN s.cover_key IS NULL THEN NULL
                  ELSE '/api/v1/series-media?id=' || s.id ||
                       '&slot=cover&v=' || s.revision
                END AS seriesCoverUrl,
                reporter.display_name AS reporterName,
                reporter.email AS reporterEmail,
                moderator.display_name AS moderatorName
           FROM reports r
           JOIN series s ON s.id = r.target_id
           LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
           LEFT JOIN users moderator ON moderator.id = r.moderated_by_user_id
          WHERE ${where}
          ORDER BY CASE r.status
                     WHEN 'OPEN' THEN 0
                     WHEN 'IN_REVIEW' THEN 1
                     ELSE 2
                   END,
                   datetime(r.created_at) DESC,
                   r.id DESC
          LIMIT ? OFFSET ?`,
      ).bind(...bindings, filters.limit, offset),
      db.prepare(
        `SELECT COUNT(*) AS count
           FROM reports r
           JOIN series s ON s.id = r.target_id
           LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
          WHERE ${where}`,
      ).bind(...bindings),
      db.prepare(
        `SELECT status, COUNT(*) AS count
           FROM reports
          WHERE target_type = 'SERIES'
          GROUP BY status`,
      ),
    ]);
    const total = Number(
      (totalRow.results[0] as { count?: number } | undefined)?.count ?? 0,
    );
    return json(
      requestId,
      {
        data: rows.results,
        summary: Object.fromEntries(
          summaryRows.results.map((row) => {
            const record = row as { status: string; count: number };
            return [record.status, Number(record.count)];
          }),
        ),
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          pages: Math.max(1, Math.ceil(total / filters.limit)),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireSeriesReportStaff();
    const payload = moderationSchema.parse(await request.json());
    if (
      ["RESOLVED", "DISMISSED"].includes(payload.status) &&
      payload.note.length < 8
    ) {
      throw new ApiError(
        422,
        "RESOLUTION_NOTE_REQUIRED",
        "Add a short moderation note before closing this report.",
      );
    }
    const db = database();
    const current = await db.prepare(
      `SELECT r.id, r.status, r.revision, r.target_id AS seriesId,
              r.category, s.title AS seriesTitle
         FROM reports r
         JOIN series s ON s.id = r.target_id
        WHERE r.id = ?
          AND r.target_type = 'SERIES'
        LIMIT 1`,
    )
      .bind(payload.id)
      .first<{
        id: string;
        status: string;
        revision: number;
        seriesId: string;
        category: string;
        seriesTitle: string;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "SERIES_REPORT_NOT_FOUND",
        "This series report is no longer available.",
      );
    }
    if (
      Number(current.revision) !== payload.expectedRevision ||
      current.status === payload.status
    ) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This report changed. Reload the queue before updating it.",
      );
    }
    const nextRevision = payload.expectedRevision + 1;
    let results: D1Result<unknown>[];
    try {
      results = await db.batch([
        db.prepare(
          `UPDATE reports
              SET status = ?,
                  moderated_by_user_id = ?,
                  moderated_at = CASE
                    WHEN ? = 'OPEN' THEN NULL
                    ELSE CURRENT_TIMESTAMP
                  END,
                  resolution_note = NULLIF(?, ''),
                  revision = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND target_type = 'SERIES'
              AND revision = ?
              AND status = ?`,
        ).bind(
          payload.status,
          payload.status === "OPEN" ? null : actor.id,
          payload.status,
          payload.note,
          nextRevision,
          payload.id,
          payload.expectedRevision,
          current.status,
        ),
        auditStatement(
          db,
          actor,
          requestId,
          {
            action: "series.report.status.updated",
            category: "SERIES_CHAPTERS",
            sourceArea: "SERIES_REPORTS",
            targetType: "SERIES_REPORT",
            targetId: payload.id,
            targetLabel: current.seriesTitle,
            reason: payload.note || `Status changed to ${payload.status}.`,
            oldValue: {
              status: current.status,
              revision: current.revision,
            },
            newValue: {
              status: payload.status,
              revision: nextRevision,
              seriesId: current.seriesId,
              reportCategory: current.category,
            },
          },
          "changes() = 1",
        ),
      ]);
    } catch (updateError) {
      if (
        updateError instanceof Error &&
        updateError.message.includes("Active series report already exists.")
      ) {
        throw new ApiError(
          409,
          "ACTIVE_REPORT_CONFLICT",
          "A newer active report already covers this reader, series, and category.",
        );
      }
      throw updateError;
    }
    if (!Number(results[0]?.meta.changes ?? 0)) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This report changed. Reload the queue before updating it.",
      );
    }
    return json(requestId, {
      data: {
        id: payload.id,
        status: payload.status,
        revision: nextRevision,
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
