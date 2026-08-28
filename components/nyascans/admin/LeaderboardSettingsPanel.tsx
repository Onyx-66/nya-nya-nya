"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  Eye,
  FloppyDisk,
  LockSimple,
  Trophy,
  WarningCircle,
} from "@/components/nyascans/heroicons";
import {
  defaultSiteConfiguration,
  type SiteConfiguration,
} from "@/lib/site-configuration";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";

type StoredLeaderboardConfiguration = {
  settings: SiteConfiguration["leaderboard"];
  revision: number;
  updatedAt: string | null;
};

type PanelStatus = "loading" | "idle" | "saving" | "saved" | "error";

export function LeaderboardSettingsPanel() {
  const [document, setDocument] = useState<StoredLeaderboardConfiguration>({
    settings: defaultSiteConfiguration.leaderboard,
    revision: 0,
    updatedAt: null,
  });
  const [saved, setSaved] = useState<SiteConfiguration["leaderboard"]>(defaultSiteConfiguration.leaderboard);
  const [status, setStatus] = useState<PanelStatus>("loading");
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(document.settings) !== JSON.stringify(saved);
  useUnsavedChanges(dirty, "Leaderboard settings");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/admin/leaderboard-settings", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as StoredLeaderboardConfiguration & { error?: { message?: string } };
        if (!response.ok || !payload.settings) {
          throw new Error(payload.error?.message ?? "Leaderboard settings could not be loaded.");
        }
        if (!controller.signal.aborted) {
          setDocument(payload);
          setSaved(payload.settings);
          setStatus("idle");
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setMessage(reason instanceof Error ? reason.message : "Leaderboard settings could not be loaded.");
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  function updateLeaderboard(patch: Partial<SiteConfiguration["leaderboard"]>) {
    setDocument((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
    setStatus("idle");
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/leaderboard-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: document.settings, expectedRevision: document.revision }),
      });
      const payload = (await response.json()) as StoredLeaderboardConfiguration & { error?: { message?: string } };
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error?.message ?? "Leaderboard settings could not be saved.");
      }
      setDocument(payload);
      setSaved(payload.settings);
      setStatus("saved");
      setMessage("Leaderboard settings are live.");
      window.dispatchEvent(new Event("nyascans:site-configuration"));
    } catch (reason: unknown) {
      setStatus("error");
      setMessage(reason instanceof Error ? reason.message : "Leaderboard settings could not be saved.");
    }
  }

  const leaderboard = document.settings;

  return (
    <form className="appearance-presentation-panel leaderboard-settings-panel" onSubmit={save}>
      <header className="appearance-presentation-header">
        <div>
          <span className="ops-kicker"><Trophy size={17} /> Community controls</span>
          <h2>Leaderboard</h2>
          <p>Control whether the public leaderboard is visible and explain the actions that help readers raise their Score.</p>
        </div>
        <button className="button button-primary" type="submit" disabled={status === "loading" || status === "saving" || !dirty}>
          <FloppyDisk size={17} /> {status === "saving" ? "Saving…" : "Save Leaderboard"}
        </button>
      </header>

      {message ? (
        <div className={`appearance-presentation-notice is-${status === "error" ? "error" : status === "saved" ? "success" : "info"}`} role={status === "error" ? "alert" : "status"}>
          {status === "error" ? <WarningCircle size={17} /> : status === "saved" ? <Check size={17} /> : null}
          <span>{message}</span>
        </div>
      ) : null}

      <section className="admin-settings-card leaderboard-visibility-card" aria-labelledby="leaderboard-visibility-title">
        <div className="admin-settings-card-heading">
          <div>
            <span className="ops-kicker"><Eye size={16} /> Public availability</span>
            <h3 id="leaderboard-visibility-title">Leaderboard visibility</h3>
            <p>Private mode hides the public page and rejects direct Leaderboard API requests with a not-found response.</p>
          </div>
          <span className={`admin-settings-status ${leaderboard.isPublic ? "is-public" : "is-private"}`}>
            {leaderboard.isPublic ? <Eye size={15} /> : <LockSimple size={15} />}
            {leaderboard.isPublic ? "Public" : "Private"}
          </span>
        </div>
        <div className="admin-segmented-control" role="radiogroup" aria-label="Leaderboard visibility">
          <button type="button" role="radio" aria-checked={leaderboard.isPublic} className={leaderboard.isPublic ? "is-selected" : ""} onClick={() => updateLeaderboard({ isPublic: true })}>
            <Eye size={17} /> Public
          </button>
          <button type="button" role="radio" aria-checked={!leaderboard.isPublic} className={!leaderboard.isPublic ? "is-selected" : ""} onClick={() => updateLeaderboard({ isPublic: false })}>
            <LockSimple size={17} /> Private
          </button>
        </div>
      </section>

      <section className="admin-settings-card leaderboard-guidance-card" aria-labelledby="leaderboard-guidance-title">
        <div className="admin-settings-card-heading">
          <div>
            <span className="ops-kicker"><Trophy size={16} /> Reader guidance</span>
            <h3 id="leaderboard-guidance-title">How readers raise Score</h3>
            <p>This copy appears beneath the public Leaderboard introduction. Keep it short, clear, and actionable.</p>
          </div>
        </div>
        <label className="admin-field-label">
          <span>Guidance heading</span>
          <input value={leaderboard.guidanceTitle} maxLength={120} onChange={(event) => updateLeaderboard({ guidanceTitle: event.target.value })} />
        </label>
        <label className="admin-field-label">
          <span>Guidance explanation</span>
          <textarea value={leaderboard.guidanceBody} maxLength={4000} rows={6} onChange={(event) => updateLeaderboard({ guidanceBody: event.target.value })} />
        </label>
      </section>
    </form>
  );
}
