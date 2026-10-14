import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { BUDGET_TABLES, LINE_COLUMNS, LINE_KIND_COLUMNS, LINE_MATH_COLUMNS, cols, isFeeOrCost, type BudgetLine, type FeeOrCost } from "./schema"
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
 * LINE KIND (117, R-K1). A line may carry fee_or_cost, overriding its category's; NULL inherits.
 * Sent as `kind`: "fee" | "cost" | null (null resets to inherit), undefined leaves it alone. BEFORE
 * 117 IS APPLIED the column does not exist and is dropped the same way as the math columns: every
 * line reads as inherited (fee_or_cost null), `lineKind` is false so the UI hides the toggle, a
 * create that sent a kind is stored without it, and an update that changes only the kind is refused
 * with LINE_KIND_DISABLED. The two optional sets (116's math, 117's kind) are dropped independently.
 *
 * R1, DELETE vs ARCHIVE. A line deletes only while its estimate is 0 (the DELETE policy's USING
 * clause) and nothing references it (the NO ACTION foreign key from ledger_entries answers 23503).
 * A USING refusal is SILENT in Postgres: the DELETE affects 0 rows and raises nothing. deleteLine
 * therefore reads the line first and reports which rule refused, and the caller archives instead.
 */

/** Which optional column sets the database has: 116's math and 117's kind. */
export type LineColumnSets = { math: boolean; kind: boolean }

const ALL_SETS: LineColumnSets = { math: true, kind: true }

function lineColumns(sets: LineColumnSets): string {
  return cols([...LINE_COLUMNS, ...(sets.math ? LINE_MATH_COLUMNS : []), ...(sets.kind ? LINE_KIND_COLUMNS : [])])
}

const nullableNumber = (value: unknown): number | null => (value === null || value === undefined || value === "" ? null : toNumber(value))

function normalizeLine(line: Record<string, unknown>): BudgetLine {
  return {
    ...(line as unknown as BudgetLine),
    estimate: toNumber(line.estimate),
    quantity: nullableNumber(line.quantity),
    unit_rate: nullableNumber(line.unit_rate),
    multiplier: nullableNumber(line.multiplier),
    unit_label: typeof line.unit_label === "string" ? line.unit_label : null,
    fee_or_cost: isFeeOrCost(line.fee_or_cost) ? line.fee_or_cost : null,
  }
}

function normalizeName(name: unknown): string | null {
  if (typeof name !== "string") return null
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= 300 ? trimmed : null
}

/**
 * 42703 (undefined column) or PGRST204 (column not in the schema cache) naming a 116 or 117 column:
 * which optional set is missing. An error with no text names nothing, so both sets are dropped.
 * null when the error is not a missing optional column.
 */
export function missingLineColumns(err: DbError): LineColumnSets | null {
  if (!err) return null
  if (err.code !== "42703" && err.code !== "PGRST204") return null
  const text = `${err.message ?? ""} ${err.details ?? ""}`
  if (text.trim() === "") return { math: true, kind: true }
  const math = LINE_MATH_COLUMNS.some((c) => text.includes(c))
  const kind = LINE_KIND_COLUMNS.some((c) => text.includes(c))
  return math || kind ? { math, kind } : null
}

const isFail = (x: unknown): x is BudgetFail => typeof x === "object" && x !== null && "ok" in x && (x as BudgetFail).ok === false

/**
 * Runs `attempt` with every optional set, then again without whichever set the database reports
 * missing. At most three attempts (each retry drops at least one set). `attempt` may refuse with a
 * BudgetFail when the request cannot be expressed without a dropped set.
 */
async function withLineColumns<T extends { error: DbError }>(
  attempt: (sets: LineColumnSets) => PromiseLike<T> | BudgetFail
): Promise<{ res: T; sets: LineColumnSets } | BudgetFail> {
  let sets = ALL_SETS
  for (;;) {
    const res = await attempt(sets)
    if (isFail(res)) return res
    const missing = missingLineColumns(res.error)
    const next = missing ? { math: sets.math && !missing.math, kind: sets.kind && !missing.kind } : sets
    if (next.math === sets.math && next.kind === sets.kind) return { res, sets }
    sets = next
  }
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
    if (message.includes("budget_lines_fee_or_cost_check")) return fail("invalid", KIND_MESSAGE, err.code)
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

// ---- Line kind (117, R-K1) ----

const KIND_MESSAGE = "Kind must be fee, cost, or empty to follow the category"

/** undefined = not sent (unchanged); null = reset to inherit the category; "fee" | "cost" = override. */
const LineKindInput = z.union([z.literal("fee"), z.literal("cost"), z.null()]).optional()

function parseLineKind(value: unknown): BudgetResult<FeeOrCost | null | undefined> {
  const parsed = LineKindInput.safeParse(value)
  return parsed.success ? ok(parsed.data) : fail("invalid", KIND_MESSAGE)
}

/** The 117 column for the payload: only when sent. */
const kindPayload = (kind: FeeOrCost | null | undefined): Row => (kind === undefined ? {} : { fee_or_cost: kind })

type Row = Record<string, unknown>

/** `lineMath`: 116's columns exist. `lineKind`: 117's column exists (false = every line inherits). */
export type LineList = { lines: BudgetLine[]; lineMath: boolean; lineKind: boolean }

export async function listLines(
  client: SupabaseClient,
  project: AgencyProject,
  opts: { includeArchived?: boolean } = {}
): Promise<BudgetResult<LineList>> {
  const out = await withLineColumns((sets) => {
    let query = client
      .from(BUDGET_TABLES.lines)
      .select(lineColumns(sets))
      .eq("project_id", project.projectId)
      .order("created_at", { ascending: true })
    if (!opts.includeArchived) query = query.is("archived_at", null)
    return query
  })
  if (isFail(out)) return out
  if (out.res.error) return fromDbError(out.res.error)
  const rows = (out.res.data ?? []) as unknown as Row[]
  return ok({ lines: rows.map(normalizeLine), lineMath: out.sets.math, lineKind: out.sets.kind })
}

export type LineInput = {
  categoryId?: unknown
  name?: unknown
  estimate?: unknown
  quantity?: unknown
  unitRate?: unknown
  multiplier?: unknown
  unitLabel?: unknown
  /** 117: "fee" | "cost" overrides the category; null resets to inherit; absent leaves it. */
  kind?: unknown
}

/**
 * One write through withLineColumns: `build` makes the payload for the column sets that exist (or
 * refuses), `write` sends it and selects back the same sets.
 */
async function writeLine(
  write: (payload: Row, select: string) => PromiseLike<{ data: unknown; error: DbError }>,
  build: (sets: LineColumnSets) => BudgetResult<Row>
): Promise<{ data: Row | null; error: DbError } | BudgetFail> {
  const out = await withLineColumns((sets) => {
    const payload = build(sets)
    return payload.ok ? write(payload.data, lineColumns(sets)) : payload
  })
  if (isFail(out)) return out
  return { data: out.res.data as Row | null, error: out.res.error }
}

export async function createLine(client: SupabaseClient, project: AgencyProject, input: LineInput): Promise<BudgetResult<BudgetLine>> {
  const name = normalizeName(input.name)
  const category_id = typeof input.categoryId === "string" ? input.categoryId : ""
  if (!name) return fail("invalid", "A line needs a name")
  if (!category_id) return fail("invalid", "A line needs a category")
  const math = parseLineMath(input)
  if (!math.ok) return math
  const kind = parseLineKind(input.kind)
  if (!kind.ok) return kind

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

  // Before 116 the math is not kept and before 117 the kind is not: the line is stored with the
  // computed estimate and inherits its category's kind.
  const base: Row = { project_id: project.projectId, category_id, name, estimate }
  const res = await writeLine(
    (payload, select) => client.from(BUDGET_TABLES.lines).insert(payload).select(select).single(),
    (sets) => ok({ ...base, ...(sets.math ? mathPayload(math.data) : {}), ...(sets.kind ? kindPayload(kind.data) : {}) })
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
  const kind = parseLineKind(input.kind)
  if (!kind.ok) return kind
  const mathSent = Object.keys(mathPayload(math.data)).length > 0
  if (Object.keys(patch).length === 0 && !mathSent && kind.data === undefined) return fail("invalid", "Nothing to change")

  const res = await writeLine(
    (payload, select) =>
      client.from(BUDGET_TABLES.lines).update(payload).eq("project_id", project.projectId).eq("id", lineId).select(select).maybeSingle(),
    (sets) => {
      let payload: Row = { ...patch }
      if (sets.math) payload = { ...payload, ...mathPayload(math.data) }
      else {
        // Before 116 there is nowhere to keep the math. A rate still sets the estimate: with no stored
        // quantity or multiplier to combine with, the sent ones (or 1) are the whole product.
        const implied = impliedEstimate(math.data)
        if (!implied.ok) return implied
        if (implied.data !== null) payload.estimate = implied.data
      }
      if (sets.kind) payload = { ...payload, ...kindPayload(kind.data) }
      if (Object.keys(payload).length === 0) {
        if (kind.data !== undefined && !sets.kind) {
          return fail("invalid", "Fee or cost per line is not enabled yet. The line follows its category.", "LINE_KIND_DISABLED")
        }
        return fail("invalid", "Quantity, rate and multiplier are not enabled yet. Type the estimate instead.", "LINE_MATH_DISABLED")
      }
      return ok(payload)
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
