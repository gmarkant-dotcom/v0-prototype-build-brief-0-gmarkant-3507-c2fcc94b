"use client"

import { Suspense, useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import Link from "next/link"
import { PartnerLayout } from "@/components/partner-layout"
import { LeadAgencyFilter } from "@/components/lead-agency-filter"
import {
  PartnerProjectProductionDetail,
  type PartnerProjectPayload,
} from "@/components/partner-project-production-detail"
import { isDemoMode } from "@/lib/demo-data"
import { Loader2 } from "lucide-react"

function PartnerProjectDetailInner() {
  const params = useParams()
  const searchParams = useSearchParams()
  const projectId = params.projectId as string
  const tab = searchParams.get("tab")

  const isDemo = isDemoMode()
  const [data, setData] = useState<PartnerProjectPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!isDemo)

  useEffect(() => {
    if (isDemo) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/projects/${projectId}/partner`)
        if (!res.ok) {
          if (!cancelled) setError(res.status === 404 ? "Project not found" : "Failed to load")
          return
        }
        const json = await res.json()
        if (!cancelled) setData(json as PartnerProjectPayload)
      } catch {
        if (!cancelled) setError("Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, isDemo])

  if (isDemo) {
    return (
      <PartnerLayout>
        <div className="p-8 max-w-7xl mx-auto">
          <p className="text-gray-600 mb-4">
            Demo project details are available from{" "}
            <Link href="/partner/projects" className="text-[#0C3535] font-mono underline">
              Active Projects
            </Link>
            .
          </p>
        </div>
      </PartnerLayout>
    )
  }

  const initialTab =
    tab === "onboarding"
      ? ("onboarding" as const)
      : tab === "deliverables"
        ? ("deliverables" as const)
        : ("essentials" as const)

  return (
    <PartnerLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              href="/partner/projects"
              className="font-mono text-xs text-[#0C3535]/70 hover:underline mb-2 inline-block"
            >
              ← All projects
            </Link>
            <h1 className="font-display font-bold text-3xl text-[#0C3535]">Project hub</h1>
            <p className="text-gray-600 mt-1">
              Contacts, onboarding, and shared context for this engagement.
            </p>
          </div>
          <LeadAgencyFilter />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-gray-500 py-12">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading project…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</div>
        )}

        {data && !loading && (
          <PartnerProjectProductionDetail data={data} initialTab={initialTab} />
        )}
      </div>
    </PartnerLayout>
  )
}

export default function PartnerProjectDetailPage() {
  return (
    <Suspense
      fallback={
        <PartnerLayout>
          <div className="p-8 flex items-center gap-2 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        </PartnerLayout>
      }
    >
      <PartnerProjectDetailInner />
    </Suspense>
  )
}
