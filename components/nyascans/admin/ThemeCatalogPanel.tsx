import {
  CheckCircle,
  Crown,
  FloppyDisk,
  PaintBrush,
  UserCircle,
  WarningCircle,
} from "@/components/nyascans/heroicons";
import { useEffect, useMemo, useState } from "react";
import { DotsRing } from "@/components/nyascans/DotsRing";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";
import {
  THEME_CATALOG_SIZE,
  themeCatalogPolicySchema,
  type AdminThemeCatalog,
  type ThemeCatalogEntry,
} from "@/lib/theme-catalog";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";

type PanelStatus = "loading" | "idle" | "saving" | "saved" | "error";

function swatchStyle(entry: ThemeCatalogEntry) {
  return {
    background: `linear-gradient(145deg, ${entry.theme.tokens.mainBackground}, ${entry.theme.tokens.accentL2})`,
    color: entry.theme.tokens.textColor,
    borderColor: entry.theme.tokens.primary,
  };
}

function themeIdLabel(entry: ThemeCatalogEntry) {
  return entry.source === "PRESET"
    ? "Built-in preset"
    : `Created by ${entry.creatorDisplayName ?? "a NyaScans user"}`;
}

export function ThemeCatalogPanel() {
  const [document, setDocument] = useState<AdminThemeCatalog | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [defaultId, setDefaultId] = useState<string>("");
  const [status, setStatus] = useState<PanelStatus>("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dirty = Boolean(
    document &&
      (JSON.stringify(selectedIds) !== JSON.stringify(document.policy.suggestedThemeIds) ||
        defaultId !== document.policy.defaultThemeId),
  );
  useUnsavedChanges(dirty, "theme catalog");

  async function load() {
    setStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/v1/admin/theme-catalog", {
        cache: "no-store",
      });
      const payload = (await response.json()) as AdminThemeCatalog & {
        error?: { message?: string };
      };
      if (!response.ok || !payload.policy || !Array.isArray(payload.themes)) {
        throw new Error(payload.error?.message ?? "Theme catalog could not be loaded.");
      }
      setDocument(payload);
      setSelectedIds([...payload.policy.suggestedThemeIds]);
      setDefaultId(payload.policy.defaultThemeId);
      setStatus("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Theme catalog could not be loaded.");
      setStatus("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const defaultTheme = document?.themes.find((entry) => entry.id === defaultId) ?? null;
  const builtInThemes = document?.themes.filter((entry) => entry.source === "PRESET") ?? [];
  const userThemes = document?.themes.filter((entry) => entry.source === "USER") ?? [];

  function toggleSuggested(entry: ThemeCatalogEntry) {
    setMessage("");
    setError("");
    if (selectedSet.has(entry.id)) {
      if (selectedIds.length <= 1) return;
      const next = selectedIds.filter((id) => id !== entry.id);
      setSelectedIds(next);
      if (defaultId === entry.id) setDefaultId(next[0] ?? "");
      return;
    }
    if (selectedIds.length >= THEME_CATALOG_SIZE) {
      setError(`The suggested list already has ${THEME_CATALOG_SIZE} themes. Remove one before adding another.`);
      return;
    }
    setSelectedIds((current) => [...current, entry.id]);
  }

  function chooseDefault(entry: ThemeCatalogEntry) {
    setMessage("");
    setError("");
    if (!selectedSet.has(entry.id)) {
      setError("The default theme must be one of the five suggested themes.");
      return;
    }
    setDefaultId(entry.id);
  }

  function reset() {
    if (!document) return;
    setSelectedIds([...document.policy.suggestedThemeIds]);
    setDefaultId(document.policy.defaultThemeId);
    setMessage("");
    setError("");
  }

  async function save() {
    if (!document) return;
    const parsed = themeCatalogPolicySchema.safeParse({
      schemaVersion: 1,
      defaultThemeId: defaultId,
      suggestedThemeIds: selectedIds,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Choose exactly five suggested themes.");
      return;
    }
    setStatus("saving");
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/v1/admin/theme-catalog", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy: parsed.data, expectedRevision: document.revision }),
      });
      const payload = (await response.json()) as AdminThemeCatalog & {
        error?: { message?: string };
      };
      if (!response.ok || !payload.policy || !Array.isArray(payload.themes)) {
        throw new Error(payload.error?.message ?? "Theme catalog could not be saved.");
      }
      setDocument(payload);
      setSelectedIds([...payload.policy.suggestedThemeIds]);
      setDefaultId(payload.policy.defaultThemeId);
      setStatus("saved");
      setMessage("Theme catalog saved. New users will see these five themes first.");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Theme catalog could not be saved.");
    }
  }

  if (status === "loading") {
    return (
      <section className="theme-catalog-state" role="status">
        <DotsRing size={24} />
        <strong>Loading all available themes</strong>
        <span>Reading built-in presets and saved user-created themes.</span>
      </section>
    );
  }

  if (!document) {
    return (
      <section className="theme-catalog-state is-error" role="alert">
        <WarningCircle size={24} />
        <strong>Theme catalog unavailable</strong>
        <span>{error || "The catalog could not be loaded."}</span>
        <button className="button button-secondary" type="button" onClick={() => void load()}>
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="theme-catalog-panel">
      <header className="theme-catalog-header">
        <div>
          <span className="ops-kicker"><PaintBrush size={17} /> Global theme selection</span>
          <h2>Choose the five themes users see first</h2>
          <p>
            Browse every built-in preset and saved user theme. The default is applied to new accounts;
            the other selected entries remain in the first quick-switch list.
          </p>
        </div>
        <div className="theme-catalog-summary" aria-live="polite">
          <strong>{selectedIds.length} / {THEME_CATALOG_SIZE}</strong>
          <span>suggested themes</span>
          <small>{defaultTheme ? `Default: ${defaultTheme.theme.name}` : "Choose a default"}</small>
        </div>
      </header>

      {error ? <SystemNoticeBridge message={error} kind="error" /> : null}
      {message ? <SystemNoticeBridge message={message} kind="success" /> : null}

      <section className="theme-catalog-policy-window" aria-labelledby="theme-catalog-policy-title">
        <div className="theme-catalog-window-heading">
          <div>
            <span>Published selection</span>
            <h3 id="theme-catalog-policy-title">Active five and default</h3>
          </div>
          <div className="admin-header-actions">
            <button className="button button-secondary" type="button" onClick={reset} disabled={!dirty || status === "saving"}>
              Reset
            </button>
            <button className="button button-primary" type="button" onClick={() => void save()} disabled={!dirty || status === "saving"}>
              <FloppyDisk size={17} /> {status === "saving" ? "Saving…" : "Save catalog"}
            </button>
          </div>
        </div>
        <p className="theme-catalog-policy-help">
          Select exactly five. Use the crown control to mark which selected theme is the default for all new users.
        </p>
        <div className="theme-catalog-selected-list">
          {selectedIds.map((id, index) => {
            const entry = document.themes.find((candidate) => candidate.id === id);
            if (!entry) return null;
            const isDefault = defaultId === id;
            return (
              <article className={isDefault ? "is-default" : undefined} key={id}>
                <span className="theme-catalog-rank">{index + 1}</span>
                <span className="theme-catalog-swatch" style={swatchStyle(entry)} aria-hidden="true" />
                <div>
                  <strong>{entry.theme.name}</strong>
                  <small>{themeIdLabel(entry)}</small>
                </div>
                <span className="theme-catalog-selected-label">
                  {isDefault ? <><Crown size={15} weight="fill" /> Default for new users</> : "Suggested"}
                </span>
              </article>
            );
          })}
        </div>
      </section>

      <section className="theme-catalog-library-window" aria-labelledby="theme-catalog-library-title">
        <div className="theme-catalog-window-heading">
          <div>
            <span>Available library</span>
            <h3 id="theme-catalog-library-title">Built-in and user-created themes</h3>
          </div>
          <span className="theme-catalog-count">{document.themes.length} available</span>
        </div>
        <div className="theme-catalog-group">
          <h4>Built-in presets <span>{builtInThemes.length}</span></h4>
          <div className="theme-catalog-grid">
            {builtInThemes.map((entry) => (
              <ThemeCatalogCard
                key={entry.id}
                entry={entry}
                selected={selectedSet.has(entry.id)}
                defaultTheme={defaultId === entry.id}
                onToggle={() => toggleSuggested(entry)}
                onDefault={() => chooseDefault(entry)}
              />
            ))}
          </div>
        </div>
        <div className="theme-catalog-group">
          <h4>User-created themes <span>{userThemes.length}</span></h4>
          {userThemes.length ? (
            <div className="theme-catalog-grid">
              {userThemes.map((entry) => (
                <ThemeCatalogCard
                  key={entry.id}
                  entry={entry}
                  selected={selectedSet.has(entry.id)}
                  defaultTheme={defaultId === entry.id}
                  onToggle={() => toggleSuggested(entry)}
                  onDefault={() => chooseDefault(entry)}
                />
              ))}
            </div>
          ) : (
            <div className="theme-catalog-empty"><UserCircle size={22} /><span>No user-created themes are available yet.</span></div>
          )}
        </div>
      </section>
    </section>
  );
}

function ThemeCatalogCard({
  entry,
  selected,
  defaultTheme,
  onToggle,
  onDefault,
}: {
  entry: ThemeCatalogEntry;
  selected: boolean;
  defaultTheme: boolean;
  onToggle: () => void;
  onDefault: () => void;
}) {
  return (
    <article className={`theme-catalog-card${selected ? " is-selected" : ""}${defaultTheme ? " is-default" : ""}`}>
      <div className="theme-catalog-card-preview" style={swatchStyle(entry)}>
        <span>{entry.theme.type === "dark" ? "Dark" : "Light"}</span>
        <strong>{entry.theme.name}</strong>
        <i style={{ backgroundColor: entry.theme.tokens.primary }} />
        <i style={{ backgroundColor: entry.theme.tokens.homePinnedSeriesAccent }} />
        <i style={{ backgroundColor: entry.theme.tokens.effectMovingLight }} />
      </div>
      <div className="theme-catalog-card-copy">
        <small>{themeIdLabel(entry)}</small>
        {entry.creatorIsAdministrator ? <small className="is-staff">Administrator-created</small> : null}
      </div>
      <div className="theme-catalog-card-actions">
        <button type="button" className={selected ? "is-active" : undefined} aria-pressed={selected} onClick={onToggle}>
          {selected ? <CheckCircle size={16} weight="fill" /> : null}{selected ? "Suggested" : "Add to five"}
        </button>
        <button type="button" className={defaultTheme ? "is-default" : undefined} aria-pressed={defaultTheme} disabled={!selected} onClick={onDefault}>
          <Crown size={16} weight={defaultTheme ? "fill" : "regular"} /> {defaultTheme ? "Default" : "Set default"}
        </button>
      </div>
    </article>
  );
}
