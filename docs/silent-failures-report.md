# The silent failures run

Branch `feat/silent-failures`, cut from `main` at `b084eb3`. Three commits, one per phase.
**NOT PUSHED. NOT MERGED. NO MIGRATION AUTHORED. NO SQL RUN.**

Written against `docs/101-phase0-baseline.md`, whose findings were the brief. Where that file
and the code disagreed, the code won and the disagreement is reported. There are four such
disagreements and they are in sections 1, 2 and 3.

**NO DATABASE WAS QUERIED AT ANY POINT.** This session had no credentials and did not seek
any. Every question needing a catalog read or a row count is in section 6 as a query for Greg,
with its expected value, and none of them was run.

---

## 0. THE HEADLINE, IN FOUR SENTENCES

1. **Phase 1 authored no migration.** The stop condition in 1c fired: nine tables hang off
   `partnerships.id` and they are the vendor's records, not the agency's. The dead control now
   says it is unavailable instead of failing when pressed.
2. **Phase 2's premise that nobody reads the logs is wrong.** Sentry is installed, initialized,
   wired into the build, has a production DSN and is already called by six routes. Every
   milestone drop now reports to it. That is a real observer, not theatre.
3. **Phase 3 confirmed ruling 5 is unbuildable as written, and found the repair is far cheaper
   than the baseline says.** Zero extra queries for portal bids.
4. **Every gate matches its known baseline exactly.** No regressions.

---

## 1. PHASE 1. THE DELETE HANDLER THAT CANNOT DELETE

Commit `626d27b`.

### 1a. The handler, the surface, and what a user sees today

| | |
|---|---|
| Handler | `app/api/partnerships/route.ts:1306` (`DELETE`) |
| Surface | `app/agency/pool/page.tsx`, `handleDeletePartner`, the `fetch` at `:671` |
| Control | "Remove from Pool", the `destructive-outline` button in the vendor detail panel |
| Confirm copy | "Remove {name} from your vendor pool? They will no longer have access to your projects. This action cannot be undone." |

**There is exactly one caller.** `grep -rn "partnerships?id=" app/ components/ lib/` returns
that one line and nothing else.

**WHAT A USER SEES TODAY: AN ERROR, AND IT IS THE HONEST ONE OF THE THREE.** The route
`.select('id')`s its own delete, finds zero rows, and returns **501** with "Partnerships cannot
be removed yet. Nothing has been changed." The page surfaces that string in an `alert()`.

**This is NOT the silent-success shape the brief feared**, and it is worth saying plainly
because the brief expected it might be. It used to be: the route's own comment block at
`:1352-1377` records that it returned `{ success: true }` and logged `[api] success` on every
call, because PostgREST does not report a zero-row DELETE as an error. A prior session fixed
that. What remained was a button that could only ever produce an error toast.

**WHY IT CANNOT DELETE, CONFIRMED FROM SOURCE RATHER THAN FROM THE ROUTE'S COMMENT.**
`grep -rn "ON public.partnerships" supabase/migrations/*.sql` returns the whole policy set:
079 `:1465` INSERT, `:1469` SELECT, `:1473` UPDATE, `:1481` SELECT (partner), `:1485` UPDATE
(partner), `:1493` UPDATE (claim), and 087 `:567` replacing the INSERT. **No DELETE policy in
any migration through 099.** RLS is enabled, Postgres denies by default, the statement matches
zero rows for every caller including the owning agency.

### 1b. Should the delete exist at all? THE BUTTON IS CLOSER TO THE MISTAKE THAN THE POLICY IS

**Read what the control claims to do and it does not claim a hard delete.** "Remove from Pool",
"Remove vendor?", "remove from your vendor pool", "they will no longer have access to your
projects". Every phrase is soft-removal language. Nothing on that surface says the vendor's
record is destroyed.

**AND THE SAME PAGE ALREADY SHIPS A WORKING CONTROL FOR EXACTLY THAT ACT.** The Discovered
column's "Remove" (`handleRemovePartnership`, `:631`) sends `PATCH { status: 'removed' }`, which
`:1019` validates and `:1280-1284` writes under the existing UPDATE policy. It works today.

So two controls on one page share one user-facing intent, one is wired to a handler that cannot
work and the other to a status change that can. **That is the strongest single argument that the
missing policy is not the bug.**

### 1c. What hangs off the row. THE STOP CONDITION FIRED

**NINE TABLES CARRY `partnership_id`.** Established by walking every `.from("<table>")` in
`app/`, `lib/` and `components/` and pairing it with a `partnership_id` field, then confirming
each against a live write site.

| Child table | What it holds | `ON DELETE`, from on-disk migrations |
|---|---|---|
| `partner_rfp_responses` | **the vendor's submitted bids** | **not on disk** |
| `partner_rfp_inbox` | **the requests the vendor was sent** | **not on disk** |
| `partner_status_updates` | **the vendor's own progress posts** | **not on disk** |
| `payment_milestones` | what the vendor is owed and was paid | **not on disk** |
| `msa_agreements` | the signed agreement | **not on disk** |
| `onboarding_packages` | what the vendor was asked to complete | **not on disk** |
| `project_assignments` | the awarded work | **not on disk** |
| `delivery_reviews` | the agency's review of the vendor | `CASCADE` (`066:21`) |
| `partnership_owners` | which colleague owns the relationship | `CASCADE` (`098:706`) |
| `milestone_events` | the feed breadcrumbs | `SET NULL` (`080:253`) |

**I CAN STATE THE `ON DELETE` ACTION FOR ONLY THREE OF THE TEN, AND I WILL NOT GUESS THE REST.**
The other seven foreign keys predate the on-disk migration history, and
`docs/schema-baseline-2026-08-13.sql` is a policy artifact that carries no constraint
definitions. `docs/organizations-m1-discovery.md`'s "Finding Zero" already records that the
migration history cannot reproduce the live database. **Q1 in section 6 settles it.**

**WHAT A HARD DELETE ACTUALLY DOES, ARGUED WITHOUT THE MISSING SEVEN.** It does not matter which
of the three actions those seven carry, because all three outcomes are unacceptable:
`CASCADE` destroys the vendor's bids and inbox rows; `RESTRICT`/`NO ACTION` makes the delete fail
on the first vendor who ever bid, so the button works only for vendors who never did anything;
`SET NULL` orphans a bid from the relationship that explains it. **The two children I CAN read
are both `CASCADE`**, which is weak evidence the others are too.

**THE RULING IS GREG'S AND THE STOP CONDITION IS MET.** The brief states his ruling for RFP
closure, made today: DELETE removes the row, CLOSE moves it to history and preserves the
vendor's record that a request was once made. **`partner_rfp_responses`, `partner_rfp_inbox` and
`partner_status_updates` are that record.** A delete that destroys a counterparty's bids is
precisely the outcome that ruling exists to prevent.

**SO NO MIGRATION 100 WAS AUTHORED, AND NO `100_preapply_test.sql`.** 1d is conditional on 1b
and 1c clearing. 1c did not clear. The question, with options, is section 5.

### 1e. What ships instead

**CHOSEN: THE CONTROL RENDERS AND PLAINLY SAYS IT IS UNAVAILABLE. It is not removed.**

It is `disabled`, carries a `title`, and sits above one line of copy: "Not available yet. This
vendor's bids, status updates and payment history are attached to this record, so removing it
needs a decision about what happens to them."

**Why disabled rather than not rendered.** Removing it would hide the open question from the
only people who can answer it, and would make the eventual ruling a rebuild rather than a
one-line revert. The confirmation dialog is deliberately left intact and unreachable, with a
comment saying so, for the same reason.

### DISAGREEMENT 1 WITH THE BASELINE, AND IT IS A LIVE DEFECT THE BRIEF DID NOT NAME

**Nothing in this run changes it. It is reported, and the question is section 5.**

`app/agency/pool/page.tsx:629` carried this comment on the working PATCH path: the Remove action
"hides the row from every pool section without deleting it."

**IT DOES NOT HIDE IT. IT PROMOTES IT.** `partnershipPoolColumn()`
(`lib/partnership-state.ts:71-74`) is `if (status !== "pending") return "network"`, and "network"
is the pool's **"Active vendors"** column. `'removed'` is not `'pending'`, so:

> **Pressing "Remove" on a Discovered contact moves that row OUT of the Discovered column and
> INTO Active vendors, badged `Vendor (removed)` by `partnershipStateLabel()`.**

Nothing filters it back out: `allNetworkRows` (`:1112`) applies no status exclusion, and the
default "All" status filter passes it through. `lib/partnership-state.ts`'s own header names
`suspended` and `terminated` as the ended states that belong in that column and does not mention
`removed`, so this is fallthrough rather than a ruling.

**The stat counters are correct.** `activePartnersStat` filters `status === 'active'`. The list
is wrong; the number above it is right.

**Only the false comment was corrected. The behaviour is untouched**, because which column a
removed row belongs in is a product decision and swapping one unasked behaviour for another is
not this run's call.

**This is also why the obvious Phase 1 fix would have been wrong.** Rewiring "Remove from Pool"
to the working PATCH would have replaced a control that fails honestly with one that succeeds
and moves the vendor into Active vendors.

---

## 2. PHASE 2. THE EMITTERS THAT DROP SILENTLY

Commit `9360f48`.

### 2a. The census, reproduced. MINE AGREES WITH THE BASELINE EXACTLY, AND THAT IS THE NEWS

**22 call sites. 20 `recordMilestone`, 2 `recordMilestones`.** Counted by walking every `.ts`
and `.tsx` outside `node_modules`, skipping comment lines, and matching
`\b(recordMilestones?)\s*\(`. The per-file breakdown matches the baseline's table row for row:
`partnerships` 5, `rfp-responses/[id]` 4, and one each at thirteen other routes.

**The brief warned that every count given to a run in this project has been a floor: 25 became
188 became 230 became 238. This one did not move.** The reason is that "emit site" is a
mechanically closed question here - there is one module, two exported functions, and a grep
answers it - unlike "writes to profiles" or "helpers", which are open-ended categories.

**THE NUMBER THAT IS NOT 22, AND IT IS THE MORE USEFUL ONE.** 22 counts CALL SITES, not rows and
not event types. Two sites are batches: `broadcast-rfp:566` writes one row per recipient
(unbounded, the largest observed batch is 49) and `magic-link:508` writes two event types in one
call. One site emits one of two types by branch (`bid.shortlist` / `bid.meeting_request`), and
another does the same for `bid.submit` / `bid.revise`. **So 22 sites produce 24 distinct event
types and an unbounded number of rows.** Anyone reasoning about blast radius from "22" will
undercount a broadcast by a factor of the recipient list.

### 2b. Which paths fail because data is absent, and which because a caller withheld it

I traced the `orgId` expression at all 22 sites. **The answer is much narrower than the baseline
implies, and it matters because it says which of the four paths is worth engineering for.**

| Path | `lib/milestone-events.ts` | Reachable in production today? |
|---|---|---|
| 1. No resolvable organization | `:227-233` | **NO. Not from any of the 22.** |
| 2. Schema cache miss | `:247-259` | Only as an environment fault |
| 3. Insert error, RLS refusal included | `:262-267` | **YES. This is the live one.** |
| 4. A throw | `:268-274` | Transport only |

**WHY PATH 1 IS UNREACHABLE, CHECKED SITE BY SITE.** Every one of the 22 gets its `orgId` from
one of two shapes, and both are closed:

- **Six sites pass `writeOrgId`** from `resolveCallerWriteOrgId()`. **All six guard it with an
  early return before reaching the emitter** - `projects:526`, `onboarding-packages:136`,
  `deploy:33`, `resend-invitation:89`, `broadcast-rfp:79`, `partnerships:406`.
- **The rest pass `orgIdFromColumn(<column>)`** where the column is `lead_org_id` or `org_id` on
  `partnerships`, `partner_rfp_inbox`, `partner_rfp_responses`, `projects` or `rfp_magic_tokens`
  - **and migration 079 `:969-991` made every one of those `SET NOT NULL`.**
- **The one site that looked reachable is not.** `msa/milestones:640` resolves `paidOrgId`
  through `orgIdByProjectId.get(...)`, a Map lookup that can miss. It cannot: the map is built
  from the same `agencyProjectRows` the update's `.in("project_id", agencyProjectIds)` filters
  on, so a row that reached the emitter is necessarily a key in the map, and a null
  `project_id` would have failed the update and returned 500 first.

**So path 1 is a guard against a FUTURE caller, not a live loss.** The callers that would trip
it are exactly rulings 3 and 4, which resolve a membership SET and never a single write id.
Baseline agrees; this confirms it with the site-by-site evidence it did not carry.

**PATH 3 IS THE LIVE ONE, AND THE DATA IS GENUINELY ABSENT.** 088's vendor INSERT policy
requires `partnership_id IS NOT NULL`. Three vendor sites resolve it non-fatally and can come up
null:

| Site | Types | Why null |
|---|---|---|
| `partner/rfps/[id]/route.ts:123` | `rfp.view` | vendor has no partnership row with this agency |
| `partner/rfps/[id]/response/route.ts:542` | `bid.submit`, `bid.revise` | same |
| `partner/rfps/[id]/nda-notify/route.ts:161` | `nda.acknowledge` | same |

**This is category one: the row genuinely does not exist.** A vendor reached by magic link who
has never been added to the pool has no partnership, and ruling 6 is the question of whether
they should be able to write at all. **Not a code fix, and this run does not attempt one.**

The fourth vendor site, `partner/projects/.../status-update:307`, is NOT affected: its
partnership comes off the project assignment, so one necessarily exists. Nor are the two
`invitation.*` sites, which act on a partnership row. Nor the guest site, which runs on the
service role and bypasses 088.

**ONE LATENT CASE OF CATEGORY TWO, WHICH THE BASELINE DOES NOT CARRY.** Those same three sites
pass `vendorOrgId: writeOrgId`, unguarded. `resolveCallerWriteOrgId()` returns null for a caller
with several memberships and none selected. That is unreachable today - `lib/acting-org.ts`
documents that every account has exactly one membership - **but it becomes reachable the day
colleague invitations ship, and then gate 1's `vendor_org_id IN current_user_org_ids()` refuses
these three sites for a second, different reason.** It is genuinely category two: the partnership
row those sites already fetch carries `vendor_org_id`, filtered `.in("vendor_org_id",
callerOrgIds)`, so the exact value is in hand and is not passed. **Not fixed here** - it changes
what is written, which is 2e's boundary - and it is Q4 in section 6.

### 2c. Making the loss visible. DISAGREEMENT 2, AND IT IS THE ONE THAT MADE THIS PHASE WORTH DOING

> `docs/101-phase0-baseline.md:414`: "**The only observer is the server log**, and no alerting on
> `[milestone]` exists in this repository."

**THAT IS WRONG, AND IT WAS WRONG WHEN IT WAS WRITTEN.** The baseline grepped for `[milestone]`,
found nothing outside the module, and concluded nothing watches. It did not grep for Sentry.

**SENTRY IS FULLY WIRED IN PRODUCTION. Five independent pieces of evidence, all read from
source:**

1. `@sentry/nextjs` `^10.48.0` is a dependency in `package.json`.
2. `sentry.server.config.ts` calls `Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN })`.
3. `instrumentation.ts:7` imports it on every Node server boot.
4. `next.config.mjs:1` wraps the build in `withSentryConfig`.
5. `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` are both set in `.env.production.local`.

**And six routes already call it** - `payment-synthesis:384`, `msa/ai-schedule`,
`admin/notify-new-user`, `admin/grant-access`, `ai/master-brief`, `ai/rfp-output-template`.

**So the answer to "WHO would ever see it" is: whoever reads Sentry, which is the same person
who already gets the AI-route failures. It is not theatre.** Had Sentry not been wired, the
right answer would have been to write the finding up instead, and this section would say so.

**WHAT SHIPPED.** `lib/milestone-events.ts` gains one `reportMilestoneDrop()` helper and calls
it on all four drop paths plus the `actor_email` conflict. Each carries a `drop_reason` tag, so
"how often does gate 1 refuse a vendor row" becomes a Sentry query. The `insert-failed` payload
additionally carries `vendorPartnershipMissing`, which separates ruling 6's known ongoing cost
from a genuinely new refusal. The throw path also sends the exception, because it is the only
one with a real stack.

**THE CONTRACT IS UNCHANGED AND THAT IS DELIBERATE.** Still `Promise<void>`, still catches
everything, still never throws, still never blocks. A vendor's bid submits whether or not its
feed row lands. The reporter itself is wrapped in try/catch so an unconfigured Sentry cannot
convert a lost breadcrumb into a thrown one.

**NOTHING IDENTIFYING IS SENT.** Event types, subject types, PostgREST codes, counts and
messages only. No payloads, no emails, no organization ids, no subject ids.

**A RETURN VALUE WAS CONSIDERED AND DECLINED.** The baseline offers `Promise<boolean>`, the shape
`createOrgNotification()` uses. Declined because **no caller would act on it**: all 22 emit after
their act has already committed and none has a second thing to do on failure. A boolean that 22
sites ignore is a wider signature with the same number of observers, which is the theatre this
change exists to avoid. Reversible in one commit if a caller ever gains a reason.

### 2d. The user-visible half. REPORTED, NOT REDESIGNED

**WHICH SURFACES READ THE FEED: EXACTLY ONE.** `grep -rn 'from("milestone_events")'` over `app/`,
`lib/` and `components/` returns `app/api/agency/dashboard/route.ts:177` and the module's own
insert. Rendered by `ActivityFeed` in `app/agency/dashboard/page.tsx:591`.

> **A CONSEQUENCE WORTH FLAGGING: NO VENDOR SURFACE READS `milestone_events` AT ALL.** 080's
> counterparty SELECT policy and its 23-value `vendor_visible_event_types()` whitelist currently
> serve no reader. Every gate-2 question in the six rulings is about a surface that does not
> exist yet. Reported, not acted on.

**WHAT A READER SEES WHEN AN EVENT IS MISSING, AND IT SPLITS IN TWO.** The dashboard merges
milestone rows with four derived timestamp sources, deduped by subject identity
(`UNION_REPLACING_EVENT_TYPES`, `lib/activity-feed.ts:503`). On collision the milestone wins
because it carries an actor.

| Lost event | Derived fallback | What the agency sees |
|---|---|---|
| `bid.submit` | `bid:<response_id>` from `partner_rfp_responses.submitted_at` | The line survives. **The actor is lost.** |
| `rfp.view` | `rfp_inbox:<inbox_id>` from `partner_rfp_inbox.viewed_at` | The line survives. **The actor is lost.** |
| `bid.revise` | **none.** A revision updates the same response row and writes no new derived line. | **The line does not exist.** |
| `nda.acknowledge` | **none.** No derived source at all. | **The line does not exist.** |

**DOES THE FEED PRESENT ITSELF AS COMPLETE?** The heading is
**`Recent activity ({items.length})`** - `app/agency/dashboard/page.tsx:603`. "Recent activity"
is a modest claim. **The parenthesised count is not.** It is a specific number, and it is
silently one lower than the truth every time a row is refused.

**That is the same shape as the defect `a97af0a` fixed on `main` this week** - the vendor
completion badge rendering a failed read as 0% - and it is the real half of this finding. The
Sentry line tells the operator; it tells the agency nothing.

**NOT REDESIGNED, per the brief.** A comment was added at the heading recording the claim, why
it can be short, and that the wording is a product decision. Q3 in section 6 measures it.

### 2e. Scope held

Nothing about **what** is emitted or **who can see it** changed. No event type added, no
whitelist touched, no policy touched, no payload field added or removed, no renderer changed.
Those are the six unanswered rulings and they are Greg's. The only behavioural delta is that a
write which fails is now known to have failed.

---

## 3. PHASE 3. RULING 5 CANNOT BE BUILT AS WRITTEN

Commit `4cebb5a`. **Nothing was built. Nothing was answered.**

### 3a. Confirmed from source

| | |
|---|---|
| The private resolver | `resolveBidMilestoneContext`, `app/api/agency/rfp-responses/[id]/route.ts:122`. Declared `async function`, **no `export`**. |
| What the analysis routes use | `loadBidAnalysisContext`, `lib/bid-analysis-context.ts:42`, called by `decompose/route.ts:147` and `compare/route.ts:120,125` |
| **Where `partnership_id` is absent** | **`lib/bid-analysis-context.ts:82`** |

**`:82` is the sharpest line and it is the one to quote.** It reads `partner_rfp_inbox` - the
exact table `partnership_id` lives on and the exact table `resolveBidMilestoneContext:136` reads
it from - as `.select("scope_item_name, scope_item_description")`. The column is one name away
and is not taken. The other projections at `:49-51` (the bid) and `:91` (`rfp_magic_tokens`) do
not carry it either, and `BidAnalysisContext` (`:13-27`) has no such field, so nothing
downstream could consume one.

**The blocker itself.** 080's counterparty SELECT policy opens with `partnership_id IS NOT NULL`,
so **Option A - "the vendor learns their bid was analyzed" - cannot happen with a null column,
whatever the whitelist says.** Options B and C need no column and are unaffected.

### 3b. What it would take. TWO DISAGREEMENTS WITH THE BASELINE, BOTH MAKING IT CHEAPER

| Bid shape | Reachable from what the route has? | Cost |
|---|---|---|
| **Portal** (`inbox_item_id` set) | **Yes.** `:82` already SELECTs that row, already scoped `.in("lead_org_id", orgIds)`. | **One column on an existing select. ZERO extra queries.** |
| **Guest / magic link** (`inbox_item_id` null) | **No.** `:91` reads `rfp_magic_tokens`, which has no such column. | One extra query against the synthesized `partner_rfp_inbox` row - what `resolveGuestBidContext:86-88` already does. |

> **DISAGREEMENT 3.** The baseline says Option A "begins with an extraction into `lib/`,
> exercised by **five** existing call sites", and ranks ruling 5 last partly on that.
> `grep -rn "resolveBidMilestoneContext(" app/ lib/` returns **two lines: the declaration at
> `:122` and ONE call at `:805`.** The other three emit sites in that file read
> `inbox?.partnership_id`, `inboxRow?.partnership_id` and `awardContext.partnershipId` directly
> and never touch the resolver. **One dependant, not five - and for portal bids no extraction is
> needed at all.**

> **DISAGREEMENT 4.** The baseline has the guest path resolving through `rfp_magic_tokens`. For
> scope text, yes. For `partnership_id`, no: `resolveGuestBidContext:82-88` states in its own
> comment that the synthesized `partner_rfp_inbox` row "is the only source of `partnership_id`".

**AND THE MULTI-VENDOR QUESTION ANSWERS ITSELF MECHANICALLY.** `compare/route.ts:125` already
calls `loadBidAnalysisContext` once per response inside a `Promise.all`. If the context carried
the column, N rows - one per response, the `rfp.broadcast` shape `recordMilestones()` exists for
- fall out with no further work. **It is the only shape gate 2 can serve, and it sharpens the
payload warning rather than softening it:** each vendor reads their own row, and any
comparison-derived field on it describes the other N-1.

### 3c. Where it was written

`docs/emitter-rulings-owed.md`, as an `### AMENDMENT` at the end of ruling 5's section.
**59 lines added, 0 deleted, nothing else in the document touched** (`git diff --stat` confirms
insertions only). **No ruling is answered.** The question and all three options stand as written;
one factual sentence they rest on is corrected so that whichever option Greg picks is
implementable.

---

## 4. PHASE 4. GATES

**EXECUTED, each as its own command, exit code captured with `$?` on an unpiped invocation.**

> **The harness tried to lie again and was caught.** The first `pnpm build` was run as
> `pnpm build 2>&1 | tail -25; echo $PIPESTATUS[0]`, which printed an **empty** exit code under
> zsh. It was re-run unpiped as `pnpm build > /tmp/build.log 2>&1; echo $?`. **Every exit code
> below comes from an unpiped run.** This is the third instance of the class the brief warns
> about and the rule that catches it is the same one: never read an exit code through a pipe.

| Gate | Exit | Status |
|---|---|---|
| `npx tsc --noEmit` | **0** | **PASS** |
| `pnpm build` | **0** | **PASS** |
| `pnpm lint` | **1** | Known pre-existing, `182 problems (154 errors, 28 warnings)` - the exact triple the brief names. Not a regression. |
| `pnpm verify-rls` | **2** | Known pre-existing. PostgREST does not expose `pg_class`; has never worked. |
| `pnpm identity-columns:guard` | **0** | **PASS.** "No legacy company identity column names in application source." |
| `pnpm org-id-reads:guard` | **0** | **PASS.** "Class B: 60 known-open sites, baseline unchanged." |
| `pnpm embed-targets` | **0** | **PASS.** TOTAL 0 in 0 files. |
| `pnpm policy-audit:guard` | **1** | Known pre-existing. Reads a static snapshot. |

**Lint errors were checked against the files this branch touches.** The three hits in touched
files are all pre-existing and none is on a line this branch added: `pool/page.tsx:372`
(setState in an effect), `dashboard/page.tsx:216` (`Date.now` during render),
`response/route.ts:329` (unused eslint-disable). `lib/milestone-events.ts` has no lint output at
all.

**`CLAUDE.md` pre-commit checklist, both items run.** `npx tsc --noEmit` exit 0.
`grep -rl "\](http://" app/ --include="*.ts" --include="*.tsx"` returns nothing.

**Em dashes: a `git diff main..HEAD` piped through `grep "^+"` and counted for the em dash character returns 0.**

### Independently mergeable, and what to revert

| Phase | Commit | Mergeable alone? | Revert |
|---|---|---|---|
| 1 | `626d27b` | **Yes.** Touches `app/agency/pool/page.tsx` only. | `git revert 626d27b`. Restores a button that returns 501. |
| 2 | `9360f48` | **Yes.** No file overlap with 1 or 3. | `git revert 9360f48`. Restores console-only drops. |
| 3 | `4cebb5a` | **Yes.** Documentation only, zero code. | `git revert 4cebb5a`. |

**No phase depends on another. All three revert cleanly and in any order.**

**If one is wrong, which is most likely and what is the blast radius:**
- **Phase 2 carries the only production behaviour change**, and it is additive: Sentry events
  where there were none. The risk is Sentry event volume if a refusal is more frequent than
  expected. **That is itself the finding** - Q3 measures it - but if the volume is a problem the
  `reportMilestoneDrop` call in the `insert-failed` branch is a two-line removal.
- **Phase 1 changes only whether one button is clickable.** It cannot break a flow that worked,
  because the flow it gates never worked.
- **Phase 3 cannot break anything.** It is 59 lines of markdown.

---

## 5. THE QUESTION LEFT FOR GREG

### RULING: WHAT SHOULD "REMOVE A VENDOR FROM THE POOL" DO?

**Do not answer this from the button. Answer it from what happens to the vendor's bids.**

**The facts, restated in one place.** There are two controls. One calls a DELETE that cannot
work. The other sets `status='removed'`, which works and then renders the vendor in the "Active
vendors" column badged `Vendor (removed)`. Nine tables hang off the row, three of them
(`partner_rfp_responses`, `partner_rfp_inbox`, `partner_status_updates`) are the vendor's own
record of work. **Answer Q1 in section 6 before choosing A.**

**Option A - hard delete. Author migration 100 with a DELETE policy.**
- The row and, depending on Q1, its children are destroyed or orphaned.
- Predicate would be `lead_org_id IN (SELECT public.current_user_org_ids())`, with an explicit
  `USING` clause. Narrower than the existing UPDATE policy on the same table, which uses the
  identical predicate and can already rewrite every column. Never
  `current_user_counterparty_org_ids` or `current_user_visible_profile_ids`: those are
  visibility sets and a counterparty sits inside them.
- **Cost:** contradicts the RFP closure ruling made today. A vendor loses their record that they
  bid. **This is why no migration was authored.**

**Option B - soft removal only. Delete the DELETE handler and the dead button; keep `status='removed'`.**
- The relationship ends, every child row survives, the vendor keeps their record.
- **This is the RFP closure ruling applied to the same question**, and it matches every word of
  copy the control already shows.
- **It is not complete on its own**, because of the rendering defect below.
- **Cost:** the agency can never truly erase a vendor. A mis-imported contact stays forever.

**Option C - Option B, plus a ruling on where a removed row renders.** Three sub-options:
- **C1.** Hide `removed` from every pool column. Matches what the old comment claimed. Cost: a
  removed row becomes unfindable and un-restorable from the interface.
- **C2.** Keep it in "Active vendors" badged `Vendor (removed)`, as today. Cost: the Remove
  button makes the row MORE prominent, which nobody would choose deliberately.
- **C3.** A fourth column, or a filter chip. Cost: UI work.

**Option D - change nothing.** The button stays disabled and the rendering defect stays.
Cost: two controls that both say "remove" and neither removes.

**My reading, offered not taken: B plus C1 or C3.** It is the only option consistent with the
closure ruling, it needs no migration, and the working code path already exists. **C2 is the
current behaviour and is the one nobody has actually chosen.**

---

## 6. QUERIES FOR GREG. NONE WERE RUN

**Q1. THE ONE THAT DECIDES PHASE 1.** Section 1c could read `ON DELETE` for only three of the
ten foreign keys; the rest predate the on-disk migration history.
```sql
SELECT c.conname, c.confrelid::regclass AS parent, c.conrelid::regclass AS child,
       CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                          WHEN 'c' THEN 'CASCADE'   WHEN 'n' THEN 'SET NULL'
                          WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
FROM pg_constraint c
WHERE c.contype = 'f' AND c.confrelid = 'public.partnerships'::regclass
ORDER BY 3;
```
EXPECTED: ten or more rows. `delivery_reviews` CASCADE, `partnership_owners` CASCADE,
`milestone_events` SET NULL. **Whatever `partner_rfp_responses` and `partner_rfp_inbox` say is
the answer to Option A.** A CASCADE on either means a hard delete destroys a vendor's bids.

**Q2. Does `public.partnerships` still have no DELETE policy?** Everything in Phase 1 rests on
this and it is read from migration files, not from the catalog.
```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partnerships' ORDER BY cmd, policyname;
```
EXPECTED: INSERT, SELECT and UPDATE rows only, seven in total. **Any DELETE row means the 501 at
`partnerships/route.ts:1402` is now wrong and Phase 1's disabled button should be re-enabled
instead of ruled on.**

**Q3. HOW BIG IS THE LOSS PHASE 2 JUST MADE VISIBLE?** This is the measurement that turns ruling
6 from a principle into a number, and it is the sharpest one because `rfp.view` fires exactly
once per inbox row by construction.
```sql
SELECT (SELECT count(*) FROM public.partner_rfp_inbox WHERE viewed_at IS NOT NULL) AS viewed_rows,
       (SELECT count(*) FROM public.milestone_events  WHERE event_type = 'rfp.view')  AS view_events,
       (SELECT count(*) FROM public.milestone_events  WHERE event_type = 'nda.acknowledge') AS nda_events,
       (SELECT count(*) FROM public.partner_rfp_inbox WHERE nda_confirmed_at IS NOT NULL) AS nda_rows;
```
EXPECTED: `view_events <= viewed_rows` and `nda_events <= nda_rows`. **Each gap is breadcrumbs
ruling 6 has already lost**, minus anything predating the emitters (2026-08-21). **The
`nda_events` gap is the one that matters most**, because section 2d shows `nda.acknowledge` has
no derived fallback: that gap is feed lines that do not exist anywhere.

**Q4. Does any account hold more than one `org_members` row yet?** Section 2b's latent
category-two case, and also the trigger for rulings 3 and 4's path-1 drops.
```sql
SELECT count(*) AS accounts_with_multiple_orgs FROM (
  SELECT user_id FROM public.org_members GROUP BY user_id HAVING count(*) > 1
) x;
```
EXPECTED: **0 today.** The first non-zero value is the day `resolveCallerWriteOrgId` starts
returning null, and the day the three vendor emit sites gain a second refusal reason.

**Q5. Are there stored event types nothing renders?** Gate 3 drops them silently.
```sql
SELECT event_type, count(*) FROM public.milestone_events GROUP BY 1 ORDER BY 2 DESC;
```
EXPECTED: a subset of the 24 keys in `MILESTONE_PREDICATES` (`lib/activity-feed.ts:381-409`).
Anything else is written, stored, readable and invisible.

---

## 7. WHAT I COULD NOT ESTABLISH

1. **The `ON DELETE` action on seven of the ten foreign keys to `partnerships`.** Not on disk.
   Q1. **This is the single most load-bearing unknown in the report.**
2. **Whether `public.partnerships` still has no DELETE policy in the live database.** Read from
   migration files only. Q2.
3. **How many breadcrumbs ruling 6 has actually lost.** Q3. Phase 2 makes future losses
   countable; it cannot recover the historical count.
4. **Whether anyone reads Sentry.** I established that Sentry is wired, receiving, and already
   used by six routes. **I cannot establish that a human looks at it.** If nobody does, Phase 2's
   value drops to "the data is there when someone asks", which is still strictly more than
   `console.error` provided.
5. **Whether `status='removed'` revokes anything.** The dialog says "they will no longer have
   access to your projects". I found **no RLS policy anywhere that filters on
   `partnerships.status`**, and `lib/broadcast-partnership-cue.ts:153` deliberately applies no
   status filter. **So that sentence may be false as well**, but proving it needs the live policy
   set, and I did not want to assert it from a grep over migration files. Worth adding to Q2.
6. **Whether any surface other than the agency dashboard will read `milestone_events`.** Today
   none does. That shapes every gate-2 question in the six rulings.

---

## 8. THE LIVE CHECKLIST

For **gmarkant@gmail.com** (the "m a r k a n t" lead agency) and a vendor account. Steps 1-3 are
the three the brief makes mandatory.

**Before you start:** nothing here needs migration 100, because none was authored. Have the
Sentry project for this app open in a second tab for steps 2 and 3.

1. **THE PHASE 1 CONTROL. Confirm it plainly says it cannot, rather than failing when pressed.**
   Sign in as `gmarkant@gmail.com`. Go to **/agency/pool**. In "Active vendors", click a vendor
   card to open the detail panel. Scroll to the bottom action row.
   **EXPECT:** a greyed-out "Remove from Pool" button that does not respond to a click, and
   directly beneath it: "Not available yet. This vendor's bids, status updates and payment
   history are attached to this record, so removing it needs a decision about what happens to
   them." **FAIL** if the button is clickable, or if clicking it produces an alert reading
   "Partnerships cannot be removed yet."

2. **A FEED ROW THAT FAILS TO WRITE IS VISIBLE SOMEWHERE RATHER THAN SILENT.**
   Sign in as a vendor account that has **no partnership with m a r k a n t** (a brand-new
   vendor, or one reached only by magic link). Open an RFP that agency sent them, at
   **/partner/rfps/[id]**. That single page load fires the `rfp.view` emitter.
   **EXPECT in Sentry, within a minute:** an event titled
   `[milestone] breadcrumb dropped: insert-failed`, tagged `subsystem: milestone_events` and
   `drop_reason: insert-failed`, whose extra data shows `eventTypes: ["rfp.view"]`,
   `code: "42501"`, `actorSides: ["vendor"]` and **`vendorPartnershipMissing: true`**.
   **FAIL** if no Sentry event appears. That means the drop is still silent and Phase 2 did not
   take effect. **NOT A FAILURE:** the vendor seeing the RFP normally. That is the point - the
   breadcrumb is lost and the page still works.

3. **A COUNTERPARTY CANNOT DELETE. NOT APPLICABLE THIS RUN, AND CONFIRM THAT RATHER THAN SKIP IT.**
   **No DELETE policy was authored**, so there is no new access to test. Confirm the negative
   instead: run **Q2** from section 6 in the Supabase SQL editor.
   **EXPECT:** rows for INSERT, SELECT and UPDATE only, and **no row with `cmd = 'DELETE'`**.
   That proves no caller of any kind, counterparty included, can delete a partnership today.
   **FAIL** if a DELETE row exists - then the 501 in the route is wrong and Phase 1 needs redoing
   against the live policy set.

4. **Confirm the rendering defect from section 1, so the ruling in section 5 is grounded in
   something you have seen.** As the agency, go to **/agency/pool**. In the **Discovered**
   column ("Not Yet Invited"), pick a contact you do not need and click **Remove**, then confirm.
   **EXPECT, and this is the defect:** the row does **not** disappear. It moves into the
   **"Active vendors"** column with the badge **`Vendor (removed)`**.
   If it does disappear, tell me - the code says it cannot, and I would be wrong.

5. **Confirm the working path still works and nothing in Phase 1 touched it.** Still on
   /agency/pool, the "Active vendors" count at the top of the page should be **unchanged** by
   step 4. It filters `status === 'active'` and a removed row is not active.

6. **Confirm Phase 2 did not make a successful emit noisy.** As the agency, shortlist any bid at
   **/agency/bids**. That fires `bid.shortlist`, which has an organization and a partnership and
   should succeed.
   **EXPECT:** the new line on the dashboard's "Recent activity", and **no Sentry event** with
   `subsystem: milestone_events`. **FAIL** if a drop event appears for a successful write.

7. **Run Q1 and Q3 from section 6 and paste the results back.** Q1 decides the ruling in section
   5 and nothing about "remove a vendor" can be settled without it. Q3 turns ruling 6 from a
   principle into a number, and the `nda_events` gap is the sharpest single figure in this
   report.
