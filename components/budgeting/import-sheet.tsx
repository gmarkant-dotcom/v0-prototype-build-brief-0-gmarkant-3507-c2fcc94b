"use client"

import { useMemo, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { KindChip, labelClass, selectClass } from "./budget-states"
import {
  EMPTY_MAPPING,
  IMPORT_MAX_ROWS,
  buildReviewRows,
  guessMapping,
  mappingReady,
  readImportFile,
  rowAmountBody,
  rowProblem,
  type ColumnMapping,
  type ParsedImportFile,
  type ReviewRow,
} from "@/lib/budget/import"
import { BudgetApiError, budgetPost, errorMessage, projectBase } from "@/lib/budget/client-api"
import { centsToDecimalString, formatCents } from "@/lib/budget/money"
import { formatMilli } from "@/lib/budget/line-math"
import { categoryNameKey } from "@/lib/budget/starter-templates"
import type { FeeOrCost, ProjectCategory } from "@/lib/server/budget/schema"

/**
 * U3, BUDGET IMPORT. Every step runs in the browser:
 *   1 file      CSV or .xlsx, at most 5 MB and 2,000 rows (lib/budget/import.ts)
 *   2 mapping   description, amount, optional category and fee-or-cost columns, and optional
 *               quantity, rate, multiplier and unit (a row with a rate imports as
 *               qty x rate x multiplier; with rate mapped the amount column is optional)
 *   3 review    per row: category (existing or new), fee or cost, include or exclude;
 *               optional AI suggestions through the gated suggest-categories route
 *   4 import    new categories first, then lines in file order, one request each, with a
 *               per-row result. A failure is shown against its row; nothing fails silently.
 */

type Step = "file" | "mapping" | "review" | "importing" | "done"

type RowResult = { index: number; ok: boolean; message: string }

const AI_BATCH_ROWS = 200
const AI_BATCH_CHARS = 18_000 // under the route's 20,000 including category names and JSON overhead
const PAGE = 100

/** A new category is created once with one flag: every row naming it takes the first row's flag. */
function sameFlagPerNewCategory(rows: ReviewRow[]): ReviewRow[] {
  const first = new Map<string, FeeOrCost | null>()
  for (const r of rows) {
    if (r.target?.kind !== "new") continue
    const key = categoryNameKey(r.target.name)
    if (!first.has(key) || (first.get(key) === null && r.feeOrCost)) first.set(key, r.feeOrCost)
  }
  return rows.map((r) => (r.target?.kind === "new" ? { ...r, feeOrCost: first.get(categoryNameKey(r.target.name)) ?? r.feeOrCost } : r))
}

export function ImportSheet({
  projectId,
  categories,
  lineMath,
  lineKind,
  open,
  onOpenChange,
  onFinished,
}: {
  projectId: string
  categories: ProjectCategory[]
  /** 116 applied. Before it, a rate still sets each line's total, but the breakdown is not kept. */
  lineMath: boolean
  /** 117 applied. Before it the Kind column is not offered and every line inherits its category. */
  lineKind: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onFinished: () => void
}) {
  const [step, setStep] = useState<Step>("file")
  const [headersRow, setHeadersRow] = useState(true)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [parsed, setParsed] = useState<(ParsedImportFile & { fileName: string }) | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING)
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [page, setPage] = useState(0)
  const [aiState, setAiState] = useState<{ status: "idle" | "running" | "done" | "unavailable"; text?: string }>({ status: "idle" })
  const [suggested, setSuggested] = useState<Set<number>>(new Set())
  const [results, setResults] = useState<RowResult[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const liveById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const liveByKey = useMemo(() => new Map(categories.map((c) => [categoryNameKey(c.name), c])), [categories])

  async function onFile(file: File | undefined) {
    if (!file) return
    setFileError(null)
    setReading(true)
    const res = await readImportFile(file, headersRow)
    setReading(false)
    if (!res.ok) {
      setFileError(res.message)
      return
    }
    setParsed({ ...res.file, fileName: file.name })
    const guessed = guessMapping(res.file.headers)
    setMapping(lineKind ? guessed : { ...guessed, kind: null })
    setStep("mapping")
  }

  function toReview() {
    if (!parsed || !mappingReady(mapping)) return
    setRows(sameFlagPerNewCategory(buildReviewRows(parsed.rows, mapping, categories)))
    setSuggested(new Set())
    setPage(0)
    setStep("review")
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((prev) => {
      const next = prev.map((r) => (r.index === index ? { ...r, ...patch } : r))
      // A new category's flag is the category's, so every row naming it agrees.
      const changed = next.find((r) => r.index === index)
      if (changed && patch.feeOrCost !== undefined && changed.target?.kind === "new") {
        const key = categoryNameKey(changed.target.name)
        return next.map((r) => (r.target?.kind === "new" && categoryNameKey(r.target.name) === key ? { ...r, feeOrCost: patch.feeOrCost ?? null } : r))
      }
      return next
    })
  }

  function setTarget(row: ReviewRow, value: string) {
    if (value === "") return updateRow(row.index, { target: null })
    if (value.startsWith("existing:")) {
      const c = liveById.get(value.slice(9))
      if (c) updateRow(row.index, { target: { kind: "existing", categoryId: c.id }, feeOrCost: c.fee_or_cost })
      return
    }
    if (value === "new:source") return updateRow(row.index, { target: { kind: "new", name: row.sourceCategory }, feeOrCost: flagForNew(row.sourceCategory) ?? row.feeOrCost })
    if (value === "new:custom") return updateRow(row.index, { target: { kind: "new", name: "" }, feeOrCost: row.feeOrCost })
  }

  /** The flag already chosen for another row creating the same new category, if any. */
  function flagForNew(name: string): FeeOrCost | null {
    const key = categoryNameKey(name)
    return rows.find((r) => r.target?.kind === "new" && categoryNameKey(r.target.name) === key && r.feeOrCost)?.feeOrCost ?? null
  }

  async function suggest() {
    const candidates = rows.filter((r) => r.include && r.description && r.amountCents !== null)
    if (candidates.length === 0) return
    setAiState({ status: "running" })
    const batches: ReviewRow[][] = []
    let current: ReviewRow[] = []
    let chars = 0
    for (const r of candidates) {
      const size = r.description.length + 40
      if (current.length >= AI_BATCH_ROWS || chars + size > AI_BATCH_CHARS) {
        batches.push(current)
        current = []
        chars = 0
      }
      current.push(r)
      chars += size
    }
    if (current.length) batches.push(current)

    let discarded = 0
    const touched = new Set<number>()
    // Suggestions are applied to a working copy, so the table cannot change underneath them.
    let working = rows
    try {
      for (const batch of batches) {
        const res = await budgetPost<{
          suggestions: Array<{ index: number; feeOrCost: FeeOrCost; category: { kind: "existing"; id: string; name: string } | { kind: "new"; name: string } }>
          discarded: number
          unanswered: number
        }>(`${projectBase(projectId)}/suggest-categories`, {
          rows: batch.map((r) => ({ index: r.index, description: r.description, amount: centsToDecimalString(r.amountCents ?? 0) })),
        })
        discarded += res.unanswered
        const byIndex = new Map(res.suggestions.map((s) => [s.index, s]))
        working = working.map((r) => {
          const s = byIndex.get(r.index)
          if (!s) return r
          // A suggestion fills rows the user has not already pointed at an existing category.
          if (r.target?.kind === "existing") return r
          const existing = s.category.kind === "existing" ? liveById.get(s.category.id) : undefined
          if (existing) {
            touched.add(r.index)
            return { ...r, target: { kind: "existing" as const, categoryId: existing.id }, feeOrCost: existing.fee_or_cost }
          }
          if (s.category.kind === "new") {
            touched.add(r.index)
            return { ...r, target: { kind: "new" as const, name: s.category.name }, feeOrCost: s.feeOrCost }
          }
          return r
        })
        working = sameFlagPerNewCategory(working)
        setRows(working)
      }
      setSuggested((prev) => new Set([...prev, ...touched]))
      setAiState({
        status: "done",
        text: `Suggestions applied. Review them before importing.${discarded ? ` ${discarded} ${discarded === 1 ? "row was" : "rows were"} left for you to choose.` : ""}`,
      })
    } catch (e) {
      const unavailable = e instanceof BudgetApiError && (e.status === 403 || e.status === 503 || e.status === 402)
      setAiState({
        status: unavailable ? "unavailable" : "done",
        text: unavailable ? "AI suggestions are not available. Choose categories by hand; the import works the same." : `Suggestions stopped: ${errorMessage(e)}`,
      })
    }
  }

  const included = rows.filter((r) => r.include)
  const problems = included.filter((r) => rowProblem(r) !== null)
  const newCategoryNames = (() => {
    const m = new Map<string, { name: string; feeOrCost: FeeOrCost | null }>()
    for (const r of included) {
      if (r.target?.kind !== "new" || !r.target.name.trim()) continue
      const key = categoryNameKey(r.target.name)
      if (liveByKey.has(key)) continue
      if (!m.has(key)) m.set(key, { name: r.target.name.trim(), feeOrCost: r.feeOrCost })
    }
    return Array.from(m.values())
  })()

  async function runImport() {
    if (problems.length > 0 || included.length === 0) return
    setStep("importing")
    const out: RowResult[] = []
    const createdIds = new Map<string, string>()
    const createErrors = new Map<string, string>()
    const total = newCategoryNames.length + included.length
    let done = 0
    setProgress({ done, total })

    // 1. New categories, once each, in first-appearance order.
    for (const c of newCategoryNames) {
      try {
        const res = await budgetPost<{ category: ProjectCategory }>(`${projectBase(projectId)}/chart`, { action: "add", name: c.name, feeOrCost: c.feeOrCost })
        createdIds.set(categoryNameKey(c.name), res.category.id)
      } catch (e) {
        createErrors.set(categoryNameKey(c.name), errorMessage(e))
      }
      done += 1
      setProgress({ done, total })
    }

    // 2. Lines, in file order.
    for (const r of included) {
      let categoryId: string | undefined
      if (r.target?.kind === "existing") categoryId = r.target.categoryId
      else if (r.target?.kind === "new") {
        const key = categoryNameKey(r.target.name)
        categoryId = liveByKey.get(key)?.id ?? createdIds.get(key)
        const createError = createErrors.get(key)
        if (!categoryId) {
          out.push({ index: r.index, ok: false, message: `Category "${r.target.name}" was not created${createError ? `: ${createError}` : ""}` })
          done += 1
          setProgress({ done, total })
          continue
        }
      }
      try {
        await budgetPost(`${projectBase(projectId)}/lines`, {
          categoryId,
          name: r.description,
          ...rowAmountBody(r),
          // 117: a Kind cell sets the line's own fee or cost; an empty one leaves it inheriting.
          ...(lineKind && r.kind ? { kind: r.kind } : {}),
        })
        out.push({ index: r.index, ok: true, message: "Imported" })
      } catch (e) {
        out.push({ index: r.index, ok: false, message: errorMessage(e) })
      }
      done += 1
      setProgress({ done, total })
    }
    setResults(out)
    setStep("done")
    onFinished()
  }

  const showKind = lineKind && mapping.kind !== null
  const okCount = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE))

  const colOptions = (parsed?.headers ?? []).map((h, i) => (
    <option key={i} value={i}>
      {h}
    </option>
  ))

  return (
    <Sheet open={open} onOpenChange={(o) => step !== "importing" && onOpenChange(o)}>
      <SheetContent side="right" className="bg-background border-border w-full sm:max-w-5xl overflow-y-auto p-6">
        <SheetHeader className="p-0">
          <SheetTitle className="font-display font-bold text-2xl text-foreground">Import budget</SheetTitle>
          <SheetDescription className="text-sm text-foreground-muted">
            Read in your browser; the file is never uploaded. CSV or Excel, up to 5 MB and {IMPORT_MAX_ROWS.toLocaleString("en-US")} rows.
          </SheetDescription>
        </SheetHeader>

        {step === "file" ? (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                checked={headersRow}
                onCheckedChange={(v) => setHeadersRow(v === true)}
                className="data-[state=checked]:bg-accent data-[state=checked]:border-accent"
              />
              The first row holds column names
            </label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-transparent file:px-3 file:py-1.5 file:text-foreground"
              disabled={reading}
            />
            {reading ? (
              <p className="flex items-center gap-2 text-sm text-foreground-muted">
                <Loader2 className="w-4 h-4 animate-spin text-accent" /> Reading file
              </p>
            ) : null}
            {fileError ? <p className="text-sm text-destructive">{fileError}</p> : null}
          </div>
        ) : null}

        {step === "mapping" && parsed ? (
          <div className="space-y-5">
            <p className="text-sm text-foreground-muted">
              {parsed.fileName}: {parsed.rows.length} {parsed.rows.length === 1 ? "row" : "rows"}.
              {parsed.ignoredSheetNames.length ? ` Only the first sheet is read; ignored: ${parsed.ignoredSheetNames.join(", ")}.` : ""}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["description", "Description (required)"],
                  ["amount", mapping.rate === null ? "Amount (required)" : "Amount (optional with a rate)"],
                  ["category", "Category (optional)"],
                  ["feeOrCost", "Category fee or cost (optional)"],
                  ["quantity", "Quantity (optional)"],
                  ["rate", "Rate (optional)"],
                  ["multiplier", "Multiplier, x (optional)"],
                  ["unit", "Unit (optional)"],
                  ["kind", "Kind, per line: fee or cost (optional)"],
                ] as const
              )
                .filter(([key]) => key !== "kind" || lineKind)
                .map(([key, label]) => (
                <div key={key}>
                  <label className={labelClass}>{label}</label>
                  <select
                    aria-label={label}
                    className={`${selectClass} w-full`}
                    value={mapping[key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value === "" ? null : Number(e.target.value) }))}
                  >
                    <option value="">{key === "description" || (key === "amount" && mapping.rate === null) ? "Choose a column" : "None"}</option>
                    {colOptions}
                  </select>
                </div>
              ))}
            </div>
            <p className="text-xs text-foreground-muted">
              Amounts may include currency symbols and thousands separators ($1,250.00). A dot is the decimal point. Negative amounts and (bracketed)
              amounts are credits. More than two decimals is refused, not rounded.
            </p>
            <p className="text-xs text-foreground-muted">
              A row with a rate becomes Qty x Rate x multiplier, rounded to the cent (an empty Qty or x counts as 1); its amount cell is not used.
              Quantity and multiplier take up to three decimals and must be above 0. A unit is up to 24 characters. Rows without a rate use the
              amount.
              {lineMath ? "" : " Line math is not enabled yet for this workspace: each total is computed and saved, but the quantity, rate and multiplier are not kept."}
            </p>
            {lineKind ? (
              <p className="text-xs text-foreground-muted">
                Category fee or cost marks a new category. Kind marks the line itself: fee or cost (any capitalisation) sets that line apart from its
                category; an empty cell follows the category. Any other value excludes the row and says why.
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {parsed.headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 3).map((r, ri) => (
                    <tr key={ri} className="border-t border-border">
                      {parsed.headers.map((_, ci) => (
                        <td key={ci} className="px-3 py-2 text-foreground-muted truncate max-w-[12rem]">
                          {r[ci]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="border-border" onClick={() => setStep("file")}>
                Back
              </Button>
              <Button
                className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
                disabled={!mappingReady(mapping)}
                onClick={toReview}
              >
                Review rows
              </Button>
            </div>
          </div>
        ) : null}

        {step === "review" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                {included.length} of {rows.length} rows included · {problems.length} need attention · {newCategoryNames.length} new{" "}
                {newCategoryNames.length === 1 ? "category" : "categories"}
              </span>
              {aiState.status !== "unavailable" ? (
                <Button variant="outline" size="sm" className="border-border font-mono ml-auto" disabled={aiState.status === "running"} onClick={suggest}>
                  {aiState.status === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Suggest categories
                </Button>
              ) : null}
            </div>
            {aiState.text ? <p className="text-sm text-foreground-muted">{aiState.text}</p> : null}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="px-2 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">Use</th>
                    <th className="px-2 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">Description</th>
                    <th className="px-2 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted text-right">Amount</th>
                    <th className="px-2 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">Category</th>
                    <th className="px-2 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">Fee or cost</th>
                    {showKind ? <th className="px-2 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">Line kind</th> : null}
                    <th className="px-2 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const problem = r.include ? rowProblem(r) : null
                    const existing = r.target?.kind === "existing" ? liveById.get(r.target.categoryId) : undefined
                    const value = r.target === null ? "" : r.target.kind === "existing" ? `existing:${r.target.categoryId}` : r.target.name === r.sourceCategory && r.sourceCategory ? "new:source" : "new:custom"
                    return (
                      <tr key={r.index} className={`border-t border-border align-top ${r.include ? "" : "opacity-50"}`}>
                        <td className="px-2 py-2">
                          <Checkbox
                            checked={r.include}
                            onCheckedChange={(v) => updateRow(r.index, { include: v === true })}
                            aria-label={`Include row ${r.index + 1}`}
                            className="data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                          />
                        </td>
                        <td className="px-2 py-2 text-foreground max-w-[16rem]">
                          <div className="truncate">{r.description || <span className="text-foreground-muted">-</span>}</div>
                          {r.sourceCategory ? <div className="font-mono text-2xs text-foreground-muted truncate">File category: {r.sourceCategory}</div> : null}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-foreground whitespace-nowrap">
                          {r.amountCents === null ? <span className="text-destructive">-</span> : formatCents(r.amountCents)}
                          {r.math ? (
                            <div className="font-mono text-2xs text-foreground-muted">
                              {formatMilli(r.math.quantityMilli ?? 1000)}
                              {r.math.unitLabel ? ` ${r.math.unitLabel}` : ""} x {formatCents(r.math.rateCents)}
                              {r.math.multiplierMilli !== null ? ` x ${formatMilli(r.math.multiplierMilli)}` : ""}
                            </div>
                          ) : null}
                          {r.amountNote ? <div className="text-2xs text-warning whitespace-normal max-w-[12rem] ml-auto">{r.amountNote}</div> : null}
                        </td>
                        <td className="px-2 py-2 space-y-1 min-w-[14rem]">
                          <select aria-label="Category" className={`${selectClass} w-full h-8`} value={value} onChange={(e) => setTarget(r, e.target.value)}>
                            <option value="">Choose...</option>
                            {categories.map((c) => (
                              <option key={c.id} value={`existing:${c.id}`}>
                                {c.name}
                              </option>
                            ))}
                            {r.sourceCategory && !liveByKey.has(categoryNameKey(r.sourceCategory)) ? (
                              <option value="new:source">New: {r.sourceCategory}</option>
                            ) : null}
                            <option value="new:custom">New category...</option>
                          </select>
                          {r.target?.kind === "new" && value === "new:custom" ? (
                            <Input
                              aria-label="New category name"
                              value={r.target.name}
                              maxLength={200}
                              placeholder="New category name"
                              onChange={(e) => updateRow(r.index, { target: { kind: "new", name: e.target.value } })}
                              onBlur={(e) => {
                                const flag = flagForNew(e.target.value)
                                if (flag && !r.feeOrCost) updateRow(r.index, { feeOrCost: flag })
                              }}
                              className="h-8 bg-background border-border text-foreground"
                            />
                          ) : null}
                          {suggested.has(r.index) ? <div className="font-mono text-2xs uppercase tracking-wider text-accent">Suggested</div> : null}
                        </td>
                        <td className="px-2 py-2">
                          {existing ? (
                            <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">{existing.fee_or_cost}</span>
                          ) : (
                            <select
                              aria-label="Fee or cost"
                              className={`${selectClass} h-8`}
                              value={r.feeOrCost ?? ""}
                              onChange={(e) => updateRow(r.index, { feeOrCost: (e.target.value || null) as FeeOrCost | null })}
                            >
                              <option value="">Choose...</option>
                              <option value="fee">Fee</option>
                              <option value="cost">Cost</option>
                            </select>
                          )}
                        </td>
                        {showKind ? (
                          <td className="px-2 py-2">
                            {r.kindError ? (
                              <span className="text-xs text-destructive">-</span>
                            ) : r.kind ? (
                              <KindChip kind={r.kind} source="override" />
                            ) : (
                              <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Category</span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-2 py-2 text-xs">
                          {!r.include ? (
                            <span className="text-foreground-muted">
                              Excluded{rowProblem({ ...r, include: true }) ? `: ${rowProblem({ ...r, include: true })}` : ""}
                            </span>
                          ) : problem ? (
                            <span className="text-warning">{problem}</span>
                          ) : (
                            <span className="text-success">Ready</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {pages > 1 ? (
              <div className="flex items-center gap-2 font-mono text-2xs text-foreground-muted">
                <Button size="sm" variant="outline" className="border-border h-7" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                Page {page + 1} of {pages}
                <Button size="sm" variant="outline" className="border-border h-7" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="border-border" onClick={() => setStep("mapping")}>
                Back
              </Button>
              <Button
                className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
                disabled={problems.length > 0 || included.length === 0}
                onClick={runImport}
              >
                Import {included.length} {included.length === 1 ? "line" : "lines"}
              </Button>
              {problems.length > 0 ? (
                <span className="text-sm text-warning">
                  {problems.length} included {problems.length === 1 ? "row needs" : "rows need"} attention, or exclude {problems.length === 1 ? "it" : "them"}.
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === "importing" ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-accent" /> Importing {progress.done} of {progress.total}. Keep this panel open.
            </p>
            <div className="h-1.5 w-full rounded-full bg-white/10">
              <div className="h-1.5 rounded-full bg-accent" style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} />
            </div>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="space-y-4">
            <p className="font-display font-bold text-xl text-foreground">
              {okCount} of {results.length} {results.length === 1 ? "line" : "lines"} imported
            </p>
            {failed.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-destructive">
                  {failed.length} {failed.length === 1 ? "line was" : "lines were"} not imported. Nothing else was skipped.
                </p>
                <ul className="max-h-80 overflow-y-auto rounded-lg border border-border divide-y divide-border text-sm">
                  {failed.map((f) => {
                    const r = rows.find((x) => x.index === f.index)
                    return (
                      <li key={f.index} className="px-3 py-2">
                        <span className="font-mono text-2xs text-foreground-muted">Row {f.index + 1}</span>{" "}
                        <span className="text-foreground">{r?.description}</span>
                        <div className="text-xs text-destructive">{f.message}</div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-success">Every included row was imported.</p>
            )}
            <Button variant="outline" className="border-border" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
