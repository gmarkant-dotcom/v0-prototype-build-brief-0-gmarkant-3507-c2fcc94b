"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { BudgetDialog } from "./budget-dialog"
import { ActionMessage, BudgetErrorState, BudgetLoading, labelClass, QuietEmpty, selectClass } from "./budget-states"
import { isManualDocument, useDocuments, usePartnerships } from "@/lib/budget/hooks"
import { useRefreshProject } from "@/lib/budget/use-refresh"
import { budgetPatch, budgetPost, errorMessage, projectBase } from "@/lib/budget/client-api"
import { formatDateTime } from "@/lib/utils"
import type { SourceDocument } from "@/lib/server/budget/schema"

/**
 * DOCUMENTS: recorded metadata only (no storage upload in this run).
 *
 * R4: a vendor sees an agency document only when it is toggled visible AND its partnership is
 * active or suspended; a vendor always sees what its own side uploaded. Row level security
 * enforces all of it; this screen only sets the toggle. Turning it on for an unshared document
 * asks which vendor (the database requires a partnership, and a set partnership cannot change).
 *
 * R3: archive and unarchive are per project, hide documents from working views, keep every file,
 * and change no one's access.
 */

const th = "px-3 py-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted"
const SHAREABLE = new Set(["active", "suspended"])

export function DocumentsTab({ projectId }: { projectId: string }) {
  const [showArchived, setShowArchived] = useState(false)
  const documents = useDocuments(projectId, true)
  const partnerships = usePartnerships(projectId)
  const refresh = useRefreshProject(projectId)
  const base = projectBase(projectId)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState<SourceDocument | null>(null)
  const [shareWith, setShareWith] = useState("")
  const [archiveDialog, setArchiveDialog] = useState<"archive" | "unarchive" | null>(null)

  const model = useMemo(() => {
    const all = (() => {
      const m = new Map<string, SourceDocument>()
      for (const d of documents.data?.documents ?? []) m.set(d.id, d)
      return Array.from(m.values())
    })()
    const vendorName = new Map((partnerships.data?.partnerships ?? []).map((p) => [p.id, p.vendorName]))
    const partnershipStatus = new Map((partnerships.data?.partnerships ?? []).map((p) => [p.id, p.status]))
    const shareable = (partnerships.data?.partnerships ?? []).filter((p) => SHAREABLE.has(p.status))
    return {
      all,
      visible: all.filter((d) => showArchived || !d.archived_at),
      archivedCount: all.filter((d) => d.archived_at).length,
      liveCount: all.filter((d) => !d.archived_at).length,
      vendorName,
      partnershipStatus,
      shareable,
    }
  }, [documents.data, partnerships.data, showArchived])

  if (documents.isLoading || partnerships.isLoading) return <BudgetLoading label="Loading documents" />
  if (documents.error) return <BudgetErrorState error={documents.error} onRetry={() => refresh()} feature="Budget documents" />

  async function setVisible(doc: SourceDocument, visible: boolean, partnershipId?: string) {
    setBusy(true)
    setMessage(null)
    try {
      await budgetPatch(`${base}/documents/${doc.id}`, partnershipId ? { visibleToVendor: visible, partnershipId } : { visibleToVendor: visible })
      const who = model.vendorName.get(partnershipId ?? doc.partnership_id ?? "") ?? "the vendor"
      setMessage({ tone: "ok", text: visible ? `${doc.file_name} is visible to ${who}.` : `${doc.file_name} is hidden from ${who}.` })
      setSharing(null)
      await refresh()
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  async function setArchived(action: "archive" | "unarchive") {
    setBusy(true)
    setMessage(null)
    try {
      const res = await budgetPost<{ result: { changed: number } }>(`${base}/documents`, { action })
      const n = res.result.changed
      setMessage({
        tone: "ok",
        text: action === "archive" ? `${n} ${n === 1 ? "document" : "documents"} archived. Files are kept and access is unchanged.` : `${n} ${n === 1 ? "document" : "documents"} restored.`,
      })
      setArchiveDialog(null)
      await refresh()
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  function onToggle(doc: SourceDocument, next: boolean) {
    if (next && !doc.partnership_id) {
      setShareWith("")
      setSharing(doc)
      return
    }
    void setVisible(doc, next)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
          {model.liveCount} {model.liveCount === 1 ? "document" : "documents"} · {model.archivedCount} archived
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 font-mono text-2xs uppercase tracking-wider text-foreground-muted">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} className="data-[state=checked]:bg-accent" />
            Show archived
          </label>
          <Button variant="outline" size="sm" className="border-border font-mono" disabled={busy || model.liveCount === 0} onClick={() => setArchiveDialog("archive")}>
            Archive all
          </Button>
          <Button variant="outline" size="sm" className="border-border font-mono" disabled={busy || model.archivedCount === 0} onClick={() => setArchiveDialog("unarchive")}>
            Unarchive all
          </Button>
        </div>
      </div>

      <ActionMessage message={message} />
      {partnerships.error ? <p className="text-sm text-warning">Vendor names could not be loaded: {errorMessage(partnerships.error)}</p> : null}

      {model.visible.length === 0 ? (
        <QuietEmpty>
          {model.all.length === 0
            ? "No documents recorded yet. Manual ledger entries record a reference here; file upload comes later."
            : "Every document is archived. Turn on Show archived to see them."}
        </QuietEmpty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className={th}>Document</th>
                <th className={th}>Source</th>
                <th className={th}>Vendor</th>
                <th className={th}>Recorded</th>
                <th className={th}>Visible to vendor</th>
              </tr>
            </thead>
            <tbody>
              {model.visible.map((d) => {
                const manual = isManualDocument(d)
                const vendor = d.partnership_id ? model.vendorName.get(d.partnership_id) ?? "A vendor" : null
                const status = d.partnership_id ? model.partnershipStatus.get(d.partnership_id) : undefined
                return (
                  <tr key={d.id} className={`border-t border-border align-top ${d.archived_at ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2 text-foreground">
                      {d.file_name}
                      <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                        {[manual ? "Manual entry, no file" : "File", d.archived_at ? "Archived" : null].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-foreground-muted">{d.uploader_side === "vendor" ? "Vendor upload" : "Agency"}</td>
                    <td className="px-3 py-2 text-foreground-muted">
                      {vendor ?? "Not shared"}
                      {status && !SHAREABLE.has(status) ? (
                        <div className="font-mono text-2xs uppercase tracking-wider text-warning">{status}: cannot see agency documents</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-foreground-muted whitespace-nowrap">{formatDateTime(d.created_at)}</td>
                    <td className="px-3 py-2">
                      {d.uploader_side === "vendor" ? (
                        <span className="text-xs text-foreground-muted">Always (their upload)</span>
                      ) : (
                        <Switch
                          checked={d.visible_to_vendor}
                          disabled={busy}
                          onCheckedChange={(v) => onToggle(d, v)}
                          aria-label={`Visible to vendor: ${d.file_name}`}
                          className="data-[state=checked]:bg-accent"
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <BudgetDialog
        open={sharing !== null}
        onOpenChange={(o) => !o && setSharing(null)}
        title="Share with a vendor"
        description="Choose the vendor who may see this document. Once chosen, the document stays tied to that vendor; you can hide it again at any time. Only vendors with an active or suspended relationship can see shared documents."
        confirmLabel="Share"
        confirmDisabled={!shareWith}
        busy={busy}
        onConfirm={() => sharing && setVisible(sharing, true, shareWith)}
      >
        {model.shareable.length === 0 ? (
          <p className="text-sm text-foreground-muted">No vendor has an active relationship with your agency yet.</p>
        ) : (
          <div>
            <label className={labelClass}>Vendor</label>
            <select className={`${selectClass} w-full`} value={shareWith} onChange={(e) => setShareWith(e.target.value)}>
              <option value="">Choose...</option>
              {model.shareable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.vendorName}
                  {p.status === "suspended" ? " (suspended)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </BudgetDialog>

      <BudgetDialog
        open={archiveDialog !== null}
        onOpenChange={(o) => !o && setArchiveDialog(null)}
        title={archiveDialog === "archive" ? "Archive every document on this project?" : "Unarchive every document on this project?"}
        description={
          archiveDialog === "archive"
            ? "Archiving hides the documents from working views. Every file is kept, nobody's access changes, and you can unarchive at any time."
            : "The documents return to working views. Access does not change."
        }
        confirmLabel={archiveDialog === "archive" ? "Archive all" : "Unarchive all"}
        busy={busy}
        onConfirm={() => archiveDialog && setArchived(archiveDialog)}
      />
    </div>
  )
}
