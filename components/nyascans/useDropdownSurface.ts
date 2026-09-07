"use client";
import { useLayoutEffect, type RefObject } from "react";

/** Keep shared dropdowns readable even when their trigger is a compact filter. */
export function useDropdownSurface(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  surfaceRef: RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const surface = surfaceRef.current;
    if (!open || !anchor || !surface) return;
    // LanguageSelect owns the outer popup; its combobox list stays in normal flow.
    if (anchor.closest(".language-select-panel")) return;
    const position = () => {
      const bounds = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const available = Math.max(0, viewportWidth - 24);
      const width = Math.min(Math.max(bounds.width, 288), available);
      const left = Math.max(12, Math.min(bounds.left, viewportWidth - width - 12));
      surface.style.width = `${width}px`;
      surface.style.minWidth = "0";
      surface.style.maxWidth = `${available}px`;
      surface.style.left = `${left - bounds.left}px`;
      surface.style.right = "auto";
      const below = window.innerHeight - bounds.bottom - 16;
      const above = bounds.top - 16;
      const upwards = below < Math.min(surface.scrollHeight, 240) && above > below;
      surface.style.top = upwards ? "auto" : "calc(100% + .4rem)";
      surface.style.bottom = upwards ? "calc(100% + .4rem)" : "auto";
      surface.style.maxHeight = `${Math.max(0, Math.min(360, upwards ? above : below))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    observer.observe(surface);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, anchorRef, surfaceRef]);
}
