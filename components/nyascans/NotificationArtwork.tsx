"use client";
/* eslint-disable @next/next/no-img-element */

import {
  Bell,
  Books,
  MegaphoneSimple,
  UsersThree,
} from "@phosphor-icons/react";
import { useState } from "react";

export type NotificationSeries = {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  coverRevision: number;
};

export function NotificationArtwork({
  series,
  category,
  className = "",
}: {
  series: NotificationSeries | null;
  category?: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const Icon =
    category === "SOCIAL"
      ? UsersThree
      : category === "ANNOUNCEMENTS"
        ? MegaphoneSimple
        : series
          ? Books
          : Bell;
  const coverAvailable = Boolean(
    series?.coverUrl && failedUrl !== series.coverUrl,
  );

  return (
    <span
      className={`notification-artwork ${coverAvailable ? "has-cover" : "is-fallback"} ${className}`.trim()}
      aria-hidden="true"
    >
      {coverAvailable ? (
        <img
          src={series!.coverUrl!}
          alt=""
          loading="lazy"
          onError={() => setFailedUrl(series!.coverUrl)}
        />
      ) : (
        <Icon size={19} weight={series ? "duotone" : "regular"} />
      )}
    </span>
  );
}
