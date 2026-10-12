import { createLine, listLines } from "@/lib/server/budget/lines"
import { budgetResponse, budgetRouteProject, includeArchived, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ projectId: string }> }

/** GET: the project's budget lines (estimate only). ?include_archived=1 adds archived lines. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    return budgetResponse(await listLines(session.client, project, { includeArchived: includeArchived(req) }), "lines", "lines GET")
  } catch (e) {
    return serverError("lines GET", e)
  }
}

/** POST { categoryId, name, estimate }. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const body = await readJson(req)
    return budgetResponse(
      await createLine(session.client, project, { categoryId: body.categoryId, name: body.name, estimate: body.estimate }),
      "line",
      "lines POST",
      201
    )
  } catch (e) {
    return serverError("lines POST", e)
  }
}
