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

    const prompt = `Analyze this creative brief and recommend 4-6 directors or production companies that would be an excellent fit.

CRITICAL: Only recommend directors and production companies whose commercial work you can specifically cite. Do not recommend anyone whose credits you are uncertain about. If you are not confident in a specific credit, omit it rather than approximate. Hallucinated credits will damage trust with experienced producers.

Your recommendations must be specific to THIS brief - not a default list of prominent commercial directors. Consider fit across:
- Aesthetic match (visual language of their body of work vs this brief's tone)
- Scale match (their typical budget tier vs signals in this brief)
- Category experience (brand or product category familiarity)
- Cultural or casting fit (if the brief specifies demographic or cultural specificity)

Do not default to the most famous names in commercial production. If a less prominent but more precisely matched director exists, recommend them. Genuine fit matters more than name recognition.

Return JSON matching this exact schema:
{
  "recommendations": [
    {
      "name": string,
      "company": string,
      "known_for": string,
      "notable_credits": string,
      "fit_reason": string
    }
  ]
}

known_for: 1-2 sentences on their aesthetic and body of work.
notable_credits: 2-3 real, verifiable campaign credits with brand names.
fit_reason: 2-3 sentences explaining specifically why they fit THIS brief. Reference their demonstrated aesthetic against signals in the brief.

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
    console.error("[interpret/directors]", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
