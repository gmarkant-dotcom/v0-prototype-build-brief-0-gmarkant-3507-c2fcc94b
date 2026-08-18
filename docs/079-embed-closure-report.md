# Closing the thirteen embeds: execution report

Companion to `docs/079-rename-execution-report.md`, which opened "The thirteen broken embeds"
and left them unresolved. This closes them.

**Branch `feat/079-org-rename`. Nothing pushed, nothing merged, no migration applied, no write
query run.**

---

## THE HEADLINE, BEFORE ANYTHING ELSE

The thirteen embeds are rewritten to Greg's ruled shape and every consumer is traced. The
migration carries `primary_contact_user_id`. Both guards exit 0, `npx tsc --noEmit` exits 0 and
`pnpm build` exits 0.

**And the thirteen will still render blank, because of a policy nobody has looked at yet.**

Migration 079 PHASE 11 gives `organizations` exactly one SELECT policy:

```sql
CREATE POLICY "Members read their organizations"
  ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_org_ids()));
```

`current_user_org_ids()` returns **the caller's own organizations and nothing else**. Every one
of the thirteen embeds reads a **counterparty** organization: a lead agency reading its vendor,
or a vendor reading its lead agency. Not one of them reads an organization the caller belongs
to.

So the outer hop resolves to null before the nested contact is ever evaluated, and a null to-one
embed returns `null` with HTTP 200 rather than an error. The company name blanks, the contact
blanks, nothing throws.

This is the exact failure the task exists to prevent, one layer above where it was expected. It
is **not fixed here**, because fixing it means writing a policy, and the standing doctrine puts
that with Greg. The recommendation is in Item 1.4. Until it is ruled, this branch is not
releasable even with the embeds correct.

---

## ITEM 1: THE SECURITY MATRIX

### 1.1 The rules being checked against

Read from `docs/schema-snapshot-2026-08-13.md` (authoritative for the live database) and from
the unapplied policy text in `supabase/migrations/079_organizations.sql` PHASE 10 and 11. No
policy was queried from the live database in this session and none could have been: 079 is
unapplied, so `organizations` does not exist.

**`profiles` SELECT, after 079** (three live policies folded into one, plus one untouched):

| Policy | Predicate |
|---|---|
| Users can view profiles of partnership members | `id = auth.uid() OR id IN (SELECT current_user_visible_profile_ids())` |
| Authenticated users can read discoverable profiles | `is_discoverable = true` |

`current_user_visible_profile_ids()` (PHASE 6) returns members of the caller's own
organizations, plus members of every organization on the other side of a partnership involving
one of the caller's organizations, in either direction, at any status.

**`organizations` SELECT, after 079** (PHASE 11): one policy, `id IN (SELECT
current_user_org_ids())`. The caller's own organizations only.

### 1.2 The matrix

Every row is the same two-hop read: the caller reads a row that carries an organization id, the
embed resolves that id to an `organizations` row, and the nested embed resolves that
organization's `primary_contact_user_id` to a `profiles` row.

| # | Site | Client | Caller | Target organization | Hop 1: `organizations` | Hop 2: `profiles` |
|---:|---|---|---|---|---|---|
| 1 | `app/api/partnerships/route.ts` GET agency | session | lead agency member | vendor org of each partnership | **NULL** | would pass |
| 2 | `app/api/projects/route.ts` GET agency | session | lead agency member | vendor org via assignment | **NULL** | would pass |
| 3 | `app/api/projects/route.ts` GET vendor | session | vendor member | lead agency org of the project | **NULL** | would pass |
| 4 | `app/api/projects/[id]/assignments/route.ts` GET | session | lead agency member | vendor org of each assignment | **NULL** | would pass |
| 5 | `app/api/projects/[id]/assignments/route.ts` POST | session | lead agency member | vendor org just assigned | **NULL** | would pass |
| 6 | `app/api/projects/[id]/onboarding-packages/route.ts` GET | session | lead agency member | vendor org of each package | **NULL** | would pass |
| 7 | `app/api/projects/[id]/onboarding-partners/route.ts` GET | session | lead agency member | vendor org of each assignment | **NULL** | would pass |
| 8 | `app/api/projects/[id]/onboarding/deploy/route.ts` POST | session | lead agency member | vendor org being onboarded | **NULL** | would pass |
| 9 | `app/api/agency/active-engagements/route.ts` GET | session | lead agency member | vendor org of each awarded assignment | **NULL** | would pass |
| 10 | `app/api/agency/projects/[projectId]/status-updates/route.ts` GET | session | lead agency member | vendor org of each partnership | **NULL** | would pass |
| 11 | `app/api/agency/broadcast-rfp/route.ts` POST (pool vendor) | session | lead agency member | vendor org being broadcast to | **NULL** | would pass |
| 12 | `app/api/agency/broadcast-rfp/route.ts` POST (manual recipient) | session | lead agency member | none - embed removed, see Item 3 | n/a | n/a |
| 13 | `app/agency/pool/page.tsx` `loadAccessRequests` | session (browser) | lead agency member | vendor org that requested access | **NULL** | **NULL** |

"would pass" means: if the organizations hop were permitted, the nested `profiles` read would
succeed, because a partnership exists between the caller's organization and the target
organization, which is precisely what `current_user_visible_profile_ids()` returns.

### 1.3 The two flagged classes

**Class A, all thirteen: the organizations hop.** Described in the headline. Sites 1 to 11 fail
for one reason only, and it is a single policy.

**Class B, site 13 alone: the profiles hop fails too, and it fails independently.** A
`partner_access_requests` row is a vendor asking to **join** an agency's pool. Confirmed by
reading both writers, `app/partner/marketplace/page.tsx:127` and
`app/partner/network/page.tsx:504`: neither creates a partnership. So there is no partnership
between caller and target, so the vendor's organization is not a counterparty, so
`current_user_visible_profile_ids()` does not include its members. The only remaining
disjunct is `is_discoverable = true`.

Measured read-only against the live database on 2026-08-17: **14 of 16 profiles carry
`is_discoverable = false`.** For those fourteen, this embed returns null today under the live
`profiles` policies and will return null after 079 as well. **This is a pre-existing null, not
one 079 introduces.** It is worse after 079 only because the organizations hop fails first, so
even the company name goes.

Site 13 also has a second problem the fallback cannot cover: `partner_access_requests` carries
no email column, so there is no row-level address to fall back to. With the organization
unreadable the card renders `Unnamed vendor` and nothing else. Honest, and useless.

### 1.4 What is recommended, and NOT done

**No policy was written, weakened or touched.** The contact-information boundary is ruled and
this run does not move it. Two decisions for Greg:

**Decision 1, the blocker.** Add a second SELECT policy on `organizations` granting read of a
**counterparty** organization: id, name, capability flags and `primary_contact_user_id`. The set
is already computed inside `current_user_visible_profile_ids()` as its `counterparty_orgs` CTE
and would be lifted into a helper of its own. This is strictly narrower than what the product
already shows: a lead agency that can see a vendor's founding user's `company_name` today would
see that same company's name, and no contact details it could not already reach.

**Decision 2, site 13.** A vendor that has asked to join a pool is not a counterparty and should
probably not become one on the strength of the request. Options, in the order I would rank them:

1. Permit the **organization name only** for an organization with a pending
   `partner_access_requests` row addressed to one of the caller's organizations. The card shows
   the company; the contact stays null and falls back. A vendor volunteered its identity by
   asking; the person's address is a different question.
2. Snapshot `requested_by_user_id` on the request row and embed that instead. Truthful about
   what the row is - one person asked - and needs no organizations read at all.
3. Leave it. Accept that the pool's pending-request cards read `Unnamed vendor` for the
   fourteen non-discoverable accounts.

Whatever is chosen, **do not solve either decision by loosening a `profiles` policy**, and do
not solve it by moving these routes onto the service-role client. See Item 1.5.

### 1.5 Session versus service role

**All thirteen run on the SESSION client. None runs on the service-role client.** Verified by
reading the client construction in every file: twelve build `createClient()` from
`lib/supabase/server.ts`, which is the anon key plus the request's cookies, and site 13 builds
`createClient()` from `lib/supabase/client.ts` in the browser. `lib/api-auth.ts`'s `requireAuth`
wraps the same server client.

That makes the split trivially uniform and the consequence uniform with it: row level security
applies at all thirteen, the null fallback matters at all thirteen, and there is no group where
the embed populates regardless.

It also means there is a tempting non-fix available. Moving any of these to the service-role
client would make the embeds populate immediately, because service role bypasses row level
security entirely. **That is not a fix, it is the boundary removed.** A service-role read of
`organizations` and `profiles` returns every company's contact to whoever calls the route, and
the route's own scoping becomes the only thing standing between a vendor and a team's contact
list. The eleven service-role routes this branch already hardened
(`docs/079-rename-execution-report.md`, "The service-role routes") are the record of how much
work it is to make that safe once, let alone thirteen times.

### 1.6 What was executed and what was read

**Executed, read-only, against the live database on 2026-08-17:**

- Two-level and four-level PostgREST nesting, both hint forms. Item 4.
- A to-one embed with a null foreign key returns `"partner": null` with HTTP 200. Item 4.
- An embed naming a relationship that does not exist returns HTTP 400 `PGRST200`. Item 4.
- 14 of 16 profiles carry `is_discoverable = false`.
- The single existing `partner_access_requests` row is `approved`, not `pending`, and its vendor
  happens to be one of the two discoverable accounts. So site 13's failure has **zero live rows
  behind it today**, which is exactly why it would have shipped unnoticed.

**NOT executed. Every one of these is a reading:**

- **That an RLS-filtered to-one embed returns null rather than erroring.** This is the load
  bearing claim of the entire matrix and I could not execute it. It needs a query issued as a
  real authenticated user whose policies filter the embedded row, and the only anon-readable
  table in this schema (`partner_vouches`, `USING (true)`) carries no foreign key to embed
  through - I tried, and PostgREST answered `PGRST200`. Signing a JWT against
  `SUPABASE_JWT_SECRET` to impersonate a live user would have executed it and I did not do
  that. What IS executed is the null-foreign-key case, which produces the identical `null`
  payload; the RLS case is inferred from Postgres applying row level security to every relation
  a query references. **Confident, and not observed.**
- Every claim about the post-079 policy set. 079 is unapplied.
- That sites 1 to 11 "would pass" the profiles hop. That is a reading of
  `current_user_visible_profile_ids()` against the shape of the data each route selects.

---

## ITEM 2: THE MIGRATION CHANGE

`supabase/migrations/079_organizations.sql`, four edits, plus the down migration.

**PHASE 1, the column.**

```sql
primary_contact_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
```

Nullable, with the reason written at the site: an organization with no designated contact is a
real and recoverable state, and a NOT NULL column would force the PHASE 12 trigger into a fixed
write order for a value it already knows, and would reject any organization created by a future
admin flow before its first member exists.

**The deletion behaviour, and why.** `ON DELETE SET NULL`, chosen against two alternatives.
`CASCADE` would delete the **company** when one person's account is deleted, and every project,
partnership and bid that references it with it - a contact is a pointer at a person, not the
company's existence. `RESTRICT` would make deleting any user who happens to be a contact fail at
the database with no product surface that explains why. `SET NULL` keeps the company and blanks
the contact.

The cost of that choice is stated rather than hidden, in the migration and again in Item 3:
**deleting a user silently blanks the contact across all thirteen surfaces**, and presents
exactly as the never-set case. `lib/org-contact.ts` handles both through one path for that
reason.

**PHASE 2, the backfill.** Written into the same `INSERT` that creates each organization:

```sql
INSERT INTO public.organizations (id, name, primary_contact_user_id,
                                  is_lead_agency, is_vendor, created_at)
SELECT
  p.id,
  COALESCE(...),
  p.id,          -- the founding user
  ...
FROM public.profiles p
```

**The backfill is trivial and it is trivial for a stated reason.** Under Option C the
organization id IS the founding user's id - the select list already writes `p.id` as the primary
key - so the founder is `p.id` by construction. No join, no correlated subquery, no second
`UPDATE` pass. This is the one place the org-id-equals-user-id coincidence is legitimately used,
it is used at backfill time only, and the PHASE 12 trigger writes `NEW.id` explicitly instead.

**PHASE 12, the trigger.** `primary_contact_user_id` is set explicitly to `NEW.id`. Without it,
every account created after 079 gets an organization with no contact and all thirteen surfaces
fall back for it from its first day.

**Verification queries added.** After PHASE 2 and again in the file's verification block:

```sql
SELECT count(*) FROM public.organizations WHERE primary_contact_user_id IS NULL;
-- expect 0

SELECT count(*) FROM public.organizations o
WHERE o.primary_contact_user_id IS DISTINCT FROM o.id;
-- expect 0 for the backfill only. Must NOT become a constraint: every
-- organization created from PHASE 12 onward has an id that belongs to no user.
```

**Header updated** with a new section, "organizations.primary_contact_user_id: WHAT IT IS FOR" -
what the column is for, that the thirteen embeds depend on it, that it is the first field of the
ruled company primary contact arriving early, and the ruling's reasoning against denormalizing.
`COMMENT ON COLUMN` says the same thing to anyone reading the database instead of the file.

**`contact_email` and `contact_name` were NOT added.** Considered and rejected: one source per
fact, and the contact is a designated person rather than whoever signed up first.

**Down migration mirrored.** `079_organizations_down.sql` already drops `organizations CASCADE`,
so there is no column to reverse and no statement to add - and that absence is exactly what
looks like an oversight, so it is recorded as limit 4b in the "WHAT THIS FILE CANNOT RESTORE"
list, with the capture query for any organization that had designated somebody other than its
founder, and a note that re-running 079 silently reverts every such designation.

---

## ITEM 3: THE THIRTEEN

### 3.1 The shape, and one deliberate deviation

Every rewritten query takes the ruled form, from one shared fragment in `lib/org-contact.ts` so
it cannot drift:

```ts
vendor_org:organizations!vendor_org_id(
  id, name,
  primary_contact:profiles!primary_contact_user_id(id, email, full_name)
)
```

**THE DEVIATION, stated up front so it is a decision and not a discovery.** The brief says every
consumer of the returned shape changes with it - `partner.company_name` becomes
`vendor_org.name`, and so on. **The queries changed. The JSON payloads did not.** Each route
folds the two-hop embed back onto the key it has always emitted, `partner` (or `agency`), with
the same field names.

The reason is the brief's own: *miss one consumer and the field renders undefined rather than
failing.* Renaming the wire keys means editing eight frontend files - `app/agency/page.tsx`,
`app/agency/pool/page.tsx`, `app/agency/msa/page.tsx`, `app/partner/page.tsx`,
`app/partner/network/page.tsx`, `app/partner/payments/page.tsx`,
`contexts/lead-agency-filter-context.tsx`, `components/marketplace-content.tsx` - against a
payload no compiler checks, in a run where nothing can be executed against a database. Not
creating the opportunity is a better defence than traversing it carefully. The category-(b)
analysis in `docs/079-rename-execution-report.md` is the record of how that class of miss
behaves.

What each preserved field now means is documented in `lib/org-contact.ts`:

| Wire field | Was | Is now |
|---|---|---|
| `partner.id` | `profiles.id` | `organizations.id` |
| `partner.company_name` | `profiles.company_name` | `organizations.name` |
| `partner.email` | `profiles.email` | the primary contact's email, or the row's pre-claim address |
| `partner.full_name` | `profiles.full_name` | the primary contact's name |

`partner.id` is the one worth checking rather than trusting, and it checks out: every consumer
uses it to match against `vendor_org_id` or to link to `/agency/pool/<id>`, both of which want
the organization id. Under the backfill the two values are identical anyway.

**Overrule this if you want the keys renamed.** It is one afternoon and eight files, and it
should be done from a state where the pages can actually be loaded.

### 3.2 The thirteen, before and after

| # | Site | Before | After | Consumers touched |
|---:|---|---|---|---|
| 1 | `app/api/partnerships/route.ts:87` | `partner:profiles!partnerships_partner_id_fkey(id,email,full_name,company_name,capabilities,company_logo_url,created_at)` | `vendor_org:organizations!vendor_org_id(ORG_CONTACT_SELECT_RICH)` | in-file normalizer; wire key `partner` unchanged, so `app/agency/page.tsx`, `app/agency/pool/page.tsx:448`, `components/marketplace-content.tsx:119` unchanged and re-read to confirm |
| 2 | `app/api/projects/route.ts:151` | `partnership:partnerships(partner:profiles!...fkey(id,company_name,full_name))` | four levels: `projects -> project_assignments -> partnerships -> organizations -> profiles` | new `normalizeAssignmentPartners()`; no external consumer reads this partner at all (only `status`), confirmed by grep across `app`, `lib`, `components`, `contexts` |
| 3 | `app/api/projects/route.ts:415` | `agency:profiles!projects_agency_id_fkey(id,company_name,full_name)` | `lead_org:organizations!org_id(ORG_CONTACT_SELECT)` | in-file mapper now builds `agency` from `resolveOrgContact`; the `agency` wire key and its two fields are unchanged |
| 4 | `app/api/projects/[id]/assignments/route.ts:61` | as #1, four fields | `vendor_org:organizations!vendor_org_id(...)` under `partnership` | in-file normalizer; `components/stage-03-onboarding-production.tsx:186` reads `a.partnership?.partner?.company_name` and is unchanged |
| 5 | `app/api/projects/[id]/assignments/route.ts:167` (POST) | same, on `.insert().select()` | same | the invitation email now addresses `vendorContact.contactEmail`; response reshaped to keep `partner` |
| 6 | `app/api/projects/[id]/onboarding-packages/route.ts:68` | as #4 | same | in-file normalizer on the response |
| 7 | `app/api/projects/[id]/onboarding-partners/route.ts:62` | as #4 | same | `PartnerOut["partner"]` is now `LegacyPartnerShape`, same fields; `components/stage-03-onboarding-workflow.tsx:587` and `:925` unchanged |
| 8 | `app/api/projects/[id]/onboarding/deploy/route.ts:81` | as #4 | same | `partner.email` / `partner.company_name` reads replaced with the resolved contact; the 400 guard message updated |
| 9 | `app/api/agency/active-engagements/route.ts:179` | as #4 | same | route already normalized into `PartnerRow.partner { companyName, fullName, email }`; that shape is unchanged, so `app/agency/project/page.tsx:94` is unchanged |
| 10 | `app/api/agency/projects/[projectId]/status-updates/route.ts:86` | `partner:profiles!...fkey(company_name,full_name)` | `vendor_org:organizations!vendor_org_id(ORG_CONTACT_SELECT)` | emits `partner_display_name`, now from `orgDisplayName()`; wire key unchanged |
| 11 | `app/api/agency/broadcast-rfp/route.ts:204` | `partner:profiles!...fkey(email,full_name,company_name)` | `vendor_org:organizations!vendor_org_id(...)` | `normalizePartnerProfile()` deleted, `PartnershipRow.partner` becomes `vendor_org`; recipient resolution folded into one rule |
| 12 | `app/api/agency/broadcast-rfp/route.ts:343` | same | **embed REMOVED, not rewritten** | none. See below |
| 13 | `app/agency/pool/page.tsx:661` | `partner:profiles!vendor_org_id(full_name,company_name,email)` | `vendor_org:organizations!vendor_org_id(ORG_CONTACT_SELECT)` | `AccessRequest` mapping rewritten. See 3.4 |

**Site 12 is a removal, and the reason matters.** That lookup consumes exactly two fields, `id`
for `partnership_id` and `nda_confirmed_at` for the NDA gate, both read within twenty lines. It
never touched the partner profile it was selecting. Rewriting it to the two-hop form would have
added a join, an RLS surface and a null case for data nobody reads. The recipient at that site
is the manually typed email address, not a pool vendor's contact.

### 3.3 The two message-sender embeds are correctly out of scope

`app/api/projects/[id]/messages/route.ts:94` and `:234`, both
`sender:profiles!project_messages_sender_id_fkey(...)`. **Confirmed unaffected and deliberately
untouched.** `sender_id` is a user id, it is not in 079 PHASE 7's list of thirty repointed
columns, and the foreign key still reaches `profiles`. The new check in Item 5 allow-lists that
constraint by name, so a future run cannot quietly "fix" it.

### 3.4 `app/agency/pool/page.tsx:661`, the one that was broken differently

The other twelve carried a **constraint** name. This one carried a **column** name:
`profiles!vendor_org_id`.

That is what made it dangerous. The column name is the post-079 one, so it reads as though
somebody had already been through it, and the identity guard - which matches the old names -
saw nothing to report either. It was as broken as the rest: after 079 the foreign key on
`vendor_org_id` reaches `organizations` and not `profiles`, whichever way the hint is spelled.
PostgREST resolves both hint forms identically, which was executed and confirmed in Item 4.

It is now the same two-hop form as the other twelve, and it is the site carrying the Class B
security failure in Item 1.3.

Its display mapping changed with it. The old code read `partnerName: req.partner?.full_name ||
req.partner?.company_name` - person first, company second. It now reads
`orgDisplayName(contact, 'Unnamed vendor')` - company first, never blank. Under the organization
model the company is the fact this row is about.

### 3.5 The null fallback, chosen once and used everywhere

One rule, in `lib/org-contact.ts`, called at all thirteen:

| | Rule |
|---|---|
| **display name** | `organizations.name` -> the row's own `partner_email` / `recipient_email` -> the contact's email -> `"Unnamed vendor"`. **Never blank.** |
| **contact email** | `primary_contact.email` -> the row's own pre-claim address -> `null`. **Null means skip the send and log.** Never `""`. |
| **contact name** | `primary_contact.full_name` -> the organization name -> the contact email -> `"there"`. **Never blank.** |

**Company name alone, not a placeholder, wherever a company name exists** - that is the point of
the first row of the table. `"Unnamed vendor"` appears only when there is no name and no address
anywhere on the row, which after the Item 1 blocker is unfortunately common at site 13.

**It covers the deleted-user case, not only the never-set case.** `ON DELETE SET NULL` means a
deleted user leaves `primary_contact_user_id` null, which presents to PostgREST as
`primary_contact: null` - byte for byte what a never-set contact produces. There is no branch on
"why", because the response cannot tell you why. `resolveOrgContact()` reports `orgMissing` and
`contactMissing` separately so the **server log** can say which layer failed, and
`logOrgContactGap()` names all four possible reasons in the warning it emits.

**Every gap is logged.** Ten of the eleven email sites in the previous run were silent, and that
was the actual defect. Not repeated here: every one of the thirteen calls `logOrgContactGap()`,
and the two sites that refuse rather than degrade - `onboarding/deploy` returns 400, `assignments`
POST skips the invitation email - log before they do.

**One site deliberately refuses instead of degrading.**
`app/api/projects/[id]/onboarding/deploy/route.ts` exists to email a vendor an onboarding
package. With no address there is nothing to deploy, so a null contact is a 400 with a message
naming the contact, not a fallback. Same rule, different terminal case.

### 3.6 PostgREST expressed every shape. No second-query fallback was needed anywhere

Item 4 proved two-level and four-level nesting, in both hint forms, against the live database
before any of this was written. The deepest site needed is #2 at four levels
(`projects -> project_assignments -> partnerships -> organizations -> profiles`) and four levels
returned data. **No site fell back to an explicit second query**, so the question of doing it
consistently does not arise.

### 3.7 Two sites fixed that are NOT among the thirteen

Both are the same break in non-embed form - "JOIN profiles ON profiles.id = an org id", the trap
079's own table comment names - and both sit inside a handler already being rewritten, feeding
the same wire shape.

1. **`app/api/partnerships/route.ts`, vendor branch.** Looked `lead_org_id` up in `profiles` to
   build the `agency` object. Now reads `organizations` with the same fragment. Left alone it
   blanks the lead agency's name across the whole vendor portal for every organization created
   after 079. Consumers re-read and unchanged: `app/partner/network/page.tsx:583`,
   `app/partner/payments/page.tsx:227`, `contexts/lead-agency-filter-context.tsx:84`.
2. **`app/api/projects/[id]/onboarding-partners/route.ts`, awarded-bid branch.** Looked
   `partner_rfp_responses.vendor_org_id` up in `profiles`. Now reads `organizations`. It fills
   the same `PartnerOut.partner` shape as the embed above it, so leaving one converted and one
   not would have produced two different answers on one card.

Both are subject to the same Item 1 blocker.

---

## ITEM 4: THE LIVE PROOF

Executed against the production Supabase project over PostgREST, read-only, `GET` only, on
2026-08-17. Today's schema, where the column is still `partner_id`. **The post-079 form cannot
be tested: `organizations` does not exist and `primary_contact_user_id` does not exist.** What is
proved is the NESTING SYNTAX and the null behaviour, which is where the risk of a
blank-instead-of-failing render lives.

**4.1 Two-level nesting, constraint-name hints, the exact shape of sites 4 to 10.**

```
GET /rest/v1/project_assignments?select=id,partnership:partnerships
    !project_assignments_partnership_id_fkey(id,partner_email,
      partner:profiles!partnerships_partner_id_fkey(email,full_name,company_name))&limit=4
HTTP 200
[
  { "id": "48d17118-...", "partnership": { "id": "c0851865-...",
      "partner": { "email": "gmarkant@icloud.com", "full_name": "April Greg Partner",
                   "company_name": "April Partner Test Agency" },
      "partner_email": "gmarkant@icloud.com" } },
  { "id": "feb6ddf9-...", "partnership": { "id": "e6361792-...",
      "partner": { "email": "gmarkant+partner71@gmail.com", "full_name": "G71",
                   "company_name": "71" },
      "partner_email": "gmarkant+partner71@gmail.com" } },
  { "id": "7e1b8565-...", "partnership": { "id": "27c9b339-...",
      "partner": null,
      "partner_email": "gmarkant+partner65@gmail.com" } },
  { "id": "581e3b86-...", "partnership": { "id": "c0851865-...", "partner": { ... } } }
]
```

**The third row is the whole point.** That partnership has a null vendor side - 27 of 31
partnership rows do, per the migration header - and the embed returns `"partner": null` with
**HTTP 200**. Not an error. Not an omitted key. A null where a name goes. That is the failure
mode every one of the thirteen has to handle, and it is now handled by one rule.

**4.2 The column-name hint form resolves identically.** Same query with
`partnerships!partnership_id` and `profiles!partner_id` returned byte-identical JSON, HTTP 200,
including the same `"partner": null` on the same row. This is what makes site 13's
`profiles!vendor_org_id` a genuine break rather than a spelling variant: the form is valid, the
target table is wrong.

**4.3 A wrong hint fails LOUDLY.** `profiles!invited_by` on a `profiles` embed:

```
HTTP 400
{"code":"PGRST200",
 "details":"Searched for a foreign key relationship between 'profiles' and 'profiles'
            using the hint 'invited_by' in the schema 'public', but no matches were found.",
 "message":"Could not find a relationship between 'profiles' and 'profiles' in the schema cache"}
```

So the thirteen, left unfixed, would have **400'd** rather than silently blanked - except that
sites 1 and 2 sit inside `try`/fallback wrappers that catch the error and rerun a plain select,
converting a loud 400 into missing fields. Worth naming: the fallback that was added to make
those routes resilient is what would have hidden this.

**4.4 Four-level nesting, the depth site 2 needs.**

```
GET /rest/v1/partner_rfp_response_versions?select=id,response:partner_rfp_responses!response_id(
      id,inbox:partner_rfp_inbox!inbox_item_id(id,project:projects!project_id(
        id,agency:profiles!agency_id(email,full_name,company_name))))&limit=1
HTTP 200
[{ "id": "cd821269-...", "response": { "id": "519534d6-...",
     "inbox": { "id": "56f03d17-...",
       "project": { "id": "8263f702-...",
         "agency": { "email": "gmarkant@gmail.com", "full_name": "Greg Markant",
                     "company_name": "m a r k a n t" } } } } }]
```

Four embed levels, terminating in a hinted `profiles` embed. PostgREST can express every shape
the thirteen need.

**4.5 What this does NOT prove.** It does not prove any post-079 query works. It does not prove
the constraint names 079 mints resolve. It does not prove the RLS behaviour in Item 1, which is
the one thing that decides whether these render. These queries ran on the **service-role** key,
which bypasses row level security entirely, precisely so the shape could be observed without a
policy filtering it.

---

## ITEM 5: THE GUARD'S BLIND SPOT

**Reliable detection IS achievable for this class, and it is now in the tree** as
`scripts/check-embed-targets.mjs`, a second check rather than a change to the existing one, so
the identity guard's contract is untouched.

**How it works.** It parses the thirty `(table, column)` pairs out of migration 079's PHASE 7
`DO $repoint$` block - **from the migration, not transcribed from it**, so the check cannot drift
from the thing it checks - and refuses to report a clean tree if that parse yields zero pairs.
It then blanks out comment bodies (position-preserving, so line numbers stay true) and scans
every `table!hint(` embed hint in application source. Two findings:

- **REPOINTED** - the hint names a repointed column, by its post-079 name or by the pre-079 name
  a constraint name still carries, and the embedded table is not `organizations`. Matching is
  `_`-token-aware, so `partnerships_partner_id_fkey` matches `partner_id` and
  `project_assignments_partnership_id_fkey` does not.
- **PERSON** - the embedded table is `profiles` or `auth.users` through a hint not on a short
  allow-list of genuinely person-valued keys (`project_messages_sender_id_fkey`,
  `primary_contact_user_id`, `sender_id`, `user_id`, `uploaded_by`, `invited_by`).

Blanking comments is not fastidiousness: this report and the code comments quote the broken
embeds verbatim, and a check that flags its own documentation is a check nobody runs twice.

**Proof, against the pre-fix tree** (`git worktree` at `HEAD`, the commit before this work):

```
PostgREST embeds traversing foreign keys that 079 repoints
Repointed (table, column) pairs parsed from 079 PHASE 7: 30
Scanned 364 files.

  app/agency/pool/page.tsx
      661  REPOINTED  profiles!vendor_org_id                 ...not at profiles
  app/api/agency/active-engagements/route.ts
      179  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
  app/api/agency/broadcast-rfp/route.ts
      204  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
      343  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
  app/api/agency/projects/[projectId]/status-updates/route.ts
       86  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
  app/api/partnerships/route.ts
       87  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
  app/api/projects/[id]/assignments/route.ts
       61  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
      167  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
  app/api/projects/[id]/onboarding-packages/route.ts
       68  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
  app/api/projects/[id]/onboarding-partners/route.ts
       62  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
  app/api/projects/[id]/onboarding/deploy/route.ts
       81  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
  app/api/projects/route.ts
      151  REPOINTED  profiles!partnerships_partner_id_fkey  ...not at profiles
      415  REPOINTED  profiles!projects_agency_id_fkey       ...not at profiles

Summary
  REPOINTED     13
  PERSON         0
  TOTAL         13  in 10 files
```

Thirteen, at exactly the ten files and thirteen lines the previous report listed by hand. The
two `project_messages_sender_id_fkey` embeds are correctly absent.

**After the fix**, on the working tree: `REPOINTED 0, PERSON 0, TOTAL 0`, and
`--guard` exits 0.

**What it cannot do, so nobody mistakes green for safe.** It is a lexical check over source text.
It does not read `pg_constraint`, so it cannot tell you a constraint name is misspelled, that a
column has gained a second foreign key, or that a hint resolves ambiguously. It cannot see a
selector built by string concatenation at run time. Both limits are written into the file's
header, along with the two things a human must still inspect:

1. **Every `.select()` embedding `organizations`: does the caller pass the organizations SELECT
   policy for the row being embedded?** A filtered row returns null, not an error. **This check
   going green proves the query is well formed and proves nothing about whether it returns
   data.** That is Item 1, and no script in this repository can answer it.
2. Every embed with no hint at all. Those resolve by whatever single foreign key exists; add a
   second and the query starts erroring.

---

## ITEM 6: THE BRANCH, RE-PROVED

**`node scripts/check-identity-columns.mjs --guard`, exit 0:**

```
Legacy company identity columns in application source
Roots: app, lib, components, contexts, hooks, middleware.ts
Scanned 365 files.

Summary
  org_id                 0
  lead_org_id            0
  vendor_org_id          0
  needs-human-read       0
  TOTAL                  0  in 0 files

GUARD PASSED. No legacy company identity column names in application source.
```

**`node scripts/check-embed-targets.mjs --guard`, exit 0:**

```
PostgREST embeds traversing foreign keys that 079 repoints
Roots: app, lib, components, contexts, hooks, middleware.ts
Repointed (table, column) pairs parsed from 079 PHASE 7: 30
Scanned 365 files.

Summary
  REPOINTED      0
  PERSON         0
  TOTAL          0  in 0 files

EMBED GUARD PASSED. No embed traverses a foreign key 079 repoints.
```

**`npx tsc --noEmit`, exit 0. `pnpm build`, exit 0.**

**AND A GREEN BUILD PROVES NOTHING ABOUT THIS BRANCH.** The Supabase clients are constructed
without generated `Database` types, so `.select("vendor_org:organizations!vendor_org_id(...)")`
is an untyped string and `row.vendor_org` is a property on an untyped record. A green build is
compatible with every one of the thirteen queries being wrong. It proves the TypeScript around
them parses. That is all it has ever proved here, and it is why both guards exist.

Nor does a green **embed guard** prove more than that no embed names a repointed foreign key.
Item 1 is the thing that decides whether these render, and it is unresolved.

### 6.1 The open list

**Touched by this run:**

| Item | State |
|---|---|
| The thirteen embeds | Rewritten, consumers traced, guarded |
| `organizations.primary_contact_user_id` | In 079, backfilled, verified by query, mirrored in the down file |
| The null-contact fallback | One rule, `lib/org-contact.ts`, all thirteen |
| The guard's blind spot | `scripts/check-embed-targets.mjs`, proved both ways |
| Two in-class non-embed sites | Fixed, Item 3.7 |

**Untouched, and still Greg's:**

| # | Ambiguity | State |
|---:|---|---|
| 1 | **The `organizations` SELECT policy.** Item 1. **This is the release blocker.** | New this run. Nothing written |
| 2 | **Site 13's access-request read.** Item 1.4 decision 2 | New this run. Three options ranked |
| 3 | **Notifications addressed to organization ids.** `createNotification({ userId })` is being handed `vendor_org_id` / `lead_org_id` at `app/api/projects/[id]/onboarding/deploy/route.ts:153`, `app/api/partnerships/route.ts:937` and `:986`, `lib/magic-token-attach.ts:399`, `lib/award-partnership-resolution.ts:93` and `:150`. `notifications.user_id` is a user id. These write notifications nobody can read | New this run. Marked `079-AMBIGUOUS` at the deploy site. Not fixed anywhere: it is the same "who on a team receives this" ruling `resolveOrgNotificationRecipients()` answers for email, and guessing it at one site would make the six inconsistent |
| 4 | Entitlement under 079 - `hasAgencyEntitlement()` still reads `profiles.is_paid` | Unchanged. 079 creates no entitlement column |
| 5 | `orgRoleFor()` returns `"owner"`; `loadOrgRole()` written and unused | Unchanged |
| 6 | `partner/partnerships/claim` collision | Unchanged |
| 7 | Per-member versus per-organization domains in `resolveAgencyOwnDomains` | Unchanged |
| 8 | The 082 function recreate after 079 | Unchanged. Still a required release step |
| 9 | Bucket (U): the three email-matching policies 079 leaves intact | Unchanged |

Items 4 to 9 are carried forward from `docs/079-rename-execution-report.md` unmodified. Items 1,
2 and 3 are new findings from this run.

---

## HONEST VERIFICATION

**Executed from this terminal, results observed:**

- `node scripts/check-identity-columns.mjs --guard` - exit 0, output above.
- `node scripts/check-embed-targets.mjs --guard` - exit 0, output above.
- `node scripts/check-embed-targets.mjs --root <worktree at HEAD>` - 13 findings, output above.
- `npx tsc --noEmit` - exit 0.
- `pnpm build` - exit 0.
- Five read-only `GET` requests to the live PostgREST endpoint: Items 4.1 to 4.4, plus the
  `is_discoverable` and `partner_access_requests` counts in Item 1.6. **No write of any kind. No
  migration applied. No `POST`, `PATCH` or `DELETE` issued.**
- Every consumer listed in the Item 3.2 table was opened and read.

**NOT executed. Claims that rest on reading:**

- **The entire Item 1 matrix.** 079 is unapplied, `organizations` does not exist, and no query
  can be run against the post-079 policy set.
- **That an RLS-filtered to-one embed returns null rather than erroring.** Item 1.6 explains why
  I could not execute it and what I did execute instead. This is the load-bearing claim of the
  headline and it is inferred.
- **That the rewritten thirteen return correct data after 079.** Nothing on this branch has been
  run against a database. No route was exercised, no page loaded, no email sent. Every
  behavioural claim here is about code that has been read and compiled.
- **That the migration parses.** `079_organizations.sql` has never been submitted to a Postgres
  server, including the lines added by this run.
- Storage policies remain unknown, per runbook step 0.

**The one sentence to take away:** the shape is right, the guard can now see this class, and
whether any of it renders depends on a policy decision that has not been made.
