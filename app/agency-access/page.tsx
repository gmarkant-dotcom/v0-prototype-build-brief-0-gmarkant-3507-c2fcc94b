import { AgencyUpgradeScreen, type AgencyUpgradeReason } from "@/components/agency-upgrade-screen"

/**
 * G1. middleware.ts rewrites any /agency page here (URL unchanged) when the caller's active
 * organization is not a paid lead agency. Deliberately OUTSIDE app/agency, so it does not
 * mount the agency shell or any of its data fetches.
 */
export default async function AgencyAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const safe: AgencyUpgradeReason =
    reason === "not_paid" || reason === "unavailable" ? reason : "not_lead_agency"
  return <AgencyUpgradeScreen reason={safe} />
}
