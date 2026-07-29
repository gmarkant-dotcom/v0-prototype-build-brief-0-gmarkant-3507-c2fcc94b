import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

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

/** Usage: `const auth = await requireAgencyRole(); if (!auth.authorized) return auth.response` */
export async function requireAgencyRole(_request?: Request): Promise<RoleAuthResult> {
  return requireRole("agency", "Agency only")
}

/** Usage: `const auth = await requirePartnerRole(); if (!auth.authorized) return auth.response` */
export async function requirePartnerRole(_request?: Request): Promise<RoleAuthResult> {
  return requireRole("partner", "Partners only")
}

/**
 * Checks profiles.is_admin. Note: the real /api/admin/* routes in this codebase (e.g.
 * app/api/admin/users/route.ts) do NOT use is_admin today - they gate on a hardcoded
 * OWNER_EMAIL match against user.email instead, and is_admin is otherwise only read as a
 * paid-feature-access bypass alongside is_paid, never as a standalone route gate. This
 * helper is provided per spec for future admin routes that want a real is_admin check,
 * but swapping it into the existing OWNER_EMAIL-gated routes would be a genuine
 * authorization behavior change, not a refactor - not done here, see session report.
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
    return { authorized: false, response: NextResponse.json({ error: "Admin only" }, { status: 403 }) }
  }

  return { authorized: true, user: auth.user, supabase: auth.supabase, profile: profile as Profile }
}
