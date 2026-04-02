import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

/** Embedded JSON in `profiles.bio` when `rate_info` column is missing (run scripts/030-partner-payments-rls.sql). */
const RATE_INFO_BIO_MARKER = "\n\n__LIGAMENT_PARTNER_RATE_V1__\n"

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

function parseRateInfoFromBio(rawBio: string | null): { cleanBio: string; embedded: PartnerRateInfoPayload | null } {
  if (!rawBio) return { cleanBio: "", embedded: null }
  const idx = rawBio.indexOf(RATE_INFO_BIO_MARKER)
  if (idx === -1) return { cleanBio: rawBio.trim(), embedded: null }
  const cleanBio = rawBio.slice(0, idx).trimEnd()
  const jsonPart = rawBio.slice(idx + RATE_INFO_BIO_MARKER.length).trim()
  try {
    const parsed = JSON.parse(jsonPart) as Partial<PartnerRateInfoPayload>
    return {
      cleanBio,
      embedded: {
        ...defaultRateInfo(),
        ...parsed,
        hourly_rate: String(parsed.hourly_rate ?? ""),
        project_minimum: String(parsed.project_minimum ?? ""),
        payment_terms: String(parsed.payment_terms ?? "net_30"),
        payment_terms_custom: String(parsed.payment_terms_custom ?? ""),
        notes: String(parsed.notes ?? ""),
      },
    }
  } catch {
    return { cleanBio: rawBio.trim(), embedded: null }
  }
}

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

function isMissingRateInfoColumnError(err: { message?: string; code?: string } | null): boolean {
  if (!err?.message) return false
  const m = err.message.toLowerCase()
  return m.includes("rate_info") || (m.includes("column") && m.includes("does not exist"))
}

export async function GET() {
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

    let rateInfo = defaultRateInfo()

    if (storage === "column" && row.rate_info != null && typeof row.rate_info === "object" && !Array.isArray(row.rate_info)) {
      rateInfo = mergeRateInfo(defaultRateInfo(), row.rate_info as Partial<PartnerRateInfoPayload>)
    } else if (storage === "bio_embedded") {
      const { cleanBio, embedded } = parseRateInfoFromBio(row.bio)
      row.bio = cleanBio
      if (embedded) rateInfo = embedded
    } else if (storage === "column") {
      const { cleanBio, embedded } = parseRateInfoFromBio(row.bio)
      if (embedded) {
        row.bio = cleanBio
        rateInfo = embedded
      }
    }

    return NextResponse.json(
      {
        bio: row.bio ?? "",
        location: row.location ?? "",
        website: row.website ?? "",
        rate_info: rateInfo,
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

    const bioIn = body.bio !== undefined ? String(body.bio) : undefined
    const locationIn = body.location !== undefined ? String(body.location) : undefined
    const websiteIn = body.website !== undefined ? String(body.website) : undefined
    const ratePatch =
      body.rate_info && typeof body.rate_info === "object" && !Array.isArray(body.rate_info)
        ? (body.rate_info as Partial<PartnerRateInfoPayload>)
        : ({} as Partial<PartnerRateInfoPayload>)

    let currentBio = ""
    let currentLocation = ""
    let currentWebsite = ""
    let currentRate = defaultRateInfo()

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

    if (useBioEmbed) {
      const { cleanBio, embedded } = parseRateInfoFromBio(row.bio)
      currentBio = cleanBio
      currentRate = embedded ? embedded : defaultRateInfo()
      currentLocation = row.location ?? ""
      currentWebsite = row.website ?? ""
    } else {
      currentBio = row.bio ?? ""
      currentLocation = row.location ?? ""
      currentWebsite = row.website ?? ""
      if (row.rate_info != null && typeof row.rate_info === "object" && !Array.isArray(row.rate_info)) {
        currentRate = mergeRateInfo(defaultRateInfo(), row.rate_info as Partial<PartnerRateInfoPayload>)
      } else {
        const { cleanBio, embedded } = parseRateInfoFromBio(row.bio)
        if (embedded) {
          currentBio = cleanBio
          currentRate = embedded
        }
      }
    }

    const nextBio = bioIn !== undefined ? bioIn : currentBio
    const nextLocation = locationIn !== undefined ? locationIn : currentLocation
    const nextWebsite = websiteIn !== undefined ? websiteIn : currentWebsite
    const nextRate = mergeRateInfo(currentRate, ratePatch)

    if (useBioEmbed) {
      const storedBio = `${nextBio.trimEnd()}${RATE_INFO_BIO_MARKER}${JSON.stringify(nextRate)}`
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
          rate_info: nextRate as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)

      if (upErr && isMissingRateInfoColumnError(upErr)) {
        const storedBio = `${nextBio.trimEnd()}${RATE_INFO_BIO_MARKER}${JSON.stringify(nextRate)}`
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
