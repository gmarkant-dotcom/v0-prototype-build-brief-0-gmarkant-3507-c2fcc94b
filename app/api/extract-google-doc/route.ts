import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

function extractDocId(url: string): { type: "doc" | "slides"; id: string } | null {
  const docMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/)
  if (docMatch) return { type: "doc", id: docMatch[1] }
  const slidesMatch = url.match(/docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/)
  if (slidesMatch) return { type: "slides", id: slidesMatch[1] }
  return null
}

const NOT_ACCESSIBLE_ERROR =
  "We couldn't access this document. Please confirm link sharing is set to 'Anyone with the link can view' and try again."

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    if (!url?.trim()) {
      return NextResponse.json({ error: "URL required" }, { status: 400 })
    }

    const parsed = extractDocId(url.trim())
    if (!parsed) {
      return NextResponse.json(
        { error: "Not a valid Google Docs or Slides URL. Paste the full URL from your browser." },
        { status: 400 }
      )
    }

    const exportUrl =
      parsed.type === "doc"
        ? `https://docs.google.com/document/d/${parsed.id}/export?format=txt`
        : `https://docs.google.com/presentation/d/${parsed.id}/export/txt`

    const res = await fetch(exportUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Ligament/1.0)" },
      redirect: "follow",
    })

    const contentType = res.headers.get("content-type") ?? ""

    // Google redirects private docs to the sign-in page and returns HTML
    if (!res.ok || contentType.includes("text/html")) {
      return NextResponse.json({ error: NOT_ACCESSIBLE_ERROR }, { status: 403 })
    }

    const text = await res.text()

    // Belt-and-suspenders: sometimes 200 OK comes back with HTML anyway
    const trimmed = text.trim()
    if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
      return NextResponse.json({ error: NOT_ACCESSIBLE_ERROR }, { status: 403 })
    }

    if (!trimmed) {
      return NextResponse.json(
        { error: "The document appears to be empty." },
        { status: 422 }
      )
    }

    const out =
      trimmed.length > 120_000
        ? `${trimmed.slice(0, 120_000)}\n\n[... truncated for processing ...]`
        : trimmed

    return NextResponse.json({ text: out })
  } catch (e) {
    console.error("[extract-google-doc]", e)
    return NextResponse.json({ error: "Failed to fetch document." }, { status: 500 })
  }
}
