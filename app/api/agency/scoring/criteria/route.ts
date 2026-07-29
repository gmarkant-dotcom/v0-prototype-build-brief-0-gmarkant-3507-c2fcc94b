import { NextResponse } from "next/server"
import { DEFAULT_SCORING_CRITERIA, DEFAULT_TEMPLATE_NAME, DEFAULT_TEMPLATE_DESCRIPTION } from "@/lib/bid-scoring-defaults"
import { requireAgencyRole } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

// GET - list the agency's active scoring criteria and templates, seeding the 7 defaults
// (plus a default template grouping them) the first time an agency has none at all.
export async function GET() {
  const route = "/api/agency/scoring/criteria"
  const auth = await requireAgencyRole()
  if (!auth.authorized) return auth.response
  const { supabase, user } = auth
  const userId = user.id

  const { count, error: countErr } = await supabase
    .from("bid_scoring_criteria")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", userId)
  if (countErr) {
    console.error("[api] failure", { route, method: "GET", message: countErr.message })
    return NextResponse.json({ error: "Failed to load criteria" }, { status: 500 })
  }

  if ((count ?? 0) === 0) {
    const { data: seeded, error: seedErr } = await supabase
      .from("bid_scoring_criteria")
      .insert(
        DEFAULT_SCORING_CRITERIA.map((c, i) => ({
          agency_id: userId,
          name: c.name,
          description: c.description,
          category: c.category,
          default_weight: c.default_weight,
          sort_order: i,
        }))
      )
      .select("id, default_weight")
    if (seedErr) {
      console.error("[api] failure", { route, method: "GET", message: seedErr.message, code: "seed_criteria" })
      return NextResponse.json({ error: "Failed to seed default criteria" }, { status: 500 })
    }

    const { error: templateSeedErr } = await supabase.from("bid_scoring_templates").insert({
      agency_id: userId,
      name: DEFAULT_TEMPLATE_NAME,
      description: DEFAULT_TEMPLATE_DESCRIPTION,
      criteria_weights: (seeded || []).map((c) => ({ criterion_id: c.id, weight: c.default_weight })),
      is_default: true,
    })
    if (templateSeedErr) {
      console.error("[api] failure", { route, method: "GET", message: templateSeedErr.message, code: "seed_template" })
      // Criteria are already seeded and usable; a missing default template isn't fatal.
    }
  }

  const [{ data: criteria, error: criteriaErr }, { data: templates, error: templatesErr }] = await Promise.all([
    supabase
      .from("bid_scoring_criteria")
      .select("id, name, description, category, default_weight, sort_order, is_active")
      .eq("agency_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("bid_scoring_templates")
      .select("id, name, description, criteria_weights, is_default, created_at")
      .eq("agency_id", userId)
      .order("created_at", { ascending: true }),
  ])
  if (criteriaErr) {
    console.error("[api] failure", { route, method: "GET", message: criteriaErr.message })
    return NextResponse.json({ error: "Failed to load criteria" }, { status: 500 })
  }
  if (templatesErr) {
    console.error("[api] failure", { route, method: "GET", message: templatesErr.message })
    return NextResponse.json({ error: "Failed to load templates" }, { status: 500 })
  }

  return NextResponse.json({ criteria: criteria || [], templates: templates || [] })
}

// POST - create a new criterion, or update an existing one when `id` is provided.
export async function POST(req: Request) {
  const route = "/api/agency/scoring/criteria"
  const auth = await requireAgencyRole()
  if (!auth.authorized) return auth.response
  const { supabase, user } = auth
  const userId = user.id

  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === "string" ? body.id : null
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  const description = typeof body?.description === "string" ? body.description.trim() : null
  const category = typeof body?.category === "string" ? body.category.trim() : null
  const weight = Number(body?.weight)
  const isActive = typeof body?.is_active === "boolean" ? body.is_active : true

  if (!id && !name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }
  if (body?.weight !== undefined && (!Number.isFinite(weight) || weight <= 0)) {
    return NextResponse.json({ error: "Weight must be a positive number" }, { status: 400 })
  }

  if (id) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body?.name !== undefined) patch.name = name
    if (body?.description !== undefined) patch.description = description
    if (body?.category !== undefined) patch.category = category
    if (body?.weight !== undefined) patch.default_weight = weight
    if (body?.is_active !== undefined) patch.is_active = isActive

    const { data: updated, error: updateErr } = await supabase
      .from("bid_scoring_criteria")
      .update(patch)
      .eq("id", id)
      .eq("agency_id", userId)
      .select("id, name, description, category, default_weight, sort_order, is_active")
      .maybeSingle()
    if (updateErr) {
      console.error("[api] failure", { route, method: "POST", message: updateErr.message })
      return NextResponse.json({ error: "Failed to update criterion" }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: "Criterion not found" }, { status: 404 })
    return NextResponse.json({ criterion: updated })
  }

  const { count: existingCount } = await supabase
    .from("bid_scoring_criteria")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", userId)

  const { data: created, error: insertErr } = await supabase
    .from("bid_scoring_criteria")
    .insert({
      agency_id: userId,
      name,
      description,
      category,
      default_weight: body?.weight !== undefined ? weight : 1.0,
      sort_order: existingCount ?? 0,
      is_active: isActive,
    })
    .select("id, name, description, category, default_weight, sort_order, is_active")
    .single()
  if (insertErr) {
    console.error("[api] failure", { route, method: "POST", message: insertErr.message, code: insertErr.code })
    if (insertErr.code === "23505") {
      return NextResponse.json({ error: "A criterion with this name already exists" }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to create criterion" }, { status: 500 })
  }

  return NextResponse.json({ criterion: created })
}
