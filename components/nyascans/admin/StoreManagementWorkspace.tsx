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
  const [expanded, setExpanded] = useState<StoreAdminCategory | null>(
    initialCategory,
  );
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
      setExpanded(initialCategory);
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
    if (next === category) {
      setExpanded(next);
      return;
    }
    const confirmedDiscard =
      dirtyState.dirty &&
      window.confirm(`Discard unsaved ${dirtyState.label}?`);
    if (dirtyState.dirty && !confirmedDiscard) return;
    setCategory(next);
    setExpanded(next);
    window.sessionStorage.setItem("nyascans-admin-store-category", next);
    onCategoryChange?.(next, confirmedDiscard);
  }

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
      <div className="store-management-category-grid">
        {categories.map((item) => (
          <details
            key={item.key}
            open={expanded === item.key}
            onToggle={(event) => {
              if (event.currentTarget.open) {
                open(item.key);
              } else if (expanded === item.key) {
                if (
                  dirtyState.dirty &&
                  !window.confirm(
                    `Hide this category with unsaved ${dirtyState.label}? Your draft will stay available until you leave the category.`,
                  )
                ) {
                  event.currentTarget.open = true;
                  return;
                }
                setExpanded(null);
              }
            }}
          >
            <summary>
              <span>
                <strong>{item.label}</strong>
                <small>{item.summary}</small>
              </span>
              <em>
                {countsLoaded
                  ? `${counts[item.key]} live`
                  : "Count unavailable"}{" "}
                ·{" "}
                {expanded === item.key ? "Open" : "Collapsed"}
              </em>
            </summary>
            <nav aria-label={`${item.label} tools`}>
              {item.tools.map((tool) => <span key={tool}>{tool}</span>)}
            </nav>
            <button
              className="button button-primary"
              type="button"
              onClick={() => open(item.key)}
            >
              Manage {item.label}
            </button>
          </details>
        ))}
      </div>
      {summaryError ? (
        <p className="admin-notice admin-notice-neutral" role="status">
          {summaryError}
        </p>
      ) : null}
      <div
        className="store-management-active-panel"
        hidden={expanded !== category}
      >
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
