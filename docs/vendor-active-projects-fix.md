# Surface #2: the vendor "Active Engagements" tile

Fixes surface **#2** of `docs/active-engagements-one-source.md`. Surfaces #1, #3
and #4 are untouched except that #1 and #4 now import the liveness rule instead
of each holding a private copy of it. **No number on #1, #3 or #4 moves.**

---

## What a vendor sees change

**A number on a vendor-facing tile goes down, and the tile is renamed, in the
same deploy.**

| | Before | After |
|---|---|---|
| Label | `Active Engagements` | `Active Projects` |
| Counts | every project the vendor was ever awarded | only projects still live by `end_date` |

Any vendor with a finished project sees a smaller number under a different
name. A vendor whose awarded projects have **all** finished sees `0` where they
previously saw a positive count. That is the tile becoming true, not a
regression, but it is a visible drop with no in-product explanation, so it
should not go out silently.

The "Active projects" list directly below the tile is filtered by the same
derived array. It was already titled *Active projects* and already said *No
active projects yet* while listing finished ones; it now means what it says.
Leaving it unfiltered would have shipped a fresh contradiction - tile reading
`2` with five cards beneath it.

**Not changed:** `showEmptyState` still tests the full awarded set, so a vendor
whose only projects have finished keeps their dashboard instead of being sent
back to the "Welcome to Ligament" screen. The vendor's complete project history
remains at `/partner/projects`, one click away via *View All*.

---

## Where the filter went, and why not in the route

The brief called for filtering inside `/api/partner/projects`. That would have
been wrong, and the brief's own reasoning is what surfaced it: the route has
**two other consumers**, and both are entitled to the finished rows.

- `app/partner/payments/page.tsx:319` renders payment milestones **only** inside
  project groups built from this route (`milestonesForEngagement`). Dropping
  finished projects would have made a vendor's unpaid or overdue milestone on a
  project that ended last month **unreachable on their payments screen** - a
  worse defect than the one being fixed.
- `app/partner/projects/page.tsx:660` is the vendor's entire project list, and
  keys `delivery_reviews` off it. Those are filtered `status = 'complete'`, so
  reviews of finished work would have lost the rows they hang on.

Greg's ruling: *"which projects does this vendor have" is one question with one
answer, and all three consumers want the full set. "Which of those are live" is
a different question that only the tile asks.* The filter-in-the-route rule is
about **scoping** - a route returning rows a caller must never see. This is not
that: every consumer is entitled to every row, they differ in what they count.

So the route **tags** and the tile **filters**:

```ts
// app/api/partner/projects/route.ts - payload gains one field, drops no row
is_active: projectActiveByEndDate(proj?.end_date ?? null)
```

```tsx
// app/partner/page.tsx - the only consumer that counts live work
const liveProjects = useMemo(
  () => fetchedActiveProjects.filter((p) => p.isActive),
  [fetchedActiveProjects]
)
```

The route diff is **+12 / -0**: purely additive, so no existing consumer's row
set or field set changes.

An opt-in `?active=1` parameter was rejected: it makes the default the wrong
answer and requires every caller to remember to ask - the same shape as
`lib/fetcher.ts` having no `res.ok` check, where the safe behaviour existed and
nobody opted in.

The client maps a missing `is_active` to **live** (`p.is_active !== false`), so
a deploy skew serving an older payload cannot silently zero a vendor's tile.

---

## The shared helper

**`lib/project-liveness.ts`** - `projectActiveByEndDate(endDate)`. Live while
`end_date` is null, blank, unparseable, or on/after today in UTC.

There were **three** copies of this rule, not the two the brief named:

| Call site | Before | After |
|---|---|---|
| `app/api/agency/utilization/route.ts:339` | local copy at `:33` | imports the helper |
| `app/api/projects/route.ts:374` | local copy at `:42` | imports the helper |
| `app/api/partner/projects/route.ts` | **no rule at all** - selected `end_date`, filtered on neither it nor `status` | imports the helper |

The two pre-existing copies were byte-identical in logic, differing only in a
doc comment and `'` versus `"`. That is the state a rule is in one rename before
it silently diverges - the shape of this week's entitlements guard, where a
fallback still existed and only its spelling changed, so the guard stopped
seeing it.

Deliberately **not** built on `projects.status`: that column carries an
eleven-entry `STATUS_LEGACY_MAP` folding ten spellings onto five canonical
values (`app/agency/projects/[id]/page.tsx:28-39`), so a liveness rule on it
would be a second normalization table that has to stay in step with the first.

### Extraction diff - all three, line for line

Diffed against `git HEAD`. The only textual differences are the added `export`
keyword and quote style; **lines 2-9 are byte-identical in all three**:

```
lifted vs utilization original     -> only: +export
lifted vs app/api/projects original -> only: +export, and '' vs ""
utilization vs projects (originals) -> identical; the two already agreed
```

Normalising the `export` keyword and quote style away, all three are
**9/9 lines identical, zero logic difference**.

Executed as well as read. The real `lib/project-liveness.ts` source was loaded
off disk, type annotations stripped, and run against both originals over 24
inputs - `null`, `undefined`, empty and whitespace strings, unparseable values,
±540 days, UTC midnight and 23:59 boundaries either side of today, leap day,
epoch, and `9999-12-31`:

```
ALL THREE AGREE ON EVERY INPUT - zero behavioural drift
```

**`total_active_engagements` (`app/api/projects/route.ts:374`) is unchanged.**
Identical function, identical argument, identical result on every boundary
input. Same for `partners_with_active_engagements`
(`app/api/agency/utilization/route.ts:339`). Neither route's diff touches
anything but the import line and the deleted definition.

---

## Contradicting copy

Swept `app/`, `components/`, `lib/` for "active engagement". The dashboard file
had exactly **one** occurrence - the tile label itself, now changed. No
subtitle, tooltip, `aria-label` or `title` attribute near the tile.

Three vendor-facing surfaces still say "engagement" and were **left alone** as
out of scope. None sits next to the tile, so none visibly contradicts it, but
each carries the same unfiltered defect and is worth its own session:

| File | Copy | Note |
|---|---|---|
| `app/partner/payments/page.tsx:660` | `Active engagements` | lists **all** awarded work including finished - same defect, different surface |
| `app/partner/projects/[projectId]/page.tsx:315` | `Active engagements` | per-project heading |
| `app/page.tsx:93` | "Track your active engagements" | public marketing copy, not a count |

Note `app/api/agency/dashboard/route.ts:50` and `lib/demo-data.ts:465` also
carry the string `Active Engagements`, but as the **workflow stage label**
(surface #1), which is a bucket name and not a count. Untouched, per the brief.

---

## Who is affected - QUERY NOT RUN

**This was not executed.** No number below has been observed. It needs a
database Greg can reach; Markant's own vendor side has never received an RFP and
holds no awarded assignments, so **this fix is unverifiable on Greg's own
account** - it most likely reads `0` before and `0` after there.

The eight projects seen in an earlier session (1 null `end_date`, 5 live, 2
past) are **Markant's projects as a lead agency**. They are not what this tile
reads. Do not reason about impact from them.

It is entirely possible **no vendor is affected today**, in which case this fix
is correct and invisible - still worth shipping, because the tile stops being
able to lie the moment a project ends.

Run this to find out. It mirrors the route's union of both award paths
(assignment rows and awarded responses via the inbox) and the same
`end_date` liveness rule, grouped by vendor organisation:

```sql
-- Vendor "Active Projects" tile: value before vs after this fix.
-- Read-only. Mirrors /api/partner/projects: distinct project ids reachable by
-- BOTH award paths, split by the projectActiveByEndDate rule.
with awarded_projects as (
  -- path 1: an awarded project_assignments row
  select pship.vendor_org_id, pa.project_id
  from project_assignments pa
  join partnerships pship on pship.id = pa.partnership_id
  where pa.status = 'awarded'
    and pship.vendor_org_id is not null

  union   -- deliberately UNION, not UNION ALL: distinct (vendor, project)

  -- path 2: an awarded partner_rfp_responses row, via the inbox item
  select r.vendor_org_id, i.project_id
  from partner_rfp_responses r
  join partner_rfp_inbox i on i.id = r.inbox_item_id
  join partnerships pship  on pship.id = i.partnership_id
  where r.status = 'awarded'
    and r.vendor_org_id is not null
    and i.project_id is not null
)
select
  o.name                                              as vendor,
  count(*)                                            as tile_before,
  count(*) filter (
    where p.end_date is null
       or p.end_date >= (now() at time zone 'utc')::date
  )                                                   as tile_after,
  count(*) filter (
    where p.end_date is not null
      and p.end_date <  (now() at time zone 'utc')::date
  )                                                   as drop
from awarded_projects ap
join projects p       on p.id  = ap.project_id
join organizations o  on o.id  = ap.vendor_org_id
group by o.name
having count(*) filter (
  where p.end_date is not null
    and p.end_date < (now() at time zone 'utc')::date
) > 0
order by drop desc, vendor;
```

Every row returned is a vendor who will watch a number fall. Zero rows means
nobody is affected today. `drop` is exactly how far each vendor's tile falls.

Caveat on fidelity: the SQL casts `end_date` to a date, while the TypeScript
helper treats an **unparseable** `end_date` as live. If `projects.end_date` is a
`date`/`timestamp` column the two agree exactly; if it is `text` holding
free-form values, the SQL may count as finished a row the app counts as live.
Check the column type before trusting `tile_after` to the unit.

---

## Gates

Baseline taken on `7a8d889` **before** any edit, compared after.

| Gate | Baseline | After | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit 0 | none |
| `pnpm build` | exit 0, 173 routes | exit 0, 173 routes | none |
| `pnpm lint` | 182 problems (154 errors, 28 warnings) | 182 problems (154 errors, 28 warnings) | none |
| `identity-columns:guard` | PASSED, 0 in 0 files | PASSED, 0 in 0 files | none |
| `org-id-reads:guard` | PASSED, class B 60 known-open | PASSED, class B 60 known-open | none |
| `embed-targets` | 0 in 0 files | 0 in 0 files | none |

`pnpm lint` exits 1 at **both** baseline and after - a pre-existing failing
gate, not caused by this change. The full output was diffed line by line: every
difference is a **line-number shift inside `app/partner/page.tsx`** caused by
added lines. Same rules, same sites, no violation added or removed.

`verify-rls` and `policy-audit:guard` were not run, per the brief - neither
reads a `.ts` file.

No migration was written, run, or touched. Nothing was pushed.
