# Read-scope session report

**Branch:** `fix/acting-role-read-scope` (7 commits, `d5a1b26`..`c975df9`)
**Date:** 2026-08-21  **Not pushed. Not merged. No PR opened.**

---

## COMPLETION, AT THE TOP

**All seven phases completed.** Nothing was skipped and nothing was left half-done.

Two things inside those phases came out differently from what the brief anticipated, and both
are stated where they belong rather than buried:

1. **Phase 2 found ONE further defective site, not a list.** The class inventory resolved 288
   reads and 3 were defective: two on `partner_rfp_inbox` (Phase 1) and one on
   `project_messages` (Phase 2). Eighteen of the twenty class tables are clean in both
   directions. That is a result, not an abandoned search - section 2 shows the method.
2. **Phase 3 has two surfaces, not three.** Phase 2's fix is on
   `GET /api/projects/[id]/messages`, and **that route has no user interface**. An empty state
   was drafted for it and deleted rather than shipped for a screen that does not exist. See
   OPEN-RS-5.

---

## WHAT I EXECUTED, WHAT I READ, WHAT I REASONED

The brief asks for this distinction and it decides how much several sections below are worth.

**EXECUTED** (on this machine, against files, never against a database):
`npx tsc --noEmit`, `pnpm build`, `pnpm lint`, `pnpm identity-columns:guard`,
`pnpm org-id-reads:guard`, `pnpm embed-targets` - each twice, at Phase 0 and Phase 7. Plus
`git`, `grep`, and a purpose-written static scanner over 387 query chains.

**READ** (source of truth for every claim about policies and schema):
`docs/schema-snapshot-2026-08-13.md` (the `pg_policies` dump), migrations 079-092 on disk,
`087_partnership_vendor_identity.sql` for the trigger being extended,
`092_org_entitlement.sql` and `docs/092-preapply-test.sql` for the conventions 093 follows,
and every application file named in the inventory.

**REASONED** (derived, not observed):
The class membership of all 20 tables. The GUARDED/DEFECTIVE verdict on each of 62 candidate
sites. The claim that the agency mirror is clean. The permit list in 093. Every one of these
is argued from a quoted line, and every one could be wrong in the way a careful reading can be
wrong.

**NOT DONE, AND NOT SIMULATED:** I ran no SQL, applied no migration, and hold no database
credential. Every row count in this document that I did not compute from source is marked
NOT MEASURED with the query that would settle it.

> **"Success. No rows returned" in the Supabase SQL Editor is identical for a dry run, for a
> real apply, and for a query pasted into the wrong tab.** It reports that a batch finished
> without returning a result set. It does not report that anything was applied, that anything
> was written, or that you were looking at the right database. It is the message a
> `ROLLBACK`-terminated dry run gives, the message a committed migration gives, and the
> message a `SELECT` in a tab pointed at the wrong project gives. **Only the verification
> block after the `COMMIT` tells the three apart.** 093 carries six such queries and they are
> not optional.

---

## 1. The defect, and what it was

`/partner/rfps` rendered **"96 RFPs across 2 agencies"** for markant, whose vendor side has
never received an RFP. All 96 rows were visible to the caller **only as the lead agency**.

**The mechanism: row level security used as a scope rather than as a wall.** `partner_rfp_inbox`
carries five policies - an agency SELECT on `lead_org_id`, a vendor SELECT on `vendor_org_id`,
a vendor SELECT on `recipient_email`, an agency INSERT and a vendor UPDATE. Permissive policies
of the same command **OR together**, so an unqualified `SELECT` returns the union of every arm
the caller satisfies. The agency arm knows nothing about which portal is being rendered.

The read version of the Class B write pattern from `docs/091b-session-report.md`. **Not a data
leak** - the agency saw its own rows. **Not caused by 089-092.**

---

## 2. The class inventory, and what it decided

Full derivation in **`docs/read-scope-inventory.md`** (committed alone, before any code
changed). Summary:

**The class:** any table whose policy set contains both an agency-arm SELECT and a vendor-arm
SELECT returns the union of both to a dual-role caller. **Twenty tables qualify.** The brief
named eight candidates; all eight are members and **twelve more were derived** -
`partner_rfp_response_versions`, `project_documents`, `project_messages`, `milestone_events`,
`onboarding_package_documents`, `onboarding_deployments`, `assignment_agreements`,
`msa_agreements`, `agency_partner_invitations`, `partner_access_requests`,
`invitation_requests`, and `projects`.

**Method, because grep cannot answer this.** All 387 `.from(<class table>)` sites were located,
288 of them reads. Each statement was extracted by **balancing parentheses and brackets** with
backtick template selects and interleaved comment lines handled - the naive
line-continuation version of that scan produced **eleven false UNSCOPED readings**, every one
of which would have been reported as a defect. 226 reads settle on a direct single-arm filter.
**The remaining 62 were resolved by tracing each filter key to its assignment and then reading
the handler.**

**Verdict: 3 defective, 285 guarded.**

| Table | Defective reads | Direction |
|---|---|---|
| `partner_rfp_inbox` | 2 | agency arm into the vendor portal |
| `project_messages` | 1 (latent) | agency arm into the vendor branch |
| the other 18 class tables | 0 | - |

**`profiles` is a reasoned exclusion, not an oversight.** 079 folded its three SELECT policies
into one (`079_organizations.sql:1563-1568`), so there are no two arms to separate; and a
vendor reading their lead agency's profile is the product, not a defect. Scoping it would be a
product change.

---

## 3. Every site fixed

### D1 - `app/api/partner/rfps/route.ts:166-169` (now `:190-233`)

The proven defect. Was:

```ts
const { data, error } = await supabase.from("partner_rfp_inbox").select("*").order(...)
```

with a comment above it that described the defect as the design:

> *"No application-side org filter is needed because there is no application-side filter here
> at all: the select is unqualified and RLS is the whole scoping."*

**Fixed:** `resolveActingOrgId()` from `lib/acting-org.ts` resolves the acting organization;
every row is then tested with `vendorOwnsPartnerRfpInboxRow()` - the same comparison the detail
route reaches through `partnerCanAccessPartnerRfpInbox()`. **RLS reliance kept**: the policy
is still the wall, the filter adds scope. A dropped-row count is logged so the number can be
watched rather than assumed.

Also at this site: the hand-rolled `role !== "partner" && active_role !== "partner"` became
`canActAs(profile, "partner")` from `lib/acting-role.ts` - term for term, the substitution
already made at `app/api/partner/rfp-bid/upload/route.ts:46-50`.

### D2 - `app/api/partner/dashboard/route.ts:63-67` (now `:96-143`)

The same defect on the vendor dashboard, **found by this inventory and not previously known**.
Its own two siblings in the same `Promise.all` carried `.in("vendor_org_id", callerOrgIds)` and
the inbox read did not, with `callerOrgIds` already resolved on the line above. Same fix, same
shared comparison. Feeds the "needs your response" queue, the agency name set, and the vendor
activity feed.

### D3 - `app/api/projects/[id]/messages/route.ts:113-134` (Phase 2, own commit)

`project_messages` carries both arms. The handler branches on `actingRole()` correctly and the
partner branch **proved an assignment at `:73-81` and then discarded the id**, filtering on
`project_id` instead.

**For an ordinary vendor no row set changes** - the RLS vendor arm already requires
`pa.id = project_messages.assignment_id` and the gate is `.single()`, so the rows the policy
returns are exactly the rows the new filter names. It closes the case where a caller is **both**
the lead agency of a project and an assigned vendor on it, where the agency arm ORs in and the
vendor portal renders every message including other vendors'. Requires self-dealing to reach.

### One definition, not two

`lib/partner-inbox-access.ts` gained `vendorOwnsPartnerRfpInboxRow()`, and
`partnerCanAccessPartnerRfpInbox()` now calls it. **The ownership question is asked in exactly
one place** and both the list routes and the detail route reach it.

The split exists because a list and a detail view need different answers about the NDA and the
same answer about ownership: **the vendor must SEE an NDA-gated RFP** (that is how they learn
there is an NDA to sign) while the detail route must refuse its contents. Conflating them
would have hidden NDA-gated rows from the list.

**Why the email arm is compared in application code and not pushed into the query:** it
compares `lower(btrim())` on both sides, PostgREST cannot express `btrim`, and the nearest
available operator - `ilike` - treats `%` and `_` in a stored address as wildcards. That is
**migration 093's HOLE 1, reintroduced on a second table.** The rows are already being fetched.

### A note on `resolveActingOrgId()` vs the detail route

The brief asks for `resolveActingOrgId()`; the reference implementation uses
`resolveCallerOrgIds()`. **Both are honoured**: the org id comes from the sanctioned resolver,
the comparison is the reference one. They return the same value today - every live account has
exactly one `org_members` row - and diverge only on a multi-membership caller, where
`resolveActingOrgId()` fails closed and the list would be empty while the detail route still
serves the row. **Unreachable today. Logged as OPEN-RS-4** rather than left implicit.

---

## 4. THE AGENCY-SIDE MIRROR

Looked for as a first-class possibility. An agency-side read with this flaw would show rows
where the caller is the **vendor**, inside the lead agency portal. For markant it would be
**invisible**: zero rows carry markant as `vendor_org_id`, so the union and the agency arm
return identical sets and the surface would look correct while being broken for a genuinely
dual-role account.

**Finding: the agency side is clean. Zero defective agency-side reads.** Of 109 agency-portal
reads: 68 carry `.eq/.in("org_id"|"lead_org_id", callerOrgIds)` directly, 27 are keyed off a
list produced by such a read, 14 name both arms deliberately with `lead_org_id` as the caller's
scope, **0 are unqualified**.

**The asymmetry has a cause, and it is not luck.** The agency side inherited
`agency_id = auth.uid()` from the pre-079 schema, so 079's rename forced **every** agency-side
read to be rewritten to `.in("org_id", callerOrgIds)` - a mechanical sweep that left an
explicit filter on each one as a side effect. The vendor side got the same sweep for
`vendor_org_id`, but **a read with no filter to rewrite was never visited.** D1 and D2 are
exactly those. The comment at the old `app/api/partner/rfps/route.ts:164-165` is a later
reader noticing the absence and rationalising it.

`scripts/check-org-id-reads.mjs` cannot see this class: it looks for a `profiles` row fetched
by an id an organization column may have supplied, and an unqualified select supplies no id.
Both defects sat inside its 382-file scan and neither is among its 74 known-open sites.

---

## 5. Phase 3: the honest empty states

Once fixed, markant's vendor surfaces are **legitimately empty**, and an empty list looks
exactly like a wrongly-filtered one. Someone who saw 96 yesterday and zero today has every
reason to think the product broke.

Following the 086 roster precedent (`app/agency/settings/team/team-roster-client.tsx:602-613`)
and both rules its header records - **conditional on the actual state**, and **naming nothing
internal**:

| Surface | Says |
|---|---|
| `/partner/rfps` Open RFPs | "No RFPs have been sent to you" + "When a lead agency broadcasts an RFP to your company, it will appear here." |
| `/partner/bids` My Bids | "You have not submitted any bids that are still awaiting a decision..." |
| `/partner/bids` History | "You have not submitted any bids yet..." |
| `/partner` dashboard queue | "Nothing is waiting on you. RFPs sent to your company by the agencies you work with will appear here." |
| `/partner` whole-page empty | reworded, no contraction, plus the line below |

**Plus one extra sentence, and only for an account that has a lead agency side:**

> "This is your vendor inbox, so it shows only RFPs other agencies have sent to you. The RFPs
> you broadcast to your own vendors live in the lead agency portal."

It is gated on `usePaidUser().role === "agency"`. `role` is the **signup** role and never
changes, and anyone rendering a vendor page is acting as a partner, so `role === "agency"` on
that page means precisely "this account also runs a lead agency" - the population that lost
rows, and the only one for whom the sentence is true. A vendor-only account gets `null` and
sees nothing extra. Needs no new fetch, column or endpoint.

Copy lives in `lib/vendor-empty-copy.ts`. No em dashes.

---

## 6. Phase 4: what a vendor sees differently, and which URLs still resolve

### The nav

| Before | After |
|---|---|
| 00 Agency Network | 00 Agency Network |
| **01 Open RFPs & Bids** | **01 Open RFPs** |
| | **02 My Bids** |
| 02 Onboarding | 03 Onboarding |
| 03 Delivery & Projects | 04 Delivery & Projects |

A 1:1 mirror of the lead agency's 00 Vendor Pool / 01 RFP Broadcast / 02 Bid Management /
03 Onboarding / 04 Delivery Performance. `/partner/bids` mirrors `/agency/bids`.

### Exactly what changes on screen

1. **The top nav has five stage items instead of four**, renumbered 00-04.
2. **`/partner/rfps` no longer carries a tab strip.** It is one view: the RFP invitations. Its
   heading changed from "Open RFPs & Bids" to **"Open RFPs"**. The count line, the search box
   and the group-by control are unchanged.
3. **`/partner/bids` is new** and carries a two-item strip, **MY BIDS | HISTORY**, opening on
   My Bids.
4. **Two dashboard tiles were repointed.** "Bids Submitted" and "Win Rate" pointed at
   `/partner/rfps`; they now point at `/partner/bids`. Before the split all three tiles landed
   on the same combined page, so where they pointed distinguished nothing. "Open RFPs" still
   points at `/partner/rfps`.
5. Empty-state copy, per section 5.

### Where HISTORY went, and why

**With My Bids, on stage 02.** Three reasons, in the order that decided it:

1. **The entity.** Open RFPs reads `partner_rfp_inbox` - invitations that arrived. My Bids and
   History both read `partner_rfp_responses` through `/api/partner/rfps/bids` - submissions
   this vendor made. History is literally `allBids`; My Bids is `allBids` filtered by
   `TERMINAL_BID_STATUSES`. Splitting a filter away from the thing it filters would put one
   entity on two nav items.
2. **The mirror.** The lead agency reads awarded and declined bids inside **02 Bid
   Management**, not inside 01 RFP Broadcast. Putting vendor History anywhere else breaks the
   1:1 this split exists to create.
3. **What it answers.** "Did I win?" is a question about a bid. An RFP whose deadline passed
   without a bid never becomes history at all - it stays an inbox row.

### No URL breaks. Enumerated rather than asserted.

**`/partner/rfps` is unchanged as a URL.** The nav split **added** `/partner/bids` beside it; it
renamed nothing, so there is no redirect to write. Every live entry point still resolves:

| # | Entry point | Still resolves |
|---|---|---|
| 1 | RFP broadcast, existing partner, no NDA (`broadcast-rfp`) | yes |
| 2 | RFP broadcast, NDA required -> `/partner/rfps?invite=...&nda=required` | yes, params still read |
| 3 | Bid feedback left (`rfp-responses` PATCH) | yes |
| 4 | Bid declined by agency | yes |
| 5 | Bid awarded | yes |
| 6 | `app/auth/callback/route.ts` partner default | yes |
| 7 | `app/rfp/respond/[token]/page.tsx:899,918` sign-up `next=` | yes |
| 8 | `app/partner/rfps/[id]/page.tsx:1284,1299,1497` back links | yes |
| 9 | `lib/demo-data.ts:812,818` | yes |
| 10 | `app/page.tsx:451` marketing footer | yes |

**The `?invite=`, `?invite_status=` and `?nda=` handling did not move** - the auto-claim effect
that fires on `invite` changed file, not behaviour. Verified in the build: `/partner/rfps`
still renders (○ static) and `/partner/bids` is additional. Route count 172 -> 173.

**No URL selected a tab before this split** - the tab was plain `useState` with no query
parameter - so no link anyone holds can land on a tab that is gone.

**`middleware.ts` was not touched.** It gates on `pathname.startsWith('/partner')`, so
`/partner/bids` inherits the vendor gate by prefix.

**The lead agency nav was not touched.**

### One cosmetic residual, reported not fixed

A bid row on `/partner/bids` links to `/partner/rfps/<inbox_id>` - the RFP detail page, which
is where the bid form lives and is correct. The nav will highlight **01 Open RFPs** while the
user arrived from 02. A highlight inconsistency, no broken navigation. **OPEN-RS-7.**

---

## 7. Migration 093 (AUTHORED, NOT APPLIED)

`supabase/migrations/093_partnership_claim_and_column_guard.sql` (699 lines)
`supabase/migrations/093_partnership_claim_and_column_guard_down.sql` (180 lines)
`docs/093-preapply-test.sql` (1,090 lines)

**I ran no SQL. Greg applies this by hand.**

### HOLE 1, OPEN-092-8: the claim policy matched by pattern

`partner_email ~~* (SELECT pr.email ...)` - `~~*` is ILIKE and the **right-hand side is a
pattern**, which is the caller's own profile email. An account whose email were
`%@example.com` could claim every unclaimed ghost partnership at that domain; `%` alone would
claim every unclaimed row. Not exploitable today - no live email contains `%` or `_` - which is
a property of today's data and nothing else.

**Fixed by `ALTER POLICY`** to `lower(btrim(a)) = lower(btrim(b))` with explicit `IS NOT NULL`
on both sides, matching the vendor arm of `partner_rfp_inbox` and `lib/partner-inbox-access.ts`.

**ALTER, not DROP-then-CREATE, and that is the load-bearing choice.** On a drifted policy name
`DROP IF EXISTS` matches nothing and the `CREATE` adds a **second** policy - leaving the ILIKE
one live, OR-ing the two, closing nothing, and reporting success. `ALTER POLICY` raises 42704
and aborts. For a change whose purpose is to REMOVE a predicate, failing loudly is the only
acceptable behaviour.

**One widening, named rather than buried:** `btrim()`. ILIKE did not trim, so a `partner_email`
stored as `' greg@x.com'` was not claimable by `greg@x.com` and now is. Same person, house
convention, one extra row shape. Stated in the migration header.

### HOLE 2, OPEN-092-9: no column restriction

`Partners can update partnership status` says "status" in its name and restricts no column.

**Already mitigated, verified against 087 rather than assumed:** `lead_org_id` is immutable
(`087:606-612`) so a vendor **cannot** move a partnership to another lead agency, and
`vendor_org_id` is pinned in both directions (`087:621-648`).

**What remained writable, established column by column from the schema** (the full 26-column
census is in 093's header, assembled from `scripts/010:12-31`, `scripts/011:5`,
`scripts/025:3-6`, `scripts/032:4`, `051:5-6`, `052:2`, `061:14-23`, `063:9`, `066:59-60`,
`068:9-12`, `079:672-673`). The four that made it worth a migration:

- `nda_confirmed_at` / `nda_confirmed_by` - a vendor could **self-confirm their own NDA**
- `msa_confirmed_at` / `msa_confirmed_by` - the same for the MSA
- `partnership_notes` - the agency's private notes, holding the `{blacklisted}` flag; a vendor
  could **un-blacklist themselves**
- `reliability_summary` / `reliability_summary_generated_at` - the cached AI performance
  narrative the agency reads; a vendor could **author their own performance record**. Migration
  073's header already flagged this column as vendor-readable and worried about it in writing;
  this is the write half of that worry.

### The proposed guarded set

**A permit list, following 092.** A vendor session may change:

```
status, accepted_at, updated_at, payment_terms_requests, vendor_org_id
  + profile_status, ON THE CLAIM TRANSITION ONLY
```

Everything else is refused with **LG009** - including columns that do not exist yet, because
the comparison is `to_jsonb(NEW) - permitted` against `to_jsonb(OLD) - permitted`.

`profile_status` is conditional because it also holds `'removed'`, which is how an agency hides
a row from its own pool (063); a claimed vendor writing it could delete themselves from the
agency's view of their network.

**Derived from a written census of five live vendor writers,** not from reading the code once:
W1 accept (`app/api/partnerships/route.ts:1029`), W2 decline (`:1179`), W3 payment terms
(`app/partner/projects/page.tsx:366`), W4 claim on login (`app/auth/callback/route.ts:183`),
W5 claim (`app/api/partnerships/route.ts:285`). **All five pass.**

**087's trigger is the mechanism extended, not duplicated.** `CREATE OR REPLACE` on the same
function, with 087's four refusals carried forward character for character above the new block.
A second trigger would have sorted alphabetically **before** 087's and pre-empted its four
precise messages with a generic LG009.

Three early exits, in order: nothing guarded moved -> return; `auth.uid() IS NULL` -> return
(service role, functions, migrations); caller is the lead agency -> return. **Exempt is not
permitted** - the service-role writers write `partnership_notes` and are still not on the list.

### 093's apply order

1. **Run `docs/093-preapply-test.sql` first.** One paste, one batch. It BEGINs, runs 093,
   impersonates a real vendor, exercises all 15 assertions, and ROLLBACKs.
2. Read the headline. Apply **only** on `SAFE TO APPLY 093.`
3. Dry run 093 itself if wanted: change the `COMMIT;` to `ROLLBACK;`.
4. Apply 093.
5. **Run the six verification queries after the COMMIT.** They are the only thing that
   distinguishes an apply from a dry run.
6. Update the migrations table in `LIGAMENT_CONTEXT.md`.

**No code change is required by 093 in either order.** It removes an ability nothing in this
repository uses.

### 093's dry-run COMMIT line number

**Line 609.** `BEGIN;` is line **381**. Line **455** is the plpgsql `BEGIN` of the trigger
function body - no semicolon, not a transaction statement. Verify before trusting:

```bash
grep -n -i '^begin\|^commit\|^rollback' \
  supabase/migrations/093_partnership_claim_and_column_guard.sql
```

**Three hits: 381, 455, 609.** Confirmed against the file as committed.

The down file: `BEGIN;` 56, plpgsql `BEGIN` 87, `COMMIT;` 151.

### How to read 093's test

**IT ENDS IN AN ERROR AND THE ERROR IS THE RESULT.** A run that does *not* error means
something went wrong. The `RAISE EXCEPTION` mechanism is the **third** tried and the only one
that works in Greg's client: the Supabase SQL Editor renders no NOTICES, and it has no temp
namespace (3F000), so no results table can exist. **Do not invent a fourth.**

Order is headline, then tally, then the 15 detail lines - a client that truncates a long error
truncates the **end**, so the verdict survives.

- **`SAFE TO APPLY 093.`** - and only this. Apply it.
- **`DO NOT APPLY 093.`** - an assertion FAILED, or the test is broken.
- **`DO NOT APPLY 093 YET.`** - INCONCLUSIVE. Nothing failed, but something was never
  exercised. **Not a green light.**
- **`Success. No rows returned`** - the run did not work. You have learned nothing.

**The self-check overrides the headline.** `v_ran` is incremented by the assertions and
`v_logged` by the report sites, counted independently. If they differ the headline is replaced
with `THE TEST ITSELF IS BROKEN` - **including on an otherwise clean run**, because an
incomplete report cannot support any verdict.

**The 15 assertions.** T1-T5 are the permitted writes (accept, decline, payment terms,
whole-row read-modify-write, no-op) - **a FAIL there means 093 breaks a live vendor action on
apply and is the most urgent kind of failure in the file.** T6-T10 are the refusals (NDA
self-confirm, un-blacklist, self-authored reliability, `partner_email`, `profile_status` off
the claim transition). T11 proves 087 still speaks first with its own 42501. T12 proves the
agency side is unaffected. T13-T15 cover HOLE 1: the predicate itself, the wildcard closed
behaviourally, and **the legitimate claim still admitted** - which is the direction that breaks
production.

**The test writes to real rows** (a live partnership, and `profiles.email` twice) because a
guard can only be exercised against a row it protects. All inside one transaction, all undone
by the abort. **Run it as one paste.**

**One subtlety the test had to handle:** `set_config(..., true)` is local to the
**transaction**, not the statement, so an impersonation set by T1 is still in effect later.
Without clearing it, the `postgres`-role writes in T14 and T15 would run with a non-null
`auth.uid()`, migration **091's** guard would see a signed-in caller moving `profiles.email`,
and those assertions would die for a reason having nothing to do with 093. The claims are
explicitly cleared before each.

---

## 8. Phase 6, reported not fixed

Full detail in **`docs/093-phase6-observations.md`**.

**(a) The snapshot drifted and history was never repaired.**
`partner_rfp_inbox.agency_company_name` is a snapshot, written at
`app/api/agency/broadcast-rfp/route.ts:242,387` and `lib/magic-token-attach.ts:338`, and
grouped on as a **string** at `components/partner-rfp-surface.tsx:514`. Two spellings of one
company are two groups by construction, which is where "2 agencies" came from for a single
`lead_org_id`.

**This settles open question 4 of `docs/vendor-visibility-report.md`: yes, existing rows do
carry stale snapshots, and the earlier fix repaired the writer, not history.** That report's
checklist looked only for the literal `'Lead agency'` fallback - the *magic-link* failure. The
drift here is wider: a real, correct-at-the-time name superseded by a rename, which that query
would have missed while returning zero.

**Affected row count: NOT MEASURED.** I have no database access. The query is in section (a)
of the observations doc, comparing `agency_company_name IS DISTINCT FROM organizations.name`
rather than matching two literals.

**Backfill shape** (described, **not written and not run** - repair SQL is Greg's): one
`UPDATE ... FROM organizations` joined on `lead_org_id`, `IS DISTINCT FROM` never `<>` (NULL
snapshots exist and `<>` would skip exactly the worst rows), **run as service role or postgres**
because `partner_rfp_inbox` has no agency-side UPDATE policy so a session client matches zero
rows and reports success, no trigger to satisfy, and verify by re-running the count.

**(b) Nav parity.** The agency uses a 260px vertical sidebar with three labelled sections; the
vendor a horizontal top bar with the same three groups **unlabelled**, separated by a rule. A
conversion touches: the nav block in `components/partner-layout.tsx`; **11 vendor pages** whose
content assumes full width; optionally 1,553 `vendor-*` token usages if the *look* is to be
mirrored rather than the *structure*; three agency-only features with no vendor equivalent
(project switcher, new project/client dialogs, subscription gate and usage banner); and
`PartnerChrome`, the no-`PaidUserProvider` shell the bid-submit flow depends on - folding the
shells together would put the bid form back inside the subscription gate.

**The observation worth having before any of that:** the vendor's groups are already the
agency's groups, and after Phase 4 both portals carry the same five stages under the same five
numbers. What is left is an axis and three missing labels.

---

## 9. Gates: Phase 0 baseline vs Phase 7, and every movement explained

Compared against my own Phase 0 run, not against any number in a document.

| Gate | Phase 0 | Phase 7 | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | **exit 0**, 0 lines | **exit 0**, 0 lines | none |
| `pnpm build` | **exit 0**, 71 static pages, **172 routes** | **exit 0**, 72 static pages, **173 routes** | **+1 page, +1 route** |
| `pnpm lint` | **exit 1**, 182 problems (154 errors, 28 warnings) | **exit 1**, 182 problems (154 errors, 28 warnings) | none |
| `pnpm identity-columns:guard` | **exit 0**, PASSED, TOTAL 0, 382 files | **exit 0**, PASSED, TOTAL 0, **385 files** | **+3 files scanned** |
| `pnpm org-id-reads:guard` | **exit 0**, PASSED. A: OPEN 14, ALLOW 3, REGR 0, IMPR 0. B: OPEN 60, REGR 0, IMPR 1. 381 files | **exit 0**, PASSED. **Identical counts.** **384 files** | **+3 files scanned** |
| `pnpm embed-targets` | **exit 0**, TOTAL 0, 382 files | **exit 0**, TOTAL 0, **385 files** | **+3 files scanned** |

`verify-rls` and `policy-audit:guard` were **not run**, at either end. Neither reads a `.ts`
file and nothing in this session could move them.

### Every movement, explained

**`+3 files scanned`, all three guards, both directions.** Exactly three files were added to
the scanned roots: `components/partner-rfp-surface.tsx`, `app/partner/bids/page.tsx`,
`lib/vendor-empty-copy.ts`. `app/partner/rfps/page.tsx` was moved out and a thin page written
back at the same path, so it is not a net change. **3 = 3.** All three guards report the same
delta because they scan the same roots. **No finding moved in any of them.**

**`+1 static page, +1 route`.** `/partner/bids`. `/partner/rfps` is still present in the build
output as a static route.

**`pnpm lint` totals unchanged, and the file set diff is fully accounted for.** Same totals can
hide a swap, so I diffed the finding locations:
- `app/partner/page.tsx` - three findings shifted `:173,257,311` -> `:181,265,319`. **+8 lines**,
  which is the import and the `usePaidUser()` hook added for the empty states. Same rule, same
  three findings.
- `components/partner-layout.tsx` - two findings shifted `:66,102` -> `:75,111`. **+9 lines**,
  the nav-split comment.
- `app/partner/rfps/page.tsx` (two `react-hooks/exhaustive-deps` warnings on `allRows` and
  `allBids`) **moved verbatim** to `components/partner-rfp-surface.tsx` when the file was
  renamed. Same two warnings, same variables, new path.

**No lint finding was added and none was removed.** `pnpm lint` exits 1 at both ends; that is
the pre-existing baseline and this session neither improved nor worsened it.

**Guard allow-lists and KNOWN_OPEN counts were not edited.** The pre-existing
`IMPROVED 1 - lib/entitlements.ts recorded 1, found 0` in the org-id guard's Class B mirror was
present at Phase 0 and is present at Phase 7, untouched.

---

## 10. OPEN items, each with the query or check that settles it

| Id | Item | What settles it |
|---|---|---|
| **OPEN-RS-1** | `app/api/agency/rfp-responses/route.ts:333-337` filters `.in("project_id", [...]).in("partnership_id", [...])` as two independent lists rather than as pairs, so it can match a (project, partnership) combination never in `awardedLookupKeys`. Both lists are agency-scoped, so it is a correctness smell inside one company's data, not a scope defect. | `SELECT count(*) FROM project_assignments a JOIN partner_rfp_inbox i ON i.project_id = a.project_id AND i.partnership_id <> a.partnership_id WHERE i.lead_org_id = '<org>';` - a non-zero result means the cartesian can mis-key an `awarded_at`. |
| **OPEN-RS-2** | `agency_partner_invitations` carries a full class-member policy pair and **zero application reads**. `lib/broadcast-partnership-cue.ts:19` calls it "a DECOY - zero rows". Five live policies on a table nothing reads. | `SELECT count(*) FROM agency_partner_invitations;` - if 0, the five policies can be dropped in a future migration. |
| **OPEN-RS-3** | `payment_milestones` carries three functionally identical partner SELECT policies (079 recreated rather than consolidated, deliberately, at `079_organizations.sql:1505-1532`). Harmless, they OR together, but they are three of the 117. | `SELECT policyname, qual FROM pg_policies WHERE tablename='payment_milestones' AND cmd='SELECT';` - confirm all three predicates are equivalent before consolidating. |
| **OPEN-RS-4** | `resolveActingOrgId()` fails closed on a multi-membership caller with no preference, so the vendor **list** would be empty while the **detail** route (using `resolveCallerOrgIds()`) still serves the row. A list/detail divergence of the same class as the Aug 14 pool bug. Unreachable today. | `SELECT user_id, count(*) FROM org_members GROUP BY 1 HAVING count(*) > 1;` - zero rows means unreachable. **Re-run this the day colleague invitations ship.** |
| **OPEN-RS-5** | `GET /api/projects/[id]/messages` has **no user interface**. Nothing in `app/` (outside `app/api/`), `components/`, `hooks/`, `lib/` or `contexts/` fetches it. The Phase 2 fix is preventive. The email trigger map lists "New message on [Project]" as a live notification. | `grep -rn "/messages" app components hooks lib contexts \| grep -v "^app/api/"` - currently returns no caller. If a UI is built, the fix is already correct. |
| **OPEN-RS-6** | The `agency_company_name` snapshot will drift again after any backfill. `/api/partner/rfps` already batch-loads `organizations` for the meeting link (`:195-209`), so the join the grouping needs is already being made and the group key could be `lead_org_id`. | Product ruling, not a query: it changes what a vendor sees for an agency they have no partnership with (the organization would not resolve and the name would fall back). |
| **OPEN-RS-7** | A bid row on `/partner/bids` links to `/partner/rfps/<id>`, so the nav highlights 01 Open RFPs while the user arrived from 02. Cosmetic. | Visual check on `/partner/bids` after deploy. |
| **OPEN-092-8** | The claim policy pattern match. | **CLOSED BY 093, PENDING APPLY.** Verification V1. |
| **OPEN-092-9** | No column restriction on the vendor UPDATE policy. | **CLOSED BY 093, PENDING APPLY.** Verification V3, and T6-T10 of the pre-apply test. |

---

## 11. Product rulings deferred

| # | Ruling needed |
|---|---|
| 1 | **OPEN-RS-6** - resolve the agency name by join instead of snapshot? Changes what a vendor sees for an agency they have no partnership with. |
| 2 | **The `agency_company_name` backfill itself.** Shape described, deliberately not written. Repair SQL is Greg's. |
| 3 | **Nav parity direction** - mirror the *structure* (three section labels on the existing horizontal bar, cheap) or the *look* (a 260px sidebar, 11 pages plus 1,553 theme tokens)? These are different projects. |
| 4 | **OPEN-RS-2** - drop the five policies on `agency_partner_invitations`, or build the surface they were written for? |
| 5 | **OPEN-RS-3** - consolidate `payment_milestones`' three identical partner SELECT policies, or leave the count at 117? |
| 6 | **P13** (pre-existing, unchanged) - four billing-coupled AI routes still gate on base `role` + `is_paid`. Whether a dual-role user's billing status or their active portal should govern a paid AI feature. |

**Nothing in this session required a product ruling to complete.** No fix changed what a user
may legitimately see; every one corrected which portal shows it.

---

## 12. Commits on this branch

| Commit | Phase |
|---|---|
| `d5a1b26` | 0 - the class inventory, alone, before any code changed |
| `3412240` | 1 - the vendor inbox reads |
| `f5ccfb5` | 2 - `project_messages`, agency arm into the vendor branch |
| `902dd94` | 3 - honest empty states |
| `5958742` | 4 - the nav split |
| `c9a5ffa` | 5 - 093 authored (the only phase that wrote SQL) |
| `c975df9` | 6 - the two observations |

**Not pushed. Not merged. No PR opened.** No migration was applied and no database was
contacted at any point.
