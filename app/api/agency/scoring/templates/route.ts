import { NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

type CriteriaWeight = { criterion_id: string; weight: number }

function normalizeCriteriaWeights(raw: unknown): CriteriaWeight[] {
  if (!Array.isArray(raw)) return []
  const out: CriteriaWeight[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const o = entry as Record<string, unknown>
    const criterionId = typeof o.criterion_id === "string" ? o.criterion_id : ""
    const weight = Number(o.weight)
    if (!criterionId || !Number.isFinite(weight) || weight <= 0) continue
    out.push({ criterion_id: criterionId, weight })
  }
  return out
}

// POST - create a new template, or update an existing one when `id` is provided.
export async function POST(req: Request) {
  const route = "/api/agency/scoring/templates"
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const body = await req.json().catch(() => ({}))
    const id = typeof body?.id === "string" ? body.id : null
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const description = typeof body?.description === "string" ? body.description.trim() : null
    const criteriaWeights = normalizeCriteriaWeights(body?.criteria_weights)
    const isDefault = body?.is_default === true

    if (!id && !name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    // Only one default template per agency - unset any existing default first.
    if (isDefault) {
      const { error: unsetErr } = await supabase
        .from("bid_scoring_templates")
        .update({ is_default: false })
        .eq("agency_id", user.id)
        .eq("is_default", true)
      if (unsetErr) {
        console.error("[api] failure", { route, method: "POST", message: unsetErr.message, code: "unset_default" })
        return NextResponse.json({ error: "Failed to update default template" }, { status: 500 })
      }
    }

    if (id) {
      const patch: Record<string, unknown> = {}
      if (body?.name !== undefined) patch.name = name
      if (body?.description !== undefined) patch.description = description
      if (body?.criteria_weights !== undefined) patch.criteria_weights = criteriaWeights
      if (body?.is_default !== undefined) patch.is_default = isDefault

      const { data: updated, error: updateErr } = await supabase
        .from("bid_scoring_templates")
        .update(patch)
        .eq("id", id)
        .eq("agency_id", user.id)
        .select("id, name, description, criteria_weights, is_default, created_at")
        .maybeSingle()
      if (updateErr) {
        console.error("[api] failure", { route, method: "POST", message: updateErr.message })
        return NextResponse.json({ error: "Failed to update template" }, { status: 500 })
      }
      if (!updated) return NextResponse.json({ error: "Template not found" }, { status: 404 })
      return NextResponse.json({ template: updated })
    }

    const { data: created, error: insertErr } = await supabase
      .from("bid_scoring_templates")
      .insert({
        agency_id: user.id,
        name,
        description,
        criteria_weights: criteriaWeights,
        is_default: isDefault,
      })
      .select("id, name, description, criteria_weights, is_default, created_at")
      .single()
    if (insertErr) {
      console.error("[api] failure", { route, method: "POST", message: insertErr.message, code: insertErr.code })
      if (insertErr.code === "23505") {
        return NextResponse.json({ error: "A template with this name already exists" }, { status: 409 })
      }
      return NextResponse.json({ error: "Failed to create template" }, { status: 500 })
    }

    return NextResponse.json({ template: created })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/scoring/templates",
      method: "POST",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to save template" }, { status: 500 })
  }
}
