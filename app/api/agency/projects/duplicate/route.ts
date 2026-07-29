import { NextResponse, type NextRequest } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

/**
 * Duplicates project metadata plus the latest linked brief_interpretations row
 * (the persisted equivalent of "RFP template config" - scope items themselves
 * are never stored per-project, they're AI-derived wizard state rebuilt from
 * this brief each time, see /api/ai/master-brief). Never copies bids,
 * responses, partnerships, assignments, status updates, payments, or delivery
 * reviews - those all live on tables keyed off a completed broadcast, which a
 * duplicate never has.
 */
export async function POST(request: NextRequest) {
  const route = "/api/agency/projects/duplicate"
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const body = await request.json().catch(() => ({}))
    const projectId = typeof body?.project_id === "string" ? body.project_id : ""
    const requestedName = typeof body?.new_name === "string" ? body.new_name.trim() : ""
    if (!projectId) {
      return NextResponse.json({ error: "project_id is required" }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_paid, is_admin")
      .eq("id", user.id)
      .maybeSingle()
    const isDemo = process.env.NEXT_PUBLIC_IS_DEMO === "true"
    if (!isDemo && !profile?.is_paid && !profile?.is_admin) {
      return NextResponse.json({ error: "Active subscription required" }, { status: 403 })
    }

    const { data: sourceProject, error: sourceErr } = await supabase
      .from("projects")
      .select("id, name, client_name, description, budget_range")
      .eq("id", projectId)
      .eq("agency_id", user.id)
      .maybeSingle()
    if (sourceErr) {
      console.error("[api] failure", { route, method: "POST", message: sourceErr.message })
      return NextResponse.json({ error: "Failed to load project" }, { status: 500 })
    }
    if (!sourceProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }

    const newName = requestedName || `${sourceProject.name} (Copy)`

    const { data: nameCollision } = await supabase
      .from("projects")
      .select("id")
      .eq("agency_id", user.id)
      .ilike("name", newName)
      .maybeSingle()
    if (nameCollision) {
      return NextResponse.json({ error: "A project with this name already exists" }, { status: 409 })
    }

    const { data: newProject, error: insertErr } = await supabase
      .from("projects")
      .insert({
        agency_id: user.id,
        name: newName,
        status: "draft",
        client_name: sourceProject.client_name,
        description: sourceProject.description,
        budget_range: sourceProject.budget_range,
        start_date: null,
        end_date: null,
      })
      .select("*")
      .single()
    if (insertErr || !newProject) {
      console.error("[api] failure", { route, method: "POST", message: insertErr?.message })
      return NextResponse.json({ error: "Failed to duplicate project" }, { status: 500 })
    }

    const { data: latestBrief } = await supabase
      .from("brief_interpretations")
      .select(
        "brief_text, brief_file_url, brief_title, brief_summary, analyses_requested, timeline_result, budget_result, campaigns_result, directors_result"
      )
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestBrief) {
      const { error: briefInsertErr } = await supabase.from("brief_interpretations").insert({
        user_id: user.id,
        project_id: newProject.id,
        brief_text: latestBrief.brief_text,
        brief_file_url: latestBrief.brief_file_url,
        brief_title: latestBrief.brief_title,
        brief_summary: latestBrief.brief_summary,
        analyses_requested: latestBrief.analyses_requested,
        timeline_result: latestBrief.timeline_result,
        budget_result: latestBrief.budget_result,
        campaigns_result: latestBrief.campaigns_result,
        directors_result: latestBrief.directors_result,
      })
      if (briefInsertErr) {
        console.error("[api] failed to copy brief_interpretations", {
          route,
          method: "POST",
          message: briefInsertErr.message,
        })
        // Project itself duplicated fine; a missing carried-over brief isn't fatal.
      }
    }

    console.log("[api] success", { route, method: "POST", userId: user.id, sourceProjectId: projectId, newProjectId: newProject.id })
    return NextResponse.json({ project: newProject })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/projects/duplicate",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to duplicate project" }, { status: 500 })
  }
}
