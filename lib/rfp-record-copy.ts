/**
 * Copy for the two RFP record choices (migration 118, rulings D2 and D3): the per-RFP client toggle
 * and the per-line budget release. Shared by the wizard (app/agency/page.tsx) and the Lightning RFP
 * page (app/agency/magic-rfp/page.tsx).
 *
 * RFP_VENDOR_COPY_SCRUBBED says whether vendors' copies of an RFP honour these choices yet. Step A
 * stores them on the agency's RFP record, but vendors still receive the full copy (every line's
 * budget, the program budget, the client name) until step C writes per-vendor copies. Step C flips
 * this to true, and the copy below stops telling the agency the setting is not yet in effect.
 */
export const RFP_VENDOR_COPY_SCRUBBED = false

export const SHOW_CLIENT_TO_VENDORS_LABEL = "Show client name to vendors"

export const SHOW_CLIENT_TO_VENDORS_HINT = RFP_VENDOR_COPY_SCRUBBED
  ? "Off by default. When on, vendors see this RFP's client name."
  : "Off by default and saved on your RFP record. Vendors still see the client name in this release; this setting takes effect for vendors in the next release."

export const RELEASE_BUDGET_LABEL = "Release budget to this line's vendors"

export const RELEASE_BUDGET_HINT = RFP_VENDOR_COPY_SCRUBBED
  ? "Hidden by default. When on, vendors on this line see its budget and nothing else of yours."
  : "Hidden by default and saved on your RFP record. Vendors still see budgets in this release; this choice takes effect for vendors in the next release."
