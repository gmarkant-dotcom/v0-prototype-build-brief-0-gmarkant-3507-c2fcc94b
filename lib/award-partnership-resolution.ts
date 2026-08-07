import type { SupabaseClient } from "@supabase/supabase-js"
import { notifyPartnershipAccepted } from "@/lib/notifications"

export type PartnershipResolution = { partnershipId: string } | { error: string }

/**
 * H2 - award is mutual consent: resolves (claiming or creating as needed) the partnership
 * an award's project_assignment row must be keyed to, instead of refusing when one doesn't
 * exist yet. Order, first hit wins:
 *   b. An active partnership already matching the bid's partner_id.
 *   c. Any other partnership row matching partner_id OR the vendor's email (a ghost/
 *      discovered row from the pool-auto-add flow, or one claimed-but-never-activated by an
 *      earlier passive claim) - claimed and activated.
 *   d. None found - created, following the exact shape
 *      app/api/rfp/guest/[token]/route.ts's classifyGuestVendorForPool already writes:
 *      profile-linked bidder -> active partnership; pure guest (no account) -> the
 *      pending/unclaimed ghost shape, never invented, since Vendor Pool can never bucket a
 *      partner_id-null row as "Active" regardless of status - a pure guest's row stays
 *      "Discovered" until they create an account and it gets claimed for real.
 * (Branch a - a partnership already linked to the broadcast/inbox row - is resolved by the
 * caller before this runs, unchanged from today.)
 */
export async function resolvePartnershipForAward(
  supabase: SupabaseClient,
  params: {
    agencyId: string
    partnerIdForResolution: string | null
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

  // b. Active partnership matching partner_id.
  if (partnerIdForResolution) {
    const { data: active, error: activeErr } = await supabase
      .from("partnerships")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("partner_id", partnerIdForResolution)
      .eq("status", "active")
      .maybeSingle()
    if (activeErr) {
      return { error: activeErr.message }
    }
    if (active) return { partnershipId: active.id as string }
  }

  // c. Any other row matching partner_id or email (ghost/discovered, or claimed-but-still-
  // pending from the passive bid-submission auto-add flow, which never activates status on
  // its own) - claim and activate it.
  const orParts: string[] = []
  if (partnerIdForResolution) orParts.push(`partner_id.eq.${partnerIdForResolution}`)
  if (normalizedEmail) orParts.push(`partner_email.ilike.${normalizedEmail}`)
  let existingRow: { id: string; partner_id: string | null } | null = null
  if (orParts.length > 0) {
    const { data: rows, error: findErr } = await supabase
      .from("partnerships")
      .select("id, partner_id")
      .eq("agency_id", agencyId)
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
        // Only set partner_id if the row didn't already have one - never overwrite a real
        // link with a different value.
        ...(existingRow.partner_id ? {} : partnerIdForResolution ? { partner_id: partnerIdForResolution } : {}),
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
      .select("id, partner_id")
      .eq("agency_id", agencyId)
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
          ...(recheckRow.partner_id ? {} : partnerIdForResolution ? { partner_id: partnerIdForResolution } : {}),
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

  if (partnerIdForResolution) {
    const { data: created, error: insertErr } = await supabase
      .from("partnerships")
      .insert({
        agency_id: agencyId,
        partner_id: partnerIdForResolution,
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

  if (!normalizedEmail) {
    return { error: "no partner_id and no vendor email to resolve a partnership from" }
  }

  // Pure guest (no account) - the exact ghost/discovered shape classifyGuestVendorForPool's
  // Case 2/3 already writes. Deliberately not "active" - Vendor Pool's Active Partners column
  // requires partner_id truthy regardless of status, so this correctly surfaces as
  // Discovered until the vendor creates an account and a real claim links it.
  const { data: created, error: insertErr } = await supabase
    .from("partnerships")
    .insert({
      agency_id: agencyId,
      partner_id: null,
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
