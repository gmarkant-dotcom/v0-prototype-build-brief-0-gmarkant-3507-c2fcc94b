import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { switchActiveRole } from "@/lib/server/active-role-switch"

/**
 * The portal switch. G1 (owner ruling, 2026-10-09): 'agency' needs a paid lead-agency
 * organization, 'partner' needs a vendor organization. role / secondary_role / is_admin no
 * longer admit anyone - they used to, and every vendor signup since 078 carries
 * secondary_role = 'agency'. The write goes through set_active_role() (migration 113), with a
 * same-rule fallback while 113 is unapplied; see lib/server/active-role-switch.ts.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const targetRole = typeof body.role === "string" ? body.role.trim() : ""

    if (targetRole !== "agency" && targetRole !== "partner") {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 })
    }

    const outcome = await switchActiveRole(supabase, user.id, targetRole)
    if (!outcome.ok) return NextResponse.json(outcome.body, { status: outcome.status })

    return NextResponse.json(
      targetRole === "agency"
        ? { active_role: "agency", redirect: "/agency/dashboard" }
        : { active_role: "partner", redirect: "/partner" }
    )
  } catch (e) {
    console.error("[switch-role] error:", e)
    return NextResponse.json({ error: "Failed to switch role" }, { status: 500 })
  }
}
