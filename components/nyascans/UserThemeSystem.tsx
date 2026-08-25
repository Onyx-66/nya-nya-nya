"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeTheme,
  cloneTheme,
  createCustomThemeId,
  customThemeReference,
  defaultThemePreference,
  LEGACY_THEME_STORAGE_KEY,
  MAX_SAVED_CUSTOM_THEMES,
  MAX_SHORTLISTED_THEMES,
  parseThemePreference,
  presetTheme,
  themeCssVariables,
  themeForReference,
  themePreferenceSchema,
  themeShortlistSchema,
  THEME_PREFERENCE_SCHEMA_VERSION,
  THEME_STORAGE_KEY,
  type ActiveThemeId,
  type CustomThemeId,
  type PresetThemeId,
  type SavedCustomTheme,
  type ThemeDocument,
  type ThemePreference,
  type ThemePreferenceMutation,
} from "@/lib/theme-system";
import {
  defaultPublicThemeCatalog,
  parsePublicThemeCatalog,
  type PublicThemeCatalog,
} from "@/lib/theme-catalog";

const THEME_CACHE_KEY = "nyascans:user-theme-cache:v2";

type ThemePreferenceResponse = {
  data?: ThemePreference & {
    preferenceRevision?: number;
    exists?: boolean;
    hasExplicitThemePreference?: boolean;
    recoveredFromInvalid?: boolean;
    updatedAt?: string | null;
    globalThemeCatalog?: PublicThemeCatalog;
  };
  error?: { code?: string; message?: string };
};

type AccountPreference = {
  preference: ThemePreference;
  preferenceRevision: number;
  globalThemeCatalog: PublicThemeCatalog;
};

type ThemePreferenceMutationDraft = ThemePreferenceMutation extends infer Mutation
  ? Mutation extends { action: "reconcile" }
    ? never
    : Mutation extends { expectedPreferenceRevision: number }
      ? Omit<Mutation, "expectedPreferenceRevision">
      : never
  : never;

export type ThemeController = {
  preference: ThemePreference;
  currentTheme: ThemeDocument;
  activeThemeId: ActiveThemeId;
  customThemes: SavedCustomTheme[];
  shortlist: ActiveThemeId[];
  suggestedThemes: PublicThemeCatalog["suggestedThemes"];
  defaultSuggestedThemeId: ActiveThemeId;

  hydrated: boolean;
  syncing: boolean;
  syncError: string;
  signedIn: boolean;
  selectTheme: (id: ActiveThemeId) => Promise<boolean>;
  saveCustomTheme: (
    theme: ThemeDocument,
    themeId?: CustomThemeId | null,
  ) => Promise<SavedCustomTheme>;
  deleteCustomTheme: (themeId: CustomThemeId) => Promise<void>;
  setShortlist: (references: ActiveThemeId[]) => Promise<void>;
  applyPreview: (theme: ThemeDocument) => void;
  restoreActiveTheme: () => void;
  clearSyncError: () => void;
};

function cacheTheme(theme: ThemeDocument, activeThemeId: ActiveThemeId) {
  try {
    window.localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        schemaVersion: THEME_PREFERENCE_SCHEMA_VERSION,
        activeThemeId,
        type: theme.type,
        background: theme.tokens.mainBackground,
        variables: themeCssVariables(theme),
      }),
    );
  } catch {
    // A private browser can deny storage while still allowing live theming.
  }
}

export function applyUserTheme(
  theme: ThemeDocument,
  activeThemeId: ActiveThemeId,
  persistCache = true,
) {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(themeCssVariables(theme))) {
    root.style.setProperty(property, value);
  }
  root.dataset.theme = theme.type;
  root.dataset.userTheme = activeThemeId;
  root.dataset.logoColorMode = theme.logoColorOverride ? "fixed" : "auto";
  root.style.colorScheme = theme.type;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme.tokens.mainBackground);
  if (persistCache) cacheTheme(theme, activeThemeId);
  window.dispatchEvent(
    new CustomEvent("nyascans:theme-applied", {
      detail: { activeThemeId, type: theme.type },
    }),
  );
}

function preferenceStorageKey(
  baseKey: string,
  accountId: string | null,
) {
  return accountId ? `${baseKey}:account:${accountId}` : baseKey;
}

function localPreference(accountId: string | null): ThemePreference {
  try {
    const keys = accountId
      ? [
          preferenceStorageKey(THEME_STORAGE_KEY, accountId),
          THEME_STORAGE_KEY,
          preferenceStorageKey(LEGACY_THEME_STORAGE_KEY, accountId),
          LEGACY_THEME_STORAGE_KEY,
        ]
      : [THEME_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY];
    for (const key of keys) {
      const stored = window.localStorage.getItem(key);
      if (!stored) continue;
      try {
        return parseThemePreference(JSON.parse(stored));
      } catch {
        // Continue through older device-local formats before falling back.
      }
    }
  } catch {
    // Invalid or unavailable storage recovers to a safe complete preset.
  }

  let legacyTheme: string | null = null;
  let legacyProfile: string | null = null;
  try {
    legacyTheme = window.localStorage.getItem("nyascans-theme");
    legacyProfile = window.localStorage.getItem("nyascans:profile-theme");
  } catch {
    return defaultThemePreference;
  }
  const activeThemeId: PresetThemeId =
    legacyTheme === "light"
      ? "paper-daylight"
      : legacyProfile === "mangadex"
        ? "slate-rain"
        : "nya-midnight";
  return { ...defaultThemePreference, activeThemeId };
}

function writeLocalPreference(
  preference: ThemePreference,
  accountId: string | null,
) {
  try {
    window.localStorage.setItem(
      preferenceStorageKey(THEME_STORAGE_KEY, accountId),
      JSON.stringify(preference),
    );
    window.localStorage.removeItem("nyascans-theme");
    window.localStorage.removeItem("nyascans:profile-theme");
  } catch {
    // Theme switching remains live when storage is unavailable.
  }
}

function parsePreferencePayload(value: unknown) {
  const candidate = value as (Partial<ThemePreference> & {
    preferenceRevision?: unknown;
    globalThemeCatalog?: unknown;
  }) | null;
  const preferenceRevision = candidate?.preferenceRevision;
  if (
    typeof preferenceRevision !== "number" ||
    !Number.isInteger(preferenceRevision) ||
    preferenceRevision < 0
  ) {
    throw new Error("The account theme revision is invalid.");
  }
  return {
    preference: themePreferenceSchema.parse({
      schemaVersion: candidate?.schemaVersion,
      activeThemeId: candidate?.activeThemeId,
      shortlist: candidate?.shortlist,
      customThemes: candidate?.customThemes,
    }),
    preferenceRevision,
    globalThemeCatalog: parsePublicThemeCatalog(candidate?.globalThemeCatalog),
  } satisfies AccountPreference;
}

async function mutateAccountPreference(
  mutation: ThemePreferenceMutation,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/v1/theme-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mutation),
    signal,
  });
  const payload = (await response.json()) as ThemePreferenceResponse;
  if (!response.ok || !payload.data) {
    throw new Error(
      payload.error?.message ?? "Your account theme could not be saved.",
    );
  }
  return parsePreferencePayload(payload.data);
}

async function migrateBrowserPreference(
  preference: ThemePreference,
  signal: AbortSignal,
  globalThemeCatalog: PublicThemeCatalog,
) {
  const saved = await mutateAccountPreference(
    { action: "reconcile", preference },
    signal,
  );
  return { ...saved, globalThemeCatalog } satisfies AccountPreference;
}

function isPristineBrowserPreference(preference: ThemePreference) {
  return (
    preference.customThemes.length === 0 &&
    preference.activeThemeId === "nya-midnight" &&
    JSON.stringify(preference.shortlist) === JSON.stringify(defaultThemePreference.shortlist)
  );
}

function preferenceForCatalog(
  catalog: PublicThemeCatalog,
  base: ThemePreference,
) {
  const timestamp = new Date().toISOString();
  const customThemes = [...base.customThemes];
  const localReferenceByGlobal = new Map<string, ActiveThemeId>();
  for (const entry of catalog.suggestedThemes) {
    if (entry.source !== "USER" || customThemes.length >= MAX_SAVED_CUSTOM_THEMES) continue;
    const id = createCustomThemeId();
    customThemes.push({
      id,
      theme: cloneTheme(entry.theme),
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    localReferenceByGlobal.set(entry.id, customThemeReference(id));
  }
  const remap = (reference: ActiveThemeId) =>
    localReferenceByGlobal.get(reference) ?? reference;
  const shortlist = catalog.policy.suggestedThemeIds.map(remap).slice(0, MAX_SHORTLISTED_THEMES);
  const activeThemeId = remap(catalog.policy.defaultThemeId);
  return themePreferenceSchema.parse({
    ...base,
    activeThemeId,
    shortlist: shortlist.includes(activeThemeId)
      ? shortlist
      : [activeThemeId, ...shortlist].slice(0, MAX_SHORTLISTED_THEMES),
    customThemes,
  });
}

export function useUserThemeController(accountId: string | null): ThemeController {
  const signedIn = Boolean(accountId);
  const [preference, setPreference] = useState<ThemePreference>(
    defaultThemePreference,
  );
  const [hydrated, setHydrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [globalThemeCatalog, setGlobalThemeCatalog] = useState<PublicThemeCatalog>(defaultPublicThemeCatalog);
  const preferenceRef = useRef(preference);
  const confirmedPreferenceRef = useRef(preference);
  const preferenceRevisionRef = useRef(0);
  const confirmedPreferenceRevisionRef = useRef(0);
  const globalThemeCatalogRef = useRef<PublicThemeCatalog>(defaultPublicThemeCatalog);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationGenerationRef = useRef(0);
  const accountGenerationRef = useRef(0);

  const setAndApply = useCallback((next: ThemePreference) => {
    const parsed = themePreferenceSchema.parse(next);
    preferenceRef.current = parsed;
    setPreference(parsed);
    writeLocalPreference(parsed, accountId);
    applyUserTheme(activeTheme(parsed), parsed.activeThemeId);
    return parsed;
  }, [accountId]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    accountGenerationRef.current += 1;
    mutationGenerationRef.current += 1;
    queueMicrotask(() => {
      if (cancelled) return;
      setHydrated(false);
      const browserPreference = localPreference(accountId);
      preferenceRevisionRef.current = 0;
      confirmedPreferenceRevisionRef.current = 0;
      setAndApply(browserPreference);
      setSyncing(signedIn);
      void (async () => {
        try {
          const catalogResponse = await fetch("/api/v1/theme-catalog", {
            cache: "no-store",
            signal: controller.signal,
          });
          const catalogPayload = catalogResponse.ok
            ? await catalogResponse.json()
            : null;
          const catalog = parsePublicThemeCatalog(catalogPayload);
          globalThemeCatalogRef.current = catalog;
          setGlobalThemeCatalog(catalog);

          if (!signedIn) {
            const initial = isPristineBrowserPreference(browserPreference)
              ? preferenceForCatalog(catalog, browserPreference)
              : browserPreference;
            confirmedPreferenceRef.current = initial;
            setAndApply(initial);
            return;
          }

          const response = await fetch("/api/v1/theme-preferences", {
            cache: "no-store",
            signal: controller.signal,
          });
          const payload = (await response.json()) as ThemePreferenceResponse;
          if (!response.ok || !payload.data) {
            throw new Error(
              payload.error?.message ?? "Your account theme could not be loaded.",
            );
          }
          const serverCatalog = parsePublicThemeCatalog(payload.data.globalThemeCatalog ?? catalog);
          globalThemeCatalogRef.current = serverCatalog;
          setGlobalThemeCatalog(serverCatalog);
          const serverPreference = parsePreferencePayload(payload.data);
          const confirmedAccount = payload.data.hasExplicitThemePreference
            ? serverPreference
            : await migrateBrowserPreference(
                isPristineBrowserPreference(browserPreference)
                  ? preferenceForCatalog(serverCatalog, browserPreference)
                  : browserPreference,
                controller.signal,
                serverCatalog,
              );
          if (!controller.signal.aborted) {
            confirmedPreferenceRef.current = confirmedAccount.preference;
            preferenceRevisionRef.current = confirmedAccount.preferenceRevision;
            confirmedPreferenceRevisionRef.current = confirmedAccount.preferenceRevision;
            setAndApply(confirmedAccount.preference);
          }
          if (!controller.signal.aborted && payload.data.recoveredFromInvalid) {
            setSyncError(
              "A damaged saved theme was skipped. Your other saved themes were left untouched.",
            );
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            confirmedPreferenceRef.current = browserPreference;
            setSyncError(
              error instanceof Error
                ? error.message
                : "Your account themes could not be loaded.",
            );
          }
        } finally {
          if (!controller.signal.aborted) {
            setSyncing(false);
            setHydrated(true);
          }
        }
      })();
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accountId, setAndApply, signedIn]);

  const commit = useCallback(
    async (
      next: ThemePreference,
      mutation: ThemePreferenceMutationDraft,
    ) => {
      const parsed = setAndApply(next);
      setSyncError("");
      if (!signedIn) {
        confirmedPreferenceRef.current = parsed;
        return parsed;
      }
      const expectedPreferenceRevision = preferenceRevisionRef.current;
      preferenceRevisionRef.current = expectedPreferenceRevision + 1;
      const accountGeneration = accountGenerationRef.current;
      const operationId = mutationGenerationRef.current + 1;
      mutationGenerationRef.current = operationId;
      setSyncing(true);
      const queued = mutationQueueRef.current.then(async () => {
        try {
          if (accountGeneration !== accountGenerationRef.current) {
            throw new Error("The signed-in account changed before the theme could be saved.");
          }
          const saved = await mutateAccountPreference({
            ...mutation,
            expectedPreferenceRevision,
          } as ThemePreferenceMutation);
          confirmedPreferenceRef.current = saved.preference;
          confirmedPreferenceRevisionRef.current = saved.preferenceRevision;
          if (
            operationId === mutationGenerationRef.current &&
            accountGeneration === accountGenerationRef.current
          ) {
            preferenceRevisionRef.current = saved.preferenceRevision;
            setAndApply(saved.preference);
          }
          return saved.preference;
        } catch (error) {
          if (
            operationId === mutationGenerationRef.current &&
            accountGeneration === accountGenerationRef.current
          ) {
            preferenceRevisionRef.current = confirmedPreferenceRevisionRef.current;
            setAndApply(confirmedPreferenceRef.current);
            setSyncError(
              error instanceof Error
                ? error.message
                : "Your account theme could not be saved.",
            );
          }
          throw error;
        } finally {
          if (operationId === mutationGenerationRef.current) {
            setSyncing(false);
          }
        }
      });
      mutationQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [setAndApply, signedIn],
  );

  const selectTheme = useCallback(
    async (id: ActiveThemeId) => {
      const current = preferenceRef.current;
      let resolvedId = id;
      let resolvedTheme = themeForReference(current, id);
      if (!resolvedTheme) {
        const suggested = globalThemeCatalogRef.current.suggestedThemes.find(
          (entry) => entry.id === id,
        );
        if (!suggested) return false;
        const existing = current.customThemes.find(
          (saved) => JSON.stringify(saved.theme) === JSON.stringify(suggested.theme),
        );
        if (existing) {
          resolvedId = customThemeReference(existing.id);
          resolvedTheme = existing.theme;
        } else {
          if (current.customThemes.length >= MAX_SAVED_CUSTOM_THEMES) {
            throw new Error("Delete a saved theme before adding a suggested user theme.");
          }
          const savedId = createCustomThemeId();
          const timestamp = new Date().toISOString();
          const saved = {
            id: savedId,
            theme: cloneTheme(suggested.theme),
            revision: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          } satisfies SavedCustomTheme;
          resolvedId = customThemeReference(savedId);
          resolvedTheme = saved.theme;
          const shortlist = [resolvedId, ...current.shortlist].slice(0, MAX_SHORTLISTED_THEMES);
          await commit(
            { ...current, activeThemeId: resolvedId, shortlist, customThemes: [...current.customThemes, saved] },
            {
              action: "create-custom",
              themeId: savedId,
              customTheme: saved.theme,
              activate: true,
              shortlist,
            },
          );
          return true;
        }
      }
      if (!resolvedTheme) return false;
      const shortlist = current.shortlist.includes(resolvedId)
        ? current.shortlist
        : [resolvedId, ...current.shortlist].slice(0, MAX_SHORTLISTED_THEMES);
      await commit(
        { ...current, activeThemeId: resolvedId, shortlist },
        { action: "select", activeThemeId: resolvedId, shortlist },
      );
      return true;
    },
    [commit],
  );

  const saveCustomTheme = useCallback(
    async (theme: ThemeDocument, themeId?: CustomThemeId | null) => {
      const current = preferenceRef.current;
      const existing = themeId
        ? current.customThemes.find((saved) => saved.id === themeId)
        : null;
      if (themeId && !existing) {
        throw new Error("The saved theme you tried to update no longer exists.");
      }
      if (!existing && current.customThemes.length >= MAX_SAVED_CUSTOM_THEMES) {
        throw new Error("Delete a saved theme to create a new one.");
      }
      const id = existing?.id ?? createCustomThemeId();
      const timestamp = new Date().toISOString();
      const savedTheme: SavedCustomTheme = {
        id,
        theme: cloneTheme(theme),
        revision: (existing?.revision ?? 0) + 1,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const customThemes = existing
        ? current.customThemes.map((saved) =>
            saved.id === id ? savedTheme : saved,
          )
        : [...current.customThemes, savedTheme];
      const activeThemeId = customThemeReference(id);
      const shortlist = current.shortlist.includes(activeThemeId)
        ? current.shortlist
        : [activeThemeId, ...current.shortlist].slice(
            0,
            MAX_SHORTLISTED_THEMES,
          );
      const next = themePreferenceSchema.parse({
        ...current,
        activeThemeId,
        shortlist,
        customThemes,
      });
      const confirmed = await commit(
        next,
        existing
          ? {
              action: "update-custom",
              themeId: id,
              customTheme: savedTheme.theme,
              expectedRevision: existing.revision,
              activate: true,
              shortlist,
            }
          : {
              action: "create-custom",
              themeId: id,
              customTheme: savedTheme.theme,
              activate: true,
              shortlist,
            },
      );
      return confirmed.customThemes.find((saved) => saved.id === id)
        ?? savedTheme;
    },
    [commit],
  );

  const deleteCustomTheme = useCallback(
    async (themeId: CustomThemeId) => {
      const current = preferenceRef.current;
      const reference = customThemeReference(themeId);
      if (!current.customThemes.some((saved) => saved.id === themeId)) {
        throw new Error("That saved custom theme no longer exists.");
      }
      const customThemes = current.customThemes.filter(
        (saved) => saved.id !== themeId,
      );
      const shortlist = current.shortlist.filter((id) => id !== reference);
      if (shortlist.length === 0) shortlist.push("nya-midnight");
      const activeThemeId = current.activeThemeId === reference
        ? shortlist[0]
        : current.activeThemeId;
      const next = themePreferenceSchema.parse({
        ...current,
        activeThemeId,
        shortlist,
        customThemes,
      });
      const deleted = current.customThemes.find((saved) => saved.id === themeId)!;
      await commit(next, {
        action: "delete-custom",
        themeId,
        expectedRevision: deleted.revision,
        fallbackThemeId: activeThemeId,
      });
    },
    [commit],
  );

  const setShortlist = useCallback(
    async (references: ActiveThemeId[]) => {
      const current = preferenceRef.current;
      const shortlist = themeShortlistSchema.parse(references);
      const next = themePreferenceSchema.parse({ ...current, shortlist });
      await commit(next, { action: "set-shortlist", shortlist });
    },
    [commit],
  );

  const currentTheme = useMemo(() => activeTheme(preference), [preference]);
  const applyPreview = useCallback((theme: ThemeDocument) => {
    applyUserTheme(theme, preferenceRef.current.activeThemeId, false);
  }, []);
  const restoreActiveTheme = useCallback(() => {
    const current = preferenceRef.current;
    applyUserTheme(activeTheme(current), current.activeThemeId);
  }, []);
  const clearSyncError = useCallback(() => setSyncError(""), []);

  return {
    preference,
    currentTheme,
    activeThemeId: preference.activeThemeId,
    customThemes: preference.customThemes,
    shortlist: preference.shortlist,
    suggestedThemes: globalThemeCatalog.suggestedThemes,
    defaultSuggestedThemeId: globalThemeCatalog.policy.defaultThemeId,
    hydrated,
    syncing,
    syncError,
    signedIn,
    selectTheme,
    saveCustomTheme,
    deleteCustomTheme,
    setShortlist,
    applyPreview,
    restoreActiveTheme,
    clearSyncError,
  };
}

export function themeForPreset(id: PresetThemeId) {
  return cloneTheme(presetTheme(id));
}
