import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStore = { "Cache-Control": "private, no-store, no-cache, must-revalidate" } as const

function partnerDisplayName(p: {
  company_name?: string | null
  display_name?: string | null
  full_name?: string | null
  email?: string | null
}): string {
  return (
    (p.company_name || "").trim() ||
    (p.display_name || "").trim() ||
    (p.full_name || "").trim() ||
    (p.email || "").trim() ||
    "Partner"
  )
}

async function requireAgency(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", userId).single()
  if (error || profile?.role !== "agency") return null
  return profile
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })

    if (!(await requireAgency(supabase, user.id))) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    const { data: rows, error } = await supabase
      .from("msa_agreements")
      .select("id, partnership_id, status, document_url, signed_at, created_at")
      .eq("agency_id", user.id)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[api/agency/msa] msa_agreements query failed", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      return NextResponse.json({ error: "Failed to load agreements" }, { status: 500, headers: noStore })
    }

    const list = rows || []
    const partnershipIds = [...new Set(list.map((r) => r.partnership_id as string))]
    const shipById = new Map<string, { partner_id: string | null }>()
    if (partnershipIds.length > 0) {
      const { data: ships, error: shipErr } = await supabase
        .from("partnerships")
        .select("id, partner_id")
        .eq("agency_id", user.id)
        .in("id", partnershipIds)
      if (shipErr) {
        console.error("[api/agency/msa] partnerships batch for MSA failed", {
          message: shipErr.message,
          code: shipErr.code,
          details: shipErr.details,
          hint: shipErr.hint,
        })
        return NextResponse.json({ error: "Failed to load partnerships" }, { status: 500, headers: noStore })
      }
      for (const s of ships || []) {
        shipById.set(s.id as string, { partner_id: (s.partner_id as string | null) ?? null })
      }
    }

    const partnerIds = [
      ...new Set(
        [...shipById.values()]
          .map((x) => x.partner_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ]
    const profById = new Map<
      string,
      { company_name: string | null; display_name: string | null; full_name: string | null; email: string | null }
    >()
    if (partnerIds.length > 0) {
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id, company_name, display_name, full_name, email")
        .in("id", partnerIds)
      if (pErr) {
        console.error("[api/agency/msa] profiles batch for MSA partners failed", {
          message: pErr.message,
          code: pErr.code,
          details: pErr.details,
          hint: pErr.hint,
        })
        return NextResponse.json({ error: "Failed to load partner profiles" }, { status: 500, headers: noStore })
      }
      for (const p of profs || []) {
        profById.set(p.id as string, {
          company_name: p.company_name,
          display_name: p.display_name,
          full_name: p.full_name,
          email: p.email,
        })
      }
    }

    const agreements = list.map((r) => {
      const ship = shipById.get(r.partnership_id as string)
      const prof =
        ship?.partner_id != null && ship.partner_id !== "" ? profById.get(ship.partner_id) : undefined
      return {
        id: r.id as string,
        partnership_id: r.partnership_id as string,
        partner_name: prof ? partnerDisplayName(prof) : "Partner",
        status: r.status as string,
        document_url: (r.document_url as string | null) ?? null,
        signed_at: (r.signed_at as string | null) ?? null,
        created_at: r.created_at as string,
      }
    })

    return NextResponse.json({ agreements }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/msa] GET", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })

    if (!(await requireAgency(supabase, user.id))) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    const body = await req.json().catch(() => ({}))
    const partnership_id = (body.partnership_id as string | undefined)?.trim()
    if (!partnership_id) {
      return NextResponse.json({ error: "partnership_id is required" }, { status: 400, headers: noStore })
    }

    const { data: ship, error: shipErr } = await supabase
      .from("partnerships")
      .select("id")
      .eq("id", partnership_id)
      .eq("agency_id", user.id)
      .maybeSingle()
    if (shipErr || !ship) {
      return NextResponse.json({ error: "Partnership not found" }, { status: 404, headers: noStore })
    }

    const { data: row, error } = await supabase
      .from("msa_agreements")
      .insert({
        agency_id: user.id,
        partnership_id,
        status: "pending",
      })
      .select("id, partnership_id, status, document_url, signed_at, created_at")
      .single()

    if (error) {
      console.error("[api/agency/msa] POST insert", error)
      return NextResponse.json({ error: error.message }, { status: 500, headers: noStore })
    }

    return NextResponse.json({ agreement: row }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/msa] POST", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })

    if (!(await requireAgency(supabase, user.id))) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    const body = await req.json().catch(() => ({}))
    const id = (body.id as string | undefined)?.trim()
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400, headers: noStore })

    const { data: existing, error: exErr } = await supabase
      .from("msa_agreements")
      .select("id")
      .eq("id", id)
      .eq("agency_id", user.id)
      .maybeSingle()
    if (exErr || !existing) {
      return NextResponse.json({ error: "Agreement not found" }, { status: 404, headers: noStore })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.status === "string") {
      const s = body.status.trim().toLowerCase()
      if (!["pending", "sent", "signed", "expired"].includes(s)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400, headers: noStore })
      }
      updates.status = s
      if (s === "signed" && body.signed_at === undefined) {
        updates.signed_at = new Date().toISOString()
      }
    }
    if (body.document_url !== undefined) {
      const u = body.document_url === null ? null : String(body.document_url).trim()
      updates.document_url = u || null
    }
    if (body.signed_at !== undefined) {
      updates.signed_at = body.signed_at === null ? null : String(body.signed_at)
    }

    const { data: row, error } = await supabase
      .from("msa_agreements")
      .update(updates)
      .eq("id", id)
      .eq("agency_id", user.id)
      .select("id, partnership_id, status, document_url, signed_at, created_at, updated_at")
      .single()

    if (error) {
      console.error("[api/agency/msa] PATCH", error)
      return NextResponse.json({ error: error.message }, { status: 500, headers: noStore })
    }

    return NextResponse.json({ agreement: row }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/msa] PATCH", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
  }
}
