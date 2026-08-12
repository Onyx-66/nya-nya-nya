import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  redactSensitive,
  requestIdFor,
  writeAudit,
} from "@/lib/server/admin-utils";
import {
  getActor,
  requireActor,
  requireOwner,
} from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const categorySchema = z.enum([
  "ALL",
  "AUTHENTICATION_SECURITY",
  "USERS_ROLES",
  "SERIES_CHAPTERS",
  "TEAMS_PERMISSIONS",
  "DISCUSSIONS_MODERATION",
  "COMMERCE_STORE",
  "APPEARANCE_SETTINGS",
  "UPLOADS_IMPORTS",
  "SYSTEM_MAINTENANCE",
]);

const resultSchema = z.enum(["ALL", "SUCCESS", "FAILURE", "DENIED"]);

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const filtersSchema = z.object({
  id: z.string().trim().min(3).max(160).optional(),
  start: dateSchema,
  end: dateSchema,
  category: categorySchema.default("ALL"),
  actor: z.string().trim().max(160).default(""),
  action: z.string().trim().max(160).default(""),
  targetType: z.string().trim().max(100).default(""),
  result: resultSchema.default("ALL"),
  query: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

type AuditRow = {
  id: string;
  action: string;
  category: string;
  sourceArea: string;
  result: string;
  actorRole: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  reason: string | null;
  requestId: string;
  metadataJson: string | null;
  oldValueJson: string | null;
  newValueJson: string | null;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
};

function parseSafeJson(value: string | null) {
  if (!value) return null;
  try {
    return redactSensitive(JSON.parse(value) as unknown);
  } catch {
    return { unavailable: true };
  }
}

function relatedHref(row: AuditRow) {
  if (row.targetType === "SERIES") {
    return `/onyx/admin/access/series?record=${encodeURIComponent(row.targetId)}`;
  }
  if (row.targetType === "TEAM") {
    return `/onyx/admin/access/team-directory?record=${encodeURIComponent(row.targetId)}`;
  }
  if (row.targetType === "PRODUCT") {
    return `/onyx/admin/access/store/offers?record=${encodeURIComponent(row.targetId)}`;
  }
  return null;
}

function mapRow(row: AuditRow, detail = false) {
  return {
    id: row.id,
    timestamp: row.createdAt,
    actor: row.actorId
      ? {
          id: row.actorId,
          name: row.actorName,
          email: row.actorEmail,
          role: row.actorRole,
        }
      : null,
    action: row.action,
    category: row.category,
    sourceArea: row.sourceArea,
    result: row.result,
    target: {
      type: row.targetType,
      id: row.targetId,
      label: row.targetLabel,
      href: relatedHref(row),
    },
    reason: row.reason,
    requestId: row.requestId,
    ...(detail
      ? {
          metadata: parseSafeJson(row.metadataJson),
          before: parseSafeJson(row.oldValueJson),
          after: parseSafeJson(row.newValueJson),
        }
      : {}),
  };
}

async function authorize(requestId: string) {
  let actor: Awaited<ReturnType<typeof getActor>> = null;
  try {
    actor = await requireActor();
    requireOwner(actor);
    return actor;
  } catch (error) {
    if (!actor) actor = await getActor().catch(() => null);
    if (actor) {
      await writeAudit(actor, requestId, {
        action: "audit.access.denied",
        category: "AUTHENTICATION_SECURITY",
        sourceArea: "AUDIT_LOG",
        result: "DENIED",
        targetType: "AUDIT_LOG",
        targetId: "global",
        targetLabel: "Platform audit log",
        reason: "The account did not have owner authorization.",
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    await authorize(requestId);
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "The audit log is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const filters = filtersSchema.parse({
      id: url.searchParams.get("id") || undefined,
      start: url.searchParams.get("start") || undefined,
      end: url.searchParams.get("end") || undefined,
      category: url.searchParams.get("category") ?? "ALL",
      actor: url.searchParams.get("actor") ?? "",
      action: url.searchParams.get("action") ?? "",
      targetType: url.searchParams.get("targetType") ?? "",
      result: url.searchParams.get("result") ?? "ALL",
      query: url.searchParams.get("query") ?? "",
      page: url.searchParams.get("page") ?? "1",
      limit: url.searchParams.get("limit") ?? "40",
    });
    if (filters.start && filters.end && filters.start > filters.end) {
      throw new ApiError(
        422,
        "DATE_RANGE_INVALID",
        "The audit end date must be on or after the start date.",
      );
    }
    const select = `
      SELECT al.id, al.action, al.category,
             al.source_area AS sourceArea, al.result,
             al.actor_role AS actorRole,
             al.target_type AS targetType, al.target_id AS targetId,
             al.target_label AS targetLabel, al.reason,
             al.request_id AS requestId,
             al.metadata_json AS metadataJson,
             al.old_value_json AS oldValueJson,
             al.new_value_json AS newValueJson,
             al.created_at AS createdAt,
             u.id AS actorId, u.display_name AS actorName,
             u.email AS actorEmail
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.actor_user_id
    `;
    if (filters.id) {
      const row = await env.DB.prepare(
        `${select} WHERE al.id = ? LIMIT 1`,
      )
        .bind(filters.id)
        .first<AuditRow>();
      if (!row) {
        throw new ApiError(
          404,
          "AUDIT_EVENT_NOT_FOUND",
          "This audit event no longer exists.",
        );
      }
      return json(
        requestId,
        { data: mapRow(row, true) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const clauses = ["1 = 1"];
    const bindings: Array<string | number> = [];
    if (filters.start) {
      clauses.push("datetime(al.created_at) >= datetime(?)");
      bindings.push(`${filters.start} 00:00:00`);
    }
    if (filters.end) {
      clauses.push("datetime(al.created_at) < datetime(?, '+1 day')");
      bindings.push(`${filters.end} 00:00:00`);
    }
    if (filters.category !== "ALL") {
      clauses.push("al.category = ?");
      bindings.push(filters.category);
    }
    if (filters.result !== "ALL") {
      clauses.push("al.result = ?");
      bindings.push(filters.result);
    }
    if (filters.actor) {
      clauses.push(
        "(LOWER(COALESCE(u.display_name, '')) LIKE ? OR LOWER(COALESCE(u.email, '')) LIKE ? OR COALESCE(u.id, '') LIKE ?)",
      );
      const term = `%${filters.actor.toLowerCase()}%`;
      bindings.push(term, term, term);
    }
    if (filters.action) {
      clauses.push("LOWER(al.action) LIKE ?");
      bindings.push(`%${filters.action.toLowerCase()}%`);
    }
    if (filters.targetType) {
      clauses.push("LOWER(al.target_type) = ?");
      bindings.push(filters.targetType.toLowerCase());
    }
    if (filters.query) {
      clauses.push(
        "(al.target_id LIKE ? OR al.request_id LIKE ? OR LOWER(COALESCE(al.target_label, '')) LIKE ?)",
      );
      const term = `%${filters.query.toLowerCase()}%`;
      bindings.push(term, term, term);
    }
    const where = clauses.join(" AND ");
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       WHERE ${where}`,
    )
      .bind(...bindings)
      .first<{ count: number }>();
    const rows = await env.DB.prepare(
      `${select}
       WHERE ${where}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(
        ...bindings,
        filters.limit,
        (filters.page - 1) * filters.limit,
      )
      .all<AuditRow>();
    return json(
      requestId,
      {
        data: rows.results.map((row) => mapRow(row)),
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total: Number(count?.count ?? 0),
          pages: Math.max(
            1,
            Math.ceil(Number(count?.count ?? 0) / filters.limit),
          ),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
