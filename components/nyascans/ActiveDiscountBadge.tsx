"use client";

import { useEffect, useState } from "react";

type PublicDiscount = {
  seriesSlug: string;
  percentage: number;
  active: boolean;
  status: "INACTIVE" | "SCHEDULED" | "ACTIVE" | "EXPIRED";
  endsAt: string;
};

export function activeDiscountPercentages(
  discounts: PublicDiscount[],
  now = Date.now(),
) {
  return discounts.reduce((bySeries, discount) => {
    if (
      discount.active &&
      discount.status === "ACTIVE" &&
      Date.parse(discount.endsAt) > now
    ) {
      bySeries.set(
        discount.seriesSlug,
        Math.max(bySeries.get(discount.seriesSlug) ?? 0, discount.percentage),
      );
    }
    return bySeries;
  }, new Map<string, number>());
}

let activeDiscountsPromise: Promise<Map<string, number>> | null = null;
let activeDiscountsCache = new Map<string, number>();
let activeDiscountsFetchedAt = 0;
let activeDiscountRequestRevision = 0;
let activeDiscountRequestInFlight = false;
let activeDiscountRefreshPromise: Promise<Map<string, number>> | null = null;
const ACTIVE_DISCOUNT_CACHE_MS = 20_000;
export const DISCOUNTS_UPDATED_EVENT = "nyascans:discounts-updated";

async function loadActiveDiscounts() {
  if (
    !activeDiscountsPromise ||
    (!activeDiscountRequestInFlight &&
      Date.now() - activeDiscountsFetchedAt >= ACTIVE_DISCOUNT_CACHE_MS)
  ) {
    const requestRevision = ++activeDiscountRequestRevision;
    activeDiscountRequestInFlight = true;
    activeDiscountsPromise = fetch("/api/v1/discounts?sort=discount", {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return new Map<string, number>();
        const payload = (await response.json()) as { data?: PublicDiscount[] };
        return activeDiscountPercentages(payload.data ?? []);
      })
      .catch(() => new Map<string, number>())
      .then((next) => {
        if (requestRevision !== activeDiscountRequestRevision) {
          return activeDiscountsCache;
        }
        activeDiscountsCache = next;
        activeDiscountsFetchedAt = Date.now();
        return next;
      })
      .finally(() => {
        if (requestRevision === activeDiscountRequestRevision) {
          activeDiscountRequestInFlight = false;
        }
      });
  }
  return activeDiscountsPromise;
}

function refreshActiveDiscounts() {
  if (!activeDiscountRefreshPromise) {
    activeDiscountsFetchedAt = 0;
    activeDiscountsPromise = null;
    activeDiscountRefreshPromise = loadActiveDiscounts().finally(() => {
      activeDiscountRefreshPromise = null;
    });
  }
  return activeDiscountRefreshPromise;
}

export function ActiveDiscountBadge({
  seriesSlug,
  className,
}: {
  seriesSlug: string;
  className?: string;
}) {
  const [percentage, setPercentage] = useState(
    () => activeDiscountsCache.get(seriesSlug) ?? 0,
  );

  useEffect(() => {
    let mounted = true;
    const apply = (discounts: Map<string, number>) => {
      if (mounted) setPercentage(discounts.get(seriesSlug) ?? 0);
    };
    const refresh = () => {
      void refreshActiveDiscounts().then(apply);
    };
    void loadActiveDiscounts().then(apply);
    window.addEventListener(DISCOUNTS_UPDATED_EVENT, refresh);
    return () => {
      mounted = false;
      window.removeEventListener(DISCOUNTS_UPDATED_EVENT, refresh);
    };
  }, [seriesSlug]);

  if (percentage <= 0) return null;
  return (
    <span
      className={`active-discount-cover-badge${className ? ` ${className}` : ""}`}
      aria-label={`${percentage}% off`}
    >
      {percentage}% off
    </span>
  );
}
