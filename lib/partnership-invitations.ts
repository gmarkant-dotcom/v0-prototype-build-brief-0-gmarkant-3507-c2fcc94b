import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"

/**
 * What the call resolved to, for a caller that needs to point at the row afterwards.
 *
 * Both fields are nullable and a null is never an error signal. This helper already
 * swallows every database error it can meet - it is a courtesy stamp, not a load-bearing
 * write - so "the stamp happened but I cannot tell you which row" is a real outcome and is
 * reported as `partnershipId: null` rather than by throwing. The milestone emitters that
 * read this treat a null the same way they treat any other missing id: the breadcrumb is
 * written without it, never withheld and never failed.
 */
export type PartnershipInvitationRef = {
  /** partnerships.id, when it could be read back. */
  partnershipId: string | null
  /** partnerships.vendor_org_id - null for a ghost pre-claim row, which is the common shape. */
  vendorOrgId: OrgId | null
}

/**
 * Marks the (agency, vendor email) partnership as invited - invitation_sent_at is what
 * distinguishes an "Invited" pool row from a merely "Discovered" one on /agency/pool.
 * Creates the partnerships row if none exists yet (e.g. a Lightning RFP magic link sent to
 * a vendor with no prior pool entry). Callers must only call this after confirming the
 * invitation email actually sent successfully - never on a swallowed send failure.
 *
 * Returns the row it touched. Added so the `vendor.invite_resend` and `rfp.magic_link_send`
 * emitters can set `partnership_id`, which is the ONLY thing that makes a milestone row
 * reachable by the vendor it is about - migration 080's counterparty SELECT policy is keyed
 * on it. Returning it here beats a second lookup at each call site, which would be a second
 * chance to resolve a DIFFERENT row than the one actually stamped.
 */
export async function markPartnershipInvited(
  supabase: SupabaseClient,
  params: { agencyId: OrgId; vendorEmail: string; partnerId?: OrgId | null }
): Promise<PartnershipInvitationRef> {
  const { agencyId, partnerId } = params
  const email = params.vendorEmail.trim().toLowerCase()
  const none: PartnershipInvitationRef = { partnershipId: null, vendorOrgId: null }
  if (!email) return none
  const now = new Date().toISOString()

  let existingId: string | null = null
  let existingVendorOrgId: string | null = null
  if (partnerId) {
    const { data } = await supabase
      .from("partnerships")
      .select("id, vendor_org_id")
      .eq("lead_org_id", agencyId)
      .eq("vendor_org_id", partnerId)
      .limit(1)
      .maybeSingle()
    existingId = (data as { id: string } | null)?.id ?? null
    existingVendorOrgId = (data as { vendor_org_id: string | null } | null)?.vendor_org_id ?? null
  }
  if (!existingId) {
    const { data } = await supabase
      .from("partnerships")
      .select("id, vendor_org_id")
      .eq("lead_org_id", agencyId)
      .ilike("partner_email", email)
      .limit(1)
      .maybeSingle()
    existingId = (data as { id: string } | null)?.id ?? null
    existingVendorOrgId = (data as { vendor_org_id: string | null } | null)?.vendor_org_id ?? null
  }

  if (existingId) {
    await supabase
      .from("partnerships")
      .update({ invitation_sent_at: now, updated_at: now })
      .eq("id", existingId)
    return {
      partnershipId: existingId,
      // The column, not `partnerId`. On the second lookup - by email - the row found may be
      // a ghost with vendor_org_id null even though the caller passed a partnerId, and the
      // update above does not link them. Reporting the caller's guess instead of the stored
      // value is how a milestone ends up naming an organization the partnership does not.
      vendorOrgId: (existingVendorOrgId as OrgId | null) ?? null,
    }
  }

  // `.select("id")` reads back the row just written so the caller can name it. Errors stay
  // swallowed exactly as they were before this returned anything: a denied read-back leaves
  // the INSERT itself committed and simply yields a null id.
  const { data: inserted } = await supabase
    .from("partnerships")
    .insert({
      lead_org_id: agencyId,
      vendor_org_id: partnerId || null,
      partner_email: email,
      profile_status: partnerId ? "active" : "unclaimed",
      status: "pending",
      invitation_sent_at: now,
    })
    .select("id")
    .maybeSingle()

  return {
    partnershipId: (inserted as { id: string } | null)?.id ?? null,
    vendorOrgId: partnerId ?? null,
  }
}
