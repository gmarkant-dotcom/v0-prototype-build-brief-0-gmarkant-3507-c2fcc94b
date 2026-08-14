import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { requireAdminRole } from "@/lib/api-auth"

export const dynamic = "force-dynamic"

/**
 * Exactly the columns app/admin/users/page.tsx renders, searches or toggles on. Previously
 * this route selected "*", which shipped every profile column - business_criteria,
 * default_terms, default_nda_url, notification_preferences and every contact field - for
 * every user on the platform, to a page that displays eight of them. is_admin and
 * secondary_role are deliberately absent: the page's User type declared both and its JSX
 * reads neither.
 */
const ADMIN_USER_COLUMNS = "id, email, full_name, company_name, role, is_paid, demo_access, created_at"

/**
 * The page renders one flat table with a client-side search filter and no pagination, so
 * this cap is the whole result set rather than a page size. Lowering it would silently hide
 * accounts from the admin's own tool; it is a runaway guard, not a page boundary.
 */
const MAX_USERS = 500

export async function GET() {
  try {
    // Admin gate first, before any service-role client is constructed.
    const auth = await requireAdminRole()
    if (!auth.authorized) return auth.response

    // Service role is still required AFTER the gate: this route's purpose is to list every
    // profile on the platform, and the caller's own RLS scope on profiles is their own row
    // plus discoverable/partnered profiles. No policy grants a cross-platform read, so the
    // listing cannot be done with the session client.
    const serviceClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: profiles, error } = await serviceClient
      .from("profiles")
      .select(ADMIN_USER_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(MAX_USERS)

    if (error) {
      console.error("[admin/users] profiles query failed", error.message)
      return NextResponse.json({ error: "Failed to load users" }, { status: 500 })
    }

    return NextResponse.json({ users: profiles ?? [] })
  } catch (e) {
    console.error("[admin/users] unhandled", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
