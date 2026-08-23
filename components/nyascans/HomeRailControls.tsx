import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { type RefObject, useCallback, useEffect, useState } from "react";

type HomeRailControlsProps = {
  railRef: RefObject<HTMLElement | null>;
  label: string;
};

type RailBoundaryState = {
  canPrevious: boolean;
  canNext: boolean;
};

function readRailBoundaries(rail: HTMLElement): RailBoundaryState {
  const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
  return {
    canPrevious: rail.scrollLeft > 2,
    canNext: maxScrollLeft > 2 && rail.scrollLeft < maxScrollLeft - 2,
  };
}

function railStep(rail: HTMLElement) {
  const firstCard = rail.firstElementChild as HTMLElement | null;
  if (!firstCard) return Math.max(240, Math.round(rail.clientWidth * 0.78));
  const styles = window.getComputedStyle(rail);
  const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
  return Math.max(1, Math.round(firstCard.getBoundingClientRect().width + gap));
}

export function HomeRailControls({ railRef, label }: HomeRailControlsProps) {
  const [boundaries, setBoundaries] = useState<RailBoundaryState>({
    canPrevious: false,
    canNext: false,
  });

  const syncBoundaries = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    setBoundaries(readRailBoundaries(rail));
  }, [railRef]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    syncBoundaries();
    const handleScroll = () => syncBoundaries();
    rail.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(handleScroll);
    resizeObserver?.observe(rail);
    return () => {
      rail.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      resizeObserver?.disconnect();
    };
  }, [railRef, syncBoundaries]);

  const scroll = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollBy({
      left: direction * railStep(rail),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  return (
    <div className="home-rail-controls" aria-label={`${label} navigation`}>
      <button
        className="v481-pinned-arrow is-previous"
        type="button"
        aria-label={`Previous ${label}`}
        onClick={() => scroll(-1)}
        disabled={!boundaries.canPrevious}
      >
        <CaretLeft size={21} aria-hidden="true" />
      </button>
      <button
        className="v481-pinned-arrow is-next"
        type="button"
        aria-label={`Next ${label}`}
        onClick={() => scroll(1)}
        disabled={!boundaries.canNext}
      >
        <CaretRight size={21} aria-hidden="true" />
      </button>
    </div>
  );
}
