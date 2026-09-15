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

/**
 * THE SAME TWO FACTS, IN THE VENDOR PORTAL, IN ONE SENTENCE EACH.
 *
 * ===========================================================================
 * WHY THIS IS HERE AND NOT INLINE IN THE PAGE
 * ===========================================================================
 *
 * It shipped inline, once, in the My Bid tab of app/partner/rfps/[id]/page.tsx.
 * It now has to render in TWO places on that page, and the reason is the whole
 * of the argument for moving it:
 *
 *   A CLOSED ROW DOES NOT LAND ON THE TAB THE EXPLANATION WAS ON. The default
 *   tab is chosen by `shouldDefaultToStatus`, which is true for every status
 *   outside {submitted, bid_submitted} - so a closed or not_selected row opens
 *   on Status & Feedback. That tab showed a chip reading "Closed" or "Not
 *   Selected" and nothing else. The sentence saying which of the two things
 *   happened, and that it is not a rejection, was one click away on a tab
 *   labelled My Bid, which is the last place a vendor with no bid would look.
 *
 * That was survivable while the only way in was the vendor's own Closed tab,
 * where they had just read the row's status to get here. It stops being
 * survivable now that a notification and an email both deep-link straight to
 * this page: the click lands on a status word with no explanation, which is the
 * "inert screen" the closure banner was written to prevent in the first place.
 *
 * ONE FUNCTION, TWO CALL SITES, SO THE TWO CANNOT DRIFT. Two copies of a
 * sentence that must not read as a rejection is two chances for one of them to
 * start reading as one. Same argument closureEmailCopy() above makes for the
 * two emails, applied to the two tabs.
 *
 * ===========================================================================
 * WHY IT IS NOT closureEmailCopy().body
 * ===========================================================================
 *
 * The email must carry the record on its own, away from the product, to someone
 * who may not sign in. It gets three paragraphs and a call to action. This
 * renders ON the record, next to the status chip and the RFP itself, to someone
 * who is already looking at it - so it says which of the two things happened
 * and stops. Making one serve both would make the email thin or the page
 * repeat itself.
 *
 * WHAT IT STILL SHARES WITH THE EMAIL, DELIBERATELY: closed says the request
 * ended for everyone, not_selected says it is about this one request only, and
 * both say the record survives. Those are the three load-bearing facts, and a
 * vendor who reads the mail and then opens the page must not meet a fourth
 * version of the story.
 */
export function closureVendorNotice(status: RfpClosureStatus, agencyName: string): string {
  const who = agencyName.trim() || "This agency"
  return status === "not_selected"
    ? `${who} has decided not to move forward with your company on this request. They are not expecting a response from you on it. This is about this one request and it stays here as a record.`
    : `${who} has closed this request. It ended for everyone who was invited and is not taking bids, so there is nothing further for you to do on it. It stays here as a record.`
}
