import { z } from "zod";

export const countryOptions = [
  ["AR", "Argentina"],
  ["AU", "Australia"],
  ["BR", "Brazil"],
  ["CA", "Canada"],
  ["CL", "Chile"],
  ["CN", "China"],
  ["DE", "Germany"],
  ["DZ", "Algeria"],
  ["EG", "Egypt"],
  ["ES", "Spain"],
  ["FR", "France"],
  ["GB", "United Kingdom"],
  ["ID", "Indonesia"],
  ["IN", "India"],
  ["IT", "Italy"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["MA", "Morocco"],
  ["MX", "Mexico"],
  ["MY", "Malaysia"],
  ["PH", "Philippines"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["RU", "Russia"],
  ["SA", "Saudi Arabia"],
  ["SG", "Singapore"],
  ["TH", "Thailand"],
  ["TN", "Tunisia"],
  ["TR", "Türkiye"],
  ["TW", "Taiwan"],
  ["UA", "Ukraine"],
  ["US", "United States"],
  ["VN", "Vietnam"],
] as const;

export const languageOptions = [
  ["ar", "Arabic"],
  ["de", "German"],
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["hi", "Hindi"],
  ["id", "Indonesian"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["ms", "Malay"],
  ["pl", "Polish"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["th", "Thai"],
  ["tr", "Turkish"],
  ["uk", "Ukrainian"],
  ["vi", "Vietnamese"],
  ["zh", "Chinese"],
] as const;

export type CountryCode = (typeof countryOptions)[number][0];
export type LanguageCode = (typeof languageOptions)[number][0];

const countryCodes = new Set<string>(countryOptions.map(([code]) => code));
const languageCodes = new Set<string>(languageOptions.map(([code]) => code));

export const countryLanguageDefaults: Partial<
  Record<CountryCode, LanguageCode>
> = {
  AR: "es",
  AU: "en",
  BR: "pt",
  CA: "en",
  CL: "es",
  CN: "zh",
  DE: "de",
  DZ: "ar",
  EG: "ar",
  ES: "es",
  FR: "fr",
  GB: "en",
  ID: "id",
  IN: "hi",
  IT: "it",
  JP: "ja",
  KR: "ko",
  MA: "ar",
  MX: "es",
  MY: "ms",
  PH: "en",
  PL: "pl",
  PT: "pt",
  RU: "ru",
  SA: "ar",
  SG: "en",
  TH: "th",
  TN: "ar",
  TR: "tr",
  TW: "zh",
  UA: "uk",
  US: "en",
  VN: "vi",
};

const countryAliases = new Map<string, CountryCode>(
  countryOptions.map(([code, name]) => [
    name.toLocaleLowerCase("en-US"),
    code,
  ]),
);
countryAliases.set("korea", "KR");
countryAliases.set("republic of korea", "KR");
countryAliases.set("uk", "GB");
countryAliases.set("usa", "US");
countryAliases.set("turkey", "TR");

const languageAliases = new Map<string, LanguageCode>(
  languageOptions.map(([code, name]) => [
    name.toLocaleLowerCase("en-US"),
    code,
  ]),
);

export function collapseSpaces(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizedLookupKey(value: string) {
  return collapseSpaces(value).toLocaleLowerCase("en-US");
}

const preservedGenreAcronyms = new Set([
  "AI",
  "BL",
  "CGI",
  "GL",
  "LGBT",
  "LGBTQ",
  "LGBTQ+",
  "LGBTQIA",
  "LGBTQIA+",
  "MMO",
  "MMORPG",
  "NTR",
  "OEL",
  "RPG",
  "SF",
  "VR",
  "VRMMO",
]);

export function preferredGenreLabel(value: string) {
  const compact = collapseSpaces(value);
  if (!/[A-Za-z]/u.test(compact)) return compact;
  return compact
    .split(/(\s+|-|\/)/u)
    .map((part) => {
      if (!/[A-Za-z]/u.test(part)) return part;
      const upper = part.toLocaleUpperCase("en-US");
      if (preservedGenreAcronyms.has(upper)) return upper;
      const lower = part.toLocaleLowerCase("en-US");
      return `${lower.slice(0, 1).toLocaleUpperCase("en-US")}${lower.slice(1)}`;
    })
    .join("");
}

export function canonicalCountryCode(value: string) {
  const compact = collapseSpaces(value);
  const upper = compact.toLocaleUpperCase("en-US");
  if (countryCodes.has(upper)) return upper as CountryCode;
  return countryAliases.get(normalizedLookupKey(compact)) ?? null;
}

export function canonicalLanguageCode(value: string) {
  const compact = collapseSpaces(value);
  const lower = compact.toLocaleLowerCase("en-US");
  if (languageCodes.has(lower)) return lower as LanguageCode;
  return languageAliases.get(normalizedLookupKey(compact)) ?? null;
}

export const countryCodeSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    const code = canonicalCountryCode(value);
    if (!code) {
      context.addIssue({
        code: "custom",
        message: "Choose a supported country.",
      });
      return z.NEVER;
    }
    return code;
  });

export const languageCodeSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    const code = canonicalLanguageCode(value);
    if (!code) {
      context.addIssue({
        code: "custom",
        message: "Choose a supported language.",
      });
      return z.NEVER;
    }
    return code;
  });

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens.",
  );

export const lookupEntitySchema = z.object({
  id: z.string().trim().min(3).max(160).optional(),
  name: z.string().trim().min(1).max(180),
});

export const externalSourceSchema = z
  .object({
    source: z.enum(["MANGADEX", "MANGAUPDATES"]),
    externalId: z.string().trim().min(1).max(160),
    sourceUrl: z.string().trim().url().max(1000),
    responseHash: z.string().trim().max(128).nullable().optional(),
  })
  .transform((value) => {
    const externalId = value.externalId.toLocaleLowerCase("en-US");
    const url = new URL(value.sourceUrl);
    const host = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    if (value.source === "MANGADEX") {
      if (
        url.protocol === "https:" &&
        host === "mangadex.org" &&
        segments[0]?.toLocaleLowerCase("en-US") === "title" &&
        segments[1]?.toLocaleLowerCase("en-US") === externalId
      ) {
        return {
          ...value,
          externalId,
          sourceUrl: `https://mangadex.org/title/${externalId}`,
        };
      }
      return { ...value, externalId, sourceUrl: url.toString() };
    }
    if (
      url.protocol === "https:" &&
      host === "mangaupdates.com" &&
      segments[0]?.toLocaleLowerCase("en-US") === "series" &&
      segments[1]?.toLocaleLowerCase("en-US") === externalId
    ) {
      return {
        ...value,
        externalId,
        sourceUrl: `https://www.mangaupdates.com/series/${externalId}`,
      };
    }
    return { ...value, externalId, sourceUrl: url.toString() };
  })
  .superRefine((value, context) => {
    const url = new URL(value.sourceUrl);
    const host = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        path: ["sourceUrl"],
        message: "External source URLs must use HTTPS.",
      });
    }
    if (value.source === "MANGADEX") {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value.externalId,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["externalId"],
          message: "Use a valid MangaDex series UUID.",
        });
      }
      if (
        host !== "mangadex.org" ||
        segments[0]?.toLocaleLowerCase("en-US") !== "title" ||
        segments[1]?.toLocaleLowerCase("en-US") !== value.externalId
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceUrl"],
          message: "Use the matching official MangaDex series URL.",
        });
      }
    }
    if (value.source === "MANGAUPDATES") {
      if (!/^[a-z0-9_-]{1,80}$/.test(value.externalId)) {
        context.addIssue({
          code: "custom",
          path: ["externalId"],
          message: "Use a valid MangaUpdates series ID.",
        });
      }
      if (
        host !== "mangaupdates.com" ||
        segments[0]?.toLocaleLowerCase("en-US") !== "series" ||
        segments[1]?.toLocaleLowerCase("en-US") !== value.externalId
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceUrl"],
          message: "Use the matching official MangaUpdates series URL.",
        });
      }
    }
  });

export const seriesManagementSchema = z
  .object({
    id: z.string().trim().min(3).max(160).optional(),
    revision: z.coerce.number().int().min(1).optional(),
    title: z.string().trim().min(2).max(200),
    slug: slugSchema,
    alternativeTitles: z
      .array(z.string().trim().min(1).max(240))
      .max(60)
      .default([]),
    synopsis: z.string().trim().min(20).max(10_000),
    type: z.enum(["MANGA", "MANHWA", "MANHUA"]),
    status: z.enum(["ONGOING", "COMPLETED", "HIATUS", "PAUSED", "UPCOMING"]),
    ageRating: z.enum(["EVERYONE", "TEEN", "MATURE"]),
    publicationYear: z.coerce
      .number()
      .int()
      .min(1800)
      .max(2200)
      .nullable()
      .default(null),
    authors: z.array(lookupEntitySchema).max(30).default([]),
    artists: z.array(lookupEntitySchema).max(30).default([]),
    publisher: lookupEntitySchema.nullable().default(null),
    countryCode: countryCodeSchema,
    languageCode: languageCodeSchema,
    genres: z.array(lookupEntitySchema).max(40).default([]),
    teamIds: z.array(z.string().trim().min(3).max(160)).max(30).default([]),
    primaryTeamId: z.string().trim().min(3).max(160).nullable().default(null),
    readingDirection: z.enum([
      "VERTICAL",
      "RIGHT_TO_LEFT",
      "LEFT_TO_RIGHT",
    ]),
    accessType: z.enum(["FREE", "PAID"]),
    rightsStatus: z
      .enum([
        "PENDING_REVIEW",
        "LICENSED",
        "AUTHORIZED",
        "DEMO_ORIGINAL",
        "TEST_ORIGINAL",
        "EXPIRED",
        "REVOKED",
        "TAKEDOWN",
      ])
      .default("PENDING_REVIEW"),
    isPublished: z.boolean().default(false),
    externalSources: z.array(externalSourceSchema).max(2).default([]),
    importApplied: z.boolean().default(false),
    removeCover: z.boolean().default(false),
    removeBanner: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    const duplicateSets: Array<
      [string, Array<{ name: string } | string>]
    > = [
      ["alternativeTitles", value.alternativeTitles],
      ["authors", value.authors],
      ["artists", value.artists],
      ["genres", value.genres],
    ];
    for (const [field, items] of duplicateSets) {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const raw = typeof item === "string" ? item : item.name;
        const key = normalizedLookupKey(raw);
        if (seen.has(key)) {
          context.addIssue({
            code: "custom",
            path: [field, index],
            message: "Remove the duplicate entry.",
          });
        }
        seen.add(key);
      });
    }
    if (
      value.primaryTeamId &&
      !value.teamIds.includes(value.primaryTeamId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryTeamId"],
        message: "The primary team must also be assigned to the series.",
      });
    }
    const sources = new Set<string>();
    value.externalSources.forEach((source, index) => {
      const key = `${source.source}:${source.externalId.toLocaleLowerCase(
        "en-US",
      )}`;
      if (sources.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["externalSources", index],
          message: "This external source is already linked.",
        });
      }
      sources.add(key);
    });
    if (
      value.isPublished &&
      !["LICENSED", "AUTHORIZED", "DEMO_ORIGINAL", "TEST_ORIGINAL"].includes(
        value.rightsStatus,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["isPublished"],
        message:
          "A series can be published only after its rights are licensed, authorized, or confirmed as original/test-original.",
      });
    }
  });

export type SeriesManagementInput = z.infer<
  typeof seriesManagementSchema
>;

export type ImportedSeriesMetadata = {
  source: "MANGADEX" | "MANGAUPDATES";
  externalId: string;
  sourceUrl: string;
  responseHash: string;
  fetchedAt: string;
  cached: boolean;
  fields: {
    title?: string;
    alternativeTitles?: string[];
    synopsis?: string;
    authors?: Array<{ name: string }>;
    artists?: Array<{ name: string }>;
    publisher?: { name: string } | null;
    countryCode?: CountryCode;
    languageCode?: LanguageCode;
    type?: "MANGA" | "MANHWA" | "MANHUA";
    status?: "ONGOING" | "COMPLETED" | "HIATUS" | "PAUSED" | "UPCOMING";
    publicationYear?: number | null;
    genres?: Array<{ name: string }>;
    coverReferenceUrl?: string | null;
  };
};
