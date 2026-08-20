import { withSentryConfig } from "@sentry/nextjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // `experimental.instrumentationHook` was removed in Next 15 - instrumentation.ts is a
  // stable convention now and is picked up by its filename alone. Next 16.1.6 does not
  // recognise the key and silently ignores it, so the file was already loading on the
  // filename; deleting the key changes nothing except the warning.
  //
  // `experimental.turbo` graduated to top-level `turbopack` in Next 15.3. Same shape,
  // same TurbopackOptions type (config-shared.d.ts), just no longer under experimental.
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  // Keep pdfjs-dist out of the server bundle (native Node resolution; avoids DOMMatrix/Turbopack issues).
  serverExternalPackages: ["pdfjs-dist", "unpdf"],
  // Next 16 defaults to Turbopack; do not add a webpack() hook here or production build fails.
  async redirects() {
    // Invitations and Discover Agencies were consolidated into Agency Network
    // (app/partner/network/page.tsx). Not permanent - app/partner/invitations/ and
    // app/partner/discover/ are left in place until the new page is verified working;
    // this redirect just takes routing priority over them in the meantime.
    return [
      { source: "/partner/invitations", destination: "/partner/network", permanent: false },
      { source: "/partner/discover", destination: "/partner/network", permanent: false },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org: "liveligood",
  project: "ligament",
  silent: true,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  // Was `disableLogger: true`. This is the exact rewrite the SDK's own compatibility shim
  // performs (config/withSentryConfig/deprecatedWebpackOptions.js) before warning about it.
  // Note that neither form does anything on this project: the `webpack.*` options are
  // documented as having no effect under Turbopack, which is what Next 16 builds with. The
  // old key was a no-op that warned; the new key is a no-op that does not. Kept rather than
  // deleted so the intent survives if this ever builds under webpack again.
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
})
