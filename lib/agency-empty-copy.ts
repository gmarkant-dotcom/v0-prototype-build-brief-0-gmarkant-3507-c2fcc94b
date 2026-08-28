/**
 * Empty-state copy for the agency surfaces, and the predicate that decides which one to show.
 *
 * ---------------------------------------------------------------------------
 * THE MIRROR OF lib/vendor-empty-copy.ts, FOR THE OTHER PORTAL.
 *
 * That file was written on 2026-08-21 for the vendor surfaces and states the rule this one
 * inherits: **a list that is empty because nothing exists and a list that is empty because a
 * filter excluded everything look identical, and the reader cannot tell which one they are
 * looking at.** The 086 roster precedent is the same idea said once - "You are the only
 * person on this team" rather than rendering one row and looking correct.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS ACTUALLY WRONG ON THE AGENCY SIDE, WHICH IS THE OPPOSITE FAILURE.
 *
 * The vendor surfaces said nothing at all. The agency surfaces said something, and what they
 * said was the FILTERED explanation, UNCONDITIONALLY:
 *
 *   /agency/pool  "No active vendors match your search or filters."
 *                 "No invited contacts match your search."
 *                 "No discovered contacts match your search."
 *
 * All three render whether or not a search or filter is active. An agency that has just
 * signed up, has never invited anybody, and has typed nothing into the search box is told
 * that their search matched nothing. That is false twice over: there is no search, and there
 * is nothing for one to exclude. It also points them at the one control that cannot help,
 * and hides the thing they actually need to know, which is that the pool is empty because
 * they have not filled it yet.
 *
 * A message that is only true when a filter is active must be CONDITIONAL ON A FILTER BEING
 * ACTIVE. That is the whole of what this file provides.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE.
 *
 * NO COPY FOR /agency/payments, AND STILL NONE AFTER THE 2026-08-25 CORRECTION.
 * Stage06Payments used to render an EmptyState reading "Payment milestones and vendor
 * invoices will appear here once contracts are executed and projects are underway", which
 * was FALSE: components/stages/stage-06-payments.tsx:97-99 assign `isDemo ? demo... : []`
 * and there is no fetch anywhere in the component, so nothing would ever appear there no
 * matter what the agency did. That sentence has been replaced in place with one that says
 * the page is not built. It is deliberately NOT routed through this file: everything here
 * answers "empty, and here is which kind of empty", and that page is not empty, it is
 * absent. Giving an unbuilt surface a well-formed empty state from the shared vocabulary is
 * how it stops looking unbuilt.
 *
 * NO COPY FOR THE AGENCY DASHBOARD'S ATTENTION QUEUE. An empty attention queue is a good
 * state, it already reads as one ("You're all caught up."), and it was ruled out of scope.
 *
 * NO MIGRATION NUMBERS, NO TABLE NAMES, NO POLICY NAMES. The 086 header records why: a
 * customer cannot act on any of them. Same rule as the vendor file.
 *
 * NO EM DASHES. House rule, and every string here is user-facing.
 */

/**
 * Is any narrowing control currently active?
 *
 * Pass every search string and every filter selection that feeds the list. A filter is
 * considered active when its value is neither the empty string nor the literal "All", which
 * is the sentinel every filter on /agency/pool uses for "no restriction"
 * (app/agency/pool/page.tsx:318-330).
 *
 * WHY A HELPER RATHER THAN THE CONDITION INLINE. The network list on /agency/pool narrows on
 * SIX independent controls. Written inline at the call site, the next person to add a
 * seventh filter has to remember to extend a boolean expression buried in JSX, and forgetting
 * reintroduces exactly the defect this file exists to close - silently, and only for the
 * users who have that one filter set.
 */
export function anyFilterActive(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => {
    if (v == null) return false
    const trimmed = v.trim()
    return trimmed !== "" && trimmed !== "All"
  })
}

/**
 * The three /agency/pool sections.
 *
 * `filtered` is the existing copy, kept verbatim so a genuinely filtered list reads exactly
 * as it does today. `empty` is the new sentence, and it says what is true of a pool nobody
 * has filled yet: what the section holds, and what puts something in it.
 */
export const POOL_NETWORK_EMPTY = {
  filtered: "No active vendors match your search or filters.",
  empty:
    "No vendors are in your network yet. A vendor moves here once they accept an invitation, and you can then send them RFPs directly.",
} as const

/**
 * M4: the colleague filter's own empty state.
 *
 * SEPARATE FROM `POOL_NETWORK_EMPTY.filtered` BECAUSE IT ANSWERS A DIFFERENT QUESTION.
 * "No active vendors match your search or filters" points at the controls; when the colleague
 * filter is the reason the list is empty, the controls are not the problem and nothing about
 * them will help. What the reader needs to know is that this person has no recorded connection
 * to any vendor yet, and what would create one.
 *
 * THE TWO CASES ARE NOT THE SAME AND ARE NOT MERGED. `vendorCount` is what the API measured
 * for this colleague BEFORE any other filter ran, so zero means "connected to nobody" and
 * anything else means "connected to somebody, and your other filters excluded them". Saying
 * the first when the second is true is how the 086 precedent describes a lie.
 *
 * Markant's own organization has two project_leads rows and no partnership_owners rows, so on
 * live data today the zero case is the one almost every colleague hits.
 */
export function poolColleagueEmpty(name: string, isYou: boolean, vendorCount: number): string {
  const who = isYou ? "you" : name
  if (vendorCount > 0) {
    return `No vendors connected to ${who} match your other search or filters.`
  }
  return isYou
    ? "No vendors are connected to you yet. A vendor is connected once you are the point person or a contributor on a project they were awarded, or once you are recorded as owning the relationship."
    : `No vendors are connected to ${name} yet. A vendor is connected once they are the point person or a contributor on a project that vendor was awarded, or once they are recorded as owning the relationship.`
}

export const POOL_INVITED_EMPTY = {
  filtered: "No invited contacts match your search.",
  empty:
    "You have not invited anyone yet. Contacts you invite stay here until they accept, and then move to your network.",
} as const

export const POOL_DISCOVERED_EMPTY = {
  filtered: "No discovered contacts match your search.",
  empty:
    "No contacts have been added to your pool yet. Contacts you add or import stay here until you invite them to your network.",
} as const

/**
 * The "Client documents" shelf in the Master Documents library.
 *
 * This section used to be hidden outright when no client had a document
 * (components/agency-document-library-manager.tsx). Hiding it is the quietest version of the
 * same problem: the shelf exists, the feature exists, and an agency looking for somewhere to
 * put a client's paperwork has no way to learn either. The named slot grids above it always
 * render and say "No document on file." in every empty slot, so this is also the only part
 * of that page that behaved differently from the rest of it.
 */
export const LIBRARY_CLIENT_DOCS_EMPTY =
  "No client documents yet. Documents attached to a client profile appear here, and apply to RFPs and engagements for that client only."
