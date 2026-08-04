import { z } from "zod";

const destinationSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) =>
      value === "" ||
      (value.startsWith("/") && !value.startsWith("//")) ||
      value.startsWith("https://") ||
      value.startsWith("mailto:"),
    "Use a same-site path, HTTPS URL, or mailto link.",
  );

const mediaKeySchema = z
  .string()
  .trim()
  .regex(/^public\/site\/[a-z0-9/_\-.]+$/)
  .nullable();

const mediaSlotSchema = z.object({
  enabled: z.boolean(),
  key: mediaKeySchema,
  revision: z.number().int().min(0).max(1_000_000_000),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(40_000),
});

const optionalBrandMediaSchema = mediaSlotSchema.default({
  enabled: false,
  key: null,
  revision: 0,
  width: 512,
  height: 512,
});

export const siteSocialLinkSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().trim().min(1).max(60),
  url: destinationSchema,
  enabled: z.boolean(),
  icon: z
    .enum([
      "SUPPORT",
      "DISCORD",
      "INSTAGRAM",
      "X",
      "LINK",
      "MASTODON",
      "YOUTUBE",
      "TIKTOK",
      "BLUESKY",
    ])
    .default("LINK"),
  order: z.number().int().min(0).max(1_000).default(0),
  openInNewTab: z.boolean().default(true),
});

export const siteConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    brand: z.object({
      siteName: z.string().trim().min(2).max(80),
      shortDescription: z.string().trim().max(240).default(""),
      logoAlt: z.string().trim().max(160).default(""),
      logo: mediaSlotSchema,
      compactLogo: optionalBrandMediaSchema,
      appIcon: optionalBrandMediaSchema,
    }),
    footer: z.object({
      socialLinks: z.array(siteSocialLinkSchema).min(1).max(20),
    }),
    reader: z.object({
      firstPage: mediaSlotSchema,
      lastPage: mediaSlotSchema,
    }),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    const destinations = new Set<string>();
    value.footer.socialLinks.forEach((link, index) => {
      if (ids.has(link.id)) {
        context.addIssue({
          code: "custom",
          path: ["footer", "socialLinks", index, "id"],
          message: "Social-link IDs must be unique.",
        });
      }
      ids.add(link.id);
      const destination = link.url.trim().toLocaleLowerCase("en-US");
      if (destination && destinations.has(destination)) {
        context.addIssue({
          code: "custom",
          path: ["footer", "socialLinks", index, "url"],
          message: "This destination is already configured.",
        });
      }
      if (destination) destinations.add(destination);
      if (link.enabled && !link.url) {
        context.addIssue({
          code: "custom",
          path: ["footer", "socialLinks", index, "url"],
          message: "An enabled link needs a destination.",
        });
      }
    });
    (
      [
        ["brand", "logo", value.brand.logo],
        ["brand", "compactLogo", value.brand.compactLogo],
        ["brand", "appIcon", value.brand.appIcon],
        ["reader", "firstPage", value.reader.firstPage],
        ["reader", "lastPage", value.reader.lastPage],
      ] as const
    ).forEach(([group, field, slot]) => {
      if (slot.enabled && !slot.key) {
        context.addIssue({
          code: "custom",
          path: [group, field, "enabled"],
          message: "Upload an image before enabling this slot.",
        });
      }
    });
  });

export type SiteConfiguration = z.infer<typeof siteConfigurationSchema>;
export type SiteMediaSlot = z.infer<typeof mediaSlotSchema>;
export type SiteSocialLink = z.infer<typeof siteSocialLinkSchema>;

const emptyMediaSlot: SiteMediaSlot = {
  enabled: false,
  key: null,
  revision: 0,
  width: 1200,
  height: 1800,
};

export const defaultSiteConfiguration: SiteConfiguration = {
  schemaVersion: 1,
  brand: {
    siteName: "NyaScans",
    shortDescription: "Premium manga, manhwa, and manhua reading.",
    logoAlt: "NyaScans",
    logo: {
      ...emptyMediaSlot,
      width: 512,
      height: 512,
    },
    compactLogo: {
      ...emptyMediaSlot,
      width: 256,
      height: 256,
    },
    appIcon: {
      ...emptyMediaSlot,
      width: 512,
      height: 512,
    },
  },
  footer: {
    socialLinks: [
      {
        id: "support",
        label: "Support",
        url: "/support",
        enabled: true,
        icon: "SUPPORT",
        order: 0,
        openInNewTab: false,
      },
      {
        id: "discord",
        label: "Discord",
        url: "",
        enabled: false,
        icon: "DISCORD",
        order: 10,
        openInNewTab: true,
      },
      {
        id: "x",
        label: "X",
        url: "",
        enabled: false,
        icon: "X",
        order: 20,
        openInNewTab: true,
      },
      {
        id: "instagram",
        label: "Instagram",
        url: "",
        enabled: false,
        icon: "INSTAGRAM",
        order: 30,
        openInNewTab: true,
      },
    ],
  },
  reader: {
    firstPage: { ...emptyMediaSlot },
    lastPage: { ...emptyMediaSlot },
  },
};

export function parseSiteConfiguration(
  value: unknown,
): SiteConfiguration {
  const parsed = siteConfigurationSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultSiteConfiguration;
}

export function siteMediaUrl(
  slot: "logo" | "compact" | "app" | "first" | "last",
  media: SiteMediaSlot,
) {
  return media.key
    ? `/api/v1/site-media?slot=${slot}&v=${media.revision}`
    : null;
}
