import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { formatBudgetForDisplay, formatTimelineForDisplay } from "@/lib/rfp-response-fields"
import { formatProposalSectionsForPrompt } from "@/lib/proposal-sections"
import { normalizeBudgetLines, categorySubtotal } from "@/lib/budget-categories"

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
  /** P2-2/P2-1. Both fetched through a guarded query below, so both are simply absent before
   *  migrations 076/072 and on every bid that carries no structured data. */
  proposalSections: unknown
  budgetLines: unknown
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

  // P2-1/P2-2 pre-migration safety: proposal_sections (076) and budget_lines (072) are kept out
  // of the explicit select above, because selecting a column that does not exist yet errors the
  // whole query. Fetched separately, and any failure simply means the AI prompt gains nothing.
  let structured: { proposal_sections?: unknown; budget_lines?: unknown } = {}
  const { data: structuredRow, error: structuredErr } = await supabase
    .from("partner_rfp_responses")
    .select("proposal_sections, budget_lines")
    .eq("id", responseId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  if (structuredErr) {
    console.warn("[bid-analysis-context] structured bid columns unavailable, prompting without them", {
      code: structuredErr.code,
      message: structuredErr.message,
    })
  } else if (structuredRow) {
    structured = structuredRow as { proposal_sections?: unknown; budget_lines?: unknown }
  }

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
    proposalSections: structured.proposal_sections,
    budgetLines: structured.budget_lines,
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
  // P2-1: the vendor's own category breakdown, as submitted. Never converted across
  // currencies and never inferred - absent when the bid has none.
  const budgetLines = normalizeBudgetLines(ctx.budgetLines)
  if (budgetLines) {
    lines.push("")
    lines.push(`Budget by category (as submitted, ${budgetLines.currency}):`)
    for (const entry of budgetLines.categories) {
      lines.push(`- ${entry.name_snapshot}: ${categorySubtotal(entry)}`)
      for (const item of entry.items) lines.push(`    - ${item.description}: ${item.amount}`)
    }
  }
  lines.push("")
  lines.push("Proposal text:")
  lines.push(ctx.proposalText || "(no proposal text provided)")
  // P2-2: labelled structured sections when the vendor filled any in. Returns "" otherwise, so
  // a prose-only bid's prompt is byte-for-byte what it was before this feature existed.
  const structuredProposal = formatProposalSectionsForPrompt(ctx.proposalSections)
  if (structuredProposal) {
    lines.push("")
    lines.push("Structured proposal sections (the vendor answered these guided prompts):")
    lines.push(structuredProposal)
  }
  return lines.join("\n")
}

export type ResponseScope = {
  projectId: string | null
  scopeItemName: string | null
  scopeItemDescription: string | null
}

/** Same partner_rfp_inbox / rfp_magic_tokens resolution as loadBidAnalysisContext, but
 *  also returns project_id - needed to hash a ranking group, which loadBidAnalysisContext
 *  has no reason to expose. */
export async function resolveResponseScope(
  supabase: SupabaseServerClient,
  responseId: string,
  agencyId: string
): Promise<ResponseScope | null> {
  const { data: response } = await supabase
    .from("partner_rfp_responses")
    .select("inbox_item_id")
    .eq("id", responseId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  if (!response) return null

  if (response.inbox_item_id) {
    const { data: inbox } = await supabase
      .from("partner_rfp_inbox")
      .select("project_id, scope_item_name, scope_item_description")
      .eq("id", response.inbox_item_id)
      .eq("agency_id", agencyId)
      .maybeSingle()
    return {
      projectId: (inbox?.project_id as string | null) ?? null,
      scopeItemName: (inbox?.scope_item_name as string | null) ?? null,
      scopeItemDescription: (inbox?.scope_item_description as string | null) ?? null,
    }
  }

  const { data: magicToken } = await supabase
    .from("rfp_magic_tokens")
    .select("project_id, scope_item_name, scope_item_description")
    .eq("response_id", responseId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  return {
    projectId: (magicToken?.project_id as string | null) ?? null,
    scopeItemName: (magicToken?.scope_item_name as string | null) ?? null,
    scopeItemDescription: (magicToken?.scope_item_description as string | null) ?? null,
  }
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
