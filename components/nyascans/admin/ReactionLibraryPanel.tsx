"use client";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
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
  useRef,
  useState,
} from "react";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import {
  optimizeReactionAsset,
  REACTION_ASSET_LIMIT,
} from "@/lib/client/reaction-media";
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
  usageKind: "REACTION" | "COMMENT_GIF";
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
  | "usageKind"
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
  usageKind: "REACTION",
  availability: { scope: "GLOBAL", teamIds: [] },
  isArchived: false,
  usageCount: 0,
};

const chapterReactionSlots = new Set(["upvote", "laugh", "heart", "surprised", "angry", "sad"]);

function formatBytes(value: number) {
  return `${(value / 1_000_000).toFixed(2)} MB`;
}

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
  moderationPanel,
  settingsPanel,
}: {
  moderationPanel?: ReactNode;
  settingsPanel?: ReactNode;
}) {
  const [workspaceTab, setWorkspaceTab] = useState<
    "moderation" | "library" | "settings"
  >("moderation");
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState<Draft>(emptyDraft);
  const protectedChapterSlot = Boolean(draft.id && chapterReactionSlots.has(draft.slug));
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [removeAsset, setRemoveAsset] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState("ALL");
  const [usageFilter, setUsageFilter] = useState<
    "ALL" | "REACTION" | "COMMENT_GIF"
  >("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizationNote, setOptimizationNote] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [removeTarget, setRemoveTarget] = useState<Reaction | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<{
    description: string;
    run: () => void;
  } | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);
  const loadSequence = useRef(0);
  const optimizationSequence = useRef(0);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved) ||
    Boolean(assetFile) ||
    removeAsset;
  useUnsavedChanges(dirty, "custom reaction changes");

  async function load(preferredId?: string, requestedPage = page) {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const [payload, options] = await Promise.all([
        api<{
          data: Reaction[];
          pagination: { page: number; total: number };
        }>(
          `/api/v1/admin/reaction-library?query=${encodeURIComponent(query)}&state=${encodeURIComponent(state)}&usageKind=${encodeURIComponent(usageFilter)}&page=${requestedPage}&limit=24`,
          { cache: "no-store" },
        ),
        api<{ data: { teams: TeamOption[] } }>(
          "/api/v1/admin/series-options?limit=100",
          { cache: "no-store" },
        ),
      ]);
      if (sequence !== loadSequence.current) return;
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
      setOptimizationNote("");
      setRemoveAsset(false);
      setMessage(null);
      setHasLoaded(true);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The reaction library could not be loaded.",
      });
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 160);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, state, usageFilter]);

  useEffect(
    () => () => {
      loadSequence.current += 1;
      optimizationSequence.current += 1;
    },
    [],
  );

  function requestDraftDiscard(description: string, run: () => void) {
    if (optimizing) return;
    if (dirty) {
      setPendingNavigation({ description, run });
      return;
    }
    run();
  }

  function applySelection(reaction: Reaction) {
    setDraft(reaction);
    setSaved(reaction);
    setAssetFile(null);
    setOptimizationNote("");
    setRemoveAsset(false);
    setMessage(null);
  }

  function select(reaction: Reaction) {
    requestDraftDiscard(
      "The current reaction draft and asset changes will be discarded before another item opens.",
      () => applySelection(reaction),
    );
  }

  function createReaction() {
    requestDraftDiscard(
      "The current reaction draft and asset changes will be discarded before a new item is created.",
      () => {
        const nextDraft: Draft = {
          ...emptyDraft,
          usageKind:
            usageFilter === "COMMENT_GIF" ? "COMMENT_GIF" : "REACTION",
          displayOrder:
            reactions.reduce(
              (maximum, reaction) => Math.max(maximum, reaction.displayOrder),
              0,
            ) + 10,
        };
        setDraft(nextDraft);
        setSaved(nextDraft);
        setAssetFile(null);
        setOptimizationNote("");
        setRemoveAsset(false);
      },
    );
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
            usageKind: draft.usageKind,
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
  const hasSavedVisual =
    draft.usageKind === "COMMENT_GIF"
      ? Boolean(assetFile || draft.assetUrl)
      : Boolean(assetFile || draft.assetUrl || draft.emojiFallback.trim());
  useEffect(
    () => () => {
      if (assetFile && assetPreviewUrl) URL.revokeObjectURL(assetPreviewUrl);
    },
    [assetFile, assetPreviewUrl],
  );

  return (
    <>
      <AdminPageScaffold
        breadcrumbs={["Community", "Discussions"]}
        kicker="Community systems"
        title="Discussions"
        description="Configure discussion behavior and manage safe reaction buttons and curated comment GIFs."
        tabs={[
          { key: "moderation", label: "Moderation" },
          { key: "settings", label: "Discussion settings" },
          { key: "library", label: "Reactions & GIFs", count: reactions.length },
        ]}
        activeTab={workspaceTab}
        onTabChange={(value) =>
          setWorkspaceTab(
            value as "moderation" | "library" | "settings",
          )
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
              disabled={optimizing}
              onClick={createReaction}
            >
              <Plus size={17} />{" "}
              {usageFilter === "COMMENT_GIF" ? "New GIF" : "New reaction"}
            </button>
          ) : null
        }
      >
        {workspaceTab === "moderation" ? (
          moderationPanel ?? (
            <div className="admin-state-card">
              <h2>Moderation unavailable</h2>
              <p>The global comment moderation service could not be mounted.</p>
            </div>
          )
        ) : workspaceTab === "settings" ? (
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
                  disabled={dirty || optimizing}
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
                <UnifiedSingleSelect
                  value={state}
                  disabled={dirty || optimizing}
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
                </UnifiedSingleSelect>
              </label>
              <label className="admin-search-field">
                <span>Library type</span>
                <UnifiedSingleSelect
                  value={usageFilter}
                  disabled={dirty || optimizing}
                  onChange={(event) => {
                    setUsageFilter(
                      event.target.value as
                        | "ALL"
                        | "REACTION"
                        | "COMMENT_GIF",
                    );
                    setPage(1);
                  }}
                >
                  <option value="ALL">Reactions and GIFs</option>
                  <option value="REACTION">Reaction buttons</option>
                  <option value="COMMENT_GIF">Comment GIFs</option>
                </UnifiedSingleSelect>
              </label>
              <button
                className="button button-ghost"
                type="button"
                disabled={dirty || optimizing}
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
                  disabled={optimizing}
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
                    <small>
                      {reaction.usageKind === "COMMENT_GIF"
                        ? "Comment GIF"
                        : "Reaction"}{" "}
                      · {reaction.usageCount} uses · order{" "}
                      {reaction.displayOrder}
                    </small>
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
                  disabled={page <= 1 || dirty || optimizing}
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
                  disabled={page * 24 >= total || dirty || optimizing}
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
              <details className="admin-editor-box" open>
                <summary className="admin-section-heading">
                  <ArrowsDownUp size={22} />
                  <div>
                    <h3>
                      {draft.usageKind === "COMMENT_GIF"
                        ? "GIF details"
                        : "Reaction details"}
                    </h3>
                    <p>Names, accessible labels, availability, category, and display order are stored centrally.</p>
                  </div>
                </summary>
                <div className="admin-editor-box-body">
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
                      disabled={protectedChapterSlot}
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
                    Library use
                    <UnifiedSingleSelect
                      value={draft.usageKind}
                      disabled={saving || optimizing || protectedChapterSlot}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          usageKind: event.target.value as Draft["usageKind"],
                          emojiFallback:
                            event.target.value === "COMMENT_GIF"
                              ? ""
                              : current.emojiFallback,
                          isActive:
                            event.target.value === "COMMENT_GIF"
                              ? false
                              : current.isActive,
                        }))
                      }
                    >
                      <option value="REACTION">Reaction button</option>
                      <option value="COMMENT_GIF">Comment GIF library</option>
                    </UnifiedSingleSelect>
                  </label>
                  <label>
                    Display order
                    <input
                      type="number"
                      disabled={protectedChapterSlot}
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
                    <UnifiedSingleSelect
                      value={draft.availability.scope}
                      disabled={protectedChapterSlot}
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
                    </UnifiedSingleSelect>
                  </label>
                  {draft.availability.scope === "TEAM" ? (
                    <fieldset className="admin-option-checklist">
                      <legend>Eligible teams</legend>
                      {teamOptions.map((team) => (
                        <label key={team.id}>
                          <input
                            type="checkbox"
                            disabled={protectedChapterSlot}
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
                      protectedChapterSlot ||
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
                  Active and available in the reader{" "}
                  {draft.usageKind === "COMMENT_GIF"
                    ? "GIF picker"
                    : "reaction picker"}
                  </label>
                </div>
              </details>

              <details className="admin-editor-box" open>
                <summary className="admin-section-heading">
                  <ImageIcon size={22} />
                  <div>
                    <h3>
                      {draft.usageKind === "COMMENT_GIF"
                        ? "GIF asset & preview"
                        : "Reaction asset & preview"}
                    </h3>
                    <p>
                      {draft.usageKind === "COMMENT_GIF"
                        ? "Use an animated GIF; it is optimized and verified before readers can select it."
                        : "Images and animations are optimized automatically before upload."}
                    </p>
                  </div>
                </summary>
                <div className="admin-editor-box-body">
                  <AdminMediaField
                    label="Reaction image or animation"
                    helperText="PNG, WebP, GIF, or JPEG. Large images and animated GIFs are compressed automatically."
                    recommendedDimensions="128 × 128 px; maximum 512 × 512 px and 1.25 MB after optimization"
                    currentUrl={draft.assetUrl}
                    file={assetFile}
                    accept="image/png,image/webp,image/gif,image/jpeg"
                    busy={saving || optimizing}
                    onSelect={(file) => {
                      const sequence = ++optimizationSequence.current;
                      if (!file) {
                        setOptimizing(false);
                        setAssetFile(null);
                        setOptimizationNote("");
                        return;
                      }
                      const usageKind = draft.usageKind;
                      setOptimizing(true);
                      setOptimizationNote("Optimizing image…");
                      void optimizeReactionAsset(file)
                        .then((optimized) => {
                          if (sequence !== optimizationSequence.current) return;
                          if (
                            usageKind === "COMMENT_GIF" &&
                            !optimized.animated
                          ) {
                            throw new Error(
                              "Comment GIF entries require an animated GIF file.",
                            );
                          }
                          if (optimized.optimizedBytes > REACTION_ASSET_LIMIT) {
                            throw new Error("The optimized asset is still larger than 1.25 MB.");
                          }
                          setAssetFile(optimized.file);
                          setRemoveAsset(false);
                          setOptimizationNote(
                            `${optimized.animated ? "Animated GIF" : "Image"} optimized from ${formatBytes(optimized.originalBytes)} to ${formatBytes(optimized.optimizedBytes)}.`,
                          );
                        })
                        .catch((error) => {
                          if (sequence !== optimizationSequence.current) return;
                          setAssetFile(null);
                          setOptimizationNote("");
                          setMessage({
                            kind: "error",
                            text:
                              error instanceof Error
                                ? error.message
                                : "The reaction image could not be optimized.",
                          });
                        })
                        .finally(() => {
                          if (sequence === optimizationSequence.current) {
                            setOptimizing(false);
                          }
                        });
                    }}
                    onRemove={() => {
                      setOptimizationNote("");
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
                  {optimizationNote ? (
                    <p className="reaction-optimization-note" role="status">
                      {optimizationNote}
                    </p>
                  ) : null}
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
                </div>
              </details>

              <footer className="admin-sticky-actions">
                {draft.id ? (
                  <button
                    className="button button-danger"
                    type="button"
                    disabled={saving || optimizing}
                    hidden={protectedChapterSlot}
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
                  disabled={!dirty || saving || optimizing}
                  onClick={() => {
                    setDraft(saved);
                    setAssetFile(null);
                    setRemoveAsset(false);
                    setOptimizationNote("");
                  }}
                >
                  Reset
                </button>
                <button
                  className="button button-primary"
                  disabled={
                    saving ||
                    optimizing ||
                    !dirty ||
                    !draft.slug ||
                    !draft.name ||
                    draft.accessibleLabel.length < 2
                  }
                >
                  {saving
                    ? "Saving…"
                    : draft.id
                      ? draft.usageKind === "COMMENT_GIF"
                        ? "Save GIF"
                        : "Save reaction"
                      : draft.usageKind === "COMMENT_GIF"
                        ? "Create GIF"
                        : "Create reaction"}
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
      <ConfirmActionDialog
        open={Boolean(pendingNavigation)}
        title="Discard unsaved reaction changes?"
        description={pendingNavigation?.description ?? ""}
        confirmLabel="Discard and continue"
        destructive
        busy={saving || optimizing}
        onCancel={() => {
          if (!saving && !optimizing) setPendingNavigation(null);
        }}
        onConfirm={() => {
          const navigation = pendingNavigation;
          setPendingNavigation(null);
          navigation?.run();
        }}
      />
    </>
  );
}
