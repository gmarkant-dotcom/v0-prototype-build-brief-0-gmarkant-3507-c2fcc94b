import { type NextRequest, NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // A1: `?client_id=<id>` narrows to one client profile's documents; its absence keeps the
    // agency's own library exactly as it was - client_id IS NULL, so nothing a client owns can
    // appear in the Master Documents slots and nothing the agency owns appears under a client.
    const clientId = new URL(request.url).searchParams.get("client_id")
    let query = supabase
      .from("agency_library_documents")
      .select("*")
      .eq("agency_id", user.id)
    // Pre-migration the column does not exist, so the filter is applied ONLY when the caller
    // asked for client scoping. An unscoped call never mentions client_id and therefore keeps
    // working untouched before 077.
    if (clientId) query = query.eq("client_id", clientId)
    const { data: rows, error } = await query
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
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

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

    // A1: 'client' joins the two existing sections. section/kind are API-validated rather than
    // CHECK-constrained (see docs/client-profiles-discovery.md), so this is a code change only.
    if (section !== "agency" && section !== "templates" && section !== "client") {
      return NextResponse.json({ error: "Invalid section" }, { status: 400 })
    }
    const clientId = typeof (body as Record<string, unknown>).client_id === "string" ? (body as Record<string, unknown>).client_id : null
    if (section === "client" && !clientId) {
      return NextResponse.json({ error: "A client document needs a client_id" }, { status: 400 })
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
        // A1 write guard: only ever sent for a client document, so every request shaped like
        // today's carries no client_id at all and cannot touch a column migration 077 may not
        // have created yet.
        ...(clientId ? { client_id: clientId } : {}),
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
