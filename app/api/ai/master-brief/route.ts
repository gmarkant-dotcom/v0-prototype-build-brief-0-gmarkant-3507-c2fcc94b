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

    const prompt = hasTemplateBody
      ? `You are producing a structured master brief for an agency RFP workflow by integrating SOURCE CLIENT BRIEF material into the OUTPUT FORMAT TEMPLATE below.

The OUTPUT FORMAT TEMPLATE is the canonical structure: follow its section order, headings, implied fields, tone, and level of detail. Map and synthesize content from the CLIENT BRIEF into that structure. Do not invent facts; you may use neutral placeholders only where the brief is silent and the template expects a field.

Return ONLY valid JSON. No markdown.

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
}

Rules:
- Keep scopeItems between 5 and 10 unless the template clearly implies fewer or more; prefer 5–10.
- Name scope items and descriptions so they mirror the template’s deliverable groupings where possible.
- If budget/timeline missing in the brief, use practical placeholders (e.g. "TBD").

Project context:
Project Name: ${projectName}
Client Name: ${clientName}
Template label (reference): ${templateHint}

---

OUTPUT FORMAT TEMPLATE (structure and style to follow):
${templateText}

---

CLIENT BRIEF (source material to integrate):
${briefText}`
      : `You are generating a structured master brief for an agency RFP workflow.
Return ONLY valid JSON. No markdown.

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
}

Rules:
- Keep scopeItems between 5 and 10.
- Use realistic agency workflow deliverables.
- If budget/timeline missing, provide practical placeholders.

Inputs:
Project Name: ${projectName}
Client Name: ${clientName}
Template Hint: ${templateHint}
Brief Content:
${briefText}`

    const result = await generateText({
      model: "anthropic/claude-sonnet-4-20250514" as any,
      prompt,
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

