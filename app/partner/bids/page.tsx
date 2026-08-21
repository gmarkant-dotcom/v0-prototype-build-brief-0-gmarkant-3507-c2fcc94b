"use client"

/**
 * STAGE 02 - MY BIDS. The vendor half of the lead agency's "02 Bid Management", and the
 * mirror of `/agency/bids`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ROUTE EXISTS.
 *
 * The shared engagement has four stages and both portals are supposed to show the same four.
 * The lead agency did: 01 RFP Broadcast, 02 Bid Management, 03 Onboarding, 04 Delivery
 * Performance. The vendor collapsed the first two into one item, "Open RFPs & Bids", which
 * was the only thing breaking the 1:1. This is the second half, given its own item.
 *
 * It carries two views, My Bids and History, for the reasons set out at the tab strip in
 * components/partner-rfp-surface.tsx: both read `partner_rfp_responses` through
 * /api/partner/rfps/bids, and History is that same list with the terminal statuses put back
 * in rather than a different thing.
 *
 * ---------------------------------------------------------------------------
 * NOTHING REDIRECTS HERE AND NOTHING NEEDS TO. This is a NEW path, not a renamed one, so
 * there is no old URL to keep alive. `/partner/rfps` still resolves to stage 01 exactly as
 * it did, which is what the five vendor emails and the auth callback point at.
 *
 * Route protection needs no change either: middleware.ts gates on
 * `pathname.startsWith('/partner')`, so this inherits the vendor gate by prefix without the
 * file being touched.
 */

import { PartnerRfpSurface } from "@/components/partner-rfp-surface"

export default function PartnerBidsPage() {
  return <PartnerRfpSurface surface="bids" />
}
