# Post-093 cleanup: report

**Merge status: not stated here.** Check with `git merge-base --is-ancestor <sha> main`, using the last
commit before this report (listed at the foot). Branch `fix/post-093-cleanup`, cut from `main` at `4d8400c`.
Nothing was pushed, merged or applied. No SQL was run and no credentials were used.

---

## THE THREE THINGS TO READ FIRST

**1. The status-write defect is STILL OPEN after 093, and migration 102 is authored to close it.**
093's vendor permit list contains `status` and `accepted_at` by name and its guard compares columns, never
values, so a vendor session writing through PostgREST can put `active` over a suspension, `terminated` over
a live relationship, or `pending` onto a live row. Only an app route check (`app/api/partnerships/route.ts:1072`)
stands in the way, and a direct PATCH never passes through it. This is READ from the code, not yet measured:
the 102 pre-apply test's BEFORE column is built to measure it. **102 is not applied**
(`supabase/migrations/102_partnership_status_transitions.sql`, **BEGIN 263, COMMIT 364**; down file BEGIN 35,
COMMIT 40; test BEGIN 76, ROLLBACK 571). The brief said 101 "narrows a policy"; it does not, it is a trigger
like 102, so "do not layer it on 093" was already satisfied. 102 is the same rule re-derived against 093 as
it stands, with a fail-closed pre-flight and a test that uses no `pg_temp` helper. **Apply 102 or 101, never
both.** Full account: `docs/101-rescope-after-093.md`.

**2. Nothing I wrote has touched Postgres, and the last migration shows why that matters.** 093 passed my
parse check and still had a runtime bug (a bare string appended to a `text[]`, SQLSTATE 22P02 on every claim)
that only the test's first real run found. 102, its down file and its test are in exactly that state: they
parse (the PostgreSQL parser, in a scratch virtualenv) and the test's embedded function is identical to the
migration's. Run `102_preapply_test.sql` first, read the first line, and treat any INCONCLUSIVE as work to do,
not noise. Two recalled behaviours it depends on are named in its header.

**3. The claim path is dead for a reason 093 did not touch, and it is yours to rule on.** An unclaimed
partnership is visible to neither organization, so every claim path (all four of them, not one) finds nothing
and reports success. 093 fixed the matching; the visibility gate is separate and shut. I enumerated four
options and recommended none, because every one either widens a read of the agency's private notes about the
vendor or adds a service-role path: `docs/claim-visibility-rulings.md`. Until it is answered, stranded rows
need a backfill and the recurring query in section "4e" below.

---

## Phase 0. Baseline

Clean tree on `main` (`4d8400c`, equal to `origin/main`). **I took the baseline in the primary checkout,
not a throwaway worktree:** the checkout was clean and identical to `origin/main`, and the memory of this
repo is that worktree builds fail on the Turbopack symlink and report the harness's code as the gate's. The
tools were invoked directly, not through pnpm.

**0c. 093 is on main, and so is the ARRAY patch.** `git log`: `4d8400c merge: 093 ... applied 2026-10-08`,
`cf75092 fix: 093 appends profile_status to a text array with ARRAY`. Line 759 of the migration reads
`v_permitted := v_permitted || ARRAY['profile_status'];`. Migration BEGIN / plpgsql BEGIN / COMMIT are still
612 / 695 / 860. The repository and the applied database are REPORTED to agree; **Q4 below checks it.**

## Phase 1. Re-scope 101 (commit `8570f50`) - independently mergeable

Authored 102 (migration, down, pre-apply test) and `docs/101-rescope-after-093.md`. The answer to 1c is the
first thing above. Details: 093 permits `status, accepted_at, updated_at, payment_terms_requests,
vendor_org_id` plus `profile_status` on the claim transition and refuses the rest; 101 adds only a value
restriction on `status`/`accepted_at`; 102 is that restriction.

- **Equal-or-narrower, clause by clause:** in the migration header. The trigger only raises, never writes,
  and changes no policy, grant or column.
- **Self-escalation:** evaluated against `OLD.status`; `pending` onto any non-pending row is refused; test
  scenarios R8 to R11 and R14.
- **Mandatory assertions:** all present (table in `docs/101-rescope-after-093.md`). 28 assertions: 24
  scenarios, 4 structural. Over-narrowness is caught by A1 to A10 (accept, decline, payment terms, agency
  suspend / terminate / reinstate / re-invite, service role).
- **Apply sequence for 102:** P1 to P6 pre-flight captures; paste `102_preapply_test.sql` once and require
  `SAFE TO APPLY 102.`; dry run by swapping the `COMMIT;` at line 364 for `ROLLBACK;` and proving it rolled
  back with P2; real apply; V1 to V5. The migration also raises (`LG102`) inside its transaction if 093's
  permit list is absent or if 101's or 102's trigger exists.
- **Could not establish:** the live behaviour of any of it; whether other triggers on `partnerships` disturb
  the test's owner-side setup (P2 lists them); the live data (a vendor subject, an agency member).
- **Revert:** `git revert 8570f50` removes the three files and the doc.

## Phase 2. Claim visibility (commit `8b805de`) - independently mergeable, docs only

`docs/claim-visibility-rulings.md`: the mechanism from source (the two SELECT policies in
`079_organizations.sql:1469-1485`), the four claim paths that all name columns, and four options (a narrow
SELECT policy; a service-role claim endpoint; a SECURITY DEFINER self-claim function; leave it manual), each
with cost, exposure and what a stranger could see if built wrong. No policy, migration or route written.
The most important single sentence: a SELECT policy keyed on email would expose the agency's private
`partnership_notes` (the `{blacklisted}` flag among them) to the invitee before they accept anything.
**Could not establish:** the live policy list (only the count of 6 is reported), and whether a session can
exist before email confirmation. **Revert:** `git revert 8b805de`.

## Phase 3. The import identifier defect (commit `2c59961`) - independently mergeable, code

`app/api/agency/email-scan/import/route.ts`. **3a, still holds:** `.eq("vendor_org_id", matchedProfileId)`
compared an organization id to a profile id. **The brief said it "can never match". That is wrong for the
sixteen accounts whose organization id equals their founder's user id** (the comment at
`app/api/partnerships/route.ts` records them); it matched those and silently missed every account created
since.

**3b, can a row exist where the organization matches and the `partner_email` differs?** Yes. 087 checks the
address only at the moment of a claim; afterwards a second member of the organization, or a changed contact
address, leaves a claimed row whose `partner_email` is not the address now being imported, and the email
lookup cannot find it. For that row the organization lookup is the only finder, so **deleting it would have
changed behaviour** (the import would insert a second row for the same vendor organization). **3c: I did not
delete it; I fixed the comparison.** The matched profile's organization is resolved with
`resolveOrgIdForUser` (the existing resolver in `lib/entitlements.ts`) and compared instead. For the sixteen
backfilled accounts the result is identical; for everyone else the lookup now finds what it was written to find.
A profile with no organization skips the lookup and falls through to the email lookup, as before.
**3d:** the entry for this file was removed from `KNOWN_OPEN_MIRROR` in `scripts/check-org-id-reads.mjs`
(recorded 1, found 0); class B went from 60 to 59 open sites and the guard exits 0 with no other movement
(the full guard output was diffed against the baseline).

- **Sibling, not fixed (outside the named site, and unflagged by the guard):**
  `lib/server/partner-pool-import.ts:218-222,258` builds `existingByPartnerId` keyed by `vendor_org_id` and
  looks it up with `matchedProfileId`. Same defect, same fix. Owed.
- **Not executed:** the changed route was type-checked and linted, never run. **Revert:** `git revert
  2c59961` (it reverts the guard-mirror edit with it, which is required).

## Phase 4. Documentation (commit `680e9c1`) - independently mergeable, docs only

- **4a/4b.** `docs/093-resume-report.md` gets a banner and a verified table of stale references; **the body
  is not edited** (a diff stat shows insertions only). Two of the brief's premises, stated plainly: the
  report does **not** say the test is 1601 lines - **DISPROVEN as a quote**; 1601 was the old test's final
  `ROLLBACK;` line, and the file is 2381. The one stale line reference in the body is "line 1509", now 2253.
  4a asks to correct stale references and 4b says not to rewrite the body; I resolved that by putting every
  correction in the banner.
- **4c.** `docs/roadmap-state.md` gets a fourth banner: 093 and 100 applied (REPORTED), 101 authored and not
  applied and superseded by 102, the four-row backfill done, two rows of status table marked **DISPROVEN**
  (claim path "fixed by 093"; the import "never matches") and the rest **VERIFIED** or **REPORTED**, kept
  separate.
- **4d.** Other documents describing 093 as unapplied, found by grep and checked: `docs/read-scope-session-report.md`
  section 7 (banner added; its line counts are the first authoring's), `docs/bid-notification-scope-report.md`
  ("093 stays parked", banner added). Other mentions of 093 (`095-notification-types-ruling.md`,
  `panel-and-types-report.md`, and the rest) are historical narrative and were left alone.
  `LIGAMENT_CONTEXT.md` does not mention 093 and its migration log "stops at 078", so it is not stale about 093,
  it is silent.
- **4e.** The queries are below.
- **Revert:** `git revert 680e9c1`.

## Phase 5. Gates (each its own unpiped command; compared by output)

| Gate | Phase 0 baseline (main) | After all commits |
|---|---|---|
| tsc | 0 | 0 |
| build (`next build`, direct) | 0 | 0 |
| eslint | 1, **182 / 154 / 28** | 1, **182 / 154 / 28**, output byte-identical |
| identity-columns --guard | 0, TOTAL 0 | 0, TOTAL 0 |
| org-id-reads --guard | 0; class A 14 open; class B 60 open | 0; class A 14 open; **class B 59 open (intended, phase 3)** |
| embed-targets | 0, TOTAL 0 | 0, TOTAL 0 |
| policy-audit --guard | 1 (known), FLAGGED 53 | 1, FLAGGED 53 |
| verify-rls | NOT RUN (no credentials; known 2) | NOT RUN |

After each commit tsc and every guard were re-run and diffed against the baseline; the only movement is the
phase 3 line above.

---

## 4e. BACKFILL AND STATE VERIFICATION QUERIES. NONE OF THESE HAS BEEN RUN.

I have no database credentials and ran no SQL. Every query below is a checklist item, read-only, to be run
by a person in the Supabase SQL Editor as the table owner (RLS does not apply to the owner, so these see
all rows, which is what a verification wants). **Expected values are predictions, not observations.**

### Q1. The four backfilled rows resolve to an organization name through the join the agency pool uses

The pool reads `partnerships` with the embed `vendor_org:organizations!vendor_org_id(...)`
(`app/agency/pool/page.tsx:798`) and takes the contact from the organization's primary contact
(`lib/org-contact.ts:117`). This reproduces that join, not a simplification of it.

```sql
SELECT p.id,
       p.lead_org_id,
       p.status,
       p.profile_status,
       p.vendor_org_id,
       (o.id IS NOT NULL)                  AS org_resolves,
       o.name                              AS org_name,
       pc.email                            AS primary_contact_email,
       p.partner_email
FROM public.partnerships p
LEFT JOIN public.organizations o  ON o.id  = p.vendor_org_id
LEFT JOIN public.profiles      pc ON pc.id = o.primary_contact_user_id
WHERE o.name ILIKE ANY (ARRAY['%caro creative%', '%cresce%', '%liwag%', '%fredsqueo%'])
   OR p.company_name ILIKE ANY (ARRAY['%caro creative%', '%cresce%', '%liwag%', '%fredsqueo%'])
ORDER BY o.name;
```

**EXPECTED:** four rows (more if an organization of the same name has other partnerships; match them to
`partner_email`); every one with `org_resolves = true`, a non-null `org_name`, `status = 'pending'`, and a
`primary_contact_email` whose lower/btrim form equals that of `partner_email` (the 087 invariant).
`status` must still be `'pending'`: the link was repaired, nothing was accepted. A row with
`org_resolves = false` or a NULL `org_name` is the failure this query exists to catch: the agency pool
would render it with no name.

### Q2. No partnership row points at an organization that does not exist

```sql
SELECT count(*) AS dangling_vendor_org_ids
FROM public.partnerships p
WHERE p.vendor_org_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p.vendor_org_id);
```

**EXPECTED: 0.** And confirm the constraint that should make a nonzero impossible:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.partnerships'::regclass AND contype = 'f' AND conname ILIKE '%vendor%';
```

**EXPECTED:** a foreign key from `vendor_org_id` to `organizations(id)`. If it is absent, Q2's zero is only
a snapshot and a hand backfill can create a dangling id.

### Q3. Unclaimed rows that have a matching profile: only the two deliberate exclusions remain

```sql
SELECT p.id, p.lead_org_id, p.partner_email, p.status, p.created_at,
       pr.id AS matching_profile_id,
       EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = pr.id) AS profile_has_org
FROM public.partnerships p
JOIN public.profiles pr
  ON pr.email IS NOT NULL
 AND p.partner_email IS NOT NULL
 AND lower(btrim(pr.email)) = lower(btrim(p.partner_email))
WHERE p.vendor_org_id IS NULL
ORDER BY p.created_at;
```

**EXPECTED: exactly two rows**, the two the brief calls deliberate consent-rule exclusions. Which two
is not recorded in this repository; write down their ids on the first run and compare on every later one.
More than two means a stranded row is back; fewer than two means someone linked an excluded row. Rows
whose `profile_has_org` is false cannot be backfilled at all until the account has an organization.

### Q4. The applied 093 matches the repository (the ARRAY patch and the equality policy)

```sql
SELECT pg_get_functiondef(p.oid) LIKE '%ARRAY[''profile_status'']%' AS has_array_patch,
       pg_get_functiondef(p.oid) LIKE '%v_vendor_permitted%'          AS has_permit_list
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'partnerships_guard_identity_columns';

SELECT qual LIKE '%btrim%' AS uses_btrim, qual LIKE '%~~*%' AS still_ilike
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partnerships'
  AND policyname = 'Partners can claim partnership by email';

SELECT count(*) AS n_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partnerships';
```

**EXPECTED:** `has_array_patch = true`, `has_permit_list = true`; `uses_btrim = true`, `still_ilike = false`;
`n_policies = 6`. A `has_array_patch = false` means the applied function is NOT the repository's, which
would make every claim write raise 22P02.

### Q5. The two-owner-side checks that tell a stranded claim from a healthy one (recurring)

```sql
-- stranded: an unclaimed row whose addressee has an account AND an organization (backfillable now)
SELECT count(*) FROM public.partnerships p
JOIN public.profiles pr ON lower(btrim(pr.email)) = lower(btrim(p.partner_email))
WHERE p.vendor_org_id IS NULL
  AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = pr.id);
```

**EXPECTED: 2** (the exclusions, if both have an organization). Run it on a cadence until Ruling 1 in
`docs/claim-visibility-rulings.md` is answered.

---

## Honest verification

**EXECUTED:** git operations; `tsc`, `eslint`, `next build`; the four guard scripts; a `pglast` parse of the
three 102 files (statements, PL/pgSQL bodies, embedded strings) and a comment-stripped equality check of the
test's function against the migration's; file scans (line numbers, non-ASCII, em dashes). **READ only:**
every claim about the live database, including that 093 is applied (the brief's statement; the repository
records the merge, not the application), the final 093 test result, and the four-row backfill. **No browser
was opened.** Nothing in this branch has run against Postgres.

## Owed rulings (collected; none decided)

1. Retire 101 in favour of 102 (recommended; the call is yours).
2. Claim visibility: which option, if any (`docs/claim-visibility-rulings.md`).
3. Link-at-insert for imports of existing accounts (Ruling 2 there).
4. Constrain `accepted_at` on an accept? (left open on purpose; the award claim writes `active` without it).
5. May a vendor ever end an `active` relationship? (the app forbids it; 102 makes the DB agree).
6. Fix the sibling identifier defect at `lib/server/partner-pool-import.ts:258`.
7. Rebuild 101's pre-apply test without `pg_temp` if 101 is ever pursued (it creates temp functions; the
   SQL Editor may not support them, per `docs/091-preapply-test.sql:42`).

## NUMBERED LIVE CHECKLIST

Each step is **VERIFIES THIS RUN** (checked in the repository or by a command I ran) or **CARRIED OVER**
(needs a person with the database or a browser). Do the CARRIED OVER ones in order.

1. 093 and its ARRAY patch are on `main`; migration lines 612 / 695 / 860, patch at 759. **VERIFIES THIS RUN** (git, grep).
2. tsc 0, build 0, lint 182 / 154 / 28, all guards at baseline. **VERIFIES THIS RUN.**
3. The applied function is the repository's (Q4: `has_array_patch`, `uses_btrim`, `n_policies = 6`). **CARRIED OVER.**
4. The four backfilled rows resolve to an organization name and are still `pending` (Q1). **CARRIED OVER.**
5. No dangling `vendor_org_id`, and the foreign key exists (Q2). **CARRIED OVER.**
6. Exactly two unclaimed rows have a matching profile, and they are the deliberate exclusions (Q3, Q5). **CARRIED OVER.**
7. Open `/agency/pool` as the lead agency of those four rows: names present, no blanks, status pending. **CARRIED OVER** (needs a browser).
8. Run `supabase/migrations/102_preapply_test.sql` once. Read the first line. The BEFORE column should show the vendor WRITING the refused states (this is the measurement of the defect). **CARRIED OVER.**
9. If green: pre-flight P1 to P6, dry run, prove it rolled back (P2), apply, V1 to V5. **CARRIED OVER.**
10. After 102, as a vendor: accept a pending invitation, decline another, request payment terms. As the agency: suspend, terminate, reinstate a vendor. **CARRIED OVER.**
11. Direct PostgREST PATCH as a vendor (`status=active` on a suspended row) is refused 42501 after 102. **CARRIED OVER.**
12. Import an email-scan contact whose account is in a post-079 organization with an existing claimed row: it enriches, it does not duplicate. **CARRIED OVER** (phase 3 is untested in a running app).
13. Answer the claim-visibility checklist in `docs/claim-visibility-rulings.md` (policy list; email confirmation setting). **CARRIED OVER.**
14. The nav restructure, the Clients and Projects page, suspend and terminate, and the payments change, none of which this run touched or walked. **CARRIED OVER.**

## Commits on `fix/post-093-cleanup`, oldest first

`8570f50` (phase 1), `8b805de` (phase 2), `2c59961` (phase 3), `680e9c1` (phase 4), then this report.
Cut from `4d8400c`.

---

