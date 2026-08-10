import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { getCommercialSettingsDocument } from "@/lib/server/commercial-settings";
import { requireActor } from "@/lib/server/policy";
import { seriesMediaUrl } from "@/lib/server/series-media-url";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  category: z
    .enum(["ALL", "UPDATES", "ANNOUNCEMENTS", "SOCIAL"])
    .default("ALL"),
  state: z.enum(["UNREAD", "READ", "ALL"]).default("UNREAD"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(40).default(20),
});

const mutationSchema = z
  .object({
    action: z.enum(["READ", "UNREAD", "READ_ALL"]),
    id: z.string().trim().min(3).max(160).optional(),
  })
  .superRefine((value, context) => {
    if (value.action !== "READ_ALL" && !value.id) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Choose a notification to update.",
      });
    }
  });

const categoryExpression = `
  CASE
    WHEN kind = 'PROFILE_FOLLOW'
      OR kind LIKE 'COMMENT_%'
      OR kind LIKE 'DISCUSSION_%'
      OR kind LIKE 'MENTION_%'
      OR kind LIKE 'REACTION_%'
      OR kind LIKE 'SOCIAL_%'
      THEN 'SOCIAL'
    WHEN kind LIKE 'ANNOUNCEMENT%'
      OR kind LIKE 'SYSTEM_%'
      OR kind LIKE 'SECURITY_%'
      OR kind LIKE 'PURCHASE_%'
      OR kind LIKE 'PAYMENT_%'
      THEN 'ANNOUNCEMENTS'
    ELSE 'UPDATES'
  END
`;

function seriesSlugForNotification(record: Record<string, unknown>) {
  try {
    const metadata = JSON.parse(String(record.metadataJson ?? "{}")) as Record<
      string,
      unknown
    >;
    const fromMetadata = String(metadata.seriesSlug ?? "").trim();
    if (/^[a-z0-9][a-z0-9_-]{0,159}$/i.test(fromMetadata)) {
      return fromMetadata;
    }
  } catch {
    // Invalid legacy metadata is ignored; the safe action path can still resolve.
  }
  const actionUrl = String(record.actionUrl ?? "").trim();
  const match = /^\/title\/([^/?#]+)/u.exec(actionUrl);
  if (!match?.[1]) return null;
  try {
    const candidate = decodeURIComponent(match[1]);
    return /^[a-z0-9][a-z0-9_-]{0,159}$/i.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Notifications are temporarily unavailable.",
      );
    }
    const commercial = await getCommercialSettingsDocument();
    const premiumEconomyPublic =
      commercial.settings.economy.premiumEconomyPublic;
    await env.DB.prepare(
      `INSERT INTO notifications
       (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
       SELECT 'ntf_' || lower(hex(randomblob(16))),
              ?,
              'CHAPTER_UPDATE',
              'New chapter: ' || s.title,
              'Chapter ' || c.chapter_number ||
                CASE WHEN t.name IS NOT NULL THEN ' from ' || t.name ELSE '' END ||
                ' is now available.',
              'chapter-update:' || c.id,
              '/title/' || s.slug || '/chapter/' || c.slug,
              json_object(
                'seriesSlug', s.slug,
                'chapterSlug', c.slug,
                'chapterNumber', c.chapter_number,
                'teamName', t.name
              )
         FROM chapters c
         JOIN series s ON s.id = c.series_id
         LEFT JOIN teams t ON t.id = c.team_id
        WHERE c.state = 'PUBLISHED'
          AND c.visibility = 'PUBLIC'
          AND datetime(c.published_at) <= CURRENT_TIMESTAMP
          AND datetime(c.published_at) >= datetime('now', '-30 days')
          AND (? = 1 OR c.access_type = 'FREE')
          AND s.is_published = 1
          AND s.archived_at IS NULL
          AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
          AND s.rights_status IN
            ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          AND EXISTS (
            SELECT 1
              FROM (
                SELECT created_at AS subscribedAt
                  FROM follows
                 WHERE user_id = ? AND series_id = s.id
                UNION ALL
                SELECT created_at AS subscribedAt
                  FROM library_entries
                 WHERE user_id = ?
                   AND series_id = s.id
                   AND notifications_enabled = 1
              ) subscription
             WHERE datetime(subscription.subscribedAt) <= datetime(c.published_at)
          )
          AND NOT EXISTS (
            SELECT 1
              FROM notifications existing
             WHERE existing.user_id = ?
               AND existing.dedupe_key = 'chapter-update:' || c.id
          )
        ORDER BY datetime(c.published_at) DESC, c.id DESC
        LIMIT 40`,
    )
      .bind(
        actor.id,
        premiumEconomyPublic || actor.roles.includes("OWNER") ? 1 : 0,
        actor.id,
        actor.id,
        actor.id,
      )
      .run();
    const url = new URL(request.url);
    const query = querySchema.parse({
      category: url.searchParams.get("category") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const filters: string[] = [];
    const filterBindings: Array<string> = [];
    if (query.category !== "ALL") {
      filters.push("category = ?");
      filterBindings.push(query.category);
    }
    if (query.state === "UNREAD") filters.push("readAt IS NULL");
    if (query.state === "READ") filters.push("readAt IS NOT NULL");
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const categorized = `
      WITH categorized AS (
        SELECT id, kind, title, body,
               read_at AS readAt,
               action_url AS actionUrl,
               metadata_json AS metadataJson,
               created_at AS createdAt,
               ${categoryExpression} AS category
          FROM notifications
         WHERE user_id = ?
           AND (? = 1 OR kind <> 'TEAM_SUPPORT')
      )
    `;
    const [records, totalRow, unreadRow] = await Promise.all([
      env.DB.prepare(
        `${categorized}
         SELECT id, kind, title, body, readAt, actionUrl, metadataJson,
                createdAt, category
           FROM categorized
           ${where}
          ORDER BY datetime(createdAt) DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(
          actor.id,
          premiumEconomyPublic ? 1 : 0,
          ...filterBindings,
          query.pageSize,
          (query.page - 1) * query.pageSize,
        )
        .all(),
      env.DB.prepare(
        `${categorized}
         SELECT COUNT(*) AS count
           FROM categorized
           ${where}`,
      )
        .bind(actor.id, premiumEconomyPublic ? 1 : 0, ...filterBindings)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
           FROM notifications
          WHERE user_id = ?
            AND (? = 1 OR kind <> 'TEAM_SUPPORT')
            AND read_at IS NULL`,
      )
        .bind(actor.id, premiumEconomyPublic ? 1 : 0)
        .first<{ count: number }>(),
    ]);
    const total = Number(totalRow?.count ?? 0);
    const normalizedRecords = records.results.map((record) => {
      const row = record as Record<string, unknown>;
      const rawActionUrl =
        typeof row.actionUrl === "string" ? row.actionUrl.trim() : "";
      return {
        ...row,
        actionUrl:
          rawActionUrl.startsWith("/") && !rawActionUrl.startsWith("//")
            ? rawActionUrl
            : null,
      };
    });
    const slugs = [
      ...new Set(
        normalizedRecords
          .map((record) => seriesSlugForNotification(record))
          .filter((slug): slug is string => Boolean(slug)),
      ),
    ];
    const seriesRows = slugs.length
      ? await env.DB.prepare(
          `SELECT id, slug, title, cover_key AS coverKey, revision
             FROM series
            WHERE slug IN (${slugs.map(() => "?").join(", ")})
              AND is_published = 1
              AND archived_at IS NULL
              AND status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
              AND rights_status IN
                ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')`,
        )
          .bind(...slugs)
          .all<{
            id: string;
            slug: string;
            title: string;
            coverKey: string | null;
            revision: number;
          }>()
      : { results: [] };
    const seriesBySlug = new Map(
      seriesRows.results.map((series) => [
        series.slug,
        {
          id: series.id,
          slug: series.slug,
          title: series.title,
          coverUrl: seriesMediaUrl(
            series.id,
            "cover",
            series.coverKey,
            series.revision,
          ),
          coverRevision: Number(series.revision),
        },
      ]),
    );
    const data = normalizedRecords.map((record) => {
      const slug = seriesSlugForNotification(record);
      return {
        ...record,
        series: slug ? seriesBySlug.get(slug) ?? null : null,
      };
    });
    return json(
      requestId,
      {
        data,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
          hasPrevious: query.page > 1,
          hasNext: query.page * query.pageSize < total,
        },
        summary: {
          unreadCount: Number(unreadRow?.count ?? 0),
        },
      },
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

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Notifications are temporarily unavailable.",
      );
    }
    const payload = mutationSchema.parse(await request.json());
    const result =
      payload.action === "READ_ALL"
        ? await env.DB.prepare(
            `UPDATE notifications
                SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
              WHERE user_id = ? AND read_at IS NULL`,
          )
            .bind(actor.id)
            .run()
        : payload.action === "READ"
          ? await env.DB.prepare(
              `UPDATE notifications
                  SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
                WHERE id = ? AND user_id = ?`,
            )
              .bind(payload.id, actor.id)
              .run()
          : await env.DB.prepare(
              `UPDATE notifications
                  SET read_at = NULL
                WHERE id = ? AND user_id = ?`,
            )
              .bind(payload.id, actor.id)
              .run();
    return json(requestId, {
      ok: true,
      changed: Number(result.meta.changes ?? 0),
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
