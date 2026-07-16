"use client"

export const dynamic = "force-dynamic"

import { useCallback, useEffect, useState } from "react"
import type { ChangeEvent, FormEvent } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { formatDateTime, cn } from "@/lib/utils"
import { formatBudgetForDisplay, formatTimelineForDisplay, parseBudgetProposal } from "@/lib/rfp-response-fields"
import type { ReferenceMaterial } from "@/components/reference-materials-input"
import {
  Paperclip, X, ChevronDown, ChevronUp, ExternalLink, Pencil, Download, FileText,
  Link as LinkIcon, Plus,
} from "lucide-react"
import {
  DESIGNATION_KEYS,
  DESIGNATION_LABELS,
  INSURANCE_KEYS,
  INSURANCE_LABELS,
  type BusinessCriteriaHolds,
  type DesignationHolds,
  type DesignationKey,
  type InsuranceHolds,
  type InsuranceKey,
  normalizeBusinessCriteriaRequired,
  withBusinessCriteriaDefaults,
} from "@/lib/business-criteria"

const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "MXN", "BRL", "AED", "SGD"]
const SCHEDULE_OPTIONS = ["Milestone-based", "Net 30", "Net 60", "Net 90", "Upon completion"]

type TokenRow = {
  token: string
  vendor_email: string
  vendor_name: string | null
  status: string
  submitted_at: string | null
  created_at: string
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

type PaymentTerms = {
  deposit_required_pct: number | null
  payment_schedule_preference: string | null
  additional_notes: string | null
} | null

type SubmittedResponse = {
  proposal_text: string
  budget_proposal: string
  timeline_proposal: string
  payment_terms: PaymentTerms
  attachments: { type: string; label: string; url: string }[] | null
  business_criteria_responses?: unknown
  status: string
  agency_feedback?: string | null
  submitted_at?: string | null
}

type BasePayload = {
  token: TokenRow
  project: ProjectData
  scopeItem: ScopeItemData
  agency: AgencyData
  reference_materials?: ReferenceMaterial[]
  business_criteria_required?: unknown
}
type ActivePayload = BasePayload & { status: "active" }
type SubmittedPayload = BasePayload & { status: "submitted"; response: SubmittedResponse }
type GuestPayload = ActivePayload | SubmittedPayload

type Attachment = { type: "file" | "link"; url: string; label: string }

function formatDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function labelFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function agencyDisplayName(agency: AgencyData | null | undefined): string {
  return agency?.company_name?.trim() || agency?.display_name?.trim() || "the agency"
}

/** Collapses the many partner_rfp_responses.status values used across the product into
 *  the five buckets this guest-facing pill is scoped to. */
function guestStatusLabel(hasResponse: boolean, responseStatus: string | null | undefined) {
  if (!hasResponse) return "Not Submitted"
  const s = (responseStatus || "").toLowerCase()
  if (s === "under_review") return "Under Review"
  if (s === "awarded") return "Awarded"
  if (s === "declined") return "Declined"
  return "Submitted"
}

function statusPillClasses(label: string): string {
  switch (label) {
    case "Awarded":
      return "bg-teal-500/15 text-teal-300 border border-teal-500/30"
    case "Under Review":
      return "bg-amber-500/15 text-amber-300 border border-amber-500/30"
    case "Declined":
      return "bg-red-500/15 text-red-300 border border-red-500/30"
    case "Submitted":
      return "bg-accent/15 text-accent border border-accent/30"
    default:
      return "bg-white/10 text-foreground-muted border border-border/40"
  }
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


export default function GuestRfpRespondPage() {
  const params = useParams()
  const token = (params?.token as string) || ""

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"expired" | "not_found" | "error" | null>(null)
  const [expiredAgencyName, setExpiredAgencyName] = useState<string | null>(null)
  const [payload, setPayload] = useState<GuestPayload | null>(null)
  const [activeTab, setActiveTab] = useState<"rfp-details" | "my-bid" | "status">("rfp-details")
  const [isEditingBid, setIsEditingBid] = useState(false)
  const [proposalExpanded, setProposalExpanded] = useState(false)

  const [proposalText, setProposalText] = useState("")
  const [budgetAmount, setBudgetAmount] = useState("")
  const [budgetCurrency, setBudgetCurrency] = useState("USD")
  const [timelineText, setTimelineText] = useState("")
  const [depositPct, setDepositPct] = useState("")
  const [schedulePreference, setSchedulePreference] = useState(SCHEDULE_OPTIONS[0])
  const [paymentNotes, setPaymentNotes] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [businessCriteriaResponses, setBusinessCriteriaResponses] = useState<BusinessCriteriaHolds>(
    withBusinessCriteriaDefaults(null)
  )
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState("")
  const [linkLabel, setLinkLabel] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const loadPayload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/rfp/guest/${token}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
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
      setLoadError("error")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    void loadPayload()
  }, [token, loadPayload])

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
        setAttachments((prev) => [...prev, { type: "file", url: data.url, label: data.filename }])
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed")
      } finally {
        setUploading(false)
      }
    },
    [token]
  )

  const addLinkAttachment = () => {
    const url = linkUrl.trim()
    if (!url) return
    setAttachments((prev) => [...prev, { type: "link", url, label: linkLabel.trim() || labelFromUrl(url) }])
    setLinkUrl("")
    setLinkLabel("")
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const resetForm = () => {
    setProposalText("")
    setBudgetAmount("")
    setBudgetCurrency("USD")
    setTimelineText("")
    setDepositPct("")
    setSchedulePreference(SCHEDULE_OPTIONS[0])
    setPaymentNotes("")
    setAttachments([])
    setBusinessCriteriaResponses(withBusinessCriteriaDefaults(null))
  }

  const startEditingBid = () => {
    if (!payload || payload.status !== "submitted") return
    const { response } = payload
    setProposalText(response.proposal_text || "")
    const parsedBudget = parseBudgetProposal(response.budget_proposal || "")
    setBudgetAmount(parsedBudget.amount)
    setBudgetCurrency(CURRENCY_OPTIONS.includes(parsedBudget.currency) ? parsedBudget.currency : "USD")
    setTimelineText(response.timeline_proposal || "")
    setDepositPct(
      response.payment_terms?.deposit_required_pct != null ? String(response.payment_terms.deposit_required_pct) : ""
    )
    setSchedulePreference(response.payment_terms?.payment_schedule_preference || SCHEDULE_OPTIONS[0])
    setPaymentNotes(response.payment_terms?.additional_notes || "")
    setAttachments(
      (response.attachments || []).map((a) => ({
        type: a.type === "link" ? "link" : "file",
        url: a.url,
        label: a.label,
      }))
    )
    setBusinessCriteriaResponses(withBusinessCriteriaDefaults(response.business_criteria_responses))
    setSubmitError(null)
    setIsEditingBid(true)
  }

  const updateBusinessCriteriaDesignation = (key: DesignationKey, patch: Partial<DesignationHolds>) => {
    setBusinessCriteriaResponses((prev) => ({
      ...prev,
      designations: { ...prev.designations, [key]: { ...prev.designations[key], ...patch } },
    }))
  }

  const updateBusinessCriteriaInsurance = (key: InsuranceKey, patch: Partial<InsuranceHolds>) => {
    setBusinessCriteriaResponses((prev) => ({
      ...prev,
      insurance: { ...prev.insurance, [key]: { ...prev.insurance[key], ...patch } },
    }))
  }

  const updateBusinessCriteriaCoi = (coi_on_file: boolean) => {
    setBusinessCriteriaResponses((prev) => ({
      ...prev,
      insurance: { ...prev.insurance, coi_on_file },
    }))
  }

  const cancelEditingBid = () => {
    setIsEditingBid(false)
    resetForm()
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    setSubmitting(true)
    const wasEditing = isEditingBid
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
          attachments: attachments.map((a) => ({ type: a.type, label: a.label, url: a.url })),
          business_criteria_responses: businessCriteriaResponses,
          ...(wasEditing ? { is_edit: true } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to submit bid")
      await loadPayload()
      setIsEditingBid(false)
      setProposalExpanded(false)
      setActiveTab(wasEditing ? "my-bid" : "status")
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

  const { project, scopeItem, agency, token: tokenRow, reference_materials: referenceMaterials = [] } = payload
  const hasSubmittedBid = payload.status === "submitted"
  const response = hasSubmittedBid ? payload.response : null
  const showForm = !hasSubmittedBid || isEditingBid
  const dateRange = [formatDateOnly(project.start_date), formatDateOnly(project.end_date)].filter(Boolean).join(" – ")
  const statusLabel = guestStatusLabel(hasSubmittedBid, response?.status)
  const requiredCriteria = normalizeBusinessCriteriaRequired(payload.business_criteria_required)
  const requiredDesignationKeysForBid = DESIGNATION_KEYS.filter((key) => requiredCriteria.designations[key] === true)
  const requiredInsuranceKeysForBid = INSURANCE_KEYS.filter((key) => requiredCriteria.insurance[key]?.required === true)
  const hasRequiredCriteriaForBid =
    requiredDesignationKeysForBid.length > 0 || requiredInsuranceKeysForBid.length > 0 || requiredCriteria.insurance.coi_on_file

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <div className="font-display font-black text-2xl tracking-tight text-foreground">LIGAMENT</div>
          <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">
            Powered by Ligament
          </div>
        </div>

        {/* Persistent guest banner */}
        <div className="rounded-2xl border border-teal-400/30 bg-teal-400/[0.06] p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-foreground/90 leading-relaxed max-w-md">
            You&apos;re viewing as a guest. Create a profile to track all your bids and get discovered by agencies.
          </p>
          <Button
            asChild
            variant="outline"
            className="border-teal-400/40 text-teal-200 hover:bg-teal-400/10 shrink-0"
          >
            <a
              href={`/auth/sign-up?email=${encodeURIComponent(tokenRow.vendor_email)}&source=magic_link`}
            >
              Create Profile
            </a>
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="w-full grid grid-cols-3 bg-white/5 border border-border/30 rounded-xl p-1 h-auto">
            <TabsTrigger
              value="rfp-details"
              className="rounded-lg py-2 text-xs font-mono data-[state=active]:bg-accent data-[state=active]:text-accent-foreground text-foreground-muted"
            >
              RFP Details
            </TabsTrigger>
            <TabsTrigger
              value="my-bid"
              className="rounded-lg py-2 text-xs font-mono data-[state=active]:bg-accent data-[state=active]:text-accent-foreground text-foreground-muted"
            >
              My Bid
            </TabsTrigger>
            <TabsTrigger
              value="status"
              className="rounded-lg py-2 text-xs font-mono data-[state=active]:bg-accent data-[state=active]:text-accent-foreground text-foreground-muted"
            >
              Status &amp; Feedback
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: RFP Details */}
          <TabsContent value="rfp-details">
            <div className="rounded-2xl border border-border/30 bg-white/5 p-6 space-y-4">
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
              {referenceMaterials.length > 0 && (
                <div className="pt-3 border-t border-border/30 space-y-2">
                  <div className="font-mono text-[10px] uppercase text-foreground-muted tracking-wider">
                    Reference Materials
                  </div>
                  {referenceMaterials.map((material, i) => (
                    <a
                      key={`${material.url}-${i}`}
                      href={material.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-white/5 hover:border-accent/40 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-foreground truncate">{material.label}</div>
                      </div>
                      {material.type === "link" ? (
                        <ExternalLink className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                      ) : (
                        <Download className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                      )}
                    </a>
                  ))}
                </div>
              )}
              {scopeItem?.name && (
                <div className="pt-3 border-t border-border/30">
                  <div className="font-display font-bold text-sm text-foreground">{scopeItem.name}</div>
                  {scopeItem.description && (
                    <p className="text-sm text-foreground-muted mt-1 whitespace-pre-wrap">{scopeItem.description}</p>
                  )}
                </div>
              )}
              {hasRequiredCriteriaForBid && (
                <div className="pt-3 border-t border-border/30">
                  <div className="font-display font-bold text-sm text-foreground mb-2">Business Criteria Required</div>
                  {requiredDesignationKeysForBid.length > 0 && (
                    <ul className="list-disc list-inside space-y-1 text-sm text-foreground-muted">
                      {requiredDesignationKeysForBid.map((key) => (
                        <li key={key}>{DESIGNATION_LABELS[key]}</li>
                      ))}
                    </ul>
                  )}
                  {requiredInsuranceKeysForBid.length > 0 && (
                    <ul className="list-disc list-inside space-y-1 text-sm text-foreground-muted mt-1">
                      {requiredInsuranceKeysForBid.map((key) => {
                        const minimum = requiredCriteria.insurance[key]?.minimum
                        return (
                          <li key={key}>
                            {INSURANCE_LABELS[key]}
                            {minimum ? ` (minimum ${minimum})` : ""}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {requiredCriteria.insurance.coi_on_file && (
                    <p className="text-sm text-foreground-muted mt-1">Certificate of Insurance (COI) on file</p>
                  )}
                  {requiredCriteria.notes.trim() && (
                    <p className="text-sm text-foreground-muted mt-2 whitespace-pre-wrap">{requiredCriteria.notes}</p>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB 2: My Bid */}
          <TabsContent value="my-bid">
            {showForm ? (
              <form onSubmit={handleSubmit} className="rounded-2xl border border-border/30 bg-white/5 p-6 space-y-5">
                {isEditingBid && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-accent/5 border border-accent/20">
                    <span className="font-mono text-[10px] text-accent uppercase tracking-wider">Editing your bid</span>
                    <button
                      type="button"
                      onClick={cancelEditingBid}
                      className="font-mono text-[10px] text-foreground-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                )}
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

                {hasRequiredCriteriaForBid && (
                  <div className="p-4 rounded-lg border border-border/40 bg-white/5 space-y-4">
                    <div>
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                        Business Criteria
                      </div>
                      <p className="text-xs text-foreground-muted mt-1">
                        This RFP requires confirmation of the following. Confirm what applies to your company.
                      </p>
                      {requiredCriteria.notes.trim() && (
                        <p className="text-xs text-foreground-muted mt-1 whitespace-pre-wrap">{requiredCriteria.notes}</p>
                      )}
                    </div>

                    {requiredDesignationKeysForBid.length > 0 && (
                      <div className="space-y-3">
                        {requiredDesignationKeysForBid.map((key) => {
                          const designation = businessCriteriaResponses.designations[key]
                          return (
                            <div key={key} className="rounded-lg border border-border/40 bg-white/[0.02] p-3">
                              <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={designation.holds}
                                  onChange={(e) => updateBusinessCriteriaDesignation(key, { holds: e.target.checked })}
                                  className="mt-0.5 w-4 h-4 rounded border-foreground-muted"
                                />
                                <span className="font-display font-bold text-sm text-foreground">
                                  {DESIGNATION_LABELS[key]}
                                </span>
                              </label>
                              {designation.holds && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pl-7">
                                  <Input
                                    value={designation.certifying_body || ""}
                                    onChange={(e) =>
                                      updateBusinessCriteriaDesignation(key, {
                                        certifying_body: e.target.value || null,
                                      })
                                    }
                                    placeholder="Certifying body (e.g. NMSDC, WBENC)"
                                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                                    disabled={designation.self_certified}
                                  />
                                  <Input
                                    value={designation.certification_number || ""}
                                    onChange={(e) =>
                                      updateBusinessCriteriaDesignation(key, {
                                        certification_number: e.target.value || null,
                                      })
                                    }
                                    placeholder="Certification number"
                                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                                    disabled={designation.self_certified}
                                  />
                                  <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={designation.self_certified}
                                      onChange={(e) =>
                                        updateBusinessCriteriaDesignation(key, {
                                          self_certified: e.target.checked,
                                          ...(e.target.checked
                                            ? { certifying_body: null, certification_number: null }
                                            : {}),
                                        })
                                      }
                                      className="w-4 h-4 rounded border-foreground-muted"
                                    />
                                    <span className="text-sm text-foreground-muted">
                                      Self-certified (no third-party certification)
                                    </span>
                                  </label>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {requiredInsuranceKeysForBid.length > 0 && (
                      <div className="space-y-3">
                        {requiredInsuranceKeysForBid.map((key) => {
                          const coverage = businessCriteriaResponses.insurance[key]
                          const minimum = requiredCriteria.insurance[key]?.minimum
                          return (
                            <div
                              key={key}
                              className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border/40 bg-white/[0.02]"
                            >
                              <label className="flex items-center gap-3 min-w-0 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={coverage.has_coverage}
                                  onChange={(e) =>
                                    updateBusinessCriteriaInsurance(key, { has_coverage: e.target.checked })
                                  }
                                  className="w-4 h-4 rounded border-foreground-muted"
                                />
                                <span className="font-display font-bold text-sm text-foreground truncate">
                                  {INSURANCE_LABELS[key]}
                                  {minimum ? ` (min. ${minimum})` : ""}
                                </span>
                              </label>
                              <Input
                                value={coverage.limit || ""}
                                onChange={(e) =>
                                  updateBusinessCriteriaInsurance(key, { limit: e.target.value || null })
                                }
                                placeholder="Your limit, e.g. $1M/$2M"
                                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 w-44 shrink-0"
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {requiredCriteria.insurance.coi_on_file && (
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={businessCriteriaResponses.insurance.coi_on_file}
                          onChange={(e) => updateBusinessCriteriaCoi(e.target.checked)}
                          className="w-4 h-4 rounded border-foreground-muted"
                        />
                        <span className="text-sm text-foreground-muted">
                          Certificate of Insurance (COI) on file
                        </span>
                      </label>
                    )}
                  </div>
                )}

                <div>
                  <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Attachments
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1 flex gap-2">
                      <Input
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            addLinkAttachment()
                          }
                        }}
                        placeholder="https://..."
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                      <Input
                        value={linkLabel}
                        onChange={(e) => setLinkLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            addLinkAttachment()
                          }
                        }}
                        placeholder="Label (optional)"
                        className="w-32 shrink-0 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!linkUrl.trim()}
                        onClick={addLinkAttachment}
                        className="border-border text-foreground-muted hover:bg-white/5 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Add Link
                      </Button>
                    </div>

                    <label
                      className={cn(
                        "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border/60 font-mono text-xs text-foreground-muted hover:text-foreground hover:border-accent/50 cursor-pointer transition-colors shrink-0",
                        uploading && "opacity-60 pointer-events-none"
                      )}
                    >
                      {uploading ? <Spinner className="size-3.5" /> : <Paperclip className="w-3.5 h-3.5" />}
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

                  {attachments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {attachments.map((a, i) => (
                        <div
                          key={`${a.url}-${i}`}
                          className="flex items-center gap-3 p-2.5 rounded-lg border border-border/40 bg-white/5"
                        >
                          <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                            {a.type === "link" ? (
                              <LinkIcon className="w-3.5 h-3.5 text-accent" />
                            ) : (
                              <Paperclip className="w-3.5 h-3.5 text-accent" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-foreground truncate">{a.label}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeAttachment(i)}
                            className="text-foreground-muted hover:text-red-400 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
                      <Spinner className="size-4" /> {isEditingBid ? "Saving…" : "Submitting…"}
                    </span>
                  ) : isEditingBid ? (
                    "Save Changes"
                  ) : (
                    "Submit My Bid"
                  )}
                </Button>
              </form>
            ) : (
              response && (
                <div className="rounded-2xl border border-border/30 bg-white/5 p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[10px] uppercase text-accent tracking-wider">
                      Submitted {formatDateTime(response.submitted_at) || formatDateTime(tokenRow.submitted_at) || ""}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Proposal</div>
                    <p
                      className={cn(
                        "text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed",
                        !proposalExpanded && "line-clamp-5"
                      )}
                    >
                      {response.proposal_text}
                    </p>
                    {response.proposal_text.split("\n").length > 5 || response.proposal_text.length > 400 ? (
                      <button
                        type="button"
                        onClick={() => setProposalExpanded((v) => !v)}
                        className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-accent hover:underline"
                      >
                        {proposalExpanded ? (
                          <>
                            Show less <ChevronUp className="w-3 h-3" />
                          </>
                        ) : (
                          <>
                            Show more <ChevronDown className="w-3 h-3" />
                          </>
                        )}
                      </button>
                    ) : null}
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
                  {response.payment_terms && (
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted mb-1">Payment Terms</div>
                      <div className="text-sm text-foreground space-y-1">
                        {response.payment_terms.deposit_required_pct != null && (
                          <p>Deposit: {response.payment_terms.deposit_required_pct}%</p>
                        )}
                        {response.payment_terms.payment_schedule_preference && (
                          <p>Schedule: {response.payment_terms.payment_schedule_preference}</p>
                        )}
                        {response.payment_terms.additional_notes && <p>Notes: {response.payment_terms.additional_notes}</p>}
                      </div>
                    </div>
                  )}
                  {response.attachments && response.attachments.length > 0 && (
                    <div>
                      <div className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Attachments</div>
                      <ul className="space-y-1.5">
                        {response.attachments.map((a, i) => (
                          <li key={`${a.url}-${i}`}>
                            <a
                              href={a.url}
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
                  <div className="pt-2 border-t border-border/30">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={startEditingBid}
                      className="border-border text-foreground hover:bg-white/5 flex items-center gap-2"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit Bid
                    </Button>
                  </div>
                </div>
              )
            )}
          </TabsContent>

          {/* TAB 3: Status & Feedback */}
          <TabsContent value="status">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/30 bg-white/5 p-6 text-center">
                <div className="font-mono text-[10px] uppercase text-foreground-muted mb-3">Current Status</div>
                <span
                  className={cn(
                    "inline-flex items-center px-4 py-1.5 rounded-full font-display font-bold text-sm",
                    statusPillClasses(statusLabel)
                  )}
                >
                  {statusLabel}
                </span>
              </div>

              {response?.agency_feedback && (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.05] p-5">
                  <div className="font-mono text-[10px] uppercase text-amber-300 tracking-wider mb-2">
                    Agency Feedback
                  </div>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {response.agency_feedback}
                  </p>
                </div>
              )}

              <div className="rounded-2xl border border-border/30 bg-white/5 p-5">
                <div className="font-mono text-[10px] uppercase text-foreground-muted tracking-wider mb-3">Timeline</div>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                    <span className="text-sm text-foreground">Invitation sent</span>
                    <span className="font-mono text-[10px] text-foreground-muted ml-auto">
                      {formatDateTime(tokenRow.created_at) || "—"}
                    </span>
                  </li>
                  {hasSubmittedBid && (
                    <li className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-teal-400 shrink-0" />
                      <span className="text-sm text-foreground">Bid submitted</span>
                      <span className="font-mono text-[10px] text-foreground-muted ml-auto">
                        {formatDateTime(response?.submitted_at || tokenRow.submitted_at) || "—"}
                      </span>
                    </li>
                  )}
                </ul>
              </div>

              {!hasSubmittedBid && (
                <div className="rounded-2xl border border-border/30 bg-white/5 p-6 text-center space-y-3">
                  <p className="text-sm text-foreground-muted">You haven&apos;t submitted a bid yet.</p>
                  <Button
                    type="button"
                    onClick={() => setActiveTab("my-bid")}
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    Go to My Bid
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
