# The emitter rulings

Blocked items, restated as answerable questions. Source: `docs/emitter-coverage.md` §4
and §5 (2026-08-23). Nothing here is implemented until the sentence above it has an
answer.

---

## STATUS, 2026-09-15. THE ORIGINAL SIX ARE ALL RULED. THREE NEW ONES ARE OWED.

The file was called "the six emitter rulings Greg owes" and that title is now wrong in both
halves: the six are answered, and three questions the answers raised are not. The original
six sections are kept VERBATIM below, each with a RULED block at its head. **Nothing in an
original section has been edited to agree with its ruling** - a question rewritten after the
fact stops being evidence of what was actually asked.

| # | Ruling | Answer | Where it landed |
|---|---|---|---|
| 1 | `vendor.remove` | Option B - emit, agency feed only, off the whitelist | commit `2c2db0f` |
| 2 | `vendor.blacklist` | Emit on the false-to-true transition only, off the whitelist | commit `2c2db0f` |
| 3 | `client.edit` | **DEFERRED. Do not emit.** Definition of "material" recorded below | no code |
| 4 | `rfp.generate` | Emit ONE server-determined type. `rfp.regenerate` not emitted | commit `2c2db0f` |
| 5 | `bid.analyze` / `_retry` | Option B - emit, agency feed only, off the whitelist, decompose route only | this branch |
| 6 | vendor with no partnership | **FIX IT.** Pinned through `partner_rfp_inbox` | `supabase/migrations/100_*.sql`, NOT APPLIED |

**STILL OWED, AND ANSWERED NOWHERE: rulings 7, 8 and 9 at the foot of this file.** They are
new questions, not restatements. Each was raised BY one of the six answers above and none of
them existed when this file was written.

**Not one of the nine types is on `vendor_visible_event_types()`, and that is unchanged by
every ruling above.** Adding one is a migration and a separate decision, which is the point
gate 2 exists to make.

Each line gives the question, then what each answer would make the feed say. **The
second half is the point** - a ruling with no visible consequence is not worth a
sentence, and every one of these changes what a real person reads on a real screen.

**EXPANDED 2026-08-26.** Each ruling was one sentence, which is enough to state the
question and not always enough to decide it. Every one now carries, per option: the
line the feed would render, who would see it, whether a counterparty could see it, and
what the payload rule permits it to carry. **No option is recommended, ordered by
preference, or marked as a default.** Where options are listed they run from widest
visibility to narrowest, which is an ordering by scope and nothing else.

---

## The three gates, stated once, because every ruling below turns on them

These are read, from the live migrations and `lib/activity-feed.ts`, not assumed.

**GATE 1 - is the row written at all?** A vendor-side write needs
`partnership_id IS NOT NULL` plus an `EXISTS` against `partnerships`
(`088_vendor_milestone_events.sql:169-173`). An agency-side write needs
`org_id IN current_user_org_ids()` (`080_milestone_events.sql:373`). `recordMilestone()`
catches every refusal and returns void, so a row that fails this gate is lost in silence -
no error reaches the route, the user, or the agency.

**GATE 2 - can the counterparty read it?** Two conditions, both required
(`080_milestone_events.sql:350-362`):

```sql
partnership_id IS NOT NULL
AND event_type = ANY (public.vendor_visible_event_types())
AND EXISTS (... p.vendor_org_id IN (SELECT public.current_user_org_ids()))
```

So **"should this emit" and "should the vendor see it" are two separate decisions**, and
the second one is a MIGRATION: `vendor_visible_event_types()` is a closed array
(`080_milestone_events.sql:161-197`) and **none of the seven types in these six rulings
is on it today.** Emitting a type therefore defaults to agency-only, and stays that way
until somebody deliberately adds it.

**There is no status predicate on that policy, and 080 says so deliberately** (the comment
above it at `080:337-349`): a vendor whose partnership later goes `removed` does not stop
being able to read the whitelisted rows they were a party to. That matters most for
rulings 1 and 2.

**GATE 3 - does anything render?** `MILESTONE_PREDICATES` in `lib/activity-feed.ts:380-409`
maps event type to copy. **A type absent from that table renders NO LINE at all**, and the
caller is notified so it can log. So a whitelisted, written, readable row still shows
nothing until a wording exists - which is the closing note at the foot of this file.

**THE PAYLOAD RULE.** The payload of a whitelisted type is counterparty-readable IN FULL,
row by row. The test is not "is this sensitive" but **"is this field about the reader, or
about anyone else"** - another vendor, the competitive field, or the agency's internal
state. The two worked examples: `rfp.broadcast.payload.recipient_count`, removed because
it told each vendor how many competitors they were bidding against
(`docs/broadcast-payload-leak-fix.md`), and the `payment.mark_paid` totals, the same shape
in money. `lib/activity-feed.ts` reads exactly ONE payload key, `scope_item_name`, and
never passes a payload through to the browser (`lib/activity-feed.ts:31-38`, `:318-329`).

**ONE THING TO SETTLE BEFORE ANY LINE THAT NAMES A VENDOR.** `vendorOf()` resolves
`counterpartyName`, which is "the counterparty organization on this row"
(`lib/activity-feed.ts:335`, `:417`). On the agency's feed that is the vendor. **On the
vendor's own feed the counterparty is the AGENCY**, so a predicate written as
`removed ${vendorOf(i)}` has no vendor name to put in that slot when the vendor reads it.
The vendor feed does not exist yet, so this is not a live defect - it is a decision that
rulings 1 and 2 cannot avoid, because both propose a line whose subject is a vendor.

---

## 1. `vendor.remove`

> **RULED 2026-09-14: OPTION B. EMIT, AGENCY FEED ONLY, OFF THE WHITELIST.** Shipped in
> commit `2c2db0f`, `app/api/partnerships/route.ts`, on the `status !== 'removed' -> 'removed'`
> transition only. Payload is `partner_email` and `prior_status`, both about the reader; no
> reason string and no pool count. `vendor.remove` is NOT added to
> `vendor_visible_event_types()`: the counterparty policy has no status predicate, so a
> whitelisted removal row would be readable by the removed vendor permanently, with no
> mechanism to withdraw it.

**The question, unchanged.** Should removing a vendor leave a breadcrumb the removed
vendor's own organization may later read, or is a removal agency-internal?

Gate 1 is clear for this act: a removal operates on an existing `partnerships` row, so a
`partnership_id` is in hand at the emit site and the row can be written either way.

**Option A - emit, and add `vendor.remove` to `vendor_visible_event_types()`.**
- **The line**, shape only, wording still owed: `removed {vendor} from the vendor pool`.
  On the vendor's own feed the same predicate runs with the actor resolved as
  `counterparty`, and the vendor-name slot has to be filled with something else - see the
  note above the rulings.
- **Who sees it:** BOTH. The agency, under "Members read own company milestone events".
  The removed vendor, under the counterparty policy.
- **Counterparty-visible:** yes, and **permanently**. The counterparty policy carries no
  status predicate by design, so removal does not withdraw the row. The vendor reads the
  record of their own removal for as long as the partnership row exists.
- **Payload rule:** a payload limited to the removed partnership is about the reader.
  A reason string, a note, or anything counting the pool is agency internal state and is
  the `recipient_count` class.

**Option B - emit, and leave `vendor.remove` off the whitelist.**
- **The line:** the same line, agency feed only.
- **Who sees it:** the agency only, including colleagues, since gate 2 fails on the
  event type.
- **Counterparty-visible:** no. Not by omission - by the whitelist failing closed, which
  is what `080:133-137` says the whitelist is for.
- **Payload rule:** unenforced in practice, because nobody outside the org can read the
  row. It still binds if the type is ever whitelisted later, and a payload written under
  Option B is what a future whitelisting would expose.

**Option C - do not emit.**
- **The line:** none, on either feed.
- **Who sees it:** nobody. The agency's own feed stays silent about an act that changes
  who can bid.
- **Counterparty-visible:** not applicable.
- **Payload rule:** not applicable.

---

## 2. `vendor.blacklist`

> **RULED 2026-09-14: EMIT ON THE FALSE-TO-TRUE TRANSITION ONLY, AGENCY FEED ONLY, OFF THE
> WHITELIST.** Shipped in commit `2c2db0f`,
> `app/api/agency/pool/[partnerId]/notes/route.ts`. The transition test is load-bearing, not
> defensive: `saveNotes()` posts the flag on EVERY notes save, so an emitter keyed on the
> flag's presence would have put a blacklist line on the feed every time somebody typed a
> note. **The payload is empty and that is the ruling** - the flag lives in
> `partnership_notes` beside a free-text note, a rating and a would-work-again answer, and
> every field of that object is a judgment rather than a fact about the reader.
>
> **Lifting a blacklist is NOT covered by this ruling and has no emitter. See ruling 8.**

**The question, unchanged.** Same question, different act: is blacklisting a judgment about
a company that the company may see?

Gate 1 is clear for the same reason as ruling 1. What differs from ruling 1 is only what
the line asserts: a removal is an administrative state change, a blacklist is a judgment,
and the vendor reading it learns the agency's opinion of them rather than their status.

**Option A - emit, and add `vendor.blacklist` to `vendor_visible_event_types()`.**
- **The line**, shape only: `blacklisted {vendor}`. Same unresolved vendor-name slot on the
  vendor's own feed as ruling 1.
- **Who sees it:** BOTH. The blacklisted vendor reads a line naming their own exclusion.
- **Counterparty-visible:** yes, and permanently, for the same no-status-predicate reason.
  A blacklist that is later lifted does not remove the row; only a delete would.
- **Payload rule:** the blacklist flag lives in `partnerships.partnership_notes` alongside
  the other namespaced keys (`LIGAMENT_CONTEXT.md`, migration 068). Any reason or note
  carried into the payload would be agency internal state under the same test as ruling 1,
  and here the content is a judgment rather than a fact.

**Option B - emit, and leave `vendor.blacklist` off the whitelist.**
- **The line:** the same line, agency feed only.
- **Who sees it:** the agency and its colleagues.
- **Counterparty-visible:** no, by the whitelist failing closed.
- **Payload rule:** as ruling 1 Option B - unenforced today, binding on any later
  whitelisting.

**Option C - do not emit.**
- **The line:** none.
- **Who sees it:** nobody. The agency's feed carries no record of a decision that
  permanently changes the relationship, and a colleague cannot see that it happened.
- **Counterparty-visible:** not applicable.
- **Payload rule:** not applicable.

---

## 3. `client.edit`

> **RULED 2026-09-14: OPTION C FOR NOW. DO NOT EMIT. NO CODE.** There is no `client.edit`
> emitter on `feat/emitter-rulings` and none is owed by this branch. **This is a DEFERRAL,
> not a rejection** - Option B is the shape Greg expects to build, and what blocked it was
> the definition Option B says is owed. That definition now exists, so the next session can
> build it without reopening the ruling.
>
> ### THE DEFINITION OF "MATERIAL". Greg, 2026-09-14.
>
> **A client edit is MATERIAL when it changes STANDING BUSINESS REQUIREMENTS or ATTACHED
> DOCUMENTS.**
>
> **Why those two and nothing else: they flow into every RFP built from that client.** A
> standing requirement or an attached document is not a fact about the client record, it is a
> term that lands in a vendor's inbox the next time an RFP goes out under that client - and
> it lands there silently, under an RFP that may already be open. That is the specific
> silence Option B exists to break, and it is why Option B and Option C are NOT the same
> thing for these fields even though they are the same thing for every other field.
>
> **NOT material: names, notes and contact details.** Renaming a client, correcting a phone
> number or adding an internal note changes nothing any vendor will ever be asked to price
> against. Under Option A each of these is one feed line per save, and successive saves do
> not share a transaction timestamp, so they do not group - the cost of Option A is a feed of
> typo corrections crowding out the edits that matter.
>
> ### WHAT IS STILL OWED BEFORE THE EMITTER CAN BE WRITTEN, AND IT IS NOT THE DEFINITION
>
> The definition decides WHICH SAVES emit. It does not decide the two questions the section
> below raises and this ruling does not answer:
>
> 1. **The field census.** Which columns of `clients` actually hold standing business
>    requirements, and which table holds the attached documents. The definition is stated in
>    the product's language and has to be resolved to a column list before a route can test
>    it. Nothing in this run measured that.
> 2. **Whether it stays agency-only.** The section below establishes that a `client.edit` row
>    carries `partnership_id = NULL` and is therefore agency-only STRUCTURALLY. The moment
>    "material" means "a vendor would notice", somebody will ask for the per-vendor variant -
>    one row per affected partnership - and that is a different emitter with a payload
>    question the section below flags and does not settle: **whether the reading vendor
>    already holds the client's identity.** If they do not, the client name in the payload is
>    about a third party, which is the one test
>    `docs/broadcast-payload-leak-fix.md` applies.


**The question, unchanged.** Does every edit to a client record deserve a feed line, or
only edits that change something a vendor would notice?

**A fact that narrows this ruling before the options start.** A client record is not
addressed to a vendor: `clients.org_id` is an agency column (`079_organizations.sql:855`)
and there is no partnership on the row. So a `client.edit` row would carry
`partnership_id = NULL`, **gate 2 fails on its first clause**, and no counterparty can read
it whatever the whitelist says. Making it vendor-visible is not a whitelist change - it
would mean emitting one row per affected vendor partnership, which is a different emitter
with a different shape, and it raises a question this ruling does not currently ask:
whether a client's identity is something the reading vendor already holds. If it is not,
the client name in the payload is about a third party.

**Option A - every edit emits.**
- **The line**, shape only: `updated {client}`.
- **Who sees it:** the agency only, per the fact above.
- **Counterparty-visible:** no, structurally - null `partnership_id`.
- **Payload rule:** not reachable while the row is agency-only. It becomes live the moment
  a per-vendor variant is considered.
- **What it costs the agency's own feed:** one line per save. The grouping in
  `lib/activity-feed.ts` collapses rows that share a transaction timestamp, and separate
  saves do not share one, so successive edits render as successive lines rather than as
  one grouped entry.

**Option B - only material edits emit, with "material" defined.**
- **The line:** the same line, on a subset of saves.
- **Who sees it:** the agency only.
- **Counterparty-visible:** no, structurally.
- **Payload rule:** as Option A.
- **What is owed before it can be built:** the definition. Until it exists the feed says
  nothing when a client's standing requirements change underneath an open RFP, which is
  the same silence as Option C for exactly the edits that matter most.

**Option C - do not emit.**
- **The line:** none.
- **Who sees it:** nobody.
- **Counterparty-visible:** not applicable.
- **Payload rule:** not applicable.

---

## 4. `rfp.generate` / `rfp.regenerate`

> **RULED 2026-09-14: EMIT ONE TYPE, `rfp.generate`. `rfp.regenerate` IS NOT EMITTED.**
> Shipped in commit `2c2db0f`, `app/api/ai/master-brief/route.ts`. Agency-only
> STRUCTURALLY rather than by whitelist: at generation time there is no recipient, so the row
> carries `partnership_id = NULL` and gate 2 fails on its first clause whatever the whitelist
> says. Payload is empty - the prompt, the model output and the token and cost figures are
> all in scope at the emit site and none is written.
>
> **Why one type and not two.** Nothing persists a generation run, so the server cannot tell
> a first draft from a redraft and the only available discriminator is a flag from the
> browser. Every event type in this product is server-determined and that precedent is not
> worth setting. **See ruling 9 for what would have to exist before the distinction could be
> made honestly.**

**The question, unchanged.** Is an AI generation a milestone, or is only the broadcast that
follows it one?

**A fact that narrows this one too.** At generation time there are no recipients: the RFP
has not been broadcast, so there is no partnership and no vendor. A generation row carries
`partnership_id = NULL` and **gate 2 fails on its first clause**, so this ruling is
entirely about the agency's own feed. There is no counterparty-visible option to weigh
unless generation is re-scoped to emit after recipients are known, which is what
`rfp.broadcast` already is.

**Option A - generation counts as a milestone.**
- **The line**, shape only: `generated the RFP for {scope}`, and a second wording for the
  regenerate variant.
- **Who sees it:** the agency only, including colleagues - which is the case for it, since
  a colleague otherwise cannot see that drafting happened at all.
- **Counterparty-visible:** no, structurally.
- **Payload rule:** not reachable while the row is agency-only. Worth stating anyway: a
  payload carrying prompt text, model output, or a token or cost figure would be agency
  internal state under the same test, and is the field most likely to be reached for here.
- **What it costs the feed:** one line per run. An RFP regenerated four times before
  sending renders five lines, because separate runs do not share a transaction timestamp
  and the grouping rule cannot collapse them.

**Option B - only the broadcast counts.**
- **The line:** the existing `rfp.broadcast` line only -
  `broadcast the RFP for {scope} to {n} vendors` (`lib/activity-feed.ts:384`).
- **Who sees it:** the agency, and each recipient vendor for their own row -
  `rfp.broadcast` is already whitelisted.
- **Counterparty-visible:** yes, for the broadcast, and already is today. Unchanged by
  this ruling.
- **Payload rule:** already settled for `rfp.broadcast` and audited field by field in
  `docs/broadcast-payload-leak-fix.md`.
- **What the feed loses:** the drafting. The day's work renders as one line, and a
  colleague cannot see that four drafts preceded it.

---

## 5. `bid.analyze` / `bid.analyze_retry`

> **RULED 2026-09-14: OPTION B. EMIT, AGENCY FEED ONLY, OFF THE WHITELIST, FROM THE
> DECOMPOSE ROUTE ONLY.** Shipped on `feat/emitter-rulings`,
> `app/api/agency/bids/[responseId]/decompose/route.ts`.
>
> **`app/api/agency/bids/compare/route.ts` EMITS NOTHING.** Not a smaller payload - no row at
> all. N bids across N vendors written by one insert share one `created_at`, land in one
> group, and render `vendorCount` as "to N vendors": the size of the competitive field would
> reach the feed line through the GROUPING with an empty payload and nothing to scrub. **See
> ruling 7.**
>
> **The payload is `scope_item_name` and nothing else, enforced at the emit site by a type
> annotation** rather than by convention - a second key is a `tsc` error (TS2353), verified.
>
> **THE AMENDMENT BELOW IS FACTUALLY CORRECT AND DOES NOT BLOCK THIS RULING.** Re-verified
> 2026-09-15: `loadBidAnalysisContext` genuinely omits `partnership_id`, and Option A
> genuinely cannot be built without it, because gate 2 opens with `partnership_id IS NOT
> NULL`. **Option B was taken, and gate 1 for an agency-side write asks nothing about a
> partnership** - it is `org_id IN current_user_org_ids()` alone. The row is written with a
> null `partnership_id` and read by the agency. `lib/bid-analysis-context.ts` is unchanged by
> this branch; the amendment's cost table remains a live prerequisite for Option A and for
> ruling 7, and must not be deleted.

**The question, unchanged.** Is the analysis the milestone, or is only the human decision
that follows it?

Unlike rulings 3 and 4, gate 1 and gate 2 are both reachable here: an analysis is about one
bid, a bid belongs to one vendor, and the emit site holds a `partnership_id` by the same
route `bid.feedback` and `bid.decline` already use. So this ruling has a genuine
counterparty question, and it is the only one of the six where the analysis payload could
touch more than one vendor.

**Option A - analysis counts, and the type is whitelisted.**
- **The line**, shape only: `analyzed a bid on {scope}`, and a second wording for the retry.
- **Who sees it:** BOTH. The agency, and the vendor whose bid it is.
- **Counterparty-visible:** yes. The vendor learns their bid was analyzed, and learns it
  again for each retry after a failed run - so a run that failed twice tells the vendor
  three times, and the count is a fact about the agency's tooling, not about the bid.
- **Payload rule, and this is the sharp edge of the whole ruling:** the analysis feature
  has a multi-bid side. `bid_comparisons` caches a comparison narrative across a SET of
  responses, keyed on `org_id` plus a hash of the response ids (migration 064). **Any
  payload field drawn from a comparison - a rank, a score relative to others, a set size,
  a spread - describes the competitive field and is the `recipient_count` defect exactly.**
  A payload restricted to `scope_item_name`, which is what every whitelisted type here
  carries, is about the reader.

**Option B - analysis counts, off the whitelist.**
- **The line:** the same line, agency feed only.
- **Who sees it:** the agency and its colleagues. A colleague can see that the bid was
  looked at, and the vendor cannot.
- **Counterparty-visible:** no, by the whitelist failing closed.
- **Payload rule:** unenforced today, binding on any later whitelisting - and this is the
  type where that matters most, because a comparison-derived field written under Option B
  would be exposed wholesale by a later decision to whitelist.

**Option C - only the human decision counts.**
- **The line:** the existing `bid.shortlist`, `bid.award`, `bid.decline` and `bid.feedback`
  lines only, all four already whitelisted and already rendering.
- **Who sees it:** the agency, and the vendor for their own row, exactly as today.
- **Counterparty-visible:** yes, for those four, unchanged.
- **Payload rule:** already settled for those four.
- **What the feed loses:** the feed jumps from bid received to shortlisted with nothing in
  between, and a retry storm is invisible to the agency's own colleagues.

### AMENDMENT (2026-09-14, feat/silent-failures Phase 3). THE PREMISE ABOVE IS FALSE, AND NO OPTION IS ANSWERABLE UNTIL IT IS REPAIRED.

**NOTHING HERE ANSWERS THE RULING.** The question and all three options stand exactly as
written. What is corrected is one factual sentence they rest on, so that whichever option is
chosen is implementable.

**THE FALSE SENTENCE.** Above: "the emit site holds a `partnership_id` by the same route
`bid.feedback` and `bid.decline` already use." **It does not.**

- That route is `resolveBidMilestoneContext`, and it is a LOCAL, NON-EXPORTED function inside
  `app/api/agency/rfp-responses/[id]/route.ts:122`. Neither analysis route can call it.
- The two analysis routes reach their bid through `loadBidAnalysisContext`
  (`lib/bid-analysis-context.ts:42`), used by `app/api/agency/bids/[responseId]/decompose/route.ts:147`
  and `app/api/agency/bids/compare/route.ts:120,125`.
- **`partnership_id` is absent from every projection it makes.** The bid select is
  `:49-51`; the portal-branch scope select is `:82` and reads
  `partner_rfp_inbox` - the very table `partnership_id` lives on - as
  `.select("scope_item_name, scope_item_description")`; the guest branch is `:91`.
  `BidAnalysisContext` (`:13-27`) has no such field, so nothing downstream could use one.

**WHY THAT MAKES THE RULING UNBUILDABLE AS WRITTEN.** Migration 088's vendor INSERT policy
is not the relevant one here (an agency acts), but gate 2 is: 080's counterparty SELECT
policy opens with `partnership_id IS NOT NULL`. **Option A - "the vendor learns their bid
was analyzed" - cannot happen with a null `partnership_id`, whatever the whitelist says.**
Option B and Option C are unaffected: neither needs the column.

**THE COST OF REPAIRING IT, MEASURED. IT IS SMALLER THAN A REFACTOR AND IT SPLITS IN TWO.**

| Bid shape | Is `partnership_id` reachable from what the route already has? | Cost |
|---|---|---|
| Portal bid (`inbox_item_id` set) | **Yes.** `loadBidAnalysisContext:82` already SELECTs `partner_rfp_inbox` by that id, already scoped `.in("lead_org_id", orgIds)`. | **One column added to an existing select. Zero extra queries.** |
| Guest / magic-link bid (`inbox_item_id` null) | **No.** `:91` reads `rfp_magic_tokens`, which carries no `partnership_id` at all. | One extra query against the synthesized `partner_rfp_inbox` row, which is exactly what `resolveGuestBidContext` (`rfp-responses/[id]/route.ts:86-88`) already does. |

**TWO CLAIMS IN `docs/101-phase0-baseline.md` SECTION 3 ARE OVERSTATED, CHECKED AGAINST SOURCE.**

1. It says Option A "begins with an extraction into `lib/`, exercised by five existing call
   sites". `grep -rn "resolveBidMilestoneContext("` over `app/` and `lib/` returns **two
   lines: the declaration at `:122` and ONE call at `:805`.** The other three emit sites in
   that file read `inbox?.partnership_id`, `inboxRow?.partnership_id` and
   `awardContext.partnershipId` directly and do not touch the resolver. So the refactor has
   one dependant, not five - and for the portal case it is not needed at all, because the
   column can be added to `loadBidAnalysisContext`'s own existing select.
2. It says the guest path resolves through `rfp_magic_tokens`. For scope text, yes. For
   `partnership_id`, no: `resolveGuestBidContext:82-88` says in its own comment that the
   synthesized `partner_rfp_inbox` row "is the only source of `partnership_id`".

**AND ONE THING THE RULING DOES NOT ASK, WHICH OPTION A CANNOT AVOID.** `compare` is about
N bids belonging to N vendors, and a single row could carry only one `partnership_id`.
`compare/route.ts:125` ALREADY calls `loadBidAnalysisContext` once per response inside a
`Promise.all`, so if the context carried the column, one row per response - the
`rfp.broadcast` shape `recordMilestones()` exists for - falls out with no further work.
**It is the only shape gate 2 can serve, and it sharpens the payload warning above rather
than softening it: each of the N vendors reads their own row, and any comparison-derived
field on that row describes the other N-1.**

**WHAT THIS AMENDMENT ASKS FOR.** Nothing beyond the ruling already owed. Option A now
carries a known, costed prerequisite instead of a false premise; Options B and C are
unchanged and need no column.

---

## 6. The vendor with no partnership (`docs/emitter-coverage.md` §5)

> **RULED 2026-09-14: OPTION A. FIX IT, PINNED THROUGH `partner_rfp_inbox`.** Authored as
> `supabase/migrations/100_milestone_inbox_pin.sql` on `feat/emitter-rulings`. **NOT APPLIED.**
>
> The new pin is an ALTERNATIVE BRANCH beside 088's partnership-pinned clause, never a
> replacement for it, and the two are MUTUALLY EXCLUSIVE on `partnership_id IS NULL` /
> `IS NOT NULL` rather than merely disjoint - see the migration header for why a disjunction
> of two branches that could both match is unsafe. `partnership_id IS NOT NULL` survives
> unchanged inside branch A. **No application code changes**: the four affected emitters
> already pass the fields the new branch needs.
>
> **ONE FACT IN THE SECTION BELOW IS WRONG AND IS CORRECTED HERE RATHER THAN EDITED AWAY.**
> The affected types are listed as five. **`status_update.post` is not one of them.**
> `app/api/partner/projects/[projectId]/status-update/route.ts` returns 403 "No partnership"
> when the caller has none (:150), resolves its assignment `.in("partnership_id",
> partnershipIds)`, and SKIPS the emit outright if the partnership is not in the caller set
> (:300-306). Its `partnership_id` is non-null by construction and it can never reach this
> gate. **Four types are affected: `rfp.view`, `nda.acknowledge`, `bid.submit` and
> `bid.revise`** - and of those, only the PORTAL `bid.submit` is, because the guest path is
> service-role and RLS does not apply to it.

**The question, unchanged.** Should a vendor who has never been added to the pool be able
to write a breadcrumb onto the agency's feed at all, and if so what pins `org_id` in place
of the partnership row that 088's policy requires?

**What is different about this ruling: it is the only one where BOTH feeds already lose
something, silently, today.** The affected types - `rfp.view`, `nda.acknowledge`,
`bid.submit`, `bid.revise`, `status_update.post` - are ALREADY on
`vendor_visible_event_types()`. They fail at gate 1, not gate 2. With no `partnerships`
row the INSERT is refused, `recordMilestone()` logs and returns void, and there is no row
for either side to read. The agency's feed shows an RFP sent and never shows it opened;
the vendor's own future feed has nothing either.

And it bites earliest in the journey: `rfp.view` and `nda.acknowledge` fire when a
partnership is LEAST likely to exist, so the agency loses breadcrumbs for exactly the
vendors it knows least about (`docs/emitter-coverage.md` §5, "What it now costs").

**Option A - yes, with a migration that pins `org_id` some other way.**
- **The line:** the existing whitelisted lines, which already have wordings -
  `viewed the RFP for {scope}`, `acknowledged the NDA for {scope}`,
  `submitted a bid on {scope}` (`lib/activity-feed.ts:402-408`). No new copy is owed.
- **Who sees it:** the agency immediately. The vendor only if the new pin also satisfies
  gate 2's `EXISTS` against `partnerships` - and if the pin is deliberately NOT a
  partnership, it does not, so this option can land rows the agency reads and the vendor
  cannot. That asymmetry is part of the ruling, not a side effect of it.
- **Counterparty-visible:** depends entirely on what the pin is. Two shapes exist, listed
  without preference: pin through `rfp_magic_tokens`, which carries `org_id` NOT NULL since
  `079:982` and is the record of the invitation itself; or pin through the
  `partner_rfp_inbox` row, which carries `lead_org_id` and is the row the vendor is acting
  on. Each would need its own `EXISTS` clause proving the caller is the party named on that
  record.
- **Payload rule:** unchanged, and already satisfied by these emitters - they carry
  `scope_item_name` and nothing else.
- **THE CONSTRAINT THAT CANNOT BE SKIPPED:** `partnership_id IS NOT NULL` is not
  incidental. It is what makes 088's `EXISTS` reachable, and 088's own header calls that
  `EXISTS` "the clause that matters most" - without it a vendor could write a feed line
  onto an arbitrary agency's dashboard with a payload they composed. **Dropping the null
  check alone reopens the feed-injection hole 088 exists to close.** Any pin has to
  replace that proof, not remove it.

**Option B - no. Status quo.**
- **The line:** none, for these vendors. Unchanged for every vendor who does have a
  partnership.
- **Who sees it:** nobody, on either side.
- **Counterparty-visible:** not applicable - the row does not exist.
- **Payload rule:** not applicable.
- **What it costs, restated because it is a live silence rather than a hypothetical one:**
  five emitters lose their rows for every magic-link and email-invited vendor, the loss is
  invisible at every layer above the log, and it is concentrated on the earliest acts in
  the relationship.

---

---

# THE THREE RULINGS STILL OWED

**Added 2026-09-15, on `feat/emitter-rulings`. NONE OF THEM IS ANSWERED HERE.** Each was
raised BY one of the six answers above, and each is a question the answer could not settle
without becoming a different decision. Same shape as the six: the question, the options, and
for each option what a reader actually sees.

**No option below is recommended, ordered by preference, or marked as a default.** Where
options are listed they run from widest visibility to narrowest, which is an ordering by
scope and nothing else.

---

## 7. `bid.compare`

**The question.** Should a comparison run emit at all; if it does, is it ONE row or N; and
what can its payload carry, given that the set size reaches the feed through the GROUPING
whatever the payload says?

**Raised by ruling 5,** which ruled that `app/api/agency/bids/compare/route.ts` emits
nothing. That answered the decompose route's scope and deliberately did not answer this.

**THE FACT THAT MAKES THIS DIFFERENT FROM EVERY OTHER RULING IN THIS FILE.** Every other
payload question is about a FIELD. This one is not, and a clean payload does not dispose of
it. `groupMilestoneRows()` (`lib/activity-feed.ts:125-160`) keys a group on
`event_type | actor | subject_type | subject_id | created_at` with `created_at` compared
EXACTLY. `recordMilestones()` issues ONE insert for a batch, one statement is one
transaction is one `now()`, so N rows written together are byte-identical in that column and
land in one group. `MilestoneGroup.vendorCount` is then rendered as "to N vendors" - the
same machinery that renders `rfp.broadcast`. **So an N-row comparison publishes the size of
the competitive field with an empty payload and nothing to scrub.** Any option below that
writes N rows has to answer that, and it cannot be answered by editing the payload.

**A second fact, from the ruling 5 amendment above, which is a live prerequisite for
Options A and B.** `loadBidAnalysisContext` does not project `partnership_id`, and gate 2
opens with `partnership_id IS NOT NULL`. **No counterparty can read a comparison row until
that column is carried** - the amendment's cost table measures what it takes. Option C alone
needs nothing.

**Option A - N rows, one per response, whitelisted.**
- **The line**, shape only: `compared bids on {scope}` on each vendor's own row.
- **Who sees it:** the agency, and each of the N vendors for their own row.
- **Counterparty-visible:** yes - and this is the option the grouping fact bites hardest.
  Each vendor reads one row, so no vendor sees `vendorCount` directly; the AGENCY's feed
  shows "to N vendors". Whether a vendor can infer the set size from their own row depends
  on what a vendor feed would render, and **the vendor feed does not exist yet**, so this
  cannot be checked against a screen today. That is a reason the option is hard to rule on,
  not a reason it is wrong.
- **Payload rule:** `scope_item_name` only, on the same reading as ruling 5. A rank, a
  score, a spread, a set size or any slice of the cached narrative describes the other N-1
  and is the `recipient_count` defect exactly.
- **Prerequisite:** `partnership_id` carried per response. See above.

**Option B - N rows, off the whitelist.**
- **The line:** the same line, agency feed only.
- **Who sees it:** the agency and its colleagues. A colleague sees that the field was
  compared and how large it was. No vendor sees anything.
- **Counterparty-visible:** no, by the whitelist failing closed.
- **Payload rule:** unenforced today, binding on any later whitelisting - and **this is the
  type where that matters most in the whole file**, because the exposure on a later
  whitelisting is not only the payload but the grouping, which no payload review would catch.
- **What it still costs:** nothing a vendor reads. The decision is entirely about what the
  agency's own feed is worth carrying.

**Option C - one row, not N.**
- **The line:** `compared bids on {scope}`, once, with no vendor count.
- **Who sees it:** the agency. Structurally agency-only whatever the whitelist says, because
  one row can carry only one `partnership_id` and N vendors cannot share it - so it would
  carry NULL and gate 2 fails on its first clause.
- **Counterparty-visible:** no, structurally.
- **Payload rule:** `scope_item_name` only, and **the set size must not be a payload field** -
  it is the one number this whole ruling is about.
- **What it buys:** the grouping problem disappears, because there is nothing to group.
- **What it loses:** the feed cannot say which vendors were in the comparison, and no vendor
  can ever be told their bid was compared, in this option or any later change short of a new
  emitter.

**Option D - do not emit.**
- **The line:** none. The feed shows the decompositions (ruling 5) and then the human
  decision, with the comparison invisible between them.
- **Who sees it:** nobody.
- **Counterparty-visible:** not applicable.
- **Payload rule:** not applicable.
- **This is the status quo** and what ships on `feat/emitter-rulings`.

---

## 8. The blacklist clear

**The question.** Should LIFTING a blacklist emit a milestone, and under what wording?

**Raised by ruling 2,** which ruled the emitter onto the false-to-true transition ONLY and
left the true-to-false transition with no emitter, no type and no copy.

**THE FACT THAT FORCES THE WORDING QUESTION BEFORE THE EMIT QUESTION.** There is no event
type for this act. `vendor.blacklist` is the only one that exists, its
`MILESTONE_PREDICATES` entry reads ``blacklisted ${vendorOf(i)}``
(`lib/activity-feed.ts`), and gate 3 renders a type through exactly one predicate. **So
reusing `vendor.blacklist` for a clear would render "blacklisted Northwind" for the act that
UN-blacklisted them.** That is not a wording that needs improving, it is a line that states
the opposite of what happened, and it is worse than silence. Any option that emits therefore
needs a NEW TYPE, which needs a new capability name in `lib/capabilities.ts` and a new
predicate - both of which are the wording decision this file's closing note says is owed
separately.

**A second fact, and it is what makes the ruling matter.** The transition test shipped in
ruling 2 means a vendor blacklisted, cleared, and blacklisted again records TWO
`vendor.blacklist` rows and nothing in between. **The feed therefore already shows the same
vendor blacklisted twice with no explanation of how they stopped being blacklisted the first
time** - which reads as a duplicate or a bug rather than as a history. That is a live
consequence of ruling 2, not a hypothetical.

**Option A - emit, new type, whitelisted.**
- **The line**, shape only: a new type whose copy says the blacklist was lifted.
- **Who sees it:** the agency, and the vendor.
- **Counterparty-visible:** yes. **And this is the sharp edge:** ruling 2 kept
  `vendor.blacklist` off the whitelist precisely so a vendor never learns an agency's
  judgment of them. A whitelisted CLEAR tells the vendor there was a blacklist to clear. The
  two decisions cannot be taken separately - whitelisting the clear retroactively discloses
  the thing the original ruling withheld.
- **Payload rule:** empty, on ruling 2's reading - everything in `partnership_notes` is a
  judgment.

**Option B - emit, new type, off the whitelist.**
- **The line:** the same line, agency feed only.
- **Who sees it:** the agency and its colleagues, who can then read the history as a history
  rather than as two identical rows.
- **Counterparty-visible:** no, matching ruling 2 exactly.
- **Payload rule:** empty, as above, binding on any later whitelisting.
- **What is owed before it can be built:** the type name and the copy. Nothing else.

**Option C - reuse `vendor.blacklist` with a payload flag.**
- **The line:** `blacklisted {vendor}` - **WRONG ON ITS FACE**, because
  `MILESTONE_PREDICATES` maps a type to one string and reads exactly one payload key,
  `scope_item_name` (`lib/activity-feed.ts`). A flag in the payload would not reach the
  renderer at all without changing how predicates read payloads, which is a change to the
  feed rather than to this emitter.
- **Who sees it:** the agency, reading a line that says the opposite of what happened.
- **Listed because it is the cheapest-looking option and it does not work.** It is not a
  narrower version of B.

**Option D - do not emit.**
- **The line:** none. The blacklist appears in the feed and never disappears from it.
- **Who sees it:** nobody sees the clear. The agency still sees the flag's CURRENT state on
  the vendor pool page, which is unaffected by any of this.
- **Counterparty-visible:** not applicable.
- **What it costs:** the duplicate-looking history described above, permanently.
- **This is the status quo** and what ships on `feat/emitter-rulings`.

---

## 9. `rfp.regenerate`

**The question.** Is the distinction between a first draft and a redraft worth a
SERVER-SIDE discriminator, given that nothing persists a generation run today?

**Raised by ruling 4,** which emitted one type because the only available discriminator was
a flag from the browser and refused to set the precedent of a client-decided event type.
`rfp.regenerate` remains a live capability key in `lib/capabilities.ts` with no emitter.

**THE FACT THE WHOLE RULING TURNS ON.** `app/api/ai/master-brief/route.ts` writes NO ROW.
The master brief lives in React state until the RFP is broadcast. **So there is nothing for
the server to compare against, and the distinction is not merely unmeasured - it is
unmeasurABLE without new persistence.** This is exactly the shape ruling 5 could resolve and
this one cannot: a decomposition leaves a `bid_decompositions` row, so "has this run before"
is a query. A generation leaves nothing.

**Note what this means for the options: A and B are not two ways of writing an emitter, they
are two different amounts of new persistence, and the emitter is the small half of either.**

**Option A - persist generation runs, then discriminate.**
- **The line:** `generated the master RFP for {project}` on the first run and a second
  wording on each later one.
- **Who sees it:** the agency only, structurally - a generation has no recipient, so
  `partnership_id` is NULL and gate 2 fails on its first clause. Unchanged from ruling 4.
- **Counterparty-visible:** no, structurally, in every option here.
- **Payload rule:** empty, exactly as ruling 4 ruled. The prompt, the model output and the
  token and cost figures are all in scope at the emit site and none may be written. **A run
  count is the field most likely to be reached for the moment a row exists to count** - it is
  a fact about the agency's tooling and its bill.
- **What it costs:** a table, a migration, RLS policies, and a write on a route whose failure
  mode today is that it costs the agency nothing. It also raises a retention question this
  file does not ask: how long a generation history is kept, and who can read it.

**Option B - a cheaper discriminator than a full run history.**
- **The line:** the same two lines as Option A.
- **Who sees it:** the agency only.
- **Payload rule:** as Option A.
- **What is owed before it can be built:** the column. A `generated_at` or a counter has to
  live somewhere a generation can write to before the brief is broadcast, and **today there
  is no such row at all** - which is the fact above, restated. Whether one belongs on
  `projects` is a schema question this ruling does not answer.
- **Why it is listed separately from A:** it is the option that does not create a history,
  and therefore does not raise the retention question. It buys the distinction and nothing
  else.

**Option C - one type, permanently. Close the question.**
- **The line:** `generated the master RFP for {project}`, once per run, with redrafts
  indistinguishable from first drafts.
- **Who sees it:** the agency only.
- **Payload rule:** as above.
- **What it costs:** an RFP drafted four times renders four identical lines. **The grouping
  cannot collapse them** - separate runs are separate transactions with different
  `created_at` values, and the group key compares that column exactly. A colleague reading
  the feed sees four lines and cannot tell whether that is four projects or one project
  redrafted four times, except by the project name.
- **What it buys:** `rfp.regenerate` is retired as a capability key rather than left as a
  permission that grants access to an act nothing records.
- **This is the status quo** and what ships in commit `2c2db0f`, except that the key is left
  in place rather than retired.

---

**Not in this list, and deliberately: the other twelve unrendered types.** They
need a wording, not a ruling. That is a smaller decision but it is still a
decision, and `mapMilestoneGroup()` drops a type with no renderer from the feed
entirely (`lib/activity-feed.ts:435`), so twelve wordings written unattended would
be twelve lines of product voice nobody chose.

**And nothing in the expansion above is a wording decision either.** Every line marked
"shape only" is there to show what the ruling changes on screen, not to choose the words.
A type still needs a `MILESTONE_PREDICATES` entry before it renders at all - gate 3 - and
that entry is the wording decision, owed separately.
