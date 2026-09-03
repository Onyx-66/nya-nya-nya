import { z } from "zod";
import { themeCssVariables, themeDocumentSchema } from "@/lib/theme-system";

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
    label: "Nya editorial",
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

export const featuredSliderStyleOptions = [
  {
    value: "ASURA_SHOWCASE",
    label: "Asura poster wall",
    detail: "A wide, cover-first rail with a dominant title in the center.",
  },
  {
    value: "KAKAO_PANELS",
    label: "Kakao focus panels",
    detail: "A banner-led three-panel stage with cropped neighbors.",
  },
  {
    value: "ONYX_DECK",
    label: "Nya focus deck",
    detail: "The current layered five-cover NyaScans composition.",
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
  featuredSliderStyle: z
    .enum(["ASURA_SHOWCASE", "KAKAO_PANELS", "ONYX_DECK"])
    .default("ASURA_SHOWCASE"),
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
      headingWeight: z.number().int().min(400).max(900).default(760),
      bodyWeight: z.number().int().min(300).max(700).default(400),
      controlWeight: z.number().int().min(400).max(800).default(600),
      browseFilterWeight: z.number().int().min(300).max(700).default(400),
    })
    .default({
      headingScale: 1,
      bodyScale: 1,
      family: "SYSTEM",
      headingWeight: 760,
      bodyWeight: 400,
      controlWeight: 600,
      browseFilterWeight: 400,
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
    featuredSliderStyle: "ASURA_SHOWCASE",
    sliderSize: "BALANCED",
    sliderAutoplay: true,
    sliderIntervalSeconds: 7,
    newSeriesLayout: "CAROUSEL",
  }),
});

export type SiteTheme = z.infer<typeof siteThemeSchema>;

export const siteAppearanceSavedEvent = "nyascans:appearance-saved";

export type SiteAppearanceSavedDetail = {
  settings: SiteTheme;
  revision: number;
};

export const defaultSiteTheme: SiteTheme = {
  dark: {
    background: "#070708",
    backgroundSoft: "#0d0e11",
    surface: "#111216",
    surfaceRaised: "#17191f",
    surfaceStrong: "#1f222a",
    text: "#f7f8fb",
    textSoft: "#c7cbd5",
    muted: "#9198a6",
    line: "#2b2f39",
    lineStrong: "#454b59",
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
    headingWeight: 760,
    bodyWeight: 400,
    controlWeight: 600,
    browseFilterWeight: 400,
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
    featuredSliderStyle: "ASURA_SHOWCASE",
    sliderSize: "BALANCED",
    sliderAutoplay: true,
    sliderIntervalSeconds: 7,
    newSeriesLayout: "CAROUSEL",
  },
};

export type SitePalettePreset = {
  id: string;
  name: string;
  mood: string;
  summary: string;
  palette: Pick<
    SiteTheme,
    | "dark"
    | "light"
    | "accent"
    | "accentStrong"
    | "accentInk"
    | "danger"
    | "warning"
    | "success"
    | "premium"
    | "gradient"
  >;
};

export const sitePalettePresets = [
  {
    id: "moonlit-blue",
    name: "Moonlit blue",
    mood: "NyaScans signature",
    summary:
      "Deep navy surfaces, crisp sky-blue actions, and cool editorial neutrals.",
    palette: {
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
    },
  },
  {
    id: "violet-ink",
    name: "Violet ink",
    mood: "Mystic editorial",
    summary:
      "Inky plum backgrounds with restrained amethyst accents and soft lilac detail.",
    palette: {
      dark: {
        background: "#0d0a17",
        backgroundSoft: "#151020",
        surface: "#1b1529",
        surfaceRaised: "#251d37",
        surfaceStrong: "#312747",
        text: "#faf7ff",
        textSoft: "#d5cbe6",
        muted: "#998cac",
        line: "#3b3150",
        lineStrong: "#584872",
      },
      light: {
        background: "#f8f5fb",
        backgroundSoft: "#eee8f5",
        surface: "#ffffff",
        surfaceRaised: "#e8dff1",
        surfaceStrong: "#d9cee6",
        text: "#24162f",
        textSoft: "#574568",
        muted: "#7d708b",
        line: "#d2c6de",
        lineStrong: "#ad9cbd",
      },
      accent: "#b39af4",
      accentStrong: "#9277df",
      accentInk: "#160e25",
      danger: "#e97d8a",
      warning: "#d8ad5c",
      success: "#53c99c",
      premium: "#d1b7ff",
      gradient: {
        enabled: true,
        from: "#7258c9",
        to: "#c08be8",
        angle: 132,
        intensity: 88,
      },
    },
  },
  {
    id: "crimson-paper",
    name: "Crimson paper",
    mood: "Dramatic release",
    summary:
      "Charcoal-red surfaces, warm paper whites, and a confident vermilion action color.",
    palette: {
      dark: {
        background: "#140b0d",
        backgroundSoft: "#1e1013",
        surface: "#28161a",
        surfaceRaised: "#341d22",
        surfaceStrong: "#43272d",
        text: "#fff8f7",
        textSoft: "#e4c9c7",
        muted: "#aa8888",
        line: "#513037",
        lineStrong: "#73454e",
      },
      light: {
        background: "#fbf6f3",
        backgroundSoft: "#f3e9e4",
        surface: "#fffdfb",
        surfaceRaised: "#ebdcd6",
        surfaceStrong: "#dfccc5",
        text: "#32191c",
        textSoft: "#684247",
        muted: "#8d6f71",
        line: "#dec8c3",
        lineStrong: "#bb9e99",
      },
      accent: "#ee897a",
      accentStrong: "#d5675b",
      accentInk: "#250b08",
      danger: "#ff746d",
      warning: "#dda85a",
      success: "#55bf8d",
      premium: "#f2b6aa",
      gradient: {
        enabled: true,
        from: "#c44f50",
        to: "#f2a36d",
        angle: 140,
        intensity: 82,
      },
    },
  },
  {
    id: "jade-night",
    name: "Jade night",
    mood: "Quiet momentum",
    summary:
      "Blue-green night tones, clear jade actions, and calm mineral surfaces.",
    palette: {
      dark: {
        background: "#071411",
        backgroundSoft: "#0b1d19",
        surface: "#102821",
        surfaceRaised: "#17352d",
        surfaceStrong: "#20443a",
        text: "#f2fbf8",
        textSoft: "#c3dbd3",
        muted: "#83a69b",
        line: "#285347",
        lineStrong: "#3b7565",
      },
      light: {
        background: "#f2f8f5",
        backgroundSoft: "#e5f0eb",
        surface: "#ffffff",
        surfaceRaised: "#d9e9e2",
        surfaceStrong: "#c9ddd5",
        text: "#102c25",
        textSoft: "#3e6258",
        muted: "#668279",
        line: "#bfd4cc",
        lineStrong: "#91afa4",
      },
      accent: "#63d5ad",
      accentStrong: "#3bb68e",
      accentInk: "#062019",
      danger: "#e87f78",
      warning: "#d9b25d",
      success: "#4dcc9d",
      premium: "#9be3ca",
      gradient: {
        enabled: true,
        from: "#2b9f80",
        to: "#70dbc2",
        angle: 128,
        intensity: 84,
      },
    },
  },
  {
    id: "amber-studio",
    name: "Amber studio",
    mood: "Warm catalogue",
    summary:
      "Graphite-brown foundations with amber highlights and comfortable paper neutrals.",
    palette: {
      dark: {
        background: "#15110c",
        backgroundSoft: "#1d1710",
        surface: "#282016",
        surfaceRaised: "#352a1d",
        surfaceStrong: "#443626",
        text: "#fffaf0",
        textSoft: "#e1d2b8",
        muted: "#a18e70",
        line: "#51422e",
        lineStrong: "#715d41",
      },
      light: {
        background: "#faf7ef",
        backgroundSoft: "#f1eadc",
        surface: "#fffdf8",
        surfaceRaised: "#e9dfce",
        surfaceStrong: "#dcd0bc",
        text: "#302315",
        textSoft: "#65513a",
        muted: "#88765f",
        line: "#d9cbb7",
        lineStrong: "#b4a087",
      },
      accent: "#e9b968",
      accentStrong: "#cb9444",
      accentInk: "#281808",
      danger: "#e67c72",
      warning: "#e1ad53",
      success: "#62bd8b",
      premium: "#f0cc8c",
      gradient: {
        enabled: true,
        from: "#b87935",
        to: "#eccb7a",
        angle: 138,
        intensity: 78,
      },
    },
  },
] as const satisfies readonly SitePalettePreset[];

export function applySitePalettePreset(
  theme: SiteTheme,
  preset: SitePalettePreset,
): SiteTheme {
  return siteThemeSchema.parse({
    ...theme,
    ...preset.palette,
    dark: { ...preset.palette.dark },
    light: { ...preset.palette.light },
    gradient: { ...preset.palette.gradient },
  });
}

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
    "--site-heading-weight": String(theme.typography.headingWeight),
    "--site-body-weight": String(theme.typography.bodyWeight),
    "--site-control-weight": String(theme.typography.controlWeight),
    "--site-browse-filter-weight": String(theme.typography.browseFilterWeight),
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
  const bridgeTheme = themeDocumentSchema.parse({
    schemaVersion: 1,
    name: "Administrator base",
    type: "dark",
    logoColorOverride: null,
    tokens: {
      textColor: theme.dark.text,
      mainBackground: theme.dark.background,
      accent: theme.dark.surface,
      accentHover: theme.dark.surfaceRaised,
      accentActive: theme.dark.surfaceStrong,
      accentL1: theme.dark.surfaceRaised,
      accentL1Hover: theme.dark.surfaceStrong,
      accentL1Active: theme.dark.line,
      accentL2: theme.dark.surfaceStrong,
      accentL2Hover: theme.dark.line,
      accentL2Active: theme.dark.lineStrong,
      accentL3: theme.dark.line,
      accentL3Hover: theme.dark.lineStrong,
      accentL3Active: theme.dark.muted,
      accentL4: theme.dark.lineStrong,
      accentL4Hover: theme.dark.muted,
      accentL4Active: theme.dark.textSoft,
      accentL5: theme.dark.muted,
      accentL5Hover: theme.dark.textSoft,
      accentL5Active: theme.dark.text,
      midTone: theme.dark.muted,
      contrastL1: "#FFFFFF",
      scrollbarColor: theme.dark.lineStrong,
      scrollbarColorHover: theme.dark.muted,
      buttonAccent: theme.accent,
      buttonAccentAlternate: theme.accentInk,
      primary: theme.accent,
      primaryL1: theme.accentStrong,
      primaryL2: theme.gradient.from,
      statusRed: theme.danger,
      statusGreen: theme.success,
      statusYellow: theme.warning,
      statusBlue: theme.premium,
      statusPurple: theme.gradient.to,
      statusGrey: theme.dark.muted,
      indicationBlue: theme.premium,
      danger: theme.danger,
      dangerL1: theme.danger,
      dangerL2: theme.danger,
    },
  });
  Object.assign(variables, themeCssVariables(bridgeTheme));
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
    "data-featured-slider-style": theme.experience.featuredSliderStyle
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
