import { type NextRequest, NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { resolveCallerOrgIds, orgIdFromColumn } from "@/lib/entitlements"
import { recordMilestone } from "@/lib/milestone-events"

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
    // THE PRE-READ FOR THE BREADCRUMB, AND WHY IT IS NOT FOLDED INTO THE DELETE'S OWN
    // .select().
    //
    // The obvious shape is `.select("id, client_id")` on the delete below. IT IS NOT SAFE:
    // `client_id` arrives with migration 077, this route already carries pre-077 guards for
    // exactly that reason (see the POST half of this feature), and a PostgREST select naming
    // an absent column fails the WHOLE statement. That would turn a missing migration into a
    // BROKEN DELETE - a real capability lost to buy a feed line, which is the wrong trade in
    // every direction.
    //
    // So it is read separately, before the delete, and every failure is swallowed: no row,
    // no column, no permission, all mean "emit nothing" and the delete proceeds untouched.
    let removedClientId: string | null = null
    let removedClientName: string | null = null
    try {
      const { data: docRow } = await supabase
        .from("agency_library_documents")
        .select("client_id")
        .eq("id", id)
        .in("org_id", callerOrgIds)
        .maybeSingle()
      removedClientId = (docRow?.client_id as string | null) ?? null
      if (removedClientId) {
        const { data: clientRow } = await supabase
          .from("clients")
          .select("name")
          .eq("id", removedClientId)
          .in("org_id", callerOrgIds)
          .maybeSingle()
        removedClientName = (clientRow?.name as string | null) ?? null
      }
    } catch {
      // Pre-077, or the column is gone, or the row is not readable. No breadcrumb, and the
      // delete below is unaffected. Deliberately silent: this is not a failure of anything
      // the caller asked for.
    }

    if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
      console.error("[agency/library-documents] DELETE matched no row", {
        id,
        reason:
          "the document does not exist, or it belongs to another organization - both are filtered by .in(org_id, callerOrgIds) and by the FOR ALL policy",
      })
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    // client.document_remove - ONLY FOR A CLIENT DOCUMENT, and only after a row was really
    // deleted. It sits below the zero-row check on purpose: that check exists because
    // PostgREST does not report a zero-row delete as an error, and a breadcrumb for a
    // deletion that did not happen is the same lie in a different table.
    if (removedClientId) {
      await recordMilestone(supabase, {
        eventType: "client.document_remove",
        orgId: orgIdFromColumn(callerOrgIds[0] ?? null),
        actorId: user.id,
        subjectType: "client",
        subjectId: removedClientId,
        payload: { client_name: removedClientName },
      })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[agency/library-documents] DELETE", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
