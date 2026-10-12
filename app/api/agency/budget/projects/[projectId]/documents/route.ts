import { listProjectDocuments, recordDocumentUpload, setProjectDocumentsArchived } from "@/lib/server/budget/documents"
import { NextResponse } from "next/server"
import { budgetResponse, budgetRouteProject, includeArchived, noStore, readJson, serverError } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ projectId: string }> }

/** GET: the project's source document records (metadata only). ?include_archived=1 adds archived ones. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    return budgetResponse(await listProjectDocuments(session.client, project, { includeArchived: includeArchived(req) }), "documents", "documents GET")
  } catch (e) {
    return serverError("documents GET", e)
  }
}

/**
 * POST { action: "record", fileName, blobPath, partnershipId? }: records an AGENCY document's
 *   metadata. Nothing is uploaded here; blobPath must sit under budget/<projectId>/.
 * POST { action: "archive" | "unarchive" }: R3, every document of the project. Files are kept.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params
    const gate = await budgetRouteProject(projectId)
    if (!gate.ok) return gate.response
    const { session, project } = gate.value
    const body = await readJson(req)
    if (body.action === "record") {
      return budgetResponse(
        await recordDocumentUpload(session.client, project, {
          fileName: body.fileName,
          blobPath: body.blobPath,
          partnershipId: body.partnershipId,
        }),
        "document",
        "documents POST record",
        201
      )
    }
    if (body.action === "archive" || body.action === "unarchive") {
      return budgetResponse(await setProjectDocumentsArchived(session.client, project, body.action === "archive"), "result", `documents POST ${body.action}`)
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400, headers: noStore })
  } catch (e) {
    return serverError("documents POST", e)
  }
}
