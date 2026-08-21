import { type NextRequest, NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { resolveCallerOrgIds } from "@/lib/entitlements"

export const dynamic = "force-dynamic"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: an organization column is not a user id. Scope by membership.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const body = await request.json()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.label === "string") patch.label = body.label.trim()
    if (body.external_url !== undefined) patch.external_url = body.external_url
    if (body.blob_url !== undefined) patch.blob_url = body.blob_url
    if (body.blob_path !== undefined) patch.blob_path = body.blob_path
    if (body.file_name !== undefined) patch.file_name = body.file_name
    if (body.file_type !== undefined) patch.file_type = body.file_type
    if (body.file_size !== undefined) patch.file_size = body.file_size
    if (body.source_type === "url" || body.source_type === "file") patch.source_type = body.source_type

    const { data: row, error } = await supabase
      .from("agency_library_documents")
      .update(patch)
      .eq("id", id)
      .in("org_id", callerOrgIds)
      .select()
      .single()

    if (error || !row) {
      return NextResponse.json({ error: "Not found or update failed" }, { status: 404 })
    }
    return NextResponse.json({ document: row })
  } catch (e) {
    console.error("[agency/library-documents] PATCH", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: an organization column is not a user id. Scope by membership.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    // .select() IS NOT DECORATION. PostgREST does not report a zero-row delete as an
    // error, so without it this returned `{ success: true }` for a document that was
    // already gone, for a fabricated id, and for another organization's document - which
    // `.in("org_id", callerOrgIds)` and the RLS policy both filter out. The interface
    // removes the row on that success and it comes back on the next load.
    //
    // UNLIKE public.partnerships, THIS TABLE CAN ACTUALLY BE DELETED FROM. "Agency manages
    // own library documents" (079:1121) is FOR ALL, so DELETE is covered for the caller's
    // own organization. The happy path was and remains correct; what was missing was the
    // ability to tell it apart from the empty one.
    const { data: deletedRows, error } = await supabase
      .from("agency_library_documents")
      .delete()
      .eq("id", id)
      .in("org_id", callerOrgIds)
      .select("id")

    if (error) {
      return NextResponse.json({ error: "Delete failed" }, { status: 500 })
    }
    if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
      console.error("[agency/library-documents] DELETE matched no row", {
        id,
        reason:
          "the document does not exist, or it belongs to another organization - both are filtered by .in(org_id, callerOrgIds) and by the FOR ALL policy",
      })
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[agency/library-documents] DELETE", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
