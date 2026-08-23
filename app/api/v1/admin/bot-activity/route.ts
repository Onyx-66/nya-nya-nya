import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  result: z.enum(["ALL", "SUCCESS", "DENIED", "FAILURE"]).default("ALL"),
  query: z.string().trim().max(160).default(""),
});

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Bot activity is temporarily unavailable.");
  return env.DB;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "admin.bot-actions.read");
    const url = new URL(request.url);
    const query = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      result: url.searchParams.get("result") ?? undefined,
      query: url.searchParams.get("query") ?? undefined,
    });
    const term = `%${query.query.toLowerCase()}%`;
    const resultFilter = query.result === "ALL" ? "1 = 1" : "al.result = ?";
    const args = [
      ...(query.result === "ALL" ? [] : [query.result]),
      query.query,
      term,
      term,
    ];
    const db = database();
    const [rows, count] = await Promise.all([
      db.prepare(
        `SELECT al.id, al.request_id AS requestId, al.actor_user_id AS actorUserId,
                COALESCE(u.display_name, 'Unknown actor') AS actorName,
                al.actor_role AS actorRole, al.action, al.result,
                al.target_type AS targetType, al.target_id AS targetId,
                al.target_label AS targetLabel, al.reason, al.metadata_json AS metadataJson,
                al.created_at AS createdAt
           FROM audit_logs al
           LEFT JOIN users u ON u.id = al.actor_user_id
          WHERE al.source_area = 'BOT_API'
            AND ${resultFilter}
            AND (? = '' OR LOWER(al.action) LIKE ? OR LOWER(COALESCE(al.target_label, '')) LIKE ?)
          ORDER BY datetime(al.created_at) DESC, al.id DESC
          LIMIT ? OFFSET ?`,
      ).bind(...args, query.limit, (query.page - 1) * query.limit).all<Record<string, unknown>>(),
      db.prepare(
        `SELECT COUNT(*) AS count FROM audit_logs al
          WHERE al.source_area = 'BOT_API' AND ${resultFilter}
            AND (? = '' OR LOWER(al.action) LIKE ? OR LOWER(COALESCE(al.target_label, '')) LIKE ?)`,
      ).bind(...args).first<{ count: number }>(),
    ]);
    return json(requestId, {
      data: rows.results.map((row) => ({
        ...row,
        metadata: (() => { try { return JSON.parse(String(row.metadataJson ?? "{}")); } catch { return {}; } })(),
        metadataJson: undefined,
      })),
      pagination: { page: query.page, limit: query.limit, total: Number(count?.count ?? 0), pageCount: Math.max(1, Math.ceil(Number(count?.count ?? 0) / query.limit)) },
      readOnly: true,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
