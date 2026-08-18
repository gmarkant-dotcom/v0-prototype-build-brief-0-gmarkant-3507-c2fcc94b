import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { createClient as createAnonClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { agencyEntitlementId } from "@/lib/entitlements"

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

  // 079: the claimant is an ORGANISATION. vendor_org_id REFERENCES organizations(id) after
  // 079, so writing a user id here raises a foreign key violation for any vendor
  // organization created after the migration, and silently succeeds only for the sixteen
  // backfilled ones whose id equals their founder's.
  const claimantOrgId = await agencyEntitlementId(userId, serviceSupabase)

  // ---------------------------------------------------------------------------
  // 079 OPENS A FAILURE MODE HERE THAT DOES NOT EXIST TODAY, AND IT IS NOT FIXED.
  //
  // This claims EVERY unclaimed partnership whose partner_email matches the caller's.
  // Before 079 that was one person claiming their own invitations. After 079 the row is
  // claimed by the organization, so the FIRST colleague of a vendor company to sign up
  // takes every ghost row addressed to that email, and the second colleague finds nothing
  // left to claim. Whether that is right depends on an unanswered product question: is a
  // pending invitation addressed to a PERSON or to a COMPANY?
  //
  // Left as-is deliberately. The change above is the minimum that keeps the write valid
  // against the new schema; deciding the collision is a product ruling, not a rename.
  // docs/079-rename-plan.md section 6 route 19 names this as needing an answer before the
  // code is written, and it still does. See docs/079-rename-execution-report.md.
  // ---------------------------------------------------------------------------
  const now = new Date().toISOString()
  const { data, error } = await serviceSupabase
    .from("partnerships")
    .update({ vendor_org_id: claimantOrgId, updated_at: now })
    .is("vendor_org_id", null)
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
  const auth = await requireAuth()
  if (!auth.authorized) return auth.response
  const { user, supabase } = auth
  const userId = user.id
  console.log("[claim] auth userId:", userId)

  const result = await claimPendingPartnershipInvites(userId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true, claimedCount: result.claimedCount })
}

