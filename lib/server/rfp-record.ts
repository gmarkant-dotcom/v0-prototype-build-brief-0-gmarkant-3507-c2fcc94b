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
