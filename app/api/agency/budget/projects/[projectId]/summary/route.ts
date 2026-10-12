import { getEstimateVsActual } from "@/lib/server/budget/summary"
import { budgetResponse, budgetRouteProject, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

/** GET: Estimate vs Actual per line. Actual = the line's non-voided ledger entries (R2, R5). */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    return budgetResponse(await getEstimateVsActual(session.client, project), "summary", "summary GET")
  } catch (e) {
    return serverError("summary GET", e)
  }
}
