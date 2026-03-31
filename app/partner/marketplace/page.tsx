"use client"

import { useEffect, useMemo, useState } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { GlassCard } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { Building2, Search, Send } from "lucide-react"

type AgencyProfile = {
  id: string
  role?: "agency" | "partner"
  company_name: string | null
  full_name: string | null
  bio: string | null
  location: string | null
  website?: string | null
  avatar_url?: string | null
  agency_type?: string | null
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
          <GlassCard className="p-8 text-center text-gray-500">Loading marketplace...</GlassCard>
        ) : filtered.length === 0 ? (
          <GlassCard className="p-10 text-center">
            <div className="font-display font-bold text-lg text-gray-900">No discoverable agencies right now</div>
            <p className="text-sm text-gray-500 mt-2">
              Agencies can opt in to Marketplace visibility from their account settings.
            </p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((agency) => {
              const status = requestStatus(agency.id)
              return (
                <GlassCard key={agency.id} className="p-6">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-lg bg-[#0C3535]/10 flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-[#0C3535]" />
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
                      <div className="mt-4">
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
                </GlassCard>
              )
            })}
          </div>
        )}
      </div>
    </PartnerLayout>
  )
}
