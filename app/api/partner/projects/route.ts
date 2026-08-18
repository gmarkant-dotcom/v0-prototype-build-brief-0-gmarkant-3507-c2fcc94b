import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { claimAwardedGhostPartnershipsByEmail } from "@/lib/partnership-award-claim"

export const dynamic = "force-dynamic"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

type ProjectRow = {
  id: string
  name?: string | null
  client_name?: string | null
  budget_range?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: string | null
}

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
      .select("role, active_role, email")
      .eq("id", user.id)
      .single()
    if (profileErr || (profile?.role !== "partner" && profile?.active_role !== "partner")) {
      return NextResponse.json({ error: "Vendor only" }, { status: 403, headers: noStoreHeaders })
    }

    // H3 retroactive fix: this route's whole result is gated on partnerships.vendor_org_id below
    // - an awarded-but-still-vendor_org_id-null ghost partnership (H2's pure-guest branch,
    // before this vendor had/linked an account) would return an empty project list forever
    // without this, even though the engagement is real. Same claim the RFP list's sweep
    // performs, run here too so this page works standalone without depending on the vendor
    // having visited /partner/rfps first in the same session.
    const vendorEmail = (profile?.email || user.email || "").trim().toLowerCase()
    const service = getServiceSupabase()
    if (service && vendorEmail) {
      await claimAwardedGhostPartnershipsByEmail(service, { partnerId: user.id, vendorEmail })
    }

    const { data: userPartnerships, error: pErr } = await supabase
      .from("partnerships")
      .select("id, lead_org_id")
      .eq("vendor_org_id", user.id)

    if (pErr) throw pErr

    const partnershipIds = (userPartnerships || []).map((r) => r.id as string)
    if (partnershipIds.length === 0) {
      return NextResponse.json({ projects: [] }, { headers: noStoreHeaders })
    }

    const partnershipIdSet = new Set(partnershipIds)
    const agencyByPartnership = new Map<string, string | null>()
    for (const s of userPartnerships || []) {
      agencyByPartnership.set(s.id as string, s.lead_org_id != null ? String(s.lead_org_id) : null)
    }

    // Fetch agency profiles for display names
    const agencyIds = [...new Set([...agencyByPartnership.values()].filter(Boolean))] as string[]
    const agencyNameById = new Map<string, string>()
    if (agencyIds.length > 0) {
      const { data: agencyProfiles } = await supabase
        .from("profiles")
        .select("id, company_name, full_name")
        .in("id", agencyIds)
      for (const ap of agencyProfiles || []) {
        agencyNameById.set(
          ap.id as string,
          ((ap.company_name as string | null) || (ap.full_name as string | null) || "Lead Agency").trim()
        )
      }
    }

    const { data: respRows, error: rErr } = await supabase
      .from("partner_rfp_responses")
      .select("id, inbox_item_id, budget_proposal")
      .eq("vendor_org_id", user.id)
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
        .select("id, name, client_name, budget_range, start_date, end_date, status")
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
      budget_range: string | null
      start_date: string | null
      end_date: string | null
      status: string | null
      partnership_id: string
      lead_org_id: string | null
      agency_name: string
      assignment_id: string
      response_id: string | null
      budget_proposal: string | null
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
      const agencyId = agencyByPartnership.get(partnership_id) ?? null

      projects.push({
        project_id,
        project_name,
        client_name: (proj?.client_name as string | null) ?? null,
        budget_range: (proj?.budget_range as string | null) ?? null,
        start_date: (proj?.start_date as string | null) ?? null,
        end_date: (proj?.end_date as string | null) ?? null,
        status: (proj?.status as string | null) ?? null,
        partnership_id,
        lead_org_id: agencyId,
        agency_name: agencyId ? (agencyNameById.get(agencyId) ?? "Lead Agency") : "Lead Agency",
        assignment_id: asg?.assignment_id ?? "",
        response_id: r.id as string,
        budget_proposal: (r.budget_proposal as string | null) ?? null,
        scope_item_name: (ib.scope_item_name ?? "").trim() || null,
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
      const agencyId = agencyByPartnership.get(partnership_id) ?? null

      projects.push({
        project_id,
        project_name,
        client_name: (proj?.client_name as string | null) ?? null,
        budget_range: (proj?.budget_range as string | null) ?? null,
        start_date: (proj?.start_date as string | null) ?? null,
        end_date: (proj?.end_date as string | null) ?? null,
        status: (proj?.status as string | null) ?? null,
        partnership_id,
        lead_org_id: agencyId,
        agency_name: agencyId ? (agencyNameById.get(agencyId) ?? "Lead Agency") : "Lead Agency",
        assignment_id: a.id as string,
        response_id: null,
        budget_proposal: null,
        scope_item_name: project_name,
        awarded_at: (a.awarded_at as string | null) ?? null,
      })
    }

    projects.sort((a, b) => {
      const an = a.agency_name.localeCompare(b.agency_name)
      if (an !== 0) return an
      const pn = a.project_name.localeCompare(b.project_name)
      if (pn !== 0) return pn
      return (a.scope_item_name ?? "").localeCompare(b.scope_item_name ?? "")
    })

    return NextResponse.json({ projects }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[api/partner/projects] GET", e)
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500, headers: noStoreHeaders })
  }
}
