import { resolveCallerOrgIds } from "@/lib/entitlements"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  ORG_CONTACT_SELECT,
  logOrgContactGap,
  orgWireShape,
  resolveOrgContact,
  type OrgEmbed,
  type OrgWireShape,
} from "@/lib/org-contact"

export const dynamic = "force-dynamic"

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role, active_role").eq("id", user.id).single()
    const isPartner = profile?.role === "partner" || profile?.active_role === "partner"
    if (!isPartner) {
      return NextResponse.json({ error: "Vendor only" }, { status: 403 })
    }

    // 079: an organization column is not a user id. Reads scope to the caller's memberships.
    const callerOrgIds = await resolveCallerOrgIds(user.id, supabase)

    const { data: partnerships } = await supabase.from("partnerships").select("id").in("vendor_org_id", callerOrgIds)
    const pids = (partnerships || []).map((p) => p.id)
    if (pids.length === 0) {
      return NextResponse.json({ packages: [] })
    }

    const { data: packages, error } = await supabase
      .from("onboarding_packages")
      .select("*")
      .in("partnership_id", pids)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[partner/onboarding-packages] GET packages", error)
      return NextResponse.json({ packages: [], error: error.message }, { status: 500 })
    }

    const projectIds = [
      ...new Set(
        (packages || [])
          .map((p) => p.project_id as string | null | undefined)
          .filter((id): id is string => Boolean(id))
      ),
    ]
    const agencyIds = [...new Set((packages || []).map((p) => p.org_id as string))]
    const projectMap: Record<string, { name: string | null; client_name: string | null }> = {}
    const leadOrgMap: Record<string, OrgWireShape> = {}

    if (projectIds.length > 0) {
      const { data: projects, error: projectsError } = await supabase
        .from("projects")
        .select("id, name, client_name")
        .in("id", projectIds)
      console.log("[partner/onboarding-packages] projects lookup raw result", {
        projectIds,
        data: projects,
        error: projectsError,
        rowCount: projects?.length ?? 0,
      })
      for (const pr of projects || []) {
        const row = pr as { id: string; name: string | null; client_name: string | null }
        projectMap[row.id] = { name: row.name, client_name: row.client_name }
      }
    } else {
      console.log("[partner/onboarding-packages] projects lookup skipped", {
        projectIds,
        packageProjectIdsRaw: (packages || []).map((p) => p.project_id),
        reason: "no valid project_id on packages",
      })
    }
    // 079-EMBED (15th site, and NEITHER GUARD SEES IT). This is the third instance of the
    // same break in non-embed form - "JOIN profiles ON profiles.id = an org id", the trap
    // 079's own table comment names. agencyIds are onboarding_packages.org_id values, which
    // are ORGANIZATION ids after 079. Looking them up in `profiles` works for every
    // backfilled organization and returns nothing for every one created after 079, blanking
    // the lead agency's name on the vendor onboarding page.
    //
    // The identity guard does not see it because the column name is already the post-079
    // one, and the embed guard does not see it because there is no `table!hint(` embed here
    // at all - it is a separate .from("profiles").in("id", <org ids>) call. Four more sites
    // of this exact shape are listed in docs/079-embed-closure-report.md and are NOT fixed
    // here, because they emit scalar keys that Greg's rename ruling does not cover.
    if (agencyIds.length > 0) {
      const { data: leadOrgRows, error: leadOrgErr } = await supabase
        .from("organizations")
        .select(ORG_CONTACT_SELECT)
        .in("id", agencyIds)
      if (leadOrgErr) {
        console.error("[partner/onboarding-packages] lead organizations lookup failed", {
          agencyIdCount: agencyIds.length,
          message: leadOrgErr.message,
          code: leadOrgErr.code,
        })
      }
      for (const org of leadOrgRows || []) {
        const orgId = (org as { id?: string }).id
        if (!orgId) continue
        const contact = resolveOrgContact(org as OrgEmbed, null)
        logOrgContactGap("GET /api/partner/onboarding-packages", contact, { leadOrgId: orgId })
        const shaped = orgWireShape(org as OrgEmbed, null)
        if (shaped) leadOrgMap[orgId] = shaped
      }
      const missing = agencyIds.filter((id) => !leadOrgMap[id])
      if (missing.length > 0) {
        console.warn("[partner/onboarding-packages] lead organizations not readable", {
          missingCount: missing.length,
          reason: "row level security on organizations, or the row does not exist",
        })
      }
    }

    const pkgIds = (packages || []).map((p) => p.id)
    let docsByPackage: Record<string, unknown[]> = {}
    if (pkgIds.length > 0) {
      const { data: docs, error: derr } = await supabase
        .from("onboarding_package_documents")
        .select("*")
        .in("package_id", pkgIds)
        .order("sort_order", { ascending: true })

      if (!derr && docs) {
        docsByPackage = docs.reduce<Record<string, unknown[]>>((acc, row) => {
          const pid = row.package_id as string
          if (!acc[pid]) acc[pid] = []
          acc[pid].push(row)
          return acc
        }, {})
      }
    }

    const enriched = (packages || []).map((p) => ({
      ...p,
      project: projectMap[p.project_id as string] || null,
      lead_org: leadOrgMap[p.org_id as string] || null,
      documents: docsByPackage[p.id] || [],
    }))

    return NextResponse.json({ packages: enriched })
  } catch (e) {
    console.error("[partner/onboarding-packages] GET", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
