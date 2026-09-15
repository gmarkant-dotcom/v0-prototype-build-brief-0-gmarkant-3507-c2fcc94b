# The emitter rulings run: what shipped, what did not, and what is owed

Branch `feat/emitter-rulings`, four commits, **not pushed and not merged**. 2026-09-15.

**NO SQL WAS RUN IN THIS SESSION, read-only or otherwise.** There are no working database
credentials in this environment. Every claim below is from source or from a command whose
exit code is quoted. **Migration 100 is AUTHORED, NOT APPLIED.**

---

## 0. The verdict in one paragraph

Ruling 5 emits from the decompose route only, with a payload the compiler enforces.
Ruling 3 is deferred with its definition recorded. Three new rulings are owed and none is
answered. Ruling 6 is repaired by a migration that needs **no application code at all**,
which makes it independently applicable in either order. The relationship-end discovery
found that revocation already partly happens, in the one place it hurts most, through an
application filter nobody ruled on. **Four things the brief asserted turned out to be wrong
and are corrected in section 5.**

---

## 1. The gates. Each run as its own unpiped command, exit code read from `$?`

| Gate | Exit | Detail |
|---|---|---|
| `npx tsc --noEmit` | **0** | clean |
| `pnpm build` | **0** | full production build, all routes emitted |
| `pnpm lint` | **1** | **182 problems (154 errors, 28 warnings)** - the stated baseline, **unmoved** |
| `pnpm identity-columns:guard` | **0** | 0 legacy identity columns in 0 files |
| `pnpm org-id-reads:guard` | **0** | no new class A or class B; class B baseline 60, unchanged; 14 known-open remain |
| `pnpm embed-targets` | **0** | TOTAL 0 in 0 files |
| `pnpm policy-audit:guard` | **1** | **pre-existing.** Reads only `docs/schema-snapshot-2026-08-13.md`, a static pre-079 capture. Verified it does not read `supabase/migrations/` at all, so migration 100 cannot have moved it. |
| `pnpm verify-rls` | **2** | **pre-existing.** PostgREST does not expose `pg_class` on this project; it has never worked. |

The lint triple is quoted in full rather than just the exit code, per the brief. `1` alone
would not have shown that the count is unchanged.

**THE HARNESS LIED AGAIN, AND IT IS THE SAME LIE.** While proving the payload enforcement
in section 2, `${PIPESTATUS[0]}` under zsh returned **empty** for a command that had clearly
failed - the third of the three failures the brief lists, reproduced live. Every gate above
was therefore run unpiped with `echo $?` on the next line, and the enforcement proof was
read from the TS error text rather than from an exit code.

---

## 2. Phase by phase

### Phase 1 - commit `2c2db0f`, shipped before this session

Verified before building on it, not taken on trust.

- `vendor.remove` - `app/api/partnerships/route.ts`. Fires on the
  `status !== 'removed' -> 'removed'` transition, named before the write from the pre-read
  `partnership.status`. Payload `partner_email` + `prior_status`.
- `vendor.blacklist` - `app/api/agency/pool/[partnerId]/notes/route.ts:218`.
  `!wasBlacklisted && nowBlacklisted`, both read before the write. Payload `{}`.
- `rfp.generate` - `app/api/ai/master-brief/route.ts`. One server-determined type. The
  client supplies `projectId`; the route re-verifies it against `resolveCallerOrgIds` and
  drops it to null. Payload `{}`.
- None added to `vendor_visible_event_types()`; five predicates added to
  `lib/activity-feed.ts`.

### Phase 2 - commit `995d5c3`

**Ruling 5 emits, from `app/api/agency/bids/[responseId]/decompose/route.ts` only.**
Agency feed only, off the whitelist, and additionally `partnership_id = NULL` so gate 2
fails twice over.

**`app/api/agency/bids/compare/route.ts` emits nothing.** It has no `recordMilestone`
import and gains none; a comment at the head of the file records the ruling, because an
absence leaves no trace at the site it was decided for.

**The payload is enforced by the compiler, not by convention.** `analysisPayload` is
annotated `{ scope_item_name: string | null }`. Proven by adding
`vendor_name: ctx.partnerDisplayName` and running `tsc`:

```
route.ts(288,9): error TS2353: Object literal may only specify known properties,
and 'vendor_name' does not exist in type '{ scope_item_name: string | null; }'.
```

then reverting. `tsc` is 0 after the revert.

**One deliberate departure from the brief.** The brief calls `force: true` the retry
variant. `force` is a flag from the browser, and ruling 4 refused exactly that discriminator
for `rfp.generate` one commit earlier. The type is decided instead by whether a
`bid_decompositions` row already existed - the server's own fact. The two disagree in a real
case: `force: true` on a response with no prior row is a **first** analysis the flag would
file as a retry. The existence query moved out of `if (!force)` to serve both jobs; its
predicate is byte-identical including `.in("org_id", callerOrgIds)`, so no read is widened.
Cost: one extra `maybeSingle()` on a force run, none on a normal one.

**Ruling 3 deferred, no code.** The materiality definition is recorded in
`docs/emitter-rulings-owed.md`: **material when it changes STANDING BUSINESS REQUIREMENTS
or ATTACHED DOCUMENTS**, because those flow into every RFP built from that client. Two
things are still owed and named there: the field census, and whether a per-vendor variant
stays agency-only.

**Three new owed rulings added, none answered:** 7 `bid.compare`, 8 the blacklist clear,
9 `rfp.regenerate`. The file's title and status block were corrected - the six are ruled,
three are owed - and **no original question was edited to agree with its answer**.

### Phase 3 - commit `b8279bf`. Migration 100.

**AUTHORED, NOT APPLIED.**

| File | BEGIN | COMMIT / ROLLBACK |
|---|---|---|
| `supabase/migrations/100_milestone_inbox_pin.sql` | **line 356** | **COMMIT line 528** |
| `supabase/migrations/100_milestone_inbox_pin_down.sql` | line 70 | COMMIT line 103 |
| `supabase/migrations/100_preapply_test.sql` | line 120 | ROLLBACK line 942 |

Each is the only occurrence of its word at column 0; `grep -n '^BEGIN;$'` and
`grep -n '^COMMIT;$'` each return exactly one hit per file.

**The predicate.** The five clauses 088 already had are untouched and still apply to both
arms. Only the final parenthesis is new:

```
AND (
      ( partnership_id IS NOT NULL AND EXISTS (... partnerships ...) )   -- BRANCH A, 088
      OR
      ( partnership_id IS NULL AND (
          ( subject_type = 'rfp_inbox' AND EXISTS (... partner_rfp_inbox i
                                                    WHERE i.id = subject_id ...) )
          OR
          ( subject_type = 'bid'       AND EXISTS (... partner_rfp_responses r
                                                    JOIN partner_rfp_inbox i
                                                      ON i.id = r.inbox_item_id
                                                    WHERE r.id = subject_id ...) )
      ) )
    )
```

- **Branch A is 088 token for token.** Verified by normalizing whitespace on
  `088:452-459` and `100:427-434` and comparing the strings, not by reading them. Only the
  indentation differs.
- **The branches are MUTUALLY EXCLUSIVE, not merely disjoint**, split on
  `partnership_id IS NULL` / `IS NOT NULL`. Exactly one arm can be true for any row, so the
  overlap case has no row about which the two can disagree, so no weaker arm can admit
  anything. The question is removed rather than argued. The cheaper spelling would behave
  identically today and is refused because the next arm inherits the structure, not the
  coincidence.
- **The overlap case, concretely:** a claimed vendor holds both, the emitter resolves a
  non-null `partnership_id`, so the row goes through branch A alone and branch B is never
  consulted. One row, inserted once - a `WITH CHECK` is a boolean test, not a row
  multiplier. Assertion T8 writes exactly this and counts.
- **Branch B pins `subject_id`, which branch A does not.** The first design proved the
  *relationship* (any inbox row between the two organizations) and would have failed the
  brief's own mandatory assertion T4. The shipped design starts from `subject_id`. Two
  sub-arms because the four emitters carry two subject shapes, and neither may be changed:
  `bid.submit` **must** key `subject_id` on the response id, because it is on
  `UNION_REPLACING_EVENT_TYPES` and `lib/activity-feed.ts` states the hard requirement in
  its own header. So the policy hops through `partner_rfp_responses.inbox_item_id` - the
  same join `"Partners insert RFP responses for their inbox"` already performs live
  (`079:1390-1400`).
- **No index.** Every lookup starts from a primary key, so the composite index an earlier
  draft added is unnecessary and is not created.

**The equal-or-narrower argument, stated plainly rather than dressed up.** This file
**widens an INSERT grant, deliberately and by ruling**. What is true precisely: it widens
**no read** - no SELECT policy anywhere is touched; **no counterparty can read a branch B
row at all**, because 080's counterparty policy opens with `partnership_id IS NOT NULL` and
a branch B row has a null one, so these rows are agency-readable only; and on the one axis
where the arms differ, **the new arm is the narrower one**, because it pins `subject_id`
and branch A does not.

**Ordering: there is none, because there is no code.** All four emitters already pass
exactly what branch B needs. The 085 trap - where the decline branch resolved a recipient
after setting a status, so applying first would have silently killed the email - cannot
arise here. **Safe to apply before the branch merges, after it merges, or on `main` today:
the effect is identical.** If it is never applied, the status quo continues and nothing
regresses.

**The pre-apply test** carries **11 numbered assertions**, all five mandatory ones plus
T3b for the bid sub-arm, which is half the repair and which T3 does not touch. Every
refusal must be **42501**; any other SQLSTATE is a FAIL, because it means a foreign key or a
NOT NULL answered before the policy did. It synthesizes a branch B subject by cloning an
inbox row when the database has none, and reports which path it took. Structure checked
statically: 13 inner `BEGIN` / 13 `END`, 20 `IF` / 20 `END IF`, no unbalanced quotes.
**NOT EXECUTED.**

**The feed impact** is in `docs/ruling-6-feed-impact.md`, summarized in section 4 below.

### Phase 4 - commit `fc4502d`. Discovery only.

`docs/relationship-end-rulings.md`. One new file; `git status` showed exactly one untracked
doc before the commit and `tsc` was 0 with no source file touched. Four rulings framed and
**none answered**, plus four more questions the code raised that the brief did not ask.
Section 5 below carries its two corrections.

---

## 3. What is independently mergeable, and what to revert if one is wrong

| Commit | Independent? | Revert cost |
|---|---|---|
| `2c2db0f` rulings 1, 2, 4 | Yes | `git revert 2c2db0f`. Five files. Removes three emitters; nothing else depends on them. |
| `995d5c3` ruling 5 + docs | Yes | `git revert 995d5c3`. Removes the emitter, the compare-route comment and the doc edits together. **The doc edits could be kept** by reverting only the two route files. |
| `b8279bf` migration 100 | **Yes, and most of all.** Three SQL files and one doc; **no application code**. | `git rm` the three files, or apply `100_milestone_inbox_pin_down.sql` if it has already been applied. **The rows branch B admitted are NOT deleted and cannot be** - `milestone_events` has no DELETE policy for anybody. |
| `fc4502d` discovery | Yes | One doc. Nothing references it. |

**Nothing in phase 3 depends on phase 2, and nothing in phase 2 depends on phase 3.** They
touch disjoint files. Phase 4 depends on neither.

---

## 4. Findings, reported and not fixed

### 4a. `bid.revise` can crowd the agency's feed, and migration 100 widens the population

`ACTIVITY_FETCH_LIMIT` is 200 per source; `RECENT_ACTIVITY_LIMIT` is **15 lines**, applied
after grouping. `bid.revise` fires once per submitted revision, is **not** on
`UNION_REPLACING_EVENT_TYPES`, and cannot group - the group key compares `created_at`
exactly, and separate requests are separate transactions. Eleven revisions in an afternoon
are eleven lines out of fifteen.

**This is live today** for every vendor who has a partnership, through branch A. Migration
100 changes the **population**, not the mechanism. Not fixed: both available fixes are feed
redesigns that `lib/activity-feed.ts` explicitly argues against in its own headers, and the
brief says do not redesign the feed.

### 4b. A vendor owed money may already be unable to see the record

`app/api/partner/payments/route.ts:77` filters partnerships to `.eq("status", "active")`.
The `payment_milestones` policies carry **no** status predicate, so **the data stays
readable and the screen goes blank.** Any end state - including `removed`, which an agency
can already write to an **active** partnership through `PATCH /api/partnerships`, since the
route validates the value and never checks the prior status - silently empties that
vendor's payments page.

The product has already half-answered a ruling nobody was asked, in the direction nobody
would choose, through an application filter. **The line was left exactly as it is**, because
which way it should move is Q2 of `docs/relationship-end-rulings.md`.

### 4c. Two statuses with a badge, a column and no way in

`suspended` and `terminated` are in the CHECK constraint, have badges on the pool page and a
column in `lib/partnership-state.ts`. **Neither side can reach them from an active row.** The
only `terminated` write in `app/` is the vendor declining a **pending** invitation, gated at
`app/api/partnerships/route.ts:1061`.

---

## 5. Where the brief was wrong

Four, all corrected in place in the code or docs rather than only noted here.

1. **`status_update.post` is not affected by ruling 6.** The brief and
   `docs/emitter-rulings-owed.md` both list five affected emitters. Its route 403s with
   "No partnership" when the caller has none (:150), resolves its assignment
   `.in("partnership_id", partnershipIds)`, and **skips the emit outright** when the
   partnership is not in the caller set (:300). Its `partnership_id` is non-null by
   construction. And the guest `bid.submit` is service-role, so RLS never applied to it.
   **Four types, three portal routes.**
2. **`rfp.view` does not fire on every page load.** The brief's premise for 3f. The update
   carries `.is("viewed_at", null)` and the emit sits inside `if (updatedInbox)`, so it
   fires **once per inbox row, ever**. The real flood risk is `bid.revise` - see 4a. The
   correction changes the answer, not just the wording.
3. **"No policy anywhere filters on `partnerships.status`" is not accurate.** Two
   `SECURITY DEFINER` helpers do, and both gate live policies:
   `current_user_commercial_counterparty_org_ids()` (085) excludes `terminated` and
   `removed` and gates `profiles`; `current_user_active_counterparty_user_ids()` (079)
   requires `active` and gates the `notifications` INSERT. **So ending a relationship
   already revokes commercial profile data and cross-party notifications**, and 085 is a
   worked precedent for the mechanism the options keep proposing. The accurate claim is
   narrower: no policy on any **delivery artifact** table filters on status.
4. **The owed doc's amendment on ruling 5 is correct but does not block it.** Re-verified:
   `loadBidAnalysisContext` genuinely omits `partnership_id` and Option A genuinely cannot
   be built without it. **Option B was ruled**, and gate 1 for an agency-side write is
   `org_id IN current_user_org_ids()` alone. `lib/bid-analysis-context.ts` is unchanged. The
   amendment stays in the file because it remains a live prerequisite for Option A and for
   new ruling 7.

---

## 6. What could not be established

Everything here needs a database and none of it was guessed.

- **Is 088 applied?** `LIGAMENT_CONTEXT.md`'s migration log stops at 078 and names only
  079, 080, 082 and 087. This is **pre-flight P1** of migration 100 and it can stop the
  migration outright: if 088 was never applied, 100's `DROP POLICY IF EXISTS` would create a
  policy where none existed, which is 088 and 100 arriving together under one number.
- **How many vendors branch B will actually unblock.** Pre-flight P4, in two queries, one
  per sub-arm. **It may be zero**, in which case the repair is correct and unexercised, and
  reading an unchanged feed as failure would be wrong.
- **Whether the live policy still matches what 100 thinks it replaces.** Pre-flight P2, by
  eye, against the predicate printed in the migration header.
- **How many `bid.revise` rows a real vendor writes in a real bidding window** (4a).
- **The five counts in section 6 of `docs/relationship-end-rulings.md`.**

---

## 7. LIVE CHECKLIST

For **gmarkant@gmail.com** (the "m a r k a n t" lead agency) and the vendor account
**gmarkant@icloud.com**. Steps 1 to 6 need no migration. Steps 7 to 12 are the migration.

**Nothing below has been done. `git push` has not been run and must not be until Greg says
so.**

1. **Deploy the branch to a preview** (do not merge). Confirm the preview builds - `pnpm
   build` is 0 locally.

2. **AGENCY FEED, `bid.analyze`.** As gmarkant@gmail.com, open a bid with a cost breakdown
   that has never been generated and click through to generate it. Then open
   `/agency/dashboard` and confirm Recent Activity shows **`analyzed a bid on {scope}`**.

3. **AGENCY FEED, `bid.analyze_retry`.** Re-run the breakdown on the **same** bid (the
   force path). Confirm the new line reads **`re-ran the analysis of a bid on {scope}`** and
   not the first wording. *This is the server-determined discriminator from section 2. If it
   says "analyzed" again, the prior-row read is not working.*

4. **THE COMPARE ROUTE IS SILENT.** Select two or more bids and run a comparison. Confirm
   **no new line of any kind** appears on the feed, and in particular nothing naming a count
   of vendors.

5. **NO VENDOR FEED SHOWS ANY OF THEM.** Sign in as gmarkant@icloud.com and confirm that
   **none** of `vendor.remove`, `vendor.blacklist`, `rfp.generate`, `bid.analyze` or
   `bid.analyze_retry` is visible anywhere in the vendor portal. *Expected structurally:
   none is on `vendor_visible_event_types()`, and `rfp.generate`, `bid.analyze` and
   `bid.analyze_retry` also carry a null `partnership_id`.*

6. **THE OTHER THREE PHASE 1 TYPES.** As the agency: generate a master RFP (confirm
   `generated the master RFP for {project}`), blacklist a vendor from the Vendor Pool notes
   panel (confirm `blacklisted {vendor}`), then **save the same notes panel again without
   touching the flag** and confirm **no second line appears**. *That last step is ruling 2's
   transition test, and it is the one most likely to be wrong.*

---

*From here on, the migration. Do not start until steps 1 to 6 pass.*

7. **PRE-FLIGHT P1 AND P2. These can stop everything.** Run P1 from
   `supabase/migrations/100_milestone_inbox_pin.sql`. **Zero rows means 088 was never
   applied: STOP**, apply 088 first. Then read the `with_check` by eye against the full
   predicate in that file's header (P2). If it differs anywhere, **STOP** - something was
   changed outside this repository.

8. **PRE-FLIGHT P3, P4 AND P5.** Record all four numbers, especially **P4's two counts**.
   If both are zero, expect the feed **not** to change and do not read that as failure.

9. **Run `supabase/migrations/100_preapply_test.sql`.** One paste, one batch, do not run it
   in pieces. **It ends in a red error box and that IS the output.** Read the first line.
   Anything other than "SAFE TO APPLY 100" means stop. Note which subject path it used.
   *While you are in the editor, answer 4a: `SELECT count(*) FROM
   partner_rfp_response_versions GROUP BY response_id ORDER BY 1 DESC LIMIT 5;`*

10. **Dry run, then apply.** Change `COMMIT;` on **line 528** to `ROLLBACK;`, run the whole
    file, confirm no errors, change it back, run for real. Expect "Success. No rows
    returned". Then run V1 to V4 at the foot of the file. **V4 must return ZERO rows** - a
    row there means an earlier draft was applied and the live policy is not this one.

11. **V5, THE ONE THAT PROVES THE REPAIR: a magic-link vendor with no partnership now
    leaves a breadcrumb the agency can see.** Broadcast an RFP to an address that has **no**
    partnership with the m a r k a n t agency. Open it as that vendor and, if it is
    NDA-gated, acknowledge the NDA. Then as gmarkant@gmail.com confirm the agency's Recent
    Activity shows **`viewed the RFP for {scope}`** and **`acknowledged the NDA for
    {scope}`**, both naming the actor. *Before 100 both were refused with 42501 and the feed
    showed nothing.* Then submit a bid as that vendor and confirm **`submitted a bid on
    {scope}`** appears - **this is the bid sub-arm, and it is the half T3 does not cover.**
    If the first two work and this one does not, the `inbox_item_id` hop is wrong.

12. **AND THAT VENDOR STILL SEES NOTHING.** As the same unpooled vendor, confirm no feed or
    activity surface shows any of those three rows. *Expected structurally: a branch B row
    carries a null `partnership_id`, and 080's counterparty policy fails on its first
    clause. These rows are agency-readable only, which is the asymmetry ruling 6 Option A
    predicted.*

13. **Only then**, update the migrations table in `LIGAMENT_CONTEXT.md`. Its log stops at
    078 and already omits 079, 080, 082, 087 and 088; adding 100 without them is a fifth
    gap, so record 088's true state at the same time - step 7 establishes it.

14. **If anything in 10 to 12 fails**, roll back with
    `supabase/migrations/100_milestone_inbox_pin_down.sql` (BEGIN line 70, COMMIT line 103).
    **It deletes no rows and cannot** - `milestone_events` has no DELETE policy for anybody,
    so rows written while 100 was live are permanent, which is correct: they record acts
    that really happened.
