"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, Check, ChevronDown } from "lucide-react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"
import { isMilestoneOverdue, isMilestonePaid } from "@/lib/partner-payments"


// Redirect to Active Projects where payments are now managed
export function PaymentSetupRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace("/partner/projects") }, [router])
  return null
}



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
  lead_org_id: string | null
  assignment_id: string
  response_id: string | null
  scope_item_name: string | null
  awarded_at: string | null
}

type GroupedProject = {
  project_id: string
  project_name: string
  client_name: string | null
  scopes: PartnerEngagement[]
}

type PartnershipApiRow = {
  id: string
  lead_org_id: string
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
const DEMO_RESPONSE_ID_2 = "demo-resp-2"
const DEMO_PROJECT_ID = "demo-project-nwsl"

const demoEngagements: PartnerEngagement[] = [
  {
    project_id: DEMO_PROJECT_ID,
    project_name: "NWSL Creator Content Series",
    client_name: "NWSL",
    assignment_id: "demo-asg-1",
    partnership_id: "demo-p1",
    lead_org_id: "demo-agency-1",
    awarded_at: "2026-01-01T12:00:00Z",
    response_id: DEMO_RESPONSE_ID,
    scope_item_name: "Creator content",
  },
  {
    project_id: DEMO_PROJECT_ID,
    project_name: "NWSL Creator Content Series",
    client_name: "NWSL",
    assignment_id: "demo-asg-1",
    partnership_id: "demo-p1",
    lead_org_id: "demo-agency-1",
    awarded_at: "2026-01-01T12:00:00Z",
    response_id: DEMO_RESPONSE_ID_2,
    scope_item_name: "Paid media",
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
  { id: "demo-p1", lead_org_id: "demo-agency-1", status: "active", agency: { company_name: "Tandem Social" } },
  { id: "demo-p2", lead_org_id: "demo-agency-2", status: "active", agency: { company_name: "North Star Media" } },
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

function statusBadgeClass(status: string, overdue: boolean) {
  if (overdue) return "bg-destructive/15 text-destructive"
  if (isMilestonePaid(status)) return "bg-success/15 text-success"
  if (status.toLowerCase() === "invoiced") return "bg-amber-100 text-amber-800"
  return "bg-gray-100 text-vendor-muted-strong"
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

function PartnerPaymentsPageLegacy() {
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

  /** Accordion open project (project_id). */
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)
  /** "" = All projects; else project_id */
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>("")

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
            lead_org_id: p.lead_org_id != null ? String(p.lead_org_id) : null,
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

  const projectsGrouped = useMemo((): GroupedProject[] => {
    const map = new Map<string, GroupedProject>()
    for (const e of engagementsForAgency) {
      const existing = map.get(e.project_id)
      if (!existing) {
        map.set(e.project_id, {
          project_id: e.project_id,
          project_name: e.project_name,
          client_name: e.client_name,
          scopes: [e],
        })
      } else {
        existing.scopes.push(e)
        if (!existing.client_name && e.client_name) existing.client_name = e.client_name
      }
    }
    for (const g of map.values()) {
      g.scopes.sort((a, b) => (a.scope_item_name ?? "").localeCompare(b.scope_item_name ?? ""))
    }
    return [...map.values()].sort((a, b) => a.project_name.localeCompare(b.project_name))
  }, [engagementsForAgency])

  const projectFilterOptions = useMemo(() => {
    return projectsGrouped.map((g) => ({
      project_id: g.project_id,
      label: `${g.client_name?.trim() || "Client"} / ${g.project_name}`,
    }))
  }, [projectsGrouped])

  const visibleProjects = useMemo(() => {
    if (!selectedProjectFilter) return projectsGrouped
    return projectsGrouped.filter((g) => g.project_id === selectedProjectFilter)
  }, [projectsGrouped, selectedProjectFilter])

  useEffect(() => {
    setSelectedProjectFilter("")
  }, [selectedId])

  useEffect(() => {
    const ids = selectedProjectFilter
      ? projectsGrouped.filter((g) => g.project_id === selectedProjectFilter).map((g) => g.project_id)
      : projectsGrouped.map((g) => g.project_id)
    if (ids.length === 0) {
      setOpenProjectId(null)
      return
    }
    setOpenProjectId((prev) => (prev && ids.includes(prev) ? prev : ids[0]))
  }, [selectedId, selectedProjectFilter, projectsGrouped])

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
          <h1 className="font-display font-bold text-3xl text-vendor-foreground">Payment Setup</h1>
          <p className="text-vendor-muted-strong mt-1">
            View payment schedules from your lead agencies and save rate details for each relationship.
          </p>
        </div>

        {/* Top: Lead agency dropdown */}
        <div className="space-y-3">
          <p className="font-mono text-2xs text-vendor-muted uppercase tracking-wider">Lead agency</p>
          {loadingShell ? (
            <div className="h-9 w-48 max-w-full bg-gray-100 rounded-lg animate-pulse" />
          ) : partnershipsError ? (
            <div className="text-sm text-red-600">{partnershipsError}</div>
          ) : activePartnerships.length === 0 ? (
            <div className="text-sm text-vendor-muted-strong rounded-xl border border-vendor-border bg-vendor-surface px-4 py-3">
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
                    ? "bg-vendor-foreground border-vendor-foreground text-white"
                    : "bg-vendor-foreground/10 border-vendor-foreground/30 text-vendor-foreground hover:bg-vendor-foreground/20"
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
                <div className="absolute top-full left-0 mt-1 w-full min-w-[250px] bg-vendor-surface border border-vendor-border rounded-lg shadow-xl z-50 overflow-hidden">
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
                          isSelected ? "bg-vendor-foreground/10 text-vendor-foreground" : "hover:bg-vendor-background text-vendor-foreground"
                        )}
                      >
                        <div className="w-8 h-8 rounded-full bg-vendor-foreground/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-vendor-foreground">{agencyInitials(label)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{label}</div>
                          <div className="text-xs text-vendor-muted truncate">Payment schedule and rate card</div>
                        </div>
                        {isSelected ? <Check className="w-4 h-4 text-vendor-foreground flex-shrink-0" /> : null}
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

        {/* Middle: Active engagements — grouped by project */}
        <div className="space-y-4">
          <h2 className="font-display font-bold text-lg text-vendor-foreground">Active engagements</h2>
          {!selectedId ? (
            <p className="text-sm text-vendor-muted">Select a lead agency to see awarded engagements.</p>
          ) : loadingShell ? (
            <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ) : engagementsForAgency.length === 0 ? (
            <div className="text-sm text-vendor-muted-strong rounded-xl border border-vendor-border bg-vendor-surface px-4 py-4">
              No awarded engagements with this agency yet.
            </div>
          ) : (
            <>
              <div className="space-y-2 max-w-md">
                <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider">
                  Client / Project
                </label>
                <select
                  value={selectedProjectFilter}
                  onChange={(e) => setSelectedProjectFilter(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-vendor-foreground/30 bg-vendor-surface text-sm text-vendor-foreground"
                >
                  <option value="">All projects</option>
                  {projectFilterOptions.map((opt) => (
                    <option key={opt.project_id} value={opt.project_id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                {visibleProjects.length === 0 ? (
                  <div className="text-sm text-vendor-muted-strong rounded-xl border border-vendor-border bg-vendor-surface px-4 py-4">
                    No projects match this filter.
                  </div>
                ) : (
                  visibleProjects.map((group) => {
                    const isOpen = openProjectId === group.project_id
                    return (
                      <Collapsible
                        key={group.project_id}
                        open={isOpen}
                        onOpenChange={(open) => {
                          if (open) setOpenProjectId(group.project_id)
                          else if (openProjectId === group.project_id) setOpenProjectId(null)
                        }}
                        className="rounded-xl border border-vendor-border bg-vendor-surface overflow-hidden"
                      >
                        <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-vendor-background/80 transition-colors">
                          <ChevronDown
                            className={cn(
                              "w-4 h-4 text-vendor-muted shrink-0 transition-transform",
                              isOpen && "rotate-180"
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-display font-bold text-sm text-vendor-foreground truncate">
                              {group.project_name}
                            </div>
                            <div className="text-xs text-vendor-muted truncate">
                              {group.client_name || "Client TBD"}
                            </div>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="border-t border-vendor-border/50 px-4 pb-4 pt-3 space-y-6">
                            {group.scopes.map((scope) => {
                              const ms = milestonesForEngagement(allMilestones, scope)
                              const scopeKey = `${scope.response_id ?? "no-resp"}:${scope.assignment_id}:${scope.scope_item_name ?? ""}`
                              const scopeLabel =
                                scope.scope_item_name?.trim() || (scope.response_id ? "Scope" : "Project")
                              return (
                                <div key={scopeKey} className="space-y-2">
                                  <div className="font-mono text-2xs text-vendor-muted uppercase tracking-wider">
                                    {scopeLabel}
                                  </div>
                                  {ms.length === 0 ? (
                                    <p className="text-sm text-vendor-muted-strong pl-0">No payment schedule set up yet.</p>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-sm">
                                        <thead>
                                          <tr className="border-b border-vendor-border">
                                            <th className="text-left font-mono text-2xs text-vendor-muted uppercase tracking-wider py-2 pr-2">
                                              Title
                                            </th>
                                            <th className="text-right font-mono text-2xs text-vendor-muted uppercase tracking-wider py-2">
                                              Amount
                                            </th>
                                            <th className="text-right font-mono text-2xs text-vendor-muted uppercase tracking-wider py-2">
                                              Due date
                                            </th>
                                            <th className="text-right font-mono text-2xs text-vendor-muted uppercase tracking-wider py-2">
                                              Status
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {ms.map((m) => {
                                            const overdue = isMilestoneOverdue({ amount: m.amount, status: m.status, due_date: m.due_date })
                                            return (
                                            <tr key={m.id} className="border-b border-vendor-border/50">
                                              <td className="py-2 pr-2 text-vendor-foreground font-medium">{m.title}</td>
                                              <td className="py-2 text-right font-mono text-vendor-foreground">
                                                {formatMoney(m.amount, m.currency)}
                                              </td>
                                              <td className={cn("py-2 text-right font-mono text-xs", overdue ? "text-destructive" : "text-vendor-muted")}>
                                                {formatDueDate(m.due_date)}
                                              </td>
                                              <td className="py-2 text-right">
                                                <span
                                                  className={cn(
                                                    "font-mono text-2xs px-2 py-0.5 rounded-full capitalize inline-block",
                                                    statusBadgeClass(m.status, overdue)
                                                  )}
                                                >
                                                  {overdue ? "Overdue" : m.status}
                                                </span>
                                              </td>
                                            </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Bottom: Rate information */}
        <div className="bg-vendor-surface rounded-xl border border-vendor-border p-6 space-y-6">
          <h2 className="font-display font-bold text-lg text-vendor-foreground">Rate information</h2>
          {!selectedId ? (
            <p className="text-sm text-vendor-muted">Select a lead agency to view and edit rates for that relationship.</p>
          ) : loadingRate ? (
            <div className="text-sm text-vendor-muted">Loading…</div>
          ) : rateError ? (
            <div className="text-sm text-red-600">{rateError}</div>
          ) : (
            <>
              <p className="text-sm text-vendor-muted-strong">
                Rates below are stored for{" "}
                <span className="font-medium text-vendor-foreground">
                  {selectedPartnershipRow ? agencyLabel(selectedPartnershipRow) : "this agency"}
                </span>{" "}
                only.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Hourly rate
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-vendor-muted/70">$</span>
                    <Input
                      value={rateInfo.hourly_rate}
                      onChange={(e) => setRateInfo((prev) => ({ ...prev, hourly_rate: e.target.value }))}
                      className="border-vendor-border pl-7 text-vendor-foreground placeholder:text-vendor-muted"
                      placeholder="e.g. 250"
                    />
                  </div>
                  <p className="text-xs text-vendor-muted/70 mt-1">For reference with this agency</p>
                </div>

                <div>
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Project minimum
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-vendor-muted/70">$</span>
                    <Input
                      value={rateInfo.project_minimum}
                      onChange={(e) => setRateInfo((prev) => ({ ...prev, project_minimum: e.target.value }))}
                      className="border-vendor-border pl-7 text-vendor-foreground placeholder:text-vendor-muted"
                      placeholder="e.g. 5000"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Preferred payment terms
                  </label>
                  <select
                    value={rateInfo.payment_terms}
                    onChange={(e) => setRateInfo((prev) => ({ ...prev, payment_terms: e.target.value }))}
                    className="w-full h-10 px-3 rounded-md border border-vendor-border bg-vendor-surface text-sm text-vendor-foreground"
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
                  <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">
                    Custom terms
                  </label>
                  <Input
                    value={rateInfo.payment_terms_custom}
                    onChange={(e) => setRateInfo((prev) => ({ ...prev, payment_terms_custom: e.target.value }))}
                    className="border-vendor-border text-vendor-foreground"
                    placeholder="Describe your terms"
                  />
                </div>
              ) : null}

              <div>
                <label className="block font-mono text-2xs text-vendor-muted uppercase tracking-wider mb-2">Notes</label>
                <Textarea
                  value={rateInfo.notes}
                  onChange={(e) => setRateInfo((prev) => ({ ...prev, notes: e.target.value }))}
                  className="border-vendor-border text-vendor-foreground min-h-[100px]"
                  placeholder="Optional context for your rates or billing preferences"
                />
              </div>

              {saveSuccess ? (
                <p className="text-sm text-success" role="status">
                  Rate information saved for this agency.
                </p>
              ) : null}

              <div className="flex justify-end">
                <Button
                  type="button"
                  className="bg-vendor-foreground hover:bg-vendor-foreground/90 text-white"
                  disabled={savingRate}
                  onClick={() => void saveRateInfo()}
                >
                  {savingRate ? "Saving…" : "Save rate info"}
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="bg-vendor-surface rounded-xl border border-dashed border-vendor-border p-6">
          <h2 className="font-display font-bold text-lg text-vendor-foreground mb-2">Banking details</h2>
          <p className="text-sm text-vendor-muted-strong">
            Banking details are managed securely via your payment provider. We do not collect account or routing numbers
            on this page.
          </p>
        </div>
      </div>
    </PartnerLayout>
  )
}

export default PaymentSetupRedirect
