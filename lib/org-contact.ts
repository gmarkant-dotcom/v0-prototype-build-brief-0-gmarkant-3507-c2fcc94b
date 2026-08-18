/**
 * The organization primary contact: one shape, one fallback rule, thirteen call sites.
 *
 * WHY THIS FILE EXISTS. Before 079 a "vendor" was a profiles row, so one embed answered
 * both "what is this company called" and "who do we email". After 079 the foreign key on
 * partnerships.vendor_org_id (and every sibling) points at organizations, which carries a
 * name and nothing else. The company name resolves cleanly to organizations.name. The
 * email does not resolve at all, because a company can have several members.
 *
 * Greg's ruling: organizations gains a nullable primary_contact_user_id, and the embeds
 * become two hops:
 *
 *   vendor_org:organizations!vendor_org_id(
 *     id, name,
 *     primary_contact:profiles!primary_contact_user_id(id, email, full_name)
 *   )
 *
 * Chosen over denormalizing contact_email and contact_name onto organizations: one source
 * per fact, and the contact is a designated person rather than whoever signed up first.
 *
 * THE FAILURE MODE THIS FILE GUARDS. A PostgREST to-one embed that resolves to no row
 * returns null. It does NOT error. That is true when the foreign key is null, and it is
 * true when row level security filters the target row away. Proved read-only against the
 * live database on 2026-08-17: a partnerships row with a null vendor side returned
 * "partner": null with HTTP 200. So every consumer here must treat null as a first-class
 * case, or a vendor name silently renders blank.
 *
 * There are TWO independent nulls and they mean different things:
 *   vendor_org === null        the organization row is missing or unreadable
 *   primary_contact === null   the organization has no designated contact, OR the
 *                              designated user was deleted (the column is ON DELETE SET
 *                              NULL), OR the caller cannot read that profile
 * Both are handled identically at the surface, because the product cannot tell them apart
 * from the response, and both are logged so the server can.
 *
 * THE ONE FALLBACK RULE, used at all thirteen sites:
 *   display name   organizations.name -> the row's own partner_email/recipient_email
 *                  -> the contact email -> "Unnamed vendor". Never blank.
 *   contact email  primary_contact.email -> the row's own partner_email/recipient_email
 *                  -> null. Null means SKIP THE SEND AND LOG. Never send to "".
 *   contact name   primary_contact.full_name -> the organization name -> the contact
 *                  email -> "there". Never blank.
 */

/** A profiles row reached through organizations.primary_contact_user_id. */
export type OrgPrimaryContactRow = {
  id?: string | null
  email?: string | null
  full_name?: string | null
  capabilities?: unknown
  company_logo_url?: string | null
  created_at?: string | null
}

/** An organizations row reached through any *_org_id foreign key. */
export type OrgEmbedRow = {
  id?: string | null
  name?: string | null
  primary_contact?: OrgPrimaryContactRow | OrgPrimaryContactRow[] | null
}

/** What PostgREST actually hands back: the row, an array of one, or null. */
export type OrgEmbed = OrgEmbedRow | OrgEmbedRow[] | null | undefined

/**
 * The select fragment. Every site uses one of these two so the shape cannot drift.
 * The `!primary_contact_user_id` hint is the column-name form; both the column-name and
 * the constraint-name form were proved to work against the live database, and the column
 * name is the one that does not change if the constraint is ever recreated.
 */
export const ORG_CONTACT_SELECT =
  'id, name, primary_contact:profiles!primary_contact_user_id(id, email, full_name)'

/** The pool card variant. capabilities, company_logo_url and created_at live on profiles
 *  and 079 creates no organization-level column for any of them, so they continue to come
 *  from the contact's own profile row. That is a known loss of fidelity under the org
 *  model and is listed for Greg in the report. */
export const ORG_CONTACT_SELECT_RICH =
  'id, name, primary_contact:profiles!primary_contact_user_id(id, email, full_name, capabilities, company_logo_url, created_at)'

/** PostgREST returns a to-one embed as an object, but the generated types and some
 *  nesting depths surface it as a one-element array. Every read goes through this. */
export function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

export type OrgContact = {
  /** organizations.id. Under the org model this is the vendor identity every consumer
   *  links on, and it is what partnerships.vendor_org_id holds. */
  orgId: string | null
  orgName: string | null
  contactUserId: string | null
  contactEmail: string | null
  contactFullName: string | null
  /** True when the organization row itself came back null: missing FK, or RLS. */
  orgMissing: boolean
  /** True when the organization resolved but has no readable primary contact. */
  contactMissing: boolean
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Normalize the nested embed into the one shape the rest of the codebase reads.
 *
 * `rowEmail` is the pre-claim identifier the row already carries in its own column
 * (partnerships.partner_email, partner_rfp_inbox.recipient_email). It is not a second
 * source of truth for the contact; it is the address the agency typed before anybody
 * claimed the invitation, and it is the only thing that keeps a ghost row addressable.
 */
export function resolveOrgContact(embed: OrgEmbed, rowEmail?: string | null): OrgContact {
  const org = unwrapOne(embed)
  const contact = unwrapOne(org?.primary_contact)
  const fallbackEmail = clean(rowEmail)
  return {
    orgId: clean(org?.id),
    orgName: clean(org?.name),
    contactUserId: clean(contact?.id),
    contactEmail: clean(contact?.email) ?? fallbackEmail,
    contactFullName: clean(contact?.full_name),
    orgMissing: !org,
    contactMissing: !!org && !contact,
  }
}

/** The company name as shown to a human. Never blank. */
export function orgDisplayName(contact: OrgContact, fallbackLabel = 'Unnamed vendor'): string {
  return contact.orgName ?? contact.contactEmail ?? fallbackLabel
}

/** How to address the recipient in an email greeting. Never blank. */
export function orgGreetingName(contact: OrgContact, fallbackLabel = 'there'): string {
  return contact.contactFullName ?? contact.orgName ?? contact.contactEmail ?? fallbackLabel
}

/**
 * The legacy wire shape.
 *
 * DELIBERATE: the JSON these routes emit keeps the key `partner` and the field names
 * `id`, `email`, `full_name`, `company_name`. Renaming them would mean editing every
 * consumer in eight frontend files, and a consumer missed there renders `undefined`
 * rather than failing, which is the exact failure this whole exercise exists to prevent.
 * The QUERY changes shape; the PAYLOAD does not. What each field now means:
 *
 *   id            organizations.id     (was profiles.id; identical for every backfilled
 *                                       organization, and the org id is what consumers
 *                                       actually use, since they match it against
 *                                       vendor_org_id and link to /agency/pool/<id>)
 *   company_name  organizations.name   (was profiles.company_name)
 *   email         the primary contact's email, or the row's own pre-claim address
 *   full_name     the primary contact's name
 *
 * Listed in docs/079-embed-closure-report.md for Greg to overrule if he wants the wire
 * keys renamed too.
 */
export type LegacyPartnerShape = {
  id: string | null
  email: string | null
  full_name: string | null
  company_name: string | null
  capabilities?: unknown
  company_logo_url?: string | null
  created_at?: string | null
}

export function legacyPartnerShape(
  embed: OrgEmbed,
  rowEmail?: string | null,
  options?: { rich?: boolean }
): LegacyPartnerShape | null {
  const org = unwrapOne(embed)
  if (!org) return null
  const contact = unwrapOne(org.primary_contact)
  const resolved = resolveOrgContact(embed, rowEmail)
  const base: LegacyPartnerShape = {
    id: resolved.orgId,
    email: resolved.contactEmail,
    full_name: resolved.contactFullName,
    company_name: resolved.orgName,
  }
  if (options?.rich) {
    base.capabilities = contact?.capabilities ?? null
    base.company_logo_url = clean(contact?.company_logo_url)
    base.created_at = clean(contact?.created_at)
  }
  return base
}

/**
 * Log a null organization or a null primary contact.
 *
 * Every one of the thirteen sites calls this. The silent version of this failure is what
 * produced five separate silent-empty bugs in this codebase in one month: the embed comes
 * back null, the field renders blank, nothing errors, and nobody finds out until a vendor
 * asks why their name is missing.
 */
export function logOrgContactGap(
  site: string,
  contact: OrgContact,
  context: Record<string, unknown> = {}
): void {
  if (contact.orgMissing) {
    console.warn('[org-contact] organization embed resolved to null', {
      site,
      reason: 'null foreign key, or row level security filtered the organizations row',
      ...context,
    })
    return
  }
  if (contact.contactMissing) {
    console.warn('[org-contact] organization has no readable primary contact', {
      site,
      orgId: contact.orgId,
      orgName: contact.orgName,
      reason:
        'primary_contact_user_id is null (never set, or the designated user was deleted - the column is ON DELETE SET NULL), or row level security filtered the profiles row',
      usingRowEmailFallback: contact.contactEmail !== null,
      ...context,
    })
  }
}
