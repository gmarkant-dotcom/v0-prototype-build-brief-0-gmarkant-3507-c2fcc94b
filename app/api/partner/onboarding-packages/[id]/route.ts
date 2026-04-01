import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: packageId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403 })
    }

    const body = await request.json()
    if (body.action !== "mark_reviewed") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from("onboarding_packages")
      .select("id, partnership_id")
      .eq("id", packageId)
      .single()

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const { data: ship } = await supabase
      .from("partnerships")
      .select("partner_id")
      .eq("id", existing.partnership_id)
      .single()

    if (!ship || ship.partner_id !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const now = new Date().toISOString()
    const { data: row, error } = await supabase
      .from("onboarding_packages")
      .update({
        status: "reviewed",
        partner_reviewed_at: now,
        updated_at: now,
      })
      .eq("id", packageId)
      .select()
      .single()

    if (error) {
      console.error("[partner/onboarding-packages] PATCH", error)
      return NextResponse.json({ error: "Update failed" }, { status: 500 })
    }

    return NextResponse.json({ package: row })
  } catch (e) {
    console.error("[partner/onboarding-packages] PATCH", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
