const languageToCountry: Record<string, string> = {
  ar: "sa",
  bg: "bg",
  bn: "bd",
  ca: "es",
  cs: "cz",
  da: "dk",
  de: "de",
  el: "gr",
  en: "gb",
  "en-gb": "gb",
  "en-us": "us",
  es: "es",
  "es-419": "mx",
  fi: "fi",
  fil: "ph",
  fr: "fr",
  he: "il",
  hi: "in",
  hu: "hu",
  id: "id",
  it: "it",
  ja: "jp",
  ko: "kr",
  lt: "lt",
  ms: "my",
  my: "mm",
  nl: "nl",
  no: "no",
  pl: "pl",
  pt: "pt",
  "pt-br": "br",
  ro: "ro",
  ru: "ru",
  sv: "se",
  th: "th",
  tr: "tr",
  uk: "ua",
  vi: "vn",
  zh: "cn",
  "zh-cn": "cn",
  "zh-hans": "cn",
  "zh-hant": "tw",
  "zh-hk": "hk",
  "zh-tw": "tw",
};

const languageNames: Record<string, string> = {
  ar: "Arabic",
  bn: "Bengali",
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  hi: "Hindi",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  ms: "Malay",
  nl: "Dutch",
  pl: "Polish",
  pt: "Portuguese",
  "pt-br": "Brazilian Portuguese",
  ru: "Russian",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  zh: "Chinese",
  "zh-hans": "Simplified Chinese",
  "zh-hant": "Traditional Chinese",
};

export function normalizeLanguageCode(value: string) {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

export function languageFlagCode(value: string) {
  const normalized = normalizeLanguageCode(value);
  return (
    languageToCountry[normalized] ??
    languageToCountry[normalized.split("-")[0] ?? ""] ??
    "un"
  );
}

export function languageName(value: string) {
  const normalized = normalizeLanguageCode(value);
  return (
    languageNames[normalized] ??
    languageNames[normalized.split("-")[0] ?? ""] ??
    normalized.toUpperCase()
  );
}

export function countryFlagCode(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : "un";
}
