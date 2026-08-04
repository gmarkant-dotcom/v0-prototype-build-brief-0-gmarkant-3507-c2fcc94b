"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { cn } from "@/lib/utils"
import {
  Building2, Search, Send, CheckCircle, Clock, MapPin, Globe, Users, X, Zap,
  Mail, Check, Calendar, MessageSquare,
} from "lucide-react"
import {
  DESIGNATION_KEYS,
  DESIGNATION_LABELS,
  INSURANCE_KEYS,
  INSURANCE_LABELS,
  type DesignationKey,
  type InsuranceKey,
  businessCriteriaHoldsMatchesSelection,
  withBusinessCriteriaDefaults,
} from "@/lib/business-criteria"

// ── Types ────────────────────────────────────────────────────────────────────
// Reused verbatim from app/partner/invitations/page.tsx and app/partner/discover/page.tsx.

interface Partnership {
  id: string
  agency_id: string
  partner_id: string | null
  status: "pending" | "active" | "suspended" | "terminated"
  invitation_message: string | null
  created_at: string
  accepted_at: string | null
  agency?: {
    id: string
    company_name: string
    full_name: string
    email: string
    company_logo_url?: string | null
    capabilities?: unknown
  }
}

interface Agency {
  id: string
  company_name: string
  full_name: string
  company_website?: string
  company_logo_url?: string
  company_linkedin_url?: string
  reel_url?: string
  capabilities?: unknown
  work_examples?: unknown
  email?: string
  location?: string
  website?: string
  bio?: string
  agency_type?: string
  partner_count?: number
  collaborated?: boolean
  has_partnership?: boolean
  business_criteria?: unknown
  vouch_count?: number
}

interface AccessRequest {
  id: string
  agency_id: string
  status: "pending" | "approved" | "declined"
}

interface SharedProject {
  id: string
  title: string
  status?: string
  updated_at?: string
  assignmentStatus?: string
  clientName?: string
}

type Tab = "my-agencies" | "invitations" | "discover"

// ── Demo data ────────────────────────────────────────────────────────────────

const demoPartnerships: Partnership[] = [
  {
    id: "demo-1",
    agency_id: "demo-agency-1",
    partner_id: "demo-partner-1",
    status: "pending",
    invitation_message: "We'd love to have you join our network for upcoming sports content projects. Your reel is impressive!",
    created_at: new Date().toISOString(),
    accepted_at: null,
    agency: {
      id: "demo-agency-1",
      company_name: "Electric Animal",
      full_name: "Electric Animal Agency",
      email: "contact@electricanimal.com",
    },
  },
  {
    id: "demo-2",
    agency_id: "demo-agency-2",
    partner_id: "demo-partner-1",
    status: "active",
    invitation_message: "Welcome to our preferred vendor network.",
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    agency: {
      id: "demo-agency-2",
      company_name: "Momentum Worldwide",
      full_name: "Momentum Agency",
      email: "contact@momentum.com",
      capabilities: ["Experiential", "Brand Activation"],
    },
  },
]

const demoAgencies: Agency[] = [
  {
    id: "demo-agency-1",
    company_name: "Electric Animal",
    full_name: "Electric Animal Agency",
    location: "Los Angeles, CA",
    website: "electricanimal.com",
    agency_type: "Sports Marketing",
    bio: "Award-winning creative agency specializing in sports and entertainment marketing.",
    partner_count: 24,
  },
  {
    id: "demo-agency-2",
    company_name: "Momentum Worldwide",
    full_name: "Momentum Agency",
    location: "New York, NY",
    website: "momentumww.com",
    agency_type: "Experiential",
    bio: "Global experiential marketing agency creating memorable brand experiences.",
    partner_count: 56,
  },
  {
    id: "demo-agency-3",
    company_name: "Wasserman",
    full_name: "Wasserman",
    location: "Los Angeles, CA",
    website: "teamwass.com",
    agency_type: "Integrated Agency",
    bio: "Sports, entertainment, and lifestyle marketing powerhouse.",
    partner_count: 42,
  },
]

// ── Helpers reused from app/partner/discover/page.tsx ─────────────────────────

/** Split profile agency_type when it lists multiple specialties (comma or semicolon). Mirrors app/agency/pool/page.tsx. */
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

/** Mirrors disciplineMatches in app/agency/pool/page.tsx, adapted for the Agency shape here. */
function disciplineMatches(selectedDiscipline: string, agencyType: string | null | undefined, capabilities: unknown): boolean {
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

function getStatusBadge(status: string, surface: "dark" | "light") {
  switch (status) {
    case "pending":
      return surface === "dark" ? (
        <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40">
          Pending Your Response
        </span>
      ) : (
        <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
          Pending Your Response
        </span>
      )
    case "active":
      return surface === "dark" ? (
        <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-success/25 text-success ring-1 ring-success/50">
          Active Partnership
        </span>
      ) : (
        <span className="bg-success/15 text-success border border-success/30 font-medium text-xs px-2 py-1 rounded-full">
          Active Partnership
        </span>
      )
    case "suspended":
      return surface === "dark" ? (
        <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-orange-500/20 text-orange-100 ring-1 ring-orange-400/40">
          Suspended
        </span>
      ) : (
        <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-orange-100 text-orange-900 border border-orange-300">
          Suspended
        </span>
      )
    case "terminated":
      return surface === "dark" ? (
        <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-red-500/20 text-red-100 ring-1 ring-red-400/40">
          Terminated
        </span>
      ) : (
        <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-red-100 text-red-900 border border-red-300">
          Terminated
        </span>
      )
    default:
      return null
  }
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 py-2.5 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px transition-colors flex items-center gap-2",
        active ? "border-vendor-foreground text-vendor-foreground" : "border-transparent text-vendor-muted hover:text-vendor-foreground"
      )}
    >
      {children}
    </button>
  )
}

export default function AgencyNetworkPage() {
  const isDemo = isDemoMode()
  const [activeTab, setActiveTab] = useState<Tab>("my-agencies")
  const [searchQuery, setSearchQuery] = useState("")

  // Partnerships (My Agencies + Invitations tabs) — reused from invitations/page.tsx
  const [partnerships, setPartnerships] = useState<Partnership[]>([])
  const [isLoadingPartnerships, setIsLoadingPartnerships] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  // Discover tab — reused from discover/page.tsx
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [myRequests, setMyRequests] = useState<AccessRequest[]>([])
  const [isLoadingAgencies, setIsLoadingAgencies] = useState(true)
  const [requestingAgency, setRequestingAgency] = useState<string | null>(null)
  const [requestMessage, setRequestMessage] = useState("")
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [cachedUserId, setCachedUserId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"network" | "all">("all")
  const [selectedDiscipline, setSelectedDiscipline] = useState("All")
  const [selectedDesignationFilters, setSelectedDesignationFilters] = useState<DesignationKey[]>([])
  const [selectedInsuranceFilters, setSelectedInsuranceFilters] = useState<InsuranceKey[]>([])

  // Agency profile modal — shared by the My Agencies and Discover tabs
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null)
  const [showAgencyProfileModal, setShowAgencyProfileModal] = useState(false)
  const [agencyProfileProjects, setAgencyProfileProjects] = useState<SharedProject[]>([])
  const [isLoadingAgencyProfile, setIsLoadingAgencyProfile] = useState(false)

  const toggleDesignationFilter = (key: DesignationKey) => {
    setSelectedDesignationFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }
  const toggleInsuranceFilter = (key: InsuranceKey) => {
    setSelectedInsuranceFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const loadPartnerships = useCallback(async () => {
    if (isDemo) {
      setPartnerships(demoPartnerships)
      setIsLoadingPartnerships(false)
      return
    }
    try {
      const response = await fetch("/api/partnerships")
      if (response.ok) {
        const data = await response.json()
        setPartnerships(data.partnerships || [])
      }
    } catch (error) {
      console.error("Error loading partnerships:", error)
    }
    setIsLoadingPartnerships(false)
  }, [isDemo])

  useEffect(() => {
    loadPartnerships()
  }, [loadPartnerships])

  useEffect(() => {
    if (isDemo) return
    let cancelled = false
    ;(async () => {
      try {
        const claimRes = await fetch("/api/partner/partnerships/claim", {
          method: "POST",
          credentials: "same-origin",
        })
        if (claimRes.status === 401) return
        if (!claimRes.ok) {
          const body = await claimRes.text().catch(() => "")
          console.error("[partner/network] claim failed", claimRes.status, body)
          return
        }
        if (!cancelled) {
          await loadPartnerships()
        }
      } catch (error) {
        console.error("[partner/network] claim request error", error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo, loadPartnerships])

  const handleAccept = async (partnershipId: string) => {
    if (isDemo) {
      setPartnerships((prev) =>
        prev.map((p) => (p.id === partnershipId ? { ...p, status: "active" as const, accepted_at: new Date().toISOString() } : p))
      )
      return
    }
    setUpdating(partnershipId)
    try {
      const response = await fetch("/api/partnerships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnershipId, status: "active" }),
      })
      const data = await response.json()
      if (response.ok) {
        await loadPartnerships()
      } else {
        alert(data.error || "Failed to accept partnership")
      }
    } catch (error) {
      console.error("Error accepting partnership:", error)
    }
    setUpdating(null)
  }

  const handleDecline = async (partnershipId: string) => {
    if (isDemo) {
      setPartnerships((prev) => prev.filter((p) => p.id !== partnershipId))
      return
    }
    setUpdating(partnershipId)
    try {
      const response = await fetch("/api/partnerships", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnershipId, status: "terminated" }),
      })
      const data = await response.json()
      if (response.ok) {
        await loadPartnerships()
      } else {
        alert(data.error || "Failed to decline partnership")
      }
    } catch (error) {
      console.error("Error declining partnership:", error)
    }
    setUpdating(null)
  }

  const loadMyRequests = async (supabase: ReturnType<typeof createClient>, userId: string) => {
    try {
      const { data, error } = await supabase
        .from("partner_access_requests")
        .select("id, agency_id, status")
        .eq("partner_id", userId)
      if (!error) setMyRequests(data || [])
    } catch (error) {
      console.error("Error loading requests:", error)
    }
  }

  useEffect(() => {
    const load = async () => {
      if (isDemo) {
        setAgencies(demoAgencies)
        setMyRequests([{ id: "demo-req-1", agency_id: "demo-agency-2", status: "approved" }])
        setIsLoadingAgencies(false)
        return
      }
      const supabase = createClient()
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setIsLoadingAgencies(false)
          return
        }
        setCachedUserId(user.id)
        const [agencyRes] = await Promise.all([
          fetch("/api/marketplace/discoverable?role=agency", { cache: "no-store" }),
          loadMyRequests(supabase, user.id),
        ])
        const payload = await agencyRes.json().catch(() => ({}))
        if (!agencyRes.ok) throw new Error(payload?.error || "Failed to load discoverable agencies")
        const rows = (payload?.profiles || []) as Agency[]
        setAgencies(rows.map((row) => ({ ...row, collaborated: row.has_partnership === true })))
      } catch (error) {
        console.error("Error:", error)
      }
      setIsLoadingAgencies(false)
    }
    load()
  }, [isDemo])

  const handleRequestAccess = async () => {
    if (!selectedAgency) return
    if (isDemo) {
      setMyRequests((prev) => [...prev, { id: `demo-req-${Date.now()}`, agency_id: selectedAgency.id, status: "pending" }])
      setShowRequestModal(false)
      setSelectedAgency(null)
      setRequestMessage("")
      return
    }
    setRequestingAgency(selectedAgency.id)
    try {
      const userId = cachedUserId
      if (!userId) return
      const supabase = createClient()
      const { error } = await supabase.from("partner_access_requests").insert({
        partner_id: userId,
        agency_id: selectedAgency.id,
        request_message: requestMessage || null,
        status: "pending",
      })
      if (!error) {
        await loadMyRequests(supabase, userId)
        setShowRequestModal(false)
        setSelectedAgency(null)
        setRequestMessage("")
      }
    } catch (error) {
      console.error("Error requesting access:", error)
    }
    setRequestingAgency(null)
  }

  const getRequestStatus = (agencyId: string) => myRequests.find((req) => req.agency_id === agencyId)

  const openAgencyProfile = async (agency: Agency) => {
    setSelectedAgency(agency)
    setShowAgencyProfileModal(true)
    setIsLoadingAgencyProfile(true)

    if (isDemo) {
      setAgencyProfileProjects([{ id: "demo-project-1", title: "NWSL Creator Content Series", status: "active", updated_at: "2026-03-01" }])
      setIsLoadingAgencyProfile(false)
      return
    }

    try {
      const response = await fetch("/api/projects")
      if (!response.ok) {
        setAgencyProfileProjects([])
        setIsLoadingAgencyProfile(false)
        return
      }
      const payload = await response.json()
      const rows = payload.projects || []
      const shared = rows
        .filter((p: any) => p?.agency?.id === agency.id)
        .map((p: any) => ({
          id: p.id,
          title: p.title || p.name || "Untitled Project",
          status: p.status,
          updated_at: p.updated_at || p.created_at,
          assignmentStatus: p.assignment?.status,
          clientName: p.client_name || "Client TBD",
        }))
      setAgencyProfileProjects(shared)
    } catch (error) {
      console.error("Error loading agency profile projects:", error)
      setAgencyProfileProjects([])
    }
    setIsLoadingAgencyProfile(false)
  }

  /** Feeds an active partnership's (minimal) agency data into the same profile modal Discover uses. */
  const openAgencyProfileFromPartnership = (partnership: Partnership) => {
    const a = partnership.agency
    if (!a) return
    void openAgencyProfile({
      id: a.id,
      company_name: a.company_name,
      full_name: a.full_name,
      email: a.email,
      company_logo_url: a.company_logo_url ?? undefined,
      capabilities: a.capabilities,
      collaborated: true,
    })
  }

  const pendingPartnerships = useMemo(() => partnerships.filter((p) => p.status === "pending"), [partnerships])
  const activePartnerships = useMemo(() => partnerships.filter((p) => p.status === "active"), [partnerships])

  const matchesSearch = (name: string, email: string | undefined, q: string) =>
    !q || name.toLowerCase().includes(q) || (email || "").toLowerCase().includes(q)

  const searchedActivePartnerships = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return activePartnerships.filter((p) =>
      matchesSearch(p.agency?.company_name || p.agency?.full_name || "", p.agency?.email, q)
    )
  }, [activePartnerships, searchQuery])

  const searchedPendingPartnerships = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return pendingPartnerships.filter((p) =>
      matchesSearch(p.agency?.company_name || p.agency?.full_name || "", p.agency?.email, q)
    )
  }, [pendingPartnerships, searchQuery])

  const dynamicDisciplineFilters = useMemo(() => {
    const seen = new Map<string, string>()
    const add = (raw: string) => {
      const t = raw.trim()
      if (!t) return
      const k = t.toLowerCase()
      if (!seen.has(k)) seen.set(k, t)
    }
    for (const agency of agencies) {
      for (const part of splitAgencyTypeValues(agency.agency_type)) add(part)
      for (const part of extractCapabilityValues(agency.capabilities)) add(part)
    }
    const sorted = [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    return ["All", ...sorted]
  }, [agencies])

  const filteredAgencies = useMemo(() => {
    return agencies.filter((agency) => {
      if (viewMode === "network") {
        const request = myRequests.find((req) => req.agency_id === agency.id)
        const inNetwork = agency.collaborated === true || request?.status === "approved"
        if (!inNetwork) return false
      }

      const query = searchQuery.toLowerCase()
      if (query) {
        const displayName = agency.company_name || agency.full_name || agency.email || ""
        const caps = Array.isArray(agency.capabilities)
          ? agency.capabilities.some((c: unknown) => typeof c === "string" && c.toLowerCase().includes(query))
          : false
        const matchesQuery =
          displayName.toLowerCase().includes(query) ||
          agency.email?.toLowerCase().includes(query) ||
          (agency.location || "").toLowerCase().includes(query) ||
          (agency.bio || "").toLowerCase().includes(query) ||
          (agency.agency_type || "").toLowerCase().includes(query) ||
          caps
        if (!matchesQuery) return false
      }

      if (!disciplineMatches(selectedDiscipline, agency.agency_type, agency.capabilities)) return false

      if (
        !businessCriteriaHoldsMatchesSelection(
          withBusinessCriteriaDefaults(agency.business_criteria),
          selectedDesignationFilters,
          selectedInsuranceFilters
        )
      )
        return false

      return true
    })
  }, [agencies, searchQuery, viewMode, myRequests, selectedDiscipline, selectedDesignationFilters, selectedInsuranceFilters])

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-vendor-foreground">Agency Network</h1>
          <p className="text-vendor-muted-strong mt-1">Your agency partnerships, pending invitations, and agencies to discover</p>
        </div>

        {/* Unified search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vendor-muted/70" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agencies by name or location..."
            className="pl-10 bg-vendor-surface border-vendor-border text-vendor-foreground"
          />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-vendor-border">
          <TabButton active={activeTab === "my-agencies"} onClick={() => setActiveTab("my-agencies")}>
            My Agencies
          </TabButton>
          <TabButton active={activeTab === "invitations"} onClick={() => setActiveTab("invitations")}>
            Invitations
            {pendingPartnerships.length > 0 && (
              <span className="font-mono text-[10px] min-w-[18px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-center">
                {pendingPartnerships.length}
              </span>
            )}
          </TabButton>
          <TabButton active={activeTab === "discover"} onClick={() => setActiveTab("discover")}>
            Discover
          </TabButton>
        </div>

        {/* My Agencies */}
        {activeTab === "my-agencies" &&
          (isLoadingPartnerships ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-vendor-muted">Loading agencies...</div>
            </div>
          ) : searchedActivePartnerships.length === 0 ? (
            <div className="bg-vendor-surface rounded-xl border border-vendor-border p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-vendor-foreground/10 flex items-center justify-center mx-auto mb-4">
                <Building2 className="w-8 h-8 text-vendor-foreground" />
              </div>
              <h3 className="font-display font-bold text-xl text-vendor-foreground mb-2">No Agency Partnerships Yet</h3>
              <p className="text-vendor-muted max-w-md mx-auto">
                {searchQuery
                  ? "No agencies match your search."
                  : "Active partnerships with lead agencies appear here. Check the Discover tab to find and connect with new agencies."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {searchedActivePartnerships.map((partnership) => {
                const caps = extractCapabilityValues(partnership.agency?.capabilities)
                return (
                  <div key={partnership.id} className="bg-vendor-surface border border-vendor-border shadow-sm rounded-xl p-5 flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                      {partnership.agency?.company_logo_url ? (
                        <img
                          src={partnership.agency.company_logo_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Building2 className="w-6 h-6 text-vendor-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <h3 className="font-display text-vendor-foreground text-lg font-bold">
                          {partnership.agency?.company_name || partnership.agency?.full_name || "Lead Agency"}
                        </h3>
                        {getStatusBadge(partnership.status, "light")}
                      </div>
                      {partnership.agency?.email && <p className="text-vendor-foreground text-sm mb-2">{partnership.agency.email}</p>}
                      {caps.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {caps.slice(0, 6).map((c) => (
                            <span key={c} className="px-2 py-0.5 rounded-full bg-gray-100 text-vendor-foreground text-xs">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                      {partnership.accepted_at && (
                        <p className="text-vendor-muted text-xs">
                          Partnered since{" "}
                          {new Date(partnership.accepted_at).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      )}
                      <div className="mt-3">
                        <Button
                          type="button"
                          onClick={() => openAgencyProfileFromPartnership(partnership)}
                          variant="outline"
                          className="h-8 px-3 border-vendor-foreground text-vendor-foreground hover:bg-vendor-foreground/10 text-xs"
                        >
                          View Profile
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

        {/* Invitations */}
        {activeTab === "invitations" &&
          (isLoadingPartnerships ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-vendor-muted">Loading invitations...</div>
            </div>
          ) : searchedPendingPartnerships.length === 0 ? (
            <div className="bg-vendor-surface rounded-xl border border-vendor-border p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-vendor-foreground/10 flex items-center justify-center mx-auto mb-4">
                <Mail className="w-8 h-8 text-vendor-foreground" />
              </div>
              <h3 className="font-display font-bold text-xl text-vendor-foreground mb-2">No Invitations Yet</h3>
              <p className="text-vendor-muted max-w-md mx-auto">
                {searchQuery
                  ? "No invitations match your search."
                  : "When lead agencies invite you to join their partner network, those invitations will appear here. Make sure your profile is complete to increase your chances of being discovered."}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {searchedPendingPartnerships.map((partnership) => (
                <div key={partnership.id} className="rounded-xl p-6 bg-vendor-foreground border border-accent/40">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-xl bg-accent/30 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-7 h-7 text-accent" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">{getStatusBadge(partnership.status, "dark")}</div>
                        <h3 className="font-display font-bold text-2xl text-foreground">
                          {partnership.agency?.company_name || partnership.agency?.full_name || "Unknown Agency"}
                        </h3>
                        <p className="text-base text-foreground-secondary flex items-center gap-2 mt-2">
                          <Mail className="w-4 h-4 text-accent" />
                          <span className="font-medium">{partnership.agency?.email || "Email not available"}</span>
                        </p>
                      </div>
                    </div>

                    <div className="bg-surface rounded-lg p-4 border border-border">
                      <p className="text-foreground-secondary text-sm leading-relaxed">
                        <strong className="text-accent">
                          {partnership.agency?.company_name || partnership.agency?.full_name || "This agency"}
                        </strong>{" "}
                        has invited you to join their partner network on Ligament. By accepting, you&apos;ll be able to
                        receive project briefs and collaborate with them directly.
                      </p>
                    </div>

                    {partnership.invitation_message && (
                      <div className="p-4 rounded-lg bg-surface border-l-4 border-accent">
                        <div className="flex items-center gap-2 mb-2">
                          <MessageSquare className="w-4 h-4 text-accent" />
                          <span className="font-mono text-xs text-accent uppercase tracking-wider font-semibold">
                            Personal Message from Agency
                          </span>
                        </div>
                        <p className="text-foreground-secondary text-sm leading-relaxed">{partnership.invitation_message}</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-4 border-t border-border">
                      <div className="flex items-center gap-2 text-foreground-muted text-sm">
                        <Calendar className="w-4 h-4 text-accent" />
                        <span>
                          Received{" "}
                          {new Date(partnership.created_at).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleDecline(partnership.id)}
                          disabled={updating === partnership.id}
                          className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500"
                        >
                          <X className="w-4 h-4 mr-2" />
                          Decline
                        </Button>
                        <Button
                          type="button"
                          onClick={() => handleAccept(partnership.id)}
                          disabled={updating === partnership.id}
                          className="bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
                        >
                          <Check className="w-4 h-4 mr-2" />
                          Accept Partnership
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {/* Discover */}
        {activeTab === "discover" && (
          <div className="space-y-6">
            {/* My Network / All Agencies toggle */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setViewMode("all")}
                className={cn(
                  "font-mono text-[10px] px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5",
                  viewMode === "all" ? "border-vendor-foreground bg-vendor-foreground/10 text-vendor-foreground" : "border-vendor-border text-vendor-muted-strong hover:border-vendor-border"
                )}
              >
                <Globe className="w-3 h-3" />
                All Agencies
              </button>
              <button
                type="button"
                onClick={() => setViewMode("network")}
                className={cn(
                  "font-mono text-[10px] px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5",
                  viewMode === "network" ? "border-vendor-foreground bg-vendor-foreground/10 text-vendor-foreground" : "border-vendor-border text-vendor-muted-strong hover:border-vendor-border"
                )}
              >
                <Users className="w-3 h-3" />
                My Network
              </button>
            </div>

            {/* Filters */}
            <div className="bg-vendor-surface rounded-xl border border-vendor-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-vendor-muted mr-2">Discipline:</span>
                {dynamicDisciplineFilters.map((discipline) => (
                  <button
                    key={discipline}
                    type="button"
                    onClick={() => setSelectedDiscipline(discipline)}
                    className={cn(
                      "font-mono text-[10px] px-2 py-1 rounded border transition-colors",
                      selectedDiscipline === discipline
                        ? "border-vendor-foreground bg-vendor-foreground/10 text-vendor-foreground"
                        : "border-vendor-border text-vendor-muted-strong hover:border-vendor-border"
                    )}
                  >
                    {discipline}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-vendor-border">
                <span className="font-mono text-[10px] text-vendor-muted mr-2">Designations:</span>
                {DESIGNATION_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleDesignationFilter(key)}
                    className={cn(
                      "font-mono text-[10px] px-2 py-1 rounded border transition-colors",
                      selectedDesignationFilters.includes(key)
                        ? "border-vendor-foreground bg-vendor-foreground/10 text-vendor-foreground"
                        : "border-vendor-border text-vendor-muted-strong hover:border-vendor-border"
                    )}
                  >
                    {DESIGNATION_LABELS[key]}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-vendor-border">
                <span className="font-mono text-[10px] text-vendor-muted mr-2">Insurance:</span>
                {INSURANCE_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleInsuranceFilter(key)}
                    className={cn(
                      "font-mono text-[10px] px-2 py-1 rounded border transition-colors",
                      selectedInsuranceFilters.includes(key)
                        ? "border-vendor-foreground bg-vendor-foreground/10 text-vendor-foreground"
                        : "border-vendor-border text-vendor-muted-strong hover:border-vendor-border"
                    )}
                  >
                    {INSURANCE_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>

            {/* Agency Directory */}
            {isLoadingAgencies ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-vendor-muted">Loading agencies...</div>
              </div>
            ) : filteredAgencies.length === 0 ? (
              <div className="bg-vendor-surface rounded-xl border border-vendor-border p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-vendor-foreground/10 flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-vendor-foreground" />
                </div>
                <h3 className="font-display font-bold text-xl text-vendor-foreground mb-2">No Agencies Found</h3>
                <p className="text-vendor-muted max-w-md mx-auto">
                  {searchQuery
                    ? "No agencies match your search. Try different keywords."
                    : viewMode === "network"
                      ? "You do not have any agencies in your network yet. Switch to All Agencies to discover and connect with new ones."
                      : "No lead agencies are currently accepting partner requests."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredAgencies.map((agency) => {
                  const request = getRequestStatus(agency.id)
                  return (
                    <div key={agency.id} className="bg-vendor-surface rounded-xl border border-vendor-border p-6 hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 rounded-xl bg-vendor-foreground/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {agency.company_logo_url ? (
                            <img src={agency.company_logo_url} alt={agency.company_name || "Agency"} className="w-full h-full object-cover rounded-xl" />
                          ) : (
                            <Building2 className="w-7 h-7 text-vendor-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-display font-bold text-lg text-vendor-foreground">
                            <span className="flex items-center gap-2 flex-wrap">
                              {agency.company_name || agency.full_name || agency.email || "Agency"}
                              {(agency.vouch_count ?? 0) >= 3 && (
                                <span className="flex items-center gap-0.5 font-mono text-[9px] px-1.5 py-0.5 rounded-full border border-yellow-500/40 bg-yellow-500/15 text-yellow-300 uppercase tracking-wider shrink-0">
                                  <Zap className="w-2.5 h-2.5" />
                                  <Zap className="w-2.5 h-2.5" />
                                  <Zap className="w-2.5 h-2.5" />
                                </span>
                              )}
                            </span>
                          </h3>

                          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-vendor-muted">
                            {agency.agency_type && <span className="flex items-center gap-1">{agency.agency_type}</span>}
                            {agency.location && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {agency.location}
                              </span>
                            )}
                            {agency.website ? (
                              <span className="flex items-center gap-1">
                                <Globe className="w-3 h-3" />
                                {agency.website}
                              </span>
                            ) : null}
                            {agency.partner_count && (
                              <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                {agency.partner_count} partners
                              </span>
                            )}
                          </div>

                          {agency.bio && <p className="text-sm text-vendor-muted-strong mt-2 line-clamp-2">{agency.bio}</p>}

                          <div className="mt-4">
                            {agency.collaborated ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => openAgencyProfile(agency)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vendor-foreground/10 text-vendor-foreground text-xs font-medium hover:bg-vendor-foreground/20"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  Worked Together
                                </button>
                                <Button
                                  type="button"
                                  onClick={() => openAgencyProfile(agency)}
                                  variant="outline"
                                  className="h-8 px-3 border-vendor-foreground text-vendor-foreground hover:bg-vendor-foreground/10 text-xs"
                                >
                                  View Profile
                                </Button>
                              </div>
                            ) : request?.status === "approved" ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-success/15 text-success text-xs font-medium">
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  In Network
                                </span>
                                <Button
                                  type="button"
                                  onClick={() => openAgencyProfile(agency)}
                                  variant="outline"
                                  className="h-8 px-3 border-vendor-foreground text-vendor-foreground hover:bg-vendor-foreground/10 text-xs"
                                >
                                  View Profile
                                </Button>
                              </div>
                            ) : request?.status === "pending" ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 text-xs font-medium">
                                <Clock className="w-3.5 h-3.5" />
                                Request Pending
                              </span>
                            ) : request?.status === "declined" ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs font-medium">
                                Request Declined
                              </span>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  type="button"
                                  onClick={() => openAgencyProfile(agency)}
                                  variant="outline"
                                  className="h-8 px-3 border-vendor-foreground text-vendor-foreground hover:bg-vendor-foreground/10 text-xs"
                                >
                                  View Profile
                                </Button>
                                <Button
                                  onClick={() => {
                                    setSelectedAgency(agency)
                                    setShowRequestModal(true)
                                  }}
                                  variant="outline"
                                  className="border-vendor-foreground text-vendor-foreground hover:bg-vendor-foreground/10"
                                >
                                  <Send className="w-4 h-4 mr-1.5" />
                                  Request Access
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Request Access Modal */}
        {showRequestModal && selectedAgency && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowRequestModal(false)}
          >
            <div className="w-full max-w-md bg-vendor-surface rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-vendor-foreground/10 flex items-center justify-center">
                    <Send className="w-5 h-5 text-vendor-foreground" />
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-xl text-vendor-foreground">Request Access</h2>
                    <p className="font-mono text-xs text-vendor-muted">{selectedAgency.company_name || selectedAgency.full_name}</p>
                  </div>
                </div>
                <button onClick={() => setShowRequestModal(false)} className="text-vendor-foreground hover:text-vendor-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="font-mono text-[10px] text-vendor-muted uppercase tracking-wider block mb-2">Message (Optional)</label>
                  <Textarea
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    placeholder="Introduce yourself and explain why you'd like to join their network..."
                    rows={4}
                    className="bg-vendor-background border-vendor-border text-vendor-foreground placeholder:text-vendor-muted/70 resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setShowRequestModal(false)} className="flex-1 border-vendor-border text-vendor-muted-strong hover:bg-vendor-background">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRequestAccess}
                    disabled={requestingAgency === selectedAgency.id}
                    className="flex-1 bg-vendor-foreground text-white hover:bg-vendor-foreground/90"
                  >
                    {requestingAgency === selectedAgency.id ? "Sending..." : "Send Request"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Agency Profile Modal */}
        {showAgencyProfileModal && selectedAgency && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowAgencyProfileModal(false)}
          >
            <div className="w-full max-w-2xl bg-vendor-surface rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-vendor-foreground/10 flex items-center justify-center overflow-hidden">
                    {selectedAgency.company_logo_url ? (
                      <img src={selectedAgency.company_logo_url} alt={selectedAgency.company_name || "Agency"} className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="w-5 h-5 text-vendor-foreground" />
                    )}
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-xl text-vendor-foreground">
                      {selectedAgency.company_name || selectedAgency.full_name || selectedAgency.email || "Agency"}
                    </h2>
                    {selectedAgency.agency_type && <p className="font-mono text-xs text-vendor-muted mt-0.5">{selectedAgency.agency_type}</p>}
                    {selectedAgency.location && <p className="font-mono text-xs text-vendor-muted">{selectedAgency.location}</p>}
                  </div>
                </div>
                <button onClick={() => setShowAgencyProfileModal(false)} className="text-vendor-foreground hover:text-vendor-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {selectedAgency.bio && <p className="text-sm text-vendor-foreground">{selectedAgency.bio}</p>}

                {(selectedAgency.website || selectedAgency.company_website || selectedAgency.company_linkedin_url || selectedAgency.reel_url) && (
                  <div className="flex flex-wrap gap-3 text-sm">
                    {(selectedAgency.website || selectedAgency.company_website) && (
                      <a
                        href={(() => {
                          const w = selectedAgency.website || selectedAgency.company_website || ""
                          return w.startsWith("http") ? w : "https://" + w
                        })()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-blue-600 hover:underline"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        Company Website
                      </a>
                    )}
                    {selectedAgency.company_linkedin_url && (
                      <a href={selectedAgency.company_linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        LinkedIn Profile
                      </a>
                    )}
                    {selectedAgency.reel_url && (
                      <a href={selectedAgency.reel_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        View Reel
                      </a>
                    )}
                  </div>
                )}

                {(() => {
                  const caps = extractCapabilityValues(selectedAgency.capabilities)
                  if (caps.length === 0) return null
                  return (
                    <div>
                      <div className="font-mono text-[10px] text-vendor-muted uppercase tracking-wider mb-2">Capabilities</div>
                      <div className="flex flex-wrap gap-1">
                        {caps.map((cap, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-gray-100 text-vendor-foreground text-xs">
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {agencyProfileProjects.length > 0 && !isLoadingAgencyProfile && (
                  <div>
                    <div className="font-mono text-[10px] text-vendor-muted uppercase tracking-wider mb-2">Shared Projects</div>
                    <div className="space-y-2">
                      {agencyProfileProjects.map((p) => (
                        <div key={p.id} className="rounded-lg border border-vendor-border p-3 text-sm">
                          <div className="text-vendor-foreground font-medium">{p.title}</div>
                          <div className="text-vendor-muted text-xs mt-0.5">{p.clientName}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-vendor-border p-4">
                  <div className="font-mono text-[10px] text-vendor-muted uppercase tracking-wider mb-2">Contact</div>
                  <div className="text-sm text-vendor-foreground font-medium">
                    {selectedAgency.full_name || selectedAgency.company_name || "Not provided"}
                  </div>
                  {selectedAgency.email ? (
                    <div className="text-sm text-vendor-muted-strong mt-1">{selectedAgency.email}</div>
                  ) : (
                    <button
                      onClick={() => {
                        setShowAgencyProfileModal(false)
                        setSelectedAgency(selectedAgency)
                        setShowRequestModal(true)
                      }}
                      className="text-sm text-blue-600 hover:underline mt-1 text-left"
                    >
                      Request collaboration access to view contact info →
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </PartnerLayout>
  )
}
