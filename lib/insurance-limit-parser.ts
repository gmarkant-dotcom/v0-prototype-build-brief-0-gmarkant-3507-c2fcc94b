/**
 * Parses free-text insurance limit strings (e.g. "$1M/$2M") into numeric per-occurrence and
 * aggregate amounts, and compares a held limit against a required minimum.
 *
 * Sibling module to lib/business-criteria.ts - kept separate since this is a narrow, pure
 * text-parsing concern with its own test file, not part of the business criteria shape itself.
 */

export interface ParsedInsuranceLimit {
  perOccurrence: number | null
  aggregate: number | null
}

/**
 * Parses a single amount token like "$1M", "1,000,000", "2 million", "500k". Returns null for
 * anything without a recognizable leading number (e.g. "Statutory", "TBD", "N/A").
 */
function parseAmountToken(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const match = s.match(/^\$?\s*([\d,]+(?:\.\d+)?)\s*(million|mm|thousand|m|k)?\.?$/i)
  if (!match) return null
  const numeric = parseFloat(match[1].replace(/,/g, ""))
  if (!Number.isFinite(numeric)) return null
  const suffix = (match[2] || "").toLowerCase()
  let multiplier = 1
  if (suffix === "k" || suffix === "thousand") multiplier = 1_000
  else if (suffix === "m" || suffix === "mm" || suffix === "million") multiplier = 1_000_000
  return numeric * multiplier
}

/**
 * Parses free text like "$1M/$2M", "$1M per occurrence / $2M aggregate", "1M", "$1,000,000",
 * or "2 million" into { perOccurrence, aggregate }. Returns null when nothing numeric could be
 * extracted (e.g. "Statutory", "TBD", "N/A", empty string).
 *
 * A bare single amount with no slash and no per-occurrence/aggregate label (e.g. "$2M") is
 * treated as applying to both dimensions - it is the only stated limit, not a guess at a
 * second number.
 */
export function parseInsuranceLimit(text: string | null | undefined): ParsedInsuranceLimit | null {
  if (typeof text !== "string") return null
  const raw = text.trim()
  if (!raw) return null

  const occurrenceMatch = raw.match(/\$?\s*([\d,]+(?:\.\d+)?\s*(?:million|mm|thousand|m|k)?)\s*(?:per\s*occurrence|per\s*claim|occurrence)/i)
  const aggregateMatch = raw.match(/\$?\s*([\d,]+(?:\.\d+)?\s*(?:million|mm|thousand|m|k)?)\s*(?:general\s*aggregate|annual\s*aggregate|aggregate)/i)
  if (occurrenceMatch || aggregateMatch) {
    const perOccurrence = occurrenceMatch ? parseAmountToken(occurrenceMatch[1]) : null
    const aggregate = aggregateMatch ? parseAmountToken(aggregateMatch[1]) : null
    if (perOccurrence == null && aggregate == null) return null
    return { perOccurrence, aggregate }
  }

  if (raw.includes("/")) {
    const parts = raw.split("/").map((p) => p.trim()).filter(Boolean)
    if (parts.length === 2) {
      const first = parseAmountToken(parts[0])
      const second = parseAmountToken(parts[1])
      if (first != null && second != null) {
        return { perOccurrence: first, aggregate: second }
      }
    }
  }

  const single = parseAmountToken(raw)
  if (single != null) return { perOccurrence: single, aggregate: single }

  return null
}

export type InsuranceMinimumResult = "met" | "not_met" | "unknown"

/**
 * Compares a held insurance limit against a required minimum. Returns "unknown" - never a
 * guess - whenever either side is unparseable, or when the required minimum specifies a
 * dimension (per-occurrence or aggregate) the held limit doesn't state.
 */
export function meetsInsuranceMinimum(
  heldLimitText: string | null | undefined,
  requiredMinimumText: string | null | undefined
): InsuranceMinimumResult {
  const held = parseInsuranceLimit(heldLimitText)
  const required = parseInsuranceLimit(requiredMinimumText)
  if (!held || !required) return "unknown"

  const checks: boolean[] = []
  if (required.perOccurrence != null) {
    if (held.perOccurrence == null) return "unknown"
    checks.push(held.perOccurrence >= required.perOccurrence)
  }
  if (required.aggregate != null) {
    if (held.aggregate == null) return "unknown"
    checks.push(held.aggregate >= required.aggregate)
  }
  if (checks.length === 0) return "unknown"
  return checks.every(Boolean) ? "met" : "not_met"
}
