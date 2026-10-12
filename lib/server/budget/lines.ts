import type { SupabaseClient } from "@supabase/supabase-js"
import { BUDGET_TABLES, LINE_COLUMNS, cols, type BudgetLine } from "./schema"
import { fail, fromDbError, ok, parseMoney, toNumber, type BudgetResult } from "./result"
import type { AgencyProject } from "./scope"

/**
 * BUDGET LINES (103). The line stores its ESTIMATE only (R5). Actual is derived in ./summary.ts.
 *
 * R1, DELETE vs ARCHIVE. A line deletes only while its estimate is 0 (the DELETE policy's USING
 * clause) and nothing references it (the NO ACTION foreign key from ledger_entries answers 23503).
 * A USING refusal is SILENT in Postgres: the DELETE affects 0 rows and raises nothing. deleteLine
 * therefore reads the line first and reports which rule refused, and the caller archives instead.
 */

function normalizeLine(line: Record<string, unknown>): BudgetLine {
  return { ...(line as unknown as BudgetLine), estimate: toNumber(line.estimate) }
}

function normalizeName(name: unknown): string | null {
  if (typeof name !== "string") return null
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= 300 ? trimmed : null
}

export async function listLines(
  client: SupabaseClient,
  project: AgencyProject,
  opts: { includeArchived?: boolean } = {}
): Promise<BudgetResult<BudgetLine[]>> {
  let query = client
    .from(BUDGET_TABLES.lines)
    .select(cols(LINE_COLUMNS))
    .eq("project_id", project.projectId)
    .order("created_at", { ascending: true })
  if (!opts.includeArchived) query = query.is("archived_at", null)
  const { data, error } = await query
  if (error) return fromDbError(error)
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map(normalizeLine))
}

export async function createLine(
  client: SupabaseClient,
  project: AgencyProject,
  input: { categoryId: unknown; name: unknown; estimate: unknown }
): Promise<BudgetResult<BudgetLine>> {
  const name = normalizeName(input.name)
  const estimate = parseMoney(input.estimate)
  const category_id = typeof input.categoryId === "string" ? input.categoryId : ""
  if (!name) return fail("invalid", "A line needs a name")
  if (estimate === null) return fail("invalid", "A line needs a numeric estimate")
  if (!category_id) return fail("invalid", "A line needs a category")
  const { data, error } = await client
    .from(BUDGET_TABLES.lines)
    .insert({ project_id: project.projectId, category_id, name, estimate })
    .select(cols(LINE_COLUMNS))
    .single()
  // A category from another project fails the composite foreign key: 23503, reported as in_use
  // by fromDbError. Re-labelled here because "in use" would mislead.
  if (error) return error.code === "23503" ? fail("invalid", "That category is not in this project", error.code) : fromDbError(error)
  return ok(normalizeLine(data as unknown as Record<string, unknown>))
}

export async function updateLine(
  client: SupabaseClient,
  project: AgencyProject,
  lineId: string,
  input: { categoryId?: unknown; name?: unknown; estimate?: unknown; archived?: unknown }
): Promise<BudgetResult<BudgetLine>> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = normalizeName(input.name)
    if (!name) return fail("invalid", "A line needs a name")
    patch.name = name
  }
  if (input.estimate !== undefined) {
    const estimate = parseMoney(input.estimate)
    if (estimate === null) return fail("invalid", "A line needs a numeric estimate")
    patch.estimate = estimate
  }
  if (input.categoryId !== undefined) {
    if (typeof input.categoryId !== "string" || !input.categoryId) return fail("invalid", "A line needs a category")
    patch.category_id = input.categoryId
  }
  if (input.archived !== undefined) {
    if (typeof input.archived !== "boolean") return fail("invalid", "archived must be true or false")
    patch.archived_at = input.archived ? new Date().toISOString() : null
  }
  if (Object.keys(patch).length === 0) return fail("invalid", "Nothing to change")

  const { data, error } = await client
    .from(BUDGET_TABLES.lines)
    .update(patch)
    .eq("project_id", project.projectId)
    .eq("id", lineId)
    .select(cols(LINE_COLUMNS))
    .maybeSingle()
  if (error) return error.code === "23503" ? fail("invalid", "That category is not in this project", error.code) : fromDbError(error)
  if (!data) return fail("not_found", "Line not found")
  return ok(normalizeLine(data as unknown as Record<string, unknown>))
}

export const archiveLine = (client: SupabaseClient, project: AgencyProject, lineId: string, archived = true) =>
  updateLine(client, project, lineId, { archived })

export type DeleteLineOutcome = { deleted: true }

/**
 * R1. Outcomes:
 *   ok                deleted
 *   not_found         no such line in this project for this caller
 *   refused           the estimate is not 0: archive it instead (code "R1_ESTIMATE")
 *   in_use            a ledger entry references it, voided or not: archive it instead
 */
export async function deleteLine(client: SupabaseClient, project: AgencyProject, lineId: string): Promise<BudgetResult<DeleteLineOutcome>> {
  const { data: existing, error: readErr } = await client
    .from(BUDGET_TABLES.lines)
    .select("id, estimate")
    .eq("project_id", project.projectId)
    .eq("id", lineId)
    .maybeSingle()
  if (readErr) return fromDbError(readErr)
  if (!existing) return fail("not_found", "Line not found")
  if (toNumber((existing as { estimate: unknown }).estimate) !== 0) {
    return fail("refused", "A line with an estimate cannot be deleted. Archive it, or set its estimate to 0 first.", "R1_ESTIMATE")
  }

  const { data, error } = await client
    .from(BUDGET_TABLES.lines)
    .delete()
    .eq("project_id", project.projectId)
    .eq("id", lineId)
    .select("id")
  if (error) {
    if (error.code === "23503") return fail("in_use", "This line has ledger entries against it. Archive it instead.", error.code)
    return fromDbError(error)
  }
  // 0 rows after a read that saw estimate 0: the estimate changed in between, or the policy refused.
  if (!data || data.length === 0) {
    return fail("refused", "The line was not deleted. Archive it instead.", "R1_ESTIMATE")
  }
  return ok({ deleted: true })
}
