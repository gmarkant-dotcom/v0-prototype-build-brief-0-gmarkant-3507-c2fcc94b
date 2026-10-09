import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isVercelBlobStorageUrl, parseAgencyLibraryBlobPathFromUrl } from "@/lib/vercel-blob-url"
import { resolveCallerOrgIds, callerOwnsOrg } from "@/lib/entitlements"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    // The record id is the ONLY input. A caller-supplied blob URL or path is never honoured,
    // so a request carrying one is refused rather than silently ignored.
    const params = request.nextUrl.searchParams
    if (params.has("url") || params.has("path") || params.has("blob_url") || params.has("pathname")) {
      return NextResponse.json({ error: "Only a document id is accepted" }, { status: 400 })
    }
    const id = params.get("id")
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // 079: an organization column is not a user id. Scope by membership.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: row, error } = await supabase
      .from("agency_library_documents")
      .select("id, org_id, label, blob_url, source_type, external_url")
      .eq("id", id)
      .in("org_id", callerOrgIds)
      .single()

    if (error || !row || !callerOwnsOrg(callerOrgIds, row.org_id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    if (row.source_type === "url" && row.external_url) {
      return NextResponse.redirect(row.external_url)
    }

    const url = row.blob_url as string | null
    if (!url || !isVercelBlobStorageUrl(url)) {
      return NextResponse.json({ error: "No file" }, { status: 404 })
    }

    // blob_url is written by library-documents POST/PATCH from the request body, so the row can
    // point at ANY private blob, including another tenant's. Stream it only if it is this
    // record's own kind of blob: an agency-library upload (the only folder the library UI uses)
    // whose uploader, the user id `/api/upload` puts in the path, is a member of the row's own
    // organization. The roster read runs on the session client, so RLS ("Members read their
    // organization roster", 086) decides it.
    const parsed = parseAgencyLibraryBlobPathFromUrl(url)
    if (!parsed) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const { data: uploaderMembership, error: memberErr } = await supabase
      .from("org_members")
      .select("user_id")
      .eq("org_id", row.org_id)
      .eq("user_id", parsed.uploaderId)
      .maybeSingle()
    if (memberErr || !uploaderMembership) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const result = await get(url, { access: "private" })
    if (!result?.stream) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const name = (row.label as string).replace(/[^\w.\- ()]+/g, "_").slice(0, 200) || "document"

    return new NextResponse(result.stream as unknown as BodyInit, {
      headers: {
        "Content-Type": result.blob?.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (e) {
    console.error("[agency/library-documents/file]", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
