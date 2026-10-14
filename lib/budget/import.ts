import { centsToDecimalString, formatCents, parseMoneyToCents } from "./money"
import { computeEstimateCents, milliToDecimalString, parseDecimal3ToMilli, parseRateToCents, parseUnitLabel } from "./line-math"
import type { FeeOrCost } from "@/lib/server/budget/schema"
import { categoryNameKey } from "./starter-templates"

/**
 * BUDGET IMPORT, BROWSER ONLY. The file is parsed in the browser by lib/spreadsheet-parse.ts,
 * reached through a dynamic import() so xlsx never enters a server bundle. xlsx 0.18.5 has known
 * vulnerabilities with hostile files, so this module and its callers must stay client-side; no file
 * under app/api or lib/server may import it, xlsx or lib/spreadsheet-parse.ts.
 */

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024
export const IMPORT_MAX_ROWS = 2000

export type ParsedImportFile = { headers: string[]; rows: string[][]; ignoredSheetNames: string[] }

export type ImportFileResult = { ok: true; file: ParsedImportFile } | { ok: false; message: string }

export async function readImportFile(file: File, firstRowIsHeaders: boolean): Promise<ImportFileResult> {
  const name = file.name.toLowerCase()
  if (!name.endsWith(".csv") && !name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    return { ok: false, message: "Choose a CSV or Excel (.xlsx) file." }
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return { ok: false, message: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB; split the budget into smaller files.` }
  }
  try {
    const { parseSpreadsheetFile } = await import("@/lib/spreadsheet-parse")
    const parsed = await parseSpreadsheetFile(file, firstRowIsHeaders)
    if (parsed.rows.length > IMPORT_MAX_ROWS) {
      return {
        ok: false,
        message: `This file has ${parsed.rows.length.toLocaleString("en-US")} rows. The limit is ${IMPORT_MAX_ROWS.toLocaleString("en-US")}; split it and import each part.`,
      }
    }
    if (parsed.rows.length === 0) return { ok: false, message: "No rows were found in this file." }
    return { ok: true, file: parsed }
  } catch {
    return { ok: false, message: "This file could not be read. Save it as CSV or .xlsx and try again." }
  }
}

/**
 * Which file column feeds which field. quantity, rate, multiplier and unit are optional (line math,
 * migration 116): a row with a rate imports as qty x rate x multiplier, and when rate is mapped the
 * amount column is optional. feeOrCost is the CATEGORY's flag (used when the row creates a new
 * category). kind is the LINE's own fee or cost (migration 117, R-K1): "fee" or "cost", any case,
 * sets an override; empty inherits the category; anything else excludes the row with the reason.
 */
export type ColumnMapping = {
  description: number | null
  category: number | null
  amount: number | null
  feeOrCost: number | null
  quantity: number | null
  rate: number | null
  multiplier: number | null
  unit: number | null
  kind: number | null
}

export const EMPTY_MAPPING: ColumnMapping = {
  description: null,
  category: null,
  amount: null,
  feeOrCost: null,
  quantity: null,
  rate: null,
  multiplier: null,
  unit: null,
  kind: null,
}

const HEADER_HINTS: Record<keyof ColumnMapping, RegExp> = {
  description: /^(description|line|item|line item|name|detail|details)$/i,
  category: /^(category|section|group|account|bucket|department)$/i,
  amount: /^(amount|estimate|budget|total|cost|price|value|subtotal)$/i,
  feeOrCost: /^(fee.?or.?cost|fee\/cost|type|category kind|category type)$/i,
  quantity: /^(qty|quantity|count|no\.? of units|number of units)$/i,
  rate: /^(rate|unit rate|unit price|unit cost|price per unit|day rate|hourly rate)$/i,
  multiplier: /^(x|multiplier|factor|mult)$/i,
  unit: /^(unit|units|uom|unit label|per)$/i,
  kind: /^(kind|line kind|line type)$/i,
}

export function guessMapping(headers: string[]): ColumnMapping {
  const find = (key: keyof ColumnMapping) => {
    const i = headers.findIndex((h) => HEADER_HINTS[key].test(h.trim()))
    return i >= 0 ? i : null
  }
  return {
    description: find("description"),
    category: find("category"),
    amount: find("amount"),
    feeOrCost: find("feeOrCost"),
    quantity: find("quantity"),
    rate: find("rate"),
    multiplier: find("multiplier"),
    unit: find("unit"),
    kind: find("kind"),
  }
}

/**
 * A line's Kind cell (117): exactly "fee" or "cost", case-insensitive, after trimming. Empty is
 * inherit (null). Anything else is refused with a reason, never guessed.
 */
export function parseLineKindCell(value: string): { ok: true; kind: FeeOrCost | null } | { ok: false; reason: string } {
  const v = value.trim().toLowerCase()
  if (!v) return { ok: true, kind: null }
  if (v === "fee" || v === "cost") return { ok: true, kind: v }
  return { ok: false, reason: `Kind "${value.trim().slice(0, 40)}" is not fee or cost` }
}

/** Both are needed: a description, and either an amount or a rate to compute one from. */
export const mappingReady = (m: ColumnMapping) => m.description !== null && (m.amount !== null || m.rate !== null)

export function parseFeeOrCost(value: string): FeeOrCost | null {
  const v = value.trim().toLowerCase()
  if (!v) return null
  if (v === "fee" || v === "fees" || v === "f" || v === "agency fee" || v === "markup" || v === "mark-up") return "fee"
  if (v === "cost" || v === "costs" || v === "c" || v === "pass-through" || v === "pass through" || v === "hard cost") return "cost"
  return null
}

/**
 * A review row. `target` is what Confirm will do with the category:
 *   { kind: "existing", categoryId }  file the line under a category already on the project
 *   { kind: "new", name }             create the category first (once per name), then the line
 *   null                              not chosen yet; the row cannot be imported
 */
export type CategoryTarget = { kind: "existing"; categoryId: string } | { kind: "new"; name: string } | null

/** A row's line math, validated: thousandths, cents, text. Present only when the row has a rate. */
export type RowMath = { quantityMilli: number | null; rateCents: number; multiplierMilli: number | null; unitLabel: string | null }

export type ReviewRow = {
  index: number
  description: string
  /** The line's total: the computed product when the row has a rate, else the amount column. */
  amountCents: number | null
  amountError: string | null
  /** Set when the file's amount differs from the computed total that replaces it. */
  amountNote: string | null
  math: RowMath | null
  sourceCategory: string
  target: CategoryTarget
  feeOrCost: FeeOrCost | null
  /** 117: the line's own kind from the Kind column; null = inherit the category. */
  kind: FeeOrCost | null
  /** Set when the Kind cell is not fee, cost or empty. The row is excluded. */
  kindError: string | null
  include: boolean
}

type Cell<T> = { ok: true; value: T } | { ok: false; reason: string }

const emptyOr = <T>(text: string, parse: (t: string) => Cell<T>): Cell<T | null> => (text ? parse(text) : { ok: true, value: null })

/** The row's math from its quantity, rate, multiplier and unit cells, or why it is refused. */
function readRowMath(qty: string, rate: string, mult: string, unit: string): Cell<RowMath & { totalCents: number }> {
  const r = parseRateToCents(rate)
  if (!r.ok) return r
  const q = emptyOr(qty, (t) => {
    const p = parseDecimal3ToMilli(t, "Quantity")
    return p.ok ? { ok: true, value: p.milli } : p
  })
  if (!q.ok) return q
  const m = emptyOr(mult, (t) => {
    const p = parseDecimal3ToMilli(t, "Multiplier")
    return p.ok ? { ok: true, value: p.milli } : p
  })
  if (!m.ok) return m
  const u = emptyOr(unit, (t) => {
    const p = parseUnitLabel(t)
    return p.ok ? { ok: true, value: p.label } : p
  })
  if (!u.ok) return u
  const total = computeEstimateCents(q.value, r.cents, m.value)
  if (!total.ok) return total
  return { ok: true, value: { quantityMilli: q.value, rateCents: r.cents, multiplierMilli: m.value, unitLabel: u.value, totalCents: total.cents } }
}

export function buildReviewRows(
  rows: string[][],
  mapping: ColumnMapping,
  existing: { id: string; name: string; fee_or_cost: FeeOrCost }[]
): ReviewRow[] {
  const byName = new Map(existing.map((c) => [categoryNameKey(c.name), c]))
  return rows.map((row, index) => {
    const cell = (i: number | null) => (i === null ? "" : (row[i] ?? "").trim())
    const description = cell(mapping.description).slice(0, 300)
    const amountText = cell(mapping.amount)
    const money = mapping.amount === null ? null : parseMoneyToCents(amountText)
    const sourceCategory = cell(mapping.category).slice(0, 200)
    const match = sourceCategory ? byName.get(categoryNameKey(sourceCategory)) : undefined
    const target: CategoryTarget = match ? { kind: "existing", categoryId: match.id } : sourceCategory ? { kind: "new", name: sourceCategory } : null
    const fromColumn = mapping.feeOrCost === null ? null : parseFeeOrCost(cell(mapping.feeOrCost))

    let amountCents: number | null = null
    let amountError: string | null = null
    let amountNote: string | null = null
    let math: RowMath | null = null
    const rateText = cell(mapping.rate)
    if (rateText) {
      // A rate makes this a computed line. Quantity, multiplier and unit apply only with a rate.
      const m = readRowMath(cell(mapping.quantity), rateText, cell(mapping.multiplier), cell(mapping.unit))
      if (m.ok) {
        const { totalCents, ...rest } = m.value
        math = rest
        amountCents = totalCents
        if (money && money.ok && amountText && money.cents !== totalCents) {
          amountNote = `File amount ${formatCents(money.cents)} replaced by Qty x Rate x multiplier`
        }
      } else amountError = m.reason
    } else if (money === null) {
      amountError = mapping.rate === null ? "No amount column chosen" : "No rate or amount"
    } else if (money.ok) amountCents = money.cents
    else amountError = mapping.rate !== null && !amountText ? "No rate or amount" : money.reason

    const kindCell = mapping.kind === null ? ({ ok: true, kind: null } as const) : parseLineKindCell(cell(mapping.kind))

    return {
      index,
      description,
      amountCents,
      amountError,
      amountNote,
      math,
      sourceCategory,
      target,
      feeOrCost: match ? match.fee_or_cost : fromColumn,
      kind: kindCell.ok ? kindCell.kind : null,
      kindError: kindCell.ok ? null : kindCell.reason,
      include: Boolean(description) && amountError === null && kindCell.ok,
    }
  })
}

/** The API body fields for a reviewed row's amount: its math when it has a rate, else the estimate. */
export function rowAmountBody(row: ReviewRow): Record<string, unknown> {
  if (!row.math) return { estimate: centsToDecimalString(row.amountCents ?? 0) }
  const body: Record<string, unknown> = { unitRate: centsToDecimalString(row.math.rateCents) }
  if (row.math.quantityMilli !== null) body.quantity = milliToDecimalString(row.math.quantityMilli)
  if (row.math.multiplierMilli !== null) body.multiplier = milliToDecimalString(row.math.multiplierMilli)
  if (row.math.unitLabel !== null) body.unitLabel = row.math.unitLabel
  return body
}

/** Why a row cannot be imported as it stands, or null when it can. */
export function rowProblem(row: ReviewRow): string | null {
  if (!row.description) return "No description"
  if (row.amountError) return row.amountError
  if (row.kindError) return row.kindError
  if (row.amountCents === null) return "No amount"
  if (!row.target) return "Choose a category"
  if (row.target.kind === "new" && !row.target.name.trim()) return "Name the new category"
  if (row.target.kind === "new" && !row.feeOrCost) return "Mark the new category fee or cost"
  return null
}
