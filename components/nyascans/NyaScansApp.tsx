"use client";
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ArrowsOut,
  Bell,
  Books,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartLineUp,
  ChatCircle,
  Check,
  CheckCircle,
  Clock,
  CloudArrowUp,
  Coins,
  Compass,
  Copy,
  CreditCard,
  CrownSimple,
  DotsThree,
  DownloadSimple,
  Eye,
  FileText,
  Fire,
  GearSix,
  Gift,
  Heart,
  House,
  Image as ImageIcon,
  Key,
  List,
  Lifebuoy,
  LockSimple,
  MagnifyingGlass,
  Megaphone,
  Moon,
  Play,
  Plus,
  Pulse,
  ShieldCheck,
  SidebarSimple,
  SignIn,
  SignOut,
  SlidersHorizontal,
  SpinnerGap,
  SquaresFour,
  Sparkle,
  Star,
  Storefront,
  Sun,
  Tag,
  Trash,
  Trophy,
  Translate,
  UploadSimple,
  UserCircle,
  UsersThree,
  Wallet,
  WarningCircle,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { LanguageFlag } from "@/components/nyascans/LanguageFlag";
import { DiscussionSettingsPanel } from "@/components/nyascans/DiscussionSettingsPanel";
import { EnhancedDiscussionSection } from "@/components/nyascans/EnhancedDiscussionSection";
import { GiftStorePanel } from "@/components/nyascans/GiftStorePanel";
import { FormattedAnnouncementText } from "@/components/nyascans/FormattedAnnouncementText";
import { KeyboardShortcutsDialog } from "@/components/nyascans/KeyboardShortcutsDialog";
import { SupportTicketPanel } from "@/components/nyascans/SupportTicketPanel";
import { useSystemNotifications } from "@/components/nyascans/SystemNotifications";
import { LibraryWorkspace } from "@/components/nyascans/LibraryWorkspace";
import { NotificationsView } from "@/components/nyascans/NotificationsView";
import { ProfileSettingsWorkspace } from "@/components/nyascans/ProfileSettingsWorkspace";
import {
  NewSeriesSection,
  PublishingTeamsCarousel,
  PublishingTeamsDirectory,
} from "@/components/nyascans/PublicDiscoverySections";
import { PublicProfileView } from "@/components/nyascans/PublicProfileView";
import { PublicTeamView } from "@/components/nyascans/PublicTeamView";
import { RouletteView } from "@/components/nyascans/RouletteView";
import { SeriesGallerySections } from "@/components/nyascans/SeriesGallerySections";
import { SeriesReportDialog } from "@/components/nyascans/SeriesReportDialog";
import { UserLeaderboardView } from "@/components/nyascans/UserLeaderboardView";
import { AppearanceWorkspace } from "@/components/nyascans/admin/AppearanceWorkspace";
import { ConfirmActionDialog } from "@/components/nyascans/admin/AdminPageScaffold";
import { ReactionLibraryPanel } from "@/components/nyascans/admin/ReactionLibraryPanel";
import { RewardSettingsPanel } from "@/components/nyascans/admin/RewardSettingsPanel";
import {
  defaultReaderSettings,
  ReaderSettingsPanel,
  type ReaderSettings,
} from "@/components/nyascans/ReaderSettingsPanel";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";
import { useSiteConfiguration } from "@/components/nyascans/useSiteConfiguration";
import {
  coinLabel,
  configuredCoinCopy,
  formatMoney,
  type CommercialSettings,
} from "@/lib/commercial-settings";
import {
  demoSeries,
  type SeriesCard,
} from "@/lib/catalog";
import {
  compareChapterNumbers,
  normalizeChapterNumber,
} from "@/lib/chapter-number";
import { languageName } from "@/lib/language-flags";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENTS_BY_SLUG,
} from "@/lib/legal-documents";
import { readingProgressTone } from "@/lib/reading-progress";
import { SITE_NAVIGATION_CHORDS } from "@/lib/site-shortcuts";

const OperationsControlPanel = lazy(() =>
  import("@/components/nyascans/OperationsControlPanel").then((module) => ({
    default: module.OperationsControlPanel,
  })),
);

export type AppView =
  | "home"
  | "browse"
  | "library"
  | "store"
  | "account"
  | "profile"
  | "login"
  | "signup"
  | "title"
  | "reader"
  | "wallet"
  | "notifications"
  | "latest"
  | "rankings"
  | "roulette"
  | "orders"
  | "team"
  | "teams"
  | "status"
  | "support"
  | "legal"
  | "generic"
  | "error"
  | "dashboard"
  | "admin"
  | "access";

type Actor = {
  displayName: string;
  email: string;
  role: string;
  roles?: string[];
  avatarUrl?: string | null;
  canUseUploadCenter?: boolean;
  canUpload?: boolean;
  canRequestSeries?: boolean;
  canManageTeam?: boolean;
};

type HeaderNotification = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  actionUrl: string | null;
  createdAt: string;
};

type AppProps = {
  view: AppView;
  actor: Actor | null;
  authenticatedIdentity?: Pick<Actor, "displayName" | "email"> | null;
  accountBlocked?: boolean;
  authReturnTo?: string;
  resourceSlug?: string;
  chapterSlug?: string;
  uploadMode?: "SINGLE" | "BATCH";
  path?: string;
  signInPath?: string;
  adminGate?: boolean;
  operationPath?: string[];
};

function authEntryPath(
  intent: "login" | "signup",
  returnTo: string,
): string {
  return `/${intent}?returnTo=${encodeURIComponent(returnTo)}`;
}

type AnalyticsEventType =
  | "HOME_VIEW"
  | "LATEST_VIEW"
  | "BROWSE_VIEW"
  | "SERIES_VIEW"
  | "CHAPTER_START"
  | "CHAPTER_COMPLETE";

let memoryAnalyticsSession = "";
let memoryAnalyticsVisitor = "";

function clientRandomId() {
  const browserCrypto =
    typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }
  if (typeof browserCrypto?.getRandomValues === "function") {
    const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function analyticsSessionId() {
  if (memoryAnalyticsSession) return memoryAnalyticsSession;
  try {
    const stored = window.sessionStorage.getItem("nyascans-analytics-session");
    if (stored) {
      memoryAnalyticsSession = stored;
      return stored;
    }
    memoryAnalyticsSession = clientRandomId();
    window.sessionStorage.setItem(
      "nyascans-analytics-session",
      memoryAnalyticsSession,
    );
    return memoryAnalyticsSession;
  } catch {
    memoryAnalyticsSession = clientRandomId();
    return memoryAnalyticsSession;
  }
}

function analyticsVisitorId() {
  if (memoryAnalyticsVisitor) return memoryAnalyticsVisitor;
  try {
    const stored = window.localStorage.getItem("nyascans-analytics-visitor");
    if (stored) {
      memoryAnalyticsVisitor = stored;
      return stored;
    }
    memoryAnalyticsVisitor = clientRandomId();
    window.localStorage.setItem(
      "nyascans-analytics-visitor",
      memoryAnalyticsVisitor,
    );
    return memoryAnalyticsVisitor;
  } catch {
    memoryAnalyticsVisitor = clientRandomId();
    return memoryAnalyticsVisitor;
  }
}

function recordAnalyticsEvent(
  eventType: AnalyticsEventType,
  scope: { seriesSlug?: string; chapterSlug?: string } = {},
) {
  const payload = {
    eventId: clientRandomId(),
    sessionId: analyticsSessionId(),
    visitorId: analyticsVisitorId(),
    eventType,
    ...scope,
  };
  void fetch("/api/v1/analytics-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Operational analytics never blocks the reader experience.
  });
}

function ResilientCoverImage({
  src,
  alt,
  width,
  height,
  loading = "lazy",
  className,
  decorative = false,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  loading?: "eager" | "lazy";
  className?: string;
  decorative?: boolean;
}) {
  const [failedSource, setFailedSource] = useState("");
  const fallback = "/art/series-cover-placeholder.svg";
  const effectiveSource = failedSource === src ? fallback : src;

  return (
    <img
      className={className}
      src={effectiveSource}
      alt={decorative ? "" : alt}
      aria-hidden={decorative ? "true" : undefined}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      onError={() => {
        if (effectiveSource !== fallback) setFailedSource(src);
      }}
    />
  );
}

function ConfiguredCoinMark({
  settings,
  size = 18,
}: {
  settings: CommercialSettings;
  size?: number;
}) {
  return (
    <span
      className="configured-coin-mark"
      style={{ "--coin-mark-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {settings.economy.coinIconKey ? (
        <img
          src={`/api/v1/coin-icon?v=${settings.economy.coinIconRevision}`}
          alt=""
        />
      ) : (
        <span>{settings.economy.coinIcon}</span>
      )}
    </span>
  );
}

const navItems = [
  { label: "Home", href: "/", icon: House },
  { label: "Latest Updates", href: "/latest", icon: Pulse },
  { label: "Browse", href: "/browse", icon: Compass },
  { label: "Library", href: "/library", icon: Books },
  { label: "Store", href: "/store", icon: Storefront },
];

function elevatedDestination(actor: Actor | null) {
  const roles = actor?.roles?.length ? actor.roles : actor ? [actor.role] : [];
  if (
    actor &&
    roles.some((role) => ["OWNER", "ADMINISTRATOR", "MANAGER"].includes(role))
  ) {
    return {
      href: "/onyx/admin/access",
      label: "Admin",
      title: "Open Admin Panel",
      kind: "admin",
    };
  }
  if (
    actor &&
    (actor.canUseUploadCenter ||
      actor.canUpload ||
      actor.canRequestSeries ||
      actor.canManageTeam)
  ) {
    return {
      href: "/dashboard",
      label: "Workspace",
      title: "Open Team Workspace",
      kind: "workspace",
    };
  }
  return null;
}

function roleLabel(role: string) {
  if (role === "OWNER") return "Owner";
  if (role === "ADMINISTRATOR") return "Administrator";
  if (role === "MANAGER") return "Manager";
  if (role === "MODERATOR") return "Moderator";
  if (role === "TEAM_LEADER") return "Team leader";
  if (role === "UPLOADER") return "Uploader";
  return "Reader";
}

function safeHeaderActionUrl(value: string | null) {
  const candidate = value?.trim() ?? "";
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\")
  ) {
    return "/notifications";
  }
  try {
    const base = "https://nyascans.local";
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base) return "/notifications";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/notifications";
  }
}

function activeNav(view: AppView, label: string) {
  if (label === "Home") return view === "home";
  if (label === "Latest Updates") return view === "latest";
  if (label === "Browse") return view === "browse";
  if (label === "Library") return view === "library";
  if (label === "Store") return view === "store" || view === "wallet";
  return false;
}

type SearchResult = {
  id: string;
  slug: string;
  title: string;
  nativeTitle: string | null;
  alternativeTitle: string | null;
  aliases: string[];
  type: "MANGA" | "MANHWA" | "MANHUA";
  cover: string | null;
  latestChapter: {
    number: string;
    title: string;
    slug: string | null;
  } | null;
};

function highlightMatch(value: string, query: string) {
  const needle = query.trim();
  if (!needle) return value;
  const index = value.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark>{value.slice(index, index + needle.length)}</mark>
      {value.slice(index + needle.length)}
    </>
  );
}

function SearchResultCard({
  item,
  query,
  onChoose,
}: {
  item: SearchResult;
  query: string;
  onChoose: () => void;
}) {
  return (
    <a
      className="search-result search-preview-card"
      href={`/title/${item.slug}`}
      onClick={onChoose}
    >
      {item.cover ? (
        <ResilientCoverImage
          src={item.cover}
          alt={`Cover art for ${item.title}`}
          width={60}
          height={90}
          decorative
        />
      ) : (
        <span className="search-cover-placeholder" aria-hidden="true">
          <Books size={22} />
        </span>
      )}
      <span className="search-preview-copy">
        <SeriesTypeBadge type={item.type} />
        <strong>{highlightMatch(item.title, query)}</strong>
        {item.alternativeTitle ? (
          <small>{highlightMatch(item.alternativeTitle, query)}</small>
        ) : null}
        <em>
          {item.latestChapter
            ? `Latest · Chapter ${normalizeChapterNumber(item.latestChapter.number)}${item.latestChapter.title ? ` · ${item.latestChapter.title}` : ""}`
            : "No published chapters yet"}
        </em>
      </span>
      <ArrowRight size={18} />
    </a>
  );
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [trending, setTrending] = useState<SearchResult[]>([]);
  const [popular, setPopular] = useState<SearchResult[]>([]);
  const [recent, setRecent] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = JSON.parse(
        window.localStorage.getItem("nyascans:recent-searches") ?? "[]",
      );
      return Array.isArray(stored)
        ? stored
            .filter((entry): entry is string => typeof entry === "string")
            .slice(0, 6)
        : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/v1/search?q=${encodeURIComponent(query.trim())}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as {
          data?: SearchResult[];
          trending?: SearchResult[];
          popular?: SearchResult[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Search is unavailable.");
        }
        setResults(payload.data ?? []);
        setTrending(payload.trending ?? []);
        setPopular(payload.popular ?? []);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error ? loadError.message : "Search is unavailable.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 120 : 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  function rememberSearch(item: SearchResult) {
    const term = query.trim() || item.title;
    const next = [term, ...recent.filter((entry) => entry !== term)].slice(0, 6);
    setRecent(next);
    window.localStorage.setItem(
      "nyascans:recent-searches",
      JSON.stringify(next),
    );
  }

  return (
    <div className="search-overlay" role="dialog" aria-modal="true">
      <button
        className="search-backdrop"
        type="button"
        onClick={onClose}
        aria-label="Close search"
      />
      <section className="search-panel">
        <div className="search-panel-input">
          <MagnifyingGlass size={22} />
          <label className="sr-only" htmlFor="global-search">
            Search main titles, alternative titles, and aliases
          </label>
          <input
            autoFocus
            id="global-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and aliases"
          />
          <button type="button" onClick={onClose} aria-label="Close search">
            <X size={20} />
          </button>
        </div>
        <div className="search-panel-body">
          {query.trim() ? (
            <p className="panel-label">
              {loading ? "Searching…" : `${results.length} matches`}
            </p>
          ) : null}
          {error ? (
            <div className="search-inline-error" role="alert">
              <WarningCircle size={18} /> {error}
            </div>
          ) : query.trim() && results.length ? (
            <div className="search-results">
              {results.map((item) => (
                <SearchResultCard
                  item={item}
                  query={query}
                  key={item.id}
                  onChoose={() => rememberSearch(item)}
                />
              ))}
            </div>
          ) : query.trim() && !loading ? (
            <EmptyState
              title="No stories found"
              body="Try a shorter title, an alternative spelling, or a known alias."
              compact
            />
          ) : (
            <div className="search-discovery">
              {recent.length ? (
                <section>
                  <div className="search-discovery-head">
                    <p className="panel-label">Recent searches</p>
                    <button
                      type="button"
                      onClick={() => {
                        setRecent([]);
                        window.localStorage.removeItem(
                          "nyascans:recent-searches",
                        );
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="recent-searches">
                    {recent.map((term) => (
                      <button
                        type="button"
                        key={term}
                        onClick={() => setQuery(term)}
                      >
                        <Clock size={14} /> {term}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              <section>
                <p className="panel-label">Trending series</p>
                <div className="search-results search-results-compact">
                  {trending.map((item) => (
                    <SearchResultCard
                      item={item}
                      query=""
                      key={`trending-${item.id}`}
                      onChoose={() => rememberSearch(item)}
                    />
                  ))}
                </div>
              </section>
              <section>
                <p className="panel-label">Popular titles</p>
                <div className="search-results search-results-compact">
                  {popular.map((item) => (
                    <SearchResultCard
                      item={item}
                      query=""
                      key={`popular-${item.id}`}
                      onChoose={() => rememberSearch(item)}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Logo() {
  const { settings } = useSiteConfiguration();
  const [failedLogoUrls, setFailedLogoUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const logoMedia =
    settings.brand.logo.enabled && settings.brand.logo.key
      ? settings.brand.logo
      : null;
  const compactLogoMedia =
    settings.brand.compactLogo.enabled && settings.brand.compactLogo.key
      ? settings.brand.compactLogo
      : null;
  const configuredLogoUrl = logoMedia
    ? `/api/v1/site-media?slot=logo&v=${logoMedia.revision}`
    : null;
  const configuredCompactLogoUrl = compactLogoMedia
    ? `/api/v1/site-media?slot=compact&v=${compactLogoMedia.revision}`
    : null;
  const logoUrl =
    configuredLogoUrl && !failedLogoUrls.has(configuredLogoUrl)
      ? configuredLogoUrl
      : null;
  const compactLogoUrl =
    configuredCompactLogoUrl &&
    !failedLogoUrls.has(configuredCompactLogoUrl)
      ? configuredCompactLogoUrl
      : null;
  const displayLogoUrl = logoUrl ?? compactLogoUrl;
  const displayLogoMedia = logoUrl ? logoMedia : compactLogoMedia;
  return (
    <a
      className={`brand ${displayLogoUrl ? "has-custom-logo" : ""}`}
      href="/"
      aria-label={`${settings.brand.siteName} home`}
    >
      {displayLogoUrl &&
      displayLogoMedia ? (
        <picture>
          {compactLogoUrl && compactLogoUrl !== displayLogoUrl ? (
            <source
              media="(max-width: 720px)"
              srcSet={compactLogoUrl}
            />
          ) : null}
          <img
            className="brand-logo-image"
            src={displayLogoUrl}
            alt={settings.brand.logoAlt.trim()}
            width={displayLogoMedia.width}
            height={displayLogoMedia.height}
            onError={(event) => {
              const failedUrl =
                event.currentTarget.currentSrc || displayLogoUrl;
              setFailedLogoUrls((current) => {
                const next = new Set(current);
                next.add(failedUrl);
                return next;
              });
            }}
          />
        </picture>
      ) : (
        <span className="brand-mark" aria-hidden="true">
          <span />
        </span>
      )}
      <span className="brand-name">{settings.brand.siteName}</span>
    </a>
  );
}

function SiteHeader({
  view,
  actor,
  theme,
  onTheme,
  onSearch,
  lockAndPayVisible,
}: {
  view: AppView;
  actor: Actor | null;
  theme: "dark" | "light";
  onTheme: () => void;
  onSearch: () => void;
  lockAndPayVisible: boolean;
}) {
  const elevated = elevatedDestination(actor);
  const canUpload = Boolean(actor?.canUseUploadCenter);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationRecords, setNotificationRecords] = useState<
    HeaderNotification[]
  >([]);
  const [notificationsLoading, setNotificationsLoading] = useState(
    Boolean(actor),
  );
  const [notificationsError, setNotificationsError] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOutside(event: PointerEvent) {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!notificationsOpen) return;
    function closeOutside(event: PointerEvent) {
      if (
        notificationRef.current &&
        event.target instanceof Node &&
        !notificationRef.current.contains(event.target)
      ) {
        setNotificationsOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        notificationButtonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    if (!actor) return;
    const profileController = new AbortController();
    let notificationController: AbortController | null = null;
    async function loadNotifications() {
      notificationController?.abort();
      const controller = new AbortController();
      notificationController = controller;
      setNotificationsError("");
      try {
        const response = await fetch(
          "/api/v1/notifications?state=ALL&page=1&pageSize=5",
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as {
          data?: HeaderNotification[];
          summary?: { unreadCount?: number };
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Notifications could not be loaded.",
          );
        }
        setNotificationRecords(payload.data ?? []);
        setUnreadCount(Number(payload.summary?.unreadCount ?? 0));
      } catch (error) {
        if (!controller.signal.aborted) {
          setNotificationsError(
            error instanceof Error
              ? error.message
              : "Notifications could not be loaded.",
          );
        }
      } finally {
        if (notificationController === controller) {
          if (!controller.signal.aborted) setNotificationsLoading(false);
          notificationController = null;
        }
      }
    }
    async function loadProfileAvatar() {
      try {
        const response = await fetch("/api/v1/profiles", {
          cache: "no-store",
          signal: profileController.signal,
        });
        const payload = (await response.json()) as {
          data?: { avatarUrl?: string | null };
        };
        if (response.ok) {
          setProfileAvatarUrl(payload.data?.avatarUrl ?? null);
        }
      } catch {
        // The account initial remains available while profile media recovers.
      }
    }
    void loadNotifications();
    void loadProfileAvatar();
    const refreshNotifications = () => void loadNotifications();
    const refreshProfile = () => void loadProfileAvatar();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadNotifications();
    };
    const notificationPoll = window.setInterval(refreshWhenVisible, 20_000);
    window.addEventListener(
      "nyascans:notifications-changed",
      refreshNotifications,
    );
    window.addEventListener("nyascans:profile-changed", refreshProfile);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      notificationController?.abort();
      profileController.abort();
      window.clearInterval(notificationPoll);
      window.removeEventListener(
        "nyascans:notifications-changed",
        refreshNotifications,
      );
      window.removeEventListener("nyascans:profile-changed", refreshProfile);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [actor]);

  function focusMenuItem(position: "first" | "last") {
    window.requestAnimationFrame(() => {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          '.header-overflow-menu [role="menuitem"]',
        ) ?? [],
      );
      const item = position === "first" ? items[0] : items.at(-1);
      item?.focus();
    });
  }

  function handleMenuKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!menuOpen) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    }
  }

  function markNotificationRead(
    notificationId: string,
    destination: string,
  ) {
    setNotificationsOpen(false);
    setNotificationRecords((current) =>
      current.map((record) =>
        record.id === notificationId
          ? { ...record, readAt: new Date().toISOString() }
          : record,
      ),
    );
    setUnreadCount((current) => Math.max(0, current - 1));
    void fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "READ", id: notificationId }),
        keepalive: true,
      })
      .then((response) => {
        if (!response.ok) return;
        window.dispatchEvent(
          new CustomEvent("nyascans:notifications-changed", {
            detail: { action: "READ", id: notificationId },
          }),
        );
      })
      .catch(() => {
        // The destination remains available if the read mutation cannot finish.
      });
    window.location.assign(destination);
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Logo />
        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems
            .filter((item) => lockAndPayVisible || item.label !== "Store")
            .map((item) => (
            <a
              key={item.label}
              href={item.href}
              aria-current={activeNav(view, item.label) ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="header-search"
            type="button"
            onClick={onSearch}
            aria-label="Open search"
            aria-keyshortcuts="Control+K Meta+K"
          >
            <MagnifyingGlass size={18} />
            <span>Search</span>
            <kbd>Ctrl K</kbd>
          </button>
          {actor ? (
            <>
              <div className="header-notification-wrap" ref={notificationRef}>
                <button
                  className="header-notifications"
                  ref={notificationButtonRef}
                  type="button"
                  aria-label={
                    unreadCount
                      ? `Notifications, ${unreadCount} unread`
                      : "Notifications"
                  }
                  aria-expanded={notificationsOpen}
                  aria-controls="header-notifications-panel"
                  title="Notifications"
                  onClick={() => {
                    setMenuOpen(false);
                    setNotificationsOpen((value) => !value);
                  }}
                >
                  <Bell
                    size={20}
                    weight={
                      notificationsOpen || view === "notifications"
                        ? "fill"
                        : "regular"
                    }
                  />
                  {unreadCount ? (
                    <span aria-hidden="true">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </button>
                {notificationsOpen ? (
                  <div
                    className="header-notification-menu"
                    id="header-notifications-panel"
                    role="region"
                    aria-label="Recent notifications"
                    onBlur={(event) => {
                      if (
                        event.relatedTarget instanceof Node &&
                        event.currentTarget.parentElement?.contains(
                          event.relatedTarget,
                        )
                      ) {
                        return;
                      }
                      setNotificationsOpen(false);
                    }}
                  >
                    <header>
                      <div>
                        <strong>Notifications</strong>
                        <small>
                          {unreadCount
                            ? `${unreadCount} unread`
                            : "You’re all caught up"}
                        </small>
                      </div>
                      <Bell size={18} weight="fill" aria-hidden="true" />
                    </header>
                    <ul className="header-notification-list">
                      {notificationsLoading ? (
                        <li>
                          <span
                            className="header-notification-state"
                            role="status"
                          >
                            <SpinnerGap size={18} className="spin" />
                            Loading notifications…
                          </span>
                        </li>
                      ) : notificationsError ? (
                        <li>
                          <span
                            className="header-notification-state"
                            role="alert"
                          >
                            <WarningCircle size={18} />
                            {notificationsError}
                          </span>
                        </li>
                      ) : notificationRecords.length ? (
                        notificationRecords.map((notification) => (
                          <li key={notification.id}>
                            <a
                              className={
                                notification.readAt
                                  ? "header-notification-item"
                                  : "header-notification-item is-unread"
                              }
                              href={safeHeaderActionUrl(notification.actionUrl)}
                              onClick={(event) => {
                                if (notification.readAt) {
                                  setNotificationsOpen(false);
                                  return;
                                }
                                if (
                                  event.metaKey ||
                                  event.ctrlKey ||
                                  event.shiftKey ||
                                  event.altKey
                                ) {
                                  return;
                                }
                                event.preventDefault();
                                markNotificationRead(
                                  notification.id,
                                  safeHeaderActionUrl(notification.actionUrl),
                                );
                              }}
                            >
                              <span aria-hidden="true">
                                <Bell
                                  size={15}
                                  weight={
                                    notification.readAt ? "regular" : "fill"
                                  }
                                />
                              </span>
                              <span>
                                <strong>
                                  {!notification.readAt ? (
                                    <span className="sr-only">Unread: </span>
                                  ) : null}
                                  {notification.title}
                                </strong>
                                <small>{notification.body}</small>
                                <time dateTime={notification.createdAt}>
                                  {releaseTime(notification.createdAt)} ago
                                </time>
                              </span>
                            </a>
                          </li>
                        ))
                      ) : (
                        <li>
                          <span className="header-notification-state">
                            <Bell size={18} />
                            No notifications yet.
                          </span>
                        </li>
                      )}
                    </ul>
                    <a
                      className="header-notification-all"
                      href="/notifications"
                      onClick={() => setNotificationsOpen(false)}
                    >
                      View all notifications <ArrowRight size={16} />
                    </a>
                  </div>
                ) : null}
              </div>
              <div
                className="header-overflow"
                ref={menuRef}
                onKeyDown={handleMenuKeys}
              >
                <button
                  className="header-profile-trigger"
                  ref={menuButtonRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Open profile and account menu"
                  onClick={() => {
                    setNotificationsOpen(false);
                    setMenuOpen((value) => !value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      if (!menuOpen) setMenuOpen(true);
                      focusMenuItem("first");
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      if (!menuOpen) setMenuOpen(true);
                      focusMenuItem("last");
                    }
                  }}
                >
                  <span className="header-avatar" aria-hidden="true">
                    {profileAvatarUrl ? (
                      <img
                        src={profileAvatarUrl}
                        alt=""
                        onError={() => setProfileAvatarUrl(null)}
                      />
                    ) : (
                      actor.displayName.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="header-profile-copy">
                    <small>Welcome</small>
                    <strong>{actor.displayName.split(" ")[0]}</strong>
                  </span>
                  <CaretDown size={14} />
                </button>
                {menuOpen ? (
                  <div className="header-overflow-menu" role="menu">
                    <div className="header-menu-profile">
                      <span aria-hidden="true">
                        {profileAvatarUrl ? (
                          <img
                            src={profileAvatarUrl}
                            alt=""
                            onError={() => setProfileAvatarUrl(null)}
                          />
                        ) : (
                          actor.displayName.slice(0, 1).toUpperCase()
                        )}
                      </span>
                      <div>
                        <strong>{actor.displayName}</strong>
                        <small>{actor.email}</small>
                        <em>{roleLabel(actor.role)}</em>
                      </div>
                    </div>
                    <a
                      role="menuitem"
                      href="/account"
                      onClick={() => setMenuOpen(false)}
                    >
                      <UserCircle size={18} /> Profile
                    </a>
                    <a
                      role="menuitem"
                      href="/support"
                      onClick={() => setMenuOpen(false)}
                    >
                      <ChatCircle size={18} /> Support
                    </a>
                    <a
                      role="menuitem"
                      href="/rankings"
                      onClick={() => setMenuOpen(false)}
                    >
                      <Trophy size={18} /> Ranking
                    </a>
                    <a
                      role="menuitem"
                      href="/roulette"
                      onClick={() => setMenuOpen(false)}
                    >
                      <Sparkle size={18} /> Roulette
                    </a>
                    {canUpload ? (
                      <a
                        role="menuitem"
                        href="/upload-chapter"
                        onClick={() => setMenuOpen(false)}
                      >
                        <CloudArrowUp size={18} /> Upload Center
                      </a>
                    ) : null}
                    {elevated ? (
                      <a
                        role="menuitem"
                        href={elevated.href}
                        onClick={() => setMenuOpen(false)}
                      >
                        {elevated.kind === "admin" ? (
                          <ShieldCheck size={18} />
                        ) : (
                          <SquaresFour size={18} />
                        )}
                        {elevated.title}
                      </a>
                    ) : null}
                    <a
                      role="menuitem"
                      href="/account?tab=preferences"
                      onClick={() => setMenuOpen(false)}
                    >
                      <GearSix size={18} /> Preferences &amp; language
                    </a>
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        onTheme();
                        setMenuOpen(false);
                      }}
                    >
                      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                      Use {theme === "dark" ? "light" : "dark"} theme
                    </button>
                    <a
                      className="is-danger"
                      role="menuitem"
                      href="/signout-with-chatgpt?return_to=%2F"
                      onClick={() => setMenuOpen(false)}
                    >
                      <SignOut size={18} /> Logout
                    </a>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <a className="account-link" href={authEntryPath("login", "/account")}>
                <span>Login</span>
                <UserCircle size={22} />
              </a>
              <div className="header-overflow" ref={menuRef}>
                <button
                  className="icon-button"
                  ref={menuButtonRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Open site menu"
                  title="More actions"
                  onClick={() => setMenuOpen((value) => !value)}
                >
                  <DotsThree size={21} weight="bold" />
                </button>
                {menuOpen ? (
                  <div className="header-overflow-menu" role="menu">
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        onTheme();
                        setMenuOpen(false);
                      }}
                    >
                      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                      Use {theme === "dark" ? "light" : "dark"} theme
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function MobileNav({
  view,
  actor,
  lockAndPayVisible,
}: {
  view: AppView;
  actor: Actor | null;
  lockAndPayVisible: boolean;
}) {
  const accountHref = actor
    ? "/account"
    : authEntryPath("login", "/account");
  const byLabel = new Map(navItems.map((item) => [item.label, item]));
  const mobileItems = ["Browse", "Library", "Home", "Store"]
    .map((label) => byLabel.get(label))
    .filter(
      (item): item is (typeof navItems)[number] =>
        Boolean(item) && (lockAndPayVisible || item?.label !== "Store"),
    );
  return (
    <nav
      className="mobile-nav"
      aria-label="Mobile navigation"
      data-count={mobileItems.length + 1}
    >
      {mobileItems.map((item) => {
        const Icon = item.icon;
        return (
          <a
            key={item.label}
            href={item.href}
            className={item.label === "Home" ? "mobile-home" : undefined}
            aria-current={activeNav(view, item.label) ? "page" : undefined}
            aria-label={item.label}
          >
            <Icon size={21} weight={activeNav(view, item.label) ? "fill" : "regular"} />
            <span>{item.label}</span>
          </a>
        );
      })}
      <a href={accountHref} aria-current={view === "account" ? "page" : undefined}>
        <UserCircle size={21} weight={view === "account" ? "fill" : "regular"} />
        <span>{actor ? "Account" : "Login"}</span>
      </a>
    </nav>
  );
}

function SeriesTypeBadge({
  type,
  flagOnly = false,
}: {
  type: SeriesCard["type"] | string;
  flagOnly?: boolean;
}) {
  const normalized: "Manga" | "Manhwa" | "Manhua" =
    type.toUpperCase() === "MANHWA"
      ? "Manhwa"
      : type.toUpperCase() === "MANHUA"
        ? "Manhua"
        : "Manga";
  const country =
    normalized === "Manhwa" ? "kr" : normalized === "Manhua" ? "cn" : "jp";
  return (
    <span
      className={`series-type-badge type-${normalized.toLowerCase()} ${
        flagOnly ? "is-flag-only" : ""
      }`}
      aria-label={flagOnly ? normalized : undefined}
      title={flagOnly ? normalized : undefined}
    >
      <LanguageFlag country={country} label={normalized} showCode={false} />
      {flagOnly ? null : normalized}
    </span>
  );
}

function SeriesStatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const tone =
    normalized === "COMPLETED"
      ? "completed"
      : normalized === "HIATUS" || normalized === "PAUSED"
        ? "paused"
        : normalized === "ONGOING"
          ? "ongoing"
          : "upcoming";
  return (
    <span className={`series-status-badge status-${tone}`}>
      <i aria-hidden="true" />
      {catalogLabel(normalized)}
    </span>
  );
}

function ChapterAccessBadge({
  accessType,
  unlocked = false,
}: {
  accessType: string;
  unlocked?: boolean;
}) {
  const normalized = accessType === "FREE" || unlocked ? "free" : "paid";
  const label = normalized === "free" ? "Free" : "Paid";
  const icon =
    normalized === "free" ? <Check size={12} /> : <LockSimple size={12} />;
  return (
    <span className={`chapter-status-badge chapter-status-${normalized}`}>
      {icon}
      {label}
    </span>
  );
}

function SeriesCardView({
  item,
  wide = false,
}: {
  item: SeriesCard;
  wide?: boolean;
}) {
  return (
    <article className={`series-card ${wide ? "series-card-wide" : ""}`}>
      <a className="cover-link" href={`/title/${item.slug}`}>
        <ResilientCoverImage
          src={item.cover}
          alt={`Cover art for ${item.title}`}
          width={360}
          height={540}
        />
        <span className="cover-shade" />
        <SeriesTypeBadge type={item.type} flagOnly />
        <span className="quick-read">
          <Play size={14} weight="fill" />
          Read
        </span>
      </a>
      <div className="series-card-copy">
        <a href={`/title/${item.slug}`}>
          <h3>{item.title}</h3>
        </a>
        <p>{item.subtitle}</p>
        <div className="series-meta">
          <span>
            <Star size={14} weight="fill" /> {item.rating}
          </span>
          <span>{item.chapter}</span>
        </div>
      </div>
    </article>
  );
}

type LiveSeriesSummary = {
  id: string;
  slug: string;
  title: string;
  nativeTitle: string | null;
  synopsis: string;
  type: "MANHWA" | "MANGA" | "MANHUA";
  status: "ONGOING" | "COMPLETED" | "HIATUS" | "PAUSED" | "UPCOMING";
  accessType: "FREE" | "PAID";
  cover: string | null;
  ratingTenths: number;
  followerCount: number;
  viewCount: number;
  latestChapterNumber: string | null;
  chapterCount: number;
};

function liveSeriesCard(item: LiveSeriesSummary): SeriesCard {
  const type =
    item.type === "MANHWA"
      ? "Manhwa"
      : item.type === "MANHUA"
        ? "Manhua"
        : "Manga";
  const status =
    item.status === "COMPLETED"
      ? "Completed"
      : item.status === "HIATUS"
        ? "Hiatus"
        : item.status === "PAUSED"
          ? "Paused"
          : item.status === "UPCOMING"
            ? "Upcoming"
            : "Ongoing";
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    subtitle: item.nativeTitle ?? "Published on NyaScans",
    type,
    status,
    access: item.accessType,
    rating: Number(item.ratingTenths) / 10,
    followers: String(Number(item.followerCount ?? 0)),
    chapter: `${Number(item.chapterCount ?? 0)} chapters`,
    updated: "Recently",
    cover: item.cover ?? "/art/series-cover-placeholder.svg",
    accent: "#2d8cff",
    genres: [],
    direction:
      item.type === "MANHWA"
        ? "VERTICAL"
        : item.type === "MANHUA"
          ? "LTR"
          : "RTL",
    synopsis: item.synopsis,
    originalTitle: item.nativeTitle ?? "",
    creator: "Not credited",
    originalLanguage: "",
    originCountry: "",
    releaseYear: null,
    chapterCount: Number(item.chapterCount ?? 0),
    team: { name: "", slug: "", initials: "" },
  };
}

function SeriesRecommendations({ seriesSlug }: { seriesSlug: string }) {
  const [recommendations, setRecommendations] = useState<LiveSeriesSummary[]>(
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/catalog?page=1&pageSize=12&sort=followed", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: LiveSeriesSummary[];
        };
        if (!response.ok) return;
        setRecommendations(
          (payload.data ?? [])
            .filter((candidate) => candidate.slug !== seriesSlug)
            .slice(0, 8),
        );
      })
      .catch(() => {
        // Recommendations remain hidden until live catalogue data recovers.
      });
    return () => controller.abort();
  }, [seriesSlug]);

  if (!recommendations.length) return null;

  return (
    <section
      className="series-recommendations"
      aria-labelledby={`recommendations-${seriesSlug}`}
    >
      <SectionHeading
        id={`recommendations-${seriesSlug}`}
        title="Series recommendations"
        body="More published stories readers are following now."
      />
      <div className="recommend-grid">
        {recommendations.map((candidate) => (
          <div className="recommend-item" key={candidate.id}>
            <SeriesCardView item={liveSeriesCard(candidate)} />
            <span>
              {Number(candidate.followerCount ?? 0).toLocaleString("en-US")}{" "}
              followers ·{" "}
              {Number(candidate.viewCount ?? 0).toLocaleString("en-US")} views
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

type SeriesReview = {
  id: string;
  rating: number;
  body: string;
  spoiler: boolean;
  createdAt: string;
  updatedAt: string;
  displayName: string;
  role: string;
  ownedByViewer: boolean;
};

type ReviewSummary = {
  average: number;
  total: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
};

function ReviewStars({
  value,
  interactive = false,
  onChange,
}: {
  value: number;
  interactive?: boolean;
  onChange?: (value: number) => void;
}) {
  return (
    <span className="review-stars" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) =>
        interactive ? (
          <button
            type="button"
            key={star}
            aria-label={`Rate ${star} out of 5`}
            aria-pressed={star <= value}
            onClick={() => onChange?.(star)}
          >
            <Star size={22} weight={star <= value ? "fill" : "regular"} />
          </button>
        ) : (
          <Star
            size={15}
            key={star}
            weight={star <= Math.round(value) ? "fill" : "regular"}
          />
        ),
      )}
    </span>
  );
}

function SeriesReviews({
  actor,
  seriesSlug,
  showToast,
}: {
  actor: Actor | null;
  seriesSlug: string;
  showToast: (text: string) => void;
}) {
  const emptySummary: ReviewSummary = {
    average: 0,
    total: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };
  const [reviews, setReviews] = useState<SeriesReview[]>([]);
  const [summary, setSummary] = useState<ReviewSummary>(emptySummary);
  const [viewerReview, setViewerReview] = useState<SeriesReview | null>(null);
  const [sort, setSort] = useState<"newest" | "oldest" | "highest">(
    "newest",
  );
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadReviews() {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/reviews?series=${encodeURIComponent(seriesSlug)}&sort=${sort}`,
      );
      const payload = (await response.json()) as {
        data?: SeriesReview[];
        aggregate?: ReviewSummary;
        viewerReview?: SeriesReview | null;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Reviews could not be loaded.",
        );
      }
      setReviews(payload.data ?? []);
      setSummary(payload.aggregate ?? emptySummary);
      const own = payload.viewerReview ?? null;
      setViewerReview(own);
      if (own) {
        setRating(own.rating);
        setBody(own.body);
        setSpoiler(own.spoiler);
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Reviews could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadReviews(), 0);
    // seriesSlug and sort are the complete server query key.
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesSlug, sort]);

  async function saveReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actor) {
      window.location.assign(
        authEntryPath("login", `/title/${seriesSlug}#reviews`),
      );
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/reviews", {
        method: viewerReview ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(viewerReview ? { reviewId: viewerReview.id } : {}),
          seriesSlug,
          rating,
          body,
          spoiler,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Review could not be saved.");
      }
      showToast(viewerReview ? "Review updated." : "Review published.");
      await loadReviews();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Review could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeReview() {
    if (!viewerReview || busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/v1/reviews?id=${encodeURIComponent(viewerReview.id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Review could not be deleted.",
        );
      }
      setViewerReview(null);
      setRating(5);
      setBody("");
      setSpoiler(false);
      showToast("Review deleted.");
      await loadReviews();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Review could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="series-reviews" id="reviews" aria-labelledby="reviews-title">
      <div className="review-heading">
        <div>
          <p className="eyebrow">Reader ratings</p>
          <h2 id="reviews-title">Ratings & Reviews</h2>
        </div>
        <label>
          <span className="sr-only">Sort reviews</span>
          <select
            value={sort}
            onChange={(event) =>
              setSort(
                event.target.value as "newest" | "oldest" | "highest",
              )
            }
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="highest">Highest rated</option>
          </select>
          <CaretDown size={15} />
        </label>
      </div>
      <div className="review-summary-grid">
        <div className="review-score">
          <strong>{summary.average.toFixed(1)}</strong>
          <ReviewStars value={summary.average} />
          <span>
            {summary.total.toLocaleString("en-US")} rating
            {summary.total === 1 ? "" : "s"}
          </span>
        </div>
        <div className="review-distribution">
          {[5, 4, 3, 2, 1].map((value) => {
            const count =
              summary.distribution[value as 1 | 2 | 3 | 4 | 5] ?? 0;
            const percentage = summary.total
              ? Math.round((count / summary.total) * 100)
              : 0;
            return (
              <div key={value}>
                <span>{value}</span>
                <Star size={13} weight="fill" />
                <i>
                  <b style={{ width: `${percentage}%` }} />
                </i>
                <small>{count}</small>
              </div>
            );
          })}
        </div>
        <form className="review-composer" onSubmit={saveReview}>
          <div>
            <strong>
              {viewerReview ? "Update your review" : "Rate this series"}
            </strong>
            <ReviewStars
              value={rating}
              interactive
              onChange={setRating}
            />
          </div>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={4000}
            rows={4}
            placeholder="Share what worked for you. A written review is optional."
          />
          <div>
            <label>
              <input
                type="checkbox"
                checked={spoiler}
                onChange={(event) => setSpoiler(event.target.checked)}
              />
              Contains spoilers
            </label>
            {viewerReview ? (
              <button type="button" onClick={removeReview} disabled={busy}>
                <Trash size={16} /> Delete
              </button>
            ) : null}
            <button
              className="button button-primary"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "Saving..."
                : viewerReview
                  ? "Save review"
                  : "Publish review"}
            </button>
          </div>
        </form>
      </div>
      <div className="review-list" aria-live="polite">
        {loading ? (
          <div className="review-empty">Loading reader reviews...</div>
        ) : reviews.length ? (
          reviews.map((review) => (
            <article key={review.id}>
              <header>
                <span>
                  {review.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{review.displayName}</strong>
                  <small>
                    {new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                    }).format(new Date(review.createdAt))}
                  </small>
                </div>
                <ReviewStars value={review.rating} />
              </header>
              {review.body ? (
                review.spoiler ? (
                  <details>
                    <summary>Spoiler review. Reveal</summary>
                    <p>{review.body}</p>
                  </details>
                ) : (
                  <p>{review.body}</p>
                )
              ) : (
                <p className="review-rating-only">Rating only</p>
              )}
            </article>
          ))
        ) : (
          <div className="review-empty">
            <Star size={24} />
            <strong>No ratings yet</strong>
            <span>Be the first reader to rate this series.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function SectionHeading({
  title,
  body,
  action,
  id,
}: {
  title: string;
  body?: string;
  action?: { label: string; href: string };
  id?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2 id={id}>{title}</h2>
        {body ? <p>{body}</p> : null}
      </div>
      {action ? (
        <a href={action.href}>
          {action.label}
          <ArrowRight size={17} />
        </a>
      ) : null}
    </div>
  );
}

function EmptyState({
  title,
  body,
  compact = false,
}: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "empty-state-compact" : ""}`}>
      <span className="empty-cat" aria-hidden="true">
        <span />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

type LatestRelease = {
  id: string;
  slug: string;
  title: string;
  type: "MANGA" | "MANHWA" | "MANHUA";
  status: string;
  cover: string | null;
  ratingTenths: number;
  latestPublishedAt: string;
  chapters: Array<{
    slug: string;
    chapterNumber: string;
    title: string;
    language: string;
    version: number;
    accessType: string;
    effectiveAccessType: string;
    priceOnyx: number;
    publishedAt: string;
    teamName: string | null;
    teamSlug: string | null;
    isRead?: boolean;
    isFresh?: boolean;
    isNewInPeriod?: boolean;
  }>;
};

function releaseTime(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "Recently";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  return `${Math.round(hours / 24)}d`;
}

function FreshChapterMark({ fresh }: { fresh?: boolean }) {
  if (!fresh) return null;
  return (
    <span
      className="fresh-chapter-mark"
      aria-label="Published within the last 36 hours"
      title="Published within the last 36 hours"
    >
      <Fire size={15} weight="fill" aria-hidden="true" />
    </span>
  );
}

function LatestUpdatesGrid({
  heading = true,
  pagination = false,
  period = "all",
  pageSize = 6,
}: {
  heading?: boolean;
  pagination?: boolean;
  period?: "today" | "week" | "month" | "all";
  pageSize?: 6 | 20;
}) {
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<LatestRelease[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const [revision, setRevision] = useState(0);
  const hasRecordsRef = useRef(false);
  const [homePeriod, setHomePeriod] = useState<
    "today" | "week"
  >("week");
  const [releaseLanguages, setReleaseLanguages] = useState<string[]>([]);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const effectivePeriod =
    heading && !pagination ? homePeriod : period;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let requestInFlight = false;
    async function load(showLoading: boolean) {
      if (requestInFlight) return;
      requestInFlight = true;
      if (showLoading) setLoading(true);
      if (showLoading) setError("");
      setRefreshWarning("");
      try {
        const response = await fetch(
          `/api/v1/latest-releases?page=${page}&pageSize=${pageSize}&period=${effectivePeriod}${releaseLanguages.length ? `&languages=${encodeURIComponent(releaseLanguages.join(","))}` : ""}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const payload = (await response.json()) as {
          data?: LatestRelease[];
          pagination?: CatalogPagination;
          availableLanguages?: string[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Latest releases could not be loaded.",
          );
        }
        if (active) {
          const nextRecords = payload.data ?? [];
          hasRecordsRef.current = nextRecords.length > 0;
          setRecords(nextRecords);
          setPageCount(payload.pagination?.pageCount ?? 1);
          setHasPrevious(Boolean(payload.pagination?.hasPrevious));
          setHasNext(Boolean(payload.pagination?.hasNext));
          setAvailableLanguages(payload.availableLanguages ?? []);
        }
      } catch (loadError) {
        if (active && !controller.signal.aborted) {
          const message =
            loadError instanceof Error
              ? loadError.message
              : "Latest releases could not be loaded.";
          if (showLoading || !hasRecordsRef.current) {
            setError(message);
          } else {
            setRefreshWarning(
              "Latest updates could not refresh. Showing the last loaded releases.",
            );
          }
        }
      } finally {
        requestInFlight = false;
        if (active && !controller.signal.aborted && showLoading) setLoading(false);
      }
    }
    void load(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 60_000);
    function refreshVisible() {
      if (document.visibilityState === "visible") void load(false);
    }
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
      controller.abort();
    };
  }, [effectivePeriod, page, pageSize, releaseLanguages, revision]);

  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, pageCount - 4));
    return Array.from(
      { length: Math.min(5, pageCount) },
      (_, index) => start + index,
    );
  }, [page, pageCount]);

  return (
    <section className="latest-updates-block">
      {heading ? (
        <div className="section-heading latest-updates-heading">
          <div>
            <h2>Latest Updates</h2>
          </div>
          <div className="latest-updates-actions">
            <div className="latest-home-periods" aria-label="Latest updates period">
              <button
                type="button"
                aria-pressed={homePeriod === "today"}
                onClick={() => {
                  setPage(1);
                  setHomePeriod("today");
                }}
              >
                Today
              </button>
              <button
                type="button"
                aria-pressed={homePeriod === "week"}
                onClick={() => {
                  setPage(1);
                  setHomePeriod("week");
                }}
              >
                This Week
              </button>
            </div>
            <details className="latest-language-filter">
              <summary aria-label={releaseLanguages.length ? `Languages: ${releaseLanguages.map(languageName).join(", ")}` : "Choose release languages"}>
                <Translate size={18} />
                <span className="sr-only">Language</span>
                {releaseLanguages.length ? (
                  <small aria-hidden="true">{releaseLanguages.length}</small>
                ) : null}
              </summary>
              <div>
                <header>
                  <strong>Release languages</strong>
                  <small>{availableLanguages.length} published language{availableLanguages.length === 1 ? "" : "s"}</small>
                </header>
                <div className="release-language-options">
                  {availableLanguages.map((language) => {
                    const selected = releaseLanguages.includes(language);
                    return (
                      <label key={language}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            setPage(1);
                            setReleaseLanguages((current) =>
                              selected
                                ? current.filter((entry) => entry !== language)
                                : [...current, language],
                            );
                          }}
                        />
                        <LanguageFlag language={language} showCode={false} />
                        <span>{languageName(language)}</span>
                      </label>
                    );
                  })}
                  {!availableLanguages.length ? (
                    <p>No published release languages are available for this period.</p>
                  ) : null}
                </div>
                {releaseLanguages.length ? (
                  <button type="button" onClick={() => setReleaseLanguages([])}>Clear</button>
                ) : null}
              </div>
            </details>
            <a className="latest-all-action" href="/latest">
              All <ArrowRight size={17} />
            </a>
          </div>
        </div>
      ) : null}
      {loading ? (
        <div className="latest-grid latest-loading-grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index}>
              <i />
              <b />
              <small />
            </span>
          ))}
        </div>
      ) : error ? (
        <div className="catalog-error" role="alert">
          <WarningCircle size={26} />
          <div>
            <strong>Latest releases unavailable</strong>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : records.length ? (
        <div className="latest-grid">
          {records.map((update) => (
              <article className="latest-card" key={update.slug}>
                <a className="latest-cover" href={`/title/${update.slug}`}>
                  {update.cover ? (
                    <ResilientCoverImage
                      src={update.cover}
                      alt={`Cover art for ${update.title}`}
                      width={240}
                      height={360}
                    />
                  ) : (
                    <span className="catalog-cover-placeholder">
                      <Books size={30} />
                      <small>Cover pending</small>
                    </span>
                  )}
                  <span className="latest-cover-type">
                    <SeriesTypeBadge type={update.type} flagOnly />
                  </span>
                </a>
                <div className="latest-card-copy">
                  <div className="latest-card-head">
                    <div>
                      <div className="latest-series-badges">
                        <SeriesStatusBadge status={update.status} />
                      </div>
                      <a href={`/title/${update.slug}`}>
                        <h3>{update.title}</h3>
                      </a>
                    </div>
                    <span>
                      <Star size={13} weight="fill" />{" "}
                      {(Number(update.ratingTenths) / 10).toFixed(1)}
                    </span>
                  </div>
                  <ul className="latest-chapters">
                    {update.chapters.slice(0, 4).map((chapter) => (
                      <li key={chapter.slug}>
                        <span className="latest-chapter-copy">
                          <span className="latest-chapter-title-line">
                            <a
                              href={`/title/${update.slug}/chapter/${chapter.slug}`}
                            >
                              <span className="latest-chapter-identity">
                                <span
                                  className={`latest-age-dot${chapter.isFresh ? " is-new" : " is-old"}`}
                                  aria-label={chapter.isFresh ? "Released within 24 hours" : "Released more than 24 hours ago"}
                                />
                                <span>
                                  Chapter {normalizeChapterNumber(chapter.chapterNumber)}
                                </span>
                                <span
                                  className={`latest-read-state${chapter.isRead ? " is-read" : ""}`}
                                  aria-label={chapter.isRead ? "Chapter already read" : "Chapter not read yet"}
                                >
                                  <Eye size={15} weight={chapter.isRead ? "fill" : "regular"} aria-hidden="true" />
                                </span>
                              </span>
                              <time className="latest-chapter-period" dateTime={chapter.publishedAt}>
                                {releaseTime(chapter.publishedAt)} ago
                              </time>
                              <ChapterAccessBadge accessType={chapter.effectiveAccessType ?? chapter.accessType} />
                            </a>
                          </span>
                          <span className="latest-chapter-attribution">
                            <LanguageFlag
                              language={chapter.language}
                              showCode={false}
                            />
                            {chapter.teamSlug ? (
                              <a
                                href={`/team/${encodeURIComponent(chapter.teamSlug)}`}
                              >
                                {chapter.teamName ?? "Publishing team"}
                              </a>
                            ) : (
                              <span>
                                {chapter.teamName ?? "Independent release"}
                              </span>
                            )}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
        </div>
      ) : (
        <EmptyState
          title="No published releases yet"
          body="Verified chapter releases will appear here after publication."
          compact
        />
      )}
      {refreshWarning && records.length ? (
        <p className="latest-refresh-warning" role="status">
          <WarningCircle size={16} aria-hidden="true" />
          {refreshWarning}
        </p>
      ) : null}
      {pagination && !loading && !error && records.length ? (
        <nav className="latest-pagination" aria-label="Latest updates pages">
          <button
            type="button"
            disabled={!hasPrevious}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <CaretLeft size={15} /> Previous
          </button>
          <span>{page} / {pageCount}</span>
          {pageNumbers.map((pageNumber) => (
            <button
              type="button"
              key={pageNumber}
              aria-current={page === pageNumber ? "page" : undefined}
              onClick={() => setPage(pageNumber)}
            >
              {pageNumber}
            </button>
          ))}
          <button
            type="button"
            disabled={!hasNext}
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
          >
            Next <CaretRight size={15} />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function LatestUpdatesView() {
  const { settings: commercial } = useCommercialSettings();
  const [period, setPeriod] = useState<
    "today" | "week" | "month" | "all"
  >("week");
  return (
    <main className="page-main latest-page">
      <header className="latest-hero page-wrap">
        <p className="eyebrow">Fresh chapters</p>
        <h1>Latest Updates</h1>
        <p>
          {commercial.economy.premiumEconomyPublic
            ? "Paid and free chapter releases, sorted newest first in one easy-to-scan feed."
            : "New chapter releases, sorted newest first in one easy-to-scan feed."}
        </p>
        <div
          className="latest-periods"
          role="group"
          aria-label="Latest updates period"
        >
          {(
            [
              ["today", "Today"],
              ["week", "This week"],
              ["month", "This month"],
              ["all", "All time"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className="page-wrap">
        <LatestUpdatesGrid
          key={period}
          heading={false}
          pagination
          pageSize={20}
          period={period}
        />
      </div>
    </main>
  );
}

function TrendingShowcase() {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [ordered, setOrdered] = useState<LiveSeriesSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/catalog?page=1&pageSize=12&sort=viewed", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: LiveSeriesSummary[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Trending titles could not be loaded.",
          );
        }
        setOrdered(payload.data ?? []);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Trending titles could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  function moveRail(direction: -1 | 1) {
    const rail = railRef.current;
    if (!rail) return;
    const distance = Math.max(240, Math.round(rail.clientWidth * 0.78));
    rail.scrollBy({ left: distance * direction, behavior: "smooth" });
  }

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.sliderAutoplay !== "true") return;
    if (root.dataset.sliderStyle === "clean-grid") return;
    const seconds = Math.min(
      15,
      Math.max(3, Number(root.dataset.sliderInterval ?? 7)),
    );
    const timer = window.setInterval(() => {
      const rail = railRef.current;
      if (!rail || document.visibilityState !== "visible") return;
      const atEnd =
        rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 12;
      if (atEnd) {
        rail.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        moveRail(1);
      }
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="content-section page-wrap trending-section">
      <div className="section-tabs trending-heading">
        <div className="trending-title">
          <p className="eyebrow">Reader pulse</p>
          <h2>Trending</h2>
        </div>
        <div className="trending-actions">
          <a href="/leaderboard">
            Full ranking <ArrowRight size={17} />
          </a>
        </div>
      </div>
      <div className="trending-viewport">
        {loading ? (
          <div className="catalog-loading" role="status">
            Loading live reader activity…
          </div>
        ) : loadError ? (
          <div className="catalog-error" role="alert">
            <WarningCircle size={24} />
            <span>{loadError}</span>
          </div>
        ) : ordered.length ? (
        <div
          className="series-rail trending-rail"
          ref={railRef}
          aria-live="polite"
          aria-label="Trending series"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              moveRail(-1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              moveRail(1);
            }
          }}
        >
          {ordered.map((item, index) => (
            <div className="ranked-card" key={item.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <SeriesCardView item={liveSeriesCard(item)} />
              <small className="trending-live-metrics">
                {Number(item.viewCount ?? 0).toLocaleString("en-US")} views ·{" "}
                {Number(item.followerCount ?? 0).toLocaleString("en-US")} followers
              </small>
            </div>
          ))}
        </div>
        ) : (
          <EmptyState
            title="No reader activity yet"
            body="Published titles will rank here as real views arrive."
            compact
          />
        )}
      </div>
    </section>
  );
}

type CommunityHighlight = {
  id: string;
  seriesSlug: string;
  chapterSlug: string;
  seriesTitle: string;
  chapterNumber: string;
  chapterTitle: string;
  body: string;
  displayName: string;
  voteScore: number;
  upvoteCount: number;
  downvoteCount: number;
  replyCount: number;
  createdAt: string;
  cover: string | null;
};

function CommunityHighlights() {
  const [items, setItems] = useState<CommunityHighlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load(background = false) {
      if (!background) setLoading(true);
      try {
        const response = await fetch("/api/v1/community-highlights");
        const payload = (await response.json()) as {
          data?: CommunityHighlight[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ??
              "Community highlights could not be loaded.",
          );
        }
        if (!active) return;
        setItems(
          (payload.data ?? []).map((item) => ({
            ...item,
            chapterNumber: normalizeChapterNumber(item.chapterNumber),
          })),
        );
        setError("");
      } catch (loadError) {
        if (!active || background) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Community highlights could not be loaded.",
        );
      } finally {
        if (active && !background) setLoading(false);
      }
    }
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 20_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <section className="content-section page-wrap community-highlights">
      <SectionHeading
        title="Latest Top Comments"
        body="The strongest spoiler-safe chapter discussions from the last eight hours."
      />
      {loading ? (
        <div className="community-highlight-loading" role="status">
          Loading community activity…
        </div>
      ) : error ? (
        <div className="community-highlight-loading" role="alert">
          {error}
        </div>
      ) : items.length ? (
        <div className="community-highlight-grid">
          {items.map((item) => (
            <a
              href={`/title/${item.seriesSlug}/chapter/${item.chapterSlug}#comment-${item.id}`}
              className="community-highlight-card"
              key={item.id}
            >
              <span className="community-highlight-avatar" aria-hidden="true">
                {item.displayName.trim().slice(0, 1).toUpperCase() || "N"}
              </span>
              <span className="community-highlight-copy">
                <span className="community-highlight-source">
                  <strong>{item.seriesTitle}</strong>
                  {item.chapterNumber ? (
                    <em>Chapter {item.chapterNumber}</em>
                  ) : null}
                </span>
                <q>{item.body}</q>
                <span className="community-highlight-meta">
                  <strong>{item.displayName}</strong>
                  <span><ArrowUp size={13} /> {item.upvoteCount}</span>
                  <span><ArrowDown size={13} /> {item.downvoteCount}</span>
                  <span><ChatCircle size={13} /> {item.replyCount}</span>
                </span>
              </span>
              <span className="community-highlight-cover">
                {item.cover ? (
                  <ResilientCoverImage
                    src={item.cover}
                    alt={`Cover art for ${item.seriesTitle}`}
                    width={120}
                    height={180}
                    decorative
                  />
                ) : (
                  <Books size={24} />
                )}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No community highlights yet"
          body="Spoiler-safe chapter comments will appear here as readers vote and reply."
        />
      )}
    </section>
  );
}

type ContinueReadingRecord = {
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  coverUrl: string | null;
  chapterId: string;
  chapterSlug: string;
  chapterNumber: string;
  chapterTitle: string;
  pageIndex: number;
  pageCount: number;
  progress: number;
  chapterProgress: number;
  chaptersRead: number;
  chaptersTotal: number;
  lastOpenedAt: string;
  resumeUrl: string;
};

function continueReadingRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently opened";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Opened just now";
  if (minutes < 60) return `Opened ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Opened ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Opened yesterday" : `Opened ${days}d ago`;
}

function ContinueReadingSection({ signedIn }: { signedIn: boolean }) {
  const [records, setRecords] = useState<ContinueReadingRecord[]>([]);
  const [viewMode, setViewMode] = useState<"LIST" | "SHELF">("LIST");
  const [loading, setLoading] = useState(signedIn);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [savingViewMode, setSavingViewMode] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const viewModeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void fetch("/api/v1/continue-reading", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: ContinueReadingRecord[];
          preferences?: { viewMode?: "LIST" | "SHELF" };
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Continue Reading could not be loaded.",
          );
        }
        setRecords(payload.data ?? []);
        setViewMode(
          payload.preferences?.viewMode === "SHELF" ? "SHELF" : "LIST",
        );
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Continue Reading could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, signedIn]);

  useEffect(
    () => () => {
      viewModeRequest.current?.abort();
    },
    [],
  );

  async function chooseViewMode(next: "LIST" | "SHELF") {
    if (next === viewMode || loading || savingViewMode) return;
    const previous = viewMode;
    const controller = new AbortController();
    viewModeRequest.current?.abort();
    viewModeRequest.current = controller;
    setPreferenceError("");
    setSavingViewMode(true);
    setViewMode(next);
    try {
      const response = await fetch("/api/v1/continue-reading", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewMode: next }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Preference was not saved.");
    } catch (saveError) {
      if (!controller.signal.aborted) {
        setViewMode(previous);
        setPreferenceError(
          saveError instanceof Error
            ? saveError.message
            : "View preference was not saved.",
        );
      }
    } finally {
      if (viewModeRequest.current === controller) {
        viewModeRequest.current = null;
        setSavingViewMode(false);
      }
    }
  }

  return (
    <section
      className={`continue-reading-section page-wrap is-${viewMode.toLowerCase()}`}
      aria-labelledby="continue-reading-title"
    >
      <header className="continue-reading-heading">
        <div>
          <p className="eyebrow">Your recent stories</p>
          <h2 id="continue-reading-title">Continue reading</h2>
          <p>Resume one of the last 12 series you opened.</p>
          {preferenceError ? (
            <p className="continue-reading-preference-error" role="alert">
              {preferenceError}
            </p>
          ) : null}
        </div>
        {signedIn ? (
          <div className="continue-reading-actions">
            <div
              role="group"
              aria-label="Continue Reading view"
              aria-busy={savingViewMode}
            >
              <button
                type="button"
                aria-label="List view"
                title="List view"
                disabled={loading || savingViewMode}
                aria-pressed={viewMode === "LIST"}
                onClick={() => void chooseViewMode("LIST")}
              >
                <List size={18} />
              </button>
              <button
                type="button"
                aria-label="Cover shelf"
                title="Cover shelf"
                disabled={loading || savingViewMode}
                aria-pressed={viewMode === "SHELF"}
                onClick={() => void chooseViewMode("SHELF")}
              >
                <SquaresFour size={18} />
              </button>
            </div>
            <a href="/library">
              View library <ArrowRight size={15} />
            </a>
          </div>
        ) : null}
      </header>

      {!signedIn ? (
        <div className="continue-reading-guest">
          <span><Books size={23} /></span>
          <div>
            <strong>Keep every chapter in sync.</strong>
            <p>Sign in to resume from the exact page on any device.</p>
          </div>
          <a className="button button-secondary" href={authEntryPath("login", "/")}>
            Sign in
          </a>
        </div>
      ) : loading ? (
        <div className="continue-reading-skeleton" aria-label="Loading recent series" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index}><i /><b /><small /></span>
          ))}
        </div>
      ) : error ? (
        <div className="continue-reading-state" role="alert">
          <WarningCircle size={22} />
          <div>
            <strong>Recent series unavailable</strong>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : records.length ? (
        <div className="continue-reading-list">
          {records.map((record) => (
            <a
              className="continue-reading-item"
              href={record.resumeUrl}
              key={record.seriesId}
            >
              <span className="continue-reading-cover">
                {record.coverUrl ? (
                  <img
                    src={record.coverUrl}
                    alt={`Cover art for ${record.seriesTitle}`}
                    width={96}
                    height={144}
                    loading="lazy"
                  />
                ) : (
                  <Books size={24} />
                )}
              </span>
              <span className="continue-reading-copy">
                <strong>{record.seriesTitle}</strong>
                <small>
                  Chapter {normalizeChapterNumber(record.chapterNumber)}
                  {record.pageCount > 0
                    ? ` · Page ${Math.min(record.pageIndex + 1, record.pageCount)} of ${record.pageCount}`
                    : ""}
                </small>
                <small className="continue-reading-chapter-count">
                  {record.chaptersRead}/{record.chaptersTotal} chapters read
                </small>
                <span>{continueReadingRelativeTime(record.lastOpenedAt)}</span>
                <i
                  className="continue-reading-progress"
                  data-progress-tone={readingProgressTone(record.progress)}
                  role="progressbar"
                  aria-label={`${record.seriesTitle} reading progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(record.progress)}
                  aria-valuetext={`${record.chaptersRead} of ${record.chaptersTotal} chapters read`}
                >
                  <b style={{ width: `${Math.min(100, record.progress)}%` }} />
                </i>
              </span>
              <span className="continue-reading-resume" aria-hidden="true">
                <Play size={17} weight="fill" />
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="continue-reading-state">
          <Books size={22} />
          <div>
            <strong>Your recent series will appear here.</strong>
            <span>Open a chapter to start a synced reading trail.</span>
          </div>
          <a href="/browse">Browse series</a>
        </div>
      )}
    </section>
  );
}

type EditorPick = {
  id: string;
  seriesId: string;
  slug: string;
  title: string;
  nativeTitle: string | null;
  type: string;
  status: string;
  synopsis: string;
  shortDescription: string;
  categoryLabel: string;
  cover: string | null;
  banner: string | null;
  slider: string | null;
  ratingTenths: number;
  latestChapterSlug: string | null;
  chapterCount: number;
  followerCount: number;
  commentCount: number;
  genres: string[];
  alternativeTitles: string[];
  href?: string;
};

function featuredAlternativeTitles(item: EditorPick) {
  const seen = new Set([item.title.trim().toLocaleLowerCase()]);
  return [item.nativeTitle, ...(item.alternativeTitles ?? [])]
    .map((title) => title?.trim() ?? "")
    .filter((title) => {
      if (!title) return false;
      const normalized = title.toLocaleLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function FeaturedSliderArtwork({
  item,
  main = false,
}: {
  item: EditorPick;
  main?: boolean;
}) {
  const artwork = item.slider?.trim() || item.cover?.trim() || null;
  if (!artwork && !item.banner) {
    return <Books size={main ? 42 : 28} />;
  }
  return (
    <>
      {artwork ? (
        <ResilientCoverImage
          className="featured-card-cover"
          src={artwork}
          alt={main ? `Cover art for ${item.title}` : ""}
          width={main ? 630 : undefined}
          height={main ? 630 : undefined}
          loading={main ? "eager" : "lazy"}
          decorative={!main}
        />
      ) : null}
      {!artwork && item.banner ? (
        <ResilientCoverImage
          className="featured-card-banner featured-card-fallback"
          src={item.banner}
          alt=""
          decorative
          loading={main ? "eager" : "lazy"}
        />
      ) : null}
    </>
  );
}

function FeaturedSeriesSlider() {
  const [picks, setPicks] = useState<EditorPick[]>([]);
  const [active, setActive] = useState(0);
  const [pointerPaused, setPointerPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const swipeStart = useRef<number | null>(null);
  const paused = pointerPaused || focusPaused;

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/homepage-sliders", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: Array<Partial<EditorPick> & { imageUrl?: string | null; href?: string; seriesSlug?: string | null }>;
        };
        if (response.ok) setPicks((payload.data ?? []).map((slide) => ({
          id: String(slide.id),
          seriesId: String(slide.seriesId ?? slide.id),
          slug: String(slide.slug ?? slide.seriesSlug ?? "browse"),
          title: String(slide.title ?? "Featured"),
          nativeTitle: slide.nativeTitle ?? null,
          type: String(slide.type ?? "SERIES"),
          status: String(slide.status ?? "ONGOING"),
          synopsis: String(slide.synopsis ?? slide.shortDescription ?? ""),
          shortDescription: String(slide.shortDescription ?? ""),
          categoryLabel: String(slide.categoryLabel ?? "Featured"),
          cover: slide.cover?.trim() || slide.imageUrl?.trim() || null,
          banner: slide.banner?.trim() || null,
          slider: slide.imageUrl?.trim() || slide.slider?.trim() || null,
          ratingTenths: Number(slide.ratingTenths ?? 0),
          latestChapterSlug: slide.latestChapterSlug ?? null,
          chapterCount: Number(slide.chapterCount ?? 0),
          followerCount: Number(slide.followerCount ?? 0),
          commentCount: Number(slide.commentCount ?? 0),
          genres: slide.genres ?? [],
          alternativeTitles: slide.alternativeTitles ?? [],
          href: slide.href,
        })));
      })
      .catch(() => {
        // A branded static fallback remains usable while editorial data recovers.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (picks.length < 2 || paused) return;
    if (document.documentElement.dataset.sliderAutoplay === "false") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seconds = Math.min(
      15,
      Math.max(
        4,
        Number(document.documentElement.dataset.sliderInterval ?? 7),
      ),
    );
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setActive((current) => (current + 1) % picks.length);
      }
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [paused, picks.length]);

  if (!picks.length) {
    return (
      <section className="featured-slider featured-slider-fallback">
        <img
          className="featured-slider-backdrop"
          src="/art/hero-onyx-archive.png"
          alt=""
          aria-hidden="true"
          width={1600}
          height={1000}
          fetchPriority="high"
        />
        <div className="featured-slider-fallback-copy page-wrap">
          <p className="eyebrow">Featured</p>
          <h1>Stories worth losing the night to.</h1>
          <p>
            Read original manga and webtoons in a fast, calm reader built for
            every screen.
          </p>
          <a className="button button-primary" href="/browse">
            Browse series <ArrowRight size={17} />
          </a>
        </div>
      </section>
    );
  }

  const safeActive = active < picks.length ? active : 0;
  const item = picks[safeActive]!;
  const farPreviousIndex = (safeActive - 2 + picks.length) % picks.length;
  const outerPreviousIndex = (safeActive - 3 + picks.length) % picks.length;
  const outermostPreviousIndex =
    (safeActive - 4 + picks.length) % picks.length;
  const previousIndex = (safeActive - 1 + picks.length) % picks.length;
  const nextIndex = (safeActive + 1) % picks.length;
  const farNextIndex = (safeActive + 2) % picks.length;
  const outerNextIndex = (safeActive + 3) % picks.length;
  const outermostNextIndex = (safeActive + 4) % picks.length;
  const farPreviousItem = picks[farPreviousIndex]!;
  const outerPreviousItem = picks[outerPreviousIndex]!;
  const outermostPreviousItem = picks[outermostPreviousIndex]!;
  const previousItem = picks[previousIndex]!;
  const nextItem = picks[nextIndex]!;
  const farNextItem = picks[farNextIndex]!;
  const outerNextItem = picks[outerNextIndex]!;
  const outermostNextItem = picks[outermostNextIndex]!;
  const showFiveCards = picks.length >= 5;
  const showNineCards = picks.length >= 9;
  const alternativeTitle = featuredAlternativeTitles(item).join(" · ");
  const move = (direction: -1 | 1) =>
    setActive(
      (current) => (current + direction + picks.length) % picks.length,
    );

  return (
    <section
      className="featured-slider"
      aria-roledescription="carousel"
      aria-label="Featured series"
      onPointerEnter={() => setPointerPaused(true)}
      onPointerLeave={() => setPointerPaused(false)}
      onFocusCapture={() => setFocusPaused(true)}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setFocusPaused(false);
        }
      }}
      onPointerDown={(event) => {
        swipeStart.current = event.clientX;
      }}
      onPointerUp={(event) => {
        const start = swipeStart.current;
        swipeStart.current = null;
        if (start === null || Math.abs(event.clientX - start) < 48) return;
        move(event.clientX < start ? 1 : -1);
      }}
    >
      {item.banner || item.slider || item.cover ? (
        <ResilientCoverImage
          className="featured-slider-backdrop"
          src={item.banner ?? item.slider ?? item.cover!}
          alt=""
          decorative
          loading="eager"
        />
      ) : null}
      <div className="featured-slider-shade" />
      <div className="featured-slider-inner page-wrap">
        <div
          className="featured-slider-stage"
          data-visible-count={
            showNineCards ? "9" : showFiveCards ? "5" : "3"
          }
        >
          {showNineCards ? (
            <>
              <button
                className="featured-side-card featured-outer-card featured-outermost-card-left"
                type="button"
                aria-label={`Show ${outermostPreviousItem.title}`}
                onClick={() => setActive(outermostPreviousIndex)}
              >
                <FeaturedSliderArtwork item={outermostPreviousItem} />
              </button>
              <button
                className="featured-side-card featured-outer-card featured-outer-card-left"
                type="button"
                aria-label={`Show ${outerPreviousItem.title}`}
                onClick={() => setActive(outerPreviousIndex)}
              >
                <FeaturedSliderArtwork item={outerPreviousItem} />
              </button>
            </>
          ) : null}
          {showFiveCards ? (
            <button
              className="featured-side-card featured-edge-card featured-edge-card-left"
              type="button"
              aria-label={`Show ${farPreviousItem.title}`}
              onClick={() => setActive(farPreviousIndex)}
            >
              <FeaturedSliderArtwork item={farPreviousItem} />
            </button>
          ) : null}
          {picks.length > 1 ? (
            <button
              className="featured-side-card featured-side-card-left"
              type="button"
              aria-label={`Show ${previousItem.title}`}
              onClick={() => setActive(previousIndex)}
            >
              <FeaturedSliderArtwork item={previousItem} />
            </button>
          ) : null}
          <a
            className="featured-main-card"
            href={item.href ?? `/title/${item.slug}`}
            key={item.id}
          >
            <FeaturedSliderArtwork item={item} main />
            <span className="featured-main-details">
              <strong>{item.title}</strong>
              {alternativeTitle ? (
                <span
                  className="featured-main-alternatives"
                  title={alternativeTitle}
                >
                  {alternativeTitle}
                </span>
              ) : null}
              <span className="featured-main-meta">
                <SeriesStatusBadge status={item.status} />
                <span aria-label={`${item.followerCount} followers`}>
                  <Heart size={14} />
                  {item.followerCount}
                </span>
                <span aria-label={`${item.chapterCount} chapters`}>
                  <Books size={14} />
                  {item.chapterCount}
                </span>
                <span aria-label={`${item.commentCount} comments`}>
                  <ChatCircle size={14} />
                  {item.commentCount}
                </span>
              </span>
            </span>
          </a>
          {picks.length > 1 ? (
            <button
              className="featured-side-card featured-side-card-right"
              type="button"
              aria-label={`Show ${nextItem.title}`}
              onClick={() => setActive(nextIndex)}
            >
              <FeaturedSliderArtwork item={nextItem} />
            </button>
          ) : null}
          {showFiveCards ? (
            <button
              className="featured-side-card featured-edge-card featured-edge-card-right"
              type="button"
              aria-label={`Show ${farNextItem.title}`}
              onClick={() => setActive(farNextIndex)}
            >
              <FeaturedSliderArtwork item={farNextItem} />
            </button>
          ) : null}
          {showNineCards ? (
            <>
              <button
                className="featured-side-card featured-outer-card featured-outer-card-right"
                type="button"
                aria-label={`Show ${outerNextItem.title}`}
                onClick={() => setActive(outerNextIndex)}
              >
                <FeaturedSliderArtwork item={outerNextItem} />
              </button>
              <button
                className="featured-side-card featured-outer-card featured-outermost-card-right"
                type="button"
                aria-label={`Show ${outermostNextItem.title}`}
                onClick={() => setActive(outermostNextIndex)}
              >
                <FeaturedSliderArtwork item={outermostNextItem} />
              </button>
            </>
          ) : null}
          {picks.length > 1 ? (
            <div className="featured-slider-arrows">
              <button
                type="button"
                onClick={() => move(-1)}
                aria-label="Previous featured series"
              >
                <CaretLeft size={21} />
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                aria-label="Next featured series"
              >
                <CaretRight size={21} />
              </button>
            </div>
          ) : null}
        </div>
        {picks.length > 1 ? (
          <div className="featured-slider-dots" aria-label="Choose featured series">
            {picks.map((pick, index) => (
              <button
                type="button"
                key={pick.id}
                aria-label={`Show ${pick.title}`}
                aria-pressed={index === safeActive}
                onClick={() => setActive(index)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EditorsPickSection({
  actor,
  showToast,
}: {
  actor: Actor | null;
  showToast: (text: string) => void;
}) {
  const [picks, setPicks] = useState<EditorPick[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [librarySeries, setLibrarySeries] = useState<Set<string>>(
    () => new Set(),
  );
  const [libraryBusy, setLibraryBusy] = useState("");
  const swipeStart = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/editor-picks", {
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: EditorPick[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Editor's Picks could not be loaded.",
          );
        }
        setPicks(payload.data ?? []);
        setActive(0);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Editor's Picks could not be loaded.",
          );
        }
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!actor) return;
    const controller = new AbortController();
    void fetch("/api/v1/library", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: Array<{ series_id?: string; seriesId?: string }>;
        };
        if (!response.ok) return;
        setLibrarySeries(
          new Set(
            (payload.data ?? [])
              .map((entry) => entry.seriesId ?? entry.series_id ?? "")
              .filter(Boolean),
          ),
        );
      })
      .catch(() => {
        // The Add to Library action remains available while the snapshot retries.
      });
    return () => controller.abort();
  }, [actor]);

  if (error || picks.length === 0) return null;
  const safeActive = active < picks.length ? active : 0;
  const item = picks[safeActive];
  const previousItem = picks[(safeActive - 1 + picks.length) % picks.length];
  const nextItem = picks[(safeActive + 1) % picks.length];

  function move(direction: -1 | 1) {
    setActive(
      (current) => (current + direction + picks.length) % picks.length,
    );
  }

  async function addToLibrary() {
    if (!actor) {
      window.location.href = authEntryPath("login", "/");
      return;
    }
    if (librarySeries.has(item.seriesId)) {
      window.location.href = "/library";
      return;
    }
    setLibraryBusy(item.seriesId);
    try {
      const response = await fetch("/api/v1/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesId: item.seriesId,
          listType: "PLANNING",
          favorite: false,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "This title could not be added.",
        );
      }
      setLibrarySeries((current) => new Set(current).add(item.seriesId));
      showToast(`${item.title} added to your Library.`);
    } catch (libraryError) {
      showToast(
        libraryError instanceof Error
          ? libraryError.message
          : "This title could not be added.",
      );
    } finally {
      setLibraryBusy("");
    }
  }

  return (
    <section className="editors-pick-section page-wrap" aria-labelledby="editors-pick-title">
      <div className="editors-pick-heading">
        <div>
          <p className="eyebrow">Curated by NyaScans</p>
          <h2 id="editors-pick-title">Editor&apos;s Pick</h2>
          <span>Only the best, chosen for you.</span>
        </div>
      </div>
      <article
        className="editors-pick-card"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(-1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            move(1);
          }
        }}
      >
        <div className="editors-pick-visual">
          <div
            className="editors-pick-cover-stage"
            onPointerDown={(event) => {
              swipeStart.current = event.clientX;
            }}
            onPointerUp={(event) => {
              const start = swipeStart.current;
              swipeStart.current = null;
              if (start === null || Math.abs(event.clientX - start) < 42) return;
              move(event.clientX < start ? 1 : -1);
            }}
          >
            {picks.length > 1 && previousItem.cover ? (
              <ResilientCoverImage
                className="editors-pick-cover-back editors-pick-cover-back-left"
                src={previousItem.cover}
                alt=""
                decorative
              />
            ) : null}
            {picks.length > 1 && nextItem.cover ? (
              <ResilientCoverImage
                className="editors-pick-cover-back editors-pick-cover-back-right"
                src={nextItem.cover}
                alt=""
                decorative
              />
            ) : null}
            <div className="editors-pick-cover" key={item.id}>
              {item.cover ? (
                <ResilientCoverImage
                  src={item.cover}
                  alt={`Cover art for ${item.title}`}
                  width={380}
                  height={570}
                  loading="eager"
                />
              ) : (
                <span><Books size={38} /></span>
              )}
            </div>
            {picks.length > 1 ? (
              <div className="editors-pick-controls" aria-label="Editor’s Pick navigation">
                <button
                  type="button"
                  aria-label="Previous Editor’s Pick"
                  onClick={() => move(-1)}
                >
                  <CaretLeft size={20} />
                </button>
                <button
                  type="button"
                  aria-label="Next Editor’s Pick"
                  onClick={() => move(1)}
                >
                  <CaretRight size={20} />
                </button>
              </div>
            ) : null}
          </div>
          {picks.length > 1 ? (
            <div className="editors-pick-dots" aria-label="Choose Editor’s Pick">
              {picks.map((pick, index) => (
                <button
                  type="button"
                  key={pick.id}
                  aria-pressed={index === safeActive}
                  aria-label={`Show ${pick.title}`}
                  onClick={() => setActive(index)}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="editors-pick-copy" key={`copy-${item.id}`}>
          <div className="editors-pick-chips">
            <SeriesTypeBadge type={item.type} />
            <SeriesStatusBadge status={item.status} />
          </div>
          <h3>{item.title}</h3>
          <div className="editors-pick-desktop-detail">
            {[
              item.nativeTitle,
              ...(item.alternativeTitles ?? []),
            ].filter(Boolean).length ? (
              <p className="editors-pick-alternatives">
                <strong>Alternative titles</strong>
                <span>
                  {[
                    item.nativeTitle,
                    ...(item.alternativeTitles ?? []),
                  ]
                    .filter(
                      (title, index, all): title is string =>
                        Boolean(title) && all.indexOf(title) === index,
                    )
                    .join(" · ")}
                </span>
              </p>
            ) : null}
            {item.genres.length ? (
              <div className="editors-pick-genres" aria-label="Genres">
                {item.genres.map((genre) => (
                  <span key={genre}>{genre}</span>
                ))}
              </div>
            ) : null}
            <p className="editors-pick-description">
              {item.synopsis || item.shortDescription}
            </p>
          </div>
          <div className="editors-pick-meta">
            <span><Books size={15} /> {item.chapterCount} chapters</span>
            <span><Star size={15} weight="fill" /> {(item.ratingTenths / 10).toFixed(1)}</span>
            <span><ChatCircle size={15} /> {item.commentCount} comments</span>
          </div>
          <div className="editors-pick-actions">
            <a
              className="button button-primary"
              href={
                item.latestChapterSlug
                  ? `/title/${item.slug}/chapter/${item.latestChapterSlug}`
                  : `/title/${item.slug}`
              }
            >
              <Play size={18} weight="fill" /> Read now
            </a>
            <button
              className="button button-secondary"
              type="button"
              disabled={libraryBusy === item.seriesId}
              onClick={() => void addToLibrary()}
            >
              {librarySeries.has(item.seriesId) ? (
                <Check size={18} />
              ) : (
                <Books size={18} />
              )}
              {libraryBusy === item.seriesId
                ? "Adding…"
                : librarySeries.has(item.seriesId)
                  ? "Open Library"
                  : "Add to Library"}
            </button>
          </div>
        </div>
      </article>
    </section>
  );
}

function HomeView({
  actor,
  showToast,
}: {
  actor: Actor | null;
  showToast: (text: string) => void;
}) {
  const [promotions, setPromotions] = useState<{
    announcements: Array<{ id: string; type: "UPDATE" | "ISSUE" | "SUPPORT" | "NOTICE"; title: string; body: string; linkLabel: string; linkUrl: string }>;
    floatingAd: { id: string; eyebrow: string; title: string; body: string; destinationUrl: string; imageUrl: string | null; effect: "WAVE" | "PULSE" | "GLOW"; resetKey: string } | null;
  }>({ announcements: [], floatingAd: null });

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/home-promotions", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => { if (payload && !controller.signal.aborted) setPromotions(payload as typeof promotions); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <>
      <FloatingHomeAd campaign={promotions.floatingAd} />

      <FeaturedSeriesSlider />

      <main className="home-main">
        <TrendingShowcase />

        <ContinueReadingSection signedIn={Boolean(actor)} />

        <section className="updates-section">
          <div className="page-wrap">
            {promotions.announcements.length ? (
              <div className="v46-announcement-list" aria-label="Site announcements">
                {promotions.announcements.map((announcement) => {
                  const Icon = announcement.type === "UPDATE" ? Star : announcement.type === "ISSUE" ? WarningCircle : announcement.type === "SUPPORT" ? Lifebuoy : Bell;
                  return <article key={announcement.id} data-type={announcement.type.toLowerCase()}><span><Icon size={20} weight="duotone" /></span><div><small>{announcement.type}</small><strong>{announcement.title}</strong><FormattedAnnouncementText body={announcement.body} /></div>{announcement.linkUrl ? <a href={announcement.linkUrl}>{announcement.linkLabel || "Learn more"}<ArrowRight size={15} /></a> : null}</article>;
                })}
              </div>
            ) : null}
            <LatestUpdatesGrid />
          </div>
        </section>

        <EditorsPickSection actor={actor} showToast={showToast} />

        <NewSeriesSection />

        <PublishingTeamsCarousel />

        <CommunityHighlights />
      </main>
    </>
  );
}

function FloatingHomeAd({ campaign }: { campaign: { id: string; eyebrow: string; title: string; body: string; destinationUrl: string; imageUrl: string | null; effect: "WAVE" | "PULSE" | "GLOW"; resetKey: string } | null }) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const storageKey = campaign
    ? `nyascans:floating-ad:${campaign.id}:${campaign.resetKey}`
    : "";
  const dismiss = useCallback(() => {
    if (storageKey) window.localStorage.setItem(storageKey, "seen");
    setOpen(false);
  }, [storageKey]);
  useEffect(() => {
    if (!campaign) return;
    if (window.localStorage.getItem(storageKey)) return;
    const timer = window.setTimeout(() => {
      setImageFailed(false);
      setOpen(true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [campaign, storageKey]);
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [dismiss, open]);
  if (!open || !campaign) return null;
  return (
    <aside className="floating-home-ad v46-floating-home-ad" data-effect={campaign.effect.toLowerCase()} role="dialog" aria-modal="false" aria-label={campaign.title}>
      <button type="button" onClick={dismiss} aria-label="Close featured release">
        <X size={18} />
      </button>
      <a href={campaign.destinationUrl || "/browse?sort=latest"}>
        {campaign.imageUrl && !imageFailed ? <img src={campaign.imageUrl} alt="" onError={() => setImageFailed(true)} /> : <span className="floating-home-ad-placeholder"><ImageIcon size={32} weight="duotone" /></span>}
        <span>
          <small>{campaign.eyebrow}</small>
          <strong>{campaign.title}</strong>
          {campaign.body ? <p>{campaign.body}</p> : null}
          <em>Open <ArrowRight size={16} /></em>
        </span>
      </a>
    </aside>
  );
}

type CatalogResult = {
  id: string;
  slug: string;
  title: string;
  nativeTitle: string | null;
  synopsis: string;
  type: "MANHWA" | "MANGA" | "MANHUA";
  status: "ONGOING" | "COMPLETED" | "HIATUS" | "PAUSED" | "UPCOMING";
  accessType: "FREE" | "PAID";
  cover: string | null;
  ratingTenths: number;
  followerCount: number;
  viewCount: number;
  latestPublishedAt: string | null;
  latestChapterNumber: string | null;
  chapterCount: number;
};

type CatalogPagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

function catalogLabel(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function CatalogCover({
  item,
  compact = false,
}: {
  item: CatalogResult;
  compact?: boolean;
}) {
  return item.cover ? (
    <ResilientCoverImage
      src={item.cover}
      alt={`Cover art for ${item.title}`}
      width={compact ? 76 : 360}
      height={compact ? 114 : 540}
    />
  ) : (
    <span className="catalog-cover-placeholder" aria-hidden="true">
      <Books size={compact ? 22 : 34} />
      <small>Cover pending</small>
    </span>
  );
}

function CompactOptionMenu({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: string | number;
  options: Array<{ value: string | number; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  const currentLabel =
    options.find((option) => String(option.value) === String(value))?.label ??
    String(value);
  return (
    <details className={`compact-option-menu ${className}`.trim()}>
      <summary aria-label={`${label}: ${currentLabel}`}>
        <span>{label}</span>
        <CaretDown size={13} />
      </summary>
      <div role="listbox" aria-label={`${label} options`}>
        <small>Current: {currentLabel}</small>
        {options.map((option) => {
          const selected = String(option.value) === String(value);
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              key={String(option.value)}
              onClick={(event) => {
                onChange(String(option.value));
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>{option.label}</span>
              {selected ? <Check size={15} /> : null}
            </button>
          );
        })}
      </div>
    </details>
  );
}

function BrowseView({ showToast }: { showToast: (text: string) => void }) {
  const { settings: commercial } = useCommercialSettings();
  const premiumEconomyPublic =
    commercial.economy.premiumEconomyPublic;
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const [access, setAccess] = useState("All");
  const [status, setStatus] = useState("All");
  const [mode, setMode] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState("latest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [moreOpen, setMoreOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [items, setItems] = useState<CatalogResult[]>([]);
  const [pagination, setPagination] = useState<CatalogPagination>({
    page: 1,
    pageSize: 24,
    total: 0,
    pageCount: 1,
    hasPrevious: false,
    hasNext: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);

  useEffect(() => {
    function applyLocation() {
      const params = new URLSearchParams(window.location.search);
      const nextType = params.get("type")?.toUpperCase() ?? "ALL";
      const nextAccess = params.get("access")?.toUpperCase() ?? "ALL";
      const nextStatus = params.get("status")?.toUpperCase() ?? "ALL";
      const nextSort = params.get("sort") ?? "latest";
      const nextPage = Number(params.get("page") ?? 1);
      const nextPageSize = Number(params.get("pageSize") ?? 24);
      setQuery(params.get("q") ?? "");
      setType(
        ["MANHWA", "MANGA", "MANHUA"].includes(nextType)
          ? nextType
          : "All",
      );
      setAccess(
        ["FREE", "PAID"].includes(nextAccess)
          ? nextAccess
          : "All",
      );
      setStatus(
        ["ONGOING", "COMPLETED", "HIATUS", "PAUSED", "UPCOMING"].includes(nextStatus)
          ? nextStatus
          : "All",
      );
      setSort(
        ["latest", "added", "viewed", "followed", "rated", "title"].includes(
          nextSort,
        )
          ? nextSort
          : "latest",
      );
      setPage(Number.isInteger(nextPage) && nextPage > 0 ? nextPage : 1);
      setPageSize(
        nextPageSize === 12
          ? 16
          : nextPageSize === 36
            ? 32
            : [16, 24, 32, 48].includes(nextPageSize)
              ? nextPageSize
              : 24,
      );
      setMoreOpen(nextStatus !== "ALL");
    }
    const timeout = window.setTimeout(() => {
      applyLocation();
      setHydrated(true);
    }, 0);
    window.addEventListener("popstate", applyLocation);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("popstate", applyLocation);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
      });
      if (query.trim()) params.set("q", query.trim());
      if (type !== "All") params.set("type", type);
      if (premiumEconomyPublic && access !== "All") {
        params.set("access", access);
      }
      if (status !== "All") params.set("status", status);
      try {
        const response = await fetch(`/api/v1/catalog?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data?: CatalogResult[];
          pagination?: CatalogPagination;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "The catalog could not be loaded.",
          );
        }
        setItems(payload.data ?? []);
        setPagination(
          payload.pagination ?? {
            page,
            pageSize,
            total: 0,
            pageCount: 1,
            hasPrevious: false,
            hasNext: false,
          },
        );
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The catalog could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    access,
    catalogRevision,
    hydrated,
    page,
    pageSize,
    query,
    premiumEconomyPublic,
    sort,
    status,
    type,
  ]);

  function navigate(
    updates: Partial<{
      query: string;
      type: string;
      access: string;
      status: string;
      sort: string;
      page: number;
      pageSize: number;
    }>,
    replace = false,
  ) {
    const next = {
      query,
      type,
      access,
      status,
      sort,
      page,
      pageSize,
      ...updates,
    };
    const params = new URLSearchParams();
    if (next.query.trim()) params.set("q", next.query.trim());
    if (next.type !== "All") params.set("type", next.type.toLowerCase());
    if (premiumEconomyPublic && next.access !== "All") {
      params.set("access", next.access.toLowerCase());
    }
    if (next.status !== "All") {
      params.set("status", next.status.toLowerCase());
    }
    if (next.sort !== "latest") params.set("sort", next.sort);
    if (next.page > 1) params.set("page", String(next.page));
    if (next.pageSize !== 24) params.set("pageSize", String(next.pageSize));
    const nextUrl = `/browse${params.size ? `?${params.toString()}` : ""}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
    setQuery(next.query);
    setType(next.type);
    setAccess(next.access);
    setStatus(next.status);
    setSort(next.sort);
    setPage(next.page);
    setPageSize(next.pageSize);
  }

  const visiblePages = useMemo(() => {
    const start = Math.max(
      1,
      Math.min(pagination.page - 2, pagination.pageCount - 4),
    );
    return Array.from(
      { length: Math.min(5, pagination.pageCount) },
      (_, index) => start + index,
    );
  }, [pagination.page, pagination.pageCount]);

  return (
    <main className="page-main page-wrap">
      <section className="browse-intro">
        <p className="eyebrow">Catalog</p>
        <h1>Find the story that keeps you awake.</h1>
        <p>
          Search original titles, filter by reading format, and keep mature
          content behind your account settings.
        </p>
      </section>

      <section className="catalog-toolbar" aria-label="Catalog filters">
        <div className="catalog-search">
          <MagnifyingGlass size={19} />
          <label className="sr-only" htmlFor="catalog-query">
            Search catalog
          </label>
          <input
            id="catalog-query"
            value={query}
            onChange={(event) =>
              navigate({ query: event.target.value, page: 1 }, true)
            }
            placeholder="Search title, genre, creator, or team"
          />
        </div>
        <CompactOptionMenu
          label="Format"
          value={type}
          className="catalog-format-menu"
          options={[
            { value: "All", label: "All formats" },
            { value: "MANHWA", label: "Manhwa" },
            { value: "MANGA", label: "Manga" },
            { value: "MANHUA", label: "Manhua" },
          ]}
          onChange={(value) => navigate({ type: value, page: 1 })}
        />
        {premiumEconomyPublic ? (
          <label>
            <span>Access</span>
            <select
              value={access}
              onChange={(event) =>
                navigate({ access: event.target.value, page: 1 })
              }
            >
              <option value="All">All access</option>
              <option value="FREE">Free</option>
              <option value="PAID">Paid</option>
            </select>
            <CaretDown size={15} />
          </label>
        ) : null}
        <button
          className="filter-button"
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
        >
          <SlidersHorizontal size={18} />
          More filters
        </button>
      </section>

      <div className="catalog-summary">
        <div>
          <CompactOptionMenu
            label="Sort"
            value={sort}
            className="catalog-sort-control"
            options={[
              { value: "latest", label: "Latest update" },
              { value: "added", label: "Recently added" },
              { value: "viewed", label: "Most viewed" },
              { value: "followed", label: "Most followed" },
              { value: "rated", label: "Highest rated" },
              { value: "title", label: "Alphabetical" },
            ]}
            onChange={(value) => navigate({ sort: value, page: 1 })}
          />
          <CompactOptionMenu
            label="Show"
            value={pageSize}
            className="catalog-page-size-control"
            options={[16, 24, 32, 48].map((entry) => ({ value: entry, label: `${entry} results` }))}
            onChange={(value) => navigate({ pageSize: Number(value), page: 1 })}
          />
          <div className="view-mode-toggle" role="group" aria-label="Catalog view">
            <button
              type="button"
              onClick={() => setMode("grid")}
              aria-pressed={mode === "grid"}
              aria-label="Grid view"
              title="Grid view"
            >
              <SquaresFour size={19} />
            </button>
            <button
              type="button"
              onClick={() => setMode("list")}
              aria-pressed={mode === "list"}
              aria-label="List view"
              title="List view"
            >
              <List size={19} />
            </button>
          </div>
        </div>
      </div>
      {moreOpen ? (
        <div className="advanced-filter-bar">
          {[
            ["ONGOING", "Ongoing"],
            ["COMPLETED", "Completed"],
            ["HIATUS", "Hiatus"],
            ["PAUSED", "Paused"],
            ["UPCOMING", "Upcoming"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={status === value}
              onClick={() =>
                navigate({
                  status: status === value ? "All" : value,
                  page: 1,
                })
              }
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              navigate({
                query: "",
                type: "All",
                access: "All",
                status: "All",
                sort: "latest",
                page: 1,
                pageSize: 24,
              });
              setMoreOpen(false);
              showToast("Filters cleared.");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : null}

      {loading ? (
        <section
          className="catalog-skeleton-grid"
          aria-label="Loading catalog"
          aria-busy="true"
        >
          {Array.from({ length: Math.min(pageSize, 16) }, (_, index) => (
            <span key={index}>
              <i />
              <b />
              <small />
            </span>
          ))}
        </section>
      ) : error ? (
        <div className="catalog-error" role="alert">
          <WarningCircle size={26} />
          <div>
            <strong>Catalog unavailable</strong>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setCatalogRevision((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : items.length ? (
        <section className={`catalog-results catalog-${mode}`}>
          {items.map((item) =>
            mode === "grid" ? (
              <article className="series-card catalog-series-card" key={item.id}>
                <a className="cover-link" href={`/title/${item.slug}`}>
                  <CatalogCover item={item} />
                  <span className="cover-shade" />
                  <span className="quick-read">
                    <Play size={14} weight="fill" /> Read
                  </span>
                </a>
                <div className="series-card-copy">
                  <a href={`/title/${item.slug}`}>
                    <h3>{item.title}</h3>
                  </a>
                  <div className="catalog-badge-row">
                    <SeriesTypeBadge type={item.type} />
                    <SeriesStatusBadge status={item.status} />
                  </div>
                  <div className="series-meta">
                    <span>
                      <Star size={14} weight="fill" />{" "}
                      {(Number(item.ratingTenths) / 10).toFixed(1)}
                    </span>
                    <span>
                      {item.latestChapterNumber
                        ? `Ch. ${normalizeChapterNumber(item.latestChapterNumber)}`
                        : `${Number(item.chapterCount)} chapters`}
                    </span>
                  </div>
                </div>
              </article>
            ) : (
              <a className="series-list-row" href={`/title/${item.slug}`} key={item.id}>
                <span className="series-list-cover">
                  <CatalogCover item={item} compact />
                </span>
                <div>
                  <div className="catalog-badge-row">
                    <SeriesTypeBadge type={item.type} />
                    <SeriesStatusBadge status={item.status} />
                  </div>
                  <h2>{item.title}</h2>
                  <p>{item.synopsis}</p>
                </div>
                <div className="list-stats">
                  <span>
                    <Star size={15} weight="fill" />{" "}
                    {(Number(item.ratingTenths) / 10).toFixed(1)}
                  </span>
                  <span>
                    {Number(item.followerCount).toLocaleString("en-US")} followers
                  </span>
                  <strong>
                    {item.latestChapterNumber
                      ? `Ch. ${normalizeChapterNumber(item.latestChapterNumber)}`
                      : "No releases"}
                  </strong>
                </div>
                <ArrowRight size={20} />
              </a>
            ),
          )}
        </section>
      ) : (
        <EmptyState
          title="No titles match these filters"
          body="Clear one filter or search for a broader theme."
        />
      )}
      {!loading && !error && pagination.total > 0 ? (
        <nav className="catalog-pagination" aria-label="Catalog pages">
          <button
            type="button"
            disabled={!pagination.hasPrevious}
            onClick={() => navigate({ page: Math.max(1, page - 1) })}
          >
            <CaretLeft size={16} /> <span>Previous</span>
          </button>
          <div>
            {visiblePages.map((pageNumber) => (
              <button
                type="button"
                key={pageNumber}
                aria-current={pageNumber === pagination.page ? "page" : undefined}
                onClick={() => navigate({ page: pageNumber })}
              >
                {pageNumber}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!pagination.hasNext}
            onClick={() =>
              navigate({ page: Math.min(pagination.pageCount, page + 1) })
            }
          >
            <span>Next</span> <CaretRight size={16} />
          </button>
        </nav>
      ) : null}
    </main>
  );
}

function GuestLibraryView() {
  return (
    <main className="page-main page-wrap">
      <section className="auth-benefit">
        <div>
          <Books size={34} />
          <p className="eyebrow">Your library</p>
          <h1>Pick up at the exact panel.</h1>
          <p>
            Follow titles, keep your reading status organized, sync progress,
            and export your private library from one place.
          </p>
          <a
            className="button button-primary"
            href={authEntryPath("login", "/library")}
          >
            <SignIn size={18} />
            Sign in
          </a>
        </div>
        <div className="library-preview" aria-hidden="true">
          <div className="preview-book">
            <img src="/art/cover-glass-orchard.png" alt="" />
            <span style={{ height: "68%" }} />
          </div>
          <div className="preview-book">
            <img src="/art/cover-neon-ronin.png" alt="" />
            <span style={{ height: "41%" }} />
          </div>
          <div className="preview-book">
            <img src="/art/cover-moon-parcel.png" alt="" />
            <span style={{ height: "86%" }} />
          </div>
        </div>
      </section>
    </main>
  );
}

function LibraryView({ actor }: { actor: Actor | null }) {
  if (!actor) {
    return <GuestLibraryView />;
  }
  return (
    <main className="page-main page-wrap library-page">
      <LibraryWorkspace />
    </main>
  );
}

type StoreCollection = {
  id: string;
  slug: string;
  name: string;
  description: string;
  themeKey: string;
  isSeasonal: boolean;
};

type StoreCosmetic = {
  id: string;
  slug: string;
  collectionId: string;
  name: string;
  description: string;
  category: string;
  priceOnyx: number;
  priceCurrency: "ONYX" | "SHARDS";
  previewUrl: string | null;
  previewConfig: {
    from?: string;
    to?: string;
    accent?: string;
    symbol?: string;
  };
  owned: boolean;
  equipped: boolean;
};

type StoreCategory =
  | "coins"
  | "memberships"
  | "gifts"
  | "banners"
  | "cosmetics"
  | "logo-effects";

const storeCategories: readonly StoreCategory[] = [
  "coins",
  "memberships",
  "gifts",
  "banners",
  "cosmetics",
  "logo-effects",
];

function normalizeStoreCategory(value?: string): StoreCategory {
  return storeCategories.includes(value as StoreCategory)
    ? (value as StoreCategory)
    : "coins";
}

function cosmeticCategoryLabel(category: string) {
  return {
    PROFILE_BANNER: "Profile banner",
    PROFILE_FRAME: "Animated profile frame",
    USERNAME_DECORATION: "Username decoration",
    COMMENT_EFFECT: "Comment effect",
    COMMENT_GRADIENT: "Comment gradient",
    SEASONAL_PROFILE: "Seasonal profile",
    LOGO_EFFECT: "Logo effect",
  }[category] ?? category.replaceAll("_", " ").toLowerCase();
}

type StoreOfferMedia = {
  primary: string | null;
  banner: string | null;
  icon: string | null;
};

type StoreCoinPackage = CommercialSettings["economy"]["packages"][number] & {
  ctaText: string;
  altText: string;
  themeKey: string;
  detailedDescription: string;
  media: StoreOfferMedia;
};

type StoreMembership = CommercialSettings["economy"]["memberships"][number] & {
  ctaText: string;
  altText: string;
  themeKey: string;
  detailedDescription: string;
  media: StoreOfferMedia;
};

function StoreView({
  actor,
  category,
  showToast,
}: {
  actor: Actor | null;
  category?: string;
  showToast: (text: string) => void;
}) {
  const { settings: commercial } = useCommercialSettings();
  const premiumEconomyPublic = commercial.economy.premiumEconomyPublic;
  const requestedCategory = normalizeStoreCategory(category);
  const selectedCategory =
    !premiumEconomyPublic &&
    ["coins", "memberships", "gifts"].includes(requestedCategory)
      ? "cosmetics"
      : requestedCategory;
  const [busy, setBusy] = useState<string | null>(null);
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [balance, setBalance] = useState<number | null>(null);
  const [shardBalance, setShardBalance] = useState<number | null>(null);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState(
    "Checkout is not configured.",
  );
  const [collections, setCollections] = useState<StoreCollection[]>([]);
  const [cosmetics, setCosmetics] = useState<StoreCosmetic[]>([]);
  const [packages, setPackages] = useState<StoreCoinPackage[]>([]);
  const [memberships, setMemberships] = useState<StoreMembership[]>([]);
  const sortedMemberships = useMemo(
    () =>
      [...memberships].sort(
        (left, right) =>
          Number(
            billing === "monthly"
              ? left.monthlyPriceMinor
              : left.annualPriceMinor,
          ) -
          Number(
            billing === "monthly"
              ? right.monthlyPriceMinor
              : right.annualPriceMinor,
          ),
      ),
    [billing, memberships],
  );
  const [categoryCounts, setCategoryCounts] = useState<
    Record<StoreCategory, number>
  >({
    coins: 0,
    memberships: 0,
    gifts: 2,
    banners: 0,
    cosmetics: 0,
    "logo-effects": 0,
  });
  const [activeCollection, setActiveCollection] = useState("all");
  const [storeError, setStoreError] = useState("");
  const [storeRevision, setStoreRevision] = useState(0);
  const updateStoreBalances = useCallback((onyx: number, shards: number) => {
    setBalance(onyx);
    setShardBalance(shards);
  }, []);
  const storeRequestKey = `${selectedCategory}:${storeRevision}`;
  const [loadedStoreRequest, setLoadedStoreRequest] = useState("");
  const storeLoading = loadedStoreRequest !== storeRequestKey;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/v1/store/products?category=${encodeURIComponent(selectedCategory)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          selectedCategory?: StoreCategory;
          categoryCounts?: Partial<Record<StoreCategory, number>>;
          data?: StoreCoinPackage[];
          memberships?: StoreMembership[];
          checkoutEnabled?: boolean;
          checkoutStatus?: string;
          collections?: StoreCollection[];
          cosmetics?: StoreCosmetic[];
          viewer?: { balance?: number } | null;
          balances?: {
            onyx?: { balance?: number };
            shards?: { balance?: number };
          } | null;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "The Store could not be loaded.",
          );
        }
        return payload;
      })
      .then(
        (payload) => {
          if (controller.signal.aborted) return;
          setCheckoutEnabled(Boolean(payload.checkoutEnabled));
          setCheckoutStatus(
            payload.checkoutStatus ??
              "Checkout is not configured.",
          );
          setCollections(payload.collections ?? []);
          setCosmetics(payload.cosmetics ?? []);
          setPackages(
            [...(payload.data ?? [])].sort(
              (left, right) =>
                Number(left.priceMinor) - Number(right.priceMinor) ||
                left.id.localeCompare(right.id),
            ),
          );
          setMemberships(payload.memberships ?? []);
          setActiveCollection("all");
          setStoreError("");
          setCategoryCounts((current) => ({
            ...current,
            ...payload.categoryCounts,
          }));
          if (payload.viewer) {
            setBalance(Number(payload.viewer.balance ?? 0));
          }
          if (payload.balances) {
            setBalance(Number(payload.balances.onyx?.balance ?? 0));
            setShardBalance(Number(payload.balances.shards?.balance ?? 0));
          }
          setLoadedStoreRequest(storeRequestKey);
        },
      )
      .catch(() => {
        if (controller.signal.aborted) return;
        setCheckoutEnabled(false);
        setCheckoutStatus("Checkout configuration could not be verified.");
        setStoreError("The cosmetic marketplace could not be loaded.");
        setLoadedStoreRequest(storeRequestKey);
      });
    if (actor && premiumEconomyPublic) void fetch("/api/v1/wallet", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Wallet unavailable");
        return (await response.json()) as { balance?: number };
      })
      .then((payload) => setBalance(Number(payload.balance ?? 0)))
      .catch(() => {
        if (!controller.signal.aborted) setBalance(null);
      });
    return () => controller.abort();
  }, [actor, premiumEconomyPublic, selectedCategory, storeRequestKey]);

  async function unlockCosmetic(item: StoreCosmetic) {
    if (!actor) {
      window.location.assign(
        authEntryPath("login", `/store/${selectedCategory}`),
      );
      return;
    }
    if (item.owned) {
      await equipCosmetic(item);
      return;
    }
    const currencyBalance =
      item.priceCurrency === "SHARDS" ? shardBalance : balance;
    const currentBalance = Number(currencyBalance ?? 0);
    const currencyLabel =
      item.priceCurrency === "SHARDS" ? "Shards" : commercial.economy.coinPlural;
    if (currencyBalance !== null && currentBalance < item.priceOnyx) {
      showToast(
        `You need ${(item.priceOnyx - currentBalance).toLocaleString("en-US")} more ${currencyLabel} to unlock ${item.name}.`,
      );
      return;
    }
    if (
      !window.confirm(
        `Unlock ${item.name} for ${item.priceOnyx.toLocaleString("en-US")} ${currencyLabel}?\n\nBalance: ${currentBalance.toLocaleString("en-US")} → ${(currentBalance - item.priceOnyx).toLocaleString("en-US")} ${currencyLabel}`,
      )
    ) {
      return;
    }
    setBusy(item.id);
    try {
      const response = await fetch("/api/v1/store/purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          idempotencyKey: `${item.id}:${clientRandomId()}`,
        }),
      });
      const payload = (await response.json()) as {
        balances?: {
          onyx?: { balance?: number };
          shards?: { balance?: number };
        };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "This cosmetic could not be unlocked.",
        );
      }
      const nextBalance = Number(
        item.priceCurrency === "SHARDS"
          ? payload.balances?.shards?.balance ?? shardBalance ?? 0
          : payload.balances?.onyx?.balance ?? balance ?? 0,
      );
      if (payload.balances) {
        setBalance(Number(payload.balances.onyx?.balance ?? balance ?? 0));
        setShardBalance(
          Number(payload.balances.shards?.balance ?? shardBalance ?? 0),
        );
      }
      showToast(
        `${item.name} unlocked. ${nextBalance.toLocaleString("en-US")} ${currencyLabel} remaining.`,
      );
      setStoreError("");
      setStoreRevision((value) => value + 1);
    } catch (purchaseError) {
      showToast(
        purchaseError instanceof Error
          ? purchaseError.message
          : "This cosmetic could not be unlocked.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function equipCosmetic(item: StoreCosmetic) {
    if (!actor) {
      window.location.assign(
        authEntryPath("login", `/store/${selectedCategory}`),
      );
      return;
    }
    setBusy(item.id);
    try {
      const response = await fetch("/api/v1/store/equip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: item.equipped ? null : item.id,
          category: item.category,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Your cosmetic loadout could not be saved.",
        );
      }
      showToast(item.equipped ? `${item.name} removed.` : `${item.name} equipped.`);
      setStoreError("");
      setStoreRevision((value) => value + 1);
    } catch (equipError) {
      showToast(
        equipError instanceof Error
          ? equipError.message
          : "Your cosmetic loadout could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function buy(productId: string) {
    if (!checkoutEnabled) {
      showToast(checkoutStatus);
      return;
    }
    if (!actor) {
      window.location.assign(
        authEntryPath("login", `/store/${selectedCategory}`),
      );
      return;
    }
    setBusy(productId);
    try {
      const response = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId,
          idempotencyKey: `${productId}:${clientRandomId()}`,
        }),
      });
      const payload = (await response.json()) as {
        balance?: number;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Checkout could not be completed.");
      }
      if (typeof payload.balance === "number") setBalance(payload.balance);
      showToast("Order completed and added to your purchase history.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Checkout could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  const visibleCosmetics =
    activeCollection === "all"
      ? cosmetics
      : cosmetics.filter((item) => item.collectionId === activeCollection);
  const banners = visibleCosmetics.filter(
    (item) => item.category === "PROFILE_BANNER",
  );
  const logoEffects = visibleCosmetics.filter(
    (item) => item.category === "LOGO_EFFECT",
  );
  const standardCosmetics = visibleCosmetics.filter(
    (item) =>
      item.category !== "PROFILE_BANNER" &&
      item.category !== "LOGO_EFFECT",
  );

  function renderStoreItems(items: StoreCosmetic[], emptyTitle: string) {
    if (storeLoading) {
      return (
        <div
          className="store-cosmetics-grid store-cosmetics-loading"
          aria-busy="true"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <span key={index}>
              <i />
              <b />
              <small />
            </span>
          ))}
        </div>
      );
    }
    if (storeError) {
      return (
        <div className="catalog-error" role="alert">
          <WarningCircle size={24} />
          <div>
            <strong>Store unavailable</strong>
            <span>{storeError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setStoreError("");
              setStoreRevision((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    if (!items.length) {
      return (
        <EmptyState
          title={emptyTitle}
          body="Published Store items will appear here."
          compact
        />
      );
    }
    return (
      <div className="store-cosmetics-grid">
        {items.map((item) => {
          const previewStyle = {
            "--store-from": item.previewConfig.from ?? "#0b4f7d",
            "--store-to": item.previewConfig.to ?? "#08243b",
            "--store-accent": item.previewConfig.accent ?? "#7dd3fc",
          } as CSSProperties;
          return (
            <article className="store-cosmetic-card" key={item.id}>
              <div className="store-cosmetic-preview" style={previewStyle}>
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={`Preview of ${item.name}`}
                    loading="lazy"
                  />
                ) : (
                  <>
                    <span className="store-preview-avatar">
                      <UserCircle size={38} weight="fill" />
                    </span>
                    <strong>{item.previewConfig.symbol ?? "NYA"}</strong>
                    <i />
                  </>
                )}
                <span className="store-preview-label">Live preview</span>
              </div>
              <div className="store-cosmetic-copy">
                <span>{cosmeticCategoryLabel(item.category)}</span>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <div>
                  <strong>
                    {item.priceCurrency === "SHARDS" ? (
                      <Sparkle size={16} weight="fill" />
                    ) : (
                      <ConfiguredCoinMark settings={commercial} size={16} />
                    )}
                    {item.priceOnyx.toLocaleString("en-US")}
                  </strong>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => void unlockCosmetic(item)}
                  >
                    {busy === item.id
                      ? "Saving…"
                      : item.equipped
                        ? "Equipped"
                        : item.owned
                          ? "Equip"
                          : actor
                            ? "Unlock"
                            : "Sign in"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <main className="page-main store-page">
      <section className="store-hero page-wrap">
        <div>
          <p className="eyebrow">NyaScans store</p>
          <h1>Choose what you unlock.</h1>
          <p>
            {premiumEconomyPublic
              ? `${commercial.economy.coinPlural}, Shards, memberships, gifts, and cosmetics are shown clearly before confirmation.`
              : "Shard cosmetics and earned rewards are shown clearly before confirmation."}
          </p>
        </div>
        <a className="wallet-chip wallet-chip-multi" href="/wallet">
          {premiumEconomyPublic ? (
            <span>
              <ConfiguredCoinMark settings={commercial} size={19} />
              <b>{actor ? (balance ?? "...") : "Sign in"}</b> {commercial.economy.coinPlural}
            </span>
          ) : null}
          <span>
            <Sparkle size={18} weight="fill" />
            <b>{actor ? (shardBalance ?? "...") : "Sign in"}</b> Shards
          </span>
          <ArrowRight size={17} />
        </a>
      </section>

      <nav className="store-section-nav page-wrap" aria-label="Store sections">
        {premiumEconomyPublic ? (
          <>
            <a
              href="/store/coins"
              aria-current={selectedCategory === "coins" ? "page" : undefined}
            >
              <ConfiguredCoinMark settings={commercial} size={17} />
              {commercial.economy.coinPlural}
              <small>{categoryCounts.coins}</small>
            </a>
            <a
              href="/store/memberships"
              aria-current={selectedCategory === "memberships" ? "page" : undefined}
            >
              <CrownSimple size={17} /> Memberships
              <small>{categoryCounts.memberships}</small>
            </a>
            <a
              href="/store/gifts"
              aria-current={selectedCategory === "gifts" ? "page" : undefined}
            >
              <Gift size={17} /> Gifts
              <small>{categoryCounts.gifts}</small>
            </a>
          </>
        ) : null}
        <a
          href="/store/banners"
          aria-current={selectedCategory === "banners" ? "page" : undefined}
        >
          <ImageIcon size={17} /> Banners
          <small>{categoryCounts.banners}</small>
        </a>
        <a
          href="/store/cosmetics"
          aria-current={selectedCategory === "cosmetics" ? "page" : undefined}
        >
          <Gift size={17} /> Cosmetics
          <small>{categoryCounts.cosmetics}</small>
        </a>
        <a
          href="/store/logo-effects"
          aria-current={
            selectedCategory === "logo-effects" ? "page" : undefined
          }
        >
          <Star size={17} /> Logo Effects
          <small>{categoryCounts["logo-effects"]}</small>
        </a>
      </nav>

      {!["gifts", "banners", "cosmetics", "logo-effects"].includes(
        selectedCategory,
      ) && storeLoading ? (
        <div className="settings-loading page-wrap" role="status">
          Loading this Store category…
        </div>
      ) : null}
      {!["gifts", "banners", "cosmetics", "logo-effects"].includes(
        selectedCategory,
      ) && storeError ? (
        <div className="catalog-error page-wrap" role="alert">
          <WarningCircle size={24} />
          <div>
            <strong>Store unavailable</strong>
            <span>{storeError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setStoreError("");
              setStoreRevision((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      {premiumEconomyPublic && selectedCategory === "gifts" ? (
        <GiftStorePanel
          signedIn={Boolean(actor)}
          showToast={showToast}
          onBalances={updateStoreBalances}
        />
      ) : null}

      {["banners", "cosmetics", "logo-effects"].includes(selectedCategory) ? (
      <section className="store-marketplace page-wrap">
        <SectionHeading
          title={
            selectedCategory === "banners"
              ? "Profile banners"
              : selectedCategory === "logo-effects"
                ? "Logo effects"
                : "Premium cosmetics"
          }
          body="Filter published visual items by their active collection."
        />
        <div className="store-collection-tabs" aria-label="Store collections">
          <button
            type="button"
            aria-pressed={activeCollection === "all"}
            onClick={() => setActiveCollection("all")}
          >
            All collections
          </button>
          {collections.map((collection) => (
            <button
              type="button"
              key={collection.id}
              aria-pressed={activeCollection === collection.id}
              onClick={() => setActiveCollection(collection.id)}
            >
              {collection.name}
              {collection.isSeasonal ? <small>Seasonal</small> : null}
            </button>
          ))}
        </div>
        {selectedCategory === "banners" ? (
        <section className="store-category-section" id="banners">
          <SectionHeading
            title="Banners"
            body="Wide profile artwork for public profiles and community identity."
          />
          {renderStoreItems(banners, "No banners in this collection")}
        </section>
        ) : null}
        {selectedCategory === "cosmetics" ? (
        <section className="store-category-section" id="cosmetics">
          <SectionHeading
            title="Cosmetics"
            body="Frames, username details, gradients, and comment effects."
          />
          {renderStoreItems(
            standardCosmetics,
            "No cosmetics in this collection",
          )}
        </section>
        ) : null}
        {selectedCategory === "logo-effects" ? (
        <section className="store-category-section" id="logo-effects">
          <SectionHeading
            title="Logo Effects"
            body="Animated and seasonal treatments for your profile identity mark."
          />
          {renderStoreItems(
            logoEffects,
            "No logo effects in this collection",
          )}
        </section>
        ) : null}
      </section>
      ) : null}

      {selectedCategory === "coins" ? (
      <section className="content-section page-wrap" id="coin-packages">
        <SectionHeading
          title={`${commercial.economy.coinPlural} packages`}
          body={`Purchased and promotional ${commercial.economy.coinPlural} stay separate in your ledger.`}
        />
        {!checkoutEnabled ? (
          <div className="commerce-unavailable" role="status">
            <ShieldCheck size={19} />
            <span>
              <strong>Purchases are safely disabled.</strong>
              {checkoutStatus}
            </span>
          </div>
        ) : null}
        <div className="package-grid">
          {!storeLoading && !storeError && packages.length === 0 ? (
            <EmptyState
              title="No coin packages are available"
              body="Published coin packages will appear here."
              compact
            />
          ) : null}
          {packages.map((product) => {
            const totalCoins = product.baseCoins + product.bonusCoins;
            const unitValue =
              product.priceMinor > 0
                ? Math.round(totalCoins / (product.priceMinor / 100))
                : 0;
            return (
              <article
                key={product.id}
                className={[
                  product.featured ? "package-featured" : "",
                  `store-offer-theme-${product.themeKey.toLowerCase()}`,
                ].filter(Boolean).join(" ")}
              >
                {product.media.primary ? (
                  <img
                    className="store-offer-art"
                    src={product.media.primary}
                    alt={product.altText}
                  />
                ) : null}
                {product.promotionLabel ? (
                  <span className="package-label">
                    {product.promotionLabel}
                  </span>
                ) : null}
                <span className="configured-coin-icon" aria-hidden="true">
                  {product.media.icon ? (
                    <img src={product.media.icon} alt="" />
                  ) : (
                    <ConfiguredCoinMark settings={commercial} size={24} />
                  )}
                </span>
                <h2>{product.name}</h2>
                <p>
                  {product.baseCoins.toLocaleString("en-US")} base +{" "}
                  <strong>
                    {product.bonusCoins.toLocaleString("en-US")} bonus
                  </strong>
                </p>
                <div className="package-price">
                  {formatMoney(product.priceMinor, product.billingCurrency)}
                </div>
                <small>
                  {unitValue.toLocaleString("en-US")}{" "}
                  {commercial.economy.coinPlural} / {product.billingCurrency} 1
                  {product.discountPercent > 0
                    ? ` • ${product.discountPercent}% promotion`
                    : ""}{" "}
                  • Taxes may apply
                </small>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => buy(product.id)}
                  disabled={!checkoutEnabled || busy === product.id}
                >
                  {busy === product.id
                    ? "Preparing..."
                    : checkoutEnabled
                      ? product.ctaText
                      : "Coming soon"}
                </button>
              </article>
            );
          })}
        </div>
      </section>
      ) : null}

      {selectedCategory === "memberships" && memberships.length ? (
      <section className="membership-section" id="memberships">
        {!checkoutEnabled ? (
          <div className="commerce-unavailable page-wrap" role="status">
            <ShieldCheck size={19} />
            <span>
              <strong>Memberships are in preview.</strong>
              {checkoutStatus}
            </span>
          </div>
        ) : null}
        <div className="page-wrap membership-layout membership-layout-multiple">
          <div className="membership-copy">
            <CrownSimple size={34} weight="fill" />
            <h2>Memberships for every reading rhythm.</h2>
            <p>
              Compare every active offer, its recurring {commercial.economy.coinName} allowance, and
              chapter benefits before choosing.
            </p>
            <div className="billing-toggle" aria-label="Billing period">
              <button type="button" aria-pressed={billing === "monthly"} onClick={() => setBilling("monthly")}>Monthly</button>
              <button type="button" aria-pressed={billing === "annual"} onClick={() => setBilling("annual")}>
                Annual
              </button>
            </div>
          </div>
          <div className="membership-card-grid">
          {sortedMemberships.map((membership) => (
          <article
            className={`membership-card store-offer-theme-${membership.themeKey.toLowerCase()}`}
            key={membership.id}
          >
            {membership.media.primary ? (
              <img
                className="store-offer-art"
                src={membership.media.primary}
                alt={membership.altText}
              />
            ) : null}
            <div>
              <span>{membership.name}</span>
              {membership.promotionLabel ? (
                <em>{membership.promotionLabel}</em>
              ) : null}
              <strong>
                {formatMoney(
                  billing === "monthly"
                    ? membership.monthlyPriceMinor
                    : membership.annualPriceMinor,
                  membership.billingCurrency,
                )}{" "}
                <small>/ {billing === "monthly" ? "month" : "year"}</small>
              </strong>
            </div>
            <ul>
              {membership.monthlyCoins > 0 ? (
                <li>
                  <Check size={18} />{" "}
                  {coinLabel(membership.monthlyCoins, commercial)} each month
                </li>
              ) : null}
              {membership.benefits.map((benefit) => (
                <li key={benefit}>
                  <Check size={18} /> {benefit}
                </li>
              ))}
              {commercial.economy.membershipDiscountsEnabled &&
              membership.chapterDiscountPercent > 0 ? (
                <li>
                  <Check size={18} /> {membership.chapterDiscountPercent}%
                  chapter discount
                </li>
              ) : null}
            </ul>
            <button className="button button-primary" type="button" onClick={() => buy(membership.id)} disabled={!checkoutEnabled || busy !== null}>
              {checkoutEnabled ? membership.ctaText : "Coming soon"}
            </button>
            <small>Benefits are active only while the membership is current.</small>
          </article>
          ))}
          </div>
        </div>
      </section>
      ) : null}

      {selectedCategory === "memberships" &&
      !storeLoading &&
      !storeError &&
      memberships.length === 0 ? (
        <section className="content-section page-wrap">
          <EmptyState
            title="No memberships are available"
            body="Published membership offers will appear here."
          />
        </section>
      ) : null}

    </main>
  );
}

type DiscussionComment = {
  id: string;
  parentId: string | null;
  body: string;
  spoiler: number | boolean;
  moderationStatus: "VISIBLE" | "DELETED";
  createdAt: string;
  updatedAt: string;
  displayName: string;
  role: string;
  reactionCount: number;
  reactedByViewer: number | boolean;
  ownedByViewer: number | boolean;
};

function discussionRoleLabel(role: string) {
  return {
    ADMINISTRATOR: "Admin",
    TEAM_LEADER: "Team leader",
    UPLOADER: "Uploader",
    USER: "Reader",
  }[role] ?? "Reader";
}

function discussionDate(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function LegacyDiscussionSection({
  actor,
  seriesSlug,
  chapterSlug = null,
  showToast,
}: {
  actor: Actor | null;
  seriesSlug: string;
  chapterSlug?: string | null;
  showToast: (text: string) => void;
}) {
  const [comments, setComments] = useState<DiscussionComment[]>([]);
  const [count, setCount] = useState(0);
  const [sort, setSort] = useState<"top" | "newest">("top");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [body, setBody] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(
    new Set(),
  );
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(
    new Set(),
  );
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("Spoilers without a warning");
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scopeLabel = chapterSlug ? "Chapter comments" : "Discussion";

  useEffect(() => {
    const controller = new AbortController();
    async function loadComments() {
      setLoading(true);
      setLoadError("");
      const query = new URLSearchParams({ series: seriesSlug, sort });
      if (chapterSlug) query.set("chapter", chapterSlug);
      try {
        const response = await fetch(
          `/api/v1/discussion-comments?${query.toString()}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as {
          data?: DiscussionComment[];
          count?: number;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Comments could not be loaded.",
          );
        }
        setComments(payload.data ?? []);
        setCount(Number(payload.count ?? 0));
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Comments could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadComments();
    return () => controller.abort();
  }, [chapterSlug, refreshKey, seriesSlug, sort]);

  const rootComments = comments.filter((comment) => !comment.parentId);
  const repliesByParent = useMemo(() => {
    const grouped = new Map<string, DiscussionComment[]>();
    for (const comment of comments) {
      if (!comment.parentId) continue;
      grouped.set(comment.parentId, [
        ...(grouped.get(comment.parentId) ?? []),
        comment,
      ]);
    }
    return grouped;
  }, [comments]);

  function signInToComment() {
    const returnTo = chapterSlug
      ? `/title/${seriesSlug}/chapter/${chapterSlug}#comments`
      : `/title/${seriesSlug}#comments`;
    window.location.assign(authEntryPath("login", returnTo));
  }

  function startReply(comment: DiscussionComment) {
    if (!actor) {
      signInToComment();
      return;
    }
    setReplyTo({ id: comment.id, name: comment.displayName });
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function submitComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actor) {
      signInToComment();
      return;
    }
    const nextBody = body.trim();
    if (nextBody.length < 2) {
      showToast("Write at least two characters.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/v1/discussion-comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesSlug,
          chapterSlug,
          parentId: replyTo?.id ?? null,
          body: nextBody,
          spoiler,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Comment could not be posted.");
      }
      setBody("");
      setSpoiler(false);
      setReplyTo(null);
      setRefreshKey((value) => value + 1);
      showToast(replyTo ? "Reply posted." : "Comment posted.");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Comment could not be posted.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleReaction(comment: DiscussionComment) {
    if (!actor) {
      signInToComment();
      return;
    }
    const wasReacted = Boolean(comment.reactedByViewer);
    setComments((current) =>
      current.map((entry) =>
        entry.id === comment.id
          ? {
              ...entry,
              reactedByViewer: !wasReacted,
              reactionCount: Math.max(
                0,
                Number(entry.reactionCount) + (wasReacted ? -1 : 1),
              ),
            }
          : entry,
      ),
    );
    try {
      const response = await fetch("/api/v1/discussion-reactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commentId: comment.id }),
      });
      const payload = (await response.json()) as {
        reacted?: boolean;
        reactionCount?: number;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Reaction could not be saved.");
      }
      setComments((current) =>
        current.map((entry) =>
          entry.id === comment.id
            ? {
                ...entry,
                reactedByViewer: Boolean(payload.reacted),
                reactionCount: Number(payload.reactionCount ?? 0),
              }
            : entry,
        ),
      );
    } catch (error) {
      setComments((current) =>
        current.map((entry) =>
          entry.id === comment.id
            ? {
                ...entry,
                reactedByViewer: wasReacted,
                reactionCount: Number(comment.reactionCount),
              }
            : entry,
        ),
      );
      showToast(
        error instanceof Error ? error.message : "Reaction could not be saved.",
      );
    }
  }

  async function reportComment(commentId: string) {
    if (!actor) {
      signInToComment();
      return;
    }
    try {
      const response = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetType: "COMMENT",
          targetId: commentId,
          category: reportReason,
          detail: `Reader report from the ${chapterSlug ? "chapter" : "series"} discussion: ${reportReason}.`,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Report could not be sent.");
      }
      setReportedIds((current) => new Set(current).add(commentId));
      setReportingId(null);
      showToast("Report sent for moderator review.");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Report could not be sent.",
      );
    }
  }

  async function removeComment(commentId: string) {
    try {
      const response = await fetch(
        `/api/v1/discussion-comments?id=${encodeURIComponent(commentId)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Comment could not be removed.");
      }
      setDeletingId(null);
      setRefreshKey((value) => value + 1);
      showToast("Comment removed.");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Comment could not be removed.",
      );
    }
  }

  function renderComment(comment: DiscussionComment, isReply = false) {
    const removed = comment.moderationStatus === "DELETED";
    const hiddenSpoiler =
      Boolean(comment.spoiler) && !revealedSpoilers.has(comment.id);
    const replies = isReply ? [] : repliesByParent.get(comment.id) ?? [];
    const repliesExpanded = expandedReplies.has(comment.id);
    const visibleReplies = repliesExpanded ? replies : replies.slice(0, 1);

    return (
      <article
        className={`comment-item ${isReply ? "comment-item-reply" : ""}`}
        key={comment.id}
      >
        <div className="comment-avatar" aria-hidden="true">
          {comment.displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="comment-content">
          <header className="comment-meta">
            <div>
              <strong>{comment.displayName}</strong>
              <span className={`comment-role comment-role-${comment.role.toLowerCase()}`}>
                {discussionRoleLabel(comment.role)}
              </span>
            </div>
            <time dateTime={comment.createdAt}>
              {discussionDate(comment.createdAt)}
            </time>
          </header>

          {removed ? (
            <p className="comment-removed">Comment removed by its author.</p>
          ) : hiddenSpoiler ? (
            <button
              className="spoiler-cover"
              type="button"
              onClick={() =>
                setRevealedSpoilers((current) =>
                  new Set(current).add(comment.id),
                )
              }
            >
              <Eye size={17} />
              Spoiler hidden. Tap to reveal.
            </button>
          ) : (
            <p className="comment-body">{comment.body}</p>
          )}

          {!removed ? (
            <div className="comment-actions">
              <button
                type="button"
                aria-pressed={Boolean(comment.reactedByViewer)}
                onClick={() => void toggleReaction(comment)}
              >
                <Heart
                  size={16}
                  weight={comment.reactedByViewer ? "fill" : "regular"}
                />
                Like
                {Number(comment.reactionCount) > 0
                  ? ` ${Number(comment.reactionCount)}`
                  : ""}
              </button>
              {!isReply ? (
                <button type="button" onClick={() => startReply(comment)}>
                  <ChatCircle size={16} />
                  Reply
                </button>
              ) : null}
              {reportedIds.has(comment.id) ? (
                <span>Reported</span>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setReportingId((current) =>
                      current === comment.id ? null : comment.id,
                    )
                  }
                >
                  <WarningCircle size={16} />
                  Report
                </button>
              )}
              {Boolean(comment.ownedByViewer) ||
              actor && ["OWNER", "ADMINISTRATOR", "MODERATOR"].includes(actor.role) ? (
                <button
                  className="comment-delete"
                  type="button"
                  onClick={() =>
                    setDeletingId((current) =>
                      current === comment.id ? null : comment.id,
                    )
                  }
                >
                  <Trash size={16} />
                  Remove
                </button>
              ) : null}
            </div>
          ) : null}

          {reportingId === comment.id ? (
            <div className="comment-inline-action">
              <label>
                <span>Reason</span>
                <select
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value)}
                >
                  <option>Spoilers without a warning</option>
                  <option>Harassment or hate</option>
                  <option>Spam or promotion</option>
                  <option>Illegal content</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => void reportComment(comment.id)}
              >
                Send report
              </button>
              <button type="button" onClick={() => setReportingId(null)}>
                Cancel
              </button>
            </div>
          ) : null}

          {deletingId === comment.id ? (
            <div className="comment-inline-action comment-remove-confirm">
              <span>Remove this comment?</span>
              <button
                type="button"
                onClick={() => void removeComment(comment.id)}
              >
                Remove
              </button>
              <button type="button" onClick={() => setDeletingId(null)}>
                Keep it
              </button>
            </div>
          ) : null}

          {visibleReplies.length > 0 ? (
            <div className="comment-replies">
              {visibleReplies.map((reply) => renderComment(reply, true))}
            </div>
          ) : null}
          {replies.length > 1 && !repliesExpanded ? (
            <button
              className="show-replies"
              type="button"
              onClick={() =>
                setExpandedReplies((current) =>
                  new Set(current).add(comment.id),
                )
              }
            >
              Show {replies.length - 1} more{" "}
              {replies.length - 1 === 1 ? "reply" : "replies"}
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <section
      className={`series-comments ${chapterSlug ? "chapter-comments" : ""}`}
      id="comments"
      aria-labelledby="comments-title"
    >
      <header className="comments-header">
        <div>
          <p className="eyebrow">{count} comments</p>
          <h2 id="comments-title">{scopeLabel}</h2>
          <span>Talk about the story. Mark spoilers before posting.</span>
        </div>
        <div className="comment-sort" aria-label="Sort comments">
          <button
            type="button"
            aria-pressed={sort === "top"}
            onClick={() => setSort("top")}
          >
            Top
          </button>
          <button
            type="button"
            aria-pressed={sort === "newest"}
            onClick={() => setSort("newest")}
          >
            Newest
          </button>
        </div>
      </header>

      {actor ? (
        <form className="comment-composer" onSubmit={submitComment}>
          <div className="comment-composer-heading">
            <div className="comment-avatar" aria-hidden="true">
              {actor.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>Join the discussion</strong>
              <span>Posting as {actor.displayName}</span>
            </div>
          </div>
          {replyTo ? (
            <div className="replying-to">
              Replying to {replyTo.name}
              <button type="button" onClick={() => setReplyTo(null)}>
                Cancel reply
              </button>
            </div>
          ) : null}
          <label className="comment-field">
            <span className="sr-only">Comment</span>
            <textarea
              ref={composerRef}
              value={body}
              maxLength={1500}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                replyTo
                  ? `Reply to ${replyTo.name}`
                  : chapterSlug
                    ? "What did you think of this chapter?"
                    : "Share a theory, reaction, or recommendation"
              }
            />
          </label>
          <div className="comment-composer-actions">
            <label>
              <input
                type="checkbox"
                checked={spoiler}
                onChange={(event) => setSpoiler(event.target.checked)}
              />
              Contains spoilers
            </label>
            <span>{body.length} / 1500</span>
            <button
              className="button button-primary"
              type="submit"
              disabled={submitting || body.trim().length < 2}
            >
              {submitting ? "Posting..." : replyTo ? "Post reply" : "Post comment"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      ) : (
        <div className="comment-signin">
          <ChatCircle size={27} />
          <div>
            <strong>Sign in to join the discussion</strong>
            <span>Your reading identity stays attached to your comments.</span>
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={signInToComment}
          >
            Sign in
          </button>
        </div>
      )}

      {loading ? (
        <div className="comment-loading" role="status">
          <span />
          <span />
          <span />
        </div>
      ) : loadError ? (
        <div className="comment-error" role="alert">
          <WarningCircle size={21} />
          <div>
            <strong>Comments are temporarily unavailable</strong>
            <span>{loadError}</span>
          </div>
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : rootComments.length > 0 ? (
        <div className="comment-list">{rootComments.map((comment) => renderComment(comment))}</div>
      ) : (
        <div className="comment-empty">
          <ChatCircle size={30} />
          <strong>Start the discussion</strong>
          <span>Be the first reader to leave a comment on this story.</span>
        </div>
      )}
    </section>
  );
}

type SeriesChapterAccess = {
  chapterId: string;
  teamId: string | null;
  teamSlug?: string | null;
  chapterSlug: string;
  chapterNumber: string;
  chapterLabel: string;
  language: string;
  version: number;
  teamName: string | null;
  uploaderUserId?: string | null;
  uploaderName?: string | null;
  uploaderUsername?: string | null;
  thumbnailUrl?: string | null;
  publishedAt: string | null;
  isFresh?: boolean;
  isRead?: boolean;
  accessType: "FREE" | "PAID";
  priceOnyx: number;
  canRead: boolean;
  reason:
    | "FREE"
    | "UNLOCKED"
    | "ADMINISTRATOR_PREVIEW"
    | "SIGN_IN_REQUIRED"
    | "PURCHASE_REQUIRED"
    | "UNAVAILABLE";
};

function chapterDisplayNumber(chapter: SeriesChapterAccess) {
  const fallback = chapter.chapterLabel
    .replace(/^(Chapter|Episode|Issue|Preview)\s*/i, "")
    .trim()
    .match(/^\S+/)?.[0];
  return normalizeChapterNumber(chapter.chapterNumber || fallback || "");
}

function chapterDisplayLabel(chapter: SeriesChapterAccess) {
  const number = chapterDisplayNumber(chapter);
  const withoutPrefix = chapter.chapterLabel
    .replace(/^(Chapter|Episode|Issue|Preview)\s*/i, "")
    .trim();
  const sourceNumber = withoutPrefix.match(/^\S+/)?.[0] ?? "";
  const title = withoutPrefix
    .slice(sourceNumber.length)
    .replace(/^\s*[·:-]\s*/, "")
    .trim();
  return `Chapter ${number}${title ? ` · ${title}` : ""}`;
}

function chapterLanguageCounts(releases: SeriesChapterAccess[]) {
  const counts = releases.reduce((languages, release) => {
    const language = release.language.toLowerCase();
    languages.set(language, (languages.get(language) ?? 0) + 1);
    return languages;
  }, new Map<string, number>());
  return [...counts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((left, right) => left.language.localeCompare(right.language));
}

function representativeChapterThumbnail(
  chapterNumber: string,
  releases: SeriesChapterAccess[],
) {
  const thumbnails = releases
    .map((release) => release.thumbnailUrl)
    .filter((url): url is string => Boolean(url));
  if (!thumbnails.length) return null;
  const seed = [...chapterNumber].reduce(
    (total, character) => total + character.charCodeAt(0),
    releases.length,
  );
  return thumbnails[seed % thumbnails.length] ?? thumbnails[0]!;
}

type PublicSeriesDetail = {
  id: string;
  slug: string;
  title: string;
  alternativeTitles: Array<{ title: string; language: string }>;
  synopsis: string;
  type: "MANGA" | "MANHWA" | "MANHUA";
  status: "ONGOING" | "COMPLETED" | "HIATUS" | "PAUSED" | "UPCOMING";
  publicationYear: number | null;
  authors: Array<{ id: string; name: string }>;
  artists: Array<{ id: string; name: string }>;
  publisher: { id: string; name: string } | null;
  countryCode: string;
  languageCode: string;
  readingDirection: string;
  genres: Array<{ id: string; name: string }>;
  teams: Array<{
    id: string;
    name: string;
    slug: string;
    isPrimary: number | boolean;
  }>;
  accessType: "FREE" | "PAID";
  rating: number;
  followerCount: number;
  viewCount: number;
  coverUrl: string | null;
  bannerUrl: string | null;
  chapters: Array<{ chapterNumber: string }>;
};

function publicDetailCard(detail: PublicSeriesDetail): SeriesCard {
  const primaryTeam =
    detail.teams.find((team) => Boolean(team.isPrimary)) ?? detail.teams[0];
  const regionNames =
    typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames(["en"], { type: "region" })
      : null;
  const languageNames =
    typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames(["en"], { type: "language" })
      : null;
  const teamName = primaryTeam?.name ?? "Independent release";
  return {
    id: detail.id,
    slug: detail.slug,
    title: detail.title,
    subtitle:
      detail.alternativeTitles[0]?.title ??
      detail.publisher?.name ??
      "Published on NyaScans",
    type:
      detail.type === "MANHWA"
        ? "Manhwa"
        : detail.type === "MANHUA"
          ? "Manhua"
          : "Manga",
    status:
      detail.status === "COMPLETED"
        ? "Completed"
        : detail.status === "HIATUS"
          ? "Hiatus"
        : detail.status === "PAUSED"
          ? "Paused"
        : detail.status === "UPCOMING"
          ? "Upcoming"
          : "Ongoing",
    access: detail.accessType,
    rating: detail.rating,
    followers: String(detail.followerCount),
    chapter: `${new Set(detail.chapters.map((chapter) => normalizeChapterNumber(chapter.chapterNumber))).size} chapters`,
    updated: "Recently",
    cover: detail.coverUrl ?? "/art/series-cover-placeholder.svg",
    accent: "#2d8cff",
    genres: detail.genres.map((genre) => genre.name),
    direction:
      detail.readingDirection === "VERTICAL"
        ? "VERTICAL"
        : detail.readingDirection === "LEFT_TO_RIGHT"
          ? "LTR"
          : "RTL",
    synopsis: detail.synopsis,
    originalTitle: detail.alternativeTitles[0]?.title ?? "",
    creator:
      [...detail.authors, ...detail.artists]
        .map((creator) => creator.name)
        .filter((name, index, names) => names.indexOf(name) === index)
        .join(", ") || "Not credited",
    originalLanguage:
      languageNames?.of(detail.languageCode) ?? detail.languageCode,
    originCountry: regionNames?.of(detail.countryCode) ?? detail.countryCode,
    releaseYear: detail.publicationYear,
    chapterCount: new Set(
      detail.chapters.map((chapter) =>
        normalizeChapterNumber(chapter.chapterNumber),
      ),
    ).size,
    team: {
      name: teamName,
      slug: primaryTeam?.slug ?? "",
      initials: teamName
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
    },
  };
}

function TitleView({
  slug,
  actor,
  showToast,
}: {
  slug?: string;
  actor: Actor | null;
  showToast: (text: string) => void;
}) {
  const { settings: commercial } = useCommercialSettings();
  const premiumEconomyPublic = commercial.economy.premiumEconomyPublic;
  const [fetchedPublicDetail, setPublicDetail] = useState<PublicSeriesDetail | null>(
    null,
  );
  const [loadedDetailSlug, setLoadedDetailSlug] = useState("");
  const publicDetail =
    fetchedPublicDetail?.slug === slug ? fetchedPublicDetail : null;
  const detailLoading = Boolean(slug) && loadedDetailSlug !== slug;
  const item = useMemo(
    () =>
      publicDetail
        ? publicDetailCard(publicDetail)
        : demoSeries[0],
    [publicDetail],
  );
  const available = Boolean(publicDetail);
  const [followed, setFollowed] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [liveFollowerCount, setLiveFollowerCount] = useState<number | null>(
    null,
  );
  const [chapterQuery, setChapterQuery] = useState("");
  const [chapterOrder, setChapterOrder] = useState<"newest" | "oldest">("newest");
  const [seriesReleaseLanguage, setSeriesReleaseLanguage] = useState("");
  const [collapsedChapterNumbers, setCollapsedChapterNumbers] = useState<
    Set<string>
  >(new Set());
  const [chapterPolicies, setChapterPolicies] = useState<
    SeriesChapterAccess[]
  >([]);
  const [canUploadChapter, setCanUploadChapter] = useState(false);
  const [uploadChooserOpen, setUploadChooserOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [seriesMetrics, setSeriesMetrics] = useState<CatalogResult | null>(
    null,
  );
  const reportTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!uploadChooserOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setUploadChooserOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [uploadChooserOpen]);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    void fetch(`/api/v1/series-detail?slug=${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: PublicSeriesDetail;
        };
        if (response.ok && payload.data) setPublicDetail(payload.data);
      })
      .catch(() => {
        // The rights-safe catalogue fallback remains available during recovery.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedDetailSlug(slug);
      });
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    void fetch(
      `/api/v1/chapter-access-list?series=${encodeURIComponent(item.slug)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: SeriesChapterAccess[];
          permissions?: { canUploadChapter?: boolean };
        };
        if (response.ok && payload.data) {
          setChapterPolicies(payload.data);
          setCanUploadChapter(Boolean(payload.permissions?.canUploadChapter));
        }
      })
      .catch(() => {
        setChapterPolicies([]);
        setCanUploadChapter(false);
      });
    return () => controller.abort();
  }, [available, item.slug]);
  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    void fetch(
      `/api/v1/catalog?q=${encodeURIComponent(item.title)}&page=1&pageSize=6&sort=latest`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: CatalogResult[];
        };
        if (!response.ok) return;
        setSeriesMetrics(
          payload.data?.find((record) => record.slug === item.slug) ?? null,
        );
      })
      .catch(() => {
        // The title remains readable while database statistics recover.
      });
    return () => controller.abort();
  }, [available, item.slug, item.title]);
  useEffect(() => {
    if (!available || !actor) return;
    const controller = new AbortController();
    void fetch(
      `/api/v1/series-follow?slug=${encodeURIComponent(item.slug)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          following?: boolean;
          followerCount?: number;
        };
        if (!response.ok) return;
        setFollowed(Boolean(payload.following));
        setLiveFollowerCount(Number(payload.followerCount ?? 0));
      })
      .catch(() => {
        // The persisted state is retried when the reader uses the control.
      });
    return () => controller.abort();
  }, [actor, available, item.slug]);
  const chapters = chapterPolicies
    .filter((chapter) =>
      (!seriesReleaseLanguage || chapter.language.toLowerCase() === seriesReleaseLanguage) &&
      `${chapter.chapterLabel} ${chapter.accessType} ${chapter.language} ${chapter.teamName ?? ""}`
        .toLowerCase()
        .includes(chapterQuery.toLowerCase()),
    )
    .sort((left, right) => {
      const numberOrder = compareChapterNumbers(
        chapterDisplayNumber(left),
        chapterDisplayNumber(right),
      );
      return numberOrder || left.version - right.version;
    });
  const chapterGroups = [...chapters.reduce((groups, chapter) => {
    const number = chapterDisplayNumber(chapter);
    groups.set(number, [...(groups.get(number) ?? []), chapter]);
    return groups;
  }, new Map<string, SeriesChapterAccess[]>()).entries()]
    .map(([number, releases]) => {
      const sortedReleases = releases.sort(
        (left, right) =>
          right.version - left.version ||
          String(right.publishedAt ?? "").localeCompare(
            String(left.publishedAt ?? ""),
          ),
      );
      return {
        number,
        releases: sortedReleases,
        languages: chapterLanguageCounts(sortedReleases),
        thumbnailUrl: representativeChapterThumbnail(number, sortedReleases),
      };
    })
    .sort((left, right) => compareChapterNumbers(left.number, right.number));
  const visibleChapterGroups =
    chapterOrder === "newest" ? [...chapterGroups].reverse() : chapterGroups;
  const allChapterDetailsCollapsed =
    visibleChapterGroups.length > 0 &&
    visibleChapterGroups.every(
      (group) =>
        collapsedChapterNumbers.has("*") ||
        collapsedChapterNumbers.has(group.number),
    );
  const allGroupsAscending = [
    ...chapterPolicies
      .reduce((groups, chapter) => {
        const number = chapterDisplayNumber(chapter);
        groups.set(number, [...(groups.get(number) ?? []), chapter]);
        return groups;
      }, new Map<string, SeriesChapterAccess[]>())
      .entries(),
  ]
    .map(([number, releases]) => ({
      number,
      releases: releases.sort(
        (left, right) =>
          right.version - left.version ||
          String(right.publishedAt ?? "").localeCompare(
            String(left.publishedAt ?? ""),
          ),
      ),
    }))
    .sort((left, right) => compareChapterNumbers(left.number, right.number));
  const latestChapter = allGroupsAscending.at(-1)?.releases[0] ?? null;
  const firstChapter = allGroupsAscending[0]?.releases[0] ?? null;
  const seriesReleaseLanguages = [...new Set(chapterPolicies.map((chapter) => chapter.language.toLowerCase()))].sort();

  function applyCollapsedChapters(next: Set<string>) {
    setCollapsedChapterNumbers(next);
  }

  function toggleChapterDetails() {
    applyCollapsedChapters(
      allChapterDetailsCollapsed ? new Set() : new Set(["*"]),
    );
  }

  function toggleChapterGroup(chapterNumber: string) {
    const next = collapsedChapterNumbers.has("*")
      ? new Set(
          chapterGroups
            .map((group) => group.number)
            .filter((number) => number !== chapterNumber),
        )
      : new Set(collapsedChapterNumbers);
    if (!collapsedChapterNumbers.has("*")) {
      if (next.has(chapterNumber)) next.delete(chapterNumber);
      else next.add(chapterNumber);
    }
    applyCollapsedChapters(next);
  }

  const closeSeriesReport = useCallback(() => {
    setReportDialogOpen(false);
    window.requestAnimationFrame(() => reportTriggerRef.current?.focus());
  }, []);

  async function shareSeries() {
    const shareData = {
      title: item.title,
      text: item.synopsis,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        showToast("Share sheet opened.");
      } else {
        await navigator.clipboard.writeText(window.location.href);
        showToast("Series link copied.");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        showToast("The series link could not be shared.");
      }
    }
  }

  async function toggleSeriesFollow() {
    if (!actor) {
      window.location.href = authEntryPath(
        "login",
        `/title/${item.slug}`,
      );
      return;
    }
    setFollowBusy(true);
    try {
      const response = await fetch("/api/v1/series-follow", {
        method: followed ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: item.slug }),
      });
      const payload = (await response.json()) as {
        following?: boolean;
        followerCount?: number;
        error?: { message?: string };
      };
      if (!response.ok || typeof payload.following !== "boolean") {
        throw new Error(
          payload.error?.message ?? "Following could not be updated.",
        );
      }
      setFollowed(payload.following);
      setLiveFollowerCount(Number(payload.followerCount ?? 0));
      setSeriesMetrics((current) =>
        current && typeof payload.followerCount === "number"
          ? { ...current, followerCount: payload.followerCount }
          : current,
      );
      showToast(
        payload.following
          ? "Series followed."
          : "Series unfollowed.",
      );
    } catch (followError) {
      showToast(
        followError instanceof Error
          ? followError.message
          : "Following could not be updated.",
      );
    } finally {
      setFollowBusy(false);
    }
  }

  if (detailLoading && !available) {
    return (
      <main className="page-main page-wrap">
        <div className="catalog-loading" role="status">
          Loading series details…
        </div>
      </main>
    );
  }

  if (!available) {
    return (
      <main className="page-main page-wrap">
        <EmptyState
          title="Series not found"
          body="This series is unavailable or has been removed from the published catalogue."
        />
      </main>
    );
  }

  const titleFollowerCount = Number(
    liveFollowerCount ??
      seriesMetrics?.followerCount ??
      publicDetail?.followerCount ??
      0,
  );

  return (
    <main className="title-page">
      <section className="title-hero">
        <div
          className="title-backdrop"
          style={{
            backgroundImage: `url(${publicDetail?.bannerUrl ?? item.cover})`,
          }}
        />
        <div className="page-wrap title-hero-inner">
          <ResilientCoverImage
            className="title-cover"
            src={item.cover}
            alt={`Cover art for ${item.title}`}
            width={360}
            height={540}
            loading="eager"
          />
          <div className="title-copy">
            <div className="title-badges">
              <SeriesTypeBadge type={item.type} />
              <span>{item.status}</span>
              <span>{item.direction}</span>
            </div>
            <h1>{item.title}</h1>
            <p className="title-subtitle" dir="auto">{item.originalTitle}</p>
            <p className="title-kicker">{item.subtitle}</p>
            <div className="title-stats">
              <span>
                <Star size={17} weight="fill" />{" "}
                {(Number(seriesMetrics?.ratingTenths ?? 0) / 10).toFixed(1)}
              </span>
              <span>
                <Eye size={17} />{" "}
                {Number(seriesMetrics?.viewCount ?? 0).toLocaleString("en-US")} views
              </span>
              <span
                aria-label={`${titleFollowerCount.toLocaleString("en-US")} followers`}
              >
                <Heart size={17} />{" "}
                {titleFollowerCount.toLocaleString("en-US")}
              </span>
            </div>
            <div className="tag-row">
              {item.genres.map((genre) => (
                <a key={genre} href={`/browse?genre=${genre}`}>{genre}</a>
              ))}
            </div>
            <div className="title-actions">
              <button
                className="button button-secondary series-secondary-action"
                type="button"
                aria-pressed={followed}
                aria-label={followed ? "Unfollow series" : "Follow series"}
                disabled={followBusy}
                onClick={() => void toggleSeriesFollow()}
              >
                <Heart size={22} weight={followed ? "fill" : "regular"} />
                {followBusy ? "Saving…" : followed ? "Following" : "Follow"}
              </button>
              <button
                className="button button-secondary series-secondary-action"
                type="button"
                aria-label="Share series"
                onClick={() => void shareSeries()}
              >
                <ArrowUpRight size={22} />
                Share
              </button>
            </div>
          </div>
        </div>
      </section>

      <nav className="series-jump page-wrap" aria-label="Series sections">
        <a href="#details">Details</a>
        <a href="#art">Art</a>
        <a href="#covers">Covers</a>
        <a href="#chapters">Chapters List</a>
        <a href="#reviews">Ratings & Reviews</a>
        <a href="#comments">Discussion</a>
      </nav>

      <section className="series-details page-wrap" id="details" aria-labelledby="details-title">
        <div className="series-details-copy">
          <p className="eyebrow">Details</p>
          <h2 id="details-title">About {item.title}</h2>
          <p>{item.synopsis}</p>
          <div className="tag-row">
            {item.genres.map((genre) => (
              <a key={genre} href={`/browse?genre=${encodeURIComponent(genre)}`}>
                {genre}
              </a>
            ))}
          </div>
        </div>
        <dl className="series-facts">
          <div><dt>Title type</dt><dd>{item.type}</dd></div>
          <div><dt>Title status</dt><dd>{item.status}</dd></div>
          <div>
            <dt>Author{(publicDetail?.authors.length ?? 0) === 1 ? "" : "s"}</dt>
            <dd>
              {publicDetail?.authors.map((author) => author.name).join(", ") ||
                item.creator}
            </dd>
          </div>
          {publicDetail?.artists.length ? (
            <div>
              <dt>Artist{publicDetail.artists.length === 1 ? "" : "s"}</dt>
              <dd>{publicDetail.artists.map((artist) => artist.name).join(", ")}</dd>
            </div>
          ) : null}
          {publicDetail?.publisher ? (
            <div><dt>Original publisher</dt><dd>{publicDetail.publisher.name}</dd></div>
          ) : null}
          <div><dt>Release year</dt><dd>{item.releaseYear ?? "Not specified"}</dd></div>
          <div><dt>Original language</dt><dd>{item.originalLanguage}</dd></div>
          <div><dt>Origin</dt><dd>{item.originCountry}</dd></div>
          <div><dt>Reading format</dt><dd>{item.direction}</dd></div>
          <div><dt>Total chapters</dt><dd>{item.chapterCount}</dd></div>
        </dl>
      </section>

      <div className="page-wrap">
        <SeriesGallerySections
          seriesSlug={item.slug}
          seriesTitle={item.title}
          showToast={showToast}
        />
      </div>

      <section className="title-content page-wrap">
        <div className="title-main">
          <section className="chapter-panel" id="chapters" aria-labelledby="chapters-title">
            <div className="chapter-heading">
              <div>
                <p className="eyebrow">Available translations</p>
                <h2 id="chapters-title">Chapters List</h2>
                <span>Choose a language and verified publishing team</span>
              </div>
              <div className="chapter-tools">
                <label className="chapter-sort">
                  <span className="sr-only">Sort chapters</span>
                  <select
                    value={chapterOrder}
                    onChange={(event) =>
                      setChapterOrder(event.target.value as "newest" | "oldest")
                    }
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                  </select>
                  <CaretDown size={15} />
                </label>
                <label className="chapter-search">
                  <MagnifyingGlass size={18} />
                  <span className="sr-only">Search chapters</span>
                  <input
                    value={chapterQuery}
                    onChange={(event) => setChapterQuery(event.target.value)}
                    placeholder="Search chapters"
                  />
                </label>
                <button
                  className="chapter-details-toggle"
                  type="button"
                  aria-pressed={allChapterDetailsCollapsed}
                  aria-controls="chapter-groups"
                  onClick={toggleChapterDetails}
                >
                  <List size={16} />
                  {allChapterDetailsCollapsed
                    ? "Show all details"
                    : "Hide all details"}
                </button>
              </div>
            </div>
            <div className="chapter-action-bar" aria-label="Chapter actions">
              {firstChapter ? (
                <a
                  className="button button-secondary"
                  href={`/title/${item.slug}/chapter/${firstChapter.chapterSlug}`}
                >
                  <Play size={16} /> <span className="desktop-action-label">Read First</span><span className="mobile-action-label">First</span>
                </a>
              ) : (
                <span
                  className="button button-secondary is-disabled"
                  aria-disabled="true"
                >
                  Read First
                </span>
              )}
              {latestChapter ? (
                <a
                  className="button button-primary"
                  href={`/title/${item.slug}/chapter/${latestChapter.chapterSlug}`}
                >
                  <Play size={16} weight="fill" /> <span className="desktop-action-label">Read Latest</span><span className="mobile-action-label">Latest</span>
                </a>
              ) : (
                <span
                  className="button button-primary is-disabled"
                  aria-disabled="true"
                >
                  Read Latest
                </span>
              )}
              <button
                className="button button-danger report-link"
                type="button"
                ref={reportTriggerRef}
                onClick={() => setReportDialogOpen(true)}
              >
                <WarningCircle size={17} /> <span className="desktop-action-label">Report title</span><span className="mobile-action-label">Report</span>
              </button>
              <details className="series-language-action">
                <summary className="button button-secondary">
                  <LanguageFlag language={seriesReleaseLanguage || seriesReleaseLanguages[0] || "en"} showCode={false} />
                  <span className="desktop-action-label">Language filter</span><span className="mobile-action-label">Language</span>
                </summary>
                <div>
                  <button
                    type="button"
                    aria-pressed={!seriesReleaseLanguage}
                    onClick={(event) => {
                      setSeriesReleaseLanguage("");
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                  >
                    All languages
                  </button>
                  {seriesReleaseLanguages.map((language) => (
                    <button
                      type="button"
                      key={language}
                      aria-pressed={seriesReleaseLanguage === language}
                      onClick={(event) => {
                        setSeriesReleaseLanguage(language);
                        event.currentTarget.closest("details")?.removeAttribute("open");
                      }}
                    >
                      <LanguageFlag language={language} showCode={false} /> {languageName(language)}
                    </button>
                  ))}
                </div>
              </details>
              {canUploadChapter ? (
                <button
                  type="button"
                  className="button button-secondary chapter-upload-action"
                  aria-haspopup="dialog"
                  aria-expanded={uploadChooserOpen}
                  onClick={() => setUploadChooserOpen(true)}
                >
                  <CloudArrowUp size={17} /> Upload Chapter
                </button>
              ) : null}
            </div>
            {uploadChooserOpen ? (
              <div className="v46-upload-chooser-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setUploadChooserOpen(false); }}>
                <section className="v46-upload-chooser" role="dialog" aria-modal="true" aria-labelledby="upload-choice-title">
                  <header><div><small>Upload center</small><h2 id="upload-choice-title">Choose an upload workflow</h2><p>Use a focused single-chapter studio or prepare several chapters together.</p></div><button type="button" aria-label="Close upload choices" onClick={() => setUploadChooserOpen(false)}><X size={20} /></button></header>
                  <div>
                    <a href={`/upload-chapter/single?series=${encodeURIComponent(publicDetail?.id ?? item.id)}`}><FileText size={25} /><span><strong>Single upload</strong><small>One chapter · images, ZIP, or Google Drive</small></span><ArrowRight /></a>
                    <a href={`/upload-chapter/multi?series=${encodeURIComponent(publicDetail?.id ?? item.id)}`}><Books size={25} /><span><strong>Multi upload</strong><small>Several chapter folders or archives</small></span><ArrowRight /></a>
                  </div>
                </section>
              </div>
            ) : null}
            <div
              className={`chapter-group-list ${
                allChapterDetailsCollapsed ? "is-compact" : "is-detailed"
              }`}
              id="chapter-groups"
            >
              {visibleChapterGroups.length > 0 ? (
                visibleChapterGroups.map((group) => {
                  const detailsCollapsed =
                    collapsedChapterNumbers.has("*") ||
                    collapsedChapterNumbers.has(group.number);
                  const disclosureId = `chapter-versions-${encodeURIComponent(
                    group.number,
                  )}`;
                  const groupLocked =
                    group.releases.length > 0 &&
                    group.releases.every(
                      (release) =>
                        release.accessType === "PAID" && !release.canRead,
                    );
                  return !detailsCollapsed ? (
                    <section
                      className="chapter-release-group"
                      key={group.number}
                    >
                      <header>
                        <div>
                          <strong>
                            {groupLocked ? <LockSimple size={15} aria-label="Paid chapter" /> : null}
                            Chapter {group.number}
                            <Eye size={15} weight={group.releases.some((release) => release.isRead) ? "fill" : "regular"} aria-label={group.releases.some((release) => release.isRead) ? "Viewed" : "Not viewed"} />
                          </strong>
                          <span
                            className="chapter-language-counts"
                            aria-label={`${group.releases.length} available translation ${
                              group.releases.length === 1 ? "version" : "versions"
                            }`}
                          >
                            {group.languages.map(({ language, count }) => (
                              <span key={language}>
                                <LanguageFlag
                                  language={language}
                                  showCode={false}
                                />
                                <b>{count}</b>
                              </span>
                            ))}
                          </span>
                        </div>
                        <button
                          className="chapter-group-toggle"
                          type="button"
                          aria-label={`Hide translation details for chapter ${group.number}`}
                          aria-expanded="true"
                          aria-controls={disclosureId}
                          onClick={() => toggleChapterGroup(group.number)}
                        >
                          <CaretDown size={18} aria-hidden="true" />
                        </button>
                      </header>
                      <div
                        className="chapter-variant-list"
                        id={disclosureId}
                      >
                        {group.releases.map((chapter) => {
                          const access =
                            chapter.accessType === "FREE"
                              ? "Free"
                              : "Paid";
                          const chapterHref = `/title/${item.slug}/chapter/${chapter.chapterSlug}`;
                          return (
                            <article
                              className="chapter-variant-row"
                              key={`${chapter.chapterId}:${chapter.version}:${chapter.language}`}
                            >
                              <a
                                className="chapter-variant-visual"
                                href={chapterHref}
                                aria-label={`Read ${chapterDisplayLabel(chapter)}`}
                              >
                                {chapter.thumbnailUrl ? (
                                  <img
                                    className="chapter-thumbnail"
                                    src={chapter.thumbnailUrl}
                                    alt=""
                                    loading="lazy"
                                  />
                                ) : (
                                  <ImageIcon size={21} aria-hidden="true" />
                                )}
                              </a>
                              <span className="chapter-variant-copy">
                                <a
                                  className="chapter-variant-title"
                                  href={chapterHref}
                                >
                                  <LanguageFlag
                                    language={chapter.language}
                                    showCode={false}
                                  />
                                  <span>{chapterDisplayLabel(chapter)}</span>
                                  <FreshChapterMark fresh={chapter.isFresh} />
                                </a>
                                <small>
                                  <span className="chapter-credit-chip chapter-variant-uploader">
                                    <span>Uploader</span>
                                    {chapter.uploaderUsername ? (
                                      <a
                                        href={`/u/${encodeURIComponent(chapter.uploaderUsername)}`}
                                      >
                                        {chapter.uploaderName ??
                                          chapter.uploaderUsername}
                                      </a>
                                    ) : (
                                      chapter.uploaderName ?? "NyaScans member"
                                    )}
                                  </span>
                                  <span className="chapter-credit-chip">
                                    <span>Team</span>
                                    {chapter.teamSlug ? (
                                      <a
                                        href={`/team/${encodeURIComponent(chapter.teamSlug)}`}
                                      >
                                        {chapter.teamName ??
                                          "Publishing team"}
                                      </a>
                                    ) : (
                                      chapter.teamName ?? "Independent release"
                                    )}
                                  </span>
                                  <time
                                    dateTime={chapter.publishedAt ?? undefined}
                                  >
                                    {chapter.publishedAt
                                      ? `${releaseTime(chapter.publishedAt)} ago`
                                      : "Publication pending"}
                                  </time>
                                  {chapter.version > 1 ? (
                                    <span>v{chapter.version}</span>
                                  ) : null}
                                </small>
                              </span>
                              <span
                                className={`chapter-access chapter-access-${access.toLowerCase().replaceAll(" ", "-")}`}
                              >
                                {access === "Free" ? (
                                  <Check size={14} />
                                ) : (
                                  <LockSimple size={14} />
                                )}
                                {access}
                                {premiumEconomyPublic &&
                                chapter.priceOnyx > 0 &&
                                access === "Paid"
                                  ? ` · ${coinLabel(chapter.priceOnyx, commercial)}`
                                  : ""}
                              </span>
                              <a className="chapter-read" href={chapterHref}>
                                {chapter.chapterId === latestChapter?.chapterId
                                  ? "Read latest"
                                  : "Read"}{" "}
                                <ArrowRight size={16} />
                              </a>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ) : (
                    <section
                      className="chapter-release-group chapter-release-compact"
                      key={group.number}
                    >
                      <button
                        type="button"
                        aria-label={`Show ${group.releases.length} translation versions for chapter ${group.number}`}
                        aria-expanded="false"
                        aria-controls={disclosureId}
                        onClick={() => toggleChapterGroup(group.number)}
                      >
                        <span className="chapter-compact-thumbnail">
                          {group.thumbnailUrl ? (
                            <img
                              src={group.thumbnailUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <ImageIcon size={24} aria-hidden="true" />
                          )}
                        </span>
                        <span className="chapter-compact-copy">
                          <strong>
                            {groupLocked ? (
                              <LockSimple
                                className="chapter-compact-lock"
                                size={15}
                                aria-label="Paid chapter"
                              />
                            ) : null}
                            Chapter {group.number}
                            <Eye size={15} weight={group.releases.some((release) => release.isRead) ? "fill" : "regular"} aria-label={group.releases.some((release) => release.isRead) ? "Viewed" : "Not viewed"} />
                          </strong>
                        </span>
                        <span className="chapter-language-counts">
                          {group.languages.map(({ language, count }) => (
                            <span key={language}>
                              <LanguageFlag
                                language={language}
                                showCode={false}
                              />
                              <b>{count}</b>
                            </span>
                          ))}
                        </span>
                        <CaretDown size={18} aria-hidden="true" />
                      </button>
                      <div id={disclosureId} hidden />
                    </section>
                  );
                })
              ) : (
                <div className="chapter-empty">
                  <MagnifyingGlass size={24} />
                  <strong>No chapters found</strong>
                  <span>Try a different chapter number or access type.</span>
                  <button type="button" onClick={() => setChapterQuery("")}>Clear search</button>
                </div>
              )}
            </div>
          </section>

          <SeriesReviews
            actor={actor}
            seriesSlug={item.slug}
            showToast={showToast}
          />
          <EnhancedDiscussionSection
            actor={actor}
            seriesSlug={item.slug}
            showToast={showToast}
          />
          <SeriesRecommendations seriesSlug={item.slug} />
        </div>
      </section>
      {reportDialogOpen ? (
        <SeriesReportDialog
          seriesId={publicDetail?.id ?? item.id}
          seriesTitle={item.title}
          signedIn={Boolean(actor)}
          onClose={closeSeriesReport}
          onSignIn={() => {
            window.location.href = authEntryPath(
              "login",
              `/title/${item.slug}#chapters`,
            );
          }}
          showToast={showToast}
        />
      ) : null}
    </main>
  );
}

type ChapterAccessData = {
  chapterId: string;
  seriesSlug: string;
  chapterSlug: string;
  chapterLabel: string;
  accessType: "FREE" | "PAID";
  priceOnyx: number;
  canRead: boolean;
  isUnlocked: boolean;
  administratorPreview: boolean;
  reason:
    | "FREE"
    | "UNLOCKED"
    | "ADMINISTRATOR_PREVIEW"
    | "SIGN_IN_REQUIRED"
    | "PURCHASE_REQUIRED"
    | "UNAVAILABLE";
};

type ReaderPageData = {
  id: string;
  pageIndex: number;
  displayIndex?: number;
  contentPageIndex?: number | null;
  kind?: "CONTENT" | "FIXED_FIRST" | "FIXED_LAST";
  width: number;
  height: number;
  url: string;
};

type ReaderContextData = {
  series: {
    slug: string;
    title: string;
    cover: string | null;
    readingDirection: string;
    teamName: string;
  };
  chapter: {
    id: string;
    teamId: string | null;
    slug: string;
    number: string;
    title: string;
    label: string;
    language: string;
    version: number;
    publishedAt: string | null;
    commentsEnabled: boolean;
  };
  previousChapter: {
    slug: string;
    number: string;
    title: string;
  } | null;
  nextChapter: {
    slug: string;
    number: string;
    title: string;
  } | null;
  previousAlternatives: Array<
    ChapterAccessData & {
      teamId: string | null;
      chapterNumber: string;
      chapterLabel: string;
      language: string;
      version: number;
      teamName: string | null;
      title: string;
    }
  >;
  nextAlternatives: Array<
    ChapterAccessData & {
      teamId: string | null;
      chapterNumber: string;
      chapterLabel: string;
      language: string;
      version: number;
      teamName: string | null;
      title: string;
    }
  >;
  previousFallbackReason:
    | "TEAM_UNAVAILABLE"
    | "LANGUAGE_UNAVAILABLE"
    | "TEAM_AND_LANGUAGE_UNAVAILABLE"
    | null;
  nextFallbackReason:
    | "TEAM_UNAVAILABLE"
    | "LANGUAGE_UNAVAILABLE"
    | "TEAM_AND_LANGUAGE_UNAVAILABLE"
    | null;
  nextFallbackRequired: boolean;
  chapterManagementHref: string | null;
  access: ChapterAccessData;
};

type ChapterReaction = {
  id: string;
  name: string;
  accessibleLabel: string;
  emojiFallback: string;
  imageUrl: string | null;
  count: number;
  selected: boolean;
};

async function fetchReaderResource<T>(
  url: string,
  signal: AbortSignal,
  attempts = 3,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal,
        cache: "no-store",
      });
      const payload = (await response.json()) as T & {
        error?: { message?: string };
      };
      if (!response.ok) {
        const message =
          payload.error?.message ?? "The reader request could not be completed.";
        if (response.status < 500 || attempt === attempts - 1) {
          throw new Error(message);
        }
        lastError = new Error(message);
      } else {
        return payload;
      }
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(resolve, 350 * 2 ** attempt);
      signal.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timeout);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The reader request could not be completed.");
}

function initialReaderSettings(): ReaderSettings {
  if (typeof window === "undefined") return defaultReaderSettings;
  try {
    const stored = window.localStorage.getItem(
      "nyascans:reader-settings:v1",
    );
    if (!stored) return defaultReaderSettings;
    const parsed = JSON.parse(stored) as Partial<ReaderSettings>;
    const allowedImageFits: ReaderSettings["imageFit"][] = [
      "width",
      "height",
      "page",
      "original",
      "smart",
    ];
    return {
      ...defaultReaderSettings,
      ...parsed,
      imageFit: allowedImageFits.includes(
        parsed.imageFit as ReaderSettings["imageFit"],
      )
        ? (parsed.imageFit as ReaderSettings["imageFit"])
        : defaultReaderSettings.imageFit,
      volumeNavigation: false,
    };
  } catch {
    window.localStorage.removeItem("nyascans:reader-settings:v1");
    return defaultReaderSettings;
  }
}

function ReaderPageImage({
  pageData,
  index,
  chapterLabel,
  hidden,
  brightness,
}: {
  pageData: ReaderPageData;
  index: number;
  chapterLabel: string;
  hidden: boolean;
  brightness: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const retryTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current);
      }
    },
    [],
  );

  function retry() {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    setState("loading");
    setAttempt((value) => value + 1);
  }

  const retrySeparator = pageData.url.includes("?") ? "&" : "?";
  return (
    <article
      className={`comic-page chapter-image-page ${
        hidden ? "comic-page-hidden" : ""
      }`}
      aria-label={`Page ${index + 1}`}
    >
      {state !== "ready" ? (
        <div
          className={`reader-image-state reader-image-${state}`}
          role={state === "error" ? "alert" : "status"}
        >
          {state === "loading" ? (
            <>
              <SpinnerGap size={24} className="is-spinning" />
              <span>Loading page {index + 1}…</span>
            </>
          ) : (
            <>
              <WarningCircle size={25} />
              <strong>Page {index + 1} did not load</strong>
              <span>Your position is safe. Retry only this page.</span>
              <button type="button" onClick={retry}>
                Try page again
              </button>
            </>
          )}
        </div>
      ) : null}
      <img
        key={attempt}
        src={`${pageData.url}${retrySeparator}retry=${attempt}`}
        alt={`Page ${index + 1} of ${chapterLabel}`}
        width={Math.max(1, Number(pageData.width))}
        height={Math.max(1, Number(pageData.height))}
        loading={index < 2 ? "eager" : "lazy"}
        decoding="async"
        style={{ filter: `brightness(${brightness}%)` }}
        onLoad={() => setState("ready")}
        onError={() => {
          if (attempt >= 2) {
            setState("error");
            return;
          }
          setState("loading");
          retryTimer.current = window.setTimeout(
            () => setAttempt((value) => value + 1),
            450 * (attempt + 1),
          );
        }}
      />
    </article>
  );
}

function ReaderView({
  slug,
  chapterSlug,
  actor,
  showToast,
}: {
  slug?: string;
  chapterSlug?: string;
  actor: Actor | null;
  showToast: (text: string) => void;
}) {
  const routeSeriesSlug = slug ?? "";
  const routeChapterSlug = chapterSlug ?? "";
  const catalogItem =
    demoSeries.find((entry) => entry.slug === routeSeriesSlug) ?? null;
  const { settings: commercial } = useCommercialSettings();
  const premiumEconomyPublic = commercial.economy.premiumEconomyPublic;
  const [readerContext, setReaderContext] =
    useState<ReaderContextData | null>(null);
  const [contextRevision, setContextRevision] = useState(0);
  const [pagesRevision, setPagesRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [ui, setUi] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterDrawerOpen, setChapterDrawerOpen] = useState(false);
  const [continuityDirection, setContinuityDirection] = useState<
    "previous" | "next" | null
  >(null);
  const [chapterList, setChapterList] = useState<SeriesChapterAccess[]>([]);
  const [chapterListSeries, setChapterListSeries] = useState("");
  const [chapterListLoading, setChapterListLoading] = useState(false);
  const [chapterListError, setChapterListError] = useState("");
  const [readerSettings, setReaderSettings] =
    useState<ReaderSettings>(initialReaderSettings);
  const [accessError, setAccessError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [readerPages, setReaderPages] = useState<ReaderPageData[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState("");
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletError, setWalletError] = useState("");
  const [chapterReactions, setChapterReactions] = useState<ChapterReaction[]>([]);
  const [reactionBusy, setReactionBusy] = useState("");
  const [commentReplyBadge, setCommentReplyBadge] = useState({ count: 0, enabled: true });
  const completedAnalyticsKey = useRef("");
  const rewardedChapterKey = useRef("");
  const currentReaderPage = useRef(page);
  const restoredProgressKey = useRef("");
  const chapterDrawerTrigger = useRef<HTMLButtonElement>(null);
  const chapterDrawer = useRef<HTMLElement>(null);
  const continuityDialog = useRef<HTMLElement>(null);
  const continuityReturnFocus = useRef<HTMLElement | null>(null);
  const chapterListRequest = useRef<AbortController | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const unlockIdempotencyKey = useRef("");
  useEffect(() => {
    currentReaderPage.current = page;
  }, [page]);
  const access =
    readerContext?.series.slug === routeSeriesSlug &&
    readerContext.chapter.slug === routeChapterSlug
      ? readerContext.access
      : null;
  const nextChapter = readerContext?.nextChapter ?? null;
  const previousChapter = readerContext?.previousChapter ?? null;
  const continuityAlternatives =
    continuityDirection === "next"
      ? readerContext?.nextAlternatives ?? []
      : continuityDirection === "previous"
        ? readerContext?.previousAlternatives ?? []
        : [];
  const continuityReason =
    continuityDirection === "next"
      ? readerContext?.nextFallbackReason
      : continuityDirection === "previous"
        ? readerContext?.previousFallbackReason
        : null;
  const seriesTitle =
    readerContext?.series.title ?? catalogItem?.title ?? "NyaScans";
  const seriesCover =
    readerContext?.series.cover ?? catalogItem?.cover ?? null;
  const teamName =
    readerContext?.series.teamName ??
    catalogItem?.team.name ??
    "Independent release";
  const currentLanguageName = readerContext
    ? languageName(readerContext.chapter.language)
    : "selected language";
  const releaseChapters = useMemo(() => {
    if (
      chapterListSeries !== routeSeriesSlug ||
      !readerContext
    ) {
      return [];
    }
    return [...chapterList].sort((left, right) => {
        const numberOrder = compareChapterNumbers(
          chapterDisplayNumber(right),
          chapterDisplayNumber(left),
        );
        if (numberOrder) return numberOrder;
        const preferredLeft =
          left.language === readerContext.chapter.language &&
          left.teamId === readerContext.chapter.teamId;
        const preferredRight =
          right.language === readerContext.chapter.language &&
          right.teamId === readerContext.chapter.teamId;
        if (preferredLeft !== preferredRight) return preferredLeft ? -1 : 1;
        return right.version - left.version;
      });
  }, [
    chapterList,
    chapterListSeries,
    readerContext,
    routeSeriesSlug,
  ]);
  const mode = readerSettings.mode;
  const wakeLockSupported =
    typeof navigator !== "undefined" && "wakeLock" in navigator;
  const panelCount = readerPages.length;
  const readerBackground =
    readerSettings.readerTheme === "paper"
      ? "#f5f0e5"
      : readerSettings.readerTheme === "sepia"
        ? "#2d251d"
        : readerSettings.backgroundColor;
  const readerStyle = {
    "--reader-background": readerBackground,
    "--reader-image-gap": `${readerSettings.imageSpacing}px`,
    "--reader-top-margin": `${readerSettings.topMargin}px`,
    "--reader-bottom-margin": `${readerSettings.bottomMargin}px`,
  } as CSSProperties;

  useEffect(() => {
    unlockIdempotencyKey.current = "";
  }, [routeChapterSlug, routeSeriesSlug]);

  useEffect(
    () => () => {
      chapterListRequest.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!chapterDrawerOpen) return;
    function closeDrawer(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setChapterDrawerOpen(false);
        chapterDrawerTrigger.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        chapterDrawer.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", closeDrawer);
    return () => document.removeEventListener("keydown", closeDrawer);
  }, [chapterDrawerOpen]);

  useEffect(() => {
    if (!continuityDirection) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeContinuity(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContinuityDirection(null);
        window.requestAnimationFrame(() =>
          continuityReturnFocus.current?.focus(),
        );
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        continuityDialog.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", closeContinuity);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeContinuity);
    };
  }, [continuityDirection]);

  useEffect(() => {
    if (readerSettings.rememberSettings) {
      window.localStorage.setItem(
        "nyascans:reader-settings:v1",
        JSON.stringify(readerSettings),
      );
      return;
    }
    window.localStorage.removeItem("nyascans:reader-settings:v1");
  }, [readerSettings]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchReaderResource<ReaderContextData>(
      `/api/v1/reader-context?series=${encodeURIComponent(routeSeriesSlug)}&chapter=${encodeURIComponent(routeChapterSlug)}`,
      controller.signal,
    )
      .then((context) => {
        setReaderContext(context);
        setContinuityDirection(null);
        window.localStorage.setItem(
          `nyascans:reader-release-preference:${context.series.slug}`,
          JSON.stringify({
            teamId: context.chapter.teamId,
            language: context.chapter.language,
          }),
        );
        const seriesOverride = window.localStorage.getItem(
          `nyascans:reader-series-override:${context.series.slug}`,
        );
        if (!seriesOverride) {
          const manga = ["RTL", "RIGHT_TO_LEFT"].includes(context.series.readingDirection);
          const systemMode = manga ? "single" : "vertical";
          const systemDirection = manga ? "rtl" : "ltr";
          if (!actor) {
            setReaderSettings((current) => ({ ...current, mode: systemMode, readingDirection: systemDirection }));
          } else {
            void fetch("/api/v1/account-settings", {
              cache: "no-store",
              signal: controller.signal,
            })
              .then(async (response) => (response.ok ? response.json() : null))
              .then((payload: { data?: { readerTypeDefaults?: { manga?: string; vertical?: string }; readerSettings?: Partial<ReaderSettings> } } | null) => {
                const accountDefaults = payload?.data?.readerSettings ?? {};
                const selected = manga
                  ? payload?.data?.readerTypeDefaults?.manga
                  : payload?.data?.readerTypeDefaults?.vertical;
                if (!selected || selected === "SYSTEM") {
                  setReaderSettings((current) => ({
                    ...current,
                    ...accountDefaults,
                    mode: systemMode,
                    readingDirection: systemDirection,
                  }));
                  return;
                }
                const [modeValue, directionValue] = selected.split("_");
                setReaderSettings((current) => ({
                  ...current,
                  ...accountDefaults,
                  mode: modeValue === "VERTICAL" ? "vertical" : modeValue === "DOUBLE" ? "double" : "single",
                  readingDirection: directionValue === "RTL" ? "rtl" : "ltr",
                }));
              })
              .catch((error: unknown) => {
                if ((error as Error).name === "AbortError") return;
                setReaderSettings((current) => ({ ...current, mode: systemMode, readingDirection: systemDirection }));
              });
          }
        }
      })
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setAccessError(
          error instanceof Error
            ? error.message
            : "Chapter access could not be verified.",
        );
      });
    return () => controller.abort();
  }, [actor, contextRevision, routeChapterSlug, routeSeriesSlug]);

  useEffect(() => {
    if (!readerContext?.chapter.id) return;
    const controller = new AbortController();
    void fetch(`/api/v1/chapter-reactions?chapterId=${encodeURIComponent(readerContext.chapter.id)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: ChapterReaction[]; meta?: { replyCount?: number; showReplyBadge?: boolean } };
        if (response.ok) {
          setChapterReactions(payload.data ?? []);
          setCommentReplyBadge({ count: Number(payload.meta?.replyCount ?? 0), enabled: payload.meta?.showReplyBadge !== false });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [readerContext?.chapter.id]);

  async function toggleChapterReaction(reactionId: string) {
    if (!actor) {
      window.location.assign(authEntryPath("login", `/title/${routeSeriesSlug}/chapter/${routeChapterSlug}`));
      return;
    }
    if (!readerContext?.chapter.id || reactionBusy) return;
    setReactionBusy(reactionId);
    try {
      const response = await fetch("/api/v1/chapter-reactions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterId: readerContext.chapter.id, reactionId }),
      });
      const payload = (await response.json()) as { data?: ChapterReaction[]; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Reaction could not be saved.");
      setChapterReactions(payload.data ?? []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Reaction could not be saved.");
    } finally {
      setReactionBusy("");
    }
  }

  useEffect(() => {
    if (!access?.canRead) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setPagesLoading(true);
      setPagesError("");
      setReaderPages([]);
      void fetchReaderResource<{ data?: ReaderPageData[] }>(
        `/api/v1/chapter-pages?series=${encodeURIComponent(routeSeriesSlug)}&chapter=${encodeURIComponent(routeChapterSlug)}`,
        controller.signal,
      )
        .then((payload) => {
          setReaderPages(payload.data ?? []);
          setPage(1);
        })
        .catch((error: unknown) => {
          if ((error as Error).name === "AbortError") return;
          setPagesError(
            error instanceof Error
              ? error.message
              : "Chapter pages could not be loaded.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setPagesLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    access?.canRead,
    pagesRevision,
    routeChapterSlug,
    routeSeriesSlug,
  ]);

  useEffect(() => {
    if (
      !actor ||
      !access?.canRead ||
      !access.chapterId ||
      panelCount === 0
    ) {
      return;
    }
    const key = `${actor.email}:${access.chapterId}`;
    if (restoredProgressKey.current === key) return;
    restoredProgressKey.current = key;
    const controller = new AbortController();
    void fetchReaderResource<{
      data: {
        pageIndex: number;
        scrollOffset: number;
        progressBasisPoints: number;
      } | null;
    }>(
      `/api/v1/reader/progress?chapterId=${encodeURIComponent(access.chapterId)}`,
      controller.signal,
      2,
    )
      .then((payload) => {
        if (!payload.data) return;
        const manifestIndex = readerPages.findIndex(
          (readerPage) =>
            readerPage.kind === "CONTENT" &&
            Number(readerPage.contentPageIndex ?? readerPage.pageIndex) ===
              Number(payload.data?.pageIndex),
        );
        const restoredPage =
          manifestIndex >= 0
            ? manifestIndex + 1
            : Math.min(
                panelCount,
                Math.max(1, Number(payload.data.pageIndex) + 1),
              );
        setPage(restoredPage);
        if (mode === "vertical" && restoredPage > 1) {
          window.setTimeout(() => {
            document
              .querySelector<HTMLElement>(
                `.reader-stage [aria-label="Page ${restoredPage}"]`,
              )
              ?.scrollIntoView({ block: "start" });
          }, 100);
        }
      })
      .catch(() => {
        restoredProgressKey.current = "";
      });
    return () => controller.abort();
  }, [
    access?.canRead,
    access?.chapterId,
    actor,
    mode,
    panelCount,
    readerPages,
  ]);

  useEffect(() => {
    if (mode !== "vertical" || !access?.canRead || panelCount === 0) return;
    const pages = Array.from(
      document.querySelectorAll<HTMLElement>(".reader-stage .comic-page"),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = [...entries]
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (!mostVisible) return;
        const index = pages.indexOf(mostVisible.target as HTMLElement);
        if (index >= 0) setPage(index + 1);
      },
      {
        rootMargin: "-28% 0px -52% 0px",
        threshold: [0.08, 0.3, 0.6],
      },
    );
    pages.forEach((comicPage) => observer.observe(comicPage));
    return () => observer.disconnect();
  }, [access?.canRead, mode, panelCount]);

  useEffect(() => {
    if (
      !actor ||
      !access?.canRead ||
      !readerSettings.saveReadingProgress ||
      panelCount === 0
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      const contentPages = readerPages.filter(
        (readerPage) => readerPage.kind !== "FIXED_FIRST" &&
          readerPage.kind !== "FIXED_LAST",
      );
      const manifestPage = readerPages[page - 1];
      const contentPageIndex =
        manifestPage?.kind === "FIXED_LAST"
          ? Math.max(0, contentPages.length - 1)
          : manifestPage?.kind === "FIXED_FIRST"
            ? 0
            : Math.max(
                0,
                Number(
                  manifestPage?.contentPageIndex ??
                    manifestPage?.pageIndex ??
                    page - 1,
                ),
              );
      void fetch("/api/v1/reader/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chapterId: access.chapterId,
          pageIndex: contentPageIndex,
          scrollOffset: Math.max(0, Math.round(window.scrollY)),
          progressBasisPoints:
            manifestPage?.kind === "FIXED_LAST"
              ? 10000
              : Math.round(
                  ((contentPageIndex + 1) /
                    Math.max(1, contentPages.length)) *
                    10000,
                ),
          markCompleted: readerSettings.autoMarkRead,
        }),
      });
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [
    access?.canRead,
    access?.chapterId,
    actor,
    page,
    panelCount,
    readerPages,
    readerSettings.autoMarkRead,
    readerSettings.saveReadingProgress,
  ]);

  useEffect(() => {
    if (
      !actor ||
      !access?.canRead ||
      !access.chapterId ||
      panelCount === 0
    ) {
      return;
    }
    const chapterId = access.chapterId;
    const controller = new AbortController();
    let active = true;
    let requestBusy = false;

    async function tick() {
      if (
        !active ||
        requestBusy ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      ) {
        return;
      }
      requestBusy = true;
      try {
        const response = await fetch("/api/v1/rewards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ action: "HEARTBEAT", chapterId }),
        });
        const status = (await response.json()) as {
          eligible?: boolean;
          alreadyClaimed?: boolean;
        };
        if (!active) return;
        const atChapterEnd =
          currentReaderPage.current / Math.max(1, panelCount) >= 0.92;
        if (
          !response.ok ||
          !status.eligible ||
          status.alreadyClaimed ||
          !atChapterEnd ||
          rewardedChapterKey.current === chapterId
        ) {
          if (status.alreadyClaimed) rewardedChapterKey.current = chapterId;
          return;
        }
        const claimResponse = await fetch("/api/v1/rewards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ action: "CLAIM_CHAPTER", chapterId }),
        });
        const claim = (await claimResponse.json()) as {
          awarded?: boolean;
          amount?: number;
        };
        if (!active) return;
        if (claimResponse.ok && claim.awarded) {
          rewardedChapterKey.current = chapterId;
        }
        if (claimResponse.ok && claim.awarded) {
          showToast(
            `Chapter completed · +${Number(claim.amount ?? 0).toLocaleString("en-US")} Shards`,
          );
        }
      } catch {
        // Reader rewards retry on the next visible heartbeat.
      } finally {
        requestBusy = false;
      }
    }

    void tick();
    const interval = window.setInterval(() => void tick(), 15_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [
    access?.canRead,
    access?.chapterId,
    actor,
    panelCount,
    showToast,
  ]);

  useEffect(() => {
    if (!readerSettings.keepAwake || !wakeLockSupported) {
      void wakeLock.current?.release();
      wakeLock.current = null;
      return;
    }
    const wakeNavigator = navigator as Navigator & {
      wakeLock?: {
        request: (type: "screen") => Promise<{
          release: () => Promise<void>;
        }>;
      };
    };
    let cancelled = false;
    void wakeNavigator.wakeLock
      ?.request("screen")
      .then((sentinel) => {
        if (cancelled) {
          void sentinel.release();
          return;
        }
        wakeLock.current = sentinel;
      })
      .catch(() => {
        showToast("This device could not keep the screen awake.");
      });
    return () => {
      cancelled = true;
      void wakeLock.current?.release();
      wakeLock.current = null;
    };
  }, [readerSettings.keepAwake, showToast, wakeLockSupported]);

  useEffect(() => {
    if (
      !actor ||
      !premiumEconomyPublic ||
      access?.reason !== "PURCHASE_REQUIRED"
    ) {
      return;
    }
    const controller = new AbortController();
    void fetchReaderResource<{ balance: number }>(
      "/api/v1/wallet",
      controller.signal,
      2,
    )
      .then((wallet) => {
        setWalletBalance(Number(wallet.balance));
        setWalletError("");
      })
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setWalletError("Balance is temporarily unavailable.");
      });
    return () => controller.abort();
  }, [access?.reason, actor, premiumEconomyPublic]);

  useEffect(() => {
    if (
      !readerSettings.preloadNextChapter ||
      !nextChapter ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const controller = new AbortController();
    void fetch(
      `/api/v1/reader-context?series=${encodeURIComponent(routeSeriesSlug)}&chapter=${encodeURIComponent(nextChapter.slug)}`,
      { signal: controller.signal, cache: "no-store" },
    ).catch(() => undefined);
    return () => controller.abort();
  }, [
    nextChapter,
    readerSettings.preloadNextChapter,
    routeSeriesSlug,
  ]);

  useEffect(() => {
    if (
      !access?.canRead ||
      access.administratorPreview ||
      panelCount === 0
    ) return;
    recordAnalyticsEvent("CHAPTER_START", {
      seriesSlug: routeSeriesSlug,
      chapterSlug: routeChapterSlug,
    });
  }, [
    access?.administratorPreview,
    access?.canRead,
    panelCount,
    routeChapterSlug,
    routeSeriesSlug,
  ]);

  useEffect(() => {
    if (
      !access?.canRead ||
      access.administratorPreview ||
      panelCount === 0 ||
      page < panelCount
    ) {
      return;
    }
    const key = `${routeSeriesSlug}:${routeChapterSlug}`;
    if (completedAnalyticsKey.current === key) return;
    completedAnalyticsKey.current = key;
    recordAnalyticsEvent("CHAPTER_COMPLETE", {
      seriesSlug: routeSeriesSlug,
      chapterSlug: routeChapterSlug,
    });
  }, [
    access?.administratorPreview,
    access?.canRead,
    page,
    panelCount,
    routeChapterSlug,
    routeSeriesSlug,
  ]);

  function updateReaderSettings(patch: Partial<ReaderSettings>) {
    if (readerContext?.series.slug) {
      window.localStorage.setItem(
        `nyascans:reader-series-override:${readerContext.series.slug}`,
        "1",
      );
    }
    setReaderSettings((current) => ({ ...current, ...patch }));
  }

  function closeChapterDrawer(restoreFocus = true) {
    setChapterDrawerOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => chapterDrawerTrigger.current?.focus());
    }
  }

  function openChapterDrawer() {
    setSettingsOpen(false);
    setChapterDrawerOpen(true);
    if (chapterListSeries === routeSeriesSlug) return;
    chapterListRequest.current?.abort();
    const controller = new AbortController();
    chapterListRequest.current = controller;
    setChapterListLoading(true);
    setChapterListError("");
    void fetchReaderResource<{ data?: SeriesChapterAccess[] }>(
      `/api/v1/chapter-access-list?series=${encodeURIComponent(routeSeriesSlug)}`,
      controller.signal,
      2,
    )
      .then((payload) => {
        setChapterList(payload.data ?? []);
        setChapterListSeries(routeSeriesSlug);
      })
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setChapterListError(
          error instanceof Error
            ? error.message
            : "The chapter list could not be loaded.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setChapterListLoading(false);
      });
  }

  function movePage(direction: -1 | 1) {
    const step = mode === "double" ? 2 : 1;
    setPage((current) =>
      Math.min(panelCount, Math.max(1, current + direction * step)),
    );
  }

  useEffect(() => {
    if (mode === "vertical") return;
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        settingsOpen ||
        chapterDrawerOpen ||
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(
          (event.target as HTMLElement | null)?.tagName ?? "",
        )
      ) {
        return;
      }
      const forwardKey =
        readerSettings.readingDirection === "rtl"
          ? "ArrowLeft"
          : "ArrowRight";
      const backwardKey =
        readerSettings.readingDirection === "rtl"
          ? "ArrowRight"
          : "ArrowLeft";
      if (event.key === forwardKey || event.key === "PageDown") {
        event.preventDefault();
        movePage(1);
      } else if (event.key === backwardKey || event.key === "PageUp") {
        event.preventDefault();
        movePage(-1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function jumpToReaderSection(targetId: string, forceVertical = false) {
    const scrollToTarget = () => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    };
    if (forceVertical && mode !== "vertical") {
      updateReaderSettings({ mode: "vertical" });
      window.setTimeout(scrollToTarget, 60);
      return;
    }
    scrollToTarget();
  }

  async function saveProgress() {
    if (!actor) {
      showToast("Sign in to sync reading progress.");
      return;
    }
    if (!access?.canRead) {
      showToast("Unlock this chapter before saving progress.");
      return;
    }
    if (panelCount === 0) {
      showToast("This release has no processed pages yet.");
      return;
    }
    try {
      const response = await fetch("/api/v1/reader/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chapterId: access.chapterId,
          pageIndex: page - 1,
          scrollOffset: Math.max(0, Math.round(window.scrollY)),
          progressBasisPoints: Math.round((page / panelCount) * 10000),
          markCompleted: readerSettings.autoMarkRead,
        }),
      });
      if (!response.ok) throw new Error("save failed");
      showToast("Reading progress saved.");
    } catch {
      showToast("Progress could not be saved yet.");
    }
  }

  async function unlockChapter() {
    if (!actor) {
      window.location.href = authEntryPath(
        "login",
        `/title/${routeSeriesSlug}/chapter/${routeChapterSlug}`,
      );
      return;
    }
    if (!unlockIdempotencyKey.current) {
      unlockIdempotencyKey.current =
        `unlock:${routeSeriesSlug}:${routeChapterSlug}:${clientRandomId()}`;
    }
    setUnlocking(true);
    setAccessError("");
    try {
      const response = await fetch("/api/v1/unlocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesSlug: routeSeriesSlug,
          chapterSlug: routeChapterSlug,
          idempotencyKey: unlockIdempotencyKey.current,
        }),
      });
      const payload = (await response.json()) as {
        access?: ChapterAccessData;
        error?: { message?: string };
      };
      if (!response.ok || !payload.access) {
        throw new Error(
          payload.error?.message ?? "This chapter could not be unlocked.",
        );
      }
      setReaderContext((current) =>
        current ? { ...current, access: payload.access! } : current,
      );
      setWalletBalance((current) =>
        current === null ? current : Math.max(0, current - payload.access!.priceOnyx),
      );
      showToast(
        payload.access.isUnlocked
          ? "Chapter unlocked for this account."
          : "Chapter access confirmed.",
      );
    } catch (error) {
      setAccessError(
        error instanceof Error
          ? error.message
          : "This chapter could not be unlocked.",
      );
    } finally {
      setUnlocking(false);
    }
  }

  if (!access) {
    return (
      <main className="reader-access-page">
        <a className="reader-access-back" href={`/title/${routeSeriesSlug}`}>
          <CaretLeft size={18} /> Back to {seriesTitle}
        </a>
        <section className="reader-access-card reader-access-loading" role="status">
          <span />
          <strong>Checking chapter access…</strong>
          <p>
            The reader stays closed until this chapter’s release and entitlement
            rules are verified.
          </p>
          {accessError ? (
            <button
              type="button"
              onClick={() => {
                setAccessError("");
                setContextRevision((value) => value + 1);
              }}
            >
              Retry access check
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  if (!access.canRead) {
    const title =
      !premiumEconomyPublic && access.accessType === "PAID"
        ? "This chapter is temporarily unavailable"
        : access.reason === "UNAVAILABLE"
          ? "This chapter is not published yet"
          : access.reason === "SIGN_IN_REQUIRED"
            ? "Sign in before unlocking this paid chapter"
            : "Unlock this paid chapter to continue";
    return (
      <main className="reader-access-page">
        <a className="reader-access-back" href={`/title/${routeSeriesSlug}#chapters`}>
          <CaretLeft size={18} /> Back to Chapters List
        </a>
        <section className="reader-access-card">
          <div className="reader-lock-cover">
            {seriesCover ? (
              <img
                src={seriesCover}
                alt={`Cover art for ${seriesTitle}`}
                width={240}
                height={360}
              />
            ) : (
              <div className="reader-lock-cover-placeholder">
                <Books size={40} />
              </div>
            )}
            <span>
              <LockSimple size={38} weight="fill" />
            </span>
          </div>
          <div className="reader-lock-copy">
            <p className="eyebrow">{access.chapterLabel}</p>
            <h1>{title}</h1>
            <p>
              {!premiumEconomyPublic && access.accessType === "PAID"
                ? "Premium chapter access is private right now. Existing unlocks remain attached to their owners and no purchase is required or offered on this page."
                : access.reason === "UNAVAILABLE"
                  ? "The publishing team is still preparing this release."
                  : access.reason === "SIGN_IN_REQUIRED"
                    ? "Create or use your NyaScans account to check your balance and keep the chapter in your library."
                    : `No chapter pages are requested until the secure ${commercial.economy.coinName} unlock is complete.`}
            </p>
            <dl>
              <div>
                <dt>Access</dt>
                <dd>{access.accessType === "FREE" ? "Free" : "Paid"}</dd>
              </div>
              {premiumEconomyPublic && access.priceOnyx > 0 ? (
                <div>
                  <dt>Required</dt>
                  <dd>
                    <ConfiguredCoinMark settings={commercial} size={16} />{" "}
                    {coinLabel(access.priceOnyx, commercial)}
                  </dd>
                </div>
              ) : null}
              {premiumEconomyPublic && access.reason === "PURCHASE_REQUIRED" ? (
                <div>
                  <dt>Your balance</dt>
                  <dd>
                    {walletBalance === null
                      ? walletError || "Checking…"
                      : coinLabel(walletBalance, commercial)}
                  </dd>
                </div>
              ) : null}
            </dl>
            {accessError ? (
              <p className="reader-access-error" role="alert">
                <WarningCircle size={17} /> {accessError}
              </p>
            ) : null}
            {premiumEconomyPublic && access.reason === "SIGN_IN_REQUIRED" ? (
              <div className="reader-unlock-actions">
                <a
                  className="button button-primary"
                  href={authEntryPath(
                    "login",
                    `/title/${routeSeriesSlug}/chapter/${routeChapterSlug}`,
                  )}
                >
                  <SignIn size={18} /> Sign In
                </a>
                <a
                  className="button button-secondary"
                  href={authEntryPath(
                    "signup",
                    `/title/${routeSeriesSlug}/chapter/${routeChapterSlug}`,
                  )}
                >
                  <UserCircle size={18} /> Create Account
                </a>
              </div>
            ) : premiumEconomyPublic && access.reason === "PURCHASE_REQUIRED" ? (
              <div className="reader-unlock-actions">
                <button
                  className="button button-primary"
                  type="button"
                  disabled={
                    unlocking ||
                    walletBalance === null ||
                    walletBalance < access.priceOnyx
                  }
                  onClick={() => void unlockChapter()}
                >
                  <LockSimple size={18} />
                  {unlocking
                    ? "Confirming unlock…"
                    : `Unlock for ${coinLabel(access.priceOnyx, commercial)}`}
                </button>
                <a
                  className="button button-secondary"
                  href="/store/coins#coin-packages"
                >
                  <ConfiguredCoinMark settings={commercial} size={18} /> Buy{" "}
                  {commercial.economy.coinPlural}
                </a>
              </div>
            ) : null}
            {actor && premiumEconomyPublic ? (
              <a className="reader-wallet-link" href="/wallet">
                View wallet and owned chapters <ArrowRight size={16} />
              </a>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  const chapterReactionPrompt =
    panelCount > 0 && chapterReactions.length ? (
      <section className="chapter-reactions-box" aria-labelledby="chapter-reactions-title">
        <div>
          <p className="eyebrow">Reaction</p>
          <h2 id="chapter-reactions-title">What do you think about this chapter?</h2>
          <span>{actor ? "Choose one reaction." : "Sign in to react."}</span>
        </div>
        <div>
          {chapterReactions.map((reaction) => (
            <button
              type="button"
              key={reaction.id}
              aria-pressed={reaction.selected}
              disabled={Boolean(reactionBusy)}
              onClick={() => void toggleChapterReaction(reaction.id)}
            >
              {reaction.imageUrl ? (
                <img src={reaction.imageUrl} alt="" width={48} height={48} />
              ) : (
                <span aria-hidden="true">{reaction.emojiFallback || "♡"}</span>
              )}
              <strong>{reaction.name}</strong>
              <small>{reaction.count}</small>
            </button>
          ))}
        </div>
      </section>
    ) : null;

  return (
    <main
      className={`reader-page reader-mode-${mode} reader-fit-${readerSettings.imageFit} reader-theme-${readerSettings.readerTheme} ${ui ? "reader-ui-visible" : "reader-ui-hidden"}`}
      id="reader-start"
      style={readerStyle}
    >
      {ui ? (
        <header className="reader-header">
          <a href={`/title/${routeSeriesSlug}`} aria-label="Exit reader">
            <CaretLeft size={21} />
          </a>
          <div>
            <a className="reader-series-title-link" href={`/title/${routeSeriesSlug}`}><strong>{seriesTitle}</strong></a>
            <span>{access.chapterLabel} • {teamName}</span>
          </div>
          <div className="reader-header-actions">
            <button type="button" onClick={saveProgress}>
              <CheckCircle size={19} />
              <span>Save</span>
            </button>
            <button type="button" onClick={() => setUi(false)}>
              <ArrowsOut size={19} />
              <span>Hide UI</span>
            </button>
            <button
              type="button"
              aria-expanded={settingsOpen}
              onClick={() => {
                setChapterDrawerOpen(false);
                setSettingsOpen((value) => !value);
              }}
            >
              <GearSix size={19} />
              <span>Settings</span>
            </button>
            <button
              ref={chapterDrawerTrigger}
              type="button"
              aria-expanded={chapterDrawerOpen}
              aria-controls="reader-chapter-drawer"
              onClick={() =>
                chapterDrawerOpen
                  ? closeChapterDrawer(false)
                  : openChapterDrawer()
              }
            >
              <List size={20} />
              <span>Chapters</span>
            </button>
            <a href="/" aria-label="Go to NyaScans home" title="Home">
              <House size={19} />
              <span>Home</span>
            </a>
          </div>
        </header>
      ) : (
        <button className="reader-show-ui" type="button" onClick={() => setUi(true)}>
          Show controls
        </button>
      )}

      {ui && settingsOpen ? (
        <aside
          className="reader-settings-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Reader settings"
        >
          <button
            className="reader-settings-close"
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label="Close reader settings"
          >
            <X size={18} />
          </button>
          <ReaderSettingsPanel
            settings={readerSettings}
            onChange={updateReaderSettings}
            onReset={() => {
              if (readerContext?.series.slug) {
                window.localStorage.removeItem(`nyascans:reader-series-override:${readerContext.series.slug}`);
              }
              const manga = ["RTL", "RIGHT_TO_LEFT"].includes(readerContext?.series.readingDirection ?? "");
              setReaderSettings({
                ...defaultReaderSettings,
                mode: manga ? "single" : "vertical",
                readingDirection: manga ? "rtl" : "ltr",
              });
            }}
            wakeLockSupported={wakeLockSupported}
            volumeNavigationSupported={false}
          />
        </aside>
      ) : null}

      {ui && chapterDrawerOpen ? (
        <div className="reader-chapter-layer">
          <button
            className="reader-chapter-scrim"
            type="button"
            aria-label="Close chapter list"
            onClick={() => closeChapterDrawer()}
          />
          <aside
            className="reader-chapter-drawer"
            id="reader-chapter-drawer"
            ref={chapterDrawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reader-chapter-drawer-title"
          >
            <header>
              <div>
                <span>Chapter list</span>
                <h2 id="reader-chapter-drawer-title">{seriesTitle}</h2>
                <p>
                  {readerContext ? (
                    <LanguageFlag language={readerContext.chapter.language} />
                  ) : null}
                  <span>· {teamName}</span>
                </p>
              </div>
              <button
                type="button"
                autoFocus
                aria-label="Close chapter list"
                onClick={() => closeChapterDrawer()}
              >
                <X size={20} />
              </button>
            </header>
            <div className="reader-chapter-list">
              {chapterListLoading ? (
                <div className="reader-chapter-list-state" role="status">
                  <SpinnerGap size={22} className="is-spinning" />
                  <span>Loading chapters…</span>
                </div>
              ) : chapterListError ? (
                <div className="reader-chapter-list-state" role="alert">
                  <WarningCircle size={22} />
                  <strong>Chapters could not be loaded</strong>
                  <span>{chapterListError}</span>
                  <button type="button" onClick={openChapterDrawer}>
                    Try again
                  </button>
                </div>
              ) : releaseChapters.length ? (
                releaseChapters.map((chapter) => {
                  const current = chapter.chapterSlug === routeChapterSlug;
                  return (
                    <a
                      className={current ? "is-current" : ""}
                      href={`/title/${routeSeriesSlug}/chapter/${chapter.chapterSlug}`}
                      key={`${chapter.chapterSlug}:${chapter.version}`}
                      aria-current={current ? "page" : undefined}
                      onClick={() => closeChapterDrawer(false)}
                    >
                      <span>
                        {chapter.canRead ? (
                          <CheckCircle size={17} />
                        ) : (
                          <LockSimple size={17} />
                        )}
                      </span>
                      <div>
                        <strong>
                          <FreshChapterMark fresh={chapter.isFresh} />
                          <LanguageFlag language={chapter.language} />
                          {chapterDisplayLabel(chapter)}
                        </strong>
                        <small>
                          {chapter.teamName ?? "Independent release"}
                          {" · "}
                          {chapter.accessType === "PAID" &&
                          premiumEconomyPublic
                            ? `${coinLabel(chapter.priceOnyx, commercial)}`
                            : chapter.accessType === "PAID"
                              ? "Unavailable"
                              : "Free"}
                          {" · "}
                          Version {chapter.version}
                        </small>
                      </div>
                      {current ? <em>Reading</em> : <CaretRight size={17} />}
                    </a>
                  );
                })
              ) : (
                <div className="reader-chapter-list-state">
                  <Books size={24} />
                  <strong>No matching chapters</strong>
                  <span>
                    No public chapter releases are available yet.
                  </span>
                </div>
              )}
            </div>
            <footer>
              <a href={`/title/${routeSeriesSlug}`}>
                <Books size={18} /> Series details
              </a>
              {readerContext?.chapterManagementHref ? (
                <a href={readerContext.chapterManagementHref}>
                  <GearSix size={18} /> Manage current release
                </a>
              ) : null}
            </footer>
          </aside>
        </div>
      ) : null}

      <section className="reader-stage">
        {pagesLoading ? (
          <div className="reader-page-state" role="status">
            <SpinnerGap size={28} className="is-spinning" />
            <strong>Loading chapter pages…</strong>
          </div>
        ) : pagesError ? (
          <div className="reader-page-state" role="alert">
            <WarningCircle size={28} />
            <strong>Chapter pages could not be loaded</strong>
            <span>{pagesError}</span>
            <button
              type="button"
              onClick={() => {
                setPagesLoading(true);
                setPagesError("");
                setPagesRevision((value) => value + 1);
              }}
            >
              Retry chapter pages
            </button>
          </div>
        ) : readerPages.length ? (
          readerPages.map((readerPage, index) => (
            <ReaderPageImage
              key={readerPage.id}
              pageData={readerPage}
              index={index}
              chapterLabel={access.chapterLabel}
              brightness={readerSettings.brightness}
              hidden={
                mode !== "vertical" &&
                page !== index + 1 &&
                !(mode === "double" && page + 1 === index + 1)
              }
            />
          ))
        ) : (
          <div className="reader-page-state">
            <ImageIcon size={30} />
            <strong>Pages are still processing</strong>
            <span>
              This release is visible to administrators, but it has no verified
              page assets yet.
            </span>
          </div>
        )}
        {mode !== "vertical" && readerPages.length ? (
          <>
            {readerSettings.tapZones ? (
              <div
                className={`reader-tap-zones reader-direction-${readerSettings.readingDirection}`}
                aria-label="Page tap zones"
              >
                <button
                  type="button"
                  onClick={() =>
                    movePage(
                      readerSettings.readingDirection === "rtl" ? 1 : -1,
                    )
                  }
                  aria-label={
                    readerSettings.readingDirection === "rtl"
                      ? "Next page"
                      : "Previous page"
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    movePage(
                      readerSettings.readingDirection === "rtl" ? -1 : 1,
                    )
                  }
                  aria-label={
                    readerSettings.readingDirection === "rtl"
                      ? "Previous page"
                      : "Next page"
                  }
                />
              </div>
            ) : null}
            <div className="reader-page-nav">
            <button
              type="button"
              onClick={() => movePage(-1)}
              disabled={page === 1}
              aria-label="Previous page"
            >
              <CaretLeft size={24} />
            </button>
            <button
              type="button"
              onClick={() => movePage(1)}
              disabled={page >= panelCount}
              aria-label="Next page"
            >
              <CaretRight size={24} />
            </button>
          </div>
          </>
        ) : null}
      </section>

      {panelCount > 0 ? (
        <section className="reader-chapter-complete" id="chapter-end">
          <div>
            <CheckCircle size={28} weight="fill" />
            <span>
              <strong>Chapter complete</strong>
              <small>
                Continue with {teamName} translation.
              </small>
            </span>
          </div>
          <nav
            className="reader-chapter-navigation"
            aria-label="Previous and next chapters"
          >
            {previousChapter ? (
              <a
                href={`/title/${routeSeriesSlug}/chapter/${previousChapter.slug}`}
                rel="prev"
              >
                <CaretLeft size={21} />
                <span>
                  <small>Previous</small>
                  <strong>Chapter {previousChapter.number}</strong>
                </span>
              </a>
            ) : readerContext?.previousAlternatives.length ? (
              <button
                type="button"
                onClick={(event) => {
                  continuityReturnFocus.current = event.currentTarget;
                  setContinuityDirection("previous");
                }}
              >
                <CaretLeft size={21} />
                <span>
                  <small>Previous</small>
                  <strong>Choose translation</strong>
                </span>
              </button>
            ) : (
              <span aria-disabled="true">
                <CaretLeft size={21} />
                <span>
                  <small>Previous</small>
                  <strong>First chapter</strong>
                </span>
              </span>
            )}
            {nextChapter ? (
              <a
                href={`/title/${routeSeriesSlug}/chapter/${nextChapter.slug}`}
                rel="next"
              >
                <span>
                  <small>Next</small>
                  <strong>Chapter {nextChapter.number}</strong>
                </span>
                <CaretRight size={21} />
              </a>
            ) : readerContext?.nextAlternatives.length ? (
              <button
                type="button"
                onClick={(event) => {
                  continuityReturnFocus.current = event.currentTarget;
                  setContinuityDirection("next");
                }}
              >
                <span>
                  <small>Next</small>
                  <strong>Choose translation</strong>
                </span>
                <CaretRight size={21} />
              </button>
            ) : (
              <span aria-disabled="true">
                <span>
                  <small>Next</small>
                  <strong>Latest chapter</strong>
                </span>
                <CaretRight size={21} />
              </span>
            )}
          </nav>
        </section>
      ) : null}

      {continuityDirection && continuityAlternatives.length ? (
        <div className="reader-continuity-layer">
          <button
            className="reader-continuity-scrim"
            type="button"
            aria-label="Close translation chooser"
            onClick={() => {
              setContinuityDirection(null);
              window.requestAnimationFrame(() =>
                continuityReturnFocus.current?.focus(),
              );
            }}
          />
          <section
            className="reader-continuity-dialog"
            ref={continuityDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reader-continuity-title"
          >
            <header>
              <div>
                <span>Translation needed</span>
                <h2 id="reader-continuity-title">
                  Choose another release
                </h2>
              </div>
              <button
                type="button"
                autoFocus
                aria-label="Close translation chooser"
                onClick={() => {
                  setContinuityDirection(null);
                  window.requestAnimationFrame(() =>
                    continuityReturnFocus.current?.focus(),
                  );
                }}
              >
                <X size={19} />
              </button>
            </header>
            <p>
              {continuityReason === "TEAM_UNAVAILABLE"
                ? `${teamName} has not released this chapter in ${currentLanguageName}.`
                : continuityReason === "LANGUAGE_UNAVAILABLE"
                  ? `${teamName} has released this chapter only in another language.`
                  : `This chapter is not available from ${teamName} in ${currentLanguageName}.`}
              {" "}Select one available translation to continue.
            </p>
            <div className="reader-continuity-options">
              {continuityAlternatives.map((alternative) => (
                <a
                  href={`/title/${routeSeriesSlug}/chapter/${alternative.chapterSlug}`}
                  key={alternative.chapterId}
                  onClick={() => setContinuityDirection(null)}
                >
                  <LanguageFlag language={alternative.language} />
                  <span>
                    <strong>{alternative.chapterLabel}</strong>
                    <small>
                      {alternative.teamName ?? "Independent release"} · Version{" "}
                      {alternative.version}
                    </small>
                  </span>
                  <em>
                    {alternative.accessType === "FREE"
                      ? "Free"
                      : premiumEconomyPublic
                        ? coinLabel(alternative.priceOnyx, commercial)
                        : "Unavailable"}
                  </em>
                  <CaretRight size={17} />
                </a>
              ))}
            </div>
            <footer>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setContinuityDirection(null);
                  window.requestAnimationFrame(() =>
                    continuityReturnFocus.current?.focus(),
                  );
                }}
              >
                Stay on this chapter
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <footer className={`reader-footer ${ui ? "" : "reader-footer-hidden"}`}>
        <span>
          {panelCount === 0
            ? "No processed pages"
            : mode === "vertical"
              ? `${panelCount} pages · Continuous`
              : `Page ${page} of ${panelCount}`}
        </span>
        <div className="reader-progress-shell">
          {previousChapter ? <a href={`/title/${routeSeriesSlug}/chapter/${previousChapter.slug}`} aria-label={`Previous chapter ${previousChapter.number}`}><CaretLeft size={18} /></a> : <span aria-hidden="true" />}
          <div className="reader-progress" role="progressbar" aria-valuemin={0} aria-valuemax={panelCount} aria-valuenow={page}>
          <i
            style={{
              width: `${panelCount ? (page / panelCount) * 100 : 0}%`,
            }}
          />
          </div>
          {nextChapter ? <a href={`/title/${routeSeriesSlug}/chapter/${nextChapter.slug}`} aria-label={`Next chapter ${nextChapter.number}`}><CaretRight size={18} /></a> : <span aria-hidden="true" />}
        </div>
        <a href={`/title/${routeSeriesSlug}`}>
          Series details <ArrowRight size={17} />
        </a>
      </footer>

      <nav className="reader-quick-nav" aria-label="Chapter quick navigation">
        <button
          type="button"
          title="Go to chapter start"
          aria-label="Go to chapter start"
          onClick={() => jumpToReaderSection("reader-start")}
        >
          <ArrowUp size={20} />
        </button>
        <button
          type="button"
          title="Go to chapter end"
          aria-label="Go to chapter end"
          onClick={() => jumpToReaderSection("chapter-end", true)}
        >
          <ArrowDown size={20} />
        </button>
        {readerContext?.chapter.commentsEnabled ? (
          <button
            className="reader-comment-jump"
            type="button"
            title="Go to comments"
            aria-label="Go to chapter comments"
            onClick={() => jumpToReaderSection("comments", true)}
          >
            <ChatCircle size={20} />
            {commentReplyBadge.enabled && commentReplyBadge.count > 0 ? <span>{Math.min(99, commentReplyBadge.count)}</span> : null}
          </button>
        ) : null}
      </nav>

      <div className="reader-discussion">
            {readerContext?.chapter.commentsEnabled ? (
              <EnhancedDiscussionSection
                actor={actor}
                seriesSlug={routeSeriesSlug}
                chapterSlug={routeChapterSlug}
                reactionPrompt={chapterReactionPrompt}
                showToast={showToast}
              />
            ) : (
              <section className="reader-comments-disabled">
                <LockSimple size={22} />
                <div>
                  <strong>Comments are disabled for this release</strong>
                  <span>
                    The publishing team has closed chapter discussion.
                  </span>
                </div>
              </section>
            )}
            {routeSeriesSlug ? (
              <SeriesRecommendations seriesSlug={routeSeriesSlug} />
            ) : null}
      </div>
    </main>
  );
}

type WalletActivity = {
  id: string;
  kind: string;
  memo: string;
  createdAt: string;
  amount: number;
};

type WalletData = {
  balance: number;
  currency: string;
  activity: WalletActivity[];
};

type OrderData = {
  id: string;
  status: string;
  totalMinor: number;
  billingCurrency: string;
  provider: string;
  providerReference?: string;
  createdAt: string;
};

type GiftCardData = {
  id: string;
  code: string;
  amount: number;
  currency: "ONYX";
  recipientLabel: string;
  message: string;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED";
  valid: boolean;
  expiresAt: string | null;
  redeemedAt: string | null;
  createdAt: string;
};

function useCommerceData(
  actor: Actor,
  premiumEconomyPublic: boolean,
) {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [shardWallet, setShardWallet] = useState<WalletData | null>(null);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [giftCards, setGiftCards] = useState<GiftCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!premiumEconomyPublic) {
      void fetch("/api/v1/rewards", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            balances?: { shards?: WalletData };
            error?: { message?: string };
          };
          if (!response.ok) {
            throw new Error(
              payload.error?.message ?? "Shard rewards could not be loaded.",
            );
          }
          if (!active) return;
          setWallet(null);
          setShardWallet(payload.balances?.shards ?? null);
          setOrders([]);
          setGiftCards([]);
          setError("");
          setLoading(false);
        })
        .catch((reason: unknown) => {
          if (!active || controller.signal.aborted) return;
          setError(
            reason instanceof Error
              ? reason.message
              : "Shard rewards could not be loaded.",
          );
          setLoading(false);
        });
      return () => {
        active = false;
        controller.abort();
      };
    }
    void Promise.all([
      fetch("/api/v1/wallet", { signal: controller.signal }),
      fetch("/api/v1/orders", { signal: controller.signal }),
      fetch("/api/v1/gifts", {
        cache: "no-store",
        signal: controller.signal,
      }),
    ])
      .then(async ([walletResponse, orderResponse, giftsResponse]) => {
        const walletPayload = (await walletResponse.json()) as WalletData & {
          error?: { message?: string };
        };
        const orderPayload = (await orderResponse.json()) as {
          data?: OrderData[];
          error?: { message?: string };
        };
        const giftsPayload = (await giftsResponse.json()) as {
          cards?: GiftCardData[];
          balances?: {
            shards?: WalletData;
          };
          error?: { message?: string };
        };
        if (!walletResponse.ok || !orderResponse.ok || !giftsResponse.ok) {
          throw new Error(
            walletPayload.error?.message ??
              orderPayload.error?.message ??
              giftsPayload.error?.message ??
              "Wallet and purchases could not be loaded.",
          );
        }
        if (!active) return;
        setWallet(walletPayload);
        setShardWallet(giftsPayload.balances?.shards ?? null);
        setOrders(orderPayload.data ?? []);
        setGiftCards(giftsPayload.cards ?? []);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Wallet and purchases could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [actor, premiumEconomyPublic, reloadKey]);

  return {
    wallet,
    shardWallet,
    orders,
    giftCards,
    loading,
    error,
    reload: () => {
      setLoading(true);
      setError("");
      setReloadKey((value) => value + 1);
    },
  };
}

function CommerceLoading() {
  return (
    <div className="commerce-loading" role="status">
      <span />
      <span />
      <span />
      Loading wallet and purchases…
    </div>
  );
}

function WalletOrdersPanel({
  actor,
  initialTab = "wallet",
  compact = false,
}: {
  actor: Actor;
  initialTab?: "wallet" | "orders" | "gifts";
  compact?: boolean;
}) {
  const { settings: commercialSettings } = useCommercialSettings();
  const premiumEconomyPublic =
    commercialSettings.economy.premiumEconomyPublic;
  const [tab, setTab] = useState<"wallet" | "orders" | "gifts">(initialTab);
  const [redeemCode, setRedeemCode] = useState("");
  const [giftStatus, setGiftStatus] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [transactionTab, setTransactionTab] = useState<"PURCHASES" | "ROULETTE">("PURCHASES");
  const commerce = useCommerceData(actor, premiumEconomyPublic);
  const activeTab = premiumEconomyPublic ? tab : "wallet";
  const walletActivity = premiumEconomyPublic
    ? commerce.wallet
    : commerce.shardWallet;

  async function redeemGiftCard() {
    setRedeeming(true);
    setGiftStatus("");
    try {
      const response = await fetch("/api/v1/gifts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "REDEEM_GIFT", code: redeemCode }),
      });
      const payload = (await response.json()) as {
        amount?: number;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "This Gift Code could not be redeemed.",
        );
      }
      setGiftStatus(
        `${Number(payload.amount ?? 0).toLocaleString("en-US")} ${commercialSettings.economy.coinPlural} added to your wallet.`,
      );
      setRedeemCode("");
      commerce.reload();
    } catch (error) {
      setGiftStatus(
        error instanceof Error
          ? error.message
          : "This Gift Code could not be redeemed.",
      );
    } finally {
      setRedeeming(false);
    }
  }

  if (commerce.loading) return <CommerceLoading />;
  if (commerce.error) {
    return (
      <div className="commerce-error">
        <WarningCircle size={22} />
        <div>
          <strong>We could not load this account data.</strong>
          <p>{commerce.error}</p>
        </div>
        <button type="button" onClick={commerce.reload}>Try again</button>
      </div>
    );
  }

  return (
    <div className={`wallet-orders-panel ${compact ? "wallet-orders-compact" : ""}`}>
      <div className="commerce-tabs" role="tablist" aria-label="Wallet, orders, and Gift Cards">
        <button type="button" role="tab" aria-selected={activeTab === "wallet"} onClick={() => setTab("wallet")}>
          <Wallet size={17} /> Wallet
        </button>
        {premiumEconomyPublic ? (
          <>
            <button type="button" role="tab" aria-selected={activeTab === "orders"} onClick={() => setTab("orders")}>
              <CreditCard size={17} /> Orders
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "gifts"} onClick={() => setTab("gifts")}>
              <Gift size={17} /> Gift Cards
            </button>
          </>
        ) : null}
      </div>
      {activeTab === "wallet" ? (
        <>
          <section className="wallet-balance-grid">
          {premiumEconomyPublic ? (
          <div className="wallet-hero">
            <div>
              <span>
                <ConfiguredCoinMark
                  settings={commercialSettings}
                  size={22}
                />{" "}
                {commercialSettings.economy.coinPlural} wallet
              </span>
              <strong>{commerce.wallet?.balance ?? 0}</strong>
              <p>
                Available {commercialSettings.economy.coinPlural} • verified
                ledger balance
              </p>
            </div>
            <a className="button button-primary" href="/store#coin-packages">
              Add {commercialSettings.economy.coinPlural}
            </a>
          </div>
          ) : null}
          <div className="wallet-hero wallet-hero-shards">
            <div>
              <span><Sparkle size={22} /> Shards wallet</span>
              <strong>{commerce.shardWallet?.balance ?? 0}</strong>
              <p>Earned from reading and community contributions</p>
            </div>
            <a className="button button-secondary" href="/roulette">
              Daily Roulette
            </a>
          </div>
          </section>
          <section className="ledger-section">
            <SectionHeading
              title="Transaction history"
              body="Real-money purchases and Roulette activity are kept separate."
            />
            <div className="transaction-history-tabs" role="tablist" aria-label="Transaction history type">
              <button type="button" role="tab" aria-selected={transactionTab === "PURCHASES"} onClick={() => setTransactionTab("PURCHASES")}><CreditCard size={16} /> Purchases</button>
              <button type="button" role="tab" aria-selected={transactionTab === "ROULETTE"} onClick={() => setTransactionTab("ROULETTE")}><Sparkle size={16} /> Roulette</button>
            </div>
            {transactionTab === "PURCHASES" && commerce.orders.length ? (
              commerce.orders.map((order) => (
                <div className="ledger-row" key={order.id}>
                  <span className="ledger-out"><CreditCard size={18} /></span>
                  <div><strong>Order {order.id.slice(0, 8)}</strong><small>{order.provider} · {order.status.toLowerCase()}</small></div>
                  <time>{new Date(order.createdAt).toLocaleDateString()}</time>
                  <b>{new Intl.NumberFormat("en", { style: "currency", currency: order.billingCurrency }).format(order.totalMinor / 100)}</b>
                </div>
              ))
            ) : transactionTab === "ROULETTE" && walletActivity?.activity.filter((item) => item.kind.includes("ROULETTE")).length ? (
              walletActivity.activity.filter((item) => item.kind.includes("ROULETTE")).map((item) => (
                <div className="ledger-row" key={item.id}>
                  <span className={item.amount >= 0 ? "ledger-in" : "ledger-out"}>
                    {item.amount >= 0 ? <Plus size={18} /> : <ArrowUpRight size={18} />}
                  </span>
                  <div>
                    <strong>
                      {configuredCoinCopy(
                        item.memo || item.kind,
                        commercialSettings,
                      )}
                    </strong>
                    <small>{item.kind.replaceAll("_", " ").toLowerCase()}</small>
                  </div>
                  <time>{new Date(item.createdAt).toLocaleDateString()}</time>
                  <b>{item.amount > 0 ? "+" : ""}{item.amount}</b>
                </div>
              ))
            ) : (
              <EmptyState
                title={transactionTab === "PURCHASES" ? "No purchases yet" : "No Roulette activity yet"}
                body={transactionTab === "PURCHASES" ? "Only completed real-money orders appear here." : "Roulette rewards and paid spins will appear here."}
                compact
              />
            )}
          </section>
        </>
      ) : activeTab === "orders" ? (
        <section className="orders-section">
          <SectionHeading
            title="Orders"
            body="One-time store purchases and their current status."
          />
          {commerce.orders.length ? (
            commerce.orders.map((order) => (
              <article className="order-row" key={order.id}>
                <span><CreditCard size={18} /></span>
                <div>
                  <strong>Order {order.id.slice(0, 8)}</strong>
                  <small>{order.provider} • {order.providerReference ?? "Processing reference"}</small>
                </div>
                <time>{new Date(order.createdAt).toLocaleDateString()}</time>
                <b>{new Intl.NumberFormat("en", { style: "currency", currency: order.billingCurrency }).format(order.totalMinor / 100)}</b>
                <em>{order.status}</em>
              </article>
            ))
          ) : (
            <EmptyState title="No orders yet" body="Completed store orders will appear here with their status." compact />
          )}
          <a className="button button-primary" href="/store">Visit store</a>
        </section>
      ) : (
        <section className="gift-cards-account">
          <SectionHeading
            title="Gift Cards"
            body="Create Gifts in the Store, copy purchased codes here, or redeem a code you received."
          />
          <div className="gift-redeem-card">
            <div>
              <Gift size={24} weight="duotone" />
              <span>
                <strong>Redeem a Gift Code</strong>
                Each 18-character code can be used once.
              </span>
            </div>
            <label>
              <span>Gift Code</span>
              <input
                value={redeemCode}
                maxLength={32}
                autoCapitalize="characters"
                placeholder="Paste your 18-character code"
                onChange={(event) => setRedeemCode(event.target.value)}
              />
            </label>
            <button
              className="button button-primary"
              type="button"
              disabled={redeeming || redeemCode.replace(/[^A-Za-z0-9]/gu, "").length !== 18}
              onClick={() => void redeemGiftCard()}
            >
              {redeeming ? "Redeeming…" : "Redeem Code"}
            </button>
            {giftStatus ? <p role="status">{giftStatus}</p> : null}
          </div>
          <div className="gift-card-history">
            <header>
              <h3>Purchased Gift Cards</h3>
              <a href="/store/gifts">Create another <ArrowRight size={15} /></a>
            </header>
            {commerce.giftCards.length ? (
              commerce.giftCards.map((card) => (
                <article key={card.id}>
                  <span className="gift-history-icon"><Gift size={19} /></span>
                  <div>
                    <small>{card.recipientLabel || "Gift to user"}</small>
                    <code>{card.code}</code>
                    {card.message ? <p>{card.message}</p> : null}
                  </div>
                  <strong>{card.amount.toLocaleString("en-US")} {commercialSettings.economy.coinPlural}</strong>
                  <em data-valid={card.valid ? "true" : "false"}>
                    {card.valid ? "Valid" : card.status === "REDEEMED" ? "Used" : "Expired"}
                  </em>
                  <button
                    type="button"
                    disabled={!card.valid}
                    aria-label={`Copy Gift Code ending in ${card.code.slice(-4)}`}
                    onClick={() => {
                      void navigator.clipboard.writeText(card.code.replaceAll(" ", ""));
                      setGiftStatus("Gift Code copied.");
                    }}
                  >
                    <Copy size={17} /> Copy
                  </button>
                </article>
              ))
            ) : (
              <EmptyState
                title="No Gift Cards yet"
                body="Gift Codes you create in the Store will appear here."
                compact
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function WalletView({ actor }: { actor: Actor | null }) {
  if (!actor) return <LibraryView actor={null} />;
  return (
    <main className="page-main page-wrap wallet-page">
      <WalletOrdersPanel actor={actor} />
    </main>
  );
}

function OrdersView({ actor }: { actor: Actor | null }) {
  if (!actor) return <LibraryView actor={null} />;
  return (
    <main className="page-main page-wrap wallet-page">
      <WalletOrdersPanel actor={actor} initialTab="orders" />
    </main>
  );
}

function AuthEntryView({
  intent,
  actor,
  authenticatedIdentity,
  accountBlocked,
  returnTo,
}: {
  intent: "login" | "signup";
  actor: Actor | null;
  authenticatedIdentity: Pick<Actor, "displayName" | "email"> | null;
  accountBlocked: boolean;
  returnTo: string;
}) {
  const { settings: commercial } = useCommercialSettings();
  const premiumEconomyPublic =
    commercial.economy.premiumEconomyPublic;
  const signInHref =
    `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`;
  const isSignup = intent === "signup";

  return (
    <main className="page-main page-wrap auth-entry-page">
      <section className="auth-entry-card" aria-labelledby="auth-entry-title">
        <Logo />
        <nav className="auth-intent-switcher" aria-label="Account access">
          <a
            href={authEntryPath("login", returnTo)}
            aria-current={!isSignup ? "page" : undefined}
          >
            Sign In
          </a>
          <a
            href={authEntryPath("signup", returnTo)}
            aria-current={isSignup ? "page" : undefined}
          >
            Create Account
          </a>
        </nav>

        {accountBlocked ? (
          <div className="auth-entry-state auth-entry-blocked" role="alert">
            <WarningCircle size={34} />
            <div>
              <p className="eyebrow">Account unavailable</p>
              <h1 id="auth-entry-title">This NyaScans account is suspended.</h1>
              <p>
                Publishing, comments, and other protected actions remain
                disabled. Contact support if you believe this is an error.
              </p>
            </div>
            <div className="auth-entry-actions">
              <a
                className="button button-secondary"
                href="/support?topic=account-access"
              >
                Contact Support
              </a>
              <a
                className="button button-quiet"
                href="/signout-with-chatgpt?return_to=%2Flogin"
              >
                Use Another Account
              </a>
            </div>
          </div>
        ) : actor || authenticatedIdentity ? (
          <div className="auth-entry-state">
            <CheckCircle size={34} weight="fill" />
            <div>
              <p className="eyebrow">Signed in securely</p>
              <h1 id="auth-entry-title">
                Welcome back,{" "}
                {(actor ?? authenticatedIdentity)?.displayName ?? "reader"}.
              </h1>
              <p>
                Continue to the page you requested. Your session is managed by
                the configured ChatGPT identity provider.
              </p>
            </div>
            <a className="button button-primary" href={returnTo}>
              Continue <ArrowRight size={18} />
            </a>
          </div>
        ) : (
          <>
            <div className="auth-entry-heading">
              <p className="eyebrow">
                {isSignup ? "Join NyaScans" : "Welcome back"}
              </p>
              <h1 id="auth-entry-title">
                {isSignup
                  ? "Create your reader account."
                  : "Sign in to your account."}
              </h1>
              <p>
                {isSignup
                  ? "ChatGPT is the only identity provider configured for this deployment. First-time authorization creates your NyaScans reader profile."
                  : "Continue with the identity provider configured for NyaScans. You will return to the page you requested."}
              </p>
            </div>
            <a className="auth-provider-button" href={signInHref}>
              <ShieldCheck size={21} weight="fill" />
              <span>
                {isSignup
                  ? "Create or Continue with ChatGPT"
                  : "Continue with ChatGPT"}
              </span>
              <ArrowRight size={18} />
            </a>
            <div className="auth-provider-note">
              <ShieldCheck size={18} />
              <p>
                Secure provider session. NyaScans never receives or stores your
                ChatGPT password or provider token.
              </p>
            </div>
            <p className="auth-terms">
              By continuing, you agree to the{" "}
              <a href="/legal/terms">Terms</a> and acknowledge the{" "}
              <a href="/legal/privacy">Privacy Policy</a>.
            </p>
          </>
        )}
      </section>
      <aside className="auth-entry-aside" aria-label="Account benefits">
        <span className="auth-entry-aside-lock">
          <LockSimple size={22} weight="fill" />
        </span>
        <p className="eyebrow">One account, every device</p>
        <h2>
          {premiumEconomyPublic
            ? "Keep your place without weakening protected chapter access."
            : "Keep your reading progress and rewards synchronized."}
        </h2>
        <ul>
          <li><Check size={17} /> Sync reading progress and Library choices</li>
          <li>
            <Check size={17} />{" "}
            {premiumEconomyPublic
              ? "Retain chapter entitlements across devices"
              : "Keep earned Shards and achievements together"}
          </li>
          <li><Check size={17} /> Return to the exact chapter after sign-in</li>
        </ul>
      </aside>
    </main>
  );
}

function AccountView({ actor, showToast }: { actor: Actor | null; showToast: (text: string) => void }) {
  const { settings: commercial } = useCommercialSettings();
  const premiumEconomyPublic =
    commercial.economy.premiumEconomyPublic;
  const [section, setSection] = useState("Profile");
  const [accountSettings, setAccountSettings] = useState({
    displayName: actor?.displayName ?? "",
    contentLanguage: "en",
    readerMode: "VERTICAL",
    readingDirection: "AUTO",
    brightness: 100,
    readerTypeDefaults: { manga: "SYSTEM", vertical: "SYSTEM" },
    commentReplyBadge: true,
    readerSettings: { ...defaultReaderSettings },
    matureContent: false,
    notifications: {
      newChapters: true,
      unlockReminders: true,
      purchaseReceipts: true,
      securityAlerts: true,
      newFollowers: true,
    },
    privacy: {
      showReadingActivity: false,
      personalizedRecommendations: true,
      analyticsCookies: false,
    },
  });
  const [settingsBusy, setSettingsBusy] = useState(false);
  const accountSections = useMemo<
    ReadonlyArray<readonly [string, PhosphorIcon]>
  >(
    () => [
      ["Profile", UserCircle],
      ["Reader settings", Books],
      ["Security", ShieldCheck],
      ["Notifications", Bell],
      ["Connected accounts", Key],
      ["Preferences", LockSimple],
      [premiumEconomyPublic ? "Wallet and orders" : "Rewards", Wallet],
    ],
    [premiumEconomyPublic],
  );

  useEffect(() => {
    function syncFromLocation() {
      const requested = new URLSearchParams(window.location.search).get("tab");
      if (!requested) {
        setSection("Profile");
        return;
      }
      const match = accountSections.find(
        ([label]) =>
          label.toLowerCase().replaceAll(" ", "-") === requested.toLowerCase(),
      );
      setSection(match?.[0] ?? "Profile");
    }
    const timeout = window.setTimeout(syncFromLocation, 0);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [accountSections]);

  function selectSection(nextSection: string) {
    setSection(nextSection);
    const tab = nextSection.toLowerCase().replaceAll(" ", "-");
    window.history.pushState(
      {},
      "",
      tab === "profile" ? "/account" : `/account?tab=${tab}`,
    );
  }

  useEffect(() => {
    if (!actor) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/v1/account-settings", {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data?: Partial<typeof accountSettings>;
        };
        if (response.ok && payload.data) {
          setAccountSettings((current) => ({
            ...current,
            ...payload.data,
            notifications: {
              ...current.notifications,
              ...(payload.data?.notifications ?? {}),
            },
            privacy: {
              ...current.privacy,
              ...(payload.data?.privacy ?? {}),
            },
            readerSettings: {
              ...current.readerSettings,
              ...(payload.data?.readerSettings ?? {}),
            },
          }));
        }
      } catch {
        // The form keeps safe defaults and surfaces failures on save.
      }
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  // The actor id is stable for the mounted account page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor?.email]);

  async function saveAccountSettings(
    values: Record<string, unknown>,
    successMessage: string,
  ) {
    setSettingsBusy(true);
    try {
      const response = await fetch("/api/v1/account-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Account settings could not be saved.",
        );
      }
      showToast(successMessage);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Account settings could not be saved.",
      );
    } finally {
      setSettingsBusy(false);
    }
  }

  if (!actor) {
    return (
      <main className="page-main page-wrap account-auth">
        <section className="auth-card">
          <Logo />
          <h1>Sign in to keep reading.</h1>
          <p>
            Continue on any device, keep your progress synchronized, and
            receive only the updates you choose.
          </p>
          <a
            className="button button-primary"
            href={authEntryPath("login", "/account")}
          >
            <SignIn size={18} />
            Open Sign In
          </a>
          <div className="auth-assurances">
            <span><ShieldCheck size={17} /> Secure session</span>
            <span><Key size={17} /> MFA supported</span>
          </div>
          <small>
            By continuing, you agree to the Terms and acknowledge the Privacy
            Policy.
          </small>
        </section>
        <aside className="auth-art">
          <img src="/art/cover-neon-ronin.png" alt="" />
          <blockquote>
            “A reader should feel the story, not the interface.”
            <span>NyaScans reader principle</span>
          </blockquote>
        </aside>
      </main>
    );
  }

  return (
    <main className="page-main page-wrap account-page">
      <aside className="account-sidebar">
        <div className="account-person">
          <span>{actor.displayName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{actor.displayName}</strong><small>{actor.email}</small></div>
        </div>
        {accountSections.map(([label, Icon]) => (
          <button type="button" key={String(label)} aria-current={section === label ? "page" : undefined} onClick={() => selectSection(String(label))}>
            <Icon size={18} /> {String(label)}
          </button>
        ))}
      </aside>
      <section className="account-content">
        <SectionHeading title={section} body={section === "Profile" ? "How you appear across NyaScans." : `Manage your ${section.toLowerCase()} preferences.`} />
        {section === "Wallet and orders" || section === "Rewards" ? (
          <WalletOrdersPanel actor={actor} compact />
        ) : section === "Profile" ? (
          <ProfileSettingsWorkspace onSaved={showToast} />
        ) : section === "__legacy_profile__" ? (
          <>
            <form className="settings-form">
              <label>
                <span>Display name</span>
                <input
                  value={accountSettings.displayName}
                  minLength={2}
                  maxLength={80}
                  onChange={(event) =>
                    setAccountSettings((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                />
                <small>Visible on reviews and comments.</small>
              </label>
              <label>
                <span>Email address</span>
                <input defaultValue={actor.email} disabled />
                <small>Managed by your sign-in provider.</small>
              </label>
              <div className="form-grid">
                <label>
                  <span>Content language</span>
                  <select
                    value={accountSettings.contentLanguage}
                    onChange={(event) =>
                      setAccountSettings((current) => ({
                        ...current,
                        contentLanguage: event.target.value,
                      }))
                    }
                  >
                    <option value="en">English</option>
                    <option value="fr">French</option>
                    <option value="ar">Arabic</option>
                  </select>
                </label>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={accountSettings.matureContent}
                    onChange={(event) =>
                      setAccountSettings((current) => ({
                        ...current,
                        matureContent: event.target.checked,
                      }))
                    }
                  />
                  <span>Allow mature-content discovery</span>
                </label>
              </div>
              <button
                className="button button-primary"
                type="button"
                disabled={settingsBusy}
                onClick={() =>
                  void saveAccountSettings(
                    {
                      displayName: accountSettings.displayName,
                      contentLanguage: accountSettings.contentLanguage,
                      matureContent: accountSettings.matureContent,
                    },
                    "Profile settings saved.",
                  )
                }
              >
                {settingsBusy ? "Saving…" : "Save changes"}
              </button>
            </form>
            <section className="danger-zone">
              <div><h3>Data and account</h3><p>Export your data or request account deletion.</p></div>
              <a href="/api/v1/account-export" download>
                <DownloadSimple size={17} /> Export data
              </a>
              <a href="/support?topic=account-deletion">
                <Trash size={17} /> Request deletion
              </a>
            </section>
          </>
        ) : section === "Reader settings" ? (
          <form className="settings-form">
            <div className="reader-defaults-intro">
              <strong>Default reader by series type</strong>
              <p>System defaults use right-to-left pages for manga and long strip for vertical releases.</p>
            </div>
            <ReaderSettingsPanel
              settings={accountSettings.readerSettings}
              onChange={(patch) =>
                setAccountSettings((current) => ({
                  ...current,
                  readerSettings: { ...current.readerSettings, ...patch },
                }))
              }
              onReset={() => {
                window.localStorage.removeItem("nyascans:reader-settings:v1");
                setAccountSettings((current) => ({
                  ...current,
                  readerMode: "VERTICAL",
                  readingDirection: "LTR",
                  brightness: 100,
                  readerTypeDefaults: { manga: "SYSTEM", vertical: "SYSTEM" },
                  commentReplyBadge: true,
                  readerSettings: { ...defaultReaderSettings },
                }));
                void saveAccountSettings(
                  {
                    readerMode: "VERTICAL",
                    readingDirection: "LTR",
                    brightness: 100,
                    readerTypeDefaults: { manga: "SYSTEM", vertical: "SYSTEM" },
                    commentReplyBadge: true,
                    readerSettings: defaultReaderSettings,
                  },
                  "Reader settings restored to defaults.",
                );
              }}
              wakeLockSupported={typeof navigator !== "undefined" && "wakeLock" in navigator}
              volumeNavigationSupported={false}
            />
            <div className="form-grid">
              {(["manga", "vertical"] as const).map((kind) => (
                <label key={kind}>
                  <span>{kind === "manga" ? "Manga default" : "Manhwa / manhua default"}</span>
                  <select
                    value={accountSettings.readerTypeDefaults[kind]}
                    onChange={(event) => setAccountSettings((current) => ({
                      ...current,
                      readerTypeDefaults: { ...current.readerTypeDefaults, [kind]: event.target.value },
                    }))}
                  >
                    <option value="SYSTEM">System default</option>
                    <option value="VERTICAL">Long strip</option>
                    <option value="SINGLE_RTL">Single page · right to left</option>
                    <option value="SINGLE_LTR">Single page · left to right</option>
                    <option value="DOUBLE_RTL">Double page · right to left</option>
                    <option value="DOUBLE_LTR">Double page · left to right</option>
                  </select>
                </label>
              ))}
            </div>
            <label className="settings-check">
              <input type="checkbox" checked={accountSettings.commentReplyBadge} onChange={(event) => setAccountSettings((current) => ({ ...current, commentReplyBadge: event.target.checked }))} />
              <span>Show reply count on the reader comment button</span>
            </label>
            <button
              className="button button-primary"
              type="button"
              disabled={settingsBusy}
              onClick={() =>
                void saveAccountSettings(
                  {
                    readerMode: accountSettings.readerSettings.mode.toUpperCase(),
                    readingDirection: accountSettings.readerSettings.readingDirection.toUpperCase(),
                    brightness: Math.min(100, accountSettings.readerSettings.brightness),
                    readerTypeDefaults: accountSettings.readerTypeDefaults,
                    commentReplyBadge: accountSettings.commentReplyBadge,
                    readerSettings: accountSettings.readerSettings,
                  },
                  "Reader settings saved.",
                )
              }
            >
              {settingsBusy ? "Saving…" : "Save reader settings"}
            </button>
          </form>
        ) : section === "Security" ? (
          <div className="account-setting-card">
            <ShieldCheck size={28} />
            <div>
              <h3>Sign-in security</h3>
              <p>
                Your identity, password, verification, and MFA are managed by
                ChatGPT. NyaScans never stores provider passwords or tokens.
              </p>
            </div>
          </div>
        ) : section === "Connected accounts" ? (
          <div className="connected-account-list">
            <article>
              <span><ShieldCheck size={22} weight="fill" /></span>
              <div>
                <strong>ChatGPT identity</strong>
                <small>{actor.email} · connected</small>
              </div>
              <em>Primary</em>
            </article>
            <p>
              Additional Google, Discord, email, or phone providers require a
              supported external identity service. NyaScans does not simulate
              provider connections or store provider passwords.
            </p>
          </div>
        ) : section === "Notifications" ? (
          <form className="settings-form">
            {[
              ["newChapters", "New chapters from followed series"],
              ...(premiumEconomyPublic
                ? ([
                    ["unlockReminders", "Chapter and balance reminders"],
                    ["purchaseReceipts", "Purchase receipts"],
                  ] as const)
                : []),
              ["securityAlerts", "Security alerts"],
              ["newFollowers", "New followers"],
            ].map(([key, label]) => (
              <label className="settings-check" key={key}>
                <input
                  type="checkbox"
                  checked={
                    accountSettings.notifications[
                      key as keyof typeof accountSettings.notifications
                    ]
                  }
                  onChange={(event) =>
                    setAccountSettings((current) => ({
                      ...current,
                      notifications: {
                        ...current.notifications,
                        [key]: event.target.checked,
                      },
                    }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
            <button
              className="button button-primary"
              type="button"
              disabled={settingsBusy}
              onClick={() =>
                void saveAccountSettings(
                  { notifications: accountSettings.notifications },
                  "Notification choices saved.",
                )
              }
            >
              {settingsBusy ? "Saving…" : "Save notifications"}
            </button>
          </form>
        ) : (
          <div className="preferences-workspace">
            <ProfileSettingsWorkspace mode="privacy" onSaved={showToast} />
            <form className="settings-form">
              <div className="reader-defaults-intro">
                <strong>Personalization and cookies</strong>
                <p>These choices affect recommendations and optional analytics, not your public profile.</p>
              </div>
              {[
              ["showReadingActivity", "Show reading activity on my profile"],
              [
                "personalizedRecommendations",
                "Allow personalized recommendations",
              ],
              ["analyticsCookies", "Use optional analytics cookies"],
              ].filter(([key]) => key !== "showReadingActivity").map(([key, label]) => (
              <label className="settings-check" key={key}>
                <input
                  type="checkbox"
                  checked={
                    accountSettings.privacy[
                      key as keyof typeof accountSettings.privacy
                    ]
                  }
                  onChange={(event) =>
                    setAccountSettings((current) => ({
                      ...current,
                      privacy: {
                        ...current.privacy,
                        [key]: event.target.checked,
                      },
                    }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
              <button
              className="button button-primary"
              type="button"
              disabled={settingsBusy}
              onClick={() =>
                void saveAccountSettings(
                  { privacy: accountSettings.privacy },
                  "Privacy choices saved.",
                )
              }
            >
              {settingsBusy ? "Saving…" : "Save privacy choices"}
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}

type OperationsNavigationGroup = {
  id: string;
  label: string;
  items: ReadonlyArray<readonly [string, PhosphorIcon]>;
};

function OperationsView({
  mode,
  actor,
  initialSectionSlug,
  initialSubsectionSlug,
  initialUploadMode,
}: {
  mode: "dashboard" | "admin";
  actor: Actor;
  initialSectionSlug?: string;
  initialSubsectionSlug?: string;
  initialUploadMode?: "SINGLE" | "BATCH";
}) {
  const admin = mode === "admin";
  const groups = useMemo<OperationsNavigationGroup[]>(() => {
    const actorRoles = actor.roles?.length ? actor.roles : [actor.role];
    const manager = actorRoles.includes("MANAGER");
    const fullAdministrator = actorRoles.some((role) =>
      ["OWNER", "ADMINISTRATOR"].includes(role),
    );
    if (!admin && actor.role === "MODERATOR") {
      return [
        {
          id: "community",
          label: "Community",
          items: [["Comments", ChatCircle] as const],
        },
      ];
    }
    if (!admin) {
      const canUpload = Boolean(
        actor.canUpload ??
          ["TEAM_LEADER", "UPLOADER"].includes(actor.role),
      );
      return [
        {
          id: "publishing",
          label: "Publishing",
          items: [
            ["Workspace", SquaresFour],
            ["Upload center", CloudArrowUp],
            ...(canUpload
              ? ([
                  ["Series", Books],
                  ["Review queue", FileText],
                ] as const)
              : []),
          ] as const,
        },
        {
          id: "community",
          label: "Community & insight",
          items: [
            ...(actor.role === "TEAM_LEADER"
              ? ([
                  ["Comments", ChatCircle],
                  ["Analytics", ChartLineUp],
                ] as const)
              : []),
            ["Rights", ShieldCheck],
            ["Settings", GearSix],
          ] as const,
        },
      ];
    }
    if (manager && !fullAdministrator) {
      return [
        {
          id: "staff-work",
          label: "Manager workspace",
          items: [
            ["New Series Queue", FileText],
            ["Access decisions", LockSimple],
            ["Support tickets", Lifebuoy],
          ] as const,
        },
      ];
    }
    return [
      {
        id: "overview",
        label: "Overview",
        items: [["Overview", SquaresFour]] as const,
      },
      {
        id: "content",
        label: "Content",
        items: [
          ["Series", Books],
          ["Chapter access", LockSimple],
          ["Teams", ShieldCheck],
          ["Sliders", SlidersHorizontal],
          ["Categories & genres", Tag],
          ["Upload center", CloudArrowUp],
          ["New Series Queue", FileText],
          ["Review queue", CheckCircle],
          ["Access decisions", WarningCircle],
          ["Editorial", Star],
        ] as const,
      },
      {
        id: "community",
        label: "Community",
        items: [
          ["Users & roles", UsersThree],
          ["Series Reports", WarningCircle],
          ["Discussions", ChatCircle],
          ["Support tickets", Lifebuoy],
        ] as const,
      },
      {
        id: "finance",
        label: "Finance",
        items: [
          ["Balances", Wallet],
          ["Transactions", Storefront],
          ["Commerce", Coins],
          ["Store Management", Storefront],
          ["Roulette", Sparkle],
        ] as const,
      },
      {
        id: "insights",
        label: "Insights",
        items: [
          ["User activity", Pulse],
          ["Analytics", ChartLineUp],
          ...((actor.roles ?? [actor.role]).includes("OWNER")
            ? ([["Audit log", FileText]] as const)
            : []),
        ] as const,
      },
      {
        id: "system",
        label: "System",
        items: [
          ["Appearance", GearSix],
          ["Announcements & ads", Megaphone],
          ["Security", Key],
          ...((actor.roles ?? [actor.role]).includes("OWNER")
            ? ([["API Control", Key]] as const)
            : []),
        ] as const,
      },
    ];
  }, [actor.canUpload, actor.role, actor.roles, admin]);
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const defaultSection =
    !admin && actor.role === "MODERATOR"
      ? "Comments"
      : admin
        ? actor.roles?.includes("MANAGER") &&
          !actor.roles.some((role) =>
            ["OWNER", "ADMINISTRATOR"].includes(role),
          )
          ? "New Series Queue"
          : "Overview"
        : "Workspace";
  const sectionFromSlug =
    items.find(
      ([label]) =>
        String(label).toLowerCase().replaceAll(" ", "-") ===
        initialSectionSlug?.toLowerCase(),
    )?.[0] ?? defaultSection;
  const [activeSection, setActiveSection] = useState(String(sectionFromSlug));
  const [activeSubsection, setActiveSubsection] = useState(
    initialSubsectionSlug ?? "",
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(groups.map((group) => group.id)),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dirtyState, setDirtyState] = useState({
    dirty: false,
    label: "administrative changes",
  });
  const [pendingNavigation, setPendingNavigation] = useState<{
    section: string;
    subsection?: string;
  } | null>(null);
  const sectionBase = admin ? "/onyx/admin/access" : "/dashboard";

  const sectionHref = useCallback((section: string, subsection?: string) => {
    const base =
      section === defaultSection && !subsection
        ? sectionBase
        : `${sectionBase}/${section.toLowerCase().replaceAll(" ", "-")}`;
    return subsection ? `${base}/${subsection}` : base;
  }, [defaultSection, sectionBase]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.sessionStorage.getItem(
          `nyascans-${mode}-nav-groups`,
        );
        if (stored) {
          const parsed = JSON.parse(stored) as unknown;
          if (Array.isArray(parsed)) {
            setExpandedGroups(
              new Set(parsed.filter((value) => typeof value === "string")),
            );
          }
        }
        setSidebarCollapsed(
          window.localStorage.getItem(
            `nyascans-${mode}-sidebar-collapsed`,
          ) === "true",
        );
      } catch {
        // Session-only navigation preferences are optional.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  const visibleExpandedGroups = expandedGroups;

  useEffect(() => {
    function onDirty(event: Event) {
      const detail = (
        event as CustomEvent<{ dirty?: boolean; label?: string }>
      ).detail;
      setDirtyState({
        dirty: Boolean(detail?.dirty),
        label: detail?.label || "administrative changes",
      });
    }
    window.addEventListener("nyascans-admin-dirty", onDirty);
    return () => window.removeEventListener("nyascans-admin-dirty", onDirty);
  }, []);

  useEffect(() => {
    function syncSectionFromLocation() {
      const pathParts = window.location.pathname
        .slice(sectionBase.length)
        .replace(/^\/+/, "")
        .split("/")
        .filter(Boolean);
      const next =
        items.find(
          ([label]) =>
            String(label).toLowerCase().replaceAll(" ", "-") === pathParts[0],
        )?.[0] ?? defaultSection;
      const nextSubsection = pathParts[1] ?? "";
      if (
        dirtyState.dirty &&
        (String(next) !== activeSection ||
          nextSubsection !== activeSubsection) &&
        !window.confirm(
          `Discard unsaved ${dirtyState.label} and leave this section?`,
        )
      ) {
        window.history.pushState(
          {},
          "",
          sectionHref(activeSection, activeSubsection),
        );
        return;
      }
      setActiveSection(String(next));
      setActiveSubsection(nextSubsection);
    }
    window.addEventListener("popstate", syncSectionFromLocation);
    return () => window.removeEventListener("popstate", syncSectionFromLocation);
  }, [
    activeSection,
    activeSubsection,
    defaultSection,
    dirtyState,
    items,
    sectionBase,
    sectionHref,
  ]);

  function commitSection(section: string, subsection?: string) {
    setActiveSection(section);
    setActiveSubsection(subsection ?? "");
    window.history.pushState({}, "", sectionHref(section, subsection));
  }

  function openSection(
    section: string,
    subsection?: string,
    confirmedDiscard = false,
  ) {
    if (
      dirtyState.dirty &&
      !confirmedDiscard &&
      (section !== activeSection ||
        (subsection ?? "") !== activeSubsection)
    ) {
      setPendingNavigation({ section, subsection });
      return;
    }
    commitSection(section, subsection);
  }

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try {
        window.sessionStorage.setItem(
          `nyascans-${mode}-nav-groups`,
          JSON.stringify([...next]),
        );
      } catch {
        // The grouped navigation remains functional without storage.
      }
      return next;
    });
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(
          `nyascans-${mode}-sidebar-collapsed`,
          String(next),
        );
      } catch {
        // The sidebar remains fully usable without preference persistence.
      }
      return next;
    });
  }

  return (
    <main
      className={`ops-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""} ${
        activeSection === "Upload center" ? "is-upload-center" : ""
      }`}
      data-operations-mode={mode}
    >
      <aside
        className="ops-sidebar"
        aria-label={admin ? "Administration navigation" : "Workspace navigation"}
      >
        <div className="ops-sidebar-head">
          <Logo />
          <button
            className="ops-sidebar-collapse"
            type="button"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="operations-navigation"
            onClick={toggleSidebar}
          >
            <SidebarSimple size={19} />
          </button>
        </div>
        <nav
          className="ops-grouped-nav"
          id="operations-navigation"
          aria-label="Operations sections"
        >
          {groups.map((group) => (
            <section className="ops-nav-group" key={group.id}>
              <button
                className="ops-nav-group-toggle"
                type="button"
                id={`ops-nav-${mode}-${group.id}-toggle`}
                aria-expanded={
                  sidebarCollapsed || visibleExpandedGroups.has(group.id)
                }
                aria-controls={`ops-nav-${mode}-${group.id}-items`}
                onClick={() => toggleGroup(group.id)}
              >
                <span>{group.label}</span>
                <CaretDown size={14} />
              </button>
              <div
                className="ops-nav-group-items"
                id={`ops-nav-${mode}-${group.id}-items`}
                aria-labelledby={`ops-nav-${mode}-${group.id}-toggle`}
                hidden={
                  !sidebarCollapsed && !visibleExpandedGroups.has(group.id)
                }
              >
                {group.items.map(([label, Icon]) => (
                  <a
                    href={sectionHref(String(label))}
                    key={String(label)}
                    title={sidebarCollapsed ? String(label) : undefined}
                    aria-current={activeSection === label ? "page" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      openSection(String(label));
                    }}
                  >
                    <Icon size={18} />
                    <span className="ops-nav-label">{String(label)}</span>
                  </a>
                ))}
              </div>
              {!sidebarCollapsed &&
              !visibleExpandedGroups.has(group.id) &&
              group.items.some(([label]) => label === activeSection) ? (
                <a
                  className="ops-active-pinned"
                  href={sectionHref(activeSection)}
                  aria-current="page"
                  onClick={(event) => event.preventDefault()}
                >
                  {(() => {
                    const ActiveIcon =
                      group.items.find(([label]) => label === activeSection)?.[1] ??
                      SquaresFour;
                    return <ActiveIcon size={18} />;
                  })()}
                  <span className="ops-nav-label">{activeSection}</span>
                </a>
              ) : null}
            </section>
          ))}
        </nav>
        <details className="ops-account-menu">
          <summary aria-label={`Open account menu for ${actor.displayName}`}>
            <span className="ops-account-avatar">
              {actor.avatarUrl ? (
                <img src={actor.avatarUrl} alt="" />
              ) : (
                actor.displayName.slice(0, 1).toUpperCase()
              )}
            </span>
            <span className="ops-account-copy">
              <strong>{actor.displayName}</strong>
              <small>{roleLabel(actor.role)}</small>
            </span>
            <CaretDown size={14} />
          </summary>
          <div>
            <a href="/">
              <House size={17} />
              <span>Reader site</span>
            </a>
            <a href="/signout-with-chatgpt?return_to=%2F">
              <SignOut size={17} />
              <span>Logout</span>
            </a>
          </div>
        </details>
      </aside>
      <section className="ops-main">
        <label className="ops-mobile-section">
          <span>Open section</span>
          <select
            value={activeSection}
            onChange={(event) => openSection(event.target.value)}
          >
            {groups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.items.map(([label]) => (
                  <option key={String(label)} value={String(label)}>
                    {String(label)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <CaretDown size={17} />
        </label>
        {admin && activeSection === "Roulette" ? (
          <RewardSettingsPanel />
        ) : admin && activeSection === "Discussions" ? (
          <ReactionLibraryPanel
            settingsPanel={
              <DiscussionSettingsPanel />
            }
          />
        ) : admin && activeSection === "Appearance" ? (
          <AppearanceWorkspace
            initialTab={
              [
                "branding",
                "reader",
                "footer",
                "theme",
                "palettes",
                "preview",
              ].includes(activeSubsection)
                ? (activeSubsection as
                    | "branding"
                    | "reader"
                    | "footer"
                    | "theme"
                    | "palettes"
                    | "preview")
                : "branding"
            }
            onTabChange={(tab) => openSection("Appearance", tab)}
          />
        ) : (
          <Suspense
            fallback={
              <EmptyState
                title="Loading workspace"
                body="Preparing the protected publishing tools."
                compact
              />
            }
          >
            <OperationsControlPanel
              admin={admin}
              section={activeSection}
              subsection={activeSubsection}
              actorRole={actor.role}
              actorRoles={actor.roles ?? [actor.role]}
              canUpload={Boolean(
                admin ||
                  actor.canUpload ||
                  (actor.roles ?? [actor.role]).some((role) =>
                    ["OWNER", "ADMINISTRATOR"].includes(role),
                  ),
              )}
              canRequestSeries={Boolean(
                admin || actor.canRequestSeries,
              )}
              canManageTeam={Boolean(admin || actor.canManageTeam)}
              onNavigate={openSection}
              initialUploadMode={initialUploadMode}
            />
          </Suspense>
        )}
      </section>
      <ConfirmActionDialog
        open={Boolean(pendingNavigation)}
        title="Discard unsaved changes?"
        description={`Leaving now will discard your unsaved ${dirtyState.label}.`}
        confirmLabel="Discard and continue"
        onCancel={() => setPendingNavigation(null)}
        onConfirm={() => {
          const next = pendingNavigation;
          setPendingNavigation(null);
          if (next) commitSection(next.section, next.subsection);
        }}
      />
    </main>
  );
}

function AccessView({
  actor,
  signInPath,
  adminGate,
}: {
  actor: Actor | null;
  signInPath?: string;
  adminGate?: boolean;
}) {
  return (
    <main className="access-page">
      <section>
        <Logo />
        <span className="access-icon">
          {adminGate ? <ShieldCheck size={30} /> : <CloudArrowUp size={30} />}
        </span>
        <h1>{adminGate ? "Administrator verification" : "Workspace sign-in"}</h1>
        <p>
          {actor
            ? "Your identity is verified, but this account does not have the required role."
            : "This workspace requires an authenticated account before role permissions are evaluated."}
        </p>
        {actor ? (
          <>
            <div className="access-identity">
              <span>{actor.displayName.slice(0, 1)}</span>
              <div><strong>{actor.displayName}</strong><small>{actor.email}</small></div>
            </div>
            <a className="button button-secondary" href="/signout-with-chatgpt?return_to=%2F">
              <SignOut size={18} />
              Logout and use another account
            </a>
          </>
        ) : (
          <a
            className="button button-primary"
            href={signInPath ?? authEntryPath("login", "/")}
          >
            <SignIn size={18} />
            Verify identity
          </a>
        )}
        <small>
          {adminGate
            ? "An active administrator role and server-side policy checks are required. MFA is configured through the identity provider."
            : "Role and active team membership are checked before protected publishing actions."}
        </small>
        <a href="/">Return to NyaScans</a>
      </section>
    </main>
  );
}

function StatusView() {
  const { settings: commercial } = useCommercialSettings();
  const premiumEconomyPublic =
    commercial.economy.premiumEconomyPublic;
  return (
    <main className="page-main page-wrap status-page">
      <section className="status-hero">
        <span><Pulse size={25} /> All systems operational</span>
        <h1>NyaScans status</h1>
        <p>Live service health for readers, uploads, search, and commerce.</p>
      </section>
      <section className="service-list">
        {[
          ["Reader and catalog", "Operational", "99.98%"],
          ["Account and library", "Operational", "99.96%"],
          ["Image delivery", "Operational", "99.99%"],
          ["Search", "Operational", "99.95%"],
          ...(premiumEconomyPublic
            ? ([
                [
                  `Payments and ${commercial.economy.coinPlural}`,
                  "Test mode",
                  "Configuration required",
                ],
              ] as const)
            : []),
          ["Publishing jobs", "Operational", "99.91%"],
        ].map(([service, status, uptime]) => (
          <div key={service}>
            <span className={status === "Test mode" ? "service-test" : "service-ok"}>
              <CheckCircle size={17} weight="fill" />
            </span>
            <strong>{service}</strong>
            <span>{status}</span>
            <small>{uptime}</small>
          </div>
        ))}
      </section>
      <section className="incident-card">
        <h2>Recent incidents</h2>
        <EmptyState title="No incidents in the last 30 days" body="Service notices will appear here with a complete timeline." compact />
      </section>
    </main>
  );
}

function GenericView({
  view,
  resourceSlug,
  signedIn,
  showToast,
}: {
  view: AppView;
  resourceSlug?: string;
  signedIn: boolean;
  showToast: (text: string) => void;
}) {
  const { settings: commercial } = useCommercialSettings();
  const premiumEconomyPublic =
    commercial.economy.premiumEconomyPublic;
  const [supportTopic, setSupportTopic] = useState<
    "ACCOUNT" | "READING" | "PURCHASES" | "PUBLISHING"
  >("ACCOUNT");
  const [supportFormOpen, setSupportFormOpen] = useState(false);
  const supportTopics = {
    ACCOUNT: {
      label: "Account and security",
      icon: Key,
      title: "Secure and recover your account",
      intro:
        "Use your account settings first, then open a private ticket if access or identity still needs staff help.",
      steps: [
        "Update your profile, password, privacy, and notification choices from Settings.",
        "Review active sessions and revoke any device you do not recognize.",
        "Never include a password, recovery code, or payment secret in a ticket.",
      ],
    },
    READING: {
      label: "Reading and library",
      icon: Books,
      title: "Fix progress, followed series, and chapter access",
      intro:
        "Your Library import/export includes saved series and reading progress. A ticket can restore mismatched progress without exposing public history.",
      steps: [
        "Refresh the chapter once and confirm you are signed into the expected account.",
        "Export Library data before a large import or manual cleanup.",
        "Include the series, chapter number, device, and approximate time in your ticket.",
      ],
    },
    PURCHASES: {
      label: `Purchases and ${commercial.economy.coinPlural}`,
      icon: Wallet,
      title: "Orders, wallet balance, and gift codes",
      intro:
        "Wallet activity is server-verified. Gift cards can be redeemed once by their intended recipient.",
      steps: [
        "Check Wallet and Orders for the transaction status and reference.",
        "Keep the full gift code private; staff only need the last four characters.",
        "For a missing balance, include the order reference and payment time.",
      ],
    },
    PUBLISHING: {
      label: "Publishing help",
      icon: UploadSimple,
      title: "Series, chapters, teams, and uploads",
      intro:
        "Publishing requests keep rights, team, language, and upload details together for staff review.",
      steps: [
        "Confirm the correct team and series before uploading chapters.",
        "Use the crop and auto-compression preview for logos, banners, and covers.",
        "Include the series slug and upload job identifier when reporting a failure.",
      ],
    },
  } as const;
  const activeSupportTopicKey =
    !premiumEconomyPublic && supportTopic === "PURCHASES"
      ? "ACCOUNT"
      : supportTopic;
  const activeSupportTopic = supportTopics[activeSupportTopicKey];
  const legalDocument =
    LEGAL_DOCUMENTS_BY_SLUG[resourceSlug ?? "terms"] ??
    LEGAL_DOCUMENTS_BY_SLUG.terms;
  const [title, intro] =
    view === "legal"
      ? [legalDocument.title, legalDocument.summary]
      : view === "support"
        ? ["Support", "Find an answer or open a tracked support ticket."]
        : view === "rankings"
              ? [
                  "Users Ranking",
                  "Weekly, monthly, and all-time Top 100 based on collected Shards and community contribution.",
                ]
              : ["Explore NyaScans", "This product area is connected to the shared catalog and account system."];

  return (
    <main className="page-main page-wrap generic-page">
      <section className="generic-hero">
        <h1>{title}</h1>
        <p>{intro}</p>
      </section>
      {view === "rankings" ? (
        <UserLeaderboardView />
      ) : view === "support" ? (
        <section className="support-grid">
          <div className="support-topic-grid" role="group" aria-label="Support topics">
            {(Object.entries(supportTopics) as Array<
              [keyof typeof supportTopics, (typeof supportTopics)[keyof typeof supportTopics]]
            >)
              .filter(
                ([key]) =>
                  premiumEconomyPublic || key !== "PURCHASES",
              )
              .map(([key, topic]) => {
              const Icon = topic.icon;
              return (
                <button
                  type="button"
                  aria-pressed={activeSupportTopicKey === key}
                  className={activeSupportTopicKey === key ? "active" : ""}
                  key={key}
                  onClick={() => setSupportTopic(key)}
                >
                  <Icon size={24} />
                  <strong>{topic.label}</strong>
                  <ArrowRight size={17} />
                </button>
              );
            })}
          </div>
          <article className="support-help-article" aria-live="polite">
            <div>
              <span>Help guide</span>
              <h2>{activeSupportTopic.title}</h2>
              <p>{activeSupportTopic.intro}</p>
            </div>
            <ol>
              {activeSupportTopic.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {signedIn ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setSupportFormOpen(true);
                  window.requestAnimationFrame(() =>
                    document
                      .getElementById("support-ticket-workspace")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  );
                }}
              >
                Still need help? Open a ticket
                <ArrowRight size={17} />
              </button>
            ) : (
              <a
                className="button button-secondary"
                href="/login?return_to=/support"
              >
                Sign in to open a ticket
                <ArrowRight size={17} />
              </a>
            )}
          </article>
          <div id="support-ticket-workspace">
            <SupportTicketPanel
              signedIn={signedIn}
              initialCategory={activeSupportTopicKey}
              premiumEconomyPublic={premiumEconomyPublic}
              formOpen={supportFormOpen}
              onFormOpenChange={setSupportFormOpen}
              showToast={showToast}
            />
          </div>
        </section>
      ) : view === "legal" ? (
        <article className="legal-article">
          <aside aria-label="Legal documents">
            {LEGAL_DOCUMENTS.map((document) => (
              <a
                href={`/legal/${document.slug}`}
                key={document.slug}
                aria-current={
                  document.slug === legalDocument.slug ? "page" : undefined
                }
              >
                {document.title}
              </a>
            ))}
          </aside>
          <div className="legal-document">
            <dl className="legal-document-meta">
              <div>
                <dt>Effective</dt>
                <dd>{legalDocument.effectiveDate}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{legalDocument.updatedDate}</dd>
              </div>
            </dl>
            <nav className="legal-section-nav" aria-label="On this page">
              {legalDocument.sections.map((section) => (
                <a href={`#${section.id}`} key={section.id}>
                  {section.title}
                </a>
              ))}
            </nav>
            {legalDocument.sections.map((section) => (
              <section id={section.id} key={section.id}>
                <h2>{section.title}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets?.length ? (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
            <p className="legal-updated">
              Questions or tracked requests can be sent through{" "}
              <a href="/support">NyaScans Support</a>.
            </p>
          </div>
        </article>
      ) : (
        <section className="generic-content-card">
          <h2>Explore the platform</h2>
          <p>
            Use the main navigation or press Ctrl+K to find a title, team, or
            creator.
          </p>
        </section>
      )}
    </main>
  );
}

function ErrorView({ code = "404" }: { code?: string }) {
  const copy: Record<string, [string, string]> = {
    "403": ["This panel is restricted.", "Your account does not have permission to open this area."],
    "404": ["This page left the archive.", "The link may have changed, or the story is no longer available."],
    "409": ["That action crossed another update.", "Refresh the current state before trying again."],
    "429": ["Too many pages turned at once.", "Wait a moment, then continue at a calmer pace."],
    "500": ["The panel slipped out of place.", "We could not finish this request. Your reading progress is safe."],
  };
  const [title, body] = copy[code] ?? copy["404"];
  return (
    <main className="error-page">
      <Logo />
      <span>{code}</span>
      <h1>{title}</h1>
      <p>{body}</p>
      <div>
        <a className="button button-primary" href="/">Return home</a>
        <a className="button button-secondary" href="/support">Get help</a>
      </div>
    </main>
  );
}

function FooterGroup({
  title,
  links,
  onOpenShortcuts,
}: {
  title: string;
  links: string[][];
  onOpenShortcuts: () => void;
}) {
  const key = `nyascans:footer:${title.toLowerCase()}`;
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        try {
          setOpen(window.sessionStorage.getItem(key) === "open");
        } catch {
          setOpen(false);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 821px)");
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const panelId = `${key.replaceAll(":", "-")}-links`;
  const expanded = desktop || open;
  return (
    <section
      className="footer-group"
      data-open={expanded ? "true" : "false"}
    >
      <button
        className="footer-group-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={desktop}
        onClick={() => {
          if (desktop) return;
          const next = !open;
          setOpen(next);
          try {
            window.sessionStorage.setItem(key, next ? "open" : "closed");
          } catch {
            // Session storage availability never blocks footer navigation.
          }
        }}
      >
        {title}
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      <div id={panelId} hidden={!expanded}>
        {links.map(([label, href]) =>
          href === "#keyboard-shortcuts" ? (
            <button
              className="footer-inline-action"
              type="button"
              key={label}
              onClick={onOpenShortcuts}
            >
              {label}
            </button>
          ) : (
            <a href={href} key={label}>
              {label}
            </a>
          ),
        )}
      </div>
    </section>
  );
}

function SiteFooter({
  onOpenShortcuts,
}: {
  onOpenShortcuts: () => void;
}) {
  const { settings } = useSiteConfiguration();
  const groups = [
    {
      title: "Browse",
      links: [
        ["Latest Updates", "/latest"],
        ["Users Ranking", "/rankings"],
        ["Completed", "/browse?status=completed"],
        ["Genres", "/browse#genres"],
      ],
    },
    {
      title: "Community",
      links: [
        ["Teams", "/browse?view=teams"],
        ["Latest Top Comments", "/#community"],
        ["Support", "/support"],
        ["Keyboard shortcuts", "#keyboard-shortcuts"],
        ["Contact", "mailto:support@nyascans.com"],
      ],
    },
    {
      title: "Legal",
      links: [
        ["Privacy Policy", "/legal/privacy"],
        ["Terms of Service", "/legal/terms"],
        ["Content Removal / DMCA", "/legal/copyright"],
        ["Content Policy", "/legal/content-policy"],
      ],
    },
  ];
  return (
    <footer className="site-footer">
      <div className="page-wrap footer-main">
        <div className="footer-brand">
          <Logo />
          <p>
            {settings.brand.shortDescription ||
              "A focused home for manga, manhwa, manhua, webtoons, readers, and the teams that make every release possible."}
          </p>
          <div className="footer-socials" aria-label="Social links">
            {settings.footer.socialLinks
              .filter((link) => link.enabled && link.url)
              .map((link) => {
                return (
                  <a
                    href={link.url}
                    key={link.id}
                    target={link.openInNewTab ? "_blank" : undefined}
                    rel={
                      link.openInNewTab ? "noreferrer noopener" : undefined
                    }
                  >
                    {link.label}
                  </a>
                );
              })}
          </div>
        </div>
        <div className="footer-links">
          {groups.map((group) => (
            <FooterGroup
              key={group.title}
              title={group.title}
              links={group.links}
              onOpenShortcuts={onOpenShortcuts}
            />
          ))}
        </div>
      </div>
      <div className="page-wrap footer-bottom">
        <span>© 2026 NyaScans. Original platform artwork.</span>
      </div>
    </footer>
  );
}

function useAnchoredMenuDismissal() {
  useEffect(() => {
    const menuSelectors = [
      ".latest-language-filter",
      ".compact-language-menu",
      ".compact-option-menu",
      ".series-language-action",
      ".ops-account-menu",
    ];
    const menuSelector = menuSelectors.join(",");
    const openMenuSelector = menuSelectors
      .map((selector) => `${selector}[open]`)
      .join(",");
    let positionFrame = 0;
    const positionMenu = (menu: HTMLDetailsElement) => {
      const summary = menu.querySelector<HTMLElement>(":scope > summary");
      const panel = menu.querySelector<HTMLElement>(":scope > div");
      if (!summary || !panel || !menu.open) return;
      const gutter = 12;
      const gap = 8;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const summaryRect = summary.getBoundingClientRect();
      const desiredWidth = Math.min(
        Math.max(panel.scrollWidth, 232),
        viewportWidth - gutter * 2,
      );
      const alignLeft = Boolean(
        menu.closest(".catalog-toolbar, .catalog-summary"),
      );
      const left = Math.min(
        viewportWidth - desiredWidth - gutter,
        Math.max(
          gutter,
          alignLeft ? summaryRect.left : summaryRect.right - desiredWidth,
        ),
      );
      let top = summaryRect.bottom + gap;
      panel.style.setProperty("--anchored-menu-left", `${left}px`);
      panel.style.setProperty("--anchored-menu-top", `${top}px`);
      panel.style.setProperty("--anchored-menu-width", `${desiredWidth}px`);
      const measuredHeight = Math.min(panel.scrollHeight, viewportHeight - gutter * 2);
      if (
        menu.matches(".ops-account-menu") &&
        viewportHeight - top < Math.min(160, measuredHeight) &&
        summaryRect.top > measuredHeight + gap + gutter
      ) {
        top = summaryRect.top - measuredHeight - gap;
        panel.style.setProperty("--anchored-menu-top", `${top}px`);
      }
      panel.style.setProperty(
        "--anchored-menu-max-height",
        `${Math.max(120, viewportHeight - top - gutter)}px`,
      );
      menu.dataset.anchored = "true";
    };
    const queueOpenMenuPosition = () => {
      window.cancelAnimationFrame(positionFrame);
      positionFrame = window.requestAnimationFrame(() => {
        document
          .querySelectorAll<HTMLDetailsElement>(openMenuSelector)
          .forEach(positionMenu);
      });
    };
    const closeMenus = (except?: HTMLDetailsElement | null) => {
      document
        .querySelectorAll<HTMLDetailsElement>(openMenuSelector)
        .forEach((menu) => {
          if (menu !== except) {
            menu.removeAttribute("open");
            delete menu.dataset.anchored;
          }
        });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      document
        .querySelectorAll<HTMLDetailsElement>(openMenuSelector)
        .forEach((menu) => {
          if (!menu.contains(target)) {
            menu.removeAttribute("open");
            delete menu.dataset.anchored;
          }
        });
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const openMenu = document.querySelector<HTMLDetailsElement>(
        openMenuSelector,
      );
      if (!openMenu) return;
      event.preventDefault();
      openMenu.removeAttribute("open");
      delete openMenu.dataset.anchored;
      openMenu.querySelector<HTMLElement>("summary")?.focus();
    };
    const onToggle = (event: Event) => {
      const menu = event.target;
      if (
        menu instanceof HTMLDetailsElement &&
        menu.matches(menuSelector)
      ) {
        if (menu.open) {
          closeMenus(menu);
          menu.dataset.anchored = "false";
          queueOpenMenuPosition();
        } else {
          delete menu.dataset.anchored;
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("toggle", onToggle, true);
    window.addEventListener("resize", queueOpenMenuPosition);
    const passiveCapture = { capture: true, passive: true } as const;
    document.addEventListener("scroll", queueOpenMenuPosition, passiveCapture);
    return () => {
      window.cancelAnimationFrame(positionFrame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("toggle", onToggle, true);
      window.removeEventListener("resize", queueOpenMenuPosition);
      document.removeEventListener("scroll", queueOpenMenuPosition, passiveCapture);
    };
  }, []);
}

export function NyaScansApp({
  view,
  actor,
  authenticatedIdentity = null,
  accountBlocked = false,
  authReturnTo = "/account",
  resourceSlug,
  chapterSlug,
  uploadMode,
  signInPath,
  adminGate,
  operationPath,
}: AppProps) {
  useAnchoredMenuDismissal();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const navigationChordAt = useRef(0);
  const { settings: commercialSettings } = useCommercialSettings();
  const lockAndPayVisible =
    commercialSettings.economy.premiumEconomyPublic ||
    Boolean(actor?.roles?.includes("OWNER") || actor?.role === "OWNER");
  const { notifyText } = useSystemNotifications();
  const showToast = useCallback(
    (message: string) => {
      notifyText(message);
    },
    [notifyText],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem("nyascans-theme");
    const next =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    const frame = window.requestAnimationFrame(() => {
      setTheme(next);
      document.documentElement.dataset.theme = next;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (event.key === "Escape") {
        setSearchOpen(false);
        setShortcutsOpen(false);
        navigationChordAt.current = 0;
        return;
      }
      if (
        document.querySelector(
          '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
        )
      ) {
        return;
      }
      if (
        event.key.toLowerCase() === "k" &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        setShortcutsOpen(false);
        setSearchOpen(true);
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "?") {
        event.preventDefault();
        setSearchOpen(false);
        setShortcutsOpen(true);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "g") {
        navigationChordAt.current = Date.now();
        return;
      }
      if (
        navigationChordAt.current &&
        Date.now() - navigationChordAt.current <= 1_500
      ) {
        navigationChordAt.current = 0;
        const destination =
          SITE_NAVIGATION_CHORDS[
            key as keyof typeof SITE_NAVIGATION_CHORDS
          ];
        if (destination) {
          event.preventDefault();
          window.location.assign(destination);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const eventType: AnalyticsEventType | null =
      view === "home"
        ? "HOME_VIEW"
        : view === "latest"
          ? "LATEST_VIEW"
          : view === "browse"
            ? "BROWSE_VIEW"
            : view === "title"
              ? "SERIES_VIEW"
              : null;
    if (!eventType) return;
    recordAnalyticsEvent(
      eventType,
      eventType === "SERIES_VIEW" ? { seriesSlug: resourceSlug } : {},
    );
  }, [resourceSlug, view]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("nyascans-theme", next);
  }

  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const commonOverlays = (
    <>
      {searchOpen ? (
        <SearchOverlay onClose={() => setSearchOpen(false)} />
      ) : null}
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={closeShortcuts}
      />
    </>
  );

  if (view === "reader") {
    return (
      <>
        <ReaderView
          slug={resourceSlug}
          chapterSlug={chapterSlug}
          actor={actor}
          showToast={showToast}
        />
        {commonOverlays}
      </>
    );
  }

  if (view === "dashboard" && actor) {
    return (
      <div className="site-shell workspace-site-shell">
        <SiteHeader
          key={actor?.email ?? "guest"}
          view={view}
          actor={actor}
          theme={theme}
          onTheme={toggleTheme}
          onSearch={() => setSearchOpen(true)}
          lockAndPayVisible={lockAndPayVisible}
        />
        <OperationsView
          mode="dashboard"
          actor={actor}
          initialSectionSlug={operationPath?.[0] ?? resourceSlug}
          initialSubsectionSlug={operationPath?.[1]}
          initialUploadMode={uploadMode}
        />
        <SiteFooter onOpenShortcuts={() => setShortcutsOpen(true)} />
        <MobileNav view={view} actor={actor} lockAndPayVisible={lockAndPayVisible} />
        {commonOverlays}
      </div>
    );
  }
  if (view === "admin" && actor) {
    return (
      <>
        <OperationsView
          mode="admin"
          actor={actor}
          initialSectionSlug={operationPath?.[0] ?? resourceSlug}
          initialSubsectionSlug={operationPath?.[1]}
          initialUploadMode={uploadMode}
        />
        {commonOverlays}
      </>
    );
  }
  if (view === "access") {
    return (
      <>
        <AccessView actor={actor} signInPath={signInPath} adminGate={adminGate} />
        {commonOverlays}
      </>
    );
  }
  if (view === "error") {
    return (
      <>
        <ErrorView code={resourceSlug} />
        {commonOverlays}
      </>
    );
  }

  const mainContent =
    view === "home" ? (
      <HomeView actor={actor} showToast={showToast} />
    ) : view === "latest" ? (
      <LatestUpdatesView />
    ) : view === "browse" ? (
      <BrowseView showToast={showToast} />
    ) : view === "library" ? (
      <LibraryView actor={actor} />
    ) : ["store", "wallet", "orders"].includes(view) && !lockAndPayVisible ? (
      <main className="page-main page-wrap lock-and-pay-private-view">
        <section>
          <ShieldCheck size={34} />
          <p className="eyebrow">Free reading mode</p>
          <h1>Every public release is free.</h1>
          <p>Purchases, wallets, paid chapters, and payment history are private while Chapters Lock &amp; Pay is disabled.</p>
          <a className="button button-primary" href="/browse">Browse free releases</a>
        </section>
      </main>
    ) : view === "store" ? (
      <StoreView
        actor={actor}
        category={resourceSlug}
        showToast={showToast}
      />
    ) : view === "title" ? (
      <TitleView slug={resourceSlug} actor={actor} showToast={showToast} />
    ) : view === "wallet" ? (
      <WalletView actor={actor} />
    ) : view === "orders" ? (
      <OrdersView actor={actor} />
    ) : view === "roulette" ? (
      <RouletteView signedIn={Boolean(actor)} showToast={showToast} />
    ) : view === "login" || view === "signup" ? (
      <AuthEntryView
        intent={view}
        actor={actor}
        authenticatedIdentity={authenticatedIdentity}
        accountBlocked={accountBlocked}
        returnTo={authReturnTo}
      />
    ) : view === "account" ? (
      <AccountView actor={actor} showToast={showToast} />
    ) : view === "profile" ? (
      <PublicProfileView username={resourceSlug ?? ""} />
    ) : view === "notifications" ? (
      <NotificationsView actor={actor} />
    ) : view === "team" ? (
      <PublicTeamView slug={resourceSlug} signedIn={Boolean(actor)} />
    ) : view === "teams" ? (
      <PublishingTeamsDirectory />
    ) : view === "status" ? (
      <StatusView />
    ) : (
      <GenericView
        view={view}
        resourceSlug={resourceSlug}
        signedIn={Boolean(actor)}
        showToast={showToast}
      />
    );

  return (
    <div
      className="site-shell"
      data-premium-economy={
        commercialSettings.economy.premiumEconomyPublic ? "public" : "hidden"
      }
    >
      <SiteHeader
        key={actor?.email ?? "guest"}
        view={view}
        actor={actor}
        theme={theme}
        onTheme={toggleTheme}
        onSearch={() => setSearchOpen(true)}
        lockAndPayVisible={lockAndPayVisible}
      />
      {mainContent}
      <SiteFooter onOpenShortcuts={() => setShortcutsOpen(true)} />
      <MobileNav view={view} actor={actor} lockAndPayVisible={lockAndPayVisible} />
      {commonOverlays}
    </div>
  );
}
