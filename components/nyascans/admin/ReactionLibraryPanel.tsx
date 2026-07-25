"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  ArrowsDownUp,
  CaretLeft,
  CaretRight,
  Image as ImageIcon,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import {
  AdminPageScaffold,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";

type Reaction = {
  id: string;
  slug: string;
  name: string;
  accessibleLabel: string;
  emojiFallback: string;
  assetUrl: string | null;
  contentType: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  isAnimated: boolean;
  isActive: boolean;
  isArchived: boolean;
  displayOrder: number;
  category: string | null;
  availability: {
    scope: "GLOBAL" | "SIGNED_IN" | "TEAM";
    teamIds: string[];
  };
  revision: number;
  usageCount: number;
  updatedAt: string;
};

type Draft = Pick<
  Reaction,
  | "id"
  | "revision"
  | "slug"
  | "name"
  | "accessibleLabel"
  | "emojiFallback"
  | "assetUrl"
  | "isActive"
  | "displayOrder"
  | "category"
  | "availability"
  | "isArchived"
  | "usageCount"
>;

type TeamOption = {
  id: string;
  name: string;
  verificationStatus: string;
};

const emptyDraft: Draft = {
  id: "",
  revision: 1,
  slug: "",
  name: "",
  accessibleLabel: "",
  emojiFallback: "",
  assetUrl: null,
  isActive: false,
  displayOrder: 100,
  category: null,
  availability: { scope: "GLOBAL", teamIds: [] },
  isArchived: false,
  usageCount: 0,
};

async function api<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The reaction action failed.");
  }
  return payload;
}

export function ReactionLibraryPanel({
  settingsPanel,
}: {
  settingsPanel?: ReactNode;
}) {
  const [workspaceTab, setWorkspaceTab] = useState<"library" | "settings">(
    "library",
  );
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState<Draft>(emptyDraft);
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [removeAsset, setRemoveAsset] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [removeTarget, setRemoveTarget] = useState<Reaction | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved) ||
    Boolean(assetFile) ||
    removeAsset;
  useUnsavedChanges(dirty, "custom reaction changes");

  async function load(preferredId?: string, requestedPage = page) {
    setLoading(true);
    try {
      const [payload, options] = await Promise.all([
        api<{
          data: Reaction[];
          pagination: { page: number; total: number };
        }>(
          `/api/v1/admin/reaction-library?query=${encodeURIComponent(query)}&state=${encodeURIComponent(state)}&page=${requestedPage}&limit=24`,
          { cache: "no-store" },
        ),
        api<{ data: { teams: TeamOption[] } }>(
          "/api/v1/admin/series-options?limit=100",
          { cache: "no-store" },
        ),
      ]);
      setTeamOptions(options.data.teams);
      setReactions(payload.data);
      setPage(payload.pagination.page);
      setTotal(payload.pagination.total);
      const selected =
        payload.data.find((reaction) => reaction.id === preferredId) ??
        payload.data.find((reaction) => reaction.id === draft.id) ??
        payload.data[0];
      if (selected) {
        setDraft(selected);
        setSaved(selected);
      } else {
        setDraft(emptyDraft);
        setSaved(emptyDraft);
      }
      setAssetFile(null);
      setRemoveAsset(false);
      setMessage(null);
      setHasLoaded(true);
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The reaction library could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 160);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, state]);

  function select(reaction: Reaction) {
    if (dirty && !window.confirm("Discard unsaved reaction changes?")) return;
    setDraft(reaction);
    setSaved(reaction);
    setAssetFile(null);
    setRemoveAsset(false);
    setMessage(null);
  }

  function createReaction() {
    if (dirty && !window.confirm("Discard unsaved reaction changes?")) return;
    setDraft({
      ...emptyDraft,
      displayOrder:
        reactions.reduce(
          (maximum, reaction) => Math.max(maximum, reaction.displayOrder),
          0,
        ) + 10,
    });
    setSaved(emptyDraft);
    setAssetFile(null);
    setRemoveAsset(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    let persisted: Draft | null = null;
    const applyPersisted = (next: Draft) => {
      persisted = next;
      setDraft(next);
      setSaved(next);
    };
    try {
      const isEdit = Boolean(draft.id);
      const result = await api<{ data: Reaction }>(
        "/api/v1/admin/reaction-library",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(isEdit ? { id: draft.id, revision: draft.revision } : {}),
            slug: draft.slug,
            name: draft.name,
            accessibleLabel: draft.accessibleLabel,
            emojiFallback: draft.emojiFallback,
            isActive: draft.isActive,
            displayOrder: draft.displayOrder,
            category: draft.category || null,
            availability: draft.availability,
          }),
        },
      );
      let current: Draft = result.data;
      applyPersisted(current);
      if (removeAsset) {
        const media = await api<{
          data: { revision: number; assetUrl: null };
        }>(
          `/api/v1/admin/reaction-media?reactionId=${encodeURIComponent(result.data.id)}&revision=${current.revision}`,
          { method: "DELETE" },
        );
        current = {
          ...current,
          revision: media.data.revision,
          assetUrl: media.data.assetUrl,
        };
        applyPersisted(current);
        setRemoveAsset(false);
      }
      if (assetFile) {
        const form = new FormData();
        form.set("reactionId", result.data.id);
        form.set("revision", String(current.revision));
        form.set("file", assetFile);
        const media = await api<{
          data: { revision: number; assetUrl: string };
        }>("/api/v1/admin/reaction-media", { method: "PUT", body: form });
        current = {
          ...current,
          revision: media.data.revision,
          assetUrl: media.data.assetUrl,
        };
        applyPersisted(current);
        setAssetFile(null);
      }
      setAssetFile(null);
      setRemoveAsset(false);
      await load(result.data.id);
      setMessage({
        kind: "success",
        text: `${result.data.name} was saved at version ${current.revision}.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: persisted
          ? `Reaction metadata was saved, but its media action failed: ${
              error instanceof Error ? error.message : "retry the remaining asset"
            }. The latest saved revision was retained.`
          : error instanceof Error
            ? error.message
            : "The reaction could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!removeTarget) return;
    setSaving(true);
    try {
      await api<{
        data: { archived: boolean; deleted: boolean };
      }>(
        `/api/v1/admin/reaction-library?id=${encodeURIComponent(removeTarget.id)}&revision=${removeTarget.revision}`,
        { method: "DELETE" },
      );
      setRemoveTarget(null);
      await load();
      setMessage({
        kind: "success",
        text: "The reaction was archived so historical counts and media remain valid.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "The reaction was not removed.",
      });
    } finally {
      setSaving(false);
    }
  }

  const previewLabel = useMemo(
    () => draft.accessibleLabel || draft.name || "Reaction preview",
    [draft.accessibleLabel, draft.name],
  );
  const assetPreviewUrl = useMemo(
    () => (assetFile ? URL.createObjectURL(assetFile) : draft.assetUrl),
    [assetFile, draft.assetUrl],
  );
  const hasSavedVisual = Boolean(
    draft.assetUrl || draft.emojiFallback.trim(),
  );
  useEffect(
    () => () => {
      if (assetFile && assetPreviewUrl) URL.revokeObjectURL(assetPreviewUrl);
    },
    [assetFile, assetPreviewUrl],
  );

  return (
    <>
      <AdminPageScaffold
        breadcrumbs={["Administration", "Discussions"]}
        kicker="Community systems"
        title="Discussions & reactions"
        description="Configure discussion behavior and manage a safe, database-backed custom reaction library."
        tabs={[
          { key: "library", label: "Reaction library", count: reactions.length },
          { key: "settings", label: "Discussion settings" },
        ]}
        activeTab={workspaceTab}
        onTabChange={(value) =>
          setWorkspaceTab(value as "library" | "settings")
        }
        state={
          workspaceTab === "library" && loading
            ? { kind: "loading", message: "Loading custom reactions…" }
            : workspaceTab === "library" && !hasLoaded
              ? {
                  kind: "error",
                  title: "Reaction library unavailable",
                  message:
                    message?.text ??
                    "The saved reaction library could not be loaded.",
                  onRetry: () => void load(),
                }
            : { kind: "ready" }
        }
        message={message}
        primaryAction={
          workspaceTab === "library" && hasLoaded ? (
            <button
              className="button button-primary"
              type="button"
              onClick={createReaction}
            >
              <Plus size={17} /> New reaction
            </button>
          ) : null
        }
      >
        {workspaceTab === "settings" ? (
          settingsPanel ?? (
            <div className="admin-state-card">
              <h3>Settings unavailable</h3>
              <p>The discussion settings service could not be mounted.</p>
            </div>
          )
        ) : (
          <div className="admin-master-detail">
            <aside className="admin-record-list">
              <label className="admin-search-field">
                <span>Search library</span>
                <input
                  value={query}
                  disabled={dirty}
                  title={
                    dirty
                      ? "Save or reset the current reaction before searching."
                      : undefined
                  }
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Name or identifier"
                />
              </label>
              <label className="admin-search-field">
                <span>Status</span>
                <select
                  value={state}
                  disabled={dirty}
                  title={
                    dirty
                      ? "Save or reset the current reaction before filtering."
                      : undefined
                  }
                  onChange={(event) => {
                    setState(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="ALL">All reactions</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
              <button
                className="button button-ghost"
                type="button"
                disabled={dirty}
                title={
                  dirty
                    ? "Save or reset the current reaction before refreshing."
                    : undefined
                }
                onClick={() => void load()}
              >
                <ArrowClockwise size={16} /> Refresh
              </button>
              {dirty ? (
                <small className="admin-disabled-reason">
                  Save or reset this reaction before changing the list.
                </small>
              ) : null}
              {reactions.map((reaction) => (
                <button
                  type="button"
                  key={reaction.id}
                  aria-current={draft.id === reaction.id ? "true" : undefined}
                  onClick={() => select(reaction)}
                >
                  <span className="reaction-admin-thumb">
                    {reaction.assetUrl ? (
                      <img src={reaction.assetUrl} alt="" />
                    ) : (
                      reaction.emojiFallback || <ImageIcon size={18} />
                    )}
                  </span>
                  <span>
                    <strong>{reaction.name}</strong>
                    <small>{reaction.usageCount} uses · order {reaction.displayOrder}</small>
                  </span>
                  <em>
                    {reaction.isArchived
                      ? "Archived"
                      : reaction.isActive
                        ? "Active"
                        : "Inactive"}
                  </em>
                </button>
              ))}
              <footer className="admin-pagination">
                <span>
                  {total ? (page - 1) * 24 + 1 : 0}–
                  {Math.min(total, page * 24)} of {total}
                </span>
                <button
                  type="button"
                  disabled={page <= 1 || dirty}
                  title={
                    dirty
                      ? "Save or reset this reaction before changing pages."
                      : undefined
                  }
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <CaretLeft size={15} /> Previous
                </button>
                <button
                  type="button"
                  disabled={page * 24 >= total || dirty}
                  title={
                    dirty
                      ? "Save or reset this reaction before changing pages."
                      : undefined
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next <CaretRight size={15} />
                </button>
              </footer>
            </aside>

            <form className="admin-detail-form" onSubmit={save}>
              <div className="admin-form-section">
                <div className="admin-section-heading">
                  <ArrowsDownUp size={22} />
                  <div>
                    <h3>Reaction details</h3>
                    <p>Names, accessible labels, availability, and display order are stored centrally.</p>
                  </div>
                </div>
                <div className="admin-form-grid">
                  <label>
                    Name <b>Required</b>
                    <input
                      required
                      maxLength={80}
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
                                .replace(/^-|-$/g, "")
                                .slice(0, 32),
                        }));
                      }}
                    />
                  </label>
                  <label>
                    Unique identifier <b>Required</b>
                    <input
                      required
                      disabled={Boolean(draft.id)}
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      maxLength={32}
                      value={draft.slug}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          slug: event.target.value.toLowerCase(),
                        }))
                      }
                    />
                    {draft.id ? (
                      <small>
                        Identifiers are immutable because historical reactions
                        reference them.
                      </small>
                    ) : null}
                  </label>
                  <label>
                    Accessible text label <b>Required</b>
                    <input
                      required
                      minLength={2}
                      maxLength={120}
                      value={draft.accessibleLabel}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          accessibleLabel: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Emoji fallback
                    <input
                      maxLength={16}
                      value={draft.emojiFallback}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          emojiFallback: event.target.value,
                          isActive:
                            event.target.value.trim() || current.assetUrl
                              ? current.isActive
                              : false,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Category
                    <input
                      maxLength={80}
                      value={draft.category ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          category: event.target.value || null,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Display order
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={draft.displayOrder}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          displayOrder: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Availability
                    <select
                      value={draft.availability.scope}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          availability: {
                            scope: event.target.value as Draft["availability"]["scope"],
                            teamIds:
                              event.target.value === "TEAM"
                                ? current.availability.teamIds
                                : [],
                          },
                        }))
                      }
                    >
                      <option value="GLOBAL">Everyone</option>
                      <option value="SIGNED_IN">Signed-in users</option>
                      <option value="TEAM">Selected teams</option>
                    </select>
                  </label>
                  {draft.availability.scope === "TEAM" ? (
                    <fieldset className="admin-option-checklist">
                      <legend>Eligible teams</legend>
                      {teamOptions.map((team) => (
                        <label key={team.id}>
                          <input
                            type="checkbox"
                            checked={draft.availability.teamIds.includes(
                              team.id,
                            )}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                availability: {
                                  ...current.availability,
                                  teamIds: event.target.checked
                                    ? [
                                        ...new Set([
                                          ...current.availability.teamIds,
                                          team.id,
                                        ]),
                                      ]
                                    : current.availability.teamIds.filter(
                                        (id) => id !== team.id,
                                      ),
                                },
                              }))
                            }
                          />
                          <span>{team.name}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                </div>
                <label className="admin-check-row">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    disabled={
                      draft.isArchived ||
                      (!draft.isActive && !hasSavedVisual)
                    }
                    title={
                      !hasSavedVisual
                        ? "Save an image or enter an emoji fallback before activation."
                        : undefined
                    }
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  Active and available in the reader reaction picker
                </label>
              </div>

              <AdminMediaField
                label="Reaction image or animation"
                helperText="PNG, WebP, GIF, or JPEG. Transparent formats are preferred; animation is preserved."
                recommendedDimensions="128 × 128 px; maximum 512 × 512 px and 2 MB"
                currentUrl={draft.assetUrl}
                file={assetFile}
                accept="image/png,image/webp,image/gif,image/jpeg"
                disabledReason={!draft.id ? "Create the reaction before uploading an asset." : undefined}
                busy={saving}
                onSelect={(file) => {
                  setAssetFile(file);
                  if (file) setRemoveAsset(false);
                }}
                onRemove={() => {
                  if (assetFile) {
                    setAssetFile(null);
                  } else if (draft.assetUrl) {
                    setRemoveAsset(true);
                    setDraft((current) => ({
                      ...current,
                      assetUrl: null,
                      isActive: current.emojiFallback.trim()
                        ? current.isActive
                        : false,
                    }));
                  }
                }}
              />
              <div className="reaction-live-preview" aria-label={previewLabel}>
                {assetPreviewUrl ? (
                  <img src={assetPreviewUrl} alt={previewLabel} />
                ) : (
                  <span>{draft.emojiFallback || "◎"}</span>
                )}
                <div>
                  <strong>{draft.name || "Reaction preview"}</strong>
                  <small>{draft.accessibleLabel || "Accessible label will appear here"}</small>
                </div>
              </div>

              <footer className="admin-sticky-actions">
                {draft.id ? (
                  <button
                    className="button button-danger"
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      setRemoveTarget(
                        reactions.find((reaction) => reaction.id === draft.id) ?? null,
                      )
                    }
                  >
                    <Trash size={16} /> Archive
                  </button>
                ) : null}
                <small>
                  {dirty
                    ? "Unsaved changes"
                    : draft.id
                      ? `${draft.usageCount} historical uses`
                      : "New reaction draft"}
                </small>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={!dirty || saving}
                  onClick={() => {
                    setDraft(saved);
                    setAssetFile(null);
                  }}
                >
                  Reset
                </button>
                <button
                  className="button button-primary"
                  disabled={
                    saving ||
                    !dirty ||
                    !draft.slug ||
                    !draft.name ||
                    draft.accessibleLabel.length < 2
                  }
                >
                  {saving ? "Saving…" : draft.id ? "Save reaction" : "Create reaction"}
                </button>
              </footer>
            </form>
          </div>
        )}
      </AdminPageScaffold>
      <ConfirmActionDialog
        open={Boolean(removeTarget)}
        title="Archive this reaction?"
        description={`It has ${removeTarget?.usageCount ?? 0} historical uses. It will disappear from the picker while existing counts and its referenced asset remain readable.`}
        confirmLabel="Archive reaction"
        busy={saving}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void archive()}
      />
    </>
  );
}
