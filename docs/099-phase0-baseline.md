# 099 - Phase 0 baseline for the RFP closure run

Recorded before any file in this session was edited, on branch `feat/rfp-closure` cut from
`8976955 docs: every date in the findings file is 2026-09-14`, working tree clean.

The branch had **zero commits of its own** when every command in section 1 ran, so the tree
those numbers describe is byte-for-byte `main`. That is stated instead of a throwaway
worktree because it is the same fact with one less moving part: `git status` was clean and
`git rev-parse HEAD` equalled `main`.

Everything outside section 1 was **READ FROM SOURCE**. No database was queried. This session
has no working credentials and is prohibited from seeking them; every question that needs a
row count is written into section 9 as a checklist item for Greg, not guessed at.

---

## 1. The gates, as measured. EXECUTED.

| # | Command | Exit | Measured |
|---|---------|------|----------|
| 1 | `npx tsc --noEmit` | **0** | zero diagnostic lines |
| 2 | `pnpm build` | **0** | compiled in 9.3s, 72/72 static pages, 174 route lines |
| 3 | `pnpm lint` | **1** | **182 problems (154 errors, 28 warnings)** |
| 4 | `pnpm identity-columns:guard` | **0** | TOTAL 0 in 0 files, GUARD PASSED |
| 5 | `pnpm org-id-reads:guard` | **0** | class A 14 / class B 60, no growth, GUARD PASSED |
| 6 | `pnpm embed-targets --guard` | **0** | REPOINTED 0, PERSON 0, TOTAL 0 |
| 7 | `pnpm policy-audit:guard` | **1** | pre-existing - reads a static snapshot |
| 8 | `pnpm verify-rls` | **2** | pre-existing - PostgREST does not expose `pg_class` here |

Gates 3, 7 and 8 fail on `main`. **That is this tree.** The numbers to hold at Phase 6 are
**182 / 154 / 28** for lint, and exits 1 and 2 for the two database-reading scripts.

---

## 2. (0a) IS `partner_rfp_inbox.status` CONSTRAINED?

### THE ANSWER: **YES. `partner_rfp_inbox_status_check`, nine values, and it does NOT permit `closed` or `not_selected`.**

### Migration 099 MUST widen it or every closure write fails 23514.

The constraint has been dropped and re-added twice. The **latest on-disk definition** is the
one to widen:

```
scripts/019-bid-status-meeting-requested.sql:10-27
  ALTER TABLE public.partner_rfp_inbox
    DROP CONSTRAINT IF EXISTS partner_rfp_inbox_status_check;
  ALTER TABLE public.partner_rfp_inbox
    ADD CONSTRAINT partner_rfp_inbox_status_check
    CHECK (status IN ('new','viewed','bid_submitted','feedback_received',
                      'revision_submitted','shortlisted','meeting_requested',
                      'awarded','declined'));
```

Its two predecessors, for the record:

| Where | Values | Note |
|---|---|---|
| `scripts/013-partner-rfp-inbox.sql:19` | 7 - inline on `CREATE TABLE`, no `revision_submitted`, no `meeting_requested` | the original |
| `scripts/018-bid-status-and-feedback.sql:19-21` | 8 - adds `revision_submitted` | superseded |
| `scripts/019-bid-status-meeting-requested.sql:13-27` | **9** - adds `meeting_requested` | **the current on-disk truth** |

### How this was established, and the one thing it does NOT prove

Grep across every `.sql` file in `supabase/migrations/` and `scripts/` for the table name
crossed with `CHECK` / `CONSTRAINT`. Five hits, all quoted above. Nothing in `079` through
`098` touches this constraint - `079_organizations.sql` renames two of the table's COLUMNS
(`:666-667`) and rewrites its POLICIES (`:1341-1371`) and leaves the CHECK alone.

**What this cannot prove:** that the live constraint matches the file. `LIGAMENT_CONTEXT.md`
is explicit that the on-disk history cannot reproduce the live database and that several live
policies exist under names appearing nowhere in this repository. So migration 099 is written
`DROP CONSTRAINT IF EXISTS ... , ADD CONSTRAINT ...` in one `ALTER TABLE`, exactly as 095 did
for `notifications_type_check`, which makes the file correct whether the live definition is
seven values, eight, nine, or absent. **Query Q1 in section 9 settles it before anything runs.**

### THE FULL STATUS VOCABULARY IN USE ACROSS APP CODE

Not just `RESPONDED_STATUSES`. Four vocabularies overlap on this one column and they are not
the same set.

**(A) The nine the database permits** - `scripts/019:16-26`:
`new` `viewed` `bid_submitted` `feedback_received` `revision_submitted` `shortlisted`
`meeting_requested` `awarded` `declined`

**(B) The twelve `lib/bid-status.ts:1-13` declares as `BidStatus`** - a UNION OF TWO TABLES'
vocabularies, which is why it is bigger than (A):
the nine above, plus `submitted` `under_review` `draft`, which are
`partner_rfp_responses.status` values (`scripts/019:8`) and are never written to the inbox.

**(C) The nine `RESPONDED_STATUSES`** - `app/api/partner/dashboard/route.ts:20-30`:
`submitted` `bid_submitted` `revision_submitted` `under_review` `feedback_received`
`shortlisted` `meeting_requested` `awarded` `declined`.
Note this set is tested against an **effective** status that may have come from either table
(`:243`), which is why it mixes both vocabularies. `new` and `viewed` are deliberately absent -
they are what "still needs your action" means.

**(D) One SYNTHETIC status that is in no table at all**: `awaiting_response`, minted at
`app/api/agency/rfp-responses/route.ts:461` for an inbox row that has no response yet, and
carried through `lib/bid-shared.ts:93` and `:105`. It reaches the agency UI as the badge
"New". It is never written to the database. **It matters to this run because it is hardcoded
and ignores the inbox row's real status** - see finding 0b-9.

Two values this run adds, `closed` and `not_selected`, are in none of the four.

---

## 3. (0b) WHAT READS `status`, AND WHAT DOES IT DO WITH AN UNKNOWN VALUE?

### THE ANSWER: **TWELVE SITES. NINE FALL THROUGH SILENTLY. TWO OF THEM RENDER A CLOSED RFP AS "New".**

Not one site raises, logs or renders an error on an unknown status. Every default branch in
this product resolves an unrecognised status to the string "New". A closed RFP would land in
the database correctly and read to a vendor as a brand new opportunity.

**Legend.** `TODAY` is what the site does when it meets `closed` or `not_selected` with no
other change. `VERDICT` is what Phase 3/4/5 must do about it.

| # | Site | TODAY with `closed` / `not_selected` | VERDICT |
|---|------|--------------------------------------|---------|
| 1 | `app/api/partner/dashboard/route.ts:20-30` + `:243-244` `RESPONDED_STATUSES.has(effectiveStatus)` | **NOT in the set, so `continue` is not taken and the row STAYS in "Needs your response".** Closure would change nothing on the surface this whole run exists to drain. | **BLOCKER. Must fix.** Both values join the set, or a separate exclusion runs first. |
| 2 | `components/partner-rfp-surface.tsx:106-108` `badge()` | `STATUS_BADGE['closed']` is `undefined`, `?? STATUS_BADGE.new` → **renders the pill "New" in gray.** | **BLOCKER. Must fix.** Add both to `STATUS_BADGE`, or exclude the rows. |
| 3 | `components/partner-rfp-surface.tsx:99-104` `normaliseForTab()` | Returns `'closed' as RFPStatusKey` - a cast that lies to the type checker, since `RFPStatusKey` has no such member and `tsc` cannot catch it. Matches no tab in `RFP_STATUSES` (`:64-73`), so the row is counted into `counts['closed']`, **which no tab reads and no user can select**, while still rendering under "All RFPs". | **BLOCKER. Must fix.** |
| 4 | `components/partner-rfp-surface.tsx:517` (groupBy `status`) `RFP_STATUSES.find(...)?.label ?? "New"` | Group heading reads **"New"**. A closed RFP is filed under New in a status grouping. | **BLOCKER. Must fix.** |
| 5 | `app/api/partner/rfps/route.ts:332-339` `effectiveStatus` → `effective_status` on the wire | No filter of any kind on this route (`:231-234` selects `*` with only an `ORDER BY`). **The row is returned to `/partner/rfps` and rendered.** This is what feeds sites 2, 3 and 4. | **BLOCKER. Must fix** - this is the routing decision Phase 5 makes. |
| 6 | `app/api/agency/rfp-responses/route.ts:442-467` `awaitingRows` | Hardcodes `status: "awaiting_response"` and **never reads `i.status`**. So on `/agency/bids` a closed or not_selected row still reads **"New"** - to the agency that closed it. | **BLOCKER. Must fix.** The agency must see its own action. |
| 7 | `lib/bid-shared.ts:116-118` `statusBadge()` | `?? STATUS_BADGE.awaiting_response` → **"New"**. | Fixed by #6, plus badge entries. |
| 8 | `lib/bid-status.ts:30-57` `getBidStatusLabel(s, "partner")` | `default: return "New"`. | Must fix if reached; add both cases. |
| 9 | `lib/bid-status.ts:80-98` `getBidStatusColor()` | `default:` gray. Cosmetic only. | Low risk; fix with #8. |
| 10 | `app/api/partner/rfps/[id]/intent/route.ts:60-75` `blockedStatuses = {bid_submitted, submitted, awarded, declined}` | **NOT blocked.** A vendor can still file a "will respond" / "requesting call" intent signal against an RFP that has been closed. | **Must fix.** Both values join `blockedStatuses`. |
| 11 | `app/api/partner/rfps/[id]/response/route.ts:148-200` | **The route never reads `inbox.status` at all.** It gates on NDA access (`:158-173`) and on `close_bidding_at_deadline` (`:190-195`) and nothing else. **A vendor can POST a bid on a closed RFP and the route accepts it**, then overwrites the status to `bid_submitted` at `:330-331`. The client hides the form (#12) but the route is the trust boundary and it has no guard. | **Must fix.** Server-side refusal. |
| 12 | `app/partner/rfps/[id]/page.tsx:1186-1192` and `:1355-1360` `canEdit` allow-list | `closed` is **not** in the allow-list, so `canEdit` is `false` and the bid form hides. **Correct by accident** - it is an allow-list, so it fails closed. | No change needed. Record it as the one site that already behaves. |

**Two sites that are writes, not reads, and matter anyway:**

- `lib/bid-status.ts:22-28` `mapResponseStatusToInboxStatus()` returns `bid_submitted` for
  anything it does not recognise. It is called by the agency PATCH
  (`app/api/agency/rfp-responses/[id]/route.ts:764`) and by the magic-link attach
  (`lib/magic-token-attach.ts:342`, `:389`). **Neither can produce `closed` or
  `not_selected`, and both can OVERWRITE one.** An agency that closes an RFP and then acts
  on a bid for the same row would silently un-close it. Phase 3 must not route closure
  through this function, and Phase 3's write must be ordered so this cannot race it.
- `lib/magic-token-attach.ts:386-395` self-heals `status` onto a surviving row from
  `derivedStatus`. Same overwrite risk on the magic-link path.

**Phase 3 does not ship until rows 1-11 above are resolved.** They are resolved in Phase 3
(6, 10, 11), Phase 4 (8, 9) and Phase 5 (1, 2, 3, 4, 5, 7).

---

## 4. (0c) THE NOTIFICATION TYPE CHECK

### Constraint name: **`notifications_type_check`**, on `public.notifications`.

Last written by `supabase/migrations/095_notification_types.sql:312-331`, widened from eight
values to **eleven**. 096 did not touch it (096 altered the `"Scoped insert notifications"`
POLICY only, at `:378-385`). The eleven, in the file's own order:

```
partnership_invitation   partnership_accepted   project_assignment
project_accepted         project_declined       new_message
document_uploaded        project_awarded        partnership_declined
onboarding_deployed      bid_submitted
```

They are `lib/notifications.ts:265-276`'s `NotificationType` union exactly. 095's own comment
on the constraint says it plainly: *"Keep this list and that union identical: nothing checks
that they agree, and a mismatch fails silently at runtime."*

**So 099 must widen this constraint a second time, and must edit the union in the same
commit.** Two new values are needed.

### THE NAMING CONVENTION 095 ESTABLISHED, stated so the two new names can be checked against it

Every one of the eleven is `<subject>_<past-tense outcome>`, lower snake case, subject first
and singular, and the subject is the **domain noun the event happened to** - not the actor,
not the surface. `partnership_accepted`, `project_awarded`, `onboarding_deployed`,
`bid_submitted`. The three exceptions prove it rather than break it: `partnership_invitation`
and `project_assignment` name the artifact created, and `new_message` is the one adjective-led
value and the oldest.

**The two names this run adds, following that convention:**

| Name | Subject | Outcome | Reads as |
|---|---|---|---|
| `rfp_closed` | the RFP | closed | the opportunity ended, for everyone |
| `rfp_not_selected` | the RFP | not selected | this vendor was not chosen |

`rfp` is a new subject in the union, and it is the correct one: neither event is about a bid
(there is none), a partnership, or a project. R7's whole point is that these are two different
messages, so they are two types, not one with a payload flag - a bell cannot branch on a
payload it does not read.

---

## 5. (0d) WHERE DOES VENDOR HISTORY LIVE NOW?

### THE ANSWER: **NOWHERE. There is no surface today that can carry a closed-but-never-answered request. Phase 5 has to build one.**

This is the biggest unknown in the run and it resolves against the product, not against a
guess.

**What exists, precisely:**

| Surface | File | Reads | Filters on |
|---|---|---|---|
| `/partner/rfps` - "Open RFPs" | `app/partner/rfps/page.tsx` → `PartnerRfpSurface surface="rfps"` | `partner_rfp_inbox` via `/api/partner/rfps` | **NOTHING.** No status filter anywhere. Client-side search and group-by only. |
| `/partner/bids` - "My Bids" | `app/partner/bids/page.tsx` → `PartnerRfpSurface surface="bids"` | `partner_rfp_responses` via `/api/partner/rfps/bids` | `!TERMINAL_BID_STATUSES.has(b.status)`, i.e. not `awarded`/`declined` (`components/partner-rfp-surface.tsx:60`, `:500`) |
| `/partner/bids` - "History" tab | same component, `activeTab === "history"` | `partner_rfp_responses`, same fetch | **nothing** - it is `allBids` where My Bids is `allBids` filtered (`:499-500`) |

The tab strip renders only when `surface === "bids"` (`:588`). Stage 01 has no tabs.

### WOULD A CLOSED INBOX ROW WITH NO BID RENDER ANYWHERE TODAY?

**It renders in exactly one place, and it is the wrong one.** It appears on
`/partner/rfps` - "Open RFPs" - because that route applies no status filter at all, and it
appears there **labelled "New"** (finding 0b-2). It cannot appear in History, because History
reads `partner_rfp_responses` and a vendor who never bid has no row in that table. There is no
join, no union, and no second fetch.

### THE COMPONENT SAYS SO ITSELF

This is not inference. `components/partner-rfp-surface.tsx:582-583`, in the comment that
justifies where History went:

> *"3. WHAT IT ANSWERS. "Did I win?" is a question about a bid. An RFP whose deadline passed
> without a bid never becomes history here at all - it stays an inbox row."*

That sentence was written to explain a design decision. It is also an exact statement of the
gap R7 opens: R7 requires that a vendor can still see a request was once made of them, and the
only surface that could show it is scoped to a table that row is not in.

### CONSEQUENCE FOR SEQUENCING, AND IT IS THE REASON PHASE 5 IS NOT OPTIONAL IF PHASES 3-4 SHIP

If Phase 3 ships without Phase 5, closing an RFP moves the row from "labelled New on
/partner/rfps and counted in Needs your response" to "labelled New on /partner/rfps and
counted in Needs your response" - i.e. nothing visible changes for the vendor except an email
telling them something happened that their portal does not show. That is worse than not
shipping. **Phases 3 and 4 must not merge without at least the filtering half of Phase 5.**
This is recorded here, before any code, so it cannot be discovered late.

---

## 6. (0e) HOW NOTIFICATIONS ARE EMITTED

**The insert path.** `lib/notifications.ts`. Two entry points:

- `createOrgNotification({supabase, orgId, type, title, message, link, data, site})`
  (`:197-263`) - resolves every `org_members.user_id` for the org and writes **one row per
  member**. A batch insert first; on any failure it retries one row at a time so a mixed
  batch delivers what is permitted rather than discarding everything (`:230-246`). Returns
  `false` and logs `"org notification insert failed for every recipient"` when nothing lands.
- `createNotification({supabase, userId, ...})` (`:288-...`) - one row, one user.

**The RLS policy governing it.** `"Scoped insert notifications"` on `public.notifications`,
INSERT, `WITH CHECK` only. Four arms as of 096 (`096_bid_notification_scope.sql:378-385`):

```
user_id = auth.uid()
OR user_id IN (SELECT public.current_user_org_member_user_ids())           -- 094
OR user_id IN (SELECT public.current_user_active_counterparty_user_ids())  -- 079
OR user_id IN (SELECT public.current_user_commercial_counterparty_user_ids()) -- 096
```

### WHAT A NEW TYPE HAS TO SATISFY TO REACH A VENDOR

Two independent gates, and they fail in different ways:

1. **The CHECK constraint.** `notifications_type_check` must permit the type. It is not RLS
   and **the service role does not bypass it** - 095's header is emphatic about this, because
   two service-role write sites had been failing 23514 for months while everyone reasoned
   "service role, therefore fine". Failure mode: 23514, caught, logged, HTTP 200.
2. **The fourth policy arm.** An agency writing to a vendor lands on
   `current_user_commercial_counterparty_user_ids()`, whose body
   (`096:302-327`) requires a `partnerships` row joining the two orgs with
   **`status IN ('pending','active','suspended')`**. Written by inclusion deliberately: 096's
   own comment says an unrecognised or NULL status must be REFUSED because this gates a write
   into another party's inbox.

**THE HONEST CONSEQUENCE, STATED BEFORE IT IS DISCOVERED IN PRODUCTION.** A closure
notification reaches a vendor **in-app only where a `partnerships` row exists between the two
organizations at status pending, active or suspended.** A vendor who was reached as a manual
recipient or a magic link and never became a partnership - which is a real population, since
`partner_rfp_inbox.vendor_org_id` was NULL on 8 of 88 rows at 079 (`079:953`) - gets the email
and **no bell**. That is not a defect this run introduces and it is not one it can fix:
widening that arm is a separate decision on a different predicate, exactly as 094 said of the
arm it left alone. **Query Q4 in section 9 measures how many vendors that is.**

**How email is triggered alongside in-app.** They are separate calls, side by side in the
handler, each in its own `try/catch`, neither conditional on the other. Email goes through
`sendTransactionalEmail()` + `buildBrandedEmailHtml()` + `siteBaseUrl()` from `lib/email.ts`
via Resend. Recipients come from `resolveOrgNotificationRecipients(orgId, client)`
(`lib/email.ts:390-461`).

**The preference toggle, and it is a real one.**
`profiles.notification_preferences` (jsonb, since `scripts/017`). `lib/email.ts:449` skips any
recipient whose `notification_preferences.email === false`. Absent, null and malformed all
mean opted IN - deliberately, per `lib/email.ts:370-372`: *"the failure direction for a
notification system is to send one too many, never to go quiet."*

**So the toggle is honoured automatically by using `resolveOrgNotificationRecipients` and is
bypassed by any code that reads `profiles.email` directly.** Phase 4 must use the helper.

Note the four toggles the settings UI actually shows (`app/partner/settings/user/page.tsx:35`,
`:321-344`) are `newBidReceived`, `partnerInvitationAccepted`, `projectUpdate`,
`platformAnnouncements` - **none of which any send path reads.** The only key with an effect
anywhere in the codebase is `email`, and no UI writes it. That mismatch is pre-existing, is
not this run's to fix, and is recorded so Phase 4 is not credited with respecting a toggle a
user cannot actually set.

---

## 7. (0f) THE BROADCAST DEADLINE FIELD

**There is ONE capture control and TWO routes that receive it.** That is worth stating first,
because R1's "both capture paths" could be read as two UI fields, and it is not.

| Where | What |
|---|---|
| `app/agency/page.tsx:604` | `const [responseDeadlineDate, setResponseDeadlineDate] = useState("")` - **the single state** |
| `app/agency/page.tsx:2854-2862` | the `<Input type="date">` and its helper text - **the single control** |
| `app/agency/page.tsx:1213-1216` | `responseDeadlineDate.trim().length > 0 ? new Date(\`${d}T23:59:59\`).toISOString() : null` - one conversion |
| `app/agency/page.tsx:1266` | posts `response_deadline` to the **standard broadcast** |
| `app/agency/page.tsx:1295` | posts the same value to the **magic-link / Lightning** path |

**The two receiving routes, each with its own independent fallback to `null`:**

| Route | Lines | Behaviour on a blank or absent value |
|---|---|---|
| `app/api/agency/broadcast-rfp/route.ts` | `119-126`, writes at `:239` and `:384` | `null` |
| `app/api/agency/rfp/magic-link/route.ts` | `132-139`, writes at `:283` and `:463` | `null` |

**The helper text, verbatim** (`app/agency/page.tsx:2861`):

> *"Optional. If set, partners will see "Respond by" in their inbox and RFP detail view."*

R1 changes the state initialiser at `:604`, the helper text at `:2861`, and **both route
fallbacks** - because a route is a trust boundary and a caller that posts no deadline must
still get one. Three files, one named constant.

---

## 8. (0g) THE QUEUE ITSELF. Do the four references still hold?

**Three hold exactly. One has drifted by one line. The route reference is off by two at its
start.** Measured by grep on this tree.

| `docs/vendor-attention-queue.md` says | Actually | Verdict |
|---|---|---|
| `app/partner/page.tsx:544` - the header count `queueRows.length` | **544**, `Needs your response ({queueRows.length})` | EXACT |
| `app/partner/page.tsx:565` - the list `visibleQueueRows` | **566**, `{visibleQueueRows.map((row) => {` | **drifted +1** |
| `app/partner/page.tsx:657` - "No deadline set" | **657** | EXACT |
| `app/api/partner/dashboard/route.ts:238-274` - the data | **236-274**: the `// ── Needs Your Response ──` banner is at **236**, `const needsResponse` at **238**, the loop at **241**, `expiredCount += 1` at **251**, `needsResponse.sort` at **269**, block closes at **274** | **starts 2 lines earlier** |

Three further references the diagnosis relies on and that also still hold:

- `app/partner/page.tsx:442-448` `queueRows` is rfps, then onboarding, then overdue
  milestones, concatenated in that order.
- `app/partner/page.tsx:557` the empty-state condition tests
  `needsResponseItems.length === 0 && onboardingPending.length === 0` and **omits
  `overdueMilestones`** - the R5 contradiction, still live.
- `app/api/partner/dashboard/route.ts` has **no `.order()` and no `.limit()`** on the inbox
  read at `:97-101`. Confirmed by grep: the file's only `order(`/`limit(` hits are zero.
  Meanwhile `app/api/partner/rfps/route.ts:234` **does** carry
  `.order("created_at", { ascending: false })`, so the two vendor-facing reads of the same
  table already disagree about ordering. R4 closes that gap on the dashboard side.

---

## 9. THE EIGHT QUERIES THIS SESSION COULD NOT RUN

Every one is read-only. None was executed. Each states what its answer changes.

```sql
-- Q1. THE ONE THAT GATES MIGRATION 099. What is the LIVE status CHECK?
--     Section 2 is read from files and the files cannot reproduce this database.
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.partner_rfp_inbox'::regclass AND contype = 'c';
-- EXPECTED: 2 rows - partner_rfp_inbox_status_check (the nine of scripts/019) and
-- partner_rfp_inbox_recipient (scripts/013:22). If the status row is ABSENT, 099's
-- DROP IF EXISTS no-ops and its ADD creates the constraint for the first time, which is
-- still correct - but say so in the report rather than letting it pass unremarked.
```

```sql
-- Q2. THE ONE THAT GATES PHASE 3. Does an agency UPDATE policy exist on this table?
--     Section 10 argues from files that it does not. This is the proof.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'partner_rfp_inbox'
ORDER BY cmd, policyname;
-- EXPECTED: 5 rows, and NO row with cmd = 'UPDATE' whose predicate names lead_org_id.
-- If an UPDATE policy for the lead agency DOES exist under a name not in this repository,
-- 099's new policy is redundant rather than wrong - but read its predicate before assuming so.
```

```sql
-- Q3. The status distribution of the 97. What is actually in the column.
SELECT status, count(*) AS n,
       count(*) FILTER (WHERE response_deadline IS NULL) AS without_deadline
FROM public.partner_rfp_inbox GROUP BY status ORDER BY n DESC;
-- Settles whether any value outside the nine is already live.
```

```sql
-- Q4. HOW MANY VENDORS WILL GET THE EMAIL AND NO BELL. See section 6.
SELECT count(*) FILTER (WHERE p.id IS NOT NULL
                          AND p.status IN ('pending','active','suspended')) AS reachable_in_app,
       count(*) FILTER (WHERE p.id IS NULL
                          OR p.status NOT IN ('pending','active','suspended')) AS email_only
FROM public.partner_rfp_inbox i
LEFT JOIN public.partnerships p
  ON p.lead_org_id = i.lead_org_id AND p.vendor_org_id = i.vendor_org_id
WHERE i.status IN ('new','viewed');
```

```sql
-- Q5. Does the agency-side inbox status sync actually write? See section 10.
--     If the sync has been silently no-opping, inbox rows will disagree with their responses.
SELECT i.status AS inbox_status, r.status AS response_status, count(*) AS n
FROM public.partner_rfp_responses r
JOIN public.partner_rfp_inbox i ON i.id = r.inbox_item_id
GROUP BY 1, 2 ORDER BY n DESC;
-- EXPECTED IF THE SYNC WORKS: awarded/awarded, declined/declined, bid_submitted/submitted.
-- A large "new"/"submitted" or "viewed"/"awarded" population is the signature of a sync
-- that has been matching zero rows.
```

```sql
-- Q6. The notifications CHECK, live. Confirms section 4 before 099 widens it again.
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
-- EXPECTED: the eleven of 095:312-331.
```

```sql
-- Q7. The policy count, for 099's own verification block to compare against.
SELECT count(*) AS policy_count FROM pg_policies;
-- 095's V6 expected 117. Report what you see; 097 and 098 have landed since.
```

```sql
-- Q8. How many rows would each closure unit touch, for the confirmation copy in 3e.
SELECT i.project_id, i.scope_item_name,
       count(*) AS recipients,
       count(*) FILTER (WHERE i.status IN ('new','viewed')) AS would_close
FROM public.partner_rfp_inbox i
GROUP BY 1, 2 HAVING count(*) FILTER (WHERE i.status IN ('new','viewed')) > 0
ORDER BY would_close DESC LIMIT 20;
```

---

## 10. AN UNASKED FINDING THAT CHANGES PHASE 3, FOUND WHILE ANSWERING 0a

### THERE IS NO AGENCY `UPDATE` POLICY ON `partner_rfp_inbox`. THE LEAD AGENCY CANNOT WRITE TO THIS TABLE AT ALL UNDER RLS.

Five policies exist on the table, and after 079 they are
(`supabase/migrations/079_organizations.sql:1341-1371`, plus the untouched email arm at
`079:1113`):

| Policy | Cmd | Predicate |
|---|---|---|
| Agencies insert partner RFP inbox rows | INSERT | `lead_org_id IN (current_user_org_ids())` |
| Agencies select own partner RFP inbox rows | SELECT | `lead_org_id IN (current_user_org_ids())` |
| Partners select inbox rows by partner_id | SELECT | `vendor_org_id IN (current_user_org_ids())` |
| Partners select inbox rows by recipient email | SELECT | caller's profile email = `recipient_email` |
| **Partners update own inbox rows** | **UPDATE** | `vendor_org_id IN (current_user_org_ids()) OR` email match. **No `WITH CHECK`.** |

**Grep evidence:** every `CREATE POLICY` naming this table across `supabase/migrations/*.sql`
and `scripts/*.sql` is quoted above. Nothing in 080-098 adds one. The 2026-08-13 `pg_policies`
dump at `docs/schema-snapshot-2026-08-13.md:134-142` shows the same five under their pre-079
predicates.

### THIS HAS TWO CONSEQUENCES AND BOTH ARE LOAD-BEARING FOR THIS RUN

**(a) A vendor can already set any permitted status on their own inbox row.** The UPDATE
policy has a `USING` clause and no `WITH CHECK`, so PostgreSQL applies `USING` as the check -
a vendor may write any value the CHECK constraint permits. **The moment 099 widens that
constraint, a vendor can set their own row to `closed` or `not_selected` from the browser
client, with no route involved.** R7 says they must never be able to. So 099 cannot widen the
CHECK without narrowing this policy in the same transaction, and the narrowing is the security
half of the migration, not a nicety. This is stated here because it is the single easiest
thing in this run to miss: widening a CHECK looks like a spelling change and is, here, a
privilege grant.

**(b) The agency-side status sync that already ships may be writing nothing.**
`app/api/agency/rfp-responses/[id]/route.ts:762-779` runs

```ts
await supabase.from("partner_rfp_inbox")
  .update({ status: mapResponseStatusToInboxStatus(nextStatus), updated_at: ... })
  .eq("id", resolvedInboxItemId).in("lead_org_id", callerOrgIds)
```

on the **session client**, against a table with no agency UPDATE policy. An UPDATE matching
zero rows is not an error in PostgREST, so `inboxStatusErr` is null, the handler returns 200,
and the inbox row keeps its old status. **This is exactly the success-shaped non-event class
this project has been bitten by three times.** It is NOT asserted as fact here - it is
inferred from files, and `Q5` in section 9 is the query that proves or disproves it against
real rows. If Q5 shows the disagreement, this is a pre-existing production defect that
migration 099 incidentally fixes by adding the missing policy, and that fix must be called out
rather than shipped silently inside a feature.

**What Phase 3 must do about it.** Add a narrow agency UPDATE policy in 099 - `lead_org_id IN
(current_user_org_ids())` on both `USING` and `WITH CHECK`, matching the INSERT and SELECT
policies that already exist for the same role on the same table. That is a **new grant**, not
a widening of an existing predicate: it adds no row to any existing policy's reach, it is
identical in shape to the two agency policies already on this table, and it is strictly
narrower than `partner_rfp_responses`'s already-live
`"Agencies update response status and feedback"` (`079:1384-1387`), which grants the same
verb on the same relationship. The alternative - routing the write through the service role -
is forbidden by this run's limits and would be worse: it would bypass the boundary rather than
express it.

---

## 11. What was EXECUTED, READ, and REASONED

- **EXECUTED:** the eight gate commands in section 1; grep sweeps for the status CHECK, every
  `CREATE POLICY` on `partner_rfp_inbox`, every file touching the table (44), every literal
  inbox status, `RESPONDED_STATUSES` / `effectiveStatus`, `notification_preferences`,
  `response_deadline`, `awaiting_response`, and the four `docs/vendor-attention-queue.md`
  line references.
- **READ:** `scripts/013`, `018`, `019`; `supabase/migrations/079`, `094`, `095`, `096`;
  `docs/schema-snapshot-2026-08-13.md`; `docs/vendor-attention-queue.md`; `LIGAMENT_CONTEXT.md`;
  `lib/bid-status.ts`, `lib/bid-shared.ts`, `lib/notifications.ts`, `lib/email.ts`,
  `lib/entitlements.ts`; `components/partner-rfp-surface.tsx`; `app/partner/page.tsx`,
  `app/partner/rfps/page.tsx`, `app/partner/bids/page.tsx`, `app/partner/rfps/[id]/page.tsx`;
  `app/agency/page.tsx`, `app/agency/bids/page.tsx`, `app/agency/dashboard/page.tsx`;
  `app/api/partner/dashboard/route.ts`, `app/api/partner/rfps/route.ts`,
  `app/api/partner/rfps/[id]/intent/route.ts`, `app/api/partner/rfps/[id]/response/route.ts`,
  `app/api/agency/rfp-responses/route.ts`, `app/api/agency/rfp-responses/[id]/route.ts`,
  `app/api/agency/broadcast-rfp/route.ts`, `app/api/agency/rfp/magic-link/route.ts`.
- **REASONED:** that four status vocabularies overlap on one column (section 2); that nine of
  twelve readers fall through to "New" (section 3); that no vendor surface can carry a closed
  row, from the component's own comment (section 5); that the missing agency UPDATE policy is
  both a blocker for Phase 3 and a latent pre-existing defect (section 10).
- **NOT DONE, deliberately:** no database was queried; no migration was authored in this
  phase; no `.ts` or `.tsx` file was edited.
