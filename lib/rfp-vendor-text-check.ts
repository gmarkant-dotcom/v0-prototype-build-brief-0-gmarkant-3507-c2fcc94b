/**
 * Ruling OV-A (2026-10-15): WARN AT SEND, NEVER BLOCK.
 *
 * Step C closed live leak #8 at the field level: no vendor copy field carries the client, the rubric,
 * other lines or an unreleased budget (lib/rfp-vendor-copy.ts). The remaining exposure is the free
 * text the agency writes itself (finding B2): an overview that names the client while the client is
 * hidden, or a programme total and fee percentage in text every vendor reads.
 *
 * This module is the ONE detection function. It is pure (no I/O, no React), so the same rules run in
 * the send screens (debounced as the agency edits, no server call), in the two send routes (returned
 * to the agency as warnings, never as a refusal) and in the bids list for RFPs already sent.
 *
 * WHAT IS FLAGGED
 *  1. The client's identity, ONLY while the client is hidden from vendors: every name passed in
 *     (the project's client name, the client profile's name, any alias), case-insensitive, on word
 *     boundaries, with or without punctuation between its words ("Coca-Cola", "Coca Cola",
 *     "CocaCola"), "&" read as "and" too, and with a trailing company suffix (Inc, LLC, Ltd...) made
 *     optional. A name must hold at least two letters or digits; a one-character name is ignored.
 *  2. Money and percentages: currency amounts ($250,000, EUR 40k, 1.2m USD), numbers with a k / m / M
 *     / bn suffix (250k, 1.5M, 2bn), numbers followed by "thousand", "million" or "billion", and
 *     percentages (12%, 12 percent). Flagged ALWAYS in text every vendor shares (scope "shared":
 *     overview, objectives, project name, timeline), because a programme total or a fee is never one
 *     vendor's released figure; in a line's own text (scope "line") ONLY when that line's budget is
 *     not released.
 *  Deliberately NOT flagged: "35mm" / "500ml" (a unit, not a suffix), 2K / 4K / 6K / 8K in capitals
 *  with no currency sign (video resolutions), a bare number with no currency or suffix, and a number
 *  inside a word.
 */

export type VendorTextScope = "shared" | "line"

export type VendorTextField = {
  /** Stable id the caller uses to apply a rewrite back, e.g. "overview", "objectives.2", "line.<key>.description". */
  field: string
  /** What the agency calls it on screen, e.g. "Overview", "Video production: description". */
  label: string
  text: string | null | undefined
  scope: VendorTextScope
  /** Only for scope "line": true when this line's budget is released to its vendors (D2). */
  lineBudgetReleased?: boolean
}

export type VendorTextReason = "client_name" | "figure"

export type VendorTextMatch = {
  field: string
  label: string
  reason: VendorTextReason
  /** The text that matched, exactly as written. */
  matched: string
  /** The match with a little context either side, on one line. */
  excerpt: string
}

export type VendorTextCheckInput = {
  /** True when this RFP does NOT show its client to vendors (D3 default). */
  clientHidden: boolean
  /** Every known name of the client. Nulls, blanks and duplicates are ignored. */
  clientNames: readonly (string | null | undefined)[]
  fields: readonly VendorTextField[]
}

export const VENDOR_TEXT_REASON_LABEL: Record<VendorTextReason, string> = {
  client_name: "Names the client while the client is hidden",
  figure: "Shows a money figure or percentage",
}

const LETTER_OR_DIGIT = "\\p{L}\\p{N}"
const BEFORE = `(?<![${LETTER_OR_DIGIT}])`
const AFTER = `(?![${LETTER_OR_DIGIT}])`
/** Between two words of a name: nothing, or any run of spaces and punctuation. */
const NAME_JOIN = `[^${LETTER_OR_DIGIT}]{0,3}`

const COMPANY_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "llp", "ltd", "limited", "co", "corp", "corporation", "company",
  "plc", "gmbh", "ag", "sa", "bv", "nv", "pty", "group", "holdings",
])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** The words of a name: letters and digits only, "&" kept as its own word. */
function nameWords(name: string): string[] {
  return name.match(/[\p{L}\p{N}]+|&/gu) ?? []
}

function wordPattern(word: string): string {
  if (word === "&" || word.toLowerCase() === "and") return "(?:&|and)"
  return escapeRegExp(word)
}

/** One regular expression per client name, or null when the name is too short to match safely. */
export function clientNamePattern(name: string): RegExp | null {
  const words = nameWords(name.trim())
  // A trailing company suffix is optional: "Acme Inc" also matches "Acme" and "Acme, Inc.".
  let core = words
  while (core.length > 1 && COMPANY_SUFFIXES.has(core[core.length - 1].toLowerCase())) core = core.slice(0, -1)
  const coreChars = core.filter((w) => w !== "&").join("").length
  if (coreChars < 2) return null
  const suffix = words.slice(core.length)
  const corePattern = core.map(wordPattern).join(NAME_JOIN)
  const suffixPattern = suffix.length > 0 ? `(?:${NAME_JOIN}${suffix.map(wordPattern).join(NAME_JOIN)}\\.?)?` : ""
  return new RegExp(`${BEFORE}${corePattern}${suffixPattern}${AFTER}`, "giu")
}

const CURRENCY_SYMBOL = "[$€£¥₹]"
const CURRENCY_CODE = "(?:USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY|SGD|HKD|INR|SEK|NOK|DKK)"
const CURRENCY_WORD = "(?:dollars?|euros?|pounds?|bucks)"
/** 250,000 / 250000 / 1.5 (a trailing comma or full stop is punctuation, not part of the number). */
const NUMBER = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?"
/** k / m / M / bn suffix, or a scale word. Not "mm" or "ml" (units), not a lone "b" ("Phase 2b"). */
const SCALE = "(?:\\s?(?:k|K|m|M|bn|BN|Bn)(?![\\p{L}\\p{N}])|\\s(?:thousand|million|billion)\\b)"

const FIGURE_PATTERNS: RegExp[] = [
  // $250,000  £40k  € 1.2M  $3 million
  new RegExp(`${CURRENCY_SYMBOL}\\s?${NUMBER}${SCALE}?`, "gu"),
  // USD 250,000  EUR40k
  new RegExp(`${BEFORE}${CURRENCY_CODE}\\s?${NUMBER}${SCALE}?${AFTER}`, "gu"),
  // 250,000 USD  1.2m EUR  40k dollars
  new RegExp(`${BEFORE}${NUMBER}${SCALE}?\\s?(?:${CURRENCY_CODE}|${CURRENCY_WORD})${AFTER}`, "giu"),
  // 250k  1.5M  2bn  3 million (no currency)
  new RegExp(`${BEFORE}${NUMBER}${SCALE}`, "gu"),
  // 12%  12 %  12 percent  12 per cent
  new RegExp(`${BEFORE}${NUMBER}\\s?(?:%|percent\\b|per cent\\b)`, "giu"),
]

/** 2K / 4K / 6K / 8K in capitals with no currency in front: a video resolution, not money. */
function isVideoResolution(matched: string, text: string, index: number): boolean {
  if (!/^[2468]K$/.test(matched)) return false
  const before = text.slice(Math.max(0, index - 2), index)
  return !/[$€£¥₹]\s?$/.test(before)
}

function excerptAround(text: string, start: number, end: number, radius = 32): string {
  const from = Math.max(0, start - radius)
  const to = Math.min(text.length, end + radius)
  const body = text.slice(from, to).replace(/\s+/g, " ").trim()
  return `${from > 0 ? "..." : ""}${body}${to < text.length ? "..." : ""}`
}

type Span = { start: number; end: number; matched: string }

function collectSpans(text: string, patterns: readonly RegExp[], skip?: (s: Span) => boolean): Span[] {
  const spans: Span[] = []
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    for (const m of text.matchAll(pattern)) {
      const start = m.index ?? 0
      const matched = m[0].trim()
      if (!matched) continue
      const span = { start, end: start + m[0].length, matched }
      if (skip?.(span)) continue
      spans.push(span)
    }
  }
  // Overlapping matches of different patterns ("$250k" and "250k") count once: the longest wins.
  spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Span[] = []
  for (const s of spans) {
    const last = out[out.length - 1]
    if (last && s.start < last.end) continue
    out.push(s)
  }
  return out
}

function uniqueNames(names: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = typeof raw === "string" ? raw.trim() : ""
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * Every match in every field, in field order then text order. An empty array means nothing to warn
 * about. Never throws on odd input: a non-string text is skipped.
 */
export function checkVendorText(input: VendorTextCheckInput): VendorTextMatch[] {
  const clientPatterns = input.clientHidden
    ? uniqueNames(input.clientNames).map(clientNamePattern).filter((p): p is RegExp => p !== null)
    : []
  const matches: VendorTextMatch[] = []
  for (const f of input.fields) {
    const text = typeof f.text === "string" ? f.text : ""
    if (!text.trim()) continue
    for (const s of collectSpans(text, clientPatterns)) {
      matches.push({ field: f.field, label: f.label, reason: "client_name", matched: s.matched, excerpt: excerptAround(text, s.start, s.end) })
    }
    const figuresApply = f.scope === "shared" || f.lineBudgetReleased !== true
    if (!figuresApply) continue
    for (const s of collectSpans(text, FIGURE_PATTERNS, (span) => isVideoResolution(span.matched, text, span.start))) {
      matches.push({ field: f.field, label: f.label, reason: "figure", matched: s.matched, excerpt: excerptAround(text, s.start, s.end) })
    }
  }
  return matches
}

/** The flags the bids list shows for an RFP already sent. */
export function summarizeVendorTextMatches(matches: readonly VendorTextMatch[]): { namesClient: boolean; showsFigures: boolean } {
  return {
    namesClient: matches.some((m) => m.reason === "client_name"),
    showsFigures: matches.some((m) => m.reason === "figure"),
  }
}

// ---------------------------------------------------------------------------------------------
// The vendor-visible text of an RFP, as fields. One builder for the wizard's master RFP and the
// record's master_rfp (they share the keys), and one for a line.
// ---------------------------------------------------------------------------------------------

function asText(v: unknown): string {
  return typeof v === "string" ? v : ""
}

/** projectName, overview, objectives (each one its own field) and timeline: text every vendor reads. */
export function sharedVendorTextFields(master: Record<string, unknown> | null | undefined): VendorTextField[] {
  if (!master) return []
  const fields: VendorTextField[] = [
    { field: "projectName", label: "Project name", text: asText(master.projectName), scope: "shared" },
    { field: "overview", label: "Overview", text: asText(master.overview), scope: "shared" },
  ]
  const objectives = Array.isArray(master.objectives) ? master.objectives : []
  objectives.forEach((o, i) => {
    fields.push({ field: `objectives.${i}`, label: `Objective ${i + 1}`, text: asText(o), scope: "shared" })
  })
  fields.push({ field: "timeline", label: "Timeline", text: asText(master.timeline), scope: "shared" })
  return fields
}

/** One line's own vendor-visible text: its name, description and timeline. */
export function lineVendorTextFields(line: {
  key: string
  name?: string | null
  description?: string | null
  timeline?: string | null
  budgetReleased: boolean
}): VendorTextField[] {
  const title = asText(line.name).trim() || "Scope item"
  const base = { scope: "line" as const, lineBudgetReleased: line.budgetReleased }
  return [
    { ...base, field: `line.${line.key}.name`, label: `${title}: name`, text: asText(line.name) },
    { ...base, field: `line.${line.key}.description`, label: `${title}: description`, text: asText(line.description) },
    { ...base, field: `line.${line.key}.timeline`, label: `${title}: timeline`, text: asText(line.timeline) },
  ]
}

// ---------------------------------------------------------------------------------------------
// A word diff for showing a suggested rewrite as plain text (never HTML).
// ---------------------------------------------------------------------------------------------

export type DiffPart = { kind: "same" | "removed" | "added"; text: string }

/** Word-level diff (longest common subsequence over words and the spaces between them). */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.match(/\s+|[^\s]+/g) ?? []
  const b = after.match(/\s+|[^\s]+/g) ?? []
  // Bounded: a field is at most a few thousand characters (the rewrite route caps it), so the table
  // stays small. Beyond the bound the whole field is shown as replaced.
  if (a.length * b.length > 4_000_000) {
    return [
      ...(before ? [{ kind: "removed" as const, text: before }] : []),
      ...(after ? [{ kind: "added" as const, text: after }] : []),
    ]
  }
  const rows = a.length + 1
  const cols = b.length + 1
  const lcs = new Uint32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] = a[i] === b[j] ? lcs[(i + 1) * cols + j + 1] + 1 : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1])
    }
  }
  const parts: DiffPart[] = []
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i])
      i++
      j++
    } else if (lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1]) {
      push("removed", a[i++])
    } else {
      push("added", b[j++])
    }
  }
  while (i < a.length) push("removed", a[i++])
  while (j < b.length) push("added", b[j++])
  return parts
}
