import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { createClient } from "@/lib/supabase/server"

type PatchBody = {
  full_name?: string
  display_name?: string
  avatar_url?: string | null
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const body = (await req.json()) as PatchBody
    const avatar_url = body.avatar_url
    const updates: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof body.full_name === "string") {
      updates.full_name = body.full_name.trim()
    }
    if (typeof body.display_name === "string") {
      updates.display_name = body.display_name.trim()
    }
    if (avatar_url === null || typeof avatar_url === "string") {
      updates.avatar_url = avatar_url
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("id, full_name, display_name, avatar_url")
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ profile: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update profile" },
      { status: 500 }
    )
  }
}
