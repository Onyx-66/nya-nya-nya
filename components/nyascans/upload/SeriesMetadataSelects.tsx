"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AdminCombobox } from "@/components/nyascans/admin/AdminPageScaffold";
import { LanguageFlag } from "@/components/nyascans/LanguageFlag";
import { CaretDown, Compass } from "@/components/nyascans/heroicons";
import { useDropdownSurface } from "@/components/nyascans/useDropdownSurface";

const origins = [
  { value: "JP", label: "Japan" }, { value: "KR", label: "Korea" },
  { value: "CN", label: "China" }, { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" }, { value: "MIDDLE_EAST", label: "Middle East" },
  { value: "ID", label: "Indonesia" },
];

function OriginFlag({ value }: { value: string }) {
  return value === "MIDDLE_EAST"
    ? <Compass size={20} aria-label="Regional origin" />
    : <LanguageFlag country={value} showCode={false} />;
}

function usePicker() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDropdownSurface(open, root, panel);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return { open, setOpen, root, panel, trigger, id };
}

export function CountryOriginSelect({ value, onChange }: { value: string; onChange(value: string): void }) {
  const picker = usePicker();
  const options = origins.some((entry) => entry.value === value) ? origins : [...origins, { value, label: value }];
  const selected = options.find((entry) => entry.value === value);
  return <div className="language-select" ref={picker.root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) picker.setOpen(false); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); picker.setOpen(false); picker.trigger.current?.focus(); } }}>
    <button className="language-select-trigger" type="button" ref={picker.trigger}
      aria-label={`Country of origin: ${selected?.label}`} aria-expanded={picker.open} aria-controls={picker.id}
      onClick={() => picker.setOpen(!picker.open)}>
      <OriginFlag value={value} /><span>{selected?.label}</span><CaretDown size={16} />
    </button>
    {picker.open ? <div className="language-select-panel" id={picker.id} ref={picker.panel}>
      <AdminCombobox value={value} options={options} ariaLabel="Country of origin" placeholder="Search origins…"
        onChange={(next) => { onChange(next); picker.setOpen(false); picker.trigger.current?.focus(); }}
        renderOptionLabel={(entry) => <span className="language-select-option"><OriginFlag value={entry.value} /><span>{entry.label}</span></span>} />
    </div> : null}
  </div>;
}

export function GenreMultiSelect({ values, options, onChange }: {
  values: string[]; options: Array<{ id: string; name: string }>; onChange(values: string[]): void;
}) {
  const picker = usePicker();
  const [query, setQuery] = useState("");
  const names = [...new Set([...options.map((entry) => entry.name), ...values])].sort((a, b) => a.localeCompare(b));
  return <div className="language-select genre-multi-select" ref={picker.root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) picker.setOpen(false); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); picker.setOpen(false); picker.trigger.current?.focus(); } }}>
    <button type="button" className="language-select-trigger" ref={picker.trigger}
      aria-label="Select genres" aria-expanded={picker.open} aria-controls={picker.id}
      onClick={() => picker.setOpen(!picker.open)}><span>{values.length ? `${values.length} genres selected` : "Select genres"}</span><CaretDown size={16} /></button>
    {values.length ? <div className="selected-genre-tags">{values.map((name) => <span key={name}>{name}</span>)}</div> : null}
    {picker.open ? <div className="language-select-panel genre-options" ref={picker.panel} id={picker.id}>
      <input type="search" aria-label="Search genres" placeholder="Search genres…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div role="group" aria-label="Available genres">{names.filter((name) => name.toLowerCase().includes(query.toLowerCase())).map((name) =>
        <label key={name}><input type="checkbox" disabled={!values.includes(name) && values.length >= 40} checked={values.includes(name)} onChange={(event) => onChange(event.target.checked ? [...values, name] : values.filter((value) => value !== name))} /><span>{name}</span></label>)}
        {!names.length ? <p>No genres are available yet.</p> : null}
      </div>
      <div className="genre-picker-actions"><button type="button" onClick={() => onChange([])}>Clear</button><button type="button" onClick={() => { picker.setOpen(false); picker.trigger.current?.focus(); }}>Done</button></div>
    </div> : null}
  </div>;
}
