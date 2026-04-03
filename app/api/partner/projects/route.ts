import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

type ProjectRow = { id: string; name?: string | null; client_name?: string | null }

/**
 * One row per awarded partner_rfp_response (per scope), plus fallback rows for awarded
 * project_assignments that have no matching awarded response.
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

    const partnershipIdSet = new Set(partnershipIds)

    const { data: respRows, error: rErr } = await supabase
      .from("partner_rfp_responses")
      .select("id, inbox_item_id")
      .eq("partner_id", user.id)
      .eq("status", "awarded")

    if (rErr) throw rErr

    const inboxIds = [...new Set((respRows || []).map((r) => r.inbox_item_id as string).filter(Boolean))]
    const inboxById = new Map<
      string,
      { project_id: string | null; partnership_id: string | null; scope_item_name: string | null }
    >()

    if (inboxIds.length > 0) {
      const { data: inboxRows, error: iErr } = await supabase
        .from("partner_rfp_inbox")
        .select("id, project_id, partnership_id, scope_item_name")
        .in("id", inboxIds)

      if (iErr) throw iErr
      for (const ib of inboxRows || []) {
        inboxById.set(ib.id as string, {
          project_id: ib.project_id != null ? String(ib.project_id) : null,
          partnership_id: ib.partnership_id != null ? String(ib.partnership_id) : null,
          scope_item_name: (ib.scope_item_name as string | null) ?? null,
        })
      }
    }

    const { data: asgRows, error: asgErr } = await supabase
      .from("project_assignments")
      .select("id, project_id, partnership_id, awarded_at")
      .in("partnership_id", partnershipIds)
      .eq("status", "awarded")

    if (asgErr) throw asgErr

    const assignmentByProjectPartnership = new Map<
      string,
      { assignment_id: string; awarded_at: string | null }
    >()
    for (const a of asgRows || []) {
      const p = String(a.project_id)
      const ship = String(a.partnership_id)
      assignmentByProjectPartnership.set(`${p}:${ship}`, {
        assignment_id: a.id as string,
        awarded_at: (a.awarded_at as string | null) ?? null,
      })
    }

    const agencyByPartnership = new Map<string, string | null>()
    if (partnershipIds.length > 0) {
      const { data: ships, error: sErr } = await supabase
        .from("partnerships")
        .select("id, agency_id")
        .in("id", partnershipIds)
      if (sErr) throw sErr
      for (const s of ships || []) {
        agencyByPartnership.set(s.id as string, s.agency_id != null ? String(s.agency_id) : null)
      }
    }

    const projectIdsNeeded = new Set<string>()
    for (const r of respRows || []) {
      const ib = inboxById.get(r.inbox_item_id as string)
      if (!ib?.project_id || !ib.partnership_id || !partnershipIdSet.has(ib.partnership_id)) continue
      projectIdsNeeded.add(ib.project_id)
    }
    for (const a of asgRows || []) {
      projectIdsNeeded.add(String(a.project_id))
    }

    const projectById = new Map<string, ProjectRow>()
    if (projectIdsNeeded.size > 0) {
      const { data: projRows, error: prErr } = await supabase
        .from("projects")
        .select("id, name, client_name")
        .in("id", [...projectIdsNeeded])
      if (prErr) throw prErr
      for (const pr of projRows || []) {
        projectById.set(pr.id as string, pr as ProjectRow)
      }
    }

    type Out = {
      project_id: string
      project_name: string
      client_name: string | null
      partnership_id: string
      agency_id: string | null
      assignment_id: string
      response_id: string | null
      scope_item_name: string | null
      awarded_at: string | null
    }

    const projects: Out[] = []
    const projectPartnershipWithResponse = new Set<string>()

    for (const r of respRows || []) {
      const ib = inboxById.get(r.inbox_item_id as string)
      if (!ib?.project_id || !ib.partnership_id || !partnershipIdSet.has(ib.partnership_id)) continue

      const project_id = ib.project_id
      const partnership_id = ib.partnership_id
      const key = `${project_id}:${partnership_id}`
      projectPartnershipWithResponse.add(key)

      const asg = assignmentByProjectPartnership.get(key)
      const proj = projectById.get(project_id)
      const project_name = (proj?.name ?? "").trim() || "Project"
      const scopeRaw = (ib.scope_item_name ?? "").trim()
      const scope_item_name = scopeRaw || null

      projects.push({
        project_id,
        project_name,
        client_name: (proj?.client_name as string | null) ?? null,
        partnership_id,
        agency_id: agencyByPartnership.get(partnership_id) ?? null,
        assignment_id: asg?.assignment_id ?? "",
        response_id: r.id as string,
        scope_item_name,
        awarded_at: asg?.awarded_at ?? null,
      })
    }

    for (const a of asgRows || []) {
      const project_id = String(a.project_id)
      const partnership_id = String(a.partnership_id)
      const key = `${project_id}:${partnership_id}`
      if (projectPartnershipWithResponse.has(key)) continue

      const proj = projectById.get(project_id)
      const project_name = (proj?.name ?? "").trim() || "Project"

      projects.push({
        project_id,
        project_name,
        client_name: (proj?.client_name as string | null) ?? null,
        partnership_id,
        agency_id: agencyByPartnership.get(partnership_id) ?? null,
        assignment_id: a.id as string,
        response_id: null,
        scope_item_name: project_name,
        awarded_at: (a.awarded_at as string | null) ?? null,
      })
    }

    projects.sort((a, b) => {
      const pn = a.project_name.localeCompare(b.project_name)
      if (pn !== 0) return pn
      const sn = (a.scope_item_name ?? "").localeCompare(b.scope_item_name ?? "")
      if (sn !== 0) return sn
      return (a.response_id ?? "").localeCompare(b.response_id ?? "")
    })

    return NextResponse.json({ projects }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[api/partner/projects] GET", e)
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500, headers: noStoreHeaders })
  }
}
