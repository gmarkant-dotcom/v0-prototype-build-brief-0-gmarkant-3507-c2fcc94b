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
  /**
   * 079: the CALLER'S USER ID, and deliberately not their organization id. This is
   * compared against a profiles.id below to answer "is this contact me", which is a
   * question about a person. Before 079 the two values were identical and either would
   * have worked; passing the organization id now would break the self-check for every
   * organization created after 079, whose id belongs to no user.
   */
  callerUserId: string
  agencyOwnDomains: string[]
  matchedProfileId: string | null
  contactEmail: string
}): ImportGuardOutcome {
  const { callerUserId, agencyOwnDomains, matchedProfileId, contactEmail } = params
  if (matchedProfileId && matchedProfileId === callerUserId) return "self_account"

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
  /**
   * 079: the CALLER'S USER ID. This reads a profiles row, so it needs a person, not an
   * organization. It is one of the four "resolve a profile by a company id" sites
   * docs/079-rename-plan.md section 7 lists as breaking under the org model; splitting the
   * argument is the fix, because the caller now has both values and can pass the right one.
   *
   * WHAT IS STILL WRONG, AND IS NOT A RENAME PROBLEM: the domains derived here are ONE
   * member's, not the organization's. Two colleagues on different email domains will
   * produce different same-domain guards. Fixing that means an organization-level domain
   * list, which is a schema change 079 does not make.
   */
  callerUserId: string,
  agencyAuthEmail?: string | null
): Promise<string[]> {
  const { data: profile } = await client
    .from("profiles")
    .select("email, company_website")
    .eq("id", callerUserId)
    .maybeSingle()

  const authEmailDomain = emailDomain(agencyAuthEmail || (profile?.email as string | null) || "")
  const companyDomain = extractDomainFromUrl((profile?.company_website as string | null) ?? null)
  return Array.from(new Set([authEmailDomain, companyDomain].filter((d): d is string => Boolean(d))))
}
