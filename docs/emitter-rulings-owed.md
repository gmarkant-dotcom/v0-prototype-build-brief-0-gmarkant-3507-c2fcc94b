# The six emitter rulings Greg owes

Six blocked items, restated as six answerable questions. Source:
`docs/emitter-coverage.md` §4 and §5 (2026-08-23). Nothing here is implemented and
nothing here should be until the sentence above it has an answer.

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

---

## 6. The vendor with no partnership (`docs/emitter-coverage.md` §5)

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

**Not in this list, and deliberately: the other twelve unrendered types.** They
need a wording, not a ruling. That is a smaller decision but it is still a
decision, and `mapMilestoneGroup()` drops a type with no renderer from the feed
entirely (`lib/activity-feed.ts:435`), so twelve wordings written unattended would
be twelve lines of product voice nobody chose.

**And nothing in the expansion above is a wording decision either.** Every line marked
"shape only" is there to show what the ruling changes on screen, not to choose the words.
A type still needs a `MILESTONE_PREDICATES` entry before it renders at all - gate 3 - and
that entry is the wording decision, owed separately.
