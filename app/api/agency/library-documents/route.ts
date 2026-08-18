import { resolveCallerWriteOrgId } from "@/lib/entitlements"
import { type NextRequest, NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import {
  fetchScopedLibraryDocuments,
  isValidLibraryKind,
  isValidLibrarySection,
  type LibraryScope,
} from "@/lib/library-documents"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // Scope is resolved in ONE place - lib/library-documents.ts - so no surface can drift.
    //   ?client_id=  exactly that client (the client profile page)
    //   ?project_id= agency documents plus the project's client's (every do-the-work picker)
    //   neither      everything this agency owns (Master Documents, the sole browse-everything
    //                surface)
    const params = new URL(request.url).searchParams
    const clientId = params.get("client_id")
    const projectId = params.get("project_id")
    const scope: LibraryScope = clientId
      ? { mode: "client", clientId }
      : projectId
        ? { mode: "project", projectId }
        : { mode: "all" }

    const result = await fetchScopedLibraryDocuments(supabase, user.id, scope)
    if (result.error) {
      console.error("[agency/library-documents] GET", result.error)
      return NextResponse.json({ error: result.error || "Failed to load documents", documents: [] }, { status: 500 })
    }

    return NextResponse.json({
      documents: result.documents,
      // Lets a picker name its client group without a second round trip, and lets it render no
      // heading at all when the project has no client_id.
      clientId: result.clientId,
      clientName: result.clientName,
      clientNamesById: result.clientNamesById,
    })
  } catch (e) {
    console.error("[agency/library-documents] GET", e)
    return NextResponse.json({ error: "Failed to load", documents: [] }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: a write is attributed to the caller's OWN organization. Never a visibility set.
    const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (!writeOrgId) {
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
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

    // ITEM 1. A0 recorded that section/kind were API-validated only. That was WRONG: the live
    // database carries agency_library_documents_section_check restricting section to
    // ('agency','templates'), so every client document write was rejected at insert time. There
    // is no 'client' section and there must not be one - client_id is the discriminator
    // migration 077 added for exactly this. Validation now matches the constraint.
    if (!isValidLibrarySection(section)) {
      return NextResponse.json({ error: "Invalid section" }, { status: 400 })
    }
    const clientIdRaw = (body as Record<string, unknown>).client_id
    const clientId = typeof clientIdRaw === "string" && clientIdRaw.trim() ? clientIdRaw.trim() : null

    if (!isValidLibraryKind(kind)) {
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
        org_id: writeOrgId,
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
