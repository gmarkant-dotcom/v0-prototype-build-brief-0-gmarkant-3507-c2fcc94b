import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * H3 retroactive fix: claims and activates any partnerships row matching this vendor's email
 * that is still partner_id-null AND already has a real project_assignments row against it -
 * i.e. it was actually awarded (via H2's branch-d pure-guest create, before the vendor had an
 * account, or before this fix existed), not just a passive pool contact.
 *
 * Deliberately narrower than "claim every unclaimed row matching my email": a vendor may have
 * several ghost/discovered contact rows across different agencies that were never actually
 * engaged (e.g. an agency imported their email from a spreadsheet, no bid or award ever
 * happened) - those stay Discovered until the vendor is deliberately claimed through the
 * existing Agency Network flow, unchanged. This only activates the ones that already
 * represent a real, awarded relationship, which is the actual gap being fixed here: an
 * awarded engagement invisible on Delivery & Projects because its partnerships row was
 * created with partner_id null.
 */
export async function claimAwardedGhostPartnershipsByEmail(
  supabase: SupabaseClient,
  params: { partnerId: string; vendorEmail: string }
): Promise<void> {
  const { partnerId, vendorEmail } = params
  const normalizedEmail = vendorEmail.trim()
  if (!normalizedEmail) return

  try {
    const { data: ghostRows, error: ghostErr } = await supabase
      .from("partnerships")
      .select("id")
      .is("partner_id", null)
      .ilike("partner_email", normalizedEmail)
    if (ghostErr || !ghostRows || ghostRows.length === 0) return

    const ghostIds = ghostRows.map((r) => r.id as string)
    const { data: assignedRows, error: assignedErr } = await supabase
      .from("project_assignments")
      .select("partnership_id")
      .in("partnership_id", ghostIds)
    if (assignedErr || !assignedRows || assignedRows.length === 0) return

    const toClaimIds = [...new Set(assignedRows.map((r) => r.partnership_id as string))]
    const now = new Date().toISOString()
    for (const partnershipId of toClaimIds) {
      const { error: claimErr } = await supabase
        .from("partnerships")
        .update({ partner_id: partnerId, status: "active", profile_status: "active", updated_at: now })
        .eq("id", partnershipId)
        .is("partner_id", null)
      if (claimErr) {
        console.error("[partnership-award-claim] claim failed", {
          partnerId,
          partnershipId,
          message: claimErr.message,
        })
      }
    }
  } catch (err) {
    console.error("[partnership-award-claim] failed", {
      partnerId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
