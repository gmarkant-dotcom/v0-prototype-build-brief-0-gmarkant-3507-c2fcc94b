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
                  : "text-foreground-muted hover:bg-white/5 hover:text-foreground",
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
