"use client";
import {
  ArrowClockwise,
  Check,
  ClipboardText,
  DownloadSimple,
  FloppyDisk,
  LinkSimple,
  Palette,
  Plus,
  Trash,
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
import { ThemeAwareLogo } from "@/components/nyascans/ThemeAwareLogo";
import type { ThemeController } from "@/components/nyascans/UserThemeSystem";
import { themeForPreset } from "@/components/nyascans/UserThemeSystem";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
import {
  blankThemeMarkdownTemplate,
  blankThemeTemplate,
  cloneTheme,
  cssVariableForToken,
  customThemeReference,
  exportThemeMarkdown,
  isCustomThemeReference,
  MAX_SAVED_CUSTOM_THEMES,
  MAX_SHORTLISTED_THEMES,
  parseThemeImport,
  themeContrastWarnings,
  themeDocumentSchema,
  themeShareUrl,
  themeTokenGroups,
  type ThemeShareFormat,
  themeTokenLabels,
  userThemePresets,
  THEME_IMPORT_LIMIT,
  type CustomThemeId,
  type PresetThemeId,
  type SavedCustomTheme,
  type ThemeDocument,
  type ThemeTokenKey,
} from "@/lib/theme-system";

const previewHomeSections = [
  ["featured", "Featured"],
  ["trending", "Trending"],
  ["continue", "Continue reading"],
  ["pinned", "Pinned Series"],
  ["reviews", "Recent Reviews"],
  ["discounts", "Discounts"],
  ["announcements", "Announcements"],
  ["latest", "Latest Updates"],
  ["editors", "Editor's Pick"],
  ["new-series", "New Series"],
  ["teams", "Publishing Teams"],
  ["community", "Recent Comments"],
  ["hot", "Hot This Week"],
] as const;

const previewNotificationKinds = [
  ["success", "Saved"],
  ["info", "Information"],
  ["warning", "Needs attention"],
  ["error", "Action failed"],
] as const;

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
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = value;
    }
  }, [value]);

  function commit(next: string) {
    const normalized = next.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/u.test(normalized)) {
      setError("Enter a six-digit hex color.");
      return;
    }
    setError("");
    if (inputRef.current) inputRef.current.value = normalized;
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
          ref={inputRef}
          className={error ? "theme-hex-input is-invalid" : "theme-hex-input"}
          defaultValue={value}
          inputMode="text"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-label={`${themeTokenLabels[token]} hexadecimal value`}
          onChange={(event) => {
            if (/^#[0-9a-fA-F]{6}$/u.test(event.target.value)) {
              commit(event.target.value);
            }
          }}
          onBlur={(event) => commit(event.currentTarget.value)}
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
        <div className="theme-preview-logo" aria-label="Theme-aware logo preview">
          <ThemeAwareLogo title="NyaScans theme-aware placeholder logo" />
          <span>{theme.logoColorOverride ? "Fixed logo color" : "Automatic logo colors"}</span>
        </div>
        <div className="theme-preview-tabs" aria-label="Preview tabs">
          <span className="is-active">Latest</span>
          <span>Popular</span>
          <span>Following</span>
        </div>
        <div className="theme-preview-copy">
          <small>Sample series</small>
          <h3>The Cat Who Read Beyond the Panel</h3>
          <p>
            Main text follows <code>Text Color</code>, while this supporting copy
            uses the shared mid-tone bridge.
          </p>
          <strong>Accent text sample</strong>
        </div>
        <div className="theme-preview-buttons" aria-label="Button states">
          <span className="theme-preview-button is-default">Default</span>
          <span className="theme-preview-button is-hover">Hover</span>
          <span className="theme-preview-button is-active">Active</span>
          <span className="theme-preview-button is-alternate">Alternate</span>
          <span className="theme-preview-button is-danger">Danger</span>
          <span className="theme-preview-button is-danger-hover">Danger hover</span>
          <span className="theme-preview-button is-danger-active">Danger active</span>
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
        <section className="theme-preview-audit-block" aria-labelledby="theme-preview-sections-title">
          <div className="theme-preview-audit-heading">
            <small>Home sections</small>
            <h3 id="theme-preview-sections-title">Section accents</h3>
          </div>
          <div className="theme-preview-section-grid">
            {previewHomeSections.map(([section, label]) => (
              <span key={section} data-preview-section={section}>
                <i aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </section>
        <section className="theme-preview-audit-block" aria-labelledby="theme-preview-effects-title">
          <div className="theme-preview-audit-heading">
            <small>Effects &amp; glows</small>
            <h3 id="theme-preview-effects-title">Moving light</h3>
          </div>
          <div className="theme-preview-effect-stage">
            <div className="theme-preview-effect-header">
              <span aria-hidden="true">✦</span>
              <strong>Animated section header</strong>
              <button type="button">View all</button>
            </div>
            <div className="theme-preview-effect-specimens">
              <span className="is-badge">Badge</span>
              <span className="is-cover">Cover</span>
              <span className="is-button">Button</span>
              <span className="is-paid">Paid</span>
              <span className="is-discount">−25%</span>
              <span className="is-announcement">Notice</span>
            </div>
            <div className="theme-preview-rank-glows" aria-label="Rank glow colors">
              <span className="is-gold">1</span>
              <span className="is-silver">2</span>
              <span className="is-bronze">3</span>
            </div>
          </div>
        </section>
        <section className="theme-preview-audit-block" aria-labelledby="theme-preview-notifications-title">
          <div className="theme-preview-audit-heading">
            <small>Notification system</small>
            <h3 id="theme-preview-notifications-title">Bell, list &amp; toasts</h3>
          </div>
          <div className="theme-preview-notification-stage">
            <div className="theme-preview-notification-bell" aria-label="Notification bell badge preview">
              <span aria-hidden="true">♢</span><b>3</b>
            </div>
            <div className="theme-preview-notification-menu">
              <strong>Notifications</strong>
              <span className="is-unread"><i />New chapter released</span>
              <span className="is-read"><i />Review received</span>
            </div>
            <div className="theme-preview-toast-list">
              {previewNotificationKinds.map(([kind, label]) => (
                <span key={kind} data-notification-kind={kind}>
                  <i aria-hidden="true" />{label}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function ThemeSwatch({ theme }: { theme: ThemeDocument }) {
  return (
    <i
      className="theme-library-swatch"
      aria-hidden="true"
      style={{
        background: `conic-gradient(from 35deg, ${theme.tokens.primary}, ${theme.tokens.accentL3}, ${theme.tokens.mainBackground}, ${theme.tokens.primary})`,
      }}
    />
  );
}

export function ThemeBuilderPage({ controller, notify }: ThemeBuilderProps) {
  const [draft, setDraft] = useState<ThemeDocument>(() =>
    cloneTheme(controller.currentTheme),
  );
  const [draftName, setDraftName] = useState(controller.currentTheme.name);
  const [editingThemeId, setEditingThemeId] = useState<CustomThemeId | null>(null);
  const [loadThemeId, setLoadThemeId] = useState<CustomThemeId | "">("");
  const [basePreset, setBasePreset] = useState<PresetThemeId>("nya-midnight");
  const [importValue, setImportValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [contrastAccepted, setContrastAccepted] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set([themeTokenGroups[0]?.id ?? "core-palette"]),
  );
  const initialized = useRef(false);
  const initializationScheduled = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLTextAreaElement>(null);
  const {
    hydrated,
    currentTheme,
    customThemes,
    applyPreview,
    restoreActiveTheme,
  } = controller;

  const namedDraft = useMemo(
    () => themeDocumentSchema.parse({
      ...draft,
      name: draftName.trim() || "Untitled theme",
    }),
    [draft, draftName],
  );
  const contrastWarnings = useMemo(
    () => themeContrastWarnings(namedDraft),
    [namedDraft],
  );

  function clearFeedback() {
    setMessage("");
    setError("");
  }

  function confirmDiscard(nextAction: string) {
    return !dirty || window.confirm(
      `Discard the unsaved edits in this builder and ${nextAction}? Your saved theme will not be changed.`,
    );
  }

  function setEditor(
    theme: ThemeDocument,
    themeId: CustomThemeId | null,
    nextMessage: string,
    nextDirty = false,
    name = theme.name,
  ) {
    const parsed = cloneTheme(theme);
    setDraft(parsed);
    setDraftName(name);
    setEditingThemeId(themeId);
    setLoadThemeId(themeId ?? "");
    setDirty(nextDirty);
    setContrastAccepted(false);
    setError("");
    setMessage(nextMessage);
  }

  useEffect(() => {
    if (!hydrated || initializationScheduled.current) return;
    initializationScheduled.current = true;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      initialized.current = true;
      const activeSaved = isCustomThemeReference(controller.activeThemeId)
        ? customThemes.find(
            (saved) => customThemeReference(saved.id) === controller.activeThemeId,
          ) ?? null
        : null;
      let initial = cloneTheme(activeSaved?.theme ?? currentTheme);
      let initialId = activeSaved?.id ?? null;
      let initialDirty = false;
      let initialMessage = "";
      let initialError = "";
      if (window.location.hash.includes("theme=")) {
        try {
          initial = parseThemeImport(window.location.href);
          initialId = null;
          initialDirty = true;
          initialMessage = "Shared theme imported as a new unsaved draft.";
        } catch (caught) {
          initialError = caught instanceof Error
            ? caught.message
            : "The shared theme is invalid.";
        }
      }
      setEditor(initial, initialId, initialMessage, initialDirty);
      if (initialError) setError(initialError);
      applyPreview(initial);
    });
    return () => {
      cancelled = true;
    };
  }, [applyPreview, controller.activeThemeId, currentTheme, customThemes, hydrated]);

  useEffect(() => {
    if (!initialized.current) return;
    applyPreview(namedDraft);
  }, [applyPreview, controller.preference, namedDraft]);

  useEffect(
    () => () => {
      restoreActiveTheme();
    },
    [restoreActiveTheme],
  );

  function updateDraft(next: ThemeDocument, editedGroupId?: string) {
    const parsed = themeDocumentSchema.parse(next);
    setDraft(parsed);
    setDirty(true);
    setContrastAccepted(false);
    if (editedGroupId) {
      setOpenGroups((current) => {
        const nextOpen = new Set(current);
        nextOpen.add(editedGroupId);
        return nextOpen;
      });
    }
    clearFeedback();
  }

  function toggleGroup(groupId: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function expandAllGroups() {
    setOpenGroups(new Set(themeTokenGroups.map((group) => group.id)));
  }

  function collapseAllGroups() {
    setOpenGroups(new Set());
  }

  function createNew() {
    if (!confirmDiscard("create a new theme")) return;
    const base = themeForPreset(basePreset);
    setEditor(
      base,
      null,
      `${base.name} is ready as a new unsaved base.`,
      false,
      "",
    );
  }

  function applyImport(raw: string) {
    if (!confirmDiscard("import another theme")) return;
    try {
      const imported = parseThemeImport(raw);
      setEditor(
        imported,
        null,
        "Complete theme imported as a new draft. Review it, then save.",
        true,
      );
      setImportValue(JSON.stringify(imported, null, 2));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The theme is invalid.");
      setMessage("");
    }
  }

  async function saveTheme() {
    if (!controller.hydrated || controller.syncing) {
      setError("Wait for your saved account themes to finish loading.");
      return;
    }
    if (!draftName.trim()) {
      setError("Enter a theme name before saving.");
      return;
    }
    if (
      !editingThemeId &&
      customThemes.length >= MAX_SAVED_CUSTOM_THEMES
    ) {
      setError("Delete a saved theme to create a new one.");
      return;
    }
    if (contrastWarnings.length && !contrastAccepted) {
      setError("Confirm the contrast warning before saving this theme.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const document = themeDocumentSchema.parse({
        ...draft,
        name: draftName.trim(),
      });
      const saved = await controller.saveCustomTheme(document, editingThemeId);
      setEditor(
        saved.theme,
        saved.id,
        controller.signedIn
          ? "Theme saved to your account and applied."
          : "Theme saved in this browser and applied.",
      );
      notify?.("Theme saved and applied.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The theme could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function loadSavedTheme(themeId = loadThemeId) {
    if (!themeId) {
      setError("Choose a saved theme to load.");
      return;
    }
    if (!confirmDiscard("load the selected saved theme")) return;
    const saved = customThemes.find((theme) => theme.id === themeId);
    if (!saved) {
      setError("The selected saved theme no longer exists.");
      return;
    }
    setEditor(saved.theme, saved.id, `${saved.theme.name} loaded for editing.`);
  }

  async function deleteTheme(saved: SavedCustomTheme) {
    if (controller.syncing || saving) return;
    if (!window.confirm(
      `Delete “${saved.theme.name}” permanently? This is the only action that removes a saved theme.`,
    )) return;
    setError("");
    try {
      await controller.deleteCustomTheme(saved.id);
      if (editingThemeId === saved.id) {
        const base = themeForPreset(basePreset);
        setEditor(base, null, `${saved.theme.name} was deleted. A new unsaved draft is open.`, false, "");
      } else {
        setMessage(`${saved.theme.name} was deleted.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The theme could not be deleted.");
    }
  }

  async function toggleShortlist(saved: SavedCustomTheme) {
    if (controller.syncing || saving) return;
    const reference = customThemeReference(saved.id);
    const selected = controller.shortlist.includes(reference);
    if (selected && controller.activeThemeId === reference) {
      setError("Apply another theme before removing the active theme from your shortlist.");
      return;
    }
    if (!selected && controller.shortlist.length >= MAX_SHORTLISTED_THEMES) {
      setError("Your shortlist is full. Remove another theme before adding this one.");
      return;
    }
    try {
      await controller.setShortlist(
        selected
          ? controller.shortlist.filter((entry) => entry !== reference)
          : [...controller.shortlist, reference],
      );
      setMessage(
        selected
          ? `${saved.theme.name} was removed from quick switching.`
          : `${saved.theme.name} was added to quick switching.`,
      );
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The shortlist could not be changed.");
    }
  }

  async function applySavedTheme(saved: SavedCustomTheme) {
    if (controller.syncing || saving) return;
    setError("");
    try {
      await controller.selectTheme(customThemeReference(saved.id));
      setMessage(`${saved.theme.name} is now active.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The theme could not be applied.");
    }
  }

  function portableDraft() {
    if (!draftName.trim()) {
      setError("Enter a theme name before sharing or exporting.");
      return null;
    }
    return themeDocumentSchema.parse({ ...draft, name: draftName.trim() });
  }

  async function copyShareUrl(format: ThemeShareFormat) {
    const document = portableDraft();
    if (!document) return;
    const url = themeShareUrl(document, window.location.href, format);
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`${format === "markdown" ? "Markdown" : "JSON"} theme URL copied. Anyone opening it can import this exact theme.`);
      setError("");
    } catch {
      setImportValue(url);
      requestAnimationFrame(() => {
        importInput.current?.focus();
        importInput.current?.select();
      });
      setMessage(`Clipboard access was blocked. The ${format === "markdown" ? "Markdown" : "JSON"} share URL is selected below.`);
    }
  }

  function downloadTextFile(filename: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function exportTheme() {
    const portable = portableDraft();
    if (!portable) return;
    downloadTextFile(
      `${draftName.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "nyascans-theme"}.json`,
      `${JSON.stringify(portable, null, 2)}\n`,
      "application/json",
    );
    setMessage("Theme JSON exported.");
    setError("");
  }

  function downloadBlankTemplate() {
    const template = blankThemeTemplate();
    downloadTextFile(
      "nyascans-blank-theme-template.json",
      `${JSON.stringify(template, null, 2)}\n`,
      "application/json",
    );
    setMessage(
      `Blank template downloaded with every ${Object.keys(template.tokens).length} token key. Fill every color before importing it.`,
    );
    setError("");
  }

  function exportMarkdownTheme() {
    const portable = portableDraft();
    if (!portable) return;
    downloadTextFile(
      `${draftName.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "nyascans-theme"}.md`,
      exportThemeMarkdown(portable),
      "text/markdown",
    );
    setMessage("Theme Markdown exported.");
    setError("");
  }

  function downloadBlankMarkdownTemplate() {
    downloadTextFile(
      "nyascans-blank-theme-template.md",
      blankThemeMarkdownTemplate(),
      "text/markdown",
    );
    setMessage("Blank Markdown template downloaded.");
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
          <span>{controller.signedIn ? "Account + site storage" : "Browser storage"}</span>
          <strong>{controller.syncing || saving ? "Saving…" : `${customThemes.length} / ${MAX_SAVED_CUSTOM_THEMES} saved`}</strong>
        </div>
      </section>

      <div className="theme-builder-layout page-wrap">
        <div className="theme-builder-editor">
          <section className="theme-builder-card theme-builder-basics">
            <header>
              <div><small>Theme identity</small><h2>Start and save</h2></div>
              <span>{editingThemeId ? "Editing saved theme" : "New unsaved theme"}</span>
            </header>
            <div className="theme-builder-fields">
              <label>
                <span>Theme name</span>
                <input
                  value={draftName}
                  maxLength={48}
                  placeholder="Name this theme"
                  onChange={(event) => {
                    setDraftName(event.target.value);
                    setDirty(true);
                    clearFeedback();
                  }}
                />
              </label>
              <label>
                <span>Theme type</span>
                <UnifiedSingleSelect
                  value={draft.type}
                  onChange={(event) =>
                    updateDraft({ ...draft, type: event.target.value as "dark" | "light" })
                  }
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </UnifiedSingleSelect>
              </label>
              <label>
                <span>Import system theme</span>
                <span className="theme-builder-inline-control">
                  <UnifiedSingleSelect
                    value={basePreset}
                    onChange={(event) => setBasePreset(event.target.value as PresetThemeId)}
                  >
                    {userThemePresets.map((preset) => (
                      <option value={preset.id} key={preset.id}>{preset.theme.name}</option>
                    ))}
                  </UnifiedSingleSelect>
                  <button type="button" onClick={createNew}>Use as new base</button>
                </span>
              </label>
              <label>
                <span>Load theme</span>
                <span className="theme-builder-inline-control">
                  <UnifiedSingleSelect
                    value={loadThemeId}
                    onChange={(event) => setLoadThemeId(event.target.value as CustomThemeId | "")}
                    disabled={!customThemes.length}
                  >
                    <option value="">{customThemes.length ? "Choose saved theme" : "No saved themes yet"}</option>
                    {customThemes.map((saved) => (
                      <option key={saved.id} value={saved.id}>{saved.theme.name}</option>
                    ))}
                  </UnifiedSingleSelect>
                  <button type="button" onClick={() => loadSavedTheme()} disabled={!customThemes.length}>Load</button>
                </span>
              </label>
            </div>

            <fieldset className="theme-logo-color-control">
              <legend>Logo color</legend>
              <p>Automatic binds the prepared SVG parts to Text, Primary, and Contrast tokens. Custom fixes every designated part to one color.</p>
              <div>
                <label>
                  <input
                    type="radio"
                    name="logo-color-mode"
                    checked={!draft.logoColorOverride}
                    onChange={() => updateDraft({ ...draft, logoColorOverride: null })}
                  />
                  <span>Automatic</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="logo-color-mode"
                    checked={Boolean(draft.logoColorOverride)}
                    onChange={() => updateDraft({
                      ...draft,
                      logoColorOverride: draft.logoColorOverride ?? draft.tokens.primary,
                    })}
                  />
                  <span>Custom</span>
                </label>
                <input
                  type="color"
                  aria-label="Custom logo color"
                  value={draft.logoColorOverride ?? draft.tokens.primary}
                  disabled={!draft.logoColorOverride}
                  onChange={(event) => updateDraft({
                    ...draft,
                    logoColorOverride: event.target.value.toUpperCase(),
                  })}
                />
                <code>{draft.logoColorOverride ?? "Token-matched"}</code>
              </div>
            </fieldset>

            <div className="theme-builder-actions">
              <button
                className="button button-primary"
                type="button"
                onClick={() => void saveTheme()}
                disabled={saving || !controller.hydrated || controller.syncing}
              >
                <FloppyDisk size={17} /> {saving ? "Saving…" : "Save theme"}
              </button>
              <button className="button button-secondary" type="button" onClick={() => loadSavedTheme()} disabled={!customThemes.length}>
                <ArrowClockwise size={17} /> Load theme
              </button>
              <button className="button button-secondary" type="button" onClick={createNew}>
                <Plus size={17} /> Create new
              </button>
              <button className="button button-secondary" type="button" onClick={() => void copyShareUrl("json")}>
                <LinkSimple size={17} /> Copy JSON URL
              </button>
              <button className="button button-secondary" type="button" onClick={() => void copyShareUrl("markdown")}>
                <LinkSimple size={17} /> Copy Markdown URL
              </button>
              <button className="button button-secondary" type="button" onClick={exportTheme}>
                <DownloadSimple size={17} /> Export JSON
              </button>
              <button className="button button-secondary" type="button" onClick={exportMarkdownTheme}>
                <DownloadSimple size={17} /> Export Markdown
              </button>
              <button className="button button-secondary" type="button" onClick={downloadBlankTemplate}>
                <DownloadSimple size={17} /> Blank JSON template
              </button>
              <button className="button button-secondary" type="button" onClick={downloadBlankMarkdownTemplate}>
                <DownloadSimple size={17} /> Blank Markdown template
              </button>
            </div>
            <p className="theme-builder-save-note">
              Edits stay in this builder until you choose Save. Create new never overwrites the loaded theme.
            </p>
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

          <section className="theme-builder-card theme-library-card" id="manage-themes">
            <header>
              <div><small>Saved custom themes</small><h2>Theme library</h2></div>
              <span>{customThemes.length} / {MAX_SAVED_CUSTOM_THEMES} saved</span>
            </header>
            <p>
              Saved account themes remain until you explicitly delete one. Your quick-switch shortlist holds up to {MAX_SHORTLISTED_THEMES} presets or custom themes.
            </p>
            {customThemes.length ? (
              <div className="theme-library-list">
                {customThemes.map((saved) => {
                  const reference = customThemeReference(saved.id);
                  const shortlisted = controller.shortlist.includes(reference);
                  const active = controller.activeThemeId === reference;
                  return (
                    <article key={saved.id} className={active ? "is-active" : undefined}>
                      <ThemeSwatch theme={saved.theme} />
                      <div>
                        <strong>{saved.theme.name}</strong>
                        <small>Custom · {saved.theme.type} · revision {saved.revision}</small>
                      </div>
                      <div className="theme-library-actions">
                        <button type="button" onClick={() => void applySavedTheme(saved)} disabled={active || controller.syncing || saving}>
                          {active ? <Check size={15} /> : null}{active ? "Active" : "Apply"}
                        </button>
                        <button type="button" onClick={() => loadSavedTheme(saved.id)}>Load / edit</button>
                        <button type="button" onClick={() => void toggleShortlist(saved)} aria-pressed={shortlisted} disabled={controller.syncing || saving || (active && shortlisted)}>
                          {shortlisted ? "Shortlisted" : "Add to shortlist"}
                        </button>
                        <button className="is-danger" type="button" onClick={() => void deleteTheme(saved)} aria-label={`Delete ${saved.theme.name}`} disabled={controller.syncing || saving}>
                          <Trash size={16} /> Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="theme-library-empty">
                <Palette size={24} />
                <span>No custom themes saved yet. Create or import one, then choose Save theme.</span>
              </div>
            )}
          </section>

          <section className="theme-builder-card theme-import-card">
            <header>
              <div><small>Portable themes</small><h2>Import theme</h2></div>
              <ClipboardText size={22} />
            </header>
            <p>Paste a shared NyaScans theme URL, exported JSON, or human-readable Markdown. Validation is atomic: incomplete themes are never applied.</p>
            <textarea
              ref={importInput}
              value={importValue}
              onChange={(event) => setImportValue(event.target.value)}
              placeholder="https://…/theme-builder#theme=…, complete JSON, or NyaScans Markdown"
              aria-label="Theme URL, JSON, or Markdown"
            />
            <div className="theme-builder-actions">
              <button className="button button-primary" type="button" onClick={() => applyImport(importValue)}>
                <UploadSimple size={17} /> Import theme
              </button>
              <button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()}>
                <UploadSimple size={17} /> Choose JSON / Markdown file
              </button>
              <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json,text/markdown,.md" onChange={(event) => void importFile(event)} />
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

          <section className="theme-builder-card theme-token-groups-toolbar" aria-label="Theme token group controls">
            <div>
              <small>Per-section controls</small>
              <h2>Token groups</h2>
              <p>Each group is independent. Core Palette opens first; editing any group keeps that group open for continued work.</p>
            </div>
            <div className="theme-token-group-actions">
              <button className="button button-secondary" type="button" onClick={expandAllGroups}>Expand all</button>
              <button className="button button-secondary" type="button" onClick={collapseAllGroups}>Collapse all</button>
            </div>
          </section>
          {themeTokenGroups.map((group) => {
            const isOpen = openGroups.has(group.id);
            const groupPanelId = `theme-token-group-${group.id}`;
            return (
              <section className={`theme-builder-card theme-token-group${isOpen ? " is-open" : ""}`} data-group-id={group.id} key={group.id}>
                <header>
                  <button
                    className="theme-token-group-toggle"
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={groupPanelId}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span>
                      <small>Design tokens</small>
                      <h2>{group.name}</h2>
                      <p>{group.description}</p>
                    </span>
                    <strong aria-hidden="true">{isOpen ? "−" : "+"}</strong>
                  </button>
                  <span className="theme-token-group-count">{group.tokens.length} {group.tokens.length === 1 ? "token" : "tokens"}</span>
                </header>
                {isOpen ? (
                  <div className="theme-token-list" id={groupPanelId}>
                    {group.tokens.map((token) => (
                      <TokenEditor
                        key={token}
                        token={token}
                        value={draft.tokens[token]}
                        onChange={(value) => updateDraft({ ...draft, tokens: { ...draft.tokens, [token]: value } }, group.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        <aside className="theme-builder-preview-column">
          <ThemePreview theme={namedDraft} />
        </aside>
      </div>
    </main>
  );
}
