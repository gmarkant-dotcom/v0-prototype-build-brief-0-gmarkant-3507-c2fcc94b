import { colleagueInvitationsEnabled } from "@/lib/feature-flags"
import AgencyTeamRosterClient from "./team-roster-client"

/**
 * THE FEATURE GATE for the team page's invitation affordance. Server component.
 *
 * COLLEAGUE_INVITATIONS is a server-side flag in the BROADCAST_CUES_PARTNERSHIP form -
 * `process.env.X === "true"` - so an absent variable is off, and Vercel not having it keeps
 * the affordance inert. See lib/feature-flags.ts for why it is off: profiles.active_org_id
 * does not exist, so the second membership an accept creates leaves the accepter unable to
 * write anywhere. Migration 090 fixes that, and the flag stays off until 090 is applied.
 *
 * THE ROSTER IS NOT GATED, and only the affordance is. Reading who is in your own
 * organization needed no ruling and needs no flag; it has been live since 086. With the flag
 * off this page renders exactly what it rendered before 089 - the read-only roster, and the
 * footer line that says inviting is not available yet.
 *
 * This file exists only because a client component cannot read a server-side env var. The
 * client half is unchanged apart from taking the flag as a prop.
 */
export default function AgencyTeamRosterPage() {
  return <AgencyTeamRosterClient invitationsEnabled={colleagueInvitationsEnabled()} />
}
