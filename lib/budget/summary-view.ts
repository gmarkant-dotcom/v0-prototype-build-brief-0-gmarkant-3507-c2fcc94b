import { computeMargin, toCentsFromApi } from "./money"
import type { FeeOrCost, LedgerEntry, ProjectCategory } from "@/lib/server/budget/schema"
import type { EstimateVsActual } from "@/lib/server/budget/summary"

/**
 * ONE SOURCE FOR EVERY BUDGET NUMBER ON SCREEN AND IN THE EXPORT. Integer cents throughout.
 *
 *  - Line Estimate and Actual come from the summary route (R5: Actual is the signed sum of the
 *    line's non-voided ledger entries, computed on the server).
 *  - A category's Actual is its lines' Actual plus its non-voided entries that are not on a live
 *    line (no line yet, or the line is archived). So category Actuals add up to the project's total
 *    Actual exactly, and the fee / cost split of Actual covers every non-voided entry.
 *  - Fee and cost come from the category's flag. Margin: lib/budget/money.ts computeMargin().
 */

export type LineView = { lineId: string; name: string; estimateCents: number; actualCents: number; varianceCents: number; entryCount: number }

export type CategoryView = {
  categoryId: string
  name: string
  feeOrCost: FeeOrCost
  archived: boolean
  lines: LineView[]
  estimateCents: number
  actualCents: number
  /** Non-voided entries in this category that are not on a live line. Included in actualCents. */
  offLineActualCents: number
  offLineCount: number
}

export type SummaryView = {
  ledgerEnabled: boolean
  categories: CategoryView[]
  totals: { estimateCents: number; actualCents: number }
  fee: { estimateCents: number; actualCents: number }
  cost: { estimateCents: number; actualCents: number }
  margin: {
    estimate: { amountCents: number; percent: number | null }
    actual: { amountCents: number; percent: number | null }
  }
  /** Entries whose category is not in the chart response at all (should be 0; shown if not). */
  unplacedActualCents: number
}

export function buildSummaryView(
  categories: ProjectCategory[],
  retiredIds: Set<string>,
  summary: EstimateVsActual,
  entries: LedgerEntry[]
): SummaryView {
  const liveLineIds = new Set(summary.lines.map((l) => l.lineId))
  const byCategory = new Map<string, CategoryView>()
  for (const c of categories) {
    byCategory.set(c.id, {
      categoryId: c.id,
      name: c.name,
      feeOrCost: c.fee_or_cost,
      archived: Boolean(c.archived_at),
      lines: [],
      estimateCents: 0,
      actualCents: 0,
      offLineActualCents: 0,
      offLineCount: 0,
    })
  }

  for (const l of summary.lines) {
    const cat = byCategory.get(l.categoryId)
    if (!cat) continue
    const estimateCents = toCentsFromApi(l.estimate)
    const actualCents = toCentsFromApi(l.actual)
    cat.lines.push({ lineId: l.lineId, name: l.name, estimateCents, actualCents, varianceCents: estimateCents - actualCents, entryCount: l.entryCount })
    cat.estimateCents += estimateCents
    cat.actualCents += actualCents
  }

  let unplacedActualCents = 0
  for (const e of entries) {
    if (e.voided_at) continue
    if (e.budget_line_id && liveLineIds.has(e.budget_line_id)) continue
    const cents = toCentsFromApi(e.amount)
    const cat = byCategory.get(e.category_id)
    if (!cat) {
      unplacedActualCents += cents
      continue
    }
    cat.offLineActualCents += cents
    cat.offLineCount += 1
    cat.actualCents += cents
  }

  // Show a category if it is live, or if it carries money (an archived or merged-away category
  // with entries still counts toward Actual and must be visible for the totals to reconcile).
  const shown = Array.from(byCategory.values()).filter(
    (c) => (!c.archived && !retiredIds.has(c.categoryId)) || c.lines.length > 0 || c.offLineCount > 0
  )

  const sum = (pick: (c: CategoryView) => number, flag?: FeeOrCost) =>
    shown.filter((c) => !flag || c.feeOrCost === flag).reduce((a, c) => a + pick(c), 0)

  const fee = { estimateCents: sum((c) => c.estimateCents, "fee"), actualCents: sum((c) => c.actualCents, "fee") }
  const cost = { estimateCents: sum((c) => c.estimateCents, "cost"), actualCents: sum((c) => c.actualCents, "cost") }

  return {
    ledgerEnabled: summary.ledgerEnabled,
    categories: shown,
    totals: { estimateCents: sum((c) => c.estimateCents), actualCents: sum((c) => c.actualCents) + unplacedActualCents },
    fee,
    cost,
    margin: {
      estimate: computeMargin(fee.estimateCents, cost.estimateCents),
      actual: computeMargin(fee.actualCents, cost.actualCents),
    },
    unplacedActualCents,
  }
}
