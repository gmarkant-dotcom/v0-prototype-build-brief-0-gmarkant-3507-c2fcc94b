import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStore = { "Cache-Control": "private, no-store, no-cache, must-revalidate" } as const

async function requireAgency(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", userId).single()
  if (error || profile?.role !== "agency") return false
  return true
}

async function assertProjectOwned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agencyId: string,
  projectId: string
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("agency_id", agencyId)
    .maybeSingle()
  if (error || !data) return false
  return true
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    if (!(await requireAgency(supabase, user.id))) {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStore })
    }

    const url = new URL(req.url)
    const project_id = (url.searchParams.get("project_id") || "").trim()

    let query = supabase
      .from("client_cash_flow")
      .select("id, project_id, agency_id, label, amount, currency, expected_date, status, received_at, created_at")
      .eq("agency_id", user.id)
      .order("expected_date", { ascending: true })
      .order("created_at", { ascending: true })

    if (project_id) {
      if (!(await assertProjectOwned(supabase, user.id, project_id))) {
        return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStore })
      }
      query = query.eq("project_id", project_id)
    }

    const { data, error } = await query
    if (error) {
      console.error("[api/agency/client-cash-flow] GET", error)
      return NextResponse.json({ error: "Failed to load client cash flow" }, { status: 500, headers: noStore })
    }
    return NextResponse.json({ entries: data || [] }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/client-cash-flow] GET", e)
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
    const project_id = (body.project_id as string | undefined)?.trim()
    const label = (body.label as string | undefined)?.trim()
    const amountRaw = body.amount
    const currency = ((body.currency as string | undefined)?.trim() || "USD").toUpperCase()
    const expected_date = (body.expected_date as string | undefined)?.trim()
    const statusRaw = ((body.status as string | undefined)?.trim().toLowerCase() || "expected") as
      | "expected"
      | "received"
    const status = statusRaw === "received" ? "received" : "expected"

    if (!project_id || !label || !expected_date) {
      return NextResponse.json(
        { error: "project_id, label, and expected_date are required" },
        { status: 400, headers: noStore }
      )
    }
    const amount = typeof amountRaw === "number" ? amountRaw : parseFloat(String(amountRaw))
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400, headers: noStore })
    }
    if (!(await assertProjectOwned(supabase, user.id, project_id))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStore })
    }

    const received_at = status === "received" ? new Date().toISOString() : null
    const { data, error } = await supabase
      .from("client_cash_flow")
      .insert({
        project_id,
        agency_id: user.id,
        label,
        amount,
        currency,
        expected_date,
        status,
        received_at,
      })
      .select("id, project_id, agency_id, label, amount, currency, expected_date, status, received_at, created_at")
      .single()

    if (error) {
      console.error("[api/agency/client-cash-flow] POST", error)
      return NextResponse.json({ error: error.message }, { status: 500, headers: noStore })
    }
    return NextResponse.json({ entry: data }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/client-cash-flow] POST", e)
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
      .from("client_cash_flow")
      .select("id")
      .eq("id", id)
      .eq("agency_id", user.id)
      .maybeSingle()
    if (exErr || !existing) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404, headers: noStore })
    }

    const updates: Record<string, unknown> = {}
    if (typeof body.label === "string") updates.label = body.label.trim()
    if (body.amount !== undefined) {
      const amount = typeof body.amount === "number" ? body.amount : parseFloat(String(body.amount))
      if (!Number.isFinite(amount)) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400, headers: noStore })
      }
      updates.amount = amount
    }
    if (typeof body.currency === "string") updates.currency = body.currency.trim().toUpperCase()
    if (typeof body.expected_date === "string") updates.expected_date = body.expected_date.trim()
    if (typeof body.status === "string") {
      const status = body.status.trim().toLowerCase()
      if (!["expected", "received"].includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400, headers: noStore })
      }
      updates.status = status
      updates.received_at = status === "received" ? new Date().toISOString() : null
    }

    const { data, error } = await supabase
      .from("client_cash_flow")
      .update(updates)
      .eq("id", id)
      .eq("agency_id", user.id)
      .select("id, project_id, agency_id, label, amount, currency, expected_date, status, received_at, created_at")
      .single()
    if (error) {
      console.error("[api/agency/client-cash-flow] PATCH", error)
      return NextResponse.json({ error: error.message }, { status: 500, headers: noStore })
    }

    return NextResponse.json({ entry: data }, { headers: noStore })
  } catch (e) {
    console.error("[api/agency/client-cash-flow] PATCH", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
  }
}
