/**
 * Budget structure (Phase 2, P2-1). One module for the shape, the presets, the parsers, and
 * the arithmetic, imported by the agency wizard, the magic-link flow, both bid forms, and
 * every agency-side read surface - so the number a vendor types, the number the sticky
 * readiness bar counts, and the number the compare view prints all come from one place.
 *
 * Storage (migration 072, re-authored - see docs/p2-reconciliation.md section 3):
 *   wizard flow     -> partner_rfp_inbox.master_rfp_json.budget_categories
 *   magic-link flow -> rfp_magic_tokens.budget_categories
 *   vendor's numbers-> partner_rfp_responses.budget_lines
 *
 * Everything here treats a missing column, a null, and an empty array identically: the RFP
 * simply does not use budget categories, and every surface renders exactly as it did before
 * this feature existed. That is what makes the whole feature pre-migration safe.
 */

import { CURRENCY_SYMBOLS } from "@/lib/rfp-response-fields"

export type BudgetCategoryOrigin = string

export type BudgetCategory = {
  /** Stable id, generated once when the category is authored and never reused. This is what
   *  survives the broadcast fan-out (one master_rfp_json copy per inbox row) with its identity
   *  intact, and what a vendor's budget line points back at. */
  key: string
  name: string
  /** Optional agency guidance rendered under the category on the bid form. */
  note: string | null
  /** 'preset:<bundle>:<slug>' | 'custom' | 'paste' - provenance only, never behavior. */
  origin: BudgetCategoryOrigin
  /** Exactly one category per RFP carries this. Always sorted last, always flagged. */
  is_additional_items: boolean
  sort_order: number
}

export type BudgetLineItem = {
  description: string
  amount: number
}

export type BudgetLineCategory = {
  key: string
  /** The category name as it read when the bid was submitted. An agency can rename a category
   *  afterwards; the vendor's own bid must keep saying what they answered. */
  name_snapshot: string
  /** Honest 0 is a complete, meaningful answer (the container test) - it is not "unanswered".
   *  Unanswered is the absence of the whole entry. */
  subtotal: number
  /** Empty when the vendor gave a single subtotal. Non-empty when they itemized, in which case
   *  subtotal is the computed sum and is read-only everywhere. */
  items: BudgetLineItem[]
}

export type BudgetLines = {
  /** Snapshot of the bid's currency code at submit time. Never converted across bids. */
  currency: string
  categories: BudgetLineCategory[]
}

export const ADDITIONAL_ITEMS_NAME = "Additional items"
export const ADDITIONAL_ITEMS_NOTE =
  "Anything this budget does not have a category for. Leave at 0 if there is nothing to add."

/** Guidance only, never enforced - judgment call 4, adopted as the plan recommends. */
export const BUDGET_CATEGORY_SOFT_MIN = 5
export const BUDGET_CATEGORY_SOFT_MAX = 10

export type PresetBundle = {
  slug: string
  label: string
  description: string
  categories: { slug: string; name: string; note?: string }[]
}

/**
 * Three named bundles, per this run's instruction (the Aug 5 plan proposed one flat list of
 * nine; judgment call 3 resolves toward the newer wording). Standard production is the plan's
 * nine names almost verbatim. Copy lives here so it is one edit, per the plan's own intent
 * that Greg owns the wording.
 */
export const PRESET_BUNDLES: PresetBundle[] = [
  {
    slug: "standard_production",
    label: "Standard production",
    description: "Full production shoot. Nine categories covering crew, cast, kit, and post.",
    categories: [
      { slug: "production", name: "Production" },
      { slug: "post_production", name: "Post-production" },
      { slug: "talent", name: "Talent and cast" },
      { slug: "location", name: "Location" },
      { slug: "equipment", name: "Equipment" },
      { slug: "crew", name: "Crew" },
      { slug: "travel", name: "Travel and per diem" },
      { slug: "contingency", name: "Contingency" },
      { slug: "agency_fee", name: "Agency fee" },
    ],
  },
  {
    slug: "retainer",
    label: "Retainer",
    description: "Ongoing monthly engagement. Rate, hours, and what sits outside the retainer.",
    categories: [
      { slug: "monthly_retainer", name: "Monthly retainer" },
      { slug: "included_hours", name: "Included hours" },
      { slug: "overage_rate", name: "Overage rate" },
      { slug: "pass_through", name: "Pass-through costs" },
    ],
  },
  {
    slug: "project_fee",
    label: "Project fee",
    description: "Fixed-fee project. Fee, expenses, and revisions priced separately.",
    categories: [
      { slug: "project_fee", name: "Project fee" },
      { slug: "expenses", name: "Expenses" },
      { slug: "revisions", name: "Revisions" },
    ],
  },
]

let keyCounter = 0
/** Client-generated, collision-resistant enough for a list an agency types by hand. Not a uuid
 *  on purpose - this key lands inside JSONB and is read by humans debugging a bid. */
export function makeCategoryKey(seed?: string): string {
  keyCounter += 1
  const base = (seed || "cat")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
  return `${base || "cat"}_${Date.now().toString(36)}${keyCounter.toString(36)}`
}

function coerceString(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function coerceAmount(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""))
  if (!Number.isFinite(n)) return 0
  // Two decimal places, matching the numeric(12,2) the relational draft used and the precision
  // CurrencyInput accepts.
  return Math.round(n * 100) / 100
}

/** Tolerates null, undefined, a missing column, a JSON string, or a malformed array. */
export function normalizeBudgetCategories(raw: unknown): BudgetCategory[] {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const out: BudgetCategory[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const name = coerceString(e.name).trim()
    if (!name) continue
    const key = coerceString(e.key).trim() || makeCategoryKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    const note = coerceString(e.note).trim()
    out.push({
      key,
      name,
      note: note || null,
      origin: coerceString(e.origin).trim() || "custom",
      is_additional_items: e.is_additional_items === true,
      sort_order: typeof e.sort_order === "number" ? e.sort_order : out.length,
    })
  }
  return sortCategories(out)
}

/** Additional items always renders last regardless of its stored sort_order. */
export function sortCategories(categories: BudgetCategory[]): BudgetCategory[] {
  return [...categories].sort((a, b) => {
    if (a.is_additional_items !== b.is_additional_items) return a.is_additional_items ? 1 : -1
    return a.sort_order - b.sort_order
  })
}

export function makeAdditionalItemsCategory(sortOrder: number): BudgetCategory {
  return {
    key: makeCategoryKey("additional_items"),
    name: ADDITIONAL_ITEMS_NAME,
    note: ADDITIONAL_ITEMS_NOTE,
    origin: "system",
    is_additional_items: true,
    sort_order: sortOrder,
  }
}

/**
 * The always-present flagged category. Added the moment an RFP has any category at all, never
 * added to an RFP that uses no categories (that would turn "no budget structure" into "one
 * category", which is a different RFP).
 */
export function ensureAdditionalItems(categories: BudgetCategory[]): BudgetCategory[] {
  if (categories.length === 0) return []
  if (categories.some((c) => c.is_additional_items)) return sortCategories(categories)
  return sortCategories([...categories, makeAdditionalItemsCategory(categories.length)])
}

export function resequence(categories: BudgetCategory[]): BudgetCategory[] {
  return sortCategories(categories).map((c, i) => ({ ...c, sort_order: i }))
}

// ---------------------------------------------------------------------------------------
// Paste parsing
// ---------------------------------------------------------------------------------------

export type ParseSkip = { line: number; text: string; reason: string }

/**
 * Category seeding, paste-first (per this run's instruction; no upload infrastructure is built).
 * Two columns: name, then an optional note. Tab-separated first, comma as a fallback for a
 * pasted CSV row, so pasting out of a spreadsheet or out of a .csv both work with no file
 * input at all.
 *
 * Skip-and-flag on a bad line, never reject the whole paste - judgment call 5, matching
 * spreadsheet-import-panel.tsx's grouped-review house style.
 */
export function parseCategoryPaste(text: string): { categories: BudgetCategory[]; skipped: ParseSkip[] } {
  const categories: BudgetCategory[] = []
  const skipped: ParseSkip[] = []
  const seenNames = new Set<string>()
  const lines = (text || "").split(/\r?\n/)
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim()
    if (!line) return
    const sep = rawLine.includes("\t") ? "\t" : rawLine.includes(",") ? "," : null
    const name = (sep ? rawLine.slice(0, rawLine.indexOf(sep)) : rawLine).trim()
    const note = sep ? rawLine.slice(rawLine.indexOf(sep) + 1).trim() : ""
    if (!name) {
      skipped.push({ line: i + 1, text: line, reason: "No category name" })
      return
    }
    const lowered = name.toLowerCase()
    if (seenNames.has(lowered)) {
      skipped.push({ line: i + 1, text: line, reason: "Duplicate of an earlier line" })
      return
    }
    seenNames.add(lowered)
    categories.push({
      key: makeCategoryKey(name),
      name,
      note: note || null,
      origin: "paste",
      is_additional_items: false,
      sort_order: categories.length,
    })
  })
  return { categories, skipped }
}

/**
 * Strips every symbol in the shared CURRENCY_SYMBOLS map, plus commas and whitespace.
 *
 * Judgment call 6: the Aug 5 plan said USD-style only. G2 has since shipped CURRENCY_SYMBOLS as
 * the one currency-symbol source, consumed by the shared CurrencyInput, so hardcoding a
 * $-only stripper here would be a second source for the same fact. Resolved toward the newer
 * component: strip anything in that map. Locale decimal-comma grammar ("1.234,56") is still
 * NOT guessed - it returns null and the line is flagged - which is the actual substance of the
 * plan's "no": do not invent numeric grammars.
 */
export function parsePastedAmount(raw: string): number | null {
  let s = (raw || "").trim()
  if (!s) return null
  for (const symbol of new Set(Object.values(CURRENCY_SYMBOLS))) {
    s = s.split(symbol).join("")
  }
  s = s.replace(/[\s,]/g, "")
  const negative = /^\(.*\)$/.test(s)
  if (negative) s = s.slice(1, -1)
  if (!/^-?\d*\.?\d+$/.test(s)) return null
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return null
  return Math.round((negative ? -n : n) * 100) / 100
}

/** Itemization paste: tab-separated label + amount, one line per sub-line. Comma fallback uses
 *  the LAST comma, so "Camera package, 3 days" keeps its comma in the label. */
export function parseBudgetLinePaste(text: string): { items: BudgetLineItem[]; skipped: ParseSkip[] } {
  const items: BudgetLineItem[] = []
  const skipped: ParseSkip[] = []
  const lines = (text || "").split(/\r?\n/)
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim()
    if (!line) return
    let description = ""
    let amountRaw = ""
    if (rawLine.includes("\t")) {
      const idx = rawLine.indexOf("\t")
      description = rawLine.slice(0, idx).trim()
      amountRaw = rawLine.slice(idx + 1).trim()
    } else if (rawLine.includes(",")) {
      const idx = rawLine.lastIndexOf(",")
      description = rawLine.slice(0, idx).trim()
      amountRaw = rawLine.slice(idx + 1).trim()
    } else {
      skipped.push({ line: i + 1, text: line, reason: "No amount column (use a tab between label and amount)" })
      return
    }
    if (!description) {
      skipped.push({ line: i + 1, text: line, reason: "No description" })
      return
    }
    const amount = parsePastedAmount(amountRaw)
    if (amount == null) {
      skipped.push({ line: i + 1, text: line, reason: `"${amountRaw}" is not a number we can read` })
      return
    }
    items.push({ description, amount })
  })
  return { items, skipped }
}

// ---------------------------------------------------------------------------------------
// Arithmetic and readiness
// ---------------------------------------------------------------------------------------

export function sumItems(items: BudgetLineItem[]): number {
  return Math.round(items.reduce((total, item) => total + (Number.isFinite(item.amount) ? item.amount : 0), 0) * 100) / 100
}

/** One source per number: an itemized category's subtotal is always its items' sum, never a
 *  separately editable figure that could disagree with them. */
export function categorySubtotal(entry: BudgetLineCategory): number {
  return entry.items.length > 0 ? sumItems(entry.items) : entry.subtotal
}

export function budgetLinesTotal(lines: BudgetLines | null): number {
  if (!lines) return 0
  return Math.round(lines.categories.reduce((total, c) => total + categorySubtotal(c), 0) * 100) / 100
}

export function normalizeBudgetLines(raw: unknown): BudgetLines | null {
  let value = raw
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const rawCategories = Array.isArray(v.categories) ? v.categories : []
  const categories: BudgetLineCategory[] = []
  for (const entry of rawCategories) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const key = coerceString(e.key).trim()
    if (!key) continue
    const items: BudgetLineItem[] = []
    if (Array.isArray(e.items)) {
      for (const item of e.items) {
        if (!item || typeof item !== "object") continue
        const it = item as Record<string, unknown>
        const description = coerceString(it.description).trim()
        if (!description) continue
        items.push({ description, amount: coerceAmount(it.amount) })
      }
    }
    categories.push({
      key,
      name_snapshot: coerceString(e.name_snapshot).trim() || key,
      subtotal: items.length > 0 ? sumItems(items) : coerceAmount(e.subtotal),
      items,
    })
  }
  if (categories.length === 0) return null
  return { currency: coerceString(v.currency).trim() || "USD", categories }
}

/**
 * Completeness for the sticky readiness bar and the submit gate. A category is complete when
 * the vendor has entered something for it - including an honest 0, which the container test
 * says is a real answer. Incomplete means no entry at all, which is what an empty input is.
 *
 * `entered` is the set of category keys the form has a value for, passed in by the bid form
 * rather than inferred from BudgetLines, because a form field holding "" is a different state
 * from a saved subtotal of 0 and only the form knows which it is looking at.
 */
export function countCategoryCompleteness(
  categories: BudgetCategory[],
  enteredKeys: Set<string>
): { total: number; complete: number; open: number } {
  const total = categories.length
  let complete = 0
  for (const c of categories) if (enteredKeys.has(c.key)) complete += 1
  return { total, complete, open: Math.max(0, total - complete) }
}

export function categoriesSummaryLabel(total: number, complete: number): string {
  if (total === 0) return ""
  return `${complete} of ${total} categories`
}

// ---------------------------------------------------------------------------------------
// Bid-form draft state
// ---------------------------------------------------------------------------------------

/**
 * What a bid form actually holds while the vendor types. Amounts stay strings because that is
 * what CurrencyInput speaks (raw digits, no symbol or commas) and because "" has to stay
 * distinguishable from "0" - the first is unanswered, the second is an honest zero.
 */
export type BudgetDraftEntry = {
  subtotal: string
  items: { description: string; amount: string }[]
  /** Itemized categories derive their subtotal from items and render it read-only. */
  itemized: boolean
}

export type BudgetDraft = Record<string, BudgetDraftEntry>

const EMPTY_ENTRY: BudgetDraftEntry = { subtotal: "", items: [], itemized: false }

export function emptyBudgetDraft(categories: BudgetCategory[]): BudgetDraft {
  const draft: BudgetDraft = {}
  for (const c of categories) draft[c.key] = { ...EMPTY_ENTRY, items: [] }
  return draft
}

/** Rehydrates a saved bid (or an autosaved draft) into form state. Categories the saved bid has
 *  no entry for come back empty rather than zeroed - the agency may have added a category after
 *  the vendor last saved, and inventing a 0 there would be fabricated data. */
export function seedBudgetDraft(categories: BudgetCategory[], lines: BudgetLines | null): BudgetDraft {
  const draft = emptyBudgetDraft(categories)
  if (!lines) return draft
  for (const saved of lines.categories) {
    if (!draft[saved.key]) continue
    const itemized = saved.items.length > 0
    draft[saved.key] = {
      itemized,
      items: saved.items.map((i) => ({ description: i.description, amount: String(i.amount) })),
      subtotal: itemized ? "" : String(saved.subtotal),
    }
  }
  return draft
}

function draftAmount(raw: string): number | null {
  const t = (raw ?? "").trim()
  if (!t) return null
  const n = parseFloat(t.replace(/,/g, ""))
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

/** An itemized category is answered once it has at least one readable item; a plain one is
 *  answered once its subtotal parses, including to 0. */
export function draftEntryTotal(entry: BudgetDraftEntry | undefined): number | null {
  if (!entry) return null
  if (entry.itemized) {
    const amounts = entry.items.map((i) => draftAmount(i.amount)).filter((n): n is number => n != null)
    if (amounts.length === 0) return null
    return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100
  }
  return draftAmount(entry.subtotal)
}

export function draftEnteredKeys(draft: BudgetDraft): Set<string> {
  const keys = new Set<string>()
  for (const [key, entry] of Object.entries(draft)) if (draftEntryTotal(entry) != null) keys.add(key)
  return keys
}

export function draftGrandTotal(categories: BudgetCategory[], draft: BudgetDraft): number {
  let total = 0
  for (const c of categories) total += draftEntryTotal(draft[c.key]) ?? 0
  return Math.round(total * 100) / 100
}

/**
 * Form state to stored shape. Returns null when the RFP has no categories or the vendor has
 * answered none of them, so an untouched bid never writes an empty structure that later reads
 * as "they filled this in with nothing".
 */
export function buildBudgetLinesForSave(
  categories: BudgetCategory[],
  draft: BudgetDraft,
  currency: string
): BudgetLines | null {
  if (categories.length === 0) return null
  const out: BudgetLineCategory[] = []
  for (const category of categories) {
    const entry = draft[category.key]
    const total = draftEntryTotal(entry)
    if (total == null) continue
    const items =
      entry?.itemized
        ? entry.items
            .map((i) => ({ description: i.description.trim(), amount: draftAmount(i.amount) }))
            .filter((i): i is { description: string; amount: number } => Boolean(i.description) && i.amount != null)
        : []
    out.push({
      key: category.key,
      name_snapshot: category.name,
      subtotal: items.length > 0 ? sumItems(items) : total,
      items,
    })
  }
  if (out.length === 0) return null
  return { currency: currency || "USD", categories: out }
}

/** Reads categories off whichever RFP-flow record the caller has. Both locations are optional
 *  and both are absent before migration 072, which is simply "this RFP has no categories". */
export function readCategoriesFromMasterRfpJson(masterRfpJson: unknown): BudgetCategory[] {
  if (!masterRfpJson || typeof masterRfpJson !== "object") return []
  return normalizeBudgetCategories((masterRfpJson as Record<string, unknown>).budget_categories)
}
