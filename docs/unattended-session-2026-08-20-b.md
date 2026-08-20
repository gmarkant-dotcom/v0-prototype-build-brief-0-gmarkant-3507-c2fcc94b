# Unattended session 2026-08-20 (b)

Seven items, worked in order. **Five committed, two report-only as instructed, plus the two
report-only halves of items 1 and 7.** No database was written to and no migration was
applied. No `git push`.

---

## Preconditions

| Check | Required | Found |
|---|---|---|
| HEAD | `d236a3b` | `d236a3b` ✓ |
| Tree clean | yes | one modified file, `next-env.d.ts` — see below |
| `d236a3b` on `origin/main` | verify | **YES, it is pushed.** `git ls-remote origin main` returns `d236a3b04d…`, identical to local. Nothing outstanding. |

**`next-env.d.ts`** was modified in the working tree at session start: `.next/types/routes.d.ts`
→ `.next/dev/types/routes.d.ts`. That is `next dev` rewriting a generated file; the first
`pnpm build` rewrote it back and the tree has been clean since. Not mine, not committed, and
it will flip again the next time the dev server runs.

### Gates at the stated baseline — all eight matched exactly

| Gate | Baseline | Found |
|---|---|---|
| `npx tsc --noEmit` | 0 | 0 ✓ |
| `pnpm build` | 0 | 0 ✓ |
| `pnpm lint` | 1, 182 problems (154 errors, 28 warnings) | 1, 182 (154, 28) ✓ |
| `pnpm verify-rls` | 2 | 2 ✓ |
| `pnpm policy-audit:guard` | 1 | 1 ✓ |
| `pnpm identity-columns:guard` | 0 | 0 ✓ |
| `pnpm embed-targets` | 0 | 0 ✓ |
| `pnpm org-id-reads:guard` | 0, Class A 14, Class B 61 | 0, A 14, B 61 ✓ |

Nothing differed, so I proceeded. **No gate moved during the session** and no allow-list was
touched. All eight were re-run and re-confirmed before each of the five commits.

---

## 1a. The seven emitters — WRITTEN

Commit `4bfd2e2`. `milestone_events` goes from **6 of 23** whitelisted types emitting to **13**.

Every one sits at the route that already performs the act, **after** that act has committed,
and none can change its result: `recordMilestone` / `recordMilestones` filter unusable events,
catch everything, and return `void`. Three of the seven additionally sit inside a `try/catch`
that was already there and already swallowed.

None of the seven is in `UNION_REPLACING_EVENT_TYPES`, so `milestoneDedupeKey` returns `null`
for all of them and **not one can dedupe a derived union line away.** They are purely
additive. Subjects were chosen so the feed resolves a project name and a project href —
`"project"` everywhere except `vendor.invite_resend`, which shares the `"partnership"` subject
`vendor.invite` already uses at `app/api/partnerships/route.ts:754`.

### What a vendor reading that row would see — one line each

| Event | What the vendor sees |
|---|---|
| `vendor.invite_resend` | "Dana Whitfield resent the invitation to Acme Post" — plus, in the payload, **their own email address** and whether **their own address** already has a Ligament account. Both facts were in the email they just received; the second is exactly what its CTA revealed. Nothing about any other vendor. |
| `rfp.magic_link_send` | "Dana Whitfield sent an RFP link for Key Art" — plus **their own** recipient email, the scope title they were sent, and **their own** response deadline. **The magic-link token is deliberately absent**: it is a bearer credential for this RFP and a payload is counterparty-readable in full. |
| `rfp.deadline_set` | "Dana Whitfield set the deadline for Key Art" — plus **their own** new deadline, and `previous_response_deadline: null`, which is the honest value for a first set rather than a placeholder. |
| `rfp.deadline_change` | "Dana Whitfield changed the deadline for Key Art" — plus **their own** new deadline **and the old one it replaced**. Per your ruling the old deadline is theirs to see; who else the change touched is not, and this route sends to exactly one vendor per call, so no such figure exists here to leak. |
| `onboarding.package_send` | "Dana Whitfield sent the onboarding package to Acme Post" — plus the package id, **how many documents went to them**, and **which kickoff mode they were offered**. All three were already in the email they received. `custom_message` is left out: agency prose, and they were sent it verbatim. |
| `onboarding.deploy` | "Dana Whitfield deployed onboarding for Northwind Rebrand" — plus the deployment id, **their own** document count, and whether an NDA or an SOW was raised **for them**. All visible to them in their own onboarding tab. |
| `status_update.resolve` | "Dana Whitfield resolved a status update on Northwind Rebrand" — plus which of **their own** status updates was resolved and when. `notes` is left out: it can carry the `[Agency override]` text this same route writes on POST, which is the agency's annotation and is not sent to the vendor anywhere else. |

In every case the acting person is named and the rest of the agency team's contact details are
not — which is the whole point of the attribution model.

### Three things worth knowing about how they were wired

**`rfp.deadline_change` closes the destructive deadline path that 080's header called out.**
The magic-link upsert writes `response_deadline` unconditionally, so a resend carrying a new
date replaced the old one with nothing recording what it was or who changed it. The old value
is now captured as `previous_response_deadline`. It is read by a **separate, best-effort
query**, not by widening the load-bearing `existingToken` select — that select decides whether
a live token is reused, and adding a column to it would let a missing column fail a real
invitation for the sake of a breadcrumb. When the read fails, **no deadline event is emitted at
all**; a guessed one would be worse than a missing one. The query is skipped entirely when
there is no prior row, which is every first send.

**`markPartnershipInvited` now returns the row it stamped** (`{ partnershipId, vendorOrgId }`
instead of `void`). `partnership_id` is the only thing that makes a milestone reachable by the
vendor it is about, and returning it from the function that just wrote the row beats a second
lookup that could resolve a *different* row. `vendorOrgId` is read off the column, never from
the caller's `partnerId` argument — the email-keyed lookup can find a ghost with
`vendor_org_id` null even when a `partnerId` was passed, and reporting the guess is how a
milestone ends up naming an organization the partnership does not.

**`rfp.magic_link_send` is the first emit in the product to run on a service client.** That
route is service-role throughout, so migration 080's INSERT policy does not evaluate — the
checks at the top of the file *are* the permission, exactly as the 079 note already on that
route says for every other write it makes. The row is still correct on the way out: `org_id` is
the caller's own organization, so the team's SELECT policy matches, and `partnership_id` is
what the counterparty policy reads. This is stated in a comment at the call site, and it is
also the mechanism item 6 below turns on.

---

## 1b. The three held for a ruling — REPORT ONLY, NOT WRITTEN

All three are in `app/api/agency/rfp-responses/[id]/route.ts` unless stated.

**Confirmed, as you noted:** the shortlist transition is handled at **`:232-234`** and
`meeting_requested` at **`:235-237`** (the report's `:156-157` / `:159-161` predate the current
file; the two-line shape is unchanged). Neither has an emitter. Neither has a capability check
either, though `bid.shortlist` and `bid.meeting_request` are both declared in
`CAPABILITY_MINIMUM_ROLE` (`lib/capabilities.ts:140-141`, both `"member"`). The route gates and
instruments **exactly the three transitions that also send mail** — `bid.award` (`:201`),
`bid.decline` (`:204`), `bid.feedback` (`:210`) — and nothing else. Shortlist and meeting
request are unmetered on both axes.

I did not add the capability checks either. Adding a gate is a behaviour change on a live
route and it is your call, not a side effect of an emitter task.

### (i) `bid.shortlist`

- **Route/line:** `app/api/agency/rfp-responses/[id]/route.ts`, emit would go after the patch
  is written, guarded by the existing `existing.status !== "shortlisted" && nextStatus === "shortlisted"` at `:232`.
- **`org_id`:** `orgIdFromColumn(existing.lead_org_id)` — fetched at `:149-154` under
  `.in("lead_org_id", callerOrgIds)`, so provably one of the caller's own organizations. Same
  argument `bid.award` makes at `:960`.
- **`vendor_org_id`:** `orgIdFromColumn(existing.vendor_org_id)`.
- **`partnership_id`:** from the inbox row where one exists; **`resolveGuestBidContext()`
  (`:58`) for the guest shape**, which is the common one — `inbox_item_id` is null on eight
  response rows and that helper is the only thing that resolves a partnership for them.
- **`subject_id`:** the **response id** (`id`), `subject_type: "bid"` — identical to
  `bid.award`, `bid.decline` and `bid.feedback`.
- **Proposed payload:** `{ scope_item_name: <resolved or null> }` **and nothing else.**
- **What a vendor would see:** "Dana Whitfield shortlisted a bid on Key Art."
- **The leak class, and what I am NOT proposing:** no count. Not `shortlisted_count`, not
  "3 of 11", not a position. How many vendors made the shortlist is the size of the field they
  are competing against — the same class as the `recipient_count` finding closed on 2026-08-20,
  and the agency does not tell them that anywhere else.

### (ii) `bid.meeting_request`

- **Route/line:** same file, the branch at `:235-237`.
- **Parameters:** identical to (i) in all four — `existing.lead_org_id`,
  `existing.vendor_org_id`, the inbox-or-`resolveGuestBidContext()` partnership, and the
  response id as `subject_id` under `subject_type: "bid"`.
- **Proposed payload:** `{ scope_item_name: <resolved or null> }`.
- **What a vendor would see:** "Dana Whitfield requested a meeting about Key Art."
- **The leak class:** same as (i). A meeting request is per-vendor, so the temptation is
  smaller, but "how many vendors were asked to meet" is the same competitor-field disclosure
  and must not be derived into the payload either.

### (iii) `payment.mark_paid`

This one is **not ready to write, for a reason beyond the payload**, and it is the substantive
finding of 1b.

- **Route/line:** `app/api/agency/msa/milestones/route.ts` **PATCH**. The mark-paid branch is
  `:585-586` (`updates.status = 'paid'`, `updates.paid_at = now()`); the update itself is
  `:592-598`.
- **BLOCKER 1 — the route cannot tell a transition from a repeat.** The pre-read at `:556-561`
  selects **`id` only**. There is no prior `status` in hand, so an emitter here would fire on
  *every* PATCH that sets status `paid`, including a re-save of an already-paid milestone.
  Every other emitter in the product fires once, on the transition, using a `wasX` boolean read
  before the write. Fixing this means widening that select to `.select("id, status")` — a
  change to the observed action's query, which is exactly what the standing rule says an
  emitter may not do unilaterally.
- **BLOCKER 2 — there is no `writeOrgId` on this route.** It resolves `callerOrgIds` and a list
  of `agencyProjectIds`, and nothing else. `org_id` would have to come from the project, which
  means widening `:543-546` from `.select("id")` to `.select("id, org_id")` and building a map.
  Cheap, but again a change to the acting query.
- **`vendor_org_id`:** not available either. It needs a `partnerships` lookup keyed on
  `row.partnership_id`; the GET half of this route already does one at `:237-240`, the PATCH
  half does not.
- **`partnership_id`:** `row.partnership_id`, returned by the update's `.select()` at `:597`.
  This is the one parameter available today.
- **`subject_id`:** the payment milestone id, `subject_type: "payment_milestone"` — already in
  the `MilestoneSubjectType` union and used by nothing yet.
- **Proposed payload:** `{ amount: <row.amount>, currency: <row.currency>, paid_at }`.
- **What a vendor would see:** "Dana Whitfield marked a payment milestone paid" — plus **their
  own** amount, currency and payment date. `payment.mark_paid` renders through
  `lib/activity-feed.ts:332` as "marked a payment milestone paid for {vendor}".
- **The leak class:** the amount **is theirs** and may be shown. What must never appear is any
  cross-vendor or project-level total — `total_paid`, `total_outstanding` and
  `total_milestones_amount` are all computed in the GET half of this same file at `:364-366`
  and are sitting right there. A project's total paid across all vendors tells one vendor what
  the others are being paid.

**My recommendation on (iii):** rule on the payload, but ship the two select widenings as an
ordinary fix *first*, in their own commit, and add the emitter after. Bundling a query change
into an emitter commit is how "the emitter changed the action" happens.

---

## 2. The multi-scope broadcast count — IMPLEMENTED

Commit `d282ac2`. Your recommendation as accepted: **no `batch_id`, no migration, no emitter
change — count distinct vendors in `lib/activity-feed.ts`.**

The cause, confirmed in source: `app/api/agency/broadcast-rfp/route.ts` builds `rows` by
iterating **scope items × recipients**, and the whole broadcast is a single `.insert()` —
one statement, one transaction, one `created_at` — so all sixty rows land in a single group.
`recipients()` counted the group's rows.

`vendorIdentity()` keys each row on `vendor_org_id`, then `partnership_id`, then
`payload.recipient_email`, then the row id. **The email step is not optional:** the manual-email
broadcast path (`:373-380`) writes rows with *both* ids null for an address with no Ligament
account, so without it every ghost in a broadcast would collapse to one identity and the line
would read "to 1 vendor" — worse than the over-count it replaces.

Reading a second payload key is bounded and stays inside the module: the address is hashed into
a `Set`, counted, and discarded. It never reaches `PredicateInput`, `ActivityItem`, or the
wire, so the file header's no-passthrough rule holds. `ActivityItem.count` is now the recipient
count too, so the field and the rendered text cannot disagree.

**Verified by executing the compiled module, not by reading it:**

| Case | Rows | Renders |
|---|---|---|
| 3 scopes × 20 pool vendors | 60 | `to 20 vendors` — **was `to 60 vendors`** |
| **1 scope × 20 pool vendors** | 20 | **`to 20 vendors` — UNCHANGED** ✓ |
| **1 scope × 1 vendor** | 1 | **no suffix — UNCHANGED** ✓ |
| 3 scopes × 20 ghost emails | 60 | `to 20 vendors` |
| 2 scopes × (10 pool + 10 ghost) | 40 | `to 20 vendors` |
| fetch-ceiling overflow | 5 @ limit 5 | group marked partial, renders `N+` ✓ |

**The single-scope line is unchanged, as required** — for one scope item there is exactly one
row per vendor, so distinct vendors and rows are the same number.

Known and accepted, stated in the code: one vendor reached *both* through the pool path *and*,
in the same broadcast, as a manual address that did not resolve to their organization would
count twice. That needs a duplicate recipient in one request and over-counts by one, not by a
factor of the scope count.

---

## 3. `partnerships.company_name` — REPORT ONLY. No fix, and none needed.

**The premise that it is unnormalized is not borne out.** The importer normalizes with
`str()` (`lib/server/partner-pool-import.ts:124-127`): trim, empty → null. `normalizeCompanyName`
(`lib/company-identity.ts:128-132`) is trim, empty → null. **They are behaviourally identical.**
There is nothing to normalize.

**What writes it — exactly one function, two callers.** `importPartnerRows`, at
`lib/server/partner-pool-import.ts:304` (insert) and `:278` (patch). Reached only by
`app/api/agency/pool/add-partner/route.ts` (the manual Add Partner modal) and
`app/api/agency/pool/import-spreadsheet/route.ts`. A grep for `company_name:` as a write key
across `app/`, `lib/` and `components/` returns no other writer against `partnerships`. The
patch is additionally **fill-only** — `if (!existing.company_name && row.companyName)` — so it
never overwrites a value already there, and `status` / `profile_status` / `vendor_org_id` never
change on that path.

**What reads it — three sites, every one a fallback *behind* the organization name.**

- `app/agency/pool/page.tsx:1957` — `partnerCompany || partnerName || companyName || …`. The
  profile/organization name wins.
- `app/api/agency/pool/[partnerId]/route.ts:240` — used **only** when `showsProfile` is false,
  i.e. the `"none"` tier, where the vendor's own profile is deliberately withheld.
- `lib/server/partner-pool-import.ts:211` — read by the importer itself, to decide not to
  overwrite.

**Can it drift from `organizations.name`?** It can **differ**, and that is correct rather than a
defect. It is not a mirror of anything: it is **one lead agency's private typed record of a
contact they cannot yet see**, per partnership. Two agencies who both import "Acme Post" keep
their own strings and are entitled to. It **cannot drift in the harmful sense**, because no
reader ever prefers it over `organizations.name` — once the vendor claims their account
`vendor_org_id` is set, `showsProfile` becomes true, and every surface reads the organization.
The ghost column goes inert. The `"none"`-tier use at `:240` is a **privacy feature**, not a
stale read: showing the organization name there would disclose a non-discoverable vendor's
identity, which is the exact thing that tier exists to withhold.

**Should it route through `lib/company-identity.ts`? No — it would be a category error.**
`saveCompanyIdentity()` reconciles *the caller's own* company across `organizations.name` and
its `profiles.company_name` mirror, keyed to a user id from `auth.getUser()`, deriving the
organization from `org_members` on every call. `partnerships.company_name` is a note about a
**counterparty**, on a row that by definition has no resolved organization yet. Routing it
through that function would require writing another organization's name, which is precisely
what the module's signature is shaped to make impossible. And `normalizeCompanyName` is already
matched behaviourally by `str()`, which also serves `contactName` / `phone` / `website` /
`notes` on the same row — swapping one of the five for a company-identity import would couple a
ghost-column importer to the wrong module for no behavioural gain.

**Unambiguous answer: leave it alone.** No ruling needed.

---

## 4. Migration 073 — AUTHORED, NOT APPLIED

Commit `eebb7a3`. Nothing was executed against any database.

| | File | Lines | `BEGIN;` | `COMMIT;` |
|---|---|---|---|---|
| Up | `supabase/migrations/073_delivery_review_sharing.sql` | **473** | **265** | **381** |
| Down | `supabase/migrations/073_delivery_review_sharing_down.sql` | **153** | **82** | **119** |

**Exactly one executable occurrence of each word in each file**, verified by
`grep -n '^BEGIN;$'` and `grep -n '^COMMIT;$'`, so the COMMIT-to-ROLLBACK dry run genuinely
works. This is called out in both headers because 086 shipped with no transaction control at
all and that same swap silently did nothing.

**What it does**

```
delivery_reviews.shared_with_vendor    boolean NOT NULL DEFAULT false
delivery_reviews.shared_with_vendor_at timestamptz
delivery_reviews.shared_with_vendor_by uuid -> profiles(id) ON DELETE SET NULL
delivery_reviews_vendor_shared_idx     partial, on the vendor read predicate
"Partners view own complete delivery reviews" -> "Partners view own shared delivery reviews"
partnerships.reliability_summary / _generated_at  cleared
```

**Default private**, and it is a deliberate removal of an existing disclosure. Today
`status = 'complete'` is the entire gate, so *finishing* a review publishes it — workflow state
and disclosure decision carried by one column. RLS is row level, so a vendor who reads the row
also reads `on_time_notes`, `on_budget_notes`, `client_feedback` and `ai_delta_summary`, which
066's own header records as withheld by **the app layer only**.

**Post-079 throughout:** `IN (SELECT public.current_user_org_ids())`, never `= ANY`, which
raises 42809 against a `SETOF`-returning function at plan time.

**The four gated sites**, each with file:line in the header. Three (the policy itself,
`app/partner/projects/page.tsx:685-689`, `app/api/partner/dashboard/route.ts:293`) are
downstream of the policy and need no code change. The fourth —
`partnerships.reliability_summary` — is the one **RLS cannot reach**, because it lives on
`partnerships`, which the vendor reads whole through "Partners can view their partnerships".
STEP 4 invalidates the cache: the summary is computed over *every* completed review, so under a
default-private rule every cached paragraph is stale by construction and is precisely the thing
that would leak an unshared review's content in prose. It is **self-healing** — the generator
regenerates on `!reliabilitySummary` (`app/api/agency/pool/[partnerId]/performance/route.ts:160`)
and re-caches — so no agency code change is required, at the cost of one AI call.

**The residual is stated in the header, not buried:** a *regenerated* summary lands back in the
same vendor-readable column. Column-level `REVOKE SELECT` cannot express this — privileges are
per role and both sides are `authenticated`. The real fix is moving the cache to an agency-only
table, which needs the agency route to read the new location and therefore **needs code to ship
first**, so it is deliberately not folded in.

**Two non-goals, stated so neither reads as an oversight:** no vendor read on
`delivery_review_scores` (they have none today, and adding one would widen visibility in the
file that exists to narrow it — a product ruling), and no toggle route or writer for the new
column. The file creates the gate and closes it.

**Ordering against the code:** the file may ship before its code — zero occurrences of
`shared_with_vendor` in `app/`, `lib/`, `components/`, `scripts/`, verified by grep. But there
is **one immediate regression**: on commit, every vendor's Performance Scores section and
reliability block go empty, for every vendor at once, until an agency shares a review. That is
the intended end state, but it makes a vendor-facing surface worse before the feature makes it
better. The header sets out two sequencings (A: apply now; B: ship STEP 1 only, add the toggle
UI, apply the policy after) and leaves the choice to you. Pre-flight **P4** measures how many
vendors option A actually affects — if it is 0, the choice does not matter.

Four pre-flight queries (P1 and P2 can stop the migration; **P3 is the rollforward list** — the
reviews a vendor can read today and will not be able to after, capture it before committing),
six verification queries with expected values, and a down file that leads with two partial
rollbacks because the whole file re-opens the disclosure.

Logged in `LIGAMENT_CONTEXT.md` as **WRITTEN, NOT YET APPLIED**.

---

## 5. The migration-056 trigger — REPORT ONLY

### The premise has moved. The forward defect is already closed at the trigger.

056 (`supabase/migrations/056_default_dual_role_access.sql:22-24`) does write
`role = 'agency'`, `active_role = 'agency'`, `secondary_role = 'partner'` unconditionally, and
never reads `raw_user_meta_data->>'role'`. That is the defect, and it is real.

**But two later migrations replaced that function, and the second of them is applied.**

- **078** (`078_signup_role_trigger.sql:136-184`) `CREATE OR REPLACE`s `handle_new_user` to read
  `raw_user_meta_data->>'role'`, derive `secondary_role` as its opposite, pin
  `SET search_path = public, pg_temp`, and drop `is_paid` / `is_admin` / `demo_access` and both
  `greg@withligament.com` literals. Its own header says "AUTHORED, NOT APPLIED".
- **079 PHASE 12** (`079_organizations.sql:1841-1926`) `CREATE OR REPLACE`s it **again**, on the
  same role-reading body, adding the organization and owner-membership creation. **079 is
  applied.** 079's own header at `:1827-1828` states "Migration 078 is applied and verified in
  production".

**`CREATE OR REPLACE FUNCTION` replaces the body wholesale.** So whether or not 078 ever ran is
immaterial to the outcome: if 079 PHASE 12 executed, the live body is the text at
`079_organizations.sql:1841-1926`, which **reads the chosen role**. The unconditional
`role='agency'` write is gone from the forward path — not merely papered over by the
auth-callback fix at `app/auth/callback/route.ts:62-64`, whose comment still describes the 056
behaviour and is now itself stale.

### What the repo can tell us

1. The exact text 079 intended to install (`:1841-1926`) and the exact text 056 installed.
2. That 079 PHASE 12 sits **inside** 079's transaction and commits at `:1929`, so it either all
   applied or none of it did.
3. That neither 078 nor 079 backfills any existing role — both say so explicitly
   (`078:83-87`, and 079 carries the same note). **The ~12 affected accounts were never
   corrected.**
4. The measurement, from `078:30-33`: as of 2026-08-17, **15 accounts, 7 of which chose
   `partner` at signup and carry `role='agency'`; 4 of those still sitting in the agency
   portal.** The per-account UPDATEs were written to `docs/m1-prework-report.md`, Item 1.

### What the repo CANNOT tell us, and this is the part that matters

079's own header at `:1829-1832` is explicit: *"This was NOT re-read from `pg_proc`: PostgREST
cannot reach `pg_catalog`, there is no psql on the authoring machine, no Postgres driver in the
project, and `POSTGRES_URL` is empty."* That is the non-reproducibility you referred to, and it
is still true of this session — I verified there is no psql on PATH and every `POSTGRES_*`
credential is empty. So the repo cannot establish:

1. **Whether anything replaced `handle_new_user` after 079** — an out-of-band edit in the
   Supabase dashboard leaves no trace in the repo.
2. **Whether the trigger is still attached and enabled.** `CREATE OR REPLACE FUNCTION` does not
   touch triggers, but nothing here proves `on_auth_user_created` exists, is on `auth.users`, or
   has `tgenabled = 'O'` rather than `'D'`.
3. **Whether any OTHER trigger fires on `auth.users`** and writes `profiles`.
4. **`prosecdef` and `proconfig` as actually stored** — the `search_path` pin in particular.
5. **The current role values of the ~12 accounts.** No backfill ran; nobody has re-counted
   since 2026-08-17, and roles may have been changed by hand.
6. Whether 056's backfill (`056:40-49`, which set `is_paid = true` for everyone) left other
   residue that later migrations did not address.

**This is why I did not author a replacement.** Every correction here is either a no-op (if 079
is live, the function is already right) or unknowable (if something else is live, I do not know
what I would be overwriting). Writing a `CREATE OR REPLACE` blind would destroy whatever is
actually there.

### What the correction would say, once the dump is read

- **If the live body matches `079:1841-1926`:** *no function change at all.* The forward path is
  correct. The only outstanding work is the **per-account role backfill** for the accounts
  measured in `docs/m1-prework-report.md` Item 1 — a handful of targeted `UPDATE public.profiles
  SET role='partner', active_role='partner', secondary_role='agency' WHERE id = '…'` statements,
  each with a before-and-after `SELECT`, run per account and never as a blanket `WHERE` clause.
  Blanket is how 056 caused this.
- **If the live body still has 056's hardcoded `'agency'`:** then 079 PHASE 12 did not apply,
  which also means **no account created since 079 has an organization or an `org_members` row**
  and is locked out by deny-by-default (`079:1806-1809`). That is a much larger incident than
  the role defect and would be the finding, not the trigger.
- **If it is neither:** an out-of-band edit exists and must be read and understood before
  anything replaces it.
- In all three cases the auth-callback comment at `app/auth/callback/route.ts:53-61` should be
  corrected, since it describes 056 as current.

### SQL to dump the live definition — read-only, run all five

```sql
-- D1. THE DEFINITION. This is the one that decides everything above.
--     Compare the body against supabase/migrations/079_organizations.sql:1841-1926.
SELECT p.oid::regprocedure AS signature,
       p.prosecdef         AS is_security_definer,
       p.provolatile       AS volatility,
       p.proconfig         AS settings,
       p.proowner::regrole AS owner,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
-- EXPECT: exactly 1 row. prosecdef = t. proconfig = {"search_path=public, pg_temp"}.
-- The definition should contain "raw_user_meta_data->>'role'" AND "org_members".
-- If proconfig IS NULL, the search_path pin is missing and neither 078 nor 079 PHASE 12 ran.
-- If it contains 'greg@withligament.com' or is_paid, 056 is still live.
-- If there is MORE THAN ONE ROW, there are overloads and the trigger may not call the one
-- you are reading. D2 tells you which.

-- D2. IS IT ATTACHED, AND IS IT ENABLED. CREATE OR REPLACE FUNCTION never touches this.
SELECT t.tgname,
       t.tgrelid::regclass AS on_table,
       t.tgenabled,                       -- 'O' = enabled. 'D' = DISABLED.
       t.tgfoid::regprocedure AS calls,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
WHERE NOT t.tgisinternal
  AND t.tgfoid = 'public.handle_new_user'::regproc;
-- EXPECT: 1 row, on auth.users, tgenabled = 'O', AFTER INSERT FOR EACH ROW.
-- ZERO ROWS means the function exists and never runs - every signup since would have no
-- profile row at all except via app/auth/callback/route.ts:23.

-- D3. IS ANYTHING ELSE WRITING profiles ON SIGNUP. The question D1 cannot answer.
SELECT t.tgname, t.tgenabled, t.tgfoid::regprocedure AS calls
FROM pg_trigger t
WHERE NOT t.tgisinternal
  AND t.tgrelid = 'auth.users'::regclass
ORDER BY t.tgname;
-- EXPECT: the one trigger from D2 and nothing surprising beside it.

-- D4. THE DAMAGE, RE-MEASURED. The 2026-08-17 count is a year-stale snapshot.
--     Requires reading auth.users.raw_user_meta_data, so run it in the SQL editor.
SELECT p.id, p.email, p.role, p.active_role, p.secondary_role,
       u.raw_user_meta_data->>'role' AS role_chosen_at_signup,
       (u.raw_user_meta_data->>'role' IS DISTINCT FROM p.role) AS mismatched,
       p.created_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
ORDER BY mismatched DESC, p.created_at;
-- EXPECT: every row where role_chosen_at_signup = 'partner' AND role = 'agency' is an
-- affected account. THIS IS THE BACKFILL LIST. Nothing has corrected it.

-- D5. DID 079 PHASE 12 ACTUALLY RUN. If accounts exist with no org_members row, it did not,
--     and those accounts are locked out of their own data by deny-by-default.
SELECT p.id, p.email, p.created_at
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = p.id)
ORDER BY p.created_at;
-- EXPECT: 0 rows. Any row is an account that cannot see its own data.
```

Run **D1 and D2 first**. Between them they decide whether there is anything to correct at all.

---

## 6. The vendor-side feed — REPORT ONLY

### The headline: a service-role route needs NO new policy, and both vendor bid paths already are service-role.

`app/api/rfp/guest/[token]/route.ts` is service-role throughout (`:146-150`, used at `:191` and
`:378`). And `app/api/partner/rfps/bids/route.ts` — the **authenticated** vendor bid submit — is
**also** service-role (`:15-18`). So the two paths that would emit `bid.submit` / `bid.revise`
both already hold a client that RLS does not apply to.

**RLS is not enforced for the `service_role` key.** 080's INSERT policy is `TO authenticated`
and would simply never be consulted. This is not theoretical: item 1a's `rfp.magic_link_send`
emit now writes `milestone_events` rows through exactly such a client, on the magic-link route.

So: **yes, a service-role route can write `actor_side = 'vendor'` rows with no new policy at
all.** What it needs instead is a **code** change, because the emitter refuses to produce one:
`toRow()` in `lib/milestone-events.ts` hardcodes `actor_side: "agency"` and the `MilestoneRow`
type declares it as the literal `"agency"`. That is the actual gate today, and it is a
deliberate one — the comment there says the vendor policy and the vendor emitters ship together.

### What the policy would have to say, if it is written anyway

The hard part 080 names (`:366-372`) is permitting the guest path's NULL `actor_id` without
letting an authenticated caller write somebody else's name. Mirroring the agency policy:

```sql
CREATE POLICY "Vendors insert own company milestone events"
  ON public.milestone_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_side = 'vendor'
    AND vendor_org_id IN (SELECT public.current_user_org_ids())
    AND (actor_id IS NULL OR actor_id = auth.uid())
    AND partnership_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.id = milestone_events.partnership_id
        AND p.vendor_org_id IN (SELECT public.current_user_org_ids())
    )
  );
```

Four things this must get right, and the last two are where it goes wrong:

1. **`vendor_org_id`, not `org_id`, carries the membership test.** On a vendor-side row the
   acting company is the vendor. `org_id` still names the agency, and it must NOT be constrained
   to the caller's memberships or every legitimate vendor write is denied.
2. **`partnership_id IS NOT NULL` plus the EXISTS.** Without it a vendor could write a row
   naming any `org_id` they can obtain, and `org_id` is what the agency's own SELECT policy
   reads — so the agency's feed would render a line the vendor composed.
3. **`actor_id IS NULL` is the hole.** The agency policy can afford
   `(actor_id IS NULL OR actor_id = auth.uid())` because no agency emitter writes a null actor.
   On the vendor side the null is the *normal* guest case, so an authenticated vendor may write
   `actor_id = NULL` and have it render through `guestDisplayName()` — attributing their own act
   to "a guest at acme.com". That is minor, but it is an attribution the row cannot substantiate.
4. **`actor_email` is completely unconstrained by any of this** and it is the real problem. See
   below.

### What the guest path actually needs, and why the policy above does not serve it

A magic-link guest is **not `authenticated`** — they hold a bearer token, not a session, and
`auth.uid()` is null. A policy `TO authenticated` never applies to them. Serving the guest path
by policy would mean granting `anon` an INSERT on `milestone_events`, and **`anon` is the key
this project assumes is in an attacker's hands** (087's header states exactly that). Any
`WITH CHECK` available to `anon` would have to be satisfiable without a session, which means
satisfiable by anyone holding the anon key — i.e. it would be forgeable by construction.

**That is the argument for the service role, not against it.** The guest route already
validates the token, resolves the response and the partnership, and holds every id the row
needs. Writing the row there is *more* constrained than any anon policy could be, because the
constraint is the token check, which RLS cannot express.

### The one thing that needs a ruling before any vendor emitter ships

`actor_email`. On the guest path it is the vendor's real address, and it is the identity
fallback for an actor with no account. `lib/activity-feed.ts` is already built for this — the
vendor feed omits the column from its select list entirely, and `emailDomain()` /
`guestDisplayName()` ensure only the **domain** is ever rendered, on either feed. So the reader
side is solved.

The **writer** side is not: nothing constrains what goes into `actor_email`, and on a
vendor-visible event type the agency reads that column. It is the mirror of the payload rule —
a vendor writing a row the agency reads. Worth deciding deliberately rather than discovering.

**Recommendation:** ship the first vendor-side emitter on the **service role**, with no new
policy, and with `actor_email` written **only** from the token row's `vendor_email` — never from
a request body. Add the vendor INSERT policy later, if and when a non-service-role vendor write
appears. A policy that grants a write nobody makes is, in 080's own words, a policy nobody has
reviewed against a real caller.

---

## 7. Dead code sweep — DONE, strictly bounded

Commit `1239a81`. Full-repo greps across `app/`, `lib/`, `components/`, **`contexts/`**,
`hooks/`, `scripts/`, `types/` and the root config files preceded every decision.

### Removed

**`notifyNewMessage` and `notifyDocumentUploaded`** (`lib/notifications.ts`, 45 lines). Zero
call sites — the only grep hits were the two definitions and the self-referential `site:` string
each passes to `createOrgNotification`. Their own comment said they were dead; the grep
confirmed it. Zero references remain.

### Found referenced and LEFT — both of the other two candidates

**`app/partner/invitations/`.** The *route* is heavily load-bearing. `/partner/invitations` is:
the CTA of live invitation emails (`app/api/partnerships/route.ts:590`, `:723`;
`app/api/agency/pool/resend-invitation/route.ts:63` — which item 1a also touched), the
post-confirmation destination for vendor signups (`app/auth/callback/route.ts:246`, `:294`), and
a notification link (`lib/notifications.ts:318`). All of them resolve through the redirect.
`page.tsx` itself is unreachable — `redirects()` runs ahead of filesystem routing — so it is
dead in the "cannot serve traffic" sense, but `next.config.mjs` says it stays until
`/partner/network` is verified working, and **this session cannot verify that**. Left in place
and reported. This is exactly the component that "was nearly deleted twice while still
referenced".

**The `/partner/discover` redirect.** The prior report flagged it because the directory is
already deleted. That reading is backwards: with nothing on disk, the redirect is now the *only*
thing between an old bookmark and a 404. Removing it would be a broken link, not a cleanup.
Left in place.

### Corrected

The `next.config.mjs` comment, which claimed both directories were "left in place until the new
page is verified working" when one no longer exists, and did not say the redirects are
load-bearing. It now names the referencing sites, so the next reader does not reach for them.

---

## Acceptance

**1. Every new emitter fires without changing the success or failure of its action.** ✓
`recordMilestone` / `recordMilestones` filter unusable events, catch every error and every
throw, and return `void` — no call site can observe a failure. Three of the seven sit inside a
pre-existing `try/catch` that already swallowed. Where an emitter needed data the route did not
have, it was obtained without touching the acting query: `markPartnershipInvited` returns the
row it *already* wrote; the prior deadline is a **separate best-effort query** rather than a
widened `existingToken` select, and when it fails **no event is emitted** rather than a guessed
one; `status_update.resolve` hoists one `let` out of a try block and changes nothing inside it.
Two selects were widened by one column each — `id` on the deploy route's partnership embed and
`id` on the read-back in `markPartnershipInvited` — both primary keys that cannot be absent, and
both on queries whose errors were already ignored.

**2. One line per new emitter saying what a vendor reading that row would see.** ✓ Item 1a,
the seven-row table. Every payload field on all seven is a fact about the single recipient that
row is for; each route acts on exactly one vendor per call, so no cross-vendor figure exists to
leak. The magic-link bearer token is deliberately absent.

**3. The feed still renders the existing `bid.decline` row and the four derived sources.** ✓
Executed against the compiled module, not read: `bid.decline` renders `"declined a bid on Key
Art"` unchanged, and `mergeActivityEntries` still keeps a derived line beside a non-colliding
milestone line. The four derived sources (`project:`, `bid:`, `rfp_inbox:`,
`onboarding_package:`) are untouched — none of the seven new types is in
`UNION_REPLACING_EVENT_TYPES`, so `milestoneDedupeKey` returns `null` for all of them and none
can displace a derived line. All seven new predicates were confirmed to render.

**4. The eight gates against the baseline.** ✓ Re-run in full before each of the five commits,
and after the last one. **Not one moved, and no allow-list was added to or widened.**

| Gate | Baseline | Final |
|---|---|---|
| `npx tsc --noEmit` | 0 | **0** |
| `pnpm build` | 0 | **0** |
| `pnpm lint` | 1, 182 (154 errors, 28 warnings) | **1, 182 (154, 28)** |
| `pnpm verify-rls` | 2 | **2** |
| `pnpm policy-audit:guard` | 1 | **1** |
| `pnpm identity-columns:guard` | 0 | **0** |
| `pnpm embed-targets` | 0 | **0** |
| `pnpm org-id-reads:guard` | 0, A 14, B 61 | **0, A 14, B 61** |

---

## Commits

| | |
|---|---|
| `4bfd2e2` | feat: emit the seven agency-side milestones that had a route but no call site |
| `d282ac2` | fix: count distinct vendors, not rows, in the broadcast recipient figure |
| `eebb7a3` | feat: author migration 073, the per-review delivery-review sharing gate |
| `1239a81` | chore: remove the two dead notification helpers, correct a stale redirect note |

Plus this summary. **Not pushed.**

## What is waiting on you

1. **Item 1b** — the payload ruling on `bid.shortlist`, `bid.meeting_request` and
   `payment.mark_paid`; and for `payment.mark_paid`, whether to ship the two select widenings as
   a separate fix first. Also whether the missing capability checks on shortlist and
   meeting-request should be added.
2. **Item 4** — the 073 sequencing choice (A or B), and P3's rollforward list: whether today's
   visibility is preserved for those specific reviews or closed with the rest.
3. **Item 5** — run D1 and D2. Between them they decide whether there is anything to correct.
4. **Item 6** — the `actor_email` writer ruling before any vendor-side emitter ships.
5. **Item 7** — whether `/partner/network` is verified working, which is the only thing holding
   `app/partner/invitations/page.tsx` on disk.
