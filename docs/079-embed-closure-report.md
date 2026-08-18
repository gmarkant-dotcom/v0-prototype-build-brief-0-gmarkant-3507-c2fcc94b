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

---
---

# SECOND PASS: Greg's four rulings, and the pool

Appended 2026-08-17. Branch `feat/079-org-rename`. **Nothing pushed, nothing merged, no
migration applied, no write query run.** Three commits, one per ruled item.

---

## ITEM 2 FIRST, BECAUSE EVERYTHING ELSE ASSUMES IT

### The claim is STILL NOT EXECUTED. It is no longer un-executable for lack of a case.

The load-bearing claim is that a PostgREST to-one embed whose target row is filtered by row
level security returns `null` at HTTP 200 rather than erroring. The previous run inferred
it. **I did not execute it either.** What changed is the reason, and the reason matters:

**The previous run reported that no such case could be constructed. That was wrong, and it
was wrong because it looked for the case in the wrong place.** It searched for an
anon-readable table with an embeddable foreign key, found only `partner_vouches`, and
stopped. A case exists, it is in the live database right now, and it is specified exactly
below. What blocks it is credentials, not the schema.

### The case, exactly

Executed read-only with the service-role key to establish the facts:

| Fact | Value | How |
|---|---|---|
| `partner_rfp_inbox` rows where `partner_id = e04e86e8` (`gmarkant+partner71@gmail.com`) | 4 | `GET /partner_rfp_inbox?partner_id=eq.…` |
| `project_id` on three of them | `e533075f` "Q3 Flagship Product Launch" | same |
| `project_id` on the fourth | `5473ceeb` "Evergreen Content" | same |
| Project assignments for that user | exactly one, on `5473ceeb` | `GET /project_assignments?select=…partnerships!…(partner_id)` |

That user can read all four inbox rows (`partner_rfp_inbox` policy "Partners select inbox
rows by partner_id", `partner_id = auth.uid()`). That user can read project `5473ceeb`
(`projects_partner_select_assigned`). That user **cannot** read project `e533075f` - no
assignment, and they are not the agency.

So this single query returns the filtered case and its own control in one response:

```
GET /rest/v1/partner_rfp_inbox
    ?select=id,project_id,project:projects!project_id(id,name)
    &partner_id=eq.e04e86e8-27dc-4235-980e-3703e08175ce
    &order=id
```

Three rows carry a **non-null** `project_id` pointing at a row the caller may not read. One
carries a non-null `project_id` pointing at a row the caller may read. If the three come
back `"project": null` at HTTP 200 while the fourth resolves, the claim holds. If the
request 400s, it does not.

**This is a better test than anything the post-079 schema could offer**, because it needs no
migration: it uses today's policies, today's data, and a non-null foreign key, which is the
one property the already-executed null-foreign-key case could not supply.

### Why it was not run

Issuing it requires being a real authenticated user. Every credential that would allow that
is **present in the environment file and empty**:

| Variable | State |
|---|---|
| `SUPABASE_JWT_SECRET` | present, empty - cannot mint a JWT |
| `POSTGRES_URL` | present, empty |
| `POSTGRES_URL_NON_POOLING` | present, empty |
| `POSTGRES_PASSWORD` | present, empty |

Checked by parsing `.env.production.local` directly, because `vercel env pull` does not
export secret values. The remaining routes were considered and rejected: a password grant
needs a password nobody has; `admin/generate_link` is a `POST` that mutates auth state and
may send mail, which the standing doctrine forbids; and applying 079 inside a transaction to
roll it back is a write and an explicit "do not".

**The anon route is genuinely dead, and this run executed the proof rather than reasoning to
it.** `partner_vouches` is the only table an anon caller gets rows from (`USING (true)`);
migration 053 declares both its foreign keys against `auth.users`, which PostgREST does not
expose. Both hint forms were issued and both returned `PGRST200`:

```
GET /partner_vouches?select=id,v:profiles!voucher_agency_id(id,email)   -> HTTP 400 PGRST200
GET /partner_vouches?select=id,profiles(id,email)                       -> HTTP 400 PGRST200
   "Searched for a foreign key relationship between 'partner_vouches' and 'profiles' …
    but no matches were found."
```

One near miss worth recording, because it looked like the answer for a while:
`profiles.linked_agency_id` is a **self-foreign-key on `profiles`**, which the previous run
missed (it guessed the column was called `invited_by` and got `PGRST200`). A discoverable
profile linking to a non-discoverable one would have made the test runnable by a caller with
no relationship to anybody. **All sixteen rows carry `linked_agency_id = null`**, so the
foreign key exists and the data does not.

### What this means for the release, stated plainly

**The failure mode is still unconfirmed, and the two possibilities carry different risk.**

- If it nulls: the thirteen render blank, silently, at HTTP 200. That is the assumption the
  whole matrix and all of `lib/org-contact.ts` are built on.
- If it errors: the thirteen throw a visible 400. **That is better news**, because two of the
  thirteen sit inside `try`/fallback wrappers that would convert it back into missing fields
  anyway, but the other eleven would fail loudly in staging instead of quietly in production.

The code is correct either way, because it handles null. `lib/org-contact.ts` has been
corrected to say the RLS half is an assumption rather than a measured fact - it previously
read as though both halves had been proved.

**Anyone with a browser session can settle this in thirty seconds.** Log in as
`gmarkant+partner71@gmail.com`, open devtools, and run the `GET` above against
`/rest/v1/`. Paste the status code.

---

## ITEM 1: THE COUNTERPARTY ORGANIZATION POLICY

Commit `a644a2f`.

### What was written

`current_user_counterparty_org_ids()`, lifted out of the `counterparty_orgs` CTE that lived
inside `current_user_visible_profile_ids()`. Same hardening as the other four helpers:
`STABLE`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`, no parameters, `REVOKE
EXECUTE FROM PUBLIC`, `GRANT EXECUTE TO authenticated`.

**Reuse, not a second definition.** `current_user_visible_profile_ids()` now calls it:

```sql
SELECT m.user_id FROM public.org_members m
WHERE m.org_id IN (SELECT public.current_user_org_ids())
   OR m.org_id IN (SELECT public.current_user_counterparty_org_ids());
```

and PHASE 11 gains:

```sql
CREATE POLICY "Members read counterparty organizations"
  ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_counterparty_org_ids()));
```

Organization visibility and profile visibility are now **one predicate by construction**.
They cannot drift, because there is nothing to drift from.

Mirrored in `079_organizations_down.sql`: the policy is dropped by name alongside the other
five, and the function is dropped **before** `current_user_visible_profile_ids()`, since
Postgres does not build a dependency graph for a SQL-bodied function body and would let you
drop the callee first without complaint.

Counts corrected across the file: five helpers not four, six policies on the new tables not
five, `organizations` at 3 not 2, total 108 not 107.

### What qualifies as a counterparty, and why only that

An organization `O` is a counterparty of caller `U` iff a `partnerships` row exists with
`lead_org_id ∈ U's orgs AND vendor_org_id = O`, or `vendor_org_id ∈ U's orgs AND lead_org_id
= O`. **At any status**, including `pending` and `removed`, mirroring
`current_user_visible_profile_ids()` exactly.

**Partnerships and nothing else.** A partnerships row is the only artifact in this schema
recording a *two-sided* commercial relationship: the lead agency creates it, the vendor
claims it. Every other org-to-org link is unilateral - `partner_access_requests` is one
company asking, `invitation_requests` is one company asking, `partner_rfp_inbox` is one
company sending. Admitting any of them would let one side manufacture visibility of the
other by writing a row it already controls.

Any status is deliberate: a `pending` partnership is an agency waiting on a vendor, and the
vendor's company name has to render on the card that is waiting. A `removed` one still has
historical projects and invoices naming the company.
`current_user_active_counterparty_user_ids()` remains the stricter, active-only set, and it
is still what the contact-information tier and the notifications policy use.

### The security matrix

`organizations` has seven columns and no others: `id`, `name`, `primary_contact_user_id`,
`is_lead_agency`, `is_vendor`, `created_at`, `updated_at`. RLS is row-level, so the policy
exposes all seven for a counterparty row.

| Caller relationship to `O` | `organizations` row | `O`'s members' profiles | Net |
|---|---|---|---|
| Member of `O` | readable, own-orgs policy | readable, `my_orgs` half | unchanged by this commit |
| Partnership with `O`, any status | **readable, new policy** | **readable**, counterparty half of the same helper | **the fix** |
| Pending `partner_access_requests` only | **NOT readable** | not readable unless discoverable | Item 5 |
| No relationship | **NOT readable** | not readable unless discoverable | unchanged |
| Anon | not readable (`TO authenticated`, and `EXECUTE` revoked from `PUBLIC`) | unchanged | unchanged |

**Does it expose anything the tiers withhold?** No. `primary_contact_user_id` is an id, not
contact details; reading the person behind it still has to pass the `profiles` policies
separately. And it does pass - which is the second thing Greg asked to be checked
explicitly.

**The nested hop is separately permitted for the same callers, and by construction rather
than by coincidence.** Hop 1 is `id IN counterparty_org_ids`. Hop 2 is
`current_user_visible_profile_ids()`, which returns the members of `my_orgs ∪
counterparty_org_ids` - the same set, from the same function. Any organization whose row
resolves therefore has its members' profiles readable. **The outer hop cannot resolve while
the inner one nulls.** Verification steps 8b and 8c were added to the migration to check
both hops as a real logged-in user rather than trusting this paragraph.

**Enumeration.** The predicate takes no argument. A caller cannot ask about an id it
supplies; the set is derived entirely from `auth.uid()` inside a `SECURITY DEFINER` body.

### The one residual, and it is real

**"Agencies can create partnerships" constrains `lead_org_id` and says nothing about
`vendor_org_id`.** So a lead agency can insert a partnership naming any `vendor_org_id` it
can guess, and thereby add that organization to its own counterparty set.

Three things are true about this, and all three matter:

1. **It is not introduced here.** The identical hole is live today: "Users can view profiles
   of partnership members" grants a whole profiles row on the same trick, and "Agencies can
   create partnerships" today has `WITH CHECK (agency_id = auth.uid())` with no constraint
   on `partner_id`.
2. **It yields strictly less here than it already yields on profiles.** A company name and
   two booleans, versus an entire profile row including email.
3. **It needs a guessable id.** Under the backfill an organization id equals its founding
   user's id, and user ids leak through discoverable profiles - so for the two discoverable
   accounts, the id is known. For organizations created after 079 it is a `gen_random_uuid()`
   nobody can guess.

**Not closed here, because closing it is a product decision, not a policy tidy-up.** The fix
is to constrain `vendor_org_id` on insert - most cleanly, force it NULL and make the vendor
claim it - and that would break the flow where an agency adds a known vendor from its pool.
Greg's call. Written into the migration at the policy site as well as here.

### A second residual, smaller and worth naming

**Nothing constrains `primary_contact_user_id` to be a member of its own organization.**
Under the backfill it always is. It stops being true the moment a member is removed without
their contact designation being cleared - `ON DELETE SET NULL` fires on profile deletion,
not on membership removal. At that point hop 1 resolves and hop 2 nulls, which is exactly
the "moves the blank one level down" failure Greg warned about. A composite foreign key to
`org_members(org_id, user_id)` cannot express it (`ON DELETE SET NULL` would try to null the
primary key too), so this needs a trigger or an application rule, and it belongs with the
membership feature.

---

## ITEM 3: THE PAYLOAD KEYS

Commit `4593c02`. Separate commit, revertable independently.

### The shape

`LegacyPartnerShape`/`legacyPartnerShape` become `OrgWireShape`/`orgWireShape`. Wire keys
`partner` and `agency` become **`vendor_org`** and **`lead_org`**, matching the foreign keys
that reach them.

| Old | New | Source |
|---|---|---|
| `partner` / `agency` | `vendor_org` / `lead_org` | `vendor_org_id` / `lead_org_id` |
| `.id` | `.id` | `organizations.id` |
| `.company_name` | `.name` | `organizations.name` |
| `.email` | `.contact_email` | the primary contact's `profiles.email`, or the row's pre-claim address |
| `.full_name` | `.contact_name` | the primary contact's `profiles.full_name` |
| - | `.contact_user_id` | `organizations.primary_contact_user_id` |
| `.capabilities` | `.contact_capabilities` | the contact's `profiles.capabilities` |
| `.company_logo_url` | `.contact_logo_url` | the contact's `profiles.company_logo_url` |
| `.created_at` | `.contact_created_at` | the contact's `profiles.created_at` |

**The `contact_` prefix is the point, not decoration.** Calling the contact's address
`email` on an object keyed `vendor_org` reintroduces the same lie one level down: it reads
as the company's address. And the rich trio is where this shape admits a real loss of
fidelity - `capabilities`, `company_logo_url` and `created_at` have no organization-level
column, so all three still describe the *person*. `contact_created_at` is when that person
signed up, **not** when the company was created. The names now say so at every read site
instead of in a comment nobody opens.

**A flat shape, not the raw nested embed.** Emitting
`vendor_org.primary_contact.email` verbatim would have been truer to the query but strictly
worse: `contact_email` falls back to the row's own pre-claim address
(`partnerships.partner_email`, `partner_rfp_inbox.recipient_email`), which is not part of the
organization at all. The raw shape cannot express that, so every consumer would have had to
reimplement the fallback. One resolver, one rule.

### The consumer count, verified rather than trusted

**The previous run said eight frontend files. The real number is eleven, and the eight were
wrong in both directions.**

| | File | Previous run | Reality |
|---|---|---|---|
| 1 | `app/agency/page.tsx` | listed | consumer, 4 reads |
| 2 | `app/agency/pool/page.tsx` | listed | consumer, 4 reads |
| 3 | `app/agency/msa/page.tsx` | listed | **declares the key, never reads it** - only `id` and `status` are used |
| 4 | `app/partner/network/page.tsx` | listed | consumer, 13 reads, mixed with a same-named shape from another route |
| 5 | `app/partner/payments/page.tsx` | listed | consumer, 3 reads incl. demo data |
| 6 | `contexts/lead-agency-filter-context.tsx` | listed | consumer, 4 reads |
| 7 | `components/marketplace-content.tsx` | listed | consumer, 1 read |
| - | `app/partner/page.tsx` | **listed, and NOT a consumer** | reads only `id` and `status` |
| 8 | `app/agency/project/page.tsx` | **missed** | consumer, 2 reads |
| 9 | `app/partner/onboarding/page.tsx` | **missed** | consumer, 3 reads |
| 10 | `components/stage-03-onboarding-production.tsx` | **missed** | consumer, 3 reads |
| 11 | `components/stage-03-onboarding-workflow.tsx` | **missed** | consumer, 7 reads |

Seven of eight correct, one file listed that is not a consumer, four consumers missed. **The
four missed are exactly the failure mode Greg named**: each would have rendered `undefined`
where a vendor name goes, and no compiler would have said a word.

Seven producer routes changed: `partnerships`, `projects`, `projects/[id]/assignments`,
`projects/[id]/onboarding-packages`, `projects/[id]/onboarding-partners`,
`agency/active-engagements`, `partner/onboarding-packages`.

### Three things deliberately NOT renamed, with reasons

1. **`partner_display_name`.** It is a real column on `partner_rfp_responses`, not an
   invented payload key - selected by name in six routes and read in fourteen files.
   Renaming the wire key would desynchronize it from the column it mirrors. 079 does not
   rename the column and neither does this.
2. **`app/api/agency/pool/[partnerId]` and `app/api/partner/network/[agencyId]`.** Both emit
   a `partner`/`agency` object, but both genuinely read a `profiles` row - bio, location,
   website, avatar, rate info. Those key names do not lie about their source. They lie about
   whether the id is a user id, which is a different bug, below.
3. **`agency_company_name` / `agency_full_name` / `agency_meeting_url`** in the dashboard and
   RFP routes. Scalar keys outside Greg's ruling, and they belong to the same profiles-by-org-id
   class below.

### The verification sweep

After the rename, across `app`, `lib`, `components`, `contexts`, `hooks`:

```
grep -rE "\.(partner|agency)(\?)?\.(company_name|full_name|companyName|fullName)"   -> 0 hits
grep -r  "legacyPartnerShape\|LegacyPartnerShape"                                   -> 0 hits
```

---

## THE PROFILES-BY-ORG-ID CLASS: SIX MORE SITES, AND NEITHER GUARD SEES THEM

**New finding this run, and the most important thing in this section.** Both guards report
zero. Both are correct, and both are blind to this:

```ts
.from("profiles").select("id, company_name, full_name").in("id", <organization ids>)
```

The identity guard misses it because the column name is already the post-079 one. The embed
guard misses it because there is no `table!hint(` embed - it is a separate query. It is the
same "JOIN profiles ON profiles.id = an org id" trap 079's own table comment warns about, and
it works perfectly for every backfilled organization and returns **nothing** for every
organization created after 079.

| # | Site | Resolves | Emits | Status |
|---:|---|---|---|---|
| 1 | `app/api/partner/onboarding-packages/route.ts:72` | `onboarding_packages.org_id` | `agency` object | **FIXED** - repointed onto `organizations` and renamed to `lead_org`, because it feeds a key Item 3 renames |
| 2 | `app/api/agency/dashboard/route.ts:173` | `partnerships` partner ids | `name` scalar | reported |
| 3 | `app/api/partner/dashboard/route.ts:147` | lead org ids | `name` scalar | reported |
| 4 | `app/api/partner/rfps/bids/route.ts:166` | lead org ids | `agency_company_name` | reported |
| 5 | `app/api/partner/rfps/route.ts:166` | lead org ids | `agency_meeting_url` | reported - **`meeting_url` has no organizations equivalent at all** |
| 6 | `app/api/projects/[id]/partner/route.ts:89` | `projects.org_id` | `agency` object | reported - **no caller found anywhere**, a dead route |

Two more of the same class were already fixed by the previous run (its Item 3.7), so the
class now stands at **nine sites, three fixed, six open**.

Sites 2 to 6 are **not fixed here** because they are outside the four ruled items and fixing
them is not mechanical: `meeting_url` and `location` are profiles columns with no
organization-level equivalent, so repointing them is a product question about what an
organization profile even contains. **They will silently blank after 079 for every
organization created post-migration.** They should be a fifth item.

**A related loss already in flight:** `p.agency?.location` in
`contexts/lead-agency-filter-context.tsx` has been `undefined` since the previous run
rewrote the embeds onto `organizations`, because `organizations` has no `location`. This run
made it an explicit `''` with a comment rather than leaving it reading a field that cannot
exist.

---

## ITEM 4: THE NOTIFICATION RECIPIENTS

Commit `f6efe54`.

### Is `notifications` org-scoped or user-scoped?

**User-scoped, and it always has been.** From the authoritative snapshot:

| Policy | cmd | Predicate |
|---|---|---|
| Users can view own notifications | SELECT | `user_id = auth.uid()` |
| Users can update own notifications | UPDATE | `user_id = auth.uid()` |
| Scoped insert notifications | INSERT | `user_id = auth.uid() OR` an **active** partnership either way |

079 PHASE 10 preserves the shape exactly, replacing the partnership subqueries with
`current_user_active_counterparty_user_ids()`. **There is no org-scoped read path and 079
does not add one.** That settles what the fix can address: the organization has to be
resolved to users at write time. It cannot be stored as one.

### The ruling

**Every member of the organization. One rule, all sixteen call sites.**

Chosen over the primary contact because `notifications` is an in-app inbox, not outbound
correspondence. Addressing it to one designated person means the colleague who actually does
the work never learns the RFP arrived, while every 079 policy grants access to the
underlying data by *membership* - the notification about that data has to follow membership
or the two disagree. The primary contact exists so a company is not emailed N times; an
in-app row has no such cost.

Decisively: **`resolveOrgNotificationRecipients()` in `lib/email.ts` already fans out over
`org_members` for the email channel.** Two different answers to "who is the company" across
two channels would be the same class of bug this migration exists to close.

### Is it live today?

**No. Not one of the sixteen is broken today, and the reason is the coincidence 079's own
table comment warns against relying on.** Every organization the migration backfills carries
its founding user's id, so an organization id and a user id are the same value for all
sixteen live accounts. Passing `lead_org_id` into `notifications.user_id` therefore hits a
real user.

It becomes a bug the moment **both** things are true: 079 is applied, **and** an
organization is created afterwards. PHASE 12 mints `gen_random_uuid()` for those - a
notification addressed to nobody, unreadable, with no error anywhere.

**No site passes something that is already not a user id.** I checked all sixteen. The
nearest thing to a current bug is at `app/api/partnerships/route.ts:642`, which passed
`partner.id` from a `profiles` lookup - a genuine user id, but only because the lookup key
happened to resolve; it is reported below as a write-path bug.

### Six named, sixteen found

| # | Site | Passed |
|---:|---|---|
| 1 | `projects/[id]/onboarding/deploy:170` | `vendor_org_id` (Greg's list) |
| 2 | `partnerships:940` accepted | `lead_org_id` (Greg's list) |
| 3 | `partnerships:989` declined | `lead_org_id` (Greg's list) |
| 4 | `lib/magic-token-attach:401` | vendor org id (Greg's list) |
| 5 | `lib/award-partnership-resolution:93` | `agencyId` (Greg's list) |
| 6 | `lib/award-partnership-resolution:150` | `agencyId` (Greg's list) |
| 7 | `projects/[id]/onboarding-packages:400` | `vendor_org_id` |
| 8 | `projects/[id]/assignments:200` | `vendor_org_id` |
| 9 | `projects/[id]/assignments:333` | `lead_org_id` |
| 10 | `projects/[id]/assignments:429` | `vendor_org_id` |
| 11 | `agency/rfp-responses/[id]:663` | `vendor_org_id` |
| 12 | `partner/rfps/[id]/response:419` | `lead_org_id` |
| 13 | `rfp/guest/[token]:583` | `tokenRow.org_id` |
| 14 | `rfp/guest/[token]:766` | `tokenRow.org_id` |
| 15 | `partnerships:538` re-invitation | `existing.vendor_org_id` |
| 16 | `partnerships:642` invitation | `partner.id`, written into `vendor_org_id` |

### What was written

`resolveOrgMemberUserIds()` and `createOrgNotification()` in `lib/notifications.ts`, and all
eight `notify*` helpers converted to take an organization id - the parameter names say so
now (`vendorOrgId`, `leadOrgId`). `createNotification()` survives as the user-scoped
primitive and **has no callers left anywhere in the repository**.

**Safe to ship before the migration.** With `org_members` absent the resolver falls back to
addressing the organization id directly, which is byte-for-byte today's behaviour. That path
is logged at `info` and named as expected-pre-079, separately from the `warn` for a real
empty-membership case, so it does not fill production logs with false alarms between now and
the migration.

`notifyNewMessage` and `notifyDocumentUploaded` have **no call sites anywhere** (verified by
grep). Converted anyway, so wiring one up later cannot reintroduce the bug.

### Two things found and NOT fixed

1. **The INSERT policy requires an ACTIVE counterparty.** `current_user_active_counterparty_user_ids()`
   is the active-only set, so an **invitation** (partnership `pending`) and a **decline**
   (`terminated`) are refused by RLS for every recipient on the session client - sites 2, 3,
   15 and 16. **This is pre-existing**: today's live policy carries the same
   `status = 'active'` condition, so those notifications are already being silently rejected
   in production. Fixing it means editing the notifications INSERT policy. Greg's call. The
   service-role sites (13, 14) bypass RLS and are unaffected.
2. **`app/api/partnerships/route.ts` writes a `profiles` id into `partnerships.vendor_org_id`**
   on the invite path (`insertData.vendor_org_id = partner.id`, where `partner` is a profiles
   row). After 079 that column is an organization id. That is the invite/claim write path,
   not the notification, and it is a bigger fix than this item.

---

## ITEM 5: THE POOL SITE. THREE OPTIONS, ONE RECOMMENDATION, NOT IMPLEMENTED

`app/agency/pool/page.tsx` `loadAccessRequests`. **The counterparty policy in Item 1 does not
help it, by design.** A `partner_access_requests` row is a vendor asking to *join* an
agency's pool; no partnership exists, so the vendor's organization is not a counterparty, so
neither hop resolves. Measured read-only: **14 of 16 profiles carry `is_discoverable =
false`**, and `partner_access_requests` has **no email column** (`agency_id, created_at, id,
partner_id, request_message, reviewed_at, status, updated_at`), so there is no row-level
address to fall back to. The card renders `Unnamed vendor` and nothing else.

Live blast radius today: **one row, `approved`, and its vendor is one of the two discoverable
accounts.** Zero rows are currently affected, which is exactly why this would have shipped
unnoticed.

| Option | What it costs |
|---|---|
| **1. A third `organizations` SELECT policy: name only, for an organization with a *pending* request addressed to one of the caller's organizations.** | One more policy on `organizations`, and a second definition of "who may I see" that is not the partnership rule - the exact drift Item 1 just removed. RLS cannot restrict columns, so "name only" is aspirational: the policy exposes the whole row, which here means the name, two booleans and a contact user id. Needs a new helper to stay consistent with Item 1's approach. |
| **2. Snapshot the requester on the row: add `requested_by_user_id` to `partner_access_requests` and embed that instead.** | A migration - the column does not exist today, confirmed against the live table. Touches no policy at all: the requester is a member of a counterparty-or-not organization, but the *profiles* read still needs a tier that permits it, so on its own it can still null. Truthful about what the row actually is: one person asked. |
| **3. Leave it.** | Pending-request cards read `Unnamed vendor` for the fourteen non-discoverable accounts. Zero live rows today; the first real pending request from a non-discoverable vendor is an unusable card. |

### Recommendation: **Option 3 for the release, Option 2 as the follow-up.**

Option 1 is the one to avoid, and it is the one that looks most like a fix. It re-creates
precisely the divergence Item 1 was ruled to eliminate: a second, differently-shaped answer
to "which organizations may I read", built on a **unilateral** row that one party writes
alone. That is the property that disqualified `partner_access_requests` from the counterparty
definition in the first place, and admitting it through a side door would mean a vendor could
make itself visible to any agency by requesting access.

Option 3 for the release because the live blast radius is **zero rows**, the failure is a
degraded card rather than a broken page, and it blocks nothing. Option 2 as the follow-up
because it fixes the right thing: the row records that a *person* asked, and storing who
asked is honest and needs no visibility rule to be widened. It should ship with the
membership feature, where the profiles tier for "a person who has contacted you but is not
yet a counterparty" gets decided once for this surface and for invitations together.

**Not implemented. This is Greg's ruling.**

---

## GUARDS AND BUILD

Run before each of the three commits. Every one of these was executed from this terminal and
the exit code observed:

| Check | Item 1 | Item 3 | Item 4 |
|---|---|---|---|
| `node scripts/check-identity-columns.mjs --guard` | 0 | 0 | 0 |
| `node scripts/check-embed-targets.mjs --guard` | 0 | 0 | 0 |
| `npx tsc --noEmit` | 0 | 0 | 0 |
| `pnpm build` | 0 | 0 | 0 |

**AND A GREEN BUILD STILL PROVES ONLY SYNTAX.** The Supabase clients are constructed without
generated `Database` types, so every `.select()` argument is an untyped string and every
`row.vendor_org` is a property on an untyped record. For Item 3 specifically this is worth
being blunt about: **TypeScript checked none of the eleven consumer files against the actual
payload.** Every one was verified by reading the producer and the consumer and matching them
by hand, then by a repository-wide grep for surviving reads of the old names. That is the
strongest evidence available without a running database, and it is not proof.

The embed guard going green likewise proves only that no embed names a repointed foreign
key. It cannot tell you whether a query returns data.

---

## HONEST VERIFICATION

**Executed from this terminal, results observed:**

- The three guard/typecheck/build sets above, twelve commands, all exit 0.
- Read-only `GET` requests to the live PostgREST endpoint, service-role key: the full
  foreign-key map from the OpenAPI spec; `profiles` discoverability and `linked_agency_id`;
  `partnerships` by status; all `partner_rfp_inbox` rows; `project_assignments` with their
  partnership vendor; all `projects`; `partner_access_requests` columns and rows;
  `onboarding_package_documents`.
- Read-only `GET` requests with the **anon** key: `partner_vouches` plain, and two embed
  attempts, both `HTTP 400 PGRST200`. Quoted verbatim in Item 2.
- **No write of any kind. No migration applied. No `POST`, `PATCH` or `DELETE` issued to
  PostgREST. No notification inserted. No email sent. Nothing pushed, nothing merged.**
- Every one of the eleven consumer files and seven producer routes in Item 3 was opened and
  read before and after editing.
- `.env.production.local` parsed to establish which credentials exist; four are present and
  empty.

**NOT executed. Claims that rest on reading:**

- **The Item 2 case itself.** Specified exactly, not run. This is the headline and it is
  still the weakest link.
- **Every claim about post-079 behaviour.** 079 is unapplied. `organizations`,
  `org_members`, `current_user_counterparty_org_ids()` and the counterparty policy do not
  exist in any database. The security matrix is a reading of policy text.
- **That the migration parses.** `079_organizations.sql` has never been submitted to a
  Postgres server, including this run's additions. No `psql`, no Postgres driver, and
  `POSTGRES_URL` is empty.
- **That the renamed payloads render.** No route was exercised, no page loaded. Eleven
  consumer files were changed against a payload no compiler checks.
- **That the notification fan-out writes anything.** `createOrgNotification()` has never
  run. Its `org_members` query has never been issued against a database where that table
  exists.
- Storage policies remain unknown, per runbook step 0.

**The one sentence to take away:** the counterparty policy is written and reuses the one
definition of counterparty so the two hops cannot disagree, the payload keys no longer lie
and eleven consumers moved with them rather than the eight that were claimed, sixteen
notifications now address people instead of companies - and whether any of it renders still
depends on a single unexecuted query that anyone with a browser session can run in thirty
seconds.

---

# THIRD PASS: release readiness

Written 2026-08-17, from `feat/079-org-rename`. Nothing was pushed, merged or applied.
No migration was run. No write query of any kind was issued.

---

## READY OR NOT

# YES - with three preconditions, all of which are cheap.

This branch can be released tomorrow. The three things that must happen first, shortest
list, in order:

1. **Run runbook step 0 and get zero rows.** The storage policy check. If it returns
   anything, the release stops until those policies are rewritten, and nothing else in the
   release would have caught it.
2. **Re-capture `pg_policies` and regenerate the down migration from it** (runbook steps 1
   and 2). The committed down migration is authored from the Aug 13 capture. A rollback you
   have not regenerated is a rollback you do not have, and 079 is not reversible from the
   repository without one.
3. **Rebase onto `main` and get all five checks to exit 0** (runbook step 3): `tsc`,
   `pnpm build`, and the three guards.

Everything else on the risk list is either latent (does not affect the sixteen existing
accounts), degraded-but-legible (the pool card), or already decided.

**The honest qualifier, and it belongs in the same breath as the yes.** Two things are
true at once:

- **For the sixteen accounts that exist today, this release should be invisible.** Every
  organization holds exactly one member and carries its founding user's id, so membership
  resolves to the same person it always did.
- **For the first customer who signs up after it, twenty-five reads silently return
  nothing.** They are enumerated below. None of them errors, none of them logs, and no
  smoke test will show them. **They should be the first thing that ships after this branch,
  not a backlog item.**

The single largest unmitigated risk is not on this list because it is not fixable tonight:
**079 has never been parsed by a Postgres server, and there is no scratch database to parse
it on.** See `docs/079-preflight.md` question 1.

---

## ITEM 1: THE POOL SITE, AS IMPLEMENTED

Commit `1f63c04`. **Option 3, per Greg's ruling. The visibility rule is not touched.**

### The copy, quoted exactly

```
Vendor has not published a profile
```

Defined once, as `UNPUBLISHED_VENDOR_LABEL` in `lib/org-contact.ts`, and passed at the one
site that renders this fallback: `app/agency/pool/page.tsx` `loadAccessRequests`, which now
reads `orgDisplayName(contact, UNPUBLISHED_VENDOR_LABEL)`.

It replaces `'Unnamed vendor'`. **The point of the change is that the string says why.** A
bare "Unnamed vendor" reads as a bug and sends the next person who meets it hunting for
one; this card is going to be here in six weeks, because the fix is deliberately deferred,
so the copy has to be legible as expected behaviour rather than as breakage. It also
removes the incentive for somebody to "repair" it by widening a policy.

### Why the string is NOT the default of `orgDisplayName()`

The default fires for **any** null organization - a null foreign key, a deleted row, a
genuine RLS filter with a different cause. Only this surface knows the cause is an
unpublished profile. The other two call sites pass `"Vendor"`, which stays right for them.

### Why option 1 was rejected outright, restated so it is not re-proposed

A third `organizations` SELECT policy keyed on `partner_access_requests` is the option that
looks most like a fix and is the one to avoid. A `partner_access_requests` row is written
**unilaterally**: one party writes it alone. Building visibility on it means a vendor can
make itself visible to any agency simply by requesting access. That is precisely the
property that disqualified the table from the counterparty definition in the first place,
and admitting it through a side door would re-create the divergence the shared helper was
built to eliminate.

### Option 2, as the follow-up. NOT authored.

**Add `requested_by_user_id` to `partner_access_requests` and embed that instead.**

- The column does not exist today - confirmed against the live table, whose columns are
  `agency_id, created_at, id, partner_id, request_message, reviewed_at, status, updated_at`.
- It touches **no policy at all**. The row would record that a *person* asked, which is
  what actually happened.
- **It does not fully resolve on its own.** The requester is a member of an organization
  that is not a counterparty, so the *profiles* read still needs a visibility tier that
  permits it. That tier is the open question.
- **Therefore it ships with the membership feature**, where "a person who has contacted you
  but is not yet a counterparty" gets decided once, for this surface and for invitations
  together, rather than twice.

**No migration was authored for it, per the instruction.**

### Live blast radius today

**Zero rows.** `partner_access_requests` holds one row, status `approved`, whose vendor is
one of the two discoverable accounts. The first real pending request from a
non-discoverable vendor is the first time anybody sees this card.

---

## ITEM 2: THE BLIND CLASS. THREE FIXED, AND THE CLASS IS FOUR TIMES BIGGER THAN REPORTED.

### The headline correction

The previous run reported this class as **nine sites, three fixed, six open**. That census
was produced by hand and it was incomplete.

**Mechanically re-measured this run, with a purpose-built checker:**

```
$ node scripts/check-org-id-reads.mjs
  OPEN             25
  ALLOW-LISTED      1
```

**Twenty-eight sites in the class**: 3 fixed this run, 25 open, plus 2 verified-correct
reads that sit near organization code and are allow-listed with their reasons. The previous
run's six were a subset.

This did not change the release decision - every one of the 25 works correctly for all
sixteen existing accounts - but it changes what has to happen the week after.

---

### The three fixed, with before-and-after visibility

All three are session-scoped clients, so RLS applies to both the old and the new query.

#### FIX 1. `app/api/agency/dashboard/route.ts` - vendor display names

**The ids:** `partnerships.vendor_org_id` and `partner_rfp_inbox.vendor_org_id`, both
already scoped to the caller's own organizations upstream.

| | What the caller could see |
|---|---|
| **BEFORE, today (pre-079)** | The `profiles` row of every vendor the agency has a partnership with, via `"Agencies read profiles of their partners"`, plus any vendor whose profile is `is_discoverable` even with no partnership. Returns rows. |
| **BEFORE, post-079, unchanged code** | Identical for all sixteen backfilled accounts, because organization id equals user id. **Zero rows for any vendor organization created after 079.** No error. The activity feed reads "A vendor". |
| **AFTER, post-079, new code** | The `organizations` row of every vendor on the other side of a partnership with one of the caller's organizations, at any status, via `"Members read counterparty organizations"`. The nested `primary_contact` hop resolves through `current_user_visible_profile_ids()`, which returns members of the caller's organizations plus members of exactly that same counterparty set. |

**Does this widen anything? No. It NARROWS in one case, and that case is stated out loud.**

The partnership half of the predicate is identical before and after - both are "a
partnerships row exists in either direction, at any status". What is **lost** is the
discoverable half: `organizations` has no discoverable policy, so an inbox row naming a
vendor the agency has **no partnership with** used to yield that vendor's name if they were
discoverable, and now yields nothing.

**Consequence, precisely:** in the "viewed the RFP" activity line, such a vendor is
displayed as `row.recipient_email` instead of their company name - the fallback that was
already in the code. Two of the sixteen live accounts are discoverable, so the realistic
scope is small, and the degradation is an email address rather than a blank.

**Nothing becomes visible that was not visible before.**

#### FIX 2. `app/api/partner/dashboard/route.ts` - lead agency display names

**The ids:** `partner_rfp_inbox.lead_org_id` and `partnerships.lead_org_id`, scoped to the
calling vendor's own rows upstream.

| | What the caller could see |
|---|---|
| **BEFORE, today** | The `profiles` row of every lead agency the vendor has a partnership with, via `"Partners read lead agency profiles for their partnerships"`, plus discoverable agencies. |
| **BEFORE, post-079, unchanged code** | Identical for the sixteen; **nothing** for any lead agency organization created after 079. Every label falls to the literal `"Lead agency"`. |
| **AFTER** | The `organizations` row of every lead agency on the other side of a partnership with one of the vendor's organizations, at any status. Same predicate, same helper. |

**Widening: none.** Same narrowing as FIX 1 for an inbox row with no partnership behind it,
and the same pre-existing fallback (`"Lead agency"`) catches it.

#### FIX 3. `app/api/partner/rfps/bids/route.ts` - the agency name on a bid card

**The ids:** `partner_rfp_responses.lead_org_id`, on rows already filtered by
`.in("vendor_org_id", callerOrgIds)`.

| | What the caller could see |
|---|---|
| **BEFORE, today** | `company_name` and `full_name` from the lead agency's `profiles` row. |
| **BEFORE, post-079, unchanged code** | Identical for the sixteen; **null for both fields** for any lead agency organization created after 079. Every bid card in the vendor portal loses the agency name, with no error. |
| **AFTER** | `agency_company_name` comes from `organizations.name`. `agency_full_name` comes from the organization's **designated primary contact**, through the same nested hop. |

**Widening: none.** `agency_full_name` is now explicitly a **person's** name - the primary
contact's - because there is no organization-level full name and inventing one would be a
lie. The consumer, `app/partner/rfps/page.tsx:185`, reads
`bid.agency_company_name || bid.agency_full_name || "Agency"`, so the precedence is
unchanged.

---

### The two written up rather than fixed

Greg's brief described these as "the two involving `meeting_url` and `location`". **Only
one of the five open sites involves `meeting_url`. None of them involves `location`** -
`location` is a real loss but it lives somewhere else. Both are set out honestly below.

#### A. `meeting_url` - `app/api/partner/rfps/route.ts:166`

**What the field actually belongs to: A PERSON.**

`profiles.meeting_url` was added by migration 020 as a per-user scheduling link - a Calendly
or equivalent. It is not a company property. A company does not have one calendar; the
person you are booking with does. 079 creates **no** organization-level equivalent and
should not.

**The options, for Greg:**

| Option | What it costs | What it says |
|---|---|---|
| **1. Reach it through the primary contact.** `organizations -> primary_contact -> meeting_url`, one hop further, using the existing `ORG_CONTACT_SELECT` shape extended by one field. | A field added to the shared select fragment, and every site that uses `ORG_CONTACT_SELECT` pays for a column it does not read. | **The truthful one.** "Book a call with the person this company designated." It also degrades correctly: no designated contact, no button. |
| **2. Denormalize `meeting_url` onto `organizations`.** | A migration, a settings surface to edit it, and a second source of truth for a fact that already has one. | "The company has a booking link." That may eventually be what the product wants - a shared team calendar - but it is a product decision, not a rename. |
| **3. Leave it.** *(what this branch does)* | The button does not render for any lead agency organization created after 079. | Nothing. It fails closed and silently. |

**Recommendation: option 1**, and it is small. It was not done here because it changes the
shared select fragment that thirteen sites depend on, three days after that fragment was
introduced, on a release-night branch. **The code carries a comment saying exactly this at
the site.**

The same field is read a second time, singly, at `app/api/partner/rfps/[id]/route.ts:88`.
Both move together or neither does.

#### B. `location` - NOT one of the five, and this is worth correcting

`location` is a `profiles` column with no organization equivalent, and it is **not** read by
any of the five open blind-class sites. The actual loss is at
`contexts/lead-agency-filter-context.tsx:91`, where `agencyLocation` has been the literal
`''` since the previous run repointed the embeds onto `organizations`.

**It is not caused by the rename and it is not fixed by the rename.** It was caused by the
embed rewrite, it is already explicit in the code with a comment rather than silently
reading a field that cannot exist, and the same three options as `meeting_url` apply -
except that a company location is far more plausibly a company property than a booking link
is, so option 2 (a real `organizations.location`) is the better answer here and the worse
answer there.

`location` is also read on two profile-detail routes,
`app/api/agency/pool/[partnerId]/route.ts` and `app/api/partner/network/[agencyId]/route.ts`,
both of which are in the open list below for a different reason.

#### C. `app/api/projects/[id]/partner/route.ts` - the sixth site is a DEAD ROUTE

The remaining one of the previous run's six emits an `agency` object of
`{ id, email, full_name, company_name }` keyed on `projects.org_id`. It has a clean answer
under the org model - it is exactly what `ORG_CONTACT_SELECT` is for.

**It was not fixed because nothing calls it.** A repository-wide search for
`/api/projects/<id>/partner` finds no `fetch`, no SWR key and no link.

**Recommendation: delete the route.** Repairing a route with no caller adds a maintenance
surface and a false signal that something depends on it. Deleting it is a decision worth
taking deliberately rather than as a side effect of a release, so it is written up rather
than done.

It also contains `.eq('vendor_org_id', user.id)` - **the same coincidence in the opposite
direction**, an organization column compared to a user id. That mirror-image class is
described under "what the guard cannot do" below.

---

### The twenty-five that remain open

Every one of these reads a `profiles` row using an id that is an organization id after 079.
Every one works correctly for the sixteen existing accounts and returns **nothing, at HTTP
200, with no error**, for any organization created after the migration.

`DIRECT` means the filter argument itself names an organization column - no judgment
involved. `NEARBY` means an organization identifier is in the surrounding code and the
chain was read by hand.

| File | Line | Evidence | What breaks |
|---|---:|---|---|
| `app/api/agency/msa/ai-schedule/route.ts` | 174 | DIRECT | vendor context for the AI milestone schedule |
| `app/api/agency/msa/milestones/route.ts` | 247 | NEARBY | vendor names on MSA milestones |
| `app/api/agency/msa/route.ts` | 96 | NEARBY | vendor names on the MSA list |
| `app/api/agency/payment-synthesis/route.ts` | 198 | NEARBY | vendor names in payment synthesis |
| `app/api/agency/pool/[partnerId]/route.ts` | 71, 78 | NEARBY | **the whole vendor detail page** |
| `app/api/agency/projects/[projectId]/status-updates/route.ts` | 201 | DIRECT | the agency's own name in a status-update email |
| `app/api/agency/rfp-responses/route.ts` | 227 | NEARBY | vendor names on the responses list |
| `app/api/partner/network/[agencyId]/route.ts` | 86 | NEARBY | **the whole lead agency detail page** |
| `app/api/partner/payments/route.ts` | 92 | NEARBY | agency names on payments |
| `app/api/partner/projects/[projectId]/active-engagement/route.ts` | 174 | NEARBY | agency name on an engagement |
| `app/api/partner/projects/route.ts` | 101 | NEARBY | agency names on the projects list |
| `app/api/partner/rfps/[id]/route.ts` | 88 | DIRECT | `meeting_url`, see B above |
| `app/api/partner/rfps/route.ts` | 166 | NEARBY | `meeting_url`, see B above |
| `app/api/partnerships/route.ts` | 814, 868, 956, 1007 | DIRECT | **four EMAIL ADDRESS lookups.** These send mail. |
| `app/api/projects/[id]/assignments/route.ts` | 343, 438 | DIRECT | **two EMAIL ADDRESS lookups.** |
| `app/api/projects/[id]/partner/route.ts` | 92 | DIRECT | dead route, see C above |
| `app/api/rfp/guest/[token]/route.ts` | 217, 241 | DIRECT | **the agency name and logo on the guest RFP page** |
| `app/partner/profile/page.tsx` | 279 | NEARBY | agency names on the vendor's own profile |
| `lib/magic-token-attach.ts` | 286 | DIRECT | the agency name written onto a claimed inbox row |

**The six email-address lookups are the most severe.** `partner?.email` comes back
undefined, the guarded send is skipped, and nobody is notified - the same silent-recipient
failure the notification work closed sixteen instances of, surviving in a different shape.

**The two allow-listed sites**, read and established to be user ids:

| File | Why it is correct |
|---|---|
| `lib/email.ts:361` | `resolveOrgNotificationRecipients()`. The ids are `org_members.user_id`, resolved from the organization one line earlier. The single-element `[orgId]` fallback is deliberate, fires only pre-079, and logs. |
| `app/api/partnerships/route.ts:186` | `domain_match_profile_id` and `notes.matched_profile_id` record which PERSON an email domain matched. Not organization columns. 079 does not rename them. |

**Why they are not fixed here.** Twenty-two unreviewed edits to routes nobody asked about,
on the night before a release, is a larger risk than the bug they close - which is latent,
affects no existing account, and cannot fire until a new customer both signs up and forms a
relationship. **The class is recorded so it cannot grow silently, and closing it is the
first work after this branch ships.**

---

### CAN A GUARD CATCH THIS CLASS?

# PARTLY. AND THE HONEST ANSWER MATTERS MORE THAN THE GUARD.

`scripts/check-org-id-reads.mjs`, added this run. It found all twenty-five, including
nineteen the hand census missed. Its guard mode was **self-tested by execution**: a
deliberate new instance was appended to a clean file, the guard exited 1 and named the file
and the count; the file was restored and it exited 0 again.

But it is a **proximity heuristic over source text, not dataflow analysis**, and the
difference is the whole finding:

**What it does.** For every `.from('profiles')` filtered by `.in('id', ...)` or
`.eq('id', ...)`, it flags the site if the filter argument itself names an organization
column (`DIRECT`) or if an organization identifier appears within forty lines (`NEARBY`).
Arguments that are user ids by construction (`user.id`, `userId`, `...UserId`) are excluded
by argument rather than by file, so a genuine finding elsewhere in the same file still
reports.

**What it CANNOT do, and no amount of work on this script fixes it:**

1. **It misses an org id that travels.** If the id is renamed to something with no `org` in
   it, arrives as a function argument from another module, or is carried on an object
   property whose own origin is several hops away, the check is blind.
   `app/agency/pool/page.tsx` is exactly that shape - `row.partnerId` comes from
   `p.vendor_org?.id` two functions earlier - and it is caught **only because the same file
   happens to mention `vendor_org_id` elsewhere. That is luck, not detection.**
2. **It cannot tell a correct read from an incorrect one.** That is what the allow-list is,
   and every entry there is a human claim, not a machine fact.
3. **It cannot see the mirror image.** `.eq('vendor_org_id', user.id)` - an ORGANIZATION
   column compared to a USER id - is the same coincidence in the opposite direction, and
   nothing here looks at the right-hand side of a filter. `check-identity-columns` does not
   either. **This class is currently caught by nobody.**
4. **It cannot tell you whether the fixed query returns anything.** A row filtered by row
   level security comes back as an empty array at HTTP 200. Only a live authenticated
   session answers that.

### THEREFORE, WHAT A HUMAN MUST INSPECT

Because a check that implies more confidence than it has is worse than no check:

1. **Every `.from('profiles')` in the repository, once, against the single question "where
   did this id come from".** There are 209. The guard is a net under that reading, not a
   substitute for it.
2. **Every filter whose right-hand side is `user.id` and whose left-hand side is an
   organization column.** No guard covers this today. It is the same bug, and it fails the
   same way: correct for sixteen accounts, silently empty for the seventeenth.

### The pattern this is the third instance of

| # | Class | Caught by | Blind to the next one because |
|---|---|---|---|
| 1 | unrenamed identity columns | `check-identity-columns.mjs` | a constraint name has no word boundary before `partner_id` |
| 2 | embeds through repointed foreign keys | `check-embed-targets.mjs` | a separate query has no `table!hint(` in it |
| 3 | profiles read by an organization id | `check-org-id-reads.mjs` | the column name is already the post-079 one |
| 4 | **organization column compared to `auth.uid()`** | **nobody** | nothing reads the right-hand side of a filter |

**Each guard was built to catch the previous blind spot and was blind to the next.** There
is no reason to believe the fourth is the last, and the reason is structural: every one of
these is a TYPE error - a company id where a person id belongs - in a codebase where both
are bare `uuid` strings and the Supabase clients carry no generated types. **The permanent
fix is generated `Database` types, not a fourth script.** That is the recommendation.

---

## ITEM 3: THE RUNBOOK. WHAT I COULD NOT EXECUTE WITHOUT ASKING.

`docs/079-release-runbook.md` is rewritten. Every step is copy-pasteable and every check
states its expected result. Structure: phase one is read-only preparation, phase two is the
outage, phase three is the M1 isolation test behind its own decision point.

**The list below is the deliverable, not a formality.** It is the result of re-reading the
finished page as if it were 9am with no context, and it is the set of places where I would
have had to stop and ask somebody. It is reproduced in full at the foot of the runbook.

1. **Which of 080, 081 and 082 are actually applied?** Step 1c's expected count depends on
   the answer and the answer is written nowhere. `LIGAMENT_CONTEXT.md` lists none of the
   four migrations 079 through 082.
2. **Is 078 applied?** `LIGAMENT_CONTEXT.md` says no; 079's PHASE 12 header says yes and
   verified in production. Step 4.2 resolves it empirically, and I assert it does not block -
   but I am asserting it.
3. **How do I put the site in maintenance?** The step says "or accept the outage" and does
   not say how, because I found no maintenance mode in the repository. I would assume
   "accept the outage" - an assumption, not an instruction.
4. **Which account is A2?** Step 8 needs a second real account whose owner will not be
   surprised to find themselves in somebody else's organization. Sixteen exist. **Name it in
   advance.**
5. **Where does A2 check the AI quota?** I wrote `/api/agency/usage`, which is an API route.
   I do not know whether there is a UI for it.
6. **How does A2 attempt to update the organization at step 8.5?** I do not know whether
   `/agency/settings/profile` writes to `organizations` after 079 or still writes to
   `profiles`. **If it still writes to `profiles`, that step is not testing what it claims
   to test.**
7. **What `DROP POLICY` count should step 2 expect if something HAS drifted?** I wrote 83
   "if nothing has drifted" and cannot give a number for the other case.
8. **Is there a staging or branch database?** Nothing on the page lets the migration be
   tested anywhere before production. The answer appears to be no; see `docs/079-preflight.md`.
9. **At step 8.4, which URL does B paste?** If the agency project page is guarded by the
   selected-project context rather than by RLS, a 404 proves nothing.
10. **How long may the second membership stay in place?** If step 8 is stopped halfway, a
    real person sits in two organizations with no interface to leave one.

### What else the runbook now settles that it did not before

- **Step 0 is the storage policy check**, with the exact query and an explicit STOP, plus
  the point-in-time-restore window as 0d - because the recovery path for "the down migration
  failed" is a restore, and finding the button at that moment is too late.
- **The one-member statement is explicit** and sits immediately above the smoke tests:
  every step through step 7 runs while every organization holds exactly one member, so
  nothing should look different and any regression is visible against known-good behaviour.
- **M1 is phase three with its own decision point**, and the direct `org_members` INSERT is
  written out in full, with the ids read from a query rather than retyped, and with the role
  as `'member'` rather than `'owner'` so the admin restriction is actually under test.
- **Smoke-pass-but-isolation-fail is pre-decided**, because the instinct is wrong in one
  direction: an empty portal for the colleague is a **lockout**, is invisible to every real
  user, and **must not** trigger a rollback - delete the test membership and the product is
  exactly as it was. Organization B seeing organization A's data is a **leak**, and deleting
  the test membership closes it immediately; roll back only if it reproduces without a
  second membership.
- **In-flight users: do it late, announce nothing, invalidate nothing** - at sixteen
  accounts. Sessions carry no organization claim, so nothing is stale; `org_members` is read
  fresh through a `STABLE` function on every request. The real cost is a user mid-form, who
  loses what they typed, because nothing in this codebase drafts form state. **Revisit at
  the first customer with a team.**
- **Rollback states the order in a heading**: revert the deploy first, then the down
  migration, with realistic windows of 5 to 15 minutes forward and 10 to 20 back.
- **An expected-breakage section** so nobody chases a ghost: the pool card, blank
  `location`, the missing "Book a call" button, the twenty-five open reads, and the fact
  that `full_name` and `capabilities` on a company now describe its designated contact.

---

## ITEM 4: THE PRE-FLIGHT PAGE

`docs/079-preflight.md`. One page, nine questions, each with its evidence.

The headline: **079 has never been executed anywhere, by anything.** All four database
credentials are present-and-empty, verified again this run; there is no `psql` and no
Postgres driver. **If a Supabase branch database can be obtained, running 079 on it is
worth more than every other check on that page combined.**

One defect was found and fixed while writing it: **079's own PHASE 2 verification block
stated the expected capability distribution as `(t,f)=12, (f,t)=4`, which is the
PRE-correction figure.** After the seven role corrections the correct expectation is
`(t,f)=5, (f,t)=11`. Greg would have run the migration's own verification, seen 5/11, and
been told by the migration that something was wrong. **Corrected. Comment only - no
executable SQL in 079 was touched.**

---

## HONEST VERIFICATION

### Executed from this terminal, results observed

- `npx tsc --noEmit` - exit 0, after each of the two code changes and before each commit.
- `pnpm build` - exit 0.
- `node scripts/check-identity-columns.mjs --guard` - exit 0. Inventory: 0 in 0 files.
- `node scripts/check-embed-targets.mjs --guard` - exit 0. Inventory: 0 REPOINTED, 0 PERSON.
- `node scripts/check-org-id-reads.mjs --guard` - exit 0 against its recorded baseline;
  inventory 25 open, 1 allow-listed.
- **The new guard's failure mode was self-tested by execution.** A deliberate new instance
  of the class was appended to `app/api/agency/dashboard/route.ts`; the guard exited **1**
  and printed `found 1, KNOWN_OPEN records 0`. The file was restored and it exited **0**.
- `node scripts/audit-policy-snapshot.mjs docs/schema-snapshot-2026-08-13.md` - ran to
  completion; the six allow-listed policy names were read from its output rather than
  transcribed.
- **The 83 `DROP POLICY` names in 079 were parsed out of the migration and looked up in the
  Aug 13 snapshot by script.** 83 drops, 104 snapshot rows, **0 not found, 0 duplicates.**
- The four database credentials in `.env.production.local` were confirmed **present and
  empty** by a grep that matched the key with nothing after the `=`.
- Every file changed in this run was read in full before and after editing.

### NOT executed. Claims that rest on reading.

- **Every claim about post-079 behaviour.** 079 is unapplied. `organizations`,
  `org_members`, `current_user_counterparty_org_ids()` and the counterparty policy exist in
  no database. **Every before-and-after visibility statement in Item 2 is a reading of
  policy text against query text.** The "before" halves describing today's behaviour rest on
  the Aug 13 snapshot; the "after" halves rest on 079's unapplied policy bodies.
- **That the migration parses.** It has never been submitted to a Postgres server, including
  this run's one-comment change.
- **That the three fixed queries return anything.** No route was exercised, no page loaded.
  `.from("organizations").select(ORG_CONTACT_SELECT)` has never been issued against a
  database where that table exists.
- **That the pool card renders the new string.** The change is a constant substitution in a
  code path that was not run.
- **The RLS-filtered embed question** - null or error - remains unresolved, and is
  unresolvable in this environment because the app makes zero client-side Supabase calls
  and every credential that would let a terminal issue an authenticated query is empty.
- **Storage policies** remain UNKNOWN until runbook step 0 is run.
- **The twenty-five open sites were confirmed as findings by reading the code at each one**,
  not by executing any of them. Seven of the `DIRECT` ones were opened and read in full
  during this run; the remainder were confirmed from the filter argument, which names an
  organization column outright.

### The one sentence to take away

**Every mechanical check that can be run without a database is green, and none of it has
met a Postgres server or a browser** - so the release is ready in the sense that nothing
known is broken for the sixteen accounts that exist, and unready in the sense that its
first execution will be on production and twenty-five reads are waiting for the
seventeenth account to exist.
