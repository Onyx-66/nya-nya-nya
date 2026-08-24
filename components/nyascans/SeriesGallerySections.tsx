"use client";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
/* eslint-disable @next/next/no-img-element */

import {
  CaretDown,
  CheckCircle,
  ImageSquare,
  Plus,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AdminMediaField } from "@/components/nyascans/admin/AdminMediaField";
import { LanguageFlag } from "@/components/nyascans/LanguageFlag";
import { languageOptions } from "@/lib/admin-metadata";
import { languageName } from "@/lib/language-flags";

type CoverType = "OFFICIAL" | "FAN_MADE";
type SubmissionMode = "DIRECT" | "MODERATED" | "UNAVAILABLE";

type GalleryAsset = {
  id: string;
  kind: "ART" | "COVER";
  orientation: "LANDSCAPE" | "PORTRAIT";
  caption: string;
  altText: string;
  width: number;
  height: number;
  assetUrl: string;
  language?: string | null;
  coverType?: CoverType | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason?: string | null;
  canonical?: boolean;
  teamName?: string | null;
  submittedBy?: string | null;
};

type GalleryResponse = {
  data: {
    art: GalleryAsset[];
    covers: GalleryAsset[];
    defaultCoverLanguage: string;
    submissions: GalleryAsset[];
    permissions: {
      canSubmitArt: boolean;
      canSubmitCover: boolean;
      teamRequiredForCover: boolean;
      eligibleTeams: Array<{ id: string; name: string }>;
      submissionModes: {
        art: SubmissionMode;
        cover: SubmissionMode;
      };
    };
  };
  error?: { message?: string };
};

const emptyData: GalleryResponse["data"] = {
  art: [],
  covers: [],
  defaultCoverLanguage: "",
  submissions: [],
  permissions: {
    canSubmitArt: false,
    canSubmitCover: false,
    teamRequiredForCover: false,
    eligibleTeams: [],
    submissionModes: {
      art: "UNAVAILABLE",
      cover: "UNAVAILABLE",
    },
  },
};

function coverTypeLabel(value?: CoverType | null) {
  return value === "FAN_MADE" ? "Fan Made" : "Official";
}

export function SeriesGallerySections({
  seriesSlug,
  seriesTitle,
  showToast,
}: {
  seriesSlug: string;
  seriesTitle: string;
  showToast: (message: string) => void;
}) {
  const [data, setData] = useState(emptyData);
  const [expanded, setExpanded] = useState<Record<"ART" | "COVER", boolean>>({
    ART: false,
    COVER: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [kind, setKind] = useState<"ART" | "COVER">("ART");
  const [orientation, setOrientation] = useState<"LANDSCAPE" | "PORTRAIT">(
    "LANDSCAPE",
  );
  const [caption, setCaption] = useState("");
  const [altText, setAltText] = useState("");
  const [teamId, setTeamId] = useState("");
  const [language, setLanguage] = useState("");
  const [coverType, setCoverType] = useState<CoverType | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewerAsset, setViewerAsset] = useState<GalleryAsset | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const submissionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  const loadGallery = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(
        `/api/v1/series-gallery?series=${encodeURIComponent(seriesSlug)}`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json()) as GalleryResponse;
      if (!response.ok || !payload.data) {
        throw new Error(
          payload.error?.message ?? "The series galleries could not be loaded.",
        );
      }
      setData(payload.data);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setLoadError(
        error instanceof Error
          ? error.message
          : "The series galleries could not be loaded.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [seriesSlug]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadGallery(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadGallery]);

  useEffect(() => {
    function openFromHash(hash = window.location.hash) {
      if (hash === "#art" || hash === "#covers") {
        const target = hash === "#art" ? "ART" : "COVER";
        setExpanded((current) =>
          current[target] ? current : { ...current, [target]: true },
        );
      }
    }
    function openFromSeriesNavigation(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>(
        'a[href="#art"], a[href="#covers"]',
      );
      if (link) openFromHash(link.hash);
    }
    function handleHashChange() {
      openFromHash();
    }
    openFromHash();
    window.addEventListener("hashchange", handleHashChange);
    document.addEventListener("click", openFromSeriesNavigation);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      document.removeEventListener("click", openFromSeriesNavigation);
    };
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        ?.focus();
    });
    function closeOrTrapDialog(event: KeyboardEvent) {
      if (dialogRef.current?.querySelector(".admin-crop-dialog")) return;
      if (event.key === "Escape" && !submittingRef.current) {
        setDialogOpen(false);
        window.requestAnimationFrame(() =>
          submissionTriggerRef.current?.focus(),
        );
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
    document.addEventListener("keydown", closeOrTrapDialog);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOrTrapDialog);
    };
  }, [dialogOpen]);

  useEffect(() => {
    if (!viewerAsset) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      viewerRef.current
        ?.querySelector<HTMLElement>("[data-viewer-initial-focus]")
        ?.focus();
    });
    function closeOrTrapViewer(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setViewerAsset(null);
        window.requestAnimationFrame(() => viewerTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        viewerRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
    document.addEventListener("keydown", closeOrTrapViewer);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOrTrapViewer);
    };
  }, [viewerAsset]);

  function openSubmission(
    nextKind: "ART" | "COVER",
    trigger: HTMLButtonElement,
  ) {
    submissionTriggerRef.current = trigger;
    setKind(nextKind);
    setOrientation(nextKind === "COVER" ? "PORTRAIT" : "LANDSCAPE");
    setCaption("");
    setAltText("");
    setTeamId(
      nextKind === "COVER" && data.permissions.teamRequiredForCover
        ? data.permissions.eligibleTeams[0]?.id ?? ""
        : "",
    );
    setLanguage(
      nextKind === "COVER" ? data.defaultCoverLanguage.toLowerCase() : "",
    );
    setCoverType("");
    setFile(null);
    setDialogOpen(true);
  }

  function closeSubmission() {
    setDialogOpen(false);
    window.requestAnimationFrame(() =>
      submissionTriggerRef.current?.focus(),
    );
  }

  function openViewer(asset: GalleryAsset, trigger: HTMLButtonElement) {
    viewerTriggerRef.current = trigger;
    setViewerAsset(asset);
  }

  function closeViewer() {
    setViewerAsset(null);
    window.requestAnimationFrame(() => viewerTriggerRef.current?.focus());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      showToast("Crop and confirm an image before submitting.");
      return;
    }
    if (
      kind === "COVER" &&
      data.permissions.teamRequiredForCover &&
      !teamId
    ) {
      showToast("Choose the verified team represented by this cover.");
      return;
    }
    if (kind === "COVER" && !language) {
      showToast("Choose the cover language.");
      return;
    }
    if (kind === "COVER" && !coverType) {
      showToast("Choose whether this is an official or fan-made cover.");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("seriesSlug", seriesSlug);
      form.set("kind", kind);
      form.set("orientation", orientation);
      form.set("caption", caption);
      form.set("altText", altText);
      form.set("teamId", teamId);
      form.set("language", kind === "COVER" ? language : "");
      form.set("coverType", kind === "COVER" ? coverType : "");
      form.set("file", file);
      const response = await fetch("/api/v1/series-gallery", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as {
        data?: { message?: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "The gallery image could not be submitted.",
        );
      }
      closeSubmission();
      showToast(
        payload.data?.message ?? "Submitted for administrator review.",
      );
      await loadGallery();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "The gallery image could not be submitted.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function gallerySection(
    sectionKind: "ART" | "COVER",
    title: string,
    description: string,
    assets: GalleryAsset[],
    canSubmit: boolean,
  ) {
    const art = sectionKind === "ART";
    const isExpanded = expanded[sectionKind];
    const contentId = `series-gallery-${sectionKind.toLowerCase()}-content`;
    const headingId = `series-gallery-${sectionKind.toLowerCase()}-title`;
    return (
      <section
        className={`series-gallery-section series-gallery-${sectionKind.toLowerCase()} ${
          isExpanded ? "is-expanded" : "is-collapsed"
        }`}
        id={sectionKind.toLowerCase()}
        aria-labelledby={headingId}
      >
        <header>
          <div className="series-gallery-heading-copy">
            <h2 id={headingId}>{title}</h2>
            <p>{description}</p>
          </div>
          <button
            className="series-gallery-toggle"
            type="button"
            aria-expanded={isExpanded}
            aria-controls={contentId}
            aria-label={`${isExpanded ? "Hide" : "Show"} ${title}`}
            onClick={() =>
              setExpanded((current) => ({
                ...current,
                [sectionKind]: !current[sectionKind],
              }))
            }
          >
            <span className="series-gallery-mobile-title">{title}</span>
            <span className="series-gallery-toggle-state">
              {isExpanded ? "Hide" : "Show"}
              <CaretDown size={19} />
            </span>
          </button>
          {canSubmit ? (
            <button
              className="button button-secondary series-gallery-add"
              type="button"
              onClick={(event) =>
                openSubmission(sectionKind, event.currentTarget)
              }
            >
              <Plus size={17} /> Add {art ? "art" : "cover"}
            </button>
          ) : null}
        </header>
        <div
          className="series-gallery-content"
          id={contentId}
          hidden={!isExpanded}
        >
          {loading ? (
            <div className="series-gallery-state" role="status">
              <SpinnerGap size={18} className="spin" /> Loading {title.toLowerCase()}…
            </div>
          ) : assets.length ? (
            <div className="series-gallery-rail" aria-label={`${seriesTitle} ${title}`}>
              {assets.map((asset) => (
                <button
                  type="button"
                  className={`series-gallery-card is-${asset.orientation.toLowerCase()}`}
                  key={asset.id}
                  aria-label={`Open ${
                    asset.caption ||
                    (art ? "series art" : "series cover")
                  }${
                    !art
                      ? `, ${coverTypeLabel(asset.coverType)}${
                          asset.language
                            ? `, ${languageName(asset.language)}`
                            : ""
                        }`
                      : ""
                  }`}
                  onClick={(event) =>
                    openViewer(asset, event.currentTarget)
                  }
                >
                  <img
                    src={asset.assetUrl}
                    alt={asset.altText || asset.caption || `${seriesTitle} ${title}`}
                    loading="lazy"
                  />
                  {!art ? (
                    <div className="series-cover-badges" aria-hidden="true">
                      <span className="series-cover-type-badge">
                        {coverTypeLabel(asset.coverType)}
                      </span>
                      {asset.language ? (
                        <span className="series-cover-language-badge">
                          <LanguageFlag
                            language={asset.language}
                            showCode={false}
                          />
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <span className="series-gallery-card-copy">
                    <strong>{asset.caption || (art ? "Series art" : "Series cover")}</strong>
                    {asset.teamName || asset.submittedBy ? (
                      <small>{asset.teamName ?? asset.submittedBy}</small>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="series-gallery-state">
              <ImageSquare size={22} />
              <span>
                {art
                  ? "No approved screenshots yet."
                  : "No additional approved covers yet."}
              </span>
            </div>
          )}
        </div>
      </section>
    );
  }

  const activeSubmissionMode =
    kind === "ART"
      ? data.permissions.submissionModes.art
      : data.permissions.submissionModes.cover;
  const publishesDirectly = activeSubmissionMode === "DIRECT";

  return (
    <div className="series-galleries">
      {loadError ? (
        <p className="series-gallery-error" role="alert">
          {loadError}
        </p>
      ) : null}
      {gallerySection(
        "ART",
        "Art",
        "Sneak Peeks from inside the chapters",
        data.art,
        data.permissions.canSubmitArt,
      )}
      {gallerySection(
        "COVER",
        "Covers",
        "Other covers for this serie",
        data.covers,
        data.permissions.canSubmitCover,
      )}
      {data.submissions.length ? (
        <aside className="series-gallery-submissions">
          <strong>Your recent submissions</strong>
          <div>
            {data.submissions.map((submission) => (
              <span
                className={`status-${submission.status.toLowerCase()}`}
                key={submission.id}
                title={submission.rejectionReason ?? undefined}
              >
                {submission.status === "PENDING" ? (
                  <SpinnerGap size={14} />
                ) : (
                  <CheckCircle size={14} />
                )}
                {submission.kind === "ART" ? "Art" : "Cover"} ·{" "}
                {submission.status.toLowerCase()}
              </span>
            ))}
          </div>
        </aside>
      ) : null}
      {viewerAsset ? (
        <div
          className="gallery-viewer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeViewer();
          }}
        >
          <div
            className={`gallery-viewer is-${viewerAsset.orientation.toLowerCase()}`}
            ref={viewerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gallery-viewer-title"
          >
            <header>
              <div>
                <span className="eyebrow">
                  {viewerAsset.kind === "ART" ? "Series art" : "Series cover"}
                </span>
                <h2 id="gallery-viewer-title">
                  {viewerAsset.caption ||
                    (viewerAsset.kind === "ART"
                      ? `${seriesTitle} art`
                      : `${seriesTitle} cover`)}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close image viewer"
                data-viewer-initial-focus
                onClick={closeViewer}
              >
                <X size={19} />
              </button>
            </header>
            <div className="gallery-viewer-image">
              <img
                src={viewerAsset.assetUrl}
                alt={
                  viewerAsset.altText ||
                  viewerAsset.caption ||
                  `${seriesTitle} ${
                    viewerAsset.kind === "ART" ? "art" : "cover"
                  }`
                }
              />
            </div>
            <footer>
              {viewerAsset.kind === "COVER" ? (
                <div className="gallery-viewer-cover-meta">
                  <span>{coverTypeLabel(viewerAsset.coverType)}</span>
                  {viewerAsset.language ? (
                    <LanguageFlag
                      language={viewerAsset.language}
                      showCode={false}
                    />
                  ) : null}
                </div>
              ) : null}
              {viewerAsset.teamName || viewerAsset.submittedBy ? (
                <small>
                  Added by {viewerAsset.teamName ?? viewerAsset.submittedBy}
                </small>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}
      {dialogOpen ? (
        <div className="gallery-dialog-backdrop" role="presentation">
          <form
            className="gallery-submit-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gallery-submit-dialog-title"
            onSubmit={submit}
          >
            <header>
              <div>
                <span className="eyebrow">
                  {publishesDirectly ? "Gallery addition" : "Moderated gallery"}
                </span>
                <h2 id="gallery-submit-dialog-title">
                  {publishesDirectly ? "Add" : "Submit"}{" "}
                  {kind === "ART" ? "series art" : "a cover"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close gallery submission"
                data-dialog-initial-focus
                disabled={submitting}
                onClick={closeSubmission}
              >
                <X size={18} />
              </button>
            </header>
            {kind === "ART" ? (
              <fieldset className="gallery-orientation-choice">
                <legend>Image format</legend>
                <button
                  type="button"
                  className={orientation === "LANDSCAPE" ? "is-active" : ""}
                  aria-pressed={orientation === "LANDSCAPE"}
                  onClick={() => {
                    setOrientation("LANDSCAPE");
                    setFile(null);
                  }}
                >
                  Landscape · 16:9
                </button>
                <button
                  type="button"
                  className={orientation === "PORTRAIT" ? "is-active" : ""}
                  aria-pressed={orientation === "PORTRAIT"}
                  onClick={() => {
                    setOrientation("PORTRAIT");
                    setFile(null);
                  }}
                >
                  Portrait · 2:3
                </button>
              </fieldset>
            ) : null}
            <AdminMediaField
              label={kind === "ART" ? "Screenshot" : "Cover image"}
              helperText={
                publishesDirectly
                  ? "Position the crop and confirm it before adding it to the public gallery."
                  : "Position the crop, confirm it, then submit it for review."
              }
              recommendedDimensions={
                orientation === "LANDSCAPE"
                  ? "1600 × 900 px · 16:9"
                  : "1000 × 1500 px · 2:3"
              }
              file={file}
              accept="image/jpeg,image/png,image/webp"
              busy={submitting}
              cropProfile={
                orientation === "LANDSCAPE"
                  ? {
                      aspect: 16 / 9,
                      outputWidth: 1600,
                      outputHeight: 900,
                      maxBytes: 3_500_000,
                    }
                  : {
                      aspect: 2 / 3,
                      outputWidth: 1000,
                      outputHeight: 1500,
                      maxBytes: 3_500_000,
                    }
              }
              onSelect={setFile}
              onRemove={() => setFile(null)}
            />
            <div className="gallery-submit-fields">
              <label>
                <span>Caption</span>
                <input
                  value={caption}
                  maxLength={180}
                  placeholder={kind === "ART" ? "A short scene description" : "Edition or volume"}
                  onChange={(event) => setCaption(event.target.value)}
                />
              </label>
              <label>
                <span>Accessible description</span>
                <input
                  value={altText}
                  maxLength={240}
                  placeholder="Describe what appears in the image"
                  onChange={(event) => setAltText(event.target.value)}
                />
              </label>
              {kind === "COVER" ? (
                <>
                  <label>
                    <span>Cover language</span>
                    <UnifiedSingleSelect
                      value={language}
                      required
                      onChange={(event) => setLanguage(event.target.value)}
                    >
                      <option value="">Choose a language</option>
                      {languageOptions.map(([code, name]) => (
                        <option value={code} key={code}>
                          {name}
                        </option>
                      ))}
                    </UnifiedSingleSelect>
                  </label>
                  <label>
                    <span>Cover type</span>
                    <UnifiedSingleSelect
                      value={coverType}
                      required
                      onChange={(event) =>
                        setCoverType(event.target.value as CoverType | "")
                      }
                    >
                      <option value="">Choose a type</option>
                      <option value="OFFICIAL">Official</option>
                      <option value="FAN_MADE">Fan Made</option>
                    </UnifiedSingleSelect>
                  </label>
                </>
              ) : null}
              {kind === "COVER" && data.permissions.eligibleTeams.length ? (
                <label>
                  <span>Publishing team</span>
                  <UnifiedSingleSelect
                    value={teamId}
                    required={data.permissions.teamRequiredForCover}
                    onChange={(event) => setTeamId(event.target.value)}
                  >
                    {!data.permissions.teamRequiredForCover ? (
                      <option value="">Platform / management</option>
                    ) : null}
                    {data.permissions.eligibleTeams.map((team) => (
                      <option value={team.id} key={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </UnifiedSingleSelect>
                </label>
              ) : null}
            </div>
            <footer>
              <p>
                {publishesDirectly
                  ? "This image will be added to the public gallery immediately."
                  : "The image stays private until an administrator approves it."}
              </p>
              <button
                className="button button-secondary"
                type="button"
                disabled={submitting}
                onClick={closeSubmission}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={
                  submitting ||
                  !file ||
                  (kind === "COVER" && (!language || !coverType))
                }
              >
                {submitting ? (
                  <>
                    <SpinnerGap size={16} className="spin" /> Submitting…
                  </>
                ) : (
                  publishesDirectly ? "Add to gallery" : "Submit for review"
                )}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
