import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/account",
          "/checkout",
          "/dashboard",
          "/library",
          "/notifications",
          "/onyx/admin/access",
          "/wallet",
        ],
      },
    ],
    sitemap: "https://nyascans.com/sitemap.xml",
  };
}
