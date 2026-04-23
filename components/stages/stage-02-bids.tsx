"use client"

import { useState } from "react"
import { StageHeader } from "@/components/stage-header"
import { EngagementContext } from "@/components/engagement-context"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { AgencyBroadcastResponsesPanel } from "@/components/agency-broadcast-responses"
import { usePaidUser } from "@/contexts/paid-user-context"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { X, FileText, Play, Download, ExternalLink, ChevronRight, Clock, DollarSign, Users, Briefcase, MessageSquare, Send, History, CheckCircle, AlertCircle, Paperclip } from "lucide-react"

interface WorkSample {
  id: string
  title: string
  client: string
  type: "video" | "image" | "link"
  thumbnail?: string
  url?: string
  description: string
}

interface TeamMember {
  name: string
  role: string
  experience: string
}

interface BudgetLine {
  category: string
  amount: number
  notes?: string
}

interface TimelinePhase {
  phase: string
  duration: string
  deliverables: string[]
}

interface PaymentTerms {
  type: "fixed" | "hourly" | "retainer" | "milestone"
  rate?: string
  schedule: {
    milestone: string
    percentage: number
    amount: number
    timing: string
  }[]
  netTerms: number
  notes?: string
}

interface FeedbackItem {
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

interface BidVersion {
  version: number
  submittedAt: string
  changes: string[]
  amount: string
  score?: number
}

interface SubmissionMaterials {
  capabilitiesDeck: {
    filename: string
    uploadedAt: string
    pageCount: number
  }
  workSamples: WorkSample[]
  proposedTeam: TeamMember[]
  proposedBudget: {
    total: number
    breakdown: BudgetLine[]
  }
  proposedTimeline: {
    totalWeeks: number
    phases: TimelinePhase[]
  }
  coverLetter: string
  references: {
    name: string
    company: string
    relationship: string
    contactable: boolean
  }[]
  paymentTerms: PaymentTerms
}

interface Bid {
  id: string
  vendor: string
  discipline: string
  amount: string
  score: number
  recommendation: "advance" | "clarify" | "decline"
  submitted: string
  highlights: string[]
  gaps: string[]
  aiAnalysis: {
    relevantExperience: { score: number; max: number; reasoning: string }
    teamQuality: { score: number; max: number; reasoning: string }
    creativeApproach: { score: number; max: number; reasoning: string }
    timelineRealism: { score: number; max: number; reasoning: string }
    valueForBudget: { score: number; max: number; reasoning: string }
  }
  submission: SubmissionMaterials
  currentVersion: number
  versions: BidVersion[]
  feedback: FeedbackItem[]
  status: "pending_review" | "feedback_sent" | "revision_requested" | "revision_received" | "shortlisted" | "awarded" | "declined"
}

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoBids: Bid[] = [
  {
    id: "1",
    vendor: "Sample Production Studio",
    discipline: "Video Production",
    amount: "$97,000",
    score: 87,
    recommendation: "advance",
    submitted: "2 days ago",
    highlights: ["Strong sports portfolio", "Available immediately", "Competitive pricing"],
    gaps: ["Limited creator content experience"],
    aiAnalysis: {
      relevantExperience: { 
        score: 22, 
        max: 25, 
        reasoning: "10+ years in sports video production with NFL, NBA, and college athletics clients. Their 'Game Day Stories' series for ESPN demonstrates strong narrative capability. Minor gap: creator-focused content is newer for them." 
      },
      teamQuality: { 
        score: 18, 
        max: 20, 
        reasoning: "Proposed director (Jake Morrison) has 15 years experience and 3 Sports Emmy nominations. DP and editor both have 8+ years. Full-time colorist on staff is a plus." 
      },
      creativeApproach: { 
        score: 17, 
        max: 20, 
        reasoning: "Treatment shows understanding of authentic storytelling. Proposed 'Day in the Life' format aligns with brief. Could push creative boundaries more." 
      },
      timelineRealism: { 
        score: 16, 
        max: 20, 
        reasoning: "12-week timeline is aggressive but achievable given team size. Buffer for player scheduling could be tighter." 
      },
      valueForBudget: { 
        score: 14, 
        max: 15, 
        reasoning: "$97K is competitive for this scope. Includes equipment, travel, and post. No hidden costs identified." 
      },
    },
    submission: {
      capabilitiesDeck: {
        filename: "Sample_Production_Capabilities.pdf",
        uploadedAt: "Mar 15, 2024",
        pageCount: 24
      },
      workSamples: [
        {
          id: "ws1",
          title: "Game Day Stories - Episode 12",
          client: "ESPN",
          type: "video",
          description: "Behind-the-scenes documentary following college football team through championship run",
          thumbnail: "/api/placeholder/320/180"
        },
        {
          id: "ws2",
          title: "Athlete Origin Series",
          client: "Nike",
          type: "video",
          description: "6-part series on Olympic athletes' hometown stories",
          thumbnail: "/api/placeholder/320/180"
        },
        {
          id: "ws3",
          title: "Training Ground",
          client: "Under Armour",
          type: "video",
          description: "Creator-style training content for social platforms",
          thumbnail: "/api/placeholder/320/180"
        }
      ],
      proposedTeam: [
        { name: "Jake Morrison", role: "Director", experience: "15 years, 3x Sports Emmy Nominee" },
        { name: "Sarah Chen", role: "DP / Camera", experience: "8 years, RED certified" },
        { name: "Marcus Williams", role: "Editor", experience: "10 years, Premiere/DaVinci" },
        { name: "Ana Rodriguez", role: "Producer", experience: "6 years, sports & entertainment" }
      ],
      proposedBudget: {
        total: 97000,
        breakdown: [
          { category: "Pre-Production", amount: 12000, notes: "Scouting, scheduling, creative development" },
          { category: "Production - Crew", amount: 35000, notes: "4-person crew, 8 shoot days" },
          { category: "Production - Equipment", amount: 18000, notes: "RED cameras, lighting, audio" },
          { category: "Travel & Logistics", amount: 12000, notes: "3 cities, hotels, transport" },
          { category: "Post-Production", amount: 15000, notes: "Edit, color, sound mix" },
          { category: "Contingency", amount: 5000, notes: "5% buffer" }
        ]
      },
      proposedTimeline: {
        totalWeeks: 12,
        phases: [
          { phase: "Pre-Production", duration: "2 weeks", deliverables: ["Creative brief sign-off", "Shot lists", "Schedule confirmed"] },
          { phase: "Production", duration: "6 weeks", deliverables: ["8 shoot days across 3 cities", "Daily selects", "Rough assemblies"] },
          { phase: "Post-Production", duration: "3 weeks", deliverables: ["First cuts", "Revisions", "Final delivery"] },
          { phase: "Delivery", duration: "1 week", deliverables: ["All formats", "Social cuts", "Asset handoff"] }
        ]
      },
      coverLetter: "We're thrilled to submit our proposal for the NWSL Creator Content Series. Having worked with professional sports leagues for over a decade, we understand the unique balance between athletic excellence and authentic storytelling that resonates with today's audiences. Our approach centers on letting the athletes' personalities shine through unscripted moments while maintaining the production value your brand demands. We're particularly excited about the creator-first angle and have been expanding our capabilities in this space over the past year.",
      references: [
        { name: "Michael Torres", company: "ESPN", relationship: "Executive Producer, Game Day Stories", contactable: true },
        { name: "Jennifer Walsh", company: "Nike Brand", relationship: "Sr. Creative Director", contactable: true }
      ],
      paymentTerms: {
        type: "milestone",
        schedule: [
          { milestone: "Contract Signing", percentage: 25, amount: 24250, timing: "Upon execution" },
          { milestone: "Production Complete", percentage: 40, amount: 38800, timing: "Week 8" },
          { milestone: "Final Delivery", percentage: 35, amount: 33950, timing: "Week 12" }
        ],
        netTerms: 30,
        notes: "Equipment rental deposits due upfront, travel expenses billed at cost with receipts"
      }
    },
    currentVersion: 1,
    versions: [
      { version: 1, submittedAt: "Mar 15, 2024", changes: ["Initial submission"], amount: "$97,000", score: 87 }
    ],
    feedback: [],
    status: "pending_review"
  },
  {
    id: "2",
    vendor: "Tandem Social",
    discipline: "Social Media",
    amount: "$48,000",
    score: 92,
    recommendation: "advance",
    submitted: "1 day ago",
    highlights: ["Creator-first approach", "Platform expertise", "Agile team structure"],
    gaps: [],
    aiAnalysis: {
      relevantExperience: { 
        score: 24, 
        max: 25, 
        reasoning: "Extensive creator economy experience with top-tier sports and lifestyle brands. Their WNBA social takeover generated 2.3M impressions. Perfect fit for this scope." 
      },
      teamQuality: { 
        score: 19, 
        max: 20, 
        reasoning: "Lean but experienced team. Lead strategist previously at Meta. Content creators have combined 500K+ following. Strong bench for overflow." 
      },
      creativeApproach: { 
        score: 18, 
        max: 20, 
        reasoning: "Proposed content pillars are smart and platform-native. TikTok-first approach with Instagram adaptation shows platform fluency." 
      },
      timelineRealism: { 
        score: 17, 
        max: 20, 
        reasoning: "Rolling content calendar is realistic. Weekly batching approach is efficient. May need flexibility around game schedules." 
      },
      valueForBudget: { 
        score: 14, 
        max: 15, 
        reasoning: "$48K for 3-month engagement is competitive. Includes strategy, content creation, and community management." 
      },
    },
    submission: {
      capabilitiesDeck: {
        filename: "Tandem_Social_2024_Deck.pdf",
        uploadedAt: "Mar 16, 2024",
        pageCount: 18
      },
      workSamples: [
        {
          id: "ws1",
          title: "WNBA All-Star Social Takeover",
          client: "WNBA",
          type: "link",
          url: "https://demo.withligament.com/sample-assets/case-study",
          description: "Full social media management during All-Star weekend, 2.3M impressions"
        },
        {
          id: "ws2",
          title: "Athlete Creator Program",
          client: "Gatorade",
          type: "video",
          description: "Training athletes to create authentic social content",
          thumbnail: "/api/placeholder/320/180"
        }
      ],
      proposedTeam: [
        { name: "Kim Park", role: "Strategy Lead", experience: "Ex-Meta, 8 years social strategy" },
        { name: "Devon James", role: "Content Creator", experience: "150K TikTok following, sports niche" },
        { name: "Riley Martinez", role: "Community Manager", experience: "5 years, sports & entertainment" }
      ],
      proposedBudget: {
        total: 48000,
        breakdown: [
          { category: "Strategy & Planning", amount: 8000, notes: "Content strategy, calendar, guidelines" },
          { category: "Content Creation", amount: 24000, notes: "40+ pieces of content over 3 months" },
          { category: "Community Management", amount: 12000, notes: "Daily monitoring, engagement, reporting" },
          { category: "Tools & Analytics", amount: 4000, notes: "Scheduling, analytics, reporting tools" }
        ]
      },
      proposedTimeline: {
        totalWeeks: 12,
        phases: [
          { phase: "Strategy", duration: "1 week", deliverables: ["Content pillars", "Platform strategy", "Calendar framework"] },
          { phase: "Production Sprint 1", duration: "4 weeks", deliverables: ["Launch content", "Athlete onboarding", "Community setup"] },
          { phase: "Production Sprint 2", duration: "4 weeks", deliverables: ["Ongoing content", "Trend response", "Performance optimization"] },
          { phase: "Production Sprint 3", duration: "3 weeks", deliverables: ["Campaign content", "Wrap-up", "Learnings report"] }
        ]
      },
      coverLetter: "Tandem Social is built for exactly this kind of work: helping sports brands connect authentically with fans through creator-native content. We don't just post content—we build communities. Our experience with the WNBA taught us how to balance league messaging with player authenticity, and we're excited to bring those learnings to the NWSL. Our proposed approach puts athletes at the center as creators, not just subjects.",
      references: [
        { name: "Carla Stevens", company: "WNBA", relationship: "Director of Digital", contactable: true },
        { name: "Andre Mitchell", company: "Gatorade", relationship: "Social Media Manager", contactable: true }
      ],
      paymentTerms: {
        type: "retainer",
        rate: "$8,000/month",
        schedule: [
          { milestone: "Month 1", percentage: 16.7, amount: 8000, timing: "1st of month" },
          { milestone: "Month 2", percentage: 16.7, amount: 8000, timing: "1st of month" },
          { milestone: "Month 3", percentage: 16.7, amount: 8000, timing: "1st of month" },
          { milestone: "Month 4", percentage: 16.7, amount: 8000, timing: "1st of month" },
          { milestone: "Month 5", percentage: 16.7, amount: 8000, timing: "1st of month" },
          { milestone: "Month 6", percentage: 16.7, amount: 8000, timing: "1st of month" }
        ],
        netTerms: 15,
        notes: "Monthly retainer billed in advance. Paid media spend billed separately at cost."
      }
    },
    currentVersion: 1,
    versions: [
      { version: 1, submittedAt: "Mar 16, 2024", changes: ["Initial submission"], amount: "$48,000", score: 92 }
    ],
    feedback: [],
    status: "shortlisted"
  },
  {
    id: "3",
    vendor: "Roster Agency",
    discipline: "Talent Relations",
    amount: "$40,000",
    score: 78,
    recommendation: "clarify",
    submitted: "3 days ago",
    highlights: ["Athlete network", "NWSL connections"],
    gaps: ["Timeline unclear", "Team composition not specified"],
    aiAnalysis: {
      relevantExperience: { 
        score: 20, 
        max: 25, 
        reasoning: "Good athlete management experience but limited to traditional representation. Creator economy work is newer for them. NWSL connections are a strong asset." 
      },
      teamQuality: { 
        score: 14, 
        max: 20, 
        reasoning: "Team composition unclear in proposal. Lead agent is experienced but support staff not detailed. Request clarification on who handles day-to-day." 
      },
      creativeApproach: { 
        score: 15, 
        max: 20, 
        reasoning: "Approach is relationship-focused which is good, but creative involvement in content is vague. How do they bridge talent and production?" 
      },
      timelineRealism: { 
        score: 15, 
        max: 20, 
        reasoning: "Timeline mentions 'flexible engagement' without specific milestones. Need clearer deliverable schedule." 
      },
      valueForBudget: { 
        score: 14, 
        max: 15, 
        reasoning: "$40K is reasonable for talent coordination scope. Retainer structure makes sense for ongoing relationship management." 
      },
    },
    submission: {
      capabilitiesDeck: {
        filename: "Roster_Agency_Overview.pdf",
        uploadedAt: "Mar 14, 2024",
        pageCount: 12
      },
      workSamples: [
        {
          id: "ws1",
          title: "NWSL Player Partnerships",
          client: "Various Brands",
          type: "link",
          url: "https://demo.withligament.com/sample-assets/roster",
          description: "Overview of current NWSL player representation and brand deals"
        }
      ],
      proposedTeam: [
        { name: "Marcus Johnson", role: "Lead Agent", experience: "12 years sports representation" },
        { name: "TBD", role: "Account Coordinator", experience: "To be assigned" }
      ],
      proposedBudget: {
        total: 40000,
        breakdown: [
          { category: "Talent Sourcing", amount: 10000, notes: "Player outreach and contracting" },
          { category: "Relationship Management", amount: 20000, notes: "Ongoing coordination, scheduling" },
          { category: "Administrative", amount: 10000, notes: "Contracts, compliance, reporting" }
        ]
      },
      proposedTimeline: {
        totalWeeks: 12,
        phases: [
          { phase: "Talent Identification", duration: "2 weeks", deliverables: ["Player shortlist", "Availability confirmed"] },
          { phase: "Ongoing Management", duration: "10 weeks", deliverables: ["Flexible engagement as needed"] }
        ]
      },
      coverLetter: "Roster Agency has been representing professional athletes for over a decade, with a particular strength in women's soccer. We currently represent 8 NWSL players and have strong relationships across all 12 teams. We understand the balance between protecting athlete interests and enabling great brand partnerships. While our proposal is intentionally flexible, we're happy to discuss more specific structures based on your production needs.",
      references: [
        { name: "Player Rep (Confidential)", company: "NWSL Team", relationship: "Current client", contactable: false }
      ],
      paymentTerms: {
        type: "hourly",
        rate: "$150/hour",
        schedule: [
          { milestone: "Deposit", percentage: 20, amount: 8000, timing: "Upon contract signing" },
          { milestone: "Monthly billing", percentage: 80, amount: 32000, timing: "Billed monthly based on hours" }
        ],
        netTerms: 30,
        notes: "Hourly tracking via detailed timesheets. Estimated 200-270 hours total. Cap at $40K unless change order approved."
      }
    },
    currentVersion: 2,
    versions: [
      { version: 1, submittedAt: "Mar 14, 2024", changes: ["Initial submission"], amount: "$45,000", score: 72 },
      { version: 2, submittedAt: "Mar 18, 2024", changes: ["Detailed team structure", "Revised timeline with milestones", "Added dedicated coordinator"], amount: "$40,000", score: 78 }
    ],
    feedback: [
      {
        id: "fb1",
        type: "clarification",
        category: "team",
        message: "Can you provide more detail on the team structure? The 'TBD' coordinator role needs to be filled before we can move forward. Who specifically will handle day-to-day communications?",
        sentAt: "Mar 15, 2024 2:30 PM",
        sentBy: "Sarah Chen",
        response: {
          message: "Thank you for the feedback. We've updated our proposal (V2) to include Maya Thompson as the dedicated Account Coordinator. Maya has 4 years of experience in sports talent management and will be the primary day-to-day contact. We've also revised our timeline to include specific weekly check-ins and milestone deliverables.",
          respondedAt: "Mar 17, 2024 10:15 AM",
          attachments: [
            { name: "Roster_Revised_Team_Structure.pdf", type: "pdf" },
            { name: "Maya_Thompson_Bio.pdf", type: "pdf" }
          ]
        }
      },
      {
        id: "fb2",
        type: "revision_request",
        category: "timeline",
        message: "The 'flexible engagement' timeline doesn't work for our production schedule. We need specific milestones and deliverable dates that align with the video production timeline.",
        sentAt: "Mar 15, 2024 2:35 PM",
        sentBy: "Sarah Chen",
        response: {
          message: "Understood. V2 now includes a detailed week-by-week timeline with specific deliverables: Week 1-2 player shortlist and availability matrix, Week 3 contracts signed, Week 4+ ongoing coordination with weekly status reports every Monday.",
          respondedAt: "Mar 17, 2024 10:15 AM"
        }
      }
    ],
    status: "revision_received"
  },
]

const getRecommendationStyle = (rec: Bid["recommendation"]) => {
  switch (rec) {
    case "advance":
      return "bg-green-900/30 text-green-100 border-green-400/40"
    case "clarify":
      return "bg-yellow-900/30 text-yellow-100 border-yellow-400/40"
    case "decline":
      return "bg-red-900/30 text-red-100 border-red-400/40"
  }
}

const getScoreColor = (score: number) => {
  if (score >= 85) return "text-green-400"
  if (score >= 70) return "text-yellow-400"
  return "text-red-400"
}

type SubmissionTab = "overview" | "materials" | "budget" | "timeline" | "team" | "payment" | "feedback"

export function Stage02Bids() {
  const isDemo = isDemoMode()
  const sampleBids = isDemo ? demoBids : []
  const { checkFeatureAccess } = usePaidUser()
  const { selectedProject, isLoadingProjects } = useSelectedProject()
  
  const [selectedBid, setSelectedBid] = useState<string | null>(null)
  const [awardedVendors, setAwardedVendors] = useState<string[]>([])
  const [showSubmissionDetail, setShowSubmissionDetail] = useState(false)
  const [submissionTab, setSubmissionTab] = useState<SubmissionTab>("overview")
  const [expandedScoreItem, setExpandedScoreItem] = useState<string | null>(null)
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
  const [feedbackType, setFeedbackType] = useState<"question" | "revision_request" | "clarification">("question")
  const [feedbackCategory, setFeedbackCategory] = useState<"budget" | "timeline" | "team" | "scope" | "general">("general")
  const [feedbackMessage, setFeedbackMessage] = useState("")
  const [bids, setBids] = useState(sampleBids)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  
  const handleAward = (bidId: string) => {
    if (!checkFeatureAccess()) return
    setAwardedVendors(prev => [...prev, bidId])
    setBids(prev => prev.map(b => b.id === bidId ? { ...b, status: "awarded" as const } : b))
  }

  const handleSendFeedback = () => {
    if (!selectedBid || !feedbackMessage.trim()) return
    if (!checkFeatureAccess()) return
    
    const newFeedback: FeedbackItem = {
      id: `fb-${Date.now()}`,
      type: feedbackType,
      category: feedbackCategory,
      message: feedbackMessage,
      sentAt: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
      sentBy: "You"
    }
    
    setBids(prev => prev.map(b => 
      b.id === selectedBid 
        ? { ...b, feedback: [...b.feedback, newFeedback], status: feedbackType === "revision_request" ? "revision_requested" as const : "feedback_sent" as const } 
        : b
    ))
    
    setFeedbackMessage("")
    setShowFeedbackForm(false)
  }

  const handleShortlist = (bidId: string) => {
    setBids(prev => prev.map(b => b.id === bidId ? { ...b, status: "shortlisted" as const } : b))
  }

  const selectedBidData = bids.find(b => b.id === selectedBid)
  
  // Production: real partner bids come from partner_rfp_responses (GET /api/agency/rfp-responses).
  // Demo: rich AI-scored mock data below. Stage02Bids does not fetch — AgencyBroadcastResponsesPanel does.
  if (!isDemo) {
    return (
      <div className="p-8 max-w-6xl">
        <StageHeader
          stageNumber="02"
          title="Bid Management + Award"
          subtitle="Review partner proposals from broadcast RFPs. Submissions appear below from partner_rfp_responses. AI scoring and comparison cards are available in demo preview."
          aiPowered
        />
        {isLoadingProjects ? (
          <GlassCard className="mt-6">
            <div className="flex items-center gap-3 text-foreground-muted">
              <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-foreground-muted/40 border-t-accent" />
              <span className="font-mono text-sm">Loading project…</span>
            </div>
          </GlassCard>
        ) : (
          <AgencyBroadcastResponsesPanel projectId={selectedProject?.id ?? null} />
        )}
      </div>
    )
  }
  
  return (
    <div className="p-8 max-w-6xl">
      <StageHeader
        stageNumber="02"
        title="Bid Management + Award"
        subtitle="Review vendor responses, see AI-generated scores, and award contracts. Click any bid to review their full submission materials."
        aiPowered
      />
      
      <EngagementContext
        agency="Electric Animal"
        project="NWSL Creator Content Series"
        budget="$250K"
        className="mb-8"
      />

      {/* AI Scoring Methodology */}
      <GlassCard className="mb-8">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
            <span className="text-accent text-lg">✦</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-display font-bold text-sm text-foreground">AI Bid Scoring Methodology</h3>
              <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">
                Weighted 100-Point System
              </span>
            </div>
            <p className="text-sm text-foreground-muted mb-4">
              Each bid is evaluated using a transparent weighted scoring system. Click any score to see the AI reasoning.
            </p>
            <div className="grid grid-cols-5 gap-4">
              <div className="text-center p-3 bg-white/5 rounded-lg">
                <div className="font-display font-bold text-xl text-accent">25%</div>
                <div className="font-mono text-[9px] text-foreground-muted uppercase tracking-wider mt-1">Experience</div>
                <div className="text-[10px] text-foreground-muted/60 mt-0.5">Portfolio & relevance</div>
              </div>
              <div className="text-center p-3 bg-white/5 rounded-lg">
                <div className="font-display font-bold text-xl text-accent">20%</div>
                <div className="font-mono text-[9px] text-foreground-muted uppercase tracking-wider mt-1">Team Quality</div>
                <div className="text-[10px] text-foreground-muted/60 mt-0.5">Personnel & availability</div>
              </div>
              <div className="text-center p-3 bg-white/5 rounded-lg">
                <div className="font-display font-bold text-xl text-accent">20%</div>
                <div className="font-mono text-[9px] text-foreground-muted uppercase tracking-wider mt-1">Approach</div>
                <div className="text-[10px] text-foreground-muted/60 mt-0.5">Strategy & innovation</div>
              </div>
              <div className="text-center p-3 bg-white/5 rounded-lg">
                <div className="font-display font-bold text-xl text-accent">20%</div>
                <div className="font-mono text-[9px] text-foreground-muted uppercase tracking-wider mt-1">Timeline</div>
                <div className="text-[10px] text-foreground-muted/60 mt-0.5">Feasibility & milestones</div>
              </div>
              <div className="text-center p-3 bg-white/5 rounded-lg">
                <div className="font-display font-bold text-xl text-accent">15%</div>
                <div className="font-mono text-[9px] text-foreground-muted uppercase tracking-wider mt-1">Budget Value</div>
                <div className="text-[10px] text-foreground-muted/60 mt-0.5">Pricing & transparency</div>
              </div>
            </div>
          </div>
        </div>
      </GlassCard>
      
      {/* Bid Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {bids.map((bid) => (
          <GlassCard 
            key={bid.id}
            highlight={selectedBid === bid.id}
            className={cn(
              "cursor-pointer transition-all",
              awardedVendors.includes(bid.id) && "border-green-500/40 bg-green-500/5"
            )}
          >
            <div onClick={() => setSelectedBid(bid.id)}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-display font-bold text-lg text-foreground">
                    {bid.vendor}
                  </div>
                  <div className="font-mono text-[10px] text-accent">
                    {bid.discipline}
                  </div>
                </div>
                <div className={cn("font-mono text-2xl font-bold", getScoreColor(bid.score))}>
                  {bid.score}
                </div>
              </div>
              
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-lg text-foreground">
                  {bid.amount}
                </div>
                <span className={cn(
                  "font-mono text-[10px] px-2 py-0.5 rounded-full border capitalize",
                  getRecommendationStyle(bid.recommendation)
                )}>
                  {bid.recommendation}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className={cn(
                  "font-mono text-[9px] px-2 py-0.5 rounded-full border capitalize",
                  bid.submission.paymentTerms.type === "fixed" && "bg-blue-900/30 text-blue-100 border-blue-400/40",
                  bid.submission.paymentTerms.type === "hourly" && "bg-purple-900/30 text-purple-100 border-purple-400/40",
                  bid.submission.paymentTerms.type === "retainer" && "bg-green-900/30 text-green-100 border-green-400/40",
                  bid.submission.paymentTerms.type === "milestone" && "bg-accent/10 text-accent border-accent/30"
                )}>
                  {bid.submission.paymentTerms.type}
                </span>
                <span className="font-mono text-[9px] text-foreground-muted">
                  Net {bid.submission.paymentTerms.netTerms}
                </span>
              </div>
              
              <div className="flex items-center justify-between mb-3">
                <div className="font-mono text-[10px] text-foreground-muted">
                  Submitted {bid.submitted}
                </div>
                {bid.currentVersion > 1 && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-100 border border-blue-400/40">
                    V{bid.currentVersion}
                  </span>
                )}
              </div>

              {/* Status indicator */}
              {bid.status !== "pending_review" && (
                <div className={cn(
                  "flex items-center gap-2 mb-3 font-mono text-[10px] px-2 py-1 rounded-lg",
                  bid.status === "feedback_sent" && "bg-yellow-900/30 text-yellow-100",
                  bid.status === "revision_requested" && "bg-orange-900/30 text-orange-100",
                  bid.status === "revision_received" && "bg-blue-900/30 text-blue-100",
                  bid.status === "shortlisted" && "bg-purple-900/30 text-purple-100",
                  bid.status === "awarded" && "bg-green-900/30 text-green-100",
                )}>
                  {bid.status === "feedback_sent" && <><MessageSquare className="w-3 h-3" /> Feedback Sent</>}
                  {bid.status === "revision_requested" && <><AlertCircle className="w-3 h-3" /> Revision Requested</>}
                  {bid.status === "revision_received" && <><CheckCircle className="w-3 h-3" /> Revision Received</>}
                  {bid.status === "shortlisted" && <><CheckCircle className="w-3 h-3" /> Shortlisted</>}
                  {bid.status === "awarded" && <><CheckCircle className="w-3 h-3" /> Awarded</>}
                </div>
              )}

              {/* Quick stats */}
              <div className="flex items-center gap-3 text-foreground-muted">
                <div className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  <span className="font-mono text-[10px]">{bid.submission.capabilitiesDeck.pageCount}pg deck</span>
                </div>
                <div className="flex items-center gap-1">
                  <Play className="w-3 h-3" />
                  <span className="font-mono text-[10px]">{bid.submission.workSamples.length} samples</span>
                </div>
                {bid.feedback.length > 0 && (
                  <div className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    <span className="font-mono text-[10px]">{bid.feedback.length} threads</span>
                  </div>
                )}
              </div>
            </div>
            
            {bid.status !== "awarded" && bid.status !== "shortlisted" && bid.recommendation === "advance" && (
              <div className="flex gap-2 mt-3">
                <Button 
                  onClick={(e) => {
                    e.stopPropagation()
                    handleShortlist(bid.id)
                  }}
                  size="sm"
                  variant="outline"
                  className="flex-1 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 font-mono text-xs"
                >
                  Shortlist
                </Button>
                <Button 
                  onClick={(e) => {
                    e.stopPropagation()
                    handleAward(bid.id)
                  }}
                  size="sm"
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-mono text-xs"
                >
                  Award
                </Button>
              </div>
            )}

            {bid.status === "shortlisted" && (
              <Button 
                onClick={(e) => {
                  e.stopPropagation()
                  handleAward(bid.id)
                }}
                size="sm"
                className="w-full mt-3 bg-accent text-accent-foreground hover:bg-accent/90 font-mono text-xs"
              >
                Award Contract
              </Button>
            )}
            
            {bid.status === "awarded" && (
              <div className="mt-3 font-mono text-xs text-green-400 flex items-center gap-2">
                <CheckCircle className="w-3 h-3" /> Awarded
              </div>
            )}
          </GlassCard>
        ))}
      </div>
      
      {/* Detailed View */}
      {selectedBid && selectedBidData && (
        <GlassCard>
          <div className="flex items-start justify-between mb-6">
            <GlassCardHeader
              label="AI Analysis"
              title={selectedBidData.vendor}
              badge="Scored by LIGAMENT AI"
            />
            <Button
              onClick={() => {
                if (!checkFeatureAccess()) return
                setShowSubmissionDetail(true)
              }}
              variant="outline"
              className="border-accent/30 text-accent hover:bg-accent/10"
            >
              <FileText className="w-4 h-4 mr-2" />
              View Full Submission
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                AI Scoring Breakdown
                <span className="text-foreground-muted/60 ml-2">(click for reasoning)</span>
              </div>
              
              {/* Scoring Methodology Legend */}
              <div className="mb-4 p-3 bg-accent/5 rounded-lg border border-accent/20">
                <div className="font-mono text-[9px] text-accent uppercase tracking-wider mb-2 flex items-center gap-1">
                  <span>✦</span> Weighted Scoring Methodology
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <div className="flex justify-between text-foreground-muted">
                    <span>Relevant Experience</span>
                    <span className="font-mono text-accent">25%</span>
                  </div>
                  <div className="flex justify-between text-foreground-muted">
                    <span>Team Quality</span>
                    <span className="font-mono text-accent">20%</span>
                  </div>
                  <div className="flex justify-between text-foreground-muted">
                    <span>Creative Approach</span>
                    <span className="font-mono text-accent">20%</span>
                  </div>
                  <div className="flex justify-between text-foreground-muted">
                    <span>Timeline Realism</span>
                    <span className="font-mono text-accent">20%</span>
                  </div>
                  <div className="flex justify-between text-foreground-muted">
                    <span>Value for Budget</span>
                    <span className="font-mono text-accent">15%</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {Object.entries(selectedBidData.aiAnalysis).map(([key, item]) => {
                  const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
                  const isExpanded = expandedScoreItem === key
                  const weight = key === 'relevantExperience' ? 25 : key === 'valueForBudget' ? 15 : 20
                  const percentage = Math.round((item.score / item.max) * 100)
                  return (
                    <div key={key}>
                      <div 
                        className="flex items-center justify-between cursor-pointer hover:bg-white/5 p-2 rounded-lg -mx-2 transition-colors"
                        onClick={() => setExpandedScoreItem(isExpanded ? null : key)}
                      >
                        <span className="text-sm text-foreground-secondary flex items-center gap-2">
                          <ChevronRight className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-90")} />
                          {label}
                          <span className="font-mono text-[9px] text-foreground-muted/60">({weight}% weight)</span>
                        </span>
                        <div className="flex items-center gap-3">
                          <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className={cn(
                                "h-full rounded-full",
                                percentage >= 80 ? "bg-green-400" : percentage >= 60 ? "bg-accent" : "bg-yellow-400"
                              )}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                          <span className="font-mono text-sm text-foreground w-12 text-right">
                            {item.score}/{item.max}
                          </span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="ml-5 p-3 bg-white/5 rounded-lg mb-2">
                          <p className="text-sm text-foreground-secondary leading-relaxed">
                            {item.reasoning}
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              
              {/* Total Score */}
              <div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-between">
                <span className="font-mono text-xs text-foreground-muted">Total Weighted Score</span>
                <span className="font-display font-bold text-xl text-accent">{selectedBidData.score}/100</span>
              </div>
            </div>
            
            <div className="space-y-4">
              {selectedBidData.highlights.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] text-green-400 uppercase tracking-wider mb-2">
                    Highlights
                  </div>
                  <ul className="space-y-1">
                    {selectedBidData.highlights.map((h, i) => (
                      <li key={i} className="text-sm text-foreground-secondary flex items-center gap-2">
                        <span className="text-green-400">+</span> {h}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {selectedBidData.gaps.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] text-yellow-400 uppercase tracking-wider mb-2">
                    Gaps / Clarifications Needed
                  </div>
                  <ul className="space-y-1">
                    {selectedBidData.gaps.map((g, i) => (
                      <li key={i} className="text-sm text-foreground-secondary flex items-center gap-2">
                        <span className="text-yellow-400">!</span> {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Cover Letter Preview */}
              <div>
                <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                  Cover Letter Preview
                </div>
                <p className="text-sm text-foreground-secondary line-clamp-3">
                  {selectedBidData.submission.coverLetter}
                </p>
                <button 
                  onClick={() => {
                    if (!checkFeatureAccess()) return
                    setShowSubmissionDetail(true)
                  }}
                  className="text-accent text-sm mt-1 hover:underline"
                >
                  Read full submission...
                </button>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Full Submission Detail Modal */}
      {showSubmissionDetail && selectedBidData && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border/50 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-border/30 flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] text-accent uppercase tracking-wider mb-1">
                  Full Submission
                </div>
                <h2 className="font-display text-2xl font-bold text-foreground">
                  {selectedBidData.vendor}
                </h2>
                <p className="font-mono text-sm text-foreground-muted">
                  {selectedBidData.discipline} | {selectedBidData.amount}
                </p>
              </div>
              <button
                onClick={() => setShowSubmissionDetail(false)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-foreground-muted" />
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b border-border/30 px-6">
              {[
                { key: "overview", label: "Overview", icon: FileText },
                { key: "materials", label: "Work Samples", icon: Play },
                { key: "budget", label: "Proposed Budget", icon: DollarSign },
                { key: "timeline", label: "Timeline", icon: Clock },
                { key: "team", label: "Team", icon: Users },
                { key: "payment", label: "Payment Terms", icon: DollarSign },
                { key: "feedback", label: `Feedback${selectedBidData.feedback.length > 0 ? ` (${selectedBidData.feedback.length})` : ""}`, icon: MessageSquare },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setSubmissionTab(tab.key as SubmissionTab)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3 font-mono text-sm border-b-2 transition-colors",
                    submissionTab === tab.key 
                      ? "border-accent text-accent" 
                      : "border-transparent text-foreground/80 hover:text-foreground"
                  )}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {submissionTab === "overview" && (
                <div className="space-y-6">
                  {/* Capabilities Deck */}
                  <div>
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                      Capabilities Deck
                    </div>
                    <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl border border-border/30">
                      <div className="w-12 h-12 bg-accent/20 rounded-lg flex items-center justify-center">
                        <FileText className="w-6 h-6 text-accent" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-foreground">{selectedBidData.submission.capabilitiesDeck.filename}</div>
                        <div className="font-mono text-[10px] text-foreground-muted">
                          {selectedBidData.submission.capabilitiesDeck.pageCount} pages | Uploaded {selectedBidData.submission.capabilitiesDeck.uploadedAt}
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="border-accent/30 text-accent">
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  </div>

                  {/* Cover Letter */}
                  <div>
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                      Cover Letter
                    </div>
                    <div className="p-4 bg-white/5 rounded-xl border border-border/30">
                      <p className="text-foreground-secondary leading-relaxed">
                        {selectedBidData.submission.coverLetter}
                      </p>
                    </div>
                  </div>

                  {/* References */}
                  <div>
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                      References
                    </div>
                    <div className="space-y-2">
                      {selectedBidData.submission.references.map((ref, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-border/30">
                          <div>
                            <div className="font-medium text-foreground">{ref.name}</div>
                            <div className="font-mono text-[10px] text-foreground-muted">
                              {ref.company} | {ref.relationship}
                            </div>
                          </div>
                          {ref.contactable ? (
                            <span className="font-mono text-[10px] text-green-400 px-2 py-1 bg-green-500/10 rounded-full">
                              Available to Contact
                            </span>
                          ) : (
                            <span className="font-mono text-[10px] text-foreground-muted px-2 py-1 bg-white/5 rounded-full">
                              Confidential
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {submissionTab === "materials" && (
                <div>
                  <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-4">
                    Work Samples ({selectedBidData.submission.workSamples.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedBidData.submission.workSamples.map(sample => (
                      <div key={sample.id} className="bg-white/5 rounded-xl border border-border/30 overflow-hidden">
                        {sample.type === "video" && (
                          <div className="aspect-video bg-black/50 relative flex items-center justify-center">
                            <div className="absolute inset-0 bg-gradient-to-br from-accent/20 to-transparent" />
                            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
                              <Play className="w-8 h-8 text-white ml-1" />
                            </div>
                          </div>
                        )}
                        {sample.type === "link" && (
                          <div className="aspect-video bg-gradient-to-br from-accent/10 to-accent/5 flex items-center justify-center">
                            <ExternalLink className="w-12 h-12 text-accent/50" />
                          </div>
                        )}
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="font-medium text-foreground">{sample.title}</div>
                            <span className="font-mono text-[10px] text-accent shrink-0">{sample.client}</span>
                          </div>
                          <p className="text-sm text-foreground-muted">{sample.description}</p>
                          <Button variant="ghost" size="sm" className="mt-3 text-accent hover:text-accent hover:bg-accent/10 -ml-2">
                            {sample.type === "video" ? "Watch Video" : "View Case Study"}
                            <ExternalLink className="w-3 h-3 ml-2" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {submissionTab === "budget" && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                      Proposed Budget Breakdown
                    </div>
                    <div className="font-display text-2xl font-bold text-foreground">
                      ${selectedBidData.submission.proposedBudget.total.toLocaleString()}
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    {selectedBidData.submission.proposedBudget.breakdown.map((line, i) => (
                      <div key={i} className="flex items-start justify-between p-4 bg-white/5 rounded-xl border border-border/30">
                        <div className="flex-1">
                          <div className="font-medium text-foreground">{line.category}</div>
                          {line.notes && (
                            <div className="font-mono text-[10px] text-foreground-muted mt-1">{line.notes}</div>
                          )}
                        </div>
                        <div className="font-mono text-lg text-foreground">
                          ${line.amount.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Budget Visualization */}
                  <div className="mt-6 p-4 bg-white/5 rounded-xl border border-border/30">
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                      Budget Distribution
                    </div>
                    <div className="flex h-8 rounded-lg overflow-hidden">
                      {selectedBidData.submission.proposedBudget.breakdown.map((line, i) => {
                        const percentage = (line.amount / selectedBidData.submission.proposedBudget.total) * 100
                        const colors = ["bg-accent", "bg-blue-500", "bg-purple-500", "bg-pink-500", "bg-orange-500", "bg-green-500"]
                        return (
                          <div 
                            key={i} 
                            className={cn(colors[i % colors.length], "relative group")}
                            style={{ width: `${percentage}%` }}
                          >
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-background border border-border/50 rounded-lg px-2 py-1 whitespace-nowrap z-10">
                              <div className="font-mono text-[10px] text-foreground">{line.category}: {percentage.toFixed(0)}%</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-3">
                      {selectedBidData.submission.proposedBudget.breakdown.map((line, i) => {
                        const colors = ["bg-accent", "bg-blue-500", "bg-purple-500", "bg-pink-500", "bg-orange-500", "bg-green-500"]
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <div className={cn("w-2 h-2 rounded-full", colors[i % colors.length])} />
                            <span className="font-mono text-[10px] text-foreground-muted">{line.category}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {submissionTab === "timeline" && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                      Proposed Timeline
                    </div>
                    <div className="font-display text-xl font-bold text-foreground">
                      {selectedBidData.submission.proposedTimeline.totalWeeks} Weeks Total
                    </div>
                  </div>

                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-6 top-0 bottom-0 w-px bg-border/50" />

                    <div className="space-y-6">
                      {selectedBidData.submission.proposedTimeline.phases.map((phase, i) => (
                        <div key={i} className="relative flex gap-4">
                          <div className="w-12 h-12 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center z-10">
                            <span className="font-mono text-sm text-accent">{i + 1}</span>
                          </div>
                          <div className="flex-1 p-4 bg-white/5 rounded-xl border border-border/30">
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-display font-bold text-foreground">{phase.phase}</div>
                              <div className="font-mono text-sm text-accent">{phase.duration}</div>
                            </div>
                            <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                              Deliverables
                            </div>
                            <ul className="space-y-1">
                              {phase.deliverables.map((d, j) => (
                                <li key={j} className="text-sm text-foreground-secondary flex items-center gap-2">
                                  <span className="w-1 h-1 bg-accent rounded-full" />
                                  {d}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {submissionTab === "team" && (
                <div>
                  <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-4">
                    Proposed Team ({selectedBidData.submission.proposedTeam.length} members)
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedBidData.submission.proposedTeam.map((member, i) => (
                      <div key={i} className="flex items-start gap-4 p-4 bg-white/5 rounded-xl border border-border/30">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent/30 to-accent/10 flex items-center justify-center">
                          <Users className="w-6 h-6 text-accent" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{member.name}</div>
                          <div className="font-mono text-sm text-accent">{member.role}</div>
                          <div className="font-mono text-[10px] text-foreground-muted mt-1">{member.experience}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedBidData.submission.proposedTeam.some(m => m.name === "TBD") && (
                    <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                      <div className="flex items-center gap-2 text-yellow-400">
                        <Briefcase className="w-4 h-4" />
                        <span className="font-mono text-sm">Some team positions are marked as TBD - consider requesting clarification</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {submissionTab === "payment" && (
                <div className="space-y-6">
                  {/* Payment Type Badge */}
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                      Preferred Payment Structure
                    </div>
                    <span className={cn(
                      "font-mono text-sm px-3 py-1 rounded-full border capitalize",
                      selectedBidData.submission.paymentTerms.type === "fixed" && "bg-blue-900/30 text-blue-100 border-blue-400/40",
                      selectedBidData.submission.paymentTerms.type === "hourly" && "bg-purple-900/30 text-purple-100 border-purple-400/40",
                      selectedBidData.submission.paymentTerms.type === "retainer" && "bg-green-900/30 text-green-100 border-green-400/40",
                      selectedBidData.submission.paymentTerms.type === "milestone" && "bg-accent/10 text-accent border-accent/30"
                    )}>
                      {selectedBidData.submission.paymentTerms.type === "milestone" ? "Milestone-Based" : selectedBidData.submission.paymentTerms.type}
                      {selectedBidData.submission.paymentTerms.rate && ` — ${selectedBidData.submission.paymentTerms.rate}`}
                    </span>
                  </div>

                  {/* Payment Schedule Table */}
                  <div className="bg-white/5 rounded-xl border border-border/30 overflow-hidden">
                    <div className="p-4 border-b border-border/30">
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-1">
                        Payment Schedule
                      </div>
                      <div className="text-sm text-foreground-secondary">
                        Net {selectedBidData.submission.paymentTerms.netTerms} payment terms
                      </div>
                    </div>
                    
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border/30 bg-white/5">
                          <th className="text-left font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-3 px-4">Milestone</th>
                          <th className="text-right font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-3 px-4">%</th>
                          <th className="text-right font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-3 px-4">Amount</th>
                          <th className="text-left font-mono text-[10px] text-foreground-muted uppercase tracking-wider py-3 px-4">Timing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBidData.submission.paymentTerms.schedule.map((item, i) => (
                          <tr key={i} className="border-b border-border/20 last:border-0">
                            <td className="py-3 px-4 text-sm text-foreground">{item.milestone}</td>
                            <td className="py-3 px-4 text-right font-mono text-sm text-foreground-muted">{item.percentage}%</td>
                            <td className="py-3 px-4 text-right font-mono text-sm text-foreground">${item.amount.toLocaleString()}</td>
                            <td className="py-3 px-4 text-sm text-foreground-muted">{item.timing}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-accent/5">
                          <td className="py-3 px-4 font-mono text-sm font-bold text-foreground">Total</td>
                          <td className="py-3 px-4 text-right font-mono text-sm text-foreground-muted">100%</td>
                          <td className="py-3 px-4 text-right font-mono text-sm font-bold text-accent">
                            ${selectedBidData.submission.paymentTerms.schedule.reduce((sum, item) => sum + item.amount, 0).toLocaleString()}
                          </td>
                          <td className="py-3 px-4"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Payment Notes */}
                  {selectedBidData.submission.paymentTerms.notes && (
                    <div className="p-4 bg-white/5 rounded-xl border border-border/30">
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                        Additional Notes
                      </div>
                      <p className="text-sm text-foreground-secondary">
                        {selectedBidData.submission.paymentTerms.notes}
                      </p>
                    </div>
                  )}

                  {/* Visual breakdown */}
                  <div className="p-4 bg-white/5 rounded-xl border border-border/30">
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                      Payment Distribution
                    </div>
                    <div className="flex rounded-lg overflow-hidden h-8">
                      {selectedBidData.submission.paymentTerms.schedule.map((item, i) => (
                        <div 
                          key={i}
                          className={cn(
                            "flex items-center justify-center text-[10px] font-mono text-white",
                            i === 0 && "bg-accent",
                            i === 1 && "bg-accent/80",
                            i === 2 && "bg-accent/60",
                            i === 3 && "bg-accent/50",
                            i === 4 && "bg-accent/40",
                            i === 5 && "bg-accent/30"
                          )}
                          style={{ width: `${item.percentage}%` }}
                        >
                          {item.percentage > 10 && `${Math.round(item.percentage)}%`}
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {selectedBidData.submission.paymentTerms.schedule.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] text-foreground-muted">
                          <div className={cn(
                            "w-2 h-2 rounded-full",
                            i === 0 && "bg-accent",
                            i === 1 && "bg-accent/80",
                            i === 2 && "bg-accent/60",
                            i === 3 && "bg-accent/50",
                            i === 4 && "bg-accent/40",
                            i === 5 && "bg-accent/30"
                          )} />
                          {item.milestone}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {submissionTab === "feedback" && (
                <div className="space-y-6">
                  {/* Version History Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                      Feedback & Revisions
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowVersionHistory(!showVersionHistory)}
                      className="border-border/50 text-foreground/80 hover:text-foreground"
                    >
                      <History className="w-4 h-4 mr-2" />
                      Version History ({selectedBidData.versions.length})
                    </Button>
                  </div>

                  {/* Version History Panel */}
                  {showVersionHistory && (
                    <div className="p-4 bg-white/5 rounded-xl border border-border/30">
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-3">
                        Submission Versions
                      </div>
                      <div className="space-y-3">
                        {selectedBidData.versions.map((version, i) => (
                          <div 
                            key={version.version} 
                            className={cn(
                              "flex items-start justify-between p-3 rounded-lg border",
                              version.version === selectedBidData.currentVersion 
                                ? "bg-accent/10 border-accent/30" 
                                : "bg-white/5 border-border/30"
                            )}
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-mono text-sm font-bold text-foreground">V{version.version}</span>
                                {version.version === selectedBidData.currentVersion && (
                                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-accent/20 text-accent">Current</span>
                                )}
                                {version.score && (
                                  <span className={cn("font-mono text-sm", getScoreColor(version.score))}>
                                    Score: {version.score}
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[10px] text-foreground-muted mb-2">
                                Submitted {version.submittedAt} | {version.amount}
                              </div>
                              <ul className="space-y-1">
                                {version.changes.map((change, j) => (
                                  <li key={j} className="text-sm text-foreground-secondary flex items-center gap-2">
                                    <span className="w-1 h-1 bg-accent rounded-full" />
                                    {change}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Existing Feedback Threads */}
                  {selectedBidData.feedback.length > 0 ? (
                    <div className="space-y-4">
                      {selectedBidData.feedback.map((item) => (
                        <div key={item.id} className="bg-white/5 rounded-xl border border-border/30 overflow-hidden">
                          {/* Your message */}
                          <div className="p-4 border-b border-border/20">
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                                <span className="font-mono text-[10px] text-accent">You</span>
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium text-foreground">{item.sentBy}</span>
                                  <span className={cn(
                                    "font-mono text-[10px] px-2 py-0.5 rounded-full capitalize",
                                    item.type === "question" && "bg-blue-900/30 text-blue-100",
                                    item.type === "revision_request" && "bg-orange-900/30 text-orange-100",
                                    item.type === "clarification" && "bg-yellow-900/30 text-yellow-100"
                                  )}>
                                    {item.type.replace("_", " ")}
                                  </span>
                                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-foreground-muted capitalize">
                                    {item.category}
                                  </span>
                                </div>
                                <p className="text-sm text-foreground-secondary mb-1">{item.message}</p>
                                <div className="font-mono text-[10px] text-foreground-muted">{item.sentAt}</div>
                              </div>
                            </div>
                          </div>

                          {/* Partner response */}
                          {item.response ? (
                            <div className="p-4 bg-accent/5">
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                                  <Users className="w-4 h-4 text-purple-400" />
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-foreground">{selectedBidData.vendor}</span>
                                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-green-900/30 text-green-100">
                                      Responded
                                    </span>
                                  </div>
                                  <p className="text-sm text-foreground-secondary mb-2">{item.response.message}</p>
                                  {item.response.attachments && item.response.attachments.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-2">
                                      {item.response.attachments.map((att, i) => (
                                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-lg">
                                          <Paperclip className="w-3 h-3 text-foreground-muted" />
                                          <span className="font-mono text-[10px] text-foreground">{att.name}</span>
                                          <Download className="w-3 h-3 text-accent cursor-pointer hover:text-accent/80" />
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="font-mono text-[10px] text-foreground-muted">{item.response.respondedAt}</div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="p-4 bg-yellow-500/5 flex items-center gap-2">
                              <AlertCircle className="w-4 h-4 text-yellow-400" />
                              <span className="font-mono text-sm text-yellow-400">Awaiting response from partner</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-foreground-muted">
                      <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="font-mono text-sm">No feedback sent yet</p>
                      <p className="text-sm text-foreground-muted/60 mt-1">Send questions or request revisions from this partner</p>
                    </div>
                  )}

                  {/* New Feedback Form */}
                  {!showFeedbackForm ? (
                    <Button
                      onClick={() => setShowFeedbackForm(true)}
                      variant="outline"
                      className="w-full border-accent/30 text-accent hover:bg-accent/10"
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Send Feedback or Request Revision
                    </Button>
                  ) : (
                    <div className="p-4 bg-white/5 rounded-xl border border-border/30 space-y-4">
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                        New Feedback
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                            Type
                          </label>
                          <div className="flex gap-2">
                            {[
                              { value: "question", label: "Question" },
                              { value: "clarification", label: "Clarification" },
                              { value: "revision_request", label: "Request Revision" },
                            ].map(opt => (
                              <button
                                key={opt.value}
                                onClick={() => setFeedbackType(opt.value as typeof feedbackType)}
                                className={cn(
                                  "flex-1 px-3 py-2 rounded-lg font-mono text-[10px] border transition-colors",
                                  feedbackType === opt.value
                                    ? "bg-accent/20 border-accent/50 text-accent"
                                    : "bg-white/5 border-border/30 text-foreground-muted hover:border-border/50"
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                            Category
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {["general", "budget", "timeline", "team", "scope"].map(cat => (
                              <button
                                key={cat}
                                onClick={() => setFeedbackCategory(cat as typeof feedbackCategory)}
                                className={cn(
                                  "px-3 py-2 rounded-lg font-mono text-[10px] border transition-colors capitalize",
                                  feedbackCategory === cat
                                    ? "bg-accent/20 border-accent/50 text-accent"
                                    : "bg-white/5 border-border/30 text-foreground-muted hover:border-border/50"
                                )}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                          Message
                        </label>
                        <textarea
                          value={feedbackMessage}
                          onChange={(e) => setFeedbackMessage(e.target.value)}
                          placeholder={
                            feedbackType === "revision_request" 
                              ? "Describe what changes you need in their revised submission..."
                              : feedbackType === "clarification"
                              ? "What specific clarification do you need?"
                              : "What would you like to ask about their submission?"
                          }
                          className="w-full h-32 px-4 py-3 bg-white/5 border border-border/30 rounded-xl text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:border-accent/50 resize-none"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setShowFeedbackForm(false)
                            setFeedbackMessage("")
                          }}
                          className="text-foreground-muted"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleSendFeedback}
                          disabled={!feedbackMessage.trim()}
                          className="bg-accent text-accent-foreground hover:bg-accent/90"
                        >
                          <Send className="w-4 h-4 mr-2" />
                          Send to Partner
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-border/30 flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={() => setShowSubmissionDetail(false)}
                className="text-foreground-muted"
              >
                Close
              </Button>
              <div className="flex items-center gap-3">
                {selectedBidData.status !== "awarded" && (
                  <Button 
                    variant="outline" 
                    className="border-accent/30 text-accent hover:bg-accent/10"
                    onClick={() => {
                      setSubmissionTab("feedback")
                      setShowFeedbackForm(true)
                    }}
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Send Feedback
                  </Button>
                )}
                {selectedBidData.status !== "awarded" && selectedBidData.status !== "shortlisted" && selectedBidData.recommendation === "advance" && (
                  <Button 
                    variant="outline"
                    onClick={() => handleShortlist(selectedBidData.id)}
                    className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                  >
                    Shortlist
                  </Button>
                )}
                {selectedBidData.status !== "awarded" && (
                  <Button 
                    onClick={() => {
                      handleAward(selectedBidData.id)
                      setShowSubmissionDetail(false)
                    }}
                    className="bg-accent text-accent-foreground hover:bg-accent/90"
                  >
                    Award Contract
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
