/**
 * Whether the signed-in partner may access a partner_rfp_inbox row (defense in depth on top of RLS).
 * Matches list semantics: linked partner_id OR email invitation before claim.
 */
export function partnerCanAccessPartnerRfpInbox(
  inbox: { partner_id: string | null; recipient_email: string | null },
  userId: string,
  profileEmail: string | null | undefined
): boolean {
  if (inbox.partner_id === userId) return true
  const rec = (inbox.recipient_email || "").trim().toLowerCase()
  const pe = (profileEmail || "").trim().toLowerCase()
  return Boolean(rec && pe && rec === pe)
}
