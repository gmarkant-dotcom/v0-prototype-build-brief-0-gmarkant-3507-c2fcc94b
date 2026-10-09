import { setDocumentVisibility } from "@/lib/server/budget/documents"
import { budgetResponse, budgetRouteProject, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

/**
 * PATCH { visibleToVendor, partnershipId? }: the per-document toggle. partnershipId shares an
 * unshared document with one vendor; a set partnership cannot be changed.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  try {
    const { projectId, documentId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const body = await readJson(req)
    return budgetResponse(
      await setDocumentVisibility(session.client, project, documentId, {
        visibleToVendor: body.visibleToVendor,
        partnershipId: body.partnershipId,
      }),
      "document",
      "document PATCH"
    )
  } catch (e) {
    return serverError("document PATCH", e)
  }
}
