"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { AgencyLayout } from "@/components/agency-layout"
import { SelectedProjectHeader } from "@/components/selected-project-header"
import { GlassCard } from "@/components/glass-card"
import { isDemoMode } from "@/lib/demo-data"
import { formatEngagementBudget, formatEngagementTimeline } from "@/lib/active-engagement-parse"
import { normalizeMeetingUrlForHref } from "@/lib/utils"
import { Loader2, ExternalLink } from "lucide-react"

type OnboardingDoc = { label: string; url: string }

type PartnerEngagementRow = {
  assignmentId: string
  partnershipId: string
  awardedAt: string | null
  partner: {
    companyName: string | null
    fullName: string | null
    email: string | null
  }
  scopeItemName: string | null
  proposalText: string
  budgetProposal: string
  timelineProposal: string
  kickoffUrl: string | null
  kickoffType: string | null
  onboardingDocuments: OnboardingDoc[]
}

type ProjectGroup = {
  id: string
  title: string
  partners: PartnerEngagementRow[]
}

function ActiveEngagementsContent() {
  const isDemo = isDemoMode()
  const [projects, setProjects] = useState<ProjectGroup[]>([])
  const [loading, setLoading] = useState(!isDemo)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isDemo) {
      setProjects([
        {
          id: "demo-p1",
          title: "NWSL Creator Content Series",
          partners: [
            {
              assignmentId: "demo-a1",
              partnershipId: "demo-ph1",
              awardedAt: new Date().toISOString(),
              partner: {
                companyName: "Sample Production Studio",
                fullName: "Alex Rivera",
                email: "contact@demo.withligament.com",
              },
              scopeItemName: "Video production",
              proposalText: "Modular production with dedicated showrunner and B-cam for creator days.",
              budgetProposal: JSON.stringify({ amount: 98000, currency: "USD" }),
              timelineProposal: JSON.stringify({ duration: 10, unit: "weeks" }),
              kickoffUrl: "https://calendly.com/demo/kickoff",
              kickoffType: "calendly",
              onboardingDocuments: [
                { label: "Mutual NDA", url: "https://demo.withligament.com/sample-assets/nda" },
                { label: "Master Service Agreement", url: "https://demo.withligament.com/sample-assets/msa" },
              ],
            },
          ],
        },
      ])
      setLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/agency/active-engagements", { credentials: "same-origin" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) setError((data as { error?: string }).error || "Failed to load")
          return
        }
        if (!cancelled) setProjects((data as { projects?: ProjectGroup[] }).projects || [])
      } catch {
        if (!cancelled) setError("Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDemo])

  const partnerDisplayName = (p: PartnerEngagementRow["partner"]) =>
    p.companyName?.trim() || p.fullName?.trim() || "Partner"

  return (
    <div className="p-8 max-w-6xl">
      <SelectedProjectHeader />
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-foreground">Active Engagements</h1>
        <p className="text-sm text-foreground-muted font-mono mt-2 max-w-2xl">
          Awarded partners per project: scope, proposed budget and timeline, contacts, kickoff link, and onboarding
          documents.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-foreground-muted py-12">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading engagements…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      )}

      {!loading && !error && projects.length === 0 && (
        <GlassCard className="p-8 text-center text-foreground-muted text-sm">
          No awarded engagements yet. Award a bid in Bid Management to create a project assignment.
        </GlassCard>
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="space-y-8">
          {projects.map((proj) => (
            <GlassCard key={proj.id} className="p-6 overflow-hidden">
              <h2 className="font-display font-bold text-xl text-foreground border-b border-border/60 pb-3 mb-4">
                {proj.title}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="font-mono text-[10px] uppercase text-foreground-muted text-left border-b border-border/40">
                      <th className="py-2 pr-3 font-medium">Partner</th>
                      <th className="py-2 pr-3 font-medium">Scope</th>
                      <th className="py-2 pr-3 font-medium">Budget</th>
                      <th className="py-2 pr-3 font-medium">Timeline</th>
                      <th className="py-2 pr-3 font-medium">Contact</th>
                      <th className="py-2 pr-3 font-medium">Kickoff</th>
                      <th className="py-2 font-medium">Documents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proj.partners.map((row) => (
                      <tr key={row.assignmentId} className="border-b border-border/30 align-top">
                        <td className="py-3 pr-3 text-foreground font-medium">{partnerDisplayName(row.partner)}</td>
                        <td className="py-3 pr-3 text-foreground/90">{row.scopeItemName || "—"}</td>
                        <td className="py-3 pr-3 text-foreground/90 whitespace-nowrap">
                          {formatEngagementBudget(row.budgetProposal)}
                        </td>
                        <td className="py-3 pr-3 text-foreground/90 whitespace-nowrap">
                          {formatEngagementTimeline(row.timelineProposal)}
                        </td>
                        <td className="py-3 pr-3">
                          <div className="text-foreground/90">{row.partner.fullName || "—"}</div>
                          {row.partner.email ? (
                            <a
                              href={`mailto:${row.partner.email}`}
                              className="font-mono text-[10px] text-accent hover:underline break-all"
                            >
                              {row.partner.email}
                            </a>
                          ) : (
                            <span className="text-foreground-muted">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          {row.kickoffUrl ? (
                            <a
                              href={normalizeMeetingUrlForHref(row.kickoffUrl)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-accent hover:underline font-mono text-[10px]"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              {row.kickoffType === "calendly" ? "Schedule" : "Link"}
                            </a>
                          ) : (
                            <span className="text-foreground-muted">—</span>
                          )}
                        </td>
                        <td className="py-3">
                          {row.onboardingDocuments.length === 0 ? (
                            <span className="text-foreground-muted">—</span>
                          ) : (
                            <ul className="space-y-1">
                              {row.onboardingDocuments.map((d, i) => (
                                <li key={`${d.url}-${i}`}>
                                  <a
                                    href={d.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-[10px] text-accent hover:underline"
                                  >
                                    {d.label}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isDemo && (
                <p className="font-mono text-[10px] text-foreground-muted mt-4">
                  Demo preview — production data loads from{" "}
                  <Link href="/agency/bids" className="text-accent underline">
                    awarded bids
                  </Link>
                  .
                </p>
              )}
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AgencyActiveEngagementsPage() {
  return (
    <AgencyLayout>
      <Suspense
        fallback={
          <div className="p-8 flex items-center gap-2 text-foreground-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading…
          </div>
        }
      >
        <ActiveEngagementsContent />
      </Suspense>
    </AgencyLayout>
  )
}
