"use client";
import Link from "next/link";
import { SiteConfigurationPanel } from "@/components/nyascans/SiteConfigurationPanel";
import { ThemeSettingsPanel } from "@/components/nyascans/ThemeSettingsPanel";
import { AdminPageScaffold } from "@/components/nyascans/admin/AdminPageScaffold";
import { ThemePalettePresetsPanel } from "@/components/nyascans/admin/ThemePalettePresetsPanel";

type AppearanceTab =
  | "branding"
  | "homepage"
  | "reader"
  | "footer"
  | "legal"
  | "shortcuts"
  | "theme"
  | "palettes"
  | "preview";

export type AppearanceWorkspaceKind =
  | "branding-appearance"
  | "footer-legal"
  | "keyboard-shortcuts";

const appearanceTabs: Array<{ key: AppearanceTab; label: string }> = [
  { key: "branding", label: "Branding" },
  { key: "homepage", label: "Homepage layout" },
  { key: "reader", label: "Header assets" },
  { key: "theme", label: "Colors, typography & layout" },
  { key: "palettes", label: "Ready-to-use palettes" },
  { key: "preview", label: "Advanced preview" },
];

const footerLegalTabs: Array<{ key: AppearanceTab; label: string }> = [
  { key: "footer", label: "Footer & social" },
  { key: "legal", label: "Legal documents" },
];

export function AppearanceWorkspace({
  workspace = "branding-appearance",
  initialTab,
  onTabChange,
}: {
  workspace?: AppearanceWorkspaceKind;
  initialTab?: AppearanceTab;
  onTabChange?(tab: AppearanceTab): void;
}) {
  const tabs =
    workspace === "branding-appearance"
      ? appearanceTabs
      : workspace === "footer-legal"
        ? footerLegalTabs
        : [];
  const defaultTab =
    workspace === "footer-legal"
      ? "footer"
      : workspace === "keyboard-shortcuts"
        ? "shortcuts"
        : "branding";
  const tab =
    initialTab &&
    (initialTab === "shortcuts" || tabs.some((entry) => entry.key === initialTab))
      ? initialTab
      : defaultTab;
  const page =
    workspace === "footer-legal"
      ? {
          kicker: "Public policy",
          title: "Footer & Legal",
          description:
            "Manage footer link groups, social destinations, and the public legal documents readers rely on.",
        }
      : workspace === "keyboard-shortcuts"
        ? {
            kicker: "Interaction settings",
            title: "Keyboard Shortcuts",
            description:
              "Maintain the site-wide shortcut registry and keep every key assignment discoverable.",
          }
        : {
            kicker: "Brand system",
            title: "Branding & Appearance",
            description:
              "Manage public branding, reader assets, design tokens, palettes, and a safe local preview without exposing raw CSS.",
          };

  function changeTab(value: string) {
    const next = value as AppearanceTab;
    if (next === tab) return;
    window.sessionStorage.setItem("nyascans-admin-appearance-tab", next);
    onTabChange?.(next);
  }

  return (
    <AdminPageScaffold
      breadcrumbs={["Administration", "Settings", page.title]}
      kicker={page.kicker}
      title={page.title}
      description={page.description}
      tabs={tabs}
      activeTab={tab}
      onTabChange={changeTab}
    >
      <div className="appearance-workspace-panels">
        { ["branding", "homepage", "reader", "footer", "legal", "shortcuts"].includes(tab) ? (
          <SiteConfigurationPanel
            section={tab as "branding" | "homepage" | "reader" | "footer" | "legal" | "shortcuts"}
          />
        ) : null}
        <div hidden={tab !== "theme"} aria-hidden={tab !== "theme"}>
          <ThemeSettingsPanel />
        </div>
        <div hidden={tab !== "palettes"} aria-hidden={tab !== "palettes"}>
          <ThemePalettePresetsPanel />
        </div>
        {tab === "preview" ? (
          <section className="appearance-component-preview">
            <header>
              <div>
                <span>Unsaved local preview</span>
                <h3>Representative interface components</h3>
                <p>
                  Theme edits are applied only to this browser until the
                  administrator publishes them.
                </p>
              </div>
              <nav aria-label="Preview navigation">
                <a href="#preview-series">Series</a>
                <a href="#preview-reader">Reader</a>
                <span>Account</span>
              </nav>
            </header>
            <div className="appearance-preview-grid">
              <article id="preview-series" className="appearance-preview-card">
                <span className="appearance-preview-cover">2:3 cover</span>
                <div>
                  <small>Manga · Ongoing</small>
                  <h4>The Moon Courier</h4>
                  <p>A representative series card using the current design tokens.</p>
                  <Link className="button button-primary" href="/browse">
                    View series
                  </Link>
                </div>
              </article>
              <article className="appearance-preview-chapter">
                <div><strong>Chapter 24</strong><span>Updated moments ago</span></div>
                <em>Free</em>
                <span>Read</span>
              </article>
              <article id="preview-reader" className="appearance-preview-reader">
                <span>Reader canvas</span>
                <div>
                  <span>Previous</span>
                  <strong>12 / 32</strong>
                  <span>Next</span>
                </div>
              </article>
              <article className="appearance-preview-dialog">
                <small>Dialog preview</small>
                <h4>Publish appearance?</h4>
                <p>All validated token groups will update atomically.</p>
                <div>
                  <span className="button button-secondary">Cancel</span>
                  <span className="button button-primary">Publish</span>
                </div>
              </article>
              <article className="appearance-preview-mobile">
                <span>Mobile sample</span>
                <strong>NyaScans</strong>
                <span>Browse</span>
                <span>Library</span>
                <span>Store</span>
              </article>
            </div>
          </section>
        ) : null}
      </div>
    </AdminPageScaffold>
  );
}
