"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { PartnerChrome } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { CurrencyInput } from "@/components/ui/currency-input"
import { cn, normalizeMeetingUrlForHref, formatSubmittedAt } from "@/lib/utils"
import { buildBidTimeline } from "@/lib/bid-timeline"
import { displayFilenameFromBlobUrl, isVercelBlobStorageUrl } from "@/lib/vercel-blob-url"
import { isDemoMode } from "@/lib/demo-data"
import { createClient } from "@/lib/supabase/client"
import { getBidStatusColor, getBidStatusLabel } from "@/lib/bid-status"
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
} from "@/lib/business-criteria"
import { BusinessCriteriaRequirementBlock } from "@/components/business-criteria-requirement-block"
import {
  BUDGET_CURRENCY_OPTIONS,
  TIMELINE_UNIT_OPTIONS,
  parseBudgetProposal,
  parseTimelineProposal,
  buildBudgetProposalForSave,
  buildTimelineProposalForSave,
  isBudgetValidForSubmit,
  isTimelineValidForSubmit,
} from "@/lib/rfp-response-fields"
import {
  emptyTermsDisclosure,
  withTermsDisclosureDefaults,
  validateTermsDisclosure,
  mergeLegacyPaymentTermsIntoDisclosure,
  isTermsDisclosureStarted,
  type TermsDisclosure,
  type TermsDisclosureValidationError,
} from "@/lib/terms-disclosure"
import { TermsDisclosureSection } from "@/components/terms-disclosure-section"
import { HelpTerm } from "@/components/help-term"
import {
  Loader2,
  FileText,
  Building2,
  Calendar,
  DollarSign,
  Send,
  Upload,
  CheckCircle,
  Trash2,
  Plus,
  Link as LinkIcon,
  CalendarDays,
  ExternalLink,
  Download,
} from "lucide-react"

/** Readable text on white cards (defaults are transparent / light in dark theme). */
const fieldClass =
  "border-vendor-border bg-vendor-surface text-vendor-foreground placeholder:text-vendor-muted/70 shadow-sm focus-visible:ring-vendor-foreground/30 focus-visible:border-vendor-foreground"
const textareaClass = cn(fieldClass, "min-h-[140px]")
const inputClass = fieldClass

/** Shadcn outline uses bg-background (#0C3535); pairing with text-vendor-foreground made label text invisible on partner light pages. */
const btnOutlineLight =
  "border-vendor-border !bg-vendor-surface text-vendor-foreground shadow-sm hover:!bg-vendor-background hover:text-vendor-foreground"
const btnPrimaryDark =
  "!bg-vendor-foreground !text-white hover:!bg-vendor-foreground/90 font-display font-bold border-transparent"

type InboxRow = {
  id: string
  agency_id: string
  scope_item_id: string
  scope_item_name: string
  scope_item_description: string | null
  estimated_budget?: string | null
  timeline: string | null
  master_rfp_json: Record<string, unknown> | null
  agency_company_name: string
  agency_meeting_url?: string | null
  status: string
  created_at: string
  awarded_at?: string | null
  response_deadline?: string | null
  partner_intent?: "will_respond" | "has_questions" | "requesting_call" | null
  intent_set_at?: string | null
  nda_gate_enforced?: boolean
  nda_confirmed_at?: string | null
  client_name?: string | null
  require_terms_disclosure?: boolean
}

type AttachmentTag =
  | "work_example"
  | "capabilities_overview"
  | "proposal"
  | "timeline"
  | "budget"
  | "other"

const TAG_OPTIONS: { value: AttachmentTag; label: string }[] = [
  { value: "work_example", label: "Work Example" },
  { value: "capabilities_overview", label: "Capabilities Overview" },
  { value: "proposal", label: "Proposal" },
  { value: "timeline", label: "Timeline" },
  { value: "budget", label: "Budget" },
  { value: "other", label: "Other" },
]

function labelForTag(tag: AttachmentTag, otherLabel: string): string {
  if (tag === "other") return otherLabel.trim()
  return TAG_OPTIONS.find((o) => o.value === tag)?.label || tag
}

function externalLinkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return "Link"
  }
}

type SavedAttachment = { type: string; label: string; url: string }
type PartnerIntent = "will_respond" | "has_questions" | "requesting_call"

type DraftAttachment = {
  id: string
  tag: AttachmentTag
  otherLabel: string
  source: "url" | "file"
  urlInput: string
  storedUrl: string | null
  fileName: string | null
}

function newDraft(): DraftAttachment {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random()}`,
    tag: "work_example",
    otherLabel: "",
    source: "url",
    urlInput: "",
    storedUrl: null,
    fileName: null,
  }
}

/** Partner uploads use Vercel Blob — treat as file rows, never show raw URL in UI. */
function isLikelyPrivateBlobUrl(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname.toLowerCase()
    return h.includes("blob.vercel-storage.com") || h.includes("vercel-storage.com")
  } catch {
    return false
  }
}

function displayNameFromBlobPath(url: string): string {
  try {
    const seg = decodeURIComponent(new URL(url).pathname.split("/").pop() || "")
    const withoutTs = seg.replace(/^\d+-/, "")
    return withoutTs || "Uploaded file"
  } catch {
    return "Uploaded file"
  }
}

function savedToDrafts(saved: SavedAttachment[]): DraftAttachment[] {
  return saved.map((a) => {
    const tag = (ALLOWED.has(a.type as AttachmentTag) ? a.type : "proposal") as AttachmentTag
    const url = a.url.trim()
    if (isLikelyPrivateBlobUrl(url)) {
      return {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random()}`,
        tag,
        otherLabel: tag === "other" ? a.label : "",
        source: "file" as const,
        urlInput: "",
        storedUrl: url,
        fileName: displayNameFromBlobPath(url),
      }
    }
    return {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random()}`,
      tag,
      otherLabel: tag === "other" ? a.label : "",
      source: "url" as const,
      urlInput: url,
      storedUrl: url,
      fileName: null,
    }
  })
}

const ALLOWED = new Set(TAG_OPTIONS.map((t) => t.value))

type ResponseRow = {
  id: string
  proposal_text: string
  budget_proposal: string
  timeline_proposal: string
  payment_terms?: Record<string, unknown> | null
  terms_disclosure?: unknown
  attachments: SavedAttachment[] | null
  business_criteria_responses?: unknown
  /** Absent on rows written before migration 071 - always read through normalizeAcknowledgments. */
  business_criteria_acknowledgments?: unknown
  status: string
  agency_feedback?: string | null
  feedback_updated_at?: string | null
  submitted_at?: string | null
  updated_at: string
}

type ResponseVersion = {
  id: string
  response_id: string
  version_number: number
  proposal_text: string
  /** TEXT JSON string or object from PostgREST/jsonb depending on column type */
  budget_proposal: string | Record<string, unknown> | null
  timeline_proposal: string | Record<string, unknown> | null
  attachments: SavedAttachment[] | null
  status_at_submission: string
  submitted_at: string
  change_notes?: string | null
}

/** API may return JSON string-of-string; unwrap up to twice, then read amount/currency. */
function parseVersionBudgetFields(val: unknown): { amount?: number; currency?: string } | null {
  try {
    let v: unknown = val
    if (typeof v === "string") v = JSON.parse(v)
    if (typeof v === "string") v = JSON.parse(v)
    return v as { amount?: number; currency?: string } | null
  } catch {
    return null
  }
}

function parseVersionTimelineFields(val: unknown): { duration?: number; unit?: string } | null {
  try {
    let v: unknown = val
    if (typeof v === "string") v = JSON.parse(v)
    if (typeof v === "string") v = JSON.parse(v)
    return v as { duration?: number; unit?: string } | null
  } catch {
    return null
  }
}

function draftsToPayload(drafts: DraftAttachment[]): SavedAttachment[] {
  const out: SavedAttachment[] = []
  for (const d of drafts) {
    const url = (d.storedUrl || d.urlInput).trim()
    if (!url) continue
    const tag = d.tag
    const label = labelForTag(tag, d.otherLabel)
    if (tag === "other" && !d.otherLabel.trim()) continue
    out.push({ type: tag, label, url })
  }
  return out.slice(0, 6)
}

function parsePaymentTerms(raw: unknown): {
  deposit_required_pct: string
  payment_schedule_preference: string
  preferred_currency: string
  additional_notes: string
} {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const depositRaw = source.deposit_required_pct
  const depositValue =
    typeof depositRaw === "number" && Number.isFinite(depositRaw)
      ? String(depositRaw)
      : typeof depositRaw === "string"
        ? depositRaw
        : ""
  return {
    deposit_required_pct: depositValue,
    payment_schedule_preference: String(source.payment_schedule_preference ?? "").trim(),
    preferred_currency: (String(source.preferred_currency ?? "").trim().toUpperCase() || "USD"),
    additional_notes: String(source.additional_notes ?? "").trim(),
  }
}

function partnerIntentLabel(intent: PartnerIntent): string {
  if (intent === "will_respond") return "I plan to respond"
  if (intent === "has_questions") return "I have questions"
  return "Request a call"
}

function formatDeadlineDate(value?: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleDateString("en-US", {
    month: "long",
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

function MasterRfpSections({ json }: { json: Record<string, unknown> | null }) {
  if (!json || typeof json !== "object") {
    return <p className="text-sm text-vendor-muted">No master RFP content available.</p>
  }
  const projectName = typeof json.projectName === "string" ? json.projectName : ""
  const client = typeof json.client === "string" ? json.client : ""
  const overview = typeof json.overview === "string" ? json.overview : ""
  const objectives = Array.isArray(json.objectives) ? json.objectives.filter((x) => typeof x === "string") : []
  const totalBudget = typeof json.totalBudget === "string" ? json.totalBudget : ""
  const timeline = typeof json.timeline === "string" ? json.timeline : ""
  const scopeItems = Array.isArray(json.scopeItems) ? json.scopeItems : []
  const requiredCriteria = normalizeBusinessCriteriaRequired(json.business_criteria_required)
  const requiredDesignationKeys = DESIGNATION_KEYS.filter((key) => requiredCriteria.designations[key] === true)
  const requiredInsuranceKeys = INSURANCE_KEYS.filter((key) => requiredCriteria.insurance[key]?.required === true)
  const hasRequiredCriteria =
    requiredDesignationKeys.length > 0 || requiredInsuranceKeys.length > 0 || requiredCriteria.insurance.coi_on_file

  return (
    <div className="space-y-6 text-sm text-vendor-foreground">
      <div>
        <h4 className="font-display font-bold text-vendor-foreground mb-1">Project</h4>
        <p>{projectName || "-"}</p>
        {client && <p className="text-vendor-muted-strong mt-1">Client: {client}</p>}
      </div>
      {overview && (
        <div>
          <h4 className="font-display font-bold text-vendor-foreground mb-1">Overview</h4>
          <p className="leading-relaxed whitespace-pre-wrap">{overview}</p>
        </div>
      )}
      {objectives.length > 0 && (
        <div>
          <h4 className="font-display font-bold text-vendor-foreground mb-2">Objectives</h4>
          <ul className="list-disc list-inside space-y-1">
            {objectives.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}
      {(totalBudget || timeline) && (
        <div className="grid sm:grid-cols-2 gap-4">
          {totalBudget && (
            <div className="flex gap-2 items-start">
              <DollarSign className="w-4 h-4 text-vendor-muted/70 mt-0.5 shrink-0" />
              <div>
                <div className="font-mono text-2xs uppercase text-vendor-muted">Program budget (master)</div>
                <div>{totalBudget}</div>
              </div>
            </div>
          )}
          {timeline && (
            <div className="flex gap-2 items-start">
              <Calendar className="w-4 h-4 text-vendor-muted/70 mt-0.5 shrink-0" />
              <div>
                <div className="font-mono text-2xs uppercase text-vendor-muted">Timeline (master)</div>
                <div>{timeline}</div>
              </div>
            </div>
          )}
        </div>
      )}
      {scopeItems.length > 0 && (
        <div>
          <h4 className="font-display font-bold text-vendor-foreground mb-2">All scope items (master RFP)</h4>
          <ul className="space-y-3">
            {scopeItems.map((item: unknown, i: number) => {
              const s = item as { name?: string; description?: string; estimatedBudget?: string; timeline?: string }
              return (
                <li key={i} className="border border-vendor-border/50 rounded-lg p-3 bg-vendor-background/80">
                  <div className="font-medium text-vendor-foreground">{s.name || `Item ${i + 1}`}</div>
                  {s.description && <p className="text-vendor-muted-strong mt-1">{s.description}</p>}
                  <div className="font-mono text-2xs text-vendor-muted mt-2 flex flex-wrap gap-3">
                    {s.estimatedBudget && <span>Budget: {s.estimatedBudget}</span>}
                    {s.timeline && <span>Timeline: {s.timeline}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {hasRequiredCriteria && (
        <div>
          <h4 className="font-display font-bold text-vendor-foreground mb-2">Business criteria required</h4>
          {requiredDesignationKeys.length > 0 && (
            <ul className="list-disc list-inside space-y-1">
              {requiredDesignationKeys.map((key) => (
                <li key={key}>{DESIGNATION_LABELS[key]}</li>
              ))}
            </ul>
          )}
          {requiredInsuranceKeys.length > 0 && (
            <ul className="list-disc list-inside space-y-1 mt-1">
              {requiredInsuranceKeys.map((key) => {
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
            <p className="mt-1">Certificate of Insurance (COI) on file</p>
          )}
          {requiredCriteria.notes.trim() && (
            <p className="text-vendor-muted-strong mt-2 whitespace-pre-wrap">{requiredCriteria.notes}</p>
          )}
        </div>
      )}
    </div>
  )
}

const demoInbox: InboxRow = {
  id: "1",
  agency_id: "demo",
  scope_item_id: "s1",
  scope_item_name: "Video production",
  scope_item_description: "Full production for social and broadcast cutdowns.",
  estimated_budget: "$85k–$110k",
  timeline: "12 weeks from kickoff",
  agency_company_name: "LIGAMENT (demo)",
  status: "new",
  created_at: new Date().toISOString(),
  master_rfp_json: {
    projectName: "Sports Creator Series",
    client: "Confidential brand",
    overview: "Documentary-style creator content for a national sports narrative.",
    objectives: ["Grow audience among 18–34", "Deliver platform-native cuts"],
    totalBudget: "Mid–six-figure program",
    timeline: "6 months rolling",
    scopeItems: [
      { id: "s1", name: "Video production", description: "Principal production and post.", estimatedBudget: "$85k–$110k", timeline: "12 weeks" },
    ],
  },
}

export default function PartnerRfpDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = typeof params?.id === "string" ? params.id : ""
  const isDemo = isDemoMode()
  const demoIds = ["1", "2", "3"]
  const isDemoDetail = isDemo && demoIds.includes(id)

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const [loading, setLoading] = useState(!isDemoDetail)
  const [error, setError] = useState<string | null>(null)
  const [inbox, setInbox] = useState<InboxRow | null>(
    isDemoDetail ? { ...demoInbox, id } : null
  )
  const [existing, setExisting] = useState<ResponseRow | null>(null)

  const [proposalText, setProposalText] = useState("")
  const [budgetAmount, setBudgetAmount] = useState("")
  const [budgetCurrency, setBudgetCurrency] = useState<string>("USD")
  const [budgetCurrencyOther, setBudgetCurrencyOther] = useState("")
  const [budgetLegacyHint, setBudgetLegacyHint] = useState<string | null>(null)
  const [timelineDuration, setTimelineDuration] = useState("")
  const [timelineUnit, setTimelineUnit] = useState<"Days" | "Weeks" | "Months">("Weeks")
  const [timelineLegacyHint, setTimelineLegacyHint] = useState<string | null>(null)
  const [termsDisclosure, setTermsDisclosure] = useState<TermsDisclosure>(emptyTermsDisclosure())
  const [termsErrors, setTermsErrors] = useState<TermsDisclosureValidationError[]>([])
  const [saveTermsAsDefault, setSaveTermsAsDefault] = useState(true)
  const [defaultTermsFromProfile, setDefaultTermsFromProfile] = useState<TermsDisclosure | null>(null)
  const [defaultTermsLoaded, setDefaultTermsLoaded] = useState(false)
  const [termsHydrated, setTermsHydrated] = useState(false)
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([])
  const [businessCriteriaResponses, setBusinessCriteriaResponses] = useState<BusinessCriteriaHolds>(
    withBusinessCriteriaDefaults(null)
  )
  const [businessCriteriaAcknowledgments, setBusinessCriteriaAcknowledgments] =
    useState<BusinessCriteriaAcknowledgments>(emptyAcknowledgments())
  /** Vendor's saved profile holds, fetched once for a fresh (no prior response) bid - powers the "Confirmed from your profile" badge. Portal path only; guest has no profile. */
  const [profileCriteriaHolds, setProfileCriteriaHolds] = useState<BusinessCriteriaHolds | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [savingKind, setSavingKind] = useState<null | "draft" | "submitted">(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [bidSubmittedModalOpen, setBidSubmittedModalOpen] = useState(false)
  const [bidSubmittedModalIsRevision, setBidSubmittedModalIsRevision] = useState(false)
  const [versions, setVersions] = useState<ResponseVersion[]>([])
  const [historyOpen, setHistoryOpen] = useState(true)
  const [changeNotes, setChangeNotes] = useState("")
  const [activeTab, setActiveTab] = useState<"status" | "rfp" | "bid">("bid")
  const [partnerIntent, setPartnerIntent] = useState<PartnerIntent | null>(null)
  const [isSavingIntent, setIsSavingIntent] = useState(false)
  const [intentError, setIntentError] = useState<string | null>(null)
  const [ndaGateBlocked, setNdaGateBlocked] = useState(false)
  const [ndaNotifyBusy, setNdaNotifyBusy] = useState(false)
  const [ndaNotifyMessage, setNdaNotifyMessage] = useState<string | null>(null)

  const updateDraft = useCallback((draftId: string, patch: Partial<DraftAttachment>) => {
    setDraftAttachments((prev) => prev.map((d) => (d.id === draftId ? { ...d, ...patch } : d)))
  }, [])

  const removeDraft = useCallback((draftId: string) => {
    setDraftAttachments((prev) => prev.filter((d) => d.id !== draftId))
  }, [])

  const addDraft = useCallback(() => {
    setDraftAttachments((prev) => (prev.length >= 6 ? prev : [...prev, newDraft()]))
  }, [])

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
    const req = requiredCriteria
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
  }

  useEffect(() => {
    if (isDemoDetail) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      setTermsHydrated(false)
      try {
        const res = await fetch(`/api/partner/rfps/${id}`, { cache: "no-store", credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (res.status === 403 && data?.error === "nda_required") {
          if (!cancelled) {
            const blockedInbox = (data?.inbox || {}) as Partial<InboxRow>
            setInbox({
              id,
              agency_id: "",
              scope_item_id: "",
              scope_item_name: blockedInbox.scope_item_name || "Confidential RFP",
              scope_item_description: null,
              estimated_budget: null,
              timeline: null,
              master_rfp_json: (blockedInbox.master_rfp_json || {}) as Record<string, unknown>,
              agency_company_name: blockedInbox.agency_company_name || "Lead agency",
              status: "new",
              created_at: new Date().toISOString(),
              nda_gate_enforced: true,
              nda_confirmed_at: null,
            })
            setNdaGateBlocked(true)
            setError(null)
          }
          return
        }
        if (!res.ok) throw new Error((data?.error as string) || "Could not load RFP")
        if (!cancelled) {
          setNdaGateBlocked(false)
          setInbox(data.inbox as InboxRow)
          setPartnerIntent(((data.inbox as InboxRow)?.partner_intent as PartnerIntent | null) || null)
          const r = data.response as ResponseRow | null
          const versionRows = (data.versions || []) as ResponseVersion[]
          setVersions(versionRows)
          if (r) {
            setExisting(r)
            setProposalText(r.proposal_text || "")
            const bp = parseBudgetProposal(r.budget_proposal || "")
            setBudgetAmount(bp.amount)
            setBudgetCurrency(bp.currency)
            setBudgetCurrencyOther(bp.customOther)
            setBudgetLegacyHint(bp.legacyHint)
            const tp = parseTimelineProposal(r.timeline_proposal || "")
            setTimelineDuration(tp.duration)
            setTimelineUnit(tp.unit)
            setTimelineLegacyHint(tp.legacyHint)
            const att = Array.isArray(r.attachments) ? r.attachments : []
            setDraftAttachments(att.length > 0 ? savedToDrafts(att as SavedAttachment[]) : [])
            setBusinessCriteriaResponses(withBusinessCriteriaDefaults(r.business_criteria_responses))
            setBusinessCriteriaAcknowledgments(normalizeAcknowledgments(r.business_criteria_acknowledgments))
          } else {
            setExisting(null)
            setProposalText("")
            setBudgetAmount("")
            setBudgetCurrency("USD")
            setBudgetCurrencyOther("")
            setBudgetLegacyHint(null)
            setTimelineDuration("")
            setTimelineUnit("Weeks")
            setTimelineLegacyHint(null)
            setDraftAttachments([])
            setBusinessCriteriaAcknowledgments(emptyAcknowledgments())
            setVersions([])

            // Profile prefill (S4-1, portal path only - guest has no profile). A fresh bid
            // (no prior response on this RFP) seeds from the vendor's saved business
            // criteria; profileCriteriaHolds is kept alongside so the UI can badge which
            // fields came from the profile vs. were typed fresh.
            try {
              const supabase = createClient()
              const { data: auth } = await supabase.auth.getUser()
              if (auth?.user && !cancelled) {
                const { data: profileRow } = await supabase
                  .from("profiles")
                  .select("business_criteria")
                  .eq("id", auth.user.id)
                  .maybeSingle()
                const prefill = withBusinessCriteriaDefaults(profileRow?.business_criteria ?? null)
                if (!cancelled) {
                  setProfileCriteriaHolds(prefill)
                  setBusinessCriteriaResponses(prefill)
                }
              } else if (!cancelled) {
                setBusinessCriteriaResponses(withBusinessCriteriaDefaults(null))
              }
            } catch (prefillErr) {
              console.error("[partner/rfps] profile business_criteria prefill failed", prefillErr)
              if (!cancelled) setBusinessCriteriaResponses(withBusinessCriteriaDefaults(null))
            }
          }
        }
      } catch (e) {
        console.error("[partner/rfps] initial GET /api/partner/rfps/[id] failed", {
          inboxId: id,
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
  }, [id, isDemoDetail])

  /** Signed-in partner's saved default terms ("handle compliance once") - fetched once per
   *  mount, independent of which RFP is open, via the browser client per this repo's
   *  preferred data-fetching pattern. */
  useEffect(() => {
    if (isDemoDetail) {
      setDefaultTermsLoaded(true)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        const { data: profile } = await supabase
          .from("profiles")
          .select("default_terms")
          .eq("id", user.id)
          .maybeSingle()
        if (!cancelled && profile?.default_terms) {
          setDefaultTermsFromProfile(withTermsDisclosureDefaults(profile.default_terms))
        }
      } catch (e) {
        console.error("[partner/rfps] default_terms fetch failed", { message: e instanceof Error ? e.message : String(e) })
      } finally {
        if (!cancelled) setDefaultTermsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemoDetail])

  /** Prefills the terms disclosure form once both this RFP's existing bid (if any) and the
   *  partner's saved defaults have loaded. Existing bid data wins; otherwise falls back to
   *  saved defaults, with a legacy payment_terms.deposit_required_pct merged in so editing a
   *  pre-feature bid doesn't ask the vendor to retype data they already gave. Runs once per
   *  RFP (termsHydrated resets on id change above) so it never clobbers in-progress edits. */
  useEffect(() => {
    if (loading || termsHydrated) return
    if (isDemoDetail) {
      setTermsHydrated(true)
      return
    }
    if (!defaultTermsLoaded) return
    if (existing?.terms_disclosure) {
      setTermsDisclosure(withTermsDisclosureDefaults(existing.terms_disclosure))
      setSaveTermsAsDefault(!defaultTermsFromProfile)
    } else {
      const legacyDepositRaw = existing ? parsePaymentTerms(existing.payment_terms).deposit_required_pct : ""
      const legacyDeposit = legacyDepositRaw.trim() !== "" ? Number(legacyDepositRaw) : null
      const base = defaultTermsFromProfile || emptyTermsDisclosure()
      setTermsDisclosure(
        Number.isFinite(legacyDeposit)
          ? mergeLegacyPaymentTermsIntoDisclosure(base, { deposit_required_pct: legacyDeposit })
          : base
      )
      setSaveTermsAsDefault(!defaultTermsFromProfile)
    }
    setTermsHydrated(true)
  }, [loading, isDemoDetail, existing, defaultTermsFromProfile, defaultTermsLoaded, termsHydrated])

  /** No separate awarded-state Submission History branch — it lives under Status & Feedback. Open that tab for terminal outcomes so history is visible (default tab is My Bid). */
  useEffect(() => {
    if (loading || isDemoDetail) return
    const st = existing?.status
    if (st === "awarded" || st === "declined") {
      setActiveTab("status")
    }
  }, [loading, isDemoDetail, existing?.status])

  /** Session + `profiles.role === partner` only — no subscription / plan checks. */
  const ensurePartnerAuth = useCallback(async (): Promise<boolean> => {
    if (isDemoDetail) return true
    const supabase = createClient()
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr) {
      console.error("[partner/rfps] ensurePartnerAuth getUser failed", { message: authErr.message })
      setSubmitError("Could not verify session. Try signing in again.")
      return false
    }
    if (!user) {
      const returnPath =
        typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/partner/rfps"
      router.push(`/auth/login?redirect=${encodeURIComponent(returnPath)}`)
      return false
    }
    const { data: profile, error: profileErr } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).maybeSingle()
    if (profileErr) {
      console.error("[partner/rfps] ensurePartnerAuth profile select failed", {
        userId: user.id,
        message: profileErr.message,
        code: profileErr.code,
      })
      setSubmitError("Could not verify your account. Try again.")
      return false
    }
    const isPartner = profile?.role === "partner" || profile?.active_role === "partner"
    if (!isPartner) {
      setSubmitError("Only partner accounts can submit bid responses. Sign in with a partner profile.")
      return false
    }
    return true
  }, [isDemoDetail, router])

  /** Must run before any early return — same hook order on loading vs loaded. */
  useEffect(() => {
    if (loading || !inbox) return
    const currentStatus =
      existing?.status || (inbox.status === "bid_submitted" ? "submitted" : inbox.status)
    const shouldDefaultToStatus =
      !!existing?.agency_feedback ||
      (Boolean(currentStatus) && !["submitted", "bid_submitted"].includes(currentStatus))
    setActiveTab(shouldDefaultToStatus ? "status" : "bid")
  }, [loading, inbox, existing?.agency_feedback, existing?.status, inbox?.status])

  const save = async (status: "draft" | "submitted") => {
    setSubmitError(null)
    setSuccessMsg(null)
    if (isDemoDetail) {
      if (status === "submitted") {
        const inboxStatus = inbox?.status ?? "new"
        const pre = existing?.status || (inboxStatus === "bid_submitted" ? "submitted" : inboxStatus)
        setBidSubmittedModalIsRevision(["under_review", "shortlisted", "meeting_requested"].includes(pre))
        setBidSubmittedModalOpen(true)
      } else {
        setSuccessMsg("Demo mode - draft not saved.")
      }
      return
    }
    const authOk = await ensurePartnerAuth()
    if (!authOk) return

    const budget_proposal = buildBudgetProposalForSave(
      budgetAmount,
      budgetCurrency,
      budgetCurrencyOther,
      budgetLegacyHint
    )
    const timeline_proposal = buildTimelineProposalForSave(
      timelineDuration,
      timelineUnit,
      timelineLegacyHint
    )

    if (status === "submitted") {
      if (!proposalText.trim()) {
        setSubmitError("Proposal text is required to submit.")
        return
      }
      if (!isBudgetValidForSubmit(budget_proposal)) {
        setSubmitError(
          "Budget: enter a positive amount, choose a currency, and if you pick Other, specify the currency or region."
        )
        return
      }
      if (!isTimelineValidForSubmit(timeline_proposal)) {
        setSubmitError("Timeline: enter a positive duration and choose Days, Weeks, or Months.")
        return
      }
    }

    const termsRequired = inbox?.require_terms_disclosure === true
    // Drafts never block on terms completeness (matches proposal/budget/timeline above,
    // which are also submitted-only checks) - only final submission enforces the
    // requirement, and only when this RFP actually requires disclosure.
    const termsValidation = validateTermsDisclosure(termsDisclosure, status === "submitted" && termsRequired)
    if (status === "submitted" && !termsValidation.ok) {
      setTermsErrors(termsValidation.errors)
      setSubmitError("Please complete the required term disclosures before submitting.")
      return
    }
    setTermsErrors([])
    const terms_disclosure =
      status === "submitted"
        ? (termsValidation as { ok: true; value: TermsDisclosure | null }).value
        : isTermsDisclosureStarted(termsDisclosure)
          ? termsDisclosure
          : null

    setSavingKind(status)
    try {
      const attachments = draftsToPayload(draftAttachments)
      const hasAcknowledgments =
        Object.keys(businessCriteriaAcknowledgments.designations || {}).length > 0 ||
        Object.keys(businessCriteriaAcknowledgments.insurance || {}).length > 0 ||
        businessCriteriaAcknowledgments.coi != null
      const payload = {
        proposal_text: proposalText,
        budget_proposal,
        timeline_proposal,
        terms_disclosure,
        attachments,
        business_criteria_responses: businessCriteriaResponses,
        // Write guard (S4-1): only sent when the vendor actually recorded a cannot-meet
        // reason, so requests shaped like today's never carry this key.
        ...(hasAcknowledgments ? { business_criteria_acknowledgments: businessCriteriaAcknowledgments } : {}),
        status,
        change_notes: changeNotes,
      }
      const res = await fetch(`/api/partner/rfps/${id}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          [data?.error, data?.detail].filter(Boolean).join(" - ") || `Request failed (HTTP ${res.status})`
        throw new Error(msg)
      }
      if (data.response) {
        const row = data.response as ResponseRow
        const vRes = await fetch(`/api/partner/rfps/${id}`, { cache: "no-store", credentials: "same-origin" })
        const vData = await vRes.json().catch(() => ({}))
        if (vRes.ok) {
          setVersions((vData.versions || []) as ResponseVersion[])
        } else {
          console.error("[partner/rfps] refetch versions after save failed", {
            inboxId: id,
            status: vRes.status,
            error: (vData as { error?: string }).error,
          })
        }
        if (status === "submitted") setChangeNotes("")
        setExisting(row)
        const bp = parseBudgetProposal(row.budget_proposal || "")
        setBudgetAmount(bp.amount)
        setBudgetCurrency(bp.currency)
        setBudgetCurrencyOther(bp.customOther)
        setBudgetLegacyHint(bp.legacyHint)
        const tp = parseTimelineProposal(row.timeline_proposal || "")
        setTimelineDuration(tp.duration)
        setTimelineUnit(tp.unit)
        setTimelineLegacyHint(tp.legacyHint)
        if (row.terms_disclosure) setTermsDisclosure(withTermsDisclosureDefaults(row.terms_disclosure))
        const att = Array.isArray(row.attachments) ? row.attachments : []
        setDraftAttachments(att.length > 0 ? savedToDrafts(att as SavedAttachment[]) : [])
      }
      if (status === "submitted") {
        const inboxStatus = inbox?.status ?? "new"
        const preSubmitStatus =
          existing?.status || (inboxStatus === "bid_submitted" ? "submitted" : inboxStatus)
        setBidSubmittedModalIsRevision(
          ["under_review", "shortlisted", "meeting_requested"].includes(preSubmitStatus)
        )
        setBidSubmittedModalOpen(true)
        if (saveTermsAsDefault && terms_disclosure) {
          try {
            const supabase = createClient()
            const {
              data: { user },
            } = await supabase.auth.getUser()
            if (user) {
              const { error: defaultTermsErr } = await supabase
                .from("profiles")
                .update({ default_terms: terms_disclosure })
                .eq("id", user.id)
              if (defaultTermsErr) {
                console.error("[partner/rfps] save default_terms failed", { message: defaultTermsErr.message })
              } else {
                setDefaultTermsFromProfile(withTermsDisclosureDefaults(terms_disclosure))
              }
            }
          } catch (e) {
            console.error("[partner/rfps] save default_terms failed", { message: e instanceof Error ? e.message : String(e) })
          }
        }
      } else {
        setSuccessMsg("Draft saved. You can return anytime to finish and submit.")
      }
      if (status === "submitted" && inbox) {
        setInbox({ ...inbox, status: "bid_submitted" })
        setExisting((prev) => (prev ? { ...prev, status: "submitted" } : prev))
      }
    } catch (e) {
      console.error("[partner/rfps] save error:", e)
      setSubmitError(e instanceof Error ? e.message : "Save failed. Check your connection and try again.")
    } finally {
      setSavingKind(null)
    }
  }

  const onFileForDraft = async (draftId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }
    const authOk = await ensurePartnerAuth()
    if (!authOk) return
    setUploadingId(draftId)
    setSubmitError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("inboxId", id)
      const res = await fetch("/api/partner/rfp-bid/upload", { method: "POST", body: fd })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((result?.error as string) || "Upload failed")
      updateDraft(draftId, {
        storedUrl: result.url as string,
        fileName: (result.filename as string) || file.name,
        urlInput: "",
        source: "file",
      })
    } catch (err) {
      console.error("[partner/rfps] rfp-bid upload failed", {
        inboxId: id,
        draftId,
        message: err instanceof Error ? err.message : String(err),
      })
      setSubmitError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploadingId(null)
      const ref = fileRefs.current[draftId]
      if (ref) ref.value = ""
    }
  }

  if (loading) {
    return (
      <PartnerChrome>
        <div className="max-w-4xl mx-auto py-16 flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-vendor-foreground" />
          <p className="font-mono text-sm text-vendor-muted-strong">Loading RFP…</p>
        </div>
      </PartnerChrome>
    )
  }

  if (error || !inbox) {
    return (
      <PartnerChrome>
        <div className="max-w-4xl mx-auto py-8">
          <Link href="/partner/rfps" className="font-mono text-xs text-vendor-muted hover:text-vendor-foreground mb-6 inline-block">
            ← Back to Open RFPs
          </Link>
          <div className="bg-vendor-surface rounded-xl border border-red-200 p-8 text-red-800">{error || "Not found"}</div>
        </div>
      </PartnerChrome>
    )
  }

  if (ndaGateBlocked && inbox) {
    const ndaLink =
      ((inbox.master_rfp_json || {}) as Record<string, unknown>)?.nda_link?.toString?.() || ""
    return (
      <PartnerChrome>
        <div className="max-w-3xl mx-auto py-8 space-y-5">
          <Link href="/partner/rfps" className="font-mono text-xs text-vendor-muted hover:text-vendor-foreground inline-flex items-center gap-1">
            ← Back to Open RFPs
          </Link>
          <div className="bg-vendor-surface rounded-xl border border-amber-200 p-6">
            <h1 className="font-display font-bold text-2xl text-vendor-foreground">This RFP requires a signed NDA</h1>
            <p className="mt-3 text-sm text-vendor-foreground">
              Sign the NDA document and notify {inbox.agency_company_name || "the agency"} when complete. They will confirm and unlock your access.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={async () => {
                  setNdaNotifyBusy(true)
                  setNdaNotifyMessage(null)
                  try {
                    const res = await fetch(`/api/partner/rfps/${id}/nda-notify`, { method: "POST" })
                    const payload = await res.json().catch(() => ({}))
                    if (!res.ok) throw new Error(payload?.error || "Failed to notify agency")
                    setNdaNotifyMessage("Agency notified. You'll receive an email when your access is confirmed.")
                  } catch (notifyError) {
                    setNdaNotifyMessage(
                      notifyError instanceof Error ? notifyError.message : "Could not notify agency right now."
                    )
                  } finally {
                    setNdaNotifyBusy(false)
                  }
                }}
                disabled={ndaNotifyBusy}
                className="bg-vendor-foreground text-white hover:bg-vendor-foreground/90"
              >
                {ndaNotifyBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                I have signed the NDA - notify the agency
              </Button>
              {ndaLink && (
                <Button variant="outline" asChild>
                  <a href={ndaLink} target="_blank" rel="noreferrer noopener">
                    View NDA
                  </a>
                </Button>
              )}
            </div>
            {ndaNotifyMessage && <p className="mt-4 text-sm text-vendor-foreground">{ndaNotifyMessage}</p>}
          </div>
        </div>
      </PartnerChrome>
    )
  }

  const sentAt = new Date(inbox.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

  const currentStatus = existing?.status || (inbox.status === "bid_submitted" ? "submitted" : inbox.status)
  const showIntentSection = ["pending", "new", "under_review"].includes(currentStatus)
  const canEdit =
    isDemoDetail ||
    ["submitted", "under_review", "shortlisted", "meeting_requested", "draft", "new", "viewed", "bid_submitted", "feedback_received"].includes(
      currentStatus
    )
  const feedbackUpdatedAt = existing?.feedback_updated_at ? new Date(existing.feedback_updated_at).toLocaleString() : null
  const activityTimeline = buildBidTimeline({
    rfpSentAt: inbox.created_at,
    submittedAt: existing?.submitted_at ?? null,
    feedbackAt: existing?.agency_feedback ? existing.feedback_updated_at ?? null : null,
    awardedAt: inbox.awarded_at ?? null,
  })
  const responseDeadlineLabel = formatDeadlineDate(inbox.response_deadline)
  const responseDeadlineSoon = isDeadlineWithin48Hours(inbox.response_deadline)

  const requiredCriteria = normalizeBusinessCriteriaRequired(
    (inbox.master_rfp_json as Record<string, unknown> | null)?.business_criteria_required
  )
  const requiredDesignationKeysForBid = DESIGNATION_KEYS.filter((key) => requiredCriteria.designations[key] === true)
  const requiredInsuranceKeysForBid = INSURANCE_KEYS.filter((key) => requiredCriteria.insurance[key]?.required === true)
  const hasRequiredCriteriaForBid =
    requiredDesignationKeysForBid.length > 0 || requiredInsuranceKeysForBid.length > 0 || requiredCriteria.insurance.coi_on_file
  // Bid-form section order (S4-2): terms disclosure (when required) and the tiered business-criteria
  // block share one "Required by this agency" wrapper so they read as a single section. hasTierData
  // inside BusinessCriteriaRequirementBlock is computed from hasExplicitPriorityData(requiredCriteria),
  // so this mirrors it exactly rather than guessing - keeps the wrapper's own presence/absence in sync
  // with the component's null-render behavior.
  const termsRequired = inbox.require_terms_disclosure === true
  const hasCriteriaTierData = hasExplicitPriorityData(requiredCriteria)
  const hasRequiredSection = termsRequired || hasCriteriaTierData

  const updatePartnerIntent = async (nextIntent: PartnerIntent) => {
    if (isDemoDetail) {
      setPartnerIntent(nextIntent)
      return
    }
    const prevIntent = partnerIntent
    setIntentError(null)
    setPartnerIntent(nextIntent)
    setIsSavingIntent(true)
    try {
      const res = await fetch(`/api/partner/rfps/${id}/intent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ partner_intent: nextIntent }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((payload?.error as string) || "Failed to update intent")
      }
      const updatedInbox = payload?.inbox as { partner_intent?: PartnerIntent | null; intent_set_at?: string | null } | undefined
      if (updatedInbox) {
        setPartnerIntent(updatedInbox.partner_intent || null)
        setInbox((prev) =>
          prev
            ? {
                ...prev,
                partner_intent: updatedInbox.partner_intent || null,
                intent_set_at: updatedInbox.intent_set_at || null,
              }
            : prev
        )
      }
    } catch (e) {
      setPartnerIntent(prevIntent)
      setIntentError(e instanceof Error ? e.message : "Failed to update intent")
    } finally {
      setIsSavingIntent(false)
    }
  }

  return (
    <PartnerChrome>
      <div className="max-w-4xl mx-auto space-y-6 pb-16">
        <Link href="/partner/rfps" className="font-mono text-xs text-vendor-muted hover:text-vendor-foreground inline-flex items-center gap-1">
          ← Back to Open RFPs
        </Link>

        <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <p className="font-mono text-2xs uppercase text-vendor-muted mb-1">Scoped RFP</p>
              <h1 className="font-display font-bold text-2xl text-vendor-foreground">{inbox.scope_item_name}</h1>
              <p className="text-sm text-vendor-muted-strong mt-2 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="w-4 h-4" />
                  {inbox.agency_company_name}
                </span>
                {inbox.client_name && (
                  <>
                    <span className="text-vendor-muted/70">·</span>
                    <span className="text-vendor-muted-strong">Client: {inbox.client_name}</span>
                  </>
                )}
                <span className="text-vendor-muted/70">·</span>
                <span>Sent {sentAt}</span>
              </p>
            </div>
            <span
              className={cn(
                "font-mono text-2xs px-2 py-1 rounded-full uppercase inline-flex items-center gap-1",
                getBidStatusColor(currentStatus)
              )}
            >
              {currentStatus === "meeting_requested" && <CalendarDays className="w-3 h-3" />}
              {getBidStatusLabel(currentStatus, "partner")}
            </span>
          </div>
          {responseDeadlineLabel && (
            <div
              className={cn(
                "mb-4 rounded-lg border px-3 py-2 text-sm font-mono inline-flex items-center gap-2",
                responseDeadlineSoon
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-vendor-border bg-vendor-background text-vendor-foreground"
              )}
            >
              Respond by {responseDeadlineLabel}
            </div>
          )}
          {inbox.scope_item_description && (
            <p className="text-sm text-vendor-foreground leading-relaxed border-t border-vendor-border/50 pt-4">{inbox.scope_item_description}</p>
          )}
          {(inbox.estimated_budget || inbox.timeline) && (
            <div className="grid sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-vendor-border/50">
              {inbox.estimated_budget && (
                <div>
                  <div className="font-mono text-2xs uppercase text-vendor-muted">Estimated budget (scope line)</div>
                  <div className="text-vendor-foreground font-medium">{inbox.estimated_budget}</div>
                </div>
              )}
              {inbox.timeline && (
                <div>
                  <div className="font-mono text-2xs uppercase text-vendor-muted">Timeline (scope line)</div>
                  <div className="text-vendor-foreground font-medium">{inbox.timeline}</div>
                </div>
              )}
            </div>
          )}
          <div
            className="mt-5 pt-4 border-t border-vendor-border/50 -mx-6 px-6 pb-4 border-b border-vendor-border"
            role="tablist"
            aria-label="RFP sections"
          >
            <div className="flex w-full gap-2 sm:gap-3">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "status"}
                onClick={() => setActiveTab("status")}
                className={cn(
                  "flex-1 min-w-0 inline-flex items-center justify-center rounded-md py-2.5 px-2 sm:px-3 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vendor-foreground focus-visible:ring-offset-2",
                  activeTab === "status"
                    ? "bg-vendor-foreground text-white border border-vendor-foreground"
                    : "bg-vendor-surface text-vendor-foreground border border-vendor-border hover:bg-gray-100"
                )}
              >
                Status & Feedback
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "rfp"}
                onClick={() => setActiveTab("rfp")}
                className={cn(
                  "flex-1 min-w-0 inline-flex items-center justify-center rounded-md py-2.5 px-2 sm:px-3 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vendor-foreground focus-visible:ring-offset-2",
                  activeTab === "rfp"
                    ? "bg-vendor-foreground text-white border border-vendor-foreground"
                    : "bg-vendor-surface text-vendor-foreground border border-vendor-border hover:bg-gray-100"
                )}
              >
                RFP Details
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "bid"}
                onClick={() => setActiveTab("bid")}
                className={cn(
                  "flex-1 min-w-0 inline-flex items-center justify-center rounded-md py-2.5 px-2 sm:px-3 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vendor-foreground focus-visible:ring-offset-2",
                  activeTab === "bid"
                    ? "bg-vendor-foreground text-white border border-vendor-foreground"
                    : "bg-vendor-surface text-vendor-foreground border border-vendor-border hover:bg-gray-100"
                )}
              >
                My Bid
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {activeTab === "status" ? (
            <>
              <div className="bg-vendor-surface rounded-xl border border-vendor-border p-5">
                <div className="font-mono text-2xs uppercase text-vendor-muted mb-2">Current status</div>
                <span
                  className={cn(
                    "font-mono text-xs px-3 py-1 rounded-full uppercase inline-flex items-center gap-1",
                    getBidStatusColor(currentStatus)
                  )}
                >
                  {currentStatus === "meeting_requested" && <CalendarDays className="w-3 h-3" />}
                  {getBidStatusLabel(currentStatus, "partner")}
                </span>
              </div>

              {activityTimeline.length > 0 && (
                <div className="bg-vendor-surface rounded-xl border border-vendor-border p-5">
                  <div className="font-mono text-2xs uppercase text-vendor-muted mb-3">Activity</div>
                  <ul className="space-y-2">
                    {activityTimeline.map((entry, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-vendor-foreground">
                        <span className="w-1.5 h-1.5 rounded-full bg-vendor-foreground/60 shrink-0" />
                        <span className="font-medium">{entry.label}</span>
                        <span className="font-mono text-2xs text-vendor-muted">{formatSubmittedAt(entry.iso)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {existing?.agency_feedback && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                  <h3 className="font-display font-bold text-vendor-foreground">Feedback from agency</h3>
                  <p className="text-sm text-vendor-foreground whitespace-pre-wrap mt-2">{existing.agency_feedback}</p>
                  {feedbackUpdatedAt && <p className="font-mono text-2xs text-vendor-muted mt-2">Updated {feedbackUpdatedAt}</p>}
                </div>
              )}
              {currentStatus === "under_review" && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900">
                  The agency has requested changes to your bid. Review their feedback below and resubmit when ready.
                </div>
              )}
              {currentStatus === "meeting_requested" && (
                <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4">
                  <h3 className="font-display font-bold text-cyan-900">Your lead agency has requested a meeting</h3>
                  {inbox.agency_meeting_url ? (
                    <div className="mt-3">
                      <Button className="bg-cyan-600 hover:bg-cyan-600/90 text-white" asChild>
                        <a href={normalizeMeetingUrlForHref(inbox.agency_meeting_url)} target="_blank" rel="noopener noreferrer">
                          <CalendarDays className="w-4 h-4 mr-2" />
                          Schedule meeting
                        </a>
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-cyan-900 mt-2">The agency will be in touch to schedule a meeting.</p>
                  )}
                </div>
              )}
              {currentStatus === "awarded" && (
                <div className="bg-success/15 border border-success/30 rounded-xl p-4 text-success font-medium">
                  Congratulations! Your bid has been awarded.
                </div>
              )}
              {currentStatus === "declined" && (
                <div className="bg-gray-100 border border-vendor-border rounded-xl p-4 text-vendor-foreground">This bid was declined.</div>
              )}

              <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
                <button
                  type="button"
                  className="w-full flex items-center justify-between text-vendor-foreground"
                  onClick={() => setHistoryOpen((prev) => !prev)}
                >
                  <h3 className="font-display font-bold text-lg text-vendor-foreground">Submission history</h3>
                  <span className="text-sm text-vendor-muted-strong">{historyOpen ? "Hide" : "Show"}</span>
                </button>
                {historyOpen && (
                  <div className="mt-4 space-y-3">
                    {versions.length === 0 ? (
                      <p className="text-sm text-vendor-muted-strong">No previous submissions.</p>
                    ) : (
                      versions.map((v) => {
                        const isOriginal = v.version_number === 1
                        const preview =
                          (v.proposal_text || "").length > 100 ? `${v.proposal_text.slice(0, 100)}…` : v.proposal_text || "-"
                        const versionAttachments = Array.isArray(v.attachments) ? v.attachments : []
                        const budgetObj = parseVersionBudgetFields(v.budget_proposal)
                        const timelineObj = parseVersionTimelineFields(v.timeline_proposal)
                        return (
                          <div key={v.id} className="rounded-lg border border-vendor-border bg-vendor-background p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-display font-bold text-vendor-foreground text-base">
                                V{v.version_number} {isOriginal ? "- Original" : ""}
                              </div>
                              <div className="font-mono text-2xs text-vendor-muted">
                                {new Date(v.submitted_at).toLocaleString()}
                              </div>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3 mt-3 text-sm">
                              <div>
                                <div className="font-mono text-2xs uppercase text-vendor-muted">Budget</div>
                                <div className="text-vendor-foreground">
                                  {budgetObj?.amount != null && budgetObj?.currency
                                    ? `${Number(budgetObj.amount).toLocaleString("en-US")} ${budgetObj.currency}`
                                    : "-"}
                                </div>
                              </div>
                              <div>
                                <div className="font-mono text-2xs uppercase text-vendor-muted">Timeline</div>
                                <div className="text-vendor-foreground">
                                  {timelineObj?.duration != null && timelineObj?.unit
                                    ? `${timelineObj.duration} ${timelineObj.unit}`
                                    : "-"}
                                </div>
                              </div>
                            </div>
                            <p className="text-sm text-vendor-foreground mt-3 whitespace-pre-wrap">{preview || "-"}</p>
                            <div className="mt-3">
                              <div className="font-mono text-2xs uppercase text-vendor-muted mb-2">Attachments</div>
                              {versionAttachments.length === 0 ? (
                                <p className="text-sm text-vendor-muted font-mono text-2xs">No attachments</p>
                              ) : (
                                <ul className="space-y-2">
                                  {versionAttachments.map((att, i) => {
                                    const isBlob = isVercelBlobStorageUrl(att.url)
                                    const displayName = isBlob
                                      ? displayFilenameFromBlobUrl(att.url)
                                      : externalLinkLabel(att.url)
                                    const downloadHref = isBlob
                                      ? `/api/partner/blob-download?url=${encodeURIComponent(att.url)}`
                                      : null
                                    return (
                                      <li
                                        key={`${att.url}-${i}`}
                                        className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm border border-vendor-border rounded-lg p-3 bg-vendor-surface"
                                      >
                                        <span className="font-mono text-2xs px-2 py-0.5 rounded bg-gray-100 text-vendor-muted-strong shrink-0">
                                          {att.label}
                                        </span>
                                        <span className="text-vendor-foreground min-w-0 flex-1 truncate" title={displayName}>
                                          {displayName}
                                        </span>
                                        {isBlob && downloadHref ? (
                                          <Button variant="outline" size="sm" className={cn(btnOutlineLight, "shrink-0 h-8")} asChild>
                                            <a href={downloadHref}>
                                              <Download className="w-3.5 h-3.5 mr-1.5" />
                                              Download
                                            </a>
                                          </Button>
                                        ) : (
                                          <Button variant="outline" size="sm" className={cn(btnOutlineLight, "shrink-0 h-8")} asChild>
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
                              )}
                            </div>
                            {v.change_notes && (
                              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                                <div className="font-mono text-2xs uppercase text-amber-800">Change notes</div>
                                <p className="text-sm text-amber-900 whitespace-pre-wrap">{v.change_notes}</p>
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            </>
          ) : activeTab === "rfp" ? (
            <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-vendor-foreground" />
                <h2 className="font-display font-bold text-lg text-vendor-foreground">Master RFP</h2>
              </div>
              <MasterRfpSections json={inbox.master_rfp_json} />
            </div>
          ) : (
            <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6">
          {showIntentSection && (
            <div className="mb-6 rounded-xl border border-vendor-border bg-vendor-background/70 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="font-display font-bold text-sm text-vendor-foreground">Response intent</h3>
                {partnerIntent && (
                  <span className="font-mono text-2xs text-vendor-muted uppercase tracking-wide">
                    {partnerIntentLabel(partnerIntent as PartnerIntent)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: "will_respond" as const, label: "I plan to respond" },
                  { id: "has_questions" as const, label: "I have questions" },
                  { id: "requesting_call" as const, label: "Request a call" },
                ] as const).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-mono transition-colors",
                      partnerIntent === option.id
                        ? "border-vendor-foreground bg-vendor-foreground/10 text-vendor-foreground"
                        : "border-vendor-border bg-vendor-surface text-vendor-foreground hover:bg-gray-100"
                    )}
                    onClick={() => void updatePartnerIntent(option.id)}
                    disabled={isSavingIntent}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {intentError && (
                <p className="mt-3 text-xs text-red-700">{intentError}</p>
              )}
            </div>
          )}
          <h2 className="font-display font-bold text-lg text-vendor-foreground mb-2">Your bid response</h2>
          <p className="text-sm text-vendor-muted-strong mb-6">
              Submit your proposal below. You can save a draft and return later. You may update and re-submit while this bid is submitted, under review, shortlisted, or meeting requested.
          </p>

          {successMsg && (
            <div
              role="status"
              className="mb-4 flex items-start gap-3 text-success bg-success/15 border-2 border-success/30 rounded-xl px-4 py-3 text-sm shadow-sm"
            >
              <CheckCircle className="w-5 h-5 shrink-0 text-success mt-0.5" />
              <span className="leading-relaxed font-medium">{successMsg}</span>
            </div>
          )}
          {submitError && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{submitError}</div>
          )}

          {canEdit ? (
          <div className="space-y-5">
            <div>
              <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">Proposal *</label>
              <Textarea
                value={proposalText}
                onChange={(e) => setProposalText(e.target.value)}
                placeholder="Your pitch, approach, and how you’ll deliver this scope…"
                className={textareaClass}
                disabled={!canEdit}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">Budget proposal *</label>
                <div className="flex flex-wrap gap-2 items-center">
                  <CurrencyInput
                    value={budgetAmount}
                    onChange={(raw) => {
                      setBudgetAmount(raw)
                      if (budgetLegacyHint) setBudgetLegacyHint(null)
                    }}
                    placeholder="$0"
                    className={cn(inputClass, "min-w-[120px] flex-1 sm:max-w-[200px]")}
                    disabled={!canEdit}
                  />
                  <select
                    value={budgetCurrency}
                    onChange={(e) => {
                      setBudgetCurrency(e.target.value)
                      if (budgetLegacyHint) setBudgetLegacyHint(null)
                    }}
                    disabled={!canEdit}
                    className={cn(inputClass, "h-10 rounded-md text-sm w-[min(100%,140px)]")}
                  >
                    {BUDGET_CURRENCY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                {budgetCurrency === "Other" && (
                  <Input
                    value={budgetCurrencyOther}
                    onChange={(e) => setBudgetCurrencyOther(e.target.value)}
                    placeholder="Specify currency (e.g. CHF, INR)"
                    className={cn(inputClass, "mt-2")}
                    disabled={!canEdit}
                  />
                )}
                {budgetLegacyHint && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5 mt-2">
                    Previous value (edit above to replace): <span className="font-mono">{budgetLegacyHint}</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">Timeline proposal *</label>
                <div className="flex flex-wrap gap-2 items-center">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={timelineDuration}
                    onChange={(e) => {
                      setTimelineDuration(e.target.value)
                      if (timelineLegacyHint) setTimelineLegacyHint(null)
                    }}
                    placeholder="Duration"
                    className={cn(inputClass, "min-w-[100px] flex-1 sm:max-w-[160px]")}
                    disabled={!canEdit}
                  />
                  <select
                    value={timelineUnit}
                    onChange={(e) => {
                      setTimelineUnit(e.target.value as "Days" | "Weeks" | "Months")
                      if (timelineLegacyHint) setTimelineLegacyHint(null)
                    }}
                    disabled={!canEdit}
                    className={cn(inputClass, "h-10 rounded-md text-sm w-[min(100%,140px)]")}
                  >
                    {TIMELINE_UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                {timelineLegacyHint && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5 mt-2">
                    Previous value (edit above to replace): <span className="font-mono">{timelineLegacyHint}</span>
                  </p>
                )}
              </div>
            </div>

            {/* S4-2: term disclosures (when required) and the tiered required/preferred criteria
                block are grouped under one "Required by this agency" heading so they read as a
                single section. Nothing renders here at all when neither applies - no empty box,
                no orphaned heading. When terms aren't required, TermsDisclosureSection still
                renders in the same relative slot (unwrapped, its own optional "+ Add your terms"
                affordance), exactly as before reordering. */}
            {!termsRequired && (
              <TermsDisclosureSection
                value={termsDisclosure}
                onChange={setTermsDisclosure}
                required={false}
                theme="light"
                errors={termsErrors}
                disabled={!canEdit}
                showSaveDefaultOption
                saveAsDefault={saveTermsAsDefault}
                onSaveAsDefaultChange={setSaveTermsAsDefault}
              />
            )}

            {hasRequiredSection && (
              <div className="space-y-4">
                <h3 className="font-display font-bold text-sm text-vendor-foreground">Required by this agency</h3>
                {termsRequired && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-900">
                    This agency requires basic term disclosures with your bid.
                  </div>
                )}
                {termsRequired && (
                  <TermsDisclosureSection
                    value={termsDisclosure}
                    onChange={setTermsDisclosure}
                    required={termsRequired}
                    theme="light"
                    errors={termsErrors}
                    disabled={!canEdit}
                    showSaveDefaultOption
                    saveAsDefault={saveTermsAsDefault}
                    onSaveAsDefaultChange={setSaveTermsAsDefault}
                  />
                )}

                {/* S4-1: RFPs with explicit requirement-tier data get the new required/preferred
                    block (renders required-then-preferred internally); RFPs authored before tiers
                    existed (hasExplicitPriorityData false) fall through to the legacy untiered
                    block below, unchanged. */}
                {hasCriteriaTierData && (
                  <BusinessCriteriaRequirementBlock
                    required={requiredCriteria}
                    responses={businessCriteriaResponses}
                    acknowledgments={businessCriteriaAcknowledgments}
                    onUpdateDesignation={updateBusinessCriteriaDesignation}
                    onUpdateInsurance={updateBusinessCriteriaInsurance}
                    onUpdateCoi={updateBusinessCriteriaCoi}
                    onSetAcknowledgment={setBusinessCriteriaAcknowledgment}
                    onConfirmAll={confirmAllRequiredCriteria}
                    canEdit={canEdit}
                    profileHolds={profileCriteriaHolds}
                  />
                )}
              </div>
            )}

            {hasRequiredCriteriaForBid && !hasCriteriaTierData && (
              <div className="rounded-xl border border-vendor-border bg-vendor-background/70 p-4">
                <h3 className="font-display font-bold text-sm text-vendor-foreground mb-1">Business criteria</h3>
                <p className="text-xs text-vendor-muted-strong mb-3">
                  This RFP requires confirmation of the following. Confirm what applies to your company.
                </p>
                {requiredCriteria.notes.trim() && (
                  <p className="text-xs text-vendor-muted-strong mb-3 whitespace-pre-wrap">{requiredCriteria.notes}</p>
                )}

                {requiredDesignationKeysForBid.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {requiredDesignationKeysForBid.map((key) => {
                      const designation = businessCriteriaResponses.designations[key]
                      return (
                        <div key={key} className="rounded-lg border border-vendor-border bg-vendor-surface p-3">
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={designation.holds}
                              disabled={!canEdit}
                              onChange={(e) => updateBusinessCriteriaDesignation(key, { holds: e.target.checked })}
                              className="mt-0.5 w-4 h-4 rounded border-vendor-border"
                            />
                            <HelpTerm term={key} theme="light" className="font-display font-bold text-sm text-vendor-foreground">
                              {DESIGNATION_LABELS[key]}
                            </HelpTerm>
                          </label>
                          {designation.holds && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pl-7">
                              <Input
                                value={designation.certifying_body || ""}
                                onChange={(e) =>
                                  updateBusinessCriteriaDesignation(key, { certifying_body: e.target.value || null })
                                }
                                placeholder="Certifying body (e.g. NMSDC, WBENC)"
                                className={inputClass}
                                disabled={!canEdit || designation.self_certified}
                              />
                              <Input
                                value={designation.certification_number || ""}
                                onChange={(e) =>
                                  updateBusinessCriteriaDesignation(key, {
                                    certification_number: e.target.value || null,
                                  })
                                }
                                placeholder="Certification number"
                                className={inputClass}
                                disabled={!canEdit || designation.self_certified}
                              />
                              <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={designation.self_certified}
                                  disabled={!canEdit}
                                  onChange={(e) =>
                                    updateBusinessCriteriaDesignation(key, {
                                      self_certified: e.target.checked,
                                      ...(e.target.checked
                                        ? { certifying_body: null, certification_number: null }
                                        : {}),
                                    })
                                  }
                                  className="w-4 h-4 rounded border-vendor-border"
                                />
                                <span className="text-sm text-vendor-foreground">Self-certified (no third-party certification)</span>
                              </label>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {requiredInsuranceKeysForBid.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {requiredInsuranceKeysForBid.map((key) => {
                      const coverage = businessCriteriaResponses.insurance[key]
                      const minimum = requiredCriteria.insurance[key]?.minimum
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-4 p-3 rounded-lg border border-vendor-border bg-vendor-surface"
                        >
                          <label className="flex items-center gap-3 min-w-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={coverage.has_coverage}
                              disabled={!canEdit}
                              onChange={(e) => updateBusinessCriteriaInsurance(key, { has_coverage: e.target.checked })}
                              className="w-4 h-4 rounded border-vendor-border"
                            />
                            <span className="font-display font-bold text-sm text-vendor-foreground truncate">
                              <HelpTerm term={key} theme="light">{INSURANCE_LABELS[key]}</HelpTerm>
                              {minimum ? ` (min. ${minimum})` : ""}
                            </span>
                          </label>
                          <Input
                            value={coverage.limit || ""}
                            onChange={(e) => updateBusinessCriteriaInsurance(key, { limit: e.target.value || null })}
                            placeholder="Your limit, e.g. $1M/$2M"
                            disabled={!canEdit}
                            className={cn(inputClass, "w-44 shrink-0")}
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
                      disabled={!canEdit}
                      onChange={(e) => updateBusinessCriteriaCoi(e.target.checked)}
                      className="w-4 h-4 rounded border-vendor-border"
                    />
                    <span className="text-sm text-vendor-foreground">
                      <HelpTerm term="coi" theme="light">Certificate of Insurance (COI)</HelpTerm> on file
                    </span>
                  </label>
                )}
              </div>
            )}

            <div className="border border-vendor-border rounded-xl p-4 bg-vendor-background/80">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-display font-bold text-sm text-vendor-foreground">Attachments</h3>
                  <p className="text-xs text-vendor-muted-strong mt-0.5">Up to 6 - link or file (PDF, PPTX, DOCX) per row.</p>
                </div>
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={btnOutlineLight}
                    disabled={draftAttachments.length >= 6}
                    onClick={() => addDraft()}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add attachment
                  </Button>
                )}
              </div>

              {draftAttachments.length === 0 && (
                <p className="text-sm text-vendor-muted mb-2">No attachments yet. Add one to include portfolio links or documents.</p>
              )}

              <div className="space-y-4">
                {draftAttachments.map((d) => (
                  <div key={d.id} className="rounded-lg border border-vendor-border bg-vendor-surface p-4 space-y-3">
                    <div className="flex flex-wrap gap-3 items-start justify-between">
                      <div className="flex flex-wrap gap-2 items-center flex-1 min-w-[200px]">
                        <label className="font-mono text-2xs text-vendor-muted uppercase shrink-0">Label</label>
                        <select
                          value={d.tag}
                          onChange={(e) =>
                            updateDraft(d.id, { tag: e.target.value as AttachmentTag, otherLabel: e.target.value === "other" ? d.otherLabel : "" })
                          }
                          disabled={!canEdit}
                          className={cn(inputClass, "h-9 rounded-md text-sm max-w-[220px]")}
                        >
                          {TAG_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {d.tag === "other" && (
                          <Input
                            value={d.otherLabel}
                            onChange={(e) => updateDraft(d.id, { otherLabel: e.target.value })}
                            placeholder="Describe this attachment"
                            className={cn(inputClass, "flex-1 min-w-[160px]")}
                            disabled={!canEdit}
                          />
                        )}
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => removeDraft(d.id)}
                          className="text-vendor-muted hover:text-red-600 p-1"
                          aria-label="Remove attachment"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          updateDraft(d.id, {
                            source: "url",
                            fileName: null,
                            storedUrl: d.source === "file" ? null : d.storedUrl,
                          })
                        }}
                        disabled={!canEdit}
                        className={cn(
                          "font-mono text-xs px-3 py-1.5 rounded-lg border transition-colors bg-vendor-surface",
                          d.source === "url"
                            ? "border-vendor-foreground bg-vendor-foreground/10 text-vendor-foreground font-medium"
                            : "border-vendor-border text-vendor-foreground"
                        )}
                      >
                        <LinkIcon className="w-3.5 h-3.5 inline mr-1" />
                        Paste URL
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          updateDraft(d.id, { source: "file", urlInput: "", storedUrl: null })
                        }}
                        disabled={!canEdit}
                        className={cn(
                          "font-mono text-xs px-3 py-1.5 rounded-lg border transition-colors bg-vendor-surface",
                          d.source === "file"
                            ? "border-vendor-foreground bg-vendor-foreground/10 text-vendor-foreground font-medium"
                            : "border-vendor-border text-vendor-foreground"
                        )}
                      >
                        <Upload className="w-3.5 h-3.5 inline mr-1" />
                        Upload file
                      </button>
                    </div>

                    {d.source === "url" && (
                      <div>
                        <label className="block font-mono text-2xs text-vendor-muted uppercase mb-1">URL</label>
                        <Input
                          value={d.urlInput}
                          onChange={(e) => updateDraft(d.id, { urlInput: e.target.value, storedUrl: null })}
                          placeholder="https://…"
                          className={inputClass}
                          disabled={!canEdit}
                        />
                      </div>
                    )}

                    {d.source === "file" && (
                      <div>
                        <input
                          id={`partner-rfp-file-${d.id}`}
                          ref={(el) => {
                            fileRefs.current[d.id] = el
                          }}
                          type="file"
                          accept=".pdf,.pptx,.docx"
                          className="sr-only"
                          onChange={(e) => void onFileForDraft(d.id, e)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className={btnOutlineLight}
                          disabled={!canEdit || uploadingId === d.id}
                          onClick={() => {
                            const refEl = fileRefs.current[d.id]
                            const byId =
                              typeof document !== "undefined"
                                ? (document.getElementById(`partner-rfp-file-${d.id}`) as HTMLInputElement | null)
                                : null
                            ;(refEl ?? byId)?.click()
                          }}
                        >
                          {uploadingId === d.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Choose file
                            </>
                          )}
                        </Button>
                        {d.storedUrl && d.source === "file" && (
                          <span className="ml-3 inline-flex items-center gap-2 text-sm text-success">
                            <CheckCircle className="w-4 h-4 shrink-0 text-success" aria-hidden />
                            <span>
                              <span className="font-medium text-vendor-foreground">{d.fileName || "Uploaded file"}</span>
                              <span className="text-vendor-muted-strong ml-1.5">Uploaded</span>
                            </span>
                          </span>
                        )}
                      </div>
                    )}

                    {d.storedUrl && d.source === "url" && !isLikelyPrivateBlobUrl(d.storedUrl) && (
                      <p className="font-mono text-2xs text-vendor-muted-strong">
                        Saved link:{" "}
                        <a href={d.storedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 break-all">
                          {d.storedUrl}
                        </a>
                      </p>
                    )}
                    {d.storedUrl && d.source === "url" && isLikelyPrivateBlobUrl(d.storedUrl) && (
                      <div className="flex items-center gap-2 text-sm text-success mt-1">
                        <CheckCircle className="w-4 h-4 shrink-0 text-success" aria-hidden />
                        <span>
                          <span className="font-medium text-vendor-foreground">
                            {d.fileName || displayNameFromBlobPath(d.storedUrl)}
                          </span>
                          <span className="text-vendor-muted-strong ml-1.5">Uploaded</span>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          ) : (
            (() => {
              const budgetObj = parseVersionBudgetFields(
                existing?.budget_proposal ?? buildBudgetProposalForSave(budgetAmount, budgetCurrency, budgetCurrencyOther, budgetLegacyHint)
              )
              const timelineObj = parseVersionTimelineFields(
                existing?.timeline_proposal ?? buildTimelineProposalForSave(timelineDuration, timelineUnit, timelineLegacyHint)
              )
              return (
                <div className="rounded-lg border border-vendor-border bg-vendor-background p-4 space-y-3">
                  <div>
                    <div className="font-mono text-2xs uppercase text-vendor-muted">Proposal</div>
                    <p className="text-sm text-vendor-foreground whitespace-pre-wrap mt-1">{proposalText || "-"}</p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 mt-3 text-sm">
                    <div>
                      <div className="font-mono text-2xs uppercase text-vendor-muted">Budget</div>
                      <div className="text-vendor-foreground">
                        {budgetObj?.amount != null && budgetObj?.currency
                          ? `${Number(budgetObj.amount).toLocaleString("en-US")} ${budgetObj.currency}`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="font-mono text-2xs uppercase text-vendor-muted">Timeline</div>
                      <div className="text-vendor-foreground">
                        {timelineObj?.duration != null && timelineObj?.unit
                          ? `${timelineObj.duration} ${timelineObj.unit}`
                          : "-"}
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-vendor-foreground">This bid is read-only in its current state.</p>
                </div>
              )
            })()
          )}

          {canEdit ? (
            <div className="flex flex-wrap justify-end gap-3 mt-8 pt-6 border-t border-vendor-border">
              {canEdit && (
                <div className="w-full">
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Change notes (optional)
                  </label>
                  <Textarea
                    value={changeNotes}
                    onChange={(e) => setChangeNotes(e.target.value)}
                    placeholder="Briefly describe what you updated in this version..."
                    className={cn(fieldClass, "min-h-[90px]")}
                    disabled={savingKind !== null}
                  />
                </div>
              )}
              {/* No wrapping <form> on this page; type=&quot;button&quot; avoids accidental document submit if a parent ever adds a form. */}
              <Button
                type="button"
                variant="outline"
                className={btnOutlineLight}
                disabled={savingKind !== null}
                onClick={() => {
                  void save("draft")
                }}
              >
                {savingKind === "draft" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save draft"
                )}
              </Button>
              <Button
                type="button"
                variant="default"
                className={btnPrimaryDark}
                disabled={savingKind !== null}
                onClick={() => {
                  void save("submitted")
                }}
              >
                {savingKind === "submitted" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    {["under_review", "shortlisted", "meeting_requested"].includes(currentStatus)
                      ? "Resubmit with Changes"
                      : "Submit response"}
                  </>
                )}
              </Button>
            </div>
          ) : null}
            </div>
          )}
        </div>
      </div>

      {bidSubmittedModalOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={() => setBidSubmittedModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bid-submitted-title"
            className="w-full max-w-md rounded-xl border-2 border-success/30 bg-vendor-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 border border-success/30">
                <CheckCircle className="h-8 w-8 text-success" aria-hidden />
              </div>
            </div>
            <h2 id="bid-submitted-title" className="font-display text-center text-xl font-bold text-vendor-foreground">
              Bid Submitted Successfully
            </h2>
            <p className="mt-3 text-center text-sm text-vendor-foreground leading-relaxed">
              {bidSubmittedModalIsRevision ? (
                "Your updated bid has been submitted."
              ) : (
                <>
                  Your response was submitted successfully. The lead agency will see it under RFP Broadcast → Vendor
                  responses.
                </>
              )}
            </p>
            {isDemoDetail ? (
              <p className="mt-2 text-center text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Demo mode - this response was not saved to the server.
              </p>
            ) : null}
            <Button
              type="button"
              className="mt-6 w-full bg-vendor-foreground text-white hover:bg-vendor-foreground/90"
              onClick={() => setBidSubmittedModalOpen(false)}
            >
              Got it
            </Button>
          </div>
        </div>
      ) : null}
    </PartnerChrome>
  )
}
