/**
 * Copy for the two RFP record choices (migration 118, rulings D2 and D3): the per-RFP client toggle
 * and the per-line budget release. Shared by the wizard (app/agency/page.tsx) and the Lightning RFP
 * page (app/agency/magic-rfp/page.tsx).
 *
 * RFP_VENDOR_COPY_SCRUBBED says whether vendors' copies of an RFP honour these choices yet. Step A
 * stored them on the agency's RFP record while vendors still received the full copy. Step C (true
 * since then) writes per-vendor copies (lib/rfp-vendor-copy.ts) and every vendor and guest reader
 * takes the client name and budget only from the release columns, so a change takes effect for
 * vendors immediately. Old copies still holding the removed keys are no longer read by any vendor
 * screen before migration 120 scrubs them.
 */
export const RFP_VENDOR_COPY_SCRUBBED = true

export const SHOW_CLIENT_TO_VENDORS_LABEL = "Show client name to vendors"

export const SHOW_CLIENT_TO_VENDORS_HINT = RFP_VENDOR_COPY_SCRUBBED
  ? "Off by default. When on, vendors see this RFP's client name."
  : "Off by default and saved on your RFP record. Vendors still see the client name in this release; this setting takes effect for vendors in the next release."

/** Step B: the same toggle on an RFP that has already been sent (bids page). */
export const SHOW_CLIENT_TO_VENDORS_EXISTING_HINT = RFP_VENDOR_COPY_SCRUBBED
  ? "Vendors on this RFP see the client name only while this is on. A change reaches them immediately."
  : "Saved on your RFP record now. Vendors still see the client name in this release; this setting takes effect for vendors in the next release."

export const SHOW_CLIENT_TO_VENDORS_NOT_ENABLED = "This setting cannot be changed yet. Nothing was changed."

export const RELEASE_BUDGET_LABEL ="Release budget to this line's vendors"

export const RELEASE_BUDGET_HINT = RFP_VENDOR_COPY_SCRUBBED
  ? "Hidden by default. When on, vendors on this line see its budget and nothing else of yours."
  : "Hidden by default and saved on your RFP record. Vendors still see budgets in this release; this choice takes effect for vendors in the next release."
