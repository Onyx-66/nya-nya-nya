"use client";

import { useEffect, useState } from "react";
import { StoreManagementPanel } from "@/components/nyascans/StoreManagementPanel";
import { CommerceOfferManager } from "@/components/nyascans/admin/CommerceOfferManager";

export type StoreAdminCategory =
  | "coins"
  | "memberships"
  | "banners"
  | "cosmetics"
  | "logo-effects";

const bannerCategories = ["PROFILE_BANNER"] as const;
const cosmeticCategories = [
  "PROFILE_FRAME",
  "USERNAME_DECORATION",
  "COMMENT_EFFECT",
  "COMMENT_GRADIENT",
  "SEASONAL_PROFILE",
] as const;
const logoEffectCategories = ["LOGO_EFFECT"] as const;

const categories: Array<{
  key: StoreAdminCategory;
  label: string;
  summary: string;
  tools: string[];
}> = [
  {
    key: "coins",
    label: "Coins",
    summary: "Packages, pricing, bonuses, and lifecycle",
    tools: ["Packages", "Pricing & bonuses", "Visibility & order"],
  },
  {
    key: "memberships",
    label: "Memberships",
    summary: "Plans, benefits, billing, and lifecycle",
    tools: ["Plans", "Benefits", "Billing & visibility"],
  },
  {
    key: "banners",
    label: "Banners",
    summary: "Profile placements, collections, and previews",
    tools: ["Items", "Collections", "Preview & order"],
  },
  {
    key: "cosmetics",
    label: "Cosmetics",
    summary: "Frames, decorations, comment effects, and seasonal items",
    tools: ["Items", "Collections", "Ownership & equip rules"],
  },
  {
    key: "logo-effects",
    label: "Logo Effects",
    summary: "Safe effect configuration and live previews",
    tools: ["Items", "Effect settings", "Preview & order"],
  },
];

const categoryGroups: Array<{
  key: string;
  label: string;
  summary: string;
  categories: StoreAdminCategory[];
}> = [
  {
    key: "commercial",
    label: "Revenue and access",
    summary:
      "Customer-facing packages, recurring plans, pricing, and availability.",
    categories: ["coins", "memberships"],
  },
  {
    key: "personalization",
    label: "Visual inventory",
    summary:
      "Profile, comment, and brand cosmetics grouped by where customers use them.",
    categories: ["banners", "cosmetics", "logo-effects"],
  },
];

export function StoreManagementWorkspace({
  initialCategory = "coins",
  onCategoryChange,
}: {
  initialCategory?: StoreAdminCategory;
  onCategoryChange?: (
    category: StoreAdminCategory,
    confirmedDiscard: boolean,
  ) => void;
}) {
  const [category, setCategory] = useState<StoreAdminCategory>(initialCategory);
  const [dirtyState, setDirtyState] = useState({
    dirty: false,
    label: "Store changes",
  });
  const [counts, setCounts] = useState<Record<StoreAdminCategory, number>>({
    coins: 0,
    memberships: 0,
    banners: 0,
    cosmetics: 0,
    "logo-effects": 0,
  });
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  useEffect(() => {
    function onDirty(event: Event) {
      const detail = (
        event as CustomEvent<{ dirty?: boolean; label?: string }>
      ).detail;
      setDirtyState({
        dirty: Boolean(detail?.dirty),
        label: detail?.label || "Store changes",
      });
    }
    window.addEventListener("nyascans-admin-dirty", onDirty);
    return () => window.removeEventListener("nyascans-admin-dirty", onDirty);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setCategory(initialCategory);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialCategory]);

  useEffect(() => {
    void fetch("/api/v1/store/products?category=coins", {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Store summary unavailable");
        return (await response.json()) as {
          categoryCounts?: Partial<Record<StoreAdminCategory, number>>;
        };
      })
      .then((payload) => {
        if (payload.categoryCounts) {
          setCounts((current) => ({
            ...current,
            ...payload.categoryCounts,
          }));
          setCountsLoaded(true);
          setSummaryError("");
        }
      })
      .catch(() => {
        setSummaryError(
          "Category status counts are temporarily unavailable. Management tools remain usable.",
        );
      });
  }, []);

  function open(next: StoreAdminCategory) {
    if (next === category) return;
    const confirmedDiscard =
      dirtyState.dirty &&
      window.confirm(`Discard unsaved ${dirtyState.label}?`);
    if (dirtyState.dirty && !confirmedDiscard) return;
    setCategory(next);
    window.sessionStorage.setItem("nyascans-admin-store-category", next);
    onCategoryChange?.(next, confirmedDiscard);
  }

  const selectedCategory =
    categories.find((item) => item.key === category) ?? categories[0]!;

  return (
    <section className="store-management-workspace">
      <header className="store-management-heading">
        <div>
          <span className="ops-kicker">Marketplace inventory</span>
          <h2>Store Management</h2>
          <p>
            Each Store category has isolated tools, queries, media, statuses,
            and customer-facing previews.
          </p>
        </div>
      </header>
      <div className="store-management-groups">
        {categoryGroups.map((group) => (
          <section key={group.key} className="store-management-group">
            <header>
              <span>{group.label}</span>
              <p>{group.summary}</p>
            </header>
            <div className="store-management-category-grid">
              {group.categories.map((categoryKey) => {
                const item = categories.find(
                  (candidate) => candidate.key === categoryKey,
                )!;
                const active = category === item.key;
                return (
                  <button
                    key={item.key}
                    className={`store-management-category-card${
                      active ? " is-active" : ""
                    }`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => open(item.key)}
                  >
                    <span className="store-management-category-title">
                      <strong>{item.label}</strong>
                      <em>
                        {countsLoaded
                          ? `${counts[item.key]} live`
                          : "Count unavailable"}
                      </em>
                    </span>
                    <small>{item.summary}</small>
                    <span className="store-management-category-tools">
                      {item.tools.map((tool) => (
                        <i key={tool}>{tool}</i>
                      ))}
                    </span>
                    <span className="store-management-category-action">
                      {active ? "Editing now" : `Manage ${item.label}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {summaryError ? (
        <p className="admin-notice admin-notice-neutral" role="status">
          {summaryError}
        </p>
      ) : null}
      <div className="store-management-selection" aria-live="polite">
        <span>Editing workspace</span>
        <strong>{selectedCategory.label}</strong>
        <small>{selectedCategory.summary}</small>
      </div>
      <div className="store-management-active-panel">
        {category === "coins" ? (
          <CommerceOfferManager
            key="coins"
            initialKind="CURRENCY_PACKAGE"
          />
        ) : category === "memberships" ? (
          <CommerceOfferManager
            key="memberships"
            initialKind="MEMBERSHIP"
          />
        ) : category === "banners" ? (
          <StoreManagementPanel
            title="Banner Management"
            categoryFilter={bannerCategories}
            defaultCategory="PROFILE_BANNER"
          />
        ) : category === "cosmetics" ? (
          <StoreManagementPanel
            title="Cosmetics Management"
            categoryFilter={cosmeticCategories}
            defaultCategory="PROFILE_FRAME"
          />
        ) : (
          <StoreManagementPanel
            title="Logo Effects Management"
            categoryFilter={logoEffectCategories}
            defaultCategory="LOGO_EFFECT"
          />
        )}
      </div>
    </section>
  );
}
