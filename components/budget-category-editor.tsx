"use client"

import { useState } from "react"
import { Plus, Trash2, ChevronUp, ChevronDown, AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { HelpTerm } from "@/components/help-term"
import { cn } from "@/lib/utils"
import { MOMENTARY_ACTION_DARK, TOGGLE_CONTROL_DARK } from "@/lib/interactive-styles"
import {
  PRESET_BUNDLES,
  ADDITIONAL_ITEMS_NAME,
  BUDGET_CATEGORY_SOFT_MIN,
  BUDGET_CATEGORY_SOFT_MAX,
  ensureAdditionalItems,
  makeCategoryKey,
  parseCategoryPaste,
  resequence,
  type BudgetCategory,
  type ParseSkip,
} from "@/lib/budget-categories"

/**
 * Agency-side budget category builder (P2-1). Shared by the RFP Broadcast wizard's Step 2 and
 * the Lightning RFP magic-link flow, exactly as business-criteria-editor.tsx is - presentation
 * only, state ownership stays with each caller.
 *
 * Dark theme only: both callers are agency-portal surfaces. The vendor-facing half of this
 * feature is components/bid-budget-categories.tsx, which is theme-aware because its two
 * callers sit on opposite sides of the two-atmospheres rule.
 *
 * Interaction pattern is the existing wizard one - a space-y-3 list of bordered rows with
 * add/remove controls - not a new one.
 */
export function BudgetCategoryEditor({
  value,
  onChange,
}: {
  value: BudgetCategory[]
  onChange: (next: BudgetCategory[]) => void
}) {
  const [customName, setCustomName] = useState("")
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [pasteSkipped, setPasteSkipped] = useState<ParseSkip[]>([])

  const editable = value.filter((c) => !c.is_additional_items)
  const additional = value.find((c) => c.is_additional_items) ?? null
  const countLabel = editable.length === 1 ? "1 category" : `${editable.length} categories`

  const commit = (next: BudgetCategory[]) => {
    onChange(next.length === 0 ? [] : resequence(ensureAdditionalItems(next)))
  }

  const addBundle = (slug: string) => {
    const bundle = PRESET_BUNDLES.find((b) => b.slug === slug)
    if (!bundle) return
    const existingNames = new Set(value.map((c) => c.name.trim().toLowerCase()))
    const added = bundle.categories
      .filter((c) => !existingNames.has(c.name.trim().toLowerCase()))
      .map((c, i) => ({
        key: makeCategoryKey(c.name),
        name: c.name,
        note: c.note ?? null,
        origin: `preset:${bundle.slug}:${c.slug}`,
        is_additional_items: false,
        sort_order: editable.length + i,
      }))
    if (added.length === 0) return
    commit([...editable, ...added, ...(additional ? [additional] : [])])
  }

  const addCustom = () => {
    const name = customName.trim()
    if (!name) return
    if (value.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
      setCustomName("")
      return
    }
    commit([
      ...editable,
      {
        key: makeCategoryKey(name),
        name,
        note: null,
        origin: "custom",
        is_additional_items: false,
        sort_order: editable.length,
      },
      ...(additional ? [additional] : []),
    ])
    setCustomName("")
  }

  const applyPaste = () => {
    const { categories, skipped } = parseCategoryPaste(pasteText)
    const existingNames = new Set(value.map((c) => c.name.trim().toLowerCase()))
    const fresh = categories.filter((c) => !existingNames.has(c.name.trim().toLowerCase()))
    const alreadyThere = categories.length - fresh.length
    const allSkips = [
      ...skipped,
      ...(alreadyThere > 0
        ? [{ line: 0, text: `${alreadyThere} line${alreadyThere === 1 ? "" : "s"}`, reason: "Already a category on this RFP" }]
        : []),
    ]
    setPasteSkipped(allSkips)
    if (fresh.length > 0) {
      commit([...editable, ...fresh.map((c, i) => ({ ...c, sort_order: editable.length + i })), ...(additional ? [additional] : [])])
      setPasteText("")
    }
  }

  const patch = (key: string, changes: Partial<BudgetCategory>) => {
    commit(value.map((c) => (c.key === key ? { ...c, ...changes } : c)).filter((c) => !c.is_additional_items))
  }

  const remove = (key: string) => {
    const next = editable.filter((c) => c.key !== key)
    // Removing the last real category removes the whole structure, Additional items included -
    // an RFP with only "Additional items" is not a categorized budget, it is a single number
    // wearing a category's clothes.
    commit(next)
  }

  const move = (key: string, direction: -1 | 1) => {
    const index = editable.findIndex((c) => c.key === key)
    const target = index + direction
    if (index < 0 || target < 0 || target >= editable.length) return
    const next = [...editable]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    commit([...next.map((c, i) => ({ ...c, sort_order: i })), ...(additional ? [additional] : [])])
  }

  return (
    <div className="space-y-5">
      {/* Seeding */}
      <div className="space-y-3">
        <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Start from a preset</div>
        {/* Q2: the three presets are momentary. They ADD categories, they are not modes - no
            aria-pressed, no persistent styling, a brief :active press that releases, and hover
            behind @media (hover:hover) so a tap on a touch device cannot latch it. */}
        <div className="flex flex-wrap gap-2">
          {PRESET_BUNDLES.map((bundle) => (
            <button
              key={bundle.slug}
              type="button"
              onClick={() => addBundle(bundle.slug)}
              title={bundle.description}
              className={cn(
                "px-3 py-1.5 rounded-md border border-border bg-white/5 text-foreground text-sm",
                MOMENTARY_ACTION_DARK
              )}
            >
              {bundle.label}
            </button>
          ))}
          {/* Q2: this one IS a toggle - it opens and closes the paste panel - so persistent
              active styling is correct and stays. aria-expanded makes that state real rather
              than only visual. */}
          <button
            type="button"
            onClick={() => setPasteOpen((o) => !o)}
            aria-expanded={pasteOpen}
            className={cn(
              "px-3 py-1.5 rounded-md border text-sm",
              TOGGLE_CONTROL_DARK,
              pasteOpen
                ? "border-accent/40 bg-accent/10 text-foreground"
                : cn("border-border bg-white/5 text-foreground", MOMENTARY_ACTION_DARK)
            )}
          >
            Paste a list
          </button>
        </div>
        <p className="text-xs text-foreground-muted">
          Presets add to what is already here, they never replace it. Adding a preset twice adds nothing new.
        </p>
      </div>

      {pasteOpen && (
        <div className="rounded-lg border border-border bg-white/5 p-4 space-y-3">
          <div>
            <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
              Paste two columns: category name, then an optional note
            </label>
            <p className="text-xs text-foreground-muted mt-1">
              Copy straight out of a spreadsheet, or paste CSV rows. One category per line. Lines we cannot read are
              listed back rather than dropped silently.
            </p>
          </div>
          <Textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            placeholder={"Production\tCrew, kit, and shoot days\nPost-production\tEdit, grade, sound\nTravel and per diem"}
            className="bg-background border-border text-foreground font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={applyPaste} disabled={!pasteText.trim()}>
              Add these categories
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setPasteText("")
                setPasteSkipped([])
              }}
              className="border-border text-foreground hover:bg-white/5"
            >
              Clear
            </Button>
          </div>
          {pasteSkipped.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-1">
              <div className="font-mono text-2xs uppercase tracking-wider text-warning">
                {pasteSkipped.length} line{pasteSkipped.length === 1 ? "" : "s"} not added
              </div>
              {pasteSkipped.map((skip, i) => (
                <div key={i} className="text-xs text-foreground-muted">
                  {skip.line > 0 ? `Line ${skip.line}: ` : ""}
                  <span className="text-foreground">{skip.text}</span> - {skip.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Custom add */}
      <div className="flex gap-2">
        <Input
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addCustom()
            }
          }}
          placeholder="Add a category of your own"
          className="bg-background border-border text-foreground"
        />
        <Button type="button" onClick={addCustom} disabled={!customName.trim()} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" />
          Add
        </Button>
      </div>

      {/* List */}
      {editable.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No budget categories yet. Vendors will bid one total figure, exactly as they do today.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">{countLabel}</div>
            {editable.length > BUDGET_CATEGORY_SOFT_MAX && (
              <div className="font-mono text-2xs text-warning">
                {BUDGET_CATEGORY_SOFT_MIN} to {BUDGET_CATEGORY_SOFT_MAX} usually reads best
              </div>
            )}
          </div>

          {editable.map((category, index) => (
            <div key={category.key} className="rounded-lg border border-border bg-white/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={category.name}
                  onChange={(e) => patch(category.key, { name: e.target.value })}
                  className="bg-background border-border text-foreground"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(category.key, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${category.name} up`}
                    className={cn("p-1.5 rounded-md text-foreground-muted disabled:opacity-30", MOMENTARY_ACTION_DARK)}
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(category.key, 1)}
                    disabled={index === editable.length - 1}
                    aria-label={`Move ${category.name} down`}
                    className={cn("p-1.5 rounded-md text-foreground-muted disabled:opacity-30", MOMENTARY_ACTION_DARK)}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(category.key)}
                    aria-label={`Remove ${category.name}`}
                    className={cn("p-1.5 rounded-md text-destructive [@media(hover:hover)]:hover:bg-destructive/10 active:bg-destructive/20 outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 transition-colors")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <Input
                value={category.note ?? ""}
                onChange={(e) => patch(category.key, { note: e.target.value })}
                placeholder="Optional guidance for bidders"
                className="bg-background border-border text-foreground text-xs"
              />
            </div>
          ))}

          {additional && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                <span className="font-display font-bold text-sm text-foreground">{ADDITIONAL_ITEMS_NAME}</span>
                <span className="font-mono text-2xs uppercase tracking-wider text-warning ml-auto">Always included</span>
              </div>
              <p className="text-xs text-foreground-muted mt-1.5">
                Every categorized budget carries this one so a vendor always has somewhere honest to put what your
                categories missed. It cannot be renamed or removed.
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-foreground-muted">
        <HelpTerm term="budget_category">Budget categories</HelpTerm> ask every bidder for the same breakdown, so
        you can compare them line by line instead of comparing one total against another. Leave this empty and bidding
        works exactly as it does today.
      </p>
    </div>
  )
}
