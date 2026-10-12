import { parseMoneyToCents } from "./money"
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

export type ColumnMapping = {
  description: number | null
  category: number | null
  amount: number | null
  feeOrCost: number | null
}

const HEADER_HINTS: Record<keyof ColumnMapping, RegExp> = {
  description: /^(description|line|item|line item|name|detail|details)$/i,
  category: /^(category|section|group|account|bucket|department)$/i,
  amount: /^(amount|estimate|budget|total|cost|price|value|subtotal)$/i,
  feeOrCost: /^(fee.?or.?cost|fee\/cost|type|kind)$/i,
}

export function guessMapping(headers: string[]): ColumnMapping {
  const find = (key: keyof ColumnMapping) => {
    const i = headers.findIndex((h) => HEADER_HINTS[key].test(h.trim()))
    return i >= 0 ? i : null
  }
  return { description: find("description"), category: find("category"), amount: find("amount"), feeOrCost: find("feeOrCost") }
}

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

export type ReviewRow = {
  index: number
  description: string
  amountCents: number | null
  amountError: string | null
  sourceCategory: string
  target: CategoryTarget
  feeOrCost: FeeOrCost | null
  include: boolean
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
    const money = mapping.amount === null ? null : parseMoneyToCents(cell(mapping.amount))
    const sourceCategory = cell(mapping.category).slice(0, 200)
    const match = sourceCategory ? byName.get(categoryNameKey(sourceCategory)) : undefined
    const target: CategoryTarget = match ? { kind: "existing", categoryId: match.id } : sourceCategory ? { kind: "new", name: sourceCategory } : null
    const fromColumn = mapping.feeOrCost === null ? null : parseFeeOrCost(cell(mapping.feeOrCost))
    const amountError = money === null ? "No amount column chosen" : money.ok ? null : money.reason
    return {
      index,
      description,
      amountCents: money && money.ok ? money.cents : null,
      amountError,
      sourceCategory,
      target,
      feeOrCost: match ? match.fee_or_cost : fromColumn,
      include: Boolean(description) && amountError === null,
    }
  })
}

/** Why a row cannot be imported as it stands, or null when it can. */
export function rowProblem(row: ReviewRow): string | null {
  if (!row.description) return "No description"
  if (row.amountError) return row.amountError
  if (row.amountCents === null) return "No amount"
  if (!row.target) return "Choose a category"
  if (row.target.kind === "new" && !row.target.name.trim()) return "Name the new category"
  if (row.target.kind === "new" && !row.feeOrCost) return "Mark the new category fee or cost"
  return null
}
