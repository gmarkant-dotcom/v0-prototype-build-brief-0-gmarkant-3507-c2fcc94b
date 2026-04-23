"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { PartnerLayout } from "@/components/partner-layout"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { getBidStatusColor, getBidStatusLabel } from "@/lib/bid-status"
import { LeadAgencyFilter } from "@/components/lead-agency-filter"
import { ChevronRight, Loader2, CalendarDays } from "lucide-react"

function ensureAbsoluteUrl(url: string) {
  if (!url) return url
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  return `https://${url}`
}

type RFP = {
  id: string
  title: string
  overview: string
  scope: string[]
  requirements: string
  timeline: string
  deadline: string
  issuedBy: string
  meetingUrl?: string | null
  sentAt?: string | null
  createdAt?: string | null
  responseDeadline?: string | null
  partnerIntent?: "will_respond" | "has_questions" | "requesting_call" | null
  viewedAt?: string | null
  status:
    | "submitted"
    | "under_review"
    | "shortlisted"
    | "meeting_requested"
    | "awarded"
    | "declined"
    | "new"
    | "viewed"
    | "bid_submitted"
    | "feedback_received"
    | "revision_submitted"
}

function formatTimelineDateLabel(value?: string | null): string | null {
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

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoRFPs: RFP[] = [
  {
    id: "1",
    title: "Video Production Partner — Sports Creator Series",
    overview: "A boutique creative agency is seeking a video production partner for a 6-month documentary-style creator content program centered on women's professional soccer. The ideal partner brings sports content experience, creator collaboration skills, and nimble production capabilities.",
    scope: [
      "Pre-production planning and creative development",
      "On-location production for 8-12 shoot days",
      "Post-production including editing, color, and sound",
      "Delivery of assets optimized for social platforms",
      "Ongoing collaboration with internal creative team",
    ],
    requirements: "Dedicated producer and director, DP with sports/documentary experience, editor with quick turnaround capability, flexibility for last-minute schedule changes.",
    timeline: "Program duration: 6 months. First deliverables due within 6 weeks of kickoff. Rolling delivery schedule throughout program.",
    deadline: "8 days",
    issuedBy: "LIGAMENT on behalf of a brand client",
    status: "feedback_received",
  },
  {
    id: "2",
    title: "Documentary Series — Tech Startup Profile",
    overview: "Seeking an experienced documentary production team for a 3-part series profiling innovative tech startups. The series will explore company culture, founder journeys, and product development processes.",
    scope: [
      "Story development and treatment creation",
      "Principal photography (3 companies, 2-3 days each)",
      "Interview filming and b-roll capture",
      "Post-production for 3x 8-10 minute episodes",
      "Color grading and sound mixing",
    ],
    requirements: "Documentary experience required, interview expertise preferred, ability to work with limited crew in office environments.",
    timeline: "3-month production schedule. Filming to begin within 4 weeks of award.",
    deadline: "12 days",
    issuedBy: "LIGAMENT on behalf of a brand client",
    status: "new",
  },
  {
    id: "3",
    title: "Social Media Content — Product Launch",
    overview: "Fast-paced social content creation for a major product launch. Need quick-turn video and photo assets for TikTok, Instagram, and YouTube Shorts.",
    scope: [
      "Concept development for 20+ social assets",
      "2 shoot days for product and lifestyle content",
      "Rapid post-production with 24-48 hour turnarounds",
      "Platform-specific optimization",
    ],
    requirements: "Social-native creative team, fast turnaround capability, experience with product launches.",
    timeline: "2-week sprint. Must be available to start within 5 days of award.",
    deadline: "3 days",
    issuedBy: "LIGAMENT on behalf of a brand client",
    status: "shortlisted",
  },
]

type PartnerInboxRow = {
  id: string
  status: string
  response_status?: string | null
  effective_status?: string | null
  scope_item_id: string
  scope_item_name: string
  scope_item_description: string | null
  master_rfp_json: Record<string, unknown> | null
  agency_company_name: string | null
  timeline: string | null
  agency_feedback?: string | null
  feedback_updated_at?: string | null
  agency_meeting_url?: string | null
  created_at?: string | null
  response_deadline?: string | null
  partner_intent?: "will_respond" | "has_questions" | "requesting_call" | null
  viewed_at?: string | null
}

function partnerIntentTag(intent?: "will_respond" | "has_questions" | "requesting_call" | null): string | null {
  if (!intent) return null
  if (intent === "will_respond") return "Plans to respond"
  if (intent === "has_questions") return "Has questions"
  return "Requested call"
}

function mapInboxRowToRfp(row: PartnerInboxRow): RFP {
  const mj = (row.master_rfp_json || {}) as {
    projectName?: string
    overview?: string
    timeline?: string
    scopeItems?: { id?: string; name?: string; description?: string }[]
  }
  const projectName = mj.projectName?.trim() || "RFP"
  const match = (mj.scopeItems || []).find((s) => s.id === row.scope_item_id)
  const overview = mj.overview?.trim() || row.scope_item_description?.trim() || ""
  const scope: string[] = [row.scope_item_name]
  if (row.scope_item_description?.trim()) scope.push(row.scope_item_description.trim())
  else if (match?.description?.trim()) scope.push(match.description.trim())

  const requirements =
    match?.description?.trim() || row.scope_item_description?.trim() || ""

  const preferred = row.response_status || row.effective_status || row.status
  const allowed: RFP["status"][] = [
    "submitted",
    "under_review",
    "shortlisted",
    "meeting_requested",
    "awarded",
    "declined",
    "new",
    "viewed",
    "bid_submitted",
    "feedback_received",
    "revision_submitted",
  ]
  const st = allowed.includes(preferred as RFP["status"]) ? (preferred as RFP["status"]) : "new"

  return {
    id: row.id,
    title: `${row.scope_item_name} — ${projectName}`,
    overview,
    scope,
    requirements,
    timeline: row.timeline?.trim() || mj.timeline?.trim() || "TBD",
    deadline: "TBD",
    issuedBy: row.agency_company_name?.trim() || "Lead agency",
    meetingUrl: row.agency_meeting_url || null,
    sentAt: row.created_at || null,
    createdAt: row.created_at || null,
    responseDeadline: row.response_deadline || null,
    partnerIntent: row.partner_intent || null,
    viewedAt: row.viewed_at || null,
    status: st,
  }
}

export default function PartnerRFPsPage() {
  const isDemo = isDemoMode()
  const initialRFPs = isDemo ? demoRFPs : []
  
  const [rfps, setRfps] = useState(initialRFPs)
  const [inboxLoading, setInboxLoading] = useState(false)
  const [inboxError, setInboxError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<
    "all" | "submitted" | "under_review" | "shortlisted" | "meeting_requested" | "awarded" | "declined"
  >("all")
  const [viewFilter, setViewFilter] = useState<"all" | "unviewed" | "recent">("all")
  const statusFilters: Array<
    "all" | "submitted" | "under_review" | "shortlisted" | "meeting_requested" | "awarded" | "declined"
  > = ["all", "submitted", "under_review", "shortlisted", "meeting_requested", "awarded", "declined"]

  useEffect(() => {
    if (isDemo) return
    let cancelled = false
    ;(async () => {
      setInboxLoading(true)
      setInboxError(null)
      try {
        const res = await fetch("/api/partner/rfps", {
          cache: "no-store",
          credentials: "same-origin",
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data?.error as string) || "Could not load RFPs")
        const rows = (data.rfps || []) as PartnerInboxRow[]
        if (!cancelled) {
          setRfps(rows.map(mapInboxRowToRfp))
        }
      } catch (e) {
        if (!cancelled) {
          setInboxError(e instanceof Error ? e.message : "Could not load RFPs")
          setRfps([])
        }
      } finally {
        if (!cancelled) setInboxLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo])

  const displayedRfps = useMemo(() => {
    let list = [...rfps]
    if (viewFilter === "unviewed") {
      list = list.filter((rfp) => !rfp.viewedAt)
    }
    list.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })
    return list.filter((rfp) => {
      if (activeFilter === "all") return true
      return rfp.status === activeFilter
    })
  }, [rfps, viewFilter, activeFilter])

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display font-bold text-3xl text-[#0C3535]">Open RFPs</h1>
            <p className="text-gray-600 mt-1">
              Review and respond to RFP opportunities from your network.
            </p>
          </div>
          <LeadAgencyFilter />
        </div>
        
        {/* Status Filter */}
        <div className="flex gap-2">
          {statusFilters.map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={cn(
                "px-3 py-1.5 rounded-lg font-mono text-xs capitalize transition-colors",
                activeFilter === filter 
                  ? "bg-[#0C3535] text-white" 
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {filter === "all"
                ? `All RFPs (${rfps.length})`
                : `${getBidStatusLabel(filter, "partner")} (${rfps.filter((r) => r.status === filter).length})`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-gray-500">View</span>
          <select
            value={viewFilter}
            onChange={(e) => setViewFilter(e.target.value as "all" | "unviewed" | "recent")}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-[#0C3535]"
          >
            <option value="all">All RFPs</option>
            <option value="unviewed">New — not yet viewed</option>
            <option value="recent">Recently received</option>
          </select>
        </div>
        
        <div className="grid gap-4">
          {inboxLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 flex flex-col items-center justify-center gap-3 text-gray-600">
              <Loader2 className="w-8 h-8 animate-spin text-[#0C3535]" />
              <p className="font-mono text-sm">Loading RFPs…</p>
            </div>
          ) : inboxError ? (
            <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
              <p className="text-red-700">{inboxError}</p>
            </div>
          ) : displayedRfps.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-500">
                {rfps.length === 0
                  ? "No RFP invitations yet. When a lead agency broadcasts a scoped RFP to you, it will appear here."
                  : "No RFPs match the selected filter."}
              </p>
            </div>
          ) : displayedRfps.map((rfp) => (
            <Link
              key={rfp.id}
              href={`/partner/rfps/${encodeURIComponent(rfp.id)}`}
              onClick={() => {
                setRfps((prev) =>
                  prev.map((item) =>
                    item.id === rfp.id && !item.viewedAt
                      ? { ...item, viewedAt: new Date().toISOString() }
                      : item
                  )
                )
              }}
              className={cn(
                "block bg-white rounded-xl border p-6 hover:border-[#0C3535]/40 transition-colors cursor-pointer group",
                rfp.status === "feedback_received" ? "border-orange-200" : "border-gray-200",
                rfp.status === "shortlisted" && "border-purple-300 bg-purple-50/30",
                rfp.status === "awarded" && "border-green-300 bg-green-50/40"
              )}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {rfp.status === "meeting_requested" && rfp.meetingUrl ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          window.open(ensureAbsoluteUrl(rfp.meetingUrl || ""), "_blank", "noopener,noreferrer")
                        }}
                        className={cn(
                          "font-mono text-[10px] px-2 py-0.5 rounded-full uppercase inline-flex items-center gap-1 hover:opacity-90",
                          getBidStatusColor(rfp.status)
                        )}
                        title="Open scheduling link"
                      >
                        <CalendarDays className="w-3 h-3" />
                        {getBidStatusLabel(rfp.status, "partner")}
                      </button>
                    ) : (
                      <span
                        className={cn(
                          "font-mono text-[10px] px-2 py-0.5 rounded-full uppercase inline-flex items-center gap-1",
                          getBidStatusColor(rfp.status)
                        )}
                      >
                        {rfp.status === "meeting_requested" && <CalendarDays className="w-3 h-3" />}
                        {getBidStatusLabel(rfp.status, "partner")}
                      </span>
                    )}
                    {(() => {
                      const sentLabel = formatTimelineDateLabel(rfp.sentAt)
                      const dueLabel = formatTimelineDateLabel(rfp.responseDeadline)
                      if (!sentLabel && !dueLabel) {
                        if (rfp.deadline && rfp.deadline !== "TBD") {
                          return (
                            <span className="font-mono text-[10px] text-gray-500">
                              Deadline: {rfp.deadline}
                            </span>
                          )
                        }
                        return null
                      }
                      return (
                        <div className="flex items-center gap-2 flex-wrap">
                          {sentLabel && (
                            <span className="font-mono text-[10px] text-gray-500">Sent {sentLabel}</span>
                          )}
                          {dueLabel && (
                            <span
                              className={cn(
                                "font-mono text-[10px]",
                                isDeadlineWithin48Hours(rfp.responseDeadline)
                                  ? "text-amber-700 bg-amber-100/80 px-1.5 py-0.5 rounded"
                                  : "text-gray-500"
                              )}
                            >
                              Respond by {dueLabel}
                            </span>
                          )}
                        </div>
                      )
                    })()}
                    {partnerIntentTag(rfp.partnerIntent) && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {partnerIntentTag(rfp.partnerIntent)}
                      </span>
                    )}
                    {!rfp.viewedAt && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#0C3535] text-white">
                        NEW
                      </span>
                    )}
                  </div>
                  <h3 className="font-display font-bold text-xl text-[#0C3535] group-hover:underline">
                    {rfp.title}
                  </h3>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-[#0C3535] shrink-0" />
              </div>

              <p className="text-sm text-gray-600 mb-4 line-clamp-2">{rfp.overview}</p>

              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <span className="font-mono text-[10px] text-gray-500">Issued by {rfp.issuedBy}</span>
                <span className="font-mono text-xs text-[#0C3535] font-medium">Open RFP →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </PartnerLayout>
  )
}
