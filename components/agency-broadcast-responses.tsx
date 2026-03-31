"use client"

import { useEffect, useState } from "react"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { isDemoMode } from "@/lib/demo-data"
import { cn } from "@/lib/utils"
import { formatBudgetForDisplay, formatTimelineForDisplay } from "@/lib/rfp-response-fields"
import { displayFilenameFromBlobUrl, isVercelBlobStorageUrl } from "@/lib/vercel-blob-url"
import { getBidStatusColor, getBidStatusLabel } from "@/lib/bid-status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, ChevronDown, ChevronRight, Download, ExternalLink, CheckCircle, Star, CalendarDays } from "lucide-react"

function externalLinkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return "Link"
  }
}

type InboxSnippet = {
  id: string
  scope_item_name?: string
  scope_item_description?: string | null
  created_at?: string
  master_rfp_json?: unknown
  status?: string
} | null

type AttachmentItem = { type: string; label: string; url: string }
type ResponseVersion = {
  id: string
  response_id: string
  version_number: number
  proposal_text: string
  budget_proposal: string
  timeline_proposal: string
  attachments: AttachmentItem[] | null
  status_at_submission: string
  submitted_at: string
  change_notes?: string | null
}

type AgencyResponseRow = {
  id: string
  inbox_item_id: string
  partner_display_name: string
  proposal_text: string
  budget_proposal: string
  timeline_proposal: string
  attachments: AttachmentItem[] | null
  status: string
  created_at: string
  updated_at: string
  inbox: InboxSnippet
  versions?: ResponseVersion[]
}

export function AgencyBroadcastResponsesPanel() {
  const isDemo = isDemoMode()
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AgencyResponseRow[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({})
  const [declineReasons, setDeclineReasons] = useState<Record<string, string>>({})
  const [feedbackSavedIds, setFeedbackSavedIds] = useState<Record<string, boolean>>({})
  const [feedbackEditingIds, setFeedbackEditingIds] = useState<Record<string, boolean>>({})
  const [shortlistHoverIds, setShortlistHoverIds] = useState<Record<string, boolean>>({})
  const [meetingHoverIds, setMeetingHoverIds] = useState<Record<string, boolean>>({})
  const [selectedVersionByResponseId, setSelectedVersionByResponseId] = useState<Record<string, string>>({})

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
          attachments: [
            { type: "work_example", label: "Work Example", url: "https://example.com/work/1" },
            { type: "proposal", label: "Proposal", url: "https://docs.google.com/presentation/demo" },
          ],
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
        console.log(
          "[agency/bids] AgencyBroadcastResponsesPanel → GET /api/agency/rfp-responses",
          typeof window !== "undefined" ? window.location.pathname : ""
        )
        const res = await fetch("/api/agency/rfp-responses", { cache: "no-store", credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        console.log("[agency/bids] rfp-responses response", {
          ok: res.ok,
          status: res.status,
          count: Array.isArray(data.responses) ? data.responses.length : 0,
        })
        if (!res.ok) throw new Error((data?.error as string) || "Could not load responses")
        if (!cancelled) {
          const nextRows = (data.responses || []) as AgencyResponseRow[]
          console.log(
            "[agency/bids] versions per bid",
            nextRows.map((row) => ({ responseId: row.id, versionCount: (row.versions || []).length }))
          )
          setRows(nextRows)
        }
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

  const patchResponse = async (id: string, payload: Record<string, unknown>) => {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/agency/rfp-responses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to update response")
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...(data.response || row) } : row)))
      if ("agency_feedback" in payload) {
        setFeedbackSavedIds((prev) => ({ ...prev, [id]: true }))
        setFeedbackEditingIds((prev) => ({ ...prev, [id]: false }))
        setTimeout(() => {
          setFeedbackSavedIds((prev) => ({ ...prev, [id]: false }))
        }, 3000)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update")
    } finally {
      setBusyId(null)
    }
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
          const versions = r.versions || []
          const selectedVersionId = selectedVersionByResponseId[r.id] || versions[0]?.id || ""
          const selectedVersion = versions.find((v) => v.id === selectedVersionId) || versions[0] || null
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
                    getBidStatusColor(r.status)
                  )}
                >
                  {getBidStatusLabel(r.status, "agency")}
                </span>
              </button>
              {expanded && (
                <div className="px-4 pb-4 pt-0 border-t border-border/60 space-y-4">
                  <div className="grid sm:grid-cols-2 gap-3 text-sm pt-3">
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted">Budget</div>
                      <div className="text-foreground">{formatBudgetForDisplay(r.budget_proposal)}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted">Timeline</div>
                      <div className="text-foreground">{formatTimelineForDisplay(r.timeline_proposal)}</div>
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
                  <div className="border border-border/60 rounded-lg p-3 bg-white/5">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="font-mono text-[10px] uppercase text-foreground-muted">Version history</div>
                      {selectedVersion && (
                        <div className="font-mono text-[10px] text-foreground-muted">
                          {new Date(selectedVersion.submitted_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {versions.length === 0 ? (
                      <p className="text-sm text-foreground-muted">No version history yet.</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {versions.map((v, idx) => {
                            const isCurrent = idx === 0
                            const isSelected = selectedVersion?.id === v.id
                            return (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => setSelectedVersionByResponseId((prev) => ({ ...prev, [r.id]: v.id }))}
                                className={cn(
                                  "px-2 py-1 rounded-md border font-display text-xs",
                                  isSelected
                                    ? "bg-accent/20 border-accent text-foreground"
                                    : "bg-white/5 border-border/60 text-foreground-muted hover:text-foreground"
                                )}
                              >
                                V{v.version_number} {isCurrent ? "— Current" : `— ${new Date(v.submitted_at).toLocaleDateString()}`}
                              </button>
                            )
                          })}
                        </div>
                        {selectedVersion && (
                          <div className="space-y-2">
                            <div className="font-display font-bold text-sm text-foreground">
                              V{selectedVersion.version_number}{" "}
                              {selectedVersion.version_number === 1 ? "— Original" : "— Resubmission"}
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3 text-sm">
                              <div>
                                <div className="font-mono text-[10px] uppercase text-foreground-muted">Budget</div>
                                <div className="text-foreground">{formatBudgetForDisplay(selectedVersion.budget_proposal || "")}</div>
                              </div>
                              <div>
                                <div className="font-mono text-[10px] uppercase text-foreground-muted">Timeline</div>
                                <div className="text-foreground">{formatTimelineForDisplay(selectedVersion.timeline_proposal || "")}</div>
                              </div>
                            </div>
                            <div>
                              <div className="font-mono text-[10px] uppercase text-foreground-muted">Proposal</div>
                              {(() => {
                                const preview = (selectedVersion.proposal_text || "").trim()
                                const clipped = preview.length > 100 ? `${preview.slice(0, 100)}…` : preview
                                return (
                                  <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                                    {clipped || "—"}
                                  </p>
                                )
                              })()}
                            </div>
                            {selectedVersion.change_notes && (
                              <div className="rounded-md border border-amber-300/50 bg-amber-500/10 p-2">
                                <div className="font-mono text-[10px] uppercase text-amber-200">Change notes</div>
                                <p className="text-sm text-amber-100 whitespace-pre-wrap">{selectedVersion.change_notes}</p>
                              </div>
                            )}
                            <p className="font-mono text-[10px] text-foreground-muted">
                              Attachments: {Array.isArray(selectedVersion.attachments) ? selectedVersion.attachments.length : 0}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {r.attachments && r.attachments.length > 0 && (
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Attachments</div>
                      <ul className="space-y-2">
                        {r.attachments.map((att, i) => {
                          const isBlob = isVercelBlobStorageUrl(att.url)
                          const displayName = isBlob ? displayFilenameFromBlobUrl(att.url) : externalLinkLabel(att.url)
                          const downloadHref = isBlob
                            ? `/api/agency/blob-download?url=${encodeURIComponent(att.url)}`
                            : null
                          return (
                            <li
                              key={`${att.url}-${i}`}
                              className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm border border-border/60 rounded-lg p-3 bg-white/5"
                            >
                              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white/10 text-foreground-muted shrink-0">
                                {att.label}
                              </span>
                              <span className="text-foreground min-w-0 flex-1 truncate" title={displayName}>
                                {displayName}
                              </span>
                              {isBlob && downloadHref ? (
                                <Button variant="outline" size="sm" className="shrink-0 border-border/60" asChild>
                                  <a href={downloadHref}>
                                    <Download className="w-3.5 h-3.5 mr-1.5" />
                                    Download
                                  </a>
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" className="shrink-0 border-border/60" asChild>
                                  <a href={att.url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                    Open
                                  </a>
                                </Button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                  <p className="font-mono text-[10px] text-foreground-muted">
                    Updated {new Date(r.updated_at).toLocaleString()}
                  </p>
                  {r.status === "declined" && (
                    <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
                      This bid is marked as declined.
                    </div>
                  )}

                  <div className="border-t border-border/50 pt-4 space-y-3">
                    <div>
                      <label className="block font-mono text-[10px] uppercase text-foreground-muted mb-1">Agency feedback</label>
                      {(() => {
                        const currentFeedback = ((r as unknown as { agency_feedback?: string }).agency_feedback || "").trim()
                        const draftFeedback = feedbackDrafts[r.id] ?? currentFeedback
                        const isEditing = feedbackEditingIds[r.id] || !currentFeedback
                        const preview = currentFeedback.length > 80 ? `${currentFeedback.slice(0, 80)}…` : currentFeedback
                        return (
                          <>
                            {isEditing ? (
                              <>
                                <textarea
                                  value={draftFeedback}
                                  onChange={(e) => setFeedbackDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                  className="w-full min-h-[90px] rounded-md border border-border/60 bg-white/5 p-2 text-sm text-foreground"
                                  placeholder="Share notes or next steps for the partner…"
                                />
                                <div className="mt-2 flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-border/60"
                                    onClick={() =>
                                      patchResponse(r.id, {
                                        agency_feedback: feedbackDrafts[r.id] ?? "",
                                        status: r.status === "submitted" ? "under_review" : r.status,
                                      })
                                    }
                                    disabled={busyId === r.id}
                                  >
                                    {busyId === r.id ? "Saving..." : "Leave Feedback"}
                                  </Button>
                                  {currentFeedback && (
                                    <button
                                      type="button"
                                      className="text-xs text-foreground-muted hover:text-foreground"
                                      onClick={() => {
                                        setFeedbackEditingIds((prev) => ({ ...prev, [r.id]: false }))
                                        setFeedbackDrafts((prev) => ({ ...prev, [r.id]: currentFeedback }))
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="rounded-md border border-border/60 bg-white/5 p-3">
                                <div className="text-sm text-foreground truncate" title={currentFeedback}>
                                  {preview || "Feedback saved"}
                                </div>
                                <button
                                  type="button"
                                  className="mt-1 text-xs text-accent hover:underline"
                                  onClick={() => setFeedbackEditingIds((prev) => ({ ...prev, [r.id]: true }))}
                                >
                                  Edit feedback
                                </button>
                              </div>
                            )}
                          </>
                        )
                      })()}
                      <div className="mt-2 min-h-[20px]">
                        {feedbackSavedIds[r.id] && (
                          <span className="inline-flex items-center gap-1 text-xs text-green-500">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Feedback submitted
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 items-center">
                      <Button
                        size="sm"
                        variant={r.status === "meeting_requested" ? "default" : "outline"}
                        className={cn(
                          r.status === "meeting_requested"
                            ? meetingHoverIds[r.id]
                              ? "bg-slate-600 hover:bg-slate-600/90 text-white"
                              : "bg-cyan-600 hover:bg-cyan-600/90 text-white"
                            : "border-cyan-400/40 text-cyan-300"
                        )}
                        onMouseEnter={() =>
                          r.status === "meeting_requested" && setMeetingHoverIds((prev) => ({ ...prev, [r.id]: true }))
                        }
                        onMouseLeave={() =>
                          r.status === "meeting_requested" && setMeetingHoverIds((prev) => ({ ...prev, [r.id]: false }))
                        }
                        onClick={() =>
                          patchResponse(r.id, { status: r.status === "meeting_requested" ? "under_review" : "meeting_requested" })
                        }
                        disabled={busyId === r.id || r.status === "awarded"}
                      >
                        <CalendarDays
                          className={cn(
                            "w-3.5 h-3.5 mr-1.5",
                            r.status === "meeting_requested" && !meetingHoverIds[r.id] && "fill-current"
                          )}
                        />
                        {r.status === "meeting_requested"
                          ? meetingHoverIds[r.id]
                            ? "Cancel Meeting Request"
                            : "Meeting Requested"
                          : "Request Meeting"}
                      </Button>
                      <Button
                        size="sm"
                        variant={r.status === "shortlisted" ? "default" : "outline"}
                        className={cn(
                          r.status === "shortlisted"
                            ? shortlistHoverIds[r.id]
                              ? "bg-red-600 hover:bg-red-600/90 text-white"
                              : "bg-purple-600 hover:bg-purple-600/90 text-white"
                            : "border-purple-400/40 text-purple-300"
                        )}
                        onMouseEnter={() =>
                          r.status === "shortlisted" && setShortlistHoverIds((prev) => ({ ...prev, [r.id]: true }))
                        }
                        onMouseLeave={() =>
                          r.status === "shortlisted" && setShortlistHoverIds((prev) => ({ ...prev, [r.id]: false }))
                        }
                        onClick={() => patchResponse(r.id, { status: r.status === "shortlisted" ? "under_review" : "shortlisted" })}
                        disabled={busyId === r.id || r.status === "awarded"}
                      >
                        <Star className={cn("w-3.5 h-3.5 mr-1.5", r.status === "shortlisted" && !shortlistHoverIds[r.id] && "fill-current")} />
                        {r.status === "shortlisted"
                          ? shortlistHoverIds[r.id]
                            ? "Remove from shortlist"
                            : "Shortlisted"
                          : "Shortlist"}
                      </Button>
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-600/90 text-white"
                        onClick={() => patchResponse(r.id, { status: "awarded" })}
                        disabled={busyId === r.id || r.status === "awarded"}
                      >
                        Award
                      </Button>
                      <Input
                        value={declineReasons[r.id] || ""}
                        onChange={(e) => setDeclineReasons((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="Optional decline reason"
                        className="h-8 max-w-xs text-sm"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-400/40 text-red-300"
                        onClick={() =>
                          patchResponse(r.id, { status: "declined", decline_reason: declineReasons[r.id] || "" })
                        }
                        disabled={busyId === r.id || r.status === "awarded"}
                      >
                        {r.status === "declined" ? "Declined" : "Decline"}
                      </Button>
                      {r.status === "declined" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border/60 text-foreground"
                          onClick={() => patchResponse(r.id, { status: "submitted" })}
                          disabled={busyId === r.id}
                        >
                          Undo Decline
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}
