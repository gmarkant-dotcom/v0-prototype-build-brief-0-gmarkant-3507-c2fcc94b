/**
 * Terms Alignment Phase 1: structured vendor term disclosures at bid time.
 *
 * One shape, "TermsDisclosure", is reused for both:
 *   - partner_rfp_responses.terms_disclosure (what a bidder disclosed for a specific bid)
 *   - profiles.default_terms (a partner's saved defaults, prefilled on future bids)
 * A bid's disclosure is just a point-in-time copy of a partner's defaults (or a plain
 * from-scratch entry for guests), so the UI can prefill a bid form from the profile and
 * both write paths (partner portal + guest) share one validator.
 *
 * Each of the four terms carries a value, a flexibility state, and an optional note.
 * Flexibility can only qualify a stated position, never replace one - there is no "state
 * only" disclosure, the value fields are always required together with the state once a
 * term is disclosed at all.
 *
 * Supersedes the ad-hoc partner_rfp_responses.payment_terms block (deposit_required_pct /
 * payment_schedule_preference / additional_notes) in both bid forms going forward. That
 * column and its legacy display are left untouched for bids submitted before this feature -
 * see lib/bid-shared.ts's PaymentTerms type and the terms-disclosure-aware read helpers
 * below.
 */

export const TERM_STATES = ["firm", "negotiable", "flexible"] as const
export type TermState = (typeof TERM_STATES)[number]

/** Display labels, heaviest to lightest. Used everywhere a state renders as text or a badge. */
export const TERM_STATE_LABELS: Record<TermState, string> = {
  firm: "Firm",
  negotiable: "Negotiable",
  flexible: "Flexible",
}

/** Compact abbreviations for the bid-card summary line and dense compare-view rendering. */
export const TERM_STATE_ABBR: Record<TermState, string> = {
  firm: "Firm",
  negotiable: "Neg",
  flexible: "Flex",
}

/** Badge treatment: firm visually heaviest, flexible lightest. Same rounded-pill shape used
 *  for status/intent badges elsewhere (agency-broadcast-responses.tsx). */
export const TERM_STATE_BADGE_CLASS: Record<TermState, string> = {
  firm: "border-foreground/30 bg-foreground/15 text-foreground",
  negotiable: "border-border bg-white/5 text-foreground-secondary",
  flexible: "border-border/40 bg-transparent text-foreground-muted",
}

export const KILL_FEE_TYPES = ["none", "percent", "flat"] as const
export type KillFeeType = (typeof KILL_FEE_TYPES)[number]

export const IP_RIGHTS_STANCES = ["work_for_hire", "licensed_usage", "retained_negotiable"] as const
export type IpRightsStance = (typeof IP_RIGHTS_STANCES)[number]

export const IP_RIGHTS_LABELS: Record<IpRightsStance, string> = {
  work_for_hire: "Work-for-hire",
  licensed_usage: "Licensed usage",
  retained_negotiable: "Retained, negotiable",
}

/** Short labels for the compact bid-card summary line. */
export const IP_RIGHTS_SHORT_LABELS: Record<IpRightsStance, string> = {
  work_for_hire: "WFH IP",
  licensed_usage: "Licensed IP",
  retained_negotiable: "Retained IP",
}

export const NET_DAYS_OPTIONS = [15, 30, 45, 60] as const
export const RATE_VALIDITY_OPTIONS = [30, 60, 90] as const
const MAX_TERM_DAYS = 365
const MAX_NOTE_LENGTH = 200

export interface PaymentTermDisclosure {
  net_days: number | null
  deposit_pct: number | null
  state: TermState | null
  note: string
}

export interface KillFeeDisclosure {
  fee_type: KillFeeType | null
  amount: number | null
  state: TermState | null
  note: string
}

export interface IpRightsDisclosure {
  stance: IpRightsStance | null
  state: TermState | null
  note: string
}

export interface RateValidityDisclosure {
  days: number | null
  state: TermState | null
  note: string
}

export interface TermsDisclosure {
  payment: PaymentTermDisclosure
  kill_fee: KillFeeDisclosure
  ip_rights: IpRightsDisclosure
  rate_validity: RateValidityDisclosure
}

export function emptyTermsDisclosure(): TermsDisclosure {
  return {
    payment: { net_days: null, deposit_pct: null, state: null, note: "" },
    kill_fee: { fee_type: null, amount: null, state: null, note: "" },
    ip_rights: { stance: null, state: null, note: "" },
    rate_validity: { days: null, state: null, note: "" },
  }
}

function isTermState(v: unknown): v is TermState {
  return typeof v === "string" && (TERM_STATES as readonly string[]).includes(v)
}

/**
 * Skeleton-fill: merges a partial/empty stored JSONB value onto a fully populated default
 * skeleton, so a newly added field never breaks existing rows that predate it. Used for both
 * reading a stored disclosure back for display and prefilling a form from saved defaults.
 */
export function withTermsDisclosureDefaults(stored: unknown): TermsDisclosure {
  const base = emptyTermsDisclosure()
  if (!stored || typeof stored !== "object") return base
  const s = stored as Partial<TermsDisclosure>

  if (s.payment && typeof s.payment === "object") {
    base.payment = {
      net_days: typeof s.payment.net_days === "number" ? s.payment.net_days : null,
      deposit_pct: typeof s.payment.deposit_pct === "number" ? s.payment.deposit_pct : null,
      state: isTermState(s.payment.state) ? s.payment.state : null,
      note: typeof s.payment.note === "string" ? s.payment.note.slice(0, MAX_NOTE_LENGTH) : "",
    }
  }
  if (s.kill_fee && typeof s.kill_fee === "object") {
    base.kill_fee = {
      fee_type: (KILL_FEE_TYPES as readonly string[]).includes(s.kill_fee.fee_type as string)
        ? (s.kill_fee.fee_type as KillFeeType)
        : null,
      amount: typeof s.kill_fee.amount === "number" ? s.kill_fee.amount : null,
      state: isTermState(s.kill_fee.state) ? s.kill_fee.state : null,
      note: typeof s.kill_fee.note === "string" ? s.kill_fee.note.slice(0, MAX_NOTE_LENGTH) : "",
    }
  }
  if (s.ip_rights && typeof s.ip_rights === "object") {
    base.ip_rights = {
      stance: (IP_RIGHTS_STANCES as readonly string[]).includes(s.ip_rights.stance as string)
        ? (s.ip_rights.stance as IpRightsStance)
        : null,
      state: isTermState(s.ip_rights.state) ? s.ip_rights.state : null,
      note: typeof s.ip_rights.note === "string" ? s.ip_rights.note.slice(0, MAX_NOTE_LENGTH) : "",
    }
  }
  if (s.rate_validity && typeof s.rate_validity === "object") {
    base.rate_validity = {
      days: typeof s.rate_validity.days === "number" ? s.rate_validity.days : null,
      state: isTermState(s.rate_validity.state) ? s.rate_validity.state : null,
      note: typeof s.rate_validity.note === "string" ? s.rate_validity.note.slice(0, MAX_NOTE_LENGTH) : "",
    }
  }

  return base
}

/** True when every value has at least one field filled in - used to decide whether an
 *  optional disclosure the vendor started should be validated as complete, vs. treated as
 *  never-started (submit as null). */
export function isTermsDisclosureStarted(d: TermsDisclosure): boolean {
  return Boolean(
    d.payment.net_days != null ||
      d.payment.deposit_pct != null ||
      d.payment.state ||
      d.payment.note ||
      d.kill_fee.fee_type ||
      d.kill_fee.amount != null ||
      d.kill_fee.state ||
      d.kill_fee.note ||
      d.ip_rights.stance ||
      d.ip_rights.state ||
      d.ip_rights.note ||
      d.rate_validity.days != null ||
      d.rate_validity.state ||
      d.rate_validity.note
  )
}

export type TermsDisclosureValidationError = {
  field: "payment" | "kill_fee" | "ip_rights" | "rate_validity"
  message: string
}

export type TermsDisclosureValidationResult =
  | { ok: true; value: TermsDisclosure | null }
  | { ok: false; errors: TermsDisclosureValidationError[] }

/**
 * Server-side validation - the trust boundary for both submission routes. Sanity, not just
 * presence: net/rate days are positive integers capped at 365, deposit is 0-100, fee amounts
 * are non-negative, notes are capped at 200 chars, states are restricted to the three allowed
 * values.
 *
 * `required` mirrors the RFP's require_terms_disclosure flag at submission time: when true,
 * all four terms must be complete or validation fails. When false, an empty/untouched
 * disclosure is valid (returns value: null) but a partially-started one is still validated in
 * full - a vendor who opts into the optional section doesn't get to disclose half a position.
 */
export function validateTermsDisclosure(raw: unknown, required: boolean): TermsDisclosureValidationResult {
  const errors: TermsDisclosureValidationError[] = []
  const d = withTermsDisclosureDefaults(raw)

  if (!required && !isTermsDisclosureStarted(d)) {
    return { ok: true, value: null }
  }

  // Payment
  if (d.payment.net_days == null) {
    errors.push({ field: "payment", message: "Payment terms: net days is required" })
  } else if (!Number.isInteger(d.payment.net_days) || d.payment.net_days <= 0 || d.payment.net_days > MAX_TERM_DAYS) {
    errors.push({ field: "payment", message: `Payment terms: net days must be a whole number between 1 and ${MAX_TERM_DAYS}` })
  }
  if (d.payment.deposit_pct == null) {
    errors.push({ field: "payment", message: "Payment terms: deposit percentage is required" })
  } else if (!Number.isFinite(d.payment.deposit_pct) || d.payment.deposit_pct < 0 || d.payment.deposit_pct > 100) {
    errors.push({ field: "payment", message: "Payment terms: deposit must be between 0 and 100" })
  }
  if (!isTermState(d.payment.state)) {
    errors.push({ field: "payment", message: "Payment terms: select Firm, Negotiable, or Flexible" })
  }
  if (d.payment.note.length > MAX_NOTE_LENGTH) {
    errors.push({ field: "payment", message: `Payment terms: note must be ${MAX_NOTE_LENGTH} characters or fewer` })
  }

  // Kill / cancellation fee
  if (!d.kill_fee.fee_type) {
    errors.push({ field: "kill_fee", message: "Kill fee: select none, percent of fee, or flat amount" })
  } else if (d.kill_fee.fee_type !== "none") {
    if (d.kill_fee.amount == null || !Number.isFinite(d.kill_fee.amount) || d.kill_fee.amount < 0) {
      errors.push({ field: "kill_fee", message: "Kill fee: amount must be a non-negative number" })
    } else if (d.kill_fee.fee_type === "percent" && d.kill_fee.amount > 100) {
      errors.push({ field: "kill_fee", message: "Kill fee: percentage must be 100 or less" })
    }
  }
  if (!isTermState(d.kill_fee.state)) {
    errors.push({ field: "kill_fee", message: "Kill fee: select Firm, Negotiable, or Flexible" })
  }
  if (d.kill_fee.note.length > MAX_NOTE_LENGTH) {
    errors.push({ field: "kill_fee", message: `Kill fee: note must be ${MAX_NOTE_LENGTH} characters or fewer` })
  }

  // IP / usage rights
  if (!d.ip_rights.stance) {
    errors.push({ field: "ip_rights", message: "IP rights: select a stance" })
  }
  if (!isTermState(d.ip_rights.state)) {
    errors.push({ field: "ip_rights", message: "IP rights: select Firm, Negotiable, or Flexible" })
  }
  if (d.ip_rights.note.length > MAX_NOTE_LENGTH) {
    errors.push({ field: "ip_rights", message: `IP rights: note must be ${MAX_NOTE_LENGTH} characters or fewer` })
  }

  // Rate validity
  if (d.rate_validity.days == null) {
    errors.push({ field: "rate_validity", message: "Rate validity: number of days is required" })
  } else if (!Number.isInteger(d.rate_validity.days) || d.rate_validity.days <= 0 || d.rate_validity.days > MAX_TERM_DAYS) {
    errors.push({ field: "rate_validity", message: `Rate validity: days must be a whole number between 1 and ${MAX_TERM_DAYS}` })
  }
  if (!isTermState(d.rate_validity.state)) {
    errors.push({ field: "rate_validity", message: "Rate validity: select Firm, Negotiable, or Flexible" })
  }
  if (d.rate_validity.note.length > MAX_NOTE_LENGTH) {
    errors.push({ field: "rate_validity", message: `Rate validity: note must be ${MAX_NOTE_LENGTH} characters or fewer` })
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: d }
}

/** Prefills a fresh TermsDisclosure's payment.deposit_pct from the legacy payment_terms
 *  column so a signed-in partner editing a pre-feature bid isn't asked to retype data they
 *  already gave. Only fills fields the new disclosure doesn't already have. */
export function mergeLegacyPaymentTermsIntoDisclosure(
  disclosure: TermsDisclosure,
  legacyPaymentTerms: { deposit_required_pct?: number | null } | null | undefined
): TermsDisclosure {
  if (!legacyPaymentTerms || disclosure.payment.deposit_pct != null) return disclosure
  const legacyDeposit = legacyPaymentTerms.deposit_required_pct
  if (typeof legacyDeposit !== "number" || !Number.isFinite(legacyDeposit)) return disclosure
  return { ...disclosure, payment: { ...disclosure.payment, deposit_pct: legacyDeposit } }
}

function formatKillFee(d: KillFeeDisclosure): string | null {
  if (!d.fee_type) return null
  if (d.fee_type === "none") return "No kill fee"
  if (d.amount == null) return null
  return d.fee_type === "percent" ? `Kill fee ${d.amount}%` : `Kill fee $${d.amount.toLocaleString("en-US")}`
}

/** Compact summary line for bid cards, e.g. "Net 30 · 50% deposit (Firm) · Kill fee 25% (Neg) · WFH IP (Flex) · Rates 60d". */
export function formatTermsDisclosureSummary(d: TermsDisclosure): string {
  const parts: string[] = []

  if (d.payment.net_days != null) {
    const depositPart = d.payment.deposit_pct != null ? `, ${d.payment.deposit_pct}% deposit` : ""
    const statePart = d.payment.state ? ` (${TERM_STATE_ABBR[d.payment.state]})` : ""
    parts.push(`Net ${d.payment.net_days}${depositPart}${statePart}`)
  }

  const killFeeText = formatKillFee(d.kill_fee)
  if (killFeeText) {
    const statePart = d.kill_fee.fee_type !== "none" && d.kill_fee.state ? ` (${TERM_STATE_ABBR[d.kill_fee.state]})` : ""
    parts.push(`${killFeeText}${statePart}`)
  }

  if (d.ip_rights.stance) {
    const statePart = d.ip_rights.state ? ` (${TERM_STATE_ABBR[d.ip_rights.state]})` : ""
    parts.push(`${IP_RIGHTS_SHORT_LABELS[d.ip_rights.stance]}${statePart}`)
  }

  if (d.rate_validity.days != null) {
    const statePart = d.rate_validity.state ? ` (${TERM_STATE_ABBR[d.rate_validity.state]})` : ""
    parts.push(`Rates ${d.rate_validity.days}d${statePart}`)
  }

  return parts.join(" · ")
}
