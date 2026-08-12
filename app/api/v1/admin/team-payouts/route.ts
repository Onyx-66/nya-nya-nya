import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  approveTeamPayout,
  listTeamPayouts,
  payTeamPayout,
  rejectTeamPayout,
  requestTeamPayout,
  setTeamPayoutAccount,
  TEAM_PAYOUT_STATUSES,
} from "@/lib/server/payments/team-payouts";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(160).default(""),
  status: z.enum(["ALL", ...TEAM_PAYOUT_STATUSES]).default("ALL"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(10).max(100).default(25),
});

const reason = z.string().trim().min(10).max(1_000);
const reviewAction = z.object({
  requestId: z.string().trim().min(8).max(160),
  expectedRevision: z.number().int().min(1),
  reason,
});

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SET_ACCOUNT"),
    teamId: z.string().trim().min(3).max(160),
    providerAccountId: z.string().trim().regex(/^acct_[A-Za-z0-9]{8,80}$/u),
    expectedRevision: z.number().int().min(0),
    reason,
  }),
  z.object({
    action: z.literal("REQUEST"),
    teamId: z.string().trim().min(3).max(160),
    amountOnyx: z.number().int().min(1).max(1_000_000_000),
    clientMutationId: z.string().uuid(),
    reason,
  }),
  reviewAction.extend({ action: z.literal("APPROVE") }),
  reviewAction.extend({ action: z.literal("REJECT") }),
  reviewAction.extend({ action: z.literal("PAY") }),
]);

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Team payouts are temporarily unavailable.",
    );
  }
  return env.DB;
}

function queryFrom(request: Request) {
  const url = new URL(request.url);
  return querySchema.parse({
    q: url.searchParams.get("q") ?? "",
    status: url.searchParams.get("status") ?? "ALL",
    page: url.searchParams.get("page") ?? 1,
    limit: url.searchParams.get("limit") ?? 25,
  });
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "finance.transactions.read");
    return json(requestId, await listTeamPayouts(database(), queryFrom(request)), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "finance.balances.manage");
    const payload = mutationSchema.parse(await request.json());
    const db = database();
    const mutation =
      payload.action === "SET_ACCOUNT"
        ? await setTeamPayoutAccount(db, actor, requestId, payload)
        : payload.action === "REQUEST"
          ? await requestTeamPayout(db, actor, requestId, payload)
          : payload.action === "APPROVE"
            ? await approveTeamPayout(db, actor, requestId, payload)
            : payload.action === "REJECT"
              ? await rejectTeamPayout(db, actor, requestId, payload)
              : await payTeamPayout(db, actor, requestId, payload);
    return json(
      requestId,
      {
        ...(await listTeamPayouts(db, { q: "", status: "ALL", page: 1, limit: 25 })),
        mutation: mutation ?? null,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
