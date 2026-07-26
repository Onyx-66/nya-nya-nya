import type { MetadataRoute } from "next";
import { demoSeries } from "@/lib/catalog";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes = [
    "",
    "/browse",
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
