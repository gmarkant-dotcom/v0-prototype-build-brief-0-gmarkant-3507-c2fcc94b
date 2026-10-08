import type { RelationshipAct } from "@/lib/relationship-transitions"

/**
 * THE CONFIRMATION COPY FOR SUSPEND, TERMINATE AND REINSTATE.
 *
 * EVERY SENTENCE HERE DESCRIBES WHAT THE CODE DOES TODAY AND NOTHING MORE. This product has
 * already told agencies once that removing a vendor revoked their access when it did not
 * (docs/vendor-removal-report.md section 1). Nothing below may say that access is revoked,
 * withdrawn, cut off or ended, or that documents are taken back. That becomes true only when
 * the migration session lands the document policy predicate (docs/relationship-end-rulings.md
 * ruling 5), and the strings are to be rewritten by the same change that makes it true.
 *
 * WHAT EACH CLAIM IS PINNED TO, so a later edit can check it rather than trust it:
 *
 *  "new requests ... from your vendor pool"  broadcast-rfp/route.ts:222 requires
 *       status = 'active' for every pool recipient. It is NOT true of an RFP sent to a typed
 *       email address or a Lightning (magic-link) invitation, which read no partnership
 *       status. The copy says "from your vendor pool" for that reason and no wider.
 *  "work already awarded continues"  /api/partner/projects reads the vendor's awards with no
 *       status filter; no policy on a delivery table filters on partnerships.status.
 *  "documents and payments"  same: no status predicate on documents, and
 *       /api/partner/payments dropped its active-only filter in edff222.
 *  "full profile, your notes and delivery history are not available to you"  the three agency
 *       reads gated on status = 'active': pool/[partnerId]/route.ts (profile tier),
 *       notes/route.ts:78 and performance/route.ts:58.
 *  "they see only your public profile"  network/[agencyId]/route.ts tiers on active.
 *
 * NO EM DASHES in any string here (user-facing copy rule).
 */

export type RelationshipActCopy = {
  title: (name: string) => string
  /** One paragraph per entry. */
  body: (name: string) => string[]
  confirmLabel: string
  pendingLabel: string
  /** The row-level control label. */
  controlLabel: string
  destructive: boolean
}

const WHILE_NOT_ACTIVE =
  "While the partnership is not active, their full profile, your notes on them and their delivery history are not available to you, and they see only your public profile."

export const RELATIONSHIP_ACT_COPY: Record<RelationshipAct, RelationshipActCopy> = {
  suspend: {
    title: (name) => `Suspend ${name}?`,
    body: (name) => [
      `Suspending pauses your partnership with ${name}. You will not be able to choose them when you send an RFP from your vendor pool.`,
      "Everything already in progress carries on. They keep access to current work, documents and payments.",
      WHILE_NOT_ACTIVE,
      "You can reinstate them at any time. They will be told by email that the partnership is paused.",
    ],
    confirmLabel: "Suspend",
    pendingLabel: "Suspending...",
    controlLabel: "Suspend",
    destructive: false,
  },
  terminate: {
    title: (name) => `Terminate ${name}?`,
    body: (name) => [
      `Terminating ends your partnership with ${name}. You will not be able to choose them when you send an RFP from your vendor pool.`,
      "Work already awarded to them continues. They keep their record of past work and what they are owed.",
      WHILE_NOT_ACTIVE,
      "You can reinstate the partnership later. They will be told by email that you have ended it.",
    ],
    confirmLabel: "Terminate",
    pendingLabel: "Terminating...",
    controlLabel: "Terminate",
    destructive: true,
  },
  reinstate: {
    title: (name) => `Reinstate ${name}?`,
    body: (name) => [
      `This sets your partnership with ${name} back to active, and you will be able to choose them when you send an RFP again.`,
      "Nothing about their work, documents or payments changes. They are not sent a new invitation and no email or notification goes out.",
    ],
    confirmLabel: "Reinstate",
    pendingLabel: "Reinstating...",
    controlLabel: "Reinstate",
    destructive: false,
  },
}
