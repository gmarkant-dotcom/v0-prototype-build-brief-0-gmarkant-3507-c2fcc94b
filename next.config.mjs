import { withSentryConfig } from "@sentry/nextjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    instrumentationHook: true,
    turbo: {
      resolveExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
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
  disableLogger: true,
})
