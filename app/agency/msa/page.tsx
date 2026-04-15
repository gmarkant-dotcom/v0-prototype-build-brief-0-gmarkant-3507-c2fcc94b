"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AgencyLayout } from "@/components/agency-layout"
import { GlassCard } from "@/components/glass-card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AlertTriangle, FileText, Loader2, Plus, Sparkles } from "lucide-react"

type MsaAgreement = {
  id: string
  partnership_id: string
  partner_name: string
  status: string
  document_url: string | null
  signed_at: string | null
  created_at: string
}

type PartnershipRow = {
  id: string
  status: string
  partner?: {
    id?: string
    company_name?: string | null
    full_name?: string | null
    email?: string | null
  } | null
}

type MilestoneRow = {
  id: string
  project_id: string
  partnership_id: string | null
  response_id: string | null
  partner_name?: string | null
  title: string
  amount: number
  currency: string
  due_date: string
  status: string
  notes: string | null
  paid_at: string | null
  created_at: string
  updated_at?: string | null
}

type AwardedScope = {
  response_id: string
  project_id: string
  partnership_id: string | null
  scope_item_name: string
  estimated_budget: string | null
  partner_display_name: string
  budget_proposal?: string | null
}

type ProjectMilestoneGroup = {
  project_id: string
  project_name: string
  client_name: string | null
  client_budget: number | null
  client_budget_range?: string | null
  total_milestones_amount: number
  total_paid: number
  total_outstanding: number
  budget_alert: boolean
  milestones: MilestoneRow[]
  awarded_scopes: AwardedScope[]
  client_cash_flow: ClientCashFlowRow[]
}

type AiSuggestion = {
  title: string
  amount: number
  currency: string
  due_date: string
  notes: string
}

type ClientCashFlowRow = {
  id: string
  project_id: string
  label: string
  amount: number
  currency: string
  expected_date: string
  status: "expected" | "received"
  received_at: string | null
  created_at: string
}

type PaymentSynthesisRecommendation = {
  partner_name: string
  title: string
  amount: number
  currency: string
  due_date: string
  rationale: string
  partnership_id?: string | null
  response_id?: string | null
}

type SynthesisConflictPrompt = {
  projectId: string
  recommendations: PaymentSynthesisRecommendation[]
  conflictPartners: string[]
  decisions: Record<string, "replace" | "keep">
}

function partnerLabel(p: PartnershipRow): string {
  const pr = p.partner
  if (!pr) return "Partner"
  return (
    (pr.company_name || "").trim() ||
    (pr.full_name || "").trim() ||
    (pr.email || "").trim() ||
    "Partner"
  )
}

function formatMoney(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString("en-US")} ${currency}`
  }
}

function formatBudgetDisplay(group: ProjectMilestoneGroup): string {
  const raw = (group.client_budget_range || "").trim()
  if (raw) return raw
  if (group.client_budget != null) return formatMoney(group.client_budget, "USD")
  return "N/A"
}

function normalizeName(v: string): string {
  return v.trim().toLowerCase()
}

function msaStatusBadge(status: string) {
  const s = status.toLowerCase()
  const base = "font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border"
  if (s === "signed") return cn(base, "border-emerald-500/50 bg-emerald-500/15 text-emerald-200")
  if (s === "sent") return cn(base, "border-amber-500/50 bg-amber-500/15 text-amber-200")
  if (s === "expired") return cn(base, "border-red-500/50 bg-red-500/15 text-red-200")
  return cn(base, "border-border bg-white/5 text-foreground-muted")
}

function milestoneStatusBadge(status: string) {
  const s = status.toLowerCase()
  const base = "font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border"
  if (s === "paid") return cn(base, "border-emerald-500/50 bg-emerald-500/15 text-emerald-200")
  if (s === "invoiced") return cn(base, "border-sky-500/50 bg-sky-500/15 text-sky-200")
  return cn(base, "border-border bg-white/5 text-foreground-muted")
}

export default function AgencyMsaPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agreements, setAgreements] = useState<MsaAgreement[]>([])
  const [partnerships, setPartnerships] = useState<PartnershipRow[]>([])
  const [projectGroups, setProjectGroups] = useState<ProjectMilestoneGroup[]>([])
  const [docUrlDraft, setDocUrlDraft] = useState<Record<string, string>>({})
  const [aiPreview, setAiPreview] = useState<Record<string, AiSuggestion[] | "loading" | "error">>({})
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null)
  const [savingMsa, setSavingMsa] = useState<string | null>(null)
  const [addingMilestone, setAddingMilestone] = useState<string | null>(null)
  const [addingCashFlowProject, setAddingCashFlowProject] = useState<string | null>(null)
  const [updatingCashFlowId, setUpdatingCashFlowId] = useState<string | null>(null)
  const [editingCashFlowId, setEditingCashFlowId] = useState<string | null>(null)
  const [editingCashFlowDraft, setEditingCashFlowDraft] = useState<{
    label: string
    amount: string
    currency: string
    expected_date: string
    status: "expected" | "received"
  } | null>(null)
  const [synthesisPreview, setSynthesisPreview] = useState<
    Record<string, PaymentSynthesisRecommendation[] | "loading" | "error">
  >({})
  const [synthesisLoadingProjectId, setSynthesisLoadingProjectId] = useState<string | null>(null)
  const [savingSynthesisProjectId, setSavingSynthesisProjectId] = useState<string | null>(null)
  const [synthesisSuccessByProject, setSynthesisSuccessByProject] = useState<Record<string, string>>({})
  const [synthesisConflictPrompt, setSynthesisConflictPrompt] = useState<SynthesisConflictPrompt | null>(null)

  const loadAll = useCallback(async () => {
    setError(null)
    try {
      const [msaRes, partRes, milRes] = await Promise.all([
        fetch("/api/agency/msa", { credentials: "same-origin" }),
        fetch("/api/partnerships", { credentials: "same-origin" }),
        fetch("/api/agency/msa/milestones", { credentials: "same-origin" }),
      ])
      const msaData = await msaRes.json().catch(() => ({}))
      const partData = await partRes.json().catch(() => ({}))
      const milData = await milRes.json().catch(() => ({}))

      if (msaRes.ok) setAgreements(msaData.agreements || [])
      if (partRes.ok) setPartnerships((partData.partnerships || []) as PartnershipRow[])
      if (milRes.ok) setProjectGroups(milData.projects || [])

      const errs: string[] = []
      if (!msaRes.ok) errs.push((msaData as { error?: string }).error || "Failed to load MSA data")
      if (!partRes.ok) errs.push((partData as { error?: string }).error || "Failed to load partnerships")
      if (!milRes.ok) errs.push((milData as { error?: string }).error || "Failed to load milestones")
      if (errs.length > 0) throw new Error(errs.join(" "))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const activePartnerships = useMemo(
    () => partnerships.filter((p) => (p.status || "").toLowerCase() === "active"),
    [partnerships]
  )

  const latestAgreementByPartnership = useMemo(() => {
    const m = new Map<string, MsaAgreement>()
    const sorted = [...agreements].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    for (const a of sorted) {
      if (!m.has(a.partnership_id)) m.set(a.partnership_id, a)
    }
    return m
  }, [agreements])

  const createMsa = async (partnershipId: string) => {
    setSavingMsa(partnershipId)
    try {
      const res = await fetch("/api/agency/msa", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnership_id: partnershipId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to create")
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed")
    } finally {
      setSavingMsa(null)
    }
  }

  const patchMsa = async (id: string, patch: Record<string, unknown>) => {
    setSavingMsa(id)
    try {
      const res = await fetch("/api/agency/msa", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to update")
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed")
    } finally {
      setSavingMsa(null)
    }
  }

  const saveDocumentUrl = async (ag: MsaAgreement) => {
    const url = (docUrlDraft[ag.id] ?? ag.document_url ?? "").trim()
    await patchMsa(ag.id, { document_url: url || null })
  }

  const runAiSchedule = async (projectId: string, partnershipId: string | null, responseId: string) => {
    setAiLoadingId(responseId)
    setAiPreview((prev) => ({ ...prev, [responseId]: "loading" }))
    try {
      const res = await fetch("/api/agency/msa/ai-schedule", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          partnership_id: partnershipId || undefined,
          response_id: responseId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "AI request failed")
      setAiPreview((prev) => ({ ...prev, [responseId]: data.milestones || [] }))
    } catch {
      setAiPreview((prev) => ({ ...prev, [responseId]: "error" }))
    } finally {
      setAiLoadingId(null)
    }
  }

  const addMilestoneFromSuggestion = async (
    projectId: string,
    responseId: string | null,
    partnershipId: string | null,
    s: AiSuggestion
  ) => {
    setAddingMilestone(projectId)
    const dueDate =
      typeof s.due_date === "string" && s.due_date.length >= 10 ? s.due_date.slice(0, 10) : ""
    const payload = {
      project_id: projectId,
      title: s.title,
      amount: s.amount,
      currency: s.currency || "USD",
      due_date: dueDate,
      notes: s.notes ?? null,
      response_id: responseId,
      partnership_id: partnershipId,
    }
    try {
      if (!dueDate) {
        console.error("[agency/msa] milestone POST skipped: invalid due_date on suggestion", s)
        throw new Error("AI suggestion is missing a valid due_date")
      }
      const res = await fetch("/api/agency/msa/milestones", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[agency/msa] milestone POST failed", {
          status: res.status,
          responseBody: data,
          payload,
        })
        throw new Error(data.error || "Failed to add milestone")
      }
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed")
    } finally {
      setAddingMilestone(null)
    }
  }

  const addAllSuggestions = async (
    projectId: string,
    responseId: string,
    partnershipId: string | null,
    list: AiSuggestion[]
  ) => {
    for (const s of list) {
      await addMilestoneFromSuggestion(projectId, responseId, partnershipId, s)
    }
    setAiPreview((prev) => ({ ...prev, [responseId]: [] }))
  }

  const [newMilestone, setNewMilestone] = useState<
    Record<
      string,
      {
        title: string
        amount: string
        currency: string
        due_date: string
        response_id: string
        notes: string
      }
    >
  >({})

  const getNewMilestoneForm = (projectId: string) =>
    newMilestone[projectId] || {
      title: "",
      amount: "",
      currency: "USD",
      due_date: "",
      response_id: "",
      notes: "",
    }

  const [newCashFlow, setNewCashFlow] = useState<
    Record<
      string,
      {
        label: string
        amount: string
        currency: string
        expected_date: string
        status: "expected" | "received"
      }
    >
  >({})

  const getCashFlowForm = (projectId: string) =>
    newCashFlow[projectId] || {
      label: "",
      amount: "",
      currency: "USD",
      expected_date: "",
      status: "expected" as const,
    }

  const addClientCashFlowEntry = async (projectId: string) => {
    const f = getCashFlowForm(projectId)
    if (!f.label.trim() || !f.expected_date) {
      setError("Client cash flow label and expected date are required")
      return
    }
    setAddingCashFlowProject(projectId)
    try {
      const payload = {
        project_id: projectId,
        label: f.label.trim(),
        amount: parseFloat(f.amount) || 0,
        currency: (f.currency || "USD").toUpperCase(),
        expected_date: f.expected_date,
        status: f.status,
      }
      const res = await fetch("/api/agency/client-cash-flow", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Failed to add client cash flow entry")
      }
      setNewCashFlow((prev) => ({
        ...prev,
        [projectId]: { label: "", amount: "", currency: "USD", expected_date: "", status: "expected" },
      }))
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add client cash flow entry")
    } finally {
      setAddingCashFlowProject(null)
    }
  }

  const patchClientCashFlowStatus = async (id: string, status: "expected" | "received") => {
    setUpdatingCashFlowId(id)
    try {
      const res = await fetch("/api/agency/client-cash-flow", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Failed to update client cash flow status")
      }
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update client cash flow status")
    } finally {
      setUpdatingCashFlowId(null)
    }
  }

  const beginEditClientCashFlow = (entry: ClientCashFlowRow) => {
    setEditingCashFlowId(entry.id)
    setEditingCashFlowDraft({
      label: entry.label,
      amount: String(entry.amount),
      currency: entry.currency || "USD",
      expected_date: entry.expected_date?.slice(0, 10) || "",
      status: entry.status === "received" ? "received" : "expected",
    })
  }

  const cancelEditClientCashFlow = () => {
    setEditingCashFlowId(null)
    setEditingCashFlowDraft(null)
  }

  const saveEditClientCashFlow = async (entryId: string) => {
    if (!editingCashFlowDraft) return
    if (!editingCashFlowDraft.label.trim() || !editingCashFlowDraft.expected_date) {
      setError("Client cash flow label and expected date are required")
      return
    }
    setUpdatingCashFlowId(entryId)
    try {
      const payload = {
        id: entryId,
        label: editingCashFlowDraft.label.trim(),
        amount: parseFloat(editingCashFlowDraft.amount) || 0,
        currency: (editingCashFlowDraft.currency || "USD").toUpperCase(),
        expected_date: editingCashFlowDraft.expected_date,
        status: editingCashFlowDraft.status,
      }
      const res = await fetch("/api/agency/client-cash-flow", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Failed to update client cash flow entry")
      }
      cancelEditClientCashFlow()
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update client cash flow entry")
    } finally {
      setUpdatingCashFlowId(null)
    }
  }

  const canGenerateSynthesis = (g: ProjectMilestoneGroup) => {
    const hasMilestones = g.milestones.some((m) => !!m.partner_name || !!m.partnership_id || !!m.response_id)
    const hasAwardedBidAmount = g.awarded_scopes.some((sc) => ((sc.budget_proposal || "").trim().length > 0))
    return hasMilestones || hasAwardedBidAmount
  }

  const runPaymentSynthesis = async (projectId: string) => {
    setSynthesisLoadingProjectId(projectId)
    setSynthesisPreview((prev) => ({ ...prev, [projectId]: "loading" }))
    setSynthesisSuccessByProject((prev) => ({ ...prev, [projectId]: "" }))
    try {
      const res = await fetch("/api/agency/payment-synthesis", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to generate synthesis")
      setSynthesisPreview((prev) => ({ ...prev, [projectId]: data.recommendations || [] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate synthesis")
      setSynthesisPreview((prev) => ({ ...prev, [projectId]: "error" }))
    } finally {
      setSynthesisLoadingProjectId(null)
    }
  }

  const detectConflictPartners = (
    group: ProjectMilestoneGroup,
    recs: PaymentSynthesisRecommendation[]
  ): string[] => {
    const existingPartners = new Set(
      group.milestones
        .map((m) => (m.partner_name || "").trim())
        .filter(Boolean)
        .map(normalizeName)
    )
    const conflicts = new Set<string>()
    for (const rec of recs) {
      const partner = rec.partner_name.trim()
      if (!partner) continue
      if (existingPartners.has(normalizeName(partner))) {
        conflicts.add(partner)
      }
    }
    return Array.from(conflicts)
  }

  const beginAcceptSynthesis = (group: ProjectMilestoneGroup, recs: PaymentSynthesisRecommendation[]) => {
    const conflicts = detectConflictPartners(group, recs)
    if (conflicts.length > 0) {
      setSynthesisConflictPrompt({
        projectId: group.project_id,
        recommendations: recs,
        conflictPartners: conflicts,
        decisions: {},
      })
      return
    }
    void saveAcceptedSynthesis(group.project_id, recs, {})
  }

  const setConflictDecision = (partner: string, choice: "replace" | "keep") => {
    console.log("[agency/msa] conflict decision click", { partner, choice })
    setSynthesisConflictPrompt((prev) =>
      prev
        ? {
            ...prev,
            decisions: {
              ...prev.decisions,
              [partner]: choice,
              [normalizeName(partner)]: choice,
            },
          }
        : prev
    )
  }

  const saveAcceptedSynthesis = async (
    projectId: string,
    recs: PaymentSynthesisRecommendation[],
    decisions: Record<string, "replace" | "keep">
  ) => {
    console.log("[agency/msa] accept handler fired", {
      synthesisResults: recs,
      conflictDecisions: decisions,
    })
    setSavingSynthesisProjectId(projectId)
    try {
      const group = projectGroups.find((g) => g.project_id === projectId)
      if (!group) throw new Error("Project group not found")

      console.log("[agency/msa] conflict decision state before guard", {
        projectId,
        conflictPartners: synthesisConflictPrompt?.projectId === projectId ? synthesisConflictPrompt.conflictPartners : [],
        decisions,
      })

      const decisionsByKey = new Map(Object.entries(decisions).map(([k, v]) => [normalizeName(k), v]))
      const recsToInsert = recs.filter((rec) => {
        const key = normalizeName(rec.partner_name || "")
        if (!key || !decisionsByKey.has(key)) return true
        return decisionsByKey.get(key) !== "keep"
      })

      const replaceKeys = new Set(
        Array.from(decisionsByKey.entries())
          .filter(([, v]) => v === "replace")
          .map(([k]) => k)
      )
      const milestoneIdsToDelete = group.milestones
        .filter((m) => {
          const key = normalizeName((m.partner_name || "").trim())
          return key && replaceKeys.has(key)
        })
        .map((m) => m.id)

      console.log("[agency/msa] replace flow computed", {
        replaceKeys: Array.from(replaceKeys),
        milestoneIdsToDelete,
      })

      if (milestoneIdsToDelete.length > 0) {
        console.log("[agency/msa] deleting existing milestones", { milestoneIdsToDelete })
        const delRes = await fetch("/api/agency/msa/milestones", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: milestoneIdsToDelete }),
        })
        const delData = await delRes.json().catch(() => ({}))
        if (!delRes.ok) {
          console.error("[agency/msa] delete existing milestones failed", {
            status: delRes.status,
            responseBody: delData,
          })
          throw new Error(delData.error || "Failed to replace existing milestones")
        }
        console.log("[agency/msa] delete existing milestones complete", { deleted: delData?.deleted ?? milestoneIdsToDelete.length })
      }

      const milestonesToSave = recsToInsert
        .map((rec) => {
          const dueDate =
            typeof rec.due_date === "string" && rec.due_date.length >= 10 ? rec.due_date.slice(0, 10) : ""
          if (!dueDate) return null
          return {
            rec,
            payload: {
              project_id: projectId,
              title: rec.title,
              amount: rec.amount,
              currency: rec.currency || "USD",
              due_date: dueDate,
              notes: rec.rationale,
              response_id: rec.response_id || null,
              partnership_id: rec.partnership_id || null,
            },
          }
        })
        .filter(Boolean) as Array<{
        rec: PaymentSynthesisRecommendation
        payload: {
          project_id: projectId,
          title: string
          amount: number
          currency: string
          due_date: string
          notes: string
          response_id: string | null
          partnership_id: string | null
        }
      }>

      console.log("[agency/msa] saving milestones", { milestonesToSave })

      if (milestonesToSave.length === 0 && milestoneIdsToDelete.length === 0) {
        setSynthesisSuccessByProject((prev) => ({
          ...prev,
          [projectId]: "No changes to save. All recommendations were kept as existing milestones.",
        }))
        setSynthesisConflictPrompt(null)
        return
      }

      for (const row of milestonesToSave) {
        const res = await fetch("/api/agency/msa/milestones", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row.payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          console.error("[agency/msa] save synthesized milestone failed", {
            status: res.status,
            responseBody: data,
            payload: row.payload,
          })
          throw new Error(data.error || "Failed to save synthesized milestone")
        }
      }

      await loadAll()
      setSynthesisConflictPrompt(null)
      setSynthesisPreview((prev) => ({ ...prev, [projectId]: [] }))
      setSynthesisSuccessByProject((prev) => ({
        ...prev,
        [projectId]: "AI recommended schedule saved successfully.",
      }))
    } catch (e) {
      console.error("[agency/msa] accept handler failed", e)
      setError(e instanceof Error ? e.message : "Failed to save synthesized schedule")
    } finally {
      setSavingSynthesisProjectId(null)
    }
  }

  const submitNewMilestone = async (projectId: string, scopes: AwardedScope[]) => {
    const f = getNewMilestoneForm(projectId)
    if (!f.title.trim() || !f.due_date) {
      setError("Title and due date are required")
      return
    }
    setAddingMilestone(projectId)
    try {
      const scope =
        f.response_id && scopes.find((s) => s.response_id === f.response_id)
      const manualPayload = {
        project_id: projectId,
        title: f.title.trim(),
        amount: parseFloat(f.amount) || 0,
        currency: f.currency || "USD",
        due_date: f.due_date,
        notes: f.notes.trim() || null,
        response_id: f.response_id || null,
        partnership_id: scope?.partnership_id ?? null,
      }
      const res = await fetch("/api/agency/msa/milestones", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manualPayload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        console.error("[agency/msa] milestone POST failed (manual add)", {
          status: res.status,
          responseBody: data,
          payload: manualPayload,
        })
        throw new Error(data.error || "Failed to add")
      }
      setNewMilestone((prev) => ({
        ...prev,
        [projectId]: {
          title: "",
          amount: "",
          currency: "USD",
          due_date: "",
          response_id: "",
          notes: "",
        },
      }))
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed")
    } finally {
      setAddingMilestone(null)
    }
  }

  const patchMilestone = async (id: string, status: string) => {
    try {
      const res = await fetch("/api/agency/msa/milestones", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to update")
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed")
    }
  }

  return (
    <AgencyLayout>
      <div className="p-8 max-w-6xl mx-auto space-y-10">
        <div>
          <h1 className="font-display font-black text-3xl text-foreground tracking-tight">MSA &amp; Payments</h1>
          <p className="text-foreground-muted mt-2 text-sm max-w-2xl">
            Track master service agreements by partnership and payment milestones by project. AI can suggest a milestone
            schedule from awarded bid context.
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-foreground-muted py-12">
            <Loader2 className="w-6 h-6 animate-spin" />
            Loading…
          </div>
        )}

        {error && !loading && (
          <GlassCard className="border-red-500/30 bg-red-500/10 p-4">
            <p className="text-red-300 text-sm">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => { setError(null); loadAll() }}>
              Retry
            </Button>
          </GlassCard>
        )}

        {!loading && (
          <>
            <section className="space-y-4">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Client cash flow</h2>
              {projectGroups.length === 0 ? (
                <GlassCard className="p-8 text-center text-foreground-muted text-sm">No projects yet.</GlassCard>
              ) : (
                <Accordion type="multiple" className="space-y-3">
                  {projectGroups.map((g) => {
                    const cf = getCashFlowForm(g.project_id)
                    const totalExpected = g.client_cash_flow.reduce((sum, row) => sum + Number(row.amount || 0), 0)
                    return (
                      <AccordionItem
                        key={`client-cf-${g.project_id}`}
                        value={`client-cf-${g.project_id}`}
                        className="glass-card rounded-xl border border-border/40 px-4 data-[state=open]:border-accent/30"
                      >
                        <AccordionTrigger className="py-4 hover:no-underline text-left">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full pr-2">
                            <div>
                              <div className="font-display font-bold text-lg text-foreground">{g.project_name}</div>
                              <div className="text-xs text-foreground-muted">
                                {g.client_cash_flow.length} entries · {formatMoney(totalExpected, "USD")} total expected
                              </div>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-6 pt-0 space-y-4">
                          <p className="text-xs text-foreground-muted">
                            Add expected and received client payments to model incoming cash.
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            <input
                              className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm"
                              placeholder="Label (Deposit, Mid-project, Final)"
                              value={cf.label}
                              onChange={(e) =>
                                setNewCashFlow((prev) => ({
                                  ...prev,
                                  [g.project_id]: { ...cf, label: e.target.value },
                                }))
                              }
                            />
                            <input
                              className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm"
                              placeholder="Amount"
                              type="number"
                              value={cf.amount}
                              onChange={(e) =>
                                setNewCashFlow((prev) => ({
                                  ...prev,
                                  [g.project_id]: { ...cf, amount: e.target.value },
                                }))
                              }
                            />
                            <input
                              className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm"
                              placeholder="Currency"
                              value={cf.currency}
                              onChange={(e) =>
                                setNewCashFlow((prev) => ({
                                  ...prev,
                                  [g.project_id]: { ...cf, currency: e.target.value.toUpperCase() },
                                }))
                              }
                            />
                            <input
                              className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm"
                              type="date"
                              value={cf.expected_date}
                              onChange={(e) =>
                                setNewCashFlow((prev) => ({
                                  ...prev,
                                  [g.project_id]: { ...cf, expected_date: e.target.value },
                                }))
                              }
                            />
                            <select
                              className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-foreground"
                              value={cf.status}
                              onChange={(e) =>
                                setNewCashFlow((prev) => ({
                                  ...prev,
                                  [g.project_id]: {
                                    ...cf,
                                    status: e.target.value === "received" ? "received" : "expected",
                                  },
                                }))
                              }
                            >
                              <option value="expected">Expected</option>
                              <option value="received">Received</option>
                            </select>
                          </div>
                          <Button
                            size="sm"
                            disabled={addingCashFlowProject === g.project_id}
                            onClick={() => addClientCashFlowEntry(g.project_id)}
                          >
                            {addingCashFlowProject === g.project_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "Add client cash flow entry"
                            )}
                          </Button>

                          <div className="overflow-x-auto rounded-lg border border-border/50">
                            <table className="w-full text-sm min-w-[760px]">
                              <thead>
                                <tr className="border-b border-border/50 font-mono text-[10px] uppercase tracking-wider text-foreground-muted text-left">
                                  <th className="py-3 px-3 font-medium">Label</th>
                                  <th className="py-3 px-3 font-medium">Amount</th>
                                  <th className="py-3 px-3 font-medium">Currency</th>
                                  <th className="py-3 px-3 font-medium">Expected Date</th>
                                  <th className="py-3 px-3 font-medium">Status</th>
                                  <th className="py-3 px-3 font-medium">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.client_cash_flow.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} className="py-6 px-3 text-foreground-muted text-center text-sm">
                                      No client cash flow entries yet.
                                    </td>
                                  </tr>
                                ) : (
                                  g.client_cash_flow.map((entry) => {
                                    const isEditing = editingCashFlowId === entry.id && !!editingCashFlowDraft
                                    const isReceived = entry.status === "received"
                                    return (
                                      <tr key={entry.id} className="border-b border-border/30 last:border-0">
                                        {isEditing && editingCashFlowDraft ? (
                                          <>
                                            <td className="py-2 px-3">
                                              <input
                                                className="w-full rounded-lg border border-border bg-white/5 px-2 py-1.5 text-sm"
                                                value={editingCashFlowDraft.label}
                                                onChange={(e) =>
                                                  setEditingCashFlowDraft((prev) =>
                                                    prev ? { ...prev, label: e.target.value } : prev
                                                  )
                                                }
                                              />
                                            </td>
                                            <td className="py-2 px-3">
                                              <input
                                                className="w-full rounded-lg border border-border bg-white/5 px-2 py-1.5 text-sm"
                                                type="number"
                                                value={editingCashFlowDraft.amount}
                                                onChange={(e) =>
                                                  setEditingCashFlowDraft((prev) =>
                                                    prev ? { ...prev, amount: e.target.value } : prev
                                                  )
                                                }
                                              />
                                            </td>
                                            <td className="py-2 px-3">
                                              <input
                                                className="w-full rounded-lg border border-border bg-white/5 px-2 py-1.5 text-sm"
                                                value={editingCashFlowDraft.currency}
                                                onChange={(e) =>
                                                  setEditingCashFlowDraft((prev) =>
                                                    prev ? { ...prev, currency: e.target.value.toUpperCase() } : prev
                                                  )
                                                }
                                              />
                                            </td>
                                            <td className="py-2 px-3">
                                              <input
                                                className="w-full rounded-lg border border-border bg-white/5 px-2 py-1.5 text-sm"
                                                type="date"
                                                value={editingCashFlowDraft.expected_date}
                                                onChange={(e) =>
                                                  setEditingCashFlowDraft((prev) =>
                                                    prev ? { ...prev, expected_date: e.target.value } : prev
                                                  )
                                                }
                                              />
                                            </td>
                                            <td className="py-2 px-3">
                                              <select
                                                className="w-full rounded-lg border border-border bg-white/5 px-2 py-1.5 text-sm text-foreground"
                                                value={editingCashFlowDraft.status}
                                                onChange={(e) =>
                                                  setEditingCashFlowDraft((prev) =>
                                                    prev
                                                      ? {
                                                          ...prev,
                                                          status: e.target.value === "received" ? "received" : "expected",
                                                        }
                                                      : prev
                                                  )
                                                }
                                              >
                                                <option value="expected">Expected</option>
                                                <option value="received">Received</option>
                                              </select>
                                            </td>
                                            <td className="py-2 px-3">
                                              <div className="flex items-center gap-2">
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  disabled={updatingCashFlowId === entry.id}
                                                  onClick={() => saveEditClientCashFlow(entry.id)}
                                                >
                                                  {updatingCashFlowId === entry.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                  ) : (
                                                    "Save"
                                                  )}
                                                </Button>
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={cancelEditClientCashFlow}
                                                >
                                                  Cancel
                                                </Button>
                                              </div>
                                            </td>
                                          </>
                                        ) : (
                                          <>
                                            <td className="py-3 px-3 font-medium text-foreground">{entry.label}</td>
                                            <td className="py-3 px-3 tabular-nums">{formatMoney(entry.amount, entry.currency)}</td>
                                            <td className="py-3 px-3">{entry.currency}</td>
                                            <td className="py-3 px-3 font-mono text-xs">{entry.expected_date}</td>
                                            <td className="py-3 px-3">
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className={
                                                  isReceived
                                                    ? "border-border bg-white/5 text-foreground-muted hover:bg-white/10"
                                                    : "border-[#0C3535] bg-[#0C3535] text-white hover:bg-[#0C3535]/90 hover:text-white"
                                                }
                                                disabled={updatingCashFlowId === entry.id}
                                                onClick={() =>
                                                  patchClientCashFlowStatus(entry.id, isReceived ? "expected" : "received")
                                                }
                                              >
                                                {updatingCashFlowId === entry.id ? (
                                                  <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : isReceived ? (
                                                  "Received"
                                                ) : (
                                                  "Expected"
                                                )}
                                              </Button>
                                            </td>
                                            <td className="py-3 px-3">
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() => beginEditClientCashFlow(entry)}
                                              >
                                                Edit
                                              </Button>
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    )
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )
                  })}
                </Accordion>
              )}
            </section>

            <section className="space-y-4">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">MSA tracker</h2>
              {activePartnerships.length === 0 ? (
                <GlassCard className="p-8 text-center text-foreground-muted text-sm">
                  No active partnerships yet. Accept a partner invitation to manage MSAs here.
                </GlassCard>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activePartnerships.map((p) => {
                    const ag = latestAgreementByPartnership.get(p.id)
                    const name = partnerLabel(p)
                    return (
                      <GlassCard key={p.id} className="p-5 space-y-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-display font-bold text-lg text-foreground">{name}</div>
                            <div className="font-mono text-[10px] text-foreground-muted mt-1">Partnership</div>
                          </div>
                          {ag ? (
                            <span className={msaStatusBadge(ag.status)}>{ag.status}</span>
                          ) : (
                            <span className={msaStatusBadge("pending")}>no msa</span>
                          )}
                        </div>

                        {!ag ? (
                          <Button
                            size="sm"
                            className="w-full"
                            disabled={savingMsa === p.id}
                            onClick={() => createMsa(p.id)}
                          >
                            {savingMsa === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Start MSA record"}
                          </Button>
                        ) : (
                          <>
                            <div className="space-y-2">
                              <label className="font-mono text-[9px] uppercase text-foreground-muted">Document URL</label>
                              <div className="flex gap-2">
                                <input
                                  className="flex-1 rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-foreground"
                                  placeholder="https://…"
                                  value={docUrlDraft[ag.id] ?? ag.document_url ?? ""}
                                  onChange={(e) =>
                                    setDocUrlDraft((prev) => ({ ...prev, [ag.id]: e.target.value }))
                                  }
                                />
                                <Button size="sm" variant="secondary" disabled={savingMsa === ag.id} onClick={() => saveDocumentUrl(ag)}>
                                  Save
                                </Button>
                              </div>
                              {ag.document_url ? (
                                <a
                                  href={ag.document_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                                >
                                  <FileText className="w-3.5 h-3.5" /> Open document
                                </a>
                              ) : null}
                            </div>

                            {ag.signed_at ? (
                              <p className="font-mono text-[10px] text-foreground-muted">
                                Signed {new Date(ag.signed_at).toLocaleDateString()}
                              </p>
                            ) : null}

                            <div className="flex flex-wrap gap-2">
                              {ag.status === "pending" && (
                                <Button size="sm" variant="outline" disabled={savingMsa === ag.id} onClick={() => patchMsa(ag.id, { status: "sent" })}>
                                  Mark sent
                                </Button>
                              )}
                              {ag.status === "sent" && (
                                <Button size="sm" variant="outline" disabled={savingMsa === ag.id} onClick={() => patchMsa(ag.id, { status: "signed" })}>
                                  Mark signed
                                </Button>
                              )}
                              {ag.status !== "expired" && ag.status !== "pending" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-foreground-muted"
                                  disabled={savingMsa === ag.id}
                                  onClick={() => patchMsa(ag.id, { status: "expired" })}
                                >
                                  Mark expired
                                </Button>
                              )}
                              {ag.status === "expired" && (
                                <Button size="sm" variant="outline" disabled={savingMsa === ag.id} onClick={() => patchMsa(ag.id, { status: "pending" })}>
                                  Reset to pending
                                </Button>
                              )}
                            </div>
                          </>
                        )}
                      </GlassCard>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <h2 className="font-mono text-[10px] uppercase tracking-wider text-foreground-muted">Payment milestones</h2>
              {projectGroups.length === 0 ? (
                <GlassCard className="p-8 text-center text-foreground-muted text-sm">No projects yet.</GlassCard>
              ) : (
                <Accordion type="multiple" className="space-y-3">
                  {projectGroups.map((g) => {
                    const overage =
                      g.client_budget != null && g.budget_alert ? g.total_milestones_amount - g.client_budget : 0
                    const f = getNewMilestoneForm(g.project_id)
                    return (
                      <AccordionItem
                        key={g.project_id}
                        value={g.project_id}
                        className="glass-card rounded-xl border border-border/40 px-4 data-[state=open]:border-accent/30"
                      >
                        <AccordionTrigger className="py-4 hover:no-underline text-left">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full pr-2">
                            <div>
                              <div className="font-display font-bold text-lg text-foreground">{g.project_name}</div>
                              {g.client_name ? (
                                <div className="text-sm text-foreground-muted">{g.client_name}</div>
                              ) : null}
                              <div className="text-xs text-foreground-muted mt-1">
                                <span className="font-mono uppercase tracking-wider">Client Budget:</span>{" "}
                                <span className="text-foreground">{formatBudgetDisplay(g)}</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-3 font-mono text-[10px] text-foreground-muted">
                              <span>
                                Milestones:{" "}
                                <span className="text-foreground tabular-nums">
                                  {formatMoney(g.total_milestones_amount, "USD")}
                                </span>
                                {g.client_budget != null ? (
                                  <>
                                    {" "}
                                    / budget{" "}
                                    <span className="text-foreground tabular-nums">{formatMoney(g.client_budget, "USD")}</span>
                                  </>
                                ) : null}
                              </span>
                              <span>
                                Paid:{" "}
                                <span className="text-emerald-400 tabular-nums">{formatMoney(g.total_paid, "USD")}</span>
                              </span>
                              <span>
                                Outstanding:{" "}
                                <span className="text-accent tabular-nums">{formatMoney(g.total_outstanding, "USD")}</span>
                              </span>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="pb-6 pt-0 space-y-6">
                          {g.budget_alert && g.client_budget != null ? (
                            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 flex gap-3 items-start">
                              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-display font-bold text-sm text-red-200">
                                  Total partner payments exceed client budget
                                </p>
                                <p className="text-sm text-red-300/90 mt-1">
                                  Overage:{" "}
                                  <span className="font-mono font-bold tabular-nums">{formatMoney(overage, "USD")}</span>
                                </p>
                              </div>
                            </div>
                          ) : null}

                          <div className="space-y-3 rounded-lg border border-accent/20 bg-accent/5 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <h3 className="font-display font-bold text-sm text-foreground">
                                  AI Payment Synthesis
                                </h3>
                                <p className="text-xs text-foreground-muted">
                                  AI Recommended — Review Before Saving
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!canGenerateSynthesis(g) || synthesisLoadingProjectId === g.project_id}
                                onClick={() => runPaymentSynthesis(g.project_id)}
                              >
                                {synthesisLoadingProjectId === g.project_id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  "Generate Recommended Schedule"
                                )}
                              </Button>
                            </div>
                            {!canGenerateSynthesis(g) ? (
                              <p className="text-xs text-foreground-muted">
                                Add partner milestones or ensure an awarded bid includes budget data before generating.
                              </p>
                            ) : null}
                            {synthesisPreview[g.project_id] === "loading" ? (
                              <p className="text-xs text-foreground-muted flex items-center gap-2">
                                <Loader2 className="w-3 h-3 animate-spin" /> Building recommended schedule…
                              </p>
                            ) : null}
                            {synthesisPreview[g.project_id] === "error" ? (
                              <p className="text-xs text-red-400">Could not generate payment synthesis. Try again.</p>
                            ) : null}
                            {Array.isArray(synthesisPreview[g.project_id]) &&
                            synthesisPreview[g.project_id].length > 0 ? (
                              <div className="space-y-3">
                                <div className="overflow-x-auto rounded-lg border border-accent/30">
                                  <table className="w-full text-sm min-w-[900px]">
                                    <thead>
                                      <tr className="border-b border-border/50 font-mono text-[10px] uppercase tracking-wider text-foreground-muted text-left">
                                        <th className="py-3 px-3 font-medium">Partner</th>
                                        <th className="py-3 px-3 font-medium">Milestone Title</th>
                                        <th className="py-3 px-3 font-medium">Amount</th>
                                        <th className="py-3 px-3 font-medium">Currency</th>
                                        <th className="py-3 px-3 font-medium">Recommended Date</th>
                                        <th className="py-3 px-3 font-medium">Rationale</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {synthesisPreview[g.project_id].map((row, idx) => (
                                        <tr key={`${g.project_id}-syn-${idx}`} className="border-b border-border/30 last:border-0">
                                          <td className="py-3 px-3">{row.partner_name}</td>
                                          <td className="py-3 px-3 font-medium">{row.title}</td>
                                          <td className="py-3 px-3 tabular-nums">{formatMoney(row.amount, row.currency)}</td>
                                          <td className="py-3 px-3">{row.currency}</td>
                                          <td className="py-3 px-3 font-mono text-xs">{row.due_date?.slice(0, 10)}</td>
                                          <td className="py-3 px-3 text-xs text-foreground-muted">{row.rationale}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>

                                {synthesisConflictPrompt?.projectId === g.project_id ? (
                                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-3">
                                    <p className="text-sm text-amber-200">
                                      Existing milestones found. Choose Replace or Keep before saving.
                                    </p>
                                    <div className="space-y-2">
                                      {synthesisConflictPrompt.conflictPartners.map((partner) => {
                                        const decision =
                                          synthesisConflictPrompt.decisions[partner] ||
                                          synthesisConflictPrompt.decisions[normalizeName(partner)]
                                        return (
                                          <div
                                            key={`conflict-${g.project_id}-${partner}`}
                                            className="flex flex-wrap items-center justify-between gap-2"
                                          >
                                            <p className="text-xs text-amber-100">
                                              Existing milestones found for {partner}. Replace or keep existing?
                                            </p>
                                            <div className="flex items-center gap-2">
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="border-[#0C3535] bg-[#0C3535] text-white hover:bg-[#0C3535]/90 hover:text-white"
                                                style={{ color: "white" }}
                                                onClick={() => setConflictDecision(partner, "replace")}
                                              >
                                                Replace
                                              </Button>
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className={
                                                  decision === "keep"
                                                    ? "border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-200"
                                                    : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50"
                                                }
                                                style={{ color: "#111827" }}
                                                onClick={() => setConflictDecision(partner, "keep")}
                                              >
                                                Keep
                                              </Button>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <Button
                                        size="sm"
                                        disabled={
                                          savingSynthesisProjectId === g.project_id ||
                                          synthesisConflictPrompt.conflictPartners.some(
                                            (name) =>
                                              !(
                                                synthesisConflictPrompt.decisions[name] ||
                                                synthesisConflictPrompt.decisions[normalizeName(name)]
                                              )
                                          )
                                        }
                                        onClick={() => {
                                          console.log("[agency/msa] accept synthesis with conflict decisions", {
                                            projectId: g.project_id,
                                            decisions: synthesisConflictPrompt.decisions,
                                          })
                                          saveAcceptedSynthesis(
                                            g.project_id,
                                            synthesisConflictPrompt.recommendations,
                                            synthesisConflictPrompt.decisions
                                          )
                                        }}
                                      >
                                        {savingSynthesisProjectId === g.project_id ? (
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                          "Accept & Save Schedule"
                                        )}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setSynthesisConflictPrompt(null)}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    disabled={savingSynthesisProjectId === g.project_id}
                                    onClick={() =>
                                      beginAcceptSynthesis(
                                        g,
                                        synthesisPreview[g.project_id] as PaymentSynthesisRecommendation[]
                                      )
                                    }
                                  >
                                    {savingSynthesisProjectId === g.project_id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      "Accept & Save Schedule"
                                    )}
                                  </Button>
                                )}
                              </div>
                            ) : null}
                            {synthesisSuccessByProject[g.project_id] ? (
                              <p className="text-xs text-emerald-300">{synthesisSuccessByProject[g.project_id]}</p>
                            ) : null}
                          </div>

                          {g.awarded_scopes.length > 0 ? (
                            <div className="space-y-4">
                              <h3 className="font-mono text-[9px] uppercase tracking-wider text-foreground-muted">Awarded scopes</h3>
                              {g.awarded_scopes.map((sc) => {
                                const preview = aiPreview[sc.response_id]
                                return (
                                  <div
                                    key={sc.response_id}
                                    className="rounded-lg border border-border/50 bg-white/[0.02] p-4 space-y-3"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>
                                        <div className="font-medium text-foreground">{sc.scope_item_name}</div>
                                        <div className="text-xs text-foreground-muted">{sc.partner_display_name}</div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={aiLoadingId === sc.response_id}
                                        onClick={() =>
                                          runAiSchedule(g.project_id, sc.partnership_id, sc.response_id)
                                        }
                                      >
                                        {aiLoadingId === sc.response_id ? (
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                          <>
                                            <Sparkles className="w-3.5 h-3.5 mr-1.5" /> AI schedule
                                          </>
                                        )}
                                      </Button>
                                    </div>
                                    {preview === "loading" && (
                                      <p className="text-xs text-foreground-muted flex items-center gap-2">
                                        <Loader2 className="w-3 h-3 animate-spin" /> Generating suggestions…
                                      </p>
                                    )}
                                    {preview === "error" && (
                                      <p className="text-xs text-red-400">Could not generate suggestions. Try again.</p>
                                    )}
                                    {Array.isArray(preview) && preview.length > 0 && (
                                      <div className="space-y-3 border-t border-border/40 pt-3">
                                        <div className="flex items-center justify-between">
                                          <span className="font-mono text-[9px] uppercase text-foreground-muted">AI suggestions</span>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={!!addingMilestone}
                                            onClick={() =>
                                              addAllSuggestions(g.project_id, sc.response_id, sc.partnership_id, preview)
                                            }
                                          >
                                            Add all
                                          </Button>
                                        </div>
                                        <ul className="space-y-2">
                                          {preview.map((sug, idx) => (
                                            <li
                                              key={`${sc.response_id}-${idx}`}
                                              className="flex flex-wrap items-center justify-between gap-2 text-sm rounded-md bg-white/5 px-3 py-2"
                                            >
                                              <div>
                                                <div className="font-medium text-foreground">{sug.title}</div>
                                                <div className="text-xs text-foreground-muted">
                                                  {formatMoney(sug.amount, sug.currency)} · {sug.due_date.slice(0, 10)} —{" "}
                                                  {sug.notes}
                                                </div>
                                              </div>
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={!!addingMilestone}
                                                onClick={() =>
                                                  addMilestoneFromSuggestion(
                                                    g.project_id,
                                                    sc.response_id,
                                                    sc.partnership_id,
                                                    sug
                                                  )
                                                }
                                              >
                                                <Plus className="w-4 h-4" />
                                              </Button>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}

                          <div className="space-y-2">
                            <h3 className="font-mono text-[9px] uppercase tracking-wider text-foreground-muted">Add milestone</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                              <input
                                className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm"
                                placeholder="Title"
                                value={f.title}
                                onChange={(e) =>
                                  setNewMilestone((prev) => ({
                                    ...prev,
                                    [g.project_id]: { ...f, title: e.target.value },
                                  }))
                                }
                              />
                              <input
                                className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm"
                                placeholder="Amount"
                                type="number"
                                value={f.amount}
                                onChange={(e) =>
                                  setNewMilestone((prev) => ({
                                    ...prev,
                                    [g.project_id]: { ...f, amount: e.target.value },
                                  }))
                                }
                              />
                              <input
                                className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm"
                                placeholder="Currency"
                                value={f.currency}
                                onChange={(e) =>
                                  setNewMilestone((prev) => ({
                                    ...prev,
                                    [g.project_id]: { ...f, currency: e.target.value },
                                  }))
                                }
                              />
                              <input
                                className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm"
                                type="date"
                                value={f.due_date}
                                onChange={(e) =>
                                  setNewMilestone((prev) => ({
                                    ...prev,
                                    [g.project_id]: { ...f, due_date: e.target.value },
                                  }))
                                }
                              />
                              <select
                                className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-foreground"
                                value={f.response_id}
                                onChange={(e) =>
                                  setNewMilestone((prev) => ({
                                    ...prev,
                                    [g.project_id]: { ...f, response_id: e.target.value },
                                  }))
                                }
                              >
                                <option value="">Scope (optional)</option>
                                {g.awarded_scopes.map((sc) => (
                                  <option key={sc.response_id} value={sc.response_id}>
                                    {sc.scope_item_name} — {sc.partner_display_name}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm sm:col-span-2 lg:col-span-1"
                                placeholder="Notes"
                                value={f.notes}
                                onChange={(e) =>
                                  setNewMilestone((prev) => ({
                                    ...prev,
                                    [g.project_id]: { ...f, notes: e.target.value },
                                  }))
                                }
                              />
                            </div>
                            <Button
                              size="sm"
                              disabled={addingMilestone === g.project_id}
                              onClick={() => submitNewMilestone(g.project_id, g.awarded_scopes)}
                            >
                              {addingMilestone === g.project_id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add milestone"}
                            </Button>
                          </div>

                          <div className="overflow-x-auto rounded-lg border border-border/50">
                            <table className="w-full text-sm min-w-[640px]">
                              <thead>
                                <tr className="border-b border-border/50 font-mono text-[10px] uppercase tracking-wider text-foreground-muted text-left">
                                  <th className="py-3 px-3 font-medium">Partner</th>
                                  <th className="py-3 px-3 font-medium">Title</th>
                                  <th className="py-3 px-3 font-medium">Amount</th>
                                  <th className="py-3 px-3 font-medium">Due</th>
                                  <th className="py-3 px-3 font-medium">Status</th>
                                  <th className="py-3 px-3 font-medium">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.milestones.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} className="py-6 px-3 text-foreground-muted text-center text-sm">
                                      No milestones yet.
                                    </td>
                                  </tr>
                                ) : (
                                  g.milestones.map((m) => (
                                    <tr key={m.id} className="border-b border-border/30 last:border-0">
                                      <td className="py-3 px-3">{m.partner_name || "—"}</td>
                                      <td className="py-3 px-3 font-medium text-foreground">{m.title}</td>
                                      <td className="py-3 px-3 tabular-nums">{formatMoney(m.amount, m.currency)}</td>
                                      <td className="py-3 px-3 font-mono text-xs">{m.due_date}</td>
                                      <td className="py-3 px-3">
                                        <span className={milestoneStatusBadge(m.status)}>{m.status}</span>
                                      </td>
                                      <td className="py-3 px-3">
                                        {m.status === "pending" && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-[#0C3535] bg-[#0C3535] text-white hover:bg-[#0C3535]/90 hover:text-white"
                                            style={{ color: "white" }}
                                            onClick={() => patchMilestone(m.id, "invoiced")}
                                          >
                                            Mark invoiced
                                          </Button>
                                        )}
                                        {m.status === "invoiced" && (
                                          <Button size="sm" onClick={() => patchMilestone(m.id, "paid")}>
                                            Mark as paid
                                          </Button>
                                        )}
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )
                  })}
                </Accordion>
              )}
            </section>
          </>
        )}
      </div>
    </AgencyLayout>
  )
}
