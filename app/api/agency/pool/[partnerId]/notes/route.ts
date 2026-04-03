import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

type PartnershipNotesShape = {
  notes?: string
  overall_rating?: number | null
  would_work_again?: boolean | null
  blacklisted?: boolean
}

function normalizeNotes(raw: unknown): PartnershipNotesShape {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as PartnershipNotesShape
}

function mergeNotes(base: PartnershipNotesShape, patch: PartnershipNotesShape): PartnershipNotesShape {
  return {
    ...base,
    ...patch,
    notes: patch.notes !== undefined ? patch.notes : base.notes,
    overall_rating:
      patch.overall_rating !== undefined ? patch.overall_rating : base.overall_rating,
    would_work_again:
      patch.would_work_again !== undefined ? patch.would_work_again : base.would_work_again,
    blacklisted: patch.blacklisted !== undefined ? patch.blacklisted : base.blacklisted,
  }
}

async function assertActiveAgencyPartnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agencyId: string,
  partnerId: string
): Promise<{ id: string; partnership_notes: unknown } | null> {
  const { data, error } = await supabase
    .from("partnerships")
    .select("id, partnership_notes")
    .eq("agency_id", agencyId)
    .eq("partner_id", partnerId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    console.error("[api/agency/pool/notes] partnership", error)
    return null
  }
  return data as { id: string; partnership_notes: unknown } | null
}

export async function GET(_req: Request, { params }: { params: Promise<{ partnerId: string }> }) {
  try {
    const { partnerId } = await params
    if (!partnerId) {
      return NextResponse.json({ error: "Missing partner id" }, { status: 400, headers: noStore })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    }

    const { data: me, error: meErr } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (meErr || me?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    const row = await assertActiveAgencyPartnership(supabase, user.id, partnerId)
    if (!row) {
      return NextResponse.json({ error: "No active partnership" }, { status: 404, headers: noStore })
    }

    return NextResponse.json(
      { partnership_id: row.id, notes: normalizeNotes(row.partnership_notes) },
      { headers: noStore }
    )
  } catch (e) {
    console.error("[api/agency/pool/notes] GET", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStore })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ partnerId: string }> }) {
  try {
    const { partnerId } = await params
    if (!partnerId) {
      return NextResponse.json({ error: "Missing partner id" }, { status: 400, headers: noStore })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    }

    const { data: me, error: meErr } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (meErr || me?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    const row = await assertActiveAgencyPartnership(supabase, user.id, partnerId)
    if (!row) {
      return NextResponse.json({ error: "No active partnership" }, { status: 404, headers: noStore })
    }

    const body = (await req.json().catch(() => ({}))) as PartnershipNotesShape
    const patch: PartnershipNotesShape = {}

    if (body.notes !== undefined) patch.notes = String(body.notes)

    if (body.overall_rating !== undefined && body.overall_rating !== null) {
      const n = Number(body.overall_rating)
      if (!Number.isFinite(n) || n < 1 || n > 5) {
        return NextResponse.json({ error: "overall_rating must be 1–5 or null" }, { status: 400, headers: noStore })
      }
      patch.overall_rating = Math.round(n)
    } else if (body.overall_rating === null) {
      patch.overall_rating = null
    }

    if (body.would_work_again !== undefined) {
      patch.would_work_again =
        body.would_work_again === null ? null : Boolean(body.would_work_again)
    }

    if (body.blacklisted !== undefined) {
      patch.blacklisted = Boolean(body.blacklisted)
    }

    const prev = normalizeNotes(row.partnership_notes)
    const next = mergeNotes(prev, patch)

    const { error: upErr } = await supabase
      .from("partnerships")
      .update({ partnership_notes: next, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("agency_id", user.id)

    if (upErr) {
      console.error("[api/agency/pool/notes] update", upErr)
      return NextResponse.json({ error: "Failed to save notes" }, { status: 500, headers: noStore })
    }

    return NextResponse.json({ partnership_id: row.id, notes: next }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/pool/notes] POST", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStore })
  }
}
