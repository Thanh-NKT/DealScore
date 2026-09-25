import * as Sentry from "@sentry/nextjs";

/**
 * Error tracking (1.10). Sentry is only initialized when SENTRY_DSN is set — local dev and
 * preview deployments without it report nothing. Default data collection (no PII); never add emails or IPs.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

/** Errors thrown by Server Components, Route Handlers and Server Actions. No-op without a DSN. */
export const onRequestError = Sentry.captureRequestError;
