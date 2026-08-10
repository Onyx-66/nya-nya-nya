import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  countryLanguageDefaults,
  countryOptions,
  languageOptions,
  normalizedLookupKey,
} from "@/lib/admin-metadata";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  query: z.string().trim().max(160).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "content.series.manage");
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Series options are temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const query = querySchema.parse({
      query: url.searchParams.get("query") ?? "",
      limit: url.searchParams.get("limit") ?? "40",
    });
    const term = `%${normalizedLookupKey(query.query)}%`;
    const [creators, publishers, genres, teams] = await Promise.all([
      env.DB.prepare(
        `SELECT id, name
         FROM creators
         WHERE archived_at IS NULL
           AND (? = '%%' OR normalized_name LIKE ?)
         ORDER BY name COLLATE NOCASE LIMIT ?`,
      )
        .bind(term, term, query.limit)
        .all<{ id: string; name: string }>(),
      env.DB.prepare(
        `SELECT id, name
         FROM publishers
         WHERE archived_at IS NULL
           AND (? = '%%' OR normalized_name LIKE ?)
         ORDER BY name COLLATE NOCASE LIMIT ?`,
      )
        .bind(term, term, query.limit)
        .all<{ id: string; name: string }>(),
      env.DB.prepare(
        `SELECT g.id, g.name,
                (SELECT COUNT(*) FROM series_genres sg
                  WHERE sg.genre_id = g.id) AS usageCount
         FROM genres g
         WHERE g.archived_at IS NULL
           AND (? = '%%' OR g.normalized_key LIKE ?)
         ORDER BY g.name COLLATE NOCASE LIMIT ?`,
      )
        .bind(term, term, query.limit)
        .all<{ id: string; name: string; usageCount: number }>(),
      env.DB.prepare(
        `SELECT id, name, verification_status AS verificationStatus
         FROM teams
         WHERE is_archived = 0
           AND verification_status <> 'SUSPENDED'
           AND (? = '%%' OR LOWER(name) LIKE ?)
         ORDER BY name COLLATE NOCASE LIMIT ?`,
      )
        .bind(term, term, query.limit)
        .all<{
          id: string;
          name: string;
          verificationStatus: string;
        }>(),
    ]);
    return json(
      requestId,
      {
        data: {
          countries: countryOptions.map(([code, name]) => ({ code, name })),
          languages: languageOptions.map(([code, name]) => ({ code, name })),
          countryLanguageDefaults,
          creators: creators.results,
          publishers: publishers.results,
          genres: genres.results.map((genre) => ({
            ...genre,
            usageCount: Number(genre.usageCount),
          })),
          teams: teams.results,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
