import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js"
import { generateGrantAccessToken } from "@/lib/grant-access-token"
import { buildBrandedEmailHtml, sendTransactionalEmail, siteBaseUrl } from "@/lib/email"

// The single address this route falls back to when the admin lookup returns
// nothing or errors. A misconfiguration must not be able to silence the signup
// notification entirely - after migration 078 this email is the only thing that
// announces a new account, which now lands unpaid.
const FALLBACK_RECIPIENT = "hello@withligament.com"

// Upper bound on how many admins get notified in one signup. Protects against a
// runaway is_admin backfill turning every signup into a mail storm.
const MAX_RECIPIENTS = 10

/**
 * Service-role Supabase client.
 *
 * This route is invoked by a Supabase database webhook with NO SESSION, so a
 * cookie-backed server client authenticates as `anon`. Every SELECT policy on
 * public.profiles is granted to `authenticated` only (docs/schema-snapshot-2026-08-13.md,
 * lines 199-212), and RLS is enabled on the table, so an anon read of profiles
 * returns zero rows - silently, with no error. Both the recipient lookup and the
 * company_name lookup below therefore have to use the service role.
 *
 * Only ever constructed after the webhook secret check has passed.
 */
function serviceClient(): SupabaseClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

/**
 * Every admin's email address, deduplicated and capped. Falls back to the single
 * fallback address if the query errors or comes back empty.
 */
async function resolveRecipients(supabase: SupabaseClient | null): Promise<string[]> {
  if (!supabase) return [FALLBACK_RECIPIENT]

  const { data, error } = await supabase.from("profiles").select("email").eq("is_admin", true)

  if (error) {
    console.error("[api/admin/notify-new-user] admin recipient lookup failed", error.message)
    return [FALLBACK_RECIPIENT]
  }

  const seen = new Set<string>()
  for (const row of data || []) {
    const email = String(row?.email || "")
      .trim()
      .toLowerCase()
    if (email.includes("@")) seen.add(email)
  }

  if (seen.size === 0) return [FALLBACK_RECIPIENT]
  return Array.from(seen).slice(0, MAX_RECIPIENTS)
}

// This route is intended to be called only by the Supabase DB webhook on new-user
// insert, never directly by a client. Require a shared secret so an unauthenticated
// caller cannot mint a signed grant-access token for an arbitrary user id.
export async function POST(req: Request) {
  try {
    const expectedSecret = process.env.WEBHOOK_SECRET
    const providedSecret = req.headers.get("x-webhook-secret")
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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

    // Constructed only now, after the secret check above has passed.
    const supabase = serviceClient()

    const { data: profile } = supabase
      ? await supabase.from("profiles").select("company_name, company_website").eq("id", id).maybeSingle()
      : { data: null }

    const recipients = await resolveRecipients(supabase)

    const notifyBody = [
      "A new user has created a Ligament account and is pending access review.",
      "",
      `User: ${email}`,
      `ID: ${id}`,
      `Company: ${profile?.company_name || "(set after onboarding)"}`,
      "Website: (set after onboarding)",
      `Signed up: ${signedUpAt}`,
      "",
      "Review and grant access from the Ligament admin panel.",
      "",
      `If the button does not work, copy and paste this URL into your browser:\n${grantUrl}`,
      "",
      "The Ligament Team",
      "withligament.com",
    ].join("\n")

    const html = buildBrandedEmailHtml({
      title: "New signup pending review",
      recipientName: "Ligament team",
      body: notifyBody,
      ctaText: "Grant Access",
      ctaUrl: grantUrl,
    })

    // One send per recipient rather than one send with everybody in BCC. Each admin
    // gets their own To: header, nobody sees who else was notified, and a single bad
    // address fails on its own instead of taking the whole notification with it.
    const results = await Promise.all(
      recipients.map((to) =>
        sendTransactionalEmail({
          to,
          subject: "New Ligament signup - review required",
          html,
        })
      )
    )

    const delivered = results.filter(Boolean).length

    if (delivered === 0) {
      throw new Error("Email send failed to every recipient, or RESEND_API_KEY not configured")
    }

    return NextResponse.json({ success: true, delivered, attempted: recipients.length })
  } catch (error) {
    Sentry.captureException(error)
    console.error("[api/admin/notify-new-user] failure", error)
    return NextResponse.json({ error: "Failed to notify about new user" }, { status: 500 })
  }
}
