import { siteBaseUrl } from "@/lib/email"
import {
  createContactAccumulator,
  contactsFromAccumulator,
  MAX_SNIPPETS_PER_CONTACT,
  type ContactAccumulator,
  type AccumulatorEntry,
  type RawEmailContact,
} from "@/lib/google-email"

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

// ── Outlook scan (email import, Phase 2) ─────────────────────────────────────
//
// Same split as lib/google-email.ts: low-level, checkpoint-friendly pieces
// (fetchOutlookMessageBatch, accumulateContactsFromMicrosoftMessages) plus one
// all-at-once convenience wrapper (scanOutlookContacts) composed from them. The HTTP
// route (app/api/agency/email-scan/run/route.ts) uses the low-level pieces directly in a
// loop so it can checkpoint scan_results after every page, same reasoning as the Gmail
// scanner: a Vercel function killed at the maxDuration ceiling must still leave partial
// results behind.
//
// Unlike Gmail (messages.list returns bare ids, then a separate messages.get per id),
// Graph's $search on /me/messages returns full selected fields in the same response - no
// separate list-then-fetch round trip is needed for the message body/headers themselves.
// The one unavoidable second call is per-message attachment metadata: $select on the
// message resource cannot return attachment filenames, only the hasAttachments flag, so
// any message with hasAttachments=true gets one follow-up call to its /attachments
// endpoint.

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"
// Graph has no top-level /me/sentItems resource - Sent Items is a well-known mail folder,
// reached via /me/mailFolders/{wellKnownName}/messages same as any other folder.
const SENT_ITEMS_PATH = "/me/mailFolders/sentitems/messages"

// Same vendor-signal keyword set as Gmail's VENDOR_SUBJECT_QUERY, adapted to Microsoft
// Graph's $search syntax (KQL): each term becomes its own `subject:term` clause (quoted
// when it contains a space) joined by OR - Graph's $search does not support Gmail's
// grouped "subject:(a OR b OR c)" shorthand.
const VENDOR_SUBJECT_TERMS = [
  "proposal",
  "invoice",
  "SOW",
  "estimate",
  "bid",
  "quote",
  "RFP",
  "contract",
  "NDA",
  "scope",
  "deliverable",
  "production",
  "retainer",
  "freelance",
  "call sheet",
  "shoot",
  "rough cut",
  "final cut",
  "revision",
  "selects",
  "site visit",
  "brief",
  "treatment",
  "storyboard",
  "mood board",
  "concept",
  "casting",
  "day rate",
  "buyout",
  "usage rights",
  "booking",
  "activation",
  "fabrication",
  "install",
  "run of show",
  "purchase order",
  "rate card",
  "media plan",
]

// $search requires its whole value wrapped in one pair of quotes (Graph parses everything
// inside as one KQL expression); URLSearchParams handles percent-encoding those quotes
// correctly when the query string is built below.
function buildOutlookSearchQuery(): string {
  const clauses = VENDOR_SUBJECT_TERMS.map((term) => (term.includes(" ") ? `subject:"${term}"` : `subject:${term}`))
  return `"${clauses.join(" OR ")}"`
}

export const MAX_OUTLOOK_MESSAGES = 200
// $search already returns full selected fields per message (no separate list-then-fetch
// step like Gmail), so the page size doubles as the checkpoint chunk size directly.
const OUTLOOK_PAGE_SIZE = 20
const OUTLOOK_SELECT_FIELDS = "from,toRecipients,ccRecipients,subject,receivedDateTime,hasAttachments,bodyPreview"

type MicrosoftEmailAddress = { emailAddress?: { address?: string; name?: string } }
type MicrosoftRawMessage = {
  id: string
  from?: MicrosoftEmailAddress | null
  toRecipients?: MicrosoftEmailAddress[]
  ccRecipients?: MicrosoftEmailAddress[]
  subject?: string
  receivedDateTime?: string
  hasAttachments?: boolean
  bodyPreview?: string
}

/** Already-parsed per-message data - nothing downstream touches Graph's raw message shape.
 *  attachmentTypes is populated by a follow-up /attachments call only when hasAttachment
 *  is true (see fetchOutlookMessageBatch). */
export type MicrosoftMetadataMessage = {
  id: string
  participants: { email: string; name: string | null }[]
  subject: string
  date: string | null
  snippet: string
  hasAttachment: boolean
  attachmentTypes: string[]
}

function parseMicrosoftAddress(addr: MicrosoftEmailAddress | null | undefined): { email: string; name: string | null } | null {
  const email = addr?.emailAddress?.address?.trim().toLowerCase()
  if (!email || !email.includes("@")) return null
  const name = addr?.emailAddress?.name?.trim() || null
  return { email, name }
}

function parseMicrosoftParticipants(raw: MicrosoftRawMessage): { email: string; name: string | null }[] {
  const out: { email: string; name: string | null }[] = []
  const from = parseMicrosoftAddress(raw.from)
  if (from) out.push(from)
  for (const to of raw.toRecipients || []) {
    const parsed = parseMicrosoftAddress(to)
    if (parsed) out.push(parsed)
  }
  for (const cc of raw.ccRecipients || []) {
    const parsed = parseMicrosoftAddress(cc)
    if (parsed) out.push(parsed)
  }
  return out
}

async function fetchOutlookAttachmentTypes(accessToken: string, messageId: string): Promise<string[]> {
  const params = new URLSearchParams({ $select: "name,contentType" })
  const res = await fetch(`${GRAPH_API_BASE}/me/messages/${messageId}/attachments?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return []
  const payload = await res.json().catch(() => ({}))
  const types = new Set<string>()
  for (const attachment of (payload.value || []) as { name?: string }[]) {
    const ext = attachment.name?.split(".").pop()?.toLowerCase()
    if (ext) types.add(ext)
  }
  return Array.from(types)
}

/** One page of vendor-signal-matching messages from either the inbox or Sent Items,
 *  already enriched with attachment types. Pass `nextLink` (the previous page's
 *  @odata.nextLink) to continue pagination - it is a complete, ready-to-fetch URL, so no
 *  query params are rebuilt when following it. */
export async function fetchOutlookMessageBatch(
  accessToken: string,
  folder: "inbox" | "sent",
  nextLink?: string | null
): Promise<{ messages: MicrosoftMetadataMessage[]; nextLink: string | null }> {
  let url: string
  if (nextLink) {
    url = nextLink
  } else {
    const basePath = folder === "sent" ? SENT_ITEMS_PATH : "/me/messages"
    const params = new URLSearchParams({
      $search: buildOutlookSearchQuery(),
      $select: OUTLOOK_SELECT_FIELDS,
      $top: String(OUTLOOK_PAGE_SIZE),
      $count: "true",
    })
    url = `${GRAPH_API_BASE}${basePath}?${params.toString()}`
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // Required by Graph whenever $search is used on messages, together with $count=true
      // above - omitting either one silently returns an empty result set rather than an
      // error, so both are non-negotiable here.
      ConsistencyLevel: "eventual",
    },
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(payload?.error?.message || `Microsoft Graph messages request failed (${res.status})`)
  }

  const rawMessages = (payload.value || []) as MicrosoftRawMessage[]
  const messages = await Promise.all(
    rawMessages.map(async (raw) => {
      const attachmentTypes = raw.hasAttachments ? await fetchOutlookAttachmentTypes(accessToken, raw.id) : []
      return {
        id: raw.id,
        participants: parseMicrosoftParticipants(raw),
        subject: raw.subject || "",
        date: raw.receivedDateTime || null,
        snippet: raw.bodyPreview || "",
        hasAttachment: Boolean(raw.hasAttachments),
        attachmentTypes,
      }
    })
  )

  return { messages, nextLink: payload["@odata.nextLink"] || null }
}

/** Pure - folds a batch of parsed messages into an accumulator (mutates + returns it).
 *  Same shape and exclusion rules as Gmail's accumulateContactsFromMessages, so a caller
 *  can fold both providers' messages into one shared accumulator for cross-provider
 *  dedup ("Scan All" - see app/api/agency/email-scan/run/route.ts). */
export function accumulateContactsFromMicrosoftMessages(
  messages: MicrosoftMetadataMessage[],
  userEmail: string,
  accumulator: ContactAccumulator,
  excludedDomains: string[] = []
): ContactAccumulator {
  const userEmailLower = userEmail.trim().toLowerCase()
  const userDomain = userEmailLower.split("@")[1] || ""
  const excludedDomainSet = new Set(
    [userDomain, ...excludedDomains.map((d) => d.trim().toLowerCase())].filter(Boolean)
  )

  for (const message of messages) {
    const dateMs = message.date ? new Date(message.date).getTime() : NaN
    const dateValid = !Number.isNaN(dateMs)
    const dateIso = dateValid ? new Date(dateMs).toISOString() : null

    for (const { email, name } of message.participants) {
      if (!email || email === userEmailLower) continue
      const domain = email.split("@")[1]
      if (!domain || excludedDomainSet.has(domain)) continue

      const existing: AccumulatorEntry | undefined = accumulator.get(email)
      if (!existing) {
        accumulator.set(email, {
          email,
          name,
          message_count: 1,
          last_contact_date: dateIso,
          subjectEntries: message.subject ? [{ subject: message.subject, date: dateIso }] : [],
          snippets: message.snippet ? [message.snippet] : [],
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
      if (message.snippet && existing.snippets.length < MAX_SNIPPETS_PER_CONTACT) {
        existing.snippets.push(message.snippet)
      }
    }
  }
  return accumulator
}

/** All-at-once convenience wrapper, composed from the primitives above - scans inbox then
 *  Sent Items, each capped at MAX_OUTLOOK_MESSAGES, folding both into one accumulator so
 *  the same contact seen in both is a single entry ("Deduplicate contacts across inbox +
 *  sent"). app/api/agency/email-scan/run/route.ts does NOT use this - like Gmail's
 *  scanGmailContacts, it reimplements the same loop directly so it can checkpoint
 *  scan_results between pages. */
export async function scanOutlookContacts(
  accessToken: string,
  userEmail: string,
  excludedDomains: string[] = []
): Promise<RawEmailContact[]> {
  const accumulator = createContactAccumulator()

  for (const folder of ["inbox", "sent"] as const) {
    let nextLink: string | null | undefined
    let processedCount = 0
    do {
      const { messages, nextLink: pageNextLink } = await fetchOutlookMessageBatch(accessToken, folder, nextLink)
      if (messages.length === 0) break
      accumulateContactsFromMicrosoftMessages(messages, userEmail, accumulator, excludedDomains)
      processedCount += messages.length
      nextLink = processedCount < MAX_OUTLOOK_MESSAGES ? pageNextLink : null
    } while (nextLink)
  }

  return contactsFromAccumulator(accumulator)
}
