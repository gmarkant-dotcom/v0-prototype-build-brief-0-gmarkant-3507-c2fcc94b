> # Q2 IS ANSWERED, AND IT WAS ANSWERED IN CODE. OPTION A SHIPPED IN `edff222`.
>
> **Added 2026-09-15** by the `feat/engagements-one-source` run. Verified by reading
> `app/api/partner/payments/route.ts` and `app/partner/payments/page.tsx` at `HEAD`, and by
> `git show edff222`. No database was queried and no SQL was run.
>
> **What section 4's Q2 asks:** what happens to unpaid payment milestones when a relationship
> ends. **Option A** was "payments survive every end state", mechanism "**DELETE** the route
> filter at `partner/payments/route.ts:77`. One line. No migration."
>
> **That is what `edff222` did**, titled *"fix: a vendor owed money keeps seeing it after the
> relationship ends"*. Both halves of the filter came off - the route's `.eq("status","active")`
> and the browser-side narrowing at `app/partner/payments/page.tsx:403`, which
> `docs/pool-counts-and-payments-report.md` section 2 established had to come off with it.
>
> **SO THE FOLLOWING SENTENCES IN THIS DOCUMENT ARE NOW FALSE:**
>
> - **Section 1c** and **Q2's own preamble**: "`app/api/partner/payments/route.ts:77` filters to
>   `status = 'active'`, so today ANY end state blanks the payments page". It does not. There is
>   no status filter on that read any more.
> - **Section 7**: "`app/api/partner/payments/route.ts:77` was **left exactly as it is**". It was
>   not left; it was deleted one commit later.
> - **Option B's** description of itself as "**This is the status quo**". It is no longer the
>   status quo. Choosing B is now a change, not an absence of one.
> - **Section 6 question 2** (how many vendors are affected) is now a question about what
>   `edff222` *revealed*, not about what is hidden.
>
> **WHAT IS STILL OWED, AND THIS IS THE POINT.** Q1, Q3 and Q4 are **untouched and still open**.
> Only Q2 has an answer. Nothing else in section 4 was decided, and Q2's answer does not imply
> the others: a product that shows ended-relationship payments still has no agency-side control
> that ends a relationship (section 8), and still revokes nothing else.
>
> **WHERE THE RULING IS ACTUALLY WRITTEN DOWN, which is not here.** It is in the code, dated and
> attributed, at `app/api/partner/payments/route.ts`: *"GREG RULED AGAINST IT ON 2026-09-14 ... a
> vendor who is owed money keeps seeing what they are owed after the relationship ends, the same
> principle as the RFP closure ruling. The counterparty keeps their record."* So Q2 was ruled
> deliberately, with a stated principle, BEFORE the code changed - section 1c's complaint that
> the product had answered Q2 by accident no longer applies in either direction.
>
> **What is still owed is bookkeeping, not a decision.** The ruling lives in a route comment and
> a commit message; the document written to hold it does not record it, and Option B below still
> describes itself as the status quo. One thing Q2's text raises and the ruling does not address
> is Option A's stated cost - "the agency cannot make a disputed record disappear". Whether that
> was accepted or simply not the deciding factor is not recorded anywhere this run could find.
> **This run did not invent an answer to that.**

# Ending a relationship with an active vendor: the rulings Greg owes

`feat/emitter-rulings`, 2026-09-15. **Discovery only. No feature code was written in this
phase and none should be until the questions in section 4 have answers.**

Everything here is read from source: migrations, policy bodies, and route handlers.
**Nothing was measured against a database.** There are no working credentials in this
environment and no SQL was run, read-only or otherwise. Every question that needs a live
count is listed in section 6 and in the checklist of `docs/emitter-rulings-report.md`, and
none of them is answered by a guess here.

---

## 0. Two corrections to the framing, before the survey

The brief for this phase states two facts. One is right and sharper than stated. The other
is wrong in a way that changes what the ruling is about.

### 0a. "No agency-side control ends a relationship with an active vendor" - TRUE, and it
### is worse than that: NEITHER SIDE CAN

Confirmed. Nothing in `app/` writes `suspended` from anywhere, and the only `terminated`
write is `app/partner/network/page.tsx:456`.

**But that write is the DECLINE of a PENDING INVITATION, not the ending of a live
relationship.** `app/api/partnerships/route.ts:1061` gates the whole vendor branch on

```
if (isPartner && partnership.status === 'pending')
```

so a vendor looking at an **active** partnership has no control either. The agency's own
removal control acts only on Discovered rows, and `removed` is the archive value for a
contact that was never worked with.

So: `partnerships.status` admits `suspended` and `terminated` (CHECK constraint,
`063_invitation_sent_at.sql:34`), the vendor pool page renders badges for both
(`app/agency/pool/page.tsx:1868-1870`), `lib/partnership-state.ts` files both under the
"network" column on purpose, and **no control in the product can put a row into either
state from an active one.** Two statuses with a renderer, a badge and a column, reachable
by nothing.

### 0b. "No policy anywhere filters on partnerships.status" - NOT ACCURATE, and the exception is the whole shape of the answer

Two `SECURITY DEFINER` helpers filter on it, and both gate live policies:

| Helper | Filter | What it gates |
|---|---|---|
| `current_user_commercial_counterparty_org_ids()` (`085:353-360`) | excludes `terminated` and `removed` | `profiles`, through `current_user_visible_profile_ids()` - so `default_terms`, `business_criteria` and `default_nda_url` |
| `current_user_active_counterparty_user_ids()` (`079:779-800`) | requires `status = 'active'` | the `notifications` INSERT policy |

**So ending a relationship already revokes two things today**, and 085 is a deliberate,
argued precedent for exactly the mechanism section 3 keeps proposing: "A company NAME
survives the end of a relationship; its commercial terms do not"
(`085`, the comment on `current_user_visible_profile_ids()`).

**The accurate version of the brief's claim, and it is the one that matters:** no policy on
any **delivery artifact** table filters on status. Every one of them resolves the
partnership by `vendor_org_id IN (SELECT public.current_user_org_ids())` and stops there.
That is what section 1 enumerates.

**And one APPLICATION filter already exists, in the worst possible place.** See 1c.

---

## 1. What is in flight for an active partnership

For each artifact: what the vendor can see and do today, and the exact policy that grants
it. Every policy below is from `079_organizations.sql` unless noted.

### 1a. Project assignments - the award itself

- **Sees:** every assignment row for any of their partnerships, at any status.
- **Does:** updates them. There is an `assignments_partner_update` policy.
- **Granted by:** `assignments_partner_select` / `assignments_partner_update`,
  `USING (partnership_id IN (SELECT p.id FROM partnerships p WHERE p.vendor_org_id IN (SELECT public.current_user_org_ids())))`.
- **No status predicate.**

### 1b. Awarded projects in delivery

- **Sees:** the project behind each assignment, and posts status updates against it.
- **Does:** `partner_status_updates` INSERT, SELECT and UPDATE, all three partnership-scoped.
- **Granted by:** "Partners can insert / view / update their own status updates".
- **No status predicate.**

### 1c. Unpaid payment milestones - AND THE ONE PLACE REVOCATION ALREADY HAPPENS, BY ACCIDENT

- **The policies have no status predicate.** `payment_milestones` carries TWO partner SELECT
  policies, "Partners can view their payment milestones" and "Partners read payment
  milestones for their partnerships", and neither tests status.
- **THE ROUTE DOES.** `app/api/partner/payments/route.ts:74-78` selects partnerships with
  `.eq("status", "active")`. A vendor whose partnership is anything else gets an empty
  array.

> **This is the finding that makes section 4's question 2 urgent rather than theoretical.**
> The data stays readable and the screen goes blank. Any status change away from `active` -
> including `removed`, which an agency **can** already write today through
> `PATCH /api/partnerships` - silently empties the vendor's payments page while the money is
> still owed. `app/agency/pool/page.tsx:2675` names this in a comment; it is recorded here
> as a live consequence rather than a design note.
>
> It also means the product has already half-answered question 2, in the direction nobody
> would choose, through a filter nobody ruled on.

### 1d. Open RFP requests not yet answered

- **Sees:** every inbox row addressed to their organization, and every response they wrote.
- **Does:** updates both.
- **Granted by:** "Partners select inbox rows by partner_id", "Partners update own inbox
  rows", "Partners select own RFP responses", "Partners update own RFP responses",
  "Partners read own response versions".
- **No status predicate.** **AND NO PARTNERSHIP EITHER** - these policies key on
  `partner_rfp_inbox.vendor_org_id` directly, never on a partnership. So ending a
  relationship cannot cut RFP access through the partnership row at all, whatever predicate
  is added to it. That is a structural fact and it constrains every option in section 3.

### 1e. Onboarding packages and their documents

- **Sees:** the package and its document rows.
- **Does:** updates review fields on the package.
- **Granted by:** "Partner reads onboarding packages for their partnership", "Partner
  updates review fields on own packages", "Partner reads documents for their packages",
  "Partners read onboarding deployments for their assignments".
- **No status predicate.**

### 1f. Project documents

- **Sees:** documents on projects they are assigned to, subject to a `visibility` column
  (`'all_partners'` and a per-assignment branch).
- **Granted by:** "Partners can view documents for their assignments", which joins
  `project_assignments` to `partnerships` on `vendor_org_id`.
- **No status predicate**, though `visibility` is a real, separate control that already
  exists and that section 3 should not duplicate.

### 1g. Messages

- **Sees:** every message on their assignments.
- **Granted by:** "Partners can view messages for their assignments", the same
  assignment-to-partnership join.
- **No status predicate.**

### 1h. MSAs

- **Sees:** their own MSA agreements and assignment agreements, and updates signature fields.
- **Granted by:** "Partners can view their MSAs", "Partners read and update own assignment
  agreements", "Partners update agreement signature fields".
- **No status predicate.**

### 1i. Counterparty profiles and notifications - ALREADY CUT

See 0b. `terminated` and `removed` already lose counterparty profile reads; anything but
`active` already loses cross-party notification inserts. **`suspended` keeps profile
access and loses notifications**, which is a split nobody designed - it falls out of two
helpers written for different reasons at different times.

---

## 2. What revocation would have to touch

For each artifact: whether ending the relationship should plausibly cut access, and the
mechanism and its cost. **No option is chosen here.**

| Artifact | Plausibly cut? | Mechanism | Cost |
|---|---|---|---|
| 1a assignments | Yes for future work; **contested for work in delivery** | status predicate on the existing 2 policies | Low. Two policies, one migration. Risk: the vendor loses the delivery record mid-job. |
| 1b status updates | Only if 1a is cut; posting an update on a job you cannot see is incoherent | same predicate, 3 policies | Low, but must move **with** 1a or the two disagree |
| 1c payments | **Probably NOT** - see section 4 Q2 | **remove** the route filter, or add a policy predicate | The cheap direction (adding a predicate) is the one that hurts. The considered direction is **deleting** the existing `.eq("status","active")` at `partner/payments/route.ts:77`, which is a one-line change with a real ruling behind it. |
| 1d RFP inbox and responses | Yes for NEW requests; open ones contested | **Neither a partnership predicate nor an existing policy can do this** - 1d keys on `vendor_org_id`, not on a partnership. Needs either a new column on `partner_rfp_inbox`, or an application filter at broadcast time. | **Highest of the seven.** This is the one that cannot be done with a status predicate, and any estimate that assumes it can is wrong. |
| 1e onboarding | Yes, almost certainly | status predicate on 4 policies | Low |
| 1f documents | Yes, and `visibility` already models "some documents are not for you" | status predicate, **or** reuse `visibility` | Low either way. Reusing `visibility` risks conflating "not shared" with "no longer a partner". |
| 1g messages | Contested - the message history is a record of a job that happened | status predicate on 1 policy | Low mechanically. The question is whether history should vanish. |
| 1h MSAs | **Probably not** - an MSA is a signed contract and the vendor is a party to it | status predicate on 3 policies | Low mechanically, high in principle |
| 1i profiles / notifications | **Already cut.** Nothing to build | none | Zero, but the `suspended` split in 1i should be settled deliberately rather than inherited |

**The three mechanisms, and what each costs in general:**

1. **A status predicate on an existing policy.** Cheapest. Every candidate policy already
   has the `partnerships` subquery; the change is one `AND p.status ...` clause. 085 is the
   worked precedent and its `IS DISTINCT FROM` spelling matters: written by exclusion, so an
   unrecognised or NULL status fails **open**, which 085 argues for explicitly.
2. **A new policy.** Only needed where no partnership-scoped policy exists, which on this
   survey is 1d alone.
3. **An application filter.** Already in use at 1c, and 1c is the argument against it: it
   revokes the SCREEN without revoking the DATA, so the vendor sees nothing and an
   exported report or a second route still returns everything. It also cannot be audited -
   `pnpm policy-audit` reads policies, not route handlers.

---

## 3. Four more questions the survey raised, which the brief did not ask

Listed with section 4's, but separated because they came from the code rather than the
brief.

- **Does `removed` stay a separate act?** An agency can already write `removed` to an
  ACTIVE partnership through `PATCH /api/partnerships` - the route validates the value and
  nothing checks the prior status (`app/api/partnerships/route.ts:1056`). So a fifth path
  into "ended" exists today, is reachable by API, and already blanks the payments page.
- **What happens to the RFP inbox, given it is not partnership-scoped?** 1d.
- **Is `suspended` keeping profile access while losing notifications intentional?** 1i.
- **Does ending write a milestone?** No event type exists. `vendor.remove` is wrong for it
  for the same reason ruling 8 says `vendor.blacklist` is wrong for a blacklist clear: it
  would render "removed {vendor} from the vendor pool" for an act that ended a live
  engagement. A new type, a capability name and a predicate are owed - and under 080's
  status-free counterparty policy, whitelisting it would make it permanently readable by
  the vendor whose relationship just ended.

---

## 4. THE RULINGS. In the shape `docs/emitter-rulings-owed.md` uses. NONE IS ANSWERED HERE.

### Q1. Does ending a relationship cut access to work already awarded and in delivery, or only to future work?

**Option A - a hard cut. Everything goes at once.**
- **The morning after:** the vendor signs in and the project is gone. No assignment, no
  documents, no messages, no way to file a status update on a job they may be
  contractually mid-way through.
- **Mechanism:** status predicate on 1a, 1b, 1e, 1f, 1g. Five tables, one migration.
- **What it does not do:** touch 1d. The RFP inbox is not partnership-scoped, so a hard cut
  leaves the ended vendor still able to read and answer RFPs.

**Option B - future work only. Delivery in flight survives.**
- **The morning after:** the vendor sees every awarded project exactly as before and can
  still deliver, message and invoice. They receive no new RFPs.
- **Mechanism:** the cut lands at broadcast time, not in a policy - which means 1d, the
  hardest one, and nothing else.
- **The question it forces:** what ends the surviving access, and who decides it is done.
  Without an answer, "ending" is a state with no terminal condition.

**Option C - a cut with a defined tail.**
- **The morning after:** unchanged. Thirty days later, gone.
- **Mechanism:** a timestamp column plus a predicate comparing it to `now()`. **This is the
  only option needing a schema change on `partnerships`.**
- **What it buys:** a terminal condition, which B lacks.
- **What it costs:** every policy that reads it becomes time-dependent, so "can this vendor
  see this row" stops being answerable from the row alone.

**Option D - read-only.**
- **The morning after:** the vendor sees everything and can change nothing. The record
  stands; the work stops.
- **Mechanism:** cut the UPDATE policies, keep the SELECTs. Mechanically the CHEAPEST of
  the four, because UPDATE policies are a strict subset of what exists.
- **What it leaves open:** whether a read-only status update can be filed against an active
  job, which is question Q4's problem in a different costume.

### Q2. What happens to unpaid payment milestones?

> **Read 1c first. The product already answers this, in the direction nobody chose.**
> `app/api/partner/payments/route.ts:77` filters to `status = 'active'`, so today ANY end
> state blanks the payments page while the policies keep the rows readable.

**Option A - payments survive every end state.**
- **The morning after:** the vendor sees exactly what they are owed and what has been paid.
- **Mechanism:** **DELETE** the route filter at `partner/payments/route.ts:77`. One line.
  No migration.
- **What it costs:** the agency cannot make a disputed record disappear, which may be the
  point or may be the objection.

**Option B - payments follow the same rule as everything else.**
- **The morning after:** a vendor owed money cannot see the record of it.
- **Mechanism:** none. **This is the status quo**, achieved by an application filter nobody
  ruled on. Making it deliberate would mean adding the predicate to both `payment_milestones`
  policies so the data matches the screen.
- **What it costs:** stated plainly, because it is the reason this question is on the list -
  a vendor owed money who cannot see the record is a real problem, and it is live today.

**Option C - unpaid survives, paid does not.**
- **The morning after:** the vendor sees the outstanding balance and no history.
- **Mechanism:** a predicate on the milestone's own paid flag, not on the partnership.
  Independent of every other option here.
- **What it costs:** the vendor loses the evidence of what was settled at exactly the moment
  they are most likely to need it.

### Q3. Is ending reversible, and if so does access come back?

**Option A - reversible, and access returns in full.**
- **The morning after the reversal:** everything is as it was. No trace that it lapsed.
- **Mechanism:** free, if every cut is a status predicate - flipping the status back flips
  every predicate back.
- **What it costs:** nothing technically. It costs the ability to say when a relationship
  was live, which matters if anything is ever billed or audited by period.

**Option B - reversible, access does not return.**
- **The morning after:** the vendor can be sent new RFPs and cannot see the old projects.
- **Mechanism:** the returning half has to be recorded separately from the status, so this
  needs a column that a status flip does not undo.
- **What it costs:** two facts where there was one, and a state the pool page has no badge
  for.

**Option C - not reversible. Ending is terminal; re-engaging is a new partnership.**
- **The morning after a re-engagement:** a new row, a new history, and the old one readable
  as a closed record.
- **Mechanism:** nothing new - `PATCH /api/partnerships:584` **already reactivates a
  terminated partnership** and stamps `reactivated_from: 'terminated'` (:668). So the
  product currently implements Option A's shape, and choosing C means removing that.
- **What it costs:** two rows for one vendor, which every "find this vendor" query then has
  to handle.

### Q4. Is there one act or two - suspend as pausing, terminate as ending?

**Option A - two acts, two meanings.** `suspended` pauses (no new work, delivery
continues); `terminated` ends.
- **The morning after a suspend:** the vendor keeps delivering and receives no new RFPs.
  After a terminate: Q1 decides.
- **Mechanism:** two controls, and **every predicate in section 2 has to name which
  statuses it excludes** rather than testing `= 'active'`. 085's exclusion spelling
  (`IS DISTINCT FROM`) is the pattern; `current_user_active_counterparty_user_ids()`'s
  `= 'active'` spelling is the anti-pattern, and the two disagree about `suspended` today
  (1i).
- **What it costs:** the largest surface. Two controls, two confirmation dialogs, two sets
  of copy, and every policy predicate becomes a list rather than a comparison.

**Option B - one act.** One "End relationship" control writing one status.
- **The morning after:** one outcome, whatever Q1 chose.
- **Mechanism:** the smallest. One control, one status, and the other value stays unreachable
  in the CHECK constraint.
- **What it costs:** an agency that wants to pause a vendor for a quarter has to end and
  re-add them, which Q3 then has to make survivable.

**Option C - one act with a reason, not two statuses.**
- **The morning after:** identical to B. The reason is for the agency's own record.
- **Mechanism:** B plus a text column, and the reason is agency-internal - it is the
  `vendor.blacklist` payload question again (ruling 2: the content is a judgment).
- **What it costs:** a field that looks like it drives behaviour and does not, which is how
  the next person reading the row gets it wrong.

---

## 5. Build estimate per option

Files and migrations are counted from the survey in section 1. **Every estimate excludes
1d**, which is called out separately because it dominates.

| Option | Policies touched | Migrations | Route/UI files | Risk |
|---|---|---|---|---|
| Q1-A hard cut | ~11 across 5 tables | 1 + down | 2 (control, dialog) | **High.** A vendor mid-delivery loses the job. Reversible only by Q3-A. |
| Q1-B future only | 0 | 0 | broadcast path + 1d | **Medium**, and entirely concentrated in 1d |
| Q1-C defined tail | ~11 | 1 + down, **plus a column on `partnerships`** | 2 | **High.** Time-dependent policies are the hardest thing here to test; the pre-apply harness impersonates a user, not a clock. |
| Q1-D read-only | ~5 UPDATE policies | 1 + down | 2 | **Lowest.** Strictly narrowing, nothing SELECT-side moves, and 085 is the precedent for narrowing a counterparty predicate safely. |
| Q2-A payments survive | 0 | 0 | **1 line** at `partner/payments/route.ts:77` | **Lowest in the document.** Deleting a filter that already exists. |
| Q2-B payments follow | 2 | 1 + down | 0 | Low mechanically. The risk is entirely in the product decision. |
| Q3-A reversible | 0 extra | 0 | 0 | Free if every cut is a status predicate. |
| Q3-C terminal | 0 | 0 | removes the reactivation branch at `:584-668` | Medium. Deleting working behaviour. |
| Q4-A two acts | multiplies every row above | same count, longer predicates | 2 controls instead of 1 | **Medium, and it is a multiplier on whatever Q1 chose, not an addition to it.** |

**1d, costed on its own, because no status predicate can do it.** `partner_rfp_inbox` and
`partner_rfp_responses` key on `vendor_org_id` with no partnership reference. Cutting RFP
access at the policy layer needs either a new `partnerships`-derived column on the inbox
table and a backfill, or a new policy that joins inbox to partnerships on
`(vendor_org_id, lead_org_id)` - a join no policy on that table performs today. Filtering at
broadcast time instead is one route change and zero migrations, but it is an application
filter, with the 1c objection attached: it stops new rows arriving and revokes nothing
already there.

---

## 6. What could not be established, and what would settle it

Each of these is a live query. **None was run.** They appear as checklist items in
`docs/emitter-rulings-report.md`.

1. **How many partnerships are in each status?** If `suspended` and `terminated` have zero
   rows outside declined invitations, Q4 is a greenfield decision. If they have rows, some
   path already produced them and it is not one this survey found.
2. **How many `removed` partnerships have unpaid payment milestones?** This is 1c's blast
   radius. Non-zero means vendors are already unable to see money they are owed.
3. **How many `removed` or `terminated` partnerships have awarded, in-delivery
   assignments?** This is Q1's blast radius.
4. **Does any row have a status outside the CHECK's five values?** 085 is written by
   exclusion specifically because an unrecognised status should fail open; whether one
   exists decides if that caution is live or theoretical.
5. **Has the reactivation branch (`:584-668`) ever fired?** `reactivated_from` is written
   into the row, so it is countable. Q3-C proposes deleting behaviour; whether anyone uses
   it should be known first.

---

## 7. What this phase did not do

**No feature code. No migration. No policy.** No control was added, no predicate was
changed, and `app/api/partner/payments/route.ts:77` was **left exactly as it is** despite
1c reading like a bug - because which direction it should move is Q2, and Q2 is Greg's.

---

## 8. What the build actually costs

**Added 2026-09-15 by the `feat/pool-counts-and-payments` run. NO CODE WAS WRITTEN FOR THIS
SECTION.** Its purpose is narrow and it is not a ruling: section 5 costs the ACCESS options,
which are Greg's to choose. This section costs the **agency-side control** - the thing that
must exist before any of those options has a trigger - so that the session which builds it
starts from a known surface instead of rediscovering one.

**It is independent of every question in section 4.** Whatever Q1 through Q4 are answered,
an agency needs a way to perform the act. What that act then revokes is the ruling.

### 8a. Every write to `partnerships.status`, and which control reaches it

`grep -rn "'suspended'\|'terminated'"` over `app/` and `lib/` was **executed** at `d6074a8`,
along with a sweep of every `.from('partnerships').update(` in both trees. Every hit on
`suspended` and `terminated` outside the two writes below is a type union, a badge branch, a
comment, or a validation list.

| Target status | Written at | Reached from | Who | Precondition |
|---|---|---|---|---|
| `active` | `app/api/partnerships/route.ts:1066` | vendor accepts an invitation | vendor | `partnership.status === 'pending'` |
| `terminated` | `app/api/partnerships/route.ts:1216` | `app/partner/network/page.tsx:456`, declining an invitation | vendor | `partnership.status === 'pending'` |
| `removed` | `app/api/partnerships/route.ts:1335` | `app/agency/pool/page.tsx:2305` "Remove", Discovered column only | agency | none in the route; the control renders only on `pending` rows |
| `suspended` | `app/api/partnerships/route.ts:1335` | **nothing** | - | - |
| `terminated` **from an active row** | `app/api/partnerships/route.ts:1335` | **nothing** | - | - |

**The premise holds, and section 0a's sharper version of it holds too.** The vendor branch is
gated at `:1061` on `if (isPartner && partnership.status === 'pending')`, so the vendor's
`terminated` write is the decline of an invitation and cannot touch a live relationship. The
agency's only control acts on Discovered rows. **No control on either side moves an active
partnership out of `active`.**

### 8b. The route needs NO change. This is entirely a front-end gap

The agency branch is nine lines and it already does the whole job:

```ts
// app/api/partnerships/route.ts:1317
if (isAgency) {
  const isRemoving = partnership.status !== 'removed' && status === 'removed'
  const { data: updated, error } = await supabase
    .from('partnerships')
    .update({ status, updated_at: new Date().toISOString() })   // :1335
    .eq('id', partnershipId)
```

- **Validation already admits both values.** `:1056` checks `status` against
  `['active','suspended','terminated','removed']` and rejects anything else. `suspended` and
  `terminated` pass today.
- **The write is generic.** `.update({ status, ... })` writes whatever passed validation. There
  is no per-status branch, so neither value needs a new code path.
- **Authorization is already correct and must not be touched.** `isAgency` is
  `callerOwnsOrg(callerOrgIds, partnership.lead_org_id)`. An agency can only move its own
  partnerships. **No predicate needs widening for this control to work**, which is what makes
  it separable from everything else in this document.
- **The read side is already built.** `app/agency/pool/page.tsx:1932-1935` renders "Suspended"
  and "Terminated" badges, and `partnershipPoolColumn()` files both under the network column
  deliberately. A row put into either state today would render correctly and immediately.

**So the estimate is: zero route files, zero migrations, zero policies, one component.**

### 8c. Where the control belongs, and the two things it must not copy

**Where.** The Active vendors card action group, `app/agency/pool/page.tsx:2048`, beside
"View profile" and the NDA/MSA confirm group. That group already carries the per-row actions
for a network row and already wraps rather than overflows, which the comment above it explains
at length.

**The call shape already exists.** `handleRemovePartnership()` at `:707` is a nine-line PATCH
against `/api/partnerships` with `{ partnershipId, status }`, followed by `loadPartnerships()`.
A suspend or terminate handler differs from it **only in the status string**.

**What it must not copy, one.** The Discovered "Remove" dialog's copy. `removed` is the archive
for a contact never worked with, and section 1c is why applying it to an active vendor is the
wrong act: it silently blanks that vendor's payments screen through
`app/api/partner/payments/route.ts:77`. A suspend/terminate dialog states what the act does,
and until Q1 is ruled the honest sentence is that it stops future RFPs and does **not** revoke
work already awarded.

**What it must not copy, two.** The deleted dead control. The button removed in
`docs/vendor-removal-report.md` phase 2 called `DELETE /api/partnerships`, which returns 501
because `public.partnerships` has no DELETE policy through 099. A new control must PATCH.

### 8d. What this does NOT buy, stated so the estimate is not misread

Shipping 8b and 8c gives an agency a way to move a partnership to `suspended` or `terminated`,
gives both states a correct badge, and **revokes nothing**. Section 1 is the list of what stays
readable, and section 0b's two `SECURITY DEFINER` helpers are the only status filters that
exist. The control without a ruling is an honest status change and a badge; it is not
revocation, and the dialog copy must not imply that it is.

**One thing it does buy immediately, beyond the act itself.** It makes the divergence recorded
at `app/agency/pool/page.tsx:1391` live: the "Active vendors" TILE counts `status='active'`
while the "Active vendors" COLUMN counts the network pool column, which holds `suspended` and
`terminated` too. They agree today only because nothing writes those statuses. The first
suspended vendor makes the tile and the column header disagree under the same words. That is a
one-line label decision and it belongs to whoever builds this control. See
`docs/pool-counts-and-payments-report.md` section 1.
