import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { randomUUID } from "crypto"
import { createClient } from "@/lib/supabase/server"
import { buildGoogleAuthUrl, GOOGLE_OAUTH_NONCE_COOKIE } from "@/lib/google-email"

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active_role")
      .eq("id", user.id)
      .maybeSingle()
    if (profile?.role !== "agency" && profile?.active_role !== "agency") {
      return NextResponse.redirect(new URL("/agency/pool", url.origin))
    }

    const returnUrl = url.searchParams.get("returnUrl") || "/agency/pool"

    const nonce = randomUUID()
    const cookieStore = await cookies()
    cookieStore.set(GOOGLE_OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 10,
      path: "/api/auth/google-email",
    })

    const authUrl = buildGoogleAuthUrl(user.id, returnUrl, nonce)
    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error("[api] failure", {
      route: "/api/auth/google-email",
      method: "GET",
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.redirect(new URL("/agency/pool?email_error=connection_failed", url.origin))
  }
}
