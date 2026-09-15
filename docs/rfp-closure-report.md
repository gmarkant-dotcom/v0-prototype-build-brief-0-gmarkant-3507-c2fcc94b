> # MERGED TO `main`. THIS REPORT'S OWN HEADER SAYS IT IS NOT. Do not re-open anything below as unshipped.
>
> **Added 2026-09-15** by the `feat/engagements-one-source` run. The header sentence
> ("Six commits, nothing pushed, nothing merged.") was true the moment it was written and is false now.
>
> **How this was verified:** `git merge-base --is-ancestor <sha> main` was EXECUTED for every
> commit this report names. All of them returned 0. No document was taken at its word, this
> one included.
>
> **Commits, all on `main`:** `014e783`, `f177a2f`, `d782dd1`, `0f13335`, `900f235`, `c6612c4`
>
> Phase 2's row says migration 099 is **"Authored, not applied."** That row is ALSO stale: 099 is
> inside the applied 079-099 band. The code merging and the migration applying are two separate
> facts and this banner asserts only the first; the 099 correction rests on the run brief's
> statement, which is Greg's own and is not re-derivable from this repository.
>
> **THIS IS THE PROJECT'S MOST EXPENSIVE DOCUMENTATION TRAP, AND IT IS IN EIGHT FILES AT ONCE.**
> Every run report here opens by declaring its own branch unmerged, because that is the truthful
> thing to write while the branch is open, and nothing revisits the sentence when the branch
> lands. A later session reading it concludes the work is still on a branch and either redoes it
> or leaves a shipped defect marked open. The previous run named this pattern
> (`docs/pool-counts-and-payments-report.md` section 3d, "when a fix commits, the report that
> says 'uncommitted' is what strands the diagnosis") and did not sweep for it. This run did.
> The full list is in `docs/engagements-and-counts-report.md` section 1.
>
> **What this banner does NOT say.** It says the code merged. It says nothing about migrations.
> Migration 100 remains **AUTHORED AND NOT APPLIED**, and any section below describing an
> unapplied migration is still accurate.

# RFP closure: the run report

Branch `feat/rfp-closure`, cut from `8976955` on main. **Six commits, nothing pushed,
nothing merged, and no SQL was run against any database.** This session had no working
credentials and did not seek any.

| Phase | Commit | What |
|---|---|---|
| 0 | `014e783` | Baseline. `docs/099-phase0-baseline.md`. Read only. |
| 1 | `f177a2f` | Queue order, overdue payments block, defaulted deadline. |
| 2 | `d782dd1` | Migration 099 + down + pre-apply test. **Authored, not applied.** |
| 3 | `0f13335` | Close an RFP, decline one vendor. Server-verified ownership. |
| 4 | `900f235` | Closure notifications, email and in-app. |
| 5 | `c6612c4` | The vendor closed-requests surface. |

---

## 1. THE GATES. EXACT EXIT CODES, ALL EXECUTED.

On `feat/rfp-closure` at `c6612c4`:

| Command | Exit | Measured |
|---|---|---|
| `npx tsc --noEmit` | **0** | zero diagnostic lines |
| `pnpm build` | **0** | compiled in 8.4s, 72/72 static pages, 175 route lines (174 at baseline, +1 for `/api/agency/rfp-closure`) |
| `pnpm lint` | **1** | **182 problems (154 errors, 28 warnings)** |
| `pnpm identity-columns:guard` | **0** | GUARD PASSED |
| `pnpm org-id-reads:guard` | **0** | class A 14 / class B 60, no growth, GUARD PASSED |
| `pnpm embed-targets --guard` | **0** | REPOINTED 0, PERSON 0, TOTAL 0 |
| `pnpm policy-audit:guard` | **1** | pre-existing |
| `pnpm verify-rls` | **2** | pre-existing |

### The three known failures, CONFIRMED ON MAIN rather than asserted

A throwaway worktree was created at `main` (`8976955`), the three commands were run in it
directly against the same `node_modules`, and it was removed afterwards. `git worktree
list` now shows only the primary tree.

| On main | Exit | Measured |
|---|---|---|
| `eslint .` (what `pnpm lint` runs) | **1** | **182 problems (154 errors, 28 warnings)** |
| `node scripts/audit-policy-snapshot.mjs --guard` | **1** | reads a static snapshot |
| `node scripts/verify-rls.mjs` | **2** | `pg_class query error: Could not find the table 'public.pg_class' in the schema cache` |

**The lint number is identical on both sides: 182 / 154 / 28.** This run added no lint
finding and fixed none.

`pnpm` itself refuses to run a script in that worktree (it does a lockfile/deps-status
check against a symlinked `node_modules` and exits before the script). The underlying
binaries were invoked directly instead, which is what the `package.json` scripts resolve to.
That is a difference in how they were launched and not in what was measured.

---

## 2. PHASE BY PHASE

### Phase 0. `docs/099-phase0-baseline.md`

Seven answers, plus one finding nobody asked for that changed Phase 3. Section 10 of that
file is the one to read: **there is no lead-agency UPDATE policy on `partner_rfp_inbox`.**
Two consequences, both load-bearing here and both detailed in section 6 below.

### Phase 1. Three fixes, no migration, no ruling depends on them.

**R4.** `app/api/partner/dashboard/route.ts` gains `.order("created_at", {ascending:
false})` on the inbox read, which had no `ORDER BY` at all.

**AND THE JS COMPARATOR IS REMOVED, WHICH IS A JUDGMENT CALL AND IS FLAGGED AS ONE.** The
brief's 1a says "in SQL, in the dashboard route, not in the component", and that comparator
was in the route, not the component - so a narrow reading would have left it. R4 itself
says "created_at DESC in SQL, **unconditionally**", and the comparator sorted
deadline-ascending-nulls-last. It was a guaranteed no-op only because every deadline was
null. **R1 ships in the same commit and ends that**, at which point the order would have
become "created_at DESC, except when deadlines exist". That is the conditional R4's own
wording rules out, and leaving both in would have shipped a self-contradiction inside one
commit. **If Greg wanted deadline-ascending to wake up once R1 landed, this is the one line
to put back**, at `app/api/partner/dashboard/route.ts` where the comment now sits.

**R5.** Overdue milestones leave `queueRows` and the `QueueRow` union entirely and get
their own block.

- Heading: **"Overdue payments (N)"**
- Empty state: **"No payments are overdue. Milestones that pass their due date without
  being paid will appear here."**
- It renders even when empty. The all-clear is worth saying about money, and a section that
  only exists when it has bad news in it is one no vendor learns the location of.
- Gated on `paymentsLoading`, so it can never show the empty state mid-fetch.
- `showEmptyState` gained `!paymentsLoading && overdueMilestones.length === 0`. That screen
  replaces the whole dashboard, so a condition it omits is a section it can hide: an unpaid
  milestone on an ended project would have shown a vendor "Welcome to Ligament" while they
  were owed money.
- The header count and the empty-state condition now test the same set and cannot disagree.

**R1.** `lib/rfp-response-deadline.ts`, one constant,
`RFP_RESPONSE_DEADLINE_DEFAULT_DAYS = 14`.

**THE REASONING FOR FOURTEEN.** `app/partner/page.tsx`'s `queueIsUrgent` already treats
`daysLeft <= 7` as urgent and **has never once fired on a deadline**, because `daysLeft` is
null for every row without one. At fourteen days a defaulted RFP spends its first week
ordinary and its second week urgent, which is exactly the two-state signal that predicate
was written to give. Seven would make every RFP urgent from the moment it is sent, and a
queue where everything is urgent has no priority at all. Thirty is longer than the work it
describes, and a vendor does not read a date a month out as a deadline. Fourteen is also
long enough to price production work with subcontractors in it, which seven is not.

Wired into all three sites 0f named: the wizard's initial value (lazy, so a long-lived tab
does not keep offering a date computed at page load) and **both** route fallbacks, each of
which independently wrote `null`.

Helper text changed from *"Optional. If set, partners will see..."* to *"Defaults to two
weeks from today. Change it or clear it if you need to. Vendors see "Respond by" in their
inbox and RFP detail view, and a request with no date has nothing to sort or chase it by."*

**ONE INTENDED BEHAVIOUR CHANGE, magic-link only.** That route's upsert writes
`response_deadline` unconditionally, so a resend that omitted the field used to **wipe** the
deadline. It now sets a fresh horizon. A resend is a fresh ask, and it is unambiguously
better than the null it replaces.

### Phase 2. Migration 099. AUTHORED ONLY. NOT APPLIED.

> ### `supabase/migrations/099_rfp_closure.sql`
> ### **BEGIN; is on LINE 507. COMMIT; is on LINE 841.**
>
> Those two are the only executable lines in the file beginning with either word. Every
> other hit under `grep -n 'BEGIN;'` / `grep -n 'COMMIT;'` is prefixed with `--`: the header
> quoting itself, and the commented probes in the VERIFICATION block.
>
> ### `supabase/migrations/099_rfp_closure_down.sql`
> ### **BEGIN; is on LINE 147. COMMIT; is on LINE 295.**

Contents, and the argument for each:

1. **`partner_rfp_inbox_status_check` widened 9 to 11**, adding `closed` and `not_selected`.
2. **`notifications_type_check` widened 11 to 13**, adding `rfp_closed` and
   `rfp_not_selected`. The convention 095 established is `<subject>_<outcome>`, subject
   first and singular, the subject being the domain noun the event happened to. `rfp` is a
   new subject and the correct one: neither event is about a bid (there is none), a
   partnership, or a project.
3. **ONE new column, `closed_at timestamptz NULL`.**
   - `updated_at` cannot serve. It moves on `viewed_at`, the NDA confirmation, the
     magic-link self-heal and the bid status sync, so a history surface reading it would
     show an unrelated date and call it the closure date.
   - **`closed_by` NOT ADDED.** Migration 080's header already ruled: *"attribution belongs
     in M1, scoped to milestones rather than a created_by column on every table."*
     `grep -rn "created_by" app lib supabase scripts` returns two hits and both are that
     sentence; `owner_id` returns nothing repository-wide. Adding it here would be the
     first per-table actor column in the schema and would overturn a standing decision
     inside a feature migration. If Greg wants closure attributed it goes on
     `milestone_events`, which already has `actor_id`.
   - **`closed_unit` NOT ADDED.** It would hold `'rfp'` on exactly the rows whose status is
     `closed` and `'vendor'` on exactly the rows whose status is `not_selected`. A
     derivable column is a second place for one fact to disagree with itself.
   - **No reopen column.** Reopen is out of scope (see 3f below). If it is ever built it
     needs none: `status` back to `new` and `closed_at` back to `NULL` already express it.
4. **One helper function**, `partner_rfp_inbox_status_before(uuid)`, `STABLE SECURITY
   DEFINER`. It exists only because a WITH CHECK predicate cannot see `OLD`. Section 6.
5. **Two policy changes**, argued in full in section 6.

Plus a 7-query **PRE-FLIGHT CAPTURE** (the file was authored from an on-disk history that
`LIGAMENT_CONTEXT.md` says cannot reproduce this database) and a 10-query **VERIFICATION**
block with every expected value stated.

`supabase/migrations/099_preapply_test.sql`, **27 assertions**, one paste, ends in
`ROLLBACK`. **The ones that matter are called out by name in the file's own header:**

- **T7a to T7j. A VENDOR CANNOT SET ANY AGENCY-OWNED STATUS.** Ten assertions, **one per
  excluded status**, not one covering all of them - because the ten are not equivalent.
  `awarded` leaking means a vendor can mark themselves the winner; `new` leaking means they
  can **un-close** a closed request; `closed` leaking means they can close it. Each names
  itself in the report.
- **T14. A VENDOR CANNOT REASSIGN `vendor_org_id`** to an organization they do not belong to.
- **T10. AN AGENCY CANNOT CLOSE ANOTHER AGENCY'S ROW.**

**And the four counterweights, which matter as much.** A policy that refuses everything
passes all ten refusal assertions and takes the vendor portal down for every user:

- **T8.** The vendor **can** still stamp `viewed_at` on a row sitting at `awarded`. This is
  the load-bearing case for clause (C)'s unchanged arm, and it parks the row at `awarded` as
  the owner first so it measures the case that actually breaks.
- **T8b.** The vendor **can** still set `bid_submitted`.
- **T8c.** But **not** from a `closed` row. A closed request cannot be bid back open.
- **T15.** The vendor **can** still claim an invitation by writing their own org id. It
  unclaims the row as the owner first, so it is not just re-writing the value already there.

T7k records that `under_review` is refused by the **constraint**, not the policy. T9 proves
the agency can close its own row, which before section 4a would have silently matched zero
rows.

### Phase 3. The two actions.

`POST /api/agency/rfp-closure`, one route, two units.

**3a. Which statuses are affected.** An **allow-list**, `lib/rfp-closure.ts`:

- **TOUCHED:** `new`, `viewed`.
- **LEFT ALONE:** `bid_submitted`, `revision_submitted`, `feedback_received`,
  `shortlisted`, `meeting_requested`, `awarded`, `declined`, and `closed` / `not_selected`
  themselves.

A submitted bid is not an unanswered request. An allow-list and not a deny-list because the
cost of forgetting to extend a deny-list is that a closure silently eats a status it should
never have touched; the cost of forgetting to extend an allow-list is that it declines to
act, which is visible and harmless.

**3b.** `unit: "vendor"` writes `not_selected` on one row by id. Every other vendor on that
RFP is untouched.

**3c. The security requirement.** Detailed in section 6.

**3d. Idempotent.** The allow-list is part of the `UPDATE` statement, not a read-then-write,
so two concurrent requests cannot both pass a check and both notify. Re-closing returns 200
with `closed: 0`. A zero count is reported and never treated as an error.

**3e. The surface.** `/agency/bids`, found rather than invented. That page already shows
every vendor who was sent an RFP and has not bid, as a synthetic `awaiting_response` row
built at `app/api/agency/rfp-responses/route.ts:442-467`. Both actions sit in that row's
existing `MoreVertical` dropdown.

**The confirmation, verbatim.** Close:

> **Close this RFP?**
> This closes [scope] for every vendor who has not bid. Each of them gets an email and a
> notification saying the opportunity has ended, and the request moves out of their response
> queue into their history.
> Vendors who already submitted a bid are not affected. Their bids stay exactly where they
> are and you can still award, shortlist or decline them.
> **This cannot be undone. There is no reopen, and the email cannot be unsent.**

Not selected:

> **Tell [vendor] they were not selected?**
> This tells [vendor] they were not selected for [scope]. They get an email and a
> notification, and the request moves out of their response queue into their history.
> Every other vendor on this RFP stays open and can still bid.
> **This cannot be undone. There is no reopen, and the email cannot be unsent.**

It names four separate consequences an agency can get wrong: who it reaches, what it does
not touch, that an email goes out, and that it is final.

**3f. REOPENING IS NOT BUILT, AND THIS IS THE EXPLICIT STATEMENT OF THAT.**

It is out of scope for this run. The reasoning, so the decision can be revisited on its
merits rather than re-derived:

- Closure sends an email that cannot be unsent. A reopen would leave the vendor holding a
  message that says the request ended, next to a portal that says it is open. The undo is
  therefore not an undo; it is a second, different event that needs its own notification.
- If reopen must not re-notify (the brief's own condition), then it is silent by
  construction, and a request that reappears silently is a request the vendor never learns
  has reappeared. That is the same defect R7 exists to close, pointed the other way.
- The honest alternative is a reopen that DOES notify, which is a third message needing its
  own copy, its own notification type and its own constraint widening. That is a phase, not
  a checkbox.

**The confirmation copy says so before the agency clicks**, which is what the brief asked
for in the absence of the feature.

### Phase 4. The notifications.

Two new types on `NotificationType`. Both drafts live side by side in
`lib/rfp-closure-copy.ts` so nobody edits one without seeing the other.

**CLOSED.** Subject: *"[Agency] has closed the RFP for [Scope]"*. Title: *"This RFP has
closed"*.

> [Agency] has closed the RFP for "[Scope]". It is no longer taking bids, so there is
> nothing further for you to do on it.
>
> **This is not a decision about your company. The request ended for everyone who was
> invited to it.**
>
> It stays in your history on Ligament, so you keep the record that it was sent to you.

**NOT SELECTED.** Subject: *"Update on [Scope] from [Agency]"*. Title: *"You were not
selected for this scope"*.

> [Agency] has decided not to move forward with your company on "[Scope]", and is no longer
> expecting a response from you on it.
>
> **This is about this one request. It does not change your relationship with [Agency] or
> any other request they send you.**
>
> It stays in your history on Ligament, so you keep the record that it was sent to you.

The bolded paragraph in each is the load-bearing one, and they do opposite work. The first
bounds the **fact**: a vendor reading "closed" with nothing else to go on assumes it was
about them, and acts on that reading in a relationship where nothing went wrong. The second
does not bound the fact, because this one **is** about them and pretending otherwise would
be worse; it bounds the **blast radius** instead.

The not-selected subject deliberately omits "not selected". An inbox preview line is public
to whoever is standing behind the reader. This is the phrasing the existing bid decline mail
already uses.

**Neither says "declined" or "rejected", in any casing, and neither invents a reason.**
`declined` in this product means a vendor who submitted a bid and lost. Every recipient of
these two emails never bid.

**The preference toggle is respected, not bypassed.** Recipients resolve through
`resolveOrgNotificationRecipients` first, which skips any profile whose
`notification_preferences.email` is exactly `false` (`lib/email.ts:449`). `recipient_email`
is the fallback, not the first branch, even though it is simpler. See section 5 for the one
case where the preference cannot be checked and the ruling that covers it.

### Phase 5. The vendor surface.

Attempted because phases 0 to 4 went cleanly, capacity remained, and **0d established that
without it phases 3 and 4 make the product worse**: a closed row still sat in "Needs your
response" and still rendered in Open RFPs badged "New", so a vendor would have had an email
saying the request ended beside a portal saying it was brand new.

0d found no surface that could carry these rows, and the component said so itself at
`components/partner-rfp-surface.tsx:582-583`. So this builds the smallest one that satisfies
R7: **a two-entry tab strip on stage 01, `/partner/rfps`: Open | Closed.**

Not on `/partner/bids` beside History. History answers "did I win", which is a question
about a bid and reads `partner_rfp_responses`. This answers "what happened to the requests I
never answered", which is about `partner_rfp_inbox`, and the rows have no response row at
all. Same entity, same page, same fetch, no new nav item, 1:1 mirror untouched.

R7's three requirements:

1. **Never in "Needs your response".** `app/api/partner/dashboard/route.ts` skips closure
   statuses before the `RESPONDED_STATUSES` test. **Not folded into that set** - it means
   "the vendor already responded" and these vendors did not; adding them would make the
   set's name a lie and would quietly change what `expiredCount` and the funnel count. This
   also fixes the "Open RFPs" tile, which is `needsResponse.length`.
2. **Visibly distinct from a bid the vendor submitted and lost.** A separate
   `ClosedRfpCard`, not an `RFPCard` with a badge. It drops "Due" (a deadline on something
   that is over is a false instruction) and says in words which of the two things happened.
   A lost bid is still a `BidRow`, on a different page.
3. **Which agency, which RFP, when it closed.** All three on every card, unconditionally.
   The date falls back to "Date not recorded" rather than being hidden: rows closed before
   migration 099 cannot carry a `closed_at`, and silently omitting it would look like the
   record was incomplete rather than like the column was younger than the row.

Plus a banner on the vendor's RFP detail page. The bid form already vanished on a closed row
(the `canEdit` allow-lists fail closed) and that was **silent**: a vendor arriving from the
Closed tab found a page with no form and no explanation, which reads as a fault rather than
a state.

---

## 3. THE FULL 0b LIST, WITH ITS RESOLUTION

Phase 0 enumerated twelve sites that switch, filter, map or label on
`partner_rfp_inbox.status`. **Nine fell through silently and two of them rendered a closed
RFP as "New".** Every one is now closed.

| # | Site | Was | RESOLVED |
|---|---|---|---|
| 1 | `app/api/partner/dashboard/route.ts:20-30`, `:243-244` | Not in `RESPONDED_STATUSES`, so the row **stayed in "Needs your response"** | **Phase 5.** Explicit `if (isRfpClosureStatus(row.status)) continue` before the responded test. Also fixes the `openRfps` tile. |
| 2 | `components/partner-rfp-surface.tsx` `badge()` | `?? STATUS_BADGE.new` rendered the pill **"New"** to the vendor | **Phase 5.** `STATUS_BADGE` entries for both, gray and orange, never `declined`'s red. |
| 3 | same file, `normaliseForTab()` | Cast `'closed'` to `RFPStatusKey`, a lie `tsc` cannot catch; counted into a tab nobody can select | **Phase 5.** Closed rows are partitioned out before this function is reached. The cast is now unreachable for these values. **It is still there and still a cast** - see section 4. |
| 4 | same file, the `groupBy === "status"` label | Group heading read **"New"** | **Phase 5.** Same partition. |
| 5 | `app/api/partner/rfps/route.ts:332-339` | No status filter; row returned and rendered in Open RFPs | **Phase 5.** Still no server filter, by design - the route feeds both views and the closed rows are the second one's data. Routed at the component. |
| 6 | `app/api/agency/rfp-responses/route.ts:442-467` | Hardcoded `status: "awaiting_response"`, never read `i.status`; the agency saw **"New"** on its own action | **Phase 3.** Carries the two closure statuses through. Only those two - the rest of the agency badge vocabulary is the RESPONSE vocabulary. |
| 7 | `lib/bid-shared.ts:116-118` `statusBadge()` | `?? STATUS_BADGE.awaiting_response`, **"New"** | **Phase 3.** Entries added. |
| 8 | `lib/bid-status.ts:30-57` `getBidStatusLabel` | `default: return "New"` | **Phase 5.** Both cases added. |
| 9 | `lib/bid-status.ts:80-98` `getBidStatusColor` | `default:` gray | **Phase 5.** Both cases added. |
| 10 | `app/api/partner/rfps/[id]/intent/route.ts:60-75` | Not blocked; a vendor could signal intent on a closed RFP | **Phase 3.** Both added to `blockedStatuses`. |
| 11 | `app/api/partner/rfps/[id]/response/route.ts` | **Read nothing about `inbox.status` at all.** A vendor could POST a bid on a closed RFP and the write at the foot would set the row back to `bid_submitted`, **silently un-closing it** | **Phase 3.** 409 with copy that differs by status. |
| 12 | `app/partner/rfps/[id]/page.tsx:1186-1192`, `:1355-1360` | Correct by accident - an allow-list, so it fails closed | No change needed. **Phase 5** added a banner beside it, because failing closed silently reads as a fault. |

Two write sites, also from 0b, that are not readers and matter anyway:

- **`mapResponseStatusToInboxStatus` can OVERWRITE a closure.** It returns `bid_submitted`
  for anything it does not recognise, and is called by the agency bid PATCH
  (`app/api/agency/rfp-responses/[id]/route.ts:764`) and the magic-link attach. **Closure
  does not route through it**, and the rows it can reach are rows with a response, which
  `RFP_CLOSABLE_STATUSES` excludes from being closed in the first place. So the two cannot
  meet on the same row under normal operation. **This is reasoned, not tested** - see
  section 4.
- **`lib/magic-token-attach.ts:386-395` self-heals `status`** from `derivedStatus`. Same
  shape, same reasoning, same caveat.

---

## 4. WHAT I COULD NOT ESTABLISH

Stated plainly rather than resolved by guess.

1. **NOTHING IN THIS RUN WAS RUN AGAINST A DATABASE.** Not the migration, not the down file,
   not the pre-apply test, not one read-only query. Every claim about the live schema is
   READ FROM THE ON-DISK MIGRATION HISTORY, and `LIGAMENT_CONTEXT.md` is explicit that the
   history cannot reproduce that database. The eight queries in
   `docs/099-phase0-baseline.md` section 9 and the seven in 099's PRE-FLIGHT CAPTURE exist
   for exactly this reason.

2. **WHETHER THE LIVE STATUS CHECK IS THE NINE-VALUE ONE ON DISK.** 099 is written
   `DROP ... IF EXISTS, ADD ...` so it is correct whether the live constraint is seven
   values, eight, nine or absent. But **if it holds a value this file's eleven do not list,
   that value is silently lost.** Query P1 settles it and must be run first.

3. **WHETHER THE AGENCY-SIDE BID STATUS SYNC HAS BEEN WRITING ANYTHING SINCE 2026-08-20.**
   See section 6. The argument from files is strong; it is not a measurement. **Query Q5 /
   V10 is the one that settles it, and it will not settle itself.**

4. **HOW MANY VENDORS WILL GET THE EMAIL AND NO BELL.** The notifications INSERT policy's
   counterparty arm needs a `partnerships` row at `pending`/`active`/`suspended`
   (`096:302-327`). A vendor reached by magic link or as a manual recipient who never became
   a partnership is not in that set. Query Q4 measures it.

5. **WHETHER `resolveOrgNotificationRecipients` RESOLVES ANYBODY WHEN AN AGENCY CALLS IT
   FOR A VENDOR ORGANIZATION.** `org_members` has a self-row-only SELECT policy, so the
   agency's session client plausibly reads zero members and falls through to that helper's
   `profiles WHERE id = orgId` fallback, which works only for the sixteen backfilled
   organizations whose id equals their founder's user id. **The `recipient_email` fallback
   exists precisely because of this uncertainty**, and it logs whenever it fires. Watch for
   `"falling back to recipient_email"` in the Vercel logs after the first live close.

6. **NONE OF THIS WAS EXERCISED IN A BROWSER.** No dev server was started and no page was
   loaded. `tsc` and `next build` both pass, which proves the code compiles and the routes
   register; they prove nothing about what renders. The live checklist in section 8 is the
   only thing that closes this.

7. **`normaliseForTab`'s UNSAFE CAST IS STILL THERE.** `return s as RFPStatusKey` on a type
   with no such member. The partition means neither closure status can reach it, so it is no
   longer a live defect, but it is still a cast that will lie about the next status anyone
   adds. Not fixed here: it is a pre-existing shape with no bug attached to it today, and
   fixing it properly means changing a type the whole component keys off.

8. **THE NOTIFICATION PREFERENCE UI DOES NOT WRITE THE KEY ANY SEND PATH READS.** The four
   toggles in `app/partner/settings/user/page.tsx` are `newBidReceived`,
   `partnerInvitationAccepted`, `projectUpdate` and `platformAnnouncements`. The only key
   any send path reads is `notification_preferences.email`, and no UI writes it.
   **Pre-existing, not this run's to fix, and stated so Phase 4 is not credited with
   respecting a toggle a user cannot actually set.**

---

## 5. WHICH PHASES ARE INDEPENDENTLY MERGEABLE

| Phase | Alone? | Condition |
|---|---|---|
| **0** | **YES** | Documentation only. No `.ts`/`.tsx` file touched. |
| **1** | **YES, AND IT IS THE ONE TO TAKE IF ONLY ONE SHIPS.** | No migration, no new status, no ruling depends on it. Every fix in it stands on its own and none reads or writes anything this run adds. |
| **2** | **YES**, as an apply | Applying 099 with no code changes nothing a user sees: two statuses nothing writes, two notification types nothing emits, a nullable column nothing reads, and a policy for a verb the agency already believed it had. |
| **3** | **NO.** Needs 2 applied, and **must not ship without 4 and 5.** | See below. |
| **4** | **NO.** Needs 2 applied and 3 merged. | Emitters with no caller. |
| **5** | **Partially.** Needs 2 applied. | See below. |

### The three couplings that matter

**PHASE 3 WITHOUT MIGRATION 099 IS THE DANGEROUS ONE.** Two of its three failure modes are
loud (`23514` on the status, `42703` on `closed_at`, both surfacing as a 500). **The third
is silent**: there is no lead-agency UPDATE policy today, so the write matches zero rows,
PostgREST does not call that an error, and **the close action would report success, send the
email, and change nothing.** The route logs that specific anomaly, but it cannot distinguish
it from a concurrent close and says so.

**PHASE 3 + 4 WITHOUT PHASE 5 MAKES THE PRODUCT WORSE, NOT BETTER.** Without Phase 5's
dashboard exclusion, closing an RFP leaves the row in "Needs your response", counted in the
header, **and** sends the vendor an email saying it ended. A portal contradicting an email
is worse than a portal that never mentioned it.

**PHASE 5's TWO HALVES CAN SPLIT, AND THE SPLIT IS SAFE IN ONE DIRECTION ONLY.** The
dashboard exclusion and the badge entries are safe alone. The Closed tab alone is not: it
would show rows that are also still in the queue.

### Recommended ship order

1. Apply migration 099 behind its stop gate. Run PRE-FLIGHT, then the pre-apply test, then
   the dry run, then the real apply, then VERIFICATION.
2. Merge Phase 1 whenever. It is independent of everything above.
3. Merge 3 + 4 + 5 together, as one deploy, after 099 is confirmed by V5.

---

## 6. THE SECURITY ARGUMENT, IN ONE PLACE

### 3c. Ownership is verified server-side on every request.

`inbox_item_id` arrives from the client and **is a claim, not a fact.** Before any write:

1. `requireAgencyRole()`.
2. `resolveCallerWriteOrgId(user.id, supabase)` - resolves through `org_members`, an
   **AUTHORITY** set. It returns null when the caller belongs to no organization **and**
   when they belong to several and none is selected, which is a refusal rather than a guess.
3. The row is **re-read** with `.eq("id", inboxItemId).eq("lead_org_id", writeOrgId)`. A row
   belonging to another agency returns nothing and never reaches a write.
4. **404, not 403.** A 403 confirms the row exists to somebody who may not know that.
5. `.eq("lead_org_id", writeOrgId)` is **repeated on the UPDATE itself.** Between the read
   and the write, that predicate is the only thing tying the second statement to the
   ownership check. Dropping it would make the read decorative.
6. **The whole-RFP key is derived server-side.** `project_id` and `scope_item_name` come
   from the row just read under the caller's organization, never from the body. A client
   that could name the scope directly could close a scope it does not own by pairing it with
   an id it does.

**Not `current_user_counterparty_org_ids` and not `current_user_visible_profile_ids`.** Those
are VISIBILITY sets and a vendor partnered with an agency is inside both of them. Scoping
this write with either would let a vendor close the agency's own requests.

This codebase has shipped this exact class of defect once: the unconstrained `vendor_org_id`
on partnership insert, documented in migration 085's header.

### The two policy changes in 099.

**4a. A NEW lead-agency UPDATE policy. This is a new grant and it is stated as one.**

There is no UPDATE policy for the lead agency on `partner_rfp_inbox`. Five policies exist;
four are SELECT or INSERT and the one UPDATE is the **vendor's**. Verified by reading every
`CREATE POLICY` naming this table across `supabase/migrations/*.sql` and `scripts/*.sql`,
and against the 2026-08-13 `pg_policies` dump at
`docs/schema-snapshot-2026-08-13.md:134-142`.

The predicate is `lead_org_id IN (SELECT public.current_user_org_ids())` on **both** USING
and WITH CHECK - character for character the one the table's INSERT and SELECT agency
policies already use (`079:1342-1348`). **So the set of rows a lead agency may UPDATE
becomes exactly the set it may already SELECT and INSERT.** It adds no row to the reach of
any existing policy.

WITH CHECK is not optional and is not the same as USING. USING decides which rows may be
updated; WITH CHECK decides what they may be updated **to**. With USING alone an agency
could move a row's `lead_org_id` to another organization. This is the shape
`"Agencies update response status and feedback"` (`079:1384-1387`) already uses on
`partner_rfp_responses`, over the same agency-vendor relationship.

**Not narrowed to the two closure statuses**, deliberately. That would look tighter and
would break the existing bid status sync, which writes five other statuses onto this table
through the same verb. Which statuses an agency may set is an application question; which
**rows** it may touch is the access question, and that is what this policy answers.

> ### THE PRE-EXISTING DEFECT THIS CLOSES BY ACCIDENT, AND IT MUST NOT SHIP UNREMARKED
>
> `app/api/agency/rfp-responses/[id]/route.ts:762-779` runs an UPDATE against
> `partner_rfp_inbox` on the **session client**, against a table with no agency UPDATE
> policy, and has done since 079 was applied on 2026-08-20. **A PostgREST UPDATE matching
> zero rows is not an error.** So `inboxStatusErr` is null, the handler returns 200, and the
> inbox row keeps its old status.
>
> If that is what has been happening, **every inbox row whose bid was awarded, declined or
> shortlisted in the last three weeks still holds its old status.** Migration 099 makes it
> start working. **It does not repair the rows it already missed**, and that is a backfill,
> a separate decision, and not covered by R3's no-backfill ruling, which was about
> deadlines.
>
> **THIS IS INFERRED FROM FILES AND IS NOT MEASURED.** Query Q5 in
> `docs/099-phase0-baseline.md`, repeated as V10 in the migration, is the one that settles
> it. Run it before applying and again after.

**4b/4c. The vendor UPDATE policy, NARROWED. THREE CLAUSES. This is the security half of
the migration.** *(Revised after review. The first version of this file had two gaps; both
are described in section 9.)*

`"Partners update own inbox rows"` has a USING clause and **no WITH CHECK**. PostgreSQL
applies USING to the post-update row when WITH CHECK is absent, so **today a vendor may set
their own row to any value the CHECK constraint permits and may write any `vendor_org_id`
that keeps them matching**, straight from the browser client, with no route involved.

> **SO SECTION 1 OF 099, ON ITS OWN, WOULD HAND EVERY VENDOR THE CLOSE ACTION.** Widening a
> CHECK constraint looks like a spelling change. Here it is a privilege grant.

**THE WRITE CENSUS the allow-list is derived from.** Every site that sets
`partner_rfp_inbox.status`, with the actor at each:

| Site | Client / actor | Writes |
|---|---|---|
| `partner/rfps/[id]/response/route.ts:368` | **SESSION, VENDOR** | `bid_submitted` |
| `agency/rfp-closure/route.ts:190` | session, AGENCY | `closed`, `not_selected` |
| `agency/rfp-responses/[id]/route.ts:764` | session, AGENCY | `shortlisted`, `meeting_requested`, `awarded`, `declined`, `bid_submitted` |
| `agency/broadcast-rfp/route.ts:261,410` (INSERT) | session, AGENCY | `new` |
| `lib/magic-token-attach.ts:356/:167/:395` | **SERVICE ROLE** | various |

**Exactly one row of that table is a vendor session and it writes exactly one value.** The
service-role row does not constrain the allow-list, and that was **checked, not assumed**:
`attachMagicTokenToPartnerInbox` has four callers and all four pass a service-role client
(`partner/rfps:72`, `partner/rfps/bids:56`, `guest/[token]/attach-existing-account:77`,
`agency/rfp/magic-link:356`), and none falls back to the session client when the key is
absent.

**THE ALLOW-LIST IS `bid_submitted`. Every excluded status and who sets it:**

| Excluded | Set by |
|---|---|
| `awarded`, `shortlisted`, `meeting_requested`, `declined` | the **AGENCY**, `rfp-responses/[id]:764` |
| `closed`, `not_selected` | the **AGENCY**, `rfp-closure:190` |
| `new` | the **AGENCY**, and only as the broadcast INSERT default. **Excluded from the vendor list specifically because it is the un-close vector**: a vendor permitted to set `new` could move a closed row back into their own live queue. |
| `viewed`, `feedback_received`, `revision_submitted` | **NOBODY.** No write of any of these three to this column exists anywhere in the repository. Legacy constraint values. |

**`under_review` is not on that list because it is not a `partner_rfp_inbox` status at all.**
It is a `partner_rfp_responses` value (`scripts/019:8`) and is absent from
`partner_rfp_inbox_status_check` (`scripts/019:16-26`). A vendor writing it is refused by the
**CHECK constraint with 23514**, before any policy is consulted, both before and after this
file. T7k asserts exactly that.

### Why a bare allow-list would have been wrong in both directions

**WITH CHECK is evaluated on every UPDATE the vendor makes, not only the ones that touch
`status`.** On a write that does not change status, the predicate sees the status the row
already had. So `status IN ('bid_submitted')` alone would have refused:

- `partner/rfps/[id]/route.ts:72` stamping `viewed_at` on a `new` row
- `partner/rfps/[id]/intent/route.ts:94` writing `partner_intent`
- `partner/rfps/[id]/nda-notify:117`
- `partner/rfps/claim/route.ts:75-83` **the claim itself**

**And the one easiest to miss:** a magic-link row synthesized by
`lib/magic-token-attach.ts:342` from an already-decided response carries status `awarded` or
`shortlisted` and no `viewed_at`. A vendor opening that RFP for the first time writes
`viewed_at` to a row whose status is `awarded`. **A bare allow-list 42501s them out of their
own won work.** T8 is written against exactly that case.

So clause (C) is **"unchanged, or the allow-list"**. The unchanged arm needs the previous
value, WITH CHECK cannot see `OLD`, and that is the entire reason section 4b's helper exists.

### The three clauses

```
(A) OWNERSHIP    the same two arms as USING
(B) IDENTITY     vendor_org_id IS NULL
                 OR vendor_org_id IN (SELECT current_user_org_ids())
(C) STATUS       status = partner_rfp_inbox_status_before(id)
                 OR (status = 'bid_submitted'
                     AND partner_rfp_inbox_status_before(id) <> 'closed'
                     AND partner_rfp_inbox_status_before(id) <> 'not_selected')
```

**Clause (B), and why `vendor_org_id` must stay writable.** The claim path needs it. It is
`app/api/partner/rfps/claim/route.ts:75-83`, it writes `vendor_org_id: writeOrgId`, and it
runs **on the session client as the vendor, not on the service role** - after proving the
caller's profile email equals `recipient_email`. `writeOrgId` comes from
`resolveCallerWriteOrgId`, so it is always one of the caller's own organizations. Refusing
this clause would break every invitation claim on the platform; T15 asserts it still works.
NULL must also be permitted, because an unclaimed manual-recipient row carries NULL and the
vendor reaches it through the email arm to stamp `viewed_at` long before anything claims it.

**What (B) refuses:** any organization id the caller does not belong to. Before it, a vendor
admitted by the email arm could write an arbitrary org id and hand the agency's request to a
company of their choosing.

**What (B) cannot refuse, stated plainly:** moving a row from one organization the caller
belongs to, to another organization the caller *also* belongs to. WITH CHECK sees only the
new row, so "it was already claimed by someone else" is not expressible there. That needs a
`BEFORE UPDATE` trigger comparing `OLD.vendor_org_id` and is a separate decision. The claim
route already guards it with `.is("claimed_at", null)`; this is the gap between that route
and raw PostgREST.

**Clause (C) is not a deny-list and needs no extension.** A status added to the constraint in
some future migration is refused to vendors by default: it is neither equal to the previous
value on a change, nor `bid_submitted`. Nobody has to remember to come back.

### The one risk in this design, stated rather than buried

`public.partner_rfp_inbox_status_before(uuid)` is `STABLE SECURITY DEFINER`. **STABLE is
load-bearing, not decoration:** it is what pins the read to the statement-start snapshot,
i.e. the pre-update row. `SECURITY DEFINER` is required because an invoker-rights function
reading `partner_rfp_inbox` from inside that table's own policy re-enters RLS on the same
table and raises 42P17.

> **IF THAT FUNCTION EVER RETURNED THE NEW STATUS INSTEAD OF THE OLD ONE, clause (C) would be
> TRUE for every write and THE WHOLE CHECK WOULD BE VACUOUS while every statement reported
> success.** That is a success-shaped non-event of exactly the kind this project keeps being
> bitten by.
>
> **I HAVE NOT EXECUTED THIS.** The semantics are asserted, not measured. The pre-apply test
> is built around catching it: the ten T7 probes each try one agency-owned status, and **if
> all ten succeed the headline says so by name** - "ALL TEN STATUS PROBES SUCCEEDED, WHICH
> MEANS CLAUSE (C) IS VACUOUS, NOT THAT TEN THINGS ARE BROKEN" - and tells the reader to
> check `provolatile`, and that if it is already `s` the design must change to a
> `BEFORE UPDATE` trigger. V5b checks `provolatile` directly.

### The predicate is still equal-or-narrower

```
BEFORE:  USING      <P>
         WITH CHECK  (absent, so PostgreSQL uses <P>)

AFTER:   USING      <P>                    -- UNTOUCHED, NOT NAMED
         WITH CHECK <P> AND (B) AND (C)
```

The new check is the old effective check ANDed with two further clauses. **A conjunction with
new terms can only ever admit fewer rows.** Narrower by construction, not by inspection.

`ALTER POLICY`, never DROP-then-CREATE. A DROP on a name that is not live **silently no-ops**
and the CREATE that followed would add a **second permissive policy** that ORs with the
first - closing nothing, widening everything, and reporting success while it did so.
`096:365-372` established the rule.

**No route gained the service role and no session or role check was removed or weakened.**

---

## 7. WHAT TO REVERT IF ONE PIECE IS WRONG

Each entry is standalone. Nothing below depends on anything else below.

| If this is wrong | Revert | Blast radius |
|---|---|---|
| The 14-day horizon | `RFP_RESPONSE_DEADLINE_DEFAULT_DAYS` in `lib/rfp-response-deadline.ts`. **One number, one file.** | New broadcasts only. No existing row changes. |
| Defaulting the deadline at all | `git revert f177a2f`, or narrower: restore `useState("")` at `app/agency/page.tsx` and `: null` in both route fallbacks. | Back to R1's option (c). |
| Removing the JS deadline comparator | Put it back in `app/api/partner/dashboard/route.ts` where the comment now sits. | Queue order only. |
| The overdue payments block | `git revert f177a2f`, or narrower: restore the `"overdue-milestone"` arm to `QueueRow` and its spread into `queueRows`, and delete the new block. | Vendor dashboard layout. |
| The migration, before it is applied | Delete the three `099_*` files. Nothing references them. | Zero. |
| **The migration, after it is applied** | `supabase/migrations/099_rfp_closure_down.sql`. **READ ITS HEADER FIRST** - it is not symmetric. | See below. |
| Either agency action | `git revert 0f13335`. The route file is new and unreferenced elsewhere; the `/agency/bids` dropdown items go with it. | Agency UI + one route. |
| The notification copy | `lib/rfp-closure-copy.ts` only. Both drafts are in that one file and nothing else composes closure copy. | Copy only. |
| Notifications entirely | `git revert 900f235`. The route keeps working and closes rows silently. | **Do not leave it there.** A silent closure is the defect R7 exists to close. |
| The vendor Closed tab | `git revert c6612c4`. **DO NOT** do this while 3 and 4 are live - see section 5. | Vendor UI. |

### The down migration is not symmetric, in three ways

1. **Restoring the narrow constraints FAILS with 23514 once any row is closed**, and after
   the Phase 3 code ships that is the expected state, not an edge case. The down file
   offers two options and does **not** rewrite rows for you: Option A leaves both
   constraints wide (a CHECK is a spelling gate and costs nothing while no code writes
   them), Option B rewrites the rows first and its `UPDATE` is commented out.
2. **Dropping the agency UPDATE policy re-breaks the bid status sync, quietly.** No error,
   no log, nobody told.
3. **Section 1 must run BEFORE section 4b.** Reverse them, or run 4b alone, and there is a
   permanent state in which every vendor can close their own RFP rows from the browser.
   **If you take Option A and skip section 1, you must also skip section 4b.**

---

## 8. THE LIVE CHECKLIST

Two accounts. **A** = `gmarkant@gmail.com`, the **m a r k a n t** lead agency.
**V** = a vendor account that has at least one RFP from A (`gmarkant@icloud.com` is the
primary partner test account per `LIGAMENT_CONTEXT.md`).

**Do not start until migration 099 is applied and its V5 has been read.** Steps 1 to 3 are
the gate on everything after them.

### Before anything: the migration

1. **[A, Supabase SQL Editor]** Run the PRE-FLIGHT CAPTURE, P1 to P7, from the head of
   `supabase/migrations/099_rfp_closure.sql`. **Expect:** P1 returns 2 rows and the status
   constraint holds the nine. P3 returns **5** policy rows and **none** of them is an UPDATE
   naming `lead_org_id`. Record every answer here before continuing.
2. **[A, SQL Editor]** Paste **all** of `supabase/migrations/099_preapply_test.sql` and run
   it once. **Expect a red error box.** The error is the result. **Read the headline and
   then read T7 and T10 by name.** If T7 says INCONCLUSIVE, the vendor-side exclusion is
   unmeasured and that is not a pass. Do not continue on an INCONCLUSIVE T7 without
   deciding to, explicitly.
3. **[A, SQL Editor]** Dry run `099_rfp_closure.sql` with `COMMIT` on line 606 swapped for
   `ROLLBACK`. Put the COMMIT back. Run for real. Then run **V5**. **Expect 6 policy rows,
   and `"Partners update own inbox rows"` must have a `with_check` that is NO LONGER NULL
   and contains both `status <> 'closed'` and `status <> 'not_selected'`.**
   **If `with_check` is still NULL, STOP. Do not deploy the code.**

### The agency side

4. **[A]** Open `/agency/bids`. Find a vendor row badged **"New"** with no bid. **Expect:**
   a `⋮` button on that row. Click it. **Expect** two new items: "Mark not selected" and
   "Close this RFP for all vendors".
5. **[A]** Click **"Mark not selected"**. **Expect** a modal headed *"Tell [vendor] they
   were not selected?"*, naming the vendor and the scope, saying every other vendor stays
   open, and carrying the line **"This cannot be undone. There is no reopen, and the email
   cannot be unsent."** Click **Cancel**. **Expect** nothing to change.
6. **[A]** Do it again and click **"Mark not selected"** to confirm. **Expect:** the modal
   closes, the list refreshes, and that row is now badged **"Not Selected"** in orange.
   **Expect it NOT to be badged "Declined"** and not to be red.
7. **[A]** Open the `⋮` on that same row again. **Expect** the two closure items to be
   **gone** (the row is no longer `awaiting_response`).
8. **[A]** On a different RFP with two or more non-bidding vendors, click **"Close this RFP
   for all vendors"** and confirm. **Expect** every non-bidding vendor on that scope to
   badge **"Closed"** in gray, in one action.
9. **[A]** **IDEMPOTENCY.** If any vendor on that same RFP had already submitted a bid,
   find their row. **Expect it to be completely unchanged** - same status, same badge, still
   awardable.
10. **[A]** Repeat step 8 on the same RFP. **Expect** no error, no change, and no second
    email to anybody. (3d: re-closing is a no-op.)

### The vendor side

11. **[V]** Open `/partner`. **Expect** the "Needs your response (N)" count to have gone
    **down** by the number of requests closed in steps 6 and 8, and none of those requests
    to be in the list.
12. **[V]** On the same page, **expect** a separate block headed **"Overdue payments (N)"**
    below the response queue. If nothing is overdue it must read **"No payments are overdue.
    Milestones that pass their due date without being paid will appear here."** It must
    **not** be empty and it must **not** say "Nothing is waiting on you."
13. **[V]** Check the "Open RFPs" tile. **Expect** it to have gone down by the same number
    as step 11.
14. **[V]** Open `/partner/rfps`. **Expect** a two-entry tab strip: **Open** and **Closed
    (N)**. **Expect** none of the closed requests in the Open list, and **expect** none of
    them badged "New" anywhere.
15. **[V]** Click **Closed**. **Expect** each closed request to show **the agency name, the
    scope name, and a closure date**, and a sentence saying which of the two things
    happened. The not-selected one must read differently from the closed ones.
16. **[V]** Click into one closed request. **Expect** a banner explaining the state and
    **expect no bid form**. **Expect** the page not to look broken.
17. **[V]** Open `/partner/bids` and click **History**. **Expect** the closed requests
    **not** to appear there. That tab is bids this vendor submitted, and these were never
    bid on.
18. **[V, email]** **Expect two different emails.** The close one subject-lined *"[Agency]
    has closed the RFP for [Scope]"* and containing **"This is not a decision about your
    company."** The not-selected one subject-lined *"Update on [Scope] from [Agency]"* and
    containing **"This is about this one request."** **Neither may contain the word
    "declined" or "rejected".**
19. **[V]** Check the notification bell. **Expect** an in-app notification for each. **If
    the bell is empty but the email arrived**, that is the `partnerships`-status limit in
    section 4 item 4, not a bug in this run - check the Vercel logs for
    `"org notification insert failed for every recipient"` and run query Q4.

### The two mandatory security steps

20. **>>> A VENDOR CANNOT CLOSE THEIR OWN ROW. <<<**

    **[V]** Log in as the vendor, open `/partner/rfps`, and open the browser console on any
    RFP still in the **Open** tab. Run, substituting that row's id:

    ```js
    const { createClient } = await import('/lib/supabase/client')
    // Or, simpler and equivalent, from the Network tab: repeat any PATCH the
    // vendor portal already makes to partner_rfp_inbox and change the body to
    // { "status": "closed" }.
    ```

    The reliable version needs no console at all: **[V]** open an RFP, click the
    intent buttons so the portal issues its own write, copy that request from the
    Network tab as fetch, change the body to `{"status":"closed"}`, and replay it.

    **EXPECT: 403, or a 200 that affected zero rows.** Then **[V]** reload
    `/partner/rfps` and **expect the RFP to still be in the Open tab, unchanged.**

    **REPEAT with `{"status":"awarded"}`.** That one is not a formality: `awarded` was
    writable by any vendor before this migration and is the most valuable status in the
    product to be able to forge.

    **>>> IF EITHER ROW CHANGES, STOP EVERYTHING. Migration 099 clause (C) did not take.
    Re-run V5 and V5b and re-apply section 4c.**

    The database-level version of this check is the **T7 block** in the pre-apply test -
    ten assertions, one per excluded status - and is easier to run. **Do both.** T7
    measures the policy; this measures the policy plus the route plus whatever the deployed
    build actually shipped.

20b. **>>> A VENDOR CANNOT HAND THE REQUEST TO ANOTHER COMPANY. <<<**

    **[V]** Same technique, body `{"vendor_org_id":"<ANY ORG ID THE VENDOR IS NOT IN>"}`.
    Get one from the SQL Editor with `SELECT id, name FROM public.organizations LIMIT 5;`.

    **EXPECT: 403, or 200 affecting zero rows.** Then confirm in the SQL Editor:

    ```sql
    SELECT id, vendor_org_id FROM public.partner_rfp_inbox WHERE id = '<THE ROW>';
    ```

    **EXPECT `vendor_org_id` unchanged.**

    **>>> IF IT CHANGED, a vendor can reassign an agency's RFP request to a company of
    their choosing. Clause (B) did not take.**

20c. **THE OTHER DIRECTION. TOO TIGHT IS WORSE THAN THE HOLE.**

    **[V]** Open an RFP in the Open tab normally, click through to the detail page, set an
    intent signal, and submit or save a draft bid.

    **EXPECT ALL OF IT TO WORK.** If opening an RFP, signalling intent, claiming an
    invitation or submitting a bid now fails, **clause (B) or (C) is too tight and the
    vendor portal is broken for every vendor on the platform.** That is a worse outcome
    than the hole this migration closes. T8, T8b, T8c and T15 cover the same ground in the
    pre-apply test.

21. **>>> AN AGENCY CANNOT CLOSE ANOTHER AGENCY'S RFP. <<<**

    **[A]** In the SQL Editor, get an `inbox_item_id` that belongs to a **different**
    organization:

    ```sql
    SELECT i.id, i.lead_org_id, o.name
    FROM public.partner_rfp_inbox i
    JOIN public.organizations o ON o.id = i.lead_org_id
    WHERE i.lead_org_id <> '<m a r k a n t org id>'
      AND i.status IN ('new','viewed')
    LIMIT 1;
    ```

    **[A]** Then, logged in as A, in the browser console on `/agency/bids`:

    ```js
    await fetch('/api/agency/rfp-closure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inbox_item_id: '<THE OTHER AGENCY\'S ID>', unit: 'rfp' })
    }).then(r => r.status)
    ```

    **EXPECT: 404.** Not 200, not 403, and no row closed.

    **[A]** Confirm nothing moved:

    ```sql
    SELECT id, status, closed_at FROM public.partner_rfp_inbox
    WHERE id = '<THE OTHER AGENCY''S ID>';
    ```

    **EXPECT the original status and `closed_at` NULL.**

    **>>> IF IT RETURNS 200 OR THE ROW CLOSED, STOP. This is the unconstrained-identifier
    defect migration 085's header documents, shipped again. Revert `0f13335`.**

    If this database has only one organization, this step cannot run. **Say so rather than
    marking it passed** - the boundary is then argued and unmeasured, exactly as T10 would
    report.

### After

22. **[A, SQL Editor]** Run **V10** / Q5:

    ```sql
    SELECT i.status AS inbox_status, r.status AS response_status, count(*) AS n
    FROM public.partner_rfp_responses r
    JOIN public.partner_rfp_inbox i ON i.id = r.inbox_item_id
    GROUP BY 1, 2 ORDER BY n DESC;
    ```

    A large population where `response_status` is `awarded`/`declined` and `inbox_status` is
    still `new`/`viewed` is the signature of the bid status sync having matched zero rows
    since 2026-08-20. **Those rows do not repair themselves and this run does not repair
    them.** Decide what to do about them separately.

23. **[A]** Update the migrations table in `LIGAMENT_CONTEXT.md` with the 099 row, per the
    standing sequence.

---

## 9. THE REVIEW ROUND: TWO GAPS IN 099's WITH CHECK, BOTH CLOSED

Raised against the first version of the migration. **Both were real, both were live today,
and neither was closed by the version I first committed.** What follows is what changed and
what I verified versus read.

### Gap 1. The status check was a two-value deny-list.

The first version was `AND status <> 'closed' AND status <> 'not_selected'`. That blocked
the two values this run adds and **nothing else**. A vendor could still set their own row to
`awarded`, `shortlisted`, `meeting_requested`, `declined` or `feedback_received` - every
status representing an agency decision - exactly as they can today.

It was also a deny-list, which is the failure mode this file's own section 2 comment warns
about for notification types: it has to be extended every time a status is added, and the
cost of forgetting is silent.

**What I did.** Built the write census above by grepping every `.update(`/`.insert(` within
eight lines of a `from("partner_rfp_inbox")` across `app/` and `lib/`, then reading each
site for its client. The allow-list is `bid_submitted` and it is one value because exactly
one vendor-session site writes this column.

**The part I got wrong on the first pass and corrected during this one.** My first draft of
the fix was a bare allow-list with no reference to the previous status. **That would have
broken the vendor portal**, because WITH CHECK runs on every vendor write and not only on
status changes - including a vendor opening a magic-link RFP whose status is already
`awarded`. Hence the unchanged arm, hence the helper function. T8 exists specifically to
catch that class of mistake if it is ever reintroduced.

### Gap 2. `vendor_org_id` was freely writable through the email arm.

The first version's WITH CHECK mirrored USING, so a vendor admitted by the `recipient_email`
arm satisfied the check **whatever they wrote into `vendor_org_id`** - including an
organization they do not belong to. That is reassignment of an agency's RFP request to a
company of the vendor's choosing.

**Must it remain writable? Yes, and here is the code.**
`app/api/partner/rfps/claim/route.ts:75-83` writes `vendor_org_id: writeOrgId`. It runs
**on the session client as the vendor** - `createClient` from `@/lib/supabase/server`, line 3
of that file - **not on the service role**. It writes only after `emailMatches(inbox.recipient_email,
profileEmail)` passes, and `writeOrgId` comes from `resolveCallerWriteOrgId`, so the value is
always one of the caller's own organizations.

**So the clause is `vendor_org_id IS NULL OR vendor_org_id IN (SELECT current_user_org_ids())`.**
Permits every legitimate claim, refuses every cross-organization write. What it cannot do is
stated in section 6 rather than glossed: it cannot see `OLD`, so it cannot stop the same
human moving a row between two organizations they both belong to.

### What changed, by file

| File | Change |
|---|---|
| `099_rfp_closure.sql` | Section 4b is new: the `STABLE SECURITY DEFINER` helper, with `REVOKE`/`GRANT` following 096's pattern. Section 4c replaces the old 4b with the three-clause WITH CHECK. The header's 4b argument is replaced by the write census, the excluded-status table with actors, and the "why a bare allow-list is wrong in both directions" section. V5 now reads for all three clauses by name; **V5b is new** and checks `provolatile` and the `anon` grant. V7 is rewritten to cover all ten statuses plus the identity write, and **V7b is new** for the must-succeed direction. **BEGIN moved 420 to 507, COMMIT 606 to 841**, and the header was resynced. |
| `099_rfp_closure_down.sql` | Consequence (3) rewritten: removing the check gives back **two** holes, and narrowing the constraint takes back only one of them. New section 4c drops the helper, **after** the policy restore, with a note that `CASCADE` must never be added because it would drop the policy itself. D2b added. **BEGIN moved 128 to 147, COMMIT 258 to 295.** |
| `099_preapply_test.sql` | Section A applies the helper and the three-clause policy. T7 became **ten assertions in a loop, one per excluded status**, each restoring the row before the next. **T7k** (under_review is the constraint's refusal, not the policy's), **T8** rewritten to park the row at `awarded` first, **T8b**, **T8c**, **T14** and **T15** are new. A `v_leaked` counter and a dedicated headline name the vacuous-clause failure. 13 assertions became **27**. |

### What I verified versus read, on this round

**VERIFIED BY EXECUTION:** the write census greps; that all four
`attachMagicTokenToPartnerInbox` callers pass a service-role client and none falls back;
that `under_review` is absent from `partner_rfp_inbox_status_check` (`scripts/019:16-26`);
that nothing anywhere writes `viewed`, `feedback_received` or `revision_submitted` to this
column; that no `components/` file writes `partner_rfp_inbox` at all; that the guest token
route never touches the table; `tsc`, `build`, `lint` and the three code guards.

**READ, NOT EXECUTED:** everything about how the database will behave. In particular
**the snapshot semantics clause (C) depends on.** No SQL was run this round either.

**REASONED:** that a bare allow-list breaks the portal; that `bid_submitted` from a `closed`
row must still be refused even though it is on the allow-list; that `new` must be excluded
because it is the un-close vector.

**STILL NOT CLOSED, AND DELIBERATELY:** a vendor moving a row between two organizations they
both belong to. It needs a `BEFORE UPDATE` trigger and is a separate decision.
