"use client";
import { useDropdownSurface } from "./useDropdownSurface";

import { AdminCombobox } from "@/components/nyascans/admin/AdminPageScaffold";
import { LanguageFlag } from "@/components/nyascans/LanguageFlag";
import { CaretDown, CheckCircle } from "@/components/nyascans/heroicons";
import { useEffect, useId, useRef, useState } from "react";
import { languageName, normalizeLanguageCode } from "@/lib/language-flags";

const languages = [
  "ar", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "en-gb", "en-us",
  "es", "es-419", "fi", "fil", "fr", "he", "hi", "hu", "id", "it", "ja",
  "ko", "lt", "ms", "my", "nl", "no", "pl", "pt", "pt-br", "ro", "ru",
  "sv", "th", "tr", "uk", "vi", "zh", "zh-hans", "zh-hant", "zh-hk", "zh-tw",
];

function option(code: string) {
  const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? languageName(code);
  return { value: code, label: name, description: code.toUpperCase() };
}

const preferredLanguages = ["en", "ko", "ja", "zh"];
const options = [
  ...preferredLanguages.map(option),
  ...languages.filter((code) => !preferredLanguages.includes(code)).map(option)
    .sort((a, b) => a.label.localeCompare(b.label)),
];

export function LanguageSelect({ value, onChange, ariaLabel = "Language", disabled = false }: {
  value: string;
  onChange(value: string): void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDropdownSurface(open, root, panelRef);
  const panelId = useId();
  const normalized = normalizeLanguageCode(value);
  // Keep existing regional language values selectable when editing older records.
  const choices = normalized && !languages.includes(normalized)
    ? [...options, { value: normalized, label: languageName(normalized), description: normalized.toUpperCase() }]
    : options;
  const selected = choices.find((choice) => choice.value === normalized);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div className="language-select" ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}>
      <button className="language-select-trigger" type="button" ref={trigger}
        aria-label={`${ariaLabel}: ${selected?.label ?? "Choose a language"}`}
        aria-expanded={open} aria-controls={panelId} disabled={disabled}
        onClick={() => setOpen((current) => !current)}>
        <LanguageFlag language={normalized} showCode={false} />
        <span>{selected?.label ?? "Choose a language"}</span>
        <CaretDown size={16} aria-hidden="true" />
      </button>
      {open && !disabled ? (
        <div className="language-select-panel" id={panelId} ref={panelRef}>
          <AdminCombobox value={normalized} options={choices}
            onChange={(next) => {
              onChange(next);
              setOpen(false);
              trigger.current?.focus();
            }}
            ariaLabel={ariaLabel} placeholder="Search languages…"
            renderOptionLabel={(choice) => <span className="language-select-option">
              <LanguageFlag language={choice.value} showCode={false} />
              <span>{choice.label}</span>
              {choice.value === normalized ? <CheckCircle size={18} aria-hidden="true" /> : null}
            </span>} />
        </div>
      ) : null}
    </div>
  );
}
