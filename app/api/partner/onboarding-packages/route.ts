import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "partner") {
      return NextResponse.json({ error: "Partner only" }, { status: 403 })
    }

    const { data: partnerships } = await supabase.from("partnerships").select("id").eq("partner_id", user.id)
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

    const projectIds = [...new Set((packages || []).map((p) => p.project_id as string))]
    const agencyIds = [...new Set((packages || []).map((p) => p.agency_id as string))]
    const projectMap: Record<string, { title: string | null }> = {}
    const agencyMap: Record<string, { company_name: string | null; full_name: string | null }> = {}

    if (projectIds.length > 0) {
      const { data: projects } = await supabase.from("projects").select("id, title").in("id", projectIds)
      for (const pr of projects || []) projectMap[pr.id] = { title: pr.title }
    }
    if (agencyIds.length > 0) {
      const { data: agencies } = await supabase
        .from("profiles")
        .select("id, company_name, full_name")
        .in("id", agencyIds)
      for (const a of agencies || []) agencyMap[a.id] = { company_name: a.company_name, full_name: a.full_name }
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
      agency: agencyMap[p.agency_id as string] || null,
      documents: docsByPackage[p.id] || [],
    }))

    return NextResponse.json({ packages: enriched })
  } catch (e) {
    console.error("[partner/onboarding-packages] GET", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
