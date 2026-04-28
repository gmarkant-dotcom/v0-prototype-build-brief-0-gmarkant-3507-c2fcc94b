import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", user.id)
      .single()

    if (profile?.email !== "greg@withligament.com") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const { userId, grant } = body

    if (!userId || typeof grant !== "boolean") {
      return NextResponse.json({ error: "userId and grant required" }, { status: 400 })
    }

    const { error } = await supabase
      .from("profiles")
      .update({ secondary_role: grant ? "agency" : null })
      .eq("id", userId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, secondary_role: grant ? "agency" : null })
  } catch (e) {
    console.error("[admin/grant-agency-access]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
