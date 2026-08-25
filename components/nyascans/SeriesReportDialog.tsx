"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";

import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";

import {

  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SERIES_REPORT_CATEGORIES,
  SERIES_REPORT_CATEGORY_LABELS,
  type SeriesReportCategory,
} from "@/lib/series-reports";

export function SeriesReportDialog({
  seriesId,
  seriesTitle,
  signedIn,
  onClose,
  onSignIn,
  showToast,
}: {
  seriesId: string;
  seriesTitle: string;
  signedIn: boolean;
  onClose(): void;
  onSignIn(): void;
  showToast(message: string): void;
}) {
  const [category, setCategory] =
    useState<SeriesReportCategory>("PORNOGRAPHY");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLButtonElement>(".unified-single-select-trigger")
        ?.focus();
    });
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submittingRef.current) {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signedIn) {
      onSignIn();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/series-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seriesId,
          category,
          description,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { message?: string };
        error?: { message?: string; fields?: Array<{ message?: string }> };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.fields?.[0]?.message ??
            payload.error?.message ??
            "The report could not be sent.",
        );
      }
      showToast(
        payload.data?.message ?? "Report sent to the Series Reports queue.",
      );
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The report could not be sent.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="series-report-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <form
        className="series-report-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="series-report-title"
        onSubmit={submit}
      >
        <header>
          <span className="series-report-icon" aria-hidden="true">
            <WarningCircle size={24} weight="fill" />
          </span>
          <div>
            <span>Reader safety report</span>
            <h2 id="series-report-title">Report {seriesTitle}</h2>
          </div>
          <button
            type="button"
            aria-label="Close report dialog"
            disabled={submitting}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <p>
          Choose the closest reason and explain where administrators should
          look. The publishing team will not see your identity.
        </p>
        <label>
          <span>Report category</span>
          <UnifiedSingleSelect
            value={category}
            disabled={submitting}
            onChange={(event) =>
              setCategory(event.target.value as SeriesReportCategory)
            }
          >
            {SERIES_REPORT_CATEGORIES.map((value) => (
              <option value={value} key={value}>
                {SERIES_REPORT_CATEGORY_LABELS[value]}
              </option>
            ))}
          </UnifiedSingleSelect>
        </label>
        {category === "CHILD_SEXUAL_ABUSE_MATERIAL" ? (
          <div className="series-report-critical-note" role="note">
            Do not upload, quote, or reproduce illegal material. Describe only
            where it appears so trained administrators can review it safely.
          </div>
        ) : null}
        <label>
          <span>Description</span>
          <textarea
            required
            minLength={12}
            maxLength={2_000}
            rows={6}
            value={description}
            disabled={submitting}
            placeholder="Explain what is wrong, where it appears, and any context administrators need."
            onChange={(event) => setDescription(event.target.value)}
          />
          <small>{description.length} / 2000</small>
        </label>
        {error ? (
          <div className="series-report-error" role="alert">
            <WarningCircle size={17} />
            <span>{error}</span>
          </div>
        ) : null}
        <footer>
          <button
            className="button button-secondary"
            type="button"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-danger"
            type="submit"
            disabled={submitting || (signedIn && description.trim().length < 12)}
          >
            {submitting ? (
              <>
                <DotsRing size={16} /> Sending…
              </>
            ) : signedIn ? (
              "Send report"
            ) : (
              "Sign in to report"
            )}
          </button>
        </footer>
      </form>
    </div>
  );
}
