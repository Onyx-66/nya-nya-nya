import type { SVGProps } from "react";

export type EconomyTokenKind = "paw" | "shard";

type EconomyTokenIconProps = SVGProps<SVGSVGElement> & {
  kind: EconomyTokenKind;
  size?: number | string;
};

/**
 * Inline SVG economy marks. They intentionally use currentColor so every
 * surface inherits the active theme token instead of shipping a fixed emoji
 * color or platform-dependent glyph.
 */
export function EconomyTokenIcon({
  kind,
  size = 16,
  className,
  ...props
}: EconomyTokenIconProps) {
  const label = kind === "paw" ? "Paw" : "Shard";
  return (
    <svg
      {...props}
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={label}
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {kind === "paw" ? (
        <>
          <path
            d="M12 13.3c-2.25 0-4.7 1.9-4.7 4.2 0 1.7 1.26 2.5 2.7 2.5.87 0 1.42-.35 2-.35s1.13.35 2 .35c1.44 0 2.7-.8 2.7-2.5 0-2.3-2.45-4.2-4.7-4.2Z"
            fill="currentColor"
          />
          <ellipse cx="6.4" cy="10.1" rx="2.05" ry="2.8" transform="rotate(-25 6.4 10.1)" fill="currentColor" />
          <ellipse cx="10" cy="6.6" rx="2.05" ry="2.8" transform="rotate(-10 10 6.6)" fill="currentColor" />
          <ellipse cx="14" cy="6.6" rx="2.05" ry="2.8" transform="rotate(10 14 6.6)" fill="currentColor" />
          <ellipse cx="17.6" cy="10.1" rx="2.05" ry="2.8" transform="rotate(25 17.6 10.1)" fill="currentColor" />
        </>
      ) : (
        <path
          d="m12 2.6 7.5 6.9-4.15 11.9H8.65L4.5 9.5 12 2.6Z"
          fill="currentColor"
          fillOpacity=".18"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function PawIcon(props: Omit<EconomyTokenIconProps, "kind">) {
  return <EconomyTokenIcon {...props} kind="paw" />;
}

export function ShardIcon(props: Omit<EconomyTokenIconProps, "kind">) {
  return <EconomyTokenIcon {...props} kind="shard" />;
}
