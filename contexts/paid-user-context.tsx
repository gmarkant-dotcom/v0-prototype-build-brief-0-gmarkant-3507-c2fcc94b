"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { RequestInvitationModal } from "@/components/request-invitation-modal"
import { UpgradeRequiredModal } from "@/components/upgrade-required-modal"

type UserRole = 'agency' | 'partner' | null

type PaidUserContextType = {
  isPaid: boolean
  isAdmin: boolean
  isLoading: boolean
  isDemo: boolean
  role: UserRole
  linkedAgencyId: string | null
  checkFeatureAccess: (featureName?: string) => boolean
  showInvitationRequest: () => void // For partners to request agency invitation
}

const PaidUserContext = createContext<PaidUserContextType>({
  isPaid: false,
  isAdmin: false,
  isLoading: true,
  isDemo: false,
  role: null,
  linkedAgencyId: null,
  checkFeatureAccess: () => false,
  showInvitationRequest: () => {},
})

export function PaidUserProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  // Initialize isDemo immediately to avoid timing issues
  const [isDemo, setIsDemo] = useState(() => {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname
      return hostname.startsWith("demo.") || 
             hostname === "demo.withligament.com" ||
             hostname.includes("v0.dev") ||
             hostname.includes("vercel.app") ||
             hostname === "localhost" ||
             process.env.NEXT_PUBLIC_IS_DEMO === "true"
    }
    return process.env.NEXT_PUBLIC_IS_DEMO === "true"
  })
  const [isPaid, setIsPaid] = useState(isDemo) // Start paid if demo
  const [isAdmin, setIsAdmin] = useState(isDemo) // Start admin if demo
  const [isLoading, setIsLoading] = useState(!isDemo) // Don't show loading in demo
  const [role, setRole] = useState<UserRole>(null)
  const [linkedAgencyId, setLinkedAgencyId] = useState<string | null>(null)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [upgradeFeatureName, setUpgradeFeatureName] = useState<string | undefined>(undefined)

  useEffect(() => {
    const demoMode = isDemoMode()
    setIsDemo(demoMode)
    
    // In demo mode, everyone has full access
    if (demoMode) {
      setIsPaid(true)
      setIsAdmin(true)
      setRole('agency') // Default to agency in demo
      setIsLoading(false)
      return
    }

    const checkPaidStatus = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_paid, is_admin, role, linked_agency_id')
          .eq('id', user.id)
          .single()

        setIsPaid(profile?.is_paid || false)
        setIsAdmin(profile?.is_admin || false)
        setRole(profile?.role as UserRole || null)
        setLinkedAgencyId(profile?.linked_agency_id || null)
      }
      setIsLoading(false)
    }

    checkPaidStatus()
  }, [])
  
  const checkFeatureAccess = (featureName?: string): boolean => {
    // Demo preview: full access
    if (isDemo) return true

    // While profile is loading, do not open the upgrade modal or return false — that
    // made buttons feel “dead” (role/is_paid unknown). The API still enforces auth.
    if (isLoading) return true

    // Platform admins
    if (isAdmin) return true

    // Partner agencies collaborate in the lead agency’s ecosystem; they are not
    // the billable “primary” subscriber — do not gate partner portal features on is_paid.
    if (role === "partner") return true

    // Lead agency: paid subscription required for product features
    if (isPaid) return true

    setUpgradeFeatureName(featureName)
    setShowUpgradeModal(true)
    return false
  }
  
  const showInvitationRequest = () => {
    setShowRequestModal(true)
  }

  return (
    <PaidUserContext.Provider value={{ 
      isPaid, 
      isAdmin, 
      isLoading,
      isDemo,
      role,
      linkedAgencyId,
      checkFeatureAccess,
      showInvitationRequest,
    }}>
      {children}
      <RequestInvitationModal 
        isOpen={showRequestModal} 
        onClose={() => setShowRequestModal(false)}
      />
      <UpgradeRequiredModal
        isOpen={showUpgradeModal}
        onClose={() => {
          setShowUpgradeModal(false)
          setUpgradeFeatureName(undefined)
        }}
        featureName={upgradeFeatureName}
      />
    </PaidUserContext.Provider>
  )
}

export const usePaidUser = () => useContext(PaidUserContext)
