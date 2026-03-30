"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { PartnerLayout } from "@/components/partner-layout"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { LeadAgencyFilter } from "@/components/lead-agency-filter"
import { ChevronRight, Loader2 } from "lucide-react"

type RFP = {
  id: string
  title: string
  overview: string
  scope: string[]
  requirements: string
  timeline: string
  deadline: string
  issuedBy: string
  status:
    | "new"
    | "viewed"
    | "bid_submitted"
    | "feedback_received"
    | "revision_submitted"
    | "shortlisted"
    | "awarded"
    | "declined"
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
  scope_item_id: string
  scope_item_name: string
  scope_item_description: string | null
  master_rfp_json: Record<string, unknown> | null
  agency_company_name: string | null
  timeline: string | null
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

  const allowed: RFP["status"][] = [
    "new",
    "viewed",
    "bid_submitted",
    "feedback_received",
    "shortlisted",
    "awarded",
    "declined",
  ]
  const st = allowed.includes(row.status as RFP["status"]) ? (row.status as RFP["status"]) : "new"

  return {
    id: row.id,
    title: `${row.scope_item_name} — ${projectName}`,
    overview,
    scope,
    requirements,
    timeline: row.timeline?.trim() || mj.timeline?.trim() || "TBD",
    deadline: "TBD",
    issuedBy: row.agency_company_name?.trim() || "Lead agency",
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
    "all" | "new" | "bid_submitted" | "feedback_received" | "shortlisted"
  >("all")

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

  const filteredRfps = rfps.filter((rfp) => {
    if (activeFilter === "all") return true
    return rfp.status === activeFilter
  })

  const getStatusColor = (status: RFP["status"]) => {
    switch (status) {
      case "new": return "bg-[#C8F53C] text-[#0C3535]"
      case "viewed": return "bg-gray-100 text-gray-600"
      case "bid_submitted": return "bg-blue-100 text-blue-700"
      case "feedback_received": return "bg-orange-100 text-orange-700"
      case "revision_submitted": return "bg-purple-100 text-purple-700"
      case "shortlisted": return "bg-green-100 text-green-700"
      case "awarded": return "bg-green-500 text-white"
      case "declined": return "bg-gray-200 text-gray-700"
      default: return "bg-gray-100 text-gray-600"
    }
  }
  
  
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
          {(["all", "new", "bid_submitted", "feedback_received", "shortlisted"] as const).map((filter) => (
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
              {filter === "all" ? `All RFPs (${rfps.length})` : `${filter.replace(/_/g, " ")} (${rfps.filter(r => r.status === filter).length})`}
            </button>
          ))}
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
          ) : filteredRfps.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-500">
                {rfps.length === 0
                  ? "No RFP invitations yet. When a lead agency broadcasts a scoped RFP to you, it will appear here."
                  : "No RFPs match the selected filter."}
              </p>
            </div>
          ) : filteredRfps.map((rfp) => (
            <Link
              key={rfp.id}
              href={`/partner/rfps/${encodeURIComponent(rfp.id)}`}
              className={cn(
                "block bg-white rounded-xl border p-6 hover:border-[#0C3535]/40 transition-colors cursor-pointer group",
                rfp.status === "feedback_received" ? "border-orange-200" : "border-gray-200"
              )}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={cn("font-mono text-[10px] px-2 py-0.5 rounded-full uppercase", getStatusColor(rfp.status))}>
                      {rfp.status.replace(/_/g, " ")}
                    </span>
                    <span className="font-mono text-[10px] text-gray-500">Deadline: {rfp.deadline}</span>
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
