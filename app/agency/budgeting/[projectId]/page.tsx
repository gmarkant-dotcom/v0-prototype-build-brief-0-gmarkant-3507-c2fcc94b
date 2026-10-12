"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { ChevronLeft, Download } from "lucide-react"
import { AgencyLayout } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ActionMessage, BudgetErrorState, BudgetLoading } from "@/components/budgeting/budget-states"
import { BudgetTab } from "@/components/budgeting/budget-tab"
import { SummaryTab } from "@/components/budgeting/summary-tab"
import { LedgerTab } from "@/components/budgeting/ledger-tab"
import { DocumentsTab } from "@/components/budgeting/documents-tab"
import { useBudgetProject } from "@/lib/budget/hooks"
import { exportBudgetCsv, exportLedgerCsv } from "@/lib/budget/export"
import { errorMessage } from "@/lib/budget/client-api"

const tabTrigger =
  "rounded-full px-4 font-mono text-2xs uppercase tracking-wider text-foreground-muted data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"

function ProjectBudget() {
  const params = useParams<{ projectId: string }>()
  const projectId = typeof params?.projectId === "string" ? params.projectId : ""
  const search = useSearchParams()
  const started = search?.get("started")
  const project = useBudgetProject(projectId)
  const [tab, setTab] = useState("budget")
  const [exporting, setExporting] = useState<"budget" | "ledger" | null>(null)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(
    started === null || started === undefined
      ? null
      : started === "0"
        ? { tone: "ok", text: "Budget started. Your agency template is empty, so add categories below." }
        : { tone: "ok", text: `Budget started with ${started} ${started === "1" ? "category" : "categories"} copied from your agency template.` }
  )

  const name = project.data?.project.name ?? "Project"

  async function runExport(kind: "budget" | "ledger") {
    setExporting(kind)
    setMessage(null)
    try {
      const n = kind === "budget" ? await exportBudgetCsv(projectId, name) : await exportLedgerCsv(projectId, name)
      setMessage({ tone: "ok", text: kind === "budget" ? `Budget exported: ${n} ${n === 1 ? "line" : "lines"}.` : `Ledger exported: ${n} ${n === 1 ? "entry" : "entries"}, voided included.` })
    } catch (e) {
      setMessage({ tone: "error", text: `Export failed: ${errorMessage(e)}` })
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <Link href="/agency/budgeting" className="inline-flex items-center gap-1 font-mono text-2xs text-foreground-muted hover:text-foreground">
        <ChevronLeft className="w-3.5 h-3.5" /> Budgeting
      </Link>

      {project.isLoading ? (
        <BudgetLoading label="Loading project" />
      ) : project.error ? (
        <BudgetErrorState error={project.error} onRetry={() => project.mutate()} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display font-bold text-3xl text-foreground">{name}</h1>
              <p className="font-mono text-2xs uppercase tracking-wider text-foreground-muted mt-1">
                {project.data?.project.clientName || "No client"} · Working budget
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="border-border font-mono" disabled={exporting !== null} onClick={() => runExport("budget")}>
                <Download className="w-4 h-4" /> {exporting === "budget" ? "Exporting..." : "Budget CSV"}
              </Button>
              <Button variant="outline" size="sm" className="border-border font-mono" disabled={exporting !== null} onClick={() => runExport("ledger")}>
                <Download className="w-4 h-4" /> {exporting === "ledger" ? "Exporting..." : "Ledger CSV"}
              </Button>
            </div>
          </div>

          <ActionMessage message={message} />

          <Tabs value={tab} onValueChange={setTab} className="gap-6">
            <TabsList className="bg-white/5 border border-border rounded-full h-10 p-1">
              <TabsTrigger value="budget" className={tabTrigger}>
                Budget
              </TabsTrigger>
              <TabsTrigger value="summary" className={tabTrigger}>
                Summary
              </TabsTrigger>
              <TabsTrigger value="ledger" className={tabTrigger}>
                Ledger
              </TabsTrigger>
              <TabsTrigger value="documents" className={tabTrigger}>
                Documents
              </TabsTrigger>
            </TabsList>
            <TabsContent value="budget">
              <BudgetTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="summary">
              <SummaryTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="ledger">
              <LedgerTab projectId={projectId} />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentsTab projectId={projectId} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

export default function ProjectBudgetPage() {
  return (
    <AgencyLayout>
      <Suspense fallback={<div className="p-8"><BudgetLoading label="Loading project" /></div>}>
        <ProjectBudget />
      </Suspense>
    </AgencyLayout>
  )
}
