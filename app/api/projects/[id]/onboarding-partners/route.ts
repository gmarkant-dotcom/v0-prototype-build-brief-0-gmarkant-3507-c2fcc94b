import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

function unwrapInbox(
  embed: { project_id?: string | null; partnership_id?: string | null; scope_item_name?: string | null } | null | unknown[]
): { project_id?: string | null; partnership_id?: string | null; scope_item_name?: string | null } | null {
  if (!embed) return null
  return Array.isArray(embed) ? embed[0] ?? null : embed
}

/** Partners eligible for onboarding: project_assignments and/or awarded bids (when assignment row missing). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: project } = await supabase
      .from("projects")
      .select("id, org_id")
      .eq("id", projectId)
      .maybeSingle()
    if (!project || project.org_id !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStoreHeaders })
    }

    const { data: assignmentRows, error: asgErr } = await supabase
      // 079-EMBED-BREAK. The `profiles!<fkey>` embed inside the select below traverses a
      // foreign key that 079 REPOINTS, and this is not a rename problem - it is a shape problem.
      // After 079, partnerships.vendor_org_id references organizations(id) rather than profiles(id), and
      // the constraint is rebuilt as partnerships_vendor_org_id_org_fkey. So the old constraint name
      // resolves to nothing, and the new one resolves to `organizations`, which carries only
      // id / name / is_lead_agency / is_vendor - no email, no full_name, no company_name, which
      // is exactly what this embed selects.
      //
      // LEFT UNCHANGED AND UNRESOLVED ON PURPOSE. Rewriting it means answering "what is a
      // vendor company's email address under an organization model", which is the
      // resolveOrgNotificationRecipients() product ruling, not a substitution. The grep guard
      // cannot see this: the constraint name embeds the old column name with no word boundary
      // in front of it, so scripts/check-identity-columns.mjs never matched it and will report
      // the rename complete with all thirteen of these still broken.
      // See docs/079-rename-execution-report.md, "The thirteen broken embeds".
      .from("project_assignments")
      .select(
        `
        id,
        status,
        partnership_id,
        partnership:partnerships(
          id,
          partner:profiles!partnerships_partner_id_fkey(
            id, email, full_name, company_name
          )
        )
      `
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })

    if (asgErr) {
      console.error("[onboarding-partners] assignments", asgErr)
      return NextResponse.json({ error: "Failed to load assignments" }, { status: 500, headers: noStoreHeaders })
    }

    type PartnerOut = {
      assignmentId: string | null
      partnershipId: string
      status: string
      source: "assignment" | "awarded_bid"
      partner: {
        id: string
        email: string | null
        full_name: string | null
        company_name: string | null
      } | null
      scopeLabel: string | null
    }

    const byPartnership = new Map<string, PartnerOut>()

    for (const a of assignmentRows || []) {
      const pid = a.partnership_id as string
      const rawPship = a.partnership as unknown
      const innerPship = Array.isArray(rawPship) ? rawPship[0] : rawPship
      const inner = innerPship as {
        id?: string
        partner: { id: string; email: string | null; full_name: string | null; company_name: string | null } | null
      } | null
      const partnerEmbed = inner?.partner
      const partner = Array.isArray(partnerEmbed) ? partnerEmbed[0] : partnerEmbed
      byPartnership.set(pid, {
        assignmentId: a.id as string,
        partnershipId: pid,
        status: a.status as string,
        source: "assignment",
        partner: partner ?? null,
        scopeLabel: null,
      })
    }

    const { data: awarded, error: bidErr } = await supabase
      .from("partner_rfp_responses")
      .select(
        `
        id,
        vendor_org_id,
        partner_rfp_inbox(project_id, partnership_id, scope_item_name)
      `
      )
      .eq("lead_org_id", user.id)
      .eq("status", "awarded")

    if (bidErr) {
      console.error("[onboarding-partners] awarded responses", bidErr)
    } else {
      for (const r of awarded || []) {
        const inbox = unwrapInbox(r.partner_rfp_inbox as Parameters<typeof unwrapInbox>[0])
        if (!inbox || inbox.project_id !== projectId) continue

        let partnershipId = inbox.partnership_id as string | null
        const partnerId = r.vendor_org_id as string | null
        if (!partnershipId && partnerId) {
          const { data: rel } = await supabase
            .from("partnerships")
            .select("id")
            .eq("lead_org_id", user.id)
            .eq("vendor_org_id", partnerId)
            .eq("status", "active")
            .maybeSingle()
          partnershipId = rel?.id ?? null
        }
        if (!partnershipId) continue
        if (byPartnership.has(partnershipId)) continue

        let partner: PartnerOut["partner"] = null
        if (partnerId) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("id, email, full_name, company_name")
            .eq("id", partnerId)
            .maybeSingle()
          if (prof) partner = prof
        }

        byPartnership.set(partnershipId, {
          assignmentId: null,
          partnershipId,
          status: "awarded",
          source: "awarded_bid",
          partner,
          scopeLabel: inbox.scope_item_name ?? null,
        })
      }
    }

    const partners = [...byPartnership.values()].sort((x, y) => {
      const nx =
        x.partner?.company_name?.trim() ||
        x.partner?.full_name?.trim() ||
        x.partner?.email?.trim() ||
        x.partnershipId
      const ny =
        y.partner?.company_name?.trim() ||
        y.partner?.full_name?.trim() ||
        y.partner?.email?.trim() ||
        y.partnershipId
      return nx.localeCompare(ny)
    })

    return NextResponse.json({ partners }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[onboarding-partners] GET", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
