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
}

type ProjectRow = {
  project_id: string
  project_name: string
  client_name: string | null
  scopes: ScopeRow[]
  total_estimated: number
  total_awarded: number
  total_variance: number
  currency: string
  mixed_currency: boolean
}

type Summary = {
  total_estimated: number | null
  total_awarded: number | null
  total_remaining: number | null
  currency: string | null
  mixed_currencies: boolean
  by_currency: Array<{
    currency: string
    total_estimated: number
    total_awarded: number
    total_remaining: number
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
  estimated,
  awarded,
  currency,
}: {
  estimated: number
  awarded: number
  currency: string
}) {
  const awardedPct = estimated > 0 ? Math.min(100, (awarded / estimated) * 100) : awarded > 0 ? 100 : 0
  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between text-xs text-foreground-muted mb-1">
          <span>Estimated</span>
          <span className="tabular-nums text-foreground">{formatMoney(estimated, currency)}</span>
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
            Read-only view of estimated RFP budgets vs awarded bid amounts across your projects (awarded responses
            only).
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {summary.by_currency.map((b) => (
                  <GlassCard key={b.currency} className="p-6">
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                      {b.currency}
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs text-foreground-muted">Total estimated</span>
                        <span className="font-display font-bold text-lg text-foreground tabular-nums">
                          {formatMoney(b.total_estimated, b.currency)}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs text-foreground-muted">Total awarded</span>
                        <span className="font-display font-bold text-lg text-accent tabular-nums">
                          {formatMoney(b.total_awarded, b.currency)}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-2 pt-2 border-t border-border/50">
                        <span className="text-xs text-foreground-muted flex items-center gap-1">
                          <Wallet className="w-3.5 h-3.5" />
                          Remaining
                        </span>
                        <span
                          className={cn(
                            "font-display font-bold text-lg tabular-nums",
                            b.total_remaining >= 0 ? "text-emerald-400" : "text-red-400"
                          )}
                        >
                          {formatMoney(b.total_remaining, b.currency)}
                        </span>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <GlassCard className="p-6">
                  <div className="flex items-center gap-2 text-foreground-muted mb-2">
                    <TrendingUp className="w-4 h-4 text-sky-400" />
                    <span className="font-mono text-[10px] uppercase tracking-wider">Total estimated</span>
                  </div>
                  <div className="font-display font-bold text-2xl text-foreground tabular-nums">
                    {summary.total_estimated != null && summary.currency
                      ? formatMoney(summary.total_estimated, summary.currency)
                      : "—"}
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
                    <span className="font-mono text-[10px] uppercase tracking-wider">Total remaining</span>
                  </div>
                  <div
                    className={cn(
                      "font-display font-bold text-2xl tabular-nums",
                      summary.total_remaining != null && summary.total_remaining >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    )}
                  >
                    {summary.total_remaining != null && summary.currency
                      ? formatMoney(summary.total_remaining, summary.currency)
                      : "—"}
                  </div>
                  <p className="text-[10px] text-foreground-muted mt-2 font-mono">Estimated minus awarded</p>
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
              {projects.map((p) => (
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
                          Est:{" "}
                          <span className="text-foreground tabular-nums">
                            {p.mixed_currency ? "—" : formatMoney(p.total_estimated, p.currency)}
                          </span>
                        </span>
                        <span>
                          Awarded:{" "}
                          <span className="text-accent tabular-nums">
                            {p.mixed_currency ? "—" : formatMoney(p.total_awarded, p.currency)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "tabular-nums",
                            p.mixed_currency
                              ? "text-foreground-muted"
                              : toneClass(varianceTone(p.total_variance, p.total_estimated))
                          )}
                        >
                          Var:{" "}
                          {!p.mixed_currency
                            ? formatMoney(p.total_variance, p.currency)
                            : "Mixed currencies"}
                        </span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-6 pt-0">
                    {!p.mixed_currency && p.total_estimated > 0 && (
                      <div className="mb-6">
                        <UtilBar estimated={p.total_estimated} awarded={p.total_awarded} currency={p.currency} />
                      </div>
                    )}
                    {p.mixed_currency && (
                      <p className="text-xs text-amber-400/90 font-mono mb-4">
                        This project mixes currencies; compare amounts per row below.
                      </p>
                    )}
                    <div className="overflow-x-auto rounded-lg border border-border/50">
                      <table className="w-full text-sm min-w-[520px]">
                        <thead>
                          <tr className="border-b border-border/50 font-mono text-[10px] uppercase tracking-wider text-foreground-muted text-left">
                            <th className="py-3 px-4 font-medium">Scope</th>
                            <th className="py-3 px-4 font-medium">Estimated</th>
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
                                <td className="py-3 px-4 text-foreground-muted tabular-nums">
                                  {s.estimated_amount != null ? formatMoney(s.estimated_amount, s.currency) : "—"}
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
              ))}
            </Accordion>
          </div>
        )}
      </div>
    </AgencyLayout>
  )
}
