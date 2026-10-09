# 107 / 108: the reliability summary moves to a table no vendor can read

> **CORRECTION 2026-10-09:** merged into main (verified by `git branch --merged`). Applied status is recorded in `docs/roadmap-state.md`, not here.

**Merge status:** NOT MERGED, NOT PUSHED, NOT APPLIED. Checked 2026-10-08 with `git merge-base --is-ancestor HEAD origin/main`, exit 1, at commit 387f93a on branch `fix/107-reliability-split`. Re-run that check before trusting this line; it is never updated by hand. (105 and 106 are ancestors of this branch, so they are on `main` locally.)

## THE 1B ANSWER, FIRST: a security fix, not a product change. I built it.

**No vendor screen renders `reliability_summary` or its timestamp, and 073 already ruled it agency-only.** The reasoning, from code:

- 073's own words (header, S4, `supabase/migrations/073_delivery_review_sharing.sql`): the columns "are on `partnerships`, not on `delivery_reviews`"; the vendor reads their row through "Partners can view their partnerships", "which is row level and therefore grants BOTH columns"; "the real fix is to move the cache to an agency-only table, which needs the agency route to read the new location and therefore needs CODE TO SHIP FIRST". It calls the content "agency-facing AI prose about a vendor". Migration 093's header repeats it: "the CACHED AI PERFORMANCE NARRATIVE about this vendor, computed from delivery_reviews and rendered to the lead agency."
- **The only renderer is agency-side:** `components/vendor-performance-history.tsx`, mounted once, at `app/agency/pool/[partnerId]/page.tsx:737`. `grep` for `reliability_summary` across `app/`, `lib/` and `components/` finds no other consumer. The vendor dashboard's reliability block (`app/partner/page.tsx:953-962`) shows structured numbers only (average composite score, review count), and its route says in a comment that the summary "must never carry that column at all" (`app/api/partner/dashboard/route.ts:173-174`, `467-470`).
- **073's `shared_with_vendor` cannot make the summary conditionally visible.** That flag is per review, on `delivery_reviews`. The summary is one paragraph computed over EVERY completed review (`performance/route.ts`, the `reviews` set), shared or not. Showing it to a vendor would restate unshared reviews in prose, which is exactly what 073 STEP 4 cleared the cache to prevent. A blanket split is the right mechanism here, and a conditional one does not exist to build.
- **One caveat, and it is the thing to read:** the summary was reaching vendors' browsers anyway. `GET /api/partnerships`, vendor branch, does `select('*')` and stripped only `partnership_notes`, so `reliability_summary` and `_generated_at` went to the vendor in the JSON whenever one was cached. The F3 stopgap only ever covered the dashboard route. Nothing rendered it, so no one *sees* it, but a vendor with devtools could read it. The code in this branch now strips both keys there. That strip takes effect on deploy, before any migration.

**What this means for the "is it Greg's call" question:** splitting hides nothing from anyone who sees it in the product. If Greg wants vendors ever to see a summary, that is a new feature (a summary computed over shared reviews only, stored somewhere vendor-readable), and the split does not block it.

## Read these three first

1. **The leak window is longer than the notes one and has two parts.** After 107 and before 108 a vendor can still read the summary and its timestamp through PostgREST directly. The route strip closes the browser payload at deploy; only 108 closes the table. The pre-apply test's V3 and V3b measure both in the middle phase.
2. **106 has a defect, found while writing 108's guard, and I did not change it.** 106 refuses on ANY difference between the legacy value and the table row. After 105 the app writes notes only to the table, so the first note an agency edits makes the table differ from the legacy column and 106 refuses (LG106) over a difference that is the system working. The documented fix (copy legacy over the table) would overwrite the newer edit. 108 uses a narrower rule (below). **Proposed, needs your yes:** apply the same rule to 106 (a legacy value is acceptable if the table row is identical, or the table row is newer). Notes have no timestamp column, so the table's `updated_at` against `partnerships.updated_at` would be the candidate, and that is a design question I did not want to guess.
3. **Nothing here was executed against Postgres.** No local server, no credentials. What I did that the 105 pass did not: I parsed every new SQL file, including the PL/pgSQL bodies inside every `DO` block and all 23 scenario statements, with a PostgreSQL 17 grammar parser (pglast 8.3), with 105 and 106 as controls. All parse. That is syntax only. It does not show the pre-apply test returns SAFE TO APPLY.

## The census (Phase 1d)

Method: `grep` and a script over `app/`, `lib/`, `components/`, `scripts/` for every `from("partnerships")` (103 sites, quoted, double-quoted or backtick) and every mention of either column name. EXECUTED. **This is a floor, not a ceiling:** a table reached through a variable, an RPC, or a SQL function body would not appear, and I found none.

| # | Site | Client kind | Columns touched |
|---|---|---|---|
| 1 | `app/api/agency/pool/[partnerId]/performance/route.ts` select of the partnership | agency session | both, named (now only as the pre-107 fallback) |
| 2 | same route, `readReliabilityCache` (new) | agency session | both, from the new table |
| 3 | same route, `writeReliabilityCache` (new; legacy `update` only if the table is absent) | agency session | both, written together |
| 4 | same route, response body `reliability_summary` / `_generated_at` | agency session | both, returned to the agency UI |
| 5 | `components/vendor-performance-history.tsx` (lines 39-40, 132, 144, 159) | agency browser | renders the summary; types the stamp, does not render it |
| 6-9 | `app/api/partnerships/route.ts` 119, 158 (GET agency) ; 266, 277 (GET vendor) | agency session (2), **vendor session (2)** | both, by `select('*')`; the two vendor sites now strip both before responding |
| 10 | 598 (POST reactivation update returning `*`) | agency session | both, implicit |
| 11 | 732 (POST insert returning `*`) | agency session | both, implicit (null) |
| 12-13 | 897, 979 (PATCH NDA and MSA confirm, returning `*`) | agency session | both, implicit |
| 14-15 | 1094, 1244 (PATCH vendor accept and decline, returning `*`) | **vendor session** | both, implicit; the two responses now strip both |
| 16-19 | 1399, 1431, 1444, 1486 (PATCH relationship act, reads and updates returning `*`) | agency session | both, implicit |
| 20 | `app/api/partner/dashboard/route.ts` 173, 467 | vendor session | none; comments only |
| 21 | 093 trigger function `partnerships_guard_identity_columns` | any end-user session | both named as vendor-immutable; unchanged by this work |
| 22 | 073 STEP 4 | owner, migration | writes both to NULL (cache invalidation); unapplied per its header |
| 23 | 066:59-60 | owner, migration | adds both |
| 24 | 107 backfill, 108 null, both downs | owner, migrations | both, always together |

**Totals: 24 rows. 16 application statements read or write at least one column: 2 that name the columns (one select, one update or upsert, both in the agency performance route) and 14 wildcard statements (all in `app/api/partnerships/route.ts`). Of the 14 wildcard statements, 4 run as a vendor session (266, 277, 1094, 1244) and all 4 now strip both columns. No browser-client page, no `lib/` file, no service-role path and no embed (`partnership:partnerships(...)`) reads either column.**

## Do the two columns move together? Yes, and why

The text is the sensitive one. The timestamp says only *when*, but it reveals when the agency last completed a review (shared or not), it has no vendor use, and the route's staleness check (`isStale`) compares it with the newest review, so the pair is one cache. A summary in one place and a stamp in the other would read as fresh or stale at random. One table row holds both, the helper reads and writes both or neither, and 108 nulls both in one statement (073 STEP 4 did the same). The test reports them separately (V3 and V3b) so a divergence would show.

## What was built

| Piece | File | Notes |
|---|---|---|
| Helper, ships first | `lib/server/partnership-private-reliability.ts` | `readReliabilityCache` (requires the caller's lead org ids), `resolveReliability`, `writeReliabilityCache`, `withoutPrivateReliability`, `isMissingReliabilityTable` (42P01, PGRST205, or a message match). Falls back to the legacy columns while the table is absent. |
| Agency route | `performance/route.ts` | reads via the helper, writes via the helper, selects `lead_org_id` for the write. Behaviour unchanged before 107. |
| Vendor payload | `app/api/partnerships/route.ts` | vendor GET map and both vendor PATCH responses strip both columns (`withoutPrivateReliability`). |
| 107 | `107_partnership_private_reliability.sql` | table (PK `partnership_id` cascade, `lead_org_id`, summary, stamp, timestamps), guard trigger, 3 agency-only policies, no DELETE, anon and PUBLIC revoked by name, backfill with an exactness check, `NOTIFY pgrst`. Same shape as 105. |
| 108 | `108_partnership_reliability_null.sql` | nulls both columns, behind a drift guard. |
| Downs | `107_..._down.sql`, `108_..._down.sql` | 107 down copies the table back before dropping it; 108 down copies the table back into the columns. |
| Tests | `107_preapply_test.sql`, `108_preapply_test.sql` | three phases for 107 plus 108 (the leak window in the middle column); two phases for 108 with drift cases. |

### The drift guard, which differs from 106 on purpose

108 refuses (LG108) only for a legacy pair the table does not ACCOUNT for: no table row, or a legacy value newer than (or unorderable against) its row. It accepts an identical pair, and it accepts a table row with a later `reliability_summary_generated_at`, which is what a regenerated summary looks like after 107. The 108 test proves all three: S1 refuses a newer legacy value, S1b accepts a newer table row, S1c refuses a legacy value with no row.

## Line numbers

| File | BEGIN | COMMIT / ROLLBACK |
|---|---|---|
| `107_partnership_private_reliability.sql` | 202 | COMMIT 359 |
| `108_partnership_reliability_null.sql` | 111 | COMMIT 159 |
| `107_partnership_private_reliability_down.sql` | 27 | COMMIT 69 |
| `108_partnership_reliability_null_down.sql` | 22 | COMMIT 56 |
| `107_preapply_test.sql` | 79 | ROLLBACK 957 |
| `108_preapply_test.sql` | 78 | ROLLBACK 947 |

Each has exactly one `^BEGIN;$` and one `^COMMIT;$` or `^ROLLBACK;$`. To dry run a migration, change its `COMMIT;` to `ROLLBACK;`, run, and prove it with the P2 query in its header.

## Apply sequence

1. Deploy the branch (`git push`, by you). The vendor strip is live at once; the agency route works against the legacy columns.
2. Paste `107_preapply_test.sql` whole into one SQL Editor tab and run it once. It ends in an error; the error is the result. First line must read `SAFE TO APPLY 107.` Expect V3 and V3b to read the sentinel in phases 1 and 2 (the measured defect and the leak window) and NULL or false in phase 3.
3. Dry run 107 (swap COMMIT line 359 for ROLLBACK), prove it rolled back with P2, swap back, apply for real, run V1 to V7.
4. Open a vendor's Performance History on production (it regenerates and caches if none is cached).
5. Run `108_preapply_test.sql` (requires 107 live and says so). First line `SAFE TO APPLY 108.`
6. Dry run 108 (COMMIT line 159), apply for real, run V1 to V4. **The leak closes here.**

> **WARNING: nobody may write the legacy `reliability_summary` columns between 107's backfill and 108, because 108 refuses (LG108) over a legacy value newer than its table row, exactly as 106 refused on the notes. The app itself is safe: after 107 it writes only the table.**

## Cross-agency assertions will come back NOSUBJECT

`markant` holds all 33 partnerships and is the only lead organization with members. So `agency_x` and `other` have no subject, and A6, A7, B1, B2, B3 will report NOSUBJECT in every phase of both tests. That is **structural, not a test defect**: the test has no second lead organization to impersonate. It means cross-agency isolation of the new table is *not shown* by this run, only the single-agency cases and the vendor, service, and anon cases. The test says so in its header. Because NOSUBJECT counts as INCONCLUSIVE, the verdict line will read `DO NOT APPLY 107 YET` rather than `SAFE TO APPLY 107.` on this database until a second lead organization with a member and a partnership exists. Decide whether to create a throwaway one for the run or to accept the INCONCLUSIVE after reading the policy (`lead_org_id IN (SELECT current_user_org_ids())`, the same predicate 105 uses).

## Gates, EXECUTED unpiped, each followed by its own `echo $?`, against the 105 baseline, identical

| Gate | Baseline (105) | Now |
|---|---|---|
| `npx tsc --noEmit` | 0 | 0 |
| `npx next build` | 0 | 0 |
| `npx eslint .` | 1, 182 problems (154 errors, 28 warnings) | 1, 182 problems (154 errors, 28 warnings) |
| `scripts/audit-policy-snapshot.mjs --guard` | 1 | 1 |
| `scripts/verify-rls.mjs` | 2 | 2 |
| `scripts/check-embed-targets.mjs` | 0 | 0 |
| `scripts/check-identity-columns.mjs --guard` | 0 | 0 |
| `scripts/check-org-id-reads.mjs --guard` | 0 | 0 |

Run through `npx` and `node` directly, not `pnpm`, per the standing note about pnpm's deps check.

## EXECUTED versus READ

- **EXECUTED:** the greps and scripts behind the census and Phase 2; `tsc`, `next build`, `eslint`, and the five repository guard scripts; a grammar parse of the four migrations, two downs, two tests, the PL/pgSQL inside every `DO` block, the 23 scenario statements, the drift setup statements, and the six Phase 2 queries; the `git merge-base` check.
- **READ, not executed:** every line of SQL's runtime behaviour. Row-level-security outcomes, trigger ordering (`BEFORE INSERT` before the INSERT `WITH CHECK`), `NOTIFY pgrst`, the PostgREST error codes the fallback keys on (`42P01`, `PGRST205`, recalled), the `upsert(..., { onConflict })` call, that a table-owner `UPDATE` of `partnerships` inside the test does not trip the 093 column guard, and that `CREATE TABLE` inside the test's `DO` block avoids 55006. The tests will probably need a first-run fix.
- **Not done, by instruction:** no push, merge, apply, drop of `partnerships.partnership_notes`, no touching 103 or 104, no SQL run.

## Owed

- Drop of the legacy columns and removal of the fallback in `lib/server/partnership-private-reliability.ts`, after 107 and 108 are applied and verified. Then remove the legacy `select` of both columns in `performance/route.ts` in the same change.
- The 106 drift rule (above). Needs your decision.
- `docs/grant-posture-findings.md` for the `anon` grant question this work surfaced. Its first action is to run six read-only queries.
- `LIGAMENT_CONTEXT.md` migrations table: 107 and 108 rows added, marked written and not applied.
