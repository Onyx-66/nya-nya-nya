import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";
import { auditStatement } from "@/lib/server/admin-utils";
import {
  getCommercialSettingsDocument,
  requirePaidEconomyPublicDocument,
} from "@/lib/server/commercial-settings";
import type { Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { seriesMediaUrl } from "@/lib/server/series-media-url";

export type DiscountInput = {
  id?: string;
  revision?: number;
  targetType: "SERIES" | "CHAPTER";
  seriesId: string;
  chapterId: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  headline: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

type DiscountRow = {
  id: string;
  targetType: "SERIES" | "CHAPTER";
  seriesId: string;
  chapterId: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  originalPrice: number;
  reducedPrice: number;
  headline: string;
  startsAt: string;
  endsAt: string;
  active: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  seriesSlug: string;
  seriesTitle: string;
  genreLabel: string | null;
  coverKey: string | null;
  seriesRevision: number;
  chapterSlug: string | null;
  chapterNumber: string | null;
  chapterTitle: string | null;
  currentChapterPrice: number | null;
  eligibleChapterCount: number;
};

type ActiveDiscountRow = {
  id: string;
  targetType: "SERIES" | "CHAPTER";
  seriesId: string;
  chapterId: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  originalPrice: number;
  revision: number;
  startsAt: string;
  endsAt: string;
};

export type AppliedChapterDiscount = {
  basePriceOnyx: number;
  priceOnyx: number;
  discountId: string | null;
  discountRevision: number | null;
  discountTargetType: "SERIES" | "CHAPTER" | null;
  discountPercentage: number | null;
  discountEndsAt: string | null;
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Discount controls are temporarily unavailable.",
    );
  }
  return env.DB;
}

function statusForDiscount(row: Pick<DiscountRow, "active" | "startsAt" | "endsAt">) {
  if (!row.active) return "INACTIVE" as const;
  const now = Date.now();
  if (Date.parse(row.startsAt) > now) return "SCHEDULED" as const;
  if (Date.parse(row.endsAt) <= now) return "EXPIRED" as const;
  return "ACTIVE" as const;
}

function serializeDiscount(row: DiscountRow) {
  const percentage = Math.max(
    1,
    Math.min(
      99,
      Math.round(
        ((Number(row.originalPrice) - Number(row.reducedPrice)) /
          Number(row.originalPrice)) *
          100,
      ),
    ),
  );
  return {
    id: row.id,
    targetType: row.targetType,
    seriesId: row.seriesId,
    chapterId: row.chapterId,
    discountType: row.discountType,
    discountValue: Number(row.discountValue),
    originalPrice: Number(row.originalPrice),
    reducedPrice: Number(row.reducedPrice),
    headline: row.headline?.trim() ?? "",
    percentage,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    active: Boolean(row.active),
    status: statusForDiscount(row),
    revision: Number(row.revision),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    seriesSlug: row.seriesSlug,
    seriesTitle: row.seriesTitle,
    genreLabel: row.genreLabel?.trim() || (row.targetType === "SERIES" ? "FEATURED SERIES" : "PAID CHAPTER"),
    chapterSlug: row.chapterSlug,
    chapterNumber: row.chapterNumber,
    chapterTitle: row.chapterTitle,
    eligibleChapterCount: Math.max(1, Number(row.eligibleChapterCount ?? 1)),
    priceChanged:
      row.targetType === "CHAPTER" &&
      Number(row.currentChapterPrice) !== Number(row.originalPrice),
    targetLabel:
      row.targetType === "CHAPTER"
        ? `Chapter ${row.chapterNumber}${row.chapterTitle ? ` · ${row.chapterTitle}` : ""}`
        : `Paid chapters in ${row.seriesTitle}`,
    coverUrl: seriesMediaUrl(
      row.seriesId,
      "cover",
      row.coverKey,
      row.seriesRevision,
    ),
    href:
      row.targetType === "CHAPTER" && row.chapterSlug
        ? `/title/${row.seriesSlug}/chapter/${row.chapterSlug}`
        : `/title/${row.seriesSlug}`,
  };
}

const discountSelect = `
  SELECT discount.id, discount.target_type AS targetType,
         discount.series_id AS seriesId, discount.chapter_id AS chapterId,
         discount.discount_type AS discountType,
         discount.discount_value AS discountValue,
         discount.original_price AS originalPrice,
         discount.reduced_price AS reducedPrice,
         discount.headline AS headline,
         discount.starts_at AS startsAt, discount.ends_at AS endsAt,
         discount.is_active AS active, discount.revision,
         discount.created_at AS createdAt, discount.updated_at AS updatedAt,
         s.slug AS seriesSlug, s.title AS seriesTitle,
         (SELECT g.name FROM series_genres sg JOIN genres g ON g.id = sg.genre_id
           WHERE sg.series_id = s.id AND g.archived_at IS NULL
           ORDER BY g.name COLLATE NOCASE LIMIT 1) AS genreLabel,
         s.cover_key AS coverKey, s.revision AS seriesRevision,
         c.slug AS chapterSlug, c.chapter_number AS chapterNumber,
         c.title AS chapterTitle, c.price_onyx AS currentChapterPrice,
         CASE
           WHEN discount.target_type = 'CHAPTER' THEN 1
           ELSE (
             SELECT COUNT(1)
               FROM chapters eligible_chapter_count
              WHERE eligible_chapter_count.series_id = discount.series_id
                AND eligible_chapter_count.access_type = 'PAID'
                AND eligible_chapter_count.price_onyx > 0
                AND eligible_chapter_count.state = 'PUBLISHED'
                AND eligible_chapter_count.visibility = 'PUBLIC'
                AND eligible_chapter_count.published_at IS NOT NULL
                AND datetime(eligible_chapter_count.published_at) <= datetime('now')
           )
         END AS eligibleChapterCount
    FROM content_discounts discount
    JOIN series s ON s.id = discount.series_id
    LEFT JOIN chapters c ON c.id = discount.chapter_id`;

export async function listPublicDiscounts(sort: "discount" | "expiry") {
  await requirePaidEconomyPublicDocument();
  const order =
    sort === "expiry"
      ? "datetime(discount.ends_at), discount.id"
      : "(discount.original_price - discount.reduced_price) * 1.0 / discount.original_price DESC, datetime(discount.ends_at), discount.id";
  const rows = await database()
    .prepare(
      `${discountSelect}
       WHERE discount.is_active = 1
         AND datetime(discount.starts_at) <= datetime('now')
         AND datetime(discount.ends_at) > datetime('now')
         AND s.is_published = 1 AND s.archived_at IS NULL
         AND (discount.target_type = 'SERIES' OR (
           c.state = 'PUBLISHED' AND c.visibility = 'PUBLIC'
           AND datetime(c.published_at) <= datetime('now')
           AND c.price_onyx = discount.original_price
         ))
         AND (discount.target_type = 'CHAPTER' OR EXISTS (
           SELECT 1 FROM chapters eligible_chapter
            WHERE eligible_chapter.series_id = discount.series_id
              AND eligible_chapter.access_type = 'PAID'
              AND eligible_chapter.price_onyx > CASE
                WHEN discount.discount_type = 'FIXED'
                  THEN discount.discount_value
                ELSE 0
              END
              AND eligible_chapter.state = 'PUBLISHED'
              AND eligible_chapter.visibility = 'PUBLIC'
              AND datetime(eligible_chapter.published_at) <= datetime('now')
         ))
       ORDER BY ${order}
       LIMIT 60`,
    )
    .all<DiscountRow>();
  return rows.results.map(serializeDiscount);
}

export async function listAdminDiscounts(query = "") {
  const db = database();
  const normalized = query.trim().toLowerCase();
  const escaped = `%${normalized.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [discounts, targets, commercial] = await Promise.all([
    db
      .prepare(
        `${discountSelect}
         ORDER BY datetime(discount.ends_at) DESC, discount.id DESC`,
      )
      .all<DiscountRow>(),
    db
      .prepare(
        `SELECT 'SERIES' AS targetType, s.id AS seriesId, NULL AS chapterId,
                s.slug AS seriesSlug, s.title AS seriesTitle,
                NULL AS chapterSlug, NULL AS chapterNumber,
                NULL AS chapterTitle, s.cover_key AS coverKey,
                s.revision AS seriesRevision, NULL AS chapterPrice
           FROM series s
          WHERE s.archived_at IS NULL AND s.is_published = 1
            AND (? = '' OR LOWER(s.title) LIKE ? ESCAPE '\\')
         UNION ALL
         SELECT 'CHAPTER' AS targetType, s.id AS seriesId, c.id AS chapterId,
                s.slug AS seriesSlug, s.title AS seriesTitle,
                c.slug AS chapterSlug, c.chapter_number AS chapterNumber,
                c.title AS chapterTitle, s.cover_key AS coverKey,
                s.revision AS seriesRevision, c.price_onyx AS chapterPrice
           FROM chapters c
           JOIN series s ON s.id = c.series_id
          WHERE s.archived_at IS NULL AND s.is_published = 1
            AND c.access_type = 'PAID' AND c.price_onyx > 0
            AND c.state = 'PUBLISHED'
            AND (? = '' OR LOWER(s.title) LIKE ? ESCAPE '\\'
                 OR LOWER(c.chapter_number) LIKE ? ESCAPE '\\'
                 OR LOWER(c.title) LIKE ? ESCAPE '\\')
          ORDER BY seriesTitle COLLATE NOCASE, targetType DESC, chapterNumber
          LIMIT 80`,
      )
      .bind(normalized, escaped, normalized, escaped, escaped, escaped)
      .all<{
        targetType: "SERIES" | "CHAPTER";
        seriesId: string;
        chapterId: string | null;
        seriesSlug: string;
        seriesTitle: string;
        chapterSlug: string | null;
        chapterNumber: string | null;
        chapterTitle: string | null;
        coverKey: string | null;
        seriesRevision: number;
        chapterPrice: number | null;
      }>(),
    getCommercialSettingsDocument(),
  ]);
  return {
    discounts: discounts.results.map(serializeDiscount),
    targets: targets.results.map((target) => ({
      ...target,
      originalPrice:
        target.targetType === "CHAPTER"
          ? Number(target.chapterPrice ?? 0)
          : commercial.settings.economy.defaultChapterPrice,
      coverUrl: seriesMediaUrl(
        target.seriesId,
        "cover",
        target.coverKey,
        target.seriesRevision,
      ),
    })),
    paidSystemEnabled:
      commercial.settings.economy.premiumEconomyPublic &&
      !commercial.recoveredFromInvalid,
  };
}

async function priceForTarget(input: DiscountInput) {
  const db = database();
  if (input.targetType === "CHAPTER") {
    if (!input.chapterId) {
      throw new ApiError(422, "CHAPTER_REQUIRED", "Select a paid chapter.");
    }
    const chapter = await db
      .prepare(
        `SELECT c.price_onyx AS price, c.series_id AS seriesId
           FROM chapters c
           JOIN series s ON s.id = c.series_id
          WHERE c.id = ? AND c.series_id = ?
            AND c.access_type = 'PAID' AND c.price_onyx > 0
            AND c.state = 'PUBLISHED' AND s.archived_at IS NULL
          LIMIT 1`,
      )
      .bind(input.chapterId, input.seriesId)
      .first<{ price: number; seriesId: string }>();
    if (!chapter) {
      throw new ApiError(
        409,
        "DISCOUNT_TARGET_CHANGED",
        "The selected chapter is no longer a published paid chapter.",
      );
    }
    return Number(chapter.price);
  }
  const series = await db
    .prepare(
      "SELECT id FROM series WHERE id = ? AND archived_at IS NULL AND is_published = 1 LIMIT 1",
    )
    .bind(input.seriesId)
    .first();
  if (!series) {
    throw new ApiError(
      409,
      "DISCOUNT_TARGET_CHANGED",
      "The selected series is no longer published.",
    );
  }
  const commercial = await getCommercialSettingsDocument();
  const price = commercial.settings.economy.defaultChapterPrice;
  if (price <= 0) {
    throw new ApiError(
      409,
      "CHAPTER_PRICE_UNAVAILABLE",
      "Configure a positive default chapter price before scheduling a series-wide chapter discount.",
    );
  }
  return price;
}

function calculateEffectivePrice(basePrice: number, discount: ActiveDiscountRow) {
  if (!Number.isSafeInteger(basePrice) || basePrice <= 0) return null;
  if (
    discount.targetType === "CHAPTER" &&
    Number(discount.originalPrice) !== basePrice
  ) {
    return null;
  }
  const candidate =
    discount.discountType === "PERCENT"
      ? Math.max(
          1,
          Math.floor(
            (basePrice * (100 - Number(discount.discountValue))) / 100,
          ),
        )
      : Number(discount.discountValue);
  if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate >= basePrice) {
    return null;
  }
  return candidate;
}

function appliedDiscount(
  basePrice: number,
  discounts: ActiveDiscountRow[],
): AppliedChapterDiscount {
  const candidates = discounts
    .map((discount) => ({
      discount,
      price: calculateEffectivePrice(basePrice, discount),
    }))
    .filter(
      (candidate): candidate is { discount: ActiveDiscountRow; price: number } =>
        candidate.price !== null,
    )
    .sort(
      (left, right) =>
        left.price - right.price ||
        Number(right.discount.targetType === "CHAPTER") -
          Number(left.discount.targetType === "CHAPTER") ||
        left.discount.id.localeCompare(right.discount.id),
    );
  const selected = candidates[0];
  if (!selected) {
    return {
      basePriceOnyx: basePrice,
      priceOnyx: basePrice,
      discountId: null,
      discountRevision: null,
      discountTargetType: null,
      discountPercentage: null,
      discountEndsAt: null,
    };
  }
  return {
    basePriceOnyx: basePrice,
    priceOnyx: selected.price,
    discountId: selected.discount.id,
    discountRevision: Number(selected.discount.revision),
    discountTargetType: selected.discount.targetType,
    discountPercentage: Math.max(
      1,
      Math.min(99, Math.round(((basePrice - selected.price) / basePrice) * 100)),
    ),
    discountEndsAt: selected.discount.endsAt,
  };
}

async function activeDiscountRows(seriesId: string) {
  const rows = await database()
    .prepare(
      `SELECT id, target_type AS targetType, series_id AS seriesId,
              chapter_id AS chapterId, discount_type AS discountType,
              discount_value AS discountValue, original_price AS originalPrice,
              revision, starts_at AS startsAt, ends_at AS endsAt
         FROM content_discounts
        WHERE series_id = ? AND is_active = 1
          AND datetime(starts_at) <= datetime('now')
          AND datetime(ends_at) > datetime('now')
        ORDER BY target_type DESC, id`,
    )
    .bind(seriesId)
    .all<ActiveDiscountRow>();
  return rows.results;
}

export async function resolveActiveChapterDiscount(
  seriesId: string,
  chapterId: string,
  basePrice: number,
) {
  if (basePrice <= 0) return appliedDiscount(basePrice, []);
  const rows = await activeDiscountRows(seriesId);
  return appliedDiscount(
    basePrice,
    rows.filter(
      (discount) =>
        discount.targetType === "SERIES" || discount.chapterId === chapterId,
    ),
  );
}

export async function resolveSeriesChapterDiscounts(
  seriesId: string,
  chapters: Array<{ chapterId: string; basePrice: number }>,
) {
  const rows = chapters.some((chapter) => chapter.basePrice > 0)
    ? await activeDiscountRows(seriesId)
    : [];
  return new Map(
    chapters.map((chapter) => [
      chapter.chapterId,
      appliedDiscount(
        chapter.basePrice,
        rows.filter(
          (discount) =>
            discount.targetType === "SERIES" ||
            discount.chapterId === chapter.chapterId,
        ),
      ),
    ]),
  );
}

/**
 * SQL guard used inside the unlock batch. Bind, in order: discount id,
 * revision, the effective price shown to the buyer, and that price again for
 * the lowest-active-offer check.
 */
export function activeChapterDiscountGuardSql() {
  return `EXISTS (
    SELECT 1
      FROM content_discounts live_discount
     WHERE live_discount.id = ?
       AND live_discount.revision = ?
       AND live_discount.is_active = 1
       AND datetime(live_discount.starts_at) <= datetime('now')
       AND datetime(live_discount.ends_at) > datetime('now')
       AND live_discount.series_id = current_chapter.series_id
       AND (
         live_discount.target_type = 'SERIES'
         OR (
           live_discount.target_type = 'CHAPTER'
           AND live_discount.chapter_id = current_chapter.id
           AND live_discount.original_price = current_chapter.price_onyx
         )
       )
       AND CASE
             WHEN live_discount.discount_type = 'PERCENT'
               THEN MAX(
                 1,
                 CAST(
                   current_chapter.price_onyx *
                   (100 - live_discount.discount_value) / 100 AS INTEGER
                 )
               )
             ELSE live_discount.discount_value
           END = ?
       AND NOT EXISTS (
         SELECT 1
           FROM content_discounts competing_discount
          WHERE competing_discount.id <> live_discount.id
            AND competing_discount.is_active = 1
            AND datetime(competing_discount.starts_at) <= datetime('now')
            AND datetime(competing_discount.ends_at) > datetime('now')
            AND competing_discount.series_id = current_chapter.series_id
            AND (
              competing_discount.target_type = 'SERIES'
              OR (
                competing_discount.target_type = 'CHAPTER'
                AND competing_discount.chapter_id = current_chapter.id
                AND competing_discount.original_price = current_chapter.price_onyx
              )
            )
            AND CASE
                  WHEN competing_discount.discount_type = 'PERCENT'
                    THEN MAX(
                      1,
                      CAST(
                        current_chapter.price_onyx *
                        (100 - competing_discount.discount_value) / 100 AS INTEGER
                      )
                    )
                  ELSE competing_discount.discount_value
                END < ?
       )
  )`;
}

/**
 * Prevents charging the undiscounted price if an eligible offer becomes
 * active after access resolution but before the unlock transaction commits.
 */
export function noActiveChapterDiscountGuardSql() {
  return `NOT EXISTS (
    SELECT 1
      FROM content_discounts live_discount
     WHERE live_discount.is_active = 1
       AND datetime(live_discount.starts_at) <= datetime('now')
       AND datetime(live_discount.ends_at) > datetime('now')
       AND live_discount.series_id = current_chapter.series_id
       AND (
         live_discount.target_type = 'SERIES'
         OR (
           live_discount.target_type = 'CHAPTER'
           AND live_discount.chapter_id = current_chapter.id
           AND live_discount.original_price = current_chapter.price_onyx
         )
       )
       AND CASE
             WHEN live_discount.discount_type = 'PERCENT'
               THEN MAX(
                 1,
                 CAST(
                   current_chapter.price_onyx *
                   (100 - live_discount.discount_value) / 100 AS INTEGER
                 )
               )
             ELSE live_discount.discount_value
           END < current_chapter.price_onyx
  )`;
}

export async function saveDiscount(
  input: DiscountInput,
  actor: Actor,
  requestId: string,
) {
  const db = database();
  const originalPrice = await priceForTarget(input);
  const reducedPrice =
    input.discountType === "PERCENT"
      ? Math.max(
          1,
          Math.floor((originalPrice * (100 - input.discountValue)) / 100),
        )
      : input.discountValue;
  if (reducedPrice < 0 || reducedPrice >= originalPrice) {
    throw new ApiError(
      422,
      "DISCOUNT_PRICE_INVALID",
      "The reduced price must be lower than the current original price.",
    );
  }
  const overlap = await db
    .prepare(
      `SELECT id FROM content_discounts
        WHERE is_active = 1 AND id <> ?
          AND target_type = ? AND series_id = ?
          AND COALESCE(chapter_id, '') = COALESCE(?, '')
          AND datetime(starts_at) < datetime(?)
          AND datetime(ends_at) > datetime(?)
        LIMIT 1`,
    )
    .bind(
      input.id ?? "",
      input.targetType,
      input.seriesId,
      input.chapterId,
      input.endsAt,
      input.startsAt,
    )
    .first();
  if (overlap && input.active) {
    throw new ApiError(
      409,
      "DISCOUNT_SCHEDULE_CONFLICT",
      "This content already has an overlapping active discount.",
    );
  }

  if (input.id) {
    const result = await db.batch([
      db
        .prepare(
          `UPDATE content_discounts
              SET target_type = ?, series_id = ?, chapter_id = ?,
                  discount_type = ?, discount_value = ?, original_price = ?,
                  reduced_price = ?, headline = ?, starts_at = ?, ends_at = ?, is_active = ?,
                  revision = revision + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revision = ?`,
        )
        .bind(
          input.targetType,
          input.seriesId,
          input.chapterId,
          input.discountType,
          input.discountValue,
          originalPrice,
          reducedPrice,
          input.headline.trim(),
          input.startsAt,
          input.endsAt,
          input.active ? 1 : 0,
          input.id,
          input.revision,
        ),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: "content.discount.update",
          category: "COMMERCE_STORE",
          sourceArea: "DISCOUNTS",
          targetType: "CONTENT_DISCOUNT",
          targetId: input.id,
          targetLabel: input.targetType,
          metadata: { originalPrice, reducedPrice, active: input.active },
        },
        "changes() = 1",
      ),
    ]);
    if (!result[0]?.meta.changes) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this discount. Reload and try again.",
      );
    }
  } else {
    const id = `discount_${randomId()}`;
    await db.batch([
      db
        .prepare(
          `INSERT INTO content_discounts
           (id, target_type, series_id, chapter_id, discount_type,
            discount_value, original_price, reduced_price, headline, starts_at,
            ends_at, is_active, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.targetType,
          input.seriesId,
          input.chapterId,
          input.discountType,
          input.discountValue,
          originalPrice,
          reducedPrice,
          input.headline.trim(),
          input.startsAt,
          input.endsAt,
          input.active ? 1 : 0,
          actor.id,
        ),
      auditStatement(db, actor, requestId, {
        action: "content.discount.create",
        category: "COMMERCE_STORE",
        sourceArea: "DISCOUNTS",
        targetType: "CONTENT_DISCOUNT",
        targetId: id,
        targetLabel: input.targetType,
        metadata: { originalPrice, reducedPrice, active: input.active },
      }),
    ]);
  }
  return listAdminDiscounts();
}

export async function deleteDiscount(
  id: string,
  revision: number,
  actor: Actor,
  requestId: string,
) {
  const db = database();
  const result = await db.batch([
    db
      .prepare("DELETE FROM content_discounts WHERE id = ? AND revision = ?")
      .bind(id, revision),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "content.discount.delete",
        category: "COMMERCE_STORE",
        sourceArea: "DISCOUNTS",
        targetType: "CONTENT_DISCOUNT",
        targetId: id,
        targetLabel: "Content discount",
      },
      "changes() = 1",
    ),
  ]);
  if (!result[0]?.meta.changes) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "This discount changed or was already removed.",
    );
  }
  return listAdminDiscounts();
}
