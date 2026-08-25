# Unattended session report

**Date run:** 2026-08-25  **Branch:** `fix/acting-role-read-scope` (4 new commits)
**Filename** keeps the 08-23 label the brief gave it; the work ran on the 25th.
**Not pushed. Not merged. No PR. 093 IS NOT APPLIED and no database was contacted.**

---

## COMPLETION, AT THE TOP

**All five phases completed.** Three things came out differently from what the brief
anticipated, and each is stated where it belongs rather than absorbed:

1. **Phase 2's premise does not survive reading the trigger.** The 079 `handle_new_user()`
   writes `role` and `active_role` from **one variable in one statement** and cannot produce
   `role='partner'` with `active_role='agency'`. The defect is elsewhere, it is in
   TypeScript, and it needs no migration. See section 2.
2. **Phase 4 is eight emitters, not twelve.** The survey's prose said 12/6; its own table
   says 11/7. Of the eleven, **three have no live server-side write site to emit from** -
   the survey counted "needs a wording" and never checked that. Their renderer entries
   shipped so no row can be silently dropped; their emitters did not, because an emitter
   bolted to a guessed site writes misattributed rows. See section 4.
3. **Phase 1's `contact_name` decision is a real widening of what 093 refuses**, not a
   documentation change, and the mechanism that makes it work is asserted rather than
   assumed. See section 1.

**Nothing was skipped.**

---

## WHAT I EXECUTED, READ, AND REASONED

**EXECUTED:** `npx tsc --noEmit`, `pnpm build`, `pnpm lint`,
`pnpm identity-columns:guard`, `pnpm org-id-reads:guard`, `pnpm embed-targets` - once, at
the end, per the brief. Plus `git`, `grep`, and `python3` for file edits.
**`verify-rls` and `policy-audit:guard` were NOT run**, per the brief; neither reads a `.ts`
file.

**READ:** `079_organizations.sql:1841-1926`; `087_partnership_vendor_identity.sql:596-668`;
`061_ghost_partnerships_and_domain_match.sql:1-24`; `080_milestone_events.sql:161-207`;
`app/auth/sign-up/page.tsx` in full; `app/auth/callback/route.ts:1-140`;
`app/api/user/active-role/route.ts`; `app/api/profile/switch-role/route.ts`;
`components/role-toggle.tsx`; `lib/activity-feed.ts`; `lib/milestone-events.ts`;
`lib/capabilities.ts`; and the eight routes that gained an emitter.

**REASONED:** the jsonb-subtraction argument in 1(a); that the 079 trigger cannot produce
the observed row; that three emitter types have no live site; that all eight new event types
are agency-internal and therefore need no migration. Each is argued from a quoted line, and
each could be wrong the way a careful reading can be wrong.

**NOT DONE:** no SQL executed, no migration applied, no repair run, nothing pushed. Every
row count in this document that I did not compute from source is marked NOT MEASURED with
the query that settles it.

> **"Success. No rows returned" in the Supabase SQL Editor is identical for a dry run, for a
> real apply, for a statement that matched nothing because row level security filtered it
> out, and for a query pasted into the wrong tab.** It reports that a batch finished without
> returning a result set and nothing else. Both SQL deliverables here carry verification
> blocks for that reason, and `docs/inbox-name-backfill.sql` carries an in-transaction
> assertion because its most likely failure - running it as an agency session - looks
> exactly like success.

---

## 1. Phase 1: RULED-093-1, and the jsonb finding

### What changed

`contact_name`, `company_name`, `phone` and `website` are **removed from
`v_vendor_permitted`** and are therefore **guarded**. A vendor may now write exactly five
columns, plus `profile_status` on the claim transition.

Greg's reasoning is recorded verbatim in the migration header as **RULED-093-1**: guarding
forecloses nothing because the lead agency exits at EXIT 3 above the permit list; the cost is
asymmetric (one removal and one assertion flip now, versus a second migration and a second
pre-apply cycle later); and permitting would let a vendor rename itself inside the agency's
own pool record and put a vendor-controlled URL in a trusted agency surface.

The third point is now evidenced rather than asserted:
`app/api/agency/pool/[partnerId]/route.ts:239` renders `partnerships.contact_name` as the
fallback for a missing `full_name`, so the agency's own view of who it is dealing with was
vendor-writable.

### 1(a) THE JSONB-SUBTRACTION FINDING

**The claim under test:** taking a name off `v_vendor_permitted` makes that column guarded,
by omission, with no other edit.

**Finding: it holds, and the reason is that `to_jsonb()` on a record emits null-valued keys
rather than omitting them.**

- `to_jsonb(OLD)` on a record produces one key per attribute. A SQL NULL becomes the JSON
  value `null` - **the key is present with a null value, not absent**. The canonical
  documentation example is `to_jsonb(row(1,'foo',null))` -> `{"f1":1,"f2":"foo","f3":null}`,
  and the existence of `jsonb_strip_nulls()` is the other half of the proof: a function whose
  entire job is removing null-valued keys would have nothing to do if they were never emitted.
- `jsonb - text[]` deletes named keys and is a no-op for a name that is not a key. A name
  removed from the array simply stops being deleted and the key returns to **both** sides.
- jsonb equality is structural over the canonicalized binary form, so key order cannot
  perturb it.

**The three NULL cases:**

| Transition | Compared as | Detected? |
|---|---|---|
| NULL -> value | `null` vs `"x"` | **yes** |
| value -> NULL | `"x"` vs `null` | **yes** |
| NULL -> NULL | `null` vs `null` | no, correctly - nothing moved |

So EXIT 1 is exactly as sensitive for a NULL column as for a populated one, and the
`v_moved` diagnostic works too: every key is present on both sides, so `v_new_rest -> k`
never returns SQL NULL and `IS DISTINCT FROM` degenerates to `<>` while staying correct.

**WHERE IT IS *NOT* SYMMETRIC**, which is the part worth carrying forward:

1. **The direction of danger flips.** A name added in error permits a column nobody meant to
   permit - a silent hole in a file that looks correct. A name removed in error refuses a
   column something legitimately writes - a loud breakage that surfaces the first time that
   writer runs. The second is worse to ship and far easier to notice, which is why the
   permitted-direction assertions (T1-T5, T12) are the most urgent in the test.
2. **The cost of EXIT 1 moves.** With four fewer permitted columns, a write touching one of
   them no longer leaves at EXIT 1; it falls to EXIT 2 (`auth.uid()`) and possibly EXIT 3 (a
   query). Adding to the list can only make the guard cheaper; removing can only make it
   dearer. Costs nothing today - the only writers of these four are service-role callers that
   stop at EXIT 2.
3. **A misspelled name is a silent no-op in both directions**, but *forgetting* to remove one
   leaves a column permitted with no error anywhere. That is why THE RECONCILIATION is a
   table of all 24 columns with a stated final count rather than a diff.

> **VERIFIED BY READING THE DOCUMENTED SEMANTICS, NOT BY EXECUTION.** This session has no
> database. **Assertion T20 was added so the claim is proved empirically on Greg's run**: it
> establishes its own precondition, then clears a guarded column to NULL as the vendor and
> requires LG009. Every other assertion in the file moves a column from one non-null value to
> another, so not one of them touched this case.

### 093's new assertion count: **20** (was 19)

| Change | Assertion |
|---|---|
| **Flipped** | **T17** - was "the four contact columns are PERMITTED"; now "vendor rewrites contact cols" and requires **LG009 specifically**, following T6-T10's shape. A refusal with any other code is reported as a different defect, not as a pass. |
| **Extended** | **T12** - now writes the four contact columns alongside `nda_confirmed_at` from the lead agency. |
| **Added** | **T20** - a guarded column cleared to NULL is still refused. |

**T12's honesty clause, because this is the trap the brief named.** An agency session returns
at **EXIT 3, which is above the permit list and does not consult it**. So a PASS on T12
demonstrates **that EXIT 3 fires** - and nothing at all about whether those four columns are
on any list. The same PASS would appear if the permit list were empty or held all 24 names.
It is worth asserting because **RULED-093-1's reasoning turns on "guarding forecloses nothing
because the agency exits above the list", and T12 is the evidence for that clause.** If it
fails, the ruling's premise is false - because the AGENCY lost something, not the vendor. The
claim "the vendor cannot write them" is T17's alone, and the assertion text says so.

### Final counts against the live 24

| Disposition | Count | Columns |
|---|---|---|
| PERMITTED-093 | **5** | `status`, `accepted_at`, `updated_at`, `payment_terms_requests`, `vendor_org_id` |
| PERMITTED on the claim transition only | **1** | `profile_status` |
| GUARDED-BY-093 | **17** | everything else except `lead_org_id` |
| GUARDED-BY-087 | **1** | `lead_org_id` |
| | **24** | 5 + 1 + 17 + 1, none counted twice |

`vendor_org_id` is permitted by 093 **and** constrained by 087 in three directions. That
reads like a contradiction and is not: it is the claim path, 087's checks run first in the
same function, and "permitted" here means "not refused by the permit list", never
"unchecked". The header says this under THE ONE THAT READS LIKE A CONTRADICTION.

### Line numbers, re-grepped

| File | BEGIN | plpgsql BEGIN | COMMIT |
|---|---|---|---|
| `093_partnership_claim_and_column_guard.sql` | **612** | 695 | **860** |
| `..._down.sql` | **83** | 114 | **180** |
| `docs/093-preapply-test.sql` | **225** | - | none; ends `ROLLBACK;` at 1573 |

Test confirmed **1 BEGIN / 0 COMMIT / 1 ROLLBACK**, ends on `ROLLBACK`. `expected 20` appears
in all three required places (the two report lines and the `v_ran = 20 AND v_pass = 20`
verdict condition), and the permit list in the test's Section A is byte-identical to the
migration's.

### The down file

It said 093 does not guard the four and enumerated thirteen it reopens. **Both were wrong
after the ruling.** It now enumerates **eighteen** of the twenty-four, includes
`profile_status` (093 permits it only on the claim transition, so the down file removes a
real guard), and states plainly that the four contact columns are in that list *now* and were
not before.

---

## 2. Phase 2: the 056 decision Greg owes

Full report: **`docs/056-trigger-report.md`**. Nothing was fixed and no migration authored.

**The headline finding contradicts the brief's framing, and the difference decides where the
fix goes.** `handle_new_user()` (079:1841-1926) writes:

```sql
chosen_role := CASE WHEN NEW.raw_user_meta_data->>'role' = 'partner'
                    THEN 'partner' ELSE 'agency' END;   -- :1853
...  role, active_role, secondary_role
VALUES ( ..., chosen_role, chosen_role, other_role )    -- :1873-1875
```

**`role` and `active_role` come from the same variable in the same INSERT.** They cannot
differ. `ON CONFLICT DO UPDATE` deliberately excludes all three. **So the trigger cannot have
written `role='partner'` with `active_role='agency'`** - a second write did.

**The form is not at fault either.** `app/auth/sign-up/page.tsx:206` sends the key under the
right name, and all four paths to step 2 set `role` first (:68, :74, :265, :290), so a
browser cannot submit a null role. It is not a boundary - `signUp()` is client-side with the
anon key - but the product path is sound.

**The defect is the CONTRACT, in two places, both TypeScript:**

| # | Defect | Site |
|---|---|---|
| 1 | **Opposite defaults for a missing key.** Trigger -> `'agency'`; callback -> `'partner'` (`metadata.role \|\| 'partner'`) | `app/auth/callback/route.ts:12` |
| 2 | **An asymmetric write.** `updatePayload.role = role` with **no `active_role`** - the only site in the repository that can make the two columns diverge | `app/auth/callback/route.ts:87` |

### THE DECISION GREG OWES

**Which default is correct for a signup whose metadata carries no role?** The two components
must agree and today they are opposites.

- **`'agency'`** - change `route.ts:12`. Matches the trigger, so the account is stable
  whether or not the callback runs.
- **`'partner'`** - requires a migration to change the trigger. The one option that needs the
  thing this report advises against.
- **Refuse** - stop defaulting, and assert in the form. Nothing silently lands on the wrong
  side; costs a visible failure on a malformed signup, which is where it belongs.

**`route.ts:87` should be fixed regardless.** Writing `role` without `active_role` is wrong
under every answer.

**Run this query first** - everything above assumes the live trigger is 079's:

```sql
SELECT p.proname,
       pg_get_functiondef(p.oid) LIKE '%chosen_role,%chosen_role,%' AS writes_both_from_one_var
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
```

False means the live function is not what this repo says, and section (a) of that report is
about a function that is not running.

---

## 3. Phase 3: the backfill and its product question

**`docs/inbox-name-backfill.sql`.** NOT RUN, NOT a migration, deliberately in `docs/`.
Section 1 counts before anything changes; section 2 repairs inside one transaction; section 3
verifies. `IS DISTINCT FROM` throughout, so it is idempotent and so NULL snapshots are not
skipped. **BEGIN 202 / plpgsql BEGIN 212 / COMMIT 272**, stated in its header.

**Its most likely failure looks exactly like success**, so an in-transaction assertion catches
it: `partner_rfp_inbox` has **no agency-side UPDATE policy**, so an agency session matches
zero rows and the editor reports success. If `v_before > 0` and `v_written = 0` the block
raises `REPAIR REFUSED` naming the cause.

> **A design note worth flagging:** I first wrote section 2 to end in a "REPAIR OK" RAISE, as
> 093's pre-apply test does. That was wrong and I removed it. **The test is a test - its job
> is to report and roll back. This is the repair**, and a repair that always aborted would
> need editing before it could run, which means the thing Greg runs would not be the thing
> that was reviewed. The two RAISEs that remain fire only on failure.

### THE PRODUCT QUESTION, stated and not answered

**A snapshot records what was true when the RFP was sent. Overwriting it with today's name
makes an old RFP claim it came from a company under a name that did not exist then.**

| Choice | Cost |
|---|---|
| **(A) Keep it as history** | The vendor's screen keeps splitting one agency into several, the header count stays wrong, agency-name search keeps missing rows, and every future rename adds another false group. **And nothing in the product presents this field AS history** - no "sent as" label, no date qualifier. The historical value is being preserved and not communicated, which is the worst of both. |
| **(B) Refresh it** (this file) | **The historical name is destroyed.** `organizations` holds only the current name and there is no rename audit anywhere in the schema. After this runs nothing in the database knows the agency was ever called anything else. And it drifts again on the next rename, forever. |
| **(C) Stop grouping by the string** | Not implemented, and probably right. `/api/partner/rfps` already batch-loads `organizations` (`:195-209`), so the join is already being made. Grouping by `lead_org_id` makes the drift **unrenderable** rather than repaired and leaves the snapshot intact as history. Costs a product ruling about what a vendor sees for an agency they have no partnership with. |

**If (C) is the answer, do not run section 2 at all** - it would destroy the historical names
to fix a symptom (C) removes without them.

**Affected row count: NOT MEASURED.** Section 1b is the query, and it shows every stale
spelling beside the current name, because a count cannot tell a rename from a value that is
legitimately different.

---

## 4. Phase 4: eight wordings shipped, seven rulings owed, three with nowhere to emit

### The arithmetic first

The brief said **twelve** need only a wording and **six** need a ruling. That came from
`docs/emitter-coverage.md` §4's prose, **which disagrees with its own table**. Counting the
table: **eleven** need only a wording (25, 28, 30, 31, 32, 33, 36, 39, 40, 41, 42) and
**seven** need a ruling (26, 27, 29, 34, 35, 37, 38). 7 + 11 = 18. The seven are covered by
**four** questions, which is the likeliest source of "six". **I followed the table** and
corrected the prose in that file.

### The eight that shipped - emitter, renderer and vocabulary entry

All eight are **agency-internal**. None is on `vendor_visible_event_types()`, so **none needed
a migration**: 080's agency INSERT policy constrains `actor_side`, `org_id` and `actor_id` and
deliberately says nothing about `event_type`. All eight were already in `CAPABILITY_MINIMUM_ROLE`,
so `Capability` - the type `recordMilestone` enforces - already covered them.

| Type | Wording | Payload | Emitter |
|---|---|---|---|
| `vendor.add` | added {vendor} to the vendor pool | *(empty)* | `pool/add-partner/route.ts:76` |
| `client.create` | added the client {client} | `client_name` | `agency/clients/route.ts:144` |
| `client.document_add` | added a document to {client} | `client_name` | `library-documents/route.ts:156` |
| `client.document_remove` | removed a document from {client} | `client_name` | `library-documents/[id]/route.ts:134` |
| `bid.score` | scored a bid on {scope} | `scope_item_name` | `bids/[responseId]/evaluation/route.ts:426` |
| `delivery.review_complete` | completed the delivery review for {vendor} | *(empty)* | `delivery-reviews/route.ts:367` |
| `msa.create` | created the MSA with {vendor} | *(empty)* | `agency/msa/route.ts:205` |
| `msa.milestones_set` | set the payment schedule for {vendor} | *(empty)* | `msa/milestones/route.ts:556` |

**Vendor-side copy: there is none, and that is the correct answer rather than an omission.**
There is one predicate per type, shared by both feeds; what differs is the actor, resolved per
feed. For these eight the vendor feed renders **nothing at all**, because the counterparty
SELECT policy requires whitelist membership and the row never reaches it. Putting any of them
in front of a vendor is a migration against 080 plus a visibility ruling.

### Payload discipline

**Five of eight payloads are empty.** Nothing carries a composite score, a delivery score, an
AI summary, client feedback, a milestone amount, a document label, a blob url, an email
address, or a count of anything.

- **`bid.score` carries the scope item, never the score.** A score is the agency's private
  assessment of one vendor. The line says an act happened without publishing its content.
- **`delivery.review_complete` carries nothing.** Migration 073 exists precisely because a
  delivery review is not automatically the vendor's to read.
- **`msa.milestones_set` carries no amount.** The amount is *the* commercial term.
  `payment.mark_paid`'s own comment is the worked example, and this one carries nothing even
  though it is not whitelisted - because "not whitelisted today" is a property of a migration
  file, not of a payload.
- **`bid.score` and `delivery.review_complete` emit on completion only.** Both handlers are
  save buttons; an unconditional emitter would put one feed line per autosave.
- **`partnershipId` is deliberately NULL on all three vendor-related types.** It is the column
  counterparty visibility keys on, so these rows stay unreachable **even if someone later
  whitelists the type by mistake** - two independent reasons rather than one.
- **`client_name` is the one field that must never reach a vendor**, and
  `lib/activity-feed.ts` `payloadString()` now records that coupling at the single place a
  payload is read: whitelisting any `client.*` type would look like a visibility change and
  would in fact also be a disclosure.

### The three that could not ship

**The survey counted "needs a wording" and never checked that a live server-side write site
exists.** Renderer entries shipped for all three, so if a site is built the line already
exists and no row can be silently dropped.

| Type | Why not |
|---|---|
| `project.client_change` | The only server route that changes a project's client is `PATCH /api/projects/[id]`, whose **session auth CLAUDE.md records as broken and unused by the frontend** (backlog P6). The live path is a browser Supabase write. An emitter there would never fire. |
| `rfp.brief_upload` | No route persists "a brief was uploaded for this project". The file goes through the generic `/api/upload`, which has no RFP context; `/api/ai/master-brief` writes nothing. The act lives in wizard client state. |
| `rfp.scope_allocate` | No separate allocation step exists. Scope items reach the database only when `rfp.broadcast` fires, which already emits. Two lines for one act. |

**None is a wording problem and none is a policy problem.** Each needs a decision about *where
the act happens* - smaller than the four rulings below, still not mine.

### THE SEVEN TYPES / FOUR RULINGS GREG OWES

1. **`vendor.remove` / `vendor.blacklist`** - *Should removing or blacklisting a vendor leave
   a permanent breadcrumb on a feed the removed vendor's organization may later read, or is a
   removal an agency-internal act that leaves no trace the counterparty can ever see?*
2. **`client.edit`** - *Does every edit to a client record deserve a feed line, or only the
   ones that change something a vendor would notice, given that a per-edit breadcrumb turns
   the feed into a change log?*
3. **`rfp.generate` / `rfp.regenerate`** - *Is an AI generation a milestone at all, or is only
   the resulting broadcast one, given that regenerating five times before sending would put
   five lines on the feed for one act?*
4. **`bid.analyze` / `bid.analyze_retry`** - *Same question for bid analysis: is the analysis
   the milestone, or is only the human decision that follows it the milestone?*

---

## 5. Gates

Run once at the end, per the brief. `verify-rls` and `policy-audit:guard` **not run**.
Compared against the last recorded baseline (`docs/read-scope-session-report.md` section 9).

| Gate | Last baseline | This run | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0, 0 lines | **exit 0, 0 lines** | none |
| `pnpm build` | exit 0, 72 static pages, 173 routes | **exit 0, 72 pages, 173 routes** | none |
| `pnpm lint` | exit 1, 182 problems (154 errors, 28 warnings) | **exit 1, 182 (154 / 28)** | none |
| `pnpm identity-columns:guard` | exit 0, PASSED, TOTAL 0, 385 files | **identical** | none |
| `pnpm org-id-reads:guard` | exit 0, PASSED. A: OPEN 14, ALLOW 3, REGR 0, IMPR 0. B: OPEN 60, REGR 0, IMPR 1. 384 files | **identical** | none |
| `pnpm embed-targets` | exit 0, TOTAL 0, 385 files | **identical** | none |

**Every movement in either direction: none.** Diffed mechanically, not by eye - the finding
lines of all three guards are byte-identical to the baseline, and the lint **file set** is
byte-identical too (same totals can hide a swap, so the locations were diffed as well).

**Why nothing moved, which is the part worth checking rather than celebrating:**

- **Scanned file counts are unchanged (385 / 384 / 385)** because this session added **no new
  `.ts` or `.tsx` files**. Phases 1-3 touched only `.sql` and `.md`; Phase 4 edited eleven
  existing files and created none.
- **Phase 4 added ~450 lines of TypeScript and moved no lint finding.** The new code
  introduces no `any`, no unused directive, no hook, and no `setState` in an effect - the four
  rules that account for the standing 182.
- **No guard could have moved.** `identity-columns` looks for legacy company column names,
  `org-id-reads` for a `profiles` row fetched by an id an organization column may have
  supplied, and `embed-targets` for embeds across FKs 079 repointed. The new emitters read
  `organizations`-derived ids that were already resolved by the surrounding handler and
  fetch no `profiles` row by any of them.
- **No guard allow-list or KNOWN_OPEN count was edited.** The pre-existing
  `IMPROVED 1 - lib/entitlements.ts recorded 1, found 0` in the Class B mirror is present and
  untouched, exactly as at baseline.

---

## 6. OPEN items, each with the query or check that settles it

| Id | Item | What settles it |
|---|---|---|
| **RULED-093-1** | The four ghost-contact columns. **CLOSED by ruling**, implemented, asserted by T17. | Verification V3 after applying 093; T17 in the pre-apply test. |
| **OPEN-056-1** | Which default is correct for a signup with no `role` in metadata. The trigger says `'agency'`, the callback says `'partner'`. | A product ruling. The code change is one line either way at `app/auth/callback/route.ts:12`. |
| **OPEN-056-2** | Is the live trigger actually 079's? Everything in the 056 report assumes so. | `SELECT pg_get_functiondef(oid) LIKE '%chosen_role,%chosen_role,%' FROM pg_proc WHERE proname='handle_new_user';` |
| **OPEN-056-3** | How many live profiles have `role` and `active_role` disagreeing. | `SELECT count(*) FROM public.profiles WHERE role IS DISTINCT FROM active_role OR role IS NULL;` - full form in the 056 report §(d). |
| **OPEN-056-4** | Which mechanism produced profile `647261c4` specifically. | The `auth.users` metadata query in the 056 report §(d). `metadata_role='partner'` means a second write did it; NULL means the trigger's `ELSE` fired legitimately. |
| **OPEN-RS-6** (carried) | Whether to stop grouping the vendor RFP list by the snapshot string - option (C) in section 3. | Product ruling: it changes what a vendor sees for an agency they have no partnership with. |
| **OPEN-BF-1** | How many `partner_rfp_inbox` rows carry a drifted snapshot. | Section 1a of `docs/inbox-name-backfill.sql`. Run 1b before acting on 1a. |
| **OPEN-BF-2** | Inbox rows whose `lead_org_id` has no `organizations` row. The repair's INNER JOIN cannot see them. | Section 3, V3 of the backfill file. |
| **OPEN-EMIT-1** | `delivery.review_complete` emits on a re-save of an already-complete review, not only on the transition. The prior status is gone by the time the emitter runs. | Code, not a query: read the row before the upsert. A change to the handler's query plan, not to a breadcrumb. |
| **OPEN-EMIT-2** | Three types have no live write site (`project.client_change`, `rfp.brief_upload`, `rfp.scope_allocate`). | A decision about where each act happens. `project.client_change` also depends on backlog P6, the broken `/api/projects/[id]` session. |
| **OPEN-EMIT-3** | Seven types need the four rulings in section 4. | Product rulings. |
| **OPEN-RS-4** (carried) | `resolveActingOrgId()` fails closed for a multi-membership caller while the detail route does not - a list/detail divergence. Unreachable today. | `SELECT user_id, count(*) FROM org_members GROUP BY 1 HAVING count(*) > 1;` Re-run the day colleague invitations ship. |
| **OPEN-RS-2** (carried) | `agency_partner_invitations` carries five policies and zero application reads. | `SELECT count(*) FROM agency_partner_invitations;` |
| **OPEN-RS-3** (carried) | `payment_milestones` carries three identical partner SELECT policies. | `SELECT policyname, qual FROM pg_policies WHERE tablename='payment_milestones' AND cmd='SELECT';` |
| **OPEN-RS-5** (carried) | `GET /api/projects/[id]/messages` has no UI. | `grep -rn "/messages" app components hooks lib contexts \| grep -v "^app/api/"` |

---

## 7. Commits

| Commit | Phase |
|---|---|
| `53cc07f` | 1 - RULED-093-1, the permit list narrowed to five, T17 flipped, T12 extended, T20 added |
| `30172f5` | 2 - the 056 trigger report |
| `2a5a214` | 3 - the inbox agency-name backfill |
| `b14e1d3` | 4 - eight emitters, eleven wordings, the three with no site |

**Not pushed. Not merged. No PR opened. 093 was not applied, the backfill was not run, and no
database was contacted at any point.**
