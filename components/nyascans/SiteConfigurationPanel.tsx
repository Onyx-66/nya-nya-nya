"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  FileImage,
  FloppyDisk,
  LinkSimple,
  Plus,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { broadcastSiteConfiguration } from "@/components/nyascans/useSiteConfiguration";
import {
  defaultSiteConfiguration,
  parseSiteConfiguration,
  siteMediaUrl,
  type SiteConfiguration,
  type SiteSocialLink,
} from "@/lib/site-configuration";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";
import { optimizeStaticMedia } from "@/lib/client/media-optimizer";

type SiteConfigurationResponse = {
  settings: SiteConfiguration;
  revision: number;
  recoveredFromInvalid?: boolean;
};

function linkId(label: string, taken: Set<string>) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "link";
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

type ConfigurationSection = "branding" | "reader" | "footer";
type MediaSlot = "logo" | "compact" | "app" | "first" | "last";
type PendingMedia = { file: File; url: string } | null;

const emptyPendingMedia: Record<MediaSlot, PendingMedia> = {
  logo: null,
  compact: null,
  app: null,
  first: null,
  last: null,
};

const emptyPendingRemovals: Record<MediaSlot, boolean> = {
  logo: false,
  compact: false,
  app: false,
  first: false,
  last: false,
};

export function SiteConfigurationPanel({
  section = "branding",
}: {
  section?: ConfigurationSection;
}) {
  const [settings, setSettings] = useState<SiteConfiguration>(
    defaultSiteConfiguration,
  );
  const [saved, setSaved] = useState<SiteConfiguration>(
    defaultSiteConfiguration,
  );
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<
    "loading" | "idle" | "saving" | "saved" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [recoveredFromInvalid, setRecoveredFromInvalid] = useState(false);
  const [pendingMedia, setPendingMedia] =
    useState<Record<MediaSlot, PendingMedia>>({ ...emptyPendingMedia });
  const pendingMediaRef = useRef(pendingMedia);
  const [pendingRemovals, setPendingRemovals] =
    useState<Record<MediaSlot, boolean>>({ ...emptyPendingRemovals });
  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const mediaDirty =
    Object.values(pendingMedia).some(Boolean) ||
    Object.values(pendingRemovals).some(Boolean);
  const dirty = settingsDirty || mediaDirty;
  useUnsavedChanges(dirty, "appearance configuration");

  useEffect(() => {
    pendingMediaRef.current = pendingMedia;
  }, [pendingMedia]);

  useEffect(
    () => () => {
      for (const pending of Object.values(pendingMediaRef.current)) {
        if (pending?.url) URL.revokeObjectURL(pending.url);
      }
    },
    [],
  );

  function clearPendingMedia() {
    for (const pending of Object.values(pendingMediaRef.current)) {
      if (pending?.url) URL.revokeObjectURL(pending.url);
    }
    setPendingMedia({ ...emptyPendingMedia });
    setPendingRemovals({ ...emptyPendingRemovals });
  }

  async function load() {
    setStatus("loading");
    try {
      const response = await fetch("/api/v1/admin/site-configuration", {
        cache: "no-store",
      });
      const payload = (await response.json()) as SiteConfigurationResponse & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Site configuration could not be loaded.",
        );
      }
      const normalized = parseSiteConfiguration(payload.settings);
      setSettings(normalized);
      setSaved(normalized);
      setRevision(Number(payload.revision ?? 0));
      setRecoveredFromInvalid(Boolean(payload.recoveredFromInvalid));
      clearPendingMedia();
      setHasLoaded(true);
      setStatus("idle");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Site configuration could not be loaded.",
      );
      setStatus("error");
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
    // The explicit Retry action owns subsequent loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    let persisted = false;
    let currentRevision = revision;
    try {
      if (settingsDirty) {
        const response = await fetch("/api/v1/admin/site-configuration", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            settings,
            expectedRevision: currentRevision,
          }),
        });
        const payload = (await response.json()) as SiteConfigurationResponse & {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Site configuration could not be saved.",
          );
        }
        const normalized = parseSiteConfiguration(payload.settings);
        currentRevision = Number(payload.revision ?? currentRevision + 1);
        setSettings(normalized);
        setSaved(normalized);
        setRevision(currentRevision);
        setRecoveredFromInvalid(false);
        broadcastSiteConfiguration(normalized, currentRevision);
        persisted = true;
      }
      for (const slot of Object.keys(emptyPendingMedia) as MediaSlot[]) {
        const pending = pendingMedia[slot];
        if (!pending && !pendingRemovals[slot]) continue;
        setUploading(slot);
        const response = pending
          ? await (() => {
              return optimizeStaticMedia(pending.file, {
                maxWidth: slot === "logo" ? 2_400 : 1_200,
                maxHeight: slot === "logo" ? 1_200 : 1_200,
                maxBytes: 2_500_000,
              }).then((prepared) => {
              const body = new FormData();
              body.set("file", prepared);
              body.set("expectedRevision", String(currentRevision));
              return fetch(`/api/v1/admin/site-media?slot=${slot}`, {
                method: "POST",
                body,
              });
              });
            })()
          : await fetch(
              `/api/v1/admin/site-media?slot=${slot}&expectedRevision=${currentRevision}`,
              { method: "DELETE" },
            );
        const payload = (await response.json()) as SiteConfigurationResponse & {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "The staged image could not be saved.",
          );
        }
        const normalized = parseSiteConfiguration(payload.settings);
        currentRevision = Number(payload.revision ?? currentRevision + 1);
        setSettings(normalized);
        setSaved(normalized);
        setRevision(currentRevision);
        setRecoveredFromInvalid(false);
        broadcastSiteConfiguration(normalized, currentRevision);
        if (pending?.url) URL.revokeObjectURL(pending.url);
        setPendingMedia((current) => ({ ...current, [slot]: null }));
        setPendingRemovals((current) => ({ ...current, [slot]: false }));
        persisted = true;
      }
      setMessage("Branding, footer links, and reader pages are live.");
      setStatus("saved");
    } catch (error) {
      setMessage(
        persisted
          ? `Some configuration was published, but a staged media action failed: ${
              error instanceof Error ? error.message : "try the remaining image again"
            }. The latest saved revision was retained.`
          : error instanceof Error
            ? error.message
            : "Site configuration could not be saved.",
      );
      setStatus("error");
    } finally {
      setUploading(null);
    }
  }

  function upload(
    slot: MediaSlot,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingMedia((current) => {
      if (current[slot]?.url) URL.revokeObjectURL(current[slot]!.url);
      return {
        ...current,
        [slot]: { file, url: URL.createObjectURL(file) },
      };
    });
    setPendingRemovals((current) => ({ ...current, [slot]: false }));
    setStatus("idle");
    setMessage("Image staged locally. Save configuration to publish it.");
  }

  function removeMedia(slot: MediaSlot) {
    if (!window.confirm("Stage this image for removal?")) {
      return;
    }
    setPendingMedia((current) => {
      if (current[slot]?.url) URL.revokeObjectURL(current[slot]!.url);
      return { ...current, [slot]: null };
    });
    setPendingRemovals((current) => ({ ...current, [slot]: true }));
    setStatus("idle");
    setMessage("Image removal staged. Save configuration to publish it.");
  }

  const media = useMemo(
    () =>
      [
        {
          group: "branding" as const,
          slot: "logo" as const,
          label: "Site logo",
          detail: "Shown in the main header, footer, and access screens.",
          recommendation: "512 × 512 px, square PNG or WebP",
          value: settings.brand.logo,
          url: pendingMedia.logo?.url ??
            (pendingRemovals.logo
              ? null
              : siteMediaUrl("logo", settings.brand.logo)),
        },
        {
          group: "branding" as const,
          slot: "compact" as const,
          label: "Compact/mobile logo",
          detail: "Used where the full brand mark would be too large.",
          recommendation: "256 × 256 px, square PNG or WebP",
          value: settings.brand.compactLogo,
          url: pendingMedia.compact?.url ??
            (pendingRemovals.compact
              ? null
              : siteMediaUrl("compact", settings.brand.compactLogo)),
        },
        {
          group: "branding" as const,
          slot: "app" as const,
          label: "App icon",
          detail: "A compact icon for installable and device surfaces.",
          recommendation: "512 × 512 px, square PNG or WebP",
          value: settings.brand.appIcon,
          url: pendingMedia.app?.url ??
            (pendingRemovals.app
              ? null
              : siteMediaUrl("app", settings.brand.appIcon)),
        },
        {
          group: "reader" as const,
          slot: "first" as const,
          label: "Fixed first page",
          detail: "Inserted before page 1 of every readable chapter.",
          recommendation: "1200 × 1800 px, portrait",
          value: settings.reader.firstPage,
          url: pendingMedia.first?.url ??
            (pendingRemovals.first
              ? null
              : siteMediaUrl("first", settings.reader.firstPage)),
        },
        {
          group: "reader" as const,
          slot: "last" as const,
          label: "Fixed last page",
          detail: "Inserted after the final page of every readable chapter.",
          recommendation: "1200 × 1800 px, portrait",
          value: settings.reader.lastPage,
          url: pendingMedia.last?.url ??
            (pendingRemovals.last
              ? null
              : siteMediaUrl("last", settings.reader.lastPage)),
        },
      ].filter((item) => item.group === section),
    [pendingMedia, pendingRemovals, section, settings],
  );

  function setMediaEnabled(
    slot: "logo" | "compact" | "app" | "first" | "last",
    enabled: boolean,
  ) {
    setSettings((current) => {
      if (slot === "logo" || slot === "compact" || slot === "app") {
        const key =
          slot === "logo"
            ? "logo"
            : slot === "compact"
              ? "compactLogo"
              : "appIcon";
        return {
          ...current,
          brand: {
            ...current.brand,
            [key]: { ...current.brand[key], enabled },
          },
        };
      }
      const key = slot === "first" ? "firstPage" : "lastPage";
      return {
        ...current,
        reader: {
          ...current.reader,
          [key]: { ...current.reader[key], enabled },
        },
      };
    });
  }

  function updateSocialLink(
    index: number,
    patch: Partial<SiteSocialLink>,
  ) {
    setSettings((current) => ({
      ...current,
      footer: {
        ...current.footer,
        socialLinks: current.footer.socialLinks.map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, ...patch } : entry,
        ),
      },
    }));
  }

  function moveSocialLink(index: number, direction: -1 | 1) {
    setSettings((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.footer.socialLinks.length) {
        return current;
      }
      const links = [...current.footer.socialLinks];
      [links[index], links[target]] = [links[target]!, links[index]!];
      return {
        ...current,
        footer: {
          ...current.footer,
          socialLinks: links.map((link, order) => ({
            ...link,
            order: order * 10,
          })),
        },
      };
    });
  }

  if (!hasLoaded && status === "error") {
    return (
      <section className="admin-state-card" role="alert">
        <FileImage size={24} />
        <h3>Site configuration unavailable</h3>
        <p>{message || "The saved site configuration could not be loaded."}</p>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void load()}
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <form className="site-configuration-panel" onSubmit={save}>
      <header>
        <div>
          <span className="ops-kicker">
            <FileImage size={17} /> Site identity
          </span>
          <h2>
            {section === "branding"
              ? "Branding"
              : section === "reader"
                ? "Reader assets"
                : "Footer and social links"}
          </h2>
          <p>
            {section === "branding"
              ? "Manage the public name, description, and responsive brand marks."
              : section === "reader"
                ? "Manage reusable fixed chapter pages without changing release files."
                : "Validate, preview, order, and publish public destinations."}
          </p>
        </div>
        <div className="admin-header-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={!dirty || status === "saving"}
            onClick={() => {
              setSettings(saved);
              clearPendingMedia();
              setStatus("idle");
              setMessage("Unsaved changes were reset.");
            }}
          >
            Reset to saved
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={
              status === "loading" || status === "saving" || !dirty
            }
          >
            <FloppyDisk size={17} />
            {status === "saving" ? "Saving…" : "Save configuration"}
          </button>
        </div>
      </header>
      {recoveredFromInvalid ? (
        <div className="admin-notice is-warning" role="alert">
          <strong>Recovery defaults loaded</strong>
          <span>
            The saved site configuration was invalid. Review these safe
            defaults and save to replace the damaged branding and link data.
          </span>
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="settings-loading">Loading site configuration…</div>
      ) : (
        <>
          {section === "branding" ? (
          <section className="site-identity-fields">
            <label>
              <span>Site name</span>
              <input
                value={settings.brand.siteName}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    brand: {
                      ...current.brand,
                      siteName: event.target.value,
                    },
                  }))
                }
                required
              />
            </label>
            <label>
              <span>Logo alternative text</span>
              <input
                value={settings.brand.logoAlt}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    brand: {
                      ...current.brand,
                      logoAlt: event.target.value,
                    },
                  }))
                }
                required
              />
            </label>
            <label>
              <span>Short description</span>
              <textarea
                value={settings.brand.shortDescription}
                maxLength={240}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    brand: {
                      ...current.brand,
                      shortDescription: event.target.value,
                    },
                  }))
                }
              />
            </label>
          </section>
          ) : null}

          {section !== "footer" ? (
          <section className="site-media-grid">
            {media.map((item) => (
              <article key={item.slot}>
                <div className="site-media-preview">
                  {item.url ? (
                    <img src={item.url} alt="" />
                  ) : (
                    <FileImage size={30} />
                  )}
                </div>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                  <small>{item.recommendation}</small>
                  <label className="button button-secondary">
                    <UploadSimple size={16} />
                    {uploading === item.slot
                      ? "Publishing…"
                      : item.url
                        ? "Replace image"
                        : "Choose image"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={uploading !== null}
                      onChange={(event) => upload(item.slot, event)}
                    />
                  </label>
                  {item.url ? (
                    <button
                      className="button button-ghost"
                      type="button"
                      disabled={uploading !== null}
                      onClick={() => removeMedia(item.slot)}
                    >
                      <Trash size={16} /> Stage removal
                    </button>
                  ) : null}
                  <label className="site-media-enable">
                    <input
                      type="checkbox"
                      checked={item.value.enabled}
                      disabled={
                        (!item.value.key && !pendingMedia[item.slot]) ||
                        pendingRemovals[item.slot]
                      }
                      onChange={(event) =>
                        setMediaEnabled(item.slot, event.target.checked)
                      }
                    />
                    Enabled
                  </label>
                </div>
              </article>
            ))}
          </section>
          ) : null}

          {section === "footer" ? (
          <section className="site-social-settings">
            <div className="control-section-heading">
              <div>
                <span>Footer destinations</span>
                <h3>Support and social links</h3>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSettings((current) => {
                    const taken = new Set(
                      current.footer.socialLinks.map((link) => link.id),
                    );
                    return {
                      ...current,
                      footer: {
                        ...current.footer,
                        socialLinks: [
                          ...current.footer.socialLinks,
                          {
                            id: linkId("New link", taken),
                            label: "New link",
                            url: "",
                            enabled: false,
                            icon: "LINK",
                            order:
                              current.footer.socialLinks.reduce(
                                (maximum, link) =>
                                  Math.max(maximum, link.order),
                                0,
                              ) + 10,
                            openInNewTab: true,
                          },
                        ],
                      },
                    };
                  })
                }
              >
                <Plus size={16} /> Add link
              </button>
            </div>
            <div className="site-social-list">
              {settings.footer.socialLinks.map((link, index) => (
                <article key={link.id}>
                  <LinkSimple size={18} />
                  <label>
                    <span>Icon</span>
                    <select
                      value={link.icon}
                      onChange={(event) =>
                        updateSocialLink(index, {
                          icon: event.target.value as SiteSocialLink["icon"],
                        })
                      }
                    >
                      <option value="SUPPORT">Support</option>
                      <option value="DISCORD">Discord</option>
                      <option value="INSTAGRAM">Instagram</option>
                      <option value="X">X</option>
                      <option value="YOUTUBE">YouTube</option>
                      <option value="TIKTOK">TikTok</option>
                      <option value="MASTODON">Mastodon</option>
                      <option value="BLUESKY">Bluesky</option>
                      <option value="LINK">Generic link</option>
                    </select>
                  </label>
                  <label>
                    <span>Label</span>
                    <input
                      value={link.label}
                      onChange={(event) =>
                        updateSocialLink(index, {
                          label: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    <span>Destination</span>
                    <input
                      value={link.url}
                      placeholder="https://… or /support"
                      onChange={(event) =>
                        updateSocialLink(index, { url: event.target.value })
                      }
                    />
                  </label>
                  <label className="site-social-enabled">
                    <input
                      type="checkbox"
                      checked={link.enabled}
                      disabled={!link.url}
                      onChange={(event) =>
                        updateSocialLink(index, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                    Visible
                  </label>
                  <label className="site-social-enabled">
                    <input
                      type="checkbox"
                      checked={link.openInNewTab}
                      onChange={(event) =>
                        updateSocialLink(index, {
                          openInNewTab: event.target.checked,
                        })
                      }
                    />
                    New tab
                  </label>
                  <div className="site-social-order">
                    <button
                      type="button"
                      aria-label={`Move ${link.label} up`}
                      disabled={index === 0}
                      onClick={() => moveSocialLink(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${link.label} down`}
                      disabled={index === settings.footer.socialLinks.length - 1}
                      onClick={() => moveSocialLink(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${link.label}`}
                    disabled={link.id === "support"}
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        footer: {
                          ...current.footer,
                          socialLinks: current.footer.socialLinks.filter(
                            (_, entryIndex) => entryIndex !== index,
                          ),
                        },
                      }))
                    }
                  >
                    <Trash size={17} />
                  </button>
                </article>
              ))}
            </div>
            <nav
              className="site-social-preview"
              aria-label="Footer link preview"
            >
              {settings.footer.socialLinks
                .filter((link) => link.enabled && link.url)
                .sort((left, right) => left.order - right.order)
                .map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target={link.openInNewTab ? "_blank" : undefined}
                    rel={link.openInNewTab ? "noreferrer" : undefined}
                  >
                    <span>{link.icon}</span>
                    {link.label}
                  </a>
                ))}
              {!settings.footer.socialLinks.some(
                (link) => link.enabled && link.url,
              ) ? (
                <p>Enabled links will appear here.</p>
              ) : null}
            </nav>
          </section>
          ) : null}
        </>
      )}

      {message ? (
        <div
          className={`site-configuration-message ${
            status === "error" ? "is-error" : ""
          }`}
          role={status === "error" ? "alert" : "status"}
        >
          {status !== "error" ? <CheckCircle size={18} /> : null}
          {message}
        </div>
      ) : null}
    </form>
  );
}
