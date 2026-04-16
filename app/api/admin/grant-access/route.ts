import { createClient } from "@supabase/supabase-js"
import { verifyGrantAccessToken } from "@/lib/grant-access-token"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

function invalidLinkResponse() {
  return htmlResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Invalid Link</title>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 40px; color: #111827;">
    <h1 style="font-size: 24px; margin-bottom: 12px;">This link is invalid or has expired.</h1>
  </body>
</html>`,
    403
  )
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get("user_id")?.trim() || ""
    const token = searchParams.get("token")?.trim() || ""

    if (!userId || !token) {
      return invalidLinkResponse()
    }

    let isValid = false
    try {
      isValid = verifyGrantAccessToken(userId, token)
    } catch {
      isValid = false
    }

    if (!isValid) {
      return invalidLinkResponse()
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return invalidLinkResponse()
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("id", userId)
      .maybeSingle()

    if (profileError || !profile) {
      return invalidLinkResponse()
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ is_paid: true, updated_at: new Date().toISOString() })
      .eq("id", userId)

    if (updateError) {
      return invalidLinkResponse()
    }

    const safeEmail = escapeHtml(String(profile.email || "Unknown email"))

    return htmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Access Granted</title>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 40px; color: #111827;">
    <h1 style="font-size: 24px; margin-bottom: 12px;">Access granted.</h1>
    <p style="font-size: 16px; margin: 0;">${safeEmail}</p>
  </body>
</html>`)
  } catch {
    return invalidLinkResponse()
  }
}
