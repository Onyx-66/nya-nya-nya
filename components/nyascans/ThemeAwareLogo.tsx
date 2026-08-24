import type { SVGProps } from "react";

type ThemeAwareLogoProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  title?: string;
};

/**
 * Inline placeholder mark for the theme-bound logo pipeline. The final supplied
 * logo can replace these paths while retaining the data-logo-part attributes
 * and CSS-variable fill/stroke bindings.
 */
export function ThemeAwareLogo({
  title,
  className,
  ...props
}: ThemeAwareLogoProps) {
  return (
    <svg
      {...props}
      className={["theme-aware-logo", className].filter(Boolean).join(" ")}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path
        data-logo-part="base"
        fill="var(--theme-logo-color)"
        d="M8 52V15.5l9.5-4.3 18.8 25.2V12h10v40h-9.4L18 26.8V52H8Z"
      />
      <path
        data-logo-part="accent"
        fill="var(--theme-logo-accent-color)"
        d="m38.6 52 11.8-31.8L62 52H51.4l-1.6-5H39.9l-1.7 5h.4Zm4-13h4.6l-2.3-7.7L42.6 39Z"
      />
      <path
        data-logo-part="outline"
        fill="none"
        stroke="var(--theme-logo-outline-color)"
        strokeLinecap="round"
        strokeWidth="2.4"
        d="M12 11.5 16.5 7 21 11.5M46.5 11.5 51 7l4.5 4.5"
      />
    </svg>
  );
}
