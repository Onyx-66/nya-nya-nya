"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import {
  CheckCircle,
  PaintBrush,

  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";
import {
  applySitePalettePreset,
  defaultSiteTheme,
  parseSiteTheme,
  siteAppearanceSavedEvent,
  sitePalettePresets,
  siteThemeDataAttributes,
  siteThemeVariables,
  type SiteAppearanceSavedDetail,
  type SitePalettePreset,
  type SiteTheme,
} from "@/lib/site-theme";

type AppearanceResponse = {
  settings: SiteTheme;
  revision: number;
};

type PanelStatus = "loading" | "idle" | "saving" | "saved" | "error";

function applyPreview(settings: SiteTheme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(siteThemeVariables(settings))) {
    root.style.setProperty(name, value);
  }
  for (const [name, value] of Object.entries(
    siteThemeDataAttributes(settings),
  )) {
    root.setAttribute(name, value);
  }
}

function matchesPalette(theme: SiteTheme, preset: SitePalettePreset) {
  return (
    JSON.stringify({
      dark: theme.dark,
      light: theme.light,
      accent: theme.accent,
      accentStrong: theme.accentStrong,
      accentInk: theme.accentInk,
      danger: theme.danger,
      warning: theme.warning,
      success: theme.success,
      premium: theme.premium,
      gradient: theme.gradient,
    }) === JSON.stringify(preset.palette)
  );
}

export function ThemePalettePresetsPanel() {
  const [settings, setSettings] = useState<SiteTheme>(defaultSiteTheme);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<PanelStatus>("loading");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const savedPreview = useRef<SiteTheme | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/admin/appearance", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Appearance settings could not be loaded.");
        }
        return (await response.json()) as {
          data?: AppearanceResponse;
        } & AppearanceResponse;
      })
      .then((payload) => {
        const document = payload.data ?? payload;
        const next = parseSiteTheme(document.settings);
        savedPreview.current = next;
        setSettings(next);
        setRevision(Number(document.revision ?? 0));
        setHasLoaded(true);
        setStatus("idle");
        applyPreview(next);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMessage(
          error instanceof Error
            ? error.message
            : "Appearance settings could not be loaded.",
        );
        setStatus("error");
      });

    return () => {
      controller.abort();
      if (savedPreview.current) applyPreview(savedPreview.current);
    };
  }, []);

  useEffect(() => {
    function syncSavedAppearance(event: Event) {
      const detail = (event as CustomEvent<SiteAppearanceSavedDetail>).detail;
      if (!detail?.settings || !Number.isFinite(detail.revision)) return;
      const next = parseSiteTheme(detail.settings);
      savedPreview.current = next;
      setSettings(next);
      setRevision(detail.revision);
      setStatus("saved");
      setMessage("");
      applyPreview(next);
    }
    window.addEventListener(siteAppearanceSavedEvent, syncSavedAppearance);
    return () =>
      window.removeEventListener(siteAppearanceSavedEvent, syncSavedAppearance);
  }, []);

  async function applyAndSave(preset: SitePalettePreset) {
    const previous = settings;
    const next = applySitePalettePreset(settings, preset);
    setPendingId(preset.id);
    setStatus("saving");
    setMessage("");
    applyPreview(next);

    try {
      const response = await fetch("/api/v1/admin/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings: next,
          expectedRevision: revision,
        }),
      });
      const payload = (await response.json()) as {
        data?: AppearanceResponse;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "The palette could not be saved.",
        );
      }

      const savedTheme = parseSiteTheme(payload.data?.settings ?? next);
      savedPreview.current = savedTheme;
      setSettings(savedTheme);
      const nextRevision = Number(payload.data?.revision ?? revision + 1);
      setRevision(nextRevision);
      applyPreview(savedTheme);
      window.dispatchEvent(
        new CustomEvent<SiteAppearanceSavedDetail>(siteAppearanceSavedEvent, {
          detail: { settings: savedTheme, revision: nextRevision },
        }),
      );
      setStatus("saved");
      setMessage(`${preset.name} is now active across the reader site.`);
    } catch (error) {
      applyPreview(previous);
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The palette could not be saved.",
      );
    } finally {
      setPendingId(null);
    }
  }

  const activePreset = sitePalettePresets.find((preset) =>
    matchesPalette(settings, preset),
  );

  if (status === "loading") {
    return (
      <section className="palette-presets-state" role="status">
        <DotsRing size={22} />
        <strong>Loading saved appearance</strong>
        <span>Preparing palettes from the latest published revision.</span>
      </section>
    );
  }

  if (status === "error" && !hasLoaded) {
    return (
      <section className="palette-presets-state is-error" role="alert">
        <WarningCircle size={24} />
        <strong>Palettes are unavailable</strong>
        <span>{message}</span>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="palette-presets-panel">
      <header>
        <div>
          <span className="ops-kicker">
            <PaintBrush size={17} /> Ready-to-use palettes
          </span>
          <h2>Change the whole color system in one click</h2>
          <p>
            Every palette updates dark mode, light mode, actions, feedback
            colors, and gradients. Typography and layout stay unchanged.
          </p>
        </div>
        <div className="palette-current-status" aria-live="polite">
          <span>Current palette</span>
          <strong>{activePreset?.name ?? "Custom palette"}</strong>
          <small>Saved revision {revision}</small>
        </div>
      </header>

      {message ? (
        <SystemNoticeBridge
          message={message}
          kind={status === "error" ? "error" : "success"}
        />
      ) : null}

      <div className="palette-preset-grid">
        {sitePalettePresets.map((preset) => {
          const active = matchesPalette(settings, preset);
          const saving = pendingId === preset.id;
          const swatches = [
            preset.palette.dark.background,
            preset.palette.dark.surfaceRaised,
            preset.palette.accent,
            preset.palette.premium,
            preset.palette.light.background,
          ];
          return (
            <button
              type="button"
              key={preset.id}
              className={`palette-preset-card${active ? " is-active" : ""}`}
              aria-pressed={active}
              disabled={status === "saving" || active}
              onClick={() => void applyAndSave(preset)}
            >
              <span
                className="palette-preset-preview"
                style={{
                  background: `linear-gradient(145deg, ${preset.palette.dark.background}, ${preset.palette.dark.surfaceRaised})`,
                }}
                aria-hidden="true"
              >
                <i
                  style={{
                    background: `linear-gradient(${preset.palette.gradient.angle}deg, ${preset.palette.gradient.from}, ${preset.palette.gradient.to})`,
                  }}
                />
                <i style={{ backgroundColor: preset.palette.dark.surface }} />
                <i style={{ backgroundColor: preset.palette.light.surface }} />
              </span>
              <span className="palette-preset-copy">
                <small>{preset.mood}</small>
                <strong>{preset.name}</strong>
                <span>{preset.summary}</span>
              </span>
              <span className="palette-preset-swatches" aria-hidden="true">
                {swatches.map((color, index) => (
                  <i
                    key={`${preset.id}-swatch-${index}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
              <span className="palette-preset-action">
                {saving ? (
                  <>
                    <DotsRing size={16} /> Applying…
                  </>
                ) : active ? (
                  <>
                    <CheckCircle size={16} weight="fill" /> Active
                  </>
                ) : (
                  "Apply and save"
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
