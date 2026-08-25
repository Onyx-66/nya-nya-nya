"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowUp,
  CaretLeft,
  CaretRight,
  Eye,
  EyeSlash,
  Image as ImageIcon,
  PencilSimple,
  Plus,

  Storefront,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { optimizeStaticMedia } from "@/lib/client/media-optimizer";
import { optimizeReactionAsset } from "@/lib/client/reaction-media";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";
import {
  AdminCombobox,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";

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
  commentOpacity: number;
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
  bannerPlacement?: "PROFILE_HEADER" | "PROFILE_SHELF" | "PROFILE_BACKGROUND";
  displayDurationDays?: number | null;
  targetLink?: string | null;
  rarity?: "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
  unlockMethod?: "PURCHASE" | "ROULETTE" | "MEMBERSHIP" | "EVENT";
  cosmeticSlot?:
    | "PROFILE_BANNER"
    | "PROFILE_FRAME"
    | "USERNAME"
    | "COMMENT"
    | "PROFILE_THEME"
    | "SITE_LOGO";
  animationType?: "GLOW" | "PULSE" | "SHIMMER" | "ORBIT" | "GLITCH";
  animationDurationMs?: number;
};

const storeSymbolOptions = [
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
].map((symbol) => ({ value: symbol, label: symbol }));

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
  priceCurrency: "ONYX" | "SHARDS";
  previewUrl: string | null;
  previewConfig: PreviewConfig;
  isPublished: boolean;
  isHidden: boolean;
  sortOrder: number;
  purchaseCount: number;
  revision: number;
};

type StoreConfirmation =
  | { kind: "select-item"; item: StoreItem }
  | { kind: "delete-item"; item: StoreItem }
  | { kind: "toggle-new-collection" }
  | { kind: "edit-collection"; collection: StoreCollection }
  | { kind: "close-collection-editor" };

function storeConfirmationCopy(
  confirmation: StoreConfirmation | null,
  currentItemName: string,
) {
  if (confirmation?.kind === "select-item") {
    return {
      title: "Discard Store item changes?",
      description: `Unsaved edits and staged preview changes for ${currentItemName} will be discarded before ${confirmation.item.name} opens.`,
      confirmLabel: "Discard and open",
    };
  }
  if (confirmation?.kind === "delete-item") {
    return confirmation.item.purchaseCount
      ? {
          title: `Archive ${confirmation.item.name}?`,
          description:
            "This item has owners. It will leave the Store, but existing owners will keep access to it.",
          confirmLabel: "Archive item",
        }
      : {
          title: `Delete ${confirmation.item.name}?`,
          description:
            "This unowned Store item will be permanently deleted. This action cannot be undone.",
          confirmLabel: "Delete item",
        };
  }
  if (confirmation?.kind === "toggle-new-collection") {
    return {
      title: "Discard this collection draft?",
      description:
        "The unsaved collection name, schedule, description, and visibility settings will be lost.",
      confirmLabel: "Discard collection",
    };
  }
  if (confirmation?.kind === "edit-collection") {
    return {
      title: "Discard collection changes?",
      description: `Unsaved changes to the current collection will be lost before ${confirmation.collection.name} opens.`,
      confirmLabel: "Discard and open",
    };
  }
  return {
    title: "Discard collection changes?",
    description:
      "Unsaved collection details, schedule, and visibility changes will be lost when the editor closes.",
    confirmLabel: "Discard changes",
  };
}

const defaultPreview: PreviewConfig = {
  from: "#0b4f7d",
  to: "#07111f",
  accent: "#68d5ff",
  commentOpacity: 65,
  symbol: "STAR",
};

function cosmeticSlot(category: StoreItem["category"]): NonNullable<PreviewConfig["cosmeticSlot"]> {
  return {
    PROFILE_BANNER: "PROFILE_BANNER",
    PROFILE_FRAME: "PROFILE_FRAME",
    USERNAME_DECORATION: "USERNAME",
    COMMENT_EFFECT: "COMMENT",
    COMMENT_GRADIENT: "COMMENT",
    SEASONAL_PROFILE: "PROFILE_THEME",
    LOGO_EFFECT: "SITE_LOGO",
  }[category] as NonNullable<PreviewConfig["cosmeticSlot"]>;
}

function defaultPreviewForCategory(category: StoreItem["category"]): PreviewConfig {
  const shared = { ...defaultPreview, cosmeticSlot: cosmeticSlot(category) };
  if (category === "PROFILE_BANNER") {
    return {
      ...shared,
      bannerPlacement: "PROFILE_HEADER",
      displayDurationDays: null,
      targetLink: null,
      rarity: "RARE",
      unlockMethod: "PURCHASE",
    };
  }
  if (category === "LOGO_EFFECT") {
    return {
      ...shared,
      rarity: "EPIC",
      unlockMethod: "PURCHASE",
      animationType: "GLOW",
      animationDurationMs: 1_500,
    };
  }
  return {
    ...shared,
    rarity: "RARE",
    unlockMethod: "PURCHASE",
  };
}

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

function categoryEditorCopy(category: StoreItem["category"]) {
  if (category === "PROFILE_BANNER") {
    return {
      title: "Profile banner placement",
      description:
        "This item is limited to the profile banner placement. Display dates come from its collection; artwork and preview colors stay specific to this banner.",
      slotLabel: "Placement",
      startLabel: "Banner background start",
      endLabel: "Banner background end",
      accentLabel: "Banner accent",
      symbolLabel: "Fallback banner motif",
    };
  }
  if (category === "LOGO_EFFECT") {
    return {
      title: "Logo effect preview",
      description:
        "Logo effects use the existing safe gradient, accent, and motif parameters. Their marketplace window comes from the selected collection.",
      slotLabel: "Effect slot",
      startLabel: "Effect color start",
      endLabel: "Effect color end",
      accentLabel: "Effect highlight",
      symbolLabel: "Effect motif",
    };
  }
  return {
    title: "Cosmetic slot and preview",
    description:
      "The category selects the equip slot. Preview artwork and the existing safe visual parameters are isolated to this cosmetic.",
    slotLabel: "Cosmetic slot",
    startLabel: "Preview background start",
    endLabel: "Preview background end",
    accentLabel: "Preview accent",
    symbolLabel: "Preview motif",
  };
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
}: {
  categoryFilter?: readonly StoreItem["category"][];
  defaultCategory?: StoreItem["category"];
  title?: string;
}) {
  const { settings: commercial } = useCommercialSettings();
  const coinPlural = commercial.economy.coinPlural;
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
  const [pendingConfirmation, setPendingConfirmation] =
    useState<StoreConfirmation | null>(null);
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
  const confirmationCopy = storeConfirmationCopy(
    pendingConfirmation,
    draft?.name ?? "the current Store item",
  );
  const collectionOptions = useMemo(
    () =>
      collections.map((collection) => ({
        value: collection.id,
        label: collection.name,
        description: `/${collection.slug}${collection.enabled ? "" : " · Hidden"}`,
      })),
    [collections],
  );
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

  function selectItem(item: StoreItem, confirmed = false) {
    if ((itemDirty || mediaDirty) && !confirmed) {
      setPendingConfirmation({ kind: "select-item", item });
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
    const itemType = categoryLabel(defaultCategory).toLowerCase();
    const item = {
      slug: `new-${defaultCategory.toLowerCase().replaceAll("_", "-")}-${suffix}`,
      collectionId: collection.id,
      name: `New ${itemType}`,
      description: `Describe how this ${itemType} appears and what it changes.`,
      category: defaultCategory,
      priceOnyx: 200,
      priceCurrency: "ONYX" as const,
      previewConfig: defaultPreviewForCategory(defaultCategory),
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

  async function deleteItem(item: StoreItem, confirmed = false) {
    if (!confirmed) {
      setPendingConfirmation({ kind: "delete-item", item });
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
    const prepared =
      file.type === "image/gif"
        ? (await optimizeReactionAsset(file)).file
        : await optimizeStaticMedia(file, {
            maxWidth: 1_800,
            maxHeight: 1_800,
            maxBytes: 2_500_000,
          });
    const form = new FormData();
    form.set("itemId", item.id);
    form.set("expectedRevision", String(item.revision));
    form.set("file", prepared);
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

  function toggleNewCollection(confirmed = false) {
    if (newCollectionOpen && newCollectionDirty && !confirmed) {
      setPendingConfirmation({ kind: "toggle-new-collection" });
      return;
    }
    if (newCollectionOpen) {
      setCollectionDraft({ ...initialCollectionDraft });
    }
    setNewCollectionOpen((value) => !value);
  }

  function beginCollectionEdit(collection: StoreCollection, confirmed = false) {
    if (
      collectionDirty &&
      collectionEditDraft?.id !== collection.id &&
      !confirmed
    ) {
      setPendingConfirmation({ kind: "edit-collection", collection });
      return;
    }
    setCollectionEditorId(collection.id);
    setCollectionEditDraft(collectionFormDraft(collection));
    setMessage("");
    setError("");
  }

  function closeCollectionEdit(force = false) {
    if (!force && collectionDirty) {
      setPendingConfirmation({ kind: "close-collection-editor" });
      return;
    }
    setCollectionEditorId(null);
    setCollectionEditDraft(null);
  }

  function confirmPendingAction() {
    const confirmation = pendingConfirmation;
    if (!confirmation) return;
    setPendingConfirmation(null);
    if (confirmation.kind === "select-item") {
      selectItem(confirmation.item, true);
    } else if (confirmation.kind === "delete-item") {
      void deleteItem(confirmation.item, true);
    } else if (confirmation.kind === "toggle-new-collection") {
      toggleNewCollection(true);
    } else if (confirmation.kind === "edit-collection") {
      beginCollectionEdit(confirmation.collection, true);
    } else {
      closeCollectionEdit(true);
    }
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
            onClick={() => toggleNewCollection()}
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

      {message ? <SystemNoticeBridge message={message} kind="success" /> : null}
      {error ? <SystemNoticeBridge message={error} kind="error" /> : null}

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
            <UnifiedSingleSelect
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
            </UnifiedSingleSelect>
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
                <DotsRing size={22} /> Loading collections…
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
                <DotsRing size={22} /> Loading Store…
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
                          {categoryLabel(item.category)} · {item.priceOnyx}{" "}
                          {item.priceCurrency === "SHARDS" ? "Shards" : coinPlural}
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

            <section className="admin-notice admin-notice-neutral">
              <strong>{categoryEditorCopy(draft.category).title}</strong>
              <p>{categoryEditorCopy(draft.category).description}</p>
            </section>

            <div
              className="store-admin-preview"
              data-placement={draft.previewConfig.bannerPlacement}
              data-animation={draft.previewConfig.animationType}
              style={{
                background: `linear-gradient(135deg, ${draft.previewConfig.from}, ${draft.previewConfig.to})`,
                color: draft.previewConfig.accent,
                animationDuration: draft.previewConfig.animationDurationMs
                  ? `${draft.previewConfig.animationDurationMs}ms`
                  : undefined,
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
                {draft.category === "PROFILE_BANNER"
                  ? `${(draft.previewConfig.bannerPlacement ?? "PROFILE_HEADER").replaceAll("_", " ")} · ${draft.previewConfig.displayDurationDays ? `${draft.previewConfig.displayDurationDays} days` : "permanent"}`
                  : draft.category === "LOGO_EFFECT"
                    ? `${draft.previewConfig.animationType ?? "GLOW"} · ${draft.previewConfig.animationDurationMs ?? 1_500} ms · ${(draft.previewConfig.unlockMethod ?? "PURCHASE").toLowerCase()}`
                    : `${draft.previewConfig.rarity ?? "RARE"} · ${(draft.previewConfig.unlockMethod ?? "PURCHASE").toLowerCase()} · ${(draft.previewConfig.cosmeticSlot ?? cosmeticSlot(draft.category)).replaceAll("_", " ")}`}
              </small>
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
                <AdminCombobox
                  ariaLabel="Search and choose a Store collection"
                  value={draft.collectionId}
                  options={collectionOptions}
                  placeholder="Search Store collections…"
                  onChange={(collectionId) =>
                    setDraft({ ...draft, collectionId })
                  }
                />
              </label>
              <label>
                {categoryEditorCopy(draft.category).slotLabel}
                <UnifiedSingleSelect
                  value={draft.category}
                  onChange={(event) => {
                    const category = event.target.value as StoreItem["category"];
                    setDraft({
                      ...draft,
                      category,
                      previewConfig: {
                        ...draft.previewConfig,
                        cosmeticSlot: cosmeticSlot(category),
                      },
                    });
                  }}
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
                </UnifiedSingleSelect>
              </label>
              <label>
                Price amount
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
                Price currency
                <UnifiedSingleSelect
                  value={draft.priceCurrency}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      priceCurrency: event.target.value as
                        | "ONYX"
                        | "SHARDS",
                    })
                  }
                >
                  <option value="ONYX">{coinPlural}</option>
                  <option value="SHARDS">Shards</option>
                </UnifiedSingleSelect>
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
              {draft.category === "PROFILE_BANNER" ? (
                <>
                  <label>
                    Banner placement
                    <UnifiedSingleSelect
                      value={draft.previewConfig.bannerPlacement ?? "PROFILE_HEADER"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          previewConfig: {
                            ...draft.previewConfig,
                            bannerPlacement: event.target.value as NonNullable<PreviewConfig["bannerPlacement"]>,
                          },
                        })
                      }
                    >
                      <option value="PROFILE_HEADER">Profile header</option>
                      <option value="PROFILE_SHELF">Profile shelf</option>
                      <option value="PROFILE_BACKGROUND">Profile background</option>
                    </UnifiedSingleSelect>
                  </label>
                  <label>
                    Display duration (days)
                    <input
                      type="number"
                      min={1}
                      max={3_650}
                      value={draft.previewConfig.displayDurationDays ?? ""}
                      placeholder="Permanent"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          previewConfig: {
                            ...draft.previewConfig,
                            displayDurationDays: event.target.value
                              ? Number(event.target.value)
                              : null,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="store-admin-wide">
                    Optional target link
                    <input
                      type="text"
                      maxLength={2_048}
                      value={draft.previewConfig.targetLink ?? ""}
                      placeholder="/series/example or https://…"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          previewConfig: {
                            ...draft.previewConfig,
                            targetLink: event.target.value || null,
                          },
                        })
                      }
                    />
                  </label>
                </>
              ) : draft.category === "LOGO_EFFECT" ? (
                <>
                  <label>
                    Animation type
                    <UnifiedSingleSelect
                      value={draft.previewConfig.animationType ?? "GLOW"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          previewConfig: {
                            ...draft.previewConfig,
                            animationType: event.target.value as NonNullable<PreviewConfig["animationType"]>,
                          },
                        })
                      }
                    >
                      <option value="GLOW">Glow</option>
                      <option value="PULSE">Pulse</option>
                      <option value="SHIMMER">Shimmer</option>
                      <option value="ORBIT">Orbit</option>
                      <option value="GLITCH">Glitch</option>
                    </UnifiedSingleSelect>
                  </label>
                  <label>
                    Animation duration (ms)
                    <input
                      type="number"
                      min={250}
                      max={20_000}
                      step={50}
                      value={draft.previewConfig.animationDurationMs ?? 1_500}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          previewConfig: {
                            ...draft.previewConfig,
                            animationDurationMs: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Unlock method
                    <UnifiedSingleSelect
                      value={draft.previewConfig.unlockMethod ?? "PURCHASE"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          previewConfig: {
                            ...draft.previewConfig,
                            unlockMethod: event.target.value as NonNullable<PreviewConfig["unlockMethod"]>,
                          },
                        })
                      }
                    >
                      <option value="PURCHASE">Store purchase</option>
                      <option value="ROULETTE">Roulette reward</option>
                      <option value="MEMBERSHIP">Membership</option>
                      <option value="EVENT">Event grant</option>
                    </UnifiedSingleSelect>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Rarity
                    <UnifiedSingleSelect
                      value={draft.previewConfig.rarity ?? "RARE"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          previewConfig: {
                            ...draft.previewConfig,
                            rarity: event.target.value as NonNullable<PreviewConfig["rarity"]>,
                          },
                        })
                      }
                    >
                      <option value="COMMON">Common</option>
                      <option value="UNCOMMON">Uncommon</option>
                      <option value="RARE">Rare</option>
                      <option value="EPIC">Epic</option>
                      <option value="LEGENDARY">Legendary</option>
                    </UnifiedSingleSelect>
                  </label>
                  <label>
                    Unlock method
                    <UnifiedSingleSelect
                      value={draft.previewConfig.unlockMethod ?? "PURCHASE"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          previewConfig: {
                            ...draft.previewConfig,
                            unlockMethod: event.target.value as NonNullable<PreviewConfig["unlockMethod"]>,
                          },
                        })
                      }
                    >
                      <option value="PURCHASE">Store purchase</option>
                      <option value="ROULETTE">Roulette reward</option>
                      <option value="MEMBERSHIP">Membership</option>
                      <option value="EVENT">Event grant</option>
                    </UnifiedSingleSelect>
                  </label>
                  <label>
                    Equip slot
                    <UnifiedSingleSelect
                      value={draft.previewConfig.cosmeticSlot ?? cosmeticSlot(draft.category)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          previewConfig: {
                            ...draft.previewConfig,
                            cosmeticSlot: event.target.value as NonNullable<PreviewConfig["cosmeticSlot"]>,
                          },
                        })
                      }
                    >
                      <option value={cosmeticSlot(draft.category)}>
                        {categoryLabel(draft.category)}
                      </option>
                    </UnifiedSingleSelect>
                  </label>
                </>
              )}
              <label>
                {categoryEditorCopy(draft.category).startLabel}
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
                {categoryEditorCopy(draft.category).endLabel}
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
                {categoryEditorCopy(draft.category).accentLabel}
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
              {["COMMENT_EFFECT", "COMMENT_GRADIENT"].includes(
                draft.category,
              ) ? (
                <label>
                  Comment background opacity (%)
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={draft.previewConfig.commentOpacity}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        previewConfig: {
                          ...draft.previewConfig,
                          commentOpacity: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              ) : null}
              <label>
                {categoryEditorCopy(draft.category).symbolLabel}
                <AdminCombobox
                  ariaLabel={categoryEditorCopy(draft.category).symbolLabel}
                  value={draft.previewConfig.symbol}
                  options={storeSymbolOptions}
                  placeholder="Search safe motifs…"
                  onChange={(symbol) =>
                    setDraft({
                      ...draft,
                      previewConfig: {
                        ...draft.previewConfig,
                        symbol: symbol as PreviewConfig["symbol"],
                      },
                    })
                  }
                />
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
      <ConfirmActionDialog
        open={Boolean(pendingConfirmation)}
        title={confirmationCopy.title}
        description={confirmationCopy.description}
        confirmLabel={confirmationCopy.confirmLabel}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={confirmPendingAction}
      />
    </section>
  );
}
