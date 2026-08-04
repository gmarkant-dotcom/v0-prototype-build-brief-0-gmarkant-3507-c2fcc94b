"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { useFetch } from "@/hooks/useFetch"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { compositeScoreColorClass } from "@/lib/bid-scoring"
import { isMilestoneOverdue, isMilestonePaid } from "@/lib/partner-payments"
import {
  Search, Filter, ChevronDown, ChevronRight, Building2,
  X, Loader2, CheckCircle, AlertTriangle, DollarSign, Clock, Award,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

// ── Types ─────────────────────────────────────────────────────────────────────

type GroupBy = "agency" | "client"

type PartnerProject = {
  project_id: string
  project_name: string
  client_name: string | null
  budget_range: string | null
  start_date: string | null
  end_date: string | null
  status: string | null
  partnership_id: string
  agency_id: string | null
  agency_name: string
  assignment_id: string
  response_id: string | null
  budget_proposal: string | null
  scope_item_name: string | null
  awarded_at: string | null
}

type Group = {
  label: string
  groupId: string | null
  projects: PartnerProject[]
}

/**
 * Read-only, structured scores only - no agency private notes, human override notes,
 * AI delta summary, or draft reviews. Row visibility is also enforced at the RLS level
 * (migration 066: partners can only SELECT delivery_reviews where status = 'complete'
 * and the row's partnership belongs to them) - this column list is a second, app-layer
 * guard against ever selecting the sensitive fields in the first place.
 */
type PartnerDeliveryReview = {
  id: string
  project_id: string
  composite_score: number | null
  on_time: "yes" | "no" | "partial" | null
  on_budget: "yes" | "no" | "over" | "under" | null
  overall_satisfaction: number | null
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
  scope_item_name?: string | null
}

type RateInfo = {
  hourly_rate: string
  project_minimum: string
  payment_terms: string
  payment_terms_custom: string
  notes: string
}

type StatusUpdate = {
  id: string
  status: string
  budget_status: string
  completion_pct: number
  notes: string | null
  created_at: string
  is_resolved: boolean
}

type SlideTab = "status" | "cashflow"

// ── Status/budget values ───────────────────────────────────────────────────────

const WORKFLOW_STATUSES = ["on_track","at_risk","delayed","blocked","complete"] as const
const BUDGET_STATUSES   = ["on_budget","over_budget","incremental_needed","scope_creep"] as const

const WORKFLOW_LABEL: Record<string,string> = {
  on_track:"On Track", at_risk:"At Risk", delayed:"Delayed", blocked:"Blocked", complete:"Complete",
}
const BUDGET_LABEL: Record<string,string> = {
  on_budget:"On Budget", over_budget:"Over Budget",
  incremental_needed:"Incremental Budget Needed", scope_creep:"Scope Creep Identified",
}
const MILESTONE_LABEL: Record<string,string> = {
  pending:"Pending", invoiced:"Invoice Sent", payment_received:"Payment Received",
  payment_delayed:"Payment Delayed", invoice_received:"Invoice Received",
  payment_sent:"Payment Sent", need_more_info:"Need More Info",
}

const ON_TIME_BADGE: Record<string, { label: string; className: string }> = {
  yes:     { label: "On Time",         className: "bg-success/15 text-success border-success/30" },
  partial: { label: "Partially On Time", className: "bg-amber-50 text-amber-700 border-amber-200" },
  no:      { label: "Not On Time",     className: "bg-red-50 text-red-700 border-red-200" },
}
const ON_BUDGET_BADGE: Record<string, { label: string; className: string }> = {
  yes:   { label: "On Budget",    className: "bg-success/15 text-success border-success/30" },
  under: { label: "Under Budget", className: "bg-success/15 text-success border-success/30" },
  over:  { label: "Over Budget",  className: "bg-red-50 text-red-700 border-red-200" },
  no:    { label: "Not On Budget", className: "bg-red-50 text-red-700 border-red-200" },
}

const STATUS_BADGE: Record<string,{bg:string;text:string;border:string}> = {
  on_track: {bg:"bg-success/15",text:"text-success",border:"border-success/40"},
  at_risk:  {bg:"bg-amber-500/15",  text:"text-amber-200",  border:"border-amber-500/40"},
  delayed:  {bg:"bg-red-500/15",    text:"text-red-300",    border:"border-red-500/40"},
  blocked:  {bg:"bg-red-500/15",    text:"text-red-300",    border:"border-red-500/40"},
  complete: {bg:"bg-cyan-500/15",   text:"text-cyan-200",   border:"border-cyan-500/40"},
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDateRange(start:string|null|undefined, end:string|null|undefined): string {
  const fmt = (d:string) => new Date(d).toLocaleDateString("en-US",{month:"short",year:"numeric"})
  if (start && end) return `${fmt(start)} – ${fmt(end)}`
  if (start) return `From ${fmt(start)}`
  if (end) return `Until ${fmt(end)}`
  return "-"
}
function parseBudgetNumber(raw:string|null|undefined): number {
  if (!raw) return 0
  const n = Number(String(raw).replace(/[^0-9.]/g,""))
  return isNaN(n) ? 0 : n
}
function formatBudgetK(n:number): string {
  if (n===0) return "$0K"
  if (n>=1_000_000) return `$${(n/1_000_000).toFixed(1).replace(/\.0$/,"")}M`
  return `$${Math.round(n/1000)}K`
}
function fmtDate(iso:string): string {
  return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
}

// ── Status tab ─────────────────────────────────────────────────────────────────

function StatusTab({ project }: { project: PartnerProject }) {
  const [workflowStatus, setWorkflowStatus] = useState<string>("on_track")
  const [budgetStatus, setBudgetStatus] = useState<string>("on_budget")
  const [completionPct, setCompletionPct] = useState(0)
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState<string|null>(null)
  const [history, setHistory] = useState<StatusUpdate[]>([])
  const [histLoading, setHistLoading] = useState(true)

  // Load history via Supabase browser client
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setHistLoading(true)
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const { data } = await supabase
          .from("partner_status_updates")
          .select("id,status,budget_status,completion_pct,notes,created_at,is_resolved")
          .eq("project_id", project.project_id)
          .eq("partnership_id", project.partnership_id)
          .order("created_at", { ascending: false })
          .limit(20)
        if (!cancelled) {
          setHistory((data || []) as StatusUpdate[])
          const latest = (data || [])[0]
          if (latest) {
            setWorkflowStatus(latest.status || "on_track")
            setBudgetStatus(latest.budget_status || "on_budget")
            setCompletionPct(latest.completion_pct || 0)
          }
        }
      } catch {}
      finally { if (!cancelled) setHistLoading(false) }
    })()
    return () => { cancelled = true }
  }, [project.project_id, project.partnership_id])

  const handleSubmit = useCallback(async () => {
    setSubmitting(true); setSubmitMsg(null)
    try {
      const res = await fetch(`/api/partner/projects/${project.project_id}/status-update`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: workflowStatus, budget_status: budgetStatus, completion_pct: completionPct, notes: notes || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setSubmitMsg(d?.error || "Failed"); return }
      setSubmitMsg("Status update submitted successfully.")
      setNotes("")
      // Refresh history
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from("partner_status_updates")
          .select("id,status,budget_status,completion_pct,notes,created_at,is_resolved")
          .eq("project_id", project.project_id)
          .eq("partnership_id", project.partnership_id)
          .order("created_at", { ascending: false })
          .limit(20)
        setHistory((data || []) as StatusUpdate[])
      }
    } catch { setSubmitMsg("Failed to submit") }
    finally { setSubmitting(false) }
  }, [project, workflowStatus, budgetStatus, completionPct, notes])

  return (
    <div className="p-6 space-y-6">
      <p className="font-mono text-2xs text-vendor-muted italic">
        Your updates are visible to the lead agency and reflected in their dashboard.
      </p>

      {/* Update form */}
      <div className="space-y-4">
        <h3 className="font-display font-bold text-base text-vendor-foreground">Submit status update</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="font-mono text-2xs uppercase tracking-wider text-vendor-muted">Workflow Status</label>
            <select value={workflowStatus} onChange={e => setWorkflowStatus(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-vendor-border bg-vendor-surface text-sm text-vendor-foreground">
              {WORKFLOW_STATUSES.map(s => <option key={s} value={s}>{WORKFLOW_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="font-mono text-2xs uppercase tracking-wider text-vendor-muted">Budget Status</label>
            <select value={budgetStatus} onChange={e => setBudgetStatus(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-vendor-border bg-vendor-surface text-sm text-vendor-foreground">
              {BUDGET_STATUSES.map(s => <option key={s} value={s}>{BUDGET_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between">
            <label className="font-mono text-2xs uppercase tracking-wider text-vendor-muted">Completion</label>
            <span className="font-mono text-xs text-vendor-foreground">{completionPct}%</span>
          </div>
          <input type="range" min={0} max={100} value={completionPct} onChange={e => setCompletionPct(Number(e.target.value))}
            className="w-full accent-vendor-foreground" />
        </div>
        <div className="space-y-1">
          <label className="font-mono text-2xs uppercase tracking-wider text-vendor-muted">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="Progress update, blockers, next steps…"
            className="w-full rounded-lg border border-vendor-border bg-vendor-surface px-3 py-2 text-sm text-vendor-foreground placeholder:text-vendor-muted/70 resize-none" />
        </div>
        {submitMsg && <p className={cn("text-sm", submitMsg.includes("success") ? "text-success" : "text-red-600")}>{submitMsg}</p>}
        <Button onClick={handleSubmit} disabled={submitting} className="w-full bg-vendor-foreground hover:bg-vendor-foreground/90 text-white">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {submitting ? "Submitting…" : "Submit Status Update"}
        </Button>
      </div>

      {/* History */}
      <div className="space-y-3">
        <h3 className="font-display font-bold text-base text-vendor-foreground">Update history</h3>
        {histLoading ? (
          <div className="flex items-center gap-2 text-vendor-muted py-4"><Loader2 className="w-4 h-4 animate-spin" /><span className="font-mono text-sm">Loading…</span></div>
        ) : history.length === 0 ? (
          <p className="text-sm text-vendor-muted">No updates submitted yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map(u => {
              const b = STATUS_BADGE[u.status]
              return (
                <div key={u.id} className="rounded-lg border border-vendor-border bg-vendor-background p-3 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {b && <span className={cn("font-mono text-2xs px-2 py-0.5 rounded-full border uppercase tracking-wider", b.bg, b.text, b.border)}>{WORKFLOW_LABEL[u.status]||u.status}</span>}
                    <span className="font-mono text-2xs text-vendor-muted">{BUDGET_LABEL[u.budget_status]||u.budget_status}</span>
                    <span className="font-mono text-2xs text-vendor-muted">{u.completion_pct}% complete</span>
                    {u.is_resolved && <span className="flex items-center gap-1 font-mono text-2xs text-success"><CheckCircle className="w-2.5 h-2.5" />Resolved</span>}
                  </div>
                  {u.notes && <p className="text-xs text-vendor-foreground">{u.notes}</p>}
                  <p className="font-mono text-2xs text-vendor-muted/70">{fmtDate(u.created_at)}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cash flow tab ──────────────────────────────────────────────────────────────

function CashFlowTab({ project }: { project: PartnerProject }) {
  const [rateInfo, setRateInfo] = useState<RateInfo|null>(null)
  const [milestones, setMilestones] = useState<MilestoneRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingRequest, setPendingRequest] = useState<{proposed_rate:string;proposed_terms:string;notes:string}|null>(null)
  const [requestForm, setRequestForm] = useState(false)
  const [reqRate, setReqRate] = useState("")
  const [reqTerms, setReqTerms] = useState("")
  const [reqNotes, setReqNotes] = useState("")
  const [reqSaving, setReqSaving] = useState(false)
  const [confirmingMilestone, setConfirmingMilestone] = useState<string|null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [rateRes, milRes] = await Promise.all([
          fetch(`/api/partner/rate-info?partnershipId=${encodeURIComponent(project.partnership_id)}`, { credentials: "same-origin" }),
          fetch("/api/partner/payments", { credentials: "same-origin" }),
        ])
        if (!cancelled) {
          if (rateRes.ok) {
            const d = await rateRes.json().catch(()=>({}))
            setRateInfo(d?.rate_info || null)
          }
          if (milRes.ok) {
            const d = await milRes.json().catch(()=>({}))
            const all: MilestoneRow[] = d?.milestones || []
            setMilestones(all.filter(m => m.project_id === project.project_id))
          }
        }
        // Check for pending payment_terms_requests
        const supabase = createClient()
        const { data: pship } = await supabase
          .from("partnerships")
          .select("payment_terms_requests")
          .eq("id", project.partnership_id)
          .maybeSingle()
        if (!cancelled && pship?.payment_terms_requests) {
          const reqs = pship.payment_terms_requests as {status:string;proposed_rate:string;proposed_terms:string;notes:string}[]
          const pending = reqs.find(r => r.status === "pending")
          if (pending) setPendingRequest(pending)
        }
      } catch {}
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [project.partnership_id, project.project_id])

  const handleRequestSubmit = useCallback(async () => {
    setReqSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: pship } = await supabase.from("partnerships").select("payment_terms_requests").eq("id", project.partnership_id).maybeSingle()
      const existing = (pship?.payment_terms_requests as unknown[]) || []
      const newReq = { proposed_rate: reqRate, proposed_terms: reqTerms, notes: reqNotes, requested_at: new Date().toISOString(), requested_by: user.id, status: "pending" }
      await supabase.from("partnerships").update({ payment_terms_requests: [...existing, newReq] }).eq("id", project.partnership_id)
      setPendingRequest(newReq as typeof pendingRequest)
      setRequestForm(false); setReqRate(""); setReqTerms(""); setReqNotes("")
    } catch {}
    finally { setReqSaving(false) }
  }, [project.partnership_id, reqRate, reqTerms, reqNotes])

  const handleConfirmPayment = useCallback(async (milestoneId: string) => {
    setConfirmingMilestone(milestoneId)
    try {
      const supabase = createClient()
      await supabase.from("payment_milestones").update({ status: "payment_received", paid_at: new Date().toISOString() }).eq("id", milestoneId)
      setMilestones(prev => prev.map(m => m.id === milestoneId ? { ...m, status: "payment_received", paid_at: new Date().toISOString() } : m))
    } catch {}
    finally { setConfirmingMilestone(null) }
  }, [])

  if (loading) return <div className="flex items-center gap-2 text-vendor-muted p-6"><Loader2 className="w-5 h-5 animate-spin" /><span className="font-mono text-sm">Loading…</span></div>

  const termsLabel: Record<string,string> = { net_15:"Net 15", net_30:"Net 30", net_45:"Net 45", net_60:"Net 60", custom:"Custom" }

  return (
    <div className="p-6 space-y-6">
      {/* Rate & Terms */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-base text-vendor-foreground">Agreed Terms &amp; Rate</h3>
          {!requestForm && !pendingRequest && (
            <button type="button" onClick={() => setRequestForm(true)} className="font-mono text-2xs text-vendor-foreground underline hover:no-underline">
              Request update
            </button>
          )}
        </div>
        {rateInfo ? (
          <div className="rounded-lg border border-vendor-border bg-vendor-background p-4 grid grid-cols-2 gap-3 text-sm">
            {rateInfo.hourly_rate && <div><span className="font-mono text-2xs text-vendor-muted block">Hourly Rate</span><span className="text-vendor-foreground">{rateInfo.hourly_rate}</span></div>}
            {rateInfo.project_minimum && <div><span className="font-mono text-2xs text-vendor-muted block">Project Minimum</span><span className="text-vendor-foreground">{rateInfo.project_minimum}</span></div>}
            <div><span className="font-mono text-2xs text-vendor-muted block">Payment Terms</span><span className="text-vendor-foreground">{termsLabel[rateInfo.payment_terms]||rateInfo.payment_terms}{rateInfo.payment_terms==="custom"&&rateInfo.payment_terms_custom&&`: ${rateInfo.payment_terms_custom}`}</span></div>
            {rateInfo.notes && <div className="col-span-2"><span className="font-mono text-2xs text-vendor-muted block">Notes</span><span className="text-vendor-foreground">{rateInfo.notes}</span></div>}
          </div>
        ) : <p className="text-sm text-vendor-muted">No rate info on file yet. <a href="/partner/settings/user" className="text-vendor-foreground underline">Add via Payment Setup</a>.</p>}

        {pendingRequest && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="font-mono text-2xs text-amber-700 uppercase tracking-wider mb-1">Pending update request</p>
            {pendingRequest.proposed_rate && <p className="text-sm text-amber-900">Rate: {pendingRequest.proposed_rate}</p>}
            {pendingRequest.proposed_terms && <p className="text-sm text-amber-900">Terms: {pendingRequest.proposed_terms}</p>}
            {pendingRequest.notes && <p className="text-sm text-amber-700 italic">{pendingRequest.notes}</p>}
          </div>
        )}

        {requestForm && (
          <div className="rounded-lg border border-vendor-border p-4 space-y-3 bg-vendor-surface">
            <p className="font-mono text-2xs uppercase tracking-wider text-vendor-muted">Propose updated rate/terms</p>
            <Input placeholder="Proposed rate (e.g. $150/hr)" value={reqRate} onChange={e=>setReqRate(e.target.value)} className="bg-vendor-surface border-vendor-border text-vendor-foreground" />
            <Input placeholder="Proposed payment terms (e.g. Net 30)" value={reqTerms} onChange={e=>setReqTerms(e.target.value)} className="bg-vendor-surface border-vendor-border text-vendor-foreground" />
            <textarea placeholder="Reason / notes" value={reqNotes} onChange={e=>setReqNotes(e.target.value)} rows={2}
              className="w-full rounded-lg border border-vendor-border bg-vendor-surface px-3 py-2 text-sm text-vendor-foreground placeholder:text-vendor-muted/70 resize-none" />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 border-vendor-border" onClick={()=>setRequestForm(false)}>Cancel</Button>
              <Button className="flex-1 bg-vendor-foreground text-white" onClick={handleRequestSubmit} disabled={reqSaving}>
                {reqSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Submit request
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Milestones */}
      <section className="space-y-3">
        <h3 className="font-display font-bold text-base text-vendor-foreground">Payment schedule</h3>
        {milestones.length === 0 ? (
          <p className="text-sm text-vendor-muted">No payment milestones scheduled yet.</p>
        ) : (
          <div className="space-y-2">
            {milestones.map(m => {
              const isPaid = isMilestonePaid(m.status)
              const overdue = isMilestoneOverdue({ amount: m.amount, status: m.status, due_date: m.due_date })
              return (
                <div key={m.id} className={cn("rounded-lg border p-3 space-y-1.5", isPaid ? "border-success/30 bg-success/15" : overdue ? "border-destructive/30 bg-destructive/15" : "border-vendor-border bg-vendor-surface")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm text-vendor-foreground">{m.title}</div>
                      <div className="flex items-center gap-2 mt-0.5 font-mono text-2xs text-vendor-muted flex-wrap">
                        <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{m.currency} {m.amount.toLocaleString("en-US")}</span>
                        <span className={cn("flex items-center gap-1", overdue && "text-destructive")}><Clock className="w-3 h-3" />Due {fmtDate(m.due_date)}</span>
                        <span className={cn("px-1.5 py-0.5 rounded font-mono text-2xs uppercase", isPaid ? "bg-success/15 text-success" : overdue ? "bg-destructive/15 text-destructive" : "bg-gray-100 text-vendor-muted-strong")}>
                          {overdue ? "Overdue" : MILESTONE_LABEL[m.status]||m.status}
                        </span>
                      </div>
                      {m.notes && <p className="text-xs text-vendor-muted mt-1 italic">{m.notes}</p>}
                      {m.paid_at && <p className="font-mono text-2xs text-success">Received {fmtDate(m.paid_at)}</p>}
                    </div>
                    {!isPaid && m.status === "payment_sent" && (
                      <Button size="sm" variant="outline"
                        className="h-7 border-success/30 text-success hover:bg-success/15 shrink-0"
                        disabled={confirmingMilestone === m.id}
                        onClick={() => handleConfirmPayment(m.id)}>
                        {confirmingMilestone === m.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                        Confirm Receipt
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

// ── Slide-over panel ───────────────────────────────────────────────────────────

function SlideOverPanel({ project, onClose }: { project: PartnerProject; onClose: () => void }) {
  const [tab, setTab] = useState<SlideTab>("status")

  const tabs: {key:SlideTab;label:string}[] = [
    { key:"status",   label:"Status & Updates" },
    { key:"cashflow", label:"Cash Flow & Payments" },
  ]

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full md:w-1/2 max-w-2xl h-full bg-vendor-surface flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-vendor-border shrink-0">
          <div>
            <h2 className="font-display font-bold text-xl text-vendor-foreground">{project.agency_name}</h2>
            <p className="text-sm text-vendor-muted-strong mt-0.5">{project.scope_item_name || project.project_name}</p>
            {project.client_name && <p className="font-mono text-2xs text-vendor-muted/70 mt-0.5">Client: {project.client_name}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-vendor-muted/70 hover:text-vendor-foreground mt-1"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-vendor-border shrink-0">
          {tabs.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={cn("px-5 py-3 font-mono text-2xs uppercase tracking-wider transition-colors border-b-2 -mb-px",
                tab===t.key ? "border-vendor-foreground text-vendor-foreground" : "border-transparent text-vendor-muted hover:text-vendor-foreground")}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab==="status"   && <StatusTab project={project} />}
          {tab==="cashflow" && <CashFlowTab project={project} />}
        </div>
      </div>
    </div>
  )
}

// ── Project card (clickable row) ───────────────────────────────────────────────

function ProjectCard({ project, onClick }: { project: PartnerProject; onClick: () => void }) {
  const dateRange = formatDateRange(project.start_date, project.end_date)
  const budget = parseBudgetNumber(project.budget_proposal)

  return (
    <button type="button" onClick={onClick}
      className="w-full text-left flex items-center gap-4 p-5 rounded-xl border border-vendor-border bg-vendor-surface hover:border-vendor-foreground/40 hover:shadow-sm transition-all group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="font-display font-bold text-base text-vendor-foreground truncate">{project.scope_item_name || project.project_name}</span>
          {project.status && (
            <span className={cn("font-mono text-2xs px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
              project.status==="active" ? "bg-success/15 text-success border-success/30" : "bg-gray-100 text-vendor-muted-strong border-vendor-border")}>
              {project.status.replace(/_/g," ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono text-2xs text-vendor-muted flex-wrap">
          {project.scope_item_name && project.project_name !== project.scope_item_name && <span>{project.project_name}</span>}
          {dateRange !== "-" && <span>{dateRange}</span>}
          {budget > 0 && <span className="text-vendor-foreground">{formatBudgetK(budget)}</span>}
          {project.client_name && <span>Client: {project.client_name}</span>}
        </div>
      </div>
      <ChevronRight className="w-5 h-5 text-vendor-muted/70 group-hover:text-vendor-foreground transition-colors shrink-0" />
    </button>
  )
}

// ── Group section ──────────────────────────────────────────────────────────────

function GroupSection({ label, projects, defaultOpen, onProjectClick }: {
  label: string; projects: PartnerProject[]; defaultOpen: boolean; onProjectClick: (p: PartnerProject) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const totalBudget = projects.reduce((s, p) => s + parseBudgetNumber(p.budget_proposal), 0)

  return (
    <div className="rounded-xl border border-vendor-border bg-vendor-background/50 overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-5 hover:bg-gray-100/60 transition-colors text-left">
        <div className="w-10 h-10 rounded-lg bg-vendor-foreground/10 flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-vendor-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-xl text-vendor-foreground">{label}</div>
          <div className="flex items-center gap-3 mt-0.5 font-mono text-2xs text-vendor-muted">
            <span>{projects.length} engagement{projects.length!==1?"s":""}</span>
            {totalBudget>0 && <span>{formatBudgetK(totalBudget)} total</span>}
          </div>
        </div>
        <ChevronDown className={cn("w-5 h-5 text-vendor-muted/70 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-vendor-border p-4 space-y-2 bg-vendor-surface">
          {projects.map(p => (
            <ProjectCard key={`${p.project_id}-${p.response_id??p.assignment_id}`} project={p} onClick={() => onProjectClick(p)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Performance Scores section ──────────────────────────────────────────────────

function PerformanceScoresSection({ reviews, projectNameById }: {
  reviews: PartnerDeliveryReview[] | null | undefined; projectNameById: Map<string, string>
}) {
  if (!reviews?.length) return null

  return (
    <div className="bg-vendor-surface rounded-xl border border-vendor-border p-5 space-y-4">
      <div>
        <h2 className="font-display font-bold text-lg text-vendor-foreground flex items-center gap-2">
          <Award className="w-5 h-5 text-vendor-foreground" />
          Performance Scores
        </h2>
        <p className="font-mono text-2xs text-vendor-muted mt-0.5">
          Delivery reviews completed by your lead agencies. Read-only.
        </p>
      </div>
      <div className="space-y-2">
        {reviews.map((review, i) => {
          if (!review) return null
          const projectName = projectNameById.get(review.project_id ?? "") || "Project"
          const onTime = review.on_time ? ON_TIME_BADGE[review.on_time] : null
          const onBudget = review.on_budget ? ON_BUDGET_BADGE[review.on_budget] : null
          const scoreColor = review.composite_score != null ? compositeScoreColorClass(review.composite_score) : null
          return (
            <div key={review.id ?? i} className="flex items-center gap-4 p-3 rounded-lg border border-vendor-border flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-sm text-vendor-foreground truncate">{projectName}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {review.composite_score != null && scoreColor && (
                  <span className={cn(
                    "flex items-center justify-center w-9 h-9 rounded-full border-2 font-display font-bold text-sm shrink-0",
                    scoreColor.bg, scoreColor.text, scoreColor.border
                  )}>
                    {Math.round(review.composite_score)}
                  </span>
                )}
                {onTime && (
                  <span className={cn("font-mono text-2xs px-2 py-0.5 rounded-full border uppercase tracking-wider", onTime.className)}>
                    {onTime.label}
                  </span>
                )}
                {onBudget && (
                  <span className={cn("font-mono text-2xs px-2 py-0.5 rounded-full border uppercase tracking-wider", onBudget.className)}>
                    {onBudget.label}
                  </span>
                )}
                {review.overall_satisfaction != null && (
                  <span className="font-mono text-2xs px-2 py-0.5 rounded-full border border-vendor-border bg-vendor-background text-vendor-muted-strong uppercase tracking-wider">
                    Satisfaction {review.overall_satisfaction}/10
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PartnerProjectsPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>("agency")
  const [search, setSearch] = useState("")
  const [activeProject, setActiveProject] = useState<PartnerProject|null>(null)

  const { data, isLoading, error } = useFetch<{ projects: PartnerProject[] }>("/api/partner/projects")
  // Memoized so this array has a stable reference across renders while `data` is
  // unchanged (including the whole loading phase, where `data` is `undefined`).
  // `data?.projects ?? []` evaluated inline would mint a brand-new [] every render,
  // which fed straight into the effect below as an always-different dependency -
  // useEffect fired every render, called setDeliveryReviews on an empty-partnerships
  // partner, which re-rendered, which made a new [], forever (React error #185).
  const allProjects: PartnerProject[] = useMemo(() => data?.projects ?? [], [data])

  const [deliveryReviews, setDeliveryReviews] = useState<PartnerDeliveryReview[]>([])

  useEffect(() => {
    const partnershipIds = [...new Set(allProjects.map((p) => p?.partnership_id).filter(Boolean))]
    if (partnershipIds.length === 0) {
      setDeliveryReviews((prev) => (prev.length === 0 ? prev : []))
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        // RLS (migration 066): partners may only read their own rows where status = 'complete'.
        // Also defensive against the migration not being applied yet in this environment -
        // any query error (missing table, RLS not yet granting access, network failure) just
        // means the section doesn't render, never a crash.
        const { data: reviews, error: reviewsError } = await supabase
          .from("delivery_reviews")
          .select("id, project_id, composite_score, on_time, on_budget, overall_satisfaction")
          .in("partnership_id", partnershipIds)
          .eq("status", "complete")
        if (cancelled) return
        if (reviewsError) {
          console.error("[partner/projects] delivery_reviews load failed", reviewsError.message)
          setDeliveryReviews([])
          return
        }
        setDeliveryReviews(Array.isArray(reviews) ? (reviews as PartnerDeliveryReview[]) : [])
      } catch (e) {
        console.error("[partner/projects] delivery_reviews load exception", e)
        if (!cancelled) setDeliveryReviews([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [allProjects])

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of allProjects) {
      if (!map.has(p.project_id)) map.set(p.project_id, p.project_name)
    }
    return map
  }, [allProjects])

  const groups = useMemo<Group[]>(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? allProjects.filter(p => [p.project_name, p.scope_item_name, p.client_name, p.agency_name].join(" ").toLowerCase().includes(q))
      : allProjects

    const map = new Map<string, { groupId: string|null; projects: PartnerProject[] }>()
    for (const p of filtered) {
      const key = groupBy==="client" ? ((p.client_name||"").trim()||"No Client") : p.agency_name
      const id  = groupBy==="client" ? null : p.agency_id
      if (!map.has(key)) map.set(key, { groupId: id, projects: [] })
      map.get(key)!.projects.push(p)
    }
    return Array.from(map.entries())
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([label, val]) => ({ label, groupId: val.groupId, projects: val.projects }))
  }, [allProjects, groupBy, search])

  return (
    <PartnerLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl text-vendor-foreground">Delivery & Projects</h1>
          <p className="text-vendor-muted-strong mt-1">Your active project engagements and delivery performance</p>
        </div>

        <PerformanceScoresSection reviews={deliveryReviews} projectNameById={projectNameById} />

        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vendor-muted/70" />
            <Input placeholder="Search projects, agencies, or clients..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-vendor-surface border-vendor-border text-vendor-foreground placeholder:text-vendor-muted/70" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-2xs text-vendor-muted/70 uppercase tracking-wider">Group by</span>
            <div className="flex rounded-lg overflow-hidden border border-vendor-border">
              {(["agency","client"] as GroupBy[]).map(g => (
                <button key={g} type="button" onClick={() => setGroupBy(g)}
                  className={cn("px-3 py-1.5 font-mono text-2xs uppercase tracking-wider transition-colors",
                    groupBy===g ? "bg-vendor-foreground text-white" : "bg-vendor-surface text-vendor-muted hover:bg-vendor-background")}>
                  {g==="agency" ? "Agency" : "Client"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading && <div className="flex items-center gap-2 text-vendor-muted py-8"><Loader2 className="w-5 h-5 animate-spin" /><span className="font-mono text-sm">Loading projects…</span></div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Failed to load projects. Please refresh.</div>}
        {!isLoading && !error && groups.length===0 && (
          <div className="bg-vendor-surface rounded-xl border border-vendor-border p-12 text-center">
            <div className="font-display font-bold text-xl text-vendor-foreground mb-2">{search ? "No results" : "No active projects"}</div>
            <p className="text-vendor-muted-strong">{search ? "Try adjusting your search." : "You don't have any project assignments yet."}</p>
          </div>
        )}
        {!isLoading && groups.length>0 && (
          <div className="space-y-4">
            {groups.map((g, i) => (
              <GroupSection key={g.label} label={g.label} projects={g.projects} defaultOpen={i===0} onProjectClick={setActiveProject} />
            ))}
          </div>
        )}
      </div>

      {activeProject && <SlideOverPanel project={activeProject} onClose={() => setActiveProject(null)} />}
    </PartnerLayout>
  )
}
