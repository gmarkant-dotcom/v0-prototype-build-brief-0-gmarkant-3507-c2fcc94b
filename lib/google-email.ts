import { siteBaseUrl } from "@/lib/email"

// Google OAuth (email import, Phase 1). Standalone functions only - no class, no
// side effects beyond network calls; cookie/session handling stays in the route
// handlers that call these.

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"

// CSRF nonce cookie shared between /api/auth/google-email (sets it) and
// /api/auth/google-email/callback (verifies it against the state param).
export const GOOGLE_OAUTH_NONCE_COOKIE = "google_email_oauth_nonce"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function getRedirectUri(): string {
  return `${siteBaseUrl()}/api/auth/google-email/callback`
}

export type GoogleOAuthState = { userId: string; returnUrl: string; nonce: string }

export function encodeGoogleState(state: GoogleOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url")
}

export function decodeGoogleState(encoded: string): GoogleOAuthState | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.userId === "string" &&
      typeof parsed.returnUrl === "string" &&
      typeof parsed.nonce === "string"
    ) {
      return parsed as GoogleOAuthState
    }
    return null
  } catch {
    return null
  }
}

/** Builds the Google consent-screen URL. Caller generates the nonce and sets it as a
 *  short-lived httpOnly cookie before redirecting here (CSRF protection - verified
 *  against the same cookie on callback). */
export function buildGoogleAuthUrl(userId: string, returnUrl: string, nonce: string): string {
  const clientId = requireEnv("GOOGLE_EMAIL_CLIENT_ID")
  const state = encodeGoogleState({ userId, returnUrl, nonce })
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export type GoogleTokenResponse = { access_token: string; refresh_token?: string; expires_in: number }

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  const clientId = requireEnv("GOOGLE_EMAIL_CLIENT_ID")
  const clientSecret = requireEnv("GOOGLE_EMAIL_CLIENT_SECRET")
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok || !payload.access_token) {
    throw new Error(payload?.error_description || payload?.error || "Failed to exchange authorization code")
  }
  return { access_token: payload.access_token, refresh_token: payload.refresh_token, expires_in: payload.expires_in }
}

export async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const clientId = requireEnv("GOOGLE_EMAIL_CLIENT_ID")
  const clientSecret = requireEnv("GOOGLE_EMAIL_CLIENT_SECRET")
  const res = await fetch(GOOGLE_TOKEN_URL, {
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

export async function revokeGoogleToken(accessToken: string): Promise<boolean> {
  const res = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  })
  return res.ok
}

// ── Gmail scan (email import, Phase 1) ──────────────────────────────────────
//
// Split into low-level, checkpoint-friendly pieces (listGmailMessageIds,
// fetchGmailMessageBatch, accumulateContactsFromMessages, contactsFromAccumulator) plus
// one all-at-once convenience wrapper (scanGmailContacts) composed from them. The HTTP
// route (app/api/agency/email-scan/run/route.ts) uses the low-level pieces directly in a
// loop so it can checkpoint scan_results after every chunk - a Vercel function killed at
// the maxDuration ceiling must still leave partial results behind, which a single
// call-and-return-at-the-end function cannot do.

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
const VENDOR_SUBJECT_QUERY =
  "subject:(proposal OR invoice OR SOW OR estimate OR bid OR quote OR RFP OR contract OR NDA OR scope OR deliverable OR production OR retainer OR freelance)"

export const MAX_MESSAGES = 200
const LIST_PAGE_SIZE = 100
const FETCH_CHUNK_SIZE = 20

type GmailHeader = { name: string; value: string }
type GmailMessagePart = { filename?: string; parts?: GmailMessagePart[] }
type GmailRawMessage = { id: string; payload?: { headers?: GmailHeader[]; parts?: GmailMessagePart[] } }

/** Already-parsed per-message metadata - nothing downstream touches Gmail's raw payload shape. */
export type GmailMetadataMessage = {
  id: string
  from: string | null
  to: string | null
  cc: string | null
  subject: string
  date: string | null
  hasAttachment: boolean
  attachmentTypes: string[]
}

export type RawGmailContact = {
  email: string
  name: string | null
  subjects: string[]
  message_count: number
  has_attachments: boolean
  attachment_types: string[]
  last_contact_date: string | null
}

type AccumulatorEntry = {
  email: string
  name: string | null
  message_count: number
  last_contact_date: string | null
  // Every subject seen, paired with its message's Date header - sorted and capped to the
  // 5 most recent only when converting to RawGmailContact, since Gmail's list order for a
  // search query isn't a documented guarantee of newest-first.
  subjectEntries: { subject: string; date: string | null }[]
  has_attachments: boolean
  attachment_types: string[]
}

export type ContactAccumulator = Map<string, AccumulatorEntry>

export function createContactAccumulator(): ContactAccumulator {
  return new Map()
}

// Walks a message part tree (recursing into multipart children) collecting any non-empty
// filename it finds - format=metadata strips body.data but still includes filename on
// each part, since that comes from MIME headers rather than body content.
function collectAttachmentInfo(part: GmailMessagePart | undefined, types: Set<string>): boolean {
  if (!part) return false
  let found = false
  if (part.filename && part.filename.trim()) {
    found = true
    const ext = part.filename.split(".").pop()?.toLowerCase()
    if (ext) types.add(ext)
  }
  if (part.parts) {
    for (const child of part.parts) {
      if (collectAttachmentInfo(child, types)) found = true
    }
  }
  return found
}

// Splits a From/To/Cc header value into individual addresses. Handles the common
// '"Display Name" <email@x.com>' and bare 'email@x.com' forms, comma-separated for
// multi-recipient To/Cc. Does not handle a quoted display name containing a literal comma.
function parseAddresses(headerValue: string | null): { email: string; name: string | null }[] {
  if (!headerValue) return []
  const out: { email: string; name: string | null }[] = []
  for (const raw of headerValue.split(",")) {
    const part = raw.trim()
    if (!part) continue
    const match = part.match(/^(.*?)<([^>]+)>$/)
    if (match) {
      const name = match[1].trim().replace(/^"|"$/g, "") || null
      const email = match[2].trim().toLowerCase()
      if (email.includes("@")) out.push({ email, name })
    } else if (part.includes("@")) {
      out.push({ email: part.toLowerCase(), name: null })
    }
  }
  return out
}

/** One page of message ids matching the vendor-signal subject query. No bodies fetched. */
export async function listGmailMessageIds(
  accessToken: string,
  pageToken?: string | null
): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({ q: VENDOR_SUBJECT_QUERY, maxResults: String(LIST_PAGE_SIZE) })
  if (pageToken) params.set("pageToken", pageToken)
  const res = await fetch(`${GMAIL_API_BASE}/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(payload?.error?.message || `Gmail messages.list failed (${res.status})`)
  }
  const ids = ((payload.messages || []) as { id: string }[]).map((m) => m.id)
  return { ids, nextPageToken: payload.nextPageToken || null }
}

function metadataQueryString(): string {
  const params = new URLSearchParams({ format: "metadata" })
  for (const header of ["From", "To", "Cc", "Subject", "Date"]) params.append("metadataHeaders", header)
  return params.toString()
}

async function fetchOneMessage(accessToken: string, id: string, attempt = 0): Promise<GmailMetadataMessage> {
  const res = await fetch(`${GMAIL_API_BASE}/messages/${id}?${metadataQueryString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 429 && attempt === 0) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    return fetchOneMessage(accessToken, id, attempt + 1)
  }
  if (!res.ok) {
    throw new Error(`Gmail messages.get failed for ${id} (${res.status})`)
  }
  const raw = (await res.json()) as GmailRawMessage
  const headers = raw.payload?.headers || []
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || null
  const attachmentTypes = new Set<string>()
  const hasAttachment = (raw.payload?.parts || []).some((part) => collectAttachmentInfo(part, attachmentTypes))
  return {
    id: raw.id,
    from: get("From"),
    to: get("To"),
    cc: get("Cc"),
    subject: get("Subject") || "",
    date: get("Date"),
    hasAttachment,
    attachmentTypes: Array.from(attachmentTypes),
  }
}

/** Fetches format=metadata for a batch of message ids, chunked at bounded concurrency.
 *  Never throws for a single message failure - a transient error on one message must not
 *  lose the rest of the batch. Failed ids are returned, not retried beyond the one 429
 *  retry already inside fetchOneMessage. */
export async function fetchGmailMessageBatch(
  accessToken: string,
  messageIds: string[]
): Promise<{ messages: GmailMetadataMessage[]; failedIds: string[] }> {
  const messages: GmailMetadataMessage[] = []
  const failedIds: string[] = []
  for (let i = 0; i < messageIds.length; i += FETCH_CHUNK_SIZE) {
    const chunk = messageIds.slice(i, i + FETCH_CHUNK_SIZE)
    const results = await Promise.allSettled(chunk.map((id) => fetchOneMessage(accessToken, id)))
    results.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        messages.push(result.value)
      } else {
        failedIds.push(chunk[idx])
        console.error("[gmail-scan] message fetch failed", {
          id: chunk[idx],
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    })
  }
  return { messages, failedIds }
}

/** Pure - folds a batch of metadata messages into an accumulator (mutates + returns it).
 *  Excludes userEmail's own address and domain, per spec ("exclude userEmail's domain"). */
export function accumulateContactsFromMessages(
  messages: GmailMetadataMessage[],
  userEmail: string,
  accumulator: ContactAccumulator
): ContactAccumulator {
  const userEmailLower = userEmail.trim().toLowerCase()
  const userDomain = userEmailLower.split("@")[1] || ""

  for (const message of messages) {
    const dateMs = message.date ? new Date(message.date).getTime() : NaN
    const dateValid = !Number.isNaN(dateMs)
    const dateIso = dateValid ? new Date(dateMs).toISOString() : null

    const participants = [...parseAddresses(message.from), ...parseAddresses(message.to), ...parseAddresses(message.cc)]

    for (const { email, name } of participants) {
      if (!email || email === userEmailLower) continue
      const domain = email.split("@")[1]
      if (!domain || domain === userDomain) continue

      const existing = accumulator.get(email)
      if (!existing) {
        accumulator.set(email, {
          email,
          name,
          message_count: 1,
          last_contact_date: dateIso,
          subjectEntries: message.subject ? [{ subject: message.subject, date: dateIso }] : [],
          has_attachments: message.hasAttachment,
          attachment_types: [...message.attachmentTypes],
        })
        continue
      }

      existing.message_count += 1
      if (!existing.name && name) existing.name = name
      if (message.hasAttachment) existing.has_attachments = true
      for (const t of message.attachmentTypes) {
        if (!existing.attachment_types.includes(t)) existing.attachment_types.push(t)
      }
      if (dateIso && (!existing.last_contact_date || dateIso > existing.last_contact_date)) {
        existing.last_contact_date = dateIso
      }
      if (message.subject) {
        existing.subjectEntries.push({ subject: message.subject, date: dateIso })
      }
    }
  }
  return accumulator
}

/** Converts the accumulator to the final output shape, resolving each contact's "last 5
 *  subjects" by sorting subjectEntries newest-first on their own Date header. */
export function contactsFromAccumulator(accumulator: ContactAccumulator): RawGmailContact[] {
  return Array.from(accumulator.values()).map((entry) => {
    const sorted = [...entry.subjectEntries].sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    const subjects: string[] = []
    for (const { subject } of sorted) {
      if (subjects.length >= 5) break
      if (!subjects.includes(subject)) subjects.push(subject)
    }
    return {
      email: entry.email,
      name: entry.name,
      message_count: entry.message_count,
      last_contact_date: entry.last_contact_date,
      subjects,
      has_attachments: entry.has_attachments,
      attachment_types: entry.attachment_types,
    }
  })
}

/** All-at-once convenience wrapper matching the literal spec signature, composed from the
 *  primitives above. app/api/agency/email-scan/run/route.ts does NOT use this - it
 *  reimplements the same loop directly so it can checkpoint scan_results between chunks. */
export async function scanGmailContacts(accessToken: string, userEmail: string): Promise<RawGmailContact[]> {
  const accumulator = createContactAccumulator()
  let pageToken: string | null | undefined
  let processedCount = 0

  do {
    const { ids, nextPageToken } = await listGmailMessageIds(accessToken, pageToken)
    if (ids.length === 0) break
    const remaining = MAX_MESSAGES - processedCount
    const idsToFetch = ids.slice(0, remaining)
    const { messages } = await fetchGmailMessageBatch(accessToken, idsToFetch)
    accumulateContactsFromMessages(messages, userEmail, accumulator)
    processedCount += idsToFetch.length
    pageToken = processedCount < MAX_MESSAGES ? nextPageToken : null
  } while (pageToken)

  return contactsFromAccumulator(accumulator)
}
