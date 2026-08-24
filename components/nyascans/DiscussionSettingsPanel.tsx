"use client";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";

import {
  ChatCenteredDots,
  FloppyDisk,
  Gif,
  ImageSquare,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";
import {
  defaultDiscussionSettings,
  parseDiscussionSettings,
  type DiscussionSettings,
} from "@/lib/discussion-settings";

type DiscussionSettingsResponse = {
  settings: DiscussionSettings;
  revision: number;
};

export function DiscussionSettingsPanel() {
  const [settings, setSettings] = useState<DiscussionSettings>(
    defaultDiscussionSettings,
  );
  const [saved, setSaved] = useState<DiscussionSettings>(
    defaultDiscussionSettings,
  );
  const [status, setStatus] = useState<
    "loading" | "idle" | "saving" | "saved" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  useUnsavedChanges(dirty, "discussion settings");

  async function load() {
    setStatus("loading");
    setMessage("");
    try {
      const document = await fetch("/api/v1/admin/discussion-settings", {
        cache: "no-store",
      })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: DiscussionSettingsResponse;
          settings?: DiscussionSettings;
          revision?: number;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ??
              "Discussion settings could not be loaded.",
          );
        }
        return payload.data ?? {
          settings: payload.settings ?? defaultDiscussionSettings,
          revision: payload.revision ?? 1,
        };
      });
      const next = parseDiscussionSettings(document?.settings);
      setSettings(next);
      setSaved(next);
      setRevision(Number(document?.revision ?? 0));
      setHasLoaded(true);
      setStatus("idle");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Discussion settings could not be loaded.",
      );
      setStatus("error");
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  async function save() {
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/discussion-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings, expectedRevision: revision }),
      });
      const payload = (await response.json()) as {
        data?: DiscussionSettingsResponse;
        settings?: DiscussionSettings;
        revision?: number;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ??
            "Discussion settings could not be saved.",
        );
      }
      const next = parseDiscussionSettings(
        payload.data?.settings ?? payload.settings ?? settings,
      );
      setSettings(next);
      setSaved(next);
      setRevision(
        Number(payload.data?.revision ?? payload.revision ?? revision + 1),
      );
      setStatus("saved");
      setMessage("Discussion controls saved and applied site-wide.");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Discussion settings could not be saved.",
      );
    }
  }

  if (!hasLoaded && status === "error") {
    return (
      <section className="discussion-settings-panel">
        <div className="admin-state-card" role="alert">
          <h2>Discussion settings could not be loaded</h2>
          <p>{message}</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="discussion-settings-panel">
      <header>
        <div>
          <span className="ops-kicker">
            <ChatCenteredDots size={18} /> Community discussions
          </span>
          <h2>Replies and media policy</h2>
          <p>
            Set the attachment and reply policy for every series and chapter
            thread. Use the Reaction library to manage reader reactions.
          </p>
          <p className="discussion-reaction-callout">
            Reaction set management—including Add reaction, ordering, media,
            availability, and archival—lives in the Reaction library tab.
          </p>
        </div>
        <div className="discussion-settings-actions">
          <button
            type="button"
            onClick={() => {
              setSettings(saved);
              setStatus("idle");
              setMessage("");
            }}
            disabled={
              status === "loading" || status === "saving" || !dirty
            }
          >
            Discard changes
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={save}
            disabled={
              status === "loading" || status === "saving" || !dirty
            }
          >
            <FloppyDisk size={17} />
            {status === "saving" ? "Saving…" : "Save discussions"}
          </button>
        </div>
      </header>

      {status === "loading" ? (
        <div className="settings-loading">Loading discussion controls…</div>
      ) : (
        <div className="discussion-settings-content">
          <section className="discussion-policy-grid" aria-label="Media policy">
            <article className="discussion-feature-card">
              <span className="discussion-feature-icon" aria-hidden="true">
                <ImageSquare size={22} />
              </span>
              <div className="discussion-feature-copy">
                <span>Static media</span>
                <h3>Images</h3>
                <p>Verified JPEG, PNG, and WebP files up to 8 MB.</p>
              </div>
              <label className="discussion-policy-toggle">
                <input
                  type="checkbox"
                  checked={settings.allowImages}
                  onChange={(event) => {
                    setSettings((current) => ({
                      ...current,
                      allowImages: event.target.checked,
                    }));
                    setStatus("idle");
                  }}
                />
                <span>Allow images</span>
              </label>
            </article>
            <article className="discussion-feature-card">
              <span className="discussion-feature-icon" aria-hidden="true">
                <Gif size={22} />
              </span>
              <div className="discussion-feature-copy">
                <span>Motion media</span>
                <h3>Animated GIFs</h3>
                <p>Direct GIF uploads use the same private media controls.</p>
              </div>
              <label className="discussion-policy-toggle">
                <input
                  type="checkbox"
                  checked={settings.allowGifs}
                  onChange={(event) => {
                    setSettings((current) => ({
                      ...current,
                      allowGifs: event.target.checked,
                    }));
                    setStatus("idle");
                  }}
                />
                <span>Allow GIFs</span>
              </label>
            </article>
          </section>
          <section className="discussion-limit-card">
            <header>
              <div>
                <span>Thread limits</span>
                <h3>Keep discussions readable</h3>
              </div>
              <p>
                Bound media-heavy comments and deep reply chains without
                disabling conversation.
              </p>
            </header>
            <div className="discussion-limit-grid">
            <label>
              <span>Attachments per comment</span>
              <UnifiedSingleSelect
                value={settings.maxAttachments}
                onChange={(event) => {
                  setSettings((current) => ({
                    ...current,
                    maxAttachments: Number(event.target.value),
                  }));
                  setStatus("idle");
                }}
              >
                {[1, 2, 3, 4].map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </UnifiedSingleSelect>
            </label>
            <label>
              <span>Reply depth</span>
              <UnifiedSingleSelect
                value={settings.maxReplyDepth}
                onChange={(event) => {
                  setSettings((current) => ({
                    ...current,
                    maxReplyDepth: Number(event.target.value),
                  }));
                  setStatus("idle");
                }}
              >
                {[1, 2, 3, 4].map((value) => (
                  <option value={value} key={value}>
                    {value} level{value === 1 ? "" : "s"}
                  </option>
                ))}
              </UnifiedSingleSelect>
            </label>
            </div>
          </section>
        </div>
      )}

      {message ? (
        <SystemNoticeBridge
          message={message}
          kind={
            status === "error"
              ? "error"
              : status === "saved"
                ? "success"
                : "info"
          }
        />
      ) : null}
    </section>
  );
}
