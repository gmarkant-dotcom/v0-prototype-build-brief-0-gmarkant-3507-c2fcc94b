import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

/**
 * Partner dashboard: projects where this user is the awarded party (project_assignments.status = awarded).
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
    if (profileErr || profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: userPartnerships, error: pErr } = await supabase
      .from("partnerships")
      .select("id")
      .eq("partner_id", user.id)

    if (pErr) throw pErr

    const partnershipIds = (userPartnerships || []).map((r) => r.id as string)
    if (partnershipIds.length === 0) {
      return NextResponse.json({ projects: [] }, { headers: noStoreHeaders })
    }

    const { data: rows, error: asgErr } = await supabase
      .from("project_assignments")
      .select(
        `
        id,
        awarded_at,
        project_id,
        project:projects(
          id,
          name,
          title,
          client_name
        )
      `
      )
      .in("partnership_id", partnershipIds)
      .eq("status", "awarded")
      .order("awarded_at", { ascending: false, nullsFirst: false })

    if (asgErr) throw asgErr

    type Proj = { id: string; name?: string | null; title?: string | null; client_name?: string | null }

    const byProject = new Map<
      string,
      { id: string; name: string; client_name: string | null; assignment_id: string; awarded_at: string | null }
    >()

    for (const a of rows || []) {
      const raw = a.project as Proj | Proj[] | null | undefined
      const proj = Array.isArray(raw) ? raw[0] : raw
      if (!proj?.id) continue
      const pid = proj.id as string
      if (byProject.has(pid)) continue

      const nameRaw = (proj.name ?? proj.title ?? "").trim()
      const name = nameRaw || "Project"

      byProject.set(pid, {
        id: pid,
        name,
        client_name: (proj.client_name as string | null) ?? null,
        assignment_id: a.id as string,
        awarded_at: (a.awarded_at as string | null) ?? null,
      })
    }

    const projects = [...byProject.values()]

    return NextResponse.json({ projects }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[api/partner/projects] GET", e)
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500, headers: noStoreHeaders })
  }
}
