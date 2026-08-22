"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowRight,
  Books,
  Heart,
  CaretLeft,
  CaretRight,
  PushPin,
  Star,
  Tag,
  Timer,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActiveDiscountBadge } from "@/components/nyascans/ActiveDiscountBadge";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";
import {
  coinLabel,
  type CommercialSettings,
} from "@/lib/commercial-settings";

export type PinnedSeriesRecord = {
  id: string;
  seriesId: string;
  displayOrder: number;
  featured: boolean;
  startsAt: string | null;
  endsAt: string | null;
  scheduleStatus: "SCHEDULED" | "ACTIVE" | "EXPIRED";
  slug: string;
  title: string;
  nativeTitle: string | null;
  synopsis: string;
  type: string;
  status: string;
  chapterCount: number;
  coverUrl: string | null;
  bannerUrl: string | null;
  sliderUrl: string | null;
  href: string;
};

export type DiscountRecord = {
  id: string;
  targetType: "SERIES" | "CHAPTER";
  seriesId: string;
  chapterId: string | null;
  discountType: "PERCENT" | "FIXED";
  discountValue: number;
  originalPrice: number;
  reducedPrice: number;
  percentage: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  status: "INACTIVE" | "SCHEDULED" | "ACTIVE" | "EXPIRED";
  seriesSlug: string;
  seriesTitle: string;
  genreLabel: string;
  headline: string;
  chapterSlug: string | null;
  chapterNumber: string | null;
  chapterTitle: string | null;
  targetLabel: string;
  coverUrl: string | null;
  href: string;
  eligibleChapterCount: number;
};

type PublicDataResponse<T> = {
  data?: T[];
  error?: { message?: string; code?: string };
};

export type PinnedSeriesSectionProps = {
  initialRecords?: PinnedSeriesRecord[];
  allHref?: string;
};

export type PinnedSeriesDirectoryProps = {
  initialRecords?: PinnedSeriesRecord[];
};

export type DiscountsSectionProps = {
  enabled?: boolean;
  initialRecords?: DiscountRecord[];
  allHref?: string;
};

export type DiscountsDirectoryProps = {
  enabled?: boolean;
  initialRecords?: DiscountRecord[];
  initialSort?: "discount" | "expiry";
  unavailableHref?: string;
  onUnavailable?: () => void;
};

type RecentReviewRecord = {
  id: string;
  rating: number;
  body: string;
  spoiler: boolean | number;
  createdAt: string;
  displayName: string;
  seriesSlug: string;
  seriesTitle: string;
  coverUrl: string | null;
  reactionCount: number;
};

async function readPublicData<T>(response: Response, fallback: string) {
  const payload = (await response.json()) as PublicDataResponse<T>;
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? fallback) as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data ?? [];
}

function usePinnedSeries(initialRecords?: PinnedSeriesRecord[]) {
  const [fetchedRecords, setFetchedRecords] = useState<PinnedSeriesRecord[]>([]);
  const [loading, setLoading] = useState(initialRecords === undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialRecords !== undefined) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await readPublicData<PinnedSeriesRecord>(
          await fetch("/api/v1/pinned-series", { signal: controller.signal }),
          "Pinned Series is temporarily unavailable.",
        );
        setFetchedRecords(next);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Pinned Series is temporarily unavailable.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [initialRecords]);

  return {
    records: initialRecords ?? fetchedRecords,
    loading: initialRecords === undefined && loading,
    error: initialRecords === undefined ? error : "",
  };
}

function useDiscounts(
  enabled: boolean,
  sort: "discount" | "expiry",
  initialRecords?: DiscountRecord[],
) {
  const [fetchedRecords, setFetchedRecords] = useState<DiscountRecord[]>([]);
  const [loading, setLoading] = useState(
    enabled && initialRecords === undefined,
  );
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!enabled || initialRecords !== undefined) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await readPublicData<DiscountRecord>(
          await fetch(`/api/v1/discounts?sort=${sort}`, {
            signal: controller.signal,
          }),
          "Discounts are temporarily unavailable.",
        );
        setFetchedRecords(next);
        setError("");
        setUnavailable(false);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        const status =
          loadError instanceof Error && "status" in loadError
            ? Number((loadError as Error & { status?: number }).status)
            : 0;
        if (status === 404) {
          setFetchedRecords([]);
          setUnavailable(true);
        } else {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Discounts are temporarily unavailable.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [enabled, initialRecords, sort]);

  const records = useMemo(() => {
    const source = initialRecords ?? fetchedRecords;
    if (initialRecords === undefined) return source;
    return [...source].sort((left, right) =>
      sort === "expiry"
        ? Date.parse(left.endsAt) - Date.parse(right.endsAt)
        : right.percentage - left.percentage ||
          Date.parse(left.endsAt) - Date.parse(right.endsAt),
    );
  }, [fetchedRecords, initialRecords, sort]);

  return {
    records: enabled ? records : [],
    loading: enabled && initialRecords === undefined && loading,
    error: enabled && initialRecords === undefined ? error : "",
    unavailable: !enabled || (initialRecords === undefined && unavailable),
  };
}

function CoverArtwork({
  src,
  mobileSrc,
  title,
  eager = false,
}: {
  src: string | null;
  mobileSrc?: string | null;
  title: string;
  eager?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const desktopSource = src || mobileSrc || null;
  const mobileSource = mobileSrc || desktopSource;
  const failed = Boolean(desktopSource && desktopSource === failedSource);
  return desktopSource && !failed ? (
    <picture>
      {mobileSource && mobileSource !== desktopSource ? <source media="(max-width: 680px)" srcSet={mobileSource} /> : null}
      <img
        src={desktopSource}
        alt={`Artwork for ${title}`}
        loading={eager ? "eager" : "lazy"}
        onError={() => setFailedSource(desktopSource)}
      />
    </picture>
  ) : (
    <span className="v481-art-placeholder" aria-label={`${title} artwork unavailable`}>
      <Books size={30} />
    </span>
  );
}

function FeatureHeading({
  icon,
  title,
  allHref,
  allLabel = "All",
  controls,
  tone,
}: {
  icon: ReactNode;
  title: string;
  allHref: string;
  allLabel?: string;
  controls?: ReactNode;
  tone?: string;
}) {
  return (
    <header className={`v481-feature-heading${tone ? ` tone-${tone}` : ""}`}>
      <div>
        <span aria-hidden="true">{icon}</span>
        <h2>{title}</h2>
      </div>
      <div className="v481-heading-actions">
        {controls}
        <a className="button button-secondary latest-all-action" href={allHref}>
          {allLabel} <ArrowRight size={15} />
        </a>
      </div>
    </header>
  );
}

function PinnedSeriesCard({
  record,
  featured = false,
}: {
  record: PinnedSeriesRecord;
  featured?: boolean;
}) {
  const bannerUrl = record.bannerUrl || null;
  const mobileSliderUrl = record.sliderUrl || record.coverUrl || bannerUrl;
  return (
    <a
      className={`v481-pin-card ${featured ? "is-featured" : "is-small"}`}
      href={record.href}
      aria-label={`Open ${record.title}`}
    >
      <CoverArtwork src={bannerUrl} mobileSrc={mobileSliderUrl} title={record.title} eager={featured} />
      <ActiveDiscountBadge seriesSlug={record.slug} />
      <span className="v481-pin-shade" aria-hidden="true" />
      {featured ? <span className="v481-featured-badge">Featured</span> : null}
      <span className="v481-pin-copy">
        <strong>{record.title}</strong>
        {featured ? (
          <em>{record.synopsis || "Discover this series on NyaScans."}</em>
        ) : null}
      </span>
    </a>
  );
}

function PinnedLoading() {
  return (
    <div
      className="v481-pinned-stage is-loading"
      role="region"
      aria-roledescription="carousel"
      aria-label="Pinned Series carousel"
      aria-busy="true"
    >
      <div className="v481-pinned-track">
        {Array.from({ length: 3 }, (_, index) => (
          <span className="v481-pinned-slide" key={index} />
        ))}
      </div>
    </div>
  );
}

export function PinnedSeriesSection({
  initialRecords,
  allHref = "/pinned-series",
}: PinnedSeriesSectionProps = {}) {
  const { records, loading, error } = usePinnedSeries(initialRecords);
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const featuredRecords = useMemo(
    () => records.filter((record) => record.featured).slice(0, 9),
    [records],
  );

  const goToPinnedSeries = useCallback((index: number) => {
    const count = featuredRecords.length;
    if (!count) return;
    const nextIndex = (index + count) % count;
    const track = trackRef.current;
    const slide = track?.querySelector<HTMLElement>(
      `[data-slide-index="${nextIndex}"]`,
    );
    if (track && slide) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      track.scrollTo({
        left: slide.offsetLeft,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
    setActiveIndex(nextIndex);
  }, [featuredRecords.length]);

  useEffect(() => {
    if (featuredRecords.length && activeIndex >= featuredRecords.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, featuredRecords.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || featuredRecords.length < 2) return;
    let frame = 0;
    const syncActiveSlide = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const slides = Array.from(track.querySelectorAll<HTMLElement>("[data-slide-index]"));
        if (!slides.length) return;
        const center = track.getBoundingClientRect().left + track.clientWidth / 2;
        const nearest = slides.reduce((closest, slide) => {
          const slideCenter = slide.getBoundingClientRect().left + slide.clientWidth / 2;
          const closestCenter = closest.getBoundingClientRect().left + closest.clientWidth / 2;
          return Math.abs(slideCenter - center) < Math.abs(closestCenter - center)
            ? slide
            : closest;
        });
        setActiveIndex(Number(nearest.dataset.slideIndex ?? 0));
      });
    };
    track.addEventListener("scroll", syncActiveSlide, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", syncActiveSlide);
    };
  }, [featuredRecords.length]);

  function movePinnedSeries(direction: -1 | 1) {
    goToPinnedSeries(activeIndex + direction);
  }

  if (!loading && (error || !records.length)) return null;
  return (
    <section className="content-section page-wrap v481-pinned-section">
      <HomeFeatureStyles />
      <FeatureHeading
        icon={<PushPin size={21} weight="fill" />}
        title="Pinned Series"
        allHref={allHref}
        allLabel="All"
        tone="pinned"
      />
      {loading ? (
        <PinnedLoading />
      ) : featuredRecords.length ? (
        <div
          className="v481-pinned-stage"
          role="region"
          aria-roledescription="carousel"
          aria-label="Pinned Series carousel"
        >
          <button
            className="v481-pinned-arrow is-previous"
            type="button"
            aria-label="Previous Pinned Series"
            onClick={() => movePinnedSeries(-1)}
            disabled={featuredRecords.length < 2}
          >
            <CaretLeft size={21} />
          </button>
          <div
            className="v481-pinned-track"
            ref={trackRef}
            tabIndex={0}
            aria-live="polite"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                movePinnedSeries(-1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                movePinnedSeries(1);
              }
            }}
          >
            {featuredRecords.map((record, index) => (
              <div
                className="v481-pinned-slide"
                data-slide-index={index}
                key={record.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${featuredRecords.length}`}
              >
                <PinnedSeriesCard record={record} featured />
              </div>
            ))}
          </div>
          <button
            className="v481-pinned-arrow is-next"
            type="button"
            aria-label="Next Pinned Series"
            onClick={() => movePinnedSeries(1)}
            disabled={featuredRecords.length < 2}
          >
            <CaretRight size={21} />
          </button>
          {featuredRecords.length > 1 ? (
            <div className="v481-pinned-dots" aria-label="Choose Pinned Series slide">
              {featuredRecords.map((record, index) => (
                <button
                  type="button"
                  key={record.id}
                  aria-label={`Go to Pinned Series slide ${index + 1}`}
                  aria-current={index === activeIndex ? "true" : undefined}
                  onClick={() => goToPinnedSeries(index)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function PinnedSeriesDirectory({
  initialRecords,
}: PinnedSeriesDirectoryProps = {}) {
  const { records, loading, error } = usePinnedSeries(initialRecords);
  const featuredRecords = useMemo(
    () => records.filter((record) => record.featured).slice(0, 9),
    [records],
  );
  return (
    <main className="content-section page-wrap v481-directory">
      <HomeFeatureStyles />
      <header className="v481-directory-header">
        <span><PushPin size={22} weight="fill" /></span>
        <div>
          <small>Curated by NyaScans</small>
          <h1>Pinned Series</h1>
          <p>Browse every currently active editorial pin in one place.</p>
        </div>
      </header>
      {loading ? (
        <div className="v481-directory-grid is-loading" aria-label="Loading Pinned Series">
          {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
        </div>
      ) : error ? (
        <div className="public-discovery-error" role="alert">{error}</div>
      ) : featuredRecords.length ? (
        <div className="v481-directory-grid">
          {featuredRecords.map((record) => (
            <PinnedSeriesCard key={record.id} record={record} />
          ))}
        </div>
      ) : (
        <div className="v481-empty-state">
          <PushPin size={28} />
          <h2>No active pins</h2>
          <p>The next curated selection will appear here.</p>
        </div>
      )}
    </main>
  );
}

function DiscountCountdown({
  endsAt,
  compact = false,
}: {
  endsAt: string;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const target = Date.parse(endsAt);
  const remaining = Number.isFinite(target) ? Math.max(0, target - now) : 0;
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  const underOneDay = remaining > 0 && remaining < 86_400_000;
  const underOneHour = remaining > 0 && remaining < 3_600_000;
  const compactValue = remaining === 0
    ? "Offer ended"
    : underOneDay
      ? `${hours}h ${minutes}m ${seconds}s`
      : `${days}d ${hours}h ${minutes}m`;
  const label = remaining === 0
    ? "Offer ended"
    : `${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds remaining`;

  if (compact) {
    return (
      <span className={`v481-ticket-countdown is-compact ${underOneDay ? "is-under-day" : "is-over-day"} ${underOneHour ? "is-under-hour" : ""}`} aria-label={`Time remaining: ${label}`}>
        <Timer size={19} aria-hidden="true" />
        <span className="v481-ticket-countdown-box">{compactValue}</span>
      </span>
    );
  }

  return (
    <span className="v481-ticket-countdown" aria-label={`Time remaining: ${label}`}>
      <Timer size={19} aria-hidden="true" />
      <span className="v481-ticket-time-grid">
        <b><i>Days</i>{days}</b>
        <b><i>Hours</i>{String(hours).padStart(2, "0")}</b>
        <b><i>Minutes</i>{String(minutes).padStart(2, "0")}</b>
        <b className="is-seconds"><i>Seconds</i>{String(seconds).padStart(2, "0")}</b>
      </span>
    </span>
  );
}

function DiscountStyleOne({
  record,
  settings,
  directory = false,
}: {
  record: DiscountRecord;
  settings: CommercialSettings;
  directory?: boolean;
}) {
  return (
    <a
      className={`v481-ticket ${directory ? "is-directory" : ""}`}
      href={record.href}
      aria-label={`${record.percentage}% discount on ${record.targetLabel}`}
    >
      <span className="v481-ticket-cover">
        <CoverArtwork src={record.coverUrl} title={record.seriesTitle} />
        <span className="v481-ticket-ribbon">{record.percentage}% OFF</span>
      </span>
      <span className="v481-ticket-perforation" aria-hidden="true" />
      <span className="v481-ticket-copy">
        <span className="v481-ticket-orbit" aria-hidden="true" />
        <strong>{record.seriesTitle}</strong>
        <span className="v481-ticket-divider" aria-hidden="true"><i /></span>
        <span className="v481-ticket-chapters"><Books size={15} weight="fill" /> Chapters: {record.eligibleChapterCount}</span>
        <span className={`v481-ticket-prices${directory ? "" : " is-compact"}`}>
          <s>{coinLabel(record.originalPrice, settings)}</s>
          <b>{coinLabel(record.reducedPrice, settings)}</b>
        </span>
        <DiscountCountdown endsAt={record.endsAt} compact={!directory} />
      </span>
    </a>
  );
}

function DiscountSpotlight({
  record,
  settings,
  directory = false,
}: {
  record: DiscountRecord;
  settings: CommercialSettings;
  directory?: boolean;
}) {
  const headline = record.headline || settings.discounts.defaultHeadline;
  const saved = Math.max(0, record.originalPrice - record.reducedPrice);
  return (
    <article className={`v481-spotlight-card ${directory ? "is-directory" : ""}`}>
      <a className="v481-spotlight-cover" href={record.href} aria-label={`${record.percentage}% discount on ${record.seriesTitle}`}>
        <CoverArtwork src={record.coverUrl} title={record.seriesTitle} eager />
        <span className="v481-ticket-ribbon">{record.percentage}% OFF</span>
        <strong>{record.seriesTitle}</strong>
      </a>
      <div className="v481-spotlight-body">
        <DiscountCountdown endsAt={record.endsAt} compact />
        <h3>{headline}</h3>
        <p>Every chapter at {record.percentage}% off until the deal ends. When it does, the price returns.</p>
        <div className="v481-spotlight-price-row">
          <span className="v481-save-pill">SAVE {saved} COINS</span>
          <span className="v481-ticket-prices"><s>{coinLabel(record.originalPrice, settings)}</s><b>{record.reducedPrice}</b><span>{settings.economy.coinPlural}</span></span>
        </div>
        <div className="v481-spotlight-actions">
          <a className="v481-spotlight-primary" href={record.href}>Unlock now</a>
          <a className="v481-spotlight-secondary" href={record.href}>Save for later</a>
        </div>
        <a className="v481-spotlight-all" href="/discounts">See all deals</a>
      </div>
    </article>
  );
}

function DiscountGridCard({
  record,
  settings,
}: {
  record: DiscountRecord;
  settings: CommercialSettings;
}) {
  return (
    <a className="v481-grid-discount-card" href={record.href} aria-label={`${record.percentage}% discount on ${record.targetLabel}`}>
      <span className="v481-grid-discount-cover">
        <CoverArtwork src={record.coverUrl} title={record.seriesTitle} />
        <span className="v481-ticket-ribbon">{record.percentage}% OFF</span>
      </span>
      <span className="v481-grid-discount-copy">
        <small>{record.genreLabel}</small>
        <strong>{record.seriesTitle}</strong>
        <DiscountCountdown endsAt={record.endsAt} compact />
        <span className="v481-grid-discount-price"><s>{coinLabel(record.originalPrice, settings)}</s><b>{record.reducedPrice}</b><em>{settings.economy.coinPlural}</em></span>
      </span>
    </a>
  );
}

function DiscountTicket({
  record,
  settings,
  directory = false,
}: {
  record: DiscountRecord;
  settings: CommercialSettings;
  directory?: boolean;
}) {
  switch (settings.discounts.cardStyle) {
    case "STYLE_2":
      return <DiscountSpotlight record={record} settings={settings} directory={directory} />;
    case "STYLE_3":
      return <DiscountGridCard record={record} settings={settings} />;
    default:
      return <DiscountStyleOne record={record} settings={settings} directory={directory} />;
  }
}

function DiscountLoading({ count = 4 }: { count?: number }) {
  return (
    <div className="v481-discount-rail is-loading" aria-label="Loading discounts">
      {Array.from({ length: count }, (_, index) => <span key={index} />)}
    </div>
  );
}

export function DiscountsSection({
  enabled = true,
  initialRecords,
  allHref = "/discounts",
}: DiscountsSectionProps = {}) {
  const { settings } = useCommercialSettings();
  const { records, loading, error, unavailable } = useDiscounts(
    enabled,
    "discount",
    initialRecords,
  );
  const railRef = useRef<HTMLDivElement>(null);

  function move(direction: -1 | 1) {
    railRef.current?.scrollBy({
      left: direction * Math.max(300, railRef.current.clientWidth * 0.78),
      behavior: "smooth",
    });
  }

  const visibleRecords = settings.discounts.cardStyle === "STYLE_2" ? records.slice(0, 1) : records;
  if (unavailable || (!loading && (error || !records.length))) return null;
  return (
    <section className={`content-section page-wrap v481-discounts-section is-${settings.discounts.cardStyle.toLowerCase()}`}>
      <HomeFeatureStyles />
      <FeatureHeading
        icon={<span className="discounts-heading-icon" aria-hidden="true" />}
        title="Discounts"
        allHref={allHref}
        tone="discounts"
        controls={
              visibleRecords.length > 2 ? (
            <span className="v481-rail-controls">
              <button type="button" aria-label="Previous discounts" onClick={() => move(-1)}>
                <CaretLeft size={17} />
              </button>
              <button type="button" aria-label="Next discounts" onClick={() => move(1)}>
                <CaretRight size={17} />
              </button>
            </span>
          ) : null
        }
      />
      {loading ? (
        <DiscountLoading />
      ) : (
        <div ref={railRef} className={`v481-discount-rail is-${settings.discounts.cardStyle.toLowerCase()}`}>
          {visibleRecords.map((record) => (
            <DiscountTicket key={record.id} record={record} settings={settings} />
          ))}
        </div>
      )}
    </section>
  );
}

export function RecentReviewsSection() {
  const [records, setRecords] = useState<RecentReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const syncActiveReview = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const cards = Array.from(rail.querySelectorAll<HTMLElement>("[data-review-id]"));
    if (!cards.length) return;
    const center = rail.getBoundingClientRect().left + rail.clientWidth / 2;
    const active = cards.reduce((closest, card) => {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.left + rect.width / 2;
      const closestRect = closest.getBoundingClientRect();
      const closestCenter = closestRect.left + closestRect.width / 2;
      return Math.abs(cardCenter - center) < Math.abs(closestCenter - center)
        ? card
        : closest;
    });
    setActiveReviewId(active.dataset.reviewId ?? null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/recent-reviews?limit=6", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as PublicDataResponse<RecentReviewRecord>;
        if (!response.ok) throw new Error(payload.error?.message ?? "Recent reviews are unavailable.");
        setRecords(payload.data ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRecords([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!records.length) return;
    const frame = window.requestAnimationFrame(syncActiveReview);
    return () => window.cancelAnimationFrame(frame);
  }, [records, syncActiveReview]);

  return (
    <div className="page-wrap recent-reviews-section">
      <HomeFeatureStyles />
      <FeatureHeading
        icon={<Star size={21} weight="fill" />}
        title="Recent Reviews"
        allHref="/latest?view=reviews"
      />
      <div
        ref={railRef}
        className="recent-reviews-rail"
        aria-busy={loading}
        onScroll={syncActiveReview}
        onPointerUp={syncActiveReview}
      >
        {loading
          ? Array.from({ length: 3 }, (_, index) => <span className="recent-review-skeleton" key={index} />)
          : records.length
            ? records.map((review) => (
              <a
                className="recent-review-card"
                href={`/title/${review.seriesSlug}#reviews`}
                key={review.id}
                data-review-id={review.id}
                data-active={review.id === activeReviewId ? "true" : "false"}
              >
                <div className="recent-review-cover">
                  <CoverArtwork src={review.coverUrl} title={review.seriesTitle} />
                  <ActiveDiscountBadge seriesSlug={review.seriesSlug} />
                </div>
                <div className="recent-review-copy">
                  <strong>{review.seriesTitle}</strong>
                  <span className="recent-review-rating" aria-label={`${review.rating} out of 5 stars`}>
                    {Array.from({ length: 5 }, (_, index) => <Star key={index} size={14} weight={index < review.rating ? "fill" : "regular"} />)}
                    <b>{review.rating}/5</b>
                  </span>
                  <p>{review.spoiler ? "Spoiler review · Tap to read" : review.body}</p>
                  <span className="recent-review-meta"><span>{review.displayName}</span><span className="recent-review-reactions" aria-label={`${review.reactionCount} reactions`}><Heart size={15} weight="fill" /> {review.reactionCount}</span></span>
                </div>
              </a>
            ))
            : <div className="recent-reviews-empty"><Star size={26} /><strong>No reviews yet</strong><span>Reader reviews will appear here as the community rates published series.</span></div>}
      </div>
    </div>
  );
}

export function DiscountsDirectory({
  enabled = true,
  initialRecords,
  initialSort = "discount",
  unavailableHref = "/",
  onUnavailable,
}: DiscountsDirectoryProps = {}) {
  const { settings } = useCommercialSettings();
  const [sort, setSort] = useState<"discount" | "expiry">(initialSort);
  const { records, loading, error, unavailable } = useDiscounts(
    enabled,
    sort,
    initialRecords,
  );
  const visibleRecords = settings.discounts.cardStyle === "STYLE_2" ? records.slice(0, 1) : records;

  useEffect(() => {
    if (!unavailable) return;
    if (onUnavailable) onUnavailable();
    else if (typeof window !== "undefined" && window.location.pathname !== unavailableHref) {
      window.location.replace(unavailableHref);
    }
  }, [onUnavailable, unavailable, unavailableHref]);

  if (unavailable) return null;
  return (
    <main className="content-section page-wrap v481-directory v481-discount-directory">
      <HomeFeatureStyles />
      <header className="v481-directory-header">
        <span><Tag size={22} weight="fill" /></span>
        <div>
          <small>Limited-time offers</small>
          <h1>Discounts</h1>
          <p>Unlock selected paid chapters for fewer Paw Coins.</p>
        </div>
        <label className="v481-sort-control">
          <span>Sort by</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as "discount" | "expiry")}
          >
            <option value="discount">Highest discount</option>
            <option value="expiry">Ending soon</option>
          </select>
        </label>
      </header>
      {loading ? (
        <DiscountLoading count={8} />
      ) : error ? (
        <div className="public-discovery-error" role="alert">{error}</div>
      ) : visibleRecords.length ? (
        <div className={`v481-discount-grid is-${settings.discounts.cardStyle.toLowerCase()}`}>
          {visibleRecords.map((record) => (
            <DiscountTicket
              key={record.id}
              record={record}
              settings={settings}
              directory
            />
          ))}
        </div>
      ) : (
        <div className="v481-empty-state">
          <Tag size={28} />
          <h2>No active discounts</h2>
          <p>New limited-time offers will appear here.</p>
        </div>
      )}
    </main>
  );
}

const HOME_FEATURE_CSS = `
  .v481-feature-heading { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:1rem; }
  .v481-feature-heading > div:first-child { display:flex; align-items:center; min-width:0; gap:.65rem; }
  .v481-feature-heading > div:first-child > span { display:grid; width:2.35rem; height:2.35rem; flex:0 0 auto; place-items:center; border:1px solid color-mix(in srgb,var(--accent) 36%,var(--line)); border-radius:var(--site-button-radius,var(--radius-small)); background:color-mix(in srgb,var(--accent) 9%,var(--surface)); color:var(--accent); }
  .v481-feature-heading h2 { margin:0; font-size:clamp(1.25rem,2.3vw,1.8rem); letter-spacing:-.035em; }
  .v481-heading-actions,.v481-rail-controls { display:flex; align-items:center; gap:.45rem; }
  .v481-feature-heading .latest-all-action { display:inline-flex; min-height:2.45rem; align-items:center; gap:.35rem; padding-inline:.9rem; border-radius:var(--site-button-radius,var(--radius-small)); }
  .v481-rail-controls button { display:grid; width:2.35rem; height:2.35rem; place-items:center; border:1px solid var(--line); border-radius:var(--site-button-radius,var(--radius-small)); background:var(--surface); color:var(--text); cursor:pointer; }
  .v481-rail-controls button:is(:hover,:focus-visible) { border-color:var(--accent); color:var(--accent); }
  .v481-pinned-section .v481-feature-heading > div:first-child > span { border-color:rgb(255 216 119 / 58%); background:rgb(67 45 7 / 48%); color:#ffd877; box-shadow:0 0 1.15rem rgb(225 166 28 / 22%); }
  .v481-pinned-stage { position:relative; display:block !important; width:100% !important; min-width:0; padding:0 !important; overflow:visible; isolation:isolate; }
  .v481-pinned-track { display:flex; width:auto; min-width:0; margin-inline:clamp(2.8rem,6vw,4.4rem); overflow-x:auto; overscroll-behavior-inline:contain; padding:0 0 .8rem; scroll-snap-type:x mandatory; scroll-behavior:smooth; scrollbar-width:none; outline:none; }
  .v481-pinned-track::-webkit-scrollbar { display:none; }
  .v481-pinned-slide { display:block; flex:0 0 100%; width:100%; min-width:0; scroll-snap-align:center; scroll-snap-stop:always; }
  .v481-pinned-slide > .v481-pin-card { width:100%; min-height:0; aspect-ratio:2 / 1; }
  .v481-pinned-arrow { position:absolute; z-index:8; top:calc((100% - 2.8rem) / 2); display:grid; width:2.8rem; height:2.8rem; place-items:center; padding:0; transform:translateY(-50%); border:1px solid transparent; border-radius:50%; background:color-mix(in srgb,var(--bg) 82%,transparent); color:#ffd877; box-shadow:0 .8rem 2rem rgb(0 0 0 / 35%); cursor:pointer; isolation:isolate; backdrop-filter:blur(.8rem); }
  .v481-pinned-arrow::before { position:absolute; z-index:0; inset:-1px; padding:1px; border-radius:inherit; background:conic-gradient(from var(--v487-pin-angle),transparent 0 54%,#fff4be 64%,#e4a91d 74%,transparent 84%); content:''; pointer-events:none; -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude; animation:v487-pin-orbit 2.8s linear infinite; }
  .v481-pinned-arrow svg { position:relative; z-index:1; }
  .v481-pinned-arrow.is-previous { left:.75rem; }
  .v481-pinned-arrow.is-next { right:.75rem; }
  .v481-pinned-arrow:is(:hover,:focus-visible) { background:color-mix(in srgb,#d79c18 18%,var(--bg)); color:#fff4be; }
  .v481-pinned-arrow:disabled { cursor:default; opacity:.45; }
  .v481-pinned-dots { display:flex; align-items:center; justify-content:center; gap:.4rem; min-height:1.5rem; padding-top:.25rem; }
  .v481-pinned-dots button { width:.5rem; height:.5rem; padding:0; border:1px solid rgb(255 216 119 / 62%); border-radius:999px; background:rgb(255 255 255 / 34%); cursor:pointer; transition:width .18s ease,background-color .18s ease,transform .18s ease; }
  .v481-pinned-dots button[aria-current='true'] { width:1.35rem; background:#ffd877; box-shadow:0 0 .65rem rgb(255 216 119 / 55%); }
  .v481-pinned-dots button:is(:hover,:focus-visible) { transform:scale(1.18); background:#fff0a8; }
  .v481-feature-slot { position:relative; display:block; min-width:0; grid-column:span 2; grid-row:span 2; animation:v481-pin-fade .48s ease both; }
  .v481-pin-card { position:relative; display:block; min-width:0; height:100%; overflow:hidden; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:var(--surface-strong); color:#fff; isolation:isolate; transition:border-color .24s ease,box-shadow .24s ease,transform .24s ease; }
  .v481-pinned-slide > .v481-pin-card { border-color:transparent; box-shadow:0 0 0 1px rgb(247 198 77 / 35%),0 0 2.2rem rgb(226 166 30 / 28%),0 1.4rem 3rem rgb(0 0 0 / 34%); }
  .v481-pinned-slide > .v481-pin-card::after { position:absolute; z-index:6; inset:0; padding:2px; border-radius:inherit; background:conic-gradient(from var(--v487-pin-angle),transparent 0 56%,#fff0a8 64%,#e4a91d 74%,transparent 82%); content:''; pointer-events:none; -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude; animation:v487-pin-orbit 2.8s linear infinite; }
  .v481-featured-badge { position:absolute; z-index:5; top:.7rem; left:.7rem; display:inline-flex; min-height:1.55rem; align-items:center; padding:.22rem .48rem; border:1px solid rgb(255 216 119 / 72%); border-radius:.42rem; background:rgb(42 29 5 / 78%); color:#ffd877; font-size:.56rem; font-weight:900; letter-spacing:.07em; text-transform:none; box-shadow:0 0 .85rem rgb(225 166 28 / 20%); backdrop-filter:blur(.7rem); }
  .v481-pin-card > picture,.v481-pin-card > .v481-art-placeholder { position:absolute; z-index:-2; inset:0; width:100%; height:100%; }
  .v481-pin-card > picture > img { width:100%; height:100%; object-fit:cover; transition:transform .45s ease; }
  .v481-pin-card:hover > picture > img { transform:scale(1.035); }
  .v481-pin-shade { position:absolute; z-index:-1; inset:0; background:linear-gradient(180deg,transparent 24%,rgb(2 9 20 / 22%) 48%,rgb(2 9 20 / 94%) 100%); }
  .v481-pin-copy { position:absolute; right:0; bottom:0; left:0; display:grid; gap:.28rem; padding:clamp(.85rem,2vw,1.45rem); }
  .v481-pin-copy small { color:rgb(255 255 255 / 72%); font-size:.68rem; font-weight:750; letter-spacing:.055em; text-transform:uppercase; }
  .v481-pin-copy strong { overflow:hidden; font-size:clamp(1rem,2vw,1.5rem); letter-spacing:-.025em; text-overflow:ellipsis; white-space:nowrap; }
  .v481-pin-copy em { display:-webkit-box; overflow:hidden; max-width:42rem; color:rgb(255 255 255 / 76%); font-size:.82rem; font-style:normal; line-height:1.55; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
  .v481-pinned-bento > .v481-pin-card.is-small { min-height:0; }
  .v481-art-placeholder { display:grid; place-items:center; background:linear-gradient(135deg,var(--surface-strong),color-mix(in srgb,var(--accent) 16%,var(--surface-2))); color:var(--muted); }
  .v481-pinned-bento.is-loading > span,.v481-directory-grid.is-loading > span,.v481-discount-rail.is-loading > span { display:block; min-height:12rem; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:linear-gradient(100deg,var(--surface) 25%,var(--surface-2) 42%,var(--surface) 62%); background-size:300% 100%; animation:v481-skeleton 1.4s ease infinite; }
  .v481-pinned-stage.is-loading .v481-pinned-track { overflow:hidden; }
  .v481-pinned-stage.is-loading .v481-pinned-slide { min-height:20rem; aspect-ratio:2 / 1; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:linear-gradient(100deg,var(--surface) 25%,var(--surface-2) 42%,var(--surface) 62%); background-size:300% 100%; animation:v481-skeleton 1.4s ease infinite; }
  .v481-pinned-bento.is-loading > span:first-child { grid-column:span 2; grid-row:span 2; }
  .v481-discounts-section { position:relative; padding-block:clamp(1rem,2.3vw,1.6rem); border:0; border-radius:0; background:transparent; box-shadow:none; }
  .v481-discount-rail { display:grid; grid-auto-columns:minmax(0,100%); grid-auto-flow:column; gap:1rem; overflow-x:auto; overscroll-behavior-inline:contain; padding:.2rem .1rem .8rem; scroll-snap-type:inline mandatory; scrollbar-width:thin; }
  .v481-ticket { position:relative; display:grid; min-height:17rem; grid-template-columns:minmax(8.25rem,34%) .8rem minmax(0,1fr); overflow:hidden; border:1px solid color-mix(in srgb,var(--accent) 62%,var(--line)); border-radius:1.3rem; background:linear-gradient(135deg,color-mix(in srgb,#0b2440 92%,var(--accent) 8%),color-mix(in srgb,var(--surface-strong) 96%,#061323 4%)); color:var(--text); scroll-snap-align:start; box-shadow:0 1rem 2.8rem rgb(0 0 0 / 24%),inset 0 1px 0 rgb(255 255 255 / 5%); transition:border-color .22s ease,transform .22s ease,box-shadow .22s ease; }
  .v481-ticket-cover { position:relative; display:block; min-height:100%; overflow:hidden; }
  .v481-ticket-cover > picture,.v481-ticket-cover > .v481-art-placeholder,.v481-ticket-cover > picture > img { display:block; width:100%; height:100%; }
  .v481-ticket-cover > picture > img { object-fit:cover; }
  .v481-ticket-cover::after { position:absolute; inset:0; background:linear-gradient(90deg,transparent 64%,rgb(4 14 28 / 62%)); content:''; pointer-events:none; }
  .v481-ticket-ribbon { position:absolute; z-index:2; top:1.2rem; left:-2.45rem; width:9rem; padding:.42rem 0; transform:rotate(-42deg); background:linear-gradient(135deg,#ffb2ca,#ff4f87 52%,#ed315f); color:#fff; font-size:.77rem; font-weight:900; letter-spacing:.045em; text-align:center; box-shadow:0 6px 18px rgb(173 20 71 / 38%); }
  .v481-ticket-perforation { position:relative; display:block; background:linear-gradient(180deg,transparent 6%,rgb(62 185 255 / 72%) 50%,transparent 94%); }
  .v481-ticket-perforation::after { position:absolute; top:8%; bottom:8%; left:50%; width:1px; transform:translateX(-50%); background:rgb(136 216 255 / 68%); box-shadow:0 0 .7rem rgb(56 172 255 / 75%); content:''; }
  .v481-ticket-copy { position:relative; display:grid; min-width:0; align-content:center; gap:.68rem; padding:1.2rem 1.25rem 1.2rem 1rem; }
  .v481-ticket-copy > strong { display:-webkit-box; z-index:1; overflow:hidden; max-width:calc(100% - 2rem); font-size:clamp(1.1rem,2.05vw,1.72rem); line-height:1.17; letter-spacing:-.035em; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
  .v481-ticket-orbit { position:absolute; top:1rem; right:1rem; width:4.3rem; aspect-ratio:1; border:1px solid rgb(99 191 255 / 28%); border-radius:50%; box-shadow:inset 0 0 0 .62rem rgb(25 84 137 / 8%),0 0 1.8rem rgb(30 157 255 / 14%); }
  .v481-ticket-orbit::after { position:absolute; top:50%; left:50%; width:2.8rem; height:1.35rem; transform:translate(-50%,-50%) rotate(-28deg); border-top:1px solid rgb(99 191 255 / 30%); border-radius:50%; content:''; }
  .v481-ticket-divider { display:flex; align-items:center; gap:.45rem; width:100%; height:1px; background:linear-gradient(90deg,rgb(72 181 255 / 78%),rgb(72 181 255 / 13%),transparent); }
  .v481-ticket-divider i { display:block; width:.35rem; height:.35rem; flex:0 0 auto; border-radius:50%; background:#60c4ff; box-shadow:0 0 .55rem #60c4ff; }
  .v481-ticket-chapters { display:inline-flex; width:max-content; max-width:100%; min-height:1.85rem; align-items:center; gap:.32rem; padding:.25rem .55rem; border:1px solid rgb(72 181 255 / 42%); border-radius:999px; background:rgb(3 16 31 / 58%); color:#b9e6ff; font-size:.72rem; font-weight:760; }
  .v481-ticket-prices { display:flex; align-items:baseline; flex-wrap:wrap; gap:.58rem; }
  .v481-ticket-prices s { color:color-mix(in srgb,var(--muted) 90%,#d6e9fa); font-size:.85rem; }
  .v481-ticket-prices b { color:#4eb4ff; font-size:clamp(1.2rem,2.4vw,1.7rem); line-height:1; }
  .v481-ticket-countdown { display:flex; align-items:center; gap:.55rem; color:#f4cf70; }
  .v481-ticket-time-grid { display:grid; min-width:0; flex:1; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.38rem; }
  .v481-ticket-time-grid b { display:grid; min-height:2.55rem; place-content:center; gap:.12rem; border:1px solid rgb(245 203 103 / 38%); border-radius:.65rem; background:rgb(28 31 31 / 72%); color:#f7da84; font-size:.88rem; text-align:center; }
  .v481-ticket-time-grid b i { color:rgb(255 239 187 / 68%); font-size:.48rem; font-style:normal; font-weight:800; letter-spacing:.045em; text-transform:uppercase; }
  .v481-ticket-time-grid b.is-seconds { border-color:rgb(77 178 255 / 54%); background:rgb(17 60 99 / 72%); color:#8bd3ff; }
  .v481-ticket:is(:hover,:focus-visible) { border-color:color-mix(in srgb,#55bdff 82%,var(--line)); box-shadow:0 1.25rem 3rem rgb(0 0 0 / 32%),0 0 1.35rem rgb(41 160 255 / 16%); transform:translateY(-3px); }
  .v481-directory { display:grid; gap:1.25rem; padding-block:clamp(1.2rem,3vw,2.4rem); }
  .v481-directory-header { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:1rem; padding-bottom:1.1rem; border-bottom:1px solid var(--line); }
  .v481-directory-header > span { display:grid; width:3rem; height:3rem; place-items:center; border:1px solid color-mix(in srgb,var(--accent) 36%,var(--line)); border-radius:var(--site-card-radius,var(--radius)); background:color-mix(in srgb,var(--accent) 9%,var(--surface)); color:var(--accent); }
  .v481-directory-header small { color:var(--accent); font-size:.67rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
  .v481-directory-header h1 { margin:.15rem 0; font-size:clamp(1.8rem,4vw,3rem); letter-spacing:-.05em; }
  .v481-directory-header p { margin:0; color:var(--muted); }
  .v481-directory-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(12.5rem,1fr)); gap:.85rem; }
  .v481-directory-grid .v481-pin-card { min-height:19rem; aspect-ratio:3 / 4; }
  .v481-discount-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.9rem; }
  .v481-discount-grid .v481-ticket { min-height:13rem; }
  .v481-sort-control { display:grid; gap:.35rem; color:var(--muted); font-size:.68rem; font-weight:700; }
  .v481-sort-control select { min-height:2.65rem; padding:0 2.2rem 0 .8rem; border:1px solid var(--line); border-radius:var(--site-button-radius,var(--radius-small)); background:var(--surface); color:var(--text); font:inherit; font-size:.78rem; }
  .v481-empty-state { display:grid; min-height:16rem; place-content:center; justify-items:center; gap:.4rem; border:1px dashed var(--line); border-radius:var(--site-card-radius,var(--radius)); color:var(--muted); text-align:center; }
  .v481-empty-state h2,.v481-empty-state p { margin:0; }
  @keyframes v481-pin-fade { from { opacity:.15; transform:translateY(.3rem); } to { opacity:1; transform:none; } }
  @property --v487-pin-angle { syntax:'<angle>'; initial-value:0deg; inherits:false; }
  @keyframes v487-pin-orbit { to { --v487-pin-angle:360deg; } }
  @keyframes v481-skeleton { 0% { background-position:100% 0; } 100% { background-position:0 0; } }
  .v481-spotlight-card { display:block; width:min(100%,820px); margin-inline:auto; overflow:hidden; border:1px solid color-mix(in srgb,var(--accent) 34%,var(--line)); border-radius:var(--site-card-radius,var(--radius)); background:linear-gradient(145deg,color-mix(in srgb,var(--surface-2) 88%,#071426),var(--surface)); box-shadow:0 1.5rem 3rem rgb(0 0 0 / 28%); }
  .v481-spotlight-cover { position:relative; display:block; aspect-ratio:1.78 / 1; overflow:hidden; }
  .v481-spotlight-cover picture,.v481-spotlight-cover img { display:block; width:100%; height:100%; }
  .v481-spotlight-cover img { object-fit:cover; }
  .v481-spotlight-cover::after { position:absolute; inset:35% 0 0; background:linear-gradient(180deg,transparent,rgb(3 8 18 / 86%)); content:''; }
  .v481-spotlight-cover .v481-ticket-ribbon { z-index:1; }
  .v481-spotlight-cover > strong { position:absolute; z-index:1; right:1.1rem; bottom:1rem; left:1.1rem; color:#fff; font-size:clamp(1.35rem,3.2vw,2.45rem); font-weight:900; line-height:1.04; letter-spacing:-.035em; text-transform:uppercase; }
  .v481-spotlight-body { display:grid; gap:1rem; padding:clamp(1.1rem,3vw,2rem); }
  .v481-spotlight-body > .v481-ticket-countdown { justify-self:start; }
  .v481-spotlight-body h3 { margin:0; color:var(--text); font-size:clamp(1.5rem,3.4vw,2.5rem); line-height:1.05; letter-spacing:-.04em; text-transform:uppercase; }
  .v481-spotlight-body p { max-width:58ch; margin:0; color:var(--muted); font-size:clamp(.95rem,1.6vw,1.2rem); line-height:1.55; }
  .v481-spotlight-price-row { display:flex; align-items:center; flex-wrap:wrap; gap:.9rem 1.1rem; }
  .v481-save-pill { display:inline-flex; align-items:center; min-height:2.2rem; padding-inline:.9rem; border:1px solid color-mix(in srgb,#f4cf70 65%,var(--line)); border-radius:999px; color:#f4cf70; font-size:.78rem; font-weight:850; letter-spacing:.08em; }
  .v481-spotlight-price-row .v481-ticket-prices { display:flex; align-items:baseline; gap:.55rem; }
  .v481-spotlight-price-row .v481-ticket-prices s { color:var(--muted); }
  .v481-spotlight-price-row .v481-ticket-prices b { color:var(--text); font-size:clamp(1.7rem,4vw,2.7rem); }
  .v481-spotlight-price-row .v481-ticket-prices > span { color:var(--muted); }
  .v481-spotlight-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.8rem; }
  .v481-spotlight-actions a { display:grid; min-height:3.25rem; place-items:center; border-radius:999px; font-weight:850; text-decoration:none; }
  .v481-spotlight-primary { background:var(--accent); color:var(--accent-contrast,#06101f); box-shadow:0 .65rem 1.5rem color-mix(in srgb,var(--accent) 28%,transparent); }
  .v481-spotlight-secondary { border:1px solid var(--line); color:var(--text); }
  .v481-spotlight-all { width:max-content; color:var(--muted); font-weight:750; text-decoration:none; }
  .v481-spotlight-all:is(:hover,:focus-visible) { color:var(--accent); }
  .v481-grid-discount-card { display:grid; grid-template-rows:auto 1fr; overflow:hidden; border:1px solid color-mix(in srgb,var(--accent) 28%,var(--line)); border-radius:var(--site-card-radius,var(--radius)); background:var(--surface); color:var(--text); text-decoration:none; box-shadow:0 1rem 2rem rgb(0 0 0 / 20%); transition:transform .2s ease,border-color .2s ease; }
  .v481-grid-discount-card:is(:hover,:focus-visible) { transform:translateY(-3px); border-color:var(--accent); }
  .v481-grid-discount-cover { position:relative; display:block; aspect-ratio:3 / 4; overflow:hidden; }
  .v481-grid-discount-cover picture,.v481-grid-discount-cover img { display:block; width:100%; height:100%; }
  .v481-grid-discount-cover img { object-fit:cover; }
  .v481-grid-discount-cover::after { position:absolute; inset:45% 0 0; background:linear-gradient(180deg,transparent,rgb(3 8 18 / 82%)); content:''; }
  .v481-grid-discount-copy { display:grid; align-content:start; gap:.7rem; padding:1rem; }
  .v481-grid-discount-copy small { overflow:hidden; color:var(--muted); font-size:.72rem; font-weight:800; letter-spacing:.12em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
  .v481-grid-discount-copy > strong { display:-webkit-box; overflow:hidden; color:var(--text); font-size:clamp(1rem,1.7vw,1.4rem); font-weight:900; line-height:1.08; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
  .v481-grid-discount-copy .v481-ticket-countdown { justify-self:start; }
  .v481-grid-discount-price { display:flex; align-items:baseline; flex-wrap:wrap; gap:.45rem; }
  .v481-grid-discount-price s { color:var(--muted); font-size:.85rem; }
  .v481-grid-discount-price b { color:var(--text); font-size:1.55rem; }
  .v481-grid-discount-price em { color:var(--muted); font-size:.82rem; font-style:normal; }
  .v481-discount-grid.is-style_3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .v481-discount-grid.is-style_2 { display:block; }
  .v481-discount-rail.is-style_2 { display:block; }
  .v481-discount-rail.is-style_3 { grid-auto-columns:minmax(0,48%); }
  @media (prefers-reduced-motion:reduce) { .v481-feature-slot,.v481-pinned-stage.is-loading .v481-pinned-slide,.v481-pinned-slide > .v481-pin-card::after,.v481-pinned-arrow::before,.v481-pinned-bento.is-loading > span,.v481-directory-grid.is-loading > span,.v481-discount-rail.is-loading > span { animation:none; } .v481-pinned-track { scroll-behavior:auto; } .v481-pin-card,.v481-pin-card > img,.v481-grid-discount-card { transition:none; } }
  @media (max-width:850px) { .v481-discount-grid.is-style_3 { grid-template-columns:repeat(2,minmax(0,1fr)); } .v481-pinned-bento { min-height:26rem; grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:14rem repeat(2,10rem); } .v481-feature-slot,.v481-pinned-bento.is-loading > span:first-child { grid-column:1 / -1; grid-row:span 1; } .v481-discount-grid:not(.is-style_3) { grid-template-columns:1fr; } }
  @media (max-width:600px) { .v481-spotlight-cover { aspect-ratio:1.42 / 1; } .v481-spotlight-actions { grid-template-columns:1fr; } .v481-grid-discount-copy { padding:.8rem; } .v481-grid-discount-price b { font-size:1.25rem; } .v481-ticket { grid-template-columns:1fr; min-height:0; } .v481-ticket-cover { min-height:15rem; aspect-ratio:3 / 4; } .v481-ticket-cover::after { background:linear-gradient(180deg,transparent 55%,rgb(4 14 28 / 44%)); } .v481-ticket-ribbon { top:1.1rem; } .v481-ticket-perforation { display:none; } .v481-ticket-copy { padding:1rem; } .v481-ticket-copy > strong { max-width:calc(100% - 3rem); } .v481-ticket-time-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .v481-ticket-time-grid b { min-height:2.75rem; } .v481-feature-heading { align-items:flex-start; } .v481-heading-actions { flex-wrap:wrap; justify-content:flex-end; } .v481-rail-controls button { width:2.2rem; height:2.2rem; } .v481-pinned-track { margin-inline:2.6rem; } .v481-pinned-slide > .v481-pin-card,.v481-pinned-stage.is-loading .v481-pinned-slide { aspect-ratio:16 / 9; } .v481-pinned-arrow { width:2.4rem; height:2.4rem; top:calc((100% - 2.8rem) / 2); } .v481-pinned-arrow.is-previous { left:.35rem; } .v481-pinned-arrow.is-next { right:.35rem; } .v481-featured-badge { top:.65rem; left:.65rem; } .v481-pinned-bento { min-height:0; grid-template-rows:14rem repeat(2,8.5rem); gap:.55rem; } .v481-pin-copy { padding:.9rem; } .v481-pin-copy small { font-size:.58rem; } .v481-pin-copy strong { font-size:1.15rem; } .v481-feature-slot .v481-pin-copy strong { font-size:1.15rem; } .v481-discount-rail { grid-auto-columns:min(88vw,22rem); } .v481-directory-header { grid-template-columns:auto minmax(0,1fr); align-items:start; } .v481-directory-header > .v481-sort-control { grid-column:1 / -1; width:100%; } .v481-sort-control select { width:100%; } .v481-directory-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:.6rem; } .v481-directory-grid .v481-pin-card { min-height:14rem; } }
`;

function HomeFeatureStyles() {
  return <style>{HOME_FEATURE_CSS}</style>;
}
