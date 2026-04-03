import { NextResponse } from "next/server"
import { generateText, Output } from "ai"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const maxDuration = 120

const noStore = { "Cache-Control": "private, no-store, no-cache, must-revalidate" } as const

const milestoneSuggestionSchema = z.object({
  title: z.string(),
  amount: z.number(),
  currency: z.string(),
  due_date: z.string().describe("ISO 8601 calendar date, e.g. 2026-06-30"),
  notes: z.string(),
})

const scheduleOutSchema = z.object({
  milestones: z.array(milestoneSuggestionSchema).min(1).max(15),
})

function unwrapInbox(
  embed:
    | {
        project_id?: string | null
        partnership_id?: string | null
        scope_item_name?: string | null
        scope_item_description?: string | null
        estimated_budget?: string | null
        timeline?: string | null
      }
    | null
    | undefined
    | unknown[]
) {
  if (!embed) return null
  const row = Array.isArray(embed) ? embed[0] : embed
  if (!row || typeof row !== "object") return null
  return row as {
    project_id?: string | null
    partnership_id?: string | null
    scope_item_name?: string | null
    scope_item_description?: string | null
    estimated_budget?: string | null
    timeline?: string | null
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
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
      (profile?.role === "agency" && (profile?.is_paid || profile?.is_admin))

    if (!allowed) {
      return NextResponse.json({ error: "Subscription required for AI features" }, { status: 403, headers: noStore })
    }

    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    const body = await req.json().catch(() => ({}))
    const project_id = (body.project_id as string | undefined)?.trim()
    const partnership_id = (body.partnership_id as string | undefined)?.trim() || null
    const response_id = (body.response_id as string | undefined)?.trim()

    console.log("[ai-schedule] body", { project_id, response_id, partnership_id })

    if (!project_id || !response_id) {
      return NextResponse.json(
        { error: "project_id and response_id are required" },
        { status: 400, headers: noStore }
      )
    }

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id, title, client_name, budget_range")
      .eq("id", project_id)
      .eq("agency_id", user.id)
      .maybeSingle()
    console.log("[ai-schedule] project lookup", {
      project_id,
      found: !!project,
      error: pErr?.message,
    })
    if (pErr || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStore })
    }

    const { data: resp, error: rErr } = await supabase
      .from("partner_rfp_responses")
      .select(
        `
        id,
        partner_id,
        proposal_text,
        budget_proposal,
        timeline_proposal,
        partner_rfp_inbox (
          project_id,
          partnership_id,
          scope_item_name,
          scope_item_description,
          estimated_budget,
          timeline
        )
      `
      )
      .eq("id", response_id)
      .eq("agency_id", user.id)
      .eq("status", "awarded")
      .maybeSingle()

    console.log("[ai-schedule] response lookup", {
      response_id,
      found: !!resp,
      error: rErr?.message,
    })
    if (rErr || !resp) {
      return NextResponse.json({ error: "Awarded response not found" }, { status: 404, headers: noStore })
    }

    const inbox = unwrapInbox(resp.partner_rfp_inbox as Parameters<typeof unwrapInbox>[0])
    if (!inbox?.project_id || String(inbox.project_id) !== project_id) {
      return NextResponse.json({ error: "Response does not match project" }, { status: 400, headers: noStore })
    }

    if (partnership_id && inbox.partnership_id != null && String(inbox.partnership_id) !== partnership_id) {
      return NextResponse.json({ error: "Response does not match partnership" }, { status: 400, headers: noStore })
    }

    const { data: existingMilestones } = await supabase
      .from("payment_milestones")
      .select("title, amount, currency, due_date, status, notes")
      .eq("agency_id", user.id)
      .eq("response_id", response_id)

    const { data: partnerProfile } = await supabase
      .from("profiles")
      .select("company_name, display_name, full_name, bio, website")
      .eq("id", resp.partner_id as string)
      .maybeSingle()

    const projectName = ((project.title || "") as string).trim() || "Project"
    const clientName = ((project.client_name as string | null) || "").trim() || "Client"

    const scopeName = (inbox.scope_item_name || "").trim() || "Scope"
    const scopeDesc = (inbox.scope_item_description || "").trim()
    const inboxBudget = (inbox.estimated_budget || "").trim()
    const inboxTimeline = (inbox.timeline || "").trim()

    const partnerCtx = partnerProfile
      ? [
          `Partner company: ${partnerProfile.company_name || "—"}`,
          `Partner display name: ${partnerProfile.display_name || partnerProfile.full_name || "—"}`,
          partnerProfile.bio ? `Partner bio: ${partnerProfile.bio}` : "",
          partnerProfile.website ? `Website: ${partnerProfile.website}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "Partner profile: not available"

    const existingBlock =
      (existingMilestones || []).length > 0
        ? JSON.stringify(existingMilestones, null, 2)
        : "None yet for this awarded response."

    const prompt = `You are helping a lead agency design a payment milestone schedule for an outsourced scope that was awarded to a partner.

Project: ${projectName}
Client: ${clientName}
Scope line item: ${scopeName}
Scope description (if any): ${scopeDesc || "—"}
Inbox estimated budget hint: ${inboxBudget || "—"}
Inbox timeline hint: ${inboxTimeline || "—"}

Partner's awarded proposal (text):
${(resp.proposal_text as string) || "—"}

Partner's budget proposal (structured text/JSON as stored):
${(resp.budget_proposal as string) || "—"}

Partner's timeline proposal (as stored):
${(resp.timeline_proposal as string) || "—"}

${partnerCtx}

Existing milestones already recorded for this awarded response (avoid duplicating unless improving structure):
${existingBlock}

Return a JSON object with key "milestones": an array of 3–8 payment milestones that fit the scope, awarded budget, and timeline. Each milestone must have:
- title: short label (e.g. "Kickoff", "Creative delivery")
- amount: positive number (numeric only)
- currency: ISO code like USD
- due_date: ISO 8601 date string (YYYY-MM-DD preferred)
- notes: one sentence rationale tied to deliverables or timing

Total of suggested amounts should not exceed the implied awarded budget unless the brief clearly allows; align dates with the proposed timeline.`

    const result = await generateText({
      model: "anthropic/claude-sonnet-4-20250514" as any,
      output: Output.object({
        schema: scheduleOutSchema,
        schemaName: "PaymentMilestoneSchedule",
        schemaDescription: "Suggested payment milestones for an awarded partner scope",
      }),
      prompt,
      temperature: 0.3,
      maxOutputTokens: 4096,
    })

    const parsed = result.output
    if (!parsed?.milestones?.length) {
      return NextResponse.json(
        { error: "AI returned no milestone suggestions", detail: result.text?.slice(0, 500) },
        { status: 500, headers: noStore }
      )
    }

    return NextResponse.json({ milestones: parsed.milestones }, { headers: noStore })
  } catch (error) {
    console.error("[api/agency/msa/ai-schedule]", error)
    const msg = error instanceof Error ? error.message : String(error)
    const missingKey =
      /API key|api key|ANTHROPIC|authentication|401|unauthorized/i.test(msg) &&
      !/Subscription required/i.test(msg)
    return NextResponse.json(
      {
        error: missingKey ? "AI is not configured (missing or invalid API key)." : "Failed to generate schedule",
        detail: process.env.NODE_ENV === "development" ? msg : undefined,
      },
      { status: 500, headers: noStore }
    )
  }
}
