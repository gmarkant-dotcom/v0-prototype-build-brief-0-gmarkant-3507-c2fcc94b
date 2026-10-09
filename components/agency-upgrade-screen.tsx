"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LigamentLogo } from "@/components/ligament-logo"
import { OrganizationSwitcher } from "@/components/organization-switcher"
import { createClient } from "@/lib/supabase/client"
import { ENTITLEMENT_ESCAPE_HREF } from "@/lib/entitlement-escape"

/**
 * G1, THE ONE UPGRADE SCREEN (owner ruling, 2026-10-09). Shown on every agency page when the
 * caller's active organization is not a paid lead agency: by middleware (a rewrite to
 * /agency-access) and by AgencySubscriptionGate inside the agency shell. No pricing numbers,
 * by ruling. The API routes refuse the same callers with 402 agency_entitlement_required.
 *
 * Escapes, because this replaces the whole agency shell: the organization switcher (renders
 * nothing below two memberships), a way back to the vendor portal for anyone who belongs to a
 * vendor company, and sign out. A billing manager of a lapsed lead agency (R6) also gets the
 * billing page link.
 */
export type AgencyUpgradeReason = "not_lead_agency" | "not_paid" | "unavailable"

export function AgencyUpgradeScreen({
  reason,
  canManageBilling = false,
}: {
  reason: AgencyUpgradeReason
  canManageBilling?: boolean
}) {
  const [vendorPortal, setVendorPortal] = useState(false)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { hasVendorOrganization } = await import("@/lib/entitlements")
      const ok = await hasVendorOrganization(user.id, supabase)
      if (!cancelled) setVendorPortal(ok)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const goToVendorPortal = async () => {
    setSwitching(true)
    try {
      const res = await fetch("/api/profile/switch-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "partner" }),
      })
      if (res.ok) {
        window.location.href = "/partner"
        return
      }
    } catch (e) {
      console.error("[AgencyUpgradeScreen] switch to vendor portal failed", e)
    }
    setSwitching(false)
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/"
  }

  const unavailable = reason === "unavailable"

  return (
    <div className="min-h-screen bg-[#081F1F] flex flex-col items-center justify-center p-8">
      <div className="max-w-lg w-full rounded-lg border border-white/10 bg-[#0C3535]/80 p-10 text-center">
        <Link href="/" className="inline-block mb-8">
          <LigamentLogo size="md" variant="primary" />
        </Link>

        {unavailable ? (
          <>
            <p className="font-mono text-2xs uppercase tracking-wider text-[#C8F53C]/80 mb-2">Access unavailable</p>
            <h1 className="font-display font-black text-2xl text-white mb-3">We could not confirm your company</h1>
            <p className="text-white/60 text-sm leading-relaxed mb-8">
              This is not a billing problem. Please try again in a moment, or contact us and we will sort it out.
            </p>
          </>
        ) : (
          <>
            <p className="font-mono text-2xs uppercase tracking-wider text-[#C8F53C]/80 mb-2">Lead agency access</p>
            <h1 className="font-display font-black text-2xl text-white mb-3">
              Agency access requires a paid lead-agency account
            </h1>
            <p className="text-white/60 text-sm leading-relaxed mb-8">
              {reason === "not_paid"
                ? "Your company is set up as a lead agency, but its account is not active. Ligament is billed per company, so this applies to everyone on your team."
                : "The company you are signed in with is not set up as a lead agency. Get in touch and we will help you set one up."}
            </p>
          </>
        )}

        <div className="flex flex-col items-center gap-3">
          <Link
            href="/contact"
            className="inline-block bg-[#C8F53C] text-[#0C3535] font-mono text-xs uppercase tracking-wider px-6 py-3 rounded-lg font-bold hover:bg-[#C8F53C]/90"
          >
            Contact us
          </Link>
          {reason === "not_paid" && canManageBilling && (
            <Link
              href={ENTITLEMENT_ESCAPE_HREF}
              className="font-mono text-2xs uppercase tracking-wider text-white/70 hover:text-white"
            >
              Billing details
            </Link>
          )}
          {vendorPortal && (
            <button
              type="button"
              onClick={goToVendorPortal}
              disabled={switching}
              className="font-mono text-2xs uppercase tracking-wider text-white/70 hover:text-white disabled:opacity-50"
            >
              {switching ? "Switching..." : "Go to the vendor portal"}
            </button>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-white/10">
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
