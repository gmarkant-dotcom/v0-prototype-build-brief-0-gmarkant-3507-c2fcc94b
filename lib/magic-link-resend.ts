/**
 * F7. WHAT A LIGHTNING RESEND MAY WRITE. Pure, so the rule is tested without a database
 * (lib/magic-link-resend.test.ts).
 *
 * A resend is the "Resend" button on a pending guest invitation
 * (components/agency-rfp-magic-link-invite.tsx). It carries only the vendor's email, name and
 * project. It used to go through the same upsert as a first send, which writes every content
 * column unconditionally, so a resend blanked the token's evaluation criteria, budget
 * categories, reference materials, business criteria, scope item and client release, and moved
 * its rfp_line_id onto a new, empty RFP record.
 *
 * A resend is now an UPDATE of the renewal columns below and nothing else. Every content column
 * keeps the value the first send wrote, whatever the request body says.
 */

/** The only token columns a resend writes. Anything not listed is left as it is. */
export const RESEND_WRITABLE_TOKEN_COLUMNS = [
  "token",
  "expires_at",
  "vendor_name",
  "status",
  "submitted_at",
  "response_deadline",
] as const

export type ResendWritableColumn = (typeof RESEND_WRITABLE_TOKEN_COLUMNS)[number]

/** Same 72-hour window as a first send (app/api/agency/rfp/magic-link/route.ts). */
export const MAGIC_LINK_TTL_MS = 72 * 60 * 60 * 1000

/** An explicit flag only. A body without it is a first send, exactly as before. */
export function isResendRequest(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as Record<string, unknown>).resend === true
}

export type ResendExistingToken = {
  token: string
  expires_at: string
  response_id: string | null
  vendor_name: string | null
  /** Undefined when the column could not be read (pre-074); the deadline is then not touched. */
  response_deadline?: string | null
}

export type ResendPlan = {
  patch: Partial<Record<ResendWritableColumn, string | null>>
  token: string
  expiresAt: string
  /** The deadline after the resend, and whether this resend changed it. */
  responseDeadline: string | null
  deadlineChanged: boolean
  priorDeadline: string | null
  priorDeadlineKnown: boolean
}

export function planMagicLinkResend(input: {
  existing: ResendExistingToken
  /** The name in the request, trimmed; null or empty keeps the stored name. */
  requestVendorName: string | null
  nowMs: number
  mintToken: () => string
  /** defaultResponseDeadlineIso() at nowMs, passed in so this module stays pure. */
  defaultDeadlineIso: string
}): ResendPlan {
  const { existing, nowMs } = input
  const expired = new Date(existing.expires_at).getTime() <= nowMs
  // Same rule as a first send: a live token is reused so the link in the vendor's inbox keeps
  // working, an expired one is replaced.
  const token = expired ? input.mintToken() : existing.token
  const expiresAt = new Date(nowMs + MAGIC_LINK_TTL_MS).toISOString()

  const patch: ResendPlan["patch"] = { expires_at: expiresAt }
  if (token !== existing.token) patch.token = token

  const name = (input.requestVendorName || "").trim()
  if (name && name !== (existing.vendor_name || "")) patch.vendor_name = name

  // A submitted bid's linkage survives a resend, as on a first send. An unsubmitted token goes
  // back to pending (the guest GET marks a lapsed one 'expired').
  if (!existing.response_id) {
    patch.status = "pending"
    patch.submitted_at = null
  }

  // The deadline the agency set is kept while it is still ahead. Only a missing or passed one is
  // replaced with the default horizon (R1), so a re-invited vendor is never sent into a window
  // that has already closed. Unknown (column unread) is never touched.
  const priorDeadlineKnown = existing.response_deadline !== undefined
  const priorDeadline = existing.response_deadline ?? null
  let responseDeadline = priorDeadline
  if (priorDeadlineKnown) {
    const priorMs = priorDeadline ? new Date(priorDeadline).getTime() : Number.NaN
    if (!Number.isFinite(priorMs) || priorMs <= nowMs) {
      responseDeadline = input.defaultDeadlineIso
      patch.response_deadline = responseDeadline
    }
  }

  return {
    patch,
    token,
    expiresAt,
    responseDeadline,
    deadlineChanged: priorDeadlineKnown && responseDeadline !== priorDeadline,
    priorDeadline,
    priorDeadlineKnown,
  }
}
