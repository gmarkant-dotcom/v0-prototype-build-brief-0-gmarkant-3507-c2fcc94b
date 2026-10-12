import type { SupabaseClient } from "@supabase/supabase-js"
import { BUDGET_TABLES, budgetBlobPrefix } from "./schema"
import { fromDbError, ok, type BudgetResult } from "./result"
import type { OrgId } from "@/lib/entitlements"

/**
 * THE VENDOR'S READ OF BUDGET DOCUMENTS. The only vendor-side code that names a budget-spine table,
 * and the only table it names is source_documents (docs/budget-spine-build-plan.md, Phase C step 2).
 *
 *  - `client` is the caller's own session client. source_documents_vendor_select (104) decides
 *    which rows come back: agency documents toggled visible on an active or suspended partnership,
 *    and the vendor side's own uploads under any status (R4).
 *  - The partnership filter (vendor_org_id in the caller's own organizations) keeps the list to the
 *    vendor's side of its relationships, so a person who is also a member of the agency does not
 *    see the agency's private documents here through the agency policy.
 *  - The R4 predicate is applied again in code as a second fence, never as the first. It can only
 *    remove rows the policy returned, never add one.
 *  - METADATA ONLY: file name, a type derived from the name, the date and the source. No blob path,
 *    no download, no amounts, no budget, line, category or ledger data.
 */

const SHAREABLE = new Set(["active", "suspended"])

export type VendorDocument = {
  id: string
  fileName: string
  type: string
  source: "agency" | "you"
  createdAt: string
  archived: boolean
}

export type VendorDocumentGroup = {
  projectId: string
  projectName: string
  agencyName: string
  documents: VendorDocument[]
}

function typeOf(fileName: string, blobPath: string, projectId: string): string {
  if (blobPath.startsWith(`${budgetBlobPrefix(projectId)}manual/`)) return "Manual entry"
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName.trim())
  return m ? m[1].toUpperCase() : "File"
}

export async function listVendorBudgetDocuments(client: SupabaseClient, orgIds: OrgId[]): Promise<BudgetResult<VendorDocumentGroup[]>> {
  if (orgIds.length === 0) return ok([])

  const { data: partnershipRows, error: pErr } = await client
    .from("partnerships")
    .select("id, lead_org_id, status")
    .in("vendor_org_id", orgIds)
  if (pErr) return fromDbError(pErr)
  const partnerships = (partnershipRows ?? []) as Array<{ id: string; lead_org_id: string | null; status: string | null }>

  // Probe the table even with no partnerships, so "not enabled" is reported the same way for everyone.
  if (partnerships.length === 0) {
    const { error } = await client.from(BUDGET_TABLES.sourceDocuments).select("id").limit(1)
    if (error) return fromDbError(error)
    return ok([])
  }
  const byId = new Map(partnerships.map((p) => [p.id, p]))

  const { data: docRows, error: dErr } = await client
    .from(BUDGET_TABLES.sourceDocuments)
    .select("id, project_id, partnership_id, uploader_side, visible_to_vendor, archived_at, file_name, blob_path, created_at")
    .in("partnership_id", Array.from(byId.keys()))
    .order("created_at", { ascending: false })
  if (dErr) return fromDbError(dErr)

  const docs = (
    (docRows ?? []) as Array<{
      id: string
      project_id: string
      partnership_id: string | null
      uploader_side: "agency" | "vendor"
      visible_to_vendor: boolean
      archived_at: string | null
      file_name: string
      blob_path: string
      created_at: string
    }>
  ).filter((d) => {
    const p = d.partnership_id ? byId.get(d.partnership_id) : undefined
    if (!p) return false
    return d.uploader_side === "vendor" || (d.visible_to_vendor && SHAREABLE.has(p.status ?? ""))
  })
  if (docs.length === 0) return ok([])

  const projectIds = Array.from(new Set(docs.map((d) => d.project_id)))
  const leadOrgIds = Array.from(new Set(partnerships.map((p) => p.lead_org_id).filter((x): x is string => Boolean(x))))
  const [{ data: projectRows }, { data: orgRows }] = await Promise.all([
    client.from("projects").select("id, name").in("id", projectIds),
    leadOrgIds.length ? client.from("organizations").select("id, name").in("id", leadOrgIds) : Promise.resolve({ data: [] }),
  ])
  // Names are best effort: a vendor may be unable to read a project row it is not assigned to.
  const projectName = new Map(((projectRows ?? []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name?.trim() || ""]))
  const orgName = new Map(((orgRows ?? []) as Array<{ id: string; name: string | null }>).map((o) => [o.id, o.name?.trim() || ""]))

  const groups = new Map<string, VendorDocumentGroup>()
  for (const d of docs) {
    const p = byId.get(d.partnership_id as string)
    const key = `${d.project_id}:${p?.lead_org_id ?? ""}`
    let g = groups.get(key)
    if (!g) {
      g = {
        projectId: d.project_id,
        projectName: projectName.get(d.project_id) || "Project",
        agencyName: (p?.lead_org_id && orgName.get(p.lead_org_id)) || "Lead agency",
        documents: [],
      }
      groups.set(key, g)
    }
    g.documents.push({
      id: d.id,
      fileName: d.file_name,
      type: typeOf(d.file_name, d.blob_path, d.project_id),
      source: d.uploader_side === "vendor" ? "you" : "agency",
      createdAt: d.created_at,
      archived: Boolean(d.archived_at),
    })
  }
  return ok(Array.from(groups.values()))
}
