import type { SupabaseClient } from "@supabase/supabase-js"
import {
  BUDGET_RPCS,
  BUDGET_TABLES,
  RPC_PROJECT_ARG,
  SOURCE_DOCUMENT_COLUMNS,
  budgetBlobPrefix,
  cols,
  type SourceDocument,
} from "./schema"
import { fail, fromDbError, ok, type BudgetResult } from "./result"
import type { AgencyProject } from "./scope"

/**
 * SOURCE DOCUMENTS (104), AGENCY SIDE ONLY. METADATA ONLY: nothing here uploads, fetches or deletes
 * a file. There is no vendor helper and no vendor route; a vendor's read of source_documents is
 * its own policy's business and is not exposed by this layer.
 *
 *  - recordDocumentUpload files an AGENCY document (uploader_side 'agency'; the INSERT policy
 *    admits nothing else). Vendor-provided documents are written by trusted server code that does
 *    not exist yet; that path is out of scope (docs/budget-spine-server-report.md).
 *  - The visibility toggle needs a partnership (CHECK source_documents_toggle_needs_partnership).
 *  - Archive and unarchive go through 104's R3 functions, per project. They touch archived_at only
 *    and change no one's access.
 */

function validBlobPath(projectId: string, blobPath: unknown): string | null {
  if (typeof blobPath !== "string") return null
  const path = blobPath.trim()
  if (!path.startsWith(budgetBlobPrefix(projectId))) return null
  if (path.includes("..") || path.includes("://") || path.length > 500) return null
  return path
}

export async function listProjectDocuments(
  client: SupabaseClient,
  project: AgencyProject,
  opts: { includeArchived?: boolean } = {}
): Promise<BudgetResult<SourceDocument[]>> {
  let query = client
    .from(BUDGET_TABLES.sourceDocuments)
    .select(cols(SOURCE_DOCUMENT_COLUMNS))
    .eq("project_id", project.projectId)
    .order("created_at", { ascending: true })
  if (!opts.includeArchived) query = query.is("archived_at", null)
  const { data, error } = await query
  if (error) return fromDbError(error)
  return ok((data ?? []) as unknown as SourceDocument[])
}

export async function recordDocumentUpload(
  client: SupabaseClient,
  project: AgencyProject,
  input: { fileName: unknown; blobPath: unknown; partnershipId?: unknown }
): Promise<BudgetResult<SourceDocument>> {
  const file_name = typeof input.fileName === "string" ? input.fileName.trim() : ""
  if (!file_name || file_name.length > 300) return fail("invalid", "A document needs a file name")
  const blob_path = validBlobPath(project.projectId, input.blobPath)
  if (!blob_path) return fail("invalid", `The file must be stored under ${budgetBlobPrefix(project.projectId)}`)
  let partnership_id: string | null = null
  if (input.partnershipId !== undefined && input.partnershipId !== null) {
    if (typeof input.partnershipId !== "string" || !input.partnershipId) return fail("invalid", "Invalid partnership")
    partnership_id = input.partnershipId
  }

  const { data, error } = await client
    .from(BUDGET_TABLES.sourceDocuments)
    .insert({ project_id: project.projectId, partnership_id, uploader_side: "agency", visible_to_vendor: false, file_name, blob_path })
    .select(cols(SOURCE_DOCUMENT_COLUMNS))
    .single()
  // 23514 from source_documents_guard: the partnership is not this project's agency's.
  if (error) return fromDbError(error)
  return ok(data as unknown as SourceDocument)
}

/**
 * The per-document toggle. Turning it on for a document with no partnership is refused by the
 * database (invalid). `partnershipId` may be given to SHARE an unshared document (NULL to a
 * value); a set partnership can never be changed (source_documents_guard).
 */
export async function setDocumentVisibility(
  client: SupabaseClient,
  project: AgencyProject,
  documentId: string,
  input: { visibleToVendor: unknown; partnershipId?: unknown }
): Promise<BudgetResult<SourceDocument>> {
  if (typeof input.visibleToVendor !== "boolean") return fail("invalid", "visibleToVendor must be true or false")
  const patch: Record<string, unknown> = { visible_to_vendor: input.visibleToVendor }
  if (input.partnershipId !== undefined) {
    if (typeof input.partnershipId !== "string" || !input.partnershipId) return fail("invalid", "Invalid partnership")
    patch.partnership_id = input.partnershipId
  }
  const { data, error } = await client
    .from(BUDGET_TABLES.sourceDocuments)
    .update(patch)
    .eq("project_id", project.projectId)
    .eq("id", documentId)
    .select(cols(SOURCE_DOCUMENT_COLUMNS))
    .maybeSingle()
  if (error) return fromDbError(error)
  if (!data) return fail("not_found", "Document not found")
  return ok(data as unknown as SourceDocument)
}

/** R3. Returns the number of documents whose archived_at changed. */
export async function setProjectDocumentsArchived(
  client: SupabaseClient,
  project: AgencyProject,
  archived: boolean
): Promise<BudgetResult<{ changed: number }>> {
  const fn = archived ? BUDGET_RPCS.archiveProjectDocuments : BUDGET_RPCS.unarchiveProjectDocuments
  const { data, error } = await client.rpc(fn, { [RPC_PROJECT_ARG]: project.projectId })
  if (error) return fromDbError(error)
  return ok({ changed: typeof data === "number" ? data : Number(data) || 0 })
}
