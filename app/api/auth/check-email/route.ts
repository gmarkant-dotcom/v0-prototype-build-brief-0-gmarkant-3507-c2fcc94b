import { NextResponse, type NextRequest } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { exactEmailIlike } from "@/lib/server/account-existence"
import { isValidEmail } from "@/lib/pool-field-mapping"

export const dynamic = "force-dynamic"

/**
 * Used only by app/auth/sign-up/page.tsx, for magic-link and pool-resend arrivals, to send an
 * existing account holder to sign-in instead of the sign-up form.
 *
 * It needs no session, so it is an account-existence oracle by design: the redirect IS the
 * answer. What it no longer does (2026-10-12):
 *   - act as a wildcard search. The email was passed to ilike unescaped, so "%" and "_" matched
 *     other addresses and "?email=ab%25" answered "is there an account starting with ab";
 *   - answer anything but a single well-formed address;
 *   - answer differently on a fault. Every outcome is 200 { exists: boolean }, and a missing,
 *     malformed or unreadable address is { exists: false }, which the page already treats
 *     exactly like an error (it shows the sign-up form).
 * Binding the answer to a magic-link token is the proposed follow-up (see
 * docs/guest-profiles-records-report.md, WS-A).
 */
export async function GET(request: NextRequest) {
  const route = "/api/auth/check-email"
  const no = () => NextResponse.json({ exists: false })
  try {
    const email = (new URL(request.url).searchParams.get("email") || "").trim().toLowerCase()
    if (!email || email.length > 320 || !isValidEmail(email)) return no()
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[api] failure", { route, method: "GET", code: 500, message: "Missing Supabase service configuration" })
      return no()
    }
    // Service role: this check must run before the visitor has any session.
    // Only ever returns a boolean — no profile data is exposed.
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", exactEmailIlike(email))
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error("[api] failure", { route, method: "GET", code: 500, message: error.message })
      return no()
    }
    return NextResponse.json({ exists: Boolean(data?.id) })
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "GET",
      code: 500,
      message: error instanceof Error ? error.message : String(error),
    })
    return no()
  }
}
