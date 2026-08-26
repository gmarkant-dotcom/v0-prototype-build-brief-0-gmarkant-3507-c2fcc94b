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
| 11 | `app/api/partner/rfps/[id]/response/route.ts:429` | **session** (`createClient()` from `@/lib/supabase/server`) | `route.ts:119` | **YES.** Every arm of `"Scoped insert notifications"` is evaluated. |
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
| 12 | `tokenRow.org_id` | `rfp_magic_tokens.org_id`, from `select("*")` at `guest/[token]/route.ts:391` | **ORG id.** Renamed from `agency_id` at `079:658`, FK'd to organizations at `079:874`, made NOT NULL at `079:982`. |
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
`tokenRow.response_id`, which cannot be null on that path: `guest/[token]/route.ts:417`
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

**And nothing in the bid path requires an active partnership.** `response/route.ts:157-172`
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
