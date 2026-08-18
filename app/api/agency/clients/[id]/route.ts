import { type NextRequest, NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { isMissingClientsTable } from "@/lib/clients"
import { fetchScopedLibraryDocuments } from "@/lib/library-documents"
import { normalizeBusinessCriteriaRequired } from "@/lib/business-criteria"
import { normalizeRfpEvaluationCriteria } from "@/lib/rfp-evaluation-criteria"

export const dynamic = "force-dynamic"

/** One client profile: read for the detail surface, patch for every edit on it. Same 42P01
 *  pre-migration handling as the list route - see its header. */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const { data, error } = await supabase
      .from("clients")
      .select("id, name, notes, default_business_criteria, default_evaluation_criteria, created_at, updated_at")
      .eq("id", id)
      .eq("org_id", user.id)
      .maybeSingle()

    if (error) {
      if (isMissingClientsTable(error)) return NextResponse.json({ client: null, available: false })
      console.error("[agency/clients/[id]] GET", { message: error.message, code: error.code })
      return NextResponse.json({ error: "Failed to load client profile" }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: "Client profile not found" }, { status: 404 })

    // Documents come through the ONE scoped query (lib/library-documents.ts) so this surface
    // cannot drift from the pickers. mode 'client' means exactly this client: never agency-wide
    // rows, never another client's.
    const scoped = await fetchScopedLibraryDocuments(supabase, user.id, { mode: "client", clientId: id })
    if (scoped.error) {
      console.warn("[agency/clients/[id]] documents unavailable, rendering without them", { message: scoped.error })
    }
    const documents = scoped.documents

    return NextResponse.json({ client: data, documents, available: true })
  } catch (e) {
    console.error("[agency/clients/[id]] GET", e)
    return NextResponse.json({ error: "Failed to load client profile" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const route = "/api/agency/clients/[id]"
  try {
    const { id } = await params
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (typeof body.name === "string") {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: "A client name is required" }, { status: 400 })
      patch.name = name
    }
    if ("notes" in body) {
      patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null
    }
    // Never trust the client payload, and normalize on write as well as on read so a malformed
    // blob or an over-cap rubric can never reach a wizard through this door.
    if ("default_business_criteria" in body) {
      patch.default_business_criteria =
        body.default_business_criteria == null
          ? null
          : normalizeBusinessCriteriaRequired(body.default_business_criteria)
    }
    if ("default_evaluation_criteria" in body) {
      patch.default_evaluation_criteria = normalizeRfpEvaluationCriteria(body.default_evaluation_criteria)
    }

    const { data, error } = await supabase
      .from("clients")
      .update(patch)
      .eq("id", id)
      .eq("org_id", user.id)
      .select("id, name, notes, default_business_criteria, default_evaluation_criteria, created_at, updated_at")
      .single()

    if (error) {
      if (isMissingClientsTable(error)) {
        return NextResponse.json(
          { error: "Client profiles are not set up yet. Apply migration 077 first.", available: false },
          { status: 503 }
        )
      }
      console.error("[api] failure", { route, method: "PATCH", message: error.message, code: error.code })
      return NextResponse.json({ error: "Failed to save client profile" }, { status: 500 })
    }

    return NextResponse.json({ client: data })
  } catch (e) {
    console.error("[api] failure", { route, method: "PATCH", message: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: "Failed to save client profile" }, { status: 500 })
  }
}
