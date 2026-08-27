"use client";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Coins,
  DeviceMobile,
  Desktop,
  Plus,
  Trash,
} from "@/components/nyascans/heroicons";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import { PremiumDateRangePicker } from "@/components/nyascans/PremiumDateRangePicker";
import {
  AdminPageScaffold,
  ConfirmActionDialog,
  useUnsavedChanges,
} from "@/components/nyascans/admin/AdminPageScaffold";
import { useCommercialSettings } from "@/components/nyascans/useCommercialSettings";

type OfferKind =
  | "CURRENCY_PACKAGE"
  | "MEMBERSHIP"
  | "PROMOTION"
  | "BUNDLE"
  | "OTHER";
type Lifecycle =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "EXPIRED"
  | "HIDDEN"
  | "ARCHIVED";

type Offer = {
  id: string;
  revision: number;
  slug: string;
  kind: OfferKind;
  name: string;
  shortDescription: string;
  detailedDescription: string;
  priceMinor: number;
  billingCurrency: string;
  onyxBase: number;
  onyxBonus: number;
  benefits: string[];
  discountPercent: number;
  promotionalBadge: string;
  startsAt: string | null;
  endsAt: string | null;
  lifecycleStatus: Lifecycle;
  effectiveLifecycle: Lifecycle;
  isFeatured: boolean;
  sortOrder: number;
  ctaText: string;
  altText: string;
  themeKey: "OCEAN" | "ONYX" | "AURORA" | "SUNSET" | "MINIMAL";
  media: {
    primary: string | null;
    banner: string | null;
    icon: string | null;
  };
  metadata: Record<string, unknown>;
  purchaseCount: number;
};

type Draft = Omit<Offer, "effectiveLifecycle" | "purchaseCount"> & {
  purchaseCount: number;
};

const emptyDraft: Draft = {
  id: "",
  revision: 1,
  slug: "",
  kind: "CURRENCY_PACKAGE",
  name: "",
  shortDescription: "",
  detailedDescription: "",
  priceMinor: 0,
  billingCurrency: "USD",
  onyxBase: 100,
  onyxBonus: 0,
  benefits: [],
  discountPercent: 0,
  promotionalBadge: "",
  startsAt: null,
  endsAt: null,
  lifecycleStatus: "DRAFT",
  isFeatured: false,
  sortOrder: 100,
  ctaText: "View offer",
  altText: "Offer artwork",
  themeKey: "OCEAN",
  media: { primary: null, banner: null, icon: null },
  metadata: {},
  purchaseCount: 0,
};

async function api<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "The commerce action failed.");
  }
  return payload;
}

export function CommerceOfferManager({
  settingsPanel,
  initialKind = "ALL",
  embedded = false,
}: {
  settingsPanel?: ReactNode;
  initialKind?: OfferKind | "ALL";
  embedded?: boolean;
}) {
  const { settings: commercial } = useCommercialSettings();
  const coinName = commercial.economy.coinName;
  const coinPlural = commercial.economy.coinPlural;
  const fixedKind = initialKind === "ALL" ? null : initialKind;
  const [tab, setTab] = useState<"offers" | "economy">("offers");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState<Draft>(emptyDraft);
  const [kind, setKind] = useState<OfferKind | "ALL">(initialKind);
  const [status, setStatus] = useState<Lifecycle | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [removeMedia, setRemoveMedia] = useState({
    primary: false,
    banner: false,
    icon: false,
  });
  const [archiveTarget, setArchiveTarget] = useState<Offer | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<{
    description: string;
    run: () => void;
  } | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved) ||
    Boolean(primaryFile || bannerFile || iconFile) ||
    Object.values(removeMedia).some(Boolean);
  useUnsavedChanges(dirty, "commerce offer changes");
  const primaryPreviewUrl = useMemo(
    () =>
      primaryFile
        ? URL.createObjectURL(primaryFile)
        : draft.media.primary,
    [draft.media.primary, primaryFile],
  );
  const bannerPreviewUrl = useMemo(
    () =>
      bannerFile
        ? URL.createObjectURL(bannerFile)
        : draft.media.banner,
    [bannerFile, draft.media.banner],
  );
  const iconPreviewUrl = useMemo(
    () =>
      iconFile
        ? URL.createObjectURL(iconFile)
        : draft.media.icon,
    [draft.media.icon, iconFile],
  );
  useEffect(
    () => () => {
      if (primaryFile && primaryPreviewUrl) {
        URL.revokeObjectURL(primaryPreviewUrl);
      }
    },
    [primaryFile, primaryPreviewUrl],
  );
  useEffect(
    () => () => {
      if (bannerFile && bannerPreviewUrl) {
        URL.revokeObjectURL(bannerPreviewUrl);
      }
    },
    [bannerFile, bannerPreviewUrl],
  );
  useEffect(
    () => () => {
      if (iconFile && iconPreviewUrl) {
        URL.revokeObjectURL(iconPreviewUrl);
      }
    },
    [iconFile, iconPreviewUrl],
  );

  async function load(preferredId?: string, requestedPage = page) {
    setLoading(true);
    try {
      const payload = await api<{
        data: Offer[];
        pagination: { total: number };
      }>(
        `/api/v1/admin/commerce-offers?query=${encodeURIComponent(query)}&kind=${kind}&status=${status}&page=${requestedPage}&limit=25`,
        { cache: "no-store" },
      );
      setOffers(payload.data);
      setPage(requestedPage);
      setTotal(payload.pagination.total);
      const selected =
        payload.data.find((offer) => offer.id === preferredId) ??
        payload.data.find((offer) => offer.id === draft.id) ??
        payload.data[0];
      if (selected) {
        const next = { ...selected, purchaseCount: selected.purchaseCount };
        setDraft(next);
        setSaved(next);
      } else {
        setDraft(emptyDraft);
        setSaved(emptyDraft);
      }
      setPrimaryFile(null);
      setBannerFile(null);
      setIconFile(null);
      setRemoveMedia({ primary: false, banner: false, icon: false });
      setMessage(null);
      setHasLoaded(true);
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Offers could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, page, query, status]);

  function requestDraftDiscard(description: string, run: () => void) {
    if (dirty) {
      setPendingNavigation({ description, run });
      return;
    }
    run();
  }

  function applySelection(offer: Offer) {
    const next = { ...offer, purchaseCount: offer.purchaseCount };
    setDraft(next);
    setSaved(next);
    setPrimaryFile(null);
    setBannerFile(null);
    setIconFile(null);
    setRemoveMedia({ primary: false, banner: false, icon: false });
  }

  function select(offer: Offer) {
    requestDraftDiscard(
      "The current offer draft and selected media changes will be discarded before another offer opens.",
      () => applySelection(offer),
    );
  }

  function createOffer() {
    requestDraftDiscard(
      "The current offer draft and selected media changes will be discarded before a new offer is created.",
      () => {
        setDraft({
          ...emptyDraft,
          kind: kind === "ALL" ? "CURRENCY_PACKAGE" : kind,
          sortOrder:
            offers.reduce(
              (maximum, offer) => Math.max(maximum, offer.sortOrder),
              0,
            ) + 10,
        });
        setSaved(emptyDraft);
        setPrimaryFile(null);
        setBannerFile(null);
        setIconFile(null);
        setRemoveMedia({ primary: false, banner: false, icon: false });
      },
    );
  }

  async function upload(
    offerId: string,
    revision: number,
    role: "primary" | "banner" | "icon",
    file: File,
  ) {
    const form = new FormData();
    form.set("productId", offerId);
    form.set("revision", String(revision));
    form.set("role", role);
    form.set("file", file);
    const payload = await api<{
      data: { revision: number; url: string | null };
    }>(
      "/api/v1/admin/commerce-media",
      { method: "PUT", body: form },
    );
    return payload.data;
  }

  async function deleteMedia(
    offerId: string,
    revision: number,
    role: "primary" | "banner" | "icon",
  ) {
    const payload = await api<{
      data: { revision: number; url: string | null };
    }>(
      `/api/v1/admin/commerce-media?productId=${encodeURIComponent(offerId)}&role=${role}&revision=${revision}`,
      { method: "DELETE" },
    );
    return payload.data;
  }

  function selectMedia(
    role: "primary" | "banner" | "icon",
    file: File | null,
  ) {
    if (role === "primary") setPrimaryFile(file);
    if (role === "banner") setBannerFile(file);
    if (role === "icon") setIconFile(file);
    if (file) {
      setRemoveMedia((current) => ({ ...current, [role]: false }));
    }
  }

  function removeMediaRole(role: "primary" | "banner" | "icon") {
    const file =
      role === "primary"
        ? primaryFile
        : role === "banner"
          ? bannerFile
          : iconFile;
    if (file) {
      selectMedia(role, null);
      return;
    }
    if (!draft.media[role]) return;
    setRemoveMedia((current) => ({ ...current, [role]: true }));
    setDraft((current) => ({
      ...current,
      media: { ...current.media, [role]: null },
    }));
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
      const result = await api<{ data: Offer }>(
        "/api/v1/admin/commerce-offers",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(isEdit ? { id: draft.id, revision: draft.revision } : {}),
            slug: draft.slug,
            kind: draft.kind,
            name: draft.name,
            shortDescription: draft.shortDescription,
            detailedDescription: draft.detailedDescription,
            priceMinor: draft.priceMinor,
            billingCurrency: draft.billingCurrency,
            onyxBase: draft.onyxBase,
            onyxBonus: draft.onyxBonus,
            benefits: draft.benefits,
            discountPercent: draft.discountPercent,
            promotionalBadge: draft.promotionalBadge,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            lifecycleStatus: draft.lifecycleStatus,
            isFeatured: draft.isFeatured,
            sortOrder: draft.sortOrder,
            ctaText: draft.ctaText,
            altText: draft.altText,
            themeKey: draft.themeKey,
            metadata: draft.metadata,
          }),
        },
      );
      let current: Draft = result.data;
      applyPersisted(current);
      for (const role of ["primary", "banner", "icon"] as const) {
        if (removeMedia[role]) {
          const media = await deleteMedia(
            result.data.id,
            current.revision,
            role,
          );
          current = {
            ...current,
            revision: media.revision,
            media: { ...current.media, [role]: media.url },
          };
          applyPersisted(current);
          setRemoveMedia((value) => ({ ...value, [role]: false }));
        }
      }
      for (const [role, file] of [
        ["primary", primaryFile],
        ["banner", bannerFile],
        ["icon", iconFile],
      ] as const) {
        if (file) {
          const media = await upload(
            result.data.id,
            current.revision,
            role,
            file,
          );
          current = {
            ...current,
            revision: media.revision,
            media: { ...current.media, [role]: media.url },
          };
          applyPersisted(current);
          if (role === "primary") setPrimaryFile(null);
          if (role === "banner") setBannerFile(null);
          if (role === "icon") setIconFile(null);
        }
      }
      await load(result.data.id, 1);
      setMessage({
        kind: "success",
        text: `${result.data.name} was saved at version ${current.revision}.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: persisted
          ? `Offer metadata was saved, but a media action failed: ${
              error instanceof Error ? error.message : "retry the remaining image"
            }. The latest saved revision was retained.`
          : error instanceof Error
            ? error.message
            : "The offer could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!archiveTarget) return;
    setSaving(true);
    try {
      await api(
        `/api/v1/admin/commerce-offers?id=${encodeURIComponent(archiveTarget.id)}&revision=${archiveTarget.revision}`,
        { method: "DELETE" },
      );
      setArchiveTarget(null);
      await load();
      setMessage({
        kind: "success",
        text: "The offer was archived. Existing transaction snapshots remain unchanged.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "The offer was not archived.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AdminPageScaffold
        breadcrumbs={["Administration", "Commerce"]}
        kicker="Revenue & entitlements"
        title="Commerce management"
        description="Manage immutable-price offers, lifecycle scheduling, customer previews, and global economy rules."
        embedded={embedded}
        tabs={[
          { key: "offers", label: "Offers", count: offers.length },
          { key: "economy", label: "Economy & announcement" },
        ]}
        activeTab={tab}
        onTabChange={(value) => setTab(value as "offers" | "economy")}
        state={
          tab === "offers" && loading
            ? { kind: "loading", message: "Loading commerce offers…" }
            : tab === "offers" && !hasLoaded
              ? {
                  kind: "error",
                  title: "Commerce offers unavailable",
                  message:
                    message?.text ??
                    "The saved commerce offers could not be loaded.",
                  onRetry: () => void load(),
                }
            : { kind: "ready" }
        }
        message={message}
        primaryAction={
          tab === "offers" && hasLoaded ? (
            <button className="button button-primary" type="button" onClick={createOffer}>
              <Plus size={17} /> New offer
            </button>
          ) : null
        }
      >
        {tab === "economy" ? (
          settingsPanel ?? (
            <div className="admin-state-card">
              <h3>Economy settings unavailable</h3>
              <p>The existing settings editor could not be mounted.</p>
            </div>
          )
        ) : (
          <>
            <div className="admin-filter-bar">
              <input
                aria-label="Search offers"
                value={query}
                disabled={dirty}
                title={
                  dirty
                    ? "Save or reset the current offer before changing filters."
                    : undefined
                }
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search offers"
              />
              {fixedKind ? (
                <span className="admin-filter-context">
                  {fixedKind === "CURRENCY_PACKAGE"
                    ? "Coin packages only"
                    : "Memberships only"}
                </span>
              ) : (
                <UnifiedSingleSelect
                  value={kind}
                  disabled={dirty}
                  title={
                    dirty
                      ? "Save or reset the current offer before changing filters."
                      : undefined
                  }
                  onChange={(event) => {
                    setKind(event.target.value as typeof kind);
                    setPage(1);
                  }}
                >
                  <option value="ALL">All offer types</option>
                  <option value="CURRENCY_PACKAGE">Coin packages</option>
                  <option value="MEMBERSHIP">Memberships</option>
                  <option value="PROMOTION">Promotions</option>
                  <option value="BUNDLE">Bundles</option>
                  <option value="OTHER">Other products</option>
                </UnifiedSingleSelect>
              )}
              <UnifiedSingleSelect
                value={status}
                disabled={dirty}
                title={
                  dirty
                    ? "Save or reset the current offer before changing filters."
                    : undefined
                }
                onChange={(event) => {
                  setStatus(event.target.value as typeof status);
                  setPage(1);
                }}
              >
                <option value="ALL">All lifecycle states</option>
                <option value="DRAFT">Draft</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="ACTIVE">Active</option>
                <option value="EXPIRED">Expired</option>
                <option value="HIDDEN">Hidden</option>
                <option value="ARCHIVED">Archived</option>
              </UnifiedSingleSelect>
              <button
                className="button button-ghost"
                type="button"
                disabled={dirty}
                title={
                  dirty
                    ? "Save or reset the current offer before refreshing."
                    : undefined
                }
                onClick={() => void load()}
              >
                <ArrowClockwise size={16} /> Refresh
              </button>
              {dirty ? (
                <small className="admin-disabled-reason">
                  Save or reset this offer before changing the list filters.
                </small>
              ) : null}
            </div>
            <div className="admin-master-detail">
              <aside className="admin-record-list">
                {offers.map((offer) => (
                  <button
                    type="button"
                    key={offer.id}
                    aria-current={draft.id === offer.id ? "true" : undefined}
                    onClick={() => select(offer)}
                  >
                    <span className="admin-list-avatar">
                      {offer.media.icon ? (
                        <img src={offer.media.icon} alt="" />
                      ) : (
                        <Coins size={18} />
                      )}
                    </span>
                    <span>
                      <strong>{offer.name}</strong>
                      <small>
                        {(offer.priceMinor / 100).toLocaleString(undefined, {
                          style: "currency",
                          currency: offer.billingCurrency,
                        })}
                      </small>
                    </span>
                    <em>{offer.effectiveLifecycle}</em>
                  </button>
                ))}
                <footer className="admin-pagination">
                  <span>
                    {total ? (page - 1) * 25 + 1 : 0}–
                    {Math.min(total, page * 25)} of {total}
                  </span>
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => {
                      requestDraftDiscard(
                        "The current offer draft and selected media changes will be discarded before the previous page opens.",
                        () => setPage((value) => Math.max(1, value - 1)),
                      );
                    }}
                  >
                    <CaretLeft size={15} /> Previous
                  </button>
                  <button
                    type="button"
                    disabled={page * 25 >= total}
                    onClick={() => {
                      requestDraftDiscard(
                        "The current offer draft and selected media changes will be discarded before the next page opens.",
                        () => setPage((value) => value + 1),
                      );
                    }}
                  >
                    Next <CaretRight size={15} />
                  </button>
                </footer>
              </aside>
              <form className="admin-detail-form" onSubmit={save}>
                <div className="admin-form-section">
                  <div className="admin-section-heading">
                    <Coins size={22} />
                    <div>
                      <h3>Offer details</h3>
                      <p>Historical order values are snapshotted and never recalculated from this editor.</p>
                    </div>
                  </div>
                  <div className="admin-form-grid">
                    <label>
                      Offer title <b>Required</b>
                      <input
                        required
                        minLength={2}
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
                      Stable slug
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
                    <label>
                      Offer type
                      <UnifiedSingleSelect
                        value={draft.kind}
                        disabled={Boolean(fixedKind)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            kind: event.target.value as OfferKind,
                          }))
                        }
                      >
                        <option value="CURRENCY_PACKAGE">Coin package</option>
                        <option value="MEMBERSHIP">Membership</option>
                        <option value="PROMOTION">Promotion</option>
                        <option value="BUNDLE">Bundle</option>
                        <option value="OTHER">Other</option>
                      </UnifiedSingleSelect>
                    </label>
                    <label>
                      Lifecycle
                      <UnifiedSingleSelect
                        value={draft.lifecycleStatus}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            lifecycleStatus: event.target.value as Lifecycle,
                          }))
                        }
                      >
                        <option value="DRAFT">Draft</option>
                        <option value="SCHEDULED">Scheduled</option>
                        <option value="ACTIVE">Active</option>
                        <option value="EXPIRED">Expired</option>
                        <option value="HIDDEN">Hidden</option>
                        <option value="ARCHIVED">Archived</option>
                      </UnifiedSingleSelect>
                    </label>
                    <label>
                      Price in minor units
                      <input
                        type="number"
                        min={0}
                        value={draft.priceMinor}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            priceMinor: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label>
                      Currency
                      <input
                        pattern="[A-Z]{3}"
                        maxLength={3}
                        value={draft.billingCurrency}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            billingCurrency: event.target.value.toUpperCase(),
                          }))
                        }
                      />
                    </label>
                    {draft.kind === "CURRENCY_PACKAGE" ? (
                      <>
                        <label>
                          Base {coinPlural}
                          <input
                            type="number"
                            min={1}
                            value={draft.onyxBase}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                onyxBase: Number(event.target.value),
                              }))
                            }
                          />
                        </label>
                        <label>
                          Bonus {coinPlural}
                          <input
                            type="number"
                            min={0}
                            value={draft.onyxBonus}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                onyxBonus: Number(event.target.value),
                              }))
                            }
                          />
                        </label>
                      </>
                    ) : null}
                    {draft.kind === "MEMBERSHIP" ? (
                      <>
                        <label>
                          Annual price in minor units
                          <input
                            type="number"
                            min={0}
                            value={Number(
                              draft.metadata.annualPriceMinor ?? 0,
                            )}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                metadata: {
                                  ...current.metadata,
                                  annualPriceMinor: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </label>
                        <label>
                          Monthly {coinName} allowance
                          <input
                            type="number"
                            min={0}
                            value={Number(
                              draft.metadata.monthlyCoins ??
                                draft.onyxBonus ??
                                0,
                            )}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                onyxBonus: Number(event.target.value),
                                metadata: {
                                  ...current.metadata,
                                  monthlyCoins: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </label>
                      </>
                    ) : null}
                    <label>
                      Discount percent
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.discountPercent}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            discountPercent: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label>
                      Promotional badge
                      <input
                        value={draft.promotionalBadge}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            promotionalBadge: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="admin-date-picker-field commerce-offer-date-range-field">
                      <span>Schedule window</span>
                      <PremiumDateRangePicker
                        start={draft.startsAt}
                        end={draft.endsAt}
                        label="Offer schedule"
                        includeTime
                        onChange={({ start, end }) => setDraft((current) => ({ ...current, startsAt: start, endsAt: end }))}
                      />
                    </div>
                    <label>
                      Theme
                      <UnifiedSingleSelect
                        value={draft.themeKey}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            themeKey: event.target.value as Draft["themeKey"],
                          }))
                        }
                      >
                        <option value="OCEAN">Ocean</option>
                        <option value="ONYX">{coinPlural}</option>
                        <option value="AURORA">Aurora</option>
                        <option value="SUNSET">Sunset</option>
                        <option value="MINIMAL">Minimal</option>
                      </UnifiedSingleSelect>
                    </label>
                    <label>
                      Display order
                      <input
                        type="number"
                        min={0}
                        max={10000}
                        value={draft.sortOrder}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            sortOrder: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Short description
                    <input
                      required
                      minLength={2}
                      value={draft.shortDescription}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          shortDescription: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Detailed description
                    <textarea
                      required
                      minLength={2}
                      maxLength={4000}
                      value={draft.detailedDescription}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          detailedDescription: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Included benefits/items
                    <textarea
                      value={draft.benefits.join("\n")}
                      placeholder="One benefit per line"
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          benefits: event.target.value
                            .split("\n")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                  </label>
                  <div className="admin-form-grid">
                    <label>
                      CTA text
                      <input
                        required
                        value={draft.ctaText}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            ctaText: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Image alternative text
                      <input
                        required
                        minLength={2}
                        value={draft.altText}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            altText: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <label className="admin-check-row">
                    <input
                      type="checkbox"
                      checked={draft.isFeatured}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          isFeatured: event.target.checked,
                        }))
                      }
                    />
                    Eligible for featured Store placement
                  </label>
                </div>

                <div className="admin-media-grid">
                  <AdminMediaField
                    label="Primary promotional image"
                    helperText="Customer-facing image used on the offer card."
                    recommendedDimensions="1200 × 900 px"
                    currentUrl={draft.media.primary}
                    file={primaryFile}
                    accept="image/png,image/webp,image/gif,image/jpeg"
                    disabledReason={!draft.id ? "Create the offer before uploading media." : undefined}
                    busy={saving}
                    onSelect={(file) => selectMedia("primary", file)}
                    onRemove={() => removeMediaRole("primary")}
                  />
                  <AdminMediaField
                    label="Background banner"
                    helperText="Optional wide artwork for featured placement."
                    recommendedDimensions="1920 × 640 px"
                    currentUrl={draft.media.banner}
                    file={bannerFile}
                    accept="image/png,image/webp,image/jpeg"
                    disabledReason={!draft.id ? "Create the offer before uploading media." : undefined}
                    busy={saving}
                    onSelect={(file) => selectMedia("banner", file)}
                    onRemove={() => removeMediaRole("banner")}
                  />
                  <AdminMediaField
                    label="Small icon or badge"
                    helperText="Optional compact identifier used beside pricing."
                    recommendedDimensions="256 × 256 px"
                    currentUrl={draft.media.icon}
                    file={iconFile}
                    accept="image/png,image/webp,image/gif,image/jpeg"
                    disabledReason={!draft.id ? "Create the offer before uploading media." : undefined}
                    busy={saving}
                    onSelect={(file) => selectMedia("icon", file)}
                    onRemove={() => removeMediaRole("icon")}
                  />
                </div>

                <section className="commerce-customer-preview">
                  <header>
                    <div>
                      <span>Customer-view preview</span>
                      <h3>{draft.isFeatured ? "Featured placement" : "Store category card"}</h3>
                    </div>
                    <div>
                      <button
                        type="button"
                        aria-pressed={previewDevice === "desktop"}
                        onClick={() => setPreviewDevice("desktop")}
                      >
                        <Desktop size={17} /> Desktop
                      </button>
                      <button
                        type="button"
                        aria-pressed={previewDevice === "mobile"}
                        onClick={() => setPreviewDevice("mobile")}
                      >
                        <DeviceMobile size={17} /> Mobile
                      </button>
                    </div>
                  </header>
                  <div
                    className={`commerce-offer-preview preview-${previewDevice} theme-${draft.themeKey.toLowerCase()}`}
                    style={
                      bannerPreviewUrl
                        ? {
                            backgroundImage: `linear-gradient(90deg, rgba(3, 12, 24, .92), rgba(3, 12, 24, .58)), url("${bannerPreviewUrl}")`,
                          }
                        : undefined
                    }
                  >
                    <span className="commerce-preview-art">
                      {primaryPreviewUrl ? (
                        <img src={primaryPreviewUrl} alt={draft.altText} />
                      ) : (
                        <Coins size={36} />
                      )}
                    </span>
                    <div>
                      {iconPreviewUrl ? (
                        <img
                          className="commerce-preview-icon"
                          src={iconPreviewUrl}
                          alt=""
                        />
                      ) : null}
                      {draft.promotionalBadge ? <em>{draft.promotionalBadge}</em> : null}
                      <h4>{draft.name || "Offer title"}</h4>
                      <p>{draft.shortDescription || "Short description"}</p>
                      <strong>
                        {(draft.priceMinor / 100).toLocaleString(undefined, {
                          style: "currency",
                          currency: draft.billingCurrency || "USD",
                        })}
                      </strong>
                      <span className="commerce-preview-cta">
                        {draft.ctaText || "View offer"}
                      </span>
                    </div>
                  </div>
                </section>

                <footer className="admin-sticky-actions">
                  {draft.id ? (
                    <button
                      className="button button-danger"
                      type="button"
                      onClick={() =>
                        setArchiveTarget(
                          offers.find((offer) => offer.id === draft.id) ?? null,
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
                        ? `${draft.purchaseCount} purchase snapshots`
                        : "New offer draft"}
                  </small>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={!dirty || saving}
                    onClick={() => {
                      setDraft(saved);
                      setPrimaryFile(null);
                      setBannerFile(null);
                      setIconFile(null);
                      setRemoveMedia({
                        primary: false,
                        banner: false,
                        icon: false,
                      });
                    }}
                  >
                    Reset
                  </button>
                  <button
                    className="button button-primary"
                    disabled={
                      saving ||
                      !dirty ||
                      !draft.name ||
                      !draft.slug ||
                      !draft.shortDescription ||
                      !draft.detailedDescription
                    }
                  >
                    {saving ? "Saving…" : draft.id ? "Save offer" : "Create offer"}
                  </button>
                </footer>
              </form>
            </div>
          </>
        )}
      </AdminPageScaffold>
      <ConfirmActionDialog
        open={Boolean(archiveTarget)}
        title="Archive this offer?"
        description="New purchases will stop. Existing receipts and entitlements will remain unchanged."
        confirmLabel="Archive offer"
        busy={saving}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void archive()}
      />
      <ConfirmActionDialog
        open={Boolean(pendingNavigation)}
        title="Discard unsaved offer changes?"
        description={pendingNavigation?.description ?? ""}
        confirmLabel="Discard and continue"
        destructive
        busy={saving}
        onCancel={() => {
          if (!saving) setPendingNavigation(null);
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
