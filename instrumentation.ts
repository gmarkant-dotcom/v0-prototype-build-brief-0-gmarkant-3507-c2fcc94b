/**
 * Runs once per server process before other code — install PDF-related globals
 * before pdfjs-dist is loaded (avoids ReferenceError: DOMMatrix in serverless).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
    const { installPdfNodePolyfills } = await import("./lib/pdf-node-polyfills")
    installPdfNodePolyfills()
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}
