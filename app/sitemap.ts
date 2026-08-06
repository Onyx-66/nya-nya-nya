import type { MetadataRoute } from "next";
import { demoSeries } from "@/lib/catalog";
import { getCommercialSettingsDocument } from "@/lib/server/commercial-settings";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const commercial = await getCommercialSettingsDocument().catch(() => null);
  const discountsPublic = Boolean(
    commercial &&
      !commercial.recoveredFromInvalid &&
      commercial.settings.economy.premiumEconomyPublic,
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
  return [
    ...staticRoutes.map((path) => ({
      url: `https://nyascans.com${path}`,
      lastModified: now,
      changeFrequency: path === "" ? ("daily" as const) : ("weekly" as const),
      priority: path === "" ? 1 : 0.7,
    })),
    ...demoSeries.map((item) => ({
      url: `https://nyascans.com/title/${item.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
