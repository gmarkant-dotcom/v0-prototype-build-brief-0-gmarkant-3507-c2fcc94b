import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"

/**
 * The lead agency's private view of a bid: the composite evaluation score and the AI bid
 * summaries. Migration 109 moves them out of partner_rfp_responses into
 * public.partner_rfp_response_private, which has no vendor policy.
 *
 * WHY A TABLE AND NOT A COLUMN GRANT: the same reason as lib/server/partnership-private-notes.ts.
 * An agency member and a vendor are both the role `authenticated`, which holds table-wide
 * privilege on partner_rfp_responses; "Partners select own RFP responses" admits the whole row,
 * and "Partners update own RFP responses" has no column limit, so a vendor can READ these values
 * and can also SET them on its own bid. Nothing but a separate table separates the two.
 *
 * RULES:
 *  1. EVERY READ IS AGENCY-SCOPED. `readResponsePrivate` requires the caller's lead organization
 *     ids and always filters on them.
 *  2. IT WORKS BEFORE AND AFTER 109 IS APPLIED, AND FALLS BACK ONLY WHEN THE TABLE IS MISSING.
 *     While the table does not exist (42P01 / PGRST205), reads use the legacy columns and writes
 *     go to them. Once it exists, the table is the only source: a response with no table row reads
 *     as all-null, NEVER as the legacy value. This differs from the 105 and 107 helpers on purpose:
 *     109's backfill copies every non-null legacy value, so after 109 a legacy value with no table
 *     row can only have been written since, and the one party that can still write the legacy
 *     columns is the vendor (until 110). Reading it would show the agency a vendor-forged score.
 *     The fallback is OWED FOR REMOVAL once 109 and 110 are applied and verified - see
 *     docs/109-112-split-report.md.
 *  3. WRITES NEVER SEND lead_org_id. 109's guard trigger sets it from the parent response row.
 */

const TABLE = "partner_rfp_response_private"
const CHUNK = 150

export const RESPONSE_PRIVATE_COLUMNS = [
  "composite_score",
  "ai_summary_short",
  "ai_summary_detailed",
  "ai_summary_generated_at",
] as const

export type ResponsePrivate = {
  composite_score: number | null
  ai_summary_short: string | null
  ai_summary_detailed: string | null
  ai_summary_generated_at: string | null
}

const EMPTY: ResponsePrivate = {
  composite_score: null,
  ai_summary_short: null,
  ai_summary_detailed: null,
  ai_summary_generated_at: null,
}

type DbError = { code?: string | null; message?: string | null } | null | undefined

/** 42P01 from Postgres; PGRST205 from PostgREST when the table is not in its schema cache. */
export function isMissingResponsePrivateTable(err: DbError): boolean {
  if (!err) return false
  if (err.code === "42P01" || err.code === "PGRST205") return true
  return typeof err.message === "string" && err.message.includes(TABLE) && /does not exist|schema cache/i.test(err.message)
}

export type ResponsePrivateRead = {
  /** false when the table does not exist yet (109 not applied): callers use the legacy columns. */
  available: boolean
  byResponse: Map<string, ResponsePrivate>
}

function chunked<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

function pick(row: Record<string, unknown> | null | undefined): ResponsePrivate {
  if (!row) return { ...EMPTY }
  return {
    composite_score: (row.composite_score as number | null | undefined) ?? null,
    ai_summary_short: (row.ai_summary_short as string | null | undefined) ?? null,
    ai_summary_detailed: (row.ai_summary_detailed as string | null | undefined) ?? null,
    ai_summary_generated_at: (row.ai_summary_generated_at as string | null | undefined) ?? null,
  }
}

/**
 * Reads the private fields for responses the caller's organizations lead. `leadOrgIds` is
 * REQUIRED and always applied. Throws on any error other than a missing table: a failed read
 * must not quietly show a legacy value.
 */
export async function readResponsePrivate(
  client: SupabaseClient,
  leadOrgIds: readonly OrgId[],
  responseIds: readonly string[]
): Promise<ResponsePrivateRead> {
  const byResponse = new Map<string, ResponsePrivate>()
  const ids = Array.from(new Set(responseIds.filter(Boolean)))
  if (leadOrgIds.length === 0 || ids.length === 0) return { available: true, byResponse }

  for (const idChunk of chunked(ids)) {
    const { data, error } = await client
      .from(TABLE)
      .select(`response_id, ${RESPONSE_PRIVATE_COLUMNS.join(", ")}`)
      .in("lead_org_id", leadOrgIds as OrgId[])
      .in("response_id", idChunk)
    if (error) {
      if (isMissingResponsePrivateTable(error)) return { available: false, byResponse: new Map() }
      throw error
    }
    for (const row of (data || []) as unknown as Record<string, unknown>[]) {
      byResponse.set(String(row.response_id), pick(row))
    }
  }
  return { available: true, byResponse }
}

/**
 * Table absent: the legacy values carried on the parent row. Table present: the table row, or
 * all-null when there is none. Never a mix of the two.
 */
export function resolveResponsePrivate(
  legacyRow: Record<string, unknown> | null | undefined,
  read: ResponsePrivateRead,
  responseId: string
): ResponsePrivate {
  if (!read.available) return pick(legacyRow)
  return read.byResponse.get(responseId) ?? { ...EMPTY }
}

/**
 * Replaces the four keys on each row with the resolved values, so agency wire shapes are
 * unchanged. Rows must carry `id`; the legacy values are taken from the row itself when the
 * table is absent, so callers keep selecting the legacy columns until the fallback is removed.
 */
export async function attachResponsePrivate<T extends Record<string, unknown>>(
  client: SupabaseClient,
  leadOrgIds: readonly OrgId[],
  rows: readonly T[] | null | undefined
): Promise<T[]> {
  const list = (rows || []) as T[]
  if (list.length === 0) return list
  const read = await readResponsePrivate(client, leadOrgIds, list.map((r) => String(r.id)))
  return list.map((r) => ({ ...r, ...resolveResponsePrivate(r, read, String(r.id)) }))
}

/** Drops the four legacy keys from a row that is about to be returned to a vendor or guest. */
export function withoutResponsePrivate<T>(row: T): T {
  if (!row || typeof row !== "object") return row
  const {
    composite_score: _score,
    ai_summary_short: _short,
    ai_summary_detailed: _detailed,
    ai_summary_generated_at: _generatedAt,
    ...rest
  } = row as Record<string, unknown>
  return rest as T
}

/**
 * Upserts whichever of the four fields are given (PostgREST updates only the columns sent, so a
 * score write leaves the summaries alone and the reverse). Falls back to the legacy columns only
 * when the table does not exist. `leadOrgIds` scopes that fallback; the table write never sends
 * lead_org_id because 109's guard sets it from the parent. Returns the error rather than throwing.
 */
export async function writeResponsePrivate(
  client: SupabaseClient,
  leadOrgIds: readonly OrgId[],
  responseId: string,
  fields: Partial<ResponsePrivate>
): Promise<{ error: DbError; legacyFallback: boolean }> {
  const patch: Record<string, unknown> = {}
  for (const k of RESPONSE_PRIVATE_COLUMNS) if (k in fields) patch[k] = fields[k]
  if (!responseId || Object.keys(patch).length === 0) return { error: null, legacyFallback: false }

  const { error } = await client.from(TABLE).upsert({ response_id: responseId, ...patch }, { onConflict: "response_id" })
  if (!error) return { error: null, legacyFallback: false }
  if (!isMissingResponsePrivateTable(error)) return { error, legacyFallback: false }

  if (leadOrgIds.length === 0) return { error: { code: "LGSCOPE", message: "no lead organization to scope the legacy write" }, legacyFallback: true }
  const { error: legacyErr } = await client
    .from("partner_rfp_responses")
    .update(patch)
    .eq("id", responseId)
    .in("lead_org_id", leadOrgIds as OrgId[])
  return { error: legacyErr, legacyFallback: true }
}

// ---------------------------------------------------------------------------------------------
// THE VENDOR AND GUEST COLUMN LIST.
//
// Exactly the partner_rfp_responses columns a vendor or guest screen renders or the vendor
// routes use (docs/109-112-split-report.md, Phase 0.2): app/partner/rfps/[id]/page.tsx
// ResponseRow and app/rfp/respond/[token]/page.tsx SubmittedResponse. Every vendor-path read
// that used select("*") or a bare .select() now uses this list, so a column added to the table
// later is not sent to a vendor by default.
// ---------------------------------------------------------------------------------------------
const VENDOR_RESPONSE_BASE = [
  "id",
  "proposal_text",
  "budget_proposal",
  "timeline_proposal",
  "payment_terms",
  "terms_disclosure",
  "attachments",
  "business_criteria_responses",
  "status",
  "agency_feedback",
  "feedback_updated_at",
  "submitted_at",
  "updated_at",
] as const

/** Columns from migrations 071, 072 and 076, the same set the save routes treat as optional. */
const VENDOR_RESPONSE_OPTIONAL = ["business_criteria_acknowledgments", "budget_lines", "proposal_sections"] as const

export const VENDOR_RESPONSE_COLUMNS = [...VENDOR_RESPONSE_BASE, ...VENDOR_RESPONSE_OPTIONAL].join(", ")
const VENDOR_RESPONSE_COLUMNS_MINIMAL = VENDOR_RESPONSE_BASE.join(", ")

/**
 * Runs a vendor-path read with VENDOR_RESPONSE_COLUMNS, retrying once without the three optional
 * columns on 42703 (undefined_column), so a database missing one of them degrades to the fields
 * it has instead of failing the read. docs/schema-truth.md records all three as live.
 */
export async function selectVendorResponse<T>(
  run: (columns: string) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  const first = await run(VENDOR_RESPONSE_COLUMNS)
  if (!first.error || first.error.code !== "42703") return first
  console.warn("[rfp-response-private] an optional vendor response column is missing, retrying without them")
  return run(VENDOR_RESPONSE_COLUMNS_MINIMAL)
}
