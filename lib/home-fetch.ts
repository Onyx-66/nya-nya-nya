export const HOME_REQUEST_TIMEOUT_MS = 9_000;

export class HomeRequestTimeoutError extends Error {
  readonly code = "HOME_REQUEST_TIMEOUT";

  constructor() {
    super("This section took too long to respond. Try again.");
    this.name = "HomeRequestTimeoutError";
  }
}

export async function fetchWithHomeTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = HOME_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;
  const relayAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", relayAbort, { once: true });
  }

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new HomeRequestTimeoutError();
    throw error;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", relayAbort);
  }
}

export function homeRequestMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof HomeRequestTimeoutError
    ? error.message
    : error instanceof Error
      ? error.message
      : fallback;
}
