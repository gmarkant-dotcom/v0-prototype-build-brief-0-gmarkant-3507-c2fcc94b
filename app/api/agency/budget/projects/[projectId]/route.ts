import { readProjectName } from "@/lib/server/budget/overview"
import { budgetResponse, budgetRouteProject, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

/** GET: the project's name and client name, for the budget screen header and export file names. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    return budgetResponse(await readProjectName(gate.value.session, gate.value.project.projectId), "project", "project GET")
  } catch (e) {
    return serverError("project GET", e)
  }
}
