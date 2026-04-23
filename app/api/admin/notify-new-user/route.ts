import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { generateGrantAccessToken } from "@/lib/grant-access-token"
import { createClient } from "@/lib/supabase/server"
import { buildBrandedEmailHtml, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const record = body?.record as
      | {
          id?: unknown
          email?: unknown
          full_name?: unknown
          role?: unknown
          created_at?: unknown
        }
      | undefined

    const id = String(record?.id || "").trim()
    const email = String(record?.email || "").trim()

    if (!id || !email) {
      return NextResponse.json({ error: "Missing required record fields" }, { status: 500 })
    }

    const appUrlRaw = process.env.NEXT_PUBLIC_APP_URL || siteBaseUrl()
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

    const notifyBody = [
      "A new user has created a Ligament account and is pending access review.",
      "",
      `User: ${email}`,
      `ID: ${id}`,
      `Company: ${profile?.company_name || "Not provided"}`,
      `Website: ${profile?.company_website || "Not provided"}`,
      `Signed up: ${signedUpAt}`,
      "",
      "Review and grant access from the Ligament admin panel.",
      "",
      `If the button does not work, copy and paste this URL into your browser:\n${grantUrl}`,
    ].join("\n")

    const sent = await sendTransactionalEmail({
      to: "hello@withligament.com",
      subject: "New Ligament signup - review required",
      html: buildBrandedEmailHtml({
        title: "New signup pending review",
        recipientName: "Ligament team",
        body: notifyBody,
        ctaText: "Grant Access",
        ctaUrl: grantUrl,
      }),
    })

    if (!sent) {
      throw new Error("Email send failed or RESEND_API_KEY not configured")
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    Sentry.captureException(error)
    console.error("[api/admin/notify-new-user] failure", error)
    return NextResponse.json({ error: "Failed to notify about new user" }, { status: 500 })
  }
}
