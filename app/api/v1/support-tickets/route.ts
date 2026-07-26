import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const createTicketSchema = z.object({
  category: z.enum([
    "ACCOUNT",
    "READING",
    "PURCHASES",
    "PUBLISHING",
    "OTHER",
  ]),
  subject: z.string().trim().min(6).max(140),
  message: z.string().trim().min(20).max(6_000),
});

const replySchema = z.object({
  ticketId: z.string().trim().min(3).max(160),
  expectedRevision: z.coerce.number().int().min(1),
  message: z.string().trim().min(2).max(6_000),
});

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Support tickets are temporarily unavailable.",
    );
  }
  return env.DB;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    const db = database();
    const [tickets, messages] = await Promise.all([
      db
        .prepare(
          `SELECT id, category, subject, status, priority, revision,
                  last_message_at AS lastMessageAt,
                  created_at AS createdAt, updated_at AS updatedAt
             FROM support_tickets
            WHERE requester_user_id = ?
            ORDER BY datetime(last_message_at) DESC
            LIMIT 30`,
        )
        .bind(actor.id)
        .all<{
          id: string;
          category: string;
          subject: string;
          status: string;
          priority: string;
          lastMessageAt: string;
          createdAt: string;
          updatedAt: string;
        }>(),
      db
        .prepare(
          `SELECT stm.id, stm.ticket_id AS ticketId, stm.body,
                  stm.is_staff_reply AS isStaffReply,
                  stm.created_at AS createdAt,
                  u.display_name AS authorName
             FROM support_ticket_messages stm
             JOIN support_tickets st ON st.id = stm.ticket_id
             JOIN users u ON u.id = stm.author_user_id
            WHERE st.requester_user_id = ?
            ORDER BY datetime(stm.created_at)`,
        )
        .bind(actor.id)
        .all<{
          id: string;
          ticketId: string;
          body: string;
          isStaffReply: number;
          createdAt: string;
          authorName: string;
        }>(),
    ]);
    const messagesByTicket = new Map<string, typeof messages.results>();
    for (const message of messages.results) {
      messagesByTicket.set(message.ticketId, [
        ...(messagesByTicket.get(message.ticketId) ?? []),
        message,
      ]);
    }
    return json(
      requestId,
      {
        data: tickets.results.map((ticket) => ({
          ...ticket,
          caseNumber: `NYA-${ticket.id.slice(-8).toUpperCase()}`,
          messages: (messagesByTicket.get(ticket.id) ?? []).map((message) => ({
            ...message,
            isStaffReply: Boolean(message.isStaffReply),
          })),
        })),
      },
      {
        headers: {
          "cache-control": "private, no-store",
          vary: "cookie",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = createTicketSchema.parse(await request.json());
    const db = database();
    const recent = await db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM support_tickets
          WHERE requester_user_id = ?
            AND created_at > datetime('now', '-1 hour')`,
      )
      .bind(actor.id)
      .first<{ count: number }>();
    if (Number(recent?.count ?? 0) >= 5) {
      throw new ApiError(
        429,
        "SUPPORT_RATE_LIMITED",
        "You have opened several tickets recently. Please wait before creating another.",
      );
    }
    const ticketId = randomId();
    const messageId = randomId();
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO support_tickets
           (id, requester_user_id, category, subject, status, priority)
           VALUES (?, ?, ?, ?, 'OPEN', 'NORMAL')`,
        )
        .bind(ticketId, actor.id, payload.category, payload.subject),
      db
        .prepare(
          `INSERT INTO support_ticket_messages
           (id, ticket_id, author_user_id, body, is_staff_reply)
           SELECT ?, ?, ?, ?, 0
            WHERE EXISTS (SELECT 1 FROM support_tickets WHERE id = ?)`,
        )
        .bind(messageId, ticketId, actor.id, payload.message, ticketId),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
      throw new ApiError(
        409,
        "SUPPORT_TICKET_FAILED",
        "The support ticket could not be created. Please try again.",
      );
    }
    return json(
      requestId,
      {
        id: ticketId,
        caseNumber: `NYA-${ticketId.slice(-8).toUpperCase()}`,
        status: "OPEN",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = replySchema.parse(await request.json());
    const db = database();
    const current = await db
      .prepare(
        `SELECT id, status, revision
           FROM support_tickets
          WHERE id = ? AND requester_user_id = ?
          LIMIT 1`,
      )
      .bind(payload.ticketId, actor.id)
      .first<{ id: string; status: string; revision: number }>();
    if (!current) {
      throw new ApiError(
        404,
        "SUPPORT_TICKET_NOT_FOUND",
        "This support ticket was not found.",
      );
    }
    if (["RESOLVED", "CLOSED"].includes(current.status)) {
      throw new ApiError(
        409,
        "SUPPORT_TICKET_CLOSED",
        "This ticket is closed. Open a new ticket if you still need help.",
      );
    }
    const recent = await db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM support_ticket_messages
          WHERE author_user_id = ?
            AND created_at > datetime('now', '-8 seconds')`,
      )
      .bind(actor.id)
      .first<{ count: number }>();
    if (Number(recent?.count ?? 0) > 0) {
      throw new ApiError(
        429,
        "SUPPORT_REPLY_RATE_LIMITED",
        "Please wait a few seconds before sending another reply.",
      );
    }
    const messageId = randomId();
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO support_ticket_messages
           (id, ticket_id, author_user_id, body, is_staff_reply)
           SELECT ?, id, ?, ?, 0
             FROM support_tickets
            WHERE id = ?
              AND requester_user_id = ?
              AND revision = ?
              AND status NOT IN ('RESOLVED', 'CLOSED')`,
        )
        .bind(
          messageId,
          actor.id,
          payload.message,
          payload.ticketId,
          actor.id,
          payload.expectedRevision,
        ),
      db
        .prepare(
          `UPDATE support_tickets
              SET status = 'IN_PROGRESS',
                  last_message_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP,
                  revision = revision + 1
            WHERE id = ?
              AND requester_user_id = ?
              AND revision = ?
              AND status NOT IN ('RESOLVED', 'CLOSED')`,
        )
        .bind(
          payload.ticketId,
          actor.id,
          payload.expectedRevision,
        ),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
      throw new ApiError(
        409,
        "SUPPORT_TICKET_CHANGED",
        "This ticket changed while you were replying. Refresh it and try again.",
      );
    }
    return json(requestId, {
      id: payload.ticketId,
      status: "IN_PROGRESS",
      revision: payload.expectedRevision + 1,
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
