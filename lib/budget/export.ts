import { budgetFetch, BudgetApiError, projectBase } from "./client-api"
import { downloadCsv, fileSlug, toCsv } from "./csv-export"
import { centsToDecimalString, percentCell, toCentsFromApi } from "./money"
import { milliToPlain, rateCentsFromApi, toMilliFromApi } from "./line-math"
import { buildSummaryView, type PercentOfTotal } from "./summary-view"
import type { CategoryMerge, LedgerEntry, ProjectCategory, BudgetLine, SourceDocument } from "@/lib/server/budget/schema"
import type { EstimateVsActual } from "@/lib/server/budget/summary"

/**
 * FINANCE EXPORTS. Read fresh from the gated API at the moment of export, built from the same
 * summary view as the Summary tab (one source per number), written as CSV with every cell quoted
 * and formula-neutralised (lib/budget/csv-export.ts). Amounts are plain decimals from integer cents.
 * Fee and cost totals, margin and every % of total are the summary view's, split by each line's
 * effective kind (117, R-K1).
 */

async function readLedger(projectId: string): Promise<LedgerEntry[] | null> {
  try {
    const res = await budgetFetch<{ entries: LedgerEntry[] }>(`${projectBase(projectId)}/ledger?include_voided=1`)
    return res.entries
  } catch (e) {
    if (e instanceof BudgetApiError && e.kind === "not_enabled") return null
    throw e
  }
}

export async function exportBudgetCsv(projectId: string, projectName: string): Promise<number> {
  const base = projectBase(projectId)
  const [chart, summary, entries, lineList] = await Promise.all([
    budgetFetch<{ categories: ProjectCategory[]; merges: CategoryMerge[] }>(`${base}/chart?include_archived=1`),
    budgetFetch<{ summary: EstimateVsActual }>(`${base}/summary`),
    readLedger(projectId),
    // Quantity, rate, multiplier and unit (116) live on the line rows, not in the summary.
    budgetFetch<{ lines: BudgetLine[] }>(`${base}/lines?include_archived=1`),
  ])
  const retired = new Set(chart.merges.map((m) => m.from_category_id))
  const view = buildSummaryView(chart.categories, retired, summary.summary, entries ?? [])
  const hasActual = view.ledgerEnabled && entries !== null
  const money = (cents: number) => centsToDecimalString(cents)
  const actual = (cents: number) => (hasActual ? money(cents) : "")
  const lineById = new Map(lineList.lines.map((l) => [l.id, l]))
  /** Qty, Rate, Multiplier, Unit for a line; empty cells for a line without math. */
  const math = (lineId: string | null): string[] => {
    const l = lineId ? lineById.get(lineId) : undefined
    if (!l) return ["", "", "", ""]
    const q = toMilliFromApi(l.quantity)
    const r = rateCentsFromApi(l.unit_rate)
    const m = toMilliFromApi(l.multiplier)
    return [q === null ? "" : milliToPlain(q), r === null ? "" : money(r), m === null ? "" : milliToPlain(m), l.unit_label ?? ""]
  }

  /** Estimate % of total, Actual % of total: one decimal, "-" when the project total is 0. */
  const pct = (p: PercentOfTotal): string[] => [percentCell(p.estimate), hasActual ? percentCell(p.actual) : ""]
  const noPct = ["", ""]
  /** Kind (effective) and Kind source, for a row that is not a line. */
  const noKind = ["", ""]

  // "Fee or cost" is the category's flag (or "mixed" on a category total); "Kind" is the line's
  // effective kind and "Kind source" says whether it is inherited from the category or set on the line.
  const rows: unknown[][] = []
  for (const c of view.categories) {
    for (const l of c.lines) {
      rows.push([c.name, l.name, c.feeOrCost, l.kind, l.kindSource, ...math(l.lineId), money(l.estimateCents), actual(l.actualCents), ...noPct])
    }
    for (const kind of ["fee", "cost"] as const) {
      const off = c.offLine[kind]
      if (off.count > 0) rows.push([c.name, "(not on a line)", c.feeOrCost, kind, "", ...math(null), money(0), actual(off.actualCents), ...noPct])
    }
    if (c.lines.length === 0 && c.offLineCount === 0) rows.push([c.name, "", c.feeOrCost, ...noKind, ...math(null), money(0), actual(0), ...noPct])
  }
  rows.push([])
  rows.push(["Fee total", "", "fee", ...noKind, ...math(null), money(view.fee.estimateCents), actual(view.fee.actualCents), ...pct(view.percentOfTotal.fee)])
  rows.push(["Cost total", "", "cost", ...noKind, ...math(null), money(view.cost.estimateCents), actual(view.cost.actualCents), ...pct(view.percentOfTotal.cost)])
  rows.push(["Project total", "", "", ...noKind, ...math(null), money(view.totals.estimateCents), actual(view.totals.actualCents), ...pct(view.percentOfTotal.total)])
  rows.push(["Margin (fee total)", "", "", ...noKind, ...math(null), money(view.margin.estimate.amountCents), actual(view.margin.actual.amountCents), ...noPct])
  // Both readings of margin, from the same computeMargin() the Summary tab shows. "-" when the
  // denominator is 0 (the CSV neutraliser prefixes it with a quote, like every cell starting "-").
  rows.push([
    "Margin (share of total) %, fee / (fee + cost)",
    "",
    "",
    ...noKind,
    ...math(null),
    percentCell(view.margin.estimate.shareOfTotalPercent),
    hasActual ? percentCell(view.margin.actual.shareOfTotalPercent) : "",
    ...noPct,
  ])
  rows.push([
    "Markup on cost %, fee / cost",
    "",
    "",
    ...noKind,
    ...math(null),
    percentCell(view.margin.estimate.markupOnCostPercent),
    hasActual ? percentCell(view.margin.actual.markupOnCostPercent) : "",
    ...noPct,
  ])
  // By category, as on the Summary tab: each category's total and share of the project total, and
  // its fee and cost parts when its lines are not all of its kind.
  rows.push([])
  for (const c of view.categories) {
    rows.push([c.name, "(category total)", c.mixed ? "mixed" : c.feeOrCost, ...noKind, ...math(null), money(c.estimateCents), actual(c.actualCents), ...pct(c.percentOfTotal)])
    if (c.mixed) {
      rows.push([c.name, "(fee part)", "fee", ...noKind, ...math(null), money(c.fee.estimateCents), actual(c.fee.actualCents), ...noPct])
      rows.push([c.name, "(cost part)", "cost", ...noKind, ...math(null), money(c.cost.estimateCents), actual(c.cost.actualCents), ...noPct])
    }
  }

  const csv = toCsv(
    [
      "Category",
      "Line",
      "Fee or cost",
      "Kind",
      "Kind source",
      "Qty",
      "Rate",
      "Multiplier",
      "Unit",
      "Estimate",
      "Actual",
      "Estimate % of total",
      "Actual % of total",
    ],
    rows
  )
  downloadCsv(`${fileSlug(projectName)}-budget.csv`, csv)
  return view.categories.reduce((a, c) => a + c.lines.length, 0)
}

export async function exportLedgerCsv(projectId: string, projectName: string): Promise<number> {
  const base = projectBase(projectId)
  const entries = await readLedger(projectId)
  if (entries === null) throw new BudgetApiError("not_enabled", 404, "The ledger is not enabled yet, so there is nothing to export.")
  const [chart, lines, docs] = await Promise.all([
    budgetFetch<{ categories: ProjectCategory[] }>(`${base}/chart?include_archived=1`),
    budgetFetch<{ lines: BudgetLine[] }>(`${base}/lines?include_archived=1`),
    budgetFetch<{ documents: SourceDocument[] }>(`${base}/documents?include_archived=1`),
  ])
  const cat = new Map(chart.categories.map((c) => [c.id, c]))
  const lineById = new Map(lines.lines.map((l) => [l.id, l]))
  const docName = new Map(docs.documents.map((d) => [d.id, d.file_name]))
  /** The entry's effective kind, as the Summary tab counts it: its line's, else its category's. */
  const entryKind = (e: LedgerEntry): string => {
    const line = e.budget_line_id ? lineById.get(e.budget_line_id) : undefined
    const lineCategory = line ? cat.get(line.category_id)?.fee_or_cost : undefined
    return line?.fee_or_cost ?? lineCategory ?? cat.get(e.category_id)?.fee_or_cost ?? ""
  }

  const rows = entries.map((e) => [
    e.id,
    e.entry_date ?? "",
    e.payee_name ?? "",
    cat.get(e.category_id)?.name ?? "",
    entryKind(e),
    cat.get(e.original_category_id)?.name ?? "",
    e.budget_line_id ? lineById.get(e.budget_line_id)?.name ?? "" : "",
    docName.get(e.source_document_id) ?? "",
    centsToDecimalString(toCentsFromApi(e.amount)),
    e.voided_at ? "voided" : "active",
    e.voided_at ?? "",
    e.void_reason ?? "",
    e.duplicate_of ?? "",
    e.created_at,
  ])
  const csv = toCsv(
    [
      "Entry ID",
      "Date",
      "Payee",
      "Category",
      "Fee or cost",
      "Original category",
      "Line",
      "Document",
      "Amount",
      "Status",
      "Voided at",
      "Void reason",
      "Duplicate of (entry ID)",
      "Recorded at",
    ],
    rows
  )
  downloadCsv(`${fileSlug(projectName)}-ledger.csv`, csv)
  return entries.length
}
