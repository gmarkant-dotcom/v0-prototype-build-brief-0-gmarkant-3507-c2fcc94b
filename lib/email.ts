import { Resend } from "resend"
import { formatDateTime } from "@/lib/utils"

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

export function buildVendorInvitationEmail(opts: {
  agencyName: string
  vendorName?: string
  projectName: string
  scopeSummary: string
  token: string
}): EmailPayload {
  const recipientName = (opts.vendorName || "").trim() || "there"
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

export function buildVendorConfirmationEmail(opts: {
  vendorName?: string
  vendorEmail: string
  projectName: string
  submittedAt: string
  budgetSummary: string
  timelineSummary: string
}): EmailPayload {
  const recipientName = (opts.vendorName || "").trim() || "there"
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

export function buildAgencyBidNotificationEmail(opts: {
  agencyRecipientName: string
  vendorNameOrEmail: string
  projectName: string
  proposalText: string
  budgetSummary: string
  timelineSummary: string
}): EmailPayload {
  const subject = `New bid received — ${opts.projectName}`
  const trimmedProposal = opts.proposalText.trim()
  const preview = trimmedProposal.slice(0, 150) + (trimmedProposal.length > 150 ? "…" : "")
  const body = `${opts.vendorNameOrEmail} has submitted a bid via your magic link invitation.\n\n"${preview}"\n\nBudget: ${opts.budgetSummary}\nTimeline: ${opts.timelineSummary}`
  const ctaUrl = "https://withligament.com/agency/bids"
  const ctaText = "View Bid in Dashboard"
  return {
    subject,
    html: buildBrandedEmailHtml({ title: subject, recipientName: opts.agencyRecipientName, body, ctaText, ctaUrl }),
    text: buildBrandedEmailText({ title: subject, recipientName: opts.agencyRecipientName, body, ctaText, ctaUrl }),
  }
}
