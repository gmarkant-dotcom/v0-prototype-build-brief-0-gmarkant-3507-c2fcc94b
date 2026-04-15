import "server-only";
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
});

if (process.env.SENTRY_SERVER_SMOKE_TEST === "1") {
  Sentry.captureException(new Error("Sentry server-side smoke test"));
}
