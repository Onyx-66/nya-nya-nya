import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requireActor, requireAdmin } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "ALL"]).default("PENDING"),
  kind: z.enum(["ART", "COVER", "ALL"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

const moderationSchema = z.object({
  id: z.string().trim().min(3).max(160),
  expectedRevision: z.number().int().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().max(500).default(""),
});

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdmin(actor);
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Gallery moderation is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const query = listSchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const conditions = ["1 = 1"];
    const bindings: unknown[] = [];
    if (query.status !== "ALL") {
      conditions.push("sga.moderation_status = ?");
      bindings.push(query.status);
    }
    if (query.kind !== "ALL") {
      conditions.push("sga.kind = ?");
      bindings.push(query.kind);
    }
    const where = conditions.join(" AND ");
    const offset = (query.page - 1) * query.pageSize;
    const [rows, count] = await env.DB.batch([
      env.DB.prepare(
        `SELECT sga.id, sga.series_id AS seriesId, s.slug AS seriesSlug,
                s.title AS seriesTitle, sga.kind, sga.orientation,
                sga.caption, sga.alt_text AS altText, sga.language,
                sga.cover_type AS coverType, sga.volume, sga.width, sga.height,
                sga.byte_size AS byteSize,
                sga.moderation_status AS status,
                sga.rejection_reason AS rejectionReason,
                sga.revision, sga.created_at AS createdAt,
                submitter.display_name AS submittedBy,
                team.name AS teamName
           FROM series_gallery_assets sga
           JOIN series s ON s.id = sga.series_id
           JOIN users submitter ON submitter.id = sga.submitted_by_user_id
           LEFT JOIN teams team ON team.id = sga.submitter_team_id
          WHERE ${where}
          ORDER BY CASE sga.moderation_status
                     WHEN 'PENDING' THEN 0
                     WHEN 'REJECTED' THEN 1
                     ELSE 2
                   END,
                   sga.created_at, sga.id
          LIMIT ? OFFSET ?`,
      ).bind(...bindings, query.pageSize, offset),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
           FROM series_gallery_assets sga
          WHERE ${where}`,
      ).bind(...bindings),
    ]);
    const total = Number(
      (count.results[0] as { count?: number } | undefined)?.count ?? 0,
    );
    return json(
      requestId,
      {
        data: rows.results.map((row) => {
          const asset = row as Record<string, unknown>;
          return {
            ...asset,
            assetUrl: `/api/v1/series-gallery-media?id=${encodeURIComponent(String(asset.id))}&v=${Number(asset.revision)}`,
          };
        }),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          pages: Math.max(1, Math.ceil(total / query.pageSize)),
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
    const actor = await requireActor();
    requireAdmin(actor);
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Gallery moderation is temporarily unavailable.",
      );
    }
    const payload = moderationSchema.parse(await request.json());
    if (payload.decision === "REJECTED" && payload.reason.length < 3) {
      throw new ApiError(
        422,
        "REJECTION_REASON_REQUIRED",
        "Add a short reason so the submitter knows what to fix.",
      );
    }
    const current = await env.DB.prepare(
      `SELECT sga.id, sga.kind, sga.moderation_status AS status,
              sga.revision, s.title AS seriesTitle
         FROM series_gallery_assets sga
         JOIN series s ON s.id = sga.series_id
        WHERE sga.id = ?
        LIMIT 1`,
    )
      .bind(payload.id)
      .first<{
        id: string;
        kind: string;
        status: string;
        revision: number;
        seriesTitle: string;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "GALLERY_ASSET_NOT_FOUND",
        "This gallery submission is no longer available.",
      );
    }
    if (
      current.status !== "PENDING" ||
      Number(current.revision) !== payload.expectedRevision
    ) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This submission changed. Reload the moderation queue.",
      );
    }
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE series_gallery_assets
            SET moderation_status = ?,
                rejection_reason = ?,
                reviewed_by_user_id = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?
            AND moderation_status = 'PENDING'`,
      ).bind(
        payload.decision,
        payload.decision === "REJECTED" ? payload.reason : null,
        actor.id,
        payload.id,
        payload.expectedRevision,
      ),
      auditStatement(
        env.DB,
        actor,
        requestId,
        {
          action: `series.gallery.${payload.decision.toLowerCase()}`,
          category: "SERIES_CHAPTERS",
          sourceArea: "SERIES_GALLERY",
          targetType: "SERIES_GALLERY_ASSET",
          targetId: payload.id,
          targetLabel: `${current.seriesTitle} · ${current.kind}`,
          reason: payload.reason || "Approved for the public gallery.",
          oldValue: {
            status: current.status,
            revision: current.revision,
          },
          newValue: {
            status: payload.decision,
            revision: payload.expectedRevision + 1,
          },
        },
        "changes() = 1",
      ),
    ]);
    if (!Number(results[0]?.meta.changes ?? 0)) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This submission changed. Reload the moderation queue.",
      );
    }
    return json(requestId, {
      data: {
        id: payload.id,
        status: payload.decision,
        revision: payload.expectedRevision + 1,
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
