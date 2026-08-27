# Bid notification scope - session report

Branch `feat/bid-notification-scope`, five commits on top of `5fa1286`. Nothing pushed.
No migration applied. No database contacted.

---

## AT THE TOP: what could not be completed, and what is not proven

**Every phase completed.** Two things were NOT executed and must not be read as verified:

1. **`docs/096-preapply-test.sql` HAS NEVER BEEN RUN.** There is no PostgreSQL on this
   machine - `psql`, `postgres`, `pg_ctl` and `docker` are all absent. The file is
   authored and read-checked (dollar-quoting balanced, 11 `BEGIN` / 10 `END;` + 1 block
   `END`, 25 `IF` / 25 `END IF`, 10 exception handlers, 9 assertions, section A diffed
   byte-for-byte against the migration). **It is not known to parse against a live
   server.** If it raises a bare SQLSTATE with no banner on the first run, that is the
   test file failing, not a verdict on 096 - see THREE WAYS THIS RUN CAN END in its header.

2. **`096_bid_notification_scope.sql` HAS NEVER BEEN APPLIED OR DRY-RUN.** Prohibition 1.
   Every "EXPECTED" value in its verification block is reasoned from the repository, not
   measured.

**A SECOND DEFECT WAS FOUND THAT THE BRIEF DID NOT NAME, AND IT IS NOT FIXED.** It is
OPEN-BID-1 below. 096 does not reach it, deliberately, because closing it is a scope
decision that is Greg's.

### EXECUTED / READ / REASONED

| | |
|---|---|
| **EXECUTED** | the six gates, twice (Phase 0 and Phase 5); `pnpm org-id-reads:guard` a third time after Phase 4; `npx tsc --noEmit` after Phase 3; every `grep`/`diff` quoted below, including the byte-comparison of the restated policy arms and the two helper bodies |
| **READ** | `LIGAMENT_CONTEXT.md`, migrations 063, 079, 084, 085, 094, 095 and their down files, `docs/094-preapply-test.sql`, `lib/partnership-state.ts`, `lib/notifications.ts`, `lib/partner-inbox-access.ts`, `lib/entitlements.ts`, `scripts/check-org-id-reads.mjs`, the three `notifyBidSubmitted` call sites, `app/api/partner/partnerships/claim/route.ts`, `components/partner-layout.tsx`, `components/agency-layout.tsx`, `components/notification-bell.tsx`, `components/terms-disclosure-section.tsx`, `app/globals.css` |
| **REASONED** | which statuses the new helper admits; that the policy count is 117 after 096 (ALTER creates nothing); that fan-out becomes N rows per bid; that the 28 ghosts are unaffected; what macOS shows after the `color-scheme` change; every EXPECTED value in 096's verification block |

---

## 1. Every reader of `current_user_active_counterparty_user_ids()`

The live `pg_policies` query found one policy. This is the code-side half, from
`grep -rn` across the whole repository excluding `node_modules`, `.git`, `.next` - 51 hits
in 24 files. Full working in `docs/096-phase0-baseline.md`.

**EXECUTABLE references - seven, and only one of them grants anything:**

| File:line | Statement | Live? |
|---|---|---|
| `079_organizations.sql:779` | `CREATE OR REPLACE FUNCTION` | the definition |
| `079_organizations.sql:808` | `REVOKE EXECUTE ... FROM PUBLIC` | applied |
| `079_organizations.sql:811` | `GRANT EXECUTE ... TO authenticated` | applied |
| `079_organizations.sql:1258` | arm of `CREATE POLICY "Scoped insert notifications"` | superseded by 094 |
| **`094_notifications_colleague_scope.sql:335`** | **arm of `ALTER POLICY "Scoped insert notifications"`** | **THE ONE LIVE READER** |
| `094_..._down.sql:102` | the same arm restated in the rollback | not applied |
| `079_organizations_down.sql:553` | `DROP FUNCTION IF EXISTS` | not applied |

Two further hits are test fixtures (`docs/094-preapply-test.sql:601` and `:785`), and both
read the policy TEXT, not the function. The other 44 hits are comments - verified
mechanically, every one is on a line whose first non-space characters are `--`, or is prose
in a `.md`.

**`.rpc()` calls: none.** Eight exist in the app (`org_has_member_with_email`,
`decline_org_invitation`, `accept_org_invitation`, `partner_vouch_count`,
`partner_vouch_counts`, `set_active_org`); none is this helper, and no raw SQL string calls
it. **No other function body calls it** - checked every `CREATE FUNCTION` block in
`supabase/migrations/`.

> **THE CODE-SIDE CENSUS AGREES WITH THE LIVE QUERY EXACTLY, AND NO READER WAS FOUND THAT
> WOULD BENEFIT FROM THE WIDER SET.** Prohibition 4's report-rather-than-change clause is
> therefore not triggered. The single reader is the one being fixed, and it is fixed by
> adding an arm beside the helper rather than by touching it.

---

## 2. Which statuses the new helper admits, and why

**`public.current_user_commercial_counterparty_user_ids()`**

```
ADMITTED:  pending, active, suspended
REFUSED:   terminated, removed, NULL, and any value not in the list
```

The domain is `063:34`: `CHECK (status IN ('pending','active','suspended','terminated','removed'))`.

**The line comes from the code, not from a guess.** Migration 085 already drew it and named
it: `current_user_commercial_counterparty_org_ids()` admits pending, active and suspended
and excludes terminated and removed, on the stated ground that a relationship which has
ENDED is past the commercial line - *"A company NAME survives the end of a relationship;
its commercial terms do not."* 085's own comment says the helper family is "ordered
strictly by breadth" and that "any future change should keep that ordering true". The new
helper is the user-id sibling of that org-id tier and takes the same status set:

| Function | Returns | Statuses |
|---|---|---|
| `current_user_counterparty_org_ids()` | org ids | all five |
| `current_user_commercial_counterparty_org_ids()` | org ids | pending, active, suspended |
| **`current_user_commercial_counterparty_user_ids()`** | **user ids** | **pending, active, suspended** |
| `current_user_active_counterparty_user_ids()` | user ids | active |

`lib/partnership-state.ts` was read first, as instructed. `isActivePartnership()` is
`status === 'active'` and nothing else, and the module's own comment establishes that the
"network" column is "active, plus the paused and ended states that were once active" -
i.e. the product already distinguishes *paused* from *ended*. That is the same seam 085 cut
on, and it is where this helper cuts too.

### The one place this departs from 085: it is written by INCLUSION

085 wrote `status IS DISTINCT FROM 'terminated' AND status IS DISTINCT FROM 'removed'`, so
an unrecognised or NULL status falls IN. Its comment gives the reason in one sentence:

> *"The failure direction for a VISIBILITY set is to show one row too many; for an AUTHORITY
> set it would be the opposite, and this is not an authority set."*

**This one IS an authority set** - it gates a WRITE into somebody else's inbox - so the
failure direction flips and it is written `status IN ('pending', 'active', 'suspended')`.
A status nobody anticipated is refused here and admitted there, on purpose.

### It is deliberately NOT composed on 085's helper

The body could have been one line. It is not, for two reasons: composing would couple a
WRITE authority to a READ helper, so a later change to the profiles read boundary would
silently move this write boundary with it; and it would inherit the by-exclusion predicate
this file inverts. **If 085's commercial tier ever changes, this function does not follow
automatically.** That is stated in the migration and in the function's `COMMENT`.

### `removed` - A RULING GREG OWES. EXCLUDED UNTIL HE MAKES IT.

`'removed'` means the agency dismissed the vendor from its pool.
`app/agency/pool/page.tsx:593` is the only writer;
`app/api/partnerships/route.ts:95` and `:129` already filter removed rows out of the
agency's own pool reads.

**For admitting it.** The portal bid route gates on the RFP inbox row, not on partnership
status - `partnerCanAccessPartnerRfpInbox()` checks `vendor_org_id` membership or a
`recipient_email` match plus the NDA gate, and reads no status at all. So a vendor on a
removed partnership who still holds an inbox row CAN submit a bid and the bid row lands.
Excluding means that bid arrives silently - the same defect this session exists to fix, in
a smaller shape.

**For excluding it.** 085 already put `removed` outside the commercial line for reads. An
agency that dismissed a vendor and is then pushed a bell notification by that vendor has
had its own dismissal overridden by the party it dismissed.

**What each choice costs.**

- *Excluding costs:* bids from dismissed vendors stay silent in-app. Live blast radius is
  **one** partnership row - and in practice **zero**, because
  `app/api/partner/partnerships/claim/route.ts:65` claims only `pending` and `active` rows,
  so a removed partnership almost never carries a `vendor_org_id` and no arm could match it
  either way. The agency still receives the **transactional email**, which is sent on a
  separate path (`app/api/partner/rfps/[id]/response/route.ts:414`,
  `sendTransactionalEmail`) and is not gated by RLS at all.
- *Admitting costs:* a dismissed vendor regains the ability to write rows into the
  dismissing agency's inbox, and that is not reversible by anything short of another
  migration.

> **RECOMMENDATION: keep it excluded.** Excluding is reversible; admitting a status that
> should not be there is a silent permission. If Greg rules the other way it is one word in
> the `IN` list, the same word in the down file, and the inversion of **T6** in the
> pre-apply test - which is the executable form of this ruling. Change all three together.

`suspended` is admitted and has **zero** live rows, so it changes nothing today; it is
included to keep the family ordering true.

---

## 3. The migration

> ### FULL FILENAME: `supabase/migrations/096_bid_notification_scope.sql`
>
> Its rollback sibling is `supabase/migrations/096_bid_notification_scope_down.sql`, and
> **that name sorts FIRST under a `096_*.sql` glob.** A `094_*.sql` glob matched the down
> file first this week and the down file was applied by mistake. **Do not glob. Type the
> full name.**

**Apply order.** `096` is the only migration authored this session. It depends on nothing
that is not already live (089-092, 094, 095 are applied; 093 stays parked and is neither
resumed nor renumbered). It names nothing the code names - no route, component or library
in the repository mentions `current_user_commercial_counterparty_user_ids()` or the policy
text - so **apply it before the code, after the code, or with no code at all.**

**Dry run.** Change the `COMMIT;` on **LINE 388** to `ROLLBACK;`, run, confirm no errors,
put `COMMIT;` back. `BEGIN;` is on **LINE 276**. Both re-grepped after the last edit of the
file. The verification block sits after line 388 and is entirely commented out, so a dry
run executes none of it.

**Sequence:** run `docs/096-preapply-test.sql` → dry run → apply → run the VERIFICATION
block (V1-V7, each states its expected value) → update the migrations table in
`LIGAMENT_CONTEXT.md`. No code deploy required.

**What it contains.** One `CREATE OR REPLACE FUNCTION`, one `COMMENT`, three grant lines,
one `ALTER POLICY`. No table, no column, no row, no backfill.
`current_user_active_counterparty_user_ids()` is **not modified** - prohibition 4 held.

**Verified mechanically before commit:**

- the three restated policy arms are **byte-identical** to 094's live statement
  (`md5 ed104f6f5c8ce5bc35fe0d583050aa31` for 094's, 096's-minus-the-new-arm, and the down
  file's - all three the same)
- the new helper's body diffed against `079:779`'s with names normalised returns **exactly
  two changed lines**, both the status predicate, one per union arm. Nothing else differs:
  `SETOF uuid`, `STABLE`, `SECURITY DEFINER`, `search_path = public, pg_temp`, both
  directions unioned, `vendor_org_id IS NOT NULL` on the lead arm only.

**Arm 3 is now redundant and is kept anyway.** Every id the active-only helper returns is
also returned by the new one. It is restated unchanged because prohibition 4 forbids
touching that helper and removing its only reader is a step toward touching it - and
because while both arms stand, dropping arm 4 alone restores today's behaviour exactly,
which is what the down file does.

**`REVOKE ... FROM anon` by name.** Done, and asserted by V3
(`has_function_privilege('anon', ...)` must be `f`). One correction to the brief's framing,
which changes nothing about what was written: the repository defines **eight** `current_user_*`
helpers, not seven, and **two** already revoke from `anon` by name - `current_user_email()`
(089:766) and `current_user_org_member_user_ids()` (094:312). The six that still carry the
default `anon` grant are the five from 079 plus 085's. 096 makes it three of nine.

### The fan-out consequence, stated because it will otherwise surprise you

`createOrgNotification()` (`lib/notifications.ts:197`) resolves **every** member of the
target organization and inserts **one row per member**. Today, for a pending partnership,
that fan-out produces **zero** rows because all of them are refused. After 096 it produces N.

> **A bid on a partnership whose lead agency has three colleagues writes THREE notification
> rows, not one.**

**What that means for the bell.** The unread count is per USER, not per organization -
`app/api/notifications/route.ts` selects on `user_id = auth.uid()`. So each of the three
colleagues sees **one** new unread item, which is correct and is the intent. **Nobody sees a
count of three for one bid.**

What does change at organization scale is row volume in `public.notifications`: one bid on a
five-person agency is five rows. **Marking read is also per user** - one colleague clearing
their bell does not clear anyone else's, so the same bid can sit unread on four bells after
the fifth colleague has dealt with it. There is no organization-level "somebody has seen
this" state in this schema and 096 does not add one.

**The visible step change.** Agencies that have received zero in-app bid notifications since
079 will start receiving them across all 27 pending partnerships from the next bid onward.
It is not a backfill - no historical bid produces a row - but the first busy day after apply
will look like a feature suddenly arriving, because it is one.

---

## 4. The 28 ghost partnerships - unaffected, and already working

A ghost is a partnership row with **no `vendor_org_id`**: a vendor who has never claimed a
Ligament login. Confirmed as the brief states, and the mechanism is this:

- `app/api/rfp/guest/[token]/route.ts` builds its client at **line 151** from
  `SUPABASE_SERVICE_ROLE_KEY`. Service role bypasses RLS entirely.
- Both guest `notifyBidSubmitted()` call sites (`:583`, `:768`) run on that client, so
  **this policy has never refused them and 096 does not help them.**
- They were blocked only by the `23514` on `notifications_type_check`, which **095 already
  fixed** - a CHECK is not RLS, so the service role failed on it too.

**Nothing in 096 touches that path in either direction.**

> ### OPEN-BID-1 - THE GAP THE BRIEF DID NOT NAME. NOT FIXED. GREG'S CALL.
>
> "A ghost bids through the guest token path" is true but **not exhaustive**. A ghost
> partnership's vendor can ALSO bid through the **portal**, on the session client, with RLS
> in full force - and 096 does not help them.
>
> `vendorOwnsPartnerRfpInboxRow()` (`lib/partner-inbox-access.ts:53-63`) grants inbox access
> on **either** `vendor_org_id` membership **or** a `recipient_email` match against the
> signed-in profile's email. So a vendor who has signed in, holds an organization, and whose
> email matches the inbox row reaches site #11 **even when the `partnerships` row's
> `vendor_org_id` is still NULL.**
>
> When it is NULL, the new helper's vendor arm - `p.vendor_org_id IN (SELECT org_id FROM
> my_orgs)` - cannot match, so the notification is refused exactly as before. **096 widens
> over STATUS; this gap is about IDENTITY.**
>
> **How it arises.** `app/api/partner/partnerships/claim/route.ts:63-66` populates
> `vendor_org_id` on the vendor's next partner-portal page load, for rows whose status is
> `pending` or `active` and whose `partner_email` matches - `.ilike("partner_email", email)`.
> A vendor lands in this gap when they reach the RFP without passing through the claim (a
> direct link), when the partnership's `partner_email` differs from the inbox row's
> `recipient_email`, or when the status is `removed`/`terminated`, which the claim skips.
>
> **Why 096 does not close it.** Closing it means admitting a counterparty on an EMAIL
> match, which is a materially different and much wider authority than a partnership row -
> and `093`'s HOLE 1 is on record for exactly the hazard of matching `partner_email` with
> `ilike`, where a stored `%` or `_` is a wildcard. **Reported, not chosen.**
>
> **The query that settles how big it is:**
> ```sql
> SELECT count(*) FROM public.partner_rfp_inbox i
> JOIN public.profiles pr ON lower(btrim(pr.email)) = lower(btrim(i.recipient_email))
> WHERE i.vendor_org_id IS NULL;
> ```
> Non-zero means live vendors can reach the portal bid form on a ghost partnership, and
> their bids will stay silent after 096.

**The discarded boolean is also not fixed here.** All three `notifyBidSubmitted()` call
sites `await` it and throw the return value away, so a future refusal stays invisible to the
caller. That is a code change, not a policy change, and it was out of scope for this session.

---

## 5. After 096 applies: what an agency sees that they did not before

> **A vendor who was invited by broadcast, has signed in, and submits a bid through the
> vendor portal now puts an item in the bell of EVERY member of the lead agency. Before
> 096, that item was never written at all - not delayed, not unread: absent.**
>
> Before: only a bid across an **active** partnership (4 of 33 rows), or a bid from a
> **ghost** through the guest link, produced anything.
> After: every partnership at `pending`, `active` or `suspended` with a claimed vendor does.
> The title reads **"New Vendor Bid"** (or "Vendor Bid Updated" on a revision) and links to
> `/agency/bids`.

### The shortest live check

Run this in the SQL Editor **before** applying, and again after the next portal bid:

```sql
SELECT count(*) FROM public.notifications WHERE type = 'bid_submitted';
```

Zero before, and it stays zero after 096 applies until a bid actually happens - **096
backfills nothing.** The number that proves it worked is this one, after a vendor on a
pending partnership submits:

```sql
SELECT n.created_at, n.title, count(*) OVER (PARTITION BY n.created_at) AS rows_for_this_bid
FROM public.notifications n
WHERE n.type = 'bid_submitted'
ORDER BY n.created_at DESC
LIMIT 5;
```

`rows_for_this_bid` should equal the number of members in that agency - that is the fan-out,
visible.

**If you want one line and nothing else**, this is it - it answers "is the policy the new
one" without needing a bid to have happened:

```sql
SELECT with_check LIKE '%commercial_counterparty_user_ids%' AS applied
FROM pg_policies
WHERE schemaname='public' AND tablename='notifications'
  AND policyname='Scoped insert notifications';
```

---

## 6. Phase 3 - `color-scheme`. What changes on macOS.

**Commit `312026b`. THIS IS THE SHA THAT REVERTS IT** - `git revert 312026b`. Highest blast
radius change in the session, and it is its own commit for that reason.

### Which surface is which - established from the code, not assumed

There is **one** `<html>` element in the whole app (`app/layout.tsx` is the only layout
file) and `body` is `@apply bg-background text-foreground` with `--background: #0C3535`.
So the document is dark app-wide.

| Surface | Theme | Evidence |
|---|---|---|
| Agency portal | **dark** | `components/agency-layout.tsx:494` is `min-h-screen relative` with no background - it inherits `body`. Exactly **one** bare `bg-white` exists in all of `app/agency/` (`msa/page.tsx:1543`, a button variant); the other 267 `bg-white` hits are `bg-white/5` and `bg-white/10` translucent overlays |
| Public marketing, auth | **dark** | same inheritance; `app/contact/` holds 3 native `<select>` on it |
| Guest RFP respond | **dark** | `app/rfp/respond/[token]/page.tsx` is `min-h-screen bg-background` at four places |
| **Vendor portal** | **light content, dark header bar** | `components/partner-layout.tsx:145` `min-h-screen bg-[#FAFAFA]`; `:147` header `bg-[#0C3535]`; `--vendor-surface: #FFFFFF`, `--vendor-foreground: #0C3535` |

**The vendor portal is the mixed one, so it was NOT set globally - it was scoped.** Two
declarations, no more:

1. `app/globals.css` `:root` → `color-scheme: dark`
2. `components/partner-layout.tsx:169` → `[color-scheme:light]` on `PartnerChrome`'s root

**Why the scope covers the vendor portal's dark header rather than only its `<main>`.** The
header bar contains **no native control** - verified, `grep -nE '<select|<input|<textarea'`
on that file returns nothing - and every surface that floats out of it is **light** anyway:
the avatar dropdown (`:238` `bg-vendor-surface` = `#FFFFFF`), the nav tooltip (`:185`, same),
and the vendor branch of the notification bell (`notification-bell.tsx:391` `bg-white`).
Scoping to `<main>` instead would have left those three floating surfaces under the dark root.

**Coverage is complete.** Every vendor page reaches `PartnerChrome`, either directly
(`/partner/rfps/[id]`, `/partner/profile`) or via `PartnerLayout` (everything else). The
three `/partner` routes that use neither - `bids`, `invitations`, `rfps` - are redirect
stubs of 34, 10 and 34 lines with no markup.

**`components/terms-disclosure-section.tsx` needed no scoping.** It looked like a hardcoded
light island on a dark page, but it takes a `theme` prop: `theme="light"` at
`app/partner/rfps/[id]/page.tsx:2246` and `theme="dark"` at
`app/rfp/respond/[token]/page.tsx:1313`. It is already correct under both roots.
`components/help-term.tsx` likewise - its own comment states the guest respond page uses the
dark variant.

### Every native control type in the repo, and what changes for each

`color-scheme` restyles native widgets, not CSS-styled ones. Radix components
(`<Select>`, `<Checkbox>`, `<Switch>`, `<Slider>` from `components/ui/`) render **divs** and
are **completely unaffected** - that is 47 `<Select>`, 18 `<Checkbox>`, 3 `<Switch>` and 4
`<Slider>` usages that do not move at all.

| Native control | Where | Under `color-scheme: dark` (agency / public / auth / guest) | Under `[color-scheme:light]` (vendor portal) |
|---|---|---|---|
| `<select>` popup | 8 agency, 3 contact, 1 shared, **14 vendor** | **THE FIX.** macOS AppKit menu renders DARK. This is the root cause of the family fixed one control at a time | unchanged - light, as today |
| `<option>` list | same | dark background, light text | unchanged |
| `input type="date"` | 7 agency | calendar icon inverts to light-on-dark; the picker panel renders dark | none in the vendor portal |
| `input type="number"` | 4 agency, 4 vendor | spinner arrows invert to light | unchanged |
| `input type="checkbox"` | 2 agency, 4 vendor, 4 guest, 2 public | unchecked box goes dark-filled with a light border | unchanged |
| `input type="radio"` | 1 agency | same treatment | none |
| `input type="range"` | 1 agency, 1 vendor | track darkens, thumb inverts | unchanged |
| `input type="file"` | 5 agency, 8 vendor, 1 guest | the "Choose File" button chrome darkens | unchanged |
| `<textarea>` resize grip | 14 agency, 12 vendor, 20 shared | grip inverts to light | unchanged |
| text/email/url/password `<input>` | 55 agency, 60 vendor, 41 shared, 15 public | **browser AUTOFILL background** switches from the pale yellow/blue to a dark fill with light text | unchanged |
| scrollbars | everywhere | dark track and thumb | light, as today |

### What Greg sees change on macOS, before he looks

macOS Chrome and Safari draw `<select>` popups through a **native AppKit menu that discards
CSS colours entirely** - which is why the per-control `bg-background` fixes shipped in
`e3ae7d3` and `eb97010` changed only the CLOSED control on his machine and never the popup.
`color-scheme` is the one property AppKit honours. So:

1. **Every `<select>` in the agency portal now opens a DARK popup.** This is the visible
   payoff and the thing to check first: agency dashboard interpretation picker
   (`app/agency/page.tsx`), MSA status pickers (`app/agency/msa/page.tsx`, 3), settings
   discipline picker (`app/agency/settings/profile/page.tsx`, 2), team roster role picker.
   Previously white-on-white and unreadable when opened on a non-macOS Chromium, and
   light-on-dark-chrome on macOS.
2. **The three `<select>` on `/contact` now open dark** - same fix, public page.
3. **Scrollbars in the agency portal turn dark.** If macOS is set to "Show scroll bars:
   Always" this is immediately visible everywhere. On the default overlay setting it appears
   only while scrolling.
4. **Autofill on the auth pages turns dark.** Saved-password fills on sign-in will be a dark
   box with light text instead of the pale one. This is the change most likely to read as
   "something is different" without being wrong.
5. **The date pickers on the agency MSA milestone rows open dark**, and the small calendar
   glyph inside the field inverts.
6. **The vendor portal looks identical to today.** The `[color-scheme:light]` scope is a
   defence, not a change - without it the root declaration would have darkened all 14 vendor
   `<select>` popups, the 8 file pickers, the checkboxes and the autofill on a `#FAFAFA`
   page. **If anything in the vendor portal has gone dark, that scope is not applying and
   the commit should be reverted, not debugged.**

Three comments that asserted "there is no `color-scheme: dark` anywhere in this repository"
were updated in the same commit - they were about to become false. No guard allow-list and
no `KNOWN_OPEN` count was touched.

---

## 7. Phase 4 - the drifted guard baseline

`lib/entitlements.ts` was recorded at 1 and measured 0. **The entry is deleted**, on the
authority of the block comment above `KNOWN_OPEN_MIRROR` in `scripts/check-org-id-reads.mjs`:

> *"Keyed on file and count. MORE than the count fails. FEWER is reported so the count gets
> lowered rather than left to rot; when a count reaches zero, delete the entry."*

**The line before:**

```js
  {
    file: "lib/entitlements.ts",
    count: 1,
    tiers: "SESSION",
    why:
      "agencyEntitlementId returns best?.org_id ?? userId. Deliberate and documented for quota accounting, where failing would take the AI surface down. Recorded because it is the one remaining place a user id can reach a caller expecting an organization id. resolveCallerWriteOrgId is the write-path alternative and returns null.",
  },
```

**The line after:** the object is gone, replaced by a comment block recording that it was
there, why it measured zero, and the residual risk below.

**Why it reached zero, established by reading the file.** `agencyEntitlementId()` now
delegates to `resolveActingOrgId()` and reads `resolution.orgId ?? userId`. The recorded
shape was `org_id ?? userId`, which the `FALLBK` matcher catches; the property is now
camelCase, so the matcher cannot see it. The owner/admin/member ranking is genuinely gone.

> **THE FALLBACK ITSELF IS NOT GONE, ONLY ITS SPELLING.** `agencyEntitlementId()` still
> returns the caller's USER id when the org resolution refuses. This guard matches column
> NAMES, not semantics. Deleting the entry loses no record - `lib/entitlements.ts`'s own
> header documents the behaviour at far greater length than the mirror entry did (the
> "DELIBERATELY NOT BRANDED" paragraph, and the `resolveCallerWriteOrgId` comparison).

**Only this entry was touched.** Nothing was added, nothing was raised, and no entry whose
measured count is HIGHER was trimmed. **What the guard says after:**

```
Class B summary
  OPEN             60  known, reported, deliberately unfixed - see KNOWN_OPEN_MIRROR
  REGRESSIONS       0  files with MORE findings than recorded
  IMPROVED          0  files with FEWER - lower the count in KNOWN_OPEN_MIRROR

ORG-ID-READ GUARD PASSED. No NEW instance of class A OR class B.
```

The `CLASS B: these files now have FEWER findings...` advisory block is gone. `OPEN` is
still 60 - the deleted entry contributed no findings, so the open total could not move.

---

## 8. The six gates - Phase 5 against the Phase 0 baseline

Compared against `docs/096-phase0-baseline.md`, which was measured on this machine at
`5fa1286`. Not against any number in any other document.

| # | Gate | Phase 0 | Phase 5 | Movement |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0, 0 lines | exit 0, 0 lines | none |
| 2 | `pnpm build` | exit 0, 72/72 pages, 173 route lines | exit 0, 72/72 pages, 173 route lines | none - route table diffs **byte-identical** |
| 3 | `pnpm lint` | exit 1, **182 problems (154 errors, 28 warnings)** | exit 1, **182 (154, 28)** | none - the reported file set and the error/warning split both diff clean |
| 4 | `pnpm identity-columns:guard` | exit 0, 387 files, TOTAL 0 | exit 0, 387 files, TOTAL 0 | none |
| 5 | `pnpm org-id-reads:guard` | exit 0, OPEN 60, REGRESSIONS 0, **IMPROVED 1** | exit 0, OPEN 60, REGRESSIONS 0, **IMPROVED 0** | **the one movement, Phase 4, by design** |
| 6 | `pnpm embed-targets` | exit 0, 387 files, TOTAL 0 | exit 0, 387 files, TOTAL 0 | none |

**Every movement explained.** Gate 5's `IMPROVED 1 → 0` is Phase 4 and nothing else: the
`lib/entitlements.ts` entry that had drifted low was deleted, so there is no longer a file
measuring fewer findings than recorded. `OPEN` held at 60 and `REGRESSIONS` at 0, which is
what proves the deletion narrowed the baseline rather than widening it.

**`pnpm lint` exits 1 at both ends.** That is this branch's pre-existing state, not
something introduced here. The number to hold is **182 / 154 / 28**.

`pnpm verify-rls` and `pnpm policy-audit:guard` were **not run**, as instructed - neither
reads a `.ts` file.

---

## 9. Browser checklist, ordered by risk

Nothing here needs 096 applied. Steps 1-5 test commit `312026b` only.

| # | Check | SHA | Revert or debug? |
|---|---|---|---|
| 1 | **Vendor portal, `/partner` → Profile.** Open the discipline `<select>`. It must be **LIGHT**, as today. Then check the page background is still `#FAFAFA` and the bell panel still white. | `312026b` | **REVERT.** If any of this went dark, `[color-scheme:light]` is not applying to `PartnerChrome` and the whole vendor portal is mis-themed. `git revert 312026b`. Do not debug live. |
| 2 | **Vendor portal, `/partner/rfps/[id]`** - the bid form. Its 3 `<select>` and its file pickers must be LIGHT. This page reaches `PartnerChrome` directly rather than through `PartnerLayout`, so it is the one that proves the scope covers both routes. | `312026b` | **REVERT** on the same grounds. |
| 3 | **Agency portal, `/agency/msa`.** Open a status `<select>`. It should now be **DARK** - the payoff. Then open a milestone date field: the picker should be dark and the calendar glyph light. | `312026b` | **Debug.** A light popup here means the declaration did not land but nothing is broken - the state is today's. |
| 4 | **Auth sign-in page.** Trigger a saved-password autofill. It will be a **dark** box with light text instead of the pale one. Confirm the text is legible against it. | `312026b` | **Debug**, unless it is illegible - then revert. |
| 5 | **Agency portal, any long page**, with macOS "Show scroll bars: Always". Scrollbars should be dark. | `312026b` | **Neither.** Cosmetic; note it and move on. |
| 6 | **Guest RFP respond page** via a real token. Its 4 checkboxes and 1 file input go dark; the `TermsDisclosureSection` should stay coherent because it is on `theme="dark"`. | `312026b` | **Debug.** |
| 7 | **After 096 is applied**, have a vendor on a pending partnership submit a portal bid. Every member of the lead agency should get a bell item titled "New Vendor Bid". | 096 (not a SHA - a migration) | **Roll back the migration** with `096_bid_notification_scope_down.sql` if an ACTIVE partnership's notification has STOPPED. A pending one not arriving is a miss, not a regression - debug it. |

**Nothing in steps 1-6 requires a database.** `312026b` touches only CSS and one `className`,
plus three comments.

---

## 10. Every OPEN item, with the query that settles it

| ID | What | Query or check that settles it |
|---|---|---|
| **OPEN-BID-1** | Portal bids on a partnership whose `vendor_org_id` is NULL are still refused after 096. Identity gap, not a status gap. **Greg's call - see §4.** | `SELECT count(*) FROM public.partner_rfp_inbox i JOIN public.profiles pr ON lower(btrim(pr.email)) = lower(btrim(i.recipient_email)) WHERE i.vendor_org_id IS NULL;` |
| **OPEN-BID-2** | Does `'removed'` belong in the helper's status list? **A ruling Greg owes. Excluded until he makes it.** Inverting it means one word in `096`, the same word in the down file, and inverting **T6**. | `SELECT status, count(*), count(vendor_org_id) AS claimed FROM public.partnerships GROUP BY status ORDER BY status;` - if `claimed` is 0 on the `removed` row, the ruling has no live effect either way |
| **OPEN-BID-3** | All three `notifyBidSubmitted()` call sites discard the boolean, so a refusal is invisible to the caller. A code change, not attempted here. | `grep -n "await notifyBidSubmitted" app/api/partner/rfps/\[id\]/response/route.ts app/api/rfp/guest/\[token\]/route.ts` - three hits, none assigned |
| **OPEN-BID-4** | Whether the pending-with-claimed-vendor population exists **at all** today. If it does not, 096 is correct and inert until the first of the 27 pending vendors signs in. This is why the pre-apply test may synthesize its subject. | `SELECT count(*) FROM public.partnerships WHERE status='pending' AND vendor_org_id IS NOT NULL;` |
| **OPEN-BID-5** | The pre-apply test has never been executed - no PostgreSQL on this machine. | Run `docs/096-preapply-test.sql`. A banner-less raw SQLSTATE means the test file, not 096. |
| **OPEN-BELL-5** | **CLOSED** by `312026b`, subject to the browser checklist above. | `grep -rn "color-scheme" app/globals.css components/partner-layout.tsx` - two hits, one each |
| **OPEN-BELL-7** | **CLOSED** by `82263c1`. | `pnpm org-id-reads:guard` - `IMPROVED 0` |
| **OPEN-ENT-1** | `agencyEntitlementId()` still returns the caller's USER id on a failed org resolution. Deliberate, documented in `lib/entitlements.ts`, and **no longer visible to any guard** after Phase 4. | `grep -n "resolution.orgId ?? userId" lib/entitlements.ts` |
| **OPEN-DOC-1** | `CLAUDE.md` prescribes a modal rule for `/partner/discover`. **That route does not exist** - `app/partner/` holds bids, invitations, legal, marketplace, network, onboarding, payments, profile, projects, rfps, settings. | `ls app/partner/` |

---

## 11. Commits

| SHA | Phase | What |
|---|---|---|
| `d0e2663` | 0 | the measured baseline and the reader census |
| `ffe3242` | 1 | `096_bid_notification_scope.sql` + its down file |
| `24a8ed7` | 2 | `docs/096-preapply-test.sql` |
| `312026b` | 3 | `color-scheme` - **the SHA that reverts Phase 3** |
| `82263c1` | 4 | the `KNOWN_OPEN_MIRROR` trim |

Each phase is its own commit and any one reverts alone. **Nothing pushed.**
