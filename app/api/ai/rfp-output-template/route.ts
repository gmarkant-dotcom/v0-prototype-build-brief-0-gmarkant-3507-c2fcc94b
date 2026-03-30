import { NextResponse } from "next/server"
import { generateText } from "ai"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 120

const MAX_BRIEF_CHARS = 100_000

const STYLE_MAP = {
  formal: "Formal / structured: executive tone, numbered sections, clear hierarchy.",
  lean: "Lean / conversational: concise, direct, minimal ceremony.",
  creative: "Creative agency style: punchy, brand-forward language while staying professional.",
} as const

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_paid, is_admin")
      .eq("id", user.id)
      .single()

    const isDemo = process.env.NEXT_PUBLIC_IS_DEMO === "true"
    const allowed =
      isDemo ||
      profile?.is_admin ||
      profile?.role === "partner" ||
      (profile?.role === "agency" && (profile?.is_paid || profile?.is_admin))

    if (!allowed) {
      return NextResponse.json({ error: "Subscription required for AI features" }, { status: 403 })
    }

    const body = await req.json()
    let briefText = (body.briefText || "").toString()
    const templateStyle = (body.templateStyle || "formal").toString() as keyof typeof STYLE_MAP
    const outputFormat = (body.outputFormat || "section").toString()
    const sensitivity = body.sensitivity || {}

    const scrubBrand = Boolean(sensitivity.scrubBrand)
    const scrubBudget = Boolean(sensitivity.scrubBudget)
    const scrubStrategy = Boolean(sensitivity.scrubStrategy)
    const scrubTimeline = Boolean(sensitivity.scrubTimeline)

    if (briefText.length > MAX_BRIEF_CHARS) {
      briefText = `${briefText.slice(0, MAX_BRIEF_CHARS)}\n\n[... truncated ...]`
    }

    if (!briefText.trim()) {
      return NextResponse.json({ error: "Brief content is required to generate a template" }, { status: 400 })
    }

    const styleLine =
      STYLE_MAP[templateStyle in STYLE_MAP ? templateStyle : "formal"] || STYLE_MAP.formal

    const formatLine =
      outputFormat === "modular"
        ? "MODULAR: each major workstream is its own top-level section block (standalone modules)."
        : "SECTION-BASED: one cohesive RFP document with all workstreams in a single flowing structure."

    const scrubRules = [
      scrubBrand
        ? "Replace identifiable client/brand names with an industry category label (e.g. 'a national beverage brand')."
        : null,
      scrubBudget
        ? "Replace specific budget numbers with tier descriptors (e.g. 'mid–six-figure program', 'upper five-figure pilot')."
        : null,
      scrubStrategy
        ? "Generalize campaign-specific tactics; keep workstreams and deliverables described at a reusable, category level."
        : null,
      scrubTimeline
        ? "Replace calendar dates with relative phases (e.g. Phase 1 kickoff, Phase 2 production) without specific dates."
        : null,
    ]
      .filter(Boolean)
      .join("\n")

    const prompt = `You are helping a lead agency produce an OUTPUT FORMAT TEMPLATE for a Master RFP document.

This template defines STRUCTURE, HEADINGS, and SECTION ORDER only — not the final factual RFP. Another step will merge the real client brief into this shape.

${styleLine}

${formatLine}

Sensitivity (apply to how you label sections and placeholder examples in the template only — the CLIENT BRIEF below is still the source for any example phrasing you echo):
${scrubRules || "No extra scrubbing rules — use neutral placeholder examples where needed."}

Write a plain-text outline the Master RFP generator can follow. Include:
- Title block pattern
- Executive summary / overview section
- Objectives / success metrics area
- Scope / workstreams (mirror the modular vs section-based choice)
- Budget and timeline sections as labeled fields (use placeholders if scrubbing applies)
- Assumptions, evaluation criteria, submission instructions (brief)

Do not output JSON. Use markdown-style headings (##) for sections. Keep it under 6000 words.

---

CLIENT BRIEF (for context — respect scrubbing rules only when illustrating placeholder style):
${briefText}`

    const result = await generateText({
      model: "anthropic/claude-sonnet-4-20250514" as any,
      prompt,
      temperature: 0.35,
      maxOutputTokens: 8192,
    })

    const templateText = (result.text || "").trim()
    if (!templateText) {
      return NextResponse.json({ error: "Empty AI response" }, { status: 500 })
    }

    return NextResponse.json({ templateText })
  } catch (error) {
    console.error("rfp-output-template error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    const missingKey =
      /API key|api key|ANTHROPIC|authentication|401|unauthorized/i.test(msg) &&
      !/Subscription required/i.test(msg)
    return NextResponse.json(
      {
        error: missingKey
          ? "AI is not configured (missing or invalid API key)."
          : "Failed to generate output template",
        detail: process.env.NODE_ENV === "development" ? msg : undefined,
      },
      { status: 500 }
    )
  }
}
