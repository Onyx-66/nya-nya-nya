"use client";
/* eslint-disable @next/next/no-img-element */

import {
  Check,
  FileImage,
  SpinnerGap,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  computeCropRect,
  cropStaticMedia,
  optimizeStaticMedia,
  type CropMediaProfile,
  type StaticMediaProfile,
} from "@/lib/client/media-optimizer";
import { optimizeReactionAsset } from "@/lib/client/reaction-media";

export function AdminMediaField({
  label,
  helperText,
  recommendedDimensions,
  currentUrl,
  file,
  accept,
  busy = false,
  disabledReason,
  cropProfile,
  mediaProfile = {
    maxWidth: 2_800,
    maxHeight: 2_800,
    maxBytes: 4_000_000,
  },
  onSelect,
  onRemove,
}: {
  label: string;
  helperText: string;
  recommendedDimensions?: string;
  currentUrl?: string | null;
  file?: File | null;
  accept: string;
  busy?: boolean;
  disabledReason?: string;
  cropProfile?: CropMediaProfile;
  mediaProfile?: StaticMediaProfile | null;
  onSelect(file: File | null): void;
  onRemove(): void;
}) {
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(0.5);
  const [positionY, setPositionY] = useState(0.5);
  const [cropDimensions, setCropDimensions] = useState({
    width: 0,
    height: 0,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropDialogRef = useRef<HTMLDivElement>(null);
  const preparingRef = useRef(false);
  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : currentUrl ?? ""),
    [currentUrl, file],
  );
  const cropPreviewUrl = useMemo(
    () => (cropFile ? URL.createObjectURL(cropFile) : ""),
    [cropFile],
  );
  useEffect(
    () => () => {
      if (file && previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [file, previewUrl],
  );
  useEffect(
    () => () => {
      if (cropPreviewUrl) URL.revokeObjectURL(cropPreviewUrl);
    },
    [cropPreviewUrl],
  );
  useEffect(() => {
    preparingRef.current = preparing;
  }, [preparing]);
  useEffect(() => {
    if (!cropFile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      cropDialogRef.current
        ?.querySelector<HTMLElement>("[data-crop-initial-focus]")
        ?.focus();
    });
    function closeOrTrapCrop(event: KeyboardEvent) {
      if (event.key === "Escape" && !preparingRef.current) {
        event.stopImmediatePropagation();
        setCropFile(null);
        window.requestAnimationFrame(() => fileInputRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        cropDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
    document.addEventListener("keydown", closeOrTrapCrop);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOrTrapCrop);
    };
  }, [cropFile]);

  function closeCrop() {
    setCropFile(null);
    window.requestAnimationFrame(() => fileInputRef.current?.focus());
  }

  async function prepareFile(nextFile: File | null) {
    if (!nextFile) {
      onSelect(null);
      return;
    }
    setPrepareError("");
    if (cropProfile) {
      if (nextFile.type === "image/gif") {
        setPrepareError("Animated GIFs cannot be cropped in this field.");
        return;
      }
      setCropFile(nextFile);
      setZoom(1);
      setPositionX(0.5);
      setPositionY(0.5);
      setCropDimensions({ width: 0, height: 0 });
      return;
    }
    setPreparing(true);
    try {
      const prepared =
        nextFile.type === "image/gif"
          ? (await optimizeReactionAsset(nextFile)).file
          : mediaProfile
            ? await optimizeStaticMedia(nextFile, mediaProfile)
            : nextFile;
      onSelect(prepared);
    } catch (error) {
      setPrepareError(
        error instanceof Error
          ? error.message
          : "The image could not be prepared.",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function applyCrop() {
    if (!cropFile || !cropProfile) return;
    setPreparing(true);
    setPrepareError("");
    try {
      const prepared = await cropStaticMedia(cropFile, cropProfile, {
        zoom,
        x: positionX,
        y: positionY,
      });
      onSelect(prepared);
      closeCrop();
    } catch (error) {
      setPrepareError(
        error instanceof Error
          ? error.message
          : "The crop could not be applied.",
      );
    } finally {
      setPreparing(false);
    }
  }

  const fieldBusy = busy || preparing;
  const cropPreviewStyle = useMemo(() => {
    if (
      !cropProfile ||
      cropDimensions.width <= 0 ||
      cropDimensions.height <= 0
    ) {
      return {
        "--crop-aspect": cropProfile?.aspect ?? 1,
        "--crop-image-width": "100%",
        "--crop-image-height": "100%",
        "--crop-image-left": "0%",
        "--crop-image-top": "0%",
      } as CSSProperties;
    }
    const rect = computeCropRect(
      cropDimensions.width,
      cropDimensions.height,
      cropProfile.aspect,
      { zoom, x: positionX, y: positionY },
    );
    return {
      "--crop-aspect": cropProfile.aspect,
      "--crop-image-width": `${(cropDimensions.width / rect.cropWidth) * 100}%`,
      "--crop-image-height": `${(cropDimensions.height / rect.cropHeight) * 100}%`,
      "--crop-image-left": `${(-rect.sourceX / rect.cropWidth) * 100}%`,
      "--crop-image-top": `${(-rect.sourceY / rect.cropHeight) * 100}%`,
    } as CSSProperties;
  }, [
    cropDimensions.height,
    cropDimensions.width,
    cropProfile,
    positionX,
    positionY,
    zoom,
  ]);
  return (
    <div className="admin-media-field">
      <div className="admin-media-preview">
        {previewUrl ? (
          <img src={previewUrl} alt={`${label} preview`} />
        ) : (
          <span>
            <FileImage size={28} />
            No image
          </span>
        )}
        {fieldBusy ? (
          <span className="admin-media-progress">
            {preparing ? "Optimizing…" : "Uploading…"}
          </span>
        ) : null}
      </div>
      <div className="admin-media-copy">
        <strong>{label}</strong>
        <p>{helperText}</p>
        {recommendedDimensions ? (
          <small>Recommended: {recommendedDimensions}</small>
        ) : null}
        <div>
          <label className="button button-secondary">
            {previewUrl ? "Replace" : "Choose image"}
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              disabled={fieldBusy || Boolean(disabledReason)}
              onChange={(event) => {
                void prepareFile(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {previewUrl ? (
            <button
              className="button button-ghost"
              type="button"
              disabled={fieldBusy || Boolean(disabledReason)}
              onClick={onRemove}
            >
              <Trash size={16} />
              Remove
            </button>
          ) : null}
        </div>
        {disabledReason ? (
          <small className="admin-disabled-reason">{disabledReason}</small>
        ) : null}
        {prepareError ? (
          <small className="admin-media-error" role="alert">
            {prepareError}
          </small>
        ) : null}
      </div>
      {cropFile && cropProfile ? (
        <div
          className="admin-crop-dialog"
          ref={cropDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Crop ${label}`}
        >
          <div className="admin-crop-dialog-card">
            <header>
              <div>
                <strong>Crop {label}</strong>
                <span>
                  Output {cropProfile.outputWidth} × {cropProfile.outputHeight}
                </span>
              </div>
              <button
                type="button"
                aria-label="Cancel crop"
                data-crop-initial-focus
                disabled={preparing}
                onClick={closeCrop}
              >
                <X size={18} />
              </button>
            </header>
            <div
              className="admin-crop-preview"
              style={cropPreviewStyle}
            >
              <img
                src={cropPreviewUrl}
                alt=""
                onLoad={(event) =>
                  setCropDimensions({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
              <span aria-hidden="true" />
            </div>
            <div className="admin-crop-controls">
              <label>
                Zoom
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </label>
              <label>
                Horizontal position
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={positionX}
                  onChange={(event) =>
                    setPositionX(Number(event.target.value))
                  }
                />
              </label>
              <label>
                Vertical position
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={positionY}
                  onChange={(event) =>
                    setPositionY(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <footer>
              <button
                className="button button-secondary"
                type="button"
                disabled={preparing}
                onClick={closeCrop}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={preparing}
                onClick={() => void applyCrop()}
              >
                {preparing ? (
                  <SpinnerGap className="spin" size={17} />
                ) : (
                  <Check size={17} />
                )}
                {preparing ? "Preparing…" : "Use crop"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
