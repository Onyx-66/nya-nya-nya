"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";
import { latestPageItems } from "./latest-pagination";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
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
  ClockCounterClockwise,
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
  HashStraight,
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
  Palette,
  Play,
  Plus,
  Pulse,
  PushPin,
  ShieldCheck,
  SidebarSimple,
  SignIn,
  SignOut,
  SlidersHorizontal,

  SquaresFour,
  Sparkle,
  Star,
  Storefront,
  Tag,
  TagSimple,
  ThumbsUp,
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
} from "@/components/nyascans/heroicons";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  Fragment,
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import browseFixes from "./BrowseFixes.module.css";
import { AccountSecurityWorkspace } from "@/components/nyascans/AccountSecurityWorkspace";
import { LanguageFlag } from "@/components/nyascans/LanguageFlag";
import { EnhancedDiscussionSection } from "@/components/nyascans/EnhancedDiscussionSection";
import { GiftStorePanel } from "@/components/nyascans/GiftStorePanel";
import { HotThisWeek } from "@/components/nyascans/HotThisWeek";
import { FormattedAnnouncementText } from "@/components/nyascans/FormattedAnnouncementText";
import { KeyboardShortcutsDialog } from "@/components/nyascans/KeyboardShortcutsDialog";
import {
  DiscountsDirectory,
  DiscountsSection,
  RecentReviewsSection,
  PinnedSeriesDirectory,
  PinnedSeriesSection,
} from "@/components/nyascans/HomeFeatureSections";
import { HomeRailControls } from "@/components/nyascans/HomeRailControls";
import { SupportTicketPanel } from "@/components/nyascans/SupportTicketPanel";
import { useSystemNotifications } from "@/components/nyascans/SystemNotifications";
import { LibraryWorkspace } from "@/components/nyascans/LibraryWorkspace";
import { NotificationsView } from "@/components/nyascans/NotificationsView";
import {
  NotificationArtwork,
  type NotificationSeries,
} from "@/components/nyascans/NotificationArtwork";
import { ProfileSettingsWorkspace } from "@/components/nyascans/ProfileSettingsWorkspace";
import { ThemeBuilderPage } from "@/components/nyascans/ThemeBuilderPage";
import { ThemeAwareLogo } from "@/components/nyascans/ThemeAwareLogo";
import {
  useUserThemeController,
  type ThemeController,
} from "@/components/nyascans/UserThemeSystem";
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
import { mockAvatarUrl } from "@/lib/mock-media";
import { AppearanceWorkspace } from "@/components/nyascans/admin/AppearanceWorkspace";
import { BotActivityPanel } from "@/components/nyascans/admin/BotActivityPanel";
import { ConfirmActionDialog } from "@/components/nyascans/admin/AdminPageScaffold";
import { IdentifiersPanel } from "@/components/nyascans/admin/IdentifiersPanel";
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
import { APP_VERSION } from "@/lib/app-version";
import {
  ADMIN_COMMON_ACTIONS,
  adminNavigationGroupsForCapabilities,
  findAdminNavigationDestination,
  normalizeAdminNavigationKey,
  type AdminNavigationChild,
} from "@/lib/admin-navigation";
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
import { fetchWithHomeTimeout, homeRequestMessage } from "@/lib/home-fetch";
import {
  isCustomThemeReference,
  MAX_SHORTLISTED_THEMES,
  themeForReference,
  userThemePresets,
  type ActiveThemeId,
} from "@/lib/theme-system";

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
  | "theme-builder"
  | "profile"
  | "login"
  | "signup"
  | "title"
  | "reader"
  | "wallet"
  | "notifications"
  | "latest"
  | "pinned"
  | "discounts"
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
  authMethod?: "CHATGPT" | "PASSWORD" | "PASSKEY";
  avatarUrl?: string | null;
  canUseUploadCenter?: boolean;
  canUpload?: boolean;
  canRequestSeries?: boolean;
  canManageTeam?: boolean;
  capabilities?: string[];
  adminFeatures?: {
    premiumUnlocks: boolean;
    payments: boolean;
    memberships: boolean;
    adSupportedUnlocks: boolean;
    teamPayouts: boolean;
  };
};

type HeaderNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  actionUrl: string | null;
  createdAt: string;
  category: "UPDATES" | "ANNOUNCEMENTS" | "SOCIAL";
  series: NotificationSeries | null;
};

type AppProps = {
  view: AppView;
  actor: Actor | null;
  authenticatedIdentity?: Pick<
    Actor,
    "displayName" | "email" | "authMethod"
  > | null;
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

function LogoutAction({
  returnTo = "/",
  className,
  role,
  onStart,
  children,
}: {
  authMethod?: Actor["authMethod"];
  returnTo?: string;
  className?: string;
  role?: string;
  onStart?: () => void;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      role={role}
      type="button"
      disabled={busy}
      onClick={async () => {
        onStart?.();
        setBusy(true);
        try {
          const response = await fetch("/api/v1/auth/logout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ returnTo }),
          });
          const payload = (await response.json()) as {
            returnTo?: string;
            providerSignOutPath?: string | null;
          };
          if (!response.ok) throw new Error("Logout failed");
          window.location.assign(
            payload.providerSignOutPath || payload.returnTo || returnTo,
          );
        } catch {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
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

function headerNotificationLabel(notification: HeaderNotification) {
  if (/CHAPTER|RELEASE|UPDATE/u.test(notification.kind)) return "New update";
  if (/SERIES/u.test(notification.kind)) return "New series";
  if (notification.category === "SOCIAL") return "Community";
  if (notification.category === "ANNOUNCEMENTS") return "Announcement";
  return "Update";
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
          <ThemeAwareLogo />
        </span>
      )}
      <span className="brand-name">{settings.brand.siteName}</span>
    </a>
  );
}

function ThemeSelectionMenu({
  controller,
  onBack,
  onClose,
}: {
  controller: ThemeController;
  onBack: () => void;
  onClose: () => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const [menuError, setMenuError] = useState("");
  const backButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => backButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const entryFor = (id: ActiveThemeId) => {
    const theme = themeForReference(controller.preference, id);
    if (!theme) return null;
    return {
      id,
      theme,
      source: isCustomThemeReference(id) ? "Custom" : "Preset",
    } as const;
  };
  const shortlistEntries = controller.shortlist
    .map(entryFor)
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const globalEntries = controller.suggestedThemes.map((entry) => ({
    id: entry.id,
    theme: entry.theme,
    source: entry.source === "USER" ? "Community" : "Preset",
  }));
  const personalEntries = [
    ...userThemePresets.map((preset) => entryFor(preset.id)),
    ...controller.customThemes.map((saved) =>
      entryFor(`custom:${saved.id}` as ActiveThemeId),
    ),
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const allEntries = Array.from(
    new Map(
      [...globalEntries, ...personalEntries].map((entry) => [entry.id, entry]),
    ).values(),
  );

  const choose = async (id: ActiveThemeId) => {
    if (!controller.hydrated || controller.syncing) return;
    setMenuError("");
    try {
      const applied = await controller.selectTheme(id);
      if (applied) onClose();
    } catch (caught) {
      setMenuError(
        caught instanceof Error ? caught.message : "The theme could not be applied.",
      );
    }
  };

  const toggleShortlist = async (id: ActiveThemeId) => {
    const selected = controller.shortlist.includes(id);
    if (selected && controller.activeThemeId === id) {
      setMenuError("Apply another theme before removing the active theme.");
      return;
    }
    if (!selected && controller.shortlist.length >= MAX_SHORTLISTED_THEMES) {
      setMenuError("Your shortlist is full. Remove a theme before adding another.");
      return;
    }
    setMenuError("");
    try {
      await controller.setShortlist(
        selected
          ? controller.shortlist.filter((reference) => reference !== id)
          : [...controller.shortlist, id],
      );
    } catch (caught) {
      setMenuError(
        caught instanceof Error ? caught.message : "The shortlist could not be changed.",
      );
    }
  };

  return (
    <div className="header-theme-selector">
      <header>
        <button
          ref={backButtonRef}
          type="button"
          role="menuitem"
          aria-label={manageOpen ? "Back to selected themes" : "Back to site menu"}
          onClick={manageOpen ? () => setManageOpen(false) : onBack}
        >
          <CaretLeft size={18} />
        </button>
        <strong>{manageOpen ? "Manage themes" : "Select Theme"}</strong>
        <span aria-hidden="true" />
      </header>
      <div
        className={manageOpen ? "header-theme-options is-managing" : "header-theme-options"}
        aria-label={manageOpen ? "Manage quick-switch themes" : "Quick-switch themes"}
      >
        {(manageOpen ? allEntries : shortlistEntries).map((entry) => {
          const selected = controller.activeThemeId === entry.id;
          const shortlisted = controller.shortlist.includes(entry.id);
          return (
            <div className={selected ? "header-theme-option is-selected" : "header-theme-option"} key={entry.id}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={!controller.hydrated || controller.syncing}
                onClick={() => void choose(entry.id)}
              >
                <i
                  aria-hidden="true"
                  style={{
                    background: `conic-gradient(from 35deg, ${entry.theme.tokens.primary}, ${entry.theme.tokens.accentL3}, ${entry.theme.tokens.mainBackground}, ${entry.theme.tokens.primary})`,
                  }}
                />
                <span>
                  <strong>{entry.theme.name}</strong>
                  <small>{entry.source} · {entry.theme.type}</small>
                </span>
                {selected ? <Check size={17} weight="bold" /> : null}
              </button>
              {manageOpen ? (
                <button
                  className="header-theme-shortlist-toggle"
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={shortlisted}
                  aria-label={`${shortlisted ? "Remove" : "Add"} ${entry.theme.name} ${shortlisted ? "from" : "to"} quick switching`}
                  disabled={controller.syncing || (selected && shortlisted)}
                  onClick={() => void toggleShortlist(entry.id)}
                >
                  {shortlisted ? <Check size={15} weight="bold" /> : <Plus size={15} />}
                </button>
              ) : null}
            </div>
          );
        })}
        {!manageOpen ? (
          <div className="header-theme-manage-row">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setManageOpen(true);
              window.requestAnimationFrame(() => backButtonRef.current?.focus());
            }}
          >
            <i className="is-custom" aria-hidden="true"><Palette size={15} /></i>
            <span>
              <strong>Manage themes</strong>
              <small>{controller.shortlist.length} / {MAX_SHORTLISTED_THEMES} selected</small>
            </span>
            <CaretRight size={16} />
          </button>
          <a
            role="menuitem"
            href="/theme-builder#manage-themes"
            aria-label="Open saved custom theme settings"
            title="Saved custom theme settings"
            onClick={onClose}
          >
            <GearSix size={18} />
          </a>
        </div>
        ) : (
          <a className="header-theme-builder-link" role="menuitem" href="/theme-builder#manage-themes" onClick={onClose}>
            <GearSix size={17} /> Create, edit, or delete custom themes
          </a>
        )}
      </div>
      {menuError || controller.syncError ? (
        <p className="header-theme-sync-error" role="status">
          {menuError || controller.syncError}
        </p>
      ) : null}
    </div>
  );
}

function SiteHeader({
  view,
  actor,
  themeController,
  onSearch,
  lockAndPayVisible,
}: {
  view: AppView;
  actor: Actor | null;
  themeController: ThemeController;
  onSearch: () => void;
  lockAndPayVisible: boolean;
}) {
  const elevated = elevatedDestination(actor);
  const canUpload = Boolean(actor?.canUseUploadCenter);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPanel, setMenuPanel] = useState<"main" | "theme">("main");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationRecords, setNotificationRecords] = useState<
    HeaderNotification[]
  >([]);
  const [notificationsLoading, setNotificationsLoading] = useState(
    Boolean(actor),
  );
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationsActionError, setNotificationsActionError] = useState("");
  const [notificationBusy, setNotificationBusy] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(
    () => actor?.avatarUrl ?? null,
  );
  useEffect(() => {
    setProfileAvatarUrl(actor?.avatarUrl ?? null);
  }, [actor?.avatarUrl]);
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
          '.header-overflow-menu [role="menuitem"]:not([disabled]), .header-overflow-menu [role="menuitemradio"]:not([disabled]), .header-overflow-menu [role="menuitemcheckbox"]:not([disabled])',
        ) ?? [],
      );
      const item = position === "first" ? items[0] : items.at(-1);
      item?.focus();
    });
  }

  function returnToMainMenu() {
    setMenuPanel("main");
    window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(".header-change-theme")
        ?.focus();
    });
  }

  function closeMenuAndRestoreFocus() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  function handleMenuKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!menuOpen) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])',
      ),
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

  async function updateHeaderNotifications(
    action: "READ" | "READ_ALL",
    notificationId?: string,
    destination?: string,
  ) {
    if (notificationBusy) return;
    const previousRecords = notificationRecords;
    const previousUnreadCount = unreadCount;
    const timestamp = new Date().toISOString();
    const targetWasUnread = notificationId
      ? previousRecords.some(
          (record) => record.id === notificationId && !record.readAt,
        )
      : false;
    setNotificationBusy(action === "READ_ALL" ? "all" : (notificationId ?? ""));
    setNotificationsActionError("");
    setNotificationRecords((current) =>
      current.map((record) =>
        action === "READ_ALL" || record.id === notificationId
          ? { ...record, readAt: record.readAt ?? timestamp }
          : record,
      ),
    );
    setUnreadCount((current) =>
      action === "READ_ALL"
        ? 0
        : targetWasUnread
          ? Math.max(0, current - 1)
          : current,
    );
    try {
      const response = await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          ...(notificationId ? { id: notificationId } : {}),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.error?.message ?? "The notification could not be updated.",
        );
      }
      window.dispatchEvent(
        new CustomEvent("nyascans:notifications-changed", {
          detail: { action, id: notificationId ?? null },
        }),
      );
      if (destination) {
        setNotificationsOpen(false);
        window.location.assign(destination);
      }
    } catch (error) {
      setNotificationRecords(previousRecords);
      setUnreadCount(previousUnreadCount);
      setNotificationsActionError(
        error instanceof Error
          ? error.message
          : "The notification could not be updated.",
      );
    } finally {
      setNotificationBusy("");
    }
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
                      <button
                        type="button"
                        className="header-notification-mark-all"
                        disabled={!unreadCount || Boolean(notificationBusy)}
                        onClick={() => void updateHeaderNotifications("READ_ALL")}
                      >
                        <CheckCircle size={16} aria-hidden="true" />
                        {notificationBusy === "all" ? "Marking…" : "Mark all as read"}
                      </button>
                    </header>
                    {notificationsActionError ? (
                      <div className="header-notification-action-error" role="alert">
                        <WarningCircle size={16} aria-hidden="true" />
                        <span>{notificationsActionError}</span>
                        <button
                          type="button"
                          onClick={() => setNotificationsActionError("")}
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : null}
                    <ul className="header-notification-list">
                      {notificationsLoading ? (
                        <li>
                          <span
                            className="header-notification-state"
                            role="status"
                          >
                            <DotsRing size={18} />
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
                          <li
                            className={notification.readAt ? "is-read" : "is-unread"}
                            key={notification.id}
                          >
                            <a
                              className="header-notification-item"
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
                                void updateHeaderNotifications(
                                  "READ",
                                  notification.id,
                                  safeHeaderActionUrl(notification.actionUrl),
                                );
                              }}
                            >
                              <NotificationArtwork
                                series={notification.series}
                                category={notification.category}
                                className="header-notification-artwork"
                              />
                              <span>
                                <em>{headerNotificationLabel(notification)}</em>
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
                            {!notification.readAt ? (
                              <button
                                type="button"
                                className="header-notification-mark-one"
                                disabled={Boolean(notificationBusy)}
                                onClick={() =>
                                  void updateHeaderNotifications(
                                    "READ",
                                    notification.id,
                                  )
                                }
                              >
                                {notificationBusy === notification.id
                                  ? "Saving…"
                                  : "Mark as read"}
                              </button>
                            ) : (
                              <span className="header-notification-read-state">
                                <Check size={14} aria-hidden="true" /> Read
                              </span>
                            )}
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
                    if (menuOpen) {
                      setMenuOpen(false);
                    } else {
                      setMenuPanel("main");
                      setMenuOpen(true);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      if (!menuOpen) {
                        setMenuPanel("main");
                        setMenuOpen(true);
                      }
                      focusMenuItem("first");
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      if (!menuOpen) {
                        setMenuPanel("main");
                        setMenuOpen(true);
                      }
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
                    {menuPanel === "theme" ? (
                      <ThemeSelectionMenu
                        controller={themeController}
                        onBack={returnToMainMenu}
                        onClose={closeMenuAndRestoreFocus}
                      />
                    ) : (
                      <>
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
                      className="header-change-theme"
                      onClick={() => setMenuPanel("theme")}
                    >
                      <Palette size={18} />
                      <span>Change Theme</span>
                      <CaretRight size={16} />
                    </button>
                    <LogoutAction
                      className="is-danger"
                      role="menuitem"
                      authMethod={actor.authMethod}
                      onStart={() => setMenuOpen(false)}
                    >
                      <SignOut size={18} /> Logout
                    </LogoutAction>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <a className="account-link" href={authEntryPath("login", "/")}>
                <span>Login</span>
                <UserCircle size={22} />
              </a>
              <div
                className="header-overflow"
                ref={menuRef}
                onKeyDown={handleMenuKeys}
              >
                <button
                  className="icon-button"
                  ref={menuButtonRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Open site menu"
                  title="More actions"
                  onClick={() => {
                    if (menuOpen) {
                      setMenuOpen(false);
                    } else {
                      setMenuPanel("main");
                      setMenuOpen(true);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      if (!menuOpen) {
                        setMenuPanel("main");
                        setMenuOpen(true);
                      }
                      focusMenuItem("first");
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      if (!menuOpen) {
                        setMenuPanel("main");
                        setMenuOpen(true);
                      }
                      focusMenuItem("last");
                    }
                  }}
                >
                  <DotsThree size={21} weight="bold" />
                </button>
                {menuOpen ? (
                  <div className="header-overflow-menu" role="menu">
                    {menuPanel === "theme" ? (
                      <ThemeSelectionMenu
                        controller={themeController}
                        onBack={returnToMainMenu}
                        onClose={closeMenuAndRestoreFocus}
                      />
                    ) : (
                      <>
                    <a role="menuitem" href="/rankings" onClick={() => setMenuOpen(false)}>
                      <Trophy size={18} /> Ranking
                    </a>
                    <a role="menuitem" href="/teams" onClick={() => setMenuOpen(false)}>
                      <UsersThree size={18} /> Teams
                    </a>
                    <a role="menuitem" href="/support" onClick={() => setMenuOpen(false)}>
                      <Lifebuoy size={18} /> Support
                    </a>
                    <a role="menuitem" href="/pinned" onClick={() => setMenuOpen(false)}>
                      <PushPin size={18} /> Pinned Series
                    </a>
                    <a role="menuitem" href="/discounts" onClick={() => setMenuOpen(false)}>
                      <Tag size={18} /> Discounts
                    </a>
                    <button
                      role="menuitem"
                      type="button"
                      className="header-change-theme"
                      onClick={() => setMenuPanel("theme")}
                    >
                      <Palette size={18} />
                      <span>Change Theme</span>
                      <CaretRight size={16} />
                    </button>
                      </>
                    )}
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
    : authEntryPath("login", "/");
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

function SeriesStatusBadge({
  status,
  showIndicator = true,
}: {
  status: string;
  showIndicator?: boolean;
}) {
  const normalized = status.toUpperCase();
  const tone =
    normalized === "CANCELLED"
      ? "cancelled"
      : normalized === "COMPLETED"
      ? "completed"
      : normalized === "HIATUS" || normalized === "PAUSED"
        ? "paused"
        : normalized === "ONGOING"
          ? "ongoing"
          : "upcoming";
  return (
    <span className={`series-status-badge status-${tone}`}>
      {showIndicator ? <i aria-hidden="true" /> : null}
      {catalogLabel(normalized)}
    </span>
  );
}

function ChapterAccessBadge({
  accessType,
  unlocked = false,
  visible = true,
}: {
  accessType: string;
  unlocked?: boolean;
  visible?: boolean;
}) {
  if (!visible) return null;
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
  hideSubtitle = false,
  trendingStats,
}: {
  item: SeriesCard;
  wide?: boolean;
  hideSubtitle?: boolean;
  trendingStats?: { views: number; followers: number };
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
        {!hideSubtitle ? <p>{item.subtitle}</p> : null}
        {trendingStats ? (
          <div className="trending-live-metrics" aria-label="Reader activity">
            <span aria-label={`${trendingStats.views.toLocaleString("en-US")} views`}><Eye size={14} aria-hidden="true" /> {trendingStats.views.toLocaleString("en-US")}</span>
            <span aria-label={`${trendingStats.followers.toLocaleString("en-US")} followers`}><Heart size={14} aria-hidden="true" /> {trendingStats.followers.toLocaleString("en-US")}</span>
          </div>
        ) : null}
        <div className={`series-meta${trendingStats ? " series-meta-trending" : ""}`}>
          <span>
            <Star size={14} weight="fill" /> {item.rating}
          </span>
          {trendingStats ? <span><Books size={14} /> {item.chapter}</span> : <span>{item.chapter}</span>}
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
  status:
    | "ONGOING"
    | "COMPLETED"
    | "HIATUS"
    | "PAUSED"
    | "CANCELLED"
    | "UPCOMING";
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
          : item.status === "CANCELLED"
            ? "Cancelled"
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
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#reviews") setExpanded(true);
    };
    const openFromReviewLink = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('a[href="#reviews"]')) setExpanded(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    document.addEventListener("click", openFromReviewLink);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      document.removeEventListener("click", openFromReviewLink);
    };
  }, []);

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
        <button
          className="review-collapse-toggle"
          type="button"
          aria-controls="reviews-content"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span>{expanded ? "Collapse" : "Expand"}</span>
          <CaretDown size={18} aria-hidden="true" />
        </button>
      </div>
      <div
        className="review-collapsible"
        id="reviews-content"
        hidden={!expanded}
      >
        <div className="review-toolbar">
          <label>
          <span className="sr-only">Sort reviews</span>
          <UnifiedSingleSelect
            aria-label="Sort reviews"
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
          </UnifiedSingleSelect>
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
      </div>
    </section>
  );
}

function SectionHeading({
  title,
  body,
  action,
  id,
  icon,
  tone,
}: {
  title: string;
  body?: string;
  action?: { label: string; href: string };
  id?: string;
  icon?: ReactNode;
  tone?: string;
}) {
  return (
    <div className={`section-heading${tone ? ` tone-${tone}` : ""}`}>
      <div className="section-heading-main">
        {icon ? (
          <>
            <span className="section-heading-icon" aria-hidden="true">
              {icon}
            </span>
            <span className="section-heading-divider" aria-hidden="true" />
          </>
        ) : null}
        <div>
          <h2 id={id}>{title}</h2>
          {body ? <p>{body}</p> : null}
        </div>
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
    commentCount: number;
    reactionCount: number;
    teamName: string | null;
    teamSlug: string | null;
    isRead?: boolean;
    isFresh?: boolean;
    isNewInPeriod?: boolean;
  }>;
};

type LatestUpdatesStyle = "classic" | "table";

const LATEST_UPDATES_STYLE_STORAGE_KEY = "nyascans:latest-updates-style";

function releaseTime(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "Recently";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  return `${Math.round(hours / 24)}d`;
}

function releaseAbsoluteTime(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "Publication time unavailable";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function sanitizeChapterTitle(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s*(?:[·•\u2014\u2013:-]\s*)?revised release\b/giu, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[·•\u2014\u2013:-]\s*$/u, "")
    .trim();
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
  pageSize = 12,
}: {
  heading?: boolean;
  pagination?: boolean;
  period?: "today" | "week" | "month" | "all";
  pageSize?: number;
}) {
  const { runtimeFeatures } = useCommercialSettings();
  const paidSystemEnabled = runtimeFeatures.paidSystem;
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
  const pageSwipeStart = useRef<number | null>(null);
  const [releaseLanguages, setReleaseLanguages] = useState<string[]>([]);
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [homeStyle, setHomeStyle] = useState<LatestUpdatesStyle>("classic");
  const effectivePeriod = period;
  const useHomeTable = heading && !pagination && homeStyle === "table";

  useEffect(() => {
    if (!heading || pagination) return;
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(
          LATEST_UPDATES_STYLE_STORAGE_KEY,
        );
        if (stored === "classic" || stored === "table") {
          setHomeStyle(stored);
        }
      } catch {
        // The classic view remains available when browser storage is disabled.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [heading, pagination]);

  function chooseHomeStyle(nextStyle: LatestUpdatesStyle) {
    if (nextStyle === homeStyle) return;
    hasRecordsRef.current = false;
    setRecords([]);
    setLoading(true);
    setError("");
    setHomeStyle(nextStyle);
    setPage(1);
    try {
      window.localStorage.setItem(
        LATEST_UPDATES_STYLE_STORAGE_KEY,
        nextStyle,
      );
    } catch {
      // The current-session choice still works when persistence is unavailable.
    }
  }

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
        const response = await fetchWithHomeTimeout(
          `/api/v1/latest-releases?page=${page}&pageSize=${useHomeTable ? 15 : pageSize}&period=${effectivePeriod}&mode=${useHomeTable ? "table" : "cards"}${releaseLanguages.length ? `&languages=${encodeURIComponent(releaseLanguages.join(","))}` : ""}`,
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
          const message = homeRequestMessage(
            loadError,
            "Latest releases could not be loaded.",
          );
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
  }, [effectivePeriod, page, pageSize, releaseLanguages, revision, useHomeTable]);

  const pageItems = useMemo<Array<number | "ellipsis">>(
    () => latestPageItems(page, pageCount),
    [page, pageCount],
  );
  const feedRows = useMemo(
    () =>
      records
        .flatMap((update) =>
          update.chapters
            .filter(
              (chapter) => effectivePeriod === "all" || chapter.isNewInPeriod,
            )
            .map((chapter) => ({ update, chapter })),
        )
        .sort(
          (left, right) =>
            Date.parse(right.chapter.publishedAt) -
              Date.parse(left.chapter.publishedAt) ||
            Date.parse(right.update.latestPublishedAt ?? "") -
              Date.parse(left.update.latestPublishedAt ?? "") ||
            left.update.title.localeCompare(right.update.title),
        )
        .slice(0, 15),
    [effectivePeriod, records],
  );

  function movePage(direction: -1 | 1) {
    setPage((current) =>
      Math.max(1, Math.min(pageCount, current + direction)),
    );
  }

  function beginPageSwipe(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse") return;
    pageSwipeStart.current = event.clientX;
  }

  function finishPageSwipe(event: ReactPointerEvent<HTMLElement>) {
    const start = pageSwipeStart.current;
    pageSwipeStart.current = null;
    if (start === null) return;
    const distance = event.clientX - start;
    if (Math.abs(distance) < 56) return;
    if (distance < 0 && hasNext) movePage(1);
    if (distance > 0 && hasPrevious) movePage(-1);
  }

  return (
    <section className="latest-updates-block" data-latest-style={homeStyle}>
      {heading ? (
        <div className="section-heading latest-updates-heading tone-updates">
          <div className="section-heading-main">
            <span className="section-heading-icon" aria-hidden="true">
              <List size={20} weight="fill" />
            </span>
            <span className="section-heading-divider" aria-hidden="true" />
            <div>
              <h2>Latest Updates</h2>
            </div>
          </div>
          <div className="latest-updates-actions">
            <div className="latest-style-choices" role="group" aria-label="Latest Updates layout">
              <button
                className="latest-style-toggle"
                type="button"
                aria-label="Card view"
                aria-pressed={homeStyle === "classic"}
                title="Card view"
                onClick={() => chooseHomeStyle("classic")}
              >
                <SquaresFour size={18} aria-hidden="true" />
              </button>
              <button
                className="latest-style-toggle"
                type="button"
                aria-label="Release list view"
                aria-pressed={homeStyle === "table"}
                title="Release list view"
                onClick={() => chooseHomeStyle("table")}
              >
                <List size={18} aria-hidden="true" />
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
            <a className="button button-secondary latest-all-action" href="/latest">
              All <ArrowRight size={17} />
            </a>
          </div>
        </div>
      ) : null}
      {loading ? (
        <div className="dots-ring-loading latest-loading-grid" role="status" aria-busy="true">
          <DotsRing size="lg" label={null} />
          <span>Loading latest releases…</span>
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
      ) : records.length && (!useHomeTable || feedRows.length) ? (
        useHomeTable ? (
          <div
            key="latest-table"
            className="latest-release-table-shell"
            onPointerDown={beginPageSwipe}
            onPointerUp={finishPageSwipe}
          >
            <table className="latest-release-table">
              <caption className="sr-only">
                Latest series releases, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Series</th>
                  <th scope="col">Chapter</th>
                  <th scope="col">Releaser</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {feedRows.map(({ update, chapter }) => {
                  const paid =
                    (chapter.effectiveAccessType ?? chapter.accessType) !==
                    "FREE";
                  return (
                    <tr
                      className={paid ? "is-paid" : undefined}
                      key={`${update.slug}:${chapter.slug}`}
                    >
                      <th scope="row" colSpan={5}>
                        <div className="latest-feed-row">
                          <a className="latest-feed-cover" href={`/title/${update.slug}`} aria-label={`Open ${update.title}`}>
                            {update.cover ? (
                              <ResilientCoverImage
                                src={update.cover}
                                alt={`Cover art for ${update.title}`}
                                width={72}
                                height={100}
                                decorative
                              />
                            ) : (
                              <Books size={19} aria-hidden="true" />
                            )}
                          </a>
                          <div className="latest-feed-row-main">
                            <a className="latest-feed-title" href={`/title/${update.slug}`}>
                              <strong>{update.title}</strong>
                            </a>
                            <div className="latest-feed-chapterline">
                              <LanguageFlag language={chapter.language} showCode={false} />
                              <span className="latest-feed-chapter">Chapter {normalizeChapterNumber(chapter.chapterNumber)}</span>
                              <span className="latest-feed-status">
                                <ChapterAccessBadge
                                  accessType={chapter.effectiveAccessType ?? chapter.accessType}
                                  visible={paidSystemEnabled}
                                />
                              </span>
                            </div>
                            <div className="latest-feed-row-meta">
                              <span className="latest-feed-team">
                                {chapter.teamName ?? "Independent release"}
                              </span>
                              <span className="latest-feed-engagement-group">
                                <time dateTime={chapter.publishedAt} title={releaseAbsoluteTime(chapter.publishedAt)}>
                                  <Clock size={14} aria-hidden="true" /> {releaseTime(chapter.publishedAt)} ago
                                </time>
                                <span className="latest-feed-engagement" aria-label={`${chapter.reactionCount} reactions`}><Heart size={14} aria-hidden="true" /> {chapter.reactionCount}</span>
                                <span className="latest-feed-engagement" aria-label={`${chapter.commentCount} comments`}><ChatCircle size={14} aria-hidden="true" /> {chapter.commentCount}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </th>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
        <div
          key="latest-cards"
          className="latest-grid"
          onPointerDown={beginPageSwipe}
          onPointerUp={finishPageSwipe}
        >
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
                    {update.chapters.slice(0, heading && !pagination ? 2 : 4).map((chapter) => (
                      <li
                        className={(chapter.effectiveAccessType ?? chapter.accessType) !== "FREE" ? "is-paid" : undefined}
                        key={chapter.slug}
                      >
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
                              <ChapterAccessBadge
                                  accessType={chapter.effectiveAccessType ?? chapter.accessType}
                                  visible={paidSystemEnabled}
                                />
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
        )
      ) : (
        <EmptyState
          title="No releases found"
          body="Try another language. New verified chapter releases will appear automatically."
          compact
        />
      )}
      {refreshWarning && records.length ? (
        <p className="latest-refresh-warning" role="status">
          <WarningCircle size={16} aria-hidden="true" />
          {refreshWarning}
        </p>
      ) : null}
      {(pagination || heading) && !loading && !error && records.length ? (
        <nav
          className={`latest-pagination${heading ? " is-home" : ""}`}
          aria-label="Latest updates pages"
        >
          <button
            type="button"
            disabled={!hasPrevious}
            aria-label="Previous latest updates page"
            onClick={() => movePage(-1)}
          >
            <CaretLeft size={17} />
          </button>
          <span className="latest-page-dots" aria-label={`Page ${page} of ${pageCount}`}>
            {pageItems.map((item, index) =>
              item === "ellipsis" ? (
                <span className="latest-page-ellipsis" aria-hidden="true" key={`ellipsis-${index}`}>…</span>
              ) : (
                <button
                  type="button"
                  key={item}
                  aria-label={`Go to latest updates page ${item}`}
                  aria-current={page === item ? "page" : undefined}
                  onClick={() => setPage(item)}
                >
                  {item}
                </button>
              ),
            )}
          </span>
          <button
            type="button"
            disabled={!hasNext}
            aria-label="Next latest updates page"
            onClick={() => movePage(1)}
          >
            <CaretRight size={17} />
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
  >("all");
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
          pageSize={12}
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
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    void fetchWithHomeTimeout("/api/v1/catalog?page=1&pageSize=12&sort=viewed", {
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
            homeRequestMessage(
            error,
            "Trending titles could not be loaded.",
          ),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    }, [revision]);
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
      <div className="section-tabs trending-heading tone-trending">
        <div className="trending-title">
          <span className="section-heading-icon" aria-hidden="true">
            <ChartLineUp size={20} weight="fill" />
          </span>
          <span className="section-heading-divider" aria-hidden="true" />
          <div>
            <h2>Trending</h2>
          </div>
        </div>
        <div className="trending-actions">
          <a className="button button-secondary latest-all-action" href="/leaderboard">
            Full ranking <ArrowRight size={17} />
          </a>
        </div>
      </div>
      <div className="trending-viewport">
        {loading ? (
          <div className="dots-ring-loading catalog-loading" role="status">
            <DotsRing size="lg" label={null} />
            <span>Loading live reader activity…</span>
          </div>
        ) : loadError ? (
          <div className="catalog-error" role="alert">
            <WarningCircle size={24} />
            <span>{loadError}</span>
            <button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button>
          </div>
        ) : ordered.length ? (
        <div className="home-scroll-row" data-cover-anchor="true">
          <HomeRailControls railRef={railRef} label="Trending" anchor="cover" />
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
              <div
                className={`ranked-card${index < 3 ? ` is-top-${index + 1}` : ""}`}
                key={item.id}
              >
                <SeriesCardView
                  item={liveSeriesCard(item)}
                  hideSubtitle
                  trendingStats={{
                    views: Number(item.viewCount ?? 0),
                    followers: Number(item.followerCount ?? 0),
                  }}
                />
              </div>
            ))}
          </div>
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
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load(background = false) {
      if (!background) setLoading(true);
      try {
        const response = await fetchWithHomeTimeout("/api/v1/community-highlights", {
          signal: controller.signal,
        });
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
          homeRequestMessage(
          loadError,
          "Community highlights could not be loaded.",
        ),
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
      controller.abort();
      window.clearInterval(interval);
    };
    }, [revision]);
  return (
    <section className="content-section page-wrap community-highlights">
      <SectionHeading
        title="Latest Comments"
        icon={<ChatCircle size={20} weight="fill" />}
        tone="comments"
      />
      {loading ? (
        <div className="dots-ring-loading community-highlight-loading" role="status">
          <DotsRing size="lg" label={null} />
          <span>Loading community activity…</span>
        </div>
      ) : error ? (
        <div className="community-highlight-loading" role="alert">
          {error}
          <button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button>
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
                <img
                  src={mockAvatarUrl(item.displayName || item.id)}
                  alt=""
                  loading="lazy"
                />
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
  const [loading, setLoading] = useState(signedIn);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

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
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "Continue Reading could not be loaded.",
          );
        }
        setRecords(payload.data ?? []);
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


  return (
    <section
      className="continue-reading-section page-wrap tone-continue is-list"
      aria-labelledby="continue-reading-title"
    >
      <header className="continue-reading-heading">
        <div className="section-heading-main">
          <span className="section-heading-icon" aria-hidden="true">
            <ClockCounterClockwise size={20} weight="fill" />
          </span>
          <span className="section-heading-divider" aria-hidden="true" />
          <div>
            <h2 id="continue-reading-title">Continue reading</h2>
          </div>
        </div>
        {signedIn ? (
          <div className="continue-reading-actions">
            <a className="button button-secondary latest-all-action" href="/library">
              Library <ArrowRight size={15} />
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
        <div className="dots-ring-loading continue-reading-loading" role="status" aria-label="Loading recent series" aria-busy="true">
          <DotsRing size="lg" label={null} />
          <span>Loading recent series…</span>
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
          <a className="continue-reading-browse" href="/browse">Browse Series <ArrowRight size={16} /></a>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [librarySeries, setLibrarySeries] = useState<Set<string>>(
    () => new Set(),
  );
  const [libraryBusy, setLibraryBusy] = useState("");
  const swipeStart = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetchWithHomeTimeout("/api/v1/editor-picks", {
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
            homeRequestMessage(
            loadError,
            "Editor's Picks could not be loaded.",
          ),
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);

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

  const editorsPickHeading = (
    <header className="editors-pick-heading">
      <div className="editors-pick-title-group">
        <span className="section-heading-icon" aria-hidden="true">
          <CrownSimple size={21} weight="regular" />
        </span>
        <span className="section-heading-divider" aria-hidden="true" />
        <div>
          <h2 id="editors-pick-title">Editor&apos;s Pick</h2>
        </div>
      </div>
    </header>
  );

  if (loading || error || picks.length === 0) {
    return (
      <section className="editors-pick-section page-wrap" aria-labelledby="editors-pick-title">
        {editorsPickHeading}
        <div className={`editors-pick-state-card${loading ? " dots-ring-loading" : ""}`} role={loading ? "status" : error ? "alert" : "status"}>
          {loading ? <DotsRing size="lg" label={null} /> : null}
          <strong>{loading ? "Loading Editor's Pick" : error ? "Editor's Pick unavailable" : "No Editor's Pick assigned yet"}</strong>
          <span>{loading ? "Finding a standout series for you." : error || "An editor can feature a standout series here when one is assigned."}</span>
          {!loading && error ? <button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button> : null}
        </div>
      </section>
    );
  }

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
      {editorsPickHeading}
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
              className="button button-secondary"
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

type HomeAnnouncement = {
  id: string;
  type: "UPDATE" | "ISSUE" | "SUPPORT" | "NOTICE";
  title: string;
  body: string;
  linkLabel: string;
  linkUrl: string;
};

function HomeAnnouncements({ announcements }: { announcements: HomeAnnouncement[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const pointerStart = useRef<number | null>(null);
  const safeIndex = announcements.length
    ? activeIndex % announcements.length
    : 0;
  const active = announcements[safeIndex];

  useEffect(() => {
    if (
      paused ||
      announcements.length < 2 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setActiveIndex((current) => (current + 1) % announcements.length);
      }
    }, 8_000);
    return () => window.clearInterval(interval);
  }, [announcements.length, paused]);

  if (!active) return null;
  const Icon =
    active.type === "UPDATE"
      ? Star
      : active.type === "ISSUE"
        ? WarningCircle
        : active.type === "SUPPORT"
          ? Lifebuoy
          : Bell;
  const move = (direction: -1 | 1) => {
    setActiveIndex(
      (current) =>
        (current + direction + announcements.length) % announcements.length,
    );
  };

  return (
    <section
      className="home-announcement-slider v46-announcement-list"
      aria-label="Site announcements"
      aria-roledescription="carousel"
      tabIndex={0}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      onKeyDown={(event) => {
        if (announcements.length < 2) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        }
      }}
      onPointerDown={(event) => {
        pointerStart.current = event.clientX;
      }}
      onPointerUp={(event) => {
        if (pointerStart.current === null || announcements.length < 2) return;
        const distance = event.clientX - pointerStart.current;
        pointerStart.current = null;
        if (Math.abs(distance) >= 42) move(distance > 0 ? -1 : 1);
      }}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
    >
      <article
        key={active.id}
        data-type={active.type.toLowerCase()}
        aria-label={`${safeIndex + 1} of ${announcements.length}: ${active.title}`}
      >
        <span><Icon size={20} weight="duotone" /></span>
        <div>
          <small>{active.type}</small>
          <strong>{active.title}</strong>
          <FormattedAnnouncementText body={active.body} />
        </div>
        {active.linkUrl ? (
          <a href={active.linkUrl}>
            {active.linkLabel || "Learn more"}<ArrowRight size={15} />
          </a>
        ) : null}
        {announcements.length > 1 ? (
          <div className="announcement-slider-arrows" aria-label="Announcement controls">
            <button type="button" aria-label="Previous announcement" onClick={() => move(-1)}><CaretLeft size={17} /></button>
            <button type="button" aria-label="Next announcement" onClick={() => move(1)}><CaretRight size={17} /></button>
          </div>
        ) : null}
      </article>
      {announcements.length > 1 ? (
        <div className="featured-slider-dots announcement-slider-dots" aria-label="Choose announcement">
          {announcements.map((announcement, index) => (
            <button
              type="button"
              key={announcement.id}
              aria-label={`Show ${announcement.title}`}
              aria-pressed={index === safeIndex}
              onClick={() => setActiveIndex(index)}
            />
          ))}
        </div>
      ) : null}
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
  const { runtimeFeatures } = useCommercialSettings();
  const { settings: siteConfiguration } = useSiteConfiguration();
  const paidSystemEnabled = runtimeFeatures.paidSystem;
  const [promotions, setPromotions] = useState<{
    announcements: HomeAnnouncement[];
    floatingAds: FloatingCampaign[];
    floatingAd: FloatingCampaign | null;
  }>({ announcements: [], floatingAds: [], floatingAd: null });

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
      <FeaturedSeriesSlider />

      <main className="home-main">
        <TrendingShowcase />

        <ContinueReadingSection signedIn={Boolean(actor)} />

        <PinnedSeriesSection carouselStyle={siteConfiguration.homepage.pinnedSeriesStyle} />

        <RecentReviewsSection />
        {paidSystemEnabled ? <DiscountsSection enabled /> : null}

        <FloatingHomeAds
          campaigns={
            promotions.floatingAds?.length
              ? promotions.floatingAds
              : promotions.floatingAd
                ? [promotions.floatingAd]
                : []
          }
        />

        <section className="updates-section">
          <div className="page-wrap">
            <HomeAnnouncements announcements={promotions.announcements} />
            <LatestUpdatesGrid />
          </div>
        </section>

        <EditorsPickSection actor={actor} showToast={showToast} />

        <NewSeriesSection />

        <PublishingTeamsCarousel />

        <CommunityHighlights />

        <HotThisWeek />
      </main>
    </>
  );
}

type AnnouncementAction = {
  label: string;
  url: string;
};

type FloatingCampaign = {
  id: string;
  eyebrow: string;
  title: string;
  highlightText: string;
  body: string;
  actionLabel: string;
  secondaryActions: AnnouncementAction[];
  sideIcon: string;
  infoBlocks: Array<{ icon: string; title: string; body: string }>;
  destinationUrl: string;
  imageUrl: string | null;
  effect: "WAVE" | "PULSE" | "GLOW";
  resetKey: string;
  displaySlot: number;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  borderColor: string;
  accentLinePosition: "top" | "left" | "bottom";
};

function renderAnnouncementTitle(title: string, highlightText: string) {
  if (!highlightText || !title.includes(highlightText)) return title;
  const [before, after] = title.split(highlightText, 2);
  return <>{before}<em>{highlightText}</em>{after}</>;
}

function FloatingHomeAds({ campaigns }: { campaigns: FloatingCampaign[] }) {
  if (!campaigns.length) return null;
  return (
    <section id="home-announcement-stack" className="home-announcement-stack" aria-label="Announcements">
      <div className="page-wrap home-announcement-stack-inner">
        {campaigns.slice(0, 4).map((campaign) => (
          <FloatingHomeAd key={campaign.id} campaign={campaign} />
        ))}
      </div>
    </section>
  );
}

function FloatingHomeAd({ campaign }: { campaign: FloatingCampaign }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <article
      className="home-announcement-banner"
      data-effect={campaign.effect.toLowerCase()}
      data-accent-line={campaign.accentLinePosition}
      style={{
        "--campaign-primary": campaign.primaryColor || "#65B5FF",
        "--campaign-secondary": campaign.secondaryColor || "#8B5CF6",
        "--campaign-background": campaign.backgroundColor || "#07111C",
        "--campaign-border": campaign.borderColor || campaign.primaryColor || "#65B5FF",
      } as CSSProperties}
    >
      <div className="home-announcement-media" aria-hidden="true">
        {campaign.imageUrl && !imageFailed ? (
          <img src={campaign.imageUrl} alt="" onError={() => setImageFailed(true)} />
        ) : (
          <span className="home-announcement-icon">{campaign.sideIcon || "✦"}</span>
        )}
      </div>
      <div className="home-announcement-copy">
        <div className="home-announcement-eyebrow">
          <span className="home-announcement-dot" />
          <span>{campaign.eyebrow || "Announcement"}</span>
        </div>
        <h2>{renderAnnouncementTitle(campaign.title, campaign.highlightText)}</h2>
        {campaign.body ? <p>{campaign.body}</p> : null}
        {campaign.infoBlocks?.length ? (
          <div className="home-announcement-chips" aria-label="Announcement details">
            {campaign.infoBlocks.slice(0, 4).map((block, index) => (
              <span key={campaign.id + ":chip:" + index + ":" + block.title}>
                <b aria-hidden="true">{block.icon || "•"}</b>{block.title}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="home-announcement-actions">
        {campaign.actionLabel ? (
          <a className="home-announcement-primary" href={campaign.destinationUrl || "/browse?sort=latest"}>
            {campaign.actionLabel}<ArrowRight size={17} aria-hidden="true" />
          </a>
        ) : null}
        {campaign.secondaryActions?.length ? (
          <div className="home-announcement-secondary-actions">
            {campaign.secondaryActions.slice(0, 4).map((action, index) => (
              <a key={campaign.id + ":secondary:" + index + ":" + action.label} href={action.url || "/browse?sort=latest"}>
                {action.label}<ArrowRight size={14} aria-hidden="true" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

type CatalogResult = {
  id: string;
  slug: string;
  title: string;
  nativeTitle: string | null;
  synopsis: string;
  type: "MANHWA" | "MANGA" | "MANHUA";
  status:
    | "ONGOING"
    | "COMPLETED"
    | "HIATUS"
    | "PAUSED"
    | "CANCELLED"
    | "UPCOMING";
  accessType: "FREE" | "PAID";
  cover: string | null;
  ratingTenths: number;
  followerCount: number;
  viewCount: number;
  latestPublishedAt: string | null;
  latestChapterNumber: string | null;
  chapterCount: number;
  commentCount: number;
};

type CatalogPagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
};
type CatalogFacetOption = {
  value: string;
  label: string;
  kind?: "creator" | "publisher";
  count?: number;
};
type CatalogFacets = {
  genres: CatalogFacetOption[];
  creators: CatalogFacetOption[];
};

const DEFAULT_CATALOG_PAGE_SIZE = 66;

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

function closeOtherBrowseFilterDetails(current: HTMLDetailsElement) {
  const panel = current.closest(".catalog-filter-panel");
  if (!panel) return;
  panel.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((details) => {
    if (details !== current) details.open = false;
  });
}

function CompactOptionMenu({
  label,
  value,
  options,
  onChange,
  className = "",
  multiple = false,
  activeCount,
  sortDirection,
  onDirectionChange,
}: {
  label: string;
  value: string | number;
  options: Array<{ value: string | number; label: string }>;
  onChange: (value: string) => void;
  className?: string;
  multiple?: boolean;
  activeCount?: number;
  sortDirection?: "asc" | "desc";
  onDirectionChange?: (value: "asc" | "desc") => void;
}) {
  const selectedValues = String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
  const selectedLabels = options.filter((option) => selectedValues.includes(String(option.value))).map((option) => option.label);
  const currentLabel = multiple
    ? selectedLabels.join(", ") || label
    : options.find((option) => String(option.value) === String(value))?.label ?? String(value);
  const count = activeCount ?? (multiple ? selectedValues.length : 0);

  if (!multiple) {
    return (
      <div
        className={`compact-single-select ${count ? "has-active" : ""} ${className}`.trim()}
      >
        <label>
          <span className="sr-only">{label}</span>
          <UnifiedSingleSelect
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </UnifiedSingleSelect>
        </label>
        {count ? <b className="catalog-filter-active-count compact-single-active-count">{count}</b> : null}
        {sortDirection && onDirectionChange ? (
          <button
            className="compact-sort-toggle"
            type="button"
            aria-label={`${label} direction: ${sortDirection === "asc" ? "ascending" : "descending"}. Change direction.`}
            onClick={() => onDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
          >
            {sortDirection === "asc" ? (
              <ArrowUp size={15} aria-hidden="true" />
            ) : (
              <ArrowDown size={15} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <details
      className={`compact-option-menu ${multiple ? "is-multi-select" : ""} ${count ? "has-active" : ""} ${className}`.trim()}
      onToggle={(event) => {
        if (event.currentTarget.open) closeOtherBrowseFilterDetails(event.currentTarget);
      }}
    >
      <summary aria-label={`${label}: ${currentLabel}`}>
        <span className="catalog-filter-summary">
          <Plus size={13} aria-hidden="true" />
          <span className="catalog-filter-summary-label">{label}</span>
          {count ? <b className="catalog-filter-active-count">{count}</b> : null}
        </span>
        <CaretDown className="catalog-filter-chevron" size={13} aria-hidden="true" />
      </summary>
      <div role={multiple ? "group" : "radiogroup"} aria-label={`${label} options`}>
        {sortDirection && onDirectionChange ? (
          <div className="catalog-sort-direction" role="group" aria-label={`${label} direction`}>
            <span>Direction</span>
            <button
              type="button"
              className={sortDirection === "asc" ? "is-selected" : ""}
              aria-pressed={sortDirection === "asc"}
              onClick={() => onDirectionChange("asc")}
            >
              <ArrowUp size={14} aria-hidden="true" /> Asc
            </button>
            <button
              type="button"
              className={sortDirection === "desc" ? "is-selected" : ""}
              aria-pressed={sortDirection === "desc"}
              onClick={() => onDirectionChange("desc")}
            >
              <ArrowDown size={14} aria-hidden="true" /> Desc
            </button>
          </div>
        ) : null}
        {!multiple ? <small>Current: {currentLabel}</small> : null}
        {options.map((option) => {
          const optionValue = String(option.value);
          const selected = multiple ? selectedValues.includes(optionValue) : optionValue === String(value);
          return (
            <button
              type="button"
              className={`catalog-option-button ${selected ? "is-selected" : ""}`.trim()}
              role={multiple ? "checkbox" : "radio"}
              aria-selected={selected}
              aria-checked={selected}
              key={optionValue}
              onClick={(event) => {
                if (multiple) {
                  const nextValues = optionValue === "All"
                    ? []
                    : selected
                      ? selectedValues.filter((entry) => entry !== optionValue)
                      : [...selectedValues.filter((entry) => entry !== "All"), optionValue];
                  onChange(nextValues.join(","));
                  return;
                }
                onChange(optionValue);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>{option.label}</span>
              <span className={`catalog-choice-box ${multiple ? "is-checkbox" : "is-radio"}`} aria-hidden="true">
                {selected ? <Check size={12} weight="bold" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

function CatalogFacetMenu({
  label,
  value,
  options,
  search,
  onSearchChange,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: CatalogFacetOption[];
  search: string;
  onSearchChange: (value: string) => void;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const selectedValues = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const selectedLabels = options.filter((option) => selectedValues.includes(option.value)).map((option) => option.label);
  const visibleOptions = options
    .filter((option) => `${option.label} ${option.kind ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 40);
  return (
    <details
      className={`catalog-facet-menu ${selectedValues.length ? "has-active" : ""}`}
      onToggle={(event) => {
        if (event.currentTarget.open) closeOtherBrowseFilterDetails(event.currentTarget);
      }}
    >
      <summary aria-label={`${label}: ${selectedLabels.join(", ") || label}`}>
        <span className="catalog-filter-summary">
          <Plus size={13} aria-hidden="true" />
          <span className="catalog-filter-summary-label">{label}</span>
          {selectedValues.length ? <b className="catalog-filter-active-count">{selectedValues.length}</b> : null}
        </span>
        <CaretDown className="catalog-filter-chevron" size={13} aria-hidden="true" />
      </summary>
      <div role="group" aria-label={`${label} options`}>
        <label className="catalog-facet-search">
          <MagnifyingGlass size={15} />
          <span className="sr-only">Search {label.toLowerCase()}</span>
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={placeholder} />
        </label>
        <button className="catalog-option-button catalog-filter-all" type="button" role="checkbox" aria-checked={!selectedValues.length} aria-selected={!selectedValues.length} onClick={() => onChange("")}>
          <span>All {label.toLowerCase()}</span>
          <span className="catalog-choice-box is-checkbox" aria-hidden="true">{!selectedValues.length ? <Check size={12} weight="bold" /> : null}</span>
        </button>
        {visibleOptions.map((option) => {
          const selectedOption = selectedValues.includes(option.value);
          return (
            <button
              className={`catalog-option-button ${selectedOption ? "is-selected" : ""}`.trim()}
              type="button"
              role="checkbox"
              aria-selected={selectedOption}
              aria-checked={selectedOption}
              key={`${option.kind ?? "option"}-${option.value}`}
              onClick={() => onChange(selectedOption ? selectedValues.filter((entry) => entry !== option.value).join(",") : [...selectedValues, option.value].join(","))}
            >
              <span>{option.kind === "publisher" ? "Publisher · " : ""}{option.label}</span>
              <span className="catalog-choice-box is-checkbox" aria-hidden="true">{selectedOption ? <Check size={12} weight="bold" /> : null}</span>
            </button>
          );
        })}
        {!visibleOptions.length ? <small className="catalog-facet-empty">No matching {label.toLowerCase()}.</small> : null}
      </div>
    </details>
  );
}

function MinimumChaptersMenu({
  value,
  onApply,
  className = "",
}: {
  value: string;
  onApply: (value: string) => void;
  className?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function updateDraft(next: string) {
    setDraft(next.replace(/[^0-9]/g, "").slice(0, 4));
  }

  function apply() {
    onApply(draft && Number(draft) > 0 ? draft : "");
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details
      ref={detailsRef}
      className={`minimum-chapters-field ${value ? "has-active" : ""} ${className}`.trim()}
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setDraft(value);
          closeOtherBrowseFilterDetails(event.currentTarget);
        }
      }}
    >
      <summary aria-label={`Minimum Chapters${value ? `: ${value}` : ""}`}>
        <span className="catalog-filter-summary">
          <Plus size={13} aria-hidden="true" />
          <span className="catalog-filter-summary-label">Minimum Chapters</span>
          {value ? <b className="catalog-filter-active-count">1</b> : null}
        </span>
        <CaretDown className="catalog-filter-chevron" size={13} aria-hidden="true" />
      </summary>
      <div className="minimum-chapters-popover">
        <p>At least how many published chapters?</p>
        <div className="minimum-chapters-editor">
          <button
            type="button"
            aria-label="Decrease minimum chapters"
            onClick={() => updateDraft(String(Math.max(0, Number(draft || 0) - 1)))}
          >
            <ArrowDown size={15} aria-hidden="true" />
          </button>
          <input
            inputMode="numeric"
            min="0"
            max="10000"
            pattern="[0-9]*"
            value={draft}
            onChange={(event) => updateDraft(event.target.value)}
            placeholder="e.g. 20"
            aria-label="Minimum chapters"
          />
          <button
            type="button"
            aria-label="Increase minimum chapters"
            onClick={() => updateDraft(String(Math.min(10000, Number(draft || 0) + 1)))}
          >
            <ArrowUp size={15} aria-hidden="true" />
          </button>
        </div>
        <small>Example: 20 chapters or more.</small>
        <button className="minimum-chapters-apply" type="button" onClick={apply}>Apply</button>
      </div>
    </details>
  );
}

function CatalogFollowButton({
  item,
  actor,
  showToast,
  className = "",
}: {
  item: CatalogResult;
  actor: Actor | null;
  showToast: (text: string) => void;
  className?: string;
}) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!actor) {
      setFollowing(false);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/v1/series-follow?slug=${encodeURIComponent(item.slug)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as { following?: boolean };
        if (response.ok && typeof payload.following === "boolean") {
          setFollowing(payload.following);
        }
      })
      .catch(() => {
        // The follow state remains available through the action itself.
      });
    return () => controller.abort();
  }, [actor, item.slug]);

  const isListMode = className.split(/\s+/).includes("list-follow-button");

  async function toggleFollow() {
    if (!actor) {
      window.location.href = authEntryPath("login", `/title/${item.slug}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/v1/series-follow", {
        method: following ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: item.slug }),
      });
      const payload = (await response.json()) as {
        following?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || typeof payload.following !== "boolean") {
        throw new Error(payload.error?.message ?? "Following could not be updated.");
      }
      setFollowing(payload.following);
      showToast(payload.following ? "Series followed." : "Series unfollowed.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Following could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={`catalog-card-follow ${className}${following ? " is-following" : ""}`.trim()}
      type="button"
      aria-label={following ? `Unfollow ${item.title}` : `Follow ${item.title}`}
      aria-pressed={following}
      disabled={busy}
      onClick={() => void toggleFollow()}
    >
      <Heart size={18} weight={following ? "fill" : "regular"} />
      {isListMode ? null : busy ? "Saving…" : following ? "Following" : "Follow"}
    </button>
  );
}

function BrowseView({
  actor,
  showToast,
}: {
  actor: Actor | null;
  showToast: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const [access, setAccess] = useState("All");
  const [status, setStatus] = useState("All");
  const [genre, setGenre] = useState("");
  const [creator, setCreator] = useState("");
  const [minimumChapters, setMinimumChapters] = useState("");
  const [minimumDraft, setMinimumDraft] = useState("");
  const [hideFollowed, setHideFollowed] = useState(false);
  const [genreSearch, setGenreSearch] = useState("");
  const [creatorSearch, setCreatorSearch] = useState("");
  const [facets, setFacets] = useState<CatalogFacets>({ genres: [], creators: [] });
  const [mode, setMode] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState("latest");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_CATALOG_PAGE_SIZE);
  const [moreOpen, setMoreOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [items, setItems] = useState<CatalogResult[]>([]);
  const [pagination, setPagination] = useState<CatalogPagination>({
    page: 1,
    pageSize: DEFAULT_CATALOG_PAGE_SIZE,
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
      const nextStatus = (params.get("status") ?? "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter((value) => ["ONGOING", "COMPLETED", "HIATUS", "PAUSED", "CANCELLED", "UPCOMING"].includes(value))
        .join(",") || "ALL";
      const nextGenre = params.get("genre") ?? "";
      const nextCreator = params.get("creator") ?? "";
      const nextMinimumChapters = params.get("minChapters") ?? "";
      const nextHideFollowed = ["1", "true"].includes(
        (params.get("hideFollowed") ?? "").toLowerCase(),
      );
      const nextSort = params.get("sort") ?? "latest";
      const requestedDirection = params.get("sortDirection");
      const nextSortDirection: "asc" | "desc" = requestedDirection === "asc" || requestedDirection === "desc"
        ? requestedDirection
        : nextSort === "title" ? "asc" : "desc";
      const nextPage = Number(params.get("page") ?? 1);
      const nextPageSize = Number(params.get("pageSize") ?? DEFAULT_CATALOG_PAGE_SIZE);
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
      setStatus(nextStatus === "ALL" ? "All" : nextStatus);
      setGenre(nextGenre);
      setCreator(nextCreator);
      setMinimumChapters(/^\d+$/.test(nextMinimumChapters) ? nextMinimumChapters : "");
      setMinimumDraft(/^\d+$/.test(nextMinimumChapters) ? nextMinimumChapters : "");
      setHideFollowed(nextHideFollowed);
      setSort(
        ["latest", "added", "viewed", "followed", "rated", "title"].includes(
          nextSort,
        )
          ? nextSort
          : "latest",
      );
      setSortDirection(nextSortDirection);
      setPage(Number.isInteger(nextPage) && nextPage > 0 ? nextPage : 1);
      setPageSize(
        nextPageSize === 12
          ? 16
          : nextPageSize === 36
            ? 32
            : [16, 24, 32, 48, 66].includes(nextPageSize)
              ? nextPageSize
              : DEFAULT_CATALOG_PAGE_SIZE,
      );
      setMoreOpen(
        nextStatus !== "ALL" ||
          nextType !== "ALL" ||
          nextAccess !== "ALL" ||
          Boolean(nextGenre) ||
          Boolean(nextCreator) ||
          Boolean(nextMinimumChapters) ||
          nextHideFollowed,
      );
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
    setMinimumDraft(minimumChapters);
  }, [minimumChapters]);

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
        ...(sortDirection !== (sort === "title" ? "asc" : "desc") ? { sortDirection } : {}),
      });
      if (query.trim()) params.set("q", query.trim());
      if (type !== "All") params.set("type", type);
      if (access !== "All") params.set("access", access);
      if (status !== "All") params.set("status", status);
      if (genre) params.set("genre", genre);
      if (creator) params.set("creator", creator);
      if (minimumChapters && Number(minimumChapters) > 0) {
        params.set("minChapters", minimumChapters);
      }
      if (hideFollowed && actor) params.set("hideFollowed", "1");
      try {
        const response = await fetch(`/api/v1/catalog?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data?: CatalogResult[];
          pagination?: CatalogPagination;
          facets?: CatalogFacets;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "The catalog could not be loaded.",
          );
        }
        setItems(payload.data ?? []);
        if (payload.facets) setFacets(payload.facets);
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
    actor,
    catalogRevision,
    creator,
    genre,
    hideFollowed,
    hydrated,
    minimumChapters,
    page,
    pageSize,
    query,
    sort,
    sortDirection,
    status,
    type,
  ]);

  function navigate(
    updates: Partial<{
      query: string;
      type: string;
      access: string;
      status: string;
      genre: string;
      creator: string;
      minimumChapters: string;
      hideFollowed: boolean;
      sort: string;
      sortDirection: "asc" | "desc";
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
      genre,
      creator,
      minimumChapters,
      hideFollowed,
      sort,
      sortDirection,
      page,
      pageSize,
      ...updates,
    };
    const params = new URLSearchParams();
    if (next.query.trim()) params.set("q", next.query.trim());
    if (next.type !== "All") params.set("type", next.type.toLowerCase());
    if (next.access !== "All") {
      params.set("access", next.access.toLowerCase());
    }
    if (next.status !== "All") {
      params.set("status", next.status.toLowerCase());
    }
    if (next.genre) params.set("genre", next.genre);
    if (next.creator) params.set("creator", next.creator);
    if (next.minimumChapters && Number(next.minimumChapters) > 0) {
      params.set("minChapters", next.minimumChapters);
    }
    if (next.hideFollowed && actor) params.set("hideFollowed", "1");
    if (next.sort !== "latest") params.set("sort", next.sort);
    const defaultDirection = next.sort === "title" ? "asc" : "desc";
    if (next.sortDirection !== defaultDirection) params.set("sortDirection", next.sortDirection);
    if (next.page > 1) params.set("page", String(next.page));
    if (next.pageSize !== DEFAULT_CATALOG_PAGE_SIZE) params.set("pageSize", String(next.pageSize));
    const nextUrl = `/browse${params.size ? `?${params.toString()}` : ""}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
    setQuery(next.query);
    setType(next.type);
    setAccess(next.access);
    setStatus(next.status);
    setGenre(next.genre);
    setCreator(next.creator);
    setMinimumChapters(next.minimumChapters);
    setHideFollowed(next.hideFollowed);
    setSort(next.sort);
    setSortDirection(next.sortDirection);
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

  const sortDefaultDirection = sort === "title" ? "asc" : "desc";
  const sortActiveCount = sort !== "latest" || sortDirection !== sortDefaultDirection ? 1 : 0;
  const activeFilterCount = [
    type !== "All",
    access !== "All",
    status !== "All",
    Boolean(genre),
    Boolean(creator),
    Boolean(minimumChapters && Number(minimumChapters) > 0),
    hideFollowed,
    Boolean(sortActiveCount),
    pageSize !== DEFAULT_CATALOG_PAGE_SIZE,
  ].filter(Boolean).length;
  const clearFilters = () => {
    navigate({
      query: "",
      type: "All",
      access: "All",
      status: "All",
      genre: "",
      creator: "",
      minimumChapters: "",
      hideFollowed: false,
      sort: "latest",
      sortDirection: "desc",
      page: 1,
      pageSize: DEFAULT_CATALOG_PAGE_SIZE,
    }, true);
    setGenreSearch("");
    setCreatorSearch("");
    setMoreOpen(false);
    showToast("Filters cleared.");
  };

  return (
    <main className={`page-main page-wrap ${browseFixes.browseScope}`}>
      <section className="browse-intro">
        <div className="browse-intro-heading">
          <div className="browse-title-group">
            <h1>Browse Series</h1>
          </div>
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
      </section>

      <section className="catalog-toolbar" aria-label="Search and filters">
        <div className="catalog-search">
          <MagnifyingGlass size={19} />
          <label className="sr-only" htmlFor="catalog-query">
            Search series
          </label>
          <input
            id="catalog-query"
            value={query}
            onChange={(event) =>
              navigate({ query: event.target.value, page: 1 }, true)
            }
            placeholder={`Search among ${pagination.total.toLocaleString("en-US")} series...`}

          />
        </div>
        <button
          className="filter-button"
          type="button"
          aria-expanded={moreOpen}
          aria-controls="browse-filter-panel"
          onClick={() => setMoreOpen((value) => !value)}
        >
          <SlidersHorizontal size={18} />
          <span>Filters</span>
          {activeFilterCount ? (
            <strong className="filter-count" aria-label={`${activeFilterCount} active filters`}>
              {activeFilterCount}
            </strong>
          ) : null}
        </button>
      </section>

      <div className="browse-desktop-filter-bar catalog-filter-panel" aria-label="Browse filters">
        <CompactOptionMenu
          label="Latest Update"
          value={sort}
          activeCount={sortActiveCount}
          sortDirection={sortDirection}
          onDirectionChange={(value) => navigate({ sortDirection: value, page: 1 })}
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
          label="Status"
          value={status}
          activeCount={status === "All" ? 0 : 1}
          options={[
            { value: "All", label: "All statuses" },
            { value: "ONGOING", label: "Ongoing" },
            { value: "COMPLETED", label: "Completed" },
            { value: "HIATUS", label: "Hiatus" },
            { value: "PAUSED", label: "Paused" },
            { value: "CANCELLED", label: "Cancelled" },
            { value: "UPCOMING", label: "Upcoming" },
          ]}
          onChange={(value) => navigate({ status: value, page: 1 })}
        />
        <CompactOptionMenu
          label="Type"
          value={type}
          activeCount={type === "All" ? 0 : 1}
          options={[
            { value: "All", label: "All types" },
            { value: "MANHWA", label: "Manhwa" },
            { value: "MANGA", label: "Manga" },
            { value: "MANHUA", label: "Manhua" },
          ]}
          onChange={(value) => navigate({ type: value, page: 1 })}
        />
        <CatalogFacetMenu
          label="Genres"
          value={genre}
          options={facets.genres}
          search={genreSearch}
          onSearchChange={setGenreSearch}
          onChange={(value) => navigate({ genre: value, page: 1 })}
          placeholder="Search genres..."
        />
        <CatalogFacetMenu
          label="Creator"
          value={creator}
          options={facets.creators}
          search={creatorSearch}
          onSearchChange={setCreatorSearch}
          onChange={(value) => navigate({ creator: value, page: 1 })}
          placeholder="Search artist, author, publisher..."
        />
        <MinimumChaptersMenu
          value={minimumChapters}
          onApply={(value) => navigate({ minimumChapters: value, page: 1 }, true)}
        />
        <label className={`hide-followed-field${hideFollowed ? " has-active" : ""}`.trim()}>
          <input
            type="checkbox"
            checked={hideFollowed}
            onChange={(event) => {
              if (event.target.checked && !actor) {
                window.location.href = authEntryPath("login", "/browse");
                return;
              }
              navigate({ hideFollowed: event.target.checked, page: 1 });
            }}
          />
          <span className="catalog-filter-summary">
            <Plus size={13} aria-hidden="true" />
            <span className="catalog-filter-summary-label">Hide Bookmarked</span>
            {hideFollowed ? <b className="catalog-filter-active-count">1</b> : null}
          </span>
        </label>
        <button className="browse-clear-filters" type="button" disabled={!activeFilterCount} onClick={clearFilters}>
          <X size={14} aria-hidden="true" /> Clear Filters
        </button>
      </div>

      {moreOpen ? (
        <aside
          id="browse-filter-panel"
          className="advanced-filter-bar catalog-filter-panel"
          aria-label="Browse filters"
        >
          <header>
            <div>
              <strong>Filters</strong>
            </div>
            <button
              className="mobile-filter-close"
              type="button"
              aria-label="Close filters"
              onClick={() => setMoreOpen(false)}
            >
              <X size={22} />
            </button>
          </header>
          <div className="catalog-filter-grid">
            <CompactOptionMenu
              label="Latest Update"
              value={sort}
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
              label="Type"
              value={type}
              options={[
                { value: "All", label: "All types" },
                { value: "MANHWA", label: "Manhwa" },
                { value: "MANGA", label: "Manga" },
                { value: "MANHUA", label: "Manhua" },
              ]}
              onChange={(value) => navigate({ type: value, page: 1 })}
            />
            <CompactOptionMenu
              label="Access"
              value={access}
              options={[
                { value: "All", label: "All access" },
                { value: "FREE", label: "Free" },
                { value: "PAID", label: "Paid" },
              ]}
              onChange={(value) => navigate({ access: value, page: 1 })}
            />
            <CompactOptionMenu
              label="Status"
              value={status}
              activeCount={status === "All" ? 0 : 1}
              options={[
                { value: "All", label: "All statuses" },
                { value: "ONGOING", label: "Ongoing" },
                { value: "COMPLETED", label: "Completed" },
                { value: "HIATUS", label: "Hiatus" },
                { value: "PAUSED", label: "Paused" },
                { value: "CANCELLED", label: "Cancelled" },
                { value: "UPCOMING", label: "Upcoming" },
              ]}
              onChange={(value) => navigate({ status: value, page: 1 })}
            />
            <CatalogFacetMenu
              label="Genres"
              value={genre}
              options={facets.genres}
              search={genreSearch}
              onSearchChange={setGenreSearch}
              onChange={(value) => navigate({ genre: value, page: 1 })}
              placeholder="Search genres..."
            />
            <CatalogFacetMenu
              label="Creator"
              value={creator}
              options={facets.creators}
              search={creatorSearch}
              onSearchChange={setCreatorSearch}
              onChange={(value) => navigate({ creator: value, page: 1 })}
              placeholder="Search artist, author, publisher..."
            />
            <MinimumChaptersMenu
              value={minimumChapters}
              onApply={(value) => navigate({ minimumChapters: value, page: 1 }, true)}
            />
            <label className="hide-followed-field">
              <input
                type="checkbox"
                checked={hideFollowed}
                onChange={(event) => {
                  if (event.target.checked && !actor) {
                    window.location.href = authEntryPath("login", "/browse");
                    return;
                  }
                  navigate({ hideFollowed: event.target.checked, page: 1 });
                }}
              />
              <span>Hide Bookmarked</span>
            </label>
          </div>
          <footer className="catalog-filter-footer">
            <button
              className="mobile-filter-clear"
              type="button"
              disabled={!activeFilterCount}
              onClick={clearFilters}
            >
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          </footer>
        </aside>
      ) : null}

      {loading ? (
        <section className="dots-ring-loading catalog-loading-grid" role="status" aria-label="Loading catalog" aria-busy="true">
          <DotsRing size="xl" label={null} />
          <span>Loading catalog…</span>
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
                <a
                  className="cover-link"
                  href={`/title/${item.slug}`}
                  aria-label={`Open ${item.title}`}
                >
                  <CatalogCover item={item} />
                  <span className="cover-shade" />
                  <span className="catalog-cover-top-badges">
                    <SeriesTypeBadge type={item.type} flagOnly />
                    <span className="catalog-rating-badge">
                      <Star size={13} weight="fill" />
                      {(Number(item.ratingTenths) / 10).toFixed(1)}
                    </span>
                  </span>
                  <span className="catalog-cover-bottom-badges">
                    <SeriesStatusBadge status={item.status} showIndicator={false} />
                    <span className="catalog-chapter-badge">
                      <Books size={13} />
                      {Number(item.chapterCount ?? 0)}
                    </span>
                  </span>
                  <span className="catalog-cover-title" title={item.title}>
                    {item.title}
                  </span>
                </a>
                <CatalogFollowButton
                  item={item}
                  actor={actor}
                  showToast={showToast}
                />
              </article>
            ) : (
              <article className="series-list-row" key={item.id}>
                <a className="series-list-cover" href={`/title/${item.slug}`} aria-label={`Open ${item.title}`}>
                  <CatalogCover item={item} compact />
                </a>
                <div className="series-list-content">
                  <div className="catalog-badge-row">
                    <SeriesTypeBadge type={item.type} />
                    <SeriesStatusBadge status={item.status} showIndicator={false} />
                    <span className="catalog-rating-badge">
                      <Star size={14} weight="fill" /> {(Number(item.ratingTenths) / 10).toFixed(1)}
                    </span>
                  </div>
                  <a href={`/title/${item.slug}`}>
                    <h2>{item.title}</h2>
                  </a>
                  <div className="list-stats">
                    <span><Books size={15} /> {Number(item.chapterCount ?? 0)}</span>
                    <span><ChatCircle size={15} /> {Number(item.commentCount ?? 0)}</span>
                    <span><Heart size={15} /> {Number(item.followerCount ?? 0).toLocaleString("en-US")}</span>
                  </div>
                </div>
                <CatalogFollowButton item={item} actor={actor} showToast={showToast} className="list-follow-button" />
              </article>
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
  const { settings: commercial, runtimeFeatures } = useCommercialSettings();
  const lockAndPayVisible = runtimeFeatures.paidSystem;
  const requestedCategory = normalizeStoreCategory(category);
  const selectedCategory =
    !lockAndPayVisible &&
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
  const [checkoutReturnStatus, setCheckoutReturnStatus] = useState("");
  const checkoutReturnHandled = useRef(false);
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
    if (actor && lockAndPayVisible) void fetch("/api/v1/wallet", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Wallet unavailable");
        return (await response.json()) as { balance?: number };
      })
      .then((payload) => setBalance(Number(payload.balance ?? 0)))
      .catch(() => {
        if (!controller.signal.aborted) setBalance(null);
      });
    return () => controller.abort();
  }, [actor, lockAndPayVisible, selectedCategory, storeRequestKey]);

  useEffect(() => {
    if (!actor || checkoutReturnHandled.current) return;
    const query = new URLSearchParams(window.location.search);
    const result = query.get("checkout");
    const orderId = query.get("order")?.trim() ?? "";
    if (!result) return;
    checkoutReturnHandled.current = true;
    const clearCheckoutQuery = () => {
      query.delete("checkout");
      query.delete("order");
      const next = `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", next);
    };
    if (result === "cancelled") {
      queueMicrotask(() =>
        setCheckoutReturnStatus("Checkout cancelled. Nothing was charged."),
      );
      showToast("Checkout cancelled. Nothing was charged.");
      clearCheckoutQuery();
      return;
    }
    if (result !== "success" || !orderId) {
      clearCheckoutQuery();
      return;
    }
    const controller = new AbortController();
    let attempt = 0;
    queueMicrotask(() =>
      setCheckoutReturnStatus(
        "Payment received. Waiting for secure confirmation…",
      ),
    );
    const poll = async (): Promise<void> => {
      attempt += 1;
      try {
        const response = await fetch("/api/v1/orders", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: Array<{ id?: string; status?: string }>;
        };
        if (!response.ok) throw new Error("Order status is unavailable.");
        const order = payload.data?.find((entry) => entry.id === orderId);
        if (order?.status === "PAID") {
          setCheckoutReturnStatus("Payment confirmed. Your purchase is now active.");
          showToast("Payment confirmed. Your purchase is now active.");
          setStoreRevision((value) => value + 1);
          clearCheckoutQuery();
          return;
        }
        if (["FAILED", "REFUNDED", "DISPUTED"].includes(order?.status ?? "")) {
          setCheckoutReturnStatus("This payment needs attention. Open Wallet → Orders for details.");
          showToast("This payment needs attention. Open Wallet → Orders for details.");
          clearCheckoutQuery();
          return;
        }
        if (attempt < 12) {
          window.setTimeout(() => void poll(), 1_500);
          return;
        }
        setCheckoutReturnStatus(
          "Confirmation is still processing. It will appear in Wallet → Orders automatically.",
        );
        clearCheckoutQuery();
      } catch {
        if (controller.signal.aborted) return;
        if (attempt < 12) {
          window.setTimeout(() => void poll(), 1_500);
          return;
        }
        setCheckoutReturnStatus(
          "Confirmation is still processing. Check Wallet → Orders in a moment.",
        );
        clearCheckoutQuery();
      }
    };
    void poll();
    return () => controller.abort();
  }, [actor, showToast]);

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

  async function buy(
    productId: string,
    billingCycle: "MONTHLY" | "ANNUAL" = "MONTHLY",
  ) {
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
          billingCycle,
          idempotencyKey: `${productId}:${clientRandomId()}`,
        }),
      });
      const payload = (await response.json()) as {
        checkoutUrl?: string;
        orderId?: string;
        expiresAt?: string | null;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Checkout could not be completed.");
      }
      let checkout: URL;
      try {
        checkout = new URL(payload.checkoutUrl ?? "");
      } catch {
        throw new Error("The payment provider returned an invalid Checkout URL.");
      }
      if (
        checkout.protocol !== "https:" ||
        (checkout.hostname !== "checkout.stripe.com" &&
          !checkout.hostname.endsWith(".checkout.stripe.com"))
      ) {
        throw new Error("The payment provider returned an invalid Checkout URL.");
      }
      window.location.assign(checkout.toString());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Checkout could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  async function manageMembership() {
    if (!actor) {
      window.location.assign(
        authEntryPath("login", "/store/memberships"),
      );
      return;
    }
    setBusy("billing-portal");
    try {
      const response = await fetch("/api/v1/payments/billing-portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json()) as {
        data?: { portalUrl?: string };
        portalUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Membership billing could not be opened.",
        );
      }
      let portal: URL;
      try {
        portal = new URL(payload.data?.portalUrl ?? payload.portalUrl ?? "");
      } catch {
        throw new Error("The payment provider returned an invalid billing URL.");
      }
      if (
        portal.protocol !== "https:" ||
        (portal.hostname !== "billing.stripe.com" &&
          !portal.hostname.endsWith(".billing.stripe.com"))
      ) {
        throw new Error("The payment provider returned an invalid billing URL.");
      }
      window.location.assign(portal.toString());
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Membership billing could not be opened.",
      );
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
        <div className="dots-ring-loading store-cosmetics-grid store-cosmetics-loading" role="status" aria-label="Loading Store" aria-busy="true">
          <DotsRing size="xl" label={null} />
          <span>Loading Store…</span>
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
            {lockAndPayVisible
              ? `${commercial.economy.coinPlural}, Shards, memberships, gifts, and cosmetics are shown clearly before confirmation.`
              : "Shard cosmetics and earned rewards are shown clearly before confirmation."}
          </p>
        </div>
        <a className="wallet-chip wallet-chip-multi" href="/wallet">
          {lockAndPayVisible ? (
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

      {checkoutReturnStatus ? (
        <div className="commerce-unavailable page-wrap" role="status">
          <ShieldCheck size={19} />
          <span>
            <strong>Secure checkout update</strong>
            {checkoutReturnStatus}
          </span>
        </div>
      ) : null}

      <nav className="store-section-nav page-wrap" aria-label="Store sections">
        {lockAndPayVisible ? (
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
        <div className="dots-ring-loading settings-loading page-wrap" role="status">
          <DotsRing size="lg" label={null} />
          <span>Loading this Store category…</span>
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

      {lockAndPayVisible && selectedCategory === "gifts" ? (
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
            {actor ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void manageMembership()}
                disabled={busy !== null}
              >
                {busy === "billing-portal"
                  ? "Opening billing…"
                  : "Manage existing membership"}
              </button>
            ) : null}
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
                  {billing === "monthly"
                    ? `${coinLabel(membership.monthlyCoins, commercial)} each month`
                    : `${coinLabel(membership.monthlyCoins * 12, commercial)} granted each membership year`}
                </li>
              ) : null}
              {membership.benefits.map((benefit) => (
                <li key={benefit}>
                  <Check size={18} /> {benefit}
                </li>
              ))}
            </ul>
            <button
              className="button button-primary"
              type="button"
              onClick={() =>
                void buy(
                  membership.id,
                  billing === "monthly" ? "MONTHLY" : "ANNUAL",
                )
              }
              disabled={
                !checkoutEnabled ||
                busy !== null ||
                (billing === "annual" && membership.annualPriceMinor <= 0)
              }
            >
              {busy === membership.id
                ? "Preparing…"
                : billing === "annual" && membership.annualPriceMinor <= 0
                  ? "Annual plan unavailable"
                  : checkoutEnabled
                    ? membership.ctaText
                    : "Coming soon"}
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
                <UnifiedSingleSelect
                  value={reportReason}
                  onChange={(event) => setReportReason(event.target.value)}
                >
                  <option>Spoilers without a warning</option>
                  <option>Harassment or hate</option>
                  <option>Spam or promotion</option>
                  <option>Illegal content</option>
                </UnifiedSingleSelect>
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
        <div className="dots-ring-loading comment-loading" role="status" aria-label="Loading comments">
          <DotsRing size="lg" label={null} />
          <span>Loading comments…</span>
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
  basePriceOnyx?: number;
  discountPercentage?: number | null;
  discountEndsAt?: string | null;
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
  const title = sanitizeChapterTitle(
    withoutPrefix
      .slice(sourceNumber.length)
      .replace(/^\s*[·:-]\s*/, ""),
  );
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
  status:
    | "ONGOING"
    | "COMPLETED"
    | "HIATUS"
    | "PAUSED"
    | "CANCELLED"
    | "UPCOMING";
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
          : detail.status === "CANCELLED"
            ? "Cancelled"
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
  const { settings: commercial, runtimeFeatures } = useCommercialSettings();
  const premiumEconomyPublic = runtimeFeatures.paidSystem;
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
  const [seriesBulkDiscount, setSeriesBulkDiscount] = useState<{
    percentage: number;
    endsAt: string;
  } | null>(null);
  const [bulkUnlocking, setBulkUnlocking] = useState(false);
  const bulkUnlockIdempotencyKey = useRef("");
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
    void fetch("/api/v1/discounts?sort=discount", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as {
          data?: Array<{
            seriesSlug: string;
            targetType: "SERIES" | "CHAPTER";
            percentage: number;
            endsAt: string;
            active: boolean;
            status: string;
          }>;
        };
        return (
          payload.data?.find(
            (discount) =>
              discount.seriesSlug === item.slug &&
              discount.targetType === "SERIES" &&
              discount.active &&
              discount.status === "ACTIVE" &&
              Date.parse(discount.endsAt) > Date.now(),
          ) ?? null
        );
      })
      .then((discount) => {
        if (!controller.signal.aborted) {
          setSeriesBulkDiscount(
            discount
              ? { percentage: discount.percentage, endsAt: discount.endsAt }
              : null,
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSeriesBulkDiscount(null);
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
  const bulkUnlockAvailable = Boolean(seriesBulkDiscount) && chapterPolicies.some(
    (chapter) =>
      chapter.accessType === "PAID" &&
      !chapter.canRead &&
      chapter.priceOnyx > 0 &&
      Boolean(chapter.discountPercentage),
  );

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

  async function unlockAllDiscountedChapters() {
    if (!actor) {
      window.location.href = authEntryPath("login", `/title/${item.slug}#chapters`);
      return;
    }
    if (!seriesBulkDiscount || bulkUnlocking) return;
    if (!bulkUnlockIdempotencyKey.current) {
      bulkUnlockIdempotencyKey.current = `series-unlock:${item.slug}:${clientRandomId()}`;
    }
    setBulkUnlocking(true);
    try {
      const response = await fetch("/api/v1/series-unlock-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesSlug: item.slug,
          idempotencyKey: bulkUnlockIdempotencyKey.current,
        }),
      });
      const payload = (await response.json()) as {
        unlockedChapterIds?: string[];
        totalPriceOnyx?: number;
        alreadyUnlocked?: boolean;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Discounted chapters could not be unlocked.");
      }
      const unlocked = new Set(payload.unlockedChapterIds ?? []);
      setChapterPolicies((current) =>
        current.map((chapter) =>
          unlocked.has(chapter.chapterId)
            ? { ...chapter, canRead: true, isUnlocked: true, reason: "UNLOCKED" }
            : chapter,
        ),
      );
      showToast(
        payload.alreadyUnlocked
          ? "All eligible discounted chapters are already unlocked."
          : `${unlocked.size} discounted chapter${unlocked.size === 1 ? "" : "s"} unlocked for ${coinLabel(Number(payload.totalPriceOnyx ?? 0), commercial)}.`,
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Discounted chapters could not be unlocked.",
      );
    } finally {
      setBulkUnlocking(false);
    }
  }

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
        <div className="dots-ring-loading catalog-loading" role="status">
          <DotsRing size="lg" label={null} />
          <span>Loading series details…</span>
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
                <details className="chapter-sort chapter-sort-menu">
                  <summary
                    aria-label={`Sort chapters: ${chapterOrder === "newest" ? "Newest" : "Oldest"}`}
                  >
                    <span aria-hidden="true">{chapterOrder === "newest" ? "N" : "O"}</span>
                    <CaretDown size={15} />
                  </summary>
                  <div>
                    {(["newest", "oldest"] as const).map((order) => (
                      <button
                        type="button"
                        key={order}
                        aria-pressed={chapterOrder === order}
                        onClick={(event) => {
                          setChapterOrder(order);
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                      >
                        {order === "newest" ? "Newest" : "Oldest"}
                      </button>
                    ))}
                  </div>
                </details>
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
                  {allChapterDetailsCollapsed ? "Show" : "Hide"}
                </button>
              </div>
            </div>
            <div className="chapter-action-bar" aria-label="Chapter actions">
              {bulkUnlockAvailable && seriesBulkDiscount ? (
                <button
                  className="series-bulk-unlock-action"
                  type="button"
                  disabled={bulkUnlocking}
                  onClick={() => void unlockAllDiscountedChapters()}
                >
                  <span aria-hidden="true">🔓</span>
                  {bulkUnlocking
                    ? "Unlocking…"
                    : `Unlock All · −${seriesBulkDiscount.percentage}% off`}
                </button>
              ) : null}
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
                  <Play size={16} weight="fill" /> <span className="desktop-action-label">Read Latest</span><span className="mobile-action-label">Last</span>
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
                  const groupPaid =
                    group.releases.length > 0 &&
                    group.releases.every(
                      (release) => release.accessType === "PAID",
                    );
                  return !detailsCollapsed ? (
                    <section
                      className={`chapter-release-group${groupPaid ? " is-paid" : ""}`}
                      key={group.number}
                      data-paid={groupPaid ? "true" : "false"}
                    >
                      <header>
                        <div>
                          <strong>
                            {groupLocked ? <LockSimple size={15} aria-label="Paid chapter" /> : null}
                            Chapter {group.number}
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
                        <span
                          className={`chapter-group-read-state${group.releases.some((release) => release.isRead) ? " is-read" : ""}`}
                          aria-label={group.releases.some((release) => release.isRead) ? "Viewed" : "Not viewed"}
                        >
                          <Eye
                            size={17}
                            weight={group.releases.some((release) => release.isRead) ? "fill" : "regular"}
                            aria-hidden="true"
                          />
                        </span>
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
                              className={`chapter-variant-row${chapter.accessType === "PAID" && !groupPaid ? " is-paid" : ""}`}
                              key={`${chapter.chapterId}:${chapter.version}:${chapter.language}`}
                              data-paid={chapter.accessType === "PAID" ? "true" : "false"}
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
                                  <span className="chapter-team-status-line">
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
                                    {premiumEconomyPublic ? (
                                      <span
                                        className={`chapter-access chapter-access-${access.toLowerCase().replaceAll(" ", "-")}`}
                                      >
                                        {access === "Free" ? (
                                          <Check size={14} />
                                        ) : (
                                          <LockSimple size={14} />
                                        )}
                                        {access}
                                        {chapter.priceOnyx > 0 && access === "Paid" ? (
                                          <span className="chapter-discount-price">
                                            {chapter.basePriceOnyx &&
                                            chapter.basePriceOnyx > chapter.priceOnyx ? (
                                              <s>{coinLabel(chapter.basePriceOnyx, commercial)}</s>
                                            ) : null}
                                            <span>· {coinLabel(chapter.priceOnyx, commercial)}</span>
                                            {chapter.discountPercentage ? (
                                              <b>−{chapter.discountPercentage}%</b>
                                            ) : null}
                                          </span>
                                        ) : null}
                                      </span>
                                    ) : null}
                                  </span>
                                  <time
                                    dateTime={chapter.publishedAt ?? undefined}
                                  >
                                    {chapter.publishedAt
                                      ? `${releaseTime(chapter.publishedAt)} ago`
                                      : "Publication pending"}
                                  </time>
                                </small>
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
                      className={`chapter-release-group chapter-release-compact${groupPaid ? " is-paid" : ""}`}
                      key={group.number}
                      data-paid={groupPaid ? "true" : "false"}
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
  accessLevel?: "FREE" | "PAID" | "PREMIUM";
  priceOnyx: number;
  basePriceOnyx?: number;
  discountPercentage?: number | null;
  discountEndsAt?: string | null;
  canRead: boolean;
  isUnlocked: boolean;
  administratorPreview: boolean;
  reason:
    | "FREE"
    | "UNLOCKED"
    | "MEMBERSHIP"
    | "ADMINISTRATOR_PREVIEW"
    | "SIGN_IN_REQUIRED"
    | "PURCHASE_REQUIRED"
    | "MEMBERSHIP_REQUIRED"
    | "UNAVAILABLE";
};

type AdUnlockChallengeData = {
  challengeId: string;
  status: "PENDING" | "VERIFIED" | "CLAIMED" | "EXPIRED";
  expiresAt: string;
  providerUrl?: string;
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
  slug: "upvote" | "heart" | "laugh" | "surprised" | "sad" | "angry";
  name: string;
  accessibleLabel: string;
  emojiFallback: string;
  imageUrl: string | null;
  count: number;
  selected: boolean;
};

const CHAPTER_REACTION_PRESENTATION: Record<
  ChapterReaction["slug"],
  { label: string; order: number; emoji?: string }
> = {
  upvote: { label: "Like", order: 0 },
  heart: { label: "Love", order: 1 },
  laugh: { label: "Laugh", order: 2, emoji: "😆" },
  surprised: { label: "Wow", order: 3, emoji: "😮" },
  sad: { label: "Sad", order: 4, emoji: "😢" },
  angry: { label: "Angry", order: 5, emoji: "😠" },
};

function ChapterReactionVisual({ slug }: { slug: ChapterReaction["slug"] }) {
  const presentation = CHAPTER_REACTION_PRESENTATION[slug];
  return (
    <span className="chapter-reaction-icon" data-reaction={slug} aria-hidden="true">
      {slug === "upvote" ? (
        <ThumbsUp size={34} weight="fill" />
      ) : slug === "heart" ? (
        <Heart size={34} weight="fill" />
      ) : (
        presentation.emoji
      )}
    </span>
  );
}

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
              <DotsRing size={24} />
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
  const { settings: commercial, runtimeFeatures } = useCommercialSettings();
  const premiumEconomyPublic = runtimeFeatures.paidSystem;
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
  const [adUnlockAvailable, setAdUnlockAvailable] = useState(false);
  const [adUnlockBusy, setAdUnlockBusy] = useState(false);
  const [adChallenge, setAdChallenge] =
    useState<AdUnlockChallengeData | null>(null);
  const [readerPages, setReaderPages] = useState<ReaderPageData[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState("");
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletError, setWalletError] = useState("");
  const [chapterReactions, setChapterReactions] = useState<ChapterReaction[]>([]);
  const [reactionBusy, setReactionBusy] = useState("");
  const [chapterReactionsLoading, setChapterReactionsLoading] = useState(true);
  const [chapterReactionsError, setChapterReactionsError] = useState("");
  const [chapterReactionsReload, setChapterReactionsReload] = useState(0);
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
  const adUnlockPoll = useRef<AbortController | null>(null);
  const adUnlockClaiming = useRef(false);
  const readerSeeking = useRef(false);
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
  const activeChapterRelease = releaseChapters.find(
    (chapter) => chapter.chapterSlug === routeChapterSlug,
  );
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
    adUnlockPoll.current?.abort();
    adUnlockPoll.current = null;
    adUnlockClaiming.current = false;
    const reset = window.setTimeout(() => {
      setAdChallenge(null);
      setAdUnlockBusy(false);
    }, 0);
    return () => window.clearTimeout(reset);
  }, [routeChapterSlug, routeSeriesSlug]);

  useEffect(
    () => () => {
      chapterListRequest.current?.abort();
      adUnlockPoll.current?.abort();
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
              .then((payloadValue) => {
                const payload = payloadValue as { data?: { readerTypeDefaults?: { manga?: string; vertical?: string }; readerSettings?: Partial<ReaderSettings> } } | null;
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
    const timer = window.setTimeout(() => {
      setChapterReactionsLoading(true);
      setChapterReactionsError("");
      void fetch(`/api/v1/chapter-reactions?chapterId=${encodeURIComponent(readerContext.chapter.id)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { data?: ChapterReaction[]; meta?: { replyCount?: number; showReplyBadge?: boolean }; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? "Chapter reactions could not be loaded.");
        setChapterReactions(payload.data ?? []);
        setCommentReplyBadge({ count: Number(payload.meta?.replyCount ?? 0), enabled: payload.meta?.showReplyBadge !== false });
      })
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setChapterReactions([]);
        setChapterReactionsError(error instanceof Error ? error.message : "Chapter reactions could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setChapterReactionsLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [chapterReactionsReload, readerContext?.chapter.id]);

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
        if (index >= 0 && !readerSeeking.current) setPage(index + 1);
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
      !actor ||
      !premiumEconomyPublic ||
      access?.reason !== "PURCHASE_REQUIRED" ||
      access.accessLevel === "PREMIUM"
    ) {
      const reset = window.setTimeout(() => setAdUnlockAvailable(false), 0);
      return () => window.clearTimeout(reset);
    }
    const controller = new AbortController();
    void fetch(
      `/api/v1/ad-unlocks?seriesSlug=${encodeURIComponent(routeSeriesSlug)}&chapterSlug=${encodeURIComponent(routeChapterSlug)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: { available?: boolean };
        };
        if (!response.ok) return false;
        return payload.data?.available === true;
      })
      .then((available) => {
        if (!controller.signal.aborted) setAdUnlockAvailable(available);
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") {
          setAdUnlockAvailable(false);
        }
      });
    return () => controller.abort();
  }, [
    access?.accessLevel,
    access?.reason,
    actor,
    premiumEconomyPublic,
    routeChapterSlug,
    routeSeriesSlug,
  ]);

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

  function seekReader(targetPage: number, smooth = false) {
    if (!panelCount) return;
    const nextPage = Math.min(panelCount, Math.max(1, Math.round(targetPage)));
    setPage(nextPage);
    if (mode === "vertical") {
      document
        .querySelector<HTMLElement>(
          `.reader-stage [aria-label="Page ${nextPage}"]`,
        )
        ?.scrollIntoView({
          block: "start",
          behavior: smooth ? "smooth" : "auto",
        });
    }
  }

  function seekReaderFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    seekReader(1 + ratio * Math.max(0, panelCount - 1));
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

  async function claimAdUnlock(challengeId: string) {
    if (adUnlockClaiming.current) return;
    adUnlockClaiming.current = true;
    setAdUnlockBusy(true);
    setAccessError("");
    try {
      const response = await fetch("/api/v1/ad-unlocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "CLAIM", challengeId }),
      });
      const payload = (await response.json()) as {
        data?: AdUnlockChallengeData & { access?: ChapterAccessData };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data?.access?.canRead) {
        throw new Error(
          payload.error?.message ??
            "The verified ad reward could not grant chapter access.",
        );
      }
      setAdChallenge((current) =>
        current
          ? { ...current, status: "CLAIMED" }
          : {
              challengeId,
              status: "CLAIMED",
              expiresAt: new Date().toISOString(),
            },
      );
      setAdUnlockAvailable(false);
      setReaderContext((current) =>
        current ? { ...current, access: payload.data!.access! } : current,
      );
      showToast("Chapter access granted after verified ad completion.");
    } catch (error) {
      setAccessError(
        error instanceof Error
          ? error.message
          : "The ad reward could not be claimed.",
      );
    } finally {
      adUnlockClaiming.current = false;
      setAdUnlockBusy(false);
    }
  }

  async function pollAdUnlockChallenge(
    challengeId: string,
    maxAttempts = 90,
  ) {
    adUnlockPoll.current?.abort();
    const controller = new AbortController();
    adUnlockPoll.current = controller;
    setAdUnlockBusy(true);
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await fetch(
          `/api/v1/ad-unlocks?challengeId=${encodeURIComponent(challengeId)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const payload = (await response.json()) as {
          data?: AdUnlockChallengeData;
          error?: { message?: string };
        };
        if (!response.ok || !payload.data) {
          throw new Error(
            payload.error?.message ?? "Ad completion could not be checked.",
          );
        }
        setAdChallenge((current) => ({
          ...payload.data!,
          providerUrl: current?.providerUrl,
        }));
        if (payload.data.status === "VERIFIED") {
          controller.abort();
          adUnlockPoll.current = null;
          await claimAdUnlock(challengeId);
          return;
        }
        if (payload.data.status === "CLAIMED") {
          controller.abort();
          adUnlockPoll.current = null;
          setAdUnlockBusy(false);
          setContextRevision((value) => value + 1);
          return;
        }
        if (payload.data.status === "EXPIRED") {
          throw new Error("This ad unlock attempt expired. Start a new one.");
        }
        if (attempt < maxAttempts - 1) {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(resolve, 3_000);
            controller.signal.addEventListener(
              "abort",
              () => {
                window.clearTimeout(timeout);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          });
        }
      }
      showToast(
        "Ad verification is still pending. Use Check ad status when it finishes.",
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setAccessError(
          error instanceof Error
            ? error.message
            : "Ad completion could not be checked.",
        );
      }
    } finally {
      if (adUnlockPoll.current === controller) {
        adUnlockPoll.current = null;
        setAdUnlockBusy(false);
      }
    }
  }

  async function startAdUnlock() {
    if (!actor) {
      window.location.href = authEntryPath(
        "login",
        `/title/${routeSeriesSlug}/chapter/${routeChapterSlug}`,
      );
      return;
    }
    let providerWindow: Window | null = null;
    try {
      providerWindow = window.open(
        "about:blank",
        "nyascans-ad-unlock",
        "popup,width=560,height=760",
      );
      if (providerWindow) providerWindow.opener = null;
    } catch {
      providerWindow = null;
    }
    setAdUnlockBusy(true);
    setAccessError("");
    try {
      const response = await fetch("/api/v1/ad-unlocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "CREATE",
          seriesSlug: routeSeriesSlug,
          chapterSlug: routeChapterSlug,
        }),
      });
      const payload = (await response.json()) as {
        data?: AdUnlockChallengeData;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(
          payload.error?.message ?? "The ad unlock could not be started.",
        );
      }
      setAdChallenge(payload.data);
      if (payload.data.status === "VERIFIED") {
        providerWindow?.close();
        await claimAdUnlock(payload.data.challengeId);
        return;
      }
      if (!payload.data.providerUrl) {
        providerWindow?.close();
        throw new Error("The ad provider did not return a safe destination.");
      }
      if (providerWindow) {
        providerWindow.location.replace(payload.data.providerUrl);
      }
      void pollAdUnlockChallenge(payload.data.challengeId);
    } catch (error) {
      providerWindow?.close();
      setAdUnlockBusy(false);
      setAccessError(
        error instanceof Error
          ? error.message
          : "The ad unlock could not be started.",
      );
    }
  }

  function checkAdUnlockStatus() {
    if (!adChallenge?.challengeId) return;
    void pollAdUnlockChallenge(adChallenge.challengeId, 1);
  }

  if (!access) {
    return (
      <main className="reader-access-page">
        <a className="reader-access-back" href={`/title/${routeSeriesSlug}`}>
          <CaretLeft size={18} /> Back to {seriesTitle}
        </a>
        <section
          className={`reader-access-card ${accessError ? "reader-access-error" : "reader-access-loading"}`}
          role={accessError ? "alert" : "status"}
        >
          {accessError ? <WarningCircle size={30} /> : <DotsRing size="lg" label={null} />}
          <strong>{accessError ? "This chapter is currently unavailable." : "Checking chapter access…"}</strong>
          <p>
            {accessError
              ? "The reader stays closed while this chapter is unavailable."
              : "The reader stays closed until this chapter’s release and entitlement rules are verified."}
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
                    {access.basePriceOnyx &&
                    access.basePriceOnyx > access.priceOnyx ? (
                      <s className="reader-lock-original-price">
                        {coinLabel(access.basePriceOnyx, commercial)}
                      </s>
                    ) : null}{" "}
                    {coinLabel(access.priceOnyx, commercial)}
                    {access.discountPercentage ? (
                      <span className="reader-lock-discount-badge">
                        −{access.discountPercentage}%
                      </span>
                    ) : null}
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
                {adUnlockAvailable ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={adUnlockBusy || unlocking}
                    onClick={() => void startAdUnlock()}
                  >
                    {adUnlockBusy ? (
                      <DotsRing size={18} />
                    ) : (
                      <Play size={18} weight="fill" />
                    )}
                    {adUnlockBusy
                      ? "Waiting for ad verification…"
                      : "Unlock by watching an ad"}
                  </button>
                ) : null}
              </div>
            ) : null}
            {adChallenge && adChallenge.status !== "CLAIMED" ? (
              <>
                <p role="status">
                  {adChallenge.status === "VERIFIED"
                    ? "Ad completion verified. Granting temporary access…"
                    : "Complete the provider’s ad. Access is granted only after its signed verification arrives."}
                </p>
                <div className="reader-unlock-actions">
                  {adChallenge.providerUrl ? (
                    <a
                      className="button button-secondary"
                      href={adChallenge.providerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Play size={18} weight="fill" /> Resume ad
                    </a>
                  ) : null}
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={adUnlockBusy}
                    onClick={checkAdUnlockStatus}
                  >
                    <CheckCircle size={18} /> Check ad status
                  </button>
                </div>
              </>
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

  const orderedChapterReactions = [...chapterReactions].sort(
    (left, right) =>
      CHAPTER_REACTION_PRESENTATION[left.slug].order -
      CHAPTER_REACTION_PRESENTATION[right.slug].order,
  );
  const chapterReactionPrompt = (
    <>
      <header className="comments-header chapter-reactions-header">
        <div>
          <h2 id="chapter-reactions-title">Chapter Reactions</h2>
        </div>
      </header>
      {orderedChapterReactions.length ? (
        <section className="chapter-reactions-box" aria-labelledby="chapter-reactions-title">
          <div className="chapter-reaction-options">
            {orderedChapterReactions.map((reaction) => {
              const presentation = CHAPTER_REACTION_PRESENTATION[reaction.slug];
              return (
                <button
                  type="button"
                  key={reaction.id}
                  aria-label={`${presentation.label}: ${reaction.count.toLocaleString()} reactions`}
                  aria-pressed={reaction.selected}
                  disabled={Boolean(reactionBusy)}
                  onClick={() => void toggleChapterReaction(reaction.id)}
                >
                  <ChapterReactionVisual slug={reaction.slug} />
                  <small>{reaction.count.toLocaleString()}</small>
                  <strong>{presentation.label}</strong>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="chapter-reactions-box is-status" aria-labelledby="chapter-reactions-title">
          <span>{chapterReactionsLoading ? "Loading reactions…" : chapterReactionsError || "Reactions are temporarily unavailable."}</span>
          {!chapterReactionsLoading ? <button className="button button-secondary" type="button" onClick={() => { setChapterReactionsLoading(true); setChapterReactionsError(""); setChapterReactionsReload((value) => value + 1); }}>Retry reactions</button> : null}
        </section>
      )}
    </>
  );

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
                    <LanguageFlag language={readerContext.chapter.language} showCode={false} />
                  ) : null}
                  <span>·</span>
                  {activeChapterRelease?.teamSlug ? (
                    <a href={`/team/${encodeURIComponent(activeChapterRelease.teamSlug)}`}>
                      {activeChapterRelease.teamName ?? teamName}
                    </a>
                  ) : (
                    <span>{teamName}</span>
                  )}
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
                  <DotsRing size={22} />
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
                  const chapterHref = `/title/${routeSeriesSlug}/chapter/${chapter.chapterSlug}`;
                  const paid = chapter.accessType === "PAID";
                  return (
                    <article
                      className={current ? "is-current" : ""}
                      key={`${chapter.chapterSlug}:${chapter.version}`}
                      aria-current={current ? "page" : undefined}
                    >
                      <span>
                        {chapter.canRead ? (
                          <CheckCircle size={17} />
                        ) : (
                          <LockSimple size={17} />
                        )}
                      </span>
                      <div>
                        <a
                          className="reader-chapter-primary"
                          href={chapterHref}
                          onClick={() => closeChapterDrawer(false)}
                        >
                          <strong>
                            <FreshChapterMark fresh={chapter.isFresh} />
                            <LanguageFlag language={chapter.language} showCode={false} />
                            {chapterDisplayLabel(chapter)}
                          </strong>
                        </a>
                        <small>
                          {chapter.teamSlug ? (
                            <a
                              className="reader-chapter-team"
                              href={`/team/${encodeURIComponent(chapter.teamSlug)}`}
                            >
                              {chapter.teamName ?? "Publishing team"}
                            </a>
                          ) : (
                            <span>{chapter.teamName ?? "Independent release"}</span>
                          )}
                          {premiumEconomyPublic ? (
                            <span className={`reader-chapter-access is-${paid ? "paid" : "free"}`}>
                              {paid ? <LockSimple size={12} /> : <Check size={12} />}
                              {paid ? "Paid" : "Free"}
                            </span>
                          ) : null}
                        </small>
                      </div>
                      {current ? (
                        <em>Reading</em>
                      ) : (
                        <a
                          className="reader-chapter-open"
                          href={chapterHref}
                          aria-label={`Read ${chapterDisplayLabel(chapter)}`}
                          onClick={() => closeChapterDrawer(false)}
                        >
                          <CaretRight size={17} />
                        </a>
                      )}
                    </article>
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
            <DotsRing size={28} />
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
                  <LanguageFlag language={alternative.language} showCode={false} />
                  <span>
                    <strong>{alternative.chapterLabel}</strong>
                    <small>{alternative.teamName ?? "Independent release"}</small>
                  </span>
                  {premiumEconomyPublic ? (
                    <em className={`reader-chapter-access is-${alternative.accessType === "FREE" ? "free" : "paid"}`}>
                      {alternative.accessType === "FREE" ? "Free" : "Paid"}
                    </em>
                  ) : null}
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
        <div className="reader-progress-shell">
          {previousChapter ? <a href={`/title/${routeSeriesSlug}/chapter/${previousChapter.slug}`} aria-label={`Previous chapter ${previousChapter.number}`}><CaretLeft size={18} /></a> : <span aria-hidden="true" />}
          <div
            className="reader-progress"
            role="slider"
            tabIndex={panelCount ? 0 : -1}
            aria-label="Reading position"
            aria-valuemin={panelCount ? 1 : 0}
            aria-valuemax={panelCount}
            aria-valuenow={panelCount ? page : 0}
            aria-valuetext={panelCount ? `Page ${page} of ${panelCount}` : "No pages"}
            onPointerDown={(event) => {
              if (!panelCount) return;
              readerSeeking.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              seekReaderFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (readerSeeking.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
                seekReaderFromPointer(event);
              }
            }}
            onPointerUp={(event) => {
              seekReaderFromPointer(event);
              readerSeeking.current = false;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              readerSeeking.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                event.preventDefault();
                seekReader(page - 1, true);
              } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                event.preventDefault();
                seekReader(page + 1, true);
              } else if (event.key === "Home") {
                event.preventDefault();
                seekReader(1, true);
              } else if (event.key === "End") {
                event.preventDefault();
                seekReader(panelCount, true);
              }
            }}
          >
          <i
            style={{
              width: `${panelCount ? (page / panelCount) * 100 : 0}%`,
            }}
          />
          </div>
          {nextChapter ? <a href={`/title/${routeSeriesSlug}/chapter/${nextChapter.slug}`} aria-label={`Next chapter ${nextChapter.number}`}><CaretRight size={18} /></a> : <span aria-hidden="true" />}
        </div>
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
    <div className="dots-ring-loading commerce-loading" role="status">
      <DotsRing size="lg" label={null} />
      <span>Loading wallet and purchases…</span>
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
  authenticatedIdentity: Pick<
    Actor,
    "displayName" | "email" | "authMethod"
  > | null;
  accountBlocked: boolean;
  returnTo: string;
}) {
  const { settings: commercial } = useCommercialSettings();
  const premiumEconomyPublic =
    commercial.economy.premiumEconomyPublic;
  const signInHref =
    `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`;
  const isSignup = intent === "signup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [verifyingLink, setVerifyingLink] = useState(false);

  useEffect(() => {
    if (!isSignup) return;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const token = hash.get("verify");
    if (!token) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
        setAuthError("This verification link is invalid.");
        return;
      }
      setVerifyingLink(true);
      void fetch("/api/v1/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            returnTo?: string;
            error?: { message?: string };
          };
          if (!response.ok) {
            throw new Error(
              payload.error?.message ??
                "This verification link could not be used.",
            );
          }
          window.location.replace(payload.returnTo || returnTo);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setAuthError(
              error instanceof Error
                ? error.message
                : "This verification link could not be used.",
            );
            setVerifyingLink(false);
          }
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isSignup, returnTo]);

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSignup && password !== confirmation) {
      setAuthError("Passwords do not match.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const endpoint = isSignup
        ? "/api/v1/auth/signup"
        : "/api/v1/auth/login";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(isSignup ? { confirmPassword: confirmation } : {}),
          returnTo,
        }),
      });
      const payload = (await response.json()) as {
        returnTo?: string;
        message?: string;
        error?: { code?: string; message?: string };
      };
      if (!response.ok) {
        const authFailure = new Error(
          payload.error?.message ?? "The request could not be completed.",
        ) as Error & { code?: string };
        authFailure.code = payload.error?.code;
        throw authFailure;
      }
      if (isSignup) {
        setPassword("");
        setConfirmation("");
        setVerificationRequired(true);
        setAuthMessage(
          payload.message ??
            "Check your inbox and use the one-time verification link.",
        );
      } else {
        window.location.assign(payload.returnTo || returnTo);
      }
    } catch (error) {
      const failure = error as Error & { code?: string };
      if (failure.code === "EMAIL_VERIFICATION_REQUIRED") {
        setVerificationRequired(true);
      }
      setAuthError(
        failure.message || "The request could not be completed.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function signInWithPasskey() {
    if (isSignup) return;
    setAuthBusy(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const query = email.trim() ? `?email=${encodeURIComponent(email.trim().toLowerCase())}` : "";
      const beginResponse = await fetch(`/api/v1/auth/passkey${query}`, { cache: "no-store" });
      const beginPayload = (await beginResponse.json()) as {
        data?: { challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] };
        error?: { message?: string };
      };
      if (!beginResponse.ok || !beginPayload.data) {
        throw new Error(beginPayload.error?.message ?? "Passkey sign-in could not start.");
      }
      const credential = await startAuthentication({ optionsJSON: beginPayload.data.options });
      const finishResponse = await fetch("/api/v1/auth/passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: beginPayload.data.challengeId, response: credential }),
      });
      const finishPayload = (await finishResponse.json()) as { data?: { signedIn?: boolean }; error?: { message?: string } };
      if (!finishResponse.ok) throw new Error(finishPayload.error?.message ?? "Passkey sign-in could not be completed.");
      window.location.assign(returnTo);
    } catch (failure) {
      setAuthError(failure instanceof Error ? failure.message : "Passkey sign-in was cancelled or failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendVerification() {
    if (!email) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch("/api/v1/auth/resend-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, returnTo }),
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "The verification email could not be sent.",
        );
      }
      setAuthMessage(
        payload.message ?? "If the account is pending, a new email is on its way.",
      );
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : "The verification email could not be sent.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

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
              <LogoutAction
                className="button button-quiet"
                authMethod={(actor ?? authenticatedIdentity)?.authMethod}
                returnTo="/login"
              >
                Use Another Account
              </LogoutAction>
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
                Continue to the page you requested. Your verified session is
                protected by the sign-in method you selected.
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
                  ? "Register with email and a password, then verify your address using the one-time link we send."
                  : "Use your verified email account or continue with ChatGPT. You will return to the page you requested."}
              </p>
            </div>
            {verifyingLink ? (
              <div className="auth-local-status" role="status">
                <DotsRing size={19} />
                Verifying your one-time link…
              </div>
            ) : null}
            <form
              className="auth-local-form"
              onSubmit={submitCredentials}
              aria-busy={authBusy}
            >
              <label>
                <span>Email address</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                  required
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={isSignup ? 15 : 1}
                  maxLength={128}
                  required
                  aria-describedby={isSignup ? "password-requirement" : undefined}
                />
                {isSignup ? (
                  <small id="password-requirement">
                    Use at least 15 characters. Passwords are hashed before storage.
                  </small>
                ) : null}
              </label>
              {isSignup ? (
                <label>
                  <span>Confirm password</span>
                  <input
                    type="password"
                    name="confirmPassword"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    minLength={15}
                    maxLength={128}
                    required
                  />
                </label>
              ) : null}
              {authError ? (
                <p className="auth-local-feedback is-error" role="alert">
                  <WarningCircle size={17} /> {authError}
                </p>
              ) : null}
              {authMessage ? (
                <p className="auth-local-feedback is-success" role="status">
                  <CheckCircle size={17} /> {authMessage}
                </p>
              ) : null}
              <div className="auth-local-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={authBusy || verifyingLink}
                >
                  {authBusy ? <DotsRing size={18} /> : null}
                  {isSignup ? "Create Account" : "Sign In"}
                </button>
                {verificationRequired ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={authBusy || !email}
                    onClick={() => void resendVerification()}
                  >
                    Resend verification email
                  </button>
                ) : null}
              </div>
            </form>
            {!isSignup ? (
              <button className="auth-passkey-button" type="button" onClick={() => void signInWithPasskey()} disabled={authBusy || verifyingLink}>
                {authBusy ? <DotsRing size={19} /> : <Key size={20} weight="fill" />}
                <span>Sign in with a passkey</span>
                <ArrowRight size={18} />
              </button>
            ) : null}
            <div className="auth-provider-divider" role="separator">
              <span>or</span>
            </div>
            <a className="auth-provider-button" href={signInHref}>
              <ShieldCheck size={21} weight="fill" />
              <span>
                {isSignup
                  ? "Create or continue with ChatGPT"
                  : "Continue with ChatGPT"}
              </span>
              <ArrowRight size={18} />
            </a>
            <div className="auth-provider-note">
              <ShieldCheck size={18} />
              <p>
                Secure provider session. NyaScans never receives or stores your
                ChatGPT password or provider token. Email passwords are stored
                only as salted PBKDF2 hashes.
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
  const { settings: commercial, runtimeFeatures } = useCommercialSettings();
  const premiumEconomyPublic = runtimeFeatures.paidSystem;
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
            href={authEntryPath("login", "/")}
          >
            <SignIn size={18} />
            Open Sign In
          </a>
          <div className="auth-assurances">
            <span><ShieldCheck size={17} /> Secure session</span>
            <span><Key size={17} /> Passkey sign-in available</span>
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
                  <UnifiedSingleSelect
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
                  </UnifiedSingleSelect>
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
                  <UnifiedSingleSelect
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
                  </UnifiedSingleSelect>
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
          <AccountSecurityWorkspace />
        ) : section === "Connected accounts" ? (
          <div className="connected-account-list">
            <article>
              <span><ShieldCheck size={22} weight="fill" /></span>
              <div>
                <strong>
                  {actor.authMethod === "PASSWORD"
                    ? "Verified email account"
                    : "ChatGPT identity"}
                </strong>
                <small>{actor.email} · connected</small>
              </div>
              <em>Primary</em>
            </article>
            <p>
              {actor.authMethod === "PASSWORD"
                ? "You can also use ChatGPT sign-in with this verified address. Provider tokens are never stored by NyaScans."
                : "Email and password registration is also available. Additional external providers require a supported identity service."}
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

type OperationsNavigationItem = {
  slug: string;
  label: string;
  icon: PhosphorIcon;
  aliases: readonly string[];
  keywords: readonly string[];
  children?: readonly AdminNavigationChild[];
};

type OperationsNavigationGroup = {
  id: string;
  label: string;
  items: readonly OperationsNavigationItem[];
};

const ADMIN_NAVIGATION_ICONS: Readonly<Record<string, PhosphorIcon>> = {
  home: ChartLineUp,
  series: Books,
  chapters: LockSimple,
  "genres-tags": Tag,
  sliders: SlidersHorizontal,
  "pinned-series": PushPin,
  "editorial-picks": Star,
  "announcements-ads": Megaphone,
  "series-submissions": FileText,
  "chapter-review": CheckCircle,
  "access-decisions": WarningCircle,
  "team-directory": ShieldCheck,
  "team-requests": UsersThree,
  "users-roles": UsersThree,
  permissions: Key,
  reports: WarningCircle,
  discussions: ChatCircle,
  "support-tickets": Lifebuoy,
  "wallet-balances": Wallet,
  payouts: Coins,
  transactions: Storefront,
  store: Storefront,
  discounts: Tag,
  roulette: Sparkle,
  "content-access-control": Eye,
  "branding-appearance": GearSix,
  "footer-legal": FileText,
  "keyboard-shortcuts": Key,
  "feature-flags": SquaresFour,
  security: Key,
  identifiers: HashStraight,
  "bot-activity": Pulse,
  "integrations-api": CreditCard,
  "activity-log": Pulse,
};

const LEGACY_UPLOAD_SUBSECTIONS = new Set([
  "dashboard",
  "series-requests",
  "series",
  "single",
  "multi",
  "drafts",
  "history",
  "review-status",
  "rights",
  "rules",
]);

const LEGACY_UPLOAD_SUBSECTION_ALIASES: Readonly<Record<string, string>> = {
  "create-new-series": "add-series",
  "my-series-requests": "series-requests",
  "single-chapter": "single",
  "multi-chapter": "multi",
  "upload-history": "history",
  "upload-rules": "rules",
};

function canonicalAdminSubsection(
  item: OperationsNavigationItem | undefined,
  subsection: string | undefined,
) {
  const normalized = normalizeAdminNavigationKey(subsection);
  if (!normalized) return "";
  const child = item?.children?.find((nested) =>
    [nested.slug, nested.label, ...nested.aliases].some(
      (candidate) => normalizeAdminNavigationKey(candidate) === normalized,
    ),
  );
  return child?.slug ?? normalized;
}

function resolveAdminLocation(
  items: readonly OperationsNavigationItem[],
  section: string | undefined,
  subsection: string | undefined,
  fallbackSection: string,
) {
  const normalizedSection = normalizeAdminNavigationKey(section);
  const normalizedSubsection = normalizeAdminNavigationKey(subsection);
  const itemForSlug = (slug: string) =>
    items.find((candidate) => candidate.slug === slug);
  const location = (
    item: OperationsNavigationItem | undefined,
    nextSubsection = normalizedSubsection,
    unavailableLabel?: string,
  ) => ({
    section: item?.label ?? unavailableLabel ?? fallbackSection,
    subsection: canonicalAdminSubsection(item, nextSubsection),
  });

  if (["upload-center", "uploads"].includes(normalizedSection)) {
    const legacySubsection =
      LEGACY_UPLOAD_SUBSECTION_ALIASES[normalizedSubsection] ??
      normalizedSubsection;
    if (legacySubsection === "add-series") {
      return location(itemForSlug("series"), "new", "Series");
    }
    return location(
      itemForSlug("chapters"),
      legacySubsection || "dashboard",
      "Chapters",
    );
  }

  if (normalizedSection === "appearance") {
    if (["footer", "legal"].includes(normalizedSubsection)) {
      return location(itemForSlug("footer-legal"), normalizedSubsection);
    }
    if (normalizedSubsection === "shortcuts") {
      return location(itemForSlug("keyboard-shortcuts"));
    }
    const appearanceSubsection =
      normalizedSubsection === "reader-assets"
        ? "reader"
        : normalizedSubsection === "colors"
          ? "theme"
          : normalizedSubsection;
    return location(itemForSlug("branding-appearance"), appearanceSubsection);
  }

  if (["footer", "legal"].includes(normalizedSection) && !normalizedSubsection) {
    return location(itemForSlug("footer-legal"), normalizedSection);
  }
  if (["audit", "audit-log"].includes(normalizedSection) && !normalizedSubsection) {
    return location(itemForSlug("activity-log"), "technical", "Activity Log");
  }
  if (["activity", "user-activity"].includes(normalizedSection) && !normalizedSubsection) {
    return location(itemForSlug("activity-log"), "readable", "Activity Log");
  }
  if (["commerce", "offers"].includes(normalizedSection) && !normalizedSubsection) {
    return location(itemForSlug("store"), "offers", "Store");
  }
  if (normalizedSection === "store-management" && !normalizedSubsection) {
    return location(itemForSlug("store"), "coins", "Store");
  }

  const destination = findAdminNavigationDestination(normalizedSection);
  return location(
    itemForSlug(destination?.item.slug ?? normalizedSection),
    normalizedSubsection,
    destination?.item.label,
  );
}

function workspaceNavigationItem(
  label: string,
  icon: PhosphorIcon,
): OperationsNavigationItem {
  return {
    slug: label.toLowerCase().replaceAll(" ", "-"),
    label,
    icon,
    aliases: [],
    keywords: [],
  };
}

type AdminCommandEntry = {
  id: string;
  label: string;
  description: string;
  group: string;
  section: string;
  subsection?: string;
  icon: PhosphorIcon;
  keywords: readonly string[];
  kind: "page" | "action";
};

const ADMIN_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function adminFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(ADMIN_FOCUSABLE_SELECTOR),
  ).filter((element) => {
    if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  });
}

function restoreAdminFocus(
  previousFocus: HTMLElement | null,
  fallbackSelector?: string,
) {
  const canReceiveFocus = (element: HTMLElement | null) => {
    if (
      !element?.isConnected ||
      element.closest("[hidden], [inert], [aria-hidden='true']")
    ) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  };
  const fallback = fallbackSelector
    ? document.querySelector<HTMLElement>(fallbackSelector)
    : null;
  const target = canReceiveFocus(previousFocus)
    ? previousFocus
    : canReceiveFocus(fallback)
      ? fallback
      : null;
  target?.focus({ preventScroll: true });
}

function AdminCommandPalette({
  groups,
  capabilities,
  onClose,
  onChoose,
}: {
  groups: readonly OperationsNavigationGroup[];
  capabilities: readonly string[];
  onClose(): void;
  onChoose(section: string, subsection?: string): void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const granted = useMemo(() => new Set(capabilities), [capabilities]);
  const entries = useMemo<AdminCommandEntry[]>(() => {
    const pages = groups.flatMap((group) =>
      group.items.flatMap((item) => [
        {
          id: `page:${item.slug}`,
          label: item.label,
          description: `Open ${group.label || item.label}`,
          group: group.label || "Activity",
          section: item.label,
          icon: item.icon,
          keywords: [item.slug, ...item.aliases, ...item.keywords],
          kind: "page" as const,
        },
        ...(item.children ?? []).map((nested) => ({
          id: `page:${item.slug}/${nested.slug}`,
          label: `${item.label} · ${nested.label}`,
          description: `Open ${nested.label}`,
          group: group.label || "Activity",
          section: item.label,
          subsection: nested.slug,
          icon: item.icon,
          keywords: [
            item.slug,
            ...item.keywords,
            nested.slug,
            ...nested.aliases,
            ...nested.keywords,
          ],
          kind: "page" as const,
        })),
      ]),
    );
    const actions = ADMIN_COMMON_ACTIONS.filter((action) =>
      granted.has(action.capability),
    ).flatMap((action) => {
      const destination = groups
        .flatMap((group) => group.items)
        .find((item) => item.slug === action.sectionSlug);
      if (!destination) return [];
      return [
        {
          id: `action:${action.id}`,
          label: action.label,
          description: action.description,
          group: "Quick action",
          section: destination.label,
          subsection:
            "subsectionSlug" in action ? action.subsectionSlug : undefined,
          icon: destination.icon,
          keywords: action.keywords,
          kind: "action" as const,
        },
      ];
    });
    return [...actions, ...pages];
  }, [granted, groups]);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.label, entry.description, entry.group, ...entry.keywords]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [entries, query]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const keepFocusInside = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const focusable = adminFocusableElements(panel);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const focusInside = panel.contains(document.activeElement);
      if (event.shiftKey && (!focusInside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!focusInside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keepFocusInside, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keepFocusInside, true);
      restoreAdminFocus(
        previousFocusRef.current,
        ".ops-admin-mobile-bar button[aria-label='Open admin command palette'], .ops-command-trigger",
      );
      previousFocusRef.current = null;
    };
  }, []);

  const choose = (entry: AdminCommandEntry | undefined) => {
    if (!entry) return;
    onChoose(entry.section, entry.subsection);
  };
  return (
    <div
      className="admin-command-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-command-title"
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((current) =>
            results.length ? (current + 1) % results.length : 0,
          );
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((current) =>
            results.length
              ? (current - 1 + results.length) % results.length
              : 0,
          );
        } else if (event.key === "Enter") {
          event.preventDefault();
          choose(results[activeIndex]);
        }
      }}
    >
      <button
        className="admin-command-backdrop"
        type="button"
        tabIndex={-1}
        aria-label="Close command palette"
        onClick={onClose}
      />
      <section ref={panelRef} className="admin-command-panel" tabIndex={-1}>
        <header>
          <MagnifyingGlass size={20} aria-hidden="true" />
          <div>
            <h2 id="admin-command-title">Admin command palette</h2>
            <p>Open any page or run a common action.</p>
          </div>
          <kbd>Esc</kbd>
        </header>
        <label className="admin-command-input">
          <span className="sr-only">Search admin pages and actions</span>
          <MagnifyingGlass size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search pages and actions…"
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-command-results"
            aria-activedescendant={results[activeIndex]?.id}
          />
          <kbd>Ctrl K</kbd>
        </label>
        <div
          className="admin-command-results"
          id="admin-command-results"
          role="listbox"
        >
          {results.length ? (
            results.map((entry, index) => {
              const Icon = entry.icon;
              return (
                <button
                  type="button"
                  id={entry.id}
                  role="option"
                  aria-selected={activeIndex === index}
                  key={entry.id}
                  onPointerMove={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => choose(entry)}
                >
                  <span><Icon size={19} aria-hidden="true" /></span>
                  <span>
                    <strong>{entry.label}</strong>
                    <small>{entry.description}</small>
                  </span>
                  <em>{entry.kind === "action" ? "Action" : entry.group}</em>
                </button>
              );
            })
          ) : (
            <div className="admin-command-empty">
              <MagnifyingGlass size={24} aria-hidden="true" />
              <strong>No admin destination found</strong>
              <span>Try a page name, task, or permission keyword.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function OperationsView({
  mode,
  actor,
  initialSectionSlug,
  initialSubsectionSlug,
  initialUploadMode,
  themeController,
  notify,
}: {
  mode: "dashboard" | "admin";
  actor: Actor;
  initialSectionSlug?: string;
  initialSubsectionSlug?: string;
  initialUploadMode?: "SINGLE" | "BATCH";
  themeController: ThemeController;
  notify: (message: string) => void;
}) {
  const admin = mode === "admin";
  const groups = useMemo<OperationsNavigationGroup[]>(() => {
    if (!admin && actor.role === "MODERATOR") {
      return [
        {
          id: "community",
          label: "Community",
          items: [
            workspaceNavigationItem("Comments", ChatCircle),
            workspaceNavigationItem("My teams", UsersThree),
          ],
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
            workspaceNavigationItem("Workspace", SquaresFour),
            workspaceNavigationItem("My teams", UsersThree),
            workspaceNavigationItem("Upload center", CloudArrowUp),
            ...(canUpload
              ? [
                  workspaceNavigationItem("Series", Books),
                  workspaceNavigationItem("Review queue", FileText),
                ]
              : []),
          ],
        },
        {
          id: "community",
          label: "Community & insight",
          items: [
            ...(actor.role === "TEAM_LEADER"
              ? [
                  workspaceNavigationItem("Comments", ChatCircle),
                  workspaceNavigationItem("Analytics", ChartLineUp),
                ]
              : []),
            workspaceNavigationItem("Rights", ShieldCheck),
            workspaceNavigationItem("Settings", GearSix),
          ],
        },
      ];
    }
    return adminNavigationGroupsForCapabilities(actor.capabilities ?? []).map(
      (group) => ({
        id: group.id,
        label: group.label,
        items: group.items.map((item) => ({
            slug: item.slug,
            label: item.label,
            icon: ADMIN_NAVIGATION_ICONS[item.slug] ?? SquaresFour,
            aliases: item.aliases,
            keywords: item.keywords,
            children: item.children,
          })),
      }),
    ).filter((group) => group.items.length > 0);
  }, [actor.canUpload, actor.capabilities, actor.role, admin]);
  const publishingQueueVisible =
    admin && groups.some((group) => group.id === "publishing-queue");
  const [publishingPendingCount, setPublishingPendingCount] = useState<
    number | null
  >(null);
  useEffect(() => {
    if (!publishingQueueVisible) return;
    const controller = new AbortController();
    void fetch(
      "/api/v1/admin/series-requests?status=SUBMITTED&page=1&limit=1",
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          pagination?: { total?: number };
        };
      })
      .then((payload) => {
        const total = payload?.pagination?.total;
        if (typeof total === "number" && Number.isFinite(total)) {
          setPublishingPendingCount(Math.max(0, total));
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [publishingQueueVisible]);
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const defaultSection =
    !admin && actor.role === "MODERATOR"
      ? "Comments"
      : admin
        ? String(items[0]?.label ?? "Dashboard")
        : "Workspace";
  const initialAdminLocation = admin
    ? resolveAdminLocation(
        items,
        initialSectionSlug,
        initialSubsectionSlug,
        defaultSection,
      )
    : null;
  const sectionFromSlug = (() => {
    const normalized = normalizeAdminNavigationKey(initialSectionSlug);
    if (admin) return initialAdminLocation?.section ?? defaultSection;
    return (
      items.find(
        (item) =>
          item.slug === normalized ||
          item.aliases.some(
            (alias) => normalizeAdminNavigationKey(alias) === normalized,
          ),
      )?.label ?? defaultSection
    );
  })();
  const [activeSection, setActiveSection] = useState(String(sectionFromSlug));
  const [activeSubsection, setActiveSubsection] = useState(
    initialAdminLocation?.subsection ?? initialSubsectionSlug ?? "",
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(groups.map((group) => group.id)),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [drawerViewport, setDrawerViewport] = useState(false);
  const effectiveSidebarCollapsed = sidebarCollapsed && !drawerViewport;
  const [adminCommandOpen, setAdminCommandOpen] = useState(false);
  const operationsShellRef = useRef<HTMLElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null);
  const adminCommandOpenRef = useRef(adminCommandOpen);
  const [dirtyState, setDirtyState] = useState({
    dirty: false,
    label: "administrative changes",
  });
  const [pendingNavigation, setPendingNavigation] = useState<{
    section: string;
    subsection?: string;
  } | null>(null);
  const sectionBase = admin ? "/onyx/admin/access" : "/dashboard";
  const adminPreferenceKey = useMemo(
    () =>
      actor.email
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-|-$/gu, "") || "administrator",
    [actor.email],
  );

  useEffect(() => {
    adminCommandOpenRef.current = adminCommandOpen;
  }, [adminCommandOpen]);

  const resolveSectionLabel = useCallback(
    (section: string) => {
      if (admin) {
        const destination = findAdminNavigationDestination(section);
        return (
          items.find((item) => item.slug === destination?.item.slug)?.label ??
          section
        );
      }
      const normalized = normalizeAdminNavigationKey(section);
      return (
        items.find(
          (item) =>
            item.label === section ||
            item.slug === normalized ||
            item.aliases.some(
              (alias) => normalizeAdminNavigationKey(alias) === normalized,
            ),
        )?.label ?? section
      );
    },
    [admin, items],
  );
  const activeNavigationItem = items.find(
    (item) => item.label === activeSection,
  );
  const dispatchedSection = admin
    ? (activeNavigationItem?.slug ?? normalizeAdminNavigationKey(activeSection))
    : activeSection;

  const sectionHref = useCallback(
    (section: string, subsection?: string) => {
      const destination = admin
        ? findAdminNavigationDestination(section)
        : undefined;
      const item = items.find(
        (candidate) =>
          candidate.label === section ||
          candidate.slug ===
            (destination?.item.slug ?? normalizeAdminNavigationKey(section)),
      );
      const slug = item?.slug ?? normalizeAdminNavigationKey(section);
      const canonicalSubsection = canonicalAdminSubsection(item, subsection);
      const base =
        section === defaultSection && !subsection
          ? sectionBase
          : `${sectionBase}/${slug}`;
      return canonicalSubsection ? `${base}/${canonicalSubsection}` : base;
    },
    [admin, defaultSection, items, sectionBase],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const preferencePrefix = `nyascans-${mode}-${adminPreferenceKey}`;
        const stored =
          window.localStorage.getItem(`${preferencePrefix}-nav-groups`) ??
          window.sessionStorage.getItem(`nyascans-${mode}-nav-groups`);
        if (stored) {
          const parsed = JSON.parse(stored) as unknown;
          if (Array.isArray(parsed)) {
            setExpandedGroups(
              new Set(parsed.filter((value) => typeof value === "string")),
            );
          }
        }
        setSidebarCollapsed(
          (window.localStorage.getItem(`${preferencePrefix}-sidebar-collapsed`) ??
            window.localStorage.getItem(
              `nyascans-${mode}-sidebar-collapsed`,
            )) === "true",
        );
      } catch {
        // Session-only navigation preferences are optional.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [adminPreferenceKey, mode]);

  const visibleExpandedGroups = expandedGroups;

  useEffect(() => {
    if (!admin) return;
    const openCommands = () => setAdminCommandOpen(true);
    window.addEventListener("nyascans:admin-command-open", openCommands);
    return () =>
      window.removeEventListener("nyascans:admin-command-open", openCommands);
  }, [admin]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => {
      setDrawerViewport(media.matches);
      if (!media.matches) setMobileNavOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!admin || !drawerViewport || !mobileNavOpen) return;
    const drawer = mobileNavRef.current;
    if (!drawer) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : mobileNavTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      drawer
        .querySelector<HTMLElement>(".ops-sidebar-mobile-close")
        ?.focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (adminCommandOpenRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = adminFocusableElements(drawer);
      if (!focusable.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const focusInside = drawer.contains(document.activeElement);
      if (event.shiftKey && (!focusInside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!focusInside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (!adminCommandOpenRef.current) {
        restoreAdminFocus(previousFocus, ".ops-admin-mobile-bar button");
      }
    };
  }, [admin, drawerViewport, mobileNavOpen]);

  useEffect(() => {
    if (!admin) return;
    const root = operationsShellRef.current;
    if (!root) return;
    let frame = 0;
    const enhanceTables = () => {
      frame = 0;
      for (const table of root.querySelectorAll<HTMLTableElement>(
        ".ops-main table",
      )) {
        table.dataset.mobileCards = "true";
        const headings = Array.from(
          table.querySelectorAll<HTMLTableCellElement>("thead th"),
          (heading) => heading.textContent?.trim() ?? "",
        );
        for (const row of table.querySelectorAll<HTMLTableRowElement>(
          "tbody tr",
        )) {
          const cells = Array.from(
            row.querySelectorAll<HTMLTableCellElement>(
              ":scope > th, :scope > td",
            ),
          );
          cells.forEach((cell, index) => {
            if (!cell.dataset.label && headings[index]) {
              cell.dataset.label = headings[index];
            }
          });
        }
      }
    };
    const scheduleEnhancement = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(enhanceTables);
    };
    scheduleEnhancement();
    const observer = new MutationObserver(scheduleEnhancement);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["scope"],
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [admin]);

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
      const adminLocation = admin
        ? resolveAdminLocation(
            items,
            pathParts[0],
            pathParts[1],
            defaultSection,
          )
        : null;
      const next = adminLocation?.section ??
        items.find(
          (item) =>
            item.slug === pathParts[0] ||
            item.aliases.some(
              (alias) =>
                normalizeAdminNavigationKey(alias) === pathParts[0],
            ),
        )?.label ?? defaultSection;
      const nextSubsection =
        adminLocation?.subsection ?? normalizeAdminNavigationKey(pathParts[1]);
      if (
        dirtyState.dirty &&
        (String(next) !== activeSection ||
          nextSubsection !== activeSubsection)
      ) {
        window.history.pushState(
          {},
          "",
          sectionHref(activeSection, activeSubsection),
        );
        setPendingNavigation({
          section: String(next),
          subsection: nextSubsection,
        });
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
    admin,
    defaultSection,
    dirtyState,
    items,
    sectionBase,
    sectionHref,
  ]);

  function commitSection(section: string, subsection?: string) {
    const resolvedSection = resolveSectionLabel(section);
    const destination = admin
      ? findAdminNavigationDestination(resolvedSection)
      : undefined;
    const item = items.find(
      (candidate) =>
        candidate.label === resolvedSection ||
        candidate.slug === destination?.item.slug,
    );
    const resolvedSubsection = admin
      ? canonicalAdminSubsection(item, subsection)
      : (subsection ?? "");
    setActiveSection(resolvedSection);
    setActiveSubsection(resolvedSubsection);
    setMobileNavOpen(false);
    setAdminCommandOpen(false);
    window.history.pushState(
      {},
      "",
      sectionHref(resolvedSection, resolvedSubsection),
    );
  }

  function openSection(
    section: string,
    subsection?: string,
    confirmedDiscard = false,
  ) {
    const resolvedSection = resolveSectionLabel(section);
    const destination = admin
      ? findAdminNavigationDestination(resolvedSection)
      : undefined;
    const item = items.find(
      (candidate) =>
        candidate.label === resolvedSection ||
        candidate.slug === destination?.item.slug,
    );
    const resolvedSubsection = admin
      ? canonicalAdminSubsection(item, subsection)
      : (subsection ?? "");
    if (
      dirtyState.dirty &&
      !confirmedDiscard &&
      (resolvedSection !== activeSection ||
        resolvedSubsection !== activeSubsection)
    ) {
      setMobileNavOpen(false);
      setAdminCommandOpen(false);
      setPendingNavigation({
        section: resolvedSection,
        subsection: resolvedSubsection,
      });
      return;
    }
    commitSection(resolvedSection, resolvedSubsection);
  }

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try {
        window.localStorage.setItem(
          `nyascans-${mode}-${adminPreferenceKey}-nav-groups`,
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
          `nyascans-${mode}-${adminPreferenceKey}-sidebar-collapsed`,
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
      ref={operationsShellRef}
      className={`ops-shell ${effectiveSidebarCollapsed ? "is-sidebar-collapsed" : ""} ${
        activeNavigationItem?.slug === "upload-center" ||
        (dispatchedSection === "chapters" &&
          LEGACY_UPLOAD_SUBSECTIONS.has(activeSubsection))
          ? "is-upload-center"
          : ""
      }`}
      data-operations-mode={mode}
    >
      {admin ? (
        <header className="ops-admin-mobile-bar">
          <button
            ref={mobileNavTriggerRef}
            type="button"
            aria-label="Open administration navigation"
            aria-expanded={mobileNavOpen}
            aria-controls="operations-navigation-drawer"
            onClick={() => setMobileNavOpen(true)}
          >
            <List size={21} aria-hidden="true" />
          </button>
          <span>
            <strong>{activeSection}</strong>
            <small>Administration</small>
          </span>
          <button
            type="button"
            aria-label="Open admin command palette"
            aria-keyshortcuts="Control+K Meta+K"
            onClick={() => setAdminCommandOpen(true)}
          >
            <MagnifyingGlass size={20} aria-hidden="true" />
          </button>
        </header>
      ) : null}
      {admin && mobileNavOpen ? (
        <button
          className="ops-sidebar-backdrop"
          type="button"
          aria-label="Close administration navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <aside
        ref={mobileNavRef}
        className={`ops-sidebar ${mobileNavOpen ? "is-mobile-open" : ""}`}
        id={admin ? "operations-navigation-drawer" : undefined}
        role={admin && drawerViewport && mobileNavOpen ? "dialog" : undefined}
        aria-modal={admin && drawerViewport && mobileNavOpen ? true : undefined}
        tabIndex={admin && drawerViewport && mobileNavOpen ? -1 : undefined}
        inert={admin && drawerViewport && !mobileNavOpen ? true : undefined}
        aria-hidden={
          admin && drawerViewport && !mobileNavOpen ? true : undefined
        }
        aria-label={admin ? "Administration navigation" : "Workspace navigation"}
      >
        <div className="ops-sidebar-head">
          <Logo />
          <button
            className="ops-sidebar-collapse"
            type="button"
            aria-label={effectiveSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={effectiveSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!effectiveSidebarCollapsed}
            aria-controls="operations-navigation"
            onClick={toggleSidebar}
          >
            <SidebarSimple size={19} />
          </button>
          {admin ? (
            <button
              className="ops-sidebar-mobile-close"
              type="button"
              aria-label="Close administration navigation"
              onClick={() => setMobileNavOpen(false)}
            >
              <X size={20} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <nav
          className="ops-grouped-nav"
          id="operations-navigation"
          aria-label="Operations sections"
        >
          {groups.map((group) => (
            <section className="ops-nav-group" key={group.id}>
              {group.label ? (
                <button
                  className="ops-nav-group-toggle"
                  type="button"
                  id={`ops-nav-${mode}-${group.id}-toggle`}
                  aria-expanded={
                    effectiveSidebarCollapsed || visibleExpandedGroups.has(group.id)
                  }
                  aria-controls={`ops-nav-${mode}-${group.id}-items`}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span>
                    {group.label}
                    {group.id === "publishing-queue" &&
                    publishingPendingCount !== null ? (
                      <small
                        className="ops-nav-group-count"
                        title={`${publishingPendingCount.toLocaleString()} submitted series requests`}
                      >
                        {publishingPendingCount.toLocaleString()}
                      </small>
                    ) : null}
                  </span>
                  <CaretDown size={14} />
                </button>
              ) : null}
              <div
                className="ops-nav-group-items"
                id={`ops-nav-${mode}-${group.id}-items`}
                aria-labelledby={
                                    group.label
                    ? `ops-nav-${mode}-${group.id}-toggle` : undefined
                }
                hidden={
                  group.label
                    ? !effectiveSidebarCollapsed &&
                      !visibleExpandedGroups.has(group.id)
                    : false
                }
              >
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Fragment key={item.slug}>
                      <a
                        className={item.children?.length ? "ops-nav-parent" : undefined}
                        href={sectionHref(item.label)}
                        title={effectiveSidebarCollapsed ? item.label : undefined}
                        aria-current={activeSection === item.label && !activeSubsection ? "page" : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          openSection(item.label);
                        }}
                      >
                        <Icon size={20} />
                        <span className="ops-nav-label">{item.label}</span>
                      </a>
                      {item.children?.map((child) => (
                        <a
                          className="ops-nav-child"
                          href={sectionHref(item.label, child.slug)}
                          key={`${item.slug}-${child.slug}`}
                          title={effectiveSidebarCollapsed ? `${item.label}: ${child.label}` : undefined}
                          aria-current={activeSection === item.label && activeSubsection === child.slug ? "page" : undefined}
                          onClick={(event) => {
                            event.preventDefault();
                            openSection(item.label, child.slug);
                          }}
                        >
                          <span className="ops-nav-child-marker" aria-hidden="true" />
                          <span className="ops-nav-label">{child.label}</span>
                        </a>
                      ))}
                    </Fragment>
                  );
                })}
              </div>
              {!effectiveSidebarCollapsed &&
              !visibleExpandedGroups.has(group.id) &&
              group.items.some((item) => item.label === activeSection) ? (
                <a
                  className="ops-active-pinned"
                  href={sectionHref(activeSection)}
                  aria-current="page"
                  onClick={(event) => event.preventDefault()}
                >
                  {(() => {
                    const ActiveIcon =
                      group.items.find((item) => item.label === activeSection)?.icon ??
                      SquaresFour;
                    return <ActiveIcon size={20} />;
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
            {admin ? (
              <>
                <a href="/account">
                  <UserCircle size={17} />
                  <span>Profile</span>
                </a>
                <a href="/account?tab=preferences">
                  <GearSix size={17} />
                  <span>Preferences</span>
                </a>
              </>
            ) : null}
            <a href="/">
              <House size={17} />
              <span>Reader site</span>
            </a>
            <LogoutAction authMethod={actor.authMethod}>
              <SignOut size={17} />
              <span>Logout</span>
            </LogoutAction>
          </div>
        </details>
      </aside>
      <section className="ops-main">
        {!admin ? <label className="ops-mobile-section">
          <span>Open section</span>
          <UnifiedSingleSelect
            value={activeSection}
            onChange={(event) => openSection(event.target.value)}
          >
            {groups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.items.map((item) => (
                  <option key={item.slug} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </UnifiedSingleSelect>
        </label> : null}
        {admin && activeNavigationItem?.slug === "roulette" ? (
          <RewardSettingsPanel />
        ) : admin && activeNavigationItem?.slug === "branding-appearance" ? (
          <AppearanceWorkspace
            workspace="branding-appearance"
            initialTab={
              [
                "branding",
                "homepage",
                "pinned",
                "reader",
                "theme",
                "palettes",
                "theme-management",
                "theme-catalog",
                "discounts",
                "reviews",
                "preview",
              ].includes(activeSubsection)
                ? (activeSubsection as
                    | "branding"
                    | "homepage"
                    | "pinned"
                    | "reader"
                    | "theme"
                    | "palettes"
                    | "theme-management"
                    | "theme-catalog"
                    | "discounts"
                    | "reviews"
                    | "preview")
                : "branding"
            }
            onTabChange={(tab) => openSection("branding-appearance", tab)}
            themeController={themeController}
            notify={notify}
          />
        ) : admin && activeNavigationItem?.slug === "footer-legal" ? (
          <AppearanceWorkspace
            workspace="footer-legal"
            initialTab={activeSubsection === "legal" ? "legal" : "footer"}
            onTabChange={(tab) => openSection("footer-legal", tab)}
          />
        ) : admin && activeNavigationItem?.slug === "keyboard-shortcuts" ? (
          <AppearanceWorkspace
            workspace="keyboard-shortcuts"
            initialTab="shortcuts"
          />
        ) : admin && activeNavigationItem?.slug === "identifiers" ? (
          <IdentifiersPanel />
        ) : admin && activeNavigationItem?.slug === "bot-activity" ? (
          <BotActivityPanel />
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
              section={dispatchedSection}
              subsection={activeSubsection}
              actorRole={actor.role}
              actorRoles={actor.roles ?? [actor.role]}
              capabilities={actor.capabilities ?? []}
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
      {admin && adminCommandOpen ? (
        <AdminCommandPalette
          groups={groups}
          capabilities={actor.capabilities ?? []}
          onClose={() => setAdminCommandOpen(false)}
          onChoose={openSection}
        />
      ) : null}
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
            <LogoutAction
              className="button button-secondary"
              authMethod={actor.authMethod}
            >
              <SignOut size={18} />
              Logout and use another account
            </LogoutAction>
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
            ? actor?.authMethod === "PASSWORD"
              ? "An active administrator role and server-side policy checks are required. This email session has already passed verification."
              : "An active administrator role, server-side capability checks, and a registered passkey are required for the admin console."
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
  const { settings: siteConfiguration } = useSiteConfiguration();
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
  const legalDocuments = siteConfiguration.legalDocuments.length
    ? siteConfiguration.legalDocuments
    : LEGAL_DOCUMENTS;
  const legalDocument =
    legalDocuments.find((document) => document.slug === (resourceSlug ?? "terms")) ??
    legalDocuments.find((document) => document.slug === "terms") ??
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
      {view !== "rankings" ? (
        <section className="generic-hero">
          <h1>{title}</h1>
          <p>{intro}</p>
        </section>
      ) : null}
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
            {legalDocuments.map((document) => (
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
  links: Array<{ label: string; url: string; openInNewTab: boolean }>;
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
        {links.map((link) =>
          link.url === "#keyboard-shortcuts" ? (
            <button
              className="footer-inline-action"
              type="button"
              key={link.label}
              onClick={onOpenShortcuts}
            >
              {link.label}
            </button>
          ) : (
            <a
              href={link.url}
              key={link.label}
              target={link.openInNewTab ? "_blank" : undefined}
              rel={link.openInNewTab ? "noreferrer noopener" : undefined}
            >
              {link.label}
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
  const groups = settings.footer.groups
    .filter((group) => group.enabled)
    .map((group) => ({
      title: group.title,
      links: group.links
        .filter((link) => link.enabled && link.url)
        .map((link) => ({ label: link.label, url: link.url, openInNewTab: link.openInNewTab })),
    }));
  return (
    <footer className="site-footer">
      <div className="page-wrap footer-main">
        <div className="footer-brand">
          <Logo />
          <p>
            {settings.footer.description || settings.brand.shortDescription ||
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
        <span>{settings.footer.copyright}</span>
        {settings.footer.legalNotice ? <small>{settings.footer.legalNotice}</small> : null}
        <span className="footer-release-version">Version {APP_VERSION}</span>
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
  authReturnTo = "/",
  resourceSlug,
  chapterSlug,
  uploadMode,
  signInPath,
  adminGate,
  operationPath,
}: AppProps) {
  useAnchoredMenuDismissal();
  const themeController = useUserThemeController(
    actor ? actor.email.toLowerCase() : null,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutPrefixRef = useRef<{ prefix: string; at: number } | null>(null);
  const { settings: siteConfiguration } = useSiteConfiguration();
  const enabledShortcuts = useMemo(
    () => siteConfiguration.keyboardShortcuts.filter((shortcut) => shortcut.enabled),
    [siteConfiguration.keyboardShortcuts],
  );
  const { runtimeFeatures } = useCommercialSettings();
  const lockAndPayVisible = runtimeFeatures.paidSystem;
  const { notifyText } = useSystemNotifications();
  const showToast = useCallback(
    (message: string) => {
      notifyText(message);
    },
    [notifyText],
  );

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
        shortcutPrefixRef.current = null;
        return;
      }
      if (
        document.querySelector(
          '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
        )
      ) {
        return;
      }
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (!key) return;
      if (
        view === "admin" &&
        key === "k" &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        setSearchOpen(false);
        setShortcutsOpen(false);
        window.dispatchEvent(new Event("nyascans:admin-command-open"));
        return;
      }
      const run = (shortcut: (typeof enabledShortcuts)[number]) => {
        event.preventDefault();
        shortcutPrefixRef.current = null;
        if (shortcut.id === "search") {
          setShortcutsOpen(false);
          setSearchOpen(true);
        } else if (shortcut.id === "guide") {
          setSearchOpen(false);
          setShortcutsOpen(true);
        } else if (shortcut.href) {
          window.location.assign(shortcut.href);
        }
      };
      const modifierShortcut = enabledShortcuts.find((shortcut) => {
        const prefix = typeof shortcut.prefix === "string" ? shortcut.prefix.toLowerCase() : "";
        const shortcutKey = typeof shortcut.key === "string" ? shortcut.key.toLowerCase() : "";
        const usesModifier = /ctrl|control|cmd|meta|⌘|alt|shift/u.test(prefix);
        if (!usesModifier || shortcutKey !== key) return false;
        const primaryMatches = !/ctrl|control|cmd|meta|⌘/u.test(prefix) || event.ctrlKey || event.metaKey;
        const altMatches = !prefix.includes("alt") || event.altKey;
        const shiftMatches = !prefix.includes("shift") || event.shiftKey;
        return primaryMatches && altMatches && shiftMatches;
      });
      if (modifierShortcut) {
        run(modifierShortcut);
        return;
      }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      const directShortcut = enabledShortcuts.find((shortcut) => {
        const prefix = typeof shortcut.prefix === "string" ? shortcut.prefix.trim() : "";
        const shortcutKey = typeof shortcut.key === "string" ? shortcut.key.toLowerCase() : "";
        return !prefix && shortcutKey === key;
      });
      if (directShortcut) {
        run(directShortcut);
        return;
      }
      const pending = shortcutPrefixRef.current;
      if (pending && Date.now() - pending.at <= 1_500) {
        const destination = enabledShortcuts.find((shortcut) => {
          const prefix = typeof shortcut.prefix === "string" ? shortcut.prefix.trim().toLowerCase() : "";
          const shortcutKey = typeof shortcut.key === "string" ? shortcut.key.toLowerCase() : "";
          return prefix === pending.prefix && shortcutKey === key;
        });
        shortcutPrefixRef.current = null;
        if (destination) {
          run(destination);
          return;
        }
      }
      const beginsChord = enabledShortcuts.some((shortcut) => {
        const prefix = typeof shortcut.prefix === "string" ? shortcut.prefix.trim().toLowerCase() : "";
        return prefix && !/ctrl|control|cmd|meta|⌘|alt|shift/u.test(prefix) && prefix === key;
      });
      if (beginsChord) {
        shortcutPrefixRef.current = { prefix: key, at: Date.now() };
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabledShortcuts, view]);

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
          themeController={themeController}
          onSearch={() => setSearchOpen(true)}
          lockAndPayVisible={lockAndPayVisible}
        />
                      <OperationsView
          mode="dashboard"
          actor={actor}
          initialSectionSlug={operationPath?.[0] ?? resourceSlug}
          initialSubsectionSlug={operationPath?.[1]}
          initialUploadMode={uploadMode}
          themeController={themeController}
          notify={showToast}
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
          themeController={themeController}
          notify={showToast}
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
    view === "theme-builder" ? (
      <ThemeBuilderPage controller={themeController} notify={showToast} />
    ) : view === "home" ? (
      <HomeView actor={actor} showToast={showToast} />
    ) : view === "pinned" ? (
      <PinnedSeriesDirectory />
    ) : view === "discounts" ? (
      <DiscountsDirectory />
    ) : view === "latest" ? (
      <LatestUpdatesView />
    ) : view === "browse" ? (
      <BrowseView actor={actor} showToast={showToast} />
    ) : view === "library" ? (
      <LibraryView actor={actor} />
    ) : ["store", "wallet", "orders", "discounts"].includes(view) && !lockAndPayVisible ? (
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
        lockAndPayVisible ? "public" : "hidden"
      }
      data-paid-system={lockAndPayVisible ? "on" : "off"}
    >
      <SiteHeader
        key={actor?.email ?? "guest"}
        view={view}
        actor={actor}
        themeController={themeController}
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
