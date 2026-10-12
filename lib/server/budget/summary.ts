import type { SupabaseClient } from "@supabase/supabase-js"
import { BUDGET_TABLES } from "./schema"
import { fromDbError, isBudgetSpineMissing, ok, toCents, type BudgetResult } from "./result"
import type { AgencyProject } from "./scope"

/**
 * ESTIMATE VS ACTUAL, PER LINE (R5). Estimate is the stored column. Actual is DERIVED on every
 * read: the signed sum of the line's ledger entries WHERE voided_at IS NULL (R2). Committed and
 * Paid are deferred by the ruling and are not reported. Money is summed in integer cents.
 *
 * If 103 is applied and 104 is not, the summary still answers with `ledgerEnabled: false` and
 * every actual 0, because a missing ledger means "no spend recorded", not an error.
 */

export type LineSummary = {
  lineId: string
  name: string
  categoryId: string
  estimate: number
  actual: number
  variance: number
  entryCount: number
}

export type EstimateVsActual = {
  projectId: string
  ledgerEnabled: boolean
  lines: LineSummary[]
  totals: { estimate: number; actual: number; variance: number }
  /**
   * Non-voided entries not on a live line: entries with no line yet (they count against a category
   * and no line) plus entries on archived lines. Included in totals.actual.
   */
  unassigned: { actual: number; entryCount: number }
}

export async function getEstimateVsActual(client: SupabaseClient, project: AgencyProject): Promise<BudgetResult<EstimateVsActual>> {
  const { data: lineRows, error: linesErr } = await client
    .from(BUDGET_TABLES.lines)
    .select("id, name, category_id, estimate")
    .eq("project_id", project.projectId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
  if (linesErr) return fromDbError(linesErr)

  let ledgerEnabled = true
  const actualByLine = new Map<string, { cents: number; count: number }>()
  let unassignedCents = 0
  let unassignedCount = 0

  const { data: entryRows, error: entriesErr } = await client
    .from(BUDGET_TABLES.ledgerEntries)
    .select("budget_line_id, amount")
    .eq("project_id", project.projectId)
    .is("voided_at", null)
  if (entriesErr) {
    if (!isBudgetSpineMissing(entriesErr)) return fromDbError(entriesErr)
    ledgerEnabled = false
  } else {
    for (const row of (entryRows ?? []) as Array<{ budget_line_id: string | null; amount: unknown }>) {
      const cents = toCents(row.amount)
      if (!row.budget_line_id) {
        unassignedCents += cents
        unassignedCount += 1
        continue
      }
      const cur = actualByLine.get(row.budget_line_id) ?? { cents: 0, count: 0 }
      cur.cents += cents
      cur.count += 1
      actualByLine.set(row.budget_line_id, cur)
    }
  }

  let estimateTotal = 0
  let actualTotal = 0
  const lines: LineSummary[] = ((lineRows ?? []) as Array<{ id: string; name: string; category_id: string; estimate: unknown }>).map((l) => {
    const estimateCents = toCents(l.estimate)
    const actual = actualByLine.get(l.id) ?? { cents: 0, count: 0 }
    estimateTotal += estimateCents
    actualTotal += actual.cents
    return {
      lineId: l.id,
      name: l.name,
      categoryId: l.category_id,
      estimate: estimateCents / 100,
      actual: actual.cents / 100,
      variance: (estimateCents - actual.cents) / 100,
      entryCount: actual.count,
    }
  })

  // Entries on ARCHIVED lines still count toward the project total: archiving hides, it does not
  // erase spend. They are reported with the unassigned bucket so the totals reconcile.
  const visibleLineIds = new Set(lines.map((l) => l.lineId))
  for (const [lineId, v] of actualByLine) {
    if (!visibleLineIds.has(lineId)) {
      unassignedCents += v.cents
      unassignedCount += v.count
    }
  }

  return ok({
    projectId: project.projectId,
    ledgerEnabled,
    lines,
    totals: {
      estimate: estimateTotal / 100,
      actual: (actualTotal + unassignedCents) / 100,
      variance: (estimateTotal - actualTotal - unassignedCents) / 100,
    },
    unassigned: { actual: unassignedCents / 100, entryCount: unassignedCount },
  })
}
