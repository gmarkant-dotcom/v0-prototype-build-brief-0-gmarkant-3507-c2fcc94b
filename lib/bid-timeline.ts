/**
 * Chronological activity timeline for a bid, built from whatever action timestamps actually
 * exist in the schema today:
 *   - partner_rfp_inbox.created_at / rfp_magic_tokens.created_at -> "RFP sent"
 *   - partner_rfp_responses.submitted_at -> "Bid submitted"
 *   - partner_rfp_responses.feedback_updated_at (when agency_feedback is set) -> "Feedback received"
 *   - project_assignments.awarded_at -> "Awarded"
 *
 * Deliberately NOT included, since no column exists yet (would need a migration):
 * shortlisted_at, meeting_requested_at, declined_at. See LIGAMENT_CONTEXT.md backlog.
 */

export interface BidTimelineEntry {
  label: string
  iso: string
}

export function buildBidTimeline(input: {
  rfpSentAt?: string | null
  submittedAt?: string | null
  feedbackAt?: string | null
  awardedAt?: string | null
}): BidTimelineEntry[] {
  const entries: BidTimelineEntry[] = []
  if (input.rfpSentAt) entries.push({ label: "RFP sent", iso: input.rfpSentAt })
  if (input.submittedAt) entries.push({ label: "Bid submitted", iso: input.submittedAt })
  if (input.feedbackAt) entries.push({ label: "Feedback received", iso: input.feedbackAt })
  if (input.awardedAt) entries.push({ label: "Awarded", iso: input.awardedAt })
  return entries.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())
}
