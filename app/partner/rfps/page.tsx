"use client"

/**
 * STAGE 01 - OPEN RFPS. The vendor half of the lead agency's "01 RFP Broadcast".
 *
 * ---------------------------------------------------------------------------
 * THIS URL MUST NOT MOVE, AND IT HAS NOT.
 *
 * `/partner/rfps` is the live call to action of the vendor emails and the default landing
 * for the auth callback. Every one of these still resolves to this file, unchanged:
 *
 *   1. RFP broadcast, existing partner, no NDA        lib/email.ts via broadcast-rfp
 *   2. RFP broadcast, existing partner, NDA required  -> /partner/rfps?invite=...&nda=required
 *   3. Bid feedback left                              -> /partner/rfps
 *   4. Bid declined by the agency                     -> /partner/rfps
 *   5. Bid awarded                                    -> /partner/rfps
 *   6. app/auth/callback/route.ts                     partner default destination
 *
 * The `?invite=`, `?invite_status=` and `?nda=` parameters are read inside the surface
 * component and still are: the auto-claim effect that fires on `invite` did not move, it
 * only changed file. Splitting the nav added a route, it did not rename one.
 *
 * ---------------------------------------------------------------------------
 * WHAT A VENDOR SEES DIFFERENTLY. This page no longer carries the OPEN RFPS / MY BIDS /
 * HISTORY tab strip. Bids moved to `/partner/bids`, reachable from "02 My Bids" in the top
 * nav. No URL selected a tab before the split - the tab was plain component state with no
 * query parameter - so no link anyone holds can land on a tab that is gone.
 */

import { PartnerRfpSurface } from "@/components/partner-rfp-surface"

export default function PartnerOpenRfpsPage() {
  return <PartnerRfpSurface surface="rfps" />
}
