import { listProjectBudgetOverview } from "@/lib/server/budget/overview"
import { budgetResponse, budgetRouteSession, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

/** GET: the caller's organizations' projects with budget status (no chart / chart / totals). */
export async function GET() {
  try {
    const gate = await budgetRouteSession()
    if (!gate.ok) return gate.response
    return budgetResponse(await listProjectBudgetOverview(gate.value), "projects", "projects GET")
  } catch (e) {
    return serverError("projects GET", e)
  }
}
