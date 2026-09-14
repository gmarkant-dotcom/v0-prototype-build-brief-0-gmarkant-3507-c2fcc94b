import type { RfpClosureStatus } from "@/lib/rfp-closure"

/**
 * THE TWO CLOSURE EMAILS. R7, PHASE 4.
 *
 * ===========================================================================
 * THE COPY IS THE POINT, AND THE TWO MESSAGES MUST NOT READ AS EACH OTHER.
 * ===========================================================================
 *
 * They are in one file, side by side, so that anyone editing either can see
 * the other. Split across two call sites they would converge: the same writer
 * reaching for the same phrases six months apart is how two different facts
 * end up wearing one sentence.
 *
 *   CLOSED        The opportunity ended. The vendor was NOT rejected and the
 *                 message says so in as many words, because a vendor reading
 *                 "closed" with nothing else to go on will assume it was about
 *                 them. It was about everyone.
 *
 *   NOT_SELECTED  This vendor specifically was not chosen. It IS about them and
 *                 pretending otherwise would be worse than saying it. What gets
 *                 scoped instead is the blast radius: this one request, not the
 *                 relationship and not the next RFP.
 *
 * WHAT NEITHER OF THEM SAYS, EVER:
 *
 *   "declined"  - in this product that means a vendor who SUBMITTED A BID AND
 *                 LOST. Every recipient of these two emails never bid. Telling
 *                 them their bid was declined would be telling them about a bid
 *                 that does not exist, and it is exactly the confusion R7's two
 *                 separate statuses exist to prevent.
 *   "rejected"  - nobody was rejected in either case. One request ended; one
 *                 vendor was not chosen for one scope.
 *   a reason    - neither route collects one and neither email invents one.
 *
 * WHAT BOTH OF THEM SAY, DELIBERATELY: that the record survives. A request
 * disappearing from a queue reads as deletion, and R7 is explicit that closure
 * and deletion are different events and a vendor must be able to tell them
 * apart. The sentence about history is the only thing that carries that.
 *
 * TONE: professional, direct, warm. Not corporate, not casual. No em dashes.
 */

export type ClosureEmailCopy = {
  subject: string
  title: string
  body: string
}

export function closureEmailCopy(
  status: RfpClosureStatus,
  { agencyName, scopeItemName }: { agencyName: string; scopeItemName: string }
): ClosureEmailCopy {
  if (status === "closed") {
    return {
      subject: `${agencyName} has closed the RFP for ${scopeItemName}`,
      title: "This RFP has closed",
      body:
        `${agencyName} has closed the RFP for "${scopeItemName}". It is no longer taking bids, ` +
        `so there is nothing further for you to do on it.\n\n` +
        // THE LOAD-BEARING SENTENCE OF THIS EMAIL. Without it a vendor reads a
        // closure as a rejection, and acts on that reading in a relationship
        // where nothing has actually gone wrong.
        `This is not a decision about your company. The request ended for everyone who was ` +
        `invited to it.\n\n` +
        `It stays in your history on Ligament, so you keep the record that it was sent to you.`,
    }
  }

  return {
    // The subject deliberately does NOT contain "not selected". A vendor's inbox
    // is public to whoever is standing behind them, and the outcome belongs in
    // the message rather than in a preview line. "Update on" is the phrasing the
    // bid decline mail already uses for the same reason.
    subject: `Update on ${scopeItemName} from ${agencyName}`,
    title: "You were not selected for this scope",
    body:
      `${agencyName} has decided not to move forward with your company on "${scopeItemName}", ` +
      `and is no longer expecting a response from you on it.\n\n` +
      // THE LOAD-BEARING SENTENCE OF THIS ONE. It bounds what the decision
      // means. The RFP may well still be running with other vendors, and a
      // vendor who assumes otherwise draws a much larger conclusion than the
      // agency made.
      `This is about this one request. It does not change your relationship with ${agencyName} ` +
      `or any other request they send you.\n\n` +
      `It stays in your history on Ligament, so you keep the record that it was sent to you.`,
  }
}
