import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, secondary_role, is_admin")
      .eq("id", user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    const primaryRole = profile.role as string
    const secondaryRole = profile.secondary_role as string | null

    const canAccessRole =
      active_role === "partner"
        ? primaryRole === "partner" || secondaryRole === "partner" || profile.is_admin === true
        : primaryRole === "agency" || secondaryRole === "agency" || profile.is_admin === true

    if (!canAccessRole) {
      return NextResponse.json(
        { error: "upgrade_required", message: `You do not have access to the ${active_role} portal.` },
        { status: 403 }
      )
    }

    const { error } = await supabase
      .from("profiles")
      .update({ active_role })
      .eq("id", user.id)

    if (error) {
      return NextResponse.json({ error: error.message || "Failed to update active role" }, { status: 500 })
    }

    return NextResponse.json({ success: true, active_role })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update active role" },
      { status: 500 }
    )
  }
}
