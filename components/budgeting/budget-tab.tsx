"use client"

import { useMemo, useState } from "react"
import { Archive, ArchiveRestore, ArrowUpFromLine, GitMerge, Pencil, Repeat, RotateCcw, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { BudgetDialog } from "./budget-dialog"
import { ActionMessage, BudgetErrorState, BudgetLoading, FeeCostBadge, KindChip, labelClass, QuietEmpty, selectClass } from "./budget-states"
import { ImportSheet } from "./import-sheet"
import { useChart, useLines } from "@/lib/budget/hooks"
import { useRefreshProject, useRefreshTemplate } from "@/lib/budget/use-refresh"
import { BudgetApiError, budgetDelete, budgetFetch, budgetPatch, budgetPost, errorMessage, projectBase } from "@/lib/budget/client-api"
import { centsToDecimalString, formatCents, parseMoneyToCents, toCentsFromApi } from "@/lib/budget/money"
import {
  computeEstimateCents,
  formatMilli,
  milliToDecimalString,
  milliToPlain,
  parseDecimal3ToMilli,
  parseRateToCents,
  parseUnitLabel,
  rateCentsFromApi,
  toMilliFromApi,
} from "@/lib/budget/line-math"
import { categoryNameKey } from "@/lib/budget/starter-templates"
import { formatDateTime } from "@/lib/utils"
import type { BudgetLine, FeeOrCost, ProjectCategory, TemplateCategory } from "@/lib/server/budget/schema"

type Msg = { tone: "ok" | "error"; text: string } | null

type DialogState =
  | { kind: "rename"; category: ProjectCategory }
  | { kind: "merge"; category: ProjectCategory }
  | { kind: "reflag"; category: ProjectCategory }
  | { kind: "deleteCategory"; category: ProjectCategory; refusal?: string }
  | { kind: "deleteLine"; line: BudgetLine; refusal?: string }
  | null

const R1_ESTIMATE_TEXT =
  "This line has an estimate, so it cannot be deleted. Archive it to hide it (it can be restored), or set its estimate to 0 first."
const R1_IN_USE_LINE_TEXT = "This line has ledger entries against it, so it cannot be deleted. Archive it to hide it; the entries stay."
const R1_IN_USE_CATEGORY_TEXT =
  "This category still has lines, merge history or ledger entries, so it cannot be deleted. Archive it to hide it; nothing is lost."

export function BudgetTab({ projectId }: { projectId: string }) {
  const [showArchived, setShowArchived] = useState(false)
  const chart = useChart(projectId, true)
  const lines = useLines(projectId, true)
  const refresh = useRefreshProject(projectId)
  const refreshTemplate = useRefreshTemplate()
  const [message, setMessage] = useState<Msg>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [busy, setBusy] = useState(false)
  const [renameText, setRenameText] = useState("")
  const [mergeInto, setMergeInto] = useState("")
  const [newCatName, setNewCatName] = useState("")
  // R-D1: a new category starts as cost; fee is always a deliberate choice.
  const [newCatFlag, setNewCatFlag] = useState<FeeOrCost>("cost")
  const [importOpen, setImportOpen] = useState(false)
  const [mergeNeedsFinish, setMergeNeedsFinish] = useState<string | null>(null)

  const base = projectBase(projectId)

  const model = useMemo(() => {
    const categories = (() => {
      const m = new Map<string, ProjectCategory>()
      for (const c of chart.data?.categories ?? []) m.set(c.id, c)
      return Array.from(m.values())
    })()
    const merges = chart.data?.merges ?? []
    const retired = new Set(merges.map((m) => m.from_category_id))
    const allLines = (() => {
      const m = new Map<string, BudgetLine>()
      for (const l of lines.data?.lines ?? []) m.set(l.id, l)
      return Array.from(m.values())
    })()
    const linesByCategory = new Map<string, BudgetLine[]>()
    for (const l of allLines) {
      const list = linesByCategory.get(l.category_id) ?? []
      list.push(l)
      linesByCategory.set(l.category_id, list)
    }
    const live = categories.filter((c) => !retired.has(c.id))
    const nameById = new Map(categories.map((c) => [c.id, c.name]))
    const liveLineCount = allLines.filter((l) => !l.archived_at).length
    const totalCents = allLines.filter((l) => !l.archived_at).reduce((a, l) => a + toCentsFromApi(l.estimate), 0)
    return { categories, merges, retired, live, linesByCategory, nameById, liveLineCount, totalCents }
  }, [chart.data, lines.data])

  // 116 applied: quantity, rate, multiplier and unit exist. Until then every line is typed only.
  const lineMath = lines.data?.lineMath === true
  // 117 applied: a line may override its category's fee or cost. Until then every line inherits and
  // the toggle is not shown.
  const lineKind = lines.data?.lineKind === true
  const visibleCategories = model.live.filter((c) => showArchived || !c.archived_at)
  const activeCategories = model.live.filter((c) => !c.archived_at)

  async function run(action: () => Promise<string | void>) {
    setBusy(true)
    setMessage(null)
    try {
      const text = await action()
      if (text) setMessage({ tone: "ok", text })
      await refresh()
      return true
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function startFromTemplate() {
    await run(async () => {
      try {
        const res = await budgetPost<{ result: { copied: number } }>(`${base}/chart`, { action: "copy_template" })
        return res.result.copied === 0
          ? "Your agency template is empty, so the chart starts empty. Add categories below."
          : `Copied ${res.result.copied} ${res.result.copied === 1 ? "category" : "categories"} from your agency template.`
      } catch (e) {
        if (e instanceof BudgetApiError && e.kind === "conflict") {
          throw new BudgetApiError("conflict", 409, "This project already has a chart (some categories may be archived). Turn on Show archived to see them.")
        }
        throw e
      }
    })
  }

  async function addCategory() {
    if (!newCatName.trim()) {
      setMessage({ tone: "error", text: "Name the category." })
      return
    }
    const ok = await run(async () => {
      await budgetPost(`${base}/chart`, { action: "add", name: newCatName.trim(), feeOrCost: newCatFlag })
      return `Added ${newCatName.trim()}.`
    })
    if (ok) {
      setNewCatName("")
      setNewCatFlag("cost")
    }
  }

  async function categoryAction(category: ProjectCategory, action: "archive" | "unarchive") {
    await run(async () => {
      await budgetPost(`${base}/chart/${category.id}`, { action })
      return action === "archive" ? `${category.name} archived. It is hidden, not deleted.` : `${category.name} restored.`
    })
  }

  async function promote(category: ProjectCategory) {
    await run(async () => {
      const template = await budgetFetch<{ categories: TemplateCategory[] }>("/api/agency/budget/templates?include_archived=1")
      const existing = template.categories.find((t) => categoryNameKey(t.name) === categoryNameKey(category.name))
      if (existing) {
        return existing.archived_at
          ? `${category.name} is already in your agency template, archived. Restore it from the template page.`
          : `${category.name} is already in your agency template.`
      }
      await budgetPost(`${base}/chart/${category.id}`, { action: "promote" })
      await refreshTemplate()
      return `${category.name} added to your agency template. New projects will start with it; this project is unchanged.`
    })
  }

  async function confirmDialog() {
    if (!dialog) return
    if (dialog.kind === "rename") {
      const name = renameText.trim()
      if (!name) return
      const ok = await run(async () => {
        await budgetPost(`${base}/chart/${dialog.category.id}`, { action: "rename", name })
        return `Renamed to ${name}. "${dialog.category.name}" is kept in the merge history.`
      })
      if (ok) setDialog(null)
      return
    }
    if (dialog.kind === "merge") {
      if (!mergeInto) return
      const into = model.nameById.get(mergeInto) ?? "the other category"
      const ok = await run(async () => {
        try {
          const res = await budgetPost<{ result: { linesMoved: number; entriesMoved: number | null } }>(`${base}/chart/${dialog.category.id}`, {
            action: "merge",
            intoCategoryId: mergeInto,
          })
          setMergeNeedsFinish(null)
          const entries = res.result.entriesMoved === null ? "" : ` and ${res.result.entriesMoved} ledger ${res.result.entriesMoved === 1 ? "entry" : "entries"}`
          return `Merged ${dialog.category.name} into ${into}: ${res.result.linesMoved} ${res.result.linesMoved === 1 ? "line" : "lines"}${entries} moved. Each entry keeps its original category.`
        } catch (e) {
          setMergeNeedsFinish(dialog.category.id)
          throw e
        }
      })
      if (ok) setDialog(null)
      return
    }
    if (dialog.kind === "reflag") {
      const c = dialog.category
      const next: FeeOrCost = c.fee_or_cost === "fee" ? "cost" : "fee"
      const ok = await run(async () => {
        // A project category's flag is fixed at creation. Switching it is a merge into a new
        // category of the same name and the other flag, so the history records the change.
        const created = await budgetPost<{ category: ProjectCategory }>(`${base}/chart`, { action: "add", name: c.name, feeOrCost: next })
        try {
          await budgetPost(`${base}/chart/${c.id}`, { action: "merge", intoCategoryId: created.category.id })
        } catch (e) {
          setMergeNeedsFinish(c.id)
          throw new BudgetApiError(
            e instanceof BudgetApiError ? e.kind : "error",
            e instanceof BudgetApiError ? e.status : 500,
            `A new ${next} category "${c.name}" was created but the old one was not merged into it (${errorMessage(e)}). Use Finish merge, or delete the new empty category.`
          )
        }
        return `${c.name} is now marked ${next}. The switch is recorded in the merge history.`
      })
      if (ok) setDialog(null)
      return
    }
    if (dialog.kind === "deleteCategory") {
      setBusy(true)
      try {
        await budgetDelete(`${base}/chart/${dialog.category.id}`)
        setMessage({ tone: "ok", text: `${dialog.category.name} deleted.` })
        setDialog(null)
        await refresh()
      } catch (e) {
        const refusal = e instanceof BudgetApiError && e.kind === "conflict" ? R1_IN_USE_CATEGORY_TEXT : errorMessage(e)
        setDialog({ ...dialog, refusal })
      } finally {
        setBusy(false)
      }
      return
    }
    if (dialog.kind === "deleteLine") {
      if (dialog.refusal) {
        // The refusal offers archive instead.
        const ok = await run(async () => {
          await budgetPatch(`${base}/lines/${dialog.line.id}`, { archived: true })
          return `${dialog.line.name} archived. It is hidden, not deleted.`
        })
        if (ok) setDialog(null)
        return
      }
      setBusy(true)
      try {
        await budgetDelete(`${base}/lines/${dialog.line.id}`)
        setMessage({ tone: "ok", text: `${dialog.line.name} deleted.` })
        setDialog(null)
        await refresh()
      } catch (e) {
        let refusal = errorMessage(e)
        if (e instanceof BudgetApiError && e.code === "R1_ESTIMATE") refusal = R1_ESTIMATE_TEXT
        else if (e instanceof BudgetApiError && e.kind === "conflict") refusal = R1_IN_USE_LINE_TEXT
        setDialog({ ...dialog, refusal })
      } finally {
        setBusy(false)
      }
    }
  }

  async function finishMerge(categoryId: string) {
    const ok = await run(async () => {
      const res = await budgetPost<{ result: { linesMoved: number } }>(`${base}/chart/${categoryId}`, { action: "repoint" })
      return `Merge finished: ${res.result.linesMoved} ${res.result.linesMoved === 1 ? "line" : "lines"} moved.`
    })
    if (ok) setMergeNeedsFinish(null)
  }

  function openDeleteLine(line: BudgetLine) {
    // R1, checked here first so the common refusal needs no round trip. The server decides.
    setDialog({ kind: "deleteLine", line, refusal: toCentsFromApi(line.estimate) !== 0 ? R1_ESTIMATE_TEXT : undefined })
  }

  if (chart.isLoading || lines.isLoading) return <BudgetLoading />
  if (chart.error || lines.error) return <BudgetErrorState error={chart.error ?? lines.error} onRetry={() => refresh()} />

  const hasChart = model.categories.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
          {activeCategories.length} {activeCategories.length === 1 ? "category" : "categories"} · {model.liveLineCount}{" "}
          {model.liveLineCount === 1 ? "line" : "lines"} · Estimate {formatCents(model.totalCents)}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} className="data-[state=checked]:bg-accent" />
            Show archived
          </label>
          {hasChart ? (
            <Button variant="outline" size="sm" className="border-border font-mono" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4" /> Import budget
            </Button>
          ) : null}
        </div>
      </div>

      {lineMath && hasChart ? (
        <p className="text-xs text-foreground-muted">
          Total = Qty x Rate x multiplier, rounded to the cent. An empty Qty or x counts as 1. Leave Rate empty to type the total yourself.
          {lineKind
            ? " Each line follows its category's fee or cost (dashed chip); click the chip to set the line to the other kind (solid chip)."
            : ""}
        </p>
      ) : null}

      <ActionMessage message={message} />
      {mergeNeedsFinish ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground flex flex-wrap items-center gap-3">
          <span>If a merge was recorded but its lines were not all moved, finish it here. It is safe to run twice.</span>
          <Button size="sm" variant="outline" className="border-border" disabled={busy} onClick={() => finishMerge(mergeNeedsFinish)}>
            Finish merge
          </Button>
        </div>
      ) : null}

      {!hasChart ? (
        <div className="rounded-lg border border-border bg-white/5 p-5 space-y-3">
          <p className="font-display font-bold text-lg text-foreground">This project has no budget yet</p>
          <p className="text-sm text-foreground-muted">
            Start from your agency template (a copy; later template edits do not change this project), or add a first category below.
          </p>
          <Button className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono" disabled={busy} onClick={startFromTemplate}>
            Start from agency template
          </Button>
        </div>
      ) : null}

      {visibleCategories.length === 0 && hasChart ? <QuietEmpty>Every category is archived. Turn on Show archived to see them.</QuietEmpty> : null}

      <div className="space-y-4">
        {visibleCategories.map((c) => (
          <CategoryCard
            key={c.id}
            projectId={projectId}
            category={c}
            lines={(model.linesByCategory.get(c.id) ?? []).filter((l) => showArchived || !l.archived_at)}
            lineMath={lineMath}
            lineKind={lineKind}
            busy={busy}
            onMessage={setMessage}
            onRefresh={refresh}
            onRename={() => {
              setRenameText(c.name)
              setDialog({ kind: "rename", category: c })
            }}
            onMerge={() => {
              setMergeInto("")
              setDialog({ kind: "merge", category: c })
            }}
            onReflag={() => setDialog({ kind: "reflag", category: c })}
            onPromote={() => promote(c)}
            onArchive={() => categoryAction(c, c.archived_at ? "unarchive" : "archive")}
            onDelete={() => setDialog({ kind: "deleteCategory", category: c })}
            onDeleteLine={openDeleteLine}
          />
        ))}
      </div>

      <div className="rounded-lg border border-border bg-white/5 p-4">
        <div className={labelClass}>Add a category</div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="Category name"
            maxLength={200}
            className="bg-background border-border text-foreground max-w-xs"
            onKeyDown={(e) => e.key === "Enter" && addCategory()}
          />
          <select aria-label="Fee or cost" className={selectClass} value={newCatFlag} onChange={(e) => setNewCatFlag(e.target.value as FeeOrCost)}>
            <option value="cost">Cost (third-party spend)</option>
            <option value="fee">Fee (the agency earns it)</option>
          </select>
          <Button variant="outline" className="border-border font-mono" disabled={busy} onClick={addCategory}>
            Add category
          </Button>
        </div>
      </div>

      {model.merges.length > 0 ? (
        <details className="rounded-lg border border-border bg-white/5 p-4">
          <summary className="cursor-pointer font-mono text-2xs uppercase tracking-wider text-foreground-muted">
            Rename and merge history ({model.merges.length})
          </summary>
          <ul className="mt-3 space-y-1 text-sm text-foreground-muted">
            {model.merges.map((m) => (
              <li key={m.id}>
                <span className="text-foreground">{model.nameById.get(m.from_category_id) ?? "A category"}</span> merged into{" "}
                <span className="text-foreground">{model.nameById.get(m.into_category_id) ?? "a category"}</span>
                <span className="font-mono text-2xs"> · {formatDateTime(m.merged_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <BudgetDialog
        open={dialog?.kind === "rename"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Rename category"
        description="A rename is recorded as a merge into the new name, so earlier exports can be explained. Lines and ledger entries move with it."
        confirmLabel="Rename"
        confirmDisabled={!renameText.trim()}
        busy={busy}
        onConfirm={confirmDialog}
      >
        <Input value={renameText} onChange={(e) => setRenameText(e.target.value)} maxLength={200} className="bg-background border-border text-foreground" />
      </BudgetDialog>

      <BudgetDialog
        open={dialog?.kind === "merge"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "merge" ? `Merge ${dialog.category.name}` : "Merge"}
        description="Every line and ledger entry moves to the category you choose. Each ledger entry keeps a record of the category it was first filed under. A merge cannot be undone."
        confirmLabel="Merge"
        confirmDisabled={!mergeInto}
        busy={busy}
        onConfirm={confirmDialog}
      >
        <select aria-label="Merge into" className={`${selectClass} w-full`} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
          <option value="">Merge into...</option>
          {dialog?.kind === "merge"
            ? activeCategories
                .filter((c) => c.id !== dialog.category.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.fee_or_cost})
                  </option>
                ))
            : null}
        </select>
      </BudgetDialog>

      <BudgetDialog
        open={dialog?.kind === "reflag"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "reflag" ? `Mark ${dialog.category.name} as ${dialog.category.fee_or_cost === "fee" ? "cost" : "fee"}` : "Switch"}
        description="Margin is computed from this flag. The switch creates a category of the same name with the other flag and merges this one into it, so the change is in the history."
        confirmLabel="Switch"
        busy={busy}
        onConfirm={confirmDialog}
      />

      <BudgetDialog
        open={dialog?.kind === "deleteCategory"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "deleteCategory" ? `Delete ${dialog.category.name}?` : "Delete"}
        description={
          dialog?.kind === "deleteCategory" && dialog.refusal
            ? dialog.refusal
            : "A category can be deleted only while nothing uses it. Otherwise archive it."
        }
        confirmLabel={dialog?.kind === "deleteCategory" && dialog.refusal ? "Archive instead" : "Delete"}
        destructive={!(dialog?.kind === "deleteCategory" && dialog.refusal)}
        busy={busy}
        onConfirm={() => {
          if (dialog?.kind === "deleteCategory" && dialog.refusal) {
            const c = dialog.category
            setDialog(null)
            void categoryAction(c, "archive")
          } else void confirmDialog()
        }}
      />

      <BudgetDialog
        open={dialog?.kind === "deleteLine"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "deleteLine" ? (dialog.refusal ? `${dialog.line.name} cannot be deleted` : `Delete ${dialog.line.name}?`) : "Delete"}
        description={dialog?.kind === "deleteLine" ? dialog.refusal ?? "This line has no estimate and will be removed permanently." : undefined}
        confirmLabel={dialog?.kind === "deleteLine" && dialog.refusal ? "Archive instead" : "Delete"}
        destructive={!(dialog?.kind === "deleteLine" && dialog.refusal)}
        busy={busy}
        onConfirm={confirmDialog}
      />

      {importOpen ? (
        <ImportSheet
          projectId={projectId}
          categories={activeCategories}
          lineMath={lineMath}
          lineKind={lineKind}
          open={importOpen}
          onOpenChange={setImportOpen}
          onFinished={() => refresh()}
        />
      ) : null}
    </div>
  )
}

function CategoryCard({
  projectId,
  category,
  lines,
  lineMath,
  lineKind,
  busy,
  onMessage,
  onRefresh,
  onRename,
  onMerge,
  onReflag,
  onPromote,
  onArchive,
  onDelete,
  onDeleteLine,
}: {
  projectId: string
  category: ProjectCategory
  lines: BudgetLine[]
  lineMath: boolean
  lineKind: boolean
  busy: boolean
  onMessage: (m: Msg) => void
  onRefresh: () => Promise<unknown>
  onRename: () => void
  onMerge: () => void
  onReflag: () => void
  onPromote: () => void
  onArchive: () => void
  onDelete: () => void
  onDeleteLine: (line: BudgetLine) => void
}) {
  const [name, setName] = useState("")
  const [estimate, setEstimate] = useState("")
  const [qty, setQty] = useState("")
  const [rate, setRate] = useState("")
  const [mult, setMult] = useState("")
  const [unit, setUnit] = useState("")
  const [adding, setAdding] = useState(false)
  const subtotal = lines.filter((l) => !l.archived_at).reduce((a, l) => a + toCentsFromApi(l.estimate), 0)
  const archived = Boolean(category.archived_at)
  const preview = lineMath ? previewTotal(qty, rate, mult) : null
  const grid = lineKind ? MATH_GRID_KIND : MATH_GRID

  async function addLine() {
    if (!name.trim()) return onMessage({ tone: "error", text: "Name the line." })
    const body: Record<string, unknown> = { categoryId: category.id, name: name.trim() }
    if (lineMath) {
      const math = readMath(qty, rate, mult, unit)
      if (!math.ok) return onMessage({ tone: "error", text: math.reason })
      Object.assign(body, math.body)
    }
    if (!("unitRate" in body) || body.unitRate === null) {
      const money = parseMoneyToCents(estimate || "0")
      if (!money.ok) return onMessage({ tone: "error", text: `Estimate: ${money.reason}` })
      body.estimate = centsToDecimalString(money.cents)
    }
    setAdding(true)
    try {
      await budgetPost(`${projectBase(projectId)}/lines`, body)
      setName("")
      setEstimate("")
      setQty("")
      setRate("")
      setMult("")
      setUnit("")
      onMessage(null)
      await onRefresh()
    } catch (e) {
      onMessage({ tone: "error", text: errorMessage(e) })
    } finally {
      setAdding(false)
    }
  }

  const iconBtn = "h-8 px-2 text-foreground-muted hover:text-foreground"

  return (
    <section className={`rounded-lg border border-border ${archived ? "bg-white/[0.02] opacity-70" : "bg-white/5"}`}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
        <h3 className="font-bold text-foreground">{category.name}</h3>
        <FeeCostBadge value={category.fee_or_cost} />
        {archived ? <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Archived</span> : null}
        <span className="ml-auto font-mono text-sm text-foreground">{formatCents(subtotal)}</span>
        <div className="flex flex-wrap items-center gap-1">
          {!archived ? (
            <>
              <Button variant="ghost" size="sm" className={iconBtn} onClick={onRename} disabled={busy} title="Rename">
                <Pencil className="w-4 h-4" />
                <span className="sr-only">Rename</span>
              </Button>
              <Button variant="ghost" size="sm" className={iconBtn} onClick={onMerge} disabled={busy} title="Merge into another category">
                <GitMerge className="w-4 h-4" />
                <span className="sr-only">Merge</span>
              </Button>
              <Button variant="ghost" size="sm" className={iconBtn} onClick={onReflag} disabled={busy} title={`Mark as ${category.fee_or_cost === "fee" ? "cost" : "fee"}`}>
                <Repeat className="w-4 h-4" />
                <span className="sr-only">Switch fee or cost</span>
              </Button>
              <Button variant="ghost" size="sm" className={iconBtn} onClick={onPromote} disabled={busy} title="Promote to agency template">
                <ArrowUpFromLine className="w-4 h-4" />
                <span className="sr-only">Promote to agency template</span>
              </Button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" className={iconBtn} onClick={onArchive} disabled={busy} title={archived ? "Restore" : "Archive"}>
            {archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
            <span className="sr-only">{archived ? "Restore" : "Archive"}</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive/80 hover:text-destructive" onClick={onDelete} disabled={busy} title="Delete">
            <Trash2 className="w-4 h-4" />
            <span className="sr-only">Delete</span>
          </Button>
        </div>
      </header>
      {lineMath ? (
        <div className="overflow-x-auto">
          <div className={`${lineKind ? "min-w-[50rem]" : "min-w-[44rem]"} divide-y divide-border`}>
            {lines.length === 0 ? <p className="px-4 py-3 text-sm text-foreground-muted">No lines yet.</p> : null}
            {lines.length > 0 ? (
              <div className={`${grid} px-4 pt-2 pb-1 font-mono text-2xs uppercase tracking-wider text-foreground-muted`} aria-hidden>
                <span>Line</span>
                <span className="text-right">Qty</span>
                <span>Unit</span>
                <span className="text-right">Rate</span>
                <span className="text-right">x</span>
                <span className="text-right">Total</span>
                {lineKind ? <span>Kind</span> : null}
                <span />
              </div>
            ) : null}
            {lines.map((l) => (
              <MathLineRow
                key={l.id}
                projectId={projectId}
                line={l}
                categoryKind={category.fee_or_cost}
                lineKind={lineKind}
                onMessage={onMessage}
                onRefresh={onRefresh}
                onDelete={() => onDeleteLine(l)}
              />
            ))}
            {!archived ? (
              <div className={`${grid} px-4 py-3`}>
                <Input
                  aria-label="New line name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="New line"
                  maxLength={300}
                  className="bg-background border-border text-foreground h-8"
                  onKeyDown={(e) => e.key === "Enter" && addLine()}
                />
                <Input aria-label="New line quantity" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1" inputMode="decimal" className={newCell} onKeyDown={(e) => e.key === "Enter" && addLine()} />
                <Input aria-label="New line unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="day" maxLength={24} className="bg-background border-border text-foreground h-8" onKeyDown={(e) => e.key === "Enter" && addLine()} />
                <Input aria-label="New line rate" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate" inputMode="decimal" className={newCell} onKeyDown={(e) => e.key === "Enter" && addLine()} />
                <Input aria-label="New line multiplier" value={mult} onChange={(e) => setMult(e.target.value)} placeholder="1" inputMode="decimal" className={newCell} onKeyDown={(e) => e.key === "Enter" && addLine()} />
                {preview ? (
                  <span className={`text-right font-mono text-sm ${"error" in preview ? "text-destructive" : "text-foreground"}`} title={"error" in preview ? preview.error : "Computed: Qty x Rate x multiplier"}>
                    {"error" in preview ? "-" : formatCents(preview.cents)}
                  </span>
                ) : (
                  <Input aria-label="New line total" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="0.00" inputMode="decimal" className={newCell} onKeyDown={(e) => e.key === "Enter" && addLine()} />
                )}
                {lineKind ? (
                  <span title="A new line follows its category. Change it after adding.">
                    <KindChip kind={category.fee_or_cost} source="inherited" />
                  </span>
                ) : null}
                <Button size="sm" variant="outline" className="border-border font-mono h-8 px-2" disabled={adding} onClick={addLine}>
                  {adding ? "..." : "Add"}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {lines.length === 0 ? <p className="px-4 py-3 text-sm text-foreground-muted">No lines yet.</p> : null}
          {lines.map((l) => (
            <LineRow
              key={`${l.id}:${l.name}:${l.estimate}:${l.archived_at ?? ""}`}
              projectId={projectId}
              line={l}
              categoryKind={category.fee_or_cost}
              lineKind={lineKind}
              onMessage={onMessage}
              onRefresh={onRefresh}
              onDelete={() => onDeleteLine(l)}
            />
          ))}
        </div>
      )}
      {!archived && !lineMath ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-border">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New line"
            maxLength={300}
            className="bg-background border-border text-foreground h-8 max-w-sm"
            onKeyDown={(e) => e.key === "Enter" && addLine()}
          />
          <Input
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className="bg-background border-border text-foreground h-8 w-32 text-right font-mono"
            onKeyDown={(e) => e.key === "Enter" && addLine()}
          />
          <Button size="sm" variant="outline" className="border-border font-mono" disabled={adding} onClick={addLine}>
            {adding ? "Adding..." : "Add line"}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

// ---- Line math (116). Same rules as the server: lib/budget/line-math.ts. ----

// Line, Qty, Unit, Rate, x, Total, [Kind], actions (F2: Unit sits directly after Qty). DOM order is
// the visual order, so Tab follows it.
const MATH_GRID = "grid grid-cols-[minmax(11rem,1fr)_5rem_5.5rem_7.5rem_4.5rem_8rem_4.75rem] items-center gap-2"
const MATH_GRID_KIND = "grid grid-cols-[minmax(11rem,1fr)_5rem_5.5rem_7.5rem_4.5rem_8rem_5.5rem_4.75rem] items-center gap-2"
const newCell = "bg-background border-border text-foreground h-8 text-right font-mono"
const inlineCell = "h-8 bg-transparent border-transparent hover:border-border focus:border-border text-foreground"

type Read<T> = { ok: true; value: T } | { ok: false; reason: string }

/** An empty cell is "not set" (null); anything else must parse. */
function readMilli(text: string, label: string): Read<number | null> {
  if (!text.trim()) return { ok: true, value: null }
  const r = parseDecimal3ToMilli(text, label)
  return r.ok ? { ok: true, value: r.milli } : r
}

function readRate(text: string): Read<number | null> {
  if (!text.trim()) return { ok: true, value: null }
  const r = parseRateToCents(text)
  return r.ok ? { ok: true, value: r.cents } : r
}

function readUnit(text: string): Read<string | null> {
  if (!text.trim()) return { ok: true, value: null }
  const r = parseUnitLabel(text)
  return r.ok ? { ok: true, value: r.label } : r
}

/** The total a row's cells imply, null when there is no rate (the total is typed). */
function previewTotal(qty: string, rate: string, mult: string): { cents: number } | { error: string } | null {
  const r = readRate(rate)
  if (!r.ok) return { error: r.reason }
  if (r.value === null) return null
  const q = readMilli(qty, "Quantity")
  if (!q.ok) return { error: q.reason }
  const m = readMilli(mult, "Multiplier")
  if (!m.ok) return { error: m.reason }
  const c = computeEstimateCents(q.value, r.value, m.value)
  return c.ok ? { cents: c.cents } : { error: c.reason }
}

/** A new line's math fields for the API, validated; empty cells are left out. */
function readMath(qty: string, rate: string, mult: string, unit: string): { ok: true; body: Record<string, unknown> } | { ok: false; reason: string } {
  const q = readMilli(qty, "Quantity")
  if (!q.ok) return q
  const r = readRate(rate)
  if (!r.ok) return r
  const m = readMilli(mult, "Multiplier")
  if (!m.ok) return m
  const u = readUnit(unit)
  if (!u.ok) return u
  if (r.value !== null) {
    const c = computeEstimateCents(q.value, r.value, m.value)
    if (!c.ok) return { ok: false, reason: c.reason }
  }
  const body: Record<string, unknown> = {}
  if (q.value !== null) body.quantity = milliToDecimalString(q.value)
  if (r.value !== null) body.unitRate = centsToDecimalString(r.value)
  if (m.value !== null) body.multiplier = milliToDecimalString(m.value)
  if (u.value !== null) body.unitLabel = u.value
  return { ok: true, body }
}

function formulaText(qty: number | null, rate: number, mult: number | null, unit: string | null, total: number): string {
  return `${formatMilli(qty ?? 1000)}${unit ? ` ${unit}` : ""} x ${formatCents(rate)}${mult !== null ? ` x ${formatMilli(mult)}` : ""} = ${formatCents(total)}`
}

/**
 * A line's effective kind (117, R-K1): the chip toggles the line to the other kind (an override);
 * an override also offers Reset to category, which clears it so the line follows its category again.
 */
function LineKindCell({
  lineName,
  kind,
  source,
  categoryKind,
  archived,
  busy,
  onSet,
}: {
  lineName: string
  kind: FeeOrCost
  source: "inherited" | "override"
  categoryKind: FeeOrCost
  archived: boolean
  busy: boolean
  onSet: (next: FeeOrCost | null) => void
}) {
  if (archived) return <KindChip kind={kind} source={source} />
  const other: FeeOrCost = kind === "fee" ? "cost" : "fee"
  return (
    <div className="flex items-center gap-1">
      <KindChip
        kind={kind}
        source={source}
        disabled={busy}
        label={`${lineName}: ${kind}${source === "override" ? ", set on this line" : ", from the category"}. Mark ${other}`}
        onClick={() => onSet(other)}
      />
      {source === "override" ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1 text-foreground hover:text-accent"
          title={`Reset to category (${categoryKind})`}
          disabled={busy}
          onClick={() => onSet(null)}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="sr-only">{`${lineName}: reset to category (${categoryKind})`}</span>
        </Button>
      ) : null}
    </div>
  )
}

type MathField = "name" | "quantity" | "rate" | "multiplier" | "unit" | "estimate"

/**
 * One line with math. Each cell saves on blur or Enter (one field per request, so tabbing on while a
 * save is in flight loses nothing); Escape reverts the cell. With a rate the Total is read-only and
 * shows the product live; without one it is the typed estimate, as before 116.
 */
function MathLineRow({
  projectId,
  line,
  categoryKind,
  lineKind,
  onMessage,
  onRefresh,
  onDelete,
}: {
  projectId: string
  line: BudgetLine
  categoryKind: FeeOrCost
  lineKind: boolean
  onMessage: (m: Msg) => void
  onRefresh: () => Promise<unknown>
  onDelete: () => void
}) {
  const saved = {
    name: line.name,
    quantity: toMilliFromApi(line.quantity),
    rate: rateCentsFromApi(line.unit_rate),
    multiplier: toMilliFromApi(line.multiplier),
    unit: line.unit_label,
    cents: toCentsFromApi(line.estimate),
  }
  const text = {
    name: saved.name,
    quantity: saved.quantity === null ? "" : milliToPlain(saved.quantity),
    // F1: thousands separators, as the Total shows them. readRate() accepts the commas back.
    rate: saved.rate === null ? "" : formatCents(saved.rate),
    multiplier: saved.multiplier === null ? "" : milliToPlain(saved.multiplier),
    unit: saved.unit ?? "",
    estimate: centsToDecimalString(saved.cents),
  }
  const [values, setValues] = useState(text)
  const [focused, setFocused] = useState<MathField | null>(null)
  const [busy, setBusy] = useState(false)
  const archived = Boolean(line.archived_at)

  // A refresh after any save brings new saved values: adopt them in every cell but the one being
  // typed in (adjusting state during render, not in an effect).
  const savedKey = `${line.name}|${line.quantity}|${line.unit_rate}|${line.multiplier}|${line.unit_label}|${line.estimate}`
  const [syncedKey, setSyncedKey] = useState(savedKey)
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey)
    setValues((v) => {
      const next = { ...text }
      if (focused) next[focused] = v[focused]
      return next
    })
  }

  const set = (field: MathField, value: string) => setValues((v) => ({ ...v, [field]: value }))
  const revert = (field: MathField) => set(field, text[field])

  async function save(field: MathField, patch: Record<string, unknown>) {
    try {
      await budgetPatch(`${projectBase(projectId)}/lines/${line.id}`, patch)
      onMessage(null)
      await onRefresh()
    } catch (e) {
      onMessage({ tone: "error", text: `${line.name}: ${errorMessage(e)}` })
      revert(field)
    }
  }

  function refuse(field: MathField, reason: string) {
    onMessage({ tone: "error", text: `${line.name}: ${reason}` })
    revert(field)
  }

  /** Would this change make the product unrepresentable? Checked before sending. */
  function productFits(next: { quantity?: number | null; rate?: number | null; multiplier?: number | null }): string | null {
    const r = next.rate !== undefined ? next.rate : saved.rate
    if (r === null) return null
    const c = computeEstimateCents(
      next.quantity !== undefined ? next.quantity : saved.quantity,
      r,
      next.multiplier !== undefined ? next.multiplier : saved.multiplier
    )
    return c.ok ? null : c.reason
  }

  function commit(field: MathField) {
    setFocused(null)
    const raw = values[field]
    if (field === "name") {
      const next = raw.trim()
      if (!next) return revert("name")
      if (next !== saved.name) void save("name", { name: next })
      return
    }
    if (field === "quantity" || field === "multiplier") {
      const r = readMilli(raw, field === "quantity" ? "Quantity" : "Multiplier")
      if (!r.ok) return refuse(field, r.reason)
      if (r.value === saved[field]) return revert(field)
      const tooLarge = productFits({ [field]: r.value })
      if (tooLarge) return refuse(field, tooLarge)
      void save(field, { [field]: r.value === null ? null : milliToDecimalString(r.value) })
      return
    }
    if (field === "rate") {
      const r = readRate(raw)
      if (!r.ok) return refuse("rate", r.reason)
      if (r.value === saved.rate) return revert("rate")
      const tooLarge = productFits({ rate: r.value })
      if (tooLarge) return refuse("rate", tooLarge)
      // Clearing the rate keeps the last total, which is typed from then on.
      void save("rate", { unitRate: r.value === null ? null : centsToDecimalString(r.value) })
      return
    }
    if (field === "unit") {
      const r = readUnit(raw)
      if (!r.ok) return refuse("unit", r.reason)
      if (r.value === saved.unit) return revert("unit")
      void save("unit", { unitLabel: r.value })
      return
    }
    const money = parseMoneyToCents(raw)
    if (!money.ok) return refuse("estimate", money.reason)
    set("estimate", centsToDecimalString(money.cents))
    if (money.cents !== saved.cents) void save("estimate", { estimate: centsToDecimalString(money.cents) })
  }

  const cellProps = (field: MathField) => ({
    value: values[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(field, e.target.value),
    onFocus: () => setFocused(field),
    onBlur: () => commit(field),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") (e.target as HTMLInputElement).blur()
      if (e.key === "Escape") {
        revert(field)
        setFocused(null)
        // Blur after the revert has rendered, so the blur commits the saved value (a no-op).
        const el = e.target as HTMLInputElement
        setTimeout(() => el.blur(), 0)
      }
    },
  })

  const preview = previewTotal(values.quantity, values.rate, values.multiplier)
  const showComputed = values.rate.trim() !== "" || saved.rate !== null
  const formula =
    saved.rate !== null ? formulaText(saved.quantity, saved.rate, saved.multiplier, saved.unit, saved.cents) : "Typed total (no rate)"

  async function toggleArchive() {
    setBusy(true)
    try {
      await budgetPatch(`${projectBase(projectId)}/lines/${line.id}`, { archived: !archived })
      onMessage(null)
      await onRefresh()
    } catch (e) {
      onMessage({ tone: "error", text: `${line.name}: ${errorMessage(e)}` })
    } finally {
      setBusy(false)
    }
  }

  async function setKind(next: FeeOrCost | null) {
    setBusy(true)
    try {
      await budgetPatch(`${projectBase(projectId)}/lines/${line.id}`, { kind: next })
      onMessage(null)
      await onRefresh()
    } catch (e) {
      onMessage({ tone: "error", text: `${line.name}: ${errorMessage(e)}` })
    } finally {
      setBusy(false)
    }
  }

  const num = `${inlineCell} text-right font-mono`
  const plain = "text-right font-mono text-sm text-foreground-muted truncate"
  const kind = line.fee_or_cost ?? categoryKind
  const kindSource = line.fee_or_cost === null ? "inherited" : "override"

  return (
    <div className={`${lineKind ? MATH_GRID_KIND : MATH_GRID} px-4 py-2 ${archived ? "opacity-60" : ""}`}>
      {archived ? (
        <span className="min-w-0 text-sm text-foreground-muted truncate">
          {line.name} <span className="font-mono text-2xs uppercase tracking-wider">· Archived</span>
        </span>
      ) : (
        <Input aria-label="Line name" maxLength={300} className={inlineCell} {...cellProps("name")} />
      )}
      {archived ? (
        <>
          <span className={plain}>{saved.quantity === null ? "" : formatMilli(saved.quantity)}</span>
          <span className="text-sm text-foreground-muted truncate">{saved.unit ?? ""}</span>
          <span className={plain}>{saved.rate === null ? "" : formatCents(saved.rate)}</span>
          <span className={plain}>{saved.multiplier === null ? "" : formatMilli(saved.multiplier)}</span>
          <span className={plain} title={formula}>
            {formatCents(saved.cents)}
          </span>
        </>
      ) : (
        <>
          <Input aria-label={`${line.name} quantity`} inputMode="decimal" placeholder="1" className={num} {...cellProps("quantity")} />
          <Input aria-label={`${line.name} unit`} maxLength={24} placeholder="-" className={inlineCell} {...cellProps("unit")} />
          <Input aria-label={`${line.name} rate`} inputMode="decimal" placeholder="-" className={num} {...cellProps("rate")} />
          <Input aria-label={`${line.name} multiplier`} inputMode="decimal" placeholder="1" className={num} {...cellProps("multiplier")} />
          {showComputed ? (
            <span
              className={`text-right font-mono text-sm ${preview && "error" in preview ? "text-destructive" : "text-foreground"}`}
              title={preview && "error" in preview ? preview.error : formula}
              aria-label={`${line.name} total, computed`}
            >
              {preview === null ? formatCents(saved.cents) : "error" in preview ? "-" : formatCents(preview.cents)}
            </span>
          ) : (
            <Input aria-label={`${line.name} total`} inputMode="decimal" className={num} title={formula} {...cellProps("estimate")} />
          )}
        </>
      )}
      {lineKind ? (
        <LineKindCell
          lineName={line.name}
          kind={kind}
          source={kindSource}
          categoryKind={categoryKind}
          archived={archived}
          busy={busy}
          onSet={setKind}
        />
      ) : null}
      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" className="h-8 px-2 text-foreground-muted hover:text-foreground" title={archived ? "Restore" : "Archive"} disabled={busy} onClick={toggleArchive}>
          {archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
          <span className="sr-only">{archived ? "Restore" : "Archive"}</span>
        </Button>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive/80 hover:text-destructive" title="Delete" disabled={busy} onClick={onDelete}>
          <Trash2 className="w-4 h-4" />
          <span className="sr-only">Delete</span>
        </Button>
      </div>
    </div>
  )
}

function LineRow({
  projectId,
  line,
  categoryKind,
  lineKind,
  onMessage,
  onRefresh,
  onDelete,
}: {
  projectId: string
  line: BudgetLine
  categoryKind: FeeOrCost
  lineKind: boolean
  onMessage: (m: Msg) => void
  onRefresh: () => Promise<unknown>
  onDelete: () => void
}) {
  const savedCents = toCentsFromApi(line.estimate)
  const [name, setName] = useState(line.name)
  const [estimate, setEstimate] = useState(centsToDecimalString(savedCents))
  const [saving, setSaving] = useState(false)
  const archived = Boolean(line.archived_at)

  async function save(patch: Record<string, unknown>) {
    setSaving(true)
    try {
      await budgetPatch(`${projectBase(projectId)}/lines/${line.id}`, patch)
      onMessage(null)
      await onRefresh()
    } catch (e) {
      onMessage({ tone: "error", text: `${line.name}: ${errorMessage(e)}` })
      setName(line.name)
      setEstimate(centsToDecimalString(savedCents))
    } finally {
      setSaving(false)
    }
  }

  function commitName() {
    const next = name.trim()
    if (!next) return setName(line.name)
    if (next !== line.name) void save({ name: next })
  }

  function commitEstimate() {
    const money = parseMoneyToCents(estimate)
    if (!money.ok) {
      onMessage({ tone: "error", text: `${line.name}: ${money.reason}` })
      setEstimate(centsToDecimalString(savedCents))
      return
    }
    setEstimate(centsToDecimalString(money.cents))
    if (money.cents !== savedCents) void save({ estimate: centsToDecimalString(money.cents) })
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 px-4 py-2 ${archived ? "opacity-60" : ""}`}>
      {archived ? (
        <span className="flex-1 min-w-0 text-sm text-foreground-muted truncate">
          {line.name} <span className="font-mono text-2xs uppercase tracking-wider">· Archived</span>
        </span>
      ) : (
        <Input
          aria-label="Line name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          maxLength={300}
          className="flex-1 min-w-[12rem] h-8 bg-transparent border-transparent hover:border-border focus:border-border text-foreground"
          disabled={saving}
        />
      )}
      {archived ? (
        <span className="w-32 text-right font-mono text-sm text-foreground-muted">{formatCents(savedCents)}</span>
      ) : (
        <Input
          aria-label="Estimate"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          onBlur={commitEstimate}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          inputMode="decimal"
          className="w-32 h-8 text-right font-mono bg-transparent border-transparent hover:border-border focus:border-border text-foreground"
          disabled={saving}
        />
      )}
      {lineKind ? (
        <LineKindCell
          lineName={line.name}
          kind={line.fee_or_cost ?? categoryKind}
          source={line.fee_or_cost === null ? "inherited" : "override"}
          categoryKind={categoryKind}
          archived={archived}
          busy={saving}
          onSet={(kind) => void save({ kind })}
        />
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-foreground-muted hover:text-foreground"
        title={archived ? "Restore" : "Archive"}
        disabled={saving}
        onClick={() => save({ archived: !archived })}
      >
        {archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
        <span className="sr-only">{archived ? "Restore" : "Archive"}</span>
      </Button>
      <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive/80 hover:text-destructive" title="Delete" disabled={saving} onClick={onDelete}>
        <Trash2 className="w-4 h-4" />
        <span className="sr-only">Delete</span>
      </Button>
    </div>
  )
}
