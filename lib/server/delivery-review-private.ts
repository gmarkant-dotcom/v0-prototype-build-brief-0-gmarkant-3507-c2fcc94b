import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgId } from "@/lib/entitlements"

/**
 * The lead agency's private notes on a completed engagement: the on-time and on-budget notes,
 * the client's feedback, the AI delta summary, would-work-again and the budget variance.
 * Migration 111 moves them out of delivery_reviews into public.delivery_review_private, which has
 * no vendor policy.
 *
 * WHY A TABLE: "Partners view own complete delivery reviews" admits the WHOLE row of every
 * completed review on the vendor's partnerships, and agency and vendor are both `authenticated`,
 * so a column grant removes nothing. The vendor screens render only composite_score, on_time,
 * on_budget and overall_satisfaction (app/partner/projects/page.tsx, app/partner/page.tsx), which
 * stay on delivery_reviews.
 *
 * 111 SUPERSEDES THE NEVER-APPLIED 073 FOR COLUMN PRIVACY. 073's per-review "shared with vendor"
 * flag is a separate, unruled product decision and is not implemented here or anywhere else.
 *
 * RULES, as lib/server/rfp-response-private.ts:
 *  1. EVERY READ IS AGENCY-SCOPED, on the review's org_id (delivery_reviews' agency key, 079).
 *  2. FALLBACK ONLY WHEN THE TABLE IS MISSING (42P01 / PGRST205). Once it exists, a review with no
 *     table row reads as all-null, never as the legacy value. OWED FOR REMOVAL once 111 and 112
 *     are applied and verified - see docs/109-112-split-report.md.
 *  3. WRITES NEVER SEND org_id. 111's guard trigger sets it from the parent review.
 */

const TABLE = "delivery_review_private"
const CHUNK = 150

export const REVIEW_PRIVATE_COLUMNS = [
  "on_time_notes",
  "on_budget_notes",
  "client_feedback",
  "ai_delta_summary",
  "would_work_again",
  "budget_variance_pct",
] as const

export type ReviewPrivate = {
  on_time_notes: string | null
  on_budget_notes: string | null
  client_feedback: string | null
  ai_delta_summary: string | null
  would_work_again: string | null
  budget_variance_pct: number | null
}

const EMPTY: ReviewPrivate = {
  on_time_notes: null,
  on_budget_notes: null,
  client_feedback: null,
  ai_delta_summary: null,
  would_work_again: null,
  budget_variance_pct: null,
}

type DbError = { code?: string | null; message?: string | null } | null | undefined

/** 42P01 from Postgres; PGRST205 from PostgREST when the table is not in its schema cache. */
export function isMissingReviewPrivateTable(err: DbError): boolean {
  if (!err) return false
  if (err.code === "42P01" || err.code === "PGRST205") return true
  return typeof err.message === "string" && err.message.includes(TABLE) && /does not exist|schema cache/i.test(err.message)
}

export type ReviewPrivateRead = {
  /** false when the table does not exist yet (111 not applied): callers use the legacy columns. */
  available: boolean
  byReview: Map<string, ReviewPrivate>
}

function chunked<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

function pick(row: Record<string, unknown> | null | undefined): ReviewPrivate {
  if (!row) return { ...EMPTY }
  return {
    on_time_notes: (row.on_time_notes as string | null | undefined) ?? null,
    on_budget_notes: (row.on_budget_notes as string | null | undefined) ?? null,
    client_feedback: (row.client_feedback as string | null | undefined) ?? null,
    ai_delta_summary: (row.ai_delta_summary as string | null | undefined) ?? null,
    would_work_again: (row.would_work_again as string | null | undefined) ?? null,
    budget_variance_pct: (row.budget_variance_pct as number | null | undefined) ?? null,
  }
}

/**
 * Reads the private fields for reviews owned by the caller's organizations. `orgIds` is REQUIRED
 * and always applied. Throws on any error other than a missing table.
 */
export async function readReviewPrivate(
  client: SupabaseClient,
  orgIds: readonly OrgId[],
  reviewIds: readonly string[]
): Promise<ReviewPrivateRead> {
  const byReview = new Map<string, ReviewPrivate>()
  const ids = Array.from(new Set(reviewIds.filter(Boolean)))
  if (orgIds.length === 0 || ids.length === 0) return { available: true, byReview }

  for (const idChunk of chunked(ids)) {
    const { data, error } = await client
      .from(TABLE)
      .select(`review_id, ${REVIEW_PRIVATE_COLUMNS.join(", ")}`)
      .in("org_id", orgIds as OrgId[])
      .in("review_id", idChunk)
    if (error) {
      if (isMissingReviewPrivateTable(error)) return { available: false, byReview: new Map() }
      throw error
    }
    for (const row of (data || []) as unknown as Record<string, unknown>[]) {
      byReview.set(String(row.review_id), pick(row))
    }
  }
  return { available: true, byReview }
}

/** Table absent: the legacy values on the review row. Table present: its row, or all-null. */
export function resolveReviewPrivate(
  legacyRow: Record<string, unknown> | null | undefined,
  read: ReviewPrivateRead,
  reviewId: string
): ReviewPrivate {
  if (!read.available) return pick(legacyRow)
  return read.byReview.get(reviewId) ?? { ...EMPTY }
}

/** Replaces the six keys on each row (rows must carry `id`) so agency wire shapes are unchanged. */
export async function attachReviewPrivate<T extends Record<string, unknown>>(
  client: SupabaseClient,
  orgIds: readonly OrgId[],
  rows: readonly T[] | null | undefined
): Promise<T[]> {
  const list = (rows || []) as T[]
  if (list.length === 0) return list
  const read = await readReviewPrivate(client, orgIds, list.map((r) => String(r.id)))
  return list.map((r) => ({ ...r, ...resolveReviewPrivate(r, read, String(r.id)) }))
}

/**
 * Upserts whichever of the six fields are given. Falls back to the legacy columns only when the
 * table does not exist, scoped by `orgIds`. Returns the error rather than throwing.
 */
export async function writeReviewPrivate(
  client: SupabaseClient,
  orgIds: readonly OrgId[],
  reviewId: string,
  fields: Partial<ReviewPrivate>
): Promise<{ error: DbError; legacyFallback: boolean }> {
  const patch: Record<string, unknown> = {}
  for (const k of REVIEW_PRIVATE_COLUMNS) if (k in fields) patch[k] = fields[k]
  if (!reviewId || Object.keys(patch).length === 0) return { error: null, legacyFallback: false }

  const { error } = await client.from(TABLE).upsert({ review_id: reviewId, ...patch }, { onConflict: "review_id" })
  if (!error) return { error: null, legacyFallback: false }
  if (!isMissingReviewPrivateTable(error)) return { error, legacyFallback: false }

  if (orgIds.length === 0) return { error: { code: "LGSCOPE", message: "no organization to scope the legacy write" }, legacyFallback: true }
  const { error: legacyErr } = await client
    .from("delivery_reviews")
    .update(patch)
    .eq("id", reviewId)
    .in("org_id", orgIds as OrgId[])
  return { error: legacyErr, legacyFallback: true }
}
