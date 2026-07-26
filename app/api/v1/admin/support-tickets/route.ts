import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdminConsole } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const statusSchema = z.enum([
  "OPEN",
  "IN_PROGRESS",
  "WAITING_ON_USER",
  "RESOLVED",
  "CLOSED",
]);
const prioritySchema = z.enum(["LOW", "NORMAL", "HIGH"]);
const querySchema = z.object({
  id: z.string().trim().min(3).max(160).optional(),
  status: z
    .enum([
      "ALL",
      "OPEN",
      "IN_PROGRESS",
      "WAITING_ON_USER",
      "RESOLVED",
      "CLOSED",
    ])
    .default("ALL"),
  query: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("REPLY"),
    ticketId: z.string().trim().min(3).max(160),
    expectedRevision: z.number().int().min(1),
    message: z.string().trim().min(2).max(6_000),
  }),
  z.object({
    action: z.literal("SET_STATUS"),
    ticketId: z.string().trim().min(3).max(160),
    expectedRevision: z.number().int().min(1),
    status: statusSchema,
  }),
  z.object({
    action: z.literal("SET_PRIORITY"),
    ticketId: z.string().trim().min(3).max(160),
    expectedRevision: z.number().int().min(1),
    priority: prioritySchema,
  }),
]);

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "The support queue is temporarily unavailable.",
    );
  }
  return env.DB;
}

async function requireAdministrator() {
  const actor = await requireActor("admin.support.manage");
  requireAdminConsole(actor);
  return actor;
}

async function ticketDetail(id: string) {
  const db = database();
  const ticket = await db
    .prepare(
      `SELECT st.id, st.category, st.subject, st.status, st.priority,
              st.revision, st.last_message_at AS lastMessageAt,
              st.closed_at AS closedAt, st.created_at AS createdAt,
              st.updated_at AS updatedAt,
              u.id AS requesterId, u.display_name AS requesterName,
              u.email AS requesterEmail,
              up.username AS requesterAvatarUsername,
              up.revision AS requesterAvatarRevision,
              CASE WHEN up.avatar_key IS NULL THEN 0 ELSE 1 END
                AS hasRequesterAvatar
         FROM support_tickets st
         JOIN users u ON u.id = st.requester_user_id
         LEFT JOIN user_profiles up ON up.user_id = u.id
        WHERE st.id = ?
        LIMIT 1`,
    )
    .bind(id)
    .first<Record<string, unknown> & { id: string }>();
  if (!ticket) {
    throw new ApiError(
      404,
      "SUPPORT_TICKET_NOT_FOUND",
      "This support ticket was not found.",
    );
  }
  const messages = await db
    .prepare(
      `SELECT stm.id, stm.body,
              stm.is_staff_reply AS isStaffReply,
              stm.created_at AS createdAt,
              u.display_name AS authorName,
              u.primary_role AS authorRole,
              up.username AS authorAvatarUsername,
              up.revision AS authorAvatarRevision,
              CASE WHEN up.avatar_key IS NULL THEN 0 ELSE 1 END
                AS hasAuthorAvatar
         FROM support_ticket_messages stm
         JOIN users u ON u.id = stm.author_user_id
         LEFT JOIN user_profiles up ON up.user_id = u.id
        WHERE stm.ticket_id = ?
        ORDER BY datetime(stm.created_at), stm.id`,
    )
    .bind(id)
    .all<{
      id: string;
      body: string;
      isStaffReply: number;
      createdAt: string;
      authorName: string;
      authorRole: string;
      authorAvatarUsername: string | null;
      authorAvatarRevision: number | null;
      hasAuthorAvatar: number;
    }>();
  const ticketRecord = ticket as typeof ticket & {
    requesterAvatarUsername?: string | null;
    requesterAvatarRevision?: number | null;
    hasRequesterAvatar?: number;
  };
  return {
    ...ticketRecord,
    caseNumber: `NYA-${id.slice(-8).toUpperCase()}`,
    requesterAvatarUrl:
      ticketRecord.hasRequesterAvatar && ticketRecord.requesterAvatarUsername
        ? `/api/v1/profile-media?username=${encodeURIComponent(ticketRecord.requesterAvatarUsername)}&slot=avatar&v=${Number(ticketRecord.requesterAvatarRevision ?? 1)}&admin=1`
        : null,
    messages: messages.results.map((message) => ({
      ...message,
      isStaffReply: Boolean(message.isStaffReply),
      authorAvatarUrl:
        message.hasAuthorAvatar && message.authorAvatarUsername
          ? `/api/v1/profile-media?username=${encodeURIComponent(message.authorAvatarUsername)}&slot=avatar&v=${Number(message.authorAvatarRevision ?? 1)}&admin=1`
          : null,
    })),
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    await requireAdministrator();
    const url = new URL(request.url);
    const filters = querySchema.parse({
      id: url.searchParams.get("id") || undefined,
      status: url.searchParams.get("status") || "ALL",
      query: url.searchParams.get("query") || "",
      page: url.searchParams.get("page") || 1,
      limit: url.searchParams.get("limit") || 20,
    });
    if (filters.id) {
      return json(
        requestId,
        { data: await ticketDetail(filters.id) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const db = database();
    const term = `%${filters.query.toLowerCase()}%`;
    const statusClause =
      filters.status === "ALL" ? "" : "AND st.status = ?";
    const bindings =
      filters.status === "ALL"
        ? [term, term, term]
        : [term, term, term, filters.status];
    const [tickets, count] = await Promise.all([
      db
        .prepare(
          `SELECT st.id, st.category, st.subject, st.status, st.priority,
                  st.revision, st.last_message_at AS lastMessageAt,
                  st.created_at AS createdAt, st.updated_at AS updatedAt,
                  u.display_name AS requesterName, u.email AS requesterEmail,
                  up.username AS requesterAvatarUsername,
                  up.revision AS requesterAvatarRevision,
                  CASE WHEN up.avatar_key IS NULL THEN 0 ELSE 1 END
                    AS hasRequesterAvatar,
                  (
                    SELECT COUNT(*) FROM support_ticket_messages stm
                     WHERE stm.ticket_id = st.id
                  ) AS messageCount
             FROM support_tickets st
             JOIN users u ON u.id = st.requester_user_id
             LEFT JOIN user_profiles up ON up.user_id = u.id
            WHERE (
              ? = '%%'
              OR LOWER(st.subject) LIKE ?
              OR LOWER(u.display_name || ' ' || u.email) LIKE ?
            )
            ${statusClause}
            ORDER BY
              CASE st.priority WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END,
              datetime(st.last_message_at) DESC
            LIMIT ? OFFSET ?`,
        )
        .bind(
          ...bindings,
          filters.limit,
          (filters.page - 1) * filters.limit,
        )
        .all<Record<string, unknown> & { id: string }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS count
             FROM support_tickets st
             JOIN users u ON u.id = st.requester_user_id
            WHERE (
              ? = '%%'
              OR LOWER(st.subject) LIKE ?
              OR LOWER(u.display_name || ' ' || u.email) LIKE ?
            )
            ${statusClause}`,
        )
        .bind(...bindings)
        .first<{ count: number }>(),
    ]);
    const total = Number(count?.count ?? 0);
    return json(
      requestId,
      {
        data: tickets.results.map((ticket) => ({
          ...ticket,
          caseNumber: `NYA-${ticket.id.slice(-8).toUpperCase()}`,
          requesterAvatarUrl:
            Number(ticket.hasRequesterAvatar ?? 0) &&
            ticket.requesterAvatarUsername
              ? `/api/v1/profile-media?username=${encodeURIComponent(String(ticket.requesterAvatarUsername))}&slot=avatar&v=${Number(ticket.requesterAvatarRevision ?? 1)}&admin=1`
              : null,
        })),
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          pageCount: Math.max(1, Math.ceil(total / filters.limit)),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireAdministrator();
    const payload = actionSchema.parse(await request.json());
    const db = database();
    const current = await db
      .prepare(
        `SELECT st.id, st.subject, st.status, st.priority, st.revision,
                st.requester_user_id AS requesterUserId
           FROM support_tickets st
          WHERE st.id = ?
          LIMIT 1`,
      )
      .bind(payload.ticketId)
      .first<{
        id: string;
        subject: string;
        status: string;
        priority: string;
        revision: number;
        requesterUserId: string;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "SUPPORT_TICKET_NOT_FOUND",
        "This support ticket was not found.",
      );
    }
    if (Number(current.revision) !== payload.expectedRevision) {
      throw new ApiError(
        409,
        "SUPPORT_TICKET_CHANGED",
        "Another administrator changed this ticket. Refresh it and try again.",
      );
    }
    if (payload.action === "REPLY") {
      if (current.status === "CLOSED") {
        throw new ApiError(
          409,
          "SUPPORT_TICKET_CLOSED",
          "Reopen this ticket before sending a reply.",
        );
      }
      const messageId = randomId();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO support_ticket_messages
             (id, ticket_id, author_user_id, body, is_staff_reply)
             SELECT ?, id, ?, ?, 1
               FROM support_tickets
              WHERE id = ? AND revision = ? AND status <> 'CLOSED'`,
          )
          .bind(
            messageId,
            actor.id,
            payload.message,
            payload.ticketId,
            payload.expectedRevision,
          ),
        db
          .prepare(
            `UPDATE support_tickets
                SET status = 'WAITING_ON_USER',
                    last_message_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP,
                    revision = revision + 1
              WHERE id = ? AND revision = ? AND status <> 'CLOSED'`,
          )
          .bind(payload.ticketId, payload.expectedRevision),
        auditStatement(
          db,
          actor,
          requestId,
          {
            action: "support.reply",
            category: "SYSTEM_MAINTENANCE",
            sourceArea: "SUPPORT_QUEUE",
            targetType: "SUPPORT_TICKET",
            targetId: payload.ticketId,
            targetLabel: current.subject,
          },
          "changes() = 1",
        ),
        db
          .prepare(
            `INSERT INTO notifications
             (id, user_id, kind, title, body, dedupe_key, action_url,
              metadata_json)
             SELECT ?, requester_user_id, 'SUPPORT_REPLY',
                    'Support replied to your ticket', ?,
                    ?, ?, ?
               FROM support_tickets
              WHERE id = ? AND revision = ?`,
          )
          .bind(
            randomId(),
            current.subject,
            `support-reply:${messageId}`,
            `/support?ticket=${encodeURIComponent(payload.ticketId)}`,
            JSON.stringify({ ticketId: payload.ticketId }),
            payload.ticketId,
            payload.expectedRevision + 1,
          ),
      ]);
      if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
        throw new ApiError(
          409,
          "SUPPORT_TICKET_CHANGED",
          "This ticket changed while the reply was being sent.",
        );
      }
    } else {
      const column =
        payload.action === "SET_STATUS" ? "status" : "priority";
      const value =
        payload.action === "SET_STATUS" ? payload.status : payload.priority;
      const closedAt =
        payload.action === "SET_STATUS"
          ? `closed_at = CASE WHEN ? IN ('RESOLVED', 'CLOSED')
               THEN CURRENT_TIMESTAMP ELSE NULL END,`
          : "";
      const mutation = db
        .prepare(
          `UPDATE support_tickets
              SET ${column} = ?,
                  ${closedAt}
                  updated_at = CURRENT_TIMESTAMP,
                  revision = revision + 1
            WHERE id = ? AND revision = ?`,
        )
        .bind(
          value,
          ...(payload.action === "SET_STATUS" ? [payload.status] : []),
          payload.ticketId,
          payload.expectedRevision,
        );
      const results = await db.batch([
        mutation,
        auditStatement(
          db,
          actor,
          requestId,
          {
            action:
              payload.action === "SET_STATUS"
                ? "support.status.update"
                : "support.priority.update",
            category: "SYSTEM_MAINTENANCE",
            sourceArea: "SUPPORT_QUEUE",
            targetType: "SUPPORT_TICKET",
            targetId: payload.ticketId,
            targetLabel: current.subject,
            oldValue: {
              status: current.status,
              priority: current.priority,
            },
            newValue: {
              status:
                payload.action === "SET_STATUS"
                  ? payload.status
                  : current.status,
              priority:
                payload.action === "SET_PRIORITY"
                  ? payload.priority
                  : current.priority,
            },
          },
          "changes() = 1",
        ),
      ]);
      if (!results[0]?.meta.changes) {
        throw new ApiError(
          409,
          "SUPPORT_TICKET_CHANGED",
          "Another administrator changed this ticket. Refresh it and try again.",
        );
      }
    }
    return json(requestId, {
      data: await ticketDetail(payload.ticketId),
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
