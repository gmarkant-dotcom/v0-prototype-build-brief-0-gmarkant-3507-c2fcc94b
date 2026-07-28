import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { formatBudgetForDisplay, formatTimelineForDisplay } from "@/lib/rfp-response-fields"

// Accepts either the cookie-scoped server client (@/lib/supabase/server) or a
// service-role client (@supabase/supabase-js) - both are SupabaseClient instances,
// and guest/magic-link callers have no session to scope a cookie client with.
type SupabaseServerClient = SupabaseClient

export type BidAnalysisContext = {
  responseId: string
  proposalText: string
  budgetProposal: string
  timelineProposal: string
  paymentTerms: unknown
  businessCriteriaResponses: unknown
  partnerDisplayName: string
  scopeItemName: string | null
  scopeItemDescription: string | null
}

/**
 * Loads a bid plus its originating RFP scope for AI prompting. Partner bids resolve
 * scope via partner_rfp_inbox (inbox_item_id); guest/magic-link bids have no inbox
 * row, so scope comes from rfp_magic_tokens keyed by response_id instead.
 */
export async function loadBidAnalysisContext(
  supabase: SupabaseServerClient,
  responseId: string,
  agencyId: string
): Promise<BidAnalysisContext | null> {
  const { data: response } = await supabase
    .from("partner_rfp_responses")
    .select(
      "id, inbox_item_id, proposal_text, budget_proposal, timeline_proposal, payment_terms, business_criteria_responses, partner_display_name"
    )
    .eq("id", responseId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  if (!response) return null

  let scopeItemName: string | null = null
  let scopeItemDescription: string | null = null

  if (response.inbox_item_id) {
    const { data: inbox } = await supabase
      .from("partner_rfp_inbox")
      .select("scope_item_name, scope_item_description")
      .eq("id", response.inbox_item_id)
      .eq("agency_id", agencyId)
      .maybeSingle()
    scopeItemName = (inbox?.scope_item_name as string | null) ?? null
    scopeItemDescription = (inbox?.scope_item_description as string | null) ?? null
  } else {
    const { data: magicToken } = await supabase
      .from("rfp_magic_tokens")
      .select("scope_item_name, scope_item_description")
      .eq("response_id", responseId)
      .eq("agency_id", agencyId)
      .maybeSingle()
    scopeItemName = (magicToken?.scope_item_name as string | null) ?? null
    scopeItemDescription = (magicToken?.scope_item_description as string | null) ?? null
  }

  return {
    responseId: response.id as string,
    proposalText: (response.proposal_text as string) || "",
    budgetProposal: (response.budget_proposal as string) || "",
    timelineProposal: (response.timeline_proposal as string) || "",
    paymentTerms: response.payment_terms,
    businessCriteriaResponses: response.business_criteria_responses,
    partnerDisplayName: (response.partner_display_name as string) || "Vendor",
    scopeItemName,
    scopeItemDescription,
  }
}

/** Renders a bid's fields into plain text for an AI prompt - not for UI display. */
export function formatBidContextForPrompt(ctx: BidAnalysisContext): string {
  const lines: string[] = []
  lines.push(`Scope: ${ctx.scopeItemName || "Unspecified scope"}`)
  if (ctx.scopeItemDescription) lines.push(`Scope description: ${ctx.scopeItemDescription}`)
  lines.push(`Vendor: ${ctx.partnerDisplayName}`)
  lines.push(`Proposed budget: ${formatBudgetForDisplay(ctx.budgetProposal)}`)
  lines.push(`Proposed timeline: ${formatTimelineForDisplay(ctx.timelineProposal)}`)
  if (ctx.paymentTerms && typeof ctx.paymentTerms === "object") {
    lines.push(`Payment terms: ${JSON.stringify(ctx.paymentTerms)}`)
  }
  lines.push("")
  lines.push("Proposal text:")
  lines.push(ctx.proposalText || "(no proposal text provided)")
  return lines.join("\n")
}

/** Sorted, comma-joined, SHA-256 hex hash - stable regardless of selection order. */
export function hashResponseIds(responseIds: string[]): string {
  const sorted = [...responseIds].sort()
  return createHash("sha256").update(sorted.join(",")).digest("hex")
}

/** Same "{projectId}::{scopeItemName}" shape as lib/bid-shared.ts's scopeKeyForRow, hashed
 *  so it can be stored in bid_evaluations.ranked_recommendation_group without a new table. */
export function hashScopeGroup(projectId: string, scopeItemName: string): string {
  return createHash("sha256").update(`${projectId}::${scopeItemName}`).digest("hex")
}
