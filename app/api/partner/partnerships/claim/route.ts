import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

async function claimPendingPartnershipInvites(userId: string): Promise<
  | { ok: true; claimedCount: number }
  | { ok: false; status: number; error: string }
> {
  const supabase = await createClient()
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

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("partnerships")
    .update({ partner_id: userId, updated_at: now })
    .is("partner_id", null)
    .in("status", ["pending", "active"])
    .ilike("partner_email", email)
    .select("id")

  if (error) {
    return { ok: false, status: 500, error: "Failed to claim partnership invitations" }
  }

  return { ok: true, claimedCount: (data || []).length }
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await claimPendingPartnershipInvites(user.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true, claimedCount: result.claimedCount })
}

