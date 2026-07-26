"use client";

import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Plus,
  ShieldCheck,
  UsersThree,
} from "@phosphor-icons/react";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import {
  AdminPageScaffold,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";

type TeamRecord = {
  id: string;
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
  revision: number;
  memberCount: number;
  seriesCount: number;
  members: Array<{
    userId: string;
    displayName: string;
    email: string;
    role: string;
    status: string;
  }>;
  series: Array<{
    seriesId: string;
    title: string;
    slug: string;
    canUpload: boolean;
    canPublish: boolean;
    isPrimary: boolean;
  }>;
  updatedAt: string;
};

type TeamDraft = Pick<
  TeamRecord,
  | "id"
  | "revision"
  | "name"
  | "slug"
  | "description"
  | "verificationStatus"
  | "isArchived"
  | "effect"
  | "logoUrl"
  | "bannerUrl"
  | "staffBadgeUrl"
> & {
  members: TeamRecord["members"];
  series: TeamRecord["series"];
};

const emptyDraft: TeamDraft = {
  id: "",
  revision: 1,
  name: "",
  slug: "",
  description: "",
  verificationStatus: "PENDING",
  isArchived: false,
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

export function TeamManagementPanel({
  membersPanel,
}: {
  membersPanel?: ReactNode;
}) {
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<TeamDraft>(emptyDraft);
  const [saved, setSaved] = useState<TeamDraft>(emptyDraft);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved) ||
    Boolean(logoFile || bannerFile || badgeFile) ||
    Object.values(removeMedia).some(Boolean);
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

  function select(team: TeamRecord) {
    if (dirty && !window.confirm("Discard unsaved team changes?")) return;
    const next = draftFor(team);
    setSelectedId(team.id);
    setDraft(next);
    setSaved(next);
    setLogoFile(null);
    setBannerFile(null);
    setBadgeFile(null);
    setRemoveMedia({ logo: false, banner: false, badge: false });
    setMessage(null);
  }

  function createTeam() {
    if (dirty && !window.confirm("Discard unsaved team changes?")) return;
    setSelectedId("");
    setDraft(emptyDraft);
    setSaved(emptyDraft);
    setTab("identity");
    setLogoFile(null);
    setBannerFile(null);
    setBadgeFile(null);
    setRemoveMedia({ logo: false, banner: false, badge: false });
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

  return (
    <AdminPageScaffold
      breadcrumbs={["Administration", "Teams"]}
      kicker="People, permissions & identity"
      title="Team management"
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
        <button className="button button-primary" type="button" onClick={createTeam}>
          <Plus size={17} /> New team
        </button>
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
                  // eslint-disable-next-line @next/next/no-img-element
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
          <details className="admin-editor-box" open>
            <summary>Members &amp; roles</summary>
            <div className="admin-detail-form">
              {membersPanel ?? (
                <div className="admin-state-card">
                  <UsersThree size={24} />
                  <h3>No membership editor available</h3>
                  <p>Membership authorization remains unchanged.</p>
                </div>
              )}
            </div>
          </details>
          <form className="admin-detail-form" onSubmit={saveTeam}>
          <details className="admin-editor-box" open>
            <summary>Identity</summary>
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
                  Team name <b>Required</b>
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    value={draft.name}
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
                </label>
                <label>
                  URL slug <b>Required</b>
                  <input
                    required
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    value={draft.slug}
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
          </details>

          <details className="admin-editor-box" open>
            <summary>Logo &amp; banner</summary>
            <div className="admin-media-grid">
              <AdminMediaField
                label="Team logo"
                helperText="Used on team cards and public identity surfaces."
                recommendedDimensions="800 × 800 px"
                currentUrl={draft.logoUrl}
                file={logoFile}
                accept="image/png,image/jpeg,image/webp"
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
                disabledReason={!draft.id ? "Save the team identity before uploading media." : undefined}
                busy={saving}
                onSelect={(file) => selectMedia("banner", file)}
                onRemove={() => removeMediaSlot("banner")}
              />
            </div>
          </details>

          <details className="admin-editor-box">
            <summary>Series relationships</summary>
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
                    <article key={series.seriesId}>
                      <div>
                        <strong>{series.title}</strong>
                        <small>/{series.slug}</small>
                      </div>
                      <span>{series.isPrimary ? "Primary" : "Assigned"}</span>
                      <em>
                        {series.canUpload ? "Upload" : "No upload"} ·{" "}
                        {series.canPublish ? "Publish" : "Review required"}
                      </em>
                    </article>
                  ))
                ) : (
                  <p>No series are assigned to this team.</p>
                )}
              </div>
            </div>
          </details>

          <details className="admin-editor-box">
            <summary>Staff identity</summary>
            <div className="admin-form-section">
              <AdminMediaField
                label="Staff badge"
                helperText="A compact team-affiliation mark shown only for active eligible members."
                recommendedDimensions="128 × 128 px"
                currentUrl={draft.staffBadgeUrl}
                file={badgeFile}
                accept="image/png,image/jpeg,image/webp"
                disabledReason={!draft.id ? "Save the team identity before uploading media." : undefined}
                busy={saving}
                onSelect={(file) => selectMedia("badge", file)}
                onRemove={() => removeMediaSlot("badge")}
              />
              <div
                className={`team-effect-preview effect-${draft.effect.type.toLowerCase()}`}
                style={previewStyle}
              >
                <span>{draft.staffBadgeUrl ? "Badge" : "NS"}</span>
                <div>
                  <strong>Team member preview</strong>
                  <p>The comment stays readable while the affiliation remains visible.</p>
                </div>
              </div>
              <div className="admin-form-grid">
                <label>
                  Effect type
                  <select
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
                  </select>
                </label>
                <label>
                  Accent color
                  <input
                    type="color"
                    value={draft.effect.accentColor}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        effect: { ...current.effect, accentColor: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  Intensity
                  <select
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
                  </select>
                </label>
                <label>
                  Motion
                  <select
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
                  </select>
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
          </details>

          <details className="admin-editor-box">
            <summary>Visibility</summary>
            <div className="admin-form-section">
              <label>
                Verification status
                <select
                  value={draft.verificationStatus}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      verificationStatus: event.target.value as TeamDraft["verificationStatus"],
                    }))
                  }
                >
                  <option value="PENDING">Pending review</option>
                  <option value="VERIFIED">Verified</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
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
            </div>
          </details>

          <details className="admin-editor-box">
            <summary>Activity</summary>
            <div className="admin-summary-grid">
              <article><strong>{draft.members.length}</strong><span>Members</span></article>
              <article><strong>{draft.series.length}</strong><span>Series</span></article>
              <article><strong>{draft.revision}</strong><span>Record version</span></article>
              <p>Detailed immutable changes are available in the owner-only Audit Log.</p>
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
  );
}
