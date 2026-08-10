"use client";

import { Keyboard, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { useSiteConfiguration } from "@/components/nyascans/useSiteConfiguration";

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { settings } = useSiteConfiguration();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    window.requestAnimationFrame(() => closeRef.current?.focus());
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      restoreFocus.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="shortcut-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="shortcut-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
      >
        <header>
          <span>
            <Keyboard size={22} />
          </span>
          <div>
            <p>Navigation guide</p>
            <h2 id="shortcut-dialog-title">Keyboard shortcuts</h2>
          </div>
          <button
            type="button"
            ref={closeRef}
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p>
          Use Ctrl/Command + K together for search. For “Go to” shortcuts,
          press G, release it, then press the destination key. Shortcuts pause
          while you type in a field.
        </p>
        <dl>
          {settings.keyboardShortcuts.filter((shortcut) => shortcut.enabled).map((shortcut) => (
            <div key={shortcut.id}>
              <dt>
                {[shortcut.prefix, shortcut.key].filter(Boolean).map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </dt>
              <dd>{shortcut.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
