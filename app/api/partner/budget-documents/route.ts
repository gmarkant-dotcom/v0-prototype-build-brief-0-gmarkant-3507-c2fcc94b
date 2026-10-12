import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { resolveCallerOrgIds } from "@/lib/entitlements"
import { listVendorBudgetDocuments } from "@/lib/server/budget/vendor-documents"
import { NOT_ENABLED_BODY, noStore } from "@/lib/server/budget/http"

export const dynamic = "force-dynamic"

/**
 * GET: the budget documents this vendor may read, grouped per project. VENDOR SIDE, NOT UNDER THE
 * AGENCY GATE. The caller's session client only; source_documents_vendor_select (104, R4) decides
 * every row. No role, active_role or secondary_role is read: the organization set comes from
 * org_members. Metadata only (name, type, date, source); no path, no file, no amounts.
 *
 *   401 not signed in · 403 no organization · 404 { enabled: false } spine not enabled · 200 { projects }
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore })
    const orgIds = await resolveCallerOrgIds(user.id, supabase)
    if (orgIds.length === 0) {
      return NextResponse.json({ error: "Your account is not linked to an organization yet" }, { status: 403, headers: noStore })
    }
    const result = await listVendorBudgetDocuments(supabase, orgIds)
    if (!result.ok) {
      if (result.kind === "disabled") return NextResponse.json(NOT_ENABLED_BODY, { status: 404, headers: noStore })
      console.error("[api/partner/budget-documents] GET", { code: result.code, message: result.message })
      return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
    }
    return NextResponse.json({ projects: result.data }, { headers: noStore })
  } catch (e) {
    console.error("[api/partner/budget-documents] GET", e)
    return NextResponse.json({ error: "Failed" }, { status: 500, headers: noStore })
  }
}
