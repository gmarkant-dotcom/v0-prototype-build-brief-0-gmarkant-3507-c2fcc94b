/**
 * Colleague invitations - the shared vocabulary. One place for the things the four routes,
 * the landing page and the team page must agree on, so they cannot drift.
 *
 * NOTHING IN HERE TALKS TO THE DATABASE. It is constants, a token mint, and two mappings
 * from a Postgres error to something a person can read. The routes do the talking.
 *
 * THIS IS THE COLLEAGUE PATH, NOT THE VENDOR PATH. Do not confuse it with the partnership
 * invitation in app/api/partnerships/route.ts, which invites another COMPANY into a
 * commercial relationship and whose call to action is /partner/invitations. This invites a
 * PERSON into your own organization. They are different tables, different emails, different
 * landing pages and different consequences, and the only thing they share is the word.
 */

/**
 * How long a colleague invitation is good for.
 *
 * SEVEN DAYS, and the choice is stated rather than buried because org_invitations.expires_at
 * is NOT NULL WITH NO DEFAULT - migration 086 made that deliberate ("An invitation that never
 * expires is a credential"), so every writer must pick, and if two writers pick differently
 * the product has two answers.
 *
 * Seven and not the magic link's 72 hours: a vendor magic link is a deadline-bearing request
 * to bid on a specific brief and the urgency is the point. Being asked to join your own
 * company's account is not urgent, and it routinely waits for somebody to come back from
 * leave. Seven and not thirty because it is still a bearer credential in an inbox.
 *
 * A lapsed invitation is not a dead end: the create route stamps it 'expired' and issues a
 * fresh one for the same address.
 */
export const INVITATION_TTL_DAYS = 7

/** expires_at for a new invitation, as an ISO string. */
export function invitationExpiresAt(now: number = Date.now()): string {
  return new Date(now + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * The token. 64 lowercase hex characters, 256 bits, no dashes.
 *
 * THE SAME ENTROPY SOURCE AND THE SAME SHAPE AS THE VENDOR MAGIC LINK
 * (app/api/agency/rfp/magic-link/route.ts:197), deliberately. That is the only other bearer
 * credential in this product that arrives by email and is stored in a `text` column, and
 * having two different token shapes for two identical jobs is how one of them ends up
 * weaker than anybody meant.
 *
 * Two randomUUID() calls rather than one because a single UUID is 122 bits of entropy with
 * six of its bits fixed by the version and variant fields, and this string sits in an inbox
 * for a week. Dashes are stripped so the value survives being copied out of an email client
 * that decides to break a line, and needs no encoding in a URL path.
 */
export function mintInvitationToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
}

/** Where the emailed link points. One definition, so the email and the page cannot disagree. */
export function invitationLandingPath(token: string): string {
  return `/join/${encodeURIComponent(token)}`
}

/**
 * The SQLSTATEs migration 089's two functions raise, mapped to HTTP.
 *
 * Class LG is user-defined. PostgREST surfaces the code verbatim as `code` in its JSON error
 * body, which is what these routes read.
 *
 * LG001 IS DELIBERATELY MERGED and its message must stay vague. "No such token" and "that
 * token is not yours" are one refusal with one message, because the difference between them
 * confirms whether a given address was invited to a given organization. Do not "improve"
 * this copy by making it more specific.
 *
 * AN UNRECOGNISED CODE IS 500 AND NOT 400. If a function starts raising something this table
 * does not know about, that is a fault in the product and not in the caller's request, and
 * saying so is how it gets found.
 */
export const INVITATION_ERROR_STATUS: Record<string, number> = {
  LG001: 404,
  LG002: 401,
  LG003: 409,
  LG004: 410,
}

/** User-facing copy per SQLSTATE. Never leaks whether the token exists. */
export const INVITATION_ERROR_MESSAGE: Record<string, string> = {
  LG001: "That invitation could not be found.",
  LG002: "Please sign in to respond to this invitation.",
  LG003: "That invitation is no longer open.",
  LG004: `That invitation has expired. Ask whoever sent it for a new one.`,
}

/** What PostgREST returns when migration 089 has not been applied. */
export const RPC_MISSING_CODE = "PGRST202"

export type InvitationRpcFailure = {
  status: number
  message: string
  /** The raw SQLSTATE, for the server log only. Never returned to a browser. */
  code: string | null
}

/**
 * Turn a PostgREST error from accept_org_invitation / decline_org_invitation into a status
 * and a message.
 *
 * THERE IS NO FALLBACK PATH HERE AND THERE MUST NOT BE ONE. If migration 089 is not applied,
 * this returns 503 and says so out loud. The 082 fallback blocks are this repository's own
 * worked example of the alternative: a fallback that fires silently returns a WRONG ANSWER
 * instead of an error, and nobody finds out for weeks.
 */
export function invitationRpcFailure(error: { code?: string | null; message?: string | null } | null): InvitationRpcFailure {
  const code = error?.code ?? null

  if (code && INVITATION_ERROR_STATUS[code]) {
    return { status: INVITATION_ERROR_STATUS[code], message: INVITATION_ERROR_MESSAGE[code], code }
  }

  if (code === RPC_MISSING_CODE) {
    // Migration 089 is not applied. Loud, specific, and not retried against anything else.
    return {
      status: 503,
      message: "Invitations are not available yet. Please try again shortly.",
      code,
    }
  }

  return { status: 500, message: "Could not respond to that invitation. Please retry.", code }
}

/** Postgres unique_violation. The partial index that admits one pending invite per address. */
export const UNIQUE_VIOLATION = "23505"

/** The partial unique index migration 086 created on (org_id, lower(email)) WHERE pending. */
export const ONE_LIVE_PER_EMAIL_INDEX = "org_invitations_one_live_per_email"

/** Postgres insufficient_privilege. What an RLS refusal looks like through PostgREST. */
export const RLS_REFUSED = "42501"

/**
 * Email comparison, migration 087's convention, reproduced on the TypeScript side so the two
 * halves of this feature agree about what "the same address" means.
 *
 * lower(btrim(x)) on BOTH sides, and false if either side is empty. The database compares
 * exactly this way in the invitee SELECT policy and inside both RPC functions; a route that
 * compared differently would show somebody a row the database would then refuse to act on.
 */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim().toLowerCase()
  const right = (b ?? "").trim().toLowerCase()
  if (!left || !right) return false
  return left === right
}

/** The three roles an invitation may carry. Identical to org_members.role's CHECK. */
export const INVITABLE_ROLES = ["owner", "admin", "member"] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export function isInvitableRole(value: unknown): value is InvitableRole {
  return typeof value === "string" && (INVITABLE_ROLES as readonly string[]).includes(value)
}

export const ROLE_LABEL: Record<InvitableRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

/** Statuses org_invitations.status may hold after migration 089. */
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired" | "declined"

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
  declined: "Declined",
}
