import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(["ALL", "SERIES", "TEAM", "CHAPTER"]).default("ALL"),
  status: z.enum(["ALL", "ACTIVE", "ARCHIVED"]).default("ALL"),
  query: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

type IdentifierRow = {
  publicRef: string;
  entityType: "SERIES" | "TEAM" | "CHAPTER";
  title: string;
  parentLabel: string | null;
  archived: boolean;
  createdAt: string;
};

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Identifier inventory is temporarily unavailable.");
  return env.DB;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "admin.identifiers.read");
    const url = new URL(request.url);
    const query = querySchema.parse({
      type: url.searchParams.get("type") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      query: url.searchParams.get("query") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const db = database();
    const term = `%${query.query.toLowerCase()}%`;
    const selected: Array<"SERIES" | "TEAM" | "CHAPTER"> = query.type === "ALL"
      ? ["SERIES", "TEAM", "CHAPTER"]
      : [query.type];
    const rows: IdentifierRow[] = [];
    if (selected.includes("SERIES")) {
      const result = await db.prepare(
        `SELECT s.public_ref AS publicRef, 'SERIES' AS entityType, s.title AS title,
                NULL AS parentLabel, (s.archived_at IS NOT NULL) AS archived, s.created_at AS createdAt
           FROM series s
          WHERE (? = '' OR LOWER(s.public_ref) LIKE ? OR LOWER(s.title) LIKE ?)
            AND (? = 'ALL' OR (? = 'ACTIVE' AND s.archived_at IS NULL) OR (? = 'ARCHIVED' AND s.archived_at IS NOT NULL))
          ORDER BY datetime(s.created_at) DESC, s.public_ref DESC`,
      ).bind(query.query, term, term, query.status, query.status, query.status).all<IdentifierRow>();
      rows.push(...result.results.map((row) => ({ ...row, archived: Boolean(row.archived) })));
    }
    if (selected.includes("TEAM")) {
      const result = await db.prepare(
        `SELECT t.public_ref AS publicRef, 'TEAM' AS entityType, t.name AS title,
                NULL AS parentLabel, t.is_archived AS archived, t.created_at AS createdAt
           FROM teams t
          WHERE (? = '' OR LOWER(t.public_ref) LIKE ? OR LOWER(t.name) LIKE ?)
            AND (? = 'ALL' OR (? = 'ACTIVE' AND t.is_archived = 0) OR (? = 'ARCHIVED' AND t.is_archived = 1))
          ORDER BY datetime(t.created_at) DESC, t.public_ref DESC`,
      ).bind(query.query, term, term, query.status, query.status, query.status).all<IdentifierRow>();
      rows.push(...result.results.map((row) => ({ ...row, archived: Boolean(row.archived) })));
    }
    if (selected.includes("CHAPTER")) {
      const result = await db.prepare(
        `SELECT c.public_ref AS publicRef, 'CHAPTER' AS entityType,
                s.title || ' · Chapter ' || c.chapter_number AS title,
                s.title AS parentLabel, (c.state = 'ARCHIVED') AS archived, c.created_at AS createdAt
           FROM chapters c JOIN series s ON s.id = c.series_id
          WHERE (? = '' OR LOWER(c.public_ref) LIKE ? OR LOWER(s.title) LIKE ? OR LOWER(c.chapter_number) LIKE ?)
            AND (? = 'ALL' OR (? = 'ACTIVE' AND c.state <> 'ARCHIVED') OR (? = 'ARCHIVED' AND c.state = 'ARCHIVED'))
          ORDER BY datetime(c.created_at) DESC, c.public_ref DESC`,
      ).bind(query.query, term, term, term, query.status, query.status, query.status).all<IdentifierRow>();
      rows.push(...result.results.map((row) => ({ ...row, archived: Boolean(row.archived) })));
    }
    rows.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.publicRef.localeCompare(left.publicRef));
    const total = rows.length;
    const offset = (query.page - 1) * query.limit;
    return json(requestId, {
      data: rows.slice(offset, offset + query.limit),
      pagination: { page: query.page, limit: query.limit, total, pageCount: Math.max(1, Math.ceil(total / query.limit)) },
      immutable: true,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
