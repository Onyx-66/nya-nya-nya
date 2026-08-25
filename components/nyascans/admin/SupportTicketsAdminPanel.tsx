"use client";
import { DotsRing } from "@/components/nyascans/DotsRing";
import { UnifiedSingleSelect } from "@/components/nyascans/UnifiedSingleSelect";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  ChatCircle,
  MagnifyingGlass,
  PaperPlaneTilt,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

type TicketStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_ON_USER"
  | "RESOLVED"
  | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH";

type TicketSummary = {
  id: string;
  caseNumber: string;
  category: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  revision: number;
  lastMessageAt: string;
  requesterName: string;
  requesterEmail: string;
  requesterAvatarUrl: string | null;
  messageCount: number;
};

type TicketDetail = TicketSummary & {
  requesterId: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    body: string;
    isStaffReply: boolean;
    createdAt: string;
    authorName: string;
    authorRole: string;
    authorAvatarUrl: string | null;
  }>;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  pageCount: number;
};

const statusOptions: Array<{ value: "ALL" | TicketStatus; label: string }> = [
  { value: "ALL", label: "All tickets" },
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "WAITING_ON_USER", label: "Waiting on user" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

function labelFor(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function formattedDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function SupportTicketsAdminPanel() {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    pageCount: 1,
  });
  const [status, setStatus] = useState<"ALL" | TicketStatus>("ALL");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadList = useCallback(
    async (signal?: AbortSignal, background = false) => {
      if (!background) setLoading(true);
      try {
        const params = new URLSearchParams({
          status,
          query,
          page: String(pagination.page),
          limit: String(pagination.limit),
        });
        const response = await fetch(
          `/api/v1/admin/support-tickets?${params.toString()}`,
          { cache: "no-store", signal },
        );
        const payload = (await response.json()) as {
          data?: TicketSummary[];
          pagination?: Pagination;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "The support queue could not be loaded.",
          );
        }
        setTickets(payload.data ?? []);
        if (payload.pagination) setPagination(payload.pagination);
        setError("");
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The support queue could not be loaded.",
          );
        }
      } finally {
        if (!background && !signal?.aborted) setLoading(false);
      }
    },
    [pagination.limit, pagination.page, query, status],
  );

  const loadDetail = useCallback(
    async (id: string, signal?: AbortSignal, background = false) => {
      if (!id) {
        setSelected(null);
        return;
      }
      if (!background) setDetailLoading(true);
      try {
        const response = await fetch(
          `/api/v1/admin/support-tickets?id=${encodeURIComponent(id)}`,
          { cache: "no-store", signal },
        );
        const payload = (await response.json()) as {
          data?: TicketDetail;
          error?: { message?: string };
        };
        if (!response.ok || !payload.data) {
          throw new Error(
            payload.error?.message ?? "The ticket could not be loaded.",
          );
        }
        setSelected(payload.data);
        setError("");
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The ticket could not be loaded.",
          );
        }
      } finally {
        if (!background && !signal?.aborted) setDetailLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadList(controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadDetail(selectedId, controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadDetail, selectedId]);

  useEffect(() => {
    let controller: AbortController | null = null;
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible" || busy) return;
      controller?.abort();
      controller = new AbortController();
      void loadList(controller.signal, true);
      if (selectedId) void loadDetail(selectedId, controller.signal, true);
    }, 20_000);
    return () => {
      window.clearInterval(poll);
      controller?.abort();
    };
  }, [busy, loadDetail, loadList, selectedId]);

  async function mutateTicket(
    body:
      | { action: "REPLY"; message: string }
      | { action: "SET_STATUS"; status: TicketStatus }
      | { action: "SET_PRIORITY"; priority: TicketPriority },
  ) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/admin/support-tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          ticketId: selected.id,
          expectedRevision: selected.revision,
        }),
      });
      const payload = (await response.json()) as {
        data?: TicketDetail;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        throw new Error(
          payload.error?.message ?? "The ticket could not be updated.",
        );
      }
      setSelected(payload.data);
      setReply("");
      await loadList();
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "The ticket could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPagination((current) => ({ ...current, page: 1 }));
    setQuery(queryDraft.trim());
  }

  function submitReply(event: FormEvent) {
    event.preventDefault();
    const message = reply.trim();
    if (message.length < 2) return;
    void mutateTicket({ action: "REPLY", message });
  }

  return (
    <section className="support-admin-panel">
      <header className="support-admin-heading">
        <div>
          <span>Community care</span>
          <h2>Support tickets</h2>
          <p>
            Review private requests, answer readers, and keep every status
            change in the audit log.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={loading || busy}
          onClick={() => {
            void loadList();
            if (selectedId) void loadDetail(selectedId);
          }}
        >
          <ArrowClockwise size={17} /> Refresh
        </button>
      </header>

      <form className="support-admin-filters" onSubmit={submitSearch}>
        <label>
          <span>Search</span>
          <span className="support-admin-search">
            <MagnifyingGlass size={17} />
            <input
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="Subject, reader, or email"
            />
          </span>
        </label>
        <label>
          <span>Status</span>
          <UnifiedSingleSelect
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as "ALL" | TicketStatus);
              setPagination((current) => ({ ...current, page: 1 }));
            }}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </UnifiedSingleSelect>
        </label>
        <button className="button button-primary" type="submit">
          Apply filters
        </button>
      </form>

      {error ? (
        <p className="support-admin-error" role="alert">
          <WarningCircle size={18} /> {error}
        </p>
      ) : null}

      <div className="support-admin-layout">
        <div className="support-admin-queue" aria-busy={loading}>
          <div className="support-admin-queue-meta">
            <strong>{pagination.total} tickets</strong>
            <span>
              Page {pagination.page} of {pagination.pageCount}
            </span>
          </div>
          {loading ? (
            <div className="dots-ring-loading support-admin-empty" role="status"><DotsRing size="md" label={null} /><span>Loading support queue…</span></div>
          ) : tickets.length ? (
            <div className="support-admin-ticket-list">
              {tickets.map((ticket) => (
                <button
                  className={selectedId === ticket.id ? "is-active" : ""}
                  type="button"
                  key={ticket.id}
                  onClick={() => setSelectedId(ticket.id)}
                >
                  <span className="support-admin-ticket-topline">
                    <strong>{ticket.caseNumber}</strong>
                    <small data-status={ticket.status}>
                      {labelFor(ticket.status)}
                    </small>
                  </span>
                  <span className="support-admin-ticket-subject">
                    {ticket.subject}
                  </span>
                  <span className="support-admin-ticket-person">
                    <span className="support-admin-avatar" aria-hidden="true">
                      {ticket.requesterAvatarUrl ? (
                        <img
                          src={ticket.requesterAvatarUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        ticket.requesterName.slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <span>
                      <strong>{ticket.requesterName}</strong>
                      <small>{ticket.requesterEmail}</small>
                    </span>
                  </span>
                  <span className="support-admin-ticket-foot">
                    <small>{ticket.messageCount} messages</small>
                    <time dateTime={ticket.lastMessageAt}>
                      {formattedDate(ticket.lastMessageAt)}
                    </time>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="support-admin-empty">No tickets match this view.</p>
          )}
          <div className="support-admin-pagination">
            <button
              type="button"
              aria-label="Previous ticket page"
              disabled={loading || pagination.page <= 1}
              onClick={() =>
                setPagination((current) => ({
                  ...current,
                  page: Math.max(1, current.page - 1),
                }))
              }
            >
              <CaretLeft size={17} />
            </button>
            <span>
              {pagination.page} / {pagination.pageCount}
            </span>
            <button
              type="button"
              aria-label="Next ticket page"
              disabled={loading || pagination.page >= pagination.pageCount}
              onClick={() =>
                setPagination((current) => ({
                  ...current,
                  page: Math.min(current.pageCount, current.page + 1),
                }))
              }
            >
              <CaretRight size={17} />
            </button>
          </div>
        </div>

        <article className="support-admin-detail" aria-busy={detailLoading}>
          {detailLoading ? (
            <div className="dots-ring-loading support-admin-empty" role="status"><DotsRing size="md" label={null} /><span>Loading conversation…</span></div>
          ) : selected ? (
            <>
              <header>
                <div>
                  <span className="support-admin-requester">
                    <span
                      className="support-admin-avatar is-large"
                      aria-hidden="true"
                    >
                      {selected.requesterAvatarUrl ? (
                        <img src={selected.requesterAvatarUrl} alt="" />
                      ) : (
                        selected.requesterName.slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <span>
                      <small>{selected.caseNumber}</small>
                      <strong>{selected.requesterName}</strong>
                      <a href={`mailto:${selected.requesterEmail}`}>
                        {selected.requesterEmail}
                      </a>
                    </span>
                  </span>
                  <h3>{selected.subject}</h3>
                </div>
                <span className="support-admin-category">
                  {labelFor(selected.category)}
                </span>
              </header>
              <div className="support-admin-controls">
                <label>
                  <span>Status</span>
                  <UnifiedSingleSelect
                    value={selected.status}
                    disabled={busy}
                    onChange={(event) =>
                      void mutateTicket({
                        action: "SET_STATUS",
                        status: event.target.value as TicketStatus,
                      })
                    }
                  >
                    {statusOptions.slice(1).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </UnifiedSingleSelect>
                </label>
                <label>
                  <span>Priority</span>
                  <UnifiedSingleSelect
                    value={selected.priority}
                    disabled={busy}
                    onChange={(event) =>
                      void mutateTicket({
                        action: "SET_PRIORITY",
                        priority: event.target.value as TicketPriority,
                      })
                    }
                  >
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                  </UnifiedSingleSelect>
                </label>
              </div>
              <div className="support-admin-messages">
                {selected.messages.map((message) => (
                  <article
                    className={message.isStaffReply ? "is-staff" : ""}
                    key={message.id}
                  >
                    <header>
                      <span className="support-admin-message-author">
                        <span
                          className="support-admin-avatar"
                          aria-hidden="true"
                        >
                          {message.authorAvatarUrl ? (
                            <img src={message.authorAvatarUrl} alt="" />
                          ) : (
                            message.authorName.slice(0, 1).toUpperCase()
                          )}
                        </span>
                        <strong>
                          {message.isStaffReply
                            ? `${message.authorName} · Staff`
                            : message.authorName}
                        </strong>
                      </span>
                      <time dateTime={message.createdAt}>
                        {formattedDate(message.createdAt)}
                      </time>
                    </header>
                    <p>{message.body}</p>
                  </article>
                ))}
              </div>
              {selected.status === "CLOSED" ? (
                <p className="support-admin-closed">
                  Reopen this ticket before replying.
                </p>
              ) : (
                <form className="support-admin-reply" onSubmit={submitReply}>
                  <label htmlFor="support-admin-reply">
                    Reply to reader
                  </label>
                  <textarea
                    id="support-admin-reply"
                    required
                    minLength={2}
                    maxLength={6000}
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="Write a clear, private reply…"
                  />
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={busy || reply.trim().length < 2}
                  >
                    <PaperPlaneTilt size={17} />
                    {busy ? "Sending…" : "Send reply"}
                  </button>
                </form>
              )}
            </>
          ) : (
            <div className="support-admin-empty support-admin-empty-detail">
              <ChatCircle size={30} />
              <strong>Select a support ticket</strong>
              <span>The private conversation will open here.</span>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
