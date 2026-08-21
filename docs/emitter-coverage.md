# milestone_events emitter coverage — MEASURED, not cited

**Every number here came off a grep over this working tree** on branch
`feat/m1-entitlements-fix`. Counts in this project have been floors five times
running, so nothing below is carried forward from a previous report.

**Method.** The vocabulary is `docs/capabilities.md` section 5, which is the
one vocabulary shared by the capability map and the attribution map. Emitters
are every `eventType:` passed to `recordMilestone()` / `recordMilestones()`
anywhere in `app/` and `lib/`. Renderers are `MILESTONE_PREDICATES` in
`lib/activity-feed.ts`. Whitelists are `vendor_visible_event_types()` (080) and
`vendor_emittable_event_types()` (088), read from the migration files.

---

## The headline

| | Before this session | After |
|---|---|---|
| **Vendor-visible types with an emitter** | 21 of 23 | **23 of 23** |
| **Whole vocabulary with an emitter** | 21 of 42 | **24 of 42** |
| Whole vocabulary with a **renderer** | 28 of 42 | 28 of 42 |

**The figure carried into this session was "17 of 23 with four added, so roughly
21". The measured number was 21 of 23, so that estimate was right — and it was
right about the count while being silent about WHICH two were missing, which is
the part that mattered: both gaps were VENDOR-VISIBLE, and both were already
whitelisted to be written and already had a feed renderer. They were simply
never wired up.**

**Three emitters were implemented this session**, all of them blocked by
nothing: `rfp.view`, `nda.acknowledge`, `project.create`.

---

## 1. THE DISCRIMINATOR — why 18 of the remaining gaps are NOT "blocked by nothing"

This is the finding that shapes everything below, and it is not visible from a
count of emitters.

`mapMilestoneGroup()` (`lib/activity-feed.ts:435`) looks the event type up in
`MILESTONE_PREDICATES` and **returns `null` when there is no predicate**:

```ts
const build = MILESTONE_PREDICATES[row.event_type]
if (!build) {
  ctx.onUnknownEventType?.(row.event_type)
  return null
}
```

**A row whose event type has no renderer is DROPPED FROM THE FEED ENTIRELY.**
It is written, it is stored, it is readable by policy, and it appears nowhere.

So "write the emitter" is only half the work for any type without a predicate.
The other half is deciding **what the line says** — and that is a copy decision
in a product whose stated rule is "professional, direct, warm", not a mechanical
one. Writing eighteen feed lines unattended and guessing at eighteen wordings is
exactly the kind of change that should not happen while Greg is away.

**That is the line this document draws:** a gap with a renderer is blocked by
nothing and was implemented. A gap without one needs a wording, and the wording
is Greg's.

---

## 2. IMPLEMENTED THIS SESSION — three, all blocked by nothing

### `rfp.view` — `app/api/partner/rfps/[id]/route.ts:83`

**Vendor-visible gap 1 of 2.** Already on `vendor_emittable_event_types()`
(088:408) and `vendor_visible_event_types()` (080), already rendered at
`activity-feed.ts:404`, already has its expected subject type recorded as
`rfp_inbox` at `:506`. Nothing was widened.

**It fires on the FIRST view and only the first.** The emit sits inside
`if (updatedInbox)`, and the UPDATE above it carries `.is("viewed_at", null)`,
so it matches exactly once per inbox row. **A vendor reloading the page emits
nothing.** Putting the emit outside that branch would have put one line on the
agency's feed per page load, which is the difference between a breadcrumb and a
log.

### `nda.acknowledge` — `app/api/partner/rfps/[id]/nda-notify/route.ts:120`

**Vendor-visible gap 2 of 2.** Already on both whitelists (088:411), already
rendered at `activity-feed.ts:407`. Fires after the agency notification email
and the `agency_nda_notified_at` stamp, both of which have already succeeded, so
a lost breadcrumb cannot turn a completed notification into an error.

Subject is the **inbox row**, not the partnership: the vendor acknowledged the
NDA for one scope item on one RFP, and that is what the agency's feed line
names.

### `project.create` — `app/api/projects/route.ts:634`

**The one agency-side type in the whole vocabulary that had a renderer and no
emitter** — rendered at `activity-feed.ts:383`, expected subject `project` at
`:504`. Agency-side, so `actorSide` is left to its `"agency"` default and no
partnership is involved: 080's INSERT policy asks only that `org_id` is one of
the caller's organizations, and `writeOrgId` was already resolved from
membership by the route.

**Correctly NOT vendor-visible.** `project.create` is absent from
`vendor_visible_event_types()`, so the row is agency-internal. A vendor has no
business seeing that a project exists before they are invited to bid on it.

---

## 3. THE FULL VOCABULARY — 42 types, one row each

`V` = on `vendor_visible_event_types()`. `E` = on
`vendor_emittable_event_types()`. **NEW** = implemented this session.

| # | Event type | V | E | Emitter | Renderer | Blocked by |
|---|---|---|---|---|---|---|
| 1 | `vendor.invite` | V | | `app/api/partnerships/route.ts:624`, `:756` | yes | — |
| 2 | `vendor.invite_resend` | V | | `app/api/agency/pool/resend-invitation/route.ts:120` | yes | — |
| 3 | `rfp.broadcast` | V | | `app/api/agency/broadcast-rfp/route.ts:553` | yes | — |
| 4 | `rfp.magic_link_send` | V | | `app/api/agency/rfp/magic-link/route.ts:444` | yes | — |
| 5 | `rfp.deadline_set` | V | | `app/api/agency/rfp/magic-link/route.ts:473` | yes | — |
| 6 | `rfp.deadline_change` | V | | `app/api/agency/rfp/magic-link/route.ts:473` | yes | — |
| 7 | `bid.shortlist` | V | | `app/api/agency/rfp-responses/[id]/route.ts:815` | yes | — |
| 8 | `bid.meeting_request` | V | | `app/api/agency/rfp-responses/[id]/route.ts:815` | yes | — |
| 9 | `bid.award` | V | | `app/api/agency/rfp-responses/[id]/route.ts:1100` | yes | — |
| 10 | `bid.decline` | V | | `app/api/agency/rfp-responses/[id]/route.ts:1221` | yes | — |
| 11 | `bid.feedback` | V | | `app/api/agency/rfp-responses/[id]/route.ts:933` | yes | — |
| 12 | `onboarding.package_send` | V | | `app/api/projects/[id]/onboarding-packages/route.ts:478` | yes | — |
| 13 | `onboarding.deploy` | V | | `app/api/projects/[id]/onboarding/deploy/route.ts:226` | yes | — |
| 14 | `msa.confirm` | V | | `app/api/partnerships/route.ts:997` | yes | — |
| 15 | `status_update.resolve` | V | | `app/api/agency/projects/[projectId]/status-updates/route.ts:272` | yes | — |
| 16 | `payment.mark_paid` | V | | `app/api/agency/msa/milestones/route.ts:685` | yes | — |
| 17 | `bid.submit` | V | E | `app/api/partner/rfps/[id]/response/route.ts:506`, `app/api/rfp/guest/[token]/route.ts:857` | yes | — |
| 18 | `bid.revise` | V | E | `app/api/partner/rfps/[id]/response/route.ts:506` | yes | — |
| 19 | **`rfp.view`** | V | E | **NEW** `app/api/partner/rfps/[id]/route.ts:83` | yes | — |
| 20 | `invitation.accept` | V | E | `app/api/partnerships/route.ts:1082` | yes | — |
| 21 | `invitation.decline` | V | E | `app/api/partnerships/route.ts:1225` | yes | — |
| 22 | **`nda.acknowledge`** | V | E | **NEW** `app/api/partner/rfps/[id]/nda-notify/route.ts:120` | yes | — |
| 23 | `status_update.post` | V | E | `app/api/partner/projects/[projectId]/status-update/route.ts:308` | yes | — |
| 24 | **`project.create`** | | | **NEW** `app/api/projects/route.ts:634` | yes | — |
| 25 | `vendor.add` | | | **none** | **none** | RENDERER + a wording |
| 26 | `vendor.remove` | | | **none** | **none** | RENDERER + a wording, and a RULING — see §4 |
| 27 | `vendor.blacklist` | | | **none** | **none** | RENDERER + a wording, and a RULING — see §4 |
| 28 | `client.create` | | | **none** | **none** | RENDERER + a wording |
| 29 | `client.edit` | | | **none** | **none** | RENDERER + a wording, and a RULING — see §4 |
| 30 | `client.document_add` | | | **none** | **none** | RENDERER + a wording |
| 31 | `client.document_remove` | | | **none** | **none** | RENDERER + a wording |
| 32 | `project.client_change` | | | **none** | **none** | RENDERER + a wording |
| 33 | `rfp.brief_upload` | | | **none** | **none** | RENDERER + a wording |
| 34 | `rfp.generate` | | | **none** | **none** | RENDERER + a wording, and a RULING — see §4 |
| 35 | `rfp.regenerate` | | | **none** | **none** | RENDERER + a wording, and a RULING — see §4 |
| 36 | `rfp.scope_allocate` | | | **none** | **none** | RENDERER + a wording |
| 37 | `bid.analyze` | | | **none** | **none** | RENDERER + a wording, and a RULING — see §4 |
| 38 | `bid.analyze_retry` | | | **none** | **none** | RENDERER + a wording, and a RULING — see §4 |
| 39 | `bid.score` | | | **none** | **none** | RENDERER + a wording |
| 40 | `delivery.review_complete` | | | **none** | **none** | RENDERER + a wording |
| 41 | `msa.create` | | | **none** | **none** | RENDERER + a wording |
| 42 | `msa.milestones_set` | | | **none** | **none** | RENDERER + a wording |

**Not one of the eighteen is blocked by a POLICY.** 080's agency INSERT policy
asks only that `org_id` is one of the caller's organizations, which every one of
those routes already resolves. They are blocked by the feed having nothing to
say about them.

---

## 4. THE RULINGS GREG OWES — one sentence each

Six of the eighteen need more than a wording. Each is one question.

1. **`vendor.remove` / `vendor.blacklist`** — *Should removing or blacklisting a
   vendor leave a permanent breadcrumb on a feed the removed vendor's own
   organization may later be able to read, or is a removal an agency-internal
   act that leaves no trace the counterparty can ever see?*

2. **`client.edit`** — *Does every edit to a client record deserve a feed line,
   or only the ones that change something a vendor would notice, given that a
   per-edit breadcrumb turns the feed into a change log?*

3. **`rfp.generate` / `rfp.regenerate`** — *Is an AI generation a milestone at
   all, or is only the resulting broadcast one, given that regenerating five
   times before sending would put five lines on the feed for one act?*

4. **`bid.analyze` / `bid.analyze_retry`** — *Same question for bid analysis:
   is the analysis the milestone, or is only the human decision that follows it
   the milestone?*

**The other twelve need only a wording**, which is a smaller decision but still
a decision: the feed's voice is a product surface and eighteen lines written by
an agent overnight is not how it should acquire one.

---

## 5. THE KNOWN RESIDUAL — a null `partnership_id` silently loses the vendor breadcrumb

**REPORTED, NOT FIXED**, as instructed. It is now load-bearing for two more
emitters than it was this morning, which is the reason to restate it precisely.

### The mechanism

088's `"Vendors insert own company milestone events"` policy requires, among
other clauses (088:169-173):

```sql
partnership_id IS NOT NULL
AND EXISTS (SELECT 1 FROM public.partnerships p
            WHERE p.id            = milestone_events.partnership_id
              AND p.vendor_org_id = milestone_events.vendor_org_id
              AND p.lead_org_id   = milestone_events.org_id)
```

**`partnership_id IS NOT NULL` is not incidental.** The `EXISTS` is what pins
`org_id` — 088's own header calls it "the clause that matters most" and says
that without it a vendor could write a feed line onto an arbitrary agency's
dashboard with a payload they composed. **The null check cannot simply be
dropped: it is what makes the `EXISTS` reachable.**

### The collision

**Greg ruled that a vendor may bid without a partnership.** A vendor invited by
magic link or by email, who has never been added to the agency's pool, has no
`partnerships` row. For that vendor:

- `partner_rfp_inbox.partnership_id` is null,
- the fallback lookup against `partnerships` finds nothing,
- `partnershipId` goes to the emitter as null,
- the INSERT is refused by RLS,
- and **`recordMilestone()` catches everything and returns void** — so the route
  succeeds, the vendor sees no error, and **the breadcrumb is silently lost.**

### What it now costs

Before today it cost `bid.submit`, `bid.revise` and `status_update.post`. It now
also costs the two emitters added this session, **`rfp.view` and
`nda.acknowledge`** — which is worse than it sounds, because those two fire
EARLIEST in the vendor's journey, when a partnership is least likely to exist.
**The agency loses the breadcrumbs for exactly the vendors it knows least
about.**

### Why it is not fixed here

Every available fix is a policy change or a product change, and both are out of
scope for an emitter survey:

- **Relax the null check** — cannot be done alone. It is what makes the `EXISTS`
  reachable, and removing it opens the feed-injection hole 088 exists to close.
- **Auto-create a partnership on first contact** — a product decision with
  consequences well beyond the feed, since a `partnerships` row means a vendor
  is in the pool.
- **Let a vendor-side event carry a null partnership and pin `org_id` some other
  way** — a real design, and it is a migration.

**The ruling Greg owes:** *should a vendor with no partnership be able to write
a breadcrumb onto the agency's feed at all — and if so, what pins `org_id` in
place of the partnership row?*

---

## 6. EXECUTED / READ / REASONED

**EXECUTED.** Greps over `app/`, `lib/`, `components/`, `supabase/migrations/`
and `docs/` for every `recordMilestone` call site, every `eventType:`, every
`MILESTONE_PREDICATES` key, and both whitelist functions; `npx tsc --noEmit` and
`pnpm lint` after each of the three emitters. Every count in this document came
off one of those and can be re-run.

**READ in full.** `lib/milestone-events.ts`; the emitter template at
`app/api/partner/rfps/[id]/response/route.ts:493-528`; both target routes;
`docs/capabilities.md` section 5.

**READ in part.** `supabase/migrations/080_milestone_events.sql` (the table DDL,
`vendor_visible_event_types()`, the counterparty SELECT policy);
`supabase/migrations/088_vendor_milestone_events.sql` (the vendor INSERT policy
clause by clause, `vendor_emittable_event_types()`); `lib/activity-feed.ts`
(`MILESTONE_PREDICATES`, `UNION_REPLACING_EVENT_TYPES`, `mapMilestoneGroup`,
`milestoneDedupeKey`).

**REASONED, and therefore unverified against a live database.** That the three
new emitters actually insert a row — no statement was executed against any
database this session. Each was checked against the policy text clause by
clause, and each follows an emitter already live in the same file family, but
**the first real proof is the first real run.** In particular the residual in §5
means `rfp.view` and `nda.acknowledge` will insert nothing at all for a vendor
with no partnership, by design of 088 rather than by defect of the emitter.

**NOT DONE.** No migration applied, authored or edited. No policy widened. No
renderer written. None of the eighteen unrendered types implemented.
