import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { SERIES_REPORT_CATEGORIES } from "@/lib/series-reports";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  seriesId: z.string().trim().min(3).max(120),
  category: z.enum(SERIES_REPORT_CATEGORIES),
  description: z.string().trim().min(12).max(2_000),
});

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("report.create");
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Series reporting is temporarily unavailable.",
      );
    }
    const payload = createSchema.parse(await request.json());
    const series = await env.DB.prepare(
      `SELECT id, slug, title
         FROM series
        WHERE id = ?
          AND is_published = 1
          AND archived_at IS NULL
          AND status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
          AND rights_status IN
            ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
        LIMIT 1`,
    )
      .bind(payload.seriesId)
      .first<{ id: string; slug: string; title: string }>();
    if (!series) {
      throw new ApiError(
        404,
        "SERIES_NOT_FOUND",
        "This series is no longer available.",
      );
    }
    const [recent, duplicate] = await env.DB.batch([
      env.DB.prepare(
        `SELECT COUNT(*) AS count
           FROM reports
          WHERE reporter_user_id = ?
            AND target_type = 'SERIES'
            AND datetime(created_at) >= datetime('now', '-1 hour')`,
      ).bind(actor.id),
      env.DB.prepare(
        `SELECT id
           FROM reports
          WHERE reporter_user_id = ?
            AND target_type = 'SERIES'
            AND target_id = ?
            AND category = ?
            AND status IN ('OPEN', 'IN_REVIEW')
          LIMIT 1`,
      ).bind(actor.id, series.id, payload.category),
    ]);
    const recentCount = Number(
      (recent.results[0] as { count?: number } | undefined)?.count ?? 0,
    );
    if (recentCount >= 5) {
      throw new ApiError(
        429,
        "REPORT_RATE_LIMITED",
        "You have sent several reports recently. Please wait before sending another.",
      );
    }
    if (duplicate.results.length) {
      throw new ApiError(
        409,
        "REPORT_ALREADY_OPEN",
        "You already have an active report in this category for this series.",
      );
    }
    const reportId = randomId();
    let results: D1Result<unknown>[];
    try {
      results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO reports
           (id, reporter_user_id, target_type, target_id, category, detail,
            status, revision)
           VALUES (?, ?, 'SERIES', ?, ?, ?, 'OPEN', 1)`,
        ).bind(
          reportId,
          actor.id,
          series.id,
          payload.category,
          payload.description,
        ),
        auditStatement(
          env.DB,
          actor,
          requestId,
          {
            action: "series.report.created",
            category: "SERIES_CHAPTERS",
            sourceArea: "PUBLIC_SERIES",
            targetType: "SERIES_REPORT",
            targetId: reportId,
            targetLabel: series.title,
            metadata: {
              seriesId: series.id,
              seriesSlug: series.slug,
              reportCategory: payload.category,
            },
          },
          "changes() = 1",
        ),
      ]);
    } catch (insertError) {
      const message =
        insertError instanceof Error ? insertError.message : "";
      if (message.includes("Series report rate limit exceeded.")) {
        throw new ApiError(
          429,
          "REPORT_RATE_LIMITED",
          "You have sent several reports recently. Please wait before sending another.",
        );
      }
      if (message.includes("Active series report already exists.")) {
        throw new ApiError(
          409,
          "REPORT_ALREADY_OPEN",
          "You already have an active report in this category for this series.",
        );
      }
      throw insertError;
    }
    if (!Number(results[0]?.meta.changes ?? 0)) {
      throw new ApiError(
        409,
        "REPORT_NOT_CREATED",
        "This report could not be saved. Please try again.",
      );
    }
    return json(
      requestId,
      {
        data: {
          id: reportId,
          status: "OPEN",
          message: "Report sent to the Series Reports queue.",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
