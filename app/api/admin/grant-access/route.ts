import { createClient } from "@supabase/supabase-js"
import * as Sentry from "@sentry/nextjs"
import { verifyGrantAccessToken } from "@/lib/grant-access-token"
import { requireAdminRole } from "@/lib/api-auth"
import { resolveOrgIdForUser } from "@/lib/entitlements"

/**
 * Why this route is shaped the way it is.
 *
 * It is the "Grant Access" button inside the new-signup notification email sent to
 * hello@withligament.com by app/api/admin/notify-new-user. That makes it human-invoked, but
 * invoked by clicking a link in an inbox rather than from a page inside the app.
 *
 * The defect fixed here is NOT a secret in the query string. The query string carries a
 * user-scoped HMAC-SHA256 signature with a 24 hour expiry, compared with timingSafeEqual
 * (lib/grant-access-token.ts); GRANT_ACCESS_SECRET itself never leaves the server. The real
 * defect was that GET performed the write. Anything that follows a link without a human
 * deciding to - a mail scanner, a corporate security gateway, a link preview unfurler, a
 * browser prefetcher - silently granted paid access simply by touching the URL.
 *
 * So the two verbs are split:
 *   GET  verifies the token and renders a confirmation form. It mutates nothing, which
 *        makes it safe for anything that follows links automatically.
 *   POST performs the grant, and additionally requires an admin session. There is no
 *        query-string path that still writes.
 *
 * Check order is deliberate: the token is verified before the session, so a caller without
 * a valid token always gets the same generic "invalid or expired" 403 and cannot use this
 * route to probe for the existence of an admin surface. The more descriptive sign-in
 * message is only reachable by someone already holding a valid, unexpired, correctly
 * signed token.
 */

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

function page(title: string, heading: string, bodyHtml = "", status = 200) {
  return htmlResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 40px; color: #111827;">
    <h1 style="font-size: 24px; margin-bottom: 12px;">${escapeHtml(heading)}</h1>
    ${bodyHtml}
  </body>
</html>`,
    status
  )
}

/** Single generic failure for every bad, expired, tampered or missing token. */
function invalidLinkResponse() {
  return page("Invalid Link", "This link is invalid or has expired.", "", 403)
}

function readParams(url: string) {
  const { searchParams } = new URL(url)
  return {
    userId: searchParams.get("user_id")?.trim() || "",
    token: searchParams.get("token")?.trim() || "",
  }
}

function tokenIsValid(userId: string, token: string): boolean {
  if (!userId || !token) return false
  try {
    return verifyGrantAccessToken(userId, token)
  } catch {
    return false
  }
}

/** Renders the confirmation form. Performs no write of any kind. */
export async function GET(req: Request) {
  try {
    const { userId, token } = readParams(req.url)
    if (!tokenIsValid(userId, token)) return invalidLinkResponse()

    const form = `
    <p style="font-size: 16px; margin: 0 0 24px;">
      Granting access sets this account to paid. You must be signed in to Ligament as an
      admin for this to take effect.
    </p>
    <form method="POST" action="/api/admin/grant-access">
      <input type="hidden" name="user_id" value="${escapeHtml(userId)}" />
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <button type="submit" style="font-size: 16px; padding: 12px 20px; border: 0; border-radius: 8px; background: #0C3535; color: #ffffff; cursor: pointer;">
        Grant access
      </button>
    </form>`

    return page("Confirm access grant", "Confirm access grant", form)
  } catch (error) {
    Sentry.captureException(error)
    return invalidLinkResponse()
  }
}

/** Performs the grant. Requires a valid token AND an admin session. */
export async function POST(req: Request) {
  try {
    // The form posts url-encoded; accept a JSON body too so the route stays scriptable.
    let userId = ""
    let token = ""
    const contentType = req.headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}))
      userId = String(body?.user_id || "").trim()
      token = String(body?.token || "").trim()
    } else {
      const form = await req.formData().catch(() => null)
      userId = String(form?.get("user_id") || "").trim()
      token = String(form?.get("token") || "").trim()
    }

    // Token before session, so a caller without a valid token learns nothing.
    if (!tokenIsValid(userId, token)) return invalidLinkResponse()

    const auth = await requireAdminRole()
    if (!auth.authorized) {
      return page(
        "Sign in required",
        "Sign in as an admin to continue.",
        `<p style="font-size: 16px; margin: 0;">Sign in to Ligament in this browser, then open the link from the notification email again. The link stays valid for 24 hours from the time it was sent.</p>`,
        auth.response.status
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) return invalidLinkResponse()

    // Service role is still required after the gate: the target is an arbitrary signup that
    // the admin has no partnership or ownership relationship with, so no profiles policy
    // grants a write to that row through the session client.
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("id", userId)
      .maybeSingle()

    if (profileError || !profile) return invalidLinkResponse()

    // 092: THE GRANT LANDS ON THE COMPANY, NOT ON THE PERSON.
    //
    // This used to be `.update({ is_paid: true })` on profiles. After 092 nothing reads
    // that column as an entitlement, so leaving it here would mean the admin clicks the
    // link, sees "Access Granted", and grants nobody anything - the silent-success shape
    // this surface keeps producing.
    //
    // THE SERVICE ROLE IS LOAD-BEARING. 092's organizations_entitlement_guard refuses a
    // write to is_paid whenever auth.uid() IS NOT NULL. A service_role JWT carries no
    // `sub` claim, so auth.uid() is NULL and this write is EXEMPT - the same outcome 091
    // recorded for this same route against the profiles guard. `supabase` here is built
    // from SUPABASE_SERVICE_ROLE_KEY a few lines above, after the admin gate.
    const orgId = await resolveOrgIdForUser(userId, supabase)
    if (!orgId) {
      // No organization means no entitlement can be written, and there is no honest
      // fallback: writing profiles.is_paid would report success against a column nothing
      // reads. Post-079 every account has exactly one membership, so this should be
      // unreachable - and if it is reached, that account is already locked out of its own
      // data by deny-by-default and needs a different fix than this link.
      console.error("[admin/grant-access] target belongs to no organization", { userId })
      return invalidLinkResponse()
    }

    // .select() IS NOT DECORATION. A zero-row update is the failure mode this whole
    // surface exists to stop, and PostgREST reports one as success.
    const { data: orgRows, error: updateError } = await supabase
      .from("organizations")
      .update({ is_paid: true, updated_at: new Date().toISOString() })
      .eq("id", orgId)
      .select("id")

    if (updateError) {
      console.error("[admin/grant-access] update failed", updateError.message, {
        code: updateError.code,
        hint:
          updateError.code === "42703"
            ? "42703 is undefined_column: migration 092 has not been applied to this database."
            : updateError.code === "LG008"
              ? "LG008 is 092's entitlement guard, which fires only when auth.uid() is not null - so this write did not go out on the service role."
              : undefined,
      })
      return invalidLinkResponse()
    }

    if (!Array.isArray(orgRows) || orgRows.length === 0) {
      console.error("[admin/grant-access] organizations update matched no row", { userId, orgId })
      return invalidLinkResponse()
    }

    const safeEmail = escapeHtml(String(profile.email || "Unknown email"))
    return page("Access Granted", "Access granted.", `<p style="font-size: 16px; margin: 0;">${safeEmail}</p>`)
  } catch (error) {
    Sentry.captureException(error)
    return invalidLinkResponse()
  }
}
