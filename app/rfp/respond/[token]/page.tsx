"use client"

export const dynamic = "force-dynamic"

import { useCallback, useEffect, useState } from "react"
import type { ChangeEvent, FormEvent } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Spinner } from "@/components/ui/spinner"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { formatSubmittedAt, cn } from "@/lib/utils"
import { buildBidTimeline } from "@/lib/bid-timeline"
import { getDeadlineUrgency } from "@/lib/deadline-urgency"
import { isVercelBlobStorageUrl, parseGuestUploadBlobPathFromUrl } from "@/lib/vercel-blob-url"
import { formatBudgetForDisplay, formatTimelineForDisplay, parseBudgetProposal, currencySymbolFor, BUDGET_CURRENCY_OPTIONS } from "@/lib/rfp-response-fields"
import { CurrencyInput } from "@/components/ui/currency-input"
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
  type BusinessCriteriaAcknowledgments,
  normalizeBusinessCriteriaRequired,
  withBusinessCriteriaDefaults,
  hasExplicitPriorityData,
  normalizeAcknowledgments,
  emptyAcknowledgments,
  getDesignationPriority,
  getInsurancePriority,
  getCoiPriority,
  computeRequirementCompliance,
} from "@/lib/business-criteria"
import { BusinessCriteriaRequirementBlock } from "@/components/business-criteria-requirement-block"
import { BidFormCollapsibleSection } from "@/components/bid-form-collapsible-section"
import { BidBudgetCategories } from "@/components/bid-budget-categories"
import { BidProposalSectionsEditor } from "@/components/bid-proposal-sections"
import { isBiddingClosed, BIDDING_CLOSED_VENDOR_MESSAGE, BIDDING_CLOSED_BADGE } from "@/lib/bid-close"
import {
  buildProposalSectionsForSave,
  normalizeProposalSections,
  type ProposalSections,
} from "@/lib/proposal-sections"
import {
  buildBudgetLinesForSave,
  categoriesSummaryLabel,
  countCategoryCompleteness,
  draftEnteredKeys,
  draftGrandTotal,
  emptyBudgetDraft,
  normalizeBudgetCategories,
  normalizeBudgetLines,
  seedBudgetDraft,
  type BudgetDraft,
} from "@/lib/budget-categories"
import {
  getTermsReadiness,
  getCriteriaSummaryLabel,
  getAttachmentsSummaryLabel,
  computeReadinessLabel,
} from "@/lib/bid-form-readiness"
import {
  emptyTermsDisclosure,
  withTermsDisclosureDefaults,
  validateTermsDisclosure,
  mergeLegacyPaymentTermsIntoDisclosure,
  formatTermsDisclosureSummary,
  type TermsDisclosure,
  type TermsDisclosureValidationError,
} from "@/lib/terms-disclosure"
import { TermsDisclosureSection } from "@/components/terms-disclosure-section"
import { HelpTerm } from "@/components/help-term"

// One source for the option list, shared with the portal bid form
// (app/partner/rfps/[id]/page.tsx). The guest list previously omitted "Other", so a vendor
// billing in a currency outside the top ten could submit here but not in the portal.
const CURRENCY_OPTIONS = BUDGET_CURRENCY_OPTIONS

type TokenRow = {
  token: string
  /** P2-1/P2-4. The guest GET selects * on rfp_magic_tokens, so these arrive automatically
   *  once migrations 072/076 are applied, and are simply undefined before them. */
  budget_categories?: unknown
  close_bidding_at_deadline?: boolean | null
  vendor_email: string
  vendor_name: string | null
  status: string
  submitted_at: string | null
  created_at: string
  require_terms_disclosure?: boolean
  /** F2: absent on tokens minted before migration 074 applies - always null-safe. */
  response_deadline?: string | null
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

type AgencyData = { company_name: string | null; display_name: string | null; company_logo_url: string | null }
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
  terms_disclosure?: unknown
  attachments: { type: string; label: string; url: string }[] | null
  business_criteria_responses?: unknown
  /** Absent on rows written before migration 071 - always read through normalizeAcknowledgments. */
  business_criteria_acknowledgments?: unknown
  /** P2-1. Absent before migration 072 and on every bid to an RFP without categories. */
  budget_lines?: unknown
  /** P2-2. Absent before migration 076 and on every prose-only bid. */
  proposal_sections?: unknown
  status: string
  agency_feedback?: string | null
  feedback_updated_at?: string | null
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
type SubmittedPayload = BasePayload & { status: "submitted"; response: SubmittedResponse; is_existing_partner?: boolean }
type GuestPayload = ActivePayload | SubmittedPayload

type Attachment = { type: "file" | "link"; url: string; label: string }

function formatDateOnly(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** F1 preflight line: sentence-case, no em dash, Oxford comma for 3+ items. */
function joinWithOxfordComma(parts: string[]): string {
  if (parts.length === 0) return ""
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`
}

function labelFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** Guest RFP bid uploads are stored as private blobs - route them through the
 *  token-validated guest file proxy instead of linking the raw blob URL directly. */
function guestAttachmentHref(token: string, url: string): string {
  if (isVercelBlobStorageUrl(url) && parseGuestUploadBlobPathFromUrl(url)) {
    return `/api/rfp/guest/file?token=${encodeURIComponent(token)}&url=${encodeURIComponent(url)}`
  }
  return url
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
      <div className="w-full max-w-md relative z-10">
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-lg p-8 text-center">
          {children}
        </div>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/terms"
            className="text-2xs text-foreground/80 hover:text-foreground transition-colors"
          >
            Terms of Service
          </Link>
          <span className="text-foreground-muted/30">|</span>
          <Link
            href="/privacy"
            className="text-2xs text-foreground/80 hover:text-foreground transition-colors"
          >
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  )
}


export default function GuestRfpRespondPage() {
  const params = useParams()
  const router = useRouter()
  const token = (params?.token as string) || ""

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<"expired" | "not_found" | "error" | null>(null)
  const [expiredAgencyName, setExpiredAgencyName] = useState<string | null>(null)
  const [payload, setPayload] = useState<GuestPayload | null>(null)

  /** G1: whether a logged-in session's account email matches this invite's target email.
   *  "checking"/"redirecting" hold off rendering the guest view so a matching account never
   *  flashes it before landing on the portal RFP; "mismatch" blocks it with an interstitial
   *  that can never silently claim into the wrong account; "guest" is every other case
   *  (no session, or the vendor explicitly chose to continue viewing as a guest anyway). */
  const [accountState, setAccountState] = useState<"checking" | "redirecting" | "mismatch" | "guest">("checking")
  const [currentAccountLabel, setCurrentAccountLabel] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"rfp-details" | "my-bid" | "status">("rfp-details")
  const [isEditingBid, setIsEditingBid] = useState(false)
  const [proposalExpanded, setProposalExpanded] = useState(false)
  const [agencyLogoLoadError, setAgencyLogoLoadError] = useState(false)

  const [proposalText, setProposalText] = useState("")
  const [budgetAmount, setBudgetAmount] = useState("")
  const [budgetDraft, setBudgetDraft] = useState<BudgetDraft>({})
  const [proposalSections, setProposalSections] = useState<ProposalSections>({})
  const [budgetCurrency, setBudgetCurrency] = useState("USD")
  const [budgetCurrencyOther, setBudgetCurrencyOther] = useState("")
  const [timelineText, setTimelineText] = useState("")
  const [termsDisclosure, setTermsDisclosure] = useState<TermsDisclosure>(emptyTermsDisclosure())
  const [termsErrors, setTermsErrors] = useState<TermsDisclosureValidationError[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [businessCriteriaResponses, setBusinessCriteriaResponses] = useState<BusinessCriteriaHolds>(
    withBusinessCriteriaDefaults(null)
  )
  const [businessCriteriaAcknowledgments, setBusinessCriteriaAcknowledgments] =
    useState<BusinessCriteriaAcknowledgments>(emptyAcknowledgments())
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState("")
  const [linkLabel, setLinkLabel] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  /** F1: controlled open/closed state for the four collapsible bid-form sections - no
   *  persistence, every page load defaults everything open. No autosave on this page (guest
   *  submissions have no draft/status concept - see final report Open Questions). */
  const [openSections, setOpenSections] = useState<Record<"bidResponse" | "attachments" | "terms" | "criteria", boolean>>({
    bidResponse: true,
    attachments: true,
    terms: true,
    criteria: true,
  })
  const toggleSection = useCallback((key: "bidResponse" | "attachments" | "terms" | "criteria") => {
    setOpenSections((s) => ({ ...s, [key]: !s[key] }))
  }, [])

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

  /** G1: once the invite has loaded, check whether the browser is logged into an account -
   *  and if so, whether that account's email matches the invite's target email. A match
   *  attaches (idempotent - see lib/magic-token-attach.ts) and redirects into the portal RFP;
   *  a mismatch shows the interstitial; no session leaves this as a normal guest view. */
  useEffect(() => {
    if (!payload || accountState !== "checking") return
    let cancelled = false
    ;(async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client")
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          if (!cancelled) setAccountState("guest")
          return
        }
        const { data: profile } = await supabase
          .from("profiles")
          .select("email, company_name, full_name, display_name")
          .eq("id", user.id)
          .maybeSingle()
        const accountEmail = (profile?.email || user.email || "").trim().toLowerCase()
        const inviteEmail = (payload.token.vendor_email || "").trim().toLowerCase()
        if (!accountEmail || !inviteEmail || accountEmail !== inviteEmail) {
          if (!cancelled) {
            setCurrentAccountLabel(
              profile?.company_name?.trim() ||
                profile?.full_name?.trim() ||
                profile?.display_name?.trim() ||
                accountEmail ||
                "your account"
            )
            setAccountState("mismatch")
          }
          return
        }
        if (!cancelled) setAccountState("redirecting")
        const res = await fetch(`/api/rfp/guest/${token}/attach-existing-account`, { method: "POST" })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data?.inboxId) {
          router.push(`/partner/rfps/${data.inboxId}`)
        } else if (!cancelled) {
          // Attach failed server-side - fail safe to the normal guest view rather than a
          // dead end on a blank "redirecting" screen.
          setAccountState("guest")
        }
      } catch {
        if (!cancelled) setAccountState("guest")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [payload, accountState, token, router])

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
    setBudgetCurrencyOther("")
    setTimelineText("")
    setTermsDisclosure(emptyTermsDisclosure())
    setTermsErrors([])
    setAttachments([])
    setBusinessCriteriaResponses(withBusinessCriteriaDefaults(null))
    setBusinessCriteriaAcknowledgments(emptyAcknowledgments())
  }

  const startEditingBid = () => {
    if (!payload || payload.status !== "submitted") return
    const { response } = payload
    setProposalText(response.proposal_text || "")
    const parsedBudget = parseBudgetProposal(response.budget_proposal || "")
    setBudgetAmount(parsedBudget.amount)
    setBudgetCurrency(CURRENCY_OPTIONS.includes(parsedBudget.currency as (typeof CURRENCY_OPTIONS)[number]) ? parsedBudget.currency : "USD")
    setBudgetCurrencyOther(parsedBudget.customOther)
    setTimelineText(response.timeline_proposal || "")
    setTermsDisclosure(
      response.terms_disclosure
        ? withTermsDisclosureDefaults(response.terms_disclosure)
        : mergeLegacyPaymentTermsIntoDisclosure(emptyTermsDisclosure(), response.payment_terms)
    )
    setTermsErrors([])
    setAttachments(
      (response.attachments || []).map((a) => ({
        type: a.type === "link" ? "link" : "file",
        url: a.url,
        label: a.label,
      }))
    )
    setBusinessCriteriaResponses(withBusinessCriteriaDefaults(response.business_criteria_responses))
    setProposalSections(normalizeProposalSections(response.proposal_sections))
    setBudgetDraft(
      seedBudgetDraft(
        normalizeBudgetCategories((payload.token as TokenRow | undefined)?.budget_categories),
        normalizeBudgetLines(response.budget_lines)
      )
    )
    setBusinessCriteriaAcknowledgments(normalizeAcknowledgments(response.business_criteria_acknowledgments))
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

  const setBusinessCriteriaAcknowledgment = (
    kind: "designation" | "insurance" | "coi",
    key: string | null,
    reason: string | null
  ) => {
    setBusinessCriteriaAcknowledgments((prev) => {
      const next: BusinessCriteriaAcknowledgments = {
        designations: { ...prev.designations },
        insurance: { ...prev.insurance },
        coi: prev.coi,
      }
      if (kind === "coi") {
        next.coi = reason == null ? undefined : { status: "cannot_meet", reason }
      } else if (kind === "designation" && key) {
        const d = next.designations as Record<string, { status: "cannot_meet"; reason: string }>
        if (reason == null) delete d[key]
        else d[key] = { status: "cannot_meet", reason }
      } else if (kind === "insurance" && key) {
        const i = next.insurance as Record<string, { status: "cannot_meet"; reason: string }>
        if (reason == null) delete i[key]
        else i[key] = { status: "cannot_meet", reason }
      }
      return next
    })
  }

  const confirmAllRequiredCriteria = () => {
    if (!payload) return
    const req = normalizeBusinessCriteriaRequired(payload.business_criteria_required)
    setBusinessCriteriaResponses((prev) => {
      const designations = { ...prev.designations }
      for (const key of DESIGNATION_KEYS) {
        if (req.designations[key] === true && getDesignationPriority(req, key) === "required") {
          designations[key] = { ...designations[key], holds: true }
        }
      }
      const insurance = { ...prev.insurance }
      for (const key of INSURANCE_KEYS) {
        if (req.insurance[key]?.required === true && getInsurancePriority(req, key) === "required") {
          insurance[key] = { ...insurance[key], has_coverage: true }
        }
      }
      if (req.insurance.coi_on_file === true && getCoiPriority(req) === "required") {
        insurance.coi_on_file = true
      }
      return { ...prev, designations, insurance }
    })
    setBusinessCriteriaAcknowledgments(emptyAcknowledgments())
    setProposalSections({})
    setBudgetDraft(emptyBudgetDraft(normalizeBudgetCategories(payload?.token?.budget_categories)))
  }

  const cancelEditingBid = () => {
    setIsEditingBid(false)
    resetForm()
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    // F1: the "Your bid response" section can now be collapsed, which removes its native
    // `required` inputs from the DOM entirely - so the browser's own required-field gate no
    // longer reliably blocks an incomplete submit the way it used to when these fields were
    // always mounted. This JS-level check restores that guarantee and gives the auto-expand
    // behavior something to hook into, matching the portal page's validation-driven approach.
    // P2-1: with categories defined, the single budget amount is derived from them, so
    // completeness is the real gate. An honest 0 in a category is a complete answer.
    if (
      isBiddingClosed({
        close_bidding_at_deadline: payload?.token?.close_bidding_at_deadline,
        response_deadline: payload?.token?.response_deadline,
      })
    ) {
      setSubmitError(BIDDING_CLOSED_VENDOR_MESSAGE)
      return
    }
    const submitCategories = normalizeBudgetCategories(payload?.token?.budget_categories)
    const submitHasCategories = submitCategories.length > 0
    const submitCategoryTotal = draftGrandTotal(submitCategories, budgetDraft)
    const submitCategoryOpen = countCategoryCompleteness(submitCategories, draftEnteredKeys(budgetDraft)).open
    if (!proposalText.trim() || !timelineText.trim() || (!submitHasCategories && !budgetAmount)) {
      setOpenSections((s) => ({ ...s, bidResponse: true }))
      setSubmitError("Complete your proposal, budget, and timeline before submitting.")
      return
    }
    // "Other" without a written currency stores nothing usable - serializeBudget drops the
    // custom value and the agency sees an amount with no currency at all.
    if (budgetCurrency === "Other" && !budgetCurrencyOther.trim()) {
      setOpenSections((s) => ({ ...s, bidResponse: true }))
      setSubmitError("You picked Other for currency. Specify which currency or region you bill in.")
      return
    }
    if (submitHasCategories && submitCategoryOpen > 0) {
      setOpenSections((s) => ({ ...s, bidResponse: true }))
      setSubmitError(
        `${submitCategoryOpen} budget categor${submitCategoryOpen === 1 ? "y" : "ies"} still need a number. Enter 0 for anything that genuinely costs nothing.`
      )
      return
    }
    if (submitHasCategories && submitCategoryTotal <= 0) {
      setOpenSections((s) => ({ ...s, bidResponse: true }))
      setSubmitError("Your category subtotals add up to nothing. At least one category needs a real amount.")
      return
    }
    // Guest submissions are always final (no draft concept here), so this always enforces
    // the RFP's requirement when set.
    const termsRequired = payload?.token.require_terms_disclosure === true
    const termsValidation = validateTermsDisclosure(termsDisclosure, termsRequired)
    if (!termsValidation.ok) {
      setTermsErrors(termsValidation.errors)
      setOpenSections((s) => ({ ...s, terms: true }))
      setSubmitError("Please complete the required term disclosures before submitting.")
      return
    }
    setTermsErrors([])
    setSubmitting(true)
    const wasEditing = isEditingBid
    const hasAcknowledgments =
      Object.keys(businessCriteriaAcknowledgments.designations || {}).length > 0 ||
      Object.keys(businessCriteriaAcknowledgments.insurance || {}).length > 0 ||
      businessCriteriaAcknowledgments.coi != null
    try {
      const res = await fetch(`/api/rfp/guest/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          proposal_text: proposalText,
          // One source per number: with categories the total IS their sum, never a second
          // editable figure that could disagree with the breakdown.
          budget_proposal: {
            amount: submitHasCategories ? submitCategoryTotal : Number(budgetAmount),
            currency: budgetCurrency,
            // Only meaningful when currency is "Other"; the server ignores it otherwise.
            custom: budgetCurrency === "Other" ? budgetCurrencyOther.trim() : "",
          },
          timeline_proposal: timelineText,
          terms_disclosure: termsValidation.value,
          attachments: attachments.map((a) => ({ type: a.type, label: a.label, url: a.url })),
          business_criteria_responses: businessCriteriaResponses,
          // Write guard (P2-1): only sent when this RFP uses categories and the vendor answered
          // at least one, so requests shaped like today's never carry this key.
          ...(() => {
            const lines = buildBudgetLinesForSave(submitCategories, budgetDraft, budgetCurrency)
            return lines ? { budget_lines: lines } : {}
          })(),
          // Write guard (P2-2): only sent when the vendor actually wrote a guided section.
          ...(() => {
            const sections = buildProposalSectionsForSave(proposalSections)
            return sections ? { proposal_sections: sections } : {}
          })(),
          // Write guard (S4-1): only sent when the vendor actually recorded a cannot-meet
          // reason, so requests shaped like today's never carry this key.
          ...(hasAcknowledgments ? { business_criteria_acknowledgments: businessCriteriaAcknowledgments } : {}),
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

  if (loadError === "not_found") {
    return (
      <CenteredCard>
        <h1 className="font-display font-black text-2xl text-foreground mb-3">Invitation not found</h1>
        <p className="text-foreground-muted text-sm">
          This link is no longer valid. Check your inbox for a newer invitation email from the agency, or contact
          them for a fresh link.
        </p>
      </CenteredCard>
    )
  }

  if (loadError || !payload) {
    return (
      <CenteredCard>
        <h1 className="font-display font-black text-2xl text-foreground mb-3">Something went wrong</h1>
        <p className="text-foreground-muted text-sm">
          We could not load this invitation. Try refreshing the page, or contact the agency if the problem
          continues.
        </p>
      </CenteredCard>
    )
  }

  // G1: hold off on the guest view while the account-match check (and, on a match, the
  // attach + redirect) is in flight - a matching account should never see a flash of the
  // guest form before landing on its portal RFP.
  if (accountState === "checking" || accountState === "redirecting") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner className="size-6 text-accent" />
      </div>
    )
  }

  if (accountState === "mismatch") {
    return (
      <CenteredCard>
        <h1 className="font-display font-black text-2xl text-foreground mb-3">Sent to a different account</h1>
        <p className="text-foreground-muted text-sm leading-relaxed">
          This invitation was sent to {payload.token.vendor_email}. Sign out to accept it, or continue as{" "}
          {currentAccountLabel}.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button
            onClick={async () => {
              const { createClient } = await import("@/lib/supabase/client")
              await createClient().auth.signOut()
              window.location.reload()
            }}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            Sign out to accept it
          </Button>
          <Button variant="outline" onClick={() => setAccountState("guest")}>
            Continue as {currentAccountLabel}
          </Button>
        </div>
      </CenteredCard>
    )
  }

  const { project, scopeItem, agency, token: tokenRow, reference_materials: referenceMaterials = [] } = payload
  const hasSubmittedBid = payload.status === "submitted"
  const response = hasSubmittedBid ? payload.response : null
  const showForm = !hasSubmittedBid || isEditingBid
  const dateRange = [formatDateOnly(project.start_date), formatDateOnly(project.end_date)].filter(Boolean).join(" – ")
  const statusLabel = guestStatusLabel(hasSubmittedBid, response?.status)
  // No "Awarded" entry here: rfp_magic_tokens has no partnership_id, so there is no key to
  // join project_assignments.awarded_at against for a guest submission.
  const activityTimeline = buildBidTimeline({
    rfpSentAt: tokenRow.created_at,
    submittedAt: response?.submitted_at ?? tokenRow.submitted_at ?? null,
    feedbackAt: response?.agency_feedback ? response.feedback_updated_at ?? null : null,
  })
  const isExistingPartner = payload.status === "submitted" ? Boolean(payload.is_existing_partner) : false
  const requiredCriteria = normalizeBusinessCriteriaRequired(payload.business_criteria_required)
  const requiredDesignationKeysForBid = DESIGNATION_KEYS.filter((key) => requiredCriteria.designations[key] === true)
  const requiredInsuranceKeysForBid = INSURANCE_KEYS.filter((key) => requiredCriteria.insurance[key]?.required === true)
  const hasRequiredCriteriaForBid =
    requiredDesignationKeysForBid.length > 0 || requiredInsuranceKeysForBid.length > 0 || requiredCriteria.insurance.coi_on_file
  // F1: the old "Required by this agency" wrapper (terms + tiered criteria sharing one heading)
  // is dismantled - Terms and Business criteria are now separate BidFormCollapsibleSection
  // instances (see the "My Bid" tab render below). hasCriteriaTierData mirrors
  // hasExplicitPriorityData(requiredCriteria), the same check BusinessCriteriaRequirementBlock
  // makes internally, so the tiered-vs-legacy branch below never disagrees with the component's
  // own null-render behavior.
  const termsRequired = tokenRow.require_terms_disclosure === true
  const hasCriteriaTierData = hasExplicitPriorityData(requiredCriteria)

  // F1: page-level compliance call - same pure function BusinessCriteriaRequirementBlock calls
  // internally to render its own "N of M required confirmed" line, so the collapsed-header
  // summary can never disagree with it (intentional duplication of a pure/deterministic call).
  const compliance = computeRequirementCompliance(requiredCriteria, businessCriteriaResponses, businessCriteriaAcknowledgments, {
    designations: DESIGNATION_LABELS,
    insurance: INSURANCE_LABELS,
  })
  const criteriaSummaryLabel = getCriteriaSummaryLabel(
    compliance.hasTierData,
    compliance.requiredTotalCount,
    compliance.requiredConfirmedCount
  )
  // Legacy (untiered) business-criteria confirmation count - driven by the exact same state
  // (businessCriteriaResponses, requiredDesignationKeysForBid, requiredInsuranceKeysForBid)
  // already powering the legacy block's checkboxes below, not a new data source.
  const legacyDesignationConfirmed = requiredDesignationKeysForBid.filter((k) => businessCriteriaResponses.designations[k].holds).length
  const legacyInsuranceConfirmed = requiredInsuranceKeysForBid.filter((k) => businessCriteriaResponses.insurance[k].has_coverage).length
  const legacyCoiRequired = requiredCriteria.insurance.coi_on_file === true
  const legacyCoiConfirmed = legacyCoiRequired && businessCriteriaResponses.insurance.coi_on_file ? 1 : 0
  const legacyCriteriaTotal = requiredDesignationKeysForBid.length + requiredInsuranceKeysForBid.length + (legacyCoiRequired ? 1 : 0)
  const legacyCriteriaConfirmed = legacyDesignationConfirmed + legacyInsuranceConfirmed + legacyCoiConfirmed
  const legacyCriteriaSummaryLabel = getCriteriaSummaryLabel(true, legacyCriteriaTotal, legacyCriteriaConfirmed)
  const criteriaOpenCount = hasCriteriaTierData
    ? compliance.requiredTotalCount - compliance.requiredConfirmedCount
    : hasRequiredCriteriaForBid
      ? legacyCriteriaTotal - legacyCriteriaConfirmed
      : 0

  // P2-1. Empty for an RFP with no categories and for every RFP before migration 072, in which
  // case every budget surface below behaves exactly as it did before this feature existed.
  const budgetCategories = normalizeBudgetCategories(tokenRow.budget_categories)
  // P2-4. False for every RFP that did not opt in, every RFP with no deadline, and every RFP at
  // all before migration 076 - today's behavior exactly.
  const biddingClosed = isBiddingClosed({
    close_bidding_at_deadline: tokenRow.close_bidding_at_deadline,
    response_deadline: tokenRow.response_deadline,
  })
  const hasBudgetCategories = budgetCategories.length > 0
  const budgetCategoryTotal = draftGrandTotal(budgetCategories, budgetDraft)
  const budgetCategoryCompleteness = countCategoryCompleteness(budgetCategories, draftEnteredKeys(budgetDraft))

  const termsReadiness = getTermsReadiness(termsDisclosure, termsRequired)
  const readiness = computeReadinessLabel(
    proposalText.trim() ? 0 : 1,
    // With categories the total is derived from them, so counting an empty total as well as an
    // incomplete category would report the same gap twice.
    hasBudgetCategories ? 0 : budgetAmount ? 0 : 1,
    budgetCategoryCompleteness.open,
    timelineText.trim() ? 0 : 1,
    termsRequired && !termsReadiness.satisfied ? 1 : 0,
    criteriaOpenCount
  )

  const responseDeadlineLabel = formatDateOnly(tokenRow.response_deadline)
  const responseDeadlineUrgency = getDeadlineUrgency(tokenRow.response_deadline)

  const preflightParts = [hasBudgetCategories ? "a proposal, a budget by category, and a timeline" : "a proposal, budget, and timeline"]
  if (termsRequired) preflightParts.push("term disclosures")
  if (hasCriteriaTierData || hasRequiredCriteriaForBid) preflightParts.push("certification details for designations you claim")
  const preflightLine = `This bid needs ${joinWithOxfordComma(preflightParts)}.`

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className={cn("max-w-2xl mx-auto space-y-6", activeTab === "my-bid" && showForm && "pb-24")}>
        <div>
          <div className="font-display font-black text-2xl tracking-tight text-foreground">LIGAMENT</div>
          <div className="font-mono text-2xs text-foreground-muted uppercase tracking-wider mt-1">
            Powered by Ligament
          </div>
        </div>

        {/* F2: response_deadline is absent on tokens minted before migration 074 applies -
            renders nothing rather than a fake/omitted deadline, matching the honest-empty-state
            rule everywhere else this value is shown. */}
        {responseDeadlineLabel && (
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-mono inline-flex items-center gap-2",
              responseDeadlineUrgency === "amber" && "border-amber-300 bg-amber-500/10 text-amber-300",
              responseDeadlineUrgency === "red" && "border-red-300 bg-red-500/10 text-red-300",
              responseDeadlineUrgency === "none" && "border-border/40 bg-white/5 text-foreground"
            )}
          >
            Respond by {responseDeadlineLabel}
            {/* P2-4: one deadline chip, one state. */}
            {biddingClosed && ` (${BIDDING_CLOSED_BADGE.toLowerCase()})`}
            {responseDeadlineUrgency === "red" && " (past due)"}
          </div>
        )}

        {/* Persistent guest banner - visible on every tab, not just Status & Feedback, so the
            account-status confirmation is seen immediately regardless of which tab a guest
            lands on (including a fresh page load of an already-submitted link). */}
        {hasSubmittedBid ? (
          <div className="rounded-lg border border-teal-400/30 bg-teal-400/[0.06] p-4 flex flex-wrap items-center justify-between gap-3">
            {isExistingPartner ? (
              <>
                <p className="text-sm text-foreground/90 leading-relaxed max-w-md">
                  You already have a Ligament account. Sign in to view this bid in your portal.
                </p>
                <Button asChild variant="outline" className="border-teal-400/40 text-teal-200 hover:bg-teal-400/10 shrink-0">
                  <a href="/auth/login">Sign in</a>
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-foreground/90 leading-relaxed max-w-md">
                  You&apos;ve been added to {agencyDisplayName(agency)}&apos;s vendor network. Create your profile
                  to be discoverable to other agencies and track all your bids in one place.
                </p>
                <Button
                  asChild
                  variant="outline"
                  className="border-teal-400/40 text-teal-200 hover:bg-teal-400/10 shrink-0"
                >
                  <a
                href={`/auth/sign-up?email=${encodeURIComponent(tokenRow.vendor_email)}&source=magic_link&next=${encodeURIComponent("/partner/rfps")}`}
              >
                    Create profile
                  </a>
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-teal-400/30 bg-teal-400/[0.06] p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground/90 leading-relaxed max-w-md">
              You&apos;re viewing as a guest. Create a profile to track all your bids and get discovered by agencies.
            </p>
            <Button
              asChild
              variant="outline"
              className="border-teal-400/40 text-teal-200 hover:bg-teal-400/10 shrink-0"
            >
              <a
                href={`/auth/sign-up?email=${encodeURIComponent(tokenRow.vendor_email)}&source=magic_link&next=${encodeURIComponent("/partner/rfps")}`}
              >
                Create profile
              </a>
            </Button>
          </div>
        )}

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
            <div className="rounded-lg border border-border/30 bg-white/5 p-6 space-y-4">
              <div className="flex items-center gap-3">
                {agency.company_logo_url && !agencyLogoLoadError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={agency.company_logo_url}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                    onError={() => setAgencyLogoLoadError(true)}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center shrink-0 font-display font-bold text-accent">
                    {agencyDisplayName(agency).charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="font-display font-bold text-foreground">{agencyDisplayName(agency)}</div>
              </div>
              {tokenRow.require_terms_disclosure && (
                <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-foreground">
                  This agency requires basic term disclosures with your bid.
                </div>
              )}
              <div>
                <div className="font-display font-bold text-xl text-foreground">{project.name}</div>
                {project.client_name && <div className="text-sm text-foreground-muted">{project.client_name}</div>}
              </div>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                {project.budget_range && (
                  <div>
                    <div className="font-mono text-2xs uppercase text-foreground-muted">Budget</div>
                    <div className="text-foreground">{project.budget_range}</div>
                  </div>
                )}
                {dateRange && (
                  <div>
                    <div className="font-mono text-2xs uppercase text-foreground-muted">Timeline</div>
                    <div className="text-foreground">{dateRange}</div>
                  </div>
                )}
              </div>
              {project.description && (
                <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">{project.description}</p>
              )}
              {referenceMaterials.length > 0 && (
                <div className="pt-3 border-t border-border/30 space-y-2">
                  <div className="font-mono text-2xs uppercase text-foreground-muted tracking-wider">
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
                  <div className="font-display font-bold text-sm text-foreground mb-2">Business criteria required</div>
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
              <>
              {biddingClosed ? (
                <p className="text-xs text-warning border border-warning/40 bg-warning/10 rounded-md px-3 py-2 mb-4">
                  {BIDDING_CLOSED_VENDOR_MESSAGE}
                </p>
              ) : (
                <p className="text-xs text-foreground-muted mb-4">{preflightLine}</p>
              )}
              <form
                id="guest-bid-form"
                onSubmit={handleSubmit}
                className="rounded-lg border border-border/30 bg-white/5 p-6 space-y-4"
              >
                {isEditingBid && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-accent/5 border border-accent/20">
                    <span className="font-mono text-2xs text-accent uppercase tracking-wider">Editing your bid</span>
                    <button
                      type="button"
                      onClick={cancelEditingBid}
                      className="font-mono text-2xs text-foreground-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <BidFormCollapsibleSection
                  title="Your bid response"
                  summary={
                    hasBudgetCategories
                      ? categoriesSummaryLabel(budgetCategoryCompleteness.total, budgetCategoryCompleteness.complete)
                      : undefined
                  }
                  open={openSections.bidResponse}
                  onToggle={() => toggleSection("bidResponse")}
                  theme="dark"
                >
                <div>
                  <label className="block font-mono text-2xs text-foreground-muted uppercase tracking-wider mb-2">
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
                {/* P2-2. Optional and skippable - deliberately absent from the readiness count. */}
                <BidProposalSectionsEditor value={proposalSections} onChange={setProposalSections} theme="dark" />

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-mono text-2xs text-foreground-muted uppercase tracking-wider mb-2">
                      Budget Amount
                    </label>
                    {hasBudgetCategories ? (
                      /* One source per number: the sum of the categories below, never a second
                         editable total that could disagree with them. */
                      <div
                        className="h-10 rounded-md border border-border bg-white/10 px-3 flex items-center font-mono text-sm text-foreground"
                        aria-readonly="true"
                      >
                        {currencySymbolFor(budgetCurrency)}
                        {budgetCategoryTotal.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </div>
                    ) : (
                      <CurrencyInput
                        required
                        value={budgetAmount}
                        onChange={setBudgetAmount}
                        currencySymbol={currencySymbolFor(budgetCurrency)}
                        placeholder={`${currencySymbolFor(budgetCurrency)}50,000`}
                        className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                      />
                    )}
                    {hasBudgetCategories && (
                      <p className="font-mono text-2xs text-foreground-muted mt-2">Added up from your categories below.</p>
                    )}
                  </div>
                  <div>
                    <label className="block font-mono text-2xs text-foreground-muted uppercase tracking-wider mb-2">
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

                {budgetCurrency === "Other" && (
                  <div>
                    <label className="block font-mono text-2xs text-foreground-muted uppercase tracking-wider mb-2">
                      Which currency
                    </label>
                    <Input
                      value={budgetCurrencyOther}
                      onChange={(e) => setBudgetCurrencyOther(e.target.value)}
                      placeholder="e.g. CHF, or the region you bill in"
                      className="bg-white/5 border-border text-foreground"
                    />
                  </div>
                )}

                <div>
                  <label className="block font-mono text-2xs text-foreground-muted uppercase tracking-wider mb-2">
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
                {/* P2-1. Renders nothing when this RFP defines no categories. */}
                <BidBudgetCategories
                  categories={budgetCategories}
                  draft={budgetDraft}
                  onChange={setBudgetDraft}
                  currency={budgetCurrency}
                  theme="dark"
                />
                </BidFormCollapsibleSection>

                <BidFormCollapsibleSection
                  title="Attachments"
                  summary={getAttachmentsSummaryLabel(attachments.length)}
                  open={openSections.attachments}
                  onToggle={() => toggleSection("attachments")}
                  theme="dark"
                >
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
                        Add link
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
                </BidFormCollapsibleSection>

                <BidFormCollapsibleSection
                  title="Terms"
                  summary={termsReadiness.label}
                  open={openSections.terms}
                  onToggle={() => toggleSection("terms")}
                  theme="dark"
                >
                {termsErrors.length > 0 && (
                  <div className="text-sm text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    Complete the required term disclosures below.
                  </div>
                )}
                <TermsDisclosureSection
                  value={termsDisclosure}
                  onChange={setTermsDisclosure}
                  required={termsRequired}
                  theme="dark"
                  errors={termsErrors}
                  disabled={submitting || biddingClosed}
                  forceExpanded
                />
                </BidFormCollapsibleSection>

                {/* S4-1: RFPs with explicit requirement-tier data get the new required/preferred
                    block (dark theme, matching this page's chrome, renders required-then-preferred
                    internally); RFPs authored before tiers existed fall through to the legacy
                    untiered block below, unchanged. No profile prefill on the guest path - there
                    is no profile. */}
                {hasCriteriaTierData && (
                  <BidFormCollapsibleSection
                    title="Business criteria"
                    summary={criteriaSummaryLabel}
                    open={openSections.criteria}
                    onToggle={() => toggleSection("criteria")}
                    theme="dark"
                  >
                  <BusinessCriteriaRequirementBlock
                    theme="dark"
                    required={requiredCriteria}
                    responses={businessCriteriaResponses}
                    acknowledgments={businessCriteriaAcknowledgments}
                    onUpdateDesignation={updateBusinessCriteriaDesignation}
                    onUpdateInsurance={updateBusinessCriteriaInsurance}
                    onUpdateCoi={updateBusinessCriteriaCoi}
                    onSetAcknowledgment={setBusinessCriteriaAcknowledgment}
                    onConfirmAll={confirmAllRequiredCriteria}
                    canEdit={!submitting}
                    hideTitle
                  />
                  </BidFormCollapsibleSection>
                )}

                {hasRequiredCriteriaForBid && !hasCriteriaTierData && (
                  <BidFormCollapsibleSection
                    title="Business criteria"
                    summary={legacyCriteriaSummaryLabel}
                    open={openSections.criteria}
                    onToggle={() => toggleSection("criteria")}
                    theme="dark"
                  >
                  <p className="text-xs text-foreground-muted">
                    This RFP requires confirmation of the following. Confirm what applies to your company.
                  </p>
                  {requiredCriteria.notes.trim() && (
                    <p className="text-xs text-foreground-muted whitespace-pre-wrap">{requiredCriteria.notes}</p>
                  )}

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
                              <HelpTerm term={key} theme="dark" className="font-display font-bold text-sm text-foreground">
                                {DESIGNATION_LABELS[key]}
                              </HelpTerm>
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
                                <HelpTerm term={key} theme="dark">{INSURANCE_LABELS[key]}</HelpTerm>
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
                        <HelpTerm term="coi" theme="dark">Certificate of Insurance (COI)</HelpTerm> on file
                      </span>
                    </label>
                  )}
                  </BidFormCollapsibleSection>
                )}

                {submitError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200">
                    {submitError}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting || biddingClosed}
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

              {/* F1 sticky readiness bar - guest has no draft concept, so this is Submit-only.
                  Uses the form="guest-bid-form" association (button lives outside the <form> in
                  the DOM) so it triggers the exact same handleSubmit - no second code path. */}
              <div
                className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/40 bg-background/95 backdrop-blur"
                style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
              >
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
                  <p className="font-mono text-xs text-foreground min-w-0 truncate">{readiness.label}</p>
                  <Button
                    type="submit"
                    form="guest-bid-form"
                    disabled={submitting || biddingClosed}
                    className="bg-accent text-accent-foreground hover:bg-accent/90 shrink-0"
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
                </div>
              </div>
              </>
            ) : (
              response && (
                <div className="rounded-lg border border-border/30 bg-white/5 p-6 space-y-4">
                  {(formatSubmittedAt(response.submitted_at) || formatSubmittedAt(tokenRow.submitted_at)) && (
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-2xs uppercase text-accent tracking-wider">
                        Submitted {formatSubmittedAt(response.submitted_at) || formatSubmittedAt(tokenRow.submitted_at)}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="font-mono text-2xs uppercase text-foreground-muted mb-1">Proposal</div>
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
                        className="mt-1 inline-flex items-center gap-1 font-mono text-2xs text-accent hover:underline"
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
                      <div className="font-mono text-2xs uppercase text-foreground-muted mb-1">Budget</div>
                      <div className="text-sm text-foreground">{formatBudgetForDisplay(response.budget_proposal)}</div>
                    </div>
                    <div>
                      <div className="font-mono text-2xs uppercase text-foreground-muted mb-1">Timeline</div>
                      <div className="text-sm text-foreground">{formatTimelineForDisplay(response.timeline_proposal)}</div>
                    </div>
                  </div>
                  {response.terms_disclosure ? (
                    <div>
                      <div className="font-mono text-2xs uppercase text-foreground-muted mb-1">Terms</div>
                      {(() => {
                        const d = withTermsDisclosureDefaults(response.terms_disclosure)
                        const notes = [
                          d.payment.note && `Payment: ${d.payment.note}`,
                          d.kill_fee.note && `Kill fee: ${d.kill_fee.note}`,
                          d.ip_rights.note && `IP rights: ${d.ip_rights.note}`,
                          d.rate_validity.note && `Rate validity: ${d.rate_validity.note}`,
                        ].filter(Boolean) as string[]
                        return (
                          <div className="text-sm text-foreground space-y-1">
                            <p>{formatTermsDisclosureSummary(d)}</p>
                            {notes.map((n, i) => (
                              <p key={i} className="text-xs text-foreground-muted">
                                {n}
                              </p>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  ) : (
                    response.payment_terms && (
                      <div>
                        <div className="font-mono text-2xs uppercase text-foreground-muted mb-1">Payment Terms</div>
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
                    )
                  )}
                  {response.attachments && response.attachments.length > 0 && (
                    <div>
                      <div className="font-mono text-2xs uppercase text-foreground-muted mb-2">Attachments</div>
                      <ul className="space-y-1.5">
                        {response.attachments.map((a, i) => (
                          <li key={`${a.url}-${i}`}>
                            <a
                              href={guestAttachmentHref(token, a.url)}
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
                      Edit bid
                    </Button>
                  </div>
                </div>
              )
            )}
          </TabsContent>

          {/* TAB 3: Status & Feedback */}
          <TabsContent value="status">
            <div className="space-y-4">
              <div className="rounded-lg border border-border/30 bg-white/5 p-6 text-center">
                <div className="font-mono text-2xs uppercase text-foreground-muted mb-3">Current Status</div>
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
                <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.05] p-5">
                  <div className="font-mono text-2xs uppercase text-amber-300 tracking-wider mb-2">
                    Agency Feedback
                  </div>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {response.agency_feedback}
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-border/30 bg-white/5 p-5">
                <div className="font-mono text-2xs uppercase text-foreground-muted tracking-wider mb-3">Timeline</div>
                <ul className="space-y-3">
                  {activityTimeline.map((entry, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                      <span className="text-sm text-foreground">{entry.label}</span>
                      <span className="font-mono text-2xs text-foreground-muted ml-auto">
                        {formatSubmittedAt(entry.iso)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {!hasSubmittedBid && (
                <div className="rounded-lg border border-border/30 bg-white/5 p-6 text-center space-y-3">
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

        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/terms"
            className="text-2xs text-foreground-muted hover:text-foreground transition-colors"
          >
            Terms of Service
          </Link>
          <span className="text-foreground-muted/30">|</span>
          <Link
            href="/privacy"
            className="text-2xs text-foreground-muted hover:text-foreground transition-colors"
          >
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  )
}
