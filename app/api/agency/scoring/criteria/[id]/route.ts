import { NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { resolveCallerOrgIds } from "@/lib/entitlements"

export const dynamic = "force-dynamic"

// Soft-delete only: is_active = false, never a hard DELETE - historical evaluations
// reference criterion_id via bid_evaluation_scores and must remain valid.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const route = "/api/agency/scoring/criteria/[id]"
  try {
    const { id } = await params
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    // 079: an organization column is not a user id. Scope by membership.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: updated, error: updateErr } = await supabase
      .from("bid_scoring_criteria")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("org_id", callerOrgIds)
      .select("id")
      .maybeSingle()
    if (updateErr) {
      console.error("[api] failure", { route, method: "DELETE", message: updateErr.message })
      return NextResponse.json({ error: "Failed to remove criterion" }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: "Criterion not found" }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/agency/scoring/criteria/[id]",
      method: "DELETE",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to remove criterion" }, { status: 500 })
  }
}
