import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { BUDGET_TABLES, LINE_COLUMNS, LINE_MATH_COLUMNS, cols, type BudgetLine } from "./schema"
import { fail, fromDbError, ok, parseMoney, toNumber, type BudgetFail, type BudgetResult, type DbError } from "./result"
import type { AgencyProject } from "./scope"
import {
  TOTAL_TOO_LARGE,
  computeEstimateCents,
  milliToDecimalString,
  parseDecimal3ToMilli,
  parseRateToCents,
  parseUnitLabel,
} from "@/lib/budget/line-math"
import { centsToDecimalString } from "@/lib/budget/money"

/**
 * BUDGET LINES (103). The line stores its ESTIMATE (R5). Actual is derived in ./summary.ts.
 *
 * LINE MATH (116). A line may carry quantity, unit_rate, multiplier and unit_label. When unit_rate
 * is set the database trigger computes estimate = round(qty x rate x multiplier, 2) and overwrites
 * whatever was sent; this file computes the same number first (lib/budget/line-math.ts, integer
 * arithmetic) so the request carries the right estimate either way. BEFORE 116 IS APPLIED the four
 * columns do not exist: every read and write here retries without them on 42703 / PGRST204 and
 * behaves exactly as it did before, except that a rate still sets the estimate (computed here,
 * stored as a typed value). Note that fromDbError() would read those errors as "spine not enabled"
 * (the message names budget_lines), so they are caught before it.
 *
 * R1, DELETE vs ARCHIVE. A line deletes only while its estimate is 0 (the DELETE policy's USING
 * clause) and nothing references it (the NO ACTION foreign key from ledger_entries answers 23503).
 * A USING refusal is SILENT in Postgres: the DELETE affects 0 rows and raises nothing. deleteLine
 * therefore reads the line first and reports which rule refused, and the caller archives instead.
 */

const LINE_COLUMNS_WITH_MATH = [...LINE_COLUMNS, ...LINE_MATH_COLUMNS] as const

const nullableNumber = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : toNumber(value))

function normalizeLine(line: Record<string, unknown>): BudgetLine {
  return {
    ...(line as unknown as BudgetLine),
    estimate: toNumber(line.estimate),
    quantity: nullableNumber(line.quantity),
    unit_rate: nullableNumber(line.unit_rate),
    multiplier: nullableNumber(line.multiplier),
    unit_label: typeof line.unit_label === "string" ? line.unit_label : null,
  }
}

function normalizeName(name: unknown): string | null {
  if (typeof name !== "string") return null
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= 300 ? trimmed : null
}

/** 42703 (undefined column) or PGRST204 (column not in the schema cache) naming a 116 column. */
export function isLineMathMissing(err: DbError): boolean {
  if (!err) return false
  if (err.code !== "42703" && err.code !== "PGRST204") return false
  const text = `${err.message ?? ""} ${err.details ?? ""}`
  return text.trim() === "" || LINE_MATH_COLUMNS.some((c) => text.includes(c))
}

/** The database's refusals, in words a person can act on. */
function lineDbFail(err: NonNullable<DbError>): BudgetFail {
  const message = err.message ?? ""
  // A category from another project fails the composite foreign key: 23503, which fromDbError
  // reports as in_use. Re-labelled here because "in use" would mislead.
  if (err.code === "23503") return fail("invalid", "That category is not in this project", err.code)
  if (err.code === "22003") return fail("invalid", TOTAL_TOO_LARGE, err.code)
  if (err.code === "23514") {
    if (message.includes("budget_lines_quantity_positive")) return fail("invalid", "Quantity must be greater than 0", err.code)
    if (message.includes("budget_lines_multiplier_positive")) return fail("invalid", "Multiplier must be greater than 0", err.code)
    if (message.includes("budget_lines_unit_label_shape")) return fail("invalid", "Unit is 1 to 24 characters", err.code)
  }
  return fromDbError(err)
}

// ---- Validation (zod over the shared rules in lib/budget/line-math.ts) ----

const decimal3 = (label: string) =>
  z.union([z.number(), z.string(), z.null()]).transform((value, ctx) => {
    if (value === null) return null
    const r = parseDecimal3ToMilli(value, label)
    if (!r.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.reason })
      return z.NEVER
    }
    return r.milli
  })

const rate = z.union([z.number(), z.string(), z.null()]).transform((value, ctx) => {
  if (value === null) return null
  const r = parseRateToCents(value)
  if (!r.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.reason })
    return z.NEVER
  }
  return r.cents
})

const unitLabel = z.union([z.string(), z.null()]).transform((value, ctx) => {
  if (value === null) return null
  const r = parseUnitLabel(value)
  if (!r.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.reason })
    return z.NEVER
  }
  return r.label
})

/** undefined = not sent (unchanged); null = clear; a value = set. Thousandths, cents, text. */
const LineMathInput = z.object({
  quantity: decimal3("Quantity").optional(),
  unitRate: rate.optional(),
  multiplier: decimal3("Multiplier").optional(),
  unitLabel: unitLabel.optional(),
})

type LineMath = z.infer<typeof LineMathInput>

const FIELD_LABEL: Record<string, string> = { quantity: "Quantity", unitRate: "Rate", multiplier: "Multiplier", unitLabel: "Unit" }

function parseLineMath(input: { quantity?: unknown; unitRate?: unknown; multiplier?: unknown; unitLabel?: unknown }): BudgetResult<LineMath> {
  const parsed = LineMathInput.safeParse({
    quantity: input.quantity,
    unitRate: input.unitRate,
    multiplier: input.multiplier,
    unitLabel: input.unitLabel,
  })
  if (parsed.success) return ok(parsed.data)
  const issue = parsed.error.issues[0]
  const field = FIELD_LABEL[String(issue?.path[0] ?? "")] ?? "Line"
  // A custom issue already names its field; a type mismatch does not.
  const message = issue?.code === z.ZodIssueCode.custom ? issue.message : `${field} must be a number or empty`
  return fail("invalid", message)
}

/** The 116 columns for the payload: only the keys that were sent, as exact decimal strings. */
function mathPayload(m: LineMath): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (m.quantity !== undefined) out.quantity = m.quantity === null ? null : milliToDecimalString(m.quantity)
  if (m.unitRate !== undefined) out.unit_rate = m.unitRate === null ? null : centsToDecimalString(m.unitRate)
  if (m.multiplier !== undefined) out.multiplier = m.multiplier === null ? null : milliToDecimalString(m.multiplier)
  if (m.unitLabel !== undefined) out.unit_label = m.unitLabel
  return out
}

/** The estimate a rate implies, from the sent quantity and multiplier (absent counts as 1). */
function impliedEstimate(m: LineMath): BudgetResult<string | null> {
  if (m.unitRate === undefined || m.unitRate === null) return ok(null)
  const c = computeEstimateCents(m.quantity ?? null, m.unitRate, m.multiplier ?? null)
  return c.ok ? ok(centsToDecimalString(c.cents)) : fail("invalid", c.reason, "22003")
}

type Row = Record<string, unknown>

export type LineList = { lines: BudgetLine[]; lineMath: boolean }

export async function listLines(
  client: SupabaseClient,
  project: AgencyProject,
  opts: { includeArchived?: boolean } = {}
): Promise<BudgetResult<LineList>> {
  const read = async (withMath: boolean) => {
    let query = client
      .from(BUDGET_TABLES.lines)
      .select(cols(withMath ? LINE_COLUMNS_WITH_MATH : LINE_COLUMNS))
      .eq("project_id", project.projectId)
      .order("created_at", { ascending: true })
    if (!opts.includeArchived) query = query.is("archived_at", null)
    const { data, error } = await query
    return { data: (data ?? []) as unknown as Row[], error }
  }
  let lineMath = true
  let res = await read(true)
  if (res.error && isLineMathMissing(res.error)) {
    lineMath = false
    res = await read(false)
  }
  if (res.error) return fromDbError(res.error)
  return ok({ lines: res.data.map(normalizeLine), lineMath })
}

export type LineInput = {
  categoryId?: unknown
  name?: unknown
  estimate?: unknown
  quantity?: unknown
  unitRate?: unknown
  multiplier?: unknown
  unitLabel?: unknown
}

async function writeLine(
  write: (payload: Row, select: string) => PromiseLike<{ data: unknown; error: DbError }>,
  base: Row,
  m: LineMath,
  fallback: () => BudgetResult<Row>
): Promise<{ data: Row | null; error: DbError } | BudgetFail> {
  const math = mathPayload(m)
  const first = await write({ ...base, ...math }, cols(LINE_COLUMNS_WITH_MATH))
  if (!first.error || !isLineMathMissing(first.error)) return { data: first.data as Row | null, error: first.error }
  const without = fallback()
  if (!without.ok) return without
  const second = await write(without.data, cols(LINE_COLUMNS))
  return { data: second.data as Row | null, error: second.error }
}

export async function createLine(client: SupabaseClient, project: AgencyProject, input: LineInput): Promise<BudgetResult<BudgetLine>> {
  const name = normalizeName(input.name)
  const category_id = typeof input.categoryId === "string" ? input.categoryId : ""
  if (!name) return fail("invalid", "A line needs a name")
  if (!category_id) return fail("invalid", "A line needs a category")
  const math = parseLineMath(input)
  if (!math.ok) return math

  // With a rate, the estimate is the product (the trigger would overwrite anything else). Without
  // one, it is the typed estimate, exactly as before 116.
  const implied = impliedEstimate(math.data)
  if (!implied.ok) return implied
  let estimate: string | number
  if (implied.data !== null) estimate = implied.data
  else {
    const typed = parseMoney(input.estimate)
    if (typed === null) return fail("invalid", "A line needs a numeric estimate, or a rate")
    estimate = typed
  }

  const base: Row = { project_id: project.projectId, category_id, name, estimate }
  const res = await writeLine(
    (payload, select) => client.from(BUDGET_TABLES.lines).insert(payload).select(select).single(),
    base,
    math.data,
    () => ok(base)
  )
  if ("ok" in res) return res
  if (res.error) return lineDbFail(res.error)
  return ok(normalizeLine(res.data ?? {}))
}

export async function updateLine(
  client: SupabaseClient,
  project: AgencyProject,
  lineId: string,
  input: LineInput & { archived?: unknown }
): Promise<BudgetResult<BudgetLine>> {
  const patch: Row = {}
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
  const math = parseLineMath(input)
  if (!math.ok) return math
  if (Object.keys(patch).length === 0 && Object.keys(mathPayload(math.data)).length === 0) return fail("invalid", "Nothing to change")

  const res = await writeLine(
    (payload, select) =>
      client.from(BUDGET_TABLES.lines).update(payload).eq("project_id", project.projectId).eq("id", lineId).select(select).maybeSingle(),
    patch,
    math.data,
    () => {
      // Before 116 there is nowhere to keep the math. A rate still sets the estimate: with no stored
      // quantity or multiplier to combine with, the sent ones (or 1) are the whole product.
      const implied = impliedEstimate(math.data)
      if (!implied.ok) return implied
      const without: Row = implied.data === null ? { ...patch } : { ...patch, estimate: implied.data }
      if (Object.keys(without).length === 0) {
        return fail("invalid", "Quantity, rate and multiplier are not enabled yet. Type the estimate instead.", "LINE_MATH_DISABLED")
      }
      return ok(without)
    }
  )
  if ("ok" in res) return res
  if (res.error) return lineDbFail(res.error)
  if (!res.data) return fail("not_found", "Line not found")
  return ok(normalizeLine(res.data))
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
