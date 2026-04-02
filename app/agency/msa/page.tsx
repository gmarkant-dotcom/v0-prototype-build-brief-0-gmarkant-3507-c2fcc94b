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
  partner_rfp_response_id: string | null
  title: string
  amount: number
  currency: string
  due_date: string
  status: string
  notes: string | null
  paid_at: string | null
  created_at: string
}

type AwardedScope = {
  response_id: string
  project_id: string
  partnership_id: string | null
  scope_item_name: string
  estimated_budget: string | null
  partner_display_name: string
}

type ProjectMilestoneGroup = {
  project_id: string
  project_name: string
  client_name: string | null
  client_budget: number | null
  total_milestones_amount: number
  total_paid: number
  total_outstanding: number
  budget_alert: boolean
  milestones: MilestoneRow[]
  awarded_scopes: AwardedScope[]
}

type AiSuggestion = {
  title: string
  amount: number
  currency: string
  due_date: string
  notes: string
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
      if (!msaRes.ok) throw new Error(msaData.error || "Failed to load MSA data")
      if (!partRes.ok) throw new Error(partData.error || "Failed to load partnerships")
      if (!milRes.ok) throw new Error(milData.error || "Failed to load milestones")
      setAgreements(msaData.agreements || [])
      setPartnerships((partData.partnerships || []) as PartnershipRow[])
      setProjectGroups(milData.projects || [])
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
    try {
      const res = await fetch("/api/agency/msa/milestones", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          title: s.title,
          amount: s.amount,
          currency: s.currency || "USD",
          due_date: s.due_date.slice(0, 10),
          notes: s.notes || null,
          partner_rfp_response_id: responseId,
          partnership_id: partnershipId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to add milestone")
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
        partner_rfp_response_id: string
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
      partner_rfp_response_id: "",
      notes: "",
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
        f.partner_rfp_response_id && scopes.find((s) => s.response_id === f.partner_rfp_response_id)
      const res = await fetch("/api/agency/msa/milestones", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          title: f.title.trim(),
          amount: parseFloat(f.amount) || 0,
          currency: f.currency || "USD",
          due_date: f.due_date,
          notes: f.notes.trim() || null,
          partner_rfp_response_id: f.partner_rfp_response_id || null,
          partnership_id: scope?.partnership_id ?? null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to add")
      setNewMilestone((prev) => ({
        ...prev,
        [projectId]: {
          title: "",
          amount: "",
          currency: "USD",
          due_date: "",
          partner_rfp_response_id: "",
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
                                value={f.partner_rfp_response_id}
                                onChange={(e) =>
                                  setNewMilestone((prev) => ({
                                    ...prev,
                                    [g.project_id]: { ...f, partner_rfp_response_id: e.target.value },
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
                                    <td colSpan={5} className="py-6 px-3 text-foreground-muted text-center text-sm">
                                      No milestones yet.
                                    </td>
                                  </tr>
                                ) : (
                                  g.milestones.map((m) => (
                                    <tr key={m.id} className="border-b border-border/30 last:border-0">
                                      <td className="py-3 px-3 font-medium text-foreground">{m.title}</td>
                                      <td className="py-3 px-3 tabular-nums">{formatMoney(m.amount, m.currency)}</td>
                                      <td className="py-3 px-3 font-mono text-xs">{m.due_date}</td>
                                      <td className="py-3 px-3">
                                        <span className={milestoneStatusBadge(m.status)}>{m.status}</span>
                                      </td>
                                      <td className="py-3 px-3">
                                        {m.status === "pending" && (
                                          <Button size="sm" variant="outline" onClick={() => patchMilestone(m.id, "invoiced")}>
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
