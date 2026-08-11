"use client"

import { useState } from "react"
import { Plus, Trash2, ChevronUp, ChevronDown, Scale } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { HelpTerm } from "@/components/help-term"
import { cn } from "@/lib/utils"
import {
  MAX_RFP_EVALUATION_CRITERIA,
  MIN_CRITERION_WEIGHT,
  MAX_CRITERION_WEIGHT,
  makeCriterionKey,
  resequenceCriteria,
  seedRfpEvaluationCriteria,
  type RfpEvaluationCriterion,
} from "@/lib/rfp-evaluation-criteria"

/**
 * Per-RFP evaluation criteria editor (P2-3). Agency-side, dark theme, shared by the RFP
 * Broadcast wizard's Step 2 and the Lightning RFP magic-link flow.
 *
 * Visually and conceptually distinct from the business-criteria editor it sits near, on
 * purpose. Business criteria are confirmable compliance facts a vendor either holds or does
 * not, rendered as checkboxes with a required/preferred tier. Evaluation criteria are scored
 * quality dimensions the agency judges bids against, rendered as named rows with a weight.
 * The two must never read as variations of one control - the scale icon, the weight column,
 * and the explanatory line all exist to keep them apart.
 */
export function EvaluationCriteriaEditor({
  value,
  onChange,
}: {
  value: RfpEvaluationCriterion[]
  onChange: (next: RfpEvaluationCriterion[]) => void
}) {
  const [customName, setCustomName] = useState("")

  const atCap = value.length >= MAX_RFP_EVALUATION_CRITERIA
  const commit = (next: RfpEvaluationCriterion[]) => onChange(resequenceCriteria(next))

  const addCustom = () => {
    const name = customName.trim()
    if (!name || atCap) return
    if (value.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
      setCustomName("")
      return
    }
    commit([
      ...value,
      { key: makeCriterionKey(name), name, description: "", weight: 1.0, origin: "custom", sort_order: value.length },
    ])
    setCustomName("")
  }

  const patch = (key: string, changes: Partial<RfpEvaluationCriterion>) =>
    commit(value.map((c) => (c.key === key ? { ...c, ...changes } : c)))

  const move = (key: string, direction: -1 | 1) => {
    const index = value.findIndex((c) => c.key === key)
    const target = index + direction
    if (index < 0 || target < 0 || target >= value.length) return
    const next = [...value]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    commit(next)
  }

  return (
    <div className="space-y-5">
      {value.length === 0 ? (
        <div className="rounded-lg border border-border bg-white/5 p-4 space-y-3">
          <p className="text-sm text-foreground-muted">
            This RFP will be scored against your standard evaluation criteria, the same seven dimensions every other
            RFP uses. Load them here to change them for this RFP only.
          </p>
          <Button type="button" size="sm" onClick={() => commit(seedRfpEvaluationCriteria())}>
            Load the standard criteria
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
              {value.length} of {MAX_RFP_EVALUATION_CRITERIA}
            </div>
            <button
              type="button"
              onClick={() => commit([])}
              className="font-mono text-2xs text-foreground-muted hover:text-foreground underline decoration-dotted underline-offset-4"
            >
              Use my standard criteria instead
            </button>
          </div>

          {value.map((criterion, index) => (
            <div key={criterion.key} className="rounded-lg border border-border bg-white/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-foreground-muted shrink-0" />
                <Input
                  value={criterion.name}
                  onChange={(e) => patch(criterion.key, { name: e.target.value })}
                  className="bg-background border-border text-foreground"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <label className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Weight</label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={MIN_CRITERION_WEIGHT}
                    max={MAX_CRITERION_WEIGHT}
                    step={0.5}
                    value={criterion.weight}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value)
                      patch(criterion.key, {
                        weight: Number.isFinite(n)
                          ? Math.min(MAX_CRITERION_WEIGHT, Math.max(MIN_CRITERION_WEIGHT, n))
                          : 1.0,
                      })
                    }}
                    className="bg-background border-border text-foreground w-20"
                  />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => move(criterion.key, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${criterion.name} up`}
                    className="p-1.5 rounded-md text-foreground-muted hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(criterion.key, 1)}
                    disabled={index === value.length - 1}
                    aria-label={`Move ${criterion.name} down`}
                    className="p-1.5 rounded-md text-foreground-muted hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => commit(value.filter((c) => c.key !== criterion.key))}
                    aria-label={`Remove ${criterion.name}`}
                    className="p-1.5 rounded-md text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <Textarea
                rows={2}
                value={criterion.description}
                onChange={(e) => patch(criterion.key, { description: e.target.value })}
                placeholder="What a strong bid looks like on this dimension"
                className="bg-background border-border text-foreground text-xs"
              />
            </div>
          ))}

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
              disabled={atCap}
              placeholder={atCap ? "Eight is the most this stays readable at" : "Add a criterion of your own"}
              className={cn("bg-background border-border text-foreground", atCap && "opacity-60")}
            />
            <Button type="button" onClick={addCustom} disabled={atCap || !customName.trim()} className="shrink-0">
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
          {atCap && (
            <p className="font-mono text-2xs text-foreground-muted">
              Remove one to add another. Past eight dimensions, scores stop discriminating between bids.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-foreground-muted">
        <HelpTerm term="evaluation_criteria">Evaluation criteria</HelpTerm> are the quality dimensions you score bids
        against, each out of 10 and weighted. They are not business criteria: those are compliance facts a vendor
        either holds or does not, and they live in their own section above.
      </p>
    </div>
  )
}
