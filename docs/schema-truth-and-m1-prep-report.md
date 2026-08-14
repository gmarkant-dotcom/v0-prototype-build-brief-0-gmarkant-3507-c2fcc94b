# Schema truth baseline and M1 preparation

Run date: 2026-08-14. Branch `main`, started at `41bd4e9`, four commits added, **nothing pushed**.

---

# When you are back

## Both M1 ruling gates came back green, and I ran them

You do not need to run A5 and A9. I executed both read-only against production and both are
clear, which means **you can rule on the Organizations model in one sitting**:

- **A5 - does every `agency_id` point at a real profile?** Yes. **Zero orphans across all 15
  tables that carry an `agency_id`** (196 rows checked in total). Option C, "the organization
  id equals the founding user's uid", is **viable**. It was the option that would have been
  dead on arrival if this had come back non-zero. It did not.
- **A9 - are there already multi-user companies hiding in the data?** No. **14 profiles, 14
  distinct company names, zero collisions, zero blank company names.** The backfill creates
  exactly one organization per profile with no merge decision to make.

Both queries are reproduced paste-ready in Item 4 with truncation guards, so you can
re-confirm at migration time. Every count above is proven un-truncated by its
`content-range` header, printed in the Item 4 tables.

## What landed (four local commits, not pushed)

1. **`776b1eb`** - `docs/schema-baseline-2026-08-13.sql` and `docs/schema-truth.md`. The
   repo can reproduce 61 of the 104 live policies by name. **43 live policy names appear
   nowhere on disk; 15 of those have no ancestor under any name.** 078 is reserved.
2. **`72b8ed3`** - the invitee-role check is gone. It rejected 12 of your 14 accounts.
3. **`0016d33`** - the vendor now sees a tiered lead-agency profile, mirroring the
   agency-to-vendor route. Also fixes a live defect in that mirrored route.
4. **`(this report)`** - documentation only.

## What needs a decision

| # | Decision | Why it is yours |
|---|---|---|
| 1 | **The AI/upload entitlement gates** (backlog P13). Should a vendor's free AI access follow the *account* or the *portal*? | It is a billing question. Nobody is wrongly denied *today* - see Item 2 - so this is not urgent, but it becomes a live cliff the moment billing writes `is_paid=false` to anyone. |
| 2 | **Which of 7 accounts to re-role.** 7 of your 14 accounts chose "partner" at signup and are stored as `role='agency'`. Four are still sitting in the **agency portal** having signed up as vendors: `mariannafayn@gmail.com`, `victoriacaro91@gmail.com`, `andrea@crescestudio.com`, `marcusliwag@gmail.com`. | Some may have legitimately become lead agencies since. Per-account `UPDATE`s are in Item 4c. |
| 3 | **Reuse vs build for colleague invitations** (M1 judgment call 7.4). | See the blocker note directly below. |

## What needs a click

- Nothing is blocking. No migration was run and none needs to be run for the three code
  commits - they are all application-level.
- The live checklist is at the end of this document, in click order.

## The one thing that changes an M1 ruling

**The invitee-role check I removed sat directly on the colleague-invitation path, but only
under the "reuse `partnerships`" option.**

- Under the **recommended** M1 design (a new `org_invitations` table, judgment call 7.4), a
  colleague invitation never touches `POST /api/partnerships`, so this check was irrelevant
  to it.
- Under the **reuse `partnerships`** option, a colleague invitation goes straight through
  that route, and the check would have rejected **100% of colleague invitations** - a
  colleague at a lead agency has `role='agency'` by definition, and post-056 every account
  does. It would have failed with "Can only invite partner agencies, not lead agencies".

It is fixed either way now, so it no longer argues for one option over the other. Recording
it because the previous run flagged it as something that could block M1 and you should know
it is resolved before you rule.

## Shortest path to the M1 rulings session

1. Read the three decisions above (5 minutes).
2. A5 and A9 are already answered - skip them.
3. Run **A8** (the live `handle_new_user` body, in Item 4c) and **A6** (`linked_agency_id`,
   partially answered in Item 4c) - two minutes, and they are the only unanswered gates left.
4. Rule on judgment calls 7.1 (the model), 7.2 (membership policy shape) and 7.4
   (invitations). The other four follow from those.

---

# Item 1: the schema truth baseline

Full detail in `docs/schema-truth.md`. Headlines only here.

## How many live policies exist nowhere in the repo

| | Count |
|---|---|
| Live policies (38 tables, all with RLS on, none locked out) | **104** |
| Reproducible from disk by name, same table | **61** |
| Live under a new name with a recognisable on-disk ancestor | **28** |
| **Exist only in production, no ancestor under any name** | **15** |
| On-disk policies that are not live | **32** |

So: **43 of 104 live policy names appear nowhere on disk**, and **15 have no on-disk
ancestor at all**.

## The finding that matters most

**Where a name matches, the predicate matches too.** All 104 live predicates were normalized
and compared against their on-disk statements. Nineteen differed textually; every one was
cosmetic (the `public.` prefix `pg_policies` strips, column qualification Postgres adds,
`ILIKE` rendered as `~~*`, SQL comments inside a predicate body). **There is no semantic
drift.** The problem is absence, not divergence - which is good news, because it means the
on-disk files are not lying about what they do, they are only silent about most of it.

Three of the 15 orphans are load-bearing:

- **`profiles` / "Users can view profiles of partnership members"** - the policy that lets
  either side of a partnership read the other. The most load-bearing SELECT policy in the
  product, in no file.
- **`rfp_magic_tokens` / "Agency can manage their own tokens"** - the only policy on that
  table, and the table has no `CREATE TABLE` on disk either. The whole Lightning RFP and
  guest-bid flow rests on an object the repo has no record of.
- **`payment_milestones`** carries **three** near-identical partner SELECT policies live;
  only one is on disk. A `DROP` aimed at the on-disk name removes exactly one of the three.

## Tables with no DDL anywhere

Five: `notifications`, `partnership_profile_context`, `project_documents`,
`project_messages`, `rfp_magic_tokens`.

**`LIGAMENT_CONTEXT.md` is wrong to list `msa_agreements` and `payment_milestones` here.**
Both have `CREATE TABLE` statements, in `scripts/029-msa-payments.SKIP` at lines 17 and 40.

## Where the snapshot and the repo disagree

Nine disagreements are recorded in `docs/schema-truth.md` section 6. The two sharpest:

- **`scripts/029-msa-payments.SKIP` is partly live** despite a filename that says never run
  it. Three of its policies and both of its tables are in production. The `.SKIP` extension
  is not evidence of anything.
- **`shared_documents` and `assignment_messages` do not exist.** `scripts/010` creates both.
  Live has `project_documents` and `project_messages` instead. Renamed out of band, recorded
  nowhere. This also answers **A2** in the negative: `scripts/030`'s sixth `projects` policy,
  "Partners read projects with their payment milestones", is **not** live.

## Numbering

**078 is the next unused number and is reserved for Organizations M1.** Nothing was authored
into 078 or 079. Gaps at 048 (applied, no file) and 073 (never existed). 039 is dead - 047
and 056 did its work. Four files (074-077) still carry "NOT APPLIED" headers while live.

I did **not** renumber or reorganise anything. `docs/schema-truth.md` section 7 recommends
**not** trying to make the history replayable - too much was applied out of band, and a
"corrected" history that looks authoritative but is partly invented is more dangerous than an
obviously broken one. Draw a line at this baseline instead; two README files and a discipline
of re-taking the snapshot after every policy migration.

---

# Item 2: the two flagged gates

## Gate 1: the invitee-role check - FIXED

`app/api/partnerships/route.ts:393`, `if (partner && partner.role !== 'partner')` → 400
"Can only invite partner agencies, not lead agencies".

**Does it block M1?** Only under the "reuse `partnerships`" option, where it would have
rejected every colleague invitation. See "When you are back" above. Fixed either way.

### Exactly who it rejected, and why

Evaluated against all 14 live profiles:

| Stored `role` | Accounts | Result |
|---|---|---|
| `agency` | 12 | **rejected as "a lead agency"** |
| `partner` | 2 | accepted |

Three of the twelve rejected accounts have `active_role='partner'` and are **operating as
vendors right now**: `gmarkant+partner23@gmail.com`, `info@ceoofgeo.com`,
`gmarkant+partner70@gmail.com`.

**Has it ever been correct?** Yes, before migration 056. Signup used to record the role the
person chose, so `role='agency'` genuinely meant lead agency. 056 replaced
`handle_new_user()` to hardcode `role='agency'` for every signup. The check's input stopped
carrying the signal the moment 056 ran. It has been wrong ever since.

**What was it protecting against?** Adding another lead agency into your vendor pool. The
product no longer has that case: 13 of 14 profiles carry `secondary_role='partner'`, because
056 made dual-role the default. Every account can act as a vendor by design.

### Why the fix is unambiguous rather than a product ruling

Three independent reasons, all measured:

1. **The check was already absent from the majority path.** `partner` is resolved with the
   *session* client, so the check only fired when row level security let the agency read the
   invitee's profile - an existing partnership, or a discoverable profile. Brand-new invitees
   were never tested at all. That is why new invitations worked and re-invitations of
   existing pool members did not. A guard that fires on an RLS-determined minority is not a
   guard.
2. **The alternative predicate is provably wrong.** The previous run's option (b),
   `secondary_role === 'partner'`, **rejects `gmarkant@icloud.com`** - whose `secondary_role`
   is `'agency'`, who is `role='partner'`, and who is the one unambiguous vendor in the
   system and the partner side of the documented active partnership
   `c0851865-8bb0-4417-aaf0-9185d1c83c7f`. It would reject the only account the check should
   obviously accept.
3. **Every other candidate predicate accepts all 14 accounts**, i.e. is identical in effect
   to having no check. `role='partner' OR active_role='partner' OR secondary_role='partner'`
   passes 14 of 14.

There is no predicate over `role`, `active_role` or `secondary_role` that separates a lead
agency from a vendor, because the data no longer encodes the distinction. A product ruling
needs something to act on; this one has nothing. **Dropped.** If the distinction is ever
wanted, it needs a field that means "this account offers vendor services" - not `role`. That
reasoning is left at the call site so it is not silently re-added.

The invitee's `role` is no longer selected either, so the column cannot be retested by
accident.

**Is it another instance of the role confusion fixed earlier?** Yes - same root cause (056
destroying the meaning of `role`), different subject. The earlier fixes were about the
*caller's* acting role, which `active_role` answers. This one is about a *third party*, who
has no acting role in the request, which is why `active_role` could not fix it and why it
needed removing rather than repointing.

## Gate 2: the AI and upload entitlement gates - REPORTED, NOT FIXED

`app/api/ai/route.ts:180`, `app/api/ai/master-brief/route.ts:52`,
`app/api/ai/rfp-output-template/route.ts:44`, `app/api/documents/extract-text/route.ts:32`,
`app/api/upload/route.ts:59`, plus `app/api/agency/msa/ai-schedule/route.ts:72` and
`app/api/agency/payment-synthesis/route.ts:63`.

### What they actually do, evaluated against all 14 accounts

I ran every gate's predicate against every live profile. The result corrects the previous
run's reading:

| Account | Denied by |
|---|---|
| `sbatty@thelab.co` (`role=agency`, `active_role=agency`, `is_paid=false`) | ai/route, master-brief, rfp-output-template, extract-text, ai-schedule, payment-synthesis |
| `gmarkant@icloud.com` (`role=partner`, `active_role=partner`) | ai-schedule, payment-synthesis only |
| `gmarkant+partner71@gmail.com` (`role=partner`, `active_role=partner`) | ai-schedule, payment-synthesis only |
| **all other 11 accounts** | **nothing** |

**No vendor is wrongly denied today.** The previous run was right that post-056 every vendor
falls into the `role === 'agency'` subscription branch - but **056 also set `is_paid=true` for
every account**, so they pass that branch. The behaviour change is **latent, not live**.

The two accounts denied by `ai-schedule` and `payment-synthesis` are `role='partner'` with
`active_role='partner'`; those are agency-only features and both accounts would fail the
portal gate anyway. Not a wrong denial.

`sbatty@thelab.co` is an unpaid lead agency in the agency portal. Denying them is the gate
working as intended.

**`app/api/upload/route.ts:59` denies nobody at all.** Its predicate is
`role === 'partner' || role === 'agency' || is_admin || is_paid` - any profile with a role
set passes. It is a no-op gate wearing the shape of a real one.

### Why this is a ruling and not a fix

The exposure is real but conditional. **The moment billing writes `is_paid=false` to any
account operating as a vendor, that vendor loses free AI access** - because their profile
says `role='agency'` and always will. Today `is_paid=true` on 13 of 14 accounts masks it
completely.

The correct predicate depends on a question only you can answer: **should the vendor free
tier follow the account or the portal?**

| Option | Predicate | Consequence |
|---|---|---|
| **(a) Follow the portal** | `active_role === 'partner' \|\| (is_paid !== false) \|\| is_admin` | A dual-role user gets AI free while in the vendor portal and must pay in the agency portal. Matches how the product presents itself. Also means a lead agency can get free AI by switching portals - `switch-role` entitlement-checks, so verify that closes the hole. |
| **(b) Follow the account** | Needs a real field, e.g. `is_vendor_only` or a billing plan column | Honest and durable, but `role` cannot express it post-056 and nothing else on `profiles` can either. New column. |
| **(c) Leave as-is** | unchanged | Correct today. Breaks silently the first time an account goes unpaid. |

**My recommendation: (a) now, (b) when billing is real.** (a) is a one-line change in each of
five routes, restores the intended free-vendor behaviour, and fails safe. Do not do (c)
silently - if you choose it, the reason should be written down, because the next person to
look will read it as a bug.

This is backlog **P13** and it stays open. **Untouched in this run.**

---

# Item 3: reciprocal profile visibility

Not stopped. Comparable in size to Item 2: one new route, one shared helper, one component.

**File mirrored: `app/api/agency/pool/[partnerId]/route.ts`.** New route:
`app/api/partner/network/[agencyId]/route.ts`. Same tier names, same "null the field, never
omit it" masking, same server-side decision, same empty-select placement for the refusal.

## Before

The vendor's view of a lead agency was the six columns `GET /api/partnerships` attaches to
each partnership row - `id, email, full_name, company_name, company_logo_url, capabilities` -
**identical whether the partnership was active, pending, suspended or terminated**. The
component comment said as much: "Feeds an active partnership's (minimal) agency data into the
same profile modal Discover uses."

## The resulting matrix

| Agency discoverable | Partnership | Before | **After** |
|---|---|---|---|
| any | **active** | name + email, same as every other state | **`tier:"partnership"`** - identity, contact, payment terms, compliance state, shared work |
| any | pending / suspended / terminated | name + email | **`tier:"public"`** - identity only. Contact, terms, compliance and shared work nulled. `reason` names the status, `unlock` says they open when it becomes active |
| yes | none | name + email if reachable | **`tier:"public"`** - identity only, `unlock` says to request access |
| no | none | name + email if reachable | **403** with `error` / `reason` / `unlock`, rendered as an explanation, not a red error box |

## Field assignment

| Tier | Fields |
|---|---|
| **public** | `full_name`, `company_name`, `display_name`, `bio`, `location`, `company_website`, `company_linkedin_url`, `agency_type`, `avatar_url`, `company_logo_url`, `business_criteria`, `capabilities`, `work_examples`, `reel_url` |
| **partnership adds** | `email`, `meeting_url`, `payment_terms`, `payment_terms_custom`; `partnership.status` / `nda_confirmed_at` / `msa_confirmed_at` / `accepted_at`; `shared_projects`; `engagement_history` |
| **never** | anything about the agency's other vendors, clients, bids, or their private `partnership_notes` |

Greg's three categories map exactly: **public identity** is the public tier, **shared work**
is `shared_projects` + `engagement_history`, **compliance state of that relationship** is the
`partnership` block.

The NEVER tier needs no new mechanism. `shared_projects` is
`.eq("agency_id", agencyId)` under the `projects_partner_select_assigned` policy, which only
returns projects the caller is assigned to. `engagement_history` is
`.eq("partner_id", user.id).eq("agency_id", agencyId)`. `partnership_notes` was already
stripped on the vendor branch of `GET /api/partnerships`.

## Two tiers, not three - and why

The agency-to-vendor route has a `"none"` tier that falls back to the agency's **own** typed
record of the contact (`partnerships.contact_name`, `company_name`, `partner_email`). There
is no reciprocal: those columns describe the **vendor**, not the agency, and a vendor never
types anything about a lead agency. Below the public tier there is no honest fallback, so the
403 refusal carries the whole answer. Inventing a third tier here would have meant inventing
data.

## Judgment calls

- **`company_website`, not `website`.** Both columns exist on `profiles`. The agency profile
  editor writes `company_website`; `website` is empty on the live agency profile I inspected.
  `/api/marketplace/discoverable` also uses `company_website`.
- **`payment_terms` is partnership-tier.** Not named in Greg's three categories, but it is a
  commercial term of the relationship and the vendor needs it to invoice. It is the agency's
  own stated terms, not another vendor's.
- **`business_criteria` is public-tier**, matching the agency-to-vendor direction and
  `/api/marketplace/discoverable`, which already returns it to any authenticated caller.
- **`default_nda_url` deliberately excluded.** It is a private document URL, delivered
  through the RFP flow, not a profile fact.
- **The server payload replaces the caller's stub rather than merging under it.** A stub
  built from a partnership row carries an email the tier may not permit; merging would put it
  back on screen after the server had withheld it.

## Bonus: a live defect fixed in the mirrored route

While mirroring, I found the agency-to-vendor route's engagement-history projects query is
broken in production, and proved it read-only:

```
select=id,name,title  ->  {"code":"42703","message":"column projects.title does not exist"}
select=id,name        ->  [{"id":"8263f702-...","name":"April Test - Q3 Product Launch v3"}]
```

`projects` has `name` and no `title`. The whole query failed, and its fallback could not fire
because the guard required the string "name" to appear in an error message that reads "column
projects.title does not exist". So `projectMeta` was **always empty** and every engagement
history entry silently degraded its project name to the RFP payload's `projectName` or the
literal "Project".

Fixed, and the shared helpers moved to `lib/engagement-history.ts` so the two directions
cannot drift apart.

---

# Item 4: M1 preparation inventories

## 4a. Service role re-scoping plan

**24 files use `SUPABASE_SERVICE_ROLE_KEY`: 23 routes and one shared helper.** The discovery
doc counted 22; the delta is the admin flags route and the guest attach/file/upload routes
added since.

Ranked by what breaks **when a company has more than one member**, which is a different
ranking from the security one in `docs/organizations-m1-discovery.md` section 4.

### RANK 1 - CRITICAL: writes keyed to `auth.user.id` as if it were the company

These silently **fragment company data per member**. Member B imports a vendor; it lands
under B's uid; member A never sees it. No error, no warning.

| Route | What it does | Why service role | Scoped today by | Needs, under multi-member orgs |
|---|---|---|---|---|
| `app/api/agency/pool/add-partner/route.ts` | Manual "Add Vendor" - writes a ghost `partnerships` row | Writes `partnerships` rows for an invitee with no profile, which RLS cannot express | `importPartnerRows(service, auth.user.id, ...)` - the caller's uid becomes `agency_id` | Resolve the caller's **organization id** and pass that. Then verify the caller is a member of it |
| `app/api/agency/pool/import-spreadsheet/route.ts` | Batch vendor import, up to 2000 rows | Same | Same | Same. Highest blast radius - one bad import fragments 2000 rows |
| `app/api/agency/rfp/magic-link/route.ts` | Creates `rfp_magic_tokens`, sends vendor invitations | Writes token rows and reads invitee profiles across RLS | `.eq("agency_id", auth.userId)` in five places | Every one of those five becomes `.eq("agency_id", <org id>)` plus a membership assertion |
| `app/api/agency/email-scan/run/route.ts` | Scans a connected mailbox, writes candidate rows | Reads `email_connections` tokens, writes pool rows | `.eq("agency_id", agencyId)` where `agencyId = auth.userId` | Org id, **and** a decision: is a mailbox connection personal or company-wide? See the open question below |
| `app/api/agency/email-scan/import/route.ts` | Commits scan results into the pool | Same | `.eq("agency_id", agencyId)` | Org id + membership check |
| `app/api/brief/save/route.ts` | Saves a generated brief | Accepts a Bearer token as well as a cookie session | `userId` only | Decide whether a brief is personal or company-owned. Today it is personal by accident, not by design |

**Open question this ranking surfaces, not in the discovery doc's seven:** *is a connected
mailbox personal or company-wide?* `email_connections` is keyed `user_id` with an RLS policy
`user_id = auth.uid()`. Under an org model, either every member connects their own mailbox
(current behaviour, probably right) or the company shares one (needs a new column and a new
policy). This is an eighth judgment call and it is cheap to answer now.

### RANK 2 - HIGH: token-scoped writes that resolve a company through `agency_id`

| Route | What it does | Why service role | Scoped today by | Needs |
|---|---|---|---|---|
| `app/api/rfp/guest/[token]/route.ts` (808 lines) | The entire guest bid flow - reads the token, creates/links partnerships, accepts bids, emails the agency | The caller has **no session at all**. RLS cannot express "whoever holds this token" | `tokenRow.agency_id`, then `.eq("agency_id", agencyId)` throughout | `agency_id` becomes an org id. **Its two agency-email lookups break** - see 4b |
| `app/api/rfp/guest/[token]/attach-existing-account/route.ts` | Links a guest bid to an account that already exists | Reads a profile the caller may not be entitled to | Token + `auth.getUser()` + email match, re-verified server-side | Unchanged by orgs. Already correct |
| `app/api/partner/partnerships/claim/route.ts` | Claims email-matched partnership rows after signup | Updates rows whose `partner_id` is still null, which no RLS policy grants | `profiles.email` = the caller's | Unchanged on the agency side. If **vendors** also become organizations, this needs the same treatment mirrored |

### RANK 3 - MEDIUM: reads keyed to the caller as an individual

Correct today and correct under an org model **for the vendor side**, because these are
genuinely per-person. Listed so nobody "fixes" them by mistake.

| Route | Scoped by | Note |
|---|---|---|
| `app/api/partner/rfps/route.ts` | `.eq("partner_id", user.id)` + email match | If vendors become orgs too, this is the mirror-image of Rank 1 |
| `app/api/partner/rfps/bids/route.ts` | `.eq("partner_id", user.id)` | Same |
| `app/api/partner/projects/route.ts` | `.eq("partner_id", user.id)` | Same |
| `app/api/agency/email-connections/route.ts` | `.eq("user_id", auth.userId)` | See the mailbox question above |
| `app/api/agency/email-scan/route.ts` | `.eq("user_id", auth.userId)` | Same |

### RANK 4 - LOW: platform-level, unaffected by org membership

| Route | Gate | Note |
|---|---|---|
| `app/api/admin/users/route.ts` | `requireAdminRole()` before the service client is constructed | Lists every profile. Org-neutral |
| `app/api/admin/users/[userId]/flags/route.ts` | `requireAdminRole()`, plus a last-admin guard | The only way to write another user's profile, since `profiles` has no admin UPDATE policy |
| `app/api/admin/grant-access/route.ts` | HMAC token (24h, `timingSafeEqual`) on GET; token **and** admin session on POST | GET renders, POST writes. Org-neutral |

### RANK 5 - NONE: no company scoping exists or is needed

`app/api/auth/check-email/route.ts` (returns a bare boolean),
`app/api/contact/route.ts` (public lead capture),
`app/api/auth/google-email/callback/route.ts`,
`app/api/auth/microsoft-email/callback/route.ts` (OAuth token exchange, nonce-cookie bound),
`app/api/rfp/guest/file/route.ts`, `app/api/rfp/guest/upload/route.ts` (token-bound blob
proxying), `lib/server/account-existence.ts` (returns a bare boolean, never a row).

### The shape of the fix, once

Every Rank 1 and Rank 2 route needs the same two lines, and they should come from one helper
rather than being written 9 times:

```ts
// proposed: lib/server/org-scope.ts
const org = await resolveOrgForUser(user.id)      // the org id, not the uid
if (!org) return forbidden("No organization")     // fail closed
// then: .eq("agency_id", org.id) everywhere auth.user.id is used today
```

Build that helper **first**, in the same migration window as 078. Re-scoping the routes
one at a time without it guarantees that some of them disagree.

## 4b. Email recipient resolution audit

31 sites resolve a `profiles.email`. **20 are keyed to `user.id`** - the caller's own row -
and are unaffected by an org model as far as *identifying the actor* goes.

**11 are keyed to an `agency_id`. Every one of these breaks under an org model**, because
`SELECT email FROM profiles WHERE id = <organization id>` returns no row.

| # | Site | Keyed by | Failure mode today if `agency_id` were an org id |
|---|---|---|---|
| 1 | `app/api/partnerships/route.ts:823` | `partnership.agency_id` | **Silent.** `if (agencyProfile?.email)` is false, no email, no error. "Vendor accepted your invitation" never arrives |
| 2 | `app/api/partnerships/route.ts:874` | `partnership.agency_id` | **Silent.** Same guard |
| 3 | `app/api/projects/[id]/assignments/route.ts:270` | `assignment.partnership.agency_id` | **Silent.** `if (agencyUser?.email)`. RFP accepted/declined notice never arrives |
| 4 | `app/api/partner/projects/[projectId]/status-update/route.ts:220` | `project.agency_id` | **Silent.** `if (recipientEmail)`. Status-update notice never arrives |
| 5 | `app/api/partner/rfps/[id]/response/route.ts:372` | `inbox.agency_id` | **Silent.** Bid-revised notice never arrives |
| 6 | `app/api/rfp/guest/[token]/route.ts:540` | `tokenRow.agency_id` | **Silent.** `if (editAgencyProfile?.email)`. Guest bid-edit notice never arrives |
| 7 | `app/api/rfp/guest/[token]/route.ts:702` | `tokenRow.agency_id` | **Silent.** Guest bid-submitted notice never arrives |
| 8 | `app/api/partner/projects/[projectId]/active-engagement/route.ts:173` | `agencyId` | **Silent** |
| 9 | `app/api/partner/rfps/[id]/nda-notify/route.ts:68` | `inbox.agency_id` | **LOUD** - returns 500 "Agency email not found". The only one that fails visibly |
| 10 | `app/api/projects/[id]/partner/route.ts:91` | `project.agency_id` | Display only, not an email. Agency name/logo would blank out |
| 11 | `lib/server/partner-import-guard.ts:75` | `agencyId` | Not an email recipient. **Self-import detection stops working** - an agency could import its own domain as a vendor |

**Ten of eleven fail silently.** That is the real finding: under an org model, agency-facing
notifications would simply stop, with nothing in the logs and nothing in the UI.

**What each should resolve to** depends on the unruled org model, so nothing is fixed here.
The three candidate answers, for the ruling session:

- **(a) The org's billing/primary contact** - one address per organization. Simplest,
  needs a column on the organizations table.
- **(b) Every member of the org** - a fan-out. Correct for "your vendor accepted", noisy for
  everything else.
- **(c) The specific member who owns the object** - e.g. the project's creator. Most precise,
  needs a `created_by` on every object, which does not exist today.

My read: **(a) for M1**, with a `notification_email` on the organization defaulting to the
founding user's address, and **(b)** later behind a per-member preference. That keeps the
11 sites to a one-line change each. Whatever you choose, **write it as one helper** -
`resolveAgencyRecipient(orgId)` - and change all 11 to call it, so the twelfth site written
next year cannot invent a twelfth answer.

## 4c. Role backfill preparation

### Executed, read-only: accounts whose stored role contradicts signup metadata

Joined the GoTrue admin API (`raw_user_meta_data`) to `profiles`, read-only. 14 auth users,
14 profiles, none missing.

**7 of 14 contradict.** Every one chose `partner` at signup and is stored as `agency`.

| Email | Signup metadata `role` | `profiles.role` | `active_role` | Reads as |
|---|---|---|---|---|
| `mariannafayn@gmail.com` | `partner` | `agency` | `agency` | **in the wrong portal** |
| `victoriacaro91@gmail.com` | `partner` | `agency` | `agency` | **in the wrong portal** |
| `andrea@crescestudio.com` | `partner` | `agency` | `agency` | **in the wrong portal** |
| `marcusliwag@gmail.com` | `partner` | `agency` | `agency` | **in the wrong portal** |
| `gmarkant+partner23@gmail.com` | `partner` | `agency` | `partner` | self-corrected via switch-role |
| `info@ceoofgeo.com` | `partner` | `agency` | `partner` | self-corrected via switch-role |
| `gmarkant+partner70@gmail.com` | `partner` | `agency` | `partner` | self-corrected via switch-role |

The other 7 agree (`greg@`, `gmarkant@icloud.com`, `gmarkant@gmail.com`,
`gmarkant+partner22@`, `fredsqueo@`, `sbatty@thelab.co`, `gmarkant+partner71@`).

**The four in the top group are the ones to look at.** They signed up as vendors and have
been sitting in the agency portal ever since. Three of them are non-test, real addresses.

### The trigger fix

Authored as **`docs/proposed-migration-role-trigger.sql`**, deliberately **unnumbered** -
numbering it now would claim 078 and collide with Organizations M1. It:

- reads `NEW.raw_user_meta_data->>'role'`, accepting only `'partner'` or `'agency'` and
  defaulting to `'agency'`, so a malformed value behaves exactly as today;
- sets `secondary_role` to the **opposite** of the chosen role rather than always `'partner'`
  (a vendor-primary account whose `secondary_role` is also `'partner'` can never switch
  portals - `gmarkant+partner71@gmail.com` is in exactly that state today);
- adds the missing `SET search_path = public, pg_temp` to a `SECURITY DEFINER` function;
- **contains no backfill**, by design.

**Run A8 first.** The on-disk text of 056 is not proof of what the live function contains,
and the proposed file is `CREATE OR REPLACE`.

### The backfill, for you to run per account after ruling

**Do not run these wholesale.** Some of these seven may have legitimately become lead
agencies since signing up. One statement per account, each independently reversible.

Read-only check first, before any of them:

```sql
-- VERIFY FIRST. Expect 7 rows. If it returns a different number, stop.
SELECT id, email, role, active_role, secondary_role
FROM profiles
WHERE email IN (
  'mariannafayn@gmail.com','victoriacaro91@gmail.com','andrea@crescestudio.com',
  'marcusliwag@gmail.com','gmarkant+partner23@gmail.com','info@ceoofgeo.com',
  'gmarkant+partner70@gmail.com'
)
ORDER BY email;
```

Then, one at a time, only for the accounts you decide are genuinely vendors:

```sql
-- A. The four still sitting in the agency portal. Moves both role and active_role.
UPDATE profiles SET role='partner', active_role='partner', secondary_role='agency'
  WHERE email='mariannafayn@gmail.com'   AND role='agency';   -- expect: UPDATE 1
UPDATE profiles SET role='partner', active_role='partner', secondary_role='agency'
  WHERE email='victoriacaro91@gmail.com' AND role='agency';   -- expect: UPDATE 1
UPDATE profiles SET role='partner', active_role='partner', secondary_role='agency'
  WHERE email='andrea@crescestudio.com'  AND role='agency';   -- expect: UPDATE 1
UPDATE profiles SET role='partner', active_role='partner', secondary_role='agency'
  WHERE email='marcusliwag@gmail.com'    AND role='agency';   -- expect: UPDATE 1

-- B. The three that already self-corrected active_role. Aligns the base role only;
--    active_role is already 'partner' and must not be disturbed.
UPDATE profiles SET role='partner', secondary_role='agency'
  WHERE email='gmarkant+partner23@gmail.com' AND role='agency'; -- expect: UPDATE 1
UPDATE profiles SET role='partner', secondary_role='agency'
  WHERE email='info@ceoofgeo.com'            AND role='agency'; -- expect: UPDATE 1
UPDATE profiles SET role='partner', secondary_role='agency'
  WHERE email='gmarkant+partner70@gmail.com' AND role='agency'; -- expect: UPDATE 1
```

The `AND role='agency'` clause makes each statement idempotent and makes a wrong assumption
show up as `UPDATE 0` rather than as a silent overwrite.

**Blast radius, checked:** moving an account to `role='partner'` changes which branch it
takes in every route audited during the invitation run. All of those now test
`role || active_role`, so an account with `active_role='partner'` behaves identically before
and after. The four in group A change portal on next login, which is the point.

### Partial answer to A6, incidentally

`profiles.linked_agency_id` **exists** and is **null** on the agency profile I inspected.
Full A6 still worth running - it needs the count across all 14 rows, which I did not take.

## 4d. The two queries that gate your rulings

Both already executed - results in "When you are back". Reproduced paste-ready so you can
re-confirm at migration time, with truncation guards per the 100-row rule.

### A5 - does every `agency_id` correspond to a real profile?

*Decides: whether Option C ("the org id equals the founding user's uid") works at all. Any
non-zero count means some `agency_id` is not a real user id and the backfill would leave
orphans. **Answered 2026-08-14: every row 0. Option C is viable.***

The `UNION ALL` returns one row per table, so the 100-row truncation cannot bite - but the
final sentinel row makes truncation detectable anyway. **If you do not see
`zz_TOTAL_TABLES_CHECKED = 15`, the output was truncated and nothing above it is
trustworthy.**

```sql
SELECT 'projects' AS t, count(*) AS orphans FROM projects x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'partnerships', count(*) FROM partnerships x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'clients', count(*) FROM clients x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'bid_scoring_criteria', count(*) FROM bid_scoring_criteria x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'bid_scoring_templates', count(*) FROM bid_scoring_templates x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'bid_evaluations', count(*) FROM bid_evaluations x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'bid_decompositions', count(*) FROM bid_decompositions x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'bid_comparisons', count(*) FROM bid_comparisons x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'delivery_reviews', count(*) FROM delivery_reviews x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'usage_tracking', count(*) FROM usage_tracking x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'agency_library_documents', count(*) FROM agency_library_documents x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'client_cash_flow', count(*) FROM client_cash_flow x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'rfp_magic_tokens', count(*) FROM rfp_magic_tokens x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'partner_rfp_inbox', count(*) FROM partner_rfp_inbox x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'partner_rfp_responses', count(*) FROM partner_rfp_responses x
  WHERE x.agency_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles f WHERE f.id = x.agency_id)
UNION ALL SELECT 'zz_TOTAL_TABLES_CHECKED', 15
ORDER BY 1;
```

**Every row must read 0**, and the sentinel must read 15.

**What its answer decides:** all zeros → **Option C is on the table**, and the backfill is
`organization_id = <founding user's uid>` with no orphan handling. Any non-zero → Option C is
**dead**, and the model must mint fresh organization ids with a mapping table.

### A9 - are there already multiple profiles sharing one company name?

*Decides: whether the backfill has a merge problem. Two profiles sharing a company name today
would each become their own organization, which is probably not what either wants.
**Answered 2026-08-14: zero collisions. No merge decision needed.***

Run **both** statements. The second is the truncation guard: if the first returns 100 rows,
compare against the second before trusting it.

```sql
-- 1. The collisions themselves.
SELECT lower(trim(company_name)) AS company,
       count(*)                  AS profile_count,
       array_agg(email ORDER BY created_at) AS emails
FROM profiles
WHERE company_name IS NOT NULL AND trim(company_name) <> ''
GROUP BY 1
HAVING count(*) > 1
ORDER BY profile_count DESC, company ASC;

-- 2. TRUNCATION GUARD. Run this too. If (1) returned exactly 100 rows and this says more
--    than 100, (1) was silently truncated.
SELECT count(*) AS colliding_company_names
FROM (
  SELECT lower(trim(company_name))
  FROM profiles
  WHERE company_name IS NOT NULL AND trim(company_name) <> ''
  GROUP BY 1 HAVING count(*) > 1
) s;

-- 3. Context: how many profiles have no company name at all. These become organizations
--    with a blank name under any backfill and need a display fallback.
SELECT count(*) FILTER (WHERE company_name IS NULL OR trim(company_name) = '') AS no_company_name,
       count(*)                                                                AS total_profiles
FROM profiles;
```

**What its answer decides:** zero rows → the backfill is one organization per profile, no
merge logic, and you can ship it. Any rows → you must decide, **per colliding company**,
whether to merge those profiles into one organization during the backfill or leave them
separate and let the users merge themselves. As of 2026-08-14 this is zero rows and query 3
returns `no_company_name = 0, total_profiles = 14`.

---

# Other SQL for Greg

Read-only verification first in every case. Each statement labelled.

### V1. Re-confirm the role contradictions before backfilling (READ-ONLY)

```sql
-- Expect 7 rows. This is the same join I ran, expressed in SQL rather than via the admin API.
SELECT p.email,
       u.raw_user_meta_data->>'role' AS signup_role,
       p.role, p.active_role, p.secondary_role
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE u.raw_user_meta_data->>'role' IS DISTINCT FROM p.role
ORDER BY p.email;
```

### V2. The live `handle_new_user` body - A8, still unanswered (READ-ONLY)

```sql
SELECT p.proname, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
```

Diff against `supabase/migrations/056_default_dual_role_access.sql` **before** running
`docs/proposed-migration-role-trigger.sql`, which is `CREATE OR REPLACE`.

### V3. Finish A6 - `linked_agency_id` (READ-ONLY)

```sql
SELECT count(*) AS total, count(linked_agency_id) AS with_linked_agency FROM profiles;
```

I saw the column exists and is null on one row. This gives the count across all 14.

### V4. The three duplicate `payment_milestones` partner policies (READ-ONLY)

```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname='public' AND tablename='payment_milestones' AND cmd='SELECT'
ORDER BY policyname;
```

Expect three. Only "Partners read payment milestones for their partnerships" is on disk. **Do
not drop the other two without reading `docs/schema-baseline-2026-08-13.sql` first** - they
are near-identical, so dropping the wrong one is invisible until a vendor loses access.

### V5. Re-take the snapshot after any policy change (READ-ONLY, split per the 100-row rule)

```sql
-- Run BOTH halves and concatenate. Confirm the row counts sum to the total from part 3.
-- Part 1
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename < 'projects'
ORDER BY tablename, policyname;
-- Part 2
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename >= 'projects'
ORDER BY tablename, policyname;
-- Part 3: the count both halves must sum to. Was 104 on 2026-08-13.
SELECT count(*) AS total_policies FROM pg_policies WHERE schemaname='public';
```

**No write SQL is proposed anywhere in this report except the 4c backfill**, which is
explicitly per-account and gated on a read-only verification.

---

# Judgment calls taken

1. **Dropped the invitee-role check rather than reporting options.** The previous run called
   it a product ruling. I disagree on evidence: the alternative predicate rejects the one
   unambiguous vendor in the system, every other candidate accepts all 14 accounts, and the
   check was already absent from the majority path. A ruling needs a choice that changes
   something; this one had none. Reversible in one commit.
2. **Did not touch the AI entitlement gates.** Genuinely a billing ruling, and measurably not
   urgent - nobody is denied today.
3. **Included `payment_terms` in the vendor's partnership tier** though Greg's ruling named
   only identity, shared work and compliance. It is a commercial term of the relationship and
   the vendor needs it to invoice. One line to remove.
4. **Two tiers on the vendor side, not three.** The `"none"` tier has no reciprocal because a
   vendor never types their own record of an agency. Inventing one would mean inventing data.
5. **Fixed the `projects.title` defect in the mirrored route** rather than mirroring it. It
   is a live bug in the exact file Item 3 was told to mirror, proven by curl, and leaving it
   would have meant two routes where one silently degrades.
6. **Hoisted the engagement-history helpers to `lib/engagement-history.ts`** instead of
   copying ~40 lines into the new route. One definition per thing.
7. **Used `formatDateTime` in the new UI, not `formatDate`.** `CLAUDE.md` says to use
   `formatDate()` from `lib/utils.ts`; **it does not exist there.** Two local copies exist in
   other files. Rather than add a third, I used the one real shared helper. Flagging the doc
   error rather than fixing `CLAUDE.md` in a run that was not asked to.
8. **Used the GoTrue admin API for the role comparison.** PostgREST cannot reach the `auth`
   schema and there is no local `psql` or Postgres password. The admin API is read-only here
   and let me execute a check the brief expected to be handed over as SQL. The SQL is
   supplied anyway (V1).
9. **Reverted `next-env.d.ts`**, which `pnpm dev` rewrote as a side effect of the curl
   verification. Build artifact churn, not a change.

# Not done, and why

- **The Organizations model.** Explicitly out of scope, seven judgment calls unruled.
- **Nothing authored into 078 or 079.** Reserved.
- **No migration applied, no write query run, no table dropped, no role backfilled, no email
  sent, no invitation triggered.**
- **No renumbering or reorganisation of migration files.** Recommended an approach in
  `docs/schema-truth.md` section 7 instead.
- **Column-level schema truth.** `docs/schema-baseline-2026-08-13.sql` covers policies only.
  Columns, types, indexes, constraints, triggers and grants are captured nowhere, and the
  snapshot does not contain them. `pg_dump --schema-only` is the honest fix when you want it.
- **Storage bucket policies.** The snapshot is `schemaname='public'` only; the `avatars`
  bucket's policies live in `storage.objects` and are unreconciled.
- **The 11 email recipient sites.** Correct answer depends on the unruled org model, per the
  brief.
- **`app/api/upload/route.ts`'s no-op gate.** Reported, not changed - it is part of the same
  P13 ruling.
- **The eighth judgment call I found** (is a connected mailbox personal or company-wide?) is
  reported in 4a, not answered.

---

# Honest verification statement

## Executed by me, in this run

| Check | How | Result |
|---|---|---|
| `npx tsc --noEmit` | before each of the four commits | exit 0 every time |
| `pnpm build` | before each of the four commits | exit 0 every time |
| Markdown link corruption sweep | `grep -rl "](http://" app/ lib/` | no matches |
| Policy reconciliation | parsed the snapshot CSV (104 rows after dedupe) and every `CREATE POLICY` in `supabase/migrations/` + `scripts/` (96 statements), joined on (table, name) | 61 / 28 / 15 |
| Predicate drift on the 61 name matches | normalized both sides, compared | 19 textual differences, all cosmetic; 0 semantic |
| `projects.title` does not exist | `curl` PostgREST: `select=id,name,title` vs `select=id,name` | 42703, then rows. **Proven** |
| Invitee-role predicate, all 14 accounts | evaluated in Python against live `profiles` | rejects 12, accepts 2 |
| `secondary_role='partner'` alternative | same | rejects `gmarkant@icloud.com` |
| All 7 entitlement gates, all 14 accounts | same | only `sbatty@thelab.co` broadly denied |
| Signup metadata vs stored role | GoTrue admin API joined to `profiles`, read-only | 7 of 14 contradict |
| **A5** | PostgREST, 15 tables, `content-range` recorded per table | **0 orphans**, 196 rows, no truncation |
| **A9** | PostgREST, all 14 profiles | **0 collisions**, 0 blank company names |
| New route reachable and auth-gated | `curl -i http://localhost:3000/api/partner/network/<uuid>` unauthenticated | **401**, identical to the mirrored route as a control |
| Route registered in the build | build output | `ƒ /api/partner/network/[agencyId]` |

## NOT executed - needs a live click

- **The tier logic itself.** Producing a logged-in vendor session requires credentials I do
  not have, so I proved the auth gate and the route registration from the terminal but
  **not** what `tier:"partnership"` versus `tier:"public"` returns for a real session. That
  is checklist steps 4 to 9 below.
- **The invitation fix.** Proving it end to end means calling `POST /api/partnerships`, which
  **sends a real invitation email**. The brief forbids that. It is verified by the predicate
  evaluation above plus tsc and build; the live proof is checklist step 1.
- **Anything about the live `handle_new_user` trigger.** I read migration 056's text, which
  `docs/schema-truth.md` explicitly says is not evidence. A8 (V2 above) is unrun.
- **`docs/proposed-migration-role-trigger.sql` has never been executed** anywhere.
- **The 104 policies are transcribed from the 2026-08-13 snapshot, not re-queried.** If
  anything changed in production since, the baseline is stale by exactly that much.

I have not written "verified" against anything in this document that I did not run.

---

# Live checklist, in click order

Only Items 2 and 3 changed behaviour. Nothing here requires a migration.

### A. The invitation fix (Item 2)

1. As `gmarkant@gmail.com`, go to **/agency/pool**. Find `info@ceoofgeo.com` in the Invited or
   Discovered column and re-invite them. **Before:** 400 "Can only invite partner agencies,
   not lead agencies". **Expect now:** it succeeds. *This sends a real email to
   `info@ceoofgeo.com` - if that is not wanted, use a `gmarkant+partnerNN@gmail.com` address
   that already has a profile instead.*
2. Invite a brand-new address that has no profile. **Expect:** unchanged, still works. This is
   the path the check never touched.
3. From the marketplace, invite a discoverable vendor (`gmarkant@icloud.com`). **Expect:**
   succeeds. **Before:** would have succeeded too, since that account is `role='partner'` -
   this one is a regression check, not a fix check.

### B. The vendor's view of a lead agency (Item 3)

Sign in as `gmarkant@icloud.com` (vendor, active partnership `c0851865-...` with
`gmarkant@gmail.com`).

4. Go to **/partner/network**, "My Agencies" tab. Open the profile for the partnered agency.
   **Expect:** company name, bio, location, website, LinkedIn, agency type, logo, capabilities
   - none of which appeared before.
5. Same modal: a **Partnership Status** block showing status `active`, partnered-since date,
   NDA state, MSA state, and payment terms (`NET 30` for `gmarkant@gmail.com`).
6. Same modal: **Shared Projects**, listing only projects of *that* agency you are assigned to.
7. Same modal: **Work Awarded To You**, if any bid from that agency was awarded.
8. Same modal: **Contact** shows the agency's email, plus a "Book a meeting" link
   (`gmarkant@gmail.com` has a `meeting_url`).
9. **Confirm no "Limited View" panel appears** at this tier.

Then the lower tiers:

10. Open a **pending** agency partnership from the Invitations tab. **Expect:** identity
    fields still render, but **no** Partnership Status block, **no** Shared Projects, **no**
    Work Awarded, **no** email, and a **Limited View** panel naming the pending status and
    saying what opens it.
11. Go to the **Discover** tab and open any agency you have no partnership with. **Expect:**
    public identity plus the Limited View panel telling you to request access.
12. **The refusal cell.** Open an agency that is `is_discoverable=false` and has no
    partnership with you. **Expect:** "This agency's profile is private", a reason, and an
    unlock line - **rendered as an explanation, not a red error box, and never a blank
    modal.** *This cell is hard to reach from the UI, because Discover only lists
    discoverable agencies. Easiest check: open dev tools and hit
    `/api/partner/network/<a non-discoverable agency uuid>` directly and confirm a 403 with
    `error`, `reason` and `unlock` in the body.*

### C. The mirrored route did not regress (Item 3's bonus fix)

13. Sign back in as `gmarkant@gmail.com`. Go to **/agency/pool/<partnerId>** for a vendor with
    an awarded bid. **Expect:** the Engagement History entries now show the **real project
    name** rather than the generic "Project" fallback. This is the `projects.title` fix.
14. Confirm the rest of that page is unchanged - tiers, rate card, notes, NDA/MSA badges.

### D. Nothing else moved

15. **/agency/pool** three columns render as before.
16. **/partner/rfps** loads and lists invitations as before.
17. Switch roles both ways via the portal toggle and confirm both portals still load.
