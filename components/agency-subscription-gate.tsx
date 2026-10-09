"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { usePaidUser } from "@/contexts/paid-user-context"
import { isEntitlementEscapeRoute, mayManageBilling } from "@/lib/entitlement-escape"
import { AgencyUpgradeScreen, type AgencyUpgradeReason } from "@/components/agency-upgrade-screen"

/**
 * THE LOCKOUT. The agency side requires the caller's ACTIVE organization to be a paid lead
 * agency - G1, owner ruling 2026-10-09 - or the demo deployment.
 *
 * ---------------------------------------------------------------------------
 * G1 CHANGED THREE THINGS HERE.
 *
 *   1. profiles.is_admin NO LONGER ADMITS. It used to bypass this wall; a profile flag admits
 *      nobody under G1. /admin is unaffected.
 *   2. "Lead agency" is now half of the test. A paid VENDOR organization is refused, which is
 *      what the 13 vendor-primary profiles carrying secondary_role = 'agency' needed.
 *   3. ONE UPGRADE SCREEN, components/agency-upgrade-screen.tsx, shared with /agency-access,
 *      where middleware.ts rewrites a refused /agency request before this shell ever loads.
 *      This wall is the second line, for a state that changes mid-session.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS UNCHANGED FROM 092
 *
 * Entitlement is a fact about the ACTING ORGANIZATION, so this is a COMPANY-WIDE state (R5).
 * R6's escape still holds: an owner or admin of a lapsed lead agency may reach the billing
 * page (lib/entitlement-escape.ts), and the upgrade screen links them to it. A plain member
 * gets no such link. The organization switcher and sign out stay on the screen, because it
 * replaces the sidebar that holds both.
 *
 * VENDOR ORGANIZATIONS ARE NOT AFFECTED. This component is mounted in exactly one place,
 * components/agency-layout.tsx; components/partner-layout.tsx mounts no equivalent.
 */
export function AgencySubscriptionGate({ children }: { children: ReactNode }) {
  const { isLoading, isDemo, isPaid, orgRole, entitlementReason } = usePaidUser()
  const pathname = usePathname()

  // Never render a restriction screen before the answer is in. An unentitled flash on a
  // paying account is indistinguishable from a real lockout to the person looking at it.
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#081F1F] flex items-center justify-center">
        <div className="font-mono text-sm text-white/50">Loading…</div>
      </div>
    )
  }

  // isDemo is the client's demo-hostname check and admits the UI only; every API route is
  // gated on the server by the same G1 resolver.
  if (isDemo || isPaid) {
    return <>{children}</>
  }

  // R6. THE ESCAPE. Only for the roles that can act on it, and only on the named routes.
  const canManage = mayManageBilling(orgRole)
  if (canManage && isEntitlementEscapeRoute(pathname)) {
    return <>{children}</>
  }

  // One line, so a support conversation can start from a log rather than from a screenshot.
  console.error("[AgencySubscriptionGate] BLOCKING", {
    reason: entitlementReason,
    orgRole,
    canManage,
    pathname,
  })

  // A FAULT (lookup-failed, org-row-missing) is not a billing state and says so; a lapse keeps
  // R6's billing link for owners and admins; everything else is "not a lead agency".
  const upgradeReason: AgencyUpgradeReason =
    entitlementReason === "lookup-failed" || entitlementReason === "org-row-missing"
      ? "unavailable"
      : entitlementReason === "org-not-entitled"
        ? "not_paid"
        : "not_lead_agency"
  return <AgencyUpgradeScreen reason={upgradeReason} canManageBilling={canManage} />
}
