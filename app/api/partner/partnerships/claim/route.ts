import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { requireAuth } from "@/lib/api-auth"
import { resolveCallerWriteOrgId } from "@/lib/entitlements"
import { claimPartnershipInvitesForEmail, normalizeEmail } from "@/lib/server/claim-partnership-invites"

export const dynamic = "force-dynamic"

/**
 * THE SERVICE-ROLE CLAIM ENDPOINT (Greg's ruling, 2026-10-08).
 *
 * Links every unclaimed partnership invitation addressed to the CALLER'S OWN verified email to
 * the CALLER'S OWN organization. It exists because no user session can do this: an unclaimed
 * row is visible to neither organization, so the UPDATE matches zero rows under any claim
 * policy (docs/claim-visibility-rulings.md). The alternative, an email-keyed SELECT policy, would
 * hand an invitee the lead agency's private notes before they accept anything, and the ruling
 * is that a partner agency must not see them.
 *
 * THIS ROUTE ACCEPTS NO INPUT. It reads no body, no query string and no header. There is no
 * email, profile id, organization id or partnership id for a caller to supply, so there is
 * nothing for a caller to forge:
 *
 *   OWNERSHIP PROOF  the email is user.email from supabase.auth.getUser(), which validates the
 *                    session token with the auth server on every call. It is not profiles.email
 *                    (a table row the user can edit, guarded only by trigger 091) and not
 *                    anything in the request. It must also be CONFIRMED (email_confirmed_at):
 *                    an unconfirmed address is a claim of ownership, not a proof of it.
 *   CLAIMANT         resolveCallerWriteOrgId(), the caller's own acting organization. It takes no
 *                    candidate and fails closed with null. This replaces agencyEntitlementId(),
 *                    whose userId fallback is a value that raises 23503 for every account made
 *                    after 079 or, worse, is accidentally valid for the sixteen that were backfilled.
 *   MATCH            equality on lower(btrim()) in application code, with the LIKE read only
 *                    narrowing the candidates. This replaces an unescaped ilike, which let "_" and
 *                    "%" in an address act as wildcards (the hole 093 closed for the policy).
 *
 * RESPONSE: { success, claimedCount }. Never a row, an id, an organization or any part of
 * partnership_notes. The count concerns only the caller's own address.
 *
 * THIS DOES NOT ACCEPT ANYTHING. status is untouched, so a claimed invitation is still pending
 * and the vendor still has to accept it.
 *
 * ABUSE, STATED PLAINLY. See docs/client-required-and-spine-report.md phase 3: there is no rate
 * limit here or anywhere in this application. The call is idempotent (a claimed row is no longer a
 * candidate), costs one indexed read in the steady state, and writes only for rows addressed to the
 * session's own confirmed email. A thief of a session can do nothing here that the session's owner
 * could not.
 *
 * KNOWN, NOT FIXED HERE: this claims EVERY unclaimed row addressed to the email, so the first
 * member of a vendor organization to sign in takes them all. 079 opened that and it is a product
 * ruling (is an invitation addressed to a person or a company), not a rename.
 */
export async function POST() {
  const route = "/api/partner/partnerships/claim"
  const auth = await requireAuth()
  if (!auth.authorized) return auth.response
  const { user, supabase } = auth

  const email = normalizeEmail(user.email)
  if (!email) {
    return NextResponse.json({ error: "No email on this account" }, { status: 400 })
  }
  if (!user.email_confirmed_at) {
    return NextResponse.json({ error: "Confirm your email address first" }, { status: 403 })
  }

  const orgId = await resolveCallerWriteOrgId(user.id, supabase)
  if (!orgId) {
    return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403 })
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[api] failure", { route, method: "POST", message: "Missing Supabase service configuration" })
    return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
  }
  // The service role is used for ONE thing: reading and linking rows the session cannot see. The
  // identity and the organization above came from the session, before this client exists.
  const service = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const result = await claimPartnershipInvitesForEmail(service, { email, orgId })
  if (!result.ok) {
    console.error("[api] failure", { route, method: "POST", userId: user.id, code: result.code, message: result.error })
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  // The count and the caller only. Never the address, and never a row.
  console.log("[api] success", { route, method: "POST", userId: user.id, claimedCount: result.claimedCount })
  return NextResponse.json({ success: true, claimedCount: result.claimedCount })
}
