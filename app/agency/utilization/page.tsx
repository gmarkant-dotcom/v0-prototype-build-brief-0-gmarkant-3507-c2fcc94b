"use client"

import { useEffect, useState } from "react"
import { AgencyLayout } from "@/components/agency-layout"
import { GlassCard } from "@/components/glass-card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { cn } from "@/lib/utils"
import { Loader2, TrendingDown, TrendingUp, Wallet } from "lucide-react"

type ScopeRow = {
  response_id: string
  scope_item_name: string
  estimated_amount: number | null
  awarded_amount: number | null
  currency: string
  variance: number | null
  project_assignment_id: string | null
  partner_completion_pct: number | null
}

type ProjectRow = {
  project_id: string
  project_name: string
  client_name: string | null
  client_budget: number | null
  scopes: ScopeRow[]
  total_awarded: number
  currency: string
  mixed_currency: boolean
}

type Summary = {
  total_client_budget: number | null
  total_awarded: number | null
  total_awarded_all: number
  total_margin: number | null
  currency: string | null
  mixed_currencies: boolean
  by_currency: Array<{
    currency: string
    total_awarded: number
  }>
}

function formatMoney(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency === "MIXED" ? "USD" : currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString("en-US")} ${currency}`
  }
}

/** Client budget (numeric from project) — display as USD. */
function formatClientBudget(amount: number | null): string {
  if (amount == null || amount === 0) return "—"
  return formatMoney(amount, "USD")
}

/** Green: at or under estimate. Amber: over by ≤10%. Red: over by >10%. */
function varianceTone(
  variance: number | null,
  estimated: number | null
): "green" | "amber" | "red" | "neutral" {
  if (variance == null || estimated == null || estimated <= 0) return "neutral"
  if (variance >= 0) return "green"
  const over = -variance
  const pct = over / estimated
  if (pct <= 0.1) return "amber"
  return "red"
}

function marginTone(margin: number | null): "green" | "amber" | "red" | "neutral" {
  if (margin == null) return "neutral"
  if (margin >= 0) return "green"
  return "red"
}

function toneClass(tone: "green" | "amber" | "red" | "neutral"): string {
  switch (tone) {
    case "green":
      return "text-emerald-400"
    case "amber":
      return "text-amber-400"
    case "red":
      return "text-red-400"
    default:
      return "text-foreground-muted"
  }
}

function UtilBar({
  clientBudget,
  awarded,
  currency,
}: {
  clientBudget: number
  awarded: number
  currency: string
}) {
  const awardedPct = clientBudget > 0 ? Math.min(100, (awarded / clientBudget) * 100) : awarded > 0 ? 100 : 0
  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between text-xs text-foreground-muted mb-1">
          <span>Client budget</span>
          <span className="tabular-nums text-foreground">{formatMoney(clientBudget, "USD")}</span>
        </div>
        <div className="h-2 rounded-full bg-white/10">
          <div className="h-full w-full rounded-full bg-sky-500/40" />
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs text-foreground-muted mb-1">
          <span>Awarded</span>
          <span className="tabular-nums text-accent">{formatMoney(awarded, currency)}</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent/80 transition-all"
            style={{ width: `${awardedPct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function CompletionCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-foreground-muted">—</span>
  const w = Math.min(100, Math.max(0, pct))
  return (
    <div className="flex items-center gap-3 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden min-w-[72px]">
        <div
          className="h-full rounded-full bg-teal-500/80"
          style={{ width: `${w}%` }}
        />
      </div>
      <span className="font-mono text-xs text-foreground tabular-nums shrink-0 w-10 text-right">{pct}%</span>
    </div>
  )
}

export default function AgencyUtilizationPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/agency/utilization", { credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) setError((data as { error?: string }).error || "Failed to load")
          return
        }
        if (!cancelled) {
          setProjects((data as { projects?: ProjectRow[] }).projects || [])
          setSummary((data as { summary?: Summary }).summary ?? null)
        }
      } catch {
        if (!cancelled) setError("Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AgencyLayout>
      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="font-display font-black text-3xl text-foreground tracking-tight">Utilization</h1>
          <p className="text-foreground-muted mt-2 text-sm max-w-2xl">
            Read-only view of client budget vs awarded bid amounts across your projects (awarded responses only).
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-foreground-muted py-16">
            <Loader2 className="w-6 h-6 animate-spin" />
            Loading utilization…
          </div>
        )}

        {error && !loading && (
          <GlassCard className="border-red-500/30 bg-red-500/10">
            <p className="text-red-300 text-sm">{error}</p>
          </GlassCard>
        )}

        {!loading && !error && summary && (summary.by_currency.length > 0 || projects.length > 0) && (
          <div className="space-y-4">
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Portfolio summary</h2>
            {summary.mixed_currencies && summary.by_currency.length > 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <GlassCard className="p-6">
                    <div className="flex items-center gap-2 text-foreground-muted mb-2">
                      <TrendingUp className="w-4 h-4 text-sky-400" />
                      <span className="font-mono text-[10px] uppercase tracking-wider">Total client budget</span>
                    </div>
                    <div className="font-display font-bold text-2xl text-foreground tabular-nums">
                      {formatClientBudget(summary.total_client_budget)}
                    </div>
                  </GlassCard>
                  <GlassCard className="p-6">
                    <div className="flex items-center gap-2 text-foreground-muted mb-2">
                      <TrendingDown className="w-4 h-4 text-accent" />
                      <span className="font-mono text-[10px] uppercase tracking-wider">Total awarded</span>
                    </div>
                    <div className="font-display font-bold text-2xl text-accent tabular-nums">
                      {formatMoney(summary.total_awarded_all, "USD")}
                    </div>
                    <p className="text-[10px] text-foreground-muted mt-2 font-mono">All currencies (numeric sum)</p>
                  </GlassCard>
                  <GlassCard className="p-6">
                    <div className="flex items-center gap-2 text-foreground-muted mb-2">
                      <Wallet className="w-4 h-4 text-emerald-400" />
                      <span className="font-mono text-[10px] uppercase tracking-wider">Total margin</span>
                    </div>
                    <div
                      className={cn(
                        "font-display font-bold text-2xl tabular-nums",
                        toneClass(marginTone(summary.total_margin))
                      )}
                    >
                      {summary.total_client_budget == null
                        ? "—"
                        : formatMoney(summary.total_margin ?? 0, "USD")}
                    </div>
                    <p className="text-[10px] text-foreground-muted mt-2 font-mono">Client budget minus total awarded</p>
                  </GlassCard>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {summary.by_currency.map((b) => (
                    <GlassCard key={b.currency} className="p-6">
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                        {b.currency}
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs text-foreground-muted">Total awarded</span>
                        <span className="font-display font-bold text-lg text-accent tabular-nums">
                          {formatMoney(b.total_awarded, b.currency)}
                        </span>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <GlassCard className="p-6">
                  <div className="flex items-center gap-2 text-foreground-muted mb-2">
                    <TrendingUp className="w-4 h-4 text-sky-400" />
                    <span className="font-mono text-[10px] uppercase tracking-wider">Total client budget</span>
                  </div>
                  <div className="font-display font-bold text-2xl text-foreground tabular-nums">
                    {formatClientBudget(summary.total_client_budget)}
                  </div>
                </GlassCard>
                <GlassCard className="p-6">
                  <div className="flex items-center gap-2 text-foreground-muted mb-2">
                    <TrendingDown className="w-4 h-4 text-accent" />
                    <span className="font-mono text-[10px] uppercase tracking-wider">Total awarded</span>
                  </div>
                  <div className="font-display font-bold text-2xl text-accent tabular-nums">
                    {summary.total_awarded != null && summary.currency
                      ? formatMoney(summary.total_awarded, summary.currency)
                      : "—"}
                  </div>
                </GlassCard>
                <GlassCard className="p-6">
                  <div className="flex items-center gap-2 text-foreground-muted mb-2">
                    <Wallet className="w-4 h-4 text-emerald-400" />
                    <span className="font-mono text-[10px] uppercase tracking-wider">Total margin</span>
                  </div>
                  <div
                    className={cn(
                      "font-display font-bold text-2xl tabular-nums",
                      toneClass(marginTone(summary.total_margin))
                    )}
                  >
                    {summary.total_client_budget == null ? "—" : formatMoney(summary.total_margin ?? 0, "USD")}
                  </div>
                  <p className="text-[10px] text-foreground-muted mt-2 font-mono">Client budget minus awarded</p>
                </GlassCard>
              </div>
            )}
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <GlassCard className="p-12 text-center">
            <p className="text-foreground-muted text-sm">
              No awarded bids yet. When you award partner responses, scope-level budgets will appear here.
            </p>
          </GlassCard>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="space-y-4">
            <h2 className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">By project</h2>
            <Accordion type="multiple" className="space-y-3">
              {projects.map((p) => {
                const margin =
                  p.client_budget != null ? p.client_budget - p.total_awarded : null
                return (
                  <AccordionItem
                    key={p.project_id}
                    value={p.project_id}
                    className="glass-card rounded-xl border border-border/40 px-4 data-[state=open]:border-accent/30"
                  >
                    <AccordionTrigger className="py-4 hover:no-underline text-left">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full pr-2">
                        <div>
                          <div className="font-display font-bold text-lg text-foreground">{p.project_name}</div>
                          {p.client_name ? (
                            <div className="text-sm text-foreground-muted">{p.client_name}</div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-4 font-mono text-xs text-foreground-muted">
                          <span>
                            Client budget:{" "}
                            <span className="text-foreground tabular-nums">{formatClientBudget(p.client_budget)}</span>
                          </span>
                          <span>
                            Awarded:{" "}
                            <span className="text-accent tabular-nums">
                              {p.mixed_currency ? "—" : formatMoney(p.total_awarded, p.currency)}
                            </span>
                          </span>
                          <span className={cn("tabular-nums", toneClass(marginTone(margin)))}>
                            Margin:{" "}
                            {p.client_budget == null || p.mixed_currency
                              ? "—"
                              : formatMoney(margin ?? 0, "USD")}
                          </span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-6 pt-0">
                      {!p.mixed_currency && p.client_budget != null && p.client_budget > 0 && (
                        <div className="mb-6">
                          <UtilBar clientBudget={p.client_budget} awarded={p.total_awarded} currency={p.currency} />
                        </div>
                      )}
                      {p.mixed_currency && (
                        <p className="text-xs text-amber-400/90 font-mono mb-4">
                          This project mixes currencies; compare amounts per row below.
                        </p>
                      )}
                      <div className="overflow-x-auto rounded-lg border border-border/50">
                        <table className="w-full text-sm min-w-[560px]">
                          <thead>
                            <tr className="border-b border-border/50 font-mono text-[10px] uppercase tracking-wider text-foreground-muted text-left">
                              <th className="py-3 px-4 font-medium">Scope</th>
                              <th className="py-3 px-4 font-medium">Partner completion</th>
                              <th className="py-3 px-4 font-medium">Awarded</th>
                              <th className="py-3 px-4 font-medium">Variance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.scopes.map((s) => {
                              const tone = varianceTone(s.variance, s.estimated_amount)
                              return (
                                <tr key={s.response_id} className="border-b border-border/30 last:border-0">
                                  <td className="py-3 px-4 text-foreground font-medium">{s.scope_item_name}</td>
                                  <td className="py-3 px-4">
                                    <CompletionCell pct={s.partner_completion_pct} />
                                  </td>
                                  <td className="py-3 px-4 text-foreground tabular-nums">
                                    {s.awarded_amount != null ? formatMoney(s.awarded_amount, s.currency) : "—"}
                                  </td>
                                  <td className={cn("py-3 px-4 font-medium tabular-nums", toneClass(tone))}>
                                    {s.variance != null ? formatMoney(s.variance, s.currency) : "—"}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          </div>
        )}
      </div>
    </AgencyLayout>
  )
}
