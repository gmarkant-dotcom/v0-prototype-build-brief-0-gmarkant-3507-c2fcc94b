import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"
import { notifyPartnershipAccepted } from "@/lib/notifications"

export type PartnershipResolution = { partnershipId: string } | { error: string }

/**
 * H2 - award is mutual consent: resolves (claiming or creating as needed) the partnership
 * an award's project_assignment row must be keyed to, instead of refusing when one doesn't
 * exist yet. Order, first hit wins:
 *   b. An active partnership already matching the bid's vendor_org_id.
 *   c. Any other partnership row matching vendor_org_id OR the vendor's email (a ghost/
 *      discovered row from the pool-auto-add flow, or one claimed-but-never-activated by an
 *      earlier passive claim) - claimed and activated.
 *   d. None found - created, following the exact shape
 *      app/api/rfp/guest/[token]/route.ts's classifyGuestVendorForPool already writes:
 *      profile-linked bidder -> active partnership; pure guest (no account) -> the
 *      pending/unclaimed ghost shape, never invented, since Vendor Pool can never bucket a
 *      vendor_org_id-null row as "Active" regardless of status - a pure guest's row stays
 *      "Discovered" until they create an account and it gets claimed for real.
 *      A "profile-linked bidder" here means BOTH a vendor_org_id and an email: migration 087
 *      refuses the linked shape without the email, so a known organization with no resolvable
 *      address degrades to the ghost shape rather than to a 42501. See the insert below.
 * (Branch a - a partnership already linked to the broadcast/inbox row - is resolved by the
 * caller before this runs, unchanged from today.)
 */
export async function resolvePartnershipForAward(
  supabase: SupabaseClient,
  params: {
    /** 079 PARAMETER CLASS: partnerships.lead_org_id REFERENCES organizations(id). Branded
     *  so a profiles id - which is what the award path passed until this was typed - cannot
     *  reach it. Mint it from resolveCallerWriteOrgId(), or cross a column in through
     *  orgIdFromColumn(); never from user.id. */
    agencyId: OrgId
    /** Same column class on the other side: partnerships.vendor_org_id. A matched profile's
     *  id is NOT this value - resolve it through resolveOrgIdForUser() first. */
    partnerIdForResolution: OrgId | null
    vendorEmail: string | null
    /** Best available display name for the in-app "partnership active" notification below -
     *  falls back to the email itself rather than a vague placeholder when no name is known. */
    vendorDisplayName: string
    /** Pure-guest create only (branch d) - whatever identifying name is on file (e.g. the
     *  magic token's vendor_name), stored as partnerships.contact_name (migration 068). No
     *  company data exists for a guest bidder, so this is deliberately not company_name -
     *  never fabricated, left null when unknown. */
    vendorContactName?: string | null
  }
): Promise<PartnershipResolution> {
  const { agencyId, partnerIdForResolution, vendorEmail, vendorDisplayName, vendorContactName } = params
  const normalizedEmail = vendorEmail?.trim() || null

  // b. Active partnership matching vendor_org_id.
  if (partnerIdForResolution) {
    const { data: active, error: activeErr } = await supabase
      .from("partnerships")
      .select("id")
      .eq("lead_org_id", agencyId)
      .eq("vendor_org_id", partnerIdForResolution)
      .eq("status", "active")
      .maybeSingle()
    if (activeErr) {
      return { error: activeErr.message }
    }
    if (active) return { partnershipId: active.id as string }
  }

  // c. Any other row matching vendor_org_id or email (ghost/discovered, or claimed-but-still-
  // pending from the passive bid-submission auto-add flow, which never activates status on
  // its own) - claim and activate it.
  const orParts: string[] = []
  if (partnerIdForResolution) orParts.push(`vendor_org_id.eq.${partnerIdForResolution}`)
  if (normalizedEmail) orParts.push(`partner_email.ilike.${normalizedEmail}`)
  let existingRow: { id: string; vendor_org_id: string | null } | null = null
  if (orParts.length > 0) {
    const { data: rows, error: findErr } = await supabase
      .from("partnerships")
      .select("id, vendor_org_id")
      .eq("lead_org_id", agencyId)
      .or(orParts.join(","))
      .limit(1)
    if (findErr) {
      return { error: findErr.message }
    }
    existingRow = (rows && rows[0]) || null
  }

  if (existingRow) {
    const { error: claimErr } = await supabase
      .from("partnerships")
      .update({
        // Only set vendor_org_id if the row didn't already have one - never overwrite a real
        // link with a different value.
        ...(existingRow.vendor_org_id ? {} : partnerIdForResolution ? { vendor_org_id: partnerIdForResolution } : {}),
        profile_status: "active",
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingRow.id)
    if (claimErr) {
      return { error: claimErr.message }
    }
    try {
      await notifyPartnershipAccepted(supabase, agencyId, vendorDisplayName, existingRow.id)
    } catch (notifyErr) {
      console.error("[award-partnership-resolution] in-app notification failed (partnership already activated)", {
        partnershipId: existingRow.id,
        message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      })
    }
    return { partnershipId: existingRow.id }
  }

  // d. Create - re-check immediately before inserting to close the race window against a
  // concurrent award/claim (e.g. a double-click, or the same vendor being claimed elsewhere
  // between the lookup above and this insert).
  if (orParts.length > 0) {
    const { data: recheckRows, error: recheckErr } = await supabase
      .from("partnerships")
      .select("id, vendor_org_id")
      .eq("lead_org_id", agencyId)
      .or(orParts.join(","))
      .limit(1)
    if (recheckErr) {
      return { error: recheckErr.message }
    }
    const recheckRow = recheckRows && recheckRows[0]
    if (recheckRow) {
      const { error: claimErr } = await supabase
        .from("partnerships")
        .update({
          ...(recheckRow.vendor_org_id ? {} : partnerIdForResolution ? { vendor_org_id: partnerIdForResolution } : {}),
          profile_status: "active",
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", recheckRow.id)
      if (claimErr) {
        return { error: claimErr.message }
      }
      return { partnershipId: recheckRow.id as string }
    }
  }

  // MIGRATION 087 DECIDES THE SHAPE OF THIS INSERT, NOT THIS FUNCTION'S PREFERENCE.
  // The linked shape requires BOTH halves of the vendor identity: the policy is
  // `vendor_org_id IS NULL OR org_has_member_with_email(vendor_org_id, partner_email)`, and
  // org_has_member_with_email() returns false on a null email by construction (087:513). So
  // `vendor_org_id` set with `partner_email` null is not a partial row - it is a row the
  // database refuses with 42501, which surfaces as a failed award and a 500. The caller
  // resolves the email from three sources before reaching here
  // (app/api/agency/rfp-responses/[id]/route.ts); if all three came back empty, the linked
  // shape is unreachable and the choice is a ghost row or no award at all.
  if (partnerIdForResolution && normalizedEmail) {
    const { data: created, error: insertErr } = await supabase
      .from("partnerships")
      .insert({
        lead_org_id: agencyId,
        vendor_org_id: partnerIdForResolution,
        partner_email: normalizedEmail,
        status: "active",
        profile_status: "active",
      })
      .select("id")
      .single()
    if (insertErr || !created) {
      return { error: insertErr?.message || "insert failed" }
    }
    try {
      await notifyPartnershipAccepted(supabase, agencyId, vendorDisplayName, created.id as string)
    } catch (notifyErr) {
      console.error("[award-partnership-resolution] in-app notification failed (partnership already created)", {
        partnershipId: created.id,
        message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      })
    }
    return { partnershipId: created.id as string }
  }

  if (!normalizedEmail && !partnerIdForResolution) {
    // No identity of any kind. Nothing to file a relationship against - the caller reports
    // this to the agency as "no vendor account or email is linked to it".
    return { error: "no vendor_org_id and no vendor email to resolve a partnership from" }
  }

  if (!normalizedEmail) {
    // DEGRADED: a vendor organization is known but no address for it could be found, so the
    // linked shape above would be refused by 087. A ghost row is written instead - it
    // satisfies the policy's first disjunct, gives the award a partnership_id to key
    // project_assignments to, and grants the named organization nothing.
    // IT ALSO DROPS THE ONE FACT WE HAD. The row carries neither vendor_org_id nor
    // partner_email, so nothing later can match it: this resolver's branch c looks for
    // exactly those two columns, and 084's unique index on unclaimed rows only covers
    // `vendor_org_id IS NULL AND partner_email IS NOT NULL`. It will read as an unidentified
    // Discovered vendor in the pool until someone reconciles it by hand. That is a worse
    // record than a linked partnership and a better outcome than a 500 that loses the award,
    // and it is deliberately loud rather than silent.
    console.error("[award-partnership-resolution] no vendor email available - writing an unidentified GHOST partnership rather than a row 087 will refuse", {
      leadOrgId: agencyId,
      partnerIdForResolution,
      vendorDisplayName,
    })
  }

  // Pure guest (no account) - the exact ghost/discovered shape classifyGuestVendorForPool's
  // Case 2/3 already writes. Deliberately not "active" - Vendor Pool's Active Partners column
  // requires vendor_org_id truthy regardless of status, so this correctly surfaces as
  // Discovered until the vendor creates an account and a real claim links it.
  const { data: created, error: insertErr } = await supabase
    .from("partnerships")
    .insert({
      lead_org_id: agencyId,
      vendor_org_id: null,
      partner_email: normalizedEmail,
      status: "pending",
      profile_status: "unclaimed",
      ...(vendorContactName ? { contact_name: vendorContactName } : {}),
    })
    .select("id")
    .single()
  if (insertErr || !created) {
    return { error: insertErr?.message || "insert failed" }
  }
  return { partnershipId: created.id as string }
}
