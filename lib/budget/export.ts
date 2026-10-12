import { budgetFetch, BudgetApiError, projectBase } from "./client-api"
import { downloadCsv, fileSlug, toCsv } from "./csv-export"
import { centsToDecimalString, toCentsFromApi } from "./money"
import { buildSummaryView } from "./summary-view"
import type { CategoryMerge, LedgerEntry, ProjectCategory, BudgetLine, SourceDocument } from "@/lib/server/budget/schema"
import type { EstimateVsActual } from "@/lib/server/budget/summary"

/**
 * FINANCE EXPORTS. Read fresh from the gated API at the moment of export, built from the same
 * summary view as the Summary tab (one source per number), written as CSV with every cell quoted
 * and formula-neutralised (lib/budget/csv-export.ts). Amounts are plain decimals from integer cents.
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
  const [chart, summary, entries] = await Promise.all([
    budgetFetch<{ categories: ProjectCategory[]; merges: CategoryMerge[] }>(`${base}/chart?include_archived=1`),
    budgetFetch<{ summary: EstimateVsActual }>(`${base}/summary`),
    readLedger(projectId),
  ])
  const retired = new Set(chart.merges.map((m) => m.from_category_id))
  const view = buildSummaryView(chart.categories, retired, summary.summary, entries ?? [])
  const hasActual = view.ledgerEnabled && entries !== null
  const money = (cents: number) => centsToDecimalString(cents)
  const actual = (cents: number) => (hasActual ? money(cents) : "")

  const rows: unknown[][] = []
  for (const c of view.categories) {
    for (const l of c.lines) rows.push([c.name, l.name, c.feeOrCost, money(l.estimateCents), actual(l.actualCents)])
    if (c.offLineCount > 0) rows.push([c.name, "(not on a line)", c.feeOrCost, money(0), actual(c.offLineActualCents)])
    if (c.lines.length === 0 && c.offLineCount === 0) rows.push([c.name, "", c.feeOrCost, money(0), actual(0)])
  }
  rows.push([])
  rows.push(["Fee total", "", "fee", money(view.fee.estimateCents), actual(view.fee.actualCents)])
  rows.push(["Cost total", "", "cost", money(view.cost.estimateCents), actual(view.cost.actualCents)])
  rows.push(["Project total", "", "", money(view.totals.estimateCents), actual(view.totals.actualCents)])
  rows.push(["Margin (fee total)", "", "", money(view.margin.estimate.amountCents), actual(view.margin.actual.amountCents)])
  rows.push([
    "Margin percent (fee / (fee + cost))",
    "",
    "",
    view.margin.estimate.percent === null ? "" : view.margin.estimate.percent.toFixed(1),
    hasActual && view.margin.actual.percent !== null ? view.margin.actual.percent.toFixed(1) : "",
  ])

  const csv = toCsv(["Category", "Line", "Fee or cost", "Estimate", "Actual"], rows)
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
  const lineName = new Map(lines.lines.map((l) => [l.id, l.name]))
  const docName = new Map(docs.documents.map((d) => [d.id, d.file_name]))

  const rows = entries.map((e) => [
    e.id,
    e.entry_date ?? "",
    e.payee_name ?? "",
    cat.get(e.category_id)?.name ?? "",
    cat.get(e.category_id)?.fee_or_cost ?? "",
    cat.get(e.original_category_id)?.name ?? "",
    e.budget_line_id ? lineName.get(e.budget_line_id) ?? "" : "",
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
