"use client";
import type { CSSProperties } from "react";

export type DotsRingSize = "inline" | "sm" | "md" | "lg" | "xl";

type DotsRingProps = {
  size?: DotsRingSize | number;
  label?: string | null;
  className?: string;
  decorative?: boolean;
};

type LoaderStyle = CSSProperties & {
  "--loader-size"?: string;
};

const sizeClassNames: Record<DotsRingSize, string> = {
  inline: "dots-ring--inline",
  sm: "dots-ring--sm",
  md: "dots-ring--md",
  lg: "dots-ring--lg",
  xl: "dots-ring--xl",
};

export function DotsRing({
  size = "md",
  label = "Loading",
  className,
  decorative = false,
}: DotsRingProps) {
  const sizeClass = typeof size === "number" ? "dots-ring--custom" : sizeClassNames[size];
  const style: LoaderStyle = typeof size === "number"
    ? { "--loader-size": `${Math.max(10, size)}px` }
    : {};
  const accessible = !decorative && Boolean(label);

  return (
    <span
      className={["loader", "dots-ring", sizeClass, className].filter(Boolean).join(" ")}
      style={style}
      role={accessible ? "status" : undefined}
      aria-label={accessible ? label ?? undefined : undefined}
      aria-live={accessible ? "polite" : undefined}
      aria-hidden={accessible ? undefined : true}
    />
  );
}
