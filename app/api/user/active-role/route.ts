import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { switchActiveRole } from "@/lib/server/active-role-switch"

/**
 * Same switch as /api/profile/switch-role, kept for its existing callers. G1: no role column
 * admits anyone; see lib/server/active-role-switch.ts for the rule and the 113 fallback.
 */
export async function PATCH(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const active_role = (body.active_role || "").toString().trim()

    if (active_role !== "agency" && active_role !== "partner") {
      return NextResponse.json({ error: "Invalid active_role" }, { status: 400 })
    }

    const outcome = await switchActiveRole(supabase, user.id, active_role)
    if (!outcome.ok) return NextResponse.json(outcome.body, { status: outcome.status })

    return NextResponse.json({ success: true, active_role })
  } catch (error) {
    console.error("[user/active-role] error:", error)
    return NextResponse.json({ error: "Failed to update active role" }, { status: 500 })
  }
}
