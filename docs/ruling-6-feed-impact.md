# What the agency feed does when ruling 6's rows start arriving

Written for migration 100, `feat/emitter-rulings`, 2026-09-15. Everything here is read
from source. **Nothing in this document was measured against a database** - there are no
working credentials in this environment and no SQL was run, read-only or otherwise. The
counts that would settle the open question at the foot are listed as checklist items in
`docs/emitter-rulings-report.md`, not asserted here.

---

## 1. The brief's premise for this section is wrong, and the correction changes the answer

The brief says:

> `rfp.view` in particular fires on page load, so a vendor opening an RFP repeatedly
> writes repeatedly.

**It does not.** `app/api/partner/rfps/[id]/route.ts` stamps `viewed_at` with

```
.update({ viewed_at: ... }).eq("id", id).in("vendor_org_id", callerOrgIds).is("viewed_at", null)
```

and the emit sits inside `if (updatedInbox)`. The `.is("viewed_at", null)` predicate
matches exactly once per inbox row, so `updatedInbox` is truthy only on the run that
actually stamped it. The route's own comment says so: "THE FIRST VIEW, AND ONLY THE
FIRST". A vendor reloading the page emits nothing.

So the flood scenario the brief asks about is not the one that exists. **There is still a
flood scenario. It is `bid.revise`, and it is worse**, for the reasons in section 3.

---

## 2. Per-type write frequency, read from each route

| Type | Fires | Bound | Ungroupable repeats? |
|---|---|---|---|
| `rfp.view` | first view of an inbox row | **once per inbox row, ever** | no |
| `nda.acknowledge` | NDA notify, rate-limited | **once per 24h per inbox row** (429 otherwise, `nda-notify/route.ts:62-70`) | at most 1/day |
| `bid.submit` | version 1 only (`nextVersion === 1`) | **once per response** | no |
| `bid.revise` | every later submitted version | **UNBOUNDED within the bidding window** | **yes** |

`status_update.post` is absent because it cannot reach this gate at all - see the
correction recorded in `docs/emitter-rulings-owed.md` ruling 6.

---

## 3. What the grouping does, and what it cannot do

`groupMilestoneRows()` keys a group on

```
event_type | actor_id ?? actor_email ?? "guest" | subject_type | subject_id ?? "-" | created_at
```

with `created_at` compared **exactly, as a string**. That exactness is correct and
deliberate: `recordMilestones()` issues one `.insert()` per batch, one statement is one
transaction is one `now()`, so the 60 rows of an RFP broadcast are byte-identical in that
column and collapse into one line.

**It also means separate HTTP requests never group.** Two page loads, two bid revisions,
two NDA notifications a day apart are two transactions with two `created_at` values, and
the group key discriminates on the whole string. So:

- **Repeat views cannot arrive**, per section 2, so there is nothing to collapse.
- **Repeat revisions cannot be collapsed.** Each `bid.revise` is its own line.

One thing does absorb a duplicate, and only one: `UNION_REPLACING_EVENT_TYPES` gives
`rfp.view` the dedupe key `rfp_inbox:<id>` and `bid.submit` the key `bid:<id>`, so each
merges with the derived union line it replaces rather than doubling it. **`bid.revise` is
not on that list**, and `nda.acknowledge` is not either.

---

## 4. Can one vendor push everything else off the feed? Yes, and here is the shape

`app/api/agency/dashboard/route.ts`: `ACTIVITY_FETCH_LIMIT = 200` per source,
`RECENT_ACTIVITY_LIMIT = 15` lines returned, the cap applied last, strictly after
grouping.

**Fifteen lines is the whole feed.** A vendor who revises a bid eleven times in an
afternoon writes eleven rows that cannot group with each other and cannot dedupe against
anything, and they are the eleven newest rows in the window. The agency's Recent Activity
then reads as eleven near-identical `revised a bid on Key Art` lines and four of
everything else.

**THIS IS A FINDING AND IT IS REPORTED RATHER THAN FIXED.** Three things about it matter:

1. **Migration 100 does not create it.** It is already live for every vendor who *has* a
   partnership, because branch A admits exactly these rows today. What 100 changes is the
   **population**: vendors with no partnership can now do it too.
2. **It is bounded by the bidding window.** A closed RFP takes the submit path away.
3. **The fix is not in this branch.** Collapsing repeat revisions means either a dedupe
   key for `bid.revise` (which would hide genuinely distinct revisions, the exact defect
   `UNION_REPLACING_EVENT_TYPES` exists to avoid - see its header on `bid.award` colliding
   with `bid.feedback`) or a time-bucketed group key (which the grouping header explicitly
   rejects, because a 5-second bucket merges two separate broadcasts by the same person).
   Both are feed redesigns. **The brief says do not redesign the feed, and this document
   does not.**

---

## 5. What the agency will actually see the day 100 is applied

**Possibly nothing at all, and that is not a failure.** Every row branch B admits is a row
that is *not being written today*. Nothing is backfilled - `milestone_events` is
append-only and the refused inserts left no trace beyond a Sentry event. The feed changes
only for acts that happen **after** the migration, by vendors with no partnership.

Pre-flight P4 in `supabase/migrations/100_milestone_inbox_pin.sql` counts that population
in two queries, one per sub-arm. **If both return zero, the repair is correct and
unexercised**, and reading an unchanged feed as evidence that 100 failed would be wrong.
That is why P4 is run *before* applying and not after.

---

## 6. The one thing not established

**How many `bid.revise` rows a real vendor writes in a real bidding window.** Nothing in
the repository records it, and the emitter has never successfully written one for an
unpooled vendor. Section 4 describes a mechanism with a real bound of "unbounded"; whether
the observed number is 2 or 20 decides whether it is a curiosity or a defect worth a feed
change. It is a query against `partner_rfp_response_versions`, and it is item 9 of the
live checklist in `docs/emitter-rulings-report.md`.
