import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  ORG_CONTACT_SELECT,
  orgWireShape,
  logOrgContactGap,
  resolveOrgContact,
  unwrapOne,
  type OrgWireShape,
  type OrgEmbed,
} from "@/lib/org-contact"

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
      // 079-EMBED: rewritten from `partner:profiles!partnerships_partner_id_fkey(...)`.
      // The PartnerOut.partner shape below is the wire contract that
      // components/stage-03-onboarding-workflow.tsx reads, and it is unchanged.
      .from("project_assignments")
      .select(
        `
        id,
        status,
        partnership_id,
        partnership:partnerships(
          id,
          vendor_org_id,
          partner_email,
          vendor_org:organizations!vendor_org_id(${ORG_CONTACT_SELECT})
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
      // 079-EMBED. Unchanged wire shape, new sources: `id` is now organizations.id,
      // `company_name` is organizations.name, and `email` / `full_name` come from the
      // organization's designated primary contact (or, for email, the partnership's own
      // pre-claim address). Every field is nullable, and the consumer already falls
      // through company_name -> full_name -> email -> the partnership id.
      vendor_org: OrgWireShape | null
      scopeLabel: string | null
    }

    const byPartnership = new Map<string, PartnerOut>()

    for (const a of assignmentRows || []) {
      const pid = a.partnership_id as string
      const inner = unwrapOne(a.partnership as Record<string, unknown> | Record<string, unknown>[] | null)
      const rowEmail = (inner?.partner_email as string | null) ?? null
      const contact = resolveOrgContact(inner?.vendor_org as OrgEmbed, rowEmail)
      if (inner?.vendor_org_id) {
        logOrgContactGap("GET /api/projects/[id]/onboarding-partners (assignment)", contact, {
          projectId,
          partnershipId: pid,
          vendorOrgId: inner.vendor_org_id,
        })
      }
      byPartnership.set(pid, {
        assignmentId: a.id as string,
        partnershipId: pid,
        status: a.status as string,
        source: "assignment",
        vendor_org: orgWireShape(inner?.vendor_org as OrgEmbed, rowEmail),
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

        // 079-EMBED (in class, not one of the thirteen). partnerId is
        // partner_rfp_responses.vendor_org_id, an ORGANIZATION id after 079, and this read
        // looked it up in `profiles` - the "JOIN profiles ON profiles.id = an org id" trap
        // 079's own table comment warns about. Left alone it silently blanks the vendor on
        // every awarded-bid row that has no assignment, which is the same surface and the
        // same PartnerOut shape as the embed above, so it is fixed with it.
        let vendorOrg: PartnerOut["vendor_org"] = null
        if (partnerId) {
          const { data: org } = await supabase
            .from("organizations")
            .select(ORG_CONTACT_SELECT)
            .eq("id", partnerId)
            .maybeSingle()
          const awardedContact = resolveOrgContact(org as OrgEmbed, null)
          logOrgContactGap("GET /api/projects/[id]/onboarding-partners (awarded bid)", awardedContact, {
            projectId,
            partnershipId,
            vendorOrgId: partnerId,
          })
          vendorOrg = orgWireShape(org as OrgEmbed, null)
        }

        byPartnership.set(partnershipId, {
          assignmentId: null,
          partnershipId,
          status: "awarded",
          source: "awarded_bid",
          vendor_org: vendorOrg,
          scopeLabel: inbox.scope_item_name ?? null,
        })
      }
    }

    const partners = [...byPartnership.values()].sort((x, y) => {
      const nx =
        x.vendor_org?.name?.trim() ||
        x.vendor_org?.contact_name?.trim() ||
        x.vendor_org?.contact_email?.trim() ||
        x.partnershipId
      const ny =
        y.vendor_org?.name?.trim() ||
        y.vendor_org?.contact_name?.trim() ||
        y.vendor_org?.contact_email?.trim() ||
        y.partnershipId
      return nx.localeCompare(ny)
    })

    return NextResponse.json({ partners }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[onboarding-partners] GET", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
