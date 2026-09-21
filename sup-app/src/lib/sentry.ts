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

export const wrapWithSentry = Sentry.wrap;
