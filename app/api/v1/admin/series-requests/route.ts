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
import { requireActor, requireAdmin } from "@/lib/server/policy";

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

async function queueOptions() {
  const db = database();
  const [teams, reviewers] = await db.batch([
    db.prepare(
      `SELECT DISTINCT t.id, t.name
         FROM teams t
         JOIN series_requests r ON r.submitting_team_id = t.id
        ORDER BY t.name COLLATE NOCASE, t.id`,
    ),
    db.prepare(
      `SELECT id, display_name AS displayName
         FROM users
        WHERE status = 'ACTIVE'
          AND primary_role IN ('OWNER', 'ADMINISTRATOR')
        ORDER BY display_name COLLATE NOCASE, id`,
    ),
  ]);
  return {
    teams: teams.results,
    reviewers: reviewers.results,
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
    const actor = await requireActor();
    requireAdmin(actor);
    const db = database();
    const query = adminRequestQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (query.id) {
      return json(requestId, {
        data: await getAdminSeriesRequest(db, query.id),
        capabilities: {
          canApprove: true,
          canReject: true,
          canRequestChanges: true,
          canReassign: true,
          canAttachExisting: true,
        },
      });
    }
    return json(requestId, {
      ...(await listAdminSeriesRequests(db, query)),
      options: await queueOptions(),
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const db = database();
    const payload = adminRequestMutationSchema.parse(await request.json());
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
