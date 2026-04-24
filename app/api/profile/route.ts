import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

type PatchBody = {
  full_name?: string
  display_name?: string
  avatar_url?: string | null
}

export async function PATCH(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json()) as PatchBody
    const updates: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof body.full_name === "string") {
      updates.full_name = body.full_name.trim()
    }
    if (typeof body.display_name === "string") {
      updates.display_name = body.display_name.trim()
    }
    if (body.avatar_url === null || typeof body.avatar_url === "string") {
      updates.avatar_url = body.avatar_url
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
