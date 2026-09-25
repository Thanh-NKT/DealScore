import * as Sentry from "@sentry/nextjs";

/**
 * Report an error that is handled (so onRequestError never sees it) but still needs attention:
 * cron jobs, collector, backtest. Always logs; also sends to Sentry when it is initialized.
 * `context` must not contain personal data.
 */
export function reportError(err: unknown, context: Record<string, string | number | boolean | null> = {}): void {
  console.error("reportError", context, err);
  Sentry.captureException(err, { extra: context });
}
