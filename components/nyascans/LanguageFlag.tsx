/* eslint-disable @next/next/no-img-element */

import {
  countryFlagCode,
  languageFlagCode,
  languageName,
} from "@/lib/language-flags";

type LanguageFlagProps = {
  language?: string;
  country?: string;
  label?: string;
  showCode?: boolean;
  className?: string;
};

export function LanguageFlag({
  language,
  country,
  label,
  showCode = true,
  className = "",
}: LanguageFlagProps) {
  const code = country
    ? countryFlagCode(country)
    : languageFlagCode(language ?? "");
  const accessibleLabel =
    label ?? (language ? languageName(language) : country?.toUpperCase() ?? "Unknown");
  const visibleCode = (language ?? country ?? "—").toUpperCase();
  return (
    <span
      className={`language-flag ${className}`.trim()}
      title={accessibleLabel}
    >
      <img
        src={`/flags/4x3/${code}.svg`}
        alt=""
        width={20}
        height={15}
        loading="lazy"
        aria-hidden="true"
      />
      {showCode ? <span>{visibleCode}</span> : null}
      <span className="sr-only">{accessibleLabel}</span>
    </span>
  );
}
