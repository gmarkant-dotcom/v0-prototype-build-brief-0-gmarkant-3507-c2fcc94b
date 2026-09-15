/**
 * WHERE A NOTIFICATION GOES WHEN IT IS CLICKED, KEYED ON (TYPE, PAYLOAD, VIEWER SIDE).
 *
 * The full derivation is docs/100-phase0-baseline.md section 5. The short version of why this
 * file exists at all:
 *
 *   1. THE STORED `link` THROWS THE IDENTIFIER AWAY. `notifyBidSubmitted` writes
 *      `data: { responseId, ... }` and `link: '/agency/bids'` in the same call. The row knows
 *      which bid it is about and the URL does not. That is the defect this run exists to fix,
 *      and it cannot be fixed at the write site without a backfill: every row already in the
 *      table carries the coarse link. Resolving at READ time repairs the rows that exist.
 *
 *   2. THE STORED `link` IS PORTAL-SPECIFIC AND THE BELL IS NOT. One component renders in both
 *      portals (components/notification-bell.tsx, mounted from agency-layout and
 *      partner-layout) and filters by neither: the endpoint scopes on `user_id = auth.uid()`
 *      alone. A user who holds both roles - one organization can be `is_lead_agency` in one
 *      partnership and `is_vendor` in another - therefore sees vendor rows while standing in
 *      the agency portal. Pushing the other portal's URL gets middleware.ts:123-133 to redirect
 *      them to their own portal's HOME, silently, destination discarded. A mapping from type to
 *      one URL cannot express that. This one is keyed on the side as well.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE IS AN AUTHORIZATION DECISION, AND THAT IS DELIBERATE.
 *
 * THE IDENTIFIER ON A NOTIFICATION IS A CLAIM, NOT A GRANT. This module turns a claim into a
 * URL. Every destination re-verifies on load against the caller's own organization, and none of
 * them trusts the URL:
 *
 *   /agency/bids?response=   matched against the list from /api/agency/rfp-responses, which
 *                            resolves resolveCallerOrgIds() and filters .in("lead_org_id", ...).
 *                            An id outside that list matches nothing. No fetch by id exists.
 *   /partner/rfps/{id}       /api/partner/rfps/[id] resolves resolveCallerOrgIds() and runs
 *                            partnerCanAccessPartnerRfpInbox(); refused and missing are both 404.
 *   /partner/projects/{id}   /api/partner/projects/[id]/active-engagement resolves
 *                            resolveCallerOrgIds() and reaches assignments only through
 *                            partnerships .in("vendor_org_id", callerOrgIds); refused and
 *                            missing are both {found:false}.
 *
 * So a hand-edited URL is refused by the destination exactly as it is today, whether or not a
 * notification ever pointed at it. This module cannot widen anything because it reads nothing.
 */

export type NotificationViewerSide = "agency" | "vendor"

/** The shape the bell already holds. Deliberately structural, so nothing has to be imported. */
export type RoutableNotification = {
  type: string | null
  link: string | null
  data?: unknown
}

/**
 * The portal each side may navigate within. This is the whole of the (type, viewer side)
 * keying, expressed once.
 *
 * IT IS A STRUCTURAL RULE AND NOT A TABLE OF 26 ENTRIES, on purpose. Eleven of the 26 cells in
 * the Phase 0 table are "this row belongs to the other portal". Writing those out one per type
 * means eleven chances to get one wrong, and a wrong one is invisible: it looks like a working
 * link until someone in the other portal clicks it. Deriving them from the destination's own
 * prefix means a new type added later is covered before anyone thinks about it.
 */
const PORTAL_PREFIX: Record<NotificationViewerSide, string> = {
  agency: "/agency",
  vendor: "/partner",
}

/**
 * A string identifier off the `data` jsonb, or null.
 *
 * THE UUID TEST IS NOT DECORATION. docs/100-phase0-baseline.md finding F3: `project_assignment`
 * is written by two sites with two different payload shapes, one carrying `inboxId` and the
 * other `projectId`, and neither carries the other's key. Reading the wrong one yields
 * `undefined`, and template-interpolating that produces `/partner/rfps/undefined` - a URL that
 * looks routed, navigates, and 404s. That failure is silent in exactly the way this project
 * keeps getting bitten by, so a value that is not an id is treated as an absent id and the row
 * falls back to its list destination instead.
 *
 * Every identifier in play is a Postgres uuid (partner_rfp_responses.id, partner_rfp_inbox.id,
 * projects.id), so the shape test costs nothing real.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readId(data: unknown, key: string): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>)[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return UUID.test(trimmed) ? trimmed : null
}

/**
 * Is this a same-origin app path we are willing to push?
 *
 * Reached only by the stored-`link` fallback below, which is the one branch whose value this
 * module did not construct. `//host` is a protocol-relative absolute URL and reads as a path
 * to a careless check, so the second test is not redundant with the first.
 */
function isAppPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//")
}

/**
 * The destination before the portal gate. Null means "this type has no destination at all",
 * which is distinct from "this type's destination is in the other portal".
 */
function candidateDestination(n: RoutableNotification): string | null {
  const type = (n.type || "").trim()

  switch (type) {
    // ── Vendor-addressed ────────────────────────────────────────────────────

    case "partnership_invitation":
      // /partner/invitations is a redirect stub to /partner/network, whose activeTab defaults
      // to "my-agencies" - so the unparameterised link lands the vendor on a tab that is not
      // the one holding the invitation. F10.
      return "/partner/network?tab=invitations"

    case "project_assignment": {
      // F3. TWO PAYLOAD SHAPES UNDER ONE TYPE, AND inboxId IS CHECKED FIRST.
      // lib/magic-token-attach.ts writes { inboxId, magicToken } and points at the RFP itself;
      // app/api/projects/[id]/assignments/route.ts writes { assignmentId, projectId, ... } and
      // points at the project. Neither carries the other's key, so the order only decides a
      // row that carries both, which no write site produces. The RFP is the more specific of
      // the two and wins if one ever does.
      const inboxId = readId(n.data, "inboxId")
      if (inboxId) return `/partner/rfps/${encodeURIComponent(inboxId)}`
      const projectId = readId(n.data, "projectId")
      if (projectId) return `/partner/projects/${encodeURIComponent(projectId)}`
      return "/partner/rfps"
    }

    case "project_awarded": {
      const projectId = readId(n.data, "projectId")
      return projectId ? `/partner/projects/${encodeURIComponent(projectId)}` : "/partner/projects"
    }

    case "onboarding_deployed": {
      // F4. TWO WRITE SITES THAT DISAGREE ABOUT THE DESTINATION, AND EACH KEEPS ITS OWN.
      // The dormant deploy route (CLAUDE.md lists it as not mounted) writes
      // { projectId, assignmentId, deploymentId } and authored a project-detail destination;
      // the live onboarding-packages route writes { projectId, packageId } and authored the
      // onboarding list. `deploymentId` is the only key that tells them apart. Overriding
      // either emitter's choice would be a product decision, so neither is overridden - the
      // disagreement is reported rather than resolved here.
      const deploymentId = readId(n.data, "deploymentId")
      const projectId = readId(n.data, "projectId")
      if (deploymentId && projectId) return `/partner/projects/${encodeURIComponent(projectId)}`
      return "/partner/onboarding"
    }

    case "rfp_closed":
    case "rfp_not_selected":
      // F5. NO IDENTIFIER EXISTS ON THESE ROWS. app/api/agency/rfp-closure/route.ts passes
      // scopeItemName and agencyName, which are display strings, and no key. A record
      // destination is impossible rather than deferred, and saying so is the answer.
      //
      // F9. THE TAB MATTERS MORE THAN USUAL HERE. components/partner-rfp-surface.tsx
      // partitions closed rows OUT of the open list, so the unparameterised /partner/rfps
      // takes a vendor to a list defined as not containing the thing they were told about.
      return "/partner/rfps?tab=closed"

    // ── Agency-addressed ────────────────────────────────────────────────────

    case "partnership_accepted":
    case "partnership_declined":
      // F6. The row carries partnershipId; /agency/pool/[partnerId] takes a VENDOR
      // ORGANIZATION id, which is a different thing and is not on the row. The list is the
      // honest destination until an emitter carries the other id. Ruling R2.
      return "/agency/pool"

    case "project_accepted":
    case "project_declined":
      // F7. Carries projectId; /agency/bids has no project parameter and groups in component
      // state. Left at the list rather than inventing a filter nobody asked for.
      return "/agency/bids"

    case "bid_submitted": {
      // THE ONE THE BRIEF NAMES. The id has been on the row since 095 turned this type on.
      const responseId = readId(n.data, "responseId")
      return responseId ? `/agency/bids?response=${encodeURIComponent(responseId)}` : "/agency/bids"
    }

    // ── Everything else ─────────────────────────────────────────────────────

    default:
      /**
       * A TYPE THIS FILE DOES NOT KNOW FALLS BACK TO ITS OWN STORED LINK, STILL GATED BY THE
       * PORTAL RULE BELOW.
       *
       * The same argument unknownTypeLabel() makes for the label, applied to the destination.
       * Returning null here would be tidier and would be wrong: a type added to
       * NotificationType and to the CHECK constraint later, by someone who never opens this
       * file, would go from "navigates to the link its author chose" to "inert", silently, and
       * the only symptom would be a row nobody can click. The stored link was authored by the
       * write site and is a real destination; honouring it is the behaviour that degrades in
       * the safe direction.
       *
       * `new_message` and `document_uploaded` reach this branch. Both are declared in the union
       * and permitted by the constraint and neither has a write site anywhere in the
       * repository (F2), so no row of either type can exist to be routed. They are listed here
       * so that a future emitter for them works on the day it ships.
       */
      return n.link && isAppPath(n.link) ? n.link : null
  }
}

/**
 * The path this row should navigate to from THIS portal, or null when it should not be
 * clickable at all.
 *
 * Null has exactly three causes and they are worth telling apart when reading a bug report:
 *   1. The type has no destination and no usable stored link.
 *   2. The destination is in the other portal (the eleven cross-portal cells). Today those
 *      rows navigate and are bounced by middleware to the portal home with no message, which
 *      is a dead click with a side effect. Inert is the ruling this implements - R1(a) in
 *      docs/100-phase0-baseline.md - and it is the only option that invents no behaviour.
 *      R1(b), switching the portal on a click, remains open and would be a change here alone.
 *   3. The stored link is not a same-origin app path.
 */
export function resolveNotificationDestination(
  n: RoutableNotification,
  side: NotificationViewerSide
): string | null {
  const destination = candidateDestination(n)
  if (!destination || !isAppPath(destination)) return null

  const prefix = PORTAL_PREFIX[side]
  // `=== prefix` covers the bare portal root; the trailing slash stops "/agencyfoo" matching
  // "/agency". Query strings are unaffected: "/agency/bids?response=x" starts with "/agency/".
  if (destination !== prefix && !destination.startsWith(`${prefix}/`)) return null

  return destination
}
