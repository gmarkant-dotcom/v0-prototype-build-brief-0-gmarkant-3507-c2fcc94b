import type { SupabaseClient } from "@supabase/supabase-js"
import { extractDomainFromUrl } from "@/lib/google-email"

/**
 * Shared self-partnership guard for every partner-import path (email-scan import,
 * spreadsheet/manual import via lib/server/partner-pool-import.ts). An exact profiles
 * email match must never auto-activate a partnership - it only ever determines whether
 * a Discovered row gets linked/flagged. See app/api/agency/email-scan/import/route.ts,
 * lib/server/partner-pool-import.ts, and app/api/rfp/guest/[token]/route.ts for callers.
 */

/** Public webmail domains are exempt from the same-domain check - a freelancer on gmail
 *  sharing a domain with other gmail users is not a signal of anything. */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
])

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase())
}

export function emailDomain(email: string): string {
  return (email.split("@")[1] || "").trim().toLowerCase()
}

export type ImportGuardOutcome = "self_account" | "same_domain_flag" | "ok"

/**
 * Evaluates a single contact against the agency's own identity.
 * - self_account: the matched profile IS the importing agency - never link, never create a
 *   row for this contact.
 * - same_domain_flag: the contact shares the agency's own (non-public) email domain but is
 *   not literally the agency's account - still lands as Discovered, just flagged for review.
 * - ok: no self-partnership signal, proceed with normal Discovered-only linking.
 */
export function evaluateImportGuard(params: {
  agencyId: string
  agencyOwnDomains: string[]
  matchedProfileId: string | null
  contactEmail: string
}): ImportGuardOutcome {
  const { agencyId, agencyOwnDomains, matchedProfileId, contactEmail } = params
  if (matchedProfileId && matchedProfileId === agencyId) return "self_account"

  const domain = emailDomain(contactEmail)
  if (domain && !isPublicEmailDomain(domain) && agencyOwnDomains.includes(domain)) {
    return "same_domain_flag"
  }
  return "ok"
}

/**
 * Derives the agency's own email domain(s) - the same two-source derivation
 * app/api/agency/email-scan/run/route.ts already uses to exclude the agency's own domain
 * from scan results (auth email domain + company_website domain), reused here so every
 * import path applies an identical same-domain check.
 */
export async function resolveAgencyOwnDomains(
  client: SupabaseClient,
  agencyId: string,
  agencyAuthEmail?: string | null
): Promise<string[]> {
  const { data: profile } = await client
    .from("profiles")
    .select("email, company_website")
    .eq("id", agencyId)
    .maybeSingle()

  const authEmailDomain = emailDomain(agencyAuthEmail || (profile?.email as string | null) || "")
  const companyDomain = extractDomainFromUrl((profile?.company_website as string | null) ?? null)
  return Array.from(new Set([authEmailDomain, companyDomain].filter((d): d is string => Boolean(d))))
}
