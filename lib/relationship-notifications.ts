import type { SupabaseClient } from "@supabase/supabase-js"
import { buildBrandedEmailHtml, resolveOrgNotificationRecipients, sendTransactionalEmail } from "@/lib/email"
import { orgIdFromColumn } from "@/lib/entitlements"

/**
 * THE TWO VENDOR EMAILS FOR A SUSPENSION AND A TERMINATION. Reinstatement sends neither and
 * nothing else (docs/relationship-end-report.md, phase 3).
 *
 * EMAIL ONLY, AND THAT IS A STOP, NOT AN OVERSIGHT. The in-app half needs two new values in
 * notifications_type_check, which is a migration this run is forbidden to author. No existing
 * permitted type carries either act honestly: 'partnership_declined' means a VENDOR declined an
 * INVITATION. A type added to the NotificationType union without the CHECK raises 23514 inside
 * createOrgNotification, which catches, logs and returns false while the handler still returns
 * 200 (migration 095 documents three types that went six months out of sync that way). So no
 * in-app row is attempted. The values owed are 'partnership_suspended' and
 * 'partnership_terminated'; see the report's "what the migration session still owes".
 *
 * ORDER IS LOAD BEARING. recipients are resolved BEFORE the status is written, exactly as the
 * decline path does (app/api/partnerships/route.ts, the 085 ORDERING note): migration 085 removes
 * a terminated relationship from the commercial counterparty set, after which the profiles read
 * behind resolveOrgNotificationRecipients() can return nothing and the mail would be skipped
 * while the request still returned 200.
 *
 * COPY. The terminate message is the shape Greg accepted (what happened, what did not change,
 * where to go) with ONE sentence reworded and flagged: his second sentence was "You will not
 * receive new requests from them." That overclaims today. Only a pool broadcast checks the
 * partnership; an RFP typed to an email address or sent as a Lightning link does not
 * (docs/relationship-end-phase0.md section 2, rows 7 and 8). The sentence below says what the
 * pool does. Restore his wording in the change that closes those two paths.
 *
 * Nothing here says access is revoked or documents are withdrawn. The vendor keeps both today.
 * NO EM DASHES.
 */

export type VendorEndingAct = "suspend" | "terminate"

export type RelationshipEmailCopy = { subject: string; title: string; body: string }

export function relationshipEmailCopy(act: VendorEndingAct, agencyName: string): RelationshipEmailCopy {
  if (act === "terminate") {
    return {
      subject: `Your partnership with ${agencyName} has ended`,
      title: "Your partnership has ended",
      body: [
        `${agencyName} has ended their vendor partnership with you on Ligament. They will not be able to choose you for new requests from their vendor pool.`,
        "Work already awarded to you continues as normal, and your record of past work and payments stays in your account.",
        `If you have questions, speak with your contact at ${agencyName} directly.`,
      ].join("\n\n"),
    }
  }
  return {
    subject: `Your partnership with ${agencyName} is paused`,
    title: "Your partnership is paused",
    body: [
      `${agencyName} has paused their vendor partnership with you on Ligament. They will not be able to choose you for new requests from their vendor pool while it is paused.`,
      "Work already awarded to you continues as normal, and you can still see your current work, documents and payments in your account.",
      `This is a pause, not an ending. If you have questions, speak with your contact at ${agencyName} directly.`,
    ].join("\n\n"),
  }
}

export type RelationshipRecipient = { email: string; name: string }

export type ResolvedRelationshipAudience = {
  agencyName: string
  recipients: RelationshipRecipient[]
  /** False when the opt-out could not be read for these addresses (the partner_email fallback). */
  preferenceChecked: boolean
}

/**
 * Who to tell, and the agency's display name. Call BEFORE the status write (see above).
 *
 * 1. vendor_org_id set -> resolveOrgNotificationRecipients(), which SKIPS any member whose
 *    notification_preferences.email is exactly false. That is the preference toggle, respected.
 * 2. It resolved nobody and the row carries partner_email -> that address, with the opt-out
 *    unreadable and said so in the log. org_members has a self-row-only SELECT policy, so an
 *    agency reading a vendor organization's members legitimately gets zero rows; without this
 *    branch the vendors it matters most to would never be told. This is lib/email.ts:370-372's
 *    standing ruling ("send one too many, never go quiet") and the rfp-closure route's
 *    precedent, applied unchanged.
 */
export async function resolveRelationshipAudience(
  supabase: SupabaseClient,
  params: { leadOrgId: string; vendorOrgId: string | null; partnerEmail: string | null; route: string }
): Promise<ResolvedRelationshipAudience> {
  const { leadOrgId, vendorOrgId, partnerEmail, route } = params

  // Falls back to a neutral noun: "  has ended their vendor partnership" is worse than
  // "The lead agency has ended ...", and a subject line with a hole in it is worse still.
  let agencyName = "The lead agency"
  try {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", leadOrgId)
      .maybeSingle<{ name: string | null }>()
    if (org?.name && org.name.trim()) agencyName = org.name.trim()
  } catch (nameErr) {
    console.warn("[relationship-notifications] could not read the acting organization's name", {
      route,
      leadOrgId,
      message: nameErr instanceof Error ? nameErr.message : String(nameErr),
    })
  }

  let recipients: RelationshipRecipient[] = []
  let preferenceChecked = true
  const vendorId = orgIdFromColumn(vendorOrgId)
  if (vendorId) {
    try {
      const found = await resolveOrgNotificationRecipients(vendorId, supabase)
      recipients = found.map((r) => ({
        email: r.email,
        name: (r.full_name || r.company_name || "").trim() || "there",
      }))
    } catch (lookupErr) {
      console.error("[relationship-notifications] recipient lookup threw", {
        route,
        vendorOrgId,
        message: lookupErr instanceof Error ? lookupErr.message : String(lookupErr),
      })
    }
  }

  if (recipients.length === 0 && partnerEmail && partnerEmail.trim()) {
    recipients = [{ email: partnerEmail.trim(), name: "there" }]
    preferenceChecked = !vendorId
    if (!preferenceChecked) {
      console.warn(
        "[relationship-notifications] falling back to partner_email because the vendor organization " +
          "resolved no recipients. The notification_preferences opt-out could NOT be checked for this " +
          "send. See lib/email.ts:370-372 for why sending anyway is the ruling.",
        { route, vendorOrgId }
      )
    }
  }

  if (recipients.length === 0) {
    console.error(
      "[relationship-notifications] the partnership changed state and NOBODY COULD BE TOLD. No resolvable " +
        "recipient on the vendor organization and no partner_email on the row.",
      { route, vendorOrgId }
    )
  }

  return { agencyName, recipients, preferenceChecked }
}

/** Sends the act's email to each resolved recipient. Never throws: the status is already
 *  written, and a failed email must not turn a completed act into an error. Returns how many
 *  went out so the caller can log the count rather than infer it. */
export async function sendRelationshipEmails(
  act: VendorEndingAct,
  audience: ResolvedRelationshipAudience,
  route: string
): Promise<number> {
  const copy = relationshipEmailCopy(act, audience.agencyName)
  let sent = 0
  for (const to of audience.recipients) {
    try {
      const ok = await sendTransactionalEmail({
        to: to.email,
        subject: copy.subject,
        html: buildBrandedEmailHtml({
          title: copy.title,
          recipientName: to.name,
          body: copy.body,
        }),
      })
      if (ok) sent += 1
    } catch (emailErr) {
      console.error("[relationship-notifications] Resend send failed", {
        route,
        act,
        to: to.email,
        message: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }
  }
  return sent
}
