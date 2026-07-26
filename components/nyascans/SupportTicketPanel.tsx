"use client";

import {
  ArrowClockwise,
  ChatCircle,
  CheckCircle,
  PaperPlaneTilt,
} from "@phosphor-icons/react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

type Ticket = {
  id: string;
  caseNumber: string;
  category: string;
  subject: string;
  status: string;
  revision: number;
  lastMessageAt: string;
  messages: Array<{
    id: string;
    body: string;
    isStaffReply: boolean;
    createdAt: string;
    authorName: string;
  }>;
};

export function SupportTicketPanel({
  signedIn,
  initialCategory = "OTHER",
  premiumEconomyPublic = true,
  formOpen,
  onFormOpenChange,
  showToast,
}: {
  signedIn: boolean;
  initialCategory?: string;
  premiumEconomyPublic?: boolean;
  formOpen?: boolean;
  onFormOpenChange?: (open: boolean) => void;
  showToast: (message: string) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const safeInitialCategory =
    !premiumEconomyPublic && initialCategory === "PURCHASES"
      ? "OTHER"
      : initialCategory;
  const [category, setCategory] = useState(safeInitialCategory);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState("");
  const [focusedTicketId, setFocusedTicketId] = useState("");
  const loadController = useRef<AbortController | null>(null);
  const open = formOpen ?? internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (formOpen === undefined) setInternalOpen(next);
      onFormOpenChange?.(next);
    },
    [formOpen, onFormOpenChange],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setCategory(
          !premiumEconomyPublic && initialCategory === "PURCHASES"
            ? "OTHER"
            : initialCategory,
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [initialCategory, premiumEconomyPublic]);

  const load = useCallback(async (silent = false) => {
    if (!signedIn) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/v1/support-tickets", {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        data?: Ticket[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Tickets could not be loaded.");
      }
      setTickets(payload.data ?? []);
      setError("");
    } catch (loadError) {
      if (!controller.signal.aborted) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Tickets could not be loaded.",
        );
      }
    } finally {
      if (loadController.current === controller) {
        setLoading(false);
        loadController.current = null;
      }
    }
  }, [signedIn]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadController.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!signedIn) return;
    const requestedTicket = new URLSearchParams(window.location.search).get(
      "ticket",
    );
    const focusTimer = requestedTicket
      ? window.setTimeout(() => setFocusedTicketId(requestedTicket), 0)
      : null;
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const interval = window.setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, signedIn]);

  useEffect(() => {
    if (!focusedTicketId || !tickets.some((ticket) => ticket.id === focusedTicketId)) {
      return;
    }
    window.requestAnimationFrame(() => {
      document
        .getElementById(`support-ticket-${focusedTicketId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [focusedTicketId, tickets]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/v1/support-tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category:
            !premiumEconomyPublic && category === "PURCHASES"
              ? "OTHER"
              : category,
          subject,
          message,
        }),
      });
      const payload = (await response.json()) as {
        caseNumber?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "The support ticket could not be created.",
        );
      }
      setSubject("");
      setMessage("");
      setOpen(false);
      showToast(`Ticket ${payload.caseNumber ?? ""} created.`);
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The support ticket could not be created.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(event: FormEvent, ticket: Ticket) {
    event.preventDefault();
    const reply = (replyDrafts[ticket.id] ?? "").trim();
    if (reply.length < 2) return;
    setReplyingId(ticket.id);
    setError("");
    try {
      const response = await fetch("/api/v1/support-tickets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.id,
          expectedRevision: ticket.revision,
          message: reply,
        }),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Your reply could not be sent.",
        );
      }
      setReplyDrafts((current) => ({ ...current, [ticket.id]: "" }));
      showToast(`Reply sent on ${ticket.caseNumber}.`);
      await load();
    } catch (replyError) {
      setError(
        replyError instanceof Error
          ? replyError.message
          : "Your reply could not be sent.",
      );
    } finally {
      setReplyingId("");
    }
  }

  return (
    <div className="support-ticket-workspace">
      <section className="support-ticket">
        <ChatCircle size={26} />
        <h2>Still need help?</h2>
        <p>Open a ticket and keep its complete response history in one place.</p>
        {signedIn ? (
          <button
            className="button button-primary"
            type="button"
            aria-expanded={open}
            aria-controls="support-ticket-form"
            onClick={() => setOpen(!open)}
          >
            {open ? "Close Form" : "Open Ticket"}
          </button>
        ) : (
          <Link className="button button-primary" href="/login?return_to=/support">
            Sign in to open a ticket
          </Link>
        )}
      </section>
      {signedIn && open ? (
        <form
          id="support-ticket-form"
          className="support-ticket-form"
          onSubmit={submit}
        >
          <header>
            <div>
              <span>New request</span>
              <h2>How can we help?</h2>
            </div>
            <small>Replies stay private to your account.</small>
          </header>
          <label>
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="ACCOUNT">Account and security</option>
              <option value="READING">Reading and library</option>
              {premiumEconomyPublic ? (
                <option value="PURCHASES">Purchases and wallet</option>
              ) : null}
              <option value="PUBLISHING">Publishing help</option>
              <option value="OTHER">Something else</option>
            </select>
          </label>
          <label>
            Subject
            <input
              required
              minLength={6}
              maxLength={140}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Short summary of the issue"
            />
          </label>
          <label>
            Details
            <textarea
              required
              minLength={20}
              maxLength={6000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Tell us what happened and what you expected."
            />
          </label>
          <button
            className="button button-primary"
            type="submit"
            disabled={submitting}
          >
            <PaperPlaneTilt size={17} />
            {submitting ? "Creating ticket…" : "Create ticket"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="support-ticket-error" role="alert">
          {error}
        </p>
      ) : null}
      {signedIn ? (
        <section className="support-ticket-history">
          <header>
            <div>
              <span>Your requests</span>
              <h2>Ticket history</h2>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void load()}
            >
              <ArrowClockwise size={16} /> Refresh
            </button>
          </header>
          {loading ? (
            <p>Loading your tickets…</p>
          ) : tickets.length ? (
            <div>
              {tickets.map((ticket) => (
                <details
                  id={`support-ticket-${ticket.id}`}
                  key={ticket.id}
                  open={focusedTicketId === ticket.id ? true : undefined}
                  onToggle={(event) => {
                    if (!event.currentTarget.open && focusedTicketId === ticket.id) {
                      setFocusedTicketId("");
                    }
                  }}
                >
                  <summary>
                    <span>
                      <CheckCircle size={17} weight="fill" />
                      {ticket.caseNumber}
                    </span>
                    <strong>{ticket.subject}</strong>
                    <small>{ticket.status.replaceAll("_", " ")}</small>
                  </summary>
                  <div>
                    {ticket.messages.map((entry) => (
                      <article
                        className={entry.isStaffReply ? "is-staff" : ""}
                        key={entry.id}
                      >
                        <header>
                          <strong>
                            {entry.isStaffReply ? "NyaScans Support" : "You"}
                          </strong>
                          <time dateTime={entry.createdAt}>
                            {new Date(entry.createdAt).toLocaleString()}
                          </time>
                        </header>
                        <p>{entry.body}</p>
                      </article>
                    ))}
                  </div>
                  {!["RESOLVED", "CLOSED"].includes(ticket.status) ? (
                    <form
                      className="support-ticket-reply"
                      onSubmit={(event) => void submitReply(event, ticket)}
                    >
                      <label htmlFor={`support-reply-${ticket.id}`}>
                        Reply to support
                      </label>
                      <textarea
                        id={`support-reply-${ticket.id}`}
                        required
                        minLength={2}
                        maxLength={6000}
                        value={replyDrafts[ticket.id] ?? ""}
                        onChange={(event) =>
                          setReplyDrafts((current) => ({
                            ...current,
                            [ticket.id]: event.target.value,
                          }))
                        }
                        placeholder="Add more details or answer the support team…"
                      />
                      <button
                        className="button button-primary"
                        type="submit"
                        disabled={
                          replyingId === ticket.id ||
                          (replyDrafts[ticket.id] ?? "").trim().length < 2
                        }
                      >
                        <PaperPlaneTilt size={17} />
                        {replyingId === ticket.id
                          ? "Sending…"
                          : "Send reply"}
                      </button>
                    </form>
                  ) : null}
                </details>
              ))}
            </div>
          ) : (
            <p>No support tickets yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
