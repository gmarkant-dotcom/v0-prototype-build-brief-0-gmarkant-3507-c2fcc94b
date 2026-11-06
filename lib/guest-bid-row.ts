/**
 * F8. THE BID CONTENT A GUEST WRITES to partner_rfp_responses, for both the first submit and an
 * edit (app/api/rfp/guest/[token]/route.ts). Pure, so it is tested without a database
 * (lib/guest-bid-row.test.ts).
 *
 * The first submit used to build its own row and left proposal_sections out, so a guest's
 * sectioned proposal was lost while the edit path and the vendor portal kept it. One builder for
 * both paths keeps them from drifting again.
 *
 * Bid content only. Agency-owned columns (ai_summary, ai_summary_generated_at, composite_score and
 * the other scores and evaluations) are never written here; migration 121's guard refuses a vendor
 * write to them, and GUEST_BID_FORBIDDEN_COLUMNS is checked by the test.
 */

export const GUEST_BID_FORBIDDEN_COLUMNS = [
  "ai_summary",
  "ai_summary_generated_at",
  "composite_score",
  "agency_feedback",
  "feedback_updated_at",
] as const

export type GuestBidContentInput = {
  proposal_text: string
  budget_proposal: unknown
  timeline_proposal: string
  terms_disclosure: unknown
  attachments: unknown
  business_criteria_responses: unknown
  /** Only written when the request carried acknowledgments (S4-1 write guard). */
  business_criteria_acknowledgments: unknown | null
  hasAcknowledgments: boolean
  /** Null means "none": the key is left out, as on the vendor path. */
  budget_lines: unknown | null
  /** buildProposalSectionsForSave(...): null when the guest wrote no section. */
  proposal_sections: unknown | null
  nowIso: string
}

/** The columns both guest paths share. Same conditional keys as the vendor portal's row. */
export function buildGuestBidContent(input: GuestBidContentInput): Record<string, unknown> {
  return {
    proposal_text: input.proposal_text,
    budget_proposal: input.budget_proposal,
    timeline_proposal: input.timeline_proposal,
    terms_disclosure: input.terms_disclosure,
    attachments: input.attachments,
    business_criteria_responses: input.business_criteria_responses,
    status: "submitted",
    updated_at: input.nowIso,
    ...(input.hasAcknowledgments ? { business_criteria_acknowledgments: input.business_criteria_acknowledgments } : {}),
    ...(input.budget_lines ? { budget_lines: input.budget_lines } : {}),
    ...(input.proposal_sections ? { proposal_sections: input.proposal_sections } : {}),
  }
}
