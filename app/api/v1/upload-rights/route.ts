import { env } from "cloudflare:workers";
import {
  rightsMutationSchema,
  rightsQuerySchema,
} from "@/lib/series-requests";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";
import {
  grantUploadRight,
  listUploadRights,
  revokeUploadRight,
  updateUploadRight,
} from "@/lib/server/upload-rights";

export const dynamic = "force-dynamic";

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Publishing rights are temporarily unavailable.",
    );
  }
  return env.DB;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    const query = rightsQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    return json(requestId, {
      ...(await listUploadRights(database(), actor, query)),
      capabilities: {
        canManage:
          actor.primaryRole === "OWNER" ||
          actor.primaryRole === "ADMINISTRATOR",
        canGrantGlobalAdministratorRole: false,
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
    requireAdminCapability(actor, "content.teams.manage");
    const payload = rightsMutationSchema.parse(await request.json());
    switch (payload.action) {
      case "GRANT":
        return json(
          requestId,
          {
            data: await grantUploadRight(
              database(),
              actor,
              requestId,
              payload,
            ),
          },
          { status: 201 },
        );
      case "UPDATE":
        return json(requestId, {
          data: await updateUploadRight(
            database(),
            actor,
            requestId,
            payload,
          ),
        });
      case "REVOKE":
        return json(requestId, {
          data: await revokeUploadRight(
            database(),
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
