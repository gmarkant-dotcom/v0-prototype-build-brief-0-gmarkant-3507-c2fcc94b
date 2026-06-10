import { NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

const OWNER_EMAIL = "greg@withligament.com"

export async function GET() {
  try {
    // Verify the caller is the owner using their session
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (user.email !== OWNER_EMAIL) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Use service role key to bypass RLS and read all profiles
    const serviceClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: profiles, error } = await serviceClient
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)

    if (error) {
      console.error("[admin/users] profiles query failed", error)
      return NextResponse.json({ error: "Failed to load users" }, { status: 500 })
    }

    return NextResponse.json({ users: profiles ?? [] })
  } catch (e) {
    console.error("[admin/users] unhandled", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
