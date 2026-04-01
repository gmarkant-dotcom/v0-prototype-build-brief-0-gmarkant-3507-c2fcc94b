import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const { data: rows, error } = await supabase
      .from("agency_library_documents")
      .select("*")
      .eq("agency_id", user.id)
      .order("section", { ascending: true })
      .order("kind", { ascending: true })
      .order("updated_at", { ascending: false })

    if (error) {
      console.error("[agency/library-documents] GET", error)
      return NextResponse.json(
        { error: error.message || "Failed to load documents", documents: [] },
        { status: error.code === "42P01" ? 503 : 500 }
      )
    }

    return NextResponse.json({ documents: rows || [] })
  } catch (e) {
    console.error("[agency/library-documents] GET", e)
    return NextResponse.json({ error: "Failed to load" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const body = await request.json()
    const {
      section,
      kind,
      label,
      source_type = "file",
      external_url = null,
      blob_url = null,
      blob_path = null,
      file_name = null,
      file_type = null,
      file_size = null,
    } = body as Record<string, unknown>

    if (section !== "agency" && section !== "templates") {
      return NextResponse.json({ error: "Invalid section" }, { status: 400 })
    }

    const allowedKinds = new Set([
      "nda",
      "msa",
      "sow",
      "client_brief",
      "master_brief",
      "partner_brief",
      "budget",
      "timeline",
      "other",
    ])
    if (typeof kind !== "string" || !allowedKinds.has(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 })
    }
    if (typeof label !== "string" || !label.trim()) {
      return NextResponse.json({ error: "label required" }, { status: 400 })
    }
    if (source_type === "url" && (!external_url || typeof external_url !== "string")) {
      return NextResponse.json({ error: "external_url required for url source" }, { status: 400 })
    }
    if (source_type === "file" && (!blob_url || typeof blob_url !== "string")) {
      return NextResponse.json({ error: "blob_url required for file source" }, { status: 400 })
    }

    const { data: row, error } = await supabase
      .from("agency_library_documents")
      .insert({
        agency_id: user.id,
        section,
        kind,
        label: label.trim(),
        source_type,
        external_url: source_type === "url" ? external_url : null,
        blob_url: source_type === "file" ? blob_url : null,
        blob_path: source_type === "file" ? blob_path : null,
        file_name,
        file_type,
        file_size,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error("[agency/library-documents] POST", error)
      return NextResponse.json({ error: error.message || "Insert failed" }, { status: 500 })
    }

    return NextResponse.json({ document: row })
  } catch (e) {
    console.error("[agency/library-documents] POST", e)
    return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
}
