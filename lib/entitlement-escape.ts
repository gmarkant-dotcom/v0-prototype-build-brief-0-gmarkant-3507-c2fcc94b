/**
 * THE ESCAPE ROUTE. The one place the lockout's exemption is defined.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LOCKOUT IS, SO THE EXEMPTION IS READ AGAINST IT
 *
 * Migration 092 makes entitlement a fact about the ORGANIZATION. Before it, `is_paid` was
 * a boolean on one profile, flipped by an admin, and its effect was per person. After it,
 * a company going unpaid is EVERY MEMBER'S PROBLEM SIMULTANEOUSLY - a different product
 * event even though it is the same boolean.
 *
 * GREG'S RULING (R5): when a company is unpaid, EVERYONE IN THE ORGANIZATION IS LOCKED
 * OUT. No owner-retains-access carve-out. No read-only tier. The data is intact and
 * nothing is deleted; the product is simply not available.
 *
 * ---------------------------------------------------------------------------
 * WHY AN EXEMPTION EXISTS AT ALL (R6)
 *
 * A GATE THAT BLOCKS THE PERSON WHO HAS TO PAY IS A TRAP. With
 * AgencySubscriptionGate wrapping the entire agency layout, an unpaid organization's owner
 * cannot reach ANY /agency page - including whatever page tells them how to fix it. So a
 * small, named set of routes stays reachable, and ONLY for owner and admin, who are the
 * roles the ruling gives billing rights to.
 *
 * A PLAIN MEMBER OF A LAPSED COMPANY HITS THE WALL ON EVERY ROUTE INCLUDING THESE. That is
 * deliberate and it is half of R6: a member cannot fix this, so an interface that lets them
 * walk to a billing page and find nothing they can do is worse than one that tells them who
 * can.
 *
 * ---------------------------------------------------------------------------
 * THE SET, AND THE JUSTIFICATION FOR EVERY ENTRY. IT IS ONE ENTRY.
 *
 *   /agency/settings/billing
 *
 *     WHY IT IS IN: it is the only page that tells a locked-out owner what has happened
 *     and how to restore access. Without it the exemption has nowhere to land and the
 *     ruling's escape route does not exist.
 *
 *     WHY IT IS THE ONLY ENTRY: every other /agency route is the product, and letting a
 *     lapsed company use the product is the thing R5 rules out. "Small" is doing real work
 *     in R6 - each additional entry is a piece of the product handed to a company that is
 *     not paying for it, and the argument for the second entry is always easier to make
 *     than the argument for the first.
 *
 * THERE IS NO BILLING PROVIDER IN THIS CODEBASE - no dependency, no webhook route, no
 * customer id column, established by grep at 091 and unchanged. So the page this exemption
 * lands on states the situation and carries contact details. IT BECOMES THE REAL BILLING
 * SCREEN when a provider exists, at which point the exemption already points at the right
 * route and nothing here changes.
 *
 * >>> THE EXEMPTION IS LIVE AND DOES REAL WORK. It is not a placeholder and not a check
 * >>> that cannot fire: a lapsed owner reaching /agency/settings/billing renders the page,
 * >>> and a lapsed member reaching the same URL gets the wall. Both branches are
 * >>> exercised by the two roles that exist.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * IT IS NOT A SERVER-SIDE AUTHORIZATION BOUNDARY AND MUST NOT BE MISTAKEN FOR ONE. It
 * governs which PAGE renders behind a client-side gate. Every API route makes its own
 * decision through lib/entitlements.ts and none of them consults this file. A lapsed owner
 * on the billing page can no more create a project than a lapsed member can - the route
 * would 403 them, because that gate reads organizations.is_paid and knows nothing about
 * pathnames.
 *
 * IT DOES NOT TOUCH middleware.ts. Middleware decides auth and portal; entitlement is not
 * its question and putting it there would mean a database read on every request.
 */

/**
 * Org roles that may manage billing. THE RULING (R2): owner and admin may change the plan;
 * a plain member uses the product without billing rights.
 *
 * Note what this is NOT keyed on: `profiles.role`, which names the PORTAL. An organization
 * role and a portal role are different facts and conflating them is how a member would end
 * up with billing rights.
 */
const BILLING_ROLES = new Set(["owner", "admin"])

/**
 * The routes a locked-out billing manager may still reach. Prefix match, so the page's own
 * subpaths come with it and nothing else does.
 */
export const ENTITLEMENT_ESCAPE_ROUTES = ["/agency/settings/billing"] as const

/** Where the wall sends an owner or admin. The single entry above, named once. */
export const ENTITLEMENT_ESCAPE_HREF = ENTITLEMENT_ESCAPE_ROUTES[0]

/**
 * May this person do something about a lapsed subscription?
 *
 * NULL IS TREATED AS "NO". An unresolved organization role must not grant billing rights -
 * that is the conservative direction, and it is the only one that is safe when the reason
 * the role did not resolve is that the organization itself did not.
 */
export function mayManageBilling(orgRole: string | null | undefined): boolean {
  return typeof orgRole === "string" && BILLING_ROLES.has(orgRole)
}

/**
 * Is this pathname one of the escape routes?
 *
 * Prefix match with a boundary check, so `/agency/settings/billing-history` does NOT match
 * `/agency/settings/billing`. A sloppy startsWith here would silently widen the exemption
 * every time somebody named a new route with a shared prefix.
 */
export function isEntitlementEscapeRoute(pathname: string | null | undefined): boolean {
  if (typeof pathname !== "string" || pathname.length === 0) return false
  return ENTITLEMENT_ESCAPE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  )
}
