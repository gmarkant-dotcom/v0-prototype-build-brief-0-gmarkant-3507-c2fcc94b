# 101 - Phase 0 baseline for the emitter rulings run

Written on branch `feat/closure-routing`, cut from `21ce8de docs: the notification routing run
report, and the live checklist`, at Phase 3 of the closure-routing run - so AFTER that run's
two code commits, not before them. That is a departure from 099 and 100, whose section 1
numbers described an untouched tree, and it is stated rather than glossed: **this file is not
a pre-flight for the run it sits in. It is the pre-flight for the NEXT one**, the six emitter
rulings in `docs/emitter-rulings-owed.md`. The gates for this run are in
`docs/closure-routing-report.md`, measured against `main` in a throwaway worktree.

**No database was queried at any point.** This session has no working credentials and is
prohibited from seeking them. Every question needing a row count or a live catalog read is in
section 8 as a query for Greg, with its expected value, and none of them was run.

**Nothing here answers a ruling.** The six are Greg's. What this file does is remove the
first hour of a build session: which file emits, which function, which line, what is already
in hand at that line, what is missing, whether a migration is needed, and which of the two
source documents can still be trusted.

---

## 1. WHAT CHANGED THE SHAPE OF THIS REPORT

Three things came out of reading the live SQL and the live routes against the two documents,
and each one changes what a build session would do on day one.

**(A) RULING 5 CANNOT BE BUILT AS THE DOCUMENT DESCRIBES IT.**
`docs/emitter-rulings-owed.md` says of `bid.analyze`: "the emit site holds a `partnership_id`
by the same route `bid.feedback` and `bid.decline` already use." **It does not.** That route is
`resolveBidMilestoneContext`, a LOCAL, NON-EXPORTED function inside
`app/api/agency/rfp-responses/[id]/route.ts:122`. The two analysis routes reach their bid
through `loadBidAnalysisContext` (`lib/bid-analysis-context.ts:42`), which selects no
`partnership_id` at any of its three queries. Ruling 5 Option A therefore begins with an
extraction into `lib/`, not with an emit line. Section 3 ruling 5.

**(B) TWO OF THE SIX HAVE NO ORGANIZATION ID IN SCOPE, AND THE FAILURE IS SILENT.**
`milestone_events.org_id` is `NOT NULL`, and `recordMilestones()` drops any event whose `orgId`
is falsy before the insert is even attempted (`lib/milestone-events.ts:227-233`). The
`client.edit` site resolves `callerOrgIds`, a SET, and never a single write id; the
`rfp.generate` site resolves no organization at all. An emit line added naively at either
compiles, runs, logs one line at ERROR, and writes nothing. Section 3 rulings 3 and 4.

**(C) THE ACT UNDER RULING 1 HAS TWO SHAPES AND ONE OF THEM DOES NOT WORK.**
`DELETE /api/partnerships` (`app/api/partnerships/route.ts:1306`) cannot delete: there is no
DELETE policy on `public.partnerships`, the delete matches zero rows, and the route's own code
says so and returns 501 (`:1392-1404`). The removal that works is `PATCH` with
`status: 'removed'` (`:1015-1020` validates it, `:1279-1287` writes it). An emitter on the
DELETE handler would record a removal that did not happen. Section 3 ruling 1.

---

## 2. (3a) THE THREE GATES, RESTATED FROM THE LIVE MIGRATION SOURCE

Read from `supabase/migrations/080_milestone_events.sql` and
`supabase/migrations/088_vendor_milestone_events.sql`, not from the summary in
`docs/emitter-rulings-owed.md`.

**FIRST, THE THING THAT MAKES THOSE TWO FILES THE LIVE SOURCE AT ALL.** Migrations 089 through
099 do not alter `milestone_events`, its policies, or either whitelist function.
`grep -ln milestone_events supabase/migrations/09[1-9]*.sql` returns 097, 098 and 099, and all
three hits are PROSE: 097:270-271 and 098:242,285 cite the table's no-UPDATE-no-DELETE shape as
precedent for their own policies, and 099:254 cites `actor_id` as the place attribution belongs
instead of a `closed_by` column. **Not one of them is a DDL statement.** So 080 and 088 are
still the whole of the mechanism.

### GATE 1 - IS THE ROW WRITTEN AT ALL? TWO POLICIES, AND THE DOCUMENT UNDERSTATES BOTH.

**Agency side** (`080:373-381`, policy `"Members insert own company milestone events"`):

```sql
WITH CHECK (
  actor_side = 'agency'
  AND org_id IN (SELECT public.current_user_org_ids())
  AND (actor_id IS NULL OR actor_id = auth.uid())
)
```

> **DISAGREEMENT 1.** `docs/emitter-rulings-owed.md` gives this gate as
> "`org_id IN current_user_org_ids()` (`080_milestone_events.sql:373`)" - the middle clause
> only. The `actor_side = 'agency'` clause is what makes the two INSERT policies disjoint (088's
> V4 verification exists to prove it), and the `actor_id` clause is what stops a member writing
> a colleague's name. Neither is optional and neither is in the document. It is an omission, not
> a contradiction: nothing the document concludes is wrong because of it.

**Vendor side** (`088:435-462`, policy `"Vendors insert own company milestone events"`), the
policy body in full, which is seven clauses and not two:

```sql
WITH CHECK (
  actor_side = 'vendor'
  AND actor_id = auth.uid()
  AND actor_email IS NULL
  AND vendor_org_id IN (SELECT public.current_user_org_ids())
  AND event_type = ANY (public.vendor_emittable_event_types())
  AND partnership_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.partnerships p
    WHERE p.id            = milestone_events.partnership_id
      AND p.vendor_org_id = milestone_events.vendor_org_id
      AND p.lead_org_id   = milestone_events.org_id
  )
)
```

> **DISAGREEMENT 2, AND IT IS THE ONE THAT MATTERS TO RULING 6.** The document quotes the last
> two clauses and cites `088:169-173`, which is the HEADER COMMENT, not the policy. The live
> policy is at `088:435-462`. The clause the quote leaves out is
> **`event_type = ANY (public.vendor_emittable_event_types())`**, and ruling 6 is entirely about
> what a vendor may write. **Whatever pin replaces `partnership_id`, a vendor session can still
> only ever write one of seven event types.** A ruling 6 design that assumes otherwise is
> designing against a policy that does not exist.

`vendor_emittable_event_types()` (`088:399-414`), verbatim, seven values:

```
bid.submit, bid.revise, rfp.view, invitation.accept, invitation.decline,
nda.acknowledge, status_update.post
```

`IMMUTABLE`, `SET search_path = pg_catalog, pg_temp`, revoked from `PUBLIC`, granted to
`authenticated`.

### GATE 2 - CAN THE COUNTERPARTY READ IT?

`080:350-362`, policy `"Counterparty reads whitelisted milestone events"`:

```sql
USING (
  partnership_id IS NOT NULL
  AND event_type = ANY (public.vendor_visible_event_types())
  AND EXISTS (
    SELECT 1 FROM public.partnerships p
    WHERE p.id = milestone_events.partnership_id
      AND p.vendor_org_id IN (SELECT public.current_user_org_ids())
  )
)
```

**The document quotes this one correctly and verbatim. No disagreement.** Its accompanying
claim is also correct: there is no status predicate, and `080:337-349` says so deliberately.

`vendor_visible_event_types()` (`080:161-198`), **23 values**, counted off the file:

```
vendor.invite, vendor.invite_resend, rfp.broadcast, rfp.magic_link_send,
rfp.deadline_set, rfp.deadline_change, bid.shortlist, bid.meeting_request,
bid.award, bid.decline, bid.feedback, onboarding.package_send, onboarding.deploy,
msa.confirm, status_update.resolve, payment.mark_paid, bid.submit, bid.revise,
rfp.view, invitation.accept, invitation.decline, nda.acknowledge, status_update.post
```

> **CONFIRMED, NOT DISAGREED.** The document says "none of the seven types in these six rulings
> is on it today". Checked one by one against the array above: `vendor.remove`,
> `vendor.blacklist`, `client.edit`, `rfp.generate`, `rfp.regenerate`, `bid.analyze` and
> `bid.analyze_retry` are all absent. **Making any of them vendor-visible is a migration**, and
> the function is `CREATE OR REPLACE` so the migration is a function replacement, not an ALTER.

**THERE IS NO CHECK CONSTRAINT ON `event_type`.** The column is plain `text NOT NULL`
(`080:275`), and `080:272-274` says the closure is meant to live in
`vendor_visible_event_types()` rather than on the column. **So emitting a NEW event type needs
no migration at all.** A migration is needed only to make one vendor-visible. That is the
"emitting and visibility are two separate decisions" point, and the reason it holds is
structural rather than conventional.

### GATE 3 - DOES ANYTHING RENDER?

`MILESTONE_PREDICATES` is at `lib/activity-feed.ts:381`, and `mapMilestoneGroup()` reads it at
`:440`:

```ts
const build = MILESTONE_PREDICATES[row.event_type]
if (!build) {
  ctx.onUnknownEventType?.(row.event_type)
  return null
}
```

> **DISAGREEMENT 3, cosmetic.** The document cites `lib/activity-feed.ts:380-409` for the table
> and `:435` for `mapMilestoneGroup`. The table starts at `:381` and the lookup is at `:440`.
> Five lines of drift, no change in meaning.

> **DISAGREEMENT 4, NOT COSMETIC, AND IT IS IN THE OTHER DOCUMENT.**
> `docs/emitter-coverage.md`'s headline table says **"Whole vocabulary with a renderer: 28 of
> 42"**. `MILESTONE_PREDICATES` has **24 keys**. So does that document's OWN row-by-row table:
> 42 rows, of which exactly 24 say `yes` in the Renderer column. And it was 24 at
> `ecaec2a` (2026-08-21), the commit that shipped the survey - checked with
> `git show ecaec2a:lib/activity-feed.ts`. **The 28 was wrong when it was written, it
> contradicts the table three paragraphs below it, and the table is the half that is right.**

**None of the seven ruling types has a renderer.** Checked key by key against the 24. So every
one of the six rulings owes a wording as well as an answer, which is the closing note both
documents already make.

---

## 3. (3b) THE SEVEN TYPES, ONE ROW EACH

| Type | Emits from | Function | Line | On `vendor_visible_event_types()`? | Migration to emit? | Migration to make vendor-visible? | Renderer? |
|---|---|---|---|---|---|---|---|
| `vendor.remove` | `app/api/partnerships/route.ts` | `PATCH` (agency branch) | `:1279-1287` | no | **no** | yes | no |
| `vendor.blacklist` | `app/api/agency/pool/[partnerId]/notes/route.ts` | `POST` | `:181-182` | no | **no** | yes | no |
| `client.edit` | `app/api/agency/clients/[id]/route.ts` | `PATCH` | `:88-94` | no | **no** | **cannot** - see below | no |
| `rfp.generate` | `app/api/ai/master-brief/route.ts` | `POST` | `:33` | no | **no** | **cannot** - see below | no |
| `rfp.regenerate` | same | same | same | no | **no** | **cannot** | no |
| `bid.analyze` | `app/api/agency/bids/[responseId]/decompose/route.ts` **and** `app/api/agency/bids/compare/route.ts` | `POST` in each | `:173-190` / `:146-161` | no | **no** | yes | no |
| `bid.analyze_retry` | same two | same | discriminated by `body.force === true` | no | **no** | yes | no |

"Cannot" means gate 2 fails on its FIRST clause, `partnership_id IS NOT NULL`, before the
whitelist is consulted. Adding the type to `vendor_visible_event_types()` would change nothing.

### Ruling 1 - `vendor.remove`

**THE ACT HAS TWO SHAPES AND THEY ARE NOT INTERCHANGEABLE.**

- `DELETE /api/partnerships` (`:1306`). **This handler cannot delete.** Its own comment block at
  `:1375-1385` records why: `public.partnerships` has an INSERT/SELECT/UPDATE policy set and no
  DELETE policy, so RLS denies the delete for every caller, the statement matches zero rows, and
  the route returns **501** with `'Partnerships cannot be removed yet. Nothing has been
  changed.'` An emitter placed here would write a breadcrumb for an act that did not occur.
- `PATCH /api/partnerships` with `status: 'removed'`. `:1019` validates the value against
  `['active','suspended','terminated','removed']` and `:1280-1284` writes it. **This works**, and
  it is a generic status setter shared with three other values, so an emitter needs an explicit
  `status === 'removed'` branch or it fires on every suspension too.

**What is in hand at the working site:** the `partnership` row was read at `:812-830` and the
caller was proved to be the lead agency at `:839`, so `partnership.lead_org_id` (the `org_id`),
`partnership.vendor_org_id` and `partnershipId` are all available. **Nothing has to be
resolved.** Emitting is an emit line plus a status branch.

**Ruling 1's Option A also needs the `vendorOf()` question answered** - the vendor-name slot on
the vendor's own feed, which `docs/emitter-rulings-owed.md` raises above the rulings. That is
unchanged and still open.

### Ruling 2 - `vendor.blacklist`

Emits from `POST /api/agency/pool/[partnerId]/notes`, the `body.blacklisted !== undefined`
branch at `:181-182`.

**THREE FACTS THE DOCUMENT DOES NOT CARRY.**

1. **The gate is `status = 'active'`.** `assertActiveAgencyPartnership` (`:59-88`) filters
   `.eq("status", "active")`, so blacklisting a suspended or terminated partnership is not
   reachable through this route at all. Whatever ruling 2 decides applies only to active ones.
2. **`lead_org_id` is NOT in hand.** That helper selects `id, partnership_notes` and nothing
   else. `milestone_events.org_id` is a single `NOT NULL` uuid and the route holds only
   `callerOrgIds`, a set. **Two ways out, neither recommended here:** add `lead_org_id` to the
   helper's `.select` (exact, and provably one of `callerOrgIds` because the same query filters
   `.in("lead_org_id", agencyOrgIds)`), or call `resolveCallerWriteOrgId`, which REFUSES a
   caller who belongs to several organizations with none selected. The first costs one column;
   the second can turn a working note save into a 403.
   `vendor_org_id` is the `partnerId` route param and needs nothing.
3. **A blacklist is a FLAG, not a transition.** The route merges `partnership_notes` jsonb, so
   a save that resends the same value writes the same value. An emitter must compare
   `prev.blacklisted` against `next.blacklisted` (both already computed, `:185-186`) or every
   notes save emits a blacklist line. This is the same transition-only discipline
   `bid.shortlist` uses at `rfp-responses/[id]:804`.

### Ruling 3 - `client.edit`

Emits from `PATCH /api/agency/clients/[id]`, around the update at `:87-93`.

**The document's narrowing fact is correct and I confirmed it:** `clients` has no partnership,
so the row carries `partnership_id = NULL`, gate 2 fails on its first clause, and no whitelist
change can make it counterparty-readable. Agency-only, structurally.

**What the document does not say:** the route resolves `callerOrgIds` (`:63`) and never a
single write org id, and its `.select(...)` at `:93` does not include `org_id`. So there is no
`orgId` to pass, and `recordMilestones()` would drop the event on its `usable` filter
(`lib/milestone-events.ts:227`) and log `"dropped event(s) with no resolvable organization"`.
**The cheapest correct fix is to add `org_id` to that `.select`** - the update already carries
`.in("org_id", callerOrgIds)`, so the returned row's own `org_id` is provably the caller's, and
unlike `resolveCallerWriteOrgId` it cannot refuse.

Ruling 3's Option B ("only material edits") additionally owes a definition, which is what the
document already says and is still the blocker.

### Ruling 4 - `rfp.generate` / `rfp.regenerate`

Emits from `POST /api/ai/master-brief` (`:33`).

**The document's narrowing fact is correct:** no recipients exist at generation time, so
`partnership_id` is NULL and gate 2 fails first-clause. Agency-only, structurally.

**THREE THINGS THE DOCUMENT DOES NOT SAY, AND EACH IS A DAY-ONE SURPRISE.**

1. **The route resolves NO organization.** It reads `profiles(role, active_role, is_admin)` and
   calls `canUseAgencyAi(profile, user.id, supabase)`. `grep resolveCallerOrgIds\|resolveCallerWriteOrgId app/api/ai/master-brief/route.ts` returns nothing. Emitting means adding an
   organization resolution - a new database read - to an AI route that has never made one.
2. **There is nothing for `subject_id` to point at.** The route is stateless: it takes
   `projectName`, `clientName`, `briefText`, `templateHint`, `templateText` as free strings
   (`:58-63`) and returns JSON. No project id, no scope item id, no client id. Every other
   agency emitter names a real row. `docs/capabilities.md` §5 pairs `rfp.generate` with a
   milestone but `lib/activity-feed.ts:503-508`'s `UNION_REPLACING_EVENT_TYPES` has no entry for
   it, so what the breadcrumb is ABOUT is undecided, and the ruling does not ask.
3. **Nothing in the route distinguishes a generate from a regenerate.** There is no prior-run
   lookup and no flag in the body. **The two-type split in the vocabulary has no discriminator
   in the code today**, so ruling 4 Option A implicitly asks for one to be invented - most
   likely a client-supplied boolean, which is a payload the server cannot verify.

### Ruling 5 - `bid.analyze` / `bid.analyze_retry`

**TWO ROUTES, AND THE DOCUMENT TREATS THE PAIR AS ONE SITE.**

- `POST /api/agency/bids/[responseId]/decompose` - ONE response. Writes `bid_decompositions`,
  upserted on `response_id` (`:173-190`).
- `POST /api/agency/bids/compare` - **two or more responses** (`:55`, refuses fewer than 2).
  Writes `bid_comparisons` keyed on `org_id` plus a hash of the response id set (`:145-160`).

**`bid.analyze_retry` IS `body.force === true`, AND IT IS NOT A RETRY AFTER A FAILURE.** Both
routes read `force` (`compare:53`, `decompose:125`) and use it to bypass the cached result. A
run that actually FAILS returns 502 before any write (`decompose:158-161`, and the same shape in
`compare`), so it would emit nothing at all.

> **DISAGREEMENT 5.** `docs/emitter-rulings-owed.md` ruling 5 Option A says the vendor "learns
> it again for each retry after a failed run - so a run that failed twice tells the vendor three
> times, and the count is a fact about the agency's tooling". **The code does not produce that
> shape.** A failed run writes nothing and would emit nothing. The re-emit risk is real but it
> is a HUMAN pressing regenerate, not a retry loop, and the cost argument has to be made on that
> basis instead.

**AND THE BLOCKER, RESTATED FROM SECTION 1.** Neither route holds a `partnership_id`.
`loadBidAnalysisContext` (`lib/bid-analysis-context.ts:42`) selects at `:49`, `:63`, `:82`,
`:91` and none of those projections includes it. The resolver that does the job,
`resolveBidMilestoneContext`, is a private function at
`app/api/agency/rfp-responses/[id]/route.ts:122-161` and is not exported. **Option A begins with
an extraction into `lib/`, exercised by five existing call sites, before a single emit line is
written.**

**The multi-response question the ruling does not ask.** `compare` is about N bids belonging to
N vendors. Does it write ONE row (which vendor's partnership? none is right) or **N rows, one
per response** (the `rfp.broadcast` shape, which `recordMilestones` exists for -
`lib/milestone-events.ts:204-210`)? N rows is the only shape gate 2 can serve, and it makes the
document's payload warning sharper, not weaker: each of the N vendors reads their own row, and
any comparison-derived field on it describes the other N-1.

### Ruling 6 - the vendor with no partnership

**The five affected types are `bid.submit`, `bid.revise`, `rfp.view`, `nda.acknowledge`,
`status_update.post`. Every one is on BOTH arrays**, checked against the verbatim lists in
section 2. They fail gate 1, not gate 2, exactly as the document says.

**The vendor-side emit sites, measured:**

| Site | Type | Client |
|---|---|---|
| `app/api/partner/rfps/[id]/route.ts:124` | `rfp.view` | session |
| `app/api/partner/rfps/[id]/nda-notify/route.ts:162` | `nda.acknowledge` | session |
| `app/api/partner/rfps/[id]/response/route.ts:543` | `bid.submit` / `bid.revise` | session |
| `app/api/partner/projects/[projectId]/status-update/route.ts:308` | `status_update.post` | session |
| `app/api/partnerships/route.ts:1082` | `invitation.accept` | session |
| `app/api/partnerships/route.ts:1225` | `invitation.decline` | session |
| `app/api/rfp/guest/[token]/route.ts:857` | `bid.submit` | **service role** |

Seven sites, and the split is the point. **The two `invitation.*` sites act ON a partnership
row, so one necessarily exists and they are not affected by ruling 6 at all.** The guest site
runs on the service role and bypasses 088 entirely. **The four affected sites are the first
four**, which is the document's "earliest in the journey" claim confirmed at the file level:
`rfp.view` and `nda.acknowledge` are the two that fire before a vendor could plausibly have been
added to the pool.

Both `rfp.view` and `bid.submit` already do the two-step partnership lookup and both carry a
comment saying the null case is silently lost
(`partner/rfps/[id]/route.ts:113-121`, `response/route.ts:495`). **The emitters already know.
Nothing above them does.**

---

## 4. (3c) THE SILENT REFUSAL. THE CENSUS.

**`recordMilestone()` RETURNS `Promise<void>`.** Not a boolean, not a result object. Its own
doc comment (`lib/milestone-events.ts:194-196`) reads: "Never throws, never returns a failure,
never blocks the caller's result. Await it, or do not - either is correct."

**TWENTY-TWO EMIT SITES. TWENTY OF `recordMilestone`, TWO OF `recordMilestones`. ALL TWENTY-TWO
`await` IT AND ALL TWENTY-TWO DISCARD THE RESULT.** Not one assigns it, tests it, or branches on
it, and none of them could: there is nothing to test. Measured with
`grep -rn "recordMilestones\?(" app/ lib/`, excluding the module itself.

| File | Emit calls |
|---|---|
| `app/api/partnerships/route.ts` | 5 |
| `app/api/agency/rfp-responses/[id]/route.ts` | 4 |
| `app/api/projects/route.ts` | 1 |
| `app/api/projects/[id]/onboarding-packages/route.ts` | 1 |
| `app/api/projects/[id]/onboarding/deploy/route.ts` | 1 |
| `app/api/agency/msa/milestones/route.ts` | 1 |
| `app/api/agency/projects/[projectId]/status-updates/route.ts` | 1 |
| `app/api/agency/pool/resend-invitation/route.ts` | 1 |
| `app/api/agency/rfp/magic-link/route.ts` | 1 (`recordMilestones`, two event types in one batch) |
| `app/api/agency/broadcast-rfp/route.ts` | 1 (`recordMilestones`, one row per recipient) |
| `app/api/partner/projects/[projectId]/status-update/route.ts` | 1 |
| `app/api/partner/rfps/[id]/route.ts` | 1 |
| `app/api/partner/rfps/[id]/response/route.ts` | 1 |
| `app/api/partner/rfps/[id]/nda-notify/route.ts` | 1 |
| `app/api/rfp/guest/[token]/route.ts` | 1 |

### FOUR WAYS A BREADCRUMB IS LOST, AND ONLY ONE OF THEM IS THE ONE THE DOCUMENTS NAME

Reading `recordMilestones()` (`lib/milestone-events.ts:212-275`) top to bottom:

1. **No resolvable organization** (`:227-233`). Events with a falsy `orgId` are filtered out
   BEFORE the insert and logged at ERROR as `"dropped event(s) with no resolvable
   organization"`. **Neither `docs/emitter-coverage.md` nor `docs/emitter-rulings-owed.md`
   mentions this path at all**, and it is the one rulings 3 and 4 would hit first.
2. **Schema cache miss** (`PGRST205` / `42P01`, `:247-259`). Logged at **WARN**. The comment
   records that this branch was dead for its entire working life before it was corrected.
3. **Any other insert error, RLS refusal included** (`:262-267`). Logged at ERROR as
   `"insert failed (the action itself succeeded)"`. **This is gate 1 failing, and it is the one
   the documents describe.**
4. **A throw** (`:268-274`). Logged at ERROR as `"insert threw"`.

**All four return `undefined`.** The route cannot tell them apart, the user is never told, and
the agency's feed simply has one fewer line than the truth. **The only observer is the server
log**, and no alerting on `[milestone]` exists in this repository - `grep -rn "\[milestone\]"`
outside `lib/milestone-events.ts` returns nothing.

**This is the same failure class as the two the brief names** - the onboarding document bug and
the notification type drift - and as the two this run fixed in Phases 1 and 2: a refusal
arriving as a success, or as a confident wrong number.

**IT IS NOT A DEFECT TO FIX BLIND.** Fire-and-forget is deliberate and every call site's comment
says so in the same words: a lost breadcrumb must never turn a completed award, bid or
notification into a 500. **What is missing is not a thrown error, it is a RETURN VALUE.** A
`Promise<boolean>` would let a caller log with its own route context, or count, without
changing a single control flow - the shape `createOrgNotification()` in `lib/notifications.ts`
already uses for exactly this reason. That is a one-file change with 22 call sites that may all
keep ignoring it, and it is offered, not done.

---

## 5. (3d) ESTIMATES, AND WHAT COULD SHIP INDEPENDENTLY

"Files" counts files a build session would edit for the WIDEST option (emit + whitelist +
renderer). "Migration" is the `vendor_visible_event_types()` replacement, needed only for the
vendor-visible option.

| Order | Ruling | Files | Migration | Risk | Ships alone? |
|---|---|---|---|---|---|
| 1 | **3. `client.edit`** | 2 (`clients/[id]/route.ts`, `activity-feed.ts`) | **no**, and cannot help | **lowest.** Agency-only by construction. One `.select` column and one emit line. No counterparty can ever read it, so the payload rule is unenforced and an error is contained to one agency's own feed. | yes |
| 2 | **1. `vendor.remove`** | 2-3 (`partnerships/route.ts`, `activity-feed.ts`, +100 for visibility) | only for Option A | **low to build, high to decide.** Everything is in hand; the code is a status branch. The risk is entirely in the ruling: Option A is a permanent, unwithdrawable line on a removed vendor's feed. | yes |
| 3 | **2. `vendor.blacklist`** | 2-3 (`pool/[partnerId]/notes/route.ts`, `activity-feed.ts`, +100) | only for Option A | **low to build, highest to decide of the six.** One column added to a select, one transition comparison. Option A shows a company the agency's private judgment of them, permanently. | yes |
| 4 | **4. `rfp.generate` / `rfp.regenerate`** | 2-3 (`ai/master-brief/route.ts`, `activity-feed.ts`, and whatever supplies a subject) | no, and cannot help | **medium, and mostly unknowns.** Needs an org resolution added to an AI route, a decision about what `subject_id` names, and a discriminator between the two types that does not exist. | yes, but answer the subject question first |
| 5 | **6. the vendor with no partnership** | 1 migration + 0-4 routes | **yes, and it is a policy change** | **highest.** 088's `EXISTS` is the only thing standing between a vendor and feed injection onto an arbitrary agency's dashboard. Any pin must REPLACE that proof, not remove it, and the replacement needs its own preapply test file in 099's shape. | yes, and it fixes five emitters at once |
| 6 | **5. `bid.analyze` / `bid.analyze_retry`** | 4+ (extract the resolver to `lib/`, two analysis routes, `activity-feed.ts`, +100) | only for Option A | **medium-high.** Starts with a refactor of a resolver five live emitters depend on. Then the multi-vendor row-count question, then the payload rule on a feature whose whole point is comparison. | last |

**Rulings 1, 2 and 3 are mutually independent and touch three different files.** All three could
land in one session if all three are answered. **Ruling 6 is independent of all of them and is
worth the most** - it is the only one where something is being lost today rather than merely
not recorded. **Ruling 5 should be last regardless of the answer**, because its first commit is
a refactor with five existing dependants and that wants its own review.

---

## 6. (3e) WHAT NO LONGER HOLDS

`docs/emitter-coverage.md` is dated 2026-08-23 and shipped at `ecaec2a` (2026-08-21);
`docs/emitter-rulings-owed.md` expanded on 2026-08-26. Both predate migrations 089 through 099
and the entire RFP closure feature.

**WHAT STILL HOLDS, AND IT IS MOST OF IT.** The mechanism is intact: 089-099 do not touch
`milestone_events`. Both whitelists are unchanged, the three gates read exactly as described,
and the seven ruling types are still absent from every list. The rulings themselves are still
the right questions.

**WHAT IS WRONG OR STALE:**

1. **`docs/emitter-coverage.md`'s headline "28 of 42 with a renderer" is wrong** and contradicts
   its own table. It is 24, it was 24 at the commit that shipped it, and it is 24 today.
   Section 2, disagreement 4.
2. **Seven of 23 cited emitter line numbers have drifted.** Checked by printing every cited
   `path:line` in the coverage table against today's file:

   | Citation | Today |
   |---|---|
   | `broadcast-rfp/route.ts:553` | `:569` |
   | `agency/rfp/magic-link/route.ts:444` | `:459` |
   | `agency/rfp/magic-link/route.ts:473` | `:488` |
   | `partner/rfps/[id]/route.ts:83` | `:124` |
   | `partner/rfps/[id]/response/route.ts:506` | `:543` |
   | `partner/rfps/[id]/nda-notify/route.ts:120` | `:162` |
   | `projects/route.ts:634` | `:646` |

   The other sixteen still land on their `eventType:` line exactly.
3. **`docs/capabilities.md` §4 cites `app/api/partnerships/route.ts:930 DELETE` for
   `vendor.remove`.** The DELETE handler is now at `:1306`, and - the part that matters - its own
   code records that it cannot delete anything. Section 3 ruling 1.
4. **Ruling 5's partnership claim is false and its retry claim does not match the code.**
   Disagreements in section 2 and section 3.
5. **Neither document knows the RFP closure feature exists.** Migration 099, the two closure
   statuses on `partner_rfp_inbox`, `app/api/agency/rfp-closure/route.ts` and the two
   notification types all postdate them. That is the seventh ruling, section 7.
6. **`rfp.close` is in the capability vocabulary and NOT in the milestone vocabulary.**
   `docs/capabilities.md:112` lists it as an agency capability, default `admin`, and
   `lib/capabilities.ts:132` declares `"rfp.close": "admin"`. **But §5's capability-to-milestone
   pair table has no row for it**, which is why it is absent from the coverage survey's 42. The
   act has a name everywhere except the one place a feed line would come from.
7. **`rfp.close` is declared admin-only and enforced by nobody.** `can()` /
   `capabilityDeniedMessage()` from `lib/capabilities.ts` are imported by exactly three route
   files - `agency/rfp-responses/[id]`, `agency/broadcast-rfp`, `partnerships` - covering seven
   capabilities. `app/api/agency/rfp-closure/route.ts` checks `requireAgencyRole()` and
   organization ownership and **never calls `can()`**, so any member of a lead agency can close
   an RFP today. **This is reported, not fixed.** Enforcing it would NARROW an existing live
   flow and refuse members who can close today, which is a product decision and not this run's.
8. **`docs/capabilities.md:112` calls `rfp.close` "Reversible".** Against that document's own
   §1 definition - can a member put things back from inside the product - it is not. Migration
   099's clause (C) forbids a vendor moving a `closed` row to `bid_submitted`,
   `RFP_CLOSABLE_STATUSES` is `['new','viewed']` so a closure cannot be closed back open, and
   no route un-closes anything. **Closing an RFP is irreversible from inside the product.**

---

## 7. (3f) THE SEVENTH RULING. SHOULD CLOSING AN RFP EMIT A MILESTONE?

**NOT ANSWERED HERE.** Framed in the same shape as the six, with what each answer makes the
feed say.

**WHY IT BELONGS ON THE LIST.** Closing an RFP, and marking one vendor not selected, are new
agency acts on a vendor relationship, which is what the feed exists to record. They shipped on
2026-09-14, after both source documents were written, so nobody has been asked. Every
comparable act on that relationship already emits: `bid.decline` (a vendor who bid and lost),
`bid.award`, `bid.feedback`, `rfp.deadline_change`. **A vendor whose request was closed is the
one outcome on that list with no breadcrumb**, and it is the outcome where the vendor did the
least and learns the least.

**AND IT IS REALLY TWO QUESTIONS, BECAUSE OF GATE 2.** Emitting is one decision; adding the type
to `vendor_visible_event_types()` is a second and a separate migration. Answering the first does
not settle the second.

**WHAT IS ALREADY DECIDED AND SHOULD NOT BE REOPENED.** `docs/capabilities.md:112` and
`lib/capabilities.ts:132` already name the capability `rfp.close`, `admin`. Whatever the
milestone is called, it should be that name: `docs/capabilities.md` §5's whole argument is one
vocabulary so that "who may do this" and "who did this" cannot drift into two spellings.

**WHAT IS IN HAND AT THE SITE, SO THIS IS NOT A GUESS.**
`app/api/agency/rfp-closure/route.ts` already holds, per closed row, inside
`emitClosureNotifications`: `row.id` (the inbox row), `row.vendor_org_id`, `leadOrgId`
(`resolveCallerWriteOrgId`, an authority set), `row.scope_item_name`, `row.project_id` and the
closure `status`. **`partnership_id` is the one thing it does NOT hold** - the UPDATE's
`RETURNING` projection (`:222`) does not select it, though `partner_rfp_inbox.partnership_id`
exists and `resolveBidMilestoneContext` reads it off exactly that column. One column on one
projection. **Gate 2 needs it and gate 1's agency arm does not**, so an agency-only emit works
today and a vendor-visible one needs that column.

**THE NAMING PROBLEM THE SIX DO NOT HAVE.** There are TWO acts, and `lib/rfp-closure.ts`'s
entire header argues they must not collapse: `closed` ended for everyone, `not_selected` is
about one vendor. One event type with the status in the payload would reintroduce exactly the
collapse migration 099 refused, because `lib/activity-feed.ts` reads one payload key
(`scope_item_name`) and would render both as one line. **So this is two types or it is nothing**,
and `rfp.close` names only the first of them.

### Option A - emit both, and whitelist both

- **The line**, shape only, wording owed: `closed the RFP for {scope}` and
  `did not select {vendor} for {scope}`. The second one hits the `vendorOf()` problem the other
  rulings raise: on the vendor's own feed the counterparty is the AGENCY, so there is no vendor
  name for that slot.
- **Who sees it:** BOTH. The agency and its colleagues; the vendor on their own row.
- **Counterparty-visible:** yes, and **permanently** - 080's counterparty policy has no status
  predicate, so the row outlives the partnership going `removed`.
- **Cost:** the vendor is told a third time. They already get an email
  (`rfp-closure/route.ts:466-480`) and a bell notification (`notifyRfpClosed` /
  `notifyRfpNotSelected`), and after Phase 1 of this run both land on the request itself. A feed
  line saying the same thing in a fourth voice is the `onboarding_deployed` disagreement's
  shape, arriving early enough to avoid.
- **Payload rule:** `scope_item_name` is about the reader and is what every whitelisted type
  already carries. **A whole-RFP close touches N vendors in one statement** - any count, any
  vendor list, any "closed for everyone" figure is `rfp.broadcast.recipient_count` in a new
  costume, and that leak has already been fixed once
  (`docs/broadcast-payload-leak-fix.md`).
- **Migration:** yes, `vendor_visible_event_types()` replaced. Plus the `partnership_id` column
  on the projection.

### Option B - emit both, neither whitelisted

- **The line:** the same two, agency feed only.
- **Who sees it:** the agency and its colleagues. **This is the case Option B has that the other
  rulings' Option B does not:** a whole-RFP close is one click that ends a request for every
  vendor on it, and right now a colleague cannot see it happened, cannot see who did it, and
  cannot see when. Migration 099 deliberately declined to add a `closed_by` column and said
  attribution belongs in a milestone row (`099:239-256`). **That sentence is this option.**
- **Counterparty-visible:** no, by the whitelist failing closed.
- **Cost:** the vendor's own record of the closure remains the email, the bell row and the
  inbox row's status. No fourth telling.
- **Payload rule:** unenforced today, binding on any later whitelisting. The N-vendor count
  warning above still applies to what gets WRITTEN.
- **Migration:** none.

### Option C - emit only `rfp.close`, not the per-vendor decline

- **The line:** one, for the whole-RFP act. `not_selected` records nothing.
- **Who sees it:** per whichever of A or B is chosen for the one type.
- **Argument for:** the whole-RFP close is the act with no other record and the one a colleague
  most needs to see. A per-vendor decline already writes a status on a row the agency can read.
- **Argument against:** it makes the feed's account of a closure depend on which button was
  pressed, and `lib/rfp-closure.ts` is explicit that the two acts must stay tellable apart
  everywhere.

### Option D - do not emit

- **The line:** none, on either feed.
- **Who sees it:** nobody. An agency's feed stays silent about the act that ends a request for
  every vendor invited to it, and 099's "attribution belongs in a milestone row" ruling stays
  unhonoured for this act specifically.
- **Payload rule:** not applicable.

---

## 8. QUERIES FOR GREG. NONE WERE RUN.

**Q1. Do the two whitelist functions live match the migration text?** Everything in section 2
is read from files. If either has been replaced by hand, every conclusion here about gate 1 and
gate 2 is describing a different database.
```sql
SELECT public.vendor_visible_event_types()   AS visible,
       public.vendor_emittable_event_types() AS emittable;
```
EXPECTED: 23 values and 7 values, matching section 2 exactly.

**Q2. THE MOST VALUABLE ONE. How big is the silent loss?** Section 4's four paths are all
invisible above the log. This is the only way to see the shape of what did land.
```sql
SELECT event_type, actor_side, count(*) AS n,
       count(*) FILTER (WHERE partnership_id IS NULL) AS no_partnership
FROM public.milestone_events
GROUP BY 1, 2 ORDER BY n DESC;
```
EXPECTED: no vendor-side row with `no_partnership > 0` - gate 1 forbids it, so a non-zero value
there means a service-role write, which is the guest path and is legitimate. **A vendor-side
type with a suspiciously low `n` against its agency-side counterpart is ruling 6's cost,
measured.**

**Q3. How many `rfp.view` rows exist against how many viewed inbox rows?** The sharpest single
measurement of ruling 6, because `rfp.view` fires exactly once per inbox row by construction.
```sql
SELECT (SELECT count(*) FROM public.partner_rfp_inbox WHERE viewed_at IS NOT NULL) AS viewed_rows,
       (SELECT count(*) FROM public.milestone_events  WHERE event_type = 'rfp.view') AS view_events;
```
EXPECTED: `view_events` <= `viewed_rows`. **The gap is the number of breadcrumbs ruling 6 has
already lost**, minus any row viewed before the emitter shipped on 2026-08-21.

**Q4. Are there rows whose event type nothing renders?** Gate 3 drops them from the feed
silently and `onUnknownEventType` only logs.
```sql
SELECT DISTINCT event_type FROM public.milestone_events ORDER BY 1;
```
EXPECTED: a subset of the 24 keys listed in `MILESTONE_PREDICATES`
(`lib/activity-feed.ts:381-409`). Anything else is written, stored, readable and invisible.

**Q5. Four policies on `milestone_events`, and still no UPDATE and no DELETE?** 088's V3, re-run
because 089-099 have landed since anyone checked.
```sql
SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'milestone_events' ORDER BY cmd, policyname;
```
EXPECTED: 4 rows, two SELECT and two INSERT, all `{authenticated}`. **No UPDATE row and no
DELETE row, for anybody.**

**Q6. Does `public.partnerships` still have no DELETE policy?** Section 3 ruling 1 rests on
this, and it is read from a route comment rather than from the catalog.
```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partnerships' ORDER BY cmd;
```
EXPECTED: INSERT, SELECT and UPDATE rows only. **Any DELETE row means the 501 at
`partnerships/route.ts:1402` is now wrong and a vendor.remove emitter has two working sites.**

**Q7. For the seventh ruling: how many inbox rows carry a `partnership_id`?** Decides whether
Option A's one extra column is enough in practice or whether closure breadcrumbs would be
vendor-invisible for most rows anyway.
```sql
SELECT status, count(*) AS n, count(partnership_id) AS with_partnership
FROM public.partner_rfp_inbox GROUP BY 1 ORDER BY n DESC;
```
EXPECTED: every status present, and `with_partnership` materially below `n` for magic-link
rows. **If `with_partnership` is near zero, Option A is agency-only in practice whatever the
whitelist says**, which collapses the seventh ruling into Option B.

---

## 9. WHAT WAS EXECUTED, READ, AND REASONED

**EXECUTED.** `git log`, `git show ecaec2a:lib/activity-feed.ts` and greps over `app/`, `lib/`,
`supabase/migrations/` and `docs/` for: every `recordMilestone` / `recordMilestones` call site,
every `eventType:` literal, every `MILESTONE_PREDICATES` key, both whitelist function bodies,
every `actorSide` value, every cited `path:line` in `docs/emitter-coverage.md`, and every
importer of `lib/capabilities.ts`. Every count in this file came off one of those and can be
re-run. `npx tsc --noEmit`, `pnpm build`, `pnpm lint` and the five guard scripts are in
`docs/closure-routing-report.md`, with `main` measured in a throwaway worktree.

**READ IN FULL.** `lib/milestone-events.ts`; `lib/partner-inbox-access.ts`;
`lib/rfp-closure.ts`; `docs/emitter-rulings-owed.md`; `docs/emitter-coverage.md`;
`app/api/agency/rfp-closure/route.ts`; `app/api/agency/pool/[partnerId]/notes/route.ts`.

**READ IN PART.** `supabase/migrations/080_milestone_events.sql` (both whitelist functions, the
table DDL, all three policies); `supabase/migrations/088_vendor_milestone_events.sql` (the
header argument, `vendor_emittable_event_types()`, the vendor INSERT policy clause by clause,
the verification block); `supabase/migrations/099_rfp_closure.sql` (clause C, the closed_by
ruling, the status check); `lib/activity-feed.ts` (`MILESTONE_PREDICATES`,
`mapMilestoneGroup`, `UNION_REPLACING_EVENT_TYPES`); `app/api/partnerships/route.ts` (PATCH
status branch, DELETE handler, five emit sites);
`app/api/agency/rfp-responses/[id]/route.ts` (`resolveBidMilestoneContext`, one emit site);
`app/api/agency/bids/compare/route.ts`; `app/api/agency/bids/[responseId]/decompose/route.ts`;
`app/api/ai/master-brief/route.ts`; `app/api/agency/clients/[id]/route.ts`;
`lib/bid-analysis-context.ts`; `lib/capabilities.ts`; `docs/capabilities.md` sections 1, 2 and 5.

**REASONED, AND THEREFORE UNVERIFIED AGAINST A LIVE DATABASE.** That the live policies and both
whitelist functions match their migration text. That `public.partnerships` still has no DELETE
policy - read from a route comment at `partnerships/route.ts:1375-1385`, not from the catalog.
That any emitter added at any site in section 3 would actually insert a row. **Q1, Q5 and Q6
settle the first three and none of them was run.**

**NOT DONE.** No ruling answered. No migration authored, applied or edited. No policy widened or
narrowed. No emitter written. No renderer written. No feature code of any kind in this phase.
