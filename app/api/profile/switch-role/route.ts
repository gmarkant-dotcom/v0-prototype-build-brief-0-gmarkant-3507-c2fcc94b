import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, secondary_role, active_role, is_admin")
      .eq("id", user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    const primaryRole = profile.role as string
    const secondaryRole = profile.secondary_role as string | null

    // Switching to partner — always allowed (free, self-serve)
    if (targetRole === "partner") {
      // If primary role is agency, grant secondary_role=partner automatically
      const updates: Record<string, string> = { active_role: "partner" }
      if (primaryRole === "agency" && secondaryRole !== "partner") {
        updates.secondary_role = "partner"
      }
      const { error: updateError } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id)

      if (updateError) {
        return NextResponse.json({ error: "Failed to switch role" }, { status: 500 })
      }

      return NextResponse.json({ active_role: "partner", redirect: "/partner" })
    }

    // Switching to agency — requires secondary_role='agency' (admin-granted) OR primary role is already agency
    if (targetRole === "agency") {
      const canAccessAgency =
        primaryRole === "agency" || secondaryRole === "agency" || profile.is_admin === true

      if (!canAccessAgency) {
        return NextResponse.json(
          { error: "upgrade_required", message: "Lead agency access requires an active subscription." },
          { status: 403 }
        )
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ active_role: "agency" })
        .eq("id", user.id)

      if (updateError) {
        return NextResponse.json({ error: "Failed to switch role" }, { status: 500 })
      }

      return NextResponse.json({ active_role: "agency", redirect: "/agency/dashboard" })
    }

    return NextResponse.json({ error: "Invalid operation" }, { status: 400 })
  } catch (e) {
    console.error("[switch-role] error:", e)
    return NextResponse.json({ error: "Failed to switch role" }, { status: 500 })
  }
}
