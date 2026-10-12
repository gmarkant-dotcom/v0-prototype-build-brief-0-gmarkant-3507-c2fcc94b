import { NextResponse } from "next/server"
import {
  deleteProjectCategory,
  mergeProjectCategories,
  promoteProjectCategory,
  renameProjectCategory,
  repointMergedCategory,
  setProjectCategoryArchived,
} from "@/lib/server/budget/chart"
import { budgetResponse, budgetRouteProject, noStore, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ projectId: string; categoryId: string }> }

/**
 * POST { action, ... } on one project category:
 *   archive | unarchive          R1 archive state
 *   promote                      copy name and flag into the project agency's template
 *   rename { name }              a merge into a new category of that name (history kept)
 *   merge { intoCategoryId }     merge this category into another of the same project
 *   repoint                      finish a recorded merge whose rows were not all moved
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { projectId, categoryId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const body = await readJson(req)
    const where = `chart/${String(body.action)} POST`
    switch (body.action) {
      case "archive":
      case "unarchive":
        return budgetResponse(await setProjectCategoryArchived(session.client, project, categoryId, body.action === "archive"), "category", where)
      case "promote":
        return budgetResponse(await promoteProjectCategory(session.client, project, categoryId), "templateCategory", where, 201)
      case "rename":
        return budgetResponse(await renameProjectCategory(session.client, project, categoryId, body.name), "result", where)
      case "merge":
        return budgetResponse(
          await mergeProjectCategories(session.client, project, categoryId, typeof body.intoCategoryId === "string" ? body.intoCategoryId : ""),
          "result",
          where
        )
      case "repoint":
        return budgetResponse(await repointMergedCategory(session.client, project, categoryId), "result", where)
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400, headers: noStore })
    }
  } catch (e) {
    return serverError("chart category POST", e)
  }
}

/** DELETE: R1, refused with 409 while any line, merge or ledger entry names the category. Archive instead. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { projectId, categoryId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    return budgetResponse(await deleteProjectCategory(session.client, project, categoryId), "result", "chart category DELETE")
  } catch (e) {
    return serverError("chart category DELETE", e)
  }
}
