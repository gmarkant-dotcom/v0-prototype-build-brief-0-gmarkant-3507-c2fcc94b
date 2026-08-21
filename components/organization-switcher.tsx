"use client"

import { useEffect, useMemo, useState } from "react"
import { Building2, Check, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

/**
 * WHICH COMPANY AM I ACTING FOR? The interface half of migration 090.
 *
 * ---------------------------------------------------------------------------
 * IT RENDERS NOTHING FOR ANYBODY WITH ONE MEMBERSHIP, WHICH IS EVERYBODY TODAY.
 *
 * All eighteen accounts belong to exactly one organization, and `resolveActingOrgId()`
 * answers on its sole-membership branch without ever reading `profiles.active_org_id` for
 * them. A control offering a choice of one is not a control, it is a thing to wonder about,
 * so this returns null below two memberships. The first time it appears for anyone is after
 * a colleague accepts an invitation - which is behind COLLEAGUE_INVITATIONS, and that flag
 * is absent from every env file and from Vercel.
 *
 * THAT IS ALSO WHY THIS IS NOT ITSELF BEHIND THE FLAG. `colleagueInvitationsEnabled()` is a
 * server-side read of `process.env` and this is a client component inside the sidebar, so
 * gating it would mean threading a prop down through the layout. It would buy nothing:
 * a second membership can only be created by `accept_org_invitation()`, and reaching that
 * requires the flag. The empty state is the gate.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT COSTS THE PEOPLE IT DOES NOT RENDER FOR: one query, `org_id, role` from
 * `org_members` keyed on the caller's own id. The organization NAMES and the stored
 * preference are only fetched once that first query has returned two or more rows, so the
 * eighteen single-membership accounts pay for one small indexed read and nothing else.
 *
 * ---------------------------------------------------------------------------
 * THE WRITE GOES THROUGH `set_active_org(uuid)` AND NOWHERE ELSE. Not a PATCH on
 * `profiles`. That function checks that `auth.uid()` is a member of the organization
 * before it writes, and refuses with a message that never names the organization - see
 * migration 090 section 3 for why naming it would turn a refusal into an existence oracle.
 *
 * NOTHING THIS COMPONENT SENDS IS TRUSTED BY ANYTHING. The organization id in the click
 * handler came from this caller's own membership rows, but `set_active_org` re-derives the
 * membership set server-side regardless, and `resolveActingOrgId()` validates the stored
 * value again on every single read afterwards. A tampered id fails at the database.
 *
 * ---------------------------------------------------------------------------
 * ONE COMPONENT, TWO PORTALS, TWO PALETTES. Both layouts already carry the same chip -
 * "<company> / Lead Agency Account" in the agency sidebar and "<company> / Vendor Account"
 * in the partner header - and both need this, because an organization can be a vendor and
 * a vendor org's colleague is locked out of every write exactly as an agency org's is.
 * They do not share a palette: the agency portal is dark and uses `foreground`/`accent`,
 * the partner portal is light and uses the `vendor-*` tokens from app/globals.css. So the
 * markup is written once and the class names come from `PALETTE` below. Adding a second
 * copy of this component for the second portal is how the two would drift.
 */

const PALETTE = {
  agency: {
    container: "border-b border-border",
    label: "text-foreground-muted",
    icon: "text-foreground-muted",
    row: "hover:bg-white/5",
    rowActive: "bg-accent/10",
    name: "text-foreground",
    nameActive: "text-accent",
    role: "text-foreground-muted",
    mark: "text-accent",
    warning: "text-amber-200",
    error: "text-red-400",
  },
  vendor: {
    container: "border-b border-vendor-border",
    label: "text-vendor-muted",
    icon: "text-vendor-muted",
    row: "hover:bg-vendor-background",
    rowActive: "bg-vendor-background",
    name: "text-vendor-foreground",
    nameActive: "text-vendor-foreground font-semibold",
    role: "text-vendor-muted",
    mark: "text-[#0C3535]",
    warning: "text-amber-700",
    error: "text-red-600",
  },
} as const

type Membership = {
  orgId: string
  name: string
  role: string
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

export function OrganizationSwitcher({
  variant = "agency",
  onSwitched,
}: {
  variant?: keyof typeof PALETTE
  onSwitched?: () => void
}) {
  const palette = PALETTE[variant]
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // Step one, and for everybody today it is the only step.
        const { data: memberRows, error: memberError } = await supabase
          .from("org_members")
          .select("org_id, role")
          .eq("user_id", user.id)
        if (memberError || !memberRows || memberRows.length < 2) return

        const orgIds = (memberRows as Array<{ org_id?: string | null }>)
          .map((r) => r.org_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)

        const [{ data: orgRows }, { data: profileRow }] = await Promise.all([
          supabase.from("organizations").select("id, name").in("id", orgIds),
          supabase.from("profiles").select("active_org_id").eq("id", user.id).maybeSingle(),
        ])

        const nameById = new Map(
          ((orgRows ?? []) as Array<{ id?: string | null; name?: string | null }>)
            .filter((o) => typeof o.id === "string")
            .map((o) => [o.id as string, o.name || "Unnamed organization"])
        )

        const roleById = new Map(
          (memberRows as Array<{ org_id?: string | null; role?: string | null }>)
            .filter((m) => typeof m.org_id === "string")
            .map((m) => [m.org_id as string, m.role || "member"])
        )

        if (cancelled) return
        setMemberships(
          orgIds.map((id) => ({
            orgId: id,
            // An organization whose name did not come back is one this caller cannot
            // read through the organizations policies. It is still one they belong to,
            // so it is still listed - unnamed rather than hidden, because a membership
            // silently missing from this list is how somebody ends up unable to explain
            // which company they are writing to.
            name: nameById.get(id) || "Unnamed organization",
            role: roleById.get(id) || "member",
          }))
        )
        setActiveOrgId(
          (profileRow as { active_org_id?: string | null } | null)?.active_org_id || null
        )
      } catch {
        // Fail quiet and render nothing. This control is a convenience; a broken lookup
        // must not take the sidebar down with it.
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const uniqueMemberships = useMemo(
    () => Array.from(new Map(memberships.map((m) => [m.orgId, m])).values()),
    [memberships]
  )

  const handleSwitch = async (orgId: string) => {
    if (orgId === activeOrgId || switchingTo) return
    setSwitchingTo(orgId)
    setError(null)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc("set_active_org", { p_org_id: orgId })
      if (rpcError) {
        console.error("[OrganizationSwitcher] set_active_org failed:", rpcError)
        setError(
          rpcError.message?.includes("not an organization you belong to")
            ? "You are no longer a member of that organization."
            : "That did not go through. Try again."
        )
        setSwitchingTo(null)
        return
      }
      onSwitched?.()
      // A HARD NAVIGATION, NOT router.refresh(). Switching company changes which rows
      // every query on the page is allowed to return, and the current URL may name a
      // project the new organization cannot read. A full load clears the SWR cache and
      // the selected-project context together, and the dashboard is the one agency route
      // that is correct for any organization.
      window.location.assign("/agency/dashboard")
    } catch (e) {
      console.error("[OrganizationSwitcher] error:", e)
      setError("That did not go through. Try again.")
      setSwitchingTo(null)
    }
  }

  // No hydration flicker and no empty state: nothing renders until the lookup has
  // finished, and nothing renders at all for a caller with a single membership.
  if (isLoading || uniqueMemberships.length < 2) return null

  return (
    <div className={palette.container}>
      <div className="px-4 pt-3 pb-1.5 flex items-center gap-2">
        <Building2 className={cn("w-3.5 h-3.5", palette.icon)} />
        <span className={cn("font-mono text-2xs uppercase tracking-wide", palette.label)}>
          Acting for
        </span>
      </div>

      {uniqueMemberships.map((membership) => {
        const isActive = membership.orgId === activeOrgId
        const isSwitching = switchingTo === membership.orgId
        return (
          <button
            key={membership.orgId}
            onClick={() => handleSwitch(membership.orgId)}
            disabled={Boolean(switchingTo)}
            className={cn(
              "w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors",
              isActive ? palette.rowActive : palette.row,
              switchingTo && !isSwitching && "opacity-50"
            )}
          >
            <div className="flex-1 min-w-0">
              <div className={cn(
                "text-sm truncate",
                isActive ? palette.nameActive : palette.name
              )}>
                {membership.name}
              </div>
              <div className={cn("font-mono text-2xs", palette.role)}>
                {ROLE_LABEL[membership.role] || membership.role}
              </div>
            </div>
            {isSwitching ? (
              <Loader2 className={cn("w-4 h-4 animate-spin shrink-0", palette.mark)} />
            ) : isActive ? (
              <Check className={cn("w-4 h-4 shrink-0", palette.mark)} />
            ) : null}
          </button>
        )
      })}

      {/* The honest case, and the one worth naming: nothing has been chosen yet, so every
          write is refused as ambiguous until it is. Reachable when a membership was
          removed (which does not clear the stored choice, but does make it unusable) or
          when a second membership arrived some way other than accepting an invitation. */}
      {!activeOrgId && (
        <p className={cn("px-4 pb-3 font-mono text-2xs leading-relaxed", palette.warning)}>
          You belong to more than one company and have not chosen which one you are acting
          for. Pick one above. Until you do, anything you create will be declined.
        </p>
      )}

      {error && (
        <p className={cn("px-4 pb-3 font-mono text-2xs leading-relaxed", palette.error)}>{error}</p>
      )}
    </div>
  )
}
