import { NextResponse } from "next/server"
import { generateText } from "ai"
import { createClient } from "@/lib/supabase/server"

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
    const projectName = (body.projectName || "New Project").toString()
    const clientName = (body.clientName || "Client TBD").toString()
    const briefText = (body.briefText || "").toString()
    const templateHint = (body.templateHint || "Default template").toString()
    const templateText = (body.templateText || "").toString().trim()

    if (!briefText.trim()) {
      return NextResponse.json({ error: "Brief content is required" }, { status: 400 })
    }

    const hasTemplateBody = templateText.length > 0

    const jsonSchemaBlock = `Return ONLY valid JSON. No markdown.

Schema:
{
  "projectName": string,
  "client": string,
  "overview": string,
  "objectives": string[],
  "totalBudget": string,
  "timeline": string,
  "scopeItems": [
    {
      "id": string,
      "name": string,
      "description": string,
      "estimatedBudget": string,
      "timeline": string
    }
  ]
}`

    const groundingRules = `CRITICAL GROUNDING (must follow):
1) The CLIENT BRIEF text below is the ONLY source of truth for requirements, audiences, deliverables, constraints, names, budgets, dates, and success metrics.
2) Do NOT invent campaigns, brands, products, KPIs, or scope that are not clearly stated or strongly implied in the CLIENT BRIEF.
3) "overview" must be a faithful synthesis of the brief (specific themes, goals, and constraints from the brief — not generic agency filler).
4) "objectives" must map to goals/outcomes described in the brief (or split one stated goal into clear bullets). If the brief lists none, derive the minimum from the brief context; use "TBD" only if truly absent.
5) "scopeItems" must reflect actual workstreams/deliverables from the brief. Name and describe them using terminology from the brief when possible. Prefer 5–10 items unless the brief implies fewer.
6) "totalBudget" and "timeline" must come from the brief when present; otherwise "TBD" or a short honest placeholder.
7) Project Name / Client fields: use values from the brief if they appear; otherwise use the Project context below.`

    const prompt = hasTemplateBody
      ? `You integrate a CLIENT BRIEF into a structured master RFP for an agency workflow.

${groundingRules}

The OUTPUT FORMAT TEMPLATE defines STRUCTURE ONLY: section order, headings, implied fields, and tone. It is NOT a second source of facts. Ignore any lorem ipsum, sample company names, or example metrics in the template unless the same facts appear in the CLIENT BRIEF.

${jsonSchemaBlock}

Project context (use when the brief does not name these):
Project Name: ${projectName}
Client Name: ${clientName}
Template file label: ${templateHint}

---

CLIENT BRIEF (read first — primary content):
${briefText}

---

OUTPUT FORMAT TEMPLATE (structure / layout reference only):
${templateText}`
      : `You generate a structured master brief for an agency RFP workflow from the CLIENT BRIEF.

${groundingRules}

${jsonSchemaBlock}

Project context (use when the brief does not name these):
Project Name: ${projectName}
Client Name: ${clientName}
Template label: ${templateHint}

---

CLIENT BRIEF:
${briefText}`

    const result = await generateText({
      model: "anthropic/claude-sonnet-4-20250514" as any,
      prompt,
      temperature: 0.25,
      maxOutputTokens: 8192,
    })

    const parsed = tryParseJsonObject(result.text)
    if (!parsed) {
      return NextResponse.json({ error: "AI response parse failed" }, { status: 500 })
    }

    return NextResponse.json({ masterBrief: parsed })
  } catch (error) {
    console.error("master-brief error:", error)
    return NextResponse.json({ error: "Failed to generate master brief" }, { status: 500 })
  }
}

function tryParseJsonObject(input: string): any | null {
  try {
    return JSON.parse(input)
  } catch {
    const start = input.indexOf("{")
    const end = input.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(input.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

