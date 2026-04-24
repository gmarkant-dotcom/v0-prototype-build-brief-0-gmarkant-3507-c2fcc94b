import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const role = req.nextUrl.searchParams.get("role")
    if (role !== "agency" && role !== "partner") {
      return NextResponse.json({ error: "Invalid role filter" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.log("[api/marketplace/discoverable] start", { roleFilter: role, userId: user.id })

    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, company_name, full_name, bio, location, company_website, avatar_url, agency_type, email")
      .eq("role", role)
      .eq("is_discoverable", true)
      .order("company_name", { ascending: true })

    if (error) {
      console.error("[marketplace/discoverable] query failed", {
        roleFilter: role,
        code: error.code,
        message: error.message,
      })
      return NextResponse.json({ error: "Failed to load discoverable profiles" }, { status: 500 })
    }

    console.log("[api/marketplace/discoverable] success", {
      roleFilter: role,
      discoverableCount: data?.length ?? 0,
    })

    // Do not expose other users' emails to logged-in viewers (directory is opt-in, email is not public).
    const profiles = (data ?? []).map((row) =>
      row.id === user.id ? row : { ...row, email: null as string | null }
    )

    return NextResponse.json(
      { profiles },
      { headers: { "Cache-Control": "private, no-store, no-cache, must-revalidate" } }
    )
  } catch (error) {
    console.error("[api/marketplace/discoverable] failure", {
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
