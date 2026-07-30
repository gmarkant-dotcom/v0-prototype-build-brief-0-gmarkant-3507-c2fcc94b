import { redirect } from "next/navigation"

// Legacy Core/Studio/Network mock billing page - replaced by the real usage-based billing
// dashboard at /agency/usage. Keep this route redirecting rather than deleting it outright,
// since old bookmarks/links may still point at /agency/settings/billing.
export default function AgencyBillingSettingsPage() {
  redirect("/agency/usage")
}
