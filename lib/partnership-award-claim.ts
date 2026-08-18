import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"

/**
 * H3 retroactive fix: claims and activates any partnerships row matching this vendor's email
 * that is still vendor_org_id-null AND already has a real project_assignments row against it -
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
 * created with vendor_org_id null.
 */
export async function claimAwardedGhostPartnershipsByEmail(
  supabase: SupabaseClient,
  /**
   * 079: partnerId is now a vendor ORGANISATION id, not a user id. It is written into
   * partnerships.vendor_org_id, which after 079 REFERENCES organizations(id). Passing a
   * user id would raise a foreign key violation for any organization created after 079 -
   * loudly, which is the one mercy here - and would silently succeed for the sixteen
   * backfilled ones whose id happens to equal their founder's.
   */
  params: { partnerId: OrgId; vendorEmail: string }
): Promise<void> {
  const { partnerId, vendorEmail } = params
  const normalizedEmail = vendorEmail.trim()
  if (!normalizedEmail) return

  try {
    const { data: ghostRows, error: ghostErr } = await supabase
      .from("partnerships")
      .select("id")
      .is("vendor_org_id", null)
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
        .update({ vendor_org_id: partnerId, status: "active", profile_status: "active", updated_at: now })
        .eq("id", partnershipId)
        .is("vendor_org_id", null)
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
