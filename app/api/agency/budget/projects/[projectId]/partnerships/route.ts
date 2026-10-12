import { listProjectPartnerships } from "@/lib/server/budget/overview"
import { budgetResponse, budgetRouteProject, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

/**
 * GET: the project agency's partnerships (id, status, vendor company name), for choosing which
 * vendor a document is shared with. Scoped to the project's own organization, which is what
 * source_documents_guard requires of a document's partnership.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    return budgetResponse(await listProjectPartnerships(session, project.orgId), "partnerships", "partnerships GET")
  } catch (e) {
    return serverError("partnerships GET", e)
  }
}
