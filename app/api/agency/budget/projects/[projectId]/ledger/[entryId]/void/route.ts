import { voidLedgerEntry } from "@/lib/server/budget/ledger"
import { budgetResponse, budgetRouteProject, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

/** POST { reason?, duplicateOf? }: R2. Entries are voided, never deleted. */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string; entryId: string }> }) {
  try {
    const { projectId, entryId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const body = await readJson(req)
    return budgetResponse(
      await voidLedgerEntry(session.client, project, entryId, { reason: body.reason, duplicateOf: body.duplicateOf }),
      "entry",
      "ledger void POST"
    )
  } catch (e) {
    return serverError("ledger void POST", e)
  }
}
