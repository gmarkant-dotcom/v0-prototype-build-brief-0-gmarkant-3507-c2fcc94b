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
    // (app/partner/network/page.tsx). BOTH REDIRECTS ARE LOAD-BEARING, not leftovers:
    // /partner/invitations is still the CTA of live invitation emails and the post-
    // confirmation destination for vendor signups (app/api/partnerships/route.ts:590,
    // :723, app/api/agency/pool/resend-invitation/route.ts:63,
    // app/auth/callback/route.ts:246, :294, lib/notifications.ts), and
    // app/partner/discover/ has already been deleted, so its redirect is now the only
    // thing standing between an old bookmark and a 404. Removing either is a broken
    // link, not a cleanup.
    //
    // Kept `permanent: false` deliberately. app/partner/invitations/page.tsx is still on
    // disk and unreachable - redirects() runs ahead of filesystem routing - so reverting
    // to it is a one-line change here for as long as that page exists.
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
