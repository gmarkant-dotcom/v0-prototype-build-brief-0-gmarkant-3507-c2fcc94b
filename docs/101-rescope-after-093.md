# 101 re-scoped against what 093 now does

Branch `fix/post-093-cleanup`, 2026-10-08. Unattended run. No SQL was run and no migration applied.
Evidence labels: **READ** (a file in this repo), **EXECUTED** (a command I ran here, never SQL), and
**REPORTED** (the brief's statement about the live database, which I cannot see).

## The answer, first

**After 093 the status-write defect is STILL OPEN.** 093's permit list contains `status` and
`accepted_at` by name, and its guard compares columns, never values. A vendor session writing through
PostgREST can therefore set `status` to any of `pending`, `active`, `suspended`, `terminated`,
`removed` on any of its own partnerships, from any prior status, and rewrite `accepted_at` freely.
The only thing preventing it is an application check, `app/api/partnerships/route.ts:1072`
(`if (!isAgency && partnership.status !== 'pending') return 403`), which a direct PATCH with the
vendor's JWT does not pass through. **READ, not executed:** nobody has run the write against the
database. The 102 pre-apply test's BEFORE column is built to measure it on its first run.

**Path taken: authored migration 102** (a value restriction on the status transition, which the brief's
phase 1d allows), unapplied, with a down file and a pre-apply test.

## The brief was wrong about one thing, and it matters

The brief says 101 "narrows the policy 'Partners can update partnership status'". **It does not.**
READ (`git show feat/101-partnership-write-guard:supabase/migrations/101_partnership_write_guard.sql`,
BEGIN line 296, COMMIT line 380): 101 creates a BEFORE UPDATE **trigger**,
`partnerships_guard_vendor_state()`, and changes no policy; its only touch on the policy is a
`COMMENT ON POLICY`. It was written as a trigger precisely because RLS policies of one command are
OR-ed, so a narrowed WITH CHECK is vacuous while the claim policy's WITH CHECK passes every vendor's
own row. So the brief's worry (101 "layered on 093 risks two mechanisms disagreeing") is, for the
mechanism, already answered: 101 was always a second trigger beside 093's, sorting after it by name.

What the brief gets right: 101 was authored when 093 was believed unapplied, and nobody had asked
whether 093 had done 101's job. It had not (above).

## 1a. What 093's trigger permits and refuses from a vendor session (READ)

`supabase/migrations/093_partnership_claim_and_column_guard.sql` on main, function body lines 695-860
(BEGIN 612, COMMIT 860), ARRAY patch confirmed at line 759:
`v_permitted := v_permitted || ARRAY['profile_status'];`.

| | Columns |
|---|---|
| **Permitted** | `status`, `accepted_at`, `updated_at`, `payment_terms_requests`, `vendor_org_id`; plus `profile_status` only on the claim transition (`OLD.vendor_org_id IS NULL AND NEW.vendor_org_id IS NOT NULL`) |
| **Refused (LG009)** | every other column, including any added later: 17 guarded of 24, 1 pinned by 087 (`lead_org_id`) |
| **Pinned by 087 for everyone** | `lead_org_id` immutable; `vendor_org_id` NULL to value only, value must be an org with a member at `partner_email` |
| **Exempt** | `auth.uid() IS NULL` (service role, functions, migrations) and members of `OLD.lead_org_id` |

## 1b. What 101 adds beyond 093 (READ)

A second BEFORE UPDATE trigger. Exits: neither `status` nor `accepted_at` moved; no end-user session;
lead-org member. Otherwise only `pending -> active` (accept) and `pending -> terminated` with
`accepted_at` unchanged (decline) pass; everything else raises 42501. It reads `OLD`, so a vendor
cannot write `pending` onto a non-pending row. It changes no column list, no policy, no grant.

## 1c. Can a vendor still write status after 093? Yes.

`status` is in `v_vendor_permitted`. The comparison is `to_jsonb(OLD) - permitted` against
`to_jsonb(NEW) - permitted`; a permitted column is removed from both sides, so its value is never
compared. Concretely a vendor session can: put `active` over a suspension (reinstating itself), put
`terminated` over a live relationship, put `pending` onto a live row (which reopens the accept branch
of the app route for later), and backdate `accepted_at`.

Application sites, re-censused on main today (READ): the only vendor-session writers of `status` are
the accept (`app/api/partnerships/route.ts:1085`, `{status:'active', accepted_at}`) and decline
(`:1235`, `{status:'terminated', updated_at}`), both gated at `:1072` to `pending` rows. A third,
`lib/partnership-award-claim.ts:54`, writes `status:'active'` on a ghost claim; it is `pending ->
active` or an unchanged `active`, both of which 102 passes. The agency suspend/terminate/reinstate
writes (`:1422`, `:1477`) run as a lead-org member and are exempt.

## 1d. 102

Files (explicit names):

| File | BEGIN | COMMIT / ROLLBACK |
|---|---|---|
| `supabase/migrations/102_partnership_status_transitions.sql` | 263 | COMMIT 364 |
| `supabase/migrations/102_partnership_status_transitions_down.sql` | 35 | COMMIT 40 |
| `supabase/migrations/102_preapply_test.sql` | 76 | ROLLBACK 571 (backstop) |

**How it differs from 101** (honestly: the transition rule is the same; I derived it afresh from 093
and compared, and the two agree, which is some evidence the rule is right):

1. **Different trigger and function name** (`partnerships_guard_status_transition`), so the two cannot
   be mistaken for each other.
2. **Fail-closed pre-flight inside the transaction** (`DO $preflight$`, SQLSTATE `LG102`): refuses to
   run if 093's permit list is absent, or if 101's or 102's trigger already exists. 101 and 102 must
   never both be applied.
3. **The error message names both columns** (`partnerships.status and accepted_at ...`), because a
   write that moves only `accepted_at` is refused too. 101's first exit lets "neither moved" through
   and then refuses `accepted_at`-only changes as well, but its message says only `status`.
4. **A pre-apply test with no `pg_temp` helper functions.** 101's test has 106 `pg_temp.` references;
   `docs/091-preapply-test.sql:42` and `docs/092-preapply-test.sql:53` record that the Supabase SQL
   Editor session returns `3F000` for `pg_temp`. 102's test is inline and follows the nested-block
   pattern that the 093 test used (REPORTED: it ran on 2026-10-08).
5. **Every refusal scenario is measured twice, BEFORE and AFTER**, so a green run proves the defect was
   open and is now closed, rather than proving only that a trigger refuses.

**Equal-or-narrower, clause by clause:** in the header of the migration (EXIT 1 to 3 equal to the
baseline; EXIT 4 and 5 narrower than the baseline and equal to the two live routes; the refusal
narrower by definition; the trigger only raises and cannot widen). One behaviour change named there: a
vendor write that moves only `accepted_at` is now refused; no live writer does it.

**Self-escalation (mandatory).** The condition is evaluated against `OLD.status`. A vendor writing
`pending` onto an `active`, `suspended` or `terminated` row is just another refused transition, so the
first step of the escalation does not exist. Test scenarios R8, R9, R10 (each prior status), R11
(`pending -> pending` moving `accepted_at`) and R14 (the two-statement chain: `pending`, then `active`).

**Mandatory assertions, and where they are:**

| Brief | Scenario |
|---|---|
| vendor cannot write `active` over a suspension | R1, R2 |
| vendor cannot write `terminated` | R4, R5 (a live row; `pending -> terminated` is the decline and must pass) |
| vendor cannot write `pending` onto a non-pending row | R8, R9, R10, R14 |
| vendor can still accept and decline while pending | A1, A2 |
| vendor can still write `payment_terms_requests` | A3 (active), A4 (suspended) |
| agency can still suspend and terminate | A5, A6, A7 (plus A8 reinstate, A9 re-invite) |
| controls proving impersonation took | `auth.uid()` read back after every role switch, LG098 on mismatch; owner state checked before every setup write |
| no subject reported, not passed | no vendor subject: the file raises "NO SUBJECT"; no agency member: A5-A9 INCONCLUSIVE |

Total 28 assertions: 24 scenarios, 4 structural (trigger present and enabled; 093's trigger sorts
first; no policy moved; 101 absent). Green = 28 PASS.

**Apply sequence** (also in the migration header): P1-P6 pre-flight captures; run the test and require
`SAFE TO APPLY 102.`; dry run with `COMMIT;` at line 364 swapped for `ROLLBACK;`, proved by P2; real
apply; V1-V5.

## What I could not establish

- **Nothing here has touched Postgres.** The three files parse (`pglast`, the PostgreSQL parser, in a
  scratch virtualenv: statements, the PL/pgSQL bodies, and the embedded `CREATE FUNCTION`/`CREATE
  TRIGGER` strings), and the test's embedded function is identical to the migration's with comments and
  whitespace stripped. That proves syntax only. 093 had a parse-clean bug (the bare string appended to
  a `text[]`) that only a real run found, so treat a first clean parse as worth very little.
- **The two recalled behaviours the test depends on** are listed in its header: `CREATE TRIGGER` after
  rolled-back updates on the same table not hitting 55006, and a two-statement `EXECUTE`.
- Whether any other triggers on `partnerships` interfere with the owner-side setup writes in the test.
  P2 captures the full trigger list for that reason.
- The live data: whether the vendor subject, an agency member, and enough statuses exist.

## Owed rulings (not decided here)

1. **Retire 101?** I recommend yes: apply 102 and never 101. Greg's call; the 101 branch is untouched.
2. **Should a vendor be able to end an ACTIVE relationship?** Today neither the DB (after 102) nor the
   app permits it; 102 makes the app's rule real. If the product wants "leave this network", that is a
   new transition and a new route, not a loosening of this trigger.
3. **Should `accepted_at` on an accept be constrained** (for example to within minutes of `now()`)?
   Left unconstrained because the claim path writes `status:'active'` without it and clock skew is a
   risk. A forged acceptance timestamp is a low-grade integrity issue.
4. **Does a vendor-session write of `removed`/`suspended` on a ghost claim ever need to pass?** No
   writer does it; 102 refuses it.

## Merge-state

This document asserts no merge state. Check with `git merge-base --is-ancestor <sha> main`.
