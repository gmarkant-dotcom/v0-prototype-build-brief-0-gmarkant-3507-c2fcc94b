import { BUDGET_TABLES } from "./schema"
import { fromDbError, ok, toCents, type BudgetResult } from "./result"
import type { BudgetSession } from "./scope"

/**
 * THE BUDGETING LANDING LIST: the caller's organizations' projects and each one's budget status.
 * Caller's session client only; RLS decides every row. Explicit columns; no select("*").
 *
 *   no_chart  the project has no budget categories yet (copy-on-create has not run)
 *   chart     categories exist, no live lines yet
 *   totals    live lines exist; estimateCents is their sum
 *
 * A project with any category, archived or not, has a chart: that is the condition
 * budget_copy_template_to_project refuses on (23505), so the list and the RPC agree.
 */

export type ProjectBudgetStatus = "no_chart" | "chart" | "totals"

export type ProjectBudgetOverview = {
  projectId: string
  name: string
  clientName: string | null
  projectStatus: string | null
  createdAt: string | null
  budgetStatus: ProjectBudgetStatus
  categoryCount: number
  lineCount: number
  /** Integer cents: the sum of live lines' estimates. */
  estimateCents: number
}

const CHUNK = 100

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

export async function listProjectBudgetOverview(session: BudgetSession): Promise<BudgetResult<ProjectBudgetOverview[]>> {
  if (session.orgIds.length === 0) return ok([])
  const { data: projectRows, error: projectsErr } = await session.client
    .from("projects")
    .select("id, name, client_name, status, created_at")
    .in("org_id", session.orgIds)
    .order("created_at", { ascending: false })
  if (projectsErr) return fromDbError(projectsErr)
  const projects = (projectRows ?? []) as Array<{ id: string; name: string | null; client_name: string | null; status: string | null; created_at: string | null }>

  const categoryCount = new Map<string, number>()
  const lineCount = new Map<string, number>()
  const estimate = new Map<string, number>()

  for (const ids of chunks(projects.map((p) => p.id))) {
    const { data: cats, error: catsErr } = await session.client
      .from(BUDGET_TABLES.projectCategories)
      .select("project_id")
      .in("project_id", ids)
    if (catsErr) return fromDbError(catsErr)
    for (const c of (cats ?? []) as Array<{ project_id: string }>) categoryCount.set(c.project_id, (categoryCount.get(c.project_id) ?? 0) + 1)

    const { data: lines, error: linesErr } = await session.client
      .from(BUDGET_TABLES.lines)
      .select("project_id, estimate")
      .in("project_id", ids)
      .is("archived_at", null)
    if (linesErr) return fromDbError(linesErr)
    for (const l of (lines ?? []) as Array<{ project_id: string; estimate: unknown }>) {
      lineCount.set(l.project_id, (lineCount.get(l.project_id) ?? 0) + 1)
      estimate.set(l.project_id, (estimate.get(l.project_id) ?? 0) + toCents(l.estimate))
    }
  }

  // The spine's tables are probed even for an organization with no projects, so "not enabled"
  // is reported the same way whether or not the agency has a project yet.
  if (projects.length === 0) {
    const { error } = await session.client.from(BUDGET_TABLES.projectCategories).select("id").limit(1)
    if (error) return fromDbError(error)
  }

  return ok(
    projects.map((p) => {
      const cats = categoryCount.get(p.id) ?? 0
      const lns = lineCount.get(p.id) ?? 0
      return {
        projectId: p.id,
        name: p.name?.trim() || "Untitled project",
        clientName: p.client_name,
        projectStatus: p.status,
        createdAt: p.created_at,
        budgetStatus: cats === 0 ? "no_chart" : lns === 0 ? "chart" : "totals",
        categoryCount: cats,
        lineCount: lns,
        estimateCents: estimate.get(p.id) ?? 0,
      }
    })
  )
}

/** The project's display name, for the project screen header and export file names. */
export async function readProjectName(session: BudgetSession, projectId: string): Promise<BudgetResult<{ name: string; clientName: string | null }>> {
  const { data, error } = await session.client
    .from("projects")
    .select("id, name, client_name")
    .eq("id", projectId)
    .in("org_id", session.orgIds)
    .maybeSingle()
  if (error) return fromDbError(error)
  const row = (data ?? null) as { name: string | null; client_name: string | null } | null
  return ok({ name: row?.name?.trim() || "Untitled project", clientName: row?.client_name ?? null })
}

export type ProjectPartnership = { id: string; status: string; vendorName: string }

/**
 * The project agency's partnerships, for the document "share with a vendor" choice.
 * source_documents_guard requires partnerships.lead_org_id = projects.org_id, so only those are
 * listed. Only active and suspended relationships can see a toggled document (R4); the others are
 * returned with their status so the screen can say why they are not offered.
 */
export async function listProjectPartnerships(session: BudgetSession, orgId: string): Promise<BudgetResult<ProjectPartnership[]>> {
  const { data, error } = await session.client
    .from("partnerships")
    .select("id, status, company_name")
    .eq("lead_org_id", orgId)
    .order("company_name", { ascending: true })
  if (error) return fromDbError(error)
  return ok(
    ((data ?? []) as Array<{ id: string; status: string | null; company_name: string | null }>).map((p) => ({
      id: p.id,
      status: p.status ?? "pending",
      vendorName: p.company_name?.trim() || "Unnamed vendor",
    }))
  )
}
