# Relationship end: run report

Branch `feat/relationship-end`, cut from `main` at `6a0a982`. Five commits, one per phase.
**Not pushed. No migration authored. No SQL run. No credentials used.**

**Merge status is not asserted here.** Check it with, for each sha below:
`git merge-base --is-ancestor <sha> main` (exit 0 means on main).
Commits: `abc8db2` (phase 0), `062c724` (1), `923abbc` (2), `90e065f` (3), `3bcbc29` (4).

---

## THE THREE THINGS TO READ FIRST

### 1. A vendor can already write `status` on their own partnership, today, from the browser. The route stops them. The database does not.

`PATCH /api/partnerships` denied a vendor only by FALL-THROUGH (an active row skipped both
branches and returned "Invalid operation"); Phase 1 makes that an explicit 403. **But the table's
UPDATE policy lets the vendor skip the route entirely.** `079_organizations.sql:1491`,
"Partners can update partnership status": `USING` and `WITH CHECK` both only
`vendor_org_id IN (SELECT public.current_user_org_ids())`. No column list, no status predicate.
The one trigger on the table (`partnerships_guard_identity_columns`, 087) pins `lead_org_id` and
`vendor_org_id` and says nothing about `status`. So a signed-in vendor with the browser client can
write `terminated`, `suspended` or `active` onto their own row, and also `nda_confirmed_at`,
`msa_confirmed_at`, `accepted_at` and `partnership_notes`. `app/partner/projects/page.tsx:366` is
first-party proof the policy is in deliberate use for `payment_terms_requests`.

**What it means for what shipped:** a vendor you suspend can lift their own suspension, and a
vendor can end a relationship the agency wants. **This cannot be fixed in application code**, the
attacker bypasses the application. The fix is a migration (BEFORE UPDATE trigger guarding
`status` and the NDA/MSA/`accepted_at` columns for the non-lead side, or a narrowed policy), which
this run is forbidden to author. I did not put it in its own first commit because there was
nothing safe to commit: the route half is in `062c724`, the database half is the first item under
"What the migration session still owes". Read from migration files, not the live catalog; query P1
below confirms it.

### 2. The brief's "stops new requests" and Greg's accepted terminate email are not fully true yet, and I reworded one sentence.

Only the **vendor-pool broadcast** checks the partnership (`broadcast-rfp/route.ts:222`, requires
`active`). An RFP sent to a **typed email address** (`:375`, falls through to a null
`partnership_id` and lands in the vendor's inbox by `vendor_org_id`) and a **Lightning/magic-link**
RFP read no partnership status at all. Greg's accepted sentence "You will not receive new requests
from them" overclaims for a suspended or terminated vendor. I wrote "They will not be able to
choose you for new requests from their vendor pool" instead, in both the dialog copy and the
email, because the brief's own rule is that every string describes only what the code does today.
**To restore Greg's sentence, close those two paths first.** The exact line is in
`lib/relationship-notifications.ts`, `relationshipEmailCopy`.

### 3. The award resolver silently reinstated suspended and terminated vendors, and announced it as an acceptance.

`lib/award-partnership-resolution.ts` branch c and the d-recheck wrote `status: "active"` onto ANY
row matching the vendor, then called `notifyPartnershipAccepted`. Awarding a bid from a paused or
ended vendor would have undone the suspension and told the agency "partnership accepted". That is
the exact silent fall-through the brief warned about, and it would have made suspend non-durable
and reinstatement double-notify. Fixed narrowly in `923abbc`: a `suspended`/`terminated` row is
left alone, nothing is notified, and the award proceeds against the row as it is. **A decision this
leaves for Greg:** should an award to such a vendor be allowed at all? See "Owed".

---

## What I EXECUTED versus what I READ

| | |
|---|---|
| **EXECUTED** | `tsc`, `eslint`, `pnpm build`, the three code guards and `policy-audit:guard`, at baseline and after every commit, each as its own unpiped command with `echo $?` next. `grep` sweeps over `app lib components` |
| **NOT EXECUTED** | `verify-rls` (needs credentials, forbidden; the known value is 2). **No route was called. No email was sent. No page was opened in a browser. No SQL was run.** Every behavioural claim below is from reading code |

Baseline versus after phase 4. The lint **triple is identical at every commit: 182 / 154 / 28**
(`0 errors and 7 warnings potentially fixable`).

| Gate | Baseline | After 1 | After 2 | After 3 | After 4 |
|---|---|---|---|---|---|
| tsc | 0 | 0 | 0 | 0 | 0 |
| lint | 1 (182/154/28) | 1 (182/154/28) | 1 (182/154/28) | 1 (182/154/28) | 1 (182/154/28) |
| identity-columns:guard | 0 | 0 | 0 | 0 | 0 |
| org-id-reads:guard | 0 | 0 | 0 | 0 | 0 |
| embed-targets | 0 | 0 | 0 | 0 | 0 |
| policy-audit:guard | 1 | 1 | 1 | 1 | 1 |
| pnpm build | 0 | not run | not run | not run | 0 |
| verify-rls | not run | | | | |

`pnpm build` ran at baseline and at the end, not after each intermediate commit.

---

## 0d. The finding, as the brief asked for it

See "Read first" item 1 for the database half. **The route half, exactly:** the validation list at
`app/api/partnerships/route.ts:1056` admits `suspended` and `terminated`. What stopped a vendor
was only this shape:

```ts
if (isPartner && partnership.status === 'pending') { ... }   // accept / decline only
if (isAgency) { ... .update({ status, ... }) ... }           // the only arbitrary status write
return NextResponse.json({ error: 'Invalid operation' }, { status: 400 })
```

`isAgency = callerOwnsOrg(callerOrgIds, partnership.lead_org_id)`. A vendor on an active row has
`isAgency` false, so both branches are skipped. Correct, but by accident. `062c724` adds the
explicit check (`!isAgency && partnership.status !== 'pending'` returns 403) and, for the three
new acts, a second proof that the caller's ACTING organization (`resolveCallerWriteOrgId`) is the
row's lead organization.

**Premise 0e was half wrong.** Nothing writes `suspended`/`terminated` from the agency side
(confirmed). But the route did NOT need zero changes: no idempotency, no prior-status guard
(`pending -> active` skipped vendor acceptance, `removed -> suspended` was accepted), ownership by
membership set rather than the acting organization, no mail.

---

## Phase by phase

### Phase 0, `abc8db2` - `docs/relationship-end-phase0.md`
Baseline, the 0c table, 0d, 0e, 0f. Docs only.

### Phase 1, `062c724` - the two agency actions

**Files:** `app/api/partnerships/route.ts`, `app/agency/pool/page.tsx`,
`lib/relationship-transitions.ts` (new), `lib/relationship-copy.ts` (new).

- **Surface.** The Active vendors card action group on `/agency/pool`, where an agency already
  manages a vendor. No new surface. Active row: **Suspend**, **Terminate**. Suspended row:
  **Reinstate**, **Terminate**. Terminated row with `acceptedAt`: **Reinstate**.
- **Where ownership lives (1b).** `route.ts`, the agency branch: `resolveCallerWriteOrgId(user.id,
  supabase) === partnership.lead_org_id` or 403. The UPDATE is then scoped `.eq('lead_org_id',
  writeOrgId).eq('status', prior)`, so the database re-checks in the same statement. A vendor is
  refused by the new explicit 403 BEFORE any branch. **Both are route-level; see item 1 for why
  that is not enough.**
- **Idempotent (1c).** Suspending a suspended row or terminating a terminated row returns 200
  `{ unchanged: true }`, writes nothing and sends nothing. A concurrent double submit: the second
  UPDATE matches no row (`.eq('status', prior)`), re-reads, and returns `unchanged` if the target
  state was reached, else 409. Email is sent only from the request whose UPDATE matched.
- **Transitions** (`lib/relationship-transitions.ts`): suspend from `active` only; terminate from
  `active` or `suspended` (suspend-now-terminate-later, ruling 5); reinstate from `suspended`,
  and from `terminated` only if the row was ever live (`accepted_at` set, or at least one
  `project_assignments` row). The reason: a **vendor's own decline of an invitation also writes
  `terminated`**, and status alone cannot tell the two apart. Without this a Reinstate button on a
  declined invitation would activate a relationship the vendor refused.
- **Reinstate writes** `status = 'active'` and `updated_at`. **It sends nothing** and does not
  touch `accepted_at`, `invitation_sent_at` or any notification path, so the partnership-accepted
  path is not fired (1e).

**Exact confirmation copy (1d).** Quoted from `lib/relationship-copy.ts`. Neither says access is
revoked or documents are withdrawn. Each sentence is pinned in that file to the code that makes it
true. Two sentences go beyond the brief's wording because the code requires it (the "while not
active" line; see "Brief corrections" below).

> **Suspend {name}?**
> Suspending pauses your partnership with {name}. You will not be able to choose them when you send an RFP from your vendor pool.
> Everything already in progress carries on. They keep access to current work, documents and payments.
> While the partnership is not active, their full profile, your notes on them and their delivery history are not available to you, and they see only your public profile.
> You can reinstate them at any time. They will be told by email that the partnership is paused.
> [Cancel] [Suspend]

> **Terminate {name}?**
> Terminating ends your partnership with {name}. You will not be able to choose them when you send an RFP from your vendor pool.
> Work already awarded to them continues. They keep their record of past work and what they are owed.
> While the partnership is not active, their full profile, your notes on them and their delivery history are not available to you, and they see only your public profile.
> You can reinstate the partnership later. They will be told by email that you have ended it.
> [Cancel] [Terminate]

> **Reinstate {name}?**
> This sets your partnership with {name} back to active, and you will be able to choose them when you send an RFP again.
> Nothing about their work, documents or payments changes. They are not sent a new invitation and no email or notification goes out.
> [Cancel] [Reinstate]

**1f. What a vendor sees today for an unanswered request when the partnership is suspended or
terminated (READ, not run):** nothing changes. `app/api/partner/rfps/route.ts` lists inbox rows by
`vendor_org_id` with no partnership predicate, and the response route reads the partnership only to
attach a milestone. The request stays in their queue, they can open it and submit a bid, and the
agency receives it. **Nothing is auto-closed.** The question is owed, below.

### Phase 2, `923abbc` - what surfaces say when a partnership is not active

**Files:** `app/agency/pool/page.tsx`, `app/api/agency/pool/[partnerId]/route.ts`,
`app/api/partner/projects/route.ts`, `app/partner/projects/page.tsx`,
`app/partner/network/page.tsx`, `app/partner/payments/page.tsx`, `lib/award-partnership-resolution.ts`,
`lib/relationship-copy.ts`.

- **The payments pattern, reused not duplicated.** `relationshipTag` and `relationshipNotice` moved
  from `app/partner/payments/page.tsx` into `lib/relationship-copy.ts`; payments now imports them.
  The notice sentence was reworded (see item 2): it said "you will not be sent new RFPs", which
  overclaims. It is the same tag on the vendor projects list (per card and per group), the project
  slide-over, and the network detail.
- **Nothing filtered (2c).** `/api/partner/projects` gained a descriptive `relationship_status` and
  still returns every project.
- **Agency side.** Suspended/terminated cards: amber/red border and pill, and the sub-line no
  longer says "Active since". The profile refusal copy no longer says "when they accept your
  invitation" for a row that was accepted long ago; it says "when the partnership is reinstated".
- **2d, the pool destination.** Suspended and terminated rows stay in the "Active vendors" column
  (no new grouping invented), visibly tagged, and the column description now says how many are
  suspended or terminated and that they cannot be sent RFPs from the pool. The tile still counts
  `active` only, so tile and column are no longer silently equal; the column text is what
  explains the gap. **The destination question is owed.**
- **The award resolver** (item 3).

**Deliberately NOT changed, each a row in the 0c table:** the notes route (`eq active`), the
performance route (`eq active`), the vendor's agency-profile engagement history
(`hasActivePartnership`), the MSA page filter, the vendor profile's partnership-context list. They
are existing active-only gates; widening them is outside the brief and the dialog copy discloses
the agency-side ones. The vendor still sees all their awarded work on `/partner/projects`.

### Phase 3, `90e065f` - the two notifications

**Files:** `lib/relationship-notifications.ts` (new), `app/api/partnerships/route.ts`.

- **Email only, by design (3a).** `NotificationType` and `notifications_type_check` (095, widened
  again by 099) permit 13 values. None carries these acts honestly: `partnership_declined` means a
  vendor declined an invitation. In-app needs **`partnership_suspended` and
  `partnership_terminated`** added to the CHECK, the TS union, `lib/notification-routing.ts` and
  the bell. Not authored. No in-app write is attempted, so the 23514 trap (a declared type missing
  from the CHECK, caught and logged while the handler returns 200) is not entered.
- **Two messages that read differently.** Terminate is Greg's accepted shape (what happened, what
  did not change, where to go), second sentence reworded per item 2. Suspend is the same register
  and says it is a pause, not an ending, without promising when or whether it lifts:

> **Subject:** Your partnership with {Agency} is paused
> {Agency} has paused their vendor partnership with you on Ligament. They will not be able to choose you for new requests from their vendor pool while it is paused.
> Work already awarded to you continues as normal, and you can still see your current work, documents and payments in your account.
> This is a pause, not an ending. If you have questions, speak with your contact at {Agency} directly.

> **Subject:** Your partnership with {Agency} has ended
> {Agency} has ended their vendor partnership with you on Ligament. They will not be able to choose you for new requests from their vendor pool.
> Work already awarded to you continues as normal, and your record of past work and payments stays in your account.
> If you have questions, speak with your contact at {Agency} directly.

- **Preference toggle (3b) respected.** Recipients come from `resolveOrgNotificationRecipients`,
  which skips `notification_preferences.email === false`. Fallback to `partnerships.partner_email`
  only when the organization resolves nobody (an agency reading a vendor org's members gets zero
  rows by policy), with a log line that the opt-out could not be checked: lib/email.ts:370-372's
  standing ruling, and the rfp-closure route's precedent.
- **Ordering.** Recipients are resolved BEFORE the status write, because 085 removes a terminated
  relationship from the counterparty set and a lookup after the write can return nothing. Same
  trap the decline path documents.
- **Reinstatement sends neither (3c).** It resolves no audience and calls nothing.
- **A related RLS fact for the migration session:** the notifications INSERT policy admits an
  agency writing to a vendor only while the partnership is an admitted counterparty. A terminated
  vendor is not, so an in-app row written after the flip would be refused by RLS even once the
  types exist. Write it before the status change, or widen deliberately.

### Phase 4, `3bcbc29` - the emitter rulings

**Files:** `app/api/agency/bids/compare/route.ts`, `app/api/agency/pool/[partnerId]/notes/route.ts`,
`lib/capabilities.ts`, `lib/activity-feed.ts`, `app/api/agency/bids/[responseId]/decompose/route.ts`
(a comment), `docs/capabilities.md`, `docs/emitter-rulings-owed.md`.

- **4a `bid.compare`.** One row per run that produced a comparison (a cache hit records nothing,
  matching `bid.analyze`). Payload is `{ scope_item_name }` and nothing else, enforced by an
  annotated object so a second key is a compile error. `vendorOrgId`, `partnershipId` and
  `subjectId` are null: a set has no single subject, and any one member would be arbitrary. Agency
  feed only. The "must not emit" header comment is rewritten.
- **4b `vendor.unblacklist`.** Own wording, `lifted the blacklist on {vendor}`. Named boolean
  `isLifting = wasBlacklisted && !nowBlacklisted`, computed from `prev` before the write, so the
  flag sent on every notes save records nothing. Agency feed only.
- **4c `rfp.regenerate`: NO.** Recorded in `docs/emitter-rulings-owed.md`. A client-supplied value
  must not decide an event type.
- **Names are new and permanent** (`bid.compare`, `vendor.unblacklist`). The ruling did not name
  `vendor.unblacklist`; I chose it. Rename before merge if you prefer another.
- **A limit worth knowing:** the notes route requires an `active` partnership, so a suspended
  vendor's blacklist cannot be lifted from the UI. That is a Phase 2 row, not a regression.

---

## Independently mergeable, and what to revert

| Phase | Mergeable alone? | Revert | If it is wrong, you lose |
|---|---|---|---|
| 0 `abc8db2` | Yes, docs | `git revert abc8db2` | the 0c table |
| 1 `062c724` | Yes | revert 3 and 2 first (see below) | the two controls and the route checks |
| 2 `923abbc` | Needs 1 (it appends to `lib/relationship-copy.ts`, which 1 creates) | `git revert 923abbc` | the tags and the award fix. **Reverting only the award fix recreates item 3** |
| 3 `90e065f` | Needs 1 (edits 1's route block) | `git revert 90e065f` first | the vendor emails; the status write still works |
| 4 `3bcbc29` | **Yes, fully independent** | `git revert 3bcbc29` | the two feed lines |

Revert order if all must go: 4 (any time), then 3, then 2, then 1.

**Highest risk of being wrong:** Phase 2's award change. It alters `lib/award-partnership-resolution.ts`,
a path every award goes through. It only changes behaviour when the matched row is `suspended` or
`terminated`. One side effect: an award to a vendor who **declined an invitation** (also
`terminated`) used to flip that row to `active` and now leaves it terminated, with the award
proceeding. Second: the pool card change reads `p.status` and can only differ for those two values.

---

## THE 0c TABLE AS BUILT

"After" is what the site does now. Row numbers match `docs/relationship-end-phase0.md`.

| # | Site | After this run |
|---|---|---|
| 1-2 | `GET /api/partnerships` | unchanged; returns both statuses to both sides |
| 3 | POST re-invite of `terminated` | unchanged; sets `pending` and nulls `accepted_at`. **Another route back from terminated, and it requires the vendor to accept again** |
| 5 | `PATCH` agency branch | the three acts go through `relationshipActFor`/`checkRelationshipTransition`, ownership by acting org, idempotent, mail. Other statuses (`removed`, and the legacy agency `active` on a `pending` row) still take the old generic write, unchanged |
| 6 | broadcast pool recipients | unchanged, refuses non-active. The dialog copy says exactly "from your vendor pool" |
| 7-8 | typed email, magic link | **UNCHANGED, still deliver to a suspended/terminated vendor.** Owed |
| 9 | award resolver | `suspended`/`terminated` rows left alone, no accepted notification |
| 12-13 | notes, performance | unchanged, 404 for non-active; disclosed in the dialog |
| 15 | agency-side profile refusal copy | fixed for suspended/terminated |
| 16 | vendor's agency-profile engagement history | unchanged, hidden for non-active. Awarded work remains on `/partner/projects` |
| 17-18 | payments, projects | payments unchanged in behaviour; projects now tagged |
| 19-22 | `partnership-state`, pool card, tile, dashboards | pool card tagged, tile unchanged, column text explains the gap |
| 23 | agency MSA page | unchanged, ended vendors absent with no note |
| 24 | vendor network | badge existed; detail now carries the notice |
| 26 | vendor profile partnership context | unchanged, lists active only |
| 27-28 | RLS helpers | unchanged; migration session |

---

## WHAT THE MIGRATION SESSION STILL OWES

In priority order. **That section is this run's handoff.**

1. **Guard `partnerships` writes from the vendor side (item 1).** A BEFORE UPDATE trigger, or a
   narrowed "Partners can update partnership status" policy, so the vendor side can change only
   what it legitimately does: accept/decline while `pending`, and `payment_terms_requests`. It must
   refuse `status`, `nda_confirmed_at`, `msa_confirmed_at`, `accepted_at` and `partnership_notes`
   from the non-lead side once the row is not `pending`. Check `app/partner/projects/page.tsx:366`
   and the auth/claim paths (`vendor_org_id`) still work. **Without this, suspend and terminate
   are advisory against a vendor who knows PostgREST.**
2. **Document revocation, partnership-scoped, at TERMINATION ONLY, not at suspension** (ruling 5),
   and ruling 6: a vendor's own bids, invoices and status updates are never revoked. The policies
   in `relationship-end-rulings.md` section 1 (1a, 1b, 1e, 1f, 1g, 1h) have no status predicate;
   085's `IS DISTINCT FROM` spelling is the precedent. **None of it is built, and every string I
   wrote says so by saying nothing about revocation.** When it lands, rewrite
   `lib/relationship-copy.ts` and the two emails in the same change; the copy is pinned there to
   the code that makes each claim true.
3. **Notification types.** Add `partnership_suspended` and `partnership_terminated` to
   `notifications_type_check`, the `NotificationType` union, `lib/notification-routing.ts` and the
   bell, in one change (the union and the CHECK must agree or it fails silently with a 200). Mind
   the INSERT policy ordering noted under Phase 3.
4. **Milestone event types for the two acts.** `vendor.suspend` / `vendor.terminate` do not exist;
   none was emitted. `vendor.remove` is wrong for them. Needs names, capability rows and feed
   copy, agency feed only.
5. **The `suspended` split in the RLS helpers** (1i of the rulings doc): `suspended` keeps profile
   access under 085/096 but the older `current_user_active_counterparty_user_ids()` requires
   `active`. Settle deliberately.
6. **Confirm the live state** with the queries below before trusting any of the above.

---

## Owed to Greg (product questions, not built)

1. **In-flight RFP requests (1f).** A suspended/terminated vendor keeps an unanswered request and
   can still bid. Should it leave their queue when the agency acts, as RFP closure does?
2. **Typed-email and Lightning RFPs to a suspended/terminated vendor.** Block, warn, or allow?
   Until answered, "stops new requests" is true for the pool only.
3. **The pool destination (2d).** Suspended/terminated vendors sit under "Active vendors", tagged.
   A separate "Paused and ended" grouping is the likely answer and needs your ruling on the name
   and whether declined invitations belong in it.
4. **Awarding a bid from a suspended or terminated vendor.** Allowed today (the award now proceeds
   without reactivating). Should it be blocked?
5. **A vendor-declined invitation reads `terminated`** and sits in Active vendors as "Terminated".
   Should it be distinguished, given `status` cannot tell it from an agency termination?
6. **`removed` on an active vendor** is still accepted by the API and still tells nobody.
7. **Agency `active` on a `pending` row** still skips vendor acceptance via the API. Pre-existing,
   not touched, flagged.
8. **The name `vendor.unblacklist`.**

---

## What I could not establish

- Whether any of this renders correctly. Nothing was opened in a browser.
- Whether the live `partnerships` UPDATE policy and trigger match the migration files (P1).
- Whether the live column carries the CHECK at all (P2), and whether any row is already
  `suspended`/`terminated` (P3).
- Whether Resend delivers either email. No send was exercised.
- Whether a vendor's `profiles` row is readable to the agency at send time on a real production
  vendor organization; the partner_email fallback exists because it often is not.

### Queries to run (none were run)

```sql
-- P1. The vendor UPDATE door, live.
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partnerships' ORDER BY cmd, policyname;
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid = 'public.partnerships'::regclass AND NOT tgisinternal;

-- P2. Is status constrained, and to what?
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.partnerships'::regclass AND contype = 'c';

-- P3. What exists already?
SELECT status, count(*), count(*) FILTER (WHERE accepted_at IS NOT NULL) AS accepted
FROM public.partnerships GROUP BY status ORDER BY 1;

-- P4. The live notification types.
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
```

---

## Brief corrections (the brief was wrong or incomplete, and I acted on the code)

1. **0e: the route needed changes** (item 0d above).
2. **Required confirmation copy said "Everything else unchanged".** It is not: the agency loses
   the vendor's full profile tier, the notes panel and the performance panel while the partnership
   is not active (`eq active` gates), and the vendor drops to the agency's public profile. Both
   dialogs say so.
3. **"Stops new requests" is true for the pool only** (item 2).
4. **"Greg accepted" terminate wording** is reworded in one sentence for the same reason.
5. **The phase 0 premise "no one can write either status"** is true of the interface and false of
   the database (item 1).

---

## NUMBERED LIVE CHECKLIST

"VERIFIES THIS RUN" means the step exercises code this run wrote or changed, so it is the step
that proves it. "CARRIED OVER" means it tests behaviour that already existed; included so a
regression is caught. **None of these has been executed by me.**

Accounts: `gmarkant@gmail.com` (lead agency) and a vendor account that has an ACTIVE partnership
with it and at least one awarded project. Run on a preview of this branch (not pushed), or locally.

1. **VERIFIES THIS RUN.** Before anything, run queries P1 to P4 and note the policy and the
   trigger list. If P1 shows no `status` guard, item 1 is confirmed live.
2. **VERIFIES THIS RUN.** As the agency, open `/agency/pool`. On an **active** vendor card you see
   **Suspend** and **Terminate**. A **Discovered** card still shows only Remove. No card shows all
   three verbs.
3. **VERIFIES THIS RUN, AND IS THE COPY CHECK.** Click **Suspend**. Read the whole dialog. It must
   say it pauses, that they keep current work, documents and payments, and that you can reinstate.
   **It must NOT say access is revoked, withdrawn, cut off or removed.** Cancel. Click
   **Terminate**: same check. It must say work already awarded continues and they keep their record
   of past work and what they are owed. **Neither dialog may claim access is revoked.**
4. **VERIFIES THIS RUN.** Confirm **Suspend**. The card turns amber, reads "Suspended" (sub-line
   "Suspended. Partnered since ..."), and now shows **Reinstate** and **Terminate**. The Active
   vendors **tile** is one lower than before; the column description says "1 vendor here is
   suspended or terminated".
5. **VERIFIES THIS RUN.** With the pool open in two tabs, suspend in the first, then click
   Suspend on the same (now stale) active card in the second. It must succeed with no error and the vendor must
   receive **one** email in total, not two.
6. **VERIFIES THIS RUN.** Check the vendor inbox: exactly one email, "Your partnership with {name}
   is paused", reading as a pause. If the vendor has set email notifications off in their
   settings, no email arrives (the toggle is respected) unless their organization could not be
   resolved, in which case the server log says the opt-out could not be checked.
7. **VERIFIES THIS RUN.** As the **vendor**, open `/partner/projects`. The agency's group shows a
   **Paused** pill, each engagement card shows it, and opening one shows the notice at the top of
   the panel. The project is still listed and still opens.
8. **CARRIED OVER (reworded copy).** As the vendor, open `/partner/payments`. The agency is tagged
   Paused and the notice no longer says "you will not be sent new RFPs".
9. **VERIFIES THIS RUN.** As the **agency**, open the project's broadcast wizard. The suspended
   vendor is refused (400 "not active vendors") if selected. **Then type that vendor's email
   address as a manual recipient and send.** Expect it to be delivered: this documents the gap in
   item 2 and is not a pass/fail on the feature.
10. **VERIFIES THIS RUN.** Click **Reinstate**, read the dialog (it says nothing is sent), confirm.
    The card returns to active. **The vendor receives no email and no notification.**
11. **VERIFIES THIS RUN.** Suspend, then **Terminate** from the suspended card. The vendor receives
    "Your partnership with {name} has ended", a different message from step 6. The card is red,
    "Terminated", and offers only Reinstate. The vendor's `/partner/projects` shows **Ended**.
12. **VERIFIES THIS RUN, AND CONFIRMS A VENDOR CANNOT DO THIS THEMSELVES (route).** As the
    **vendor**, call the route directly:
    `fetch('/api/partnerships',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({partnershipId:'<id>',status:'terminated'})})`
    in the browser console while signed in. Expect **403** "Only the lead agency can change the
    state of an established partnership". Repeat with `suspended` and `active`. Expect 403 each time.
13. **VERIFIES THIS RUN, AND IT IS THE DATABASE HALF, EXPECTED TO FAIL.** Still as the vendor, in
    the console or a scratch script, using a supabase-js client authenticated with the vendor's
    session and the public anon key, run
    `.from('partnerships').update({status:'terminated'}).eq('id','<id>')`. **If this succeeds, item
    1 is live and the route check in step 12 is not a defence.** Reset the status afterwards from
    the agency side. Do this on a test partnership only.
14. **VERIFIES THIS RUN.** As the agency, try to reinstate a **vendor-declined invitation** (a
    terminated row with no "Partnered since"): the card shows no Reinstate button. Via the API the
    route returns 409 "ended when the vendor declined your invitation".
15. **VERIFIES THIS RUN.** With a vendor suspended, **award a submitted bid from them** (if you
    have one). Afterwards the partnership must still read **Suspended**, and the agency must have
    **no** "partnership accepted" notification for it. This is the award-resolver fix.
16. **VERIFIES THIS RUN.** Open the suspended vendor's `/agency/pool/{id}` page. The refusal or
    access text says the profile opens again "when the partnership is reinstated", not "when they
    accept your invitation". The notes and performance panels show their existing 404/empty state.
17. **VERIFIES THIS RUN.** Run an AI comparison on 2+ bids for one scope item. Open the agency
    activity feed: **one** line, "compared bids on {scope}", with no vendor name and no count.
    Run it again (force): a second line. A cached re-open adds none.
18. **VERIFIES THIS RUN.** On a vendor's notes panel, blacklist them, save: "blacklisted {vendor}".
    Edit only the note text and save: **no new line**. Clear the blacklist, save: "lifted the
    blacklist on {vendor}". Save again unchanged: **no new line**.
19. **CARRIED OVER.** As the vendor, confirm neither new feed line is visible to you.
20. **CARRIED OVER.** Remove a Discovered contact: the existing dialog and behaviour are unchanged,
    and the contact appears under "Removed contacts".
