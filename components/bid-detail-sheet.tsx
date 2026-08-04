"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { mutate } from "swr"
import {
  type BidRow,
  statusBadge,
  bestBudgetDisplay,
  attachmentHref,
} from "@/lib/bid-shared"
import { buildBidTimeline } from "@/lib/bid-timeline"
import { cn, formatSubmittedAt } from "@/lib/utils"
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
import {
  withTermsDisclosureDefaults,
  IP_RIGHTS_LABELS,
  TERM_STATE_LABELS,
  TERM_STATE_BADGE_CLASS,
  type TermState,
} from "@/lib/terms-disclosure"
import { HelpTerm } from "@/components/help-term"
import type { GlossaryKey } from "@/lib/glossary"
import { AiMarkdown } from "@/components/ai-markdown"
import { useUsageLimitModal } from "@/contexts/usage-limit-modal-context"
import { BidEvaluationTab, type BidEvaluationTabHandle } from "@/components/bid-evaluation-tab"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
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
import {
  AlertTriangle, CheckCircle, Paperclip, ExternalLink, Link as LinkIcon, Star,
  CalendarDays, Loader2, Sparkles,
} from "lucide-react"

const RFP_RESPONSES_URL = "/api/agency/rfp-responses"

type LineItem = { category: string; amount: number; percentage_of_total: number; description: string }
type Decomposition = { line_items: LineItem[]; narrative_summary: string | null }

type BidDetailSheetProps = {
  row: BidRow | null
  onClose: () => void
  /** Opens directly to a given tab - used by compare mode's "Evaluate"/"Evaluate All". */
  initialTab?: "analysis" | "cost" | "evaluate"
  /** When set, shows a "Save & Next: {label}" action that saves the current evaluation
   *  before advancing - compare mode's "Evaluate All" sequential flow. */
  onNext?: { label: string; onClick: () => void } | null
}

export function BidDetailSheet({ row, onClose, initialTab, onNext }: BidDetailSheetProps) {
  if (!row) return null
  // Key by id so switching to a different bid gets a fresh instance - local action/feedback
  // state below must not leak from one bid's sheet session into another's.
  return (
    <BidDetailSheetInner key={row.id} initialRow={row} onClose={onClose} initialTab={initialTab} onNext={onNext} />
  )
}

function BidDetailSheetInner({
  initialRow, onClose, initialTab, onNext,
}: {
  initialRow: BidRow
  onClose: () => void
  initialTab?: "analysis" | "cost" | "evaluate"
  onNext?: { label: string; onClick: () => void } | null
}) {
  const [row, setRow] = useState(initialRow)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [feedbackDraft, setFeedbackDraft] = useState((initialRow.agency_feedback || "").trim())
  const [feedbackSaved, setFeedbackSaved] = useState(false)
  const [declineReason, setDeclineReason] = useState("")
  const [awardConfirmOpen, setAwardConfirmOpen] = useState(false)
  const [shortlistHover, setShortlistHover] = useState(false)
  const [meetingHover, setMeetingHover] = useState(false)
  const evaluationTabRef = useRef<BidEvaluationTabHandle>(null)
  const [nextSaving, setNextSaving] = useState(false)
  const [nextError, setNextError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState(initialTab || "analysis")
  const [analysisGenerating, setAnalysisGenerating] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [decomposition, setDecomposition] = useState<Decomposition | null>(null)
  const [decomposeFetched, setDecomposeFetched] = useState(false)
  const [decomposing, setDecomposing] = useState(false)
  const { guardAction, handleUsageLimitError } = useUsageLimitModal()
  const [decomposeError, setDecomposeError] = useState<string | null>(null)

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
  // in components/agency-broadcast-responses.tsx, just scoped to a single row here.
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

  const handleNext = async () => {
    if (!onNext) return
    setNextSaving(true)
    setNextError(null)
    try {
      const ok = await evaluationTabRef.current?.save()
      if (ok === false) {
        setNextError("Failed to save evaluation")
        return
      }
      onNext.onClick()
    } finally {
      setNextSaving(false)
    }
  }

  // isManualRetry distinguishes a deliberate click (the Retry link, or the tab's explicit
  // regenerate button) from the automatic run on sheet open below - a usage-limit hit opens
  // the blocking modal only for the former, since popping it just from opening a bid
  // (before the user asked for anything) would be jarring, especially when browsing several
  // bids in a row while already at the cap. The automatic path still shows the inline error.
  const generateAnalysis = async (isManualRetry = false) => {
    if (isManualRetry && !guardAction("ai_analyses")) return
    setAnalysisGenerating(true)
    setAnalysisError(null)
    try {
      const res = await fetch(`/api/agency/bids/${row.id}/generate-summary`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (isManualRetry && handleUsageLimitError(res.status, data)) return
        throw new Error(data?.error || "Analysis unavailable")
      }
      setRow((prev) => ({
        ...prev,
        ai_summary_short: data.ai_summary_short ?? prev.ai_summary_short,
        ai_summary_detailed: data.ai_summary_detailed ?? prev.ai_summary_detailed,
        ai_summary_generated_at: data.ai_summary_generated_at ?? prev.ai_summary_generated_at,
      }))
      void mutate(RFP_RESPONSES_URL)
    } catch {
      setAnalysisError("Analysis unavailable - try again")
    } finally {
      setAnalysisGenerating(false)
    }
  }

  // Auto-generate the detailed summary on sheet open if it doesn't exist yet.
  useEffect(() => {
    if (row.response_exists && !row.ai_summary_detailed) {
      void generateAnalysis(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDecomposition = async (force: boolean) => {
    // Same reasoning as generateAnalysis: force=true only ever comes from a deliberate
    // click (Retry / regenerate), force=false is the automatic first-view-of-the-tab load.
    if (force && !guardAction("ai_analyses")) return
    setDecomposing(true)
    setDecomposeError(null)
    try {
      const res = await fetch(`/api/agency/bids/${row.id}/decompose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (force && handleUsageLimitError(res.status, data)) return
        throw new Error(data?.error || "Analysis unavailable")
      }
      setDecomposition({ line_items: data.line_items || [], narrative_summary: data.narrative_summary || null })
    } catch {
      setDecomposeError("Analysis unavailable - try again")
    } finally {
      setDecomposing(false)
      setDecomposeFetched(true)
    }
  }

  // Lazy: only fetch the cost breakdown the first time that tab is actually viewed.
  const handleTabChange = (value: string) => {
    setActiveTab(value as "analysis" | "cost" | "evaluate")
    if (value === "cost" && row.response_exists && !decomposeFetched && !decomposing) {
      void loadDecomposition(false)
    }
  }

  return (
    <>
      <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl bg-card border-border text-foreground flex flex-col p-0 gap-0"
        >
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
            <SheetTitle className="font-display flex items-center gap-2 flex-wrap text-foreground">
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
            </SheetTitle>
            <SheetDescription className="text-foreground-muted">
              {[identity, row.client_name, row.project_name].filter(Boolean).join(" · ")}
            </SheetDescription>

            {/* Actions pinned at the top, always visible without scrolling. */}
            {(canMutate || projectId || onNext) && (
              <div className="flex flex-wrap gap-2 pt-2">
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
                      title={isGuest ? "Award isn't available yet for guest submissions, since they aren't linked to a partner account." : undefined}
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
                {onNext && (
                  <Button
                    type="button"
                    size="sm"
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                    onClick={() => void handleNext()}
                    disabled={nextSaving}
                  >
                    {nextSaving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                    Save &amp; Next: {onNext.label}
                  </Button>
                )}
              </div>
            )}
            {nextError && (
              <p className="px-0 pb-2 text-xs text-red-300">{nextError}</p>
            )}
          </SheetHeader>

          {!row.response_exists ? (
            <div className="p-6">
              <p className="text-sm text-foreground-muted">Awaiting partner response.</p>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 min-h-0 flex flex-col gap-0">
              <div className="px-6 pt-4 shrink-0">
                <TabsList>
                  <TabsTrigger value="analysis">Analysis</TabsTrigger>
                  <TabsTrigger value="cost">Cost Breakdown</TabsTrigger>
                  <TabsTrigger value="evaluate">Evaluate</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="analysis" className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                <div>
                  <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-accent" /> AI Analysis
                  </div>
                  {analysisGenerating ? (
                    <div className="space-y-2">
                      <p className="text-xs text-foreground-muted">Generating analysis...</p>
                      <Skeleton className="h-3 w-full bg-white/10" />
                      <Skeleton className="h-3 w-full bg-white/10" />
                      <Skeleton className="h-3 w-2/3 bg-white/10" />
                    </div>
                  ) : analysisError ? (
                    <div className="flex items-center gap-2 font-mono text-[10px] text-red-300">
                      <span>{analysisError}</span>
                      <button type="button" onClick={() => void generateAnalysis(true)} className="underline hover:text-red-200">
                        Retry
                      </button>
                    </div>
                  ) : row.ai_summary_detailed ? (
                    <AiMarkdown content={row.ai_summary_detailed} />
                  ) : (
                    <p className="text-sm text-foreground-muted">No analysis available yet.</p>
                  )}
                </div>

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
                <div>
                  <div className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Terms</div>
                  {row.terms_disclosure ? (
                    <div className="space-y-2.5">
                      {(() => {
                        const d = withTermsDisclosureDefaults(row.terms_disclosure)
                        const killFeeValue =
                          d.kill_fee.fee_type === "none"
                            ? "None"
                            : d.kill_fee.fee_type === "percent"
                              ? d.kill_fee.amount != null
                                ? `${d.kill_fee.amount}% of fee`
                                : null
                              : d.kill_fee.fee_type === "flat"
                                ? d.kill_fee.amount != null
                                  ? `$${d.kill_fee.amount.toLocaleString("en-US")} flat`
                                  : null
                                : null
                        const termRows: { label: string; glossaryKey: GlossaryKey; value: string | null; state: TermState | null; note: string }[] = [
                          {
                            label: "Payment",
                            glossaryKey: "net_days",
                            value:
                              d.payment.net_days != null
                                ? `Net ${d.payment.net_days}${d.payment.deposit_pct != null ? `, ${d.payment.deposit_pct}% deposit` : ""}`
                                : null,
                            state: d.payment.state,
                            note: d.payment.note,
                          },
                          {
                            label: "Kill fee",
                            glossaryKey: "kill_fee",
                            value: killFeeValue,
                            state: d.kill_fee.fee_type !== "none" ? d.kill_fee.state : null,
                            note: d.kill_fee.note,
                          },
                          {
                            label: "IP rights",
                            // Points at the specific disclosed stance (not a generic "IP
                            // rights" concept) so the cue explains what this bid actually says.
                            glossaryKey: d.ip_rights.stance || "work_for_hire",
                            value: d.ip_rights.stance ? IP_RIGHTS_LABELS[d.ip_rights.stance] : null,
                            state: d.ip_rights.state,
                            note: d.ip_rights.note,
                          },
                          {
                            label: "Rate validity",
                            glossaryKey: "rate_validity",
                            value: d.rate_validity.days != null ? `${d.rate_validity.days} days` : null,
                            state: d.rate_validity.state,
                            note: d.rate_validity.note,
                          },
                        ]
                        const disclosed = termRows.filter((t) => t.value != null)
                        if (disclosed.length === 0) return <p className="text-sm text-foreground-muted">No terms disclosed</p>
                        return disclosed.map((t) => (
                          <div key={t.label} className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <span className="text-sm text-foreground">
                                <HelpTerm term={t.glossaryKey} theme="dark">
                                  {t.label}
                                </HelpTerm>
                                : {t.value}
                              </span>
                              {t.note && <p className="text-xs text-foreground-muted mt-0.5">{t.note}</p>}
                            </div>
                            {t.state && (
                              <span
                                className={cn(
                                  "font-mono text-[10px] px-1.5 py-0.5 rounded border shrink-0",
                                  TERM_STATE_BADGE_CLASS[t.state]
                                )}
                              >
                                {TERM_STATE_LABELS[t.state]}
                              </span>
                            )}
                          </div>
                        ))
                      })()}
                    </div>
                  ) : row.payment_terms ? (
                    <div className="text-sm text-foreground space-y-1">
                      {row.payment_terms.deposit_required_pct != null && (
                        <p>Deposit: {row.payment_terms.deposit_required_pct}%</p>
                      )}
                      {row.payment_terms.payment_schedule_preference && (
                        <p>Schedule: {row.payment_terms.payment_schedule_preference}</p>
                      )}
                      {row.payment_terms.additional_notes && <p>Notes: {row.payment_terms.additional_notes}</p>}
                    </div>
                  ) : (
                    <p className="text-sm text-foreground-muted">No terms disclosed</p>
                  )}
                </div>
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
                      placeholder="Share notes or next steps for the partner..."
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
              </TabsContent>

              <TabsContent value="cost" className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {decomposing ? (
                  <div className="space-y-2">
                    <p className="text-xs text-foreground-muted">Analyzing cost structure...</p>
                    <Skeleton className="h-8 w-full bg-white/10" />
                    <Skeleton className="h-8 w-full bg-white/10" />
                    <Skeleton className="h-8 w-full bg-white/10" />
                  </div>
                ) : decomposeError ? (
                  <div className="flex items-center gap-2 font-mono text-[10px] text-red-300">
                    <span>{decomposeError}</span>
                    <button type="button" onClick={() => void loadDecomposition(true)} className="underline hover:text-red-200">
                      Retry
                    </button>
                  </div>
                ) : decomposition ? (
                  <>
                    {decomposition.line_items.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border/40 hover:bg-transparent">
                            <TableHead className="text-foreground-muted">Category</TableHead>
                            <TableHead className="text-foreground-muted">Amount</TableHead>
                            <TableHead className="text-foreground-muted">% of Total</TableHead>
                            <TableHead className="text-foreground-muted">Vendor Description</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {decomposition.line_items.map((item, i) => (
                            <TableRow key={`${item.category}-${i}`} className="border-border/30">
                              <TableCell className="text-foreground font-medium whitespace-normal">{item.category}</TableCell>
                              <TableCell className="text-foreground">${item.amount.toLocaleString("en-US")}</TableCell>
                              <TableCell className="text-foreground">{item.percentage_of_total}%</TableCell>
                              <TableCell className="text-foreground-muted whitespace-normal">{item.description || "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-foreground-muted">No line items were extracted from this proposal.</p>
                    )}

                    <p className="text-xs text-foreground-muted/70 italic">
                      For best results, include detailed line-item breakdowns in your proposal text. Attachment content
                      parsing is a v2 enhancement.
                    </p>

                    {decomposition.narrative_summary && (
                      <div className="rounded-lg border border-border/40 bg-white/5 p-4">
                        <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1 flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-accent" /> Cost Structure Notes
                        </div>
                        <AiMarkdown content={decomposition.narrative_summary} />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => void loadDecomposition(true)}
                      className="font-mono text-[10px] text-accent hover:underline"
                    >
                      Regenerate
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-foreground-muted">No cost breakdown available yet.</p>
                )}
              </TabsContent>

              <TabsContent value="evaluate" className="flex-1 overflow-y-auto px-6 py-4">
                {canMutate && <BidEvaluationTab ref={evaluationTabRef} responseId={row.id} partnerId={row.partner_id ?? null} />}
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

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
