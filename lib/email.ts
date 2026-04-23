import { Resend } from "resend"

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
      <p style="color:#9BB8B8;font-size:13px;margin:28px 0 0 0;line-height:1.6;">
        The Ligament Team<br />
        <a href="${escapeHtml(base)}" style="color:#C8F53C;text-decoration:none;">withligament.com</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

export async function sendTransactionalEmail(opts: {
  to: string
  subject: string
  html: string
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
