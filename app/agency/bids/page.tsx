"use client"

import { useState, useMemo, useCallback } from "react"
import Link from "next/link"
import { mutate } from "swr"
import { AgencyLayout } from "@/components/agency-layout"
import { useFetch } from "@/hooks/useFetch"
import { cn, formatSubmittedAt } from "@/lib/utils"
import { buildBidTimeline } from "@/lib/bid-timeline"
import {
  type BidRow,
  BID_STATUSES,
  type BidStatusKey,
  statusBadge,
  formatDeadline,
  attachmentHref,
  bestBudgetDisplay,
  scopeKeyForRow,
} from "@/lib/bid-shared"
import {
  Search, Filter, ChevronDown, ChevronRight,
  Building2, Users, AlertTriangle, Clock, CheckCircle, XCircle,
  Paperclip, ExternalLink, Link as LinkIcon, Star, CalendarDays, Loader2,
  MoreVertical, Sparkles, X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { formatTimelineForDisplay } from "@/lib/rfp-response-fields"
import {
  DESIGNATION_KEYS,
  DESIGNATION_LABELS,
  INSURANCE_KEYS,
  INSURANCE_LABELS,
  compareBusinessCriteria,
  normalizeBusinessCriteriaRequired,
  withBusinessCriteriaDefaults,
} from "@/lib/business-criteria"
import { meetsInsuranceMinimum } from "@/lib/insurance-limit-parser"

const RFP_RESPONSES_URL = "/api/agency/rfp-responses"

// ── AI summary strip ─────────────────────────────────────────────────────────

/** Generates (or regenerates) the AI summary for one bid, then patches the shared SWR
 *  cache directly (no revalidate round-trip) so every card/sheet showing this response
 *  picks up the fresh columns immediately instead of flashing back to "Generate". */
async function requestSummaryGeneration(responseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/agency/bids/${responseId}/generate-summary`, { method: "POST" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error || "Analysis unavailable" }
    void mutate(
      RFP_RESPONSES_URL,
      (current: { responses: BidRow[] } | undefined) =>
        current
          ? {
              responses: current.responses.map((r) =>
                r.id === responseId
                  ? {
                      ...r,
                      ai_summary_short: data.ai_summary_short ?? r.ai_summary_short,
                      ai_summary_detailed: data.ai_summary_detailed ?? r.ai_summary_detailed,
                      ai_summary_generated_at: data.ai_summary_generated_at ?? r.ai_summary_generated_at,
                    }
                  : r
              ),
            }
          : current,
      { revalidate: false }
    )
    return { ok: true }
  } catch {
    return { ok: false, error: "Analysis unavailable" }
  }
}

function BidSummaryStrip({
  row, generating, error, onGenerate,
}: {
  row: BidRow
  generating: boolean
  error: string | null
  onGenerate: () => void
}) {
  if (generating) {
    return (
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-3 w-full max-w-[420px] bg-white/10" />
        <Skeleton className="h-3 w-2/3 max-w-[280px] bg-white/10" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-2 flex items-center gap-2 font-mono text-[10px] text-red-300">
        <span>{error}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onGenerate() }} className="underline hover:text-red-200">
          Retry
        </button>
      </div>
    )
  }

  if (row.ai_summary_short) {
    return (
      <p className="mt-2 text-xs text-foreground/80 leading-relaxed flex items-start gap-1.5">
        <Sparkles className="w-3 h-3 text-accent shrink-0 mt-0.5" />
        <span>{row.ai_summary_short}</span>
      </p>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <Skeleton className="h-3 w-full max-w-[320px] bg-white/5" />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onGenerate() }}
        className="shrink-0 font-mono text-[10px] text-accent hover:underline whitespace-nowrap"
      >
        Generate
      </button>
    </div>
  )
}

// ── Bid card ─────────────────────────────────────────────────────────────────

function BidCard({
  row, groupBy, onView, selected, onToggleSelect,
}: {
  row: BidRow
  groupBy: "client" | "partner"
  onView: (row: BidRow) => void
  selected: boolean
  onToggleSelect: (id: string) => void
}) {
  const [summaryGenerating, setSummaryGenerating] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const badge = statusBadge(row.status)
  const scope = row.inbox?.scope_item_name || row.project_name || "Scope"
  const deadline = formatDeadline(row.inbox?.response_deadline)
  const budget = bestBudgetDisplay(row)
  const submittedAt = formatSubmittedAt(row.submitted_at)
  const canSelect = row.response_exists && Boolean(row.response_id)

  const generateSummary = async () => {
    setSummaryGenerating(true)
    setSummaryError(null)
    const result = await requestSummaryGeneration(row.id)
    setSummaryGenerating(false)
    if (!result.ok) setSummaryError("Analysis unavailable - try again")
  }

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border/40 bg-white/5 hover:bg-white/8 transition-colors">
      {canSelect && (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(row.id)}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 shrink-0 border-border data-[state=checked]:bg-accent data-[state=checked]:border-accent"
          aria-label={`Select ${row.partner_display_name} bid for comparison`}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-display font-bold text-foreground truncate">{scope}</span>
          <span className={cn(
            "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
            badge.bg, badge.text
          )}>
            {badge.label}
          </span>
          {!row.partner_id && row.response_exists && (
            <span className="font-mono text-[9px] px-2 py-0.5 rounded-full border border-teal-400/40 bg-teal-500/10 text-teal-300 uppercase tracking-wider shrink-0">
              Guest Submission
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-foreground-muted flex-wrap">
          {groupBy === "client" && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {row.partner_display_name}
            </span>
          )}
          {groupBy === "partner" && row.client_name && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {row.client_name}
            </span>
          )}
          {row.project_name && (
            <>
              {(groupBy === "client" || row.client_name) && <span className="text-foreground-muted/40">·</span>}
              <span>{row.project_name}</span>
            </>
          )}
          {budget && (
            <>
              <span className="text-foreground-muted/40">·</span>
              <span className="text-accent">{budget}</span>
            </>
          )}
          {deadline && (
            <>
              <span className="text-foreground-muted/40">·</span>
              <Clock className="w-3 h-3" />
              <span>Due {deadline}</span>
            </>
          )}
        </div>
        {submittedAt && (
          <div className="font-mono text-[10px] text-foreground-muted/70 mt-1">
            Submitted {submittedAt}
          </div>
        )}
        {row.response_exists && (
          <BidSummaryStrip
            row={row}
            generating={summaryGenerating}
            error={summaryError}
            onGenerate={() => void generateSummary()}
          />
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onView(row)}
          className="flex items-center gap-1 font-mono text-[10px] text-accent border border-accent/30 hover:bg-accent/10 rounded-md px-2 py-1 transition-colors"
        >
          View <ChevronRight className="w-3 h-3" />
        </button>
        {row.response_exists && row.ai_summary_short && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded-md text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
                aria-label="Bid actions"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-background border-border">
              <DropdownMenuItem
                onClick={() => void generateSummary()}
                className="text-foreground focus:bg-white/5 focus:text-foreground"
              >
                Regenerate Summary
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

// ── Bid detail dialog ────────────────────────────────────────────────────────

function BidDetailDialog({ row, onClose }: { row: BidRow | null; onClose: () => void }) {
  if (!row) return null
  // Key by id so switching to a different bid gets a fresh instance — local action/feedback
  // state below must not leak from one bid's dialog session into another's.
  return <BidDetailDialogInner key={row.id} initialRow={row} onClose={onClose} />
}

function BidDetailDialogInner({ initialRow, onClose }: { initialRow: BidRow; onClose: () => void }) {
  const [row, setRow] = useState(initialRow)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [feedbackDraft, setFeedbackDraft] = useState((initialRow.agency_feedback || "").trim())
  const [feedbackSaved, setFeedbackSaved] = useState(false)
  const [declineReason, setDeclineReason] = useState("")
  const [awardConfirmOpen, setAwardConfirmOpen] = useState(false)
  const [shortlistHover, setShortlistHover] = useState(false)
  const [meetingHover, setMeetingHover] = useState(false)

  const badge = statusBadge(row.status)
  const scope = row.inbox?.scope_item_name || row.project_name || "Scope"
  const budget = bestBudgetDisplay(row)
  const timeline = row.timeline_proposal ? formatTimelineForDisplay(row.timeline_proposal) : null

  const activityTimeline = buildBidTimeline({
    rfpSentAt: row.rfp_sent_at ?? row.inbox?.created_at ?? null,
    submittedAt: row.submitted_at,
    feedbackAt: row.agency_feedback ? row.feedback_updated_at : null,
    awardedAt: row.awarded_at,
  })

  const businessCriteriaResponses = withBusinessCriteriaDefaults(row.business_criteria_responses)
  const businessCriteriaRequired = normalizeBusinessCriteriaRequired(row.business_criteria_required)
  const businessCriteriaGap = compareBusinessCriteria(businessCriteriaRequired, businessCriteriaResponses)
  const requiredDesignationKeys = DESIGNATION_KEYS.filter((key) => businessCriteriaRequired.designations[key] === true)
  const requiredInsuranceKeys = INSURANCE_KEYS.filter((key) => businessCriteriaRequired.insurance[key]?.required === true)
  const designationKeysToShow = DESIGNATION_KEYS.filter(
    (key) => requiredDesignationKeys.includes(key) || businessCriteriaResponses.designations[key].holds
  )
  const insuranceKeysToShow = INSURANCE_KEYS.filter(
    (key) => requiredInsuranceKeys.includes(key) || businessCriteriaResponses.insurance[key].has_coverage
  )
  const showCoiRow = businessCriteriaRequired.insurance.coi_on_file || businessCriteriaResponses.insurance.coi_on_file
  const showBusinessCriteriaSection =
    designationKeysToShow.length > 0 || insuranceKeysToShow.length > 0 || showCoiRow
  const isGuest = !row.partner_id && row.response_exists
  const identity = isGuest ? row.vendor_email || row.partner_display_name : row.partner_display_name
  const projectId = row.inbox?.project_id
  const canMutate = Boolean(row.response_id)
  const isAwarded = row.status === "awarded"

  // Same endpoint, payload shapes, and local-merge pattern as the original per-row actions
  // in components/agency-broadcast-responses.tsx — just scoped to a single row here.
  const patchResponse = async (payload: Record<string, unknown>) => {
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/agency/rfp-responses/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to update response")
      setRow((prev) => ({ ...prev, ...(data.response || prev) }))
      if ("agency_feedback" in payload) {
        setFeedbackSaved(true)
        setTimeout(() => setFeedbackSaved(false), 3000)
      }
      void mutate(RFP_RESPONSES_URL)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to update")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 flex-wrap">
              {scope}
              <span
                className={cn(
                  "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider",
                  badge.bg, badge.text
                )}
              >
                {badge.label}
              </span>
              {isGuest && (
                <span className="font-mono text-[9px] px-2 py-0.5 rounded-full border border-teal-400/40 bg-teal-500/10 text-teal-300 uppercase tracking-wider">
                  Guest Submission
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-foreground-muted">
              {[identity, row.client_name, row.project_name].filter(Boolean).join(" · ")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!row.response_exists ? (
              <p className="text-sm text-foreground-muted">Awaiting partner response.</p>
            ) : (
              <>
                {row.proposal_text && (
                  <div>
                    <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Proposal</div>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {row.proposal_text}
                    </p>
                  </div>
                )}
                {(budget || timeline) && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {budget && (
                      <div>
                        <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Budget</div>
                        <div className="text-sm text-foreground">{budget}</div>
                      </div>
                    )}
                    {timeline && (
                      <div>
                        <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Timeline</div>
                        <div className="text-sm text-foreground">{timeline}</div>
                      </div>
                    )}
                  </div>
                )}
                {row.payment_terms && (
                  <div>
                    <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Payment Terms</div>
                    <div className="text-sm text-foreground space-y-1">
                      {row.payment_terms.deposit_required_pct != null && (
                        <p>Deposit: {row.payment_terms.deposit_required_pct}%</p>
                      )}
                      {row.payment_terms.payment_schedule_preference && (
                        <p>Schedule: {row.payment_terms.payment_schedule_preference}</p>
                      )}
                      {row.payment_terms.additional_notes && <p>Notes: {row.payment_terms.additional_notes}</p>}
                    </div>
                  </div>
                )}
                {row.attachments && row.attachments.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Attachments</div>
                    <ul className="space-y-1.5">
                      {row.attachments.map((a, i) => (
                        <li key={`${a.url}-${i}`}>
                          <a
                            href={attachmentHref(a.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-mono text-xs text-accent hover:underline"
                          >
                            {a.type === "link" ? (
                              <LinkIcon className="w-3 h-3" />
                            ) : (
                              <Paperclip className="w-3 h-3" />
                            )}
                            {a.label}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {activityTimeline.length > 0 && (
                  <div>
                    <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Activity</div>
                    <ul className="space-y-1">
                      {activityTimeline.map((entry, i) => (
                        <li key={i} className="font-mono text-[10px] text-foreground-muted flex items-center gap-2">
                          <span className="w-1 h-1 rounded-full bg-foreground-muted/60 shrink-0" />
                          {entry.label} {formatSubmittedAt(entry.iso)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {showBusinessCriteriaSection && (
                  <div>
                    <div className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Business Criteria</div>
                    <div className="space-y-2">
                      {designationKeysToShow.map((key) => {
                        const designation = businessCriteriaResponses.designations[key]
                        const isRequired = requiredDesignationKeys.includes(key)
                        const isMissing = businessCriteriaGap.missingDesignations.includes(key)
                        return (
                          <div key={key} className="flex items-start justify-between gap-3 text-sm">
                            <div className="min-w-0">
                              <div className="text-foreground">{DESIGNATION_LABELS[key]}</div>
                              {designation.holds && (designation.certifying_body || designation.certification_number) && (
                                <div className="font-mono text-[10px] text-foreground-muted mt-0.5">
                                  {[designation.certifying_body, designation.certification_number]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </div>
                              )}
                              {designation.holds && designation.self_certified && (
                                <div className="font-mono text-[10px] text-foreground-muted mt-0.5">Self-certified</div>
                              )}
                            </div>
                            {isRequired ? (
                              isMissing ? (
                                <span className="inline-flex items-center gap-1 text-amber-300 shrink-0">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  <span className="font-mono text-[9px] uppercase">Missing</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-emerald-300 shrink-0">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  <span className="font-mono text-[9px] uppercase">Met</span>
                                </span>
                              )
                            ) : (
                              <span className="font-mono text-[9px] uppercase text-foreground-muted shrink-0">
                                Confirmed
                              </span>
                            )}
                          </div>
                        )
                      })}
                      {insuranceKeysToShow.map((key) => {
                        const coverage = businessCriteriaResponses.insurance[key]
                        const isRequired = requiredInsuranceKeys.includes(key)
                        const isMissing = businessCriteriaGap.missingInsurance.includes(key)
                        const minimum = businessCriteriaRequired.insurance[key]?.minimum
                        // Presence-only check (isMissing) only knows whether coverage exists.
                        // When it's present and required, additionally verify the held limit
                        // against the stated minimum - "not_met" upgrades the badge to Missing,
                        // "unknown" (either side unparseable) keeps the presence-only Met badge
                        // with a hint rather than guessing.
                        const limitVerdict =
                          isRequired && !isMissing && minimum ? meetsInsuranceMinimum(coverage.limit, minimum) : null
                        return (
                          <div key={key} className="flex items-start justify-between gap-3 text-sm">
                            <div className="min-w-0">
                              <div className="text-foreground">
                                {INSURANCE_LABELS[key]}
                                {minimum ? ` (min. ${minimum})` : ""}
                              </div>
                              {coverage.has_coverage && coverage.limit && (
                                <div className="font-mono text-[10px] text-foreground-muted mt-0.5">
                                  Limit: {coverage.limit}
                                </div>
                              )}
                              {limitVerdict === "unknown" && (
                                <div className="font-mono text-[9px] text-foreground-muted/70 mt-0.5 italic">
                                  Limit not auto-verified
                                </div>
                              )}
                            </div>
                            {isRequired ? (
                              isMissing || limitVerdict === "not_met" ? (
                                <span className="inline-flex items-center gap-1 text-amber-300 shrink-0">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  <span className="font-mono text-[9px] uppercase">Missing</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-emerald-300 shrink-0">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  <span className="font-mono text-[9px] uppercase">Met</span>
                                </span>
                              )
                            ) : (
                              <span className="font-mono text-[9px] uppercase text-foreground-muted shrink-0">
                                Confirmed
                              </span>
                            )}
                          </div>
                        )
                      })}
                      {showCoiRow && (
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <div className="text-foreground">Certificate of Insurance (COI) on file</div>
                          {businessCriteriaRequired.insurance.coi_on_file ? (
                            businessCriteriaGap.missingCoi ? (
                              <span className="inline-flex items-center gap-1 text-amber-300 shrink-0">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span className="font-mono text-[9px] uppercase">Missing</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-300 shrink-0">
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span className="font-mono text-[9px] uppercase">Met</span>
                              </span>
                            )
                          ) : (
                            <span className="font-mono text-[9px] uppercase text-foreground-muted shrink-0">
                              Confirmed
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {canMutate && (
                  <div>
                    <label className="block font-mono text-[10px] uppercase text-foreground-muted mb-1">
                      Agency Feedback
                    </label>
                    <Textarea
                      value={feedbackDraft}
                      onChange={(e) => setFeedbackDraft(e.target.value)}
                      placeholder="Share notes or next steps for the partner…"
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[90px]"
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-border text-foreground hover:bg-white/5"
                        disabled={busy}
                        onClick={() =>
                          patchResponse({
                            agency_feedback: feedbackDraft,
                            status: row.status === "submitted" ? "under_review" : row.status,
                          })
                        }
                      >
                        {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                        Save Feedback
                      </Button>
                      {feedbackSaved && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-500">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Feedback submitted
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {actionError && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    {actionError}
                  </div>
                )}
              </>
            )}
          </div>

          {(canMutate || projectId) && (
            <DialogFooter className="flex-wrap gap-2 sm:justify-start">
              {canMutate && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant={row.status === "meeting_requested" ? "default" : "outline"}
                    className={cn(
                      row.status === "meeting_requested"
                        ? meetingHover
                          ? "bg-slate-600 hover:bg-slate-600/90 text-white"
                          : "bg-cyan-600 hover:bg-cyan-600/90 text-white"
                        : "border-cyan-400/40 bg-cyan-900/30 text-cyan-100 hover:bg-cyan-900/45"
                    )}
                    onMouseEnter={() => row.status === "meeting_requested" && setMeetingHover(true)}
                    onMouseLeave={() => row.status === "meeting_requested" && setMeetingHover(false)}
                    onClick={() =>
                      patchResponse({ status: row.status === "meeting_requested" ? "under_review" : "meeting_requested" })
                    }
                    disabled={busy || isAwarded}
                  >
                    <CalendarDays
                      className={cn(
                        "w-3.5 h-3.5 mr-1.5",
                        row.status === "meeting_requested" && !meetingHover && "fill-current"
                      )}
                    />
                    {row.status === "meeting_requested"
                      ? meetingHover
                        ? "Cancel Meeting Request"
                        : "Meeting Requested"
                      : "Request Meeting"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={row.status === "shortlisted" ? "default" : "outline"}
                    className={cn(
                      row.status === "shortlisted"
                        ? shortlistHover
                          ? "bg-red-600 hover:bg-red-600/90 text-white"
                          : "bg-purple-600 hover:bg-purple-600/90 text-white"
                        : "border-purple-400/40 bg-purple-900/30 text-purple-100 hover:bg-purple-900/45"
                    )}
                    onMouseEnter={() => row.status === "shortlisted" && setShortlistHover(true)}
                    onMouseLeave={() => row.status === "shortlisted" && setShortlistHover(false)}
                    onClick={() => patchResponse({ status: row.status === "shortlisted" ? "under_review" : "shortlisted" })}
                    disabled={busy || isAwarded}
                  >
                    <Star className={cn("w-3.5 h-3.5 mr-1.5", row.status === "shortlisted" && !shortlistHover && "fill-current")} />
                    {row.status === "shortlisted" ? (shortlistHover ? "Remove from shortlist" : "Shortlisted") : "Shortlist"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-green-600 hover:bg-green-600/90 text-white"
                    onClick={() => setAwardConfirmOpen(true)}
                    disabled={busy || isAwarded || isGuest}
                    title={isGuest ? "Award isn't available yet for guest submissions — they aren't linked to a partner account." : undefined}
                  >
                    Award
                  </Button>
                  {row.status !== "declined" && (
                    <Input
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      placeholder="Optional decline reason"
                      className="h-8 max-w-[180px] text-sm bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                    />
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-red-400/40 bg-red-900/30 text-red-100 hover:bg-red-900/45"
                    onClick={() => patchResponse({ status: "declined", decline_reason: declineReason })}
                    disabled={busy || isAwarded || row.status === "declined"}
                  >
                    {row.status === "declined" ? "Declined" : "Decline"}
                  </Button>
                  {row.status === "declined" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-border text-foreground hover:bg-white/5"
                      onClick={() => patchResponse({ status: "submitted" })}
                      disabled={busy}
                    >
                      Undo Decline
                    </Button>
                  )}
                  {isAwarded && projectId && (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white border border-white/10"
                      asChild
                    >
                      <Link href={`/agency/onboarding?projectId=${encodeURIComponent(projectId)}`} prefetch={false}>
                        Start Onboarding
                      </Link>
                    </Button>
                  )}
                </>
              )}
              {projectId && (
                <Button asChild variant="outline" className="border-border text-foreground hover:bg-white/5">
                  <Link href={`/agency/projects/${projectId}`}>Go to Project</Link>
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={awardConfirmOpen} onOpenChange={setAwardConfirmOpen}>
        <AlertDialogContent className="border border-white/15 bg-[#081F1F] text-foreground shadow-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Award this bid?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <p className="text-foreground/85 text-left text-sm leading-relaxed">
                You&apos;re about to award <span className="font-semibold text-foreground">{row.partner_display_name}</span>{" "}
                the <span className="font-semibold text-foreground">{scope}</span>. This action cannot be undone. The
                partner will be notified immediately.
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
                disabled={busy}
                onClick={() => {
                  setAwardConfirmOpen(false)
                  void patchResponse({ status: "awarded" })
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

// ── Group section ─────────────────────────────────────────────────────────────

function GroupSection({
  label, rows, defaultOpen, groupBy, onView, selectedIds, onToggleSelect,
}: {
  label: string
  rows: BidRow[]
  defaultOpen: boolean
  groupBy: "client" | "partner"
  onView: (row: BidRow) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [activeStatus, setActiveStatus] = useState<BidStatusKey>("all")

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length }
    for (const r of rows) {
      map[r.status] = (map[r.status] || 0) + 1
    }
    return map
  }, [rows])

  const filtered = useMemo(
    () => activeStatus === "all" ? rows : rows.filter(r => r.status === activeStatus),
    [rows, activeStatus]
  )

  return (
    <div className="rounded-xl border border-border/40 bg-white/[0.02] overflow-hidden">
      {/* Group header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-5 hover:bg-white/5 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
          {groupBy === "client"
            ? <Building2 className="w-5 h-5 text-foreground-muted" />
            : <Users className="w-5 h-5 text-foreground-muted" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-xl text-foreground">{label}</div>
          <div className="font-mono text-[11px] text-foreground-muted mt-0.5">
            {rows.length} RFP{rows.length !== 1 ? "s" : ""}
            {counts["awarded"] > 0 && (
              <span className="ml-2 text-emerald-400">· {counts["awarded"]} awarded</span>
            )}
          </div>
        </div>
        <div className={cn("transition-transform shrink-0", open && "rotate-180")}>
          <ChevronDown className="w-5 h-5 text-foreground-muted" />
        </div>
      </button>

      {open && (
        <div className="border-t border-border/30">
          {/* Status tabs */}
          <div className="flex gap-1 flex-wrap px-4 pt-3 pb-2 overflow-x-auto">
            {BID_STATUSES.map(({ key, label: tabLabel }) => {
              const count = counts[key] ?? 0
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveStatus(key)}
                  className={cn(
                    "shrink-0 px-2.5 py-1 rounded-lg font-mono text-[10px] transition-colors whitespace-nowrap",
                    activeStatus === key
                      ? "bg-accent text-accent-foreground"
                      : "bg-white/5 text-foreground-muted hover:bg-white/10"
                  )}
                >
                  {tabLabel} ({key === "all" ? rows.length : count})
                </button>
              )
            })}
          </div>

          {/* Bid list */}
          <div className="px-4 pb-4 space-y-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-foreground-muted py-4 text-center">No bids match this filter.</p>
            ) : (
              filtered.map(row => (
                <BidCard
                  key={row.id}
                  row={row}
                  groupBy={groupBy}
                  onView={onView}
                  selected={selectedIds.has(row.id)}
                  onToggleSelect={onToggleSelect}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type GroupBy = "client" | "partner"

export default function AgencyBidsPage() {
  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("client")
  const [viewingBid, setViewingBid] = useState<BidRow | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [compareIds, setCompareIds] = useState<string[] | null>(null)

  const { data, isLoading, error } = useFetch<{ responses: BidRow[] }>(RFP_RESPONSES_URL)

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allRowsById = useMemo(
    () => new Map((data?.responses ?? []).map((r) => [r.id, r])),
    [data]
  )
  const selectedRows = useMemo(
    () => Array.from(selectedIds).map((id) => allRowsById.get(id)).filter((r): r is BidRow => Boolean(r)),
    [selectedIds, allRowsById]
  )
  const selectedScopeKeys = useMemo(
    () => new Set(selectedRows.map((r) => scopeKeyForRow(r))),
    [selectedRows]
  )
  const compareEligible =
    selectedRows.length >= 2 && selectedScopeKeys.size === 1 && !selectedScopeKeys.has(null)

  const groups = useMemo(() => {
    const all = data?.responses ?? []
    const q = search.trim().toLowerCase()

    const filtered = q
      ? all.filter(r => {
          const hay = [
            r.client_name,
            r.partner_display_name,
            r.project_name,
            r.inbox?.scope_item_name,
          ].join(" ").toLowerCase()
          return hay.includes(q)
        })
      : all

    const map = new Map<string, { label: string; rows: BidRow[] }>()
    for (const r of filtered) {
      if (groupBy === "client" && !r.client_name?.trim()) {
        // Skip RFPs with no client name rather than grouping them under a visible
        // "No Client" label - missing client data is a data quality issue, not a
        // valid client group to show real users.
        continue
      }
      // Group by partner_id when present, not partner_display_name: a guest/magic-link bid
      // from a known partner carries whatever name the agency typed into the invite, which
      // can differ from that partner's other bids and would otherwise split them into a
      // separate group. partner_id is the stable identity; display_name is cosmetic only.
      const key = groupBy === "client" ? r.client_name!.trim() : r.partner_id || r.partner_display_name || "Unknown Partner"
      const label = groupBy === "client" ? r.client_name!.trim() : r.partner_display_name || "Unknown Partner"
      const existing = map.get(key)
      if (existing) {
        existing.rows.push(r)
      } else {
        map.set(key, { label, rows: [r] })
      }
    }

    return Array.from(map.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(({ label, rows }) => ({ label, rows }))
  }, [data, search, groupBy])

  const totalRfps = data?.responses?.length ?? 0
  const totalGroups = groups.length

  // Compare mode is built out fully in Part 3 (CompareView, at-a-glance + AI comparison).
  // This placeholder keeps "Compare N Bids" functional end-to-end for this part.
  if (compareIds) {
    return (
      <AgencyLayout>
        <div className="p-8 max-w-5xl space-y-6">
          <button
            type="button"
            onClick={() => setCompareIds(null)}
            className="flex items-center gap-1 font-mono text-xs text-accent hover:underline"
          >
            <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back to Bids
          </button>
          <p className="text-sm text-foreground-muted">
            Comparing {compareIds.length} bids. Full comparison view lands in Part 3.
          </p>
        </div>
      </AgencyLayout>
    )
  }

  return (
    <AgencyLayout>
      <div className="p-8 max-w-5xl space-y-6 pb-24">
        {/* Header */}
        <div>
          <h1 className="font-display font-bold text-3xl text-foreground">Bid Management</h1>
          <p className="text-foreground-muted mt-1">
            {isLoading
              ? "Loading…"
              : `${totalRfps} RFP${totalRfps !== 1 ? "s" : ""} across ${totalGroups} ${groupBy === "client" ? "client" : "partner agency"}${totalGroups !== 1 ? "s" : ""}`
            }
          </p>
        </div>

        {/* Search + group-by toggle */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
            <Input
              placeholder="Search client, partner agency, or project…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Group by</span>
            <div className="flex rounded-lg overflow-hidden border border-border">
              {(["client", "partner"] as GroupBy[]).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  className={cn(
                    "px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    groupBy === g
                      ? "bg-accent text-accent-foreground"
                      : "bg-white/5 text-foreground-muted hover:bg-white/10"
                  )}
                >
                  {g === "client" ? "Client" : "Partner Agency"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        {isLoading && (
          <div className="text-foreground-muted font-mono text-sm py-12 text-center">Loading bids…</div>
        )}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            Failed to load bids. Please refresh.
          </div>
        )}
        {!isLoading && !error && groups.length === 0 && (
          <div className="rounded-xl border border-border/40 bg-white/5 p-12 text-center">
            <div className="font-display font-bold text-lg text-foreground mb-2">
              {search ? "No results" : "No bids yet"}
            </div>
            <p className="text-sm text-foreground-muted">
              {search ? "Try a different search term." : "Broadcast an RFP to start receiving bids."}
            </p>
          </div>
        )}
        {!isLoading && groups.length > 0 && (
          <div className="space-y-4">
            {groups.map((g, i) => (
              <GroupSection
                key={g.label}
                label={g.label}
                rows={g.rows}
                defaultOpen={i === 0}
                groupBy={groupBy}
                onView={setViewingBid}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        )}
      </div>
      <BidDetailDialog row={viewingBid} onClose={() => setViewingBid(null)} />

      {selectedRows.length >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-full border border-border bg-background/95 backdrop-blur px-5 py-3 shadow-2xl">
          <span className="font-mono text-xs text-foreground-muted">
            {selectedRows.length} bid{selectedRows.length !== 1 ? "s" : ""} selected
          </span>
          {compareEligible ? (
            <Button
              size="sm"
              className="bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => setCompareIds(selectedRows.map((r) => r.id))}
            >
              Compare {selectedRows.length} Bids
            </Button>
          ) : (
            <span className="font-mono text-[10px] text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Select bids from the same RFP to compare
            </span>
          )}
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-foreground-muted hover:text-foreground transition-colors"
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </AgencyLayout>
  )
}
