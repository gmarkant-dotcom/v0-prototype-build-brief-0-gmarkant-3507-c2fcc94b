import { NextResponse } from "next/server"
import { createLine, listLines } from "@/lib/server/budget/lines"
import { budgetResponse, budgetRouteProject, failureResponse, includeArchived, noStore, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ projectId: string }> }

/**
 * GET: the project's budget lines. ?include_archived=1 adds archived lines. `lineMath` says whether
 * migration 116's quantity / rate / multiplier / unit columns exist; while it is false every line
 * carries them as null and the UI shows the typed estimate only.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const result = await listLines(session.client, project, { includeArchived: includeArchived(req) })
    if (!result.ok) return failureResponse(result, "lines GET")
    return NextResponse.json({ lines: result.data.lines, lineMath: result.data.lineMath }, { headers: noStore })
  } catch (e) {
    return serverError("lines GET", e)
  }
}

/** POST { categoryId, name, estimate?, quantity?, unitRate?, multiplier?, unitLabel? }. With unitRate, estimate is computed. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const body = await readJson(req)
    return budgetResponse(
      await createLine(session.client, project, {
        categoryId: body.categoryId,
        name: body.name,
        estimate: body.estimate,
        quantity: body.quantity,
        unitRate: body.unitRate,
        multiplier: body.multiplier,
        unitLabel: body.unitLabel,
      }),
      "line",
      "lines POST",
      201
    )
  } catch (e) {
    return serverError("lines POST", e)
  }
}
