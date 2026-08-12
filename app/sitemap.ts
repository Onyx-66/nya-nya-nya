import type { MetadataRoute } from "next";
import { env } from "cloudflare:workers";
import { getCommercialSettingsDocument } from "@/lib/server/commercial-settings";
import { getFeatureStates } from "@/lib/server/feature-flags";
import { publicPaidSeriesPredicate } from "@/lib/server/public-content-visibility";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [commercial, featureStates] = await Promise.all([
    getCommercialSettingsDocument().catch(() => null),
    getFeatureStates().catch(() => null),
  ]);
  const discountsPublic = Boolean(
    commercial &&
      !commercial.recoveredFromInvalid &&
      commercial.settings.economy.premiumEconomyPublic &&
      featureStates?.premium_unlocks.effective &&
      featureStates.payments.effective,
  );
  const staticRoutes = [
    "",
    "/browse",
    "/pinned-series",
    ...(discountsPublic ? ["/discounts"] : []),
    "/store",
    "/latest",
    "/leaderboard",
    "/status",
    "/support",
    "/legal/terms",
    "/legal/privacy",
    "/legal/content-policy",
    "/legal/copyright",
    "/legal/refunds",
  ];
  const visibleSeries = env.DB
    ? await env.DB.prepare(
        `SELECT s.slug, s.updated_at AS updatedAt
           FROM series s
          WHERE s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
            AND ${publicPaidSeriesPredicate("s")}
          ORDER BY datetime(s.updated_at) DESC`,
      )
        .all<{ slug: string; updatedAt: string }>()
        .then((result) => result.results)
        .catch(() => [])
    : [];
  return [
    ...staticRoutes.map((path) => ({
      url: `https://nyascans.com${path}`,
      lastModified: now,
      changeFrequency: path === "" ? ("daily" as const) : ("weekly" as const),
      priority: path === "" ? 1 : 0.7,
    })),
    ...visibleSeries.map((item) => ({
      url: `https://nyascans.com/title/${item.slug}`,
      lastModified: new Date(item.updatedAt),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
