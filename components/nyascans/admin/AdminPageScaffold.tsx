"use client";

import {
  CheckCircle,
  LockKey,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

const dirtySources = new Map<symbol, string>();

function broadcastDirtyState() {
  const labels = [...new Set(dirtySources.values())];
  window.dispatchEvent(
    new CustomEvent("nyascans-admin-dirty", {
      detail: {
        dirty: dirtySources.size > 0,
        label:
          labels.length > 1
            ? `${labels.slice(0, 2).join(" and ")}`
            : labels[0] ?? "administrative changes",
      },
    }),
  );
}

export type AdminPageState =
  | { kind: "ready" }
  | { kind: "loading"; message?: string }
  | { kind: "empty"; title: string; message: string }
  | {
      kind: "error" | "denied";
      title: string;
      message: string;
      onRetry?: () => void;
    };

export function useUnsavedChanges(
  dirty: boolean,
  label = "administrative changes",
) {
  const source = useRef(Symbol(label));
  useEffect(() => {
    const sourceId = source.current;
    if (dirty) dirtySources.set(sourceId, label);
    else dirtySources.delete(sourceId);
    broadcastDirtyState();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtySources.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      dirtySources.delete(sourceId);
      broadcastDirtyState();
    };
  }, [dirty, label]);
}

export function AdminPageScaffold({
  breadcrumbs = [],
  kicker,
  title,
  description,
  primaryAction,
  tabs,
  activeTab,
  onTabChange,
  state = { kind: "ready" },
  message,
  children,
}: {
  breadcrumbs?: string[];
  kicker: string;
  title: string;
  description: string;
  primaryAction?: ReactNode;
  tabs?: Array<{ key: string; label: string; count?: number }>;
  activeTab?: string;
  onTabChange?: (key: string) => void;
  state?: AdminPageState;
  message?: { kind: "success" | "error" | "neutral"; text: string } | null;
  children: ReactNode;
}) {
  return (
    <section className="admin-workspace">
      {breadcrumbs.length ? (
        <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`}>
              {index ? <i aria-hidden="true">/</i> : null}
              {crumb}
            </span>
          ))}
        </nav>
      ) : null}
      <header className="admin-workspace-header">
        <div>
          <span className="ops-kicker">{kicker}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {primaryAction ? (
          <div className="admin-primary-action">{primaryAction}</div>
        ) : null}
      </header>
      {tabs?.length ? (
        <div className="admin-subnav" role="tablist" aria-label={`${title} sections`}>
          {tabs.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              key={tab.key}
              onClick={() => onTabChange?.(tab.key)}
            >
              {tab.label}
              {typeof tab.count === "number" ? <small>{tab.count}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
      {message ? (
        <div
          className={`admin-notice admin-notice-${message.kind}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.kind === "success" ? (
            <CheckCircle size={18} weight="fill" />
          ) : (
            <WarningCircle size={18} />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}
      {state.kind === "loading" ? (
        <div className="admin-state-card" role="status" aria-live="polite">
          <span className="admin-spinner" />
          <h3>Loading</h3>
          <p>{state.message ?? "Loading the latest administrative data…"}</p>
        </div>
      ) : state.kind === "empty" ? (
        <div className="admin-state-card">
          <h3>{state.title}</h3>
          <p>{state.message}</p>
        </div>
      ) : state.kind === "error" || state.kind === "denied" ? (
        <div className="admin-state-card" role="alert">
          {state.kind === "denied" ? (
            <LockKey size={24} />
          ) : (
            <WarningCircle size={24} />
          )}
          <h3>{state.title}</h3>
          <p>{state.message}</p>
          {state.onRetry ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={state.onRetry}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCancelRef.current = onCancel;
    busyRef.current = busy;
  }, [busy, onCancel]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      if (busyRef.current) dialogRef.current?.focus();
      else cancelRef.current?.focus();
    });
    function onKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="admin-dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="admin-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h3 id={titleId}>{title}</h3>
        <p id={descriptionId}>{description}</p>
        <div>
          <button
            ref={cancelRef}
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={`button ${destructive ? "button-danger" : "button-primary"}`}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
