import type { SupabaseClient } from "@supabase/supabase-js"
import { BUDGET_TABLES, LEDGER_ENTRY_COLUMNS, cols, type LedgerEntry } from "./schema"
import { fail, fromDbError, ok, parseMoney, toNumber, type BudgetResult } from "./result"
import type { AgencyProject } from "./scope"

/**
 * LEDGER ENTRIES (104). Agency only; no vendor helper exists or may be added.
 *
 * R2: an entry is NEVER deleted (no DELETE policy, no DELETE grant). A duplicate is VOIDED:
 * voided_at, void_reason, and optionally duplicate_of (an entry of the same project). A voided
 * entry stays readable and is excluded from Actual (./summary.ts).
 *
 * original_category_id is never sent: 104's trigger sets it from category_id on insert and
 * refuses any change afterwards.
 */

function normalizeEntry(row: Record<string, unknown>): LedgerEntry {
  const entry = row as unknown as LedgerEntry
  return {
    ...entry,
    amount: toNumber(row.amount),
    category_confidence: row.category_confidence === null || row.category_confidence === undefined ? null : toNumber(row.category_confidence),
  }
}

export async function listLedgerEntries(
  client: SupabaseClient,
  project: AgencyProject,
  opts: { includeVoided?: boolean } = {}
): Promise<BudgetResult<LedgerEntry[]>> {
  let query = client
    .from(BUDGET_TABLES.ledgerEntries)
    .select(cols(LEDGER_ENTRY_COLUMNS))
    .eq("project_id", project.projectId)
    .order("created_at", { ascending: true })
  if (!opts.includeVoided) query = query.is("voided_at", null)
  const { data, error } = await query
  if (error) return fromDbError(error)
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map(normalizeEntry))
}

const optionalText = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null

export async function createLedgerEntry(
  client: SupabaseClient,
  project: AgencyProject,
  input: {
    sourceDocumentId: unknown
    categoryId: unknown
    amount: unknown
    budgetLineId?: unknown
    payeeName?: unknown
    entryDate?: unknown
    categoryConfidence?: unknown
    categoryReasoning?: unknown
  }
): Promise<BudgetResult<LedgerEntry>> {
  const amount = parseMoney(input.amount)
  if (amount === null) return fail("invalid", "An entry needs a numeric amount (a credit is negative)")
  if (typeof input.sourceDocumentId !== "string" || !input.sourceDocumentId) return fail("invalid", "An entry needs its source document")
  if (typeof input.categoryId !== "string" || !input.categoryId) return fail("invalid", "An entry needs a category")
  const row: Record<string, unknown> = {
    project_id: project.projectId,
    source_document_id: input.sourceDocumentId,
    category_id: input.categoryId,
    amount,
  }
  if (input.budgetLineId !== undefined && input.budgetLineId !== null) {
    if (typeof input.budgetLineId !== "string" || !input.budgetLineId) return fail("invalid", "Invalid budget line")
    row.budget_line_id = input.budgetLineId
  }
  const payee = optionalText(input.payeeName, 300)
  if (payee) row.payee_name = payee
  if (typeof input.entryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) row.entry_date = input.entryDate
  if (input.categoryConfidence !== undefined && input.categoryConfidence !== null) {
    const c = Number(input.categoryConfidence)
    if (!Number.isFinite(c)) return fail("invalid", "Invalid category confidence")
    row.category_confidence = c
  }
  const reasoning = optionalText(input.categoryReasoning, 4000)
  if (reasoning) row.category_reasoning = reasoning

  const { data, error } = await client.from(BUDGET_TABLES.ledgerEntries).insert(row).select(cols(LEDGER_ENTRY_COLUMNS)).single()
  // The composite foreign keys answer 23503 when the document, category or line is not this
  // project's; that is a bad reference, not "in use".
  if (error) return error.code === "23503" ? fail("invalid", "The document, category or line is not in this project", error.code) : fromDbError(error)
  return ok(normalizeEntry(data as unknown as Record<string, unknown>))
}

/**
 * R2. Void an entry, optionally as a duplicate of another entry in the same project. The database
 * refuses a duplicate_of that is the entry itself (23514) or in another project (23503).
 */
export async function voidLedgerEntry(
  client: SupabaseClient,
  project: AgencyProject,
  entryId: string,
  input: { reason?: unknown; duplicateOf?: unknown }
): Promise<BudgetResult<LedgerEntry>> {
  const patch: Record<string, unknown> = {
    voided_at: new Date().toISOString(),
    void_reason: optionalText(input.reason, 1000),
  }
  if (input.duplicateOf !== undefined && input.duplicateOf !== null) {
    if (typeof input.duplicateOf !== "string" || !input.duplicateOf) return fail("invalid", "Invalid duplicate entry")
    if (input.duplicateOf === entryId) return fail("invalid", "An entry cannot be a duplicate of itself")
    patch.duplicate_of = input.duplicateOf
  }
  const { data, error } = await client
    .from(BUDGET_TABLES.ledgerEntries)
    .update(patch)
    .eq("project_id", project.projectId)
    .eq("id", entryId)
    .select(cols(LEDGER_ENTRY_COLUMNS))
    .maybeSingle()
  if (error) return error.code === "23503" ? fail("invalid", "The duplicated entry is not in this project", error.code) : fromDbError(error)
  if (!data) return fail("not_found", "Entry not found")
  return ok(normalizeEntry(data as unknown as Record<string, unknown>))
}
