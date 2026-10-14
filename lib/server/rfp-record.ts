import { z } from "zod"
import type { OrgId } from "@/lib/entitlements"

/**
 * The agency-owned RFP record (migration 118, docs/rfp-source-of-truth-design.md). Write helpers
 * for step A: the broadcast and magic-link routes write an rfp_records row and its
 * rfp_record_lines at send time, and link what they send to those lines.
 *
 * RULES:
 *  1. THE WRITE ORDER IS FIXED (118's header): the record WITHOUT broadcast_at, then its lines,
 *     then the vendor rows carrying rfp_line_id, then rfp_magic_tokens.attached_inbox_id, then
 *     broadcast_at LAST. 118's guards freeze the record and its lines once broadcast_at is set, so
 *     a writer that sets it early can never add a line.
 *  2. THE TWO FALLBACKS, AND ONLY THESE. 42P01 / PGRST205 (a table is missing: 118 not applied)
 *     skips the record entirely, logged once per process. 42703 / PGRST204 (a column is missing)
 *     retries without that column, logged once per column. Any other error is a FAILURE, and the
 *     routes fail closed on it: nothing is sent to any vendor.
 *  3. lead_org_id AND project_id ARE SERVER-DERIVED. The routes pass the caller's resolved write
 *     organization and a project they verified belongs to it; nothing here reads a request body.
 *     Lines never send lead_org_id: 118's guard copies it from the parent.
 *  4. WRITTEN ON THE CALLER'S SESSION CLIENT, so 118's RLS (paid lead agency, D1) applies even on
 *     the magic-link route, whose other writes use the service role.
 */

const RECORDS = "rfp_records"
const LINES = "rfp_record_lines"

type DbError = { code?: string | null; message?: string | null } | null | undefined

/**
 * A Supabase client narrowed to `.from()`. Loose for the same reason as lib/entitlements.ts
 * OrgLookupClient: naming the real builder type reaches TS2589.
 */
export type RfpRecordClient = {
  from: (table: string) => any
}

/** 42P01 from Postgres; PGRST205 from PostgREST when the table is not in its schema cache. */
export function isMissingTableError(err: DbError): boolean {
  if (!err) return false
  return err.code === "42P01" || err.code === "PGRST205"
}

/**
 * The column a 42703 / PGRST204 names, or "" when the error is that code but names none we can
 * read, or null when it is not a missing-column error at all.
 *   42703    column "rfp_line_id" of relation "partner_rfp_inbox" does not exist
 *   PGRST204 Could not find the 'rfp_line_id' column of 'partner_rfp_inbox' in the schema cache
 */
export function missingColumnName(err: DbError): string | null {
  if (!err || (err.code !== "42703" && err.code !== "PGRST204")) return null
  const message = typeof err.message === "string" ? err.message : ""
  const match = message.match(/column "([^"]+)"/) || message.match(/the '([^']+)' column/)
  return match ? match[1] : ""
}

let loggedTableMissing = false
const loggedMissingColumns = new Set<string>()

export function logRecordTableMissingOnce(site: string, err: DbError) {
  if (loggedTableMissing) return
  loggedTableMissing = true
  console.warn("[rfp-record] rfp_records / rfp_record_lines missing (migration 118 not applied); the RFP record is skipped", {
    site,
    code: err?.code,
  })
}

export function logColumnMissingOnce(site: string, table: string, column: string) {
  const key = `${table}.${column}`
  if (loggedMissingColumns.has(key)) return
  loggedMissingColumns.add(key)
  console.warn("[rfp-record] column missing, retrying without it", { site, column: key })
}

/**
 * Runs `attempt` with `payload`, dropping a column named by a 42703 / PGRST204 and retrying,
 * at most once per column the payload carries. Never drops a column the payload does not carry,
 * and never retries any other error. Works for a single row or an array of rows.
 */
export async function withColumnFallback<T, P extends Record<string, unknown> | Record<string, unknown>[]>(
  site: string,
  table: string,
  payload: P,
  attempt: (payload: P) => PromiseLike<{ data: T | null; error: DbError }>
): Promise<{ data: T | null; error: DbError }> {
  let current = payload
  let result = await attempt(current)
  const sample = (Array.isArray(current) ? current[0] : current) ?? {}
  for (let i = 0; i < Object.keys(sample).length; i++) {
    const column = missingColumnName(result.error)
    if (!column) break
    const carries = Array.isArray(current) ? current.some((r) => column in r) : column in current
    if (!carries) break
    logColumnMissingOnce(site, table, column)
    current = (
      Array.isArray(current)
        ? current.map((r) => {
            const { [column]: _dropped, ...rest } = r
            return rest
          })
        : (() => {
            const { [column]: _dropped, ...rest } = current as Record<string, unknown>
            return rest
          })()
    ) as P
    result = await attempt(current)
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// REQUEST FIELDS (zod). The only new fields step A reads from a request body. Everything else the
// record holds is taken from what the route already validated, or derived on the server.
// ---------------------------------------------------------------------------------------------

/** POST /api/agency/broadcast-rfp: the client toggle, and one release choice per scope item. */
export const broadcastRecordFieldsSchema = z
  .object({
    show_client_to_vendors: z.boolean().optional(),
    items: z.array(z.object({ releaseBudget: z.boolean().optional() }).passthrough()).optional(),
  })
  .passthrough()

/** POST /api/agency/rfp/magic-link: the client toggle, the one line's release choice and figure. */
export const magicLinkRecordFieldsSchema = z
  .object({
    show_client_to_vendors: z.boolean().optional(),
    release_budget: z.boolean().optional(),
    estimated_budget: z.string().trim().max(200).nullable().optional(),
  })
  .passthrough()

// ---------------------------------------------------------------------------------------------
// THE WRITES.
// ---------------------------------------------------------------------------------------------

export type RfpRecordInput = {
  leadOrgId: OrgId
  /** Verified by the route to belong to leadOrgId, or null. */
  projectId: string | null
  source: "wizard" | "magic_link"
  createdBy: string
  masterRfp: Record<string, unknown>
  evaluationCriteria: unknown
  budgetCategories: unknown
  businessCriteriaRequired: unknown
  outputTemplateConfig: unknown
  totalBudget: string | null
  showClientToVendors: boolean
  clientNameSnapshot: string | null
  responseDeadline: string | null
  closeBiddingAtDeadline: boolean
  requireTermsDisclosure: boolean
  ndaLink: string | null
}

export type RfpRecordLineInput = {
  scopeItemKey: string
  scopeItemName: string
  scopeItemDescription: string | null
  estimatedBudget: string | null
  /** D2: null = hidden, the default for a new RFP. */
  releasedBudget: string | null
  sortOrder: number
}

export type RfpRecordDraft =
  /** 118 is not applied. The route carries on exactly as before step A. */
  | { status: "skipped" }
  | { status: "created"; recordId: string; lineIdByKey: Map<string, string> }
  /** Any other error. The route must fail closed and send nothing. */
  | { status: "failed"; step: "record" | "lines"; error: DbError }

/**
 * Steps 1 and 2 of the write order: the record without broadcast_at, then its lines. Duplicate
 * scope keys are collapsed (first wins), because 118 has UNIQUE (rfp_id, scope_item_key) and a
 * duplicate key would otherwise fail the whole send.
 */
export async function createRfpRecordDraft(
  client: RfpRecordClient,
  site: string,
  record: RfpRecordInput,
  lines: readonly RfpRecordLineInput[]
): Promise<RfpRecordDraft> {
  const recordRow: Record<string, unknown> = {
    lead_org_id: record.leadOrgId,
    project_id: record.projectId,
    source: record.source,
    master_rfp: record.masterRfp,
    evaluation_criteria: record.evaluationCriteria ?? null,
    budget_categories: record.budgetCategories ?? null,
    business_criteria_required: record.businessCriteriaRequired ?? {},
    output_template_config: record.outputTemplateConfig ?? null,
    total_budget: record.totalBudget,
    show_client_to_vendors: record.showClientToVendors,
    client_name_snapshot: record.clientNameSnapshot,
    response_deadline: record.responseDeadline,
    close_bidding_at_deadline: record.closeBiddingAtDeadline,
    require_terms_disclosure: record.requireTermsDisclosure,
    nda_link: record.ndaLink,
    created_by: record.createdBy,
  }

  const inserted = await withColumnFallback<{ id: string }, Record<string, unknown>>(site, RECORDS, recordRow, (row) =>
    client.from(RECORDS).insert(row).select("id").single()
  )
  if (inserted.error) {
    if (isMissingTableError(inserted.error)) {
      logRecordTableMissingOnce(site, inserted.error)
      return { status: "skipped" }
    }
    console.error("[rfp-record] record insert failed", { site, code: inserted.error.code, message: inserted.error.message })
    return { status: "failed", step: "record", error: inserted.error }
  }
  const recordId = inserted.data?.id
  if (!recordId) {
    console.error("[rfp-record] record insert returned no id", { site })
    return { status: "failed", step: "record", error: { code: "LGRECORD", message: "record insert returned no row" } }
  }

  const seen = new Set<string>()
  const lineRows: Record<string, unknown>[] = []
  for (const line of lines) {
    const key = line.scopeItemKey.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    lineRows.push({
      rfp_id: recordId,
      scope_item_key: key,
      scope_item_name: line.scopeItemName,
      scope_item_description: line.scopeItemDescription,
      estimated_budget: line.estimatedBudget,
      released_budget: line.releasedBudget,
      sort_order: line.sortOrder,
    })
  }

  const lineIdByKey = new Map<string, string>()
  if (lineRows.length > 0) {
    const insertedLines = await withColumnFallback<Array<{ id: string; scope_item_key: string }>, Record<string, unknown>[]>(
      site,
      LINES,
      lineRows,
      (rows) => client.from(LINES).insert(rows).select("id, scope_item_key")
    )
    if (insertedLines.error) {
      if (isMissingTableError(insertedLines.error)) {
        // Unreachable when 118 is applied (one transaction creates both tables). The record row
        // already written stays an unsent draft (broadcast_at NULL), which is honest.
        logRecordTableMissingOnce(site, insertedLines.error)
        return { status: "skipped" }
      }
      console.error("[rfp-record] line insert failed", {
        site,
        recordId,
        code: insertedLines.error.code,
        message: insertedLines.error.message,
      })
      return { status: "failed", step: "lines", error: insertedLines.error }
    }
    for (const row of insertedLines.data || []) lineIdByKey.set(row.scope_item_key, row.id)
    if (lineIdByKey.size !== lineRows.length) {
      console.error("[rfp-record] line insert returned fewer rows than written", { site, recordId, wrote: lineRows.length, read: lineIdByKey.size })
      return { status: "failed", step: "lines", error: { code: "LGRECORD", message: "line insert returned fewer rows than written" } }
    }
  }

  return { status: "created", recordId, lineIdByKey }
}

/**
 * Step 5: broadcast_at, LAST, and only when every send succeeded. Returns false on any failure,
 * which is logged: the vendors already have the RFP, so the route does not fail on it, and the
 * record stays an unsent draft (broadcast_at NULL) that a later pass can see.
 */
export async function markRfpRecordBroadcast(client: RfpRecordClient, site: string, recordId: string): Promise<boolean> {
  const { data, error } = await client
    .from(RECORDS)
    .update({ broadcast_at: new Date().toISOString() })
    .eq("id", recordId)
    .is("broadcast_at", null)
    .select("id")
  if (error) {
    console.error("[rfp-record] could not set broadcast_at; the record stays an unsent draft", {
      site,
      recordId,
      code: error.code,
      message: error.message,
    })
    return false
  }
  if (!Array.isArray(data) || data.length !== 1) {
    console.error("[rfp-record] setting broadcast_at matched no row; the record stays an unsent draft", { site, recordId })
    return false
  }
  return true
}

// ---------------------------------------------------------------------------------------------
// THE READS (step B). The agency reads its own record where a vendor row is linked to one.
//
// RULES:
//  1. THE RECORD WINS WHEN THE ROW IS LINKED. An inbox row (or, for a guest bid, its token) that
//     carries rfp_line_id is answered from rfp_records / rfp_record_lines. The vendor's copy
//     (partner_rfp_inbox.master_rfp_json) is read ONLY when rfp_line_id is NULL: rows sent before
//     step A that 119 has not backfilled. A linked row whose record cannot be read is answered
//     with nothing, never with the vendor's copy.
//  2. "Unknown" IS NOT "linked". When the link column itself cannot be read (42703 / PGRST204 /
//     42P01 / PGRST205 before 118, or any other error, logged) the row is treated as unlinked and
//     the caller keeps today's read. That is exactly the behaviour before step B.
//  3. ONLY THE SIGNED-IN AGENCY SESSION READS THE RECORD. Every read here runs on the client the
//     caller passes, under 118's RLS (paid lead agency, D1), and also filters lead_org_id to the
//     caller's own organizations. Callers state their mode: "session" (an agency route, after the
//     G1 gate, on the session client) or "skip" (anything else: a vendor- or guest-triggered
//     background job on the service role keeps its current behaviour). No read here may be given
//     a service-role client in "session" mode.
// ---------------------------------------------------------------------------------------------
export type RecordReadMode = "session" | "skip"

/** What an agency reader takes from the record for one scope line. */
export type RfpRecordLineView = {
  lineId: string
  recordId: string
  scopeItemKey: string
  scopeItemName: string | null
  scopeItemDescription: string | null
  masterRfp: Record<string, unknown>
  /** master_rfp.projectName as broadcast, or null. */
  projectName: string | null
  evaluationCriteria: unknown
  budgetCategories: unknown
  businessCriteriaRequired: unknown
  ndaLink: string | null
}

/** A linked row answers from the record (view null when it cannot be read); an unlinked one does not. */
export type RecordResolution = { linked: false } | { linked: true; lineId: string; view: RfpRecordLineView | null }

const loggedReadGaps = new Set<string>()

function logReadGapOnce(site: string, what: string, err: DbError) {
  const key = `${site}:${what}:${err?.code ?? ""}`
  if (loggedReadGaps.has(key)) return
  loggedReadGaps.add(key)
  console.warn("[rfp-record] link read unavailable; using the inbox copy as before step B", {
    site,
    what,
    code: err?.code,
    message: err?.message,
  })
}

function nonEmptyIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))]
}

function trimmedOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** rfp_line_id of each of the caller's own inbox rows that carries one. */
export async function readInboxLineIds(
  client: RfpRecordClient,
  site: string,
  inboxIds: readonly (string | null | undefined)[],
  orgIds: readonly OrgId[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = nonEmptyIds(inboxIds)
  if (ids.length === 0 || orgIds.length === 0) return out
  const { data, error } = await client
    .from("partner_rfp_inbox")
    .select("id, rfp_line_id")
    .in("id", ids)
    .in("lead_org_id", orgIds as OrgId[])
  if (error) {
    logReadGapOnce(site, "partner_rfp_inbox.rfp_line_id", error)
    return out
  }
  for (const row of (data || []) as Array<{ id: string; rfp_line_id: string | null }>) {
    if (row.rfp_line_id) out.set(row.id, row.rfp_line_id)
  }
  return out
}

export type TokenLink = { lineId: string | null; attachedInboxId: string | null }

/** rfp_line_id and attached_inbox_id of the caller's own tokens, keyed by response_id. */
export async function readTokenLinksByResponse(
  client: RfpRecordClient,
  site: string,
  responseIds: readonly (string | null | undefined)[],
  orgIds: readonly OrgId[]
): Promise<Map<string, TokenLink>> {
  const out = new Map<string, TokenLink>()
  const ids = nonEmptyIds(responseIds)
  if (ids.length === 0 || orgIds.length === 0) return out
  const { data, error } = await client
    .from("rfp_magic_tokens")
    .select("response_id, rfp_line_id, attached_inbox_id")
    .in("response_id", ids)
    .in("org_id", orgIds as OrgId[])
  if (error) {
    logReadGapOnce(site, "rfp_magic_tokens link columns", error)
    return out
  }
  for (const row of (data || []) as Array<{ response_id: string; rfp_line_id: string | null; attached_inbox_id: string | null }>) {
    out.set(row.response_id, { lineId: row.rfp_line_id ?? null, attachedInboxId: row.attached_inbox_id ?? null })
  }
  return out
}

/**
 * The guest-bid join (step B): the inbox row a token is attached to, from
 * rfp_magic_tokens.attached_inbox_id. Null when the token has none or the column cannot be read;
 * the caller then keeps the master_rfp_json._magic_token join as the fallback.
 */
export async function readTokenAttachedInboxId(
  client: RfpRecordClient,
  site: string,
  token: string,
  orgIds: readonly OrgId[]
): Promise<string | null> {
  if (!token || orgIds.length === 0) return null
  const { data, error } = await client
    .from("rfp_magic_tokens")
    .select("attached_inbox_id")
    .eq("token", token)
    .in("org_id", orgIds as OrgId[])
    .maybeSingle()
  if (error) {
    logReadGapOnce(site, "rfp_magic_tokens.attached_inbox_id", error)
    return null
  }
  return (data?.attached_inbox_id as string | null | undefined) ?? null
}

/** The record view of each line, read under the caller's RLS and org filter. */
export async function readRecordLines(
  client: RfpRecordClient,
  site: string,
  lineIds: readonly (string | null | undefined)[],
  orgIds: readonly OrgId[]
): Promise<Map<string, RfpRecordLineView>> {
  const out = new Map<string, RfpRecordLineView>()
  const ids = nonEmptyIds(lineIds)
  if (ids.length === 0 || orgIds.length === 0) return out

  const lines = await client
    .from(LINES)
    .select("id, rfp_id, scope_item_key, scope_item_name, scope_item_description")
    .in("id", ids)
    .in("lead_org_id", orgIds as OrgId[])
  if (lines.error) {
    console.error("[rfp-record] record line read failed; linked rows answer with nothing", {
      site,
      code: lines.error.code,
      message: lines.error.message,
    })
    return out
  }
  type LineRow = { id: string; rfp_id: string; scope_item_key: string; scope_item_name: string | null; scope_item_description: string | null }
  const lineRows = (lines.data || []) as LineRow[]
  const recordIds = nonEmptyIds(lineRows.map((l) => l.rfp_id))
  if (recordIds.length === 0) return out

  const records = await client
    .from(RECORDS)
    .select("id, master_rfp, evaluation_criteria, budget_categories, business_criteria_required, nda_link")
    .in("id", recordIds)
    .in("lead_org_id", orgIds as OrgId[])
  if (records.error) {
    console.error("[rfp-record] record read failed; linked rows answer with nothing", {
      site,
      code: records.error.code,
      message: records.error.message,
    })
    return out
  }
  type RecordRow = {
    id: string
    master_rfp: unknown
    evaluation_criteria: unknown
    budget_categories: unknown
    business_criteria_required: unknown
    nda_link: string | null
  }
  const recordById = new Map(((records.data || []) as RecordRow[]).map((r) => [r.id, r]))

  for (const line of lineRows) {
    const record = recordById.get(line.rfp_id)
    if (!record) continue
    const master =
      record.master_rfp && typeof record.master_rfp === "object" && !Array.isArray(record.master_rfp)
        ? (record.master_rfp as Record<string, unknown>)
        : {}
    out.set(line.id, {
      lineId: line.id,
      recordId: record.id,
      scopeItemKey: line.scope_item_key,
      scopeItemName: trimmedOrNull(line.scope_item_name),
      scopeItemDescription: trimmedOrNull(line.scope_item_description),
      masterRfp: master,
      projectName: trimmedOrNull(master.projectName),
      evaluationCriteria: record.evaluation_criteria ?? null,
      budgetCategories: record.budget_categories ?? null,
      businessCriteriaRequired: record.business_criteria_required ?? null,
      ndaLink: trimmedOrNull(record.nda_link),
    })
  }
  return out
}

/** Resolves a resolution from a line id and the views already read. */
export function resolutionFor(lineId: string | null | undefined, views: Map<string, RfpRecordLineView>): RecordResolution {
  if (!lineId) return { linked: false }
  return { linked: true, lineId, view: views.get(lineId) ?? null }
}

/**
 * One bid's record: its inbox row's line when the bid has an inbox row that carries one, else its
 * token's line (a guest bid, or a magic-link row attached before it was linked). "skip" never reads.
 */
export async function resolveRecordForResponse(
  client: RfpRecordClient,
  site: string,
  mode: RecordReadMode,
  params: { responseId: string; inboxItemId: string | null; orgIds: readonly OrgId[] }
): Promise<RecordResolution> {
  if (mode !== "session") return { linked: false }
  const { responseId, inboxItemId, orgIds } = params
  let lineId: string | null = null
  if (inboxItemId) {
    lineId = (await readInboxLineIds(client, site, [inboxItemId], orgIds)).get(inboxItemId) ?? null
  }
  if (!lineId) {
    lineId = (await readTokenLinksByResponse(client, site, [responseId], orgIds)).get(responseId)?.lineId ?? null
  }
  if (!lineId) return { linked: false }
  const views = await readRecordLines(client, site, [lineId], orgIds)
  return resolutionFor(lineId, views)
}

/**
 * Steps 3 and 4 on rows that already exist: one link column set on one row by id, with the
 * missing-column fallback. Returns true when written (or when the column does not exist yet,
 * which is the fallback, not a failure), false on any other error.
 */
export async function setLinkColumn(
  client: RfpRecordClient,
  site: string,
  table: "partner_rfp_inbox" | "rfp_magic_tokens",
  match: { column: "id" | "token"; value: string },
  patch: Record<string, unknown>
): Promise<boolean> {
  const result = await withColumnFallback<unknown, Record<string, unknown>>(site, table, patch, (p) =>
    Object.keys(p).length === 0
      ? Promise.resolve({ data: null, error: null })
      : client.from(table).update(p).eq(match.column, match.value)
  )
  if (result.error) {
    console.error("[rfp-record] link column write failed", {
      site,
      table,
      columns: Object.keys(patch),
      code: result.error.code,
      message: result.error.message,
    })
    return false
  }
  return true
}
