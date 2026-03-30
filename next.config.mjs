/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Keep pdfjs-dist out of the server bundle (native Node resolution; avoids DOMMatrix/Turbopack issues).
  serverExternalPackages: ["pdfjs-dist", "unpdf"],
  // Next 16 defaults to Turbopack; do not add a webpack() hook here or production build fails.
}

export default nextConfig
