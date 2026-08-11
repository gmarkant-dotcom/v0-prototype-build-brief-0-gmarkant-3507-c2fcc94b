/**
 * Per-RFP evaluation criteria (Phase 2, P2-3).
 *
 * Evaluation criteria are SCORED QUALITY DIMENSIONS - "how good is this bid on creative
 * approach". Business criteria are CONFIRMABLE COMPLIANCE FACTS - "does this vendor hold MBE
 * certification". The two are never blurred: different storage, different editors, different
 * surfaces, different vocabulary. This module owns only the first.
 *
 * Storage, same dual-flow JSONB precedent as business_criteria_required and budget_categories:
 *   wizard flow     -> partner_rfp_inbox.master_rfp_json.evaluation_criteria
 *   magic-link flow -> rfp_magic_tokens.evaluation_criteria   (migration 075)
 *
 * An RFP with no rubric of its own falls back to the agency's global bid_scoring_criteria, and
 * nothing about scoring changes for it - which is every RFP that exists today, and every RFP at
 * all before 075 is applied.
 */

import { DEFAULT_SCORING_CRITERIA } from "@/lib/bid-scoring-defaults"

export type RfpEvaluationCriterion = {
  /** Stable id, generated once at authoring time. Survives the broadcast fan-out (one
   *  master_rfp_json copy per inbox row) with its identity intact, and is what a per-RFP score
   *  row stores in bid_evaluation_scores.rfp_criterion_key. */
  key: string
  name: string
  description: string
  /** Relative, like bid_scoring_criteria.default_weight. Defaults to equal (1.0). */
  weight: number
  origin: "default" | "custom"
  sort_order: number
}

/** Hard cap, enforced app-side. This run's instruction says "cap 8 enforced app-side" and
 *  "cap 8 with quiet guidance" - the same number said twice, once as an enforcement word. The
 *  Add control disables at the cap with a quiet line rather than a blocking error.
 *  Deliberately different from budget categories, which only advise past 10. */
export const MAX_RFP_EVALUATION_CRITERIA = 8

export const MIN_CRITERION_WEIGHT = 0.5
export const MAX_CRITERION_WEIGHT = 3.0

/** Synthetic criterion id used everywhere a per-RFP criterion has to stand in for a
 *  bid_scoring_criteria row id - the evaluation API's wire format and the Evaluate tab's draft
 *  keying. Prefixed so the two id spaces can never be confused for one another, in either
 *  direction, at any layer. */
export const RFP_CRITERION_ID_PREFIX = "rfp:"

export function toSyntheticCriterionId(key: string): string {
  return `${RFP_CRITERION_ID_PREFIX}${key}`
}

/** Returns the rubric key for a synthetic id, or null for a real bid_scoring_criteria uuid. */
export function parseSyntheticCriterionId(id: string): string | null {
  return id.startsWith(RFP_CRITERION_ID_PREFIX) ? id.slice(RFP_CRITERION_ID_PREFIX.length) : null
}

let keyCounter = 0
export function makeCriterionKey(seed?: string): string {
  keyCounter += 1
  const base = (seed || "crit")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
  return `${base || "crit"}_${Date.now().toString(36)}${keyCounter.toString(36)}`
}

function clampWeight(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""))
  if (!Number.isFinite(n)) return 1.0
  return Math.min(MAX_CRITERION_WEIGHT, Math.max(MIN_CRITERION_WEIGHT, Math.round(n * 10) / 10))
}

/** Tolerates null, undefined, a missing column, a JSON string, or a malformed array. Enforces
 *  the cap on read as well as on write, so a hand-edited blob can never widen it. */
export function normalizeRfpEvaluationCriteria(raw: unknown): RfpEvaluationCriterion[] {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const out: RfpEvaluationCriterion[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const name = typeof e.name === "string" ? e.name.trim() : ""
    if (!name) continue
    const key = (typeof e.key === "string" ? e.key.trim() : "") || makeCriterionKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key,
      name,
      description: typeof e.description === "string" ? e.description.trim() : "",
      weight: clampWeight(e.weight),
      origin: e.origin === "custom" ? "custom" : "default",
      sort_order: typeof e.sort_order === "number" ? e.sort_order : out.length,
    })
    if (out.length >= MAX_RFP_EVALUATION_CRITERIA) break
  }
  return out.sort((a, b) => a.sort_order - b.sort_order).map((c, i) => ({ ...c, sort_order: i }))
}

/** The seven defaults from lib/bid-scoring-defaults.ts, pre-loaded into a new RFP's rubric.
 *  They are the same dimensions the global rubric ships with, so an agency that changes nothing
 *  scores exactly what it scores today - the difference is that here they are removable,
 *  renamable, reorderable, and per-RFP. */
export function seedRfpEvaluationCriteria(): RfpEvaluationCriterion[] {
  return DEFAULT_SCORING_CRITERIA.slice(0, MAX_RFP_EVALUATION_CRITERIA).map((c, i) => ({
    key: makeCriterionKey(c.name),
    name: c.name,
    description: c.description,
    weight: clampWeight(c.default_weight),
    origin: "default" as const,
    sort_order: i,
  }))
}

export function resequenceCriteria(criteria: RfpEvaluationCriterion[]): RfpEvaluationCriterion[] {
  return criteria.map((c, i) => ({ ...c, sort_order: i }))
}

/** Reads the rubric off the wizard flow's existing JSONB blob. Absent means "this RFP has no
 *  rubric of its own", which is the global-defaults path. */
export function readRfpEvaluationCriteriaFromMasterRfpJson(masterRfpJson: unknown): RfpEvaluationCriterion[] {
  if (!masterRfpJson || typeof masterRfpJson !== "object") return []
  return normalizeRfpEvaluationCriteria((masterRfpJson as Record<string, unknown>).evaluation_criteria)
}

/** Plain-text rubric for the AI pre-scoring prompt, so the model scores against what the agency
 *  actually asked for rather than against the seven built-in dimensions. */
export function formatRubricForPrompt(criteria: RfpEvaluationCriterion[]): string {
  if (criteria.length === 0) return ""
  return criteria
    .map((c, i) => `${i + 1}. ${c.name} (weight ${c.weight})${c.description ? `\n   ${c.description}` : ""}`)
    .join("\n")
}
