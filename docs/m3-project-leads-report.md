# M3 - project leads. Run report.

Branch `feat/m3-project-leads`. Five commits, one per phase boundary, each revertable
alone. **Nothing was pushed. No migration was applied. No database was queried.**

---

## READ THIS FIRST

**PHASE 2 WAS SKIPPED.** The code does not settle what an "engagement" is, so no tag
table was built. Section 2 gives the evidence, both candidate shapes with their costs,
and the one question that settles it. Phases 0, 1, 3, 4 and 5 completed in full.

**EVERY PROJECT WILL SHOW "No point person yet" ON DAY ONE.** All of them. `projects`
has never carried a creator or owner column, so nothing can seed an initial lead and no
backfill was written. Section 3.

**ONE THING CHANGED THAT THE BRIEF DID NOT ASK FOR, AND GREG SHOULD SEE IT.** 097 also
creates a `set_project_lead()` function. Phase 4(b) required the handover to be atomic
from the application; two PostgREST calls cannot be. Section 6 makes the argument.

---

## 1. What was EXECUTED, what was READ, what was REASONED

**EXECUTED.** All six gates, twice - Phase 0 on a clean tree at `7827a5c`, Phase 5 at
`344331b`. The `grep` sweeps behind sections 2 and 3. `npx eslint` on the two files
Phase 4 touches, four times, while the picker was restructured to hold the lint baseline.
`pnpm org-id-reads:guard` a third time after it caught a real regression in code this
session wrote (section 7).

**READ.** `scripts/010-closed-ecosystem-schema.sql`; migrations 077, 079, 080, 086, 090,
096 and their headers; `docs/096-preapply-test.sql`; `scripts/check-org-id-reads.mjs`;
`app/api/projects/route.ts`, `app/api/agency/active-engagements/route.ts`,
`app/api/agency/utilization/route.ts`, `app/api/agency/dashboard/route.ts`,
`app/agency/project/page.tsx`, `app/agency/projects/[id]/page.tsx`,
`app/agency/pool/page.tsx`, `app/partner/page.tsx`,
`app/agency/settings/team/team-roster-client.tsx`, `lib/acting-org.ts`.

**REASONED.** That four renderers counting four different units is a refusal rather than
a tie-break (section 2). That `user_id` must be nullable so its foreign key can SET NULL
(section 5). That the handover cannot be atomic from the browser (section 6). That a
column which does not exist needs no row count (section 3).

**NOT DONE, DELIBERATELY.** No migration applied, no database queried, no push, no PR, no
backfill, no vendor pool filter, no edit to any guard allow-list or KNOWN_OPEN count, no
change to `middleware.ts`, `app/auth/callback/route.ts`, any feature flag, any migration
numbered 096 or lower, or anything in the budget spine.

---

## 2. Phase 0(a) - what is an "engagement"? **AMBIGUOUS. PHASE 2 SKIPPED.**

Full evidence in `docs/097-phase0-baseline.md` section 2. In brief: the string "Active
Engagements" is rendered by **four** surfaces which count **four different units**.

| # | Where | What it counts |
|---|---|---|
| 1 | `app/api/projects/route.ts:105`, `app/api/agency/dashboard/route.ts:61` | **a PROJECT** - the workflow-stage label on the project card |
| 2 | `app/partner/page.tsx:705-707` | **a PROJECT**, vendor side |
| 3 | `app/agency/project/page.tsx:566` | **a `project_assignments` row CROSSED WITH an awarded bid** - `assignmentId` repeats across rows |
| 4 | `app/api/agency/utilization/route.ts:352` -> `app/agency/pool/page.tsx:1359` | **a distinct `partnership_id`** |

The project card Greg pointed at renders from a **project** - neither of the two candidates
he offered - so the surface named in the brief does not break the tie. Renderer 3 votes for
`project_assignments`; renderer 4 votes for `partnerships`; they disagree while wearing the
same label.

**Shape A, `project_assignments(id)`:** precise, per vendor per project; but the row does
not exist until a bid is awarded, so a tag cannot be written before then, and `projects`
already CASCADEs into `project_assignments`, so deleting a project would take the manual
tags with it - the same fact-erasure R2 exists to prevent.

**Shape B, `partnerships(id)`:** matches R4's phrasing most literally and survives across
projects; but it is coarser than the derived layer R4 describes ("the distinct point
persons of the projects that vendor worked on" is project-scoped), so "which project was
Dana tagged for" would have no answer, and "tag Dana onto this vendor for the Nike job
only" could not be expressed.

> **THE QUESTION THAT SETTLES IT.** When you tag a colleague onto a vendor engagement, are
> you saying *"Dana handles this vendor"* (Shape B) or *"Dana handles this vendor on this
> project"* (Shape A)? R4 points both ways: "the connection between a colleague and a
> vendor" is Shape B, deriving it from "the projects that vendor worked on" is Shape A.

A table pointing at the wrong thing takes a migration to remove and its rows cannot be
moved, so nothing was built on a guess.

---

## 3. Phase 0(b) - is there anything to seed a lead from? **NO.**

`projects` was created at `scripts/010-closed-ecosystem-schema.sql:43-60` and altered
exactly twice on disk since: `077_client_profiles.sql:111` added `client_id`, and
`079_organizations.sql:657` renamed `agency_id` to `org_id`. Neither adds a person.

`grep -rn "owner_id" app lib supabase scripts` returns **zero hits repository-wide**.
`grep -rn "created_by"` returns **two, both prose**, and both say the column was ruled out
on purpose - `080_milestone_events.sql:10-11`: *"attribution belongs in M1, scoped to
milestones rather than a created_by column on every table."*

The only INSERT into `projects` (`app/api/projects/route.ts:590-598`) writes `org_id`,
`name`, `status`, `description`, `budget_range`, `start_date`, `end_date` and the client
fields. No actor, though `user.id` is in scope four lines above.

### WHAT GREG SEES ON DAY ONE, PLAINLY

1. **Every project reads "No point person yet."** Every one. There is no partial state and
   no lucky subset.
2. The vendor pool filter built later - deliberately not built this session - **returns
   nothing for everybody**, because filtering on "projects led by X" over an empty table
   matches nothing for every X.
3. **That reads as a broken feature, not an unfilled one.** A filter that returns nothing
   for every user is indistinguishable from one that is wired up wrong.

`milestone_events.actor_id` (`080_milestone_events.sql:262`, applied) is the only place a
person is attached to project work and is the only possible seed. **No backfill is
written, offered or drafted** - whose name goes on old work is Greg's call, and "who acted
on this project" is a different question from "who leads it". The query that measures the
seed, if he ever wants one, is in `docs/097-phase0-baseline.md` section 3.

---

## 4. The migration

**FULL FILENAME: `supabase/migrations/097_project_leads.sql`**

Rollback sibling: `supabase/migrations/097_project_leads_down.sql`. **That name sorts FIRST
alphabetically under a `097_*.sql` glob.** A `094_*` glob matched the down file first this
week and the down file was applied by mistake. Open the file by its full name.

| | |
|---|---|
| `BEGIN;` | **line 301** |
| `COMMIT;` | **line 650** - this is the line to change to `ROLLBACK;` for the dry run |
| bare plpgsql `BEGIN` | lines 393 and 478 - not transaction control, not matched by `grep -n 'BEGIN;'` |
| down file `BEGIN;` / `COMMIT;` | lines 78 / 91 |

All re-grepped after the last edit to either file.

**PREDICTED POLICY COUNT: 120.** 117 today, plus exactly three new policies (SELECT,
INSERT, UPDATE on `project_leads`), minus none. Asserted by the migration's V8 and by the
pre-apply test's T9.

### THE APPLY ORDER, EXPLICITLY

```
1.  Run docs/097-preapply-test.sql.  Read the FIRST LINE of the error.
      "SAFE TO APPLY 097."      -> continue
      anything else             -> stop, read the FAIL / INCONCLUSIVE lines
2.  Dry run supabase/migrations/097_project_leads.sql:
      change COMMIT; on LINE 650 to ROLLBACK;, run, confirm no errors,
      put COMMIT; back.
3.  Run supabase/migrations/097_project_leads.sql for real.
4.  Run the VERIFICATION block at the foot of it, V1 through V10.
      V8 must read 120.
5.  Update the migrations table in LIGAMENT_CONTEXT.md.
6.  THEN push the code.
```

**IF THE CODE IS PUSHED BEFORE 097 IS APPLIED:** the point person section on
`/agency/projects/[id]` renders a red box reading *"The point person feature needs
migration 097, which has not been applied to this database yet."* The read fails with
PostgREST `42P01` (`relation "public.project_leads" does not exist`); the write, if
reached, fails `42883`. **That is intended and is not a bug to patch.** There is
deliberately no fallback path - the 082 fallback blocks are the cautionary tale, and a
wrong answer about who runs a project is worse than a visible failure. Nothing else on that
page is affected: the rest of the form saves normally, and no other surface reads either
object.

---

## 5. The foreign keys, and the reasoning

079 PHASE 7's rule (`079_organizations.sql:904-910`): CASCADE on a NOT NULL identity
column, SET NULL on a nullable one. Nullability is how the choice gets expressed, so the
real decision is which columns are nullable.

**`project_id -> projects(id)`, NOT NULL, ON DELETE CASCADE.** A leadership record is a
fact *about a project*. When the project is gone there is no fact left to preserve - "Dana
led the project that no longer exists" is not history. `project_assignments` already
CASCADEs from `projects` the same way (`scripts/010-closed-ecosystem-schema.sql:73`).

**`user_id -> profiles(id)`, NULLABLE, ON DELETE SET NULL. This one is the argument, and
it goes the other way.** A leadership record is a fact about a *project's past*, not a
possession of the person named in it. CASCADE would mean: delete a colleague's account and
every project they ever ran silently forgets it was ever run - the March-to-June gap just
closes up. **This table exists specifically to preserve such facts (R2), so a delete rule
that erases them defeats the table.** SET NULL keeps the row and loses only the name, which
is the part that genuinely belonged to the deleted account.

So `user_id` is nullable not because a lead is optional but because 079's rule reads
nullability as the switch. The application never writes NULL: `set_project_lead()` refuses
a NULL `p_user_id` with LG006 and there is no other sanctioned writer.

**RESTRICT was considered and rejected** - it turns deleting an account into an error
nobody can act on, and 079's rule does not offer it.

**THE ONE CONSEQUENCE, SO IT IS NOT A SURPRISE.** If the account holding a project's *open*
lead is deleted, that row stays open with a NULL `user_id`. The project reads as having no
point person while the partial index's one-open slot is taken. It is not stuck:
`set_project_lead()` closes whatever open row it finds, NULL user or not. The picker has a
distinct line for this state, and the migration's V9 finds any such rows.

---

## 6. Can the handover be atomic from the application? **NO - AND THAT IS WHY 097 CARRIES A FUNCTION**

R2 makes reassigning **two writes**: stamp `ended_at` on the open row, insert a new one.
From the browser those are **two PostgREST calls, which are two HTTP requests with no
transaction between them.** A failure in the gap leaves the project in one of two states,
neither with a user-visible cause:

- the close landed and the insert did not -> the project has **no open lead**;
- the insert were attempted first and the close did not land -> the partial unique index
  refuses, and goes on refusing **every subsequent attempt**.

Phase 4(b) said to say so rather than ship two writes. Saying so is the answer, and the
brief itself named the remedy: *"That is an argument for a SECURITY DEFINER function and
Greg should hear it."*

**So 097 creates `public.set_project_lead(p_project_id uuid, p_user_id uuid) -> jsonb`,
and the picker calls it over RPC and does nothing else.** Both halves run in one
transaction. This is the only object in 097 that Phase 1's lettered list did not name, and
it is flagged here rather than buried.

It follows 090's `set_active_org` shape (`090_active_org.sql:456-499`): **caller-dependent
on purpose**, because SECURITY DEFINER bypasses RLS and the function must do its own
authorization against `auth.uid()`. That is the opposite of the guard trigger, which must
ignore the caller. The distinction is stated in both headers.

Refusals: `LG002` signed out, `LG006` on a NULL argument, `LG011` for a project that does
not exist **or** is not the caller's (one refusal for two conditions, per 089's LG001 and
090's LG005 - answering differently would confirm another organization's project exists),
`LG010` for a point person who is not on the team. LG010 and LG011 are new; LG001-LG009 are
taken by 089-093.

---

## 7. Phase 5 gates, against the Phase 0 baseline and nothing else

Baseline recorded at `7827a5c`, clean tree. Phase 5 measured at `344331b`.

| # | Command | Phase 0 | Phase 5 | Movement |
|---|---------|---------|---------|----------|
| 1 | `npx tsc --noEmit` | exit **0**, 0 lines | exit **0**, 0 lines | none |
| 2 | `pnpm build` | exit **0**, 72/72 pages, 174 route lines | exit **0**, 72/72 pages, 174 route lines | none (compile time 10.9s -> 12.5s, noise) |
| 3 | `pnpm lint` | exit **1**, **182 / 154 / 28** across 164 files | exit **1**, **182 / 154 / 28** across 164 files | none |
| 4 | `pnpm identity-columns:guard` | exit **0**, TOTAL 0 in 0 files | exit **0**, TOTAL 0 in 0 files | files scanned 387 -> **388** |
| 5 | `pnpm org-id-reads:guard` | exit **0**, OPEN 14 / 60, REGRESSIONS 0, IMPROVED 0 | exit **0**, OPEN 14 / 60, REGRESSIONS 0, IMPROVED 0 | files scanned 386 -> **387** |
| 6 | `pnpm embed-targets --guard` | exit **0**, REPOINTED 0, PERSON 0 | exit **0**, REPOINTED 0, PERSON 0 | files scanned 387 -> **388** |

**Every movement, explained.**

- **Files scanned, +1 on all three guards.** `components/project-lead-picker.tsx`, the one
  new source file. No finding count moved.
- **`pnpm lint` still exits 1 at 182 / 154 / 28.** That is the pre-existing state of this
  branch. Holding it exactly was work, not luck: the picker's first draft added two
  `react-hooks/set-state-in-effect` errors. It was restructured twice - the loader moved
  inside the effect the way `team-roster-client.tsx` does it, and the loading flag replaced
  by a derived `loadedFor` comparison. Both changes are better code on their own terms; the
  second also removes a real hazard, since rendering the previous project's point person for
  a frame is exactly the wrong answer this feature must never give.
- **`pnpm build` compile time 10.9s -> 12.5s.** Machine noise. The static page count, the
  route count and the exit code are all unchanged.

**Not run, deliberately:** `pnpm verify-rls` and `pnpm policy-audit:guard`. Neither reads a
`.ts` file, so neither can move on anything this session touched, and both want database
access this session was prohibited from seeking.

### THE ONE GATE FAILURE THIS SESSION, AND HOW IT WAS FIXED

`pnpm org-id-reads:guard` **FAILED** on the first Phase 5 run:

```
  components/project-lead-picker.tsx   found 1, KNOWN_OPEN records 0
      208  NEARBY .in("id", wanted)
```

A profiles-by-id read with an organization identifier inside the check's 40-line proximity
window. The ids were genuinely people - `org_members.user_id` and `project_leads.user_id`,
both foreign keys to `profiles(id)` - so it was the same false positive
`app/agency/settings/team/team-roster-client.tsx` is allow-listed for, on the same
reasoning.

**THE ALLOW-LIST WAS NOT TOUCHED.** The read was hoisted into its own function,
`loadDisplayNames(supabase, ids)`, placed above every line in the file that names an
organization. That function holds no organization id in scope at all, which is the real
property 079's defect class is about - a company id reaching a profiles read and returning
the right rows anyway because sixteen organizations carry their founding user's id. The
guard going quiet is a consequence of the structure, not the reason for it, and the
function's header says exactly that.

---

## 8. Browser checklist, ordered by risk

Run after applying 097 and pushing. **Steps 1-3 are revert-not-debug.**

| # | Step | Commit | Expected | If it fails |
|---|------|--------|----------|-------------|
| 1 | Open `/agency/projects/<id>` as the lead agency. | `344331b` | The **Point Person** section renders between Client and Status, reading "No point person yet. Any member of your team can set one." | If it reads *"needs migration 097"*, **097 is not applied** - apply it, do not touch the code. Any other error: **REVERT `344331b`**, do not debug on a live surface. |
| 2 | Save the rest of the form (change the budget, press Save Changes). | `344331b` | Saves exactly as before. The picker is independent of it. | **REVERT `344331b`.** The picker must not be able to break a form that worked. |
| 3 | Set yourself as point person. | `344331b` + 097 | The select shows your team; choosing you shows "Point person updated" and the line reads your name "since <timestamp>". | A refusal quoting LG010 on your own account means the guard is reading `org_members` through RLS - **roll back 097** with `097_project_leads_down.sql` and re-read V5. |
| 4 | Reassign to a colleague. **This is R2.** | `344331b` + 097 | The name changes. Then run V10 from the migration's verification block: the project must carry **TWO** rows, the older with `ended_at` set, the newer with `ended_at` NULL, **and the two timestamps equal**. | ONE row means the picker overwrote instead of handing over. Roll back 097 and re-read V3 - most likely the unique index lost its `WHERE ended_at IS NULL`. |
| 5 | Reassign back. | `344331b` + 097 | Three rows now. Choosing the person who is already the point person does nothing and writes nothing (`changed=false`). | A 23505 here is the partial index behaving as a plain unique. Roll back. |
| 6 | Sign in as a partner (`gmarkant@icloud.com`) and open any shared surface. | `344331b` + 097 | No point person is visible anywhere. The picker is agency-only and `project_leads` has no vendor-facing policy. | If a vendor can see it, roll back 097 immediately - that is a cross-organization read. |
| 7 | Check the migrations table in `LIGAMENT_CONTEXT.md`. | - | A row for 097. | Add it. Step 5 of the apply order. |

---

## 9. Every OPEN item, with the query that settles it

**OPEN-M3-1. What is an engagement?** Phase 2 is skipped until this is answered. It is a
product question, not a query - see the boxed question in section 2. The query that shows
Greg the two populations he is choosing between:

```sql
SELECT
  (SELECT count(*) FROM public.project_assignments WHERE status = 'awarded') AS awarded_assignments,
  (SELECT count(DISTINCT partnership_id) FROM public.project_assignments)     AS distinct_partnerships,
  (SELECT count(*) FROM public.partnerships)                                  AS all_partnerships;
-- If distinct_partnerships is much smaller than awarded_assignments, Shape B
-- is throwing away project granularity that the data actually carries.
```

**OPEN-M3-2. Nothing seeds an initial lead.** Every project reads "No point person yet"
until somebody sets one by hand. How much of a seed `milestone_events` could offer:

```sql
SELECT (SELECT count(*) FROM public.projects)  AS total_projects,
       count(DISTINCT me.project_id)           AS projects_with_an_agency_actor
FROM public.milestone_events me
WHERE me.actor_side = 'agency' AND me.actor_id IS NOT NULL;
```

**No backfill is written. This is Greg's call and only his.**

**OPEN-M3-3. The pre-apply test may be inconclusive on a one-organization database.** T3,
T6 and T7 need a profile outside the subject project's organization. Without one the
membership guard and the cross-organization isolation are **untested** and the headline
reads "DO NOT APPLY 097 YET", correctly. What decides it:

```sql
SELECT count(*) AS organizations, sum(members) AS memberships FROM (
  SELECT o.id, count(m.id) AS members
  FROM public.organizations o LEFT JOIN public.org_members m ON m.org_id = o.id
  GROUP BY o.id) x;
-- More than one organization with members -> T3/T6/T7 will find a subject.
```

**OPEN-M3-4. An open lead can be left with a NULL point person** if the account holding it
is deleted. Expected to be zero for a long time; self-clearing on the next assignment:

```sql
SELECT count(*) FROM public.project_leads WHERE ended_at IS NULL AND user_id IS NULL;
```

**OPEN-M3-5. The vendor pool filter is NOT built.** Held back deliberately - the filter
block is already seven rows deep and its design is unsettled. When it is built it will
return nothing for everybody until OPEN-M3-2 is resolved (section 3).

**OPEN-M3-6. `set_project_lead()` was not in Phase 1's lettered list.** It is in 097
because Phase 4(b) required an atomic handover and nothing else can provide one (section
6). If Greg would rather it were not there, removing it means the picker cannot satisfy R2
safely, and that trade is his to make - the function is one contiguous block,
`097_project_leads.sql:465-563`, and its two REVOKE/GRANT lines are at 605-607.

---

## 10. The five commits

| SHA | Phase | What reverting it costs |
|---|---|---|
| `98207c8` | 0 | The baseline record and both Phase 0 answers. Documentation only. |
| `3225db1` | 1 | Migration 097 and its down file. **Do not revert this after applying 097** - the file would be gone while the objects stayed. |
| `44dd93c` | 3 | The pre-apply test. Documentation only. |
| `344331b` | 4 | The picker. Safe to revert at any time; the migration stands on its own and nothing else reads it. |
| this one | 5 | This report. |

Phase 2 has no commit because it was skipped.
