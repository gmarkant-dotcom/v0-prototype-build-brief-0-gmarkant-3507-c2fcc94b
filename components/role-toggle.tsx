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
