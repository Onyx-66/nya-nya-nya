"use client";

import {
  ArrowClockwise,
  Check,
  ClipboardText,
  DownloadSimple,
  FloppyDisk,
  LinkSimple,
  Palette,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { ThemeController } from "@/components/nyascans/UserThemeSystem";
import { themeForPreset } from "@/components/nyascans/UserThemeSystem";
import {
  cloneTheme,
  cssVariableForToken,
  parseThemeImport,
  themeContrastWarnings,
  themeDocumentSchema,
  themeShareUrl,
  themeTokenGroups,
  themeTokenLabels,
  userThemePresets,
  THEME_IMPORT_LIMIT,
  type PresetThemeId,
  type ThemeDocument,
  type ThemeTokenKey,
} from "@/lib/theme-system";

type ThemeBuilderProps = {
  controller: ThemeController;
  notify?: (message: string) => void;
};

function TokenEditor({
  token,
  value,
  onChange,
}: {
  token: ThemeTokenKey;
  value: string;
  onChange: (value: string) => void;
}) {
  const [input, setInput] = useState(value);
  const [error, setError] = useState("");

  function commit(next: string) {
    const normalized = next.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/u.test(normalized)) {
      setError("Enter a six-digit hex color.");
      return;
    }
    setError("");
    setInput(normalized);
    onChange(normalized);
  }

  return (
    <label className="theme-token-row">
      <span>
        <strong>{themeTokenLabels[token]}</strong>
        <code>{cssVariableForToken(token)}</code>
      </span>
      <span className="theme-token-control">
        <input
          className="theme-color-picker"
          type="color"
          value={value}
          aria-label={`Pick ${themeTokenLabels[token]}`}
          onChange={(event) => commit(event.target.value)}
        />
        <input
          className={error ? "theme-hex-input is-invalid" : "theme-hex-input"}
          value={input}
          inputMode="text"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-label={`${themeTokenLabels[token]} hexadecimal value`}
          onChange={(event) => {
            setInput(event.target.value);
            if (/^#[0-9a-fA-F]{6}$/u.test(event.target.value)) {
              commit(event.target.value);
            }
          }}
          onBlur={() => commit(input)}
        />
        {error ? <small role="alert">{error}</small> : null}
      </span>
    </label>
  );
}

function ThemePreview({ theme }: { theme: ThemeDocument }) {
  return (
    <section className="theme-preview" aria-labelledby="theme-preview-title">
      <header>
        <span>
          <small>Live canvas</small>
          <h2 id="theme-preview-title">Preview</h2>
        </span>
        <em>{theme.type}</em>
      </header>
      <div className="theme-preview-panel">
        <nav className="theme-preview-tabs" aria-label="Preview tabs">
          <button type="button" className="is-active">Latest</button>
          <button type="button">Popular</button>
          <button type="button">Following</button>
        </nav>
        <div className="theme-preview-copy">
          <small>Sample series</small>
          <h3>The Cat Who Read Beyond the Panel</h3>
          <p>
            Main text follows <code>Text Color</code>, while this supporting copy
            uses the shared mid-tone bridge.
          </p>
          <a href="#theme-token-editor" onClick={(event) => event.preventDefault()}>
            Accent text sample
          </a>
        </div>
        <div className="theme-preview-buttons" aria-label="Button states">
          <button type="button" className="theme-preview-button is-default">Default</button>
          <button type="button" className="theme-preview-button is-hover">Hover</button>
          <button type="button" className="theme-preview-button is-active">Active</button>
          <button type="button" className="theme-preview-button is-alternate">Alternate</button>
          <button type="button" className="theme-preview-button is-danger">Danger</button>
          <button type="button" className="theme-preview-button is-danger-hover">Danger hover</button>
          <button type="button" className="theme-preview-button is-danger-active">Danger active</button>
        </div>
        <div className="theme-preview-surface-states" aria-label="Main accent states">
          <span>Accent</span>
          <span>Hover</span>
          <span>Active</span>
        </div>
        <div className="theme-preview-levels" aria-label="Accent levels">
          {[1, 2, 3, 4, 5].map((level) => (
            <span key={level} data-level={level}>
              <strong>L{level}</strong>
              <i>Base</i>
              <i>Hover</i>
              <i>Active</i>
            </span>
          ))}
        </div>
        <div className="theme-preview-statuses" aria-label="Status colors">
          {[
            ["red", "Blocked"],
            ["green", "Published"],
            ["yellow", "Pending"],
            ["blue", "Updated"],
            ["purple", "Featured"],
            ["grey", "Archived"],
          ].map(([tone, label]) => (
            <span key={tone} data-status={tone}><i />{label}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ThemeBuilderPage({ controller, notify }: ThemeBuilderProps) {
  const [draft, setDraft] = useState<ThemeDocument>(() =>
    cloneTheme(controller.customTheme ?? controller.currentTheme),
  );
  const [basePreset, setBasePreset] = useState<PresetThemeId>("nya-midnight");
  const [importValue, setImportValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [contrastAccepted, setContrastAccepted] = useState(false);
  const initialized = useRef(false);
  const initializationScheduled = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const {
    hydrated,
    customTheme,
    currentTheme,
    applyPreview,
    restoreActiveTheme,
  } = controller;

  const contrastWarnings = useMemo(
    () => themeContrastWarnings(draft),
    [draft],
  );

  useEffect(() => {
    if (!hydrated || initializationScheduled.current) return;
    initializationScheduled.current = true;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      initialized.current = true;
      let initial = cloneTheme(customTheme ?? currentTheme);
      if (window.location.hash.includes("theme=")) {
        try {
          initial = parseThemeImport(window.location.href);
          setMessage("Shared theme imported into the builder. Save it to keep it.");
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "The shared theme is invalid.",
          );
        }
      }
      setDraft(initial);
      applyPreview(initial);
    });
    return () => {
      cancelled = true;
    };
  }, [applyPreview, currentTheme, customTheme, hydrated]);

  useEffect(() => {
    if (!initialized.current) return;
    applyPreview(draft);
  }, [applyPreview, draft]);

  useEffect(
    () => () => {
      restoreActiveTheme();
    },
    [restoreActiveTheme],
  );

  function updateDraft(next: ThemeDocument) {
    const parsed = themeDocumentSchema.parse(next);
    setDraft(parsed);
    setContrastAccepted(false);
    setMessage("");
    setError("");
  }

  function applyImport(raw: string) {
    try {
      const imported = parseThemeImport(raw);
      updateDraft(imported);
      setImportValue(JSON.stringify(imported, null, 2));
      setMessage("Complete theme imported. Review the live preview, then save.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The theme is invalid.");
      setMessage("");
    }
  }

  async function saveTheme() {
    if (!controller.hydrated || controller.syncing) {
      setError("Wait for your saved account theme to finish loading.");
      return;
    }
    if (contrastWarnings.length && !contrastAccepted) {
      setError("Confirm the contrast warning before saving this theme.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await controller.saveCustomTheme(draft);
      const savedMessage = controller.signedIn
        ? "Custom theme saved to your account and applied."
        : "Custom theme saved in this browser and applied.";
      setMessage(savedMessage);
      notify?.(savedMessage);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The theme could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function loadSavedTheme() {
    if (!controller.customTheme) {
      setError("No saved custom theme was found. Build or import one first.");
      return;
    }
    updateDraft(cloneTheme(controller.customTheme));
    setMessage("Saved custom theme loaded into the builder.");
  }

  async function copyShareUrl() {
    const url = themeShareUrl(draft, window.location.href);
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Theme URL copied. Anyone opening it can import this exact theme.");
      setError("");
    } catch {
      setImportValue(url);
      setMessage("Clipboard access was blocked, so the share URL is selected below.");
    }
  }

  function exportTheme() {
    const blob = new Blob([`${JSON.stringify(draft, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "nyascans-theme"}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage("Theme JSON exported.");
    setError("");
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > THEME_IMPORT_LIMIT) {
      setError("The selected theme file is larger than 64 KB.");
      return;
    }
    applyImport(await file.text());
  }

  return (
    <main className="theme-builder-page page-main" id="theme-token-editor">
      <section className="theme-builder-hero page-wrap">
        <div>
          <p className="eyebrow"><Palette size={16} /> Personal appearance</p>
          <h1>Theme Builder</h1>
          <p>
            Tune every NyaScans color token and watch real interface states update
            instantly. Custom themes never change the administrator’s base design.
          </p>
        </div>
        <div className="theme-builder-save-state">
          <span>{controller.signedIn ? "Account sync" : "Browser storage"}</span>
          <strong>{controller.syncing || saving ? "Saving…" : "Ready"}</strong>
        </div>
      </section>

      <div className="theme-builder-layout page-wrap">
        <div className="theme-builder-editor">
          <section className="theme-builder-card theme-builder-basics">
            <header>
              <div><small>Theme identity</small><h2>Start and save</h2></div>
            </header>
            <div className="theme-builder-fields">
              <label>
                <span>Theme name</span>
                <input
                  value={draft.name}
                  maxLength={48}
                  onChange={(event) =>
                    updateDraft({ ...draft, name: event.target.value || "Untitled theme" })
                  }
                />
              </label>
              <label>
                <span>Theme type</span>
                <select
                  value={draft.type}
                  onChange={(event) =>
                    updateDraft({ ...draft, type: event.target.value as "dark" | "light" })
                  }
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label>
                <span>Import system theme</span>
                <span className="theme-builder-inline-control">
                  <select
                    value={basePreset}
                    onChange={(event) => setBasePreset(event.target.value as PresetThemeId)}
                  >
                    {userThemePresets.map((preset) => (
                      <option value={preset.id} key={preset.id}>{preset.theme.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      updateDraft(themeForPreset(basePreset));
                      setMessage(`${themeForPreset(basePreset).name} loaded as your editable base.`);
                    }}
                  >
                    Use base
                  </button>
                </span>
              </label>
            </div>
            <div className="theme-builder-actions">
              <button
                className="button button-primary"
                type="button"
                onClick={() => void saveTheme()}
                disabled={saving || !controller.hydrated || controller.syncing}
              >
                <FloppyDisk size={17} /> {saving ? "Saving…" : "Save theme"}
              </button>
              <button className="button button-secondary" type="button" onClick={loadSavedTheme}>
                <ArrowClockwise size={17} /> Load saved theme
              </button>
              <button className="button button-secondary" type="button" onClick={() => void copyShareUrl()}>
                <LinkSimple size={17} /> Copy theme URL
              </button>
              <button className="button button-secondary" type="button" onClick={exportTheme}>
                <DownloadSimple size={17} /> Export theme
              </button>
            </div>
            {controller.syncError ? (
              <div className="theme-builder-message is-error" role="alert">
                <WarningCircle size={18} />
                <span>{controller.syncError}</span>
                <button type="button" onClick={controller.clearSyncError}>Dismiss</button>
              </div>
            ) : null}
            {error ? <div className="theme-builder-message is-error" role="alert"><WarningCircle size={18} />{error}</div> : null}
            {message ? <div className="theme-builder-message is-success" role="status"><Check size={18} />{message}</div> : null}
          </section>

          <section className="theme-builder-card theme-import-card">
            <header>
              <div><small>Portable themes</small><h2>Import theme</h2></div>
              <ClipboardText size={22} />
            </header>
            <p>Paste a shared NyaScans theme URL or the complete exported JSON. Validation is atomic: incomplete themes are never applied.</p>
            <textarea
              value={importValue}
              onChange={(event) => setImportValue(event.target.value)}
              placeholder="https://…/theme-builder#theme=… or { &quot;schemaVersion&quot;: 1, … }"
              aria-label="Theme URL or JSON"
            />
            <div className="theme-builder-actions">
              <button className="button button-primary" type="button" onClick={() => applyImport(importValue)}>
                <UploadSimple size={17} /> Import theme
              </button>
              <button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()}>
                <UploadSimple size={17} /> Choose JSON file
              </button>
              <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void importFile(event)} />
            </div>
          </section>

          {contrastWarnings.length ? (
            <section className="theme-builder-card theme-contrast-warning">
              <header><div><small>Accessibility check</small><h2>Low contrast detected</h2></div><WarningCircle size={23} /></header>
              <p>The colors remain unrestricted, but these essential pairs miss WCAG guidance:</p>
              <ul>
                {contrastWarnings.map((warning) => (
                  <li key={warning.id}><strong>{warning.label}</strong><span>{warning.ratio.toFixed(2)}:1 · target {warning.minimum}:1</span></li>
                ))}
              </ul>
              <label className="theme-contrast-confirm">
                <input type="checkbox" checked={contrastAccepted} onChange={(event) => setContrastAccepted(event.target.checked)} />
                <span>I understand and want to save these colors.</span>
              </label>
            </section>
          ) : null}

          {themeTokenGroups.map((group) => (
            <section className="theme-builder-card theme-token-group" key={group.name}>
              <header><div><small>Design tokens</small><h2>{group.name}</h2></div><span>{group.tokens.length}</span></header>
              <div className="theme-token-list">
                {group.tokens.map((token) => (
                  <TokenEditor
                    key={`${token}-${draft.tokens[token]}`}
                    token={token}
                    value={draft.tokens[token]}
                    onChange={(value) => updateDraft({ ...draft, tokens: { ...draft.tokens, [token]: value } })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
        <aside className="theme-builder-preview-column">
          <ThemePreview theme={draft} />
        </aside>
      </div>
    </main>
  );
}
