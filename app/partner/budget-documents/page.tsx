"use client"

import useSWR from "swr"
import { Loader2 } from "lucide-react"
import { PartnerLayout } from "@/components/partner-layout"
import { budgetFetch, BudgetApiError } from "@/lib/budget/client-api"
import { formatDateTime } from "@/lib/utils"
import type { VendorDocumentGroup } from "@/lib/server/budget/vendor-documents"

/**
 * BUDGET DOCUMENTS, VENDOR SIDE. Read-only. Lists, per project, the documents a lead agency has
 * shared with this vendor and the documents this vendor provided. Row level security decides what
 * is listed (GET /api/partner/budget-documents). No upload, no download, no budget, no amounts.
 */

const th = "px-4 py-2 text-left font-mono text-2xs uppercase tracking-wider text-vendor-muted"

function BudgetDocuments() {
  const { data, error, isLoading } = useSWR<{ projects: VendorDocumentGroup[] }>(
    "/api/partner/budget-documents",
    (u: string) => budgetFetch<{ projects: VendorDocumentGroup[] }>(u),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  )
  const notEnabled = error instanceof BudgetApiError && error.kind === "not_enabled"
  const groups = (() => {
    const m = new Map<string, VendorDocumentGroup>()
    for (const g of data?.projects ?? []) m.set(`${g.projectId}:${g.agencyName}`, g)
    return Array.from(m.values())
  })()

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="font-display font-bold text-3xl text-vendor-foreground">Budget Documents</h1>
        <p className="text-vendor-muted-strong mt-1">
          Documents your lead agencies have chosen to share with you, and documents you provided, by project.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-vendor-muted py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading documents
        </div>
      ) : notEnabled ? (
        <div className="bg-vendor-surface rounded-xl border border-vendor-border p-8 text-center text-sm text-vendor-muted-strong">
          Budget documents are not available yet.
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error instanceof BudgetApiError && error.kind === "forbidden" ? error.message : "Documents could not be loaded. Refresh to try again."}
        </div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-vendor-muted">No documents have been shared with you yet.</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={`${g.projectId}:${g.agencyName}`} className="rounded-xl border border-vendor-border bg-vendor-surface">
              <header className="px-4 py-3 border-b border-vendor-border">
                <h2 className="font-bold text-vendor-foreground">{g.projectName}</h2>
                <p className="font-mono text-2xs uppercase tracking-wider text-vendor-muted">
                  {g.agencyName} · {g.documents.length} {g.documents.length === 1 ? "document" : "documents"}
                </p>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Name</th>
                      <th className={th}>Type</th>
                      <th className={th}>Source</th>
                      <th className={`${th} text-right`}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.documents.map((d) => (
                      <tr key={d.id} className="border-t border-vendor-border">
                        <td className="px-4 py-2 text-vendor-foreground">
                          {d.fileName}
                          {d.archived ? <span className="ml-2 font-mono text-2xs uppercase tracking-wider text-vendor-muted">Archived</span> : null}
                        </td>
                        <td className="px-4 py-2 text-vendor-muted-strong">{d.type}</td>
                        <td className="px-4 py-2 text-vendor-muted-strong">{d.source === "you" ? "You" : "Lead agency"}</td>
                        <td className="px-4 py-2 text-right text-vendor-muted-strong whitespace-nowrap">{formatDateTime(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PartnerBudgetDocumentsPage() {
  return (
    <PartnerLayout>
      <BudgetDocuments />
    </PartnerLayout>
  )
}
