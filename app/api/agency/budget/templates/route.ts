import { NextResponse } from "next/server"
import { createTemplateCategory, listTemplateCategories } from "@/lib/server/budget/chart"
import { budgetResponse, budgetRouteSession, includeArchived, noStore, readJson, serverError } from "@/lib/server/budget/http"
import { budgetWriteOrgId } from "@/lib/server/budget/scope"

export const dynamic = "force-dynamic"

/** GET: the caller's organizations' template categories. ?include_archived=1 adds archived rows. */
export async function GET(req: Request) {
  try {
    const gate = await budgetRouteSession()
    if (!gate.ok) return gate.response
    return budgetResponse(await listTemplateCategories(gate.value, { includeArchived: includeArchived(req) }), "categories", "templates GET")
  } catch (e) {
    return serverError("templates GET", e)
  }
}

/** POST { name, feeOrCost }: adds a category to the caller's acting organization's template. */
export async function POST(req: Request) {
  try {
    const gate = await budgetRouteSession()
    if (!gate.ok) return gate.response
    const writeOrgId = await budgetWriteOrgId(gate.value)
    if (!writeOrgId) {
      return NextResponse.json({ error: "Choose the organization you are working in first" }, { status: 403, headers: noStore })
    }
    const body = await readJson(req)
    return budgetResponse(
      await createTemplateCategory(gate.value.client, writeOrgId, { name: body.name, feeOrCost: body.feeOrCost }),
      "category",
      "templates POST",
      201
    )
  } catch (e) {
    return serverError("templates POST", e)
  }
}
