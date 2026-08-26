# Bell pagination, the seven selects, and the bid_submitted trace

Session of 2026-08-26, branch `feat/bell-pagination-and-selects`, baseline commit `a6c7e73`.
Unattended. No push, no migration applied, no database access.

**Completion status, stated first.** All five phases completed. Phase 1 found one defect and
did not fix it, as instructed. Nothing in Phase 2 required restructuring how either layout
fetches, so the STOP condition in that phase was not reached.

**Evidence discipline used throughout.** Every claim below is tagged:
**EXECUTED** (a command was run and its output is quoted), **READ** (a file or line was read),
or **REASONED** (a conclusion drawn from what was read, with no runtime confirmation).
Nothing here was confirmed against the live database - this session had no database access
by instruction.

---

# Phase 0. Baseline

**EXECUTED**, once, at `a6c7e73`, working tree clean.

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **exit 0**, no output |
| Build | `pnpm build` | **exit 0**, `Compiled successfully in 9.6s`, 173 route lines printed |
| Lint | `pnpm lint` | **exit 1**, `182 problems (154 errors, 28 warnings)` |
| Identity columns | `pnpm identity-columns:guard` | **GUARD PASSED**, 387 files scanned, TOTAL 0 in 0 files |
| Org id reads | `pnpm org-id-reads:guard` | **GUARD PASSED**, Class B OPEN 60, REGRESSIONS 0, IMPROVED 1, 14 known-open Class A sites |
| Embed targets | `pnpm embed-targets` | 387 files scanned, 30 repointed pairs parsed, TOTAL **0** in 0 files |

`pnpm verify-rls` and `pnpm policy-audit:guard` were **not run**: neither reads a `.ts` file,
per instruction.

Two baseline facts to carry forward so Phase 5 is not misread:

- **Lint already fails at baseline.** 154 errors, 28 warnings, exit 1. `pnpm lint` failing in
  Phase 5 is not a regression; a change in the *count* is.
- **The org-id-reads guard already reports one IMPROVED file at baseline**:
  `lib/entitlements.ts recorded 1, found 0`. That is pre-existing drift in
  `KNOWN_OPEN_MIRROR`, present before this session touched anything. Per the hard
  prohibitions I did not edit the allow-list or the count.

Full baseline output preserved at `lint-baseline.txt` / `build-baseline.txt` in the session
scratchpad (not committed - scratch).

---

# Phase 1. The bid_submitted trace. REPORT ONLY - nothing was changed.

095 is applied, so `notifications_type_check` accepts `'bid_submitted'`. That is the only
thing 095 proved. This phase traces whether the emit path can actually complete.

**One defect found. It is not fixed. It is stated in full at 1.6 with its evidence.**

## 1.1 The three sites, and which client each uses

**READ**, all three, plus the client construction in each file.

| # | Site | Client | Constructed at | Does 094's INSERT policy apply? |
|---|---|---|---|---|
| 11 | `app/api/partner/rfps/[id]/response/route.ts:429` | **session** (`createClient()` from `@/lib/supabase/server`) | `route.ts:120` | **YES.** Every arm of `"Scoped insert notifications"` is evaluated. |
| 12 | `app/api/rfp/guest/[token]/route.ts:583` | **service role** (`getServiceSupabase()`) | `route.ts:379`, built at `:146-151` | **NO. Bypassed entirely.** A service-role client is not subject to RLS. |
| 13 | `app/api/rfp/guest/[token]/route.ts:768` | **service role**, the same client | `route.ts:379` | **NO. Bypassed entirely.** |

The guest route's own comment states the reason for the service role at `route.ts:150`:
*"Service role required throughout: guests have no authenticated session for RLS."*

**Consequence, stated plainly:** 12 and 13 are the two sites 095 unblocked outright. For them
the CHECK constraint was the *only* thing standing in the way, because no policy is consulted.
Site 11 has a second gate behind the constraint, and 1.6 is about that gate.

## 1.2 What `user_id` each one writes to - the question that decides whether it works

**READ.** **None of the three writes the value it passes.** All three pass an ORGANIZATION id
to `notifyBidSubmitted(supabase, leadOrgId, ...)` (`lib/notifications.ts:415`), which calls
`createOrgNotification`, which calls `resolveOrgMemberUserIds()` (`lib/notifications.ts:207`,
`:103-153`). That helper reads `org_members.user_id` for the organization **through the service
role** and returns a list of user ids. The row is built at `lib/notifications.ts:214`:

```
const row = (userId: string) => ({ user_id: userId, type, title, message, link, data })
```

So the value landing in `notifications.user_id` is a **USER id**, one row per member, at all
three sites. Traced to source:

| # | Value passed as `orgId` | Column | Is it a USER id or an ORG id? |
|---|---|---|---|
| 11 | `inbox.lead_org_id` | `partner_rfp_inbox.lead_org_id`, selected at `response/route.ts:148` | **ORG id.** FK repointed to `organizations(id)` by 079 PHASE 7 - the pair `('partner_rfp_inbox','lead_org_id')` is listed at `079_organizations.sql:861`. |
| 12 | `tokenRow.org_id` | `rfp_magic_tokens.org_id`, from `select("*")` at `guest/[token]/route.ts:392` | **ORG id.** Renamed from `agency_id` at `079:658`, FK'd to organizations at `079:874`, made NOT NULL at `079:982`. |
| 13 | `tokenRow.org_id` | same | **ORG id.** |

**So the sixteen-coincidence hazard is CLOSED for these three.** The failure mode the brief
names - sixteen accounts whose `organizations.id` equals their `profiles.id`, making an
org-id-into-`user_id` swap invisible in Greg's own testing - **cannot occur here**, because no
organization id reaches `user_id` at any of the three. Every one goes through the
`org_members` resolution first. That was not always true: `lib/notifications.ts:25-29` records
that sixteen call sites *did* pass an organization id straight into `notifications.user_id`
before the rewrite, and names exactly this coincidence as the reason it read as correct.

**One asymmetry, named because it is visible and is NOT a defect.** Sites 12 and 13 pass
`tokenRow.org_id as string` (`guest/[token]/route.ts:585`, `:768`), while the email path two
lines above each of them uses `orgIdFromColumn(tokenRow.org_id)` (`:542`, `:706`). The bare
cast skips the null/empty check that helper performs (`lib/entitlements.ts:244-246`). It
cannot produce a wrong recipient: `resolveOrgMemberUserIds` returns `[]` for a falsy `orgId`
(`lib/notifications.ts:107`) and `createOrgNotification` then writes nothing and logs. And it
cannot fire at all today, because `rfp_magic_tokens.org_id` is NOT NULL as of `079:982`.
**REASONED**, from the two files. Recorded, not fixed - it is not the phase's subject and it
changes no behaviour.

## 1.3 Are `title` and `link` set?

**READ**, `lib/notifications.ts:428-431`. **Yes, both, at all three sites**, from literals
inside `notifyBidSubmitted` - the call sites do not supply them and cannot omit them:

- `title`: `'Vendor Bid Updated'` when `isRevision`, otherwise `'New Vendor Bid'`. Never null,
  so the NOT NULL column with no default is satisfied. Site 12 passes `isRevision: true`, 13
  passes `false`, 11 passes `wasUpdate`.
- `link`: `'/agency/bids'`, a constant, on all three. **EXECUTED:** `ls app/agency/bids` →
  `page.tsx`. The route exists, so the row is clickable and lands somewhere real.
- `message` is also always set, and `data` carries `{ responseId, scopeItemName,
  vendorNameOrEmail, isRevision }`.

**One observation, not a defect.** The link is the same constant for all three, so a bid
notification opens the bids list and not the specific bid. `data.responseId` is populated and
would support a deep link if that is ever wanted. Site 12's `responseId` is
`tokenRow.response_id`, which cannot be null on that path: `guest/[token]/route.ts:419`
returns 400 `"No existing bid to edit"` when `is_edit` is true and `response_id` is falsy.

## 1.4 Does `createOrgNotification()` still swallow a failure?

**READ. Yes, and at two layers.**

1. **It does not throw.** `createOrgNotification` handles the Postgres error itself: batch
   insert, then a per-row retry, then - if every row was refused - `console.error(...)` and
   `return false` (`lib/notifications.ts:238-248`). No exception leaves the function.
2. **The return value is discarded at all three sites.** Every one is
   `await notifyBidSubmitted(...)` inside a `try/catch` that can only catch a *thrown* error
   (`response/route.ts:428-435`, `guest/[token]/route.ts:581-595`, `:767-773`). None assigns
   or tests the boolean.

**What Greg would see if one of these three fails after 095: nothing at all, in the product.**
The bid itself is unaffected - the notify block runs after the response row is saved, and a
refusal there cannot touch it. The vendor still gets their confirmation email, the agency still
gets the Resend bid email through the separate `sendTransactionalEmail` path above. The only
difference is that the in-app row is absent, and an absent row in a bell is indistinguishable
from a quiet week.

The single trace is a Vercel function log line:

```
[notifications] org notification insert failed for every recipient
  { site: 'notifyBidSubmitted', orgId, type: 'bid_submitted', recipientCount, code, message }
```

That is `lib/notifications.ts:239`. A partial refusal logs at `warn` instead
(`lib/notifications.ts:251`) and still returns `true`. **So: a log nobody reads, and the
partial case does not even log at error level.**

## 1.5 Does a colleague get one too?

**READ. One row per member of the lead organization, at all three sites.** Not one row to one
person. `createOrgNotification` maps the resolved member list to rows and inserts them
(`lib/notifications.ts:214-216`).

**That is intended**, and the ruling is stated at the top of the file
(`lib/notifications.ts:4-14`): *"WHO RECEIVES AN IN-APP NOTIFICATION UNDER THE ORGANIZATION
MODEL. RULED: EVERY MEMBER OF THE ORGANIZATION."* The reasoning given there is that
`notifications` is user-scoped in its own SELECT policy, so addressing one designated person
means the colleague who does the work never learns the bid arrived.

Whether the rows actually land differs by site, and this is where 094 matters:

- **12 and 13 (service role): every member's row lands.** No policy is consulted. Post-095
  these two should now work end to end.
- **11 (session client): every member's row faces `"Scoped insert notifications"`.** See 1.6.

## 1.6 THE DEFECT. Site 11 is refused for every recipient unless the partnership is `active`.

**Not fixed, per instruction. Stated with evidence so Greg can rule.**

**The claim.** A vendor submitting a bid through the portal writes a `bid_submitted`
notification to the *counterparty* organization - the agency. The live INSERT policy has three
arms (`094_notifications_colleague_scope.sql:333-337`, applied):

```sql
user_id = auth.uid()
OR user_id IN (SELECT public.current_user_org_member_user_ids())
OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())
```

For site 11 the caller is the vendor and every recipient is an agency user:

- **Arm 1 cannot match.** The recipient is never the caller.
- **Arm 2 cannot match.** `current_user_org_member_user_ids()` returns members of orgs the
  *caller* belongs to (`094:301-305`). The vendor does not belong to the agency's org.
- **Arm 3 is the only one that can match**, and it is **ACTIVE-partnership-only**:
  `current_user_active_counterparty_user_ids()` filters `AND p.status = 'active'`, twice
  (`079_organizations.sql:792` and `:798`).

**So when the partnership is not `active`, every row is refused, `createOrgNotification`
returns `false`, and nobody reads it.**

**Why this is the common case and not an edge case.** **READ**, four write sites:

| Where a partnership is created or activated | Status written |
|---|---|
| `lib/broadcast-partnership-cue.ts:211` - created *at broadcast time*, for a vendor being sent an RFP | `status: "pending"` |
| `app/api/partnerships/route.ts:558` | `status: 'pending'` |
| `app/api/partnerships/route.ts:665` | `status: 'pending'` |
| `app/api/partnerships/route.ts:1029` - acceptance | `status: 'active'` |

A vendor who is broadcast an RFP gets a **pending** partnership. Nothing makes it active until
the vendor accepts a partnership invitation, which is a separate act from bidding.

**And nothing in the bid path requires an active partnership.** `response/route.ts:158-174`
gates on `partnerCanAccessPartnerRfpInbox(...)`, which consults `vendor_org_id ∈ callerOrgIds`,
`recipient_email`, and the NDA gate. **Partnership status is not consulted anywhere in the
route.** So the bid is accepted and saved, and the notification about it is refused.

**REASONED**, and this is the part that needs a live query rather than my confidence: I have
established the policy predicate, the status values written, and that the bid path does not
require `active`. I have **not** established what proportion of real submitted bids sit against
a pending partnership. It could be zero in practice if every real vendor accepts first.

**The queries that settle it** (Greg runs these; I did not):

```sql
-- 1. Has ANY bid_submitted row ever landed since 095?
SELECT count(*), min(created_at), max(created_at)
FROM public.notifications WHERE type = 'bid_submitted';

-- 2. The portal path specifically. If this returns rows with status <> 'active',
--    those bids notified nobody.
SELECT p.status, count(*) AS submitted_bids
FROM public.partner_rfp_responses r
JOIN public.partnerships p
  ON p.lead_org_id = r.lead_org_id AND p.vendor_org_id = r.vendor_org_id
WHERE r.status = 'submitted' AND r.inbox_item_id IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;

-- 3. Portal bids with no partnership row at all - also refused, for the same reason.
SELECT count(*) FROM public.partner_rfp_responses r
WHERE r.status = 'submitted' AND r.inbox_item_id IS NOT NULL
  AND r.vendor_org_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.partnerships p
                  WHERE p.lead_org_id = r.lead_org_id AND p.vendor_org_id = r.vendor_org_id);
```

**This is not new and it is not 095's fault.** It is the counterparty arm that
`lib/notifications.ts:183-189` already names as still open, and OPEN-G in
`docs/refusals-and-notifications-report.md`. What is new is that 095 turned on the type, so
this gap is now the *only* thing between a portal bid and the agency's bell - and it fails
silently. Before 095 the same site failed on `23514` and it was equally silent.

**Deliberately not fixed here.** Widening arm 3 is an RLS decision on a different predicate,
and the brief rules it out for this phase. Two shapes exist if Greg wants one - route site 11
through the service role like 12 and 13, or widen the counterparty predicate beyond `active` -
and they have different blast radii. Neither belongs in a phase whose instruction is that a
wrong change here lands a notification with the wrong recipient and nobody sees it fail.

---

# Phase 2. Pagination. The twenty-first notification is now reachable.

Commit `d9b94df`.

**The STOP condition was not reached.** The brief said to stop and report if pagination
could not be added without restructuring how the layout fetches. It could. **READ**, both
mount points: `components/agency-layout.tsx:509` and `components/partner-layout.tsx:200`
each render `<NotificationBell variant="..." />` and nothing else - no props, no data, no
fetch. Neither layout was touched. The whole change is one route and one component.

## 2.1 The security statement, per arm

This adds a user-supplied parameter to a query, so this is stated before anything else.

### The `user_id` filter survives on every arm. Named one at a time.

| Arm | Line | Scoping | Changed? |
|---|---|---|---|
| GET, the list | `route.ts:122` | `.eq('user_id', user.id)` | **Survives.** The cursor is `.lte('created_at', ...)` ADDED to this same builder at `:144`, never a replacement for the filter and never a separate query. |
| GET, the unread count | `route.ts:172-173` | `.eq('user_id', user.id).eq('read', false)` | **Untouched.** Byte-identical to before. It does not receive the cursor. |
| PATCH, `markAllRead` | `route.ts:214-215` | `.eq('user_id', user.id).eq('read', false)` | **Untouched.** No parameter reaches PATCH. |
| PATCH, `notificationIds` | `route.ts:225-226` | `.eq('user_id', user.id).in('id', notificationIds)` | **Untouched.** The `.eq` is what stops a caller marking somebody else's row read by guessing an id. |

**There is no cursor path that skips the filter**, because there is no cursor path: there is
one query builder and the cursor is a conditional `.lte()` on it. RLS is a second wall
behind all four ("Users can view own notifications", `USING (user_id = auth.uid())`), not
the only one.

### The parameter is validated and bounded

- **`limit` was unbounded and is now capped.** It was
  `parseInt(searchParams.get('limit') || '20')` - no ceiling and no rejection, so
  `?limit=100000` was honoured verbatim and pulled every row the caller had. RLS meant it
  was never a cross-user disclosure, but it was an unbounded response funded by a query
  string. It is now `parseLimit()`: `/^\d+$/`, then a safe integer in `[1, 50]`, else
  **400**. `parseInt` is deliberately not used - it reads `"20abc"` as 20 and `"1e9"` as 1,
  which is coercion of a malformed parameter into a plausible one.
- **`cursor` is rejected, not coerced.** `parseCursor()` requires a strict ISO-8601 shape
  (`ISO_TIMESTAMP`, `route.ts:80`), length-capped at 40, plus a `Date.parse` sanity test to
  reject a shape-valid nonsense like month 99. Anything else is **400** naming the
  parameter. Absent or empty means no filter, which is the existing behaviour.

### Nothing user-supplied is interpolated into a query string

The cursor reaches PostgREST as an argument to `.lte('created_at', value)`, which
supabase-js URL-encodes as a parameter. **There is no `.or()` and no hand-built filter
expression anywhere in this route** - that is the one construction where a crafted value
could smuggle in an extra operator, and it is the reason a compound `(created_at, id)`
keyset was not used even though it would have been tidier. **REASONED**, from the
supabase-js call surface; no crafted-input test was executed against a live database.

**And the cursor is NOT round-tripped through `Date`, which would silently lose rows.**
Postgres stores `timestamptz` to microseconds and PostgREST serialises all six digits; a
JavaScript `Date` holds milliseconds. Normalising `...:07.123456+00:00` through `Date`
yields `...:07.123Z`, and `.lte` on that value excludes every row between the two,
including the boundary row itself. The regex validates the shape and the **original string**
is what is used.

### What an unauthenticated or cross-user request returns now

- **Unauthenticated: `401 {"error":"Unauthorized"}`.** Unchanged. `requireAuth()`
  (`lib/api-auth.ts:29-38`) runs before any parameter is parsed, so a malformed cursor from
  a signed-out caller gets 401 and not 400 - the validation is never reached.
- **Cross-user: there is no cross-user request to make.** The endpoint takes no user
  identifier of any kind. `user.id` comes from the session cookie via
  `supabase.auth.getUser()`. A caller can vary `limit` and `cursor` and nothing else, and
  neither names a row owner. Supplying a cursor taken from another account's notification
  returns **this** caller's rows older than that timestamp - a timestamp is not a
  capability, and the `.eq('user_id', user.id)` is what makes that true rather than the
  cursor's opacity.

## 2.2 What was built, and why cursor rather than offset

**(a) A cursor, added to the existing GET.** No new endpoint.

Rows arrive at the HEAD of this feed while the panel is open, and **an offset counts from
the head**: one notification arriving between page one and page two shifts every row down a
slot, so `offset=20` re-serves row 20 and the boundary drifts by exactly as many rows as
arrived. A `created_at` cursor is anchored to a row rather than to a position, so what
arrives above it cannot move it. That is the property the brief named and it is the reason.

**`lte`, not `lt`, and that is the whole tie-handling story.** `created_at` is not unique -
one request can write several rows to the same person inside one transaction and they share
a timestamp exactly. With `lt`, every row sharing the boundary timestamp that did not fit
on the previous page would be **stepped over and become unreachable**: the exact defect this
work exists to fix, reintroduced one row at a time and invisibly. With `lte` the boundary
row is served again and the client drops it by id. The cost of never skipping is one
duplicate per page.

A secondary `.order('id', { ascending: false })` was added so the tie group has a
reproducible order across two requests. It does not change which rows page one returns.

**(b) A button, not infinite scroll.** Infinite scroll fires requests off scroll position
inside a 380px box that exists on **every page of both portals** - trackpad momentum would
request two or three pages nobody asked for, multiplied across the portal. A button is one
request per deliberate click, cannot fire while the panel is closed, and is reachable from
a keyboard. It hides entirely when the feed is exhausted rather than sitting permanently
disabled, and a failed click says so rather than vanishing, because a vanishing button and
the end of the list look identical.

**(d) The existing SWR configuration is reused and no interval was added.** Page one is
still `useSWR` with no `refreshInterval` and no fetcher argument, inheriting SWRProvider's
`dedupingInterval: 30000` verbatim. **Further pages do not go through SWR at all** - they
are plain fetches held in local state. `useSWRInfinite` was the obvious alternative and was
rejected for this mount point: it re-requests EVERY loaded page on each revalidation, so
somebody who had clicked "Load more" four times would issue five requests per revalidation
on every page of the portal. That is the same multiplication the component's header comment
exists to prevent, arriving through a different door.

## 2.3 (c) The unread count did not change meaning, and it CAN disagree with the list

**The count is untouched.** Still `.eq('user_id').eq('read', false)` with `head: true` and
`count: 'exact'` - every unread row addressed to this user, no cursor, no limit. The badge
reads `data?.unreadCount`, never `rows.length`, and the component says so at the
declaration. Making the count agree with the loaded page would turn "34 unread" into "20
unread", which is a smaller number and a false one.

**They can disagree, and here is every way, stated rather than papered over:**

1. **The ordinary case, and it is not a bug.** The badge says 34 and the panel shows 20
   until "Load more" is clicked. The count describes the inbox; the list describes what has
   been fetched.
2. **The badge does not move when "Load more" is clicked.** The response carries a fresh
   `unreadCount` on cursor pages too - the shape is deliberately identical on every page -
   but the client reads the badge off page one only. So loading page three does not refresh
   the badge; the next page-one revalidation does.
3. **A notification arriving while the panel is open is in neither**, until page one
   revalidates. That is the pre-existing 30-second dedupe trade, unchanged by this work.
4. **After "Mark all read" they agree immediately.** The badge goes to zero and the loaded
   pages below page one are marked read locally - which is accurate, not optimistic,
   because the PATCH marked every unread row for this user and not only page one's.

## 2.4 The one bounded case where the pager stops early

If **more than 20 rows share an identical `created_at`** for one person, a cursor page can
consist entirely of rows already seen. The client stops when a page adds nothing new
(`notification-bell.tsx`, the `fresh.length > 0` guard) rather than looping on the same
rows for ever, so the tail below that timestamp becomes unreachable again.

Stopping was chosen over churning: a button that never finishes is worse than a button that
finishes early. **REASONED** - not observed. The settling query is in the OPEN table below.

---

# Phase 3. The seven agency selects. Six were genuinely broken.

Commit `eb97010`.

## 3.1 (a) The enumeration

**EXECUTED:** `grep -rn "<select" app/ components/ --include="*.tsx"` returns **25** sites
across the repository. Seven are in `app/agency/`. Each was then read with its surrounding
lines rather than judged from the grep line, because **the className sits up to nine lines
below the tag** on two of them - `app/agency/settings/profile/page.tsx:509` has an eight-line
`onChange` between the two. That is the tag-spanning lesson and it changes the answer here:
a grep for `<select.*bg-white/5` on one line finds **none** of the seven.

| # | File:line (tag) | Fill on the control | `<option>` children styled? | Genuinely broken? |
|---|---|---|---|---|
| 1 | `app/agency/page.tsx:1616` | `bg-white/5` | no | **YES** |
| 2 | `app/agency/settings/profile/page.tsx:509` | `bg-white/5` | no | **YES** |
| 3 | `app/agency/settings/profile/page.tsx:598` | `bg-white/5` | no | **YES** |
| 4 | `app/agency/settings/team/team-roster-client.tsx:503` | `bg-white/5` | **YES - `bg-background text-foreground`, from e3ae7d3** | **NO. Saved.** |
| 5 | `app/agency/msa/page.tsx:1148` | `bg-white/5` | no | **YES** |
| 6 | `app/agency/msa/page.tsx:1251` | `bg-white/5` | no | **YES** |
| 7 | `app/agency/msa/page.tsx:1750` | `bg-white/5` | no | **YES** |

All seven also carry `text-foreground`, which is `#FFFFFF` (`app/globals.css:18`).

## 3.2 (b) Why six are broken and one is not

**The mechanism.** Chromium derives the popup surface from the control's own
`background-color`. `bg-white/5` is `rgba(255,255,255,0.05)` - translucent, so it composites
over the browser's own popup surface. That surface is **white**, because it is a native
window and inherits nothing from the dark portal behind it. 5% white over white is white,
and `text-foreground` is `#FFFFFF` on top of it. This is the same defect e3ae7d3 fixed on a
native `<option>`, one level up.

**Nothing at the page level saves any of them. EXECUTED:**
`grep -rn "color-scheme\|colorScheme" app/ components/` over `.css`, `.ts` and `.tsx`
returns **nothing**, and `app/layout.tsx:79` sets only font variables on `<html>`. **There is
no `color-scheme` declaration anywhere in this repository**, so the document is in the
default light colour scheme and native popup surfaces stay light under the dark portal.
That is a broader finding than these seven controls and it is in the OPEN table.

**Number 4 is saved, and by something specific rather than by luck.** e3ae7d3 put
`bg-background text-foreground` on every `<option>` inside it. Each option row therefore
paints `#0C3535` opaque with white text regardless of what the popup behind it is doing.
The rows are legible even though the control's own fill is still translucent. It was left
alone: changing it would be churn on a control that is already correct, and it is the
worked example of the brief's warning not to assume all seven are the same.

**Honesty about the limit of this.** I established the classes, the token values, the
absence of `color-scheme`, and the precedent. **I could not execute Chromium on Windows**,
so whether Chromium composites the translucent fill onto white or falls back to an opaque
white is a browser-internals detail I did not verify. It does not change the fix: the
control is unreadable under the first behaviour and unchanged under the second, and
`bg-background` is correct under both. **REASONED**, and flagged as reasoned.

## 3.3 (c) The fix

`client-selector.tsx:199`'s pattern: `bg-background` (`#0C3535`, a flat opaque hex) with the
existing border and text classes. Applied to 1, 2, 3, 5, 6, 7. Nothing else on any of the
six changed - not the border, the size, the padding, the focus ring, or the text colour.

Option-level styling was **not** added to the six. It would be belt and braces, and
e3ae7d3 set that precedent, but the brief named `client-selector.tsx:199`'s pattern and
that pattern styles the control, not the options. Recorded rather than quietly widened.

## 3.4 (d) What changes visually on macOS, stated before Greg looks

**He is checking for a regression on a platform where the defect is invisible.** So:

**The open popup does not change on macOS. At all.** macOS Chrome and Safari route select
popups through native AppKit menus and discard author background and colour, which is
exactly why this shipped looking correct - it is the same reason e3ae7d3's commit message
gives for the `<option>` case. There is nothing to see there and nothing to check.

**The closed control changes, on all six, and only its fill.** From `bg-white/5` composited
over the surface behind it, to a flat `#0C3535`:

| | Before | After |
|---|---|---|
| Computed fill over the portal background | approx `#183F3F` | `#0C3535` |
| Contrast with the white label text | approx **11.5:1** | approx **13.3:1** |

So each control goes **slightly darker and slightly flatter** - it loses the faint lift that
made it read as raised off the panel. Text, border, height, padding and focus behaviour are
identical. Contrast goes **up**, not down; both values are far above AA either way.
**REASONED** - the ratios are computed from the token hex values, not measured in a browser.

**One consequence he will see and should not read as a bug.** In the three `app/agency/msa`
rows the select sits in a row of sibling `<input>` controls that keep `bg-white/5`
(`msa/page.tsx:1104`, `:1115`, `:1127`, `:1138` in the cash flow row, and `:1720`-`:1786` in the milestone row). **The select is now
visibly darker than the inputs beside it.** That is a real inconsistency and it is
deliberate: making the inputs match would be widening the change from seven select controls
to an unbounded set of form fields, which the brief did not ask for. It is in the OPEN
table as a decision, not left to be discovered.

---

# Phase 4. The six rulings, made answerable. None answered.

Commit `00b3593`. `docs/emitter-rulings-owed.md`.

Each ruling now carries, per option: the line the feed would render, **who would see it**,
**whether a counterparty could see it**, and what the payload rule permits it to carry.
**No option is recommended, ordered by preference, or marked as a default**, and the file
states that its widest-to-narrowest ordering is by scope and nothing else. **None of the six
is implemented.**

The expansion is built on three gates, read from the live migrations and stated once at the
top so each ruling does not restate them:

1. **The write gate** - `088:169-173` for vendor-side, `080:373` for agency-side.
   `recordMilestone()` swallows a refusal, so a row that fails here is lost in silence.
2. **The counterparty read gate** - `080:350-362`. Needs a non-null `partnership_id` AND
   membership of `vendor_visible_event_types()`, a **closed** array (`080:161-197`).
3. **The render gate** - `MILESTONE_PREDICATES` (`lib/activity-feed.ts:380-409`). A type
   absent renders no line at all.

**The consequence that changes several of the rulings**, and it was not visible in the
one-sentence form: **"should this emit" and "should the vendor see it" are two separate
decisions**, the second being a migration. None of the seven types is on the whitelist, so
emitting defaults to agency-only. Several rulings that read as binary therefore have a
third position, and it is now written out.

Three of the six narrow on facts rather than on taste, and the file says which:

- **`client.edit` and `rfp.generate` carry a null `partnership_id`** - a client record and
  an unbroadcast RFP have no vendor - so **gate 2 fails on its first clause** and no
  counterparty can read them whatever the whitelist says. Both rulings are entirely about
  the agency's own feed volume.
- **The no-partnership vendor fails at the WRITE gate, not the read gate.** Its five types
  are already whitelisted. So **both feeds already lose those rows today**, silently, and
  the ruling is not about disclosure at all.

**`bid.analyze` is the one with a live payload edge**, and it is the `recipient_count`
shape: `bid_comparisons` is keyed on `org_id` plus a hash of a **set** of response ids
(migration 064), so any payload field drawn from a comparison - a rank, a relative score, a
set size, a spread - describes the competitive field. That is stated under the option it
belongs to, without a verdict on the option.

One structural thing was surfaced because rulings 1 and 2 cannot avoid it: `vendorOf()`
resolves `counterpartyName`, which on the **vendor's** feed is the agency
(`lib/activity-feed.ts:335`, `:417`). A predicate whose subject is a vendor has no name to
put in that slot when the vendor reads it. The vendor feed does not exist yet, so this is a
decision owed rather than a live defect.

---

# Phase 5. Gates, compared to the Phase 0 baseline

**EXECUTED**, all six, at `00b3593`, and compared to the Phase 0 numbers - not to any
number in any document.

| Gate | Phase 0 baseline | Phase 5 | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | **exit 0** | **None.** |
| `pnpm build` | exit 0, 173 route lines | **exit 0, 173 route lines** | **None.** Compile time 9.6s to 8.5s, which is machine noise and not a signal. |
| `pnpm lint` | exit 1, 182 problems (154 errors, 28 warnings) | **exit 1, 182 problems (154 errors, 28 warnings)** | **None.** |
| `pnpm identity-columns:guard` | PASSED, 387 files, TOTAL 0 | **PASSED, 387 files, TOTAL 0** | **None.** |
| `pnpm org-id-reads:guard` | PASSED, Class B OPEN 60, REGRESSIONS 0, IMPROVED 1, 14 Class A | **PASSED, Class B OPEN 60, REGRESSIONS 0, IMPROVED 1, 14 Class A** | **None.** |
| `pnpm embed-targets` | 387 files, 30 pairs, TOTAL 0 | **387 files, 30 pairs, TOTAL 0** | **None.** |

**Every movement in either direction: there are none.** Six gates, six identical results.

**Lint was checked harder than the headline, because two files changed and a count can hold
still while its contents move.** **EXECUTED:** the sorted set of `line:col` diagnostic lines
from the baseline run and the final run were diffed and are **identical**. Neither
`components/notification-bell.tsx` nor `app/api/notifications/route.ts` appears in either
run's output.

**One warning was introduced during Phase 2 and removed before the commit**, recorded so the
183 in the intermediate scratch file is not a mystery: hoisting the page-one array to
component scope tripped `react-hooks/exhaustive-deps` ("could make the dependencies of
useMemo change on every render"). It was fixed by building the array inside the memo
callback, which is also the correct thing on its own terms. Lint returned to 182.

**The `IMPROVED 1` line on the org-id-reads guard is pre-existing.** `lib/entitlements.ts`
records 1 in `KNOWN_OPEN_MIRROR` and finds 0. It was there at Phase 0, before this session
touched anything. **I did not edit the allow-list or the count**, per the hard prohibition.
It is in the OPEN table.

**`pnpm verify-rls` and `pnpm policy-audit:guard` were not run**, at either end, per
instruction: neither reads a `.ts` file.

**No migration was authored, applied, or modified this session.** Nothing numbered 095 or
lower was touched. **EXECUTED:** `git diff --stat a6c7e73..HEAD -- supabase/` returns
nothing.

---

# OPEN items, each with the query or check that settles it

| ID | Item | What settles it |
|---|---|---|
| **OPEN-BELL-1** | **The Phase 1 defect.** Site 11 (`response/route.ts:429`) writes to the counterparty org, so only arm 3 of the 094 policy can match, and that helper is ACTIVE-partnership-only. Broadcast creates partnerships `pending`. Every recipient is then refused, silently. **Not fixed.** | The three SQL queries in §1.6. Start with `SELECT count(*) FROM public.notifications WHERE type = 'bid_submitted';` - if that is zero some days after 095, the emit path is not completing. |
| **OPEN-BELL-2** | Guest sites 12 and 13 pass `tokenRow.org_id as string` where the email path two lines above uses `orgIdFromColumn(...)`. Cannot fire today - the column is NOT NULL since `079:982` - and cannot produce a wrong recipient. Cosmetic asymmetry. | `SELECT count(*) FROM public.rfp_magic_tokens WHERE org_id IS NULL;` Expected 0. |
| **OPEN-BELL-3** | The unread badge and the loaded list can disagree, **by design**. Four ways, enumerated in §2.3. Nothing to fix; a decision about whether that is the wanted behaviour. | Open the bell on an account with more than 20 unread. Badge shows the true total, panel shows 20. `SELECT count(*) FROM public.notifications WHERE user_id = '<uid>' AND read = false;` should equal the badge. |
| **OPEN-BELL-4** | More than 20 notifications sharing one `created_at` for one person stops the pager early (§2.4). Bounded and deliberate; the tail below that timestamp becomes unreachable again. | `SELECT user_id, created_at, count(*) FROM public.notifications GROUP BY 1,2 HAVING count(*) > 20 ORDER BY 3 DESC;` Expected: no rows. |
| **OPEN-BELL-5** | **No `color-scheme` declaration exists anywhere in the repository**, so every native control in both portals renders its popups and widgets on light system surfaces under a dark UI. Broader than the seven selects: date inputs, scrollbars and every other native widget sit in the same position. Not addressed - it is a global change to both portals including the light-theme `/partner/discover`. | `grep -rn "color-scheme" app/ components/`. Expected: nothing, today. Deciding it needs a look at every native control in both portals on Windows. |
| **OPEN-BELL-6** | The three `app/agency/msa` selects are now visibly darker than the sibling `<input>` controls in the same row, which keep `bg-white/5`. Deliberate; widening to the inputs was out of scope. | Look at the cash flow and milestone rows on `/agency/msa` on any platform. Decide whether the inputs should follow. |
| **OPEN-BELL-7** | `pnpm org-id-reads:guard` reports `lib/entitlements.ts recorded 1, found 0` as IMPROVED. **Pre-existing at Phase 0.** Not edited, per the prohibition on touching a guard allow-list or KNOWN_OPEN count. | Lower the count for that one entry in `KNOWN_OPEN_MIRROR` in `scripts/check-org-id-reads.mjs`, or delete the entry. Greg's call, since it is an allow-list edit. |
| **OPEN-BELL-8** | All three `bid_submitted` notifications link to the constant `/agency/bids`, not to the specific bid. `data.responseId` is populated and would support a deep link. Not a defect - the page exists and the row is clickable. | Product decision. `SELECT DISTINCT link FROM public.notifications WHERE type = 'bid_submitted';` Expected: one value, `/agency/bids`. |

---

# Browser checklist, ordered by risk

**Step 1 is first because the bell is in BOTH root layouts** - a failure there is not one
screen, it is every authenticated page in both portals at once.

Each step says whether a failure means **REVERT** or **DEBUG**. A revert is
`git revert <sha>`; the four commits are independent and any one can go back alone.

### 1. The bell renders, in BOTH portals - `d9b94df`. **REVERT, do not debug.**
Sign in as the agency (`gmarkant@gmail.com`) and load `/agency/dashboard`. Then sign in as
the vendor (`gmarkant@icloud.com`) and load `/partner/rfps`. The bell icon must be present
in the header in both, and the page must render normally around it.
**If either portal fails to render, or the bell throws: revert `d9b94df` immediately.** This
component is in both root layouts and there is no partial failure mode worth diagnosing
live.

### 2. The panel opens and lists rows, both portals - `d9b94df`. **REVERT.**
Click the bell in each portal. Expect either a list of notifications, or "Nothing here yet"
if the account has none - **never** "could not be loaded", and never an empty panel with no
message. A load failure here means the GET is rejecting a request the component is making,
which is the parameter validation, and it affects every page.

### 3. The badge shows the full unread count - `d9b94df`. **DEBUG.**
Compare the badge to
`SELECT count(*) FROM public.notifications WHERE user_id = '<uid>' AND read = false;`. They
must match. Above 9 the badge renders "9+" by design. A wrong count is a display bug on one
control, not a portal-wide failure - it can be diagnosed in place.

### 4. "Load more" appears, works, and terminates - `d9b94df`. **DEBUG.**
Needs an account with more than 20 notifications. The button appears under the list; each
click appends older rows; **no row appears twice**; the button disappears at the end of the
feed rather than sitting disabled or looping. If there is no such account yet this step
cannot be run - say so rather than passing it.

### 5. "Mark all read" still works - `d9b94df`. **DEBUG.**
With unread rows, click it. The badge goes to zero, every row loses its unread tint -
**including rows loaded by "Load more"**, which is the one behaviour added to this control.

### 6. The six selects, on macOS - `eb97010`. **DEBUG.**
`/agency` (brief source), `/agency/settings/profile` (discipline, payment terms),
`/agency/msa` (cash flow status, cash flow edit, milestone scope). **Expect the closed
control to be slightly darker and flatter than before, and the open popup to be identical**
- see §3.4. On the msa rows the select will look darker than the inputs beside it; that is
OPEN-BELL-6, not a regression. Only a change to the popup, the text, the border or the
control's size is a regression here.

### 7. The invite role select is unchanged - `eb97010`. **DEBUG.**
`/agency/settings/team`. This is number 4, the one deliberately **not** touched. It must
look exactly as it did before this session. Any change means the wrong control was edited.

### 8. Nothing else on the three touched pages moved - `eb97010`. **DEBUG.**
`/agency`, `/agency/settings/profile`, `/agency/msa` render as before. Only six className
fills changed, so anything else moving is unexpected.

**Not on this checklist, deliberately: the Phase 1 defect.** It cannot be checked in a
browser - a refused notification and a quiet week look identical from the outside, which is
the point of §1.6. It is settled by the SQL in OPEN-BELL-1, not by clicking.

---

# EXECUTED / READ / REASONED

**EXECUTED.** The six gates at Phase 0 and again at Phase 5, with output compared. The lint
diagnostic sets diffed line by line. `grep -rn "<select" app/ components/` (25 sites).
`grep -rn "color-scheme\|colorScheme"` (nothing). `ls app/agency/bids` (exists).
`grep -rl "\](http://"` after every phase (clean). `git diff --stat a6c7e73..HEAD --
supabase/` (empty). Four commits.

**READ.** `lib/notifications.ts` in full. All three `bid_submitted` emit sites with their
client construction. `app/api/notifications/route.ts` and `components/notification-bell.tsx`
in full. Both layout mount points. `079_organizations.sql` PHASE 7 and the counterparty
helper. `094_notifications_colleague_scope.sql` policy body. `080_milestone_events.sql`
whitelist and both SELECT policies. `088_vendor_milestone_events.sql` §5 residual.
`lib/activity-feed.ts` header and predicates. `lib/broadcast-partnership-cue.ts` and the
`partnerships` status writes. All seven selects with their `<option>` children.
`app/globals.css` tokens. `e3ae7d3` in full.

**REASONED, and flagged as such where it appears.** That site 11's refusal is the common
case rather than an edge - the policy predicate and the `pending` writes are read, the
proportion of real bids affected is not, and that is what OPEN-BELL-1's queries are for.
That Chromium composites a translucent select fill onto its white popup surface - the
precedent and the tokens are read, Chromium on Windows was not run. The macOS contrast
ratios, computed from token hex values rather than measured. That no crafted cursor can
smuggle an operator through `.lte()` - reasoned from the supabase-js call surface, not
tested against a live database.

**NOT DONE, AND NOT POSSIBLE HERE.** Nothing was verified against the live database. No
migration was applied, authored, or modified. Nothing was pushed.
