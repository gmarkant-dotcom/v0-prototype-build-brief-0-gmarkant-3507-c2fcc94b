import { Resend } from "resend"

const defaultFrom = "Ligament <notifications@withligament.com>"

export async function sendTransactionalEmail(opts: {
  to: string
  subject: string
  html: string
  from?: string
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
    })
    return true
  } catch (e) {
    console.error("sendTransactionalEmail failed:", e)
    return false
  }
}

export function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://withligament.com"
  )
}
