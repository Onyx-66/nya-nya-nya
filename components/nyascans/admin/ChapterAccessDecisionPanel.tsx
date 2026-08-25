"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import {
  ArrowClockwise,
  CheckCircle,
  Coins,
  LockKey,

  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminPageScaffold,
  ConfirmActionDialog,
} from "@/components/nyascans/admin/AdminPageScaffold";

type AccessDecision = {
  id: string;
  chapterId: string;
  referenceChapterId: string | null;
  referenceChapterNumber: string;
  reason: "SAME_CHAPTER_VERSION" | "PREVIOUS_CHAPTER";
  requestedAccessType: "FREE";
  forcedPriceOnyx: number;
  status: "PENDING" | "KEPT_PAID" | "MADE_FREE";
  resolutionNote: string;
  revision: number;
  createdAt: string;
  resolvedAt: string | null;
  seriesSlug: string;
  seriesTitle: string;
  chapterNumber: string;
  chapterLanguage: string;
  teamName: string | null;
  uploaderName: string | null;
  referenceLanguage: string | null;
  referenceTeamName: string | null;
  resolvedByName: string | null;
};

type ApiPayload = {
  data?: AccessDecision[] | AccessDecision | null;
  error?: { message?: string };
};

async function readJson(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as ApiPayload;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? "Chapter access decisions could not be loaded.",
    );
  }
  return payload;
}

export function ChapterAccessDecisionPanel() {
  const [records, setRecords] = useState<AccessDecision[]>([]);
  const [tab, setTab] = useState<"pending" | "resolved">("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "neutral";
    text: string;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    record: AccessDecision;
    action: "KEEP_PAID" | "MAKE_REFERENCE_FREE";
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await readJson(
        await fetch("/api/v1/admin/chapter-access-decisions?status=ALL", {
          cache: "no-store",
        }),
      );
      setRecords(Array.isArray(payload.data) ? payload.data : []);
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Chapter access decisions could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pendingCount = records.filter(
    (record) => record.status === "PENDING",
  ).length;
  const visible = useMemo(
    () =>
      records.filter((record) =>
        tab === "pending"
          ? record.status === "PENDING"
          : record.status !== "PENDING",
      ),
    [records, tab],
  );

  async function resolve() {
    if (!confirmation) return;
    const { record, action } = confirmation;
    setConfirmation(null);
    setBusyId(record.id);
    setMessage(null);
    try {
      const payload = await readJson(
        await fetch("/api/v1/admin/chapter-access-decisions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decisionId: record.id,
            expectedRevision: record.revision,
            action,
            note: "Resolved from the chapter access decision queue.",
          }),
        }),
      );
      const updated = !Array.isArray(payload.data) ? payload.data : null;
      if (updated) {
        setRecords((current) =>
          current.map((entry) =>
            entry.id === updated.id ? updated : entry,
          ),
        );
      } else {
        await load();
      }
      setMessage({
        kind: "success",
        text:
          action === "KEEP_PAID"
            ? "The reference chapter remains Paid."
            : "All eligible versions of the reference chapter are now Free.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The chapter access decision could not be saved.",
      });
    } finally {
      setBusyId("");
    }
  }

  return (
    <AdminPageScaffold
      breadcrumbs={["Admin", "Catalogue & publishing"]}
      kicker="Manager+ decision queue"
      title="Access decisions"
      description="Review releases requested as Free that were safely aligned with an existing Paid chapter. The newly uploaded chapter remains Paid at the enforced price; you decide the reference chapter's access."
      primaryAction={
        <button
          className="button button-secondary"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          <ArrowClockwise /> Refresh
        </button>
      }
      tabs={[
        { key: "pending", label: "Needs decision", count: pendingCount },
        {
          key: "resolved",
          label: "Resolved",
          count: records.length - pendingCount,
        },
      ]}
      activeTab={tab}
      onTabChange={(next) => setTab(next as typeof tab)}
      message={message}
      state={
        loading
          ? { kind: "loading", message: "Loading access decisions…" }
          : visible.length
            ? { kind: "ready" }
            : {
                kind: "empty",
                title:
                  tab === "pending"
                    ? "No access decisions waiting"
                    : "No resolved decisions yet",
                message:
                  tab === "pending"
                    ? "New policy notices will appear here automatically."
                    : "Resolved decisions remain available as an audit-friendly history.",
              }
      }
    >
      <div className="access-decision-list">
        {visible.map((record) => (
          <article key={record.id} data-status={record.status.toLowerCase()}>
            <span className="access-decision-icon">
              {record.status === "PENDING" ? (
                <WarningCircle weight="duotone" />
              ) : (
                <CheckCircle weight="duotone" />
              )}
            </span>
            <div className="access-decision-copy">
              <header>
                <div>
                  <small>{record.seriesTitle}</small>
                  <h3>Chapter {record.chapterNumber} requested Free</h3>
                </div>
                <span>{record.status.replaceAll("_", " ")}</span>
              </header>
              <p>
                It was forced Paid at <strong>{record.forcedPriceOnyx} paws</strong>{" "}
                because {record.reason === "SAME_CHAPTER_VERSION" ? "another version of" : "the preceding"}{" "}
                chapter {record.referenceChapterNumber} is Paid.
              </p>
              <dl>
                <div><dt>Uploader</dt><dd>{record.uploaderName ?? "Unknown"}</dd></div>
                <div><dt>Publisher</dt><dd>{record.teamName ?? "Unknown team"}</dd></div>
                <div><dt>Reference</dt><dd>Chapter {record.referenceChapterNumber} · {record.referenceTeamName ?? "another publisher"}</dd></div>
                <div><dt>Created</dt><dd>{new Date(record.createdAt).toLocaleString()}</dd></div>
              </dl>
              {record.status === "PENDING" ? (
                <div className="access-decision-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busyId === record.id}
                    onClick={() =>
                      setConfirmation({ record, action: "KEEP_PAID" })
                    }
                  >
                    <LockKey /> Keep reference Paid
                  </button>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={busyId === record.id}
                    onClick={() =>
                      setConfirmation({
                        record,
                        action: "MAKE_REFERENCE_FREE",
                      })
                    }
                  >
                    {busyId === record.id ? (
                      <DotsRing />
                    ) : (
                      <Coins />
                    )}
                    Make reference Free
                  </button>
                </div>
              ) : (
                <p className="access-decision-resolution">
                  {record.status === "KEPT_PAID"
                    ? "Reference kept Paid"
                    : "Reference made Free"}
                  {record.resolvedByName ? ` by ${record.resolvedByName}` : ""}
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
      <ConfirmActionDialog
        open={Boolean(confirmation)}
        title={
          confirmation?.action === "KEEP_PAID"
            ? "Keep the reference chapter Paid?"
            : "Make the reference chapter Free?"
        }
        description={
          confirmation?.action === "KEEP_PAID"
            ? "The uploaded chapter and its reference will remain Paid at the enforced price."
            : "Every eligible existing version of the reference chapter will become Free. The newly uploaded chapter remains Paid."
        }
        confirmLabel={
          confirmation?.action === "KEEP_PAID"
            ? "Keep Paid"
            : "Make Free"
        }
        destructive={false}
        busy={Boolean(busyId)}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void resolve()}
      />
    </AdminPageScaffold>
  );
}
