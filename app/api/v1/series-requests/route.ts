import { env } from "cloudflare:workers";
import {
  teamRequestMutationSchema,
  teamRequestQuerySchema,
} from "@/lib/series-requests";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import {
  assertAllRequestedTeams,
  findRequestDuplicates,
} from "@/lib/server/series-request-common";
import {
  cloneSeriesRequestToDraft,
  createSeriesRequestDraft,
  deleteSeriesRequestDraft,
  getTeamSeriesRequest,
  listTeamSeriesRequests,
  updateSeriesRequest,
  withdrawSeriesRequest,
} from "@/lib/server/series-request-team";
import { requireActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Series requests are temporarily unavailable.",
    );
  }
  return env.DB;
}

async function eligibleTeams(actor: Awaited<ReturnType<typeof requireActor>>) {
  const db = database();
  const isAdmin =
    actor.primaryRole === "OWNER" || actor.primaryRole === "ADMINISTRATOR";
  const result = await db
    .prepare(
      `SELECT DISTINCT t.id,
              t.name,
              t.slug,
              CASE
                WHEN ? = 1 THEN 'ADMINISTRATOR'
                ELSE tm.membership_role
              END AS membershipRole
         FROM teams t
         LEFT JOIN team_memberships tm
           ON tm.team_id = t.id
          AND tm.user_id = ?
          AND tm.status = 'ACTIVE'
        WHERE t.is_archived = 0
          AND t.verification_status <> 'SUSPENDED'
          AND (
            ? = 1
            OR (
              tm.user_id IS NOT NULL
              AND (
                upper(tm.membership_role) IN (
                  'OWNER',
                  'LEADER',
                  'TEAM_LEADER',
                  'MANAGER'
                )
                OR tm.can_request_series = 1
              )
            )
          )
        ORDER BY t.name COLLATE NOCASE, t.id`,
    )
    .bind(isAdmin ? 1 : 0, actor.id, isAdmin ? 1 : 0)
    .all();
  return result.results;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    const db = database();
    const url = new URL(request.url);
    const query = teamRequestQuerySchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    );
    if (query.id) {
      return json(requestId, {
        data: await getTeamSeriesRequest(db, actor, query.id),
        capabilities: {
          canEditStatuses: ["DRAFT", "CHANGES_REQUESTED"],
          canWithdrawStatuses: [
            "SUBMITTED",
            "UNDER_REVIEW",
            "CHANGES_REQUESTED",
          ],
          canCloneStatuses: ["REJECTED", "WITHDRAWN"],
        },
      });
    }
    return json(requestId, {
      ...(await listTeamSeriesRequests(db, actor, query)),
      capabilities: {
        teams: await eligibleTeams(actor),
        metadataImport: {
          mangaDex: true,
          mangaUpdates: false,
          previewRequired: true,
          perFieldAcceptance: true,
        },
      },
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
    const db = database();
    const payload = teamRequestMutationSchema.parse(await request.json());
    switch (payload.action) {
      case "CHECK_DUPLICATES": {
        await assertAllRequestedTeams(
          db,
          actor,
          payload.teamId,
          payload.data.requestingTeamIds,
        );
        return json(
          requestId,
          await findRequestDuplicates(
            db,
            payload.data,
            payload.requestId,
          ),
        );
      }
      case "CREATE_DRAFT":
        return json(
          requestId,
          {
            data: await createSeriesRequestDraft(
              db,
              actor,
              requestId,
              payload.teamId,
              payload.data,
            ),
          },
          { status: 201 },
        );
      case "SAVE_DRAFT":
        return json(requestId, {
          data: await updateSeriesRequest(db, actor, requestId, {
            requestId: payload.requestId,
            expectedRevision: payload.expectedRevision,
            mode: "SAVE",
            metadata: payload.data,
          }),
        });
      case "SUBMIT":
        return json(requestId, {
          data: await updateSeriesRequest(db, actor, requestId, {
            requestId: payload.requestId,
            expectedRevision: payload.expectedRevision,
            mode: "SUBMIT",
            metadata: payload.data,
          }),
        });
      case "RESUBMIT":
        return json(requestId, {
          data: await updateSeriesRequest(db, actor, requestId, {
            requestId: payload.requestId,
            expectedRevision: payload.expectedRevision,
            mode: "RESUBMIT",
            metadata: payload.data,
          }),
        });
      case "WITHDRAW":
        return json(requestId, {
          data: await withdrawSeriesRequest(
            db,
            actor,
            requestId,
            payload,
          ),
        });
      case "DELETE_DRAFT":
        return json(requestId, {
          data: await deleteSeriesRequestDraft(
            db,
            actor,
            requestId,
            payload,
          ),
        });
      case "CLONE_TO_DRAFT":
        return json(
          requestId,
          {
            data: await cloneSeriesRequestToDraft(
              db,
              actor,
              requestId,
              payload,
            ),
          },
          { status: 201 },
        );
    }
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
