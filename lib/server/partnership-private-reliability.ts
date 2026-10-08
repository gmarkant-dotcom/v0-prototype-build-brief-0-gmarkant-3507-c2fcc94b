import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"

/**
 * The cached AI reliability narrative about a vendor, and the time it was computed. It is the lead
 * agency's view of the vendor, computed over EVERY completed delivery review, including reviews the
 * agency has not shared with the vendor (migration 073). Migration 107 moves the pair out of
 * partnerships.reliability_summary / reliability_summary_generated_at into
 * public.partnership_private_reliability, which has no vendor policy.
 *
 * WHY A TABLE AND NOT A COLUMN GRANT: the same reason as lib/server/partnership-private-notes.ts. An
 * agency member and a vendor are both the role `authenticated`; that role holds table-wide privilege
 * on partnerships, and the vendor's SELECT policy admits the whole row. Migration 073 (S4) named an
 * agency-only table as the real fix. Nothing else separates the two by row ownership.
 *
 * THE TWO VALUES MOVE TOGETHER, ALWAYS. The route decides staleness by comparing the timestamp with the
 * newest review, so a summary in one place and a timestamp in the other would read as stale or fresh at
 * random. One row holds both; no function here reads or writes one without the other.
 *
 * RULES, same as the notes helper:
 *  1. EVERY READ IS AGENCY-SCOPED. `readReliabilityCache` requires the caller's lead organization ids.
 *  2. IT WORKS BEFORE AND AFTER 107 IS APPLIED. Code ships first. While the table does not exist, reads
 *     fall back to the legacy columns and writes go to the legacy columns. Once it exists a table row
 *     wins on read and writes go only to the table. The fallback is OWED FOR REMOVAL once 107 and 108
 *     are applied and verified - see docs/107-reliability-split-report.md.
 */

const TABLE = "partnership_private_reliability"

type DbError = { code?: string | null; message?: string | null } | null | undefined

/** 42P01 from Postgres; PGRST205 from PostgREST when the table is not in its schema cache. */
export function isMissingReliabilityTable(err: DbError): boolean {
  if (!err) return false
  if (err.code === "42P01" || err.code === "PGRST205") return true
  return typeof err.message === "string" && err.message.includes(TABLE) && /does not exist|schema cache/i.test(err.message)
}

export type ReliabilityCache = {
  summary: string | null
  generatedAt: string | null
}

export type ReliabilityRead = {
  /** false when the table does not exist yet (107 not applied): callers use the legacy columns. */
  available: boolean
  /** null when the table exists but holds no row for this partnership. */
  row: ReliabilityCache | null
}

/**
 * Reads the cache for one partnership the caller's organizations lead. `leadOrgIds` is REQUIRED and is
 * always applied. Throws on any error other than a missing table: a failed read must not quietly show a
 * stale legacy value.
 */
export async function readReliabilityCache(
  client: SupabaseClient,
  leadOrgIds: readonly OrgId[],
  partnershipId: string
): Promise<ReliabilityRead> {
  if (leadOrgIds.length === 0 || !partnershipId) return { available: true, row: null }

  const { data, error } = await client
    .from(TABLE)
    .select("reliability_summary, reliability_summary_generated_at")
    .in("lead_org_id", leadOrgIds as OrgId[])
    .eq("partnership_id", partnershipId)
    .maybeSingle()
  if (error) {
    if (isMissingReliabilityTable(error)) return { available: false, row: null }
    throw error
  }
  if (!data) return { available: true, row: null }
  const r = data as { reliability_summary: string | null; reliability_summary_generated_at: string | null }
  return { available: true, row: { summary: r.reliability_summary ?? null, generatedAt: r.reliability_summary_generated_at ?? null } }
}

/** A table row wins; with none (or the table absent) the legacy column pair is used. */
export function resolveReliability(legacy: ReliabilityCache, read: ReliabilityRead): ReliabilityCache {
  return read.row ?? legacy
}

/** Drops both legacy keys from a row that is about to be returned to a vendor. */
export function withoutPrivateReliability<T>(row: T): T {
  if (!row || typeof row !== "object") return row
  const {
    reliability_summary: _summary,
    reliability_summary_generated_at: _generatedAt,
    ...rest
  } = row as Record<string, unknown>
  return rest as T
}

export type ReliabilityWrite = {
  partnershipId: string
  leadOrgId: OrgId
  summary: string | null
  generatedAt: string | null
}

/**
 * Upserts the pair. Falls back to the legacy columns only when the table does not exist. Returns the
 * error rather than throwing, so the caller keeps its own failure policy (the route logs and carries on:
 * a cache that cannot be saved is recomputed on the next request).
 */
export async function writeReliabilityCache(
  client: SupabaseClient,
  w: ReliabilityWrite
): Promise<{ error: DbError; legacyFallback: boolean }> {
  const { error } = await client.from(TABLE).upsert(
    {
      partnership_id: w.partnershipId,
      lead_org_id: w.leadOrgId,
      reliability_summary: w.summary,
      reliability_summary_generated_at: w.generatedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "partnership_id" }
  )
  if (!error) return { error: null, legacyFallback: false }
  if (!isMissingReliabilityTable(error)) return { error, legacyFallback: false }

  const { error: legacyErr } = await client
    .from("partnerships")
    .update({ reliability_summary: w.summary, reliability_summary_generated_at: w.generatedAt })
    .eq("id", w.partnershipId)
    .eq("lead_org_id", w.leadOrgId)
  return { error: legacyErr, legacyFallback: true }
}
