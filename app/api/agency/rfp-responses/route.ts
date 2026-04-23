import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parseBudgetProposal, parseTimelineProposal } from "@/lib/rfp-response-fields"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const projectIdParam = (url.searchParams.get("projectId") || "").trim()
    const route = "/api/agency/rfp-responses"
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile, error: profileErr } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profileErr) {
      console.error("[agency/rfp-responses] GET profile load failed", {
        route,
        userId: user.id,
        message: profileErr.message,
        code: profileErr.code,
      })
      return NextResponse.json({ error: "Failed to load profile" }, { status: 500 })
    }

    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403 })
    }
    console.log("[api] start", { route, method: "GET", userId: user.id, role: profile.role, projectId: projectIdParam || null })

    // RLS: policy "Agencies select RFP responses they own" — USING (agency_id = auth.uid())
    // Optional project-scoped filtering is applied via partner_rfp_inbox.project_id.
    let inboxIdsForProject: string[] | null = null
    if (projectIdParam) {
      const { data: scopedInboxes, error: inboxErr } = await supabase
        .from("partner_rfp_inbox")
        .select("id")
        .eq("agency_id", user.id)
        .eq("project_id", projectIdParam)
      if (inboxErr) {
        console.error("[agency/rfp-responses] partner_rfp_inbox scoped select error", {
          route,
          userId: user.id,
          projectId: projectIdParam,
          message: inboxErr.message,
          code: inboxErr.code,
        })
        return NextResponse.json({ error: inboxErr.message }, { status: 500 })
      }
      inboxIdsForProject = (scopedInboxes || []).map((r) => r.id as string)
      if (inboxIdsForProject.length === 0) {
        return NextResponse.json({ responses: [] }, { headers: { "Cache-Control": "private, no-store, no-cache, must-revalidate" } })
      }
    }

    let responsesQuery = supabase
      .from("partner_rfp_responses")
      .select("*")
      .eq("agency_id", user.id)
      .order("updated_at", { ascending: false })
    if (inboxIdsForProject) {
      responsesQuery = responsesQuery.in("inbox_item_id", inboxIdsForProject)
    }
    const { data: responses, error } = await responsesQuery

    if (error) {
      console.error("[agency/rfp-responses] partner_rfp_responses select error", {
        userId: user.id,
        message: error.message,
        code: error.code,
      })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const list = responses || []

    let inboxQuery = supabase
      .from("partner_rfp_inbox")
      .select("id, scope_item_name, scope_item_description, created_at, updated_at, response_deadline, partner_intent, intent_set_at, master_rfp_json, status, partner_id, recipient_email")
      .eq("agency_id", user.id)
      .order("created_at", { ascending: false })
    if (projectIdParam) inboxQuery = inboxQuery.eq("project_id", projectIdParam)
    const { data: allInboxes, error: allInboxErr } = await inboxQuery
    if (allInboxErr) {
      console.error("[agency/rfp-responses] partner_rfp_inbox list select error", {
        route,
        userId: user.id,
        projectId: projectIdParam || null,
        message: allInboxErr.message,
        code: allInboxErr.code,
      })
      return NextResponse.json({ error: allInboxErr.message }, { status: 500 })
    }

    const inboxIds = [...new Set((allInboxes || []).map((r) => r.id as string))]
    const partnerIds = [...new Set((allInboxes || []).map((r) => r.partner_id).filter(Boolean) as string[])]
    let profileById: Record<string, { full_name: string | null; company_name: string | null; email: string | null }> = {}
    if (partnerIds.length > 0) {
      const { data: partnerProfiles, error: partnerProfilesErr } = await supabase
        .from("profiles")
        .select("id, full_name, company_name, email")
        .in("id", partnerIds)
      if (partnerProfilesErr) {
        console.error("[agency/rfp-responses] profiles batch for partner display names failed", {
          route,
          userId: user.id,
          partnerIdCount: partnerIds.length,
          message: partnerProfilesErr.message,
          code: partnerProfilesErr.code,
        })
      }
      profileById = Object.fromEntries(
        (partnerProfiles || []).map((p) => [p.id as string, { full_name: p.full_name, company_name: p.company_name, email: p.email }])
      )
    }

    const inboxById = Object.fromEntries((allInboxes || []).map((i) => [i.id as string, i as Record<string, unknown>]))
    console.log("[api] success", { route, method: "GET", userId: user.id, role: profile.role, responseCount: list.length, inboxCount: inboxIds.length })

    const merged = list.map((r) => ({
      ...r,
      response_id: r.id,
      response_exists: true,
      inbox: inboxById[r.inbox_item_id as string] ?? null,
    }))

    const responseIds = merged.map((r) => r.id).filter(Boolean)
    let versionsByResponseId: Record<string, unknown[]> = {}
    if (responseIds.length > 0) {
      const { data: versions, error: versionsErr } = await supabase
        .from("partner_rfp_response_versions")
        .select(
          "id, response_id, version_number, proposal_text, budget_proposal, timeline_proposal, attachments, status_at_submission, submitted_at, change_notes"
        )
        .in("response_id", responseIds)
        .order("version_number", { ascending: false })
      if (versionsErr) {
        console.error("[agency/rfp-responses] partner_rfp_response_versions select error", {
          route,
          userId: user.id,
          responseIdCount: responseIds.length,
          message: versionsErr.message,
          code: versionsErr.code,
        })
        return NextResponse.json({ error: versionsErr.message }, { status: 500 })
      }
      for (const rawVersion of versions || []) {
        const budgetParsed = parseBudgetProposal((rawVersion.budget_proposal as string) || "")
        const timelineParsed = parseTimelineProposal((rawVersion.timeline_proposal as string) || "")
        const v = {
          ...rawVersion,
          budget: budgetParsed.amount || null,
          budget_currency:
            budgetParsed.currency === "Other"
              ? budgetParsed.customOther || "Other"
              : budgetParsed.currency || null,
          timeline: timelineParsed.duration || null,
          timeline_unit: timelineParsed.unit || null,
        }
        const responseId = v.response_id as string
        if (!versionsByResponseId[responseId]) versionsByResponseId[responseId] = []
        versionsByResponseId[responseId].push(v)
      }
    }

    const mergedWithVersions = merged.map((r) => ({
      ...r,
      versions: versionsByResponseId[r.id as string] || [],
    }))

    const existingInboxIds = new Set(mergedWithVersions.map((r) => r.inbox_item_id as string))
    const awaitingRows = (allInboxes || [])
      .filter((i) => !existingInboxIds.has(i.id as string))
      .map((i) => {
        const pid = (i.partner_id as string | null) || null
        const pr = pid ? profileById[pid] : null
        const displayName =
          pr?.company_name || pr?.full_name || pr?.email || (i.recipient_email as string | null) || "Partner"
        return {
          id: `inbox-${i.id}`,
          response_id: null,
          response_exists: false,
          inbox_item_id: i.id,
          partner_display_name: displayName,
          proposal_text: "Awaiting partner response.",
          budget_proposal: "",
          timeline_proposal: "",
          attachments: [],
          status: "awaiting_response",
          created_at: i.created_at,
          updated_at: i.updated_at || i.created_at,
          inbox: i,
          versions: [],
        }
      })

    const combined = [...mergedWithVersions, ...awaitingRows].sort(
      (a, b) => new Date(b.updated_at as string).getTime() - new Date(a.updated_at as string).getTime()
    )

    return NextResponse.json(
      { responses: combined },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      }
    )
  } catch (e) {
    console.error("[api] failure", {
      route: "/api/agency/rfp-responses",
      method: "GET",
      code: 500,
      message: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({ error: "Failed to load responses" }, { status: 500 })
  }
}
