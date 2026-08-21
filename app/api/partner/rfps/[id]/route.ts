import { resolveCallerOrgIds, resolveCallerWriteOrgId, orgIdFromColumn } from "@/lib/entitlements"
import { recordMilestone } from "@/lib/milestone-events"
import { ORG_CONTACT_SELECT_MEETING, resolveOrgContact, type OrgEmbed } from "@/lib/org-contact"
import { NextResponse } from "next/server"
import { partnerCanAccessPartnerRfpInbox } from "@/lib/partner-inbox-access"
import { requirePartnerRole } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await requirePartnerRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: profile } = await supabase.from("profiles").select("email").eq("id", user.id).maybeSingle()

    const { data: inbox, error: inboxError } = await supabase
      .from("partner_rfp_inbox")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    if (inboxError) {
      console.error("[partner/rfps/[id]] inbox:", inboxError)
      return NextResponse.json({ error: "Failed to load RFP" }, { status: 500 })
    }

    if (!inbox) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const access = partnerCanAccessPartnerRfpInbox(
      {
        vendor_org_id: (inbox.vendor_org_id as string | null) ?? null,
        recipient_email: (inbox.recipient_email as string | null) ?? null,
        nda_gate_enforced: (inbox.nda_gate_enforced as boolean | null) ?? false,
        nda_confirmed_at: (inbox.nda_confirmed_at as string | null) ?? null,
      },
      callerOrgIds,
      profile?.email
    )

    if (!access.allowed) {
      if (access.reason === "nda_required") {
        const master = (inbox.master_rfp_json || {}) as Record<string, unknown>
        return NextResponse.json(
          {
            error: "nda_required",
            inboxItemId: id,
            inbox: {
              id: inbox.id,
              agency_company_name: inbox.agency_company_name,
              scope_item_name: inbox.scope_item_name,
              master_rfp_json: { nda_link: master.nda_link || null },
            },
          },
          { status: 403 }
        )
      }
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    let inboxWithViewed = inbox
    if (!inbox.viewed_at) {
      const { data: updatedInbox, error: viewedUpdateError } = await supabase
        .from("partner_rfp_inbox")
        .update({ viewed_at: new Date().toISOString() })
        .eq("id", id)
        .in("vendor_org_id", callerOrgIds)
        .is("viewed_at", null)
        .select("*")
        .maybeSingle()

      if (viewedUpdateError) {
        console.error("[partner/rfps/[id]] viewed_at update failed:", viewedUpdateError)
        return NextResponse.json({ error: "Failed to update viewed state" }, { status: 500 })
      }

      if (updatedInbox) {
        inboxWithViewed = updatedInbox

        // rfp.view - THE FIRST VIEW, AND ONLY THE FIRST.
        //
        // This sits inside `if (updatedInbox)` on purpose. The UPDATE above carries
        // `.is("viewed_at", null)`, so it matches exactly once per inbox row and
        // `updatedInbox` is truthy only on the run that actually stamped it. A vendor
        // reloading the page emits nothing. Putting the emit outside this branch would put
        // one line on the agency's feed per page load.
        //
        // NOTHING HAD TO BE WIDENED FOR THIS. rfp.view is already on
        // vendor_emittable_event_types() (088:408) and on vendor_visible_event_types()
        // (080), and lib/activity-feed.ts already renders it at :404 with the expected
        // subject_type "rfp_inbox" recorded at :506. The emitter was simply never written.
        try {
          const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)

          // partnership_id off the inbox row when it has one, and a lookup when it does
          // not - the same two-step the bid.submit emitter uses at
          // app/api/partner/rfps/[id]/response/route.ts:495.
          let milestonePartnershipId = (inbox.partnership_id as string | null) ?? null
          if (!milestonePartnershipId) {
            const { data: pair } = await supabase
              .from("partnerships")
              .select("id")
              .eq("lead_org_id", inbox.lead_org_id)
              .in("vendor_org_id", callerOrgIds)
              .limit(1)
              .maybeSingle()
            milestonePartnershipId = (pair?.id as string | null) ?? null
          }

          // KNOWN RESIDUAL, NOT FIXED HERE. 088's vendor INSERT policy requires
          // partnership_id IS NOT NULL, so when the lookup above finds nothing this emit is
          // refused by RLS and recordMilestone() swallows it - the breadcrumb is silently
          // lost. That collides with the ruling that a vendor may bid without a
          // partnership. Reported in docs/emitter-coverage.md rather than worked around,
          // because the only workaround is a policy change.
          await recordMilestone(supabase, {
            eventType: "rfp.view",
            actorSide: "vendor",
            orgId: orgIdFromColumn(inbox.lead_org_id),
            actorId: user.id,
            // actorEmail deliberately absent: 088's policy requires actor_email IS NULL on
            // a vendor row.
            vendorOrgId: writeOrgId,
            partnershipId: milestonePartnershipId,
            subjectType: "rfp_inbox",
            subjectId: inbox.id as string,
            payload: {
              scope_item_name: (inbox.scope_item_name as string | null)?.trim?.() || null,
            },
          })
        } catch (milestoneErr) {
          // recordMilestone() never throws; this catches the two lookups above. A missing
          // breadcrumb must never cost the vendor their view of the RFP.
          console.error("[partner/rfps/[id]] rfp.view milestone failed (non-fatal)", milestoneErr)
        }
      }
    }

    // PHASE 3, previously deferred - the detail-view half of the same defect as the list
    // route. `meeting_url` is a profiles column and this looked it up by a lead
    // ORGANIZATION id, which matches nothing for any agency created after 079. Reached
    // through the organization's primary contact instead, because a meeting link is a
    // person's calendar. Same select fragment as the list route so the two cannot drift.
    let agencyMeetingUrl: string | null = null
    if (inboxWithViewed.lead_org_id) {
      const { data: agencyOrg, error: agencyErr } = await supabase
        .from("organizations")
        .select(ORG_CONTACT_SELECT_MEETING)
        .eq("id", inboxWithViewed.lead_org_id)
        .maybeSingle()
      if (agencyErr) {
        console.error("[partner/rfps/[id]] lead agency organization load failed", {
          message: agencyErr.message,
          code: agencyErr.code,
        })
      } else {
        agencyMeetingUrl = resolveOrgContact(agencyOrg as OrgEmbed, null).contactMeetingUrl
      }
    }

    // Fetch client_name from the linked project (LEFT JOIN pattern)
    let clientName: string | null = null
    const projectId = (inboxWithViewed.project_id as string | null) ?? null
    if (projectId) {
      const { data: projectRow } = await supabase
        .from("projects")
        .select("client_name")
        .eq("id", projectId)
        .maybeSingle()
      clientName = (projectRow?.client_name as string | null) ?? null
    }

    let response: unknown = null
    const respQ = await supabase
      .from("partner_rfp_responses")
      .select("*")
      .eq("inbox_item_id", id)
      .in("vendor_org_id", callerOrgIds)
      .maybeSingle()

    if (respQ.error) {
      if (respQ.error.code !== "42P01" && !/does not exist/i.test(respQ.error.message || "")) {
        console.error("[partner/rfps/[id]] response select failed", { message: respQ.error.message, code: respQ.error.code })
      }
    } else {
      response = respQ.data
    }

    let versions: unknown[] = []
    if (response && (response as { id?: string }).id) {
      const responseId = (response as { id: string }).id
      const { data: versionRows, error: versionErr } = await supabase
        .from("partner_rfp_response_versions")
        .select(
          "id, response_id, version_number, proposal_text, budget_proposal, timeline_proposal, attachments, status_at_submission, submitted_at, change_notes"
        )
        .eq("response_id", responseId)
        .order("version_number", { ascending: false })

      if (!versionErr) {
        versions = versionRows || []
      } else {
        console.error("[api] partner version fetch failed", {
          route: "/api/partner/rfps/[id]",
          method: "GET",
          userId: user.id,
          responseId,
          code: versionErr.code,
          message: versionErr.message,
        })
      }
    }

    // "Awarded" timeline entry: project_assignments has its own awarded_at, keyed by
    // (project_id, partnership_id) rather than by response id. Best-effort only - if either
    // key is missing, the entry is simply omitted client-side rather than erroring.
    let awardedAt: string | null = null
    const respStatus = (response as { status?: string } | null)?.status
    const partnershipId = (inboxWithViewed.partnership_id as string | null) ?? null
    if (respStatus === "awarded" && projectId && partnershipId) {
      const { data: assignmentRow } = await supabase
        .from("project_assignments")
        .select("awarded_at")
        .eq("project_id", projectId)
        .eq("partnership_id", partnershipId)
        .maybeSingle()
      awardedAt = (assignmentRow?.awarded_at as string | null) ?? null
    }

    return NextResponse.json(
      {
        inbox: { ...inboxWithViewed, agency_meeting_url: agencyMeetingUrl, client_name: clientName, awarded_at: awardedAt },
        response: response ?? null,
        versions,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      }
    )
  } catch (e) {
    console.error("[partner/rfps/[id]] GET:", e)
    return NextResponse.json({ error: "Failed to load RFP" }, { status: 500 })
  }
}
