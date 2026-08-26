"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";
/* eslint-disable @next/next/no-img-element */

import {
  Check,
  ImageSquare,

  X,
} from "@/components/nyascans/heroicons";
import { useCallback, useEffect, useState } from "react";
import { LanguageFlag } from "@/components/nyascans/LanguageFlag";

type ModerationAsset = {
  id: string;
  seriesTitle: string;
  kind: "ART" | "COVER";
  orientation: "LANDSCAPE" | "PORTRAIT";
  caption: string;
  altText: string;
  language: string | null;
  coverType: "OFFICIAL" | "FAN_MADE" | null;
  width: number;
  height: number;
  byteSize: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  revision: number;
  createdAt: string;
  submittedBy: string;
  teamName: string | null;
  assetUrl: string;
};

export function SeriesGalleryModerationPanel() {
  const [assets, setAssets] = useState<ModerationAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [rejectionId, setRejectionId] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/v1/admin/series-gallery?status=PENDING&pageSize=50",
        { cache: "no-store", signal },
      );
      const payload = (await response.json()) as {
        data?: ModerationAsset[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Gallery moderation could not be loaded.",
        );
      }
      setAssets(payload.data ?? []);
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Gallery moderation could not be loaded.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void load(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  async function moderate(
    asset: ModerationAsset,
    decision: "APPROVED" | "REJECTED",
  ) {
    setBusyId(asset.id);
    setError("");
    try {
      const response = await fetch("/api/v1/admin/series-gallery", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: asset.id,
          expectedRevision: asset.revision,
          decision,
          reason: decision === "REJECTED" ? reason : "",
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "The moderation decision was not saved.",
        );
      }
      setAssets((current) => current.filter((entry) => entry.id !== asset.id));
      setRejectionId("");
      setReason("");
    } catch (moderationError) {
      setError(
        moderationError instanceof Error
          ? moderationError.message
          : "The moderation decision was not saved.",
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <details className="admin-gallery-moderation" open={assets.length > 0}>
      <summary>
        <span>
          <ImageSquare size={18} />
          Art &amp; cover moderation
        </span>
        <strong>{assets.length} pending</strong>
      </summary>
      {error ? (
        <p className="admin-notice admin-notice-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="admin-inline-empty" role="status">
          <DotsRing size={17} /> Loading gallery queue…
        </p>
      ) : assets.length ? (
        <div className="admin-gallery-queue">
          {assets.map((asset) => (
            <article key={asset.id}>
              <img
                className={
                  asset.kind === "COVER"
                    ? "admin-gallery-cover-preview"
                    : "admin-gallery-art-preview"
                }
                src={asset.assetUrl}
                alt={
                  asset.altText ||
                  asset.caption ||
                  `${asset.seriesTitle} ${
                    asset.kind === "COVER" ? "cover" : "art"
                  }`
                }
              />
              <div>
                <span>
                  {asset.kind} · {asset.orientation}
                  {asset.kind === "COVER" && asset.coverType
                    ? ` · ${
                        asset.coverType === "FAN_MADE"
                          ? "Fan Made"
                          : "Official"
                      }`
                    : ""}
                </span>
                <strong>{asset.seriesTitle}</strong>
                <p>{asset.caption || "No caption provided."}</p>
                <small>
                  {asset.submittedBy}
                  {asset.teamName ? ` · ${asset.teamName}` : ""}
                  {asset.kind === "COVER" && asset.language ? (
                    <>
                      {" · "}
                      <LanguageFlag
                        language={asset.language}
                        showCode
                      />
                    </>
                  ) : null}
                  {" · "}
                  {asset.width} × {asset.height}
                </small>
              </div>
              {rejectionId === asset.id ? (
                <div className="admin-gallery-rejection">
                  <label>
                    <span>Reason</span>
                    <textarea
                      value={reason}
                      maxLength={500}
                      placeholder="Explain what should be changed"
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busyId === asset.id || reason.trim().length < 3}
                    onClick={() => void moderate(asset, "REJECTED")}
                  >
                    <X size={16} /> Confirm rejection
                  </button>
                </div>
              ) : (
                <div className="admin-gallery-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => void moderate(asset, "APPROVED")}
                  >
                    {busyId === asset.id ? (
                      <DotsRing size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    Approve
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => setRejectionId(asset.id)}
                  >
                    <X size={16} /> Reject
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="admin-inline-empty">No art or cover submissions need review.</p>
      )}
    </details>
  );
}
