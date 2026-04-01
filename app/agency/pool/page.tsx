"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { useSelectedProjectSafe } from "@/contexts/selected-project-context"
import { StageHeader } from "@/components/stage-header"
import { GlassCard } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/empty-state"
import { cn } from "@/lib/utils"
import { isDemoMode, demoPartners, disciplines, partnerTypes, type Partner, type PartnerNote, type ProjectRating, type PartnerAvailability } from "@/lib/demo-data"
import { usePaidUser } from "@/contexts/paid-user-context"
import { createClient } from "@/lib/supabase/client"
import { Star, Shield, Building2, User, Video, X, ExternalLink, Mail, MapPin, Calendar, Briefcase, Award, ChevronRight, Ban, Plus, Clock, Globe, Send, CheckCircle, AlertCircle, UserPlus, Pencil, Trash2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"

// Partnership type (Tier 1 - business relationship)
type Partnership = {
  id: string
  partnerId: string
  partnerEmail: string
  partnerName?: string
  partnerCompany?: string
  status: "pending" | "active" | "suspended" | "terminated"
  invitedAt: string
  acceptedAt?: string
  ndaConfirmedAt?: string | null
  ndaConfirmedBy?: string | null
  invitationMessage?: string
}

// Legacy Partner invitation type (for backward compatibility)
type PartnerInvitation = {
  id: string
  partnerEmail: string
  partnerName?: string
  status: "pending" | "accepted" | "confirmed" | "declined"
  invitedAt: string
  acceptedAt?: string
  confirmedAt?: string
  invitationMessage?: string
}

// Partner access request type (partner requesting to join agency network)
type AccessRequest = {
  id: string
  partnerId: string
  partnerName?: string
  partnerEmail?: string
  partnerCompany?: string
  status: "pending" | "approved" | "declined"
  requestMessage?: string
  createdAt: string
}

// Demo invitations
const demoInvitations: PartnerInvitation[] = [
  {
    id: "demo-inv-1",
    partnerEmail: "hello@fieldhousefilms.com",
    partnerName: "Fieldhouse Films",
    status: "accepted",
    invitedAt: "2026-02-15",
    acceptedAt: "2026-02-18",
    invitationMessage: "We'd love to have you join our partner network.",
  },
  {
    id: "demo-inv-2",
    partnerEmail: "partnerships@tandemsocial.com",
    partnerName: "Tandem Social",
    status: "pending",
    invitedAt: "2026-03-20",
    invitationMessage: "Looking for social media partners for Q2 campaigns.",
  },
]

const legalFilters = ["All", "NDA Signed", "MSA Approved", "No NDA", "No MSA"]
const statusFilters = ["All", "Active", "Pending", "New", "Blacklisted"]
const types = partnerTypes

export default function PartnerPoolPage() {
  const router = useRouter()
  const projectContext = useSelectedProjectSafe()
  const selectedProject = projectContext?.selectedProject ?? null
  const isDemo = projectContext?.isDemo ?? isDemoMode()
  const { checkFeatureAccess } = usePaidUser()

  const [partners, setPartners] = useState<Partner[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedDiscipline, setSelectedDiscipline] = useState("All")
  const [selectedType, setSelectedType] = useState("All")
  const [selectedLegal, setSelectedLegal] = useState("All")
  const [selectedStatus, setSelectedStatus] = useState("All")
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false)
  const [showBlacklisted, setShowBlacklisted] = useState(false)
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null)
  
  // Partnerships state (new closed ecosystem)
  const [partnerships, setPartnerships] = useState<Partnership[]>([])
  
  // Invitation state
  const [invitations, setInvitations] = useState<PartnerInvitation[]>([])
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteMessage, setInviteMessage] = useState("")
  const [isInviting, setIsInviting] = useState(false)
  
  // Access requests state (partners requesting to join)
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([])
  const [processingRequest, setProcessingRequest] = useState<string | null>(null)
  const [confirmingNdaFor, setConfirmingNdaFor] = useState<string | null>(null)
  
  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  
  // Custom disciplines state (persisted to localStorage)
  const [customDisciplines, setCustomDisciplines] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('customDisciplines')
      return saved ? JSON.parse(saved) : []
    }
    return []
  })
  
  // Combined disciplines for filtering
  const allFilterDisciplines = ["All", ...disciplines.filter(d => d !== "All"), ...customDisciplines]
  
  // Success notification state
  const [successModal, setSuccessModal] = useState<{
    show: boolean
    title: string
    message: string
    email?: string
  }>({ show: false, title: '', message: '' })

  // Demo access requests
  const demoAccessRequests: AccessRequest[] = [
    {
      id: "demo-req-1",
      partnerId: "demo-partner-1",
      partnerName: "Studio X Productions",
      partnerEmail: "hello@studiox.com",
      partnerCompany: "Studio X Productions",
      status: "pending",
      requestMessage: "We'd love to be part of your vendor network. We specialize in documentary-style branded content.",
      createdAt: new Date().toISOString()
    }
  ]

  useEffect(() => {
    // Only load demo data on demo site
    if (isDemo) {
      setPartners(demoPartners)
      setInvitations(demoInvitations)
      setAccessRequests(demoAccessRequests)
    } else {
      // Production: load partnerships and access requests from database
      setPartners([])
      loadPartnerships()
      loadAccessRequests()
    }
    setIsLoaded(true)
  }, [isDemo])
  
  const loadPartnerships = async () => {
    try {
      const response = await fetch('/api/partnerships')
      if (response.ok) {
        const data = await response.json()
        const loaded: Partnership[] = (data.partnerships || []).map((p: any) => ({
          id: p.id,
          partnerId: p.partner?.id || p.partner_id,
          partnerEmail: p.partner?.email || p.partner_email, // Use partner_email for email-only invitations
          partnerName: p.partner?.full_name,
          partnerCompany: p.partner?.company_name,
          status: p.status,
          invitedAt: p.invited_at || p.created_at,
          acceptedAt: p.accepted_at,
          ndaConfirmedAt: p.nda_confirmed_at || null,
          ndaConfirmedBy: p.nda_confirmed_by || null,
          invitationMessage: p.invitation_message,
        }))
        setPartnerships(loaded)
      }
    } catch (error) {
      console.error('Error loading partnerships:', error)
    }
  }
  
  const handleDeletePartner = async () => {
    if (!partnerToDelete) return
    
    if (isDemo) {
      // Demo mode: just remove from local state
      setPartners(prev => prev.filter(p => p.id !== partnerToDelete.id))
      setShowDeleteConfirm(false)
      setPartnerToDelete(null)
      setSelectedPartner(null)
      return
    }
    
    setIsDeleting(true)
    try {
      // Find the partnership ID for this partner
      const partnership = partnerships.find(p => p.partnerId === partnerToDelete.id)
      if (partnership) {
        const response = await fetch(`/api/partnerships?id=${partnership.id}`, {
          method: 'DELETE',
        })
        
        if (response.ok) {
          await loadPartnerships()
        } else {
          const data = await response.json()
          alert(data.error || 'Failed to remove partner')
        }
      } else {
        // For demo partners without a partnership record, just remove locally
        setPartners(prev => prev.filter(p => p.id !== partnerToDelete.id))
      }
    } catch (error) {
      console.error('Error deleting partner:', error)
      alert('Failed to remove partner')
    }
    setIsDeleting(false)
    setShowDeleteConfirm(false)
    setPartnerToDelete(null)
    setSelectedPartner(null)
  }
  
  const loadAccessRequests = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      
      const { data, error } = await supabase
        .from('partner_access_requests')
        .select(`
          *,
          partner:profiles!partner_id(full_name, company_name, email)
        `)
        .eq('agency_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      
      if (!error && data) {
        const loaded: AccessRequest[] = data.map((req: any) => ({
          id: req.id,
          partnerId: req.partner_id,
          partnerName: req.partner?.full_name || req.partner?.company_name,
          partnerEmail: req.partner?.email,
          partnerCompany: req.partner?.company_name,
          status: req.status,
          requestMessage: req.request_message,
          createdAt: req.created_at,
        }))
        setAccessRequests(loaded)
      }
    } catch (error) {
      console.error('Error loading access requests:', error)
    }
  }

  const handleApproveRequest = async (requestId: string) => {
    setProcessingRequest(requestId)
    
    if (isDemo) {
      setAccessRequests(prev => prev.filter(r => r.id !== requestId))
      setProcessingRequest(null)
      return
    }

    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('partner_access_requests')
        .update({ status: 'approved', reviewed_at: new Date().toISOString() })
        .eq('id', requestId)
      
      if (!error) {
        await loadAccessRequests()
      }
    } catch (error) {
      console.error('Error approving request:', error)
    }
    setProcessingRequest(null)
  }

  const handleDeclineRequest = async (requestId: string) => {
    setProcessingRequest(requestId)
    
    if (isDemo) {
      setAccessRequests(prev => prev.filter(r => r.id !== requestId))
      setProcessingRequest(null)
      return
    }

    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('partner_access_requests')
        .update({ status: 'declined', reviewed_at: new Date().toISOString() })
        .eq('id', requestId)
      
      if (!error) {
        await loadAccessRequests()
      }
    } catch (error) {
      console.error('Error declining request:', error)
    }
    setProcessingRequest(null)
  }

  const handleConfirmNdaSigned = async (partnershipId: string) => {
    console.log("[agency/pool] confirm NDA clicked", { partnershipId })
    if (!checkFeatureAccess("nda confirm")) return
    if (isDemo) return
    setConfirmingNdaFor(partnershipId)
    try {
      const response = await fetch('/api/partnerships', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnershipId, action: 'confirm_nda' }),
      })
      console.log("[agency/pool] confirm NDA response", { ok: response.ok, status: response.status, partnershipId })
      if (response.ok) {
        await loadPartnerships()
      } else {
        const data = await response.json().catch(() => ({}))
        alert((data?.error as string) || 'Failed to confirm NDA')
      }
    } catch (error) {
      console.error('Error confirming NDA:', error)
    } finally {
      setConfirmingNdaFor(null)
    }
  }

  const updatePartners = (newPartners: Partner[]) => {
    setPartners(newPartners)
  }

  const toggleBookmark = (partnerId: string) => {
    if (!checkFeatureAccess()) return
    const updated = partners.map(p =>
      p.id === partnerId ? { ...p, bookmarked: !p.bookmarked } : p
    )
    updatePartners(updated)
    if (selectedPartner?.id === partnerId) {
      setSelectedPartner(prev => prev ? { ...prev, bookmarked: !prev.bookmarked } : null)
    }
  }
  
  // Invite a partner
  const handleInvitePartner = async () => {
    if (!inviteEmail.trim()) return
    
    setIsInviting(true)
    
    if (isDemo) {
      // Demo mode: add to local state
      const newInvitation: PartnerInvitation = {
        id: `demo-inv-${Date.now()}`,
        partnerEmail: inviteEmail,
        status: "pending",
        invitedAt: new Date().toISOString().split('T')[0],
        invitationMessage: inviteMessage || undefined,
      }
      setInvitations(prev => [newInvitation, ...prev])
      setShowInviteModal(false)
      setInviteEmail("")
      setInviteMessage("")
      setIsInviting(false)
      return
    }
    
    // Production: create partnership via API
    try {
      const response = await fetch('/api/partnerships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerEmail: inviteEmail,
          message: inviteMessage || null,
        }),
      })
      
      const data = await response.json()
      if (response.ok) {
        await loadPartnerships()
        const savedEmail = inviteEmail
        setShowInviteModal(false)
        setInviteEmail("")
        setInviteMessage("")
        // Show success modal
        setSuccessModal({
          show: true,
          title: data.partnerExists ? 'Invitation Sent' : 'Invitation Created',
          message: data.partnerExists 
            ? 'Your invitation has been sent. The partner will receive a notification to accept.'
            : 'The partner will see this invitation when they sign up with this email address.',
          email: savedEmail
        })
      } else {
        setSuccessModal({
          show: true,
          title: 'Unable to Send Invitation',
          message: data.error || 'Failed to invite partner. Please try again.',
        })
      }
    } catch (error) {
      console.error('Error inviting partner:', error)
    }
    
    setIsInviting(false)
  }
  
  // Confirm a partner who has accepted
  const handleConfirmPartner = async (invitationId: string) => {
    if (!checkFeatureAccess()) return
    
    if (isDemo) {
      // Demo mode: update local state
      setInvitations(prev => prev.map(inv => 
        inv.id === invitationId 
          ? { ...inv, status: 'confirmed' as const, confirmedAt: new Date().toISOString().split('T')[0] }
          : inv
      ))
      return
    }
    
    // Production: update database
    try {
      const supabase = createClient()
      
      const { error } = await supabase
        .from('agency_partner_invitations')
        .update({ 
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', invitationId)
      
      if (!error) {
        await loadInvitations()
      }
    } catch (error) {
      console.error('Error confirming partner:', error)
    }
  }
  
  // Pending invitations count (invitations sent but not yet accepted)
  const pendingInvitations = isDemo 
    ? invitations.filter(inv => inv.status === 'pending').length
    : partnerships.filter(p => p.status === 'pending').length
  
  // Active partnerships count
  const activePartnerships = isDemo
    ? invitations.filter(inv => inv.status === 'accepted' || inv.status === 'confirmed').length
    : partnerships.filter(p => p.status === 'active').length

  // State for add/edit partner modal
  const [showAddPartnerModal, setShowAddPartnerModal] = useState(false)
  const [editingPartner, setEditingPartner] = useState<Partial<Partner> | null>(null)
  
  // Sample partner template for production - shows all editable fields
  const samplePartnerTemplate: Partner = {
    id: "sample-1",
    name: "Sample Partner Agency",
    discipline: "Video Production",
    type: "agency",
    location: "New York, NY",
    email: "contact@samplepartner.com",
    website: "samplepartner.com",
    rate: "$150-200/hr",
    experience: "10+ years of experience in video production for sports and entertainment brands.",
    rating: 4.8,
    status: "active",
    joinedDate: "Mar 2026",
    bookmarked: false,
    ndaSigned: false,
    msaApproved: false,
    tags: ["Sports", "Entertainment", "Branded Content"],
    credentials: ["Emmy Award Winner", "DGA Member"],
    pastProjects: [],
    availability: { status: "available", nextAvailable: null, notes: "" },
    notes: [],
    projectRatings: []
  }
  
  // In production, start with one editable sample partner so users can see all fields
  useEffect(() => {
    if (!isDemo && partners.length === 0 && isLoaded) {
      // Don't auto-add - let the UI show the empty state with add button
    }
  }, [isDemo, partners.length, isLoaded])
  
  const handleAddPartner = (partnerData: Partial<Partner>) => {
    const newPartner: Partner = {
      id: `partner-${Date.now()}`,
      name: partnerData.name || "New Partner",
      discipline: partnerData.discipline || "General",
      type: (partnerData.type as "agency" | "freelancer" | "production") || "agency",
      location: partnerData.location || "",
      email: partnerData.email || "",
      website: partnerData.website || "",
      rate: partnerData.rate || "",
      experience: partnerData.experience || "",
      rating: partnerData.rating || 0,
      status: "active",
      joinedDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      bookmarked: false,
      ndaSigned: partnerData.ndaSigned || false,
      msaApproved: partnerData.msaApproved || false,
      tags: partnerData.tags || [],
      credentials: partnerData.credentials || [],
      pastProjects: [],
      availability: { status: "available", nextAvailable: null, notes: "" },
      notes: [],
      projectRatings: []
    }
    setPartners(prev => [...prev, newPartner])
    setShowAddPartnerModal(false)
    setEditingPartner(null)
  }
  
  const handleEditPartner = (partner: Partner) => {
    setEditingPartner(partner)
    setShowAddPartnerModal(true)
  }
  
  const handleUpdatePartner = (partnerData: Partial<Partner>) => {
    if (!editingPartner?.id) return
    setPartners(prev => prev.map(p => 
      p.id === editingPartner.id 
        ? { ...p, ...partnerData }
        : p
    ))
    setShowAddPartnerModal(false)
    setEditingPartner(null)
  }

  if (!isLoaded) {
    return (
      <AgencyLayout title="Partner Pool">
        <div className="flex items-center justify-center h-64">
          <div className="text-foreground-muted">Loading...</div>
        </div>
      </AgencyLayout>
    )
  }

  const filteredPartners = partners.filter(p => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !p.discipline.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    if (selectedDiscipline !== "All" && p.discipline !== selectedDiscipline) return false
    if (selectedType !== "All" && p.type !== selectedType.toLowerCase()) return false
    if (selectedLegal === "NDA Signed" && !p.ndaSigned) return false
    if (selectedLegal === "MSA Approved" && !p.msaApproved) return false
    if (selectedLegal === "No NDA" && p.ndaSigned) return false
    if (selectedLegal === "No MSA" && p.msaApproved) return false
    if (selectedStatus !== "All" && p.status !== selectedStatus.toLowerCase()) return false
    if (showBookmarkedOnly && !p.bookmarked) return false
    if (!showBlacklisted && p.status === "blacklisted" && selectedStatus !== "Blacklisted") return false
    return true
  })

  const bookmarkedCount = partners.filter(p => p.bookmarked).length
  const ndaSignedCount = partners.filter(p => p.ndaSigned).length
  const msaApprovedCount = partners.filter(p => p.msaApproved).length
  const blacklistedCount = partners.filter(p => p.status === "blacklisted").length

  return (
    <AgencyLayout>
      <div className="p-8 max-w-7xl">
        <div className="flex items-start justify-between mb-6">
          <StageHeader
            stageNumber="◈"
            title="Partner Pool"
            subtitle="Your curated roster of trusted partners. View credentials, track legal status, add notes, and manage relationships."
          />
          <div className="flex items-center gap-3">
            <Button 
              onClick={() => {
                setEditingPartner(null)
                setShowAddPartnerModal(true)
              }}
              variant="outline"
              className="border-accent text-accent hover:bg-accent/10 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Partner
            </Button>
            <Button 
              onClick={() => setShowInviteModal(true)}
              className="bg-accent text-background hover:bg-accent/90 flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Invite Partner
            </Button>
          </div>
        </div>
        
        {/* Pending Confirmations Alert */}
        {pendingInvitations > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-foreground">
                  {pendingInvitations} Invitation{pendingInvitations > 1 ? 's' : ''} Awaiting Response
                </h3>
                <p className="text-sm text-foreground-muted">
                  Waiting for these partners to accept your invitation.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(isDemo ? invitations.filter(inv => inv.status === 'pending') : partnerships.filter(p => p.status === 'pending')).map(item => (
                <div key={item.id} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <Mail className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">
                        {isDemo ? ((item as PartnerInvitation).partnerName || (item as PartnerInvitation).partnerEmail) : ((item as Partnership).partnerCompany || (item as Partnership).partnerName || (item as Partnership).partnerEmail)}
                      </div>
                      <div className="font-mono text-[10px] text-foreground-muted">
                        Invited on {new Date(isDemo ? (item as PartnerInvitation).invitedAt : (item as Partnership).invitedAt || '').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-amber-500/10 text-amber-400">Pending</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Partnerships Section */}
        {activePartnerships > 0 && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-foreground">
                  {activePartnerships} Active Partnership{activePartnerships > 1 ? 's' : ''}
                </h3>
                <p className="text-sm text-foreground-muted">
                  Partners in your network with full access to assigned projects.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(isDemo ? invitations.filter(inv => inv.status === 'accepted' || inv.status === 'confirmed') : partnerships.filter(p => p.status === 'active')).map(item => (
                <div key={item.id} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-green-400" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">
                        {isDemo ? ((item as PartnerInvitation).partnerName || (item as PartnerInvitation).partnerEmail) : ((item as Partnership).partnerCompany || (item as Partnership).partnerName || (item as Partnership).partnerEmail)}
                      </div>
                      <div className="font-mono text-[10px] text-foreground-muted">
                        Active since {new Date(isDemo ? (item as PartnerInvitation).acceptedAt || '' : (item as Partnership).acceptedAt || '').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      {!isDemo && (
                        <div className="font-mono text-[10px] mt-1">
                          {(item as Partnership).ndaConfirmedAt ? (
                            <span className="text-green-400">
                              NDA Signed {new Date((item as Partnership).ndaConfirmedAt || '').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          ) : (
                            <span className="text-amber-300">NDA Pending</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isDemo && !(item as Partnership).ndaConfirmedAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={confirmingNdaFor === item.id}
                        onClick={() => handleConfirmNdaSigned(item.id)}
                        className="h-7 border-green-500/40 text-green-300 hover:bg-green-500/10"
                      >
                        {confirmingNdaFor === item.id
                          ? 'Saving...'
                          : 'Confirm NDA Signed'}
                      </Button>
                    )}
                    <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-green-500/10 text-green-400">Active</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Access Requests Alert */}
        {accessRequests.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-foreground">
                  {accessRequests.length} Partner Request{accessRequests.length > 1 ? 's' : ''} Pending
                </h3>
                <p className="font-mono text-xs text-foreground-muted">
                  Partners are requesting to join your network
                </p>
              </div>
            </div>
            
            <div className="mt-4 space-y-2">
              {accessRequests.map(request => (
                <div key={request.id} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <User className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{request.partnerCompany || request.partnerName || request.partnerEmail}</div>
                      <div className="font-mono text-[10px] text-foreground-muted">
                        {request.requestMessage ? `"${request.requestMessage.slice(0, 50)}${request.requestMessage.length > 50 ? '...' : ''}"` : 'No message provided'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeclineRequest(request.id)}
                      disabled={processingRequest === request.id}
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                    <Button 
                      size="sm" 
                      onClick={() => handleApproveRequest(request.id)}
                      disabled={processingRequest === request.id}
                      className="bg-accent text-background hover:bg-accent/90"
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-6 gap-4 mb-8">
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-foreground">{partners.filter(p => p.status !== "blacklisted").length}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Active Partners</div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-accent">{bookmarkedCount}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Bookmarked</div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-success">{ndaSignedCount}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">NDA Signed</div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-success">{msaApprovedCount}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">MSA Approved</div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-foreground">{partners.filter(p => p.status === "active").length}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Active</div>
          </GlassCard>
          <GlassCard className="p-4 text-center cursor-pointer hover:border-red-500/30 transition-colors" onClick={() => setShowBlacklisted(!showBlacklisted)}>
            <div className="font-display font-bold text-3xl text-red-400">{blacklistedCount}</div>
            <div className="font-mono text-[10px] text-red-400 uppercase">Blacklisted</div>
          </GlassCard>
        </div>

        {/* Filters */}
        <GlassCard className="mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search partners..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-foreground-muted">Type:</span>
              <div className="flex gap-1">
                {types.map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={cn(
                      "font-mono text-[10px] px-3 py-1.5 rounded-full border transition-colors",
                      selectedType === type
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-foreground-muted hover:border-white/30"
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowBookmarkedOnly(!showBookmarkedOnly)}
              className={cn(
                "font-mono text-[10px] px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5",
                showBookmarkedOnly
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-foreground-muted hover:border-white/30"
              )}
            >
              <Star className="w-3 h-3" /> Bookmarked
            </button>
          </div>

          {/* Status Filter */}
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-border">
            <span className="font-mono text-[10px] text-foreground-muted mr-2">Status:</span>
            {statusFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setSelectedStatus(filter)}
                className={cn(
                  "font-mono text-[10px] px-2 py-1 rounded border transition-colors flex items-center gap-1",
                  selectedStatus === filter
                    ? filter === "Blacklisted" ? "border-red-500 bg-red-500/10 text-red-400" : "border-accent bg-accent/10 text-accent"
                    : "border-border text-foreground-muted hover:border-white/30"
                )}
              >
                {filter === "Blacklisted" && <Ban className="w-3 h-3" />}
                {filter}
              </button>
            ))}
          </div>

          {/* Legal Status Filter */}
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-border">
            <span className="font-mono text-[10px] text-foreground-muted mr-2">Legal Status:</span>
            {legalFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setSelectedLegal(filter)}
                className={cn(
                  "font-mono text-[10px] px-2 py-1 rounded border transition-colors flex items-center gap-1",
                  selectedLegal === filter
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-foreground-muted hover:border-white/30"
                )}
              >
                {(filter === "NDA Signed" || filter === "MSA Approved") && <Shield className="w-3 h-3" />}
                {filter}
              </button>
            ))}
          </div>

          {/* Discipline Filter */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
            <span className="font-mono text-[10px] text-foreground-muted mr-2">Discipline:</span>
            {allFilterDisciplines.map((discipline) => (
              <button
                key={discipline}
                onClick={() => setSelectedDiscipline(discipline)}
                className={cn(
                  "font-mono text-[10px] px-2 py-1 rounded border transition-colors",
                  selectedDiscipline === discipline
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-foreground-muted hover:border-white/30"
                )}
              >
                {discipline}
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Partner Grid */}
        {filteredPartners.length === 0 && partners.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
              <UserPlus className="w-8 h-8 text-accent" />
            </div>
            <h3 className="font-display font-bold text-xl text-foreground mb-2">
              Build Your Partner Network
            </h3>
            <p className="text-foreground-muted max-w-md mx-auto mb-6">
              Start by adding partners to your pool. You can manually add partners or invite them via email to join your network.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button 
                onClick={() => {
                  setEditingPartner(null)
                  setShowAddPartnerModal(true)
                }}
                className="bg-accent text-background hover:bg-accent/90"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Partners
              </Button>
              <Button 
                variant="outline"
                onClick={() => setShowInviteModal(true)}
                className="border-accent text-accent hover:bg-accent/10"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Invite via Email
              </Button>
            </div>
          </GlassCard>
        ) : filteredPartners.length === 0 ? (
          <GlassCard className="p-8 text-center col-span-full">
            <p className="text-foreground-muted">No partners match your current filters.</p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPartners.map((partner) => (
            <GlassCard
              key={partner.id}
              className={cn(
                "relative overflow-hidden cursor-pointer transition-colors",
                partner.status === "blacklisted"
                  ? "border-red-500/30 hover:border-red-500/50 bg-red-500/5"
                  : "hover:border-accent/30"
              )}
              onClick={() => setSelectedPartner(partner)}
            >
              {/* Blacklist Badge */}
              {partner.status === "blacklisted" && (
                <div className="absolute top-0 left-0 right-0 bg-red-500/20 border-b border-red-500/30 px-4 py-1.5 flex items-center gap-2">
                  <Ban className="w-3 h-3 text-red-400" />
                  <span className="font-mono text-[10px] text-red-400 uppercase">Blacklisted</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className={cn(
                "absolute right-4 flex items-center gap-1 z-10",
                partner.status === "blacklisted" ? "top-10" : "top-4"
              )}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEditPartner(partner)
                  }}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors bg-white/5 text-foreground-muted hover:text-accent hover:bg-accent/10"
                  title="Edit partner"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleBookmark(partner.id)
                  }}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                    partner.bookmarked
                      ? "bg-accent/20 text-accent"
                      : "bg-white/5 text-foreground-muted hover:text-accent"
                  )}
                  title="Bookmark partner"
                >
                  <Star className={cn("w-4 h-4", partner.bookmarked && "fill-current")} />
                </button>
              </div>

              {/* Header */}
              <div className={cn("flex items-start gap-3 mb-3 pr-10", partner.status === "blacklisted" && "mt-6")}>
                <div className={cn(
                  "w-12 h-12 rounded-lg flex items-center justify-center shrink-0",
                  partner.status === "blacklisted" ? "bg-red-500/10" : "bg-accent/10"
                )}>
                  {partner.type === "agency" && <Building2 className={cn("w-5 h-5", partner.status === "blacklisted" ? "text-red-400" : "text-accent")} />}
                  {partner.type === "freelancer" && <User className={cn("w-5 h-5", partner.status === "blacklisted" ? "text-red-400" : "text-accent")} />}
                  {partner.type === "production" && <Video className={cn("w-5 h-5", partner.status === "blacklisted" ? "text-red-400" : "text-accent")} />}
                </div>
                <div className="min-w-0">
                  <div className="font-display font-bold text-foreground truncate">{partner.name}</div>
                  <div className={cn("font-mono text-[10px]", partner.status === "blacklisted" ? "text-red-400" : "text-accent")}>{partner.discipline}</div>
                </div>
              </div>

              {/* Info */}
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center gap-2 text-foreground-muted">
                  <MapPin className="w-3 h-3" />
                  <span className="font-mono text-[10px]">{partner.location}</span>
                </div>
                <div className="flex items-center gap-2 text-foreground-muted">
                  <Briefcase className="w-3 h-3" />
                  <span className="font-mono text-[10px]">{partner.rate} rate</span>
                </div>
                {partner.rating && (
                  <div className="flex items-center gap-2 text-foreground-muted">
                    <Star className="w-3 h-3 fill-accent text-accent" />
                    <span className="font-mono text-[10px]">{partner.rating} rating</span>
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1 mb-3">
                {partner.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-foreground-muted">
                    {tag}
                  </span>
                ))}
                {partner.tags.length > 3 && (
                  <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-foreground-muted">
                    +{partner.tags.length - 3}
                  </span>
                )}
              </div>

              {/* Legal Status */}
              <div className="flex gap-2 pt-3 border-t border-border">
                <div className={cn(
                  "flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded",
                  partner.ndaSigned ? "bg-success/10 text-success" : "bg-white/5 text-foreground-muted"
                )}>
                  <Shield className="w-3 h-3" />
                  NDA
                </div>
                <div className={cn(
                  "flex items-center gap-1 font-mono text-[9px] px-2 py-1 rounded",
                  partner.msaApproved ? "bg-success/10 text-success" : "bg-white/5 text-foreground-muted"
                )}>
                  <Shield className="w-3 h-3" />
                  MSA
                </div>
</div>
            </GlassCard>
          ))}
          </div>
        )}
        
        {/* Partner Detail Modal */}
        {selectedPartner && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedPartner(null)}>
            <GlassCard className="w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-start gap-4">
                  <div className={cn(
                    "w-16 h-16 rounded-lg flex items-center justify-center shrink-0",
                    selectedPartner.status === "blacklisted" ? "bg-red-500/10" : "bg-accent/10"
                  )}>
                    {selectedPartner.type === "agency" && <Building2 className={cn("w-7 h-7", selectedPartner.status === "blacklisted" ? "text-red-400" : "text-accent")} />}
                    {selectedPartner.type === "freelancer" && <User className={cn("w-7 h-7", selectedPartner.status === "blacklisted" ? "text-red-400" : "text-accent")} />}
                    {selectedPartner.type === "production" && <Video className={cn("w-7 h-7", selectedPartner.status === "blacklisted" ? "text-red-400" : "text-accent")} />}
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-2xl text-foreground">{selectedPartner.name}</h2>
                    <p className={cn("font-mono text-sm", selectedPartner.status === "blacklisted" ? "text-red-400" : "text-accent")}>{selectedPartner.discipline}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedPartner(null)} className="text-foreground-muted hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Contact Info */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-foreground-muted" />
                  <a href={`mailto:${selectedPartner.email}`} className="font-mono text-sm text-accent hover:underline">{selectedPartner.email}</a>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-foreground-muted" />
                  <span className="font-mono text-sm text-foreground">{selectedPartner.location}</span>
                </div>
                {selectedPartner.website && (
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-foreground-muted" />
                    <a href={`https://${selectedPartner.website}`} target="_blank" rel="noopener noreferrer" className="font-mono text-sm text-accent hover:underline flex items-center gap-1">
                      {selectedPartner.website}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-foreground-muted" />
                  <span className="font-mono text-sm text-foreground">Joined {selectedPartner.joinedDate}</span>
                </div>
              </div>

              {/* Experience */}
              <div className="mb-6">
                <h3 className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Experience</h3>
                <p className="text-foreground">{selectedPartner.experience}</p>
              </div>

              {/* Credentials */}
              {selectedPartner.credentials.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Credentials</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedPartner.credentials.map((cred) => (
                      <span key={cred} className="font-mono text-xs px-3 py-1 rounded-full bg-accent/10 text-accent flex items-center gap-1">
                        <Award className="w-3 h-3" />
                        {cred}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Past Projects */}
              {selectedPartner.pastProjects.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-mono text-[10px] uppercase text-foreground-muted mb-2">Past Projects</h3>
                  <div className="space-y-2">
                    {selectedPartner.pastProjects.map((project, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                        <div>
                          <div className="font-medium text-foreground">{project.projectName}</div>
                          <div className="font-mono text-xs text-foreground-muted">{project.date} • {project.budget}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Star className="w-4 h-4 fill-accent text-accent" />
                          <span className="font-mono text-sm text-foreground">{project.rating}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-border">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPartnerToDelete(selectedPartner)
                    setShowDeleteConfirm(true)
                  }}
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Remove from Pool
                </Button>
                <Button
                  onClick={() => setSelectedPartner(null)}
                  className="bg-accent text-background hover:bg-accent/90"
                >
                  Close
                </Button>
              </div>
            </GlassCard>
          </div>
        )}
        
        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && partnerToDelete && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(false)}>
            <GlassCard className="w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h2 className="font-display font-bold text-xl text-foreground">Remove Partner</h2>
                  <p className="font-mono text-xs text-foreground-muted">This action cannot be undone</p>
                </div>
              </div>
              
              <p className="text-foreground-secondary mb-6">
                Are you sure you want to remove <span className="font-semibold text-foreground">{partnerToDelete.name}</span> from your partner pool? They will no longer have access to your projects.
              </p>
              
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setPartnerToDelete(null)
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleDeletePartner}
                  disabled={isDeleting}
                  className="bg-red-500 text-white hover:bg-red-600"
                >
                  {isDeleting ? 'Removing...' : 'Remove Partner'}
                </Button>
              </div>
            </GlassCard>
          </div>
        )}
        
        {/* Invite Partner Modal */}
        {showInviteModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowInviteModal(false)}>
            <GlassCard className="w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <UserPlus className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-xl text-foreground">Invite Partner</h2>
                    <p className="font-mono text-xs text-foreground-muted">Send an invitation to join your network</p>
                  </div>
                </div>
                <button onClick={() => setShowInviteModal(false)} className="text-foreground-muted hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                    Partner Email *
                  </label>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="partner@company.com"
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>
                
                <div>
                  <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                    Invitation Message (Optional)
                  </label>
                  <Textarea
                    value={inviteMessage}
                    onChange={(e) => setInviteMessage(e.target.value)}
                    placeholder="We'd love to have you join our partner network for upcoming projects..."
                    rows={3}
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 resize-none"
                  />
                </div>
                
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-blue-300">
                      <p className="font-medium mb-1">Invitation Process:</p>
                      <ol className="list-decimal list-inside space-y-0.5 text-blue-400">
                        <li>Partner receives email invitation</li>
                        <li>Partner accepts and creates account</li>
                        <li>You confirm to complete the connection</li>
                      </ol>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowInviteModal(false)}
                    className="flex-1 border-border text-foreground-muted hover:bg-white/5"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleInvitePartner}
                    disabled={!inviteEmail.trim() || isInviting}
                    className="flex-1 bg-accent text-background hover:bg-accent/90"
                  >
                    {isInviting ? (
                      <>Sending...</>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Invitation
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </GlassCard>
          </div>
        )}
        
        {/* Add/Edit Partner Modal */}
        {showAddPartnerModal && (
          <AddEditPartnerModal
            partner={editingPartner}
            onSave={editingPartner?.id ? handleUpdatePartner : handleAddPartner}
            onClose={() => {
              setShowAddPartnerModal(false)
              setEditingPartner(null)
            }}
            customDisciplines={customDisciplines}
            onAddCustomDiscipline={(discipline) => {
              const updated = [...customDisciplines, discipline]
              setCustomDisciplines(updated)
              localStorage.setItem('customDisciplines', JSON.stringify(updated))
            }}
          />
        )}
        
        {/* Success/Error Modal */}
        {successModal.show && (
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
            onClick={() => setSuccessModal({ show: false, title: '', message: '' })}
          >
            <GlassCard 
              className="w-full max-w-md"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-4 mb-4">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center",
                  successModal.title.includes('Unable') 
                    ? "bg-red-500/10" 
                    : "bg-green-500/10"
                )}>
                  {successModal.title.includes('Unable') ? (
                    <AlertCircle className="w-6 h-6 text-red-400" />
                  ) : (
                    <CheckCircle className="w-6 h-6 text-green-400" />
                  )}
                </div>
                <div>
                  <h2 className="font-display font-bold text-xl text-foreground">
                    {successModal.title}
                  </h2>
                  {successModal.email && (
                    <p className="font-mono text-xs text-foreground-muted">
                      {successModal.email}
                    </p>
                  )}
                </div>
              </div>
              
              <p className="text-foreground-secondary mb-6 leading-relaxed">
                {successModal.message}
              </p>
              
              <div className="flex justify-end">
                <Button
                  onClick={() => setSuccessModal({ show: false, title: '', message: '' })}
                  className="bg-accent text-background hover:bg-accent/90"
                >
                  Got it
                </Button>
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    </AgencyLayout>
  )
}

// Add/Edit Partner Modal Component
function AddEditPartnerModal({ 
  partner, 
  onSave, 
  onClose,
  customDisciplines,
  onAddCustomDiscipline 
}: { 
  partner: Partial<Partner> | null
  onSave: (data: Partial<Partner>) => void
  onClose: () => void
  customDisciplines: string[]
  onAddCustomDiscipline: (discipline: string) => void
}) {
  const [formData, setFormData] = useState<Partial<Partner>>({
    name: partner?.name || "",
    discipline: partner?.discipline || "Video Production",
    type: partner?.type || "agency",
    location: partner?.location || "",
    email: partner?.email || "",
    website: partner?.website || "",
    rate: partner?.rate || "",
    experience: partner?.experience || "",
    rating: partner?.rating || 0,
    ndaSigned: partner?.ndaSigned || false,
    msaApproved: partner?.msaApproved || false,
    tags: partner?.tags || [],
    credentials: partner?.credentials || [],
  })
  
  const [newTag, setNewTag] = useState("")
  const [newCredential, setNewCredential] = useState("")
  const [showCustomDiscipline, setShowCustomDiscipline] = useState(false)
  const [customDisciplineInput, setCustomDisciplineInput] = useState("")
  
  // Combined disciplines list (default + custom)
  const allDisciplines = [...disciplines.filter(d => d !== "All"), ...customDisciplines]
  
  const addCustomDiscipline = () => {
    if (customDisciplineInput.trim() && !allDisciplines.includes(customDisciplineInput.trim())) {
      const newDiscipline = customDisciplineInput.trim()
      onAddCustomDiscipline(newDiscipline)
      setFormData(prev => ({ ...prev, discipline: newDiscipline }))
      setCustomDisciplineInput("")
      setShowCustomDiscipline(false)
    }
  }
  
  const addTag = () => {
    if (newTag.trim() && !formData.tags?.includes(newTag.trim())) {
      setFormData(prev => ({ ...prev, tags: [...(prev.tags || []), newTag.trim()] }))
      setNewTag("")
    }
  }
  
  const removeTag = (tag: string) => {
    setFormData(prev => ({ ...prev, tags: (prev.tags || []).filter(t => t !== tag) }))
  }
  
  const addCredential = () => {
    if (newCredential.trim() && !formData.credentials?.includes(newCredential.trim())) {
      setFormData(prev => ({ ...prev, credentials: [...(prev.credentials || []), newCredential.trim()] }))
      setNewCredential("")
    }
  }
  
  const removeCredential = (cred: string) => {
    setFormData(prev => ({ ...prev, credentials: (prev.credentials || []).filter(c => c !== cred) }))
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <GlassCard className="w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              {partner?.id ? <Pencil className="w-5 h-5 text-accent" /> : <Plus className="w-5 h-5 text-accent" />}
            </div>
            <div>
              <h2 className="font-display font-bold text-xl text-foreground">
                {partner?.id ? "Edit Partner" : "Add Partner"}
              </h2>
              <p className="font-mono text-xs text-foreground-muted">
                {partner?.id ? "Update partner information" : "Manually add a partner to your pool"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-6">
          {/* Basic Info Section */}
          <div>
            <h3 className="font-mono text-[10px] uppercase text-foreground-muted mb-3 flex items-center gap-2">
              <User className="w-3 h-3" /> Basic Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Partner Name *
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Fieldhouse Films"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Partner Type
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as "agency" | "freelancer" | "production" }))}
                  className="w-full bg-white/5 border border-border rounded-md px-3 py-2 text-foreground text-sm"
                >
                  <option value="agency">Agency</option>
                  <option value="freelancer">Freelancer</option>
                  <option value="production">Production Company</option>
                </select>
              </div>
              
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Discipline
                </label>
                {showCustomDiscipline ? (
                  <div className="flex gap-2">
                    <Input
                      value={customDisciplineInput}
                      onChange={(e) => setCustomDisciplineInput(e.target.value)}
                      placeholder="Enter custom discipline"
                      className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addCustomDiscipline()
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={addCustomDiscipline}
                      className="bg-accent text-background hover:bg-accent/90"
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowCustomDiscipline(false)
                        setCustomDisciplineInput("")
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={formData.discipline}
                      onChange={(e) => {
                        if (e.target.value === "__custom__") {
                          setShowCustomDiscipline(true)
                        } else {
                          setFormData(prev => ({ ...prev, discipline: e.target.value }))
                        }
                      }}
                      className="flex-1 bg-white/5 border border-border rounded-md px-3 py-2 text-foreground text-sm"
                    >
                      {allDisciplines.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                      <option value="__custom__">+ Add Custom Discipline</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Contact Info Section */}
          <div>
            <h3 className="font-mono text-[10px] uppercase text-foreground-muted mb-3 flex items-center gap-2">
              <Mail className="w-3 h-3" /> Contact Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Email
                </label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="contact@partner.com"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Location
                </label>
                <Input
                  value={formData.location}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  placeholder="New York, NY"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              
              <div className="col-span-2">
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Website
                </label>
                <Input
                  value={formData.website}
                  onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                  placeholder="www.partner.com"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
            </div>
          </div>
          
          {/* Professional Info Section */}
          <div>
            <h3 className="font-mono text-[10px] uppercase text-foreground-muted mb-3 flex items-center gap-2">
              <Briefcase className="w-3 h-3" /> Professional Details
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Rate Range
                </label>
                <Input
                  value={formData.rate}
                  onChange={(e) => setFormData(prev => ({ ...prev, rate: e.target.value }))}
                  placeholder="$100-150/hr"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              
              <div>
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Rating (0-5)
                </label>
                <Input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={formData.rating}
                  onChange={(e) => setFormData(prev => ({ ...prev, rating: parseFloat(e.target.value) || 0 }))}
                  placeholder="4.5"
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              
              <div className="col-span-2">
                <label className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider block mb-2">
                  Experience / Bio
                </label>
                <Textarea
                  value={formData.experience}
                  onChange={(e) => setFormData(prev => ({ ...prev, experience: e.target.value }))}
                  placeholder="Describe their experience, specialties, and notable work..."
                  rows={3}
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 resize-none"
                />
              </div>
            </div>
          </div>
          
          {/* Legal Status Section */}
          <div>
            <h3 className="font-mono text-[10px] uppercase text-foreground-muted mb-3 flex items-center gap-2">
              <Shield className="w-3 h-3" /> Legal Status
            </h3>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formData.ndaSigned}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, ndaSigned: !!checked }))}
                />
                <span className="font-mono text-sm text-foreground">NDA Signed</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formData.msaApproved}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, msaApproved: !!checked }))}
                />
                <span className="font-mono text-sm text-foreground">MSA Approved</span>
              </label>
            </div>
          </div>
          
          {/* Tags Section */}
          <div>
            <h3 className="font-mono text-[10px] uppercase text-foreground-muted mb-3">
              Tags / Specialties
            </h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {formData.tags?.map(tag => (
                <span key={tag} className="font-mono text-xs px-3 py-1 rounded-full bg-white/10 text-foreground flex items-center gap-1">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-400">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Add a tag..."
                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              />
              <Button variant="outline" onClick={addTag} className="border-border text-foreground-muted">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          {/* Credentials Section */}
          <div>
            <h3 className="font-mono text-[10px] uppercase text-foreground-muted mb-3 flex items-center gap-2">
              <Award className="w-3 h-3" /> Credentials / Awards
            </h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {formData.credentials?.map(cred => (
                <span key={cred} className="font-mono text-xs px-3 py-1 rounded-full bg-accent/10 text-accent flex items-center gap-1">
                  <Award className="w-3 h-3" />
                  {cred}
                  <button onClick={() => removeCredential(cred)} className="hover:text-red-400">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newCredential}
                onChange={(e) => setNewCredential(e.target.value)}
                placeholder="Add a credential or award..."
                className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCredential())}
              />
              <Button variant="outline" onClick={addCredential} className="border-border text-foreground-muted">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-border">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-border text-foreground-muted hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onSave(formData)}
              disabled={!formData.name?.trim()}
              className="flex-1 bg-accent text-background hover:bg-accent/90"
            >
              {partner?.id ? "Update Partner" : "Add Partner"}
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
