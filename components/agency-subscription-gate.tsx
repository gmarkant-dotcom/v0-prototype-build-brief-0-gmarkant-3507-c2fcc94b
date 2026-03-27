"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { usePaidUser } from "@/contexts/paid-user-context"
import { UpgradeRequiredModal } from "@/components/upgrade-required-modal"
import { LigamentLogo } from "@/components/ligament-logo"
import Link from "next/link"

/**
 * Lead agencies must be paid (or admin) to use the product. Middleware ensures
 * only lead-agency accounts reach this layout; partners use /partner.
 */
export function AgencySubscriptionGate({ children }: { children: ReactNode }) {
  const { isLoading, isDemo, isPaid, isAdmin } = usePaidUser()
  const [showModal, setShowModal] = useState(false)

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

  return (
    <div className="min-h-screen bg-[#081F1F] flex flex-col items-center justify-center p-8">
      <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-[#0C3535]/80 p-10 text-center">
        <Link href="/" className="inline-block mb-8">
          <LigamentLogo size="md" variant="primary" />
        </Link>
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#C8F53C]/80 mb-2">
          Subscription required
        </p>
        <h1 className="font-display font-black text-2xl text-white mb-3">
          Your account is not yet active
        </h1>
        <p className="text-white/60 text-sm leading-relaxed mb-8">
          Lead agency features are turned off until your organization is marked as paid.
          If you believe this is a mistake, contact your Ligament administrator.
        </p>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="bg-[#C8F53C] text-[#0C3535] font-mono text-xs uppercase tracking-wider px-6 py-3 rounded-lg font-bold hover:bg-[#C8F53C]/90"
        >
          Learn more
        </button>
      </div>
      <UpgradeRequiredModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        featureName="Lead agency platform"
      />
    </div>
  )
}
