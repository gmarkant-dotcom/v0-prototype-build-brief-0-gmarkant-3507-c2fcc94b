"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { useLeadAgencyFilter } from "@/contexts/lead-agency-filter-context"
import { createClient } from "@/lib/supabase/client"
import {
  AlertTriangle,
  Clock,
  FileText,
  MessageSquare,
  DollarSign,
  ChevronRight,
  Building2,
  Check,
  X,
  Clock3,
  Send,
  Users,
  FolderOpen,
  Briefcase,
} from "lucide-react"

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoProfileChecklist = {
  capabilities: true,
  credentials: true,
  reel: true,
  legal: true,
  payments: true,
}

const demoOpenRFPs = [
  {
    id: "1",
    title: "Video Production Partner — Sports Creator Series",
    deadline: "8 days",
    status: "new",
  },
  {
    id: "2", 
    title: "Documentary Series — Tech Startup Profile",
    deadline: "12 days",
    status: "new",
  },
]

const demoActiveProjects = [
  {
    id: "1",
    name: "NWSL Creator Content Series",
    client: "Electric Animal",
    status: "In Production",
    nextMilestone: "Mid-point Delivery",
    nextMilestoneDate: "Feb 28, 2026",
    progress: 45,
  },
]

const demoUpcomingPayments = [
  {
    id: "1",
    project: "NWSL Creator Content Series",
    milestone: "Delivery",
    amount: 29100,
    date: "Apr 15, 2026",
    status: "pending",
  },
]

const demoProjectAlerts = [
  {
    id: "1",
    type: "deadline",
    title: "Mid-point Delivery Due",
    message: "NWSL Creator Content Series deliverables due in 5 days",
    date: "Feb 28, 2026",
    priority: "high",
    project: "NWSL Creator Content Series",
    actionUrl: "/partner/projects",
    actionLabel: "View Details",
  },
  {
    id: "2",
    type: "document",
    title: "Document Acknowledgment Required",
    message: "Please review and acknowledge the updated Brand Guidelines",
    date: "Mar 20, 2026",
    priority: "medium",
    project: "NWSL Creator Content Series",
    actionUrl: "/partner/projects",
    actionLabel: "Review Document",
  },
  {
    id: "3",
    type: "feedback",
    title: "Client Feedback Received",
    message: "New feedback on Episode 1 rough cut — 3 comments pending review",
    date: "Mar 18, 2026",
    priority: "medium",
    project: "NWSL Creator Content Series",
    actionUrl: "/partner/projects",
    actionLabel: "View Feedback",
  },
  {
    id: "4",
    type: "payment",
    title: "Payment Processing",
    message: "Your milestone payment of $29,100 is being processed",
    date: "Mar 15, 2026",
    priority: "low",
    project: "NWSL Creator Content Series",
    actionUrl: "/partner/payments",
    actionLabel: "View Payment",
  },
]

type PartnerSummary = {
  agency_relationships: number
  bids_submitted: number
  active_engagements: number
}

type DashboardActiveProject = {
  id: string
  name: string
  client: string
  status: string
  nextMilestone: string
  nextMilestoneDate: string
  progress: number
}

type ProfileChecklist = {
  capabilities: boolean
  credentials: boolean
  reel: boolean
  legal: boolean
  payments: boolean
}

export default function PartnerDashboardPage() {
  const isDemo = isDemoMode()
  const { connections, acceptInvitation, declineInvitation, isLoading: connectionsLoading } = useLeadAgencyFilter()
  const [summary, setSummary] = useState<PartnerSummary>({
    agency_relationships: 0,
    bids_submitted: 0,
    active_engagements: 0,
  })
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [fetchedActiveProjects, setFetchedActiveProjects] = useState<DashboardActiveProject[]>([])
  const [activeProjectsLoading, setActiveProjectsLoading] = useState(!isDemo)
  const [profileChecklist, setProfileChecklist] = useState<ProfileChecklist>({
    capabilities: false,
    credentials: false,
    reel: false,
    legal: false,
    payments: false,
  })

  useEffect(() => {
    if (isDemo) {
      setSummary({
        agency_relationships: 4,
        bids_submitted: 12,
        active_engagements: 1,
      })
      setSummaryLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/partner/summary", { credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (!cancelled && res.ok) {
          setSummary({
            agency_relationships: (data as PartnerSummary).agency_relationships ?? 0,
            bids_submitted: (data as PartnerSummary).bids_submitted ?? 0,
            active_engagements: (data as PartnerSummary).active_engagements ?? 0,
          })
        }
      } finally {
        if (!cancelled) setSummaryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo])

  useEffect(() => {
    if (isDemo) {
      setProfileChecklist(demoProfileChecklist)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || cancelled) return

        const profileQuery = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle()
        const profileData = (profileQuery.data || {}) as {
          capabilities?: unknown
          credentials?: unknown
          reel_url?: string | null
          legal_entity_name?: string | null
          legal_entity_type?: string | null
          legal_ein?: string | null
          legal_address?: string | null
          legal_state_of_incorporation?: string | null
        }

        const partnershipsRes = await fetch("/api/partnerships", { credentials: "same-origin" })
        const partnershipsPayload = (await partnershipsRes.json().catch(() => ({}))) as {
          partnerships?: Array<{
            id?: string
            status?: string | null
          }>
        }
        const partnerships = Array.isArray(partnershipsPayload.partnerships) ? partnershipsPayload.partnerships : []
        const activePartnership = partnerships.find((p) => String(p.status || "").toLowerCase() === "active")

        let paymentInfoComplete = false
        if (activePartnership?.id) {
          const riRes = await fetch(
            `/api/partner/rate-info?partnershipId=${encodeURIComponent(String(activePartnership.id))}`,
            { credentials: "same-origin" },
          )
          const riData = (await riRes.json().catch(() => ({}))) as {
            rate_info?: {
              hourly_rate?: string
              project_minimum?: string
              payment_terms_custom?: string
              notes?: string
            }
          }
          const ri = riData.rate_info || {}
          paymentInfoComplete = Boolean(
            String(ri.hourly_rate || "").trim() ||
              String(ri.project_minimum || "").trim() ||
              String(ri.payment_terms_custom || "").trim() ||
              String(ri.notes || "").trim(),
          )
        }

        const capabilities = Array.isArray(profileData.capabilities) ? profileData.capabilities : []
        const credentials = Array.isArray(profileData.credentials) ? profileData.credentials : []
        const reel = String(profileData.reel_url || "").trim()
        const legalComplete = Boolean(
          String(profileData.legal_entity_name || "").trim() &&
            String(profileData.legal_entity_type || "").trim() &&
            String(profileData.legal_ein || "").trim() &&
            String(profileData.legal_address || "").trim() &&
            String(profileData.legal_state_of_incorporation || "").trim(),
        )

        if (!cancelled) {
          setProfileChecklist({
            capabilities: capabilities.length > 0,
            credentials: credentials.length > 0,
            reel: reel.length > 0,
            legal: legalComplete,
            payments: paymentInfoComplete,
          })
        }
      } catch {
        if (!cancelled) {
          setProfileChecklist({
            capabilities: false,
            credentials: false,
            reel: false,
            legal: false,
            payments: false,
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isDemo])

  useEffect(() => {
    if (isDemo) {
      setFetchedActiveProjects([])
      setActiveProjectsLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setActiveProjectsLoading(true)
      try {
        const res = await fetch("/api/partner/projects", {
          credentials: "same-origin",
          cache: "no-store",
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        const raw = data?.projects
        const list = Array.isArray(raw) ? raw : []
        if (!cancelled && res.ok) {
          const mapped: DashboardActiveProject[] = []
          const seenProjectIds = new Set<string>()
          for (const item of list) {
            if (!item || typeof item !== "object") continue
            const p = item as Record<string, unknown>
            const id =
              p.project_id != null ? String(p.project_id).trim() : p.id != null ? String(p.id).trim() : ""
            if (!id || seenProjectIds.has(id)) continue
            seenProjectIds.add(id)
            const nameRaw =
              p.project_name != null ? String(p.project_name).trim() : p.name != null ? String(p.name).trim() : ""
            const name = nameRaw || "Project"
            const clientRaw =
              p.client_name != null && typeof p.client_name === "string"
                ? p.client_name.trim()
                : ""
            mapped.push({
              id,
              name,
              client: clientRaw || "—",
              status: "Awarded",
              nextMilestone: "—",
              nextMilestoneDate: "—",
              progress: 0,
            })
          }
          setFetchedActiveProjects(mapped)
        } else if (!cancelled) {
          setFetchedActiveProjects([])
        }
      } catch (e) {
        console.error("[partner/dashboard] /api/partner/projects", e)
        if (!cancelled) setFetchedActiveProjects([])
      } finally {
        if (!cancelled) setActiveProjectsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo])

  const executiveSummaryCards = (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="rounded-xl p-5 text-center border border-white/10 !bg-[#0C3535] shadow-sm text-white">
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center mx-auto mb-3">
          <Users className="w-5 h-5 !text-white" />
        </div>
        <div className="!text-white text-4xl font-bold font-display tabular-nums">
          {summaryLoading ? "—" : summary.agency_relationships}
        </div>
        <div className="text-white/80 text-xs uppercase tracking-wider mt-1">Agency Relationships</div>
      </div>
      <div className="rounded-xl p-5 text-center border border-white/10 !bg-[#0C3535] shadow-sm text-white">
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center mx-auto mb-3">
          <FileText className="w-5 h-5 !text-white" />
        </div>
        <div className="!text-white text-4xl font-bold font-display tabular-nums">
          {summaryLoading ? "—" : summary.bids_submitted}
        </div>
        <div className="text-white/80 text-xs uppercase tracking-wider mt-1">Bids Submitted</div>
      </div>
      <div className="rounded-xl p-5 text-center border border-white/10 !bg-[#0C3535] shadow-sm text-white">
        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center mx-auto mb-3">
          <FolderOpen className="w-5 h-5 !text-white" />
        </div>
        <div className="!text-white text-4xl font-bold font-display tabular-nums">
          {summaryLoading ? "—" : summary.active_engagements}
        </div>
        <div className="text-white/80 text-xs uppercase tracking-wider mt-1">Active Engagements</div>
      </div>
    </div>
  )

  // Use demo data or computed checks from saved partner profile fields.
  const profileCompletion = {
    capabilities: profileChecklist.capabilities ? 100 : 0,
    credentials: profileChecklist.credentials ? 100 : 0,
    reel: profileChecklist.reel ? 100 : 0,
    legal: profileChecklist.legal ? 100 : 0,
    payments: profileChecklist.payments ? 100 : 0,
  }
  const totalCompletion = Math.round(
    Object.values(profileCompletion).reduce((a, b) => a + b, 0) / Object.keys(profileCompletion).length
  )
  const profileCompletionBar = totalCompletion < 100 && (
    <div className="bg-[#0C3535]/5 border border-[#0C3535]/20 rounded-xl px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display font-bold text-base text-[#0C3535]">Profile {totalCompletion}% Complete</h3>
          </div>
          <div className="mt-2 h-2 bg-white/80 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#0C3535] rounded-full transition-all"
              style={{ width: `${totalCompletion}%` }}
            />
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="bg-[#0C3535] text-white hover:bg-[#0C3535]/90 shrink-0">
              Complete Profile →
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href="/partner/profile">Company Profile & Capabilities</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/partner/legal">Legal & Compliance</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/partner/payments">Payment Setup</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
  const openRFPs = isDemo ? demoOpenRFPs : []
  const activeProjects: DashboardActiveProject[] = isDemo ? demoActiveProjects : fetchedActiveProjects
  const upcomingPayments = isDemo ? demoUpcomingPayments : []
  const projectAlerts = isDemo ? demoProjectAlerts : []
  
  // Show simplified empty state for production users (after awarded projects load)
  if (!isDemo && !activeProjectsLoading && activeProjects.length === 0 && openRFPs.length === 0) {
    return (
      <PartnerLayout>
        <div className="space-y-8">
          {profileCompletionBar}
          {executiveSummaryCards}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="font-display font-bold text-3xl text-[#0C3535]">
                Welcome to Ligament
              </h1>
              <p className="text-gray-600 mt-1">
                Complete your profile to start receiving project opportunities
              </p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center max-w-xl">
            <Briefcase className="w-12 h-12 mx-auto mb-4 text-gray-300" aria-hidden />
            <h3 className="font-display font-bold text-xl text-[#0C3535] mb-2">No active projects yet</h3>
            <p className="text-gray-600">
              You don&apos;t have any active projects yet. Open RFPs from your lead agency partners will appear in
              your Open RFPs inbox.
            </p>
            <Button asChild variant="outline" className="mt-6 border-[#0C3535]/30 text-[#0C3535] hover:bg-[#0C3535]/5">
              <Link href="/partner/rfps">Go to Open RFPs</Link>
            </Button>
          </div>
        </div>
      </PartnerLayout>
    )
  }
  
  return (
    <PartnerLayout>
      <div className="space-y-8">
        {profileCompletionBar}
        {executiveSummaryCards}

        {/* Welcome Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display font-bold text-3xl text-[#0C3535]">
              Welcome back{isDemo ? ", Partner" : ""}
            </h1>
            <p className="text-gray-600 mt-1">
              Here&apos;s an overview of your partner account and opportunities
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider">Profile Completion</div>
            <div className="font-display font-bold text-3xl text-[#0C3535]">{totalCompletion}%</div>
          </div>
        </div>
        
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <div className="font-display font-bold text-3xl text-[#0C3535]">{openRFPs.length}</div>
            <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mt-1">Open RFPs</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <div className="font-display font-bold text-3xl text-[#0C3535]">
              {activeProjectsLoading ? "—" : activeProjects.length}
            </div>
            <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mt-1">Active Projects</div>
          </div>
          <div className="bg-white rounded-xl border border-green-200 p-5 text-center bg-green-50">
            <div className="font-display font-bold text-3xl text-green-600">$58,200</div>
            <div className="font-mono text-[10px] text-green-600 uppercase tracking-wider mt-1">Paid to Date</div>
          </div>
          <div className="bg-white rounded-xl border border-yellow-200 p-5 text-center bg-yellow-50">
            <div className="font-display font-bold text-3xl text-yellow-600">$29,100</div>
            <div className="font-mono text-[10px] text-yellow-600 uppercase tracking-wider mt-1">Pending</div>
          </div>
        </div>
        
        {/* Lead Agency Connections */}
        {connections.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-[#0C3535]" />
                <h2 className="font-display font-bold text-lg text-[#0C3535]">Lead Agency Connections</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-600">
                  {connections.filter(c => c.status === 'confirmed').length} Confirmed
                </span>
                {connections.filter(c => c.status === 'pending').length > 0 && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-600">
                    {connections.filter(c => c.status === 'pending').length} Pending
                  </span>
                )}
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connections.map((connection) => {
                const getStatusConfig = () => {
                  switch (connection.status) {
                    case 'confirmed':
                      return { 
                        bg: 'bg-green-50', 
                        border: 'border-green-200', 
                        icon: <Check className="w-4 h-4 text-green-600" />,
                        label: 'Confirmed',
                        labelBg: 'bg-green-100 text-green-700'
                      }
                    case 'accepted':
                      return { 
                        bg: 'bg-blue-50', 
                        border: 'border-blue-200', 
                        icon: <Clock3 className="w-4 h-4 text-blue-600" />,
                        label: 'Awaiting Confirmation',
                        labelBg: 'bg-blue-100 text-blue-700'
                      }
                    case 'pending':
                      return { 
                        bg: 'bg-yellow-50', 
                        border: 'border-yellow-200', 
                        icon: <Send className="w-4 h-4 text-yellow-600" />,
                        label: 'Invitation Pending',
                        labelBg: 'bg-yellow-100 text-yellow-700'
                      }
                    case 'declined':
                      return { 
                        bg: 'bg-gray-50', 
                        border: 'border-gray-200', 
                        icon: <X className="w-4 h-4 text-gray-400" />,
                        label: 'Declined',
                        labelBg: 'bg-gray-100 text-gray-500'
                      }
                    default:
                      return { 
                        bg: 'bg-gray-50', 
                        border: 'border-gray-200', 
                        icon: null,
                        label: 'Unknown',
                        labelBg: 'bg-gray-100 text-gray-500'
                      }
                  }
                }
                
                const statusConfig = getStatusConfig()
                
                return (
                  <div 
                    key={connection.id} 
                    className={cn(
                      "p-4 rounded-lg border transition-colors",
                      statusConfig.bg,
                      statusConfig.border
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#0C3535] flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-white">
                          {connection.agencyName.split(' ').map(w => w[0]).join('').slice(0, 2)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-display font-bold text-sm text-[#0C3535] truncate">
                          {connection.agencyName}
                        </h4>
                        <p className="font-mono text-[10px] text-gray-500 mt-0.5">
                          {connection.agencyLocation}
                        </p>
                        <div className="flex items-center gap-1.5 mt-2">
                          {statusConfig.icon}
                          <span className={cn(
                            "font-mono text-[10px] px-1.5 py-0.5 rounded",
                            statusConfig.labelBg
                          )}>
                            {statusConfig.label}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {connection.invitationMessage && connection.status === 'pending' && (
                      <p className="text-xs text-gray-600 mt-3 italic border-t border-gray-200/50 pt-3">
                        &quot;{connection.invitationMessage}&quot;
                      </p>
                    )}
                    
                    {connection.status === 'pending' && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200/50">
                        <Button 
                          size="sm" 
                          onClick={() => acceptInvitation(connection.id)}
                          className="flex-1 bg-[#0C3535] hover:bg-[#0C3535]/90 text-white text-xs"
                        >
                          Accept
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => declineInvitation(connection.id)}
                          className="flex-1 text-xs text-gray-900 border-gray-300"
                        >
                          Decline
                        </Button>
                      </div>
                    )}
                    
                    {connection.status === 'confirmed' && (
                      <div className="mt-3 pt-3 border-t border-green-200/50">
                        <p className="font-mono text-[10px] text-green-600">
                          Connected since {connection.confirmedAt ? new Date(connection.confirmedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'N/A'}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        
        {/* Project Alerts */}
        {projectAlerts.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-lg text-[#0C3535]">Project Alerts</h2>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                {projectAlerts.filter(a => a.priority === "high").length} urgent
              </span>
            </div>
            <div className="space-y-3">
              {projectAlerts.map((alert) => {
                const getAlertIcon = () => {
                  switch (alert.type) {
                    case "deadline": return <Clock className="w-4 h-4" />
                    case "document": return <FileText className="w-4 h-4" />
                    case "feedback": return <MessageSquare className="w-4 h-4" />
                    case "payment": return <DollarSign className="w-4 h-4" />
                    default: return <AlertTriangle className="w-4 h-4" />
                  }
                }
                
                const getPriorityStyles = () => {
                  switch (alert.priority) {
                    case "high": return "bg-red-50 border-red-200 text-red-600"
                    case "medium": return "bg-yellow-50 border-yellow-200 text-yellow-600"
                    case "low": return "bg-green-50 border-green-200 text-green-600"
                    default: return "bg-gray-50 border-gray-200 text-gray-600"
                  }
                }
                
                return (
                  <div key={alert.id} className={cn(
                    "flex items-start gap-4 p-4 rounded-lg border",
                    alert.priority === "high" ? "bg-red-50 border-red-200" : "bg-white border-gray-200"
                  )}>
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                      getPriorityStyles()
                    )}>
                      {getAlertIcon()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-display font-bold text-sm text-[#0C3535]">{alert.title}</span>
                        <span className={cn(
                          "font-mono text-[10px] px-1.5 py-0.5 rounded uppercase",
                          getPriorityStyles()
                        )}>
                          {alert.priority}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-1">{alert.message}</p>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[10px] text-gray-500">{alert.project}</span>
                        <span className="font-mono text-[10px] text-gray-400">|</span>
                        <span className="font-mono text-[10px] text-gray-500">{alert.date}</span>
                      </div>
                    </div>
                    <Link href={alert.actionUrl} className="shrink-0">
                      <Button size="sm" className="text-xs bg-[#0C3535] text-white hover:bg-[#0C3535]/90">
                        {alert.actionLabel}
                        <ChevronRight className="w-3 h-3 ml-1" />
                      </Button>
                    </Link>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Open RFPs */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-lg text-[#0C3535]">Open RFPs</h2>
              <Link href="/partner/rfps" className="font-mono text-xs text-[#0C3535] hover:underline">
                View All →
              </Link>
            </div>
            <div className="space-y-3">
              {openRFPs.map((rfp) => (
                <Link 
                  key={rfp.id} 
                  href="/partner/rfps"
                  className="block p-4 rounded-lg border border-gray-200 hover:border-[#0C3535]/30 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-display font-bold text-sm text-[#0C3535]">{rfp.title}</h4>
                      <div className="font-mono text-[10px] text-gray-500 mt-1">Deadline: {rfp.deadline}</div>
                    </div>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-[#C8F53C] text-[#0C3535] uppercase">
                      {rfp.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
          
          {/* Active Projects */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-lg text-[#0C3535]">Active Projects</h2>
              <Link href="/partner/projects" className="font-mono text-xs text-[#0C3535] hover:underline">
                View All →
              </Link>
            </div>
            <div className="space-y-3">
              {activeProjectsLoading && !isDemo ? (
                <p className="text-sm text-gray-500 py-2">Loading projects…</p>
              ) : (
                activeProjects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/partner/projects/${encodeURIComponent(project.id)}`}
                    className="block p-4 rounded-lg border border-gray-200 hover:border-[#0C3535]/30 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-display font-bold text-sm text-[#0C3535]">{project.name}</h4>
                        <div className="font-mono text-[10px] text-gray-500 mt-0.5">for {project.client}</div>
                      </div>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        {project.status}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">Next: {project.nextMilestone}</span>
                        <span className="font-mono text-gray-500">{project.nextMilestoneDate}</span>
                      </div>
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0C3535] rounded-full"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
        
        {/* Upcoming Payments */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-lg text-[#0C3535]">Upcoming Payments</h2>
            <Link href="/partner/payments" className="font-mono text-xs text-[#0C3535] hover:underline">
              Payment Settings →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Project</th>
                  <th className="text-left font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Milestone</th>
                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Amount</th>
                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Date</th>
                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {upcomingPayments.map((payment) => (
                  <tr key={payment.id} className="border-b border-gray-100">
                    <td className="py-4 font-display font-bold text-sm text-[#0C3535]">{payment.project}</td>
                    <td className="py-4 text-sm text-gray-600">{payment.milestone}</td>
                    <td className="py-4 text-right font-mono text-sm text-[#0C3535]">${payment.amount.toLocaleString()}</td>
                    <td className="py-4 text-right font-mono text-xs text-gray-500">{payment.date}</td>
                    <td className="py-4 text-right">
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 capitalize">
                        {payment.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PartnerLayout>
  )
}
