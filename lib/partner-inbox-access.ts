export type PartnerInboxAccessResult =
  | { allowed: true }
  | { allowed: false; reason: "not_found" | "nda_required" | "unauthorized" }

/**
 * Defense-in-depth access check for partner_rfp_inbox rows.
 * A row is partner-readable when:
 * 1) linked by partner_id, OR
 * 2) addressed by recipient_email matching the signed-in profile email.
 * NDA gate is enforced after ownership checks.
 */
export function partnerCanAccessPartnerRfpInbox(
  inbox: {
    partner_id: string | null
    recipient_email: string | null
    nda_gate_enforced?: boolean | null
    nda_confirmed_at?: string | null
  },
  userId: string,
  profileEmail: string | null | undefined
): PartnerInboxAccessResult {
  const linkedById = inbox.partner_id === userId
  const rec = (inbox.recipient_email || "").trim().toLowerCase()
  const pe = (profileEmail || "").trim().toLowerCase()
  const linkedByEmail = Boolean(rec && pe && rec === pe)

  if (!linkedById && !linkedByEmail) {
    return { allowed: false, reason: "unauthorized" }
  }

  if (inbox.nda_gate_enforced && !inbox.nda_confirmed_at) {
    return { allowed: false, reason: "nda_required" }
  }

  return { allowed: true }
}
