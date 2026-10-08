# 093 resume: getting migration 093 ready to apply, ahead of 101

**Merge status:** not stated here. Check with `git merge-base --is-ancestor <sha> main` using the last
commit before this report (listed at the foot). Nothing was pushed, merged or applied. No SQL was
run and no credentials were used.

Branch `fix/093-resume`, cut from `main` at `a5e0c20`.

---

## THE THREE THINGS TO READ FIRST

1. **The 093 on `main` is not the 093 to apply.** `main` carries the first authoring of 093 (BEGIN
   381, with a 26-column census that is wrong about two columns). The reconciled version, with the
   24 live columns, the four ghost-contact columns guarded (RULED-093-1), T17 flipped and T20 added,
   existed only on `fix/acting-role-read-scope`. It is now on this branch by cherry-pick (below).
   The 101 run read the `main` copy, which is why its report called the permit list "the same five"
   and quoted the wrong census.
2. **T15 was already fixed by the commits that were missing from `main`.** On `main`, T15 reused the
   shared `v_claims` and rewrote the T1-T12 subject's email, which is the Aug 25 bug. The
   reconciled test selects its own claimer and builds its own claims. I added what was still
   missing: T15 now reads `auth.uid()` back inside the role switch and fails with `LG098` if it is
   not the claimer, and it clears the claims afterwards.
3. **The live column set cannot be checked from the repo, and the repo says no column was added.**
   No migration on `main` or on any local branch adds a column to `partnerships` after 093's
   inventory. The difference is empty. That is an inference from files, and 093's own header says
   the first inventory built that way was wrong. **Run query C1 (below) before applying.** Expected:
   exactly 24 rows.

---

## 1. The files and their line numbers (by explicit filename)

Never a glob: `093_*.sql` matches the `_down` sibling first.

| File | BEGIN | plpgsql `BEGIN` (not a transaction) | COMMIT |
|---|---|---|---|
| `supabase/migrations/093_partnership_claim_and_column_guard.sql` | **612** | 695 | **860** |
| `supabase/migrations/093_partnership_claim_and_column_guard_down.sql` | **83** | 114 | **180** |

Read with `grep -n 'BEGIN;'`, `grep -n '^BEGIN$'` and `grep -n 'COMMIT;'`, then discarding hits whose
line starts with `--`. The migration's and the down file's own headers state these same numbers
(checked, they agree). The dry-run swap is the COMMIT on **line 860**.

**Your "last known" numbers (555 / 645 / 809) were right for an earlier state.** They are the file at
commit `d4f44ca` (the reconciliation). The next commit, `43dadd4` (RULED-093-1), moved them to
612 / 695 / 860, and that is the tip. Nothing is wrong; the file grew by 57 lines of ruling text.

**Test file:** `docs/093-preapply-test.sql` (it lives in `docs/`, not `migrations/`). **20 assertions,
T1 to T20.** The count is stated in four places that move together: the header "WHAT THE 20
ASSERTIONS COVER", the `expected 20` literals (5 occurrences in the file, in comments and the report), and the verdict
condition `v_ran = 20 AND v_pass = 20` at line 1509. Counted from the file: 20 occurrences of
`v_ran := v_ran + 1`.

**The self-check:** `v_ran` is incremented where an assertion starts and `v_logged` where it records
a verdict, in different places. If `v_logged <> v_ran` the headline is overridden with "THE TEST ITSELF
IS BROKEN". It catches an assertion that ran without reporting. **The report** is a RAISE EXCEPTION at
the foot of the DO block carrying tally, subject lines and one line per assertion; a final ROLLBACK is
the backstop. A run that ends in no error means something went wrong.

**Section A of the test is the migration body, and I checked it is in sync:** every non-comment
line of 093's body appears in the test except the `COMMENT ON FUNCTION` text, which the test
deliberately omits (its header says so).

## 2. Bringing the latest 093 work onto this branch

It was **not on `main`**. It was on `fix/acting-role-read-scope` only, in two commits that touch only
the three 093 files. That branch also carries unrelated work (emitters, the 056 report), so I did
not merge it. I cherry-picked the two:

| Original | On this branch | What |
|---|---|---|
| `de2583f` | `d4f44ca` | guarded set reconciled against the live table; two test bugs |
| `53cc07f` | `43dadd4` | RULED-093-1: the four ghost-contact columns guarded, T17 flipped, T20 added |

Both applied with no conflict. When `fix/acting-role-read-scope` itself later merges, git will see
the same changes and should resolve them as already applied; if it complains, these two commits are
the cause.

## 3. Column re-inventory (the set difference)

093's authoritative inventory is the 24 live columns recorded on 2026-08-21 (migration header,
section (a)): `id, lead_org_id, vendor_org_id, status, invitation_message, invited_at, accepted_at,
created_at, updated_at, partner_email, nda_confirmed_at, nda_confirmed_by, partnership_notes,
msa_confirmed_at, msa_confirmed_by, payment_terms_requests, profile_status, invitation_sent_at,
reliability_summary, reliability_summary_generated_at, contact_name, company_name, phone, website`.

Method (READ, not executed): a statement-level scan of every `supabase/migrations/*.sql` and
`scripts/*.sql` for `ALTER TABLE [public.]partnerships` and `CREATE TABLE partnerships`, comments
stripped; then the same scan over every local branch for migration files not on `main`.

| Source | Columns added to `partnerships` |
|---|---|
| migrations 094 to 100 on `main` | **none** (098 and 099 add columns to other tables) |
| 101 (branch `feat/101-partnership-write-guard`) | none (a trigger and a comment) |
| every other local branch's unmerged migrations | none (0 hits) |

**Set difference: empty. Columns added since 093's inventory: 0.** So there is no per-column "who
writes it / does a vendor session write it" table to build and **no new-column rulings owed from this
step.**

**What this does not establish:** a column added to production out of band (in the SQL Editor, never
in a file). 093's own history is the warning. Query C1 closes it.

### Rulings I owe you: none from the diff

I looked for anything else that is genuinely a ruling and found nothing that is Greg's to decide here.
For the record, these are not rulings, only things to know: a claimed vendor still cannot write
`profile_status` (so cannot write `removed`); on accept the vendor chooses `accepted_at` (101's
report item 2); and 093's permit list leaves `status` and `accepted_at` writable, which 101 then
narrows. They were decided in 093 and 101 already.

## 4. 093's permit list against the five vendor-session write sites

Permit list: `status`, `accepted_at`, `updated_at`, `payment_terms_requests`, `vendor_org_id`, plus
`profile_status` on the claim transition (`OLD.vendor_org_id IS NULL AND NEW.vendor_org_id IS NOT NULL`).

| Site | Columns written | Refused by 093? |
|---|---|---|
| accept, `route.ts:1084` | `status`, `accepted_at` | no |
| decline, `route.ts:1234` | `status`, `updated_at` | no |
| payment terms, `app/partner/projects/page.tsx:369` | `payment_terms_requests` | no |
| claim, `app/auth/callback/route.ts:208` | `vendor_org_id`, `profile_status`, `updated_at` | no: `profile_status` rides the claim transition, and the statement is filtered `.is("vendor_org_id", null)` |
| auto-claim, `route.ts:316` (GET) | `vendor_org_id` | no |

**Breakages: none.** The sites come from the 101 run's census (33 application write sites, 5 vendor
session), which I re-read rather than re-derived. One behavioural note, not a breakage: the callback
and `claim/route.ts` select with `ILIKE`, while the policy after 093 matches by equality; a row the
application would have matched by wildcard is simply not claimed. That is the hole closing.

## 5. Phase 1: T15 and the shared-claims flaw

**Root cause as you described it was true of `main`'s test** (shared `v_claims`, borrowed subject,
email rewritten). The reconciled test already uses its own `v_ghost_claims` for T15. Added now: an
`auth.uid()` read-back before the write (`LG098` becomes a FAIL naming the mismatch), claims cleared
after, and a header paragraph that now describes what the code does. The header sentence "impersonates
that profile directly" is accurate for the code as it stands.

### Whose uid each assertion actually runs as (all 20)

| Assertion | Identity set | Note |
|---|---|---|
| T1 to T10 | `v_uid` (vendor member of the T1-T12 subject, via `v_claims`) | |
| T11 | `v_uid` | forges `lead_org_id`; 087 answers first |
| T12 | `v_agency_uid` (own claims) | the agency side |
| T13 | none (catalog read as the owner) | no impersonation, none needed |
| T14 | `v_uid`, after the owner sets that profile's email to `%` with claims blanked | email stays `%` for the rest of the transaction |
| **T15** | **`v_ghost_uid` (own claims), read back and proved** | **fixed** |
| T16 to T18 | `v_uid` | |
| T19 | `v_uid`, re-set on every loop iteration | |
| T20 | owner with blanked claims, then `v_uid` | |

**No other assertion has the shared-claims flaw.** Each of those either uses `v_uid` on purpose or
sets its own identity. The residual weakness is general: only T15 now proves its identity by
reading `auth.uid()`. The others assume the claims took, as T1 to T12 did when they passed. T1 to T5
are the controls: if the vendor were not impersonated, T1 to T3 (the permitted writes) would not
behave as the vendor. I did not extend the read-back to all assertions; say so if you want it.

## 6. Phase 2: the 101 report's record

Done on the branch where the file lives, **`feat/101-partnership-write-guard`, commit `305d9da`**:
`docs/101-partnership-write-guard-report.md` gets a dated section (2026-10-08) stating 093 was found
not applied, with your catalog evidence (claim policy still `~~*`; only trigger is the 087
function), that finding 2 ("the brief was stale") is wrong for the live database, and that the order
is 093 then 101. That file does not exist on `main`, so it could not be edited on `fix/093-resume`
without importing the 101 branch. 101's migration and test are untouched.

## 7. Other changes to 093 on this branch

- **Policy count.** 093's header said "Count stays at 117" and V2 / D3 expected 117. 099 has added
  policies since, so 117 is now false and V2 would have raised a false alarm on a good apply. V2,
  D3 and the header now say to compare against a count captured before applying. Changed lines are
  all outside the transaction (header line 32, V2, D3), so the BEGIN and COMMIT line numbers above
  are unchanged.

## 8. Gates (each its own unpiped command; compared by output, not only exit)

| Gate | Baseline (this branch after the cherry-picks, Phase 0) | After all edits |
|---|---|---|
| tsc | 0 | 0 |
| build | 0 | 0 |
| eslint | 1, **182 / 154 / 28** | 1, **182 / 154 / 28** |
| identity-columns --guard | 0 | 0 |
| org-id-reads --guard | 0 | 0 |
| embed-targets | 0 | 0 |
| policy-audit --guard | 1 (known) | 1 |
| verify-rls | NOT RUN (credentials; known 2) | NOT RUN |

**No movement.** Only `docs/` and `supabase/migrations/` changed, so none was expected.
The Phase 0 baseline was taken on this branch rather than a separate worktree because the branch
differed from `main` only in SQL and docs; the 101 run's worktree baseline of `main` showed the same
values.

---

## THE APPLY SEQUENCE

Open each file by its whole name and read its first line before running it.

**0. Read-only pre-flight, and write the answers down.**

```sql
-- C0. Confirm 093 is absent (your finding). EXPECTED: qual contains '~~*', no 'btrim'.
SELECT policyname, qual LIKE '%btrim%' AS uses_btrim, qual LIKE '%~~*%' AS uses_ilike
FROM pg_policies WHERE schemaname='public' AND tablename='partnerships'
  AND policyname='Partners can claim partnership by email';

-- C0b. EXPECTED: one trigger, partnerships_guard_identity_columns; has_permit_list false.
SELECT t.tgname, t.tgenabled,
       pg_get_functiondef(t.tgfoid) LIKE '%v_vendor_permitted%' AS has_permit_list
FROM pg_trigger t WHERE t.tgrelid='public.partnerships'::regclass AND NOT t.tgisinternal;

-- C1. THE LIVE COLUMN SET. EXPECTED: exactly the 24 names in section 3. ANY EXTRA ROW IS A COLUMN
--     093 WILL REFUSE FOR VENDORS ON APPLY. Stop and bring it back.
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='partnerships' ORDER BY column_name;

-- C2. WRITE THESE DOWN. V2 must reproduce them. EXPECTED partnerships: 6.
SELECT count(*) FILTER (WHERE tablename='partnerships') AS partnerships, count(*) AS public_total
FROM pg_policies WHERE schemaname='public';
```

**1. Pre-apply test.** Paste `docs/093-preapply-test.sql` whole, run once, read the error box.
Required: `assertions run : 20`, PASS 20, FAIL 0, INCONCLUSIVE 0, and the verdict line. T15
INCONCLUSIVE means no claimable ghost row exists, which is not a pass. If the error message does not
carry the report, the test is broken; fix it first.

**2. Dry run.** In `093_partnership_claim_and_column_guard.sql` change the COMMIT on **line 860** to
ROLLBACK and run the whole file.

**3. Prove the swap rolled back.** Run C0 and C0b again. They must show the same absent state
(`~~*` still there, `has_permit_list` false). A changed answer means it applied for real.

**4. Real apply.** Restore COMMIT on line 860, confirm with `grep -n 'COMMIT;'` that the non-comment
hit is 860, run.

**5. Verification.** V1 to V6 at the foot of the migration. V1: `uses_btrim` true and
`still_uses_ilike` false. V2: 6 and the C2 total. V3: all four booleans true. V4: one trigger,
enabled. V5: not SECURITY DEFINER, search_path pinned. V6: `authenticated` can execute
`current_user_org_ids`. Rollback, if needed: `093_..._down.sql`, BEGIN 83, COMMIT 180.

**6. Then 101**, with its own sequence in `docs/101-partnership-write-guard-report.md`. After 093 is
applied its pre-flight P3 should return true and its control C4 should PASS.

## Honest verification

**EXECUTED:** the seven gates in section 8; `git` operations; the file scans (migration-column scan,
branch scan, body-sync check) which are local Python reads of repository files.
**READ only:** everything about the live database, including your catalog finding, which I took on
your report and did not see. The edited test has never run, so the LG098 branch and the T15 changes
are unexecuted SQL. Nothing was opened in a browser.

Commits on `fix/093-resume`, oldest first: `d4f44ca`, `43dadd4` (cherry-picks), `5664150` (T15),
then `3b48582` (policy-count wording), then this report. `305d9da` is on `feat/101-partnership-write-guard`.

---

# ADDENDUM 2026-10-08 (second pass): the claim assertions were rebuilt

This section supersedes the earlier sections of this report on three points only: the assertion
count (20 is now **22**), T15 (now T15a, T15b, T15c), and T14 and T16 (rebuilt). Everything else above
stands. Merge state is not asserted here; check it with
`git merge-base --is-ancestor <sha> main`.

Commits, oldest first: `25c2d1c` (investigation doc, as it stood), `61c1808` (executed evidence of
the six stranded invitations), `01bed21` (corrected line numbers, second dead claim path), `c5fbf8c`
(the test rebuild). The test file is `docs/093-preapply-test.sql`.

## A. Read this first

1. **The test has been parse-checked and never run.** I parsed it with `pglast` (libpg_query, the
   real PostgreSQL parser) in a scratch virtualenv: the top-level script parses, the DO block body
   parses as PL/pgSQL, and the two statements inside the EXECUTE strings parse. That proves syntax
   and nothing else. No identifier, type, or runtime behaviour has been checked by Postgres. The
   first run is the real test of this file, and a clean first run is not guaranteed.
2. **Several behaviours it rests on are RECALLED, not executed.** See section H. The first run
   confirms or refutes each of them; the report prints the evidence for the main one.
3. **While reading 101's test I found a risk, not fixed.** `101_preapply_test.sql` (on
   `feat/101-partnership-write-guard`) creates `pg_temp.t_log`, `pg_temp.t_try`, `pg_temp.t_state`,
   `pg_temp.t_whoami` and others, 106 references to `pg_temp.` in all. `docs/091-preapply-test.sql`
   (line 42) and `docs/092-preapply-test.sql` (line 53) record that the Supabase SQL Editor session
   returns `3F000 schema "pg_temp" does not exist`. If that still holds, the 101 test fails at its
   first `CREATE FUNCTION pg_temp...` and says nothing about 101. I did not edit 101's test. It
   needs a ruling and a rebuild along the lines used here (inline, no helper functions) before 101's
   pre-apply run can be trusted.

## B. Assertion count, and the three places that must agree

**22 assertions** (was 20): T1 to T13, **T14, T15a, T15b, T15c, T16**, T17 to T20. Expected clean
outcome: **21 PASS, 1 KNOWN LIMIT (T15b), 0 FAIL, 0 INCONCLUSIVE.**

| Where | What it says | Line |
|---|---|---|
| Header, "WHAT THE 22 ASSERTIONS COVER" | 22 | 27 |
| Header, sample report | `expected 22` / `expected 21` / `KNOWN LIMIT ... 1` | 185-190 |
| Header, "THREE NUMBERS MOVE TOGETHER" | names 22, 21, and `v_pass + v_limit = 22` | 317-322 |
| Verdict condition | `v_ran <> 22` breaks it (line 2247); green needs `v_pass + v_limit = 22` (line 2253) | 2247, 2253 |
| Report literals | `(expected 22)`, `(expected 21; 22 if the claim limit has lifted)`, `(expected 1: T15b ...)` | 2317-2320 |
| Self-check 1 | `v_logged = v_ran` | verdict block |
| Self-check 2 (new) | `pass + known limit + fail + inconclusive = v_logged` | verdict block |
| Self-check 3 (new) | isolation fingerprint unchanged after every probe | verdict block |

Counted by file scan, not by eye: **22** `v_ran := v_ran + 1;`, and the 22 distinct labels
T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15a T15b T15c T16 T17 T18 T19 T20 each appear in a
verdict line. No literal `20` assertion count remains (grep for `expected 20`, `= 20`, `20 assert`
returns nothing). Any of the three self-checks failing overrides every verdict with
"THE TEST ITSELF IS BROKEN".

## C. What each claim assertion does, and the before/after table I expect

Each claim probe runs **twice in one transaction**: BEFORE 093 (the policy and function live when the
paste starts) and AFTER (093's two statements applied by `EXECUTE`, then the same probes again). Only
AFTER decides a verdict. These are **expectations, not results**; nothing has run.

| Probe | Statement | BEFORE (old `~~*` policy, 087 trigger) | AFTER (093) | Verdict rule |
|---|---|---|---|---|
| **T14** wildcard | claimer's profile email set to `%` by the owner inside the probe; `UPDATE partnerships SET vendor_org_id = <own org>`, no WHERE | **reached**: `%` matches every unclaimed row, 087's trigger refuses the first (23514). Or rows claimed | **nothing reached, 0 newly claimed** | PASS only if AFTER nothing AND BEFORE reached. BEFORE also nothing = INCONCLUSIVE "not discriminating". If `~~*` was not live at paste time = INCONCLUSIVE "no contrast" |
| **T15a** policy admits a claim | no-WHERE `SET vendor_org_id, profile_status, updated_at` as the claimer | claimed N of N expected (N from the owner's ILIKE count); subject row claimed | claimed N of N expected (owner's equality count); subject row claimed (55ba0c93 if it qualifies) | PASS needs completed, count equal to expected, subject claimed. LG009 = FAIL (guard refused the claim write). 23514 = INCONCLUSIVE |
| **T15b** production shape | `... WHERE id = <subject>` | 0 rows | 0 rows | 0 = **KNOWN LIMIT** (neither PASS nor FAIL, never "DO NOT APPLY"). 1 row = PASS "limit lifted". LG009 = FAIL |
| **T15c** visibility control | `count(*)` of the subject row and of the table, as the claimer | 0 and 0 | 0 and 0 | 0 = PASS. Non-zero = INCONCLUSIVE (the SELECT policies are not what the investigation recorded) |
| **T16** claimed row not claimable | owner rewrites a third-org row's `partner_email` to the claimer's, then the claimer runs a no-WHERE claim | row untouched | row untouched | PASS if untouched, the email term was made true, and nothing reached it. REACHED or MOVED = FAIL |

Differences from what you specified, stated so they are not a surprise:

- **T14 observes "reached", not "claimed every row", for the old policy.** Under the old policy `%`
  admits every unclaimed row, but 087's trigger then raises 23514 on the first row that is not the
  claimer's and the whole statement aborts, so ROW_COUNT is never produced. A trigger error proves
  the policy's USING had already admitted a row (USING runs before BEFORE ROW triggers), so I count it
  as admission. If 087 were absent the statement would claim rows and `newly claimed` would show it.
- **"Newly claimed" is counted by the owner**, as the fall in `count(*) WHERE vendor_org_id IS NULL`
  across the probe, not by ROW_COUNT, because a no-WHERE UPDATE also counts the claimer's own rows
  (rewritten to the same value).
- **T16's "expected 0 before and after" is stated as "third-org row untouched, before and after".** A
  no-WHERE statement cannot aim at one row, so the figure is measured by the owner on that row.
- **T15a's subject has two extra conditions**: the claimer is in exactly one organization and in no
  lead organization, because the no-WHERE probe also touches every row the claimer's other policies
  admit (the agency update policy, a second vendor organization). 55ba0c93 is preferred (ORDER BY)
  but only used if it qualifies. If no subject qualifies T15a, T15b, T15c are INCONCLUSIVE and the
  message gives the count of looser candidates.
- **T14 and T16 are INCONCLUSIVE if the claimer is a member of a lead organization**, for the same
  reason, and T1's subject selection now prefers a vendor who is not a lead anywhere.

## D. Isolation: how it is guaranteed, and how it is checked

Guaranteed by construction: every probe sits in its own nested `BEGIN ... EXCEPTION` block and always
ends in `RAISE EXCEPTION ... ERRCODE 'LG097'`, swallowed by that block's own handler. A handler that
catches an error rolls back everything the block did to the database: the UPDATE, T14's owner write to
`profiles.email`, `SET LOCAL ROLE` and the `set_config` claims. Local variables survive, which is how
measurements get out. **Checked at run time, not assumed:** a fingerprint (md5 over every
`partnerships` row text plus the two impersonated profiles' emails) is taken before the first probe
and recomputed after each of the 10 probe runs (5 probes x 2 phases). Any change counts as an
isolation failure and ends the run with "THE TEST ITSELF IS BROKEN". That the fingerprint and the
rollback behave as described is RECALLED until the first run; the check exists so a wrong recollection
cannot pass silently.

## E. Identity: every role switch is read back

After every `SET LOCAL ROLE authenticated` the test reads `auth.uid()` and raises `LG098` on mismatch:
**54 mentions of LG098 in the file; every switch, not only T15.** After every claims reset at owner
level it checks `auth.uid()` is NULL (the loop probes, the start of the block, T20). LG098 is reported
as INCONCLUSIVE with the words "TEST FAULT", never as a verdict on 093. T19 counts faults inside its
loop and reports one INCONCLUSIVE line instead of seven.

| Assertion | Identity | Read back |
|---|---|---|
| T1 to T11, T13 (no role), T17, T18, T19, T20 | vendor subject `v_uid` | yes, expected `v_uid` |
| T12 | lead agency member `v_agency_uid` | yes, expected `v_agency_uid` |
| T14, T16 | vendor subject `v_uid` | yes; owner state also checked clean |
| T15a, T15b, T15c | the claimer `v_ghost_uid` | yes, expected `v_ghost_uid` |

## F. FAIL messages: each now names what it detects

- `matched N rows, expected 1` (T1 to T5): now says the write did not reach the subject row and to
  check visibility, instead of implying 093 broke it.
- `NO ERROR - wrote N row(s)` (T6 to T10, T11, T17, T18, T20; nine arms): when N = 0 it is now
  INCONCLUSIVE ("matched 0 rows and raised nothing, the guard was never reached"); the FAIL wording
  survives only for N > 0.
- `... DO NOT APPLY 093.` attached to any unclassified error (T1 to T4): replaced by "unexpected error
  <code> from a write that must succeed ... it is not LG009".
- T15's old FAIL for 0 rows ("093 BREAKS THE CLAIM PATH. DO NOT APPLY") no longer exists. A zero-row
  production-shaped claim is a KNOWN LIMIT. The policy-level FAILs in T15a name the policy or guard
  that refused.

## G. 093's migration and down file are unchanged

`git diff --stat -- supabase/` after the rebuild is empty. Line numbers, re-grepped:

| File | BEGIN | plpgsql BEGIN | COMMIT |
|---|---|---|---|
| `supabase/migrations/093_partnership_claim_and_column_guard.sql` | 612 | 695 | 860 |
| `supabase/migrations/093_partnership_claim_and_column_guard_down.sql` | 83 | 114 | 180 |

The test's copy of 093 now lives inside `EXECUTE` strings. Compared with the migration's code, with
comments and whitespace stripped: the ALTER POLICY is identical (also byte-identical), and the
function is identical modulo comments. The test's header says "the migration's code, comments left
out" rather than "verbatim", which the earlier text overstated.

## H. What I did NOT verify (read this before trusting a green run)

All RECALLED from Postgres documentation or source, none executed:

1. A no-WHERE, no-RETURNING UPDATE is governed by the UPDATE policies alone. If false, T15a reads 0
   and FAILs ("admitted NONE of N"), the same wrong signal as the old T15. This is the assumption
   with the most weight. The investigation doc's section 6 has a standalone probe (`C-probe`) you can
   run first.
2. A caught error in a nested block rolls back `SET LOCAL ROLE` and `set_config(..., true)`. Used to
   restore the owner state after every probe; the fingerprint covers data only, and
   the owner-state check at each probe's start (LG098 if `auth.uid()` is not NULL) would catch a
   leaked claim.
3. PL/pgSQL array-element assignment into `text[]`/`integer[]` initialised with NULL elements, and
   that local variable assignments survive the subtransaction rollback.
4. UPDATE policies' USING runs before BEFORE ROW triggers, WITH CHECK after. The REACHED
   classification depends on it.
5. The SQL Editor accepts a 134 KB paste and a DO block with UPDATE statements that have no WHERE
   (some editor versions prompt). Header says so.
6. Whether the real data has a qualifying subject (a claimer in exactly one organization and no lead
   organization, with 55ba0c93 or another unclaimed row addressed to them). Without one, T15a to T15c
   are INCONCLUSIVE and say why.
7. 084's unique index and T16's partner_email rewrite: the T16 subject is chosen to avoid a collision,
   but 23505 is still possible and is reported as INCONCLUSIVE.

## I. Gates (each its own unpiped command)

| Gate | Phase 0 baseline (before this pass) | After |
|---|---|---|
| tsc | 0 | 0 |
| build (`next build`, invoked directly) | 0 | 0 |
| eslint | 1, 182 / 154 / 28 | 1, 182 / 154 / 28, output byte-identical to the baseline |
| identity-columns --guard | 0, TOTAL 0 | 0, TOTAL 0 |
| org-id-reads --guard | 0, class A 14 open, class B 60 open, 0 regressions | 0, same |
| embed-targets | 0, TOTAL 0 | 0, TOTAL 0 |
| policy-audit --guard | 1 (known), FLAGGED 53 | 1, FLAGGED 53 |
| verify-rls | NOT RUN (credentials; known 2) | NOT RUN |

No movement. Only `docs/` changed, so none was expected.

## J. Copy the test to the clipboard (explicit filename; macOS)

```bash
cd /Users/gam/dev/v0-prototype-build-brief-0-gmarkant-3507-c2fcc94b
git branch --show-current                      # expect: fix/093-resume
pbcopy < docs/093-preapply-test.sql
pbpaste | wc -l                                # expect: 2381
pbpaste | head -1                              # expect: -- =====...
pbpaste | tail -1                              # expect: ROLLBACK;
```

From any branch, without a checkout:

```bash
git show fix/093-resume:docs/093-preapply-test.sql | pbcopy
```

Paste the whole thing into ONE SQL Editor tab and run it once. The expected result is a red error
box whose first line starts `SAFE TO APPLY 093.` and which shows `KNOWN LIMIT : 1`. If the editor asks
you to confirm an UPDATE without WHERE, confirm: it is inside a rolled-back DO block. If it says
"Success. No rows returned", the run did not work (see the header).

## K. Findings carried from the investigation doc (not part of 093, not fixed)

- Both documented claim paths (`app/auth/callback/route.ts:176-217` and the GET auto-claim at
  `app/api/partnerships/route.ts:268-338`) name columns in a SELECT-then-UPDATE, so under the SELECT
  policies in 079 they return no rows and no error. EXECUTED: the claimer sees 0 rows
  (2026-10-08). Five live invitations are in the predicted stranded state.
- A sixth (`e3d5e1fd`) was created unlinked for an account that already existed. Candidate write sites
  and reasons are in the investigation doc section 7b.
- **Rulings owed:** repair the claim path (not by a claimer SELECT policy); link-at-insert for the
  import sites; what to do with the six rows; whether 101's test is rebuilt without `pg_temp`.
