export type BidStatus =
  | "submitted"
  | "under_review"
  | "shortlisted"
  | "meeting_requested"
  | "awarded"
  | "declined"
  | "draft"
  | "new"
  | "viewed"
  | "bid_submitted"
  | "feedback_received"
  | "revision_submitted"

/**
 * partner_rfp_responses.status -> partner_rfp_inbox.status. The two tables use different
 * vocabularies for the same lifecycle (a response is "submitted", the inbox row it belongs to
 * is "bid_submitted"), and every write site that keeps them in sync must agree on the mapping.
 * Shared by the agency award/decision PATCH and by the magic-link portal attach, which seeds a
 * synthesized inbox row from an already-decided response.
 */
export function mapResponseStatusToInboxStatus(status: string): string {
  if (status === "shortlisted") return "shortlisted"
  if (status === "meeting_requested") return "meeting_requested"
  if (status === "awarded") return "awarded"
  if (status === "declined") return "declined"
  return "bid_submitted"
}

export function getBidStatusLabel(status: string, userType: "agency" | "partner"): string {
  const normalized = (status || "").toLowerCase() as BidStatus

  if (userType === "partner") {
    switch (normalized) {
      case "submitted":
        return "Submitted"
      case "bid_submitted":
      case "revision_submitted":
      case "new":
      case "viewed":
      case "feedback_received":
      case "draft":
        return "New"
      case "under_review":
        return "Changes Requested"
      case "shortlisted":
        return "Shortlisted"
      case "meeting_requested":
        return "Meeting Requested"
      case "awarded":
        return "Awarded"
      case "declined":
        return "Declined"
      default:
        return "New"
    }
  }

  switch (normalized) {
    case "submitted":
    case "bid_submitted":
      return "Submitted"
    case "under_review":
      return "Under Review"
    case "shortlisted":
      return "Shortlisted"
    case "meeting_requested":
      return "Meeting Requested"
    case "awarded":
      return "Awarded"
    case "declined":
      return "Declined"
    case "draft":
      return "Draft"
    default:
      return normalized ? normalized.replace(/_/g, " ") : "Submitted"
  }
}

export function getBidStatusColor(status: string): string {
  const normalized = (status || "").toLowerCase() as BidStatus
  switch (normalized) {
    case "submitted":
    case "bid_submitted":
      return "bg-gray-100 text-gray-700"
    case "under_review":
      return "bg-amber-100 text-amber-800"
    case "shortlisted":
      return "bg-purple-100 text-purple-800"
    case "meeting_requested":
      return "bg-cyan-100 text-cyan-800"
    case "awarded":
      return "bg-green-100 text-green-800"
    case "declined":
      return "bg-red-100 text-red-800"
    default:
      return "bg-gray-100 text-gray-700"
  }
}
