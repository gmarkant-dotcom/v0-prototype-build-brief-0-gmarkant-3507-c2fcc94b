"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { useRouter, usePathname } from "next/navigation"
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
  hasDemoAccess: boolean
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
  hasDemoAccess: false,
  role: null,
  linkedAgencyId: null,
  checkFeatureAccess: () => false,
  showInvitationRequest: () => {},
})

export function PaidUserProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
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
  // No optimistic defaults: stay unpaid/non-admin/loading until the server confirms
  // the profile. A restricted screen must never render before that confirmation.
  const [isPaid, setIsPaid] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [hasDemoAccess, setHasDemoAccess] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [role, setRole] = useState<UserRole>(null)
  const [activeRole, setActiveRole] = useState<UserRole>(null)
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
      setActiveRole('agency')
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    let settled = false

    // Safety net: if Supabase never responds, don't leave users stuck on a spinner
    // forever. Fail closed (isPaid = false) rather than granting access.
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      console.error("[PaidUserContext] profile fetch timed out after 10s — defaulting to unpaid")
      setIsPaid(false)
      setIsLoading(false)
    }, 10000)

    const checkPaidStatus = async () => {
      try {
        const supabase = createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        // Diagnostic logging - remove after debugging
        if (authError) console.error("[PaidUserContext] auth.getUser error:", authError)
        if (!user) {
          console.error("[PaidUserContext] no user returned from auth.getUser - is_paid will stay false")
        }

        if (user) {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('is_paid, is_admin, role, active_role, linked_agency_id, demo_access')
            .eq('id', user.id)
            .single()

          if (profileError) console.error("[PaidUserContext] profiles query error:", profileError)
          console.log("[PaidUserContext] profile fetched:", { is_paid: profile?.is_paid, is_admin: profile?.is_admin, role: profile?.role, userId: user.id.slice(0,8) })
          setIsPaid(profile?.is_paid === true)
          setIsAdmin(profile?.is_admin || false)
          setHasDemoAccess(profile?.demo_access || false)
          setRole(profile?.role as UserRole || null)
          setActiveRole((profile?.active_role as UserRole) || null)
          setLinkedAgencyId(profile?.linked_agency_id || null)
        }
      } finally {
        if (!settled) {
          settled = true
          clearTimeout(timeoutId)
          setIsLoading(false)
        }
      }
    }

    checkPaidStatus()

    return () => {
      settled = true
      clearTimeout(timeoutId)
    }
    // Re-run on every route change so a restriction (or restoration) an admin makes
    // mid-session is picked up on the next page load, instead of staying cached in
    // React state for the lifetime of this provider instance.
  }, [pathname])
  
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
    // A dual-role account currently active as partner gets the same treatment, even if
    // its permanent base role is agency.
    if (role === "partner" || activeRole === "partner") return true

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
      hasDemoAccess,
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
