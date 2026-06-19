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

    const prompt = `Analyze this creative brief and find 4-6 real comparable campaigns produced between 2020 and 2025.

Your selections must be specific to THIS brief - not a default list of celebrated campaigns. They must be differentiated across at least three of these dimensions:
- Visual approach (not all the same aesthetic)
- Production scale (reflect the budget signals in the brief)
- Brand category (include at least one from outside the brief's primary category if creatively comparable)
- Geography (include non-US work if comparable international campaigns exist)

For each campaign, cite at least one specific creative or production element that directly maps to language or implied requirements in this brief. Generic "similar brand values" reasoning is not acceptable.

Return JSON matching this exact schema:
{
  "campaigns": [
    {
      "title": string,
      "brand": string,
      "year": number,
      "director": string,
      "production_company": string,
      "relevance": string
    }
  ]
}

relevance: 2-3 sentences explaining specifically why this campaign is comparable. Reference creative approach, production scale, visual language, or category. Must cite something specific from THIS brief.

Brief:
${brief_text}`

    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      system: SYSTEM,
      prompt,
    })

    const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim()
    const result = JSON.parse(cleaned)
    return NextResponse.json({ result })
  } catch (e) {
    console.error("[interpret/campaigns]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
