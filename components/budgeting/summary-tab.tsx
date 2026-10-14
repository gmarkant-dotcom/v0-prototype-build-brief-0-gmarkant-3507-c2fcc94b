"use client"

import { useMemo } from "react"
import { BudgetErrorState, BudgetLoading, FeeCostBadge, KindChip, MixedBadge, QuietEmpty } from "./budget-states"
import { useChart, useLedger, useSummary } from "@/lib/budget/hooks"
import { useRefreshProject } from "@/lib/budget/use-refresh"
import { BudgetApiError } from "@/lib/budget/client-api"
import { formatCents, formatPercent } from "@/lib/budget/money"
import { buildSummaryView } from "@/lib/budget/summary-view"

const th = "px-3 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted"

/** A margin card's ratio: "12.5% share of total", or "share of total: n/a" when undefined (F3). */
const ratio = (p: number | null, label: string) => (p === null ? `${label}: n/a` : `${formatPercent(p)} ${label}`)

export function SummaryTab({ projectId }: { projectId: string }) {
  const chart = useChart(projectId, true)
  const summary = useSummary(projectId)
  const ledger = useLedger(projectId)
  const refresh = useRefreshProject(projectId)

  // 104 missing is not an error here: there is simply no ledger yet.
  const ledgerMissing = ledger.error instanceof BudgetApiError && ledger.error.kind === "not_enabled"
  const ledgerError = ledger.error && !ledgerMissing ? ledger.error : null

  const view = useMemo(() => {
    if (!chart.data || !summary.data) return null
    const retired = new Set(chart.data.merges.map((m) => m.from_category_id))
    return buildSummaryView(chart.data.categories, retired, summary.data.summary, ledger.data?.entries ?? [])
  }, [chart.data, summary.data, ledger.data])

  if (chart.isLoading || summary.isLoading || ledger.isLoading) return <BudgetLoading label="Loading summary" />
  const error = chart.error ?? summary.error ?? ledgerError
  if (error) return <BudgetErrorState error={error} onRetry={() => refresh()} />
  if (!view) return null

  const hasActual = view.ledgerEnabled && !ledgerMissing
  const actual = (cents: number) => (hasActual ? formatCents(cents) : "-")

  if (view.categories.length === 0) return <QuietEmpty>No categories yet. Start the budget on the Budget tab.</QuietEmpty>

  return (
    <div className="space-y-8">
      {!hasActual ? (
        <p className="text-sm text-foreground-muted">No ledger yet, so there is no Actual to show. Estimates and estimated margin are below.</p>
      ) : null}

      <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Metric label="Estimate" value={formatCents(view.totals.estimateCents)} />
        <Metric label="Actual" value={hasActual ? formatCents(view.totals.actualCents) : "No ledger yet"} />
        <Metric
          label="Margin (estimate)"
          value={formatCents(view.margin.estimate.amountCents)}
          basis={`${ratio(view.margin.estimate.shareOfTotalPercent, "share of total")} · ${ratio(view.margin.estimate.markupOnCostPercent, "markup on cost")}`}
        />
        <Metric
          label="Margin (actual)"
          value={hasActual ? formatCents(view.margin.actual.amountCents) : "No ledger yet"}
          basis={
            hasActual
              ? `${ratio(view.margin.actual.shareOfTotalPercent, "share of total")} · ${ratio(view.margin.actual.markupOnCostPercent, "markup on cost")}`
              : undefined
          }
        />
      </section>

      <section className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className={th}>Totals</th>
              <th className={`${th} text-right`}>Estimate</th>
              <th className={`${th} text-right`}>% of total</th>
              <th className={`${th} text-right`}>Actual</th>
              <th className={`${th} text-right`}>% of total</th>
              <th className={`${th} text-right`}>Variance</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Fee total", view.fee, view.percentOfTotal.fee],
                ["Cost total", view.cost, view.percentOfTotal.cost],
              ] as const
            ).map(([label, t, pct]) => (
              <tr key={label} className="border-t border-border">
                <td className="px-3 py-2 text-foreground">{label}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground">{formatCents(t.estimateCents)}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground-muted">{formatPercent(pct.estimate)}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground">{actual(t.actualCents)}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground-muted">{hasActual ? formatPercent(pct.actual) : "-"}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground-muted">{hasActual ? formatCents(t.estimateCents - t.actualCents) : "-"}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-bold">
              <td className="px-3 py-2 text-foreground">Project total</td>
              <td className="px-3 py-2 text-right font-mono text-foreground">{formatCents(view.totals.estimateCents)}</td>
              <td className="px-3 py-2 text-right font-mono text-foreground">{formatPercent(view.percentOfTotal.total.estimate)}</td>
              <td className="px-3 py-2 text-right font-mono text-foreground">{actual(view.totals.actualCents)}</td>
              <td className="px-3 py-2 text-right font-mono text-foreground">{hasActual ? formatPercent(view.percentOfTotal.total.actual) : "-"}</td>
              <td className="px-3 py-2 text-right font-mono text-foreground">{hasActual ? formatCents(view.totals.estimateCents - view.totals.actualCents) : "-"}</td>
            </tr>
            {(
              [
                ["Margin (share of total)", view.margin.estimate.shareOfTotalPercent, view.margin.actual.shareOfTotalPercent],
                ["Markup on cost", view.margin.estimate.markupOnCostPercent, view.margin.actual.markupOnCostPercent],
              ] as const
            ).map(([label, estimate, actualPercent]) => (
              <tr key={label} className="border-t border-border">
                <td className="px-3 py-2 text-foreground">{label}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground">{formatPercent(estimate)}</td>
                <td />
                <td className="px-3 py-2 text-right font-mono text-foreground">{hasActual ? formatPercent(actualPercent) : "-"}</td>
                <td />
                <td />
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 border-t border-border text-xs text-foreground-muted">
          Fee and cost are summed by each line&apos;s own kind: the line&apos;s setting if it has one, otherwise its category&apos;s. % of total is
          the share of the project total, and is negative for a net discount. Margin is the fee total. Margin (share of total) is fee divided by
          fee plus cost; markup on cost is fee divided by cost. Each shows &quot;-&quot; when what it divides by is 0. Variance is estimate minus
          actual. Voided ledger entries are excluded.
        </p>
      </section>

      <section className="space-y-3">
        <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">By category</div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className={th}>Category / line</th>
                <th className={th}>Fee or cost</th>
                <th className={`${th} text-right`}>Estimate</th>
                <th className={`${th} text-right`}>% of total</th>
                <th className={`${th} text-right`}>Actual</th>
                <th className={`${th} text-right`}>% of total</th>
                <th className={`${th} text-right`}>Variance</th>
              </tr>
            </thead>
            <tbody>
              {view.categories.map((c) => (
                <CategoryRows key={c.categoryId} c={c} hasActual={hasActual} lineKind={view.lineKind} />
              ))}
              {view.unplacedActualCents !== 0 ? (
                <tr className="border-t border-border">
                  <td className="px-3 py-2 text-foreground-muted" colSpan={4}>
                    Entries in a category not shown
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-foreground">{actual(view.unplacedActualCents)}</td>
                  <td colSpan={2} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function CategoryRows({
  c,
  hasActual,
  lineKind,
}: {
  c: ReturnType<typeof buildSummaryView>["categories"][number]
  hasActual: boolean
  lineKind: boolean
}) {
  const money = (cents: number) => (hasActual ? formatCents(cents) : "-")
  return (
    <>
      <tr className="border-t border-border bg-white/5">
        <td className="px-3 py-2 font-bold text-foreground">
          {c.name}
          {c.archived ? <span className="ml-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">Archived</span> : null}
        </td>
        <td className="px-3 py-2">{c.mixed ? <MixedBadge /> : <FeeCostBadge value={c.feeOrCost} />}</td>
        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">{formatCents(c.estimateCents)}</td>
        <td className="px-3 py-2 text-right font-mono text-foreground-muted">{formatPercent(c.percentOfTotal.estimate)}</td>
        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">{money(c.actualCents)}</td>
        <td className="px-3 py-2 text-right font-mono text-foreground-muted">{hasActual ? formatPercent(c.percentOfTotal.actual) : "-"}</td>
        <td className={`px-3 py-2 text-right font-mono font-bold ${hasActual && c.estimateCents - c.actualCents < 0 ? "text-destructive" : "text-foreground"}`}>
          {hasActual ? formatCents(c.estimateCents - c.actualCents) : "-"}
        </td>
      </tr>
      {c.mixed
        ? (
            [
              ["fee", "Fee part", c.fee],
              ["cost", "Cost part", c.cost],
            ] as const
          ).map(([kind, label, a]) => (
            <tr key={kind} className="border-t border-border/50">
              <td className="px-3 py-1.5 pl-8 text-foreground">{label}</td>
              <td className="px-3 py-1.5">
                <FeeCostBadge value={kind} />
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-foreground">{formatCents(a.estimateCents)}</td>
              <td />
              <td className="px-3 py-1.5 text-right font-mono text-foreground">{money(a.actualCents)}</td>
              <td colSpan={2} />
            </tr>
          ))
        : null}
      {c.lines.map((l) => (
        <tr key={l.lineId} className="border-t border-border/50">
          <td className="px-3 py-1.5 pl-8 text-foreground-muted">{l.name}</td>
          <td className="px-3 py-1.5">{lineKind ? <KindChip kind={l.kind} source={l.kindSource} /> : null}</td>
          <td className="px-3 py-1.5 text-right font-mono text-foreground-muted">{formatCents(l.estimateCents)}</td>
          <td />
          <td className="px-3 py-1.5 text-right font-mono text-foreground-muted">{money(l.actualCents)}</td>
          <td />
          <td className={`px-3 py-1.5 text-right font-mono ${hasActual && l.varianceCents < 0 ? "text-destructive" : "text-foreground-muted"}`}>
            {hasActual ? formatCents(l.varianceCents) : "-"}
          </td>
        </tr>
      ))}
      {c.offLineCount > 0 ? (
        <tr className="border-t border-border/50">
          <td className="px-3 py-1.5 pl-8 text-foreground-muted italic" colSpan={4}>
            Not on a line ({c.offLineCount} {c.offLineCount === 1 ? "entry" : "entries"})
          </td>
          <td className="px-3 py-1.5 text-right font-mono text-foreground-muted">{money(c.offLineActualCents)}</td>
          <td colSpan={2} />
        </tr>
      ) : null}
    </>
  )
}

function Metric({ label, value, basis }: { label: string; value: string; basis?: string }) {
  return (
    <div className="rounded-lg border border-border bg-white/5 p-4">
      <div className="font-display font-bold text-2xl text-foreground">{value}</div>
      <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted mt-1">{label}</div>
      {basis ? <div className="text-xs text-foreground-muted mt-0.5">{basis}</div> : null}
    </div>
  )
}
