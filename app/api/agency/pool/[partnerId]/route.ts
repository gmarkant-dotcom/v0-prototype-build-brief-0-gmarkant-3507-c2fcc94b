import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  isMissingRateInfoColumnError,
  resolveRateInfoForPartnership,
} from "@/lib/partner-rate-info-read"
import { parseDoubleJson } from "@/lib/active-engagement-parse"

export const dynamic = "force-dynamic"

const noStore = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const

const revalidateHeaders = {
  "Cache-Control": "private, max-age=0, stale-while-revalidate=30",
} as const

type BudgetJson = { amount?: number; currency?: string }

function parseAwardedBudget(raw: unknown): { amount: number; currency: string } | null {
  const o = parseDoubleJson<BudgetJson>(raw)
  if (!o || o.amount == null || !Number.isFinite(Number(o.amount))) return null
  const currency =
    typeof o.currency === "string" && o.currency.trim() ? o.currency.trim().toUpperCase() : "USD"
  return { amount: Number(o.amount), currency }
}

function unwrapInbox(raw: unknown): {
  scope_item_name: string | null
  project_id: string | null
  master_rfp_json: unknown
} | null {
  if (!raw) return null
  const row = Array.isArray(raw) ? raw[0] : raw
  if (!row || typeof row !== "object") return null
  const o = row as { scope_item_name?: string | null; project_id?: string | null; master_rfp_json?: unknown }
  return {
    scope_item_name: o.scope_item_name != null ? String(o.scope_item_name) : null,
    project_id: o.project_id != null ? String(o.project_id) : null,
    master_rfp_json: o.master_rfp_json ?? null,
  }
}

function projectNameFromInbox(
  inbox: NonNullable<ReturnType<typeof unwrapInbox>>,
  projectRow: { name?: string | null; title?: string | null } | undefined
): string {
  const fromProj = (projectRow?.name || projectRow?.title || "").trim()
  if (fromProj) return fromProj
  const j = inbox.master_rfp_json as Record<string, unknown> | null
  const n = j?.projectName
  return typeof n === "string" && n.trim() ? n.trim() : "Project"
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

    const { data: partnership, error: pErr } = await supabase
      .from("partnerships")
      .select("id, status, nda_confirmed_at")
      .eq("agency_id", user.id)
      .eq("partner_id", partnerId)
      .eq("status", "active")
      .maybeSingle()

    if (pErr) {
      console.error("[api/agency/pool/partner] partnership load", pErr)
      return NextResponse.json({ error: "Failed to verify partnership" }, { status: 500, headers: noStore })
    }
    if (!partnership) {
      return NextResponse.json({ error: "No active partnership with this partner" }, { status: 404, headers: noStore })
    }

    const partnershipId = partnership.id as string

    let prof = await supabase
      .from("profiles")
      .select(
        "id, full_name, company_name, display_name, email, bio, location, website, agency_type, avatar_url, meeting_url, rate_info"
      )
      .eq("id", partnerId)
      .maybeSingle()

    if (prof.error && isMissingRateInfoColumnError(prof.error)) {
      prof = await supabase
        .from("profiles")
        .select("id, full_name, company_name, display_name, email, bio, location, website, agency_type, avatar_url, meeting_url")
        .eq("id", partnerId)
        .maybeSingle()
    }

    if (prof.error || !prof.data) {
      console.error("[api/agency/pool/partner] profile load", prof.error)
      return NextResponse.json({ error: "Partner profile not found" }, { status: 404, headers: noStore })
    }

    const row = prof.data as {
      id: string
      full_name: string | null
      company_name: string | null
      display_name: string | null
      email: string | null
      bio: string | null
      location: string | null
      website: string | null
      agency_type: string | null
      avatar_url: string | null
      meeting_url: string | null
      rate_info?: unknown
    }

    const { bio_display, rate_info } = resolveRateInfoForPartnership(
      { bio: row.bio, rate_info: row.rate_info },
      partnershipId
    )

    const { data: respRows, error: respErr } = await supabase
      .from("partner_rfp_responses")
      .select("id, status, budget_proposal, partner_rfp_inbox(scope_item_name, project_id, master_rfp_json)")
      .eq("agency_id", user.id)
      .eq("partner_id", partnerId)
      .eq("status", "awarded")
      .order("updated_at", { ascending: false })

    if (respErr) {
      console.error("[api/agency/pool/partner] engagement responses", respErr)
      return NextResponse.json({ error: "Failed to load engagement history" }, { status: 500, headers: noStore })
    }

    const projectIds = new Set<string>()
    for (const r of respRows || []) {
      const inbox = unwrapInbox((r as { partner_rfp_inbox?: unknown }).partner_rfp_inbox)
      if (inbox?.project_id) projectIds.add(inbox.project_id)
    }

    const projectMeta = new Map<string, { name: string | null; title: string | null }>()
    if (projectIds.size > 0) {
      let projs =
        (await supabase
          .from("projects")
          .select("id, name, title")
          .eq("agency_id", user.id)
          .in("id", [...projectIds])) as {
          data: unknown[] | null
          error: { message?: string } | null
        }

      if (projs.error && /name/i.test(projs.error.message || "") && /column/i.test(projs.error.message || "")) {
        projs = (await supabase
          .from("projects")
          .select("id, title")
          .eq("agency_id", user.id)
          .in("id", [...projectIds])) as typeof projs
      }

      if (projs.error) {
        console.error("[api/agency/pool/partner] projects batch", projs.error)
      } else {
        for (const p of projs.data || []) {
          const row = p as { id: string; name?: string | null; title?: string | null }
          projectMeta.set(String(row.id), {
            name: row.name ?? null,
            title: row.title ?? null,
          })
        }
      }
    }

    const engagement_history = (respRows || []).map((r) => {
      const inbox = unwrapInbox((r as { partner_rfp_inbox?: unknown }).partner_rfp_inbox)
      const pid = inbox?.project_id ?? null
      const meta = pid ? projectMeta.get(pid) : undefined
      const parsed = parseAwardedBudget((r as { budget_proposal?: unknown }).budget_proposal)
      return {
        id: String((r as { id: string }).id),
        status: String((r as { status?: string }).status || "awarded"),
        scope_item_name: inbox?.scope_item_name?.trim() || "Scope",
        project_name: inbox ? projectNameFromInbox(inbox, meta) : "Project",
        awarded_amount: parsed?.amount ?? null,
        currency: parsed?.currency ?? "USD",
      }
    })

    return NextResponse.json(
      {
        partnership: {
          id: partnershipId,
          status: partnership.status as string,
          nda_confirmed_at: (partnership.nda_confirmed_at as string | null) ?? null,
        },
        partner: {
          id: row.id,
          full_name: row.full_name,
          company_name: row.company_name,
          display_name: row.display_name,
          email: row.email,
          bio: bio_display,
          location: row.location,
          website: row.website,
          agency_type: row.agency_type,
          avatar_url: row.avatar_url,
          meeting_url: row.meeting_url,
          rate_info,
          tags: [] as string[],
        },
        engagement_history,
      },
      { headers: revalidateHeaders }
    )
  } catch (e) {
    console.error("[api/agency/pool/partner] unexpected", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers: noStore })
  }
}
