import { Resend } from "resend"
import { formatDateTime } from "@/lib/utils"
import type { OrgId } from "@/lib/entitlements"

const defaultFrom = "Ligament <notifications@withligament.com>"

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Ligament branded transactional email shell (dark card, lime CTA).
 * Pass plain-text `body`; it is split on blank lines into paragraphs and HTML-escaped.
 */
export function buildBrandedEmailHtml(opts: {
  title: string
  recipientName: string
  body: string
  ctaText?: string
  ctaUrl?: string
  /** Small muted line (may contain a trusted <a> link) rendered above the signoff, e.g. a low-emphasis secondary link. */
  footerNote?: string
}): string {
  const base = siteBaseUrl()
  const safeRecipient = escapeHtml((opts.recipientName || "there").trim()) || "there"
  const safeTitle = escapeHtml(opts.title.trim())
  const paragraphs = opts.body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="color:#9BB8B8;font-size:16px;line-height:1.7;margin:0 0 16px 0;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`
    )
    .join("")
  const ctaBlock =
    opts.ctaText && opts.ctaUrl
      ? `<p style="margin:8px 0 0 0;"><a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:#C8F53C;color:#0C3535;text-decoration:none;padding:16px 32px;border-radius:10px;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(opts.ctaText)}</a></p>`
      : ""
  const footerNoteBlock = opts.footerNote
    ? `<p style="color:#6E8A8A;font-size:12px;margin:16px 0 0 0;line-height:1.6;">${opts.footerNote}</p>`
    : ""
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#081F1F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:#0C3535;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.12);">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#C8F53C;margin:0 0 16px 0;">Ligament</div>
      <p style="color:#E8E8E8;font-size:16px;line-height:1.6;margin:0 0 16px 0;">Hi ${safeRecipient},</p>
      <p style="color:#FFFFFF;font-size:20px;line-height:1.4;margin:0 0 20px 0;font-weight:700;">${safeTitle}</p>
      ${paragraphs}
      ${ctaBlock}
      ${footerNoteBlock}
      <p style="color:#9BB8B8;font-size:13px;margin:28px 0 0 0;line-height:1.6;">
        The Ligament Team<br />
        <a href="${escapeHtml(base)}" style="color:#C8F53C;text-decoration:none;">withligament.com</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

/** Plain-text counterpart to buildBrandedEmailHtml, for Resend's `text` fallback. */
export function buildBrandedEmailText(opts: {
  title: string
  recipientName: string
  body: string
  ctaText?: string
  ctaUrl?: string
  footerNoteText?: string
}): string {
  const recipient = (opts.recipientName || "there").trim() || "there"
  const lines = [`Hi ${recipient},`, "", opts.title.trim(), "", opts.body.trim()]
  if (opts.ctaText && opts.ctaUrl) {
    lines.push("", `${opts.ctaText}: ${opts.ctaUrl}`)
  }
  if (opts.footerNoteText) {
    lines.push("", opts.footerNoteText)
  }
  lines.push("", "The Ligament Team", siteBaseUrl())
  return lines.join("\n")
}

export async function sendTransactionalEmail(opts: {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
  cc?: string | string[]
  bcc?: string | string[]
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn("RESEND_API_KEY not set; skipping email to", opts.to)
    return false
  }
  try {
    const resend = new Resend(key)
    await resend.emails.send({
      from: opts.from || defaultFrom,
      to: opts.to.trim(),
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.cc ? { cc: opts.cc } : {}),
      ...(opts.bcc ? { bcc: opts.bcc } : {}),
    })
    return true
  } catch (e) {
    console.error("sendTransactionalEmail failed:", e)
    return false
  }
}

export function siteBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://www.withligament.com"
  if (raw === "https://withligament.com") return "https://www.withligament.com"
  if (raw.startsWith("https://withligament.com/")) {
    return raw.replace("https://withligament.com/", "https://www.withligament.com/")
  }
  return raw
}

// ── RFP magic-link guest flow email templates ──────────────────────────────

type EmailPayload = { subject: string; html: string; text: string }

/**
 * Resolves a greeting name from a free-text vendor_name field. Vendor name is typed by the
 * agency at invite time (not the vendor), so it can hold anything - a stray number, an
 * abbreviation, an empty string. Only greet by name when the value actually contains a
 * letter; otherwise fall back to "there" rather than greet "Hi 65,". Never derives a name
 * from the email address - an absent/invalid name always falls back to "there", not a
 * guess based on the local part of the vendor's email.
 */
function resolveGreetingName(rawName: string | null | undefined): string {
  const trimmed = (rawName || "").trim()
  if (!trimmed || !/[a-zA-Z]/.test(trimmed)) return "there"
  return trimmed
}

export function buildVendorInvitationEmail(opts: {
  agencyName: string
  vendorName?: string
  projectName: string
  scopeSummary: string
  token: string
}): EmailPayload {
  const recipientName = resolveGreetingName(opts.vendorName)
  const subject = `${opts.agencyName} invited you to bid on ${opts.projectName}`
  const ctaUrl = `https://withligament.com/rfp/respond/${opts.token}`
  const ctaText = "View Brief & Submit Bid"
  const body = `${opts.scopeSummary}\n\nThis invitation expires in 72 hours.`
  return {
    subject,
    html: buildBrandedEmailHtml({ title: subject, recipientName, body, ctaText, ctaUrl }),
    text: buildBrandedEmailText({ title: subject, recipientName, body, ctaText, ctaUrl }),
  }
}

/**
 * COLLEAGUE invitation - somebody being invited into their own company's Ligament account.
 *
 * NOT buildVendorInvitationEmail() above, which invites another COMPANY to bid on a brief
 * and points at /rfp/respond/<token>. These two are one word apart and nothing else apart,
 * so the distinction is stated here rather than left to the reader.
 *
 * TWO CALL-TO-ACTION SHAPES, chosen by the caller from hasLigamentAccount(), exactly as
 * app/api/partnerships/route.ts:590-591 already does for the vendor path:
 *
 *   HAS AN ACCOUNT      -> /join/<token>. Middleware bounces them to
 *                          /auth/login?next=/join/<token> if the session has lapsed, and
 *                          `next` is in the passthrough list, so they land back here.
 *   HAS NO ACCOUNT      -> /auth/sign-up carrying email and next=/join/<token>, so the
 *                          address is pre-filled and the invitation is waiting after signup.
 *
 * The token is NOT rendered as text anywhere in the body. It is a bearer credential and it
 * belongs in the href and nowhere else - the same rule the magic-link route states at :439.
 */
export function buildColleagueInvitationEmail(opts: {
  /** The company doing the inviting. */
  orgName: string
  /** Who sent it, for the body. May be absent - never guessed from an email address. */
  inviterName?: string | null
  /** The invitee's address, used only to prefill signup. */
  inviteeEmail: string
  /** Role label as the invitee will hold it: "Owner", "Admin", "Member". */
  roleLabel: string
  token: string
  /** True when this address already has a Ligament login. Picks the call to action. */
  hasAccount: boolean
  /** How many days the invitation is good for. Stated in the body, never assumed. */
  expiresInDays: number
}): EmailPayload {
  const base = siteBaseUrl()
  const landing = `${base}/join/${encodeURIComponent(opts.token)}`
  const ctaUrl = opts.hasAccount
    ? landing
    : `${base}/auth/sign-up?email=${encodeURIComponent(opts.inviteeEmail)}&next=${encodeURIComponent(`/join/${opts.token}`)}`
  const ctaText = opts.hasAccount ? "View Invitation" : "Create Your Account"

  const inviter = resolveGreetingName(opts.inviterName)
  const subject = `You have been invited to join ${opts.orgName} on Ligament`
  const openedBy = inviter === "there" ? `Someone at ${opts.orgName}` : `${inviter} at ${opts.orgName}`

  const body = opts.hasAccount
    ? `${openedBy} has invited you to join their team on Ligament as ${opts.roleLabel.toLowerCase()}.

Sign in and accept to get access to their projects, briefs and vendors. Your own account stays exactly as it is.

This invitation expires in ${opts.expiresInDays} days. If you were not expecting it, you can decline, and nothing is shared with them either way.`
    : `${openedBy} has invited you to join their team on Ligament as ${opts.roleLabel.toLowerCase()}.

Create your account and the invitation will be waiting. It takes a minute.

This invitation expires in ${opts.expiresInDays} days. If you were not expecting it, you can ignore this email.`

  return {
    subject,
    html: buildBrandedEmailHtml({ title: subject, recipientName: "there", body, ctaText, ctaUrl }),
    text: buildBrandedEmailText({ title: subject, recipientName: "there", body, ctaText, ctaUrl }),
  }
}

export function buildVendorConfirmationEmail(opts: {
  vendorName?: string
  vendorEmail: string
  projectName: string
  submittedAt: string
  budgetSummary: string
  timelineSummary: string
}): EmailPayload {
  const recipientName = resolveGreetingName(opts.vendorName)
  const subject = `Your bid has been submitted — ${opts.projectName}`
  const submittedDisplay = formatDateTime(opts.submittedAt)
  const body = `We've received your bid for ${opts.projectName}, submitted ${submittedDisplay}.\n\nBudget: ${opts.budgetSummary}\nTimeline: ${opts.timelineSummary}\n\nThe agency will review your bid and be in touch.`
  const signUpUrl = `https://withligament.com/auth/sign-up?email=${encodeURIComponent(opts.vendorEmail)}&source=magic_link`
  return {
    subject,
    html: buildBrandedEmailHtml({
      title: subject,
      recipientName,
      body,
      footerNote: `Want to track this bid? <a href="${escapeHtml(signUpUrl)}" style="color:#C8F53C;text-decoration:none;">Create your Ligament profile</a>`,
    }),
    text: buildBrandedEmailText({
      title: subject,
      recipientName,
      body,
      footerNoteText: `Want to track this bid? Create your Ligament profile: ${signUpUrl}`,
    }),
  }
}

export function buildAgencyPoolNotificationEmail(opts: {
  agencyRecipientName: string
  vendorNameOrEmail: string
  vendorEmail: string
  proposalText: string
  budgetSummary: string
  timelineSummary: string
}): EmailPayload {
  const subject = `${opts.vendorNameOrEmail} was added to your vendor pool`
  const trimmedProposal = opts.proposalText.trim()
  const preview = trimmedProposal.slice(0, 150) + (trimmedProposal.length > 150 ? "..." : "")
  const body = `${opts.vendorNameOrEmail} (${opts.vendorEmail}) submitted a bid via your magic link invitation and has been added to your vendor pool.\n\n"${preview}"\n\nBudget: ${opts.budgetSummary}\nTimeline: ${opts.timelineSummary}`
  const ctaUrl = `${siteBaseUrl()}/agency/pool`
  const ctaText = "View Vendor Pool"
  return {
    subject,
    html: buildBrandedEmailHtml({ title: subject, recipientName: opts.agencyRecipientName, body, ctaText, ctaUrl }),
    text: buildBrandedEmailText({ title: subject, recipientName: opts.agencyRecipientName, body, ctaText, ctaUrl }),
  }
}

export function buildAgencyBidNotificationEmail(opts: {
  agencyRecipientName: string
  vendorNameOrEmail: string
  projectName: string
  scopeItemName: string
  proposalText: string
  budgetSummary: string
  timelineSummary: string
  isRevision?: boolean
}): EmailPayload {
  const subject = opts.isRevision
    ? `${opts.vendorNameOrEmail} updated their bid on ${opts.scopeItemName}`
    : `${opts.vendorNameOrEmail} submitted a bid on ${opts.scopeItemName}`
  const trimmedProposal = opts.proposalText.trim()
  const preview = trimmedProposal.slice(0, 150) + (trimmedProposal.length > 150 ? "..." : "")
  const body = `${opts.vendorNameOrEmail} has ${opts.isRevision ? "submitted a revised bid" : "submitted a bid"} for ${opts.scopeItemName} on ${opts.projectName}.\n\n"${preview}"\n\nBudget: ${opts.budgetSummary}\nTimeline: ${opts.timelineSummary}`
  const ctaUrl = `${siteBaseUrl()}/agency/bids`
  const ctaText = "View Bid in Bid Management"
  return {
    subject,
    html: buildBrandedEmailHtml({
      title: opts.isRevision ? "Vendor bid updated" : "New vendor bid",
      recipientName: opts.agencyRecipientName,
      body,
      ctaText,
      ctaUrl,
    }),
    text: buildBrandedEmailText({
      title: opts.isRevision ? "Vendor bid updated" : "New vendor bid",
      recipientName: opts.agencyRecipientName,
      body,
      ctaText,
      ctaUrl,
    }),
  }
}

/**
 * A Supabase client, narrowed to the two queries the recipient resolver makes. Loose for
 * the same reason as lib/entitlements.ts: naming the real builder type reaches TS2589, and
 * this repository has no generated `Database` types for a strict signature to check
 * against.
 */
export type RecipientLookupClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

export type OrgRecipient = {
  email: string
  full_name: string | null
  company_name: string | null
}

/**
 * Who receives a notification addressed to an ORGANIZATION.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FUNCTION EXISTS, AND WHY IT IS THE MOST DANGEROUS THING 079 TOUCHES
 *
 * Before 079, every agency-facing and vendor-facing notification resolved its recipient as
 * `profiles.email WHERE id = <a company id>`, because a company id WAS a user id. Under
 * the organization model that lookup is wrong, and the way it is wrong is the worst
 * available: it keeps working for every organization 079 backfilled, because their id
 * equals the founding user's id, and returns NOTHING for every organization created
 * afterwards. It fails late, for new customers only, and it does not throw.
 *
 * Ten of the eleven call sites used `.maybeSingle()` behind an `if (recipientEmail)` guard,
 * so the send was simply skipped with no log line. Agency notifications stopping quietly is
 * the worst outcome this rename could produce. Every one of them now routes through here.
 *
 * ---------------------------------------------------------------------------
 * THE RULING THIS ENCODES: EVERY MEMBER, WITH AN OPT-OUT
 *
 * docs/079-rename-plan.md section 7 put three options: the owner only, every member, or a
 * per-member preference. This implements "every member, with profiles.notification_preferences
 * as the opt-out", which the plan recommends, for the reason it gives: it is the only option
 * under which a colleague can act on an RFP that arrived while the founder was away, and it
 * is the only one that does not silently make the product worse for the second person who
 * joins. The storage for the opt-out already exists - notification_preferences has been jsonb
 * on profiles since scripts/017.
 *
 * The opt-out is read as `notification_preferences.email === false`. Anything else, including
 * an absent key and an absent row, is opted IN. A null preference is not an opt-out: the
 * failure direction for a notification system is to send one too many, never to go quiet.
 *
 * ---------------------------------------------------------------------------
 * THE FALLBACK, AND WHY IT IS NOT A BUG
 *
 * When org_members yields nothing - a lookup failure, or an org id that is really a
 * pre-079 user id passed by a caller not yet converted - this falls back to
 * `profiles WHERE id = orgId`, which is exactly the pre-079 behaviour and is CORRECT for
 * all sixteen backfilled organizations, whose id equals their founder's user id. It logs
 * when it does so. The fallback is what keeps the eleven sites working through the release
 * window rather than going silent in it; it is not a substitute for membership and it will
 * return nothing for an organization created after 079, which is exactly when the log line
 * matters.
 *
 * Returns [] when there is genuinely nobody to write to. Callers must log that rather than
 * skipping quietly - `if (recipients.length === 0)` is the guard that used to be
 * `if (recipientEmail)` and used to say nothing.
 */
export async function resolveOrgNotificationRecipients(
  orgId: OrgId | null | undefined,
  client: RecipientLookupClient
): Promise<OrgRecipient[]> {
  if (!orgId) return []

  const { data: members, error: memberErr } = await client
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)

  if (memberErr) {
    console.error("[email] resolveOrgNotificationRecipients: org_members lookup failed", {
      orgId,
      code: memberErr.code,
      message: memberErr.message,
    })
  }

  const userIds = ((members ?? []) as Array<{ user_id?: string | null }>)
    .map((m) => m.user_id)
    .filter((id): id is string => Boolean(id))

  const lookupIds = userIds.length > 0 ? userIds : [orgId]
  if (userIds.length === 0) {
    console.warn(
      "[email] resolveOrgNotificationRecipients: no org_members rows, falling back to the " +
        "pre-079 profiles lookup. Correct for a backfilled organization, silent for one " +
        "created after 079.",
      { orgId }
    )
  }

  const { data: profiles, error: profileErr } = await client
    .from("profiles")
    .select("id, email, full_name, company_name, notification_preferences")
    .in("id", lookupIds)

  if (profileErr) {
    console.error("[email] resolveOrgNotificationRecipients: profiles lookup failed", {
      orgId,
      code: profileErr.code,
      message: profileErr.message,
    })
    return []
  }

  type Row = {
    email?: string | null
    full_name?: string | null
    company_name?: string | null
    notification_preferences?: { email?: unknown } | null
  }

  const recipients: OrgRecipient[] = []
  for (const row of (profiles ?? []) as Row[]) {
    const email = row.email?.trim()
    if (!email) continue
    // Opted out only on an explicit false. Absent, null and malformed all mean opted in.
    if (row.notification_preferences?.email === false) continue
    recipients.push({
      email,
      full_name: row.full_name ?? null,
      company_name: row.company_name ?? null,
    })
  }

  if (recipients.length === 0) {
    console.warn("[email] resolveOrgNotificationRecipients resolved nobody", { orgId, lookupIds })
  }
  return recipients
}
