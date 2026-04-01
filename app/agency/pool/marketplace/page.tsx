"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { StageHeader } from "@/components/stage-header"
import { GlassCard } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isDemoMode } from "@/lib/demo-data"
import { ArrowLeft, ExternalLink, Search, UserPlus } from "lucide-react"

type PartnerProfile = {
  id: string
  company_name: string | null
  full_name: string | null
  bio: string | null
  location: string | null
  email: string | null
  website?: string | null
  agency_type?: string | null
}

const demoPartners: PartnerProfile[] = [
  {
    id: "demo-partner-1",
    company_name: "Sample Production Studio",
    full_name: "Sample Production Studio",
    bio: "Sports and documentary storytelling with nimble production teams.",
    location: "Los Angeles, CA",
    email: "contact@demo.withligament.com",
    website: "demo.withligament.com",
    agency_type: "Production",
  },
  {
    id: "demo-partner-2",
    company_name: "Tandem Social",
    full_name: "Tandem Social",
    bio: "Social-first creative and creator-led campaign production.",
    location: "Austin, TX",
    email: "contact@tandemsocial.com",
    website: "tandemsocial.com",
    agency_type: "Social",
  },
]

const externalHubs = [
  { name: "Upwork", description: "Broad freelance marketplace across disciplines.", url: "https://www.upwork.com" },
  { name: "Fiverr", description: "Fast-turn service marketplace for creative and production tasks.", url: "https://www.fiverr.com" },
  { name: "Toptal", description: "Curated network of high-end freelance talent.", url: "https://www.toptal.com" },
  { name: "Contra", description: "Commission-free independent talent marketplace.", url: "https://www.contra.com" },
  { name: "Clutch", description: "Agency and studio discovery with verified reviews.", url: "https://clutch.co" },
  { name: "99designs", description: "Design-focused marketplace for brand and visual work.", url: "https://99designs.com" },
]

export default function AgencyMarketplacePage() {
  const isDemo = isDemoMode()
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [partners, setPartners] = useState<PartnerProfile[]>([])
  const [inviteEmail, setInviteEmail] = useState<string | null>(null)
  const [inviteMessage, setInviteMessage] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      if (isDemo) {
        setPartners(demoPartners)
        setLoading(false)
        return
      }
      try {
        const res = await fetch("/api/marketplace/discoverable?role=partner", { cache: "no-store" })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload?.error || "Failed to load discoverable partners")
        setPartners(payload?.profiles || [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [isDemo])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return partners
    return partners.filter((p) => {
      const name = (p.company_name || p.full_name || "").toLowerCase()
      const location = (p.location || "").toLowerCase()
      const bio = (p.bio || "").toLowerCase()
      return name.includes(q) || location.includes(q) || bio.includes(q)
    })
  }, [partners, search])

  const inviteToPool = async () => {
    if (!inviteEmail) return
    setSubmitting(true)
    setBanner(null)
    if (isDemo) {
      setBanner("Demo mode - invitation simulated.")
      setInviteEmail(null)
      setInviteMessage("")
      setSubmitting(false)
      return
    }
    try {
      const res = await fetch("/api/partnerships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerEmail: inviteEmail, message: inviteMessage || null }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || "Failed to invite partner")
      setBanner("Invitation sent successfully.")
      setInviteEmail(null)
      setInviteMessage("")
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "Failed to invite partner.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AgencyLayout>
      <div className="p-8 max-w-6xl space-y-8">
        <Link href="/agency/pool" className="inline-flex items-center gap-2 font-mono text-sm text-foreground-muted hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
          Back to Partner Pool
        </Link>

        <StageHeader
          stageNumber="◍"
          title="Marketplace"
          subtitle="Discover opt-in partner agencies and trusted external resource hubs."
        />

        <div className="space-y-4">
          <h2 className="font-display font-bold text-xl text-foreground">Discover Partner Agencies</h2>
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-foreground-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search partner agencies..."
              className="pl-10 bg-white/5 border-border text-foreground"
            />
          </div>

          {loading ? (
            <GlassCard className="p-8 text-center text-foreground-muted">Loading discoverable partners...</GlassCard>
          ) : filtered.length === 0 ? (
            <GlassCard className="p-10 text-center">
              <div className="font-display font-bold text-lg text-foreground">No discoverable partners yet</div>
              <p className="text-sm text-foreground-muted mt-2">
                Partner agencies can opt in from their profile to appear in Marketplace discovery.
              </p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((partner) => (
                <GlassCard key={partner.id} className="p-5">
                  <div className="font-display font-bold text-lg text-foreground">
                    {partner.company_name || partner.full_name || "Partner Agency"}
                  </div>
                  <p className="text-sm text-foreground-muted mt-1 line-clamp-2">
                    {partner.bio || "Discoverable partner agency on Ligament Marketplace."}
                  </p>
                  <div className="mt-3 space-y-1">
                    <p className="font-mono text-xs text-foreground-muted">{partner.location || "—"}</p>
                    <p className="font-mono text-xs text-foreground-muted">{partner.website || "—"}</p>
                    <p className="font-mono text-xs text-foreground-muted">{partner.agency_type || "—"}</p>
                  </div>
                  <Button
                    className="mt-4 bg-accent text-accent-foreground hover:bg-accent/90"
                    onClick={() => setInviteEmail(partner.email || null)}
                    disabled={!partner.email}
                  >
                    <UserPlus className="w-4 h-4 mr-2" />
                    Invite to Pool
                  </Button>
                </GlassCard>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="font-display font-bold text-xl text-foreground">External Resource Hubs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {externalHubs.map((hub) => (
              <GlassCard key={hub.name} className="p-5">
                <div className="font-display font-bold text-lg text-foreground">{hub.name}</div>
                <p className="text-sm text-foreground-muted mt-2">{hub.description}</p>
                <a href={hub.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center mt-4 text-accent hover:underline text-sm">
                  Visit
                  <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                </a>
              </GlassCard>
            ))}
          </div>
        </div>
      </div>

      {inviteEmail && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setInviteEmail(null)}>
          <GlassCard className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="font-display font-bold text-xl text-foreground">Invite Partner to Pool</div>
            <p className="font-mono text-xs text-foreground-muted mt-1">{inviteEmail}</p>
            <Input
              value={inviteMessage}
              onChange={(e) => setInviteMessage(e.target.value)}
              placeholder="Optional message"
              className="mt-4 bg-white/5 border-border text-foreground"
            />
            {banner && <p className="text-xs text-foreground-muted mt-3">{banner}</p>}
            <div className="flex gap-3 mt-5">
              <Button variant="outline" className="flex-1 border-border" onClick={() => setInviteEmail(null)}>
                Cancel
              </Button>
              <Button className="flex-1 bg-accent text-accent-foreground" onClick={inviteToPool} disabled={submitting}>
                {submitting ? "Sending..." : "Send Invite"}
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </AgencyLayout>
  )
}
