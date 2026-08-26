"use client";
import {
  CheckCircle,
  Info,
  Warning,
  WarningCircle,
  X,
} from "@/components/nyascans/heroicons";
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type SystemNotificationKind =
  | "success"
  | "info"
  | "warning"
  | "error";

type SystemNotificationInput = {
  kind: SystemNotificationKind;
  message: string;
  title?: string;
  duration?: number;
};

type SystemNotificationRecord = Required<
  Pick<SystemNotificationInput, "kind" | "message" | "title" | "duration">
> & {
  id: string;
};

type SystemNotificationContextValue = {
  notify: (input: SystemNotificationInput) => string;
  notifyText: (
    message: string,
    options?: Partial<Omit<SystemNotificationInput, "message">>,
  ) => string;
  dismiss: (id: string) => void;
};

const SystemNotificationContext =
  createContext<SystemNotificationContextValue | null>(null);

const defaultTitles: Record<SystemNotificationKind, string> = {
  success: "Saved",
  info: "Information",
  warning: "Needs attention",
  error: "Action failed",
};

export function inferSystemNotificationKind(
  message: string,
): SystemNotificationKind {
  const normalized = message.toLocaleLowerCase("en-US");
  if (
    /(could not|couldn.t|failed|failure|unavailable|invalid|denied|error|too low|no longer exists|not completed)/u.test(
      normalized,
    )
  ) {
    return "error";
  }
  if (
    /(sign in|unlock|choose|complete|required|at least|already|before|no processed|review the|try again|needs? |cannot|can.t )/u.test(
      normalized,
    )
  ) {
    return "warning";
  }
  if (
    /(saved|published|posted|created|updated|added|copied|completed|equipped|removed|sent|applied|opened|cleared|live)/u.test(
      normalized,
    )
  ) {
    return "success";
  }
  return "info";
}

function notificationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `notice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: SystemNotificationRecord;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(
      () => onDismiss(notification.id),
      notification.duration,
    );
    return () => window.clearTimeout(timeout);
  }, [notification.duration, notification.id, onDismiss]);

  const Icon =
    notification.kind === "success"
      ? CheckCircle
      : notification.kind === "info"
        ? Info
        : notification.kind === "warning"
          ? Warning
          : WarningCircle;
  const liveRole =
    notification.kind === "error" || notification.kind === "warning"
      ? "alert"
      : "status";

  return (
    <article
      className={`system-notification system-notification-${notification.kind}`}
      role={liveRole}
      aria-atomic="true"
      style={
        {
          "--system-notification-duration": `${notification.duration}ms`,
        } as CSSProperties
      }
    >
      <span className="system-notification-icon" aria-hidden="true">
        <Icon size={21} weight="fill" />
      </span>
      <div className="system-notification-copy">
        <strong>{notification.title}</strong>
        <p>{notification.message}</p>
      </div>
      <button
        type="button"
        aria-label={`Dismiss ${notification.title.toLowerCase()} notification`}
        onClick={() => onDismiss(notification.id)}
      >
        <X size={16} />
      </button>
      <i className="system-notification-progress" aria-hidden="true" />
    </article>
  );
}

export function SystemNotificationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [notifications, setNotifications] = useState<
    SystemNotificationRecord[]
  >([]);

  const dismiss = useCallback((id: string) => {
    setNotifications((current) =>
      current.filter((notification) => notification.id !== id),
    );
  }, []);

  const notify = useCallback((input: SystemNotificationInput) => {
    const message = input.message.trim();
    if (!message) return "";
    const id = notificationId();
    const next: SystemNotificationRecord = {
      id,
      kind: input.kind,
      message,
      title: input.title?.trim() || defaultTitles[input.kind],
      duration: Math.min(
        12_000,
        Math.max(
          3_200,
          input.duration ??
            (input.kind === "warning" || input.kind === "error"
              ? 7_600
              : 5_600),
        ),
      ),
    };
    setNotifications((current) => {
      const duplicate = current.find(
        (notification) =>
          notification.kind === next.kind &&
          notification.message === next.message,
      );
      if (duplicate) {
        return [
          { ...next, id: duplicate.id },
          ...current.filter(
            (notification) => notification.id !== duplicate.id,
          ),
        ];
      }
      return [next, ...current].slice(0, 4);
    });
    return id;
  }, []);

  const notifyText = useCallback(
    (
      message: string,
      options: Partial<Omit<SystemNotificationInput, "message">> = {},
    ) =>
      notify({
        kind: options.kind ?? inferSystemNotificationKind(message),
        message,
        title: options.title,
        duration: options.duration,
      }),
    [notify],
  );

  const value = useMemo(
    () => ({ notify, notifyText, dismiss }),
    [dismiss, notify, notifyText],
  );

  return (
    <SystemNotificationContext.Provider value={value}>
      {children}
      <aside
        className="system-notification-region"
        aria-label="System notifications"
        aria-live="polite"
      >
        {notifications.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={dismiss}
          />
        ))}
      </aside>
    </SystemNotificationContext.Provider>
  );
}

export function useSystemNotifications() {
  const context = useContext(SystemNotificationContext);
  if (!context) {
    throw new Error(
      "useSystemNotifications must be used inside SystemNotificationProvider.",
    );
  }
  return context;
}

export function SystemNoticeBridge({
  message,
  kind,
  title,
  duration,
}: {
  message: string;
  kind?: SystemNotificationKind;
  title?: string;
  duration?: number;
}) {
  const { notifyText } = useSystemNotifications();
  const lastMessage = useRef("");

  useEffect(() => {
    const normalized = message.trim();
    if (!normalized || normalized === lastMessage.current) return;
    lastMessage.current = normalized;
    notifyText(normalized, { kind, title, duration });
  }, [duration, kind, message, notifyText, title]);

  useEffect(() => {
    if (!message.trim()) lastMessage.current = "";
  }, [message]);

  return null;
}
