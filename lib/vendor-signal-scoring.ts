// Pure scoring function for email-import vendor detection (Part E). No I/O, no Supabase -
// DB cross-referencing (has_ligament_account, profile_id, already_in_pool) is done by the
// caller (app/api/agency/email-scan/run/route.ts), which has DB access.

import { isFreeEmailDomain } from "@/lib/email-domains"

const KEYWORD_MATCHES = [
  "sow",
  "proposal",
  "invoice",
  "estimate",
  "bid",
  "quote",
  "scope",
  "rfp",
  "contract",
  "nda",
  "deliverable",
  "production",
  "creative brief",
  "scope of work",
  "statement of work",
  "msa",
  "master service",
  "retainer",
  "freelance",
  "subcontract",
]
const KEYWORD_BONUS = 15
const KEYWORD_MAX = 45

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
  "info@",
]
const SYSTEM_ADDRESS_PENALTY = 50

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6
const THREE_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 3

export type VendorSignalContact = {
  email: string
  subjects: string[]
  message_count: number
  has_attachments: boolean
  attachment_types: string[]
  last_contact_date: string | null
}

export type VendorSignalScore = { score: number; signals: string[] }

export function scoreVendorSignal(contact: VendorSignalContact): VendorSignalScore {
  let score = 0
  const signals: string[] = []
  const email = contact.email.toLowerCase()
  const subjectHaystack = contact.subjects.join(" \n ").toLowerCase()

  let keywordMatches = 0
  for (const keyword of KEYWORD_MATCHES) {
    if (keywordMatches * KEYWORD_BONUS >= KEYWORD_MAX) break
    if (subjectHaystack.includes(keyword)) {
      keywordMatches += 1
      signals.push(`keyword:${keyword}`)
    }
  }
  score += Math.min(keywordMatches * KEYWORD_BONUS, KEYWORD_MAX)

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

  const isSystemAddress = SYSTEM_ADDRESS_PREFIXES.some((prefix) => email.startsWith(prefix))
  if (isSystemAddress) {
    score -= SYSTEM_ADDRESS_PENALTY
    signals.push("system_address")
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
