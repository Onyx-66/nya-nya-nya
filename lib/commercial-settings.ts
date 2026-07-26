import { z } from "zod";

const destinationSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      value.startsWith("/") ||
      value.startsWith("https://") ||
      value.startsWith("mailto:"),
    "Use a same-site path, HTTPS URL, or mailto link.",
  );

const optionalDateSchema = z
  .string()
  .datetime({ offset: true })
  .nullable();

export const coinPackageSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(240),
  baseCoins: z.number().int().min(1).max(10_000_000),
  bonusCoins: z.number().int().min(0).max(10_000_000),
  priceMinor: z.number().int().min(1).max(100_000_000),
  billingCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  discountPercent: z.number().int().min(0).max(100),
  promotionLabel: z.string().trim().max(80),
  featured: z.boolean(),
  active: z.boolean(),
});

export const membershipOfferSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(320),
  monthlyPriceMinor: z.number().int().min(0).max(100_000_000),
  annualPriceMinor: z.number().int().min(0).max(100_000_000),
  billingCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  monthlyCoins: z.number().int().min(0).max(10_000_000),
  chapterDiscountPercent: z.number().int().min(0).max(100),
  promotionLabel: z.string().trim().max(80),
  benefits: z.array(z.string().trim().min(1).max(140)).max(12),
  active: z.boolean(),
});

export const commercialSettingsSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    announcement: z.object({
      id: z
        .string()
        .trim()
        .min(2)
        .max(80)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      enabled: z.boolean(),
      label: z.string().trim().max(80),
      text: z.string().trim().min(2).max(300),
      buttonLabel: z.string().trim().min(1).max(80),
      destinationUrl: destinationSchema,
      startsAt: optionalDateSchema,
      endsAt: optionalDateSchema,
      resetKey: z.number().int().min(1).max(1_000_000_000),
    }),
    economy: z.object({
      coinName: z.string().trim().min(2).max(40),
      coinPlural: z.string().trim().min(2).max(48),
      coinIcon: z.string().trim().min(1).max(8),
      coinIconKey: z.string().trim().max(320).nullable().default(null),
      coinIconRevision: z.number().int().min(1).default(1),
      premiumEconomyPublic: z.boolean().default(true),
      defaultChapterPrice: z.number().int().min(0).max(1_000_000),
      defaultSeriesPrice: z.number().int().min(0).max(10_000_000),
      permanentChapterUnlocks: z.boolean(),
      temporaryChapterUnlockHours: z
        .number()
        .int()
        .min(1)
        .max(8_760)
        .default(72),
      seriesUnlocksEnabled: z.boolean(),
      membershipDiscountsEnabled: z.boolean(),
      packages: z.array(coinPackageSchema).max(12),
      memberships: z.array(membershipOfferSchema).max(6),
    }),
  })
  .superRefine((value, context) => {
    const { startsAt, endsAt } = value.announcement;
    if (
      startsAt &&
      endsAt &&
      new Date(endsAt).getTime() <= new Date(startsAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["announcement", "endsAt"],
        message: "The announcement end must be after its start.",
      });
    }
    const packageIds = new Set<string>();
    value.economy.packages.forEach((item, index) => {
      if (packageIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: ["economy", "packages", index, "id"],
          message: "Package IDs must be unique.",
        });
      }
      packageIds.add(item.id);
    });
    const membershipIds = new Set<string>();
    value.economy.memberships.forEach((item, index) => {
      if (membershipIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: ["economy", "memberships", index, "id"],
          message: "Membership IDs must be unique.",
        });
      }
      membershipIds.add(item.id);
      if (packageIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: ["economy", "memberships", index, "id"],
          message:
            "Offer IDs must also be unique across coin packages and memberships.",
        });
      }
    });
  });

export type CommercialSettings = z.infer<typeof commercialSettingsSchema>;
export type CoinPackage = z.infer<typeof coinPackageSchema>;
export type MembershipOffer = z.infer<typeof membershipOfferSchema>;

export const defaultCommercialSettings: CommercialSettings = {
  schemaVersion: 2,
  announcement: {
    id: "nya-plus-launch",
    enabled: true,
    label: "Nya+",
    text: "Discover paid chapters and premium profile cosmetics with Paw Coins.",
    buttonLabel: "Open Store",
    destinationUrl: "/store",
    startsAt: null,
    endsAt: null,
    resetKey: 1,
  },
  economy: {
    coinName: "Paw Coin",
    coinPlural: "Paw Coins",
    coinIcon: "🐾",
    coinIconKey: null,
    coinIconRevision: 1,
    premiumEconomyPublic: true,
    defaultChapterPrice: 30,
    defaultSeriesPrice: 300,
    permanentChapterUnlocks: true,
    temporaryChapterUnlockHours: 72,
    seriesUnlocksEnabled: false,
    membershipDiscountsEnabled: true,
    packages: [
      {
        id: "onyx-240",
        name: "Paw 240",
        description: "A small balance for occasional paid chapters and cosmetics.",
        baseCoins: 220,
        bonusCoins: 20,
        priceMinor: 399,
        billingCurrency: "USD",
        discountPercent: 0,
        promotionLabel: "",
        featured: false,
        active: true,
      },
      {
        id: "onyx-720",
        name: "Paw 720",
        description: "A balanced package for regular weekly reading.",
        baseCoins: 620,
        bonusCoins: 100,
        priceMinor: 999,
        billingCurrency: "USD",
        discountPercent: 0,
        promotionLabel: "Best value",
        featured: true,
        active: true,
      },
      {
        id: "onyx-1600",
        name: "Paw 1,600",
        description: "A larger balance with the strongest standard bonus.",
        baseCoins: 1300,
        bonusCoins: 300,
        priceMinor: 1999,
        billingCurrency: "USD",
        discountPercent: 0,
        promotionLabel: "",
        featured: false,
        active: true,
      },
    ],
    memberships: [
      {
        id: "nya-plus",
        name: "Nya+",
        description:
          "Monthly reading benefits, cosmetic offers, and a recurring coin grant.",
        monthlyPriceMinor: 499,
        annualPriceMinor: 4790,
        billingCurrency: "USD",
        monthlyCoins: 120,
        chapterDiscountPercent: 10,
        promotionLabel: "Save 20% annually",
        benefits: [
          "Ad-free reading",
          "Member cosmetic offers",
          "Monthly coin grant",
        ],
        active: true,
      },
    ],
  },
};

export const failClosedCommercialSettings: CommercialSettings = {
  schemaVersion: 2,
  announcement: {
    id: "premium-hidden",
    enabled: false,
    label: "",
    text: "Commercial features are currently unavailable.",
    buttonLabel: "Home",
    destinationUrl: "/",
    startsAt: null,
    endsAt: null,
    resetKey: 1,
  },
  economy: {
    coinName: "Private",
    coinPlural: "Private",
    coinIcon: "•",
    coinIconKey: null,
    coinIconRevision: 1,
    premiumEconomyPublic: false,
    defaultChapterPrice: 0,
    defaultSeriesPrice: 0,
    permanentChapterUnlocks: false,
    temporaryChapterUnlockHours: 1,
    seriesUnlocksEnabled: false,
    membershipDiscountsEnabled: false,
    packages: [],
    memberships: [],
  },
};

export function sanitizeCommercialSettingsForPublic(
  settings: CommercialSettings,
): CommercialSettings {
  if (!settings.economy.premiumEconomyPublic) {
    return failClosedCommercialSettings;
  }
  return {
    ...settings,
    economy: {
      ...settings.economy,
      coinIconKey: settings.economy.coinIconKey ? "configured" : null,
    },
  };
}

export function parseCommercialSettings(value: unknown): CommercialSettings {
  const parsed = commercialSettingsSchema.safeParse(value);
  if (!parsed.success) return defaultCommercialSettings;
  const legacyCoinName = /^(?:onyx|onyx coin)$/i.test(
    parsed.data.economy.coinName,
  );
  const legacyCoinPlural = /^onyx coins?$/i.test(
    parsed.data.economy.coinPlural,
  );
  const legacyIcon = parsed.data.economy.coinIcon === "◆";
  const coinName = legacyCoinName
    ? defaultCommercialSettings.economy.coinName
    : parsed.data.economy.coinName;
  const coinPlural = legacyCoinPlural
    ? defaultCommercialSettings.economy.coinPlural
    : parsed.data.economy.coinPlural;
  const normalizedEconomy = {
    ...parsed.data.economy,
    coinName,
    coinPlural,
    coinIcon: legacyIcon
      ? defaultCommercialSettings.economy.coinIcon
      : parsed.data.economy.coinIcon,
  };
  const copySettings = {
    ...parsed.data,
    economy: normalizedEconomy,
  };
  return {
    ...parsed.data,
    schemaVersion: 2,
    announcement: {
      ...parsed.data.announcement,
      text: configuredCoinCopy(
        parsed.data.announcement.text,
        copySettings,
      ),
    },
    economy: {
      ...normalizedEconomy,
      packages: parsed.data.economy.packages.map((offer) => ({
        ...offer,
        name: configuredCoinCopy(offer.name, copySettings),
      })),
    },
  };
}

export function configuredCoinCopy(
  value: string,
  settings: CommercialSettings,
) {
  const family =
    settings.economy.coinName.replace(/\s+coins?$/iu, "").trim() ||
    settings.economy.coinName;
  return value
    .replace(
      /\b(?:Onyx|Paw)\s+Coins?\b/giu,
      () => settings.economy.coinPlural,
    )
    .replace(/\bONYX\b/gu, () => settings.economy.coinPlural)
    .replace(/\b(?:Onyx|onyx|Paw|paw)\b/gu, () => family);
}

export function paidEconomyIsPublic(settings: CommercialSettings) {
  return settings.economy.premiumEconomyPublic;
}

export function coinLabel(
  amount: number,
  settings: CommercialSettings,
): string {
  const name =
    Math.abs(amount) === 1
      ? settings.economy.coinName
      : settings.economy.coinPlural;
  return `${amount.toLocaleString("en-US")} ${name}`;
}

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}
