import { NextResponse, type NextRequest } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireAgencyRole } from "@/lib/api-auth"
import { importPartnerRows } from "@/lib/server/partner-pool-import"
import { resolveCallerWriteOrgId, orgIdFromColumn } from "@/lib/entitlements"
import { recordMilestone } from "@/lib/milestone-events"

export const dynamic = "force-dynamic"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Manual "Add Vendor" - single-contact version of the spreadsheet importer's write path
 * (same table, same ghost-row shape), replacing the old client-only version that never
 * persisted anything (see LIGAMENT_CONTEXT.md / session notes on the pool page rebuild).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgencyRole()
  if (!auth.authorized) return auth.response

  const service = getServiceSupabase()
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  // 079: the pool belongs to the ORGANISATION, so resolve the caller's membership before
  // writing into it. The user id is still passed alongside, for the self-account and
  // same-domain guards, which are questions about a person.
  // 079 PARAMETER CLASS: importPartnerRows() writes this into partnerships.lead_org_id,
  // which REFERENCES organizations(id). agencyEntitlementId() was the wrong resolver - it
  // returns the user id unchanged when membership does not resolve, which is the correct
  // failure for a usage row and a 23503 for a foreign key. Fails closed instead.
  const agencyOrgId = await resolveCallerWriteOrgId(auth.user.id, service)
  if (!agencyOrgId) {
    return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
  }
  const results = await importPartnerRows(service, agencyOrgId, auth.user.id, [body], "manual", undefined, {
    agencyAuthEmail: auth.user.email,
  })
  const result = results[0]

  if (!result || result.outcome === "invalid") {
    return NextResponse.json({ error: result?.reason || "Invalid contact" }, { status: 400 })
  }
  if (result.outcome === "error") {
    return NextResponse.json({ error: result.reason || "Failed to add vendor" }, { status: 500 })
  }
  if (result.outcome === "self") {
    return NextResponse.json({ error: result.reason || "This is your own account" }, { status: 400 })
  }
  if (result.outcome === "duplicate") {
    return NextResponse.json({ error: "This email is already in your pool" }, { status: 409 })
  }

  // vendor.add - THE MANUAL ADD, AND ONLY WHEN A ROW WAS ACTUALLY ADDED.
  //
  // Placed after every non-success outcome has already returned, so a duplicate, a self-add
  // and an invalid contact emit nothing. `vendor.invite` is a different act with its own
  // emitter (app/api/partnerships/route.ts:624): this one is "a contact now exists in the
  // pool", which is what the Discovered state means.
  //
  // PAYLOAD: NOTHING. The pool row's contact details belong to the agency and to the person
  // named, and a feed line does not need them to be useful - the line reads "added a vendor
  // to the vendor pool", and the vendor's own name is not resolvable here anyway because a
  // ghost row has no organization yet. An email address in a payload would be the
  // recipient_count mistake in a different costume.
  //
  // vendorOrgId and partnershipId are deliberately absent for the same reason: the row this
  // creates is a GHOST, with vendor_org_id NULL by construction, so there is no counterparty
  // organization to name and no partnership a counterparty could read through.
  await recordMilestone(auth.supabase, {
    eventType: "vendor.add",
    orgId: orgIdFromColumn(agencyOrgId),
    actorId: auth.user.id,
    subjectType: "partnership",
    subjectId: null,
    payload: {},
  })

  return NextResponse.json({ added: true, flag: result.flag ?? null })
}
