"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowClockwise,
  ArrowRight,
  ArrowUp,
  Books,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Check,
  CheckCircle,
  CloudArrowUp,
  Coins,
  Copy,
  Database,
  FileImage,
  FileText,
  HardDrives,
  LockKey,
  MagnifyingGlass,
  Plus,
  Pulse,
  ShieldCheck,
  ShieldWarning,
  Sparkle,
  UserGear,
  UsersThree,
  Wallet,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorialManagementPanel } from "@/components/nyascans/EditorialManagementPanel";
import { DiscussionSettingsPanel } from "@/components/nyascans/DiscussionSettingsPanel";
import { AuditLogPanel as OwnerAuditLogPanel } from "@/components/nyascans/admin/AuditLogPanel";
import {
  AdminCombobox,
  AdminPageScaffold,
  AdminSectionCard,
  AdminStatusBadge,
  ConfirmActionDialog,
  PromptActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";
import { ReactionLibraryPanel } from "@/components/nyascans/admin/ReactionLibraryPanel";
import { NewSeriesQueuePanel } from "@/components/nyascans/admin/NewSeriesQueuePanel";
import { SeriesManagementPanel } from "@/components/nyascans/admin/SeriesManagementPanel";
import { SeriesReportsPanel } from "@/components/nyascans/admin/SeriesReportsPanel";
import { SupportTicketsAdminPanel } from "@/components/nyascans/admin/SupportTicketsAdminPanel";
import {
  StoreManagementWorkspace,
  type StoreAdminCategory,
} from "@/components/nyascans/admin/StoreManagementWorkspace";
import { TeamManagementPanel } from "@/components/nyascans/admin/TeamManagementPanel";
import { TeamRequestsPanel } from "@/components/nyascans/admin/TeamRequestsPanel";
import { TaxonomyManager } from "@/components/nyascans/admin/TaxonomyManager";
import { SliderManagementPanel } from "@/components/nyascans/admin/SliderManagementPanel";
import { PinnedSeriesPanel } from "@/components/nyascans/admin/PinnedSeriesPanel";
import { DiscountsPanel } from "@/components/nyascans/admin/DiscountsPanel";
import { HomePromotionsPanel } from "@/components/nyascans/admin/HomePromotionsPanel";
import { RolePermissionsPanel } from "@/components/nyascans/admin/RolePermissionsPanel";
import { SiteCoveragePanel } from "@/components/nyascans/admin/SiteCoveragePanel";
import { ApiControlPanel } from "@/components/nyascans/admin/ApiControlPanel";
import { ChapterAccessDecisionPanel } from "@/components/nyascans/admin/ChapterAccessDecisionPanel";
import { ContentVisibilityPanel } from "@/components/nyascans/admin/ContentVisibilityPanel";
import { UploadCenterWorkspace } from "@/components/nyascans/upload/UploadCenterWorkspace";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";
import { TeamCommunityPanel } from "@/components/nyascans/TeamCommunityPanel";
import { coinLabel } from "@/lib/commercial-settings";
import { ADMIN_PERMISSION_REGISTRY } from "@/lib/admin-permissions";
import {
  findAdminNavigationDestination,
  normalizeAdminNavigationKey,
} from "@/lib/admin-navigation";

type AdminSummary = {
  metrics: {
    users: number;
    series: number;
    teams: number;
    publishedChapters: number;
    processingUploads: number;
    openReports: number;
    reviewQueue: number;
    activeReaders7d: number;
    storageBytes: number;
    visibleComments: number;
  };
  activity: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    createdAt: string;
    actorName: string | null;
  }>;
  generatedAt: string;
};

type AnalyticsData = {
  range: "24h" | "7d" | "30d" | "custom";
  startAt: string;
  endAt: string;
  generatedAt: string;
  refreshAfterSeconds: number;
  selectedRegion: string;
  summary: {
    activeSessions5m: number;
    uniqueSessions: number;
    uniqueVisitors: number;
    views: number;
    chapterStarts: number;
    chapterCompletions: number;
    completionRatePct: number;
    comments: number;
    unlocks: number;
    onyxSpent: number;
    paidOrders: number;
    testCheckoutValueMinor: number;
    newUsers: number;
    reactions: number;
    newSeries: number;
    newTeams: number;
    newChapters: number;
    uploadSessions: number;
    storePurchases: number;
    registeredUsers: number;
    newVisitors: number;
    shardsCollected: number;
    shardsSpent: number;
    shardsOutstanding: number;
  };
  previousSummary: {
    views: number;
    newUsers: number;
    newChapters: number;
    newTeams: number;
    comments: number;
    reactions: number;
  };
  timeline: Array<{
    bucket: string;
    readers: number;
    views: number;
    chapterStarts: number;
    chapterCompletions: number;
    comments: number;
    unlocks: number;
    onyxSpent: number;
  }>;
  topSeries: Array<{
    slug: string;
    title: string;
    seriesViews: number;
    chapterStarts: number;
    chapterCompletions: number;
  }>;
  liveEvents: Array<{
    eventType: string;
    seriesSlug: string | null;
    chapterSlug: string | null;
    createdAt: string;
  }>;
  topChapters: Array<{
    seriesSlug: string;
    seriesTitle: string;
    chapterSlug: string;
    chapterNumber: string;
    views: number;
    uniqueViewers: number;
  }>;
  regions: Array<{
    regionCode: string;
    views: number;
    uniqueViewers: number;
  }>;
  purchasesByCurrency: Array<{
    currency: string;
    provider: string;
    orders: number;
    totalMinor: number;
    isTest: boolean;
  }>;
  purchaseRankedSeries: Array<{
    id: string;
    slug: string;
    title: string;
    purchases: number;
    pawCoinsSpent: number;
  }>;
  topUsers: Array<{
    id: string;
    displayName: string;
    email: string;
    comments: number;
    spins: number;
    purchases: number;
  }>;
  regionScope: {
    region: string;
    metrics: string[];
  } | null;
};

type HealthData = {
  status: string;
  service: string;
  checks: {
    database: string;
    objectStorage: string;
  };
};

type AdminSeries = {
  id: string;
  slug: string;
  title: string;
  nativeTitle: string | null;
  type: string;
  status: string;
  accessType: string;
  originCountry: string;
  originalLanguage: string;
  readingDirection: string;
  coverKey: string | null;
  coverUrl: string | null;
  isPublished: number;
  chapterCount: number;
  revision: number;
  updatedAt: string;
};

type AdminChapter = {
  id: string;
  slug: string;
  chapterNumber: string;
  title: string;
  volume: string | null;
  language: string;
  format: "VERTICAL" | "PAGED";
  version: number;
  releaseNotes: string;
  state: "DRAFT" | "READY_FOR_REVIEW" | "PUBLISHED";
  accessType: "FREE" | "PAID";
  effectiveAccessType: "FREE" | "PAID";
  priceOnyx: number;
  publishedAt: string | null;
  pageCount: number;
  revision: number;
  updatedAt: string;
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  teamName: string | null;
  entitlementCount: number;
};

type AdminChapterPage = {
  id: string;
  pageIndex: number;
  width: number;
  height: number;
  processingStatus: string;
};

type AdminChapterComment = {
  id: string;
  body: string;
  pinnedAt: string | null;
  createdAt: string;
  authorName: string;
  openReports: number;
};

type AdminTeam = {
  id: string;
  slug: string;
  name: string;
  description: string;
  verificationStatus: "PENDING" | "VERIFIED" | "SUSPENDED";
  memberCount: number;
  revision: number;
  updatedAt: string;
};

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  primaryRole:
    | "OWNER"
    | "ADMINISTRATOR"
    | "MANAGER"
    | "MODERATOR"
    | "TEAM_LEADER"
    | "UPLOADER"
    | "USER";
  roles: AdminUser["primaryRole"][];
  accessRevision: number;
  status: "ACTIVE" | "SUSPENDED";
  teamCount: number;
  teamNames: string[];
  avatarUrl: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  effectivePermissions: string[];
  recentActivity: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    result: string;
    createdAt: string;
    seriesTitle: string | null;
    chapterNumber: string | null;
  }>;
};

type AuditRecord = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  requestId: string;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
};

type ApiFailure = {
  error?: { message?: string };
};

type PanelProps = {
  admin: boolean;
  section: string;
  subsection?: string;
  actorRole: string;
  actorRoles: string[];
  capabilities: readonly string[];
  canUpload: boolean;
  canRequestSeries: boolean;
  canManageTeam: boolean;
  onNavigate: (
    section: string,
    subsection?: string,
    confirmedDiscard?: boolean,
  ) => void;
  initialUploadMode?: "SINGLE" | "BATCH";
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toLocalDateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function humanize(value: string) {
  return value
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function readJson<T>(response: Response) {
  const payload = (await response.json()) as T & ApiFailure;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The request could not be completed.");
  }
  return payload;
}

function PanelHeader({
  icon,
  breadcrumbs,
  kicker,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  breadcrumbs?: readonly string[];
  kicker: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="control-panel-header">
      <div>
        <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
          {(breadcrumbs ?? ["Administration", kicker]).map((crumb, index) => (
            <span key={`${crumb}-${index}`}>
              {index ? <i aria-hidden="true">/</i> : null}
              {crumb}
            </span>
          ))}
        </nav>
        <span className="ops-kicker">
          {icon}
          {kicker}
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="control-panel-actions">{actions}</div> : null}
    </header>
  );
}

function PanelMessage({
  kind = "neutral",
  children,
}: {
  kind?: "neutral" | "success" | "error";
  children: string;
}) {
  return (
    <SystemNoticeBridge
      message={children}
      kind={kind === "neutral" ? "info" : kind}
    />
  );
}

function LoadingPanel() {
  return (
    <div className="control-loading" role="status" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

function EmptyPanel({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="control-empty">
      <FileText size={28} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

export function AdminOverview({
  onNavigate,
  actorRole,
}: {
  onNavigate: (section: string, subsection?: string) => void;
  actorRole: string;
}) {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/v1/admin/summary", { signal: controller.signal }).then(
        (response) => readJson<AdminSummary>(response),
      ),
      fetch("/api/v1/health", { signal: controller.signal }).then((response) =>
        readJson<HealthData>(response),
      ),
    ])
      .then(([nextSummary, nextHealth]) => {
        setSummary(nextSummary);
        setHealth(nextHealth);
        setError("");
      })
      .catch((loadError: unknown) => {
        if ((loadError as Error).name !== "AbortError") {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The control panel could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [refresh]);

  const metrics = summary?.metrics;
  const cards = metrics
    ? [
        {
          label: "Registered users",
          value: metrics.users,
          detail: "Accounts in D1",
          icon: <UsersThree size={21} />,
        },
        {
          label: "Series",
          value: metrics.series,
          detail: "Draft and published",
          icon: <Books size={21} />,
        },
        {
          label: "Review queue",
          value: metrics.reviewQueue,
          detail: `${metrics.processingUploads} imports processing`,
          icon: <CheckCircle size={21} />,
        },
        {
          label: "Open reports",
          value: metrics.openReports,
          detail: `${metrics.visibleComments} visible comments`,
          icon: <ShieldWarning size={21} />,
        },
      ]
    : [];

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<Pulse size={18} />}
        breadcrumbs={["Dashboard", "Home"]}
        kicker="Live control room"
        title="Home"
        description="Real platform counts, publishing workload, service checks, and recent administrator actions."
        actions={
          <button
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <ArrowClockwise size={17} /> Refresh
          </button>
        }
      />
      {error ? <PanelMessage kind="error">{error}</PanelMessage> : null}
      {!summary ? (
        <LoadingPanel />
      ) : (
        <>
          <div className="control-metrics">
            {cards.map((card) => (
              <article key={card.label}>
                {card.icon}
                <span>{card.label}</span>
                <strong>{card.value.toLocaleString("en-US")}</strong>
                <small>{card.detail}</small>
              </article>
            ))}
          </div>
          <div className="control-overview-grid">
            <section className="control-quick-actions">
              <div>
                <span>Quick actions</span>
                <h3>Run the site without hunting through menus</h3>
              </div>
              {[
                ["Upload chapters", "Upload center", CloudArrowUp],
                ["Edit existing series", "Series", Books],
                ["Control teams", "Teams", UsersThree],
                ["Set colors & gradients", "Appearance", Pulse],
              ].map(([label, section, Icon]) => (
                <button
                  type="button"
                  key={String(section)}
                  onClick={() => onNavigate(String(section))}
                >
                  <Icon size={20} />
                  <span>{String(label)}</span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </section>
            <section className="control-health-card">
              <div>
                <span>Service checks</span>
                <strong>
                  {health?.status === "ok" ? "All connected" : "Needs attention"}
                </strong>
              </div>
              {[
                ["Database", health?.checks.database ?? "checking"],
                ["Private media", health?.checks.objectStorage ?? "checking"],
                ["Recorded storage", formatBytes(metrics?.storageBytes ?? 0)],
                [
                  "Readers active · 7 days",
                  (metrics?.activeReaders7d ?? 0).toLocaleString("en-US"),
                ],
              ].map(([label, status]) => (
                <div key={label}>
                  <span>{label}</span>
                  <em
                    className={
                      ["ok", "checking"].includes(status) ? "is-ok" : ""
                    }
                  >
                    {status}
                  </em>
                </div>
              ))}
            </section>
          </div>
          <section className="control-activity">
            <div className="control-section-heading">
              <div>
                <span>Audit trail</span>
                <h3>Recent administrator actions</h3>
              </div>
              {actorRole === "OWNER" ? (
                <button type="button" onClick={() => onNavigate("Audit log")}>
                  Open audit log <ArrowRight size={16} />
                </button>
              ) : (
                <span className="control-status status-ready">
                  Owner-only detail
                </span>
              )}
            </div>
            {summary.activity.length ? (
              summary.activity.map((entry) => (
                <article key={entry.id}>
                  <span>
                    <Check size={15} />
                  </span>
                  <div>
                    <strong>{humanize(entry.action)}</strong>
                    <small>
                      {entry.actorName ?? "System"} · {entry.targetType} ·{" "}
                      {formatDate(entry.createdAt)}
                    </small>
                  </div>
                </article>
              ))
            ) : (
              <EmptyPanel
                title="No administrator actions yet"
                body="Series, team, access, upload, and settings changes will appear here."
              />
            )}
          </section>
        </>
      )}
    </section>
  );
}

function UploadCenter({
  admin,
  initialMode,
  initialSection,
  canUpload,
  canRequestSeries,
  canManageTeam,
}: {
  admin: boolean;
  initialMode?: "SINGLE" | "BATCH";
  initialSection?: string;
  canUpload: boolean;
  canRequestSeries: boolean;
  canManageTeam: boolean;
}) {
  return (
    <UploadCenterWorkspace
      admin={admin}
      initialMode={initialMode}
      initialSection={initialSection}
      canUpload={canUpload}
      canRequestSeries={canRequestSeries}
      canManageTeam={canManageTeam}
    />
  );
}
export function TeamsManager() {
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [series, setSeries] = useState<AdminSeries[]>([]);
  const [memberships, setMemberships] = useState<
    Array<{
      teamId: string;
      userId: string;
      membershipRole: string;
      status: string;
      teamName: string;
      displayName: string;
      email: string;
      revision: number;
      isPrimary: number | boolean;
    }>
  >([]);
  const [assignments, setAssignments] = useState<
    Array<{
      seriesId: string;
      teamId: string;
      seriesTitle: string;
      teamName: string;
      canUpload: boolean;
      canPublish: boolean;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [membershipPage, setMembershipPage] = useState(1);
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [membershipTotal, setMembershipTotal] = useState(0);
  const [assignmentTotal, setAssignmentTotal] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"success" | "error">("success");
  const [form, setForm] = useState({ name: "", slug: "", description: "" });
  const [membershipForm, setMembershipForm] = useState({
    teamId: "",
    userId: "",
    membershipRole: "UPLOADER",
    status: "ACTIVE",
  });
  const [assignmentForm, setAssignmentForm] = useState({
    teamId: "",
    seriesId: "",
    canUpload: true,
    canPublish: false,
  });
  const [membershipTouched, setMembershipTouched] = useState(false);
  const [assignmentTouched, setAssignmentTouched] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const accessDirty =
    Boolean(form.name || form.slug || form.description) ||
    membershipTouched ||
    assignmentTouched;
  useUnsavedChanges(accessDirty, "team membership or assignment changes");

  async function load(
    requestedMembershipPage = membershipPage,
    requestedAssignmentPage = assignmentPage,
  ) {
    setLoading(true);
    try {
      const [teamPayload, userPayload, seriesPayload, accessPayload] =
        await Promise.all([
          fetch("/api/v1/admin/teams").then((response) =>
            readJson<{ data: AdminTeam[] }>(response),
          ),
          fetch("/api/v1/admin/users").then((response) =>
            readJson<{ data: AdminUser[] }>(response),
          ),
          fetch("/api/v1/admin/series").then((response) =>
            readJson<{ data: AdminSeries[] }>(response),
          ),
          fetch(
            `/api/v1/admin/team-access?membershipPage=${requestedMembershipPage}&assignmentPage=${requestedAssignmentPage}&limit=12`,
          ).then((response) =>
            readJson<{
              memberships: typeof memberships;
              assignments: typeof assignments;
              pagination: {
                memberships: { page: number; total: number };
                assignments: { page: number; total: number };
              };
            }>(response),
          ),
        ]);
      setTeams(teamPayload.data ?? []);
      setUsers(userPayload.data ?? []);
      setSeries(seriesPayload.data ?? []);
      setMemberships(accessPayload.memberships ?? []);
      setAssignments(accessPayload.assignments ?? []);
      setMembershipPage(accessPayload.pagination.memberships.page);
      setAssignmentPage(accessPayload.pagination.assignments.page);
      setMembershipTotal(accessPayload.pagination.memberships.total);
      setAssignmentTotal(accessPayload.pagination.assignments.total);
      setMembershipForm((current) => ({
        ...current,
        teamId: current.teamId || teamPayload.data?.[0]?.id || "",
        userId: current.userId || userPayload.data?.[0]?.id || "",
      }));
      setAssignmentForm((current) => ({
        ...current,
        teamId: current.teamId || teamPayload.data?.[0]?.id || "",
        seriesId: current.seriesId || seriesPayload.data?.[0]?.id || "",
      }));
      setMembershipTouched(false);
      setAssignmentTouched(false);
      setHasLoaded(true);
      setMessage("");
    } catch (loadError) {
      setMessage(
        loadError instanceof Error
          ? loadError.message
          : "Teams could not be loaded.",
      );
      setKind("error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(1, 1), 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setMessage("");
    try {
      const created = await fetch("/api/v1/admin/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      }).then((response) => readJson<AdminTeam>(response));
      setMessage(`${created.name} was created with pending verification.`);
      setKind("success");
      setForm({ name: "", slug: "", description: "" });
      setSlugTouched(false);
      await load();
    } catch (createError) {
      setMessage(
        createError instanceof Error
          ? createError.message
          : "The team could not be created.",
      );
      setKind("error");
    } finally {
      setBusy("");
    }
  }

  async function setStatus(
    team: AdminTeam,
    verificationStatus: AdminTeam["verificationStatus"],
  ) {
    setBusy(team.id);
    setMessage("");
    try {
      await fetch("/api/v1/admin/teams", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: team.id,
          verificationStatus,
          expectedRevision: team.revision,
        }),
      }).then((response) =>
        readJson<{ id: string; verificationStatus: string }>(response),
      );
      setMessage(`${team.name} is now ${humanize(verificationStatus).toLowerCase()}.`);
      setKind("success");
      await load();
    } catch (updateError) {
      setMessage(
        updateError instanceof Error
          ? updateError.message
          : "The team status could not be changed.",
      );
      setKind("error");
    } finally {
      setBusy("");
    }
  }

  async function saveMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("membership");
    setMessage("");
    try {
      const existing = memberships.find(
        (membership) =>
          membership.teamId === membershipForm.teamId &&
          membership.userId === membershipForm.userId,
      );
      await fetch("/api/v1/admin/team-memberships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...membershipForm,
          expectedRevision: existing?.revision ?? null,
        }),
      }).then((response) => readJson(response));
      setMessage("Team membership saved.");
      setKind("success");
      await load();
    } catch (saveError) {
      setMessage(
        saveError instanceof Error
          ? saveError.message
          : "The membership was not saved.",
      );
      setKind("error");
    } finally {
      setBusy("");
    }
  }

  async function saveAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("assignment");
    setMessage("");
    try {
      const selectedSeries = series.find(
        (item) => item.id === assignmentForm.seriesId,
      );
      if (!selectedSeries) {
        throw new Error("Choose a current series before saving permissions.");
      }
      await fetch("/api/v1/admin/series-team-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...assignmentForm,
          expectedSeriesRevision: selectedSeries.revision,
        }),
      }).then((response) => readJson(response));
      setMessage("Series publishing permissions saved.");
      setKind("success");
      await load();
    } catch (saveError) {
      setMessage(
        saveError instanceof Error
          ? saveError.message
          : "The assignment was not saved.",
      );
      setKind("error");
    } finally {
      setBusy("");
    }
  }

  if (!hasLoaded) {
    return (
      <section className="control-panel">
        <PanelHeader
          icon={<UsersThree size={18} />}
          kicker="People & permissions"
          title="Team access"
          description="Load current memberships and series assignments before changing permissions."
        />
        {loading ? (
          <LoadingPanel />
        ) : (
          <div className="admin-state-card" role="alert">
            <h3>Team access could not be loaded</h3>
            <p>{message || "The team access service is temporarily unavailable."}</p>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void load()}
            >
              Retry
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<UsersThree size={18} />}
        kicker="People & permissions"
        title="Teams"
        description="Create publishing teams and control verification. Suspended teams remain in the audit history but cannot be treated as verified."
      />
      <div className="team-manager-grid">
        <form className="team-create-form" onSubmit={create}>
          <div className="control-section-heading">
            <div>
              <span>New workspace</span>
              <h3>Create a team</h3>
            </div>
          </div>
          <label>
            <span>Team name</span>
            <input
              value={form.name}
              onChange={(event) => {
                const name = event.target.value;
                setForm((current) => ({
                  ...current,
                  name,
                  slug: slugTouched
                    ? current.slug
                    : name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, ""),
                }));
              }}
              required
            />
          </label>
          <label>
            <span>URL slug</span>
            <input
              value={form.slug}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              onChange={(event) => {
                setSlugTouched(true);
                setForm((current) => ({
                  ...current,
                  slug: event.target.value.toLowerCase(),
                }));
              }}
              required
            />
          </label>
          <label>
            <span>Team description</span>
            <textarea
              value={form.description}
              minLength={12}
              maxLength={1200}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              required
            />
          </label>
          <button className="button button-primary" type="submit" disabled={busy === "create"}>
            <Plus size={17} />
            {busy === "create" ? "Creating…" : "Create pending team"}
          </button>
        </form>
        <section className="team-records">
          <div className="control-section-heading">
            <div>
              <span>{teams.length} managed team{teams.length === 1 ? "" : "s"}</span>
              <h3>Verification control</h3>
            </div>
            <button
              type="button"
              disabled={accessDirty}
              title={
                accessDirty
                  ? "Save or clear the current team access changes before refreshing."
                  : undefined
              }
              onClick={() => void load()}
            >
              <ArrowClockwise size={16} /> Refresh
            </button>
          </div>
          {loading ? (
            <LoadingPanel />
          ) : teams.length ? (
            <div className="team-admin-list">
              {teams.map((team) => (
                <article key={team.id}>
                  <span className="team-admin-mark">
                    {team.name
                      .split(/\s+/)
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
                  </span>
                  <div>
                    <strong>{team.name}</strong>
                    <small>
                      {Number(team.memberCount)} active member
                      {Number(team.memberCount) === 1 ? "" : "s"} · /team/{team.slug}
                    </small>
                    <p>{team.description}</p>
                  </div>
                  <label>
                    <span className={`control-status status-${team.verificationStatus.toLowerCase()}`}>
                      {humanize(team.verificationStatus)}
                    </span>
                    <select
                      aria-label={`Change ${team.name} verification`}
                      value={team.verificationStatus}
                      disabled={busy === team.id}
                      onChange={(event) =>
                        void setStatus(
                          team,
                          event.target.value as AdminTeam["verificationStatus"],
                        )
                      }
                    >
                      <option value="PENDING">Pending</option>
                      <option value="VERIFIED">Verified</option>
                      <option value="SUSPENDED">Suspended</option>
                    </select>
                  </label>
                </article>
              ))}
            </div>
          ) : (
            <EmptyPanel
              title="No teams in the database"
              body="Create a team workspace with the form."
            />
          )}
        </section>
      </div>
      <div className="team-access-grid">
        <form className="team-create-form" onSubmit={saveMembership}>
          <div className="control-section-heading">
            <div>
              <span>Scoped role</span>
              <h3>Team membership</h3>
            </div>
          </div>
          <label>
            <span>Team</span>
            <select
              value={membershipForm.teamId}
              onChange={(event) =>
                {
                  setMembershipTouched(true);
                  setMembershipForm((current) => ({
                    ...current,
                    teamId: event.target.value,
                  }));
                }
              }
            >
              {teams.map((team) => (
                <option value={team.id} key={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>User</span>
            <select
              value={membershipForm.userId}
              onChange={(event) =>
                {
                  setMembershipTouched(true);
                  setMembershipForm((current) => ({
                    ...current,
                    userId: event.target.value,
                  }));
                }
              }
            >
              {users.map((user) => (
                <option value={user.id} key={user.id}>
                  {user.displayName} · {user.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Team role</span>
            <select
              value={membershipForm.membershipRole}
              onChange={(event) =>
                {
                  setMembershipTouched(true);
                  setMembershipForm((current) => ({
                    ...current,
                    membershipRole: event.target.value,
                  }));
                }
              }
            >
              <option value="OWNER">Owner</option>
              <option value="LEADER">Leader</option>
              <option value="UPLOADER">Uploader</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={membershipForm.status}
              onChange={(event) =>
                {
                  setMembershipTouched(true);
                  setMembershipForm((current) => ({
                    ...current,
                    status: event.target.value,
                  }));
                }
              }
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
          <button className="button button-primary" disabled={busy === "membership"}>
            Save membership
          </button>
          <div className="team-access-list">
            {memberships.map((membership) => (
              <span key={`${membership.teamId}:${membership.userId}`}>
                <strong>{membership.displayName}</strong>
                {membership.teamName} · {humanize(membership.membershipRole)} ·{" "}
                {humanize(membership.status)}
              </span>
            ))}
          </div>
          {membershipTotal > 12 ? (
            <footer className="admin-pagination">
              <span>
                {(membershipPage - 1) * 12 + 1}–
                {Math.min(membershipTotal, membershipPage * 12)} of{" "}
                {membershipTotal}
              </span>
              <button
                type="button"
                disabled={membershipPage <= 1 || accessDirty}
                onClick={() =>
                  void load(
                    Math.max(1, membershipPage - 1),
                    assignmentPage,
                  )
                }
              >
                <CaretLeft size={15} /> Previous
              </button>
              <button
                type="button"
                disabled={
                  membershipPage * 12 >= membershipTotal || accessDirty
                }
                onClick={() =>
                  void load(membershipPage + 1, assignmentPage)
                }
              >
                Next <CaretRight size={15} />
              </button>
            </footer>
          ) : null}
        </form>

        <form className="team-create-form" onSubmit={saveAssignment}>
          <div className="control-section-heading">
            <div>
              <span>Release ownership</span>
              <h3>Series assignment</h3>
            </div>
          </div>
          <label>
            <span>Series</span>
            <select
              value={assignmentForm.seriesId}
              onChange={(event) =>
                {
                  setAssignmentTouched(true);
                  setAssignmentForm((current) => ({
                    ...current,
                    seriesId: event.target.value,
                  }));
                }
              }
            >
              {series.map((item) => (
                <option value={item.id} key={item.id}>{item.title}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Team</span>
            <select
              value={assignmentForm.teamId}
              onChange={(event) =>
                {
                  setAssignmentTouched(true);
                  setAssignmentForm((current) => ({
                    ...current,
                    teamId: event.target.value,
                  }));
                }
              }
            >
              {teams.map((team) => (
                <option value={team.id} key={team.id}>{team.name}</option>
              ))}
            </select>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={assignmentForm.canUpload}
              onChange={(event) =>
                {
                  setAssignmentTouched(true);
                  setAssignmentForm((current) => ({
                    ...current,
                    canUpload: event.target.checked,
                  }));
                }
              }
            />
            Upload chapters
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={assignmentForm.canPublish}
              onChange={(event) =>
                {
                  setAssignmentTouched(true);
                  setAssignmentForm((current) => ({
                    ...current,
                    canPublish: event.target.checked,
                  }));
                }
              }
            />
            Publish without administrator review
          </label>
          <button className="button button-primary" disabled={busy === "assignment"}>
            Save assignment
          </button>
          <div className="team-access-list">
            {assignments.map((assignment) => (
              <span key={`${assignment.seriesId}:${assignment.teamId}`}>
                <strong>{assignment.seriesTitle}</strong>
                {assignment.teamName} · Upload{" "}
                {assignment.canUpload ? "allowed" : "blocked"} · Publish{" "}
                {assignment.canPublish ? "allowed" : "review required"}
              </span>
            ))}
          </div>
          {assignmentTotal > 12 ? (
            <footer className="admin-pagination">
              <span>
                {(assignmentPage - 1) * 12 + 1}–
                {Math.min(assignmentTotal, assignmentPage * 12)} of{" "}
                {assignmentTotal}
              </span>
              <button
                type="button"
                disabled={assignmentPage <= 1 || accessDirty}
                onClick={() =>
                  void load(
                    membershipPage,
                    Math.max(1, assignmentPage - 1),
                  )
                }
              >
                <CaretLeft size={15} /> Previous
              </button>
              <button
                type="button"
                disabled={
                  assignmentPage * 12 >= assignmentTotal || accessDirty
                }
                onClick={() =>
                  void load(membershipPage, assignmentPage + 1)
                }
              >
                Next <CaretRight size={15} />
              </button>
            </footer>
          ) : null}
        </form>
      </div>
      {message ? <PanelMessage kind={kind}>{message}</PanelMessage> : null}
    </section>
  );
}

const assignableRoles: ReadonlyArray<{
  value: AdminUser["primaryRole"];
  label: string;
  description: string;
}> = [
  { value: "OWNER", label: "Owner", description: "Full access, including ownership controls." },
  { value: "ADMINISTRATOR", label: "Administrator", description: "Full administrative access." },
  { value: "MANAGER", label: "Manager", description: "Series request queue and support tickets only." },
  { value: "MODERATOR", label: "Moderator", description: "Community moderation tools." },
  { value: "TEAM_LEADER", label: "Team leader", description: "Assigned-team publishing controls." },
  { value: "UPLOADER", label: "Uploader", description: "Assigned-team chapter uploads." },
  { value: "USER", label: "Reader", description: "Reader account access." },
];

const ownerManagedRoles = new Set<AdminUser["primaryRole"]>([
  "OWNER",
  "ADMINISTRATOR",
  "MANAGER",
]);

const permissionCategoryOrder = [
  "Administration",
  "Analytics",
  "Publishing",
  "Teams",
  "People",
  "Moderation",
  "Support",
  "Finance",
  "Commerce",
  "Operations",
  "Platform",
  "Community",
  "Security",
] as const;

function groupEffectivePermissions(permissions: string[]) {
  const enabled = new Set(permissions);
  return permissionCategoryOrder
    .map((category) => {
      const categoryPermissions = ADMIN_PERMISSION_REGISTRY.filter(
        ([, registryCategory]) => registryCategory === category,
      ).map(([capability, , label]) => ({
        capability,
        label,
        enabled: enabled.has(capability),
      }));
      return {
        category,
        permissions: categoryPermissions,
        activeCount: categoryPermissions.filter((permission) => permission.enabled)
          .length,
        totalCount: categoryPermissions.length,
      };
    });
}

function recentAdminActivityLabel(
  activity: AdminUser["recentActivity"][number],
) {
  const action = activity.action.toLowerCase();
  const chapter =
    activity.seriesTitle && activity.chapterNumber
      ? `Chapter ${activity.chapterNumber} of ${activity.seriesTitle}`
      : activity.seriesTitle
        ? activity.seriesTitle
        : null;
  if (action === "chapter.unlock") {
    return chapter ? `Unlocked ${chapter}` : "Unlocked a chapter";
  }
  if (action.includes("chapter") && action.includes("publish")) {
    return chapter ? `Published ${chapter}` : "Published a chapter";
  }
  if (action === "comment.create") {
    return chapter ? `Commented on ${chapter}` : "Posted a comment";
  }
  if (action.includes("series") && action.includes("update")) {
    return activity.seriesTitle
      ? `Updated ${activity.seriesTitle}`
      : "Updated a series";
  }
  return humanize(activity.action);
}

function UsersManager({
  actorRole,
  actorRoles,
}: {
  actorRole: string;
  actorRoles: string[];
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentActorId, setCurrentActorId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"success" | "error">("success");
  const [loadFailed, setLoadFailed] = useState(false);
  const ownerActor = actorRoles.includes("OWNER") || actorRole === "OWNER";

  async function load() {
    setLoading(true);
    try {
      const payload = await fetch("/api/v1/admin/users").then((response) =>
        readJson<{ data: AdminUser[]; currentActorId: string }>(response),
      );
      setUsers(payload.data ?? []);
      setCurrentActorId(payload.currentActorId ?? "");
      setLoadFailed(false);
    } catch (loadError) {
      setLoadFailed(true);
      setMessage(
        loadError instanceof Error
          ? loadError.message
          : "Users could not be loaded.",
      );
      setKind("error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  async function update(
    user: AdminUser,
    patch: Partial<Pick<AdminUser, "roles" | "status">>,
  ) {
    const nextRoles = patch.roles ?? user.roles;
    if (
      !ownerActor &&
      ([...user.roles, ...nextRoles].some((role) =>
        ownerManagedRoles.has(role),
      ))
    ) {
      setMessage(
        "Only an Owner can assign Owner, Administrator, or Manager roles or change an account that holds one.",
      );
      setKind("error");
      return;
    }
    setBusy(user.id);
    setMessage("");
    try {
      await fetch("/api/v1/admin/users", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          expectedAccessRevision: user.accessRevision,
          expectedStatus: user.status,
          ...patch,
        }),
      }).then((response) => readJson<{ id: string }>(response));
      setMessage(`${user.displayName}'s access was updated and audited.`);
      setKind("success");
      await load();
    } catch (updateError) {
      setMessage(
        updateError instanceof Error
          ? updateError.message
          : "User access could not be updated.",
      );
      setKind("error");
    } finally {
      setBusy("");
    }
  }

  const visible = users.filter((user) =>
    `${user.displayName} ${user.email} ${user.roles.join(" ")} ${user.status} ${(user.teamNames ?? []).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<UserGear size={18} />}
        breadcrumbs={["Community", "Users & Roles"]}
        kicker="Access control"
        title="Users & Roles"
        description={
          ownerActor
            ? "Search accounts, assign the minimum required roles, and suspend access. Every change is server-authorized and written to the audit log."
            : "Assign operational roles and suspend eligible accounts. Owner, Administrator, and Manager roles and accounts are owner-only."
        }
        actions={
          <label className="control-search">
            <MagnifyingGlass size={17} />
            <span className="sr-only">Search users</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, role, or team"
            />
          </label>
        }
      />
      {loading ? (
        <LoadingPanel />
      ) : loadFailed && users.length === 0 ? null : visible.length ? (
        <div className="user-admin-table">
          <div className="user-admin-columns" aria-hidden="true">
            <span>Name &amp; email</span>
            <span>Primary role</span>
            <span>Status</span>
            <span>Joined</span>
            <span />
          </div>
          <div className="user-admin-list">
            {visible.map((user) => {
            const isSelf = user.id === currentActorId;
            const protectedRole = user.roles.some((role) =>
              ownerManagedRoles.has(role),
            );
            const protectedForActor = !ownerActor && protectedRole;
            const accessDisabled =
              isSelf || protectedForActor || busy === user.id;
            const permissionGroups = groupEffectivePermissions(
              user.effectivePermissions ?? [],
            );
            return (
              <details className="user-admin-record" key={user.id}>
                <summary>
                  <span className="user-admin-avatar" aria-hidden="true">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" loading="lazy" />
                    ) : (
                      user.displayName.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="user-admin-primary">
                    <strong>
                      {user.displayName}
                      {isSelf ? <em>You</em> : null}
                    </strong>
                    <small>{user.email}</small>
                  </span>
                  <span className="user-admin-role-badge">
                    {humanize(user.primaryRole)}
                  </span>
                  <span className={`user-admin-status is-${user.status.toLowerCase()}`}>
                    {humanize(user.status)}
                  </span>
                  <time dateTime={user.createdAt}>{formatDate(user.createdAt)}</time>
                  <CaretDown size={17} aria-hidden="true" />
                </summary>
                <div className="user-admin-details">
                  <dl>
                    <div>
                      <dt>Team access</dt>
                      <dd>
                        {(user.teamNames ?? []).length ? (
                          <ul className="user-team-assignments" aria-label={`Team assignments for ${user.displayName}`}>
                            {user.teamNames.map((teamName) => (
                              <li key={teamName}>{teamName}</li>
                            ))}
                          </ul>
                        ) : (
                          "No active team assignment"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Email verification</dt>
                      <dd>{user.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : "Not verified"}</dd>
                    </div>
                    <div>
                      <dt>Last access update</dt>
                      <dd>{formatDate(user.updatedAt)}</dd>
                    </div>
                  </dl>
                  <fieldset
                    className="user-role-picker"
                    disabled={accessDisabled}
                    title={
                      isSelf
                        ? "Use a second authorized account to change your own access."
                        : protectedForActor
                          ? "Only an Owner may change an Owner, Administrator, or Manager account."
                          : undefined
                    }
                  >
                    <legend>Role assignments</legend>
                    <div className="user-role-chips" aria-label={`Roles for ${user.displayName}`}>
                      {assignableRoles.map((role) => {
                        const checked = user.roles.includes(role.value);
                        const ownerOnlyRole =
                          !ownerActor && ownerManagedRoles.has(role.value);
                        return (
                          <label
                            key={role.value}
                            data-role={role.value}
                            data-selected={checked ? "true" : "false"}
                            title={ownerOnlyRole ? `${role.description} Owner-only assignment.` : role.description}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={ownerOnlyRole}
                              onChange={(event) => {
                                const roles = event.target.checked
                                  ? [...new Set([...user.roles, role.value])]
                                  : user.roles.filter((entry) => entry !== role.value);
                                if (!roles.length) return;
                                void update(user, { roles });
                              }}
                            />
                            <span>{role.label}</span>
                          </label>
                        );
                      })}
                    </div>
                    {!ownerActor ? (
                      <small>Privileged roles and accounts can only be changed by an Owner.</small>
                    ) : null}
                  </fieldset>
                  <section className="user-effective-permissions">
                    <span>Effective permissions</span>
                    <div aria-label={`Permission categories for ${user.displayName}`}>
                      {permissionGroups.map((group) => (
                        <details
                          key={group.category}
                          className="user-permission-category"
                        >
                          <summary>
                            <strong>{group.category}</strong>
                            <small>
                              {group.activeCount}/{group.totalCount} enabled
                            </small>
                            <CaretDown size={15} aria-hidden="true" />
                          </summary>
                          <ul>
                            {group.permissions.map((permission) => (
                              <li
                                key={permission.capability}
                                data-enabled={permission.enabled ? "true" : "false"}
                              >
                                <span aria-hidden="true">
                                  {permission.enabled ? <Check size={13} /> : null}
                                </span>
                                <span>
                                  <strong>{permission.label}</strong>
                                  <code>{permission.capability}</code>
                                </span>
                                <em>{permission.enabled ? "Enabled" : "Not enabled"}</em>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ))}
                    </div>
                  </section>
                  <label className="user-admin-status-control">
                    <span>Status</span>
                    <select
                      value={user.status}
                      disabled={accessDisabled}
                      onChange={(event) =>
                        void update(user, {
                          status: event.target.value as AdminUser["status"],
                        })
                      }
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="SUSPENDED">Suspended</option>
                    </select>
                  </label>
                  <section className="user-recent-activity">
                    <span>Recent activity</span>
                    {(user.recentActivity ?? []).length ? (
                      <ol>
                        {user.recentActivity.map((activity) => (
                          <li key={activity.id}>
                            <Pulse size={15} aria-hidden="true" />
                            <span>
                              <strong>{recentAdminActivityLabel(activity)}</strong>
                              <time dateTime={activity.createdAt}>
                                {formatDate(activity.createdAt)} · {humanize(activity.result)}
                              </time>
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <small>No recent audited activity for this account.</small>
                    )}
                  </section>
                  <details className="technical-reference">
                    <summary>Technical reference</summary>
                    <div>
                      <code>{user.id}</code>
                      <button
                        type="button"
                        aria-label={`Copy technical reference for ${user.displayName}`}
                        title="Copy technical reference"
                        onClick={() => {
                          void navigator.clipboard.writeText(user.id);
                          setMessage("Technical reference copied.");
                          setKind("success");
                        }}
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </details>
                </div>
              </details>
            );
            })}
          </div>
        </div>
      ) : (
        <EmptyPanel
          title="No users match this search"
          body="Try a name, email address, role, or status."
        />
      )}
      {message ? <PanelMessage kind={kind}>{message}</PanelMessage> : null}
    </section>
  );
}

type UsersControlView = "overview" | "activity" | "purchases" | "balances";
type BalanceCurrency = "SHARDS" | "ONYX";
type BalanceAdjustmentDraft = {
  mode: "ADD" | "REMOVE";
  amount: string;
  reason: string;
};

const emptyBalanceAdjustment = (): BalanceAdjustmentDraft => ({
  mode: "ADD",
  amount: "",
  reason: "",
});

type UsersControlPayload = {
  view: UsersControlView;
  summary: {
    registeredUsers: number;
    newUsers30d: number;
    suspendedUsers: number;
    activeReaders30d: number;
    purchasedChapters: number;
  };
  rows: Array<Record<string, unknown>>;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  activityResults?: string[];
  balanceSummary?: {
    onyxBalance: number;
    shardsBalance: number;
    pendingOnyx: number | null;
    pendingShards: number | null;
    withdrawnOnyx: number | null;
    withdrawnShards: number | null;
    fundedAccounts: number;
  } | null;
  balanceHistory?: Array<Record<string, unknown>>;
  ownerCanAdjust: boolean;
};

function userActivityPresentation(row: Record<string, unknown>) {
  const type = String(row.activityType ?? "ACTIVITY")
    .replaceAll(".", "_")
    .toUpperCase();
  const user = String(row.displayName ?? "System");
  const seriesTitle = String(row.seriesTitle ?? "").trim();
  const chapterNumber = String(row.chapterNumber ?? "").trim();
  const chapterReference =
    seriesTitle && chapterNumber
      ? `Chapter ${chapterNumber} of ${seriesTitle}`
      : seriesTitle
        ? seriesTitle
        : "a chapter";
  if (type === "CHAPTER_READ") {
    return { icon: <Books size={18} />, text: `${user} read ${chapterReference}` };
  }
  if (type === "COMMENT_CREATED" || type === "COMMENT_CREATE") {
    return {
      icon: <ChatCircle size={18} />,
      text: seriesTitle
        ? `${user} commented on ${chapterReference}`
        : `${user} posted a comment`,
    };
  }
  if (type === "ROULETTE_SPIN") {
    return { icon: <Sparkle size={18} />, text: `${user} used the reward roulette` };
  }
  if (type === "CHAPTER_UNLOCK") {
    return {
      icon: <LockKey size={18} />,
      text: `${user} unlocked ${chapterReference}`,
    };
  }
  if (type.includes("CHAPTER") && type.includes("PUBLISH")) {
    return {
      icon: <CloudArrowUp size={18} />,
      text: `${user} published ${chapterReference}`,
    };
  }
  return {
    icon: <Pulse size={18} />,
    text: `${user} · ${humanize(type).toLowerCase()}`,
  };
}

function activityDayLabel(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = date.toLocaleDateString();
  if (key === today.toLocaleDateString()) return "Today";
  if (key === yesterday.toLocaleDateString()) return "Yesterday";
  return new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(date);
}

function UserActivityTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="users-control-table-wrap">
      <table className="users-control-table" data-view="activity">
        <thead>
          <tr>
            <th>Time</th>
            <th>Activity</th>
            <th>Result</th>
            <th><span className="sr-only">Technical details</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const activity = userActivityPresentation(row);
            const reference = String(row.targetId ?? row.id ?? "—");
            return (
              <tr key={String(row.id ?? index)}>
                <td>
                  {row.createdAt
                    ? new Date(String(row.createdAt)).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </td>
                <td>
                  <span className="user-activity-copy">
                    <i aria-hidden="true">{activity.icon}</i>
                    <span>
                      <strong>{activity.text}</strong>
                      <small>{String(row.email ?? "")}</small>
                    </span>
                  </span>
                </td>
                <td>{humanize(String(row.result ?? "Recorded"))}</td>
                <td>
                  <details className="technical-reference is-inline">
                    <summary>View technical details</summary>
                    <div>
                      <code>{reference}</code>
                      <button
                        type="button"
                        aria-label="Copy activity reference"
                        title="Copy activity reference"
                        onClick={() => void navigator.clipboard.writeText(reference)}
                      >
                        <Copy size={15} />
                      </button>
                    </div>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UsersControlPanel({
  view,
  actorRoles,
  embedded = false,
}: {
  view: UsersControlView;
  actorRoles: string[];
  embedded?: boolean;
}) {
  const { settings: commercial } = useCommercialSettings();
  const coinPlural = commercial.economy.coinPlural;
  const [payload, setPayload] = useState<UsersControlPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activityResult, setActivityResult] = useState("ALL");
  const [activityPage, setActivityPage] = useState(1);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [adjustingUser, setAdjustingUser] = useState<Record<string, unknown> | null>(
    null,
  );
  const [adjustments, setAdjustments] = useState<
    Record<BalanceCurrency, BalanceAdjustmentDraft>
  >({
    SHARDS: emptyBalanceAdjustment(),
    ONYX: emptyBalanceAdjustment(),
  });
  const [openAdjustments, setOpenAdjustments] = useState<
    Record<BalanceCurrency, boolean>
  >({ SHARDS: false, ONYX: false });
  const [adjustmentBusy, setAdjustmentBusy] =
    useState<BalanceCurrency | null>(null);
  const [balanceHistory, setBalanceHistory] = useState<Array<Record<string, unknown>>>([]);
  const [balanceHistoryLoading, setBalanceHistoryLoading] = useState(false);
  const adjustmentEditorRef = useRef<HTMLElement | null>(null);
  const loadSequenceRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const balanceHistoryControllerRef = useRef<AbortController | null>(null);
  const adjustmentKeyRef = useRef<Record<BalanceCurrency, string>>({
    SHARDS: "",
    ONYX: "",
  });
  const adjustmentSubmittingRef = useRef<
    Record<BalanceCurrency, boolean>
  >({ SHARDS: false, ONYX: false });
  const ownerActor = actorRoles.includes("OWNER");

  async function load(
    search = query,
    options: {
      clearMessage?: boolean;
      activityPage?: number;
      activityResult?: string;
    } = {},
  ) {
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    if (options.clearMessage !== false) setMessage("");
    try {
      const searchParams = new URLSearchParams({ view, query: search });
      if (view === "activity") {
        searchParams.set("page", String(options.activityPage ?? activityPage));
        searchParams.set("limit", "25");
        searchParams.set("result", options.activityResult ?? activityResult);
      }
      const response = await fetch(
        `/api/v1/admin/user-control?${searchParams.toString()}`,
        { cache: "no-store", signal: controller.signal },
      );
      const next = await readJson<UsersControlPayload>(response);
      if (sequence !== loadSequenceRef.current) return;
      setPayload(next);
      setError(false);
    } catch (reason) {
      if (
        controller.signal.aborted ||
        sequence !== loadSequenceRef.current
      ) {
        return;
      }
      setMessage(
        reason instanceof Error ? reason.message : "Users Control could not be loaded.",
      );
      setError(true);
    } finally {
      if (sequence === loadSequenceRef.current) {
        if (loadControllerRef.current === controller) {
          loadControllerRef.current = null;
        }
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPayload(null);
      void load("");
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      loadSequenceRef.current += 1;
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
      balanceHistoryControllerRef.current?.abort();
      balanceHistoryControllerRef.current = null;
    };
    // Reload only when the selected Users Control page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function updateAdjustment(
    currency: BalanceCurrency,
    patch: Partial<BalanceAdjustmentDraft>,
  ) {
    if (adjustmentSubmittingRef.current[currency]) return;
    adjustmentKeyRef.current[currency] = "";
    setAdjustments((current) => ({
      ...current,
      [currency]: { ...current[currency], ...patch },
    }));
  }

  function openAdjustment(row: Record<string, unknown>) {
    if (Object.values(adjustmentSubmittingRef.current).some(Boolean)) return;
    adjustmentKeyRef.current = { SHARDS: "", ONYX: "" };
    setAdjustments({
      SHARDS: emptyBalanceAdjustment(),
      ONYX: emptyBalanceAdjustment(),
    });
    setOpenAdjustments({ SHARDS: false, ONYX: false });
    setAdjustingUser(row);
    setBalanceHistory([]);
    setMessage("");
    void loadBalanceHistory(String(row.id));
    window.requestAnimationFrame(() => {
      adjustmentEditorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      adjustmentEditorRef.current?.focus({ preventScroll: true });
    });
  }

  async function loadBalanceHistory(userId: string) {
    balanceHistoryControllerRef.current?.abort();
    const controller = new AbortController();
    balanceHistoryControllerRef.current = controller;
    setBalanceHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/v1/admin/user-control?view=balances&historyUserId=${encodeURIComponent(userId)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const next = await readJson<UsersControlPayload>(response);
      if (controller.signal.aborted) return;
      setBalanceHistory(next.balanceHistory ?? []);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Balance adjustment history could not be loaded.",
      );
      setError(true);
    } finally {
      if (balanceHistoryControllerRef.current === controller) {
        balanceHistoryControllerRef.current = null;
        setBalanceHistoryLoading(false);
      }
    }
  }

  function closeAdjustment() {
    if (Object.values(adjustmentSubmittingRef.current).some(Boolean)) return;
    balanceHistoryControllerRef.current?.abort();
    balanceHistoryControllerRef.current = null;
    setBalanceHistoryLoading(false);
    adjustmentKeyRef.current = { SHARDS: "", ONYX: "" };
    setAdjustments({
      SHARDS: emptyBalanceAdjustment(),
      ONYX: emptyBalanceAdjustment(),
    });
    setOpenAdjustments({ SHARDS: false, ONYX: false });
    setAdjustingUser(null);
  }

  async function applyAdjustment(
    event: FormEvent,
    currency: BalanceCurrency,
  ) {
    event.preventDefault();
    const adjustment = adjustments[currency];
    const absoluteAmount = Number(adjustment.amount);
    const delta =
      adjustment.mode === "REMOVE" ? -absoluteAmount : absoluteAmount;
    if (
      adjustmentSubmittingRef.current[currency] ||
      !ownerActor ||
      !payload?.ownerCanAdjust ||
      !adjustingUser ||
      !Number.isInteger(absoluteAmount) ||
      absoluteAmount <= 0 ||
      adjustment.reason.trim().length < 8
    ) {
      setMessage(
        "Enter a whole positive amount and an audit reason of at least 8 characters.",
      );
      setError(true);
      return;
    }
    adjustmentSubmittingRef.current[currency] = true;
    setAdjustmentBusy(currency);
    setMessage("");
    const idempotencyKey =
      adjustmentKeyRef.current[currency] || crypto.randomUUID();
    adjustmentKeyRef.current[currency] = idempotencyKey;
    try {
      const response = await fetch("/api/v1/admin/balance-adjustments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: String(adjustingUser.id),
          currency,
          delta,
          reason: adjustment.reason,
          idempotencyKey,
        }),
      });
      const result = await readJson<{ created: boolean }>(response);
      adjustmentKeyRef.current[currency] = "";
      setMessage(
        result.created
          ? "The balanced ledger adjustment was posted and audited."
          : "The previous adjustment request was confirmed without posting it twice.",
      );
      setError(false);
      const balanceKey =
        currency === "ONYX" ? "onyxBalance" : "shardsBalance";
      setAdjustingUser((current) =>
        current
          ? {
              ...current,
              [balanceKey]: Number(current[balanceKey] ?? 0) + delta,
            }
          : current,
      );
      setAdjustments((current) => ({
        ...current,
        [currency]: emptyBalanceAdjustment(),
      }));
      await load(query, { clearMessage: false });
      await loadBalanceHistory(String(adjustingUser.id));
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "The balance could not be adjusted.",
      );
      setError(true);
    } finally {
      adjustmentSubmittingRef.current[currency] = false;
      setAdjustmentBusy(null);
    }
  }

  const labels: Record<UsersControlView, [string, string]> = {
    overview: [
      "User overview",
      "Account health, engagement, chapter purchases, and the readers who need attention.",
    ],
    activity: [
      "Activity Log",
      "Human-readable account, publishing, moderation, and economy events in one timeline.",
    ],
    purchases: [
      "Transactions",
      "Real-money orders and chapter unlock transactions without mixing fiat and internal currencies.",
    ],
    balances: [
      "Balances & adjustments",
      `${coinPlural} and Shard balances with owner-only, append-only ledger corrections.`,
    ],
  };
  const [title, description] = labels[view];
  const balanceSummary = payload?.balanceSummary;
  const metricCards: Array<[string, number | string]> = view === "balances"
    ? [
        [`Total ${coinPlural}`, balanceSummary?.onyxBalance ?? 0],
        ["Total Shards", balanceSummary?.shardsBalance ?? 0],
        [
          "Pending ledger balances",
          balanceSummary?.pendingOnyx != null &&
          balanceSummary?.pendingShards != null
            ? `${balanceSummary.pendingOnyx.toLocaleString()} ${coinPlural} · ${balanceSummary.pendingShards.toLocaleString()} Shards`
            : "Not tracked",
        ],
        [
          "Withdrawn ledger balances",
          balanceSummary?.withdrawnOnyx != null &&
          balanceSummary?.withdrawnShards != null
            ? `${balanceSummary.withdrawnOnyx.toLocaleString()} ${coinPlural} · ${balanceSummary.withdrawnShards.toLocaleString()} Shards`
            : "Not tracked",
        ],
        ["Funded accounts", balanceSummary?.fundedAccounts ?? 0],
      ]
    : payload
      ? [
          ["Registered", payload.summary.registeredUsers],
          ["New · 30d", payload.summary.newUsers30d],
          ["Active readers · 30d", payload.summary.activeReaders30d],
          ["Purchased chapters", payload.summary.purchasedChapters],
          ["Suspended", payload.summary.suspendedUsers],
        ]
      : [];
  const activityResults = useMemo(
    () => [
      "ALL",
      ...new Set(
        payload?.activityResults ??
          (payload?.rows ?? []).map((row) => String(row.result ?? "RECORDED")),
      ),
    ],
    [payload?.activityResults, payload?.rows],
  );
  const activityResultOptions = useMemo(
    () =>
      activityResults.map((result) => ({
        value: result,
        label: result === "ALL" ? "All results" : humanize(result),
      })),
    [activityResults],
  );
  const visibleActivityRows = useMemo(
    () => payload?.rows ?? [],
    [payload?.rows],
  );
  const activityPageCount = payload?.pagination?.pages ?? 1;
  const activityTotal = payload?.pagination?.total ?? visibleActivityRows.length;
  const activityGroups = useMemo(() => {
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of visibleActivityRows) {
      const label = activityDayLabel(row.createdAt);
      groups.set(label, [...(groups.get(label) ?? []), row]);
    }
    return [...groups.entries()];
  }, [visibleActivityRows]);
  const searchControl = (
    <form
      className="control-search"
      onSubmit={(event) => {
        event.preventDefault();
        setActivityPage(1);
        void load(query, { activityPage: 1, activityResult });
      }}
    >
      <MagnifyingGlass size={17} />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search users or references"
      />
      <button type="submit" disabled={loading}>Search</button>
    </form>
  );

  return (
    <section className="control-panel users-control-panel">
      {embedded ? (
        <div className="activity-log-embedded-toolbar">{searchControl}</div>
      ) : (
        <PanelHeader
          icon={view === "activity" ? <Pulse size={18} /> : <Database size={18} />}
          kicker="Users Control"
          title={title}
          description={description}
          actions={searchControl}
        />
      )}
      {payload ? (
        <div className="users-control-metrics">
          {metricCards.map(([label, value]) => (
            <article key={String(label)}>
              <span>{label}</span>
              <strong>
                {typeof value === "number" ? value.toLocaleString() : value}
              </strong>
            </article>
          ))}
        </div>
      ) : null}
      {view === "activity" && payload ? (
        <div className="control-section-heading">
          <div>
            <span>Timeline filter</span>
            <h3>Human-readable activity by day</h3>
          </div>
          <label>
            <span className="sr-only">Filter activity result</span>
            <AdminCombobox
              ariaLabel="Filter activity result"
              value={activityResult}
              options={activityResultOptions}
              placeholder="Search result states…"
              onChange={(result) => {
                setActivityResult(result);
                setActivityPage(1);
                void load(query, { activityPage: 1, activityResult: result });
              }}
            />
          </label>
        </div>
      ) : null}
      {adjustingUser ? (
        <section
          className="balance-adjustment-editor"
          ref={adjustmentEditorRef}
          tabIndex={-1}
          aria-labelledby="balance-adjustment-title"
        >
          <header>
            <div>
              <span>Owner-only ledger action</span>
              <h3 id="balance-adjustment-title">
                Adjust {String(adjustingUser.displayName)}’s balances
              </h3>
              <p>
                Choose a currency. Each posted correction creates an equal
                platform entry and a permanent audit record.
              </p>
            </div>
            <button
              type="button"
              disabled={adjustmentBusy !== null}
              aria-label="Close balance adjustment"
              onClick={closeAdjustment}
            >
              <X size={17} />
            </button>
          </header>
          <div className="balance-adjustment-panels">
            {(
              [
                {
                  currency: "SHARDS",
                  label: "Shards",
                  description: "Free reading currency",
                  balanceKey: "shardsBalance",
                  icon: <Sparkle size={21} weight="fill" />,
                },
                {
                  currency: "ONYX",
                  label: coinPlural,
                  description: "Paw Coins balance",
                  balanceKey: "onyxBalance",
                  icon: <Coins size={21} weight="fill" />,
                },
              ] as const
            ).map((option) => {
              const draft = adjustments[option.currency];
              const currentBalance = Number(
                adjustingUser[option.balanceKey] ?? 0,
              );
              const amount = Number(draft.amount) || 0;
              const signedAmount =
                draft.mode === "REMOVE" ? -amount : amount;
              const projectedBalance = currentBalance + signedAmount;
              const open = openAdjustments[option.currency];
              const panelId = `balance-${option.currency.toLowerCase()}-editor`;
              return (
                <article
                  className="balance-currency-panel"
                  data-currency={option.currency.toLowerCase()}
                  key={option.currency}
                >
                  <button
                    className="balance-currency-toggle"
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    disabled={
                      adjustmentBusy !== null &&
                      adjustmentBusy !== option.currency
                    }
                    onClick={() =>
                      setOpenAdjustments((current) => ({
                        ...current,
                        [option.currency]: !current[option.currency],
                      }))
                    }
                  >
                    <span className="balance-currency-icon" aria-hidden="true">
                      {option.icon}
                    </span>
                    <span>
                      <small>{option.description}</small>
                      <strong>{option.label}</strong>
                    </span>
                    <span className="balance-currency-current">
                      <small>Current</small>
                      <strong>{currentBalance.toLocaleString()}</strong>
                    </span>
                    <CaretDown size={17} aria-hidden="true" />
                  </button>
                  {open ? (
                    <form
                      id={panelId}
                      className="balance-currency-form"
                      onSubmit={(event) =>
                        void applyAdjustment(event, option.currency)
                      }
                    >
                      <fieldset>
                        <legend>Adjustment type</legend>
                        <div className="balance-mode-toggle">
                          {(["ADD", "REMOVE"] as const).map((mode) => (
                            <label key={mode}>
                              <input
                                type="radio"
                                name={`${option.currency}-mode`}
                                value={mode}
                                checked={draft.mode === mode}
                                disabled={adjustmentBusy !== null}
                                onChange={() =>
                                  updateAdjustment(option.currency, { mode })
                                }
                              />
                              <span>{mode === "ADD" ? "Add" : "Remove"}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <label>
                        <span>Amount</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          required
                          value={draft.amount}
                          disabled={adjustmentBusy !== null}
                          onChange={(event) =>
                            updateAdjustment(option.currency, {
                              amount: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="balance-adjustment-reason">
                        <span>Reason for audit log</span>
                        <textarea
                          minLength={8}
                          maxLength={500}
                          required
                          value={draft.reason}
                          disabled={adjustmentBusy !== null}
                          placeholder="Explain why this correction is required"
                          onChange={(event) =>
                            updateAdjustment(option.currency, {
                              reason: event.target.value,
                            })
                          }
                        />
                      </label>
                      <div
                        className={`balance-projection ${
                          projectedBalance < 0 ? "is-invalid" : ""
                        }`}
                      >
                        <span>Projected balance</span>
                        <strong>{projectedBalance.toLocaleString()}</strong>
                        <small>
                          {draft.mode === "REMOVE" ? "−" : "+"}
                          {amount.toLocaleString()} {option.label}
                        </small>
                      </div>
                      <button
                        className="button button-primary"
                        type="submit"
                        disabled={
                          adjustmentBusy !== null ||
                          !Number.isInteger(amount) ||
                          amount <= 0 ||
                          projectedBalance < 0 ||
                          draft.reason.trim().length < 8
                        }
                      >
                        {adjustmentBusy === option.currency
                          ? "Posting adjustment…"
                          : `Post ${option.label} adjustment`}
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
          <section className="balance-adjustment-history" aria-label="Recent balance adjustments">
            <header>
              <div>
                <span>Audit trail</span>
                <h4>Recent adjustments</h4>
              </div>
              {balanceHistoryLoading ? <small>Loading…</small> : null}
            </header>
            {balanceHistory.length ? (
              <div>
                {balanceHistory.map((entry) => (
                  <details key={String(entry.id)}>
                    <summary>
                      <span>
                        <strong>{Number(entry.delta ?? 0) > 0 ? "+" : ""}{Number(entry.delta ?? 0).toLocaleString()} {String(entry.currency ?? "")}</strong>
                        <small>{entry.createdAt ? formatDate(String(entry.createdAt)) : "—"}</small>
                      </span>
                      <CaretDown size={15} />
                    </summary>
                    <div>
                      <p>{String(entry.reason ?? "No reason recorded.")}</p>
                      <code>{String(entry.id)}</code>
                    </div>
                  </details>
                ))}
              </div>
            ) : balanceHistoryLoading ? null : (
              <p>No owner adjustment has been recorded for this account.</p>
            )}
          </section>
        </section>
      ) : null}
      {loading ? (
        <LoadingPanel />
      ) : payload === null ? null : view === "activity" ? (
        visibleActivityRows.length ? (
          <>
            <div className="control-activity">
              {activityGroups.map(([day, rows]) => (
                <section key={day} aria-labelledby={`activity-${day.replaceAll(" ", "-")}`}>
                  <div className="control-section-heading">
                    <div>
                      <span>Activity day</span>
                      <h3 id={`activity-${day.replaceAll(" ", "-")}`}>{day}</h3>
                    </div>
                    <small>{rows.length} event{rows.length === 1 ? "" : "s"}</small>
                  </div>
                  <UserActivityTable rows={rows} />
                </section>
              ))}
            </div>
            {activityPageCount > 1 ? (
              <div className="admin-pagination" aria-label="User activity pages">
                <button
                  type="button"
                  disabled={activityPage <= 1}
                  onClick={() => {
                    const next = Math.max(1, activityPage - 1);
                    setActivityPage(next);
                    void load(query, { activityPage: next, activityResult });
                  }}
                >
                  <CaretLeft size={15} /> Previous
                </button>
                <span>
                  Page {activityPage} of {activityPageCount} · {activityTotal} events
                </span>
                <button
                  type="button"
                  disabled={activityPage >= activityPageCount}
                  onClick={() => {
                    const next = Math.min(activityPageCount, activityPage + 1);
                    setActivityPage(next);
                    void load(query, { activityPage: next, activityResult });
                  }}
                >
                  Next <CaretRight size={15} />
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyPanel
            title="No activity matches this result filter"
            body="Choose another result or change the user search."
          />
        )
      ) : payload.rows.length ? (
        <div className="users-control-table-wrap">
          <table className="users-control-table" data-view={view}>
            <thead>
              <tr>
                {view === "balances" ? (
                  <>
                    <th>User</th>
                    <th>{coinPlural}</th>
                    <th>Shards</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </>
                ) : view === "overview" ? (
                  <>
                    <th>User</th>
                    <th>Comments</th>
                    <th>Spins</th>
                    <th>Chapters read</th>
                    <th>Purchases</th>
                  </>
                ) : (
                  <>
                    <th>Time</th>
                    <th>User</th>
                    <th>Type</th>
                    <th>Reference</th>
                    <th>Amount / result</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {payload.rows.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  {view === "balances" ? (
                    <>
                      <td>
                        <span className="user-control-identity">
                          {row.avatarUrl ? (
                            <img src={String(row.avatarUrl)} alt="" />
                          ) : (
                            <i>{String(row.displayName ?? "?").slice(0, 1)}</i>
                          )}
                          <span>
                            <strong>{String(row.displayName ?? "Reader")}</strong>
                            <small>{String(row.email ?? "")} · {humanize(String(row.primaryRole ?? "USER"))}</small>
                          </span>
                        </span>
                      </td>
                      <td>{Number(row.onyxBalance ?? 0).toLocaleString()}</td>
                      <td>{Number(row.shardsBalance ?? 0).toLocaleString()}</td>
                      <td>{String(row.status ?? "")}</td>
                      <td>
                        {payload.ownerCanAdjust && actorRoles.includes("OWNER") ? (
                          <button
                            type="button"
                            className="button button-secondary button-compact icon-action"
                            disabled={adjustmentBusy !== null}
                            onClick={() => openAdjustment(row)}
                            aria-label={`Adjust balances for ${String(row.displayName ?? "this user")}`}
                            title="Adjust balances"
                          >
                            <Wallet size={17} />
                          </button>
                        ) : null}
                      </td>
                    </>
                  ) : view === "overview" ? (
                    <>
                      <td><strong>{String(row.displayName ?? "Reader")}</strong><small>{String(row.email ?? "")}</small></td>
                      <td>{Number(row.comments ?? 0).toLocaleString()}</td>
                      <td>{Number(row.spins ?? 0).toLocaleString()}</td>
                      <td>{Number(row.chaptersRead ?? 0).toLocaleString()}</td>
                      <td>{Number(row.purchases ?? 0).toLocaleString()}</td>
                    </>
                  ) : (
                    (() => {
                      const reference = String(row.targetId ?? row.id ?? "—");
                      return (
                        <>
                          <td>{row.createdAt ? new Date(String(row.createdAt)).toLocaleString() : "—"}</td>
                          <td><strong>{String(row.displayName ?? "System")}</strong><small>{String(row.email ?? "")}</small></td>
                          <td>{String(row.activityType ?? row.kind ?? "Activity").replaceAll("_", " ")}</td>
                          <td>
                            <details className="technical-reference is-inline">
                              <summary>Details</summary>
                              <div>
                                <code>{reference}</code>
                                <button
                                  type="button"
                                  aria-label="Copy transaction reference"
                                  title="Copy transaction reference"
                                  onClick={() => void navigator.clipboard.writeText(reference)}
                                >
                                  <Copy size={15} />
                                </button>
                              </div>
                            </details>
                          </td>
                          <td>{row.amount !== undefined ? `${Number(row.amount).toLocaleString()} ${String(row.currency ?? "")}` : String(row.result ?? row.status ?? "—")}</td>
                        </>
                      );
                    })()
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyPanel
          title="No matching user records"
          body="Change the filter or search term and try again."
        />
      )}
      {message ? <PanelMessage kind={error ? "error" : "success"}>{message}</PanelMessage> : null}
    </section>
  );
}

type PayoutReportPayload = {
  readiness: {
    featureEnabled: boolean;
    integrationReady: boolean;
    financiallyClear: boolean;
    debtOnyx: number;
    openDisputes: number;
    ready: boolean;
    reason: string | null;
    currency: string | null;
    minorPerOnyx: number | null;
  };
  summary: {
    totalReceivedOnyx: number;
    postedBalanceOnyx: number;
    pendingOnyx: number;
    approvedOnyx: number;
    paidOnyx: number;
    payoutRecordCount: number;
  };
  teams: Array<{
    id: string;
    slug: string;
    name: string;
    verificationStatus: string;
    totalReceivedOnyx: number;
    postedBalanceOnyx: number;
    reservedOnyx: number;
    availableOnyx: number;
    paidOnyx: number;
    lastEarnedAt: string | null;
    provider: string | null;
    providerAccountId: string | null;
    accountRevision: number | null;
  }>;
  records: Array<{
    id: string;
    teamId: string;
    teamName: string;
    requestedByName: string;
    reviewedByName: string | null;
    amountOnyx: number;
    amountMinor: number;
    currency: string;
    status: "PENDING" | "APPROVED" | "PROCESSING" | "PAID" | "REJECTED";
    providerTransferId: string | null;
    reason: string;
    revision: number;
    reviewedAt: string | null;
    paidAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

type PaymentRiskPayload = {
  summary: {
    debtOnyx: number;
    reversedOnyx: number;
    refundedMinor: number;
    openDisputes: number;
    affectedPayments: number;
  };
  states: Array<{
    id: string;
    orderId: string;
    userName: string;
    email: string;
    currency: string;
    refundedMinor: number;
    reversedOnyx: number;
    debtOnyx: number;
    disputeRiskMinor: number;
    updatedAt: string;
  }>;
  adjustments: Array<{
    id: string;
    kind: string;
    orderId: string;
    userName: string;
    atRiskMinorAfter: number;
    onyxDelta: number;
    createdAt: string;
  }>;
};

const payoutStatuses = ["ALL", "PENDING", "APPROVED", "PROCESSING", "PAID", "REJECTED"] as const;

function payoutTone(status: PayoutReportPayload["records"][number]["status"]) {
  if (status === "PAID") return "success" as const;
  if (status === "REJECTED") return "danger" as const;
  if (status === "PENDING") return "warning" as const;
  return "info" as const;
}

function PayoutsPanel() {
  const { settings: commercial } = useCommercialSettings();
  const coinPlural = commercial.economy.coinPlural;
  const [payload, setPayload] = useState<PayoutReportPayload | null>(null);
  const [paymentRisk, setPaymentRisk] = useState<PaymentRiskPayload | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof payoutStatuses)[number]>("ALL");
  const [page, setPage] = useState(1);
  const [accountTeamId, setAccountTeamId] = useState("");
  const [requestTeamId, setRequestTeamId] = useState("");
  const [providerAccountId, setProviderAccountId] = useState("");
  const [accountReason, setAccountReason] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const loadControllerRef = useRef<AbortController | null>(null);

  async function load(
    search = query,
    nextStatus: (typeof payoutStatuses)[number] = status,
    nextPage = page,
  ) {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const [response, riskResponse] = await Promise.all([
        fetch(
          `/api/v1/admin/team-payouts?q=${encodeURIComponent(search)}&status=${nextStatus}&page=${nextPage}&limit=25`,
          { cache: "no-store", signal: controller.signal },
        ),
        fetch(
          `/api/v1/admin/payment-risk?q=${encodeURIComponent(search)}&page=1&limit=10`,
          { cache: "no-store", signal: controller.signal },
        ),
      ]);
      const [next, nextRisk] = await Promise.all([
        readJson<PayoutReportPayload>(response),
        readJson<PaymentRiskPayload>(riskResponse),
      ]);
      if (!controller.signal.aborted) {
        setPayload(next);
        setPaymentRisk(nextRisk);
        const verified = next.teams.find((team) => team.verificationStatus === "VERIFIED");
        if (!accountTeamId && verified) {
          setAccountTeamId(verified.id);
          setProviderAccountId(verified.providerAccountId ?? "");
        }
        if (!requestTeamId && verified) setRequestTeamId(verified.id);
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      setMessageKind("error");
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Payout reporting could not be loaded.",
      );
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(""), 0);
    return () => {
      window.clearTimeout(timeout);
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
    };
    // This report reloads explicitly through its search form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mutate(body: Record<string, unknown>, label: string) {
    setBusy(`${String(body.action)}:${String(body.requestId ?? body.teamId ?? "new")}`);
    setMessage("");
    try {
      const response = await fetch("/api/v1/admin/team-payouts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const next = await readJson<PayoutReportPayload>(response);
      setPayload(next);
      setPage(1);
      setStatus("ALL");
      setQuery("");
      setMessageKind("success");
      setMessage(label);
      return true;
    } catch (reason) {
      const failureMessage = reason instanceof Error
        ? reason.message
        : "The payout action failed.";
      try {
        const refreshed = await fetch(
          `/api/v1/admin/team-payouts?q=${encodeURIComponent(query)}&status=${status}&page=${page}&limit=25`,
          { cache: "no-store" },
        );
        setPayload(await readJson<PayoutReportPayload>(refreshed));
      } catch {
        // Preserve the actionable mutation error even when the refresh also fails.
      }
      setMessageKind("error");
      setMessage(failureMessage);
      return false;
    } finally {
      setBusy("");
    }
  }

  const verifiedTeams = useMemo(
    () =>
      (payload?.teams ?? []).filter(
        (team) => team.verificationStatus === "VERIFIED",
      ),
    [payload?.teams],
  );
  const verifiedTeamOptions = useMemo(
    () =>
      verifiedTeams.map((team) => ({
        value: team.id,
        label: team.name,
        description: `/${team.slug}`,
      })),
    [verifiedTeams],
  );
  const payoutRequestTeamOptions = useMemo(
    () =>
      verifiedTeams.map((team) => ({
        value: team.id,
        label: team.name,
        description: `${team.availableOnyx.toLocaleString()} ${coinPlural} available`,
      })),
    [coinPlural, verifiedTeams],
  );
  const accountTeam =
    verifiedTeams.find((team) => team.id === accountTeamId) ?? null;
  const requestTeam =
    verifiedTeams.find((team) => team.id === requestTeamId) ?? null;
  const availableOnyx = Math.max(
    0,
    Number(payload?.summary.postedBalanceOnyx ?? 0) -
      Number(payload?.summary.pendingOnyx ?? 0) -
      Number(payload?.summary.approvedOnyx ?? 0),
  );

  const metrics: Array<[string, number | string]> = payload
    ? [
        ["Total received", payload.summary.totalReceivedOnyx],
        ["Available", availableOnyx],
        ["Pending / approved", payload.summary.pendingOnyx + payload.summary.approvedOnyx],
        ["Paid", payload.summary.paidOnyx],
      ]
    : [];

  return (
    <section className="control-panel payout-report-panel">
      <PanelHeader
        icon={<Wallet size={18} />}
        kicker="Finance"
        title="Payouts"
        description="Verified destinations, reserved balances, reviewed requests, idempotent Stripe transfers, and balanced payout ledger entries."
        actions={
          <form
            className="control-search"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              void load(query, status, 1);
            }}
          >
            <MagnifyingGlass size={17} aria-hidden="true" />
            <input
              aria-label="Search payout teams"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search team name or slug"
            />
            <select
              aria-label="Filter payout status"
              value={status}
              onChange={(event) => {
                const next = event.target.value as (typeof payoutStatuses)[number];
                setStatus(next);
                setPage(1);
                void load(query, next, 1);
              }}
            >
              {payoutStatuses.map((entry) => <option key={entry} value={entry}>{humanize(entry)}</option>)}
            </select>
            <button type="submit" disabled={loading}>Search</button>
          </form>
        }
      />
      {payload ? (
        <>
          <div className="users-control-metrics payout-summary-metrics">
            {metrics.map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>
                  {typeof value === "number" ? value.toLocaleString() : value}
                </strong>
                <small>
                  {typeof value === "number" ? coinPlural : "Lifecycle state"}
                </small>
              </article>
            ))}
          </div>
          <div className="payout-report-note" data-enabled={payload.readiness.ready}>
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              <strong>
                {payload.readiness.ready
                  ? "Team payouts active · Stripe Connect ready"
                  : payload.readiness.featureEnabled
                    ? "Payout integration needs configuration"
                    : "Team payouts disabled"}
              </strong>
              <small>
                {payload.readiness.ready
                  ? `${payload.readiness.minorPerOnyx} ${payload.readiness.currency} minor units per Onyx. Transfers are idempotent and post a balanced payout ledger entry.`
                  : `Readiness: ${humanize(payload.readiness.reason ?? "not ready")}. ${payload.readiness.debtOnyx.toLocaleString()} Onyx debt · ${payload.readiness.openDisputes.toLocaleString()} open disputes. Existing records remain visible and auditable; already-processing transfers stay resumable.`}
              </small>
            </span>
          </div>
          <div className="control-overview-grid">
            <AdminSectionCard
              icon={<ShieldCheck />}
              title="Stripe destination"
              summary="Verified Connect account for the selected team"
            >
              <form
                className="admin-form-section"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const saved = await mutate(
                    {
                      action: "SET_ACCOUNT",
                      teamId: accountTeamId,
                      providerAccountId: providerAccountId.trim(),
                      expectedRevision: accountTeam?.accountRevision ?? 0,
                      reason: accountReason,
                    },
                    "The verified Stripe destination was saved and audited.",
                  );
                  if (saved) setAccountReason("");
                }}
              >
                <div className="admin-form-grid">
                  <label>
                    Team
                    <AdminCombobox
                      ariaLabel="Search and choose a verified payout team"
                      value={accountTeamId}
                      options={verifiedTeamOptions}
                      emptyLabel="Select a verified team"
                      placeholder="Search verified teams…"
                      onChange={(teamId) => {
                        setAccountTeamId(teamId);
                        setProviderAccountId(
                          payload.teams.find((team) => team.id === teamId)?.providerAccountId ?? "",
                        );
                      }}
                    />
                  </label>
                  <label>
                    Stripe account
                    <input
                      value={providerAccountId}
                      onChange={(event) => setProviderAccountId(event.target.value)}
                      placeholder="acct_…"
                      pattern="acct_[A-Za-z0-9]{8,80}"
                      required
                    />
                  </label>
                </div>
                <label>
                  Audit reason
                  <input
                    value={accountReason}
                    onChange={(event) => setAccountReason(event.target.value)}
                    minLength={10}
                    maxLength={1000}
                    placeholder="Why this payout destination is being set"
                    required
                  />
                </label>
                <button
                  className="button"
                  type="submit"
                  disabled={!payload.readiness.integrationReady || Boolean(busy) || !accountTeamId}
                >
                  {busy.startsWith("SET_ACCOUNT") ? "Verifying…" : "Verify and save account"}
                </button>
              </form>
            </AdminSectionCard>
            <AdminSectionCard
              icon={<Coins />}
              title="New payout request"
              summary="Reserves real available Onyx before review"
            >
              <form
                className="admin-form-section"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const saved = await mutate(
                    {
                      action: "REQUEST",
                      teamId: requestTeamId,
                      amountOnyx: Number(requestAmount),
                      clientMutationId: crypto.randomUUID(),
                      reason: requestReason,
                    },
                    "The payout request was reserved and added to review.",
                  );
                  if (saved) {
                    setRequestAmount("");
                    setRequestReason("");
                  }
                }}
              >
                <div className="admin-form-grid">
                  <label>
                    Team
                    <AdminCombobox
                      ariaLabel="Search and choose a team for a payout request"
                      value={requestTeamId}
                      options={payoutRequestTeamOptions}
                      emptyLabel="Select a verified team"
                      placeholder="Search verified teams…"
                      onChange={setRequestTeamId}
                    />
                  </label>
                  <label>
                    Amount ({coinPlural})
                    <input
                      type="number"
                      min={1}
                      max={requestTeam?.availableOnyx ?? 1}
                      value={requestAmount}
                      onChange={(event) => setRequestAmount(event.target.value)}
                      required
                    />
                  </label>
                </div>
                <label>
                  Audit reason
                  <input
                    value={requestReason}
                    onChange={(event) => setRequestReason(event.target.value)}
                    minLength={10}
                    maxLength={1000}
                    placeholder="Why this team payout is being requested"
                    required
                  />
                </label>
                <button
                  className="button"
                  type="submit"
                  disabled={!payload.readiness.ready || Boolean(busy) || !requestTeam?.providerAccountId}
                >
                  {busy.startsWith("REQUEST") ? "Reserving…" : "Request payout"}
                </button>
              </form>
            </AdminSectionCard>
          </div>
          {paymentRisk ? (
            <AdminSectionCard
              icon={<ShieldWarning />}
              title="Refunds, disputes, and payment debt"
              summary="Verified Stripe events mapped to immutable order snapshots"
              collapsible
              defaultOpen={paymentRisk.summary.debtOnyx > 0 || paymentRisk.summary.openDisputes > 0}
            >
              <div className="admin-summary-grid">
                <div><span>Payment debt</span><strong>{paymentRisk.summary.debtOnyx.toLocaleString()} {coinPlural}</strong></div>
                <div><span>Open disputes</span><strong>{paymentRisk.summary.openDisputes.toLocaleString()}</strong></div>
                <div><span>Reversed</span><strong>{paymentRisk.summary.reversedOnyx.toLocaleString()} {coinPlural}</strong></div>
                <div><span>Affected payments</span><strong>{paymentRisk.summary.affectedPayments.toLocaleString()}</strong></div>
              </div>
              {paymentRisk.states.length ? (
                <div className="users-control-table-wrap">
                  <table className="users-control-table" data-view="payment-risk">
                    <thead><tr><th>Account</th><th>Order</th><th>Refund / dispute</th><th>Onyx impact</th><th>Updated</th></tr></thead>
                    <tbody>
                      {paymentRisk.states.map((state) => (
                        <tr key={state.id}>
                          <td><strong>{state.userName}</strong><small>{state.email}</small></td>
                          <td><code>{state.orderId}</code></td>
                          <td>
                            <strong>{state.refundedMinor.toLocaleString()} {state.currency} minor units refunded</strong>
                            <small>{state.disputeRiskMinor.toLocaleString()} at dispute risk</small>
                          </td>
                          <td>
                            <strong>{state.reversedOnyx.toLocaleString()} reversed</strong>
                            <small>{state.debtOnyx.toLocaleString()} debt</small>
                          </td>
                          <td>{new Date(state.updatedAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="payout-records-empty">No verified refund, dispute, or payment debt matches this filter.</p>
              )}
            </AdminSectionCard>
          ) : null}
        </>
      ) : null}
      {loading ? (
        <LoadingPanel />
      ) : payload?.teams.length ? (
        <div className="users-control-table-wrap">
          <table className="users-control-table payout-team-table" data-view="team-payout-balances">
            <thead>
              <tr>
                <th>Team</th>
                <th>Total received</th>
                <th>Available</th>
                <th>Reserved</th>
                <th>Paid</th>
                <th>Destination</th>
              </tr>
            </thead>
            <tbody>
              {payload.teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <strong>{team.name}</strong>
                    <small>
                      {humanize(team.verificationStatus)} · /{team.slug}
                    </small>
                  </td>
                  <td>{Number(team.totalReceivedOnyx).toLocaleString()} {coinPlural}</td>
                  <td>{Number(team.availableOnyx).toLocaleString()} {coinPlural}</td>
                  <td>{Number(team.reservedOnyx).toLocaleString()} {coinPlural}</td>
                  <td>{Number(team.paidOnyx).toLocaleString()} {coinPlural}</td>
                  <td>
                    {team.providerAccountId ? <code>{team.providerAccountId}</code> : "Not configured"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : payload ? (
        <EmptyPanel
          title="No team payout balances"
          body="No teams match this search. Payouts remain unavailable until a verified team has real Onyx balance and a verified Stripe destination."
        />
      ) : null}
      {!loading && payload ? (
        <section className="payout-records-section">
          <header>
            <div>
              <span>Lifecycle and audit controls</span>
              <h3>Payout requests</h3>
            </div>
            <strong>{payload.summary.payoutRecordCount.toLocaleString()}</strong>
          </header>
          {payload.records.length ? (
            <div className="users-control-table-wrap">
              <table className="users-control-table" data-view="payout-records">
                <thead><tr><th>Status</th><th>Team</th><th>Amount</th><th>Requested</th><th>Review action</th></tr></thead>
                <tbody>
                  {payload.records.map((record) => {
                    const actionBusy = busy.endsWith(`:${record.id}`);
                    return (
                      <tr key={record.id}>
                        <td><AdminStatusBadge tone={payoutTone(record.status)} label={humanize(record.status)} /></td>
                        <td>
                          <strong>{record.teamName}</strong>
                          <small>{record.reason}</small>
                          <details className="technical-reference is-inline">
                            <summary>Technical details</summary>
                            <div>
                              <code>{record.id}</code>
                              <button type="button" aria-label={`Copy payout reference for ${record.teamName}`} onClick={() => void navigator.clipboard.writeText(record.id)}><Copy size={15} /></button>
                              {record.providerTransferId ? <code>{record.providerTransferId}</code> : null}
                            </div>
                          </details>
                        </td>
                        <td>
                          <strong>{record.amountOnyx.toLocaleString()} {coinPlural}</strong>
                          <small>{record.amountMinor.toLocaleString()} {record.currency} minor units</small>
                        </td>
                        <td>
                          <span>{record.requestedByName}</span>
                          <small>{new Date(record.createdAt).toLocaleString()}</small>
                        </td>
                        <td>
                          {record.status === "PAID" || record.status === "REJECTED" ? (
                            <small>{record.status === "PAID" && record.paidAt ? `Paid ${new Date(record.paidAt).toLocaleString()}` : "Closed"}</small>
                          ) : (
                            <div className="admin-inline-field">
                              <label>
                                Audit reason
                                <input
                                  value={reviewReasons[record.id] ?? ""}
                                  onChange={(event) => setReviewReasons((current) => ({ ...current, [record.id]: event.target.value }))}
                                  minLength={10}
                                  maxLength={1000}
                                  placeholder="Required for each transition"
                                />
                              </label>
                              {record.status === "PENDING" ? (
                                <button
                                  type="button"
                                  disabled={actionBusy || (reviewReasons[record.id]?.trim().length ?? 0) < 10}
                                  onClick={() => void mutate({ action: "APPROVE", requestId: record.id, expectedRevision: record.revision, reason: reviewReasons[record.id] }, "The payout was approved and remains reserved.")}
                                >Approve</button>
                              ) : null}
                              {record.status === "PENDING" || record.status === "APPROVED" ? (
                                <button
                                  type="button"
                                  disabled={actionBusy || (reviewReasons[record.id]?.trim().length ?? 0) < 10}
                                  onClick={() => void mutate({ action: "REJECT", requestId: record.id, expectedRevision: record.revision, reason: reviewReasons[record.id] }, "The payout was rejected and its reservation released.")}
                                >Reject</button>
                              ) : null}
                              {record.status === "APPROVED" || record.status === "PROCESSING" ? (
                                <button
                                  className="button"
                                  type="button"
                                  disabled={actionBusy || (reviewReasons[record.id]?.trim().length ?? 0) < 10}
                                  onClick={() => void mutate({ action: "PAY", requestId: record.id, expectedRevision: record.revision, reason: reviewReasons[record.id] }, "The Stripe transfer and balanced payout ledger entry were completed.")}
                                >{record.status === "PROCESSING" ? "Resume safely" : "Pay"}</button>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="payout-records-empty">
              No payout request matches these filters. Create one only from a
              verified team’s real, unreserved Onyx ledger balance.
            </p>
          )}
          {payload.pagination.totalPages > 1 ? (
            <div className="control-panel-actions">
              <button type="button" disabled={page <= 1 || loading} onClick={() => { const next = page - 1; setPage(next); void load(query, status, next); }}><CaretLeft /> Previous</button>
              <span>Page {payload.pagination.page} of {payload.pagination.totalPages}</span>
              <button type="button" disabled={page >= payload.pagination.totalPages || loading} onClick={() => { const next = page + 1; setPage(next); void load(query, status, next); }}>Next <CaretRight /></button>
            </div>
          ) : null}
        </section>
      ) : null}
      {message ? <PanelMessage kind={messageKind}>{message}</PanelMessage> : null}
    </section>
  );
}

type ReviewChapter = {
  id: string;
  slug: string;
  chapterNumber: string;
  title: string;
  language: string;
  version: number;
  revision: number;
  state: "DRAFT" | "READY_FOR_REVIEW";
  pageCount: number;
  createdAt: string;
  seriesSlug: string;
  seriesTitle: string;
  teamName: string | null;
  replacementChapterId: string | null;
  replacementChapterNumber: string | null;
  replacementChapterTitle: string | null;
};

function ReviewQueue({ admin }: { admin: boolean }) {
  const [chapters, setChapters] = useState<ReviewChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [pendingTransition, setPendingTransition] = useState<{
    chapter: ReviewChapter;
    action: "SUBMIT" | "PUBLISH" | "RETURN";
    approvalDecision?: "APPROVE" | "UNDER_SCOPE" | "REJECT";
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const payload = await fetch("/api/v1/workspace/review-queue", {
        cache: "no-store",
      }).then((response) =>
        readJson<{ data: ReviewChapter[] }>(response),
      );
      setChapters(payload.data ?? []);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "The review queue could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  function transition(
    chapter: ReviewChapter,
    action: "SUBMIT" | "PUBLISH" | "RETURN",
    approvalDecision?: "APPROVE" | "UNDER_SCOPE" | "REJECT",
  ) {
    setPendingTransition({ chapter, action, approvalDecision });
  }

  async function executeTransition(
    transitionIntent: NonNullable<typeof pendingTransition>,
    reason: string,
  ) {
    const { chapter, action, approvalDecision } = transitionIntent;
    setBusy(chapter.id);
    setMessage("");
    try {
      const response = await fetch("/api/v1/workspace/review", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chapterId: chapter.id,
          expectedRevision: chapter.revision,
          action,
          approvalDecision,
          reason,
        }),
      });
      const payload = (await response.json()) as {
        state?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "The review state was not changed.",
        );
      }
      setMessage(
        `${chapter.seriesTitle} chapter ${chapter.chapterNumber} moved to ${humanize(payload.state ?? action)}.`,
      );
      await load();
    } catch (transitionError) {
      setError(
        transitionError instanceof Error
          ? transitionError.message
          : "The review state was not changed.",
      );
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<CheckCircle size={18} />}
        breadcrumbs={["Publishing Queue", "Chapter Review"]}
        kicker="Publishing QA"
        title="Chapter Review"
        description="Inspect chapter sources by validation state. Only processed, ordered pages should move into publication."
        actions={
          <button type="button" onClick={() => void load()}>
            <ArrowClockwise size={17} /> Refresh
          </button>
        }
      />
      {error ? <PanelMessage kind="error">{error}</PanelMessage> : null}
      {message ? <PanelMessage kind="success">{message}</PanelMessage> : null}
      {loading ? (
        <LoadingPanel />
      ) : chapters.length ? (
        <div className="review-queue-list">
          {chapters.map((chapter) => (
              <article key={chapter.id}>
                <span>
                  <FileImage size={21} />
                </span>
                <div>
                  <strong>
                    {chapter.seriesTitle} · Chapter {chapter.chapterNumber}
                    {chapter.title ? ` · ${chapter.title}` : ""}
                  </strong>
                  <small>
                    {chapter.teamName ?? "Independent release"} ·{" "}
                    {chapter.language.toUpperCase()} · v{chapter.version} ·{" "}
                    {formatDate(chapter.createdAt)}
                  </small>
                  {chapter.replacementChapterId ? (
                    <span className="review-replacement-note">
                      Replacement request · existing chapter{" "}
                      {chapter.replacementChapterNumber}
                      {chapter.replacementChapterTitle
                        ? ` · ${chapter.replacementChapterTitle}`
                        : ""}
                    </span>
                  ) : null}
                </div>
                <div>
                  <span className={`control-status status-${chapter.state.toLowerCase()}`}>
                    {humanize(chapter.state)}
                  </span>
                  <small>{chapter.pageCount} ordered pages</small>
                  {chapter.pageCount > 0 ? (
                    <a
                      className="review-preview-link"
                      href={`/title/${chapter.seriesSlug}/chapter/${chapter.slug}`}
                    >
                      Preview release
                      <ArrowRight size={14} />
                    </a>
                  ) : null}
                  <div className="review-state-actions">
                    {chapter.state === "DRAFT" ? (
                      <button
                        type="button"
                        disabled={busy === chapter.id}
                        onClick={() => void transition(chapter, "SUBMIT")}
                      >
                        Submit for review
                      </button>
                    ) : admin ? (
                      <>
                        <button type="button" disabled={busy === chapter.id} onClick={() => void transition(chapter, "PUBLISH", "APPROVE")}>Approve uploader</button>
                        <button type="button" disabled={busy === chapter.id} onClick={() => void transition(chapter, "PUBLISH", "UNDER_SCOPE")}>Approve · under scope</button>
                        <button type="button" disabled={busy === chapter.id} onClick={() => void transition(chapter, "RETURN", "REJECT")}>Reject</button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy === chapter.id}
                          onClick={() => void transition(chapter, "PUBLISH")}
                        >
                          {chapter.replacementChapterId
                            ? "Approve replacement"
                            : admin
                              ? "Publish"
                              : "Request publish"}
                        </button>
                        <button
                          type="button"
                          disabled={busy === chapter.id}
                          onClick={() => void transition(chapter, "RETURN")}
                        >
                          Return to draft
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
          ))}
        </div>
      ) : (
        <EmptyPanel
          title="Review queue is clear"
          body="New chapter sources will appear here after upload."
        />
      )}
      <PromptActionDialog
        open={Boolean(pendingTransition)}
        title={
          pendingTransition?.action === "PUBLISH"
            ? "Add publication note"
            : pendingTransition?.action === "RETURN"
              ? "Explain required corrections"
              : "Add review submission note"
        }
        description="This note is saved with the audited chapter review transition."
        label="Review note"
        initialValue={
          pendingTransition?.action === "PUBLISH"
            ? "Validated ordered pages and release metadata"
            : pendingTransition?.action === "RETURN"
              ? "Return for required release corrections"
              : "Ready for editorial and page-order review"
        }
        confirmLabel="Continue review action"
        busy={Boolean(busy)}
        minLength={1}
        onCancel={() => {
          if (!busy) setPendingTransition(null);
        }}
        onConfirm={(reason) => {
          const transitionIntent = pendingTransition;
          setPendingTransition(null);
          if (transitionIntent) {
            void executeTransition(transitionIntent, reason);
          }
        }}
      />
    </section>
  );
}

function ChapterAccessPanel() {
  const { settings: commercial } = useCommercialSettings();
  const [chapters, setChapters] = useState<AdminChapter[]>([]);
  const [metrics, setMetrics] = useState({
    total: 0,
    paid: 0,
    readerUnlocks: 0,
  });
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "PAID" | "FREE">("ALL");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pages, setPages] = useState<AdminChapterPage[]>([]);
  const [comments, setComments] = useState<AdminChapterComment[]>([]);
  const [removeCommentTarget, setRemoveCommentTarget] =
    useState<AdminChapterComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"success" | "error">("success");
  const [form, setForm] = useState({
    chapterNumber: "",
    title: "",
    volume: "",
    language: "en",
    format: "VERTICAL" as AdminChapter["format"],
    version: 1,
    releaseNotes: "",
    publishedAt: "",
    state: "DRAFT" as AdminChapter["state"],
    accessType: "FREE" as AdminChapter["accessType"],
    priceOnyx: 0,
    reason: "",
  });

  function selectChapter(chapter: AdminChapter) {
    setSelectedId(chapter.id);
    setForm({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      volume: chapter.volume ?? "",
      language: chapter.language,
      format: chapter.format,
      version: Number(chapter.version),
      releaseNotes: chapter.releaseNotes,
      publishedAt: toLocalDateTimeInput(chapter.publishedAt),
      state: chapter.state,
      accessType: chapter.accessType,
      priceOnyx: Number(chapter.priceOnyx),
      reason: "",
    });
    void loadChapterDetail(chapter.id);
  }

  async function loadChapterDetail(chapterId: string) {
    setDetailLoading(true);
    try {
      const payload = await fetch(
        `/api/v1/admin/chapter-detail?id=${encodeURIComponent(chapterId)}`,
        { cache: "no-store" },
      ).then((response) =>
        readJson<{
          data: {
            pages: AdminChapterPage[];
            comments: AdminChapterComment[];
          };
        }>(response),
      );
      setPages(payload.data.pages ?? []);
      setComments(payload.data.comments ?? []);
    } catch (detailError) {
      setMessage(
        detailError instanceof Error
          ? detailError.message
          : "Chapter pages and comments could not be loaded.",
      );
      setKind("error");
      setPages([]);
      setComments([]);
    } finally {
      setDetailLoading(false);
    }
  }

  async function load(preferredId?: string, preserveMessage = false) {
    setLoading(true);
    try {
      const payload = await fetch("/api/v1/admin/chapters", {
        cache: "no-store",
      }).then((response) =>
        readJson<{
          data: AdminChapter[];
          metrics: {
            total: number;
            paid: number;
            readerUnlocks: number;
          };
        }>(response),
      );
      const next = payload.data ?? [];
      setChapters(next);
      setMetrics(payload.metrics);
      const query =
        typeof window === "undefined"
          ? null
          : new URLSearchParams(window.location.search);
      const linkedChapter = query?.get("chapter");
      const linkedSeries = query?.get("series");
      const linked = next.find(
        (chapter) =>
          chapter.id === linkedChapter ||
          (chapter.slug === linkedChapter &&
            (!linkedSeries || chapter.seriesSlug === linkedSeries)),
      );
      const nextId =
        preferredId && next.some((chapter) => chapter.id === preferredId)
          ? preferredId
          : linked
            ? linked.id
          : selectedId && next.some((chapter) => chapter.id === selectedId)
            ? selectedId
            : (next[0]?.id ?? "");
      const nextChapter = next.find((chapter) => chapter.id === nextId);
      if (nextChapter) selectChapter(nextChapter);
      else setSelectedId("");
      if (!preserveMessage) setMessage("");
    } catch (loadError) {
      setMessage(
        loadError instanceof Error
          ? loadError.message
          : "Chapter access policies could not be loaded.",
      );
      setKind("error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
    // The explicit refresh action owns subsequent loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = chapters.find((chapter) => chapter.id === selectedId);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return chapters.filter((chapter) => {
      const paid = chapter.effectiveAccessType === "PAID";
      if (filter === "PAID" && !paid) return false;
      if (filter === "FREE" && paid) return false;
      return (
        !term ||
        chapter.seriesTitle.toLowerCase().includes(term) ||
        (chapter.teamName ?? "").toLowerCase().includes(term) ||
        chapter.chapterNumber.toLowerCase().includes(term) ||
        chapter.title.toLowerCase().includes(term)
      );
    });
  }, [chapters, filter, search]);

  const counts = useMemo(
    () => ({
      all: metrics.total,
      paid: metrics.paid,
      unlocked: metrics.readerUnlocks,
    }),
    [metrics],
  );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      await fetch("/api/v1/admin/chapters", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          expectedRevision: selected.revision,
          chapterNumber: form.chapterNumber,
          title: form.title,
          volume: form.volume,
          language: form.language,
          format: form.format,
          version: Number(form.version),
          releaseNotes: form.releaseNotes,
          pageOrder: pages.map((page) => page.id),
          publishedAt: form.publishedAt
            ? new Date(form.publishedAt).toISOString()
            : null,
          state: form.state,
          accessType: form.accessType,
          priceOnyx: Number(form.priceOnyx),
          reason: form.reason,
        }),
      }).then((response) =>
        readJson<{
          id: string;
          accessType: AdminChapter["accessType"];
        }>(response),
      );
      setMessage(
        `${selected.seriesTitle} · Chapter ${selected.chapterNumber} access was updated.`,
      );
      setKind("success");
      await load(selected.id, true);
    } catch (saveError) {
      setMessage(
        saveError instanceof Error
          ? saveError.message
          : "The chapter access policy could not be saved.",
      );
      setKind("error");
    } finally {
      setBusy(false);
    }
  }

  function moveChapterPage(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= pages.length) return;
    setPages((current) => {
      const next = [...current];
      [next[index], next[destination]] = [
        next[destination]!,
        next[index]!,
      ];
      return next;
    });
  }

  async function setCommentPinned(
    comment: AdminChapterComment,
    pinned: boolean,
  ) {
    if (!selected) return;
    try {
      await fetch("/api/v1/discussion-pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commentId: comment.id, pinned }),
      }).then((response) => readJson(response));
      setMessage(pinned ? "Comment pinned." : "Comment unpinned.");
      setKind("success");
      await loadChapterDetail(selected.id);
    } catch (moderationError) {
      setMessage(
        moderationError instanceof Error
          ? moderationError.message
          : "The comment could not be updated.",
      );
      setKind("error");
    }
  }

  function removeComment(comment: AdminChapterComment) {
    if (!selected) return;
    setRemoveCommentTarget(comment);
  }

  async function executeCommentRemoval(comment: AdminChapterComment) {
    if (!selected) return;
    try {
      await fetch(
        `/api/v1/discussion-comments?id=${encodeURIComponent(comment.id)}`,
        { method: "DELETE" },
      ).then((response) => readJson(response));
      setMessage("Comment removed and the moderation action was audited.");
      setKind("success");
      await loadChapterDetail(selected.id);
    } catch (moderationError) {
      setMessage(
        moderationError instanceof Error
          ? moderationError.message
          : "The comment could not be removed.",
      );
      setKind("error");
    }
  }

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<LockKey size={18} />}
        breadcrumbs={["Catalog", "Chapters"]}
        kicker="Chapter operations"
        title="Chapters"
        description="Edit release metadata, publication, page order, access, price, and chapter moderation from one audited workspace."
        actions={
          <button type="button" onClick={() => void load(selectedId)}>
            <ArrowClockwise size={17} /> Refresh
          </button>
        }
      />
      <div className="chapter-access-metrics">
        {[
          ["Chapters", counts.all],
          ["Paid chapters", counts.paid],
          ["Reader unlocks", counts.unlocked],
        ].map(([label, value]) => (
          <article key={String(label)}>
            <span>{label}</span>
            <strong>{Number(value).toLocaleString("en-US")}</strong>
          </article>
        ))}
      </div>
      <div className="chapter-access-toolbar">
        <label>
          <MagnifyingGlass size={17} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search series or chapter"
          />
        </label>
        <div role="group" aria-label="Chapter access filter">
          {(["ALL", "PAID", "FREE"] as const).map((value) => (
            <button
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              key={value}
            >
              {humanize(value)}
            </button>
          ))}
        </div>
      </div>
      {metrics.total > chapters.length ? (
        <p className="chapter-access-result-note">
          Showing the {chapters.length.toLocaleString("en-US")} most recently updated
          chapters of {metrics.total.toLocaleString("en-US")} total records.
        </p>
      ) : null}
      {loading ? (
        <LoadingPanel />
      ) : chapters.length ? (
        <div className="chapter-access-manager">
          <div className="chapter-access-list" role="listbox" aria-label="Chapters">
            {visible.length ? (
              visible.map((chapter) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={chapter.id === selectedId}
                  className={chapter.id === selectedId ? "active" : ""}
                  onClick={() => selectChapter(chapter)}
                  key={chapter.id}
                >
                  <span
                    className={`chapter-access-icon access-${chapter.effectiveAccessType.toLowerCase()}`}
                  >
                    {chapter.effectiveAccessType === "FREE" ? (
                      <Check size={17} />
                    ) : (
                      <LockKey size={17} />
                    )}
                  </span>
                  <span>
                    <strong>{chapter.seriesTitle}</strong>
                    <small>
                      Chapter {chapter.chapterNumber}
                      {chapter.title ? ` · ${chapter.title}` : ""}
                      {" · "}
                      {chapter.teamName ?? "Independent release"} · v
                      {chapter.version}
                    </small>
                  </span>
                  <span>
                    <small>
                      {chapter.effectiveAccessType === "FREE" ? "Free" : "Paid"}
                    </small>
                    <small>{humanize(chapter.state)}</small>
                  </span>
                </button>
              ))
            ) : (
              <EmptyPanel
                title="No chapters match"
                body="Change the filter or search term."
              />
            )}
          </div>
          {selected ? (
            <form className="chapter-access-editor" onSubmit={save}>
              <div className="control-section-heading">
                <div>
                  <span>Selected chapter</span>
                  <h3>
                    {selected.seriesTitle} · Chapter {selected.chapterNumber}
                  </h3>
                </div>
                <span className={`control-status status-${selected.state.toLowerCase()}`}>
                  {humanize(selected.state)}
                </span>
              </div>
              <div className="chapter-access-context">
                <span>{selected.pageCount} pages</span>
                <span>{selected.entitlementCount} reader unlocks</span>
                <span>
                  {selected.publishedAt
                    ? `Published ${formatDate(selected.publishedAt)}`
                    : "Not published"}
                </span>
              </div>
              <section className="chapter-editor-section">
                <div className="chapter-editor-heading">
                  <div>
                    <span>Release metadata</span>
                    <h4>Chapter information</h4>
                  </div>
                  <a
                    href={`/title/${selected.seriesSlug}/chapter/${selected.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open reader <ArrowRight size={14} />
                  </a>
                </div>
                <div className="chapter-editor-grid">
                  <label>
                    <span>Chapter number</span>
                    <input
                      value={form.chapterNumber}
                      maxLength={40}
                      required
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          chapterNumber: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Volume</span>
                    <input
                      value={form.volume}
                      maxLength={40}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          volume: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="chapter-editor-wide">
                    <span>Chapter title</span>
                    <input
                      value={form.title}
                      maxLength={240}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Language</span>
                    <input
                      value={form.language}
                      maxLength={20}
                      required
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          language: event.target.value.toLowerCase(),
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Version</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={form.version}
                      required
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          version: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label className="chapter-editor-wide">
                    <span>Reader format</span>
                    <select
                      value={form.format}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          format: event.target.value as AdminChapter["format"],
                        }))
                      }
                    >
                      <option value="VERTICAL">Vertical / manhwa</option>
                      <option value="PAGED">Paged / manga</option>
                    </select>
                  </label>
                  <label className="chapter-editor-wide">
                    <span>Release notes</span>
                    <textarea
                      value={form.releaseNotes}
                      maxLength={2000}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          releaseNotes: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </section>
              <section className="chapter-editor-section">
                <div className="chapter-editor-heading">
                  <div>
                    <span>Visibility &amp; schedule</span>
                    <h4>Publication</h4>
                  </div>
                </div>
                <div className="chapter-editor-grid">
                  <label>
                    <span>Publication state</span>
                    <select
                      value={form.state}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          state: event.target.value as AdminChapter["state"],
                        }))
                      }
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="READY_FOR_REVIEW">Ready for review</option>
                      <option value="PUBLISHED">Published</option>
                    </select>
                  </label>
                  <label>
                    <span>Release date</span>
                    <input
                      type="datetime-local"
                      value={form.publishedAt}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          publishedAt: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </section>
              <section className="chapter-editor-section">
                <div className="chapter-editor-heading">
                  <div>
                    <span>Reader entitlement</span>
                    <h4>Access &amp; price</h4>
                  </div>
                </div>
                <div className="chapter-editor-grid">
                  <label>
                    <span>Reader access</span>
                    <select
                      value={form.accessType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          accessType: event.target
                            .value as AdminChapter["accessType"],
                        }))
                      }
                    >
                      <option value="FREE">Free</option>
                      <option value="PAID">Paid</option>
                    </select>
                  </label>
                  {form.accessType === "PAID" ? (
                    <label>
                      <span>{commercial.economy.coinPlural} price</span>
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        value={form.priceOnyx}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            priceOnyx: Number(event.target.value),
                          }))
                        }
                        required
                      />
                    </label>
                  ) : null}
                </div>
              </section>
              <section className="chapter-editor-section">
                <div className="chapter-editor-heading">
                  <div>
                    <span>Reader assets</span>
                    <h4>Pages &amp; order</h4>
                  </div>
                  <a
                    href={`/onyx/admin/access/series/${encodeURIComponent(selected.seriesId)}/chapters/${encodeURIComponent(selected.id)}`}
                  >
                    Manage pages <ArrowRight size={14} />
                  </a>
                </div>
                {detailLoading ? (
                  <div className="chapter-detail-loading">
                    Loading chapter assets…
                  </div>
                ) : pages.length ? (
                  <div className="chapter-page-order">
                    {pages.map((chapterPage, index) => (
                      <article key={chapterPage.id}>
                        <img
                          src={`/api/v1/chapter-page?id=${encodeURIComponent(chapterPage.id)}`}
                          alt={`Page ${index + 1} preview`}
                          width={64}
                          height={92}
                          loading="lazy"
                        />
                        <div>
                          <strong>Page {index + 1}</strong>
                          <span>
                            {chapterPage.width} × {chapterPage.height} ·{" "}
                            {humanize(chapterPage.processingStatus)}
                          </span>
                        </div>
                        <div>
                          <button
                            type="button"
                            disabled={index === 0}
                            aria-label={`Move page ${index + 1} up`}
                            onClick={() => moveChapterPage(index, -1)}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            disabled={index === pages.length - 1}
                            aria-label={`Move page ${index + 1} down`}
                            onClick={() => moveChapterPage(index, 1)}
                          >
                            <ArrowDown size={15} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="chapter-detail-empty">
                    No verified pages are attached to this release.
                  </div>
                )}
              </section>
              <section className="chapter-editor-section">
                <div className="chapter-editor-heading">
                  <div>
                    <span>Community</span>
                    <h4>Chapter comments &amp; moderation</h4>
                  </div>
                  <a
                    href={`/title/${selected.seriesSlug}/chapter/${selected.slug}#comments`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open discussion <ChatCircle size={14} />
                  </a>
                </div>
                {comments.length ? (
                  <div className="chapter-comment-moderation">
                    {comments.map((comment) => (
                      <article key={comment.id}>
                        <div>
                          <strong>
                            {comment.authorName}
                            {comment.pinnedAt ? " · Pinned" : ""}
                          </strong>
                          <span>
                            {comment.openReports
                              ? `${comment.openReports} open report${comment.openReports === 1 ? "" : "s"}`
                              : formatDate(comment.createdAt)}
                          </span>
                          <p>{comment.body}</p>
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              void setCommentPinned(
                                comment,
                                !comment.pinnedAt,
                              )
                            }
                          >
                            <ShieldCheck size={15} />
                            {comment.pinnedAt ? "Unpin" : "Pin"}
                          </button>
                          <button
                            className="is-danger"
                            type="button"
                            onClick={() => void removeComment(comment)}
                          >
                            <X size={15} /> Remove
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="chapter-detail-empty">
                    No visible top-level comments need review.
                  </div>
                )}
              </section>
              <label>
                <span>Reason for audit log</span>
                <textarea
                  value={form.reason}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))
                  }
                  minLength={6}
                  maxLength={500}
                  placeholder="Example: Updated chapter access and price"
                  required
                />
              </label>
              <div className="chapter-access-note">
                <ShieldCheck size={18} />
                <span>
                  Reader pages remain hidden until the server confirms free
                  access, an active entitlement, or administrator preview.
                </span>
              </div>
              <div className="admin-sticky-actions chapter-access-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={busy}
                >
                  <LockKey size={17} />
                  {busy ? "Saving chapter…" : "Save chapter changes"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : (
        <EmptyPanel
          title="No chapters yet"
          body="Create or upload a chapter, then configure its reader access here."
        />
      )}
      {message ? <PanelMessage kind={kind}>{message}</PanelMessage> : null}
      <ConfirmActionDialog
        open={Boolean(removeCommentTarget)}
        title="Remove this chapter comment?"
        description={`${removeCommentTarget?.authorName ?? "This reader"}'s comment will be removed from the chapter and the moderation action will be audited.`}
        confirmLabel="Remove comment"
        destructive
        busy={busy}
        onCancel={() => {
          if (!busy) setRemoveCommentTarget(null);
        }}
        onConfirm={() => {
          const comment = removeCommentTarget;
          setRemoveCommentTarget(null);
          if (comment) void executeCommentRemoval(comment);
        }}
      />
    </section>
  );
}

function AnalyticsPanel({
  onNavigate,
  actorRole,
}: {
  onNavigate: (section: string, subsection?: string) => void;
  actorRole: string;
}) {
  const { settings: commercial } = useCommercialSettings();
  const [range, setRange] = useState<AnalyticsData["range"]>("24h");
  const [customEnd, setCustomEnd] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [customStart, setCustomStart] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  });
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [region, setRegion] = useState("ALL");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [overview, setOverview] = useState<AdminSummary | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [overviewError, setOverviewError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/v1/admin/summary", {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => readJson<AdminSummary>(response)),
      fetch("/api/v1/health", {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => readJson<HealthData>(response)),
    ])
      .then(([nextOverview, nextHealth]) => {
        setOverview(nextOverview);
        setHealth(nextHealth);
        setOverviewError("");
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== "AbortError") {
          setOverviewError(
            reason instanceof Error
              ? reason.message
              : "Dashboard service checks could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function load() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const rangeQuery =
          range === "custom"
            ? `range=custom&start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}`
            : `range=${range}`;
        const query = `${rangeQuery}&region=${encodeURIComponent(region)}`;
        const payload = await fetch(
          `/api/v1/admin/analytics?${query}`,
          { signal: controller.signal, cache: "no-store" },
        ).then((response) => readJson<AnalyticsData>(response));
        setData(payload);
        setError("");
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Analytics could not be loaded.",
          );
        }
      } finally {
        running = false;
      }
    }
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [customEnd, customStart, range, refreshKey, region]);

  const expectedRegion =
    region.trim().toUpperCase() === "UNKNOWN"
      ? "Unknown"
      : region.trim().toUpperCase();
  const activeData =
    data?.range === range && data.selectedRegion === expectedRegion
      ? data
      : null;
  const timeline = activeData?.timeline ?? [];
  const chartMaximum = Math.max(
    1,
    ...timeline.flatMap((point) => [point.views, point.chapterStarts]),
  );
  const chartWidth = 720;
  const chartHeight = 230;
  const left = 42;
  const right = 16;
  const top = 20;
  const bottom = 36;
  const plotWidth = chartWidth - left - right;
  const plotHeight = chartHeight - top - bottom;
  const linePoints = (key: "views" | "chapterStarts") =>
    timeline
      .map((point, index) => {
        const x =
          left +
          (timeline.length > 1
            ? (index / (timeline.length - 1)) * plotWidth
            : plotWidth / 2);
        const y = top + plotHeight - (point[key] / chartMaximum) * plotHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const labelIndexes = timeline.length
    ? [0, Math.floor((timeline.length - 1) / 2), timeline.length - 1]
    : [];
  const topSeriesMaximum = Math.max(
    1,
    ...(activeData?.topSeries ?? []).map(
      (series) => series.seriesViews + series.chapterStarts,
    ),
  );
  const comparison = (current: number, previous: number) => {
    if (!previous) return current ? "New activity vs no activity in the prior period" : "No change from the prior period";
    const delta = Math.round(((current - previous) / previous) * 100);
    return `${delta >= 0 ? "+" : ""}${delta}% vs previous period`;
  };
  const regionOptions = useMemo(
    () => [
      { value: "ALL", label: "All countries" },
      ...(data?.regions ?? []).map((entry) => ({
        value: entry.regionCode,
        label: entry.regionCode,
        description: `${entry.views.toLocaleString()} views`,
      })),
    ],
    [data?.regions],
  );

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<Pulse size={18} />}
        breadcrumbs={["Dashboard", "Home"]}
        kicker="Live Control Room"
        title="Home"
        description="Real platform activity, publishing workload, service checks, quick actions, and recent administrator actions."
        actions={
          <>
            <span className="analytics-updated">
              <i className={error ? "is-stale" : ""} />
              {activeData
                ? `Updated ${formatDate(activeData.generatedAt)}`
                : "Connecting to live data"}
            </span>
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              <ArrowClockwise size={17} /> Refresh
            </button>
          </>
        }
      />
      {overviewError ? (
        <PanelMessage kind="error">{overviewError}</PanelMessage>
      ) : null}
      {overview ? (
        <>
          <div className="control-metrics" aria-label="Platform snapshot">
            {([
              { label: "Registered users", value: overview.metrics.users, detail: "Accounts in D1", icon: <UsersThree size={21} /> },
              { label: "Series", value: overview.metrics.series, detail: "Draft and published", icon: <Books size={21} /> },
              { label: "Review queue", value: overview.metrics.reviewQueue, detail: `${overview.metrics.processingUploads} imports processing`, icon: <CheckCircle size={21} /> },
              { label: "Open reports", value: overview.metrics.openReports, detail: `${overview.metrics.visibleComments} visible comments`, icon: <ShieldWarning size={21} /> },
            ] as Array<{ label: string; value: number; detail: string; icon: ReactNode }>).map((card) => (
              <article key={card.label}>
                {card.icon}
                <span>{card.label}</span>
                <strong>{card.value.toLocaleString("en-US")}</strong>
                <small>{card.detail}</small>
              </article>
            ))}
          </div>
          <div className="control-overview-grid">
            <section className="control-quick-actions">
              <div>
                <span>Quick actions</span>
                <h3>Common operational tasks</h3>
              </div>
              {[
                {
                  label: "Upload chapters",
                  destination: "Chapters",
                  subsection: "single",
                  icon: CloudArrowUp,
                },
                {
                  label: "Edit existing series",
                  destination: "Series",
                  icon: Books,
                },
                {
                  label: "Control teams",
                  destination: "Directory",
                  icon: UsersThree,
                },
                {
                  label: "Review support tickets",
                  destination: "Support Tickets",
                  icon: ChatCircle,
                },
              ].map(({ label, destination, subsection, icon: Icon }) => (
                <button
                  type="button"
                  key={destination}
                  onClick={() => onNavigate(destination, subsection)}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </section>
            <section className="control-health-card">
              <div>
                <span>Service checks</span>
                <strong>
                  {health?.status === "ok" ? "All connected" : "Needs attention"}
                </strong>
              </div>
              {[
                ["Database", health?.checks.database ?? "checking"],
                ["Private media", health?.checks.objectStorage ?? "checking"],
                ["Recorded storage", formatBytes(overview.metrics.storageBytes)],
                ["Readers active · 7 days", overview.metrics.activeReaders7d.toLocaleString("en-US")],
              ].map(([label, status]) => (
                <div key={label}>
                  <span>{label}</span>
                  <em className={["ok", "checking"].includes(status) ? "is-ok" : ""}>
                    {status}
                  </em>
                </div>
              ))}
            </section>
          </div>
          <section className="control-activity">
            <div className="control-section-heading">
              <div>
                <span>Audit trail</span>
                <h3>Recent administrator actions</h3>
              </div>
              {actorRole === "OWNER" ? (
                <button type="button" onClick={() => onNavigate("Audit log")}>
                  Open audit log <ArrowRight size={16} />
                </button>
              ) : (
                <span className="control-status status-ready">Owner-only detail</span>
              )}
            </div>
            {overview.activity.length ? (
              overview.activity.map((entry) => (
                <article key={entry.id}>
                  <span><Check size={15} /></span>
                  <div>
                    <strong>{humanize(entry.action)}</strong>
                    <small>
                      {entry.actorName ?? "System"} · {entry.targetType} · {formatDate(entry.createdAt)}
                    </small>
                  </div>
                </article>
              ))
            ) : (
              <EmptyPanel
                title="No administrator actions yet"
                body="Administrative changes will appear here after they are audited."
              />
            )}
          </section>
        </>
      ) : null}
      <div className="analytics-range-tabs" role="group" aria-label="Analytics range">
        {[
          ["24h", "Day"],
          ["7d", "Week"],
          ["30d", "Month"],
          ["custom", "Custom"],
        ].map(([value, label]) => (
          <button
            type="button"
            className={range === value ? "active" : ""}
            aria-pressed={range === value}
            onClick={() => setRange(value as AnalyticsData["range"])}
            key={value}
          >
            {label}
          </button>
        ))}
        <label className="analytics-region-filter">
          <span>Country</span>
          <AdminCombobox
            ariaLabel="Filter dashboard analytics by country"
            value={region}
            options={regionOptions}
            placeholder="Search countries…"
            onChange={setRegion}
          />
        </label>
      </div>
      {range === "custom" ? (
        <div className="analytics-custom-range">
          <label>
            <span>Start date</span>
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(event) => setCustomStart(event.target.value)}
            />
          </label>
          <label>
            <span>End date</span>
            <input
              type="date"
              value={customEnd}
              min={customStart}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      {error ? (
        <PanelMessage kind="error">
          {`${error} Existing figures remain visible until the next successful refresh.`}
        </PanelMessage>
      ) : null}
      {!activeData ? (
        <LoadingPanel />
      ) : (
        <>
          <div className="analytics-facts analytics-live-facts">
            {[
              [
                "Active now",
                activeData.summary.activeSessions5m,
                "Distinct sessions in the last 5 minutes",
              ],
              [
                "Unique sessions",
                activeData.summary.uniqueSessions,
                `${activeData.summary.uniqueVisitors.toLocaleString("en-US")} persistent visitors in the selected ${range} range`,
              ],
              [
                "Page views",
                activeData.summary.views,
                comparison(activeData.summary.views, activeData.previousSummary.views),
              ],
              [
                "Chapter starts",
                activeData.summary.chapterStarts,
                `${activeData.summary.chapterCompletions.toLocaleString("en-US")} completions`,
              ],
              [
                "Completion rate",
                `${activeData.summary.completionRatePct}%`,
                "Completions divided by chapter starts",
              ],
              [
                "Chapter unlocks",
                activeData.summary.unlocks,
                `${coinLabel(activeData.summary.onyxSpent, commercial)} spent`,
              ],
              [
                "New users",
                activeData.summary.newUsers,
                `${comparison(activeData.summary.newUsers, activeData.previousSummary.newUsers)} · ${activeData.summary.registeredUsers.toLocaleString("en-US")} registered total`,
              ],
              [
                "New visitors",
                activeData.summary.newVisitors,
                "Privacy-safe browsers first seen in this period",
              ],
              [
                "Shards collected",
                activeData.summary.shardsCollected,
                `${activeData.summary.shardsSpent.toLocaleString("en-US")} spent · ${activeData.summary.shardsOutstanding.toLocaleString("en-US")} outstanding`,
              ],
              [
                "Store purchases",
                activeData.summary.storePurchases,
                "Database-confirmed cosmetic purchases",
              ],
              [
                "Community activity",
                activeData.summary.comments + activeData.summary.reactions,
                `${activeData.summary.comments} comments · ${activeData.summary.reactions} reactions · ${comparison(activeData.summary.comments + activeData.summary.reactions, activeData.previousSummary.comments + activeData.previousSummary.reactions)}`,
              ],
              [
                "New uploads",
                activeData.summary.newSeries + activeData.summary.newChapters,
                `${activeData.summary.newSeries} series · ${activeData.summary.newChapters} chapters · ${activeData.summary.uploadSessions} source files`,
              ],
              [
                "Team growth",
                activeData.summary.newTeams,
                comparison(activeData.summary.newTeams, activeData.previousSummary.newTeams),
              ],
            ].map(([label, value, detail]) => (
              <article key={String(label)}>
                <span>{String(label)}</span>
                <strong>
                  {typeof value === "number" ? value.toLocaleString("en-US") : value}
                </strong>
                <small>{String(detail)}</small>
              </article>
            ))}
          </div>
          {activeData.regionScope ? (
            <p className="analytics-scope-note" role="note">
              Country filter <strong>{activeData.regionScope.region}</strong>{" "}
              applies to visit, reader, timeline, chapter, and series activity.
              Account, community, purchase, and economy totals remain global
              because those canonical records do not store a visitor country.
            </p>
          ) : null}
          <section className="analytics-chart-card">
            <div className="control-section-heading">
              <div>
                <span>Activity over time · UTC</span>
                <h3>Views and chapter starts</h3>
              </div>
              <div className="analytics-legend">
                <span><i className="views" /> Views</span>
                <span><i className="starts" /> Chapter starts</span>
              </div>
            </div>
            <div
              className="analytics-chart-scroll"
              role="region"
              aria-label="Scrollable activity chart"
              tabIndex={0}
            >
              <svg
                className="analytics-line-chart"
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                role="img"
                aria-label="Line chart of page views and chapter starts"
              >
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = top + plotHeight - ratio * plotHeight;
                return (
                  <g key={ratio}>
                    <line x1={left} x2={chartWidth - right} y1={y} y2={y} />
                    <text x={left - 8} y={y + 3}>
                      {Math.round(chartMaximum * ratio)}
                    </text>
                  </g>
                );
              })}
              <polyline className="views-line" points={linePoints("views")} />
              <polyline
                className="starts-line"
                points={linePoints("chapterStarts")}
              />
              {timeline.map((point, index) => {
                const x =
                  left +
                  (timeline.length > 1
                    ? (index / (timeline.length - 1)) * plotWidth
                    : plotWidth / 2);
                const viewsY =
                  top +
                  plotHeight -
                  (point.views / chartMaximum) * plotHeight;
                const startsY =
                  top +
                  plotHeight -
                  (point.chapterStarts / chartMaximum) * plotHeight;
                return (
                  <g key={`${point.bucket}:${index}`}>
                    <circle
                      className="views-point"
                      cx={x}
                      cy={viewsY}
                      r={3.5}
                    >
                      <title>
                        {point.bucket}: {point.views} views
                      </title>
                    </circle>
                    <circle
                      className="starts-point"
                      cx={x}
                      cy={startsY}
                      r={3.5}
                    >
                      <title>
                        {point.bucket}: {point.chapterStarts} chapter starts
                      </title>
                    </circle>
                  </g>
                );
              })}
              {labelIndexes.map((index) => {
                const point = timeline[index]!;
                const x =
                  left +
                  (timeline.length > 1
                    ? (index / (timeline.length - 1)) * plotWidth
                    : plotWidth / 2);
                const label =
                  range === "24h"
                    ? `${point.bucket.slice(11, 13)}:00`
                    : point.bucket.slice(5);
                return (
                  <text className="axis-label" x={x} y={chartHeight - 9} key={index}>
                    {label}
                  </text>
                );
              })}
              </svg>
            </div>
            <details className="analytics-data-fallback">
              <summary>View chart data</summary>
              <div>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">UTC period</th>
                      <th scope="col">Views</th>
                      <th scope="col">Chapter starts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((point) => (
                      <tr key={point.bucket}>
                        <th scope="row">{point.bucket.replace("T", " ")}</th>
                        <td>{point.views}</td>
                        <td>{point.chapterStarts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <div className="analytics-detail-grid">
            <section className="analytics-ranking">
              <div className="control-section-heading">
                <div>
                  <span>Reader interest</span>
                  <h3>Top series</h3>
                </div>
              </div>
              {activeData.topSeries.length ? (
                activeData.topSeries.map((series, index) => {
                  const total = series.seriesViews + series.chapterStarts;
                  return (
                    <article key={series.slug}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <div>
                        <span>
                          <strong>{series.title}</strong>
                          <small>
                            {series.chapterStarts} starts ·{" "}
                            {series.chapterCompletions} completions
                          </small>
                        </span>
                        <i>
                          <span
                            style={{
                              width: `${Math.max(3, (total / topSeriesMaximum) * 100)}%`,
                            }}
                          />
                        </i>
                      </div>
                      <em>{total}</em>
                    </article>
                  );
                })
              ) : (
                <EmptyPanel
                  title="No series activity yet"
                  body="Reader views will rank here as traffic arrives."
                />
              )}
            </section>
            <section className="analytics-live-feed">
              <div className="control-section-heading">
                <div>
                  <span>Last 10 minutes</span>
                  <h3>Live activity</h3>
                </div>
              </div>
              {activeData.liveEvents.length ? (
                activeData.liveEvents.map((event, index) => (
                  <article
                    key={`${event.createdAt}:${event.eventType}:${index}`}
                  >
                    <span><Pulse size={15} /></span>
                    <div>
                      <strong>{humanize(event.eventType)}</strong>
                      <small>
                        {event.seriesSlug
                          ? event.seriesSlug.replaceAll("-", " ")
                          : "NyaScans"}
                        {event.chapterSlug
                          ? ` · ${event.chapterSlug.replaceAll("-", " ")}`
                          : ""}
                      </small>
                    </div>
                    <time>{formatDate(event.createdAt)}</time>
                  </article>
                ))
              ) : (
                <EmptyPanel
                  title="Quiet right now"
                  body="New page and chapter activity appears here within seconds."
                />
              )}
            </section>
          </div>
          <div className="analytics-detail-grid analytics-audience-grid">
            <section className="analytics-ranking">
              <div className="control-section-heading">
                <div>
                  <span>Chapter performance</span>
                  <h3>Most viewed chapters</h3>
                </div>
              </div>
              {activeData.topChapters.length ? (
                activeData.topChapters.map((chapter, index) => (
                  <article
                    key={`${chapter.seriesSlug}:${chapter.chapterSlug}`}
                  >
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <div>
                      <span>
                        <strong>{chapter.seriesTitle}</strong>
                        <small>
                          Chapter {chapter.chapterNumber} ·{" "}
                          {chapter.uniqueViewers} unique viewers
                        </small>
                      </span>
                    </div>
                    <em>{chapter.views}</em>
                  </article>
                ))
              ) : (
                <EmptyPanel
                  title="No chapter views yet"
                  body="Chapter starts will rank here for the selected period."
                />
              )}
            </section>
            <section className="analytics-region-list">
              <div className="control-section-heading">
                <div>
                  <span>Privacy-safe country data</span>
                  <h3>Viewer regions</h3>
                </div>
              </div>
              {activeData.regions.length ? (
                activeData.regions.map((region) => (
                  <article key={region.regionCode}>
                    <strong>{region.regionCode}</strong>
                    <span>{region.uniqueViewers} viewers</span>
                    <em>{region.views.toLocaleString("en-US")} views</em>
                  </article>
                ))
              ) : (
                <EmptyPanel
                  title="No regional data yet"
                  body="Country-level data appears here without storing IP addresses."
                />
              )}
              {activeData.purchasesByCurrency.length ? (
                <div className="analytics-purchase-breakdown">
                  <h4>Orders by currency</h4>
                  {activeData.purchasesByCurrency.map((purchase) => (
                    <p key={`${purchase.currency}:${purchase.provider}`}>
                      <span>
                        {purchase.currency} · {purchase.provider}
                        {purchase.isTest ? " (test)" : ""}
                      </span>
                      <strong>
                        {purchase.orders} ·{" "}
                        {(purchase.totalMinor / 100).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                        })}
                      </strong>
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
          <div className="analytics-detail-grid analytics-decision-grid">
            <section className="analytics-ranking">
              <div className="control-section-heading">
                <div>
                  <span>Purchase decisions</span>
                  <h3>Series ranked by chapter purchases</h3>
                </div>
              </div>
              {activeData.purchaseRankedSeries.length ? (
                activeData.purchaseRankedSeries.map((series, index) => (
                  <article key={series.id}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <div>
                      <span>
                        <strong>{series.title}</strong>
                        <small>
                          {coinLabel(series.pawCoinsSpent, commercial)} spent
                        </small>
                      </span>
                    </div>
                    <em>{series.purchases}</em>
                  </article>
                ))
              ) : (
                <EmptyPanel
                  title="No chapter purchases yet"
                  body="Paid chapter decisions will rank series here."
                />
              )}
            </section>
            <section className="analytics-ranking">
              <div className="control-section-heading">
                <div>
                  <span>Community & economy</span>
                  <h3>Top users</h3>
                </div>
              </div>
              {activeData.topUsers.length ? (
                activeData.topUsers.map((user, index) => (
                  <article key={user.id}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <div>
                      <span>
                        <strong>{user.displayName}</strong>
                        <small>
                          {user.comments} comments · {user.spins} spins
                        </small>
                      </span>
                    </div>
                    <em>{user.purchases} buys</em>
                  </article>
                ))
              ) : (
                <EmptyPanel
                  title="No ranked users yet"
                  body="Comments, spins, and purchases appear here as activity arrives."
                />
              )}
            </section>
          </div>
          <div className="analytics-integrity-strip">
            <span>
              <ChatCircle size={16} />
              {activeData.summary.comments.toLocaleString("en-US")} comments
            </span>
            <span>
              <Coins size={16} />
              {coinLabel(activeData.summary.onyxSpent, commercial)} spent
            </span>
            <span>
              <CheckCircle size={16} />
              {activeData.summary.paidOrders.toLocaleString("en-US")} paid
              orders · monetary totals stay separated by currency above
            </span>
            <small>
              Checkout totals are labeled test data and are not reported as
              production revenue.
            </small>
          </div>
        </>
      )}
    </section>
  );
}

function SecurityPanel() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [mfa, setMfa] = useState<{ enrolled: boolean; verified: boolean; expiresAt: string | null } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/v1/health")
      .then((response) => readJson<HealthData>(response))
      .then(setHealth)
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Service checks could not be loaded.",
        ),
      );
  }, []);
  useEffect(() => {
    void fetch("/api/v1/admin-mfa", { cache: "no-store" })
      .then((response) => readJson<{ data: { enrolled: boolean; verified: boolean; expiresAt: string | null } }>(response))
      .then((payload) => setMfa(payload.data))
      .catch(() => undefined);
  }, []);

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<LockKey size={18} />}
        breadcrumbs={["Settings", "Security"]}
        kicker="Security posture"
        title="Security"
        description="Visible controls reflect protections that are actually implemented. Launch requirements that still need an operator remain clearly marked."
      />
      {error ? <PanelMessage kind="error">{error}</PanelMessage> : null}
      <div className="security-grid">
        <section>
          <div className="control-section-heading">
            <div>
              <span>Current protections</span>
              <h3>Enforced now</h3>
            </div>
          </div>
          {[
            [
              "Mandatory authenticator 2FA",
              mfa?.verified
                ? `This administrator session is TOTP-verified and expires ${mfa.expiresAt ? new Date(mfa.expiresAt).toLocaleString() : "within one hour"}.`
                : "Administrator routes require a confirmed TOTP authenticator and a short-lived, device-bound session.",
              Boolean(mfa?.enrolled && mfa?.verified),
            ],
            [
              "Attempt limits and sign-in alerts",
              "TOTP failures are limited per account and device fingerprint. A successful sign-in from a new device or network creates a security notification.",
              true,
            ],
            [
              "Server-side roles",
              "Administrator access combines server-side roles, editable capability overrides, non-delegable Owner controls, and MFA assurance.",
              true,
            ],
            [
              "Private originals",
              "Chapter sources and comment attachments use private object storage.",
              health?.checks.objectStorage === "ok",
            ],
            [
              "File signature checks",
              "Covers and direct chapter pages are checked from their bytes, not only their extension. Archive imports remain unavailable until bounded extraction is configured.",
              true,
            ],
            [
              "Audited changes",
              "Series, team, user-access, settings, and upload actions create traceable audit records.",
              true,
            ],
          ].map(([title, body, ok]) => (
            <article key={String(title)}>
              <span className={ok ? "security-ok" : "security-warn"}>
                {ok ? <Check size={16} /> : <WarningCircle size={16} />}
              </span>
              <div>
                <strong>{String(title)}</strong>
                <p>{String(body)}</p>
              </div>
            </article>
          ))}
        </section>
        <section>
          <div className="control-section-heading">
            <div>
              <span>Before public launch</span>
              <h3>Operator checklist</h3>
            </div>
          </div>
          {[
            "Connect malware scanning and archive bomb detection.",
            "Verify backups and perform a restore drill for D1 and media.",
            "Configure alerts for failed imports, moderation risk, and rights expiry.",
            "Complete legal, payment-provider, and regional compliance checks.",
          ].map((item) => (
            <div className="security-operator-item" key={item}>
              <WarningCircle size={17} aria-hidden="true" />
              <span>{item}</span>
            </div>
          ))}
        </section>
      </div>
      <div className="service-check-strip">
        <span>
          <Database size={18} /> Database
          <strong>{health?.checks.database ?? "Checking"}</strong>
        </span>
        <span>
          <HardDrives size={18} /> Private media
          <strong>{health?.checks.objectStorage ?? "Checking"}</strong>
        </span>
        <span>
          <Pulse size={18} /> Edge service
          <strong>{health?.status ?? "Checking"}</strong>
        </span>
      </div>
    </section>
  );
}

function ActivityLogWorkspace({
  subsection,
  actorRole,
  actorRoles,
  capabilities,
  onNavigate,
}: {
  subsection?: string;
  actorRole: string;
  actorRoles: string[];
  capabilities: readonly string[];
  onNavigate: PanelProps["onNavigate"];
}) {
  const ownerActor = actorRole === "OWNER" || actorRoles.includes("OWNER");
  const canViewTechnicalAudit =
    ownerActor && capabilities.includes("admin.audit.read");
  const activeView =
    subsection === "technical" && canViewTechnicalAudit
      ? "technical"
      : "readable";

  return (
    <AdminPageScaffold
      breadcrumbs={["Administration", "Activity Log"]}
      kicker="Operations record"
      title="Activity Log"
      description="Switch between a readable operational timeline and the owner-only technical audit record without leaving this page."
    >
      <div
        className="admin-subnav"
        role="tablist"
        aria-label="Activity Log view"
      >
        <button
          id="activity-log-readable-tab"
          type="button"
          role="tab"
          aria-controls="activity-log-readable-panel"
          aria-selected={activeView === "readable"}
          onClick={() => onNavigate("activity-log", "readable")}
        >
          Readable
        </button>
        <button
          id="activity-log-technical-tab"
          type="button"
          role="tab"
          aria-controls="activity-log-technical-panel"
          aria-selected={activeView === "technical"}
          disabled={!canViewTechnicalAudit}
          title={
            canViewTechnicalAudit
              ? "Open immutable technical audit events"
              : "Technical audit events require Owner access"
          }
          onClick={() => onNavigate("activity-log", "technical")}
        >
          Technical
        </button>
      </div>
      <div
        id={`activity-log-${activeView}-panel`}
        role="tabpanel"
        aria-labelledby={`activity-log-${activeView}-tab`}
      >
        {activeView === "technical" ? (
          <OwnerAuditLogPanel
            actorRole="OWNER"
            embedded
            displayTitle="Activity Log"
          />
        ) : (
          <UsersControlPanel
            view="activity"
            actorRoles={actorRoles}
            embedded
          />
        )}
      </div>
    </AdminPageScaffold>
  );
}

// Kept for compatibility with older embedded audit views; the owner route
// uses the normalized read-only audit workspace.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AuditLogPanel() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    try {
      const payload = await fetch("/api/v1/admin/audit").then((response) =>
        readJson<{ data: AuditRecord[] }>(response),
      );
      setRecords(payload.data ?? []);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Audit history could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const visible = records.filter((record) =>
    `${record.action} ${record.targetType} ${record.targetId} ${record.actorName ?? ""} ${record.actorEmail ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<FileText size={18} />}
        kicker="Accountability"
        title="Audit log"
        description="Immutable operational history for administrator and publishing changes. Request IDs make support investigations traceable."
        actions={
          <label className="control-search">
            <MagnifyingGlass size={17} />
            <span className="sr-only">Search audit log</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search action, actor, or target"
            />
          </label>
        }
      />
      {error ? <PanelMessage kind="error">{error}</PanelMessage> : null}
      {loading ? (
        <LoadingPanel />
      ) : visible.length ? (
        <div className="audit-list">
          {visible.map((record) => (
            <article key={record.id}>
              <span>
                <Check size={15} />
              </span>
              <div>
                <strong>{humanize(record.action)}</strong>
                <small>
                  {record.actorName ?? "System"} · {record.actorEmail ?? "no email"}
                </small>
              </div>
              <div>
                <strong>{record.targetType}</strong>
                <small>{record.targetId}</small>
              </div>
              <time>{formatDate(record.createdAt)}</time>
              <code title={record.requestId}>{record.requestId.slice(0, 12)}</code>
            </article>
          ))}
        </div>
      ) : (
        <EmptyPanel
          title="No audit records match"
          body="Change the search or perform a managed administrator action."
        />
      )}
    </section>
  );
}

type CommentModerationAction =
  | "EDIT"
  | "HIDE"
  | "RESTORE"
  | "DELETE"
  | "PIN"
  | "UNPIN"
  | "BAN_SERIES"
  | "UNBAN_SERIES"
  | "SUSPEND_USER";

type PendingCommentModeration = {
  record: Record<string, unknown>;
  action: CommentModerationAction;
  reason: string;
};

function WorkspacePanel({
  section,
  onNavigate,
  canRequestSeries,
  embedded = false,
}: {
  section: string;
  onNavigate: (section: string) => void;
  canRequestSeries: boolean;
  embedded?: boolean;
}) {
  const endpoint = {
    Workspace: "overview",
    Series: "series",
    Comments: "comments",
    Analytics: "analytics",
    Rights: "rights",
    Settings: "settings",
  }[section] ?? "overview";
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState({
    defaultTeamId: "",
    defaultLanguage: "en",
    reviewNotifications: true,
    uploadNotifications: true,
  });
  const [saving, setSaving] = useState(false);
  const [commentSeries, setCommentSeries] = useState("");
  const [commentPage, setCommentPage] = useState(1);
  const [commentBusy, setCommentBusy] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(
    null,
  );
  const [editedCommentBody, setEditedCommentBody] = useState("");
  const [moderationPrompt, setModerationPrompt] =
    useState<PendingCommentModeration | null>(null);
  const [moderationConfirmation, setModerationConfirmation] =
    useState<PendingCommentModeration | null>(null);
  const [workspaceAnalyticsRange, setWorkspaceAnalyticsRange] = useState<
    "24h" | "7d" | "30d" | "custom"
  >("30d");
  const [workspaceAnalyticsEnd, setWorkspaceAnalyticsEnd] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [workspaceAnalyticsStart, setWorkspaceAnalyticsStart] = useState(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 29);
    return date.toISOString().slice(0, 10);
  });

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError("");
      }
    });
    const query =
      endpoint === "comments"
        ? `?series=${encodeURIComponent(commentSeries)}&page=${commentPage}`
        : endpoint === "analytics"
          ? workspaceAnalyticsRange === "custom"
            ? `?range=custom&start=${encodeURIComponent(workspaceAnalyticsStart)}&end=${encodeURIComponent(workspaceAnalyticsEnd)}`
            : `?range=${workspaceAnalyticsRange}`
          : "";
    void fetch(`/api/v1/workspace/${endpoint}${query}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = (await response.json()) as Record<string, unknown> & {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            result.error?.message ?? "Workspace data could not be loaded.",
          );
        }
        setPayload(result);
        if (endpoint === "settings" && result.data) {
          const data = result.data as typeof settings;
          setSettings({
            defaultTeamId: data.defaultTeamId ?? "",
            defaultLanguage: data.defaultLanguage ?? "en",
            reviewNotifications: data.reviewNotifications !== false,
            uploadNotifications: data.uploadNotifications !== false,
          });
        }
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Workspace data could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    commentPage,
    commentSeries,
    endpoint,
    revision,
    workspaceAnalyticsEnd,
    workspaceAnalyticsRange,
    workspaceAnalyticsStart,
  ]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/workspace/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...settings,
          defaultTeamId: settings.defaultTeamId || null,
        }),
      });
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          result.error?.message ?? "Workspace settings were not saved.",
        );
      }
      setRevision((value) => value + 1);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Workspace settings were not saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  function moderateComment(
    record: Record<string, unknown>,
    action: CommentModerationAction,
  ) {
    const needsReason = [
      "EDIT",
      "HIDE",
      "DELETE",
      "BAN_SERIES",
      "SUSPEND_USER",
    ].includes(action);
    const intent = { record, action, reason: "" };
    if (needsReason) {
      setModerationPrompt(intent);
      return;
    }
    void executeModeration(intent);
  }

  async function executeModeration(intent: PendingCommentModeration) {
    const { record, action, reason } = intent;
    const commentId = String(record.id);
    setCommentBusy(commentId);
    setError("");
    try {
      const response = await fetch("/api/v1/workspace/comment-moderation", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commentId,
          seriesSlug: commentSeries,
          expectedRevision: Number(record.revision),
          action,
          body: action === "EDIT" ? editedCommentBody : undefined,
          reason: reason || undefined,
        }),
      });
      const result = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          result.error?.message ?? "The moderation action failed.",
        );
      }
      setEditingCommentId(null);
      setEditedCommentBody("");
      setRevision((value) => value + 1);
    } catch (moderationError) {
      setError(
        moderationError instanceof Error
          ? moderationError.message
          : "The moderation action failed.",
      );
    } finally {
      setCommentBusy(null);
    }
  }

  const data = (payload?.data ?? []) as Array<Record<string, unknown>>;
  const recent = (payload?.recent ?? []) as Array<Record<string, unknown>>;
  const metrics = (payload?.metrics ?? {}) as Record<string, number>;
  const teams = (payload?.teams ?? []) as Array<Record<string, unknown>>;
  const commentSeriesOptions = (payload?.series ?? []) as Array<
    Record<string, unknown>
  >;
  const canModerateComments = Boolean(payload?.canModerate);
  const canSuspendUsers = Boolean(payload?.canSuspendUsers);
  const workspaceAnalyticsSummary = (payload?.summary ?? {}) as Record<
    string,
    number
  >;
  const workspaceTopChapters = (payload?.topChapters ?? []) as Array<
    Record<string, unknown>
  >;
  const workspaceRegions = (payload?.regions ?? []) as Array<
    Record<string, unknown>
  >;
  const commentPagination = (payload?.pagination ?? {
    page: 1,
    pageCount: 1,
    hasPrevious: false,
    hasNext: false,
  }) as {
    page: number;
    pageCount: number;
    total?: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
  const title = {
    Workspace: "Publishing workspace",
    Series: "Create New Series",
    Comments: "Release discussions",
    Analytics: "Release analytics",
    Rights: "Rights status",
    Settings: "Workspace settings",
  }[section] ?? "Publishing workspace";
  const description = {
    Workspace:
      "Live release totals, review workload, and the most recent chapters in your authorized scope.",
    Series:
      "Build a private series draft for administrator review, then manage the titles already assigned to your teams.",
    Comments:
      "Select an assigned series to review newest-first discussion, moderation, and account restrictions.",
    Analytics:
      "Views, viewers, regions, community activity, purchases, and uploads for your authorized catalogue.",
    Rights:
      "Rights state for every assigned series. Publication remains blocked when rights are revoked.",
    Settings:
      "Save your default team, language, and operational notifications.",
  }[section] ?? "";

  return (
    <section className="control-panel">
      {!embedded ? (
        <PanelHeader
          icon={<ShieldCheck size={18} />}
          kicker="Team operations"
          title={title}
          description={description}
        />
      ) : null}
      {loading ? (
        <div className="control-loading">
          <Pulse size={22} /> Loading live workspace data…
        </div>
      ) : error ? (
        <div className="control-error" role="alert">
          <WarningCircle size={21} />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : section === "Workspace" ? (
        <>
          <div className="workspace-live-metrics">
            {[
              ["Chapters", metrics.chapters ?? 0],
              ["Ready for review", metrics.readyForReview ?? 0],
              ["Published", metrics.published ?? 0],
              ["Processed pages", metrics.pages ?? 0],
            ].map(([label, value]) => (
              <article key={String(label)}>
                <span>{String(label)}</span>
                <strong>{Number(value).toLocaleString("en-US")}</strong>
              </article>
            ))}
          </div>
          <div className="workspace-live-list">
            <h2>Recent releases</h2>
            {recent.length ? (
              recent.map((record) => (
                <article key={String(record.id)}>
                  <div>
                    <strong>{String(record.seriesTitle)}</strong>
                    <span>
                      Chapter {String(record.chapterNumber)} ·{" "}
                      {String(record.teamName ?? "Independent release")}
                    </span>
                  </div>
                  <em>{humanize(String(record.state))}</em>
                  <a
                    href={`/title/${String(record.seriesSlug)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View series <ArrowRight size={15} />
                  </a>
                </article>
              ))
            ) : (
              <EmptyPanel
                title="No releases in this workspace"
                body="Upload an assigned chapter to start the release workflow."
              />
            )}
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={() => onNavigate("Upload center")}
          >
            <CloudArrowUp size={18} /> Open upload center
          </button>
        </>
      ) : section === "Series" || section === "Rights" ? (
        <>
        {section === "Series" && canRequestSeries ? (
          <section className="workspace-series-request-entry">
            <div>
              <span>New series workflow</span>
              <h3>Create New Series</h3>
              <p>
                Build a private draft, attach the cover and metadata, then
                submit it to an administrator for approval.
              </p>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                window.location.href = "/dashboard/upload-center/add-series";
              }}
            >
              <Plus size={17} /> Start series draft
            </button>
          </section>
        ) : null}
        <div className="workspace-series-table">
          {data.length ? (
            data.map((record) => (
              <article key={String(record.id)}>
                <div>
                  <strong>{String(record.title)}</strong>
                  <span>
                    {String(record.type)} · {String(record.status)}
                    {record.teams ? ` · ${String(record.teams)}` : ""}
                  </span>
                </div>
                <em
                  data-status={String(record.rightsStatus).toLowerCase()}
                >
                  {humanize(String(record.rightsStatus))}
                </em>
                <span>
                  {record.isPublished ? "Published" : "Not published"}
                </span>
                <a
                  href={`/title/${String(record.slug)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open <ArrowRight size={15} />
                </a>
              </article>
            ))
          ) : (
            <EmptyPanel
              title="No assigned series"
              body="An administrator must assign a verified team to a series before uploads are accepted."
            />
          )}
        </div>
        </>
      ) : section === "Comments" ? (
        <div className="workspace-comments">
          <div className="workspace-comments-toolbar">
            {embedded ? (
              <div className="workspace-comments-series-field">
                <span>Series discussion</span>
                <AdminCombobox
                  value={commentSeries}
                  options={commentSeriesOptions.map((seriesRecord) => ({
                    value: String(seriesRecord.slug),
                    label: String(seriesRecord.title),
                    description: String(seriesRecord.slug),
                  }))}
                  onChange={(value) => {
                    setCommentSeries(value);
                    setCommentPage(1);
                    setEditingCommentId(null);
                  }}
                  ariaLabel="Search and choose a series discussion"
                  placeholder="Search series…"
                  emptyLabel="Choose a series"
                />
              </div>
            ) : (
              <label>
                <span>Series discussion</span>
                <select
                  value={commentSeries}
                  onChange={(event) => {
                    setCommentSeries(event.target.value);
                    setCommentPage(1);
                    setEditingCommentId(null);
                  }}
                >
                  <option value="">Choose a series</option>
                  {commentSeriesOptions.map((seriesRecord) => (
                    <option
                      value={String(seriesRecord.slug)}
                      key={String(seriesRecord.id)}
                    >
                      {String(seriesRecord.title)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {commentSeries ? (
              <span>
                Newest first · {Number(commentPagination.total ?? 0)} comment
                {Number(commentPagination.total ?? 0) === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          {!commentSeries ? (
            <EmptyPanel
              title="Choose a series"
              body="Select an assigned series to review its complete discussion and moderation history."
            />
          ) : data.length ? (
            <div className="workspace-comment-list">
              {data.map((record) => {
                const recordId = String(record.id);
                const isEditing = editingCommentId === recordId;
                const status = String(record.moderationStatus ?? "VISIBLE");
                const isBusy = commentBusy === recordId;
                const bannedFromSeries = Boolean(record.bannedFromSeries);
                return (
                  <article key={recordId} data-status={status.toLowerCase()}>
                    <header>
                      <div>
                        <strong>{String(record.displayName)}</strong>
                        <span>
                          {humanize(status)}
                          {record.editedAt ? " · edited" : ""}
                          {record.pinnedAt ? " · pinned" : ""}
                          {bannedFromSeries ? " · series restricted" : ""}
                        </span>
                      </div>
                      <time dateTime={String(record.createdAt)}>
                        {formatDate(String(record.createdAt))}
                      </time>
                    </header>
                    {isEditing ? (
                      <div className="workspace-comment-editor">
                        <textarea
                          value={editedCommentBody}
                          maxLength={5000}
                          onChange={(event) =>
                            setEditedCommentBody(event.target.value)
                          }
                          aria-label="Edited comment"
                        />
                        <div>
                          <button
                            type="button"
                            disabled={
                              isBusy || editedCommentBody.trim().length < 1
                            }
                            onClick={() =>
                              void moderateComment(record, "EDIT")
                            }
                          >
                            <Check size={15} /> Save edit
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setEditingCommentId(null);
                              setEditedCommentBody("");
                            }}
                          >
                            <X size={15} /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p>
                        {status === "DELETED"
                          ? "Deleted comment"
                          : String(record.body || "Hidden comment")}
                      </p>
                    )}
                    <div className="workspace-comment-metrics">
                      <span>
                        {Number(record.reactionCount ?? 0)} reactions
                      </span>
                      <span>{Number(record.replyCount ?? 0)} replies</span>
                      <span>{Number(record.reportCount ?? 0)} open reports</span>
                    </div>
                    <footer>
                      <span>
                        {record.chapterSlug
                          ? humanize(String(record.chapterSlug))
                          : "Series discussion"}
                      </span>
                      <div className="workspace-comment-actions">
                        {record.chapterSlug ? (
                          <a
                            href={`/title/${String(record.seriesSlug)}/chapter/${String(record.chapterSlug)}#comment-${recordId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open thread <ArrowRight size={14} />
                          </a>
                        ) : null}
                        {canModerateComments && status !== "DELETED" ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setEditingCommentId(recordId);
                                setEditedCommentBody(String(record.body ?? ""));
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void moderateComment(
                                  record,
                                  status === "VISIBLE" ? "HIDE" : "RESTORE",
                                )
                              }
                            >
                              {status === "VISIBLE" ? "Hide" : "Restore"}
                            </button>
                            {!record.parentId ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void moderateComment(
                                    record,
                                    record.pinnedAt ? "UNPIN" : "PIN",
                                  )
                                }
                              >
                                {record.pinnedAt ? "Unpin" : "Pin"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void moderateComment(
                                  record,
                                  bannedFromSeries
                                    ? "UNBAN_SERIES"
                                    : "BAN_SERIES",
                                )
                              }
                            >
                              {bannedFromSeries
                                ? "Remove series ban"
                                : "Ban from series"}
                            </button>
                            {canSuspendUsers &&
                            String(record.userStatus) !== "SUSPENDED" ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void moderateComment(record, "SUSPEND_USER")
                                }
                              >
                                Suspend account
                              </button>
                            ) : null}
                            <button
                              className="is-destructive"
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void moderateComment(record, "DELETE")
                              }
                            >
                              Delete
                            </button>
                          </>
                        ) : null}
                      </div>
                    </footer>
                  </article>
                );
              })}
              <div className="workspace-comment-pagination">
                <button
                  type="button"
                  disabled={!commentPagination.hasPrevious || loading}
                  onClick={() =>
                    setCommentPage((current) => Math.max(1, current - 1))
                  }
                >
                  Previous
                </button>
                <span>
                  Page {commentPagination.page} of{" "}
                  {commentPagination.pageCount}
                </span>
                <button
                  type="button"
                  disabled={!commentPagination.hasNext || loading}
                  onClick={() => setCommentPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : (
            <EmptyPanel
              title="No comments in this series"
              body="New chapter and series discussion will appear here immediately."
            />
          )}
        </div>
      ) : section === "Analytics" ? (
        <div className="workspace-analytics">
          <div
            className="analytics-range-tabs"
            role="group"
            aria-label="Workspace analytics range"
          >
            {[
              ["24h", "Day"],
              ["7d", "Week"],
              ["30d", "Month"],
              ["custom", "Custom"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={
                  workspaceAnalyticsRange === value ? "active" : ""
                }
                aria-pressed={workspaceAnalyticsRange === value}
                onClick={() =>
                  setWorkspaceAnalyticsRange(
                    value as typeof workspaceAnalyticsRange,
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
          {workspaceAnalyticsRange === "custom" ? (
            <div className="analytics-custom-range">
              <label>
                <span>Start date</span>
                <input
                  type="date"
                  value={workspaceAnalyticsStart}
                  max={workspaceAnalyticsEnd}
                  onChange={(event) =>
                    setWorkspaceAnalyticsStart(event.target.value)
                  }
                />
              </label>
              <label>
                <span>End date</span>
                <input
                  type="date"
                  value={workspaceAnalyticsEnd}
                  min={workspaceAnalyticsStart}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(event) =>
                    setWorkspaceAnalyticsEnd(event.target.value)
                  }
                />
              </label>
            </div>
          ) : null}
          <div className="workspace-analytics-summary">
            {[
              ["Unique viewers", workspaceAnalyticsSummary.uniqueViewers ?? 0],
              ["Page views", workspaceAnalyticsSummary.pageViews ?? 0],
              ["Chapter views", workspaceAnalyticsSummary.chapterViews ?? 0],
              [
                "Completions",
                workspaceAnalyticsSummary.chapterCompletions ?? 0,
              ],
              ["Comments", workspaceAnalyticsSummary.comments ?? 0],
              ["Reactions", workspaceAnalyticsSummary.reactions ?? 0],
              ["Purchases", workspaceAnalyticsSummary.purchases ?? 0],
              ["Premium coins spent", workspaceAnalyticsSummary.onyxSpent ?? 0],
              ["New series", workspaceAnalyticsSummary.newSeries ?? 0],
              ["New chapters", workspaceAnalyticsSummary.newChapters ?? 0],
              [
                "Upload sources",
                workspaceAnalyticsSummary.uploadSessions ?? 0,
              ],
            ].map(([label, value]) => (
              <article key={String(label)}>
                <span>{String(label)}</span>
                <strong>{Number(value).toLocaleString("en-US")}</strong>
              </article>
            ))}
          </div>
          {data.length ? (
            <>
              <div className="workspace-analytics-chart">
                {data.slice(-28).map((record, index) => {
                  const count = Number(record.count ?? 0);
                  const max = Math.max(
                    1,
                    ...data.map((entry) => Number(entry.count ?? 0)),
                  );
                  return (
                    <span
                      key={`${String(record.day)}:${String(record.eventType)}:${index}`}
                      style={{ height: `${Math.max(8, (count / max) * 100)}%` }}
                      title={`${String(record.day)} · ${humanize(String(record.eventType))}: ${count}`}
                    />
                  );
                })}
              </div>
              <div className="workspace-analytics-legend">
                {Object.entries(
                  data.reduce<Record<string, number>>((totals, record) => {
                    const key = String(record.eventType);
                    totals[key] =
                      (totals[key] ?? 0) + Number(record.count ?? 0);
                    return totals;
                  }, {}),
                ).map(([eventType, count]) => (
                  <article key={eventType}>
                    <span>{humanize(eventType)}</span>
                    <strong>{count.toLocaleString("en-US")}</strong>
                  </article>
                ))}
              </div>
              <div className="workspace-analytics-details">
                <section>
                  <div className="control-section-heading">
                    <div>
                      <span>Chapter performance</span>
                      <h3>Top chapters</h3>
                    </div>
                  </div>
                  {workspaceTopChapters.length ? (
                    workspaceTopChapters.map((record) => (
                      <article
                        key={`${String(record.seriesSlug)}:${String(record.chapterSlug)}`}
                      >
                        <div>
                          <strong>{String(record.seriesTitle)}</strong>
                          <span>
                            Chapter {String(record.chapterNumber)}
                          </span>
                        </div>
                        <em>
                          {Number(record.views ?? 0)} views ·{" "}
                          {Number(record.uniqueViewers ?? 0)} viewers
                        </em>
                      </article>
                    ))
                  ) : (
                    <p>No chapter views in this period.</p>
                  )}
                </section>
                <section>
                  <div className="control-section-heading">
                    <div>
                      <span>Country-level only</span>
                      <h3>Viewer regions</h3>
                    </div>
                  </div>
                  {workspaceRegions.length ? (
                    workspaceRegions.map((record) => (
                      <article key={String(record.regionCode)}>
                        <strong>{String(record.regionCode)}</strong>
                        <span>
                          {Number(record.uniqueViewers ?? 0)} viewers
                        </span>
                        <em>{Number(record.views ?? 0)} views</em>
                      </article>
                    ))
                  ) : (
                    <p>No regional data in this period.</p>
                  )}
                </section>
              </div>
            </>
          ) : (
            <EmptyPanel
              title="No reader activity yet"
              body="Real reader events will appear after assigned chapters are published and opened."
            />
          )}
        </div>
      ) : (
        <form className="workspace-settings-form" onSubmit={saveSettings}>
          <label>
            Default team
            <select
              value={settings.defaultTeamId}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  defaultTeamId: event.target.value,
                }))
              }
            >
              <option value="">Choose for each upload</option>
              {teams.map((team) => (
                <option value={String(team.id)} key={String(team.id)}>
                  {String(team.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Default release language
            <input
              value={settings.defaultLanguage}
              pattern="[a-z]{2,3}(?:-[a-z0-9]{2,8})?"
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  defaultLanguage: event.target.value.toLowerCase(),
                }))
              }
            />
          </label>
          <label className="workspace-settings-check">
            <input
              type="checkbox"
              checked={settings.reviewNotifications}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  reviewNotifications: event.target.checked,
                }))
              }
            />
            Notify me when a release changes review state
          </label>
          <label className="workspace-settings-check">
            <input
              type="checkbox"
              checked={settings.uploadNotifications}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  uploadNotifications: event.target.checked,
                }))
              }
            />
            Notify me about failed or completed uploads
          </label>
          <button className="button button-primary" disabled={saving}>
            {saving ? "Saving…" : "Save workspace settings"}
          </button>
        </form>
      )}
      <PromptActionDialog
        open={Boolean(moderationPrompt)}
        title={
          moderationPrompt?.action === "EDIT"
            ? "Explain this moderator edit"
            : "Add a moderation reason"
        }
        description="The reason is required and will be saved in the moderation audit trail."
        label="Moderation reason"
        placeholder="Describe the policy or safety reason for this action"
        confirmLabel="Continue"
        minLength={6}
        maxLength={1000}
        busy={Boolean(commentBusy)}
        onCancel={() => {
          if (!commentBusy) setModerationPrompt(null);
        }}
        onConfirm={(reason) => {
          const intent = moderationPrompt;
          setModerationPrompt(null);
          if (!intent) return;
          const nextIntent = { ...intent, reason };
          if (
            ["DELETE", "BAN_SERIES", "SUSPEND_USER"].includes(
              nextIntent.action,
            )
          ) {
            setModerationConfirmation(nextIntent);
          } else {
            void executeModeration(nextIntent);
          }
        }}
      />
      <ConfirmActionDialog
        open={Boolean(moderationConfirmation)}
        title={
          moderationConfirmation?.action === "DELETE"
            ? "Permanently delete this comment?"
            : moderationConfirmation?.action === "BAN_SERIES"
              ? "Ban this user from this series?"
              : "Suspend this user across NyaScans?"
        }
        description={
          moderationConfirmation?.action === "DELETE"
            ? "The comment will be permanently removed. This action and its reason remain in the audit trail."
            : moderationConfirmation?.action === "BAN_SERIES"
              ? "The user will lose the ability to participate in this series discussion until the ban is removed."
              : "The account will be suspended across NyaScans until an authorized administrator restores it."
        }
        confirmLabel={
          moderationConfirmation?.action === "DELETE"
            ? "Delete comment"
            : moderationConfirmation?.action === "BAN_SERIES"
              ? "Ban from series"
              : "Suspend account"
        }
        destructive
        busy={Boolean(commentBusy)}
        onCancel={() => {
          if (!commentBusy) setModerationConfirmation(null);
        }}
        onConfirm={() => {
          const intent = moderationConfirmation;
          setModerationConfirmation(null);
          if (intent) void executeModeration(intent);
        }}
      />
    </section>
  );
}

export function OperationsControlPanel({
  admin,
  section,
  subsection,
  actorRole,
  actorRoles,
  capabilities,
  canUpload,
  canRequestSeries,
  canManageTeam,
  onNavigate,
  initialUploadMode,
}: PanelProps) {
  const sectionKey = admin
    ? (findAdminNavigationDestination(section)?.item.slug ??
      normalizeAdminNavigationKey(section))
    : normalizeAdminNavigationKey(section);

  if (sectionKey === "upload-center") {
    return (
      <UploadCenter
        admin={admin}
        initialMode={initialUploadMode}
        initialSection={subsection}
        canUpload={canUpload}
        canRequestSeries={canRequestSeries}
        canManageTeam={canManageTeam}
      />
    );
  }
  if (["chapter-review", "review-queue"].includes(sectionKey)) {
    return <ReviewQueue admin={admin} />;
  }
  if (!admin && sectionKey === "my-teams") return <TeamCommunityPanel />;
  if (!admin) {
    return (
      <WorkspacePanel
        section={section}
        onNavigate={onNavigate}
        canRequestSeries={canRequestSeries}
      />
    );
  }
  if (["home", "dashboard", "overview", "analytics"].includes(sectionKey)) {
    return <AnalyticsPanel onNavigate={onNavigate} actorRole={actorRole} />;
  }
  if (sectionKey === "discussions") {
    return (
      <ReactionLibraryPanel
        moderationPanel={
          <WorkspacePanel
            section="Comments"
            onNavigate={onNavigate}
            canRequestSeries={false}
            embedded
          />
        }
        settingsPanel={<DiscussionSettingsPanel />}
      />
    );
  }
  if (sectionKey === "series") {
    return (
      <SeriesManagementPanel
        initialMode={subsection === "new" ? "create" : "browse"}
        onNavigateToCreate={() => onNavigate("series", "new")}
      />
    );
  }
  if (sectionKey === "genres-tags") return <TaxonomyManager />;
  if (sectionKey === "reports") {
    return <SeriesReportsPanel />;
  }
  if (section === "Series Submissions" || sectionKey === "series-submissions") {
    return <NewSeriesQueuePanel />;
  }
  if (
    sectionKey === "chapters" &&
    !capabilities.includes("content.chapters.manage") &&
    capabilities.includes("uploads.review")
  ) {
    return (
      <UploadCenterWorkspace
        admin={admin}
        initialMode={initialUploadMode}
        initialSection={subsection || "dashboard"}
        canUpload={canUpload}
        canRequestSeries={canRequestSeries}
        canManageTeam={canManageTeam}
      />
    );
  }
  if (sectionKey === "chapters" && subsection === "add-series") {
    return (
      <SeriesManagementPanel
        initialMode="create"
        onNavigateToCreate={() => onNavigate("series", "new")}
      />
    );
  }
  if (
    sectionKey === "chapters" &&
    [
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
    ].includes(subsection ?? "")
  ) {
    return (
      <UploadCenterWorkspace
        admin={admin}
        initialMode={initialUploadMode}
        initialSection={subsection}
        canUpload={canUpload}
        canRequestSeries={canRequestSeries}
        canManageTeam={canManageTeam}
      />
    );
  }
  if (sectionKey === "chapters") return <ChapterAccessPanel />;
  if (sectionKey === "access-decisions") return <ChapterAccessDecisionPanel />;
  if (sectionKey === "content-access-control") {
    return <ContentVisibilityPanel onNavigate={onNavigate} />;
  }
  if (sectionKey === "team-directory") {
    return <TeamManagementPanel />;
  }
  if (sectionKey === "team-requests") return <TeamRequestsPanel />;
  if (sectionKey === "users-roles") {
    return <UsersManager actorRole={actorRole} actorRoles={actorRoles} />;
  }
  if (sectionKey === "permissions") return <RolePermissionsPanel />;
  if (sectionKey === "activity-log") {
    return (
      <ActivityLogWorkspace
        subsection={subsection}
        actorRole={actorRole}
        actorRoles={actorRoles}
        capabilities={capabilities}
        onNavigate={onNavigate}
      />
    );
  }
  if (sectionKey === "transactions") {
    return <UsersControlPanel view="purchases" actorRoles={actorRoles} />;
  }
  if (sectionKey === "wallet-balances") {
    return <UsersControlPanel view="balances" actorRoles={actorRoles} />;
  }
  if (section === "Payouts" || sectionKey === "payouts") {
    return <PayoutsPanel />;
  }
  if (sectionKey === "support-tickets") return <SupportTicketsAdminPanel />;
  if (sectionKey === "store") {
    const category = [
      "offers",
      "coins",
      "memberships",
      "banners",
      "cosmetics",
      "logo-effects",
    ].includes(subsection ?? "")
      ? (subsection as StoreAdminCategory)
      : "offers";
    return (
      <StoreManagementWorkspace
        initialCategory={category}
        actorRole={actorRole}
        capabilities={capabilities}
        onCategoryChange={(next, confirmedDiscard) =>
          onNavigate("store", next, confirmedDiscard)
        }
      />
    );
  }
  if (sectionKey === "editorial-picks") return <EditorialManagementPanel />;
  if (sectionKey === "sliders") return <SliderManagementPanel />;
  if (sectionKey === "pinned-series") return <PinnedSeriesPanel />;
  if (sectionKey === "discounts") return <DiscountsPanel />;
  if (sectionKey === "announcements-ads") return <HomePromotionsPanel />;
  if (sectionKey === "integrations-api") return <ApiControlPanel />;
  if (sectionKey === "security") return <SecurityPanel />;
  if (sectionKey === "feature-flags") {
    const siteCoverageTab = [
      "registry",
      "community",
      "moderation",
      "access",
      "security",
    ].includes(subsection ?? "")
      ? (subsection as
          | "registry"
          | "community"
          | "moderation"
          | "access"
          | "security")
      : "registry";
    return (
      <SiteCoveragePanel
        key={siteCoverageTab}
        initialTab={siteCoverageTab}
        onTabNavigate={(next) => onNavigate("feature-flags", next)}
      />
    );
  }
  return <AnalyticsPanel onNavigate={onNavigate} actorRole={actorRole} />;
}
