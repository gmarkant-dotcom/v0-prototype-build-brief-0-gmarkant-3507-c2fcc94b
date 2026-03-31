import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { displayFilenameFromBlobUrl, isVercelBlobStorageUrl, parseProjectBlobPathFromUrl } from "@/lib/vercel-blob-url"

export const dynamic = "force-dynamic"

function safeDispositionFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200)
  return cleaned || "download"
}

export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get("url")
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

    const parsedProject = parseProjectBlobPathFromUrl(blobUrl)
    if (!parsedProject) {
      return NextResponse.json({ error: "Unrecognized blob path" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403 })
    }

    const { data: partnerships } = await supabase
      .from("partnerships")
      .select("id")
      .eq("partner_id", user.id)
    const partnershipIds = (partnerships || []).map((p) => p.id)
    if (partnershipIds.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const { data: assignment } = await supabase
      .from("project_assignments")
      .select("id")
      .eq("project_id", parsedProject.projectId)
      .in("partnership_id", partnershipIds)
      .maybeSingle()

    if (!assignment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const result = await get(blobUrl, {
      access: "private",
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    })
    if (!result) {
      return NextResponse.json({ error: "Blob not found" }, { status: 404 })
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
    console.error("[partner/blob-download]", e)
    return NextResponse.json({ error: "Failed to download" }, { status: 500 })
  }
}
