import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { callAnthropicAnalysis, tryParseJsonObject } from "@/lib/ai-bid-analysis"
import { loadBidAnalysisContext, formatBidContextForPrompt } from "@/lib/bid-analysis-context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 45

const DECOMPOSE_SYSTEM_PROMPT =
  "You are analyzing a vendor bid for a creative/production agency. Extract a line-item cost breakdown from this proposal. Use categories appropriate to the scope type. For each line item, provide: category name, dollar amount (estimate if not explicit), percentage of total budget, and the vendor's description. Then provide a brief narrative summary of the overall cost structure, noting any categories that seem over or under-allocated relative to the scope. Return as JSON: { line_items: [{ category, amount, percentage_of_total, description }], narrative_summary: string }. Return ONLY the JSON object, no markdown, no preamble."

type LineItem = {
  category: string
  amount: number
  percentage_of_total: number
  description: string
}

type DecomposeAiResponse = {
  line_items?: unknown
  narrative_summary?: unknown
}

function normalizeLineItems(raw: unknown): LineItem[] {
  if (!Array.isArray(raw)) return []
  const out: LineItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const o = entry as Record<string, unknown>
    const category = String(o.category ?? "").trim()
    if (!category) continue
    const amount = typeof o.amount === "number" ? o.amount : parseFloat(String(o.amount ?? ""))
    const percentage_of_total =
      typeof o.percentage_of_total === "number" ? o.percentage_of_total : parseFloat(String(o.percentage_of_total ?? ""))
    const description = String(o.description ?? "").trim()
    out.push({
      category,
      amount: Number.isFinite(amount) ? amount : 0,
      percentage_of_total: Number.isFinite(percentage_of_total) ? percentage_of_total : 0,
      description,
    })
  }
  return out
}

export async function POST(req: Request, { params }: { params: Promise<{ responseId: string }> }) {
  const route = "/api/agency/bids/[responseId]/decompose"
  try {
    const { responseId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role")
      .eq("id", user.id)
      .single()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const force = body?.force === true

    if (!force) {
      const { data: existing } = await supabase
        .from("bid_decompositions")
        .select("line_items, narrative_summary, generated_at")
        .eq("response_id", responseId)
        .eq("agency_id", user.id)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({
          line_items: existing.line_items,
          narrative_summary: existing.narrative_summary,
          generated_at: existing.generated_at,
          cached: true,
        })
      }
    }

    const ctx = await loadBidAnalysisContext(supabase, responseId, user.id)
    if (!ctx) return NextResponse.json({ error: "Bid not found" }, { status: 404 })

    const bidContext = formatBidContextForPrompt(ctx)
    const result = await callAnthropicAnalysis({
      systemPrompt: DECOMPOSE_SYSTEM_PROMPT,
      userContent: bidContext,
      maxTokens: 2048,
      timeoutMs: 40_000,
    })

    if (!result.success) {
      console.error("[api] failure", { route, method: "POST", responseId, message: result.error })
      return NextResponse.json({ error: "Analysis unavailable" }, { status: 502 })
    }

    const parsed = tryParseJsonObject<DecomposeAiResponse>(result.text)
    const lineItems = parsed ? normalizeLineItems(parsed.line_items) : []
    // Malformed AI output: store the raw text as the narrative rather than losing it,
    // with an empty line-item table instead of failing the request outright.
    const narrativeSummary = parsed
      ? typeof parsed.narrative_summary === "string"
        ? parsed.narrative_summary
        : ""
      : result.text.trim()

    const { data: saved, error: upsertErr } = await supabase
      .from("bid_decompositions")
      .upsert(
        {
          response_id: responseId,
          agency_id: user.id,
          line_items: lineItems,
          narrative_summary: narrativeSummary,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "response_id" }
      )
      .select("line_items, narrative_summary, generated_at")
      .single()

    if (upsertErr) {
      console.error("[api] failure", { route, method: "POST", responseId, message: upsertErr.message })
      return NextResponse.json({ error: "Failed to save cost breakdown" }, { status: 500 })
    }

    return NextResponse.json({
      line_items: saved.line_items,
      narrative_summary: saved.narrative_summary,
      generated_at: saved.generated_at,
      cached: false,
    })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/bids/[responseId]/decompose",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to analyze cost structure" }, { status: 500 })
  }
}
