"use client";

import Link from "next/link";
import { SiteConfigurationPanel } from "@/components/nyascans/SiteConfigurationPanel";
import { ThemeSettingsPanel } from "@/components/nyascans/ThemeSettingsPanel";
import { AdminPageScaffold } from "@/components/nyascans/admin/AdminPageScaffold";
import { ThemePalettePresetsPanel } from "@/components/nyascans/admin/ThemePalettePresetsPanel";

type AppearanceTab =
  | "branding"
  | "reader"
  | "footer"
  | "theme"
  | "palettes"
  | "preview";

export function AppearanceWorkspace({
  initialTab = "branding",
  onTabChange,
}: {
  initialTab?: AppearanceTab;
  onTabChange(tab: AppearanceTab): void;
}) {
  const tab = initialTab;

  function changeTab(value: string) {
    const next = value as AppearanceTab;
    if (next === tab) return;
    window.sessionStorage.setItem("nyascans-admin-appearance-tab", next);
    onTabChange(next);
  }

  return (
    <AdminPageScaffold
      breadcrumbs={["Administration", "Appearance"]}
      kicker="Brand system"
      title="Appearance"
      description="Manage public branding, reader assets, social links, design tokens, and an unsaved local preview without exposing raw CSS."
      tabs={[
        { key: "branding", label: "Branding" },
        { key: "reader", label: "Reader assets" },
        { key: "footer", label: "Footer & social" },
        { key: "theme", label: "Colors, typography & layout" },
        { key: "palettes", label: "Ready-to-use palettes" },
        { key: "preview", label: "Advanced preview" },
      ]}
      activeTab={tab}
      onTabChange={changeTab}
    >
      <div className="appearance-workspace-panels">
        {["branding", "reader", "footer"].includes(tab) ? (
          <SiteConfigurationPanel
            section={tab as "branding" | "reader" | "footer"}
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
