import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

type ProjectEmbed = { title?: string | null; client_name?: string | null }

function normalizeProjectEmbed(project: ProjectEmbed | ProjectEmbed[] | null): ProjectEmbed | null {
  if (!project) return null
  if (Array.isArray(project)) return project[0] ?? null
  return project
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

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profileErr || profile?.role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403, headers: noStore })
    }

    const { data: partnershipRows, error: pErr } = await supabase
      .from("partnerships")
      .select("id, agency_id, status")
      .eq("partner_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })

    if (pErr) {
      console.error("[api/partner/payments] partnerships query failed", {
        message: pErr.message,
        code: pErr.code,
      })
      return NextResponse.json({ error: "Failed to load partnerships" }, { status: 500, headers: noStore })
    }

    const active = partnershipRows || []
    const partnershipIds = active.map((p) => p.id as string)
    const agencyIds = [...new Set(active.map((p) => p.agency_id as string).filter(Boolean))]

    let agencyNameById: Record<string, string> = {}
    if (agencyIds.length > 0) {
      const { data: agencies, error: aErr } = await supabase
        .from("profiles")
        .select("id, company_name, full_name")
        .in("id", agencyIds)

      if (aErr) {
        console.error("[api/partner/payments] agency profiles failed", {
          message: aErr.message,
          code: aErr.code,
        })
      } else {
        for (const a of agencies || []) {
          const id = a.id as string
          const label = (a.company_name as string | null)?.trim() || (a.full_name as string | null)?.trim() || "Agency"
          agencyNameById[id] = label
        }
      }
    }

    let milestoneRows: Array<{
      id: string
      title: string
      amount: number | string
      currency: string
      due_date: string
      status: string
      paid_at: string | null
      notes: string | null
      partnership_id: string | null
      project: ProjectEmbed | ProjectEmbed[] | null
    }> = []

    if (partnershipIds.length > 0) {
      const { data: miles, error: mErr } = await supabase
        .from("payment_milestones")
        .select(
          `
          id,
          title,
          amount,
          currency,
          due_date,
          status,
          paid_at,
          notes,
          partnership_id,
          project:projects ( title, client_name )
        `
        )
        .in("partnership_id", partnershipIds)
        .order("due_date", { ascending: true })

      if (mErr) {
        console.error("[api/partner/payments] payment_milestones failed", {
          message: mErr.message,
          code: mErr.code,
        })
        return NextResponse.json({ error: "Failed to load payment milestones" }, { status: 500, headers: noStore })
      }

      milestoneRows = (miles || []) as typeof milestoneRows
    }

    const milestonesByPartnership = new Map<string, typeof milestoneRows>()
    for (const m of milestoneRows) {
      const pid = m.partnership_id
      if (!pid) continue
      const arr = milestonesByPartnership.get(pid) || []
      arr.push(m)
      milestonesByPartnership.set(pid, arr)
    }

    const partnerships = active.map((row) => {
      const pid = row.id as string
      const aid = row.agency_id as string
      const list = milestonesByPartnership.get(pid) || []
      return {
        partnership_id: pid,
        agency_id: aid,
        agency_name: agencyNameById[aid] || "Agency",
        milestones: list.map((m) => {
          const proj = normalizeProjectEmbed(m.project)
          const title = proj?.title ?? null
          const client = proj?.client_name ?? null
          return {
            id: m.id,
            title: m.title,
            amount: typeof m.amount === "string" ? parseFloat(m.amount) : Number(m.amount),
            currency: m.currency || "USD",
            due_date: m.due_date,
            status: m.status,
            paid_at: m.paid_at,
            project_name: title || "Project",
            client_name: client ?? null,
            notes: m.notes,
          }
        }),
      }
    })

    return NextResponse.json({ partnerships }, { headers: noStore })
  } catch (e) {
    console.error("[api/partner/payments] unexpected", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStore })
  }
}
