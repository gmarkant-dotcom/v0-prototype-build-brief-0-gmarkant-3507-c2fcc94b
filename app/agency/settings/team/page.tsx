"use client"

/**
 * The team roster. READ ONLY, and deliberately so.
 *
 * Reading a roster - who is in this organization, what role they hold, what their title is,
 * when they joined - needs no product ruling. Every action on a roster does:
 *
 *   AN INVITE BUTTON needs Greg's calls 1, 2 and 9 (which roles exist, whether a non-owner
 *   may add somebody who costs money, and whether a colleague joins by emailed token or by
 *   email domain). Its place is stated in the report and in the comment beside the header
 *   below, and it is not rendered.
 *
 *   A REMOVE BUTTON needs call 3 (what happens to a removed member's created records:
 *   attribution stays, nulls, or is reassigned). Removing somebody before that is ruled is
 *   the one action on this page that cannot be undone by clicking again. Its place is
 *   stated in the comment beside the row actions column, and it is not rendered.
 *
 * See docs/m1-foundation-report.md, Phase 3, and docs/m1-phase0-discovery.md 0a.
 *
 * ---------------------------------------------------------------------------
 * 086 IS APPLIED. Both of the pieces this page waited on are live: profiles.title and the
 * org_members SELECT policy "Members read their organization roster".
 *
 * TWO BANNERS THAT USED TO STAND HERE ARE GONE, and this note is what is left of them.
 *
 *   THE ROSTER-OF-ONE BANNER said a roster of one might mean the policy was missing rather
 *   than that the person is alone. That ambiguity was real for about an hour. It is not
 *   any more: the policy is live, so one row means one member. The banner was also
 *   unconditional on the row count, so once 086 landed it asserted something false to
 *   every solo member, which today is all sixteen accounts, and it named an internal
 *   migration number in copy no customer can act on.
 *
 *   THE MISSING-TITLE BANNER described a state that can no longer recur, because a column
 *   does not un-add itself.
 *
 * THE 42703 RETRY BELOW IS DELIBERATELY KEPT. It is not the banner and it is not dead
 * code: a PostgREST select naming a column that is absent fails the WHOLE query rather
 * than omitting the column, so the guard is what stands between a rolled-back 086 and a
 * roster page that renders nothing at all. It costs one extra round trip in a case that
 * should never happen, and it now logs instead of rendering.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AgencyShell } from "@/components/agency-layout"
import { createClient } from "@/lib/supabase/client"
import { resolveActingOrgId } from "@/lib/acting-org"

type RosterMember = {
  membershipId: string
  userId: string
  role: string
  joinedAt: string | null
  fullName: string | null
  displayName: string | null
  email: string | null
  title: string | null
  isPrimaryContact: boolean
  isYou: boolean
}

/**
 * Date-only display, "Aug 18, 2026".
 *
 * Local rather than imported. CLAUDE.md and LIGAMENT_CONTEXT.md both instruct that
 * `formatDate()` from lib/utils.ts be used for date-only display, and THAT FUNCTION DOES
 * NOT EXIST - lib/utils.ts exports formatDateTime, formatSubmittedAt and
 * formatRelativeTime and nothing else. The format below is character for character the
 * date half of formatSubmittedAt(), so it agrees with every other date in the product.
 * Reported in docs/m1-foundation-report.md rather than fixed by adding an export, which
 * would be a change to a shared module for one page's benefit.
 */
function formatJoinedDate(iso: string | null | undefined): string {
  if (!iso) return "-"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

export default function AgencyTeamRosterPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [members, setMembers] = useState<RosterMember[]>([])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        router.push("/auth/login?redirect=%2Fagency%2Fsettings%2Fteam")
        return
      }

      // The acting organization, resolved server-side style: membership is read from
      // org_members keyed by this user id, and nothing here supplies an organization id.
      // Same resolver the write path uses, so the roster can never show a company the
      // caller could not write to.
      const acting = await resolveActingOrgId(user.id, supabase)
      if (!acting.orgId) {
        if (cancelled) return
        setErrorMessage(
          acting.reason === "ambiguous"
            ? "Your account belongs to more than one organization and none is selected. Contact support."
            : "Your account is not linked to an organization yet. Contact support."
        )
        setIsLoading(false)
        return
      }
      const orgId = acting.orgId

      const [orgResult, memberResult] = await Promise.all([
        supabase.from("organizations").select("name, primary_contact_user_id").eq("id", orgId).maybeSingle(),
        supabase.from("org_members").select("id, user_id, role, created_at").eq("org_id", orgId),
      ])

      if (memberResult.error) {
        console.error("[agency/settings/team] roster read failed", {
          orgId,
          code: memberResult.error.code,
          message: memberResult.error.message,
        })
        if (cancelled) return
        setErrorMessage("Could not load your team. Please retry.")
        setIsLoading(false)
        return
      }

      const rows = (memberResult.data ?? []) as Array<{
        id: string
        user_id: string
        role: string | null
        created_at: string | null
      }>
      const userIds = rows.map((r) => r.user_id).filter(Boolean)

      // 086 GUARD, KEPT AFTER 086 WAS APPLIED. profiles.title exists now, so this branch
      // should never be taken. It stays because a PostgREST select naming a missing column
      // fails the WHOLE query with 42703 rather than omitting that column, so without it a
      // rolled-back 086 takes the entire roster down rather than one column of it. Same
      // shape of guard migration 074's response_deadline already uses in this codebase.
      // It logs rather than telling the user about a migration they cannot act on.
      let profileRows: Array<Record<string, unknown>> = []
      if (userIds.length > 0) {
        const withTitle = await supabase
          .from("profiles")
          .select("id, full_name, display_name, email, title")
          .in("id", userIds)
        if (withTitle.error?.code === "42703") {
          console.error("[agency/settings/team] profiles.title missing, retrying without it")
          const withoutTitle = await supabase
            .from("profiles")
            .select("id, full_name, display_name, email")
            .in("id", userIds)
          profileRows = (withoutTitle.data ?? []) as Array<Record<string, unknown>>
        } else if (withTitle.error) {
          console.error("[agency/settings/team] profile read failed", {
            code: withTitle.error.code,
            message: withTitle.error.message,
          })
        } else {
          profileRows = (withTitle.data ?? []) as Array<Record<string, unknown>>
        }
      }

      const byId = new Map<string, Record<string, unknown>>()
      for (const p of profileRows) {
        const id = p.id
        if (typeof id === "string") byId.set(id, p)
      }

      const primaryContactUserId =
        (orgResult.data as { primary_contact_user_id?: string | null } | null)?.primary_contact_user_id ?? null

      // Deduplicate by membership id at render level, per the house rule. org_members carries
      // UNIQUE(org_id, user_id) so a duplicate should be impossible, which is precisely why a
      // duplicate appearing here would be worth not rendering twice.
      const seen = new Set<string>()
      const roster: RosterMember[] = []
      for (const row of rows) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        const p = byId.get(row.user_id) ?? {}
        roster.push({
          membershipId: row.id,
          userId: row.user_id,
          role: (row.role || "member").toLowerCase(),
          joinedAt: row.created_at,
          fullName: (p.full_name as string | null) ?? null,
          displayName: (p.display_name as string | null) ?? null,
          email: (p.email as string | null) ?? null,
          title: (p.title as string | null) ?? null,
          isPrimaryContact: Boolean(primaryContactUserId && primaryContactUserId === row.user_id),
          isYou: row.user_id === user.id,
        })
      }

      // Owner first, then admin, then member, then by join date. A roster that reorders
      // itself between loads is a roster nobody can scan.
      const rank = (r: string) => (r === "owner" ? 0 : r === "admin" ? 1 : 2)
      roster.sort((a, b) => {
        const byRole = rank(a.role) - rank(b.role)
        if (byRole !== 0) return byRole
        return (a.joinedAt || "").localeCompare(b.joinedAt || "")
      })

      if (cancelled) return
      setOrgName((orgResult.data as { name?: string | null } | null)?.name ?? null)
      setMembers(roster)
      setIsLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [router])

  // House rule: never render an empty or error state during hydration. Nothing below this
  // line runs until the load has settled one way or the other.
  if (isLoading) {
    return (
      <AgencyShell>
        <div className="p-8 text-foreground-muted">Loading your team...</div>
      </AgencyShell>
    )
  }

  return (
    <AgencyShell>
      <div className="p-8 max-w-4xl space-y-6">
        <div>
          {/*
            WHERE THE INVITE BUTTON GOES. Right here, to the right of this header, as a
            primary button reading "Invite colleague". It is not rendered because who may
            send an invitation is unruled - see the file header.
          */}
          <h1 className="font-display font-bold text-3xl text-foreground">Team</h1>
          <p className="text-foreground-muted mt-1">
            {orgName ? `Everyone at ${orgName}.` : "Everyone in your organization."} View only for now.
          </p>
        </div>

        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        {!errorMessage && (
          <div className="bg-white/5 border border-border/40 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="font-mono text-2xs uppercase text-foreground-muted px-6 py-3">Person</th>
                    <th className="font-mono text-2xs uppercase text-foreground-muted px-6 py-3">Title</th>
                    <th className="font-mono text-2xs uppercase text-foreground-muted px-6 py-3">Role</th>
                    <th className="font-mono text-2xs uppercase text-foreground-muted px-6 py-3">Joined</th>
                    {/*
                      WHERE THE REMOVE BUTTON GOES. A fifth column here, right aligned, one
                      row action reading "Remove". It is not rendered because what happens to
                      a removed member's created records is unruled - see the file header.
                    */}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const name = (m.displayName || m.fullName || "").trim()
                    return (
                      <tr key={m.membershipId} className="border-b border-border/20 last:border-b-0">
                        <td className="px-6 py-4">
                          <div className="font-display font-bold text-sm text-foreground">
                            {name || m.email || "Unnamed member"}
                            {m.isYou && <span className="ml-2 font-mono text-2xs uppercase text-foreground-muted">You</span>}
                          </div>
                          {m.email && <div className="text-xs text-foreground-muted mt-0.5">{m.email}</div>}
                          {m.isPrimaryContact && (
                            <div className="mt-1 inline-block font-mono text-2xs uppercase text-emerald-300">
                              Primary contact
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-foreground">{m.title?.trim() || "-"}</td>
                        <td className="px-6 py-4 text-sm text-foreground">{ROLE_LABEL[m.role] || m.role}</td>
                        <td className="px-6 py-4 text-sm text-foreground">
                          {formatJoinedDate(m.joinedAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs text-foreground-muted">
          Roles and titles are set when a colleague joins. Inviting and removing colleagues is
          not available yet.
        </p>
      </div>
    </AgencyShell>
  )
}
