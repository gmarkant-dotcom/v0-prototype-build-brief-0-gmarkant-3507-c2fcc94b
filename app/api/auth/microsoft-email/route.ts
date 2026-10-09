import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import { createClient } from "@/lib/supabase/server"
import { resolveAgencyGate } from "@/lib/entitlements"
import { buildMicrosoftAuthUrl, MICROSOFT_OAUTH_NONCE_COOKIE } from "@/lib/microsoft-email"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(new URL("/auth/login?redirect=%2Fagency%2Fpool", url.origin))
    }

    // G1: the active organization must be a paid lead agency. No role column is read. A
    // refused caller is sent back to the agency portal, which shows the upgrade screen.
    const gate = await resolveAgencyGate(user.id, supabase)
    if (!gate.entitled) {
      return NextResponse.redirect(new URL("/agency/pool", url.origin))
    }

    const returnUrl = url.searchParams.get("returnUrl") || "/agency/pool"

    const nonce = randomUUID()
    const cookieStore = await cookies()
    cookieStore.set(MICROSOFT_OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 10,
      path: "/api/auth/microsoft-email",
    })

    const authUrl = buildMicrosoftAuthUrl(user.id, returnUrl, nonce)
    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/auth/microsoft-email",
      method: "GET",
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.redirect(new URL("/agency/pool?email_error=connection_failed", url.origin))
  }
}
