import { Check, FloppyDisk, Tag, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import {
  defaultCommercialSettings,
  type CommercialSettings,
} from "@/lib/commercial-settings";
import {
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";

type StoredCommercialDocument = {
  settings: CommercialSettings;
  revision: number;
  updatedAt: string | null;
};

type DiscountCardStyle = CommercialSettings["discounts"]["cardStyle"];

const styleOptions: ReadonlyArray<{
  value: DiscountCardStyle;
  label: string;
  summary: string;
}> = [
  {
    value: "STYLE_1",
    label: "Style 1 · Horizontal Ticket",
    summary: "Compact cover-and-details card for a fast scan.",
  },
  {
    value: "STYLE_2",
    label: "Style 2 · Spotlight / Hero",
    summary: "One featured offer with a larger visual emphasis.",
  },
  {
    value: "STYLE_3",
    label: "Style 3 · Two-up Grid",
    summary: "Two balanced offers shown side by side on wider screens.",
  },
];

function DiscountPreview({ style }: { style: DiscountCardStyle }) {
  return (
    <div className={`appearance-discount-preview is-${style.toLowerCase()}`} aria-hidden="true">
      <span className="appearance-discount-preview-cover">
        <span className="appearance-discount-preview-art"><Tag size={22} /></span>
        <b>−40%</b>
      </span>
      <span className="appearance-discount-preview-copy">
        <strong>Moonlit Courier</strong>
        <small>Chapter 24 · 108 Paw Coins</small>
        <em>Ends in 2d 04h</em>
      </span>
    </div>
  );
}

export function DiscountCardStylePanel() {
  const [document, setDocument] = useState<StoredCommercialDocument>({
    settings: defaultCommercialSettings,
    revision: 0,
    updatedAt: null,
  });
  const [saved, setSaved] = useState<CommercialSettings>(defaultCommercialSettings);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(document.settings) !== JSON.stringify(saved);
  useUnsavedChanges(dirty, "discount presentation");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/admin/commercial-settings", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as StoredCommercialDocument & { error?: { message?: string } };
        if (!response.ok || !payload.settings) {
          throw new Error(payload.error?.message ?? "Discount presentation could not be loaded.");
        }
        if (!controller.signal.aborted) {
          setDocument(payload);
          setSaved(payload.settings);
          setStatus("idle");
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setMessage(reason instanceof Error ? reason.message : "Discount presentation could not be loaded.");
        setStatus("error");
      });
    return () => controller.abort();
  }, []);

  function updateDiscounts(patch: Partial<CommercialSettings["discounts"]>) {
    setDocument((current) => ({
      ...current,
      settings: {
        ...current.settings,
        discounts: { ...current.settings.discounts, ...patch },
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
      const response = await fetch("/api/v1/admin/commercial-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings: document.settings,
          expectedRevision: document.revision,
        }),
      });
      const payload = (await response.json()) as StoredCommercialDocument & { error?: { message?: string } };
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error?.message ?? "Discount presentation could not be saved.");
      }
      setDocument(payload);
      setSaved(payload.settings);
      setStatus("saved");
      setMessage("Discount presentation is live across the homepage and All Discounts page.");
    } catch (reason: unknown) {
      setStatus("error");
      setMessage(reason instanceof Error ? reason.message : "Discount presentation could not be saved.");
    }
  }

  return (
    <form className="appearance-presentation-panel appearance-discount-style-panel" onSubmit={save}>
      <header className="appearance-presentation-header">
        <div>
          <span className="ops-kicker"><Tag size={17} /> Homepage merchandising</span>
          <h2>Discount card presentation</h2>
          <p>Choose the visual structure used by the homepage Discounts rail and the public All Discounts page. Offer data, pricing, and checkout remain managed in Store.</p>
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
      <section className="appearance-presentation-window" aria-labelledby="discount-style-options-title">
        <div className="appearance-presentation-window-heading">
          <div>
            <span>Presentation modes</span>
            <h3 id="discount-style-options-title">Select a card structure</h3>
          </div>
          <span className="appearance-presentation-status">{document.settings.discounts.cardStyle.replace("STYLE_", "Style ")}</span>
        </div>
        <div className="appearance-discount-style-options" role="radiogroup" aria-label="Discount card style">
          {styleOptions.map((option) => {
            const selected = document.settings.discounts.cardStyle === option.value;
            return (
              <button
                className={`appearance-discount-style-option${selected ? " is-selected" : ""}`}
                type="button"
                role="radio"
                aria-checked={selected}
                key={option.value}
                onClick={() => updateDiscounts({ cardStyle: option.value })}
              >
                <DiscountPreview style={option.value} />
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
      <section className="appearance-presentation-window appearance-discount-headline-window">
        <div>
          <span>Spotlight content</span>
          <h3>Style 2 default headline</h3>
          <p>This fallback is used when an individual discount does not provide its own Spotlight / Hero headline.</p>
        </div>
        <label>
          <span>Default headline</span>
          <input
            value={document.settings.discounts.defaultHeadline}
            maxLength={120}
            required
            onChange={(event) => updateDiscounts({ defaultHeadline: event.target.value })}
          />
        </label>
      </section>
    </form>
  );
}
