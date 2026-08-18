# 079 hardening run: report

**Branch:** `feat/079-hardening`, branched from `main`.
**Date:** 2026-08-18.
**Pushed:** NO. Merged: NO. Nine local commits.
**SQL executed against any database:** NONE, except `pnpm verify-rls`, which is
read-only and whose result is below.
**Migrations applied:** NONE. 083 is authored and gated.
**079 migration files:** untouched. `git diff main -- supabase/migrations/079_*`
returns empty.

---

## Verification statement: executed versus read

**EXECUTED** in this repository, results reported verbatim below:
`npx tsc --noEmit`, `pnpm build`, `pnpm lint`, `pnpm verify-rls`,
`pnpm org-id-reads:guard`, `pnpm identity-columns:guard`, `pnpm embed-targets`,
`pnpm policy-audit:guard`, the six guard self-tests in Phase 4c, and every scan
whose counts appear in this document. `pnpm lint` and `pnpm policy-audit:guard`
were additionally executed on `main` for comparison.

**READ, not executed:** `supabase/migrations/079_organizations.sql`,
`081_scope_document_and_message_inserts.sql`, `docs/079-release-runbook.md`,
`docs/079-onboarding-docs-regression.md`, `LIGAMENT_CONTEXT.md`, and every source
file quoted.

**NOT AVAILABLE:** the production database, Vercel runtime logs, and any
authenticated browser session. Every statement about live data is derived from
migration source or quoted from the brief. No query was run against production.

---

## 1. The gate table

| Gate | Exit | Notes |
|---|---|---|
| `npx tsc --noEmit` | **0** | |
| `pnpm build` | **0** | |
| `pnpm lint` | **1** | Pre-existing. **182 problems, 154 errors, 28 warnings.** Byte-identical to `main`, which I ran for comparison and which reports the same 182/154/28. This ~70-file change introduced **zero** new lint problems. ESLint is report-only by standing decision. |
| `pnpm org-id-reads:guard` | **0** | Class A baseline 25, unchanged. Class B baseline 91, newly established. |
| `pnpm identity-columns:guard` | **0** | |
| `pnpm embed-targets` | **0** | |
| `pnpm policy-audit:guard` | **1** | Pre-existing. Output is **byte-identical to `main`** (`diff` reports no difference). See section 8: it does NOT behave differently, and the reason is worth acting on. |
| `pnpm verify-rls` | **2** | **This gate cannot be closed from the CLI at all.** See section 7. Not 0, not 1. Also exits 2 on `main`. |

---

## 2. Phase 0. The measurement, and why it is not 188

**I do not reproduce 188. I measure 230 across 73 files, and then found 8 more
that neither number contains.**

| Scan | Sites | Files |
|---|---|---|
| Stated yesterday | 188 (+1 correct = 189 raw) | 59 |
| Literal re-run of the stated definition, comments excluded | 182 | 60 |
| Plus org columns compared to a **profile row id** | 197 | 65 |
| Plus org columns fed from a **`userId`-family local** | **230** | **73** |
| Plus **aliased locals** (`const agencyId = user.id`), found in Phase 4 | **238** | **75** |

Reconciliation, precisely:

1. The literal definition returns 182, not 188. Adding the profile-row-id form
   brings `app/api/partnerships/route.ts` to exactly 15 and both
   `app/api/projects/route.ts` and `app/api/agency/msa/milestones/route.ts` to
   exactly 10, three of the four per-file figures quoted yesterday. So 188 and my
   197 are the same measurement; the residue is map-building false positives I
   include and it did not.
2. `app/api/agency/rfp-responses/[id]/route.ts` reaches 11 in my scan against 13
   quoted. **I could not reconstruct the missing 2 and did not invent them.**
   Every line of that file carrying an org column was read and classified anyway,
   so the gap is in the counting, not the coverage.
3. **The extra 33 are real.** The stated definition matches the literal tokens
   `user.id`, `session.user.id` and `auth.uid()`. Seven files spell the identical
   defect as a `userId`-family local, including three whole route files that never
   appeared in yesterday's list: `app/api/agency/scoring/criteria/route.ts` (8),
   `app/api/agency/delivery-reviews/route.ts` (8),
   `app/api/agency/pool/[partnerId]/performance/route.ts` (4). And
   `lib/partner-inbox-access.ts:22`, which is an access-control function.
4. **The last 8 were found by the widened guard, not by any scan I wrote.**
   `app/api/agency/dashboard/route.ts` and `app/api/partner/dashboard/route.ts`
   open with `const agencyId = user.id` / `const partnerId = user.id` and then
   filter six and two organization columns by it. Both were invisible to the 188
   AND to my 230, for the same reason: both matched a literal token. Teaching
   `scripts/check-org-id-reads.mjs` one level of local alias resolution surfaced
   them. **This is the strongest single argument in the run for not trusting a
   line-based count, including mine.**

### Phase 0a: the helper inventory

Full signatures, set kinds and clients are in
`docs/079-hardening-inventory.md`. The conclusion: `resolveCallerOrgIds()` fits
every READ; nothing fitted a WRITE, so **one** new helper was added.

`resolveCallerWriteOrgId(userId, client): Promise<string | null>` in
`lib/entitlements.ts`. Same owner > admin > member ranking as
`agencyEntitlementId()`, opposite failure: it returns `null` rather than falling
back to `userId`. That fallback is right for quota accounting, where failing
would take the AI surface down, and wrong on a write path, because `userId` is
exactly the value that raises 23503 against `organizations(id)`.

The five SQL helpers 079 creates were also inventoried, and the authority/visibility
split is recorded so it cannot be forgotten:
`current_user_org_ids()` and `current_user_admin_org_ids()` are AUTHORITY sets and
may scope a write. `current_user_counterparty_org_ids()`,
`current_user_visible_profile_ids()` and
`current_user_active_counterparty_user_ids()` are VISIBILITY sets and must never
scope a write. **No rewrite in this run uses a visibility set anywhere.**

### Phase 0c: the classification

| Tier | Count | Files |
|---|---|---|
| A, mechanical, fixed | 208 (+8 found later = **216**) | 68 (+2 = **70**) |
| B, judgment, NOT fixed | 10 | 8 |
| C, correct as written | 12 | 11 |
| Unclassified | **0** | |

### Why every Tier A rewrite is equal-or-narrower

079 PHASE 2 inserts exactly one `organizations` row and one `org_members` row per
profile, with `organizations.id = profiles.id`. So `resolveCallerOrgIds(user.id)`
returns exactly `[user.id]` for all sixteen live accounts, and
`.in(col, callerOrgIds)` selects the identical set `.eq(col, user.id)` did.
**No Tier A rewrite changes a single observable result on the current database.**
Any site that would have was moved to Tier B and left alone. Reads scope to the
caller's memberships; writes scope to one organization the caller is a member of;
the two are never conflated.

---

## 3. Phase 1. The two ghost-claim writes

`app/api/partnerships/route.ts` and `app/auth/callback/route.ts` both wrote
`user.id` into `partnerships.vendor_org_id`, a foreign key to `organizations(id)`
after 079. One logged the error and continued; the other did not destructure an
error at all.

Both now resolve the caller's own organization through
`resolveCallerWriteOrgId()`.

**Timing, checked rather than assumed.** 079 PHASE 12's `handle_new_user()` fires
on `INSERT INTO auth.users`, which is signup, strictly before email confirmation,
and creates the `organizations` and `org_members` rows in the same statement as
the profile. So the membership exists when the callback runs. It is still
resolved, and a `null` result aborts rather than writing a wrong value. The
session client can read it: 079 PHASE 11 grants
`"Members read their own membership row" USING (user_id = auth.uid())` to
`authenticated`.

### What the user sees when it fails

| Site | Before | After |
|---|---|---|
| `GET /api/partnerships` | HTTP 200, an inbox that looks merely empty, one line in the server log | **HTTP 500** with "Your account is not linked to an organization yet, so these invitations could not be claimed" or "An invitation could not be claimed for your account". Only reachable when there IS an unclaimed invitation, so availability is spent only on the case already broken. |
| `GET /auth/callback` | Redirect onward as though nothing happened; the vendor lands on an empty portal | **Redirect to `/auth/error`** with "Your email is confirmed, but we could not link your pending invitations to your account. Please sign in and contact support if your invitations are still missing." It first checks whether anything is pending, so an ordinary confirmation never sees it. |

### Phase 1c: are there other writes of a user id into an org column?

**No. There were many more, and the brief's figure of two is a large undercount.**
I enumerated every assignment into an organization column across
`app/ lib/ components/ contexts/ hooks/`: 129 total, of which 42 are type
declarations. Of the remaining 87:

| Class | Count at the start of the run | Status |
|---|---|---|
| A **session user id** written into an org column | **27** | All fixed. The two named in the brief are 2 of these 27. |
| A **counterparty profile id** written into an org column | **6** | Tier B. Not fixed. Listed in section 4. |
| Correct: an org-valued variable | 14 | No change |
| Depends on the caller (an org column written from a helper parameter) | ~40 | The indirect class, section 6. |

The 25 session-id writes beyond the brief's two include
`projects`, `clients`, `client_cash_flow`, `msa_agreements`, `bid_evaluations`,
`bid_decompositions`, `bid_comparisons`, `bid_scoring_criteria`,
`bid_scoring_templates`, `delivery_reviews`, `agency_library_documents`,
`onboarding_packages`, `onboarding_deployments`, `partner_rfp_inbox`,
`partner_rfp_responses`, `partner_access_requests`, `partner_vouches`,
`invitation_requests` and `partnerships`. Each was a 23503 waiting for the first
account created after 079.

---

## 4. Phase 3 and the Tier B list, with a recommendation for each

216 Tier A sites across 70 files rewritten, in five commits. After Phase 3 the
re-scan leaves exactly the Tier B and Tier C sets and **no A1, A2, A3, A4 or A5
shape anywhere** in `app/`, `lib/`, `components/` or `contexts/`.

### The full Tier B list

| # | Site | What it is | Recommendation |
|---|---|---|---|
| B-1 | `app/api/partnerships/route.ts:534` | `partner.id` filters `vendor_org_id` | Group with B-2 |
| B-2 | `app/api/partnerships/route.ts:666` | **WRITE**, `insertData.vendor_org_id = partner.id` | Add `resolveOrgIdForUser(userId, { capability: 'vendor' \| 'lead' })`, resolving through `org_members` joined to `organizations` and filtered on `is_vendor` / `is_lead_agency`, returning `null` on ambiguity rather than picking. Then fix B-1 to B-6 in one reviewable change. |
| B-3 | `app/api/agency/broadcast-rfp/route.ts:325` | `existingProfile!.id` filters `vendor_org_id` | Same helper as B-2 |
| B-4 | `app/api/agency/broadcast-rfp/route.ts:342` | **WRITE**, `vendor_org_id: isExistingUser ? existingProfile!.id : null` | Same helper as B-2 |
| B-5 | `app/api/agency/rfp-responses/[id]/route.ts:358` | **WRITE**, `vendor_org_id: matchedProfile.id` backfilled on the award path | Same helper as B-2. **Highest severity of the six**: it fires on award, which is the most consequential action in the product. |
| B-6 | `app/api/rfp/guest/[token]/route.ts:602` | **WRITE**, `vendor_org_id: is_existing_partner ? matchedProfile!.id : null` | Same helper as B-2 |
| B-7 | `app/partner/network/page.tsx:522` | **WRITE**, `lead_org_id: selectedAgency.id` | `/api/marketplace/discoverable` must return the organization id alongside the profile id, and the page must write that. An API contract change, which is why it is not mechanical. The **vendor half of the same insert IS fixed.** |
| B-8 | `app/partner/network/page.tsx:658` | `req.lead_org_id === agency.id` at render | Follows B-7 |
| B-9 | `app/agency/pool/[partnerId]/page.tsx:273` | **WRITE**, `partner_vouches.vendor_org_id = partnerId`, a profiles id from the route param | Same helper as B-2. The **`lead_org_id` half IS fixed.** |
| B-10 | `lib/entitlements.ts:173` | `agencyEntitlementId()` returns `best?.org_id ?? userId` | **Leave it exactly as it is.** The fallback is deliberate and correct for quota accounting, and two live callers feed it into `claimAwardedGhostPartnershipsByEmail`. Changing it under them is a behaviour change, not a hardening. `resolveCallerWriteOrgId()` is the write-path alternative and already exists. |

Two additional sites in the same spirit, found during Phase 4 and NOT in the
inventory: `app/api/agency/rfp/magic-link/route.ts:204` and
`app/api/partner/partnerships/claim/route.ts:43` already resolve a write org, but
through `agencyEntitlementId()`, which means they inherit B-10's fallback on a
write path. **Recommendation: switch both to `resolveCallerWriteOrgId()`.** Not
done here because it changes their failure behaviour from "write a user id" to
"refuse", which is the same availability-versus-correctness call as B-10 and
deserves to be made deliberately.

### Tier C

Twelve sites, each read at source. Ten pass an organization id into a parameter
that wants one, or copy one into a map value, with no user id on the line. One
(`app/partner/network/page.tsx:500`) is inside an `isDemo` branch that writes
React state and never reaches the database. One (`lib/entitlements.ts:116`) is
`resolveCallerOrgIds` itself, selecting `org_id` filtered BY `user_id`, which is
the resolution and not the confusion. That is the one known-correct hit the brief
names.

---

## 5. Phase 2. Migration 083

`supabase/migrations/083_orphaned_insert_policies.sql` and its down migration.
**AUTHORED, NOT APPLIED.** Both carry a STOP GATE header naming Greg as the
applier and listing the four-step sequence.

- Reproduces both policy bodies from migration 081, changing **only** the identity
  comparison, to the exact substitution 081's own `079:` markers predicted:
  `p.org_id = auth.uid()` and `pt.vendor_org_id = auth.uid()` become
  `... IN (SELECT public.current_user_org_ids())`.
- `uploaded_by = auth.uid()`, `sender_id = auth.uid()` and the
  assignment-belongs-to-the-same-project `EXISTS` clause survive unchanged. The two
  person columns **stay** compared to `auth.uid()` deliberately: rewriting them
  through the helper would be the same category error pointing the other way.
- Plain `DROP POLICY`, no `IF EXISTS`, per the 079/081 convention, with the reason
  written out: DROP and CREATE share one transaction, so a stale name would leave
  the replacement OR-ed beside the original and the exposure would survive a fix
  that reported success.
- One transaction, explicit `BEGIN` and `COMMIT`.
- A read-only **PRE-FLIGHT CAPTURE** (P1 to P4) and a six-query **VERIFICATION**
  block (V1 to V6) with expected values: exactly one INSERT policy per table,
  per-table totals 5 and 4, schema-wide total unchanged.

**One correction to the brief's expected value, stated rather than silently
applied.** The brief says the schema-wide total is "unchanged at 108". 108 is the
079 runbook's figure for 079-applied-and-nothing-else. Migration 080 adds 3, giving
111, and 082 may add more. **The invariant 083 must satisfy is that the count AFTER
equals the count BEFORE**, because it drops two and creates two. The verification
block states 108, and states plainly that equality with the pre-flight capture is
the real assertion and 108 the expected-if-nothing-else-is-applied value.

---

## 6. Phase 4. The guard

### Before and after

| | Before | After |
|---|---|---|
| Classes detected | 1 (a `profiles` row fetched by an org id) | 2 |
| Tables inspected | `profiles` only | **every table** |
| Writes inspected | no | **yes** |
| Class A baseline | 25 open, 1 allow-listed, 19 files | **unchanged: 25 open, 1 allow-listed** |
| Class B baseline | did not exist | **91 sites, 33 files**, every entry with a reason |
| Registered in `package.json` | no | `org-id-reads`, `org-id-reads:guard`, `embed-targets` |

Class B detects five shapes: `FILTER` (55), `WRITE` (29), `GUARD` (5), `ORSTR` (1),
`FALLBK` (1). Three confidence tiers, reported separately rather than flattened:

- **SESSION** (1) the caller's own id, including one level of resolved local
  aliasing. Proven.
- **PROFILE** (9) a counterparty's `profiles.id`. Proven, and not mechanically
  fixable.
- **PARAM** (81) a local or parameter named like a person. **Suspect, not proven**:
  inside a `lib/` helper the answer depends on the caller. It earns its noise by
  being the only signal that reaches the 21 helpers in section 6.1. Two entries in
  the baseline are marked FALSE POSITIVE with the read that established it.

The `KNOWN_OPEN` mechanism and exact-count semantics are preserved for both
classes, including that a count BELOW baseline is reported rather than silently
accepted.

### Phase 4c: the self-test, all six executed

| # | Action | Expected | **Observed** |
|---|---|---|---|
| 1 | Clean tree | 0 | **0** |
| 2 | Inject `.eq("lead_org_id", user.id)` into an unbaselined file | 1 | **1**, naming `app/api/agency/utilization/route.ts found 1, KNOWN_OPEN_MIRROR records 0` |
| 3 | Revert | 0 | **0** |
| 4 | Inject the ghost-claim WRITE shape `{ org_id: user.id }` | 1 | **1**, naming `app/api/agency/clients/route.ts found 1, records 0` |
| 5 | Grow a file already at baseline 2 | 1 | **1**, naming `app/api/partnerships/route.ts found 3, records 2` |
| 6 | Drop a file BELOW its baseline | 0 with a report | **0**, printing "recorded 2, found 1" and asking for the count to be lowered |

Test 4 is the one that matters most: **the widened guard catches the exact shape of
the two ghost-claim writes that the old guard never flagged.**

### 6.1 The class no guard can bound, measured

21 exported helpers in `lib/` filter or write an organization column from a
parameter. **19 call sites in 17 files pass a user id into one of them.** None is
visible to any line matcher, because the defect is a stack frame away from the
column name. Not fixed in this run and not claimed to be.

| Call site | Helper | Used inside as |
|---|---|---|
| `app/api/agency/bids/[responseId]/ai-score/route.ts:184` | `resolveRfpRubricForResponse(_, _, user.id)` | `.eq("lead_org_id", agencyId)` |
| `app/api/agency/bids/[responseId]/ai-score/route.ts:222` | `loadBidAnalysisContext(_, _, user.id)` | 7 org filters |
| `app/api/agency/bids/[responseId]/decompose/route.ts:137` | `loadBidAnalysisContext` | same |
| `app/api/agency/bids/compare/route.ts:113, :118` | `loadBidAnalysisContext` | same |
| `app/api/agency/bids/rank/route.ts:58` | `resolveResponseScope` | same |
| `app/api/agency/bids/[responseId]/generate-summary/route.ts:25` | `generateAndSaveBidSummary` | `.eq("lead_org_id", agencyId)` |
| `app/api/agency/clients/[id]/route.ts:37` | `fetchScopedLibraryDocuments` | 4 org filters |
| `app/api/agency/library-documents/route.ts:32` | `fetchScopedLibraryDocuments` | same |
| `app/api/agency/pool/resend-invitation/route.ts:81` | `markPartnershipInvited({ agencyId: user.id })` | **a `partnerships` INSERT** |
| `app/api/agency/rfp-responses/[id]/route.ts:369` | `resolvePartnershipForAward({ agencyId: user.id })` | **4 writes** |
| `app/api/projects/route.ts:587`, `app/api/projects/[id]/route.ts:79` | `reconcileProjectClientFields` | `.eq("org_id", agencyId)` |
| `app/api/partner/rfps/route.ts:125`, `app/api/partner/rfps/bids/route.ts:113` | `attachMagicTokenToPartnerInbox` via a sweep | **3 writes to `vendor_org_id`** |
| `app/api/partner/rfps/bids/route.ts:65` | `claimAwardedGhostPartnershipsByEmail({ partnerId })` | **1 write** |
| `app/partner/profile/page.tsx:211` | `fetchVouchCount(_, user.id)` | `.eq("vendor_org_id", partnerId)` |
| `app/api/agency/rfp-responses/[id]/route.ts:521, :680, :771` and `app/api/partnerships/route.ts:614, :729, :943` | `recordMilestone({ orgId: user.id })` | `milestone_events.org_id` |

Note that `app/api/partner/projects/route.ts:59` and
`app/api/partner/rfps/route.ts:133` call the same
`claimAwardedGhostPartnershipsByEmail` **correctly**, through
`agencyEntitlementId()`, while `bids/route.ts:65` passes the raw user id.
**The hardening is inconsistent across three callers of one helper**, which is
itself the argument for fixing it at the helper rather than at each caller.

### Phase 4d: generated types

Full scoped assessment in `docs/079-generated-types-assessment.md`. Headline:

- **Generated types alone do NOT catch this bug.** `organizations.id` and
  `profiles.id` are both `string`, so `.eq("org_id", user.id)` type-checks
  perfectly. Closing the class needs **branded ids** on top of generation, plus a
  hand-maintained column-to-brand map that `supabase gen types` does not emit.
- They WOULD catch, by construction: the entire parameter-passing class in 6.1,
  aliasing, misspelled columns, and wrong-shaped insert payloads.
- Cost: 497 bare-string `.eq()` sites, 132 client constructions, 40 tables, and
  three files already carrying a loose client type specifically to dodge TS2589.
- Time: **4 to 7 days** for generated types working end to end, **6 to 11** to
  actually close this class with brands.
- Recommendation: do it, not on this branch, and start this week by committing
  `lib/supabase/types.ts` unused, which costs an hour and is risk-free.
- **One cheap thing regardless:** stop naming organization-valued locals
  `agencyId` and `partnerId`. Both dashboard routes hid their defect behind exactly
  that name.

---

## 7. Phase 6. The two gates that are not green, in detail

### `pnpm verify-rls` exits 2, and cannot exit 0 or 1 from the CLI

This is the gate the brief describes as having "no result from yesterday". It has
no result because **it structurally cannot produce one on this Supabase project.**

Executed. Full output:

```
Querying pg_class for RLS-enabled tables...
  pg_class query error: Could not find the table 'public.pg_class' in the schema cache
  (pg_class may not be accessible via PostgREST on this project)
```

Exit 2 is the script's own documented "could not connect / missing env vars" code.
It connected fine: it printed the project URL and the service-role key prefix. What
failed is that **PostgREST does not expose `pg_class`**, and the script queries the
system catalogs through PostgREST. This is not a policy problem, not a 079 problem,
and not something this branch introduced: `pnpm verify-rls` exits 2 on `main` too,
and `git diff main -- scripts/verify-rls.mjs` is empty.

**So the gate is not closed, and I am not reporting it as closed.** The script
prints the SQL to run instead, and it is in the checklist below as item 1. Closing
it properly means either running that SQL in the SQL Editor, or rewriting the
script to go through a Postgres connection string rather than PostgREST.

### `pnpm policy-audit:guard` exits 1, and does NOT behave differently

The brief asks specifically whether this behaves differently now that 079 is
applied. **It does not.** I ran it on this branch and on `main` and `diff` reports
the two outputs are byte-identical: 104 policies parsed, 60 on company-scoped
tables, 53 flagged, 6 allow-listed, exit 1.

The reason it cannot have changed: it reads a **static file**,
`docs/schema-snapshot-2026-08-13.md`, not the database. That file is a `pg_policies`
dump from before 079, which is why the flagged policies it prints still name
`agency_id = auth.uid()` on tables where that column no longer exists.

**Recommendation, and it is worth doing before the next migration:** re-take the
`pg_policies` capture from the live post-079 database, save it as
`docs/schema-snapshot-2026-08-18.md`, and repoint the script. Until then this guard
is auditing a database that no longer exists, and its exit 1 carries no information
about the current one. The snapshot's own footer warns about the 100-row silent
truncation in Supabase exports, so split the query by table-name range and count
the rows.

---

## 8. Phase 5. The onboarding documents

### 5a and 5b, both applied

- **`app/api/projects/[id]/onboarding-packages/route.ts`** returns **400** when
  `rawDocs.length > 0 && docs.length === 0`, logging `rawDocCount` and
  `droppedBlankSlots`, instead of creating a package, emailing the vendor that
  their documents are ready, and returning success. Deliberately **not** triggered
  by `documents: []`, which is a legitimate no-documents package.
- **`components/stage-03-onboarding-workflow.tsx`**: all three `continue`s now name
  which attachment was discarded and why, to the user and to the console.

**One behaviour change, stated rather than buried.** The brief says "do not change
what qualifies as valid". The predicate deciding whether a document enters `docs`
is byte-for-byte unchanged. What DID change is when a send proceeds: a row with
exactly one of label and url now blocks the send with that row named. A row with
**neither** is an untouched "Add item" placeholder, is treated the same way the
route treats it, and is logged and skipped rather than blocking. That distinction
was drawn deliberately so that clicking "Add item" and ignoring the row does not
become impossible to ignore.

### 5c. The three conditions, read from source

Line numbers are the PRE-FIX ones the brief names. After the 5b edit the same three
sites are at `:447`, `:462` and `:485`, each now carrying a `DROP A` / `DROP B` /
`DROP C` comment.

| Drop | Line | Fires when |
|---|---|---|
| **A** | `:428` | `library.find(l => l.id === id)` misses. `library` is reloaded by `refreshLibrary` whenever `selectedProject` changes; **`selectedLibIds` is cleared in exactly one place, line 489, after a successful send, and NEVER on a project switch.** A selection made under project A therefore survives into project B, where the lookup misses. The checkbox renders unchecked, so nothing on screen contradicts the user. Also fires when the library fetch failed and `library` is `[]`. |
| **B** | `:430` | `libraryUrl(row)` returns `""`. It returns `external_url` only when `source_type === "url"` AND `external_url` is set, otherwise `blob_url`. So it needs a library row with neither a stored file nor an external link. The checkboxes are `disabled` when `!libraryUrl(d)`, so this is not reachable from a fresh page load. |
| **C** | `:441` | `raw` is empty. `raw` is `storedUrl` when `source === "file"` and `urlInput` otherwise. `uploadForAttach` sets `storedUrl` only on success, and the Send button's guard is `disabled={sending || !partnershipId}`, which does **not** include `uploadingAttach`. So an in-flight upload is reachable by clicking Send during it. Also fires on a failed upload, and on a row with a label and no url. |

### Can I now establish the root cause? No, and here is the sharpened boundary.

**I cannot, and I will not present a hypothesis as a finding.**

What the source DOES now settle, which yesterday's report could not: the brief
records that one of the three sends had the Label filled and the upload **visibly
complete**. Read from source, "visibly complete" has one meaning. The badge is at
`components/stage-03-onboarding-workflow.tsx:932-936` (it was at :846 before the 5b
edit shifted it):

```
{p.storedUrl && (<span ...><CheckCircle .../>Uploaded</span>)}
```

and it renders **only inside the `p.source === "file"` branch** of the row. So
seeing "Uploaded" means `p.storedUrl` is truthy AND `p.source === "file"`. In
exactly that state, `raw = (p.storedUrl || "").trim()` is non-empty and the label
is non-empty, so **drop C cannot fire for that row.**

**Therefore the upload race does not explain that send.** That is a real narrowing:
it removes candidate #1 from yesterday's ranked list for at least one of the three
sends, and leaves drop A, the stale `selectedLibIds` across a project switch, as
the only remaining candidate consistent with a filled label, a completed upload,
and an empty `documents` array.

I stop there. Drop A is now the leading candidate rather than a confirmed cause,
because I have no browser state, no request body, and no runtime log, and because
"the only remaining candidate I can think of" is not the same as "the cause".

**One caveat that would falsify the whole chain**, and it is worth stating: every
step above rests on yesterday's deduction that `docs.length === 0` at the route,
which rests on the vendor having received the email. If the Vercel log shows a
**populated** `documents` array in that request, the deduction is wrong, the route
is back in scope, and everything in this section must be re-derived.

### What would settle it

1. **The Vercel runtime log for `POST /api/projects/[id]/onboarding-packages` at
   2026-08-18 14:55, showing the request body.** Decisive. `documents: []` confirms
   a client-side drop; a populated array falsifies the deduction outright.
2. The browser console for that session. The new `console.warn` lines added in 5b
   now name the drop and its reason, so **a fourth occurrence is self-diagnosing.**
3. Whether the user switched projects between attaching and sending. Confirms or
   kills drop A.
4. Whether the attachment was a library checkbox or a "Project documents" upload.
   Library points at A or B; upload points at C.

### 5d. REPORT ONLY, not fixed: you cannot tell what you uploaded

**Confirmed from source.** `components/stage-03-onboarding-workflow.tsx:932-936`
renders a green check and the literal word "Uploaded". The filename appears
nowhere. `ProjectAttach` (line 63) is
`{ localId, label, urlInput, storedUrl, source }` and **has no filename field at
all**: `uploadForAttach(localId, file)` receives the `File` and stores only
`data.url` from the upload response.

So a user who uploads two documents sees two identical green "Uploaded" badges and
has no way to tell which row holds which file, or whether a row holds the file they
meant. That is also why the 2026-08-18 sends looked correct on screen.

**Proposed change:** add `fileName: string | null` to `ProjectAttach`, set it in
`uploadForAttach` from `file.name` alongside `storedUrl`, and render it in place of
the bare word:

```tsx
{p.storedUrl && (
  <span className="text-xs text-success font-mono inline-flex items-center gap-1">
    <CheckCircle className="w-3.5 h-3.5" aria-hidden />
    {p.fileName || "Uploaded"}
  </span>
)}
```

Three lines, no server change, no migration. `newAttach()` gains `fileName: null`,
and the `source: "url"` reset at line 788 clears it alongside `storedUrl`. Worth
doing in the same pass as any of the drop fixes.

### 5e. REPORT ONLY, not fixed: the deploy route still reports success on a failed upsert

**Confirmed still live.** `app/api/projects/[id]/onboarding/deploy/route.ts:162`:

```ts
if (upErr) console.error('assignment_agreements upsert:', upErr)
```

That is the whole handling. Execution continues to `createOrgNotification` (line
174), `sendTransactionalEmail` with subject "Your onboarding package is ready"
(line 199), and `return NextResponse.json({ success: true, deployment })` (line
206).

**The exposure:** an NDA or SOW row that was supposed to be created with
`status: 'sent'` is not created. The vendor is emailed that their onboarding
package is ready and the agency sees success. Nothing in either portal will show
the agreement, because the row does not exist, and no one is told. It is the exact
same class as the onboarding-documents bug this phase exists to close, on a
neighbouring route, and it is worse in one respect: an NDA is a legal artifact, and
"the agency believes an NDA was sent and it was not" is a materially different kind
of wrong than a missing link.

**Mitigating fact, and the reason I rank it lower than it first appears:**
`components/stage-03-onboarding-production.tsx` is the only caller of this route,
and **nothing imports or renders it** (verified by grep across `app/` and
`components/`). The route is currently unreachable from the product. It is dead
code with a live defect, which means it is not causing harm today and will cause it
on the day someone mounts that component.

**Recommendation:** either delete the dormant route and component together, or fix
it to match its sibling: on `upErr`, roll back the `onboarding_deployments` row and
return 500 before the email, exactly as `onboarding-packages/route.ts:339-343`
already does. **Do not leave a third option** where it stays unmounted and unfixed,
because the next person to mount it will have no reason to suspect it.

---

## 9. What I could not establish

1. **The 2 missing sites in `app/api/agency/rfp-responses/[id]/route.ts`.** Quoted
   as 13, I measure 11. I read every org-column line in the file and classified all
   of them; I could not reconstruct which 2 the earlier count included.
2. **The root cause of the onboarding document loss.** Narrowed, not settled. See
   8.5c.
3. **Whether `pnpm verify-rls` would pass.** The script cannot query the catalogs
   through PostgREST on this project, so the gate is open. Not closed, not claimed
   closed.
4. **Whether the live policy count is 108 or 111.** Depends on whether migrations
   080 and 082 are applied, which I cannot check without a database. 083's
   verification block handles this by asserting equality with its own pre-flight
   capture instead.
5. **Whether the PARAM tier of the class B baseline contains more false positives
   than the two I identified.** 81 sites, each needing a caller read. I read the
   ones that mattered for the SESSION and PROFILE tiers and spot-read the rest.
6. **Whether the two ghost-claim fixes work end to end**, which needs a real signup
   against a real database. Item 5 in the checklist.

---

## 10. Numbered live checklist for Greg

Nothing below has been done. Items 1 to 3 are read-only.

**1. Close the `verify-rls` gate by hand.** Supabase SQL Editor, read-only:

```sql
SELECT c.relname AS table_name, COUNT(p.polname)::int AS policy_count
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
GROUP BY c.relname ORDER BY c.relname;
```
**Expect:** every row with `policy_count` greater than 0. **Any row with 0 is a
silent total lockout of that table.** If all are non-zero, the gate is green and
the CLI script is simply the wrong tool.

**2. Record the live policy count, needed by item 4.** Read-only:

```sql
SELECT count(*) FROM pg_policies WHERE schemaname='public';
```
**Expect:** 108 if only 079 is applied, 111 if 080 is too. **Write the number
down.**

**3. Confirm the two orphaned policies are in the state 083 expects.** Read-only:

```sql
SELECT tablename, policyname, cmd, roles, with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('project_documents','project_messages')
  AND cmd='INSERT' ORDER BY tablename;
```
**Expect:** exactly 2 rows, both `{authenticated}`, and both `with_check` bodies
containing `p.org_id = auth.uid()` and `pt.vendor_org_id = auth.uid()`.
**If you see `agency_id` or `partner_id`, 079 is not applied to this database and
you must STOP.** If you already see `current_user_org_ids()`, 083 has been applied
and items 4 and 5 are done.

**4. Apply migration 083.** Paste
`supabase/migrations/083_orphaned_insert_policies.sql` into the SQL Editor and run
it. **Expect:** "Success. No rows returned." Then run V1 to V5 from the foot of
that file. **Expect:** exactly 1 INSERT policy per table; per-table totals 5 and 4;
schema-wide count equal to what you wrote down in item 2; `calls_helper` true and
both `still_broken` columns false on both rows; V5 returns 0 rows. **If any
disagrees, run `083_orphaned_insert_policies_down.sql` and stop.**

**5. Smoke-test 083 in the browser, which no query above covers.**
As `gmarkant@gmail.com`, open a project and upload a document. **Expect:** it
saves. As `gmarkant@icloud.com`, open a project you are assigned to and post a
message. **Expect:** it sends. **A "new row violates row-level security policy" on
either means the predicate is wrong for a real caller: roll back with the down
migration.**

**6. The test that actually proves this whole run, and it needs a new account.**
Sign up a brand-new vendor at a fresh email address. That account gets an
organization with `gen_random_uuid()`, which is the condition none of the sixteen
live accounts can reproduce.
- **6a.** From `gmarkant@gmail.com`, invite that email to your partner pool.
- **6b.** As the new vendor, confirm the email and follow the invitation link.
  **Expect:** the invitation appears. **Before this run it would have shown "No
  invitations yet" with no error anywhere.** If it fails now you get an explicit
  error page saying your email is confirmed but the invitations could not be
  linked, which is the intended change.
- **6c.** As the new vendor, open `/partner/rfps`, `/partner/projects` and
  `/partner/dashboard`. **Expect:** real content, not empty lists.
- **6d.** From the agency side, open `/agency/dashboard`, `/agency/pool` and
  `/agency/bids`. **Expect:** unchanged, since your organization is a backfilled
  one.

**7. Re-test the onboarding send that failed three times.**
`/agency/onboarding`, attach one library document and one uploaded project
document, and send. **Expect:** it succeeds and the package shows both documents.
Then deliberately click Send while an upload spinner is still running. **Expect:**
a message naming the row, not a success modal. Then attach a library document,
switch projects, switch back and send. **Expect:** a message naming the dropped
library document, which is drop A made visible and is the leading candidate for the
original failure.

**8. Decide the two things this run deliberately did not.**
- The Tier B counterparty resolver (`resolveOrgIdForUser`), which unblocks B-1 to
  B-9, including the award-path write at `rfp-responses/[id]/route.ts:358`.
- Whether `app/api/projects/[id]/onboarding/deploy/route.ts` and its unmounted
  component get deleted or fixed. Leaving it unmounted and unfixed is the one
  option that is worse than either.

**9. Regenerate the policy snapshot.** `docs/schema-snapshot-2026-08-13.md`
predates 079, which is the entire reason `pnpm policy-audit:guard` exits 1. Re-take
the `pg_policies` capture, save it as `docs/schema-snapshot-2026-08-18.md`, and
repoint `scripts/audit-policy-snapshot.mjs`. Split the query by table-name range:
Supabase truncates exports at 100 rows silently, and there are more than 100.

**10. Do not push this branch until items 4 and 6 pass.** The code is correct
before 083 is applied and correct after, but item 6b is the only test in this list
that exercises the defect this run exists to close.
