import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parseBudgetProposal, parseTimelineProposal } from "@/lib/rfp-response-fields"
import { normalizeBusinessCriteriaRequired } from "@/lib/business-criteria"

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
    // Optional project-scoped filtering is applied via partner_rfp_inbox.project_id, unioned with
    // guest (magic-link) responses scoped via rfp_magic_tokens.project_id — guest rows have no
    // inbox_item_id, so they'd otherwise be silently excluded by the inbox-scoped filter below.
    let inboxIdsForProject: string[] | null = null
    let magicResponseIdsForProject: string[] = []
    if (projectIdParam) {
      const [{ data: scopedInboxes, error: inboxErr }, { data: scopedMagicTokens, error: magicErr }] = await Promise.all([
        supabase.from("partner_rfp_inbox").select("id").eq("agency_id", user.id).eq("project_id", projectIdParam),
        supabase
          .from("rfp_magic_tokens")
          .select("response_id")
          .eq("agency_id", user.id)
          .eq("project_id", projectIdParam)
          .not("response_id", "is", null),
      ])
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
      if (magicErr) {
        console.error("[agency/rfp-responses] rfp_magic_tokens scoped select error", {
          route,
          userId: user.id,
          projectId: projectIdParam,
          message: magicErr.message,
          code: magicErr.code,
        })
        return NextResponse.json({ error: magicErr.message }, { status: 500 })
      }
      inboxIdsForProject = (scopedInboxes || []).map((r) => r.id as string)
      magicResponseIdsForProject = (scopedMagicTokens || []).map((r) => r.response_id as string)
      if (inboxIdsForProject.length === 0 && magicResponseIdsForProject.length === 0) {
        return NextResponse.json({ responses: [] }, { headers: { "Cache-Control": "private, no-store, no-cache, must-revalidate" } })
      }
    }

    let responsesQuery = supabase
      .from("partner_rfp_responses")
      .select("*")
      .eq("agency_id", user.id)
      .order("updated_at", { ascending: false })
    if (inboxIdsForProject) {
      const orFilters: string[] = []
      if (inboxIdsForProject.length > 0) orFilters.push(`inbox_item_id.in.(${inboxIdsForProject.join(",")})`)
      if (magicResponseIdsForProject.length > 0) orFilters.push(`id.in.(${magicResponseIdsForProject.join(",")})`)
      responsesQuery = responsesQuery.or(orFilters.join(","))
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

    // Guest (magic-link) responses have no inbox_item_id — resolve their display
    // context (project, scope item, vendor identity) via rfp_magic_tokens instead.
    const guestResponseIds = list.filter((r) => !r.inbox_item_id).map((r) => r.id as string)
    let magicTokenByResponseId: Record<
      string,
      {
        vendor_email: string
        vendor_name: string | null
        scope_item_name: string | null
        project_id: string | null
        business_criteria_required: unknown
      }
    > = {}
    if (guestResponseIds.length > 0) {
      const { data: magicRows, error: magicRowsErr } = await supabase
        .from("rfp_magic_tokens")
        .select("response_id, vendor_email, vendor_name, scope_item_name, project_id, business_criteria_required")
        .in("response_id", guestResponseIds)
      if (magicRowsErr) {
        console.error("[agency/rfp-responses] rfp_magic_tokens enrichment select error", {
          route,
          userId: user.id,
          message: magicRowsErr.message,
          code: magicRowsErr.code,
        })
        return NextResponse.json({ error: magicRowsErr.message }, { status: 500 })
      }
      magicTokenByResponseId = Object.fromEntries((magicRows || []).map((m) => [m.response_id as string, m]))
    }

    let inboxQuery = supabase
      .from("partner_rfp_inbox")
      .select(
        "id, project_id, scope_item_name, scope_item_description, created_at, updated_at, response_deadline, partner_intent, intent_set_at, master_rfp_json, status, partner_id, recipient_email, invite_token_expires_at, claimed_at, nda_gate_enforced, nda_confirmed_at"
      )
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

    const projectIdsFromInbox = [
      ...new Set(
        [
          ...(allInboxes || []).map((i) => i.project_id as string | null),
          ...Object.values(magicTokenByResponseId).map((m) => m.project_id),
        ].filter(Boolean)
      ),
    ] as string[]
    const projectMetaById: Record<string, { project_name: string; client_name: string | null }> = {}
    if (projectIdsFromInbox.length > 0) {
      const { data: projRows } = await supabase
        .from('projects')
        .select('id, name, client_name')
        .in('id', projectIdsFromInbox)
      for (const pr of projRows || []) {
        projectMetaById[pr.id as string] = {
          project_name: ((pr.name as string | null) || '').trim() || 'Untitled project',
          client_name: (pr.client_name as string | null) ?? null,
        }
      }
    }
    const inboxById = Object.fromEntries((allInboxes || []).map((i) => {
      const pid = (i.project_id as string | null) ?? null
      const meta = pid ? projectMetaById[pid] : null
      return [i.id as string, {
        ...(i as Record<string, unknown>),
        project_name: meta?.project_name ?? null,
        client_name: meta?.client_name ?? null,
      }]
    }))
    console.log("[api] success", { route, method: "GET", userId: user.id, role: profile.role, responseCount: list.length, inboxCount: inboxIds.length })

    const merged = list.map((r) => {
      const inboxRow = inboxById[r.inbox_item_id as string] ?? null
      const magicToken = !r.inbox_item_id ? magicTokenByResponseId[r.id as string] ?? null : null
      const pid = inboxRow ? (inboxRow as Record<string,unknown>).partner_id as string | null : null
      const pr = pid ? profileById[pid] : null
      const displayName = pr?.company_name || pr?.full_name || pr?.email || (r.partner_id ? profileById[r.partner_id as string]?.company_name || profileById[r.partner_id as string]?.full_name || profileById[r.partner_id as string]?.email : null) || 'Partner'
      const magicProjectMeta = magicToken?.project_id ? projectMetaById[magicToken.project_id] : null
      // Requirements live on partner_rfp_inbox.master_rfp_json for partner bids, or on
      // rfp_magic_tokens.business_criteria_required for guest bids (no inbox row exists there).
      const inboxMasterRfp = inboxRow
        ? ((inboxRow as Record<string, unknown>).master_rfp_json as Record<string, unknown> | null)
        : null
      const businessCriteriaRequiredSource = inboxRow
        ? inboxMasterRfp?.business_criteria_required ?? null
        : magicToken?.business_criteria_required ?? null
      return {
        ...r,
        response_id: r.id,
        response_exists: true,
        partner_display_name: (r as Record<string,unknown>).partner_display_name as string || displayName,
        project_name: inboxRow ? (inboxRow as Record<string,unknown>).project_name as string | null : (magicProjectMeta?.project_name ?? null),
        client_name: inboxRow ? (inboxRow as Record<string,unknown>).client_name as string | null : (magicProjectMeta?.client_name ?? null),
        inbox: inboxRow ?? (magicToken
          ? { scope_item_name: magicToken.scope_item_name, response_deadline: null, project_id: magicToken.project_id }
          : null),
        vendor_email: magicToken?.vendor_email ?? null,
        business_criteria_required: normalizeBusinessCriteriaRequired(businessCriteriaRequiredSource),
      }
    })

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
          project_name: (inboxById[i.id as string] as Record<string,unknown>)?.project_name as string | null ?? null,
          client_name: (inboxById[i.id as string] as Record<string,unknown>)?.client_name as string | null ?? null,
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
