import { z } from "zod";
import {
  activeThemeIdSchema,
  customThemeIdSchema,
  customThemeReference,
  isCustomThemeReference,
  presetTheme,
  presetThemeIds,
  themeDocumentSchema,
  type ActiveThemeId,
  type ThemeDocument,
} from "@/lib/theme-system";

export const THEME_CATALOG_SCHEMA_VERSION = 1 as const;
export const THEME_CATALOG_SIZE = 5 as const;

export const themeCatalogPolicySchema = z
  .object({
    schemaVersion: z.literal(THEME_CATALOG_SCHEMA_VERSION),
    defaultThemeId: activeThemeIdSchema,
    suggestedThemeIds: z
      .array(activeThemeIdSchema)
      .length(THEME_CATALOG_SIZE, `Choose exactly ${THEME_CATALOG_SIZE} suggested themes.`),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.suggestedThemeIds).size !== value.suggestedThemeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["suggestedThemeIds"],
        message: "Suggested themes must be unique.",
      });
    }
    if (!value.suggestedThemeIds.includes(value.defaultThemeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultThemeId"],
        message: "The default theme must be one of the five suggested themes.",
      });
    }
  });

export type ThemeCatalogPolicy = z.infer<typeof themeCatalogPolicySchema>;

export type ThemeCatalogEntry = {
  id: ActiveThemeId;
  theme: ThemeDocument;
  source: "PRESET" | "USER";
  creatorDisplayName: string | null;
  creatorUserId?: string;
  creatorRole?: string;
  creatorIsAdministrator?: boolean;
};

export type PublicThemeCatalog = {
  policy: ThemeCatalogPolicy;
  suggestedThemes: Array<Pick<ThemeCatalogEntry, "id" | "theme" | "source" | "creatorDisplayName">>;
  revision: number;
  updatedAt: string | null;
};

const publicThemeCatalogSchema = z.object({
  policy: themeCatalogPolicySchema,
  suggestedThemes: z.array(z.object({
    id: activeThemeIdSchema,
    theme: themeDocumentSchema,
    source: z.enum(["PRESET", "USER"]),
    creatorDisplayName: z.string().nullable(),
  }).strict()),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
}).strict();

export type AdminThemeCatalog = {
  policy: ThemeCatalogPolicy;
  themes: ThemeCatalogEntry[];
  suggestedThemes: PublicThemeCatalog["suggestedThemes"];
  revision: number;
  updatedAt: string | null;
};

export const defaultThemeCatalogPolicy: ThemeCatalogPolicy = {
  schemaVersion: THEME_CATALOG_SCHEMA_VERSION,
  defaultThemeId: "nya-midnight",
  suggestedThemeIds: [...presetThemeIds],
};

export const defaultPublicThemeCatalog: PublicThemeCatalog = {
  policy: defaultThemeCatalogPolicy,
  suggestedThemes: presetThemeIds.map((id) => ({
    id,
    theme: presetTheme(id),
    source: "PRESET",
    creatorDisplayName: null,
  })),
  revision: 0,
  updatedAt: null,
};

export function parseThemeCatalogPolicy(value: unknown): ThemeCatalogPolicy {
  const parsed = themeCatalogPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : defaultThemeCatalogPolicy;
}

export function parsePublicThemeCatalog(value: unknown): PublicThemeCatalog {
  const parsed = publicThemeCatalogSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultPublicThemeCatalog;
}

export function themeCatalogCustomThemeId(reference: ActiveThemeId) {
  if (!isCustomThemeReference(reference)) return null;
  return customThemeIdSchema.parse(reference.slice("custom:".length));
}

export function themeCatalogReferenceForCustomTheme(id: string) {
  return customThemeReference(customThemeIdSchema.parse(id));
}

export function effectiveThemeCatalogPolicy(
  policy: ThemeCatalogPolicy,
  availableIds: ReadonlySet<string>,
): ThemeCatalogPolicy {
  const valid = policy.suggestedThemeIds.every((id) => availableIds.has(id));
  const defaultValid = availableIds.has(policy.defaultThemeId);
  return valid && defaultValid ? policy : defaultThemeCatalogPolicy;
}

export function publicThemeCatalogFromEntries(
  policy: ThemeCatalogPolicy,
  entries: ThemeCatalogEntry[],
  revision: number,
  updatedAt: string | null,
): PublicThemeCatalog {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const suggestedThemes = policy.suggestedThemeIds
    .map((id) => byId.get(id))
    .filter((entry): entry is ThemeCatalogEntry => Boolean(entry))
    .map(({ id, theme, source, creatorDisplayName }) => ({
      id,
      theme,
      source,
      creatorDisplayName,
    }));
  return { policy, suggestedThemes, revision, updatedAt };
}

export function themeCatalogEntrySchema(value: unknown) {
  return z.object({
    id: activeThemeIdSchema,
    theme: themeDocumentSchema,
    source: z.enum(["PRESET", "USER"]),
    creatorDisplayName: z.string().nullable(),
  }).parse(value);
}
