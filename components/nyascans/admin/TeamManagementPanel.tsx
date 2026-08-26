"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
import { PremiumColorPicker } from "@/components/nyascans/PremiumColorPicker";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  Books,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Copy,
  Clock,
  Eye,
  EyeSlash,
  Images,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  Smiley,
  UsersThree,
  Trash,
  WarningCircle,
} from "@/components/nyascans/heroicons";
import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import {
  AdminCombobox,
  AdminPageScaffold,
  AdminStatGrid,
  AdminStatTile,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";

type TeamRecord = {
  id: string;
  publicRef: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  staffBadgeUrl: string | null;
  effect: {
    type: "NONE" | "BORDER" | "GLOW" | "ACCENT" | "SPARKLE" | "VERIFIED";
    enabled: boolean;
    accentColor: string;
    intensity: number;
    motion: "NONE" | "SUBTLE";
  };
  verificationStatus: "PENDING" | "VERIFIED" | "SUSPENDED";
  isArchived: boolean;
  canControlFixedReaderPages: boolean;
  revision: number;
  memberCount: number;
  seriesCount: number;
  releaseCount: number;
  members: Array<{
    userId: string;
    displayName: string;
    email: string;
    role: string;
    status: string;
    isPrimary: boolean;
    revision: number;
  }>;
  activity: Array<{
    chapterId: string;
    chapterSlug: string;
    chapterNumber: string;
    chapterTitle: string | null;
    language: string;
    version: number;
    state: string;
    visibility: string;
    accessType: string;
    revision: number;
    pageCount: number;
    createdAt: string;
    publishedAt: string | null;
    seriesId: string;
    seriesSlug: string;
    seriesTitle: string;
    uploaderName: string | null;
    commentCount: number;
    reportCount: number;
    reactionCount: number;
  }>;
  series: Array<{
    seriesId: string;
    title: string;
    slug: string;
    canUpload: boolean;
    canPublish: boolean;
    isPrimary: boolean;
    chapterCount: number;
    publishedCount: number;
    latestReleaseAt: string | null;
  }>;
  updatedAt: string;
};

type TeamDraft = Pick<
  TeamRecord,
  | "id"
  | "publicRef"
  | "revision"
  | "name"
  | "slug"
  | "description"
  | "verificationStatus"
  | "isArchived"
  | "canControlFixedReaderPages"
  | "effect"
  | "logoUrl"
  | "bannerUrl"
  | "staffBadgeUrl"
  | "activity"
  | "memberCount"
  | "seriesCount"
  | "releaseCount"
> & {
  members: TeamRecord["members"];
  series: TeamRecord["series"];
};

type TeamConfirmation =
  | { kind: "DISCARD_CHANGES"; team: TeamRecord }
  | { kind: "HIDE_CHAPTER"; chapter: TeamRecord["activity"][number] };

const emptyDraft: TeamDraft = {
  id: "",
  publicRef: "",
  revision: 1,
  name: "",
  slug: "",
  description: "",
  verificationStatus: "PENDING",
  isArchived: false,
  canControlFixedReaderPages: false,
  effect: {
    type: "NONE",
    enabled: false,
    accentColor: "#2d8cff",
    intensity: 1,
    motion: "NONE",
  },
  logoUrl: null,
  bannerUrl: null,
  staffBadgeUrl: null,
  memberCount: 0,
  seriesCount: 0,
  releaseCount: 0,
  activity: [],
  members: [],
  series: [],
};

function draftFor(team: TeamRecord): TeamDraft {
  return {
    ...team,
    effect: {
      type: team.effect.type,
      enabled: team.effect.enabled,
      accentColor: team.effect.accentColor || "#2d8cff",
      intensity: Number(team.effect.intensity || 1),
      motion: team.effect.motion || "NONE",
    },
  };
}

async function api<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The team action failed.");
  }
  return payload;
}

export function TeamManagementPanel() {
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<TeamDraft>(emptyDraft);
  const [saved, setSaved] = useState<TeamDraft>(emptyDraft);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [memberBusy, setMemberBusy] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberResults, setMemberResults] = useState<Array<{
    id: string;
    displayName: string;
    email: string;
    membershipStatus: string | null;
  }>>([]);
  const [newMemberRole, setNewMemberRole] = useState<"OWNER" | "LEADER" | "UPLOADER">("UPLOADER");
  const [chapterBusy, setChapterBusy] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [badgeFile, setBadgeFile] = useState<File | null>(null);
  const [removeMedia, setRemoveMedia] = useState({
    logo: false,
    banner: false,
    badge: false,
  });
  const [confirmation, setConfirmation] =
    useState<TeamConfirmation | null>(null);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved) ||
    Boolean(logoFile || bannerFile || badgeFile) ||
    Object.values(removeMedia).some(Boolean);
  const selectedMember =
    memberResults.find((member) => member.id === selectedMemberId) ?? null;
  useUnsavedChanges(dirty, "team changes");

  async function load(preferredId?: string, requestedPage = page) {
    setLoading(true);
    try {
      const payload = await api<{
        data: TeamRecord[];
        pagination: { total: number };
      }>(
        `/api/v1/admin/team-management?query=${encodeURIComponent(query)}&page=${requestedPage}&limit=20`,
        { cache: "no-store" },
      );
      setTeams(payload.data);
      setPage(requestedPage);
      setTotal(payload.pagination.total);
      const nextId =
        preferredId && payload.data.some((team) => team.id === preferredId)
          ? preferredId
          : selectedId && payload.data.some((team) => team.id === selectedId)
            ? selectedId
            : payload.data[0]?.id ?? "";
      if (nextId) {
        const next = draftFor(
          payload.data.find((team) => team.id === nextId) ?? payload.data[0],
        );
        setSelectedId(nextId);
        setDraft(next);
        setSaved(next);
      } else {
        setSelectedId("");
        setDraft(emptyDraft);
        setSaved(emptyDraft);
      }
      setMessage(null);
      setHasLoaded(true);
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Teams could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query]);

  function applySelection(team: TeamRecord) {
    const next = draftFor(team);
    setSelectedId(team.id);
    setDraft(next);
    setSaved(next);
    setLogoFile(null);
    setBannerFile(null);
    setBadgeFile(null);
    setRemoveMedia({ logo: false, banner: false, badge: false });
    setMemberQuery("");
    setMemberResults([]);
    setSelectedMemberId("");
    setMessage(null);
  }

  function select(team: TeamRecord) {
    if (dirty) {
      setConfirmation({ kind: "DISCARD_CHANGES", team });
      return;
    }
    applySelection(team);
  }

  async function updateMember(
    member: TeamRecord["members"][number],
    patch: { role?: string; remove?: boolean },
  ) {
    if (!draft.id || memberBusy || dirty) {
      if (dirty) {
        setMessage({
          kind: "neutral",
          text: "Save or reset the current team before changing member access.",
        });
      }
      return;
    }
    setMemberBusy(member.userId);
    setMessage(null);
    try {
      await api<{ ok: boolean }>("/api/v1/admin/team-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: patch.remove ? "REMOVE" : "UPDATE",
          teamId: draft.id,
          userId: member.userId,
          role: patch.role ?? member.role,
          revision: member.revision,
        }),
      });
      await load(draft.id, page);
      setMessage({ kind: "success", text: `${member.displayName}'s team access was updated.` });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Membership could not be updated." });
    } finally {
      setMemberBusy("");
    }
  }

  async function searchMembers() {
    if (!draft.id || memberQuery.trim().length < 2) return;
    setMemberBusy("search");
    try {
      const result = await api<{ data: typeof memberResults }>(
        `/api/v1/admin/team-members?teamId=${encodeURIComponent(draft.id)}&query=${encodeURIComponent(memberQuery.trim())}`,
      );
      setMemberResults(result.data);
      setSelectedMemberId("");
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Users could not be searched." });
    } finally {
      setMemberBusy("");
    }
  }

  async function addMember(userId: string) {
    if (!draft.id || memberBusy) return;
    setMemberBusy(userId);
    try {
      await api<{ ok: boolean }>("/api/v1/admin/team-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ADD", teamId: draft.id, userId, role: newMemberRole }),
      });
      setMemberQuery("");
      setMemberResults([]);
      setSelectedMemberId("");
      await load(draft.id, page);
      setMessage({ kind: "success", text: "Team member added with scoped access." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Member could not be added." });
    } finally {
      setMemberBusy("");
    }
  }

  async function hideChapter(chapter: TeamRecord["activity"][number]) {
    if (!draft.id || chapterBusy || dirty) {
      if (dirty) {
        setMessage({
          kind: "neutral",
          text: "Save or reset the current team before using chapter quick actions.",
        });
      }
      return;
    }
    setChapterBusy(chapter.chapterId);
    setMessage(null);
    try {
      await api<{ ok: boolean }>("/api/v1/admin/team-management", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "HIDE_CHAPTER",
          teamId: draft.id,
          chapterId: chapter.chapterId,
          expectedRevision: chapter.revision,
          reason: "Hidden from selected-team activity quick action.",
        }),
      });
      await load(draft.id, page);
      setMessage({ kind: "success", text: "The chapter is now a private draft." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Chapter could not be hidden." });
    } finally {
      setChapterBusy("");
    }
  }

  function requestChapterHide(chapter: TeamRecord["activity"][number]) {
    if (!draft.id || chapterBusy || dirty) {
      if (dirty) {
        setMessage({
          kind: "neutral",
          text: "Save or reset the current team before using chapter quick actions.",
        });
      }
      return;
    }
    setConfirmation({ kind: "HIDE_CHAPTER", chapter });
  }

  async function uploadMedia(
    teamId: string,
    revision: number,
    slot: "logo" | "banner" | "badge",
    file: File,
  ) {
    const form = new FormData();
    form.set("teamId", teamId);
    form.set("slot", slot);
    form.set("revision", String(revision));
    form.set("file", file);
    const payload = await api<{
      data: { revision: number; url: string | null };
    }>(
      "/api/v1/admin/team-media",
      { method: "PUT", body: form },
    );
    return payload.data;
  }

  async function deleteMedia(
    teamId: string,
    revision: number,
    slot: "logo" | "banner" | "badge",
  ) {
    const payload = await api<{
      data: { revision: number; url: string | null };
    }>(
      `/api/v1/admin/team-media?teamId=${encodeURIComponent(teamId)}&slot=${slot}&revision=${revision}`,
      { method: "DELETE" },
    );
    return payload.data;
  }

  function selectMedia(
    slot: "logo" | "banner" | "badge",
    file: File | null,
  ) {
    if (slot === "logo") setLogoFile(file);
    if (slot === "banner") setBannerFile(file);
    if (slot === "badge") setBadgeFile(file);
    if (file) {
      setRemoveMedia((current) => ({ ...current, [slot]: false }));
    }
  }

  function removeMediaSlot(slot: "logo" | "banner" | "badge") {
    const file =
      slot === "logo" ? logoFile : slot === "banner" ? bannerFile : badgeFile;
    if (file) {
      selectMedia(slot, null);
      return;
    }
    const urlKey =
      slot === "logo"
        ? "logoUrl"
        : slot === "banner"
          ? "bannerUrl"
          : "staffBadgeUrl";
    if (!draft[urlKey]) return;
    setRemoveMedia((current) => ({ ...current, [slot]: true }));
    setDraft((current) => ({ ...current, [urlKey]: null }));
  }

  async function saveTeam(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    let persisted: TeamDraft | null = null;
    const applyPersisted = (next: TeamDraft) => {
      persisted = next;
      setSelectedId(next.id);
      setDraft(next);
      setSaved(next);
    };
    try {
      const isEdit = Boolean(draft.id);
      const payload = await api<{ data: TeamRecord }>(
        "/api/v1/admin/team-management",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(isEdit ? { id: draft.id, revision: draft.revision } : {}),
            name: draft.name,
            slug: draft.slug,
            description: draft.description,
            verificationStatus: draft.verificationStatus,
            isArchived: draft.isArchived,
            canControlFixedReaderPages: draft.canControlFixedReaderPages,
            effect: draft.effect,
          }),
        },
      );
      let current = draftFor(payload.data);
      applyPersisted(current);
      for (const slot of ["logo", "banner", "badge"] as const) {
        if (removeMedia[slot]) {
          const media = await deleteMedia(
            payload.data.id,
            current.revision,
            slot,
          );
          const key =
            slot === "logo"
              ? "logoUrl"
              : slot === "banner"
                ? "bannerUrl"
                : "staffBadgeUrl";
          current = { ...current, revision: media.revision, [key]: null };
          applyPersisted(current);
          setRemoveMedia((value) => ({ ...value, [slot]: false }));
        }
      }
      for (const [slot, file] of [
        ["logo", logoFile],
        ["banner", bannerFile],
        ["badge", badgeFile],
      ] as const) {
        if (file) {
          const media = await uploadMedia(
            payload.data.id,
            current.revision,
            slot,
            file,
          );
          const key =
            slot === "logo"
              ? "logoUrl"
              : slot === "banner"
                ? "bannerUrl"
                : "staffBadgeUrl";
          current = {
            ...current,
            revision: media.revision,
            [key]: media.url,
          };
          applyPersisted(current);
          if (slot === "logo") setLogoFile(null);
          if (slot === "banner") setBannerFile(null);
          if (slot === "badge") setBadgeFile(null);
        }
      }
      setLogoFile(null);
      setBannerFile(null);
      setBadgeFile(null);
      setRemoveMedia({ logo: false, banner: false, badge: false });
      await load(payload.data.id);
      setMessage({
        kind: "success",
        text: `${payload.data.name} was saved${current.revision !== payload.data.revision ? " with new media" : ""}.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: persisted
          ? `Team metadata was saved, but a media action failed: ${
              error instanceof Error ? error.message : "retry the remaining image"
            }. The latest saved revision was retained.`
          : error instanceof Error
            ? error.message
            : "The team could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  const previewStyle = useMemo(
    () =>
      ({
        "--team-accent": draft.effect.accentColor,
        "--team-glow": `${draft.effect.intensity * 10}px`,
      }) as CSSProperties,
    [draft.effect.accentColor, draft.effect.intensity],
  );
  const activityGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        seriesId: string;
        seriesSlug: string;
        seriesTitle: string;
        chapters: TeamRecord["activity"];
      }
    >();
    for (const chapter of draft.activity) {
      const group = groups.get(chapter.seriesId) ?? {
        seriesId: chapter.seriesId,
        seriesSlug: chapter.seriesSlug,
        seriesTitle: chapter.seriesTitle,
        chapters: [],
      };
      group.chapters.push(chapter);
      groups.set(chapter.seriesId, group);
    }
    return [...groups.values()];
  }, [draft.activity]);

  return (
    <>
    <AdminPageScaffold
      breadcrumbs={["Teams", "Directory"]}
      kicker="People, permissions & identity"
      title="Directory"
      description="Manage public identity, active affiliations, series permissions, and safe discussion effects without changing upload authorization."
      state={
        loading
          ? { kind: "loading", message: "Loading teams and affiliations…" }
          : !hasLoaded
            ? {
                kind: "error",
                title: "Teams could not be loaded",
                message:
                  message?.text ??
                  "The saved team records are temporarily unavailable.",
                onRetry: () => void load(),
              }
          : { kind: "ready" }
      }
      message={message}
      primaryAction={hasLoaded ? (
        <Link className="button button-primary" href="/dashboard/my-teams">
          <Plus size={17} /> Community team form
        </Link>
      ) : null}
    >
      <div className="admin-master-detail">
        <aside className="admin-record-list">
          <label className="admin-search-field">
            <span>Search teams</span>
            <input
              value={query}
              disabled={dirty}
              title={
                dirty
                  ? "Save or reset the current team before searching."
                  : undefined
              }
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Name or slug"
            />
          </label>
          <button
            className="button button-ghost"
            type="button"
            disabled={dirty}
            title={
              dirty
                ? "Save or reset the current team before refreshing."
                : undefined
            }
            onClick={() => void load()}
          >
            <ArrowClockwise size={16} /> Refresh
          </button>
          {dirty ? (
            <small className="admin-disabled-reason">
              Save or reset this team before changing the list.
            </small>
          ) : null}
          {teams.map((team) => (
            <button
              type="button"
              key={team.id}
              aria-current={selectedId === team.id ? "true" : undefined}
              onClick={() => select(team)}
            >
              <span className="admin-list-avatar">
                {team.logoUrl ? (
                  <img src={team.logoUrl} alt="" />
                ) : (
                  team.name.slice(0, 2).toUpperCase()
                )}
              </span>
              <span>
                <strong>{team.name}</strong>
                <small>
                  {team.memberCount} members · {team.seriesCount} series
                </small>
              </span>
              <em>{team.isArchived ? "Archived" : team.verificationStatus}</em>
            </button>
          ))}
          <footer className="admin-pagination">
            <span>
              {total ? (page - 1) * 20 + 1 : 0}–
              {Math.min(total, page * 20)} of {total}
            </span>
            <button
              type="button"
              disabled={page <= 1 || dirty}
              title={
                dirty
                  ? "Save or reset this team before changing pages."
                  : undefined
              }
              onClick={() => {
                setPage((value) => Math.max(1, value - 1));
              }}
            >
              <CaretLeft size={15} /> Previous
            </button>
            <button
              type="button"
              disabled={page * 20 >= total || dirty}
              title={
                dirty
                  ? "Save or reset this team before changing pages."
                  : undefined
              }
              onClick={() => {
                setPage((value) => value + 1);
              }}
            >
              Next <CaretRight size={15} />
            </button>
          </footer>
        </aside>

        <div className="admin-team-editor-stack">
          <form
            className="admin-detail-form team-editor-page"
            onSubmit={saveTeam}
          >
          <section className="admin-editor-box team-editor-common-section">
            <div className="admin-form-section">
              <div className="admin-section-heading">
                <span>01</span>
                <div>
                  <h3>Identity</h3>
                  <p>Preferred public name, stable URL, and team description.</p>
                </div>
              </div>
              <div className="admin-form-grid">
                <label>
                  Public team reference
                  <output className="admin-readonly-value"><code>{draft.publicRef || "Assigned after creation"}</code>{draft.publicRef ? <button className="button button-secondary" type="button" onClick={() => void navigator.clipboard.writeText(draft.publicRef)}><Copy size={15} /> Copy</button> : null}</output>
                  <small>Immutable TM- reference used by Bot API integrations. It cannot be edited or regenerated.</small>
                </label>
                <label>
                  Team name <b>Required</b>
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    value={draft.name}
                    readOnly={Boolean(draft.id)}
                    aria-readonly={Boolean(draft.id)}
                    onChange={(event) => {
                      const name = event.target.value;
                      setDraft((current) => ({
                        ...current,
                        name,
                        slug: current.id
                          ? current.slug
                          : name
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, "-")
                              .replace(/^-|-$/g, ""),
                      }));
                    }}
                  />
                  {draft.id ? <small>Permanent title. Use Team requests to approve a formal rename.</small> : null}
                </label>
                <label>
                  URL slug <b>Required</b>
                  <input
                    required
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    value={draft.slug}
                    disabled={Boolean(draft.id)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        slug: event.target.value.toLowerCase(),
                      }))
                    }
                  />
                </label>
              </div>
              <label>
                Team description <b>Required</b>
                <textarea
                  required
                  minLength={12}
                  maxLength={2000}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          </section>

          <section className="admin-editor-box team-editor-common-section">
            <div className="admin-form-section">
              <div className="admin-section-heading">
                <Eye size={22} />
                <div>
                  <h3>Status & visibility</h3>
                  <p>
                    Control review state, directory availability, and the
                    team&apos;s fixed reader-page permission.
                  </p>
                </div>
              </div>
              <label>
                Verification status
                <UnifiedSingleSelect
                  value={draft.verificationStatus}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      verificationStatus: event.target
                        .value as TeamDraft["verificationStatus"],
                    }))
                  }
                >
                  <option value="PENDING">Pending review</option>
                  <option
                    value="VERIFIED"
                    disabled={saved.verificationStatus === "PENDING"}
                  >
                    Verified
                    {saved.verificationStatus === "PENDING"
                      ? " · approve ownership request first"
                      : ""}
                  </option>
                  <option value="SUSPENDED">Suspended</option>
                </UnifiedSingleSelect>
              </label>
              <label className="admin-check-row">
                <input
                  type="checkbox"
                  checked={draft.isArchived}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      isArchived: event.target.checked,
                    }))
                  }
                />
                Archive this team and remove it from new assignments
              </label>
              <label className="admin-check-row">
                <input
                  type="checkbox"
                  checked={draft.canControlFixedReaderPages}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      canControlFixedReaderPages: event.target.checked,
                    }))
                  }
                />
                Allow this team to choose whether the global first and last
                reader pages appear on its uploaded chapters
              </label>
            </div>
          </section>

          <section className="admin-editor-box team-editor-common-section">
            <div className="admin-form-section admin-team-members">
              <header className="admin-section-heading">
                <UsersThree size={22} />
                <div>
                  <h3>Members</h3>
                  <p>
                    Add staff and manage team roles without changing the
                    permanent team title.
                  </p>
                </div>
              </header>
              {draft.id ? (
                <section className="v46-team-member-control">
                  <div>
                    <label>
                      <span>Find a user</span>
                      <div className="v46-member-search">
                        <MagnifyingGlass size={18} />
                        <input
                          type="search"
                          value={memberQuery}
                          placeholder="Name, email, or user ID"
                          onChange={(event) =>
                            setMemberQuery(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void searchMembers();
                            }
                          }}
                        />
                      </div>
                    </label>
                    <label>
                      <span>Team role</span>
                      <UnifiedSingleSelect
                        value={newMemberRole}
                        onChange={(event) =>
                          setNewMemberRole(
                            event.target.value as typeof newMemberRole,
                          )
                        }
                      >
                        <option value="UPLOADER">Uploader</option>
                        <option value="LEADER">Leader</option>
                        <option value="OWNER">Owner</option>
                      </UnifiedSingleSelect>
                    </label>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={
                        memberQuery.trim().length < 2 || Boolean(memberBusy)
                      }
                      onClick={() => void searchMembers()}
                    >
                      Search
                    </button>
                  </div>
                  {memberResults.length ? (
                    <div className="v46-member-selection">
                      <label>
                        <span>User match</span>
                        <AdminCombobox
                          ariaLabel="Choose a user from directory matches"
                          value={selectedMemberId}
                          options={memberResults.map((user) => ({
                            value: user.id,
                            label: user.displayName,
                            description: `${user.email}${
                              user.membershipStatus === "ACTIVE"
                                ? " · Already active"
                                : ""
                            }`,
                          }))}
                          placeholder="Choose a matching user…"
                          onChange={setSelectedMemberId}
                          disabled={Boolean(memberBusy)}
                        />
                      </label>
                      <button
                        className="button button-primary"
                        type="button"
                        disabled={
                          !selectedMember ||
                          selectedMember.membershipStatus === "ACTIVE" ||
                          Boolean(memberBusy)
                        }
                        onClick={() =>
                          selectedMember
                            ? void addMember(selectedMember.id)
                            : undefined
                        }
                      >
                        <Plus size={15} /> Add member
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}
              {draft.id && draft.members.length ? (
                draft.members.map((member) => (
                  <article key={member.userId}>
                    <span className="admin-list-avatar">
                      {member.displayName.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <strong>{member.displayName}</strong>
                      <small>
                        {member.email}
                        {member.isPrimary ? " · Primary team" : ""}
                      </small>
                    </div>
                    <label>
                      <span className="sr-only">
                        Role for {member.displayName}
                      </span>
                      <UnifiedSingleSelect
                        value={member.role}
                        disabled={dirty || Boolean(memberBusy) || saving}
                        title={
                          dirty
                            ? "Save or reset the team before changing member access."
                            : undefined
                        }
                        onChange={(event) =>
                          void updateMember(member, {
                            role: event.target.value,
                          })
                        }
                      >
                        <option value="OWNER">Owner</option>
                        <option value="LEADER">Leader</option>
                        <option value="UPLOADER">Uploader</option>
                      </UnifiedSingleSelect>
                    </label>
                    <button
                      type="button"
                      className="v46-icon-danger"
                      disabled={
                        dirty ||
                        Boolean(memberBusy) ||
                        saving ||
                        member.status !== "ACTIVE"
                      }
                      aria-label={`Remove ${member.displayName} from ${draft.name}`}
                      onClick={() =>
                        void updateMember(member, { remove: true })
                      }
                    >
                      <Trash size={17} />
                    </button>
                    {memberBusy === member.userId ? (
                      <DotsRing size="sm" label={null} />
                    ) : (
                      <ShieldCheck size={18} />
                    )}
                  </article>
                ))
              ) : (
                <div className="admin-state-card">
                  <UsersThree size={24} />
                  <h3>No team members yet</h3>
                  <p>
                    Search an existing user above, then assign Owner, Leader,
                    or Uploader.
                  </p>
                </div>
              )}
            </div>
          </section>

          <details className="team-editor-advanced">
            <summary>
              <div>
                <strong>Advanced</strong>
                <span>
                  Media, public staff effects, series relationships, and
                  chapter activity.
                </span>
              </div>
              <CaretDown size={18} aria-hidden="true" />
            </summary>
            <div className="team-editor-advanced-content">
          <section
            id="team-editor-panel-media"
            className="admin-editor-box"
          >
            <div className="admin-media-grid">
              <AdminMediaField
                label="Team logo"
                helperText="Used on team cards and public identity surfaces."
                recommendedDimensions="800 × 800 px"
                currentUrl={draft.logoUrl}
                file={logoFile}
                accept="image/png,image/jpeg,image/webp"
                cropProfile={{
                  aspect: 1,
                  outputWidth: 800,
                  outputHeight: 800,
                  maxBytes: 1_500_000,
                }}
                disabledReason={!draft.id ? "Save the team identity before uploading media." : undefined}
                busy={saving}
                onSelect={(file) => selectMedia("logo", file)}
                onRemove={() => removeMediaSlot("logo")}
              />
              <AdminMediaField
                label="Team banner"
                helperText="Wide artwork for the team header and promotional placements."
                recommendedDimensions="1920 × 640 px"
                currentUrl={draft.bannerUrl}
                file={bannerFile}
                accept="image/png,image/jpeg,image/webp"
                cropProfile={{
                  aspect: 3,
                  outputWidth: 1920,
                  outputHeight: 640,
                  maxBytes: 2_500_000,
                }}
                disabledReason={!draft.id ? "Save the team identity before uploading media." : undefined}
                busy={saving}
                onSelect={(file) => selectMedia("banner", file)}
                onRemove={() => removeMediaSlot("banner")}
              />
            </div>
          </section>

          <section
            id="team-editor-panel-series"
            className="admin-editor-box"
          >
            <div className="admin-form-section">
              <div className="admin-section-heading">
                <ShieldCheck size={22} />
                <div>
                  <h3>Series relationships</h3>
                  <p>Relationships are edited in Series management so primary-team rules remain transactional.</p>
                </div>
              </div>
              <div className="admin-data-list">
                {draft.series.length ? (
                  draft.series.map((series) => (
                    <details className="admin-team-series-disclosure" key={series.seriesId}>
                      <summary>
                        <div>
                          <strong>{series.title}</strong>
                          <small>/{series.slug}</small>
                        </div>
                        <span>{series.isPrimary ? "Primary" : "Assigned"}</span>
                        <CaretDown size={17} aria-hidden="true" />
                      </summary>
                      <div className="admin-team-series-details">
                        <dl>
                          <div><dt>Chapters</dt><dd>{series.chapterCount}</dd></div>
                          <div><dt>Published</dt><dd>{series.publishedCount}</dd></div>
                          <div><dt>Latest release</dt><dd>{series.latestReleaseAt ? new Date(series.latestReleaseAt).toLocaleDateString() : "None"}</dd></div>
                        </dl>
                        <p>
                          <span>{series.canUpload ? "Uploads allowed" : "No upload permission"}</span>
                          <span>{series.canPublish ? "Direct publishing" : "Review required"}</span>
                        </p>
                        <footer>
                          <a className="button button-secondary" href={`/onyx/admin/access/series/${series.seriesId}`}>Manage series</a>
                          <a className="button button-secondary" href={`/title/${series.slug}`} target="_blank" rel="noreferrer">Public view</a>
                        </footer>
                      </div>
                    </details>
                  ))
                ) : (
                  <p>No series are assigned to this team.</p>
                )}
              </div>
            </div>
          </section>

          <section
            id="team-editor-panel-staff"
            className="admin-editor-box"
          >
            <div className="admin-form-section">
              <header className="admin-section-heading">
                <ShieldCheck size={22} />
                <div>
                  <h3>Staff identity</h3>
                  <p>Configure the badge and restrained public affiliation treatment.</p>
                </div>
              </header>
              <AdminMediaField
                label="Staff badge"
                helperText="A compact team-affiliation mark shown only for active eligible members."
                recommendedDimensions="128 × 128 px"
                currentUrl={draft.staffBadgeUrl}
                file={badgeFile}
                accept="image/png,image/jpeg,image/webp"
                cropProfile={{
                  aspect: 1,
                  outputWidth: 128,
                  outputHeight: 128,
                  maxBytes: 300_000,
                }}
                disabledReason={!draft.id ? "Save the team identity before uploading media." : undefined}
                busy={saving}
                onSelect={(file) => selectMedia("badge", file)}
                onRemove={() => removeMediaSlot("badge")}
              />
              <div
                className={`team-effect-preview effect-${draft.effect.type.toLowerCase()}`}
                style={previewStyle}
                data-enabled={draft.effect.enabled ? "true" : "false"}
              >
                <span>{draft.staffBadgeUrl ? <img src={draft.staffBadgeUrl} alt={`${draft.name || "Team"} staff badge`} /> : "NS"}</span>
                <div>
                  <strong>Team member preview</strong>
                  <p>The comment stays readable while the affiliation remains visible.</p>
                  <small>{draft.effect.enabled ? `${draft.effect.type.toLowerCase()} · ${draft.effect.motion.toLowerCase()} motion · intensity ${draft.effect.intensity}` : "Public comment effect disabled"}</small>
                </div>
              </div>
              <div className="admin-form-grid">
                <label>
                  Effect type
                  <UnifiedSingleSelect
                    value={draft.effect.type}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        effect: {
                          ...current.effect,
                          type: event.target.value as TeamDraft["effect"]["type"],
                        },
                      }))
                    }
                  >
                    <option value="NONE">None</option>
                    <option value="BORDER">Subtle border</option>
                    <option value="GLOW">Glow</option>
                    <option value="ACCENT">Background accent</option>
                    <option value="SPARKLE">Small decoration</option>
                    <option value="VERIFIED">Verified treatment</option>
                  </UnifiedSingleSelect>
                </label>
                <div className="team-effect-color-field">
                  <span>Accent color</span>
                  <PremiumColorPicker value={draft.effect.accentColor} label="Accent color" onChange={(next) => setDraft((current) => ({ ...current, effect: { ...current.effect, accentColor: next.slice(0, 7) } }))} />
                </div>
                <label>
                  Intensity
                  <UnifiedSingleSelect
                    value={draft.effect.intensity}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        effect: { ...current.effect, intensity: Number(event.target.value) },
                      }))
                    }
                  >
                    <option value="1">Low</option>
                    <option value="2">Medium</option>
                    <option value="3">High</option>
                  </UnifiedSingleSelect>
                </label>
                <label>
                  Motion
                  <UnifiedSingleSelect
                    value={draft.effect.motion}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        effect: {
                          ...current.effect,
                          motion: event.target.value as "NONE" | "SUBTLE",
                        },
                      }))
                    }
                  >
                    <option value="NONE">No motion</option>
                    <option value="SUBTLE">Subtle motion</option>
                  </UnifiedSingleSelect>
                </label>
              </div>
              <label className="admin-check-row">
                <input
                  type="checkbox"
                  checked={draft.effect.enabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      effect: { ...current.effect, enabled: event.target.checked },
                    }))
                  }
                />
                Enable the comment effect independently from the badge
              </label>
            </div>
          </section>

          <section
            id="team-editor-panel-activity"
            className="admin-editor-box"
          >
            <div className="admin-team-activity">
              <AdminStatGrid>
                <AdminStatTile icon={<UsersThree size={19} />} label="Members" value={draft.memberCount} caption="Active staff" />
                <AdminStatTile icon={<Books size={19} />} label="Series" value={draft.seriesCount} caption="Assigned titles" />
                <AdminStatTile icon={<Images size={19} />} label="Releases" value={draft.releaseCount} caption="All linked chapters" />
              </AdminStatGrid>
              {draft.activity.length ? (
                <div className="admin-team-activity-list">
                  {activityGroups.map((group) => (
                    <details className="admin-team-activity-series" key={group.seriesId}>
                      <summary>
                        <div><strong>{group.seriesTitle}</strong><small>/{group.seriesSlug}</small></div>
                        <span>{group.chapters.length} recent {group.chapters.length === 1 ? "chapter" : "chapters"}</span>
                        <CaretDown size={17} aria-hidden="true" />
                      </summary>
                      <div>
                        {group.chapters.map((chapter) => (
                          <details className="admin-team-chapter-disclosure" key={chapter.chapterId}>
                            <summary>
                              <div>
                                <strong>Chapter {chapter.chapterNumber}</strong>
                                <small>{chapter.chapterTitle || `${chapter.language.toUpperCase()} release`} · v{chapter.version} · {chapter.accessType.toLowerCase()}</small>
                              </div>
                              <span className={`admin-release-state is-${chapter.state.toLowerCase()}`}>{chapter.state.replaceAll("_", " ")}</span>
                              <CaretDown size={16} aria-hidden="true" />
                            </summary>
                            <div className="admin-team-chapter-details">
                              <div className="admin-team-activity-meta">
                                <span><Clock size={15} /> {new Date(chapter.publishedAt ?? chapter.createdAt).toLocaleString()}</span>
                                <span><UsersThree size={15} /> {chapter.uploaderName ?? "System uploader"}</span>
                                <span><Images size={15} /> {chapter.pageCount} pages</span>
                                <span><ChatCircle size={15} /> {chapter.commentCount} comments</span>
                                <span><WarningCircle size={15} /> {chapter.reportCount} reports</span>
                                <span><Smiley size={15} /> {chapter.reactionCount} reactions</span>
                              </div>
                              <footer>
                                <a className="button button-secondary" href={`/onyx/admin/access/series/${chapter.seriesId}/chapters/${chapter.chapterId}`}><Eye size={16} /> Preview images</a>
                                {chapter.state === "PUBLISHED" ? <a className="button button-secondary" href={`/title/${chapter.seriesSlug}/chapter/${chapter.chapterSlug}`} target="_blank" rel="noreferrer"><Eye size={16} /> Public view</a> : null}
                                <button className="button button-secondary" type="button" disabled={dirty || Boolean(chapterBusy) || saving || chapter.state === "DRAFT"} title={dirty ? "Save or reset the team before using chapter quick actions." : undefined} onClick={() => requestChapterHide(chapter)}><EyeSlash size={16} /> {chapterBusy === chapter.chapterId ? "Hiding…" : "Move to draft"}</button>
                              </footer>
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : <p>No uploaded chapters are linked to this team yet.</p>}
            </div>
          </section>
            </div>
          </details>

          <footer className="admin-sticky-actions">
            <small>
              {dirty ? "Unsaved changes" : draft.id ? "All changes saved" : "New team draft"}
            </small>
            <button
              className="button button-secondary"
              type="button"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(saved);
                setLogoFile(null);
                setBannerFile(null);
                setBadgeFile(null);
                setRemoveMedia({ logo: false, banner: false, badge: false });
              }}
            >
              Reset
            </button>
            <button
              className="button button-primary"
              disabled={
                saving ||
                !dirty ||
                draft.name.length < 2 ||
                draft.description.length < 12 ||
                !draft.slug
              }
            >
              {saving ? "Saving…" : draft.id ? "Save team" : "Create team"}
            </button>
          </footer>
          </form>
        </div>
      </div>
    </AdminPageScaffold>
      <ConfirmActionDialog
        open={Boolean(confirmation)}
        title={
          confirmation?.kind === "DISCARD_CHANGES"
            ? "Discard unsaved team changes?"
            : "Move this chapter to draft?"
        }
        description={
          confirmation?.kind === "DISCARD_CHANGES"
            ? `Your unpublished edits to ${draft.name || "this team"} will be lost before opening ${confirmation.team.name}.`
            : confirmation?.kind === "HIDE_CHAPTER"
              ? `${confirmation.chapter.seriesTitle} chapter ${confirmation.chapter.chapterNumber} will leave the public site and return to a private draft.`
              : "Confirm this team action."
        }
        confirmLabel={
          confirmation?.kind === "DISCARD_CHANGES"
            ? "Discard and switch"
            : "Move to draft"
        }
        destructive={confirmation?.kind === "DISCARD_CHANGES"}
        busy={Boolean(chapterBusy)}
        onCancel={() => {
          if (!chapterBusy) setConfirmation(null);
        }}
        onConfirm={() => {
          const pending = confirmation;
          if (!pending) return;
          if (pending.kind === "DISCARD_CHANGES") {
            applySelection(pending.team);
            setConfirmation(null);
            return;
          }
          void hideChapter(pending.chapter).finally(() =>
            setConfirmation(null),
          );
        }}
      />
    </>
  );
}
