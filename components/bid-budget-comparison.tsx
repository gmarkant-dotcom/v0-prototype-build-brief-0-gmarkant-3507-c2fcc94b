"use client"

import { Fragment, useState } from "react"
import { ChevronRight, AlertTriangle } from "lucide-react"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { currencySymbolFor } from "@/lib/rfp-response-fields"
import {
  budgetLinesTotal,
  categorySubtotal,
  normalizeBudgetCategories,
  normalizeBudgetLines,
  sortCategories,
  ADDITIONAL_ITEMS_NAME,
  type BudgetCategory,
  type BudgetLines,
} from "@/lib/budget-categories"

/** Agency-side, dark only - both call sites (compare view, bid detail sheet) are agency portal. */

function money(amount: number, currency: string): string {
  const symbol = currencySymbolFor(currency)
  const formatted = amount.toLocaleString("en-US", { maximumFractionDigits: 2 })
  return symbol ? `${symbol}${formatted}` : `${formatted} ${currency}`
}

export type BudgetComparisonBid = {
  id: string
  label: string
  lines: BudgetLines | null
}

/** Rows to render: the RFP's own category list when we have it, otherwise the union of what the
 *  bids actually answered. An agency that edited its categories after bids came in still sees
 *  every submitted line rather than silently losing the ones it removed. */
function buildRows(
  categories: BudgetCategory[],
  bids: BudgetComparisonBid[]
): { key: string; name: string; is_additional_items: boolean }[] {
  const rows = sortCategories(categories).map((c) => ({
    key: c.key,
    name: c.name,
    is_additional_items: c.is_additional_items,
  }))
  const known = new Set(rows.map((r) => r.key))
  for (const bid of bids) {
    for (const entry of bid.lines?.categories || []) {
      if (known.has(entry.key)) continue
      known.add(entry.key)
      rows.push({
        key: entry.key,
        name: entry.name_snapshot,
        is_additional_items: entry.name_snapshot === ADDITIONAL_ITEMS_NAME,
      })
    }
  }
  // Additional items always last, whichever source produced the row.
  return rows.sort((a, b) => (a.is_additional_items === b.is_additional_items ? 0 : a.is_additional_items ? 1 : -1))
}

/**
 * Category-by-category comparison (P2-1). One row per category, one column per bid.
 *
 * Currency is displayed exactly as each vendor submitted it and is never converted - two bids
 * in different currencies are shown side by side with their own symbols and no arithmetic
 * between them, because an invented exchange rate is invented data. A mixed-currency comparison
 * says so in a line above the table rather than implying the columns are comparable.
 *
 * A bid that gave a single subtotal where another itemized shows just its subtotal, with no
 * expand affordance - judgment call 8, no fake itemization.
 *
 * Renders nothing when no bid carries any structured budget, so an RFP without categories and
 * every bid predating this feature look exactly as they did before.
 */
export function BidBudgetComparison({
  categoriesSource,
  bids,
}: {
  /** master_rfp_json (wizard flow) or the token's budget_categories (magic-link flow). */
  categoriesSource: unknown
  bids: BudgetComparisonBid[]
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const withLines = bids.filter((b) => b.lines != null)
  if (withLines.length === 0) return null

  const categories = normalizeBudgetCategories(categoriesSource)
  const rows = buildRows(categories, bids)
  if (rows.length === 0) return null

  const currencies = [...new Set(withLines.map((b) => b.lines?.currency).filter(Boolean))] as string[]
  const mixedCurrency = currencies.length > 1

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="rounded-xl border border-border/40 bg-white/[0.02] overflow-hidden">
      <div className="px-5 pt-5 pb-1">
        <div className="font-mono text-2xs uppercase text-foreground-muted tracking-wider">Budget by category</div>
        {mixedCurrency && (
          <p className="text-xs text-warning mt-2">
            These bids were submitted in different currencies ({currencies.join(", ")}). Amounts are shown exactly as
            each vendor entered them and are not converted, so the columns are not directly comparable.
          </p>
        )}
      </div>
      <div className="p-5 pt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border/40 hover:bg-transparent">
              <TableHead className="text-foreground-muted">Category</TableHead>
              {bids.map((bid) => (
                <TableHead key={bid.id} className="text-foreground text-right min-w-[140px]">
                  {bid.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const anyItemized = bids.some(
                (b) => (b.lines?.categories.find((c) => c.key === row.key)?.items.length ?? 0) > 0
              )
              const isOpen = expanded.has(row.key)
              return (
                <Fragment key={row.key}>
                  <TableRow className="border-border/30">
                    <TableCell
                      className={cn(
                        "font-mono text-2xs uppercase",
                        row.is_additional_items ? "text-warning" : "text-foreground-muted"
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {row.is_additional_items && <AlertTriangle className="w-3 h-3 shrink-0" />}
                        {anyItemized ? (
                          <button
                            type="button"
                            onClick={() => toggle(row.key)}
                            aria-expanded={isOpen}
                            className="flex items-center gap-1 hover:text-foreground transition-colors"
                          >
                            <ChevronRight className={cn("w-3 h-3 transition-transform", isOpen && "rotate-90")} />
                            {row.name}
                          </button>
                        ) : (
                          row.name
                        )}
                      </span>
                    </TableCell>
                    {bids.map((bid) => {
                      const entry = bid.lines?.categories.find((c) => c.key === row.key)
                      return (
                        <TableCell key={bid.id} className="text-right text-sm text-foreground">
                          {entry ? money(categorySubtotal(entry), bid.lines?.currency || "USD") : "-"}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                  {isOpen && (
                    <TableRow className="border-border/20 hover:bg-transparent">
                      <TableCell colSpan={bids.length + 1} className="py-2">
                        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${bids.length}, minmax(0, 1fr))` }}>
                          {bids.map((bid) => {
                            const entry = bid.lines?.categories.find((c) => c.key === row.key)
                            const items = entry?.items || []
                            return (
                              <div key={bid.id} className="space-y-1">
                                {items.length === 0 ? (
                                  /* No fake itemization: this vendor gave one number, so one
                                     number is all that is shown. */
                                  <div className="font-mono text-2xs text-foreground-muted">Subtotal only</div>
                                ) : (
                                  items.map((item, i) => (
                                    <div key={i} className="flex items-baseline justify-between gap-2 text-xs">
                                      <span className="text-foreground-muted truncate">{item.description}</span>
                                      <span className="text-foreground shrink-0">
                                        {money(item.amount, bid.lines?.currency || "USD")}
                                      </span>
                                    </div>
                                  ))
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
            <TableRow className="border-border/40 hover:bg-transparent">
              <TableCell className="font-mono text-2xs uppercase text-foreground">Total</TableCell>
              {bids.map((bid) => (
                <TableCell key={bid.id} className="text-right font-display font-bold text-foreground">
                  {bid.lines ? money(budgetLinesTotal(bid.lines), bid.lines.currency) : "-"}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/**
 * Single-bid breakdown for the bid detail sheet. Same data, one column, always expanded -
 * there is nothing to compare against, so hiding the itemization behind a toggle would only
 * add a click.
 */
export function BidBudgetBreakdown({ lines: rawLines }: { lines: unknown }) {
  const lines = normalizeBudgetLines(rawLines)
  if (!lines) return null
  return (
    <div className="space-y-2">
      <div className="font-mono text-2xs uppercase text-foreground-muted tracking-wider">Budget by category</div>
      <div className="rounded-lg border border-border/40 divide-y divide-border/30">
        {lines.categories.map((entry) => (
          <div key={entry.key} className="p-3 space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={cn(
                  "text-sm",
                  entry.name_snapshot === ADDITIONAL_ITEMS_NAME ? "text-warning" : "text-foreground"
                )}
              >
                {entry.name_snapshot}
              </span>
              <span className="font-mono text-sm text-foreground shrink-0">
                {money(categorySubtotal(entry), lines.currency)}
              </span>
            </div>
            {entry.items.map((item, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 pl-3">
                <span className="text-xs text-foreground-muted truncate">{item.description}</span>
                <span className="font-mono text-xs text-foreground-muted shrink-0">
                  {money(item.amount, lines.currency)}
                </span>
              </div>
            ))}
          </div>
        ))}
        <div className="p-3 flex items-baseline justify-between gap-3">
          <span className="font-mono text-2xs uppercase text-foreground">Total</span>
          <span className="font-display font-bold text-foreground">{money(budgetLinesTotal(lines), lines.currency)}</span>
        </div>
      </div>
    </div>
  )
}
