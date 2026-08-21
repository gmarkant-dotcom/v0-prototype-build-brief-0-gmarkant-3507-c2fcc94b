"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { usePaidUser } from "@/contexts/paid-user-context"
import { LigamentLogo } from "@/components/ligament-logo"
import { OrganizationSwitcher } from "@/components/organization-switcher"
import { createClient } from "@/lib/supabase/client"
import {
  ENTITLEMENT_ESCAPE_HREF,
  isEntitlementEscapeRoute,
  mayManageBilling,
} from "@/lib/entitlement-escape"
import Link from "next/link"

/**
 * THE LOCKOUT. Lead agencies must be entitled - or be platform admins, or be on the demo
 * deployment - to use the product.
 *
 * ---------------------------------------------------------------------------
 * 092 CHANGED WHAT THIS GATE IS ABOUT, AND THE COPY HAD TO CHANGE WITH IT.
 *
 * It used to read one boolean on one profile, flipped by a platform admin, and its copy
 * said so: "Access to this account has been restricted by an administrator." That sentence
 * was written for the admin-toggle model and it is WRONG for a lapsed payment - which is
 * not an administrator action and must not read as one. A user told an administrator
 * restricted them will go looking for the wrong person.
 *
 * Entitlement is now a fact about the ACTING ORGANIZATION, so this is a COMPANY-WIDE state
 * (R5): every member of an unpaid organization sees this, at the same moment, with no
 * carve-out for the owner and no read-only tier.
 *
 * ---------------------------------------------------------------------------
 * THREE OUTCOMES, AND THE ORDER THEY ARE DECIDED IN
 *
 *   1. ENTITLED (or demo, or platform admin) -> the product. Unchanged.
 *   2. NOT ENTITLED, on an escape route, and MAY MANAGE BILLING -> the product renders,
 *      which for that one route means the lapsed-subscription page. This is R6's escape
 *      and lib/entitlement-escape.ts is the only place the set is defined.
 *   3. NOT ENTITLED, anything else -> the wall.
 *
 * THE WALL'S COPY FORKS ON ORG ROLE AND THAT FORK IS THE POINT (R6). An owner or admin is
 * told what to do and given the route to do it. A PLAIN MEMBER IS TOLD TO CONTACT THEIR
 * ADMINISTRATOR AND IS GIVEN NO ROUTE, because they cannot fix this and an interface that
 * implies otherwise sends them somewhere that will not help them.
 *
 * ---------------------------------------------------------------------------
 * TWO ESCAPES ON THE WALL ITSELF, FOR EVERYBODY. NEITHER IS DECORATION.
 *
 * SIGN OUT. This wall replaces the entire agency shell, including the sidebar that holds
 * the only sign-out control in the portal. Without this button a locked-out user cannot
 * leave, and could not sign in as somebody else to fix it.
 *
 * THE ORGANIZATION SWITCHER. 090 made it possible to hold two memberships. Entitlement
 * being per organization means one can lapse while the other is current - and the switcher
 * is the ONLY way to move between them. It lives in the sidebar this wall replaces, so
 * without it a person whose ACTING organization lapsed is trapped, holding a perfectly good
 * membership of a paying company they cannot reach. It renders nothing at all below two
 * memberships, which is every account today, so it costs one indexed read now and is the
 * whole escape later.
 *
 * ---------------------------------------------------------------------------
 * VENDOR ORGANIZATIONS ARE NOT AFFECTED BY ANY OF THIS. This component is mounted in
 * exactly one place - components/agency-layout.tsx - and components/partner-layout.tsx
 * mounts no equivalent. Vendor access is free by the pricing copy and vendor organizations
 * have no entitlement concept at all. Nothing here reaches sideways onto that side, and
 * nothing here should be made to.
 */
export function AgencySubscriptionGate({ children }: { children: ReactNode }) {
  const { isLoading, isDemo, isPaid, isAdmin, orgRole, entitlementReason } = usePaidUser()
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

  if (isDemo || isAdmin || isPaid) {
    return <>{children}</>
  }

  // R6. THE ESCAPE. Only for the roles that can act on it, and only on the named routes.
  const canManage = mayManageBilling(orgRole)
  if (canManage && isEntitlementEscapeRoute(pathname)) {
    return <>{children}</>
  }

  // One line, so a support conversation can start from a log rather than from a screenshot.
  // The reason distinguishes a genuine lapse from an organization that did not resolve,
  // which are different problems with different fixes.
  console.error("[AgencySubscriptionGate] BLOCKING", {
    reason: entitlementReason,
    orgRole,
    canManage,
    pathname,
  })

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/"
  }

  // THE UNRESOLVED CASE IS NOT A LAPSE AND MUST NOT SAY IT IS. "no-membership",
  // "ambiguous", "preference-refused", "lookup-failed" and "org-row-missing" all arrive
  // here with isPaid false, and telling those users their subscription lapsed would send
  // them to pay for something that is already paid for. See EntitlementReason in
  // lib/entitlements.ts.
  const isLapse = entitlementReason === "org-not-entitled"

  return (
    <div className="min-h-screen bg-[#081F1F] flex flex-col items-center justify-center p-8">
      <div className="max-w-lg w-full rounded-lg border border-white/10 bg-[#0C3535]/80 p-10 text-center">
        <Link href="/" className="inline-block mb-8">
          <LigamentLogo size="md" variant="primary" />
        </Link>

        {isLapse ? (
          <>
            <p className="font-mono text-2xs uppercase tracking-wider text-[#C8F53C]/80 mb-2">
              Subscription inactive
            </p>
            <h1 className="font-display font-black text-2xl text-white mb-3">
              Your company&rsquo;s subscription is not active
            </h1>
            {canManage ? (
              <p className="text-white/60 text-sm leading-relaxed mb-8">
                Ligament is billed per company, so this affects everyone on your team. You
                can manage the subscription for your company.
              </p>
            ) : (
              /* R6. A PLAIN MEMBER CANNOT FIX THIS. The copy says who can, and offers no
                 route that implies otherwise. */
              <p className="text-white/60 text-sm leading-relaxed mb-8">
                Ligament is billed per company, so this affects everyone on your team. Ask
                an owner or admin of your company to restore the subscription. They can do
                it from their account.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-mono text-2xs uppercase tracking-wider text-[#C8F53C]/80 mb-2">
              Access unavailable
            </p>
            <h1 className="font-display font-black text-2xl text-white mb-3">
              We could not confirm your company
            </h1>
            <p className="text-white/60 text-sm leading-relaxed mb-8">
              Your account is not resolving to a company right now, so we cannot load the
              product. This is not a billing problem. Please contact support and we will
              sort it out.
            </p>
          </>
        )}

        {isLapse && canManage && (
          <Link
            href={ENTITLEMENT_ESCAPE_HREF}
            className="inline-block bg-[#C8F53C] text-[#0C3535] font-mono text-xs uppercase tracking-wider px-6 py-3 rounded-lg font-bold hover:bg-[#C8F53C]/90"
          >
            Manage subscription
          </Link>
        )}

        <div className="mt-8 pt-6 border-t border-white/10">
          {/* THE TRAP-BREAKER FOR A DUAL-MEMBERSHIP ACCOUNT. Renders nothing below two
              memberships, which is every account today. */}
          <OrganizationSwitcher />
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-4 font-mono text-2xs uppercase tracking-wider text-white/50 hover:text-white/80 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
