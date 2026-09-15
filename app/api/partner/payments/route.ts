import { resolveCallerOrgIds } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ORG_CONTACT_SELECT, resolveOrgContact, type OrgEmbed } from "@/lib/org-contact"

export const dynamic = "force-dynamic"

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

type ProjectEmbed = { title?: string | null; name?: string | null; client_name?: string | null }

type InboxEmbed = { scope_item_name?: string | null }

type ResponseEmbed = {
  id?: string
  partner_rfp_inbox?: InboxEmbed | InboxEmbed[] | null
}

function normalizeOne<T>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null
  if (Array.isArray(raw)) return (raw[0] as T) ?? null
  return raw as T
}

function projectDisplayName(proj: ProjectEmbed | null): string {
  if (!proj) return "Project"
  const t = (proj.title || proj.name || "").trim()
  return t || "Project"
}

function scopeFromResponse(res: ResponseEmbed | null): string | null {
  if (!res) return null
  const inbox = normalizeOne<InboxEmbed>(res.partner_rfp_inbox)
  const s = (inbox?.scope_item_name || "").trim()
  return s || null
}

/**
 * GET payment milestones visible to the partner:
 * - Rows with partnership_id in the partner's active partnerships, OR
 * - Rows on project_id where the partner has an awarded assignment (covers NULL partnership_id on milestones).
 *
 * Embeds: projects (title, client_name), partner_rfp_responses → partner_rfp_inbox (scope_item_name).
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role, active_role")
      .eq("id", user.id)
      .single()

    if (profileErr || (profile?.role !== "partner" && profile?.active_role !== "partner")) {
      return NextResponse.json({ error: "Vendors only" }, { status: 403, headers: noStore })
    }

    /**
     * THE ACTIVE-ONLY FILTER IS GONE. GREG RULED AGAINST IT ON 2026-09-14; IT CAME OFF IN
     * edff222 ("fix: a vendor owed money keeps seeing it after the relationship ends").
     *
     * THIS SELECT INTENTIONALLY HAS NO STATUS PREDICATE. Do not add one back without the
     * ruling being re-made - the absence is the feature, not an oversight.
     *
     * The ruling: a vendor who is owed money keeps seeing what they are owed after the
     * relationship ends, the same principle as the RFP closure ruling. The counterparty
     * keeps their record.
     *
     * What the filter used to cause, kept here because it is the argument for not restoring
     * it: `payment_milestones` carries no status predicate in any of its policies, so a vendor
     * whose partnership moved to any end state lost the payments SCREEN while keeping the DATA
     * underneath. It gated BOTH milestone reads below, not just one - `partnershipIds` feeds
     * the partnership_id query directly and also feeds `awardedProjectIds`, which feeds the
     * project_id query - so a vendor whose only partnership had ended got
     * `{ milestones: [], partnerships: [] }`: not an error, not a partial list, an empty
     * screen.
     *
     * WHY REMOVING IT IS SAFE, AND WHERE THE PROOF IS. All three partner SELECT policies on
     * `payment_milestones` confine a vendor to partnerships their own org holds. There is no
     * status predicate to lean on and none was removed, so widening this read exposes the
     * CALLER'S OWN ended partnerships and cannot reach another vendor's milestones. The
     * policies are quoted in full in docs/pool-counts-and-payments-report.md section 2b.
     *
     * A SECOND FILTER CAME OFF WITH IT, and either alone would have been a no-op: the
     * client-side status === "active" narrowing of /api/partnerships in
     * app/partner/payments/page.tsx, which is what fills the agency selector. Without that
     * one the milestones arrive here with no agency to select them under.
     */
    const { data: partnershipRows, error: pErr } = await supabase
      .from("partnerships")
      .select("id, lead_org_id, status")
      .in("vendor_org_id", callerOrgIds)
      .order("created_at", { ascending: false })

    if (pErr) {
      console.error("[api/partner/payments] partnerships query failed", {
        message: pErr.message,
        code: pErr.code,
      })
      return NextResponse.json({ error: "Failed to load partnerships" }, { status: 500, headers: noStore })
    }

    const active = partnershipRows || []
    const partnershipIds = active.map((p) => p.id as string)
    const agencyIds = [...new Set(active.map((p) => p.lead_org_id as string).filter(Boolean))]

    // PHASE 3: was `.from("profiles").in("id", <lead org ids>)`. Those are ORGANIZATION ids
    // and this is the profiles table - correct only while an organization's id equals its
    // founder's user id, which is true for the sixteen accounts 079 backfilled and false for
    // every one created since. The lead agency's name silently became the literal fallback.
    // Read from `organizations` through the shared contact fragment, exactly as
    // /api/partner/dashboard already does, so no two vendor surfaces resolve a name
    // differently. No new policy: an organization is readable through
    // current_user_counterparty_org_ids() whenever a partnership row exists.
    let agencyNameById: Record<string, string> = {}
    if (agencyIds.length > 0) {
      const { data: agencies, error: aErr } = await supabase
        .from("organizations")
        .select(ORG_CONTACT_SELECT)
        .in("id", agencyIds)

      if (aErr) {
        console.error("[api/partner/payments] agency profiles failed", {
          message: aErr.message,
          code: aErr.code,
        })
      } else {
        for (const a of (agencies || []) as unknown[]) {
          const contact = resolveOrgContact(a as OrgEmbed, null)
          if (!contact.orgId) continue
          // Same precedence the profiles read had: the company, then the person. The literal
          // "Agency" fallback is unchanged - it fires when the row resolves with no name.
          agencyNameById[contact.orgId] = contact.orgName || contact.contactFullName || "Agency"
        }
      }
    }

    let awardedProjectIds: string[] = []
    if (partnershipIds.length > 0) {
      const { data: asg, error: asgErr } = await supabase
        .from("project_assignments")
        .select("project_id")
        .in("partnership_id", partnershipIds)
        .eq("status", "awarded")

      if (asgErr) {
        console.error("[api/partner/payments] awarded assignments failed", asgErr)
      } else {
        awardedProjectIds = [...new Set((asg || []).map((r) => r.project_id as string).filter(Boolean))]
      }
    }

    const selectMilestones = `
      id,
      title,
      amount,
      currency,
      due_date,
      status,
      paid_at,
      notes,
      partnership_id,
      project_id,
      response_id,
      project:projects ( name, client_name ),
      response:partner_rfp_responses (
        id,
        partner_rfp_inbox ( scope_item_name )
      )
    `

    const byId = new Map<string, Record<string, unknown>>()

    if (partnershipIds.length > 0) {
      const { data: byPartnership, error: e1 } = await supabase
        .from("payment_milestones")
        .select(selectMilestones)
        .in("partnership_id", partnershipIds)
        .order("due_date", { ascending: true })

      if (e1) {
        console.error("[api/partner/payments] payment_milestones by partnership_id failed", {
          message: e1.message,
          code: e1.code,
          details: e1.details,
          hint: e1.hint,
        })
        return NextResponse.json({ error: "Failed to load payment milestones" }, { status: 500, headers: noStore })
      }
      for (const row of byPartnership || []) {
        byId.set(String((row as { id: string }).id), row as Record<string, unknown>)
      }
    }

    if (awardedProjectIds.length > 0) {
      const { data: byProject, error: e2 } = await supabase
        .from("payment_milestones")
        .select(selectMilestones)
        .in("project_id", awardedProjectIds)
        .order("due_date", { ascending: true })

      if (e2) {
        console.error("[api/partner/payments] payment_milestones by project_id failed", {
          message: e2.message,
          code: e2.code,
          details: e2.details,
          hint: e2.hint,
        })
        return NextResponse.json({ error: "Failed to load payment milestones" }, { status: 500, headers: noStore })
      }
      for (const row of byProject || []) {
        byId.set(String((row as { id: string }).id), row as Record<string, unknown>)
      }
    }

    const milestoneRows = [...byId.values()].sort((a, b) => {
      const da = String(a.due_date || "")
      const db = String(b.due_date || "")
      return da.localeCompare(db)
    })

    const toApiRow = (m: Record<string, unknown>) => {
      const proj = normalizeOne<ProjectEmbed>(m.project as ProjectEmbed | ProjectEmbed[] | null)
      const res = normalizeOne<ResponseEmbed>(m.response as ResponseEmbed | ResponseEmbed[] | null)
      const amountRaw = m.amount
      const amount =
        typeof amountRaw === "string" ? parseFloat(amountRaw) : Number(amountRaw)
      return {
        id: m.id as string,
        title: m.title as string,
        amount: Number.isFinite(amount) ? amount : 0,
        currency: (m.currency as string) || "USD",
        due_date: m.due_date as string,
        status: m.status as string,
        paid_at: (m.paid_at as string | null) ?? null,
        notes: (m.notes as string | null) ?? null,
        partnership_id: (m.partnership_id as string | null) ?? null,
        project_id: m.project_id as string,
        response_id: (m.response_id as string | null) ?? null,
        project_name: projectDisplayName(proj),
        client_name: proj?.client_name ?? null,
        scope_item_name: scopeFromResponse(res),
      }
    }

    const milestones = milestoneRows.map(toApiRow)

    const milestonesByPartnership = new Map<string, typeof milestones>()
    for (const m of milestones) {
      const pid = m.partnership_id
      if (!pid) continue
      const arr = milestonesByPartnership.get(pid) || []
      arr.push(m)
      milestonesByPartnership.set(pid, arr)
    }

    const partnerships = active.map((row) => {
      const pid = row.id as string
      const aid = row.lead_org_id as string
      const list = milestonesByPartnership.get(pid) || []
      return {
        partnership_id: pid,
        lead_org_id: aid,
        agency_name: agencyNameById[aid] || "Agency",
        // ADDITIVE, AND IT IS ALWAYS 'active' TODAY. `status` has been selected since this
        // route was written and was never returned, so the payments screen had no way to
        // tell a live relationship from an ended one even in principle. It is returned now
        // so the screen's "relationship ended" labelling is driven by the row rather than
        // assumed from the fact that the row arrived at all. See the status filter note on
        // the partnerships query above.
        status: (row.status as string | null) ?? null,
        milestones: list,
      }
    })

    return NextResponse.json({ milestones, partnerships }, { headers: noStore })
  } catch (e) {
    console.error("[api/partner/payments] unexpected", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStore })
  }
}
