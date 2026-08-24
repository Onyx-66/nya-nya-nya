"use client";
/* eslint-disable @next/next/no-img-element */

import { Bell, ImageSquare, LinkSimple, Megaphone, Plus, SpinnerGap, TextB, TextItalic, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AdminPageScaffold } from "@/components/nyascans/admin/AdminPageScaffold";
import { FormattedAnnouncementText } from "@/components/nyascans/FormattedAnnouncementText";

type Announcement = {
  id: string; type: "UPDATE" | "ISSUE" | "SUPPORT" | "NOTICE"; title: string; body: string;
  linkLabel: string; linkUrl: string; isActive: boolean; startsAt: string | null; endsAt: string | null; revision: number;
};
type FloatingAd = {
  id: string; eyebrow: string; title: string; highlightText: string; sideIcon: string; body: string; destinationUrl: string; fallbackImageUrl: string;
  actionLabel: string; infoBlocks: Array<{ icon: string; title: string; body: string }>;
  secondaryActions: Array<{ label: string; url: string }>;
  startsAt: string | null; endsAt: string | null; imageUrl: string | null;
  effect: "WAVE" | "PULSE" | "GLOW"; isActive: boolean; revision: number;
  displaySlot: number; primaryColor: string; secondaryColor: string; backgroundColor: string; borderColor: string; accentLinePosition: "top" | "left" | "bottom";
};
type Payload = { announcements: Announcement[]; ads: FloatingAd[]; savedAdId?: string | null };
type AnnouncementDraft = Omit<Announcement, "id" | "revision">;
type FloatingAdDraft = Omit<FloatingAd, "id" | "revision" | "imageUrl"> & { resetAudience: boolean };

async function readJson(response: Response): Promise<Payload> {
  const payload = await response.json() as Payload & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Home promotions could not be saved.");
  return payload;
}

const emptyAnnouncement: AnnouncementDraft = { type: "UPDATE", title: "", body: "", linkLabel: "", linkUrl: "", isActive: true, startsAt: null, endsAt: null };
const emptyAd: FloatingAdDraft = {
  eyebrow: "New event", title: "", highlightText: "", sideIcon: "✦", body: "", actionLabel: "Explore event",
  infoBlocks: [] as Array<{ icon: string; title: string; body: string }>,
  secondaryActions: [] as Array<{ label: string; url: string }>,
  startsAt: null as string | null, endsAt: null as string | null,
  destinationUrl: "", fallbackImageUrl: "", effect: "WAVE",
  displaySlot: 1, primaryColor: "#65B5FF", secondaryColor: "#8B5CF6", backgroundColor: "#07111C", borderColor: "", accentLinePosition: "top",
  isActive: false, resetAudience: false,
};

function adDraftFromRecord(record: FloatingAd): FloatingAdDraft {
  return {
    eyebrow: record.eyebrow,
    title: record.title,
    highlightText: record.highlightText ?? "",
    sideIcon: record.sideIcon ?? "✦",
    body: record.body,
    actionLabel: record.actionLabel,
    infoBlocks: record.infoBlocks ?? [],
    secondaryActions: record.secondaryActions ?? [],
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    destinationUrl: record.destinationUrl,
    fallbackImageUrl: record.fallbackImageUrl,
    effect: record.effect,
    displaySlot: record.displaySlot,
    primaryColor: record.primaryColor,
    secondaryColor: record.secondaryColor,
    backgroundColor: record.backgroundColor,
    borderColor: record.borderColor ?? "",
    accentLinePosition: record.accentLinePosition ?? "top",
    isActive: record.isActive,
    resetAudience: false,
  };
}

function localDateTimeValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function utcDateTimeValue(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function HomePromotionsPanel() {
  const [data, setData] = useState<Payload>({ announcements: [], ads: [] });
  const [announcement, setAnnouncement] = useState<AnnouncementDraft>(emptyAnnouncement);
  const [ad, setAd] = useState<FloatingAdDraft>(emptyAd);
  const [selectedAdId, setSelectedAdId] = useState("");
  const [adImage, setAdImage] = useState<File | null>(null);
  const adPreviewUrl = useMemo(
    () => (adImage ? URL.createObjectURL(adImage) : ""),
    [adImage],
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "neutral"; text: string } | null>(null);
  const announcementBodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => {
      if (adPreviewUrl) URL.revokeObjectURL(adPreviewUrl);
    };
  }, [adPreviewUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await readJson(await fetch("/api/v1/admin/home-promotions", { cache: "no-store" }));
      setData(next);
      setSelectedAdId((currentId) => {
        const current = next.ads.find((item) => item.id === currentId) ?? next.ads[0];
        if (current) {
          setAd(adDraftFromRecord(current));
          return current.id;
        }
        setAd({ ...emptyAd });
        return "";
      });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Home promotions could not be loaded." });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function mutate(body: Record<string, unknown>, success: string) {
    setBusy(true); setMessage(null);
    try {
      const next = await readJson(await fetch("/api/v1/admin/home-promotions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      setData(next); setMessage({ kind: "success", text: success }); return next;
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "The change could not be saved." }); return null;
    } finally { setBusy(false); }
  }

  async function createAnnouncement() {
    const next = await mutate({ action: "CREATE_ANNOUNCEMENT", data: announcement }, "Announcement published.");
    if (next) setAnnouncement(emptyAnnouncement);
  }

  async function toggleAnnouncement(item: Announcement) {
    await mutate({ action: "SAVE_ANNOUNCEMENT", id: item.id, revision: item.revision, data: { ...item, isActive: !item.isActive } }, item.isActive ? "Announcement hidden." : "Announcement is now active.");
  }

  async function saveAd() {
    const current = data.ads.find((item) => item.id === selectedAdId);
    const next = await mutate({ action: "SAVE_AD", data: { ...ad, id: current?.id, revision: current?.revision } }, "Floating ad saved. Audience reset and visual changes apply immediately.");
    const saved = next?.ads.find((item) => item.id === next.savedAdId) ?? next?.ads.find((item) => item.id === current?.id);
    if (saved) {
      setSelectedAdId(saved.id);
      setAd(adDraftFromRecord(saved));
    }
    if (saved && adImage) {
      setBusy(true);
      try {
        const form = new FormData(); form.set("id", saved.id); form.set("revision", String(saved.revision)); form.set("file", adImage);
        const response = await fetch("/api/v1/floating-ad-media", { method: "PUT", body: form });
        if (!response.ok) { const payload = await response.json() as { error?: { message?: string } }; throw new Error(payload.error?.message ?? "Ad image could not be uploaded."); }
        setAdImage(null); await load();
      } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Ad image could not be uploaded." }); }
      finally { setBusy(false); }
    }
  }

  function selectAd(item: FloatingAd) {
    setSelectedAdId(item.id);
    setAd(adDraftFromRecord(item));
    setAdImage(null);
  }

  function startNewAd() {
    const openSlot = data.ads.some((item) => item.displaySlot === 1) ? 2 : 1;
    setSelectedAdId("");
    setAd({ ...emptyAd, displaySlot: openSlot });
    setAdImage(null);
  }

  async function deleteAd() {
    const current = data.ads.find((item) => item.id === selectedAdId);
    if (!current) return;
    const next = await mutate(
      { action: "DELETE_AD", id: current.id, revision: current.revision },
      "Floating ad deleted.",
    );
    if (!next) return;
    const replacement = next.ads[0];
    setSelectedAdId(replacement?.id ?? "");
    setAd(replacement ? adDraftFromRecord(replacement) : { ...emptyAd });
    setAdImage(null);
  }

  function formatAnnouncement(
    before: string,
    after: string,
    placeholder: string,
  ) {
    const field = announcementBodyRef.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const selected = announcement.body.slice(start, end) || placeholder;
    const next = `${announcement.body.slice(0, start)}${before}${selected}${after}${announcement.body.slice(end)}`;
    setAnnouncement((current) => ({ ...current, body: next }));
    window.requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  const selectedAd = data.ads.find((item) => item.id === selectedAdId);
  const selectedAdImage = adPreviewUrl || selectedAd?.imageUrl || ad.fallbackImageUrl;

  return (
    <AdminPageScaffold breadcrumbs={["Homepage & Marketing", "Announcements & Ads"]} kicker="Audience communication" title="Announcements & Ads" description="Publish typed site notices directly above Latest Updates and manage the first-visit campaign." message={message} state={loading ? { kind: "loading", message: "Loading active home campaigns…" } : { kind: "ready" }}>
      <div className="v46-promotions-layout">
        <section className="v46-promo-editor">
          <header><Megaphone /><div><span>Announcements</span><h3>Add a site notice</h3></div></header>
          <div className="v46-promo-form">
            <label><span>Type</span><select value={announcement.type} onChange={(event) => setAnnouncement((current) => ({ ...current, type: event.target.value as Announcement["type"] }))}><option value="UPDATE">Update</option><option value="ISSUE">Issue</option><option value="SUPPORT">Support</option><option value="NOTICE">Notice</option></select></label>
            <label><span>Title</span><input value={announcement.title} onChange={(event) => setAnnouncement((current) => ({ ...current, title: event.target.value }))} /></label>
            <div className="v46-span-two announcement-rich-field">
              <span>Message</span>
              <div className="announcement-format-toolbar" role="toolbar" aria-label="Announcement text formatting">
                <button type="button" title="Bold" aria-label="Bold" onClick={() => formatAnnouncement("**", "**", "bold text")}><TextB /></button>
                <button type="button" title="Italic" aria-label="Italic" onClick={() => formatAnnouncement("_", "_", "italic text")}><TextItalic /></button>
                <button type="button" title="Link" aria-label="Insert link" onClick={() => formatAnnouncement("[", "](https://)", "link text")}><LinkSimple /></button>
              </div>
              <textarea ref={announcementBodyRef} rows={5} maxLength={1000} value={announcement.body} onChange={(event) => setAnnouncement((current) => ({ ...current, body: event.target.value }))} />
              <small>Use the controls for bold, italic, and secure links.</small>
              {announcement.body ? <div className="announcement-inline-preview"><FormattedAnnouncementText body={announcement.body} /></div> : null}
            </div>
            <label><span>Link label</span><input value={announcement.linkLabel} onChange={(event) => setAnnouncement((current) => ({ ...current, linkLabel: event.target.value }))} /></label>
            <label><span>Link</span><input value={announcement.linkUrl} placeholder="/support" onChange={(event) => setAnnouncement((current) => ({ ...current, linkUrl: event.target.value }))} /></label>
            <button className="button button-primary" type="button" disabled={busy || !announcement.title.trim() || !announcement.body.trim()} onClick={() => void createAnnouncement()}>{busy ? <SpinnerGap className="spin" /> : <Plus />} Add announcement</button>
          </div>
          <div className="v46-announcement-admin-list">{data.announcements.map((item) => <article key={item.id} data-type={item.type}><Bell /><div><small>{item.type}</small><strong>{item.title}</strong><FormattedAnnouncementText body={item.body} /></div><button className="button button-secondary" type="button" onClick={() => void toggleAnnouncement(item)}>{item.isActive ? "Hide" : "Activate"}</button><button type="button" className="v46-icon-danger" aria-label={`Delete ${item.title}`} onClick={() => void mutate({ action: "DELETE_ANNOUNCEMENT", id: item.id, revision: item.revision }, "Announcement deleted.")}><Trash /></button></article>)}</div>
        </section>
        <section className="v46-promo-editor">
          <header className="floating-ad-editor-heading"><ImageSquare /><div><span>First open</span><h3>Floating image campaigns</h3></div><button className="button button-secondary" type="button" onClick={startNewAd}><Plus /> New ad</button></header>
          <div className="floating-ad-selector" role="tablist" aria-label="Floating ad campaigns">
            {data.ads.map((item) => (
              <button
                type="button"
                role="tab"
                key={item.id}
                aria-selected={item.id === selectedAdId}
                onClick={() => selectAd(item)}
              >
                <span>Ad {item.displaySlot}</span>
                <strong>{item.title}</strong>
                <small>{item.isActive ? "Active" : "Inactive"}</small>
              </button>
            ))}
            {!data.ads.length ? <p>No floating campaigns yet. Create Ad 1 or Ad 2.</p> : null}
          </div>
          <div
            className="v46-floating-ad-preview"
            data-effect={ad.effect.toLowerCase()}
            style={{
              "--campaign-primary": ad.primaryColor,
              "--campaign-secondary": ad.secondaryColor,
              "--campaign-background": ad.backgroundColor,
              "--campaign-border": ad.borderColor || ad.primaryColor,
            } as CSSProperties}
            data-accent-line={ad.accentLinePosition}
          >{selectedAdImage ? <img src={selectedAdImage} alt="Floating campaign preview" /> : <span className="home-announcement-icon">{ad.sideIcon || "✦"}</span>}<div><small><i />{ad.eyebrow || "Announcement"}</small><strong>{ad.title || "Campaign title"}</strong><p>{ad.body || "Your campaign message appears here."}</p>{ad.infoBlocks.length ? <div className="ad-admin-block-preview">{ad.infoBlocks.map((block, index) => <span key={`${index}:${block.title}`}><b>{block.icon}</b><em>{block.title || "Chip label"}</em></span>)}</div> : null}<button type="button">{ad.actionLabel || "Explore event"}</button>{ad.secondaryActions.length ? <div className="ad-admin-secondary-preview">{ad.secondaryActions.map((action, index) => <span key={`${index}:${action.label}`}>{action.label || "Secondary"}</span>)}</div> : null}</div></div>
          <div className="v46-promo-form">
            <label><span>Display slot</span><select value={ad.displaySlot} onChange={(event) => setAd((current) => ({ ...current, displaySlot: Number(event.target.value) }))}><option value={1}>Ad 1 · shown first</option><option value={2}>Ad 2 · shown after Ad 1</option></select></label>
            <label><span>Eyebrow</span><input value={ad.eyebrow} onChange={(event) => setAd((current) => ({ ...current, eyebrow: event.target.value }))} /></label>
            <label><span>Side icon</span><input maxLength={8} value={ad.sideIcon} placeholder="✦" onChange={(event) => setAd((current) => ({ ...current, sideIcon: event.target.value }))} /></label>
            <label><span>Title</span><input value={ad.title} onChange={(event) => setAd((current) => ({ ...current, title: event.target.value }))} /></label>
            <label><span>Highlighted title text</span><input value={ad.highlightText} placeholder="Optional title segment" onChange={(event) => setAd((current) => ({ ...current, highlightText: event.target.value }))} /></label>
            <label className="v46-span-two"><span>Message</span><textarea rows={3} value={ad.body} onChange={(event) => setAd((current) => ({ ...current, body: event.target.value }))} /></label>
            <label><span>Primary action label</span><input value={ad.actionLabel} onChange={(event) => setAd((current) => ({ ...current, actionLabel: event.target.value }))} /></label>
            <label><span>Destination</span><input value={ad.destinationUrl} placeholder="https://patreon.com/…" onChange={(event) => setAd((current) => ({ ...current, destinationUrl: event.target.value }))} /></label>
            <label><span>Starts at (optional)</span><input type="datetime-local" value={localDateTimeValue(ad.startsAt)} onChange={(event) => setAd((current) => ({ ...current, startsAt: utcDateTimeValue(event.target.value) }))} /></label>
            <label><span>Ends at (optional)</span><input type="datetime-local" value={localDateTimeValue(ad.endsAt)} onChange={(event) => setAd((current) => ({ ...current, endsAt: utcDateTimeValue(event.target.value) }))} /></label>
            <label><span>Fallback image URL</span><input value={ad.fallbackImageUrl} placeholder="https://…" onChange={(event) => setAd((current) => ({ ...current, fallbackImageUrl: event.target.value }))} /></label>
            <label><span>Visual effect</span><select value={ad.effect} onChange={(event) => setAd((current) => ({ ...current, effect: event.target.value as FloatingAd["effect"] }))}><option value="WAVE">Wave</option><option value="PULSE">Pulse</option><option value="GLOW">Glow</option></select></label>
            <label className="campaign-color-field"><span>Primary light</span><span><input type="color" value={ad.primaryColor} onChange={(event) => setAd((current) => ({ ...current, primaryColor: event.target.value.toUpperCase() }))} /><code>{ad.primaryColor}</code></span></label>
            <label className="campaign-color-field"><span>Secondary light</span><span><input type="color" value={ad.secondaryColor} onChange={(event) => setAd((current) => ({ ...current, secondaryColor: event.target.value.toUpperCase() }))} /><code>{ad.secondaryColor}</code></span></label>
                        <label className="campaign-color-field"><span>Background</span><span><input type="color" value={ad.backgroundColor} onChange={(event) => setAd((current) => ({ ...current, backgroundColor: event.target.value.toUpperCase() }))} /><code>{ad.backgroundColor}</code></span></label>
            <label className="campaign-color-field"><span>Border / accent</span><span><input type="color" value={ad.borderColor || ad.primaryColor} onChange={(event) => setAd((current) => ({ ...current, borderColor: event.target.value.toUpperCase() }))} /><code>{ad.borderColor || ad.primaryColor}</code></span></label>
            <label><span>Accent line edge</span><select value={ad.accentLinePosition} onChange={(event) => setAd((current) => ({ ...current, accentLinePosition: event.target.value as FloatingAdDraft["accentLinePosition"] }))}><option value="top">Top</option><option value="left">Left</option><option value="bottom">Bottom</option></select></label>
            <label><span>Upload image</span>
<input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(event) => setAdImage(event.target.files?.[0] ?? null)} /><small>{adImage?.name ?? "Static PNG, JPEG or WebP · 500×400px minimum · 8 MB maximum"}</small></label>
            <div className="v46-span-two ad-admin-info-editor">
              <div><span>Chip tags</span><small>Up to four concise details shown under the description.</small></div>
              {ad.infoBlocks.map((block, index) => (
                <div className="ad-admin-info-row" key={`info:${index}`}>
                  <input aria-label={`Block ${index + 1} icon`} maxLength={16} value={block.icon} placeholder="✦" onChange={(event) => setAd((current) => ({ ...current, infoBlocks: current.infoBlocks.map((entry, entryIndex) => entryIndex === index ? { ...entry, icon: event.target.value } : entry) }))} />
                  <input aria-label={`Block ${index + 1} title`} maxLength={60} value={block.title} placeholder="Event feature" onChange={(event) => setAd((current) => ({ ...current, infoBlocks: current.infoBlocks.map((entry, entryIndex) => entryIndex === index ? { ...entry, title: event.target.value } : entry) }))} />
                  <input aria-label={`Block ${index + 1} description`} maxLength={140} value={block.body} placeholder="Short detail" onChange={(event) => setAd((current) => ({ ...current, infoBlocks: current.infoBlocks.map((entry, entryIndex) => entryIndex === index ? { ...entry, body: event.target.value } : entry) }))} />
                  <button type="button" aria-label={`Remove block ${index + 1}`} onClick={() => setAd((current) => ({ ...current, infoBlocks: current.infoBlocks.filter((_, entryIndex) => entryIndex !== index) }))}><Trash /></button>
                </div>
              ))}
                            {ad.infoBlocks.length < 4 ? <button className="button button-secondary" type="button" onClick={() => setAd((current) => ({ ...current, infoBlocks: [...current.infoBlocks, { icon: "✦", title: "", body: "" }] }))}><Plus /> Add chip</button> : null}
            </div>
            <div className="v46-span-two ad-admin-info-editor">
              <div><span>Secondary actions</span><small>Add up to six extra links; each is rendered beside the primary CTA.</small></div>
              {ad.secondaryActions.map((action, index) => (
                <div className="ad-admin-info-row" key={`secondary:${index}`}>
                  <input aria-label={`Secondary action ${index + 1} label`} maxLength={60} value={action.label} placeholder="Plans" onChange={(event) => setAd((current) => ({ ...current, secondaryActions: current.secondaryActions.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry) }))} />
                  <input aria-label={`Secondary action ${index + 1} link`} maxLength={600} value={action.url} placeholder="/support" onChange={(event) => setAd((current) => ({ ...current, secondaryActions: current.secondaryActions.map((entry, entryIndex) => entryIndex === index ? { ...entry, url: event.target.value } : entry) }))} />
                  <button type="button" aria-label={`Remove secondary action ${index + 1}`} onClick={() => setAd((current) => ({ ...current, secondaryActions: current.secondaryActions.filter((_, entryIndex) => entryIndex !== index) }))}><Trash /></button>
                </div>
              ))}
              {ad.secondaryActions.length < 6 ? <button className="button button-secondary" type="button" onClick={() => setAd((current) => ({ ...current, secondaryActions: [...current.secondaryActions, { label: "", url: "" }] }))}><Plus /> Add secondary action</button> : null}
            </div>
            <label className="v46-admin-switch">
<input type="checkbox" checked={ad.isActive} onChange={(event) => setAd((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active campaign (maximum two, one per slot)</span></label>
            <label className="v46-admin-switch"><input type="checkbox" checked={ad.resetAudience} onChange={(event) => setAd((current) => ({ ...current, resetAudience: event.target.checked }))} /><span>Show again to dismissed viewers</span></label>
            <div className="floating-ad-form-actions v46-span-two">
              <button className="button button-primary" type="button" disabled={busy || !ad.title.trim()} onClick={() => void saveAd()}>{busy ? <SpinnerGap className="spin" /> : null} Save floating ad</button>
              {selectedAd ? <button className="button button-danger" type="button" disabled={busy} onClick={() => void deleteAd()}><Trash /> Delete ad</button> : null}
            </div>
          </div>
        </section>
      </div>
    </AdminPageScaffold>
  );
}
