"use client"

import { useState, useMemo, useEffect, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { PartnerLayout } from "@/components/partner-layout"
import { useFetch } from "@/hooks/useFetch"
import { cn } from "@/lib/utils"
import { formatBudgetForDisplay } from "@/lib/rfp-response-fields"
import { getDeadlineUrgency } from "@/lib/deadline-urgency"
import {
  Search, Filter, ChevronDown, ChevronRight,
  Building2, FileText, AlertTriangle, Clock, Loader2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { usePaidUser } from "@/contexts/paid-user-context"
import {
  VENDOR_RFPS_EMPTY,
  VENDOR_BIDS_OPEN_EMPTY,
  VENDOR_BIDS_HISTORY_EMPTY,
  vendorInboxEmptyDetail,
} from "@/lib/vendor-empty-copy"

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
  client_name?: string | null
}

type PartnerBidRow = {
  id: string
  inbox_item_id: string | null
  status: string
  budget_proposal: string
  submitted_at: string | null
  updated_at: string | null
  scope_item_name: string | null
  client_name: string | null
  agency_company_name: string | null
  agency_full_name: string | null
}

type RfpTab = "open" | "my-bids" | "history"

/** Bids still awaiting a final outcome - the "My Bids" tab's scope. "History" shows every
 *  bid regardless of status, awarded/declined included. */
const TERMINAL_BID_STATUSES = new Set(["awarded", "declined"])

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

type GroupBy = "agency" | "client" | "status"

const STATUS_BADGE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  new:               { bg: "bg-gray-100",        border: "border-vendor-border",        text: "text-vendor-muted",   label: "New" },
  submitted:         { bg: "bg-sky-50",           border: "border-sky-200",         text: "text-sky-700",    label: "Submitted" },
  under_review:      { bg: "bg-amber-50",         border: "border-amber-200",       text: "text-amber-700",  label: "Changes Requested" },
  shortlisted:       { bg: "bg-blue-50",          border: "border-blue-200",        text: "text-blue-700",   label: "Shortlisted" },
  meeting_requested: { bg: "bg-cyan-50",          border: "border-cyan-200",        text: "text-cyan-700",   label: "Meeting Requested" },
  awarded:           { bg: "bg-success/15",       border: "border-success/30",     text: "text-success",label: "Awarded" },
  declined:          { bg: "bg-red-50",           border: "border-red-200",         text: "text-red-700",    label: "Declined" },
  bid_submitted:     { bg: "bg-sky-50",           border: "border-sky-200",         text: "text-sky-700",    label: "Submitted" },
  feedback_received: { bg: "bg-amber-50",         border: "border-amber-200",       text: "text-amber-700",  label: "Feedback" },
  revision_submitted:{ bg: "bg-sky-50",           border: "border-sky-200",         text: "text-sky-700",    label: "Revised" },
  viewed:            { bg: "bg-gray-100",         border: "border-vendor-border",        text: "text-vendor-muted-strong",   label: "Viewed" },
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

function ndaBlocked(row: PartnerInboxRow): boolean {
  return row.nda_gate_enforced === true && !row.nda_confirmed_at
}

// ── RFP card ─────────────────────────────────────────────────────────────────

function RFPCard({ row, showAgency }: { row: PartnerInboxRow; showAgency: boolean }) {
  const st = rowStatus(row)
  const b = badge(st)
  const deadline = formatDate(row.response_deadline)
  const urgency = getDeadlineUrgency(row.response_deadline)
  const blocked = ndaBlocked(row)

  return (
    <Link
      href={`/partner/rfps/${row.id}`}
      className="flex items-start gap-4 p-4 rounded-xl border border-vendor-border bg-vendor-surface hover:border-vendor-foreground/40 hover:shadow-sm transition-all group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-display font-bold text-vendor-foreground truncate">{row.scope_item_name}</span>
          <span className={cn(
            "font-mono text-2xs px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
            b.bg, b.border, b.text
          )}>
            {b.label}
          </span>
          {blocked && (
            <span className="flex items-center gap-1 font-mono text-2xs px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-700 shrink-0">
              <AlertTriangle className="w-2.5 h-2.5" />
              NDA required
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-2xs text-vendor-muted flex-wrap">
          {showAgency && row.agency_company_name && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {row.agency_company_name}
            </span>
          )}
          {formatDate(row.created_at) && (
            <>
              {showAgency && row.agency_company_name && <span className="text-vendor-muted/50">·</span>}
              <span>Received {formatDate(row.created_at)}</span>
            </>
          )}
          {deadline && (
            <>
              <span className="text-vendor-muted/50">·</span>
              <span
                className={cn(
                  "flex items-center gap-1",
                  urgency === "amber" && "text-amber-700 font-medium",
                  urgency === "red" && "text-red-600 font-medium"
                )}
              >
                <Clock className="w-3 h-3" />
                Due {deadline}
              </span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-vendor-muted/70 group-hover:text-vendor-foreground transition-colors shrink-0 mt-1" />
    </Link>
  )
}

// ── Bid row (My Bids / History tabs) ────────────────────────────────────────────

function BidRow({ bid, showOutcome }: { bid: PartnerBidRow; showOutcome: boolean }) {
  const b = badge(bid.status)
  const budget = formatBudgetForDisplay(bid.budget_proposal)
  const submitted = formatDate(bid.submitted_at)
  const agencyName = bid.agency_company_name || bid.agency_full_name || "Agency"
  const isTerminal = TERMINAL_BID_STATUSES.has(bid.status)

  const content = (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="font-display font-bold text-vendor-foreground truncate">{bid.scope_item_name || "Scope"}</span>
        <span className={cn(
          "font-mono text-2xs px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
          b.bg, b.border, b.text
        )}>
          {b.label}
        </span>
        {showOutcome && (
          <span className={cn(
            "font-mono text-2xs px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0",
            !isTerminal
              ? "bg-gray-100 border-vendor-border text-vendor-muted"
              : bid.status === "awarded"
                ? "bg-success/15 border-success/30 text-success"
                : "bg-red-50 border-red-200 text-red-700"
          )}>
            {!isTerminal ? "In Progress" : bid.status === "awarded" ? "Won" : "Lost"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 font-mono text-2xs text-vendor-muted flex-wrap">
        <span className="flex items-center gap-1">
          <Building2 className="w-3 h-3" />
          {agencyName}
        </span>
        {bid.client_name && (
          <>
            <span className="text-vendor-muted/50">·</span>
            <span>{bid.client_name}</span>
          </>
        )}
        {budget !== "-" && (
          <>
            <span className="text-vendor-muted/50">·</span>
            <span>{budget}</span>
          </>
        )}
        {submitted && (
          <>
            <span className="text-vendor-muted/50">·</span>
            <span>Submitted {submitted}</span>
          </>
        )}
      </div>
    </div>
  )

  if (bid.inbox_item_id) {
    return (
      <Link
        href={`/partner/rfps/${bid.inbox_item_id}`}
        className="flex items-start gap-4 p-4 rounded-xl border border-vendor-border bg-vendor-surface hover:border-vendor-foreground/40 hover:shadow-sm transition-all group"
      >
        {content}
        <ChevronRight className="w-4 h-4 text-vendor-muted/70 group-hover:text-vendor-foreground transition-colors shrink-0 mt-1" />
      </Link>
    )
  }
  return <div className="flex items-start gap-4 p-4 rounded-xl border border-vendor-border bg-vendor-surface">{content}</div>
}

function BidsList({ bids, showOutcome, emptyMessage, emptyDetail }: { bids: PartnerBidRow[]; showOutcome: boolean; emptyMessage: string; emptyDetail?: string | null }) {
  if (bids.length === 0) {
    return (
      <div className="bg-vendor-surface rounded-xl border border-vendor-border p-12 text-center">
        <div className="font-display font-bold text-xl text-vendor-foreground mb-2">No bids yet</div>
        <p className="text-vendor-muted-strong">{emptyMessage}</p>
        {/* Only rendered for an account that actually has a lead agency side. See
            lib/vendor-empty-copy.ts for why it is conditional rather than unconditional. */}
        {emptyDetail && <p className="text-vendor-muted-strong mt-3 max-w-lg mx-auto">{emptyDetail}</p>}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {bids.map((bid) => (
        <BidRow key={bid.id} bid={bid} showOutcome={showOutcome} />
      ))}
    </div>
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
    <div className="rounded-xl border border-vendor-border bg-vendor-background/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 p-5 hover:bg-gray-100/60 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-lg bg-vendor-foreground/10 flex items-center justify-center shrink-0">
          {groupBy === "agency"
            ? <Building2 className="w-5 h-5 text-vendor-foreground" />
            : <FileText className="w-5 h-5 text-vendor-foreground" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-xl text-vendor-foreground">{label}</div>
          <div className="font-mono text-2xs text-vendor-muted mt-0.5">
            {rows.length} RFP{rows.length !== 1 ? "s" : ""}
            {(counts["awarded"] ?? 0) > 0 && (
              <span className="ml-2 text-success">· {counts["awarded"]} awarded</span>
            )}
          </div>
        </div>
        <div className={cn("transition-transform shrink-0", open && "rotate-180")}>
          <ChevronDown className="w-5 h-5 text-vendor-muted/70" />
        </div>
      </button>

      {open && (
        <div className="border-t border-vendor-border bg-vendor-surface">
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
                    "shrink-0 px-2.5 py-1 rounded-lg font-mono text-2xs transition-colors whitespace-nowrap",
                    activeStatus === key
                      ? "bg-vendor-foreground text-white"
                      : "bg-gray-100 text-vendor-muted hover:bg-gray-200"
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
              <p className="text-sm text-vendor-muted py-4 text-center">No RFPs match this filter.</p>
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

// ── Flat status view (used when groupBy==="status") ─────────────────────────

function FlatStatusView({ allRows }: { allRows: PartnerInboxRow[] }) {
  const [activeStatus, setActiveStatus] = useState<RFPStatusKey>("all")

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: allRows.length }
    for (const r of allRows) {
      const tab = normaliseForTab(rowStatus(r))
      map[tab] = (map[tab] || 0) + 1
    }
    return map
  }, [allRows])

  const filtered = useMemo(
    () => activeStatus === "all"
      ? allRows
      : allRows.filter(r => normaliseForTab(rowStatus(r)) === activeStatus),
    [allRows, activeStatus]
  )

  return (
    <div className="bg-vendor-surface rounded-xl border border-vendor-border overflow-hidden">
      <div className="flex gap-1 flex-wrap px-4 pt-4 pb-3 border-b border-vendor-border/50">
        {RFP_STATUSES.map(({ key, label: tabLabel }) => {
          const count = key === "all" ? allRows.length : (counts[key] ?? 0)
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveStatus(key)}
              className={cn(
                "shrink-0 px-2.5 py-1 rounded-lg font-mono text-2xs transition-colors whitespace-nowrap",
                activeStatus === key
                  ? "bg-vendor-foreground text-white"
                  : "bg-gray-100 text-vendor-muted hover:bg-gray-200"
              )}
            >
              {tabLabel} ({count})
            </button>
          )
        })}
      </div>
      <div className="p-4 space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-vendor-muted py-4 text-center">No RFPs match this filter.</p>
        ) : (
          filtered.map(row => (
            <RFPCard key={row.id} row={row} showAgency={true} />
          ))
        )}
      </div>
    </div>
  )
}

// ── The shared surface ────────────────────────────────────────────────────────

/**
 * WHICH OF THE TWO WORKFLOW STAGES THIS RENDER IS.
 *
 * "rfps"  stage 01, Open RFPs      - invitations, read from partner_rfp_inbox
 * "bids"  stage 02, My Bids        - submissions, read from partner_rfp_responses
 *
 * One component serves both because they were one page until this split and the row
 * renderers, the status vocabulary and the deadline logic are genuinely shared. Two copies
 * would be two definitions of a bid status, which is how the surfaces drift apart.
 */
export type RfpSurface = "rfps" | "bids"

function PartnerRFPsContent({ surface }: { surface: RfpSurface }) {
  const searchParams = useSearchParams()
  const inviteStatus = (searchParams.get("invite_status") || "").trim()

  const inviteToken = (searchParams.get("invite") || "").trim()
  const ndaParam = searchParams.get("nda")

  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("agency")
  // THE STAGE DECIDES THE TAB, not the other way round. `/partner/rfps` opens on the
  // invitations and `/partner/bids` opens on the submissions, and neither page can reach the
  // other's tab - the nav does that now. No URL selected a tab before this split (the state
  // was plain useState with no query parameter), so nothing that worked yesterday stops.
  const [activeTab, setActiveTab] = useState<RfpTab>(surface === "bids" ? "my-bids" : "open")

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

  // WHY THE SIGNUP ROLE IS READ ON A VENDOR PAGE. `role` is the role chosen at signup and it
  // never changes; anyone rendering this page is acting as a partner. So `role === "agency"`
  // here means "this account also runs a lead agency", which is exactly the population whose
  // vendor list stopped showing their own outbound broadcasts. See lib/vendor-empty-copy.ts.
  const { role: signupRole } = usePaidUser()
  const emptyDetail = vendorInboxEmptyDetail(signupRole)

  const { data, isLoading, error } = useFetch<{ rfps: PartnerInboxRow[] }>("/api/partner/rfps")
  const allRows: PartnerInboxRow[] = data?.rfps ?? []

  const { data: bidsData, isLoading: bidsLoading, error: bidsError } = useFetch<{ bids: PartnerBidRow[] }>("/api/partner/rfps/bids")
  const allBids: PartnerBidRow[] = bidsData?.bids ?? []
  const myBids = useMemo(() => allBids.filter((b) => !TERMINAL_BID_STATUSES.has(b.status)), [allBids])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? allRows.filter(r => {
          const hay = [r.agency_company_name, r.scope_item_name, r.client_name].join(" ").toLowerCase()
          return hay.includes(q)
        })
      : allRows

    const map = new Map<string, PartnerInboxRow[]>()
    for (const r of filtered) {
      const key = groupBy === "agency"
        ? (r.agency_company_name || "Unknown Agency").trim()
        : groupBy === "client"
          ? ((r.client_name || "").trim() || "-")
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

  // The group noun, singular and plural, spelled out per group type rather than built by
  // appending "s". Appending produced "2 agencys" and would have produced "2 statuss" the
  // moment somebody grouped by status - the same bug twice in one template, which is why
  // this is a table and not a fix to one branch of a ternary.
  const GROUP_NOUN: Record<GroupBy, { one: string; many: string }> = {
    agency: { one: "agency", many: "agencies" },
    client: { one: "client", many: "clients" },
    status: { one: "status", many: "statuses" },
  }
  const groupNoun = totalGroups === 1 ? GROUP_NOUN[groupBy].one : GROUP_NOUN[groupBy].many

  return (
    <PartnerLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          {/*
            PHASE 4 SPLIT. "Open RFPs & Bids" was the only vendor nav item that combined two
            of the four shared workflow stages, and it was the only thing breaking the 1:1
            mirror with the lead agency nav. The heading is now the stage, not the pair.
          */}
          <h1 className="font-display font-bold text-3xl text-vendor-foreground">
            {surface === "rfps" ? "Open RFPs" : "My Bids"}
          </h1>
          <p className="text-vendor-muted-strong mt-1">
            {activeTab === "open"
              ? isLoading
                ? "Loading…"
                : `${totalRfps} RFP${totalRfps !== 1 ? "s" : ""} across ${totalGroups} ${groupNoun}`
              : activeTab === "my-bids"
                ? "Bids you have submitted that are still awaiting an outcome"
                : "Every bid you have submitted, including awarded and declined"
            }
          </p>
        </div>

        {/*
          WHERE HISTORY WENT, AND WHY.

          History travels with My Bids, not with Open RFPs. Three reasons, in the order they
          decided it:

          1. THE ENTITY. Open RFPs reads `partner_rfp_inbox` - invitations that arrived. My
             Bids and History both read `partner_rfp_responses` through
             /api/partner/rfps/bids - submissions this vendor made. History is the same list
             as My Bids with the terminal statuses put back in (see TERMINAL_BID_STATUSES);
             it is literally `allBids` where My Bids is `allBids` filtered. Splitting a filter
             away from the thing it filters would put one entity on two nav items.
          2. THE MIRROR. The lead agency reads awarded and declined bids inside 02 Bid
             Management, not inside 01 RFP Broadcast. Putting vendor History anywhere but 02
             would break the 1:1 this split exists to create.
          3. WHAT IT ANSWERS. "Did I win?" is a question about a bid. An RFP whose deadline
             passed without a bid never becomes history here at all - it stays an inbox row.

          So the strip below renders ONLY on /partner/bids and carries two entries. Stage 01
          has a single view and therefore no tabs.
        */}
        {surface === "bids" && (
        <div className="flex rounded-lg overflow-hidden border border-vendor-border w-fit">
          {([
            { key: "my-bids", label: "My Bids" },
            { key: "history", label: "History" },
          ] as { key: RfpTab; label: string }[]).map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "px-4 py-2 font-mono text-2xs uppercase tracking-wider transition-colors",
                activeTab === t.key
                  ? "bg-vendor-foreground text-white"
                  : "bg-vendor-surface text-vendor-muted hover:bg-vendor-background"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        )}

        {inviteStatus === "failed" && activeTab === "open" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            Your invite may have expired or already been claimed. Active RFPs are still shown below.
          </div>
        )}

        {activeTab === "open" && (
          <>
            {/* Search + group-by */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vendor-muted/70" />
                <Input
                  placeholder="Search agency or scope…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10 bg-vendor-surface border-vendor-border text-vendor-foreground placeholder:text-vendor-muted/70"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-2xs text-vendor-muted/70 uppercase tracking-wider">Group by</span>
                <div className="flex rounded-lg overflow-hidden border border-vendor-border">
                  {(["agency", "client", "status"] as GroupBy[]).map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGroupBy(g)}
                      className={cn(
                        "px-3 py-1.5 font-mono text-2xs uppercase tracking-wider transition-colors",
                        groupBy === g
                          ? "bg-vendor-foreground text-white"
                          : "bg-vendor-surface text-vendor-muted hover:bg-vendor-background"
                      )}
                    >
                      {g === "agency" ? "Agency" : g === "client" ? "Client" : "Status"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Content */}
            {isLoading && (
              <div className="flex items-center justify-center py-12 gap-3 text-vendor-muted">
                <Loader2 className="w-5 h-5 animate-spin text-vendor-foreground" />
                <span className="font-mono text-sm">Loading RFPs…</span>
              </div>
            )}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Failed to load RFPs. Please refresh.
              </div>
            )}
            {/*
              THE HONEST EMPTY STATE, 086 PRECEDENT.

              A vendor who has received nothing and a vendor whose rows were wrongly filtered
              see the same screen. This one says which question was asked - "RFPs sent TO
              you" - and, for an account that also runs a lead agency, where the other answer
              is. That second line is conditional on the caller actually having an agency
              side, because saying it to a vendor-only account would be false.

              The search case stays separate and unchanged: "no results for this search" is
              already an honest and different statement from "you have received none".
            */}
            {!isLoading && !error && groups.length === 0 && (
              <div className="bg-vendor-surface rounded-xl border border-vendor-border p-12 text-center">
                <div className="font-display font-bold text-xl text-vendor-foreground mb-2">
                  {search ? "No results" : VENDOR_RFPS_EMPTY.title}
                </div>
                <p className="text-vendor-muted-strong">
                  {search ? "Try a different search term." : VENDOR_RFPS_EMPTY.body}
                </p>
                {!search && emptyDetail && (
                  <p className="text-vendor-muted-strong mt-3 max-w-lg mx-auto">{emptyDetail}</p>
                )}
              </div>
            )}
            {!isLoading && groups.length > 0 && groupBy !== "status" && (
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
            {!isLoading && groups.length > 0 && groupBy === "status" && (
              <FlatStatusView allRows={groups.flatMap(g => g.rows)} />
            )}
          </>
        )}

        {activeTab === "my-bids" && (
          <>
            {bidsLoading && (
              <div className="flex items-center justify-center py-12 gap-3 text-vendor-muted">
                <Loader2 className="w-5 h-5 animate-spin text-vendor-foreground" />
                <span className="font-mono text-sm">Loading bids…</span>
              </div>
            )}
            {bidsError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Failed to load bids. Please refresh.
              </div>
            )}
            {!bidsLoading && !bidsError && (
              <BidsList
                bids={myBids}
                showOutcome={false}
                emptyMessage={VENDOR_BIDS_OPEN_EMPTY}
                emptyDetail={emptyDetail}
              />
            )}
          </>
        )}

        {activeTab === "history" && (
          <>
            {bidsLoading && (
              <div className="flex items-center justify-center py-12 gap-3 text-vendor-muted">
                <Loader2 className="w-5 h-5 animate-spin text-vendor-foreground" />
                <span className="font-mono text-sm">Loading bids…</span>
              </div>
            )}
            {bidsError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Failed to load bids. Please refresh.
              </div>
            )}
            {!bidsLoading && !bidsError && (
              <BidsList bids={allBids} showOutcome emptyMessage={VENDOR_BIDS_HISTORY_EMPTY} emptyDetail={emptyDetail} />
            )}
          </>
        )}
      </div>
    </PartnerLayout>
  )
}

/**
 * Suspense is required, not decorative: useSearchParams() opts the tree into client-side
 * rendering and Next fails the build without a boundary.
 */
export function PartnerRfpSurface({ surface }: { surface: RfpSurface }) {
  return (
    <Suspense>
      <PartnerRFPsContent surface={surface} />
    </Suspense>
  )
}
