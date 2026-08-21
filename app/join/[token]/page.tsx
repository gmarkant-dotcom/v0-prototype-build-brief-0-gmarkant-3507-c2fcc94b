import { notFound } from "next/navigation"
import { colleagueInvitationsEnabled } from "@/lib/feature-flags"
import JoinInvitationClient from "./join-invitation-client"

/**
 * THE FEATURE GATE for /join/<token>. Server component, and it does one thing.
 *
 * COLLEAGUE_INVITATIONS is a server-side flag in the BROADCAST_CUES_PARTNERSHIP form -
 * `process.env.X === "true"` - so an absent variable is off, and Vercel not having it keeps
 * this whole route inert. See lib/feature-flags.ts for why it is off: profiles.active_org_id
 * does not exist, so the second membership an accept creates leaves the accepter unable to
 * write anywhere. Migration 090 fixes that, and the flag stays off until 090 is applied.
 *
 * notFound() AND NOT A "COMING SOON" PAGE. A 404 is what this path genuinely is while the
 * flag is off: the surface does not exist. A page that explains it would advertise an
 * unreleased feature to anyone who guessed the URL, and would tell a token holder that
 * their token was at least the right shape.
 *
 * IT DOES NOT GATE THE ACCEPT AND DECLINE API ROUTES, deliberately. An invitation sent
 * while the flag was on must stay answerable if the flag is turned back off - otherwise an
 * invitee holds a live link that cannot be declined, and the pending row nobody can clear
 * then blocks that address through org_invitations_one_live_per_email. Stated again in
 * lib/feature-flags.ts.
 *
 * The client half is unchanged and carries all the reasoning about why this path is /join
 * rather than /partner/invitations. This file exists only because a client component cannot
 * read a server-side env var.
 */
export default function JoinInvitationPage() {
  if (!colleagueInvitationsEnabled()) {
    notFound()
  }
  return <JoinInvitationClient />
}
