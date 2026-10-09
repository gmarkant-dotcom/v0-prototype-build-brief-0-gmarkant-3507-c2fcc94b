import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { resolveAgencyGate, type OrgLookupClient } from "@/lib/entitlements"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type Profile = {
  role: string | null
  active_role: string | null
  is_admin: boolean | null
}

export type AuthSuccess = { authorized: true; user: User; supabase: SupabaseServerClient }
export type AuthFailure = { authorized: false; response: NextResponse }
export type AuthResult = AuthSuccess | AuthFailure

export type RoleAuthSuccess = { authorized: true; user: User; supabase: SupabaseServerClient; profile: Profile }
export type RoleAuthResult = RoleAuthSuccess | AuthFailure

/**
 * Session check only - no role check. Every route in this codebase authenticates via the
 * cookie-scoped server client (createClient() from lib/supabase/server.ts reads cookies
 * through next/headers), never by parsing the Request object itself, so `request` is
 * accepted but unused - kept so call sites can pass their handler's request/NextRequest
 * without a type error if they have one at hand.
 *
 * Usage: `const auth = await requireAuth(); if (!auth.authorized) return auth.response`
 */
export async function requireAuth(_request?: Request): Promise<AuthResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { authorized: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  return { authorized: true, user, supabase }
}

async function requireRole(requiredRole: "agency" | "partner", forbiddenMessage: string): Promise<RoleAuthResult> {
  const auth = await requireAuth()
  if (!auth.authorized) return auth

  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role, active_role, is_admin")
    .eq("id", auth.user.id)
    .maybeSingle()

  // Dual-role pattern (LIGAMENT_CONTEXT.md P12): a dual-role user's base `role` never
  // changes, only `active_role` flips when they switch portals - so both must be checked,
  // never just `role` alone, or a partner-primary user active as agency (or vice versa)
  // gets wrongly locked out of the portal they're currently using.
  if (profile?.role !== requiredRole && profile?.active_role !== requiredRole) {
    return { authorized: false, response: NextResponse.json({ error: forbiddenMessage }, { status: 403 }) }
  }

  return { authorized: true, user: auth.user, supabase: auth.supabase, profile: profile as Profile }
}

/**
 * G1, THE AGENCY GATE FOR API ROUTES (owner ruling, 2026-10-09).
 *
 * The caller's ACTIVE organization must be a lead agency AND paid
 * (organizations.is_lead_agency AND organizations.is_paid), resolved from the session by
 * resolveAgencyGate() in lib/entitlements.ts. role / active_role / secondary_role are NOT
 * read: until migration 113 a vendor can write them from a browser. The middleware skips
 * /api, so every agency route calls this itself.
 *
 * Refusal: 402 with a stable body, `code: "agency_entitlement_required"` and
 * `reason: "not_lead_agency" | "not_paid"`. A lookup FAULT (database error, missing org
 * row) is 500 `code: "agency_entitlement_unavailable"`, so a transient failure is never
 * presented to a paying customer as "upgrade".
 *
 * Returns null when the caller may proceed.
 */
export const AGENCY_ENTITLEMENT_REQUIRED = "agency_entitlement_required" as const

export type AgencyGateRefusal = {
  status: 402 | 500
  body: { error: string; code: string; reason?: "not_lead_agency" | "not_paid" | "entitled" }
}

/** The refusal as plain data, for route-local helpers that build their own response. Null = proceed. */
export async function agencyGateRefusal(userId: string, supabase: OrgLookupClient): Promise<AgencyGateRefusal | null> {
  const decision = await resolveAgencyGate(userId, supabase)
  if (decision.entitled) return null
  if (decision.fault) {
    return {
      status: 500,
      body: { error: "We could not confirm your company's access. Please try again.", code: "agency_entitlement_unavailable" },
    }
  }
  return {
    status: 402,
    body: { error: "Agency access requires a paid lead-agency account.", code: AGENCY_ENTITLEMENT_REQUIRED, reason: decision.gate },
  }
}

export async function agencyGateResponse(userId: string, supabase: OrgLookupClient): Promise<NextResponse | null> {
  const refusal = await agencyGateRefusal(userId, supabase)
  return refusal ? NextResponse.json(refusal.body, { status: refusal.status }) : null
}

/**
 * Session check plus G1. Usage:
 * `const auth = await requireAgencyEntitlement(); if (!auth.authorized) return auth.response`
 *
 * `profile` is still returned for callers that read it for display; it decides nothing.
 */
export async function requireAgencyEntitlement(_request?: Request): Promise<RoleAuthResult> {
  const auth = await requireAuth()
  if (!auth.authorized) return auth

  const refused = await agencyGateResponse(auth.user.id, auth.supabase)
  if (refused) return { authorized: false, response: refused }

  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role, active_role, is_admin")
    .eq("id", auth.user.id)
    .maybeSingle()

  return { authorized: true, user: auth.user, supabase: auth.supabase, profile: (profile ?? { role: null, active_role: null, is_admin: null }) as Profile }
}

/**
 * KEPT AS AN ALIAS SO THE 18 IMPORTERS DID NOT CHANGE. It used to admit
 * `role === 'agency' || active_role === 'agency'`, which any vendor could set on itself.
 * It is now exactly requireAgencyEntitlement().
 */
export async function requireAgencyRole(_request?: Request): Promise<RoleAuthResult> {
  return requireAgencyEntitlement()
}

/** Usage: `const auth = await requirePartnerRole(); if (!auth.authorized) return auth.response` */
export async function requirePartnerRole(_request?: Request): Promise<RoleAuthResult> {
  return requireRole("partner", "Vendors only")
}

/**
 * The single authorization gate for every human-invoked /api/admin/* route. Checks
 * profiles.is_admin and nothing else - no hardcoded email may appear in an authorization
 * path. Superseded the OWNER_EMAIL === user.email checks that previously gated
 * app/api/admin/users and app/api/admin/grant-agency-access; see
 * docs/admin-security-fix-report.md for the accounts that change access as a result.
 *
 * The is_admin read deliberately uses the caller's own cookie-scoped session client, never
 * the service role. A check performed with a key that bypasses row level security is not a
 * check: it would read is_admin for an arbitrary id regardless of whether the caller may
 * see that row, so the gate has to sit inside the same trust boundary it is protecting.
 *
 * Failure bodies are deliberately terse and identical in shape ("Unauthorized" / a bare
 * "Forbidden" rather than "Admin only"), so an unauthenticated prober cannot use the
 * response text to tell an admin route that exists from one that does not.
 *
 * Routes with a NON-HUMAN caller must not use this - a webhook or auth-hook caller has no
 * session and would get a silent 401. app/api/admin/notify-new-user is the live example:
 * it is invoked by a Supabase DB webhook and is protected by a WEBHOOK_SECRET header
 * instead.
 */
export async function requireAdminRole(_request?: Request): Promise<RoleAuthResult> {
  const auth = await requireAuth()
  if (!auth.authorized) return auth

  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role, active_role, is_admin")
    .eq("id", auth.user.id)
    .maybeSingle()

  if (!profile?.is_admin) {
    return { authorized: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  return { authorized: true, user: auth.user, supabase: auth.supabase, profile: profile as Profile }
}
