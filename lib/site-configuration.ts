import { z } from "zod";
import { LEGAL_DOCUMENTS } from "@/lib/legal-documents";

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

export const siteFooterLinkSchema = z.object({
  id: z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().trim().min(1).max(80),
  url: destinationSchema.or(z.literal("#keyboard-shortcuts")),
  enabled: z.boolean().default(true),
  openInNewTab: z.boolean().default(false),
});

export const siteFooterGroupSchema = z.object({
  id: z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(60),
  enabled: z.boolean().default(true),
  links: z.array(siteFooterLinkSchema).max(20),
});

export const siteShortcutSchema = z.object({
  id: z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  prefix: z.string().trim().max(12),
  key: z.string().trim().min(1).max(12),
  label: z.string().trim().min(1).max(100),
  href: destinationSchema.nullable(),
  enabled: z.boolean().default(true),
});

export const siteLegalSectionSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(160),
  paragraphs: z.array(z.string().trim().min(1).max(4_000)).max(30).optional(),
  bullets: z.array(z.string().trim().min(1).max(2_000)).max(40).optional(),
});

export const siteLegalDocumentSchema = z.object({
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(500),
  effectiveDate: z.string().trim().min(1).max(80),
  updatedDate: z.string().trim().min(1).max(80),
  sections: z.array(siteLegalSectionSchema).min(1).max(30),
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
      description: z.string().trim().max(400).default(""),
      copyright: z.string().trim().max(240).default(""),
      legalNotice: z.string().trim().max(400).default(""),
      groups: z.array(siteFooterGroupSchema).max(8).default([]),
      socialLinks: z.array(siteSocialLinkSchema).min(1).max(20),
    }),
    keyboardShortcuts: z.array(siteShortcutSchema).max(40).default([]),
    legalDocuments: z.array(siteLegalDocumentSchema).min(1).max(20),
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
    const footerGroupIds = new Set<string>();
    const footerLinkIds = new Set<string>();
    value.footer.groups.forEach((group, groupIndex) => {
      if (footerGroupIds.has(group.id)) {
        context.addIssue({ code: "custom", path: ["footer", "groups", groupIndex, "id"], message: "Footer group IDs must be unique." });
      }
      footerGroupIds.add(group.id);
      group.links.forEach((link, linkIndex) => {
        if (footerLinkIds.has(link.id)) {
          context.addIssue({ code: "custom", path: ["footer", "groups", groupIndex, "links", linkIndex, "id"], message: "Footer link IDs must be unique." });
        }
        footerLinkIds.add(link.id);
      });
    });
    const shortcutCombos = new Set<string>();
    const shortcutIds = new Set<string>();
    value.keyboardShortcuts.forEach((shortcut, index) => {
      if (shortcutIds.has(shortcut.id)) {
        context.addIssue({ code: "custom", path: ["keyboardShortcuts", index, "id"], message: "Shortcut IDs must be unique." });
      }
      shortcutIds.add(shortcut.id);
      const combo = `${shortcut.prefix.toLowerCase()}:${shortcut.key.toLowerCase()}`;
      if (shortcut.enabled && shortcutCombos.has(combo)) {
        context.addIssue({ code: "custom", path: ["keyboardShortcuts", index, "key"], message: "Shortcut combinations must be unique." });
      }
      if (shortcut.enabled) shortcutCombos.add(combo);
    });
    const legalSlugs = new Set<string>();
    value.legalDocuments.forEach((document, documentIndex) => {
      if (legalSlugs.has(document.slug)) {
        context.addIssue({ code: "custom", path: ["legalDocuments", documentIndex, "slug"], message: "Legal document slugs must be unique." });
      }
      legalSlugs.add(document.slug);
      const sectionIds = new Set<string>();
      document.sections.forEach((section, sectionIndex) => {
        if (sectionIds.has(section.id)) {
          context.addIssue({ code: "custom", path: ["legalDocuments", documentIndex, "sections", sectionIndex, "id"], message: "Section IDs must be unique within a legal document." });
        }
        sectionIds.add(section.id);
      });
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
export type SiteFooterGroup = z.infer<typeof siteFooterGroupSchema>;
export type SiteShortcut = z.infer<typeof siteShortcutSchema>;
export type SiteLegalDocument = z.infer<typeof siteLegalDocumentSchema>;

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
    description: "A focused home for manga, manhwa, manhua, webtoons, readers, and the teams that make every release possible.",
    copyright: "© 2026 NyaScans. Original platform artwork.",
    legalNotice: "Read responsibly. Rights holders can submit a tracked content-removal request through Support.",
    groups: [
      { id: "browse", title: "Browse", enabled: true, links: [
        { id: "latest", label: "Latest Updates", url: "/latest", enabled: true, openInNewTab: false },
        { id: "rankings", label: "Users Ranking", url: "/rankings", enabled: true, openInNewTab: false },
        { id: "completed", label: "Completed", url: "/browse?status=completed", enabled: true, openInNewTab: false },
        { id: "genres", label: "Genres", url: "/browse#genres", enabled: true, openInNewTab: false },
      ] },
      { id: "community", title: "Community", enabled: true, links: [
        { id: "teams", label: "Teams", url: "/teams", enabled: true, openInNewTab: false },
        { id: "support-link", label: "Support", url: "/support", enabled: true, openInNewTab: false },
        { id: "shortcuts", label: "Keyboard shortcuts", url: "#keyboard-shortcuts", enabled: true, openInNewTab: false },
        { id: "contact", label: "Contact", url: "mailto:support@nyascans.com", enabled: true, openInNewTab: false },
      ] },
      { id: "legal", title: "Legal", enabled: true, links: [
        { id: "privacy", label: "Privacy Policy", url: "/legal/privacy", enabled: true, openInNewTab: false },
        { id: "terms", label: "Terms of Service", url: "/legal/terms", enabled: true, openInNewTab: false },
        { id: "dmca", label: "Content Removal / DMCA", url: "/legal/copyright", enabled: true, openInNewTab: false },
        { id: "content-policy", label: "Content Policy", url: "/legal/content-policy", enabled: true, openInNewTab: false },
      ] },
    ],
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
  keyboardShortcuts: [
    { id: "search", prefix: "Ctrl / ⌘", key: "K", label: "Search the catalog", href: null, enabled: true },
    { id: "home", prefix: "G", key: "H", label: "Go to Home", href: "/", enabled: true },
    { id: "latest-shortcut", prefix: "G", key: "U", label: "Go to Latest Updates", href: "/latest", enabled: true },
    { id: "browse-shortcut", prefix: "G", key: "B", label: "Go to Browse", href: "/browse", enabled: true },
    { id: "library-shortcut", prefix: "G", key: "L", label: "Go to Library", href: "/library", enabled: true },
    { id: "store-shortcut", prefix: "G", key: "S", label: "Go to Store", href: "/store", enabled: true },
    { id: "roulette-shortcut", prefix: "G", key: "R", label: "Go to Roulette", href: "/roulette", enabled: true },
    { id: "notifications-shortcut", prefix: "G", key: "N", label: "Go to Notifications", href: "/notifications", enabled: true },
    { id: "account-shortcut", prefix: "G", key: "A", label: "Go to Account", href: "/account", enabled: true },
    { id: "admin-shortcut", prefix: "G", key: "M", label: "Go to Admin Panel", href: "/onyx/admin/access", enabled: true },
    { id: "upload-shortcut", prefix: "G", key: "P", label: "Go to Upload Center", href: "/upload-chapter", enabled: true },
    { id: "guide", prefix: "", key: "?", label: "Open this shortcut guide", href: null, enabled: true },
  ],
  legalDocuments: LEGAL_DOCUMENTS,
  reader: {
    firstPage: { ...emptyMediaSlot },
    lastPage: { ...emptyMediaSlot },
  },
};

export function parseSiteConfiguration(
  value: unknown,
): SiteConfiguration {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<SiteConfiguration>
    : {};
  const parsed = siteConfigurationSchema.safeParse({
    ...defaultSiteConfiguration,
    ...input,
    brand: { ...defaultSiteConfiguration.brand, ...input.brand },
    footer: { ...defaultSiteConfiguration.footer, ...input.footer },
    reader: { ...defaultSiteConfiguration.reader, ...input.reader },
    keyboardShortcuts:
      input.keyboardShortcuts?.length
        ? input.keyboardShortcuts
        : defaultSiteConfiguration.keyboardShortcuts,
    legalDocuments:
      input.legalDocuments?.length
        ? input.legalDocuments
        : defaultSiteConfiguration.legalDocuments,
  });
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
