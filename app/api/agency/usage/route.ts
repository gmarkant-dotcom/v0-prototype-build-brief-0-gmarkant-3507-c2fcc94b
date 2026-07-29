import { NextResponse } from "next/server"
import { requireAgencyRole } from "@/lib/api-auth"
import { checkUsageLimits } from "@/lib/usage-tracking"

export const dynamic = "force-dynamic"

export async function GET() {
  const route = "/api/agency/usage"
  try {
    const auth = await requireAgencyRole()
    if (!auth.authorized) return auth.response
    const { user, supabase } = auth

    const usage = await checkUsageLimits(user.id, supabase)
    return NextResponse.json(usage)
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "GET",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: "Failed to load usage" }, { status: 500 })
  }
}
