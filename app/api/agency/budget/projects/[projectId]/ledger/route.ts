import { createLedgerEntry, listLedgerEntries } from "@/lib/server/budget/ledger"
import { budgetResponse, budgetRouteProject, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ projectId: string }> }

/** GET: the project's ledger entries. ?include_voided=1 adds voided entries (R2: they stay readable). */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const includeVoided = new URL(req.url).searchParams.get("include_voided") === "1"
    return budgetResponse(await listLedgerEntries(session.client, project, { includeVoided }), "entries", "ledger GET")
  } catch (e) {
    return serverError("ledger GET", e)
  }
}

/** POST { sourceDocumentId, categoryId, amount, budgetLineId?, payeeName?, entryDate?, categoryConfidence?, categoryReasoning? }. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const body = await readJson(req)
    return budgetResponse(
      await createLedgerEntry(session.client, project, {
        sourceDocumentId: body.sourceDocumentId,
        categoryId: body.categoryId,
        amount: body.amount,
        budgetLineId: body.budgetLineId,
        payeeName: body.payeeName,
        entryDate: body.entryDate,
        categoryConfidence: body.categoryConfidence,
        categoryReasoning: body.categoryReasoning,
      }),
      "entry",
      "ledger POST",
      201
    )
  } catch (e) {
    return serverError("ledger POST", e)
  }
}
