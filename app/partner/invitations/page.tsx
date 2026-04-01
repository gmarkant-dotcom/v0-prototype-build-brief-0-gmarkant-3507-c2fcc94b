"use client"

import { useState, useEffect } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { GlassCard } from "@/components/glass-card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { Building2, Check, X, Clock, Mail, Calendar, MessageSquare, Users, ChevronRight } from "lucide-react"

// Partnership invitation (using new partnerships table)
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
  }
}

// Demo data for demonstration
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
      email: "contact@electricanimal.com"
    }
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
      email: "contact@momentum.com"
    }
  }
]

export default function PartnerInvitationsPage() {
  const isDemo = isDemoMode()
  const [partnerships, setPartnerships] = useState<Partnership[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    loadPartnerships()
  }, [])

  const loadPartnerships = async () => {
    if (isDemo) {
      setPartnerships(demoPartnerships)
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/partnerships')
      if (response.ok) {
        const data = await response.json()
        setPartnerships(data.partnerships || [])
      }
    } catch (error) {
      console.error("Error loading partnerships:", error)
    }
    setIsLoading(false)
  }

  const handleAccept = async (partnershipId: string) => {
    if (isDemo) {
      setPartnerships(prev => prev.map(p => 
        p.id === partnershipId 
          ? { ...p, status: "active" as const, accepted_at: new Date().toISOString() }
          : p
      ))
      return
    }

    setUpdating(partnershipId)
    try {
      const response = await fetch('/api/partnerships', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnershipId,
          status: 'active',
        }),
      })

      const data = await response.json()
      
      if (response.ok) {
        await loadPartnerships()
      } else {
        alert(data.error || 'Failed to accept partnership')
      }
    } catch (error) {
      console.error("Error accepting partnership:", error)
    }
    setUpdating(null)
  }

  const handleDecline = async (partnershipId: string) => {
    if (isDemo) {
      setPartnerships(prev => prev.filter(p => p.id !== partnershipId))
      return
    }

    setUpdating(partnershipId)
    try {
      const response = await fetch('/api/partnerships', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnershipId,
          status: 'terminated',
        }),
      })

      const data = await response.json()
      
      if (response.ok) {
        await loadPartnerships()
      } else {
        alert(data.error || 'Failed to decline partnership')
      }
    } catch (error) {
      console.error("Error declining partnership:", error)
    }
    setUpdating(null)
  }

  const pendingPartnerships = partnerships.filter(p => p.status === "pending")
  const activePartnerships = partnerships.filter(p => p.status === "active")

  const getStatusBadge = (status: string, surface: "dark" | "light") => {
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
          <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/50">
            Active Partnership
          </span>
        ) : (
          <span className="bg-green-100 text-green-800 border border-green-200 font-medium text-xs px-2 py-1 rounded-full">
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

  return (
    <PartnerLayout 
      title="Agency Invitations" 
      subtitle="Manage invitations from lead agencies to join their partner network"
    >
      <div className="space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <GlassCard className="p-4 text-center">
            <div className="text-3xl font-display font-bold text-amber-400">{pendingPartnerships.length}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Pending Invitations</div>
          </GlassCard>
          <GlassCard className="p-4 text-center">
            <div className="text-3xl font-display font-bold text-green-400">{activePartnerships.length}</div>
            <div className="font-mono text-[10px] text-foreground-muted uppercase">Active Partnerships</div>
          </GlassCard>
        </div>

        {/* Pending Invitations */}
        {pendingPartnerships.length > 0 && (
          <div>
            <h2 className="font-mono text-[10px] uppercase text-amber-400 tracking-wider mb-4 flex items-center gap-2">
              <Clock className="w-3 h-3" /> Pending Invitations
            </h2>
            <div className="space-y-4">
              {pendingPartnerships.map((partnership) => (
                <div key={partnership.id} className="rounded-xl p-6 bg-[#0C3535] border border-accent/40">
                  <div className="flex flex-col gap-4">
                    {/* Header with agency info */}
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-xl bg-accent/30 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-7 h-7 text-accent" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          {getStatusBadge(partnership.status, "dark")}
                        </div>
                        <h3 className="font-display font-bold text-2xl text-[#FFFFFF]">
                          {partnership.agency?.company_name || partnership.agency?.full_name || "Unknown Agency"}
                        </h3>
                        <p className="text-base text-[#E8E8E8] flex items-center gap-2 mt-2">
                          <Mail className="w-4 h-4 text-accent" />
                          <span className="font-medium">{partnership.agency?.email || "Email not available"}</span>
                        </p>
                      </div>
                    </div>
                    
                    {/* Invitation context */}
                    <div className="bg-[#1A5252] rounded-lg p-4 border border-[#9BB8B8]/30">
                      <p className="text-[#E8E8E8] text-sm leading-relaxed">
                        <strong className="text-accent">{partnership.agency?.company_name || partnership.agency?.full_name || "This agency"}</strong> has invited you to join their partner network on Ligament. 
                        By accepting, you&apos;ll be able to receive project briefs and collaborate with them directly.
                      </p>
                    </div>
                    
                    {/* Personal message if provided */}
                    {partnership.invitation_message && (
                      <div className="p-4 rounded-lg bg-[#1A5252] border-l-4 border-accent">
                        <div className="flex items-center gap-2 mb-2">
                          <MessageSquare className="w-4 h-4 text-accent" />
                          <span className="font-mono text-xs text-accent uppercase tracking-wider font-semibold">Personal Message from Agency</span>
                        </div>
                        <p className="text-[#E8E8E8] text-sm leading-relaxed">{partnership.invitation_message}</p>
                      </div>
                    )}
                    
                    {/* Footer with date and actions */}
                    <div className="flex items-center justify-between pt-4 border-t border-[#9BB8B8]/30">
                      <div className="flex items-center gap-2 text-[#9BB8B8] text-sm">
                        <Calendar className="w-4 h-4 text-accent" />
                        <span>Received {new Date(partnership.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
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
                          className="bg-accent text-background hover:bg-accent/90 font-semibold"
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
          </div>
        )}

        {/* Active Partnerships */}
        {activePartnerships.length > 0 && (
          <div>
            <h2 className="font-mono text-[10px] uppercase text-green-400 tracking-wider mb-4 flex items-center gap-2">
              <Users className="w-3 h-3" /> Active Partnerships
            </h2>
            <div className="space-y-4">
              {activePartnerships.map((partnership) => (
                <div
                  key={partnership.id}
                  className="bg-white border border-gray-200 shadow-sm rounded-xl p-5 flex items-start gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                    <Building2 className="w-6 h-6 text-gray-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <h3 className="font-display text-gray-900 text-lg font-bold">
                        {partnership.agency?.company_name || partnership.agency?.full_name || "Lead Agency"}
                      </h3>
                      {getStatusBadge(partnership.status, "light")}
                    </div>
                    {partnership.agency?.email && (
                      <p className="text-gray-700 text-sm mb-2">{partnership.agency.email}</p>
                    )}
                    <p className="text-gray-600 text-sm leading-relaxed">
                      You are part of this agency&apos;s partner network. You&apos;ll receive project assignments from them.
                    </p>
                    {partnership.accepted_at && (
                      <p className="text-gray-500 text-xs mt-3">
                        Partnered since{" "}
                        {new Date(partnership.accepted_at).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400 shrink-0 mt-1" aria-hidden />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-foreground-muted">Loading partnerships...</div>
          </div>
        ) : partnerships.length === 0 && (
          <GlassCard className="p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-accent" />
            </div>
            <h3 className="font-display font-bold text-xl text-foreground mb-2">
              No Invitations Yet
            </h3>
            <p className="text-foreground-muted max-w-md mx-auto">
              When lead agencies invite you to join their partner network, those invitations will appear here.
              Make sure your profile is complete to increase your chances of being discovered.
            </p>
          </GlassCard>
        )}
      </div>
    </PartnerLayout>
  )
}
