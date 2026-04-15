import { NextResponse } from "next/server"
import { generateText } from "ai"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"
export const maxDuration = 120

const noStore = { "Cache-Control": "private, no-store, no-cache, must-revalidate" } as const

const recommendationSchema = z.object({
  partner_name: z.string(),
  title: z.string(),
  amount: z.number(),
  currency: z.string(),
  due_date: z.string(),
  rationale: z.string(),
})

type Recommendation = z.infer<typeof recommendationSchema>

type PartnerContext = {
  partner_name: string
  partnership_id: string | null
  response_id: string | null
  has_milestones: boolean
}

function parseBudgetRange(raw: string | null | undefined): number | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null
  const matches = text.match(/\$?\s*[\d,.]+/g) || []
  const nums = matches
    .map((m) => parseFloat(m.replace(/[$,\s]/g, "")))
    .filter((n) => Number.isFinite(n))
  if (!nums.length) return null
  return Math.max(...nums)
}

function parseDate(raw: string | null | undefined): string {
  if (!raw) return ""
  return raw.slice(0, 10)
}

function maybeParseJsonArray(raw: string): unknown[] | null {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractJsonArray(raw: string): unknown[] | null {
  const direct = maybeParseJsonArray(raw)
  if (direct) return direct
  const firstBracket = raw.indexOf("[")
  const lastBracket = raw.lastIndexOf("]")
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const sliced = raw.slice(firstBracket, lastBracket + 1)
    return maybeParseJsonArray(sliced)
  }
  return null
}

function partnerDisplayFromProfile(profile: {
  company_name?: string | null
  display_name?: string | null
  full_name?: string | null
  email?: string | null
}) {
  return (
    (profile.company_name || "").trim() ||
    (profile.display_name || "").trim() ||
    (profile.full_name || "").trim() ||
    (profile.email || "").trim() ||
    "Partner"
  )
}

function normalizePartnerKey(name: string): string {
  return name.trim().toLowerCase()
}

function choosePartnerContext(name: string, contexts: PartnerContext[]): PartnerContext | null {
  const key = normalizePartnerKey(name)
  if (!key) return null
  const exact = contexts.find((c) => normalizePartnerKey(c.partner_name) === key)
  if (exact) return exact
  const included = contexts.find((c) => normalizePartnerKey(c.partner_name).includes(key) || key.includes(normalizePartnerKey(c.partner_name)))
  return included || null
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
    if (!project_id) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400, headers: noStore })
    }

    let partnerContexts: PartnerContext[] = []
    let summary = ""
    let systemPrompt = ""

    try {
      const { data: project, error: pErr } = await supabase
        .from("projects")
        .select("id, agency_id, name, client_name, budget_range")
        .eq("id", project_id)
        .eq("agency_id", user.id)
        .maybeSingle()
      if (pErr || !project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStore })
      }

      const { data: cashFlowRows, error: cfErr } = await supabase
        .from("client_cash_flow")
        .select("id, label, amount, currency, expected_date, status, received_at")
        .eq("agency_id", user.id)
        .eq("project_id", project_id)
        .order("expected_date", { ascending: true })
        .order("created_at", { ascending: true })
      if (cfErr) {
        console.error("[api/agency/payment-synthesis] cash flow query failed", cfErr)
        return NextResponse.json({ error: "Failed to load client cash flow" }, { status: 500, headers: noStore })
      }

      const { data: milestones, error: mErr } = await supabase
        .from("payment_milestones")
        .select("id, project_id, partnership_id, response_id, title, amount, currency, due_date, status")
        .eq("agency_id", user.id)
        .eq("project_id", project_id)
        .order("due_date", { ascending: true })
      if (mErr) {
        console.error("[api/agency/payment-synthesis] milestones query failed", mErr)
        return NextResponse.json({ error: "Failed to load milestones" }, { status: 500, headers: noStore })
      }

      const { data: awardedResponses, error: rErr } = await supabase
        .from("partner_rfp_responses")
        .select("id, inbox_item_id, partner_display_name, budget_proposal")
        .eq("agency_id", user.id)
        .eq("status", "awarded")
      if (rErr) {
        console.error("[api/agency/payment-synthesis] awarded responses query failed", rErr)
        return NextResponse.json({ error: "Failed to load awarded responses" }, { status: 500, headers: noStore })
      }

      const inboxIds = [...new Set((awardedResponses || []).map((r) => r.inbox_item_id as string).filter(Boolean))]
      const inboxById = new Map<string, { project_id: string | null; partnership_id: string | null }>()
      if (inboxIds.length > 0) {
        const { data: inboxRows, error: iErr } = await supabase
          .from("partner_rfp_inbox")
          .select("id, project_id, partnership_id")
          .eq("agency_id", user.id)
          .in("id", inboxIds)
        if (iErr) {
          console.error("[api/agency/payment-synthesis] inbox query failed", iErr)
          return NextResponse.json({ error: "Failed to load awarded response details" }, { status: 500, headers: noStore })
        }
        for (const row of inboxRows || []) {
          inboxById.set(row.id as string, {
            project_id: row.project_id != null ? String(row.project_id) : null,
            partnership_id: row.partnership_id != null ? String(row.partnership_id) : null,
          })
        }
      }

      const awardedForProject = (awardedResponses || [])
        .map((r) => {
          const ib = inboxById.get(r.inbox_item_id as string)
          if (!ib || ib.project_id !== project_id) return null
          return {
            response_id: String(r.id),
            partnership_id: ib.partnership_id,
            partner_name: ((r.partner_display_name as string | null) || "").trim() || "Partner",
            budget_proposal: ((r.budget_proposal as string | null) || "").trim(),
          }
        })
        .filter(Boolean) as Array<{
        response_id: string
        partnership_id: string | null
        partner_name: string
        budget_proposal: string
      }>

      const partnershipIds = [...new Set((milestones || []).map((m) => m.partnership_id as string | null).filter(Boolean))]
      const responseIds = [...new Set((milestones || []).map((m) => m.response_id as string | null).filter(Boolean))]

      const partnershipToPartner = new Map<string, string | null>()
      if (partnershipIds.length > 0) {
        const { data: pRows } = await supabase
          .from("partnerships")
          .select("id, partner_id")
          .eq("agency_id", user.id)
          .in("id", partnershipIds)
        const partnerIds = [...new Set((pRows || []).map((p) => p.partner_id as string | null).filter(Boolean))]
        const profileById = new Map<
          string,
          { company_name?: string | null; display_name?: string | null; full_name?: string | null; email?: string | null }
        >()
        if (partnerIds.length > 0) {
          const { data: partnerProfiles } = await supabase
            .from("profiles")
            .select("id, company_name, display_name, full_name, email")
            .in("id", partnerIds)
          for (const pp of partnerProfiles || []) {
            profileById.set(String(pp.id), pp)
          }
        }
        for (const row of pRows || []) {
          const pid = String(row.id)
          const partnerId = (row.partner_id as string | null) || null
          const profile = partnerId ? profileById.get(partnerId) : null
          partnershipToPartner.set(pid, profile ? partnerDisplayFromProfile(profile) : null)
        }
      }

      const responseToPartner = new Map<string, string>()
      if (responseIds.length > 0) {
        const { data: responseRows } = await supabase
          .from("partner_rfp_responses")
          .select("id, partner_display_name")
          .eq("agency_id", user.id)
          .in("id", responseIds)
        for (const row of responseRows || []) {
          responseToPartner.set(
            String(row.id),
            ((row.partner_display_name as string | null) || "").trim() || "Partner"
          )
        }
      }

      const milestoneItems = (milestones || []).map((m) => {
        const partnership_id = (m.partnership_id as string | null) || null
        const response_id = (m.response_id as string | null) || null
        const partner_name =
          (partnership_id ? partnershipToPartner.get(partnership_id) : null) ||
          (response_id ? responseToPartner.get(response_id) : null) ||
          "Partner"
        return {
          partner_name,
          title: String(m.title || "Milestone"),
          amount: Number(m.amount || 0),
          currency: String(m.currency || "USD"),
          due_date: parseDate(m.due_date as string | null | undefined),
          status: String(m.status || "pending"),
          partnership_id,
          response_id,
        }
      })

      const milestoneResponseIds = new Set(
        milestoneItems.map((m) => m.response_id).filter((id): id is string => Boolean(id))
      )
      const milestonePartnershipIds = new Set(
        milestoneItems.map((m) => m.partnership_id).filter((id): id is string => Boolean(id))
      )
      const awardedWithoutMilestones = awardedForProject.filter(
        (a) => !milestoneResponseIds.has(a.response_id) && !(a.partnership_id && milestonePartnershipIds.has(a.partnership_id))
      )

      const hasDataForSynthesis =
        milestoneItems.length > 0 || awardedWithoutMilestones.some((a) => a.budget_proposal.trim().length > 0)
      if (!hasDataForSynthesis) {
        return NextResponse.json(
          {
            error:
              "No partner payment data found. Add milestones or ensure at least one awarded partner includes a budget proposal.",
          },
          { status: 400, headers: noStore }
        )
      }

      const partnerContextMap = new Map<string, PartnerContext>()
      for (const item of milestoneItems) {
        const key = normalizePartnerKey(item.partner_name)
        if (!key) continue
        partnerContextMap.set(key, {
          partner_name: item.partner_name,
          partnership_id: item.partnership_id,
          response_id: item.response_id,
          has_milestones: true,
        })
      }
      for (const aw of awardedWithoutMilestones) {
        const key = normalizePartnerKey(aw.partner_name)
        if (!key || partnerContextMap.has(key)) continue
        partnerContextMap.set(key, {
          partner_name: aw.partner_name,
          partnership_id: aw.partnership_id,
          response_id: aw.response_id,
          has_milestones: false,
        })
      }
      partnerContexts = Array.from(partnerContextMap.values())

      const projectName = ((project.name as string | null) || "").trim() || "Project"
      const clientName = ((project.client_name as string | null) || "").trim() || "Client"
      const clientBudgetRaw = (project.budget_range as string | null) || null
      const parsedBudget = parseBudgetRange(clientBudgetRaw)
      const budgetFormatNote =
        parsedBudget == null
          ? "Budget format note: projects.budget_range may be a range string (e.g. '$50k-$100k') or null, not a precise numeric value. Use it as context rather than exact math."
          : "Budget format note: parsed numeric budget estimate available below; original source may still be a range string."

      console.log("[api/agency/payment-synthesis] budget_range raw", {
        project_id,
        budget_range: clientBudgetRaw,
        parsed_budget_estimate: parsedBudget,
      })

      summary = [
      `Project: ${projectName}`,
      `Client: ${clientName}`,
      `Client budget (projects.budget_range raw): ${clientBudgetRaw || "N/A"}`,
      parsedBudget != null ? `Client budget parsed numeric estimate: ${parsedBudget}` : "Client budget parsed numeric estimate: unavailable",
      budgetFormatNote,
      "",
      "Client cash flow schedule:",
      cashFlowRows && cashFlowRows.length > 0
        ? cashFlowRows
            .map(
              (row) =>
                `- ${row.label} | amount=${Number(row.amount || 0)} ${row.currency || "USD"} | expected_date=${parseDate(
                  row.expected_date as string | null | undefined
                )} | status=${row.status}${
                  row.received_at ? ` | received_at=${new Date(row.received_at as string).toISOString()}` : ""
                }`
            )
            .join("\n")
        : "- none",
      "",
      "Existing partner payment milestones:",
      milestoneItems.length > 0
        ? milestoneItems
            .map(
              (m) =>
                `- ${m.partner_name} | ${m.title} | amount=${m.amount} ${m.currency} | due_date=${m.due_date} | status=${m.status}`
            )
            .join("\n")
        : "- none",
      "",
      "Awarded partners without milestones (from partner_rfp_responses + partner_rfp_inbox):",
      awardedWithoutMilestones.length > 0
        ? awardedWithoutMilestones
            .map(
              (a) =>
                `- ${a.partner_name} | response_id=${a.response_id} | partnership_id=${a.partnership_id || "null"} | budget_proposal=${
                  a.budget_proposal || "N/A"
                }`
            )
            .join("\n")
        : "- none",
      ].join("\n")

      systemPrompt = `You are a cash flow protection advisor for a lead creative agency. Your job is to analyze partner payment obligations and recommend a unified payment schedule that protects the lead agency's margin and minimizes cash flow risk.

You will be given: the total client budget, the client payment schedule (when the agency gets paid by their client), and each partner's payment data (either structured milestones or a total bid amount).

Return ONLY a JSON array with no preamble, markdown, or explanation. Each item in the array represents one recommended payment milestone and must have these exact keys:
- partner_name: string
- title: string (e.g. "Deposit", "Mid-project", "Final Payment")
- amount: number
- currency: string (e.g. "USD")
- due_date: string (ISO date format YYYY-MM-DD)
- rationale: string (one sentence explaining why this timing protects the agency)

Prioritize: paying partners after the agency receives client funds, flagging any deposit requirements that create cash flow gaps, and ensuring total partner payments do not exceed client budget minus a reasonable margin buffer.`
    } catch (dataError) {
      console.error("[api/agency/payment-synthesis] data gathering error", dataError)
      return NextResponse.json(
        {
          error: "Failed to gather payment synthesis input data",
          detail:
            process.env.NODE_ENV === "development"
              ? dataError instanceof Error
                ? dataError.message
                : String(dataError)
              : undefined,
        },
        { status: 500, headers: noStore }
      )
    }

    console.log("[api/agency/payment-synthesis] synthesized user prompt", summary)

    let aiText = ""
    try {
      const ai = await generateText({
        model: "anthropic/claude-sonnet-4-20250514" as any,
        system: systemPrompt,
        prompt: summary,
        temperature: 0.2,
        maxOutputTokens: 4096,
      })
      aiText = ai.text || ""
    } catch (apiError) {
      console.error("[api/agency/payment-synthesis] Anthropic API call failed", apiError)
      return NextResponse.json(
        {
          error: "Could not generate payment synthesis",
          detail:
            process.env.NODE_ENV === "development"
              ? apiError instanceof Error
                ? apiError.message
                : String(apiError)
              : undefined,
        },
        { status: 500, headers: noStore }
      )
    }

    const arr = extractJsonArray(aiText || "")
    if (!arr) {
      return NextResponse.json(
        { error: "AI returned non-JSON output", detail: (aiText || "").slice(0, 500) },
        { status: 500, headers: noStore }
      )
    }
    const parsed = z.array(recommendationSchema).safeParse(arr)
    if (!parsed.success || parsed.data.length === 0) {
      return NextResponse.json(
        { error: "AI returned invalid recommendations", detail: parsed.success ? undefined : parsed.error.flatten() },
        { status: 500, headers: noStore }
      )
    }

    const recommendations = parsed.data.map((item: Recommendation) => {
      const context = choosePartnerContext(item.partner_name, partnerContexts)
      return {
        ...item,
        partnership_id: context?.partnership_id || null,
        response_id: context?.response_id || null,
      }
    })

    return NextResponse.json({ recommendations }, { headers: noStore })
  } catch (error) {
    console.error("Payment synthesis error:", error)
    console.error("[api/agency/payment-synthesis]", error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      {
        error: /API key|api key|ANTHROPIC|authentication|401|unauthorized/i.test(msg)
          ? "AI is not configured (missing or invalid API key)."
          : "Failed to generate payment synthesis",
        detail: process.env.NODE_ENV === "development" ? msg : undefined,
      },
      { status: 500, headers: noStore }
    )
  }
}
