/**
 * MONEY IN THE BUDGET UI IS INTEGER CENTS.
 *
 * The database stores numeric(14,2) and no currency (103 / 104 carry no currency column; see
 * docs/budget-spine-build-plan.md section 1, "Currency"). The budget API sends amounts as decimal
 * numbers with at most two places. The UI converts each one to integer cents on arrival, does every
 * sum and difference in cents, and sends amounts back as a decimal STRING built from cents, so no
 * float ever carries money across a boundary.
 *
 * No currency symbol is shown: nothing stored says what the currency is.
 */

/** numeric(14,2): 12 integer digits and 2 decimals. */
export const MAX_ABS_CENTS = 99_999_999_999_999

/** A number or numeric string from the API (dollars, two decimals at most) to integer cents. */
export function toCentsFromApi(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : 0
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** Integer cents to the exact decimal string the API accepts ("-12.05"). */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(Math.trunc(cents))
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return `${sign}${whole}.${frac.toString().padStart(2, "0")}`
}

/** Display: "1,234.50", "-80.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(Math.trunc(cents))
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return `${sign}${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")}`
}

export type ParsedMoney = { ok: true; cents: number } | { ok: false; reason: string }

/**
 * Parse a typed or imported amount to integer cents WITHOUT floating point.
 *
 * Accepts: "1234", "1,234.5", "$1,234.56", "USD 1 234.56", "-80", "(80.00)" (accounting negative),
 * "80-" is NOT accepted. The decimal separator is the dot; a comma is a thousands separator.
 * More than two decimals is refused rather than rounded, so an import never changes a number
 * silently.
 */
export function parseMoneyToCents(input: unknown): ParsedMoney {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, reason: "Not a number" }
    return parseMoneyToCents(input.toFixed(10).replace(/0+$/, "").replace(/\.$/, ""))
  }
  if (typeof input !== "string") return { ok: false, reason: "No amount" }
  let s = input.trim()
  if (!s) return { ok: false, reason: "No amount" }
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1).trim()
  }
  // Currency codes and symbols, then grouping characters.
  s = s.replace(/^[A-Za-z]{3}\s*/, "").replace(/\s*[A-Za-z]{3}$/, "")
  s = s.replace(/[$€£¥₹]/g, "").replace(/[,\s ']/g, "")
  if (s.startsWith("-")) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith("+")) {
    s = s.slice(1)
  }
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return { ok: false, reason: `"${String(input).slice(0, 40)}" is not an amount` }
  const [wholePart, fracPart = ""] = s.split(".")
  if (fracPart.length > 2) return { ok: false, reason: "More than two decimal places" }
  const whole = wholePart === "" ? 0 : Number(wholePart)
  if (!Number.isSafeInteger(whole)) return { ok: false, reason: "Amount is too large" }
  const cents = whole * 100 + Number(fracPart.padEnd(2, "0") || "0")
  if (cents > MAX_ABS_CENTS) return { ok: false, reason: "Amount is too large" }
  return { ok: true, cents: negative && cents !== 0 ? -cents : cents }
}

export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/**
 * MARGIN. The spec rules that the fee-or-cost flag is what makes margin computable (spec 2b) and
 * does not state a formula (docs/budget-spine-build-plan.md, Phase B step 4). The owner's run
 * brief gives the fallback used here:
 *   margin amount  = fee total
 *   margin percent = fee / (fee + cost)
 * Percent is null when fee + cost is 0, so no naked percentage is shown on nothing.
 */
export function computeMargin(feeCents: number, costCents: number): { amountCents: number; percent: number | null } {
  const denom = feeCents + costCents
  return { amountCents: feeCents, percent: denom === 0 ? null : (feeCents / denom) * 100 }
}

export function formatPercent(p: number | null): string {
  return p === null ? "-" : `${p.toFixed(1)}%`
}
