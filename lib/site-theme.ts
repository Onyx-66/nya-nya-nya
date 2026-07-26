import { z } from "zod";

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hexadecimal color.");

const paletteSchema = z.object({
  background: hexColor,
  backgroundSoft: hexColor,
  surface: hexColor,
  surfaceRaised: hexColor,
  surfaceStrong: hexColor,
  text: hexColor,
  textSoft: hexColor,
  muted: hexColor,
  line: hexColor,
  lineStrong: hexColor,
});

export const templateStyleOptions = [
  {
    value: "ONYX_EDITORIAL",
    label: "Onyx editorial",
    detail: "Cinematic hero, calm spacing, and premium editorial shelves.",
  },
  {
    value: "WEBTOON_SPOTLIGHT",
    label: "Webtoon spotlight",
    detail: "Large visual moments, generous breathing room, and vertical-first discovery.",
  },
  {
    value: "SCAN_DIRECTORY",
    label: "Scan directory",
    detail: "Dense catalogue scanning, compact metadata, and fast chapter discovery.",
  },
  {
    value: "CINEMA_RAILS",
    label: "Cinema rails",
    detail: "Full-width shelves, strong ranking numbers, and immersive dark surfaces.",
  },
  {
    value: "PAPER_SHELF",
    label: "Paper shelf",
    detail: "Clean library rhythm, restrained decoration, and readable information density.",
  },
] as const;

export const sliderStyleOptions = [
  {
    value: "POSTER_RAIL",
    label: "Poster rail",
    detail: "A smooth horizontal shelf with snap points.",
  },
  {
    value: "CLEAN_GRID",
    label: "Clean grid",
    detail: "A responsive, evenly aligned cover grid.",
  },
  {
    value: "RANK_STRIP",
    label: "Rank strip",
    detail: "Prominent ranking numbers beside every cover.",
  },
  {
    value: "SPOTLIGHT_STACK",
    label: "Spotlight stack",
    detail: "A larger leading title followed by a compact shelf.",
  },
  {
    value: "CHAPTER_CAROUSEL",
    label: "Chapter carousel",
    detail: "Compact covers with the latest chapter kept in focus.",
  },
] as const;

export const sliderSizeOptions = [
  { value: "COMPACT", label: "Compact", detail: "More titles per row" },
  { value: "BALANCED", label: "Balanced", detail: "Default reading density" },
  { value: "LARGE", label: "Large", detail: "Bigger cover artwork" },
] as const;

export const newSeriesLayoutOptions = [
  {
    value: "CAROUSEL",
    label: "Trending-style carousel",
    detail: "A swipeable cover rail with compact details and a New marker.",
  },
  {
    value: "CLASSIC_GRID",
    label: "Classic grid",
    detail: "Keep the current multi-column New Series card layout.",
  },
] as const;

const experienceSchema = z.object({
  template: z
    .enum([
      "ONYX_EDITORIAL",
      "WEBTOON_SPOTLIGHT",
      "SCAN_DIRECTORY",
      "CINEMA_RAILS",
      "PAPER_SHELF",
    ])
    .default("ONYX_EDITORIAL"),
  sliderStyle: z
    .enum([
      "POSTER_RAIL",
      "CLEAN_GRID",
      "RANK_STRIP",
      "SPOTLIGHT_STACK",
      "CHAPTER_CAROUSEL",
    ])
    .default("POSTER_RAIL"),
  sliderSize: z.enum(["COMPACT", "BALANCED", "LARGE"]).default("BALANCED"),
  sliderAutoplay: z.boolean().default(true),
  sliderIntervalSeconds: z.number().int().min(3).max(15).default(7),
  newSeriesLayout: z.enum(["CAROUSEL", "CLASSIC_GRID"]).default("CAROUSEL"),
});

export const siteThemeSchema = z.object({
  dark: paletteSchema,
  light: paletteSchema,
  accent: hexColor,
  accentStrong: hexColor,
  accentInk: hexColor,
  danger: hexColor,
  warning: hexColor,
  success: hexColor.default("#39c98a"),
  premium: hexColor.default("#8ecbff"),
  gradient: z.object({
    enabled: z.boolean(),
    from: hexColor,
    to: hexColor,
    angle: z.number().int().min(0).max(360),
    intensity: z.number().int().min(0).max(100),
  }),
  radius: z.number().int().min(0).max(28),
  typography: z
    .object({
      headingScale: z.number().min(0.85).max(1.3),
      bodyScale: z.number().min(0.85).max(1.2),
      family: z.enum(["SYSTEM", "EDITORIAL", "GEOMETRIC"]),
    })
    .default({
      headingScale: 1,
      bodyScale: 1,
      family: "SYSTEM",
    }),
  layout: z
    .object({
      spacingDensity: z.enum(["COMPACT", "COMFORTABLE", "SPACIOUS"]),
      containerWidth: z.number().int().min(960).max(1_600),
      buttonRadius: z.number().int().min(0).max(32),
      cardRadius: z.number().int().min(0).max(36),
      shadowStrength: z.number().int().min(0).max(100),
    })
    .default({
      spacingDensity: "COMFORTABLE",
      containerWidth: 1_320,
      buttonRadius: 12,
      cardRadius: 16,
      shadowStrength: 35,
    }),
  navigation: z
    .object({
      density: z.enum(["COMPACT", "COMFORTABLE"]),
      stickyHeader: z.boolean(),
      showLabelsOnMobile: z.boolean(),
    })
    .default({
      density: "COMFORTABLE",
      stickyHeader: true,
      showLabelsOnMobile: true,
    }),
  experience: experienceSchema.default({
    template: "ONYX_EDITORIAL",
    sliderStyle: "POSTER_RAIL",
    sliderSize: "BALANCED",
    sliderAutoplay: true,
    sliderIntervalSeconds: 7,
    newSeriesLayout: "CAROUSEL",
  }),
});

export type SiteTheme = z.infer<typeof siteThemeSchema>;

export const defaultSiteTheme: SiteTheme = {
  dark: {
    background: "#07111f",
    backgroundSoft: "#0a1728",
    surface: "#0d1d31",
    surfaceRaised: "#12263f",
    surfaceStrong: "#18314f",
    text: "#f4f9fd",
    textSoft: "#bfd1df",
    muted: "#829db1",
    line: "#244563",
    lineStrong: "#376789",
  },
  light: {
    background: "#f3f8fc",
    backgroundSoft: "#e8f1f8",
    surface: "#ffffff",
    surfaceRaised: "#dceaf4",
    surfaceStrong: "#cddfeb",
    text: "#0b2134",
    textSoft: "#34566f",
    muted: "#647f92",
    line: "#bfd2df",
    lineStrong: "#91afc3",
  },
  accent: "#39a9ff",
  accentStrong: "#168de2",
  accentInk: "#03111f",
  danger: "#ef8175",
  warning: "#e6bd61",
  success: "#39c98a",
  premium: "#8ecbff",
  gradient: {
    enabled: true,
    from: "#168de2",
    to: "#68d5ff",
    angle: 135,
    intensity: 100,
  },
  radius: 14,
  typography: {
    headingScale: 1,
    bodyScale: 1,
    family: "SYSTEM",
  },
  layout: {
    spacingDensity: "COMFORTABLE",
    containerWidth: 1320,
    buttonRadius: 12,
    cardRadius: 16,
    shadowStrength: 35,
  },
  navigation: {
    density: "COMFORTABLE",
    stickyHeader: true,
    showLabelsOnMobile: true,
  },
  experience: {
    template: "ONYX_EDITORIAL",
    sliderStyle: "POSTER_RAIL",
    sliderSize: "BALANCED",
    sliderAutoplay: true,
    sliderIntervalSeconds: 7,
    newSeriesLayout: "CAROUSEL",
  },
};

export function parseSiteTheme(value: unknown): SiteTheme {
  const parsed = siteThemeSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultSiteTheme;
}

export function siteThemeVariables(theme: SiteTheme) {
  const variables: Record<string, string> = {
    "--site-dark-bg": theme.dark.background,
    "--site-dark-bg-soft": theme.dark.backgroundSoft,
    "--site-dark-surface": theme.dark.surface,
    "--site-dark-surface-2": theme.dark.surfaceRaised,
    "--site-dark-surface-3": theme.dark.surfaceStrong,
    "--site-dark-text": theme.dark.text,
    "--site-dark-text-soft": theme.dark.textSoft,
    "--site-dark-muted": theme.dark.muted,
    "--site-dark-line": theme.dark.line,
    "--site-dark-line-strong": theme.dark.lineStrong,
    "--site-light-bg": theme.light.background,
    "--site-light-bg-soft": theme.light.backgroundSoft,
    "--site-light-surface": theme.light.surface,
    "--site-light-surface-2": theme.light.surfaceRaised,
    "--site-light-surface-3": theme.light.surfaceStrong,
    "--site-light-text": theme.light.text,
    "--site-light-text-soft": theme.light.textSoft,
    "--site-light-muted": theme.light.muted,
    "--site-light-line": theme.light.line,
    "--site-light-line-strong": theme.light.lineStrong,
    "--site-accent": theme.accent,
    "--site-accent-strong": theme.accentStrong,
    "--site-accent-ink": theme.accentInk,
    "--site-danger": theme.danger,
    "--site-warning": theme.warning,
    "--site-success": theme.success,
    "--site-premium": theme.premium,
    "--site-gradient-from": theme.gradient.from,
    "--site-gradient-to": theme.gradient.to,
    "--site-gradient-angle": `${theme.gradient.angle}deg`,
    "--site-gradient-intensity": `${theme.gradient.intensity}%`,
    "--site-radius": `${theme.radius}px`,
    "--site-heading-scale": String(theme.typography.headingScale),
    "--site-body-scale": String(theme.typography.bodyScale),
    "--site-container-width": `${theme.layout.containerWidth}px`,
    "--site-button-radius": `${theme.layout.buttonRadius}px`,
    "--site-card-radius": `${theme.layout.cardRadius}px`,
    "--site-shadow-strength": `${theme.layout.shadowStrength}%`,
    "--site-spacing-density":
      theme.layout.spacingDensity === "COMPACT"
        ? "0.86"
        : theme.layout.spacingDensity === "SPACIOUS"
          ? "1.15"
          : "1",
  };
  variables["--site-brand-gradient"] = theme.gradient.enabled
    ? `linear-gradient(${theme.gradient.angle}deg, ${theme.gradient.from}, color-mix(in srgb, ${theme.gradient.to} ${theme.gradient.intensity}%, ${theme.gradient.from}))`
    : theme.accent;
  return variables;
}

export function siteThemeDataAttributes(theme: SiteTheme) {
  return {
    "data-site-template": theme.experience.template
      .toLowerCase()
      .replaceAll("_", "-"),
    "data-slider-style": theme.experience.sliderStyle
      .toLowerCase()
      .replaceAll("_", "-"),
    "data-slider-size": theme.experience.sliderSize.toLowerCase(),
    "data-slider-autoplay": String(theme.experience.sliderAutoplay),
    "data-new-series-layout": theme.experience.newSeriesLayout
      .toLowerCase()
      .replaceAll("_", "-"),
    "data-slider-interval": String(
      theme.experience.sliderIntervalSeconds,
    ),
    "data-site-font": theme.typography.family.toLowerCase(),
    "data-navigation-density": theme.navigation.density.toLowerCase(),
    "data-sticky-header": String(theme.navigation.stickyHeader),
    "data-mobile-nav-labels": String(
      theme.navigation.showLabelsOnMobile,
    ),
  };
}
