> # STALE SINCE 102 MINUTES AFTER IT WAS WRITTEN. RE-VERIFIED 2026-09-15; ALL FOUR ROWS MOVED.
>
> Added by the `feat/engagements-one-source` run. Every line below the banner is the diagnosis
> exactly as written on 2026-08-27. **Do not act on its table without reading this first.** The
> ruling this document was written to frame is in the new section 6 at the foot.
>
> `docs/active-engagements-one-source.md` was committed in `c730d7a` at **15:51 on 2026-08-27**.
> `113a829`, which fixes its surface 2 and does the `lib/` lift it calls a blocker, landed at
> **17:33 the same day** - one hour and forty-two minutes later. Every session since has read
> this document as current. It has been wrong about half its own content for two and a half
> weeks.
>
> ## A. THE FOUR SURFACES, RE-VERIFIED AGAINST THE CODE AT `HEAD`
>
> | # | Document says | Truth at `HEAD` |
> | --- | --- | --- |
> | 1 | `app/api/projects/route.ts:105`, a stage label | Line **:125** at `HEAD`, not :105 (it was :95 before this run's own comment block shifted it). Still a stage label, still not a count. **But it is DEAD OUTPUT**: it is emitted as `dashboard_workflow_stage` / `dashboard_workflow_label` at `:322-323` and `grep -rn 'dashboard_workflow_'` over the whole tree finds no reader. The document calls this surface "where the phrase enters the vocabulary". Nothing a customer sees comes from it |
> | 2 | `app/partner/page.tsx:707`, "Active Engagements" tile, distinct projects, no liveness filter | **FIXED, in `113a829` on 2026-08-27.** The tile reads **"Active Projects"** at `app/partner/page.tsx:882` and counts `liveProjects.length` at `:880`, which is `fetchedActiveProjects.filter(p => p.isActive)`. Both halves of the document's prescription shipped: relabelled AND liveness-filtered. The phrase no longer appears in that file |
> | 3 | `app/agency/project/page.tsx:578`, `N engagements`, (assignment x awarded bid) | **CONFIRMED, unchanged, same line.** Still the finest grain, still no liveness filter |
> | 4 | `app/api/agency/utilization/route.ts:352`, tile at `app/agency/pool/page.tsx:1359` | Lines **:342** and **:1499**. Unit and liveness rule unchanged. Still correctly labelled "Vendors with active engagements". The document's "change nothing" verdict still holds |
>
> **The document's own stated blocker is also gone.** It says `projectActiveByEndDate`
> "currently lives inside a route file rather than in `lib/`". It lives in
> **`lib/project-liveness.ts`** and all three callers import it. `113a829` found three copies
> where the document expected two and verified them identical over 24 boundary inputs.
>
> ## B. THERE ARE NOT FOUR SURFACES. THERE ARE ELEVEN, AND SEVEN ARE NOT IN THIS DOCUMENT
>
> Established by `grep -rn "Active Engagements\|active engagements\|active_engagements"` over
> `app/`, `lib/` and `components/`, then reading every hit.
>
> | Surface | Unit | State |
> | --- | --- | --- |
> | `app/api/agency/dashboard/route.ts:63,74` `workflowStageForProject()` | a project | **LIVE AND CUSTOMER-VISIBLE.** Renders the stage pill at `app/agency/dashboard/page.tsx:698`. A second hand-copied classifier the document never mentions - and it, not surface 1, is the one a customer actually reads |
> | `app/api/agency/active-engagements/route.ts:550-561` | a project | **A THIRD CLASSIFIER, WITH DIFFERENT RULES.** Keys on `projects.status` text instead of awarded/bid/inbox membership, and maps `on_hold` to `active_engagements`. Dead: no reader for `dashboardWorkflowStage` / `dashboardWorkflowLabel` |
> | `app/api/projects/route.ts:392-441` `total_active_engagements` | awarded RESPONSE rows on live projects | **A FIFTH UNIT, AND A REAL COUNT** - the thing the document says surface 1 is not. Liveness-filtered. Dead: `agency_dashboard_stats` has no reader |
> | `app/api/partner/summary/route.ts:100` `active_engagements` | awarded `project_assignments` rows, **no liveness at all** | **A SIXTH UNIT.** The whole route is unfetched anywhere in the repo |
> | `app/partner/payments/page.tsx:806` | awarded scope commitment | **FIXED in `670de54`**, 2026-08-28. Now "Awarded engagements", finished groups tagged |
> | `app/partner/projects/[projectId]/page.tsx:316` | awarded scope commitment | **FIXED in `670de54`.** Now "Awarded engagements" |
> | `app/partner/projects/page.tsx:738` | the full awarded set, no liveness | **STILL WRONG, AND KNOWN.** "Your active project engagements", with an empty state reading "No active projects", over an unfiltered list. `670de54`'s own commit message reports it as the third instance it did not fix. This run did not fix it either - see section 6c |
>
> **A caution about "dead".** Four of these emit a number or a label that no screen in this
> repository reads. That is established by grep over this tree and nothing else: it does not
> prove no external client consumes them. What it does mean is that **wiring any of them up is
> not a small change** - each would put a different definition of the same phrase on a screen.
>
> ## C. NO NUMBER WAS CHANGED BY THIS RUN
>
> Only comments were added, at six sites, each naming its own unit and cross-referencing the
> others. `npx tsc --noEmit` and `pnpm build` were re-run and are unchanged. The ruling in
> section 6 is unanswered, by design.

# "Active Engagements" is four numbers wearing one name

**Status: REPORT ONLY. Nothing in this document was changed.** Four surfaces
changing their numbers at once is its own session, and three of the four are
customer-visible tiles.

This is a **one-source-per-number** violation and it is **independent of M3**.
It was found while tracing what a project-level tag would need to join against;
it is not caused by 097, 098, or anything on `feat/m3-tags`.

---

## The four surfaces

| # | Surface | Renders | Unit it actually counts |
|---|---|---|---|
| 1 | `app/api/projects/route.ts:105` | the string `Active Engagements` as a workflow **stage** | **a project** — and it is not a count at all |
| 2 | `app/partner/page.tsx:707` | `Active Engagements` tile, vendor dashboard | **a distinct project**, no recency filter |
| 3 | `app/agency/project/page.tsx:566` | `N engagements` in a group header | **an assignment × awarded bid row** |
| 4 | `app/api/agency/utilization/route.ts:352` | `Vendors with active engagements` (`app/agency/pool/page.tsx:1359`) | **a distinct partnership**, filtered by end date |

### 1. `app/api/projects/route.ts:105` — a per-project stage label

```ts
if (hasAwarded) return { key: 'active_engagements', label: 'Active Engagements' }
```

`dashboardWorkflowForProject()` classifies **one project** into one of four
workflow stages. **It never counts anything.** The phrase is a bucket name: a
project with one awarded bid and a project with nine both return this same
label, and the function returns before it looks at how many.

It is in this list because it is where the phrase enters the vocabulary, and
because any dashboard that groups by `key` produces a number labelled "Active
Engagements" whose unit is *projects* — silently disagreeing with #3 on the same
portal.

**What it claims vs. does:** claims nothing numeric, and is the only one of the
four that is not wrong. Its risk is that it *looks* like it defines the term.

### 2. `app/partner/page.tsx:707` — distinct projects, vendor side

```tsx
{activeProjectsLoading ? "-" : fetchedActiveProjects.length}
… Active Engagements
```

`fetchedActiveProjects` comes from `/api/partner/projects`, deduplicated by
project id (`seenProjectIds`, `app/partner/page.tsx:283-286`). So the unit is
**one project the vendor holds at least one awarded assignment on**, counted
once no matter how many scope items they won on it.

**Two things it claims but does not do.**

- **It is not filtered to "active" in any sense.** The route filters
  `.eq("status", "awarded")` on the assignment and the response
  (`app/api/partner/projects/route.ts:128,157`) and nothing else. It selects
  `end_date` and `status` (`:188`) and **never filters on either**. A project
  that ended eighteen months ago still counts. The tile says *Active* and means
  *ever awarded*.
- **It counts projects, not engagements.** A vendor holding three awarded scope
  items on one project reads `1` here and `3` on the agency's own screen for the
  same work.

### 3. `app/agency/project/page.tsx:566` — assignment × awarded bid, agency side

```tsx
<span>{rows.length} engagement{rows.length !== 1 ? "s" : ""}</span>
```

`rows` is `PartnerRow[]` (`:33-51`), keyed by `assignmentId` and carrying
`awardedResponseId`, `partnershipId`, `scopeItemName`, `current_status`,
`completion_pct` and `alert_count`. So the unit is **one awarded scope
commitment**: one row per (assignment, awarded response).

One project with three awarded vendors reads `3`. The **same** vendor awarded two
scope items on one project reads `2`. That is the finest grain of the four.

**What it claims vs. does:** this one is close to honest — these rows *are*
engagements in the operational sense. Its problem is that it is the only surface
using that grain, so the word means something here it means nowhere else. It
also applies **no liveness filter at all**: a completed assignment still counts
in the header, even though the same component has a status filter directly below
it that can hide it from the list.

### 4. `app/api/agency/utilization/route.ts:352` — distinct partnerships

```ts
const activeEngagedPartnershipIds = new Set<string>()   // :342
…
const partners_with_active_engagements = activeEngagedPartnershipIds.size
```

The unit is **one partnership** with at least one awarded response on a project
that has not passed its end date (`projectActiveByEndDate`, `:33-41`).

A partnership with five awarded scope items across three live projects reads `1`.

**>>> This one is not mislabelled, and that matters for the fix.** The variable
says `partners_with_active_engagements` and the tile says **"Vendors with active
engagements"** (`app/agency/pool/page.tsx:1359`). Both accurately describe a
count of *vendors*, not of engagements. It is also the **only** surface of the
four that applies any liveness rule.

---

## What Greg should standardise on

**Standardise the unit on #3 — one engagement is one awarded scope commitment
(a `project_assignments` row with an awarded bid) — and take #4's liveness
rule.**

Three reasons, in order of weight.

**1. It is the only unit with its own lifecycle, so it is the only one the word
can mean.** An engagement has a status, a completion percentage and alerts.
Those live on the `PartnerRow` and they cannot exist at project grain or at
partnership grain: "the completion percentage of a partnership" is not a
quantity. The noun already belongs to that row.

**2. Every other number on this page rolls up from it, and none of them rolls
down.** From the assignment × awarded-bid grain you derive #2 as
`COUNT(DISTINCT project_id)` and #4 as `COUNT(DISTINCT partnership_id)`. From
either of those you cannot recover the engagement count. One-source-per-number
means holding the finest grain once and deriving the rest, so the finest grain
is the one to keep.

**3. It is the grain the agency already manages by.** `/agency/project` opens,
filters, reviews and alerts on exactly these rows. A dashboard number that
counts something the operational screen does not is a number nobody can
reconcile.

### The liveness rule: adopt `projectActiveByEndDate`, do not invent a second

Only #4 filters for liveness today. Adopt its rule everywhere — a project is
live while `end_date` is null, unparseable, or on/after today (UTC).

**Do not reach for `projects.status` instead.** That column cannot carry this
weight: `app/agency/projects/[id]/page.tsx:28-39` holds an
eleven-entry `STATUS_LEGACY_MAP` folding `in_progress`, `in progress`, `open`,
`bidding`, `paused`, `on hold`, `cancelled`, `planning`, `complete` and
`finished` onto five canonical values, and `normalizeStatus()` exists because
the stored values are genuinely inconsistent. A liveness rule built on it would
be a second normalization table that has to stay in step with the first. The
date is one field with one meaning.

### What each surface becomes

| # | Change |
|---|---|
| 1 | **Leave the logic.** It is a stage label, not a count. Consider renaming the label to `Awarded` so it stops looking like the definition of the term. |
| 2 | **Relabel to "Active Projects"** *and* apply the liveness filter. It counts projects; saying so is honest and it is the number a vendor wants. The missing end-date filter is a real defect independent of naming. |
| 3 | **Keep the unit, apply the liveness filter**, and let this be the definition of "engagement". |
| 4 | **Change nothing.** Its label already says "Vendors", which is what it counts. Copy its naming discipline to #2. |

Note that #2 and #4 are **both** wrong in the same overlooked way and in
opposite directions: #2 says "Active" and applies no liveness test, while #4
applies one and does not claim the word "engagement". Fixing the label on #2
without adding the filter would leave it as wrong as before, just more
confidently.

---

## Why this is not fixed here

Four surfaces changing their numbers at once is its own session, and three are
customer-visible tiles on two different portals. Specifically:

- Every one of these numbers is currently on somebody's screen. Changing #2 both
  relabels a vendor-facing tile **and** lowers its value for every vendor with a
  finished project, in the same deploy.
- #3's fix changes a number an agency reads next to a list whose contents do not
  change with it, which needs the list's own status filter reconciled at the
  same time.
- The liveness rule needs one definition agreed before four callers adopt it,
  and `projectActiveByEndDate` currently lives inside a route file rather than
  in `lib/`.

**None of it is blocked. It is sequenced.** It has no dependency on 097 or 098
and can be done before or after them.

---

# 6. THE RULING GREG OWES. Added 2026-09-15 by `feat/engagements-one-source`

Written in the shape `docs/emitter-rulings-owed.md` uses: the question, the options, and for
each option what a producer sees. **No option is chosen here.**

## 6a. FIRST, THE THING THAT MAKES THIS AWKWARD: IT MAY ALREADY BE RULED

**Two code comments and one report say the ruling exists and name it.**

- `app/partner/payments/page.tsx:809` - "one row per awarded scope commitment, **which is
  Greg's ruling**"
- `app/partner/projects/[projectId]/page.tsx:317` - "every row below is one awarded scope
  commitment, **which is Greg's ruling**"
- `docs/m4-colleague-filter-report.md:259` - "an awarded scope commitment, **exactly Greg's
  ruling**"

That is **Option B below**, and `670de54` (2026-08-28) shipped two vendor surfaces on the
strength of it.

**I CANNOT FIND A PRIMARY RECORD OF IT BEING MADE, AND THE CHAIN IS UNCOMFORTABLE.** The
phrase "one engagement is one awarded scope commitment" appears in exactly one place before
those three: **line 109 of this document**, under the heading *"What Greg should standardise
on"*. That is a RECOMMENDATION, written by an assistant session on 2026-08-27 at 15:51. By
2026-08-28 it is being cited as "Greg's ruling" in code that shipped.

**Established with `git log -S"which is Greg's ruling"`, which returns `670de54` and nothing
earlier.** Two possibilities and this repository cannot separate them:

1. **Greg ruled in a session brief.** Briefs are not committed here, so the record would be
   outside the repository. This is entirely plausible - most rulings on this project arrive
   that way, and `app/api/partner/payments/route.ts` carries a dated one in the same form.
2. **A recommendation was read as a ruling by the next session and hardened through
   repetition.** Every other dated "Greg's ruling" comment in `app/` and `lib/` carries a date
   or an option letter. **These three carry neither.**

**THIS IS THE FIRST THING TO ANSWER,** because if it is (1) then 6b is already decided and the
work is to finish applying it; if it is (2) then two vendor-facing surfaces were relabelled
against a decision nobody made. **Either way nothing built on it is harmful** - both surfaces
`670de54` touched were relabelled, not refiltered, and nothing stopped being visible.

## 6b. THE QUESTION

> **What is one "engagement"?** Every surface below either counts them or labels a list of
> them, and today they do not agree.

**HOW `/agency/project` ACTUALLY GROUPS, because it changes two of the three options.** The
page is scoped to ONE selected project (`projectId`), and `groupBy` defaults to **`"client"`**
(`app/agency/project/page.tsx:638`). For a single project that yields **one group**, labelled
with the client name, holding every row - so the default view's `N engagements` is the whole
project's count. Toggled to `"partner"` it groups by vendor name and each header counts that
vendor's rows. `PartnerRow` carries `assignmentId`, `awardedResponseId` and `partnershipId`
(`app/agency/project/page.tsx:33-51`) and **no project id**, because it does not need one.

The live surfaces the answer governs, with what each reads for the same work - **one project,
two vendors, one of whom won two scope items, project still running**:

| Surface | Today's unit | Reads |
| --- | --- | --- |
| `app/agency/project/page.tsx:578`, grouped by client (the default) | (assignment x awarded response) | **3** |
| `app/agency/project/page.tsx:578`, grouped by partner | same | **2** and **1** |
| `app/agency/pool/page.tsx:1499` "Vendors with active engagements" | distinct partnership, liveness-filtered | **2** |
| `app/agency/dashboard/page.tsx:698` stage pill "Active Engagements" | a project, bucket name | one pill on one project card |
| `app/partner/projects/page.tsx:738` "Your active project engagements" | the vendor's full awarded set, no liveness | a label over a list, not a count |

### Option A - an engagement is a PROJECT a vendor is working on

- **The producer sees:** the group header reads **1** in the default client grouping, and
  **1** for every vendor in the partner grouping.
- **What changes:** `app/agency/project/page.tsx:578` **recounts** - but there is nothing
  sensible to recount to. The page is already scoped to one project, so a project-grain count
  on it is **always 1**, in both groupings.
- **THIS IS THE OPTION'S REAL COST AND IT IS DISQUALIFYING ON THIS SURFACE.** Under Option A
  the only live count using the word stops carrying information and the header would have to
  be deleted rather than recounted. The word would survive only as the dashboard stage pill,
  where its unit already is a project.
- **What renames:** nothing. `app/agency/pool/page.tsx:1499` already says "Vendors" and the
  stage pill becomes literally correct at last.
- **What it also costs:** the word stops naming anything with a lifecycle. An engagement would
  have no status, no completion percentage and no alerts, because those live on the assignment
  row that Option A stops counting.

### Option B - an engagement is an ASSIGNMENT (one awarded scope commitment)

**This is what this document recommended on 2026-08-27, and what 6a says may already be ruled.**

- **The producer sees:** **3** in the default grouping, **2** and **1** by partner - unchanged
  from today. The vendor holding two scope items holds **two** engagements, and the agency's
  screen and that vendor's own screens finally report the same work with the same number.
- **What changes:** **no live count changes anywhere.** `app/agency/project/page.tsx:578` is
  already this unit, and `app/partner/payments` and `app/partner/projects/[projectId]` were
  relabelled to it in `670de54`.
- **What renames, and this is the whole cost:** the two agency stage-label sites and
  `app/partner/projects/page.tsx:738`. "Active Engagements" as a PROJECT-stage bucket becomes
  wrong by definition and wants a project-grain word - the body of this document suggests
  **"Awarded"**. The stage pill at `app/agency/dashboard/page.tsx:698` is the one a lead agency
  reads every day.
- **The argument for it, from the body above:** it is the only unit with its own lifecycle;
  every other number rolls up from it and none rolls down; and it is the grain the agency
  already manages by on `/agency/project`.

### Option C - an engagement is a PARTNERSHIP that currently has live work

- **The producer sees:** **2** in the default grouping - one per vendor - and **1** for every
  vendor in the partner grouping, where today the two-scope-item vendor reads 2.
- **What changes:** `app/agency/project/page.tsx:578` **recounts** to
  `new Set(rows.map(r => r.partnershipId)).size`. `partnershipId` is already on the row, so
  this one is mechanically trivial - which is exactly why it should not be chosen on that
  basis.
- **What renames:** `app/agency/pool/page.tsx:1499` could drop the word "Vendors" and simply
  say "Active engagements", since under this option they are the same thing. It is the only
  option under which that tile's careful label becomes redundant rather than load-bearing.
- **What it costs:** the same lifecycle objection as Option A - "the completion percentage of a
  partnership" is not a quantity - plus the finest grain becomes unrecoverable. From a
  partnership count you cannot get back to scope items, and the status chips directly below
  the header (`app/agency/project/page.tsx:592-598`) count scope items, so the header would
  disagree with its own filter row.

### 6c. THE LIVENESS RULE IS A SECOND QUESTION, AND IT IS SMALLER THAN IT WAS

`lib/project-liveness.ts` now exists and is the single definition - a project is live while
`end_date` is null, unparseable, or on or after today (UTC). **The document's stated blocker
here is gone.** Three surfaces already import it.

**What is still owed is only WHERE to apply it**, and there is a precedent that says "tag, do
not filter". `670de54` and `113a829` both refused to filter vendor surfaces and tagged instead,
for a stated reason: **payment milestones render only inside project groups, so dropping
finished projects makes a vendor's overdue milestone unreachable.** That reason does not apply
to the agency's own group header, which carries no such payload - so the two sides may not get
the same answer, and the precedent does not decide it.

**One live instance is unfixed and known.** `app/partner/projects/page.tsx:738` reads *"Your
active project engagements and delivery performance"* over `allProjects`, the full awarded set
with no liveness test, and its empty state at `:767` reads *"No active projects"*.
`670de54`'s commit message reports it as the third instance it did not fix; **this run did not
fix it either**, because it is a vendor-facing copy change on a page outside this run's stated
scope and the memory rule on this project is to surface a scope question rather than pick a
reading. **It is a copy fix with a shipped precedent** - the two sibling surfaces became
"Awarded engagements" - and it needs no ruling, no query change and no arithmetic.

### 6d. ANSWER NONE OF THIS BY GUESSING WHICH IS CHEAPEST

Option B changes no number and is therefore the cheapest to ship and the most tempting. It is
also the option this document already advocated, which is exactly the route by which 6a's
second possibility would have happened. **Cheapness is not evidence.**
