// Pure scoring function for email-import vendor detection (Part E). No I/O, no Supabase -
// DB cross-referencing (has_ligament_account, profile_id, already_in_pool) is done by the
// caller (app/api/agency/email-scan/run/route.ts), which has DB access.

import { isFreeEmailDomain, isSystemEmailDomain, getEmailDomain } from "@/lib/email-domains"

// Tier 1: highest-signal, formal procurement/legal terms.
const TIER1_KEYWORDS = [
  "sow",
  "proposal",
  "invoice",
  "estimate",
  "bid",
  "quote",
  "rfp",
  "contract",
  "nda",
  "scope",
  "deliverable",
  "purchase order",
  "statement of work",
  "msa",
  "master service",
  "retainer",
]
const TIER1_SUBJECT_BONUS = 15
const TIER1_SUBJECT_MAX = 45
const TIER1_SNIPPET_BONUS = 7
const TIER1_SNIPPET_MAX = 21

// Tier 2: creative/production workflow terms.
const TIER2_KEYWORDS = [
  "production",
  "freelance",
  "subcontract",
  "call sheet",
  "shoot",
  "rough cut",
  "final cut",
  "brief",
  "treatment",
  "storyboard",
  "casting",
  "day rate",
  "buyout",
  "usage rights",
  "activation",
  "fabrication",
  "rate card",
  "media plan",
  "change order",
]
const TIER2_SUBJECT_BONUS = 10
const TIER2_SUBJECT_MAX = 30
const TIER2_SNIPPET_BONUS = 5
const TIER2_SNIPPET_MAX = 15

// Tier 3: lighter-weight/supporting terms.
const TIER3_KEYWORDS = [
  "revision",
  "selects",
  "site visit",
  "mood board",
  "concept",
  "booking",
  "install",
  "run of show",
  "wrap",
  "load-in",
  "proof",
  "artwork",
  "kill fee",
]
const TIER3_SUBJECT_BONUS = 5
const TIER3_SUBJECT_MAX = 15
const TIER3_SNIPPET_BONUS = 3
const TIER3_SNIPPET_MAX = 9

const NEWSLETTER_TERMS = ["unsubscribe", "newsletter", "digest", "weekly update"]
const NEWSLETTER_PENALTY = 20

const SYSTEM_ADDRESS_PREFIXES = [
  "noreply@",
  "no-reply@",
  "notifications@",
  "support@",
  "help@",
  "billing@",
  "donotreply@",
  "mailer-daemon@",
]

// A generic noreply/no-reply pattern can show up in either the local part (caught above)
// or the domain (e.g. a sender routed through a "noreply.example.com" subdomain) - checked
// against both.
const NOREPLY_PATTERN = /no-?reply/

// Generic role addresses are a weaker signal than a true system address - some small
// vendors legitimately operate out of info@/hello@, so this is a penalty, not a hard filter.
const GENERIC_ROLE_PREFIXES = [
  "marketing@",
  "newsletter@",
  "info@",
  "hello@",
  "contact@",
  "sales@",
  "team@",
  "press@",
  "events@",
  "noreply@",
]
const GENERIC_ROLE_PENALTY = 15

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6
const THREE_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 3

export type VendorSignalContact = {
  email: string
  subjects: string[]
  snippets: string[]
  message_count: number
  has_attachments: boolean
  attachment_types: string[]
  last_contact_date: string | null
}

export type VendorSignalScore = { score: number; signals: string[] }

/** Scans haystack for keywords, adding bonus per distinct match (capped at max), pushing a
 *  "keyword:<word>:<source>" signal per match so the UI can label "X in subject" vs
 *  "X in preview" differently. */
function scoreKeywordsInHaystack(
  haystack: string,
  keywords: string[],
  bonus: number,
  max: number,
  source: "subject" | "snippet",
  signals: string[]
): number {
  let total = 0
  for (const keyword of keywords) {
    if (total >= max) break
    if (haystack.includes(keyword)) {
      total += bonus
      signals.push(`keyword:${keyword}:${source}`)
    }
  }
  return Math.min(total, max)
}

export function scoreVendorSignal(contact: VendorSignalContact): VendorSignalScore {
  const email = contact.email.toLowerCase()
  const domain = getEmailDomain(email)
  const localPart = email.split("@")[0] || ""

  // Hard filter, not a penalty - a system/no-reply address must never appear in results
  // regardless of how many keyword hits it happens to have. Checked against both the local
  // part (support@, noreply@, ...) and the domain (e.g. bounces routed through a
  // "noreply.example.com" subdomain).
  const isSystemAddress = SYSTEM_ADDRESS_PREFIXES.some((prefix) => email.startsWith(prefix))
  const isNoReplyPattern = NOREPLY_PATTERN.test(localPart) || NOREPLY_PATTERN.test(domain)
  if (isSystemAddress || isNoReplyPattern) {
    return { score: 0, signals: ["system_address"] }
  }

  // Hard filter - known automated-sender domains (job boards, ATS platforms, marketing
  // tooling, payment processors) are never a real vendor contact.
  if (isSystemEmailDomain(email)) {
    return { score: 0, signals: ["system_domain"] }
  }

  let score = 0
  const signals: string[] = []
  const subjectHaystack = contact.subjects.join(" \n ").toLowerCase()
  const snippetHaystack = (contact.snippets || []).join(" \n ").toLowerCase()

  score += scoreKeywordsInHaystack(subjectHaystack, TIER1_KEYWORDS, TIER1_SUBJECT_BONUS, TIER1_SUBJECT_MAX, "subject", signals)
  score += scoreKeywordsInHaystack(subjectHaystack, TIER2_KEYWORDS, TIER2_SUBJECT_BONUS, TIER2_SUBJECT_MAX, "subject", signals)
  score += scoreKeywordsInHaystack(subjectHaystack, TIER3_KEYWORDS, TIER3_SUBJECT_BONUS, TIER3_SUBJECT_MAX, "subject", signals)

  // Body-preview mentions are a weaker signal than subject mentions, scored at half value -
  // an email with "estimate" in the subject AND "deliverable" in the snippet scores higher
  // than either alone.
  score += scoreKeywordsInHaystack(snippetHaystack, TIER1_KEYWORDS, TIER1_SNIPPET_BONUS, TIER1_SNIPPET_MAX, "snippet", signals)
  score += scoreKeywordsInHaystack(snippetHaystack, TIER2_KEYWORDS, TIER2_SNIPPET_BONUS, TIER2_SNIPPET_MAX, "snippet", signals)
  score += scoreKeywordsInHaystack(snippetHaystack, TIER3_KEYWORDS, TIER3_SNIPPET_BONUS, TIER3_SNIPPET_MAX, "snippet", signals)

  const hasDocAttachment = contact.attachment_types.some((t) => {
    const ext = t.toLowerCase()
    return ext === "pdf" || ext === "docx"
  })
  if (hasDocAttachment) {
    score += 10
    signals.push("pdf_or_docx_attachment")
  }

  if (contact.message_count >= 5) {
    score += 10
    signals.push("5+_messages")
  }
  if (contact.message_count >= 10) {
    score += 10
    signals.push("10+_messages")
  }

  if (contact.last_contact_date) {
    const lastContact = new Date(contact.last_contact_date).getTime()
    if (!Number.isNaN(lastContact)) {
      const now = Date.now()
      if (now - lastContact <= SIX_MONTHS_MS) {
        score += 10
        signals.push("contact_within_6mo")
      }
      if (now - lastContact <= THREE_MONTHS_MS) {
        score += 5
        signals.push("contact_within_3mo")
      }
    }
  }

  const isNewsletter = NEWSLETTER_TERMS.some((term) => subjectHaystack.includes(term))
  if (isNewsletter) {
    score -= NEWSLETTER_PENALTY
    signals.push("newsletter_or_marketing")
  }

  const isGenericRoleAddress = GENERIC_ROLE_PREFIXES.some((prefix) => email.startsWith(prefix))
  if (isGenericRoleAddress) {
    score -= GENERIC_ROLE_PENALTY
    signals.push("generic_role_address")
  }

  return { score: Math.max(0, Math.min(100, score)), signals }
}

export type ScoredVendorContact<T extends VendorSignalContact> = T & {
  score: number
  signals: string[]
  is_free_email: boolean
}

/** Scores every contact, flags is_free_email, drops score <= 0, sorts descending. Pure -
 *  no DB access (has_ligament_account/profile_id/already_in_pool are cross-referenced
 *  separately by the caller, which has DB access). */
export function scoreAndFilterContacts<T extends VendorSignalContact>(contacts: T[]): ScoredVendorContact<T>[] {
  return contacts
    .map((contact) => {
      const { score, signals } = scoreVendorSignal(contact)
      return { ...contact, score, signals, is_free_email: isFreeEmailDomain(contact.email) }
    })
    .filter((contact) => contact.score > 0)
    .sort((a, b) => b.score - a.score)
}
