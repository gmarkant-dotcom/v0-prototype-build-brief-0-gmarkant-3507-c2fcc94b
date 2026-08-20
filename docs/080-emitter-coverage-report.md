# 080 emitter coverage: what actually writes to `milestone_events`, and what reads it

Written 2026-08-20, after migration 080 was applied. Report only — no code was changed.

Short version: there are **7 call sites** covering **6 distinct event types**. The whitelist
names **23**. `bid.shortlist` is one of the 17 with no emitter — it did not fail, it was never
attempted. And **nothing in the product reads this table.** It is write-only today.

---

## 1. Every call site of the emitter

The emitter is `recordMilestone` / `recordMilestones` in `lib/milestone-events.ts:132` and
`lib/milestone-events.ts:147`. `recordMilestone` is a single-event wrapper that delegates to
`recordMilestones`, so there is exactly one insert path.

| # | File:line | `event_type` written | Guard it sits behind |
|---|-----------|----------------------|----------------------|
| 1 | `app/api/partnerships/route.ts:623` | `vendor.invite` | POST, inside the branch that revives a **terminated** partnership |
| 2 | `app/api/partnerships/route.ts:754` | `vendor.invite` | POST, the ordinary new-invitation path |
| 3 | `app/api/partnerships/route.ts:995` | `msa.confirm` | PATCH, the MSA-confirm branch |
| 4 | `app/api/agency/broadcast-rfp/route.ts:533` | `rfp.broadcast` | POST, unconditional after the inbox rows land — **`recordMilestones`, one row per recipient** |
| 5 | `app/api/agency/rfp-responses/[id]/route.ts:701` | `bid.feedback` | PATCH, inside `if (shouldSendAgencyFeedbackEmail)` |
| 6 | `app/api/agency/rfp-responses/[id]/route.ts:866` | `bid.award` | PATCH, inside `if (awardContext)` |
| 7 | `app/api/agency/rfp-responses/[id]/route.ts:963` | `bid.decline` | PATCH, inside `if (isDeclining)` |

Six distinct event types: `vendor.invite`, `msa.confirm`, `rfp.broadcast`, `bid.feedback`,
`bid.award`, `bid.decline`.

Call site 4 is the only one that can write more than one row per request, deliberately — vendor
visibility is keyed on `partnership_id`, so a broadcast to N recipients is N rows.

---

## 2. The whitelist, type by type

`public.vendor_visible_event_types()` in `supabase/migrations/080_milestone_events.sql` returns
**23** entries, not 22. It was 22 until the 2026-08-17 ruling added `msa.confirm`
(`docs/capabilities.md:298-299`, `docs/079-rename-execution-report.md:45`). If the applied
function returns 22, the version that ran was older than the file on disk — worth checking with
`SELECT unnest(public.vendor_visible_event_types());` and expecting `msa.confirm` in the output.

**Emitter exists today (6 of 23):**

| Event type | Where |
|---|---|
| `vendor.invite` | `app/api/partnerships/route.ts:623`, `:754` |
| `rfp.broadcast` | `app/api/agency/broadcast-rfp/route.ts:533` |
| `bid.award` | `app/api/agency/rfp-responses/[id]/route.ts:866` |
| `bid.decline` | `app/api/agency/rfp-responses/[id]/route.ts:963` |
| `bid.feedback` | `app/api/agency/rfp-responses/[id]/route.ts:701` |
| `msa.confirm` | `app/api/partnerships/route.ts:995` |

**Aspirational — no emitter (17 of 23):**

*Agency side (10). The acting route exists in every one of these cases; it simply does not call
the emitter.*

| Event type | The route that would emit it | Status |
|---|---|---|
| `vendor.invite_resend` | `app/api/agency/pool/resend-invitation/route.ts` | Route exists, no emit. Named as the intended site in the comment at `app/api/partnerships/route.ts:618-622`. |
| `rfp.magic_link_send` | magic-token issue path | No emit |
| `rfp.deadline_set` | deadline write path | No emit |
| `rfp.deadline_change` | same | No emit. 080's header calls this out specifically as destructive today — the overwrite discards the old deadline and nothing records who changed it. |
| `bid.shortlist` | `app/api/agency/rfp-responses/[id]/route.ts` PATCH | No emit — see section 3 |
| `bid.meeting_request` | same PATCH | No emit, same shape as shortlist |
| `onboarding.package_send` | `app/api/partner/onboarding-packages/` | No emit |
| `onboarding.deploy` | onboarding deploy path | No emit |
| `status_update.resolve` | status update path | No emit |
| `payment.mark_paid` | payments path | No emit |

*Vendor side (7). These are aspirational for a second, harder reason: migration 080 ships **no
vendor-side INSERT policy at all**. The only INSERT policy requires `actor_side = 'agency'`.
Even if a vendor-side emitter were written today it would be rejected by RLS. The migration says
this is intentional — the vendor INSERT policy ships in the same commit as the first vendor-side
emitter, and it has to permit the guest path's NULL `actor_id` without letting an authenticated
caller write someone else's name.*

`bid.submit`, `bid.revise`, `rfp.view`, `invitation.accept`, `invitation.decline`,
`nda.acknowledge`, `status_update.post`.

Three of those (`bid.submit`, `rfp.view`, `nda.acknowledge`) arrive through
`app/api/rfp/guest/[token]/route.ts`, where there is no authenticated user — which is why
`actor_id` is nullable.

---

## 3. Why shortlist emitted nothing

**There is no call site.** Not a swallowed error, not a condition that evaluated false at the
last moment, not a dropped event. The code path never reaches the emitter, so there was nothing
to log — which is exactly consistent with what you saw: total silence, no `[milestone]` line of
any kind.

The PATCH in `app/api/agency/rfp-responses/[id]/route.ts` handles six statuses
(`ALLOWED_STATUS`, line 39) but emits in only three branches:

- `if (shouldSendAgencyFeedbackEmail)` → line 625, emits at 701
- `if (awardContext)` → emits at 866
- `if (isDeclining)` → emits at 963

Shortlisting takes none of those. Its entire handling is two lines at 156-157:

```ts
if (existing.status !== "shortlisted" && nextStatus === "shortlisted") {
  patch.shortlisted_at = patch.updated_at
}
```

It stamps `shortlisted_at`, writes the patch, syncs the inbox row, and returns. `meeting_requested`
(159-161) has exactly the same shape and the same gap.

Contrast with award, which you saw emit: `bid.award` logged `[milestone] insert failed` with
`PGRST205` precisely *because* it has a call site and got as far as the insert. Shortlist never
got that far.

**Related, same root cause:** `bid.shortlist` is declared in `CAPABILITY_MINIMUM_ROLE`
(`lib/capabilities.ts:140`) but never checked. There are only 5 `can(profile, ...)` calls in the
whole of `app/`, three of them in this file — `bid.award`, `bid.decline`, `bid.feedback`, the
same three that emit. The route gates and instruments exactly the three transitions that send
mail, and nothing else. Shortlist is unmetered on both axes.

---

## 4. Does anything read it? No.

**`milestone_events` is write-only today.** I grepped the full repository (`*.ts`, `*.tsx`,
`*.sql`, `*.md`, excluding `node_modules`) for `milestone_events` and
`vendor_visible_event_types`. In application source there are exactly **six** hits and every one
is a comment — the five `079 PARAMETER CLASS` notes at the call sites and one line at
`app/api/partnerships/route.ts:991`. There is not a single `.from("milestone_events")` outside
`lib/milestone-events.ts:161`, which is the INSERT.

Every other hit is in `docs/` or in migration 080 itself.

So the two SELECT policies applied by 080 — "Members read own company milestone events" and
"Counterparty reads whitelisted milestone events" — currently guard a table that no query in the
product ever reaches. The whitelist protects a read path that does not exist yet.

This is consistent with the run that authored it:
`docs/safety-net-and-attribution-report.md:727` records that the dashboard feed was deliberately
**not** changed to read `milestone_events`, and `:506` calls rendering it "a later decision".
The dashboard's Recent Activity is still the derived four-column union in
`app/api/agency/dashboard/route.ts:370-418`, computed per request and never persisted — the
thing 080 was written to replace, still in place and still unaware the table exists.

---

## What this adds up to

The table is real, correct and empty of purpose. Six of 23 event types write to it; nothing
reads any of them. The first thing that would make it worth having is a reader — until then the
policies, the whitelist, the indexes and the FKs are all guarding an inert log.

Two cheap follow-ups, if wanted, in the order that yields the most:

1. **A reader.** Without it none of the above is visible to a user, and the six emitters that do
   work are indistinguishable from the seventeen that do not.
2. **The shortlist and meeting-request emits**, in the PATCH that already has three. They are the
   two agency-side gaps in a route that is otherwise fully instrumented, and both branches
   already exist at lines 156-161 — they need the emit, not new plumbing.
