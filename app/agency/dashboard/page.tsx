"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AgencyLayout } from "@/components/agency-layout"
import { useSelectedProject } from "@/contexts/selected-project-context"
import { cn } from "@/lib/utils"
import { isDemoMode, demoMasterProjects } from "@/lib/demo-data"
import { usePaidUser } from "@/contexts/paid-user-context"
import { EmptyState } from "@/components/empty-state"
import { mapDbProjectToMaster } from "@/lib/project-mapper"
import { budgetStatusLabel, workflowStatusLabel } from "@/lib/partner-status"
import { useFetch } from "@/hooks/useFetch"
import {
  Search,
  Filter,
  AlertTriangle,
  DollarSign,
  Calendar,
  MoreVertical,
  FolderOpen,
  Building2,
  Layers,
  Activity,
  Banknote,
  Clock,
  ArrowUpRight,
  Plus,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type ProjectStatus = "active" | "onboarding" | "completed" | "on_hold"

type AlertType = "utilization" | "payment" | "deadline" | "scope" | "partner"

type ProjectAlert = {
  id: string
  type: AlertType
  severity: "warning" | "critical"
  title: string
  description: string
  section: string
  actionUrl: string
  createdAt: string
}

type DashboardWorkflowStageKey =
  | "active_engagements"
  | "bid_management"
  | "rfp_broadcast"
  | "setup"

type MasterProject = {
  id: string
  name: string
  client: string
  clientLogo?: string
  status: ProjectStatus
  budget: number
  spent: number
  startDate: string
  endDate: string
  partnerCount: number
  activeRfps: number
  pendingBids: number
  alerts: ProjectAlert[]
  progress: number
  lastActivity: string
  stage: string
  workflowStageKey: DashboardWorkflowStageKey
  workflowStageLabel: string
  partnerStatusAlertCount?: number
  partnerStatusAlertPreview?: {
    status: string
    budget_status: string
    completion_pct: number
    notes_preview: string | null
    created_at: string
  } | null
}

// Demo projects are now only loaded from demo-data.ts when in demo mode
// Production uses real projects from the database

const workflowStageConfig: Record<
  DashboardWorkflowStageKey,
  { label: string; color: string; bg: string }
> = {
  active_engagements: {
    label: "Active Engagements",
    color: "text-emerald-300",
    bg: "bg-emerald-500/15 border-emerald-500/35",
  },
  bid_management: {
    label: "Bid Management",
    color: "text-violet-300",
    bg: "bg-violet-500/15 border-violet-500/35",
  },
  rfp_broadcast: {
    label: "RFP Broadcast",
    color: "text-sky-300",
    bg: "bg-sky-500/15 border-sky-500/35",
  },
  setup: {
    label: "Setup",
    color: "text-slate-300",
    bg: "bg-slate-500/15 border-slate-500/35",
  },
}

function formatBudget(amount: number): string {
  if (amount >= 1000000) {
    return "$" + (amount / 1000000).toFixed(1) + "M"
  }
  return "$" + (amount / 1000).toFixed(0) + "K"
}

function formatUsdWhole(amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `$${Math.round(amount).toLocaleString()}`
  }
}

function DashboardContent() {
  const router = useRouter()
  const { refreshProjects, addProject, setSelectedProject, projects: contextProjects, isLoadingProjects } =
    useSelectedProject()
  const { checkFeatureAccess } = usePaidUser()
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all")
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false)
  const [newProject, setNewProject] = useState({
    name: "",
    client: "",
    budget: "",
    startDate: "",
    endDate: "",
    description: ""
  })
  const [createProjectError, setCreateProjectError] = useState<string | null>(null)
  const [createProjectWarning, setCreateProjectWarning] = useState<string | null>(null)
  const [partnerAlertAggregate, setPartnerAlertAggregate] = useState(0)
  const [agencyDashboardStats, setAgencyDashboardStats] = useState<{
    total_unique_clients: number
    total_active_engagements: number
    total_awarded_engagements: number
    total_client_budget: number | null
    total_partner_spend_usd: number
  } | null>(null)
  
  const isDemo = isDemoMode()
  const { data: projectsDataResponse, isLoading } = useFetch(isDemo ? "" : "/api/projects")
  const projectsMetaById = useMemo(() => {
    if (isDemo || !projectsDataResponse) return {} as Record<string, Record<string, unknown>>
    const data = projectsDataResponse as { projects?: Record<string, unknown>[] }
    const rawList = (data.projects || []) as Record<string, unknown>[]
    const byId: Record<string, Record<string, unknown>> = {}
    for (const row of rawList) {
      const id = String(row.id || "")
      if (!id) continue
      byId[id] = row
    }
    return byId
  }, [isDemo, projectsDataResponse])

  useEffect(() => {
    if (isDemo) return
    if (!projectsDataResponse) return
    try {
      const data = projectsDataResponse as {
        projects?: Record<string, unknown>[]
        partner_status_alert_total?: unknown
        agency_dashboard_stats?: {
          total_unique_clients?: unknown
          total_active_engagements?: unknown
          total_awarded_engagements?: unknown
          total_client_budget?: unknown
          total_partner_spend_usd?: unknown
        }
      }
        const rawList = (data.projects || []) as Record<string, unknown>[]
        if (rawList.length > 0) {
          console.log('[dashboard] raw /api/projects first row keys', Object.keys(rawList[0]))
          console.log('[dashboard] raw /api/projects first row alert fields', {
            partner_status_alert_count: rawList[0].partner_status_alert_count,
            partnerStatusAlertCount: rawList[0].partnerStatusAlertCount,
            partner_status_alert_preview: rawList[0].partner_status_alert_preview,
          })
        }
        const mapped = rawList.map((p) => {
          const rawAlert = p.partner_status_alert_count ?? p.partnerStatusAlertCount
          const partnerAlertNum =
            typeof rawAlert === "number" && Number.isFinite(rawAlert)
              ? rawAlert
              : Number.parseInt(String(rawAlert ?? ""), 10)
          return {
            partnerStatusAlertCount: Number.isFinite(partnerAlertNum) ? partnerAlertNum : 0,
          }
        })
        const summed = mapped.reduce(
          (acc: number, pr: { partnerStatusAlertCount: number }) => acc + (pr.partnerStatusAlertCount || 0),
          0
        )
        const fromApi = Number((data as { partner_status_alert_total?: unknown }).partner_status_alert_total)
        setPartnerAlertAggregate(Number.isFinite(fromApi) ? fromApi : summed)
        const ads = (
          data as {
            agency_dashboard_stats?: {
              total_unique_clients?: unknown
              total_active_engagements?: unknown
              total_awarded_engagements?: unknown
              total_client_budget?: unknown
              total_partner_spend_usd?: unknown
            }
          }
        ).agency_dashboard_stats
        setAgencyDashboardStats(
          ads && typeof ads === "object"
            ? {
                total_unique_clients: Number(ads.total_unique_clients) || 0,
                total_active_engagements: Number(ads.total_active_engagements) || 0,
                total_awarded_engagements: Number(ads.total_awarded_engagements) || 0,
                total_client_budget:
                  ads.total_client_budget == null
                    ? null
                    : (() => {
                        const n = Number(ads.total_client_budget)
                        return Number.isFinite(n) ? n : null
                      })(),
                total_partner_spend_usd: Number(ads.total_partner_spend_usd) || 0,
              }
            : null
        )
    } catch (error) {
      console.error('Error fetching projects:', error)
      setAgencyDashboardStats(null)
    }
  }, [isDemo, projectsDataResponse])
  
  // Use demo data or context projects (single source of truth) merged with API-only dashboard metadata.
  const projects = isDemo
    ? demoMasterProjects
    : contextProjects.map((project) => {
        const row = projectsMetaById[project.id] || {}
        const assignments = Array.isArray(row.project_assignments)
          ? (row.project_assignments as { status?: string }[])
          : []
        const pendingBids = assignments.filter((a) => a.status === "invited" || a.status === "accepted").length
        const wfKey = (row.dashboard_workflow_stage || "setup") as DashboardWorkflowStageKey
        const wfLabel = String(row.dashboard_workflow_label || workflowStageConfig[wfKey]?.label || "Setup")
        const rawAlert = row.partner_status_alert_count ?? row.partnerStatusAlertCount
        const partnerAlertNum =
          typeof rawAlert === "number" && Number.isFinite(rawAlert)
            ? rawAlert
            : Number.parseInt(String(rawAlert ?? ""), 10)
        const partnerStatusAlertCount = Number.isFinite(partnerAlertNum) ? partnerAlertNum : 0
        return {
          id: project.id,
          name: project.name,
          client: project.client,
          status: project.status,
          budget: 0,
          spent: 0,
          startDate: row.start_date
            ? new Date(String(row.start_date)).toLocaleDateString("en-US", { month: "short", year: "numeric" })
            : "TBD",
          endDate: row.end_date
            ? new Date(String(row.end_date)).toLocaleDateString("en-US", { month: "short", year: "numeric" })
            : "TBD",
          partnerCount: assignments.length,
          activeRfps: String(row.status || "").toLowerCase() === "open" ? 1 : 0,
          pendingBids,
          alerts:
            partnerStatusAlertCount > 0
              ? (Array.from({ length: partnerStatusAlertCount }, () => ({})) as ProjectAlert[])
              : [],
          progress: 0,
          lastActivity: "Recently",
          stage: project.status === "active" ? "Production" : project.status === "completed" ? "Closed" : "Setup",
          workflowStageKey: wfKey in workflowStageConfig ? wfKey : "setup",
          workflowStageLabel: wfLabel,
          partnerStatusAlertCount,
          partnerStatusAlertPreview: (row.partner_status_alert_preview as MasterProject["partnerStatusAlertPreview"]) ?? null,
        } satisfies MasterProject
      })
  
  const filteredProjects = projects.filter(project => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          project.client.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === "all" || project.status === statusFilter
    return matchesSearch && matchesStatus
  })
  
  const partnerAlertsForStat = isDemo
    ? projects.reduce((sum, p) => sum + (p.partnerStatusAlertCount ?? 0), 0)
    : partnerAlertAggregate
  const totalAlerts =
    projects.reduce((sum, p) => sum + p.alerts.length, 0) +
    (isDemo ? partnerAlertsForStat : 0)

  const demoDashboardStats = isDemo
    ? {
        total_unique_clients: new Set(projects.map((p) => p.client.trim()).filter(Boolean)).size,
        total_active_engagements: projects
          .filter((p) => p.workflowStageKey === "active_engagements")
          .reduce((s, p) => s + p.partnerCount, 0),
        total_awarded_engagements: projects.reduce((s, p) => s + p.partnerCount, 0),
        total_client_budget: projects.reduce((s, p) => s + p.budget, 0),
        total_partner_spend_usd: projects.reduce((s, p) => s + p.spent, 0),
      }
    : null

  const dashStats = isDemo
    ? demoDashboardStats!
    : agencyDashboardStats ?? {
        total_unique_clients: 0,
        total_active_engagements: 0,
        total_awarded_engagements: 0,
        total_client_budget: null as number | null,
        total_partner_spend_usd: 0,
      }

  const handleCreateProject = async () => {
    if (!checkFeatureAccess("project creation")) return
    setCreateProjectError(null)
    setCreateProjectWarning(null)

    if (isDemo) {
      const createdProject = addProject({
        name: newProject.name,
        client: newProject.client,
        status: "onboarding",
      })
      setSelectedProject(createdProject)
      setIsNewProjectOpen(false)
      setNewProject({
        name: "",
        client: "",
        budget: "",
        startDate: "",
        endDate: "",
        description: "",
      })
      router.push("/agency")
      return
    }

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProject.name,
          clientName: newProject.client,
          description: newProject.description || undefined,
          budgetRange: newProject.budget || undefined,
          startDate: newProject.startDate || undefined,
          endDate: newProject.endDate || undefined,
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        const statusHint = res.status ? ` (HTTP ${res.status})` : ""
        setCreateProjectError((payload?.error || "Project creation failed. Please try again.") + statusHint)
        return
      }
      const payload = await res.json()
      const project = payload.project
      if (payload?.warning) {
        setCreateProjectWarning(String(payload.warning))
      }
      await refreshProjects()
      setSelectedProject(mapDbProjectToMaster(project))
      setIsNewProjectOpen(false)
      setNewProject({
        name: "",
        client: "",
        budget: "",
        startDate: "",
        endDate: "",
        description: "",
      })
      router.push("/agency")
    } catch {
      setCreateProjectError("Project creation failed. Please try again.")
    }
  }
  
  // Show empty state for production users with no projects (after loading)
  if (!isDemo && !isLoadingProjects && !isLoading && projects.length === 0) {
    return (
      <div className="p-8 max-w-7xl">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="font-display font-black text-4xl text-foreground tracking-tight">
              Project Dashboard
            </h1>
            <p className="text-foreground-muted mt-2">
              Manage all your master projects and dive into individual workflows
            </p>
          </div>
          <Dialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen}>
            <DialogTrigger asChild>
              <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
                <Plus className="w-4 h-4 mr-2" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">Create New Project</DialogTitle>
                <DialogDescription className="text-foreground-muted">
                  Start a new master project to begin vendor coordination.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-foreground">Project Name</Label>
                  <Input
                    id="name"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    placeholder="e.g., Q2 Brand Campaign"
                    className="bg-white/5 border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client" className="text-foreground">Client</Label>
                  <Input
                    id="client"
                    value={newProject.client}
                    onChange={(e) => setNewProject({ ...newProject, client: e.target.value })}
                    placeholder="Client or brand name"
                    className="bg-white/5 border-border"
                  />
                </div>
              </div>
              {createProjectError && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {createProjectError}
                </div>
              )}
              {createProjectWarning && !createProjectError && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  {createProjectWarning}
                </div>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" className="border-border">Cancel</Button>
                </DialogClose>
                <Button 
                  onClick={handleCreateProject}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                  disabled={!newProject.name || !newProject.client}
                >
                  Create Project
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <EmptyState 
          type="projects" 
          onAction={() => setIsNewProjectOpen(true)}
        />
      </div>
    )
  }
  
  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display font-black text-4xl text-foreground tracking-tight">
            Project Dashboard
          </h1>
          <p className="text-foreground-muted mt-2">
            Manage all your master projects and dive into individual workflows
          </p>
        </div>
        <Dialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen}>
          <DialogTrigger asChild>
            <Button className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono">
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] bg-background border-border">
            <DialogHeader>
              <DialogTitle className="font-display font-black text-2xl text-foreground">
                Create New Project
              </DialogTitle>
              <DialogDescription className="text-foreground-muted">
                Set up a new master project to begin the vendor orchestration workflow.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-6">
              <div className="grid gap-2">
                <Label htmlFor="project-name" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
                  Project Name
                </Label>
                <Input
                  id="project-name"
                  placeholder="e.g., Q3 Brand Campaign"
                  value={newProject.name}
                  onChange={(e) => setNewProject(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="client-name" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
                  Client Name
                </Label>
                <Input
                  id="client-name"
                  placeholder="Legal entity name"
                  value={newProject.client}
                  onChange={(e) => setNewProject(prev => ({ ...prev, client: e.target.value }))}
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="budget" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
                    Budget
                  </Label>
                  <Input
                    id="budget"
                    placeholder="$150,000"
                    value={newProject.budget}
                    onChange={(e) => setNewProject(prev => ({ ...prev, budget: e.target.value }))}
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="start-date" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
                    Start Date
                  </Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={newProject.startDate}
                    onChange={(e) => setNewProject(prev => ({ ...prev, startDate: e.target.value }))}
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="end-date" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
                    End Date
                  </Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={newProject.endDate}
                    onChange={(e) => setNewProject(prev => ({ ...prev, endDate: e.target.value }))}
                    className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description" className="font-mono text-xs uppercase tracking-wider text-foreground-muted">
                  Project Description
                </Label>
                <Textarea
                  id="description"
                  placeholder="Describe the project scope, objectives, and any key requirements..."
                  value={newProject.description}
                  onChange={(e) => setNewProject(prev => ({ ...prev, description: e.target.value }))}
                  className="bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50 min-h-[100px]"
                />
              </div>
            </div>
            {createProjectError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {createProjectError}
              </div>
            )}
            {createProjectWarning && !createProjectError && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {createProjectWarning}
              </div>
            )}
            <DialogFooter className="flex gap-3">
              <DialogClose asChild>
                <Button variant="outline" className="border-border text-foreground hover:bg-white/5">
                  Cancel
                </Button>
              </DialogClose>
              <Button 
                className="bg-accent text-accent-foreground hover:bg-accent/90 font-mono"
                onClick={handleCreateProject}
                disabled={!newProject.name || !newProject.client}
              >
                Create Project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <div className="glass rounded-xl p-5 text-center">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center mx-auto mb-3">
            <Building2 className="w-5 h-5 text-accent" />
          </div>
          <div className="font-display font-bold text-3xl text-foreground">{dashStats.total_unique_clients}</div>
          <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">
            Total Client Projects
          </div>
        </div>
        <div className="glass rounded-xl p-5 text-center">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
            <Activity className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="font-display font-bold text-3xl text-foreground">{dashStats.total_active_engagements}</div>
          <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">
            Total Active Engagements
          </div>
        </div>
        <div className="glass rounded-xl p-5 text-center">
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center mx-auto mb-3">
            <Layers className="w-5 h-5 text-violet-400" />
          </div>
          <div className="font-display font-bold text-3xl text-foreground">{dashStats.total_awarded_engagements}</div>
          <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">Total Engagements</div>
        </div>
        <div className="glass rounded-xl p-5 text-center">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center mx-auto mb-3">
            <DollarSign className="w-5 h-5 text-green-400" />
          </div>
          <div className="font-display font-bold text-3xl text-foreground">
            {dashStats.total_client_budget == null ? "—" : formatBudget(dashStats.total_client_budget)}
          </div>
          <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">
            Total Client Budget
          </div>
        </div>
        <div className="glass rounded-xl p-5 text-center">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
            <Banknote className="w-5 h-5 text-blue-400" />
          </div>
          <div className="font-display font-bold text-3xl text-foreground">
            {formatUsdWhole(dashStats.total_partner_spend_usd)}
          </div>
          <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">
            Total Partner Spend
          </div>
        </div>
        <div className="glass rounded-xl p-5 text-center">
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-3",
              totalAlerts > 0 ? "bg-red-500/10" : "bg-green-500/10"
            )}
          >
            <AlertTriangle className={cn("w-5 h-5", totalAlerts > 0 ? "text-red-400" : "text-green-400")} />
          </div>
          <div
            className={cn(
              "font-display font-bold text-3xl",
              totalAlerts > 0 ? "text-red-400" : "text-foreground"
            )}
          >
            {totalAlerts}
          </div>
          <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mt-1">Total Alerts</div>
        </div>
      </div>
      
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
          <Input
            placeholder="Search projects or clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white/5 border-border text-foreground placeholder:text-foreground-muted/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-foreground-muted" />
          <div className="flex gap-1">
            {(["all", "active", "onboarding", "completed", "on_hold"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "px-3 py-1.5 rounded-lg font-mono text-[10px] uppercase tracking-wider transition-colors",
                  statusFilter === status
                    ? "bg-accent text-accent-foreground"
                    : "bg-white/5 text-foreground-muted hover:bg-white/10"
                )}
              >
                {status === "all" ? "All" : status.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        {filteredProjects.map((project) => {
          const workflowCfg = workflowStageConfig[project.workflowStageKey] ?? workflowStageConfig.setup
          const budgetDisplay = formatBudget(project.budget)
          const spentDisplay = formatBudget(project.spent)
          const hasCriticalAlert = project.alerts.some(a => a.severity === "critical")
          
          return (
            <Link 
              key={project.id} 
              href="/agency/project"
              className="block glass rounded-xl p-6 hover:bg-white/10 transition-all group"
            >
              <div className="flex items-start gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-display font-bold text-xl text-foreground truncate">
                      {project.name}
                    </h3>
                    <span className={cn(
                      "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
                      workflowCfg.bg, workflowCfg.color
                    )}>
                      {project.workflowStageLabel}
                    </span>
                    {(project.partnerStatusAlertCount ?? 0) > 0 && (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setSelectedProject({
                                  id: project.id,
                                  name: project.name,
                                  client: project.client,
                                  status: project.status,
                                })
                                router.push(
                                  `/agency/project?projectId=${encodeURIComponent(project.id)}`
                                )
                              }}
                              className="flex items-center gap-1 font-mono text-[9px] px-2.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 transition-colors shrink-0"
                            >
                              <AlertTriangle className="w-3 h-3 text-amber-300" />
                              {project.partnerStatusAlertCount} Alert
                              {(project.partnerStatusAlertCount ?? 0) > 1 ? "s" : ""}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            align="start"
                            className="max-w-sm p-3 bg-background border border-border text-left"
                          >
                            {project.partnerStatusAlertPreview ? (
                              <div className="space-y-1.5 text-xs">
                                <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                                  Partner status
                                </div>
                                <div className="text-foreground">
                                  <span className="font-medium">
                                    {workflowStatusLabel(project.partnerStatusAlertPreview.status)}
                                  </span>
                                  <span className="text-foreground-muted"> · </span>
                                  <span>
                                    {budgetStatusLabel(project.partnerStatusAlertPreview.budget_status)}
                                  </span>
                                </div>
                                <div className="text-foreground-muted">
                                  Completion: {project.partnerStatusAlertPreview.completion_pct}%
                                </div>
                                {project.partnerStatusAlertPreview.notes_preview && (
                                  <p className="text-foreground-muted leading-snug line-clamp-3">
                                    {project.partnerStatusAlertPreview.notes_preview}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-foreground-muted">
                                {project.partnerStatusAlertCount} unresolved partner update
                                {(project.partnerStatusAlertCount ?? 0) > 1 ? "s" : ""}
                              </span>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {project.alerts.length > 0 && (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                "flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full border hover:scale-105 transition-transform cursor-pointer",
                                hasCriticalAlert
                                  ? "bg-red-500/20 text-red-400 border-red-500/50"
                                  : "bg-yellow-500/20 text-yellow-400 border-yellow-500/50"
                              )}
                            >
                              <AlertTriangle className="w-3 h-3" />
                              {project.alerts.length} Alert{project.alerts.length > 1 ? "s" : ""}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent 
                            side="bottom" 
                            align="start"
                            className="max-w-md p-0 bg-background border border-border shadow-xl"
                          >
                            <div className="p-3 border-b border-border">
                              <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider mb-1">
                                {project.alerts.length} Active Alert{project.alerts.length > 1 ? "s" : ""}
                              </div>
                              <div className="font-display font-bold text-sm text-foreground">
                                {project.name}
                              </div>
                            </div>
                            <div className="max-h-[300px] overflow-y-auto">
                              {project.alerts.map((alert, idx) => (
                                <Link
                                  key={alert.id}
                                  href={`${alert.actionUrl}?alert=${alert.id}&project=${project.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className={cn(
                                    "block p-3 hover:bg-white/5 transition-colors",
                                    idx < project.alerts.length - 1 && "border-b border-border/50"
                                  )}
                                >
                                  <div className="flex items-start gap-3">
                                    <div className={cn(
                                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                                      alert.severity === "critical" ? "bg-red-500/20" : "bg-yellow-500/20"
                                    )}>
                                      <AlertTriangle className={cn(
                                        "w-3 h-3",
                                        alert.severity === "critical" ? "text-red-400" : "text-yellow-400"
                                      )} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="font-display font-bold text-xs text-foreground mb-1 line-clamp-1">
                                        {alert.title}
                                      </div>
                                      <p className="text-[11px] text-foreground-muted leading-relaxed line-clamp-2 mb-2">
                                        {alert.description}
                                      </p>
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                          <span className={cn(
                                            "font-mono text-[9px] px-1.5 py-0.5 rounded uppercase",
                                            alert.severity === "critical"
                                              ? "bg-red-500/20 text-red-400"
                                              : "bg-yellow-500/20 text-yellow-400"
                                          )}>
                                            {alert.severity}
                                          </span>
                                          <span className="font-mono text-[9px] text-foreground-muted/60">
                                            {alert.section}
                                          </span>
                                        </div>
                                        <span className="font-mono text-[9px] text-accent flex items-center gap-1">
                                          View <ArrowUpRight className="w-2.5 h-2.5" />
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </Link>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-foreground-muted mb-4">
                    <span>{project.client}</span>
                    <span className="text-foreground-muted/50">|</span>
                    <span>{project.startDate} - {project.endDate}</span>
                    <span className="text-foreground-muted/50">|</span>
                    <span className="text-foreground-muted/60">Stage: {project.stage}</span>
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">
                        Progress
                      </span>
                      <span className="font-mono text-xs text-accent">{project.progress}%</span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all",
                          project.status === "completed" ? "bg-green-500" :
                          project.status === "on_hold" ? "bg-yellow-500" :
                          "bg-accent"
                        )}
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    <div>
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Budget</div>
                      <div className="font-display font-bold text-lg text-foreground">{budgetDisplay}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Spent</div>
                      <div className="font-display font-bold text-lg text-foreground">{spentDisplay}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Partners</div>
                      <div className="font-display font-bold text-lg text-foreground">{project.partnerCount}</div>
                    </div>
                    {project.activeRfps > 0 && (
                      <div>
                        <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Open RFPs</div>
                        <div className="font-display font-bold text-lg text-accent">{project.activeRfps}</div>
                      </div>
                    )}
                    {project.pendingBids > 0 && (
                      <div>
                        <div className="font-mono text-[10px] text-foreground-muted uppercase tracking-wider">Pending Bids</div>
                        <div className="font-display font-bold text-lg text-blue-400">{project.pendingBids}</div>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-white/5 group-hover:bg-accent/20 transition-colors shrink-0">
                  <ChevronRight className="w-6 h-6 text-foreground-muted group-hover:text-accent transition-colors" />
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2 text-foreground-muted">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="font-mono text-[10px]">Last activity: {project.lastActivity}</span>
                </div>
              </div>
            </Link>
          )
        })}
        
        {filteredProjects.length === 0 && (
          <div className="glass rounded-xl p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-foreground-muted" />
            </div>
            <h3 className="font-display font-bold text-lg text-foreground mb-2">No projects found</h3>
            <p className="text-foreground-muted text-sm">
              {searchQuery ? "Try adjusting your search or filters" : "Create your first project to get started"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AgencyDashboardPage() {
  return (
    <AgencyLayout>
      <DashboardContent />
    </AgencyLayout>
  )
}
