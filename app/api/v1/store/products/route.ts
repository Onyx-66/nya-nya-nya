import { env } from "cloudflare:workers";
import { z } from "zod";
import { configuredCoinCopy } from "@/lib/commercial-settings";
import { getCommercialSettingsDocument } from "@/lib/server/commercial-settings";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import {
  economySnapshot,
  walletSnapshot,
} from "@/lib/server/economy";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const categorySchema = z
  .enum([
    "coins",
    "memberships",
    "gifts",
    "banners",
    "cosmetics",
    "logo-effects",
  ])
  .default("coins");

function parseJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function productMedia(
  id: string,
  role: "primary" | "banner" | "icon",
  key: string | null,
  revision: number,
) {
  return key
    ? `/api/v1/commerce-media?id=${encodeURIComponent(id)}&role=${role}&v=${revision}`
    : null;
}

export async function storeProductsResponse(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "The Store is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const category = categorySchema.parse(
      url.searchParams.get("category") ?? "coins",
    );
    const actor = await getActor().catch(() => null);
    const commercial = await getCommercialSettingsDocument();
    const premiumEconomyPublic =
      commercial.settings.economy.premiumEconomyPublic;
    const nowClause = `
      active = 1
      AND archived_at IS NULL
      AND lifecycle_status IN ('ACTIVE', 'SCHEDULED')
      AND (starts_at IS NULL OR datetime(starts_at) <= datetime('now'))
      AND (ends_at IS NULL OR datetime(ends_at) > datetime('now'))
    `;
    const productKind =
      !premiumEconomyPublic
        ? null
        : category === "coins"
        ? "CURRENCY_PACKAGE"
        : category === "memberships"
          ? "MEMBERSHIP"
          : null;
    const productRows = productKind
      ? await env.DB.prepare(
          `SELECT id, slug, kind, name,
                  short_description AS shortDescription,
                  detailed_description AS detailedDescription,
                  price_minor AS priceMinor,
                  billing_currency AS billingCurrency,
                  onyx_base AS onyxBase, onyx_bonus AS onyxBonus,
                  benefits_json AS benefitsJson,
                  discount_percent AS discountPercent,
                  promotional_badge AS promotionalBadge,
                  is_featured AS isFeatured, sort_order AS sortOrder,
                  cta_text AS ctaText, alt_text AS altText,
                  theme_key AS themeKey, metadata_json AS metadataJson,
                  primary_image_key AS primaryImageKey,
                  banner_image_key AS bannerImageKey,
                  icon_image_key AS iconImageKey,
                  revision
           FROM products
           WHERE kind = ? AND ${nowClause}
           ORDER BY sort_order, name COLLATE NOCASE`,
        )
          .bind(productKind)
          .all<{
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
            isFeatured: number;
            sortOrder: number;
            ctaText: string;
            altText: string;
            themeKey: string;
            metadataJson: string;
            primaryImageKey: string | null;
            bannerImageKey: string | null;
            iconImageKey: string | null;
            revision: number;
          }>()
      : { results: [] };
    const itemCategoryClause =
      category === "banners"
        ? "si.category = 'PROFILE_BANNER'"
        : category === "logo-effects"
          ? "si.category = 'LOGO_EFFECT'"
          : category === "cosmetics"
            ? "si.category NOT IN ('PROFILE_BANNER', 'LOGO_EFFECT')"
            : "1 = 0";
    const cosmeticCategory = ["banners", "cosmetics", "logo-effects"].includes(
      category,
    );
    const [collectionRows, itemRows, inventoryRows, loadoutRows, counts] =
      await Promise.all([
        cosmeticCategory
          ? env.DB.prepare(
              `SELECT DISTINCT sc.id, sc.slug, sc.name, sc.description,
                      sc.theme_key AS themeKey,
                      sc.is_seasonal AS isSeasonal,
                      sc.starts_at AS startsAt, sc.ends_at AS endsAt,
                      sc.sort_order AS sortOrder
               FROM store_collections sc
               JOIN store_items si ON si.collection_id = sc.id
               WHERE sc.enabled = 1
                 AND (sc.starts_at IS NULL OR datetime(sc.starts_at) <= datetime('now'))
                 AND (sc.ends_at IS NULL OR datetime(sc.ends_at) > datetime('now'))
                 AND si.is_published = 1 AND si.is_hidden = 0
                 AND si.archived_at IS NULL AND ${itemCategoryClause}
               ORDER BY sc.sort_order, sc.name COLLATE NOCASE`,
            ).all()
          : Promise.resolve({ results: [] }),
        cosmeticCategory
          ? env.DB.prepare(
              `SELECT si.id, si.slug, si.collection_id AS collectionId,
                      si.name, si.description, si.category,
                      si.price_onyx AS priceOnyx,
                      si.price_currency AS priceCurrency,
                      si.preview_key AS previewKey,
                      si.preview_config_json AS previewConfigJson,
                      si.sort_order AS sortOrder, si.updated_at AS updatedAt
               FROM store_items si
               JOIN store_collections sc ON sc.id = si.collection_id
               WHERE si.is_published = 1 AND si.is_hidden = 0
                 AND si.archived_at IS NULL AND sc.enabled = 1
                 AND (sc.starts_at IS NULL OR datetime(sc.starts_at) <= datetime('now'))
                 AND (sc.ends_at IS NULL OR datetime(sc.ends_at) > datetime('now'))
                 AND ${itemCategoryClause}
               ORDER BY sc.sort_order, si.sort_order, si.name COLLATE NOCASE`,
            ).all<{
              id: string;
              slug: string;
              collectionId: string;
              name: string;
              description: string;
              category: string;
              priceOnyx: number;
              priceCurrency: "ONYX" | "SHARDS";
              previewKey: string | null;
              previewConfigJson: string;
              sortOrder: number;
              updatedAt: string;
            }>()
          : Promise.resolve({ results: [] }),
        actor
          ? env.DB.prepare(
              `SELECT item_id AS itemId, created_at AS purchasedAt
               FROM user_store_items WHERE user_id = ?`,
            )
              .bind(actor.id)
              .all<{ itemId: string; purchasedAt: string }>()
          : Promise.resolve({ results: [] }),
        actor
          ? env.DB.prepare(
              `SELECT category, item_id AS itemId
               FROM user_cosmetic_loadouts WHERE user_id = ?`,
            )
              .bind(actor.id)
              .all<{ category: string; itemId: string }>()
          : Promise.resolve({ results: [] }),
        env.DB.batch([
          env.DB.prepare(
            `SELECT COUNT(*) AS count FROM products
             WHERE kind = 'CURRENCY_PACKAGE' AND ${nowClause}`,
          ),
          env.DB.prepare(
            `SELECT COUNT(*) AS count FROM products
             WHERE kind = 'MEMBERSHIP' AND ${nowClause}`,
          ),
          env.DB.prepare(
            `SELECT COUNT(*) AS count FROM store_items si
             JOIN store_collections sc ON sc.id = si.collection_id
             WHERE si.is_published = 1 AND si.is_hidden = 0
               AND si.archived_at IS NULL
               AND si.category = 'PROFILE_BANNER'
               AND sc.enabled = 1
               AND (sc.starts_at IS NULL OR datetime(sc.starts_at) <= datetime('now'))
               AND (sc.ends_at IS NULL OR datetime(sc.ends_at) > datetime('now'))`,
          ),
          env.DB.prepare(
            `SELECT COUNT(*) AS count FROM store_items si
             JOIN store_collections sc ON sc.id = si.collection_id
             WHERE si.is_published = 1 AND si.is_hidden = 0
               AND si.archived_at IS NULL
               AND si.category NOT IN ('PROFILE_BANNER', 'LOGO_EFFECT')
               AND sc.enabled = 1
               AND (sc.starts_at IS NULL OR datetime(sc.starts_at) <= datetime('now'))
               AND (sc.ends_at IS NULL OR datetime(sc.ends_at) > datetime('now'))`,
          ),
          env.DB.prepare(
            `SELECT COUNT(*) AS count FROM store_items si
             JOIN store_collections sc ON sc.id = si.collection_id
             WHERE si.is_published = 1 AND si.is_hidden = 0
               AND si.archived_at IS NULL
               AND si.category = 'LOGO_EFFECT'
               AND sc.enabled = 1
               AND (sc.starts_at IS NULL OR datetime(sc.starts_at) <= datetime('now'))
               AND (sc.ends_at IS NULL OR datetime(sc.ends_at) > datetime('now'))`,
          ),
        ]),
      ]);
    const owned = new Map(
      inventoryRows.results.map((entry) => [
        entry.itemId,
        entry.purchasedAt,
      ]),
    );
    const equipped = new Map(
      loadoutRows.results.map((entry) => [entry.category, entry.itemId]),
    );
    const products = productRows.results.map((product) => {
      const metadata = parseJson(product.metadataJson, {}) as Record<
        string,
        unknown
      >;
      const benefits = parseJson(product.benefitsJson, []);
      const base = {
        id: product.id,
        slug: product.slug,
        name: configuredCoinCopy(product.name, commercial.settings),
        description: configuredCoinCopy(
          product.shortDescription,
          commercial.settings,
        ),
        detailedDescription: configuredCoinCopy(
          product.detailedDescription,
          commercial.settings,
        ),
        priceMinor: Number(product.priceMinor),
        billingCurrency: product.billingCurrency,
        discountPercent: Number(product.discountPercent),
        promotionLabel: configuredCoinCopy(
          product.promotionalBadge,
          commercial.settings,
        ),
        featured: Boolean(product.isFeatured),
        ctaText: configuredCoinCopy(product.ctaText, commercial.settings),
        altText: configuredCoinCopy(product.altText, commercial.settings),
        themeKey: product.themeKey,
        media: {
          primary: productMedia(
            product.id,
            "primary",
            product.primaryImageKey,
            product.revision,
          ),
          banner: productMedia(
            product.id,
            "banner",
            product.bannerImageKey,
            product.revision,
          ),
          icon: productMedia(
            product.id,
            "icon",
            product.iconImageKey,
            product.revision,
          ),
        },
      };
      return product.kind === "CURRENCY_PACKAGE"
        ? {
            ...base,
            baseCoins: Number(product.onyxBase),
            bonusCoins: Number(product.onyxBonus),
            active: true,
          }
        : {
            ...base,
            monthlyPriceMinor: Number(product.priceMinor),
            annualPriceMinor: Number(metadata.annualPriceMinor ?? 0),
            monthlyCoins: Number(
              metadata.monthlyCoins ?? product.onyxBonus,
            ),
            chapterDiscountPercent: Number(product.discountPercent),
            benefits: Array.isArray(benefits)
              ? benefits.map((benefit) =>
                  typeof benefit === "string"
                    ? configuredCoinCopy(benefit, commercial.settings)
                    : benefit,
                )
              : [],
            active: true,
          };
    });
    const countValue = (index: number) => {
      const row = counts[index]?.results?.[0];
      return Number(
        row && typeof row === "object"
          ? (row as Record<string, unknown>).count ?? 0
          : 0,
      );
    };
    return json(
      requestId,
      {
        selectedCategory: category,
        categoryCounts: {
          coins: premiumEconomyPublic ? countValue(0) : 0,
          memberships: premiumEconomyPublic ? countValue(1) : 0,
          gifts: premiumEconomyPublic ? 2 : 0,
          banners: countValue(2),
          cosmetics: countValue(3),
          "logo-effects": countValue(4),
        },
        data: category === "coins" ? products : [],
        memberships: category === "memberships" ? products : [],
        collections: collectionRows.results.map((collection) => ({
          ...collection,
          isSeasonal: Boolean(collection.isSeasonal),
        })),
        cosmetics: itemRows.results
          .filter(
            (item) =>
              premiumEconomyPublic || item.priceCurrency === "SHARDS",
          )
          .map((item) => ({
          ...item,
          priceOnyx: Number(item.priceOnyx),
          priceCurrency: item.priceCurrency,
          previewConfig: parseJson(item.previewConfigJson, {}),
          previewUrl: item.previewKey
            ? `/api/v1/store-preview?id=${encodeURIComponent(item.id)}&v=${encodeURIComponent(item.updatedAt)}`
            : null,
          owned: owned.has(item.id),
          purchasedAt: owned.get(item.id) ?? null,
          equipped: equipped.get(item.category) === item.id,
          })),
        coin: premiumEconomyPublic
          ? {
              name: commercial.settings.economy.coinName,
              plural: commercial.settings.economy.coinPlural,
              icon: commercial.settings.economy.coinIcon,
              iconUrl: commercial.settings.economy.coinIconKey
                ? `/api/v1/coin-icon?v=${commercial.settings.economy.coinIconRevision}`
                : null,
            }
          : null,
        viewer: actor && premiumEconomyPublic
          ? await walletSnapshot(env.DB, actor.id, "ONYX")
          : null,
        balances: actor
          ? premiumEconomyPublic
            ? await economySnapshot(env.DB, actor.id)
            : { shards: await walletSnapshot(env.DB, actor.id, "SHARDS") }
          : null,
        premiumEconomyPublic,
        checkoutEnabled: false,
        checkoutStatus:
          premiumEconomyPublic
            ? `Checkout requires a verified payment provider. Cosmetics can be unlocked with an existing ${commercial.settings.economy.coinName} balance.`
            : "Premium purchases are private. Free Shard rewards remain available.",
      },
      {
        headers: {
          "cache-control": actor ? "private, no-store" : "public, max-age=30",
          vary: "cookie",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export const GET = storeProductsResponse;
