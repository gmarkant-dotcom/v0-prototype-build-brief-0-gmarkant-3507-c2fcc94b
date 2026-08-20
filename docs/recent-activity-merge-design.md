# Recent Activity: merging `milestone_events` into the dashboard feed

Design only. Written 2026-08-20. No code changed by this document.

The ruling this implements: **the dashboard feed is a holistic view of all activity by the
user and their colleagues, plus vendor actions — vendor actions only where there is a
confirmed partnership, or where the vendor is responding to something the lead agency
initiated (a magic-link bid submission qualifies with no partnership).**

The existing feed already satisfies the vendor half of that ruling by construction: all four
of its sources are filtered on `lead_org_id`/`org_id` or on the caller's own project ids, so
a vendor act only reaches the feed because this agency initiated the thing being responded
to. Nothing in this design widens that. What it adds is the agency half — who on *this* team
did what — which the current union cannot express at all, because every one of its four
sources records a timestamp of a **counterparty** act.

---

## 0. What is actually there today

| | |
|---|---|
| Feed builder | `app/api/agency/dashboard/route.ts:388-436` |
| Item shape | `{ id, text, href, timestamp }` — `route.ts:69`, redeclared at `app/agency/dashboard/page.tsx:93` |
| Sources | projects created; bids submitted; RFPs viewed; onboarding acknowledgements |
| Renderer | `ActivityFeed`, `app/agency/dashboard/page.tsx:522-560` |
| Caps | **three**, not two — see §1.3 |
| Volume | ~25 lines all time. One broadcast wrote 49 `rfp.broadcast` rows. |

And `milestone_events` is applied, holds 6 of 23 event types, and **nothing reads it**
(`docs/080-emitter-coverage-report.md`).

---

## 1. The grouping rule

### 1.1 The key

```
groupKey = event_type | actor_id ?? actor_email ?? "guest" | subject_type | subject_id ?? "-" | created_at
```

with `created_at` compared **exactly**, as a string, not bucketed.

The exactness is not a heuristic and it is worth being precise about why it works.
`recordMilestones` (`lib/milestone-events.ts:147`) issues **one** `.insert()` for the whole
batch — that is a single statement, therefore a single transaction, therefore a single
`now()`. `created_at timestamptz NOT NULL DEFAULT now()` resolves to transaction start time,
so all 49 rows of that broadcast carry a byte-identical timestamp. Two different broadcasts
are two different transactions and differ at microsecond resolution. So exact-equality groups
what belongs together and can merge nothing that does not.

This is preferable to a time window (a 5-second bucket would merge two genuinely separate
broadcasts by the same person on the same project) and it is the only key available that
works on **rows already written**, which matters because 080 is append-only — there is no
retroactive `batch_id` to add.

### 1.2 The fallback when `subject_id` is null

`subject_id` is nullable exactly for this case: an RFP broadcast sent outside a project
context has no project id and the wizard permits it (migration 080, `subject_id` column
comment). When it is null, the key uses the literal sentinel `"-"` in that position and
**the timestamp carries the whole discriminating load.** That is sound for the same reason as
above: two projectless broadcasts by the same actor cannot share a transaction, because one
route call is one transaction. The group is still correct; it is only the *label* that has to
degrade, from "…on Northwind Rebrand" to "…to 49 vendors" with no project named and an href
pointing at `/agency/bids` rather than a project page.

**The durable strengthening, for new rows only:** have `recordMilestones` stamp a
`payload.batch_id` (one `crypto.randomUUID()` per call, same value on every row of the
batch). Then the key becomes `payload.batch_id ?? <the composite above>` and stops depending
on transaction semantics entirely. This needs no migration — `payload` is jsonb the emitter
already writes — but it is not retroactive, so the composite key has to exist regardless.
One caution, see §6: `rfp.broadcast` is vendor-visible and the whole row including `payload`
is readable by the counterparty, so a batch id must stay opaque.

### 1.3 Where grouping happens, and both — actually three — caps

Grouping happens **server-side, in `app/api/agency/dashboard/route.ts`**, after the
`milestone_events` fetch and *before* the merge with the derived union, so that one grouped
milestone competes with union items as a single item. Concretely: fetch → group → map to
`ActivityItem` → concat with union items → sort → cap.

The cap is applied in three places today and each one moves differently:

**(a) `route.ts:154` — `.limit(RECENT_ACTIVITY_LIMIT)` on the `onboarding_packages` query.**
This is a *fetch* limit that happens to equal the *display* limit. That coincidence is safe
today only because nothing groups. It is actively wrong for `milestone_events`: a
`.limit(15)` on the milestone query would return 15 rows, all 15 could belong to one
broadcast, and the feed would render exactly **one** line and claim that is all the activity
there is. The two concepts have to separate:

```ts
const ACTIVITY_FETCH_LIMIT = 200   // per-source SQL ceiling, generous
const RECENT_ACTIVITY_LIMIT = 15   // final display cap, applied last
```

`ACTIVITY_FETCH_LIMIT` goes on both the onboarding query and the new milestone query. 200 is
chosen against live volume — the whole feed is ~25 lines all time and the largest single
group is 49 — so it is roughly 4× the worst observed batch and still one page of rows. It is
a ceiling, not a target, and it must be logged when hit (§1.4).

**(b) `route.ts:436` — `activity.slice(0, RECENT_ACTIVITY_LIMIT)`.** Stays, but strictly
after grouping. This is the only place the number 15 should mean "lines the user sees".

**(c) `app/agency/dashboard/page.tsx:524` — `useCappedList(items, SECTION_LIST_CAP)` with
`SECTION_LIST_CAP = 5`.** A third cap, client-side, that this design did not create and does
not need to change. Worth stating so the arithmetic is not a surprise: the user sees **5**
lines, "Show all" expands to the **15** the API sent, and the API grouped **200** fetched
rows down to those 15. Also note `ActivityFeed` renders `Recent activity ({items.length})` —
that count is 15, i.e. lines, not underlying events. After grouping it should arguably be
lines still; the count of underlying events is carried per line by `count` (§4) and does not
belong in the header.

### 1.4 The silent-truncation guard

`ACTIVITY_FETCH_LIMIT` is a place where the feed can quietly stop being complete. If either
source query returns exactly `ACTIVITY_FETCH_LIMIT` rows, log it:

```
console.warn("[dashboard] activity source hit the fetch ceiling; feed may be incomplete",
  { source, limit: ACTIVITY_FETCH_LIMIT })
```

At current volume this never fires. The point is that on the day it does, it reads as a
ceiling rather than as a quiet feed.

### 1.5 The regression this ordering creates if you are not careful

`route.ts:437-445` builds `lastActivityByProject` by iterating the **full, uncapped**
`activity` array and recovering a project id with a regex over `item.href`:

```ts
const match = item.href.match(/^\/agency\/projects\/([^/?]+)/) || item.href.match(/projectId=([^&]+)/)
```

Two consequences, both easy to trip over:

1. It must keep iterating the **ungrouped-or-grouped but uncapped** array. If it is moved to
   read `recentActivity` (the sliced 15) instead, every project outside the newest 15 events
   silently falls back to `created_at` and "last activity" starts lying. Grouping does not
   hurt it — a group keeps its timestamp — but the cap does.
2. Any milestone-derived item whose href does not match one of those two shapes contributes
   **nothing** to the derivation, silently. Rather than tune the regex, §4 puts an explicit
   `projectId` on `ActivityItem` and this loop reads that field. The regex should be deleted
   in the same change; leaving both is how the two drift.

---

## 2. The merge: fifth source, not a replacement

**`milestone_events` joins as a fifth source. The union does not retire, and today it
mostly cannot.**

Take the four existing sources one at a time and ask what would replace them:

| Union source | Would-be event type | Actor side | Can it emit today? |
|---|---|---|---|
| projects created | `project.create` | agency | **Yes.** Capability exists (`lib/capabilities.ts:115`), the agency INSERT policy permits it, `app/api/projects/route.ts` POST is the site. |
| bids submitted | `bid.submit` | vendor | **No.** 080 ships no vendor-side INSERT policy; the only one requires `actor_side = 'agency'`. |
| RFPs viewed | `rfp.view` | vendor | **No.** Same. |
| onboarding acks | `onboarding.acknowledge` | vendor | **No.** Same — and it is not on the vendor-visible whitelist either, so it would be agency-readable only. |

So three of the four are blocked behind a policy that migration 080 deliberately withheld
("the vendor-side INSERT policy ships with the first vendor-side emitter, in the same
commit"), and the fourth is blocked only on someone writing an emit call. **Full replacement
is not available today and will not be until the vendor-side write path is designed.** The
brief already states this; the table above is the itemisation.

Given that, the retirement path is source-by-source and gated, not big-bang:

- **Phase 1 (this design).** Five sources. Milestone rows add agency-side lines the feed has
  never had. Nothing is removed. Zero duplicates (§3).
- **Phase 2.** Add the `project.create` emitter, then delete the `projects` loop at
  `route.ts:391-399`. This is the one retirement available without a policy decision, and it
  is worth doing precisely because it converts the feed's only agency-side line from
  actor-less to attributed.
- **Phase 3.** Whenever the vendor-side INSERT policy ships, the other three retire in the
  same commits as their emitters — never before, or the feed loses lines.

One consequence of a five-source feed that should be said rather than discovered: an
agency-side event stream that was previously invisible is now competing for 15 slots against
vendor acts. At ~25 lines all time this is immaterial. At scale, "who on my team did what"
and "what did vendors do" are arguably two feeds, and the `actor.kind` field in §4 is what a
future filter toggle would key on. Not building that now.

---

## 3. Duplicates

### 3.1 Today: there are none, and that is provable

The six emitting event types are `vendor.invite`, `msa.confirm`, `rfp.broadcast`,
`bid.feedback`, `bid.award`, `bid.decline` — all six are **agency** acts. The four union
sources are three **vendor** acts plus project creation. The sets are disjoint. Checked
individually:

- `partner_rfp_responses.submitted_at` (bid submitted) — the emitting types touch that table
  via `updated_at`, never `submitted_at`. No overlap.
- `partner_rfp_inbox.viewed_at` — written by the guest/portal view path, which emits nothing.
- `onboarding_packages.partner_reviewed_at` — no emitter of any kind.
- `projects.created_at` — no emitter.

So Phase 1 can ship with the dedupe **structure** in place and zero rows flowing through it.
That is the right time to build it, because it is unverifiable later without contriving data.

### 3.2 The collisions that will exist, named now

Exactly four pairs, and each arrives with a known emitter:

| Real-world event | Union item id | Milestone identity | Canonical key |
|---|---|---|---|
| Vendor submits a bid | `response:<response_id>` | `bid` / `<response_id>` | `bid:<response_id>` |
| Vendor opens an RFP | `viewed:<inbox_id>` | `rfp_inbox` / `<inbox_id>` | `rfp_inbox:<inbox_id>` |
| Vendor acknowledges onboarding | `onboarding:<pkg_id>` | `onboarding_package` / `<pkg_id>` | `onboarding_package:<pkg_id>` |
| Colleague creates a project | `project:<project_id>` | `project` / `<project_id>` | `project:<project_id>` |

### 3.3 How to dedupe

**By subject identity, never by timestamp proximity.** Every item — union or milestone —
gets a `dedupeKey`:

- Milestone item: `${subject_type}:${subject_id}`, or `null` when `subject_id` is null.
- Union item: a fixed mapping from its source, per the table above.

Merge into a `Map<string, ActivityItem>`. On collision, **milestone wins** — it carries an
actor and the union item does not, which is the entire point of the merge. Items with a
`null` key are never deduped and are always kept; a null-subject milestone cannot collide
with a union item anyway, because every union item is derived from a specific row.

Note `subject_type` in the milestone row and the table name in the union key must be made to
agree — `MilestoneSubjectType` (`lib/milestone-events.ts`) currently spells the inbox subject
`rfp_inbox` and has no `onboarding_package` member. Adding one is a one-line union-type
change, not a migration (`subject_type` is unconstrained `text` by design).

**This places one hard requirement on every future emitter, and it should be written down at
the emitter, not here:** an emitter that replaces a union source **must** set `subject_id` to
the same row id the union source keys on. A `bid.submit` emit that sets `subject_id` to the
inbox id instead of the response id makes the two undedupeable by anything except timestamp
guessing, and the duplicate ships silently — both lines are true, they just say the same
thing twice. Cheapest insurance: add the assertion as a comment beside `MilestoneSubjectType`
and beside each retired union loop.

Timestamp skew is the reason not to dedupe on time: `bid.submit` would be emitted after the
row is written, so its `created_at` is milliseconds later than `submitted_at`, and the
tolerance you would have to allow is exactly wide enough to merge two genuine revisions.

---

## 4. The `ActivityItem` shape

The current shape carries only `text`, and `text` is a whole sentence with the subject baked
into the front of it. There is nowhere to put an actor and no way for the renderer to treat
one differently from another. Proposed:

```ts
/**
 * Named by RELATION TO THE VIEWER, not by side. See §6 — an agency actor is a
 * "counterparty" on the vendor feed and a "teammate" on this one, and kinds named
 * agency/vendor invert their meaning the moment the same renderer is pointed at
 * the partner dashboard.
 */
type ActivityActor =
  | { kind: "self" }                          // the signed-in user
  | { kind: "teammate"; name: string }        // a colleague in the caller's organization
  | { kind: "counterparty"; name: string }    // the vendor org, on this feed
  | { kind: "guest"; name: string }           // magic-link actor, display name only (§5)
  | { kind: "system" }                        // derived rows with no knowable actor

type ActivityItem = {
  id: string
  /** The PREDICATE only. No leading subject — the renderer composes actor + predicate. */
  text: string
  href: string
  timestamp: string
  actor: ActivityActor
  /** >1 when this line stands for a grouped batch. Absent means 1. */
  count?: number
  /** Explicit, replacing the href regex at route.ts:438. Null when there is none. */
  projectId?: string | null
  /** Provenance, so the source-by-source retirement in §2 is observable. */
  source: "milestone" | "derived"
}
```

`text` becomes a predicate — `"awarded the bid on Key Art"`, not
`"Dana awarded the bid on Key Art"` — and the renderer builds the line:

- `self` → **"You** awarded the bid on Key Art" — second person, actor rendered in muted
  weight. It is a receipt, not news.
- `teammate` → **"Dana Whitfield** awarded the bid on Key Art" — full name in
  `text-foreground`, the rest muted. This is the line the whole feature exists to produce,
  and it should be the visually strongest actor treatment.
- `counterparty` → "Acme Post submitted a bid on Key Art" — indistinguishable from today.
- Grouped → the count is part of the predicate, not a badge:
  "You broadcast the RFP for Key Art to **49 vendors**". A "49" pill beside a line reading
  "broadcast the RFP" invites the reading that it happened 49 times.

The `self`/`teammate` split is the one that carries the ruling. It is resolved in the route by
comparing `actor_id` to `user.id`, and the name for a teammate comes from `profiles.full_name`
— readable, because 079's `"Users can view profiles of partnership members"` policy resolves
through `current_user_visible_profile_ids()`, which includes colleagues in the caller's own
organization. No service-role read is needed and none should be introduced; the dashboard
route runs on the cookie-scoped client and RLS is doing real work here.

### What changing the contract costs in `app/agency/dashboard/page.tsx`

Small and contained — three edits, no new files:

1. **`page.tsx:93`** — the inline `activity: { id; text; href; timestamp }[]` inside
   `DashboardData` gains the four new members. `ActivityFeed`'s props are typed
   `DashboardData["activity"]`, so the component signature follows for free.
2. **`page.tsx:545-548`** — the row markup. Today it is one `truncate` span plus a relative
   timestamp. It becomes actor span + predicate span in the same flex row. `truncate` has to
   stay on the *combined* run or long project names will push the timestamp off; simplest is
   to keep one `min-w-0 flex-1 truncate` wrapper and put both spans inside it.
3. **Nothing else.** The demo fallback at `page.tsx:670` is `activity: []`, which satisfies
   any shape. `formatRelativeTime` is untouched.

Explicitly **not** touched: `app/partner/page.tsx:83`, `app/api/partner/dashboard/route.ts:46`
and `lib/demo-data.ts:806` each declare their own structurally identical `ActivityItem`. They
are separate declarations, not a shared import, so the agency-side change does not reach them
and the partner dashboard needs no edit. That is a happy accident of the current duplication,
and §6 argues it should be converted into a deliberate shared type in `lib/` rather than left
as three copies that have now diverged.

---

## 5. `actor_email`

**No. An agency colleague should not see a guest's raw email address in the feed.**

The access-control argument does not apply and it would be dishonest to lean on it: 080's
rule is that `actor_email` is never rendered *to a counterparty*, and the agency feed is not
a counterparty surface. The agency also already holds these addresses — `recipient_email` is
right there in `partner_rfp_inbox`, and the current feed at `route.ts:415` **already renders
it** as a fallback (`partnerName || row.recipient_email || "A vendor"`). So the precedent
exists and this recommendation narrows it.

The argument for narrowing it anyway is two-part:

1. **It buys the reader nothing.** In a five-word glanceable line, `j.tan@acmepost.com` is
   strictly worse than "Acme Post" at answering "who was that". If a colleague needs the
   address, it is one click away on the bids page, in a context that shows the whole
   relationship rather than a fragment.
2. **One rule beats two.** The formatter that turns `actor_id`/`actor_email` into a display
   string is the piece most likely to be shared with the vendor feed (§6). A formatter with a
   branch that emits a raw address for guests is a formatter that ships to a vendor-facing
   surface with a latent harvest in it, and that branch will be reviewed once, here, and
   never again. Making "display name only, always, both feeds" a property of the function is
   worth more than the marginal identifiability.

**The alternative, in precedence order:**

1. **Resolve to the vendor organization name.** For a guest bid or a magic-link broadcast, the
   email is the inbox row's `recipient_email`, and this route already resolves vendor org
   names into `partnerNameById` (`route.ts:186-199`). → `{ kind: "guest", name: "Acme Post" }`,
   rendered "Acme Post (via link)". The parenthetical matters: it distinguishes an
   unauthenticated actor from a portal user, which is real information a colleague wants.
2. **Domain only when the org does not resolve.** → "a guest at acmepost.com". The domain is
   the identifying half; the local part is the person's inbox and is the harvestable half.
3. **`"A guest"`** when there is no usable domain either.

Never the local part, never the full address. And `actor_email` should not be in the JSON the
route returns at all — not merely unrendered — so that the choice cannot be undone by a
future renderer change alone. The narrowing of the existing `recipient_email` fallback at
`route.ts:415` should happen in the same change, so the feed has one identity rule rather
than a new one beside the old one.

---

## 6. Does this foreclose a vendor-side feed?

`milestone_events` has a counterparty SELECT policy, a 23-type whitelist and a
`(partnership_id, event_type)` partial index that exists for exactly one query. A vendor feed
is clearly intended. This design is agency-only by ruling, so the honest question is which
decisions here would be expensive to unwind. Four, in descending order of cost:

**1. The naming of `ActivityActor.kind`. This is the one that matters.** Kinds named
`agency`/`vendor` are named from the agency's seat and invert on the vendor's: an agency
actor is the *counterparty* there, and "colleague" would mean a vendor's own teammate. Ship
those names and the vendor feed either reuses them with inverted meaning — which is a bug
factory, because the renderer branch that de-emphasises "your own action" would silently
de-emphasise the counterparty's — or a second parallel type appears and the two drift. The
fix is free **now** and expensive later, which is why §4 already spells them
`self | teammate | counterparty | guest | system`. Note the partner dashboard has already
independently invented the self/other distinction in prose:
`app/api/partner/dashboard/route.ts:349` literally writes `"You submitted a bid for ..."`.
That is the same idea, hardcoded into a string, on the other side. Relation-named kinds are
what let one renderer serve both.

**2. Where the grouping and mapping code lives.** If `groupMilestones()` and the row→item
mapper are written inline in `app/api/agency/dashboard/route.ts`, the vendor feed
reimplements both, and the grouping rule — which depends on a subtle transaction-timestamp
argument (§1.1) — gets reimplemented by someone reading the *output*, not the reasoning.
Put them in `lib/activity-feed.ts` from the first commit, with the **actor resolver
injected** as a parameter. The agency resolver returns `self` for `actor_id === user.id`,
`teammate` for a colleague, `counterparty` for the vendor org. The vendor resolver returns
`counterparty` for any agency-side actor, routed through the lead-agency profile tiering
(commit `0016d33`) that 080's closing note requires, and **never** touches `actor_email`.
Same grouping, same shape, different resolver. Costs nothing today; saves the whole rewrite.

**3. Grouping itself is a no-op on the vendor side, and should stay one.** The counterparty
policy is keyed on `partnership_id`, so a vendor sees exactly **one** of the 49 broadcast
rows — their own. Grouping 49 into 1 is an agency-side concern only. This is not hard to
reverse; it is worth writing down because a reviewer of the vendor feed will otherwise ask
why the grouping does nothing and may "fix" it.

**4. Dedupe precedence ports, but the vendor feed has its own union to merge with.**
`app/api/partner/dashboard/route.ts:319` builds a *seven*-source union of its own
(inbox created, NDA confirmed, bid submitted, shortlisted, meeting requested, …). The
"milestone wins over derived" rule and the subject-identity keying both port unchanged. What
does not port is the key mapping table in §3.2, which is agency-source-specific — so that
table belongs beside each source loop as a comment, not in a shared constant that pretends to
be universal.

### One thing found on the way that is not this design's to fix

`payload.recipient_count: rows.length` is written on every `rfp.broadcast` row
(`app/api/agency/broadcast-rfp/route.ts:546`). `rfp.broadcast` is on the vendor-visible
whitelist, and the counterparty SELECT policy grants the **whole row**, `payload` included.
So a vendor can read how many vendors the RFP went to — the size of the competitive field. It
is live today and independent of this design, which reads that field but does not send it
anywhere new. Flagging it because a vendor feed is the surface that would make it visible,
and because §1.2's proposed `payload.batch_id` lands in the same vendor-readable payload and
must therefore be opaque (a random uuid, never a counter, never a recipient list).

---

## Summary of decisions

| # | Decision |
|---|---|
| 1 | Group on exact `created_at` + type + actor + subject; `"-"` sentinel when `subject_id` is null, timestamp carries the discrimination. Add opaque `payload.batch_id` for new rows. |
| 2 | Group server-side, before the merge, before any cap. Split `ACTIVITY_FETCH_LIMIT = 200` (SQL, both sources) from `RECENT_ACTIVITY_LIMIT = 15` (display, applied last). Log on hitting the ceiling. |
| 3 | Keep `lastActivityByProject` on the **uncapped** array and switch it from the href regex to an explicit `projectId`. |
| 4 | Fifth source, not a replacement. Only `project.create` can retire a union source today; the other three wait on the vendor-side INSERT policy. |
| 5 | Zero duplicates today, provably. Build subject-identity dedupe now anyway; milestone wins over derived. Require future emitters to key `subject_id` on the row the union source keys on. |
| 6 | `ActivityItem` gains `actor`, `count`, `projectId`, `source`; `text` becomes a predicate. Three edits in `page.tsx`, zero in the partner files. |
| 7 | Never render `actor_email`, and do not return it. Vendor org name → domain → "A guest". Narrow the existing `recipient_email` fallback in the same change. |
| 8 | Name actor kinds by relation to the viewer, put grouping and mapping in `lib/activity-feed.ts` with an injected actor resolver — the two choices that keep the vendor feed cheap. |
