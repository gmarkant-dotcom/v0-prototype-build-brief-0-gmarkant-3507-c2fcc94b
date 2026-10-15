import type { OrgId } from "@/lib/entitlements"
import { pickVendorCopy } from "@/lib/rfp-vendor-copy"
import {
  checkVendorText,
  lineVendorTextFields,
  sharedVendorTextFields,
  summarizeVendorTextMatches,
  type VendorTextField,
} from "@/lib/rfp-vendor-text-check"
import type { RfpRecordClient } from "@/lib/server/rfp-record"

/**
 * Ruling OV-A, server side. AGENCY READS ONLY: every function here is called on the agency's session
 * client after G1, and every query is filtered to the caller's own organizations on top of RLS. Nothing
 * here is reachable from a vendor or guest route, and nothing here writes.
 *
 * Client names are SERVER-DERIVED: the project's client_name and, when the project is linked to a
 * client profile of the caller's own organization, that profile's name. The clients table has no alias
 * column (077); the detection function covers spelling variants itself (lib/rfp-vendor-text-check.ts).
 */

type DbError = { code?: string | null; message?: string | null } | null | undefined

function logReadFailure(site: string, what: string, err: DbError) {
  // Codes only: no row content, no text.
  console.error("[rfp-vendor-text] read failed; warnings computed without it", { site, what, code: err?.code })
}

function trimmed(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** Every known client name per project: projects.client_name, then the linked profile's name. */
export async function readProjectClientNames(
  client: RfpRecordClient,
  site: string,
  projectIds: readonly (string | null | undefined)[],
  orgIds: readonly OrgId[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const ids = [...new Set(projectIds.filter((v): v is string => typeof v === "string" && v.length > 0))]
  if (ids.length === 0 || orgIds.length === 0) return out
  const { data: projects, error } = await client
    .from("projects")
    .select("id, client_name, client_id")
    .in("id", ids)
    .in("org_id", orgIds as OrgId[])
  if (error) {
    logReadFailure(site, "projects", error)
    return out
  }
  type ProjectRow = { id: string; client_name: string | null; client_id: string | null }
  const rows = (projects || []) as ProjectRow[]
  const clientIds = [...new Set(rows.map((p) => p.client_id).filter((v): v is string => Boolean(v)))]
  const profileNameById = new Map<string, string>()
  if (clientIds.length > 0) {
    // A project's client_id is believed only for a profile of the caller's own organization.
    const { data: profiles, error: profilesErr } = await client
      .from("clients")
      .select("id, name")
      .in("id", clientIds)
      .in("org_id", orgIds as OrgId[])
    if (profilesErr) logReadFailure(site, "clients", profilesErr)
    for (const p of (profiles || []) as Array<{ id: string; name: string | null }>) {
      const name = trimmed(p.name)
      if (name) profileNameById.set(p.id, name)
    }
  }
  for (const p of rows) {
    const names = [trimmed(p.client_name), p.client_id ? profileNameById.get(p.client_id) ?? null : null].filter(
      (n): n is string => Boolean(n)
    )
    out.set(p.id, names)
  }
  return out
}

/** One sent RFP as the bids list shows it: the client control and the read-only text warnings. */
export type RfpRecordClientSummary = {
  id: string
  source: "wizard" | "magic_link" | "backfill"
  show_client_to_vendors: boolean
  /** Agency pages only (the hover on the control). Never sent to a vendor. */
  client_name: string | null
  project_name: string | null
  broadcast_at: string | null
  /**
   * names_client: the vendor-visible text names the client (computed as if hidden; the page shows it
   * only while the client IS hidden). shows_figures: money or percentages per OV-A.
   */
  text_warnings: { names_client: boolean; shows_figures: boolean }
}

/**
 * The summaries for the records behind the bids list, batched: one read of the records, then their
 * lines and their projects' client names in parallel. Never one call per row. A read failure answers
 * with fewer summaries (the page then shows no control for those groups), never an error.
 */
export async function readRecordClientSummaries(
  client: RfpRecordClient,
  site: string,
  recordIds: readonly (string | null | undefined)[],
  orgIds: readonly OrgId[]
): Promise<Map<string, RfpRecordClientSummary>> {
  const out = new Map<string, RfpRecordClientSummary>()
  const ids = [...new Set(recordIds.filter((v): v is string => typeof v === "string" && v.length > 0))]
  if (ids.length === 0 || orgIds.length === 0) return out

  const { data: records, error } = await client
    .from("rfp_records")
    .select("id, source, show_client_to_vendors, client_name_snapshot, broadcast_at, project_id, master_rfp")
    .in("id", ids)
    .in("lead_org_id", orgIds as OrgId[])
  if (error) {
    logReadFailure(site, "rfp_records", error)
    return out
  }
  type RecordRow = {
    id: string
    source: RfpRecordClientSummary["source"]
    show_client_to_vendors: boolean | null
    client_name_snapshot: string | null
    broadcast_at: string | null
    project_id: string | null
    master_rfp: unknown
  }
  const recordRows = (records || []) as RecordRow[]
  if (recordRows.length === 0) return out

  const [linesResult, namesByProject] = await Promise.all([
    client
      .from("rfp_record_lines")
      .select("id, rfp_id, scope_item_key, scope_item_name, scope_item_description, released_budget, sort_order")
      .in("rfp_id", recordRows.map((r) => r.id))
      .in("lead_org_id", orgIds as OrgId[]),
    readProjectClientNames(client, site, recordRows.map((r) => r.project_id), orgIds),
  ])
  if (linesResult.error) logReadFailure(site, "rfp_record_lines", linesResult.error)
  type LineRow = {
    rfp_id: string
    scope_item_key: string
    scope_item_name: string | null
    scope_item_description: string | null
    released_budget: string | null
  }
  const linesByRecord = new Map<string, LineRow[]>()
  for (const l of (linesResult.data || []) as LineRow[]) {
    const list = linesByRecord.get(l.rfp_id) ?? []
    list.push(l)
    linesByRecord.set(l.rfp_id, list)
  }

  for (const r of recordRows) {
    const master =
      r.master_rfp && typeof r.master_rfp === "object" && !Array.isArray(r.master_rfp)
        ? (r.master_rfp as Record<string, unknown>)
        : {}
    // The vendor reads only the allow-listed keys; the record also holds the agency's own keys.
    const fields: VendorTextField[] = sharedVendorTextFields(pickVendorCopy(master))
    const scopeTimelineByKey = scopeTimelines(master)
    for (const l of linesByRecord.get(r.id) ?? []) {
      fields.push(
        ...lineVendorTextFields({
          key: l.scope_item_key,
          name: l.scope_item_name,
          description: l.scope_item_description,
          timeline: scopeTimelineByKey.get(l.scope_item_key) ?? null,
          budgetReleased: Boolean(trimmed(l.released_budget)),
        })
      )
    }
    const names = [trimmed(r.client_name_snapshot), ...(r.project_id ? namesByProject.get(r.project_id) ?? [] : [])]
    const flags = summarizeVendorTextMatches(checkVendorText({ clientHidden: true, clientNames: names, fields }))
    out.set(r.id, {
      id: r.id,
      source: r.source,
      show_client_to_vendors: r.show_client_to_vendors === true,
      client_name: trimmed(r.client_name_snapshot),
      project_name: trimmed(master.projectName),
      broadcast_at: r.broadcast_at,
      text_warnings: { names_client: flags.namesClient, shows_figures: flags.showsFigures },
    })
  }
  return out
}

/** A wizard line's own timeline lives in the record's master_rfp.scopeItems (the vendor row's timeline column). */
function scopeTimelines(master: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>()
  const items = Array.isArray(master.scopeItems) ? master.scopeItems : []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const it = item as Record<string, unknown>
    const key = typeof it.id === "string" ? it.id : null
    const timeline = trimmed(it.timeline)
    if (key && timeline) out.set(key, timeline)
  }
  return out
}
