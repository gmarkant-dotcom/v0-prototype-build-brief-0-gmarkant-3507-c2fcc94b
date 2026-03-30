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

  const { checkFeatureAccess } = usePaidUser()
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const [loading, setLoading] = useState(!isDemoDetail)
  const [error, setError] = useState<string | null>(null)
  const [inbox, setInbox] = useState<InboxRow | null>(
    isDemoDetail ? { ...demoInbox, id } : null
  )
  const [existing, setExisting] = useState<ResponseRow | null>(null)

  const [proposalText, setProposalText] = useState("")
  const [budgetProposal, setBudgetProposal] = useState("")
  const [timelineProposal, setTimelineProposal] = useState("")
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([])
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
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
            setBudgetProposal(r.budget_proposal || "")
            setTimelineProposal(r.timeline_proposal || "")
            const att = Array.isArray(r.attachments) ? r.attachments : []
            setDraftAttachments(att.length > 0 ? savedToDrafts(att as SavedAttachment[]) : [])
          } else {
            setExisting(null)
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

  const save = async (status: "draft" | "submitted") => {
    setSubmitError(null)
    setSuccessMsg(null)
    if (isDemoDetail) {
      setSuccessMsg(status === "submitted" ? "Demo mode — response not saved." : "Demo mode — draft not saved.")
      return
    }
    if (status === "submitted" && !checkFeatureAccess()) return
    if (status === "draft" && !checkFeatureAccess()) return
    setSaving(true)
    try {
      const attachments = draftsToPayload(draftAttachments)
      const res = await fetch(`/api/partner/rfps/${id}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_text: proposalText,
          budget_proposal: budgetProposal,
          timeline_proposal: timelineProposal,
          attachments,
          status,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data?.error as string) || "Save failed")
      if (data.response) setExisting(data.response as ResponseRow)
      setSuccessMsg(status === "submitted" ? "Response submitted." : "Draft saved.")
      if (status === "submitted" && inbox) setInbox({ ...inbox, status: "bid_submitted" })
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const onFileForDraft = async (draftId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!checkFeatureAccess("file uploads")) return
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
            <div className="mb-4 flex items-center gap-2 text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
              <CheckCircle className="w-4 h-4 shrink-0" />
              {successMsg}
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
                <Input
                  value={budgetProposal}
                  onChange={(e) => setBudgetProposal(e.target.value)}
                  placeholder="e.g. 95000 or $85k–$100k"
                  className={inputClass}
                  disabled={!canEdit}
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Timeline proposal *</label>
                <Input
                  value={timelineProposal}
                  onChange={(e) => setTimelineProposal(e.target.value)}
                  placeholder="e.g. 6 weeks from kickoff"
                  className={inputClass}
                  disabled={!canEdit}
                />
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
                    className="border-gray-300 text-[#0C3535]"
                    disabled={draftAttachments.length >= 6}
                    onClick={addDraft}
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
                          onClick={() => removeDraft(d.id)}
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
                        onClick={() =>
                          updateDraft(d.id, {
                            source: "url",
                            fileName: null,
                            storedUrl: d.source === "file" ? null : d.storedUrl,
                          })
                        }
                        disabled={!canEdit}
                        className={cn(
                          "font-mono text-xs px-3 py-1.5 rounded-lg border transition-colors",
                          d.source === "url" ? "border-[#0C3535] bg-[#0C3535]/5 text-[#0C3535]" : "border-gray-200 text-gray-600"
                        )}
                      >
                        <LinkIcon className="w-3.5 h-3.5 inline mr-1" />
                        Paste URL
                      </button>
                      <button
                        type="button"
                        onClick={() => updateDraft(d.id, { source: "file", urlInput: "", storedUrl: null })}
                        disabled={!canEdit}
                        className={cn(
                          "font-mono text-xs px-3 py-1.5 rounded-lg border transition-colors",
                          d.source === "file" ? "border-[#0C3535] bg-[#0C3535]/5 text-[#0C3535]" : "border-gray-200 text-gray-600"
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
                          className="border-gray-300 text-[#0C3535]"
                          disabled={!canEdit || uploadingId === d.id}
                          onClick={() => fileRefs.current[d.id]?.click()}
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
              <Button type="button" variant="outline" className="border-gray-300 text-[#0C3535]" disabled={saving} onClick={() => void save("draft")}>
                Save draft
              </Button>
              <Button
                type="button"
                className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white font-display font-bold"
                disabled={saving}
                onClick={() => void save("submitted")}
              >
                <Send className="w-4 h-4 mr-2" />
                Submit response
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
