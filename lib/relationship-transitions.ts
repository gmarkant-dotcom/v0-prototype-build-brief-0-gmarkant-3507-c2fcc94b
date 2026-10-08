/**
 * The three acts an agency can perform on an ESTABLISHED partnership, and which prior states
 * each is allowed from. One definition, used by PATCH /api/partnerships and by the pool page,
 * so the button the interface offers and the transition the route accepts cannot drift.
 *
 * WHAT THIS IS NOT. It is not revocation. None of these acts changes what a vendor can read:
 * no policy on a delivery table filters on partnerships.status, and this run authors no
 * migration. docs/relationship-end-rulings.md rulings 5 and 6 are the revocation work and
 * belong to the migration session. Nothing here may be read as, or worded as, access control.
 *
 * PRIOR STATES, AND WHY EACH LINE IS WHERE IT IS
 *
 *   suspend    from active only. A pause on a relationship that was never live is meaningless,
 *              and 'suspended' written onto a pending or removed row would put an unaccepted
 *              invitation into the network column badged as a pause.
 *   terminate  from active or suspended. Suspend-now-terminate-later is the intended path
 *              (ruling 5), so a suspended row must be endable.
 *   reinstate  from suspended always; from terminated ONLY if the row was ever a live
 *              relationship. A vendor's own decline of an invitation also writes 'terminated'
 *              (app/api/partnerships/route.ts, the decline branch), and `status` alone cannot
 *              tell the two apart. Reinstating a declined invitation would activate a
 *              relationship the vendor refused, with no acceptance. `wasLive` is the
 *              discriminator the caller supplies: accepted_at is set, or the partnership has
 *              at least one project assignment.
 */

export type RelationshipAct = "suspend" | "terminate" | "reinstate"

export type RelationshipTransition =
  | { ok: true; act: RelationshipAct; noop: boolean }
  | { ok: false; act: RelationshipAct; error: string }

/**
 * Which act, if any, a requested status write is. Returns null for writes that are not one of
 * the three (accept, decline, remove, and the legacy agency 'active' on a pending row), so the
 * caller leaves those on their existing paths unchanged.
 */
export function relationshipActFor(
  priorStatus: string | null | undefined,
  nextStatus: string
): RelationshipAct | null {
  if (nextStatus === "suspended") return "suspend"
  if (nextStatus === "terminated") return "terminate"
  if (nextStatus === "active" && (priorStatus === "suspended" || priorStatus === "terminated")) {
    return "reinstate"
  }
  return null
}

export function checkRelationshipTransition(
  act: RelationshipAct,
  priorStatus: string | null | undefined,
  wasLive: boolean
): RelationshipTransition {
  const prior = priorStatus ?? ""

  if (act === "suspend") {
    if (prior === "suspended") return { ok: true, act, noop: true }
    if (prior === "active") return { ok: true, act, noop: false }
    return { ok: false, act, error: "Only an active partnership can be suspended." }
  }

  if (act === "terminate") {
    if (prior === "terminated") return { ok: true, act, noop: true }
    if (prior === "active" || prior === "suspended") return { ok: true, act, noop: false }
    return { ok: false, act, error: "Only an active or suspended partnership can be terminated." }
  }

  // reinstate. A row that is already active is not routed here (relationshipActFor needs a
  // suspended or terminated prior), so a repeated reinstate is the plain 'active' -> 'active'
  // write the caller treats as a no-op itself.
  if (prior === "suspended") return { ok: true, act, noop: false }
  if (prior === "terminated") {
    if (wasLive) return { ok: true, act, noop: false }
    return {
      ok: false,
      act,
      error:
        "This partnership ended when the vendor declined your invitation, so it cannot be reinstated. Send a new invitation instead.",
    }
  }
  return { ok: false, act, error: "Only a suspended or terminated partnership can be reinstated." }
}

/** The status each act writes. */
export function statusForAct(act: RelationshipAct): "suspended" | "terminated" | "active" {
  return act === "suspend" ? "suspended" : act === "terminate" ? "terminated" : "active"
}
