"use client"

import Link from "next/link"
import { usePaidUser } from "@/contexts/paid-user-context"
import { mayManageBilling } from "@/lib/entitlement-escape"

/**
 * THE SUBSCRIPTION PAGE, AND THE ONE ROUTE THE 092 LOCKOUT LETS A LAPSED BILLING MANAGER
 * REACH.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE STOPPED BEING A REDIRECT
 *
 * It was three lines: `redirect("/agency/usage")`, kept so old bookmarks to the retired
 * Core/Studio/Network mock billing page landed somewhere useful.
 *
 * >>> THAT REDIRECT WOULD HAVE MADE R6's ESCAPE ROUTE A LOOP. lib/entitlement-escape.ts
 * >>> exempts /agency/settings/billing and NOTHING ELSE, deliberately. A lapsed owner
 * >>> following the wall's button would have been redirected to /agency/usage, which is
 * >>> not exempt, and hit the wall again - with the only visible escape being the button
 * >>> that had just sent them there.
 *
 * So the route now renders. The bookmark's intent is served better than by the redirect,
 * because "billing" is what this page is about, and it links on to /agency/usage for the
 * quota figures rather than replacing itself with them.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO BILLING PROVIDER IN THIS CODEBASE. No dependency, no webhook route, no
 * customer id column - established by grep at 091 and unchanged since. So this page STATES
 * THE SITUATION AND CARRIES CONTACT DETAILS rather than pretending at a checkout that does
 * not exist. It is the real billing screen the day a provider arrives, and the escape route
 * already points at it, so nothing about the lockout changes then.
 *
 * ---------------------------------------------------------------------------
 * IT IS REACHED IN TWO DIFFERENT STATES AND RENDERS FOR BOTH:
 *
 *   ENTITLED - somebody browsing to their own subscription. Normal navigation, full shell.
 *   LAPSED, AS OWNER OR ADMIN - arrived through the gate's exemption. This is the only
 *   /agency page they can see.
 *
 * A LAPSED PLAIN MEMBER NEVER GETS HERE. The gate refuses them on this route as on every
 * other, and tells them to ask an owner or admin - see components/agency-subscription-gate.tsx.
 * So the member-facing copy lives on the wall, not on this page, and this page does not
 * need a branch for a state it cannot be rendered in.
 */
export default function AgencyBillingSettingsPage() {
  const { isLoading, isPaid, isDemo, isAdmin, orgRole } = usePaidUser()

  // Same rule as the gate: never render an entitlement claim before the answer is in.
  if (isLoading) {
    return (
      <div className="p-8">
        <div className="font-mono text-sm text-foreground-muted">Loading…</div>
      </div>
    )
  }

  const canManage = mayManageBilling(orgRole)
  const lapsed = !isPaid && !isDemo && !isAdmin

  return (
    <div className="p-8 max-w-2xl">
      <p className="font-mono text-2xs uppercase tracking-wider text-foreground-muted mb-2">
        Settings
      </p>
      <h1 className="font-display font-black text-2xl text-foreground mb-6">Subscription</h1>

      <div className="rounded-xl border border-border bg-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
            Status
          </span>
          <span
            className={
              lapsed
                ? "font-mono text-2xs uppercase tracking-wider text-amber-400"
                : "font-mono text-2xs uppercase tracking-wider text-accent"
            }
          >
            {lapsed ? "Not active" : "Active"}
          </span>
        </div>

        {lapsed ? (
          <p className="text-foreground-secondary text-sm leading-relaxed">
            Your company&rsquo;s subscription is not active, so Ligament is unavailable for
            everyone on your team. Nothing has been deleted. Your projects, partnerships and
            documents are intact and come back exactly as they were when the subscription is
            restored.
          </p>
        ) : (
          <p className="text-foreground-secondary text-sm leading-relaxed">
            Your company&rsquo;s subscription is active. Ligament is billed per company, so
            every colleague you add is included at no extra cost.
          </p>
        )}
      </div>

      {/* THE HONEST PART. There is no self-serve flow to link to, so this says who to talk
          to instead of rendering a button that does nothing. */}
      <div className="rounded-xl border border-border bg-card p-6 mb-6">
        <h2 className="font-display font-bold text-base text-foreground mb-3">
          {lapsed ? "Restoring your subscription" : "Changing your plan"}
        </h2>
        <p className="text-foreground-secondary text-sm leading-relaxed mb-4">
          {canManage
            ? "Subscription changes are handled by our team while we finish self-serve billing. Email us and we will take care of it, usually the same day."
            : "Subscription changes are handled by an owner or admin of your company. If you need something changed, ask one of them to get in touch with us."}
        </p>
        <a
          href="mailto:support@withligament.com?subject=Ligament%20subscription"
          className="inline-block bg-accent text-[#0C3535] font-mono text-xs uppercase tracking-wider px-6 py-3 rounded-lg font-bold hover:bg-accent/90"
        >
          Email support
        </a>
        <p className="font-mono text-2xs text-foreground-muted mt-3">
          support@withligament.com
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display font-bold text-base text-foreground mb-3">
          How Ligament is billed
        </h2>
        <ul className="text-foreground-secondary text-sm leading-relaxed space-y-2">
          <li>One subscription per company, not per person.</li>
          <li>Any number of colleagues on that subscription.</li>
          <li>AI analyses and active projects are metered for the company as a whole.</li>
          <li>Partner agencies you work with use Ligament for free.</li>
        </ul>
        {/* NOT LINKED WHEN LAPSED. /agency/usage is not an escape route, so following this
            from a locked-out account would land on the wall. */}
        {!lapsed && (
          <Link
            href="/agency/usage"
            className="inline-block mt-4 font-mono text-2xs uppercase tracking-wider text-accent hover:underline"
          >
            View this month&rsquo;s usage &rarr;
          </Link>
        )}
      </div>
    </div>
  )
}
