import { NextResponse, type NextRequest } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { createClient } from "@/lib/supabase/server"
import { getDownloadUrl } from "@vercel/blob"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .single()

    const avatarUrl = profile?.avatar_url
    if (!avatarUrl || typeof avatarUrl !== "string") {
      return NextResponse.json({ error: "No avatar" }, { status: 404 })
    }

    const downloadUrl = await getDownloadUrl(avatarUrl)
    return NextResponse.redirect(downloadUrl)
  } catch (e) {
    console.error("[api/avatar] error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
