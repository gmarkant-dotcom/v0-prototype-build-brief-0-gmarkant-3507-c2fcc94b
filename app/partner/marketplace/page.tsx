"use client"

import { useEffect, useMemo, useState } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { Building2, Globe, Search, Send, X, Zap } from "lucide-react"

type AgencyProfile = {
  id: string
  role?: "agency" | "partner"
  company_name: string | null
  full_name: string | null
  bio: string | null
  location: string | null
  email?: string | null
  website?: string | null
  company_website?: string | null
  company_linkedin_url?: string | null
  reel_url?: string | null
  capabilities?: unknown
  avatar_url?: string | null
  company_logo_url?: string | null
  agency_type?: string | null
  vouch_count?: number
}

type AccessRequest = {
  agency_id: string
  status: "pending" | "approved" | "declined"
}

const demoAgencies: AgencyProfile[] = [
  {
    id: "demo-agency-1",
    company_name: "Electric Animal",
    full_name: "Electric Animal",
    bio: "Sports and entertainment-led campaign strategy and production.",
    location: "Los Angeles, CA",
  },
  {
    id: "demo-agency-2",
    company_name: "Momentum",
    full_name: "Momentum",
    bio: "Global brand experience and partnership activation agency.",
    location: "New York, NY",
  },
]

export default function PartnerMarketplacePage() {
  const isDemo = isDemoMode()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [agencies, setAgencies] = useState<AgencyProfile[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [selectedAgency, setSelectedAgency] = useState<AgencyProfile | null>(null)

  useEffect(() => {
    const load = async () => {
      if (isDemo) {
        setAgencies(demoAgencies)
        setRequests([{ agency_id: "demo-agency-2", status: "pending" }])
        setLoading(false)
        return
      }
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setLoading(false)
          return
        }

        const [discoverableRes, myReqRes] = await Promise.all([
          fetch("/api/marketplace/discoverable?role=agency", { cache: "no-store" }),
          supabase.from("partner_access_requests").select("agency_id, status").eq("partner_id", user.id),
        ])

        const discoverablePayload = await discoverableRes.json().catch(() => ({}))
        if (!discoverableRes.ok) throw new Error(discoverablePayload?.error || "Failed to load discoverable agencies")

        setAgencies(discoverablePayload?.profiles || [])
        setRequests((myReqRes.data || []) as AccessRequest[])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [isDemo])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return agencies
    return agencies.filter((a) => {
      const name = (a.company_name || a.full_name || "").toLowerCase()
      const location = (a.location || "").toLowerCase()
      const bio = (a.bio || "").toLowerCase()
      return name.includes(q) || location.includes(q) || bio.includes(q)
    })
  }, [agencies, search])

  const requestStatus = (agencyId: string) => requests.find((r) => r.agency_id === agencyId)?.status

  const requestConnection = async (agencyId: string) => {
    if (isDemo) {
      setRequests((prev) => [...prev, { agency_id: agencyId, status: "pending" }])
      return
    }
    setSubmittingId(agencyId)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const status = requestStatus(agencyId)
      if (status) return
      const { error } = await supabase.from("partner_access_requests").insert({
        partner_id: user.id,
        agency_id: agencyId,
        status: "pending",
      })
      if (error) return
      setRequests((prev) => [...prev, { agency_id: agencyId, status: "pending" }])
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <PartnerLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-[#0C3535]">Marketplace</h1>
          <p className="text-gray-600 mt-1">Browse discoverable lead agencies and request connections.</p>
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agencies..."
            className="pl-10 bg-white border-gray-200 text-gray-900"
          />
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">Loading marketplace...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <div className="font-display font-bold text-lg text-gray-900">No discoverable agencies right now</div>
            <p className="text-sm text-gray-500 mt-2">
              Agencies can opt in to Marketplace visibility from their account settings.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((agency) => {
              const status = requestStatus(agency.id)
              return (
                <div key={agency.id} className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-lg bg-[#0C3535]/10 flex items-center justify-center">
                      {agency.company_logo_url ? (
                        <img src={agency.company_logo_url} alt={agency.company_name || "Agency"} className="w-full h-full object-cover rounded-xl" />
                      ) : (
                        <Building2 className="w-6 h-6 text-[#0C3535]" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h2 className="font-display font-bold text-lg text-gray-900">
                        {agency.company_name || agency.full_name || "Lead Agency"}
                      </h2>
                      {agency.agency_type && (
                        <p className="font-mono text-xs text-gray-600 mt-1">{agency.agency_type}</p>
                      )}
                      {agency.location && <p className="font-mono text-xs text-gray-500 mt-1">{agency.location}</p>}
                      <p className="font-mono text-xs text-gray-500 mt-1">{agency.website || "—"}</p>
                      <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                        {agency.bio || "Discoverable lead agency on Ligament Marketplace."}
                      </p>
                      <div className="mt-4 flex items-center gap-2 flex-wrap">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedAgency(agency)}
                          className="border-gray-200 text-gray-700 hover:bg-gray-50 text-xs"
                        >
                          View Profile
                        </Button>
                        {status === "approved" ? (
                          <span className="inline-flex text-xs px-3 py-1.5 rounded-lg bg-green-100 text-green-700">Connected</span>
                        ) : status === "pending" ? (
                          <span className="inline-flex text-xs px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700">Request Pending</span>
                        ) : (
                          <Button
                            onClick={() => requestConnection(agency.id)}
                            className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white"
                            disabled={submittingId === agency.id}
                          >
                            <Send className="w-4 h-4 mr-2" />
                            {submittingId === agency.id ? "Sending..." : "Request Connection"}
                          </Button>
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
      {/* Agency Profile Modal */}
      {selectedAgency && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedAgency(null)}>
          <div className="w-full max-w-2xl bg-white rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#0C3535]/10 flex items-center justify-center overflow-hidden shrink-0">
                  {selectedAgency.company_logo_url ? (
                    <img src={selectedAgency.company_logo_url} alt={selectedAgency.company_name || "Agency"} className="w-full h-full object-cover" />
                  ) : (
                    <Building2 className="w-5 h-5 text-[#0C3535]" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-display font-bold text-xl text-gray-900">
                      {selectedAgency.company_name || selectedAgency.full_name || "Agency"}
                    </h2>
                    {(selectedAgency.vouch_count ?? 0) >= 3 && (
                      <span className="flex items-center gap-0.5 font-mono text-[9px] px-1.5 py-0.5 rounded-full border border-yellow-500/40 bg-yellow-500/15 text-yellow-300 uppercase tracking-wider shrink-0">
                        <Zap className="w-2.5 h-2.5" /><Zap className="w-2.5 h-2.5" /><Zap className="w-2.5 h-2.5" />
                        Triple-Vouched
                      </span>
                    )}
                  </div>
                  {selectedAgency.agency_type && (
                    <p className="font-mono text-xs text-gray-500 mt-0.5">{selectedAgency.agency_type}</p>
                  )}
                  {selectedAgency.location && (
                    <p className="font-mono text-xs text-gray-500">{selectedAgency.location}</p>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedAgency(null)} className="text-gray-700 hover:text-gray-900 shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {selectedAgency.bio && (
                <p className="text-sm text-gray-700">{selectedAgency.bio}</p>
              )}

              <div className="flex flex-wrap gap-3 text-sm">
                {(selectedAgency.website || selectedAgency.company_website) && (
                  <a
                    href={(() => { const w = selectedAgency.website || selectedAgency.company_website || ""; return w.startsWith("http") ? w : "https://" + w })()}
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
                {selectedAgency.email ? (
                  <div className="text-sm text-gray-600 mt-1">{selectedAgency.email}</div>
                ) : (
                  <button
                    onClick={() => {
                      requestConnection(selectedAgency.id)
                      setSelectedAgency(null)
                    }}
                    className="text-sm text-blue-600 hover:underline mt-1 text-left"
                  >
                    Request collaboration access to view contact info &rarr;
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}
