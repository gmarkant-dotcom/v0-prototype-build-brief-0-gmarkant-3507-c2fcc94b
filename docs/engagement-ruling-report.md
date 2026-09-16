# The engagement ruling: recorded, applied, and the dead definitions removed

> ## MERGE STATUS: **NOT MERGED** as of 2026-09-15.
>
> Branch `feat/engagement-ruling`, three commits, based on `6df1204`.
>
> ### >>> UPDATE THIS LINE WHEN THIS BRANCH MERGES. <<<
>
> **Do not trust this header. Verify it.** Eight consecutive reports in `docs/` declared
> themselves unmerged while sitting on `main`, and that was the previous run's largest finding.
> A status line nobody updates is worse than no status line, because it is read as current.
>
> ```
> git merge-base --is-ancestor 789d879 main && echo MERGED || echo NOT MERGED
> ```
>
> That command is the answer. This sentence is not. It was verified NOT MERGED at the moment
> this file was written, by running exactly that.

---

## What this run was asked to do, and what it found

Greg ruled on 2026-09-15, **Option B: an engagement is one awarded scope commitment - an
assignment.** The run recorded the ruling, applied it where it was only a label, fixed a vendor
label three sessions had reported and not fixed, and deleted the dead code carrying competing
definitions of the word.

**The brief was wrong about one thing and it was the dangerous one.** See phase 3, candidate
(c). It listed a LIVE route for deletion. Deleting it would have broken the agency project page.

---

## Phase 0. Baseline

Working tree was clean at `6df1204`, and `HEAD == origin/main`, verified before anything else.

Baseline measured in a throwaway worktree of `origin/main`, each gate its own unpiped command
with `$?` read on the next statement. Tools were invoked directly rather than through `pnpm`:
a worktree has no `node_modules`, and pnpm's dependency-status check fires before the script,
aborts, and reports its own exit code as the gate's.

| Gate | Baseline | Where run |
| --- | --- | --- |
| `tsc --noEmit` | **0** | worktree |
| `build` | **0** | main repo, tree clean and identical to `origin/main` |
| `lint` | **1**, and the full triple **182 problems (154 errors, 28 warnings)** | worktree |
| `identity-columns:guard` | **0** | worktree |
| `org-id-reads:guard` | **0** (Class B: 60 known-open, unchanged) | worktree |
| `embed-targets` | **0** | worktree |
| `policy-audit:guard` | **1** (known, static snapshot) | worktree |
| `verify-rls` | **2** (known, PostgREST does not expose `pg_class`) | worktree |

`build` was run in the main repo rather than the worktree, deliberately: it needs a real
install, and the symlinked-`node_modules` worktree is where a previous session hit a Turbopack
symlink error that was not a real failure. The tree was clean and byte-identical to
`origin/main`, so the measurement is of the same code. **This is the one baseline number not
taken in the worktree, and it is stated rather than hidden.**

`node_modules` was verified intact after the worktree was removed.

No STOP condition: `tsc` and `build` were both 0, and every guard that should exit 0 did.

---

## Phase 1. The ruling, recorded and applied where it was only a label

### The first task: 6a

`docs/active-engagements-one-source.md` section 6a asked whether this had ever been ruled.
**The answer is no.** 6a now opens with the ruling as the PRIMARY RECORD, and states that none
existed before 2026-09-15. Of the two possibilities 6a set out, the second is what happened: a
recommendation was read as a ruling by the next session and hardened through repetition.

The three citing sites now carry **"Greg's ruling of 2026-09-15, Option B"**, matching the form
every other dated ruling comment in `app/` and `lib/` uses:

| Site | Line |
| --- | --- |
| `app/partner/payments/page.tsx` | 809 |
| `app/partner/projects/[projectId]/page.tsx` | 317 |
| `docs/m4-colleague-filter-report.md` | 259 |

**Nothing built on the un-made ruling was harmful.** Both surfaces `670de54` touched were
relabelled, not refiltered. The recommendation was right; Greg has now ruled the same substance
properly. Those three citations became true on 2026-09-15 rather than being withdrawn.

**A stale citation, corrected.** Both the brief and 6a say the recommendation is at "line 109"
of that document. At `HEAD` it is at **line 161**; the 52-line banner prepended by the previous
run shifted everything below it. Line 109 was correct when 6a was written. This is the same
defect the banner itself documents about the four surfaces, recurring inside the document that
documents it.

### The surfaces

| Surface | Changed? | Why |
| --- | --- | --- |
| `app/agency/project/page.tsx:578` `N engagements` | **No.** Not relabelled, not recounted | Already the ruled unit: one `(assignmentId, awardedResponseId)` pair. Option B made the existing word correct rather than requiring a change. A comment now records that |
| `app/agency/pool/page.tsx:1499` "Vendors with active engagements" | **No** | Counts distinct partnerships and its label says "Vendors". Under Option B a vendor with two scope items holds two engagements and still counts once here - not a contradiction, because the tile never claimed to count engagements. This is the naming discipline the rest of the phrase was measured against |
| `app/agency/dashboard/page.tsx` "Awarded (This Quarter)" | **YES - renamed** to **"Engagements Awarded (This Quarter)"** | It counts `project_assignments` with status `awarded` and `awarded_at` in the calendar quarter to date. That is exactly an engagement under Option B. The previous run deliberately left it unnamed pending this ruling |

**No arithmetic was performed in phase 1.** No expression, query or unit was touched. The
number rendered by the renamed tile is identical before and after.

### Found in phase 1, NOT fixed, because fixing it is arithmetic

`buildDemoDashboardData()` in `app/agency/dashboard/page.tsx` computes `awardedThisQuarter` as
`demoMasterProjects.filter(p => p.workflowStageKey === "active_engagements").length` - a count
of **PROJECTS, with no quarter window at all**. The live route counts **assignments awarded
since `quarterStartIso()`**. Under the new label the demo number is wrong twice over: wrong
unit and wrong window.

It was **not fixed**, because correcting it changes a number, and the brief confines phase 1 to
naming. It affects **demo mode only** (`isDemoMode()`); no real agency's tile is fed by it. It
is marked in place at both the tile and the demo line.

---

## Phase 2. The vendor label three sessions reported and did not fix

`app/partner/projects/page.tsx` read **"Your active project engagements and delivery
performance"** over `allProjects`, with an empty state reading **"No active projects"**.

**What the list actually contains.** `/api/partner/projects` filters `.eq("status", "awarded")`
on the assignment and on the response and **nothing else**. It selects `end_date` and computes
`is_active` per row, and **never filters on it**, by an explicit decision documented in that
route: filtering would make a vendor's overdue milestone on a finished project unreachable. A
project that ended eighteen months ago is in this list.

**The noun was never the problem.** Each row carries `scope_item_name` and is one awarded scope
commitment, which Option B makes an engagement. Only **"active"** was a claim the data does not
make.

**Fixed as copy only, relabelled and not filtered:**

- heading -> **"Your awarded engagements and delivery performance"**
- empty state -> **"No awarded engagements"**, body -> "You don't have any awarded scope items yet."

The heading and empty state now agree with each other and with the list.

**Filtering was NOT taken.** It would be arithmetic on a vendor-facing surface, which the brief
forbids, and it would contradict the shipped precedent: `670de54` and `113a829` both refused to
filter vendor surfaces and tagged instead. No query, no count and no row set changed.

**Still not done there, and additive rather than a correction:** finished groups are not tagged
on that page the way `app/partner/payments` tags them. A vendor can tell a finished row only
from its own status badge and dates.

**Observed, not changed:** the per-row badge at `app/partner/projects/page.tsx:538` colours
green only when `projects.status` is exactly `"active"`, so a row stored as `in_progress`
renders grey. It prints the stored value verbatim, so it makes no false claim; it is cosmetic
and was out of scope.

---

## Phase 3. The dead classifiers

### >>> THE BRIEF WAS WRONG ABOUT CANDIDATE (c), AND IT WAS THE DANGEROUS ONE <<<

The brief listed `app/api/agency/active-engagements/route.ts` among routes to delete, and
explained how to report deleting it. **That route is LIVE.**

`app/agency/project/page.tsx:664` fetches
`/api/agency/active-engagements?projectId=...` through `useFetch`, and its
`projects[].partners` **are** the `PartnerRow[]` behind that page's entire engagement list -
including the `N engagements` header that phase 1 had just confirmed as the ruled unit.
`LIGAMENT_CONTEXT.md:154` also lists it as a working-route reference.

**Deleting it would have broken the agency project page.** The route was kept. Only the dead
classifier inside it was removed. This is exactly the trap the brief's own warning described,
sprung by the brief's own candidate list.

The distinguishing fact that settles it, and it is not visible from a function-name grep: the
**live** classifier emits `stage` / `stageLabel` (camelCase, in `app/api/agency/dashboard/
route.ts`); the **dead** ones emitted `dashboard_workflow_*` (snake_case) and
`dashboardWorkflow*`. Different field names entirely.

### Candidate table

| # | Candidate | Verdict | Evidence |
| --- | --- | --- | --- |
| **a** | `app/api/projects/route.ts` `dashboard_workflow_stage` / `_label` and `dashboardWorkflowForProject()` | **DELETED** | `grep -rn "dashboard_workflow"` over the whole repo (excluding `node_modules`, `.git`, `.next`) returned only the two lines that WRITE them, their own comment, two docs, and one stale comment reference in `lib/demo-data.ts`. Both consumers of `/api/projects` were read directly: `contexts/selected-project-context.tsx` maps rows through `mapDbProjectToMaster`, which never names the fields; `app/agency/projects/[id]/page.tsx` spreads raw rows but casts to a local `Project` type that does not declare them. `lib/project-mapper.ts` does not reference them |
| **b** | `app/api/projects/route.ts` `total_active_engagements` (and its sibling `total_awarded_engagements`) | **DELETED** | They reach the client only inside `agency_dashboard_stats`. `grep -rn "agency_dashboard_stats"` repo-wide returned **only the single line that writes it**, never a read. Consumers read `data.projects`; this is a sibling key nothing touches |
| **c** | `app/api/agency/active-engagements/route.ts` third classifier | **CLASSIFIER DELETED. ROUTE KEPT - IT IS LIVE** | The ROUTE is fetched at `app/agency/project/page.tsx:664`. The two FIELDS are dead: `grep -rn "dashboardWorkflowStage\|dashboardWorkflowLabel"` returned the two writing lines, comments, and **one optional field on `ProjectEngagement`** at `app/agency/project/page.tsx:56` which **declared them and never read them**. That declaration was removed too |
| **d** | `app/api/partner/summary/route.ts` | **ROUTE DELETED** | `grep -rn "/api/partner/summary"` across `app/`, `components/`, `hooks/`, `contexts/`, `lib/` and `middleware.ts`, excluding the route's own file, returned **nothing**. Enumerating every `/api/partner/*` fetch string literal in the repo produced the route path only from the route's own `const ROUTE`. No dynamic or constructed fetch of it exists |

### 3b. The limit on what can be proved about routes, stated plainly

**A route is not dead because nothing imports it.** Nothing imports a route by design; it is
reachable by URL. For `/api/partner/summary`, the **absence of any fetch call in this
repository is the strongest evidence available and it is NOT proof.**

**If an external caller exists, it now gets a 404.** Its auth check, its vendor-role check and
its org-scoped reads went with it. **That is safe: a deleted route grants nothing.** No access
predicate was widened anywhere in this run.

The same caveat applies in principle to candidate (c) - which is precisely why (c) was checked
against page code rather than against an import graph, and why it was kept.

### What else went, as a consequence

Removing (a) orphaned code that existed only to feed it, all of it write-only afterwards:

- the Sets `projectIdsWithAwarded`, `inboxProjectIds`, `bidProjectIds`
- **two database round trips per agency GET** (`partner_rfp_inbox`, and a second pass over
  `partner_rfp_responses`)
- the helpers `inboxEmbedProjectId()` and `unwrapAssignmentRows()`, and the now-unused
  `projectActiveByEndDate` import

Removing (b) orphaned a `partner_rfp_responses` query that selected from the same table with
the same filters as the surviving spend query - one more redundant round trip, removed.

Removing (c)'s classifier orphaned `const st`, removed.

`app/api/agency/dashboard/route.ts` keeps the one surviving classifier. Its header now records
that it is the only one and says to **import** it rather than hand-copy it, which is what
produced the three-way disagreement.

### 3e. tsc and build after deleting

Both were run before the commit. `tsc` **failed at first**, exit 2:

```
.next/dev/types/validator.ts: Cannot find module '../../../app/api/partner/summary/route.js'
```

This is a **generated, gitignored artifact dated Aug 20**, left by an old dev-server run;
`.next` has zero tracked files. `pnpm build` regenerated the production validator and cleared
its half of the error, but does not regenerate `.next/dev`. That stale directory was removed
and `tsc` returned 0. **Nothing in source was changed to make this pass.**

### Not done, reported instead

The surviving `agency_dashboard_stats` object is **also read by nothing**. Its remaining three
fields (`total_unique_clients`, `total_client_budget`, `total_partner_spend_usd`) were left:
they carry no definition of "engagement" and were outside the named candidates. Removing them,
and the client/budget/spend work feeding them, is a clean follow-up.

---

## Phase 4. Gates, final

Every gate re-run unpiped, one command each, compared against phase 0.

| Gate | Baseline | Final | Match |
| --- | --- | --- | --- |
| `tsc --noEmit` | 0 | **0** | yes |
| `build` | 0 | **0** | yes |
| `lint` | 1, 182 problems (154 errors, 28 warnings) | **1, 182 problems (154 errors, 28 warnings)** | yes, full triple |
| `identity-columns:guard` | 0 | **0** | yes |
| `org-id-reads:guard` | 0, Class B 60 known-open | **0, Class B 60 known-open** | yes |
| `embed-targets` | 0 | **0** | yes |
| `policy-audit:guard` | 1 | **1** | yes |
| `verify-rls` | 2 | **2** | yes |

Nothing moved off baseline, so no commit was reverted.

---

## What I could not establish

1. **Whether any caller outside this repository fetches `/api/partner/summary`.** Not
   knowable from this tree. Deletion is the stated risk; a 404 is the consequence.
2. **Whether any external consumer read `dashboard_workflow_*`, `dashboardWorkflow*` or
   `agency_dashboard_stats`.** Same limit. These were response FIELDS on routes that still
   exist, so an external reader would now see the field missing rather than a 404.
3. **Anything about the database.** No SQL was run - read-only or otherwise - and no
   credentials exist in this session. No database fact in this report is observed. The
   settling queries are in the checklist below.
4. **How anything looks in a browser.** Nothing in this run was opened in one. Every claim
   here is from reading code, running gates, or `git`.
5. **Whether any agency is over the 500-row response ceiling** that the previous run found on
   `Open RFPs` and `committedPartnerSpend`. Untouched and still open.

---

## Merge order, and what to revert

The three commits are independent and each merges alone.

| Commit | Scope | Revert if |
| --- | --- | --- |
| `9ef7d8a` phase 1 | Doc amendment, three dated citations, one dashboard tile renamed | Greg's ruling is not Option B, or the tile should read something else. Reverting restores "Awarded (This Quarter)" and changes no number |
| `90f25cd` phase 2 | Vendor label and empty state, copy only | The vendor page should say something other than "awarded engagements". Reverting restores the false "active" wording. No number either way |
| `789d879` phase 3 | Deletions | **Revert this one first if anything is wrong**, and revert it whole. It is the only commit that removes behaviour. The single highest-risk element is the deletion of `/api/partner/summary`: if an external caller surfaces, `git revert 789d879` restores the route, its checks and its counts exactly |

Phase 3 does not depend on phases 1 or 2. Phases 1 and 2 do not depend on each other.

---

## Checklist

### VERIFIES THIS RUN - executed here, result observed

- [x] `git status --porcelain` clean at start; `HEAD == origin/main` - **executed**
- [x] Baseline in a throwaway worktree, tools invoked directly, each gate unpiped - **executed**
- [x] `node_modules` intact after worktree removal - **executed**
- [x] All eight gates re-run after each commit and at the end; **full lint triple** compared,
      not the exit code - **executed**
- [x] `tsc` 0 and `build` 0 after the deletions, before committing them - **executed**
- [x] Every phase-3 candidate proved unreferenced by name, route path and fetch-string search
      across `app/`, `lib/`, `components/`, `hooks/`, `contexts/`, `scripts/`, `middleware.ts`
      - **executed**
- [x] Candidate (c)'s route proved LIVE by reading the fetching page - **executed**
- [x] Both `/api/projects` consumers read directly, not inferred from a grep - **executed**
- [x] No em dash in any added line, checked over the whole diff - **executed**
- [x] Merge status verified with `git merge-base --is-ancestor`, not asserted - **executed**
- [x] No SQL run. No migration authored, edited or applied. No access predicate widened. Not
      pushed, not merged - **held**

### CARRIED OVER - NOT verified this run, and NOT verified by any run yet

**None of the following has been walked in a browser.** This set is unchanged in kind from the
previous run's report; this run added to it rather than clearing it.

- [ ] **The payments change** (`670de54`) - tagging of finished groups on `/partner/payments`
- [ ] **The pool labels** - "Vendors with active engagements" and the surrounding tiles
- [ ] **The three emitters and notification routing** - rulings 1, 2, 4, 5 of 2026-09-14
- [ ] **The renamed dashboard tile** from phase 1 - "Engagements Awarded (This Quarter)" has
      never been rendered. The label is a string change; the number beside it is untouched
- [ ] **The vendor label from phase 2** - never rendered
- [ ] **`/agency/project` after phase 3** - its feeding route was edited. `tsc` and `build`
      pass and only two unread fields were removed, but **the page has not been loaded**
- [ ] **The agency dashboard stage pill** - the surviving classifier is untouched, but nothing
      confirmed the pill still renders

### OPEN, AND OWED TO SOMEONE

- [ ] **Section 6c: WHERE liveness applies.** Option B settled the UNIT, not this. The agency
      group header at `app/agency/project/page.tsx:578` still applies no liveness filter and can
      disagree with the status filter directly below it
- [ ] **The demo `awardedThisQuarter` unit and window** (phase 1 finding). Arithmetic
- [ ] **Tagging finished groups on `/partner/projects`** (phase 2 finding). Additive
- [ ] **The rest of `agency_dashboard_stats`**, also unread (phase 3 finding)
- [ ] **`Open RFPs` ignores RFP closure, and its 500-row ceiling.** Both still open
- [ ] **Renaming the "Active Engagements" stage pill** to a project-grain word such as
      "Awarded". Option B makes the bucket name a different unit from the ruled word by
      definition. A product decision, deliberately not taken here

### DATABASE QUERIES OWED - none of these was run

```sql
-- 1. Does any agency exceed the 500-row partner_rfp_responses ceiling?
SELECT lead_org_id, COUNT(*) AS responses
FROM partner_rfp_responses
GROUP BY lead_org_id
HAVING COUNT(*) > 500
ORDER BY responses DESC;

-- 2. How many vendors would see a changed heading on /partner/projects, i.e. hold at
--    least one awarded assignment on a project already past its end_date?
SELECT COUNT(DISTINCT p.vendor_org_id) AS vendors_with_finished_awarded_work
FROM project_assignments a
JOIN partnerships p ON p.id = a.partnership_id
JOIN projects pr ON pr.id = a.project_id
WHERE a.status = 'awarded'
  AND pr.end_date IS NOT NULL
  AND pr.end_date < CURRENT_DATE;

-- 3. Does any assignment carry more than one awarded response? This is the difference
--    between the ruled unit and the deleted total_active_engagements count.
SELECT a.id, COUNT(r.id) AS awarded_responses
FROM project_assignments a
JOIN partner_rfp_responses r ON r.partnership_id = a.partnership_id
WHERE r.status = 'awarded'
GROUP BY a.id
HAVING COUNT(r.id) > 1;

-- 4. How many projects carry a status spelling the deleted third classifier would have
--    dropped to "setup"? Evidence for why projects.status cannot carry a liveness rule.
SELECT COALESCE(status, '<null>') AS status, COUNT(*)
FROM projects
GROUP BY status
ORDER BY 2 DESC;
```

---

## One sentence

Greg's ruling now exists with a date on it, the surfaces that only needed a name have one, the
vendor label that three sessions reported is fixed, four dead definitions of the ruled word are
gone, the live route the brief told this run to delete is still there, and no number moved.
