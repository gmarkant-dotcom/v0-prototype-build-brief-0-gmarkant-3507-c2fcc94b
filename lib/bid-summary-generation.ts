import type { SupabaseClient } from "@supabase/supabase-js"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, formatBidContextForPrompt } from "@/lib/bid-analysis-context"

const ANALYST_SYSTEM_PROMPT =
  "You are a procurement analyst helping a creative or production agency evaluate a vendor bid. Be specific and concrete, always grounded in the bid content provided. Never use markdown formatting in your response - plain prose only."

export type BidSummaryGenerationResult =
  | {
      ok: true
      ai_summary_short: string | null
      ai_summary_detailed: string | null
      ai_summary_generated_at: string | null
      short_failed: boolean
      detailed_failed: boolean
    }
  | { ok: false; reason: "not_found" | "ai_failed" | "save_failed" }

/**
 * Shared by the agency-facing generate-summary endpoint AND the fire-and-forget
 * calls from the partner/guest bid submission handlers - callers are responsible
 * for their own auth (this function does not re-check it).
 */
export async function generateAndSaveBidSummary(
  supabase: SupabaseClient,
  responseId: string,
  agencyId: string
): Promise<BidSummaryGenerationResult> {
  const ctx = await loadBidAnalysisContext(supabase, responseId, agencyId)
  if (!ctx) return { ok: false, reason: "not_found" }

  const bidContext = formatBidContextForPrompt(ctx)

  const [shortResult, detailedResult] = await Promise.all([
    callAnthropicAnalysis({
      systemPrompt: ANALYST_SYSTEM_PROMPT,
      userContent: `${bidContext}\n\nSummarize this vendor bid in one sentence highlighting the key differentiator, proposed budget, and any notable strength or risk. Be specific to this bid.`,
      maxTokens: 200,
    }),
    callAnthropicAnalysis({
      systemPrompt: ANALYST_SYSTEM_PROMPT,
      userContent: `${bidContext}\n\nProvide a detailed procurement analysis of this bid: (1) Executive summary of the approach, (2) Budget assessment including value analysis, (3) Timeline feasibility, (4) Key strengths, (5) Key risks or gaps. Be specific, cite numbers from the bid.`,
      maxTokens: 1400,
    }),
  ])

  if (!shortResult.success && !detailedResult.success) {
    console.error("[bid-summary-generation] both AI calls failed", { responseId })
    return { ok: false, reason: "ai_failed" }
  }

  const patch: Record<string, unknown> = { ai_summary_generated_at: new Date().toISOString() }
  if (shortResult.success) patch.ai_summary_short = shortResult.text.trim()
  if (detailedResult.success) patch.ai_summary_detailed = detailedResult.text.trim()

  const { data: updated, error: updateErr } = await supabase
    .from("partner_rfp_responses")
    .update(patch)
    .eq("id", responseId)
    .eq("agency_id", agencyId)
    .select("ai_summary_short, ai_summary_detailed, ai_summary_generated_at")
    .single()
  if (updateErr) {
    console.error("[bid-summary-generation] failed to save summary", { responseId, message: updateErr.message })
    return { ok: false, reason: "save_failed" }
  }

  return {
    ok: true,
    ai_summary_short: updated.ai_summary_short,
    ai_summary_detailed: updated.ai_summary_detailed,
    ai_summary_generated_at: updated.ai_summary_generated_at,
    short_failed: !shortResult.success,
    detailed_failed: !detailedResult.success,
  }
}
