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
