"use client";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";

import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Camera,
  CheckCircle,
  FloppyDisk,
  ImageSquare,
  Trash,
  WarningCircle,
  X,
} from "@/components/nyascans/heroicons";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { optimizeStaticMedia } from "@/lib/client/media-optimizer";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";

type ProfileSeries = {
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  coverUrl?: string | null;
};

type OwnProfile = {
  username: string;
  displayName: string;
  bio: string;
  preferredLanguage: string;
  socialLinks: Array<{ label?: string; url?: string }>;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  favorites?: ProfileSeries[];
  favoriteCandidates?: ProfileSeries[];
  revision: number;
  privacy?: {
    profileVisibility?: "PUBLIC" | "PRIVATE";
    followersVisibility?: "PUBLIC" | "PRIVATE";
    showReadingHistory?: boolean;
    showChapterNumbers?: boolean;
    showFavorites?: boolean;
    showAchievements?: boolean;
    showBookmarks?: boolean;
    showComments?: boolean;
  };
};

type AvatarCropSource = {
  file: File;
  url: string;
  width: number;
  height: number;
};

const AVATAR_OUTPUT_SIZE = 512;
const AVATAR_PREVIEW_MAX_EDGE = 3072;
const AVATAR_SOURCE_MAX_EDGE = 16_384;
const AVATAR_SOURCE_MAX_PIXELS = 50_000_000;

type AvatarCropImage = HTMLImageElement | ImageBitmap;

function cropImageDimensions(image: AvatarCropImage) {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return { width: image.width, height: image.height };
}

function drawAvatarCrop(
  canvas: HTMLCanvasElement,
  image: AvatarCropImage,
  zoom: number,
  horizontal: number,
  vertical: number,
) {
  const context = canvas.getContext("2d");
  const { width, height } = cropImageDimensions(image);
  if (!context || !width || !height) return;
  const cropSize =
    Math.min(width, height) / Math.max(1, zoom);
  const horizontalRange = Math.max(0, width - cropSize);
  const verticalRange = Math.max(0, height - cropSize);
  const sourceX =
    horizontalRange / 2 + (horizontal / 100) * (horizontalRange / 2);
  const sourceY =
    verticalRange / 2 + (vertical / 100) * (verticalRange / 2);
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  context.clearRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    Math.max(0, Math.min(horizontalRange, sourceX)),
    Math.max(0, Math.min(verticalRange, sourceY)),
    cropSize,
    cropSize,
    0,
    0,
    AVATAR_OUTPUT_SIZE,
    AVATAR_OUTPUT_SIZE,
  );
}

async function avatarImageDimensions(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    ascii(1, 3) === "PNG"
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const format = ascii(12, 4);
    if (format === "VP8X") {
      const width =
        1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
      const height =
        1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
      return { width, height };
    }
    if (format === "VP8 " && ascii(23, 3) === "\u009d\u0001\u002a") {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (format === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame && offset + 7 <= bytes.length) {
        return {
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
        };
      }
      if (length < 2) break;
      offset += length;
    }
  }

  throw new Error("This image could not be inspected. Choose another file.");
}

async function avatarFileFromCanvas(
  canvas: HTMLCanvasElement,
  originalName: string,
) {
  const encode = (type: "image/webp" | "image/jpeg") =>
    new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, type === "image/webp" ? 0.9 : 0.92),
    );
  const blob =
    (await encode("image/webp")) ?? (await encode("image/jpeg"));
  if (!blob) {
    throw new Error("The cropped avatar could not be prepared.");
  }
  const stem = originalName.replace(/\.[^.]+$/, "").slice(0, 80) || "avatar";
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `${stem}-cropped.${extension}`, {
    type: blob.type,
    lastModified: Date.now(),
  });
}

function AvatarCropDialog({
  source,
  busy,
  onCancel,
  onSave,
}: {
  source: AvatarCropSource;
  busy: boolean;
  onCancel: () => void;
  onSave: (file: File) => Promise<string | null>;
}) {
  const [zoom, setZoom] = useState(1);
  const [horizontal, setHorizontal] = useState(0);
  const [vertical, setVertical] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const imageRef = useRef<AvatarCropImage | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let fallbackImage: HTMLImageElement | null = null;
    let bitmap: ImageBitmap | null = null;
    async function preparePreview() {
      try {
        if ("createImageBitmap" in window) {
          const scale = Math.min(
            1,
            AVATAR_PREVIEW_MAX_EDGE / Math.max(source.width, source.height),
          );
          bitmap = await createImageBitmap(source.file, {
            resizeWidth: Math.max(1, Math.round(source.width * scale)),
            resizeHeight: Math.max(1, Math.round(source.height * scale)),
            resizeQuality: "high",
            imageOrientation: "from-image",
          });
          if (cancelled) {
            bitmap.close();
            return;
          }
          imageRef.current = bitmap;
          setReady(true);
          return;
        }
        if (source.width * source.height > 16_000_000) {
          throw new Error(
            "This browser cannot safely prepare such a large image. Choose a smaller source.",
          );
        }
        fallbackImage = new Image();
        fallbackImage.decoding = "async";
        fallbackImage.onload = () => {
          if (cancelled || !fallbackImage) return;
          imageRef.current = fallbackImage;
          setReady(true);
        };
        fallbackImage.onerror = () => {
          if (cancelled) return;
          setError("This image could not be opened. Choose another file.");
        };
        fallbackImage.src = source.url;
      } catch (previewError) {
        if (cancelled) return;
        setError(
          previewError instanceof Error
            ? previewError.message
            : "This image could not be opened. Choose another file.",
        );
      }
    }
    void preparePreview();
    return () => {
      cancelled = true;
      if (fallbackImage) {
        fallbackImage.onload = null;
        fallbackImage.onerror = null;
        fallbackImage.src = "";
      }
      bitmap?.close();
      imageRef.current = null;
    };
  }, [source]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    drawAvatarCrop(canvas, image, zoom, horizontal, vertical);
  }, [horizontal, ready, vertical, zoom]);

  useEffect(() => {
    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])',
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const activeElement = document.activeElement;
      if (
        activeElement === dialogRef.current ||
        !(activeElement instanceof Node) ||
        !dialogRef.current.contains(activeElement)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleDialogKeys);
    return () => document.removeEventListener("keydown", handleDialogKeys);
  }, [busy, onCancel]);

  useEffect(() => {
    if (busy) dialogRef.current?.focus();
  }, [busy]);

  async function saveCrop() {
    const canvas = canvasRef.current;
    if (!canvas || !ready || busy) return;
    setError("");
    try {
      const cropped = await avatarFileFromCanvas(canvas, source.file.name);
      const saveError = await onSave(cropped);
      if (saveError) setError(saveError);
    } catch (cropError) {
      setError(
        cropError instanceof Error
          ? cropError.message
          : "The cropped avatar could not be prepared.",
      );
    }
  }

  return (
    <div
      className="avatar-crop-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="avatar-crop-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-crop-title"
        aria-describedby="avatar-crop-description"
      >
        <header>
          <div>
            <p className="eyebrow">Profile image</p>
            <h3 id="avatar-crop-title">Crop your avatar</h3>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close avatar crop"
          >
            <X size={19} />
          </button>
        </header>
        <div className="avatar-crop-preview">
          <canvas
            ref={canvasRef}
            width={AVATAR_OUTPUT_SIZE}
            height={AVATAR_OUTPUT_SIZE}
            aria-label="Cropped avatar preview"
            aria-busy={!ready}
          />
          {!ready && !error ? <span role="status">Preparing preview…</span> : null}
        </div>
        <p id="avatar-crop-description">
          Position the real image inside the site’s avatar frame. It will be
          saved as a sharp 512 × 512 image.
        </p>
        <div className="avatar-crop-controls">
          <label>
            <span>Zoom</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              disabled={!ready || busy}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Horizontal position</span>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={horizontal}
              disabled={!ready || busy}
              onChange={(event) => setHorizontal(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Vertical position</span>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={vertical}
              disabled={!ready || busy}
              onChange={(event) => setVertical(Number(event.target.value))}
            />
          </label>
        </div>
        {error ? (
          <div className="avatar-crop-error" role="alert">
            <WarningCircle size={17} /> {error}
          </div>
        ) : null}
        <footer>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              setZoom(1);
              setHorizontal(0);
              setVertical(0);
            }}
            disabled={!ready || busy}
          >
            Reset
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={() => void saveCrop()}
            disabled={!ready || busy}
          >
            <Camera size={17} />
            {busy ? "Saving crop…" : "Crop & save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function profileUpdatePayload(profile: OwnProfile) {
  return {
    username: profile.username,
    bio: profile.bio,
    preferredLanguage: profile.preferredLanguage,
    profileVisibility: profile.privacy?.profileVisibility ?? "PUBLIC",
    followersVisibility: profile.privacy?.followersVisibility ?? "PUBLIC",
    showReadingHistory: Boolean(profile.privacy?.showReadingHistory),
    showChapterNumbers: Boolean(profile.privacy?.showChapterNumbers),
    showFavorites: Boolean(profile.privacy?.showFavorites),
    showAchievements: Boolean(profile.privacy?.showAchievements),
    showBookmarks: Boolean(profile.privacy?.showBookmarks),
    showComments: Boolean(profile.privacy?.showComments),
    favoriteSeriesIds: (profile.favorites ?? []).map(
      (favorite) => favorite.seriesId,
    ),
    socialLinks: profile.socialLinks
      .filter((entry) => entry.label?.trim() && entry.url?.trim())
      .map((entry) => ({
        label: entry.label!.trim(),
        url: entry.url!.trim(),
      })),
    revision: profile.revision,
  };
}

export function ProfileSettingsWorkspace({
  onSaved,
  mode = "profile",
}: {
  onSaved?: (message: string) => void;
  mode?: "profile" | "privacy";
}) {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [initial, setInitial] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mediaBusy, setMediaBusy] = useState<"avatar" | "banner" | null>(null);
  const [avatarCropSource, setAvatarCropSource] =
    useState<AvatarCropSource | null>(null);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (avatarCropSource) URL.revokeObjectURL(avatarCropSource.url);
    },
    [avatarCropSource],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/profiles", {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data?: OwnProfile;
          error?: { message?: string };
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message ?? "Profile could not be loaded.");
        }
        setProfile(payload.data);
        setInitial(JSON.stringify(payload.data));
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Profile could not be loaded.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const dirty = useMemo(
    () => Boolean(profile) && JSON.stringify(profile) !== initial,
    [initial, profile],
  );

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!profile || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/profiles", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profileUpdatePayload(profile)),
      });
      const payload = (await response.json()) as {
        revision?: number;
        username?: string;
        error?: { message?: string };
      };
      if (!response.ok || typeof payload.revision !== "number") {
        throw new Error(payload.error?.message ?? "Profile could not be saved.");
      }
      const nextProfile = {
        ...profile,
        username: payload.username ?? profile.username,
        revision: payload.revision,
      };
      setProfile(nextProfile);
      setInitial(JSON.stringify(nextProfile));
      onSaved?.("Profile saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Profile could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function uploadMedia(
    slot: "avatar" | "banner",
    file: File | undefined,
  ) {
    if (!profile || !file || mediaBusy) {
      return "The profile image upload is not ready yet.";
    }
    setMediaBusy(slot);
    setError("");
    try {
      let uploadProfile = profile;
      if (uploadProfile.revision < 1) {
        const profileResponse = await fetch("/api/v1/profiles", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(profileUpdatePayload(uploadProfile)),
        });
        const profilePayload = (await profileResponse.json()) as {
          revision?: number;
          username?: string;
          error?: { message?: string };
        };
        if (
          !profileResponse.ok ||
          typeof profilePayload.revision !== "number"
        ) {
          throw new Error(
            profilePayload.error?.message ??
              "Save the profile before uploading media.",
          );
        }
        uploadProfile = {
          ...uploadProfile,
          username: profilePayload.username ?? uploadProfile.username,
          revision: profilePayload.revision,
        };
        setProfile((current) =>
          current
            ? {
                ...current,
                username: uploadProfile.username,
                revision: uploadProfile.revision,
              }
            : current,
        );
        setInitial(JSON.stringify(uploadProfile));
      }
      const body = new FormData();
      const preparedFile =
        slot === "banner"
          ? await optimizeStaticMedia(file, {
              maxWidth: 2_400,
              maxHeight: 1_200,
              maxBytes: 3_000_000,
            })
          : file;
      body.set("slot", slot);
      body.set("revision", String(uploadProfile.revision));
      body.set("file", preparedFile);
      const response = await fetch("/api/v1/profile-media", {
        method: "PUT",
        body,
      });
      const payload = (await response.json()) as {
        revision?: number;
        url?: string;
        error?: { message?: string };
      };
      if (!response.ok || typeof payload.revision !== "number") {
        throw new Error(payload.error?.message ?? "Profile media could not be saved.");
      }
      const mediaKey = slot === "avatar" ? "avatarUrl" : "bannerUrl";
      setProfile((current) =>
        current
          ? {
              ...current,
              revision: payload.revision!,
              [mediaKey]: payload.url ?? null,
            }
          : current,
      );
      setInitial((current) => {
        const baseline = JSON.parse(current || JSON.stringify(uploadProfile)) as OwnProfile;
        return JSON.stringify({
          ...baseline,
          revision: payload.revision,
          [mediaKey]: payload.url ?? null,
        });
      });
      onSaved?.(`${slot === "avatar" ? "Avatar" : "Banner"} saved.`);
      window.dispatchEvent(new CustomEvent("nyascans:profile-changed"));
      return null;
    } catch (mediaError) {
      const message =
        mediaError instanceof Error
          ? mediaError.message
          : "Profile media could not be saved.";
      setError(message);
      return message;
    } finally {
      setMediaBusy(null);
    }
  }

  async function beginAvatarCrop(file: File | undefined) {
    if (!file || mediaBusy) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPEG, PNG, or WebP avatar.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("The avatar source must be 10 MB or smaller.");
      return;
    }
    try {
      const dimensions = await avatarImageDimensions(file);
      if (
        dimensions.width < 1 ||
        dimensions.height < 1 ||
        Math.max(dimensions.width, dimensions.height) > AVATAR_SOURCE_MAX_EDGE ||
        dimensions.width * dimensions.height > AVATAR_SOURCE_MAX_PIXELS
      ) {
        throw new Error(
          "The avatar source is too large. Use an image up to 50 megapixels and 16,384 px per side.",
        );
      }
      setError("");
      setAvatarCropSource({
        file,
        url: URL.createObjectURL(file),
        ...dimensions,
      });
    } catch (dimensionError) {
      setError(
        dimensionError instanceof Error
          ? dimensionError.message
          : "This image could not be inspected. Choose another file.",
      );
    }
  }

  async function removeMedia(slot: "avatar" | "banner") {
    if (!profile || profile.revision < 1 || mediaBusy) return;
    if (!window.confirm(`Remove the current profile ${slot}?`)) return;
    setMediaBusy(slot);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/profile-media?slot=${slot}&revision=${profile.revision}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        revision?: number;
        error?: { message?: string };
      };
      if (!response.ok || typeof payload.revision !== "number") {
        throw new Error(
          payload.error?.message ?? "Profile media could not be removed.",
        );
      }
      const mediaKey = slot === "avatar" ? "avatarUrl" : "bannerUrl";
      setProfile((current) =>
        current
          ? { ...current, revision: payload.revision!, [mediaKey]: null }
          : current,
      );
      setInitial((current) => {
        const baseline = JSON.parse(current) as OwnProfile;
        return JSON.stringify({
          ...baseline,
          revision: payload.revision,
          [mediaKey]: null,
        });
      });
      onSaved?.(`${slot === "avatar" ? "Avatar" : "Banner"} removed.`);
      window.dispatchEvent(new CustomEvent("nyascans:profile-changed"));
    } catch (mediaError) {
      setError(
        mediaError instanceof Error
          ? mediaError.message
          : "Profile media could not be removed.",
      );
    } finally {
      setMediaBusy(null);
    }
  }

  if (loading) {
    return (
      <section className="profile-settings-state" role="status">
        Loading profile settings…
      </section>
    );
  }
  if (!profile) {
    return (
      <section className="profile-settings-state" role="alert">
        <WarningCircle size={24} />
        <strong>Profile settings unavailable</strong>
        <span>{error}</span>
      </section>
    );
  }

  return (
    <form className={`profile-settings-workspace is-${mode}`} onSubmit={save}>
      <header>
        <div>
          <p className="eyebrow">{mode === "profile" ? "Public identity" : "Public privacy"}</p>
          <h2>{mode === "profile" ? "Profile" : "Profile visibility"}</h2>
          <p>{mode === "profile" ? "Build the identity other readers see across NyaScans." : "Choose exactly which parts of your public activity other readers can see."}</p>
        </div>
        {mode === "profile" && profile.revision > 0 ? (
          <a
            className="button button-secondary"
            href={`/u/${encodeURIComponent(profile.username)}`}
            target="_blank"
            rel="noreferrer"
          >
            Preview public profile <ArrowSquareOut size={16} />
          </a>
        ) : null}
      </header>
      {error ? (
        <SystemNoticeBridge message={error} kind="error" />
      ) : null}
      <section className="profile-settings-card profile-media-composer">
        <div className="profile-media-banner-stage">
          {profile.bannerUrl ? (
            // Profile media uses a revisioned, authorization-aware endpoint.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.bannerUrl} alt="Profile banner preview" />
          ) : (
            <span><ImageSquare size={30} /> Add a profile banner</span>
          )}
          <span className="profile-media-avatar-preview">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="Avatar preview" />
            ) : (
              profile.displayName.slice(0, 1).toUpperCase()
            )}
          </span>
          <label className="profile-media-action is-banner">
            <ImageSquare size={17} />
            {profile.bannerUrl ? "Change banner" : "Upload banner"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={mediaBusy !== null}
              onChange={(event) => {
                void uploadMedia("banner", event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {profile.bannerUrl ? (
            <button
              className="profile-media-remove is-banner"
              type="button"
              disabled={mediaBusy !== null}
              onClick={() => void removeMedia("banner")}
              aria-label="Remove profile banner"
            >
              <Trash size={16} />
            </button>
          ) : null}
        </div>
        <div className="profile-media-avatar-stage">
          <label className="profile-media-action is-avatar">
            <Camera size={17} />
            {profile.avatarUrl ? "Change avatar" : "Upload avatar"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={mediaBusy !== null}
              onChange={(event) => {
                void beginAvatarCrop(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {profile.avatarUrl ? (
            <button
              className="profile-media-remove is-avatar"
              type="button"
              disabled={mediaBusy !== null}
              onClick={() => void removeMedia("avatar")}
            >
              <Trash size={16} /> Remove
            </button>
          ) : null}
          {mediaBusy ? <small role="status">Processing verified {mediaBusy}…</small> : null}
          {!mediaBusy && profile.revision < 1 ? (
            <small>Your profile will be saved automatically with the first upload.</small>
          ) : null}
        </div>
      </section>
      <section className="profile-settings-card">
        <div>
          <h3>Identity</h3>
          <p>Your username becomes the stable public profile address.</p>
        </div>
        <div className="profile-settings-grid">
          <label>
            <span>Username</span>
            <input
              required
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9_]+"
              value={profile.username}
              onChange={(event) =>
                setProfile((current) =>
                  current ? { ...current, username: event.target.value } : current,
                )
              }
            />
            <small>Letters, numbers, and underscores.</small>
          </label>
          <label>
            <span>Preferred language</span>
            <UnifiedSingleSelect
              value={profile.preferredLanguage}
              onChange={(event) =>
                setProfile((current) =>
                  current
                    ? { ...current, preferredLanguage: event.target.value }
                    : current,
                )
              }
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="ar">العربية</option>
              <option value="ja">日本語</option>
            </UnifiedSingleSelect>
          </label>
          <label className="profile-settings-wide">
            <span>Bio</span>
            <textarea
              rows={5}
              maxLength={500}
              value={profile.bio}
              onChange={(event) =>
                setProfile((current) =>
                  current ? { ...current, bio: event.target.value } : current,
                )
              }
            />
            <small>{profile.bio.length}/500</small>
          </label>
        </div>
      </section>
      <section className="profile-settings-card">
        <div>
          <h3>Favorite series</h3>
          <p>
            Pin and order up to 10 series on your public profile. Choices come
            from your Library.
          </p>
        </div>
        <div className="profile-favorites-editor">
          <label>
            <span>Add a series</span>
            <UnifiedSingleSelect
              value=""
              disabled={(profile.favorites?.length ?? 0) >= 10}
              onChange={(event) => {
                const selected = profile.favoriteCandidates?.find(
                  (candidate) => candidate.seriesId === event.target.value,
                );
                if (!selected) return;
                setProfile((current) =>
                  current &&
                  !(current.favorites ?? []).some(
                    (favorite) => favorite.seriesId === selected.seriesId,
                  )
                    ? {
                        ...current,
                        favorites: [...(current.favorites ?? []), selected],
                      }
                    : current,
                );
              }}
            >
              <option value="">
                {(profile.favorites?.length ?? 0) >= 10
                  ? "10 favorites selected"
                  : "Choose from your Library"}
              </option>
              {(profile.favoriteCandidates ?? [])
                .filter(
                  (candidate) =>
                    !(profile.favorites ?? []).some(
                      (favorite) =>
                        favorite.seriesId === candidate.seriesId,
                    ),
                )
                .map((candidate) => (
                  <option value={candidate.seriesId} key={candidate.seriesId}>
                    {candidate.seriesTitle}
                  </option>
                ))}
            </UnifiedSingleSelect>
          </label>
          {(profile.favorites ?? []).length ? (
            <ol aria-label="Favorite series order">
              {(profile.favorites ?? []).map((favorite, index, favorites) => (
                <li key={favorite.seriesId}>
                  <span className="profile-favorite-cover">
                    {favorite.coverUrl ? (
                      // Series art is served by a revisioned application endpoint.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={favorite.coverUrl}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <ImageSquare size={24} aria-hidden="true" />
                    )}
                  </span>
                  <span className="profile-favorite-copy">
                    <small>#{index + 1}</small>
                    <strong>{favorite.seriesTitle}</strong>
                  </span>
                  <span className="profile-favorite-actions">
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label={`Move ${favorite.seriesTitle} left`}
                      onClick={() =>
                        setProfile((current) => {
                          if (!current || index === 0) return current;
                          const next = [...(current.favorites ?? [])];
                          [next[index - 1], next[index]] = [
                            next[index]!,
                            next[index - 1]!,
                          ];
                          return { ...current, favorites: next };
                        })
                      }
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={index === favorites.length - 1}
                      aria-label={`Move ${favorite.seriesTitle} right`}
                      onClick={() =>
                        setProfile((current) => {
                          if (
                            !current ||
                            index === (current.favorites?.length ?? 0) - 1
                          ) {
                            return current;
                          }
                          const next = [...(current.favorites ?? [])];
                          [next[index], next[index + 1]] = [
                            next[index + 1]!,
                            next[index]!,
                          ];
                          return { ...current, favorites: next };
                        })
                      }
                    >
                      <ArrowRight size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${favorite.seriesTitle}`}
                      onClick={() =>
                        setProfile((current) =>
                          current
                            ? {
                                ...current,
                                favorites: (current.favorites ?? []).filter(
                                  (entry) =>
                                    entry.seriesId !== favorite.seriesId,
                                ),
                              }
                            : current,
                        )
                      }
                    >
                      <Trash size={16} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="field-help">
              No favorites pinned yet. Add series above to build your top 10.
            </p>
          )}
        </div>
      </section>
      <section className="profile-settings-card profile-theme-card">
        <div>
          <h3>Theme</h3>
          <p>Choose a preset or build a complete custom palette. Your shared theme follows this account and applies instantly across NyaScans.</p>
        </div>
        <Link className="button button-secondary" href="/theme-builder">
          Change Theme <ArrowRight size={16} />
        </Link>
      </section>
      <section className="profile-settings-card profile-privacy-card">
        <div>
          <h3>Privacy</h3>
          <p>These settings are enforced by the public profile API.</p>
        </div>
        <div className="profile-privacy-grid">
          <label>
            <span>Profile visibility</span>
            <UnifiedSingleSelect
              value={profile.privacy?.profileVisibility ?? "PUBLIC"}
              onChange={(event) =>
                setProfile((current) =>
                  current
                    ? {
                        ...current,
                        privacy: {
                          ...current.privacy,
                          profileVisibility: event.target.value as
                            | "PUBLIC"
                            | "PRIVATE",
                        },
                      }
                    : current,
                )
              }
            >
              <option value="PUBLIC">Public</option>
              <option value="PRIVATE">Private</option>
            </UnifiedSingleSelect>
          </label>
          <label>
            <span>Followers and following</span>
            <UnifiedSingleSelect
              value={profile.privacy?.followersVisibility ?? "PUBLIC"}
              onChange={(event) =>
                setProfile((current) =>
                  current
                    ? {
                        ...current,
                        privacy: {
                          ...current.privacy,
                          followersVisibility: event.target.value as
                            | "PUBLIC"
                            | "PRIVATE",
                        },
                      }
                    : current,
                )
              }
            >
              <option value="PUBLIC">Public counts</option>
              <option value="PRIVATE">Private</option>
            </UnifiedSingleSelect>
          </label>
          {(
            [
              [
                "showReadingHistory",
                "Share activity",
                "Shows a limited list of recently read public chapters and their dates.",
              ],
              [
                "showChapterNumbers",
                "Show chapter numbers",
                "Only applies when recent reading is shared.",
              ],
              [
                "showFavorites",
                "Share favorite series",
                "Shows your ordered top 10 favorite series.",
              ],
              [
                "showAchievements",
                "Share achievements",
                "Shows badges and achievements earned on NyaScans.",
              ],
              [
                "showBookmarks",
                "Share followed series",
                "Shows the public series you follow.",
              ],
              [
                "showComments",
                "Share comments",
                "Shows recent visible comments with chapter and engagement details.",
              ],
            ] as const
          ).map(([key, title, body]) => (
            <label className="profile-privacy-toggle" key={key}>
              <input
                type="checkbox"
                checked={Boolean(profile.privacy?.[key])}
                onChange={(event) =>
                  setProfile((current) =>
                    current
                      ? {
                          ...current,
                          privacy: {
                            ...current.privacy,
                            [key]: event.target.checked,
                          },
                        }
                      : current,
                  )
                }
              />
              <span>
                <strong>{title}</strong>
                <small>{body}</small>
              </span>
            </label>
          ))}
        </div>
      </section>
      <footer className="profile-settings-actions">
        <span>
          {dirty ? (
            <>
              <WarningCircle size={17} /> Unsaved changes
            </>
          ) : (
            <>
              <CheckCircle size={17} /> Saved
            </>
          )}
        </span>
        <button
          className="button button-primary"
          type="submit"
          disabled={!dirty || saving}
        >
          <FloppyDisk size={17} />
          {saving ? "Saving…" : mode === "profile" ? "Save profile" : "Save visibility"}
        </button>
      </footer>
      {avatarCropSource ? (
        <AvatarCropDialog
          source={avatarCropSource}
          busy={mediaBusy === "avatar"}
          onCancel={() => setAvatarCropSource(null)}
          onSave={async (file) => {
            const saveError = await uploadMedia("avatar", file);
            if (!saveError) setAvatarCropSource(null);
            return saveError;
          }}
        />
      ) : null}
    </form>
  );
}
