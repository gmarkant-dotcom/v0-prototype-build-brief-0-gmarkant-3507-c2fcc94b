import { callerOwnsOrg, type OrgId } from "@/lib/entitlements"
export type PartnerInboxAccessResult =
  | { allowed: true }
  | { allowed: false; reason: "not_found" | "nda_required" | "unauthorized" }

/**
 * Defense-in-depth access check for partner_rfp_inbox rows.
 * A row is partner-readable when:
 * 1) linked by vendor_org_id, OR
 * 2) addressed by recipient_email matching the signed-in profile email.
 * NDA gate is enforced after ownership checks.
 *
 * 079: THE SECOND PARAMETER CHANGED FROM A USER ID TO THE CALLER'S ORGANIZATION IDS.
 *
 * `partner_rfp_inbox.vendor_org_id` is an ORGANIZATION id. This function used to compare
 * it to the caller's user id, which is correct only while every organization id happens to
 * equal its founding user's, and silently denies every vendor whose organization the
 * PHASE 12 trigger created. Since this is an authorization check, "silently denies" is the
 * safe direction and therefore the one nobody would have noticed until a vendor reported
 * that their own RFP was unreadable.
 *
 * It takes the resolved set rather than a user id and a client on purpose: this function is
 * synchronous and pure, it is called from four routes that have already loaded the caller,
 * and making it async to do its own lookup would put a database round trip inside an
 * access check that four callers make on every request. Each caller resolves once and
 * passes the result in.
 *
 * An empty array denies by id, which is correct: a caller who belongs to no organization
 * owns no inbox row. The recipient_email branch is unaffected and still applies.
 */
export function partnerCanAccessPartnerRfpInbox(
  inbox: {
    vendor_org_id: string | null
    recipient_email: string | null
    nda_gate_enforced?: boolean | null
    nda_confirmed_at?: string | null
  },
  callerOrgIds: readonly OrgId[],
  profileEmail: string | null | undefined
): PartnerInboxAccessResult {
  const linkedById = callerOwnsOrg(callerOrgIds, inbox.vendor_org_id)
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
