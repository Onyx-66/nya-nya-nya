import { env } from "cloudflare:workers";
import {
  adminRequestMutationSchema,
  adminRequestQuerySchema,
} from "@/lib/series-requests";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  addSeriesRequestFeedback,
  approveSeriesRequest,
  assignSeriesRequestReviewer,
  attachSeriesRequestToExisting,
  getAdminSeriesRequest,
  listAdminSeriesRequests,
  rejectSeriesRequest,
  requestSeriesChanges,
  startSeriesRequestReview,
} from "@/lib/server/series-request-admin";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import {
  requireActor,
  requireAdminConsole,
  type Actor,
} from "@/lib/server/policy";

export const dynamic = "force-dynamic";

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "The new-series review queue is temporarily unavailable.",
    );
  }
  return env.DB;
}

function queueCapabilities(actor: Actor) {
  const roles = new Set([actor.primaryRole, ...(actor.roles ?? [])]);
  const fullAdministrator =
    roles.has("OWNER") || roles.has("ADMINISTRATOR");
  const reviewer = fullAdministrator || roles.has("MANAGER");
  return {
    canApprove: reviewer,
    canReject: reviewer,
    canReply: reviewer,
    canStartReview: fullAdministrator,
    canRequestChanges: fullAdministrator,
    canReassign: fullAdministrator,
    canAttachExisting: fullAdministrator,
  };
}

function assertQueueAction(
  actor: Actor,
  action:
    | "START_REVIEW"
    | "ASSIGN_REVIEWER"
    | "ADD_FEEDBACK"
    | "REQUEST_CHANGES"
    | "REJECT"
    | "APPROVE"
    | "ATTACH_EXISTING",
) {
  const capabilities = queueCapabilities(actor);
  const allowed =
    (action === "APPROVE" && capabilities.canApprove) ||
    (action === "REJECT" && capabilities.canReject) ||
    (action === "ADD_FEEDBACK" && capabilities.canReply) ||
    (action === "START_REVIEW" && capabilities.canStartReview) ||
    (action === "REQUEST_CHANGES" && capabilities.canRequestChanges) ||
    (action === "ASSIGN_REVIEWER" && capabilities.canReassign) ||
    (action === "ATTACH_EXISTING" && capabilities.canAttachExisting);
  if (!allowed) {
    throw new ApiError(
      403,
      "SERIES_REQUEST_ACTION_FORBIDDEN",
      "Your staff role cannot perform this series-request action.",
    );
  }
}

async function queueOptions(canReassign: boolean) {
  const db = database();
  const teams = await db
    .prepare(
      `SELECT DISTINCT t.id, t.name
         FROM teams t
         JOIN series_requests r ON r.submitting_team_id = t.id
        ORDER BY t.name COLLATE NOCASE, t.id`,
    )
    .all();
  const reviewers = canReassign
    ? await db
        .prepare(
          `SELECT id, display_name AS displayName
             FROM users
            WHERE status = 'ACTIVE'
              AND (
                primary_role IN ('OWNER', 'ADMINISTRATOR', 'MANAGER')
                OR EXISTS (
                  SELECT 1 FROM user_roles ur
                   WHERE ur.user_id = users.id
                     AND ur.role IN ('OWNER', 'ADMINISTRATOR', 'MANAGER')
                )
              )
            ORDER BY display_name COLLATE NOCASE, id`,
        )
        .all()
    : null;
  return {
    teams: teams.results,
    reviewers: reviewers?.results ?? [],
    statuses: [
      "DRAFT",
      "SUBMITTED",
      "UNDER_REVIEW",
      "CHANGES_REQUESTED",
      "APPROVED",
      "REJECTED",
      "WITHDRAWN",
    ],
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor("admin.series-requests.review");
    requireAdminConsole(actor);
    const capabilities = queueCapabilities(actor);
    const db = database();
    const query = adminRequestQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (query.id) {
      return json(requestId, {
        data: await getAdminSeriesRequest(db, query.id),
        capabilities,
      });
    }
    return json(requestId, {
      ...(await listAdminSeriesRequests(db, query)),
      options: await queueOptions(capabilities.canReassign),
      capabilities,
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("admin.series-requests.review");
    requireAdminConsole(actor);
    const db = database();
    const payload = adminRequestMutationSchema.parse(await request.json());
    assertQueueAction(actor, payload.action);
    switch (payload.action) {
      case "START_REVIEW":
        return json(requestId, {
          data: await startSeriesRequestReview(
            db,
            actor,
            requestId,
            payload,
          ),
        });
      case "ASSIGN_REVIEWER":
        return json(requestId, {
          data: await assignSeriesRequestReviewer(
            db,
            actor,
            requestId,
            payload,
          ),
        });
      case "ADD_FEEDBACK":
        return json(requestId, {
          data: await addSeriesRequestFeedback(
            db,
            actor,
            requestId,
            payload,
          ),
        });
      case "REQUEST_CHANGES":
        return json(requestId, {
          data: await requestSeriesChanges(
            db,
            actor,
            requestId,
            payload,
          ),
        });
      case "REJECT":
        return json(requestId, {
          data: await rejectSeriesRequest(
            db,
            actor,
            requestId,
            payload,
          ),
        });
      case "APPROVE":
        return json(requestId, {
          data: await approveSeriesRequest(
            db,
            actor,
            requestId,
            payload,
          ),
        });
      case "ATTACH_EXISTING":
        return json(requestId, {
          data: await attachSeriesRequestToExisting(
            db,
            actor,
            requestId,
            payload,
          ),
        });
    }
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
