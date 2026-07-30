import type { SupabaseClient } from "@supabase/supabase-js"
import { evaluateImportGuard, resolveAgencyOwnDomains } from "@/lib/server/partner-import-guard"

/**
 * Shared write path for adding a ghost/unclaimed contact to an agency's partner pool -
 * used by both the manual "Add Partner" route and the spreadsheet import route (Discovered
 * column, same table/status the email-scan importer writes to). Not used by the email-scan
 * importer itself, which has its own longer-standing implementation in
 * app/api/agency/email-scan/import/route.ts (mirrors the same consent rule below).
 *
 * CONSENT RULE: an exact profiles email match never activates a partnership on its own.
 * It only determines whether the resulting Discovered row is linked (partnership_notes.
 * matched_profile_id + pool_flag "already_on_ligament") so the pool UI can badge it -
 * activation only ever happens through the existing invite -> accept flow
 * (app/api/partnerships POST/PATCH). If the agency's own profile is the match, the row is
 * skipped entirely (self-partnership must be impossible). If the contact shares the
 * agency's own (non-public) email domain without being an exact match, the row still lands
 * Discovered but flagged ("domain_match_flagged", reusing the same pool_status value and
 * badge the guest-bid domain-match flow already renders on /agency/pool).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHUNK_SIZE = 200

export type PartnerImportRow = {
  email: string
  contactName?: string | null
  companyName?: string | null
  phone?: string | null
  website?: string | null
  /** Free-text notes - stored in partnership_notes.notes alongside any existing agency notes. */
  notes?: string | null
  /** Raw, unvalidated - partnerships has no discipline/type columns for ghost rows, so these
   *  land in partnership_notes.imported_meta and are not surfaced anywhere in the UI today. */
  discipline?: string | null
  type?: string | null
}

export type PartnerImportSource = "manual" | "spreadsheet"

export type PartnerImportFlag = "already_on_ligament" | "domain_match_flagged"

export type PartnerImportRowResult = {
  email: string
  outcome: "added" | "duplicate" | "invalid" | "error" | "self"
  reason?: string
  flag?: PartnerImportFlag
}

type PartnershipNotesShape = {
  notes?: string
  notes_log?: { text: string; timestamp: string }[]
  blacklisted?: boolean
  imported_meta?: {
    source: PartnerImportSource
    imported_at: string
    discipline?: string
    type?: string
  }
  matched_profile_id?: string
  pool_flag?: PartnerImportFlag
}

type ExistingPoolRow = {
  id: string
  partner_id: string | null
  partner_email: string | null
  status: string | null
  contact_name: string | null
  company_name: string | null
  phone: string | null
  website: string | null
  partnership_notes: PartnershipNotesShape | null
}

function mergeNotes(
  existing: PartnershipNotesShape | null | undefined,
  row: PartnerImportRow,
  source: PartnerImportSource,
  matchedProfileId: string | null,
  flag: PartnerImportFlag | undefined
): PartnershipNotesShape | null {
  const base: PartnershipNotesShape = { ...(existing || {}) }
  const notes = (row.notes || "").trim()
  const discipline = (row.discipline || "").trim()
  const type = (row.type || "").trim()

  if (notes) {
    base.notes = notes
    base.notes_log = [...(base.notes_log || []), { text: notes, timestamp: new Date().toISOString() }]
  }
  if (discipline || type) {
    base.imported_meta = {
      source,
      imported_at: new Date().toISOString(),
      ...(discipline ? { discipline } : {}),
      ...(type ? { type } : {}),
    }
  }
  if (matchedProfileId) base.matched_profile_id = matchedProfileId
  if (flag) base.pool_flag = flag

  return Object.keys(base).length > 0 ? base : null
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Validates and normalizes a raw row server-side - the client's own validation (row cap,
 * email format, field trimming) is a convenience, never a trust boundary. Rows failing
 * basic shape here are marked "invalid" and never reach the DB.
 */
function normalizeRow(raw: unknown): { row: PartnerImportRow | null; email: string; reason?: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const email = String(r.email || "").trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) {
    return { row: null, email: email || "(missing)", reason: "Invalid or missing email" }
  }
  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : ""
    return s || null
  }
  return {
    row: {
      email,
      contactName: str(r.contactName),
      companyName: str(r.companyName),
      phone: str(r.phone),
      website: str(r.website),
      notes: str(r.notes),
      discipline: str(r.discipline),
      type: str(r.type),
    },
    email,
  }
}

/**
 * Batch-imports contacts into an agency's pool as ghost partnerships rows (or enriches/
 * links an existing Discovered ghost row to a matched profile) - never as an active
 * partnership, regardless of whether the contact has a Ligament account (see CONSENT RULE
 * above). Pass `dryRun: true` to classify every row (flags, dedup, self/domain-guard)
 * without writing anything - used by the spreadsheet review step so the UI can show
 * accurate badges before the agency commits to an import.
 *
 * Lookups (existing pool, matched profiles) run once for the whole request rather than
 * per-chunk - existing-pool matching is done case-insensitively in JS against the agency's
 * own rows rather than a DB `ilike`/`in` filter, since historical partner_email casing isn't
 * guaranteed and building one query per email would be exactly the "per-row request"
 * anti-pattern this is meant to avoid. Only the actual inserts/updates are chunked (~200
 * rows), falling back to per-row writes within a chunk if the batch write itself fails, so a
 * single bad row's error can be attributed instead of failing the whole chunk.
 *
 * agencyId must come from the caller's authenticated session - never accept it from the
 * request payload.
 */
export async function importPartnerRows(
  service: SupabaseClient,
  agencyId: string,
  rawRows: unknown[],
  source: PartnerImportSource,
  maxRows = 2000,
  options?: { dryRun?: boolean; agencyAuthEmail?: string | null }
): Promise<PartnerImportRowResult[]> {
  const dryRun = options?.dryRun === true
  const results: PartnerImportRowResult[] = []
  const capped = rawRows.slice(0, maxRows)

  const normalized = capped.map((raw) => normalizeRow(raw))
  for (const n of normalized) {
    if (!n.row) results.push({ email: n.email, outcome: "invalid", reason: n.reason })
  }

  // Dedup within the request itself (same email twice keeps the first).
  const seen = new Set<string>()
  const validRows: PartnerImportRow[] = []
  for (const n of normalized) {
    if (!n.row) continue
    if (seen.has(n.row.email)) {
      results.push({ email: n.row.email, outcome: "duplicate", reason: "Duplicate email in this request" })
      continue
    }
    seen.add(n.row.email)
    validRows.push(n.row)
  }

  if (validRows.length === 0) return results

  const agencyOwnDomains = await resolveAgencyOwnDomains(service, agencyId, options?.agencyAuthEmail)

  const { data: existingPoolRows, error: poolErr } = await service
    .from("partnerships")
    .select("id, partner_id, partner_email, status, contact_name, company_name, phone, website, partnership_notes")
    .eq("agency_id", agencyId)
  if (poolErr) {
    for (const r of validRows) results.push({ email: r.email, outcome: "error", reason: "Failed to check existing pool" })
    return results
  }
  const existingByEmail = new Map<string, ExistingPoolRow>()
  const existingByPartnerId = new Map<string, ExistingPoolRow>()
  for (const row of (existingPoolRows || []) as ExistingPoolRow[]) {
    const e = String(row.partner_email || "").toLowerCase()
    if (e) existingByEmail.set(e, row)
    if (row.partner_id) existingByPartnerId.set(row.partner_id, row)
  }

  const allEmails = validRows.map((r) => r.email)
  const profileByEmail = new Map<string, string>()
  for (const emailChunk of chunk(allEmails, CHUNK_SIZE)) {
    const { data: matchedProfiles, error: profErr } = await service.from("profiles").select("id, email").in("email", emailChunk)
    if (profErr) {
      for (const e of emailChunk) results.push({ email: e, outcome: "error", reason: "Failed to look up profiles" })
      continue
    }
    for (const p of matchedProfiles || []) {
      const e = String((p as { email?: string | null }).email || "").toLowerCase()
      if (e) profileByEmail.set(e, (p as { id: string }).id)
    }
  }

  const toInsert: Record<string, unknown>[] = []
  const insertEmailOrder: string[] = []
  const insertFlagByEmail = new Map<string, PartnerImportFlag | undefined>()

  for (const row of validRows) {
    if (results.some((r) => r.email === row.email)) continue // profile-lookup error already recorded

    const matchedProfileId = profileByEmail.get(row.email) || null
    const guard = evaluateImportGuard({ agencyId, agencyOwnDomains, matchedProfileId, contactEmail: row.email })

    if (guard === "self_account") {
      results.push({ email: row.email, outcome: "self", reason: "This is your own account" })
      continue
    }

    const flag: PartnerImportFlag | undefined =
      guard === "same_domain_flag" ? "domain_match_flagged" : matchedProfileId ? "already_on_ligament" : undefined

    const existing = matchedProfileId
      ? existingByPartnerId.get(matchedProfileId) || existingByEmail.get(row.email)
      : existingByEmail.get(row.email)

    if (existing) {
      if (existing.status === "active") {
        results.push({ email: row.email, outcome: "duplicate", reason: "Already in your pool" })
        continue
      }

      // Existing Discovered/pending ghost row - enrich and link, but status/profile_status
      // (and partner_id) never change here. Activation only happens via invite -> accept.
      if (dryRun) {
        results.push({ email: row.email, outcome: "added", flag })
        continue
      }
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        partnership_notes: mergeNotes(existing.partnership_notes, row, source, matchedProfileId, flag),
      }
      if (!existing.contact_name && row.contactName) patch.contact_name = row.contactName
      if (!existing.company_name && row.companyName) patch.company_name = row.companyName
      if (!existing.phone && row.phone) patch.phone = row.phone
      if (!existing.website && row.website) patch.website = row.website

      const { error } = await service.from("partnerships").update(patch).eq("id", existing.id)
      results.push(
        error
          ? { email: row.email, outcome: "error", reason: "Failed to update existing contact" }
          : { email: row.email, outcome: "added", flag }
      )
      continue
    }

    if (dryRun) {
      results.push({ email: row.email, outcome: "added", flag })
      continue
    }

    const notes = mergeNotes(null, row, source, matchedProfileId, flag)
    toInsert.push({
      agency_id: agencyId,
      partner_id: null,
      partner_email: row.email,
      status: "pending",
      profile_status: "unclaimed",
      contact_name: row.contactName,
      company_name: row.companyName,
      phone: row.phone,
      website: row.website,
      partnership_notes: notes,
    })
    insertEmailOrder.push(row.email)
    insertFlagByEmail.set(row.email, flag)
  }

  for (const insertChunk of chunk(toInsert, CHUNK_SIZE)) {
    const { error: insertErr } = await service.from("partnerships").insert(insertChunk)
    if (!insertErr) {
      for (const record of insertChunk) {
        const email = String((record as { partner_email: string }).partner_email)
        results.push({ email, outcome: "added", flag: insertFlagByEmail.get(email) })
      }
      continue
    }
    // Batch insert failed - fall back to one-at-a-time within this chunk only, so we can
    // report exactly which row(s) failed and why instead of failing the whole chunk.
    for (const record of insertChunk) {
      const { error } = await service.from("partnerships").insert(record)
      const email = String((record as { partner_email: string }).partner_email)
      results.push(
        error
          ? { email, outcome: "error", reason: error.message }
          : { email, outcome: "added", flag: insertFlagByEmail.get(email) }
      )
    }
  }

  return results
}
