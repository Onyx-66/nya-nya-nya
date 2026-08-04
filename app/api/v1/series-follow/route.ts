import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { randomId } from "@/lib/server/random-id";
import { requireActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const payloadSchema = z.object({
  slug: slugSchema,
});

async function resolveSeries(slug: string) {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Series following is temporarily unavailable.",
    );
  }
  const series = await env.DB.prepare(
    `SELECT id, slug, title
       FROM series
      WHERE slug = ?
        AND is_published = 1
        AND archived_at IS NULL
        AND status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
        AND rights_status IN
          ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
      LIMIT 1`,
  )
    .bind(slug)
    .first<{ id: string; slug: string; title: string }>();
  if (!series) {
    throw new ApiError(
      404,
      "SERIES_NOT_FOUND",
      "This series is unavailable.",
    );
  }
  return series;
}

async function followSnapshot(userId: string, seriesId: string) {
  const [follow, count] = await Promise.all([
    env.DB!.prepare(
      `SELECT 1 AS followed
         FROM follows
        WHERE user_id = ? AND series_id = ?
        LIMIT 1`,
    )
      .bind(userId, seriesId)
      .first<{ followed: number }>(),
    env.DB!.prepare(
      `SELECT COUNT(*) AS count
         FROM follows
        WHERE series_id = ?`,
    )
      .bind(seriesId)
      .first<{ count: number }>(),
  ]);
  return {
    following: Boolean(follow),
    followerCount: Number(count?.count ?? 0),
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const slug = slugSchema.parse(url.searchParams.get("slug"));
    const series = await resolveSeries(slug);
    return json(
      requestId,
      await followSnapshot(actor.id, series.id),
      {
        headers: {
          "cache-control": "private, no-store",
          vary: "cookie",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { slug } = payloadSchema.parse(await request.json());
    const series = await resolveSeries(slug);
    await env.DB!.batch([
      env.DB!.prepare(
        `INSERT OR IGNORE INTO follows (user_id, series_id)
         VALUES (?, ?)`,
      ).bind(actor.id, series.id),
      env.DB!.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, category, source_area, result,
          target_type, target_id, target_label, reason, request_id)
         SELECT ?, ?, 'series.follow', 'SERIES_CHAPTERS', 'PUBLIC_SERIES',
                'SUCCESS', 'SERIES', ?, ?,
                'Reader followed a published series.', ?
          WHERE changes() = 1`,
      ).bind(
        randomId(),
        actor.id,
        series.id,
        series.title,
        requestId,
      ),
      env.DB!.prepare(
        `UPDATE series
            SET follower_count = (
              SELECT COUNT(*) FROM follows WHERE series_id = ?
            ),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      ).bind(series.id, series.id),
    ]);
    return json(requestId, await followSnapshot(actor.id, series.id));
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { slug } = payloadSchema.parse(await request.json());
    const series = await resolveSeries(slug);
    await env.DB!.batch([
      env.DB!.prepare(
        `DELETE FROM follows
          WHERE user_id = ? AND series_id = ?`,
      ).bind(actor.id, series.id),
      env.DB!.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, category, source_area, result,
          target_type, target_id, target_label, reason, request_id)
         SELECT ?, ?, 'series.unfollow', 'SERIES_CHAPTERS', 'PUBLIC_SERIES',
                'SUCCESS', 'SERIES', ?, ?,
                'Reader unfollowed a published series.', ?
          WHERE changes() = 1`,
      ).bind(
        randomId(),
        actor.id,
        series.id,
        series.title,
        requestId,
      ),
      env.DB!.prepare(
        `UPDATE series
            SET follower_count = (
              SELECT COUNT(*) FROM follows WHERE series_id = ?
            ),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      ).bind(series.id, series.id),
    ]);
    return json(requestId, await followSnapshot(actor.id, series.id));
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
