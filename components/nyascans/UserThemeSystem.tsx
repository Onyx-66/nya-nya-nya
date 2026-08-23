"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeTheme,
  cloneTheme,
  defaultThemePreference,
  presetTheme,
  themeCssVariables,
  themePreferenceSchema,
  THEME_STORAGE_KEY,
  type ActiveThemeId,
  type PresetThemeId,
  type ThemeDocument,
  type ThemePreference,
  type ThemePreferenceMutation,
} from "@/lib/theme-system";

const THEME_CACHE_KEY = "nyascans:user-theme-cache:v1";

type ThemePreferenceResponse = {
  data?: ThemePreference & {
    exists?: boolean;
    hasExplicitThemePreference?: boolean;
    recoveredFromInvalid?: boolean;
    updatedAt?: string | null;
  };
  error?: { message?: string };
};

export type ThemeController = {
  preference: ThemePreference;
  currentTheme: ThemeDocument;
  activeThemeId: ActiveThemeId;
  customTheme: ThemeDocument | null;
  hydrated: boolean;
  syncing: boolean;
  syncError: string;
  signedIn: boolean;
  selectTheme: (id: ActiveThemeId) => Promise<boolean>;
  saveCustomTheme: (theme: ThemeDocument) => Promise<void>;
  applyPreview: (theme: ThemeDocument) => void;
  restoreActiveTheme: () => void;
  clearSyncError: () => void;
};

function cacheTheme(theme: ThemeDocument, activeThemeId: ActiveThemeId) {
  try {
    window.localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        schemaVersion: 1,
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

function preferenceStorageKey(accountId: string | null) {
  return accountId ? `${THEME_STORAGE_KEY}:account:${accountId}` : THEME_STORAGE_KEY;
}

function localPreference(accountId: string | null): ThemePreference {
  try {
    const keys = accountId
      ? [preferenceStorageKey(accountId), THEME_STORAGE_KEY]
      : [THEME_STORAGE_KEY];
    for (const key of keys) {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        const parsed = themePreferenceSchema.safeParse(JSON.parse(stored));
        if (parsed.success) return parsed.data;
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
      preferenceStorageKey(accountId),
      JSON.stringify(preference),
    );
    window.localStorage.removeItem("nyascans-theme");
    window.localStorage.removeItem("nyascans:profile-theme");
  } catch {
    // Theme switching remains live when storage is unavailable.
  }
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
) {
  return mutateAccountPreference(
    {
      action: "reconcile",
      activeThemeId: preference.activeThemeId,
      customTheme: preference.customTheme,
    },
    signal,
  );
}

function parsePreferencePayload(value: unknown) {
  const candidate = value as Partial<ThemePreference> | null;
  return themePreferenceSchema.parse({
    schemaVersion: candidate?.schemaVersion,
    activeThemeId: candidate?.activeThemeId,
    customTheme: candidate?.customTheme,
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
  const preferenceRef = useRef(preference);
  const confirmedPreferenceRef = useRef(preference);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationGenerationRef = useRef(0);

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
    mutationGenerationRef.current += 1;
    queueMicrotask(() => {
      if (cancelled) return;
      setHydrated(false);
      const browserPreference = localPreference(accountId);
      setAndApply(browserPreference);

      if (!signedIn) {
        confirmedPreferenceRef.current = browserPreference;
        setHydrated(true);
        return;
      }
      setSyncing(true);
      void (async () => {
        try {
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
          let confirmed: ThemePreference;
          if (payload.data.hasExplicitThemePreference) {
            const accountPreference = parsePreferencePayload(payload.data);
            confirmed = accountPreference;
          } else {
            confirmed = await migrateBrowserPreference(
              browserPreference,
              controller.signal,
            );
          }
          if (!controller.signal.aborted) {
            confirmedPreferenceRef.current = confirmed;
            setAndApply(confirmed);
          }
          if (!controller.signal.aborted && payload.data.recoveredFromInvalid) {
            setSyncError(
              "A damaged saved custom theme was skipped and Nya Midnight was restored.",
            );
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            confirmedPreferenceRef.current = browserPreference;
            setSyncError(
              error instanceof Error
                ? error.message
                : "Your account theme could not be loaded.",
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
      mutation: ThemePreferenceMutation,
    ) => {
      const parsed = setAndApply(next);
      setSyncError("");
      if (!signedIn) {
        confirmedPreferenceRef.current = parsed;
        return parsed;
      }
      const operationId = mutationGenerationRef.current + 1;
      mutationGenerationRef.current = operationId;
      setSyncing(true);
      const queued = mutationQueueRef.current.then(async () => {
        try {
          const saved = await mutateAccountPreference(mutation);
          confirmedPreferenceRef.current = saved;
          if (operationId === mutationGenerationRef.current) {
            setAndApply(saved);
          }
          return saved;
        } catch (error) {
          if (operationId === mutationGenerationRef.current) {
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
      if (id === "custom" && !current.customTheme) return false;
      await commit(
        { ...current, activeThemeId: id },
        { action: "select", activeThemeId: id },
      );
      return true;
    },
    [commit],
  );

  const saveCustomTheme = useCallback(
    async (theme: ThemeDocument) => {
      const customTheme = cloneTheme(theme);
      await commit(
        {
          schemaVersion: 1,
          activeThemeId: "custom",
          customTheme,
        },
        { action: "save-custom", customTheme, activate: true },
      );
    },
    [commit],
  );

  const currentTheme = useMemo(() => activeTheme(preference), [preference]);
  const applyPreview = useCallback((theme: ThemeDocument) => {
    applyUserTheme(theme, "custom", false);
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
    customTheme: preference.customTheme,
    hydrated,
    syncing,
    syncError,
    signedIn,
    selectTheme,
    saveCustomTheme,
    applyPreview,
    restoreActiveTheme,
    clearSyncError,
  };
}

export function themeForPreset(id: PresetThemeId) {
  return cloneTheme(presetTheme(id));
}
