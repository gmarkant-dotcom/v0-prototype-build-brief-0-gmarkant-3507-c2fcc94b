import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partners only" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("partner_rfp_inbox")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("partner_rfp_inbox select:", error)
      return NextResponse.json({ error: "Failed to load RFPs", detail: error.message }, { status: 500 })
    }

    return NextResponse.json({ rfps: data || [] })
  } catch (e) {
    console.error("partner/rfps GET:", e)
    return NextResponse.json({ error: "Failed to load RFPs" }, { status: 500 })
  }
}
