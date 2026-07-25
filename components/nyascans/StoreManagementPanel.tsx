"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowUp,
  CaretLeft,
  CaretRight,
  Coins,
  Eye,
  EyeSlash,
  Image as ImageIcon,
  PencilSimple,
  Plus,
  SpinnerGap,
  Storefront,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useUnsavedChanges } from "@/components/nyascans/admin/AdminPageScaffold";

type StoreCollection = {
  id: string;
  slug: string;
  name: string;
  description: string;
  themeKey: string;
  isSeasonal: boolean;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  revision: number;
};

type CollectionFormDraft = Omit<
  StoreCollection,
  "startsAt" | "endsAt"
> & {
  startsAt: string;
  endsAt: string;
};

type NewCollectionFormDraft = Omit<CollectionFormDraft, "id" | "revision">;

type PreviewConfig = {
  from: string;
  to: string;
  accent: string;
  symbol:
    | "SUN"
    | "RING"
    | "SPARK"
    | "WAVE"
    | "INK"
    | "SLASH"
    | "STEEL"
    | "HARBOR"
    | "COIN"
    | "GLYPH"
    | "MOSAIC"
    | "STAR"
    | "COMPASS"
    | "COMET";
};

type StoreItem = {
  id: string;
  slug: string;
  collectionId: string;
  collectionName: string;
  name: string;
  description: string;
  category:
    | "PROFILE_BANNER"
    | "PROFILE_FRAME"
    | "USERNAME_DECORATION"
    | "COMMENT_EFFECT"
    | "COMMENT_GRADIENT"
    | "SEASONAL_PROFILE"
    | "LOGO_EFFECT";
  priceOnyx: number;
  previewUrl: string | null;
  previewConfig: PreviewConfig;
  isPublished: boolean;
  isHidden: boolean;
  sortOrder: number;
  purchaseCount: number;
  revision: number;
};

const defaultPreview: PreviewConfig = {
  from: "#0b4f7d",
  to: "#07111f",
  accent: "#68d5ff",
  symbol: "STAR",
};

const initialCollectionDraft: NewCollectionFormDraft = {
  slug: "",
  name: "",
  description: "",
  themeKey: "SEASONAL",
  isSeasonal: true,
  enabled: true,
  startsAt: "",
  endsAt: "",
  sortOrder: 50,
};

function dateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function apiDate(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid date and time.`);
  }
  return date.toISOString();
}

function collectionFormDraft(
  collection: StoreCollection,
): CollectionFormDraft {
  return {
    ...collection,
    startsAt: dateInput(collection.startsAt),
    endsAt: dateInput(collection.endsAt),
  };
}

function collectionPayload(
  draft: CollectionFormDraft | NewCollectionFormDraft,
) {
  const slug = draft.slug.trim().toLowerCase();
  const name = draft.name.trim();
  const description = draft.description.trim();
  const themeKey = draft.themeKey.trim().toUpperCase();
  const sortOrder = Number(draft.sortOrder);

  if (
    slug.length < 2 ||
    slug.length > 100 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    throw new Error(
      "The collection URL slug must use lowercase letters, numbers, and single hyphens.",
    );
  }
  if (name.length < 2 || name.length > 100) {
    throw new Error("The collection name must contain 2 to 100 characters.");
  }
  if (description.length < 8 || description.length > 400) {
    throw new Error(
      "The collection description must contain 8 to 400 characters.",
    );
  }
  if (
    themeKey.length < 2 ||
    themeKey.length > 40 ||
    !/^[A-Z0-9_]+$/.test(themeKey)
  ) {
    throw new Error(
      "The theme key must use 2 to 40 uppercase letters, numbers, or underscores.",
    );
  }
  if (
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 100_000
  ) {
    throw new Error(
      "The collection display order must be a whole number from 0 to 100,000.",
    );
  }

  const startsAt = apiDate(draft.startsAt, "The collection start");
  const endsAt = apiDate(draft.endsAt, "The collection end");
  if (
    startsAt &&
    endsAt &&
    new Date(endsAt).getTime() <= new Date(startsAt).getTime()
  ) {
    throw new Error("The collection end must be after its start.");
  }

  return {
    ...draft,
    expectedRevision: "revision" in draft ? draft.revision : undefined,
    slug,
    name,
    description,
    themeKey,
    sortOrder,
    startsAt,
    endsAt,
  };
}

function categoryLabel(value: StoreItem["category"]) {
  return {
    PROFILE_BANNER: "Profile banner",
    PROFILE_FRAME: "Animated frame",
    USERNAME_DECORATION: "Username decoration",
    COMMENT_EFFECT: "Comment effect",
    COMMENT_GRADIENT: "Comment gradient",
    SEASONAL_PROFILE: "Seasonal profile",
    LOGO_EFFECT: "Logo effect",
  }[value];
}

async function readJson<T>(response: Response) {
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The Store action failed.");
  }
  return payload;
}

export function StoreManagementPanel({
  categoryFilter,
  defaultCategory = categoryFilter?.[0] ?? "PROFILE_BANNER",
  title = "Store Management",
  showTestingBalance = false,
}: {
  categoryFilter?: readonly StoreItem["category"][];
  defaultCategory?: StoreItem["category"];
  title?: string;
  showTestingBalance?: boolean;
}) {
  const [collections, setCollections] = useState<StoreCollection[]>([]);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StoreItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [newCollectionOpen, setNewCollectionOpen] = useState(false);
  const [collectionDraft, setCollectionDraft] =
    useState<NewCollectionFormDraft>({ ...initialCollectionDraft });
  const [collectionEditorId, setCollectionEditorId] = useState<string | null>(
    null,
  );
  const [collectionEditDraft, setCollectionEditDraft] =
    useState<CollectionFormDraft | null>(null);
  const [grant, setGrant] = useState({
    email: "",
    amount: 1000,
    reason: "Development Store testing balance",
  });
  const [itemQuery, setItemQuery] = useState("");
  const [itemStatus, setItemStatus] = useState<
    "ALL" | "DRAFT" | "PUBLISHED" | "HIDDEN"
  >("ALL");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pendingPreview, setPendingPreview] = useState<{
    itemId: string;
    file: File;
    url: string;
  } | null>(null);
  const [removePreviewPending, setRemovePreviewPending] = useState(false);
  const persistedDraft = draft
    ? items.find((item) => item.id === draft.id) ?? null
    : null;
  const persistedCollection = collectionEditDraft
    ? collections.find(
        (collection) => collection.id === collectionEditDraft.id,
      ) ?? null
    : null;
  const itemDirty = Boolean(
    draft &&
      persistedDraft &&
      JSON.stringify(draft) !== JSON.stringify(persistedDraft),
  );
  const collectionDirty = Boolean(
    collectionEditDraft &&
      persistedCollection &&
      JSON.stringify(collectionEditDraft) !==
        JSON.stringify(collectionFormDraft(persistedCollection)),
  );
  const newCollectionDirty =
    newCollectionOpen &&
    JSON.stringify(collectionDraft) !== JSON.stringify(initialCollectionDraft);
  const mediaDirty = Boolean(pendingPreview) || removePreviewPending;
  const dirty =
    itemDirty || collectionDirty || newCollectionDirty || mediaDirty;
  useUnsavedChanges(dirty, "Store item changes");

  useEffect(
    () => () => {
      if (pendingPreview?.url) URL.revokeObjectURL(pendingPreview.url);
    },
    [pendingPreview?.url],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const categories = categoryFilter?.join(",") ?? "";
      void fetch(
        `/api/v1/admin/store?categories=${encodeURIComponent(categories)}&query=${encodeURIComponent(itemQuery)}&status=${itemStatus}&page=${page}&limit=24`,
        {
        signal: controller.signal,
        cache: "no-store",
        },
      )
        .then((response) =>
          readJson<{
            collections: StoreCollection[];
            items: StoreItem[];
            pagination: { page: number; total: number };
          }>(response),
        )
        .then((payload) => {
          setCollections(payload.collections);
          setItems(payload.items);
          setPage(payload.pagination.page);
          setTotal(payload.pagination.total);
          setSelectedId((currentSelectedId) => {
            const nextId =
              currentSelectedId &&
              payload.items.some((item) => item.id === currentSelectedId)
                ? currentSelectedId
                : payload.items[0]?.id ?? null;
            setDraft(
              nextId
                ? payload.items.find((item) => item.id === nextId) ?? null
                : null,
            );
            return nextId;
          });
          setHasLoaded(true);
        })
        .catch((loadError) => {
          if (!controller.signal.aborted) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "Store Management could not be loaded.",
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 160);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [categoryFilter, itemQuery, itemStatus, page, revision]);

  const visibleItems = items;

  const groupedItems = useMemo(
    () =>
      collections.map((collection) => ({
        collection,
        items: visibleItems.filter(
          (item) => item.collectionId === collection.id,
        ),
      })),
    [collections, visibleItems],
  );

  function selectItem(item: StoreItem) {
    if (
      (itemDirty || mediaDirty) &&
      !window.confirm(
        `Discard unsaved changes to ${draft?.name ?? "the current Store item"}?`,
      )
    ) {
      return;
    }
    setPendingPreview(null);
    setRemovePreviewPending(false);
    setSelectedId(item.id);
    setDraft({ ...item, previewConfig: { ...item.previewConfig } });
    setMessage("");
    setError("");
  }

  async function saveItem(
    item: StoreItem,
    options: { silent?: boolean } = {},
  ) {
    setBusy(item.id);
    setError("");
    try {
      const result = await readJson<{ revision: number }>(
        await fetch("/api/v1/admin/store-items", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...item,
            expectedRevision: item.revision,
          }),
        }),
      );
      const saved = {
        ...item,
        revision: result.revision,
        collectionName:
          collections.find(
            (collection) => collection.id === item.collectionId,
          )?.name ?? item.collectionName,
      };
      setItems((current) =>
        current.map((entry) => (entry.id === saved.id ? saved : entry)),
      );
      setDraft((current) => (current?.id === saved.id ? saved : current));
      if (!options.silent) setMessage(`${item.name} saved.`);
      return saved;
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "The item was not saved.",
      );
    } finally {
      setBusy("");
    }
    return null;
  }

  async function createItem() {
    const collection = collections[0];
    if (!collection) {
      setError("Create a Store collection first.");
      return;
    }
    const suffix = Date.now().toString(36);
    const item = {
      slug: `new-cosmetic-${suffix}`,
      collectionId: collection.id,
      name: "New cosmetic",
      description: "Describe how this Store item appears and what it changes.",
      category: defaultCategory,
      priceOnyx: 200,
      previewConfig: defaultPreview,
      isPublished: false,
      isHidden: false,
      sortOrder: 100,
    };
    setBusy("create-item");
    try {
      const created = await readJson<{ id: string; revision: number }>(
        await fetch("/api/v1/admin/store-items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(item),
        }),
      );
      setSelectedId(created.id);
      setMessage("Draft Store item created. Complete its details before publishing.");
      setRevision((value) => value + 1);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "The Store item draft was not created.",
      );
    } finally {
      setBusy("");
    }
  }

  async function deleteItem(item: StoreItem) {
    if (
      !window.confirm(
        item.purchaseCount
          ? "This item has owners. It will be archived and remain available to them. Continue?"
          : "Permanently delete this unowned Store item?",
      )
    ) {
      return;
    }
    setBusy(item.id);
    try {
      const result = await readJson<{ archived?: boolean; deleted?: boolean }>(
        await fetch(
          `/api/v1/admin/store-items?id=${encodeURIComponent(item.id)}&expectedRevision=${item.revision}`,
          { method: "DELETE" },
        ),
      );
      setMessage(
        result.archived
          ? `${item.name} was archived for existing owners.`
          : `${item.name} was deleted.`,
      );
      setSelectedId(null);
      setDraft(null);
      setPendingPreview(null);
      setRemovePreviewPending(false);
      setRevision((value) => value + 1);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The item was not removed.",
      );
    } finally {
      setBusy("");
    }
  }

  function stagePreview(
    event: ChangeEvent<HTMLInputElement>,
    item: StoreItem,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return { itemId: item.id, file, url: URL.createObjectURL(file) };
    });
    setRemovePreviewPending(false);
    setMessage("Preview selected. Save the cosmetic to publish this image.");
    setError("");
  }

  async function savePreview(
    item: StoreItem,
    file: File,
  ) {
    const form = new FormData();
    form.set("itemId", item.id);
    form.set("expectedRevision", String(item.revision));
    form.set("file", file);
    setBusy(item.id);
    try {
      const result = await readJson<{
        previewUrl: string;
        revision: number;
      }>(
        await fetch("/api/v1/admin/store-media", {
          method: "POST",
          body: form,
        }),
      );
      const saved = {
        ...item,
        previewUrl: result.previewUrl,
        revision: result.revision,
      };
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? saved : entry)),
      );
      setDraft((current) => (current?.id === item.id ? saved : current));
      setPendingPreview(null);
      setMessage(`${item.name} preview replaced.`);
      return saved;
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The preview was not replaced.",
      );
    } finally {
      setBusy("");
    }
    return null;
  }

  async function removePreview(item: StoreItem) {
    setBusy(item.id);
    setError("");
    try {
      const result = await readJson<{
        previewUrl: null;
        revision: number;
      }>(
        await fetch(
          `/api/v1/admin/store-media?itemId=${encodeURIComponent(item.id)}&expectedRevision=${item.revision}`,
          { method: "DELETE" },
        ),
      );
      const saved = {
        ...item,
        previewUrl: result.previewUrl,
        revision: result.revision,
      };
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? saved : entry)),
      );
      setDraft((current) => (current?.id === item.id ? saved : current));
      setRemovePreviewPending(false);
      setMessage(`${item.name} preview removed.`);
      return saved;
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "The preview was not removed.",
      );
    } finally {
      setBusy("");
    }
    return null;
  }

  async function saveItemAndMedia(item: StoreItem) {
    let current = item;
    if (itemDirty) {
      const saved = await saveItem(current);
      if (!saved) return;
      current = saved;
    }
    if (pendingPreview?.itemId === current.id) {
      await savePreview(current, pendingPreview.file);
    } else if (removePreviewPending) {
      await removePreview(current);
    } else if (!itemDirty) {
      setMessage(`${current.name} has no unsaved changes.`);
    }
  }

  function stagePreviewRemoval(item: StoreItem) {
    if (pendingPreview?.itemId === item.id) {
      setPendingPreview(null);
    }
    setRemovePreviewPending(Boolean(item.previewUrl));
    setMessage(
      item.previewUrl
        ? "Preview removal staged. Save the cosmetic to confirm."
        : "The staged preview was cleared.",
    );
    setError("");
  }

  function toggleNewCollection() {
    if (
      newCollectionOpen &&
      newCollectionDirty &&
      !window.confirm("Discard this unsaved collection?")
    ) {
      return;
    }
    if (newCollectionOpen) {
      setCollectionDraft({ ...initialCollectionDraft });
    }
    setNewCollectionOpen((value) => !value);
  }

  function beginCollectionEdit(collection: StoreCollection) {
    if (
      collectionDirty &&
      collectionEditDraft?.id !== collection.id &&
      !window.confirm("Discard unsaved collection changes?")
    ) {
      return;
    }
    setCollectionEditorId(collection.id);
    setCollectionEditDraft(collectionFormDraft(collection));
    setMessage("");
    setError("");
  }

  function closeCollectionEdit(force = false) {
    if (
      !force &&
      collectionDirty &&
      !window.confirm("Discard unsaved collection changes?")
    ) {
      return;
    }
    setCollectionEditorId(null);
    setCollectionEditDraft(null);
  }

  async function saveCollection(
    collection: CollectionFormDraft,
    options: { closeEditor?: boolean } = {},
  ) {
    let payload: ReturnType<typeof collectionPayload>;
    try {
      payload = collectionPayload(collection);
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Review the collection details and try again.",
      );
      return false;
    }
    setBusy(collection.id);
    setError("");
    try {
      await readJson(
        await fetch("/api/v1/admin/store-collections", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      setMessage(`${payload.name} collection saved.`);
      if (options.closeEditor) closeCollectionEdit(true);
      setRevision((value) => value + 1);
      return true;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The collection was not saved.",
      );
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let payload: ReturnType<typeof collectionPayload>;
    try {
      payload = collectionPayload(collectionDraft);
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Review the collection details and try again.",
      );
      return;
    }
    setBusy("create-collection");
    setError("");
    try {
      await readJson(
        await fetch("/api/v1/admin/store-collections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      setMessage(`${payload.name} collection created.`);
      setNewCollectionOpen(false);
      setCollectionDraft({ ...initialCollectionDraft });
      setRevision((value) => value + 1);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "The collection was not created.",
      );
    } finally {
      setBusy("");
    }
  }

  async function grantTestCoins(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("grant");
    try {
      const result = await readJson<{ wallet: { balance: number } }>(
        await fetch("/api/v1/admin/test-coins", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(grant),
        }),
      );
      setMessage(
        `${grant.amount.toLocaleString("en-US")} test Onyx Coins granted. New balance: ${result.wallet.balance.toLocaleString("en-US")}.`,
      );
    } catch (grantError) {
      setError(
        grantError instanceof Error
          ? grantError.message
          : "The test balance was not granted.",
      );
    } finally {
      setBusy("");
    }
  }

  if (!hasLoaded) {
    return (
      <section className="control-panel store-admin-panel">
        <header className="panel-header">
          <span>
            <Storefront size={20} />
          </span>
          <div>
            <p>Premium marketplace</p>
            <h1>{title}</h1>
            <span>
              Load the current inventory before creating or changing Store
              records.
            </span>
          </div>
        </header>
        <div
          className="admin-state-card"
          role={loading ? "status" : "alert"}
        >
          <h2>
            {loading ? "Loading Store Management" : "Store data unavailable"}
          </h2>
          <p>
            {loading
              ? "Loading collections, inventory, prices, and publication state…"
              : error || "Store Management could not be loaded."}
          </p>
          {!loading ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setRevision((value) => value + 1)}
            >
              Retry
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="control-panel store-admin-panel">
      <header className="panel-header">
        <span><Storefront size={20} /></span>
        <div>
          <p>Premium marketplace</p>
          <h1>{title}</h1>
          <span>
            Manage this category&apos;s collections, previews, prices,
            publication state, and display order from the database.
          </span>
        </div>
        <div className="store-admin-header-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={toggleNewCollection}
          >
            <Plus size={16} /> Collection
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={busy === "create-item"}
            onClick={() => void createItem()}
          >
            <Plus size={16} /> Store item
          </button>
        </div>
      </header>

      {message ? <p className="store-admin-message">{message}</p> : null}
      {error ? (
        <p className="store-admin-error" role="alert">
          <WarningCircle size={17} /> {error}
        </p>
      ) : null}

      {newCollectionOpen ? (
        <form className="store-admin-form" onSubmit={createCollection}>
          <h2>Create collection</h2>
          <div className="store-admin-form-grid">
            <label>
              Name
              <input
                required
                value={collectionDraft.name}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              URL slug
              <input
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                value={collectionDraft.slug}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    slug: event.target.value.toLowerCase(),
                  }))
                }
              />
            </label>
            <label className="store-admin-wide">
              Description
              <textarea
                required
                value={collectionDraft.description}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Theme key
              <input
                required
                value={collectionDraft.themeKey}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    themeKey: event.target.value.toUpperCase(),
                  }))
                }
              />
            </label>
            <label>
              Display order
              <input
                type="number"
                min={0}
                value={collectionDraft.sortOrder}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    sortOrder: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Starts
              <input
                type="datetime-local"
                value={collectionDraft.startsAt}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    startsAt: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Ends
              <input
                type="datetime-local"
                value={collectionDraft.endsAt}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    endsAt: event.target.value,
                  }))
                }
              />
            </label>
            <label className="store-admin-check">
              <input
                type="checkbox"
                checked={collectionDraft.isSeasonal}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    isSeasonal: event.target.checked,
                  }))
                }
              />
              Seasonal collection
            </label>
            <label className="store-admin-check">
              <input
                type="checkbox"
                checked={collectionDraft.enabled}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
              />
              Enabled
            </label>
          </div>
          <button
            className="button button-primary"
            disabled={busy === "create-collection"}
          >
            {busy === "create-collection" ? "Creating…" : "Create collection"}
          </button>
        </form>
      ) : null}

      <div className="store-admin-layout">
        <div className="store-admin-catalog">
          <div className="admin-filter-bar">
            <input
              value={itemQuery}
              disabled={dirty}
              title={
                dirty
                  ? "Save or reset current Store changes before searching."
                  : undefined
              }
              onChange={(event) => {
                setItemQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search items"
              aria-label="Search Store items"
            />
            <select
              value={itemStatus}
              disabled={dirty}
              title={
                dirty
                  ? "Save or reset current Store changes before filtering."
                  : undefined
              }
              aria-label="Filter Store item status"
              onChange={(event) => {
                setItemStatus(event.target.value as typeof itemStatus);
                setPage(1);
              }}
            >
              <option value="ALL">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="HIDDEN">Hidden</option>
            </select>
          </div>
          <section className="store-admin-collections">
            <div className="store-admin-collection-heading">
              <div>
                <h2 id="store-collections-heading">Collections</h2>
                <p>
                  Control collection copy, seasonal windows, visibility, and
                  marketplace order.
                </p>
              </div>
              <span>{collections.length} total</span>
            </div>
            {loading ? (
              <div className="store-admin-loading" role="status">
                <SpinnerGap size={22} className="spin" /> Loading collections…
              </div>
            ) : collections.length ? (
              <div
                className="store-admin-collection-list"
                aria-labelledby="store-collections-heading"
              >
                {collections.map((collection) => {
                  const editing =
                    collectionEditorId === collection.id &&
                    collectionEditDraft?.id === collection.id;
                  return (
                    <article
                      className={editing ? "is-editing" : undefined}
                      key={collection.id}
                    >
                      <div className="store-admin-collection-summary">
                        <div>
                          <strong>{collection.name}</strong>
                          <span>
                            {collection.isSeasonal ? "Seasonal" : "Permanent"} ·{" "}
                            {collection.enabled ? "Enabled" : "Disabled"} · order{" "}
                            {collection.sortOrder}
                          </span>
                          <small>{collection.description}</small>
                        </div>
                        <div className="store-admin-collection-actions">
                          <button
                            type="button"
                            aria-expanded={editing}
                            aria-controls={`collection-editor-${collection.id}`}
                            onClick={() =>
                              editing
                                ? closeCollectionEdit()
                                : beginCollectionEdit(collection)
                            }
                          >
                            {editing ? <X size={15} /> : <PencilSimple size={15} />}
                            {editing ? "Close" : "Edit"}
                          </button>
                          <button
                            type="button"
                            disabled={
                              busy === collection.id ||
                              collection.sortOrder === 0
                            }
                            aria-label={`Move ${collection.name} earlier`}
                            title="Move collection earlier"
                            onClick={() =>
                              void saveCollection(
                                collectionFormDraft({
                                  ...collection,
                                  sortOrder: Math.max(
                                    0,
                                    collection.sortOrder - 10,
                                  ),
                                }),
                              )
                            }
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            disabled={busy === collection.id}
                            aria-label={`Move ${collection.name} later`}
                            title="Move collection later"
                            onClick={() =>
                              void saveCollection(
                                collectionFormDraft({
                                  ...collection,
                                  sortOrder: Math.min(
                                    100_000,
                                    collection.sortOrder + 10,
                                  ),
                                }),
                              )
                            }
                          >
                            <ArrowDown size={15} />
                          </button>
                        </div>
                      </div>

                      {editing && collectionEditDraft ? (
                        <form
                          className="store-admin-form store-admin-collection-editor"
                          id={`collection-editor-${collection.id}`}
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveCollection(collectionEditDraft, {
                              closeEditor: true,
                            });
                          }}
                        >
                          <div className="store-admin-form-grid">
                            <label>
                              Name
                              <input
                                required
                                minLength={2}
                                maxLength={100}
                                value={collectionEditDraft.name}
                                onChange={(event) =>
                                  setCollectionEditDraft({
                                    ...collectionEditDraft,
                                    name: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Display order
                              <input
                                type="number"
                                required
                                min={0}
                                max={100_000}
                                step={1}
                                value={collectionEditDraft.sortOrder}
                                onChange={(event) =>
                                  setCollectionEditDraft({
                                    ...collectionEditDraft,
                                    sortOrder: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                            <label className="store-admin-wide">
                              Description
                              <textarea
                                required
                                minLength={8}
                                maxLength={400}
                                value={collectionEditDraft.description}
                                onChange={(event) =>
                                  setCollectionEditDraft({
                                    ...collectionEditDraft,
                                    description: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Starts
                              <input
                                type="datetime-local"
                                value={collectionEditDraft.startsAt}
                                onChange={(event) =>
                                  setCollectionEditDraft({
                                    ...collectionEditDraft,
                                    startsAt: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Ends
                              <input
                                type="datetime-local"
                                value={collectionEditDraft.endsAt}
                                onChange={(event) =>
                                  setCollectionEditDraft({
                                    ...collectionEditDraft,
                                    endsAt: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="store-admin-check">
                              <input
                                type="checkbox"
                                checked={collectionEditDraft.isSeasonal}
                                onChange={(event) =>
                                  setCollectionEditDraft({
                                    ...collectionEditDraft,
                                    isSeasonal: event.target.checked,
                                  })
                                }
                              />
                              Seasonal collection
                            </label>
                            <label className="store-admin-check">
                              <input
                                type="checkbox"
                                checked={collectionEditDraft.enabled}
                                onChange={(event) =>
                                  setCollectionEditDraft({
                                    ...collectionEditDraft,
                                    enabled: event.target.checked,
                                  })
                                }
                              />
                              Enabled in Store
                            </label>
                          </div>
                          <div className="store-admin-collection-editor-actions">
                            <button
                              className="button button-primary"
                              disabled={busy === collection.id}
                            >
                              {busy === collection.id
                                ? "Saving…"
                                : "Save collection"}
                            </button>
                            <button
                              className="button button-secondary"
                              type="button"
                              disabled={busy === collection.id}
                              onClick={() => closeCollectionEdit()}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="store-admin-empty">
                <Storefront size={24} />
                <strong>No Store collections</strong>
                <span>Create a collection before adding cosmetic items.</span>
              </div>
            )}
          </section>

          <section className="store-admin-items">
            <h2>Items ({total})</h2>
            {loading ? (
              <div className="store-admin-loading">
                <SpinnerGap size={22} className="spin" /> Loading Store…
              </div>
            ) : (
              groupedItems.map(({ collection, items: collectionItems }) => (
                <div key={collection.id}>
                  <h3>{collection.name}</h3>
                  {collectionItems.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={selectedId === item.id ? "is-active" : ""}
                      onClick={() => selectItem(item)}
                    >
                      <span
                        style={{
                          background: `linear-gradient(135deg, ${item.previewConfig.from}, ${item.previewConfig.to})`,
                          color: item.previewConfig.accent,
                        }}
                      >
                        {item.previewUrl ? (
                          <img src={item.previewUrl} alt="" />
                        ) : (
                          item.previewConfig.symbol
                        )}
                      </span>
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {categoryLabel(item.category)} · {item.priceOnyx} Onyx
                        </small>
                      </div>
                      <em>
                        {item.isHidden
                          ? "Hidden"
                          : item.isPublished
                            ? "Published"
                            : "Draft"}
                      </em>
                    </button>
                  ))}
                </div>
              ))
            )}
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
                    ? "Save or reset current Store changes before changing pages."
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
                    ? "Save or reset current Store changes before changing pages."
                    : undefined
                }
                onClick={() => setPage((value) => value + 1)}
              >
                Next <CaretRight size={15} />
              </button>
            </footer>
          </section>
        </div>

        {draft ? (
          <form
            className="store-admin-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void saveItemAndMedia(draft);
            }}
          >
            <header>
              <div>
                <span>{categoryLabel(draft.category)}</span>
                <h2>{draft.name}</h2>
                <small>{draft.purchaseCount} owners</small>
              </div>
              <div>
                <button
                  type="button"
                  aria-label="Move item earlier"
                  title="Move earlier"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      sortOrder: Math.max(0, draft.sortOrder - 10),
                    });
                    setMessage("Display order changed. Save to apply it.");
                  }}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Move item later"
                  title="Move later"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      sortOrder: Math.min(
                        100_000,
                        draft.sortOrder + 10,
                      ),
                    });
                    setMessage("Display order changed. Save to apply it.");
                  }}
                >
                  <ArrowDown size={16} />
                </button>
              </div>
            </header>

            <div
              className="store-admin-preview"
              style={{
                background: `linear-gradient(135deg, ${draft.previewConfig.from}, ${draft.previewConfig.to})`,
                color: draft.previewConfig.accent,
              }}
            >
              {pendingPreview?.itemId === draft.id ? (
                <img
                  src={pendingPreview.url}
                  alt={`Unsaved preview of ${draft.name}`}
                />
              ) : draft.previewUrl && !removePreviewPending ? (
                <img src={draft.previewUrl} alt={`Preview of ${draft.name}`} />
              ) : (
                <strong>{draft.previewConfig.symbol}</strong>
              )}
              <label>
                <ImageIcon size={16} />{" "}
                {draft.previewUrl ? "Replace image" : "Choose image"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => stagePreview(event, draft)}
                />
              </label>
              {(draft.previewUrl || pendingPreview?.itemId === draft.id) &&
              !removePreviewPending ? (
                <button
                  className="store-admin-preview-remove"
                  type="button"
                  onClick={() => stagePreviewRemoval(draft)}
                >
                  <Trash size={15} /> Remove image
                </button>
              ) : null}
              <small>
                JPEG, PNG, WebP, or GIF · 5 MB maximum · 64–8192 px.
                Changes publish only when you save.
              </small>
            </div>

            <div className="store-admin-form-grid">
              <label>
                Name
                <input
                  required
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </label>
              <label>
                URL slug
                <input
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={draft.slug}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      slug: event.target.value.toLowerCase(),
                    })
                  }
                />
              </label>
              <label className="store-admin-wide">
                Description
                <textarea
                  required
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                />
              </label>
              <label>
                Collection
                <select
                  value={draft.collectionId}
                  onChange={(event) =>
                    setDraft({ ...draft, collectionId: event.target.value })
                  }
                >
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      category: event.target.value as StoreItem["category"],
                    })
                  }
                >
                  {(categoryFilter?.length
                    ? categoryFilter
                    : [
                        "PROFILE_BANNER",
                        "PROFILE_FRAME",
                        "USERNAME_DECORATION",
                        "COMMENT_EFFECT",
                        "COMMENT_GRADIENT",
                        "SEASONAL_PROFILE",
                        "LOGO_EFFECT",
                      ]
                  ).map((category) => (
                    <option value={category} key={category}>
                      {categoryLabel(category as StoreItem["category"])}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Price · Onyx Coins
                <input
                  type="number"
                  min={0}
                  max={10_000_000}
                  value={draft.priceOnyx}
                  onChange={(event) =>
                    setDraft({ ...draft, priceOnyx: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Display order
                <input
                  type="number"
                  min={0}
                  value={draft.sortOrder}
                  onChange={(event) =>
                    setDraft({ ...draft, sortOrder: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Preview start
                <input
                  type="color"
                  value={draft.previewConfig.from}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      previewConfig: {
                        ...draft.previewConfig,
                        from: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label>
                Preview end
                <input
                  type="color"
                  value={draft.previewConfig.to}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      previewConfig: {
                        ...draft.previewConfig,
                        to: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label>
                Preview accent
                <input
                  type="color"
                  value={draft.previewConfig.accent}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      previewConfig: {
                        ...draft.previewConfig,
                        accent: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label>
                Preview symbol
                <select
                  value={draft.previewConfig.symbol}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      previewConfig: {
                        ...draft.previewConfig,
                        symbol: event.target.value as PreviewConfig["symbol"],
                      },
                    })
                  }
                >
                  {[
                    "SUN",
                    "RING",
                    "SPARK",
                    "WAVE",
                    "INK",
                    "SLASH",
                    "STEEL",
                    "HARBOR",
                    "COIN",
                    "GLYPH",
                    "MOSAIC",
                    "STAR",
                    "COMPASS",
                    "COMET",
                  ].map((symbol) => (
                    <option key={symbol}>{symbol}</option>
                  ))}
                </select>
              </label>
              <label className="store-admin-check">
                <input
                  type="checkbox"
                  checked={draft.isPublished}
                  onChange={(event) =>
                    setDraft({ ...draft, isPublished: event.target.checked })
                  }
                />
                <Eye size={15} /> Published
              </label>
              <label className="store-admin-check">
                <input
                  type="checkbox"
                  checked={draft.isHidden}
                  onChange={(event) =>
                    setDraft({ ...draft, isHidden: event.target.checked })
                  }
                />
                <EyeSlash size={15} /> Hidden
              </label>
            </div>
            <footer>
              <button
                className="button button-primary"
                disabled={busy === draft.id}
              >
                {busy === draft.id ? "Saving…" : "Save Store item"}
              </button>
              <button
                className="button button-danger"
                type="button"
                onClick={() => void deleteItem(draft)}
              >
                <Trash size={16} />
                {draft.purchaseCount ? "Archive" : "Delete"}
              </button>
            </footer>
          </form>
        ) : (
          <div className="store-admin-empty">
            <Storefront size={28} />
            <strong>Select a Store item</strong>
            <span>Choose an item to edit its preview, price, and availability.</span>
          </div>
        )}
      </div>

      {showTestingBalance ? (
      <form className="store-test-coins" onSubmit={grantTestCoins}>
        <div>
          <Coins size={22} />
          <span>
            <strong>Testing balance</strong>
            Grant audited, ledger-balanced Onyx Coins to an existing test account.
          </span>
        </div>
        <label>
          Account email
          <input
            type="email"
            required
            value={grant.email}
            onChange={(event) =>
              setGrant((current) => ({ ...current, email: event.target.value }))
            }
          />
        </label>
        <label>
          Amount
          <input
            type="number"
            min={1}
            max={10_000}
            value={grant.amount}
            onChange={(event) =>
              setGrant((current) => ({
                ...current,
                amount: Number(event.target.value),
              }))
            }
          />
        </label>
        <label>
          Reason
          <input
            required
            minLength={8}
            value={grant.reason}
            onChange={(event) =>
              setGrant((current) => ({ ...current, reason: event.target.value }))
            }
          />
        </label>
        <button
          className="button button-secondary"
          disabled={busy === "grant"}
        >
          {busy === "grant" ? "Granting…" : "Grant test balance"}
        </button>
      </form>
      ) : null}
    </section>
  );
}
