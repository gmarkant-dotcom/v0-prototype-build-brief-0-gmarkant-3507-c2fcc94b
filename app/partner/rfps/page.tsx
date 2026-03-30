"use client"

import { useState, useRef, useEffect } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { EmptyState } from "@/components/empty-state"
import { usePaidUser } from "@/contexts/paid-user-context"
import { useLeadAgencyFilter } from "@/contexts/lead-agency-filter-context"
import { LeadAgencyFilter } from "@/components/lead-agency-filter"
import { 
  MessageSquare, 
  Send, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Upload, 
  FileText, 
  History, 
  Paperclip,
  X,
  Download,
  Loader2,
  Building2
} from "lucide-react"

type FeedbackItem = {
  id: string
  type: "question" | "revision_request" | "clarification"
  category: "budget" | "timeline" | "team" | "scope" | "general"
  message: string
  sentAt: string
  sentBy: string
  response?: {
    message: string
    respondedAt: string
    attachments?: { name: string; type: string }[]
  }
}

type BidVersion = {
  version: number
  submittedAt: string
  changes: string[]
  amount: string
  status: "submitted" | "under_review" | "revision_requested"
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
  status:
    | "new"
    | "viewed"
    | "bid_submitted"
    | "feedback_received"
    | "revision_submitted"
    | "shortlisted"
    | "awarded"
    | "declined"
  feedback: FeedbackItem[]
  bidVersions: BidVersion[]
  currentBidVersion?: number
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
    feedback: [
      {
        id: "fb1",
        type: "clarification",
        category: "team",
        message: "Can you provide more detail on the team structure? We'd like to know who specifically will be the day-to-day contact and if you have backup coverage for key roles.",
        sentAt: "Mar 15, 2024 2:30 PM",
        sentBy: "Sarah Chen (Electric Animal)",
      },
      {
        id: "fb2",
        type: "revision_request",
        category: "budget",
        message: "The equipment line item seems high for the scope. Can you break down the specific gear and explain the rental vs. ownership costs?",
        sentAt: "Mar 15, 2024 2:35 PM",
        sentBy: "Sarah Chen (Electric Animal)",
      },
    ],
    bidVersions: [
      { version: 1, submittedAt: "Mar 14, 2024", changes: ["Initial submission"], amount: "$97,000", status: "revision_requested" }
    ],
    currentBidVersion: 1,
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
    feedback: [],
    bidVersions: [],
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
    feedback: [],
    bidVersions: [
      { version: 1, submittedAt: "Mar 10, 2024", changes: ["Initial submission"], amount: "$28,000", status: "under_review" }
    ],
    currentBidVersion: 1,
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
    feedback: [],
    bidVersions: [],
  }
}

export default function PartnerRFPsPage() {
  const isDemo = isDemoMode()
  const initialRFPs = isDemo ? demoRFPs : []
  const { checkFeatureAccess } = usePaidUser()
  
  const [rfps, setRfps] = useState(initialRFPs)
  const [inboxLoading, setInboxLoading] = useState(false)
  const [inboxError, setInboxError] = useState<string | null>(null)
  const [selectedRFP, setSelectedRFP] = useState<RFP | null>(null)
  const [activeView, setActiveView] = useState<"details" | "bid" | "feedback">("details")
  const [formData, setFormData] = useState({
    approach: "",
    team: "",
    timeline: "",
    budget: "",
  })
  const [responseMessage, setResponseMessage] = useState("")
  const [responseAttachments, setResponseAttachments] = useState<{ name: string; type: string; url?: string }[]>([])
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [activeFilter, setActiveFilter] = useState<"all" | "new" | "feedback_received" | "shortlisted">("all")
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({})

  useEffect(() => {
    if (isDemo) return
    let cancelled = false
    ;(async () => {
      setInboxLoading(true)
      setInboxError(null)
      try {
        const res = await fetch("/api/partner/rfps")
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

  const handleFileUpload = async (file: File, docType?: string) => {
    setIsUploadingFile(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", "partner-rfp-submissions")

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) throw new Error("Upload failed")
      const result = await response.json()
      
      if (docType) {
        // Document type upload (Budget, Timeline, etc.)
        setResponseAttachments(prev => [...prev, { 
          name: `${docType}: ${file.name}`, 
          type: file.name.split('.').pop() || 'file',
          url: result.url 
        }])
      } else {
        // General attachment upload
        setResponseAttachments(prev => [...prev, { 
          name: file.name, 
          type: file.name.split('.').pop() || 'file',
          url: result.url 
        }])
      }
    } catch (error) {
      console.error("Upload error:", error)
      alert("Upload failed. Please try again.")
    } finally {
      setIsUploadingFile(false)
    }
  }
  
  const filteredRfps = rfps.filter(rfp => {
    if (activeFilter === "all") return true
    return rfp.status === activeFilter
  })
  
  const handleSubmitBid = (e: React.FormEvent, isRevision: boolean = false) => {
    e.preventDefault()
    if (!selectedRFP) return
    if (!checkFeatureAccess()) return
    
    const newVersion: BidVersion = {
      version: isRevision ? (selectedRFP.currentBidVersion || 0) + 1 : 1,
      submittedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      changes: isRevision ? ["Addressed feedback", "Updated budget breakdown", "Added team details"] : ["Initial submission"],
      amount: formData.budget,
      status: "submitted"
    }
    
    setRfps(prev => prev.map(rfp => 
      rfp.id === selectedRFP.id 
        ? { 
            ...rfp, 
            status: isRevision ? "revision_submitted" as const : "bid_submitted" as const,
            bidVersions: [...rfp.bidVersions, newVersion],
            currentBidVersion: newVersion.version
          } 
        : rfp
    ))
    
    setSelectedRFP(prev => prev ? {
      ...prev,
      status: isRevision ? "revision_submitted" : "bid_submitted",
      bidVersions: [...prev.bidVersions, newVersion],
      currentBidVersion: newVersion.version
    } : null)
    
    setActiveView("details")
    setFormData({ approach: "", team: "", timeline: "", budget: "" })
  }
  
  const handleSubmitFeedbackResponse = (feedbackId: string) => {
    if (!selectedRFP || !responseMessage.trim()) return
    if (!checkFeatureAccess()) return
    
    const response = {
      message: responseMessage,
      respondedAt: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
      attachments: responseAttachments.length > 0 ? responseAttachments : undefined
    }
    
    setRfps(prev => prev.map(rfp => 
      rfp.id === selectedRFP.id 
        ? { 
            ...rfp, 
            feedback: rfp.feedback.map(fb => 
              fb.id === feedbackId ? { ...fb, response } : fb
            )
          } 
        : rfp
    ))
    
    setSelectedRFP(prev => prev ? {
      ...prev,
      feedback: prev.feedback.map(fb => 
        fb.id === feedbackId ? { ...fb, response } : fb
      )
    } : null)
    
    setResponseMessage("")
    setResponseAttachments([])
  }
  
  const handleBackToList = () => {
    setSelectedRFP(null)
    setActiveView("details")
    setFormData({ approach: "", team: "", timeline: "", budget: "" })
  }

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
  
  if (selectedRFP) {
    return (
      <PartnerLayout>
        <div className="max-w-5xl mx-auto">
          {/* Back Button */}
          <button
            onClick={handleBackToList}
            className="font-mono text-xs text-gray-500 hover:text-[#0C3535] mb-6 flex items-center gap-1"
          >
            ← Back to Open RFPs
          </button>
          
          {/* RFP Header */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn("font-mono text-[10px] px-2 py-0.5 rounded-full uppercase", getStatusColor(selectedRFP.status))}>
                    {selectedRFP.status.replace(/_/g, " ")}
                  </span>
                  {selectedRFP.currentBidVersion && (
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      Bid V{selectedRFP.currentBidVersion}
                    </span>
                  )}
                  {selectedRFP.feedback.length > 0 && selectedRFP.feedback.some(f => !f.response) && (
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Feedback Pending
                    </span>
                  )}
                </div>
                <h1 className="font-display font-bold text-2xl text-[#0C3535]">
                  {selectedRFP.title}
                </h1>
              </div>
              <span className="font-mono text-xs px-3 py-1 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200">
                Due in {selectedRFP.deadline}
              </span>
            </div>
            
            {/* View Tabs */}
            <div className="flex gap-2 border-t border-gray-100 pt-4 mt-4">
              {[
                { key: "details", label: "RFP Details", icon: FileText },
                { key: "feedback", label: `Feedback${selectedRFP.feedback.length > 0 ? ` (${selectedRFP.feedback.length})` : ""}`, icon: MessageSquare },
                { key: "bid", label: selectedRFP.currentBidVersion ? "Submit Revision" : "Submit Bid", icon: Send },
              ].map(tab => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveView(tab.key as typeof activeView)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs transition-colors",
                      activeView === tab.key
                        ? "bg-[#0C3535] text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>
          
          {/* Details View */}
          {activeView === "details" && (
            <div className="bg-white rounded-xl border border-gray-200 p-8">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-yellow-800">
                  <strong>Notice:</strong> This RFP is issued by {selectedRFP.issuedBy}. Client identity will be shared with shortlisted vendors. Please do not share externally.
                </p>
              </div>
              
              <div className="space-y-6">
                <div>
                  <h3 className="font-display font-bold text-sm text-[#0C3535] mb-2">1. Overview</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{selectedRFP.overview}</p>
                </div>
                
                <div>
                  <h3 className="font-display font-bold text-sm text-[#0C3535] mb-2">2. Scope of Work</h3>
                  <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                    {selectedRFP.scope.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
                
                <div>
                  <h3 className="font-display font-bold text-sm text-[#0C3535] mb-2">3. Requirements</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{selectedRFP.requirements}</p>
                </div>
                
                <div>
                  <h3 className="font-display font-bold text-sm text-[#0C3535] mb-2">4. Timeline</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{selectedRFP.timeline}</p>
                </div>
              </div>
              
              {/* Version History */}
              {selectedRFP.bidVersions.length > 0 && (
                <div className="mt-8 pt-6 border-t border-gray-200">
                  <button
                    onClick={() => setShowVersionHistory(!showVersionHistory)}
                    className="flex items-center gap-2 font-mono text-xs text-gray-500 hover:text-[#0C3535]"
                  >
                    <History className="w-4 h-4" />
                    Your Bid History ({selectedRFP.bidVersions.length} {selectedRFP.bidVersions.length === 1 ? "version" : "versions"})
                  </button>
                  
                  {showVersionHistory && (
                    <div className="mt-4 space-y-3">
                      {selectedRFP.bidVersions.map((version) => (
                        <div 
                          key={version.version}
                          className={cn(
                            "p-4 rounded-lg border",
                            version.version === selectedRFP.currentBidVersion
                              ? "bg-blue-50 border-blue-200"
                              : "bg-gray-50 border-gray-200"
                          )}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-bold text-[#0C3535]">V{version.version}</span>
                              {version.version === selectedRFP.currentBidVersion && (
                                <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Current</span>
                              )}
                              <span className={cn(
                                "font-mono text-[10px] px-2 py-0.5 rounded-full capitalize",
                                version.status === "submitted" && "bg-green-100 text-green-700",
                                version.status === "under_review" && "bg-yellow-100 text-yellow-700",
                                version.status === "revision_requested" && "bg-orange-100 text-orange-700",
                              )}>
                                {version.status.replace(/_/g, " ")}
                              </span>
                            </div>
                            <span className="font-mono text-sm text-[#0C3535]">{version.amount}</span>
                          </div>
                          <div className="font-mono text-[10px] text-gray-500 mb-2">
                            Submitted {version.submittedAt}
                          </div>
                          <ul className="space-y-1">
                            {version.changes.map((change, j) => (
                              <li key={j} className="text-sm text-gray-600 flex items-center gap-2">
                                <span className="w-1 h-1 bg-[#0C3535] rounded-full" />
                                {change}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* Feedback View */}
          {activeView === "feedback" && (
            <div className="space-y-6">
              {selectedRFP.feedback.length > 0 ? (
                selectedRFP.feedback.map((item) => (
                  <div key={item.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    {/* Agency Message */}
                    <div className="p-6 border-b border-gray-100">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#0C3535] flex items-center justify-center shrink-0">
                          <span className="font-mono text-[10px] text-white">EA</span>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-display font-bold text-[#0C3535]">{item.sentBy}</span>
                            <span className={cn(
                              "font-mono text-[10px] px-2 py-0.5 rounded-full capitalize",
                              item.type === "question" && "bg-blue-100 text-blue-700",
                              item.type === "revision_request" && "bg-orange-100 text-orange-700",
                              item.type === "clarification" && "bg-yellow-100 text-yellow-700"
                            )}>
                              {item.type.replace("_", " ")}
                            </span>
                            <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                              {item.category}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 leading-relaxed">{item.message}</p>
                          <div className="font-mono text-[10px] text-gray-400 mt-2">{item.sentAt}</div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Your Response */}
                    {item.response ? (
                      <div className="p-6 bg-green-50">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-full bg-[#C8F53C] flex items-center justify-center shrink-0">
                            <span className="font-mono text-[10px] text-[#0C3535]">FF</span>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-display font-bold text-[#0C3535]">Your Response</span>
                              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />
                                Sent
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 leading-relaxed">{item.response.message}</p>
                            {item.response.attachments && item.response.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-3">
                                {item.response.attachments.map((att, i) => (
                                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200">
                                    <Paperclip className="w-3 h-3 text-gray-400" />
                                    <span className="font-mono text-[10px] text-[#0C3535]">{att.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="font-mono text-[10px] text-gray-400 mt-2">{item.response.respondedAt}</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 bg-orange-50">
                        <div className="flex items-center gap-2 mb-4">
                          <Clock className="w-4 h-4 text-orange-600" />
                          <span className="font-mono text-sm text-orange-700">Response Required</span>
                        </div>
                        
                        <div className="space-y-4">
                          <Textarea
                            value={responseMessage}
                            onChange={(e) => setResponseMessage(e.target.value)}
                            placeholder="Type your response to this feedback..."
                            className="min-h-[100px] border-orange-200 bg-white"
                          />
                          
                          {/* Attachments */}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <Paperclip className="w-4 h-4 text-gray-400" />
                              <span className="font-mono text-[10px] text-gray-500 uppercase tracking-wider">Attachments</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {responseAttachments.map((att, i) => (
                                <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200">
                                  <FileText className="w-3 h-3 text-gray-400" />
                                  <span className="font-mono text-[10px] text-[#0C3535]">{att.name}</span>
                                  <button onClick={() => setResponseAttachments(prev => prev.filter((_, j) => j !== i))}>
                                    <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
                                  </button>
                                </div>
                              ))}
<div className="relative">
                              <input
                                type="file"
                                ref={fileInputRef}
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) handleFileUpload(file)
                                  if (fileInputRef.current) fileInputRef.current.value = ""
                                }}
                                accept=".pdf,.doc,.docx,.pptx,.xls,.xlsx"
                                className="sr-only"
                              />
                              <button 
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploadingFile}
                                className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-[#0C3535] hover:text-[#0C3535]"
                              >
                                {isUploadingFile ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    <span className="font-mono text-[10px]">Uploading...</span>
                                  </>
                                ) : (
                                  <>
                                    <Upload className="w-3 h-3" />
                                    <span className="font-mono text-[10px]">Add File</span>
                                  </>
                                )}
                              </button>
                            </div>
                            </div>
                          </div>
                          
                          <div className="flex justify-end">
                            <Button
                              onClick={() => handleSubmitFeedbackResponse(item.id)}
                              disabled={!responseMessage.trim()}
                              className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white"
                            >
                              <Send className="w-4 h-4 mr-2" />
                              Send Response
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                  <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <div className="font-display font-bold text-lg text-[#0C3535] mb-2">
                    No Feedback Yet
                  </div>
                  <p className="text-sm text-gray-500">
                    The agency hasn&apos;t sent any feedback on your bid yet. Check back after they review your submission.
                  </p>
                </div>
              )}
              
              {/* Quick Action: Submit Revision */}
              {selectedRFP.feedback.length > 0 && selectedRFP.feedback.every(f => f.response) && (
                <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-display font-bold text-[#0C3535] mb-1">Ready to Submit a Revised Bid?</div>
                      <p className="text-sm text-gray-600">You&apos;ve responded to all feedback. Submit an updated bid to incorporate changes.</p>
                    </div>
                    <Button
                      onClick={() => setActiveView("bid")}
                      className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white"
                    >
                      Submit Revised Bid
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Bid Form View */}
          {activeView === "bid" && (
            <div className="bg-white rounded-xl border border-gray-200 p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-display font-bold text-xl text-[#0C3535]">
                  {selectedRFP.currentBidVersion ? `Submit Revised Bid (V${selectedRFP.currentBidVersion + 1})` : "Submit Your Bid"}
                </h2>
                {selectedRFP.currentBidVersion && (
                  <span className="font-mono text-[10px] px-3 py-1 rounded-full bg-purple-100 text-purple-700">
                    Revision
                  </span>
                )}
              </div>
              
              {selectedRFP.currentBidVersion && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
                  <p className="text-sm text-purple-800">
                    <strong>Tip:</strong> Reference the feedback you received and clearly explain what you&apos;ve changed in this revision. This helps the agency see how you&apos;ve addressed their concerns.
                  </p>
                </div>
              )}
              
              <form onSubmit={(e) => handleSubmitBid(e, !!selectedRFP.currentBidVersion)} className="space-y-6">
                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Your Approach *
                  </label>
                  <Textarea
                    value={formData.approach}
                    onChange={(e) => setFormData(prev => ({ ...prev, approach: e.target.value }))}
                    placeholder="Describe your creative approach and how you would tackle this project..."
                    className="min-h-[120px] border-gray-200"
                    required
                  />
                </div>
                
                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Proposed Team *
                  </label>
                  <Textarea
                    value={formData.team}
                    onChange={(e) => setFormData(prev => ({ ...prev, team: e.target.value }))}
                    placeholder="List key team members and their relevant experience..."
                    className="min-h-[100px] border-gray-200"
                    required
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Timeline Proposal *
                    </label>
                    <Textarea
                      value={formData.timeline}
                      onChange={(e) => setFormData(prev => ({ ...prev, timeline: e.target.value }))}
                      placeholder="Your proposed timeline and key milestones..."
                      className="min-h-[100px] border-gray-200"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Budget Proposal *
                    </label>
                    <Input
                      type="text"
                      value={formData.budget}
                      onChange={(e) => setFormData(prev => ({ ...prev, budget: e.target.value }))}
                      placeholder="$XX,XXX"
                      className="border-gray-200 mb-2"
                      required
                    />
                    <p className="text-xs text-gray-400">All-in budget for scope described</p>
                  </div>
                </div>
                
                {/* File Uploads */}
                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Supporting Documents
                  </label>
<div className="grid grid-cols-3 gap-3">
                    {["Budget Breakdown", "Timeline Visual", "Team Bios"].map((doc) => (
                      <div key={doc} className="relative">
                        <input
                          type="file"
                          ref={(el) => { docInputRefs.current[doc] = el }}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleFileUpload(file, doc)
                            if (docInputRefs.current[doc]) docInputRefs.current[doc]!.value = ""
                          }}
                          accept=".pdf,.doc,.docx,.pptx,.xls,.xlsx,.png,.jpg,.jpeg"
                          className="sr-only"
                        />
                        <div
                          onClick={() => docInputRefs.current[doc]?.click()}
                          className="p-4 rounded-lg border border-dashed border-gray-300 text-center hover:border-[#0C3535] cursor-pointer transition-colors"
                        >
                          <Upload className="w-5 h-5 mx-auto mb-2 text-gray-400" />
                          <span className="font-mono text-[10px] text-gray-600">{doc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setActiveView("details")}
                    className="border-gray-300 text-[#0C3535]"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white font-display font-bold"
                  >
                    {selectedRFP.currentBidVersion ? "Submit Revision →" : "Submit Bid →"}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </PartnerLayout>
    )
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
          {(["all", "new", "feedback_received", "shortlisted"] as const).map((filter) => (
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
            <div 
              key={rfp.id}
              className={cn(
                "bg-white rounded-xl border p-6 hover:border-[#0C3535]/30 transition-colors",
                rfp.status === "feedback_received" ? "border-orange-200" : "border-gray-200"
              )}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("font-mono text-[10px] px-2 py-0.5 rounded-full uppercase", getStatusColor(rfp.status))}>
                      {rfp.status.replace(/_/g, " ")}
                    </span>
                    {rfp.currentBidVersion && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        V{rfp.currentBidVersion} Submitted
                      </span>
                    )}
                    {rfp.feedback.length > 0 && rfp.feedback.some(f => !f.response) && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {rfp.feedback.filter(f => !f.response).length} Pending Response
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-gray-500">
                      Deadline: {rfp.deadline}
                    </span>
                  </div>
                  <h3 className="font-display font-bold text-xl text-[#0C3535]">
                    {rfp.title}
                  </h3>
                </div>
              </div>
              
              <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                {rfp.overview}
              </p>
              
              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <span className="font-mono text-[10px] text-gray-500">
                  Issued by {rfp.issuedBy}
                </span>
                <div className="flex items-center gap-2">
                  {rfp.status === "feedback_received" && (
                    <Button
                      onClick={() => { 
                        if (!checkFeatureAccess()) return
                        setSelectedRFP(rfp)
                        setActiveView("feedback")
                      }}
                      variant="outline"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Respond to Feedback
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      if (!checkFeatureAccess()) return
                      setSelectedRFP(rfp)
                    }}
                    className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white"
                  >
                    {rfp.status === "new" ? "View Details & Bid →" : "View Details →"}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PartnerLayout>
  )
}
