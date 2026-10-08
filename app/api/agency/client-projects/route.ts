import { NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { isMissingClientsTable } from "@/lib/clients"
import { projectActiveByEndDate } from "@/lib/project-liveness"
import { resolveCallerOrgIds } from "@/lib/entitlements"
export const dynamic = "force-dynamic"

/**
 * Clients + Projects: every project the caller's organization owns, with the client profile it is
 * filed under.
 *
 * WHERE THE ORGANIZATION CHECK LIVES. Both reads below are scoped by
 * `.in("org_id", callerOrgIds)`, and callerOrgIds comes from resolveCallerOrgIds() on the session
 * user. This route takes NO client or project identifier from the URL or body, so there is no
 * identifier to trust. A project's client_id is also never believed on its own: it is kept only if
 * it names a client the same organization set owns. A project pointing at a client outside that
 * set is returned UNLINKED rather than carrying a foreign id outward.
 *
 * A PROJECT APPEARS UNDER EXACTLY ONE CLIENT. projects.client_id is one nullable column, so a
 * project has at most one profile. A project with none is returned with client_id null and is
 * shown by the page in its own section; it is never dropped.
 *
 * NOT CAPPED SILENTLY. PostgREST truncates an unranged select at the project's max-rows setting
 * (Supabase default 1000) without any error. The projects read pages through .range() until a
 * short page, and reports `truncated: true` if it ever reaches the page ceiling, so the page can
 * say so instead of rendering an incomplete repository as a complete one.
 *
 * LIVENESS comes from lib/project-liveness.ts and nowhere else.
 */

const PAGE_SIZE = 1000
const MAX_PAGES = 20

export async function GET() {
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: clientRows, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name")
      .in("org_id", callerOrgIds)
      .order("name", { ascending: true })

    if (clientsErr) {
      if (isMissingClientsTable(clientsErr)) {
        return NextResponse.json({ available: false, clients: [], projects: [], truncated: false })
      }
      console.error("[agency/client-projects] clients", { message: clientsErr.message, code: clientsErr.code })
      return NextResponse.json({ error: "Failed to load clients" }, { status: 500 })
    }

    const ownedClientIds = new Set((clientRows || []).map((c) => String(c.id)))

    type ProjectRow = {
      id: string
      name: string | null
      client_id: string | null
      client_name: string | null
      start_date: string | null
      end_date: string | null
      created_at: string | null
    }
    const rows: ProjectRow[] = []
    let truncated = false
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, client_id, client_name, start_date, end_date, created_at")
        .in("org_id", callerOrgIds)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      if (error) {
        console.error("[agency/client-projects] projects", { message: error.message, code: error.code })
        return NextResponse.json({ error: "Failed to load projects" }, { status: 500 })
      }
      const batch = (data || []) as ProjectRow[]
      rows.push(...batch)
      if (batch.length < PAGE_SIZE) break
      if (page === MAX_PAGES - 1) truncated = true
    }

    const seen = new Set<string>()
    const projects = []
    for (const p of rows) {
      const id = String(p.id)
      if (seen.has(id)) continue
      seen.add(id)
      const linked = p.client_id && ownedClientIds.has(String(p.client_id)) ? String(p.client_id) : null
      projects.push({
        id,
        name: (p.name || "").trim() || "Untitled project",
        client_id: linked,
        client_name: (p.client_name || "").trim() || null,
        active: projectActiveByEndDate(p.end_date),
      })
    }

    return NextResponse.json({
      available: true,
      clients: (clientRows || []).map((c) => ({ id: String(c.id), name: String(c.name) })),
      projects,
      truncated,
    })
  } catch (e) {
    console.error("[agency/client-projects] GET", e)
    return NextResponse.json({ error: "Failed to load clients and projects" }, { status: 500 })
  }
}
