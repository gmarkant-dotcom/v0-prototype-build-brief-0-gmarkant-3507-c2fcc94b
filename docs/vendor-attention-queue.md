# The vendor attention queue: 67 rows, no deadlines, no order

**Status: DIAGNOSIS ONLY. NOTHING WAS FIXED AND NO `.ts` OR `.tsx` FILE WAS TOUCHED
IN THIS PASS.** A 67-row queue on a customer-facing surface deserves its own change and
its own walk. The rulings Greg owes are in section 6; the queries that settle each open
question are given in full and **were not run** - this session has no database access and
is prohibited from seeking it.

Observed on a live vendor account (April Partner Test Agency): the dashboard reads
**"Needs your response (67)"** and every visible RFP reads **"No deadline set"**.

Everything in sections 1 to 5 was **READ FROM SOURCE**. Nothing was executed.

---

## The surfaces involved

| What | Where |
|---|---|
| The header count `(67)` | `app/partner/page.tsx:544` - `queueRows.length` |
| The list under it | `app/partner/page.tsx:565` - `visibleQueueRows` |
| "No deadline set" | `app/partner/page.tsx:657` |
| The data | `app/api/partner/dashboard/route.ts:238-274` |
| The cap | `lib/dashboard-section-state.ts:52-67`, `SECTION_LIST_CAP = 5` (`app/partner/page.tsx:42`) |

---

## 1. (a) WHY IS EVERY DEADLINE EMPTY?

### THE ANSWER: **POSSIBILITY ONE.** The deadline is optional at capture and nobody sets one. The display path is intact.

**The display path loses nothing.** It is four hops with no transformation:

```
app/api/partner/dashboard/route.ts:100   selects response_deadline off partner_rfp_inbox
app/api/partner/dashboard/route.ts:246   const deadline = (row.response_deadline as string | null) || null
app/api/partner/dashboard/route.ts:263   deadline,                       <- straight onto the wire
app/partner/page.tsx:642                 {item.deadline ? ... : "No deadline set"}
```

There is no reshaping, no re-derivation and no second source. If the column held a value the
page would render it.

**The capture makes it optional and says so out loud.** The broadcast wizard's own helper text:

```tsx
app/agency/page.tsx:2850-2857
  <label ...>Response Deadline</label>
  <Input type="date" value={responseDeadlineDate} ... />
  <p ...>Optional. If set, partners will see "Respond by" in their inbox and RFP detail view.</p>
```

Nothing validates it. `handleBroadcast` checks the NDA link and several other preconditions
and never checks this one (`app/agency/page.tsx:1205-1215`), the field converts to `null` when
blank, and the route accepts that without comment:

```ts
app/api/agency/broadcast-rfp/route.ts:119-121
  const responseDeadlineRaw =
    typeof body.response_deadline === "string" && body.response_deadline.trim().length > 0
      ? body.response_deadline.trim() : null
```

The column is nullable and the insert writes whatever it was handed
(`broadcast-rfp/route.ts:239` and `:384`).

### DID c99ffea COVER THIS PATH? FOR NEW ROWS, YES. FOR ROWS THAT ALREADY EXIST, NO.

c99ffea (2026-08-07) fixed the magic-link/Lightning flow, where the deadline died between the
wizard and `rfp_magic_tokens`. That fix reaches `partner_rfp_inbox` through the attach:

```ts
lib/magic-token-attach.ts:350-352
  if (tokenRow.response_deadline) {
    insertRow.response_deadline = tokenRow.response_deadline
  }
```

**But `insertRow` is the INSERT payload only.** The same function has a self-heal block for
rows that predate its improvements, and `response_deadline` is deliberately absent from it:

```ts
lib/magic-token-attach.ts:386-392
  const heal: Record<string, unknown> = {}
  if (tokenRow.created_at && winner.created_at !== tokenRow.created_at) heal.created_at = ...
  if (derivedStatus && winner.status !== derivedStatus) heal.status = derivedStatus
  if (winner.vendor_org_id == null) heal.vendor_org_id = partnerId
```

`created_at`, `status` and `vendor_org_id` self-heal. The deadline does not. `response_deadline`
does appear in `MERGEABLE_LINKAGE` (`lib/magic-token-attach.ts:80`), but that list governs
collapsing DUPLICATE inbox rows onto a survivor - it copies from a losing inbox row, never from
the token. **So an inbox row created before 074 was applied, or before c99ffea deployed, or
before the agency resent the invitation with a date, holds NULL forever even though the token
beside it holds a real deadline.**

That is a second, narrower cause than "nobody set one", it is invisible on this surface, and
the query below tells the two apart row by row.

### THE QUERIES THAT SETTLE IT. NOT RUN.

Substitute April Partner Test Agency's `organizations.id` and its login email.

```sql
-- Q1. Is the column null, or is the display losing a value?
-- If without_deadline = 67, nobody set one and the display is innocent.
SELECT count(*)                                              AS unresponded_rows,
       count(*) FILTER (WHERE response_deadline IS NOT NULL) AS with_deadline,
       count(*) FILTER (WHERE response_deadline IS NULL)     AS without_deadline
FROM public.partner_rfp_inbox i
WHERE i.vendor_org_id = '<april_org_id>'
   OR lower(i.recipient_email) = '<april_email>';
```

```sql
-- Q2. THE c99ffea RESIDUE. Any row here is one where the token knows the deadline and the
-- inbox row does not, which the self-heal above will never repair.
SELECT i.id, i.created_at, i.scope_item_id,
       i.response_deadline AS inbox_deadline,
       t.response_deadline AS token_deadline
FROM public.partner_rfp_inbox i
LEFT JOIN public.rfp_magic_tokens t
  ON i.scope_item_id = 'magic:' || t.token
WHERE (i.vendor_org_id = '<april_org_id>' OR lower(i.recipient_email) = '<april_email>')
  AND i.response_deadline IS NULL
  AND t.response_deadline IS NOT NULL
ORDER BY i.created_at DESC;
```

```sql
-- Q3. Is this April, or is it the platform? If with_deadline is near zero in every month,
-- the optional field is simply never filled in and R1 below is the real question.
SELECT date_trunc('month', created_at) AS month,
       count(*)                                              AS rows_created,
       count(*) FILTER (WHERE response_deadline IS NOT NULL) AS with_deadline
FROM public.partner_rfp_inbox
GROUP BY 1 ORDER BY 1 DESC;
```

---

## 2. (b) IS 67 CAPPED ANYWHERE?

### In SQL: NO. Not by a limit, and not by anything else.

`grep -n "\.order(\|limit(" app/api/partner/dashboard/route.ts` returns **nothing**. Every read
in that route is unbounded, including the one that produces this queue
(`app/api/partner/dashboard/route.ts:97-101`), which selects `partner_rfp_inbox` with no `WHERE`
of its own at all and filters in JavaScript afterwards.

**The agency dashboard does not do this.** Its equivalent read is bounded at the database:

```ts
app/api/agency/dashboard/route.ts:148-149
  .order("created_at", { ascending: false })
  .limit(500)
```

So the two portals disagree about whether an attention queue has a ceiling, and the vendor side
is the one without one.

### In the browser: YES, at 5, plus an uncapped urgent spill.

```ts
lib/dashboard-section-state.ts:57-64
  const visible = !hasMore || expanded
    ? items
    : (() => {
        const head = items.slice(0, cap)
        const extraUrgent = isUrgent ? items.slice(cap).filter(isUrgent) : []
        return [...head, ...extraUrgent]
      })()
```

with `SECTION_LIST_CAP = 5` and

```ts
app/partner/page.tsx:450-451
  const queueIsUrgent = (row) =>
    row.kind === "overdue-milestone" ||
    (row.kind === "rfp" && ((row.item.daysLeft != null && row.item.daysLeft <= 7) || row.item.ndaPending))
```

**Note what "urgent" means when no deadline exists.** `daysLeft` is `null` for every one of these
67 rows, so the deadline half of that predicate can never fire. Only NDA-pending rows and overdue
milestones spill past the cap. Today the cap is doing all the work.

### WHAT HAPPENS AT 200

- The route fetches all 200 and serializes all 200 onto the wire. No ceiling, no pagination.
- The header reads `(200)`.
- The collapsed list renders 5, plus every NDA-pending row among the other 195, plus a
  `DashboardShowMoreToggle` offering all 200.
- Expanding renders **all 200 `<Link>` rows into the DOM at once**. There is no virtualization
  and no second page. The toggle is the only control and it is all-or-nothing.
- The payload grows linearly with no bound. Nothing in this path degrades gracefully; it just
  gets bigger.

---

## 3. (c) WHAT ORDERS THE LIST?

### Today: **NOTHING. The order is whatever Postgres happened to return.**

There are two ordering steps and neither one is doing anything.

**Step 1, in SQL: absent.** No `.order()` on the inbox read (section 2).

**Step 2, in JS: a no-op on this data.**

```ts
app/api/partner/dashboard/route.ts:269-274
  needsResponse.sort((a, b) => {
    if (a.deadline == null && b.deadline == null) return 0
    if (a.deadline == null) return 1
    if (b.deadline == null) return -1
    return a.deadline.localeCompare(b.deadline)
  })
```

Every deadline is null, so the first branch is taken for every pair and the comparator returns
`0` every time. The sort preserves input order, and the input order is unspecified: PostgreSQL
makes no guarantee without `ORDER BY`, and it can change between two requests for the same rows.
**The vendor's top five can be a different five on a refresh, with nothing on screen to explain
why.**

**And the concatenation buries the urgent kinds.** `queueRows` is built rfps, then onboarding,
then overdue milestones (`app/partner/page.tsx:442-449`). With 67 rfps first, an overdue payment
milestone is at index 68 and reaches the screen **only** because `queueIsUrgent` promotes it past
the cap. Remove that promotion and the single most urgent thing on the page vanishes below a
"Show all" button.

### What it could sort by, in preference order

1. **`created_at DESC` in SQL**, matching `app/api/agency/dashboard/route.ts:148`. Costs one
   clause, makes the order stable and explicable, and works whether or not deadlines exist. This
   is the floor, not a design.
2. **Deadline ascending, nulls last** - which is what the JS comparator already intends and
   cannot deliver. It becomes real the moment R1 is answered.
3. **NDA-pending first.** `ndaPending` is already computed (`route.ts:265`) and is genuinely
   blocking: the vendor cannot even read the RFP. It is treated as urgent for the cap and as
   nothing at all for the order.
4. **Kind before recency** - overdue milestone, then NDA-pending RFP, then RFP, then onboarding -
   so the queue is ordered by what it costs the vendor to ignore it, rather than by which table
   it came out of.

---

## 4. (d) ARE THE COUNT AND THE LIST FROM THE SAME SOURCE?

### Same array, yes. They still disagree in one case, and it is a real one.

Both come from `queueRows`: the header renders `queueRows.length`
(`app/partner/page.tsx:544`) and the list renders `useCappedList(queueRows, ...)`
(`:458`). On membership they cannot drift.

**But the empty-state branch tests a different set than the count does:**

```tsx
app/partner/page.tsx:557
  ) : needsResponseItems.length === 0 && onboardingPending.length === 0 ? (
        <p ...>{VENDOR_DASHBOARD_QUEUE_EMPTY}</p>      // "Nothing is waiting on you."
```

`overdueMilestones` is in `queueRows` and therefore in the count, and it is **not** in that
condition. So a vendor with no outstanding RFPs, no pending onboarding, and one overdue payment
milestone sees:

> **Needs your response (1)**
> Nothing is waiting on you. RFPs sent to your company by the agencies you work with will appear here.

The header counts it, the body denies it exists, and the one thing costing that vendor money is
the thing that disappears. This is the same shape as the tile-said-2-above-five-cards defect
caught yesterday, in the opposite direction.

**A second, quieter disagreement.** Expired requests are dropped from the queue and reported
separately (`route.ts:250-252`, rendered at `app/partner/page.tsx:676-679`). With no deadlines,
nothing can ever expire, so `expiredCount` is permanently `0` and that line never renders.
**Which is why 67 is 67:** it is every RFP this vendor has never answered, since the beginning,
and there is no mechanism by which it can ever go down except by answering them.

---

## 5. What is actually true of this queue, in one paragraph

The 67 rows are every `partner_rfp_inbox` row for this vendor whose effective status is not one
of the nine in `RESPONDED_STATUSES` (`app/api/partner/dashboard/route.ts:20-29`). Nothing bounds
that set in SQL, nothing orders it, nothing ages it out, and the one mechanism that could remove
a row without the vendor acting - expiry - is unreachable because it depends on a deadline that
the product never requires anyone to set. The count is honest about the array it counts. The
array is the problem.

---

## 6. THE RULINGS GREG OWES

Each of these changes what a customer sees, and none should be decided by whoever writes the fix.

**R1. Is a response deadline required at broadcast?** Today the field says "Optional." and is the
only reason this queue has no urgency signal, no expiry and no order. Options: **(a)** required,
and the wizard refuses to broadcast without one; **(b)** defaulted to a sensible horizon the
agency can change; **(c)** stays optional, and the queue is ordered and aged by something else.
**(b) is the recommendation** - it makes the common case correct without blocking an agency who
genuinely has no date. Note that (a) and (b) both change what an agency has to do before they can
broadcast, which is a bigger behaviour change than anything else in this document.

**R2. Should an unanswered request with no deadline ever leave the queue?** Today: never. If R1
lands on (c), this has to be answered independently, probably as "moves to the expired bucket
N days after `created_at`". If R1 lands on (a) or (b), this only governs the existing 67.

**R3. Backfill the c99ffea residue?** Adding `response_deadline` to the self-heal patch in
`lib/magic-token-attach.ts:386-392` would repair, on next page load, every magic-link row whose
token knows the date. It is three lines and no migration. It is listed separately because it
silently changes dates a vendor may already have read as "none", and Q2 above says how many rows
that is before anyone decides.

**R4. What orders the queue?** Recommendation: `created_at DESC` in SQL now, unconditionally, so
the order stops being nondeterministic regardless of what R1 decides. Then kind-then-deadline on
top of it. See section 3.

**R5. Does the count include overdue milestones or not?** Either add `overdueMilestones.length` to
the empty-state condition at `app/partner/page.tsx:557`, or take milestones out of `queueRows` and
give them their own block. **Not** left as it is: today the header and the body contradict each
other whenever milestones are the only thing in the queue.

**R6. Does the vendor attention queue get a SQL ceiling?** The agency side has one at 500. The
vendor side has none. If R1 and R2 land, 67 shrinks and this matters less; if they do not, this
grows without bound for every vendor on the platform.

---

## 7. OPEN, with the query that settles each

| # | Question | Query |
|---|---|---|
| O1 | Are the 67 rows null-deadline, or a display loss? | Q1, section 1 |
| O2 | How many rows are the c99ffea residue? | Q2, section 1 |
| O3 | Is the empty deadline April-specific or platform-wide? | Q3, section 1 |
| O4 | What are the 67 by status, and can any of them ever leave? | `SELECT status, count(*) FROM public.partner_rfp_inbox WHERE vendor_org_id = '<april_org_id>' OR lower(recipient_email) = '<april_email>' GROUP BY status ORDER BY 2 DESC;` |
| O5 | Is any vendor already past 200? | `SELECT vendor_org_id, count(*) FROM public.partner_rfp_inbox WHERE status NOT IN ('submitted','bid_submitted','revision_submitted','under_review','feedback_received','shortlisted','meeting_requested','awarded','declined') GROUP BY 1 HAVING count(*) > 100 ORDER BY 2 DESC;` (the status list is `RESPONDED_STATUSES`, `app/api/partner/dashboard/route.ts:20-29`; read it from source before running, this table's `status` and the response's `status` are not the same vocabulary) |
