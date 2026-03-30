"use client"

import { useEffect, useState } from "react"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { isDemoMode } from "@/lib/demo-data"
import { cn } from "@/lib/utils"
import { Loader2, ChevronDown, ChevronRight, FileText, ExternalLink } from "lucide-react"

type InboxSnippet = {
  id: string
  scope_item_name?: string
  scope_item_description?: string | null
  created_at?: string
  master_rfp_json?: unknown
  status?: string
} | null

type AgencyResponseRow = {
  id: string
  inbox_item_id: string
  partner_display_name: string
  proposal_text: string
  budget_proposal: string
  timeline_proposal: string
  work_example_urls: string[] | null
  proposal_document_url: string | null
  proposal_deck_link: string | null
  status: string
  created_at: string
  updated_at: string
  inbox: InboxSnippet
}

export function AgencyBroadcastResponsesPanel() {
  const isDemo = isDemoMode()
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AgencyResponseRow[]>([])
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (isDemo) {
      setRows([
        {
          id: "demo-r1",
          inbox_item_id: "demo-inbox",
          partner_display_name: "Fieldhouse Films",
          proposal_text:
            "We’d approach this as a modular production with a dedicated showrunner and a nimble B-cam unit for creator days…",
          budget_proposal: "$92,000 – $105,000",
          timeline_proposal: "10 weeks from kickoff to delivery of first wave",
          work_example_urls: ["https://example.com/work/1"],
          proposal_document_url: null,
          proposal_deck_link: "https://docs.google.com/presentation/demo",
          status: "submitted",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          inbox: {
            id: "demo-inbox",
            scope_item_name: "Video production",
            created_at: new Date().toISOString(),
            status: "bid_submitted",
          },
        },
      ])
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/agency/rfp-responses", { cache: "no-store", credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data?.error as string) || "Could not load responses")
        if (!cancelled) setRows((data.responses || []) as AgencyResponseRow[])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo])

  if (loading) {
    return (
      <GlassCard className="mb-8">
        <div className="flex items-center gap-3 text-foreground-muted">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
          <span className="font-mono text-sm">Loading partner responses…</span>
        </div>
      </GlassCard>
    )
  }

  if (error) {
    return (
      <GlassCard className="mb-8 border border-red-500/30 bg-red-500/5">
        <p className="text-sm text-red-200 font-mono">{error}</p>
      </GlassCard>
    )
  }

  if (rows.length === 0) {
    return (
      <GlassCard className="mb-8">
        <GlassCardHeader
          label="Broadcast inbox"
          title="Partner responses"
          description="When partners submit bids to your broadcast RFPs, they appear here."
        />
        <p className="font-mono text-xs text-foreground-muted">No responses yet.</p>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="mb-8">
      <GlassCardHeader
        label="Broadcast inbox"
        title="Partner responses"
        description="Review proposals submitted against scoped RFP lines you broadcast to partners."
      />
      <div className="space-y-2 mt-4">
        {rows.map((r) => {
          const expanded = openId === r.id
          const scopeName = r.inbox?.scope_item_name || "Scoped line"
          const sent = r.inbox?.created_at
            ? new Date(r.inbox.created_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : ""
          return (
            <div key={r.id} className="rounded-lg border border-border bg-white/5 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenId(expanded ? null : r.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/5 transition-colors"
              >
                {expanded ? (
                  <ChevronDown className="w-4 h-4 text-accent shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-foreground-muted shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-foreground truncate">{r.partner_display_name}</div>
                  <div className="font-mono text-[10px] text-foreground-muted truncate">{scopeName}</div>
                </div>
                <span
                  className={cn(
                    "font-mono text-[10px] px-2 py-0.5 rounded-full uppercase shrink-0",
                    r.status === "submitted" ? "bg-accent/20 text-accent" : "bg-white/10 text-foreground-muted"
                  )}
                >
                  {r.status}
                </span>
              </button>
              {expanded && (
                <div className="px-4 pb-4 pt-0 border-t border-border/60 space-y-4">
                  <div className="grid sm:grid-cols-2 gap-3 text-sm pt-3">
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted">Budget</div>
                      <div className="text-foreground">{r.budget_proposal || "—"}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted">Timeline</div>
                      <div className="text-foreground">{r.timeline_proposal || "—"}</div>
                    </div>
                  </div>
                  {sent && (
                    <p className="font-mono text-[10px] text-foreground-muted">
                      Broadcast line sent {sent}
                    </p>
                  )}
                  <div>
                    <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Proposal</div>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{r.proposal_text}</p>
                  </div>
                  {r.work_example_urls && r.work_example_urls.length > 0 && (
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Work examples</div>
                      <ul className="space-y-1">
                        {r.work_example_urls.map((u) => (
                          <li key={u}>
                            <a
                              href={u}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-accent inline-flex items-center gap-1 hover:underline"
                            >
                              {u}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {r.proposal_document_url && (
                      <a
                        href={r.proposal_document_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 font-mono text-xs px-3 py-2 rounded-lg border border-border bg-white/5 text-accent hover:bg-white/10"
                      >
                        <FileText className="w-4 h-4" />
                        Proposal PDF
                      </a>
                    )}
                    {r.proposal_deck_link && (
                      <a
                        href={r.proposal_deck_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 font-mono text-xs px-3 py-2 rounded-lg border border-border bg-white/5 text-accent hover:bg-white/10"
                      >
                        Deck / link
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-foreground-muted">
                    Updated {new Date(r.updated_at).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}
