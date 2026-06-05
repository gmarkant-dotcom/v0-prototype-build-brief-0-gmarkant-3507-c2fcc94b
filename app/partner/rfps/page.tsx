"use client"

import { useState, useMemo, useEffect, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { PartnerLayout } from "@/components/partner-layout"
import { useFetch } from "@/hooks/useFetch"
import { cn } from "@/lib/utils"
import {
  Search, Filter, ChevronDown, ChevronRight,
  Building2, FileText, AlertTriangle, Clock, Loader2,
} from "lucide-react"
import { Input } from "@/components/ui/input"

// ── Types ─────────────────────────────────────────────────────────────────────

type PartnerInboxRow = {
  id: string
  status: string
  response_status?: string | null
  effective_status?: string | null
  scope_item_name: string
  scope_item_description: string | null
  agency_company_name: string | null
  created_at?: string | null
  response_deadline?: string | null
  partner_intent?: "will_respond" | "has_questions" | "requesting_call" | null
  viewed_at?: string | null
  nda_gate_enforced?: boolean | null
  nda_confirmed_at?: string | null
}

// ── Status config ─────────────────────────────────────────────────────────────

const RFP_STATUSES = [
  { key: "all",               label: "All RFPs" },
  { key: "new",               label: "New" },
  { key: "submitted",         label: "Submitted" },
  { key: "under_review",      label: "Changes Requested" },
  { key: "shortlisted",       label: "Shortlisted" },
  { key: "meeting_requested", label: "Meeting Requested" },
  { key: "awarded",           label: "Awarded" },
  { key: "declined",          label: "Declined" },
] as const

type RFPStatusKey = (typeof RFP_STATUSES)[number]["key"]

type GroupBy = "agency" | "status"

const STATUS_BADGE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  new:               { bg: "bg-gray-100",        border: "border-gray-200",        text: "text-gray-500",   label: "New" },
  submitted:         { bg: "bg-sky-50",           border: "border-sky-200",         text: "text-sky-700",    label: "Submitted" },
  under_review:      { bg: "bg-amber-50",         border: "border-amber-200",       text: "text-amber-700",  label: "Changes Requested" },
  shortlisted:       { bg: "bg-violet-50",        border: "border-violet-200",      text: "text-violet-700", label: "Shortlisted" },
  meeting_requested: { bg: "bg-cyan-50",          border: "border-cyan-200",        text: "text-cyan-700",   label: "Meeting Requested" },
  awarded:           { bg: "bg-emerald-50",       border: "border-emerald-200",     text: "text-emerald-700",label: "Awarded" },
  declined:          { bg: "bg-red-50",           border: "border-red-200",         text: "text-red-700",    label: "Declined" },
  bid_submitted:     { bg: "bg-sky-50",           border: "border-sky-200",         text: "text-sky-700",    label: "Submitted" },
  feedback_received: { bg: "bg-amber-50",         border: "border-amber-200",       text: "text-amber-700",  label: "Feedback" },
  revision_submitted:{ bg: "bg-sky-50",           border: "border-sky-200",         text: "text-sky-700",    label: "Revised" },
  viewed:            { bg: "bg-gray-100",         border: "border-gray-200",        text: "text-gray-600",   label: "Viewed" },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowStatus(row: PartnerInboxRow): string {
  return row.effective_status || row.response_status || row.status || "new"
}

function normaliseForTab(s: string): RFPStatusKey {
  if (s === "bid_submitted" || s === "revision_submitted") return "submitted"
  if (s === "feedback_received") return "under_review"
  if (s === "viewed") return "new"
  return s as RFPStatusKey
}

function badge(status: string) {
  return STATUS_BADGE[status] ?? STATUS_BADGE.new
}

function formatDate(raw?: string | null): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function isDeadlineSoon(raw?: string | null): boolean {
  if (!raw) return false
  const diff = new Date(raw).getTime() - Date.now()
  return diff > 0 && diff <= 48 * 60 * 60 * 1000
}

function ndaBlocked(row: PartnerInboxRow): boolean {
  return row.nda_gate_enforced === true && !row.nda_confirmed_at
}

// ── RFP card ─────────────────────────────────────────────────────────────────

function RFPCard({ row, showAgency }: { row: PartnerInboxRow; showAgency: boolean }) {
  const st = rowStatus(row)
  const b = badge(st)
  const deadline = formatDate(row.response_deadline)
  const soon = isDeadlineSoon(row.response_deadline)
  const blocked = ndaBlocked(row)

  return (
    <Link
      href={`/partner/rfps/${row.id}`}
      className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 bg-white hover:border-[#0C3535]/40 hover:shadow-sm transition-all group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-display font-bold text-[#0C3535] truncate">{row.scope_item_name}</span>
          <span className={cn(
            "font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
            b.bg, b.border, b.text
          )}>
            {b.label}
          </span>
          {blocked && (
            <span className="flex items-center gap-1 font-mono text-[9px] px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-700 shrink-0">
              <AlertTriangle className="w-2.5 h-2.5" />
              NDA required
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-gray-500 flex-wrap">
          {showAgency && row.agency_company_name && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {row.agency_company_name}
            </span>
          )}
          {formatDate(row.created_at) && (
            <>
              {showAgency && row.agency_company_name && <span className="text-gray-300">·</span>}
              <span>Received {formatDate(row.created_at)}</span>
            </>
          )}
          {deadline && (
            <>
              <span className="text-gray-300">·</span>
              <span className={cn("flex items-center gap-1", soon && "text-red-600 font-medium")}>
                <Clock className="w-3 h-3" />
                Due {deadline}
              </span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-[#0C3535] transition-colors shrink-0 mt-1" />
    </Link>
  )
}

// ── Group section ─────────────────────────────────────────────────────────────

function GroupSection({
  label, rows, defaultOpen, groupBy,
}: {
  label: string
  rows: PartnerInboxRow[]
  defaultOpen: boolean
  groupBy: GroupBy
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [activeStatus, setActiveStatus] = useState<RFPStatusKey>("all")

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length }
    for (const r of rows) {
      const tab = normaliseForTab(rowStatus(r))
      map[tab] = (map[tab] || 0) + 1
    }
    return map
  }, [rows])

  const filtered = useMemo(
    () => activeStatus === "all"
      ? rows
      : rows.filter(r => normaliseForTab(rowStatus(r)) === activeStatus),
    [rows, activeStatus]
  )

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-5 hover:bg-gray-100/60 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-[#0C3535]/10 flex items-center justify-center shrink-0">
          {groupBy === "agency"
            ? <Building2 className="w-5 h-5 text-[#0C3535]" />
            : <FileText className="w-5 h-5 text-[#0C3535]" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-xl text-[#0C3535]">{label}</div>
          <div className="font-mono text-[11px] text-gray-500 mt-0.5">
            {rows.length} RFP{rows.length !== 1 ? "s" : ""}
            {(counts["awarded"] ?? 0) > 0 && (
              <span className="ml-2 text-emerald-600">· {counts["awarded"]} awarded</span>
            )}
          </div>
        </div>
        <div className={cn("transition-transform shrink-0", open && "rotate-180")}>
          <ChevronDown className="w-5 h-5 text-gray-400" />
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-200 bg-white">
          {/* Status tabs */}
          <div className="flex gap-1 flex-wrap px-4 pt-3 pb-2">
            {RFP_STATUSES.map(({ key, label: tabLabel }) => {
              const count = key === "all" ? rows.length : (counts[key] ?? 0)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveStatus(key)}
                  className={cn(
                    "shrink-0 px-2.5 py-1 rounded-lg font-mono text-[10px] transition-colors whitespace-nowrap",
                    activeStatus === key
                      ? "bg-[#0C3535] text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  )}
                >
                  {tabLabel} ({count})
                </button>
              )
            })}
          </div>
          {/* RFP list */}
          <div className="px-4 pb-4 space-y-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No RFPs match this filter.</p>
            ) : (
              filtered.map(row => (
                <RFPCard key={row.id} row={row} showAgency={groupBy !== "agency"} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function PartnerRFPsContent() {
  const searchParams = useSearchParams()
  const inviteStatus = (searchParams.get("invite_status") || "").trim()

  const inviteToken = (searchParams.get("invite") || "").trim()
  const ndaParam = searchParams.get("nda")

  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("agency")

  // Auto-claim invite token for already-logged-in partners arriving via email CTA
  useEffect(() => {
    if (!inviteToken) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/partner/rfps/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: inviteToken }),
        })
        const data: { inboxItemId?: string; ndaGateEnforced?: boolean } = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok && data?.inboxItemId) {
          const id = encodeURIComponent(data.inboxItemId)
          const path = (data?.ndaGateEnforced || ndaParam === "required")
            ? "/partner/rfps/" + id + "?nda=required"
            : "/partner/rfps/" + id
          if (typeof window !== "undefined") window.location.replace(path)
        }
      } catch {
        // Claim failed — stay on list page
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken])

  const { data, isLoading, error } = useFetch<{ rfps: PartnerInboxRow[] }>("/api/partner/rfps")
  const allRows: PartnerInboxRow[] = data?.rfps ?? []

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? allRows.filter(r => {
          const hay = [r.agency_company_name, r.scope_item_name].join(" ").toLowerCase()
          return hay.includes(q)
        })
      : allRows

    const map = new Map<string, PartnerInboxRow[]>()
    for (const r of filtered) {
      const key = groupBy === "agency"
        ? (r.agency_company_name || "Unknown Agency").trim()
        : (RFP_STATUSES.find(s => s.key === normaliseForTab(rowStatus(r)))?.label ?? "New")
      const list = map.get(key) ?? []
      list.push(r)
      map.set(key, list)
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, rows]) => ({ label, rows }))
  }, [allRows, search, groupBy])

  const totalRfps = allRows.length
  const totalGroups = groups.length

  return (
    <PartnerLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display font-bold text-3xl text-[#0C3535]">Open RFPs</h1>
          <p className="text-gray-600 mt-1">
            {isLoading
              ? "Loading…"
              : `${totalRfps} RFP${totalRfps !== 1 ? "s" : ""} across ${totalGroups} ${groupBy === "agency" ? "agency" : "status"}${totalGroups !== 1 ? "es" : ""}`
            }
          </p>
        </div>

        {inviteStatus === "failed" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            Your invite may have expired or already been claimed. Active RFPs are still shown below.
          </div>
        )}

        {/* Search + group-by */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search agency or scope…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-white border-gray-200 text-gray-900 placeholder:text-gray-400"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">Group by</span>
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              {(["agency", "status"] as GroupBy[]).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  className={cn(
                    "px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    groupBy === g
                      ? "bg-[#0C3535] text-white"
                      : "bg-white text-gray-500 hover:bg-gray-50"
                  )}
                >
                  {g === "agency" ? "Agency" : "Status"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        {isLoading && (
          <div className="flex items-center justify-center py-12 gap-3 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin text-[#0C3535]" />
            <span className="font-mono text-sm">Loading RFPs…</span>
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Failed to load RFPs. Please refresh.
          </div>
        )}
        {!isLoading && !error && groups.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="font-display font-bold text-xl text-[#0C3535] mb-2">
              {search ? "No results" : "No RFPs yet"}
            </div>
            <p className="text-gray-600">
              {search ? "Try a different search term." : "When a lead agency broadcasts an RFP to you, it will appear here."}
            </p>
          </div>
        )}
        {!isLoading && groups.length > 0 && (
          <div className="space-y-4">
            {groups.map((g, i) => (
              <GroupSection
                key={g.label}
                label={g.label}
                rows={g.rows}
                defaultOpen={i === 0}
                groupBy={groupBy}
              />
            ))}
          </div>
        )}
      </div>
    </PartnerLayout>
  )
}

export default function PartnerRFPsPage() {
  return (
    <Suspense>
      <PartnerRFPsContent />
    </Suspense>
  )
}
