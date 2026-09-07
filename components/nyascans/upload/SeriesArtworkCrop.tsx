"use client";

import { useEffect, useRef, useState } from "react";
import { computeCropRect, cropStaticMedia } from "@/lib/client/media-optimizer";

export const seriesArtworkProfiles = {
  cover: { aspect: 2 / 3, outputWidth: 800, outputHeight: 1200, maxBytes: 3_000_000 },
  banner: { aspect: 8 / 3, outputWidth: 1600, outputHeight: 600, maxBytes: 4_000_000 },
};

export function SeriesArtworkCrop({ file, slot, onCancel, onSave }: {
  file: File; slot: "cover" | "banner"; onCancel(): void; onSave(file: File): void;
}) {
  const profile = seriesArtworkProfiles[slot];
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [placement, setPlacement] = useState({ zoom: 1, x: .5, y: .5 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const loaded = new Image();
    loaded.onload = () => { image.current = loaded; setReady(true); };
    loaded.onerror = () => setError("This image could not be opened. Choose a JPEG, PNG or WebP image.");
    loaded.src = url;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      loaded.onload = loaded.onerror = null;
      URL.revokeObjectURL(url);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [file]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !image.current || !ready) return;
    const crop = computeCropRect(image.current.naturalWidth, image.current.naturalHeight, profile.aspect, placement);
    context.clearRect(0, 0, profile.outputWidth, profile.outputHeight);
    context.drawImage(image.current, crop.sourceX, crop.sourceY, crop.cropWidth, crop.cropHeight,
      0, 0, profile.outputWidth, profile.outputHeight);
  }, [placement, profile, ready]);

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try { onSave(await cropStaticMedia(file, profile, placement)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not prepare this image."); setBusy(false); }
  }
  return <div className="series-artwork-overlay">
    <div ref={dialog} className="series-artwork-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="series-artwork-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.stopPropagation(); onCancel(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header><div><h2 id="series-artwork-title">Crop your {slot}</h2><p>Adjust the frame, then use this preview.</p></div><button type="button" disabled={busy} onClick={onCancel} aria-label="Close crop">×</button></header>
      <div className={`series-artwork-canvas is-${slot}`}><canvas ref={canvas} width={profile.outputWidth} height={profile.outputHeight} aria-label={`${slot} crop preview`} /></div>
      <div className="series-artwork-controls">{([['zoom', 'Zoom', 1, 3], ['x', 'Horizontal position', 0, 1], ['y', 'Vertical position', 0, 1]] as const).map(([key, label, min, max]) =>
        <label key={key}><span>{label}</span><input type="range" min={min} max={max} step="0.01" value={placement[key]} disabled={!ready || busy} onChange={(event) => setPlacement({ ...placement, [key]: Number(event.target.value) })} /></label>)}</div>
      {error ? <p role="alert">{error}</p> : null}
      <footer><button className="button button-secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => setPlacement({ zoom: 1, x: .5, y: .5 })}>Reset</button><button className="button button-primary" type="button" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Preparing…" : `Use ${slot}`}</button></footer>
    </div>
  </div>;
}
