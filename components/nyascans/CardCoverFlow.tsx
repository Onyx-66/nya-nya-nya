"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

type CardCoverFlowProps<T> = {
  items: T[];
  renderCard: (item: T, index: number, active: boolean) => ReactNode;
  label: string;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  autoAdvanceMs?: number;
  className?: string;
};

function wrapIndex(index: number, count: number) {
  if (!count) return 0;
  return ((index % count) + count) % count;
}

function circularOffset(index: number, activeIndex: number, count: number) {
  const direct = index - activeIndex;
  if (Math.abs(direct) <= count / 2) return direct;
  return direct > 0 ? direct - count : direct + count;
}

export function CardCoverFlow<T>({
  items,
  renderCard,
  label,
  activeIndex: controlledIndex,
  onActiveIndexChange,
  autoAdvanceMs = 7_000,
  className = "",
}: CardCoverFlowProps<T>) {
  const reduceMotion = useReducedMotion();
  const [uncontrolledIndex, setUncontrolledIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;
  const activeIndex = wrapIndex(controlledIndex ?? uncontrolledIndex, count);

  const setIndex = useCallback(
    (nextIndex: number) => {
      const next = wrapIndex(nextIndex, count);
      setUncontrolledIndex(next);
      onActiveIndexChange?.(next);
    },
    [count, onActiveIndexChange],
  );

  useEffect(() => {
    if (count < 2 || paused || autoAdvanceMs <= 0) return;
    const timer = window.setInterval(() => setIndex(activeIndex + 1), autoAdvanceMs);
    return () => window.clearInterval(timer);
  }, [activeIndex, autoAdvanceMs, count, paused, setIndex]);

  useEffect(() => {
    if (count && activeIndex >= count) setIndex(0);
  }, [activeIndex, count, setIndex]);

  const visibleItems = useMemo(
    () => items
      .map((item, index) => ({ item, index, offset: circularOffset(index, activeIndex, count) }))
      .filter(({ offset }) => Math.abs(offset) <= 2),
    [activeIndex, count, items],
  );

  if (!count) return null;

  const move = (direction: -1 | 1) => setIndex(activeIndex + direction);

  return (
    <section
      className={`card-coverflow ${className}`.trim()}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        }
      }}
    >
      <div className="card-coverflow__viewport">
        <button
          className="card-coverflow__arrow card-coverflow__arrow--previous"
          type="button"
          aria-label={`Previous ${label}`}
          onClick={() => move(-1)}
          disabled={count < 2}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div className="card-coverflow__track" tabIndex={0} aria-live="polite">
          <AnimatePresence initial={false}>
            {visibleItems.map(({ item, index, offset }) => {
              const active = offset === 0;
              const distance = Math.abs(offset);
              return (
                <motion.div
                  className="card-coverflow__slide"
                  data-coverflow-offset={offset}
                  data-coverflow-active={active ? "true" : "false"}
                  key={String(index)}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${index + 1} of ${count}`}
                  aria-hidden={!active && distance > 1 ? "true" : undefined}
                  initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.82 }}
                  animate={{
                    x: `${offset * 72}%`,
                    y: active ? 0 : distance === 1 ? 14 : 30,
                    scale: active ? 1 : distance === 1 ? 0.9 : 0.78,
                    rotate: active ? 0 : offset < 0 ? -8 : 8,
                    opacity: active ? 1 : distance === 1 ? 0.54 : 0.2,
                  }}
                  exit={{ opacity: 0, scale: 0.76 }}
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 230, damping: 28, mass: 0.72 }}
                  whileHover={reduceMotion ? undefined : { y: active ? -5 : 8 }}
                  whileFocus={reduceMotion ? undefined : { y: active ? -5 : 8 }}
                  onClick={() => {
                    if (!active) setIndex(index);
                  }}
                >
                  {renderCard(item, index, active)}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        <button
          className="card-coverflow__arrow card-coverflow__arrow--next"
          type="button"
          aria-label={`Next ${label}`}
          onClick={() => move(1)}
          disabled={count < 2}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
      {count > 1 ? (
        <div className="card-coverflow__progress" aria-label={`Choose ${label} slide`}>
          {items.map((item, index) => (
            <button
              className={index === activeIndex ? "is-active" : ""}
              type="button"
              key={String(index)}
              aria-label={`Go to ${label} slide ${index + 1}`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => setIndex(index)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
