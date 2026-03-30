"use client"

import { useState, useEffect } from "react"
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
  email?: string
  location?: string
  website?: string
  bio?: string
  partner_count?: number
  role?: "agency" | "partner"
  collaborated?: boolean
}

interface AccessRequest {
  id: string
  agency_id: string
  status: "pending" | "approved" | "declined"
}

// Demo agencies for demonstration
const demoAgencies: Agency[] = [
  {
    id: "demo-agency-1",
    company_name: "Electric Animal",
    full_name: "Electric Animal Agency",
    location: "Los Angeles, CA",
    website: "electricanimal.com",
    bio: "Award-winning creative agency specializing in sports and entertainment marketing.",
    partner_count: 24
  },
  {
    id: "demo-agency-2",
    company_name: "Momentum Worldwide",
    full_name: "Momentum Agency",
    location: "New York, NY",
    website: "momentumww.com",
    bio: "Global experiential marketing agency creating memorable brand experiences.",
    partner_count: 56
  },
  {
    id: "demo-agency-3",
    company_name: "Wasserman",
    full_name: "Wasserman",
    location: "Los Angeles, CA",
    website: "teamwass.com",
    bio: "Sports, entertainment, and lifestyle marketing powerhouse.",
    partner_count: 42
  }
]

export default function DiscoverAgenciesPage() {
  const isDemo = isDemoMode()
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [myRequests, setMyRequests] = useState<AccessRequest[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [requestingAgency, setRequestingAgency] = useState<string | null>(null)
  const [requestMessage, setRequestMessage] = useState("")
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null)

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
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setIsLoading(false)
        return
      }

      // Resolve canonical profile ID for this logged-in account.
      // In some environments, relationship tables reference profile IDs that may not
      // match auth.uid(), so we fall back to email-based profile lookup.
      let currentProfileId = user.id
      const { data: selfProfile } = await supabase
        .from("profiles")
        .select("id, email")
        .eq("id", user.id)
        .maybeSingle()

      if (!selfProfile && user.email) {
        const { data: byEmailProfile } = await supabase
          .from("profiles")
          .select("id, email")
          .ilike("email", user.email.trim())
          .maybeSingle()
        if (byEmailProfile?.id) {
          currentProfileId = byEmailProfile.id
        }
      }

      // Tier 1: direct lead-agency relationships for this partner.
      // Use server API as source-of-truth because it already handles id/email claim logic.
      const partnershipResponse = await fetch("/api/partnerships")
      const partnershipPayload = partnershipResponse.ok ? await partnershipResponse.json() : { partnerships: [] }
      const activePartnerships = (partnershipPayload.partnerships || []).filter((p: any) => p.status === "active")
      const myPartnershipIds = [...new Set(activePartnerships.map((p: any) => p.id).filter(Boolean))]
      const leadAgencyIds = [...new Set(activePartnerships.map((p: any) => p.agency?.id || p.agency_id).filter(Boolean))]

      // Tier 2: project-level collaborators (other partner agencies on shared projects)
      let projectIds: string[] = []
      if (myPartnershipIds.length > 0) {
        const { data: myAssignments } = await supabase
          .from("project_assignments")
          .select("project_id")
          .in("partnership_id", myPartnershipIds)

        projectIds = [...new Set((myAssignments || []).map((a) => a.project_id))]
      }

      let otherPartnerIds: string[] = []
      if (projectIds.length > 0) {
        const { data: allAssignments } = await supabase
          .from("project_assignments")
          .select("partnership_id")
          .in("project_id", projectIds)

        const allPartnershipIds = [...new Set((allAssignments || []).map((a) => a.partnership_id))]
        const otherPartnershipIds = allPartnershipIds.filter((id) => !myPartnershipIds.includes(id))

        if (otherPartnershipIds.length > 0) {
          const { data: otherPartnerships } = await supabase
            .from("partnerships")
            .select("partner_id")
            .in("id", otherPartnershipIds)

          otherPartnerIds = [...new Set((otherPartnerships || []).map((p) => p.partner_id).filter((id) => id && id !== currentProfileId))]
        }
      }

      const collaboratorIds = [...new Set([...leadAgencyIds, ...otherPartnerIds])]

      // Primary requirement: show historic collaborators first (lead + partner agencies).
      if (collaboratorIds.length > 0) {
        const { data: collaborators, error: collaboratorsError } = await supabase
          .from("profiles")
          .select("id, role, company_name, full_name, email, location, website, bio")
          .in("id", collaboratorIds)

        if (collaboratorsError) {
          console.error("Error loading collaborator profiles:", collaboratorsError)
        } else {
          const mapped = (collaborators || []).map((p) => ({
            ...p,
            collaborated: true,
          }))
          setAgencies(mapped)
          setIsLoading(false)
          return
        }
      }

      // Fallback directory if no historical collaborators exist yet.
      const { data: fallbackDirectory, error: fallbackError } = await supabase
        .from("profiles")
        .select("id, role, company_name, full_name, email, location, website, bio")
        .in("role", ["agency", "partner"])
        .neq("id", currentProfileId)

      if (fallbackError) {
        console.error("Error loading fallback directory:", fallbackError)
      } else {
        setAgencies(fallbackDirectory || [])
      }
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

  const filteredAgencies = agencies.filter(agency => {
    const query = searchQuery.toLowerCase()
    const displayName = agency.company_name || agency.full_name || agency.email || ""
    return (
      displayName.toLowerCase().includes(query) ||
      agency.email?.toLowerCase().includes(query) ||
      agency.location?.toLowerCase().includes(query)
    )
  })

  return (
    <PartnerLayout 
      title="Discover Agencies" 
      subtitle="Historic collaborators from your lead and project-level relationships"
    >
      <div className="space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agencies by name or location..."
            className="pl-10 bg-white border-gray-200 text-gray-900"
          />
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
                    <div className="w-14 h-14 rounded-xl bg-[#0C3535]/10 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-7 h-7 text-[#0C3535]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display font-bold text-lg text-gray-900">
                        {agency.company_name || agency.full_name || agency.email || "Agency"}
                      </h3>
                      
                      <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500">
                        {agency.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {agency.location}
                          </span>
                        )}
                        {agency.website && (
                          <span className="flex items-center gap-1">
                            <Globe className="w-3 h-3" />
                            {agency.website}
                          </span>
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
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0C3535]/10 text-[#0C3535] text-xs font-medium">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Worked Together
                          </span>
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
                <button onClick={() => setShowRequestModal(false)} className="text-gray-400 hover:text-gray-600">
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
      </div>
    </PartnerLayout>
  )
}
