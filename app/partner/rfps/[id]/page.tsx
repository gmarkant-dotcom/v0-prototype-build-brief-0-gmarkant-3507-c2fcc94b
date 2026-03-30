"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { usePaidUser } from "@/contexts/paid-user-context"
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
} from "lucide-react"

/** Readable text on white cards (defaults are transparent / light in dark theme). */
const fieldClass =
  "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 shadow-sm focus-visible:ring-[#0C3535]/30 focus-visible:border-[#0C3535]"
const textareaClass = cn(fieldClass, "min-h-[140px]")
const inputClass = fieldClass

/** Shadcn outline uses bg-background (#0C3535); pairing with text-[#0C3535] made label text invisible on partner light pages. */
const btnOutlineLight =
  "border-gray-300 !bg-white text-[#0C3535] shadow-sm hover:!bg-gray-50 hover:text-[#0C3535]"
const btnPrimaryDark =
  "!bg-[#0C3535] !text-white hover:!bg-[#0C3535]/90 font-display font-bold border-transparent"

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
  status: string
  created_at: string
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

type SavedAttachment = { type: string; label: string; url: string }

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

function savedToDrafts(saved: SavedAttachment[]): DraftAttachment[] {
  return saved.map((a) => {
    const tag = (ALLOWED.has(a.type as AttachmentTag) ? a.type : "proposal") as AttachmentTag
    return {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random()}`,
      tag,
      otherLabel: tag === "other" ? a.label : "",
      source: "url" as const,
      urlInput: a.url,
      storedUrl: a.url,
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
  attachments: SavedAttachment[] | null
  status: string
  updated_at: string
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

function MasterRfpSections({ json }: { json: Record<string, unknown> | null }) {
  if (!json || typeof json !== "object") {
    return <p className="text-sm text-gray-500">No master RFP content available.</p>
  }
  const projectName = typeof json.projectName === "string" ? json.projectName : ""
  const client = typeof json.client === "string" ? json.client : ""
  const overview = typeof json.overview === "string" ? json.overview : ""
  const objectives = Array.isArray(json.objectives) ? json.objectives.filter((x) => typeof x === "string") : []
  const totalBudget = typeof json.totalBudget === "string" ? json.totalBudget : ""
  const timeline = typeof json.timeline === "string" ? json.timeline : ""
  const scopeItems = Array.isArray(json.scopeItems) ? json.scopeItems : []

  return (
    <div className="space-y-6 text-sm text-gray-700">
      <div>
        <h4 className="font-display font-bold text-[#0C3535] mb-1">Project</h4>
        <p>{projectName || "—"}</p>
        {client && <p className="text-gray-600 mt-1">Client: {client}</p>}
      </div>
      {overview && (
        <div>
          <h4 className="font-display font-bold text-[#0C3535] mb-1">Overview</h4>
          <p className="leading-relaxed whitespace-pre-wrap">{overview}</p>
        </div>
      )}
      {objectives.length > 0 && (
        <div>
          <h4 className="font-display font-bold text-[#0C3535] mb-2">Objectives</h4>
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
              <DollarSign className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-mono text-[10px] uppercase text-gray-500">Program budget (master)</div>
                <div>{totalBudget}</div>
              </div>
            </div>
          )}
          {timeline && (
            <div className="flex gap-2 items-start">
              <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-mono text-[10px] uppercase text-gray-500">Timeline (master)</div>
                <div>{timeline}</div>
              </div>
            </div>
          )}
        </div>
      )}
      {scopeItems.length > 0 && (
        <div>
          <h4 className="font-display font-bold text-[#0C3535] mb-2">All scope items (master RFP)</h4>
          <ul className="space-y-3">
            {scopeItems.map((item: unknown, i: number) => {
              const s = item as { name?: string; description?: string; estimatedBudget?: string; timeline?: string }
              return (
                <li key={i} className="border border-gray-100 rounded-lg p-3 bg-gray-50/80">
                  <div className="font-medium text-[#0C3535]">{s.name || `Item ${i + 1}`}</div>
                  {s.description && <p className="text-gray-600 mt-1">{s.description}</p>}
                  <div className="font-mono text-[10px] text-gray-500 mt-2 flex flex-wrap gap-3">
                    {s.estimatedBudget && <span>Budget: {s.estimatedBudget}</span>}
                    {s.timeline && <span>Timeline: {s.timeline}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
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
  const id = typeof params?.id === "string" ? params.id : ""
  const isDemo = isDemoMode()
  const demoIds = ["1", "2", "3"]
  const isDemoDetail = isDemo && demoIds.includes(id)

  const { checkFeatureAccess, isLoading: accessLoading } = usePaidUser()
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
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([])
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [savingKind, setSavingKind] = useState<null | "draft" | "submitted">(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const updateDraft = useCallback((draftId: string, patch: Partial<DraftAttachment>) => {
    setDraftAttachments((prev) => prev.map((d) => (d.id === draftId ? { ...d, ...patch } : d)))
  }, [])

  const removeDraft = useCallback((draftId: string) => {
    setDraftAttachments((prev) => prev.filter((d) => d.id !== draftId))
  }, [])

  const addDraft = useCallback(() => {
    setDraftAttachments((prev) => (prev.length >= 6 ? prev : [...prev, newDraft()]))
  }, [])

  useEffect(() => {
    if (isDemoDetail) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/partner/rfps/${id}`, { cache: "no-store", credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data?.error as string) || "Could not load RFP")
        if (!cancelled) {
          setInbox(data.inbox as InboxRow)
          const r = data.response as ResponseRow | null
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
          }
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
  }, [id, isDemoDetail])

  useEffect(() => {
    const submittedNow = existing?.status === "submitted" || inbox?.status === "bid_submitted"
    const canEditNow = !submittedNow || isDemoDetail
    console.log("[partner/rfps/detail] trace state", {
      accessLoading,
      savingKind,
      canEdit: canEditNow,
      submitted: submittedNow,
      inboxStatus: inbox?.status,
      responseStatus: existing?.status,
      isDemoDetail,
      id,
    })
  }, [accessLoading, savingKind, existing, inbox, isDemoDetail, id])

  const save = async (status: "draft" | "submitted") => {
    console.log("[partner/rfps/detail] save() entered", {
      status,
      accessLoading,
      isDemoDetail,
      savingKindBefore: savingKind,
    })
    setSubmitError(null)
    setSuccessMsg(null)
    if (isDemoDetail) {
      console.log("[partner/rfps/detail] save() exit: demo detail (no network)")
      setSuccessMsg(status === "submitted" ? "Demo mode — response not saved." : "Demo mode — draft not saved.")
      return
    }
    // Do not block on accessLoading — PaidUserContext already allows actions while loading; server enforces auth.
    const feature = status === "submitted" ? "submit bid response" : "save draft"
    const allowed = checkFeatureAccess(feature)
    console.log("[partner/rfps/detail] save() after checkFeatureAccess", { allowed, feature, accessLoading })
    if (!allowed) {
      setSubmitError(
        "This action isn’t available on your current plan. If an upgrade dialog opened, use that — otherwise refresh the page or contact support."
      )
      return
    }

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
        console.log("[partner/rfps/detail] save() exit: validation proposal")
        setSubmitError("Proposal text is required to submit.")
        return
      }
      if (!isBudgetValidForSubmit(budget_proposal)) {
        console.log("[partner/rfps/detail] save() exit: validation budget", { budget_proposal })
        setSubmitError(
          "Budget: enter a positive amount, choose a currency, and if you pick Other, specify the currency or region."
        )
        return
      }
      if (!isTimelineValidForSubmit(timeline_proposal)) {
        console.log("[partner/rfps/detail] save() exit: validation timeline", { timeline_proposal })
        setSubmitError("Timeline: enter a positive duration and choose Days, Weeks, or Months.")
        return
      }
    }

    console.log("[partner/rfps/detail] save() calling fetch…", { id, status })
    setSavingKind(status)
    try {
      const attachments = draftsToPayload(draftAttachments)
      const payload = {
        proposal_text: proposalText,
        budget_proposal,
        timeline_proposal,
        attachments,
        status,
      }
      console.log("[partner/rfps] POST /response", { inboxId: id, status, attachmentCount: attachments.length })
      const res = await fetch(`/api/partner/rfps/${id}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      console.log("[partner/rfps] response status", res.status, data)
      if (!res.ok) {
        const msg =
          [data?.error, data?.detail].filter(Boolean).join(" — ") || `Request failed (HTTP ${res.status})`
        throw new Error(msg)
      }
      if (data.response) {
        const row = data.response as ResponseRow
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
        const att = Array.isArray(row.attachments) ? row.attachments : []
        setDraftAttachments(att.length > 0 ? savedToDrafts(att as SavedAttachment[]) : [])
      }
      setSuccessMsg(
        status === "submitted"
          ? "Your response was submitted successfully. The lead agency will see it under RFP Broadcast → Partner responses."
          : "Draft saved. You can return anytime to finish and submit."
      )
      if (status === "submitted" && inbox) {
        setInbox({ ...inbox, status: "bid_submitted" })
      }
    } catch (e) {
      console.error("[partner/rfps] save error:", e)
      setSubmitError(e instanceof Error ? e.message : "Save failed. Check your connection and try again.")
    } finally {
      setSavingKind(null)
    }
  }

  const onFileForDraft = async (draftId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    console.log("[partner/rfps/detail] onFileForDraft() entered", {
      draftId,
      fileCount: e.target.files?.length ?? 0,
      accessLoading,
    })
    const file = e.target.files?.[0]
    if (!file) {
      console.log("[partner/rfps/detail] onFileForDraft() exit: no file")
      return
    }
    const uploadAllowed = checkFeatureAccess("file uploads")
    console.log("[partner/rfps/detail] onFileForDraft after checkFeatureAccess", { uploadAllowed, accessLoading })
    if (!uploadAllowed) {
      setSubmitError("File uploads aren’t available on your current plan. Check the upgrade dialog or contact support.")
      return
    }
    setUploadingId(draftId)
    setSubmitError(null)
    try {
      console.log("[partner/rfps/detail] onFileForDraft fetch POST /api/partner/rfp-bid/upload", { draftId, inboxId: id })
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
      setSubmitError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploadingId(null)
      const ref = fileRefs.current[draftId]
      if (ref) ref.value = ""
    }
  }

  if (loading) {
    return (
      <PartnerLayout>
        <div className="max-w-4xl mx-auto py-16 flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#0C3535]" />
          <p className="font-mono text-sm text-gray-600">Loading RFP…</p>
        </div>
      </PartnerLayout>
    )
  }

  if (error || !inbox) {
    return (
      <PartnerLayout>
        <div className="max-w-4xl mx-auto py-8">
          <Link href="/partner/rfps" className="font-mono text-xs text-gray-500 hover:text-[#0C3535] mb-6 inline-block">
            ← Back to Open RFPs
          </Link>
          <div className="bg-white rounded-xl border border-red-200 p-8 text-red-800">{error || "Not found"}</div>
        </div>
      </PartnerLayout>
    )
  }

  const sentAt = new Date(inbox.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

  const submitted = existing?.status === "submitted" || inbox.status === "bid_submitted"
  const canEdit = !submitted || isDemoDetail

  return (
    <PartnerLayout>
      <div className="max-w-4xl mx-auto space-y-6 pb-16">
        <Link href="/partner/rfps" className="font-mono text-xs text-gray-500 hover:text-[#0C3535] inline-flex items-center gap-1">
          ← Back to Open RFPs
        </Link>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div>
              <p className="font-mono text-[10px] uppercase text-gray-500 mb-1">Scoped RFP</p>
              <h1 className="font-display font-bold text-2xl text-[#0C3535]">{inbox.scope_item_name}</h1>
              <p className="text-sm text-gray-600 mt-2 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="w-4 h-4" />
                  {inbox.agency_company_name}
                </span>
                <span className="text-gray-400">·</span>
                <span>Sent {sentAt}</span>
              </p>
            </div>
            <span
              className={cn(
                "font-mono text-[10px] px-2 py-1 rounded-full uppercase",
                submitted ? "bg-blue-100 text-blue-800" : "bg-[#C8F53C] text-[#0C3535]"
              )}
            >
              {submitted ? "Bid submitted" : inbox.status.replace(/_/g, " ")}
            </span>
          </div>
          {inbox.scope_item_description && (
            <p className="text-sm text-gray-700 leading-relaxed border-t border-gray-100 pt-4">{inbox.scope_item_description}</p>
          )}
          {(inbox.estimated_budget || inbox.timeline) && (
            <div className="grid sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
              {inbox.estimated_budget && (
                <div>
                  <div className="font-mono text-[10px] uppercase text-gray-500">Estimated budget (scope line)</div>
                  <div className="text-[#0C3535] font-medium">{inbox.estimated_budget}</div>
                </div>
              )}
              {inbox.timeline && (
                <div>
                  <div className="font-mono text-[10px] uppercase text-gray-500">Timeline (scope line)</div>
                  <div className="text-[#0C3535] font-medium">{inbox.timeline}</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-[#0C3535]" />
            <h2 className="font-display font-bold text-lg text-[#0C3535]">Master RFP</h2>
          </div>
          <MasterRfpSections json={inbox.master_rfp_json} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-2">Your bid response</h2>
          <p className="text-sm text-gray-600 mb-6">
            Submit your proposal below. You can save a draft and return later. Submitting locks in your response for the lead agency.
          </p>

          {successMsg && (
            <div
              role="status"
              className="mb-4 flex items-start gap-3 text-green-900 bg-green-50 border-2 border-green-300 rounded-xl px-4 py-3 text-sm shadow-sm"
            >
              <CheckCircle className="w-5 h-5 shrink-0 text-green-700 mt-0.5" />
              <span className="leading-relaxed font-medium">{successMsg}</span>
            </div>
          )}
          {submitError && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{submitError}</div>
          )}

          <div className="space-y-5">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Proposal *</label>
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
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Budget proposal *</label>
                <div className="flex flex-wrap gap-2 items-center">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={budgetAmount}
                    onChange={(e) => {
                      setBudgetAmount(e.target.value)
                      if (budgetLegacyHint) setBudgetLegacyHint(null)
                    }}
                    placeholder="Amount"
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
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Timeline proposal *</label>
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

            <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/80">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-display font-bold text-sm text-[#0C3535]">Attachments</h3>
                  <p className="text-xs text-gray-600 mt-0.5">Up to 6 — link or file (PDF, PPTX, DOCX) per row.</p>
                </div>
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={btnOutlineLight}
                    disabled={draftAttachments.length >= 6}
                    onClick={() => {
                      console.log("[partner/rfps/detail] click: Add attachment button")
                      addDraft()
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add attachment
                  </Button>
                )}
              </div>

              {draftAttachments.length === 0 && (
                <p className="text-sm text-gray-500 mb-2">No attachments yet. Add one to include portfolio links or documents.</p>
              )}

              <div className="space-y-4">
                {draftAttachments.map((d) => (
                  <div key={d.id} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                    <div className="flex flex-wrap gap-3 items-start justify-between">
                      <div className="flex flex-wrap gap-2 items-center flex-1 min-w-[200px]">
                        <label className="font-mono text-[10px] text-gray-500 uppercase shrink-0">Label</label>
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
                          onClick={() => {
                            console.log("[partner/rfps/detail] click: Remove row", d.id)
                            removeDraft(d.id)
                          }}
                          className="text-gray-500 hover:text-red-600 p-1"
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
                          console.log("[partner/rfps/detail] click: Paste URL mode", d.id)
                          updateDraft(d.id, {
                            source: "url",
                            fileName: null,
                            storedUrl: d.source === "file" ? null : d.storedUrl,
                          })
                        }}
                        disabled={!canEdit}
                        className={cn(
                          "font-mono text-xs px-3 py-1.5 rounded-lg border transition-colors bg-white",
                          d.source === "url"
                            ? "border-[#0C3535] bg-[#0C3535]/10 text-[#0C3535] font-medium"
                            : "border-gray-300 text-[#0C3535]"
                        )}
                      >
                        <LinkIcon className="w-3.5 h-3.5 inline mr-1" />
                        Paste URL
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          console.log("[partner/rfps/detail] click: Upload file mode toggle", d.id)
                          updateDraft(d.id, { source: "file", urlInput: "", storedUrl: null })
                        }}
                        disabled={!canEdit}
                        className={cn(
                          "font-mono text-xs px-3 py-1.5 rounded-lg border transition-colors bg-white",
                          d.source === "file"
                            ? "border-[#0C3535] bg-[#0C3535]/10 text-[#0C3535] font-medium"
                            : "border-gray-300 text-[#0C3535]"
                        )}
                      >
                        <Upload className="w-3.5 h-3.5 inline mr-1" />
                        Upload file
                      </button>
                    </div>

                    {d.source === "url" && (
                      <div>
                        <label className="block font-mono text-[10px] text-gray-500 uppercase mb-1">URL</label>
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
                          accept=".pdf,.pptx,.ppt,.docx,.doc"
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
                            console.log("[partner/rfps/detail] click: Choose file", {
                              draftId: d.id,
                              hasRef: !!refEl,
                              hasById: !!byId,
                            })
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
                          <span className="ml-3 font-mono text-xs text-gray-700">
                            {d.fileName || "Uploaded"} —{" "}
                            <a href={d.storedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                              Open link
                            </a>
                          </span>
                        )}
                      </div>
                    )}

                    {d.storedUrl && d.source === "url" && (
                      <p className="font-mono text-[10px] text-gray-600">
                        Saved URL:{" "}
                        <a href={d.storedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 break-all">
                          {d.storedUrl}
                        </a>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {canEdit ? (
            <div className="flex flex-wrap justify-end gap-3 mt-8 pt-6 border-t border-gray-200">
              {/* No wrapping <form> on this page; type=&quot;button&quot; avoids accidental document submit if a parent ever adds a form. */}
              <Button
                type="button"
                variant="outline"
                className={btnOutlineLight}
                disabled={savingKind !== null}
                onClick={() => {
                  console.log("[partner/rfps/detail] click: Save draft", { disabled: savingKind !== null })
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
                  console.log("[partner/rfps/detail] click: Submit response", { disabled: savingKind !== null })
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
                    Submit response
                  </>
                )}
              </Button>
            </div>
          ) : (
            <p className="mt-8 pt-6 border-t border-gray-200 text-sm text-gray-600">
              You’ve submitted a response for this RFP. The lead agency has been notified.
            </p>
          )}
        </div>
      </div>
    </PartnerLayout>
  )
}
