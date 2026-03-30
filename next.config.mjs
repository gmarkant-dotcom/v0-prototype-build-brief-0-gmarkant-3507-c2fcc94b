/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Avoid bundling issues for PDF/Office text extraction on Vercel
  serverExternalPackages: [
    "pdfjs-dist",
    "pdf-parse",
    "mammoth",
    "@napi-rs/canvas",
  ],
}

export default nextConfig
