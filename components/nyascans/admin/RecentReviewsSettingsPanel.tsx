import { Check, FloppyDisk, Star, WarningCircle } from "@/components/nyascans/heroicons";
import { useEffect, useState, type FormEvent } from "react";
import {
  defaultSiteConfiguration,
  type RecentReviewsPresentationStyle,
  type SiteConfiguration,
} from "@/lib/site-configuration";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";

type StoredSiteConfiguration = {
  settings: SiteConfiguration;
  revision: number;
  updatedAt: string | null;
};

const styleOptions: ReadonlyArray<{
  value: RecentReviewsPresentationStyle;
  label: string;
  summary: string;
}> = [
  {
    value: "CLASSIC_RAIL",
    label: "Classic review rail",
    summary: "The standard wide card with generous review copy.",
  },
  {
    value: "COMPACT_RAIL",
    label: "Compact review rail",
    summary: "A denser card treatment for more reviews in the same viewport.",
  },
];

function ReviewPreview({ style }: { style: RecentReviewsPresentationStyle }) {
  return (
    <div className={`appearance-review-preview is-${style.toLowerCase()}`} aria-hidden="true">
      <span className="appearance-review-preview-cover"><Star size={18} weight="fill" /></span>
      <span className="appearance-review-preview-copy">
        <strong>Moonlit Courier</strong>
        <span><Star size={10} weight="fill" /><Star size={10} weight="fill" /><Star size={10} weight="fill" /><Star size={10} weight="fill" /><Star size={10} /></span>
        <small>A spoiler-safe reader review appears here.</small>
      </span>
    </div>
  );
}

export function RecentReviewsSettingsPanel() {
  const [document, setDocument] = useState<StoredSiteConfiguration>({
    settings: defaultSiteConfiguration,
    revision: 0,
    updatedAt: null,
  });
  const [saved, setSaved] = useState<SiteConfiguration>(defaultSiteConfiguration);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(document.settings) !== JSON.stringify(saved);
  useUnsavedChanges(dirty, "recent reviews presentation");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/admin/site-configuration", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as StoredSiteConfiguration & { error?: { message?: string } };
        if (!response.ok || !payload.settings) {
          throw new Error(payload.error?.message ?? "Recent Reviews presentation could not be loaded.");
        }
        if (!controller.signal.aborted) {
          setDocument(payload);
          setSaved(payload.settings);
          setStatus("idle");
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setMessage(reason instanceof Error ? reason.message : "Recent Reviews presentation could not be loaded.");
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  function updateStyle(value: RecentReviewsPresentationStyle) {
    setDocument((current) => ({
      ...current,
      settings: {
        ...current.settings,
        homepage: { ...current.settings.homepage, recentReviewsStyle: value },
      },
    }));
    setStatus("idle");
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/site-configuration", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: document.settings, expectedRevision: document.revision }),
      });
      const payload = (await response.json()) as StoredSiteConfiguration & { error?: { message?: string } };
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error?.message ?? "Recent Reviews presentation could not be saved.");
      }
      setDocument(payload);
      setSaved(payload.settings);
      setStatus("saved");
      setMessage("Recent Reviews presentation is live on the homepage.");
      window.dispatchEvent(new Event("nyascans:site-configuration"));
    } catch (reason: unknown) {
      setStatus("error");
      setMessage(reason instanceof Error ? reason.message : "Recent Reviews presentation could not be saved.");
    }
  }

  return (
    <form className="appearance-presentation-panel appearance-reviews-style-panel" onSubmit={save}>
      <header className="appearance-presentation-header">
        <div>
          <span className="ops-kicker"><Star size={17} weight="fill" /> Homepage community</span>
          <h2>Recent Reviews presentation</h2>
          <p>Choose the density of the Recent Reviews rail while keeping review content, reactions, and reader links unchanged.</p>
        </div>
        <button className="button button-primary" type="submit" disabled={status === "loading" || status === "saving" || !dirty}>
          <FloppyDisk size={17} /> {status === "saving" ? "Saving…" : "Save presentation"}
        </button>
      </header>
      {message ? (
        <div className={`appearance-presentation-notice is-${status === "error" ? "error" : status === "saved" ? "success" : "info"}`} role={status === "error" ? "alert" : "status"}>
          {status === "error" ? <WarningCircle size={17} /> : status === "saved" ? <Check size={17} /> : null}
          <span>{message}</span>
        </div>
      ) : null}
      <section className="appearance-presentation-window" aria-labelledby="recent-reviews-style-options-title">
        <div className="appearance-presentation-window-heading">
          <div>
            <span>Presentation modes</span>
            <h3 id="recent-reviews-style-options-title">Select a review rail</h3>
          </div>
          <span className="appearance-presentation-status">{document.settings.homepage.recentReviewsStyle.replace("_", " ")}</span>
        </div>
        <div className="appearance-review-style-options" role="radiogroup" aria-label="Recent Reviews presentation style">
          {styleOptions.map((option) => {
            const selected = document.settings.homepage.recentReviewsStyle === option.value;
            return (
              <button
                className={`appearance-review-style-option${selected ? " is-selected" : ""}`}
                type="button"
                role="radio"
                aria-checked={selected}
                key={option.value}
                onClick={() => updateStyle(option.value)}
              >
                <ReviewPreview style={option.value} />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.summary}</small>
                </span>
                <i aria-hidden="true">{selected ? <Check size={16} weight="bold" /> : null}</i>
              </button>
            );
          })}
        </div>
      </section>
    </form>
  );
}
