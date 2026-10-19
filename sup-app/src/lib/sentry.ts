import * as Sentry from "@sentry/react-native";

// DSN is public by design (write-only ingest key), so EXPO_PUBLIC_* is safe here.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

/** Call once at module load in app/_layout.tsx, before any component renders. */
export function initSentry() {
  if (!DSN) return; // no DSN (e.g. local dev) → Sentry stays disabled
  Sentry.init({
    dsn: DSN,
    enabled: !__DEV__, // avoid noise from Metro/dev-client errors
    enableNativeCrashHandling: true,
    enableAutoSessionTracking: true,
    sendDefaultPii: false, // no IPs/emails; we only attach the Supabase user id
    tracesSampleRate: 0,
  });
}

/** Attach only the opaque Supabase user id to crash reports (no email/name). */
export function setSentryUser(userId: string | null) {
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Lightweight trail shown on the crash report (e.g. session start/end). */
export function sentryBreadcrumb(message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({ category: "app", message, data, level: "info" });
}

/** Tags every later event with the current route, and leaves a navigation trail. */
export function setSentryScreen(pathname: string) {
  Sentry.setTag("screen", pathname);
  Sentry.addBreadcrumb({ category: "navigation", message: pathname, level: "info" });
}

type PlainError = { message?: unknown; code?: unknown; details?: unknown; hint?: unknown; name?: unknown };

// Supabase/PostgREST errors are plain objects, which Sentry reports as
// "Object captured as exception" with no message or stack. Wrap them in a real
// Error and keep their code/details/hint as extras.
function normalizeError(error: unknown): { err: unknown; extra: Record<string, unknown> } {
  if (error instanceof Error || error === null || typeof error !== "object") {
    return { err: error, extra: {} };
  }
  const e = error as PlainError;
  if (typeof e.message !== "string") return { err: error, extra: {} };
  const err = new Error(e.message);
  if (typeof e.name === "string") err.name = e.name;
  return { err, extra: { code: e.code, details: e.details, hint: e.hint } };
}

function isNetworkError(error: unknown) {
  const msg = (error as PlainError | null)?.message;
  return typeof msg === "string" && /network request failed|failed to fetch|timed? ?out/i.test(msg);
}

/**
 * Report a handled (caught) error — Sentry only sees uncaught ones on its own.
 * Offline/network failures are sent as warnings so they don't drown real bugs.
 */
export function captureError(error: unknown, context: string, extra?: Record<string, unknown>) {
  const { err, extra: errExtra } = normalizeError(error);
  const network = isNetworkError(error);
  Sentry.captureException(err, {
    level: network ? "warning" : "error",
    tags: { context, network: String(network) },
    extra: { ...errExtra, ...extra },
  });
}

/** Report a render crash caught by a screen's error boundary (app keeps running). */
export function captureRenderError(error: Error) {
  Sentry.captureException(error, { level: "fatal", tags: { context: "render", boundary: "screen" } });
}

/**
 * Report a failed Edge Function call. Never throws. Pass `http` when the
 * caller used fetch() directly; for supabase.functions.invoke() errors the
 * status/body are read off error.context (the Response), since the error's
 * own message is always the generic "non-2xx status code".
 */
export async function captureFunctionError(
  fn: string,
  error: unknown,
  http?: { status: number; body: string }
) {
  let status = http?.status;
  let body = http?.body;
  try {
    const res = (error as { context?: Response } | null)?.context;
    if (!http && res && typeof res.text === "function") {
      status = res.status;
      body = await res.clone().text();
    }
  } catch {
    // body unreadable — still report the error itself
  }
  Sentry.captureException(error, {
    tags: { edge_function: fn },
    extra: { status, body: body?.slice(0, 500) },
    // Otherwise every function's failures group into one issue (same message).
    fingerprint: ["edge-function", fn, String(status ?? "no-response")],
  });
}

export const wrapWithSentry = Sentry.wrap;
