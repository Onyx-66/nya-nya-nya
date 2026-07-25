import { env } from "cloudflare:workers";
import { z } from "zod";
import { slugSchema } from "@/lib/admin-metadata";
import {
  commerceEffectiveLifecycle,
  commerceEffectiveLifecycleSql,
} from "@/lib/commerce-lifecycle";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdmin } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const nullableDate = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .default(null);

const offerSchema = z
  .object({
    id: z.string().trim().min(3).max(160).optional(),
    revision: z.coerce.number().int().min(1).optional(),
    slug: slugSchema,
    kind: z.enum([
      "CURRENCY_PACKAGE",
      "MEMBERSHIP",
      "PROMOTION",
      "BUNDLE",
      "OTHER",
    ]),
    name: z.string().trim().min(2).max(120),
    shortDescription: z.string().trim().min(2).max(240),
    detailedDescription: z.string().trim().min(2).max(4_000),
    priceMinor: z.coerce.number().int().min(0).max(100_000_000),
    billingCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    onyxBase: z.coerce.number().int().min(0).max(10_000_000),
    onyxBonus: z.coerce.number().int().min(0).max(10_000_000),
    benefits: z.array(z.string().trim().min(1).max(160)).max(30),
    discountPercent: z.coerce.number().int().min(0).max(100),
    promotionalBadge: z.string().trim().max(80),
    startsAt: nullableDate,
    endsAt: nullableDate,
    lifecycleStatus: z.enum([
      "DRAFT",
      "SCHEDULED",
      "ACTIVE",
      "EXPIRED",
      "HIDDEN",
      "ARCHIVED",
    ]),
    isFeatured: z.boolean(),
    sortOrder: z.coerce.number().int().min(0).max(10_000),
    ctaText: z.string().trim().min(1).max(80),
    altText: z.string().trim().min(2).max(240),
    themeKey: z.enum(["OCEAN", "ONYX", "AURORA", "SUNSET", "MINIMAL"]),
    metadata: z.record(z.string().max(80), z.unknown()).default({}),
  })
  .superRefine((value, context) => {
    if (
      value.startsAt &&
      value.endsAt &&
      Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The end date must be after the start date.",
      });
    }
    if (
      value.lifecycleStatus === "SCHEDULED" &&
      (!value.startsAt || Date.parse(value.startsAt) <= Date.now())
    ) {
      context.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "Scheduled offers need a future start date.",
      });
    }
    if (value.kind === "CURRENCY_PACKAGE" && value.onyxBase <= 0) {
      context.addIssue({
        code: "custom",
        path: ["onyxBase"],
        message: "Coin packages need a base coin amount.",
      });
    }
    if (value.kind === "MEMBERSHIP") {
      const annualPrice = Number(value.metadata.annualPriceMinor ?? 0);
      const monthlyCoins = Number(value.metadata.monthlyCoins ?? 0);
      if (
        !Number.isInteger(annualPrice) ||
        annualPrice < 0 ||
        annualPrice > 100_000_000
      ) {
        context.addIssue({
          code: "custom",
          path: ["metadata", "annualPriceMinor"],
          message: "Annual price must be a valid non-negative minor-unit amount.",
        });
      }
      if (
        !Number.isInteger(monthlyCoins) ||
        monthlyCoins < 0 ||
        monthlyCoins > 10_000_000
      ) {
        context.addIssue({
          code: "custom",
          path: ["metadata", "monthlyCoins"],
          message: "Monthly coins must be a valid non-negative amount.",
        });
      }
    }
  });

type OfferRow = {
  id: string;
  slug: string;
  kind: string;
  name: string;
  shortDescription: string;
  detailedDescription: string;
  priceMinor: number;
  billingCurrency: string;
  onyxBase: number;
  onyxBonus: number;
  benefitsJson: string;
  discountPercent: number;
  promotionalBadge: string;
  startsAt: string | null;
  endsAt: string | null;
  lifecycleStatus: string;
  isFeatured: number;
  sortOrder: number;
  ctaText: string;
  altText: string;
  themeKey: string;
  primaryImageKey: string | null;
  bannerImageKey: string | null;
  iconImageKey: string | null;
  metadataJson: string;
  archivedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  purchaseCount: number;
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Commerce management is temporarily unavailable.",
    );
  }
  return env.DB;
}

function parseJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function mediaUrl(
  id: string,
  role: "primary" | "banner" | "icon",
  key: string | null,
  revision: number,
) {
  return key
    ? `/api/v1/commerce-media?id=${encodeURIComponent(id)}&role=${role}&v=${revision}`
    : null;
}

function mapOffer(row: OfferRow) {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    name: row.name,
    shortDescription: row.shortDescription,
    detailedDescription: row.detailedDescription,
    priceMinor: Number(row.priceMinor),
    billingCurrency: row.billingCurrency,
    onyxBase: Number(row.onyxBase),
    onyxBonus: Number(row.onyxBonus),
    benefits: parseJson(row.benefitsJson, []),
    discountPercent: Number(row.discountPercent),
    promotionalBadge: row.promotionalBadge,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    lifecycleStatus: row.lifecycleStatus,
    effectiveLifecycle: commerceEffectiveLifecycle(row),
    isFeatured: Boolean(row.isFeatured),
    sortOrder: Number(row.sortOrder),
    ctaText: row.ctaText,
    altText: row.altText,
    themeKey: row.themeKey,
    media: {
      primary: mediaUrl(
        row.id,
        "primary",
        row.primaryImageKey,
        row.revision,
      ),
      banner: mediaUrl(
        row.id,
        "banner",
        row.bannerImageKey,
        row.revision,
      ),
      icon: mediaUrl(row.id, "icon", row.iconImageKey, row.revision),
    },
    metadata: parseJson(row.metadataJson, {}),
    archivedAt: row.archivedAt,
    revision: Number(row.revision),
    purchaseCount: Number(row.purchaseCount),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const offerSelect = `
  SELECT p.id, p.slug, p.kind, p.name,
         p.short_description AS shortDescription,
         p.detailed_description AS detailedDescription,
         p.price_minor AS priceMinor,
         p.billing_currency AS billingCurrency,
         p.onyx_base AS onyxBase, p.onyx_bonus AS onyxBonus,
         p.benefits_json AS benefitsJson,
         p.discount_percent AS discountPercent,
         p.promotional_badge AS promotionalBadge,
         p.starts_at AS startsAt, p.ends_at AS endsAt,
         p.lifecycle_status AS lifecycleStatus,
         p.is_featured AS isFeatured, p.sort_order AS sortOrder,
         p.cta_text AS ctaText, p.alt_text AS altText,
         p.theme_key AS themeKey,
         p.primary_image_key AS primaryImageKey,
         p.banner_image_key AS bannerImageKey,
         p.icon_image_key AS iconImageKey,
         p.metadata_json AS metadataJson,
         p.archived_at AS archivedAt, p.revision,
         p.created_at AS createdAt, p.updated_at AS updatedAt,
         (SELECT COUNT(*) FROM order_items oi
           WHERE oi.product_id = p.id) AS purchaseCount
  FROM products p
`;

async function getOffer(id: string) {
  const row = await database()
    .prepare(`${offerSelect} WHERE p.id = ? LIMIT 1`)
    .bind(id)
    .first<OfferRow>();
  if (!row) {
    throw new ApiError(
      404,
      "OFFER_NOT_FOUND",
      "This commerce offer no longer exists.",
    );
  }
  return mapOffer(row);
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdmin(actor);
    const db = database();
    const url = new URL(request.url);
    const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
    const kind = z
      .enum([
        "ALL",
        "CURRENCY_PACKAGE",
        "MEMBERSHIP",
        "PROMOTION",
        "BUNDLE",
        "OTHER",
      ])
      .catch("ALL")
      .parse(url.searchParams.get("kind"));
    const status = z
      .enum([
        "ALL",
        "DRAFT",
        "SCHEDULED",
        "ACTIVE",
        "EXPIRED",
        "HIDDEN",
        "ARCHIVED",
      ])
      .catch("ALL")
      .parse(url.searchParams.get("status"));
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .catch(1)
      .parse(url.searchParams.get("page"));
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .catch(30)
      .parse(url.searchParams.get("limit"));
    const term = `%${query}%`;
    const rows = await db
      .prepare(
        `${offerSelect}
         WHERE (? = '%%' OR LOWER(p.name) LIKE ? OR p.slug LIKE ?)
           AND (? = 'ALL' OR p.kind = ?)
           AND (? = 'ALL' OR (${commerceEffectiveLifecycleSql}) = ?)
         ORDER BY p.archived_at IS NOT NULL, p.sort_order, p.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(
        term,
        term,
        term,
        kind,
        kind,
        status,
        status,
        limit,
        (page - 1) * limit,
      )
      .all<OfferRow>();
    const count = await db
      .prepare(
        `SELECT COUNT(*) AS count FROM products p
         WHERE (? = '%%' OR LOWER(p.name) LIKE ? OR p.slug LIKE ?)
           AND (? = 'ALL' OR p.kind = ?)
           AND (? = 'ALL' OR (${commerceEffectiveLifecycleSql}) = ?)`,
      )
      .bind(term, term, term, kind, kind, status, status)
      .first<{ count: number }>();
    return json(
      requestId,
      {
        data: rows.results.map(mapOffer),
        pagination: {
          page,
          limit,
          total: Number(count?.count ?? 0),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

async function saveOffer(
  actor: Awaited<ReturnType<typeof requireActor>>,
  requestId: string,
  payload: z.infer<typeof offerSchema>,
) {
  const db = database();
  const id = payload.id ?? `product_${randomId()}`;
  const current = payload.id
    ? await db
        .prepare(
          "SELECT name, revision FROM products WHERE id = ? LIMIT 1",
        )
        .bind(payload.id)
        .first<{ name: string; revision: number }>()
    : null;
  if (payload.id && !current) {
    throw new ApiError(
      404,
      "OFFER_NOT_FOUND",
      "This commerce offer no longer exists.",
    );
  }
  if (current && Number(current.revision) !== payload.revision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed this offer. Reload it before saving.",
    );
  }
  const active = ["ACTIVE", "SCHEDULED"].includes(payload.lifecycleStatus);
  const description = payload.shortDescription;
  const values = [
    payload.slug,
    payload.kind,
    payload.name,
    description,
    payload.priceMinor,
    payload.billingCurrency,
    payload.onyxBase,
    payload.onyxBonus,
    active ? 1 : 0,
    payload.shortDescription,
    payload.detailedDescription,
    JSON.stringify(payload.benefits),
    payload.discountPercent,
    payload.promotionalBadge,
    payload.startsAt,
    payload.endsAt,
    payload.lifecycleStatus,
    payload.isFeatured ? 1 : 0,
    payload.sortOrder,
    payload.ctaText,
    payload.altText,
    payload.themeKey,
    JSON.stringify(payload.metadata),
  ] as const;
  const mutation = current
    ? db
        .prepare(
          `UPDATE products
           SET slug = ?, kind = ?, name = ?, description = ?, price_minor = ?,
               billing_currency = ?, onyx_base = ?, onyx_bonus = ?, active = ?,
               short_description = ?, detailed_description = ?,
               benefits_json = ?, discount_percent = ?,
               promotional_badge = ?, starts_at = ?, ends_at = ?,
               lifecycle_status = ?, is_featured = ?, sort_order = ?,
               cta_text = ?, alt_text = ?, theme_key = ?, metadata_json = ?,
               archived_at = CASE WHEN ? = 'ARCHIVED'
                                  THEN CURRENT_TIMESTAMP ELSE NULL END,
               revision = revision + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND revision = ?`,
        )
        .bind(...values, payload.lifecycleStatus, id, payload.revision)
    : db
        .prepare(
          `INSERT INTO products
           (id, slug, kind, name, description, price_minor, billing_currency,
            onyx_base, onyx_bonus, active, short_description,
            detailed_description, benefits_json, discount_percent,
            promotional_badge, starts_at, ends_at, lifecycle_status,
            is_featured, sort_order, cta_text, alt_text, theme_key,
            metadata_json, archived_at, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, CASE WHEN ? = 'ARCHIVED'
                    THEN CURRENT_TIMESTAMP ELSE NULL END, 1)`,
        )
        .bind(id, ...values, payload.lifecycleStatus);
  const results = await db.batch([
    mutation,
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: current ? "commerce.offer.update" : "commerce.offer.create",
        category: "COMMERCE_STORE",
        sourceArea: "COMMERCE_OFFERS",
        targetType: "PRODUCT",
        targetId: id,
        targetLabel: payload.name,
        oldValue: current,
        newValue: {
          kind: payload.kind,
          priceMinor: payload.priceMinor,
          billingCurrency: payload.billingCurrency,
          lifecycleStatus: payload.lifecycleStatus,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
          isFeatured: payload.isFeatured,
        },
      },
      "changes() = 1",
    ),
  ]);
  if (!results[0]?.meta.changes) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed this offer. Reload it before saving.",
    );
  }
  return getOffer(id);
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = offerSchema.parse(await request.json());
    if (payload.id) {
      throw new ApiError(
        422,
        "OFFER_ID_UNEXPECTED",
        "Use PUT to edit an existing offer.",
      );
    }
    return json(
      requestId,
      { data: await saveOffer(actor, requestId, payload) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = offerSchema.parse(await request.json());
    if (!payload.id || !payload.revision) {
      throw new ApiError(
        422,
        "OFFER_VERSION_REQUIRED",
        "Reload this offer before saving changes.",
      );
    }
    return json(requestId, {
      data: await saveOffer(actor, requestId, payload),
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const db = database();
    const url = new URL(request.url);
    const id = z.string().min(3).max(160).parse(url.searchParams.get("id"));
    const revision = z.coerce
      .number()
      .int()
      .min(1)
      .parse(url.searchParams.get("revision"));
    const current = await db
      .prepare("SELECT name FROM products WHERE id = ? LIMIT 1")
      .bind(id)
      .first<{ name: string }>();
    if (!current) {
      throw new ApiError(
        404,
        "OFFER_NOT_FOUND",
        "This commerce offer no longer exists.",
      );
    }
    const results = await db.batch([
      db.prepare(
        `UPDATE products
         SET active = 0, lifecycle_status = 'ARCHIVED',
             archived_at = CURRENT_TIMESTAMP, revision = revision + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revision = ?`,
      ).bind(id, revision),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: "commerce.offer.archive",
          category: "COMMERCE_STORE",
          sourceArea: "COMMERCE_OFFERS",
          targetType: "PRODUCT",
          targetId: id,
          targetLabel: current.name,
        },
        "changes() = 1",
      ),
    ]);
    if (!results[0]?.meta.changes) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this offer. Reload it before archiving.",
      );
    }
    return json(requestId, { data: { id, archived: true } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
