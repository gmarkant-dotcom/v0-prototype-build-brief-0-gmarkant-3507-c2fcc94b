"use client"

import { useState } from "react"
import Link from "next/link"
import { Archive, ArchiveRestore, ChevronLeft, Trash2 } from "lucide-react"
import { AgencyLayout } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { BudgetDialog } from "@/components/budgeting/budget-dialog"
import { ActionMessage, BudgetErrorState, BudgetLoading, labelClass, QuietEmpty, selectClass } from "@/components/budgeting/budget-states"
import { TemplateComposer } from "@/components/budgeting/template-composer"
import { useTemplate } from "@/lib/budget/hooks"
import { useRefreshTemplate } from "@/lib/budget/use-refresh"
import { budgetDelete, budgetPatch, budgetPost, errorMessage } from "@/lib/budget/client-api"
import { categoryNameKey } from "@/lib/budget/starter-templates"
import type { FeeOrCost, TemplateCategory } from "@/lib/server/budget/schema"

type Msg = { tone: "ok" | "error"; text: string } | null

/**
 * THE AGENCY TEMPLATE: the house standard every new project budget is copied from (R6, copy on
 * create). Editing it never changes an existing project. Template rows are referenced by nothing,
 * so R1 allows a hard delete; archive hides a category from new budgets and keeps it.
 */
function TemplateEditor() {
  const [showArchived, setShowArchived] = useState(false)
  const template = useTemplate(true)
  const refresh = useRefreshTemplate()
  const [message, setMessage] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")
  const [flag, setFlag] = useState<FeeOrCost | "">("")
  const [deleting, setDeleting] = useState<TemplateCategory | null>(null)

  const all = (() => {
    const m = new Map<string, TemplateCategory>()
    for (const c of template.data?.categories ?? []) m.set(c.id, c)
    return Array.from(m.values())
  })()
  const visible = all.filter((c) => showArchived || !c.archived_at)
  const live = all.filter((c) => !c.archived_at)

  async function act(fn: () => Promise<string>) {
    setBusy(true)
    setMessage(null)
    try {
      setMessage({ tone: "ok", text: await fn() })
      await refresh()
      return true
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) })
      await refresh()
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    const n = name.trim()
    if (!n || !flag) return setMessage({ tone: "error", text: "Name the category and mark it fee or cost." })
    const dup = all.find((c) => categoryNameKey(c.name) === categoryNameKey(n))
    if (dup) return setMessage({ tone: "error", text: dup.archived_at ? `${dup.name} is already in the template, archived. Restore it instead.` : `${dup.name} is already in the template.` })
    const ok = await act(async () => {
      await budgetPost("/api/agency/budget/templates", { name: n, feeOrCost: flag })
      return `${n} added to the template.`
    })
    if (ok) {
      setName("")
      setFlag("")
    }
  }

  return (
    <div className="p-8 max-w-5xl space-y-8">
      <Link href="/agency/budgeting" className="inline-flex items-center gap-1 font-mono text-2xs text-foreground-muted hover:text-foreground">
        <ChevronLeft className="w-3.5 h-3.5" /> Budgeting
      </Link>
      <div>
        <h1 className="font-display font-bold text-3xl text-foreground">Agency Template</h1>
        <p className="text-sm text-foreground-muted mt-1 max-w-2xl">
          Your house chart of budget categories. Every new project budget starts as a copy of it; changing it later does not change any existing
          project. Mark each category fee (the agency earns it) or cost (third-party spend): margin is computed from that flag.
        </p>
      </div>

      {template.isLoading ? (
        <BudgetLoading label="Loading template" />
      ) : template.error ? (
        <BudgetErrorState error={template.error} onRetry={() => refresh()} />
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                Template ({live.length}) · {live.filter((c) => c.fee_or_cost === "fee").length} fee · {live.filter((c) => c.fee_or_cost === "cost").length} cost
              </div>
              <label className="flex items-center gap-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                <Switch checked={showArchived} onCheckedChange={setShowArchived} className="data-[state=checked]:bg-accent" />
                Show archived
              </label>
            </div>
            <ActionMessage message={message} />
            {visible.length === 0 ? (
              <QuietEmpty>{all.length === 0 ? "Your template is empty. Compose it from the starters below, or add categories one at a time." : "Every category is archived."}</QuietEmpty>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-white/5">
                {visible.map((c) => (
                  <TemplateRow
                    key={`${c.id}:${c.name}:${c.fee_or_cost}:${c.archived_at ?? ""}`}
                    category={c}
                    busy={busy}
                    onRename={(n) => act(async () => {
                      await budgetPatch(`/api/agency/budget/templates/${c.id}`, { name: n })
                      return `Renamed to ${n}. Existing projects keep their own names.`
                    })}
                    onFlag={(f) => act(async () => {
                      await budgetPatch(`/api/agency/budget/templates/${c.id}`, { feeOrCost: f })
                      return `${c.name} is now ${f} for new budgets.`
                    })}
                    onArchive={() => act(async () => {
                      await budgetPatch(`/api/agency/budget/templates/${c.id}`, { archived: !c.archived_at })
                      return c.archived_at ? `${c.name} restored.` : `${c.name} archived. New budgets will not include it.`
                    })}
                    onDelete={() => setDeleting(c)}
                  />
                ))}
              </ul>
            )}
            <div className="rounded-lg border border-border bg-white/5 p-4">
              <div className={labelClass}>Add a category</div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Category name"
                  maxLength={200}
                  className="bg-background border-border text-foreground max-w-xs"
                  onKeyDown={(e) => e.key === "Enter" && add()}
                />
                <select aria-label="Fee or cost" className={selectClass} value={flag} onChange={(e) => setFlag(e.target.value as FeeOrCost | "")}>
                  <option value="">Fee or cost?</option>
                  <option value="fee">Fee (the agency earns it)</option>
                  <option value="cost">Cost (third-party spend)</option>
                </select>
                <Button variant="outline" className="border-border font-mono" disabled={busy} onClick={add}>
                  Add category
                </Button>
              </div>
            </div>
          </section>

          <TemplateComposer existing={all} onDone={() => refresh()} />
        </>
      )}

      <BudgetDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : "Delete"}
        description="It is removed from the template. Projects that already copied it keep their own copy. To keep it but leave it out of new budgets, archive it instead."
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={async () => {
          if (!deleting) return
          const c = deleting
          const ok = await act(async () => {
            await budgetDelete(`/api/agency/budget/templates/${c.id}`)
            return `${c.name} deleted from the template.`
          })
          if (ok) setDeleting(null)
        }}
      />
    </div>
  )
}

function TemplateRow({
  category,
  busy,
  onRename,
  onFlag,
  onArchive,
  onDelete,
}: {
  category: TemplateCategory
  busy: boolean
  onRename: (name: string) => Promise<boolean>
  onFlag: (flag: FeeOrCost) => Promise<boolean>
  onArchive: () => void
  onDelete: () => void
}) {
  const [name, setName] = useState(category.name)
  const archived = Boolean(category.archived_at)
  return (
    <li className={`flex flex-wrap items-center gap-2 px-3 py-2 ${archived ? "opacity-60" : ""}`}>
      <Input
        aria-label="Category name"
        value={name}
        maxLength={200}
        disabled={busy || archived}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim()
          if (!n) setName(category.name)
          else if (n !== category.name) void onRename(n)
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="flex-1 min-w-[12rem] h-8 bg-transparent border-transparent hover:border-border focus:border-border text-foreground"
      />
      {archived ? <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Archived</span> : null}
      <select
        aria-label={`Fee or cost for ${category.name}`}
        className={`${selectClass} h-8`}
        value={category.fee_or_cost}
        disabled={busy || archived}
        onChange={(e) => void onFlag(e.target.value as FeeOrCost)}
      >
        <option value="fee">Fee</option>
        <option value="cost">Cost</option>
      </select>
      <Button variant="ghost" size="sm" className="h-8 px-2 text-foreground-muted hover:text-foreground" disabled={busy} onClick={onArchive} title={archived ? "Restore" : "Archive"}>
        {archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
        <span className="sr-only">{archived ? "Restore" : "Archive"}</span>
      </Button>
      <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive/80 hover:text-destructive" disabled={busy} onClick={onDelete} title="Delete">
        <Trash2 className="w-4 h-4" />
        <span className="sr-only">Delete</span>
      </Button>
    </li>
  )
}

export default function AgencyTemplatePage() {
  return (
    <AgencyLayout>
      <TemplateEditor />
    </AgencyLayout>
  )
}
