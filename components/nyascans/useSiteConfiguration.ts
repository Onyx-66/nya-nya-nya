"use client";

import { useEffect, useState } from "react";
import {
  defaultSiteConfiguration,
  parseSiteConfiguration,
  type SiteConfiguration,
} from "@/lib/site-configuration";

let cachedSettings: SiteConfiguration | null = null;
let cachedRevision = 0;
let activeRequest: Promise<void> | null = null;

function loadSiteConfiguration() {
  if (!activeRequest) {
    activeRequest = fetch("/api/v1/site-configuration", {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          settings?: SiteConfiguration;
          revision?: number;
        };
        cachedSettings = parseSiteConfiguration(payload.settings);
        cachedRevision = Number(payload.revision ?? 0);
      })
      .catch(() => {
        // Safe defaults keep navigation available during recovery.
      })
      .finally(() => {
        activeRequest = null;
      });
  }
  return activeRequest;
}

export function broadcastSiteConfiguration(
  settings: SiteConfiguration,
  revision: number,
) {
  cachedSettings = parseSiteConfiguration(settings);
  cachedRevision = revision;
  window.dispatchEvent(new CustomEvent("nyascans:site-configuration"));
}

export function useSiteConfiguration() {
  const [settings, setSettings] = useState<SiteConfiguration>(
    cachedSettings ?? defaultSiteConfiguration,
  );
  const [revision, setRevision] = useState(cachedRevision);

  useEffect(() => {
    let active = true;
    const sync = () => {
      if (!active) return;
      setSettings(cachedSettings ?? defaultSiteConfiguration);
      setRevision(cachedRevision);
    };
    window.addEventListener("nyascans:site-configuration", sync);
    void loadSiteConfiguration().then(sync);
    return () => {
      active = false;
      window.removeEventListener("nyascans:site-configuration", sync);
    };
  }, []);

  return { settings, revision };
}
