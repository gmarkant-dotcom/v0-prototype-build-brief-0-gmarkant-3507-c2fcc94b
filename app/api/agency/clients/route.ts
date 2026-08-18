import { type NextRequest, NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { isMissingClientsTable, normalizeClientNameForMatch } from "@/lib/clients"
import { normalizeBusinessCriteriaRequired } from "@/lib/business-criteria"
import { normalizeRfpEvaluationCriteria } from "@/lib/rfp-evaluation-criteria"
import { resolveCallerOrgIds, resolveCallerWriteOrgId } from "@/lib/entitlements"
export const dynamic = "force-dynamic"

/**
 * Client profiles list + create (A1).
 *
 * PRE-MIGRATION BEHAVIOR, stated once here and relied on by every caller:
 * migration 077 has not been applied, so `clients` does not exist and PostgREST answers 42P01
 * (undefined_table). That is NOT the 42703 undefined_column the write guards elsewhere in this
 * codebase catch - a missing table needs its own handling, and the house precedent for it is
 * already in app/api/agency/library-documents/route.ts, which maps 42P01 to a 503.
 *
 *   GET  -> 200 with { clients: [], available: false }. The surface renders an honest empty
 *           state saying the feature needs its migration, not an error and not a fake list.
 *   POST -> 503 with a plain message. Creation is refused rather than silently dropped, because
 *           a user who typed a profile and got a green tick that persisted nothing is worse off
 *           than one who was told the truth.
 */

export async function GET() {
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: an organization column is not a user id. Scope by membership.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data, error } = await supabase
      .from("clients")
      .select("id, name, notes, default_business_criteria, default_evaluation_criteria, created_at, updated_at")
      .in("org_id", callerOrgIds)
      .order("name", { ascending: true })

    if (error) {
      if (isMissingClientsTable(error)) {
        return NextResponse.json({ clients: [], available: false })
      }
      console.error("[agency/clients] GET", { message: error.message, code: error.code })
      return NextResponse.json({ error: "Failed to load client profiles", clients: [] }, { status: 500 })
    }

    return NextResponse.json({ clients: data || [], available: true })
  } catch (e) {
    console.error("[agency/clients] GET", e)
    return NextResponse.json({ error: "Failed to load client profiles", clients: [] }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const route = "/api/agency/clients"
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: an organization column is not a user id. Scope by membership.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) {
      return NextResponse.json({ error: "A client name is required" }, { status: 400 })
    }

    // Duplicate check is a WARNING, never a block - two genuinely different clients can share a
    // name, and an agency mid-rename should not be stopped. The caller decides whether to
    // proceed; this route only reports what it found. `force` is that decision arriving back.
    const force = body.force === true
    if (!force) {
      const { data: existingRows, error: dupErr } = await supabase
        .from("clients")
        .select("id, name")
        .in("org_id", callerOrgIds)
      if (dupErr && isMissingClientsTable(dupErr)) {
        return NextResponse.json(
          { error: "Client profiles are not set up yet. Apply migration 077 first.", available: false },
          { status: 503 }
        )
      }
      const match = (existingRows || []).find(
        (c) => normalizeClientNameForMatch(c.name as string) === normalizeClientNameForMatch(name)
      )
      if (match) {
        return NextResponse.json(
          { duplicate: { id: match.id, name: match.name }, error: "A client profile with this name already exists" },
          { status: 409 }
        )
      }
    }

    // 079: a write is attributed to the caller's OWN organization, resolved through
    // membership. Never a visibility set: a counterparty set here would let a vendor create
    // a client profile inside an agency's organization merely by being partnered with it.
    const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
    if (!writeOrgId) {
      console.error("[agency/clients] POST aborted, caller belongs to no organization", { route, userId: user.id })
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
    }

    const insertRow: Record<string, unknown> = { org_id: writeOrgId, name }
    if (typeof body.notes === "string") insertRow.notes = body.notes.trim() || null
    if (body.default_business_criteria != null) {
      insertRow.default_business_criteria = normalizeBusinessCriteriaRequired(body.default_business_criteria)
    }
    if (body.default_evaluation_criteria != null) {
      insertRow.default_evaluation_criteria = normalizeRfpEvaluationCriteria(body.default_evaluation_criteria)
    }

    const { data: created, error } = await supabase
      .from("clients")
      .insert(insertRow)
      .select("id, name, notes, default_business_criteria, default_evaluation_criteria, created_at, updated_at")
      .single()

    if (error) {
      if (isMissingClientsTable(error)) {
        return NextResponse.json(
          { error: "Client profiles are not set up yet. Apply migration 077 first.", available: false },
          { status: 503 }
        )
      }
      console.error("[api] failure", { route, method: "POST", message: error.message, code: error.code })
      return NextResponse.json({ error: "Failed to create client profile" }, { status: 500 })
    }

    return NextResponse.json({ client: created })
  } catch (e) {
    console.error("[api] failure", { route, method: "POST", message: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: "Failed to create client profile" }, { status: 500 })
  }
}
