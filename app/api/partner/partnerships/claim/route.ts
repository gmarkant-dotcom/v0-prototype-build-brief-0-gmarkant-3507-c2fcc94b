import { NextResponse } from "next/server"
import { createClient as createAnonClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

async function claimPendingPartnershipInvites(userId: string): Promise<
  | { ok: true; claimedCount: number }
  | { ok: false; status: number; error: string }
> {
  const supabase = await createAnonClient()
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle<{ email: string | null }>()

  if (profileErr) {
    return { ok: false, status: 500, error: "Failed to load profile" }
  }
  const email = (profile?.email || "").trim().toLowerCase()
  if (!email) {
    return { ok: false, status: 400, error: "No email found on profile" }
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, error: "Missing Supabase service configuration" }
  }
  // Service role used here intentionally — user is pre-verified via anon
  // client auth.getUser() before this function is called. This bypasses
  // RLS only for the partnership claim write, which is gated by email match
  // verified server-side against the authenticated user's profile.
  const serviceSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const now = new Date().toISOString()
  const { data, error } = await serviceSupabase
    .from("partnerships")
    .update({ partner_id: userId, updated_at: now })
    .is("partner_id", null)
    .in("status", ["pending", "active"])
    .ilike("partner_email", email)
    .select("id")
  console.log("[claim] update result:", data, error)

  if (error) {
    return { ok: false, status: 500, error: "Failed to claim partnership invitations" }
  }

  return { ok: true, claimedCount: (data || []).length }
}

export async function POST() {
  const supabase = await createAnonClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = user.id
  console.log("[claim] auth userId:", userId)

  const result = await claimPendingPartnershipInvites(userId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true, claimedCount: result.claimedCount })
}

