"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { isDemoMode } from "@/lib/demo-data"
import { cn } from "@/lib/utils"
import { displayFilenameFromBlobUrl, isVercelBlobStorageUrl } from "@/lib/vercel-blob-url"
import { getBidStatusColor, getBidStatusLabel } from "@/lib/bid-status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
  response_deadline?: string | null
  recipient_email?: string | null
  claimed_at?: string | null
  invite_token_expires_at?: string | null
  nda_gate_enforced?: boolean | null
  nda_confirmed_at?: string | null
  partner_intent?: "will_respond" | "has_questions" | "requesting_call" | null
  intent_set_at?: string | null
  master_rfp_json?: unknown
  status?: string
} | null

type AttachmentItem = { type: string; label: string; url: string }

/** Partner API may return TEXT double-encoded as JSON string-of-string; unwrap twice then read fields. */
function parseVersionBudgetObj(val: unknown): { amount?: number; currency?: string } | null {
  try {
    let v: unknown = val
    if (typeof v === "string") v = JSON.parse(v)
    if (typeof v === "string") v = JSON.parse(v)
    return v as { amount?: number; currency?: string } | null
  } catch {
    return null
  }
}

function parseVersionTimelineObj(val: unknown): { duration?: number; unit?: string } | null {
  try {
    let v: unknown = val
    if (typeof v === "string") v = JSON.parse(v)
    if (typeof v === "string") v = JSON.parse(v)
    return v as { duration?: number; unit?: string } | null
  } catch {
    return null
  }
}

function formatDeadlineDate(value?: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function isDeadlineWithin48Hours(value?: string | null): boolean {
  if (!value) return false
  const ts = new Date(value).getTime()
  if (Number.isNaN(ts)) return false
  const diff = ts - Date.now()
  return diff > 0 && diff <= 48 * 60 * 60 * 1000
}

function getPartnerIntentBadge(
  intent?: "will_respond" | "has_questions" | "requesting_call" | null
): { label: string; className: string } | null {
  if (!intent) return null
  if (intent === "will_respond") {
    return { label: "Plans to respond", className: "bg-green-900/30 text-green-100 border-green-400/40" }
  }
  if (intent === "has_questions") {
    return { label: "Has questions", className: "bg-blue-900/30 text-blue-100 border-blue-400/40" }
  }
  return { label: "Requested call", className: "bg-purple-900/30 text-purple-100 border-purple-400/40" }
}

type ResponseVersion = {
  id: string
  response_id: string
  version_number: number
  proposal_text: string
  budget_proposal: string
  budget?: string | null
  budget_currency?: string | null
  timeline_proposal: string
  timeline?: string | null
  timeline_unit?: string | null
  attachments: AttachmentItem[] | null
  status_at_submission: string
  submitted_at: string
  change_notes?: string | null
}

type AgencyResponseRow = {
  id: string
  response_id?: string | null
  response_exists?: boolean
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

export function AgencyBroadcastResponsesPanel({ projectId }: { projectId?: string | null }) {
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
  const [resendBusyInboxId, setResendBusyInboxId] = useState<string | null>(null)
  const [resendStatus, setResendStatus] = useState<string | null>(null)
  const [awardDialog, setAwardDialog] = useState<{
    id: string
    partner: string
    scope: string
  } | null>(null)

  useEffect(() => {
    if (isDemo) {
      setRows([
        {
          id: "demo-r1",
          inbox_item_id: "demo-inbox",
          partner_display_name: "Sample Production Studio",
          proposal_text:
            "We’d approach this as a modular production with a dedicated showrunner and a nimble B-cam unit for creator days…",
          budget_proposal: "$92,000 – $105,000",
          timeline_proposal: "10 weeks from kickoff to delivery of first wave",
          attachments: [
            { type: "work_example", label: "Work Example", url: "https://demo.withligament.com/sample-assets/work-example" },
            { type: "proposal", label: "Proposal", url: "https://demo.withligament.com/sample-assets/proposal-deck" },
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
        const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
        const url = `/api/agency/rfp-responses${qs}`
        const res = await fetch(url, { cache: "no-store", credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data?.error as string) || "Could not load responses")
        if (!cancelled) {
          const nextRows = (data.responses || []) as AgencyResponseRow[]
          setRows(nextRows)
        }
      } catch (e) {
        console.error("[agency/bids] GET /api/agency/rfp-responses failed", {
          projectId: projectId ?? null,
          url: projectId ? `/api/agency/rfp-responses?projectId=${encodeURIComponent(projectId)}` : "/api/agency/rfp-responses",
          message: e instanceof Error ? e.message : String(e),
        })
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo, projectId])

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

  const groupedRows = rows.reduce<Record<string, AgencyResponseRow[]>>((acc, row) => {
    const scope = row.inbox?.scope_item_name || "Scoped line"
    if (!acc[scope]) acc[scope] = []
    acc[scope].push(row)
    return acc
  }, {})

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
      console.error("[agency/bids] PATCH /api/agency/rfp-responses/[id] failed", {
        responseId: id,
        message: e instanceof Error ? e.message : String(e),
      })
      setError(e instanceof Error ? e.message : "Failed to update")
    } finally {
      setBusyId(null)
    }
  }

  const computeManualInviteStatus = (inbox: InboxSnippet, status: string): string | null => {
    if (!inbox || !inbox.recipient_email) return null
    if (status === "submitted" || status === "under_review" || status === "shortlisted" || status === "meeting_requested" || status === "awarded") {
      return "Bid submitted"
    }
    const expiresAt = inbox.invite_token_expires_at ? new Date(inbox.invite_token_expires_at).getTime() : null
    const isExpired = expiresAt !== null && !Number.isNaN(expiresAt) && expiresAt < Date.now()
    if (inbox.nda_gate_enforced && !inbox.nda_confirmed_at) return "NDA pending"
    if (inbox.nda_gate_enforced && inbox.nda_confirmed_at) return "NDA confirmed"
    if (inbox.claimed_at) return "Account created"
    if (isExpired) return "Invite expired"
    return "Invite sent"
  }

  return (
    <>
    <GlassCard className="mb-8">
      <GlassCardHeader
        label="Broadcast inbox"
        title="Partner responses"
        description="Review broadcast lines by scope item, including partners still awaiting response."
      />
      <div className="space-y-4 mt-4">
        {Object.entries(groupedRows).map(([scopeGroup, groupRows]) => (
          <div key={scopeGroup} className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-wide text-foreground-muted">{scopeGroup}</p>
            {groupRows.map((r) => {
          const expanded = openId === r.id
          const canMutate = Boolean(r.response_id)
          const versions = r.versions || []
          const selectedVersionId = selectedVersionByResponseId[r.id] || versions[0]?.id || ""
          const selectedVersion = versions.find((v) => v.id === selectedVersionId) || versions[0] || null
          const scopeName = r.inbox?.scope_item_name || "Scoped line"
          const manualInviteStatus = computeManualInviteStatus(r.inbox, r.status)
          const canResendInvite =
            !!r.inbox?.recipient_email &&
            !r.inbox?.claimed_at &&
            !!r.inbox?.invite_token_expires_at &&
            new Date(r.inbox.invite_token_expires_at).getTime() < Date.now()
          const sent = r.inbox?.created_at
            ? new Date(r.inbox.created_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : ""
          const responseDeadline = formatDeadlineDate(r.inbox?.response_deadline)
          const partnerIntentBadge = getPartnerIntentBadge(r.inbox?.partner_intent)
          const received = r.created_at
            ? new Date(r.created_at).toLocaleString("en-US", {
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
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="font-display font-bold text-foreground truncate">{r.partner_display_name}</div>
                    {partnerIntentBadge && (
                      <span
                        className={cn(
                          "font-mono text-[10px] px-1.5 py-0.5 rounded border shrink-0",
                          partnerIntentBadge.className
                        )}
                      >
                        {partnerIntentBadge.label}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-foreground-muted truncate">{scopeName}</div>
                  {received && (
                    <div className="font-mono text-[10px] text-foreground-muted truncate">
                      Bid received {received}
                    </div>
                  )}
                  {responseDeadline && (
                    <div
                      className={cn(
                        "font-mono text-[10px] truncate",
                        isDeadlineWithin48Hours(r.inbox?.response_deadline)
                          ? "text-amber-200"
                          : "text-foreground-muted"
                      )}
                    >
                      Response deadline {responseDeadline}
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    "font-mono text-[10px] px-2 py-0.5 rounded-full uppercase shrink-0",
                    manualInviteStatus
                      ? "bg-blue-900/30 text-blue-100"
                      : r.status === "awaiting_response"
                        ? "bg-amber-500/20 text-amber-300"
                        : getBidStatusColor(r.status)
                  )}
                >
                  {manualInviteStatus || (r.status === "awaiting_response" ? "Awaiting response" : getBidStatusLabel(r.status, "agency"))}
                </span>
              </button>
              {expanded && (
                <div className="px-4 pb-4 pt-0 border-t border-border/60 space-y-4">
                  <div className="grid sm:grid-cols-2 gap-3 text-sm pt-3">
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted">Budget</div>
                      <div className="text-foreground">
                        {(() => {
                          const o = parseVersionBudgetObj(r.budget_proposal)
                          return o?.amount != null && o?.currency
                            ? `${Number(o.amount).toLocaleString("en-US")} ${o.currency}`
                            : "—"
                        })()}
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted">Timeline</div>
                      <div className="text-foreground">
                        {(() => {
                          const o = parseVersionTimelineObj(r.timeline_proposal)
                          return o?.duration != null && o?.unit ? `${o.duration} ${o.unit}` : "—"
                        })()}
                      </div>
                    </div>
                  </div>
                  {sent && (
                    <p className="font-mono text-[10px] text-foreground-muted">
                      Broadcast line sent {sent}
                    </p>
                  )}
                  {manualInviteStatus && (
                    <p className="font-mono text-[10px] text-foreground-muted">Manual invite status: {manualInviteStatus}</p>
                  )}
                  {canResendInvite && (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={resendBusyInboxId === r.inbox_item_id}
                        className="border-border/60"
                        onClick={async () => {
                          setResendBusyInboxId(r.inbox_item_id)
                          setResendStatus(null)
                          try {
                            const res = await fetch("/api/agency/broadcast-rfp/resend-invite", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ inboxItemId: r.inbox_item_id }),
                            })
                            const payload = await res.json().catch(() => ({}))
                            if (!res.ok) throw new Error((payload?.error as string) || "Failed to resend invite")
                            setResendStatus("Invite resent.")
                          } catch (e) {
                            setResendStatus(e instanceof Error ? e.message : "Resend failed")
                          } finally {
                            setResendBusyInboxId(null)
                          }
                        }}
                      >
                        {resendBusyInboxId === r.inbox_item_id ? "Resending..." : "Resend Invite"}
                      </Button>
                      {resendStatus && <span className="font-mono text-[10px] text-foreground-muted">{resendStatus}</span>}
                    </div>
                  )}
                  {responseDeadline && (
                    <p
                      className={cn(
                        "font-mono text-[10px]",
                        isDeadlineWithin48Hours(r.inbox?.response_deadline)
                          ? "text-amber-200"
                          : "text-foreground-muted"
                      )}
                    >
                      Response deadline {responseDeadline}
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
                                    : "bg-white/5 border-border/60 text-foreground/90 hover:text-foreground"
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
                                <div className="text-foreground">
                                  {(() => {
                                    const o = parseVersionBudgetObj(selectedVersion.budget_proposal)
                                    return o?.amount != null && o?.currency
                                      ? `${Number(o.amount).toLocaleString("en-US")} ${o.currency}`
                                      : "—"
                                  })()}
                                </div>
                                {(selectedVersion.budget || selectedVersion.budget_currency) && (
                                  <div className="font-mono text-[10px] text-foreground-muted mt-1">
                                    {selectedVersion.budget || "—"} {selectedVersion.budget_currency || ""}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="font-mono text-[10px] uppercase text-foreground-muted">Timeline</div>
                                <div className="text-foreground">
                                  {(() => {
                                    const o = parseVersionTimelineObj(selectedVersion.timeline_proposal)
                                    return o?.duration != null && o?.unit ? `${o.duration} ${o.unit}` : "—"
                                  })()}
                                </div>
                                {(selectedVersion.timeline || selectedVersion.timeline_unit) && (
                                  <div className="font-mono text-[10px] text-foreground-muted mt-1">
                                    {selectedVersion.timeline || "—"} {selectedVersion.timeline_unit || ""}
                                  </div>
                                )}
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
                            <div className="pt-1">
                              <div className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Attachments</div>
                              {(() => {
                                const att = Array.isArray(selectedVersion.attachments) ? selectedVersion.attachments : []
                                if (att.length === 0) {
                                  return (
                                    <p className="text-sm text-foreground-muted font-mono text-[10px]">No attachments</p>
                                  )
                                }
                                return (
                                  <ul className="space-y-2">
                                    {att.map((a, i) => {
                                      const isBlob = isVercelBlobStorageUrl(a.url)
                                      const displayName = isBlob
                                        ? displayFilenameFromBlobUrl(a.url)
                                        : externalLinkLabel(a.url)
                                      const downloadHref = isBlob
                                        ? `/api/agency/blob-download?url=${encodeURIComponent(a.url)}`
                                        : null
                                      return (
                                        <li
                                          key={`${a.url}-${i}`}
                                          className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm border border-border/60 rounded-lg p-2 bg-white/5"
                                        >
                                          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white/10 text-foreground-muted shrink-0">
                                            {a.label}
                                          </span>
                                          <span className="text-foreground min-w-0 flex-1 truncate" title={displayName}>
                                            {displayName}
                                          </span>
                                          {isBlob && downloadHref ? (
                                            <Button variant="outline" size="sm" className="shrink-0 border-border/60 h-8" asChild>
                                              <a href={downloadHref}>
                                                <Download className="w-3.5 h-3.5 mr-1.5" />
                                                Download
                                              </a>
                                            </Button>
                                          ) : (
                                            <Button variant="outline" size="sm" className="shrink-0 border-border/60 h-8" asChild>
                                              <a href={a.url} target="_blank" rel="noopener noreferrer">
                                                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                                Open
                                              </a>
                                            </Button>
                                          )}
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )
                              })()}
                            </div>
                            {selectedVersion.change_notes && (
                              <div className="rounded-md border border-amber-300/50 bg-amber-500/10 p-2">
                                <div className="font-mono text-[10px] uppercase text-amber-200">Change notes</div>
                                <p className="text-sm text-amber-100 whitespace-pre-wrap">{selectedVersion.change_notes}</p>
                              </div>
                            )}
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

                  {canMutate && <div className="border-t border-border/50 pt-4 space-y-3">
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
                                    className="text-xs text-foreground hover:text-accent"
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
                        type="button"
                        size="sm"
                        variant={r.status === "meeting_requested" ? "default" : "outline"}
                        className={cn(
                          r.status === "meeting_requested"
                            ? meetingHoverIds[r.id]
                              ? "bg-slate-600 hover:bg-slate-600/90 text-white"
                              : "bg-cyan-600 hover:bg-cyan-600/90 text-white"
                            : "border-cyan-400/40 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-900/45"
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
                        type="button"
                        size="sm"
                        variant={r.status === "shortlisted" ? "default" : "outline"}
                        className={cn(
                          r.status === "shortlisted"
                            ? shortlistHoverIds[r.id]
                              ? "bg-red-600 hover:bg-red-600/90 text-white"
                              : "bg-purple-600 hover:bg-purple-600/90 text-white"
                            : "border-purple-400/40 bg-purple-900/30 text-purple-100 hover:bg-purple-900/45"
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
                        type="button"
                        size="sm"
                        className="bg-green-600 hover:bg-green-600/90 text-white"
                        onClick={() =>
                          setAwardDialog({
                            id: r.id,
                            partner: r.partner_display_name,
                            scope: scopeName,
                          })
                        }
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
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-red-400/40 bg-red-900/30 text-red-100 hover:bg-red-900/45"
                        onClick={() =>
                          patchResponse(r.id, { status: "declined", decline_reason: declineReasons[r.id] || "" })
                        }
                        disabled={busyId === r.id || r.status === "awarded"}
                      >
                        {r.status === "declined" ? "Declined" : "Decline"}
                      </Button>
                      {r.status === "awarded" && projectId && (
                        <Button
                          type="button"
                          size="sm"
                          className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white border border-white/10"
                          asChild
                        >
                          <Link
                            href={`/agency/onboarding?projectId=${encodeURIComponent(projectId)}`}
                            prefetch={false}
                          >
                            Start Onboarding
                          </Link>
                        </Button>
                      )}
                      {r.status === "declined" && (
                        <Button
                          type="button"
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
                  </div>}
                </div>
              )}
            </div>
          )
            })}
          </div>
        ))}
      </div>
    </GlassCard>

      <AlertDialog
        open={awardDialog !== null}
        onOpenChange={(open) => {
          if (!open) setAwardDialog(null)
        }}
      >
        <AlertDialogContent className="border border-white/15 bg-[#081F1F] text-foreground shadow-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Award this bid?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <p className="text-foreground/85 text-left text-sm leading-relaxed">
                {awardDialog ? (
                  <>
                    You&apos;re about to award{" "}
                    <span className="font-semibold text-foreground">{awardDialog.partner}</span> the{" "}
                    <span className="font-semibold text-foreground">{awardDialog.scope}</span>. This action cannot be
                    undone. The partner will be notified immediately.
                  </>
                ) : (
                  <span />
                )}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel type="button" className="border-border/60 text-foreground hover:bg-white/10 mt-0">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white"
                disabled={
                  !awardDialog ||
                  (busyId !== null && busyId === awardDialog.id)
                }
                onClick={(e) => {
                  if (!awardDialog) {
                    e.preventDefault()
                    return
                  }
                  const { id } = awardDialog
                  setAwardDialog(null)
                  void patchResponse(id, { status: "awarded" })
                }}
              >
                Confirm Award
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
