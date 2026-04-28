import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .single()

    const avatarUrl = profile?.avatar_url
    if (!avatarUrl || typeof avatarUrl !== "string") {
      return NextResponse.json({ error: "No avatar" }, { status: 404 })
    }

    const res = await fetch(avatarUrl, {
      headers: { "User-Agent": "Ligament/1.0" },
    })

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch avatar" }, { status: 502 })
    }

    const contentType = res.headers.get("content-type") || "image/jpeg"
    const buffer = await res.arrayBuffer()

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (e) {
    console.error("[api/avatar] error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
