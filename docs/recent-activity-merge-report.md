# Recent Activity merge: build report

Written 2026-08-20. Implements `docs/recent-activity-merge-design.md` plus the three rulings
attached to the build instruction. **Left in the working tree, uncommitted, for local review.**

Files touched:

| File | Change |
|---|---|
| `lib/activity-feed.ts` | **New.** Grouping, predicates, dedupe, identity. Resolver injected. |
| `app/api/agency/dashboard/route.ts` | Fifth source, split caps, new item shape, identity narrowing. |
| `app/agency/dashboard/page.tsx` | Widened `activity` type, new `ActivityLine` renderer. |
| `scripts/check-org-id-reads.mjs` | One `ALLOWED` entry, line-scoped, with the reason. |

---

## 1. The three rulings, as built

**1. Actor naming.** The line shows the company name. `guestDisplayName()`
(`lib/activity-feed.ts`) is the single implementation of the precedence: organization name
(rendered `Acme Post (via link)`, so an unauthenticated actor is distinguishable from a
portal user) → `A guest at acmepost.com` → `A guest`. `emailDomain()` takes the domain half
only; the local part is never read into a display string anywhere on either feed.

The raw email reaches the agency as `actor.email` on `kind: "guest"` only, and the renderer
puts it in a `title` attribute on the actor span. It is on hover, never in the line.

**2. How the email reaches the UI.** `ActivityItem` in `lib/activity-feed.ts` has no email
field and no code path in that file reads one. `MilestoneFeedRow.actor_email` is **optional**
so the vendor feed can omit the column from its select list entirely — "never in hand" is
enforced by the column list a caller asks for, not by a filter applied afterwards. The agency
route widens the actor type locally:

```ts
type AgencyActivityActor =
  | Exclude<ActivityActor, { kind: "guest" }>
  | { kind: "guest"; name: string; email: string | null }
```

Grouping and mapping live in `lib/activity-feed.ts` with `MilestoneFeedContext.actor` as the
injected resolver. The vendor feed reuses `groupMilestoneRows`, `mapMilestoneGroup`,
`mergeActivityEntries`, `milestoneDedupeKey` and every predicate unchanged, and supplies its
own resolver returning a bare `ActivityActor`.

**3. The same rule for `payload`.** No payload object crosses to the client. Exactly one
function in the whole change touches a payload — `payloadString(payload, "scope_item_name")`
— and its parameter type is the string literal `"scope_item_name"`, so a second key is a
compile error rather than a review catch. Everything else a line needs comes from ids the
route already holds:

- project name → `projectById`, keyed on `subject_id` (broadcast) or response → inbox →
  project (bids). **Not** `payload.project_id` / `payload.project_name`, which exist on the
  `bid.award` payload.
- vendor name → `partnerNameById`, from the `organizations` read. **Not**
  `payload.partner_email`, which sits right there on the `vendor.invite` payload.
- batch size → group size. Never stored, which is the closed `recipient_count` finding.

`rfp.broadcast` payloads already carry `recipient_email` per row. A passthrough would have
shipped every recipient address of every broadcast to the browser.

**Actor kinds** are `self | teammate | counterparty | guest | system`, named by relation to
the viewer, so one renderer serves both feeds.

---

## 2. Acceptance, stated explicitly

Verified by a 31-assertion simulation compiled against the real `lib/activity-feed.ts` (not a
copy) and run under Node. **All 31 pass.** The harness is scratch-only and not committed.

### ✅ The existing `bid.decline` row appears in the feed, attributed as `self`

Simulated against the exact row the emitter writes at
`app/api/agency/rfp-responses/[id]/route.ts:963` — `actor_side: "agency"`,
`actor_id: user.id`, `subject_type: "bid"`, `subject_id: <response_id>`,
`payload: { scope_item_name, had_reason }`. It renders:

> **You** declined a bid on Key Art

`actor.kind === "self"` because `actor_id === user.id`. It also survives the merge: see the
dedupe correction in §5, which is the reason it does.

**One honest limit:** I could not query the live database to confirm that row is physically
there — the sandbox blocked the PostgREST read. The claim is that a row of that shape
renders that way, verified end to end in code. Confirm the row itself with
`SELECT event_type, actor_id, subject_id, created_at FROM milestone_events ORDER BY created_at DESC;`

### ✅ A 49-row broadcast renders as ONE line, and costs one of the 15 slots

49 rows sharing one transaction timestamp collapse to one group and one item:

> **You** broadcast the RFP for Key Art to **49 vendors**

`count: 49`, `countIsPartial` absent. Merged alongside all four derived sources plus the
decline, the array is **6 items, not 54**, so the batch consumes exactly one display slot.
Also verified: two broadcasts microseconds apart stay two groups; a projectless broadcast
(`subject_id: null`, `"-"` sentinel) is still one group and degrades to `/agency/bids` with a
null `projectId`.

The count is in the predicate, not a badge. A "49" pill beside "broadcast the RFP" invites
the reading that it happened 49 times.

The `+` case is real, not theoretical: with the fetch cut mid-batch, the line renders
`to 10+ vendors`, never a bare wrong `10`. All three §1.6 cases are covered — under the
ceiling nothing is discarded; at the ceiling with more than one timestamp the oldest tie
group is dropped and every surviving count is exact; at the ceiling with one timestamp the
group is kept and marked partial.

### ✅ The four derived union sources still render

All four still build, all four still appear after the merge, verified by id
(`project:*`, `response:*`, `viewed:*`, `onboarding:*`). Their copy is unchanged in
composition — `text` is now the predicate and the actor is rendered separately, so
"Acme Post submitted a bid on Key Art" reads identically to before.

Two of them changed **identity** deliberately, per §7 of the design (§4 below).

### ✅ `lastActivityByProject` still works — and yes, milestone items reach it

It still iterates the **uncapped** `activity` array. The href regex is **deleted** and the
loop reads `item.projectId`, which every item now carries explicitly. Milestone items reach
it wherever a project is resolvable:

| Milestone | `projectId` |
|---|---|
| `rfp.broadcast` | Yes — `subject_id` **is** the project id |
| `bid.award` / `bid.decline` / `bid.feedback` | Yes — response id → inbox row → `project_id` |
| `vendor.invite` / `msa.confirm` | No — subject is a partnership, correctly `null` |

Verified in the simulation: the decline at 16:00 becomes the project's last-activity
timestamp over four older derived items.

---

## 3. The eight gates

Baseline re-measured on a clean tree before any edit, and it matches
`docs/broadcast-payload-leak-fix.md` exactly.

| Gate | Baseline | This run | Verdict |
|---|---|---|---|
| `npx tsc --noEmit` | 0 | **0** | Passes. The bar CLAUDE.md sets. |
| `pnpm build` | 0 | **0** | Passes. Full production build. |
| `pnpm lint` | 1 | **1** | Unchanged. **183 problems, 154 errors, 29 warnings** — identical totals. |
| `pnpm verify-rls` | 2 | **2** | Known pre-existing. Fails before reading a policy. |
| `pnpm policy-audit:guard` | 1 | **1** | Known pre-existing. Reads a static pre-079 snapshot. |
| `pnpm identity-columns:guard` | 0 | **0** | Passes. |
| `pnpm embed-targets` | 0 | **0** | Passes. |
| `pnpm org-id-reads:guard` | 0 | **0** | Passes — **after one allow-list entry.** See below. |

**The org-id-reads entry is the only gate that needed anything.** The new teammate-name
lookup at `app/api/agency/dashboard/route.ts:357` is `.in("id", teammateIds)` against
`profiles`, and the NEARBY heuristic fired because `callerOrgIds` is in scope in the same
40-line window — which is the `milestone_events` org filter, not this one.

`teammateIds` are `milestone_events.actor_id` values. That column is a `profiles(id)` foreign
key, declared as one in migration 080, and 080's column comment says so in words: *"the
acting user, not a company: a profiles.id, and 079 did not rename it."* So it is genuinely
Class A's exempt case and belongs in `ALLOWED`, not `KNOWN_OPEN` — `KNOWN_OPEN` means "this
IS the bug and is deliberately unfixed", and this is not the bug.

Scoped to line **357** only, following the roster precedent (`36d03fa`), so any future
`profiles` read added to this route is a real finding rather than something the entry quietly
covers. Line scoping also fails closed: if the line shifts, the entry stops matching and the
guard fails rather than silently allowing more.

---

## 4. What changed in `app/agency/dashboard/page.tsx`, and the three components

Two edits, exactly as the design predicted, plus one new local component.

1. **The `DashboardData["activity"]` type** gains `actor`, `count`, `countIsPartial`,
   `projectId`, `source`. `ActivityFeed`'s props are typed `DashboardData["activity"]`, so
   the component signature followed for free.
2. **A new `ActivityLine` component**, and the row markup calls it. `truncate` stays on the
   combined run — one `min-w-0 flex-1 truncate` wrapper with both spans inside — so a long
   project name eats the ellipsis instead of pushing the timestamp off the row.

Visual ranking, which is the ruling made visible: teammate strongest (`font-medium
text-foreground`, muted predicate), self muted (a receipt, not news), counterparty and guest
unchanged from before the merge, system rendered with no actor and a capitalised predicate.

**Nothing else in the file.** The demo fallback is `activity: []`, which satisfies any shape.
`formatRelativeTime` untouched. `SECTION_LIST_CAP = 5` untouched, and the header still reads
`Recent activity ({items.length})` — lines, not underlying events, which is right now that a
line can stand for 49.

**The three components asked about are all unaffected, and none of them is a near miss:**

- `components/empty-state.tsx` — one string, `"No payment activity"`, in the payments empty
  state. No import from either dashboard file.
- `components/bid-detail-sheet.tsx` — its `activityTimeline` is `buildBidTimeline()` from
  `lib/bid-timeline.ts`, a per-bid timeline built from four timestamp columns
  (`created_at`, `submitted_at`, `feedback_updated_at`, `awarded_at`) with its own
  `BidTimelineEntry` type. Different data, different shape, no overlap.
- `components/agency-layout.tsx` — the word "activity" appears twice, both in the Summary
  Dashboard nav tooltip copy.

---

## 5. The vendor dashboard

**It has its own copy of the shape and its own union, and nothing I changed touches either.**

`ActivityItem` is declared **three** times, independently, none of them a shared import:
`app/api/partner/dashboard/route.ts:46`, `app/partner/page.tsx:83`, and
`lib/demo-data.ts:806` (as `DemoActivityItem`). All three are still the old four-field shape.
The agency-side change cannot reach them.

The partner route builds a **seven**-source union of its own at `:319` (inbox created, NDA
confirmed, bid submitted, shortlisted, meeting requested, …) and reads no `milestone_events`.
Notably it has already invented the self/other distinction in prose — `:349` literally writes
`"You submitted a bid for ..."` — which is the same idea this change makes structural, on the
other side. That is the line `{ kind: "self" }` replaces when the vendor feed is built.

What the vendor feed inherits for free: grouping, all 23 predicates (including the seven
vendor-side ones written now precisely so it does not invent copy), the dedupe precedence,
the subject-identity keying, and the identity rule. What it must supply: a resolver, its own
name lookups, its own key-mapping table for its seven sources, and **a select list without
`actor_email`**. Grouping will be a no-op there — the counterparty policy is keyed on
`partnership_id`, so a vendor sees exactly one of the 49 broadcast rows, their own. That is
correct and should not be "fixed".

---

## 6. What turned out to be wrong in the design

### 6.1 The dedupe rule as written eats a real line. This is the substantive one.

§3.3 says every item gets `dedupeKey = ${subject_type}:${subject_id}`. Applied to milestone
rows as stated it is **wrong today, and silently**. Three emitters already write
`subject_type: "bid", subject_id: <response_id>` — `bid.feedback` (`:701`), `bid.award`
(`:866`) and `bid.decline` (`:963`). Under a bare subject-identity key:

- `bid.award` on response X collides with the derived *"Acme Post submitted a bid on X"*
  line, milestone wins, and **the vendor's submission disappears from the feed**; and
- award, decline and feedback on the same response collapse into **one line**.

Those are four different real-world events about one row. §3.1's proof that there are zero
duplicates today is about *event types*, and it is correct; the *key* it hands to §3.3 is
broader than the proof.

Subject identity is the right key, but only between an event and the union source it
**replaces** — a much smaller relation than "shares a subject". So `milestoneDedupeKey()` is
gated on an explicit table:

```ts
export const UNION_REPLACING_EVENT_TYPES = {
  "project.create": "project",
  "bid.submit": "bid",
  "rfp.view": "rfp_inbox",
  "onboarding.acknowledge": "onboarding_package",
}
```

Everything else keys `null` and is never deduped. As a bonus, §3.3's "hard requirement on
every future emitter" is now **executable** rather than a comment: the function checks the
`subject_type` half and warns on a mismatch instead of silently deduping the wrong pair.
(The `subject_id` half still is not checkable from here.)

Verified both directions: `bid.decline` does not swallow the derived bid line, and a
hypothetical `project.create` **does** dedupe against `project:<id>` with the milestone
winning regardless of argument order.

### 6.2 Fixing the regex changes project ordering, and the design does not say so

§1.5 frames the href regex as something that silently drops *milestone* items. It also
silently drops **two of the four existing derived sources**: bids-submitted and RFPs-viewed
both href to `/agency/bids`, which matches neither regex shape, so neither has **ever**
counted as activity on the project it belongs to.

Giving every item an explicit `projectId` fixes that — and therefore changes
`projectsByActivity` ordering on the Recent Projects list. A project whose only recent event
is a vendor viewing its RFP now sorts as recently active. I believe that is the correct
reading of "last activity" and it is what the design asks for, but it is a **visible
behaviour change beyond the activity feed** and the design does not name it.

### 6.3 One broadcast can span several scope items, so "to 49 vendors" can overcount

§1.1's transaction argument is sound, but `app/api/agency/broadcast-rfp/route.ts:176` loops
`for (const item of items)` and pushes rows per (scope item × recipient). One call is one
transaction, so a broadcast covering 3 scope items to 20 vendors is **60 rows, one
timestamp, one group** — and the line reads "to 60 vendors" when 20 vendors were invited.

The group is still *correct* (it is one act) and the label is *approximately* right, so I
have **not** worked around it: the fix belongs on the emitter side, where §1.2's proposed
opaque `payload.batch_id` would land anyway. Adding a per-scope-item discriminator to the key
would split one act into three lines, which is worse. Flagging rather than fixing, because
the honest fix is a scope-item id in the group key **and** a recipient-distinct count, and
neither is derivable from rows already written.

At current volume this has never fired — every broadcast so far has been single-scope.

### 6.4 Two smaller things

**§5 names only `route.ts:415`, but there were two raw-address fallbacks, not one.**
`partnerNameForPartnership()` (old `:204`) ended in `partnership.partner_email`, feeding the
onboarding-acknowledgement line. Both are narrowed in this change — one identity rule, as §5
asks — and the function is replaced by `vendorActorForPartnership()`, which returns an actor
rather than a string.

**A `milestone_events` read failure must not 500 the dashboard.** The design does not say
where the new query sits relative to the hard error check. It is deliberately **outside** it:
an unreadable breadcrumb table (42P01 in an environment where 080 is unapplied, or a policy
change) logs at WARN and degrades the feed to its four derived sources. This is the same rule
`lib/milestone-events.ts` applies on the write side, where a failed insert never rolls back
the award it describes.

---

## 7. Follow-ups this change does not do

- **`MilestoneSubjectType`** in `lib/milestone-events.ts` still has no `onboarding_package`
  member. One-line union-type change, no migration (`subject_type` is unconstrained `text`).
  Only needed when the `onboarding.acknowledge` emitter is written.
- **§1.2's opaque `payload.batch_id`** is not added. It is for new rows only and the
  composite key has to exist regardless, which it does. §6.3 is the argument for doing it
  sooner rather than later.
- **Phase 2** (`project.create` emitter, then delete the projects loop) is not started. The
  dedupe for it is built and tested, so the emitter is now the only missing piece.
