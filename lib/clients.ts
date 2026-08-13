/**
 * Client profiles (Workstream A). A reusable record of an end client - Samsung, adidas - that an
 * agency sets up once and then selects anywhere a client is named, so that client's documents
 * and standing requirements auto-apply instead of being re-entered.
 *
 * Storage: the `clients` table (migration 077), agency-scoped. Documents are
 * agency_library_documents rows carrying this client's id, not a separate table - see
 * docs/client-profiles-discovery.md section 2.
 *
 * PRIVACY. `notes` is internal to the agency and must never reach a vendor. Only documents and
 * criteria an agency deliberately places into an RFP travel outward. Enforced by never selecting
 * `notes` on any vendor-facing route, and stated in UI copy wherever notes are edited.
 *
 * PRE-MIGRATION. Before 077 is applied the table does not exist and PostgREST answers 42P01
 * (undefined_table). Every reader here treats that as "the feature is not configured yet" and
 * every surface renders an honest empty state rather than an error - see isMissingClientsTable.
 */

import { normalizeBusinessCriteriaRequired, type BusinessCriteriaRequired } from "@/lib/business-criteria"
import { normalizeRfpEvaluationCriteria, type RfpEvaluationCriterion } from "@/lib/rfp-evaluation-criteria"

export type ClientProfile = {
  id: string
  name: string
  /** Internal to the agency. Never sent to a vendor, on any surface, ever. */
  notes: string | null
  /** Same shape the RFP wizard already consumes. Null means this profile sets no default. */
  default_business_criteria: BusinessCriteriaRequired | null
  default_evaluation_criteria: RfpEvaluationCriterion[]
  created_at?: string | null
  updated_at?: string | null
}

/** The lighter shape every selector needs - no notes, so a selector can never leak them. */
export type ClientOption = {
  id: string
  name: string
}

/**
 * 42P01 is undefined_table, which is what a missing `clients` table answers with - NOT 42703
 * (undefined_column), which is what the write guards elsewhere in this codebase catch. The house
 * precedent for a whole missing table already exists in
 * app/api/agency/library-documents/route.ts, which maps 42P01 to a 503 rather than a 500.
 */
export function isMissingClientsTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01"
}

function coerceString(v: unknown): string {
  return typeof v === "string" ? v : ""
}

/** Tolerates a missing column, a null, or anything malformed. */
export function normalizeClientProfile(raw: unknown): ClientProfile | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = coerceString(r.id).trim()
  const name = coerceString(r.name).trim()
  if (!id || !name) return null
  const notes = coerceString(r.notes).trim()
  // Defaults are normalized on READ as well as on write, so a hand-edited profile can never push
  // a malformed blob, or a 12-criterion rubric, into a wizard that caps at 8.
  const bc = r.default_business_criteria
  return {
    id,
    name,
    notes: notes || null,
    default_business_criteria: bc == null ? null : normalizeBusinessCriteriaRequired(bc),
    default_evaluation_criteria: normalizeRfpEvaluationCriteria(r.default_evaluation_criteria),
    created_at: coerceString(r.created_at) || null,
    updated_at: coerceString(r.updated_at) || null,
  }
}

export function normalizeClientOptions(rows: unknown): ClientOption[] {
  if (!Array.isArray(rows)) return []
  const out: ClientOption[] = []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const id = coerceString(r.id).trim()
    const name = coerceString(r.name).trim()
    if (id && name) out.push({ id, name })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The comparison behind the duplicate warning and behind A3's one-option rule. Two client names
 *  are the same client when they are the same after trimming and lowercasing - "Adidas" typed on
 *  a legacy project and an "adidas" profile are one client, not two. */
export function normalizeClientNameForMatch(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase()
}

export function findClientByName(clients: ClientOption[], name: string): ClientOption | null {
  const target = normalizeClientNameForMatch(name)
  if (!target) return null
  return clients.find((c) => normalizeClientNameForMatch(c.name) === target) ?? null
}

/** True when this profile carries anything a flow can pre-fill from. Drives the honest "no
 *  defaults set" copy rather than rendering an empty criteria block that looks broken. */
export function hasClientDefaults(profile: ClientProfile | null | undefined): boolean {
  if (!profile) return false
  if (profile.default_evaluation_criteria.length > 0) return true
  const bc = profile.default_business_criteria
  if (!bc) return false
  return (
    Object.keys(bc.designations).length > 0 ||
    Object.keys(bc.insurance).length > 0 ||
    Boolean(bc.notes?.trim())
  )
}
