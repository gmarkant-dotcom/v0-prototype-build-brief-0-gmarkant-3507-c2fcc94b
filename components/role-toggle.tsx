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
  // G1: which switches the server would honour. Display only; /api/profile/switch-role and
  // set_active_role (113) decide again. Null until loaded, so nothing renders early.
  const [canSwitch, setCanSwitch] = useState<{ agency: boolean; partner: boolean } | null>(null)
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
      const { hasAnyEntitledOrganization, hasVendorOrganization } = await import("@/lib/entitlements")
      const [agency, partner] = await Promise.all([
        hasAnyEntitledOrganization(user.id, supabase),
        hasVendorOrganization(user.id, supabase),
      ])
      setCanSwitch({ agency, partner })
      if (data) setProfile(data as Profile)
    }
    load()
  }, [])

  if (!profile || !canSwitch) return null

  const activeRole = profile.active_role || profile.role
  const targetRole = activeRole === "agency" ? "partner" : "agency"
  const label = activeRole === "agency" ? "Switch to Vendor Mode" : "Switch to Lead Agency"

  // Hidden, not disabled, for a user with no organization the target side would admit: the
  // "Switch to Lead Agency" control is not offered to anyone without a paid lead agency.
  if (!canSwitch[targetRole]) return null

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
          "w-full flex items-center gap-2 px-3 py-2 rounded-lg border font-mono text-2xs transition-all",
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
          <p className="font-mono text-2xs text-amber-200 leading-relaxed">
            Agency access requires a paid lead-agency account.{" "}
            <a href="/contact" className="underline">
              Contact us
            </a>{" "}
            to set one up.
          </p>
        </div>
      )}
    </div>
  )
}
