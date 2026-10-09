# 109-112: bid scoring and delivery review private fields move to tables no vendor can read

**Merge status:** NOT MERGED, NOT PUSHED, NOT APPLIED. Checked 2026-10-09 with `git merge-base --is-ancestor HEAD origin/main`, exit 1, on branch `fix/109-112-scoring-and-reviews-split`. Re-run that check before trusting this line; it is never updated by hand.

## Read these first

1. **Every one of the 10 in-scope columns is AGENCY-ONLY.** No vendor or guest screen renders any of them, so no STOP condition on rendering fired. All 10 were moved.
2. **A vendor can WRITE four of them today, not just read them.** "Partners update own RFP responses" (079:1414-1416) has no column limit and `partner_rfp_responses` has no guard trigger. A vendor can set its own `composite_score` and `ai_summary_*` through PostgREST, and until this code deploys the agency reads those values back. The code closes the read side when the table exists (109); 110's guard closes the write side.
3. **Three whole-row leaks were live on API routes, one of them unauthenticated.** These were the vendor RFP detail GET, the vendor bid save POST, and the guest magic-link GET (service role, token only). All three now use an explicit vendor column list. That closes them on deploy, before any migration.
4. **The vendor bid save route wrote the agency's AI summary under the vendor's own session.** It had to move to the service role, or vendor-submitted bids would silently stop getting summaries after 109. The guest route already used the service role.
5. **Nothing here ran against Postgres.** I grammar-parsed every SQL file, every DO and trigger body as PL/pgSQL, and every scenario statement with pglast 8.3 (PostgreSQL 17 grammar): 0 failures, with a negative control that does fail. That is syntax only. Each pre-apply test will probably need a first-run fix.
6. **Expect "DO NOT APPLY ... YET" from all four tests on this database.** B1 and B2 (another agency) will be NO SUBJECT, because m a r k a n t is the only lead organization with members. That is INCONCLUSIVE, never PASS, as in 107. Decide whether to accept it after reading the policy predicate, or create a second lead organization for the run.

## Phase 0: inventory

Method: two read-only subagent sweeps (one per table) over `app/ lib/ components/ hooks/ contexts/ scripts/ supabase/migrations/`, then my own grep of every `from("partner_rfp_responses" | "delivery_reviews")` site (64) and its select clause. **That is a floor, not a ceiling:** a table reached through a variable, an RPC or a SQL function would not appear, and none was found.

### Classification

| Table | Column | Class | Evidence |
|---|---|---|---|
| partner_rfp_responses | composite_score | AGENCY-ONLY | Written only by agency `ai-score` and `evaluation`; rendered only in `app/agency/bids`, `bid-compare-view`, `bid-detail-sheet`, `bid-evaluation-tab`. The `composite_score` on `app/partner/projects/page.tsx:716` and `app/api/partner/dashboard/route.ts:484` is **delivery_reviews.composite_score**, a different, vendor-rendered column, untouched. |
| partner_rfp_responses | ai_summary_short | AGENCY-ONLY | Rendered at `app/agency/bids/page.tsx`, `bid-compare-view.tsx:591`; absent from vendor `ResponseRow` and guest `SubmittedResponse` and from all vendor and guest JSX. |
| partner_rfp_responses | ai_summary_detailed | AGENCY-ONLY | Rendered at `bid-detail-sheet.tsx:506-507` only. |
| partner_rfp_responses | ai_summary_generated_at | AGENCY-ONLY | Merged into agency state only; never rendered to a vendor. |
| delivery_reviews | on_time_notes, on_budget_notes, client_feedback, ai_delta_summary | AGENCY-ONLY | The two vendor reads name their columns (below); 066's header and 073 call these four agency-private. |
| delivery_reviews | would_work_again, budget_variance_pct | AGENCY-ONLY | Not in either vendor select; agency-only stats (`vendor-performance-history.tsx`, `delivery-review-sheet.tsx`). |

**Other agency-written columns no vendor screen renders (listed, not moved).** None on `partner_rfp_responses`: `status`, `agency_feedback`, `feedback_updated_at`, `shortlisted_at`, `meeting_requested_at` and `declined_at` are all vendor-rendered. On `delivery_reviews`: `response_id`, `assignment_id`, `org_id`, `created_at`, `updated_at`. `status` and `partnership_id` are used by vendors only as filters. `delivery_review_scores` (score, notes, weight) has no vendor policy at all.

### 1. Readers

| Site | Columns | Runs as |
|---|---|---|
| `app/api/partner/rfps/[id]/route.ts:188-193` (was) | `select("*")` | **vendor** session |
| `app/api/partner/rfps/[id]/response/route.ts:335, 348` (was) | `.select()` whole row | **vendor** session |
| `app/api/rfp/guest/[token]/route.ts:273-276` (was) | `select("*")` | **service role, anyone with the token** |
| `app/api/rfp/guest/[token]/route.ts:619` (was) | `.select()` after insert, not returned | service role |
| `lib/bid-summary-generation.ts:89-95` | ai_summary_* | caller's client (agency, vendor, service) |
| `app/api/agency/rfp-responses/route.ts:89` | all four, named | agency |
| `app/api/agency/rfp-responses/[id]/route.ts:749` | `select("*")`, returned | agency |
| `app/api/agency/bids/rank/route.ts:51` | composite_score | agency |
| `app/api/agency/delivery-reviews/route.ts:71, 213, 332` | all six | agency |
| `app/api/agency/pool/[partnerId]/performance/route.ts:80` | would_work_again | agency |

No browser-client read of either in-scope set exists. The vendor's two `delivery_reviews` reads are `app/partner/projects/page.tsx:715-718` (browser: `id, project_id, composite_score, on_time, on_budget, overall_satisfaction`) and `app/api/partner/dashboard/route.ts:482-486` (`id, composite_score`).

### 2. Vendor screens

- **`app/api/partner/rfps/[id]/route.ts`**: returned `{ inbox, response, versions }`, and `response` was the whole row, all four scoring columns included. `versions` was already an explicit list without them.
- **`app/api/partner/rfps/[id]/response/route.ts`**: the only return after line 440 is `NextResponse.json({ response: saved })`, plus the error return. `saved` was the whole row. On a revision of a scored bid, it carried the agency's score and summaries. The vendor page renders `id, proposal_text, budget_proposal, timeline_proposal, payment_terms, terms_disclosure, attachments, business_criteria_responses, business_criteria_acknowledgments, budget_lines, proposal_sections, status, agency_feedback, feedback_updated_at, submitted_at` and types `updated_at`.
- **Guest GET** returned `{ ...response }`, the whole row. The guest page renders the same set minus `id`.
- **`app/partner/projects/page.tsx:716`** and **`app/api/partner/dashboard/route.ts:484`**: `delivery_reviews`, explicit lists, no in-scope column. They render composite_score (the review's), on_time, on_budget and overall_satisfaction, and the dashboard shows an average and a count.

### 3. Writers and vendor write paths

| Write | Column | Runs as |
|---|---|---|
| `lib/bid-summary-generation.ts:89` | ai_summary_* | agency (generate-summary), **vendor** (bid save :407), service (guest :522, :638) |
| `app/api/agency/bids/[responseId]/ai-score/route.ts:378` | composite_score | agency (no lead_org_id filter on the update itself) |
| `app/api/agency/bids/[responseId]/evaluation/route.ts:383-386` | composite_score | agency (same) |
| `app/api/agency/delivery-reviews/route.ts:187-212, 326-331` | all six | agency |

Policies as last defined, all in 079, none changed later:

- **partner_rfp_responses**: agency SELECT and UPDATE on `lead_org_id IN current_user_org_ids()` (1380-1387). "Partners insert RFP responses for their inbox" (1389-1404) has a WITH CHECK on vendor_org_id and inbox, with **no column limit**. Two vendor SELECTs on `vendor_org_id` (1406-1412). **"Partners update own RFP responses" UPDATE USING `vendor_org_id IN (...)`, no WITH CHECK, no column limit (1414-1416).** There is no GRANT or REVOKE anywhere, so Supabase defaults apply.
- **delivery_reviews**: "Agencies manage own delivery reviews" ALL, USING and WITH CHECK `org_id IN current_user_org_ids()` (079:1202-1205). "Partners view own complete delivery reviews" SELECT, `status = 'complete'` and the partnership's `vendor_org_id IN current_user_org_ids()` (1207-1214). No GRANT anywhere.
- `docs/schema-snapshot-2026-08-13.md` predates 079 and shows the 066 forms for both tables. It is stale here.

**Plain answer: a vendor CAN set `composite_score` and every `ai_summary_*` column on its own bid today**, by PostgREST UPDATE, or by INSERT with them pre-filled. It cannot through the vendor API routes, whose payloads are built from named fields. **A vendor cannot set any of the six review columns on an agency's review** (no UPDATE path). It **can** INSERT a `delivery_reviews` row stamped with its own `org_id` carrying them; see Known holes below.

### 4. Copies

- **`partner_rfp_response_versions`**: explicit insert list, no in-scope column.
- **Notifications** (`notifyBidSubmitted`), **milestone events** and **emails** carry no in-scope column. I grepped `lib/email.ts`, `lib/notifications.ts`, `lib/milestone-events.ts` and `lib/activity-feed.ts`.
- **Realtime**: no `supabase_realtime` publication, no `postgres_changes`, no `.channel(`. **Views, RPCs, triggers**: none reference these columns.
- **bid_evaluations, bid_decompositions, bid_comparisons, bid_scoring_*, delivery_review_scores**: agency-only policies, no vendor policy.
- **One indirect copy:** `would_work_again` is aggregated into the AI reliability summary prompt (`performance/route.ts:207`). That summary is stored via `writeReliabilityCache`, in `partnership_private_reliability` (107) or, until 107 and 108 are applied, in `partnerships.reliability_summary`, which a vendor can read. That copy is closed by 107 and 108, not by this work.

**No vendor-reachable copy found** beyond the three route payloads above, which are now fixed.

### 5. Agency routes returning in-scope columns

| Route | Vendor-rejecting guard |
|---|---|
| GET `/api/agency/rfp-responses` | `route.ts:38-39` |
| PATCH `/api/agency/rfp-responses/[id]` | `route.ts:200-201` |
| POST `/api/agency/bids/[responseId]/generate-summary` | `requireAgencyRole` :18-19 |
| POST `/api/agency/bids/[responseId]/ai-score` | `route.ts:165-166` |
| POST `/api/agency/bids/rank` | `route.ts:31-32` |
| GET/POST `/api/agency/delivery-reviews` | `route.ts:29-31` |
| GET `/api/agency/pool/[partnerId]/performance` | `route.ts:22-24` |

Every guard accepts `role === 'agency' || active_role === 'agency'`. A vendor can self-write `active_role` (091 leaves it unguarded), so **a vendor can call these routes**. Every read inside them is then scoped to the caller's own organizations (`lead_org_id` / `org_id IN callerOrgIds`), and a vendor is never the lead on a bid or review about itself. Inferred, not executed: it gains nothing beyond what PostgREST already allows.

### 6. Agency key

- **partner_rfp_responses: `lead_org_id`**, from "Agencies select RFP responses they own". It is NOT NULL (079:989).
- **delivery_reviews: `org_id`, not `lead_org_id`.** 079:653 renamed 066's `agency_id`; the agency policy uses `org_id`. The table has no `lead_org_id` and no `vendor_org_id`.

## STOP-condition hits

- **VENDOR-RENDERED in-scope column:** none.
- **Vendor write path to an in-scope column: YES.** A vendor can set `composite_score` and `ai_summary_*` on its own bid via PostgREST (UPDATE and INSERT). The vendor bid save route also wrote `ai_summary_*` under the vendor session. A vendor can INSERT its own `delivery_reviews` row carrying the six columns.
- **Copy reachable by a vendor: YES, three, all route payloads:** the vendor RFP detail GET, the vendor bid save POST, and the guest magic-link GET (token holder, no login). All are fixed in the code commit, effective on deploy. The `would_work_again` aggregate in the reliability summary is closed by 107 and 108.
- **Agency route a vendor can call: YES, all seven**, by self-setting `active_role`. Their data scoping returns nothing about the vendor's own bids or reviews (inferred). This is pre-existing and was not changed.

## Phase 1: code (commit 75d85fc, ships first)

- **`lib/server/rfp-response-private.ts`** and **`lib/server/delivery-review-private.ts`** mirror the 105/107 helpers: an agency-scoped read, resolve, attach, upsert-write, and a missing-table check (42P01, PGRST205, message match). **One deliberate difference:** once the table exists, a row that is missing reads as **null, never as the legacy value.** The brief allows fallback only when the table is missing. More importantly, after 109 a legacy value with no table row can only have been written since the backfill, and the party that can do that is the vendor. Writes never send the agency key; the guard sets it.
- **Agency routes through the helpers:** rfp-responses list (`route.ts:115`), PATCH return (`[id]/route.ts:1256`), rank (`:60`), ai-score (`:381`), evaluation (`:385`), `bid-summary-generation.ts:102`, delivery-reviews GET (`:86`), POST (`:230`, `:342`, `:363`), performance (`:92`). Reads still select the legacy columns as the pre-migration fallback; the attach step overwrites them.
- **Vendor and guest paths** use `VENDOR_RESPONSE_COLUMNS` through `selectVendorResponse` (`partner/rfps/[id]/route.ts:191`, `response/route.ts:346, 362`, `guest/[token]/route.ts:276`). On 42703 it retries once without the three optional columns (071, 072, 076), so a wrong premise about them degrades the read rather than breaking bid saving. `docs/schema-truth.md:360` records all three as live. The guest insert now returns only `id`.
- **The vendor bid save route** generates the AI summary with a service-role client (`response/route.ts:22, 426`), scoped to the inbox's lead organization. If the key is not configured, it logs and skips.
- **Types:** this repo has no generated Supabase types (`Database` is not used), so the helpers export their own row types, as 105 and 107 do.

Behaviour on deploy, before any migration: vendor and guest payloads lose the four keys (no screen used them). Agency screens are unchanged (the tables are absent, so reads fall back). Summaries for vendor-submitted bids are written by the service role to the legacy columns.

## Phase 2: migrations (commits e49c3dc, 0fa4786; the pairs are independent)

| File | BEGIN | COMMIT / ROLLBACK |
|---|---|---|
| `109_partner_rfp_response_private.sql` | 209 | COMMIT 391 |
| `109_partner_rfp_response_private_down.sql` | 30 | COMMIT 83 |
| `110_partner_rfp_response_private_null.sql` | 143 | COMMIT 246 |
| `110_partner_rfp_response_private_null_down.sql` | 23 | COMMIT 67 |
| `111_delivery_review_private.sql` | 183 | COMMIT 373 |
| `111_delivery_review_private_down.sql` | 29 | COMMIT 88 |
| `112_delivery_review_private_null.sql` | 96 | COMMIT 202 |
| `112_delivery_review_private_null_down.sql` | 22 | COMMIT 72 |
| `109_preapply_test.sql` | 70 | ROLLBACK 1180 |
| `110_preapply_test.sql` | 71 | ROLLBACK 1548 |
| `111_preapply_test.sql` | 69 | ROLLBACK 1216 |
| `112_preapply_test.sql` | 70 | ROLLBACK 1293 |

**109 and 111** each create a one-to-one table:

- PK is the parent id, with `ON DELETE CASCADE`. The agency key is NOT NULL, with an FK to organizations.
- Three `authenticated` policies (SELECT, INSERT, UPDATE) on `key IN (SELECT current_user_org_ids())`. No vendor policy, no DELETE policy.
- `REVOKE ALL` from PUBLIC, anon and authenticated by name; `GRANT SELECT, INSERT, UPDATE` to authenticated; `ALL` to service_role.
- The guard trigger sets the agency key **from the parent row** on INSERT (whatever the caller sent) and pins it and the parent id on UPDATE. It owns `created_at` (frozen) and `updated_at` (`clock_timestamp()` on every update). It is not SECURITY DEFINER (it reads the parent under the caller's RLS), with `search_path` pinned and EXECUTE revoked from PUBLIC, anon and authenticated.
- A fail-closed pre-flight (LG109 / LG111) and an in-transaction exact backfill check, then `NOTIFY pgrst`.
- **111's header states that it supersedes the never-applied 073 for column privacy, that 073 must never be applied, and that 073's shared-with-vendor concept is a separate, unruled decision not implemented here.** 111 also refuses (LG111) if a `shared_with_vendor` column exists.

**110 and 112** null the legacy columns (they do not drop them) and add a BEFORE INSERT OR UPDATE guard on the parent that raises (LG110 / LG112) when a write leaves any in-scope column non-null. It applies to every caller, including the service role. It has no exemption because, once the table is live, no caller has a legitimate reason to write these columns.

**Existing guards checked:** 106 and 108 added no such guard to partnerships. 093's `partnerships_guard_identity_columns` is a vendor-side permit list (exempting the agency, the service role and migrations), not a "must stay null" guard. 110 and 112 mirror its form (plpgsql, not SECURITY DEFINER, `search_path` pinned, EXECUTE revoked, RAISE rather than silent revert) without its exemptions.

### The drift guard: 108's rule, extended to columns with no timestamp

A legacy value is **accounted for** if a table row exists and either:

- the values are identical; or
- for the summary group, both `ai_summary_generated_at` stamps exist and the table's is strictly later (exactly 108's rule); or
- for `composite_score` and all six review columns, which have no timestamp, the table row was changed after it was created (`updated_at > created_at`). The guard owns both timestamps, so no caller can fake this. It is how a re-score or edit after the backfill shows up.

Anything else refuses, including a legacy value with no row and a legacy value that differs from a row nobody has touched. On these tables such a value may have been written by the vendor, so the file says to read it (P1b) rather than copy it.

### Pre-apply tests

Owner-run, one paste each, ending in an error whose first line is `SAFE TO APPLY NNN.`, `DO NOT APPLY NNN YET.` or `DO NOT APPLY NNN.`.

- **Phases:** 109 and 111 run three phases (before; after 109/111, the leak window; after 110/112). 110 and 112 run two, and stop if 109/111 is not applied.
- **Assertion counts** (each plus the "migration ran" row): 109 has 29 scenarios + 10 structural = 39. 110 has 29 + 4 + 5 drift = 38. 111 has 31 + 10 = 41. 112 has 31 + 4 + 3 drift = 38.
- **Generated** (`gen_tests.py`, in the session scratchpad and not committed) so the inlined migration bodies are byte-identical to the files. I verified this mechanically: each 109/111 body appears once, each 110/112 body once per apply plus once per drift case.
- **Subject:** the vendor is the **April Partner Test Agency**, matched by organization name, falling back to gmarkant@icloud.com's organization; never another vendor. The vendor user is gmarkant@icloud.com and the agency colleague is gmarkant@gmail.com where possible. For reviews, the subject is a **synthetic** complete review on the April vendor's partnership, inserted by the owner inside each scenario and rolled back, so the run does not depend on a real review existing.
- **Results** use PASS / FAIL / INCONCLUSIVE / NO SUBJECT (counted as INCONCLUSIVE) / NOT DISCRIMINATING. The last is a PASS whose expectation is the same in every phase, which shows nothing broke rather than that something changed.

| Required assertion | Where |
|---|---|
| vendor cannot read or write the new table | V4, V5, V6, V7, V8 |
| vendor still reads every VENDOR-RENDERED parent column | V1, V2 (V10 / A9: vendor-visible fields still writable after the guard) |
| after nulling, the vendor cannot set a legacy column | V9a/V9b (scoring: OK before, REFUSED after); V10 (reviews: forged own-org insert, OK before, REFUSED after); V9 (reviews: no update path, NOT DISCRIMINATING) |
| an agency colleague can read and write | A3, A4, A5 |
| another agency cannot | B1, B2 (**expect NO SUBJECT**); A6 (agency writing a row it does not own, if one exists) |
| anon has no privilege | Z3, S3 |
| authenticated lacks DELETE, TRUNCATE, REFERENCES, TRIGGER | S3 |
| deleting a parent cascades | S10 (catalog `confdeltype = 'c'` and a live delete) |
| the backfill matches exactly | S1 |
| legacy columns all null after nulling; guard rejects a non-null write | S7, S8, V9a/b, A8, Z5 (service role refused too) |
| agency key set from the parent, not the caller | S9, A7 |
| drift: refuses what it must, accepts a legitimate edit | 110 D1-D5, 112 D1-D3 |

## Phase 3: verification

The gates were run unpiped against the baseline taken before any change, using binaries directly (not pnpm, per the standing note). **There is no `typecheck` script in package.json, so `pnpm typecheck` does not exist; `tsc --noEmit` was run instead.**

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `eslint .` | 1, 182 problems (154 errors, 28 warnings) | 1, 182 (154, 28). Same file list; none of my files added a problem. One pre-existing warning in `response/route.ts` moved from line 329 to 339 because of the helper I added above it. |
| `audit-policy-snapshot.mjs --guard` | 1 | 1 |
| `check-embed-targets.mjs` | 0 | 0 |
| `check-identity-columns.mjs --guard` | 0 | 0 |
| `check-org-id-reads.mjs --guard` | 0 | 0 |
| `verify-rls.mjs` | **SKIPPED**: reads `.env.local` and queries the live database | |
| `lib/insurance-limit-parser.test.ts` | **SKIPPED**: needs `tsx`, which is not installed; unrelated to this change | |
| `next build` | not run (not requested) | |

**Grep proofs** over `app/api/partner`, `app/partner`, `app/api/rfp`, `app/rfp` and `lib/magic-token-attach.ts`, all EXECUTED:

- 19 `from(parent)` sites, none with `select("*")`, a bare `select()` or a `*` embed.
- No in-scope column name appears.
- Every remaining `composite_score` is `delivery_reviews` (vendor-rendered) or a comment.
- Negative control: the same pattern finds the old `select("*")` in the pre-fix `partner/rfps/[id]/route.ts`.

A first attempt at these greps returned "none" because zsh did not split the path variable, so nothing was searched. I caught it and re-ran with an array. The results above are from the re-run.

**SQL grammar:** pglast 8.3, installed in a scratchpad virtualenv. It covered 12 new files, every DO block and trigger function as PL/pgSQL, and 179 scenario, setup and drift statements with placeholders filled: 0 failures. libpg_query emits malformed JSON for a trigger function's NEW/OLD records, so trigger bodies were checked with `parse_plpgsql_json`, where a grammar error raises before any JSON is produced. A deliberate-typo control fails.

### EXECUTED versus READ

- **EXECUTED:** both inventories' greps and reads, the gates above, the grep proofs, the grammar parse, the byte-identity check of inlined bodies, and the `git merge-base` check.
- **READ, not executed:**
  - All SQL runtime behaviour: RLS outcomes, BEFORE INSERT trigger order against the INSERT WITH CHECK, INSERT ... RETURNING against SELECT policies (V10), and the S9/S10 copy of a bid via `jsonb_populate_record` (an unknown unique constraint would make that INCONCLUSIVE, not FAIL).
  - That the migration runner bypasses RLS for the backfill's trigger read.
  - PostgREST upsert sending only the given columns in `DO UPDATE SET`.
  - The PostgREST error codes the fallback keys on.
- **Not done, by instruction:** no push, merge, rebase or branch change, no database access, no `.env*`, no edit of 073, 103/104 or partnerships, no policy change on either parent.

## Owner's order

Merge, push, and confirm the Vercel deploy is Ready. Then smoke-check the screens below. The two pairs are independent; do either first.

**Scoring pair**

1. Paste `109_preapply_test.sql` whole and read the first line. Expect `DO NOT APPLY 109 YET` from B1/B2 NO SUBJECT; settle that before going on. V3*, V9a and V9b must show the vendor reading and writing in phase 1, which is the defect, measured.
2. Dry run: change line 391 `COMMIT;` to `ROLLBACK;`, run, then P2. Zero rows is the catalog proof of the rollback. Change it back.
3. Real apply, then V1-V7.
4. On production, as gmarkant@gmail.com: open /agency/bids, score a bid, regenerate a summary.
5. Paste `110_preapply_test.sql` (it requires 109 live). The drift rows D1-D5 must PASS.
6. Dry run: line 246 to `ROLLBACK;`, then P2 (count unchanged) and P3 (zero rows) as catalog proof. Change it back.
7. Real apply, then V1-V4. **The scoring leak and the vendor write path close here.**

**Review pair**

1. `111_preapply_test.sql`.
2. Dry run: line 373 to `ROLLBACK;`, then P2 (zero rows) and P5 (073 still absent).
3. Real apply, then V1-V7.
4. On production: open a delivery review, edit a note, save, reload.
5. `112_preapply_test.sql`.
6. Dry run: line 202 to `ROLLBACK;`, then P2 and P3.
7. Real apply, then V1-V4. **The review leak closes here.**

Down files exist for all four. Roll back 110 before 109, and 112 before 111; 109 down and 111 down refuse otherwise.

## Screens that change, and who checks them

| Screen | Account | What to check |
|---|---|---|
| /partner/rfps/[id] (open a bid, save a draft, submit, revise) | gmarkant@icloud.com (April Partner Test Agency) | Renders and saves exactly as before. Devtools: the `response` JSON has no `composite_score` or `ai_summary_*`. |
| /rfp/respond/[token], submitted view | the guest link's email (a magic link from gmarkant@gmail.com) | Renders as before; the JSON has no score or summary. |
| /agency/bids (summary column, detail sheet, compare, evaluation tab, AI score, rank) | gmarkant@gmail.com | Scores and summaries show. **After the April vendor submits a bid, its AI summary appears**: this is the service-role path. |
| Delivery review sheet (/agency/project, /agency/pool/[partnerId]) and Performance History | gmarkant@gmail.com | Notes, client feedback, would-work-again, budget variance and AI delta summary save and reload; the would-work-again rate shows. |
| /partner/projects delivery cards, /partner dashboard reliability block | gmarkant@icloud.com | Unchanged (composite, on time, on budget, satisfaction, average, count). |

## Known holes, found and NOT fixed (out of scope or a policy change)

- **A vendor can INSERT a `delivery_reviews` row stamped with its own `org_id`** on a partnership it is the vendor on: the agency ALL policy's WITH CHECK tests only `org_id`. It is invisible to the agency, but it occupies `UNIQUE(project_id, partnership_id)`, so the agency's later save for that project would likely fail. Inferred, not tested. 112's guard stops such a row carrying the six columns. Fixing the hole needs a policy change on `delivery_reviews`, which this brief forbids.
- **"Partners insert RFP responses" and "Partners update own RFP responses" still let a vendor write any other column on its own bid** (status included). 110 guards only the four moved columns.
- **The `active_role` self-write** lets a vendor pass every agency route guard (091 leaves it unguarded). Data scoping holds (inferred).
- **The guest insert sets `vendor_org_id` to a matched profile id** (`guest/[token]/route.ts`, flagged in-file). Unrelated, untouched.
- **106/108 left `partnerships` with no "must stay null" guard** on the nulled notes and reliability columns. 093 blocks the vendor; the agency and service role could still write them. Reported per the brief's check; not changed (partnerships is out of scope).
- **In legacy-fallback mode**, `generateAndSaveBidSummary`'s write no longer errors on a zero-row update; the old `.single()` did. It now reads back what is there. This affects only the window before 109.

## Owed

- After 110 and 112 are applied and verified: drop the ten legacy columns, remove both helpers' legacy fallbacks, and remove the legacy columns from the agency selects in the same change.
- A second lead organization with a member, to make B1/B2 (cross-agency isolation) testable. This is owed for 105-112 alike.
- The 106 drift-rule question from the 107 report is still open.

## Commits

| SHA | What |
|---|---|
| 75d85fc | Phase 1 code: helpers, agency reroute, vendor and guest column lists, service-role summary |
| e49c3dc | 109 and 110 with downs and pre-apply tests |
| 0fa4786 | 111 and 112 with downs and pre-apply tests |
| (this commit) | this report and the LIGAMENT_CONTEXT.md migration note |
