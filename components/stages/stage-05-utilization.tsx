"use client"

import { useState } from "react"
import { StageHeader } from "@/components/stage-header"
import { EngagementContext } from "@/components/engagement-context"
import { GlassCard, GlassCardHeader } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { EmptyState } from "@/components/empty-state"
import { usePaidUser } from "@/contexts/paid-user-context"
import { AlertTriangle, CheckCircle, TrendingUp, Flag, MessageSquare, Send, FileText, Plus, Clock, DollarSign, ArrowRight, Eye, Edit3, X, Mail } from "lucide-react"

interface PartnerUtilizationInput {
  percentComplete: number
  lastUpdated: string
  updatedBy: string
  overageFlag: "none" | "at_risk" | "overburn" | "scope_change"
  overageNote?: string
  overageAmount?: number
}

interface ScopeChangeRequest {
  id: string
  vendor: string
  initiatedBy: "partner" | "agency"
  type: "add" | "reduce" | "modify"
  description: string
  amount: number
  justification: string
  status: "draft" | "submitted" | "under_review" | "approved" | "rejected"
  submittedAt?: string
  reviewedAt?: string
  reviewNotes?: string
}

interface PartnerContact {
  name: string
  role: string
  email: string
  phone: string
}

interface UtilizationRecord {
  id: string
  vendor: string
  discipline: string
  contracted: number
  spent: number
  remaining: number
  projectedOverage: number | null
  alerts: string[]
  partnerInput: PartnerUtilizationInput
  paymentType: "fixed" | "hourly" | "retainer" | "milestone"
  partnerContact: PartnerContact
}

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoUtilization: UtilizationRecord[] = [
  {
    id: "1",
    vendor: "Sample Production Studio",
    discipline: "Video Production",
    contracted: 97000,
    spent: 40740,
    remaining: 56260,
    projectedOverage: null,
    alerts: [],
    paymentType: "milestone",
    partnerInput: {
      percentComplete: 45,
      lastUpdated: "Mar 18, 2024",
      updatedBy: "Jake Morrison",
      overageFlag: "none"
    },
    partnerContact: {
      name: "Marcus Rodriguez",
      role: "Executive Producer",
      email: "partner@demo.withligament.com",
      phone: "+1 (555) 876-5432"
    }
  },
  {
    id: "2",
    vendor: "Tandem Social",
    discipline: "Social Media",
    contracted: 48000,
    spent: 31200,
    remaining: 16800,
    projectedOverage: 8500,
    alerts: ["Pace suggests 18% overage by project end", "Consider change order"],
    paymentType: "retainer",
    partnerInput: {
      percentComplete: 65,
      lastUpdated: "Mar 17, 2024",
      updatedBy: "Maria Santos",
      overageFlag: "at_risk",
      overageNote: "Additional TikTok platform coverage not in original scope",
      overageAmount: 12000
    },
    partnerContact: {
      name: "Maria Santos",
      role: "Account Director",
      email: "maria@tandemsocial.com",
      phone: "+1 (555) 321-9876"
    }
  },
  {
    id: "3",
    vendor: "Roster Agency",
    discipline: "Talent Relations",
    contracted: 40000,
    spent: 11200,
    remaining: 28800,
    projectedOverage: null,
    alerts: ["Below expected pace — verify deliverable timeline"],
    paymentType: "hourly",
    partnerInput: {
      percentComplete: 28,
      lastUpdated: "Mar 15, 2024",
      updatedBy: "Maya Thompson",
      overageFlag: "scope_change",
      overageNote: "2 additional athletes requested for content series",
      overageAmount: 8000
    },
    partnerContact: {
      name: "Maya Thompson",
      role: "Talent Manager",
      email: "maya@rosteragency.com",
      phone: "+1 (555) 654-3210"
    }
  },
]

const demoScopeRequests: ScopeChangeRequest[] = [
  {
    id: "scr-001",
    vendor: "Tandem Social",
    initiatedBy: "partner",
    type: "add",
    description: "TikTok Platform Coverage",
    amount: 12000,
    justification: "Client has requested expansion to TikTok platform which was not included in original scope. Requires additional content adaptation, platform-specific strategy, and community management.",
    status: "submitted",
    submittedAt: "Mar 17, 2024"
  },
  {
    id: "scr-002",
    vendor: "Roster Agency",
    initiatedBy: "partner",
    type: "add",
    description: "Additional Athlete Talent (2)",
    amount: 8000,
    justification: "Two additional athletes have been requested for the content series to provide broader team representation. Includes talent booking, coordination, and release management.",
    status: "under_review",
    submittedAt: "Mar 15, 2024"
  },
]

const getOverageFlagStyle = (flag: PartnerUtilizationInput["overageFlag"]) => {
  switch (flag) {
    case "none":
      return "bg-green-900/30 text-green-100 border-green-400/40"
    case "at_risk":
      return "bg-yellow-900/30 text-yellow-100 border-yellow-400/40"
    case "overburn":
      return "bg-red-900/30 text-red-100 border-red-400/40"
    case "scope_change":
      return "bg-purple-900/30 text-purple-100 border-purple-400/40"
  }
}

const getOverageFlagLabel = (flag: PartnerUtilizationInput["overageFlag"]) => {
  switch (flag) {
    case "none":
      return "On Track"
    case "at_risk":
      return "At Risk"
    case "overburn":
      return "Overburn"
    case "scope_change":
      return "Scope Change Needed"
  }
}

const getStatusStyle = (status: ScopeChangeRequest["status"]) => {
  switch (status) {
    case "draft":
      return "bg-gray-800/40 text-gray-100 border-gray-400/40"
    case "submitted":
      return "bg-blue-900/30 text-blue-100 border-blue-400/40"
    case "under_review":
      return "bg-yellow-900/30 text-yellow-100 border-yellow-400/40"
    case "approved":
      return "bg-green-900/30 text-green-100 border-green-400/40"
    case "rejected":
      return "bg-red-900/30 text-red-100 border-red-400/40"
  }
}

export function Stage05Utilization() {
  const isDemo = isDemoMode()
  const { checkFeatureAccess } = usePaidUser()
  const initialUtilization = isDemo ? demoUtilization : []
  const initialScopeRequests = isDemo ? demoScopeRequests : []
  
  const [utilization, setUtilization] = useState(initialUtilization)
  const [scopeRequests, setScopeRequests] = useState(initialScopeRequests)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tempPercent, setTempPercent] = useState<number>(0)
  const [tempFlag, setTempFlag] = useState<PartnerUtilizationInput["overageFlag"]>("none")
  const [tempNote, setTempNote] = useState("")
  const [tempAmount, setTempAmount] = useState<number | undefined>(undefined)
  const [showNewScopeRequest, setShowNewScopeRequest] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<ScopeChangeRequest | null>(null)
  const [newRequest, setNewRequest] = useState({
    vendor: "",
    type: "add" as "add" | "reduce" | "modify",
    description: "",
    amount: 0,
    justification: ""
  })

  const startEditing = (record: UtilizationRecord) => {
    setEditingId(record.id)
    setTempPercent(record.partnerInput.percentComplete)
    setTempFlag(record.partnerInput.overageFlag)
    setTempNote(record.partnerInput.overageNote || "")
    setTempAmount(record.partnerInput.overageAmount)
  }

  const saveEdit = (id: string) => {
    setUtilization(prev => prev.map(u => 
      u.id === id 
        ? {
            ...u,
            partnerInput: {
              ...u.partnerInput,
              percentComplete: tempPercent,
              overageFlag: tempFlag,
              overageNote: tempNote || undefined,
              overageAmount: tempAmount,
              lastUpdated: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
              updatedBy: "You"
            }
          }
        : u
    ))
    setEditingId(null)
  }

  const createScopeRequest = () => {
    const request: ScopeChangeRequest = {
      id: `scr-${Date.now()}`,
      vendor: newRequest.vendor,
      initiatedBy: "agency",
      type: newRequest.type,
      description: newRequest.description,
      amount: newRequest.amount,
      justification: newRequest.justification,
      status: "draft",
    }
    setScopeRequests([request, ...scopeRequests])
    setShowNewScopeRequest(false)
    setNewRequest({ vendor: "", type: "add", description: "", amount: 0, justification: "" })
  }

  const updateRequestStatus = (id: string, status: ScopeChangeRequest["status"], notes?: string) => {
    setScopeRequests(prev => prev.map(r => 
      r.id === id 
        ? { ...r, status, reviewedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), reviewNotes: notes }
        : r
    ))
    setSelectedRequest(null)
  }

  // Calculate summary stats
  const flaggedVendors = utilization.filter(u => u.alerts.length > 0 || u.partnerInput.overageFlag !== "none")
  const totalProjected = utilization.reduce((sum, u) => sum + (u.projectedOverage || 0), 0)
  const pendingRequests = scopeRequests.filter(r => r.status === "submitted" || r.status === "under_review")
  const totalPendingAmount = pendingRequests.reduce((sum, r) => sum + r.amount, 0)

  if (!isDemo) {
    return (
      <div className="p-8 max-w-6xl">
        <StageHeader
          stageNumber="05"
          title="Utilization Tracking"
          subtitle="Track scope completion and budget utilization. Partners report progress and flag potential overages."
          aiPowered
        />
        <EmptyState
          title="No Active Utilization"
          description="Once projects are underway and vendors are delivering work, utilization tracking and scope management will appear here."
          icon="project"
        />
      </div>
    )
  }
  
  return (
    <div className="p-8 max-w-6xl">
      <StageHeader
        stageNumber="05"
        title="Utilization Tracking"
        subtitle="Track scope completion and budget utilization. Partners report progress and flag potential overages."
        aiPowered
      />
      
      <EngagementContext
        agency="Electric Animal"
        project="NWSL Creator Content Series"
        budget="$250K"
        className="mb-8"
      />

      {/* AI Executive Summary - Moved to Top */}
      <GlassCard className="mb-8 border-accent/30 bg-accent/5">
        <GlassCardHeader
          label="AI Executive Summary"
          title="Status Overview"
          badge={`${flaggedVendors.length} items need attention`}
        />
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-white/5 rounded-lg border border-border/30 text-center">
            <div className="font-display font-bold text-2xl text-foreground">
              {utilization.filter(u => u.partnerInput.overageFlag === "none").length}/{utilization.length}
            </div>
            <div className="font-mono text-[10px] text-green-400 uppercase">On Track</div>
          </div>
          <div className="p-4 bg-white/5 rounded-lg border border-border/30 text-center">
            <div className="font-display font-bold text-2xl text-yellow-400">
              {utilization.filter(u => u.partnerInput.overageFlag === "at_risk" || u.partnerInput.overageFlag === "overburn").length}
            </div>
            <div className="font-mono text-[10px] text-yellow-400 uppercase">At Risk / Overburn</div>
          </div>
          <div className="p-4 bg-white/5 rounded-lg border border-border/30 text-center">
            <div className="font-display font-bold text-2xl text-purple-400">
              {pendingRequests.length}
            </div>
            <div className="font-mono text-[10px] text-purple-400 uppercase">Pending Scope Requests</div>
          </div>
          <div className="p-4 bg-white/5 rounded-lg border border-border/30 text-center">
            <div className="font-display font-bold text-2xl text-foreground">
              ${totalPendingAmount.toLocaleString()}
            </div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Pending Amount</div>
          </div>
        </div>

        {/* Action Items */}
        <div className="space-y-3">
          {flaggedVendors.map((u) => (
            <div key={u.vendor} className="p-4 rounded-lg bg-white/5 border border-border/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-foreground font-bold">
                    {u.vendor}
                  </span>
                  <span className={cn(
                    "font-mono text-[10px] px-2 py-0.5 rounded-full border",
                    getOverageFlagStyle(u.partnerInput.overageFlag)
                  )}>
                    {getOverageFlagLabel(u.partnerInput.overageFlag)}
                  </span>
                </div>
                {u.partnerInput.overageAmount && (
                  <span className="font-mono text-sm text-yellow-400">
                    +${u.partnerInput.overageAmount.toLocaleString()} requested
                  </span>
                )}
              </div>
              
              <div className="space-y-1.5">
                {u.alerts.map((alert, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
                    <span className="text-sm text-foreground-secondary">{alert}</span>
                  </div>
                ))}
                {u.partnerInput.overageNote && (
                  <div className="flex items-start gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
                    <span className="text-sm text-foreground-secondary">
                      Partner note: {u.partnerInput.overageNote}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-accent/30 text-accent hover:bg-accent/10 font-mono text-xs"
                  onClick={() => {
                    const existing = scopeRequests.find(r => r.vendor === u.vendor && (r.status === "submitted" || r.status === "under_review"))
                    if (existing) setSelectedRequest(existing)
                  }}
                >
                  <Eye className="w-3 h-3 mr-1.5" />
                  Review Request
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border text-foreground hover:text-foreground font-mono text-xs"
                >
                  <Send className="w-3 h-3 mr-1.5" />
                  Message Partner
                </Button>
              </div>
            </div>
          ))}
          
          {flaggedVendors.length === 0 && (
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-sm text-green-400">All vendors are on track. No action items at this time.</span>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Scope Change Requests Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <GlassCardHeader className="mb-0">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-accent" />
              <span>Scope Change Requests</span>
            </div>
          </GlassCardHeader>
          <Button
            size="sm"
            onClick={() => setShowNewScopeRequest(true)}
            className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono text-xs"
          >
            <Plus className="w-3 h-3 mr-1.5" />
            Draft New Request
          </Button>
        </div>

        {/* New Request Form */}
        {showNewScopeRequest && (
          <GlassCard className="mb-4 border-accent/30">
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-sm text-accent">New Scope Change Request (Agency Initiated)</span>
              <button onClick={() => setShowNewScopeRequest(false)} className="text-foreground hover:text-accent">
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-1">Partner</label>
                <select 
                  value={newRequest.vendor}
                  onChange={(e) => setNewRequest({...newRequest, vendor: e.target.value})}
                  className="w-full px-3 py-2 bg-white/10 border border-border/30 rounded font-mono text-sm text-foreground"
                >
                  <option value="">Select partner...</option>
                  {utilization.map(u => (
                    <option key={u.id} value={u.vendor}>{u.vendor}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-1">Type</label>
                <select 
                  value={newRequest.type}
                  onChange={(e) => setNewRequest({...newRequest, type: e.target.value as "add" | "reduce" | "modify"})}
                  className="w-full px-3 py-2 bg-white/10 border border-border/30 rounded font-mono text-sm text-foreground"
                >
                  <option value="add">Add Scope (+$)</option>
                  <option value="reduce">Reduce Scope (-$)</option>
                  <option value="modify">Modify (Budget Neutral)</option>
                </select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-1">Description</label>
                <input 
                  type="text"
                  placeholder="Brief description..."
                  value={newRequest.description}
                  onChange={(e) => setNewRequest({...newRequest, description: e.target.value})}
                  className="w-full px-3 py-2 bg-white/10 border border-border/30 rounded font-mono text-sm text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-1">Amount ($)</label>
                <input 
                  type="number"
                  placeholder="0"
                  value={newRequest.amount || ""}
                  onChange={(e) => setNewRequest({...newRequest, amount: Number(e.target.value)})}
                  className="w-full px-3 py-2 bg-white/10 border border-border/30 rounded font-mono text-sm text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
            </div>
            
            <div className="mb-4">
              <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-1">Justification</label>
              <textarea 
                placeholder="Explain the reason for this scope change..."
                value={newRequest.justification}
                onChange={(e) => setNewRequest({...newRequest, justification: e.target.value})}
                rows={3}
                className="w-full px-3 py-2 bg-white/10 border border-border/30 rounded font-mono text-sm text-foreground placeholder:text-foreground-muted/50 resize-none"
              />
            </div>
            
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={createScopeRequest}
                disabled={!newRequest.vendor || !newRequest.description}
                className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono text-xs"
              >
                Create Draft
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowNewScopeRequest(false)}
                  className="border-border text-foreground hover:text-foreground font-mono text-xs"
              >
                Cancel
              </Button>
            </div>
          </GlassCard>
        )}

        {/* Scope Request Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scopeRequests.map((request) => (
            <GlassCard key={request.id} className="cursor-pointer hover:border-accent/30 transition-colors" onClick={() => setSelectedRequest(request)}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-display font-bold text-foreground">{request.description}</div>
                  <div className="font-mono text-[10px] text-foreground-muted">{request.vendor} | {request.id}</div>
                </div>
                <span className={cn(
                  "font-mono text-[10px] px-2 py-0.5 rounded-full border capitalize",
                  getStatusStyle(request.status)
                )}>
                  {request.status.replace("_", " ")}
                </span>
              </div>
              
              <div className="flex items-center justify-between mb-3">
                <span className={cn(
                  "font-mono text-lg font-bold",
                  request.type === "add" ? "text-yellow-400" : request.type === "reduce" ? "text-green-400" : "text-foreground"
                )}>
                  {request.type === "add" ? "+" : request.type === "reduce" ? "-" : ""}${request.amount.toLocaleString()}
                </span>
                <span className={cn(
                  "font-mono text-[10px] px-2 py-0.5 rounded border",
                  request.initiatedBy === "partner" ? "bg-purple-900/30 text-purple-100 border-purple-400/40" : "bg-accent/20 text-accent border-accent/40"
                )}>
                  {request.initiatedBy === "partner" ? "Partner Initiated" : "Agency Initiated"}
                </span>
              </div>
              
              <p className="text-sm text-foreground-muted line-clamp-2">{request.justification}</p>
              
              {request.submittedAt && (
                <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-2 text-[10px] text-foreground-muted font-mono">
                  <Clock className="w-3 h-3" />
                  Submitted {request.submittedAt}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      </div>

      {/* Scope Request Detail Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <GlassCard className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="font-mono text-[10px] text-accent uppercase tracking-wider mb-1">Scope Change Request</div>
                <div className="font-display font-bold text-2xl text-foreground">{selectedRequest.description}</div>
                <div className="font-mono text-sm text-foreground-muted">{selectedRequest.vendor} | {selectedRequest.id}</div>
              </div>
              <button onClick={() => setSelectedRequest(null)} className="text-foreground hover:text-accent">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-white/5 rounded-lg border border-border/30 text-center">
                <div className={cn(
                  "font-display font-bold text-2xl",
                  selectedRequest.type === "add" ? "text-yellow-400" : selectedRequest.type === "reduce" ? "text-green-400" : "text-foreground"
                )}>
                  {selectedRequest.type === "add" ? "+" : selectedRequest.type === "reduce" ? "-" : ""}${selectedRequest.amount.toLocaleString()}
                </div>
                <div className="font-mono text-[10px] text-foreground-muted uppercase">Amount</div>
              </div>
              <div className="p-4 bg-white/5 rounded-lg border border-border/30 text-center">
                <div className={cn(
                  "font-mono text-sm px-2 py-1 rounded-full border inline-block capitalize",
                  getStatusStyle(selectedRequest.status)
                )}>
                  {selectedRequest.status.replace("_", " ")}
                </div>
                <div className="font-mono text-[10px] text-foreground-muted uppercase mt-2">Status</div>
              </div>
              <div className="p-4 bg-white/5 rounded-lg border border-border/30 text-center">
                <div className={cn(
                  "font-mono text-sm px-2 py-1 rounded border inline-block",
                  selectedRequest.initiatedBy === "partner" ? "bg-purple-900/30 text-purple-100 border-purple-400/40" : "bg-accent/20 text-accent border-accent/40"
                )}>
                  {selectedRequest.initiatedBy === "partner" ? "Partner" : "Lead Agency"}
                </div>
                <div className="font-mono text-[10px] text-foreground-muted uppercase mt-2">Initiated By</div>
              </div>
            </div>

            <div className="mb-6">
              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">Justification</div>
              <p className="text-foreground-secondary bg-white/5 rounded-lg p-4 border border-border/30">
                {selectedRequest.justification}
              </p>
            </div>

            {selectedRequest.reviewNotes && (
              <div className="mb-6">
                <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">Review Notes</div>
                <p className="text-foreground-secondary bg-white/5 rounded-lg p-4 border border-border/30">
                  {selectedRequest.reviewNotes}
                </p>
              </div>
            )}

            {(selectedRequest.status === "submitted" || selectedRequest.status === "under_review") && (
              <div className="flex gap-3 pt-4 border-t border-border/30">
                <Button
                  onClick={() => updateRequestStatus(selectedRequest.id, "approved")}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-mono text-sm"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve Request
                </Button>
                <Button
                  variant="outline"
                  onClick={() => updateRequestStatus(selectedRequest.id, "under_review")}
                  className="flex-1 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 font-mono text-sm"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Mark Under Review
                </Button>
                <Button
                  variant="outline"
                  onClick={() => updateRequestStatus(selectedRequest.id, "rejected", "Budget constraints")}
                  className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 font-mono text-sm"
                >
                  <X className="w-4 h-4 mr-2" />
                  Reject
                </Button>
              </div>
            )}

            {selectedRequest.status === "draft" && (
              <div className="flex gap-3 pt-4 border-t border-border/30">
                <Button
                  onClick={() => {
                    setScopeRequests(prev => prev.map(r => 
                      r.id === selectedRequest.id 
                        ? { ...r, status: "submitted" as const, submittedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
                        : r
                    ))
                    setSelectedRequest(null)
                  }}
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-mono text-sm"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send to Partner
                </Button>
                <Button
                  variant="outline"
                  className="border-border text-foreground font-mono text-sm"
                >
                  <Edit3 className="w-4 h-4 mr-2" />
                  Edit Draft
                </Button>
              </div>
            )}
          </GlassCard>
        </div>
      )}
      
      {/* Partner Input Cards */}
      <GlassCardHeader className="mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-accent" />
          <span>Partner Utilization Reports</span>
        </div>
      </GlassCardHeader>

      <div className="space-y-4">
        {utilization.map((record) => {
          const isEditing = editingId === record.id
          const percentUsed = Math.round((record.spent / record.contracted) * 100)
          
          return (
            <GlassCard key={record.id}>
              <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                {/* Vendor Info */}
                <div className="lg:w-1/4">
                  <div className="font-display font-bold text-lg text-foreground">
                    {record.vendor}
                  </div>
                  <div className="font-mono text-[10px] text-accent mb-2">
                    {record.discipline}
                  </div>
                  <span className={cn(
                    "font-mono text-[9px] px-2 py-0.5 rounded-full border capitalize",
                    record.paymentType === "fixed" && "bg-blue-900/30 text-blue-100 border-blue-400/40",
                    record.paymentType === "hourly" && "bg-purple-900/30 text-purple-100 border-purple-400/40",
                    record.paymentType === "retainer" && "bg-green-900/30 text-green-100 border-green-400/40",
                    record.paymentType === "milestone" && "bg-accent/10 text-accent border-accent/30"
                  )}>
                    {record.paymentType}
                  </span>
                  
                  {/* Partner Contact */}
                  <div className="mt-3 pt-3 border-t border-border/30">
                    <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-1">
                      Lead Contact
                    </div>
                    <div className="text-sm text-foreground font-medium">
                      {record.partnerContact.name}
                    </div>
                    <div className="font-mono text-[10px] text-foreground-muted">
                      {record.partnerContact.role}
                    </div>
                    <a 
                      href={`mailto:${record.partnerContact.email}`}
                      className="font-mono text-[10px] text-accent hover:underline block mt-1"
                    >
                      {record.partnerContact.email}
                    </a>
                  </div>
                </div>

                {/* Budget Progress */}
                <div className="lg:w-1/4">
                  <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Budget Utilization
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="font-mono text-xl font-bold text-foreground">
                      ${record.spent.toLocaleString()}
                    </span>
                    <span className="font-mono text-sm text-foreground-muted">
                      / ${record.contracted.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all",
                          record.projectedOverage ? "bg-yellow-500" : "bg-accent"
                        )}
                        style={{ width: `${Math.min(percentUsed, 100)}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs text-foreground-muted w-10">
                      {percentUsed}%
                    </span>
                  </div>
                </div>

                {/* Partner Input: Scope Complete */}
                <div className="lg:w-1/4">
                  <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Scope Completed (Partner Input)
                  </div>
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={tempPercent}
                        onChange={(e) => setTempPercent(Number(e.target.value))}
                        className="w-full accent-accent"
                      />
                      <div className="flex items-center justify-between">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={tempPercent}
                          onChange={(e) => setTempPercent(Math.min(100, Math.max(0, Number(e.target.value))))}
                          className="w-16 px-2 py-1 bg-white/10 border border-border/30 rounded font-mono text-sm text-foreground"
                        />
                        <span className="font-mono text-sm text-foreground-muted">%</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className="font-mono text-xl font-bold text-foreground">
                          {record.partnerInput.percentComplete}%
                        </span>
                        <span className="font-mono text-[10px] text-foreground-muted">
                          complete
                        </span>
                      </div>
                      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${record.partnerInput.percentComplete}%` }}
                        />
                      </div>
                      <div className="font-mono text-[10px] text-foreground-muted mt-1">
                        Updated {record.partnerInput.lastUpdated} by {record.partnerInput.updatedBy}
                      </div>
                    </>
                  )}
                </div>

                {/* Partner Input: Overage Flag */}
                <div className="lg:w-1/4">
                  <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-2">
                    Status / Overage Flag
                  </div>
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {(["none", "at_risk", "overburn", "scope_change"] as const).map(flag => (
                          <button
                            key={flag}
                            onClick={() => setTempFlag(flag)}
                            className={cn(
                              "px-2 py-1 rounded-full font-mono text-[10px] border transition-colors",
                              tempFlag === flag 
                                ? getOverageFlagStyle(flag)
                                : "bg-white/5 border-border/30 text-foreground hover:border-border/50"
                            )}
                          >
                            {getOverageFlagLabel(flag)}
                          </button>
                        ))}
                      </div>
                      {tempFlag !== "none" && (
                        <>
                          <input
                            type="text"
                            placeholder="Note about overage..."
                            value={tempNote}
                            onChange={(e) => setTempNote(e.target.value)}
                            className="w-full px-3 py-2 bg-white/10 border border-border/30 rounded font-mono text-sm text-foreground placeholder:text-foreground-muted/50"
                          />
                          <div className="flex items-center gap-2">
                            <span className="text-foreground-muted text-sm">$</span>
                            <input
                              type="number"
                              placeholder="Est. overage amount"
                              value={tempAmount || ""}
                              onChange={(e) => setTempAmount(e.target.value ? Number(e.target.value) : undefined)}
                              className="flex-1 px-3 py-2 bg-white/10 border border-border/30 rounded font-mono text-sm text-foreground placeholder:text-foreground-muted/50"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-mono text-[10px] border",
                        getOverageFlagStyle(record.partnerInput.overageFlag)
                      )}>
                        {record.partnerInput.overageFlag === "none" && <CheckCircle className="w-3 h-3" />}
                        {record.partnerInput.overageFlag === "at_risk" && <AlertTriangle className="w-3 h-3" />}
                        {record.partnerInput.overageFlag === "overburn" && <AlertTriangle className="w-3 h-3" />}
                        {record.partnerInput.overageFlag === "scope_change" && <Flag className="w-3 h-3" />}
                        {getOverageFlagLabel(record.partnerInput.overageFlag)}
                      </span>
                      {record.partnerInput.overageNote && (
                        <p className="text-sm text-foreground-muted">
                          {record.partnerInput.overageNote}
                        </p>
                      )}
                      {record.partnerInput.overageAmount && (
                        <div className="font-mono text-sm text-yellow-400">
                          Est. overage: +${record.partnerInput.overageAmount.toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Edit/Save Actions */}
              <div className="mt-4 pt-4 border-t border-border/30 flex items-center justify-between">
                {isEditing ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => saveEdit(record.id)}
                      className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono text-xs"
                    >
                      Save Update
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingId(null)}
                      className="border-border text-foreground hover:text-foreground font-mono text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startEditing(record)}
                    className="border-border text-foreground hover:text-foreground font-mono text-xs"
                  >
                    Update Status
                  </Button>
                )}
                
                {record.alerts.length > 0 && !isEditing && (
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                    <span className="font-mono text-xs text-yellow-400">
                      {record.alerts.length} alert{record.alerts.length > 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </div>
            </GlassCard>
          )
        })}
      </div>
    </div>
  )
}
