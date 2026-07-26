import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export function json(
  requestId: string,
  data: unknown,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("x-request-id", requestId);
  return Response.json(data, { ...init, headers });
}

export function errorResponse(requestId: string, error: unknown) {
  if (error instanceof ZodError) {
    return json(
      requestId,
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the highlighted values and try again.",
          fields: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
          requestId,
        },
      },
      { status: 422 },
    );
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("insufficient_onyx")
  ) {
    return json(
      requestId,
      {
        error: {
          code: "INSUFFICIENT_ONYX",
          message: "Your coin balance is too low for this unlock.",
          fields: [],
          requestId,
        },
      },
      { status: 409 },
    );
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("insufficient_balance")
  ) {
    return json(
      requestId,
      {
        error: {
          code: "INSUFFICIENT_BALANCE",
          message: "Your selected currency balance is too low for this action.",
          fields: [],
          requestId,
        },
      },
      { status: 409 },
    );
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("final_active_owner_required")
  ) {
    return json(
      requestId,
      {
        error: {
          code: "FINAL_OWNER_PROTECTED",
          message:
            "Assign another active owner before changing the final owner account.",
          fields: [],
          requestId,
        },
      },
      { status: 409 },
    );
  }

  if (
    error instanceof Error &&
    /series_(creator|genre|publisher)_not_active/i.test(error.message)
  ) {
    return json(
      requestId,
      {
        error: {
          code: "SERIES_RELATION_CHANGED",
          message:
            "A selected genre, creator, or publisher was archived or merged. Reload the series before saving.",
          fields: [],
          requestId,
        },
      },
      { status: 409 },
    );
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("series_team_not_active")
  ) {
    return json(
      requestId,
      {
        error: {
          code: "SERIES_RELATION_CHANGED",
          message:
            "A selected team was archived or suspended. Reload the series before saving.",
          fields: [],
          requestId,
        },
      },
      { status: 409 },
    );
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("unique constraint failed")
  ) {
    return json(
      requestId,
      {
        error: {
          code: "DUPLICATE_RECORD",
          message:
            "A record with the same normalized identifier already exists.",
          fields: [],
          requestId,
        },
      },
      { status: 409 },
    );
  }

  if (error instanceof ApiError) {
    return json(
      requestId,
      {
        error: {
          code: error.code,
          message: error.message,
          fields: error.fields ?? [],
          requestId,
        },
      },
      { status: error.status },
    );
  }

  const candidate = error as { status?: number; code?: string; message?: string };
  if (candidate?.status && candidate?.code) {
    return json(
      requestId,
      {
        error: {
          code: candidate.code,
          message: candidate.message ?? "Request failed.",
          fields: [],
          requestId,
        },
      },
      { status: candidate.status },
    );
  }

  return json(
    requestId,
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        fields: [],
        requestId,
      },
    },
    { status: 500 },
  );
}
