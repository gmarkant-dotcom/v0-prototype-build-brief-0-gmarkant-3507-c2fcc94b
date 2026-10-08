# Migration 101: phase 0, baseline and census

Branch `feat/101-partnership-write-guard`, cut from `main` at `a5e0c20`. Read-only phase. No SQL was
run and no credentials were used. Everything below is READ from source unless it says EXECUTED.

**FILE NAME.** The brief asked for `docs/101-phase0-baseline.md`. That path already exists on `main`
(commit `cd1caf8`, 713 lines, the phase 0 baseline for the six emitter rulings; the "101" in its
name is a docs sequence number, not this migration). This run first wrote its phase 0 over that
file by mistake, without reading it, and then restored it byte for byte from `main` in the
commit that adds this file. This document therefore lives at
`docs/101-partnership-write-guard-phase0.md`. Check: `git diff main -- docs/101-phase0-baseline.md`
prints nothing on this branch.

## THE BRIEF IS WRONG ABOUT THREE MATERIAL THINGS

Found by reading, before building. Each changes what 101 is.

1. **Migration 093 already guards most of what the brief says is open.** 093 (applied, per the
   brief's own "migrations run to 100 and all are applied") replaced
   `partnerships_guard_identity_columns()` with a PERMIT LIST for the vendor side: a signed-in
   caller who is not a member of `lead_org_id` may change only `status`, `accepted_at`,
   `updated_at`, `payment_terms_requests` and `vendor_org_id` (plus `profile_status` on the claim
   transition). Everything else, `nda_confirmed_at`, `msa_confirmed_at`, `partnership_notes`
   included, raises `LG009`. So the brief's "can rewrite nda_confirmed_at, msa_confirmed_at,
   partnership_notes" is **not true if 093 is live**, and the previous session's phase 0
   (`relationship-end-phase0.md` section 1) was written without reading 093. **The defect that is
   actually open is exactly two columns: `status` and `accepted_at`.** That is still the whole
   point of the run, and it is a smaller, sharper problem.
2. **A narrowed policy cannot close it. This is the finding that decides the mechanism.** See 0f.
   Postgres combines the WITH CHECK expressions of all PERMISSIVE policies on a command with OR, not
   per policy. The claim policy "Partners can claim partnership by email" has
   `WITH CHECK (vendor_org_id IN (SELECT current_user_org_ids()))`, and every vendor's own row
   satisfies it. So whatever 101 wrote into "Partners can update partnership status" WITH CHECK,
   the claim policy's check would pass the same write. **The brief says the two are independent
   and asks me to prove it. They are independent in USING and in purpose, and NOT independent in
   WITH CHECK.** Narrowing the status policy alone would apply cleanly, pass every verification
   query, and constrain nothing.
3. **"Keep the policy name" and "the agency policy byte-identical" both survive**, because the
   mechanism that works touches neither policy. See 0f.

State of the evidence on (2): READ from the Postgres RLS source semantics and from the three
policies' text, NOT executed. The pre-apply test (phase 2) carries a diagnostic, H0, that
demonstrates it live inside a rolled-back transaction, so Greg does not have to take my word.

## 0a. Working tree

`git status --porcelain` printed nothing. Clean. Branch created from `main`;
`git rev-parse origin/main main` returned the same sha, `a5e0c206dae1f6c3b3615ee575471fd24e50df33`.

## 0b. Baseline (EXECUTED, each gate its own unpiped command, then compared by output not by code)

`tsc`, `eslint` and the four guards ran in a throwaway worktree of `origin/main` with the real
`node_modules` symlinked in and the tools invoked directly (not through pnpm; see the worktree gate
note). `pnpm build` ran in the main checkout, which had no changes (`git status --porcelain` = 0
lines) and so was byte-identical to `origin/main`. The worktree and its symlink were removed
afterwards and the real `node_modules` was re-checked.

| Gate | Exit | Output that confirms it |
|---|---|---|
| `tsc --noEmit` | 0 | no output |
| `pnpm build` | 0 | route table printed, ends `ƒ (Dynamic) server-rendered on demand` |
| `eslint .` | 1 | `182 problems (154 errors, 28 warnings)` and `0 errors and 7 warnings potentially fixable` |
| `check-identity-columns.mjs --guard` | 0 | `GUARD PASSED` |
| `check-org-id-reads.mjs --guard` | 0 | `14 known-open sites remain ... the class did not grow` |
| `check-embed-targets.mjs` | 0 | `TOTAL 0 in 0 files` |
| `audit-policy-snapshot.mjs --guard` | 1 | static snapshot reminder; known non-regression |
| `verify-rls.mjs` | NOT RUN | needs credentials. Known value is 2 (PostgREST does not expose pg_class) |

**Full lint triple: 182 / 154 / 28.** Matches the known value. No stop condition hit.

## 0c. The write census

**33 application write sites** across `app/` and `lib/` (101 `.from("partnerships")` references in
all; the other 68 are reads), plus **2 database-side writers**. **5 of the 33 run as a vendor
session.** This count is a floor: it is a grep of the literal table name, and I found no dynamic
table name, but a writer through a path I did not think to grep would not appear. No `rpc()` call
in `app/` or `lib/` writes `partnerships`.

Client kinds were read from each file's constructor or from its caller. "Agency" means the session
client of a lead-organization member. "Service" means the service role (`auth.uid()` is NULL, so
the 087/093 trigger exits at its second early exit and no policy is consulted).

| # | Site | Client | Columns set | Vendor status/accepted_at write? |
|---|---|---|---|---|
| 1 | `app/api/partnerships/route.ts:1084` PATCH accept | **VENDOR session** | `status='active'`, `accepted_at` | **YES, on a pending row. Must stay.** |
| 2 | `app/api/partnerships/route.ts:1234` PATCH decline | **VENDOR session** | `status='terminated'`, `updated_at` | **YES, on a pending row. Must stay.** |
| 3 | `app/partner/projects/page.tsx:369` payment terms | **VENDOR, browser client** | `payment_terms_requests` only | no. **Must stay.** The over-narrow trap. |
| 4 | `app/auth/callback/route.ts:208` claim | **VENDOR session**, claim policy | `vendor_org_id`, `profile_status`, `updated_at` | no |
| 5 | `app/api/partnerships/route.ts:316` GET auto-claim | **VENDOR session**, claim policy | `vendor_org_id` | no |
| 6 | `app/api/partnerships/route.ts:588` POST re-invite | Agency | `status='pending'`, `invitation_message`, `accepted_at=null`, `updated_at` | agency, exempt |
| 7 | `:642`, `:774` | Agency | `invitation_sent_at` | agency |
| 8 | `:722` POST invite | Agency | INSERT | agency |
| 9 | `:887` NDA confirm | Agency | `nda_confirmed_at/by`, `updated_at` | agency |
| 10 | `:969` MSA confirm | Agency | `msa_confirmed_at/by`, `updated_at` | agency |
| 11 | `:1421` PATCH suspend/terminate/reinstate | Agency | `status`, `updated_at` | agency, exempt |
| 12 | `:1476` PATCH other status | Agency | `status`, `updated_at` | agency |
| 13 | `:1659` DELETE | Agency | DELETE | agency |
| 14 | `app/api/agency/pool/[partnerId]/notes/route.ts:244` | Agency | `partnership_notes`, `updated_at` | agency |
| 15 | `.../performance/route.ts:214` | Agency | `reliability_summary`, `reliability_summary_generated_at` | agency |
| 16 | `lib/partnership-invitations.ts:71,88` | Agency (resend-invitation) or Service (magic-link) | `invitation_sent_at`, `updated_at`; INSERT | agency/service |
| 17 | `lib/broadcast-partnership-cue.ts:205` | Agency | INSERT (`status='pending'`) | agency |
| 18 | `lib/award-partnership-resolution.ts:106,149,175,229` | Agency (rfp-responses PATCH) | `vendor_org_id`, `profile_status`, `status='active'`; INSERTs | agency, exempt |
| 19 | `lib/partnership-award-claim.ts:53` | **Service**, called from the vendor's own page loads | `vendor_org_id`, `status='active'`, `profile_status`, `updated_at` | **vendor-triggered but service role: bypasses RLS and the trigger by design** |
| 20 | `app/api/partner/partnerships/claim/route.ts:62` | Service | `vendor_org_id`, `updated_at` | no |
| 21 | `app/api/rfp/guest/[token]/route.ts:76,88,134` | Service | INSERTs; `vendor_org_id`, `profile_status`, `updated_at` | no |
| 22 | `app/api/agency/email-scan/import/route.ts:105,113` | Service | `partnership_notes`, `updated_at`; INSERT | no |
| 23 | `lib/server/partner-pool-import.ts:282,314,325` | Service | import patch; INSERTs | no |
| 24 | SQL `accept_partnership_invitation()` (scripts/010) | SECURITY DEFINER | `status='active'`, `accepted_at`, `updated_at` | Reads `WHERE partner_id = auth.uid()`, a column 079 renamed. No caller in `app/` or `lib/`. Dead. Even if live it only does pending -> active, which 101 permits. |
| 25 | SQL one-off in `073_delivery_review_sharing.sql:375` | Owner, migration | `reliability_summary*` -> NULL | n/a |

**No legitimate vendor write was found that is not in the brief's list.** The brief's two permitted
vendor behaviours (accept/decline while pending, `payment_terms_requests`) are rows 1, 2 and 3.
Rows 4 and 5 are the claim, which the brief names. Row 19 is a vendor-initiated service-role
write; it is not a vendor session and is unaffected. **The stop condition was not triggered.**

Both vendor entry points to accept and decline in the UI go through the route:
`app/partner/network/page.tsx:430,454` fetch `PATCH /api/partnerships`. Nothing in `app/` or
`components/` writes `status` or `accepted_at` on `partnerships` from a browser client.

## 0d. The pending lifecycle (decides the shape)

Read from source.

| Question | Answer | Where |
|---|---|---|
| What status does an invitation row carry when sent? | `pending` | `:722` insert; `lib/partnership-invitations.ts:88`; `lib/broadcast-partnership-cue.ts:205` |
| What does a vendor ACCEPTING write? | **`status = 'active'` AND `accepted_at = now()`** | `:1084` |
| What does DECLINING write? | **`status = 'terminated'`** and `updated_at`. `accepted_at` untouched | `:1234` |
| Who else moves a row INTO pending? | Only the agency: `POST` re-invite of a `terminated` row (`:588`), and INSERTs. A vendor session never writes `pending` | |
| Who else moves a row OUT of pending? | The agency PATCH (`:1421`, `:1476`) and the award resolution (`status='active'`) | |

**SAID PLAINLY: accepting writes a STATUS VALUE (`active`), so the allow-list must name it. The
simpler "refuse every vendor status write" is NOT available**, because accept and decline are both
status writes made by the vendor's own session. The legitimate vendor status transitions are exactly
two, both from `pending`: `pending -> active` (with `accepted_at`) and `pending -> terminated`
(with `accepted_at` unchanged).

## 0e. 099 as the precedent

`099_rfp_closure.sql:689-709` and `:831-838`. What it does: a `STABLE SECURITY DEFINER` SQL
function `partner_rfp_inbox_status_before(id)` returns the row's prior status, and the vendor
policy's WITH CHECK says "status unchanged, or `bid_submitted` from a non-closed row". The point it
established: a WITH CHECK sees only NEW, so "unchanged" must be judged against a prior value read
through a STABLE helper, so that every write that does not touch status still passes.

**What I am copying:** the principle, not the mechanism. (a) Compare against the PRIOR value, so an
unchanged field always passes; that is what keeps `payment_terms_requests` alive. (b) An allow-list
of transitions, not a deny-list, so a status added later is refused to vendors by default. (c)
Assert the self-escalation and the vacuity cases rather than assume them.

**What I am not copying, and why:** the policy-plus-helper mechanism. 099 could use it because
`partner_rfp_inbox` has no permissive UPDATE policy whose WITH CHECK a vendor can satisfy. This table
does. See 0f.

## 0f. Policy alone, or a trigger?

**A trigger. A policy alone cannot do it on this table.**

The three UPDATE policies on `partnerships`, from `079_organizations.sql:1472-1500` (the brief's
live measurement agrees with 079 for the vendor policy):

| Policy | USING | WITH CHECK |
|---|---|---|
| Agencies can update their partnerships | `lead_org_id IN (SELECT current_user_org_ids())` | same |
| Partners can update partnership status | `vendor_org_id IN (SELECT current_user_org_ids())` | same |
| Partners can claim partnership by email | `vendor_org_id IS NULL AND ...email match...` (093) | **`vendor_org_id IN (SELECT current_user_org_ids())`** |

Postgres evaluates, for an UPDATE, the OR of the permissive policies' USING against the old row and
the OR of the permissive policies' WITH CHECK against the new row. It does not pair a policy's
WITH CHECK with its own USING. A vendor updating their own active row: the old row passes the
vendor policy's USING; the new row has `vendor_org_id` still equal to their organization, so it
passes the CLAIM policy's WITH CHECK regardless of what the vendor policy's WITH CHECK says. Any
status the vendor writes is admitted. **Narrowing only the vendor policy's WITH CHECK, the brief's
1a, would change nothing observable.** Narrowing the claim policy's WITH CHECK too would work but is
forbidden by the brief, and would still leave a ghost-row claim able to write `status`.

A BEFORE UPDATE trigger is not subject to policy OR-ing, sees OLD directly (so no STABLE helper and
no snapshot argument), and the table already has one for exactly this purpose. Two ways to build it:

- **Replace `partnerships_guard_identity_columns()` again (a third `CREATE OR REPLACE`).** Rejected.
  Its body carries 087's four refusals "character for character" under a `DO NOT EDIT WITHOUT
  DIFFING 087` banner, and `CREATE OR REPLACE` replaces a body wholesale; dropping one block
  silently reopens 087's holes 3, 5 or 6.
- **A second function and a second trigger.** Chosen. 093 argued against this because a trigger
  named to sort BEFORE `partnerships_guard_identity_columns` would pre-empt 087's specific messages
  with a generic one. Postgres fires BEFORE triggers in alphabetical order by name, so a trigger
  named `partnerships_guard_vendor_state` sorts AFTER `partnerships_guard_identity_columns` and
  fires second. 087's and 093's specific refusals still win for the cases they diagnose.

**Consequence for the brief's wording:** no policy is altered. "Partners can update partnership
status" keeps its name and its text, the agency policy is trivially byte-identical, and the claim
policy is untouched. The refusal SQLSTATE is `42501`, raised by the trigger with a distinct message,
not by RLS; the test tells them apart by message text.

**Unmeasured and flagged:** the full trigger list on the live table (query P1 in the 101 pre-flight
block). Everything above assumes 087/093's trigger is the only BEFORE UPDATE trigger, or that any
other sorts without effect on this one.

## 0g. Residuals seen while reading, not fixed

1. **The ghost-claim status write.** The claim policy's WITH CHECK constrains no column, and 093's
   permit list allows `status`. So a claimer of an unclaimed `vendor_org_id IS NULL` row can write
   `status` in the claim statement itself. A trigger on `status` closes this as a side effect (the
   new trigger applies to the claim path too), and the claim writes in rows 4 and 5 do not touch
   `status`, so nothing legitimate breaks. Called out in the report.
2. **The policy name is a lie.** "Partners can update partnership status" constrained neither column
   nor value. 101 attaches a `COMMENT ON POLICY` saying so. The name is kept.
