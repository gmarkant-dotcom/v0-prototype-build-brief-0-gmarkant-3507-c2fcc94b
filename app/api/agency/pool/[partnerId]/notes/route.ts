import { resolveCallerOrgIds, type OrgId } from "@/lib/entitlements"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

type NotesLogEntry = {
  text: string
  timestamp: string
}

type PartnershipNotesShape = {
  notes?: string
  notes_log?: NotesLogEntry[]
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

/**
 * 079 PARAMETER CLASS, BRANDED. `partnerships.lead_org_id` REFERENCES organizations(id),
 * and both call sites below passed `user.id` into it. `OrgId` is not assignable from a
 * bare string, so that substitution is now a compile error rather than a partnership this
 * agency owns coming back as "No active partnership".
 *
 * A SET rather than a scalar: the POST path's own update is already scoped
 * `.in("lead_org_id", callerOrgIds)`, and a gate that reads the row under a narrower rule
 * than the write that follows it is the seam this whole pass exists to close.
 *
 * `partnerId` stays a plain string on purpose - see the call sites. It is the [partnerId]
 * route param, which the Vendor Pool page sets from `vendor_org_id`, so it is already an
 * organization id; branding it would need a cast at every caller to assert a fact this
 * function cannot check, which buys a false sense of proof rather than a check.
 */
async function assertActiveAgencyPartnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agencyOrgIds: readonly OrgId[],
  partnerId: string
): Promise<{ id: string; partnership_notes: unknown } | null> {
  if (agencyOrgIds.length === 0) return null
  const { data, error } = await supabase
    .from("partnerships")
    .select("id, partnership_notes")
    .in("lead_org_id", agencyOrgIds)
    .eq("vendor_org_id", partnerId)
    // The same single predicate as isActivePartnership() in lib/partnership-state.ts,
    // expressed in SQL because this gate can be pushed into the query.
    .eq("status", "active")
    // `.limit(1)` rather than `.maybeSingle()`. Widening the organization filter from `.eq`
    // to `.in` makes two matching rows reachable - a caller in two organizations that have
    // each partnered with the same vendor - and maybeSingle() answers that with PGRST116,
    // which this function reports as "No active partnership". Locking an agency out of its
    // own notes is a worse answer than picking one of two rows it owns; the update that
    // follows is scoped `.eq("id", row.id).in("lead_org_id", callerOrgIds)` either way, so
    // whichever row is picked, the write stays inside the caller's organizations.
    .limit(1)

  if (error) {
    console.error("[api/agency/pool/notes] partnership", error)
    return null
  }
  const rows = (data ?? []) as Array<{ id: string; partnership_notes: unknown }>
  return rows[0] ?? null
}

export async function GET(_req: Request, { params }: { params: Promise<{ partnerId: string }> }) {
  try {
    const { partnerId } = await params
    if (!partnerId) {
      return NextResponse.json({ error: "Missing vendor id" }, { status: 400, headers: noStore })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    }

    const { data: me, error: meErr } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).single()
    if (meErr || (me?.role !== "agency" && me?.active_role !== "agency")) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    // The POST below already resolved this; the GET did not, so its gate was reading
    // partnerships.lead_org_id against a profiles id and reporting "No active partnership"
    // for a partnership the agency owns.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const row = await assertActiveAgencyPartnership(supabase, callerOrgIds, partnerId)
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
      return NextResponse.json({ error: "Missing vendor id" }, { status: 400, headers: noStore })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    }

    const { data: me, error: meErr } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).single()
    if (meErr || (me?.role !== "agency" && me?.active_role !== "agency")) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    // 079 PARAMETER CLASS: `user.id` matched partnerships.lead_org_id, an organization
    // column. Same set the update below is scoped by, so the read gate and the write agree.
    const row = await assertActiveAgencyPartnership(supabase, callerOrgIds, partnerId)
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

    // Append to timestamped log if notes text changed and is non-empty
    if (patch.notes !== undefined && patch.notes.trim()) {
      const prevLog = Array.isArray(prev.notes_log) ? prev.notes_log : []
      const lastEntry = prevLog[prevLog.length - 1]
      const isDuplicate = lastEntry && lastEntry.text.trim() === patch.notes.trim()
      if (!isDuplicate) {
        next.notes_log = [
          ...prevLog,
          { text: patch.notes.trim(), timestamp: new Date().toISOString() },
        ]
      } else {
        next.notes_log = prevLog
      }
    } else {
      next.notes_log = Array.isArray(prev.notes_log) ? prev.notes_log : []
    }

    const { error: upErr } = await supabase
      .from("partnerships")
      .update({ partnership_notes: next, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .in("lead_org_id", callerOrgIds)

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
