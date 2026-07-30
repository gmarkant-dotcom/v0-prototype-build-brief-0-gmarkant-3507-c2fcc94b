import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Shared write path for adding a ghost/unclaimed contact to an agency's partner pool -
 * used by both the manual "Add Partner" route and the spreadsheet import route (Discovered
 * column, same table/status the email-scan importer writes to). Not used by the email-scan
 * importer itself, which has its own longer-standing implementation in
 * app/api/agency/email-scan/import/route.ts.
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

export type PartnerImportRowResult = {
  email: string
  outcome: "added" | "duplicate" | "invalid" | "error"
  reason?: string
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
}

function buildPartnershipNotes(row: PartnerImportRow, source: PartnerImportSource): PartnershipNotesShape | null {
  const notes = (row.notes || "").trim()
  const discipline = (row.discipline || "").trim()
  const type = (row.type || "").trim()
  if (!notes && !discipline && !type) return null

  const result: PartnershipNotesShape = {}
  if (notes) {
    result.notes = notes
    result.notes_log = [{ text: notes, timestamp: new Date().toISOString() }]
  }
  if (discipline || type) {
    result.imported_meta = {
      source,
      imported_at: new Date().toISOString(),
      ...(discipline ? { discipline } : {}),
      ...(type ? { type } : {}),
    }
  }
  return result
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
 * Batch-imports contacts into an agency's pool as ghost partnerships rows (or claims/links
 * an existing ghost row to a matched profile, exactly like the email-scan importer does).
 *
 * Lookups (existing pool, matched profiles) run once for the whole request rather than
 * per-chunk - existing-pool matching is done case-insensitively in JS against the agency's
 * own rows rather than a DB `ilike`/`in` filter, since historical partner_email casing isn't
 * guaranteed and building one query per email would be exactly the "per-row request"
 * anti-pattern this is meant to avoid. Only the actual inserts are chunked (~200 rows),
 * falling back to per-row inserts within a chunk if the batch insert itself fails, so a
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
  maxRows = 2000
): Promise<PartnerImportRowResult[]> {
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

  const { data: existingPoolRows, error: poolErr } = await service
    .from("partnerships")
    .select("id, partner_id, partner_email")
    .eq("agency_id", agencyId)
  if (poolErr) {
    for (const r of validRows) results.push({ email: r.email, outcome: "error", reason: "Failed to check existing pool" })
    return results
  }
  const existingByEmail = new Map<string, { id: string; partner_id: string | null }>()
  const existingByPartnerId = new Map<string, { id: string; partner_id: string | null }>()
  for (const row of existingPoolRows || []) {
    const e = String((row as { partner_email?: string | null }).partner_email || "").toLowerCase()
    if (e) existingByEmail.set(e, row as { id: string; partner_id: string | null })
    const pid = (row as { partner_id?: string | null }).partner_id
    if (pid) existingByPartnerId.set(pid, row as { id: string; partner_id: string | null })
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

  for (const row of validRows) {
    if (results.some((r) => r.email === row.email)) continue // profile-lookup error already recorded

    const matchedProfileId = profileByEmail.get(row.email)
    const existing = matchedProfileId
      ? existingByPartnerId.get(matchedProfileId) || existingByEmail.get(row.email)
      : existingByEmail.get(row.email)

    if (existing) {
      if (matchedProfileId && !existing.partner_id) {
        const { error } = await service
          .from("partnerships")
          .update({ partner_id: matchedProfileId, profile_status: "active", updated_at: new Date().toISOString() })
          .eq("id", existing.id)
        results.push(
          error
            ? { email: row.email, outcome: "error", reason: "Failed to link matched account" }
            : { email: row.email, outcome: "added" }
        )
      } else {
        results.push({ email: row.email, outcome: "duplicate", reason: "Already in your pool" })
      }
      continue
    }

    const notes = buildPartnershipNotes(row, source)
    toInsert.push({
      agency_id: agencyId,
      partner_id: matchedProfileId || null,
      partner_email: row.email,
      status: matchedProfileId ? "active" : "pending",
      profile_status: matchedProfileId ? "active" : "unclaimed",
      contact_name: row.contactName,
      company_name: row.companyName,
      phone: row.phone,
      website: row.website,
      partnership_notes: notes,
    })
  }

  for (const insertChunk of chunk(toInsert, CHUNK_SIZE)) {
    const { error: insertErr } = await service.from("partnerships").insert(insertChunk)
    if (!insertErr) {
      for (const record of insertChunk) results.push({ email: String((record as { partner_email: string }).partner_email), outcome: "added" })
      continue
    }
    // Batch insert failed - fall back to one-at-a-time within this chunk only, so we can
    // report exactly which row(s) failed and why instead of failing the whole chunk.
    for (const record of insertChunk) {
      const { error } = await service.from("partnerships").insert(record)
      const email = String((record as { partner_email: string }).partner_email)
      results.push(error ? { email, outcome: "error", reason: error.message } : { email, outcome: "added" })
    }
  }

  return results
}
