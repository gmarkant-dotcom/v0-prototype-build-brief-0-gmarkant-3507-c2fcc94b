import { deleteTemplateCategory, updateTemplateCategory } from "@/lib/server/budget/chart"
import { budgetResponse, budgetRouteSession, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

/** PATCH { name?, feeOrCost?, archived? }: edits a template category. Changes no project (copy, not pointer). */
export async function PATCH(req: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  try {
    const { categoryId } = await params
    const gate = await budgetRouteSession()
    if (!gate.ok) return gate.response
    const body = await readJson(req)
    return budgetResponse(
      await updateTemplateCategory(gate.value, categoryId, { name: body.name, feeOrCost: body.feeOrCost, archived: body.archived }),
      "category",
      "templates PATCH"
    )
  } catch (e) {
    return serverError("templates PATCH", e)
  }
}

/** DELETE: R1 allows it, since nothing references a template row. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  try {
    const { categoryId } = await params
    const gate = await budgetRouteSession()
    if (!gate.ok) return gate.response
    return budgetResponse(await deleteTemplateCategory(gate.value, categoryId), "result", "templates DELETE")
  } catch (e) {
    return serverError("templates DELETE", e)
  }
}
