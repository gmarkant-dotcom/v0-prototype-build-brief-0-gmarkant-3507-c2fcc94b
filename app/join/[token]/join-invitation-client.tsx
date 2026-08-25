"use client"

/**
 * /join/<token> - where a colleague invitation lands. THE CLIENT HALF.
 *
 * page.tsx beside this file is a SERVER component and it is the feature gate: it reads
 * COLLEAGUE_INVITATIONS through lib/feature-flags.ts and calls notFound() when the flag is
 * off. The split exists for that reason and no other - a client component cannot read a
 * server-side env var, and making the variable NEXT_PUBLIC_ to avoid the split would put
 * the flag's value in the browser bundle and stop it being a server flag at all.
 *
 * =====================================================================
 * WHY THIS IS NOT /partner/invitations, WHICH ALREADY EXISTS
 * =====================================================================
 *
 * /partner/invitations is the live call to action of the VENDOR partnership emails and it
 * is load-bearing in five places: app/api/partnerships/route.ts:590, :591, :723 and :724,
 * app/api/agency/pool/resend-invitation/route.ts:63, lib/notifications.ts:318, and - the one
 * that would hurt most - app/auth/callback/route.ts:260 and :308, where it is the DEFAULT
 * POST-LOGIN DESTINATION for a partner with no explicit `next`. The page itself
 * (app/partner/invitations/page.tsx) is a redirect stub to /partner/network.
 *
 * Repurposing it would send every vendor accepting a partnership, and every partner logging
 * in without a `next`, into a colleague-invitation screen. Those are different invitations:
 * one invites a COMPANY into a commercial relationship, the other invites a PERSON into your
 * own organization. So this is a new path.
 *
 * =====================================================================
 * WHY /join AND NOT /agency/... OR /partner/...
 * =====================================================================
 *
 * A colleague invitation is portal-neutral - an agency admin may invite somebody whose
 * account is a vendor account, and vice versa - and middleware.ts bounces /agency to
 * /partner and back based on active_role, which would ping-pong an invitee whose portal
 * does not match. A top-level path is subject to neither redirect.
 *
 * IT NEEDS NO MIDDLEWARE CHANGE, AND MIDDLEWARE WAS NOT TOUCHED. The matcher at
 * middleware.ts:153 matches everything except _next, favicon, images and api/, and /join is
 * not in `publicPaths`, so an unauthenticated visitor is redirected to
 * /auth/login?next=/join/<token> - `next` is in the passthrough list at :37 and is honoured
 * by both app/auth/login/page.tsx:16 and app/auth/callback/route.ts:217. So the sign-in
 * round trip lands back here on its own.
 *
 * =====================================================================
 * WHAT THIS PAGE CANNOT SHOW, AND WHY IT IS NOT A BUG IN THIS FILE
 * =====================================================================
 *
 * IT CANNOT NAME THE COMPANY BEFORE YOU ACCEPT. `organizations` carries two SELECT policies
 * (079:1748 and 079:1794): members read their own organizations, and members read
 * COUNTERPARTY organizations. An invitee is neither - that is the entire premise of an
 * invitation - so the row is filtered out and comes back as null at HTTP 200, not as an
 * error. The same is true of the inviter's profiles row.
 *
 * This was NOT fixed by widening a policy. A policy blocking a surface is a finding to
 * report, not a licence to loosen one, and "let a token holder read an organization's name"
 * is a disclosure decision that belongs to Greg and not to this file. It is written up as an
 * open item in docs/089-invitation-session-report.md with the remedy spelled out.
 *
 * What closes the gap in practice today: the EMAIL the invitee is holding names the company
 * in its subject line and its first sentence, and accept_org_invitation() returns org_name,
 * so the confirmation names it too. The only unnamed moment is this screen.
 */

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { LigamentLogo } from "@/components/ligament-logo"
import { HolographicBlobs } from "@/components/holographic-blobs"
import { formatDateTime } from "@/lib/utils"
import {
  INVITATION_STATUS_LABEL,
  ROLE_LABEL,
  isInvitableRole,
  type InvitationStatus,
} from "@/lib/org-invitations"

type LoadedInvitation = {
  id: string
  role: string
  status: string
  email: string
  expiresAt: string | null
  /**
   * Whether expires_at had passed WHEN THIS PAGE LOADED. Computed in the effect and not in
   * the render body: Date.now() during render is an impure call, and this codebase's lint
   * rule refuses it because two renders of the same state could disagree.
   *
   * The database is the authority regardless - accept_org_invitation() re-checks expiry
   * inside its own transaction and raises LG004, so a page that has been open long enough
   * for the invitation to lapse under it gets a clean refusal rather than a wrong join.
   */
  lapsed: boolean
}

type Outcome =
  | {
      kind: "accepted"
      orgId: string | null
      orgName: string | null
      role: string | null
      alreadyMember: boolean
      membershipCount: number | null
      /**
       * The organization this account will actually write to, as resolveActingOrgId()
       * answers it server-side. Null means it could not be resolved and writes WILL be
       * refused. Equal to orgId means they are acting for the organization just joined.
       */
      actingOrgId: string | null
    }
  | { kind: "declined"; orgName: string | null }

export default function JoinInvitationClient() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === "string" ? params.token : ""

  const [isLoading, setIsLoading] = useState(true)
  const [invitation, setInvitation] = useState<LoadedInvitation | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!token) {
        if (!cancelled) {
          setLoadError("That invitation could not be found.")
          setIsLoading(false)
        }
        return
      }

      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        // Middleware normally gets here first. This is the case where the session lapsed
        // between the request and this effect.
        router.push(`/auth/login?next=${encodeURIComponent(`/join/${token}`)}`)
        return
      }

      // Filtered by token AND, invisibly, by migration 089's "Invitees read their own
      // invitation" policy, which requires lower(btrim(email)) to equal the caller's own
      // profiles.email. So holding the token is not enough: the row is only visible to the
      // person it names. Before 089 is applied this returns null for everyone, because the
      // table's only policy is the admin read - an empty result, not an error, which is
      // exactly the failure mode 089's header calls out.
      const { data, error } = await supabase
        .from("org_invitations")
        .select("id, role, status, email, expires_at")
        .eq("token", token)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        console.error("[join] invitation read failed", { code: error.code, message: error.message })
        setLoadError("Could not load that invitation. Please retry.")
        setIsLoading(false)
        return
      }

      if (!data) {
        // The same copy a nonexistent token gets, deliberately. "No such invitation" and
        // "that invitation is not yours" are one refusal - the difference between them
        // confirms whether an address was invited.
        setLoadError("That invitation could not be found.")
        setIsLoading(false)
        return
      }

      const row = data as {
        id: string
        role: string | null
        status: string | null
        email: string | null
        expires_at: string | null
      }
      setInvitation({
        id: row.id,
        role: (row.role || "member").toLowerCase(),
        status: (row.status || "pending").toLowerCase(),
        email: row.email || "",
        expiresAt: row.expires_at,
        lapsed: row.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : false,
      })
      setIsLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [token, router])

  const respond = useCallback(
    async (action: "accept" | "decline") => {
      setBusy(action)
      setActionError(null)
      try {
        const res = await fetch(`/api/org/invitations/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) {
          setActionError(
            typeof body.error === "string" ? body.error : "Could not respond to that invitation."
          )
          return
        }
        if (action === "accept") {
          setOutcome({
            kind: "accepted",
            orgId: typeof body.orgId === "string" ? body.orgId : null,
            orgName: typeof body.orgName === "string" ? body.orgName : null,
            role: typeof body.role === "string" ? body.role : null,
            alreadyMember: body.alreadyMember === true,
            membershipCount: typeof body.membershipCount === "number" ? body.membershipCount : null,
            actingOrgId: typeof body.actingOrgId === "string" ? body.actingOrgId : null,
          })
        } else {
          setOutcome({
            kind: "declined",
            orgName: typeof body.orgName === "string" ? body.orgName : null,
          })
        }
      } catch (e) {
        console.error("[join] respond failed", e)
        setActionError("Could not respond to that invitation. Please retry.")
      } finally {
        setBusy(null)
      }
    },
    [token]
  )

  // House rule: never render an empty or error state during hydration. Nothing below this
  // line runs until the load has settled one way or the other.
  if (isLoading) {
    return (
      <Shell>
        <p className="text-foreground-muted text-sm text-center">Loading your invitation...</p>
      </Shell>
    )
  }

  if (outcome?.kind === "accepted") {
    const where = outcome.orgName ? outcome.orgName : "your new team"
    return (
      <Shell>
        <h1 className="font-display font-black text-2xl text-foreground mb-2 text-center">
          {outcome.alreadyMember ? `You are already on ${where}` : `Welcome to ${where}`}
        </h1>
        <p className="text-foreground-muted text-sm text-center mb-6">
          {outcome.alreadyMember
            ? "This invitation is now closed. Nothing changed - you were already a member."
            : `You joined as ${labelForRole(outcome.role)}.`}
        </p>

        {/*
          THE MULTI-ORGANIZATION NOTE, AND WHY IT IS THREE BRANCHES RATHER THAN ONE.

          WHAT USED TO BE HERE, AND WHY IT WAS WRONG. A single amber warning fired on
          `membershipCount > 1` and told the accepter that Ligament could not tell which
          organization they were working as, that creating and editing records would be
          refused, and to contact support. That copy was written during the 089 session,
          when profiles.active_org_id did not exist as a column and the claim was true.
          Migration 090 added the column, made accept_org_invitation() initialize it to the
          inviting organization when it is NULL, and shipped the switcher - and nobody made
          the message conditional on any of it. Because EVERY accepter has at least their own
          signup organization, `membershipCount > 1` is true for every accept there has ever
          been, so all three claims were being shown to everybody and all three were false.

          A MEMBERSHIP COUNT CANNOT ANSWER THIS. Belonging to two organizations is the
          ordinary state now; it is not what refuses a write. The route therefore reports
          `actingOrgId` from resolveActingOrgId() - the same module every acting-org write
          path consults - and the three states it can be in are genuinely different things
          to say:

            acting == the org just joined   the normal accept. Nothing is wrong, and this
                                            is information, not a warning.
            acting == some other org        they had already chosen an organization, and
                                            090's set-if-null deliberately did not overrule
                                            it. Records would be filed somewhere other than
                                            where they think.
            acting == null                  "ambiguous" or "preference-refused". This is the
                                            state the old copy described, and it is the only
                                            one that earns the amber and the warning.

          The switcher this points at renders in the sidebar account menu of both portals
          (agency-layout.tsx:719, partner-layout.tsx:234) and it renders exactly when a
          caller has two or more memberships, which is exactly when this note renders. So
          the control it names is always there when it is named.
        */}
        {outcome.membershipCount !== null && outcome.membershipCount > 1 && (
          outcome.actingOrgId === null ? (
            <div className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <p className="text-sm text-foreground">
                Your account now belongs to more than one organization and none of them is
                selected, so creating and editing records will be refused. Choose the one you
                want to work in from the account menu in the sidebar.
              </p>
            </div>
          ) : outcome.orgId === null ? (
            /* The RPC did not name the organization it just joined us to, so there is
               nothing to compare the acting organization against. Say only the part that
               is true either way rather than guessing which one they are working as. */
            <div className="mb-6 rounded-lg border border-border/30 bg-white/5 p-4">
              <p className="text-sm text-foreground">
                Your account now belongs to more than one organization. You can choose which
                one you are working in from the account menu in the sidebar.
              </p>
            </div>
          ) : outcome.actingOrgId === outcome.orgId ? (
            <div className="mb-6 rounded-lg border border-border/30 bg-white/5 p-4">
              <p className="text-sm text-foreground">
                Your account now belongs to more than one organization. You are working as
                {" "}{where}, so anything you create will be filed there. You can change
                organization from the account menu in the sidebar.
              </p>
            </div>
          ) : (
            <div className="mb-6 rounded-lg border border-border/30 bg-white/5 p-4">
              <p className="text-sm text-foreground">
                Your account now belongs to more than one organization. You are still working
                as the one you had already selected, so anything you create will be filed
                there rather than in {where}. You can change organization from the account
                menu in the sidebar.
              </p>
            </div>
          )
        )}

        <div className="flex justify-center">
          <Link href="/">
            <Button>Go to Ligament</Button>
          </Link>
        </div>
      </Shell>
    )
  }

  if (outcome?.kind === "declined") {
    return (
      <Shell>
        <h1 className="font-display font-black text-2xl text-foreground mb-2 text-center">
          Invitation declined
        </h1>
        <p className="text-foreground-muted text-sm text-center mb-6">
          {outcome.orgName
            ? `We have let ${outcome.orgName} know you are not joining. Nothing else about your account changed.`
            : "Nothing about your account changed."}
        </p>
        <div className="flex justify-center">
          <Link href="/">
            <Button variant="secondary">Back to Ligament</Button>
          </Link>
        </div>
      </Shell>
    )
  }

  if (loadError || !invitation) {
    return (
      <Shell>
        <h1 className="font-display font-black text-2xl text-foreground mb-2 text-center">
          Invitation unavailable
        </h1>
        <p className="text-foreground-muted text-sm text-center mb-6">
          {loadError ?? "That invitation could not be found."}
        </p>
        <p className="text-foreground-muted text-xs text-center mb-6">
          If you were expecting this, check that you are signed in with the address the
          invitation was sent to.
        </p>
        <div className="flex justify-center">
          <Link href="/">
            <Button variant="secondary">Back to Ligament</Button>
          </Link>
        </div>
      </Shell>
    )
  }

  const expired = invitation.lapsed
  const resolved = invitation.status !== "pending"

  if (expired || resolved) {
    return (
      <Shell>
        <h1 className="font-display font-black text-2xl text-foreground mb-2 text-center">
          {expired ? "This invitation has expired" : "This invitation is closed"}
        </h1>
        <p className="text-foreground-muted text-sm text-center mb-6">
          {expired
            ? "Ask whoever invited you to send a new one. It only takes them a moment."
            : `It was ${statusSentence(invitation.status)}.`}
        </p>
        <div className="flex justify-center">
          <Link href="/">
            <Button variant="secondary">Back to Ligament</Button>
          </Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="font-display font-black text-2xl text-foreground mb-2 text-center">
        You have been invited to join a team
      </h1>
      <p className="text-foreground-muted text-sm text-center mb-6">
        The email you received names the company. Accepting adds your account to their
        Ligament workspace as {labelForRole(invitation.role)}.
      </p>

      <div className="rounded-lg border border-border/30 bg-white/5 p-4 mb-6 space-y-2">
        <Row label="Invited address" value={invitation.email} />
        <Row label="Your role" value={ROLE_LABEL[normalizeRole(invitation.role)]} />
        {invitation.expiresAt && (
          <Row label="Expires" value={formatDateTime(invitation.expiresAt)} />
        )}
      </div>

      {actionError && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
          <p className="text-sm text-red-200">{actionError}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button className="flex-1" disabled={busy !== null} onClick={() => respond("accept")}>
          {busy === "accept" ? "Joining..." : "Accept and join"}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          disabled={busy !== null}
          onClick={() => respond("decline")}
        >
          {busy === "decline" ? "Declining..." : "Decline"}
        </Button>
      </div>

      <p className="text-foreground-muted text-xs text-center mt-4">
        Declining tells them you are not joining and changes nothing else about your account.
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <HolographicBlobs />
      <div className="w-full max-w-md mx-4 relative z-10">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <LigamentLogo size="md" variant="primary" />
          </Link>
        </div>
        <div className="bg-white/5 backdrop-blur-xl border border-border/30 rounded-lg p-8">{children}</div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-mono text-2xs uppercase tracking-wider text-foreground-muted">{label}</span>
      <span className="text-sm text-foreground text-right break-all">{value}</span>
    </div>
  )
}

/** An unrecognised role reads as "member", which is the least of the three. Fails low. */
function normalizeRole(value: string) {
  return isInvitableRole(value) ? value : "member"
}

function labelForRole(value: string | null | undefined) {
  return ROLE_LABEL[normalizeRole((value || "member").toLowerCase())].toLowerCase()
}

/** "revoked", "declined", "already accepted" - what the closed states read as in a sentence. */
function statusSentence(status: string): string {
  const known = INVITATION_STATUS_LABEL[status as InvitationStatus]
  if (status === "accepted") return "already accepted"
  if (!known) return "closed"
  return known.toLowerCase()
}
