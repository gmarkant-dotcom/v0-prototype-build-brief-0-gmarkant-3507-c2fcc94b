import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

async function requireAgency() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: "Unauthorized" }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active_role")
    .eq("id", user.id)
    .maybeSingle()
  if (profile?.role !== "agency" && profile?.active_role !== "agency") {
    return { ok: false as const, status: 403, error: "Agency only" }
  }
  return { ok: true as const, userId: user.id }
}

/**
 * Adds one contact to the agency's pool - same Case 1/Case 2 pattern as
 * classifyGuestVendorForPool in app/api/rfp/guest/[token]/route.ts (the magic-link
 * auto-add feature): check by partner_id then partner_email before inserting, claim an
 * existing-but-unclaimed row instead of duplicating it.
 *
 * Deliberately does NOT trust the client's has_ligament_account/profile_id - those are
 * re-derived here from a fresh profiles lookup by email. A client could otherwise pass an
 * arbitrary profile_id to bind someone else's account to this agency without their
 * involvement.
 */
async function importContact(
  service: SupabaseClient,
  agencyId: string,
  email: string
): Promise<"added" | "skipped"> {
  const { data: matchedProfile } = await service.from("profiles").select("id").ilike("email", email).maybeSingle()

  if (matchedProfile?.id) {
    const byId = await service
      .from("partnerships")
      .select("id, partner_id")
      .eq("agency_id", agencyId)
      .eq("partner_id", matchedProfile.id)
      .limit(1)
      .maybeSingle()
    let existing = byId.data as { id: string; partner_id: string | null } | null

    if (!existing) {
      const byEmail = await service
        .from("partnerships")
        .select("id, partner_id")
        .eq("agency_id", agencyId)
        .ilike("partner_email", email)
        .limit(1)
        .maybeSingle()
      existing = byEmail.data as { id: string; partner_id: string | null } | null
    }

    if (existing) {
      if (!existing.partner_id) {
        const { error } = await service
          .from("partnerships")
          .update({ partner_id: matchedProfile.id, profile_status: "active", updated_at: new Date().toISOString() })
          .eq("id", existing.id)
        if (error) throw error
      }
      return "skipped"
    }

    const { error } = await service.from("partnerships").insert({
      agency_id: agencyId,
      partner_id: matchedProfile.id,
      partner_email: email,
      status: "active",
      profile_status: "active",
    })
    if (error) throw error
    return "added"
  }

  const { data: existingGhost } = await service
    .from("partnerships")
    .select("id")
    .eq("agency_id", agencyId)
    .ilike("partner_email", email)
    .limit(1)
    .maybeSingle()
  if (existingGhost) return "skipped"

  const { error } = await service.from("partnerships").insert({
    agency_id: agencyId,
    partner_id: null,
    partner_email: email,
    profile_status: "unclaimed",
    status: "pending",
  })
  if (error) throw error
  return "added"
}

export async function POST(request: NextRequest) {
  const route = "/api/agency/email-scan/import"
  const auth = await requireAgency()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const service = getServiceSupabase()
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
  }

  const body = await request.json().catch(() => ({}))
  const rawContacts = Array.isArray(body.contacts) ? body.contacts : []
  const emails = Array.from(
    new Set(
      rawContacts
        .map((c: { email?: unknown }) => String(c?.email || "").trim().toLowerCase())
        .filter((email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
  ) as string[]

  if (emails.length === 0) {
    return NextResponse.json({ error: "No valid contacts provided" }, { status: 400 })
  }

  let added = 0
  let skipped = 0
  let errors = 0

  for (const email of emails) {
    try {
      const result = await importContact(service, auth.userId, email)
      if (result === "added") added += 1
      else skipped += 1
    } catch (err) {
      errors += 1
      console.error("[api] failure", {
        route,
        method: "POST",
        email,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.log("[api] success", { route, method: "POST", userId: auth.userId, added, skipped, errors })
  return NextResponse.json({ added, skipped, errors })
}
