import { z } from "zod";

export const storeCategoryValues = [
  "PROFILE_BANNER",
  "PROFILE_FRAME",
  "USERNAME_DECORATION",
  "COMMENT_EFFECT",
  "COMMENT_GRADIENT",
  "SEASONAL_PROFILE",
  "LOGO_EFFECT",
] as const;

export type StoreCategory = (typeof storeCategoryValues)[number];

const slug = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const optionalDate = z.string().datetime({ offset: true }).nullable();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const storePreviewConfigSchema = z.object({
  from: hexColor,
  to: hexColor,
  accent: hexColor,
  commentOpacity: z.number().int().min(10).max(100).default(65),
  symbol: z
    .enum([
      "SUN",
      "RING",
      "SPARK",
      "WAVE",
      "INK",
      "SLASH",
      "STEEL",
      "HARBOR",
      "COIN",
      "GLYPH",
      "MOSAIC",
      "STAR",
      "COMPASS",
      "COMET",
    ])
    .default("STAR"),
});

export const storeCollectionInputSchema = z
  .object({
    id: z.string().trim().min(3).max(120).optional(),
    expectedRevision: z.number().int().min(1).optional(),
    slug,
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().min(8).max(400),
    themeKey: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9_]+$/),
    isSeasonal: z.boolean(),
    enabled: z.boolean(),
    startsAt: optionalDate,
    endsAt: optionalDate,
    sortOrder: z.number().int().min(0).max(100_000),
  })
  .superRefine((value, context) => {
    if (
      value.startsAt &&
      value.endsAt &&
      new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The collection end must be after its start.",
      });
    }
  });

export const storeItemInputSchema = z.object({
  id: z.string().trim().min(3).max(120).optional(),
  expectedRevision: z.number().int().min(1).optional(),
  slug,
  collectionId: z.string().trim().min(3).max(120),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(8).max(500),
  category: z.enum(storeCategoryValues),
  priceOnyx: z.number().int().min(0).max(10_000_000),
  priceCurrency: z.enum(["ONYX", "SHARDS"]).default("ONYX"),
  previewConfig: storePreviewConfigSchema,
  isPublished: z.boolean(),
  isHidden: z.boolean(),
  sortOrder: z.number().int().min(0).max(100_000),
});

export const storePurchaseSchema = z.object({
  itemId: z.string().trim().min(3).max(120),
  idempotencyKey: z.string().trim().min(12).max(160),
});

export const storeEquipSchema = z.object({
  itemId: z.string().trim().min(3).max(120).nullable(),
  category: z.enum(storeCategoryValues),
});

export const testCoinGrantSchema = z.object({
  email: z.string().trim().email().max(254),
  amount: z.number().int().min(1).max(10_000),
  reason: z.string().trim().min(8).max(240),
});

export function storeCategoryLabel(category: StoreCategory | string) {
  return {
    PROFILE_BANNER: "Profile banner",
    PROFILE_FRAME: "Animated profile frame",
    USERNAME_DECORATION: "Username decoration",
    COMMENT_EFFECT: "Comment effect",
    COMMENT_GRADIENT: "Comment gradient",
    SEASONAL_PROFILE: "Seasonal profile cosmetic",
    LOGO_EFFECT: "Logo effect",
  }[category] ?? category.replaceAll("_", " ").toLowerCase();
}
