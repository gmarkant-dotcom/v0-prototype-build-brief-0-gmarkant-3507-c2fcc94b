# 097 - Phase 0 baseline, and the two questions that gate the later phases

Recorded before any file in this session was edited, at
`7827a5c docs: phase 5, gates against the phase 0 baseline and the bid notification scope report`,
on branch `feat/m3-project-leads`, working tree clean.

Every number in section 1 was **EXECUTED**, not read from a document. Phase 5 re-runs the
same six commands and compares against this file and nothing else.

---

## 1. The six gates, as measured

| # | Command | Exit | Measured |
|---|---------|------|----------|
| 1 | `npx tsc --noEmit` | **0** | zero diagnostic lines |
| 2 | `pnpm build` | **0** | compiled in 10.9s, 72/72 static pages, 174 route lines |
| 3 | `pnpm lint` | **1** | **182 problems (154 errors, 28 warnings)** across 164 files |
| 4 | `pnpm identity-columns:guard` | **0** | 387 files scanned, TOTAL 0 in 0 files, GUARD PASSED |
| 5 | `pnpm org-id-reads:guard` | **0** | OPEN 14 (class A) / 60 (class B), REGRESSIONS 0, IMPROVED 0, GUARD PASSED |
| 6 | `pnpm embed-targets --guard` | **0** | 387 files scanned, REPOINTED 0, PERSON 0, TOTAL 0 |

`pnpm lint` exits 1 at baseline. That is the pre-existing state of this branch, not
anything this session introduced. The number to hold is **182 / 154 / 28**.

Gate 5 is clean in both directions this time - unlike the 096 baseline, there is no
`IMPROVED` line waiting to be cleared. Any movement at Phase 5 is this session's doing.

**Not run, deliberately:** `pnpm verify-rls` and `pnpm policy-audit:guard`. Neither reads
a `.ts` file, so neither can move on anything this session touches, and both want database
access this session is prohibited from seeking.

---

## 2. (a) What is an "engagement" in this schema?

### THE ANSWER: THE CODE DOES NOT SETTLE IT. **PHASE 2 IS SKIPPED.**

Greg offered two candidates - a `project_assignments` row (project plus partnership), or
the partnership itself. The string "Active Engagements" is rendered by **four** different
surfaces in this repository, and they count **four different units**. Two of those units
are neither of Greg's candidates.

### The four renderers, quoted

**(1) A PROJECT.** The workflow-stage label on the project card - the surface Greg's
question actually names - is a property of a project, not of an assignment or a
partnership:

```
app/api/projects/route.ts:105
  if (hasAwarded) return { key: 'active_engagements', label: 'Active Engagements' }
```

`hasAwarded` is a per-project boolean, folded from the project's assignment rows and then
discarded:

```
app/api/projects/route.ts:216-218
  const assigns = unwrapAssignmentRows(row.project_assignments)
  if (assigns.some((a) => a.status === 'awarded')) projectIdsWithAwarded.add(pid)
```

The dashboard carries an independent second copy of the same rule, keyed on projects again:

```
app/api/agency/dashboard/route.ts:50,61
  active_engagements: "Active Engagements",
  if (awardedProjectIds.has(projectId)) return "active_engagements"
```

**(2) A PROJECT, again, on the partner side.** The vendor dashboard tile labelled "Active
Engagements" counts projects:

```
app/partner/page.tsx:705-707
  {activeProjectsLoading ? "-" : fetchedActiveProjects.length}
  ...
  <div className="...">Active Engagements</div>
```

**(3) A `project_assignments` ROW CROSSED WITH AN AWARDED BID.** The agency project
surface's countable "engagement" is finer-grained than an assignment. The query is on
assignments:

```
app/api/agency/active-engagements/route.ts:170,186-187
  .from("project_assignments")
  ...
  .eq("status", "awarded")
  .in("project_id", agencyProjectIds)
```

but the rows it emits are per awarded response, with `assignmentId` **repeated** across
them - one assignment carrying three awarded scope items produces three rows
(`app/api/agency/active-engagements/route.ts:507-525`, the `for (const resp of responses)`
loop over `responsesForAssignment()`), and only when an assignment has zero awarded
responses does it emit one placeholder row. That repeated-id list is what the user counts:

```
app/agency/project/page.tsx:566
  <span>{rows.length} engagement{rows.length !== 1 ? "s" : ""}</span>
```

**(4) A PARTNERSHIP.** The pool page's "Vendors with active engagements" stat counts
distinct partnership ids, reached through awarded responses rather than through
`project_assignments` at all:

```
app/api/agency/utilization/route.ts:341-342,350-352
  /** Distinct partnership_ids with >=1 awarded response on a project that has not passed end_date. */
  const activeEngagedPartnershipIds = new Set<string>()
  ...
      activeEngagedPartnershipIds.add(String(inbox.partnership_id))
  const partners_with_active_engagements = activeEngagedPartnershipIds.size
```

surfaced at `app/agency/pool/page.tsx:1359` as `Vendors with active engagements`.

### Why this is a refusal and not a tie-break

The brief's instruction was to find what the project card's "ACTIVE ENGAGEMENTS" renders
from and quote it. It renders from a **project** (renderer 1). That is not one of the two
candidates offered, so the surface Greg pointed at does not choose between them - it
points at a third thing. Meanwhile renderer 3 votes for `project_assignments` and renderer
4 votes for `partnerships`, and they disagree with each other while wearing the same label.

A tag table pointing at the wrong one takes a migration to remove and its rows cannot be
moved. So per the brief: **no tag table is built. Phase 2 is skipped.**

### The two shapes and what each would cost

**Shape A - `project_assignment_id uuid REFERENCES project_assignments(id)`**

- Fits renderer 3, the only surface where a user sees a countable engagement list.
- A tag is scoped to one vendor on one project. Precise.
- Cost: `project_assignments` rows are created at award time
  (`app/api/agency/rfp-responses/[id]/route.ts:475` refuses the award when
  `partner_rfp_inbox.project_id` is null). A vendor you want to tag a colleague against
  **before** an award has no row to point at, so the tag cannot be written until the bid
  is won.
- Cost: `ON DELETE CASCADE` from `projects` already reaches `project_assignments`
  (`scripts/010-closed-ecosystem-schema.sql:73`). Deleting a project would silently take
  the manual tags with it, which is the same fact-erasure problem R2 exists to prevent.
- Cost: renderer 3 counts per awarded response, not per assignment, so a tag on the
  assignment attaches to a row the UI shows N times. The tag would appear N times or need
  de-duplication at render.

**Shape B - `partnership_id uuid REFERENCES partnerships(id)`**

- Fits renderer 4, and fits R4's phrasing ("the connection between a colleague and a
  vendor") most literally - a partnership *is* the agency-vendor relationship.
- A tag survives across projects and outlives any single award. It can be written before
  any award exists.
- Cost: it is **coarser than the derived layer**. R4 derives the colleague-vendor link
  from "the distinct point persons of the projects that vendor worked on" - that is
  project-scoped. A manual tag that is partnership-scoped cannot be expressed in the same
  units as a derived one, so the union in R4 would be a union of two different shapes, and
  "which project was Dana tagged for" has no answer.
- Cost: cannot express "tag Dana onto this vendor for the Nike job only".

**The question that settles it, for Greg:** when you tag a colleague onto a vendor
engagement, are you saying *"Dana handles this vendor"* (Shape B) or *"Dana handles this
vendor on this project"* (Shape A)? R4's own wording points both ways: "the connection
between a colleague and a vendor" is Shape B, but deriving it from "the projects that
vendor worked on" is Shape A.

Phases 1, 3 and 4 do not depend on this answer and proceed as briefed.

---

## 3. (b) Does `projects` carry any creator or owner column?

### THE ANSWER: NO. NOTHING CAN SEED AN INITIAL LEAD.

**What exists.** `projects` was created at `scripts/010-closed-ecosystem-schema.sql:43-60`
with these columns and no others:

```
id, agency_id, title, description, client_name, budget_range,
deadline, status, created_at, updated_at
```

Since then it has been altered exactly twice on disk:

| Where | Change |
|---|---|
| `supabase/migrations/077_client_profiles.sql:111-112` | `ADD COLUMN client_id uuid NULL REFERENCES clients(id) ON DELETE SET NULL` |
| `supabase/migrations/079_organizations.sql:657` | `RENAME COLUMN agency_id TO org_id` (and `:981` `SET NOT NULL`) |

Neither adds a person. `agency_id`/`org_id` is the only ownership column, and after 079 it
is an **organization** id, not a user id - which is precisely why this table cannot name a
person any more even by accident.

**What does not exist.** `grep -rn "owner_id" app lib supabase scripts` returns **zero
hits repository-wide**. `grep -rn "created_by" app lib supabase scripts` returns **two
hits, both prose**, and both say the column deliberately does not exist:

```
supabase/migrations/080_milestone_events.sql:10-11
  -- Greg's ruling: attribution belongs in M1, scoped to milestones rather
  -- than a created_by column on every table.
```

`lib/milestone-events.ts:9` repeats the same sentence. So the absence is a **ruling
already made**, not an oversight.

**Corroborating evidence from the write side.** The only INSERT into `projects` is
`app/api/projects/route.ts:590-598`, and its payload is:

```
org_id, name, status, description, budget_range, start_date, end_date
```

plus `client_id` / `client_name` from the reconciler at `:611`. No actor field is written,
even though `user.id` is in scope four lines above. A project has never recorded who made
it.

### How many live projects would have a usable value: **ZERO, and not because the data is
sparse - because the column does not exist.**

This is READ from the schema, not measured against the database: this session is
prohibited from seeking database access, so no row count was taken. The count is not
needed. A column that does not exist has no non-null values by definition.

### SAY THIS PLAINLY, BECAUSE IT WILL LOOK LIKE A BUG

**After 097 applies, EVERY project shows "No point person yet".** Every one. There is no
partial state and no lucky subset - the leads table lands empty and stays empty until a
human opens each project and picks somebody.

The consequence Greg should expect, in order:

1. Day one, every project on the project surface reads "No point person yet".
2. The pool filter built later - the one deliberately held back this session - returns
   **nothing for everybody**, because filtering on "projects led by X" over an empty table
   matches no rows for every X.
3. That reads as a **broken feature**, not an unfilled one. A filter that returns nothing
   for every user is indistinguishable from a filter that is wired up wrong.

### What could seed one, if Greg ever wants to - NOT WRITTEN HERE

`milestone_events.actor_id` (`supabase/migrations/080_milestone_events.sql:262`,
`uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL`, applied) does record which
person on the agency side did what, per project-scoped event. It is the only place in the
schema where a person is attached to project work.

**No backfill is written, offered, or drafted.** Whose name goes on old work is a product
decision and Greg's alone - and `actor_id` would answer "who acted on this project", which
is a different question from "who leads this project". The first RFP sender is not
necessarily the point person.

The query that would tell Greg how much of a seed exists, if he decides he wants one:

```sql
-- How many projects have at least one identified agency-side actor?
SELECT
  (SELECT count(*) FROM public.projects)                       AS total_projects,
  count(DISTINCT me.project_id)                                AS projects_with_an_actor
FROM public.milestone_events me
WHERE me.actor_side = 'agency'
  AND me.actor_id IS NOT NULL;
```

---

## 4. What was EXECUTED, READ and REASONED in this phase

- **EXECUTED:** all six gate commands in section 1; the `grep` sweeps for
  `owner_id`, `created_by`, `active engagement`, `project_assignments`,
  `ALTER TABLE ... projects`.
- **READ:** `scripts/010-closed-ecosystem-schema.sql`, `supabase/migrations/077`, `079`,
  `080`, `app/api/projects/route.ts`, `app/api/agency/active-engagements/route.ts`,
  `app/api/agency/utilization/route.ts`, `app/api/agency/dashboard/route.ts`,
  `app/agency/project/page.tsx`, `app/agency/pool/page.tsx`, `app/partner/page.tsx`.
- **REASONED:** that four renderers counting four units is a refusal rather than a
  tie-break; the two shapes' costs in section 2; that a non-existent column has no usable
  values without needing to be counted.
- **NOT DONE, deliberately:** no database was queried; no backfill was written; no tag
  table was designed past the two-shape comparison.
