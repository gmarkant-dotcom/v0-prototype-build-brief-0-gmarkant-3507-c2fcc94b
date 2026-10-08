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
