"use client";
import {
  motion,
  useReducedMotion,
  type MotionProps,
} from "framer-motion";
import type { CSSProperties } from "react";

export type DotsRingSize = "inline" | "sm" | "md" | "lg" | "xl";

type DotsRingProps = {
  size?: DotsRingSize | number;
  label?: string | null;
  className?: string;
  decorative?: boolean;
};

type DotsRingStyle = CSSProperties & {
  "--dots-ring-size"?: string;
};

const sizeClassNames: Record<DotsRingSize, string> = {
  inline: "dots-ring--inline",
  sm: "dots-ring--sm",
  md: "dots-ring--md",
  lg: "dots-ring--lg",
  xl: "dots-ring--xl",
};

const orbitMotion: MotionProps["animate"] = { rotate: 360 };
const orbitTransition: MotionProps["transition"] = {
  duration: 1.15,
  ease: "linear",
  repeat: Infinity,
};

export function DotsRing({
  size = "md",
  label = "Loading",
  className,
  decorative = false,
}: DotsRingProps) {
  const reducedMotion = useReducedMotion();
  const sizeClass = typeof size === "number" ? "dots-ring--custom" : sizeClassNames[size];
  const style: DotsRingStyle = typeof size === "number"
    ? { "--dots-ring-size": `${Math.max(10, size)}px` }
    : {};
  const accessible = !decorative && Boolean(label);

  return (
    <span
      className={["dots-ring", sizeClass, className].filter(Boolean).join(" ")}
      style={style}
      role={accessible ? "status" : undefined}
      aria-label={accessible ? label ?? undefined : undefined}
      aria-live={accessible ? "polite" : undefined}
      aria-hidden={accessible ? undefined : true}
    >
      <motion.span
        className="dots-ring__orbit"
        animate={reducedMotion ? undefined : orbitMotion}
        transition={reducedMotion ? undefined : orbitTransition}
      >
        <motion.span className="dots-ring__dot dots-ring__dot--one" />
        <motion.span className="dots-ring__dot dots-ring__dot--two" />
        <motion.span className="dots-ring__dot dots-ring__dot--three" />
      </motion.span>
    </span>
  );
}
