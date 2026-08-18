import { resolveCallerOrgIds } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { normalizeClientNameForMatch, isMissingClientsTable } from "@/lib/clients"

export const dynamic = "force-dynamic"

/**
 * A3: which end clients each vendor has actually been AWARDED work for.
 *
 * Derived strictly from award history and impossible to self-report. The chain is
 *   partnerships.id  <-  project_assignments.partnership_id  WHERE status = 'awarded'
 *                    ->  project_assignments.project_id
 *                    ->  projects (client_id, else client_name)
 * and `project_assignments.status = 'awarded'` is written by exactly one place in the codebase,
 * the award branch of app/api/agency/rfp-responses/[id]/route.ts.
 *
 * ONE DERIVATION, BOTH WORLDS. The grouping key is the client's name, trimmed and lowercased -
 * never the client_id. A legacy project typed "Adidas" and a client profile named "adidas" are
 * ONE option, not two, which is the whole point. client_id is used only to resolve the best
 * DISPLAY label for a key: an entity's current name wins over a string typed months ago.
 */
export async function GET() {
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    // client_id does not exist until migration 077, and naming it in this select would 42703 the
    // whole route. Fetched separately and guarded, exactly as the Phase 2 read surfaces do.
    const { data: projectRows, error: projectsErr } = await supabase
      .from("projects")
      .select("id, client_name")
      .in("org_id", callerOrgIds)
    if (projectsErr) {
      console.error("[agency/pool/client-history] projects", projectsErr.message)
      return NextResponse.json({ options: [], byPartnership: {} })
    }
    const projects = projectRows || []
    if (projects.length === 0) return NextResponse.json({ options: [], byPartnership: {} })

    const projectIds = projects.map((p) => p.id as string)

    const entityByProject = new Map<string, string>()
    const { data: entityRows, error: entityErr } = await supabase
      .from("projects")
      .select("id, client_id")
      .in("org_id", callerOrgIds)
      .in("id", projectIds)
    if (!entityErr) {
      for (const row of entityRows || []) {
        const cid = (row as Record<string, unknown>).client_id
        if (typeof cid === "string" && cid) entityByProject.set(row.id as string, cid)
      }
    }

    // A client profile's current name is the better label when one exists.
    const clientNameById = new Map<string, string>()
    if (entityByProject.size > 0) {
      const { data: clientRows, error: clientsErr } = await supabase
        .from("clients")
        .select("id, name")
        .in("org_id", callerOrgIds)
      if (clientsErr && !isMissingClientsTable(clientsErr)) {
        console.warn("[agency/pool/client-history] clients unavailable", clientsErr.message)
      }
      for (const row of clientRows || []) clientNameById.set(row.id as string, row.name as string)
    }

    const labelForProject = (projectId: string): string => {
      const entityId = entityByProject.get(projectId)
      const entityName = entityId ? clientNameById.get(entityId) : undefined
      if (entityName?.trim()) return entityName.trim()
      const project = projects.find((p) => p.id === projectId)
      return String(project?.client_name ?? "").trim()
    }

    const { data: assignments, error: assignmentsErr } = await supabase
      .from("project_assignments")
      .select("project_id, partnership_id")
      .eq("status", "awarded")
      .in("project_id", projectIds)
    if (assignmentsErr) {
      console.error("[agency/pool/client-history] assignments", assignmentsErr.message)
      return NextResponse.json({ options: [], byPartnership: {} })
    }

    const byPartnership: Record<string, string[]> = {}
    const labelByKey = new Map<string, string>()
    const vendorsByKey = new Map<string, Set<string>>()

    for (const a of assignments || []) {
      const partnershipId = a.partnership_id as string | null
      const projectId = a.project_id as string | null
      if (!partnershipId || !projectId) continue
      const label = labelForProject(projectId)
      // A project with no client named at all contributes no filter option - inventing an
      // "Unknown" bucket would be a fabricated grouping.
      if (!label) continue
      const key = normalizeClientNameForMatch(label)
      if (!key) continue
      if (!labelByKey.has(key)) labelByKey.set(key, label)
      if (!vendorsByKey.has(key)) vendorsByKey.set(key, new Set())
      vendorsByKey.get(key)!.add(partnershipId)
      const list = byPartnership[partnershipId] || (byPartnership[partnershipId] = [])
      if (!list.includes(key)) list.push(key)
    }

    // Honest counts: the number of distinct vendors with awarded work for that client, which is
    // exactly what the filter will show when it is applied.
    const options = [...labelByKey.entries()]
      .map(([key, label]) => ({ key, label, vendorCount: vendorsByKey.get(key)?.size ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label))

    return NextResponse.json({ options, byPartnership })
  } catch (e) {
    console.error("[agency/pool/client-history] GET", e)
    return NextResponse.json({ options: [], byPartnership: {} })
  }
}
