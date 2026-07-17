import { NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { decodeGoogleState, exchangeGoogleCode, GOOGLE_OAUTH_NONCE_COOKIE } from "@/lib/google-email"
import { encrypt } from "@/lib/token-encryption"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function getServiceSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET(request: Request) {
  const route = "/api/auth/google-email/callback"
  const url = new URL(request.url)

  const cookieStore = await cookies()
  const clearNonceCookie = () => {
    cookieStore.set(GOOGLE_OAUTH_NONCE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/api/auth/google-email",
    })
  }
  const fail = (returnUrl: string) => {
    clearNonceCookie()
    const dest = new URL(returnUrl, url.origin)
    dest.searchParams.set("email_error", "connection_failed")
    return NextResponse.redirect(dest)
  }

  try {
    const code = url.searchParams.get("code")
    const stateRaw = url.searchParams.get("state")
    const oauthError = url.searchParams.get("error")

    if (!stateRaw) return fail("/agency/pool")
    const state = decodeGoogleState(stateRaw)
    if (!state) return fail("/agency/pool")

    const cookieNonce = cookieStore.get(GOOGLE_OAUTH_NONCE_COOKIE)?.value
    if (!cookieNonce || cookieNonce !== state.nonce) {
      console.error("[api] failure", { route, method: "GET", message: "CSRF nonce mismatch" })
      return fail(state.returnUrl)
    }

    if (oauthError || !code) {
      console.error("[api] failure", { route, method: "GET", message: oauthError || "Missing authorization code" })
      return fail(state.returnUrl)
    }

    const tokens = await exchangeGoogleCode(code)

    const supabase = getServiceSupabase()
    if (!supabase) {
      console.error("[api] failure", { route, method: "GET", message: "Missing Supabase service configuration" })
      return fail(state.returnUrl)
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    const { error: upsertErr } = await supabase.from("email_connections").upsert(
      {
        user_id: state.userId,
        provider: "google",
        access_token_encrypted: encrypt(tokens.access_token),
        ...(tokens.refresh_token ? { refresh_token_encrypted: encrypt(tokens.refresh_token) } : {}),
        token_expires_at: expiresAt,
        scopes: "https://www.googleapis.com/auth/gmail.readonly",
        connected_at: new Date().toISOString(),
        status: "active",
      },
      { onConflict: "user_id,provider" }
    )
    if (upsertErr) {
      console.error("[api] failure", { route, method: "GET", message: upsertErr.message })
      return fail(state.returnUrl)
    }

    clearNonceCookie()
    console.log("[api] success", { route, method: "GET", userId: state.userId })
    return NextResponse.redirect(new URL(state.returnUrl || "/agency/pool", url.origin))
  } catch (error) {
    console.error("[api] failure", {
      route,
      method: "GET",
      message: error instanceof Error ? error.message : String(error),
    })
    return fail("/agency/pool")
  }
}
