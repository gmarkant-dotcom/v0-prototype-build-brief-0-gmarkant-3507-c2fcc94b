"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { BudgetErrorState, BudgetLoading, QuietEmpty, ActionMessage } from "@/components/budgeting/budget-states"
import { useBudgetProjects } from "@/lib/budget/hooks"
import { budgetPost, errorMessage, projectBase, BudgetApiError } from "@/lib/budget/client-api"
import { formatCents } from "@/lib/budget/money"
import type { ProjectBudgetOverview } from "@/lib/server/budget/overview"

const STATUS_LABEL: Record<ProjectBudgetOverview["budgetStatus"], string> = {
  no_chart: "No budget yet",
  chart: "Chart, no lines",
  totals: "Budgeted",
}

function BudgetingIndex() {
  const router = useRouter()
  const { data, error, isLoading, mutate } = useBudgetProjects()
  const [starting, setStarting] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  // Deduplicate by id at render level (house rule).
  const projects = (() => {
    const map = new Map<string, ProjectBudgetOverview>()
    for (const p of data?.projects ?? []) map.set(p.projectId, p)
    return Array.from(map.values())
  })()

  async function startBudget(p: ProjectBudgetOverview) {
    setStarting(p.projectId)
    setMessage(null)
    try {
      const res = await budgetPost<{ result: { copied: number } }>(`${projectBase(p.projectId)}/chart`, { action: "copy_template" })
      await mutate()
      router.push(`/agency/budgeting/${p.projectId}?started=${res.result.copied}`)
    } catch (e) {
      if (e instanceof BudgetApiError && e.kind === "conflict") {
        // The chart already exists (R6 refuses a second copy): open it.
        router.push(`/agency/budgeting/${p.projectId}`)
        return
      }
      setMessage({ tone: "error", text: `${p.name}: ${errorMessage(e)}` })
    } finally {
      setStarting(null)
    }
  }

  return (
    <div className="p-8 max-w-5xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-3xl text-foreground">Budgeting</h1>
          <p className="text-sm text-foreground-muted mt-1 max-w-2xl">
            Each project&apos;s working budget: estimates, actuals, fee versus cost and margin. Starting a budget copies your
            agency template onto the project; after that the project&apos;s chart is its own.
          </p>
        </div>
        <Button asChild variant="outline" className="border-border font-mono">
          <Link href="/agency/budgeting/templates">Agency template</Link>
        </Button>
      </div>

      <ActionMessage message={message} />

      {isLoading ? (
        <BudgetLoading label="Loading projects" />
      ) : error ? (
        <BudgetErrorState error={error} onRetry={() => mutate()} />
      ) : projects.length === 0 ? (
        <QuietEmpty>
          No projects yet. Create a project from the project menu, then start its budget here.
        </QuietEmpty>
      ) : (
        <section className="space-y-2">
          <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Projects ({projects.length})</div>
          {projects.map((p) => (
            <div
              key={p.projectId}
              className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-white/5 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-foreground truncate">{p.name}</div>
                <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted mt-0.5">
                  {[p.clientName || "No client", STATUS_LABEL[p.budgetStatus], p.budgetStatus === "no_chart" ? null : `${p.categoryCount} ${p.categoryCount === 1 ? "category" : "categories"}`, p.budgetStatus === "totals" ? `${p.lineCount} ${p.lineCount === 1 ? "line" : "lines"}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {p.budgetStatus === "totals" ? (
                <div className="text-right">
                  <div className="font-mono text-sm text-foreground">{formatCents(p.estimateCents)}</div>
                  <div className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">Estimate</div>
                </div>
              ) : null}
              {p.budgetStatus === "no_chart" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-accent/40 text-accent font-mono"
                  disabled={starting !== null}
                  onClick={() => startBudget(p)}
                >
                  {starting === p.projectId ? "Starting..." : "Start budget"}
                </Button>
              ) : (
                <Button asChild size="sm" variant="outline" className="border-border font-mono">
                  <Link href={`/agency/budgeting/${p.projectId}`}>Open budget →</Link>
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

export default function BudgetingPage() {
  return (
    <AgencyLayout>
      <BudgetingIndex />
    </AgencyLayout>
  )
}
