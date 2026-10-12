"use client"

import { useMemo, useState } from "react"
import { Ban } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { BudgetDialog } from "./budget-dialog"
import { ActionMessage, BudgetErrorState, BudgetLoading, labelClass, QuietEmpty, selectClass } from "./budget-states"
import { formatDateOnly, isManualDocument, manualBlobPrefix, useChart, useDocuments, useLedger, useLines } from "@/lib/budget/hooks"
import { useRefreshProject } from "@/lib/budget/use-refresh"
import { budgetPost, errorMessage, projectBase } from "@/lib/budget/client-api"
import { centsToDecimalString, formatCents, parseMoneyToCents, toCentsFromApi } from "@/lib/budget/money"
import type { LedgerEntry, SourceDocument } from "@/lib/server/budget/schema"

/**
 * THE LEDGER. R2: nothing here deletes. An entry is voided, optionally as a duplicate of the entry
 * kept, with a reason; voided entries stay listed, struck through, and are excluded from Actual.
 *
 * Every entry needs a source document (ledger_entries.source_document_id is NOT NULL in 104). A
 * manual entry with no file records a "manual reference" document first, under
 * budget/<projectId>/manual/, with no bytes behind it. docs/budget-actuals-feeder-plan.md proposes
 * a real document kind for this.
 */

const MANUAL = "__manual__"
const th = "px-3 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted"

export function LedgerTab({ projectId }: { projectId: string }) {
  const ledger = useLedger(projectId)
  const chart = useChart(projectId, true)
  const lines = useLines(projectId, true)
  const documents = useDocuments(projectId, true)
  const refresh = useRefreshProject(projectId)
  const base = projectBase(projectId)

  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ date: "", payee: "", amount: "", categoryId: "", lineId: "", documentId: "" })
  const [voiding, setVoiding] = useState<LedgerEntry | null>(null)
  const [keepId, setKeepId] = useState("")
  const [reason, setReason] = useState("")

  const model = useMemo(() => {
    const entries = (() => {
      const m = new Map<string, LedgerEntry>()
      for (const e of ledger.data?.entries ?? []) m.set(e.id, e)
      return Array.from(m.values())
    })()
    const retired = new Set((chart.data?.merges ?? []).map((m) => m.from_category_id))
    const categories = chart.data?.categories ?? []
    const categoryName = new Map(categories.map((c) => [c.id, c.name]))
    const liveCategories = categories.filter((c) => !c.archived_at && !retired.has(c.id))
    const allLines = lines.data?.lines ?? []
    const lineName = new Map(allLines.map((l) => [l.id, l.name]))
    const docs = documents.data?.documents ?? []
    const docById = new Map(docs.map((d) => [d.id, d]))
    const active = entries.filter((e) => !e.voided_at)
    const activeCents = active.reduce((a, e) => a + toCentsFromApi(e.amount), 0)
    return { entries, categoryName, liveCategories, allLines, lineName, docs, docById, active, activeCents }
  }, [ledger.data, chart.data, lines.data, documents.data])

  if (ledger.isLoading || chart.isLoading || lines.isLoading || documents.isLoading) return <BudgetLoading label="Loading ledger" />
  const error = ledger.error ?? chart.error ?? lines.error ?? documents.error
  if (error) return <BudgetErrorState error={error} onRetry={() => refresh()} />

  const entryLabel = (e: LedgerEntry) =>
    [formatDateOnly(e.entry_date), e.payee_name || "No payee", formatCents(toCentsFromApi(e.amount))].join(" · ")

  async function addEntry() {
    const money = parseMoneyToCents(form.amount)
    if (!money.ok) return setMessage({ tone: "error", text: `Amount: ${money.reason}` })
    if (!form.categoryId) return setMessage({ tone: "error", text: "Choose a category." })
    if (!form.documentId) return setMessage({ tone: "error", text: "Choose the document this entry comes from, or Manual entry." })
    setBusy(true)
    setMessage(null)
    let documentId = form.documentId
    let manualName: string | null = null
    try {
      if (documentId === MANUAL) {
        manualName = `Manual entry: ${form.payee.trim() || "no payee"}${form.date ? ` (${form.date})` : ""}`.slice(0, 300)
        const rec = await budgetPost<{ document: SourceDocument }>(`${base}/documents`, {
          action: "record",
          fileName: manualName,
          blobPath: `${manualBlobPrefix(projectId)}${crypto.randomUUID()}`,
        })
        documentId = rec.document.id
      }
    } catch (e) {
      setBusy(false)
      return setMessage({ tone: "error", text: `The manual reference could not be recorded: ${errorMessage(e)}` })
    }
    try {
      await budgetPost(`${base}/ledger`, {
        sourceDocumentId: documentId,
        categoryId: form.categoryId,
        budgetLineId: form.lineId || null,
        amount: centsToDecimalString(money.cents),
        payeeName: form.payee.trim() || undefined,
        entryDate: form.date || undefined,
      })
      setForm({ date: "", payee: "", amount: "", categoryId: form.categoryId, lineId: "", documentId: "" })
      setMessage({ tone: "ok", text: `Entry added: ${formatCents(money.cents)}.` })
    } catch (e) {
      setMessage({
        tone: "error",
        text: manualName
          ? `The manual reference "${manualName}" was recorded, but the entry was not saved: ${errorMessage(e)}. Try again and choose that reference as the document.`
          : `The entry was not saved: ${errorMessage(e)}`,
      })
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  async function confirmVoid() {
    if (!voiding || !reason.trim()) return
    setBusy(true)
    try {
      await budgetPost(`${base}/ledger/${voiding.id}/void`, { reason: reason.trim(), duplicateOf: keepId || null })
      setMessage({ tone: "ok", text: `Entry voided${keepId ? " as a duplicate" : ""}. It stays in the ledger and no longer counts toward Actual.` })
      setVoiding(null)
      await refresh()
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const linesForCategory = model.allLines.filter((l) => !l.archived_at && l.category_id === form.categoryId)

  return (
    <div className="space-y-6">
      <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
        {model.active.length} {model.active.length === 1 ? "entry" : "entries"} · {model.entries.length - model.active.length} voided · Actual{" "}
        {formatCents(model.activeCents)}
      </div>

      <ActionMessage message={message} />

      <section className="rounded-lg border border-border bg-white/5 p-4 space-y-3">
        <div className={labelClass}>Add an entry</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Date</label>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="bg-background border-border text-foreground [color-scheme:dark]" />
          </div>
          <div>
            <label className={labelClass}>Payee</label>
            <Input value={form.payee} maxLength={300} onChange={(e) => setForm({ ...form, payee: e.target.value })} className="bg-background border-border text-foreground" />
          </div>
          <div>
            <label className={labelClass}>Amount (a credit is negative)</label>
            <Input
              value={form.amount}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="bg-background border-border text-foreground text-right font-mono"
            />
          </div>
          <div>
            <label className={labelClass}>Category</label>
            <select className={`${selectClass} w-full`} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value, lineId: "" })}>
              <option value="">Choose...</option>
              {model.liveCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Line (optional)</label>
            <select className={`${selectClass} w-full`} value={form.lineId} disabled={!form.categoryId} onChange={(e) => setForm({ ...form, lineId: e.target.value })}>
              <option value="">Not on a line</option>
              {linesForCategory.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Document</label>
            <select className={`${selectClass} w-full`} value={form.documentId} onChange={(e) => setForm({ ...form, documentId: e.target.value })}>
              <option value="">Choose...</option>
              <option value={MANUAL}>Manual entry (no file)</option>
              {model.docs
                .filter((d) => !d.archived_at)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.file_name}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <Button variant="outline" className="border-border font-mono" disabled={busy || model.liveCategories.length === 0} onClick={addEntry}>
          {busy ? "Saving..." : "Add entry"}
        </Button>
        {model.liveCategories.length === 0 ? <p className="text-xs text-foreground-muted">Add a category on the Budget tab first.</p> : null}
      </section>

      {model.entries.length === 0 ? (
        <QuietEmpty>No ledger entries yet. Entries you add appear here; nothing in the ledger can be deleted, only voided.</QuietEmpty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className={th}>Date</th>
                <th className={th}>Payee</th>
                <th className={th}>Category</th>
                <th className={th}>Line</th>
                <th className={th}>Document</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {model.entries.map((e) => {
                const voided = Boolean(e.voided_at)
                const strike = voided ? "line-through text-foreground-muted" : "text-foreground"
                const doc = model.docById.get(e.source_document_id)
                const kept = e.duplicate_of ? model.entries.find((x) => x.id === e.duplicate_of) : undefined
                return (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className={`px-3 py-2 whitespace-nowrap ${strike}`}>{formatDateOnly(e.entry_date)}</td>
                    <td className={`px-3 py-2 ${strike}`}>{e.payee_name || "-"}</td>
                    <td className={`px-3 py-2 ${strike}`}>
                      {model.categoryName.get(e.category_id) ?? "-"}
                      {e.original_category_id !== e.category_id ? (
                        <div className="font-mono text-2xs text-foreground-muted no-underline">
                          Filed under {model.categoryName.get(e.original_category_id) ?? "another category"}
                        </div>
                      ) : null}
                    </td>
                    <td className={`px-3 py-2 ${strike}`}>{e.budget_line_id ? model.lineName.get(e.budget_line_id) ?? "-" : "-"}</td>
                    <td className={`px-3 py-2 ${strike}`}>{doc ? (isManualDocument(doc) ? "Manual entry" : doc.file_name) : "-"}</td>
                    <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${strike}`}>{formatCents(toCentsFromApi(e.amount))}</td>
                    <td className="px-3 py-2 text-xs">
                      {voided ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex rounded-full border border-border bg-white/5 px-2 py-0.5 font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                            Voided
                          </span>
                          {e.void_reason ? <div className="text-foreground-muted">{e.void_reason}</div> : null}
                          {e.duplicate_of ? <div className="text-foreground-muted">Duplicate of {kept ? entryLabel(kept) : "another entry"}</div> : null}
                        </div>
                      ) : (
                        <span className="text-success">Counts toward Actual</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!voided ? (
                        <Button
                          variant="destructive-outline"
                          size="sm"
                          className="h-7"
                          onClick={() => {
                            setVoiding(e)
                            setKeepId("")
                            setReason("")
                          }}
                        >
                          <Ban className="w-3.5 h-3.5" /> Void
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <BudgetDialog
        open={voiding !== null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title="Void this entry"
        description={
          voiding
            ? `${entryLabel(voiding)}. A voided entry is never deleted: it stays in the ledger, struck through, and stops counting toward Actual. This cannot be undone.`
            : undefined
        }
        confirmLabel="Void entry"
        destructive
        busy={busy}
        confirmDisabled={!reason.trim()}
        onConfirm={confirmVoid}
      >
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Duplicate of (the entry kept)</label>
            <select className={`${selectClass} w-full`} value={keepId} onChange={(e) => setKeepId(e.target.value)}>
              <option value="">Not a duplicate (voided for another reason)</option>
              {model.active
                .filter((x) => x.id !== voiding?.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {entryLabel(x)}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Reason (required)</label>
            <Textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} className="bg-background border-border text-foreground" />
          </div>
        </div>
      </BudgetDialog>
    </div>
  )
}
