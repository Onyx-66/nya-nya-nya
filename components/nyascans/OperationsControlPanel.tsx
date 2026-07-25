"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowClockwise,
  ArrowRight,
  ArrowUp,
  Books,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Check,
  CheckCircle,
  CloudArrowUp,
  Coins,
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
  UserGear,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CommercialSettingsPanel } from "@/components/nyascans/CommercialSettingsPanel";
import { EditorialManagementPanel } from "@/components/nyascans/EditorialManagementPanel";
import { AuditLogPanel as OwnerAuditLogPanel } from "@/components/nyascans/admin/AuditLogPanel";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";
import { CommerceOfferManager } from "@/components/nyascans/admin/CommerceOfferManager";
import { NewSeriesQueuePanel } from "@/components/nyascans/admin/NewSeriesQueuePanel";
import { SeriesManagementPanel } from "@/components/nyascans/admin/SeriesManagementPanel";
import {
  StoreManagementWorkspace,
  type StoreAdminCategory,
} from "@/components/nyascans/admin/StoreManagementWorkspace";
import { TeamManagementPanel } from "@/components/nyascans/admin/TeamManagementPanel";
import { UploadCenterWorkspace } from "@/components/nyascans/upload/UploadCenterWorkspace";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";
import { coinLabel } from "@/lib/commercial-settings";

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
  summary: {
    activeSessions5m: number;
    uniqueSessions: number;
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
    newChapters: number;
    uploadSessions: number;
    storePurchases: number;
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
  ageRating: string;
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
    | "MODERATOR"
    | "TEAM_LEADER"
    | "UPLOADER"
    | "USER";
  status: "ACTIVE" | "SUSPENDED";
  teamCount: number;
  updatedAt: string;
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
  kicker,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  kicker: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="control-panel-header">
      <div>
        <span className="ops-kicker">
          {icon}
          {kicker}
        </span>
        <h2>{title}</h2>
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
  children: ReactNode;
}) {
  return (
    <p className={`control-message control-message-${kind}`} role="status">
      {kind === "success" ? (
        <CheckCircle size={18} weight="fill" />
      ) : kind === "error" ? (
        <WarningCircle size={18} />
      ) : (
        <Pulse size={18} />
      )}
      {children}
    </p>
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

function AdminOverview({
  onNavigate,
  actorRole,
}: {
  onNavigate: (section: string) => void;
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
        kicker="Live control room"
        title="Site overview"
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
                ["Add a series", "Series", Plus],
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
function TeamsManager() {
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
              <option value="MANAGER">Manager</option>
              <option value="UPLOADER">Uploader</option>
              <option value="EDITOR">Editor</option>
              <option value="MEMBER">Member</option>
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

function UsersManager({ actorRole }: { actorRole: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentActorId, setCurrentActorId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"success" | "error">("success");

  async function load() {
    setLoading(true);
    try {
      const payload = await fetch("/api/v1/admin/users").then((response) =>
        readJson<{ data: AdminUser[]; currentActorId: string }>(response),
      );
      setUsers(payload.data ?? []);
      setCurrentActorId(payload.currentActorId ?? "");
    } catch (loadError) {
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
    patch: Partial<Pick<AdminUser, "primaryRole" | "status">>,
  ) {
    setBusy(user.id);
    setMessage("");
    try {
      await fetch("/api/v1/admin/users", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          expectedPrimaryRole: user.primaryRole,
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
    `${user.displayName} ${user.email} ${user.primaryRole} ${user.status}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<UserGear size={18} />}
        kicker="Access control"
        title="Users and roles"
        description="Search accounts, assign the minimum required role, and suspend access. Every change is server-authorized and written to the audit log."
        actions={
          <label className="control-search">
            <MagnifyingGlass size={17} />
            <span className="sr-only">Search users</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email, or role"
            />
          </label>
        }
      />
      {loading ? (
        <LoadingPanel />
      ) : visible.length ? (
        <div className="user-admin-list">
          {visible.map((user) => {
            const isSelf = user.id === currentActorId;
            const protectedRole = ["OWNER", "ADMINISTRATOR", "MODERATOR"].includes(
              user.primaryRole,
            );
            const protectedForActor = actorRole !== "OWNER" && protectedRole;
            return (
              <article key={user.id}>
                <span className="user-admin-avatar">
                  {user.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>
                    {user.displayName}
                    {isSelf ? <em>You</em> : null}
                  </strong>
                  <small>{user.email}</small>
                  <span>{Number(user.teamCount)} team assignment{Number(user.teamCount) === 1 ? "" : "s"}</span>
                </div>
                <label>
                  <span>Role</span>
                  <select
                    value={user.primaryRole}
                    disabled={isSelf || protectedForActor || busy === user.id}
                    title={
                      protectedForActor
                        ? "Only the owner may change a protected administrative role."
                        : undefined
                    }
                    onChange={(event) =>
                      void update(user, {
                        primaryRole: event.target
                          .value as AdminUser["primaryRole"],
                      })
                    }
                  >
                    <option value="OWNER">Owner</option>
                    <option value="MODERATOR">Moderator</option>
                    <option value="USER">Reader</option>
                    <option value="UPLOADER">Uploader</option>
                    <option value="TEAM_LEADER">Team leader</option>
                    <option value="ADMINISTRATOR">Administrator</option>
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select
                    value={user.status}
                    disabled={isSelf || protectedForActor || busy === user.id}
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
              </article>
            );
          })}
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
};

function ReviewQueue({ admin }: { admin: boolean }) {
  const [chapters, setChapters] = useState<ReviewChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

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

  async function transition(
    chapter: ReviewChapter,
    action: "SUBMIT" | "PUBLISH" | "RETURN",
  ) {
    const reason = window.prompt(
      action === "PUBLISH"
        ? "Publication note"
        : action === "RETURN"
          ? "Explain what must be corrected"
          : "Review submission note",
      action === "PUBLISH"
        ? "Validated ordered pages and release metadata"
        : action === "RETURN"
          ? "Return for required release corrections"
          : "Ready for editorial and page-order review",
    );
    if (!reason) return;
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
        kicker="Publishing QA"
        title="Review queue"
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
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy === chapter.id}
                          onClick={() => void transition(chapter, "PUBLISH")}
                        >
                          {admin ? "Publish" : "Request publish"}
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

  async function removeComment(comment: AdminChapterComment) {
    if (!selected) return;
    if (
      !window.confirm(
        `Remove ${comment.authorName}'s comment from this chapter?`,
      )
    ) {
      return;
    }
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
        kicker="Chapter operations"
        title="Chapter management"
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
              </section>
              <section className="chapter-editor-section">
                <div className="chapter-editor-heading">
                  <div>
                    <span>Reader entitlement</span>
                    <h4>Access &amp; price</h4>
                  </div>
                </div>
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
              <button
                className="button button-primary"
                type="submit"
                disabled={busy}
              >
                <LockKey size={17} />
                {busy ? "Saving chapter…" : "Save chapter changes"}
              </button>
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
    </section>
  );
}

function AnalyticsPanel() {
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
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    async function load() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const query =
          range === "custom"
            ? `range=custom&start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}`
            : `range=${range}`;
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
  }, [customEnd, customStart, range, refreshKey]);

  const activeData = data?.range === range ? data : null;
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

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<Pulse size={18} />}
        kicker="Near-real-time activity"
        title="Reader analytics"
        description="Privacy-minimal session activity refreshes every 15 seconds while this tab is visible. Purchases, unlocks, and comments come from their canonical database records."
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
          {error} Existing figures remain visible until the next successful
          refresh.
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
                `Measured in the selected ${range} range`,
              ],
              [
                "Page views",
                activeData.summary.views,
                "Home, browse, latest, and series views",
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
                "Accounts created in this period",
              ],
              [
                "Store purchases",
                activeData.summary.storePurchases,
                "Database-confirmed cosmetic purchases",
              ],
              [
                "Community activity",
                activeData.summary.comments + activeData.summary.reactions,
                `${activeData.summary.comments} comments · ${activeData.summary.reactions} reactions`,
              ],
              [
                "New uploads",
                activeData.summary.newSeries + activeData.summary.newChapters,
                `${activeData.summary.newSeries} series · ${activeData.summary.newChapters} chapters · ${activeData.summary.uploadSessions} source files`,
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
              {activeData.summary.paidOrders.toLocaleString("en-US")} test checkouts ·{" "}
              ${(activeData.summary.testCheckoutValueMinor / 100).toFixed(2)}
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

  return (
    <section className="control-panel">
      <PanelHeader
        icon={<LockKey size={18} />}
        kicker="Security posture"
        title="Security and service checks"
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
              "Server-side roles",
              "Every administrator, team, upload, and moderation API checks the resolved account role.",
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
            "Enforce MFA and recent reauthentication in the identity provider.",
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

function WorkspacePanel({
  section,
  onNavigate,
  canRequestSeries,
}: {
  section: string;
  onNavigate: (section: string) => void;
  canRequestSeries: boolean;
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

  async function moderateComment(
    record: Record<string, unknown>,
    action:
      | "EDIT"
      | "HIDE"
      | "RESTORE"
      | "DELETE"
      | "PIN"
      | "UNPIN"
      | "BAN_SERIES"
      | "UNBAN_SERIES"
      | "SUSPEND_USER",
  ) {
    const commentId = String(record.id);
    const needsReason = [
      "EDIT",
      "HIDE",
      "DELETE",
      "BAN_SERIES",
      "SUSPEND_USER",
    ].includes(action);
    const reason = needsReason
      ? window.prompt(
          action === "EDIT"
            ? "Why is this moderator edit necessary?"
            : "Enter the moderation reason:",
        )
      : "";
    if (needsReason && (!reason || reason.trim().length < 6)) return;
    if (
      ["DELETE", "BAN_SERIES", "SUSPEND_USER"].includes(action) &&
      !window.confirm(
        action === "DELETE"
          ? "Permanently delete this comment?"
          : action === "BAN_SERIES"
            ? "Ban this user from this series discussion?"
            : "Suspend this user across NyaScans?",
      )
    ) {
      return;
    }
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
      <PanelHeader
        icon={<ShieldCheck size={18} />}
        kicker="Team operations"
        title={title}
        description={description}
      />
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
              ["Onyx spent", workspaceAnalyticsSummary.onyxSpent ?? 0],
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
    </section>
  );
}

export function OperationsControlPanel({
  admin,
  section,
  subsection,
  actorRole,
  canUpload,
  canRequestSeries,
  canManageTeam,
  onNavigate,
  initialUploadMode,
}: PanelProps) {
  if (section === "Upload center") {
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
  if (section === "Review queue") return <ReviewQueue admin={admin} />;
  if (!admin) {
    return (
      <WorkspacePanel
        section={section}
        onNavigate={onNavigate}
        canRequestSeries={canRequestSeries}
      />
    );
  }
  if (section === "Overview") {
    return (
      <AdminOverview onNavigate={onNavigate} actorRole={actorRole} />
    );
  }
  if (section === "Series") return <SeriesManagementPanel />;
  if (section === "New Series Queue") return <NewSeriesQueuePanel />;
  if (section === "Chapter access") return <ChapterAccessPanel />;
  if (section === "Teams") {
    return <TeamManagementPanel membersPanel={<TeamsManager />} />;
  }
  if (section === "Users") return <UsersManager actorRole={actorRole} />;
  if (section === "Analytics") return <AnalyticsPanel />;
  if (section === "Commerce") {
    return (
      <CommerceOfferManager settingsPanel={<CommercialSettingsPanel />} />
    );
  }
  if (section === "Store Management") {
    const category = [
      "coins",
      "memberships",
      "banners",
      "cosmetics",
      "logo-effects",
    ].includes(subsection ?? "")
      ? (subsection as StoreAdminCategory)
      : "coins";
    return (
      <StoreManagementWorkspace
        initialCategory={category}
        onCategoryChange={(next, confirmedDiscard) =>
          onNavigate("Store Management", next, confirmedDiscard)
        }
      />
    );
  }
  if (section === "Editorial") return <EditorialManagementPanel />;
  if (section === "Security") return <SecurityPanel />;
  if (section === "Audit log") {
    return <OwnerAuditLogPanel actorRole={actorRole} />;
  }
  return <AdminOverview onNavigate={onNavigate} actorRole={actorRole} />;
}
