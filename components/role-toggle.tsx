"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { ArrowLeftRight, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type Profile = {
  role: string | null
  secondary_role: string | null
  active_role: string | null
}

export function RoleToggle() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [switching, setSwitching] = useState(false)
  const [upgradeRequired, setUpgradeRequired] = useState(false)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from("profiles")
        .select("role, secondary_role, active_role")
        .eq("id", user.id)
        .single()
      if (data) setProfile(data as Profile)
    }
    load()
  }, [])

  if (!profile) return null

  const activeRole = profile.active_role || profile.role
  const primaryRole = profile.role
  const secondaryRole = profile.secondary_role

  // Agency primary — show "Switch to Partner" (always available, self-serve)
  // Partner primary with secondary_role='agency' — show "Switch to Lead Agency"
  // Partner primary without secondary_role='agency' — show "Switch to Lead Agency" (will hit upgrade gate)

  const targetRole = activeRole === "agency" ? "partner" : "agency"
  const label = activeRole === "agency" ? "Switch to Partner Mode" : "Switch to Lead Agency"

  const handleSwitch = async () => {
    setSwitching(true)
    setUpgradeRequired(false)
    try {
      const res = await fetch("/api/profile/switch-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: targetRole }),
      })
      const data = await res.json()
      if (res.status === 403 && data.error === "upgrade_required") {
        setUpgradeRequired(true)
        setSwitching(false)
        return
      }
      if (!res.ok) {
        console.error("[RoleToggle] switch failed:", data)
        setSwitching(false)
        return
      }
      router.push(data.redirect || (targetRole === "agency" ? "/agency/dashboard" : "/partner"))
      router.refresh()
    } catch (e) {
      console.error("[RoleToggle] error:", e)
      setSwitching(false)
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={handleSwitch}
        disabled={switching}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-lg border font-mono text-[11px] transition-all",
          activeRole === "agency"
            ? "border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20"
            : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
        )}
      >
        {switching ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
        )}
        <span>{switching ? "Switching..." : label}</span>
      </button>

      {upgradeRequired && (
        <div className="mt-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
          <p className="font-mono text-[10px] text-amber-200 leading-relaxed">
            Lead Agency access requires an active subscription. Contact us at{" "}
            <a href="mailto:hello@withligament.com" className="underline">
              hello@withligament.com
            </a>{" "}
            to upgrade.
          </p>
        </div>
      )}
    </div>
  )
}
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type ActiveRole = "agency" | "partner"

export function RoleToggle() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [eligible, setEligible] = useState(false)
  const [activeRole, setActiveRole] = useState<ActiveRole>("agency")
  const [savingRole, setSavingRole] = useState<ActiveRole | null>(null)

  useEffect(() => {
    const loadEligibility = async () => {
      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          setEligible(false)
          return
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("id, role, active_role")
          .eq("id", user.id)
          .maybeSingle()

        if (!profile || profile.role !== "agency") {
          setEligible(false)
          return
        }

        const { data: partnerships } = await supabase
          .from("partnerships")
          .select("id")
          .eq("partner_id", user.id)
          .eq("status", "active")
          .limit(1)

        const hasAcceptedPartnerPartnership = Boolean(partnerships && partnerships.length > 0)
        if (!hasAcceptedPartnerPartnership) {
          setEligible(false)
          return
        }

        setEligible(true)
        setActiveRole(profile.active_role === "partner" ? "partner" : "agency")
      } catch {
        setEligible(false)
      } finally {
        setLoading(false)
      }
    }

    void loadEligibility()
  }, [])

  const handleToggle = async (nextRole: ActiveRole) => {
    if (!eligible || savingRole || nextRole === activeRole) return

    setSavingRole(nextRole)
    try {
      const res = await fetch("/api/user/active-role", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_role: nextRole }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Failed to switch role")
      }

      setActiveRole(nextRole)
      router.push(nextRole === "partner" ? "/partner" : "/agency/dashboard")
      router.refresh()
    } catch {
      // Keep the current role selected if the switch fails.
    } finally {
      setSavingRole(null)
    }
  }

  if (loading || !eligible) return null

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-white/[0.03] p-1">
      <div className="grid grid-cols-2 gap-1">
        {(["agency", "partner"] as const).map((role) => {
          const isActive = activeRole === role
          const isSaving = savingRole === role
          return (
            <button
              key={role}
              type="button"
              onClick={() => handleToggle(role)}
              disabled={Boolean(savingRole)}
              className={cn(
                "rounded-lg px-3 py-2 text-center font-mono text-[11px] uppercase tracking-wider transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/90 hover:bg-white/5 hover:text-foreground",
                savingRole && !isActive && "opacity-60"
              )}
            >
              {isSaving ? "Switching..." : role === "agency" ? "Agency" : "Partner"}
            </button>
          )
        })}
      </div>
    </div>
  )
}
