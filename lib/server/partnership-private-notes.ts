import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"

/**
 * The lead agency's private notes on a vendor: free text, rating, would-work-again, the
 * blacklist flag, the broadcast cue, import metadata. Migration 105 moves them out of
 * partnerships.partnership_notes into public.partnership_private_notes.
 *
 * WHY A TABLE AND NOT A COLUMN GRANT. An agency member and a vendor are both the role
 * `authenticated`, and that role holds table-wide privilege on partnerships (relacl measured
 * 2026-10-08), so a column REVOKE removes nothing and Postgres has no per-column RLS. The
 * vendor's SELECT policy on partnerships admits the whole row. A separate table with an
 * agency-only policy is the one mechanism that separates the two by row ownership.
 *
 * TWO RULES THIS FILE ENFORCES FOR ITS CALLERS:
 *
 *  1. EVERY READ IS AGENCY-SCOPED. `readPrivateNotes` requires the caller's lead organization
 *     ids and filters on them. There is no unscoped read. The table has NO vendor policy, so
 *     a vendor session reads zero rows regardless; the filter is what keeps a service-role
 *     caller (which bypasses RLS) honest.
 *
 *  2. IT WORKS BEFORE AND AFTER 105 IS APPLIED. Code ships first. While the table does not
 *     exist, reads fall back to the legacy column and writes go to the legacy column. Once it
 *     exists, a table row wins on read and writes go only to the table, so that 106 can null
 *     the legacy column without losing anything. The fallback is OWED FOR REMOVAL once 105
 *     and 106 are applied and verified - see docs/105-notes-split-report.md.
 */

const TABLE = "partnership_private_notes"
const CHUNK = 150

type DbError = { code?: string | null; message?: string | null } | null | undefined

/** 42P01 from Postgres; PGRST205 from PostgREST when the table is not in its schema cache. */
export function isMissingNotesTable(err: DbError): boolean {
  if (!err) return false
  if (err.code === "42P01" || err.code === "PGRST205") return true
  return typeof err.message === "string" && err.message.includes(TABLE) && /does not exist|schema cache/i.test(err.message)
}

export type PrivateNotesRead = {
  /** false when the table does not exist yet (105 not applied): callers use the legacy column. */
  available: boolean
  byPartnership: Map<string, unknown>
}

function chunked<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

/**
 * Reads notes for partnerships the caller's organizations lead. `leadOrgIds` is REQUIRED and is
 * always applied: pass resolveCallerOrgIds() for a session caller, or the single agency
 * organization a service-role route has already resolved from the session.
 *
 * Throws on any error other than a missing table. A failed read must not quietly show the
 * stale legacy value (a blacklist flag that has been lifted, say).
 */
export async function readPrivateNotes(
  client: SupabaseClient,
  leadOrgIds: readonly OrgId[],
  partnershipIds: readonly string[]
): Promise<PrivateNotesRead> {
  const byPartnership = new Map<string, unknown>()
  const ids = Array.from(new Set(partnershipIds.filter(Boolean)))
  if (leadOrgIds.length === 0 || ids.length === 0) return { available: true, byPartnership }

  for (const idChunk of chunked(ids)) {
    const { data, error } = await client
      .from(TABLE)
      .select("partnership_id, notes")
      .in("lead_org_id", leadOrgIds as OrgId[])
      .in("partnership_id", idChunk)
    if (error) {
      if (isMissingNotesTable(error)) return { available: false, byPartnership: new Map() }
      throw error
    }
    for (const row of (data || []) as { partnership_id: string; notes: unknown }[]) {
      byPartnership.set(row.partnership_id, row.notes)
    }
  }
  return { available: true, byPartnership }
}

/** A table row wins; with none (or the table absent) the legacy column value is used. */
export function resolveNotes(legacy: unknown, read: PrivateNotesRead, partnershipId: string): unknown {
  return read.byPartnership.has(partnershipId) ? read.byPartnership.get(partnershipId) : legacy
}

/**
 * Replaces `partnership_notes` on each row with the resolved value. For agency list responses,
 * so the wire shape the Vendor Pool page already reads is unchanged.
 */
export async function attachPrivateNotes<T extends Record<string, unknown>>(
  client: SupabaseClient,
  leadOrgIds: readonly OrgId[],
  rows: readonly T[] | null | undefined
): Promise<T[]> {
  const list = (rows || []) as T[]
  if (list.length === 0) return list
  const read = await readPrivateNotes(client, leadOrgIds, list.map((r) => String(r.id)))
  return list.map((r) => ({ ...r, partnership_notes: resolveNotes(r.partnership_notes, read, String(r.id)) }))
}

/** Drops the legacy key from a row that is about to be returned to a vendor. */
export function withoutPrivateNotes<T>(row: T): T {
  if (!row || typeof row !== "object") return row
  const { partnership_notes: _omit, ...rest } = row as Record<string, unknown>
  return rest as T
}

export type PrivateNotesWrite = { partnershipId: string; leadOrgId: OrgId; notes: unknown }

/**
 * Upserts notes. Falls back to the legacy column only when the table does not exist. Returns the
 * error, if any, rather than throwing, so each caller keeps its own failure policy.
 */
export async function writePrivateNotes(
  client: SupabaseClient,
  writes: readonly PrivateNotesWrite[]
): Promise<{ error: DbError; legacyFallback: boolean }> {
  if (writes.length === 0) return { error: null, legacyFallback: false }
  const now = new Date().toISOString()

  for (const group of chunked(writes)) {
    const { error } = await client.from(TABLE).upsert(
      group.map((w) => ({ partnership_id: w.partnershipId, lead_org_id: w.leadOrgId, notes: w.notes ?? {}, updated_at: now })),
      { onConflict: "partnership_id" }
    )
    if (!error) continue
    if (!isMissingNotesTable(error)) return { error, legacyFallback: false }

    for (const w of writes) {
      const { error: legacyErr } = await client
        .from("partnerships")
        .update({ partnership_notes: w.notes })
        .eq("id", w.partnershipId)
        .eq("lead_org_id", w.leadOrgId)
      if (legacyErr) return { error: legacyErr, legacyFallback: true }
    }
    return { error: null, legacyFallback: true }
  }
  return { error: null, legacyFallback: false }
}
