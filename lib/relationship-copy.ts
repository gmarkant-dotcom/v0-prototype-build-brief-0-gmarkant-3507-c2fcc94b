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


/**
 * THE VENDOR-SIDE RELATIONSHIP TAG, SHARED. Moved here from app/partner/payments/page.tsx so
 * every vendor surface that shows work belonging to a paused or ended relationship uses the
 * SAME tag and the SAME sentence (commit edff222 set the pattern; a second one would be the
 * defect). Greg's ruling of 2026-09-14: a vendor who is owed money keeps seeing what they are
 * owed after the relationship ends, because the counterparty keeps their record. Ruling 1 of
 * docs/relationship-end-rulings.md extends the same principle to work already awarded.
 *
 * SUSPENDED IS NOT TERMINATED AND IS NOT LABELLED AS IF IT WERE. A paused relationship can
 * resume; telling a vendor it "ended" would be its own false statement. 'pending' returns null
 * on purpose: a relationship that has not started has not ended either. 'removed' is tagged
 * "Ended": an agency archived the contact, and the vendor should know something changed.
 *
 * NOTHING HERE FILTERS. A tag describes a row; it never removes one.
 */
export function relationshipTag(status: string | null | undefined): { label: string; ended: boolean } | null {
  const s = String(status || "").trim().toLowerCase()
  if (s === "" || s === "active" || s === "pending") return null
  if (s === "suspended") return { label: "Paused", ended: false }
  // 'terminated' and 'removed' both mean the agency ended it. Any status added to the CHECK
  // constraint later lands here and reads "Ended", which errs toward telling the vendor
  // something changed rather than staying silent about it.
  return { label: "Ended", ended: true }
}

/**
 * The sentence for a paused or ended relationship. Says what changed and what did not, and
 * claims nothing about access: the vendor keeps their work, documents and payments today.
 * "from their vendor pool" is deliberate. Only the pool broadcast checks the partnership; an
 * RFP sent to a typed address or a Lightning link does not (docs/relationship-end-phase0.md
 * section 2, rows 7 and 8), so "you will not be sent new RFPs" would overclaim.
 */
export function relationshipNotice(agency: string, tag: { label: string; ended: boolean }): string {
  if (!tag.ended) {
    return `Your relationship with ${agency} is paused. Your current work, documents and anything you are owed stay available to you. ${agency} cannot choose you for new RFPs from their vendor pool while it is paused.`
  }
  return `Your relationship with ${agency} has ended. Work already awarded to you continues, and your record of past work and anything you are owed stays available to you. ${agency} cannot choose you for new RFPs from their vendor pool.`
}
