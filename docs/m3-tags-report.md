# M3 tags — session report

**Branch:** `feat/m3-tags`, created off `7a1119c`.
**Nothing was pushed. Nothing was applied. No migration numbered 097 or lower was touched.**

## Completed, and one thing that was not

Phases 0 through 5 are complete. **Phase 0 was run twice** — once before the
branch existed (the session stopped on prohibition 10, because `feat/m3-tags`
did not exist and I would not guess which branch was meant), then carried
forward unchanged once the branch was confirmed at the same commit.

**One correction to my own Phase 0 numbers, because Phase 5 compares against
them.** I recorded `org-id-reads:guard` as scanning **388** files. The saved log
says **387**. The corrected baseline is used throughout below. Nothing else in
the baseline moved.

**The pool filter was not built**, as instructed. **Nothing in Phase 4 was
changed**, as instructed.

---

## 1. The row count query, and what Phase 1 assumed

Phase 1 assumed **nothing** about the row count. It did not need to.

```sql
-- Run in the Supabase SQL Editor. Reads only.
SELECT
  count(*)                                     AS total_rows,
  count(*) FILTER (WHERE ended_at IS NULL)     AS open_rows,
  count(*) FILTER (WHERE ended_at IS NOT NULL) AS closed_rows,
  count(DISTINCT project_id)                   AS distinct_projects,
  count(*) FILTER (WHERE user_id IS NULL)      AS orphaned_user_rows
FROM public.project_leads;
```

`orphaned_user_rows` is included because 097 documents that deleting an account
leaves its open row in place with a NULL `user_id`, still occupying the index's
one-open slot (097 V9 covers the same case).

And the one that actually gates the migration — the index recreation fails if
**any** project holds more than one open row:

```sql
-- Must return ZERO rows.
SELECT project_id, count(*) AS open_rows
FROM public.project_leads
WHERE ended_at IS NULL
GROUP BY project_id HAVING count(*) > 1;
```

**Why no count was assumed.** The new index predicate
`(ended_at IS NULL AND role = 'lead')` selects a **subset** of the old
predicate's rows `(ended_at IS NULL)`. The old index has been enforcing
uniqueness of `project_id` over that superset since 097, and uniqueness over a
set implies uniqueness over any subset. So the `CREATE UNIQUE INDEX` **cannot
fail on existing data for any row count, including zero** — and including any
handover recorded between now and when you run it. That proof is in the
migration header; the queries above are for your confidence, not the file's
correctness.

The pre-apply test takes the same care: it measures the live table at runtime
and compares, rather than checking against a literal.

---

## 2. The role vocabulary, and why

**`('lead', 'contributor')`. Two values. The code suggests no third.**

The two role vocabularies already in this schema are `org_members.role`
(`'owner','admin','member'`) and `profiles.role` (`'agency','partner'`). Neither
describes project work and neither offers a term to borrow. Nothing in the
product distinguishes *kinds* of contribution — there is no discipline, craft or
seniority field anywhere near a project — so a richer vocabulary would invent a
distinction the interface cannot show and the data cannot fill.

**`DEFAULT 'lead'`**, so no backfill is needed: every row that exists today was
written by `set_project_lead()` and already means exactly that. The column is
also `NOT NULL`, which makes a NULL role structurally impossible — and
verification **counts** rows with a NULL role anyway (V2), because "should be
impossible" is not evidence.

---

## 3. The `set_project_lead` diff

Reproduced from the file, not from recall. Three changes, each marked `-- 098:`
in place. Comment rewording omitted here; the executable changes are complete.

```diff
   SELECT l.id, l.user_id INTO v_open_id, v_previous
   FROM public.project_leads l
   WHERE l.project_id = p_project_id
     AND l.ended_at IS NULL
+    AND l.role = 'lead'                              -- 098: THE FIX
   FOR UPDATE;

   IF v_open_id IS NOT NULL THEN
     UPDATE public.project_leads
        SET ended_at = v_now
-     WHERE id = v_open_id;
+     WHERE id = v_open_id
+       AND role = 'lead';                            -- 098: belt and braces
   END IF;

-  INSERT INTO public.project_leads (project_id, user_id, started_at)
-  VALUES (p_project_id, p_user_id, v_now)
+  INSERT INTO public.project_leads (project_id, user_id, started_at, role)
+  VALUES (p_project_id, p_user_id, v_now, 'lead')    -- 098: explicit, not defaulted
   RETURNING id INTO v_new_id;
```

Everything else is byte-identical: same signature, `LANGUAGE`, `SECURITY
DEFINER`, `search_path`, declarations, four refusals with the same SQLSTATEs and
messages, same jsonb shape.

### What the defect actually was

097's locating `SELECT` matched **every open row**. With contributors present
that is several, and plpgsql `SELECT ... INTO` **does not raise** on multiple
rows — it silently assigns the first row the plan happens to return and discards
the rest. There is no `ORDER BY`. Three outcomes:

- **(i) It picks a contributor whose `user_id` is the person being handed to.**
  The "already the point person" branch fires, the function returns
  `changed=false` and **writes nothing**, and the picker reports success. **The
  handover never happens and the interface says it did.** This is the silent
  wrong answer, and it is the reason T5 in the pre-apply test hands over *to the
  contributor* specifically.
- **(ii) It picks a different contributor.** It stamps `ended_at` on the wrong
  person's row, then inserts a lead while the real lead is still open — 23505,
  whole transaction aborts. Loud, self-repairing, but the error names a unique
  violation and explains nothing.
- **(iii) It picks the actual lead.** Correct, by luck.

**`CREATE OR REPLACE`, never `DROP`-then-`CREATE`.** A `DROP` discards the ACL
and the next `CREATE` picks up `pg_default_acl`, which on a stock Supabase
project **grants `anon` EXECUTE** — the 088 mistake, and here it would hand an
anonymous caller a `SECURITY DEFINER` writer. **V8 asserts `anon` still holds no
EXECUTE after the replace**, and **V9 asserts the new body is actually installed**,
because a replace that silently did nothing would leave V8 green and the defect
live.

---

## 4. Why the vendor side is excluded from tagging

**In one sentence:** a partnership row is readable and writable from **both**
sides, so scoping by "an org on this partnership" would let a **vendor tag their
own staff onto the agency's record of who owns the relationship** — names the
agency never chose, appearing in the agency's own surfaces as though it had —
and since the ownership claim is the agency's, both the policy and the guard name
`lead_org_id` alone.

**The evidence, read from source.** 079 gives each side its own policies
(`079_organizations.sql:1464-1498`):

```sql
"Agencies can view their partnerships"   USING (lead_org_id   IN ...)
"Partners can view their partnerships"   USING (vendor_org_id IN ...)
```

A vendor organization genuinely can `SELECT` the partnership row. Any predicate
of the form `lead_org_id IN (...) OR vendor_org_id IN (...)` inherits that and
hands the vendor `INSERT` on the agency's ownership list.

This is the same class as the read-scope defect where the vendor portal returned
the agency's own outbound RFPs because the query trusted RLS for scoping across a
two-sided table. On a two-sided table, "related to me" is not a scope — **the
side has to be named.** It is named twice here, in the policy and in the guard,
because either alone leaves the other as the hole.

**A second, independent reason the vendor side could not carry this even if it
were safe.** `partnerships.vendor_org_id` is **nullable and mostly NULL** — 079
PHASE 8 measured it as *"27 of 31 rows NULL - ghost rows"*
(`079_organizations.sql:952`), the pre-claim state before a vendor claims their
invitation. `lead_org_id` is `NOT NULL` (`:990`). A vendor-side predicate would
be comparing against NULL on the large majority of rows and silently matching
nothing — indistinguishable from a working policy until the day a vendor claims
their row.

**I found no reason to widen it, so nothing was widened and there is nothing here
for you to rule on.**

---

## 5. 098: full filename, apply order, dry-run line

**Full filename:** `supabase/migrations/098_project_roles_and_vendor_tags.sql`

**Its rollback sibling:** `supabase/migrations/098_project_roles_and_vendor_tags_down.sql`
— and **that name sorts first alphabetically under a `098_*.sql` glob.** Open
files by name. Do not glob.

| | |
|---|---|
| executable `BEGIN;` | **line 471** |
| executable `COMMIT;` | **line 899** |
| plpgsql `BEGIN` (not transaction control) | lines 566, 770 |

Both re-grepped **after** the last edit to the file.

**Dry run:** change the `COMMIT;` on **line 899** to `ROLLBACK;`, run, confirm no
errors, put it back. The verification block is after that line and entirely
commented out, so a dry run executes none of it.

### > APPLY ORDER, EXPLICITLY

```
1.  Run docs/098-preapply-test.sql. Read the FIRST LINE of the error.
2.  Dry run 098: COMMIT (line 899) -> ROLLBACK, run, confirm, put it back.
3.  Apply 098 for real.
4.  Run the VERIFICATION block. V4, V8 and V10 are the three that matter.
5.  Update the migrations table in LIGAMENT_CONTEXT.md.
6.  THEN push the code.
```

### > What you see if you push the code before applying 098

**This is stricter than it was for 097, and the difference matters.**

For 097, pushing early broke only a *new* surface. **098 breaks a surface that
currently works.**

| Surface | Before 098 is applied |
|---|---|
| **Point person picker** (`/agency/projects/[id]`) — **currently working** | Red box: *"The point person feature needs migration 098…"*. Its read now names `role`, so PostgREST answers **42703**. |
| **Contributors** (same page) — new | Red box, **42703**. |
| **Relationship owners** (`/agency/pool/[partnerId]`) — new | Red box, **42P01** `relation "public.partnership_owners" does not exist`. |
| Everything else | Unaffected. The rest of the project form saves normally. |

**The point person regression is the one to know about.** It is deliberate and
there is no fallback — a fallback would drop the role filter and reintroduce the
`PGRST116` the filter exists to prevent. It is also **why the order is not
reorderable**: apply first, push second, and the window never opens.

**The reverse direction is safe.** Applying 098 without deploying the code breaks
nothing: no existing reader filters on `role`, and the shipped picker's
`.maybeSingle()` still returns exactly one row because **no contributor rows can
exist yet**.

---

## 6. Predicted policy count: **122**

120 today, **plus exactly two** — `partnership_owners_lead_select` and
`partnership_owners_lead_insert` — **minus none**.

**Part A adds no policy and removes none.** It narrows `project_leads_org_update`
with `ALTER POLICY`, which rewrites the predicate in place and does not move the
count. That is also *why* `ALTER POLICY` was chosen over drop-and-recreate: the
count stays a single-purpose signal.

- **123** → a third policy came from somewhere. Find it before anything else.
- **121** → only one of the two was created.
- **120** → section 8 did not run.

Asserted by V11 in the migration and by T14 in the pre-apply test.

---

## 7. The down file's asymmetry

`098_project_roles_and_vendor_tags_down.sql` is **not** a clean inverse, and it
says so in its own header before anything else.

**Asymmetry 1 — dropping `role` destroys the distinction without deleting the
rows.** Contributor rows live in `project_leads` beside lead rows. Once `role` is
gone nothing in the row says which was which: an open contributor row is
byte-for-byte indistinguishable from an open lead. **Every contributor silently
becomes a lead**, on the same project, at the same time.

**Asymmetry 2 — the restored index would reject them.** The restored predicate is
`WHERE ended_at IS NULL`. A project with one open lead and one open contributor
has two matching rows, so `CREATE UNIQUE INDEX` fails with `Key (project_id)=(…)
is duplicated`, and **the whole transaction aborts having changed nothing.** That
is the safe direction: the file *refuses to run* rather than running and mangling
something.

**> It is therefore safe only while no contributor rows exist.** With any
present, it either refuses (asymmetry 2) or — if someone removed the index step
to force it through — silently promotes every contributor (asymmetry 1).

**What to check before running it**, in the file and repeated here:

```sql
-- 1. THE QUESTION THAT DECIDES SAFETY.
SELECT count(*) AS contributor_rows
FROM public.project_leads WHERE role = 'contributor';
-- 0 -> safe.  >0 -> STOP.

-- 2. WOULD THE RESTORED INDEX BUILD? Each row returned aborts the file.
SELECT project_id, count(*) FROM public.project_leads
WHERE ended_at IS NULL GROUP BY project_id HAVING count(*) > 1;

-- 3. COPY WHAT IT DESTROYS. Small, and the only record.
SELECT id, project_id, user_id, role, started_at, ended_at
FROM public.project_leads ORDER BY project_id, started_at;
SELECT id, partnership_id, user_id, added_by, added_at
FROM public.partnership_owners ORDER BY partnership_id, added_at;
```

One more thing the file states plainly: it restores `set_project_lead` to its
**097 body, which contains the defect 098 fixed.** That is correct for a
rollback, and it is only safe *because* the column is gone — with no
contributors, "the open row" and "the lead" are the same thing again.

---

## 8. Active Engagements

Written up in full at **`docs/active-engagements-one-source.md`** (Phase 4,
commit `c730d7a`). **Nothing was changed.** Summary:

| Surface | Unit it actually counts |
|---|---|
| `app/api/projects/route.ts:105` | a project, as a **stage label** — it never counts anything |
| `app/partner/page.tsx:707` | a distinct **project**, vendor side, **no liveness filter at all** |
| `app/agency/project/page.tsx:566` | an **assignment × awarded bid** row |
| `app/api/agency/utilization/route.ts:352` | a distinct **partnership**, filtered by end date |

**Two findings beyond the count mismatch.** The vendor tile says *Active* and
applies **no** liveness filter — its route selects `end_date` and `status` and
filters on neither, so a project that ended eighteen months ago still counts.
That is a defect independent of naming. And the utilization surface is **not**
mislabelled: it renders *"Vendors with active engagements"*, which accurately
describes a count of vendors, and it is the only one of the four applying any
liveness rule. It is the model to copy, not a surface to fix.

**Recommendation:** standardise on the assignment × awarded-bid grain — the only
unit carrying its own status, completion and alerts, and the only one every other
number rolls up from while none rolls down. Take the liveness rule from
`projectActiveByEndDate`, **not** from `projects.status`: that column needs an
eleven-entry legacy map to be read at all
(`app/agency/projects/[id]/page.tsx:28-39`), so a rule built on it would be a
second normalization table to keep in step with the first.

---

## 9. Gates: Phase 5 against the Phase 0 baseline

Compared against the numbers recorded at `7a1119c`, not against any document.

| Gate | Baseline | Now | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit **0**, 0 diagnostics | exit **0**, 0 diagnostics | none |
| `pnpm build` | exit **0** | exit **0** | none |
| `pnpm lint` | exit **1** — **182 problems, 154 errors, 28 warnings** | exit **1** — **182 / 154 / 28** | none |
| `identity-columns:guard` | exit 0, TOTAL 0 in 0 files, **388 scanned** | exit 0, TOTAL 0 in 0 files, **390 scanned** | **+2 files** |
| `org-id-reads:guard` | exit 0, class B **OPEN 60**, REGRESSIONS 0, footer **14 known-open**, **387 scanned** | exit 0, class B **OPEN 60**, REGRESSIONS 0, footer **14 known-open**, **389 scanned** | **+2 files** |
| `embed-targets` | exit 0, TOTAL 0 in 0 files, **388 scanned** | exit 0, TOTAL 0 in 0 files, **390 scanned** | **+2 files** |

### Every movement explained

**The only movement in any gate is the scanned-file count, +2 on all three
guards.** Those two files are `components/partnership-owner-picker.tsx` and
`components/project-contributor-picker.tsx`. Both are new, both are inside the
guards' roots, and **both produce zero findings** in all three. No finding count
moved in either direction: no REGRESSIONS, no IMPROVED, class B still 60, footer
still 14, identity and embed still 0 in 0 files.

**`org-id-reads` scans one fewer file than the other two, before and after, and
that is not a movement.** Its `ROOTS` omits `middleware.ts`
(`scripts/check-org-id-reads.mjs:134`) where the other two include it
(`check-identity-columns.mjs:50`, `check-embed-targets.mjs:77`). A constant
offset of one, unchanged by this branch.

**Lint did not move, and lint failing is the baseline.** `pnpm lint` exits 1 on
untouched `7a1119c` with 182 problems. Neither new component produces a lint
finding — grepped by filename against the Phase 5 log to confirm, rather than
inferred from the total being equal.

**Both org-id numbers were compared, as instructed.** The script prints two
different tallies — class B `OPEN 60` and a footer `14 known-open sites` — and
both are unchanged. Comparing only one would have looked clean while a
regression sat in the other.

**No guard allow-list or `KNOWN_OPEN` count was edited.** No guard tripped on
anything written this session, so no comment needed rewording.

`verify-rls` and `policy-audit:guard` were **not** run, at either end, as
instructed.

---

## 10. Open items, each with the query that settles it

**O1. How many `project_leads` rows exist, and their open/closed split?**
Not established — I have no database access. Nothing depends on the answer:
Phase 1 and Phase 2 both hold for any count including zero. Settled by the query
in §1.

**O2. Does this database contain a partnership with a claimed vendor
organization?** This decides whether T8 and T9 — **the security boundary of 098**
— can be measured at all. 079:952 says vendor_org_id is NULL on 27 of 31 rows, so
they may report INCONCLUSIVE, and the headline will then say *DO NOT APPLY YET*.
**That is correct and must not be edited away.** It means the one defect 098 was
written to prevent is argued but unmeasured.

```sql
SELECT count(*) FILTER (WHERE vendor_org_id IS NOT NULL) AS claimed,
       count(*)                                          AS total
FROM public.partnerships;

-- And whether a usable T8 subject exists at all:
SELECT p.id
FROM public.partnerships p
WHERE p.vendor_org_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = p.lead_org_id)
  AND EXISTS (SELECT 1 FROM public.org_members m
              WHERE m.org_id = p.vendor_org_id
                AND NOT EXISTS (SELECT 1 FROM public.org_members m2
                                WHERE m2.org_id = p.lead_org_id AND m2.user_id = m.user_id))
LIMIT 1;
-- 0 rows -> T8 and T9 cannot run in this database. Your call, made explicitly.
```

**O3. `project_leads` has no author column, so a contributor tag has no
recorded author.** `partnership_owners` records `added_by` and `added_at`; the
work tag records only `started_at`, because 097's table has no such column and
098 does not add one — the brief asked for who-and-when on the vendor tag only,
and adding a nullable `added_by` to a live table was outside what was asked.
**Consequence: you can see that Dana is listed as a contributor and when, but not
who put her there.** A ruling you own; if you want it, it is one more `ALTER
TABLE ... ADD COLUMN added_by uuid NULL REFERENCES profiles(id) ON DELETE SET
NULL` plus an INSERT-policy clause, and it is additive.

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='project_leads' ORDER BY ordinal_position;
-- Confirms there is no author column today.
```

**O4. Nothing prevents a duplicate contributor row.** The partial unique index
covers only open **leads**, so `(project_id, user_id, role='contributor')` can be
inserted twice. The picker filters already-listed colleagues out of its add list
and deduplicates by user id on render, so it cannot happen through the interface
— but the database permits it and there is no DELETE policy to clean one up. I
did **not** add a constraint, because doing so would have been a rule you had not
asked for on a table you own.

```sql
SELECT project_id, user_id, count(*) FROM public.project_leads
WHERE role = 'contributor' GROUP BY 1,2 HAVING count(*) > 1;
-- Must stay empty. Any row means a duplicate got in some other way.
```

**O5. The UI excludes the standing point person from the contributor add
list.** A UI decision, not a data rule — R2 says the point person *is* the
contributor marked lead, so a second row for them reads as a duplicate of the
section above. The database permits both, and once the lead is handed over that
person becomes addable. Reversible in one line if you disagree.

**O6. `pnpm lint` fails at baseline** — 182 problems, 154 errors — and this
session neither improved nor worsened it. Pre-existing, unrelated to M3, and
noted so the next session does not read a red gate as its own doing.

---

## 11. Browser checklist, ordered by risk

**Do not start until 098 is applied and its VERIFICATION block has been run.**
Every step before that reports a red box by design, which tells you nothing.

| # | Step | Commit | If it fails |
|---|---|---|---|
| **1** | **`/agency/projects/[id]` — the point person still renders**, with its existing name and "since" date. Pick a project that already has a lead. | `9bf436b` | **REVERT `9bf436b`, do not debug.** This is the one surface that worked before this branch. If it shows a red box, 098 is not applied or `role` is missing. If it shows nothing, the `.eq("role","lead")` filter is wrong and the shipped feature is broken. |
| **2** | **Hand the point person over** to another colleague, then re-read. The previous holder must appear in the project's history as closed, and the new one as current. | `9bf436b` + 098 | **REVERT and roll back 098.** A handover that reports success but does not change the lead is defect (i) in §3 — the exact silent failure this migration fixes. Check `set_project_lead`'s body with V9. |
| **3** | **Add a contributor, then confirm the point person is unchanged.** This is step 2's assertion from the other side. | `9bf436b` | **REVERT `9bf436b`.** If adding a contributor changes or clears the point person, the index or the function is wrong. |
| **4** | **Add a second contributor and reload.** Both must persist and the point person must still render — this is the `PGRST116` case. | `9bf436b` | REVERT. Two open non-lead rows breaking the page means the role filter is not being applied. |
| **5** | **`/agency/pool/[partnerId]` on a vendor you have a partnership with — add a relationship owner**, reload, confirm it persists with "added by … on …". | `1bc4cce` | Debug. New surface; nothing regresses if it is broken. Check it received `profile.partnership.id` and not the route param — a 23503 means it got the wrong id. |
| **6** | **The same page below partnership tier** — the Relationship owners card must not render at all. | `1bc4cce` | Debug. It is gated on `hasPartnershipTier && profile.partnership`. |
| **7** | **Confirm no remove control exists** on either surface, and that both say why. | `1bc4cce`, `9bf436b` | Cosmetic. Fix forward. |
| **8** | **A project with no lead and no contributors** — both sections show their honest empty states, not blanks or spinners. | `9bf436b` | Cosmetic. Fix forward. |

**Steps 1–4 are revert-not-debug.** They all touch `project_leads`, which holds
live data, and step 1 in particular is a surface that worked before this branch
existed. Steps 5–8 are new surfaces where a failure costs nothing that was
previously working.

---

## 12. Executed / read / reasoned

**EXECUTED.** The six gates, twice (Phase 0 at `7a1119c`, Phase 5 at `c730d7a`);
`tsc` and the three guards additionally after each Phase 3 commit; `pnpm build`
after Phase 3b; git branch, remote and SHA inspection; balance checks on the SQL
files (dollar-quote pairing, paren balance, odd-quote detection); a byte-level
`diff` proving the down file restores 097's function body exactly; re-greps of
`BEGIN;`/`COMMIT;` line numbers **after** the final edit to each migration.

**READ.** `097_project_leads.sql` in full, including both function bodies, the
policies and the grants; `097_project_leads_down.sql`; `docs/097-preapply-test.sql`
for the assertion shape, impersonation mechanism and self-check;
`079_organizations.sql` for the partnerships policies (1464-1498), the
nullability decisions (940-1000) and `current_user_org_ids()` (451-481);
`scripts/010-closed-ecosystem-schema.sql` for the partnerships table;
`lib/acting-org.ts` in full; `components/project-lead-picker.tsx` in full; the
four Active Engagements surfaces and the routes behind two of them; the three
guard scripts' file-selection logic.

**REASONED.** That the new index predicate is a strict subset of the old and
therefore cannot fail on existing data at any row count. That `set_project_lead`
breaks on contributors in three specific ways, of which the silent one is worst.
That the add-only requirement and 097's UPDATE policy do **not** conflict,
because `set_project_lead` is `SECURITY DEFINER` and never consults RLS — so
097's stated reason for that policy ("UPDATE is how ended_at gets stamped, so it
cannot be withheld") does not actually hold. That the existing INSERT policy
already admits contributor rows, so no policy was added. That `partnership_owners.user_id`
should CASCADE where `project_leads.user_id` SET NULLs, because this table
records no interval and a SET NULL orphan could never be cleared without a DELETE
policy. That `role` parses as a bare column reference (a PostgreSQL non-reserved
keyword, with `CHECK (role IN (...))` precedent in this schema).

**NOT ESTABLISHED.** Anything requiring the database: O1, O2, and whether the
pre-apply test passes. **098 has not been applied and the test has not been
run** — that is yours, by prohibition 1.
