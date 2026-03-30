/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Run pdf tooling as native Node modules (Turbopack must not bundle them).
  serverExternalPackages: ["pdfjs-dist", "pdf-parse"],
}

export default nextConfig
