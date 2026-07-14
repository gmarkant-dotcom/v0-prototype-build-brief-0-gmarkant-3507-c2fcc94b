"use client"

export const dynamic = "force-dynamic"

import { useCallback, useEffect, useState } from "react"
import type { ChangeEvent, FormEvent } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { formatDateTime, cn } from "@/lib/utils"
import { formatBudgetForDisplay, formatTimelineForDisplay } from "@/lib/rfp-response-fields"
import { Paperclip, X } from "lucide-react"

const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "MXN", "BRL", "AED", "SGD"]
const SCHEDULE_OPTIONS = ["Milestone-based", "Net 30", "Net 60", "Net 90", "Upon completion"]

type TokenRow = {
  token: string
  vendor_email: string
  vendor_name: string | null
  status: string
  submitted_at: string | null
}

type ProjectData = {
  id: string
  name: string
  client_name: string | null
  budget_range: string | null
  description: string | null
  start_date: string | null
  end_date: string | null
}

type AgencyData = { company_name: string | null; display_name: string | null; avatar_url: string | null }
type ScopeItemData = { name: string | null; description: string | null } | null

type ActivePayload = {
  status: "active"
  token: TokenRow
  project: ProjectData
  scopeItem: ScopeItemData
  agency: AgencyData
}
type SubmittedResponse = {
  proposal_text: string
  budget_proposal: string
  timeline_proposal: string
  payment_terms: {
    deposit_required_pct: number | null
    payment_schedule_preference: string | null
    additional_notes: string | null
  } | null
  attachments: { type: string; label: string; url: string }[] | null
}
type SubmittedPayload = { status: "submitted"; token: TokenRow; response: SubmittedResponse }

type Attachment = { url: string; filename: string; size: number }

function formatDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function agencyDisplayName(agency: AgencyData | null | undefined): string {
  return agency?.company_name?.trim() || agency?.display_name?.trim() || "the agency"
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden px-4">
      <HolographicBlobs />
      <div className="w-full max-w-md relative z-10 bg-white/5 backdrop-blur-xl border border-border/30 rounded-2xl p-8 text-center">
        {children}
      </div>
    </div>
  )
}

function AttachmentPill({ filename, onRemove }: { filename: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-border/40 font-mono text-xs text-foreground">
      <Paperclip className="w-3 h-3 text-foreground-muted shrink-0" />
      <span className="truncate max-w-[180px]">{filename}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-foreground-muted hover:text-foreground ml-1">
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  )
}

export default function GuestRfpRespondPage() {
  const params = useParams()
  const token = (params?.token as string) || ""

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"expired" | "not_found" | "error" | null>(null)
  const [expiredAgencyName, setExpiredAgencyName] = useState<string | null>(null)
  const [payload, setPayload] = useState<ActivePayload | SubmittedPayload | null>(null)

  const [proposalText, setProposalText] = useState("")
  const [budgetAmount, setBudgetAmount] = useState("")
  const [budgetCurrency, setBudgetCurrency] = useState("USD")
  const [timelineText, setTimelineText] = useState("")
  const [depositPct, setDepositPct] = useState("")
  const [schedulePreference, setSchedulePreference] = useState(SCHEDULE_OPTIONS[0])
  const [paymentNotes, setPaymentNotes] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitResult, setSubmitResult] = useState<{ is_existing_partner: boolean } | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const res = await fetch(`/api/rfp/guest/${token}`, { cache: "no-store" })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.status === 410) {
          setLoadError("expired")
          setExpiredAgencyName(data?.agencyName || null)
          return
        }
        if (res.status === 404) {
          setLoadError("not_found")
          return
        }
        if (!res.ok) {
          setLoadError("error")
          return
        }
        setPayload(data)
      } catch {
        if (!cancelled) setLoadError("error")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const handleFileSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ""
      if (!file) return
      setUploadError(null)
      setUploading(true)
      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("token", token)
        const res = await fetch("/api/rfp/guest/upload", { method: "POST", body: formData })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || "Upload failed")
        setAttachments((prev) => [...prev, { url: data.url, filename: data.filename, size: data.size }])
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed")
      } finally {
        setUploading(false)
      }
    },
    [token]
  )

  const removeAttachment = (url: string) => {
    setAttachments((prev) => prev.filter((a) => a.url !== url))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/rfp/guest/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          proposal_text: proposalText,
          budget_proposal: { amount: Number(budgetAmount), currency: budgetCurrency },
          timeline_proposal: timelineText,
          payment_terms: {
            deposit_pct: depositPct ? Number(depositPct) : null,
            schedule_preference: schedulePreference,
            currency: budgetCurrency,
            notes: paymentNotes,
          },
          attachments: attachments.map((a) => a.url),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to submit bid")
      setSubmitResult({ is_existing_partner: Boolean(data.is_existing_partner) })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit bid")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner className="size-6 text-accent" />
      </div>
    )
  }

  if (loadError === "expired") {
    return (
      <CenteredCard>
        <h1 className="font-display font-black text-2xl text-foreground mb-3">This invitation has expired</h1>
        <p className="text-foreground-muted text-sm">
          Please contact {expiredAgencyName || "the agency"} to request a new link.
        </p>
      </CenteredCard>
    )
  }

  if (loadError || !payload) {
    return (
      <CenteredCard>
        <h1 className="font-display font-black text-2xl text-foreground mb-3">Invitation not found</h1>
        <p className="text-foreground-muted text-sm">This link may be incorrect or no longer active.</p>
      </CenteredCard>
    )
  }

  // Fresh submit confirmation (this session) — includes bridge card.
  if (submitResult && payload.status === "active") {
    const agencyName = agencyDisplayName(payload.agency)
    return (
      <div className="min-h-screen bg-background px-4 py-12">
        <div className="max-w-xl mx-auto space-y-6">
          <div className="text-center">
            <h1 className="font-display font-black text-2xl text-foreground mb-2">
              Your bid has been submitted to {agencyName}
            </h1>
            <p className="text-foreground-muted text-sm">We&apos;ll let you know if there are any updates.</p>
          </div>

          <div className="rounded-2xl border border-border/30 bg-white/5 p-6 space-y-4">
            <div>
              <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Proposal</div>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{proposalText}</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Budget</div>
                <div className="text-sm text-foreground">
                  {budgetAmount ? `${Number(budgetAmount).toLocaleString("en-US")} ${budgetCurrency}` : "—"}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Timeline</div>
                <div className="text-sm text-foreground">{timelineText || "—"}</div>
              </div>
            </div>
            {attachments.length > 0 && (
              <div>
                <div className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Attachments</div>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <AttachmentPill key={a.url} filename={a.filename} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {submitResult.is_existing_partner ? (
            <div className="rounded-2xl border border-border/40 bg-white/5 p-6 text-center space-y-3">
              <p className="text-sm text-foreground">
                Looks like you already have a Ligament account with this email. Sign in to track this bid.
              </p>
              <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
                <a href={`/auth/login?email=${encodeURIComponent(payload.token.vendor_email)}`}>Sign In</a>
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-teal-400/30 bg-teal-400/[0.04] p-6 text-center space-y-3">
              <h2 className="font-display font-bold text-lg text-foreground">
                Track this bid and get discovered by other agencies
              </h2>
              <p className="text-sm text-foreground-muted leading-relaxed">
                Create your Ligament profile to see when your bid is reviewed, receive future RFPs from agencies,
                and make your work visible to the network.
              </p>
              <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
                <a href={`/auth/sign-up?email=${encodeURIComponent(payload.token.vendor_email)}&source=magic_link`}>
                  Set Up My Profile
                </a>
              </Button>
              <div>
                <a href="/" className="text-xs text-foreground-muted hover:text-foreground underline">
                  No thanks, I&apos;ll wait to hear back.
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Already-submitted, read-only (loaded directly from GET on a repeat visit).
  if (payload.status === "submitted") {
    const { response, token: tokenRow } = payload
    const paymentTerms = response.payment_terms
    return (
      <div className="min-h-screen bg-background px-4 py-12">
        <div className="max-w-xl mx-auto space-y-6">
          <div className="text-center">
            <h1 className="font-display font-black text-2xl text-foreground mb-2">
              Your bid was submitted on {formatDateTime(tokenRow.submitted_at) || "—"}
            </h1>
          </div>
          <div className="rounded-2xl border border-border/30 bg-white/5 p-6 space-y-4">
            <div>
              <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Proposal</div>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {response.proposal_text}
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Budget</div>
                <div className="text-sm text-foreground">{formatBudgetForDisplay(response.budget_proposal)}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Timeline</div>
                <div className="text-sm text-foreground">{formatTimelineForDisplay(response.timeline_proposal)}</div>
              </div>
            </div>
            {paymentTerms && (
              <div>
                <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Payment Terms</div>
                <div className="text-sm text-foreground space-y-1">
                  {paymentTerms.deposit_required_pct != null && <p>Deposit: {paymentTerms.deposit_required_pct}%</p>}
                  {paymentTerms.payment_schedule_preference && <p>Schedule: {paymentTerms.payment_schedule_preference}</p>}
                  {paymentTerms.additional_notes && <p>Notes: {paymentTerms.additional_notes}</p>}
                </div>
              </div>
            )}
            {response.attachments && response.attachments.length > 0 && (
              <div>
                <div className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Attachments</div>
                <div className="flex flex-wrap gap-2">
                  {response.attachments.map((a) => (
                    <AttachmentPill key={a.url} filename={a.label} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Active state — brief + response form.
  const { project, scopeItem, agency } = payload
  const dateRange = [formatDateOnly(project.start_date), formatDateOnly(project.end_date)].filter(Boolean).join(" – ")

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-xl mx-auto space-y-8">
        <div>
          <div className="font-display font-black text-2xl tracking-tight text-foreground">LIGAMENT</div>
          <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">
            Powered by Ligament
          </div>
        </div>

        <div className="rounded-2xl border border-border/30 bg-white/5 p-6 space-y-4">
          <div className="font-mono text-[10px] uppercase text-accent tracking-wider">Your Brief</div>
          <div className="flex items-center gap-3">
            {agency.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agency.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center shrink-0 font-display font-bold text-accent">
                {agencyDisplayName(agency).charAt(0).toUpperCase()}
              </div>
            )}
            <div className="font-display font-bold text-foreground">{agencyDisplayName(agency)}</div>
          </div>
          <div>
            <div className="font-display font-bold text-xl text-foreground">{project.name}</div>
            {project.client_name && <div className="text-sm text-foreground-muted">{project.client_name}</div>}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            {project.budget_range && (
              <div>
                <div className="font-mono text-[10px] uppercase text-foreground-muted">Budget</div>
                <div className="text-foreground">{project.budget_range}</div>
              </div>
            )}
            {dateRange && (
              <div>
                <div className="font-mono text-[10px] uppercase text-foreground-muted">Timeline</div>
                <div className="text-foreground">{dateRange}</div>
              </div>
            )}
          </div>
          {project.description && (
            <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{project.description}</p>
          )}
          {scopeItem?.name && (
            <div className="pt-3 border-t border-border/30">
              <div className="font-display font-bold text-sm text-foreground">{scopeItem.name}</div>
              {scopeItem.description && (
                <p className="text-sm text-foreground-muted mt-1 whitespace-pre-wrap">{scopeItem.description}</p>
              )}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-border/30 bg-white/5 p-6 space-y-5">
          <div>
            <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
              Proposal
            </label>
            <Textarea
              rows={6}
              required
              value={proposalText}
              onChange={(e) => setProposalText(e.target.value)}
              placeholder="Describe your approach, relevant experience, and why you're the right fit for this project"
              className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Budget Amount
              </label>
              <Input
                type="number"
                min="0"
                required
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                placeholder="50000"
                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Currency
              </label>
              <Select value={budgetCurrency} onValueChange={setBudgetCurrency}>
                <SelectTrigger className="bg-white/5 border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
              Timeline
            </label>
            <Input
              required
              value={timelineText}
              onChange={(e) => setTimelineText(e.target.value)}
              placeholder="e.g. 6 weeks from kickoff"
              className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
            />
          </div>

          <div className="p-4 rounded-lg border border-border/40 bg-white/5 space-y-4">
            <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Payment Terms</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                  Deposit %
                </label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={depositPct}
                  onChange={(e) => setDepositPct(e.target.value)}
                  placeholder="25"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                  Schedule Preference
                </label>
                <Select value={schedulePreference} onValueChange={setSchedulePreference}>
                  <SelectTrigger className="bg-white/5 border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                Notes
              </label>
              <Textarea
                rows={2}
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
              />
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
              Attachments
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((a) => (
                <AttachmentPill key={a.url} filename={a.filename} onRemove={() => removeAttachment(a.url)} />
              ))}
              <label
                className={cn(
                  "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-dashed border-border/60 font-mono text-xs text-foreground-muted hover:text-foreground hover:border-accent/50 cursor-pointer transition-colors",
                  uploading && "opacity-60 pointer-events-none"
                )}
              >
                {uploading ? <Spinner className="size-3" /> : <Paperclip className="w-3 h-3" />}
                {uploading ? "Uploading…" : "Attach Files"}
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,image/jpeg,image/png"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </label>
            </div>
            {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
          </div>

          {submitError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200">
              {submitError}
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Spinner className="size-4" /> Submitting…
              </span>
            ) : (
              "Submit My Bid"
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
