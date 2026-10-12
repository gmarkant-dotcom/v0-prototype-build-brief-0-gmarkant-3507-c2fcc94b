"use client"

import { useMemo, useState } from "react"
import { Archive, ArchiveRestore, ArrowUpFromLine, GitMerge, Pencil, Repeat, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { BudgetDialog } from "./budget-dialog"
import { ActionMessage, BudgetErrorState, BudgetLoading, FeeCostBadge, labelClass, QuietEmpty, selectClass } from "./budget-states"
import { ImportSheet } from "./import-sheet"
import { useChart, useLines } from "@/lib/budget/hooks"
import { useRefreshProject, useRefreshTemplate } from "@/lib/budget/use-refresh"
import { BudgetApiError, budgetDelete, budgetFetch, budgetPatch, budgetPost, errorMessage, projectBase } from "@/lib/budget/client-api"
import { centsToDecimalString, formatCents, parseMoneyToCents, toCentsFromApi } from "@/lib/budget/money"
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
  const [newCatFlag, setNewCatFlag] = useState<FeeOrCost | "">("")
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
    if (!newCatName.trim() || !newCatFlag) {
      setMessage({ tone: "error", text: "Name the category and mark it fee or cost." })
      return
    }
    const ok = await run(async () => {
      await budgetPost(`${base}/chart`, { action: "add", name: newCatName.trim(), feeOrCost: newCatFlag })
      return `Added ${newCatName.trim()}.`
    })
    if (ok) {
      setNewCatName("")
      setNewCatFlag("")
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
          <select aria-label="Fee or cost" className={selectClass} value={newCatFlag} onChange={(e) => setNewCatFlag(e.target.value as FeeOrCost | "")}>
            <option value="">Fee or cost?</option>
            <option value="fee">Fee (the agency earns it)</option>
            <option value="cost">Cost (third-party spend)</option>
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
  const [adding, setAdding] = useState(false)
  const subtotal = lines.filter((l) => !l.archived_at).reduce((a, l) => a + toCentsFromApi(l.estimate), 0)
  const archived = Boolean(category.archived_at)

  async function addLine() {
    const money = parseMoneyToCents(estimate || "0")
    if (!name.trim()) return onMessage({ tone: "error", text: "Name the line." })
    if (!money.ok) return onMessage({ tone: "error", text: `Estimate: ${money.reason}` })
    setAdding(true)
    try {
      await budgetPost(`${projectBase(projectId)}/lines`, { categoryId: category.id, name: name.trim(), estimate: centsToDecimalString(money.cents) })
      setName("")
      setEstimate("")
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
      <div className="divide-y divide-border">
        {lines.length === 0 ? <p className="px-4 py-3 text-sm text-foreground-muted">No lines yet.</p> : null}
        {lines.map((l) => (
          <LineRow key={`${l.id}:${l.name}:${l.estimate}:${l.archived_at ?? ""}`} projectId={projectId} line={l} onMessage={onMessage} onRefresh={onRefresh} onDelete={() => onDeleteLine(l)} />
        ))}
      </div>
      {!archived ? (
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

function LineRow({
  projectId,
  line,
  onMessage,
  onRefresh,
  onDelete,
}: {
  projectId: string
  line: BudgetLine
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
