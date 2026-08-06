"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowRight,
  Books,
  CaretLeft,
  CaretRight,
  PushPin,
  Tag,
  Timer,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  chapterSlug: string | null;
  chapterNumber: string | null;
  chapterTitle: string | null;
  targetLabel: string;
  coverUrl: string | null;
  href: string;
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
  title,
  eager = false,
}: {
  src: string | null;
  title: string;
  eager?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = Boolean(src && src === failedSource);
  return src && !failed ? (
    <img
      src={src}
      alt={`Cover art for ${title}`}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailedSource(src)}
    />
  ) : (
    <span className="v481-art-placeholder" aria-label={`${title} cover unavailable`}>
      <Books size={30} />
    </span>
  );
}

function FeatureHeading({
  icon,
  title,
  allHref,
  controls,
}: {
  icon: ReactNode;
  title: string;
  allHref: string;
  controls?: ReactNode;
}) {
  return (
    <header className="v481-feature-heading">
      <div>
        <span aria-hidden="true">{icon}</span>
        <h2>{title}</h2>
      </div>
      <div className="v481-heading-actions">
        {controls}
        <a className="button button-secondary latest-all-action" href={allHref}>
          All <ArrowRight size={15} />
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
  const imageUrl = featured
    ? record.bannerUrl || record.coverUrl
    : record.coverUrl || record.bannerUrl;
  return (
    <a
      className={`v481-pin-card ${featured ? "is-featured" : "is-small"}`}
      href={record.href}
      aria-label={`Open ${record.title}`}
    >
      <CoverArtwork src={imageUrl} title={record.title} eager={featured} />
      <span className="v481-pin-shade" aria-hidden="true" />
      <span className="v481-pin-copy">
        <small>
          {featured ? "Featured pin" : record.type} · {record.chapterCount}{" "}
          {record.chapterCount === 1 ? "chapter" : "chapters"}
        </small>
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
    <div className="v481-pinned-bento is-loading" aria-label="Loading Pinned Series">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index === 0 ? "is-featured" : "is-small"} />
      ))}
    </div>
  );
}

export function PinnedSeriesSection({
  initialRecords,
  allHref = "/pinned-series",
}: PinnedSeriesSectionProps = {}) {
  const { records, loading, error } = usePinnedSeries(initialRecords);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const featuredRecords = useMemo(() => {
    const marked = records.filter((record) => record.featured).slice(0, 3);
    return marked.length ? marked : records.slice(0, 1);
  }, [records]);
  const activeFeatured = featuredRecords.length
    ? featuredRecords[featuredIndex % featuredRecords.length]
    : null;
  const surroundingRecords = useMemo(() => {
    if (!activeFeatured) return [];
    return records
      .filter((record) => record.id !== activeFeatured.id)
      .slice(0, 4);
  }, [activeFeatured, records]);

  useEffect(() => {
    if (paused || featuredRecords.length < 2) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setFeaturedIndex((current) => (current + 1) % featuredRecords.length);
      }
    }, 6_000);
    return () => window.clearInterval(interval);
  }, [featuredRecords.length, paused]);

  if (!loading && (error || !records.length)) return null;
  return (
    <section className="content-section page-wrap v481-pinned-section">
      <HomeFeatureStyles />
      <FeatureHeading
        icon={<PushPin size={21} weight="fill" />}
        title="Pinned Series"
        allHref={allHref}
      />
      {loading ? (
        <PinnedLoading />
      ) : activeFeatured ? (
        <div
          className="v481-pinned-bento"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
          }}
        >
          <span className="v481-feature-slot" key={activeFeatured.id}>
            <PinnedSeriesCard record={activeFeatured} featured />
            {featuredRecords.length > 1 ? (
              <span className="v481-feature-dots" aria-label="Featured pin position">
                {featuredRecords.map((record, index) => (
                  <button
                    type="button"
                    key={record.id}
                    aria-label={`Show ${record.title}`}
                    aria-current={index === featuredIndex % featuredRecords.length}
                    onClick={() => setFeaturedIndex(index)}
                  />
                ))}
              </span>
            ) : null}
          </span>
          {surroundingRecords.map((record) => (
            <PinnedSeriesCard key={record.id} record={record} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function PinnedSeriesDirectory({
  initialRecords,
}: PinnedSeriesDirectoryProps = {}) {
  const { records, loading, error } = usePinnedSeries(initialRecords);
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
      ) : records.length ? (
        <div className="v481-directory-grid">
          {records.map((record) => (
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

function expiryLabel(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Limited time";
  const remainingDays = Math.max(
    0,
    Math.ceil((timestamp - Date.now()) / 86_400_000),
  );
  if (remainingDays === 0) return "Ends today";
  if (remainingDays === 1) return "1 day left";
  if (remainingDays <= 30) return `${remainingDays} days left`;
  return `Ends ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp))}`;
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
  return (
    <a
      className={`v481-ticket ${directory ? "is-directory" : ""}`}
      href={record.href}
      aria-label={`${record.percentage}% discount on ${record.targetLabel}`}
    >
      <span className="v481-ticket-cover">
        <CoverArtwork src={record.coverUrl} title={record.seriesTitle} />
        <span className="v481-ticket-ribbon">−{record.percentage}%</span>
      </span>
      <span className="v481-ticket-perforation" aria-hidden="true" />
      <span className="v481-ticket-copy">
        <small>{record.targetType === "CHAPTER" ? record.seriesTitle : "Series-wide chapter offer"}</small>
        <strong>{record.targetLabel}</strong>
        <span className="v481-ticket-prices">
          <s>{coinLabel(record.originalPrice, settings)}</s>
          <b>{coinLabel(record.reducedPrice, settings)}</b>
        </span>
        <em><Timer size={14} /> {expiryLabel(record.endsAt)}</em>
      </span>
    </a>
  );
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

  if (unavailable || (!loading && (error || !records.length))) return null;
  return (
    <section className="content-section page-wrap v481-discounts-section">
      <HomeFeatureStyles />
      <FeatureHeading
        icon={<Tag size={21} weight="fill" />}
        title="Discounts"
        allHref={allHref}
        controls={
          records.length > 2 ? (
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
        <div ref={railRef} className="v481-discount-rail">
          {records.map((record) => (
            <DiscountTicket key={record.id} record={record} settings={settings} />
          ))}
        </div>
      )}
    </section>
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
      ) : records.length ? (
        <div className="v481-discount-grid">
          {records.map((record) => (
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
  .v481-pinned-bento { display:grid; min-height:31rem; grid-template-columns:repeat(4,minmax(0,1fr)); grid-template-rows:repeat(2,minmax(0,1fr)); gap:.8rem; }
  .v481-feature-slot { position:relative; display:block; min-width:0; grid-column:span 2; grid-row:span 2; animation:v481-pin-fade .48s ease both; }
  .v481-pin-card { position:relative; display:block; min-width:0; height:100%; overflow:hidden; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:var(--surface-strong); color:#fff; isolation:isolate; }
  .v481-pin-card > img,.v481-pin-card > .v481-art-placeholder { position:absolute; z-index:-2; inset:0; width:100%; height:100%; object-fit:cover; transition:transform .45s ease; }
  .v481-pin-card:hover > img { transform:scale(1.035); }
  .v481-pin-shade { position:absolute; z-index:-1; inset:0; background:linear-gradient(180deg,transparent 24%,rgb(2 9 20 / 22%) 48%,rgb(2 9 20 / 94%) 100%); }
  .v481-pin-copy { position:absolute; right:0; bottom:0; left:0; display:grid; gap:.28rem; padding:clamp(.85rem,2vw,1.45rem); }
  .v481-pin-copy small { color:rgb(255 255 255 / 72%); font-size:.68rem; font-weight:750; letter-spacing:.055em; text-transform:uppercase; }
  .v481-pin-copy strong { overflow:hidden; font-size:clamp(1rem,2vw,1.5rem); letter-spacing:-.025em; text-overflow:ellipsis; white-space:nowrap; }
  .v481-pin-copy em { display:-webkit-box; overflow:hidden; max-width:42rem; color:rgb(255 255 255 / 76%); font-size:.82rem; font-style:normal; line-height:1.55; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
  .v481-pinned-bento > .v481-pin-card.is-small { min-height:0; }
  .v481-feature-dots { position:absolute; z-index:2; top:1rem; right:1rem; display:flex; gap:.35rem; padding:.4rem; border-radius:999px; background:rgb(2 9 20 / 52%); backdrop-filter:blur(8px); }
  .v481-feature-dots button { width:.5rem; height:.5rem; padding:0; border:0; border-radius:999px; background:rgb(255 255 255 / 42%); cursor:pointer; }
  .v481-feature-dots button[aria-current='true'] { width:1.25rem; background:var(--accent); }
  .v481-art-placeholder { display:grid; place-items:center; background:linear-gradient(135deg,var(--surface-strong),color-mix(in srgb,var(--accent) 16%,var(--surface-2))); color:var(--muted); }
  .v481-pinned-bento.is-loading > span,.v481-directory-grid.is-loading > span,.v481-discount-rail.is-loading > span { display:block; min-height:12rem; border:1px solid var(--line); border-radius:var(--site-card-radius,var(--radius)); background:linear-gradient(100deg,var(--surface) 25%,var(--surface-2) 42%,var(--surface) 62%); background-size:300% 100%; animation:v481-skeleton 1.4s ease infinite; }
  .v481-pinned-bento.is-loading > span:first-child { grid-column:span 2; grid-row:span 2; }
  .v481-discounts-section { padding-block:clamp(1rem,2.3vw,1.6rem); border:1px solid color-mix(in srgb,var(--warning) 24%,var(--line)); border-radius:calc(var(--site-card-radius,var(--radius)) + .25rem); background:color-mix(in srgb,var(--warning) 6%,var(--surface)); }
  .v481-discount-rail { display:grid; grid-auto-columns:minmax(20rem,25rem); grid-auto-flow:column; gap:.8rem; overflow-x:auto; overscroll-behavior-inline:contain; padding:.1rem .1rem .55rem; scroll-snap-type:inline mandatory; scrollbar-width:thin; }
  .v481-ticket { position:relative; display:grid; min-height:12rem; grid-template-columns:8rem .8rem minmax(0,1fr); overflow:hidden; border:1px solid color-mix(in srgb,var(--warning) 30%,var(--line)); border-radius:var(--site-card-radius,var(--radius)); background:var(--surface); color:var(--text); scroll-snap-align:start; }
  .v481-ticket-cover { position:relative; display:block; min-height:12rem; overflow:hidden; }
  .v481-ticket-cover > img,.v481-ticket-cover > .v481-art-placeholder { width:100%; height:100%; object-fit:cover; }
  .v481-ticket-ribbon { position:absolute; top:.75rem; left:-2.35rem; width:8rem; padding:.34rem 0; transform:rotate(-42deg); background:var(--danger); color:#fff; font-size:.72rem; font-weight:900; letter-spacing:.04em; text-align:center; box-shadow:0 5px 14px rgb(0 0 0 / 28%); }
  .v481-ticket-perforation { position:relative; display:block; border-left:1px dashed color-mix(in srgb,var(--warning) 62%,var(--line)); }
  .v481-ticket-perforation::before,.v481-ticket-perforation::after { position:absolute; left:-.52rem; width:1rem; height:1rem; border-radius:50%; background:color-mix(in srgb,var(--warning) 6%,var(--surface)); content:''; }
  .v481-ticket-perforation::before { top:-.5rem; }
  .v481-ticket-perforation::after { bottom:-.5rem; }
  .v481-ticket-copy { display:grid; min-width:0; align-content:center; gap:.45rem; padding:1rem 1rem 1rem .45rem; }
  .v481-ticket-copy > small { overflow:hidden; color:var(--muted); font-size:.66rem; font-weight:750; letter-spacing:.055em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
  .v481-ticket-copy > strong { display:-webkit-box; overflow:hidden; font-size:1rem; line-height:1.3; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
  .v481-ticket-prices { display:flex; align-items:baseline; flex-wrap:wrap; gap:.45rem; }
  .v481-ticket-prices s { color:var(--muted); font-size:.7rem; }
  .v481-ticket-prices b { color:var(--accent); font-size:1rem; }
  .v481-ticket-copy em { display:flex; align-items:center; gap:.3rem; color:var(--warning); font-size:.7rem; font-style:normal; font-weight:700; }
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
  @keyframes v481-skeleton { 0% { background-position:100% 0; } 100% { background-position:0 0; } }
  @media (prefers-reduced-motion:reduce) { .v481-feature-slot,.v481-pinned-bento.is-loading > span,.v481-directory-grid.is-loading > span,.v481-discount-rail.is-loading > span { animation:none; } .v481-pin-card > img { transition:none; } }
  @media (max-width:850px) { .v481-pinned-bento { min-height:26rem; grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:14rem repeat(2,10rem); } .v481-feature-slot,.v481-pinned-bento.is-loading > span:first-child { grid-column:1 / -1; grid-row:span 1; } .v481-discount-grid { grid-template-columns:1fr; } }
  @media (max-width:600px) { .v481-feature-heading { align-items:flex-start; } .v481-heading-actions { flex-wrap:wrap; justify-content:flex-end; } .v481-rail-controls { display:none; } .v481-pinned-bento { min-height:0; grid-template-rows:14rem repeat(2,8.5rem); gap:.55rem; } .v481-pin-copy { padding:.72rem; } .v481-pin-copy small { font-size:.58rem; } .v481-pin-copy strong { font-size:.9rem; } .v481-feature-slot .v481-pin-copy strong { font-size:1.15rem; } .v481-discount-rail { grid-auto-columns:min(88vw,22rem); } .v481-ticket { grid-template-columns:6.5rem .65rem minmax(0,1fr); } .v481-ticket-cover { min-height:11rem; } .v481-directory-header { grid-template-columns:auto minmax(0,1fr); align-items:start; } .v481-directory-header > .v481-sort-control { grid-column:1 / -1; width:100%; } .v481-sort-control select { width:100%; } .v481-directory-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:.6rem; } .v481-directory-grid .v481-pin-card { min-height:14rem; } }
`;

function HomeFeatureStyles() {
  return <style>{HOME_FEATURE_CSS}</style>;
}
