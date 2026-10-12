import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * DISCOVERY READS OF profiles (migration 115, code first).
 *
 * Until 115, "Authenticated users can read discoverable profiles" (scripts/016) let any signed-in
 * user read EVERY column of a discoverable profile through PostgREST: legal_ein, legal_address,
 * rate_info, payment_terms, default_terms, is_paid, is_admin, demo_access and the rest. 115 drops
 * that policy and adds public.discoverable_profiles(p_role, p_ids), a SECURITY DEFINER function
 * returning only the public discovery fields below, so a stranger reads a discoverable profile
 * through this path or not at all. Self and counterparty reads are unchanged (the
 * "Users can view profiles of partnership members" policy still admits whole rows).
 *
 * Before 115 the RPC is missing (PGRST202 / 42883) and this falls back to today's direct select,
 * with the same column list and the same sanitizing, so the output is identical either way.
 */

export type DiscoverableProfile = {
  id: string
  full_name: string | null
  company_name: string | null
  display_name: string | null
  bio: string | null
  location: string | null
  website: string | null
  company_website: string | null
  company_linkedin_url: string | null
  agency_type: string | null
  avatar_url: string | null
  company_logo_url: string | null
  reel_url: string | null
  capabilities: unknown
  work_examples: unknown
  business_criteria: unknown
  is_discoverable: true
}

/** The public discovery columns. 115's function builds exactly these keys. */
const DISCOVERABLE_COLUMNS =
  "id, full_name, company_name, display_name, bio, location, website, company_website, company_linkedin_url, agency_type, avatar_url, company_logo_url, reel_url, capabilities, work_examples, business_criteria"

/** lib/partner-rate-info-read.ts RATE_INFO_BIO_MARKER: legacy rate JSON appended to the bio. */
const RATE_INFO_BIO_MARKER = "\n\n__LIGAMENT_PARTNER_RATE_V1__\n"

function stripRateFromBio(bio: unknown): string | null {
  if (typeof bio !== "string") return null
  const idx = bio.indexOf(RATE_INFO_BIO_MARKER)
  return idx === -1 ? bio : bio.slice(0, idx).trimEnd()
}

/** business_criteria minus insurance.coi_document_url, a private document link. */
function publicBusinessCriteria(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw ?? null
  const bc = raw as Record<string, unknown>
  const insurance = bc.insurance
  if (!insurance || typeof insurance !== "object" || Array.isArray(insurance)) return bc
  const { coi_document_url: _omitted, ...rest } = insurance as Record<string, unknown>
  return { ...bc, insurance: rest }
}

/** Allow-list a row from either source into the public shape. Unknown keys never pass. */
function toPublic(row: Record<string, unknown>): DiscoverableProfile {
  const s = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : null)
  return {
    id: String(row.id),
    full_name: s("full_name"),
    company_name: s("company_name"),
    display_name: s("display_name"),
    bio: stripRateFromBio(row.bio),
    location: s("location"),
    website: s("website"),
    company_website: s("company_website"),
    company_linkedin_url: s("company_linkedin_url"),
    agency_type: s("agency_type"),
    avatar_url: s("avatar_url"),
    company_logo_url: s("company_logo_url"),
    reel_url: s("reel_url"),
    capabilities: row.capabilities ?? null,
    work_examples: row.work_examples ?? null,
    business_criteria: publicBusinessCriteria(row.business_criteria),
    is_discoverable: true,
  }
}

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "PGRST202" || error.code === "42883"))
}

/**
 * Discoverable profiles, public fields only, with the CALLER'S SESSION client.
 *   role: "agency" | "partner" matches role OR active_role (the marketplace's dual-role rule);
 *   ids:  restrict to these profile ids (a detail page, or names for a list).
 */
export async function readDiscoverableProfiles(
  client: SupabaseClient,
  opts: { role?: "agency" | "partner"; ids?: string[] } = {}
): Promise<{ data: DiscoverableProfile[]; error: { code?: string; message: string } | null; via: "rpc" | "fallback" }> {
  const ids = opts.ids ? Array.from(new Set(opts.ids.filter(Boolean))) : undefined
  if (ids && ids.length === 0) return { data: [], error: null, via: "rpc" }

  const rpc = await client.rpc("discoverable_profiles", { p_role: opts.role ?? null, p_ids: ids ?? null })
  if (!rpc.error) {
    const rows = Array.isArray(rpc.data) ? (rpc.data as unknown[]) : []
    return {
      data: rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object").map(toPublic),
      error: null,
      via: "rpc",
    }
  }
  if (!isMissingFunction(rpc.error)) return { data: [], error: rpc.error, via: "rpc" }

  // 115 not applied: today's policy still admits the row, so read it directly, same columns.
  let query = client.from("profiles").select(DISCOVERABLE_COLUMNS).eq("is_discoverable", true)
  if (opts.role) query = query.or(`role.eq.${opts.role},active_role.eq.${opts.role}`)
  if (ids) query = query.in("id", ids)
  const { data, error } = await query.order("company_name", { ascending: true })
  if (error) return { data: [], error, via: "fallback" }
  return { data: ((data || []) as unknown as Record<string, unknown>[]).map(toPublic), error: null, via: "fallback" }
}

/**
 * The marketplace "Invite to Pool" path: a discoverable profile's id and email, for the
 * partnerships POST to address the invitation. SERVICE ROLE, server-only, and only for a profile
 * that is discoverable. The email is used to send the invitation and is never returned by it.
 * After 115 the caller's session can no longer read a stranger's row to find it.
 */
export async function resolveDiscoverableInvitee(profileId: string): Promise<{ id: string; email: string | null } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !profileId) return null
  const service = createServiceClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await service
    .from("profiles")
    .select("id, email")
    .eq("id", profileId)
    .eq("is_discoverable", true)
    .maybeSingle()
  if (error) {
    console.error("[discoverable-profiles] invitee lookup failed", error.message)
    return null
  }
  return data ? { id: String(data.id), email: (data.email as string | null) ?? null } : null
}
