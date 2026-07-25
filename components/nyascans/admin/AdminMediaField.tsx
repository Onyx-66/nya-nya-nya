"use client";
/* eslint-disable @next/next/no-img-element */

import { FileImage, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";

export function AdminMediaField({
  label,
  helperText,
  recommendedDimensions,
  currentUrl,
  file,
  accept,
  busy = false,
  disabledReason,
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
  onSelect(file: File | null): void;
  onRemove(): void;
}) {
  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : currentUrl ?? ""),
    [currentUrl, file],
  );
  useEffect(
    () => () => {
      if (file && previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [file, previewUrl],
  );
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
        {busy ? <span className="admin-media-progress">Uploading…</span> : null}
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
              type="file"
              accept={accept}
              disabled={busy || Boolean(disabledReason)}
              onChange={(event) =>
                onSelect(event.target.files?.[0] ?? null)
              }
            />
          </label>
          {previewUrl ? (
            <button
              className="button button-ghost"
              type="button"
              disabled={busy || Boolean(disabledReason)}
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
      </div>
    </div>
  );
}
