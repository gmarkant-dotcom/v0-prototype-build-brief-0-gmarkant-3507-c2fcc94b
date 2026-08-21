# 091b — session report. Test reporting, the silent admin write, the flag scope, and emitter coverage.

Branch `feat/m1-entitlements-fix`, five commits on top of `7129c1f`.
**Nothing was pushed. No PR. No migration applied. No database touched.**

---

# READ FIRST

## 1. Every phase completed. No phase was skipped or partially done.

Phases 1 through 6 all finished. Two things are worth flagging before the
detail, and neither is an incomplete phase:

- **Phase 5 implemented three emitters out of twenty-one gaps, deliberately**,
  and the reason is a finding rather than a shortfall — see §5. Eighteen of the
  remaining gaps need a *feed renderer* before an emitter is worth anything,
  and a renderer is a copy decision. Six of those also need a product ruling.
- **Phase 3 fixed one route and inventoried the rest, as instructed.** The
  inventory turned out to contain two different defect classes, not one, and
  the distinction matters — see §3.

## 2. 091 REMAINS UNAPPLIED, AND THE TEST MUST BE READ BEFORE IT IS.

> **`supabase/migrations/091_profiles_column_guard.sql` is AUTHORED, NOT
> APPLIED.** No statement from it has ever been executed against any database.
> This session held no credential that could and attempted nothing.

> **`docs/091-preapply-test.sql` MUST BE RUN AND READ BEFORE 091 IS APPLIED.**
> It is not a formality. 089 and 090 were additive — a column, a function, a
> trigger enforcing an invariant nothing had ever violated — so a dry run
> proving the file parsed was proportionate evidence for those. **091 CAN REFUSE
> A WRITE THAT WORKS TODAY.** A dry run of 091 proves only that it compiles. It
> says nothing about whether the settings page still saves, whether "Switch to
> Vendor Mode" still switches, or whether the admin flags route can still grant
> anybody access. The pre-apply test is the only artifact that answers those.

**The test file was rewritten twice this week and the current mechanism is the
third.** Read §1 before running it, because *the result now arrives as an error
and that is correct.*

## 3. Nothing was widened, anywhere.

No RLS policy was added, altered or relaxed. `middleware.ts` untouched.
`COLLEAGUE_INVITATIONS` and `BROADCAST_CUES_PARTNERSHIP` were neither set nor
flipped nor added to any file. No guard allow-list or `KNOWN_OPEN` count edited.
`supabase/migrations/091_profiles_column_guard.sql` and its down file are
**byte-identical** to where the last session left them — confirmed by
`git diff --stat -- supabase/` being empty across every commit here.

---

# 1. PHASE 1 — the pre-apply test now reports by RAISE EXCEPTION

## Why, and this is the third mechanism

| Attempt | Mechanism | What the Supabase SQL Editor did |
|---|---|---|
| 1 | `RAISE NOTICE` | **No Messages panel. Notices are not rendered at all.** Every assertion ran, every verdict was produced, and the editor said *"Success. No rows returned"*. |
| 2 | temp table + final `SELECT` | **`3F000 schema "pg_temp" does not exist`.** That session has no temp namespace, so a results table cannot exist in it under any spelling — qualified or not. No in-file change can create one. |
| 3 | **`RAISE EXCEPTION`** | An error is the one channel every client displays. |

psql is not available to Greg, so the notice path is not recoverable that way.

## What changed

Removed: the `CREATE TEMP TABLE`, all 44 `INSERT`s, the `count(*)`, and the
final `SELECT`. **Zero references to `_lg091_results` remain.**

Added: `v_lines` accumulates one line per assertion, in the same order and with
the same wording the table rows carried; `v_logged` counts them. The DO block
ends with `RAISE EXCEPTION` carrying the report.

**No custom `ERRCODE`.** The default P0001 is deliberate, so this can never be
mistaken for one of the LG0xx codes 089, 090 and 091 define.

## THE EXPECTED SHAPE OF THE OUTPUT

```
ERROR:  P0001
=====================================================
SAFE TO APPLY 091.  All 11 assertions passed.
=====================================================
assertions run  : 11   (expected 11)
PASS            : 11   (expected 11)
FAIL            : 0    (expected 0)
INCONCLUSIVE    : 0    (expected 0)
verdicts logged : 11   (must equal assertions run: OK)

VERDICT         : SAFE TO APPLY 091.
-----------------------------------------------------
  T1  settings-shaped save        PASS          (1 row written)
  T2  portal switch (active_role) PASS          (1 row written)
  ... nine more ...
=====================================================
This error IS the result. The transaction is rolled back with it.
```

**Order is load-bearing: headline, tally, then the detail.** A client that
truncates a long error truncates the *end*, so the verdict and the counts sit
where they survive and the eleven detail lines are what can afford to be cut.

## The first line, which is the whole point

| First line | Meaning |
|---|---|
| `SAFE TO APPLY 091.` | **Only on an all-PASS run.** |
| `DO NOT APPLY 091.` | An assertion FAILED, **or the test itself is broken.** |
| `DO NOT APPLY 091 YET.` | INCONCLUSIVE. Nothing failed, but the guarded writes were never exercised, so the run says **nothing** about whether the guard bites. **It is not a green light**, and the line says so in those words. |

## Three things that are easy to get wrong

**"Success. No rows returned" now means something went wrong.** It was the
expected message under attempt 1 and it is not any more. The file ends in a
`RAISE`, so a correct run *errors*.

**Telling the report apart from a crash is the whole skill.** An error **with**
the `=====` banner and a tally is the report. An error **without** them is an
assertion that raised outside its handler — which aborts the DO block before it
reaches the report. **That outcome is a failure of the TEST FILE, not a verdict
on 091 in either direction, and 091 must not be applied on it.**

**The self-check now outranks the verdict.** `v_ran` is incremented by the
assertions and `v_logged` by the report sites, independently. If they disagree,
an assertion ran without reporting, the report is incomplete, and **no verdict
drawn from it can be trusted — including a clean one** — so a mismatch overrides
the headline with `DO NOT APPLY`. That is an addition; the existing verdict
condition is untouched.

## The ROLLBACK stays, and the comment no longer overclaims

It is **not reached on the expected path** — the `RAISE` propagates and aborts
the transaction first. It is **not dead code**: it is the safety net for the
case where that exception is *caught* rather than propagated, by an enclosing
handler added later or a client that wraps the batch and swallows the error. In
that case the transaction still holds a `CREATE FUNCTION`, a `CREATE TRIGGER`
and eight `UPDATE`s against real profiles, and this line is the only thing that
undoes them.

## Verified

All **63** `RAISE NOTICE` statements byte-for-byte identical to the previous
commit. The assertion control flow — every `RESET ROLE`, `SET LOCAL ROLE`,
`set_config`, `UPDATE`, `GET DIAGNOSTICS`, `BEGIN`/`EXCEPTION`/`END`, every
`WHEN` clause, every `v_ran` increment — byte-for-byte identical, checked by
diffing those lines rather than assuming. 38 accumulator sites, 38 counter
increments, 11 assertions, 11 handlers. `grep -c` on `^begin;$` / `^commit;$` /
`^rollback;$` is **1 / 0 / 1** and the file still ends on `ROLLBACK`.

---

# 2. PHASE 2 — the surface report is on this branch

**`git cherry-pick 67c2878`**, and it applied cleanly.

**Why cherry-pick rather than writing the file out.** Three facts made it the
right call and all three were checked first:

1. The commit touches **exactly one file** — 882 insertions, no deletions.
2. Its parent is `c9421e7`, which **is this branch's merge-base**, so there was
   nothing unrelated to bring across.
3. Cherry-picking preserves the original authorship, date and commit message.
   Writing the file out from `git show` would have produced the same bytes under
   a new commit that credited this session for an investigation it did not do.

**Contents provably unchanged:** the blob SHA on this branch is
`d8f8ae37373c718927bcfdeccbc1b5e7b568b518`, identical to
`67c2878:docs/091-entitlements-surface.md`.

---

# 3. PHASE 3 — the silent admin write, and two defect classes

## What was wrong

`app/api/admin/grant-agency-access/route.ts:21` wrote `secondary_role` on
**another user's** row through `auth.supabase` — the admin's own **session**
client — and carried a comment saying that was deliberate so the write would be
*"governed by the same profiles policies as the admin panel's other toggles"*.

**Those policies do not grant what that comment assumed.** `profiles` carries
exactly one UPDATE policy, `USING (auth.uid() = id)`, and no admin policy of any
kind. The target row was filtered out by RLS, the statement matched **zero
rows**, PostgREST reported success, and the route returned `{ success: true }`
having written nothing. **An admin granting lead agency access believed it
worked and it did not.**

## The fix

The one `app/api/admin/users/[userId]/flags/route.ts` already made, followed
clause for clause — that route's header cites this exact failure as the reason
its flags moved to the service role, and this route was never moved with them.
Gate with `requireAdminRole()` first, construct the service client only after it
passes, write, and **treat a zero-row result as a 404 rather than a success**.

**Deliberately not an RLS policy.** An "admins can update all profiles" policy
would let any browser session holding an admin's cookie write any column of any
profile on the platform through PostgREST, with no server-side gate in front of
it.

## 091 permit consideration — none needed

**`secondary_role` IS NOT in 091's authority set.** The set is `is_paid`,
`is_admin`, `demo_access`, `email`, `linked_agency_id`, and `secondary_role` was
considered and **deliberately left out** (`docs/091-guard-shape.md` §2), because
`/api/profile/switch-role` **self-grants** `secondary_role = 'partner'` from a
session client as a free self-serve act, on the same column this route uses for
an admin grant of `'agency'`.

So the route leaves 091's guard on its **early return**, and needs no permit and
no exemption. **It would have done so under the session client too** — the
service role changes only *whether the write lands*, not whether the guard
allows it.

**Recorded in the route header for the next reader:** if OPEN-091-2 is ever
resolved by giving the agency grant its own column, **that column is a privilege
column and must join 091's authority set in the migration that creates it.**

## THE INVENTORY — and it is two classes, not one

### CLASS A — identical to the bug just fixed. **Now empty.**

*A session client writing a `profiles` row keyed to someone other than
`auth.uid()`, which the policy makes **structurally impossible** to succeed.*

Every session-client write to `profiles` in the tree was traced to its key:
`auth/callback:88`, both `settings/user` pages, `agency/settings/profile:302`,
`partner/profile:463`, `partner/rfps/[id]:1152`, `partner/legal` ×3,
`api/user/active-role:49`, `api/partner/rate-info` ×3,
`api/partner/rfps/claim:110`, `api/profile` ×2, `switch-role` ×2,
`lib/company-identity:348`.

**All resolve to `auth.uid()`.** The three that look otherwise — `form.id`,
`profileId`, `target` — are each read from a profiles row selected by
`.eq("id", user.id)`, so they equal the caller's id by construction;
`partner/rfps/claim`'s `userId` comes from `auth.getUser()`.

> **After this commit, Class A is empty.** `grant-agency-access` was the last
> one.

### CLASS B — the same *symptom*, a different cause. **Seven candidates.**

*A session client writing a request-keyed row on an RLS-scoped table, where RLS
legitimately filters a cross-tenant write and the route reports success anyway.*

**This is not the same defect** — there RLS is a *scope*, here it was a *wall* —
but it fails identically from the caller's side. 25 sites found. **18 are
guarded**: 17 by `.single()`, which raises PGRST116 on zero rows, and
`documents/delete:36` by an ownership pre-check read directly.

**The seven that remain, with what they intend to write:**

| File:line | Table | Intends to write |
|---|---|---|
| `app/api/agency/bids/[responseId]/evaluation/route.ts:385` | `partner_rfp_responses` | an evaluation result back onto a bid response |
| `app/api/agency/library-documents/[id]/route.ts:62` | `agency_library_documents` | a document update (org-scoped by `.eq("org_id", …)`) |
| `app/api/partner/rfps/[id]/response/route.ts:331` | `partner_rfp_inbox` | inbox state after a bid submission |
| `app/api/partner/rfps/[id]/route.ts:71` | `partner_rfp_inbox` | the `viewed_at` first-view stamp |
| `app/api/partner/rfps/[id]/nda-notify/route.ts:116` | `partner_rfp_inbox` | `agency_nda_notified_at` |
| `app/api/partnerships/route.ts:1355` | `partnerships` | a partnership state change |
| `app/api/documents/delete/route.ts:36` | `project_documents` | a document delete — **guarded by an ownership pre-check, read and confirmed** |

> **THESE ARE CANDIDATES REQUIRING A PER-SITE READ, NOT CONFIRMED DEFECTS.** An
> ownership pre-check earlier in the handler makes the zero-row case
> unreachable, and no grep can see that. Two of the seven were read directly and
> both were fine. **Not fixed in this phase, per the brief.**

---

# 4. PHASE 4 — the flag scope correction

**Comment change only.** The flag was not set, flipped, or added anywhere, and
no env file was touched or read. Only the variable *name* was searched for.

## Scope

The header said to set the variable in Vercel for **"Production and Preview"**.
That was safe when written and is now dangerous, because two facts became true
together on **2026-08-20**:

1. **Branches now build Vercel preview deployments** — any pushed branch gets a
   live, publicly reachable URL running that branch's code.
2. **`SUPABASE_SERVICE_ROLE_KEY` is scoped to Preview** — so a preview
   deployment holds a credential that **bypasses row level security entirely
   against the LIVE PRODUCTION DATABASE.** There is no separate preview
   database.

Together, a Preview-scoped flag means the invitation surface goes live against
production data **from every pushed branch**: work in progress, branches whose
migration has not been applied, branches nobody is watching.
`accept_org_invitation()` writes `org_members` rows, **those rows are real and
permanent, and unsetting the flag afterwards removes not one of them.**

Now reads **PRODUCTION SCOPE ONLY**, never Preview, never Development — and
names **"All Environments"** explicitly, because it is the Vercel default and is
the same mistake with a friendlier name.

## Sequencing — there are now five steps, not four

The order block said 090 then flip. **090 alone is no longer sufficient**, and
the comment implied it was.

090 fixed **which organization a colleague WRITES to**. It did nothing about
**which organization is ENTITLED**, and those are different questions.
`hasAgencyEntitlement()` reads `profiles.is_paid` **on the caller's own row**, so
a colleague of a paying company carries no such flag and meets *"Active
subscription required"* at `projects/route.ts:552` — and, through
`paid-user-context.tsx` and `AgencySubscriptionGate`, **a full-page restriction
notice over the entire agency portal.**

> Flipping the flag after step 3 produces a colleague who **writes to the right
> organization and is refused by every paid gate** — a different broken state
> from the one 090 fixed, not the absence of one.

**Step 4 is an entitlements migration**, designed both ways in
`docs/092-entitlements-design.md` and **blocked on a product ruling Greg has not
made**. It is not authored, so the step cannot be taken yet. The comment also
records that **091 is a prerequisite of that work rather than a substitute for
it**, and that 091 is authored and not applied.

## One thing found and deliberately not changed

**`BROADCAST_CUES_PARTNERSHIP` carries the identical "(Production and Preview)"
line at `lib/feature-flags.ts:27`** and has the identical exposure — a Preview
deployment runs it against production with the service role. It was left alone
because the brief scoped this phase to `COLLEAGUE_INVITATIONS` and it is a
different flag with a different blast radius. **It is worth the same correction
and it is not made here.**

---

# 5. PHASE 5 — emitter coverage, measured

Full detail in **`docs/emitter-coverage.md`**. The headline:

| | Before | After |
|---|---|---|
| **Vendor-visible types with an emitter** | **21 of 23** | **23 of 23** |
| Whole vocabulary with an emitter | 21 of 42 | **24 of 42** |
| Whole vocabulary with a renderer | 28 of 42 | 28 of 42 |

**The figure carried in — "17 of 23 with four added, so roughly 21" — was right
about the count.** It was silent about *which* two were missing, and that was
the part that mattered: **both gaps were vendor-visible, both were already
whitelisted to be written by a vendor, and both already had a feed renderer.**
Nobody had wired them up.

## THE DISCRIMINATOR — why only three were implemented

`mapMilestoneGroup()` (`lib/activity-feed.ts:435`) returns **`null`** when the
event type has no predicate:

```ts
const build = MILESTONE_PREDICATES[row.event_type]
if (!build) { ctx.onUnknownEventType?.(row.event_type); return null }
```

> **A row whose event type has no renderer is DROPPED FROM THE FEED ENTIRELY.**
> Written, stored, readable by policy, and visible nowhere.

So "write the emitter" is only half the work for any type without a predicate.
The other half is deciding **what the line says** — a copy decision in a product
whose stated rule is *professional, direct, warm*. **Eighteen feed lines written
by an agent overnight is not how a product acquires a voice.** That is the line
this survey drew: a gap with a renderer was implemented; a gap without one is
reported.

## Implemented — three, all blocked by nothing, nothing widened

| Type | Site | Note |
|---|---|---|
| **`rfp.view`** | `app/api/partner/rfps/[id]/route.ts:83` | **First view only.** The emit sits inside `if (updatedInbox)`, and the UPDATE above carries `.is("viewed_at", null)`, so it matches once per row. A reload emits nothing; outside that branch it would be **one feed line per page load**. |
| **`nda.acknowledge`** | `app/api/partner/rfps/[id]/nda-notify/route.ts:120` | Fires after the agency email and the stamp, both already succeeded, so a lost breadcrumb cannot turn a completed notification into an error. Subject is the **inbox row**, not the partnership. |
| **`project.create`** | `app/api/projects/route.ts:634` | The **one** agency-side type with a renderer and no emitter. Correctly **not** vendor-visible: a vendor has no business seeing a project exists before being invited to bid on it. |

## The eighteen remaining — and not one is blocked by a policy

080's agency INSERT policy asks only that `org_id` is one of the caller's
organizations, which every one of those routes already resolves. **They are
blocked by the feed having nothing to say about them.**

**Six also need a ruling**, each one question, stated in full in the coverage
doc: whether removing or blacklisting a vendor leaves a trace the counterparty
can read; whether every client edit deserves a line; whether an AI generation is
a milestone at all or only the broadcast that follows it; and the same question
for bid analysis.

## THE KNOWN RESIDUAL — reported, not fixed, and now worse

088's vendor INSERT policy requires `partnership_id IS NOT NULL`, **and that
clause is not incidental** — it is what makes the `EXISTS` reachable, and 088's
own header calls that `EXISTS` *"the clause that matters most"*, because without
it a vendor could write a composed feed line onto an arbitrary agency's
dashboard. **It cannot simply be dropped.**

A vendor invited by magic link has no `partnerships` row. The fallback lookup
finds nothing, the INSERT is refused by RLS, and `recordMilestone()` swallows it
— **the route succeeds and the breadcrumb is silently lost.** That collides with
the ruling that **a vendor may bid without a partnership**.

> **It used to cost `bid.submit`, `bid.revise` and `status_update.post`. It now
> also costs the two emitters added today** — and that is worse than it sounds,
> because `rfp.view` and `nda.acknowledge` fire **earliest** in the vendor's
> journey, when a partnership is least likely to exist. **The agency loses the
> breadcrumbs for exactly the vendors it knows least about.**

**The ruling Greg owes:** *should a vendor with no partnership be able to write
a breadcrumb onto the agency's feed at all — and if so, what pins `org_id` in
place of the partnership row?*

---

# 6. GATES — six run once, against the 091 report's final numbers

| Gate | 091 report, Phase 0 | 091 report, final | **This session** | Movement |
|---|---|---|---|---|
| `npx tsc --noEmit` | 0 | 0 | **0** | none |
| `pnpm build` | 0, 202 lines | 0, 202 lines | **0, 202 lines** | **none — route table byte-identical** |
| `pnpm lint` | 1, **182 (154 err, 28 warn)** | 1, 182 | **1, 182 (154 err, 28 warn)** | none |
| `pnpm identity-columns:guard` | 0, 381 files, TOTAL 0 | 0, 381, TOTAL 0 | **0, 381, TOTAL 0** | none |
| `pnpm embed-targets` | 0, 381 files, REPOINTED 0 | 0, 381, REPOINTED 0 | **0, 381, REPOINTED 0** | none |
| `pnpm org-id-reads:guard` | 0, 380, A OPEN 14 / B OPEN **61**, IMPROVED 0/**0** | 0, 380, B OPEN **60**, IMPROVED 0/**1** | **0, 380, A OPEN 14 / B OPEN 60, IMPROVED 0/1, REGRESSIONS 0** | **none** |

`verify-rls` and `policy-audit:guard` were **not run**, per the brief: both are
environmental and read no `.ts` or `.sql` file this session touched.

## Every movement, explained

**There is no movement.** Every one of the six matches the 091 report's final
column exactly.

**The one number that differs from the Phase 0 baseline** — class B `OPEN`
61 → 60 with `IMPROVED` 0 → 1, `lib/entitlements.ts recorded 1, found 0` — is
**the same one the 091 report already explained**, carried forward unchanged. It
was caused by that session's Phase 3, when `agencyEntitlementId()` stopped
issuing its own `org_members` read and began delegating to
`resolveActingOrgId()`. **It is not new and nothing this session did moved it.**
`REGRESSIONS` is 0.

> **The count was not lowered.** `KNOWN_OPEN_MIRROR` still records 1 for
> `lib/entitlements.ts`. Editing a guard allow-list is prohibited, and the gate
> passes at exit 0 either way — `IMPROVED` is informational, only `REGRESSIONS`
> fails it. `git diff --stat main..HEAD -- scripts/` is **empty**.

**File counts did not move** (381 / 381 / 380), and that is correct: this
session added **no** `.ts` or `.tsx` file. Six existing TypeScript files were
edited and three new files are `.md`. No guard scans `docs/` or
`supabase/migrations/`.

**Nothing was reworded to satisfy a guard. No exemption was added.**

---

# 7. THE APPLY ORDER FOR 091

**091 is independent of every deploy, in both directions.** It adds no column,
so nothing can 42703; it changes no function any route calls; it changes no
policy. There is no "migration first, then push" constraint the way 090 had one.

```
STEP 1.  Run docs/091-preapply-test.sql. One paste, run ONCE as one batch.
         THE RESULT ARRIVES AS AN ERROR - that is expected and correct.
         Read the FIRST LINE of the error message.
         Only "SAFE TO APPLY 091." authorises step 2.

STEP 2.  Dry run supabase/migrations/091_profiles_column_guard.sql.
         Change the COMMIT; on LINE 545 to ROLLBACK;. Run the whole file.
         Confirm no errors. PUT THE COMMIT BACK.

STEP 3.  Run 091_profiles_column_guard.sql for real.

STEP 4.  Run the VERIFICATION block, V1 through V7. It sits AFTER the COMMIT
         and is entirely commented out, so step 2 executed none of it.

STEP 5.  Update the migrations table in LIGAMENT_CONTEXT.md, adding the
         authority set to that row. NOT DONE HERE: that table records applies.

STEP 6.  Push this branch whenever you like. Order does not matter.
```

**Rollback:** `supabase/migrations/091_profiles_column_guard_down.sql`, `BEGIN;`
on line 98, `COMMIT;` on line 108. It destroys no data. **Roll back only if 091
is breaking a legitimate write, not as tidying** — and capture *which writer and
which column* first, because that fact is a one-line fix to the authority set
rather than a reason to remove the guard.

> **"Success. No rows returned" in the SQL Editor is identical for a dry run
> that rolled everything back, for a real apply that committed, and for a
> correct file pasted into the wrong project's tab.** The verification block is
> the only thing that distinguishes them. And for the pre-apply test it now
> means the run did not work at all.

---

# 8. EXECUTED / READ / REASONED

## EXECUTED

`git rev-parse`, `git status`, `git log`, `git show --stat`, `git cherry-pick
67c2878`, `git diff` and `git rev-parse` on blob SHAs; **the six code-reading
gates, once each, at the end**; `npx tsc --noEmit` and `pnpm lint` after every
code edit; two `pnpm build` runs whose route tables were diffed against the 091
baseline; roughly thirty `grep`/`sed`/`cat` passes; four throwaway Node scanners
in the session scratchpad (a write-shape scanner over identity tables, a
request-keyed-write scanner, and two zero-row-guard classifiers), **none
committed**.

**Every count here came off one of those and can be re-run:** 63 RAISE NOTICE
statements, 38 report sites, 11 assertions, 25 Class B sites of which 18 are
guarded, 42 event types in the vocabulary, 21 emitted before and 24 after, 28
renderers, 23 on the vendor-visible whitelist, 7 on the vendor-emittable one.

## READ

**In full:** `docs/091-preapply-test.sql`; `app/api/admin/grant-agency-access/route.ts`;
`app/api/admin/users/[userId]/flags/route.ts`; `lib/feature-flags.ts`'s
`COLLEAGUE_INVITATIONS` block; `app/api/partner/rfps/[id]/nda-notify/route.ts`;
`app/api/partner/rfps/[id]/route.ts` GET; the emitter template at
`app/api/partner/rfps/[id]/response/route.ts:493-528`; `docs/capabilities.md`
section 5; `app/api/agency/clients/[id]/route.ts` and
`app/api/documents/delete/route.ts` (the two Class B calibration reads).

**In part:** `lib/milestone-events.ts` (`MilestoneEvent`, `toRow`,
`recordMilestone`); `lib/activity-feed.ts` (`MILESTONE_PREDICATES`,
`UNION_REPLACING_EVENT_TYPES`, `mapMilestoneGroup`, `milestoneDedupeKey`);
`supabase/migrations/080_milestone_events.sql`;
`supabase/migrations/088_vendor_milestone_events.sql`;
`app/api/projects/route.ts` POST; `app/api/partner/rfps/claim/route.ts`;
`app/partner/legal/page.tsx`, `app/partner/profile/page.tsx` and
`app/agency/settings/profile/page.tsx` (to trace `profileId` / `form.id`).

## REASONED — and therefore unverified against any live database

- **That the three new emitters actually insert a row.** No statement was
  executed against any database. Each was checked against the policy text clause
  by clause and each follows an emitter already live in the same file family,
  **but the first real proof is the first real run.**
- **That the fixed `grant-agency-access` now writes.** The zero-row claim
  follows from the policy text, not from a live write.
- **That the pre-apply test's `RAISE EXCEPTION` renders in the editor.** It is
  the third mechanism tried and the first two were disproved by real runs. This
  one is reasoned from "every client displays an error" and has not itself been
  run.
- **Class A being empty.** It is empty against the census, which is complete
  against this working tree. A writer outside the scanned roots — a psql
  session, a dashboard edit, an external script — is outside what a grep sees.

## NOT DONE

**No migration applied, authored or edited.** `091_profiles_column_guard.sql`
and its down file are byte-identical to where they were. No database queried,
read or written. **No RLS policy widened.** `middleware.ts` untouched. No
feature flag set, flipped or added to any env file, and no env file read. **No
guard allow-list or `KNOWN_OPEN` count edited.** The budget spine untouched. No
feed renderer written and none of the eighteen unrendered event types
implemented. `LIGAMENT_CONTEXT.md` not updated — that table records applies, and
091 has not been applied. **No push, no merge, no PR.**

---

# 9. THE FIVE COMMITS

| | |
|---|---|
| `7291882` | **Phase 1** — the pre-apply test reports by RAISE EXCEPTION |
| `9ed3b93` | **Phase 2** — the 091 entitlements surface, cherry-picked from `67c2878` |
| `bb95c36` | **Phase 3** — grant-agency-access wrote nothing and reported success |
| `1feda46` | **Phase 4** — COLLEAGUE_INVITATIONS is PRODUCTION SCOPE ONLY |
| `ecaec2a` | **Phase 5** — three milestone emitters and the coverage survey |

**Run `docs/091-preapply-test.sql` before applying 091. The result is an error.
Read its first line.**
