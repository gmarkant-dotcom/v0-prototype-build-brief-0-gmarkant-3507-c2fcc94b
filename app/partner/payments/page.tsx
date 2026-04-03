"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Building2, Check, ChevronDown } from "lucide-react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"

type MilestoneRow = {
  id: string
  title: string
  amount: number
  currency: string
  due_date: string
  status: string
  paid_at: string | null
  notes: string | null
  partnership_id: string | null
  project_id: string
  response_id: string | null
  project_name: string
  client_name: string | null
  scope_item_name: string | null
}

type PartnerEngagement = {
  project_id: string
  project_name: string
  client_name: string | null
  partnership_id: string
  agency_id: string | null
  assignment_id: string
  response_id: string | null
  scope_item_name: string | null
  awarded_at: string | null
}

type PartnershipApiRow = {
  id: string
  agency_id: string
  status?: string | null
  agency?: { company_name?: string | null; full_name?: string | null } | null
}

type RateInfoPayload = {
  hourly_rate: string
  project_minimum: string
  payment_terms: string
  payment_terms_custom: string
  notes: string
}

const emptyRate = (): RateInfoPayload => ({
  hourly_rate: "",
  project_minimum: "",
  payment_terms: "net_30",
  payment_terms_custom: "",
  notes: "",
})

const DEMO_RESPONSE_ID = "demo-resp-1"
const DEMO_PROJECT_ID = "demo-project-nwsl"

const demoEngagements: PartnerEngagement[] = [
  {
    project_id: DEMO_PROJECT_ID,
    project_name: "NWSL Creator Content Series",
    client_name: "NWSL",
    assignment_id: "demo-asg-1",
    partnership_id: "demo-p1",
    agency_id: "demo-agency-1",
    awarded_at: "2026-01-01T12:00:00Z",
    response_id: DEMO_RESPONSE_ID,
    scope_item_name: "Creator content",
  },
]

const demoMilestones: MilestoneRow[] = [
  {
    id: "dm1",
    title: "Kick-off",
    amount: 19400,
    currency: "USD",
    due_date: "2026-01-14",
    status: "paid",
    paid_at: "2026-01-14T12:00:00Z",
    notes: null,
    partnership_id: "demo-p1",
    project_id: DEMO_PROJECT_ID,
    response_id: DEMO_RESPONSE_ID,
    project_name: "NWSL Creator Content Series",
    client_name: "NWSL",
    scope_item_name: "Creator content",
  },
  {
    id: "dm2",
    title: "Mid-point delivery",
    amount: 38800,
    currency: "USD",
    due_date: "2026-02-28",
    status: "paid",
    paid_at: "2026-02-28T12:00:00Z",
    notes: null,
    partnership_id: "demo-p1",
    project_id: DEMO_PROJECT_ID,
    response_id: DEMO_RESPONSE_ID,
    project_name: "NWSL Creator Content Series",
    client_name: "NWSL",
    scope_item_name: "Creator content",
  },
  {
    id: "dm3",
    title: "Final delivery",
    amount: 29100,
    currency: "USD",
    due_date: "2026-04-15",
    status: "invoiced",
    paid_at: null,
    notes: null,
    partnership_id: "demo-p1",
    project_id: DEMO_PROJECT_ID,
    response_id: DEMO_RESPONSE_ID,
    project_name: "NWSL Creator Content Series",
    client_name: "NWSL",
    scope_item_name: "Creator content",
  },
  {
    id: "dm4",
    title: "Wrap & reporting",
    amount: 9700,
    currency: "USD",
    due_date: "2026-06-01",
    status: "pending",
    paid_at: null,
    notes: null,
    partnership_id: "demo-p1",
    project_id: DEMO_PROJECT_ID,
    response_id: DEMO_RESPONSE_ID,
    project_name: "NWSL Creator Content Series",
    client_name: "NWSL",
    scope_item_name: "Creator content",
  },
]

const demoActivePartnerships: PartnershipApiRow[] = [
  { id: "demo-p1", agency_id: "demo-agency-1", status: "active", agency: { company_name: "Tandem Social" } },
  { id: "demo-p2", agency_id: "demo-agency-2", status: "active", agency: { company_name: "North Star Media" } },
]

const demoRatesSeeded: Record<string, RateInfoPayload> = {
  "demo-p1": {
    hourly_rate: "250",
    project_minimum: "5000",
    payment_terms: "net_30",
    payment_terms_custom: "",
    notes: "",
  },
  "demo-p2": {
    hourly_rate: "200",
    project_minimum: "4000",
    payment_terms: "net_45",
    payment_terms_custom: "",
    notes: "NY metro preferred.",
  },
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount)
  } catch {
    return `${currency || "USD"} ${amount.toLocaleString()}`
  }
}

function formatDueDate(iso: string) {
  try {
    const d = new Date(`${iso}T12:00:00`)
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  } catch {
    return iso
  }
}

function statusBadgeClass(status: string) {
  const s = status.toLowerCase()
  if (s === "paid") return "bg-green-100 text-green-800"
  if (s === "invoiced") return "bg-amber-100 text-amber-800"
  return "bg-gray-100 text-gray-600"
}

function agencyLabel(p: PartnershipApiRow) {
  const a = p.agency
  const name = (a?.company_name || "").trim() || (a?.full_name || "").trim()
  return name || "Lead agency"
}

function agencyInitials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "LA"
  return parts
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

/** Milestones for one awarded engagement (match response_id when set; else project + partnership). */
function milestonesForEngagement(milestones: MilestoneRow[], eng: PartnerEngagement): MilestoneRow[] {
  return milestones.filter((m) => {
    if (m.project_id !== eng.project_id) return false
    if (m.response_id) {
      return eng.response_id != null && m.response_id === eng.response_id
    }
    return m.partnership_id == null || m.partnership_id === eng.partnership_id
  })
}

export default function PartnerPaymentsPage() {
  const isDemo = isDemoMode()

  const [activePartnerships, setActivePartnerships] = useState<PartnershipApiRow[]>([])
  const [partnershipsError, setPartnershipsError] = useState<string | null>(null)
  const [loadingPartnerships, setLoadingPartnerships] = useState(!isDemo)

  const [allMilestones, setAllMilestones] = useState<MilestoneRow[]>([])
  const [paymentsError, setPaymentsError] = useState<string | null>(null)
  const [loadingPayments, setLoadingPayments] = useState(!isDemo)

  const [engagements, setEngagements] = useState<PartnerEngagement[]>([])
  const [engagementsError, setEngagementsError] = useState<string | null>(null)
  const [loadingEngagements, setLoadingEngagements] = useState(!isDemo)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [agencyDropdownOpen, setAgencyDropdownOpen] = useState(false)
  const agencyDropdownRef = useRef<HTMLDivElement>(null)

  const [openEngagementAssignmentId, setOpenEngagementAssignmentId] = useState<string | null>(null)

  const [bio, setBio] = useState("")
  const [location, setLocation] = useState("")
  const [website, setWebsite] = useState("")
  const [rateInfo, setRateInfo] = useState<RateInfoPayload>(emptyRate)
  const [loadingRate, setLoadingRate] = useState(false)
  const [rateError, setRateError] = useState<string | null>(null)
  const [savingRate, setSavingRate] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [demoRates, setDemoRates] = useState<Record<string, RateInfoPayload>>(demoRatesSeeded)

  const loadAll = useCallback(async () => {
    if (isDemo) {
      setActivePartnerships(demoActivePartnerships)
      setAllMilestones(demoMilestones)
      setEngagements(demoEngagements)
      setSelectedId((prev) => {
        const ids = demoActivePartnerships.map((p) => p.id)
        if (prev && ids.includes(prev)) return prev
        return ids[0] ?? null
      })
      setLoadingPartnerships(false)
      setLoadingPayments(false)
      setLoadingEngagements(false)
      setPartnershipsError(null)
      setPaymentsError(null)
      setEngagementsError(null)
      return
    }

    setLoadingPartnerships(true)
    setLoadingPayments(true)
    setLoadingEngagements(true)
    setPartnershipsError(null)
    setPaymentsError(null)
    setEngagementsError(null)

    try {
      const [partRes, payRes, engRes] = await Promise.all([
        fetch("/api/partnerships", { credentials: "same-origin" }),
        fetch("/api/partner/payments", { credentials: "same-origin" }),
        fetch("/api/partner/projects", { credentials: "same-origin" }),
      ])

      const partData = await partRes.json().catch(() => ({}))
      if (!partRes.ok) {
        setPartnershipsError((partData as { error?: string }).error || "Failed to load partnerships")
        setActivePartnerships([])
      } else {
        const rows = ((partData as { partnerships?: PartnershipApiRow[] }).partnerships || []).filter(
          (p) => String(p.status || "").toLowerCase() === "active"
        )
        setActivePartnerships(rows)
        setSelectedId((prev) => {
          const ids = rows.map((r) => r.id)
          if (prev && ids.includes(prev)) return prev
          return ids[0] ?? null
        })
      }

      const payData = await payRes.json().catch(() => ({}))
      if (!payRes.ok) {
        setPaymentsError((payData as { error?: string }).error || "Failed to load payment milestones")
        setAllMilestones([])
      } else {
        const raw = (payData as { milestones?: unknown }).milestones
        const list = Array.isArray(raw) ? raw : []
        setAllMilestones(list as MilestoneRow[])
      }

      const engData = await engRes.json().catch(() => ({}))
      if (!engRes.ok) {
        setEngagementsError((engData as { error?: string }).error || "Failed to load engagements")
        setEngagements([])
      } else {
        const raw = (engData as { projects?: unknown }).projects
        const list = Array.isArray(raw) ? raw : []
        const mapped: PartnerEngagement[] = []
        for (const item of list) {
          if (!item || typeof item !== "object") continue
          const p = item as Record<string, unknown>
          const project_id =
            p.project_id != null ? String(p.project_id) : p.id != null ? String(p.id) : ""
          if (!project_id) continue
          const project_name = String(p.project_name ?? p.name ?? "Project")
          const scope =
            p.scope_item_name != null && String(p.scope_item_name).trim() !== ""
              ? String(p.scope_item_name).trim()
              : null
          mapped.push({
            project_id,
            project_name,
            client_name: p.client_name != null ? String(p.client_name) : null,
            assignment_id: String(p.assignment_id || ""),
            partnership_id: String(p.partnership_id || ""),
            agency_id: p.agency_id != null ? String(p.agency_id) : null,
            awarded_at: p.awarded_at != null ? String(p.awarded_at) : null,
            response_id: p.response_id != null ? String(p.response_id) : null,
            scope_item_name: scope,
          })
        }
        setEngagements(mapped.filter((e) => e.partnership_id && (e.assignment_id || e.response_id)))
      }
    } catch {
      setPartnershipsError("Failed to load partnerships")
      setPaymentsError("Failed to load payments")
      setEngagementsError("Failed to load engagements")
      setActivePartnerships([])
      setAllMilestones([])
      setEngagements([])
    } finally {
      setLoadingPartnerships(false)
      setLoadingPayments(false)
      setLoadingEngagements(false)
    }
  }, [isDemo])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (agencyDropdownRef.current && !agencyDropdownRef.current.contains(e.target as Node)) {
        setAgencyDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [])

  const selectedPartnershipRow = useMemo(
    () => activePartnerships.find((p) => p.id === selectedId) ?? null,
    [activePartnerships, selectedId]
  )

  const engagementsForAgency = useMemo(() => {
    if (!selectedId) return []
    return engagements.filter((e) => e.partnership_id === selectedId)
  }, [engagements, selectedId])

  useEffect(() => {
    const first = engagementsForAgency[0]
    const rowKey = first
      ? `${first.assignment_id || "no-asg"}:${first.response_id ?? "no-resp"}`
      : null
    setOpenEngagementAssignmentId(rowKey)
  }, [selectedId, engagementsForAgency])

  const loadRateForSelection = useCallback(
    async (partnershipId: string | null) => {
      if (!partnershipId) {
        setRateInfo(emptyRate())
        return
      }
      if (isDemo) {
        setBio("")
        setLocation("")
        setWebsite("")
        setRateInfo({ ...emptyRate(), ...(demoRates[partnershipId] || {}) })
        setRateError(null)
        setLoadingRate(false)
        return
      }
      setLoadingRate(true)
      setRateError(null)
      try {
        const res = await fetch(
          `/api/partner/rate-info?partnershipId=${encodeURIComponent(partnershipId)}`,
          { credentials: "same-origin" }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setRateError((data as { error?: string }).error || "Failed to load rate information")
          setRateInfo(emptyRate())
          return
        }
        const d = data as {
          bio?: string
          location?: string
          website?: string
          rate_info?: Partial<RateInfoPayload>
        }
        setBio(d.bio ?? "")
        setLocation(d.location ?? "")
        setWebsite(d.website ?? "")
        const ri = d.rate_info || {}
        setRateInfo({
          hourly_rate: String(ri.hourly_rate ?? ""),
          project_minimum: String(ri.project_minimum ?? ""),
          payment_terms: String(ri.payment_terms ?? "net_30"),
          payment_terms_custom: String(ri.payment_terms_custom ?? ""),
          notes: String(ri.notes ?? ""),
        })
      } catch {
        setRateError("Failed to load rate information")
        setRateInfo(emptyRate())
      } finally {
        setLoadingRate(false)
      }
    },
    [isDemo, demoRates]
  )

  useEffect(() => {
    void loadRateForSelection(selectedId)
  }, [selectedId, loadRateForSelection])

  const loadingShell = loadingPartnerships || loadingPayments || loadingEngagements

  const saveRateInfo = async () => {
    if (!selectedId) return
    setSavingRate(true)
    setSaveSuccess(false)
    setRateError(null)
    try {
      if (isDemo) {
        await new Promise((r) => setTimeout(r, 400))
        setDemoRates((prev) => ({
          ...prev,
          [selectedId]: { ...rateInfo },
        }))
        setSaveSuccess(true)
        window.setTimeout(() => setSaveSuccess(false), 4000)
        return
      }
      const res = await fetch("/api/partner/rate-info", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnership_id: selectedId,
          bio,
          location,
          website,
          rate_info: {
            hourly_rate: rateInfo.hourly_rate,
            project_minimum: rateInfo.project_minimum,
            payment_terms: rateInfo.payment_terms,
            payment_terms_custom: rateInfo.payment_terms_custom,
            notes: rateInfo.notes,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRateError((data as { error?: string }).error || "Save failed")
        return
      }
      if ((data as { success?: boolean }).success) {
        setSaveSuccess(true)
        window.setTimeout(() => setSaveSuccess(false), 4000)
      }
    } catch {
      setRateError("Save failed")
    } finally {
      setSavingRate(false)
    }
  }

  return (
    <PartnerLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="font-display font-bold text-3xl text-[#0C3535]">Payment Setup</h1>
          <p className="text-gray-600 mt-1">
            View payment schedules from your lead agencies and save rate details for each relationship.
          </p>
        </div>

        {/* Top: Lead agency dropdown */}
        <div className="space-y-3">
          <p className="font-mono text-[10px] text-gray-500 uppercase tracking-wider">Lead agency</p>
          {loadingShell ? (
            <div className="h-9 w-48 max-w-full bg-gray-100 rounded-lg animate-pulse" />
          ) : partnershipsError ? (
            <div className="text-sm text-red-600">{partnershipsError}</div>
          ) : activePartnerships.length === 0 ? (
            <div className="text-sm text-gray-600 rounded-xl border border-gray-200 bg-white px-4 py-3">
              No active partnerships yet. Accept an invitation to see payment schedules and rate fields here.
            </div>
          ) : (
            <div className="relative max-w-md" ref={agencyDropdownRef}>
              <button
                type="button"
                onClick={() => setAgencyDropdownOpen((o) => !o)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors min-w-[200px] w-full max-w-sm",
                  selectedPartnershipRow
                    ? "bg-[#0C3535] border-[#0C3535] text-white"
                    : "bg-[#0C3535]/10 border-[#0C3535]/30 text-[#0C3535] hover:bg-[#0C3535]/20"
                )}
              >
                <Building2 className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-medium truncate flex-1 text-left">
                  {selectedPartnershipRow ? agencyLabel(selectedPartnershipRow) : "Select lead agency"}
                </span>
                <ChevronDown
                  className={cn("w-4 h-4 flex-shrink-0 transition-transform", agencyDropdownOpen && "rotate-180")}
                />
              </button>

              {agencyDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-full min-w-[250px] bg-white border border-gray-200 rounded-lg shadow-xl z-50 overflow-hidden">
                  {activePartnerships.map((p) => {
                    const label = agencyLabel(p)
                    const isSelected = p.id === selectedId
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(p.id)
                          setAgencyDropdownOpen(false)
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                          isSelected ? "bg-[#0C3535]/10 text-[#0C3535]" : "hover:bg-gray-50 text-gray-700"
                        )}
                      >
                        <div className="w-8 h-8 rounded-full bg-[#0C3535]/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-[#0C3535]">{agencyInitials(label)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{label}</div>
                          <div className="text-xs text-gray-500 truncate">Payment schedule and rate card</div>
                        </div>
                        {isSelected ? <Check className="w-4 h-4 text-[#0C3535] flex-shrink-0" /> : null}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {paymentsError ? <div className="text-sm text-amber-700">{paymentsError}</div> : null}
          {engagementsError ? <div className="text-sm text-amber-700">{engagementsError}</div> : null}
        </div>

        {/* Middle: Active engagements accordion */}
        <div className="space-y-4">
          <h2 className="font-display font-bold text-lg text-[#0C3535]">Active engagements</h2>
          {!selectedId ? (
            <p className="text-sm text-gray-500">Select a lead agency to see awarded engagements.</p>
          ) : loadingShell ? (
            <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ) : engagementsForAgency.length === 0 ? (
            <div className="text-sm text-gray-600 rounded-xl border border-gray-200 bg-white px-4 py-4">
              No awarded engagements with this agency yet.
            </div>
          ) : (
            <div className="space-y-2">
              {engagementsForAgency.map((eng) => {
                const ms = milestonesForEngagement(allMilestones, eng)
                const rowKey = `${eng.assignment_id || "no-asg"}:${eng.response_id ?? "no-resp"}`
                const isOpen = openEngagementAssignmentId === rowKey
                return (
                  <Collapsible
                    key={rowKey}
                    open={isOpen}
                    onOpenChange={(open) => setOpenEngagementAssignmentId(open ? rowKey : null)}
                    className="rounded-xl border border-gray-200 bg-white overflow-hidden"
                  >
                    <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50/80 transition-colors">
                      <ChevronDown
                        className={cn("w-4 h-4 text-gray-500 shrink-0 transition-transform", isOpen && "rotate-180")}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-bold text-sm text-[#0C3535] truncate">
                          {eng.project_name}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{eng.client_name || "Client TBD"}</div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t border-gray-100 px-4 pb-4 pt-2">
                        {ms.length === 0 ? (
                          <p className="text-sm text-gray-600 py-2">No payment schedule set up yet.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-gray-200">
                                  <th className="text-left font-mono text-[10px] text-gray-500 uppercase tracking-wider py-2 pr-2">
                                    Title
                                  </th>
                                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-2">
                                    Amount
                                  </th>
                                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-2">
                                    Due date
                                  </th>
                                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-2">
                                    Status
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {ms.map((m) => (
                                  <tr key={m.id} className="border-b border-gray-100">
                                    <td className="py-2 pr-2">
                                      <div className="text-gray-900 font-medium">{m.title}</div>
                                      {m.scope_item_name ? (
                                        <div className="text-xs text-gray-500">{m.scope_item_name}</div>
                                      ) : null}
                                    </td>
                                    <td className="py-2 text-right font-mono text-[#0C3535]">
                                      {formatMoney(m.amount, m.currency)}
                                    </td>
                                    <td className="py-2 text-right font-mono text-xs text-gray-500">
                                      {formatDueDate(m.due_date)}
                                    </td>
                                    <td className="py-2 text-right">
                                      <span
                                        className={cn(
                                          "font-mono text-[10px] px-2 py-0.5 rounded-full capitalize inline-block",
                                          statusBadgeClass(m.status)
                                        )}
                                      >
                                        {m.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          )}
        </div>

        {/* Bottom: Rate information */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535]">Rate information</h2>
          {!selectedId ? (
            <p className="text-sm text-gray-500">Select a lead agency to view and edit rates for that relationship.</p>
          ) : loadingRate ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : rateError ? (
            <div className="text-sm text-red-600">{rateError}</div>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Rates below are stored for{" "}
                <span className="font-medium text-[#0C3535]">
                  {selectedPartnershipRow ? agencyLabel(selectedPartnershipRow) : "this agency"}
                </span>{" "}
                only.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Hourly rate
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <Input
                      value={rateInfo.hourly_rate}
                      onChange={(e) => setRateInfo((prev) => ({ ...prev, hourly_rate: e.target.value }))}
                      className="border-gray-200 pl-7 text-gray-900 placeholder:text-gray-500"
                      placeholder="e.g. 250"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">For reference with this agency</p>
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Project minimum
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <Input
                      value={rateInfo.project_minimum}
                      onChange={(e) => setRateInfo((prev) => ({ ...prev, project_minimum: e.target.value }))}
                      className="border-gray-200 pl-7 text-gray-900 placeholder:text-gray-500"
                      placeholder="e.g. 5000"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Preferred payment terms
                  </label>
                  <select
                    value={rateInfo.payment_terms}
                    onChange={(e) => setRateInfo((prev) => ({ ...prev, payment_terms: e.target.value }))}
                    className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
                  >
                    <option value="net_15">Net 15</option>
                    <option value="net_30">Net 30</option>
                    <option value="net_45">Net 45</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              {rateInfo.payment_terms === "custom" ? (
                <div>
                  <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Custom terms
                  </label>
                  <Input
                    value={rateInfo.payment_terms_custom}
                    onChange={(e) => setRateInfo((prev) => ({ ...prev, payment_terms_custom: e.target.value }))}
                    className="border-gray-200 text-gray-900"
                    placeholder="Describe your terms"
                  />
                </div>
              ) : null}

              <div>
                <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">Notes</label>
                <Textarea
                  value={rateInfo.notes}
                  onChange={(e) => setRateInfo((prev) => ({ ...prev, notes: e.target.value }))}
                  className="border-gray-200 text-gray-900 min-h-[100px]"
                  placeholder="Optional context for your rates or billing preferences"
                />
              </div>

              {saveSuccess ? (
                <p className="text-sm text-green-700" role="status">
                  Rate information saved for this agency.
                </p>
              ) : null}

              <div className="flex justify-end">
                <Button
                  type="button"
                  className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white"
                  disabled={savingRate}
                  onClick={() => void saveRateInfo()}
                >
                  {savingRate ? "Saving…" : "Save rate info"}
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-2">Banking details</h2>
          <p className="text-sm text-gray-600">
            Banking details are managed securely via your payment provider. We do not collect account or routing numbers
            on this page.
          </p>
        </div>
      </div>
    </PartnerLayout>
  )
}
