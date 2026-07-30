/**
 * Target fields a spreadsheet column can map to when importing partners, and the
 * case-insensitive fuzzy header matching used to pre-fill the mapping step. This list is
 * bounded by what partnerships actually persists for a ghost/unclaimed contact (see
 * migration 068 and lib/server/partner-pool-import.ts) - discipline/type have no dedicated
 * column, so they land in partnership_notes.imported_meta rather than being validated
 * against an enum that doesn't exist on the real schema.
 */

export type PoolTargetField =
  | "email"
  | "contactName"
  | "companyName"
  | "phone"
  | "website"
  | "discipline"
  | "type"
  | "notes"
  | "skip"

export const POOL_TARGET_FIELDS: { value: PoolTargetField; label: string }[] = [
  { value: "email", label: "Email (required)" },
  { value: "companyName", label: "Company Name" },
  { value: "contactName", label: "Contact Name" },
  { value: "phone", label: "Phone" },
  { value: "website", label: "Website" },
  { value: "discipline", label: "Discipline / Category" },
  { value: "type", label: "Type" },
  { value: "notes", label: "Notes" },
  { value: "skip", label: "Skip this column" },
]

const HEADER_VARIANTS: Record<Exclude<PoolTargetField, "skip">, string[]> = {
  email: ["email", "e-mail", "email address"],
  companyName: ["company", "organization", "organisation", "agency", "vendor", "studio", "company name", "business name"],
  contactName: ["name", "contact", "contact name", "full name", "first name", "last name", "first+last"],
  phone: ["phone", "tel", "telephone", "mobile", "phone number"],
  website: ["website", "url", "site", "web"],
  discipline: ["discipline", "category"],
  type: ["type", "vendor type", "partner type"],
  notes: ["notes", "comments", "comment", "note"],
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ")
}

/** Case-insensitive fuzzy match on common header variants - exact match first, then
 *  substring match, so "Company / Organization" still matches "company". */
export function autoMapHeader(header: string): PoolTargetField {
  const normalized = normalizeHeader(header)
  if (!normalized) return "skip"

  for (const [field, variants] of Object.entries(HEADER_VARIANTS) as [Exclude<PoolTargetField, "skip">, string[]][]) {
    if (variants.includes(normalized)) return field
  }
  for (const [field, variants] of Object.entries(HEADER_VARIANTS) as [Exclude<PoolTargetField, "skip">, string[]][]) {
    if (variants.some((v) => normalized.includes(v))) return field
  }
  return "skip"
}

export function columnLetter(index: number): string {
  let n = index
  let out = ""
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}
