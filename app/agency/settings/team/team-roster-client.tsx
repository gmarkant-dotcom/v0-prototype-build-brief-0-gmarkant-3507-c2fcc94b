"use client"

/**
 * The team roster, and - as of migration 089 - the invitation surface beside it.
 * THE CLIENT HALF.
 *
 * page.tsx beside this file is a SERVER component and it reads the COLLEAGUE_INVITATIONS
 * flag, passing it in as `invitationsEnabled`. The split exists for that reason and no
 * other: a client component cannot read a server-side env var, and making the variable
 * NEXT_PUBLIC_ to avoid the split would put the flag's value in the browser bundle and stop
 * it being a server flag at all.
 *
 * WITH THE FLAG OFF THIS PAGE IS EXACTLY WHAT IT WAS BEFORE 089 - a read-only roster. No
 * invite button, no invite form, no pending list, no past list. The roster itself is never
 * gated: reading who is in your organization needed no ruling and needs no flag.
 *
 * WHAT CHANGED, AND WHAT THE OLD HEADER SAID ABOUT IT. This file used to say the invite
 * button "needs Greg's calls 1, 2 and 9" and was deliberately not rendered, with a comment
 * marking where it would go. Two of those three are now answered by the schema rather than
 * by a ruling:
 *
 *   CALL 1, which roles exist. Answered: org_members.role and org_invitations.role carry
 *   the IDENTICAL CHECK (role IN ('owner','admin','member')). The role select offers those
 *   three because they are what the database accepts, which is not a product decision being
 *   made here.
 *
 *   CALL 9, emailed token or email domain. Answered by migration 086's table shape: a token,
 *   an address and an expiry. There is no domain-join column and never was.
 *
 *   CALL 2, who may send one, IS STILL OPEN in one respect and it is flagged rather than
 *   settled. The capability map says org.member_invite: 'admin' and org.member_revoke:
 *   'owner'. This page and the routes behind it let an OWNER OR ADMIN do both, because
 *   org.member_revoke is about removing a MEMBER - taking a colleague's live access away -
 *   and not about withdrawing an invitation nobody has accepted. An admin who can send one
 *   should be able to take it back; the alternative is an admin creating a pending
 *   invitation only the owner can undo. Written up in docs/089-invitation-session-report.md
 *   as a question, not treated as answered.
 *
 * THE REMOVE BUTTON IS STILL NOT RENDERED. Call 3 - what happens to a removed member's
 * created records: attribution stays, nulls, or is reassigned - is genuinely unruled, and
 * removing somebody before it is ruled is the one action on this page that cannot be undone
 * by clicking again. Its place is still marked in the row actions column.
 *
 * ---------------------------------------------------------------------------
 * ROLE IS READ FROM org_members, NOT FROM can().
 *
 * lib/capabilities.ts orgRoleFor() returns "owner" for EVERY caller and its own header
 * (:236-240) says that stops being true "the moment anything can add a SECOND member to an
 * organization - that is org_invitations and the membership interface". THIS IS THAT MOMENT.
 * So this page calls loadOrgRole(), which was written and deliberately left unused waiting
 * for exactly this, rather than can(profile, "org.member_invite"), which would show the
 * invite form to every caller including a plain member the database will then refuse.
 *
 * ---------------------------------------------------------------------------
 * 086 IS APPLIED. Both of the pieces this page waited on are live: profiles.title and the
 * org_members SELECT policy "Members read their organization roster".
 *
 * THE MISSING-TITLE AND ROSTER-OF-ONE BANNERS ARE STILL GONE, and the reasons still hold:
 * the old roster-of-one banner was unconditional on the row count, so it asserted something
 * false to every solo member, and it named an internal migration number in copy no customer
 * can act on. What replaces it below is CONDITIONED ON members.length === 1 and names no
 * migration - a line that says you are the only person here and offers the thing that
 * changes that. That is the half of the old banner worth keeping.
 *
 * THE 42703 RETRY BELOW IS DELIBERATELY KEPT. It is not the banner and it is not dead
 * code: a PostgREST select naming a column that is absent fails the WHOLE query rather
 * than omitting the column, so the guard is what stands between a rolled-back 086 and a
 * roster page that renders nothing at all. It costs one extra round trip in a case that
 * should never happen, and it logs instead of rendering.
 */

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AgencyShell } from "@/components/agency-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { resolveActingOrgId } from "@/lib/acting-org"
import { loadOrgRole, type OrgRole } from "@/lib/capabilities"
import { formatDateTime } from "@/lib/utils"
import {
  INVITATION_STATUS_LABEL,
  INVITABLE_ROLES,
  ROLE_LABEL,
  type InvitableRole,
  type InvitationStatus,
} from "@/lib/org-invitations"

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

type PendingInvitation = {
  id: string
  email: string
  role: string
  status: string
  expiresAt: string | null
  createdAt: string | null
  /**
   * Whether expires_at had passed AT THE MOMENT THIS LIST WAS FETCHED.
   *
   * Computed here and not in the row, because Date.now() during render is an impure call
   * and React's own lint rule refuses it - two renders of the same list could disagree
   * about the same row. Fetch time is the honest reading anyway: this column reflects one
   * read of the database, and the way to refresh it is to refresh the list.
   */
  lapsed: boolean
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

export default function AgencyTeamRosterClient({
  /**
   * COLLEAGUE_INVITATIONS, resolved server-side in page.tsx. Absent means off.
   *
   * It gates the AFFORDANCE, not the data. The pending-invitation read below still runs
   * when it is false, because "Org admins read their invitations" has been live since 086
   * and a flag that changed what the database returns would be a different kind of thing
   * entirely. What the flag decides is whether any of it is rendered or actionable.
   */
  invitationsEnabled,
}: {
  invitationsEnabled: boolean
}) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [members, setMembers] = useState<RosterMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [callerRole, setCallerRole] = useState<OrgRole | null>(null)

  // Invite form
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<InvitableRole>("member")
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  /**
   * Reads the invitations for one organization.
   *
   * Straight off the browser client, per CLAUDE.md's preference for fetching from the
   * component. The only thing that admits this read is migration 086's "Org admins read
   * their invitations" policy, org_id IN (SELECT current_user_admin_org_ids()) - so a plain
   * member gets an empty list rather than an error, and that is the correct shape: the
   * invitation surface simply is not theirs.
   */
  const loadInvitations = useCallback(async (targetOrgId: string) => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("org_invitations")
      .select("id, email, role, status, expires_at, created_at")
      .eq("org_id", targetOrgId)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[agency/settings/team] invitation read failed", {
        code: error.code,
        message: error.message,
      })
      return [] as PendingInvitation[]
    }

    const rows = (data ?? []) as Array<{
      id: string
      email: string | null
      role: string | null
      status: string | null
      expires_at: string | null
      created_at: string | null
    }>

    // Deduplicate by invitation id, per the house rule, at the point the list is built.
    const seen = new Set<string>()
    const fetchedAt = Date.now()
    const out: PendingInvitation[] = []
    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push({
        id: row.id,
        email: row.email || "",
        role: (row.role || "member").toLowerCase(),
        status: (row.status || "pending").toLowerCase(),
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        lapsed: row.expires_at ? new Date(row.expires_at).getTime() <= fetchedAt : false,
      })
    }
    return out
  }, [])

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
      const actingOrgId = acting.orgId

      const [orgResult, memberResult, role, invites] = await Promise.all([
        supabase.from("organizations").select("name, primary_contact_user_id").eq("id", actingOrgId).maybeSingle(),
        supabase.from("org_members").select("id, user_id, role, created_at").eq("org_id", actingOrgId),
        loadOrgRole(user.id, actingOrgId, supabase),
        loadInvitations(actingOrgId),
      ])

      if (memberResult.error) {
        console.error("[agency/settings/team] roster read failed", {
          orgId: actingOrgId,
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
      setOrgId(actingOrgId)
      setOrgName((orgResult.data as { name?: string | null } | null)?.name ?? null)
      setMembers(roster)
      setCallerRole(role)
      setInvitations(invites)
      setIsLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [router, loadInvitations])

  // BOTH conditions, and they answer different questions. `invitationsEnabled` is whether
  // this product surface exists yet; `callerRole` is whether THIS person may use it. A flag
  // is not a permission and a permission is not a flag.
  const mayInvite = invitationsEnabled && (callerRole === "owner" || callerRole === "admin")

  const submitInvite = useCallback(async () => {
    setInviteBusy(true)
    setInviteError(null)
    setInviteNotice(null)
    try {
      const res = await fetch("/api/org/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setInviteError(typeof body.error === "string" ? body.error : "Could not send that invitation.")
        return
      }
      // email_sent is reported rather than assumed. A Resend outage does not undo an
      // invitation that already exists, and telling somebody an email went when it did not
      // is how an invitation sits unanswered for a week.
      setInviteNotice(
        body.email_sent === true
          ? `Invitation sent to ${inviteEmail.trim()}.`
          : `Invitation created for ${inviteEmail.trim()}, but the email could not be sent. Ask them to check back, or revoke and try again.`
      )
      setInviteEmail("")
      setInviteRole("member")
      setInviteOpen(false)
      if (orgId) setInvitations(await loadInvitations(orgId))
    } catch (e) {
      console.error("[agency/settings/team] invite failed", e)
      setInviteError("Could not send that invitation. Please retry.")
    } finally {
      setInviteBusy(false)
    }
  }, [inviteEmail, inviteRole, orgId, loadInvitations])

  const revoke = useCallback(
    async (invitationId: string) => {
      setRevokingId(invitationId)
      setInviteError(null)
      setInviteNotice(null)
      try {
        const res = await fetch("/api/org/invitations/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invitationId }),
        })
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) {
          setInviteError(typeof body.error === "string" ? body.error : "Could not revoke that invitation.")
          return
        }
        if (orgId) setInvitations(await loadInvitations(orgId))
      } catch (e) {
        console.error("[agency/settings/team] revoke failed", e)
        setInviteError("Could not revoke that invitation. Please retry.")
      } finally {
        setRevokingId(null)
      }
    },
    [orgId, loadInvitations]
  )

  // House rule: never render an empty or error state during hydration. Nothing below this
  // line runs until the load has settled one way or the other.
  if (isLoading) {
    return (
      <AgencyShell>
        <div className="p-8 text-foreground-muted">Loading your team...</div>
      </AgencyShell>
    )
  }

  const pending = invitations.filter((i) => i.status === "pending")
  const resolved = invitations.filter((i) => i.status !== "pending")

  return (
    <AgencyShell>
      <div className="p-8 max-w-4xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl text-foreground">Team</h1>
            <p className="text-foreground-muted mt-1">
              {orgName ? `Everyone at ${orgName}.` : "Everyone in your organization."}
            </p>
          </div>
          {/*
            THE INVITE BUTTON. Shown only to a caller whose org_members.role really is owner
            or admin - see the file header for why that is loadOrgRole() and not can().
          */}
          {mayInvite && !inviteOpen && (
            <Button onClick={() => setInviteOpen(true)}>Invite colleague</Button>
          )}
        </div>

        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        {inviteNotice && (
          <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 text-sm text-emerald-200">
            {inviteNotice}
          </div>
        )}

        {mayInvite && inviteOpen && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div>
              <h2 className="font-display font-bold text-lg text-foreground">Invite a colleague</h2>
              <p className="text-foreground-muted text-sm mt-1">
                They get an email with a link that is good for seven days. Accepting adds them
                to {orgName || "this organization"}.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="block font-mono text-2xs uppercase tracking-wider text-foreground-muted mb-2">
                  Email address
                </label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@yourcompany.com"
                  className="bg-white/5 border-border/30 text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              <div>
                <label className="block font-mono text-2xs uppercase tracking-wider text-foreground-muted mb-2">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as InvitableRole)}
                  className="h-9 rounded-md border border-border/30 bg-white/5 px-3 text-sm text-foreground"
                >
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r} className="bg-card text-foreground">
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {inviteError && (
              <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-sm text-red-200">
                {inviteError}
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={submitInvite} disabled={inviteBusy || !inviteEmail.trim()}>
                {inviteBusy ? "Sending..." : "Send invitation"}
              </Button>
              <Button
                variant="ghost"
                disabled={inviteBusy}
                onClick={() => {
                  setInviteOpen(false)
                  setInviteError(null)
                }}
              >
                Cancel
              </Button>
            </div>
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
                        <td className="px-6 py-4 text-sm text-foreground">
                          {ROLE_LABEL[m.role as InvitableRole] || m.role}
                        </td>
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

        {/*
          THE ROSTER OF ONE, SAID IN THE INTERFACE RATHER THAN LEFT TO LOOK CORRECT.

          The 086 precedent, minus both things that were wrong with the banner it replaces:
          that one was unconditional on the row count, so it told all sixteen solo accounts
          something false, and it named a migration number no customer can act on. This is
          conditioned on exactly one member and names nothing internal.

          It matters because a roster of one and a roster whose read was filtered look
          identical, and a page that shows one row with no comment is asking the reader to
          assume which of those they are looking at.
        */}
        {!errorMessage && members.length === 1 && pending.length === 0 && (
          <div className="rounded-xl border border-border/40 bg-white/5 p-4">
            <p className="text-sm text-foreground">
              You are the only person on this team.
              {mayInvite
                ? " Invite a colleague and they will appear here once they accept."
                : invitationsEnabled
                  ? " Ask an owner or admin to invite your colleagues."
                  : ""}
            </p>
          </div>
        )}

        {/* PENDING INVITATIONS. Only an owner or admin can see this - the read is admitted
            by "Org admins read their invitations", so a member gets an empty list. */}
        {invitationsEnabled && pending.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-display font-bold text-lg text-foreground">Pending invitations</h2>
            <div className="bg-white/5 border border-border/40 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="font-mono text-2xs uppercase text-foreground-muted px-6 py-3">Address</th>
                      <th className="font-mono text-2xs uppercase text-foreground-muted px-6 py-3">Role</th>
                      <th className="font-mono text-2xs uppercase text-foreground-muted px-6 py-3">Expires</th>
                      <th className="font-mono text-2xs uppercase text-foreground-muted px-6 py-3 text-right">
                        {mayInvite ? "Action" : ""}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((inv) => {
                      return (
                        <tr key={inv.id} className="border-b border-border/20 last:border-b-0">
                          <td className="px-6 py-4 text-sm text-foreground break-all">{inv.email}</td>
                          <td className="px-6 py-4 text-sm text-foreground">
                            {ROLE_LABEL[inv.role as InvitableRole] || inv.role}
                          </td>
                          <td className="px-6 py-4 text-sm text-foreground">
                            {/*
                              A LAPSED ROW STILL READS 'pending' ON DISK, and saying so is
                              better than showing a date and letting the reader work it out.
                              Nothing sweeps this column on a schedule: the stamp is written
                              by the create route, at the moment somebody re-invites this
                              same address, because that is the only moment the stale row is
                              felt (it blocks the partial unique index).
                            */}
                            {inv.lapsed ? "Lapsed" : formatDateTime(inv.expiresAt)}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {mayInvite && (
                              <Button
                                variant="destructive-outline"
                                size="sm"
                                disabled={revokingId === inv.id}
                                onClick={() => revoke(inv.id)}
                              >
                                {revokingId === inv.id ? "Revoking..." : "Revoke"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Resolved invitations, most recent first. Kept visible because 'revoked' and
            'declined' are different answers and the pending list would lie if they were
            collapsed - which is exactly why migration 089 added 'declined' as its own
            status rather than reusing 'revoked'. */}
        {invitationsEnabled && resolved.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-display font-bold text-lg text-foreground">Past invitations</h2>
            <div className="bg-white/5 border border-border/40 rounded-xl divide-y divide-border/20">
              {resolved.map((inv) => (
                <div key={inv.id} className="px-6 py-3 flex items-center justify-between gap-4">
                  <span className="text-sm text-foreground break-all">{inv.email}</span>
                  <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">
                    {INVITATION_STATUS_LABEL[inv.status as InvitationStatus] || inv.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-foreground-muted">
          {invitationsEnabled
            ? "Roles and titles are set when a colleague joins. Removing a colleague is not available yet."
            : "Roles and titles are set when a colleague joins. Inviting and removing colleagues is not available yet."}
        </p>
      </div>
    </AgencyShell>
  )
}
