import type { SupabaseClient } from "@supabase/supabase-js"
import { callAnthropicAnalysis } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, formatBidContextForPrompt } from "@/lib/bid-analysis-context"
import { resolveRfpRubricForResponse } from "@/lib/rfp-evaluation-criteria-server"
import { formatRubricForPrompt } from "@/lib/rfp-evaluation-criteria"

const ANALYST_SYSTEM_PROMPT =
  "You are a procurement analyst helping a creative or production agency evaluate a vendor bid. Be specific and concrete, always grounded in the bid content provided. Never use markdown formatting in your response - plain prose only. Never use a long dash of any kind; use a plain hyphen, a comma, or rewrite."

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

  // S1: the analysis is told which dimensions this RFP is actually judged on, so it can speak
  // to the agency's own rubric rather than to generic procurement dimensions. Empty for an RFP
  // using the global criteria, in which case the prompt is exactly what it was before.
  const rubric = await resolveRfpRubricForResponse(supabase, responseId, agencyId)
  const rubricText = formatRubricForPrompt(rubric)
  const bidContext = rubricText
    ? `${formatBidContextForPrompt(ctx)}\n\nThis RFP is scored against its own criteria:\n${rubricText}`
    : formatBidContextForPrompt(ctx)

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
      // S1: the detailed call asks for 1400 tokens against a prompt that now carries the
      // category breakdown, the structured proposal sections and the rubric. It was hitting
      // the shared 25s default and returning failure while the 200-token short call beside it
      // succeeded - which is exactly how a bid ended up with a stamped
      // ai_summary_generated_at and a null ai_summary_detailed. Given its own budget, inside
      // the route's raised maxDuration.
      timeoutMs: 50_000,
    }),
  ])

  if (!shortResult.success && !detailedResult.success) {
    console.error("[bid-summary-generation] both AI calls failed", { responseId })
    return { ok: false, reason: "ai_failed" }
  }
  // A partial failure is still a failure of the thing the caller asked for. It is reported
  // through short_failed/detailed_failed below rather than swallowed - see the note on the
  // return type. Logged here too, because it used to leave no trace anywhere.
  if (!detailedResult.success) {
    console.error("[bid-summary-generation] detailed analysis failed, short summary saved", {
      responseId,
      error: detailedResult.error,
    })
  }

  const patch: Record<string, unknown> = { ai_summary_generated_at: new Date().toISOString() }
  if (shortResult.success) patch.ai_summary_short = shortResult.text.trim()
  if (detailedResult.success) patch.ai_summary_detailed = detailedResult.text.trim()

  const { data: updated, error: updateErr } = await supabase
    .from("partner_rfp_responses")
    .update(patch)
    .eq("id", responseId)
    .eq("lead_org_id", agencyId)
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
