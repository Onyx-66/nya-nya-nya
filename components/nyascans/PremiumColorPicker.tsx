import {
  Check,
  ClipboardText,
  Copy,
  GridFour,
  Palette,
  Plus,
  SlidersHorizontal,
  X,
} from "@/components/nyascans/heroicons";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type RGB = { r: number; g: number; b: number };
type HSV = { h: number; s: number; v: number };

type PickerTab = "grid" | "spectrum" | "sliders";

const GRID_SWATCHES = [
  "#4A1018", "#7F1D1D", "#B91C1C", "#DC2626", "#EF4444", "#F87171", "#FCA5A5", "#FECACA", "#FFE4E6", "#FFF1F2",
  "#78350F", "#92400E", "#B45309", "#D97706", "#F59E0B", "#FBBF24", "#FCD34D", "#FDE68A", "#FEF3C7", "#FFFBEB",
  "#365314", "#3F6212", "#4D7C0F", "#65A30D", "#84CC16", "#A3E635", "#BEF264", "#D9F99D", "#ECFCCB", "#F7FEE7",
  "#064E3B", "#065F46", "#047857", "#059669", "#10B981", "#34D399", "#6EE7B7", "#A7F3D0", "#D1FAE5", "#ECFDF5",
  "#164E63", "#155E75", "#0E7490", "#0891B2", "#06B6D4", "#22D3EE", "#67E8F9", "#A5F3FC", "#CFFAFE", "#ECFEFF",
  "#172554", "#1E3A8A", "#1D4ED8", "#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#BFDBFE", "#DBEAFE", "#EFF6FF",
  "#312E81", "#3730A3", "#4338CA", "#4F46E5", "#6366F1", "#818CF8", "#A5B4FC", "#C7D2FE", "#E0E7FF", "#EEF2FF",
  "#581C87", "#6B21A8", "#7E22CE", "#9333EA", "#A855F7", "#C084FC", "#D8B4FE", "#E9D5FF", "#F3E8FF", "#FAF5FF",
  "#831843", "#9D174D", "#BE185D", "#DB2777", "#EC4899", "#F472B6", "#F9A8D4", "#FBCFE8", "#FCE7F3", "#FDF2F8",
  "#111827", "#1F2937", "#374151", "#4B5563", "#6B7280", "#9CA3AF", "#D1D5DB", "#E5E7EB", "#F3F4F6", "#F9FAFB",
];

const DEFAULT_SWATCHES = ["#E72727", "#F59E0B", "#FACC15", "#22C55E", "#2F80ED", "#6366F1", "#A855F7", "#EC4899"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHex(value: string) {
  const trimmed = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/u.test(trimmed)) return trimmed;
  if (/^[0-9A-F]{6}(?:[0-9A-F]{2})?$/u.test(trimmed)) return `#${trimmed}`;
  return null;
}

function hexToRgb(value: string): RGB {
  const hex = normalizeHex(value) ?? "#000000";
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function alphaFromHex(value: string) {
  const normalized = normalizeHex(value);
  return normalized && normalized.length === 9 ? Number.parseInt(normalized.slice(7, 9), 16) / 255 : 1;
}

function rgbToHex(rgb: RGB, alpha = 1, includeAlpha = false) {
  const base = `#${[rgb.r, rgb.g, rgb.b].map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return includeAlpha ? `${base}${Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, "0").toUpperCase()}` : base;
}

function rgbToHsv({ r, g, b }: RGB): HSV {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6);
    else if (max === green) h = 60 * ((blue - red) / delta + 2);
    else h = 60 * ((red - green) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max ? delta / max : 0, v: max };
}

function hsvToRgb({ h, s, v }: HSV): RGB {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = v - chroma;
  let rgb: [number, number, number];
  if (h < 60) rgb = [chroma, x, 0];
  else if (h < 120) rgb = [x, chroma, 0];
  else if (h < 180) rgb = [0, chroma, x];
  else if (h < 240) rgb = [0, x, chroma];
  else if (h < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return { r: Math.round((rgb[0] + match) * 255), g: Math.round((rgb[1] + match) * 255), b: Math.round((rgb[2] + match) * 255) };
}

export function PremiumColorPicker({
  value,
  onChange,
  label = "Color",
  disabled = false,
  className = "",
  includeAlpha = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  includeAlpha?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>("grid");
  const [draft, setDraft] = useState(() => normalizeHex(value) ?? "#000000");
  const [alpha, setAlpha] = useState(() => alphaFromHex(value));
  const [swatches, setSwatches] = useState(DEFAULT_SWATCHES);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const normalized = normalizeHex(value);
    if (!normalized) return;
    setDraft(normalized);
    setAlpha(alphaFromHex(normalized));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const rgb = useMemo(() => hexToRgb(draft), [draft]);
  const hsv = useMemo(() => rgbToHsv(rgb), [rgb]);
  const output = rgbToHex(rgb, alpha, includeAlpha);

  function emit(nextRgb: RGB, nextAlpha = alpha) {
    const nextHex = rgbToHex(nextRgb, nextAlpha, includeAlpha);
    setDraft(nextHex);
    setAlpha(nextAlpha);
    setError("");
    onChange(nextHex);
  }

  function selectSwatch(next: string) {
    emit(hexToRgb(next), alpha);
  }

  function updateSpectrum(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const saturation = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const brightness = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
    emit(hsvToRgb({ h: hsv.h, s: saturation, v: brightness }), alpha);
  }

  function updateHue(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const hue = clamp((event.clientX - rect.left) / rect.width, 0, 1) * 360;
    emit(hsvToRgb({ h: hue, s: hsv.s || 1, v: hsv.v || 1 }), alpha);
  }

  function updateRgb(channel: keyof RGB, next: number) {
    emit({ ...rgb, [channel]: clamp(Number.isFinite(next) ? next : 0, 0, 255) }, alpha);
  }

  function commitHex(next: string) {
    const normalized = normalizeHex(next);
    if (!normalized) {
      setError("Use a six- or eight-digit hexadecimal value.");
      return;
    }
    emit(hexToRgb(normalized), alphaFromHex(normalized));
  }

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      setCopied(false);
    }
  }

  function addSwatch() {
    setSwatches((current) => [output.slice(0, 7), ...current.filter((item) => item !== output.slice(0, 7))].slice(0, 12));
  }

  return (
    <div ref={rootRef} className={`premium-color-picker ${className}`.trim()}>
      <button type="button" className="premium-color-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
        <span className="premium-color-trigger-swatch" style={{ backgroundColor: output }} aria-hidden="true" />
        <span><strong>{label}</strong><code>{output}</code></span>
        <Palette size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="premium-picker-popover premium-color-popover" role="dialog" aria-label={`${label} picker`}>
          <div className="premium-picker-popover-head"><strong>{label}</strong><button type="button" className="premium-picker-close" aria-label="Close color picker" onClick={() => setOpen(false)}><X size={17} /></button></div>
          <div className="premium-color-tabs" role="tablist" aria-label="Color picker modes">
            <button type="button" role="tab" aria-label="Grid" aria-selected={tab === "grid"} className={tab === "grid" ? "is-active" : ""} onClick={() => setTab("grid")}><GridFour size={19} /><span>Grid</span></button>
            <button type="button" role="tab" aria-label="Spectrum" aria-selected={tab === "spectrum"} className={tab === "spectrum" ? "is-active" : ""} onClick={() => setTab("spectrum")}><Palette size={19} /><span>Spectrum</span></button>
            <button type="button" role="tab" aria-label="RGB" aria-selected={tab === "sliders"} className={tab === "sliders" ? "is-active" : ""} onClick={() => setTab("sliders")}><SlidersHorizontal size={19} /><span>RGB</span></button>
          </div>
          {tab === "grid" ? (
            <div className="premium-color-grid" role="grid" aria-label="Preset colors">{GRID_SWATCHES.map((swatch) => <button key={swatch} type="button" aria-label={`Choose ${swatch}`} style={{ backgroundColor: swatch }} onClick={() => selectSwatch(swatch)} />)}</div>
          ) : null}
          {tab === "spectrum" ? (
            <div className="premium-color-spectrum-area">
              <div ref={fieldRef} className="premium-color-spectrum" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }} onPointerDown={updateSpectrum} onPointerMove={(event) => { if (event.buttons) updateSpectrum(event); }} role="slider" aria-label="Saturation and brightness" aria-valuetext={draft} tabIndex={0}>
                <span style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
              </div>
              <div className="premium-color-hue" onPointerDown={updateHue} onPointerMove={(event) => { if (event.buttons) updateHue(event); }} role="slider" aria-label="Hue" aria-valuenow={Math.round(hsv.h)} aria-valuemin={0} aria-valuemax={360} tabIndex={0}><span style={{ left: `${(hsv.h / 360) * 100}%` }} /></div>
            </div>
          ) : null}
          {tab === "sliders" ? (
            <div className="premium-color-rgb-panel">{(["r", "g", "b"] as const).map((channel) => <label key={channel}><span>{channel.toUpperCase()}</span><input type="range" min={0} max={255} value={rgb[channel]} onChange={(event) => updateRgb(channel, Number(event.target.value))} /><input type="number" min={0} max={255} value={rgb[channel]} onChange={(event) => updateRgb(channel, Number(event.target.value))} aria-label={`${channel.toUpperCase()} value`} /></label>)}</div>
          ) : null}
          <div className="premium-color-shared-controls">
            <label className="premium-color-opacity"><span>Opacity <strong>{Math.round(alpha * 100)}%</strong></span><input type="range" min={0} max={1} step={0.01} value={alpha} onChange={(event) => { const next = Number(event.target.value); setAlpha(next); onChange(rgbToHex(rgb, next, includeAlpha)); }} style={{ background: `linear-gradient(90deg, transparent, ${draft})` }} /></label>
            <div className="premium-color-value-row"><span className="premium-color-value-swatch" style={{ backgroundColor: output }} aria-hidden="true" /><input value={output} onChange={(event) => setDraft(event.target.value.toUpperCase())} onBlur={(event) => commitHex(event.currentTarget.value)} aria-label="Hexadecimal color value" spellCheck={false} /><button type="button" onClick={() => void copyValue()} aria-label="Copy color value">{copied ? <Check size={17} /> : <Copy size={17} />}</button></div>
            {error ? <small className="premium-color-error" role="alert">{error}</small> : null}
            <div className="premium-color-swatch-heading"><strong>Swatches</strong><button type="button" aria-label="Save current color as swatch" onClick={addSwatch}><Plus size={17} /></button></div>
            <div className="premium-color-swatch-row">{swatches.map((swatch) => <button key={swatch} type="button" aria-label={`Use saved color ${swatch}`} style={{ backgroundColor: swatch }} onClick={() => selectSwatch(swatch)} />)}</div>
          </div>
          <div className="premium-picker-popover-footer"><span><ClipboardText size={16} />{output}</span><button type="button" className="button button-primary premium-picker-done" onClick={() => setOpen(false)}>Done</button></div>
        </div>
      ) : null}
    </div>
  );
}
