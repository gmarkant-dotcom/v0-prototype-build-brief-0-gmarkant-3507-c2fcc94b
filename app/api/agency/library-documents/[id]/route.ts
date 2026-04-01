import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
      .eq("agency_id", user.id)
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
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { error } = await supabase.from("agency_library_documents").delete().eq("id", id).eq("agency_id", user.id)

    if (error) {
      return NextResponse.json({ error: "Delete failed" }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[agency/library-documents] DELETE", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
