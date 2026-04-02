import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

/** Embedded JSON in `profiles.bio` when `rate_info` column is missing. */
const RATE_INFO_BIO_MARKER = "\n\n__LIGAMENT_PARTNER_RATE_V1__\n"

/** JSONB root: map of partnership_id → rate fields. */
const BY_PARTNERSHIP_KEY = "by_partnership_id" as const

type PartnerRateInfoPayload = {
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

function extractMapAndLegacy(raw: unknown): {
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
  partnershipId: string | null,
  map: Record<string, PartnerRateInfoPayload>,
  legacy: PartnerRateInfoPayload | null
): PartnerRateInfoPayload {
  if (partnershipId && map[partnershipId]) return map[partnershipId]
  if (partnershipId && legacy) return legacy
  if (!partnershipId && legacy) return legacy
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

function isMissingRateInfoColumnError(err: { message?: string; code?: string } | null): boolean {
  if (!err?.message) return false
  const m = err.message.toLowerCase()
  return m.includes("rate_info") || (m.includes("column") && m.includes("does not exist"))
}

async function assertPartnerOwnsPartnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  partnershipId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("partnerships")
    .select("id, partner_id, status")
    .eq("id", partnershipId)
    .maybeSingle()
  if (error || !data) return false
  if (data.partner_id !== userId) return false
  if (String(data.status || "").toLowerCase() !== "active") return false
  return true
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403, headers: noStore })
    }

    const partnershipId = request.nextUrl.searchParams.get("partnershipId")
    if (partnershipId) {
      const ok = await assertPartnerOwnsPartnership(supabase, user.id, partnershipId)
      if (!ok) {
        return NextResponse.json({ error: "Invalid or inactive partnership" }, { status: 403, headers: noStore })
      }
    }

    let withRate = await supabase
      .from("profiles")
      .select("bio, location, website, rate_info")
      .eq("id", user.id)
      .single()

    let storage: "column" | "bio_embedded" = "column"
    let migrationNote: string | null = null

    if (withRate.error && isMissingRateInfoColumnError(withRate.error)) {
      withRate = await supabase.from("profiles").select("bio, location, website").eq("id", user.id).single()
      storage = "bio_embedded"
      migrationNote =
        "rate_info column missing on profiles; values are read from an embedded payload in bio. Add column with scripts/030-partner-payments-rls.sql."
    }

    if (withRate.error || !withRate.data) {
      console.error("[api/partner/rate-info] GET profile failed", withRate.error)
      return NextResponse.json({ error: "Failed to load profile" }, { status: 500, headers: noStore })
    }

    const row = withRate.data as {
      bio: string | null
      location: string | null
      website: string | null
      rate_info?: unknown
    }

    let map: Record<string, PartnerRateInfoPayload> = {}
    let legacy: PartnerRateInfoPayload | null = null

    if (storage === "column" && row.rate_info != null) {
      const parsed = extractMapAndLegacy(row.rate_info)
      map = parsed.map
      legacy = parsed.legacy
    }

    if (storage === "bio_embedded" || storage === "column") {
      const b = parseRateInfoFromBio(row.bio)
      row.bio = b.cleanBio
      if (Object.keys(b.map).length > 0) {
        map = { ...map, ...b.map }
      }
      if (b.legacy) {
        legacy = legacy ?? b.legacy
      }
    }

    const rateInfo = rateForPartnership(partnershipId, map, legacy)

    return NextResponse.json(
      {
        bio: row.bio ?? "",
        location: row.location ?? "",
        website: row.website ?? "",
        rate_info: rateInfo,
        partnership_id: partnershipId,
        rate_info_storage: storage,
        migration_note: migrationNote,
      },
      { headers: noStore }
    )
  } catch (e) {
    console.error("[api/partner/rate-info] GET unexpected", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStore })
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403, headers: noStore })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: noStore })
    }

    const partnershipIdRaw = body.partnership_id
    const partnershipId = typeof partnershipIdRaw === "string" ? partnershipIdRaw.trim() : ""
    if (!partnershipId) {
      return NextResponse.json({ error: "partnership_id is required" }, { status: 400, headers: noStore })
    }

    const ok = await assertPartnerOwnsPartnership(supabase, user.id, partnershipId)
    if (!ok) {
      return NextResponse.json({ error: "Invalid or inactive partnership" }, { status: 403, headers: noStore })
    }

    const bioIn = body.bio !== undefined ? String(body.bio) : undefined
    const locationIn = body.location !== undefined ? String(body.location) : undefined
    const websiteIn = body.website !== undefined ? String(body.website) : undefined
    const ratePatch =
      body.rate_info && typeof body.rate_info === "object" && !Array.isArray(body.rate_info)
        ? (body.rate_info as Partial<PartnerRateInfoPayload>)
        : ({} as Partial<PartnerRateInfoPayload>)

    let load = await supabase
      .from("profiles")
      .select("bio, location, website, rate_info")
      .eq("id", user.id)
      .single()

    let useBioEmbed = false

    if (load.error && isMissingRateInfoColumnError(load.error)) {
      useBioEmbed = true
      load = await supabase.from("profiles").select("bio, location, website").eq("id", user.id).single()
    }

    if (load.error || !load.data) {
      console.error("[api/partner/rate-info] POST load failed", load.error)
      return NextResponse.json({ error: "Failed to load profile" }, { status: 500, headers: noStore })
    }

    const row = load.data as {
      bio: string | null
      location: string | null
      website: string | null
      rate_info?: unknown
    }

    let currentBio = ""
    let currentLocation = ""
    let currentWebsite = ""
    let map: Record<string, PartnerRateInfoPayload> = {}
    let legacy: PartnerRateInfoPayload | null = null

    if (useBioEmbed) {
      const parsed = parseRateInfoFromBio(row.bio)
      currentBio = parsed.cleanBio
      map = { ...parsed.map }
      legacy = parsed.legacy
      currentLocation = row.location ?? ""
      currentWebsite = row.website ?? ""
    } else {
      currentBio = row.bio ?? ""
      currentLocation = row.location ?? ""
      currentWebsite = row.website ?? ""
      if (row.rate_info != null) {
        const parsed = extractMapAndLegacy(row.rate_info)
        map = { ...parsed.map }
        legacy = parsed.legacy
      } else {
        const parsed = parseRateInfoFromBio(row.bio)
        if (parsed.map && Object.keys(parsed.map).length > 0) {
          currentBio = parsed.cleanBio
          map = { ...parsed.map }
          legacy = parsed.legacy
        } else if (parsed.legacy) {
          currentBio = parsed.cleanBio
          legacy = parsed.legacy
        }
      }
    }

    const nextBio = bioIn !== undefined ? bioIn : currentBio
    const nextLocation = locationIn !== undefined ? locationIn : currentLocation
    const nextWebsite = websiteIn !== undefined ? websiteIn : currentWebsite

    const existingForPartnership = map[partnershipId] ?? (legacy ? { ...legacy } : defaultRateInfo())
    const nextForPartnership = mergeRateInfo(existingForPartnership, ratePatch)
    map[partnershipId] = nextForPartnership

    const storedRoot: Record<string, unknown> = { [BY_PARTNERSHIP_KEY]: map }

    if (useBioEmbed) {
      const storedBio = `${nextBio.trimEnd()}${RATE_INFO_BIO_MARKER}${JSON.stringify(storedRoot)}`
      const { error: upErr } = await supabase
        .from("profiles")
        .update({
          bio: storedBio,
          ...(locationIn !== undefined ? { location: nextLocation || null } : {}),
          ...(websiteIn !== undefined ? { website: nextWebsite || null } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)

      if (upErr) {
        console.error("[api/partner/rate-info] POST update (bio embed) failed", upErr)
        return NextResponse.json({ error: "Failed to save" }, { status: 500, headers: noStore })
      }
    } else {
      const { error: upErr } = await supabase
        .from("profiles")
        .update({
          ...(bioIn !== undefined ? { bio: nextBio || null } : {}),
          ...(locationIn !== undefined ? { location: nextLocation || null } : {}),
          ...(websiteIn !== undefined ? { website: nextWebsite || null } : {}),
          rate_info: storedRoot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)

      if (upErr && isMissingRateInfoColumnError(upErr)) {
        const storedBio = `${nextBio.trimEnd()}${RATE_INFO_BIO_MARKER}${JSON.stringify(storedRoot)}`
        const { error: up2 } = await supabase
          .from("profiles")
          .update({
            bio: storedBio,
            ...(locationIn !== undefined ? { location: nextLocation || null } : {}),
            ...(websiteIn !== undefined ? { website: nextWebsite || null } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id)
        if (up2) {
          console.error("[api/partner/rate-info] POST fallback bio save failed", up2)
          return NextResponse.json({ error: "Failed to save" }, { status: 500, headers: noStore })
        }
      } else if (upErr) {
        console.error("[api/partner/rate-info] POST update failed", upErr)
        return NextResponse.json({ error: "Failed to save" }, { status: 500, headers: noStore })
      }
    }

    return NextResponse.json({ success: true }, { headers: noStore })
  } catch (e) {
    console.error("[api/partner/rate-info] POST unexpected", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStore })
  }
}
