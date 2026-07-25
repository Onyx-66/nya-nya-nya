"use client";

import { useEffect, useState } from "react";
import {
  defaultCommercialSettings,
  type CommercialSettings,
} from "@/lib/commercial-settings";

export function useCommercialSettings() {
  const [settings, setSettings] = useState<CommercialSettings>(
    defaultCommercialSettings,
  );
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/site-commercial-settings", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          settings?: CommercialSettings;
          revision?: number;
        };
        if (payload.settings) setSettings(payload.settings);
        setRevision(Number(payload.revision ?? 0));
      })
      .catch(() => {
        // Safe defaults keep the reader and store usable during recovery.
      });
    return () => controller.abort();
  }, []);

  return { settings, revision };
}
