import { siteBaseUrl } from "@/lib/email"

// Microsoft OAuth (email import, Phase 2). Standalone functions only - same pattern as
// lib/google-email.ts: no class, no side effects beyond network calls; cookie/session
// handling stays in the route handlers that call these.
//
// Env vars required: MICROSOFT_EMAIL_CLIENT_ID, MICROSOFT_EMAIL_CLIENT_SECRET (Azure AD
// app registration, "Mail.Read" delegated Graph permission + "offline_access").

const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
const MICROSOFT_MAIL_SCOPE = "Mail.Read offline_access"

// CSRF nonce cookie shared between /api/auth/microsoft-email (sets it) and
// /api/auth/microsoft-email/callback (verifies it against the state param).
export const MICROSOFT_OAUTH_NONCE_COOKIE = "microsoft_email_oauth_nonce"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function getRedirectUri(): string {
  return `${siteBaseUrl()}/api/auth/microsoft-email/callback`
}

export type MicrosoftOAuthState = { userId: string; returnUrl: string; nonce: string }

export function encodeMicrosoftState(state: MicrosoftOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url")
}

export function decodeMicrosoftState(encoded: string): MicrosoftOAuthState | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.userId === "string" &&
      typeof parsed.returnUrl === "string" &&
      typeof parsed.nonce === "string"
    ) {
      return parsed as MicrosoftOAuthState
    }
    return null
  } catch {
    return null
  }
}

/** Builds the Microsoft consent-screen URL. Caller generates the nonce and sets it as a
 *  short-lived httpOnly cookie before redirecting here (CSRF protection - verified
 *  against the same cookie on callback). */
export function buildMicrosoftAuthUrl(userId: string, returnUrl: string, nonce: string): string {
  const clientId = requireEnv("MICROSOFT_EMAIL_CLIENT_ID")
  const state = encodeMicrosoftState({ userId, returnUrl, nonce })
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: MICROSOFT_MAIL_SCOPE,
    response_mode: "query",
    prompt: "consent",
    state,
  })
  return `${MICROSOFT_AUTH_URL}?${params.toString()}`
}

export type MicrosoftTokenResponse = { access_token: string; refresh_token?: string; expires_in: number }

export async function exchangeMicrosoftCode(code: string, redirectUri: string): Promise<MicrosoftTokenResponse> {
  const clientId = requireEnv("MICROSOFT_EMAIL_CLIENT_ID")
  const clientSecret = requireEnv("MICROSOFT_EMAIL_CLIENT_SECRET")
  const res = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || !payload.access_token) {
    throw new Error(payload?.error_description || payload?.error || "Failed to exchange authorization code")
  }
  return { access_token: payload.access_token, refresh_token: payload.refresh_token, expires_in: payload.expires_in }
}

export async function refreshMicrosoftToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const clientId = requireEnv("MICROSOFT_EMAIL_CLIENT_ID")
  const clientSecret = requireEnv("MICROSOFT_EMAIL_CLIENT_SECRET")
  const res = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || !payload.access_token) {
    throw new Error(payload?.error_description || payload?.error || "Failed to refresh access token")
  }
  return { access_token: payload.access_token, expires_in: payload.expires_in }
}

/** Microsoft has no simple single-call token revoke endpoint (unlike Google's /revoke) -
 *  an app can only drop its own copy of the tokens. The caller (DELETE
 *  /api/agency/email-connections) already clears access_token_encrypted /
 *  refresh_token_encrypted locally regardless of provider; this function exists so the
 *  disconnect flow has a symmetric call site to Google's revokeGoogleToken(), and so this
 *  comment lives next to the OAuth code that needs it: a user who wants to fully revoke
 *  Ligament's access on Microsoft's side must do so themselves at
 *  https://account.live.com/consent/Manage (or, for work/school accounts, their
 *  organization's My Apps page). */
export async function revokeMicrosoftToken(): Promise<boolean> {
  return true
}
