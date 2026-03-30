import { NextResponse } from "next/server"
import { generateText, Output } from "ai"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const scopeItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  estimatedBudget: z.string().optional().default(""),
  timeline: z.string().optional().default(""),
})

const masterBriefSchema = z.object({
  projectName: z.string(),
  client: z.string(),
  overview: z.string(),
  objectives: z.array(z.string()),
  totalBudget: z.string(),
  timeline: z.string(),
  scopeItems: z.array(scopeItemSchema).min(1).max(15),
})

/** Allow long Claude calls on Vercel (raise in dashboard if plan caps lower). */
export const maxDuration = 120

const MAX_BRIEF_CHARS = 100_000
const MAX_TEMPLATE_CHARS = 80_000

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
    let briefText = (body.briefText || "").toString()
    const templateHint = (body.templateHint || "Default template").toString()
    let templateText = (body.templateText || "").toString().trim()

    if (briefText.length > MAX_BRIEF_CHARS) {
      briefText = `${briefText.slice(0, MAX_BRIEF_CHARS)}\n\n[... brief truncated for processing ...]`
    }
    if (templateText.length > MAX_TEMPLATE_CHARS) {
      templateText = `${templateText.slice(0, MAX_TEMPLATE_CHARS)}\n\n[... template truncated ...]`
    }

    if (!briefText.trim()) {
      return NextResponse.json({ error: "Brief content is required" }, { status: 400 })
    }

    const hasTemplateBody = templateText.length > 0

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

Produce the structured master brief (projectName, client, overview, objectives, totalBudget, timeline, scopeItems with id/name/description/estimatedBudget/timeline per item). Prefer 5–10 scope items.

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

Produce the structured master brief fields as specified. Prefer 5–10 scope items.

Project context (use when the brief does not name these):
Project Name: ${projectName}
Client Name: ${clientName}
Template label: ${templateHint}

---

CLIENT BRIEF:
${briefText}`

    const result = await generateText({
      model: "anthropic/claude-sonnet-4-20250514" as any,
      output: Output.object({
        schema: masterBriefSchema,
        schemaName: "MasterBrief",
        schemaDescription:
          "Agency master RFP brief: project summary, objectives, budget/timeline strings, and scope line items",
      }),
      prompt,
      temperature: 0.25,
      maxOutputTokens: 8192,
    })

    const parsed = result.output
    if (!parsed) {
      const fallback = tryParseJsonObject(result.text)
      if (fallback) {
        return NextResponse.json({ masterBrief: fallback })
      }
      return NextResponse.json(
        {
          error: "AI response parse failed",
          hint: "Try again or shorten inputs. If this persists, confirm the model supports structured output with your AI SDK version.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ masterBrief: parsed })
  } catch (error) {
    console.error("master-brief error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    const missingKey =
      /API key|api key|ANTHROPIC|authentication|401|unauthorized/i.test(msg) &&
      !/Subscription required/i.test(msg)
    return NextResponse.json(
      {
        error: missingKey
          ? "AI is not configured (missing or invalid API key)."
          : "Failed to generate master brief",
        detail: process.env.NODE_ENV === "development" ? msg : undefined,
      },
      { status: 500 }
    )
  }
}

function stripMarkdownFence(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, "")
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/im.exec(s)
  if (fence) s = fence[1].trim()
  return s
}

/** Extract first top-level `{ ... }` with string-aware brace matching (fixes bad lastIndexOf slice). */
function extractBalancedJsonObject(input: string): string | null {
  const s = stripMarkdownFence(input)
  const start = s.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === "\\" && inString) {
      escape = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (!inString) {
      if (c === "{") depth++
      else if (c === "}") {
        depth--
        if (depth === 0) return s.slice(start, i + 1)
      }
    }
  }
  return null
}

function tryParseJsonObject(input: string): any | null {
  const cleaned = stripMarkdownFence(input)
  try {
    return JSON.parse(cleaned)
  } catch {
    const extracted = extractBalancedJsonObject(cleaned)
    if (extracted) {
      try {
        return JSON.parse(extracted)
      } catch {
        return null
      }
    }
    return null
  }
}

