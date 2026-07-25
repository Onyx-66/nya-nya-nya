"use client";

import {
  ArrowClockwise,
  Check,
  Coins,
  MegaphoneSimple,
  Plus,
  ShieldCheck,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import {
  defaultCommercialSettings,
  type CoinPackage,
  type CommercialSettings,
  type MembershipOffer,
} from "@/lib/commercial-settings";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";

type StoredDocument = {
  settings: CommercialSettings;
  revision: number;
  updatedAt: string | null;
  recoveredFromInvalid?: boolean;
};

function readDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function writeDate(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function nextPackage(index: number): CoinPackage {
  return {
    id: `coin-package-${index}`,
    name: `Coin package ${index}`,
    description: "Describe who this package is intended for.",
    baseCoins: 100,
    bonusCoins: 0,
    priceMinor: 199,
    billingCurrency: "USD",
    discountPercent: 0,
    promotionLabel: "",
    featured: false,
    active: false,
  };
}

function nextMembership(index: number): MembershipOffer {
  return {
    id: `membership-${index}`,
    name: `Membership ${index}`,
    description: "Describe the included reading benefits.",
    monthlyPriceMinor: 499,
    annualPriceMinor: 4990,
    billingCurrency: "USD",
    monthlyCoins: 0,
    chapterDiscountPercent: 0,
    promotionLabel: "",
    benefits: ["Member reading benefits"],
    active: false,
  };
}

export function CommercialSettingsPanel() {
  const [document, setDocument] = useState<StoredDocument>({
    settings: defaultCommercialSettings,
    revision: 0,
    updatedAt: null,
  });
  const [saved, setSaved] = useState<CommercialSettings>(
    defaultCommercialSettings,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const dirty = JSON.stringify(document.settings) !== JSON.stringify(saved);
  useUnsavedChanges(dirty, "commercial settings");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/commercial-settings", {
        cache: "no-store",
      });
      const payload = (await response.json()) as StoredDocument & {
        error?: { message?: string };
      };
      if (!response.ok || !payload.settings) {
        throw new Error(
          payload.error?.message ?? "Commercial settings could not be loaded.",
        );
      }
      setDocument(payload);
      setSaved(payload.settings);
      setHasLoaded(true);
      setError(false);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Commercial settings could not be loaded.",
      );
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  function update(
    apply: (current: CommercialSettings) => CommercialSettings,
  ) {
    setDocument((current) => ({
      ...current,
      settings: apply(current.settings),
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
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
      const payload = (await response.json()) as StoredDocument & {
        error?: { message?: string };
      };
      if (!response.ok || !payload.settings) {
        throw new Error(
          payload.error?.message ?? "Commercial settings could not be saved.",
        );
      }
      setDocument(payload);
      setSaved(payload.settings);
      setMessage("Announcement and economy settings saved.");
      setError(false);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Commercial settings could not be saved.",
      );
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const { announcement, economy } = document.settings;
  const showTransitionalOfferEditors = false;

  if (loading) {
    return (
      <section className="control-panel commercial-settings-loading" role="status">
        <span />
        <strong>Loading commercial settings…</strong>
      </section>
    );
  }

  if (!hasLoaded && error) {
    return (
      <section className="admin-state-card" role="alert">
        <WarningCircle size={24} />
        <h3>Commercial settings unavailable</h3>
        <p>{message || "The saved commercial settings could not be loaded."}</p>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void load()}
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <form className="control-panel commercial-settings" onSubmit={save}>
      <header className="control-panel-header">
        <span>
          <Coins size={18} />
        </span>
        <div>
          <p>Monetization controls</p>
          <h2>Announcements &amp; economy</h2>
          <span>
            Configure reader-facing currency, unlock rules, and the homepage
            announcement. Product offers are managed in the normalized Offers
            tab.
          </span>
        </div>
        <div className="control-panel-actions">
          <button
            type="button"
            onClick={() => {
              if (
                dirty &&
                !window.confirm("Discard unsaved commercial settings?")
              ) {
                return;
              }
              void load();
            }}
          >
            <ArrowClockwise size={17} /> Reload
          </button>
        </div>
      </header>

      {document.recoveredFromInvalid ? (
        <div className="admin-notice is-warning" role="alert">
          <strong>Recovery defaults loaded</strong>
          <span>
            The saved commercial document was invalid. Review these safe
            defaults and save to replace the damaged configuration.
          </span>
        </div>
      ) : null}

      {message ? (
        <div
          className={`panel-message ${error ? "panel-message-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error ? <WarningCircle size={18} /> : <Check size={18} />}
          {message}
        </div>
      ) : null}

      <section className="commercial-block">
        <div className="control-section-heading">
          <div>
            <span>Homepage</span>
            <h3>Dismissible announcement</h3>
          </div>
          <MegaphoneSimple size={22} />
        </div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={announcement.enabled}
            onChange={(event) =>
              update((current) => ({
                ...current,
                announcement: {
                  ...current.announcement,
                  enabled: event.target.checked,
                },
              }))
            }
          />
          <span>Show this announcement when its schedule is active</span>
        </label>
        <div className="commercial-form-grid">
          <label>
            <span>Short label</span>
            <input
              value={announcement.label}
              maxLength={80}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  announcement: {
                    ...current.announcement,
                    label: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label>
            <span>Button label</span>
            <input
              value={announcement.buttonLabel}
              maxLength={80}
              required
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  announcement: {
                    ...current.announcement,
                    buttonLabel: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label className="commercial-wide">
            <span>Announcement text</span>
            <textarea
              value={announcement.text}
              minLength={2}
              maxLength={300}
              required
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  announcement: {
                    ...current.announcement,
                    text: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label className="commercial-wide">
            <span>Destination URL</span>
            <input
              value={announcement.destinationUrl}
              maxLength={500}
              required
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  announcement: {
                    ...current.announcement,
                    destinationUrl: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label>
            <span>Start date (optional)</span>
            <input
              type="datetime-local"
              value={readDate(announcement.startsAt)}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  announcement: {
                    ...current.announcement,
                    startsAt: writeDate(event.target.value),
                  },
                }))
              }
            />
          </label>
          <label>
            <span>End date (optional)</span>
            <input
              type="datetime-local"
              value={readDate(announcement.endsAt)}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  announcement: {
                    ...current.announcement,
                    endsAt: writeDate(event.target.value),
                  },
                }))
              }
            />
          </label>
        </div>
        <div className="announcement-reset">
          <span>
            Dismissal version {announcement.resetKey}. Increasing it shows the
            banner again to readers who previously closed it.
          </span>
          <button
            type="button"
            onClick={() =>
              update((current) => ({
                ...current,
                announcement: {
                  ...current.announcement,
                  resetKey: current.announcement.resetKey + 1,
                },
              }))
            }
          >
            Reset reader dismissals
          </button>
        </div>
      </section>

      <section className="commercial-block">
        <div className="control-section-heading">
          <div>
            <span>Currency</span>
            <h3>Coin identity &amp; unlock defaults</h3>
          </div>
          <Coins size={22} />
        </div>
        <div className="commercial-form-grid commercial-four">
          {(
            [
              ["coinName", "Singular name", "Onyx Coin"],
              ["coinPlural", "Plural name", "Onyx Coins"],
              ["coinIcon", "Icon", "◆"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={economy[key]}
                placeholder={placeholder}
                required
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    economy: {
                      ...current.economy,
                      [key]: event.target.value,
                    },
                  }))
                }
              />
            </label>
          ))}
          <label>
            <span>Default chapter price</span>
            <input
              type="number"
              min={0}
              value={economy.defaultChapterPrice}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  economy: {
                    ...current.economy,
                    defaultChapterPrice: Number(event.target.value),
                  },
                }))
              }
            />
          </label>
          <label>
            <span>Default series price</span>
            <input
              type="number"
              min={0}
              value={economy.defaultSeriesPrice}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  economy: {
                    ...current.economy,
                    defaultSeriesPrice: Number(event.target.value),
                  },
                }))
              }
            />
          </label>
          <label>
            <span>Temporary unlock duration (hours)</span>
            <input
              type="number"
              min={1}
              max={8760}
              value={economy.temporaryChapterUnlockHours}
              disabled={economy.permanentChapterUnlocks}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  economy: {
                    ...current.economy,
                    temporaryChapterUnlockHours: Number(event.target.value),
                  },
                }))
              }
            />
          </label>
        </div>
        <div className="commercial-rules">
          {(
            [
              [
                "permanentChapterUnlocks",
                "Chapter unlocks remain permanent",
              ],
              ["seriesUnlocksEnabled", "Allow whole-series unlock offers"],
              [
                "membershipDiscountsEnabled",
                "Allow membership chapter discounts",
              ],
            ] as const
          ).map(([key, label]) => (
            <label className="settings-check" key={key}>
              <input
                type="checkbox"
                checked={economy[key]}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    economy: {
                      ...current.economy,
                      [key]: event.target.checked,
                    },
                  }))
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </section>

      {showTransitionalOfferEditors ? (
      <>
      <section className="commercial-block">
        <div className="control-section-heading">
          <div>
            <span>Store</span>
            <h3>Coin packages</h3>
          </div>
          <button
            type="button"
            onClick={() =>
              update((current) => ({
                ...current,
                economy: {
                  ...current.economy,
                  packages: [
                    ...current.economy.packages,
                    nextPackage(current.economy.packages.length + 1),
                  ],
                },
              }))
            }
          >
            <Plus size={16} /> Add package
          </button>
        </div>
        <div className="commercial-repeaters">
          {economy.packages.map((item, index) => (
            <article key={`${item.id}-${index}`}>
              <header>
                <strong>{item.name || `Package ${index + 1}`}</strong>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      economy: {
                        ...current.economy,
                        packages: current.economy.packages.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      },
                    }))
                  }
                >
                  <Trash size={16} />
                </button>
              </header>
              <div className="commercial-form-grid commercial-four">
                {(
                  [
                    ["id", "Package ID", "text"],
                    ["name", "Name", "text"],
                    ["baseCoins", "Base coins", "number"],
                    ["bonusCoins", "Bonus coins", "number"],
                    ["priceMinor", "Price in cents", "number"],
                    ["billingCurrency", "Currency", "text"],
                    ["discountPercent", "Discount %", "number"],
                    ["promotionLabel", "Promotion label", "text"],
                  ] as const
                ).map(([key, label, type]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type={type}
                      value={item[key]}
                      onChange={(event) =>
                        update((current) => ({
                          ...current,
                          economy: {
                            ...current.economy,
                            packages: current.economy.packages.map(
                              (entry, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...entry,
                                      [key]:
                                        type === "number"
                                          ? Number(event.target.value)
                                          : event.target.value,
                                    }
                                  : entry,
                            ),
                          },
                        }))
                      }
                    />
                  </label>
                ))}
                <label className="commercial-wide">
                  <span>Description</span>
                  <input
                    value={item.description}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        economy: {
                          ...current.economy,
                          packages: current.economy.packages.map(
                            (entry, itemIndex) =>
                              itemIndex === index
                                ? { ...entry, description: event.target.value }
                                : entry,
                          ),
                        },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="commercial-rules">
                {(["active", "featured"] as const).map((key) => (
                  <label className="settings-check" key={key}>
                    <input
                      type="checkbox"
                      checked={item[key]}
                      onChange={(event) =>
                        update((current) => ({
                          ...current,
                          economy: {
                            ...current.economy,
                            packages: current.economy.packages.map(
                              (entry, itemIndex) =>
                                itemIndex === index
                                  ? { ...entry, [key]: event.target.checked }
                                  : entry,
                            ),
                          },
                        }))
                      }
                    />
                    <span>{key === "active" ? "Available" : "Featured"}</span>
                  </label>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="commercial-block">
        <div className="control-section-heading">
          <div>
            <span>Membership</span>
            <h3>Offers &amp; benefits</h3>
          </div>
          <button
            type="button"
            onClick={() =>
              update((current) => ({
                ...current,
                economy: {
                  ...current.economy,
                  memberships: [
                    ...current.economy.memberships,
                    nextMembership(current.economy.memberships.length + 1),
                  ],
                },
              }))
            }
          >
            <Plus size={16} /> Add membership
          </button>
        </div>
        <div className="commercial-repeaters">
          {economy.memberships.map((item, index) => (
            <article key={`${item.id}-${index}`}>
              <header>
                <strong>{item.name || `Membership ${index + 1}`}</strong>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      economy: {
                        ...current.economy,
                        memberships: current.economy.memberships.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      },
                    }))
                  }
                >
                  <Trash size={16} />
                </button>
              </header>
              <div className="commercial-form-grid commercial-four">
                {(
                  [
                    ["id", "Offer ID", "text"],
                    ["name", "Name", "text"],
                    ["monthlyPriceMinor", "Monthly cents", "number"],
                    ["annualPriceMinor", "Annual cents", "number"],
                    ["billingCurrency", "Currency", "text"],
                    ["monthlyCoins", "Monthly coins", "number"],
                    [
                      "chapterDiscountPercent",
                      "Chapter discount %",
                      "number",
                    ],
                    ["promotionLabel", "Promotion label", "text"],
                  ] as const
                ).map(([key, label, type]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type={type}
                      value={item[key]}
                      onChange={(event) =>
                        update((current) => ({
                          ...current,
                          economy: {
                            ...current.economy,
                            memberships: current.economy.memberships.map(
                              (entry, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...entry,
                                      [key]:
                                        type === "number"
                                          ? Number(event.target.value)
                                          : event.target.value,
                                    }
                                  : entry,
                            ),
                          },
                        }))
                      }
                    />
                  </label>
                ))}
                <label className="commercial-wide">
                  <span>Description</span>
                  <textarea
                    value={item.description}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        economy: {
                          ...current.economy,
                          memberships: current.economy.memberships.map(
                            (entry, itemIndex) =>
                              itemIndex === index
                                ? { ...entry, description: event.target.value }
                                : entry,
                          ),
                        },
                      }))
                    }
                  />
                </label>
                <label className="commercial-wide">
                  <span>Benefits (one per line)</span>
                  <textarea
                    value={item.benefits.join("\n")}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        economy: {
                          ...current.economy,
                          memberships: current.economy.memberships.map(
                            (entry, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...entry,
                                    benefits: event.target.value
                                      .split("\n")
                                      .map((value) => value.trim())
                                      .filter(Boolean)
                                      .slice(0, 12),
                                  }
                                : entry,
                          ),
                        },
                      }))
                    }
                  />
                </label>
              </div>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={item.active}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      economy: {
                        ...current.economy,
                        memberships: current.economy.memberships.map(
                          (entry, itemIndex) =>
                            itemIndex === index
                              ? { ...entry, active: event.target.checked }
                              : entry,
                        ),
                      },
                    }))
                  }
                />
                <span>Offer is active</span>
              </label>
            </article>
          ))}
        </div>
      </section>
      </>
      ) : null}

      <div className="admin-notice admin-notice-neutral" role="status">
        Coin packages and memberships use the database-backed offer manager.
        This prevents a second configuration list from drifting away from the
        customer Store.
      </div>

      <footer className="commercial-save">
        <span>
          <ShieldCheck size={18} /> Every change is administrator-only and
          written to the audit log.
        </span>
        <button
          className="button button-primary"
          type="submit"
          disabled={busy || !dirty}
        >
          {busy ? "Saving…" : "Save commercial settings"}
        </button>
      </footer>
    </form>
  );
}
