import { MAX_ABS_CENTS, parseMoneyToCents } from "./money"

/**
 * BUDGET LINE MATH (migration 116): estimate = round(quantity x unit rate x multiplier, 2).
 *
 * ONE SET OF RULES FOR THE BROWSER AND THE SERVER. The budget tab and the import validate with these
 * functions before sending; lib/server/budget/lines.ts validates with the same functions inside its
 * zod schema; the database trigger budget_lines_compute_estimate() is the final word.
 *
 * NO FLOATING POINT CARRIES A NUMBER. Quantity and multiplier are integer THOUSANDTHS
 * (numeric(12,3)), the rate is integer CENTS (numeric(14,2)), and the product is formed in BigInt:
 *
 *   cents = round_half_away_from_zero(quantityMilli x rateCents x multiplierMilli / 1,000,000)
 *
 * which is exactly Postgres' round(quantity * unit_rate * multiplier, 2). A missing quantity or
 * multiplier counts as 1 (1000 thousandths), as coalesce(..., 1) does in the trigger.
 */

/** numeric(12,3): 9 integer digits and 3 decimals, in thousandths. */
export const MAX_MILLI = 999_999_999_999

export const UNIT_LABEL_MAX = 24

export type ParsedMilli = { ok: true; milli: number } | { ok: false; reason: string }
export type ParsedLabel = { ok: true; label: string } | { ok: false; reason: string }
export type ComputedEstimate = { ok: true; cents: number } | { ok: false; reason: string }

export const TOTAL_TOO_LARGE =
  "The line total is too large. Quantity x rate x multiplier must stay below 1,000,000,000,000.00 either way."

/** A JSON number as the decimal text it was written as. String() is the shortest round-trip form. */
function numberText(input: number): string | null {
  if (!Number.isFinite(input)) return null
  const s = String(input)
  return /e/i.test(s) ? null : s
}

/**
 * Quantity or multiplier to integer thousandths. Accepts "3", "2.5", "1,250", "0.125"; refuses a
 * sign, more than three decimals (refused, never rounded), 0, and anything over 999,999,999.999.
 */
export function parseDecimal3ToMilli(input: unknown, label: string): ParsedMilli {
  const raw = typeof input === "number" ? numberText(input) : typeof input === "string" ? input : null
  if (raw === null) return { ok: false, reason: `${label} is not a number` }
  const s = raw.trim().replace(/[,\s ']/g, "")
  if (!s) return { ok: false, reason: `${label} is empty` }
  if (s.startsWith("-")) return { ok: false, reason: `${label} must be greater than 0` }
  const body = s.startsWith("+") ? s.slice(1) : s
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(body)) return { ok: false, reason: `"${raw.slice(0, 40)}" is not a ${label.toLowerCase()}` }
  const [wholePart, fracPart = ""] = body.split(".")
  if (fracPart.length > 3) return { ok: false, reason: `${label} has more than three decimal places` }
  const whole = wholePart === "" ? 0 : Number(wholePart)
  if (!Number.isSafeInteger(whole) || whole > 999_999_999) return { ok: false, reason: `${label} is too large (at most 999,999,999.999)` }
  const milli = whole * 1000 + Number(fracPart.padEnd(3, "0") || "0")
  if (milli <= 0) return { ok: false, reason: `${label} must be greater than 0` }
  if (milli > MAX_MILLI) return { ok: false, reason: `${label} is too large (at most 999,999,999.999)` }
  return { ok: true, milli }
}

/** Unit rate to integer cents: the money rules (two decimals, negatives allowed, |rate| < 1e12). */
export function parseRateToCents(input: unknown): { ok: true; cents: number } | { ok: false; reason: string } {
  const text = typeof input === "number" ? numberText(input) : input
  if (text === null) return { ok: false, reason: "Rate is not a number" }
  const r = parseMoneyToCents(text)
  return r.ok ? r : { ok: false, reason: `Rate: ${r.reason}` }
}

/** C0 and C1 control characters, DEL included. */
function hasControlCharacter(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true
  }
  return false
}

/** Unit label: trimmed, 1 to 24 characters (code points, as char_length counts), no control characters. */
export function parseUnitLabel(input: unknown): ParsedLabel {
  if (typeof input !== "string") return { ok: false, reason: "Unit must be text" }
  const label = input.trim()
  if (hasControlCharacter(label)) return { ok: false, reason: "Unit cannot contain control characters" }
  const length = Array.from(label).length
  if (length < 1 || length > UNIT_LABEL_MAX) return { ok: false, reason: `Unit is 1 to ${UNIT_LABEL_MAX} characters` }
  return { ok: true, label }
}

/** round(qty x rate x multiplier, 2) in cents, half away from zero, refusing what numeric(14,2) cannot hold. */
export function computeEstimateCents(quantityMilli: number | null, rateCents: number, multiplierMilli: number | null): ComputedEstimate {
  const product = BigInt(quantityMilli ?? 1000) * BigInt(rateCents) * BigInt(multiplierMilli ?? 1000)
  const zero = BigInt(0)
  const divisor = BigInt(1_000_000)
  const negative = product < zero
  const abs = negative ? -product : product
  let quotient = abs / divisor
  if ((abs % divisor) * BigInt(2) >= divisor) quotient += BigInt(1)
  if (quotient > BigInt(MAX_ABS_CENTS)) return { ok: false, reason: TOTAL_TOO_LARGE }
  const cents = Number(quotient)
  return { ok: true, cents: negative && cents !== 0 ? -cents : cents }
}

/** Thousandths to the exact decimal string the API accepts ("2.500"). */
export function milliToDecimalString(milli: number): string {
  const abs = Math.abs(Math.trunc(milli))
  return `${milli < 0 ? "-" : ""}${Math.floor(abs / 1000)}.${(abs % 1000).toString().padStart(3, "0")}`
}

/** Display: "2.5", "1,250", "0.125". Trailing zeros dropped. */
export function formatMilli(milli: number): string {
  const abs = Math.abs(Math.trunc(milli))
  const whole = Math.floor(abs / 1000).toLocaleString("en-US")
  const frac = (abs % 1000).toString().padStart(3, "0").replace(/0+$/, "")
  return `${milli < 0 ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`
}

/** Plain decimal for a CSV cell or an input: "2.5", "1250". */
export function milliToPlain(milli: number): string {
  return formatMilli(milli).replace(/,/g, "")
}

/** numeric(12,3) from the API (number or numeric string) to thousandths, or null. */
export function toMilliFromApi(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? Math.round(n * 1000) : null
}

/** numeric(14,2) from the API to cents, or null when absent. */
export function rateCentsFromApi(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
