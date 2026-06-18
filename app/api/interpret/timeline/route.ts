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

    const prompt = `Analyze this creative brief and return a timeline recommendation.

Before estimating, identify and weight these signals from the brief:
- Number of shoot days implied (locations, talent volume, set complexity)
- Post-production complexity (VFX language, animation, color/grade specificity)
- Deliverable volume (cuts, formats, markets mentioned)
- Client approval language (review rounds implied, regulated category)
- Any stated deadlines or go-live dates

Your phases and week ranges must reflect what is specifically stated or implied in THIS brief. If the brief contains no signals for a particular phase driver, state what assumption you made in the justification.

Also extract a 2-3 sentence plain-language summary of the project for brief_summary - what it is, who it is for, and what makes it distinctive. Written to pre-fill an RFP description field.

Return JSON matching this exact schema:
{
  "brief_summary": string,
  "total_weeks_min": number,
  "total_weeks_max": number,
  "phases": [
    {
      "name": string,
      "weeks_min": number,
      "weeks_max": number,
      "description": string
    }
  ],
  "justification": string
}

justification: 3-5 sentences. Cite specific language or signals from the brief. Written for an experienced producer. No hedging - state what the signals indicate and why they drive the estimate.

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
    console.error("[interpret/timeline]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
