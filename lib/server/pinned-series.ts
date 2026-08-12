import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";
import { auditStatement } from "@/lib/server/admin-utils";
import type { Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { seriesMediaUrl } from "@/lib/server/series-media-url";
import {
  publicPaidChapterPredicate,
  publicPaidSeriesPredicate,
} from "@/lib/server/public-content-visibility";

export type PinnedSeriesInput = {
  id?: string;
  seriesId: string;
  featured: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

const MAX_ACTIVE_PINNED_SERIES = 9;

type PinnedSeriesRow = {
  id: string;
  seriesId: string;
  displayOrder: number;
  featured: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
  slug: string;
  title: string;
  nativeTitle: string | null;
  synopsis: string;
  type: string;
  status: string;
  coverKey: string | null;
  bannerKey: string | null;
  revision: number;
  chapterCount: number;
};

const pinnedSeriesCollectionKey = "pinned-series";

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Pinned Series is temporarily unavailable.",
    );
  }
  return env.DB;
}

function statusForSchedule(startsAt: string | null, endsAt: string | null) {
  const now = Date.now();
  const starts = startsAt ? Date.parse(startsAt) : Number.NEGATIVE_INFINITY;
  const ends = endsAt ? Date.parse(endsAt) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(starts) && starts > now) return "SCHEDULED" as const;
  if (Number.isFinite(ends) && ends <= now) return "EXPIRED" as const;
  return "ACTIVE" as const;
}

function serializePinnedSeries(row: PinnedSeriesRow) {
  return {
    id: row.id,
    seriesId: row.seriesId,
    displayOrder: Number(row.displayOrder),
    featured: Boolean(row.featured),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    scheduleStatus: statusForSchedule(row.startsAt, row.endsAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    slug: row.slug,
    title: row.title,
    nativeTitle: row.nativeTitle,
    synopsis: row.synopsis,
    type: row.type,
    status: row.status,
    chapterCount: Number(row.chapterCount),
    coverUrl: seriesMediaUrl(
      row.seriesId,
      "cover",
      row.coverKey,
      row.revision,
    ),
    bannerUrl: seriesMediaUrl(
      row.seriesId,
      "banner",
      row.bannerKey,
      row.revision,
    ),
    href: `/title/${row.slug}`,
  };
}

function pinnedSelect(chapterVisibilityPredicate = "") {
  return `
  SELECT pin.id, pin.series_id AS seriesId,
         pin.display_order AS displayOrder,
         pin.is_featured AS featured,
         pin.starts_at AS startsAt, pin.ends_at AS endsAt,
         pin.created_at AS createdAt, pin.updated_at AS updatedAt,
         s.slug, s.title, s.native_title AS nativeTitle,
         s.synopsis, s.type, s.status, s.cover_key AS coverKey,
         s.banner_key AS bannerKey, s.revision,
         COUNT(DISTINCT CASE
           WHEN c.state = 'PUBLISHED' AND c.visibility = 'PUBLIC'
             AND datetime(c.published_at) <= datetime('now')
             ${chapterVisibilityPredicate} THEN c.id
         END) AS chapterCount
    FROM home_pinned_series pin
    JOIN series s ON s.id = pin.series_id
    LEFT JOIN chapters c ON c.series_id = s.id
    LEFT JOIN content_visibility_overrides visibility_override
      ON visibility_override.chapter_id = c.id`;
}

export async function listPublicPinnedSeries() {
  const rows = await database()
    .prepare(
      `${pinnedSelect(`AND ${publicPaidChapterPredicate("c", "visibility_override")}`)}
       WHERE s.is_published = 1
         AND s.archived_at IS NULL
         AND ${publicPaidSeriesPredicate("s")}
         AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
         AND s.rights_status IN ('LICENSED','AUTHORIZED','DEMO_ORIGINAL','TEST_ORIGINAL')
         AND pin.is_featured = 1
         AND (pin.starts_at IS NULL OR datetime(pin.starts_at) <= datetime('now'))
         AND (pin.ends_at IS NULL OR datetime(pin.ends_at) > datetime('now'))
       GROUP BY pin.id, s.id
       ORDER BY pin.display_order, datetime(pin.created_at), pin.id
       LIMIT ${MAX_ACTIVE_PINNED_SERIES}`,
    )
    .all<PinnedSeriesRow>();
  return rows.results.map(serializePinnedSeries);
}

export async function listAdminPinnedSeries(query = "") {
  const db = database();
  const normalized = query.trim().toLowerCase();
  const [pins, series, state] = await Promise.all([
    db
      .prepare(
        `${pinnedSelect()}
         WHERE s.archived_at IS NULL
         GROUP BY pin.id, s.id
         ORDER BY pin.display_order, datetime(pin.created_at), pin.id`,
      )
      .all<PinnedSeriesRow>(),
    db
      .prepare(
        `SELECT s.id, s.slug, s.title, s.type, s.status,
                s.cover_key AS coverKey, s.revision
           FROM series s
          WHERE s.archived_at IS NULL
            AND s.is_published = 1
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
            AND (? = '' OR LOWER(s.title) LIKE ? ESCAPE '\\'
                 OR LOWER(COALESCE(s.native_title, '')) LIKE ? ESCAPE '\\')
          ORDER BY s.title COLLATE NOCASE
          LIMIT 30`,
      )
      .bind(
        normalized,
        `%${normalized.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
        `%${normalized.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
      )
      .all<{
        id: string;
        slug: string;
        title: string;
        type: string;
        status: string;
        coverKey: string | null;
        revision: number;
      }>(),
    db
      .prepare(
        `SELECT revision
           FROM home_pinned_series_state
          WHERE collection_key = ?
          LIMIT 1`,
      )
      .bind(pinnedSeriesCollectionKey)
      .first<{ revision: number }>(),
  ]);
  if (!state) {
    throw new ApiError(
      503,
      "PINNED_SERIES_STATE_UNAVAILABLE",
      "Pinned Series revision state is unavailable.",
    );
  }
  return {
    revision: Number(state.revision),
    pins: pins.results.map(serializePinnedSeries),
    series: series.results.map((record) => ({
      ...record,
      coverUrl: seriesMediaUrl(
        record.id,
        "cover",
        record.coverKey,
        record.revision,
      ),
    })),
  };
}

export async function replacePinnedSeries(
  items: PinnedSeriesInput[],
  expectedRevision: number,
  actor: Actor,
  requestId: string,
) {
  const db = database();
  const seriesIds = [...new Set(items.map((item) => item.seriesId))];
  if (seriesIds.length !== items.length) {
    throw new ApiError(
      409,
      "DUPLICATE_PIN",
      "Each series can appear only once in Pinned Series.",
    );
  }
  const now = Date.now();
  const futureStartTimes = items
    .map((item) => (item.startsAt ? Date.parse(item.startsAt) : now))
    .filter((value) => Number.isFinite(value) && value >= now);
  const concurrencyCheckpoints = [...new Set([now, ...futureStartTimes])];
  const maximumConcurrentPins = concurrencyCheckpoints.reduce(
    (maximum, checkpoint) => {
      const concurrent = items.filter((item) => {
        const startsAt = item.startsAt
          ? Date.parse(item.startsAt)
          : Number.NEGATIVE_INFINITY;
        const endsAt = item.endsAt
          ? Date.parse(item.endsAt)
          : Number.POSITIVE_INFINITY;
        return startsAt <= checkpoint && checkpoint < endsAt;
      }).length;
      return Math.max(maximum, concurrent);
    },
    0,
  );
  if (maximumConcurrentPins > MAX_ACTIVE_PINNED_SERIES) {
    throw new ApiError(
      422,
      "ACTIVE_PIN_LIMIT_REACHED",
      `No more than ${MAX_ACTIVE_PINNED_SERIES} Pinned Series can be active at the same time. Adjust the schedule or remove a pin.`,
    );
  }
  if (seriesIds.length) {
    const placeholders = seriesIds.map(() => "?").join(", ");
    const available = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM series
          WHERE id IN (${placeholders})
            AND archived_at IS NULL
            AND is_published = 1
            AND status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')`,
      )
      .bind(...seriesIds)
      .first<{ count: number }>();
    if (Number(available?.count ?? 0) !== seriesIds.length) {
      throw new ApiError(
        409,
        "PINNED_SERIES_CHANGED",
        "One selected series is no longer available for the homepage.",
      );
    }
  }

  const nextRevision = expectedRevision + 1;
  const mutationMarker = randomId();
  const collectionGuard = `EXISTS (
    SELECT 1 FROM home_pinned_series_state
     WHERE collection_key = ? AND revision = ? AND mutation_marker = ?
  )`;
  const statements = [
    db
      .prepare(
        `UPDATE home_pinned_series_state
            SET revision = revision + 1,
                mutation_marker = ?,
                updated_by_user_id = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE collection_key = ? AND revision = ?`,
      )
      .bind(
        mutationMarker,
        actor.id,
        pinnedSeriesCollectionKey,
        expectedRevision,
      ),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "homepage.pinned-series.replace",
        category: "APPEARANCE_SETTINGS",
        sourceArea: "PINNED_SERIES",
        targetType: "HOMEPAGE_COLLECTION",
        targetId: pinnedSeriesCollectionKey,
        targetLabel: "Pinned Series",
        metadata: {
          count: items.length,
          featuredCount: items.length,
          maximumConcurrentPins,
          previousRevision: expectedRevision,
          revision: nextRevision,
        },
      },
      "changes() = 1",
    ),
    db
      .prepare(
        `DELETE FROM home_pinned_series
          WHERE ${collectionGuard}`,
      )
      .bind(pinnedSeriesCollectionKey, nextRevision, mutationMarker),
  ];
  items.forEach((item, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO home_pinned_series
           (id, series_id, display_order, is_featured, starts_at, ends_at,
            created_by_user_id)
           SELECT ?, ?, ?, ?, ?, ?, ?
            WHERE ${collectionGuard}`,
        )
        .bind(
          item.id?.startsWith("pin_") ? item.id : `pin_${randomId()}`,
          item.seriesId,
          index,
          1,
          item.startsAt,
          item.endsAt,
          actor.id,
          pinnedSeriesCollectionKey,
          nextRevision,
          mutationMarker,
        ),
    );
  });
  const results = await db.batch(statements);
  if (!results[0]?.meta.changes) {
    throw new ApiError(
      409,
      "PINNED_SERIES_STALE",
      "Another administrator changed Pinned Series. Reload the latest collection before saving again.",
    );
  }
  return listAdminPinnedSeries();
}
