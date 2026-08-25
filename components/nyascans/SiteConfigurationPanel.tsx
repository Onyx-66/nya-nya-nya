"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  CaretDown,
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
  type SiteMediaSlot,
  type SiteSocialLink,
} from "@/lib/site-configuration";
import {
  AdminCombobox,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";
import { optimizeStaticMedia } from "@/lib/client/media-optimizer";

type SiteConfigurationResponse = {
  settings: SiteConfiguration;
  revision: number;
  recoveredFromInvalid?: boolean;
};

type SiteConfigurationFailure = {
  error?: {
    message?: string;
    fields?: Array<{ path?: string; message?: string }>;
  };
};

const socialIconOptions: ReadonlyArray<{
  value: SiteSocialLink["icon"];
  label: string;
}> = [
  { value: "SUPPORT", label: "Support" },
  { value: "DISCORD", label: "Discord" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "X", label: "X" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "MASTODON", label: "Mastodon" },
  { value: "BLUESKY", label: "Bluesky" },
  { value: "LINK", label: "Generic link" },
];

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

type ConfigurationSection = "branding" | "homepage" | "pinned" | "reader" | "footer" | "legal" | "shortcuts";
type MediaSlot = "logo" | "compact" | "app" | "first" | "last";
type PendingMedia = { file: File; url: string } | null;

function mediaSlotValue(
  configuration: SiteConfiguration,
  slot: MediaSlot,
): SiteMediaSlot {
  if (slot === "logo") return configuration.brand.logo;
  if (slot === "compact") return configuration.brand.compactLogo;
  if (slot === "app") return configuration.brand.appIcon;
  if (slot === "first") return configuration.reader.firstPage;
  return configuration.reader.lastPage;
}

function withMediaSlot(
  configuration: SiteConfiguration,
  slot: MediaSlot,
  media: SiteMediaSlot,
): SiteConfiguration {
  if (slot === "logo" || slot === "compact" || slot === "app") {
    const key =
      slot === "logo"
        ? "logo"
        : slot === "compact"
          ? "compactLogo"
          : "appIcon";
    return {
      ...configuration,
      brand: { ...configuration.brand, [key]: media },
    };
  }
  const key = slot === "first" ? "firstPage" : "lastPage";
  return {
    ...configuration,
    reader: { ...configuration.reader, [key]: media },
  };
}

function responseFailureMessage(
  payload: SiteConfigurationFailure,
  fallback: string,
) {
  const field = payload.error?.fields?.[0];
  if (field?.message) {
    const label = field.path
      ? field.path
          .replaceAll(".", " › ")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
      : "Configuration";
    return `${label}: ${field.message}`;
  }
  return payload.error?.message ?? fallback;
}

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [recoveredFromInvalid, setRecoveredFromInvalid] = useState(false);
  const [activeLegalDocumentSlug, setActiveLegalDocumentSlug] = useState(
    defaultSiteConfiguration.legalDocuments[0]?.slug ?? "",
  );
  const [pendingMedia, setPendingMedia] =
    useState<Record<MediaSlot, PendingMedia>>({ ...emptyPendingMedia });
  const pendingMediaRef = useRef(pendingMedia);
  const [pendingRemovals, setPendingRemovals] =
    useState<Record<MediaSlot, boolean>>({ ...emptyPendingRemovals });
  const [pendingMediaRemoval, setPendingMediaRemoval] =
    useState<MediaSlot | null>(null);
  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const mediaDirty =
    Object.values(pendingMedia).some(Boolean) ||
    Object.values(pendingRemovals).some(Boolean);
  const dirty = settingsDirty || mediaDirty;
  const activeLegalDocumentIndex = settings.legalDocuments.findIndex(
    (document) => document.slug === activeLegalDocumentSlug,
  );
  const activeLegalDocument =
    settings.legalDocuments[activeLegalDocumentIndex] ??
    settings.legalDocuments[0] ??
    null;
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
      setActiveLegalDocumentSlug((current) =>
        normalized.legalDocuments.some((document) => document.slug === current)
          ? current
          : (normalized.legalDocuments[0]?.slug ?? ""),
      );
      setRevision(Number(payload.revision ?? 0));
      setRecoveredFromInvalid(Boolean(payload.recoveredFromInvalid));
      setFieldErrors({});
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
    setFieldErrors({});
    let persisted = false;
    let currentRevision = revision;
    let desiredSettings = settings;
    let serverSettings = saved;
    try {
      for (const slot of Object.keys(emptyPendingMedia) as MediaSlot[]) {
        const pending = pendingMedia[slot];
        if (!pending && !pendingRemovals[slot]) continue;
        setUploading(slot);
        const response = pending
          ? await (() => {
              return optimizeStaticMedia(pending.file, {
                maxWidth:
                  slot === "logo"
                    ? 2_400
                    : slot === "first" || slot === "last"
                      ? 1_600
                      : 1_200,
                maxHeight:
                  slot === "first" || slot === "last" ? 2_400 : 1_200,
                maxBytes:
                  slot === "first" || slot === "last"
                    ? 7_500_000
                    : 1_900_000,
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
        const payload = (await response.json()) as SiteConfigurationResponse &
          SiteConfigurationFailure;
        if (!response.ok) {
          setFieldErrors(
            Object.fromEntries(
              (payload.error?.fields ?? []).flatMap((field) =>
                field.path && field.message
                  ? [[field.path, field.message]]
                  : [],
              ),
            ),
          );
          throw new Error(
            responseFailureMessage(
              payload,
              "The staged image could not be saved.",
            ),
          );
        }
        const normalized = parseSiteConfiguration(payload.settings);
        currentRevision = Number(payload.revision ?? currentRevision + 1);
        const persistedMedia = mediaSlotValue(normalized, slot);
        desiredSettings = withMediaSlot(desiredSettings, slot, {
          ...persistedMedia,
          enabled: pendingRemovals[slot]
            ? false
            : mediaSlotValue(desiredSettings, slot).enabled,
        });
        serverSettings = normalized;
        if (pending?.url) URL.revokeObjectURL(pending.url);
        setPendingMedia((current) => ({ ...current, [slot]: null }));
        setPendingRemovals((current) => ({ ...current, [slot]: false }));
        persisted = true;
      }
      if (JSON.stringify(desiredSettings) !== JSON.stringify(serverSettings)) {
        const response = await fetch("/api/v1/admin/site-configuration", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            settings: desiredSettings,
            expectedRevision: currentRevision,
          }),
        });
        const payload = (await response.json()) as SiteConfigurationResponse &
          SiteConfigurationFailure;
        if (!response.ok) {
          setFieldErrors(
            Object.fromEntries(
              (payload.error?.fields ?? []).flatMap((field) =>
                field.path && field.message
                  ? [[field.path, field.message]]
                  : [],
              ),
            ),
          );
          throw new Error(
            responseFailureMessage(
              payload,
              "Site configuration could not be saved.",
            ),
          );
        }
        serverSettings = parseSiteConfiguration(payload.settings);
        currentRevision = Number(payload.revision ?? currentRevision + 1);
        persisted = true;
      }
      setSettings(serverSettings);
      setSaved(serverSettings);
      setRevision(currentRevision);
      setRecoveredFromInvalid(false);
      broadcastSiteConfiguration(serverSettings, currentRevision);
      setMessage("Site configuration is live.");
      setStatus("saved");
    } catch (error) {
      setSettings(desiredSettings);
      setSaved(serverSettings);
      setRevision(currentRevision);
      if (persisted) {
        broadcastSiteConfiguration(serverSettings, currentRevision);
      }
      setMessage(
        persisted
          ? `Saved media was retained, but another change still needs attention: ${
              error instanceof Error ? error.message : "try the remaining image again"
            }.`
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
    setMediaEnabled(slot, true);
    setFieldErrors({});
    setStatus("idle");
    setMessage("Image staged locally. Save configuration to publish it.");
  }

  function removeMedia(slot: MediaSlot) {
    setPendingMediaRemoval(slot);
  }

  function confirmMediaRemoval() {
    if (!pendingMediaRemoval) return;
    const slot = pendingMediaRemoval;
    setPendingMedia((current) => {
      if (current[slot]?.url) URL.revokeObjectURL(current[slot]!.url);
      return { ...current, [slot]: null };
    });
    setPendingRemovals((current) => ({ ...current, [slot]: true }));
    setStatus("idle");
    setMessage("Image removal staged. Save configuration to publish it.");
    setPendingMediaRemoval(null);
  }

  const media = useMemo(
    () =>
      [
        {
          group: "branding" as const,
          slot: "logo" as const,
          label: "Site logo",
          detail: "Shown in the main header, footer, and access screens.",
          recommendation: "1:2, 1:1, or 2:1 PNG or WebP",
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
          recommendation: "1:2, 1:1, or 2:1 PNG or WebP",
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

  function resetChanges() {
    setSettings(saved);
    clearPendingMedia();
    setStatus("idle");
    setMessage("Unsaved changes were reset.");
  }

  function updateActiveLegalDocument(
    patch: Partial<SiteConfiguration["legalDocuments"][number]>,
  ) {
    if (!activeLegalDocument) return;
    setSettings((current) => ({
      ...current,
      legalDocuments: current.legalDocuments.map((document) =>
        document.slug === activeLegalDocument.slug
          ? { ...document, ...patch }
          : document,
      ),
    }));
  }

  function updateActiveLegalSection(
    sectionIndex: number,
    patch: Partial<
      SiteConfiguration["legalDocuments"][number]["sections"][number]
    >,
  ) {
    if (!activeLegalDocument) return;
    setSettings((current) => ({
      ...current,
      legalDocuments: current.legalDocuments.map((document) =>
        document.slug === activeLegalDocument.slug
          ? {
              ...document,
              sections: document.sections.map((legalSection, index) =>
                index === sectionIndex
                  ? { ...legalSection, ...patch }
                  : legalSection,
              ),
            }
          : document,
      ),
    }));
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
              : section === "homepage"
                ? "Homepage"
                : section === "pinned"
                  ? "Pinned Series style"
                  : section === "reader"
                  ? "Reader assets"
                  : section === "legal"
                    ? "Legal documents"
                    : section === "shortcuts"
                      ? "Keyboard shortcuts"
                      : "Footer and social links"}
          </h2>
          <p>
            {section === "branding"
              ? "Manage the public name, description, and responsive brand marks."
              : section === "homepage"
                ? "Choose which Pinned Series presentation is active on desktop; touch layouts remain responsive."
                : section === "pinned"
                  ? "Choose the active Pinned Series presentation style. The setting is shared by the homepage and all supported breakpoints."
                  : section === "reader"
                  ? "Manage reusable fixed chapter pages without changing release files."
                  : section === "legal"
                    ? "Edit the titles, dates, summaries, paragraphs, and bullet points published on every legal and DMCA page."
                    : section === "shortcuts"
                      ? "Edit navigation chords and their real destinations without changing application code."
                      : "Edit every public footer text, group, legal destination, and social link."}
          </p>
        </div>
        {section !== "legal" ? (
          <div className="admin-header-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={!dirty || status === "saving"}
              onClick={resetChanges}
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
        ) : null}
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
        <div className="dots-ring-loading settings-loading" role="status"><DotsRing size="lg" label={null} /><span>Loading site configuration…</span></div>
      ) : (
        <>
          {section === "homepage" || section === "pinned" ? (
          <section className={`site-identity-fields homepage-carousel-settings${section === "pinned" ? " pinned-style-focus" : ""}`}>
            {section === "pinned" ? (
              <div className="pinned-style-management-intro">
                <strong>Pinned Series presentation</strong>
                <p>This is the same persisted setting used by the public homepage. Pick one style, then save the configuration to publish it.</p>
              </div>
            ) : null}
            <label>
              <span>Pinned Series carousel style</span>
              <UnifiedSingleSelect
                value={settings.homepage.pinnedSeriesStyle}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    homepage: {
                      ...current.homepage,
                      pinnedSeriesStyle: event.target.value as SiteConfiguration["homepage"]["pinnedSeriesStyle"],
                    },
                  }))
                }
              >
                <option value="CLASSIC">Classic carousel</option>
                <option value="CARD_COVER_FLOW">CardCoverFlow</option>
              </UnifiedSingleSelect>
              <small>
                Classic keeps the existing full-width touch-style rail. CardCoverFlow uses the new angled cover-flow on desktop; mobile and tablet keep the touch rail.
              </small>
            </label>
          </section>
          ) : null}

          {section === "branding" ? (
          <section className="site-identity-fields">
            <label>
              <span>Site name</span>
              <input
                value={settings.brand.siteName}
                aria-invalid={Boolean(fieldErrors["brand.siteName"])}
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
              {fieldErrors["brand.siteName"] ? (
                <small className="admin-field-error">
                  {fieldErrors["brand.siteName"]}
                </small>
              ) : null}
            </label>
            <label>
              <span>Logo alternative text (optional)</span>
              <input
                value={settings.brand.logoAlt}
                aria-invalid={Boolean(fieldErrors["brand.logoAlt"])}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    brand: {
                      ...current.brand,
                      logoAlt: event.target.value,
                    },
                  }))
                }
              />
              {fieldErrors["brand.logoAlt"] ? (
                <small className="admin-field-error">
                  {fieldErrors["brand.logoAlt"]}
                </small>
              ) : null}
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

          {section === "branding" || section === "reader" ? (
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
            <div className="footer-content-editor">
              <label><span>Footer description</span><textarea maxLength={400} value={settings.footer.description} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, description: event.target.value } }))} /></label>
              <label><span>Copyright line</span><input maxLength={240} value={settings.footer.copyright} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, copyright: event.target.value } }))} /></label>
              <label><span>Legal notice</span><textarea maxLength={400} value={settings.footer.legalNotice} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, legalNotice: event.target.value } }))} /></label>
            </div>
            <div className="control-section-heading">
              <div><span>Footer navigation</span><h3>Groups, legal notices, DMCA, and links</h3></div>
              <button type="button" disabled={settings.footer.groups.length >= 8} onClick={() => setSettings((current) => {
                const taken = new Set(current.footer.groups.map((group) => group.id));
                return { ...current, footer: { ...current.footer, groups: [...current.footer.groups, { id: linkId("New group", taken), title: "New group", enabled: true, links: [] }] } };
              })}><Plus size={16} /> Add group</button>
            </div>
            <div className="footer-group-admin-list">
              {settings.footer.groups.map((group, groupIndex) => (
                <article key={group.id}>
                  <header>
                    <input aria-label={`Group ${groupIndex + 1} title`} value={group.title} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, groups: current.footer.groups.map((entry, index) => index === groupIndex ? { ...entry, title: event.target.value } : entry) } }))} />
                    <label><input type="checkbox" checked={group.enabled} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, groups: current.footer.groups.map((entry, index) => index === groupIndex ? { ...entry, enabled: event.target.checked } : entry) } }))} /> Visible</label>
                    <button type="button" aria-label={`Remove ${group.title}`} onClick={() => setSettings((current) => ({ ...current, footer: { ...current.footer, groups: current.footer.groups.filter((_, index) => index !== groupIndex) } }))}><Trash size={16} /></button>
                  </header>
                  {group.links.map((link, linkIndex) => (
                    <div className="footer-link-admin-row" key={link.id}>
                      <input aria-label="Link label" value={link.label} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, groups: current.footer.groups.map((entry, index) => index === groupIndex ? { ...entry, links: entry.links.map((item, itemIndex) => itemIndex === linkIndex ? { ...item, label: event.target.value } : item) } : entry) } }))} />
                      <input aria-label="Link destination" value={link.url} placeholder="/legal/copyright" onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, groups: current.footer.groups.map((entry, index) => index === groupIndex ? { ...entry, links: entry.links.map((item, itemIndex) => itemIndex === linkIndex ? { ...item, url: event.target.value } : item) } : entry) } }))} />
                      <label><input type="checkbox" checked={link.enabled} onChange={(event) => setSettings((current) => ({ ...current, footer: { ...current.footer, groups: current.footer.groups.map((entry, index) => index === groupIndex ? { ...entry, links: entry.links.map((item, itemIndex) => itemIndex === linkIndex ? { ...item, enabled: event.target.checked } : item) } : entry) } }))} /> Visible</label>
                      <button type="button" aria-label={`Remove ${link.label}`} onClick={() => setSettings((current) => ({ ...current, footer: { ...current.footer, groups: current.footer.groups.map((entry, index) => index === groupIndex ? { ...entry, links: entry.links.filter((_, itemIndex) => itemIndex !== linkIndex) } : entry) } }))}><Trash size={15} /></button>
                    </div>
                  ))}
                  <button className="button button-secondary" type="button" disabled={group.links.length >= 20} onClick={() => setSettings((current) => ({ ...current, footer: { ...current.footer, groups: current.footer.groups.map((entry, index) => index === groupIndex ? { ...entry, links: [...entry.links, { id: linkId("New link", new Set(entry.links.map((link) => link.id))), label: "New link", url: "", enabled: false, openInNewTab: false }] } : entry) } }))}><Plus size={14} /> Add link</button>
                </article>
              ))}
            </div>
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
                    <AdminCombobox
                      ariaLabel={`Choose an icon for ${link.label || `social link ${index + 1}`}`}
                      value={link.icon}
                      options={socialIconOptions}
                      placeholder="Search social icons…"
                      onChange={(icon) =>
                        updateSocialLink(index, {
                          icon: icon as SiteSocialLink["icon"],
                        })
                      }
                    />
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
          {section === "shortcuts" ? (
            <section className="shortcut-admin-editor">
              <div className="control-section-heading">
                <div><span>Navigation controls</span><h3>Keyboard shortcut registry</h3></div>
                <button type="button" disabled={settings.keyboardShortcuts.length >= 40} onClick={() => setSettings((current) => ({ ...current, keyboardShortcuts: [...current.keyboardShortcuts, { id: linkId("New shortcut", new Set(current.keyboardShortcuts.map((shortcut) => shortcut.id))), prefix: "G", key: "", label: "New shortcut", href: "/", enabled: false }] }))}><Plus size={16} /> Add shortcut</button>
              </div>
              <div className="shortcut-admin-list">
                {settings.keyboardShortcuts.map((shortcut, index) => (
                  <article key={shortcut.id}>
                    <input aria-label="Shortcut prefix" value={shortcut.prefix} placeholder="G" onChange={(event) => setSettings((current) => ({ ...current, keyboardShortcuts: current.keyboardShortcuts.map((entry, entryIndex) => entryIndex === index ? { ...entry, prefix: event.target.value } : entry) }))} />
                    <input aria-label="Shortcut key" value={shortcut.key} placeholder="H" onChange={(event) => setSettings((current) => ({ ...current, keyboardShortcuts: current.keyboardShortcuts.map((entry, entryIndex) => entryIndex === index ? { ...entry, key: event.target.value.slice(0, 12) } : entry) }))} />
                    <input aria-label="Shortcut label" value={shortcut.label} onChange={(event) => setSettings((current) => ({ ...current, keyboardShortcuts: current.keyboardShortcuts.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry) }))} />
                    <input aria-label="Shortcut destination" value={shortcut.href ?? ""} placeholder="No destination for system action" onChange={(event) => setSettings((current) => ({ ...current, keyboardShortcuts: current.keyboardShortcuts.map((entry, entryIndex) => entryIndex === index ? { ...entry, href: event.target.value || null } : entry) }))} />
                    <label><input type="checkbox" checked={shortcut.enabled} onChange={(event) => setSettings((current) => ({ ...current, keyboardShortcuts: current.keyboardShortcuts.map((entry, entryIndex) => entryIndex === index ? { ...entry, enabled: event.target.checked } : entry) }))} /> Enabled</label>
                    <button type="button" aria-label={`Remove ${shortcut.label}`} disabled={["search", "guide"].includes(shortcut.id)} onClick={() => setSettings((current) => ({ ...current, keyboardShortcuts: current.keyboardShortcuts.filter((_, entryIndex) => entryIndex !== index) }))}><Trash size={16} /></button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {section === "legal" ? (
            <section className="legal-document-workspace">
              <div className="legal-document-picker">
                <label>
                  <span>Legal document</span>
                  <UnifiedSingleSelect
                    value={activeLegalDocument?.slug ?? ""}
                    onChange={(event) =>
                      setActiveLegalDocumentSlug(event.target.value)
                    }
                  >
                    {settings.legalDocuments.map((document) => (
                      <option key={document.slug} value={document.slug}>
                        {document.title}
                      </option>
                    ))}
                  </UnifiedSingleSelect>
                </label>
                {activeLegalDocument ? (
                  <div className="legal-document-route">
                    <span>Public route</span>
                    <a
                      href={`/legal/${activeLegalDocument.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      /legal/{activeLegalDocument.slug}
                      <ArrowSquareOut size={16} />
                    </a>
                  </div>
                ) : null}
              </div>

              {activeLegalDocument ? (
                <>
                  <section className="legal-document-common-card">
                    <header>
                      <div>
                        <span>Common fields</span>
                        <h3>{activeLegalDocument.title}</h3>
                        <p>
                          Update the public heading, summary, and published
                          dates. Detailed page copy stays in Advanced.
                        </p>
                      </div>
                      <span className="legal-document-section-count">
                        {activeLegalDocument.sections.length} sections
                      </span>
                    </header>
                    <div className="legal-document-admin-fields">
                      <label>
                        <span>Page title</span>
                        <input
                          value={activeLegalDocument.title}
                          onChange={(event) =>
                            updateActiveLegalDocument({
                              title: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Summary</span>
                        <textarea
                          rows={4}
                          value={activeLegalDocument.summary}
                          onChange={(event) =>
                            updateActiveLegalDocument({
                              summary: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Effective date</span>
                        <input
                          value={activeLegalDocument.effectiveDate}
                          onChange={(event) =>
                            updateActiveLegalDocument({
                              effectiveDate: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Last updated</span>
                        <input
                          value={activeLegalDocument.updatedDate}
                          onChange={(event) =>
                            updateActiveLegalDocument({
                              updatedDate: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  </section>

                  <details
                    className="legal-document-advanced"
                    key={activeLegalDocument.slug}
                  >
                    <summary>
                      <div>
                        <strong>Advanced</strong>
                        <span>
                          Edit section details, paragraphs, and bullet points.
                        </span>
                      </div>
                      <CaretDown size={18} aria-hidden="true" />
                    </summary>
                    <div className="legal-section-admin-list">
                      {activeLegalDocument.sections.map(
                        (legalSection, sectionIndex) => (
                          <article key={legalSection.id}>
                            <header>
                              <span>
                                Section {String(sectionIndex + 1).padStart(2, "0")}
                              </span>
                              <strong>
                                {legalSection.title || "Untitled section"}
                              </strong>
                            </header>
                            <div className="legal-section-admin-fields">
                              <label>
                                <span>Section title</span>
                                <input
                                  value={legalSection.title}
                                  onChange={(event) =>
                                    updateActiveLegalSection(sectionIndex, {
                                      title: event.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                <span>Paragraphs — one per line</span>
                                <textarea
                                  rows={Math.max(
                                    4,
                                    legalSection.paragraphs?.length ?? 0,
                                  )}
                                  value={(legalSection.paragraphs ?? []).join(
                                    "\n",
                                  )}
                                  onChange={(event) =>
                                    updateActiveLegalSection(sectionIndex, {
                                      paragraphs: event.target.value
                                        .split("\n")
                                        .map((value) => value.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                />
                              </label>
                              <label>
                                <span>Bullet points — one per line</span>
                                <textarea
                                  rows={Math.max(
                                    4,
                                    legalSection.bullets?.length ?? 0,
                                  )}
                                  value={(legalSection.bullets ?? []).join(
                                    "\n",
                                  )}
                                  onChange={(event) =>
                                    updateActiveLegalSection(sectionIndex, {
                                      bullets: event.target.value
                                        .split("\n")
                                        .map((value) => value.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                />
                              </label>
                            </div>
                          </article>
                        ),
                      )}
                    </div>
                  </details>

                  <div className="legal-document-action-bar">
                    <div className="legal-document-action-state" aria-live="polite">
                      <strong>
                        {dirty ? "Unpublished changes" : "Configuration up to date"}
                      </strong>
                      <span>
                        {dirty
                          ? "Save to publish this document and any other pending footer changes."
                          : "The saved legal documents are live on the public site."}
                      </span>
                    </div>
                    <div>
                      <button
                        className="button button-ghost"
                        type="button"
                        disabled={!dirty || status === "saving"}
                        onClick={resetChanges}
                      >
                        Reset
                      </button>
                      <button
                        className="button button-primary"
                        type="submit"
                        disabled={status === "saving" || !dirty}
                      >
                        <FloppyDisk size={17} />
                        {status === "saving" ? "Saving…" : "Save configuration"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="admin-empty-state">
                  <FileImage size={32} />
                  <strong>No legal documents configured</strong>
                  <p>Add a document through the existing site configuration data.</p>
                </div>
              )}
            </section>
          ) : null}
        </>
      )}

      {message ? (
        <SystemNoticeBridge
          message={message}
          kind={
            status === "error"
              ? "error"
              : status === "saved"
                ? "success"
                : "info"
          }
        />
      ) : null}
      <ConfirmActionDialog
        open={pendingMediaRemoval !== null}
        title="Stage image removal?"
        description="The image stays live until you save the configuration. You can reset the form before saving to keep it."
        confirmLabel="Stage removal"
        destructive
        onCancel={() => setPendingMediaRemoval(null)}
        onConfirm={confirmMediaRemoval}
      />
    </form>
  );
}
