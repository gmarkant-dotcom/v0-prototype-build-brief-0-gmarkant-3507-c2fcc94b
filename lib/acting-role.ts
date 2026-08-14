/**
 * The one definition of "which portal is this user operating in right now".
 *
 * `profiles.role` is the role chosen at signup and it never changes afterwards. It is an
 * account fact. `profiles.active_role` is the portal the user is currently in, flipped by
 * POST /api/profile/switch-role (which also grants secondary_role when needed) and read by
 * middleware.ts to decide whether /agency or /partner is reachable. It is a session fact.
 *
 * Any route that asks "am I serving the agency side or the vendor side of this response"
 * is asking the session question, so it must read active_role. Reading `role` there serves
 * a dual-role user the wrong half of the handler: migration 056 wrote role='agency' onto
 * every account regardless of what the signup metadata said, so a vendor operating in the
 * vendor portal carries role='agency' and was being handed the agency branch. That is the
 * defect diagnosed in docs/invitation-diagnosis.md, section 0.6.
 *
 * Fallback, stated explicitly rather than left to `undefined` landing in an else branch:
 * active_role decides whenever it holds a recognized value. `role` is consulted ONLY when
 * active_role is genuinely unset (null, absent, or empty). An unrecognized value in either
 * column resolves to null rather than being coerced into a portal.
 *
 * This does not replace an authorization check. It answers "which side", never "may they".
 * Entitlement to the agency portal is enforced by switch-role and by requireAgencyRole in
 * lib/api-auth.ts, both of which still consult role/secondary_role/is_admin.
 */
export type ActingRole = "agency" | "partner"

type RoleBearingProfile = {
  role?: string | null
  active_role?: string | null
} | null | undefined

function normalize(value: string | null | undefined): ActingRole | null {
  if (typeof value !== "string") return null
  const v = value.trim().toLowerCase()
  return v === "agency" || v === "partner" ? v : null
}

/** Returns the portal the caller is acting in, or null when neither column resolves. */
export function actingRole(profile: RoleBearingProfile): ActingRole | null {
  if (!profile) return null
  const active = normalize(profile.active_role)
  if (active) return active
  return normalize(profile.role)
}

/**
 * True when the caller is operating the lead agency side. Callers that branch agency/vendor
 * should test this and let everything else fall to the vendor branch, which is the branch
 * that only ever returns rows keyed to the caller's own id or email.
 */
export function isActingAsAgency(profile: RoleBearingProfile): boolean {
  return actingRole(profile) === "agency"
}

/** True when the caller is operating the vendor side. */
export function isActingAsPartner(profile: RoleBearingProfile): boolean {
  return actingRole(profile) === "partner"
}

/**
 * Portal-entitlement gate for routes that serve exactly one side. Mirrors the OR-widening
 * already applied by requireRole() in lib/api-auth.ts: a dual-role user's base `role` never
 * changes, so a route that tests `role !== 'agency'` alone locks out the very accounts
 * migration 056 created. Deliberately permissive on purpose - it grants the portal to
 * whichever column names it, because active_role can only be set to 'agency' by
 * /api/profile/switch-role, which checks entitlement before writing it.
 */
export function canActAs(profile: RoleBearingProfile, required: ActingRole): boolean {
  if (!profile) return false
  return normalize(profile.role) === required || normalize(profile.active_role) === required
}
