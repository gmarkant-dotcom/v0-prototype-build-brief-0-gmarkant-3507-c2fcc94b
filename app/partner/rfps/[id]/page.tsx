"use client"

import { useEffect, useState, useRef } from "react"
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
  Link2,
  CheckCircle,
} from "lucide-react"

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

type ResponseRow = {
  id: string
  proposal_text: string
  budget_proposal: string
  timeline_proposal: string
  work_example_urls: string[] | null
  proposal_document_url: string | null
  proposal_deck_link: string | null
  status: string
  updated_at: string
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
  const fileRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(!isDemoDetail)
  const [error, setError] = useState<string | null>(null)
  const [inbox, setInbox] = useState<InboxRow | null>(
    isDemoDetail ? { ...demoInbox, id } : null
  )
  const [existing, setExisting] = useState<ResponseRow | null>(null)

  const [proposalText, setProposalText] = useState("")
  const [budgetProposal, setBudgetProposal] = useState("")
  const [timelineProposal, setTimelineProposal] = useState("")
  const [url1, setUrl1] = useState("")
  const [url2, setUrl2] = useState("")
  const [url3, setUrl3] = useState("")
  const [deckLink, setDeckLink] = useState("")
  const [docUrl, setDocUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

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
            const urls = r.work_example_urls || []
            setUrl1(urls[0] || "")
            setUrl2(urls[1] || "")
            setUrl3(urls[2] || "")
            setDeckLink(r.proposal_deck_link || "")
            setDocUrl(r.proposal_document_url || null)
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

  const workUrls = () => [url1, url2, url3].map((u) => u.trim()).filter(Boolean)

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
      const res = await fetch(`/api/partner/rfps/${id}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_text: proposalText,
          budget_proposal: budgetProposal,
          timeline_proposal: timelineProposal,
          work_example_urls: workUrls(),
          proposal_document_url: docUrl,
          proposal_deck_link: deckLink.trim() || null,
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

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!checkFeatureAccess("file uploads")) return
    setUploading(true)
    setSubmitError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("folder", "partner-rfp-submissions")
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      if (!res.ok) throw new Error("Upload failed")
      const result = await res.json()
      setDocUrl(result.url as string)
    } catch {
      setSubmitError("Upload failed")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
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
                className="min-h-[140px] border-gray-200"
                disabled={submitted && !isDemoDetail}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Budget proposal *</label>
                <Input
                  value={budgetProposal}
                  onChange={(e) => setBudgetProposal(e.target.value)}
                  placeholder="e.g. 95000 or $85k–$100k"
                  className="border-gray-200"
                  disabled={submitted && !isDemoDetail}
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Timeline proposal *</label>
                <Input
                  value={timelineProposal}
                  onChange={(e) => setTimelineProposal(e.target.value)}
                  placeholder="e.g. 6 weeks from kickoff"
                  className="border-gray-200"
                  disabled={submitted && !isDemoDetail}
                />
              </div>
            </div>
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Work examples (up to 3 URLs)</label>
              <div className="space-y-2">
                <Input value={url1} onChange={(e) => setUrl1(e.target.value)} placeholder="https://…" className="border-gray-200" disabled={submitted && !isDemoDetail} />
                <Input value={url2} onChange={(e) => setUrl2(e.target.value)} placeholder="https://…" className="border-gray-200" disabled={submitted && !isDemoDetail} />
                <Input value={url3} onChange={(e) => setUrl3(e.target.value)} placeholder="https://…" className="border-gray-200" disabled={submitted && !isDemoDetail} />
              </div>
            </div>
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Proposal PDF</label>
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="sr-only" onChange={onFile} />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="border-gray-300"
                  disabled={uploading || (submitted && !isDemoDetail)}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  Upload file
                </Button>
                {docUrl && (
                  <a href={docUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-blue-700 underline truncate max-w-[200px]">
                    View uploaded
                  </a>
                )}
              </div>
            </div>
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                Deck / doc link (optional)
              </label>
              <Input
                value={deckLink}
                onChange={(e) => setDeckLink(e.target.value)}
                placeholder="Google Slides, Dropbox, Frame.io…"
                className="border-gray-200"
                disabled={submitted && !isDemoDetail}
              />
            </div>
          </div>

          {!submitted || isDemoDetail ? (
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
