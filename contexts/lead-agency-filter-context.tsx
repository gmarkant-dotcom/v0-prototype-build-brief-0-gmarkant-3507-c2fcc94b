"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { isActivePartnership } from '@/lib/partnership-state'
import { isDemoMode, demoLeadAgencies, demoPartnerInvitations, type LeadAgency, type LeadAgencyInvitation } from "@/lib/demo-data"

// Partnership connection (Tier 1 - using new partnerships table)
export type LeadAgencyConnection = {
  id: string
  agencyId: string
  agencyName: string
  agencyEmail?: string
  agencyLocation: string
  status: "pending" | "active" | "suspended" | "terminated" | "confirmed" | "accepted" | "declined"
  invitedAt: string
  acceptedAt?: string
  confirmedAt?: string
  invitationMessage?: string
}

type LeadAgencyFilterContextType = {
  connections: LeadAgencyConnection[]
  confirmedAgencies: LeadAgencyConnection[]
  selectedAgencyId: string | null
  setSelectedAgencyId: (id: string | null) => void
  isLoading: boolean
  acceptInvitation: (invitationId: string) => Promise<void>
  declineInvitation: (invitationId: string) => Promise<void>
  refreshConnections: () => Promise<void>
}

const LeadAgencyFilterContext = createContext<LeadAgencyFilterContextType>({
  connections: [],
  confirmedAgencies: [],
  selectedAgencyId: null,
  setSelectedAgencyId: () => {},
  isLoading: true,
  acceptInvitation: async () => {},
  declineInvitation: async () => {},
  refreshConnections: async () => {},
})

export function LeadAgencyFilterProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<LeadAgencyConnection[]>([])
  const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadConnections = async () => {
    setIsLoading(true)
    
    if (isDemoMode()) {
      // Use demo data
      const demoConnections: LeadAgencyConnection[] = demoPartnerInvitations.map(inv => ({
        id: inv.id,
        agencyId: inv.agencyId,
        agencyName: inv.agencyName,
        agencyLocation: inv.agencyLocation,
        status: inv.status,
        invitedAt: inv.invitedAt,
        acceptedAt: inv.acceptedAt,
        confirmedAt: inv.confirmedAt,
        invitationMessage: inv.invitationMessage,
      }))
      setConnections(demoConnections)
      setIsLoading(false)
      return
    }

    // Production: Load partnerships from API
    try {
      const response = await fetch('/api/partnerships')
      
      if (!response.ok) {
        setConnections([])
        setIsLoading(false)
        return
      }

      const data = await response.json()
      
      const loadedConnections: LeadAgencyConnection[] = (data.partnerships || []).map((p: any) => ({
        id: p.id,
        // Wire key renamed from `agency` to `lead_org` by Greg's 079 ruling.
        agencyId: p.lead_org?.id || p.lead_org_id,
        agencyName: p.lead_org?.name || p.lead_org?.contact_name || 'Unknown Agency',
        agencyEmail: p.lead_org?.contact_email,
        // `location` is a profiles column with NO organizations equivalent, so this has
        // been '' since the embeds were rewritten to read organizations - the rename does
        // not cause it and does not fix it. Listed in docs/079-embed-closure-report.md.
        agencyLocation: '',
        status: p.status,
        // invitation_sent_at, never the legacy invited_at - only the former means an
        // invitation email was confirmed sent. See lib/partnership-state.ts.
        invitedAt: p.invitation_sent_at,
        acceptedAt: p.accepted_at,
        invitationMessage: p.invitation_message,
      }))

      setConnections(loadedConnections)
    } catch (error) {
      console.error('Error loading connections:', error)
      setConnections([])
    }
    
    setIsLoading(false)
  }

  useEffect(() => {
    loadConnections()
  }, [])

  // Active partnerships (Tier 1 confirmed relationships)
  const confirmedAgencies = connections.filter((c) => isActivePartnership(c))

  const acceptInvitation = async (partnershipId: string) => {
    if (isDemoMode()) {
      // Demo mode: update local state
      setConnections(prev => prev.map(c => 
        c.id === partnershipId 
          ? { ...c, status: 'active' as const, acceptedAt: new Date().toISOString().split('T')[0] }
          : c
      ))
      return
    }

    // Production: update partnership via API
    try {
      const response = await fetch('/api/partnerships', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnershipId,
          status: 'active',
        }),
      })

      if (response.ok) {
        await loadConnections()
      }
    } catch (error) {
      console.error('Error accepting invitation:', error)
    }
  }

  const declineInvitation = async (partnershipId: string) => {
    if (isDemoMode()) {
      // Demo mode: update local state
      setConnections(prev => prev.map(c => 
        c.id === partnershipId 
          ? { ...c, status: 'terminated' as const }
          : c
      ))
      return
    }

    // Production: update partnership via API
    try {
      const response = await fetch('/api/partnerships', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnershipId,
          status: 'terminated',
        }),
      })

      if (response.ok) {
        await loadConnections()
      }
    } catch (error) {
      console.error('Error declining invitation:', error)
    }
  }

  const refreshConnections = async () => {
    await loadConnections()
  }

  return (
    <LeadAgencyFilterContext.Provider value={{
      connections,
      confirmedAgencies,
      selectedAgencyId,
      setSelectedAgencyId,
      isLoading,
      acceptInvitation,
      declineInvitation,
      refreshConnections,
    }}>
      {children}
    </LeadAgencyFilterContext.Provider>
  )
}

export const useLeadAgencyFilter = () => useContext(LeadAgencyFilterContext)
