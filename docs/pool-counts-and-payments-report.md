> # MERGED, AND OVERTAKEN. SECTION 2 SAYS "PREPARED, NOT APPLIED". IT WAS APPLIED THE SAME DAY.
>
> **Added 2026-09-15** by the `feat/engagements-one-source` run, verified against the code and
> against `git`, not against any document.
>
> **Two separate corrections. The second is the one that costs something.**
>
> **1. The branch is merged.** All five commits are on `main`, confirmed with
> `git merge-base --is-ancestor` EXECUTED per commit: `3ed33a6`, `472d67f`, `b320081`,
> `446f85a`, `3a2e0b4`. The header's "NOT PUSHED. NOT MERGED." was true when written.
>
> **2. THE SECTION 2f DIFF THIS REPORT DECLINED TO APPLY WAS APPLIED IN `edff222`**, the commit
> immediately after this report, titled *"fix: a vendor owed money keeps seeing it after the
> relationship ends"*. Both filters came off together, exactly as section 2f said they must:
>
> - `app/api/partner/payments/route.ts` - `.eq("status", "active")` **deleted**. Verified by
>   reading the file at `HEAD`: the `partnerships` select now carries only `.in("vendor_org_id",
>   callerOrgIds)` and `.order(...)`.
> - `app/partner/payments/page.tsx:403` - the browser-side `status === "active"` narrowing
>   **deleted**; the line is now `const rows = allRows`.
>
> **THEREFORE SECTIONS 2, 2a, 2f, 6 AND 7 NO LONGER DESCRIBE THIS PRODUCT.** Specifically:
>
> | Says | Now |
> | --- | --- |
> | Section 2 heading: "PREPARED, NOT APPLIED" | Applied, in `edff222` |
> | Section 2a: an ended-only vendor sees "An empty screen" | They see their milestones. That was the point of `edff222` |
> | Section 2f: "THE EXACT DIFF GREG WOULD APPLY. NOT APPLIED" | It is applied. Reading it as pending work is the trap |
> | Section 6 revert table: four commits | Five. `edff222` is not in the table and is the only one that changed what a vendor can read |
> | **Checklist step 7**: "with the filters still in place: **the agency is gone from the selector**" | **WRONG NOW.** With the filters gone the ended agency STAYS in the selector, tagged |
> | **Checklist step 8**: the ended agency's notice renders below the selector | **THAT BLOCK WAS DELETED** by `edff222`. There is no separate panel in the both-cases branch any more |
> | Checklist step 10: "should show **four** commits plus this report" | Six commits now sit on `main` from that branch plus `edff222` |
>
> **Steps 7 and 8 are the dangerous rows.** They tell Greg to verify a screen that no longer
> exists, so following them produces a "this run is broken" result from a run that is fine. The
> corrected steps are carried into `docs/engagements-and-counts-report.md`, marked CARRIED OVER.
>
> **What did NOT change:** no policy, no migration, no RLS predicate. `edff222` removed two
> application-level query filters. Section 2b's verdict that the policies are SUFFICIENT is what
> makes that safe, and it is unchanged. Section 1 (the pool page labels) is untouched and still
> accurate.

# Pool counts and payments: run report

**Branch:** `feat/pool-counts-and-payments`, cut from `main` at `d6074a8`. Five commits.
**NOT PUSHED. NOT MERGED. NO MIGRATION AUTHORED, EDITED OR APPLIED. NO SQL RUN OF ANY KIND.**
**NO ACCESS PREDICATE WAS WIDENED.** Phase 2 prepares a widening and does not perform it.

**Date:** 2026-09-15. Migration 100 was not touched and is still AUTHORED, NOT APPLIED.

---

## THE THREE THINGS TO READ FIRST

### 1. Not one number on the pool page is wrong. It is a copy problem, and the fix was labels

Every count on `/agency/pool` is arithmetically correct for what it counts. The page never said
what any of them counted, and one line that reads as a page-level summary counts a single
column of three. "Showing 5 results" above 32 rows was true of column A and silent about the
other 27. **No arithmetic was changed**, because changing it would have traded a visible
contradiction for an invisible one. Section 1.

**In production that line also printed the same number three times.** `setPartners([])` on the
production branch means `filteredPartners` is always 0, so `totalFilteredMatches` was
identically `filteredNetworkRows.length`, and "Showing 5 results - 5 in network (of 5)" is one
number wearing three labels.

### 2. THE PAYMENTS FILTER IS TWO FILTERS, NOT ONE. Applying the brief's one-line diff would change nothing a vendor can see

The brief names `app/api/partner/payments/route.ts:77`. There is a **second** active-only
filter in the browser, at `app/partner/payments/page.tsx:403`, which narrows `/api/partnerships`
and is what fills the agency selector. Remove the route filter alone and the milestones arrive
with **no agency to select them under**. Both come off together or neither does. The complete
two-part diff is in section 2f and neither half was applied.

**The policy answer is SUFFICIENT.** All three partner SELECT policies on `payment_milestones`
confine a vendor to partnerships their own org holds, with no status predicate anywhere.
Removing the filters exposes the caller's own ended partnerships and **cannot reach another
vendor's milestones**. Section 2b, with the policies quoted in full and the one piece of
corroborating evidence that is weaker than it looks.

### 3. `docs/roadmap-state.md` was stale in five places, and it is the file written to be read cold

Four of the five would have sent a session to redo finished work: the rulings document it says
does not exist now does, emitter rulings 1, 2, 4 and 5 are on `main` rather than on a branch,
and migration 100 is authored. Corrected in a banner, each row verified against code. **The
banner states plainly that 100 is AUTHORED AND NOT APPLIED**, so the correction cannot be
misread as saying ruling 6 is repaired. Two defect diagnoses were also closed. Section 3.

---

## 0. Phase 0: the inherited baseline, by measurement

`git status --porcelain` returned **empty**. The tree was clean, so no collision. `HEAD` was
`d6074a8` and **identical to `origin/main`**, which is why the gates were measured in the main
checkout: it *is* `origin/main`, it has a real `node_modules`, and that avoids both harness lies
on record (the worktree Turbopack symlink error and pnpm's dependency-status check reporting its
own exit codes as the gates'). A throwaway worktree was created, used to confirm the checkout
matched, and removed; `node_modules` was verified intact afterwards (821 `.pnpm` entries, tsc
still 0).

**Every gate was run as its own unpiped command with `$?` read on the next statement.** No pipe
was used to read an exit code anywhere in this run.

| Gate | Phase 0 | Phase 5 | Verdict |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | **0** | unchanged |
| `pnpm build` | **0** | **0** | unchanged |
| `pnpm lint` | **1**, `182 problems (154 errors, 28 warnings)` | **1**, `182 problems (154 errors, 28 warnings)` | unchanged, triple identical |
| `pnpm identity-columns:guard` | **0** | **0** | unchanged |
| `pnpm org-id-reads:guard` | **0**, Class B 60 known-open | **0**, Class B 60 known-open | unchanged |
| `pnpm embed-targets` | **0** | **0** | unchanged |
| `pnpm policy-audit:guard` | **1** | **1** | unchanged, known-failing |
| `pnpm verify-rls` | **2** | **2** | unchanged, known-failing |

The three known-failing gates came back at exactly the values the brief predicted (1 / 1 / 2),
which is the cross-check that catches a lying harness. Nothing moved. tsc and every guard were
also re-run after each commit.

---

## 1. Phase 1: the pool page counts

### 1a. What each number counts today

Production path, `isDemo === false`. `GET /api/partnerships` excludes `status='removed'` at
`app/api/partnerships/route.ts:95` and `:129`, so `partnerships` never holds a removed row; the
archive lives in separate `removedRows` state and feeds no count.

| # | Surface | Renders | Expression | Counts | Narrowed by |
|---|---|---|---|---|---|
| 1 | Metric tile "Active vendors" | `pool/page.tsx:1461` | `partnerships.filter(p => p.status === "active").length` | status **exactly** `active` | **nothing** |
| 2 | Metric tile "Vendors with active engagements" | `:1469` | `/api/agency/utilization:352` | distinct **partnerships** with an awarded response on a project not past `end_date` | nothing |
| 3 | Metric tile "Blacklisted" | `:1477` | `partnerships.filter(isPartnershipNotesBlacklisted).length` | blacklist note flag across the **whole** pool, pending rows included | nothing |
| 4 | "Showing N results" | `:1718` (was) | `filteredNetworkRows.length + filteredPartners.length` | column A only; `filteredPartners` is **always 0** in production | 8 filter controls + search |
| 5 | "N in network" | `:1722` (was) | `filteredNetworkRows.length` | **the same number as #4**, identically | same |
| 6 | "(of N)" | `:1722` (was) | `allNetworkRows.length` | `partnershipPoolColumn(p) === "network"`, i.e. `active` + `suspended` + `terminated` | nothing |
| 7 | Header "Active vendors N" | `:1743` (was) | `filteredNetworkRows.length` | **the same number as #4 and #5** | same |
| 8 | Header "Invited N" | `:2073` | `filteredInvitedRows.length` | `pending` **with** `invitation_sent_at` | **search only** |
| 9 | Header "Discovered N" | `:2165` | `filteredDiscoveredRows.length` | `pending` **without** `invitation_sent_at` | **search only** |

`partnershipPoolColumn()` is `lib/partnership-state.ts:100`. `setPartners([])` on the production
branch is `pool/page.tsx:467`, which is why #4 and #5 are the same number and why the "in
discovery" clause never rendered outside demo.

### 1b. WHICH ARE WRONG AND WHICH ARE MERELY AMBIGUOUS

**NONE IS WRONG. EVERY NUMBER IS ARITHMETICALLY CORRECT FOR WHAT IT COUNTS.** The observed
screen is internally consistent: 5 rows sit in column A, and 5 is what #1 and #4 through #7 all
report. The 16 and the 11 are correct for their columns. `5 + 16 + 11 = 32` and nothing is lost.

**This is a copy problem, and the fix is labels.** Four specific defects, in order of how badly
they mislead:

- **D1. "Showing N results" is a page-level claim scoped to one column of three.** The word
  "results" is unqualified and the line sits above all three. 27 visible rows were excluded from
  a number presented as the summary of the screen.
- **D2. The line printed one number three times.** "Showing 5 results - 5 in network (of 5)".
  The "in network" clause exists to disambiguate two sources, and the second source does not
  exist outside demo.
- **D3. Two surfaces wear the same words and count different sets.** The metric tile "Active
  vendors" counts `status='active'`; the column header "Active vendors" counts the network pool
  column, which also holds `suspended` and `terminated`. **They agree today only because nothing
  in `app/` writes those statuses** (Phase 4 confirms this). This is the latent form of the
  header-contradicts-its-body bug this page has shipped twice.
- **D4. Eight filter controls narrow column A only; search narrows all three. Nothing said so.**
  Choosing Status: Blacklisted empties Active vendors to the blacklisted subset and leaves
  Invited 16 and Discovered 11 exactly as they were. The Blacklisted **tile** meanwhile counts
  blacklisted rows across the whole pool, so it can read 3 while the chip shows 0 in column A.

### 1c. The fix

**No expression that produced a number was changed.** Each one now carries the name of what it
counts, and the two columns that had no summary now have one.

```
Active vendors 5 of 5 · Invited 16 of 16 · Discovered 11 of 11
Filters narrow Active vendors. Search narrows all three columns.
```

The `of` denominators are `allNetworkRows.length`, `invitedRows.length` and
`discoveredRows.length` - the unfiltered arrays that already existed. The second line is D4,
and it follows the house pattern already set by the "From awarded work only" and "Point person,
contributor, or relationship owner" hints on the chip rows above it. `totalFilteredMatches` was
deleted as unused.

**D3 was NOT fixed, deliberately.** Renaming a column header that is accurate for 100% of live
rows is a product decision, and the statuses that would break it do not exist yet. It is
documented at `pool/page.tsx:1391` and is an **owed ruling** below. The new denominator makes it
visible the day it happens: `allNetworkRows.length` counts suspended and terminated rows and the
tile does not, so the two numbers separate on screen rather than silently.

### 1d. The same class elsewhere. REPORTED, NOT FIXED

| Surface | Verdict | Action |
|---|---|---|
| "Vendors with active engagements" tile, pool page | **Correct and correctly labelled.** `docs/active-engagements-one-source.md` reviews four "Active Engagements" surfaces and rules this one **"Change nothing"**: it is the only one of the four that applies a liveness rule, and its label says "Vendors", which is what it counts | **Not touched.** That fix is its own session |
| "Blacklisted" tile vs the Blacklisted chip | Both correct, different scopes: tile is whole-pool, chip is column A | Documented in code at `:1399`; D4's new line tells the reader which column the chips act on |
| Dashboard "Active Vendors" tile | **Agrees with the pool tile.** `app/api/agency/dashboard/route.ts:421` uses `isActivePartnership()`, which is `status === 'active'`, the same unit as pool tile #1 | None needed. Reported as a **positive** finding |
| Dashboard "Open RFPs" | Distinct **projects** with an open scope item, not scope items. Deliberate and commented at `route.ts:422` | None |
| `docs/active-engagements-one-source.md` surfaces 1, 2 and 3 | Still open. Surface 2 (`app/partner/page.tsx:707`) says "Active" and applies no liveness filter at all | **Off the pool page. Reported only**, per the brief |

---

## 2. Phase 2: the payments filter. PREPARED, NOT APPLIED

### 2a. The filter, quoted, and what a vendor actually sees

`app/api/partner/payments/route.ts:103` (was `:77` before this run's comment was added):

```ts
const { data: partnershipRows, error: pErr } = await supabase
  .from("partnerships")
  .select("id, lead_org_id, status")
  .in("vendor_org_id", callerOrgIds)
  .eq("status", "active")
  .order("created_at", { ascending: false })
```

**Statuses excluded today:** `suspended`, `terminated`, `removed`, and `pending`. Given the
CHECK constraint's five values, only `active` survives.

**It gates BOTH milestone reads, not one.** `partnershipIds` feeds the `partnership_id` query
directly **and** feeds `awardedProjectIds`, which feeds the `project_id` query. Both reads sit
behind `if (... .length > 0)` guards.

**What the vendor sees, precisely:**

- **Only ended relationships:** both id arrays are empty, both queries are **skipped entirely**,
  and the response is `{ milestones: [], partnerships: [] }`. **An empty screen. Not an error,
  not a partial list.** The page then rendered "No active partnerships yet. Accept an invitation
  to see payment schedules and rate fields here." - a sentence that hides the fact that a
  relationship existed and ended.
- **One live agency and one ended:** a **partial list**, showing the live agency only, with
  nothing on screen indicating the other exists. This is the more insidious case.

### 2b. The `payment_milestones` policies, quoted in full

Post-079, four policies exist. From `supabase/migrations/079_organizations.sql:1505-1532`:

```sql
CREATE POLICY "Agency can manage payment milestones"
  ON public.payment_milestones AS PERMISSIVE FOR ALL TO authenticated
  USING (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())))
  WITH CHECK (project_id IN (
    SELECT pr.id FROM public.projects pr
    WHERE pr.org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners can view their payment milestones"
  ON public.payment_milestones AS PERMISSIVE FOR SELECT TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners read payment milestones for their partnerships"
  ON public.payment_milestones AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    partnership_id IS NOT NULL
    AND partnership_id IN (
      SELECT p.id FROM public.partnerships p
      WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));

CREATE POLICY "Partners read their payment milestones"
  ON public.payment_milestones AS PERMISSIVE FOR SELECT TO authenticated
  USING (partnership_id IN (
    SELECT p.id FROM public.partnerships p
    WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())));
```

079's own comment above them: *"Three near-identical partner SELECT policies exist live. All
three are recreated rather than consolidated ... They OR together, so three is harmless."*

### >>> THE ANSWER: SUFFICIENT

**The policies alone confine a vendor to their own milestones once the route filter is gone.**

**The predicate, and why.** All three partner policies reduce to the same test:

```
partnership_id IN (SELECT p.id FROM partnerships p
                   WHERE p.vendor_org_id IN (SELECT current_user_org_ids()))
```

Every readable row must hang off a partnership whose `vendor_org_id` is an organization the
caller is a member of. **`status` is irrelevant to that confinement and appears in none of
them.** So removing the route filter widens the set from *"my active partnerships' milestones"*
to *"my partnerships' milestones in any status"* - which is exactly Greg's ruling - and cannot
cross to another vendor, because the org test is untouched.

**The project-path query is safe too, and this is the part worth checking.** The second read
passes `project_id` values rather than partnership ids, which looks like a way around the
partnership test. It is not: RLS still applies the `partnership_id` predicate to every row
returned, so that query can only surface rows on those projects that **also** belong to the
caller's own partnerships.

**One consequence of that, which is a separate latent regression and not a blocker.** The
project path therefore returns nothing the partnership path did not already return. Rows with
`partnership_id IS NULL` are unreadable by a vendor post-079. `scripts/031-partner-milestones-via-assignments-rls.sql`
created a policy for exactly that case ("Partners read milestones for awarded assignment
projects") and **079 did not recreate it**. Reported, not acted on.

**Where the evidence is weaker than it looks, stated plainly.** Two independent repository
sources agree the 031 policy is not live: it is absent from 079's drop-list census
(`:592-595` names four `payment_milestones` policies and not that one), and it is absent from
`docs/schema-snapshot-2026-08-13.md:185-198`, which the audit script calls "the AUTHORITATIVE
record of live policies" and which lists exactly four. **But that snapshot is dated 2026-08-13
and is pre-079** - its predicates still read `partner_id = auth.uid()`. So the snapshot proves
the policy was not live *before* 079, and 079's census proves 079 did not create it. Neither
observes the database today.

**Why that does not change the verdict.** If the 031 policy *were* somehow live, its predicate
after 079's `RENAME COLUMN partner_id TO vendor_org_id` (`:673`) would read
`ps.vendor_org_id = auth.uid()`, comparing an organization id to a user id - true only for the
sixteen backfilled founder accounts where those happen to be equal. That policy grants read on
**all** milestones of a project where the caller holds an awarded assignment, with no
`partnership_id` tie, so on a project with two awarded vendors it would let one read the
other's. **That risk, if it exists at all, is live TODAY and is not created by removing the
filter** - the route already reads by `project_id` for active partnerships. It is an
independent finding.

**The one query that would settle it**, to be run as `postgres` in the SQL editor:

```sql
SELECT polname,
       pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'public.payment_milestones'::regclass
ORDER BY polname;
```

Expected: exactly **four** rows, the four quoted above. **A fifth named "Partners read
milestones for awarded assignment projects" means the paragraph above is live and wants its own
session.**

### 2c. The screen now says the relationship ended. BUILT

Labels only. Nothing narrows, nothing widens, both filters left in place.

- `relationshipTag(status)` - `null` for `active`, `pending` and empty; `"Paused"` for
  `suspended`; `"Ended"` for `terminated`, `removed` and any status added later.
- **`suspended` is not labelled "Ended".** A paused relationship can resume, and the entire
  point of the tag is to stop the screen making a false statement.
- Driven **entirely off the row's status**, so it is correct whether or not the filter is
  removed and needs no second edit when it is.

**The copy, as it ships:**

> **Ended:** "Your relationship with {agency} has ended. Anything you are owed stays on this
> page so you can still see and chase it, and you will not be sent new RFPs."
>
> **Paused:** "Your relationship with {agency} is paused. Anything you are owed stays on this
> page, and you will not be sent new RFPs while it is paused."

("you will not be sent new RFPs" is accurate for every non-active status:
`app/api/agency/broadcast-rfp/route.ts:222` requires `status='active'`.)

**Where it renders.** A tag in the agency selector trigger and on each dropdown row; a banner
above the payment schedule for the selected agency. Milestones on this page all sit under one
selected agency, so one true sentence above the schedule beats a badge repeated down every row.

**The case that renders TODAY, with both filters still in place.** A vendor whose only
relationship ended read *"No active partnerships yet. Accept an invitation..."*. The ended rows
come from the **same `/api/partnerships` response that already fills the selector** - already
fetched, already this vendor's own, previously filtered out and discarded - so that vendor now
reads that the relationship ended and that anything they are owed stays on the page. **No extra
request and no widened predicate.** The route also now returns `status`, which it had selected
all along and never returned.

### 2f. THE EXACT DIFF GREG WOULD APPLY. NOT APPLIED

Three hunks. **Hunks 1 and 2 must go together**; hunk 3 is cleanup that becomes correct once
they do.

```diff
--- a/app/api/partner/payments/route.ts
+++ b/app/api/partner/payments/route.ts
@@ -100,7 +100,6 @@
     const { data: partnershipRows, error: pErr } = await supabase
       .from("partnerships")
       .select("id, lead_org_id, status")
       .in("vendor_org_id", callerOrgIds)
-      .eq("status", "active")
       .order("created_at", { ascending: false })
```

```diff
--- a/app/partner/payments/page.tsx
+++ b/app/partner/payments/page.tsx
@@ -403,1 +403,1 @@
-        const rows = allRows.filter((p) => String(p.status || "").toLowerCase() === "active")
+        const rows = allRows
         setActivePartnerships(rows)
```

```diff
--- a/app/partner/payments/page.tsx
+++ b/app/partner/payments/page.tsx
@@ -803,10 +803,0 @@
-          {activePartnerships.length > 0 && endedPartnerships.length > 0 && (
-            <div className="text-sm text-vendor-muted-strong rounded-xl border border-vendor-border bg-vendor-surface px-4 py-3 space-y-1">
-              {endedPartnerships.map((p) => {
-                const tag = relationshipTag(p.status)
-                if (!tag) return null
-                return <div key={p.id}>{relationshipNotice(agencyLabel(p), tag)}</div>
-              })}
-            </div>
-          )}
```

**Why hunk 3.** That block exists only because an ended relationship cannot be selected today.
Once hunks 1 and 2 land, the ended agency appears in the selector carrying its own tag and its
own banner, and leaving the block in would state the same thing twice on one screen.

**After applying, rename `activePartnerships`.** It will hold every partnership and the name
will lie. Mechanical, and the variable is local to one component.

**What to expect after applying.** A vendor with an ended partnership gains: that agency in the
selector, tagged; the banner; and their milestones for it. They gain **no** row belonging to any
other vendor - that is section 2b. Run the section 2b query first if you want the 031 question
closed before widening anything.

---

## 3. Phase 3: documents closed

### 3a-3c. The onboarding regression is FIXED. Verified against code, not inherited

**Verdict: FIXED.** Marked RESOLVED at the top of `docs/079-onboarding-docs-regression.md`,
naming commit `e2c5841` (2026-08-18). Nothing else in the document was changed.

**Verified in two independent layers, both read at `HEAD`:**

1. `components/stage-03-onboarding-workflow.tsx` - the three silent `continue` statements the
   report identified now split into `lost[]` and `placeholders[]`. **A non-empty `lost[]` calls
   `setError()` and returns BEFORE `setSending(true)` and before the `fetch`** - I traced the
   control flow to the `return` rather than taking the comment's word for it. No request, so no
   package row and no email. The predicate deciding what is a valid document is unchanged; only
   the reporting of a discard is new.
2. `app/api/projects/[id]/onboarding-packages/route.ts` - the server refuses the same signature
   independently: `if (rawDocs.length > 0 && docs.length === 0)` returns 400 with the counts
   logged. `documents: []` is still allowed on purpose, correctly: a no-documents package is
   legitimate and is **not** the 2026-08-18 signature, which was a request that *carried*
   documents and kept none.

**Still open in that report, and said so in the marker:** TASK 5's root cause. *Why* the array
arrived empty on those three sends is still not established and is not establishable from
source. The fix does not depend on knowing it.

### 3d. The sweep across `docs/`

**Marked resolved - verified against code by me:**

| Document | Verdict | Evidence |
|---|---|---|
| `079-onboarding-docs-regression.md` | RESOLVED, `e2c5841` | Above |
| `087-award-break-diagnosis.md` | RESOLVED IN CODE, `915d029` | Its own fix report says "code applied, **uncommitted**", which is why it still read as open. It is committed. `recipient_email` is selected at `rfp-responses/[id]/route.ts:366` and `:410`; the linked insert at `lib/award-partnership-resolution.ts:153` is guarded by `partnerIdForResolution && normalizedEmail`, so the `vendor_org_id`-set / `partner_email`-NULL row that 087 refuses with 42501 is unreachable |
| `roadmap-state.md` | STALE in 5 places, banner added | Each row verified: `ls docs/relationship-end-rulings.md`; `partnerships/route.ts:1401` (`vendor.remove`); `pool/[partnerId]/notes/route.ts:287` (`vendor.blacklist`); `ai/master-brief/route.ts:214` (`rfp.generate`); `bids/[responseId]/decompose/route.ts:290` (`bid.analyze`); `ls supabase/migrations/` shows `100_milestone_inbox_pin.sql` |

**Needing verification - NOT marked, because I did not verify them against code:**

| Document | Why it is a candidate |
|---|---|
| `docs/vendor-attention-queue.md` | "DIAGNOSIS ONLY. NOTHING WAS FIXED AND NO `.ts` OR `.tsx` FILE WAS TOUCHED". No later report claims the fix, but nothing confirms it is still open either |
| `docs/080-repair-report.md` | "repaired, NOT applied". Whether the apply happened is a migration-boundary question this run could not answer |
| `docs/company-name-write-path.md` | "code written, gates re-run, **not committed**". Same shape as the 087 trap: check whether it has since been committed |
| `docs/093-phase6-observations.md` | "REPORT ONLY. No code was written for either item" |
| `docs/095-notification-types-ruling.md` | "AWAITING RULING. No migration numbered 095 exists" - but 095 now exists in `supabase/migrations/`, so at minimum the second half is stale |
| `docs/active-engagements-one-source.md` | Genuinely open by design, and the brief forbade touching it. Listed so it is not mistaken for an oversight |
| `docs/silent-failures-report.md` | Contains "**So that sentence may be false as well**", an explicitly unresolved self-doubt worth closing |

**A note on the trap itself.** Two of the three resolved documents were open only because the
*fixing* report described its own work as uncommitted or unmerged and was never revisited after
the commit landed. That is the pattern worth a habit: when a fix commits, the report that says
"uncommitted" is what strands the diagnosis.

---

## 4. Phase 4: the piece that needs no ruling

Written into `docs/relationship-end-rulings.md` as **section 8, "What the build actually
costs"**. **NO CODE WAS WRITTEN.** The feature stays blocked on the section 4 rulings.

**4a: the premise is CONFIRMED**, and section 0a of that document's sharper version holds too -
*neither* side can end a live relationship. Every write to `partnerships.status` in `app/` and
`lib/` is tabulated there. The vendor branch is gated at `app/api/partnerships/route.ts:1061` on
`partnership.status === 'pending'`, so the vendor's only `terminated` write is declining an
invitation. The agency's only control acts on Discovered rows. Every other hit on `suspended`
or `terminated` is a type union, a badge branch, a comment or a validation list.

**4b: the route needs NO change. It is entirely a front-end gap.** The brief suspected this and
it is right.

- `:1056` already validates against `['active','suspended','terminated','removed']`.
- `:1335` is a generic `.update({ status, updated_at })` with **no per-status branch**.
- `isAgency` is `callerOwnsOrg(callerOrgIds, partnership.lead_org_id)`, so **no predicate needs
  widening** for the control to work. That is what makes this separable from the rulings.
- The read side already exists: `pool/page.tsx:1932-1935` renders both badges.

**Estimate: zero route files, zero migrations, zero policies, one component.** The control
belongs in the Active vendors card action group at `pool/page.tsx:2048`;
`handleRemovePartnership()` at `:707` is the call shape and differs only in the status string.

**Section 8d states what it does NOT buy:** it revokes nothing. Without a ruling it is an honest
status change and a badge, and the dialog copy must not imply otherwise.

---

## 5. WHAT I COULD NOT ESTABLISH

**No database was queried at any point. No credentials were sought.** Every claim about live
data below is unverified by definition.

1. **Whether the `scripts/031` policy is live.** Two repository sources say no; neither observes
   today's database. The settling query is in section 2b. **This is the only open question that
   touches section 2b's verdict**, and it does not change it, because the risk it describes is
   independent of the filter.
2. **The live pool counts.** The 5 / 16 / 11 / 32 figures are Greg's observation of 2026-09-14,
   quoted. I verified the *expressions*, not the values.
3. **Whether any partnership currently sits at `suspended` or `terminated`.** Phase 4 shows no
   control writes them, so the expected count is the declines only. If any *active-origin* row
   exists, some path produced it that this survey did not find, and D3 is live now rather than
   latent.
4. **Whether any vendor is currently affected by the payments filter.** Needs a count of
   non-active partnerships holding unpaid milestones. This is section 1c's blast radius in the
   rulings document, question 2 of its section 6.
5. **The migration boundary.** Untouched and unverifiable from here. 100 remains AUTHORED, NOT
   APPLIED on the strength of the brief's statement.
6. **Nothing was run in a browser.** No screen in this report was viewed. Every UI claim is from
   reading the component, which is why section 7 is a manual checklist.

---

## 6. MERGEABILITY AND REVERT

**All four phases are independently mergeable.** No commit depends on an earlier one, and no two
touch the same file except Phase 1 and Phase 4, which touch `app/agency/pool/page.tsx` and
`docs/relationship-end-rulings.md` respectively - different files.

| Commit | Phase | Files | Revert if wrong |
|---|---|---|---|
| `3ed33a6` | 1 | `app/agency/pool/page.tsx` | `git revert 3ed33a6`. Restores "Showing N results" and `totalFilteredMatches`. **Self-contained.** Nothing else reads the removed variable |
| `472d67f` | 2c | `app/api/partner/payments/route.ts`, `app/partner/payments/page.tsx` | `git revert 472d67f`. Removes the tag, the banner and the returned `status` field. **Both filters are untouched by this commit, so reverting it changes no access and no query** |
| `b320081` | 3 | 3 docs | `git revert b320081`. Documentation only |
| `446f85a` | 4 | 1 doc | `git revert 446f85a`. Documentation only |

**The riskiest commit is `3ed33a6`**, because it is the only one that changes what a user sees on
a screen they use daily, and it is also the one whose logic is most mechanical - no arithmetic
moved. **`472d67f` is the safest code commit**: every label it adds is unreachable today, except
the ended-relationship empty state, which replaces a sentence that was misleading.

**If section 2b's verdict is ever shown wrong, nothing in this branch needs reverting.** The
filters were not removed. The diff in 2f is unapplied text in a document.

---

## 7. THE LIVE CHECKLIST

Sign in as **gmarkant@gmail.com**, the **markant** lead agency. Steps 6 to 9 need a vendor
account with at least one payment milestone.

1. **Open `/agency/pool`.** Confirm the line above the three columns now reads
   `Active vendors N of N · Invited N of N · Discovered N of N` and that the words "Showing"
   and "results" are gone.

2. **MANDATORY - EVERY COUNT AGREES WITH WHAT IT LABELS.** Count the rows in each of the three
   columns by hand and check each against the number in its own header **and** against its pair
   in the summary line. Then check the three sums: the "Active vendors" tile against the Active
   vendors column, and the total of all three columns against what the summary line's three
   pairs add up to. **Expected on the 2026-09-14 data: 5, 16, 11, totalling 32, with the tile
   reading 5.** If the tile and the Active vendors column disagree, that is D3 going live and
   means a suspended or terminated row exists - report it, because Phase 4 says no control can
   create one.

3. **Confirm the second line reads** "Filters narrow Active vendors. Search narrows all three
   columns."

4. **Test that claim.** Click **Status: Blacklisted**. Active vendors should narrow; **Invited
   and Discovered must not change**, and their summary pairs should still show `N of N`. Click
   **Status: All** to reset.

5. **Test search.** Type a vendor name into the search box. **All three** columns should narrow
   and every "shown of total" pair should show a first number smaller than its second. Clear it.

6. **Open `/partner/payments` as a vendor with one live agency.** Confirm the agency selector
   shows the agency with **no tag**, and that **no** relationship banner appears. This is the
   unchanged case and it must look exactly as it did before.

7. **MANDATORY - A VENDOR CAN TELL A RELATIONSHIP HAS ENDED.** As the markant agency, move one
   partnership for that vendor to an end state. **There is no UI for this** (Phase 4), so use
   the API directly from a browser console while signed in as the agency:

   ```js
   await fetch('/api/partnerships', {
     method: 'PATCH',
     credentials: 'same-origin',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ partnershipId: '<id>', status: 'terminated' }),
   }).then(r => r.json())
   ```

   Reload `/partner/payments` as that vendor. **Expected, with the filters still in place:** the
   agency is gone from the selector, and in its place a panel names the agency, tags it
   **Ended**, and reads *"Your relationship with {agency} has ended. Anything you are owed stays
   on this page so you can still see and chase it, and you will not be sent new RFPs."*
   **The old sentence "No active partnerships yet. Accept an invitation..." must NOT appear.**
   That is the step that proves the screen no longer hides the ending.

8. **Check the partial case.** If the vendor has a second live agency, confirm the selector still
   works for it and the ended agency's notice renders **below** the selector rather than
   replacing it.

9. **Restore the vendor.** PATCH the same partnership back to `status: 'active'` and confirm the
   payments screen returns to its step 6 appearance with no tag and no banner.

10. **Confirm nothing was applied.** `git log --oneline origin/main..feat/pool-counts-and-payments`
    should show **four** commits plus this report, and `git status` should be clean. No migration
    file was added or edited; `supabase/migrations/` should still end at `100_*`, unapplied.

---

## 8. OWED RULINGS

Neither was decided by this run.

**R1. The "Active vendors" tile and the "Active vendors" column count different sets** (D3). The
tile counts `status='active'`; the column counts the network pool column, which also holds
`suspended` and `terminated`. They agree only while no control writes those statuses. **The
decision is what the column is called once it can hold a suspended vendor** - rename the column,
change the tile's unit, or split the column. It belongs with whoever builds the Phase 4 control,
because that control is what makes it live. Recorded at `app/agency/pool/page.tsx:1391`.

**R2. Whether the vendor-facing words for `suspended` and `terminated` are "Paused" and
"Ended".** Section 2c ships those because labelling a suspended relationship "Ended" would be a
false statement, and a tag that lies is worse than no tag. But the vendor-facing vocabulary for
the two end states is a product choice, and Q4 of `docs/relationship-end-rulings.md` asks
whether they are even two distinct acts. If Q4 collapses them, `relationshipTag()` collapses
with it.
