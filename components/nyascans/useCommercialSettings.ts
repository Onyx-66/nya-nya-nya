"use client";

import { useEffect, useState } from "react";
import {
  commercialSettingsSchema,
  failClosedCommercialSettings,
  type CommercialSettings,
} from "@/lib/commercial-settings";

export function useCommercialSettings() {
  const [settings, setSettings] = useState<CommercialSettings>(
    failClosedCommercialSettings,
  );
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/site-commercial-settings", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          settings?: unknown;
          revision?: number;
        };
        const parsed = commercialSettingsSchema.safeParse(payload.settings);
        if (!parsed.success) return;
        setSettings(parsed.data);
        setRevision(Number(payload.revision ?? 0));
      })
      .catch(() => {
        // The paid economy remains private until valid settings load.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, []);

  return { settings, revision, loaded };
}
