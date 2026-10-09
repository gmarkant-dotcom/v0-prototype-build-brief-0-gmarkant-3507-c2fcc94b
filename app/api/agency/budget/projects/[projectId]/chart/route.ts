import { NextResponse } from "next/server"
import { addProjectCategory, copyTemplateToProject, listCategoryMerges, listProjectCategories } from "@/lib/server/budget/chart"
import { budgetResponse, budgetRouteProject, failureResponse, includeArchived, noStore, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ projectId: string }> }

/** GET: the project's chart and its merge history. ?include_archived=1 adds archived categories. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const categories = await listProjectCategories(session.client, project, { includeArchived: includeArchived(req) })
    if (!categories.ok) return failureResponse(categories, "chart GET")
    const merges = await listCategoryMerges(session.client, project)
    if (!merges.ok) return failureResponse(merges, "chart GET merges")
    return NextResponse.json({ categories: categories.data, merges: merges.data }, { headers: noStore })
  } catch (e) {
    return serverError("chart GET", e)
  }
}

/**
 * POST { action: "copy_template" }: R6 copy-on-create (409 if the chart already exists).
 * POST { action: "add", name, feeOrCost }: adds a category to this project's chart.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const body = await readJson(req)
    if (body.action === "copy_template") {
      return budgetResponse(await copyTemplateToProject(session.client, project), "result", "chart POST copy", 201)
    }
    if (body.action === "add") {
      return budgetResponse(
        await addProjectCategory(session.client, project, { name: body.name, feeOrCost: body.feeOrCost }),
        "category",
        "chart POST add",
        201
      )
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400, headers: noStore })
  } catch (e) {
    return serverError("chart POST", e)
  }
}
