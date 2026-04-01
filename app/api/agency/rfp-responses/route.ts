import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

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

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

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
    console.log("[api] success", { route, method: "GET", userId: user.id, role: profile.role, rowCount: list.length })

    const inboxIds = [...new Set(list.map((r) => r.inbox_item_id))]

    let inboxById: Record<string, Record<string, unknown>> = {}
    if (inboxIds.length > 0) {
      const { data: inboxes } = await supabase
        .from("partner_rfp_inbox")
        .select("id, scope_item_name, scope_item_description, created_at, master_rfp_json, status")
        .in("id", inboxIds)
        .eq("agency_id", user.id)

      inboxById = Object.fromEntries((inboxes || []).map((i) => [i.id as string, i as Record<string, unknown>]))
    }

    const merged = list.map((r) => ({
      ...r,
      inbox: inboxById[r.inbox_item_id as string] ?? null,
    }))

    const responseIds = merged.map((r) => r.id).filter(Boolean)
    let versionsByResponseId: Record<string, unknown[]> = {}
    if (responseIds.length > 0) {
      const { data: versions } = await supabase
        .from("partner_rfp_response_versions")
        .select(
          "id, response_id, version_number, proposal_text, budget_proposal, timeline_proposal, attachments, status_at_submission, submitted_at, change_notes"
        )
        .in("response_id", responseIds)
        .order("version_number", { ascending: false })
      for (const v of versions || []) {
        const responseId = v.response_id as string
        if (!versionsByResponseId[responseId]) versionsByResponseId[responseId] = []
        versionsByResponseId[responseId].push(v)
      }
    }

    console.log("[api] agency versions mapped", {
      route,
      method: "GET",
      userId: user.id,
      perResponseVersionCounts: merged.map((r) => ({
        responseId: r.id,
        versionCount: (versionsByResponseId[r.id as string] || []).length,
      })),
    })

    const mergedWithVersions = merged.map((r) => ({
      ...r,
      versions: versionsByResponseId[r.id as string] || [],
    }))

    return NextResponse.json(
      { responses: mergedWithVersions },
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
