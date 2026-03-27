"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  User,
  Mail,
  Calendar,
  FolderOpen,
  FileText,
  CheckCircle,
  Clock,
  ExternalLink,
} from "lucide-react"

export type PartnerProjectPayload = {
  assignment: { id: string; status: string; bid_notes: string | null }
  project: {
    id: string
    title: string
    client_name: string | null
    description: string | null
    budget_range: string | null
    status: string
    start_date: string | null
    end_date: string | null
  }
  agency: {
    id: string
    email: string | null
    full_name: string | null
    company_name: string | null
  } | null
  agreements: Array<{
    id: string
    agreement_type: string
    status: string
    signed_at: string | null
    template_label: string | null
  }>
  deployments: Array<{ id: string; deployed_at?: string; document_ids?: unknown }>
}

type Tab = "essentials" | "onboarding" | "deliverables"

export function PartnerProjectProductionDetail({
  data,
  initialTab = "essentials",
}: {
  data: PartnerProjectPayload
  initialTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(initialTab)

  const agreements = data.agreements || []
  const nda = agreements.find((a) => a.agreement_type === "nda")
  const sow = agreements.find((a) => a.agreement_type === "sow")

  const agencyLabel = useMemo(
    () =>
      data.agency?.company_name ||
      data.agency?.full_name ||
      "Lead agency",
    [data.agency]
  )

  const sign = async (agreementId: string) => {
    await fetch(`/api/projects/${data.project.id}/agreements/${agreementId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "signed" }),
    })
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display font-bold text-2xl text-[#0C3535]">
              {data.project.title}
            </h1>
            <p className="font-mono text-xs text-gray-500 mt-1">
              {agencyLabel}
              {data.project.client_name ? ` · ${data.project.client_name}` : ""}
            </p>
          </div>
          <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 capitalize">
            {data.assignment.status.replace("_", " ")}
          </span>
        </div>
        {data.project.description && (
          <p className="text-sm text-gray-600 mt-4">{data.project.description}</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
          {data.project.budget_range && (
            <div>
              <div className="font-mono text-[10px] text-gray-400 uppercase">Budget</div>
              <div className="text-[#0C3535]">{data.project.budget_range}</div>
            </div>
          )}
          {data.project.start_date && (
            <div>
              <div className="font-mono text-[10px] text-gray-400 uppercase">Start</div>
              <div className="text-[#0C3535]">{data.project.start_date}</div>
            </div>
          )}
          {data.project.end_date && (
            <div>
              <div className="font-mono text-[10px] text-gray-400 uppercase">End</div>
              <div className="text-[#0C3535]">{data.project.end_date}</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {(
          [
            ["essentials", "Project essentials"],
            ["onboarding", "Onboarding & legal"],
            ["deliverables", "Deliverables"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "px-4 py-2 font-mono text-xs capitalize border-b-2 -mb-px",
              tab === id
                ? "border-[#0C3535] text-[#0C3535]"
                : "border-transparent text-gray-500 hover:text-[#0C3535]"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "essentials" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <User className="w-4 h-4 text-[#0C3535]" />
              <span className="font-mono text-[10px] text-[#0C3535] uppercase tracking-wider">
                Lead agency contact
              </span>
            </div>
            <div className="font-display font-bold text-[#0C3535]">{agencyLabel}</div>
            {data.agency?.email && (
              <a
                href={`mailto:${data.agency.email}`}
                className="flex items-center gap-2 text-sm text-gray-600 mt-4"
              >
                <Mail className="w-3.5 h-3.5" />
                {data.agency.email}
              </a>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-4 h-4 text-[#0C3535]" />
              <span className="font-mono text-[10px] text-[#0C3535] uppercase tracking-wider">
                Project
              </span>
            </div>
            <p className="text-sm text-gray-600">
              Use this hub for key contacts and shared documents. Detailed PM stays in your tools of
              choice.
            </p>
          </div>
        </div>
      )}

      {tab === "onboarding" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="font-mono text-[10px] text-gray-500 uppercase mb-3">
              Recent deployments
            </div>
            {data.deployments.length === 0 ? (
              <p className="text-sm text-gray-500">No onboarding packet deployed yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.deployments.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <FolderOpen className="w-4 h-4 text-[#0C3535]" />
                    <span>
                      Packet sent{" "}
                      {d.deployed_at
                        ? new Date(d.deployed_at).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "recently"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/partner/onboarding?project=${data.project.id}`}
              className="inline-flex items-center gap-1 text-sm text-[#0C3535] font-mono mt-4 hover:underline"
            >
              Open full onboarding workspace <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="space-y-3">
            <div className="font-mono text-[10px] text-gray-500 uppercase">NDA & scope of work</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  <span className="font-display font-bold text-[#0C3535]">NDA</span>
                  {nda?.status === "signed" ? (
                    <CheckCircle className="w-4 h-4 text-green-600 ml-auto" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-500 ml-auto" />
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {nda ? `Status: ${nda.status}` : "Not requested yet."}
                </p>
                {nda && nda.status !== "signed" && (
                  <Button
                    size="sm"
                    className="bg-[#0C3535] text-white"
                    onClick={() => sign(nda.id)}
                  >
                    Record signature
                  </Button>
                )}
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  <span className="font-display font-bold text-[#0C3535]">Scope of work</span>
                  {sow?.status === "signed" ? (
                    <CheckCircle className="w-4 h-4 text-green-600 ml-auto" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-500 ml-auto" />
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {sow ? `Status: ${sow.status}` : "Not requested yet."}
                </p>
                {sow && sow.status !== "signed" && (
                  <Button
                    size="sm"
                    className="bg-[#0C3535] text-white"
                    onClick={() => sign(sow.id)}
                  >
                    Record signature
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "deliverables" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600">
          <p>
            Track deliverables against your scope of work in the lead agency workflow. Flag alerts
            from your partner portal when that UI is connected.
          </p>
          {data.assignment.bid_notes && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <div className="font-mono text-[10px] text-gray-400 uppercase mb-1">Bid notes</div>
              <p className="text-[#0C3535] whitespace-pre-wrap">{data.assignment.bid_notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
