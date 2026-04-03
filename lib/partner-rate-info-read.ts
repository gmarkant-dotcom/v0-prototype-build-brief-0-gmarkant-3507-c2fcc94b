/** Read-only rate card parsing (aligned with app/api/partner/rate-info). */

const RATE_INFO_BIO_MARKER = "\n\n__LIGAMENT_PARTNER_RATE_V1__\n"
const BY_PARTNERSHIP_KEY = "by_partnership_id" as const

export type PartnerRateInfoPayload = {
  hourly_rate: string
  project_minimum: string
  payment_terms: string
  payment_terms_custom: string
  notes: string
}

const defaultRateInfo = (): PartnerRateInfoPayload => ({
  hourly_rate: "",
  project_minimum: "",
  payment_terms: "net_30",
  payment_terms_custom: "",
  notes: "",
})

function mergeRateInfo(base: PartnerRateInfoPayload, patch: Partial<PartnerRateInfoPayload>): PartnerRateInfoPayload {
  return {
    hourly_rate: patch.hourly_rate !== undefined ? String(patch.hourly_rate) : base.hourly_rate,
    project_minimum: patch.project_minimum !== undefined ? String(patch.project_minimum) : base.project_minimum,
    payment_terms: patch.payment_terms !== undefined ? String(patch.payment_terms) : base.payment_terms,
    payment_terms_custom:
      patch.payment_terms_custom !== undefined ? String(patch.payment_terms_custom) : base.payment_terms_custom,
    notes: patch.notes !== undefined ? String(patch.notes) : base.notes,
  }
}

export function extractMapAndLegacy(raw: unknown): {
  map: Record<string, PartnerRateInfoPayload>
  legacy: PartnerRateInfoPayload | null
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { map: {}, legacy: null }
  const o = raw as Record<string, unknown>
  const by = o[BY_PARTNERSHIP_KEY]
  if (by && typeof by === "object" && !Array.isArray(by)) {
    const map: Record<string, PartnerRateInfoPayload> = {}
    for (const [k, v] of Object.entries(by as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        map[k] = mergeRateInfo(defaultRateInfo(), v as Partial<PartnerRateInfoPayload>)
      }
    }
    return { map, legacy: null }
  }
  if (
    "hourly_rate" in o ||
    "project_minimum" in o ||
    "payment_terms" in o ||
    "payment_terms_custom" in o ||
    "notes" in o
  ) {
    return { map: {}, legacy: mergeRateInfo(defaultRateInfo(), o as Partial<PartnerRateInfoPayload>) }
  }
  return { map: {}, legacy: null }
}

function rateForPartnership(
  partnershipId: string,
  map: Record<string, PartnerRateInfoPayload>,
  legacy: PartnerRateInfoPayload | null
): PartnerRateInfoPayload {
  if (map[partnershipId]) return map[partnershipId]
  if (legacy) return legacy
  return defaultRateInfo()
}

function parseRateInfoFromBio(rawBio: string | null): {
  cleanBio: string
  map: Record<string, PartnerRateInfoPayload>
  legacy: PartnerRateInfoPayload | null
} {
  if (!rawBio) return { cleanBio: "", map: {}, legacy: null }
  const idx = rawBio.indexOf(RATE_INFO_BIO_MARKER)
  if (idx === -1) return { cleanBio: rawBio.trim(), map: {}, legacy: null }
  const cleanBio = rawBio.slice(0, idx).trimEnd()
  const jsonPart = rawBio.slice(idx + RATE_INFO_BIO_MARKER.length).trim()
  try {
    const parsed = JSON.parse(jsonPart) as unknown
    const { map, legacy } = extractMapAndLegacy(parsed)
    if (Object.keys(map).length === 0 && legacy) {
      return { cleanBio, map: {}, legacy }
    }
    if (Object.keys(map).length > 0) {
      return { cleanBio, map, legacy }
    }
    const flat = mergeRateInfo(defaultRateInfo(), (parsed as Partial<PartnerRateInfoPayload>) || {})
    return { cleanBio, map: {}, legacy: flat }
  } catch {
    return { cleanBio: rawBio.trim(), map: {}, legacy: null }
  }
}

export function isMissingRateInfoColumnError(err: { message?: string; code?: string } | null): boolean {
  if (!err?.message) return false
  const m = err.message.toLowerCase()
  return m.includes("rate_info") || (m.includes("column") && m.includes("does not exist"))
}

/**
 * Partner-scoped rate row for a given partnership (by_partnership_id map or legacy), with bio stripped of embedded rate JSON.
 */
export function resolveRateInfoForPartnership(
  row: { bio: string | null; rate_info?: unknown },
  partnershipId: string
): { bio_display: string; rate_info: PartnerRateInfoPayload } {
  let map: Record<string, PartnerRateInfoPayload> = {}
  let legacy: PartnerRateInfoPayload | null = null

  if (row.rate_info != null) {
    const p = extractMapAndLegacy(row.rate_info)
    map = p.map
    legacy = p.legacy
  }

  const b = parseRateInfoFromBio(row.bio)
  if (Object.keys(b.map).length > 0) {
    map = { ...map, ...b.map }
  }
  if (b.legacy) {
    legacy = legacy ?? b.legacy
  }

  return {
    bio_display: b.cleanBio,
    rate_info: rateForPartnership(partnershipId, map, legacy),
  }
}
