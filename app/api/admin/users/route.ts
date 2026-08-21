import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { requireAdminRole } from "@/lib/api-auth"
import { resolveOrgIdsForUsers } from "@/lib/entitlements"

export const dynamic = "force-dynamic"

/**
 * Exactly the columns app/admin/users/page.tsx renders, searches or toggles on. Previously
 * this route selected "*", which shipped every profile column - business_criteria,
 * default_terms, default_nda_url, notification_preferences and every contact field - for
 * every user on the platform, to a page that displays eight of them. is_admin and
 * secondary_role are deliberately absent: the page's User type declared both and its JSX
 * reads neither.
 */
const ADMIN_USER_COLUMNS = "id, email, full_name, company_name, role, demo_access, created_at"

/**
 * 092: is_paid IS NOT IN THAT LIST ANY MORE, AND ITS ABSENCE IS THE POINT.
 *
 * Entitlement moved onto `organizations.is_paid` - one price per company, any number of
 * colleagues. The page still renders a per-user `is_paid` column and still toggles it, so
 * this route composes THE USER'S ORGANIZATION'S flag onto each row below.
 *
 * IF THIS ROUTE HAD BEEN LEFT ALONE, the admin panel would list a profile column nothing
 * reads as an entitlement, and every toggle would appear to work against a number that
 * decides nothing. That is the silent-success shape this whole surface keeps being bitten
 * by, so the read moves in the same push as the write.
 *
 * TWO COLLEAGUES OF ONE COMPANY WILL SHOW THE SAME VALUE. That is correct, and it is the
 * first place in the product where that becomes visible.
 */

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

    const rows = (profiles ?? []) as Array<Record<string, unknown>>

    // 092. THE ENTITLEMENT JOIN, IN TWO QUERIES RATHER THAN N.
    //
    // resolveOrgIdsForUsers() reads org_members once for every user on the page; the
    // organizations read is one more. Both go out on the service role, which is what makes
    // them able to see other people's rows at all.
    const orgIdByUser = await resolveOrgIdsForUsers(
      rows.map((r) => String(r.id ?? "")).filter(Boolean),
      serviceClient
    )

    const paidByOrg = new Map<string, boolean>()
    const orgIds = Array.from(new Set(Array.from(orgIdByUser.values())))
    if (orgIds.length > 0) {
      const { data: orgs, error: orgError } = await serviceClient
        .from("organizations")
        .select("id, is_paid")
        .in("id", orgIds)

      if (orgError) {
        // FAIL THE REQUEST. Returning the list with every is_paid reading false would tell
        // the admin that every customer on the platform has lapsed, and the toggle they
        // then reach for would be acting on a number this route made up. An empty page with
        // an error is recoverable; a confidently wrong one is not.
        console.error("[admin/users] organizations query failed", {
          message: orgError.message,
          code: orgError.code,
          hint:
            orgError.code === "42703"
              ? "42703 is undefined_column: migration 092 has not been applied to this database. Apply supabase/migrations/092_org_entitlement.sql."
              : undefined,
        })
        return NextResponse.json({ error: "Failed to load company subscriptions" }, { status: 500 })
      }

      for (const org of (orgs ?? []) as Array<{ id?: string | null; is_paid?: boolean | null }>) {
        if (org.id) paidByOrg.set(org.id, org.is_paid === true)
      }
    }

    const users = rows.map((r) => {
      const orgId = orgIdByUser.get(String(r.id ?? ""))
      return {
        ...r,
        // An account with no organization, or an organization with no row, is NOT entitled.
        // Fails closed, and the same way resolveAgencyEntitlement() does, so the panel and
        // the product cannot disagree about who is paid.
        is_paid: orgId ? paidByOrg.get(orgId) === true : false,
      }
    })

    return NextResponse.json({ users })
  } catch (e) {
    console.error("[admin/users] unhandled", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
