import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { streamText } from "ai"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 120

const MAX_BRIEF_CHARS = 100_000

const STYLE_MAP = {
  formal: "Formal / structured: executive tone, numbered sections, clear hierarchy.",
  lean: "Lean / conversational: concise, direct, minimal ceremony.",
  creative: "Creative agency style: punchy, brand-forward language while staying professional.",
} as const

function truncateDetail(s: string, max = 800) {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

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

    const body = await req.json().catch(() => ({}))
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
      return NextResponse.json(
        {
          error: "Brief content is required to generate a template",
          hint: "Complete Step 1a (upload, paste, link, or additional brief) before generating the output template.",
        },
        { status: 400 }
      )
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("[rfp-output-template] ANTHROPIC_API_KEY is not set")
      return NextResponse.json(
        {
          error: "AI is not configured on the server.",
          detail: "Set ANTHROPIC_API_KEY in Vercel Project → Settings → Environment Variables and redeploy.",
        },
        { status: 503 }
      )
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

    const result = streamText({
      model: "anthropic/claude-sonnet-4-20250514" as any,
      prompt,
      temperature: 0.35,
      maxOutputTokens: 8192,
      abortSignal: req.signal,
    })

    return result.toTextStreamResponse()
  } catch (error) {
    Sentry.captureException(error)
    console.error("[rfp-output-template] error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    const missingKey =
      /API key|api key|ANTHROPIC|authentication|401|unauthorized/i.test(msg) &&
      !/Subscription required/i.test(msg)
    return NextResponse.json(
      {
        error: missingKey
          ? "AI is not configured (missing or invalid API key)."
          : "Failed to generate output template",
        detail: truncateDetail(msg),
      },
      { status: 500 }
    )
  }
}
