// Free/consumer email domains - a match here means the domain can't be used to infer
// "this vendor belongs to the same company as an existing profile" (Part C, domain-match
// flagging on the guest RFP bid flow). Anyone can have a gmail.com address; that's not a
// meaningful signal of shared company identity.
export const FREE_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]

export function getEmailDomain(email: string): string {
  const trimmed = (email || "").trim().toLowerCase()
  const at = trimmed.lastIndexOf("@")
  return at >= 0 ? trimmed.slice(at + 1) : ""
}

export function isFreeEmailDomain(email: string): boolean {
  const domain = getEmailDomain(email)
  return domain.length > 0 && FREE_EMAIL_DOMAINS.includes(domain)
}

// Known automated-sender / non-vendor domains (job boards, ATS platforms, marketing
// tooling, payment processors) - a match here is never a real vendor contact, so
// scoreVendorSignal hard-filters it to score 0 regardless of keyword hits.
export const SYSTEM_EMAIL_DOMAINS = [
  "github.com",
  "linkedin.com",
  "indeed.com",
  "workablemail.com",
  "amazon.com",
  "enterprise.com",
  "theatlantic.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
  "lever.co",
  "greenhouse.io",
  "ashbyhq.com",
  "mailchimp.com",
  "constantcontact.com",
  "hubspot.com",
  "salesforce.com",
  "eventbrite.com",
  "squarespace.com",
  "wix.com",
  "stripe.com",
  "paypal.com",
  "intuit.com",
  "angelikafilmcenter.com",
  "vailresortsmail.com",
]

export function isSystemEmailDomain(email: string): boolean {
  const domain = getEmailDomain(email)
  return domain.length > 0 && SYSTEM_EMAIL_DOMAINS.includes(domain)
}
