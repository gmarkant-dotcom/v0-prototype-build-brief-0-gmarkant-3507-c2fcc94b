# The 079 rename: execution report

## State of play

**Branch: `feat/079-org-rename`**, three commits ahead of `main`, rebased onto `main` at the
start. Nothing pushed, nothing merged.

**On `main`:** one commit, `28be279`, which is safe to deploy against today's database and
does not touch the rename. It adds `msa.confirm` to 080's vendor-visible whitelist, records
081 as applied with what actually ran, and makes the three code changes 082's STOP GATE
demanded - written so they work both before and after 082 is applied.

**The one sentence that matters: `scripts/check-identity-columns.mjs --guard` exits 0.**

```
Legacy company identity columns in application source
Roots: app, lib, components, contexts, hooks, middleware.ts
Scanned 364 files.

Summary
  org_id                 0
  lead_org_id            0
  vendor_org_id          0
  needs-human-read       0
  TOTAL                  0  in 0 files

GUARD PASSED. No legacy company identity column names in application source.
```

**And the sentence that qualifies it: the guard is blind to the thirteen things that will
actually break.** They are in "The thirteen broken embeds" below. A green guard means no
occurrence of the four old column names survives as a whole word in application source. It
does not mean the rename is finished, and on this branch it is not.

**THIS BRANCH IS UNDEPLOYABLE UNTIL 079 IS APPLIED.** Merging it before the migration breaks
production immediately: every query in it names columns that do not exist. There is no
partial state - the columns cannot be named both ways at once.

---

## Item 0: what landed on `main`, and the 0c ordering decision

### 0a. `msa.confirm` is vendor-visible

One line in `public.vendor_visible_event_types()`, taking the whitelist from 22 entries to 23,
plus the verification note that asserted 22 and no `msa.confirm`.

The disagreement is settled in writing in two places: the header of
`supabase/migrations/080_milestone_events.sql`, where the old text explained why it failed
closed, and `docs/capabilities.md` section 5, whose table row previously said no. The ruling
is recorded as Greg's, with the reason - confirming a vendor's NDA or MSA is a fact about that
vendor's own paperwork and they already see the resulting state, so withholding the breadcrumb
hid who confirmed it, not whether it was confirmed. `msa.create` and `msa.milestones_set` stay
invisible: those are the agency drafting its own terms, not a fact about the vendor's
paperwork.

### 0b. 081 now records what ran

Both `DROP POLICY IF EXISTS` clauses are plain `DROP POLICY`, matching production. The header
says why that is the safer statement rather than the sloppier one: a `DROP` that matches
nothing reports success, and because the `DROP` and the `CREATE` share one transaction, a
stale name would have created the scoped policy BESIDE the unscoped one. RLS ORs them
together, so the exposure would have survived a fix that looked applied. Without `IF EXISTS`
a stale name aborts the transaction.

Marked `APPLIED 2026-08-17` with the observed results: one INSERT policy per table (the check
that matters), per-table totals 5 and 4, schema total still 104.

**One correction made while doing this.** Verification note 3 said `project_documents` should
end with four policies and `project_messages` with three. The Aug 13 snapshot records five and
four, and the live counts confirm five and four. The note's arithmetic was wrong; it is fixed.

### 0c. 082's three code changes, and why they went on `main`

**Decision: committed to `main`, because they tolerate the before-state.**

The brief's condition was that the changes must work both before and after 082. The naive
version does not. On the day this lands, no phase of 082 has been applied, so
`partner_vouch_count` and `partner_vouch_counts` **do not exist**. A bare
`supabase.rpc("partner_vouch_count", ...)` fails against today's database - which is the STOP
GATE's failure in the opposite direction.

So `lib/vouch-counts.ts` calls the RPC and falls back to the old direct table read **only** on
PostgREST error `PGRST202`, "could not find the function in the schema cache". That is the one
and only condition under which the pre-082 read is still the right answer.

**The before-state reasoning, tested explicitly.** Three states, and the code is correct in
all three:

| State | What happens | Count |
|---|---|---|
| Before 082 phase 1 (production today) | RPC absent, PostgREST returns PGRST202, fallback reads `partner_vouches` directly, which the live `USING (true)` policy still permits | correct |
| After phase 1, before phase 2 | RPC present and used. The table is still readable and is no longer read | correct |
| After phase 2 | RPC present and used. The fallback cannot fire, because phase 2 never drops the functions phase 1 created | correct |

Any error other than PGRST202 - a permission failure in particular - is logged and returns 0
rather than falling back. Falling back on a permission error is exactly how a post-phase-2
silent zero would be reintroduced, and the narrowness is the whole point of the design.

**The required order, stated plainly.** Phase 1 and this deploy are **order-independent**;
either may come first. Phase 2 is not: it requires phase 1 first, then confirmation that the
counts render through the RPC path, then phase 2, then deletion of the two `082-FALLBACK`
blocks. After phase 2 the fallback can never succeed - the policy it depends on is gone - so
leaving it turns a would-be loud PGRST202 into a quiet 0.

**082 was NOT applied.** No migration was applied and no write query was run in this session.

**What Greg must see after applying phase 2:**

- `/partner/profile` - the vendor's own vouch count, non-zero for a vendor known to have
  vouches. Reads `partner_vouch_count`.
- `/agency/pool/<partnerId>` - the count AND the correct vouched / not-vouched button state.
  Two separate reads: the count through `partner_vouch_count`, the button through a direct
  select the colleague-scoped SELECT policy still permits.
- The marketplace listing at `/partner/marketplace` (and the agency-side discover surface) -
  a per-vendor count on every card. Reads `partner_vouch_counts` in one call.

A zero where a number is expected means the RPC path is not working and the fallback is
covering for it, or has stopped being able to.

### The 079 header caveat

`supabase/migrations/079_organizations.sql` said seven of sixteen accounts carried
`role='agency'` while their signup metadata said `partner`, and that applying 079 first would
stamp seven organizations as lead agencies that are vendors. Those seven are corrected. The
header now records it as resolved in both places it appeared, notes that Rule A and Rule A'
therefore agree, and states that no ruling is outstanding. It also says to re-measure before
applying anyway, because that check is one `SELECT` and the cost of being wrong is bad data in
a new table on day one.

---

## Item 2: the three-category classification

Counted before anything was renamed, over the 767 occurrences in 105 files on the branch
(the plan's 707 in 103 files, plus what the capability layer, the milestone emitter and
`lib/vouch-counts.ts` added since).

| Category | Count | Files |
|---|---:|---:|
| **(a)** a database column reference in a query or policy | **657** | 92 |
| **(b)** a key in a JSON response or request body the frontend reads | **20** | 12 |
| **(c)** a TypeScript variable, type field or comment - cosmetic | **90** | 33 |
| **Total** | **767** | 105 |

**The rule used**, because the categories have to be exclusive to be countable: an occurrence
is classified by what the token IS at that site. A select-list string, a filter argument, an
insert payload key, an embedded selector, a property read on a row PostgREST returned, and the
local type that describes such a row are all **(a)** - they rename unconditionally with the
column. **(b)** is only where the token is genuinely a payload key with no column identity at
that site: the type of an API response body, and the read of that body in a client component.
**(c)** is comments and demo fixtures.

### The (b) set, enumerated, because it is the one the guard cannot protect

The brief is right that this is the invisible risk: a payload key renamed on one side only
builds cleanly and `--guard` calls it complete. It stays invisible if the two sides are given
DIFFERENT new names - the guard checks that the old name is gone, never that the two sides
agree.

Each of these was traced from the reading line back to the `fetch()` that produced it and
forward to the route that emits it. All twenty are in the same commit, and each wire key was
given one name on both sides.

| Endpoint | Emitter side | Consumer side | Name chosen |
|---|---|---|---|
| `GET /api/partnerships` | pass-through of partnership rows | `app/agency/page.tsx:91`, `app/agency/pool/page.tsx:448`, `contexts/lead-agency-filter-context.tsx:84`, `components/marketplace-content.tsx:118,119` | `lead_org_id` / `vendor_org_id` |
| `GET /api/agency/rfp-responses` | `BidRow` in `lib/bid-shared.ts:20` | `app/agency/bids/page.tsx:209,586`, `components/bid-detail-sheet.tsx:151,900` | `vendor_org_id` |
| `GET /api/partner/payments` | `route.ts:229,233` | `app/partner/payments/page.tsx:47,63,372` | `lead_org_id` |
| `GET /api/partner/projects` | `route.ts:175,210,239` | `app/partner/projects/page.tsx:30,724` | `lead_org_id` |
| `GET /api/partner/rfps/[id]` | the inbox row | `app/partner/rfps/[id]/page.tsx:122` | `lead_org_id` |

Two of these the scanner would have got wrong on its own: `/api/partner/projects` emits an
`agency_id` whose value comes from `partnerships.agency_id`, not from `projects.agency_id`,
and the nearest `.from()` in that route is `projects`. It is `lead_org_id`, not `org_id`, and
the consumer at `app/partner/projects/page.tsx:724` had the same wrong guess.

---

## Item 3: the rename, and the falling count

| After | Remaining | Note |
|---|---:|---|
| Branch baseline | **767** | in 105 files |
| Mechanical pass (753 renamed) | **14** | 1 deliberately skipped, 13 with no target |
| Hand-resolving those 13 | **3** | the skip, plus two meta-comments |
| Marking the broken embeds | **17** | the markers themselves said `partner_id` |
| Rewording the markers | **4** | |
| Rewriting meta-comments, fixing the skip | **0** | `--guard` exits 0 |

### What the ambiguity actually was

The per-file consistency pass found something worth stating: **`partner_id` resolves to
`vendor_org_id` everywhere in the tree, with no counter-example**, and the same holds for
`voucher_agency_id` and `vouched_partner_id`. The entire ambiguity surface of this rename is
`agency_id`, splitting between `org_id` (a one-company table) and `lead_org_id` (a two-company
table). That reduced 767 decisions to 224 real ones, across the 31 files where `agency_id`
resolves to both targets.

Those 224 were read line by line rather than trusted to the nearest `.from()`. **72 needed a
whole-line override** because the heuristic had attributed them to the wrong table - most
commonly a property read like `partnership.agency_id` sitting under a `.from("profiles")` from
an earlier query.

### The four occurrences where one line takes two different names

The nastiest shape in the run, and the reason a line-level rename would have been wrong:

```ts
// app/api/rfp/guest/[token]/route.ts:597 - an insert into partner_rfp_responses,
// fed from an rfp_magic_tokens row
lead_org_id: tokenRow.org_id,          // key: two-column table. value: one-column table.

// lib/magic-token-attach.ts:315 - the same shape, inserting into partner_rfp_inbox
lead_org_id: tokenRow.org_id,

// lib/magic-token-attach.ts:105 and :116 - the mirror case on a filter
.eq("lead_org_id", tokenRow.org_id)
```

A find-and-replace, however careful about the file, gets all four wrong.

### What the compiler did catch, and what that is worth

Four errors, all where a local type and its reader disagreed after substitution:
`app/api/partner/rfps/bids/route.ts:149`, `app/api/projects/[id]/agreements/[agreementId]/route.ts:95`,
`lib/magic-token-attach.ts:105` and `:116`. All four were real and all four are fixed.

That is not evidence the compiler helps here. It caught them because both sides of the
disagreement were hand-written TypeScript in the same file. It saw nothing at any of the 657
category-(a) sites, which is the whole point of the census.

### Collateral damage from whole-line overrides, and how it was found

Three override lines carried a `partner_id` as well as an `agency_id`, and the override took
priority over the universal rule, so `partner_id` was wrongly renamed to the override's target
on those lines. Two were caught by the compiler; the third was a comment and was found by
auditing every override line for a second column. All three are fixed. Worth recording because
the audit, not the compiler, is what generalises.

---

## The thirteen broken embeds

**This is the most serious finding of the run and it is not fixed.**

Thirteen PostgREST embeds traverse a foreign key that 079 repoints:

```ts
partner:profiles!partnerships_partner_id_fkey(id, email, full_name, company_name)
```

079 PHASE 7 drops every foreign key on a renamed column and recreates it against
`organizations(id)`, naming it `<table>_<newcol>_org_fkey`. So after 079:

- `partnerships_partner_id_fkey` does not exist; `partnerships_vendor_org_id_org_fkey` does,
  and it points `partnerships` at `organizations`.
- `profiles!partnerships_vendor_org_id_org_fkey` is therefore invalid - that constraint does
  not reach `profiles`.
- `organizations!partnerships_vendor_org_id_org_fkey` is valid and useless: `organizations`
  carries `id`, `name`, `is_lead_agency`, `is_vendor` and two timestamps. No `email`, no
  `full_name`, no `company_name` - which is exactly what these embeds select. The table
  comment 079 writes even says "Do not join profiles on an org id."

**The guard cannot see this.** `partnerships_partner_id_fkey` contains the old column name
with a `_` in front of it, so `\bpartner_id\b` never matches. The census never counted these,
the guard reports 0, and thirteen queries are broken.

Left unresolved on purpose, per the brief's instruction not to guess. Rewriting them means
answering "what is an organization's email address", which is the
`resolveOrgNotificationRecipients()` product ruling, not a substitution. Each is marked
`079-EMBED-BREAK` with the reasoning at the site.

| File | Line of the embed | Selects |
|---|---:|---|
| `app/api/partnerships/route.ts` | 87 | id, email, full_name, company_name, capabilities, company_logo_url, created_at |
| `app/api/projects/route.ts` | 151 | via `partnerships_partner_id_fkey` |
| `app/api/projects/route.ts` | 415 | via `projects_agency_id_fkey` -> becomes `projects_org_id_org_fkey` |
| `app/api/projects/[id]/assignments/route.ts` | 61 | |
| `app/api/projects/[id]/assignments/route.ts` | 167 | |
| `app/api/projects/[id]/onboarding-packages/route.ts` | 68 | id, email, full_name, company_name |
| `app/api/projects/[id]/onboarding-partners/route.ts` | 62 | |
| `app/api/projects/[id]/onboarding/deploy/route.ts` | 81 | id, email, full_name, company_name |
| `app/api/agency/active-engagements/route.ts` | 179 | |
| `app/api/agency/projects/[projectId]/status-updates/route.ts` | 86 | company_name, full_name |
| `app/api/agency/broadcast-rfp/route.ts` | 204 | email, full_name, company_name |
| `app/api/agency/broadcast-rfp/route.ts` | 343 | email, full_name, company_name |
| `app/agency/pool/page.tsx` | 661 | `profiles!vendor_org_id` - the column-name form of the same break |

Two further `profiles!project_messages_sender_id_fkey` embeds are **unaffected**: `sender_id`
is not renamed and still points at `profiles`.

`docs/079-release-runbook.md` step 3 makes deciding these a precondition of opening the
maintenance window, and proposes embedding `organizations` and reading `name` as the likely
answer.

---

## The service-role routes

`resolveCallerOrgIds(userId, client)` added to `lib/entitlements.ts`. It reads `org_members`
directly rather than calling 079's `current_user_org_ids()` RPC, because that function resolves
`auth.uid()` and a service-role client has no auth context - it would return an empty set, and
an empty set passed to `.in()` matches nothing, which fails closed but also fails silently.

| Route | What changed |
|---|---|
| `agency/rfp/magic-link` | 4 read sites now `.in("org_id", callerOrgIds)`; the token write attributed to one organization; 403 on empty membership |
| `agency/email-scan/run` | `enrichWithLigamentData` takes the organization id for pool reads and the user id for the self-guard |
| `agency/email-scan/import` | same split; `importContact` takes both |
| `lib/server/partner-pool-import` | the argument's meaning changed once, and both calling routes follow. One function, not two routes |
| `partner/rfps/bids` | `.eq("vendor_org_id", user.id)` -> `.in(...)`; stale RLS comment corrected |
| `partner/projects` | two sites, same change |
| `partner/rfps` | the comment claiming "RLS applies" on a service-client query is replaced with one that is true |
| `partner/partnerships/claim` | writes an organization id; the collision is documented and left |
| guest token routes | rename only. The token IS the delegation and remains the authority |
| admin, auth-callback, contact, check-email, email-connections | unchanged, per the plan |

**One argument split in two, because the rename made a conflation visible.**
`evaluateImportGuard()` and `resolveAgencyOwnDomains()` took an `agencyId` that answered two
different questions: "which company owns this pool" and "which person is making this request".
The self-account check compares against a `profiles.id`; the domain guard reads a `profiles`
row. Both now take `callerUserId` while the pool scoping takes `agencyOrgId`. Before 079 one
value served both and the conflation was invisible. This was not in the plan and is the kind
of thing only a line-by-line pass finds.

**Stated rather than smuggled:** a colleague's mailbox scan now writes into the SHARED pool,
because the pool belongs to the organization. That is almost certainly wanted. It is recorded
at the site so it is a decision and not a discovery.

---

## The eleven email-resolution sites

All eleven now route through `resolveOrgNotificationRecipients(orgId, client)` in
`lib/email.ts`.

The ruling it encodes is the plan's recommendation: **every member, with
`profiles.notification_preferences` as the opt-out**, opted out only on an explicit
`email === false`. Absent, null and malformed all mean opted in - the failure direction for a
notification system is one email too many, never silence.

| # | Site | Recipient | Was it silent? |
|---:|---|---|---|
| 1 | `projects/[id]/onboarding-packages` | vendor | No - `.single()` plus `console.error` |
| 2 | `agency/projects/[projectId]/status-updates` | vendor | Yes |
| 3 | `agency/rfp-responses/[id]` (partnerIdForResolution) | vendor | Yes |
| 4 | `agency/rfp-responses/[id]` (feedback) | vendor | Yes |
| 5 | `agency/rfp-responses/[id]` (award) | vendor | Yes |
| 6 | `agency/rfp-responses/[id]` (decline) | vendor | Yes |
| 7 | `partner/projects/[projectId]/status-update` | **lead agency** | Yes |
| 8 | `partner/rfps/[id]/response` | **lead agency** | Yes |
| 9 | `partner/rfps/[id]/nda-notify` | **lead agency** | No - 500s |
| 10 | `rfp/guest/[token]` (revision) | **lead agency** | Yes |
| 11 | `rfp/guest/[token]` (submit) | **lead agency** | Yes |

**Every one of the ten silent sites now logs when it resolves nobody.** That was the actual
defect. The lookup being wrong is recoverable; the lookup being wrong and saying nothing is
what makes agency notifications stop without anyone noticing for a month.

**The fallback, and why it is not a bug.** When `org_members` yields nothing, the resolver
falls back to `profiles WHERE id = orgId` - exactly the pre-079 behaviour, correct for all
sixteen backfilled organizations whose id equals their founder's, and it logs a warning. It is
what keeps the eleven sites working through the release window instead of going silent in it.
It returns nothing for an organization created after 079, which is precisely when the warning
matters.

**One loss worth naming:** `display_name` is dropped from the two guest-path recipient chains,
because the resolver returns `full_name` and `company_name`. Those two were already the
fallbacks below it.

---

## Occurrences left ambiguous

Under the brief's rule: where context did not settle it, it was left, marked greppably, and
listed here.

**1. The thirteen embeds.** Listed in full above with file and line, marked
`079-EMBED-BREAK`. Not settled because the answer is a product ruling about what an
organization's email address is.

**2. `hasAgencyEntitlement()` - `lib/entitlements.ts`.** The 079 seam says it should read the
organization's entitlement. **079 creates no entitlement column on `organizations`** - the
table has `id`, `name`, `is_lead_agency`, `is_vendor` and two timestamps. Moving entitlement
there means inventing a column, which is a migration and a billing decision. Left reading
`profiles.is_paid`, with the consequence written into the file header: billing is ruled per
organization, but until that column exists a colleague added to a paying organization is not
entitled unless their own profile row says so.

**3. `orgRoleFor()` - `lib/capabilities.ts:249`.** Still returns `"owner"`. This is correct
today rather than unfinished: 079 backfills exactly one member per organization, with role
`owner`, and nothing in this repository creates a second. It becomes a silent grant of owner
to every colleague the moment anything can. `loadOrgRole(userId, orgId, client)` is written,
tested by the compiler and deliberately unused, so closing it is replacing one function body
rather than writing new plumbing under time pressure.

**4. `partner/partnerships/claim` - the collision.** The write is corrected to an organization
id, because writing a user id into `vendor_org_id` would be a foreign key violation after 079.
The behaviour is not: the first colleague of a vendor company to sign up now claims every
unclaimed partnership addressed to that email, and the second finds none left. That collision
does not exist today and exists the day 079 ships. Whether a pending invitation is addressed to
a person or to a company is unanswered. Documented at the site.

**5. `resolveAgencyOwnDomains` - `lib/server/partner-import-guard.ts`.** Now takes the
caller's user id, which is right for a `profiles` lookup. The domains it derives are still ONE
member's, not the organization's, so two colleagues on different email domains produce
different same-domain guards. An organization-level domain list is a schema change 079 does
not make.

**6. The 082 functions.** `partner_vouch_counts()` declares its returned column under the
pre-079 name and `lib/vouch-counts.ts` on this branch reads `vendor_org_id`. Re-running 082
phase 1 after 079 is a required release step, marked `079-DEPENDENCY` in the code and recorded
in both 082's header and the runbook. Skip it and every vouch count reads 0, silently.

---

## Judgment calls taken

**A live bug fixed rather than renamed.**
`app/api/agency/msa/ai-schedule/route.ts` filtered `payment_milestones` on the pre-079
lead-agency identity column. **That table does not have it.** The live probe behind 079
measured that column on exactly 21 tables and `payment_milestones` is not one of them - it is
scoped transitively, through `project_id` and `partnership_id`, which is what all four of its
RLS policies read. The predicate returned 42703, the error was destructured away, and the AI
schedule prompt has never seen the milestones that already exist.

Renaming it to `org_id` would have invented a column and kept the bug. Removing it is a
**behaviour change**: the prompt will now see existing milestones and stop proposing
duplicates, which is what the variable name always claimed. Scoping is unaffected -
`response_id` was already validated against `.eq("lead_org_id", user.id)` on
`partner_rfp_responses` twenty lines above. Documented at the site.

*This one rests on inference, not execution.* The evidence is a measurement recorded in
`docs/079-authoring-report.md`, not a query run in this session.

**Every member, not the owner only.** The notification ruling was not deferred, because
deferring it means eleven sites keep a wrong lookup. The plan recommended it, the opt-out
storage already exists, and it is the only option that does not make the product worse for the
second person who joins. If Greg wants owner-only, it is one function.

**Owner-first when a user belongs to several organizations.** `agencyEntitlementId()` picks
the organization the caller owns, then administers, then the first by membership. Deterministic
rather than correct: "which organization is this AI analysis charged to" is a real product
question a portal switcher will have to answer. Deterministic beats arbitrary until it does.

**403 rather than an empty result on empty membership.** In the service-role routes, an empty
`.in()` matches nothing, which fails closed but looks identical to "you have no data". Those
routes return 403 instead so the failure is legible.

**The 082 fallback keyed on PGRST202 only.** Narrow on purpose. Falling back on a permission
error would reintroduce the silent zero the STOP GATE exists to prevent.

**Marker comments reworded to avoid tripping the guard.** Three explanatory comments
originally contained the old column names as prose and the guard counted them. The prose was
reworded rather than the guard weakened. Worth naming because it shows the guard is a string
check, not a semantic one.

**`lib/acting-role.ts` untouched**, as instructed. Confirmed by `git diff`.

---

## What the policy audit still flags, and why that is correct

```
node scripts/audit-policy-snapshot.mjs
Snapshot: docs/schema-snapshot-2026-08-13.md
FLAGGED: 53  (44 direct company-column comparison, 9 indirect)
Allow-listed and not flagged: 6
```

**Expected, and not a failure of this run.** The audit reads
`docs/schema-snapshot-2026-08-13.md`, which is the authoritative record of the LIVE database,
and 079 is unapplied. Every company-scoped policy in production still compares to
`auth.uid()`, and every one of those is correct today, because one user is one company. The 53
is the baseline the plan predicted.

It must be zero after 079 is applied, measured against a fresh capture. That is step 9.4 of the
runbook. The six allow-listed names are policies that match a person on purpose - the email
disjuncts and the pre-claim path; a seventh entry is a decision, not a fix.

**One known staleness in the snapshot the audit reads:** migration 081 replaced the INSERT
policies on `project_documents` and `project_messages` on 2026-08-17 and the Aug 13 file still
records the old bodies. Neither is flagged either way, so it does not change the 53. It is
recorded in 081's header and is why runbook step 1 takes a fresh capture before anything else.

---

## Honest verification statement

### Executed from this terminal, results observed

- `node scripts/check-identity-columns.mjs --guard` - **exit 0**, output pasted at the top of
  this document. Run after every batch; the falling counts in the table above are real
  readings from real runs.
- `npx tsc --noEmit` - **exit 0**, before each of the three commits.
- `pnpm build` - **exit 0**, before each of the three commits.
- `node scripts/audit-policy-snapshot.mjs` - exit 0, 53 flagged, output above.
- `git rebase main` on the branch, clean.
- The classification counts (657 / 20 / 90) were produced by a script over the repository,
  cross-checked by hand for the (b) set and for all 224 ambiguous `agency_id` occurrences.
- The four-occurrence key/value split and the three override collateral cases were found by
  running the compiler and by auditing every override line, and both are fixed and verified by
  a clean `tsc`.

**`tsc` and `pnpm build` exiting 0 prove syntax and nothing about the rename.** The Supabase
clients are constructed without generated `Database` types, so `.eq("org_id", x)` is an
untyped string and `row.org_id` is a property on an untyped record. A green build is compatible
with every call site being wrong.

**`--guard` exiting 0 proves that no occurrence of the four old names survives as a whole
word.** It does not prove any occurrence took the RIGHT new name, and it demonstrably does not
see the thirteen broken embeds.

### NOT executed. Claims that rest on reading, not running

- **No migration was applied. No write query was run.** 079, 080 and 082 remain unapplied.
- **No query was run against the live database at all**, read-only or otherwise. Every schema
  claim in this document comes from `docs/schema-snapshot-2026-08-13.md` or from the
  measurements recorded in `docs/079-authoring-report.md`.
- **That `payment_milestones` has no lead-agency identity column is an inference**, from the
  authoring report's live probe of 21 tables. It was not verified by a query in this session.
  It is the one judgment call in this run that would be worth one `SELECT` before trusting.
- **That the thirteen embeds break is a reading of 079 PHASE 7 and the `organizations` DDL**,
  not an observation. It is a confident reading - the FK is dropped and recreated against
  `organizations` in a `DO` block, and the table has no email column - but nobody has watched
  PostgREST reject one of these queries.
- **Nothing on this branch has been run against a database.** No route was exercised, no page
  was loaded, no email was sent. Every behavioural claim about the renamed code - that the
  eleven email sites resolve correctly, that the service-role routes scope correctly, that the
  vouch fallback fires on PGRST202 - is a claim about code that has been read and compiled, not
  code that has run.
- **Storage policies remain UNKNOWN.** They were not checked, because they cannot be checked
  from here. Runbook step 0 is that check and it carries a stop instruction.
- **The 082 verification results recorded in 081's header** came from the brief, not from this
  session.

---

## Where this leaves the release

1. Runbook step 0: the storage policy check. It can return something that changes the plan.
2. Runbook step 3: decide the thirteen embeds. **They break the product** and they are the
   reason this branch is not merge-ready even once 079 is applied.
3. Everything else is sequenced in `docs/079-release-runbook.md`.

The branch is not pushed and not merged.
