import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { Resend } from "resend"
import { generateGrantAccessToken } from "@/lib/grant-access-token"
import { createClient } from "@/lib/supabase/server"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const record = body?.record as
      | {
          id?: unknown
          email?: unknown
          full_name?: unknown
          role?: unknown
        }
      | undefined

    const id = String(record?.id || "").trim()
    const email = String(record?.email || "").trim()

    if (!id || !email) {
      return NextResponse.json({ error: "Missing required record fields" }, { status: 500 })
    }

    const appUrlRaw = process.env.NEXT_PUBLIC_APP_URL || "https://www.withligament.com"
    const appUrl = appUrlRaw
      .replace(/\/$/, "")
      .replace("https://withligament.com", "https://www.withligament.com")
    const resendApiKey = process.env.RESEND_API_KEY

    if (!appUrl || !resendApiKey) {
      return NextResponse.json({ error: "Required environment variables are not configured" }, { status: 500 })
    }

    const token = generateGrantAccessToken(id)
    const grantUrl = `${appUrl}/api/admin/grant-access?user_id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`

    const signedUpAt =
      typeof body?.record?.created_at === "string" && body.record.created_at.trim()
        ? body.record.created_at.trim()
        : "Not provided"
    const supabase = await createClient()
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, company_website")
      .eq("id", id)
      .maybeSingle()

    const resend = new Resend(resendApiKey)
    const { error } = await resend.emails.send({
      from: "Ligament <notifications@withligament.com>",
      to: "hello@withligament.com",
      subject: "New Ligament signup - review required",
      html: `
        <div style="font-family: Arial, sans-serif; background: #f9fafb; padding: 24px; color: #111827;">
          <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px;">
            <h1 style="font-size: 22px; line-height: 1.3; margin: 0 0 16px;">New signup pending review</h1>
            <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
              A new user has created a Ligament account and is pending access review.
            </p>
            <p style="font-size: 16px; line-height: 1.6; margin: 0 0 8px;"><strong>User:</strong> ${escapeHtml(email)}</p>
            <p style="font-size: 16px; line-height: 1.6; margin: 0 0 8px;"><strong>ID:</strong> ${escapeHtml(id)}</p>
            <p style="font-size: 16px; line-height: 1.6; margin: 0 0 8px;"><strong>Company:</strong> ${escapeHtml(profile?.company_name || "Not provided")}</p>
            <p style="font-size: 16px; line-height: 1.6; margin: 0 0 8px;"><strong>Website:</strong> ${escapeHtml(profile?.company_website || "Not provided")}</p>
            <p style="font-size: 16px; line-height: 1.6; margin: 0 0 20px;"><strong>Signed up:</strong> ${escapeHtml(signedUpAt)}</p>
            <a
              href="${grantUrl}"
              style="display: block; width: 100%; box-sizing: border-box; text-align: center; background: #0C3535; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 16px; padding: 16px 20px; border-radius: 12px;"
            >
              Grant Access
            </a>
            <p style="font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
              Review and grant access from the Ligament admin panel.
            </p>
            <p style="font-size: 12px; line-height: 1.5; color: #6b7280; margin: 20px 0 0;">
              If the button does not work, copy and paste this URL into your browser:<br />
              <span style="word-break: break-all;">${escapeHtml(grantUrl)}</span>
            </p>
            <p style="font-size: 12px; line-height: 1.5; color: #6b7280; margin: 20px 0 0;">
              The Ligament Team<br />
              <a href="https://www.withligament.com" style="color: #6b7280;">withligament.com</a>
            </p>
          </div>
        </div>
      `,
    })

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    Sentry.captureException(error)
    console.error("[api/admin/notify-new-user] failure", error)
    return NextResponse.json({ error: "Failed to notify about new user" }, { status: 500 })
  }
}
