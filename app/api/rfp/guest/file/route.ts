import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { displayFilenameFromBlobUrl, isVercelBlobStorageUrl, parseGuestUploadBlobPathFromUrl } from "@/lib/vercel-blob-url"

export const dynamic = "force-dynamic"

function safeDispositionFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200)
  return cleaned || "download"
}

export async function GET(request: NextRequest) {
  const route = "/api/rfp/guest/file"
  try {
    const token = (request.nextUrl.searchParams.get("token") || "").trim()
    const raw = request.nextUrl.searchParams.get("url")
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 })
    if (!raw) return NextResponse.json({ error: "Missing url" }, { status: 400 })

    let blobUrl: string
    try {
      blobUrl = decodeURIComponent(raw)
      new URL(blobUrl)
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 })
    }

    if (!isVercelBlobStorageUrl(blobUrl)) {
      return NextResponse.json({ error: "Only Vercel Blob URLs are supported" }, { status: 400 })
    }

    // The blob's own path must have been uploaded under this exact token - this is what
    // stops one guest invite link from being used to fetch another invite's attachments.
    const parsed = parseGuestUploadBlobPathFromUrl(blobUrl)
    if (!parsed || parsed.token !== token) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
    }
    const serviceSupabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { data: tokenRow, error: tokenErr } = await serviceSupabase
      .from("rfp_magic_tokens")
      .select("expires_at")
      .eq("token", token)
      .maybeSingle()

    if (tokenErr) {
      console.error("[api] failure", { route, method: "GET", code: 500, message: tokenErr.message })
      return NextResponse.json({ error: "Failed to validate token" }, { status: 500 })
    }
    if (!tokenRow || new Date(tokenRow.expires_at as string).getTime() <= Date.now()) {
      return NextResponse.json({ error: "Invalid or expired invitation link" }, { status: 400 })
    }

    const result = await get(blobUrl, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    })
    if (!result) {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    if (result.statusCode === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: result.blob.etag, "Cache-Control": "private, no-store" },
      })
    }

    const filename = safeDispositionFilename(displayFilenameFromBlobUrl(blobUrl))
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        ETag: result.blob.etag,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    console.error("[rfp/guest/file]", e)
    return NextResponse.json({ error: "Failed to download" }, { status: 500 })
  }
}
