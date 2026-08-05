"use client";
/* eslint-disable @next/next/no-img-element */

import { Bell, ImageSquare, LinkSimple, Megaphone, Plus, SpinnerGap, TextB, TextItalic, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminPageScaffold } from "@/components/nyascans/admin/AdminPageScaffold";
import { FormattedAnnouncementText } from "@/components/nyascans/FormattedAnnouncementText";

type Announcement = {
  id: string; type: "UPDATE" | "ISSUE" | "SUPPORT" | "NOTICE"; title: string; body: string;
  linkLabel: string; linkUrl: string; isActive: boolean; startsAt: string | null; endsAt: string | null; revision: number;
};
type FloatingAd = {
  id: string; eyebrow: string; title: string; body: string; destinationUrl: string; fallbackImageUrl: string;
  imageUrl: string | null; effect: "WAVE" | "PULSE" | "GLOW"; isActive: boolean; revision: number;
};
type Payload = { announcements: Announcement[]; ads: FloatingAd[] };

async function readJson(response: Response): Promise<Payload> {
  const payload = await response.json() as Payload & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Home promotions could not be saved.");
  return payload;
}

const emptyAnnouncement = { type: "UPDATE" as const, title: "", body: "", linkLabel: "", linkUrl: "", isActive: true, startsAt: null, endsAt: null };
const emptyAd = { eyebrow: "Support NyaScans", title: "", body: "", destinationUrl: "", fallbackImageUrl: "", effect: "WAVE" as const, isActive: false, resetAudience: false };

export function HomePromotionsPanel() {
  const [data, setData] = useState<Payload>({ announcements: [], ads: [] });
  const [announcement, setAnnouncement] = useState(emptyAnnouncement);
  const [ad, setAd] = useState(emptyAd);
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
      const current = next.ads[0];
      if (current) setAd({ eyebrow: current.eyebrow, title: current.title, body: current.body, destinationUrl: current.destinationUrl, fallbackImageUrl: current.fallbackImageUrl, effect: current.effect, isActive: current.isActive, resetAudience: false });
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
    const current = data.ads[0];
    const next = await mutate({ action: "SAVE_AD", data: { ...ad, id: current?.id, revision: current?.revision } }, "Floating ad saved. Audience reset and visual changes apply immediately.");
    const saved = next?.ads[0];
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

  return (
    <AdminPageScaffold breadcrumbs={["Admin", "Insights & editorial"]} kicker="Audience communication" title="Announcements & floating ad" description="Publish typed site notices directly above Latest Updates and manage the first-visit campaign." message={message} state={loading ? { kind: "loading", message: "Loading active home campaigns…" } : { kind: "ready" }}>
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
          <header><ImageSquare /><div><span>First open</span><h3>Floating image campaign</h3></div></header>
          <div className="v46-floating-ad-preview" data-effect={ad.effect.toLowerCase()}>{adPreviewUrl || data.ads[0]?.imageUrl || ad.fallbackImageUrl ? <img src={adPreviewUrl || data.ads[0]?.imageUrl || ad.fallbackImageUrl} alt="Floating campaign preview" /> : <ImageSquare />}<div><small>{ad.eyebrow}</small><strong>{ad.title || "Campaign title"}</strong><p>{ad.body || "Your campaign message appears here."}</p></div></div>
          <div className="v46-promo-form">
            <label><span>Eyebrow</span><input value={ad.eyebrow} onChange={(event) => setAd((current) => ({ ...current, eyebrow: event.target.value }))} /></label>
            <label><span>Title</span><input value={ad.title} onChange={(event) => setAd((current) => ({ ...current, title: event.target.value }))} /></label>
            <label className="v46-span-two"><span>Message</span><textarea rows={3} value={ad.body} onChange={(event) => setAd((current) => ({ ...current, body: event.target.value }))} /></label>
            <label><span>Destination</span><input value={ad.destinationUrl} placeholder="https://patreon.com/…" onChange={(event) => setAd((current) => ({ ...current, destinationUrl: event.target.value }))} /></label>
            <label><span>Fallback image URL</span><input value={ad.fallbackImageUrl} placeholder="https://…" onChange={(event) => setAd((current) => ({ ...current, fallbackImageUrl: event.target.value }))} /></label>
            <label><span>Visual effect</span><select value={ad.effect} onChange={(event) => setAd((current) => ({ ...current, effect: event.target.value as FloatingAd["effect"] }))}><option value="WAVE">Wave</option><option value="PULSE">Pulse</option><option value="GLOW">Glow</option></select></label>
            <label><span>Upload image</span><input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(event) => setAdImage(event.target.files?.[0] ?? null)} /><small>{adImage?.name ?? "Static PNG, JPEG or WebP · 500×400px minimum · 8 MB maximum"}</small></label>
            <label className="v46-admin-switch"><input type="checkbox" checked={ad.isActive} onChange={(event) => setAd((current) => ({ ...current, isActive: event.target.checked }))} /><span>Show on first visit</span></label>
            <label className="v46-admin-switch"><input type="checkbox" checked={ad.resetAudience} onChange={(event) => setAd((current) => ({ ...current, resetAudience: event.target.checked }))} /><span>Show again to dismissed viewers</span></label>
            <button className="button button-primary" type="button" disabled={busy || !ad.title.trim()} onClick={() => void saveAd()}>{busy ? <SpinnerGap className="spin" /> : null} Save floating ad</button>
          </div>
        </section>
      </div>
    </AdminPageScaffold>
  );
}
