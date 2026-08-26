# 095: the notification `type` CHECK. A ruling Greg owes, not a migration.

**Status: AWAITING RULING. No SQL authored. No migration numbered 095 exists.**

This document exists because 093 sat parked after four rounds of work that preceded the
decision they depended on. The decision comes first this time.

---

## The decision, in one sentence

**Does `notifications_type_check` widen from eight permitted values to the eleven that
`lib/notifications.ts` declares, or do the three unpermitted types and the six write sites
that emit them come out of the code instead?**

Everything below is evidence for that one question. Nothing below is a recommendation to
apply anything.

---

## 1. The facts

`lib/notifications.ts:249-260` declares **eleven** `NotificationType` values.

The live `notifications_type_check` permits **eight**: `partnership_invitation`,
`partnership_accepted`, `project_assignment`, `project_accepted`, `project_declined`,
`new_message`, `document_uploaded`, `project_awarded`.

The **three missing** are `partnership_declined`, `onboarding_deployed`, `bid_submitted`.

Source for the eight and for the live row counts: `docs/refusals-and-notifications-report.md`
section 5b, which recorded them from the first real run of `docs/094-preapply-test.sql` on
2026-08-25. That run failed on `23514 notifications_type_check` when it tried to insert
`'bid_submitted'`. The constraint was not read from the database in this session, and this
session sought no database access.

**The table holds 15 rows across three types**: `partnership_accepted` 7, `project_awarded` 4,
`project_assignment` 4. Five of the eight permitted types have never produced a row.

**Six of the sixteen write sites emit a type the constraint refuses.** Every one raises 23514,
writes nothing, and is swallowed by `createOrgNotification()`, which logs
`[notifications] org notification insert failed for every recipient` at
`lib/notifications.ts:244` and returns `false`. No caller checks the return value. The failure
is invisible at every layer above the log line.

### The sixteen write sites

| # | Site | Type | Constraint |
|---|------|------|-----------|
| 1 | `app/api/partnerships/route.ts:584` | `partnership_invitation` | permitted |
| 2 | `app/api/partnerships/route.ts:716` | `partnership_invitation` | permitted |
| 3 | `app/api/partnerships/route.ts:1046` | `partnership_accepted` | permitted |
| 4 | `lib/award-partnership-resolution.ts:103` | `partnership_accepted` | permitted |
| 5 | `lib/award-partnership-resolution.ts:169` | `partnership_accepted` | permitted |
| **6** | `app/api/partnerships/route.ts:1200` | **`partnership_declined`** | **REFUSED** |
| 7 | `app/api/projects/[id]/assignments/route.ts:205` | `project_assignment` | permitted |
| 8 | `app/api/projects/[id]/assignments/route.ts:341` | `project_accepted` / `project_declined` | permitted |
| **9** | `app/api/partner/rfps/[id]/response/route.ts:429` | **`bid_submitted`** | **REFUSED** |
| **10** | `app/api/rfp/guest/[token]/route.ts:583` | **`bid_submitted`** | **REFUSED** |
| **11** | `app/api/rfp/guest/[token]/route.ts:768` | **`bid_submitted`** | **REFUSED** |
| 12 | `app/api/projects/[id]/assignments/route.ts:437` | `project_awarded` | permitted |
| 13 | `app/api/agency/rfp-responses/[id]/route.ts:1084` | `project_awarded` | permitted |
| **14** | `app/api/projects/[id]/onboarding-packages/route.ts:449` | **`onboarding_deployed`** | **REFUSED** |
| **15** | `app/api/projects/[id]/onboarding/deploy/route.ts:176` | **`onboarding_deployed`** | **REFUSED** |
| 16 | `lib/magic-token-attach.ts:413` | `project_assignment` | permitted |

`new_message` and `document_uploaded` are permitted by the constraint and declared in the
type, and **have no write site at all**. Whichever way this is ruled, those two are dead
declarations.

---

## 2. The most consequential one is `bid_submitted`

**An agency has never been told in-app that a bid landed.** Three of the six refused sites are
`bid_submitted`, and they are the only three.

Greg's record has E2 (Aug 7) marked CONFIRMED LIVE for fixing "both submission paths, email +
in-app". The email half worked. The in-app half has been raising 23514 since. It was marked
confirmed because the email arrived, and the email arriving is what was checked.

**Two failures masked each other.** The in-app write was failing, and there was no bell in
either portal to notice with until `components/notification-bell.tsx` shipped. A surface that
nothing renders cannot report that nothing reaches it. That is the same shape as the
`.glass` panel and the `help-term.tsx` comment: the check that would have caught it was the
one nobody could run.

This is stated from Greg's record, not verified here. Neither "E2" nor "both submission paths"
appears anywhere in `docs/` or `LIGAMENT_CONTEXT.md` in this repository.

---

## 3. Widening is necessary but NOT sufficient, and this is the part most likely to surprise

The constraint is not the only thing refusing these rows. **RLS is the second wall**, and for
one of the six it is the taller one.

The live INSERT policy, after 094 (applied and verified, policy count 117):

```
"Scoped insert notifications"  WITH CHECK (
    user_id = auth.uid()
    OR user_id IN (SELECT public.current_user_org_member_user_ids())
    OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
)
```

The third arm is **active** counterparties only. So a site whose recipients are in the other
organization writes only where an **active** partnership links the two.

Note that the RLS caveat written at `lib/notifications.ts:171-179` describes the **pre-094**
predicate and is now stale by one arm. It should be refreshed whichever way this is ruled.

### Which of the six would actually start writing on the day the constraint widens

| # | Type | Client | On the day it widens |
|---|------|--------|----------------------|
| **6** | `partnership_declined` | session | **STILL SILENT.** The decliner is in the vendor org; recipients are the lead org. Own-org arm fails. Counterparty arm fails because a partnership being declined is not active. Widening the constraint does nothing for this one. |
| **9** | `bid_submitted` | session | **CONDITIONAL.** Writes only where an active partnership already links the bidding vendor org to `inbox.lead_org_id`. A vendor who arrived by magic link without one stays silent. |
| **10** | `bid_submitted` | **service role** | **WRITES, unconditionally.** RLS bypassed. |
| **11** | `bid_submitted` | **service role** | **WRITES, unconditionally.** RLS bypassed. |
| **14** | `onboarding_deployed` | session | **WRITES** where the partnership is active, which it is by the time onboarding materials are sent. |
| **15** | `onboarding_deployed` | session | **WRITES** where the partnership is active. |

**So the honest answer to "what appears in the bell on day one" is: guest-token bid
submissions, both onboarding paths, and partner-portal bids from vendors with an active
partnership. Declines do not appear, and fixing that is a separate RLS ruling, not this one.**

Anyone who widens the constraint expecting all six to light up will conclude the widening
half-failed. It will not have.

---

## 4. What each choice costs

### Widening

- **One migration.** Two statements: drop the constraint, add it back with eleven values.
- **No backfill.** No existing row can violate the wider constraint; a widening is
  monotonic. The 15 live rows validate trivially and instantly.
- **No code change.** All eleven types are already declared and already emitted.
- **No new surface.** `components/notification-bell.tsx:84-96` already labels all eleven, and
  `unknownTypeLabel()` already covers anything it does not.
- **Cost:** four write sites begin producing rows a person will read, on a surface that has
  been carrying three event types and starts carrying six. Volume on `bid_submitted` is
  whatever the real bid rate is, and that has never been observed in this table.

### Not widening

- **Three declared types come out of `NotificationType`** at `lib/notifications.ts:249-260`.
- **Six write sites come out**, including all three `bid_submitted` callers, which means
  deciding that an agency is told about a bid by email only, permanently.
- **`notifyPartnershipDeclined()` and `notifyBidSubmitted()` are deleted outright**; they have
  no other caller.
- **The two `onboarding_deployed` blocks come out** of the onboarding deploy and
  onboarding-packages routes.
- **Cost:** it is a larger diff than the widening, across five files and two portals, and it
  removes a notification an agency arguably needs more than any other in the set.

There is no third option where the code stays as it is and the constraint stays as it is. That
is the status quo, and the status quo is six write sites failing silently in production.

---

## 5. The exact CHECK a widening would need

Ready to lift into a migration. **This is not a migration and must not be applied from here.**
Whoever writes 095 owns the transaction control, the down file, the pre-apply test and the
verification block, per the house pattern in 094.

```sql
ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'partnership_invitation',
    'partnership_accepted',
    'partnership_declined',
    'project_assignment',
    'project_accepted',
    'project_declined',
    'new_message',
    'document_uploaded',
    'project_awarded',
    'onboarding_deployed',
    'bid_submitted'
  ));
```

Eleven values, in the order they are declared in `lib/notifications.ts:249-260`. The eight
already permitted are unchanged and in the same relative order; the three added are
`partnership_declined`, `onboarding_deployed`, `bid_submitted`.

Two notes for whoever writes it:

1. **Confirm the constraint's live name first.** `notifications_type_check` is the PostgreSQL
   default for a column CHECK on `type` and is the name reported by the 23514 in the
   `094-preapply-test` run, but no `CREATE TABLE public.notifications` exists anywhere in this
   repository, so the name has not been read from the catalogue in this session.
2. **`DROP` then `ADD` is not the only shape.** `ADD CONSTRAINT ... NOT VALID` followed by
   `VALIDATE CONSTRAINT` avoids a full-table lock, which at 15 rows is not worth the extra
   statement. Stated only so the choice is deliberate.

---

## 6. What this document did not do

- Did **not** author `supabase/migrations/095_*.sql`.
- Did **not** author a pre-apply test.
- Did **not** apply anything or seek database access.
- Did **not** modify any migration, at any number.
- Did **not** touch `lib/notifications.ts`, the bell, or any write site.
