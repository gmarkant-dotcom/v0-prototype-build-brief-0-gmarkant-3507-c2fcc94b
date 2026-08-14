import { parseDoubleJson } from "@/lib/active-engagement-parse"

// Shared by both directions of the tiered profile:
//   app/api/agency/pool/[partnerId]/route.ts   - agency looking at a vendor
//   app/api/partner/network/[agencyId]/route.ts - vendor looking at a lead agency
//
// Both render the same list ("what work have we actually done together"), so it has one
// definition here rather than one per direction. The two routes differ only in which side
// of the pair they key the query to.

type BudgetJson = { amount?: number; currency?: string }

export function parseAwardedBudget(raw: unknown): { amount: number; currency: string } | null {
  const o = parseDoubleJson<BudgetJson>(raw)
  if (!o || o.amount == null || !Number.isFinite(Number(o.amount))) return null
  const currency =
    typeof o.currency === "string" && o.currency.trim() ? o.currency.trim().toUpperCase() : "USD"
  return { amount: Number(o.amount), currency }
}

export function unwrapInbox(raw: unknown): {
  scope_item_name: string | null
  project_id: string | null
  master_rfp_json: unknown
} | null {
  if (!raw) return null
  const row = Array.isArray(raw) ? raw[0] : raw
  if (!row || typeof row !== "object") return null
  const o = row as { scope_item_name?: string | null; project_id?: string | null; master_rfp_json?: unknown }
  return {
    scope_item_name: o.scope_item_name != null ? String(o.scope_item_name) : null,
    project_id: o.project_id != null ? String(o.project_id) : null,
    master_rfp_json: o.master_rfp_json ?? null,
  }
}

// `projects` has a `name` column and no `title` column - confirmed read-only against the
// live database on 2026-08-14: `select=id,name,title` returns 42703 "column projects.title
// does not exist", `select=id,name` returns rows. Anything selecting `title` here fails the
// whole query and silently degrades every project name to the master_rfp_json fallback.
export function projectNameFromInbox(
  inbox: NonNullable<ReturnType<typeof unwrapInbox>>,
  projectRow: { name?: string | null } | undefined
): string {
  const fromProj = (projectRow?.name || "").trim()
  if (fromProj) return fromProj
  const j = inbox.master_rfp_json as Record<string, unknown> | null
  const n = j?.projectName
  return typeof n === "string" && n.trim() ? n.trim() : "Project"
}

export type EngagementHistoryEntry = {
  id: string
  status: string
  scope_item_name: string
  project_name: string
  awarded_amount: number | null
  currency: string
}

/**
 * Turns awarded `partner_rfp_responses` rows (with an embedded `partner_rfp_inbox`) into the
 * shared engagement list. `projectMeta` is keyed by project id; an absent entry just means the
 * name falls back to the RFP payload.
 */
export function buildEngagementHistory(
  respRows: unknown[] | null,
  projectMeta: Map<string, { name: string | null }>
): EngagementHistoryEntry[] {
  return (respRows || []).map((r) => {
    const inbox = unwrapInbox((r as { partner_rfp_inbox?: unknown }).partner_rfp_inbox)
    const pid = inbox?.project_id ?? null
    const meta = pid ? projectMeta.get(pid) : undefined
    const parsed = parseAwardedBudget((r as { budget_proposal?: unknown }).budget_proposal)
    return {
      id: String((r as { id: string }).id),
      status: String((r as { status?: string }).status || "awarded"),
      scope_item_name: inbox?.scope_item_name?.trim() || "Scope",
      project_name: inbox ? projectNameFromInbox(inbox, meta) : "Project",
      awarded_amount: parsed?.amount ?? null,
      currency: parsed?.currency ?? "USD",
    }
  })
}
