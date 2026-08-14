import { NextResponse } from "next/server"
import { requireAdminRole } from "@/lib/api-auth"

export async function POST(req: Request) {
  try {
    // Admin gate before the body is read, so an unauthorized caller never reaches parsing.
    const auth = await requireAdminRole()
    if (!auth.authorized) return auth.response

    const body = await req.json().catch(() => ({}))
    const { userId, grant } = body

    if (!userId || typeof grant !== "boolean") {
      return NextResponse.json({ error: "userId and grant required" }, { status: 400 })
    }

    // No service role here, deliberately. This write goes through the admin's own session
    // client, so it is governed by the same profiles policies as the admin panel's other
    // toggles - which is what makes profiles.is_admin the single thing that has to be true.
    const { error } = await auth.supabase
      .from("profiles")
      .update({ secondary_role: grant ? "agency" : null })
      .eq("id", userId)

    if (error) {
      // Log the driver message, do not return it - it can echo column names and constraint
      // details back to the caller.
      console.error("[admin/grant-agency-access] update failed", error.message)
      return NextResponse.json({ error: "Failed to update access" }, { status: 500 })
    }

    return NextResponse.json({ success: true, secondary_role: grant ? "agency" : null })
  } catch (e) {
    console.error("[admin/grant-agency-access]", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
