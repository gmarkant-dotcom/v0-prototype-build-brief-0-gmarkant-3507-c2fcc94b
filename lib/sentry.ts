import * as Sentry from "@sentry/nextjs";

export function initSentry() {
  if (typeof window === "undefined") return;
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 1.0,
    debug: true,
  });
}
