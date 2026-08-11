"use client"

import { useState } from "react"
import { Plus, Trash2, AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CurrencyInput } from "@/components/ui/currency-input"
import { HelpTerm } from "@/components/help-term"
import { cn } from "@/lib/utils"
import { currencySymbolFor } from "@/lib/rfp-response-fields"
import {
  draftEntryTotal,
  draftGrandTotal,
  parseBudgetLinePaste,
  type BudgetCategory,
  type BudgetDraft,
  type BudgetDraftEntry,
  type ParseSkip,
} from "@/lib/budget-categories"

type Theme = "light" | "dark"

const T: Record<Theme, Record<string, string>> = {
  light: {
    card: "rounded-lg border border-vendor-border bg-vendor-surface",
    flagged: "rounded-lg border border-warning/50 bg-warning/10",
    name: "font-display font-bold text-sm text-vendor-foreground",
    note: "text-xs text-vendor-muted-strong",
    label: "font-mono text-2xs uppercase tracking-wider text-vendor-muted",
    input: "bg-vendor-surface border-vendor-border text-vendor-foreground",
    derived: "bg-gray-100 border-vendor-border text-vendor-foreground",
    linkish: "text-vendor-foreground underline decoration-dotted underline-offset-4",
    muted: "text-vendor-muted",
    total: "text-vendor-foreground",
    iconBtn: "text-vendor-muted hover:bg-gray-100",
  },
  dark: {
    card: "rounded-lg border border-border bg-white/5",
    flagged: "rounded-lg border border-warning/40 bg-warning/10",
    name: "font-display font-bold text-sm text-foreground",
    note: "text-xs text-foreground-muted",
    label: "font-mono text-2xs uppercase tracking-wider text-foreground-muted",
    input: "bg-background border-border text-foreground",
    derived: "bg-white/10 border-border text-foreground",
    linkish: "text-foreground underline decoration-dotted underline-offset-4",
    muted: "text-foreground-muted",
    total: "text-foreground",
    iconBtn: "text-foreground-muted hover:bg-white/10",
  },
}

function formatMoney(value: number, symbol: string): string {
  return `${symbol}${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/**
 * Vendor-side budget-by-category block (P2-1). Theme-aware for the same reason
 * business-criteria-requirement-block.tsx is: the portal bid form is light and the guest
 * respond page is dark, and there is exactly one component behind both.
 *
 * Renders nothing at all when the RFP defines no categories - an RFP without budget structure
 * must look exactly as it did before this feature existed, which is also what makes the whole
 * thing pre-migration safe.
 *
 * Money rules: every amount is a CurrencyInput (the one blessed money control), the currency
 * symbol comes from the bid's own currency selector so the two can never disagree, and an
 * itemized category's subtotal is derived and read-only so no number on this form has two
 * editable sources.
 */
export function BidBudgetCategories({
  categories,
  draft,
  onChange,
  currency,
  theme = "light",
  disabled = false,
}: {
  categories: BudgetCategory[]
  draft: BudgetDraft
  onChange: (next: BudgetDraft) => void
  /** Currency code from the bid form's own selector - drives the symbol only. Budgets are never
   *  converted across currencies anywhere in this feature. */
  currency: string
  theme?: Theme
  disabled?: boolean
}) {
  const t = T[theme]
  const symbol = currencySymbolFor(currency) || "$"
  const [pasteOpenFor, setPasteOpenFor] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState("")
  const [pasteSkipped, setPasteSkipped] = useState<ParseSkip[]>([])

  if (categories.length === 0) return null

  const patch = (key: string, changes: Partial<BudgetDraftEntry>) => {
    const current = draft[key] ?? { subtotal: "", items: [], itemized: false }
    onChange({ ...draft, [key]: { ...current, ...changes } })
  }

  const toggleItemize = (key: string) => {
    const current = draft[key] ?? { subtotal: "", items: [], itemized: false }
    if (current.itemized) {
      // Collapsing back to a single figure keeps the number the vendor already arrived at
      // rather than blanking it - their items become the starting subtotal.
      const total = draftEntryTotal(current)
      patch(key, { itemized: false, subtotal: total != null ? String(total) : current.subtotal })
      return
    }
    patch(key, {
      itemized: true,
      items: current.items.length > 0 ? current.items : [{ description: "", amount: current.subtotal }],
    })
  }

  const applyPaste = (key: string) => {
    const { items, skipped } = parseBudgetLinePaste(pasteText)
    setPasteSkipped(skipped)
    if (items.length === 0) return
    const current = draft[key] ?? { subtotal: "", items: [], itemized: false }
    const existing = current.items.filter((i) => i.description.trim() || i.amount.trim())
    onChange({
      ...draft,
      [key]: {
        ...current,
        itemized: true,
        items: [...existing, ...items.map((i) => ({ description: i.description, amount: String(i.amount) }))],
      },
    })
    setPasteText("")
  }

  const grandTotal = draftGrandTotal(categories, draft)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className={t.label}>
          <HelpTerm term="budget_category" theme={theme}>
            Budget by category
          </HelpTerm>
        </span>
        <span className={cn("font-mono text-2xs", t.muted)}>{categories.length} required</span>
      </div>
      <p className={t.note}>
        This agency asked for a breakdown. Give every category a number - if something genuinely
        costs nothing, enter 0 and say so honestly.
      </p>

      {categories.map((category) => {
        const entry = draft[category.key] ?? { subtotal: "", items: [], itemized: false }
        const total = draftEntryTotal(entry)
        const answered = total != null
        return (
          <div key={category.key} className={cn("p-3 space-y-3", category.is_additional_items ? t.flagged : t.card)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {category.is_additional_items && <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />}
                  <span className={t.name}>{category.name}</span>
                </div>
                {category.note && <p className={cn(t.note, "mt-0.5")}>{category.note}</p>}
              </div>
              {!answered && <span className="font-mono text-2xs uppercase tracking-wider text-warning shrink-0">Needed</span>}
            </div>

            {entry.itemized ? (
              <div className="space-y-2">
                {entry.items.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={item.description}
                      onChange={(e) => {
                        const items = [...entry.items]
                        items[index] = { ...items[index], description: e.target.value }
                        patch(category.key, { items })
                      }}
                      disabled={disabled}
                      placeholder="What this covers"
                      className={cn(t.input, "flex-1")}
                    />
                    <CurrencyInput
                      value={item.amount}
                      onChange={(raw) => {
                        const items = [...entry.items]
                        items[index] = { ...items[index], amount: raw }
                        patch(category.key, { items })
                      }}
                      disabled={disabled}
                      currencySymbol={symbol}
                      className={cn(t.input, "w-36 shrink-0")}
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => patch(category.key, { items: entry.items.filter((_, i) => i !== index) })}
                      aria-label="Remove line"
                      className={cn("p-1.5 rounded-md shrink-0", t.iconBtn)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => patch(category.key, { items: [...entry.items, { description: "", amount: "" }] })}
                    className={cn("flex items-center gap-1 text-xs", t.linkish)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add a line
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setPasteOpenFor(pasteOpenFor === category.key ? null : category.key)
                      setPasteText("")
                      setPasteSkipped([])
                    }}
                    className={cn("text-xs", t.linkish)}
                  >
                    Paste from a spreadsheet
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleItemize(category.key)}
                    className={cn("text-xs ml-auto", t.linkish)}
                  >
                    Use a single subtotal
                  </button>
                </div>

                {pasteOpenFor === category.key && (
                  <div className="space-y-2">
                    <Textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={4}
                      placeholder={"Camera package\t4200\nGrip and electric\t2750"}
                      className={cn(t.input, "font-mono text-xs")}
                    />
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => applyPaste(category.key)} className={cn("text-xs", t.linkish)}>
                        Add these lines
                      </button>
                      <span className={cn("font-mono text-2xs", t.muted)}>Label, then a tab, then the amount</span>
                    </div>
                    {pasteSkipped.length > 0 && (
                      <div className="rounded-md border border-warning/50 bg-warning/10 p-2 space-y-1">
                        <div className="font-mono text-2xs uppercase tracking-wider text-warning">
                          {pasteSkipped.length} line{pasteSkipped.length === 1 ? "" : "s"} not added
                        </div>
                        {pasteSkipped.map((skip, i) => (
                          <div key={i} className={cn("text-xs", t.muted)}>
                            Line {skip.line}: {skip.reason}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className={t.label}>Subtotal</span>
                  <span className={cn("font-mono text-sm", t.total)}>{formatMoney(total ?? 0, symbol)}</span>
                </div>
                <p className={cn("font-mono text-2xs", t.muted)}>
                  Added up from the lines above. Edit a line to change it.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <CurrencyInput
                  value={entry.subtotal}
                  onChange={(raw) => patch(category.key, { subtotal: raw })}
                  disabled={disabled}
                  currencySymbol={symbol}
                  className={cn(t.input, "flex-1")}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleItemize(category.key)}
                  className={cn("text-xs shrink-0", t.linkish)}
                >
                  Itemize
                </button>
              </div>
            )}
          </div>
        )
      })}

      <div className={cn("flex items-center justify-between gap-3 p-3", t.card)}>
        <span className={t.label}>Total bid</span>
        <span className={cn("font-display font-bold text-lg", t.total)}>{formatMoney(grandTotal, symbol)}</span>
      </div>
    </div>
  )
}
