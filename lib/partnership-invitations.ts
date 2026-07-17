import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Marks the (agency, vendor email) partnership as invited - invitation_sent_at is what
 * distinguishes an "Invited" pool row from a merely "Discovered" one on /agency/pool.
 * Creates the partnerships row if none exists yet (e.g. a Lightning RFP magic link sent to
 * a vendor with no prior pool entry). Callers must only call this after confirming the
 * invitation email actually sent successfully - never on a swallowed send failure.
 */
export async function markPartnershipInvited(
  supabase: SupabaseClient,
  params: { agencyId: string; vendorEmail: string; partnerId?: string | null }
): Promise<void> {
  const { agencyId, partnerId } = params
  const email = params.vendorEmail.trim().toLowerCase()
  if (!email) return
  const now = new Date().toISOString()

  let existingId: string | null = null
  if (partnerId) {
    const { data } = await supabase
      .from("partnerships")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("partner_id", partnerId)
      .limit(1)
      .maybeSingle()
    existingId = (data as { id: string } | null)?.id ?? null
  }
  if (!existingId) {
    const { data } = await supabase
      .from("partnerships")
      .select("id")
      .eq("agency_id", agencyId)
      .ilike("partner_email", email)
      .limit(1)
      .maybeSingle()
    existingId = (data as { id: string } | null)?.id ?? null
  }

  if (existingId) {
    await supabase
      .from("partnerships")
      .update({ invitation_sent_at: now, updated_at: now })
      .eq("id", existingId)
    return
  }

  await supabase.from("partnerships").insert({
    agency_id: agencyId,
    partner_id: partnerId || null,
    partner_email: email,
    profile_status: partnerId ? "active" : "unclaimed",
    status: "pending",
    invitation_sent_at: now,
  })
}
