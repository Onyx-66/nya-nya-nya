import { z } from "zod";

export const THEME_SCHEMA_VERSION = 1 as const;
export const THEME_PREFERENCE_SCHEMA_VERSION = 2 as const;
export const THEME_STORAGE_KEY = "nyascans:user-theme:v2";
export const LEGACY_THEME_STORAGE_KEY = "nyascans:user-theme:v1";
export const THEME_SHARE_KEY = "theme";
export const THEME_IMPORT_LIMIT = 64 * 1024;
export const MAX_SAVED_CUSTOM_THEMES = 15;
export const MAX_SHORTLISTED_THEMES = 5;

export const themeTokenKeys = [
  "textColor",
  "mainBackground",
  "accent",
  "accentHover",
  "accentActive",
  "accentL1",
  "accentL1Hover",
  "accentL1Active",
  "accentL2",
  "accentL2Hover",
  "accentL2Active",
  "accentL3",
  "accentL3Hover",
  "accentL3Active",
  "accentL4",
  "accentL4Hover",
  "accentL4Active",
  "accentL5",
  "accentL5Hover",
  "accentL5Active",
  "midTone",
  "contrastL1",
  "scrollbarColor",
  "scrollbarColorHover",
  "buttonAccent",
  "buttonAccentAlternate",
  "primary",
  "primaryL1",
  "primaryL2",
  "statusRed",
  "statusGreen",
  "statusYellow",
  "statusBlue",
  "statusPurple",
  "statusGrey",
  "indicationBlue",
  "danger",
  "dangerL1",
  "dangerL2",
] as const;

export type ThemeTokenKey = (typeof themeTokenKeys)[number];

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hexadecimal color.")
  .transform((value) => value.toUpperCase());

export const themeTokensSchema = z
  .object({
    textColor: hexColor,
    mainBackground: hexColor,
    accent: hexColor,
    accentHover: hexColor,
    accentActive: hexColor,
    accentL1: hexColor,
    accentL1Hover: hexColor,
    accentL1Active: hexColor,
    accentL2: hexColor,
    accentL2Hover: hexColor,
    accentL2Active: hexColor,
    accentL3: hexColor,
    accentL3Hover: hexColor,
    accentL3Active: hexColor,
    accentL4: hexColor,
    accentL4Hover: hexColor,
    accentL4Active: hexColor,
    accentL5: hexColor,
    accentL5Hover: hexColor,
    accentL5Active: hexColor,
    midTone: hexColor,
    contrastL1: hexColor,
    scrollbarColor: hexColor,
    scrollbarColorHover: hexColor,
    buttonAccent: hexColor,
    buttonAccentAlternate: hexColor,
    primary: hexColor,
    primaryL1: hexColor,
    primaryL2: hexColor,
    statusRed: hexColor,
    statusGreen: hexColor,
    statusYellow: hexColor,
    statusBlue: hexColor,
    statusPurple: hexColor,
    statusGrey: hexColor,
    indicationBlue: hexColor,
    danger: hexColor,
    dangerL1: hexColor,
    dangerL2: hexColor,
  })
  .strict();

export const themeDocumentSchema = z
  .object({
    schemaVersion: z.literal(THEME_SCHEMA_VERSION),
    name: z.string().trim().min(1).max(48),
    type: z.enum(["dark", "light"]),
    tokens: themeTokensSchema,
    logoColorOverride: hexColor.nullable().default(null),
  })
  .strict();

export type ThemeTokens = z.infer<typeof themeTokensSchema>;
export type ThemeDocument = z.infer<typeof themeDocumentSchema>;

export const themeTokenGroups = [
  {
    name: "Foundation",
    tokens: ["textColor", "mainBackground"] as const,
  },
  {
    name: "Accent",
    tokens: [
      "accent",
      "accentHover",
      "accentActive",
      "accentL1",
      "accentL1Hover",
      "accentL1Active",
      "accentL2",
      "accentL2Hover",
      "accentL2Active",
      "accentL3",
      "accentL3Hover",
      "accentL3Active",
      "accentL4",
      "accentL4Hover",
      "accentL4Active",
      "accentL5",
      "accentL5Hover",
      "accentL5Active",
    ] as const,
  },
  {
    name: "Structure",
    tokens: [
      "midTone",
      "contrastL1",
      "scrollbarColor",
      "scrollbarColorHover",
      "buttonAccent",
      "buttonAccentAlternate",
    ] as const,
  },
  {
    name: "Primary",
    tokens: ["primary", "primaryL1", "primaryL2"] as const,
  },
  {
    name: "Status",
    tokens: [
      "statusRed",
      "statusGreen",
      "statusYellow",
      "statusBlue",
      "statusPurple",
      "statusGrey",
      "indicationBlue",
    ] as const,
  },
  {
    name: "Danger",
    tokens: ["danger", "dangerL1", "dangerL2"] as const,
  },
] as const;

export const themeTokenLabels: Record<ThemeTokenKey, string> = {
  textColor: "Text Color",
  mainBackground: "Main Background",
  accent: "Accent",
  accentHover: "Accent (hover)",
  accentActive: "Accent (active)",
  accentL1: "Accent L1",
  accentL1Hover: "Accent L1 (hover)",
  accentL1Active: "Accent L1 (active)",
  accentL2: "Accent L2",
  accentL2Hover: "Accent L2 (hover)",
  accentL2Active: "Accent L2 (active)",
  accentL3: "Accent L3",
  accentL3Hover: "Accent L3 (hover)",
  accentL3Active: "Accent L3 (active)",
  accentL4: "Accent L4",
  accentL4Hover: "Accent L4 (hover)",
  accentL4Active: "Accent L4 (active)",
  accentL5: "Accent L5",
  accentL5Hover: "Accent L5 (hover)",
  accentL5Active: "Accent L5 (active)",
  midTone: "Mid-tone",
  contrastL1: "Contrast L1",
  scrollbarColor: "Scrollbar color",
  scrollbarColorHover: "Scrollbar color when hovered",
  buttonAccent: "Button Accent",
  buttonAccentAlternate: "Button Accent (alternate)",
  primary: "Primary",
  primaryL1: "Primary L1",
  primaryL2: "Primary L2",
  statusRed: "Status Red",
  statusGreen: "Status Green",
  statusYellow: "Status Yellow",
  statusBlue: "Status Blue",
  statusPurple: "Status Purple",
  statusGrey: "Status Grey",
  indicationBlue: "Indication Blue",
  danger: "Danger",
  dangerL1: "Danger L1",
  dangerL2: "Danger L2",
};

type PaletteSeed = {
  name: string;
  type: "dark" | "light";
  text: string;
  background: string;
  accents: readonly [string, string, string, string, string, string, string, string];
  primary: readonly [string, string, string];
  buttonInk: string;
  statuses?: Partial<
    Pick<
      ThemeTokens,
      | "statusRed"
      | "statusGreen"
      | "statusYellow"
      | "statusBlue"
      | "statusPurple"
      | "statusGrey"
      | "indicationBlue"
      | "danger"
      | "dangerL1"
      | "dangerL2"
    >
  >;
};

function defineTheme(seed: PaletteSeed): ThemeDocument {
  const [a0, a1, a2, a3, a4, a5, a6, a7] = seed.accents;
  return themeDocumentSchema.parse({
    schemaVersion: THEME_SCHEMA_VERSION,
    name: seed.name,
    type: seed.type,
    logoColorOverride: null,
    tokens: {
      textColor: seed.text,
      mainBackground: seed.background,
      accent: a0,
      accentHover: a1,
      accentActive: a2,
      accentL1: a1,
      accentL1Hover: a2,
      accentL1Active: a3,
      accentL2: a2,
      accentL2Hover: a3,
      accentL2Active: a4,
      accentL3: a3,
      accentL3Hover: a4,
      accentL3Active: a5,
      accentL4: a4,
      accentL4Hover: a5,
      accentL4Active: a6,
      accentL5: a5,
      accentL5Hover: a6,
      accentL5Active: a7,
      midTone: a6,
      contrastL1: seed.type === "dark" ? "#FFFFFF" : "#070708",
      scrollbarColor: a4,
      scrollbarColorHover: a6,
      buttonAccent: seed.primary[0],
      buttonAccentAlternate: seed.buttonInk,
      primary: seed.primary[0],
      primaryL1: seed.primary[1],
      primaryL2: seed.primary[2],
      statusRed: "#EF8175",
      statusGreen: "#39C98A",
      statusYellow: "#E6BD61",
      statusBlue: "#5AB7FF",
      statusPurple: "#B39AF4",
      statusGrey: a6,
      indicationBlue: "#8ECBFF",
      danger: "#D95F55",
      dangerL1: "#B94236",
      dangerL2: "#913128",
      ...seed.statuses,
    },
  });
}

export const userThemePresets = [
  {
    id: "nya-midnight",
    description: "Near-black manga panels with NyaScans sky-blue actions.",
    theme: defineTheme({
      name: "Nya Midnight",
      type: "dark",
      text: "#F7F8FB",
      background: "#070708",
      accents: ["#111216", "#17191F", "#1F222A", "#2B2F39", "#343944", "#454B59", "#646D7E", "#9198A6"],
      primary: ["#39A9FF", "#168DE2", "#0876C5"],
      buttonInk: "#03111F",
    }),
  },
  {
    id: "paper-daylight",
    description: "A quiet paper-white shelf with crisp ink and blue controls.",
    theme: defineTheme({
      name: "Paper Daylight",
      type: "light",
      text: "#142433",
      background: "#F6F8FA",
      accents: ["#FFFFFF", "#EDF2F6", "#E1E8EE", "#D1DCE5", "#BBCAD5", "#91A8B8", "#657E90", "#3F586A"],
      primary: ["#147FC4", "#0D69A5", "#095587"],
      buttonInk: "#FFFFFF",
      statuses: {
        statusRed: "#B94236",
        statusGreen: "#147A51",
        statusYellow: "#8C6517",
        statusBlue: "#147FC4",
        statusPurple: "#7656B2",
        indicationBlue: "#0D69A5",
        danger: "#B94236",
        dangerL1: "#9C332A",
        dangerL2: "#7D271F",
      },
    }),
  },
  {
    id: "slate-rain",
    description: "Cool blue-grey surfaces for long catalogue and reader sessions.",
    theme: defineTheme({
      name: "Slate Rain",
      type: "dark",
      text: "#EDF4F8",
      background: "#0B1117",
      accents: ["#111A23", "#17232E", "#1E2C38", "#273846", "#344858", "#465D6E", "#657B8B", "#91A4B1"],
      primary: ["#64B5E8", "#3B9BD6", "#207EB7"],
      buttonInk: "#07131B",
      statuses: { statusBlue: "#64B5E8", indicationBlue: "#93D2F7" },
    }),
  },
  {
    id: "dracula-bloom",
    description: "Plum-black pages, orchid highlights, and neon status color.",
    theme: defineTheme({
      name: "Dracula Bloom",
      type: "dark",
      text: "#F8F2FF",
      background: "#100C17",
      accents: ["#181120", "#21182B", "#2B2037", "#382947", "#49375B", "#614A75", "#806793", "#A18DB2"],
      primary: ["#C18BFF", "#A66DEB", "#8A51D2"],
      buttonInk: "#190A27",
      statuses: {
        statusGreen: "#69D7A8",
        statusBlue: "#72C7FF",
        statusPurple: "#C18BFF",
        indicationBlue: "#9ED9FF",
      },
    }),
  },
  {
    id: "jade-night",
    description: "Deep mineral greens with jade actions and calm contrast.",
    theme: defineTheme({
      name: "Jade Night",
      type: "dark",
      text: "#F1FBF7",
      background: "#07110F",
      accents: ["#0D1916", "#12221D", "#192D27", "#213A32", "#2B4B40", "#3B6254", "#5B8072", "#87A89C"],
      primary: ["#63D5AD", "#3BB68E", "#279674"],
      buttonInk: "#062019",
      statuses: {
        statusGreen: "#63D5AD",
        statusBlue: "#5EBDEA",
        indicationBlue: "#8BD7F7",
      },
    }),
  },
] as const;

export type PresetThemeId = (typeof userThemePresets)[number]["id"];

export const presetThemeIds = [
  "nya-midnight",
  "paper-daylight",
  "slate-rain",
  "dracula-bloom",
  "jade-night",
] as const satisfies readonly PresetThemeId[];

export const presetThemeIdSchema = z.enum([
  "nya-midnight",
  "paper-daylight",
  "slate-rain",
  "dracula-bloom",
  "jade-night",
]);

export const customThemeIdSchema = z
  .string()
  .regex(/^theme_[0-9a-f]{32}$/u, "The custom theme identifier is invalid.");

export type CustomThemeId = z.infer<typeof customThemeIdSchema>;
export type CustomThemeReference = `custom:${CustomThemeId}`;

export const customThemeReferenceSchema = z
  .string()
  .regex(
    /^custom:theme_[0-9a-f]{32}$/u,
    "The custom theme reference is invalid.",
  )
  .transform((value) => value as CustomThemeReference);

export const activeThemeIdSchema = z.union([
  presetThemeIdSchema,
  customThemeReferenceSchema,
]);

export type ActiveThemeId = z.infer<typeof activeThemeIdSchema>;

const isoDateTime = z.string().datetime({ offset: true });

export const savedCustomThemeSchema = z
  .object({
    id: customThemeIdSchema,
    theme: themeDocumentSchema,
    revision: z.number().int().positive(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();

export type SavedCustomTheme = z.infer<typeof savedCustomThemeSchema>;

export const themeShortlistSchema = z
  .array(activeThemeIdSchema)
  .max(
    MAX_SHORTLISTED_THEMES,
    `Choose no more than ${MAX_SHORTLISTED_THEMES} themes for quick switching.`,
  )
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each shortlisted theme must be unique.",
      });
    }
  });

export const themePreferenceSchema = z
  .object({
    schemaVersion: z.literal(THEME_PREFERENCE_SCHEMA_VERSION),
    activeThemeId: activeThemeIdSchema,
    shortlist: themeShortlistSchema,
    customThemes: z.array(savedCustomThemeSchema).max(MAX_SAVED_CUSTOM_THEMES),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.customThemes.map((saved) => saved.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customThemes"],
        message: "Every saved custom theme must have a unique identifier.",
      });
    }
    const ownedReferences = new Set(
      value.customThemes.map((saved) => customThemeReference(saved.id)),
    );
    if (
      isCustomThemeReference(value.activeThemeId) &&
      !ownedReferences.has(value.activeThemeId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeThemeId"],
        message: "The active custom theme is not in the saved theme library.",
      });
    }
    if (!value.shortlist.includes(value.activeThemeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shortlist"],
        message: "The active theme must remain in the quick-switch shortlist.",
      });
    }
    value.shortlist.forEach((reference, index) => {
      if (isCustomThemeReference(reference) && !ownedReferences.has(reference)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["shortlist", index],
          message: "A shortlisted custom theme is not in the saved theme library.",
        });
      }
    });
  });

export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export const themePreferenceMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("select"),
      expectedPreferenceRevision: z.number().int().nonnegative(),
      activeThemeId: activeThemeIdSchema,
      shortlist: themeShortlistSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("create-custom"),
      expectedPreferenceRevision: z.number().int().nonnegative(),
      themeId: customThemeIdSchema,
      customTheme: themeDocumentSchema,
      activate: z.boolean(),
      shortlist: themeShortlistSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("update-custom"),
      expectedPreferenceRevision: z.number().int().nonnegative(),
      themeId: customThemeIdSchema,
      customTheme: themeDocumentSchema,
      expectedRevision: z.number().int().positive(),
      activate: z.boolean(),
      shortlist: themeShortlistSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("delete-custom"),
      expectedPreferenceRevision: z.number().int().nonnegative(),
      themeId: customThemeIdSchema,
      expectedRevision: z.number().int().positive(),
      fallbackThemeId: activeThemeIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("set-shortlist"),
      expectedPreferenceRevision: z.number().int().nonnegative(),
      shortlist: themeShortlistSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("reconcile"),
      preference: themePreferenceSchema,
    })
    .strict(),
]);

export type ThemePreferenceMutation = z.infer<
  typeof themePreferenceMutationSchema
>;

export const defaultThemePreference: ThemePreference = {
  schemaVersion: THEME_PREFERENCE_SCHEMA_VERSION,
  activeThemeId: "nya-midnight",
  shortlist: [...presetThemeIds],
  customThemes: [],
};

const legacyThemePreferenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    activeThemeId: z.enum([
      "nya-midnight",
      "paper-daylight",
      "slate-rain",
      "dracula-bloom",
      "jade-night",
      "custom",
    ]),
    customTheme: themeDocumentSchema.nullable(),
  })
  .strict();

export function parseThemePreference(value: unknown): ThemePreference {
  const current = themePreferenceSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = legacyThemePreferenceSchema.safeParse(value);
  if (!legacy.success) throw current.error;
  if (!legacy.data.customTheme) {
    return themePreferenceSchema.parse({
      ...defaultThemePreference,
      activeThemeId:
        legacy.data.activeThemeId === "custom"
          ? "nya-midnight"
          : legacy.data.activeThemeId,
    });
  }
  const id = createCustomThemeId();
  const reference = customThemeReference(id);
  const timestamp = new Date().toISOString();
  return themePreferenceSchema.parse({
    schemaVersion: THEME_PREFERENCE_SCHEMA_VERSION,
    activeThemeId:
      legacy.data.activeThemeId === "custom"
        ? reference
        : legacy.data.activeThemeId,
    shortlist:
      legacy.data.activeThemeId === "custom"
        ? [...presetThemeIds.slice(0, MAX_SHORTLISTED_THEMES - 1), reference]
        : [...presetThemeIds],
    customThemes: [
      {
        id,
        theme: legacy.data.customTheme,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  });
}

export function createCustomThemeId(): CustomThemeId {
  return customThemeIdSchema.parse(
    `theme_${crypto.randomUUID().replaceAll("-", "")}`,
  );
}

export function customThemeReference(
  id: CustomThemeId,
): CustomThemeReference {
  return `custom:${id}`;
}

export function isCustomThemeReference(
  value: string,
): value is CustomThemeReference {
  return customThemeReferenceSchema.safeParse(value).success;
}

export function customThemeIdFromReference(
  reference: CustomThemeReference,
): CustomThemeId {
  return customThemeIdSchema.parse(reference.slice("custom:".length));
}

export function presetTheme(id: PresetThemeId) {
  return userThemePresets.find((preset) => preset.id === id)!.theme;
}

export function activeTheme(preference: ThemePreference): ThemeDocument {
  if (isCustomThemeReference(preference.activeThemeId)) {
    const themeId = customThemeIdFromReference(preference.activeThemeId);
    const saved = preference.customThemes.find((entry) => entry.id === themeId);
    if (saved) return saved.theme;
  }
  return presetTheme(
    presetThemeIdSchema.safeParse(preference.activeThemeId).success
      ? (preference.activeThemeId as PresetThemeId)
      : "nya-midnight",
  );
}

export function themeForReference(
  preference: ThemePreference,
  reference: ActiveThemeId,
): ThemeDocument | null {
  if (!isCustomThemeReference(reference)) return presetTheme(reference);
  const themeId = customThemeIdFromReference(reference);
  return preference.customThemes.find((entry) => entry.id === themeId)?.theme ?? null;
}

const cssTokenNames: Record<ThemeTokenKey, string> = {
  textColor: "--theme-text-color",
  mainBackground: "--theme-main-background",
  accent: "--theme-accent",
  accentHover: "--theme-accent-hover",
  accentActive: "--theme-accent-active",
  accentL1: "--theme-accent-l1",
  accentL1Hover: "--theme-accent-l1-hover",
  accentL1Active: "--theme-accent-l1-active",
  accentL2: "--theme-accent-l2",
  accentL2Hover: "--theme-accent-l2-hover",
  accentL2Active: "--theme-accent-l2-active",
  accentL3: "--theme-accent-l3",
  accentL3Hover: "--theme-accent-l3-hover",
  accentL3Active: "--theme-accent-l3-active",
  accentL4: "--theme-accent-l4",
  accentL4Hover: "--theme-accent-l4-hover",
  accentL4Active: "--theme-accent-l4-active",
  accentL5: "--theme-accent-l5",
  accentL5Hover: "--theme-accent-l5-hover",
  accentL5Active: "--theme-accent-l5-active",
  midTone: "--theme-mid-tone",
  contrastL1: "--theme-contrast-l1",
  scrollbarColor: "--theme-scrollbar-color",
  scrollbarColorHover: "--theme-scrollbar-color-hover",
  buttonAccent: "--theme-button-accent",
  buttonAccentAlternate: "--theme-button-accent-alternate",
  primary: "--theme-primary",
  primaryL1: "--theme-primary-l1",
  primaryL2: "--theme-primary-l2",
  statusRed: "--theme-status-red",
  statusGreen: "--theme-status-green",
  statusYellow: "--theme-status-yellow",
  statusBlue: "--theme-status-blue",
  statusPurple: "--theme-status-purple",
  statusGrey: "--theme-status-grey",
  indicationBlue: "--theme-indication-blue",
  danger: "--theme-danger",
  dangerL1: "--theme-danger-l1",
  dangerL2: "--theme-danger-l2",
};

export function themeCssVariables(theme: ThemeDocument) {
  const override = theme.logoColorOverride;
  return {
    ...Object.fromEntries(
      themeTokenKeys.map((key) => [cssTokenNames[key], theme.tokens[key]]),
    ),
    "--theme-logo-color": override ?? theme.tokens.textColor,
    "--theme-logo-accent-color": override ?? theme.tokens.primary,
    "--theme-logo-outline-color": override ?? theme.tokens.contrastL1,
  } as Record<string, string>;
}

export function cssVariableForToken(key: ThemeTokenKey) {
  return cssTokenNames[key];
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("The shared theme code contains invalid characters.");
  }
  if (value.length % 4 === 1) {
    throw new Error("The shared theme code is malformed.");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(
      value.replaceAll("-", "+").replaceAll("_", "/") + padding,
    );
  } catch {
    throw new Error("The shared theme code is malformed.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeThemeForUrl(theme: ThemeDocument) {
  return base64UrlEncode(JSON.stringify(themeDocumentSchema.parse(theme)));
}

export function themeShareUrl(theme: ThemeDocument, locationHref: string) {
  const url = new URL("/theme-builder", locationHref);
  url.hash = `${THEME_SHARE_KEY}=${encodeThemeForUrl(theme)}`;
  return url.toString();
}

export function parseThemeImport(raw: string): ThemeDocument {
  const input = raw.trim();
  if (!input) throw new Error("Paste a theme URL or a complete theme JSON document.");
  if (input.length > THEME_IMPORT_LIMIT * 2) {
    throw new Error("The theme payload is larger than 64 KB.");
  }
  let jsonText = input;
  if (/^https?:\/\//iu.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new Error("The pasted theme URL is not valid.");
    }
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const encoded = new URLSearchParams(hash).get(THEME_SHARE_KEY)
      ?? url.searchParams.get(THEME_SHARE_KEY);
    if (!encoded) throw new Error("The URL does not contain a complete shared theme.");
    jsonText = base64UrlDecode(encoded);
  } else if (!input.startsWith("{")) {
    jsonText = base64UrlDecode(input);
  }
  if (new TextEncoder().encode(jsonText).byteLength > THEME_IMPORT_LIMIT) {
    throw new Error("The decoded theme is larger than 64 KB.");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(jsonText);
  } catch {
    throw new Error("The theme JSON is malformed.");
  }
  const parsed = themeDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new Error(`The theme is incomplete or invalid. ${path}${first?.message ?? "Check every token."}`);
  }
  return parsed.data;
}

function linearChannel(value: number) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string) {
  const channels = (hex: string) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const luminance = (hex: string) => {
    const [red, green, blue] = channels(hex).map(linearChannel);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

export type ThemeContrastWarning = {
  id: string;
  label: string;
  ratio: number;
  minimum: number;
};

export function themeContrastWarnings(theme: ThemeDocument): ThemeContrastWarning[] {
  const logoColor = theme.logoColorOverride ?? theme.tokens.textColor;
  const logoAccent = theme.logoColorOverride ?? theme.tokens.primary;
  const pairs = [
    ["page-text", "Page text", theme.tokens.textColor, theme.tokens.mainBackground, 4.5],
    ["surface-text", "Surface text", theme.tokens.textColor, theme.tokens.accent, 4.5],
    ["primary-button", "Primary button", theme.tokens.buttonAccentAlternate, theme.tokens.buttonAccent, 3],
    ["danger-button", "Danger button", theme.tokens.contrastL1, theme.tokens.danger, 3],
    ["logo-base", "Logo base", logoColor, theme.tokens.mainBackground, 3],
    ["logo-accent", "Logo accent", logoAccent, theme.tokens.mainBackground, 3],
  ] as const;
  return pairs
    .map(([id, label, foreground, background, minimum]) => ({
      id,
      label,
      ratio: contrastRatio(foreground, background),
      minimum,
    }))
    .filter((warning) => warning.ratio < warning.minimum);
}

export function cloneTheme(theme: ThemeDocument): ThemeDocument {
  return themeDocumentSchema.parse(JSON.parse(JSON.stringify(theme)));
}
