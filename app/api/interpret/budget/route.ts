import { anthropic } from "@ai-sdk/anthropic"
import { generateText } from "ai"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 90

const SYSTEM = `You are a senior executive producer and creative consultant with 20 years of experience in commercial film, brand content, and large-scale production. You assess creative briefs with precision and produce analysis that experienced producers, creative directors, and agency leads would trust and act on. Your output must be specific to the brief provided - not generic industry averages. Return only valid JSON matching the schema provided. No markdown, no preamble, no explanation outside the JSON.`

export async function POST(req: NextRequest) {
  try {
    const { brief_text } = await req.json()
    if (!brief_text?.trim()) {
      return NextResponse.json({ error: "brief_text required" }, { status: 400 })
    }

    const prompt = `Analyze this creative brief and return a budget estimate.

Before estimating, identify these cost signals from the brief:
- Union vs non-union indicators (SAG/AFTRA language, market, usage scope)
- Talent volume and type (hero talent, background, VO, celebrity)
- Location complexity (practical vs stage, number of cities, international)
- Fabrication or custom build requirements
- VFX, animation, or motion graphics specificity
- Usage and licensing scope (national broadcast, digital only, OOH, global)
- Brand category (CPG, auto, pharma, fashion each carry different cost norms)

Line items must be driven by what THIS brief contains. If a line item is an assumption because the brief is silent on it, begin that line item label with "ASSUMED:" so the producer knows.

Return JSON matching this exact schema:
{
  "total_low": number,
  "total_high": number,
  "currency": "USD",
  "line_items": [
    {
      "label": string,
      "low": number,
      "high": number
    }
  ],
  "justification": string
}

justification: 3-5 sentences. Identify the primary cost drivers and cite the specific brief language that signals them. Call out any major unknowns that could move the range significantly. Written for an experienced producer. No hedging.

Brief:
${brief_text}`

    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: SYSTEM,
      prompt,
    })

    const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim()
    const result = JSON.parse(cleaned)
    return NextResponse.json({ result })
  } catch (e) {
    console.error("[interpret/budget]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
