"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
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
  /** Agency-private JSON from DB; used for blacklisted flag in pool stats */
  partnership_notes?: unknown
  /** Enriched client-side (profiles + msa_agreements); not from GET /api/partnerships shape */
  partnerDisplayName?: string | null
  partnerAgencyType?: string | null
  partnerBio?: string | null
  partnerCapabilities?: string[]
  msaSigned?: boolean
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

type NetworkRow =
  | { mode: "demo"; inv: PartnerInvitation; partner?: Partner }
  | { mode: "prod"; p: Partnership }

// Demo invitations
const demoInvitations: PartnerInvitation[] = [
  {
    id: "demo-inv-1",
    partnerEmail: "contact@demo.withligament.com",
    partnerName: "Sample Production Studio",
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

function isPartnershipNotesBlacklisted(notes: unknown): boolean {
  if (notes == null) return false
  if (typeof notes === "string") {
    try {
      const o = JSON.parse(notes) as { blacklisted?: unknown }
      return o?.blacklisted === true || String(o?.blacklisted) === "true"
    } catch {
      return false
    }
  }
  if (typeof notes === "object" && !Array.isArray(notes)) {
    const b = (notes as { blacklisted?: unknown }).blacklisted
    return b === true || String(b) === "true"
  }
  return false
}

const NEW_PARTNERSHIP_DAYS = 30

/** Split profile `agency_type` when it lists multiple specialties (comma or semicolon). */
function splitAgencyTypeValues(value: string | null | undefined): string[] {
  if (!value?.trim()) return []
  return value
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function extractCapabilityValues(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean)
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,;]+/)
      .map((x) => x.trim())
      .filter(Boolean)
  }
  if (typeof raw === "object") {
    const maybeTags = (raw as { tags?: unknown }).tags
    if (Array.isArray(maybeTags)) {
      return maybeTags.map((x) => String(x).trim()).filter(Boolean)
    }
  }
  return []
}

function agencyTypeMatchesFilter(selectedType: string, agencyType: string | null | undefined): boolean {
  if (selectedType === "All") return true
  const at = (agencyType || "").trim().toLowerCase()
  if (!at) return false
  const s = selectedType.toLowerCase()
  if (at === s) return true
  if (s === "agency" && /\bagency\b/.test(at)) return true
  if (s === "freelancer" && /freelancer|independent|contractor|solo/.test(at)) return true
  if (s === "production" && /production|studio|video|film/.test(at)) return true
  return at.includes(s) || s.split(/\s+/).some((w) => w.length > 2 && at.includes(w))
}

function disciplineMatches(
  selectedDiscipline: string,
  agencyType: string | null | undefined,
  capabilities: unknown,
): boolean {
  if (selectedDiscipline === "All") return true
  const needle = selectedDiscipline.trim().toLowerCase()
  if (!needle) return true
  for (const token of splitAgencyTypeValues(agencyType)) {
    const x = token.toLowerCase()
    if (x === needle || x.includes(needle) || needle.includes(x)) return true
  }
  for (const cap of extractCapabilityValues(capabilities)) {
    const x = cap.toLowerCase()
    if (x === needle || x.includes(needle) || needle.includes(x)) return true
  }
  return false
}

function partnershipIsNew(p: Partnership): boolean {
  if (p.status !== "active" || isPartnershipNotesBlacklisted(p.partnership_notes)) return false
  const raw = p.acceptedAt || p.invitedAt
  if (!raw) return false
  const t = new Date(raw).getTime()
  if (Number.isNaN(t)) return false
  const days = (Date.now() - t) / (86400 * 1000)
  return days >= 0 && days <= NEW_PARTNERSHIP_DAYS
}

function partnershipMatchesStatusFilter(p: Partnership, selectedStatus: string): boolean {
  if (selectedStatus === "All") return true
  const bl = isPartnershipNotesBlacklisted(p.partnership_notes)
  if (selectedStatus === "Blacklisted") return bl
  if (bl) return false
  if (selectedStatus === "Pending") return p.status === "pending"
  if (selectedStatus === "New") return partnershipIsNew(p)
  if (selectedStatus === "Active") {
    return p.status === "active"
  }
  return true
}

function partnershipMatchesLegalFilter(p: Partnership, selectedLegal: string): boolean {
  if (selectedLegal === "All") return true
  const nda = Boolean(p.ndaConfirmedAt)
  const msa = Boolean(p.msaSigned)
  if (selectedLegal === "NDA Signed") return nda
  if (selectedLegal === "MSA Approved") return msa
  if (selectedLegal === "No NDA") return !nda
  if (selectedLegal === "No MSA") return !msa
  return true
}

function demoInvitationEffectiveStatus(inv: PartnerInvitation, partner: Partner | undefined): string {
  if (partner?.status === "blacklisted") return "Blacklisted"
  if (inv.status === "pending") return "Pending"
  if (partner?.status === "new") return "New"
  if (inv.status === "accepted" || inv.status === "confirmed") return "Active"
  return "Pending"
}

function demoInvitationMatchesStatus(inv: PartnerInvitation, partner: Partner | undefined, selectedStatus: string): boolean {
  if (selectedStatus === "All") return true
  const eff = demoInvitationEffectiveStatus(inv, partner)
  if (selectedStatus === "Blacklisted") return eff === "Blacklisted"
  if (eff === "Blacklisted") return false
  return eff === selectedStatus
}

function demoPartnerAgencyTypeLabel(partner: Partner | undefined): string | null {
  if (!partner) return null
  if (partner.type === "agency") return "Agency"
  if (partner.type === "freelancer") return "Freelancer"
  return "Production"
}

function demoInvitationMatchesLegal(partner: Partner | undefined, selectedLegal: string): boolean {
  if (selectedLegal === "All") return true
  const nda = Boolean(partner?.ndaSigned)
  const msa = Boolean(partner?.msaApproved)
  if (selectedLegal === "NDA Signed") return nda
  if (selectedLegal === "MSA Approved") return msa
  if (selectedLegal === "No NDA") return !nda
  if (selectedLegal === "No MSA") return !msa
  return true
}

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
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null)
  
  // Partnerships state (new closed ecosystem)
  const [partnerships, setPartnerships] = useState<Partnership[]>([])
  const [partnersWithActiveEngagements, setPartnersWithActiveEngagements] = useState(0)
  
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

  useEffect(() => {
    if (isDemo || !isLoaded) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/agency/utilization")
        if (!res.ok || cancelled) return
        const data = await res.json()
        const n = (data.summary as { partners_with_active_engagements?: number } | undefined)
          ?.partners_with_active_engagements
        if (!cancelled) {
          setPartnersWithActiveEngagements(Number.isFinite(Number(n)) ? Number(n) : 0)
        }
      } catch {
        if (!cancelled) setPartnersWithActiveEngagements(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo, isLoaded])
  
  const loadPartnerships = async () => {
    try {
      const response = await fetch('/api/partnerships')
      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      let loaded: Partnership[] = (data.partnerships || []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        partnerId: (p.partner as { id?: string } | undefined)?.id || (p.partner_id as string),
        partnerEmail:
          (p.partner as { email?: string } | undefined)?.email || (p.partner_email as string),
        partnerName: (p.partner as { full_name?: string } | undefined)?.full_name,
        partnerCompany: (p.partner as { company_name?: string } | undefined)?.company_name,
        status: p.status as Partnership["status"],
        invitedAt: (p.invited_at || p.created_at) as string,
        acceptedAt: p.accepted_at as string | undefined,
        ndaConfirmedAt: (p.nda_confirmed_at as string | null) ?? null,
        ndaConfirmedBy: (p.nda_confirmed_by as string | null) ?? null,
        invitationMessage: p.invitation_message as string | undefined,
        partnership_notes: p.partnership_notes,
      }))

      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user && loaded.length > 0) {
        const partnerIds = [
          ...new Set(
            loaded
              .map((row) => row.partnerId)
              .filter((id): id is string => typeof id === "string" && id.length > 0),
          ),
        ]
        const profileById: Record<
          string,
          {
            company_name: string | null
            full_name: string | null
            display_name: string | null
            agency_type: string | null
            bio: string | null
            capabilities: unknown
          }
        > = {}
        if (partnerIds.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, company_name, full_name, display_name, agency_type, bio, capabilities")
            .in("id", partnerIds)
          for (const pr of profs || []) {
            profileById[pr.id as string] = {
              company_name: pr.company_name as string | null,
              full_name: pr.full_name as string | null,
              display_name: pr.display_name as string | null,
              agency_type: pr.agency_type as string | null,
              bio: pr.bio as string | null,
              capabilities: (pr as { capabilities?: unknown }).capabilities ?? null,
            }
          }
        }
        const { data: msaRows } = await supabase
          .from("msa_agreements")
          .select("partnership_id, status")
          .eq("agency_id", user.id)
        const msaSignedIds = new Set(
          (msaRows || [])
            .filter((r) => (r.status as string) === "signed")
            .map((r) => r.partnership_id as string),
        )
        loaded = loaded.map((row) => {
          const prof = row.partnerId ? profileById[row.partnerId] : undefined
          return {
            ...row,
            partnerDisplayName: prof?.display_name ?? null,
            partnerAgencyType: prof?.agency_type ?? null,
            partnerBio: prof?.bio ?? null,
            partnerCapabilities: extractCapabilityValues(prof?.capabilities),
            partnerName: row.partnerName || prof?.full_name || undefined,
            partnerCompany: row.partnerCompany || prof?.company_name || undefined,
            msaSigned: msaSignedIds.has(row.id),
          }
        })
      } else {
        loaded = loaded.map((row) => ({ ...row, msaSigned: false }))
      }
      setPartnerships(loaded)
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
      const { data: { user }, error: authErr } = await supabase.auth.getUser()
      if (authErr) {
        console.error('[agency/pool] loadAccessRequests getUser failed', { message: authErr.message })
        return
      }
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
      
      if (error) {
        console.error('[agency/pool] partner_access_requests select failed', {
          agencyId: user.id,
          message: error.message,
          code: error.code,
        })
      } else if (data) {
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
      console.error('[agency/pool] loadAccessRequests threw', {
        message: error instanceof Error ? error.message : String(error),
      })
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
      
      if (error) {
        console.error('[agency/pool] approve access request update failed', {
          requestId,
          message: error.message,
          code: error.code,
        })
      } else {
        await loadAccessRequests()
      }
    } catch (error) {
      console.error('[agency/pool] handleApproveRequest threw', {
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
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
      
      if (error) {
        console.error('[agency/pool] decline access request update failed', {
          requestId,
          message: error.message,
          code: error.code,
        })
      } else {
        await loadAccessRequests()
      }
    } catch (error) {
      console.error('[agency/pool] handleDeclineRequest threw', {
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    setProcessingRequest(null)
  }

  const handleConfirmNdaSigned = async (partnershipId: string) => {
    if (isDemo) {
      return
    }
    setConfirmingNdaFor(partnershipId)
    try {
      const response = await fetch('/api/partnerships', {
        method: 'PATCH',
        credentials: "same-origin",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnershipId, action: 'confirm_nda' }),
      })
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
      
      const data = await response.json().catch(() => ({}))
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
      console.error('[agency/pool] POST /api/partnerships (invite) threw', {
        message: error instanceof Error ? error.message : String(error),
      })
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
    name: "Partner organization",
    discipline: "Video Production",
    type: "agency",
    location: "New York, NY",
    email: "",
    website: "",
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

  const allNetworkRows: NetworkRow[] = useMemo(() => {
    if (!isLoaded) return []
    if (isDemo) {
      return invitations
        .filter((inv) => inv.status !== "declined")
        .map((inv) => ({
          mode: "demo" as const,
          inv,
          partner: partners.find((x) => x.email.toLowerCase() === inv.partnerEmail.toLowerCase()),
        }))
    }
    return partnerships.map((p) => ({ mode: "prod" as const, p }))
  }, [isDemo, isLoaded, invitations, partners, partnerships])

  const filteredNetworkRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allNetworkRows.filter((row) => {
      if (row.mode === "demo") {
        const { inv, partner } = row
        if (q) {
          const hay = [inv.partnerName, inv.partnerEmail, partner?.name, partner?.email]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
          if (!hay.includes(q)) return false
        }
        const at = demoPartnerAgencyTypeLabel(partner)
        if (!agencyTypeMatchesFilter(selectedType, at)) return false
        if (!demoInvitationMatchesStatus(inv, partner, selectedStatus)) return false
        if (!demoInvitationMatchesLegal(partner, selectedLegal)) return false
        if (!disciplineMatches(selectedDiscipline, partner?.discipline ?? null, partner?.tags ?? [])) return false
        return true
      }
      const p = row.p
      if (q) {
        const hay = [p.partnerCompany, p.partnerName, p.partnerDisplayName, p.partnerEmail]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (!agencyTypeMatchesFilter(selectedType, p.partnerAgencyType)) return false
      if (!partnershipMatchesStatusFilter(p, selectedStatus)) return false
      if (!partnershipMatchesLegalFilter(p, selectedLegal)) return false
      if (!disciplineMatches(selectedDiscipline, p.partnerAgencyType, p.partnerCapabilities ?? [])) return false
      return true
    })
  }, [
    allNetworkRows,
    searchQuery,
    selectedType,
    selectedStatus,
    selectedLegal,
    selectedDiscipline,
  ])

  const filteredPartners = useMemo(() => {
    if (!isLoaded) return []
    const q = searchQuery.trim().toLowerCase()
    return partners.filter((p) => {
      if (q) {
        const hay = [p.name, p.email, ...(p.tags || [])].filter(Boolean).join(" ").toLowerCase()
        if (!hay.includes(q)) return false
      }
      const typeLabel = demoPartnerAgencyTypeLabel(p)
      if (!agencyTypeMatchesFilter(selectedType, typeLabel)) return false
      if (selectedStatus === "Blacklisted") {
        if (p.status !== "blacklisted") return false
      } else if (selectedStatus !== "All") {
        if (p.status === "blacklisted") return false
        if (selectedStatus === "Active" && p.status !== "active") return false
        if (selectedStatus === "Pending" && p.status !== "pending") return false
        if (selectedStatus === "New" && p.status !== "new") return false
      }
      if (selectedLegal === "NDA Signed" && !p.ndaSigned) return false
      if (selectedLegal === "MSA Approved" && !p.msaApproved) return false
      if (selectedLegal === "No NDA" && p.ndaSigned) return false
      if (selectedLegal === "No MSA" && p.msaApproved) return false
      if (!disciplineMatches(selectedDiscipline, p.discipline, p.tags || [])) return false
      if (showBookmarkedOnly && !p.bookmarked) return false
      return true
    })
  }, [
    isLoaded,
    partners,
    searchQuery,
    selectedType,
    selectedStatus,
    selectedLegal,
    selectedDiscipline,
    showBookmarkedOnly,
  ])

  const filteredPendingNetworkRows = useMemo(
    () =>
      filteredNetworkRows.filter((r) =>
        r.mode === "demo" ? r.inv.status === "pending" : r.p.status === "pending",
      ),
    [filteredNetworkRows],
  )

  const dynamicDisciplineFilters = useMemo(() => {
    const seen = new Map<string, string>()
    const add = (raw: string) => {
      const t = raw.trim()
      if (!t) return
      const k = t.toLowerCase()
      if (!seen.has(k)) seen.set(k, t)
    }

    if (isDemo) {
      for (const p of partners) {
        for (const part of splitAgencyTypeValues(p.discipline)) add(part)
        for (const part of extractCapabilityValues(p.tags || [])) add(part)
      }
    } else {
      for (const p of partnerships) {
        for (const part of splitAgencyTypeValues(p.partnerAgencyType)) add(part)
        for (const part of extractCapabilityValues(p.partnerCapabilities || [])) add(part)
      }
    }

    const sorted = [...seen.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    )
    return ["All", ...sorted]
  }, [isDemo, partners, partnerships])

  const totalFilteredMatches = filteredNetworkRows.length + filteredPartners.length
  const hasNetworkSource = allNetworkRows.length > 0

  if (!isLoaded) {
    return (
      <AgencyLayout title="Partner Pool">
        <div className="flex items-center justify-center h-64">
          <div className="text-foreground-muted">Loading...</div>
        </div>
      </AgencyLayout>
    )
  }

  const activePartnersStat = isDemo
    ? activePartnerships
    : partnerships.filter((p) => p.status === "active").length

  const partnersWithActiveEngagementsStat = isDemo
    ? Math.min(activePartnerships, 2)
    : partnersWithActiveEngagements

  const blacklistedPartnersStat = isDemo
    ? partners.filter((p) => p.status === "blacklisted").length
    : partnerships.filter((p) => isPartnershipNotesBlacklisted(p.partnership_notes)).length

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

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-foreground">{activePartnersStat}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">
              Active Partners
            </div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-accent">{partnersWithActiveEngagementsStat}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">
              Partners with Active Engagements
            </div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="font-display font-bold text-3xl text-red-400">{blacklistedPartnersStat}</div>
            <div className="font-mono text-[10px] text-red-400 uppercase tracking-wider mt-1">Blacklisted</div>
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
            {dynamicDisciplineFilters.map((discipline) => (
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

        {(allNetworkRows.length > 0 || partners.length > 0) && (
          <p className="font-mono text-[11px] text-foreground-muted mb-6">
            Showing {totalFilteredMatches} result{totalFilteredMatches !== 1 ? "s" : ""}
            {allNetworkRows.length > 0 && (
              <span>
                {" "}
                · {filteredNetworkRows.length} in network (of {allNetworkRows.length})
              </span>
            )}
            {partners.length > 0 && (
              <span>
                {" "}
                · {filteredPartners.length} in discovery (of {partners.length})
              </span>
            )}
          </p>
        )}

        {hasNetworkSource && (
          <div className="mb-8 rounded-lg border border-border bg-white/[0.03] p-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-display font-bold text-foreground">Partner network</h3>
                <p className="text-sm text-foreground-muted">
                  Active partnerships, pending invites, and status for your roster.
                </p>
              </div>
            </div>
            {filteredNetworkRows.length === 0 ? (
              <p className="mt-4 text-sm text-foreground-muted">No partners match your filters.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {filteredNetworkRows.map((row) => {
                  if (row.mode === "demo") {
                    const { inv, partner } = row
                    const bl = partner?.status === "blacklisted"
                    const pending = inv.status === "pending"
                    const eff = demoInvitationEffectiveStatus(inv, partner)
                    const showActiveUi = eff === "Active" || eff === "New"
                    const title = inv.partnerName || inv.partnerEmail
                    const subLine = pending
                      ? `Invited ${new Date(inv.invitedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                      : `Active since ${new Date(inv.acceptedAt || inv.invitedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                    return (
                      <div
                        key={inv.id}
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white/5 p-3",
                          bl
                            ? "border-red-500/30"
                            : pending
                              ? "border-amber-500/25"
                              : showActiveUi
                                ? "border-green-500/25"
                                : "border-border",
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={cn(
                              "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                              bl
                                ? "bg-red-500/20"
                                : pending
                                  ? "bg-amber-500/20"
                                  : showActiveUi
                                    ? "bg-green-500/20"
                                    : "bg-white/10",
                            )}
                          >
                            <Building2
                              className={cn(
                                "w-4 h-4",
                                bl ? "text-red-400" : pending ? "text-amber-400" : showActiveUi ? "text-green-400" : "text-foreground-muted",
                              )}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate">{title}</div>
                            <div className="font-mono text-[10px] text-foreground-muted">{subLine}</div>
                            {partner && (
                              <div className="font-mono text-[10px] mt-1 text-foreground-muted">
                                {partner.ndaSigned ? (
                                  <span className="text-green-400">NDA on file</span>
                                ) : (
                                  <span className="text-amber-300">NDA pending</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={cn(
                              "font-mono text-[10px] px-2 py-1 rounded-full",
                              bl
                                ? "bg-red-500/10 text-red-400"
                                : pending
                                  ? "bg-amber-500/10 text-amber-400"
                                  : eff === "New"
                                    ? "bg-accent/10 text-accent"
                                    : "bg-green-500/10 text-green-400",
                            )}
                          >
                            {eff}
                          </span>
                        </div>
                      </div>
                    )
                  }
                  const p = row.p
                  const bl = isPartnershipNotesBlacklisted(p.partnership_notes)
                  const pending = p.status === "pending"
                  const isActive = p.status === "active" && !bl
                  const isNew = partnershipIsNew(p)
                  const title = p.partnerCompany || p.partnerName || p.partnerEmail
                  const subLine = pending
                    ? `Invited ${new Date(p.invitedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                    : p.acceptedAt
                      ? `Active since ${new Date(p.acceptedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                      : `Since ${new Date(p.invitedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  const badgeLabel = bl
                    ? "Blacklisted"
                    : pending
                      ? "Pending"
                      : p.status === "suspended"
                        ? "Suspended"
                        : p.status === "terminated"
                          ? "Terminated"
                          : isNew
                            ? "New"
                            : "Active"
                  return (
                    <div
                      key={p.id}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white/5 p-3",
                        bl
                          ? "border-red-500/30"
                          : pending
                            ? "border-amber-500/25"
                            : isActive
                              ? "border-green-500/25"
                              : "border-border",
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                            bl
                              ? "bg-red-500/20"
                              : pending
                                ? "bg-amber-500/20"
                                : isActive
                                  ? "bg-green-500/20"
                                  : "bg-white/10",
                          )}
                        >
                          <Building2
                            className={cn(
                              "w-4 h-4",
                              bl ? "text-red-400" : pending ? "text-amber-400" : isActive ? "text-green-400" : "text-foreground-muted",
                            )}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-foreground truncate">{title}</div>
                          <div className="font-mono text-[10px] text-foreground-muted">{subLine}</div>
                          <div className="font-mono text-[10px] mt-1">
                            {p.ndaConfirmedAt ? (
                              <span className="text-green-400">
                                NDA signed{" "}
                                {new Date(p.ndaConfirmedAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </span>
                            ) : (
                              <span className="text-amber-300">NDA pending</span>
                            )}
                            {p.msaSigned ? (
                              <span className="text-green-400 ml-2">MSA signed</span>
                            ) : (
                              <span className="text-foreground-muted ml-2">MSA open</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.partnerId && !bl && (
                          <Link
                            href={`/agency/pool/${encodeURIComponent(p.partnerId)}`}
                            className="inline-flex items-center gap-1 font-mono text-[10px] text-accent hover:underline px-2 py-1 rounded-md border border-accent/30 hover:bg-accent/10"
                          >
                            View profile
                            <ChevronRight className="w-3 h-3" />
                          </Link>
                        )}
                        {isActive && !p.ndaConfirmedAt && !bl && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={confirmingNdaFor === p.id}
                            onClick={() => handleConfirmNdaSigned(p.id)}
                            className="h-7 border-green-500/40 text-green-300 hover:bg-green-500/10"
                          >
                            {confirmingNdaFor === p.id ? "Saving..." : "Confirm NDA Signed"}
                          </Button>
                        )}
                        <span
                          className={cn(
                            "font-mono text-[10px] px-2 py-1 rounded-full",
                            bl
                              ? "bg-red-500/10 text-red-400"
                              : pending
                                ? "bg-amber-500/10 text-amber-400"
                                : isNew
                                  ? "bg-accent/10 text-accent"
                                  : p.status === "active"
                                    ? "bg-green-500/10 text-green-400"
                                    : "bg-white/10 text-foreground-muted",
                          )}
                        >
                          {badgeLabel}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Discovery grid */}
        {partners.length > 0 ? (
          <>
            <h3 className="font-display font-bold text-lg text-foreground mb-4">Discovery</h3>
            {filteredPartners.length === 0 ? (
              <GlassCard className="p-8 text-center col-span-full mb-6">
                <p className="text-foreground-muted">No partners match your filters.</p>
              </GlassCard>
            ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
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
          </>
        ) : !hasNetworkSource ? (
          <GlassCard className="p-12 text-center mb-6">
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
        ) : null}

        {/* Pending Confirmations Alert */}
        {filteredPendingNetworkRows.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-foreground">
                  {filteredPendingNetworkRows.length} Invitation{filteredPendingNetworkRows.length > 1 ? "s" : ""} Awaiting Response
                </h3>
                <p className="text-sm text-foreground-muted">
                  Waiting for these partners to accept your invitation.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {filteredPendingNetworkRows.map((row) => {
                if (row.mode === "demo") {
                  const inv = row.inv
                  return (
                    <div key={inv.id} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                          <Mail className="w-4 h-4 text-amber-400" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground">
                            {inv.partnerName || inv.partnerEmail}
                          </div>
                          <div className="font-mono text-[10px] text-foreground-muted">
                            Invited on{" "}
                            {new Date(inv.invitedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-amber-500/10 text-amber-400">
                        Pending
                      </span>
                    </div>
                  )
                }
                const p = row.p
                return (
                  <div key={p.id} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                        <Mail className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <div className="font-medium text-foreground">
                          {p.partnerCompany || p.partnerName || p.partnerEmail}
                        </div>
                        <div className="font-mono text-[10px] text-foreground-muted">
                          Invited on{" "}
                          {new Date(p.invitedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-amber-500/10 text-amber-400">
                      Pending
                    </span>
                  </div>
                )
              })}
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
                <button onClick={() => setSelectedPartner(null)} className="text-foreground hover:text-accent">
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
                <button onClick={() => setShowInviteModal(false)} className="text-foreground hover:text-accent">
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
          <button onClick={onClose} className="text-foreground hover:text-accent">
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
                  placeholder="e.g., Your production company"
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
                  <button onClick={() => removeTag(tag)} className="text-foreground hover:text-red-400">
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
              <Button variant="outline" onClick={addTag} className="border-border text-foreground hover:text-foreground">
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
                  <button onClick={() => removeCredential(cred)} className="text-accent hover:text-red-400">
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
              <Button variant="outline" onClick={addCredential} className="border-border text-foreground hover:text-foreground">
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
