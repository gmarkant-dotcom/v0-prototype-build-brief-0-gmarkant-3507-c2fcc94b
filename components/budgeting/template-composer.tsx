"use client"

import { useMemo, useState } from "react"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FeeCostBadge, selectClass } from "./budget-states"
import { STARTER_TEMPLATES, categoryNameKey, type StarterTemplate } from "@/lib/budget/starter-templates"
import { budgetFetch, budgetPost, errorMessage } from "@/lib/budget/client-api"
import type { FeeOrCost, TemplateCategory } from "@/lib/server/budget/schema"

/**
 * THE COMPOSITION STEP (spec Q10; spec 5b: the chart is the accuracy lever).
 *   1 choose   one or more starters from the library (lib/budget/starter-templates.ts)
 *   2 pick     check-mark the categories wanted; adjust fee or cost; names already in the agency
 *              template (live or archived) are shown and cannot be picked again
 *   3 preview  what will be added
 *   4 write    one POST per category to the gated templates route, re-checking duplicates by name
 *              against a fresh read first, with a per-category result
 */

type Candidate = { key: string; name: string; feeOrCost: FeeOrCost; note?: string; from: string[] }

type Result = { name: string; outcome: "added" | "skipped" | "failed"; detail?: string }

export function TemplateComposer({ existing, onDone }: { existing: TemplateCategory[]; onDone: () => void }) {
  const [step, setStep] = useState<"choose" | "pick" | "preview" | "writing" | "done">("choose")
  const [starters, setStarters] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Map<string, FeeOrCost>>(new Map())
  const [results, setResults] = useState<Result[]>([])
  const [progress, setProgress] = useState(0)

  const existingByKey = useMemo(() => new Map(existing.map((c) => [categoryNameKey(c.name), c])), [existing])

  const candidates = useMemo(() => {
    const m = new Map<string, Candidate>()
    for (const t of STARTER_TEMPLATES) {
      if (!starters.has(t.slug)) continue
      for (const c of t.categories) {
        const key = categoryNameKey(c.name)
        const cur = m.get(key)
        if (cur) cur.from.push(t.name)
        else m.set(key, { key, name: c.name, feeOrCost: c.feeOrCost, note: c.note, from: [t.name] })
      }
    }
    return Array.from(m.values())
  }, [starters])

  function toggleStarter(t: StarterTemplate) {
    setStarters((prev) => {
      const next = new Set(prev)
      if (next.has(t.slug)) next.delete(t.slug)
      else next.add(t.slug)
      return next
    })
  }

  function goPick() {
    // Pre-check everything new; leave existing names unchecked (they are skipped anyway).
    const next = new Map<string, FeeOrCost>()
    for (const c of candidates) if (!existingByKey.has(c.key)) next.set(c.key, c.feeOrCost)
    setPicked(next)
    setStep("pick")
  }

  function togglePick(c: Candidate, on: boolean) {
    setPicked((prev) => {
      const next = new Map(prev)
      if (on) next.set(c.key, prev.get(c.key) ?? c.feeOrCost)
      else next.delete(c.key)
      return next
    })
  }

  const chosen = candidates.filter((c) => picked.has(c.key))

  async function write() {
    setStep("writing")
    setProgress(0)
    const out: Result[] = []
    let fresh: Map<string, TemplateCategory>
    try {
      const res = await budgetFetch<{ categories: TemplateCategory[] }>("/api/agency/budget/templates?include_archived=1")
      fresh = new Map(res.categories.map((c) => [categoryNameKey(c.name), c]))
    } catch (e) {
      setResults([{ name: "Agency template", outcome: "failed", detail: `Could not read the template first: ${errorMessage(e)}. Nothing was added.` }])
      setStep("done")
      return
    }
    for (const c of chosen) {
      const dup = fresh.get(c.key)
      if (dup) {
        out.push({ name: c.name, outcome: "skipped", detail: dup.archived_at ? "Already in the template, archived" : "Already in the template" })
      } else {
        try {
          const res = await budgetPost<{ category: TemplateCategory }>("/api/agency/budget/templates", { name: c.name, feeOrCost: picked.get(c.key) })
          fresh.set(c.key, res.category)
          out.push({ name: c.name, outcome: "added" })
        } catch (e) {
          out.push({ name: c.name, outcome: "failed", detail: errorMessage(e) })
        }
      }
      setProgress(out.length)
    }
    setResults(out)
    setStep("done")
    onDone()
  }

  const added = results.filter((r) => r.outcome === "added").length
  const skipped = results.filter((r) => r.outcome === "skipped")
  const failed = results.filter((r) => r.outcome === "failed")

  return (
    <section className="rounded-lg border border-border bg-white/5 p-5 space-y-5">
      <div>
        <h2 className="font-display font-bold text-xl text-foreground">Compose from starters</h2>
        <p className="text-sm text-foreground-muted mt-1">
          Pick the kinds of work your agency does, check the categories you want, and add them to your template. Names already in your template are
          skipped.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 font-mono text-2xs uppercase tracking-wider">
        {(["choose", "pick", "preview"] as const).map((s, i) => (
          <li
            key={s}
            className={`rounded-full border px-3 py-1 ${step === s ? "border-accent bg-accent/10 text-accent" : "border-border text-foreground-muted"}`}
          >
            {i + 1} {s === "choose" ? "Starters" : s === "pick" ? "Categories" : "Preview"}
          </li>
        ))}
      </ol>

      {step === "choose" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {STARTER_TEMPLATES.map((t) => {
              const on = starters.has(t.slug)
              return (
                <button
                  type="button"
                  key={t.slug}
                  onClick={() => toggleStarter(t)}
                  aria-pressed={on}
                  className={`text-left rounded-lg border p-4 transition-colors ${on ? "border-accent/60 bg-accent/10" : "border-border hover:bg-white/5"}`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${on ? "border-accent bg-accent text-accent-foreground" : "border-border"}`}
                    >
                      {on ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <div>
                      <div className="font-bold text-foreground">{t.name}</div>
                      <div className="text-xs text-foreground-muted mt-0.5">{t.description}</div>
                      <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted mt-1">
                        {t.categories.length} categories · {t.categories.filter((c) => c.feeOrCost === "fee").length} fee
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          <Button className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono" disabled={starters.size === 0} onClick={goPick}>
            Choose categories
          </Button>
        </>
      ) : null}

      {step === "pick" ? (
        <>
          <div className="flex flex-wrap items-center gap-3 font-mono text-2xs uppercase tracking-wider text-foreground-muted">
            {chosen.length} of {candidates.length} checked
            <button type="button" className="text-accent hover:underline" onClick={() => goPick()}>
              Check all new
            </button>
            <button type="button" className="text-accent hover:underline" onClick={() => setPicked(new Map())}>
              Clear
            </button>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {candidates.map((c) => {
              const dup = existingByKey.get(c.key)
              const on = picked.has(c.key)
              return (
                <li key={c.key} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${dup ? "opacity-60" : ""}`}>
                  <Checkbox
                    checked={on}
                    disabled={Boolean(dup)}
                    onCheckedChange={(v) => togglePick(c, v === true)}
                    aria-label={c.name}
                    className="data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                  />
                  <div className="flex-1 min-w-[12rem]">
                    <div className="text-sm text-foreground">{c.name}</div>
                    <div className="font-mono text-2xs text-foreground-muted">
                      {dup ? (dup.archived_at ? "Already in your template, archived" : "Already in your template") : c.from.join(" · ")}
                      {c.note ? ` · ${c.note}` : ""}
                    </div>
                  </div>
                  {dup ? (
                    <FeeCostBadge value={dup.fee_or_cost} />
                  ) : (
                    <select
                      aria-label={`Fee or cost for ${c.name}`}
                      className={`${selectClass} h-8`}
                      value={picked.get(c.key) ?? c.feeOrCost}
                      disabled={!on}
                      onChange={(e) => setPicked((prev) => new Map(prev).set(c.key, e.target.value as FeeOrCost))}
                    >
                      <option value="fee">Fee</option>
                      <option value="cost">Cost</option>
                    </select>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="flex gap-2">
            <Button variant="outline" className="border-border" onClick={() => setStep("choose")}>
              Back
            </Button>
            <Button className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono" disabled={chosen.length === 0} onClick={() => setStep("preview")}>
              Preview
            </Button>
          </div>
        </>
      ) : null}

      {step === "preview" ? (
        <>
          <p className="text-sm text-foreground">
            {chosen.length} {chosen.length === 1 ? "category" : "categories"} will be added to your agency template:{" "}
            {chosen.filter((c) => picked.get(c.key) === "fee").length} fee, {chosen.filter((c) => picked.get(c.key) === "cost").length} cost. Existing
            projects are not changed; new budgets start from the template.
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {chosen.map((c) => (
              <li key={c.key} className="flex items-center gap-2 text-sm text-foreground">
                <FeeCostBadge value={picked.get(c.key) ?? c.feeOrCost} /> {c.name}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button variant="outline" className="border-border" onClick={() => setStep("pick")}>
              Back
            </Button>
            <Button className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono" onClick={write}>
              Add {chosen.length} to template
            </Button>
          </div>
        </>
      ) : null}

      {step === "writing" ? (
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-accent" /> Adding {progress} of {chosen.length}
        </p>
      ) : null}

      {step === "done" ? (
        <div className="space-y-3">
          <p className="font-display font-bold text-lg text-foreground">
            {added} added{skipped.length ? `, ${skipped.length} skipped` : ""}
            {failed.length ? `, ${failed.length} failed` : ""}
          </p>
          {[...skipped, ...failed].length > 0 ? (
            <ul className="space-y-1 text-sm">
              {[...failed, ...skipped].map((r) => (
                <li key={`${r.outcome}:${r.name}`} className={r.outcome === "failed" ? "text-destructive" : "text-foreground-muted"}>
                  {r.name}: {r.detail}
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            variant="outline"
            className="border-border"
            onClick={() => {
              setStarters(new Set())
              setPicked(new Map())
              setResults([])
              setStep("choose")
            }}
          >
            Compose more
          </Button>
        </div>
      ) : null}
    </section>
  )
}
