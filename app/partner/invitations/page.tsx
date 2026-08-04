import { redirect } from "next/navigation"

// Invitations are now a tab on /partner/network rather than their own page.
// Kept as a redirect stub because this path is still linked from the partnership
// invite email flow (app/api/partnerships/route.ts), the auth callback's post-login
// destination (app/auth/callback/route.ts), and in-app notification links
// (lib/notifications.ts) - all of which must keep resolving to something live.
export default function PartnerInvitationsPage() {
  redirect("/partner/network")
}
