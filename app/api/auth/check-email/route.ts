import { NextResponse, type NextRequest } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const route = "/api/auth/check-email"
  try {
    const email = (new URL(request.url).searchParams.get("email") || "").trim().toLowerCase()
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 })
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Missing Supabase service configuration" }, { status: 500 })
    }
    // Service role: this check must run before the visitor has any session.
    // Only ever returns a boolean — no profile data is exposed.
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    const { data, error } = await supabase.from("profiles").select("id").ilike("email", email).maybeSingle()
    if (error) {
      console.error("[api] failure", { route, method: "GET", code: 500, message: error.message })
      return NextResponse.json({ error: "Failed to check email" }, { status: 500 })
    }
    return NextResponse.json({ exists: Boolean(data?.id) })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "GET",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to check email" }, { status: 500 })
  }
}
