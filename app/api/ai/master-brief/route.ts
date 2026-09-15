import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { generateText, Output } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { canUseAgencyAi, resolveCallerOrgIds, resolveCallerWriteOrgId } from "@/lib/entitlements"
import { recordMilestone } from "@/lib/milestone-events"

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

    // 079: entitlement moves onto the organization. Read the org's entitlement here rather
    // than this member's profile flag, and key it with agencyEntitlementId(user.id).
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role, is_admin")
      .eq("id", user.id)
      .single()

    // 092: the billing half reads the ACTING ORGANIZATION's organizations.is_paid. The
    // portal half is unchanged and is still checked first, so a vendor-side caller never
    // causes an organizations read.
    if (!(await canUseAgencyAi(profile, user.id, supabase))) {
      return NextResponse.json({ error: "Subscription required for AI features" }, { status: 403 })
    }

    const body = await req.json()
    const requestedProjectId =
      typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null
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
0) PUNCTUATION: never use a long dash of any kind in any output. Use a plain hyphen, a comma, or
   rewrite the sentence. This applies to every field you return, including scope item titles.
3) "overview" must be a faithful synthesis of the brief (specific themes, goals, and constraints from the brief - not generic agency filler).
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

CLIENT BRIEF (read first - primary content):
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
      model: anthropic("claude-sonnet-4-6"),
      output: Output.object({
        schema: masterBriefSchema,
      }),
      prompt,
      temperature: 0.25,
      maxOutputTokens: 8192,
    })

    /**
     * Milestone: rfp.generate. RULING 4, 2026-09-14.
     *
     * GREG'S RULING: EMIT, AND IT IS AGENCY-ONLY STRUCTURALLY RATHER THAN BY WHITELIST.
     * At generation time the RFP has not been broadcast, so there are no recipients, no
     * vendor and no partnership. The row carries `partnership_id = NULL` and gate 2 fails on
     * its FIRST clause - `partnership_id IS NOT NULL` (080:350-362) - whatever
     * `vendor_visible_event_types()` says. There is no counterparty-visible option to weigh
     * here; the only way to get one would be to re-scope generation to emit after recipients
     * are known, which is what `rfp.broadcast` already is.
     *
     * The case FOR emitting is the colleague: without it a teammate cannot see that drafting
     * happened at all, and the day's work renders as one broadcast line with nothing before
     * it. The cost is one line per run, and the grouping in lib/activity-feed.ts cannot
     * collapse separate runs because they do not share a transaction timestamp - so an RFP
     * drafted four times renders four lines. That is the ruling's own accounting and it is
     * accepted, not worked around.
     *
     * >>> ONE TYPE, NOT TWO. `rfp.regenerate` IS DELIBERATELY NOT EMITTED. <<<
     *
     * Greg's ruling, 2026-09-14, overruling the two-wording draft. NOTHING PERSISTS A
     * GENERATION RUN - this route writes no row, and the master brief lives in React state
     * until the RFP is broadcast - so THE SERVER CANNOT TELL A FIRST DRAFT FROM A REDRAFT.
     * The only available discriminator is a flag from the browser, and every event type in
     * this product is server-determined. One type that is honest beats two where one is a
     * client's claim about itself, and the precedent of trusting a client for an event type
     * is the thing being refused: once one type takes it, the next one will.
     * `rfp.regenerate` stays in CAPABILITY_MINIMUM_ROLE as a permission key and is recorded
     * as an owed ruling in docs/emitter-rulings-owed.md.
     *
     * >>> THE PAYLOAD RULE, ENFORCED AT THE EMIT RATHER THAN ASKED FOR IN A COMMENT. <<<
     *
     * THE PAYLOAD IS EMPTY. Not "scrubbed", not "filtered" - there is no expression below
     * that can reach the prompt, the model output, the token counts or a cost figure,
     * because none of them is written. `result`, `prompt`, `briefText` and `templateText`
     * are all in scope at this line and every one of them is agency internal state under the
     * test in docs/broadcast-payload-leak-fix.md: the client's brief is the client's, the
     * prompt is the agency's method, and a token or cost figure is a fact about the agency's
     * tooling and its bill. The ruling names these as "the field most likely to be reached
     * for here", and the defence against reaching for them is that the object is `{}`.
     *
     * The line's only variable is the PROJECT, and it is resolved from `subject_id` through
     * the dashboard's own `projects` read - never from a payload.
     *
     * WHY THE PROJECT ID IS VERIFIED AND NOT TRUSTED. The browser names the project, because
     * only the browser knows which one is selected. The server then proves the caller owns
     * it, and drops it to NULL if not. That is the same rule the paragraph above applies to
     * the event type, not an exception to it: a client may SUPPLY a value the server can
     * check, and may never DECIDE one the server cannot.
     *
     * AFTER THE GENERATION, AND FIRE-AND-FORGET. `recordMilestone()` catches everything and
     * returns void. A breadcrumb must never cost the agency a brief that took 90 seconds to
     * produce - which is also why this sits after `generateText` resolved and before the
     * response is composed.
     */
    try {
      const writeOrgId = await resolveCallerWriteOrgId(user.id, supabase)
      let milestoneProjectId: string | null = null
      if (requestedProjectId) {
        const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)
        if (callerOrgIds.length > 0) {
          const { data: ownedProject } = await supabase
            .from("projects")
            .select("id")
            .eq("id", requestedProjectId)
            .in("org_id", callerOrgIds)
            .maybeSingle()
          milestoneProjectId = (ownedProject?.id as string | null) ?? null
        }
      }

      await recordMilestone(supabase, {
        eventType: "rfp.generate",
        // 079 PARAMETER CLASS: the acting organization, never `user.id`. A profiles id here
        // raises 23503 against milestone_events_org_id_org_fkey. A caller with no
        // organization resolves null and lib/milestone-events.ts drops the event loudly
        // rather than writing a row nobody could read.
        orgId: writeOrgId,
        actorId: user.id,
        // No vendor and no partnership: nobody has been sent anything yet. This is what
        // makes the row agency-only structurally rather than by whitelist.
        vendorOrgId: null,
        partnershipId: null,
        subjectType: "project",
        subjectId: milestoneProjectId,
        // See above. Empty is the enforcement.
        payload: {},
      })
    } catch (milestoneErr) {
      // recordMilestone() never throws; this catches the two lookups above it. A missing
      // breadcrumb must never cost the agency the brief.
      console.error("[ai/master-brief] rfp.generate milestone failed (non-fatal)", milestoneErr)
    }

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
    Sentry.captureException(error)
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

