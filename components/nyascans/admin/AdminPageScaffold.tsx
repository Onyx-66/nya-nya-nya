"use client";

import {
  CheckCircle,
  Clock,
  Info,
  LockKey,
  Tray,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { SystemNoticeBridge } from "@/components/nyascans/SystemNotifications";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
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

export type AdminStatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

export function AdminStatGrid({ children }: { children: ReactNode }) {
  return <div className="admin-stat-grid">{children}</div>;
}

export function AdminStatTile({
  icon,
  label,
  value,
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  caption?: ReactNode;
}) {
  return (
    <article className="admin-stat-tile">
      <span className="admin-stat-tile-icon" aria-hidden="true">{icon}</span>
      <span className="admin-stat-tile-label">{label}</span>
      <strong>{value}</strong>
      {caption ? <small>{caption}</small> : null}
    </article>
  );
}

export function AdminSectionCard({
  icon,
  title,
  summary,
  action,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  icon?: ReactNode;
  title: string;
  summary?: ReactNode;
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const heading = (
    <span className="admin-section-card-heading">
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>
        <strong>{title}</strong>
        {summary ? <small>{summary}</small> : null}
      </span>
    </span>
  );
  if (collapsible) {
    return (
      <details className="admin-section-card is-collapsible" open={defaultOpen}>
        <summary>{heading}</summary>
        <div className="admin-section-card-content">{children}</div>
      </details>
    );
  }
  return (
    <section className="admin-section-card">
      <header>
        {heading}
        {action ? <div className="admin-section-card-action">{action}</div> : null}
      </header>
      <div className="admin-section-card-content">{children}</div>
    </section>
  );
}

export function AdminStatusBadge({
  tone,
  label,
  icon,
}: {
  tone: AdminStatusTone;
  label: string;
  icon?: ReactNode;
}) {
  const statusIcon =
    icon ??
    (tone === "success" ? (
      <CheckCircle />
    ) : tone === "warning" ? (
      <Clock />
    ) : tone === "danger" ? (
      <XCircle />
    ) : tone === "info" ? (
      <Info />
    ) : (
      <Info />
    ));
  return (
    <span className={`admin-status-badge is-${tone}`}>
      <span aria-hidden="true">{statusIcon}</span>
      {label}
    </span>
  );
}

export function AdminFormField({
  label,
  labelFor,
  helper,
  error,
  children,
}: {
  label: string;
  labelFor?: string;
  helper?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="admin-form-field">
      <label htmlFor={labelFor}>{label}</label>
      {children}
      {error ? (
        <small className="admin-form-error" role="alert">{error}</small>
      ) : helper ? (
        <small>{helper}</small>
      ) : null}
    </div>
  );
}

export function AdminResponsiveData({
  desktop,
  mobile,
}: {
  desktop: ReactNode;
  mobile: ReactNode;
}) {
  return (
    <div className="admin-responsive-data">
      <div className="admin-responsive-data-desktop">{desktop}</div>
      <div className="admin-responsive-data-mobile">{mobile}</div>
    </div>
  );
}

export function AdminStickyActions({ children }: { children: ReactNode }) {
  return <div className="admin-sticky-actions">{children}</div>;
}

export type AdminComboboxOption = Readonly<{
  value: string;
  label: string;
  description?: string;
}>;

export function AdminCombobox({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Search options…",
  emptyLabel,
  disabled = false,
}: {
  value: string;
  options: readonly AdminComboboxOption[];
  onChange(value: string): void;
  ariaLabel: string;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? null;
  const [draftQuery, setDraftQuery] = useState<string | null>(null);
  const query = draftQuery ?? selected?.label ?? "";
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-US");
    if (!needle || selected?.label === query) return [...options];
    return options.filter((option) =>
      `${option.label} ${option.value} ${option.description ?? ""}`
        .toLocaleLowerCase("en-US")
        .includes(needle),
    );
  }, [options, query, selected?.label]);
  const displayedOptions = useMemo(
    () =>
      emptyLabel
        ? [{ value: "", label: emptyLabel } as AdminComboboxOption, ...filtered]
        : filtered,
    [emptyLabel, filtered],
  );

  function choose(option: AdminComboboxOption | null) {
    onChange(option?.value ?? "");
    setDraftQuery(null);
    setOpen(false);
    setActiveIndex(0);
  }

  return (
    <div
      className="admin-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setDraftQuery(null);
          setOpen(false);
        }
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && displayedOptions[activeIndex]
            ? `${listboxId}-${activeIndex}`
            : undefined
        }
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onFocus={(event) => {
          setOpen(true);
          setActiveIndex(0);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraftQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              displayedOptions.length
                ? (current + 1) % displayedOptions.length
                : 0,
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              displayedOptions.length
                ? (current - 1 + displayedOptions.length) %
                  displayedOptions.length
                : 0,
            );
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const option = displayedOptions[activeIndex];
            if (option) choose(option.value ? option : null);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraftQuery(null);
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div className="admin-combobox-list" id={listboxId} role="listbox">
          {displayedOptions.length ? (
            displayedOptions.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${listboxId}-${index}`}
                aria-selected={option.value === value}
                className={index === activeIndex ? "is-active" : undefined}
                key={option.value}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(option.value ? option : null)}
              >
                <strong>{option.label}</strong>
                <small>{option.description ?? option.value}</small>
              </button>
            ))
          ) : (
            <span className="admin-combobox-empty">No matching option</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AdminEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="admin-empty-state">
      <span aria-hidden="true">{icon ?? <Tray size={32} />}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

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
  embedded = false,
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
  embedded?: boolean;
  primaryAction?: ReactNode;
  tabs?: Array<{ key: string; label: string; count?: number }>;
  activeTab?: string;
  onTabChange?: (key: string) => void;
  state?: AdminPageState;
  message?: { kind: "success" | "error" | "neutral"; text: string } | null;
  children: ReactNode;
}) {
  return (
    <section className={`admin-workspace${embedded ? " is-embedded" : ""}`}>
      {!embedded && breadcrumbs.length ? (
        <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`}>
              {index ? <i aria-hidden="true">/</i> : null}
              {crumb}
            </span>
          ))}
        </nav>
      ) : null}
      {!embedded ? (
        <header className="admin-workspace-header">
          <div>
            <span className="ops-kicker">{kicker}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {primaryAction ? (
            <div className="admin-primary-action">{primaryAction}</div>
          ) : null}
        </header>
      ) : primaryAction ? (
        <div className="admin-embedded-actions">{primaryAction}</div>
      ) : null}
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
        <SystemNoticeBridge
          message={message.text}
          kind={
            message.kind === "neutral"
              ? "info"
              : message.kind
          }
        />
      ) : null}
      {state.kind === "loading" ? (
        <div className="admin-state-card" role="status" aria-live="polite">
          <span className="admin-spinner" />
          <h3>Loading</h3>
          <p>{state.message ?? "Loading the latest administrative data…"}</p>
        </div>
      ) : state.kind === "empty" ? (
        <AdminEmptyState title={state.title} description={state.message} />
      ) : state.kind === "error" || state.kind === "denied" ? (
        <div className="admin-state-card" role="alert">
          {state.kind === "denied" ? (
            <LockKey size={32} />
          ) : (
            <WarningCircle size={32} />
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

type PromptActionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  minLength?: number;
  maxLength?: number;
  onCancel(): void;
  onConfirm(value: string): void;
};

export function PromptActionDialog(props: PromptActionDialogProps) {
  if (!props.open) return null;
  return <PromptActionDialogContent {...props} />;
}

function PromptActionDialogContent({
  open,
  title,
  description,
  label,
  initialValue = "",
  placeholder,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  minLength = 1,
  maxLength = 1000,
  onCancel,
  onConfirm,
}: PromptActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  const [value, setValue] = useState(initialValue);

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
      else {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
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
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
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
  const normalizedValue = value.trim();
  return (
    <div className="admin-dialog-backdrop" role="presentation">
      <form
        ref={dialogRef}
        tabIndex={-1}
        className="admin-confirm-dialog admin-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && normalizedValue.length >= minLength) {
            onConfirm(normalizedValue);
          }
        }}
      >
        <h3 id={titleId}>{title}</h3>
        <p id={descriptionId}>{description}</p>
        <label htmlFor={inputId}>
          {label}
          <textarea
            ref={inputRef}
            id={inputId}
            rows={4}
            required
            minLength={minLength}
            maxLength={maxLength}
            disabled={busy}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
          />
          <small>
            {normalizedValue.length < minLength
              ? `Enter at least ${minLength} characters.`
              : `${value.length} / ${maxLength}`}
          </small>
        </label>
        <div>
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={`button ${destructive ? "button-danger" : "button-primary"}`}
            type="submit"
            disabled={busy || normalizedValue.length < minLength}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
