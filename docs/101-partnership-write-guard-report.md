# Migration 101: the partnership write guard. End of run report

**Merge status:** this report does not state it. Check with
`git merge-base --is-ancestor e01dd83 main` (exit 0 means merged). `e01dd83` is the last commit
before this report; the report's own commit follows it. Nothing was pushed, merged or applied by
this run.

Branch `feat/101-partnership-write-guard`, cut from `main` at `a5e0c20`.

---

## CORRECTION, 2026-10-08: 093 IS NOT APPLIED TO PRODUCTION

**Finding 2 below ("the brief was stale about three of the five columns: 093 already guards
them") is WRONG for the live database.** I treated 093 as live because its file is on `main`. A file
on `main` is not a migration in the database.

Evidence, from a live catalog query Greg ran in the Supabase SQL Editor on 2026-10-08 (reported to
this session; I did not run or see the query text):

- the policy "Partners can claim partnership by email" still uses `partner_email ~~* (ILIKE)`, which
  is the pre-093 predicate (093 replaces it with `lower(btrim())` equality);
- the only trigger on `public.partnerships` is `partnerships_guard_identity_columns`, the 087
  function, with no 093 permit list in it.

What follows from that, for production today:

1. `nda_confirmed_at`, `msa_confirmed_at`, `partnership_notes`, `reliability_summary*`,
   `partner_email`, the contact columns and every other column except `lead_org_id` and the
   `vendor_org_id` transitions are **OPEN to a vendor session**. The brief was right about them.
   The open set is not "exactly `status` and `accepted_at`"; it is everything.
2. 101 closes `status` and `accepted_at` only. **Applied alone it leaves the rest open.**
3. 101's own checks say so: pre-flight **P3** returns `has_093_permit_list` = false (its instruction
   is STOP), and pre-apply control **C4** is a FAIL. T17 to T19 (expect `LG009`) would FAIL too.
   That is the test working, not a defect in it.
4. **Apply order: 093 first, then 101.** 101's trigger does not depend on 093 to function, but its
   header, its claim that three columns are already guarded, and T17 to T19 do.
5. The 093 that was on `main` when this report was written is not the 093 to apply: the reconciled
   version (24 live columns, four ghost-contact columns guarded per RULED-093-1, T17 flipped, T20
   added) was on `fix/acting-role-read-scope` only. It is carried onto `fix/093-resume`; see
   `docs/093-resume-report.md` there.

Unchanged by this correction: finding 1 (a trigger, because the claim policy's WITH CHECK ORs
through), the census, the two permitted transitions, and the 101 migration and test, which are not
edited. Only this report is.

---

## THE THREE THINGS TO READ FIRST

### 1. 101 is a TRIGGER, not a narrowed policy, and the brief's mechanism would have done nothing

The brief asked to narrow "Partners can update partnership status". **That cannot work on this
table.** Postgres ORs the WITH CHECK expressions of all permissive policies on a command, against
the new row, and does not pair a policy's check with its own USING. "Partners can claim partnership
by email" carries `WITH CHECK (vendor_org_id IN (SELECT current_user_org_ids()))`, which every
vendor's own row satisfies. Whatever the status policy's WITH CHECK said, the claim policy's would
pass the same write. A narrowed policy would have applied cleanly, passed every catalog check, and
constrained nothing. The brief also asks me to prove the claim policy is independent; **it is
independent in USING and in purpose, and not in WITH CHECK.**

So 101 adds a second BEFORE UPDATE trigger, `partnerships_guard_vendor_state`, and alters no
policy. The brief's 0f said the handoff "names both options and does not choose"; this is the
choice and the reason.

**Evidence level, stated plainly: READ, not executed.** The OR behaviour is from Postgres RLS
semantics and the three policies' text. I could not run SQL. The pre-apply test carries
**H0**, which demonstrates it live in a rolled-back block (it replaces the vendor policy's WITH
CHECK with `false` and shows the vendor write still goes through). H0 is an INFO line, not
pass/fail. **If H0 says "NOT CONFIRMED", my finding is wrong for this database and a policy would
have worked; the trigger is still correct, and you should say so in review.**

### 2. The brief was stale about three of the five columns: 093 already guards them

Migration 093 (applied, per the brief's own statement that migrations run to 100) replaced
`partnerships_guard_identity_columns()` with a vendor permit list: `status`, `accepted_at`,
`updated_at`, `payment_terms_requests`, `vendor_org_id` (plus `profile_status` on the claim
transition). `nda_confirmed_at`, `msa_confirmed_at` and `partnership_notes` raise `LG009` from a
vendor session today. The previous session's phase 0 never read 093. **The columns actually open
are exactly two: `status` and `accepted_at`.**

101 does not re-guard the other three. A second permit list beside 093's is the divergence 093
was written to prevent.

**This rests on 093 being live, which I read but did not measure. Pre-flight P3 in the migration
is the check, and the pre-apply test's control C4 repeats it. If P3's `has_093_permit_list` is
false, STOP: the brief was right about those columns and 101 does not close them.**

### 3. Nothing here has been run, and the test file has never been parsed by Postgres

No SQL was executed, by instruction. `101_preapply_test.sql` is 874 lines of plpgsql written
without a database to check it against. The most likely failure is a syntax or harness error. **A
run whose error message does not begin with the banner `SAFE TO APPLY 101.` or `DO NOT APPLY 101`
and the `verdicts logged : 35` line is a broken test, not a result.** Fix the test before reading
anything into it. One more mistake of mine, already repaired: phase 0 first overwrote an existing
committed file (see "Process error" below).

---

## What 101 contains

| File | What |
|---|---|
| `supabase/migrations/101_partnership_write_guard.sql` | function `partnerships_guard_vendor_state()`, trigger of the same name (BEFORE UPDATE, FOR EACH ROW), `COMMENT ON POLICY` on the status policy. Pre-flight P1 to P7 and verification V1 to V6 in the file |
| `supabase/migrations/101_partnership_write_guard_down.sql` | drops the trigger, the function, and the policy comment |
| `supabase/migrations/101_preapply_test.sql` | 35 logged verdicts: 4 controls, 2 INFO, 29 assertions. Section A is the migration body, copied by script |

Policies added: none. Altered: none. Dropped: none. Grants changed: none. Columns, data: none.
`partnerships_guard_identity_columns()` (087/093) is not touched.

### Transaction control (line numbers, read from the files with `grep -n`)

| File | BEGIN | COMMIT / ROLLBACK | Other hits you will see |
|---|---|---|---|
| `101_partnership_write_guard.sql` | **line 296** | **COMMIT line 380** | line 304 is the plpgsql body `BEGIN` (no semicolon, not a transaction); header lines 33 to 51 quote the words in comments |
| `101_partnership_write_guard_down.sql` | **line 29** | **COMMIT line 37** | none |
| `101_preapply_test.sql` | line 121 | **ROLLBACK line 874** (the backstop) | the DO block ends in `RAISE EXCEPTION`, so the ROLLBACK is not reached on the expected path |

Verify with the unanchored forms `grep -n 'BEGIN;'` and `grep -n 'COMMIT;'`; the executable hits
are the ones whose line does not start with `--`. The dry-run swap is the COMMIT on **line 380**.

---

## The predicate, before and after

**Before (live, and unchanged by 101).** Three UPDATE policies:

| Policy | USING | WITH CHECK |
|---|---|---|
| Agencies can update their partnerships | `lead_org_id IN (SELECT current_user_org_ids())` | same |
| Partners can update partnership status | `vendor_org_id IN (SELECT current_user_org_ids())` | same |
| Partners can claim partnership by email | `vendor_org_id IS NULL` and profile email = `partner_email` (093) | `vendor_org_id IN (SELECT current_user_org_ids())` |

Plus the 087/093 trigger: vendor sessions may change only `status`, `accepted_at`, `updated_at`,
`payment_terms_requests`, `vendor_org_id`.

**After.** The same three policies, byte for byte (pre-apply T26 to T28 and migration V3 compare
md5 fingerprints; they are not read by eye), plus a second trigger that fires after the first:

```
EXIT 1  status and accepted_at both unchanged                  -> allow
EXIT 2  auth.uid() IS NULL (service role, DB function, migration) -> allow
EXIT 3  OLD.lead_org_id IN current_user_org_ids() (the agency)  -> allow
ACCEPT  OLD.status = 'pending' AND NEW.status = 'active'        -> allow (accepted_at may be written)
DECLINE OLD.status = 'pending' AND NEW.status = 'terminated'
        AND accepted_at unchanged                               -> allow
anything else                                                   -> RAISE 42501 "partnerships.status ..."
```

### Equal-or-narrower, clause by clause

1. **A trigger can only raise or return the row.** It cannot admit what a policy refused, so it
   cannot widen any access predicate.
2. **Exit 1** returns only when status and accepted_at are both unchanged; the policies and
   093's trigger then decide exactly as before.
3. **Exits 2 and 3** mirror 093's exits 2 and 3 in meaning. No caller 093 exempted is newly
   restricted by exit 2 or 3, and none newly freed.
4. **The two allowed transitions** are the two the PATCH route performs today
   (`route.ts:1084` accept, `:1234` decline). Every other vendor write of status or accepted_at is
   admitted today and refused after. The vendor's permitted set is a strict subset of today's.
5. No policy, grant, role, column or row is altered. The policy comment changes `pg_description`
   only.

**No vendor gains a capability they lack today.**

### How a vendor is prevented from re-entering `pending` (the self-escalation)

The prior status is read from `OLD`, not from the new row. A write of `pending` onto a row whose
`OLD.status` is `active`, `suspended`, `terminated` or `removed` is a status change whose
`OLD.status` is not `pending`, so neither the accept nor the decline branch matches and it is
refused. A write of `pending` onto a pending row changes nothing (exit 1), or, if `accepted_at`
moved with it, matches neither branch and is refused. There is no value a vendor can write that
makes `OLD.status` pending first. **Asserted: pre-apply T4, T5, T6** (active, suspended and
terminated rows), plus T11 (accepted_at while staying pending).

---

## The write census (0c), as a table

Full table with the line number of each site: `docs/101-partnership-write-guard-phase0.md`
section 0c. **Number: 33 application write sites, plus 2 database-side writers; 5 of the 33 run
as a vendor session.** This is a floor: it is a grep of the literal table name over `app/`, `lib/`,
`components/`, `scripts/`. No dynamic table name and no `rpc()` that writes `partnerships` was
found.

| Vendor-session write | Columns | 101 effect |
|---|---|---|
| `route.ts:1084` accept (PATCH) | `status='active'`, `accepted_at` | permitted (pending -> active) |
| `route.ts:1234` decline (PATCH) | `status='terminated'`, `updated_at` | permitted (pending -> terminated) |
| `app/partner/projects/page.tsx:369` payment terms (browser) | `payment_terms_requests` | untouched (exit 1) |
| `app/auth/callback/route.ts:208` claim | `vendor_org_id`, `profile_status`, `updated_at` | untouched (exit 1) |
| `route.ts:316` GET auto-claim | `vendor_org_id` | untouched (exit 1) |

**No legitimate vendor write turned up that was not in the brief's list. The stop condition was
not triggered.** `lib/partnership-award-claim.ts:53` writes `status='active'` from a vendor's own
page loads, but on the SERVICE ROLE (`auth.uid()` NULL, exit 2), so it is unaffected by design.

## The pending lifecycle (0d), as a table

| Question | Answer |
|---|---|
| Status when an invitation is sent | `pending` |
| What a vendor ACCEPTING writes | **`status='active'` AND `accepted_at=now()`** |
| What DECLINING writes | **`status='terminated'`** (+ `updated_at`); `accepted_at` untouched |
| Who else moves a row into pending | only the agency (re-invite of a terminated row, INSERTs) |
| Who else moves a row out of pending | the agency PATCH, and the award resolution |

**Accepting writes a status value, so the allow-list names it.** "Refuse every vendor status
write" was not available.

## What I copied from 099 (0e)

The principle, not the mechanism: compare against the PRIOR value so an unchanged field always
passes (that is what keeps `payment_terms_requests` alive), use an allow-list of transitions so a
status added later is refused by default, and assert the vacuity and escalation cases rather than
assume them. I did not copy the policy-plus-STABLE-SECURITY-DEFINER-helper design, because 099's
table has no permissive UPDATE policy a vendor can satisfy and this one does (finding 1). A
trigger reads `OLD` directly, so there is no snapshot argument to make.

---

## Is 101 safe to apply BEFORE the code ships, or must it follow?

**Either. No application file changes.** Every application write it touches already conforms:
accept and decline are pending-only in the route and are the two permitted transitions; the
route's explicit 403 for a vendor on a non-pending row fires before any write; no first-party code
writes `status` or `accepted_at` from a browser client. 085's trap was a decline branch that
resolved a notification recipient AFTER setting a status. Here the decline write is a permitted
transition and the recipient lookup before it is a read, so applying first cannot silently kill an
email. The one thing the apply can break is a vendor write nobody listed, and the pre-apply
accept (T8), decline (T9) and payment-terms (T14 to T16) assertions are what would catch it.

## THE APPLY SEQUENCE for Greg

1. **Pre-flight.** Run P1 to P7 from the migration header. Write down the three policy
   fingerprints and the policy count from P2. **If P3 returns `has_093_permit_list` = false, stop.**
   Read P1: any second BEFORE UPDATE trigger on `partnerships` must be read, not skipped.
2. **Pre-apply test.** Paste `101_preapply_test.sql` whole, run once. Read the error box. The
   verdict is the first line. Required: `verdicts logged : 35 ... OK`, FAIL 0, INCONCLUSIVE 0.
   Read **D0** (must say DEFECT REPRODUCED; if not, read why before going on) and **H0** (should
   say CONFIRMED; if NOT CONFIRMED, finding 1 is wrong for this database). A banner-less error is a
   broken test; fix the test.
3. **Dry run.** In `101_partnership_write_guard.sql` change the COMMIT on **line 380** to
   ROLLBACK, paste whole, run.
4. **Verify the swap rolled back.** Run migration V1. It must return **zero rows**. A row means the
   file applied for real. "Success. No rows returned" is not evidence of anything.
5. **Real apply.** Restore COMMIT on line 380, confirm with `grep -n 'COMMIT;'` that the
   non-comment hit is on 380, run.
6. **Verify again.** V1 (one row, enabled, before/update/row), V2 (order: identity trigger, then
   vendor_state), V3 (the same three fingerprints and count as P2), V4, V5. Optional by-hand V6.

---

## Honest verification

**EXECUTED:** `tsc --noEmit` (exit 0), `eslint .` (exit 1), `check-identity-columns --guard` (0),
`check-org-id-reads --guard` (0), `check-embed-targets` (0), `audit-policy-snapshot --guard` (1),
`pnpm build` (0), each as its own unpiped command, on a worktree of `origin/main` for the
baseline and on this branch afterwards. `git status --porcelain` was empty at the start and after.

| Gate | Baseline (origin/main `a5e0c20`) | After (this branch) |
|---|---|---|
| tsc | 0 | 0 |
| build | 0 | 0 |
| eslint triple | 1, **182 / 154 / 28** | 1, **182 / 154 / 28** |
| identity-columns --guard | 0 | 0 |
| org-id-reads --guard | 0 (14 known-open) | 0 |
| embed-targets | 0 (TOTAL 0) | 0 |
| policy-audit --guard | 1 (known) | 1 |
| verify-rls | NOT RUN (needs credentials; known 2) | NOT RUN |

No application code changed: `git diff main..HEAD --stat` touches only `docs/` and
`supabase/migrations/`, which is why the gate results are identical. One command in the run piped
its output (`org-id-reads` once); it was re-run unpiped and the exit is the one in the table.

**READ, not executed:** every statement about the live database. 093 being live; the three
policies' text (from migration files, not `pg_policies`); the OR semantics; the trigger firing
order; the absence of other BEFORE UPDATE triggers; what `current_user_org_ids()` and
`org_has_member_with_email()` return. The whole SQL test is READ only.

**NOT established:**
- Whether `101_preapply_test.sql` parses and runs. It has never touched a database.
- Whether the live policy text equals 079's. The brief's measurement says it does for the vendor
  policy; I have no measurement of the other two.
- Whether any other BEFORE UPDATE trigger exists on the live table (pre-flight P1).
- Whether any row is already `suspended`/`terminated` (P5).
- That the claim assertions have a subject: they use a synthesized clone and say so in the report.
- Nothing was opened in a browser. No vendor flow was exercised end to end.

## Residuals and things I changed my mind about

1. **The ghost-claim status write is closed as a side effect.** The claim policy's WITH CHECK
   constrains no column and 093 permits `status`, so a claimer of an unclaimed row could write
   `status` inside the claim statement. The trigger applies to that path too (pre-apply T21).
   Neither claim writer in the app writes status, so nothing legitimate breaks.
2. **On an accept the vendor chooses `accepted_at`.** The same as today. Pinning it to the clock
   is a separate decision.
3. **"Partners can update partnership status" is still a misleading name.** 101 comments it and
   keeps the name, as the brief required.
4. **A refusal is a trigger 42501, not an RLS 42501.** The brief said the refusal should be the
   policy. The message starts `partnerships.status`, and the test distinguishes the layers, so a
   42501 from the wrong layer is a FAIL.
5. **The agency forged-`lead_org_id` assertion (T25) is partly redundant.** 087's trigger refuses
   it first, so the agency policy's own WITH CHECK is not independently reachable. T26 (agency
   policy fingerprint) is what proves the policy text is unchanged.

## Process error, disclosed

Phase 0 wrote `docs/101-phase0-baseline.md` without reading the path first. A file with that name
already existed on `main` (`cd1caf8`, the emitter rulings baseline, 713 lines; its "101" is a docs
sequence number). The Write tool replaced it, and the first commit (`2a6ad8d`) carried the
overwrite. Commit `e01dd83` restores it from `main` byte for byte and moves this run's phase 0 to
`docs/101-partnership-write-guard-phase0.md`. Check: `git diff main -- docs/101-phase0-baseline.md`
prints nothing. The overwrite is still visible in `2a6ad8d`'s diff because I did not rewrite
history.

## Questions the brief got wrong (ledger)

1. nda/msa/notes "open": false if 093 is live.
2. "Narrow the policy": cannot work; the claim policy's WITH CHECK ORs through.
3. "The claim policy is independent": independent in USING and purpose, not in WITH CHECK.
4. "Write docs/101-phase0-baseline.md": that path was taken.
5. "Keep the policy name / restore the policy byte for byte": moot, since no policy is altered.
