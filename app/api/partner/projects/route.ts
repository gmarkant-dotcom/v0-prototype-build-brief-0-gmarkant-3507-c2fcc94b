import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

type Proj = { id: string; name?: string | null; client_name?: string | null }

function unwrap<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw as T
}

/**
 * Partner dashboard: one row per awarded assignment (engagement).
 * Includes partnership_id, agency_id, and response_id when an awarded partner_rfp_response matches the same project + partnership.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
    if (profileErr || profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: userPartnerships, error: pErr } = await supabase
      .from("partnerships")
      .select("id")
      .eq("partner_id", user.id)

    if (pErr) throw pErr

    const partnershipIds = (userPartnerships || []).map((r) => r.id as string)
    if (partnershipIds.length === 0) {
      return NextResponse.json({ projects: [] }, { headers: noStoreHeaders })
    }

    const { data: rows, error: asgErr } = await supabase
      .from("project_assignments")
      .select(
        `
        id,
        awarded_at,
        project_id,
        partnership_id,
        project:projects(
          id,
          name,
          client_name
        )
      `
      )
      .in("partnership_id", partnershipIds)
      .eq("status", "awarded")
      .order("awarded_at", { ascending: false, nullsFirst: false })

    if (asgErr) throw asgErr

    const shipIds = [...new Set((rows || []).map((r) => String(r.partnership_id)).filter(Boolean))]
    const agencyByPartnership = new Map<string, string | null>()
    if (shipIds.length > 0) {
      const { data: ships, error: sErr } = await supabase
        .from("partnerships")
        .select("id, agency_id")
        .in("id", shipIds)
      if (sErr) throw sErr
      for (const s of ships || []) {
        agencyByPartnership.set(s.id as string, s.agency_id != null ? String(s.agency_id) : null)
      }
    }

    const { data: respRows, error: rErr } = await supabase
      .from("partner_rfp_responses")
      .select("id, inbox_item_id")
      .eq("partner_id", user.id)
      .eq("status", "awarded")

    if (rErr) throw rErr

    const inboxIds = [...new Set((respRows || []).map((r) => r.inbox_item_id as string).filter(Boolean))]
    const inboxById = new Map<string, { project_id: string | null; partnership_id: string | null }>()

    if (inboxIds.length > 0) {
      const { data: inboxRows, error: iErr } = await supabase
        .from("partner_rfp_inbox")
        .select("id, project_id, partnership_id")
        .in("id", inboxIds)

      if (iErr) throw iErr
      for (const ib of inboxRows || []) {
        inboxById.set(ib.id as string, {
          project_id: ib.project_id != null ? String(ib.project_id) : null,
          partnership_id: ib.partnership_id != null ? String(ib.partnership_id) : null,
        })
      }
    }

    const responseIdByProjectPartnership = new Map<string, string>()
    for (const r of respRows || []) {
      const ib = inboxById.get(r.inbox_item_id as string)
      if (!ib?.project_id || !ib.partnership_id) continue
      const key = `${ib.project_id}:${ib.partnership_id}`
      responseIdByProjectPartnership.set(key, r.id as string)
    }

    const projects: Array<{
      id: string
      name: string
      client_name: string | null
      assignment_id: string
      partnership_id: string
      agency_id: string | null
      awarded_at: string | null
      response_id: string | null
    }> = []

    for (const a of rows || []) {
      const proj = unwrap<Proj>(a.project as Proj | Proj[] | null)
      if (!proj?.id) continue
      const pid = String(proj.id)
      const partnershipId = String(a.partnership_id)
      const nameRaw = (proj.name ?? "").trim()
      const name = nameRaw || "Project"
      const key = `${pid}:${partnershipId}`
      const response_id = responseIdByProjectPartnership.get(key) ?? null

      projects.push({
        id: pid,
        name,
        client_name: (proj.client_name as string | null) ?? null,
        assignment_id: a.id as string,
        partnership_id: partnershipId,
        agency_id: agencyByPartnership.get(partnershipId) ?? null,
        awarded_at: (a.awarded_at as string | null) ?? null,
        response_id,
      })
    }

    return NextResponse.json({ projects }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[api/partner/projects] GET", e)
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500, headers: noStoreHeaders })
  }
}
