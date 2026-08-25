"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";
/* eslint-disable @next/next/no-img-element */

import { Check, ImageSquare, Plus, Trash, X } from "@phosphor-icons/react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AdminCombobox, AdminPageScaffold, ConfirmActionDialog } from "@/components/nyascans/admin/AdminPageScaffold";

type Slider = {
  id: string;
  seriesId: string | null;
  title: string;
  categoryLabel: string;
  shortDescription: string;
  destinationUrl: string;
  imageUrl: string | null;
  isActive: boolean;
  revision: number;
  createdAt: string;
};

type SeriesOption = { id: string; title: string; slug: string; imageUrl: string | null };
type SliderPayload = { sliders: Slider[]; series: SeriesOption[] };

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: { message?: string; code?: string } };
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? "Slider controls could not be saved.") as Error & { code?: string };
    error.code = payload.error?.code;
    throw error;
  }
  return payload;
}

const blankDraft = {
  seriesId: "",
  title: "",
  categoryLabel: "Featured",
  shortDescription: "",
  destinationUrl: "",
  isActive: true,
};

export function SliderManagementPanel() {
  const [payload, setPayload] = useState<SliderPayload>({ sliders: [], series: [] });
  const [draft, setDraft] = useState(blankDraft);
  const [customImage, setCustomImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "neutral"; text: string } | null>(null);
  const [replacementFor, setReplacementFor] = useState<{ kind: "create"; draft: typeof blankDraft } | { kind: "activate"; slider: Slider } | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Slider | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPayload(await readJson<SliderPayload>(await fetch("/api/v1/admin/sliders", { cache: "no-store" })));
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Sliders could not be loaded." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const customPreviewUrl = useMemo(
    () => (customImage ? URL.createObjectURL(customImage) : ""),
    [customImage],
  );
  useEffect(
    () => () => {
      if (customPreviewUrl) URL.revokeObjectURL(customPreviewUrl);
    },
    [customPreviewUrl],
  );

  const active = useMemo(() => payload.sliders.filter((slider) => slider.isActive), [payload.sliders]);
  const selectedSeries = payload.series.find((series) => series.id === draft.seriesId);

  function selectSeries(seriesId: string) {
    const series = payload.series.find((entry) => entry.id === seriesId);
    setDraft((current) => ({
      ...current,
      seriesId,
      title: series?.title ?? current.title,
      destinationUrl: series ? `/title/${series.slug}` : current.destinationUrl,
    }));
  }

  async function uploadCustomImage(sliderId: string, revision: number) {
    if (!customImage) return;
    const form = new FormData();
    form.set("id", sliderId);
    form.set("revision", String(revision));
    form.set("file", customImage);
    await readJson(await fetch("/api/v1/homepage-slider-media", { method: "PUT", body: form }));
  }

  async function createSlider(replaceActiveId: string | null = null) {
    if (!draft.title.trim()) return;
    if (draft.isActive && active.length >= 9 && !replaceActiveId) {
      setReplacementFor({ kind: "create", draft });
      setReplacementId("");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await readJson<SliderPayload & { createdId: string }>(await fetch("/api/v1/admin/sliders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, seriesId: draft.seriesId || null, replaceActiveId }),
      }));
      const created = result.sliders.find((slider) => slider.id === result.createdId);
      if (created) await uploadCustomImage(created.id, created.revision);
      setDraft(blankDraft);
      setCustomImage(null);
      setReplacementFor(null);
      setReplacementId("");
      setMessage({ kind: "success", text: "Slider added. The newest slider now appears first." });
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Slider could not be added." });
    } finally {
      setBusy(false);
    }
  }

  async function toggleSlider(slider: Slider, replaceActiveId: string | null = null) {
    if (!slider.isActive && active.length >= 9 && !replaceActiveId) {
      setReplacementFor({ kind: "activate", slider });
      setReplacementId("");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const next = await readJson<SliderPayload>(await fetch("/api/v1/admin/sliders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: slider.id, revision: slider.revision, isActive: !slider.isActive, replaceActiveId }),
      }));
      setPayload(next);
      setReplacementFor(null);
      setReplacementId("");
      setMessage({ kind: "success", text: slider.isActive ? "Slider moved to private." : "Slider is now public." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Slider state could not be changed." });
    } finally {
      setBusy(false);
    }
  }

  async function removeSlider() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await readJson(await fetch("/api/v1/admin/sliders", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id, revision: deleteTarget.revision }),
      }));
      setDeleteTarget(null);
      setMessage({ kind: "success", text: "Slider removed." });
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Slider could not be removed." });
    } finally {
      setBusy(false);
    }
  }

  function pickImage(event: ChangeEvent<HTMLInputElement>) {
    setCustomImage(event.target.files?.[0] ?? null);
  }

  return (
    <AdminPageScaffold
      breadcrumbs={["Admin", "Insights & editorial"]}
      kicker="Homepage presentation"
      title="Sliders"
      description="Preview the exact public card, upload dedicated artwork, and control up to nine public sliders."
      message={message}
      state={loading ? { kind: "loading", message: "Loading slider history and previews…" } : { kind: "ready" }}
    >
      <div className="v46-slider-admin-summary">
        <div><strong>{active.length} / 9</strong><span>public sliders</span></div>
        <div><strong>{payload.sliders.length - active.length}</strong><span>private sliders</span></div>
        <p>Activating a tenth slider requires one explicit one-for-one replacement.</p>
      </div>
      <section className="v46-slider-create">
        <header><div><span>New slider</span><h3>Create from a series or custom campaign</h3></div></header>
        <div className="v46-slider-form">
          <label><span>Attach series</span><AdminCombobox ariaLabel="Attach series" value={draft.seriesId} emptyLabel="Custom slider" options={payload.series.map((series) => ({ value: series.id, label: series.title, description: series.slug }))} onChange={selectSeries} /></label>
          <label><span>Title</span><input value={draft.title} maxLength={140} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
          <label><span>Label</span><input value={draft.categoryLabel} maxLength={60} onChange={(event) => setDraft((current) => ({ ...current, categoryLabel: event.target.value }))} /></label>
          <label className="v46-span-two"><span>Description</span><textarea rows={3} value={draft.shortDescription} maxLength={320} onChange={(event) => setDraft((current) => ({ ...current, shortDescription: event.target.value }))} /></label>
          <label><span>Destination</span><input value={draft.destinationUrl} placeholder="/title/series-slug" onChange={(event) => setDraft((current) => ({ ...current, destinationUrl: event.target.value }))} /></label>
          <label><span>Special slider image</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={pickImage} /><small>{customImage?.name ?? "Optional wide artwork"}</small></label>
          <label className="v46-admin-switch"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} /><span>Publish immediately</span></label>
          <button className="button button-primary" type="button" disabled={busy || !draft.title.trim()} onClick={() => void createSlider()}>{busy ? <DotsRing /> : <Plus />} Add slider</button>
        </div>
        <div className="v46-slider-preview" aria-label="Public slider preview">
          {customPreviewUrl ? <img src={customPreviewUrl} alt="" /> : selectedSeries?.imageUrl ? <img src={selectedSeries.imageUrl} alt="" /> : <ImageSquare />}
          <div><small>{draft.categoryLabel || "Featured"}</small><strong>{draft.title || "Slider title"}</strong><p>{draft.shortDescription || "Your public slider description will appear here."}</p></div>
        </div>
      </section>
      <section className="v46-slider-list-section">
        <header><div><span>Newest first</span><h3>Slider history</h3></div></header>
        <div className="v46-slider-list">
          {payload.sliders.map((slider, index) => (
            <article key={slider.id} className={slider.isActive ? "is-active" : "is-private"}>
              <div className="v46-slider-thumb">{slider.imageUrl ? <img src={slider.imageUrl} alt="" /> : <ImageSquare />}</div>
              <div><small>#{index + 1} · {slider.categoryLabel}</small><h4>{slider.title}</h4><p>{slider.shortDescription || "No description"}</p><span>{slider.isActive ? "Public" : "Private"}</span></div>
              <div className="v46-slider-row-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => void toggleSlider(slider)}>{slider.isActive ? "Make private" : "Make public"}</button><button type="button" className="v46-icon-danger" aria-label={`Delete ${slider.title}`} onClick={() => setDeleteTarget(slider)}><Trash /></button></div>
            </article>
          ))}
        </div>
      </section>
      {replacementFor ? (
        <div className="v46-replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="slider-limit-title">
          <div>
            <header><span>9 / 9 public</span><h3 id="slider-limit-title">Choose one active slider to replace</h3><p>The selected slider becomes private when you confirm. Only one can be selected.</p></header>
            <div className="v46-replacement-list">{active.map((slider) => <button key={slider.id} type="button" className={replacementId === slider.id ? "is-selected" : ""} onClick={() => setReplacementId(slider.id)}>{slider.imageUrl ? <img src={slider.imageUrl} alt="" /> : <ImageSquare />}<span>{slider.title}</span><i>{replacementId === slider.id ? <X weight="bold" /> : null}</i></button>)}</div>
            <footer><button className="button button-secondary" type="button" onClick={() => { setReplacementFor(null); setReplacementId(""); }}>Keep new slider private</button><button className="button button-primary" type="button" disabled={!replacementId || busy} onClick={() => { if (replacementFor.kind === "create") void createSlider(replacementId); else void toggleSlider(replacementFor.slider, replacementId); }}><Check /> Confirm replacement</button></footer>
          </div>
        </div>
      ) : null}
      <ConfirmActionDialog open={Boolean(deleteTarget)} title="Delete this slider?" description="The slider and its dedicated artwork will be removed from the history." confirmLabel="Delete slider" busy={busy} onCancel={() => setDeleteTarget(null)} onConfirm={() => void removeSlider()} />
    </AdminPageScaffold>
  );
}
