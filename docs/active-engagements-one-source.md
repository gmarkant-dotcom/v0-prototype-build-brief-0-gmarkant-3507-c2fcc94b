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
