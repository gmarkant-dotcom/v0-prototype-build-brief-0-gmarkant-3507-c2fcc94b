/** Stored in TEXT columns `budget_proposal` / `timeline_proposal` as JSON or legacy free text. */

const STANDARD_CURRENCIES = new Set([
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "MXN",
  "BRL",
  "AED",
  "SGD",
  "Other",
])

export type StoredBudget = {
  amount: number
  currency: string
  /** When currency is "Other", optional custom code/name */
  custom?: string
}

export type StoredTimeline = {
  duration: number
  unit: "Days" | "Weeks" | "Months"
}

const TIMELINE_UNITS = new Set(["Days", "Weeks", "Months"])

/** Maps DB/UI variants (e.g. "weeks", "Week") to canonical labels used in selects and display. */
function normalizeTimelineUnit(u: string): "Days" | "Weeks" | "Months" | null {
  const s = u.trim()
  if (TIMELINE_UNITS.has(s)) return s as "Days" | "Weeks" | "Months"
  const lower = s.toLowerCase()
  if (lower === "day" || lower === "days") return "Days"
  if (lower === "week" || lower === "weeks") return "Weeks"
  if (lower === "month" || lower === "months") return "Months"
  return null
}

/** If TEXT columns store double-encoded JSON (string of JSON), unwrap once. */
function parseJsonObjectMaybeDoubleEncoded(t: string): unknown {
  let parsed: unknown = JSON.parse(t)
  if (typeof parsed === "string") {
    const inner = parsed.trim()
    if (
      (inner.startsWith("{") && inner.endsWith("}")) ||
      (inner.startsWith("[") && inner.endsWith("]"))
    ) {
      try {
        parsed = JSON.parse(inner)
      } catch {
        /* keep string */
      }
    }
  }
  return parsed
}

export function serializeBudget(amount: number, currency: string, customOther?: string): string {
  const cur = currency === "Other" ? "Other" : currency
  const payload: StoredBudget = {
    amount,
    currency: cur,
    ...(currency === "Other" && customOther?.trim() ? { custom: customOther.trim() } : {}),
  }
  return JSON.stringify(payload)
}

export function serializeTimeline(duration: number, unit: "Days" | "Weeks" | "Months"): string {
  return JSON.stringify({ duration, unit } satisfies StoredTimeline)
}

/** Persisted TEXT value for `budget_proposal` from form fields. */
export function buildBudgetProposalForSave(
  amountStr: string,
  currency: string,
  currencyOther: string,
  legacyFallback: string | null
): string {
  const raw = amountStr.trim().replace(/,/g, "")
  const amt = parseFloat(raw)
  if (Number.isFinite(amt) && amt > 0) {
    const c = currency === "Other" ? "Other" : currency
    const other = currency === "Other" ? currencyOther.trim() : ""
    if (c === "Other" && !other) return ""
    return serializeBudget(amt, c, other || undefined)
  }
  if (legacyFallback?.trim()) return legacyFallback.trim()
  return ""
}

/** Persisted TEXT value for `timeline_proposal` from form fields. */
export function buildTimelineProposalForSave(
  durationStr: string,
  unit: "Days" | "Weeks" | "Months",
  legacyFallback: string | null
): string {
  const raw = durationStr.trim()
  const d = parseFloat(raw)
  if (Number.isFinite(d) && d > 0) {
    return serializeTimeline(d, unit)
  }
  if (legacyFallback?.trim()) return legacyFallback.trim()
  return ""
}

export function parseBudgetProposal(raw: string): {
  amount: string
  currency: string
  customOther: string
  legacyHint: string | null
} {
  const empty = { amount: "", currency: "USD", customOther: "", legacyHint: null as string | null }
  const t = (raw ?? "").trim()
  if (!t) return empty
  try {
    const j = parseJsonObjectMaybeDoubleEncoded(t) as Record<string, unknown>
    if (j && typeof j === "object" && "amount" in j && "currency" in j) {
      const amount = j.amount
      const num = typeof amount === "number" ? amount : parseFloat(String(amount))
      let currency = String(j.currency ?? "USD")
      let customOther = typeof j.custom === "string" ? j.custom.trim() : ""
      if (!STANDARD_CURRENCIES.has(currency)) {
        customOther = [currency, customOther].filter(Boolean).join(" ").trim()
        currency = "Other"
      }
      return {
        amount: Number.isFinite(num) ? String(num) : "",
        currency,
        customOther: currency === "Other" ? customOther : "",
        legacyHint: null,
      }
    }
  } catch {
    /* legacy */
  }
  const legacy = /^([\d.,]+)\s+(USD|EUR|GBP|CAD|AUD|JPY|MXN|BRL|AED|SGD|Other)(?:\s+(.+))?$/i.exec(t)
  if (legacy) {
    return {
      amount: legacy[1].replace(/,/g, ""),
      currency: legacy[2].toLowerCase() === "other" ? "Other" : legacy[2].toUpperCase(),
      customOther: legacy[3]?.trim() ?? "",
      legacyHint: null,
    }
  }
  return { ...empty, legacyHint: t }
}

export function parseTimelineProposal(raw: string): {
  duration: string
  unit: "Days" | "Weeks" | "Months"
  legacyHint: string | null
} {
  const empty = { duration: "", unit: "Weeks" as const, legacyHint: null as string | null }
  const t = (raw ?? "").trim()
  if (!t) return empty
  try {
    const j = parseJsonObjectMaybeDoubleEncoded(t) as Record<string, unknown>
    if (j && typeof j === "object" && "duration" in j && "unit" in j) {
      const d = j.duration
      const num = typeof d === "number" ? d : parseFloat(String(d))
      const u = String(j.unit ?? "Weeks")
      const unit = normalizeTimelineUnit(u) ?? "Weeks"
      return {
        duration: Number.isFinite(num) ? String(num) : "",
        unit,
        legacyHint: null,
      }
    }
  } catch {
    /* legacy */
  }
  const legacy = /^(\d+(?:\.\d+)?)\s*(days?|weeks?|months?)$/i.exec(t)
  if (legacy) {
    const n = legacy[1]
    const u = legacy[2].toLowerCase()
    let unit: "Days" | "Weeks" | "Months" = "Weeks"
    if (u.startsWith("day")) unit = "Days"
    else if (u.startsWith("month")) unit = "Months"
    return { duration: n, unit, legacyHint: null }
  }
  return { ...empty, legacyHint: t }
}

function parseStoredBudget(raw: string | Record<string, unknown> | null | undefined): StoredBudget | null {
  if (raw == null) return null
  if (typeof raw === "object" && raw !== null && "amount" in raw) {
    return raw as StoredBudget
  }
  const t = String(raw ?? "").trim()
  if (!t) return null
  try {
    return parseJsonObjectMaybeDoubleEncoded(t) as StoredBudget
  } catch {
    return null
  }
}

export function formatBudgetForDisplay(raw: string | Record<string, unknown> | null | undefined): string {
  const j = parseStoredBudget(raw)
  if (j && typeof j === "object") {
    const num = typeof j.amount === "number" ? j.amount : parseFloat(String(j.amount))
    const cur = String(j.currency ?? "").trim()
    if (Number.isFinite(num) && cur) {
      const displayCur =
        cur === "Other" && j.custom?.trim() ? j.custom.trim() : cur
      return `${num.toLocaleString("en-US")} ${displayCur}`
    }
  }
  const t = typeof raw === "string" ? raw.trim() : ""
  return t || "—"
}

function parseStoredTimeline(raw: string | Record<string, unknown> | null | undefined): StoredTimeline | null {
  if (raw == null) return null
  if (typeof raw === "object" && raw !== null && "duration" in raw) {
    return raw as StoredTimeline
  }
  const t = String(raw ?? "").trim()
  if (!t) return null
  try {
    return parseJsonObjectMaybeDoubleEncoded(t) as StoredTimeline
  } catch {
    return null
  }
}

export function formatTimelineForDisplay(raw: string | Record<string, unknown> | null | undefined): string {
  const j = parseStoredTimeline(raw)
  if (j && typeof j === "object") {
    const num = typeof j.duration === "number" ? j.duration : parseFloat(String(j.duration))
    const uNorm = normalizeTimelineUnit(String(j.unit ?? "").trim())
    if (Number.isFinite(num) && uNorm) {
      return `${num} ${uNorm}`
    }
  }
  const t = typeof raw === "string" ? raw.trim() : ""
  return t || "—"
}

export function isBudgetValidForSubmit(stored: string): boolean {
  const t = (stored ?? "").trim()
  if (!t) return false
  try {
    const j = JSON.parse(t) as StoredBudget
    if (j && typeof j === "object") {
      const num = typeof j.amount === "number" ? j.amount : parseFloat(String(j.amount))
      if (!Number.isFinite(num) || num <= 0) return false
      const c = String(j.currency ?? "").trim()
      if (!c) return false
      if (c === "Other" && !String((j as StoredBudget).custom ?? "").trim()) return false
      return true
    }
  } catch {
    return t.length > 0
  }
  return false
}

export function isTimelineValidForSubmit(stored: string): boolean {
  const t = (stored ?? "").trim()
  if (!t) return false
  try {
    const j = JSON.parse(t) as StoredTimeline
    if (j && typeof j === "object") {
      const num = typeof j.duration === "number" ? j.duration : parseFloat(String(j.duration))
      if (!Number.isFinite(num) || num <= 0) return false
      return TIMELINE_UNITS.has(String(j.unit ?? ""))
    }
  } catch {
    return t.length > 0
  }
  return false
}

export const BUDGET_CURRENCY_OPTIONS = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "MXN",
  "BRL",
  "AED",
  "SGD",
  "Other",
] as const

export const TIMELINE_UNIT_OPTIONS = ["Days", "Weeks", "Months"] as const
