"use client";

import { Percent } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type PublicDiscount = {
  seriesSlug: string;
  percentage: number;
  active: boolean;
  status: "INACTIVE" | "SCHEDULED" | "ACTIVE" | "EXPIRED";
  endsAt: string;
};

let activeDiscountsPromise: Promise<Map<string, number>> | null = null;
let activeDiscountsCache = new Map<string, number>();

async function loadActiveDiscounts() {
  if (!activeDiscountsPromise) {
    activeDiscountsPromise = fetch("/api/v1/discounts?sort=discount", {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return new Map<string, number>();
        const payload = (await response.json()) as { data?: PublicDiscount[] };
        const now = Date.now();
        return (payload.data ?? []).reduce((bySeries, discount) => {
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
      })
      .catch(() => new Map<string, number>())
      .then((next) => {
        activeDiscountsCache = next;
        return next;
      });
  }
  return activeDiscountsPromise;
}

export function ActiveDiscountBadge({
  seriesSlug,
}: {
  seriesSlug: string;
}) {
  const [percentage, setPercentage] = useState(
    () => activeDiscountsCache.get(seriesSlug) ?? 0,
  );

  useEffect(() => {
    let mounted = true;
    void loadActiveDiscounts().then((discounts) => {
      if (mounted) setPercentage(discounts.get(seriesSlug) ?? 0);
    });
    return () => {
      mounted = false;
    };
  }, [seriesSlug]);

  if (percentage <= 0) return null;
  return (
    <span className="active-discount-cover-badge" aria-label={`${percentage}% off`}>
      <Percent size={12} weight="bold" aria-hidden="true" />
      {percentage}% off
    </span>
  );
}
