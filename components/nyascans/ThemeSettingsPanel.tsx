"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
import { PremiumColorPicker } from "@/components/nyascans/PremiumColorPicker";

import { FloppyDisk, PaintBrush, ArrowCounterClockwise } from "@/components/nyascans/heroicons";
import { useEffect, useRef, useState } from "react";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";
import {
  defaultSiteTheme,
  featuredSliderStyleOptions,
  newSeriesLayoutOptions,
  parseSiteTheme,
  sliderSizeOptions,
  sliderStyleOptions,
  siteAppearanceSavedEvent,
  siteThemeDataAttributes,
  siteThemeVariables,
  templateStyleOptions,
  type SiteAppearanceSavedDetail,
  type SiteTheme,
} from "@/lib/site-theme";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";

type AppearanceResponse = {
  settings: SiteTheme;
  revision: number;
  recoveredFromInvalid?: boolean;
};

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

type RootPreviewSnapshot = {
  styles: Array<[string, string]>;
  attributes: Array<[string, string | null]>;
};

function captureRootPreview(): RootPreviewSnapshot {
  const root = document.documentElement;
  return {
    styles: Object.keys(siteThemeVariables(defaultSiteTheme)).map((name) => [
      name,
      root.style.getPropertyValue(name),
    ]),
    attributes: Object.keys(siteThemeDataAttributes(defaultSiteTheme)).map(
      (name) => [name, root.getAttribute(name)],
    ),
  };
}

function restoreRootPreview(snapshot: RootPreviewSnapshot) {
  const root = document.documentElement;
  for (const [name, value] of snapshot.styles) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  for (const [name, value] of snapshot.attributes) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (value: string) => {
    const channels = value
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.03928
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return (
      0.2126 * channels[0]! +
      0.7152 * channels[1]! +
      0.0722 * channels[2]!
    );
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function PaletteEditor({
  title,
  value,
  onChange,
}: {
  title: string;
  value: SiteTheme["dark"];
  onChange: (next: SiteTheme["dark"]) => void;
}) {
  const fields: Array<[keyof SiteTheme["dark"], string]> = [
    ["background", "Background"],
    ["backgroundSoft", "Soft background"],
    ["surface", "Surface"],
    ["surfaceRaised", "Raised surface"],
    ["surfaceStrong", "Strong surface"],
    ["text", "Primary text"],
    ["textSoft", "Secondary text"],
    ["muted", "Muted text"],
    ["line", "Borders"],
    ["lineStrong", "Strong borders"],
  ];
  return (
    <fieldset className="theme-palette">
      <legend>{title}</legend>
      <div>
        {fields.map(([field, label]) => (
          <label key={field}>
            <span>{label}</span>
            <PremiumColorPicker
              value={value[field]}
              label={label}
              onChange={(next) => onChange({ ...value, [field]: next.slice(0, 7) })}
            />
            <code>{value[field]}</code>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ThemeSettingsPanel() {
  const [settings, setSettings] = useState<SiteTheme>(defaultSiteTheme);
  const [saved, setSaved] = useState<SiteTheme>(defaultSiteTheme);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [message, setMessage] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [recoveredFromInvalid, setRecoveredFromInvalid] = useState(false);
  const savedPreview = useRef<SiteTheme | null>(null);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  useUnsavedChanges(dirty, "appearance token changes");
  const contrastWarnings = [
    {
      label: "Dark theme body text",
      ratio: contrastRatio(settings.dark.text, settings.dark.background),
    },
    {
      label: "Light theme body text",
      ratio: contrastRatio(settings.light.text, settings.light.background),
    },
    {
      label: "Primary action text",
      ratio: contrastRatio(settings.accentInk, settings.accent),
    },
  ].filter((entry) => entry.ratio < 4.5);

  useEffect(() => {
    let active = true;
    const rootSnapshot = captureRootPreview();
    void fetch("/api/v1/admin/appearance")
      .then(async (response) => {
        if (!response.ok) throw new Error("Appearance settings could not be loaded.");
        return (await response.json()) as { data?: AppearanceResponse } & AppearanceResponse;
      })
      .then((payload) => {
        if (!active) return;
        const document = payload.data ?? payload;
        const next = parseSiteTheme(document.settings);
        setSettings(next);
        setSaved(next);
        savedPreview.current = next;
        setRevision(Number(document.revision ?? 0));
        setRecoveredFromInvalid(Boolean(document.recoveredFromInvalid));
        setHasLoaded(true);
        setStatus("idle");
        applyPreview(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "Appearance settings could not be loaded.");
        setStatus("error");
      });
    return () => {
      active = false;
      if (savedPreview.current) applyPreview(savedPreview.current);
      else restoreRootPreview(rootSnapshot);
    };
  }, []);

  useEffect(() => {
    if (hasLoaded) applyPreview(settings);
  }, [hasLoaded, settings]);

  useEffect(() => {
    function syncSavedAppearance(event: Event) {
      const detail = (event as CustomEvent<SiteAppearanceSavedDetail>).detail;
      if (!detail?.settings || !Number.isFinite(detail.revision)) return;
      const next = parseSiteTheme(detail.settings);
      setSettings(next);
      setSaved(next);
      savedPreview.current = next;
      setRevision(detail.revision);
      setRecoveredFromInvalid(false);
      setStatus("saved");
      setMessage("Appearance synchronized with the saved site theme.");
      applyPreview(next);
    }
    window.addEventListener(siteAppearanceSavedEvent, syncSavedAppearance);
    return () =>
      window.removeEventListener(siteAppearanceSavedEvent, syncSavedAppearance);
  }, []);

  async function save() {
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings,
          expectedRevision: revision,
        }),
      });
      const payload = (await response.json()) as {
        data?: AppearanceResponse;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Appearance settings could not be saved.");
      }
      const next = parseSiteTheme(payload.data?.settings ?? settings);
      setSettings(next);
      setSaved(next);
      savedPreview.current = next;
      const nextRevision = Number(payload.data?.revision ?? revision + 1);
      setRevision(nextRevision);
      setRecoveredFromInvalid(false);
      window.dispatchEvent(
        new CustomEvent<SiteAppearanceSavedDetail>(siteAppearanceSavedEvent, {
          detail: { settings: next, revision: nextRevision },
        }),
      );
      setStatus("saved");
      setMessage("Appearance saved and applied site-wide.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Appearance settings could not be saved.");
      setStatus("error");
    }
  }

  function update<K extends keyof SiteTheme>(key: K, value: SiteTheme[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    if (status === "saved" || status === "error") setStatus("idle");
  }

  if (!hasLoaded && status === "error") {
    return (
      <section className="admin-state-card" role="alert">
        <PaintBrush size={24} />
        <h3>Appearance settings unavailable</h3>
        <p>{message || "The saved theme could not be loaded safely."}</p>
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
    <section className="theme-settings-panel">
      <header>
        <div>
          <span className="ops-kicker"><PaintBrush size={17} /> Site appearance</span>
          <h2>Templates, sliders, colors, and shape</h2>
          <p>Choose the site structure and discovery rhythm, preview it instantly, then publish one consistent visual system.</p>
        </div>
        <div className="theme-actions">
          <button type="button" onClick={() => setSettings(saved)} disabled={status === "loading" || status === "saving" || !dirty}>
            <ArrowCounterClockwise size={16} /> Reset preview
          </button>
          <button type="button" onClick={() => setSettings(defaultSiteTheme)} disabled={status === "saving"}>
            Restore defaults
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={save}
            disabled={
              status === "loading" ||
              status === "saving" ||
              !dirty ||
              contrastWarnings.length > 0
            }
            title={
              contrastWarnings.length
                ? "Resolve contrast warnings before publishing."
                : undefined
            }
          >
            <FloppyDisk size={17} /> {status === "saving" ? "Saving…" : "Save appearance"}
          </button>
        </div>
      </header>

      {status === "loading" ? <div className="dots-ring-loading settings-loading" role="status"><DotsRing size="lg" label={null} /><span>Loading appearance controls…</span></div> : null}
      {status !== "loading" ? (
        <>
          {recoveredFromInvalid ? (
            <div className="admin-notice is-warning" role="alert">
              <strong>Recovery defaults loaded</strong>
              <span>
                The saved appearance document was invalid. Review this safe
                preview and publish to replace the damaged configuration.
              </span>
            </div>
          ) : null}
          {contrastWarnings.length ? (
            <div className="admin-notice is-warning" role="alert">
              <strong>Contrast needs attention</strong>
              <span>
                {contrastWarnings
                  .map(
                    (entry) =>
                      `${entry.label} ${entry.ratio.toFixed(2)}:1`,
                  )
                  .join(" · ")}
                . Use at least 4.5:1 before publishing.
              </span>
            </div>
          ) : null}
          <fieldset className="experience-control">
            <legend>Site template</legend>
            <p>
              Five original, manga-focused layouts. Every option preserves the
              same content, permissions, cover ratio, and responsive behavior.
            </p>
            <div className="template-option-grid">
              {templateStyleOptions.map((option, index) => (
                <button
                  type="button"
                  key={option.value}
                  className={
                    settings.experience.template === option.value
                      ? "is-selected"
                      : ""
                  }
                  aria-pressed={
                    settings.experience.template === option.value
                  }
                  onClick={() =>
                    update("experience", {
                      ...settings.experience,
                      template: option.value,
                    })
                  }
                >
                  <span className={`template-mini template-mini-${index + 1}`}>
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="experience-control">
            <legend>Desktop featured carousel</legend>
            <p>
              Choose the large homepage carousel used on PC. Phone and tablet
              keep the existing touch-first composition.
            </p>
            <div className="slider-option-grid featured-slider-option-grid">
              {featuredSliderStyleOptions.map((option, index) => (
                <button
                  type="button"
                  key={option.value}
                  className={
                    settings.experience.featuredSliderStyle === option.value
                      ? "is-selected"
                      : ""
                  }
                  aria-pressed={
                    settings.experience.featuredSliderStyle === option.value
                  }
                  onClick={() =>
                    update("experience", {
                      ...settings.experience,
                      featuredSliderStyle: option.value,
                    })
                  }
                >
                  <span
                    className={`featured-slider-mini featured-slider-mini-${index + 1}`}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="experience-control">
            <legend>Trending and discovery shelves</legend>
            <p>
              Select how Trending and curated shelves behave. Cover artwork
              always remains in a fixed 2:3 frame.
            </p>
            <div className="slider-option-grid">
              {sliderStyleOptions.map((option, index) => (
                <button
                  type="button"
                  key={option.value}
                  className={
                    settings.experience.sliderStyle === option.value
                      ? "is-selected"
                      : ""
                  }
                  aria-pressed={
                    settings.experience.sliderStyle === option.value
                  }
                  onClick={() =>
                    update("experience", {
                      ...settings.experience,
                      sliderStyle: option.value,
                    })
                  }
                >
                  <span className={`slider-mini slider-mini-${index + 1}`}>
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>
            <div className="slider-behavior-controls">
              <div>
                <span>New Series layout</span>
                <div role="group" aria-label="New Series layout">
                  {newSeriesLayoutOptions.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={
                        settings.experience.newSeriesLayout === option.value
                      }
                      onClick={() =>
                        update("experience", {
                          ...settings.experience,
                          newSeriesLayout: option.value,
                        })
                      }
                    >
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="slider-behavior-controls">
              <div>
                <span>Cover size</span>
                <div role="group" aria-label="Slider cover size">
                  {sliderSizeOptions.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      aria-pressed={
                        settings.experience.sliderSize === option.value
                      }
                      onClick={() =>
                        update("experience", {
                          ...settings.experience,
                          sliderSize: option.value,
                        })
                      }
                    >
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </button>
                  ))}
                </div>
              </div>
              <label className="theme-switch">
                <input
                  type="checkbox"
                  checked={settings.experience.sliderAutoplay}
                  onChange={(event) =>
                    update("experience", {
                      ...settings.experience,
                      sliderAutoplay: event.target.checked,
                    })
                  }
                />
                <span>Automatically advance poster-style shelves</span>
              </label>
              <label>
                <span>
                  Autoplay interval ·{" "}
                  {settings.experience.sliderIntervalSeconds}s
                </span>
                <input
                  type="range"
                  min="3"
                  max="15"
                  value={settings.experience.sliderIntervalSeconds}
                  disabled={!settings.experience.sliderAutoplay}
                  onChange={(event) =>
                    update("experience", {
                      ...settings.experience,
                      sliderIntervalSeconds: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
          </fieldset>

          <div className="theme-brand-controls">
            {(
              [
                ["accent", "Brand accent"],
                ["accentStrong", "Accent hover"],
                ["accentInk", "Text on accent"],
                ["danger", "Danger"],
                ["warning", "Warning"],
                ["success", "Success"],
                ["premium", "Premium"],
              ] as const
            ).map(([field, label]) => (
              <label key={field}>
                <span>{label}</span>
                <PremiumColorPicker value={settings[field]} label={label} onChange={(next) => update(field, next.slice(0, 7))} />
                <code>{settings[field]}</code>
              </label>
            ))}
          </div>
          <div className="theme-palette-grid">
            <PaletteEditor title="Dark mode" value={settings.dark} onChange={(value) => update("dark", value)} />
            <PaletteEditor title="Light mode" value={settings.light} onChange={(value) => update("light", value)} />
          </div>
          <div className="theme-token-groups">
            <fieldset>
              <legend>Typography</legend>
              <label>
                <span>Font character</span>
                <UnifiedSingleSelect
                  value={settings.typography.family}
                  onChange={(event) =>
                    update("typography", {
                      ...settings.typography,
                      family: event.target
                        .value as SiteTheme["typography"]["family"],
                    })
                  }
                >
                  <option value="SYSTEM">System</option>
                  <option value="EDITORIAL">Editorial</option>
                  <option value="GEOMETRIC">Geometric</option>
                </UnifiedSingleSelect>
              </label>
              <label>
                <span>
                  Heading scale · {settings.typography.headingScale.toFixed(2)}
                </span>
                <input
                  type="range"
                  min="0.85"
                  max="1.3"
                  step="0.05"
                  value={settings.typography.headingScale}
                  onChange={(event) =>
                    update("typography", {
                      ...settings.typography,
                      headingScale: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>
                  Body scale · {settings.typography.bodyScale.toFixed(2)}
                </span>
                <input
                  type="range"
                  min="0.85"
                  max="1.2"
                  step="0.05"
                  value={settings.typography.bodyScale}
                  onChange={(event) =>
                    update("typography", {
                      ...settings.typography,
                      bodyScale: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Heading weight</span>
                <UnifiedSingleSelect value={settings.typography.headingWeight} onChange={(event) => update("typography", { ...settings.typography, headingWeight: Number(event.target.value) })}>
                  <option value="500">Medium · 500</option><option value="600">Semibold · 600</option><option value="700">Bold · 700</option><option value="760">Brand heavy · 760</option><option value="800">Extra bold · 800</option><option value="900">Black · 900</option>
                </UnifiedSingleSelect>
              </label>
              <label>
                <span>Body weight</span>
                <UnifiedSingleSelect value={settings.typography.bodyWeight} onChange={(event) => update("typography", { ...settings.typography, bodyWeight: Number(event.target.value) })}>
                  <option value="300">Light · 300</option><option value="400">Normal · 400</option><option value="500">Medium · 500</option><option value="600">Semibold · 600</option>
                </UnifiedSingleSelect>
              </label>
              <label>
                <span>Button and control weight</span>
                <UnifiedSingleSelect value={settings.typography.controlWeight} onChange={(event) => update("typography", { ...settings.typography, controlWeight: Number(event.target.value) })}>
                  <option value="400">Normal · 400</option><option value="500">Medium · 500</option><option value="600">Semibold · 600</option><option value="700">Bold · 700</option><option value="800">Extra bold · 800</option>
                </UnifiedSingleSelect>
              </label>
              <label>
                <span>Browse Format / Sort / Show weight</span>
                <UnifiedSingleSelect value={settings.typography.browseFilterWeight} onChange={(event) => update("typography", { ...settings.typography, browseFilterWeight: Number(event.target.value) })}>
                  <option value="300">Light · 300</option><option value="400">Normal · 400</option><option value="500">Medium · 500</option><option value="600">Semibold · 600</option><option value="700">Bold · 700</option>
                </UnifiedSingleSelect>
              </label>
            </fieldset>
            <fieldset>
              <legend>Layout and shape</legend>
              <label>
                <span>Spacing density</span>
                <UnifiedSingleSelect
                  value={settings.layout.spacingDensity}
                  onChange={(event) =>
                    update("layout", {
                      ...settings.layout,
                      spacingDensity: event.target
                        .value as SiteTheme["layout"]["spacingDensity"],
                    })
                  }
                >
                  <option value="COMPACT">Compact</option>
                  <option value="COMFORTABLE">Comfortable</option>
                  <option value="SPACIOUS">Spacious</option>
                </UnifiedSingleSelect>
              </label>
              <label>
                <span>Container width · {settings.layout.containerWidth}px</span>
                <input
                  type="range"
                  min="960"
                  max="1600"
                  step="20"
                  value={settings.layout.containerWidth}
                  onChange={(event) =>
                    update("layout", {
                      ...settings.layout,
                      containerWidth: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Button radius · {settings.layout.buttonRadius}px</span>
                <input
                  type="range"
                  min="0"
                  max="32"
                  value={settings.layout.buttonRadius}
                  onChange={(event) =>
                    update("layout", {
                      ...settings.layout,
                      buttonRadius: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Card radius · {settings.layout.cardRadius}px</span>
                <input
                  type="range"
                  min="0"
                  max="36"
                  value={settings.layout.cardRadius}
                  onChange={(event) =>
                    update("layout", {
                      ...settings.layout,
                      cardRadius: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                <span>Shadow strength · {settings.layout.shadowStrength}%</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.layout.shadowStrength}
                  onChange={(event) =>
                    update("layout", {
                      ...settings.layout,
                      shadowStrength: Number(event.target.value),
                    })
                  }
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>Navigation</legend>
              <label>
                <span>Navigation density</span>
                <UnifiedSingleSelect
                  value={settings.navigation.density}
                  onChange={(event) =>
                    update("navigation", {
                      ...settings.navigation,
                      density: event.target
                        .value as SiteTheme["navigation"]["density"],
                    })
                  }
                >
                  <option value="COMPACT">Compact</option>
                  <option value="COMFORTABLE">Comfortable</option>
                </UnifiedSingleSelect>
              </label>
              <label className="theme-switch">
                <input
                  type="checkbox"
                  checked={settings.navigation.stickyHeader}
                  onChange={(event) =>
                    update("navigation", {
                      ...settings.navigation,
                      stickyHeader: event.target.checked,
                    })
                  }
                />
                <span>Sticky header</span>
              </label>
              <label className="theme-switch">
                <input
                  type="checkbox"
                  checked={settings.navigation.showLabelsOnMobile}
                  onChange={(event) =>
                    update("navigation", {
                      ...settings.navigation,
                      showLabelsOnMobile: event.target.checked,
                    })
                  }
                />
                <span>Mobile navigation labels</span>
              </label>
            </fieldset>
          </div>
          <fieldset className="theme-gradient">
            <legend>Brand gradient</legend>
            <label className="theme-switch">
              <input
                type="checkbox"
                checked={settings.gradient.enabled}
                onChange={(event) => update("gradient", { ...settings.gradient, enabled: event.target.checked })}
              />
              <span>Use gradient on primary actions and brand moments</span>
            </label>
            <div>
              <label><span>From</span><PremiumColorPicker value={settings.gradient.from} label="From" onChange={(next) => update("gradient", { ...settings.gradient, from: next.slice(0, 7) })} /></label>
              <label><span>To</span><PremiumColorPicker value={settings.gradient.to} label="To" onChange={(next) => update("gradient", { ...settings.gradient, to: next.slice(0, 7) })} /></label>
              <label><span>Angle · {settings.gradient.angle}°</span><input type="range" min="0" max="360" value={settings.gradient.angle} onChange={(event) => update("gradient", { ...settings.gradient, angle: Number(event.target.value) })} /></label>
              <label><span>Intensity · {settings.gradient.intensity}%</span><input type="range" min="0" max="100" value={settings.gradient.intensity} onChange={(event) => update("gradient", { ...settings.gradient, intensity: Number(event.target.value) })} /></label>
              <label><span>Corner radius · {settings.radius}px</span><input type="range" min="0" max="28" value={settings.radius} onChange={(event) => update("radius", Number(event.target.value))} /></label>
            </div>
            <div className="theme-preview">
              <span>Live preview</span>
              <strong>Stories should feel this intentional.</strong>
              <em>Primary action</em>
            </div>
          </fieldset>
        </>
      ) : null}
      {message ? (
        <SystemNoticeBridge
          message={message}
          kind={status === "error" ? "error" : status === "saved" ? "success" : "info"}
        />
      ) : null}
    </section>
  );
}
