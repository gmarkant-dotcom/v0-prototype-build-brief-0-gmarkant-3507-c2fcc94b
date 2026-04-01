"use client"

import { Suspense, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { PartnerLayout } from "@/components/partner-layout"
import { LeadAgencyFilter } from "@/components/lead-agency-filter"
import { isDemoMode } from "@/lib/demo-data"
import { formatEngagementBudget, formatEngagementTimeline } from "@/lib/active-engagement-parse"
import { normalizeMeetingUrlForHref } from "@/lib/utils"
import { Loader2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const btnOutlineLight =
  "border-gray-300 !bg-white text-[#0C3535] shadow-sm hover:!bg-gray-50 hover:text-[#0C3535]"

type ActiveEngagementPayload = {
  found: boolean
  assignmentId?: string
  partnershipId?: string
  project?: { id: string; title: string }
  leadAgency?: {
    email: string | null
    fullName: string | null
    companyName: string | null
  } | null
  scopeItemName?: string | null
  proposalText?: string
  budgetProposal?: string
  timelineProposal?: string
  kickoffUrl?: string | null
  kickoffType?: string | null
  onboardingDocuments?: { label: string; url: string }[]
}

function PartnerActiveEngagementInner() {
  const params = useParams()
  const projectId = params.projectId as string
  const isDemo = isDemoMode()

  const [data, setData] = useState<ActiveEngagementPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!isDemo)

  useEffect(() => {
    if (isDemo) {
      setData({
        found: true,
        assignmentId: "demo",
        project: { id: projectId, title: "NWSL Creator Content Series" },
        leadAgency: {
          companyName: "Electric Animal",
          fullName: "Sarah Chen",
          email: "hello@demo.withligament.com",
        },
        scopeItemName: "Video production",
        proposalText:
          "We’d staff a modular production pod with a showrunner, DP, and post lead. Weekly cuts for review each Friday.",
        budgetProposal: JSON.stringify({ amount: 98000, currency: "USD" }),
        timelineProposal: JSON.stringify({ duration: 10, unit: "weeks" }),
        kickoffUrl: "https://calendly.com/demo/kickoff",
        kickoffType: "calendly",
        onboardingDocuments: [
          { label: "Mutual NDA", url: "https://demo.withligament.com/sample-assets/nda" },
          { label: "MSA", url: "https://demo.withligament.com/sample-assets/msa" },
        ],
      })
      setLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/partner/projects/${projectId}/active-engagement`, {
          credentials: "same-origin",
        })
        const json = (await res.json().catch(() => ({}))) as ActiveEngagementPayload & { error?: string }
        if (!res.ok) {
          if (!cancelled) setError(json.error || "Failed to load")
          return
        }
        if (!cancelled) setData(json)
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

  const agencyName =
    data?.leadAgency?.companyName?.trim() || data?.leadAgency?.fullName?.trim() || "Lead agency"

  return (
    <PartnerLayout>
      <div className="p-8 max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              href="/partner/projects"
              className="font-mono text-xs text-[#0C3535]/70 hover:underline mb-2 inline-block"
            >
              ← All projects
            </Link>
            <h1 className="font-display font-bold text-3xl text-[#0C3535]">Active Engagement</h1>
            {data?.found && data.project && (
              <p className="text-lg text-gray-700 mt-2 font-display font-semibold">{data.project.title}</p>
            )}
          </div>
          <LeadAgencyFilter />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-gray-500 py-12">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</div>
        )}

        {!loading && !error && data && !data.found && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-gray-700">
            No active engagement found for this project. You&apos;ll see details here after the lead agency awards your
            bid.
          </div>
        )}

        {!loading && !error && data?.found && (
          <div className="space-y-6">
            <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h2 className="font-display font-bold text-lg text-[#0C3535] mb-4">Lead agency contact</h2>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-mono text-[10px] uppercase text-gray-500">Company</dt>
                  <dd className="text-gray-900">{data.leadAgency?.companyName || "—"}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase text-gray-500">Contact name</dt>
                  <dd className="text-gray-900">{data.leadAgency?.fullName || "—"}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase text-gray-500">Email</dt>
                  <dd>
                    {data.leadAgency?.email ? (
                      <a href={`mailto:${data.leadAgency.email}`} className="text-[#0C3535] underline font-mono text-xs">
                        {data.leadAgency.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase text-gray-500">Kickoff</dt>
                  <dd>
                    {data.kickoffUrl ? (
                      <a
                        href={normalizeMeetingUrlForHref(data.kickoffUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[#0C3535] font-medium hover:underline"
                      >
                        <ExternalLink className="w-4 h-4" />
                        {data.kickoffType === "calendly" ? "Schedule a meeting" : "Open scheduling link"}
                      </a>
                    ) : (
                      <span className="text-gray-500">Not provided yet</span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h2 className="font-display font-bold text-lg text-[#0C3535] mb-4">Your scope</h2>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="font-mono text-[10px] uppercase text-gray-500">Scope item</dt>
                  <dd className="text-gray-900 font-medium">{data.scopeItemName || "—"}</dd>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <dt className="font-mono text-[10px] uppercase text-gray-500">Proposed budget</dt>
                    <dd className="text-gray-900">{formatEngagementBudget(data.budgetProposal)}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase text-gray-500">Proposed timeline</dt>
                    <dd className="text-gray-900">{formatEngagementTimeline(data.timelineProposal)}</dd>
                  </div>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase text-gray-500 mb-1">Proposal</dt>
                  <dd className="text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {(data.proposalText || "").trim() || "—"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h2 className="font-display font-bold text-lg text-[#0C3535] mb-4">Project documents</h2>
              {(data.onboardingDocuments || []).length === 0 ? (
                <p className="text-sm text-gray-500">No onboarding documents have been shared yet.</p>
              ) : (
                <ul className="space-y-2">
                  {(data.onboardingDocuments || []).map((d, i) => (
                    <li key={`${d.url}-${i}`}>
                      <Button variant="outline" size="sm" className={cn(btnOutlineLight, "justify-start h-auto py-2")} asChild>
                        <a href={d.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3.5 h-3.5 mr-2 shrink-0" />
                          {d.label}
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {isDemo && (
              <p className="font-mono text-[10px] text-gray-500">
                Demo preview for {agencyName}. Production data loads from your awarded assignments.
              </p>
            )}
          </div>
        )}
      </div>
    </PartnerLayout>
  )
}

export default function PartnerProjectActiveEngagementPage() {
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
      <PartnerActiveEngagementInner />
    </Suspense>
  )
}
