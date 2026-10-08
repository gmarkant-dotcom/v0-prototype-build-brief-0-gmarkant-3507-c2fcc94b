import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"

/**
 * Links the unclaimed partnership invitations addressed to ONE email to ONE organization.
 *
 * This is the body of the service-role claim endpoint (POST /api/partner/partnerships/claim),
 * kept here so the route stays a thin session check and so the four claim paths that cannot
 * reach an unclaimed row from a user session (docs/claim-visibility-rulings.md) can call the
 * same code later. It is NOT a general helper: both inputs are authority, not data.
 *
 * WHY A SERVICE CLIENT AT ALL. An UPDATE whose WHERE names a column must also pass the SELECT
 * policies, and an unclaimed row is visible to neither organization, so the claimer cannot see
 * the row they are claiming and the statement matches zero rows. 093 fixed the matching, not
 * the visibility. The ruling (Greg, 2026-10-08) is that a partner agency must not see the lead
 * agency's private notes, which rules out any email-keyed SELECT policy because RLS grants the
 * whole row, partnership_notes and the blacklist flag included.
 *
 * THE CALLER OWNS BOTH ARGUMENTS' TRUST. `email` must be the authenticated session user's own
 * verified email and `orgId` the organization resolveCallerWriteOrgId() returned for that same
 * session. Neither may come from a request body, a query string, a header or a cookie. This
 * function cannot check that, and says so rather than pretending to.
 *
 * WHAT IT RETURNS: a count. Never a row, an id, an organization, or any part of
 * partnership_notes. A caller that wants a list is asking for the read this design exists to
 * avoid.
 *
 * WHAT STILL PROTECTS IT IN THE DATABASE. 087's half of partnerships_guard_identity_columns
 * has NO service-role exemption: a NULL -> value write to vendor_org_id is refused (23514)
 * unless org_has_member_with_email(orgId, partner_email) is true, so an organization with no
 * member at the invited address cannot be written even by a bug here. That is a backstop, not
 * the design.
 */

/** lower(btrim(x)): the comparison 093's claim policy and 087's org_has_member_with_email use. */
export function normalizeEmail(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

/** Escapes LIKE metacharacters so an address is matched as text. An address may legally contain
 *  "_" or "%", and an unescaped "_" matches any one character and "%" any run: the wildcard hole
 *  093 closed for the claim policy, and which the ilike this replaces had. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&")
}

// A person with more unclaimed invitations than this is not a person; the remainder is claimed
// by the next call. Bounds the read and the single UPDATE.
const CANDIDATE_LIMIT = 200

// Only rows that can still become a relationship. A suspended, terminated or removed ghost is not
// handed to anyone by a claim.
const CLAIMABLE_STATUSES = ["pending", "active"]

export async function claimPartnershipInvitesForEmail(
  service: SupabaseClient,
  params: { email: string; orgId: OrgId }
): Promise<{ ok: true; claimedCount: number } | { ok: false; error: string; code: string | null }> {
  const email = normalizeEmail(params.email)
  if (!email) return { ok: false, error: "No email to claim for", code: null }

  // The pattern only NARROWS the read. The equality filter below is what decides, so a pattern
  // that PostgREST mangles can cost a miss (fail closed) but never an extra claim.
  const { data: candidates, error: readErr } = await service
    .from("partnerships")
    .select("id, partner_email")
    .is("vendor_org_id", null)
    .in("status", CLAIMABLE_STATUSES)
    .ilike("partner_email", `%${escapeLikePattern(email)}%`)
    .limit(CANDIDATE_LIMIT)
  if (readErr) return { ok: false, error: "Failed to read invitations", code: readErr.code ?? null }

  const ids = ((candidates ?? []) as Array<{ id: string; partner_email: string | null }>)
    .filter((row) => normalizeEmail(row.partner_email) === email)
    .map((row) => row.id)
  if (ids.length === 0) return { ok: true, claimedCount: 0 }

  // vendor_org_id IS NULL is asserted again on the write: a row claimed between the read and here
  // is left alone rather than repointed (the trigger would refuse a repoint anyway).
  const { data: claimed, error: writeErr } = await service
    .from("partnerships")
    .update({ vendor_org_id: params.orgId, updated_at: new Date().toISOString() })
    .in("id", ids)
    .is("vendor_org_id", null)
    .select("id")
  if (writeErr) return { ok: false, error: "Failed to claim partnership invitations", code: writeErr.code ?? null }

  return { ok: true, claimedCount: (claimed ?? []).length }
}
