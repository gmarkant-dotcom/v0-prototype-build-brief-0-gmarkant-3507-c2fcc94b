"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { useRouter, usePathname } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { isDemoMode } from "@/lib/demo-data"
import { RequestInvitationModal } from "@/components/request-invitation-modal"
import { UpgradeRequiredModal } from "@/components/upgrade-required-modal"

type UserRole = 'agency' | 'partner' | null

/**
 * The caller's role IN THEIR ACTING ORGANIZATION. Not `profiles.role`, which names the
 * portal. These two have nothing to do with each other and conflating them is how a
 * "member" would end up with billing rights.
 */
type OrgRole = 'owner' | 'admin' | 'member' | null

type PaidUserContextType = {
  /**
   * 092: THE ACTING ORGANIZATION'S ENTITLEMENT, not this person's profile flag.
   * The name is kept because eight components and the gate read it, and "is the thing
   * behind me paid" is what it has always meant.
   */
  isPaid: boolean
  isAdmin: boolean
  isLoading: boolean
  isDemo: boolean
  hasDemoAccess: boolean
  role: UserRole
  /**
   * 092: WHO MAY DO SOMETHING ABOUT A LAPSE. Owner and admin manage billing; a plain
   * member uses the product without billing rights, and must not be shown copy implying
   * they can fix it. Null when it could not be resolved, which is treated as "member" by
   * every consumer - the conservative direction.
   */
  orgRole: OrgRole
  /**
   * 092: WHY isPaid CAME OUT FALSE. Carried so the wall can tell a lapsed subscription
   * apart from an unresolved organization, which are different problems with different
   * copy and different fixes. Mirrors EntitlementReason in lib/entitlements.ts.
   */
  entitlementReason: string | null
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
  orgRole: null,
  entitlementReason: null,
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
  const [orgRole, setOrgRole] = useState<OrgRole>(null)
  const [entitlementReason, setEntitlementReason] = useState<string | null>(null)
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
      setOrgRole('owner')
      setEntitlementReason('demo-deployment')
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
          // 092: is_paid IS GONE FROM THIS SELECT. It is the vestigial profiles column now;
          // entitlement is a fact about the ACTING ORGANIZATION and is resolved below.
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('is_admin, role, active_role, linked_agency_id, demo_access')
            .eq('id', user.id)
            .single()

          if (profileError) console.error("[PaidUserContext] profiles query error:", profileError)

          setIsAdmin(profile?.is_admin || false)
          setHasDemoAccess(profile?.demo_access || false)
          setRole(profile?.role as UserRole || null)
          setActiveRole((profile?.active_role as UserRole) || null)
          setLinkedAgencyId(profile?.linked_agency_id || null)

          // ===============================================================
          // 092: THE ENTITLEMENT READ, THROUGH THE ONE CHOKE POINT.
          //
          // resolveAgencyEntitlement() is the SAME function every server-side gate calls,
          // called here with the browser client. That is deliberate and it is the property
          // worth protecting: if this page ever answered "is my company paid" its own way,
          // the wall a user sees and the 403 a route returns could disagree, and the
          // support conversation that follows has no ground truth.
          //
          // NO FALLBACK, exactly as on the server. An unresolved organization is NOT
          // entitled, with a reason that says so.
          // ===============================================================
          const { resolveAgencyEntitlement } = await import('@/lib/entitlements')
          const { actingRole } = await import('@/lib/acting-role')

          // ===============================================================
          // THE VENDOR SIDE IS SKIPPED ENTIRELY, AND THIS IS WHERE 092's LOCKOUT IS
          // STOPPED FROM REACHING SIDEWAYS.
          //
          // THIS PROVIDER IS MOUNTED IN BOTH PORTALS - components/agency-layout.tsx AND
          // components/partner-layout.tsx. Only the agency layout mounts
          // AgencySubscriptionGate, so a vendor is never gated on this answer. Resolving it
          // for them anyway would cost every vendor two extra queries on every route change
          // AND write "[entitlements] ... refusing" lines into the logs for people who were
          // never refused anything - noise that is worse than useless, because the next
          // person to read those logs will believe vendors are being locked out.
          //
          // VENDOR ORGANIZATIONS HAVE NO ENTITLEMENT CONCEPT. Vendor access is free by the
          // pricing copy, and organizations.is_paid defaults to false, so reading it for a
          // vendor organization would answer "not entitled" about a question nobody asked.
          //
          // actingRole() AND NOT canActAs(), DELIBERATELY. actingRole lets active_role
          // decide and consults `role` only when active_role is unset, so an account with
          // role='partner' and active_role='agency' - which IS gated on the agency side -
          // still gets a real entitlement answer. The permissive canActAs() form that
          // checkFeatureAccess uses below would have skipped the read for that account and
          // walled it. Same predicate, same reasoning, as canUploadFiles() on the server.
          // ===============================================================
          if (actingRole(profile) === 'partner') {
            setIsPaid(false)
            setEntitlementReason('vendor-free')
            setOrgRole(null)
            return
          }

          const decision = await resolveAgencyEntitlement(profile, user.id, supabase)
          setIsPaid(decision.entitled)
          setEntitlementReason(decision.reason)

          // WHO MAY DO SOMETHING ABOUT IT. Read for the acting organization only, so a
          // person who owns company A and is a plain member of lapsed company B gets
          // "member" while acting for B - which is the correct answer and the one the wall
          // needs. Skipped entirely when entitled, because nothing reads it then.
          if (!decision.entitled && decision.orgId) {
            const { data: membership } = await supabase
              .from('org_members')
              .select('role')
              .eq('user_id', user.id)
              .eq('org_id', decision.orgId)
              .maybeSingle()
            const memberRole = (membership as { role?: string | null } | null)?.role
            setOrgRole(
              memberRole === 'owner' || memberRole === 'admin' || memberRole === 'member'
                ? memberRole
                : null
            )
          } else {
            setOrgRole(null)
          }
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
      orgRole,
      entitlementReason,
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
