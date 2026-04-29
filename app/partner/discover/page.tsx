"use client"

import { useState, useEffect, useMemo } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { GlassCard } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { Building2, Search, Send, CheckCircle, Clock, MapPin, Globe, Users, X } from "lucide-react"

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
  role?: "agency" | "partner"
  collaborated?: boolean
  relationshipStatus?: string
  invitedAt?: string
  acceptedAt?: string
  invitationMessage?: string
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

// Demo agencies for demonstration
const demoAgencies: Agency[] = [
  {
    id: "demo-agency-1",
    company_name: "Electric Animal",
    full_name: "Electric Animal Agency",
    location: "Los Angeles, CA",
    website: "electricanimal.com",
    agency_type: "Sports Marketing",
    bio: "Award-winning creative agency specializing in sports and entertainment marketing.",
    partner_count: 24
  },
  {
    id: "demo-agency-2",
    company_name: "Momentum Worldwide",
    full_name: "Momentum Agency",
    location: "New York, NY",
    website: "momentumww.com",
    agency_type: "Experiential",
    bio: "Global experiential marketing agency creating memorable brand experiences.",
    partner_count: 56
  },
  {
    id: "demo-agency-3",
    company_name: "Wasserman",
    full_name: "Wasserman",
    location: "Los Angeles, CA",
    website: "teamwass.com",
    agency_type: "Integrated Agency",
    bio: "Sports, entertainment, and lifestyle marketing powerhouse.",
    partner_count: 42
  }
]

export default function DiscoverAgenciesPage() {
  const isDemo = isDemoMode()
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [myRequests, setMyRequests] = useState<AccessRequest[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [requestingAgency, setRequestingAgency] = useState<string | null>(null)
  const [requestMessage, setRequestMessage] = useState("")
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null)
  const [showAgencyProfileModal, setShowAgencyProfileModal] = useState(false)
  const [agencyProfileProjects, setAgencyProfileProjects] = useState<SharedProject[]>([])
  const [isLoadingAgencyProfile, setIsLoadingAgencyProfile] = useState(false)

  useEffect(() => {
    loadAgencies()
    loadMyRequests()
  }, [])

  const loadAgencies = async () => {
    if (isDemo) {
      setAgencies(demoAgencies)
      setIsLoading(false)
      return
    }

    try {
      const res = await fetch("/api/marketplace/discoverable?role=agency", { cache: "no-store" })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || "Failed to load discoverable agencies")
      const rows = (payload?.profiles || []) as Agency[]
      setAgencies(rows.map((row) => ({ ...row, collaborated: false })))
    } catch (error) {
      console.error("Error:", error)
    }
    setIsLoading(false)
  }

  const loadMyRequests = async () => {
    if (isDemo) {
      setMyRequests([{ id: "demo-req-1", agency_id: "demo-agency-2", status: "approved" }])
      return
    }

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) return

      const { data, error } = await supabase
        .from("partner_access_requests")
        .select("id, agency_id, status")
        .eq("partner_id", user.id)

      if (!error) {
        setMyRequests(data || [])
      }
    } catch (error) {
      console.error("Error:", error)
    }
  }

  const handleRequestAccess = async () => {
    if (!selectedAgency) return

    if (isDemo) {
      setMyRequests(prev => [...prev, { 
        id: `demo-req-${Date.now()}`, 
        agency_id: selectedAgency.id, 
        status: "pending" 
      }])
      setShowRequestModal(false)
      setSelectedAgency(null)
      setRequestMessage("")
      return
    }

    setRequestingAgency(selectedAgency.id)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) return

      const { error } = await supabase
        .from("partner_access_requests")
        .insert({
          partner_id: user.id,
          agency_id: selectedAgency.id,
          request_message: requestMessage || null,
          status: "pending"
        })

      if (!error) {
        await loadMyRequests()
        setShowRequestModal(false)
        setSelectedAgency(null)
        setRequestMessage("")
      }
    } catch (error) {
      console.error("Error requesting access:", error)
    }
    setRequestingAgency(null)
  }

  const getRequestStatus = (agencyId: string) => {
    return myRequests.find(req => req.agency_id === agencyId)
  }

  const openAgencyProfile = async (agency: Agency) => {
    setSelectedAgency(agency)
    setShowAgencyProfileModal(true)
    setIsLoadingAgencyProfile(true)

    if (isDemo) {
      setAgencyProfileProjects([
        { id: "demo-project-1", title: "NWSL Creator Content Series", status: "active", updated_at: "2026-03-01" },
      ])
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

  const filteredAgencies = useMemo(() => {
    return agencies.filter((agency) => {
      const query = searchQuery.toLowerCase()
      const displayName = agency.company_name || agency.full_name || agency.email || ""
      return (
        displayName.toLowerCase().includes(query) ||
        agency.email?.toLowerCase().includes(query) ||
        agency.location?.toLowerCase().includes(query)
      )
    })
  }, [agencies, searchQuery])

  const searchSuggestions = useMemo(() => filteredAgencies.slice(0, 8), [filteredAgencies])

  return (
    <PartnerLayout 
    >
      <div className="space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 120)}
            placeholder="Search agencies by name or location..."
            className="pl-10 bg-white border-gray-200 text-gray-900"
          />
          {isSearchFocused && searchSuggestions.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-72 overflow-auto">
              {searchSuggestions.map((agency) => {
                const name = agency.company_name || agency.full_name || agency.email || "Agency"
                return (
                  <button
                    key={agency.id}
                    type="button"
                    onMouseDown={() => {
                      setSearchQuery(name)
                      setIsSearchFocused(false)
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0 border-gray-100"
                  >
                    <div className="text-sm text-gray-900 font-medium">{name}</div>
                    <div className="text-xs text-gray-500">
                      {agency.location || agency.email || "Collaborator"}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Agency Directory */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading agencies...</div>
          </div>
        ) : filteredAgencies.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[#0C3535]/10 flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-[#0C3535]" />
            </div>
            <h3 className="font-display font-bold text-xl text-gray-900 mb-2">
              No Agencies Found
            </h3>
            <p className="text-gray-500 max-w-md mx-auto">
              {searchQuery ? "No agencies match your search. Try different keywords." : "No lead agencies are currently accepting partner requests."}
            </p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredAgencies.map((agency) => {
              const request = getRequestStatus(agency.id)
              
              return (
                <GlassCard key={agency.id} className="p-6 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-xl bg-[#0C3535]/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {agency.company_logo_url ? (
                        <img src={agency.company_logo_url} alt={agency.company_name || "Agency"} className="w-full h-full object-cover rounded-xl" />
                      ) : (
                        <Building2 className="w-7 h-7 text-[#0C3535]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display font-bold text-lg text-gray-900">
                        {agency.company_name || agency.full_name || agency.email || "Agency"}
                      </h3>
                      
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">{agency.agency_type || "—"}</span>
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
                        ) : (
                          <span className="flex items-center gap-1">—</span>
                        )}
                        {agency.partner_count && (
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {agency.partner_count} partners
                          </span>
                        )}
                      </div>
                      
                      {agency.bio && (
                        <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                          {agency.bio}
                        </p>
                      )}
                      
                      <div className="mt-4">
                        {agency.collaborated ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => openAgencyProfile(agency)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0C3535]/10 text-[#0C3535] text-xs font-medium hover:bg-[#0C3535]/20"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Worked Together
                            </button>
                            <Button
                              type="button"
                              onClick={() => openAgencyProfile(agency)}
                              variant="outline"
                              className="h-8 px-3 border-[#0C3535] text-[#0C3535] hover:bg-[#0C3535]/10 text-xs"
                            >
                              View Profile
                            </Button>
                          </div>
                        ) : request?.status === "approved" ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-100 text-green-700 text-xs font-medium">
                            <CheckCircle className="w-3.5 h-3.5" />
                            In Network
                          </span>
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
                              className="h-8 px-3 border-[#0C3535] text-[#0C3535] hover:bg-[#0C3535]/10 text-xs"
                            >
                              View Profile
                            </Button>
                            <Button
                              onClick={() => {
                                setSelectedAgency(agency)
                                setShowRequestModal(true)
                              }}
                              variant="outline"
                              className="border-[#0C3535] text-[#0C3535] hover:bg-[#0C3535]/10"
                            >
                              <Send className="w-4 h-4 mr-1.5" />
                              Request Access
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </GlassCard>
              )
            })}
          </div>
        )}

        {/* Request Access Modal */}
        {showRequestModal && selectedAgency && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowRequestModal(false)}>
            <GlassCard className="w-full max-w-md bg-white" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#0C3535]/10 flex items-center justify-center">
                    <Send className="w-5 h-5 text-[#0C3535]" />
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-xl text-gray-900">Request Access</h2>
                    <p className="font-mono text-xs text-gray-500">
                      {selectedAgency.company_name || selectedAgency.full_name}
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowRequestModal(false)} className="text-gray-700 hover:text-gray-900">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="font-mono text-[10px] text-gray-500 uppercase tracking-wider block mb-2">
                    Message (Optional)
                  </label>
                  <Textarea
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    placeholder="Introduce yourself and explain why you'd like to join their network..."
                    rows={4}
                    className="bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 resize-none"
                  />
                </div>
                
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowRequestModal(false)}
                    className="flex-1 border-gray-200 text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRequestAccess}
                    disabled={requestingAgency === selectedAgency.id}
                    className="flex-1 bg-[#0C3535] text-white hover:bg-[#0C3535]/90"
                  >
                    {requestingAgency === selectedAgency.id ? "Sending..." : "Send Request"}
                  </Button>
                </div>
              </div>
            </GlassCard>
          </div>
        )}

        {/* Agency Profile Modal */}
        {showAgencyProfileModal && selectedAgency && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowAgencyProfileModal(false)}>
            <GlassCard className="w-full max-w-2xl bg-white" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#0C3535]/10 flex items-center justify-center overflow-hidden">
                    {selectedAgency.company_logo_url ? (
                      <img src={selectedAgency.company_logo_url} alt={selectedAgency.company_name || "Agency"} className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="w-5 h-5 text-[#0C3535]" />
                    )}
                  </div>
                  <div>
                    <h2 className="font-display font-bold text-xl text-gray-900">
                      {selectedAgency.company_name || selectedAgency.full_name || selectedAgency.email || "Agency"}
                    </h2>
                    <p className="font-mono text-xs text-gray-500">{selectedAgency.agency_type || "Agency"}</p>
                  </div>
                </div>
                <button onClick={() => setShowAgencyProfileModal(false)} className="text-gray-700 hover:text-gray-900">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-[#0C3535]/10 flex items-center justify-center flex-shrink-0">
                    {selectedAgency.company_logo_url ? (
                      <img src={selectedAgency.company_logo_url} alt={selectedAgency.company_name || "Agency"} className="w-full h-full object-cover" />
                    ) : (
                      <Building2 className="w-8 h-8 text-[#0C3535]" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">{selectedAgency.agency_type || "—"}</div>
                    <div className="text-sm text-gray-500">{selectedAgency.location || "—"}</div>
                  </div>
                </div>

                {selectedAgency.bio && (
                  <p className="text-sm text-gray-700">{selectedAgency.bio}</p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(selectedAgency.website || selectedAgency.company_website) && (
                    <a
                      href={(() => { const w = selectedAgency.website || selectedAgency.company_website || ""; return w.startsWith("http") ? w : "https://" + w })()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Company Website
                    </a>
                  )}
                  {selectedAgency.company_linkedin_url && (
                    <a href={selectedAgency.company_linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                      LinkedIn Profile
                    </a>
                  )}
                  {selectedAgency.reel_url && (
                    <a href={selectedAgency.reel_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                      View Reel
                    </a>
                  )}
                </div>

                {(() => {
                  const caps = selectedAgency.capabilities
                  if (!Array.isArray(caps) || caps.length === 0) return null
                  return (
                    <div>
                      <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Capabilities</div>
                      <div className="flex flex-wrap gap-1">
                        {(caps as string[]).map((cap: string, i: number) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">{cap}</span>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                <div className="rounded-lg border border-gray-200 p-4">
                  <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Contact</div>
                  <div className="text-sm text-gray-900 font-medium">{selectedAgency.full_name || selectedAgency.company_name || "Not provided"}</div>
                  <div className="text-sm text-gray-600 mt-1">{selectedAgency.email || "No contact email available"}</div>
                </div>
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    </PartnerLayout>
  )
}
