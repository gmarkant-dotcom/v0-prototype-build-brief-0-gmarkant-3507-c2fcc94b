"use client"

import { useCallback, useEffect, useState } from "react"
import { GlassCard } from "@/components/glass-card"
import { DeliveryReviewSheet } from "@/components/delivery-review-sheet"
import { AiMarkdown } from "@/components/ai-markdown"
import { compositeScoreColorClass } from "@/lib/bid-scoring"
import { cn } from "@/lib/utils"
import { HelpTerm } from "@/components/help-term"
import { Loader2, TrendingUp, TrendingDown, Sparkles } from "lucide-react"

type ReviewSummary = {
  id: string
  project_id: string
  project_name: string
  status: string
  composite_score: number | null
  on_time: string | null
  on_budget: string | null
  overall_satisfaction: number | null
  would_work_again: string | null
  response_id: string | null
  bid_composite_score: number | null
  delta: number | null
  updated_at: string
}

type Stats = {
  total_projects_reviewed: number
  avg_delivery_score: number | null
  avg_bid_to_delivery_delta: number | null
  on_time_rate: number | null
  would_work_again_rate: number | null
}

type PerformanceData = {
  reviews: ReviewSummary[]
  stats: Stats
  reliability_summary: string | null
  reliability_summary_generated_at: string | null
}

function StatTile({ label, value, tone = "neutral" }: { label: React.ReactNode; value: string; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <div className="rounded-lg border border-border/40 bg-white/5 p-3">
      <div className="font-mono text-[9px] uppercase tracking-wider text-foreground-muted mb-1">{label}</div>
      <div
        className={cn(
          "font-display font-bold text-base",
          tone === "positive" ? "text-success" : tone === "negative" ? "text-red-300" : "text-foreground"
        )}
      >
        {value}
      </div>
    </div>
  )
}

export function VendorPerformanceHistory({
  partnerId, partnershipId, partnerName,
}: {
  partnerId: string
  partnershipId: string
  partnerName: string
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PerformanceData | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [reviewSheetRow, setReviewSheetRow] = useState<ReviewSummary | null>(null)

  const load = useCallback(
    async (force: boolean) => {
      if (force) setRegenerating(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/agency/pool/${encodeURIComponent(partnerId)}/performance${force ? "?force=1" : ""}`,
          { credentials: "same-origin" }
        )
        const j = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError((j as { error?: string })?.error || "Failed to load performance history")
          return
        }
        setData(j as PerformanceData)
      } catch {
        setError("Failed to load performance history")
      } finally {
        setLoading(false)
        setRegenerating(false)
      }
    },
    [partnerId]
  )

  useEffect(() => {
    void load(false)
  }, [load])

  if (loading) {
    return (
      <GlassCard className="p-6 md:p-8">
        <div className="flex items-center gap-2 text-foreground-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading performance history…
        </div>
      </GlassCard>
    )
  }

  if (error) {
    return (
      <GlassCard className="p-6 md:p-8 border-red-500/20">
        <p className="text-red-300 text-sm">{error}</p>
      </GlassCard>
    )
  }

  if (!data || data.reviews.length === 0) {
    return (
      <GlassCard className="p-6 md:p-8">
        <h2 className="font-display font-bold text-lg text-foreground mb-1">Performance History</h2>
        <p className="text-sm text-foreground-muted">
          No delivery reviews yet. Reviews appear here after a project engagement is evaluated in Delivery
          Performance.
        </p>
      </GlassCard>
    )
  }

  const { stats, reviews, reliability_summary } = data

  return (
    <>
      <GlassCard className="p-6 md:p-8 space-y-6">
        <div>
          <h2 className="font-display font-bold text-lg text-foreground mb-1">Performance History</h2>
          <p className="text-sm text-foreground-muted">
            Based on {stats.total_projects_reviewed} completed delivery review{stats.total_projects_reviewed !== 1 ? "s" : ""}
          </p>
        </div>

        {reliability_summary && (
          <div className="rounded-lg border border-border/40 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="font-mono text-[10px] uppercase text-foreground-muted flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-accent" /> AI Reliability Summary
              </div>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={regenerating}
                className="font-mono text-[10px] text-accent hover:underline disabled:opacity-50"
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
            <AiMarkdown content={reliability_summary} />
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatTile label="Projects Reviewed" value={String(stats.total_projects_reviewed)} />
          <StatTile
            label={<HelpTerm term="delivery_performance" theme="dark">Avg Delivery Score</HelpTerm>}
            value={stats.avg_delivery_score != null ? `${Math.round(stats.avg_delivery_score)}/100` : "-"}
          />
          <StatTile
            label="Avg Bid→Delivery Delta"
            value={
              stats.avg_bid_to_delivery_delta != null
                ? `${stats.avg_bid_to_delivery_delta > 0 ? "+" : ""}${stats.avg_bid_to_delivery_delta}`
                : "-"
            }
            tone={stats.avg_bid_to_delivery_delta == null ? "neutral" : stats.avg_bid_to_delivery_delta >= 0 ? "positive" : "negative"}
          />
          <StatTile label="On-Time Rate" value={stats.on_time_rate != null ? `${stats.on_time_rate}%` : "-"} />
          <StatTile
            label="Would Work Again"
            value={stats.would_work_again_rate != null ? `${stats.would_work_again_rate}%` : "-"}
          />
        </div>

        <div className="space-y-2">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-lg border border-border/40 bg-white/5 p-4 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="font-display font-bold text-sm text-foreground">{r.project_name}</span>
                <button type="button" onClick={() => setReviewSheetRow(r)} className="font-mono text-[10px] text-accent hover:underline">
                  View Full Review
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap font-mono text-[10px]">
                {r.composite_score != null && (
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full border",
                      compositeScoreColorClass(r.composite_score).bg,
                      compositeScoreColorClass(r.composite_score).text,
                      compositeScoreColorClass(r.composite_score).border
                    )}
                  >
                    Delivery {Math.round(r.composite_score)}/100
                  </span>
                )}
                {r.bid_composite_score != null && (
                  <span className="px-2 py-0.5 rounded-full border border-border bg-white/5 text-foreground-muted flex items-center gap-1">
                    Bid {Math.round(r.bid_composite_score)}/100
                    {r.delta != null && r.delta !== 0 && (
                      r.delta > 0 ? (
                        <TrendingUp className="w-3 h-3 text-success" />
                      ) : (
                        <TrendingDown className="w-3 h-3 text-red-400" />
                      )
                    )}
                  </span>
                )}
                {r.on_time && (
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full border uppercase",
                      r.on_time === "yes"
                        ? "border-success/40 bg-success/10 text-success"
                        : r.on_time === "partial"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                          : "border-red-500/40 bg-red-500/10 text-red-300"
                    )}
                  >
                    On time: {r.on_time}
                  </span>
                )}
                {r.on_budget && (
                  <span className="px-2 py-0.5 rounded-full border border-border bg-white/5 text-foreground-muted uppercase">
                    Budget: {r.on_budget}
                  </span>
                )}
                {r.overall_satisfaction != null && (
                  <span className="px-2 py-0.5 rounded-full border border-border bg-white/5 text-foreground-muted">
                    Satisfaction {r.overall_satisfaction}/10
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {reviewSheetRow && (
        <DeliveryReviewSheet
          projectId={reviewSheetRow.project_id}
          partnershipId={partnershipId}
          responseId={reviewSheetRow.response_id}
          projectName={reviewSheetRow.project_name}
          partnerName={partnerName}
          onClose={() => setReviewSheetRow(null)}
        />
      )}
    </>
  )
}
