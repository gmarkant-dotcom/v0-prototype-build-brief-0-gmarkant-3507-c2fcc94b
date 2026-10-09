import { get } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ourBlobStoreAccess, parseLibraryBlobPath } from "@/lib/vercel-blob-url"
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
    const access = url ? ourBlobStoreAccess(url) : null
    const parsed = url ? parseLibraryBlobPath(url) : null
    if (!url || !access || !parsed) {
      return NextResponse.json({ error: "No file" }, { status: 404 })
    }

    // Stream only a blob that belongs to the organization that OWNS THIS ROW.
    //   - Organization-prefixed paths (`{folder}/org/{orgId}/...`, written by /api/upload since
    //     fix/route-boundary-urgent): the orgId in the path must be row.org_id.
    //   - Legacy paths (written before that, no org in them): the uploader user id in the path
    //     must be a member of row.org_id. That keeps every legitimately uploaded row serving and
    //     still refuses a row that was pointed at another tenant's file through the old
    //     unvalidated POST/PATCH. The roster read is on the session client, so RLS ("Members
    //     read their organization roster", 086) decides it.
    // Anything else (another folder, another store, another org) is a 404.
    if (parsed.scope === "org") {
      if (parsed.orgId !== row.org_id) return NextResponse.json({ error: "Not found" }, { status: 404 })
    } else {
      const { data: uploaderMembership, error: memberErr } = await supabase
        .from("org_members")
        .select("user_id")
        .eq("org_id", row.org_id)
        .eq("user_id", parsed.uploaderId)
        .maybeSingle()
      if (memberErr || !uploaderMembership) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
    }

    const result = await get(url, { access })
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
