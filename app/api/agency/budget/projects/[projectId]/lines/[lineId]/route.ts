import { deleteLine, updateLine } from "@/lib/server/budget/lines"
import { budgetResponse, budgetRouteProject, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ projectId: string; lineId: string }> }

/** PATCH { name?, estimate?, categoryId?, archived? }. Archive is R1's alternative to delete. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { projectId, lineId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const body = await readJson(req)
    return budgetResponse(
      await updateLine(session.client, project, lineId, {
        name: body.name,
        estimate: body.estimate,
        categoryId: body.categoryId,
        archived: body.archived,
      }),
      "line",
      "line PATCH"
    )
  } catch (e) {
    return serverError("line PATCH", e)
  }
}

/** DELETE: R1. 403 code R1_ESTIMATE when the estimate is not 0; 409 when a ledger entry references it. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { projectId, lineId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    return budgetResponse(await deleteLine(session.client, project, lineId), "result", "line DELETE")
  } catch (e) {
    return serverError("line DELETE", e)
  }
}
