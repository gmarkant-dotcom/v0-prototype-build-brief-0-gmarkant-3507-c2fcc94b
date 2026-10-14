import { computeMargin, toCentsFromApi, type Margin } from "./money"
import { effectiveKind, type FeeOrCost, type LedgerEntry, type ProjectCategory } from "@/lib/server/budget/schema"
import type { EstimateVsActual } from "@/lib/server/budget/summary"

/**
 * ONE SOURCE FOR EVERY BUDGET NUMBER ON SCREEN AND IN THE EXPORT. Integer cents throughout.
 *
 *  - Line Estimate and Actual come from the summary route (R5: Actual is the signed sum of the
 *    line's non-voided ledger entries, computed on the server).
 *  - A category's Actual is its lines' Actual plus its non-voided entries that are not on a live
 *    line (no line yet, or the line is archived). So category Actuals add up to the project's total
 *    Actual exactly.
 *  - FEE AND COST ARE SPLIT BY EFFECTIVE KIND PER LINE (117, R-K1), never by category alone. A
 *    line's effective kind is its override if set, else its category's kind. Estimate: each live
 *    line's estimate goes to its effective kind. Actual: an entry on a live line counts with that
 *    line; an entry on an archived line takes that line's effective kind; an entry on no line takes
 *    its category's kind (ledger_entries.category_id is NOT NULL, so every entry has one).
 *  - Margin: lib/budget/money.ts computeMargin(), fed by the effective-kind fee and cost totals: the
 *    amount, the share of total (fee / (fee + cost)) and the markup on cost (fee / cost).
 *  - R-K2 / R-K3: percentages of the PROJECT TOTAL, never a line computed from other lines. Fee %,
 *    cost % and each category's % of total, for Estimate and Actual. null (shown "-") only when the
 *    project total is 0; a negative share (a discount-heavy category) stays negative.
 */

export type KindSource = "inherited" | "override"

export type LineView = {
  lineId: string
  name: string
  estimateCents: number
  actualCents: number
  varianceCents: number
  entryCount: number
  /** Effective kind: the override if set, else the category's. */
  kind: FeeOrCost
  kindSource: KindSource
}

export type Amounts = { estimateCents: number; actualCents: number }

/** Share of the project total, Estimate and Actual, in percent. null when the total is 0. */
export type PercentOfTotal = { estimate: number | null; actual: number | null }

export type CategoryView = {
  categoryId: string
  name: string
  feeOrCost: FeeOrCost
  archived: boolean
  lines: LineView[]
  /** The sum of every line in the category, whatever its kind. */
  estimateCents: number
  actualCents: number
  /** Non-voided entries in this category that are not on a live line. Included in actualCents. */
  offLineActualCents: number
  offLineCount: number
  /** The off-line entries split by effective kind. */
  offLine: Record<FeeOrCost, { actualCents: number; count: number }>
  /** The category's money split by effective kind. fee + cost = estimateCents / actualCents. */
  fee: Amounts
  cost: Amounts
  /** Any line or off-line entry in it has an effective kind other than the category's. */
  mixed: boolean
  percentOfTotal: PercentOfTotal
}

export type SummaryView = {
  ledgerEnabled: boolean
  /** 117 applied. False: every line inherits its category's kind. */
  lineKind: boolean
  categories: CategoryView[]
  totals: Amounts
  fee: Amounts
  cost: Amounts
  percentOfTotal: { fee: PercentOfTotal; cost: PercentOfTotal; total: PercentOfTotal }
  margin: {
    estimate: Margin
    actual: Margin
  }
  /** Entries whose category is not in the chart response at all (should be 0; shown if not). */
  unplacedActualCents: number
}

export function shareOfTotal(partCents: number, totalCents: number): number | null {
  return totalCents === 0 ? null : (partCents / totalCents) * 100
}

const percentOf = (part: Amounts, total: Amounts): PercentOfTotal => ({
  estimate: shareOfTotal(part.estimateCents, total.estimateCents),
  actual: shareOfTotal(part.actualCents, total.actualCents),
})

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
      offLine: { fee: { actualCents: 0, count: 0 }, cost: { actualCents: 0, count: 0 } },
      fee: { estimateCents: 0, actualCents: 0 },
      cost: { estimateCents: 0, actualCents: 0 },
      mixed: false,
      percentOfTotal: { estimate: null, actual: null },
    })
  }

  for (const l of summary.lines) {
    const cat = byCategory.get(l.categoryId)
    if (!cat) continue
    const estimateCents = toCentsFromApi(l.estimate)
    const actualCents = toCentsFromApi(l.actual)
    const override = l.kind ?? null
    const kind = effectiveKind(override, cat.feeOrCost)
    cat.lines.push({
      lineId: l.lineId,
      name: l.name,
      estimateCents,
      actualCents,
      varianceCents: estimateCents - actualCents,
      entryCount: l.entryCount,
      kind,
      kindSource: override === null ? "inherited" : "override",
    })
    cat.estimateCents += estimateCents
    cat.actualCents += actualCents
    cat[kind].estimateCents += estimateCents
    cat[kind].actualCents += actualCents
    if (kind !== cat.feeOrCost) cat.mixed = true
  }

  // An entry on an archived line takes that line's effective kind (its override, else the kind of
  // the category the line sits in).
  const archivedLineKind = new Map<string, FeeOrCost | undefined>()
  for (const a of summary.archivedLines ?? []) {
    const lineCategory = byCategory.get(a.categoryId)
    archivedLineKind.set(a.lineId, a.kind ?? lineCategory?.feeOrCost)
  }

  let unplacedActualCents = 0
  const unplacedByKind: Record<FeeOrCost, number> = { fee: 0, cost: 0 }
  for (const e of entries) {
    if (e.voided_at) continue
    if (e.budget_line_id && liveLineIds.has(e.budget_line_id)) continue
    const cents = toCentsFromApi(e.amount)
    const cat = byCategory.get(e.category_id)
    const kind = (e.budget_line_id ? archivedLineKind.get(e.budget_line_id) : undefined) ?? cat?.feeOrCost
    if (!cat) {
      unplacedActualCents += cents
      if (kind) unplacedByKind[kind] += cents
      continue
    }
    const k = kind ?? cat.feeOrCost
    cat.offLineActualCents += cents
    cat.offLineCount += 1
    cat.offLine[k].actualCents += cents
    cat.offLine[k].count += 1
    cat.actualCents += cents
    cat[k].actualCents += cents
    if (k !== cat.feeOrCost) cat.mixed = true
  }

  // Show a category if it is live, or if it carries money (an archived or merged-away category
  // with entries still counts toward Actual and must be visible for the totals to reconcile).
  const shown = Array.from(byCategory.values()).filter(
    (c) => (!c.archived && !retiredIds.has(c.categoryId)) || c.lines.length > 0 || c.offLineCount > 0
  )

  const sum = (pick: (c: CategoryView) => number) => shown.reduce((a, c) => a + pick(c), 0)

  const fee: Amounts = {
    estimateCents: sum((c) => c.fee.estimateCents),
    actualCents: sum((c) => c.fee.actualCents) + unplacedByKind.fee,
  }
  const cost: Amounts = {
    estimateCents: sum((c) => c.cost.estimateCents),
    actualCents: sum((c) => c.cost.actualCents) + unplacedByKind.cost,
  }
  const totals: Amounts = { estimateCents: sum((c) => c.estimateCents), actualCents: sum((c) => c.actualCents) + unplacedActualCents }

  for (const c of shown) c.percentOfTotal = percentOf({ estimateCents: c.estimateCents, actualCents: c.actualCents }, totals)

  return {
    ledgerEnabled: summary.ledgerEnabled,
    lineKind: summary.lineKind === true,
    categories: shown,
    totals,
    fee,
    cost,
    percentOfTotal: { fee: percentOf(fee, totals), cost: percentOf(cost, totals), total: percentOf(totals, totals) },
    margin: {
      estimate: computeMargin(fee.estimateCents, cost.estimateCents),
      actual: computeMargin(fee.actualCents, cost.actualCents),
    },
    unplacedActualCents,
  }
}
