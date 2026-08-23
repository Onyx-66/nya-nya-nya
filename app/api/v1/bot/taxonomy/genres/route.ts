import { z } from "zod";
import { errorResponse } from "@/lib/server/api";
import { botContext, botDatabase, botJson, botRequestId } from "@/lib/server/bot-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await botContext(request, "bot:series:read");
    const url = new URL(request.url);
    const page = z.coerce.number().int().min(1).max(10_000).catch(1).parse(url.searchParams.get("page") ?? "1");
    const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
    const term = `%${query}%`;
    const rows = await botDatabase().prepare(
      `SELECT id, name, normalized_key AS canonicalKey
         FROM genres
        WHERE archived_at IS NULL
          AND (? = '' OR LOWER(name) LIKE ? OR LOWER(normalized_key) LIKE ?)
        ORDER BY name COLLATE NOCASE
        LIMIT 25 OFFSET ?`,
    ).bind(query, term, term, (page - 1) * 25).all<Record<string, string>>();
    const count = await botDatabase().prepare("SELECT COUNT(*) AS count FROM genres WHERE archived_at IS NULL AND (? = '' OR LOWER(name) LIKE ? OR LOWER(normalized_key) LIKE ?)").bind(query, term, term).first<{ count: number }>();
    const total = Number(count?.count ?? 0);
    return botJson(auth, { data: rows.results, pagination: { page, limit: 25, total, pageCount: Math.max(1, Math.ceil(total / 25)) } });
  } catch (error) { return errorResponse(botRequestId(request), error); }
}
