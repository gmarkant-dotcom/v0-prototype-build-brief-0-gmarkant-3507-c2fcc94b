import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
} as const

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const partnershipIdFilter = new URL(req.url).searchParams.get("partnershipId")?.trim() || null
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).eq("agency_id", user.id).maybeSingle()
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStoreHeaders })
    }

    let query = supabase
      .from("partner_status_updates")
      .select(
        `
        *,
        partnership:partnerships(
          id,
          partner:profiles!partnerships_partner_id_fkey(
            company_name,
            full_name
          )
        )
      `
      )
      .eq("project_id", projectId)
      .eq("is_resolved", false)
      .order("created_at", { ascending: false })

    if (partnershipIdFilter) {
      query = query.eq("partnership_id", partnershipIdFilter)
    }

    const { data: rows, error } = await query

    if (error) {
      console.error("[agency/status-updates] GET", error)
      return NextResponse.json({ error: "Failed to load updates" }, { status: 500, headers: noStoreHeaders })
    }

    const updates = (rows || []).map((r) => {
      const p = r.partnership as
        | { partner?: { company_name?: string | null; full_name?: string | null } | null }
        | { partner?: { company_name?: string | null; full_name?: string | null } | null }[]
        | null
      const inner = Array.isArray(p) ? p[0] : p
      const partnerEmbed = inner?.partner
      const partner = Array.isArray(partnerEmbed) ? partnerEmbed[0] : partnerEmbed
      const partnerName =
        partner?.company_name?.trim() || partner?.full_name?.trim() || "Partner"
      const { partnership: _x, ...rest } = r as Record<string, unknown>
      return { ...rest, partner_display_name: partnerName }
    })

    return NextResponse.json({ updates }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[agency/status-updates] GET unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders })
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "agency") {
      return NextResponse.json({ error: "Agency only" }, { status: 403, headers: noStoreHeaders })
    }

    const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).eq("agency_id", user.id).maybeSingle()
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404, headers: noStoreHeaders })
    }

    const body = (await req.json().catch(() => ({}))) as { id?: string; updateId?: string }
    const id = (typeof body.updateId === "string" ? body.updateId.trim() : "") || (typeof body.id === "string" ? body.id.trim() : "")
    if (!id) {
      return NextResponse.json({ error: "updateId required" }, { status: 400, headers: noStoreHeaders })
    }

    const now = new Date().toISOString()
    const { data: updated, error } = await supabase
      .from("partner_status_updates")
      .update({ is_resolved: true, updated_at: now })
      .eq("id", id)
      .eq("project_id", projectId)
      .select("*")
      .maybeSingle()

    if (error) {
      console.error("[agency/status-updates] PATCH", error)
      return NextResponse.json({ error: "Update failed" }, { status: 500, headers: noStoreHeaders })
    }
    if (!updated) {
      return NextResponse.json({ error: "Update not found" }, { status: 404, headers: noStoreHeaders })
    }

    return NextResponse.json({ update: updated }, { headers: noStoreHeaders })
  } catch (e) {
    console.error("[agency/status-updates] PATCH unhandled", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStoreHeaders })
  }
}
