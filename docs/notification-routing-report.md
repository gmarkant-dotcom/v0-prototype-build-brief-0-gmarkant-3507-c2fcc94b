# Notification routing run report

Branch `feat/notification-routing`, cut from `f61409f`. **Four commits, not pushed, not merged.**

| # | Commit | Phase |
|---|---|---|
| 1 | `8590fd6 docs: the notification routing table, keyed on type and viewer side` | 0 |
| 2 | `a5d20d3 feat: notification rows reach the record, keyed on type and viewer side` | 1 |
| 3 | `80db2e7 fix: the vendor project page stops promising an award that may never come` | 2 |
| 4 | `d5aba30 feat: R6, a ceiling on the vendor attention queue, at the agency's 500` | 3 |

The Phase 0 baseline, with the full derivation of everything below, is
`docs/100-phase0-baseline.md`. This file is the outcome. No migration was authored: this run
needed none, because every identifier it routes on is already written to `notifications.data`
by code that is already live.

**No database was queried at any point.** Every question needing a row count or a live
constraint is in section 7 as a query for Greg.

---

## 1. THE HEADLINE. The brief's premise did not survive the source, and the fix is different.

**The brief:** "clicking a notification in the panel does nothing... only the click target is
missing."

**The source:** the click target has been there since the bell shipped.
`components/notification-bell.tsx` pushed `n.link` on every row click, the endpoint selects
`link`, and all twelve write sites set one. Adding an onClick would have changed nothing.

Two mechanisms explain the observation and both are real in source:

1. **Every agency destination was a bare list URL.** `bid_submitted` - the type in the brief's
   own example - carried `link: '/agency/bids'`. Pushing that while standing on `/agency/bids`
   closes the panel and moves nothing.
2. **A cross-portal row was bounced by middleware to the portal home**, silently, destination
   discarded (`middleware.ts:123-133`). If you were already on the home page, again nothing
   visible happened.

**I could not determine which one Greg saw on 2026-09-14, and I did not run the app.** Live
checklist step 1 distinguishes them in one click.

**The brief's second sentence was exactly right and is what got fixed:** "cannot take you to
that bid." No link carried a record identifier even when the row's `data` held one.
`notifyBidSubmitted` writes `data.responseId` and `link: '/agency/bids'` in the same call.

**A third thing nobody asked about:** clicking a row never marked it read. "Mark all read" was
the only writer of that column in the product. Per-row read is new here, on the existing
`PATCH { notificationIds }`.

---

## 2. THE ROUTING TABLE AS BUILT, keyed on (TYPE, VIEWER SIDE)

13 types x 2 sides = 26 cells. "Native" is the side the write site addresses. "Foreign" is a
dual-role user seeing the same row from the other portal, which happens because the bell is one
component in both portals and filters by neither.

| Type | Side | Destination as built | Identifier | Level | Changed from before? |
|---|---|---|---|---|---|
| `bid_submitted` | **agency** | `/agency/bids?response={responseId}` | `data.responseId` | **RECORD** | **YES. The brief's defect.** |
| `bid_submitted` | vendor | inert | - | UNROUTED | yes, was a bounce |
| `partnership_accepted` | **agency** | `/agency/pool` | none | list | no |
| `partnership_accepted` | vendor | inert | - | UNROUTED | yes, was a bounce |
| `partnership_declined` | **agency** | `/agency/pool` | none | list | no |
| `partnership_declined` | vendor | inert | - | UNROUTED | yes, was a bounce |
| `project_accepted` | **agency** | `/agency/bids` | none usable | list | no |
| `project_accepted` | vendor | inert | - | UNROUTED | yes, was a bounce |
| `project_declined` | **agency** | `/agency/bids` | none usable | list | no |
| `project_declined` | vendor | inert | - | UNROUTED | yes, was a bounce |
| `partnership_invitation` | **vendor** | `/partner/network?tab=invitations` | none | list | **YES. Tab was wrong.** |
| `partnership_invitation` | agency | inert | - | UNROUTED | yes, was a bounce |
| `project_assignment` (assignments site) | **vendor** | `/partner/projects/{projectId}` | `data.projectId` | **RECORD** | no |
| `project_assignment` (magic-token site) | **vendor** | `/partner/rfps/{inboxId}` | `data.inboxId` | **RECORD** | no |
| `project_assignment` | agency | inert | - | UNROUTED | yes, was a bounce |
| `project_awarded` | **vendor** | `/partner/projects/{projectId}` | `data.projectId` | **RECORD** | no |
| `project_awarded` | agency | inert | - | UNROUTED | yes, was a bounce |
| `onboarding_deployed` (packages site, live) | **vendor** | `/partner/onboarding` | none read | list | no |
| `onboarding_deployed` (deploy site, dormant) | **vendor** | `/partner/projects/{projectId}` | `data.deploymentId` + `projectId` | **RECORD** | **YES. Dropped an inert `?tab=`.** |
| `onboarding_deployed` | agency | inert | - | UNROUTED | yes, was a bounce |
| `rfp_closed` | **vendor** | `/partner/rfps?tab=closed` | **none exists** | list | **YES. Tab was wrong.** |
| `rfp_closed` | agency | inert | - | UNROUTED | yes, was a bounce |
| `rfp_not_selected` | **vendor** | `/partner/rfps?tab=closed` | **none exists** | list | **YES. Tab was wrong.** |
| `rfp_not_selected` | agency | inert | - | UNROUTED | yes, was a bounce |
| `new_message` | either | stored link if any, gated by portal | **no write site** | UNROUTABLE | n/a, no rows exist |
| `document_uploaded` | either | stored link if any, gated by portal | **no write site** | UNROUTABLE | n/a, no rows exist |

### THE PORTAL RULE IS STRUCTURAL, NOT ELEVEN TABLE ENTRIES

`lib/notification-routing.ts` computes one destination per row, then refuses it if it does not
start with the current portal's prefix. That is the whole of the foreign column. Eleven
hand-written "this one is cross-portal" entries would have been eleven chances to get one
wrong, and a wrong one is invisible until somebody in the other portal clicks it.

**A type this file does not know falls back to its own stored `link`, still portal-gated.**
Returning null would be tidier and would be wrong: a type added to `NotificationType` and the
CHECK constraint later, by someone who never opens this file, would silently go from
"navigates" to "inert". The stored link was authored by the write site and is a real
destination. This is the same argument `unknownTypeLabel()` already makes for the label.

### 0a: THE TWO TYPE LISTS AGREE. THIRTEEN EACH, NO DISAGREEMENT.

`NotificationType` in `lib/notifications.ts` against the CHECK as widened by
`099_rfp_closure.sql:574-595`. Set difference empty in both directions. **Nothing checks that
they agree** - 095's own constraint comment says so and 099 repeats it - so that is a
measurement of today, not a guarantee. Q2 in section 7 confirms it against live.

**A third list was out of sync and is now fixed.** `TYPE_LABELS` in the bell had eleven keys
and claimed in its own header to be "exactly `NotificationType`". 099 shipped `rfp_closed` and
`rfp_not_selected` without adding them, so both had been rendering their grey category label as
the raw strings "Rfp closed" and "Rfp not selected" through the unknown-type fallback. Two keys
added.

---

## 3. THE UNROUTED LIST, AND THE RULINGS GREG OWES

An empty UNROUTED list would have meant judgment calls were made silently. This one is not
empty.

### R1. ELEVEN CROSS-PORTAL CELLS. The only ruling this run acted on, and it acted on (a).

A dual-role user sees every notification in both portals. Today a foreign-portal row navigates
and middleware redirects them to their own portal's home, with no message and no `next`
parameter. That is a dead click with a side effect.

- **(a) INERT. IMPLEMENTED.** The row renders in full, shows its type, title, message and time,
  and is not clickable from the wrong portal. Cost: a dual-role user must switch portals
  themselves. Benefit: no dead clicks, no surprise mode change, no new failure mode, and it
  invents no behaviour. **This is why it was chosen over waiting: leaving it as-is means
  shipping a second set of dead clicks, which 1b forbids.**
- **(b) SWITCH THEN NAVIGATE.** Click calls `POST /api/profile/switch-role`, waits, then pushes.
  Cost: clicking a notification silently changes which portal you are in, mid-task. It is a
  write on a click. And it needs a failure path: switching TO agency requires
  `secondary_role === 'agency'` or `is_admin`, so a vendor-only account clicking an agency row
  still has to see something. **If Greg wants this, it is a change to
  `resolveNotificationDestination` and the bell's click handler only. Nothing else moves.**
- **(c) FILTER THEM OUT OF THE BELL PER PORTAL. Recommended against.** The bell is the only
  consumer of this table. Hiding a vendor-side award while you are in agency mode means nothing
  anywhere tells you it happened. That is the silent drop the bell's own header argues against.

### R2. Give the partnership notifications a record destination?

`partnership_accepted` / `partnership_declined` carry `partnershipId`. The per-vendor surface
`/agency/pool/[partnerId]` takes a **vendor organization id**, which is a different thing and is
not on the row. Adding `vendorOrgId` to those two emitters' payloads would make
`/agency/pool/{vendorOrgId}` reachable. **Not done:** it changes what emitters write, which has
a wider blast radius than routing what they already write, and it helps only rows written after
it ships.

### R3. Which destination is right for "invited to bid"?

The bell says `/partner/projects/{projectId}`; the email says `/partner/rfps`
(`app/api/projects/[id]/assignments/route.ts:261`). **The email may be the correct side of this
disagreement**, because `/partner/projects/{id}` renders awarded engagements only, so a vendor
who has been invited and not yet awarded lands on an empty state. **This run deliberately kept
the bell's existing destination rather than changing it on my own judgment, so the
disagreement survives Phase 1 by design.** If Greg rules for the email, it is one line in
`lib/notification-routing.ts`.

### R4. Should `rfp_closed` / `rfp_not_selected` carry an identifier?

They carry `scopeItemName` and `agencyName`, which are display strings.
`app/api/agency/rfp-closure/route.ts:409-410` has the inbox row in hand and passes no key, so a
record destination is **impossible**, not deferred. One extra payload key there would make
`/partner/rfps/{inboxId}` reachable in a future run. Not done, same reason as R2.

### R5. Wire `new_message` and `document_uploaded`, or remove them?

Both are declared in the union, permitted by the constraint, and **written by nothing anywhere
in the repository**. The "New message on [Project]" EMAIL already sends
(`app/api/projects/[id]/messages/route.ts`), so the event happens and the in-app type for it was
declared and never wired. Either the emitter is missing or these are dead vocabulary that
should come out of the union and the constraint. A feature decision either way.

### R6b. Should the vendor's unbounded SQL read get a real WHERE?

Phase 3 put the ceiling where it is safe (see section 5). The SQL read of `partner_rfp_inbox` in
`app/api/partner/dashboard/route.ts` is still unbounded and still has no WHERE clause of its
own. Bounding it at the database means giving it a real filter, which is a change to the
query's access shape - a ruling, not a limit.

### R7. Does a vendor at the queue ceiling get told?

Phase 3 logs it server-side and adds nothing to the response body. A "showing 500 of 640"
banner is UI nobody has ruled on. Offered, not invented.

---

## 4. IN-APP ROUTING VERSUS THE EMAIL DEEP LINKS

Every `ctaUrl` in `app/` and `lib/` was inventoried and read. For events that also write an
in-app notification:

| Event | In-app (as built) | Email `ctaUrl` | Agree? |
|---|---|---|---|
| Bid submitted / revised | `/agency/bids?response={id}` | `/agency/bids` (`lib/email.ts:304`) | **NO, and the in-app one is now MORE specific.** See below. |
| Vendor accepted/declined a project invite | `/agency/bids` | `/agency/bids` (`assignments:377`) | yes |
| Partnership accepted | `/agency/pool` | `/agency/pool` (`partnerships:1122`) | yes |
| Partnership declined | `/agency/pool` | `/agency/pool` (`partnerships:1267`) | yes |
| RFP closed / not selected | `/partner/rfps?tab=closed` | `/partner/rfps` (`rfp-closure:474`) | **NO. The email still lands on the tab that excludes the row.** |
| Invited to bid | `/partner/projects/{id}` | `/partner/rfps` (`assignments:261`) | **NO. R3, pre-existing, untouched.** |
| Project awarded | `/partner/projects/{id}` | `/partner/rfps` (`rfp-responses/[id]:1070`) AND `/partner/projects` (`assignments:464`) | **NO. Three destinations for one event, pre-existing.** |
| Onboarding package sent | `/partner/onboarding` | `/partner/onboarding` (`onboarding-packages:415`) | yes |
| Onboarding deployed (dormant) | `/partner/projects/{id}` | `/partner/onboarding?project={id}` (`deploy:169`) | **NO, pre-existing, and the email's parameter is inert.** |
| Partnership invitation | `/partner/network?tab=invitations` | `acceptUrl`, branching on whether the invitee has an account | Difference, not contradiction. The bell only exists for someone who already has an account. |

### THE TWO DISAGREEMENTS THIS RUN CREATED OR WIDENED, STATED PLAINLY

**Bid submitted.** The in-app link now names the bid and the email still points at the list.
This is a **deliberate asymmetry**: the notification row has `responseId` and the email builder
does not receive one. Making them agree means threading the response id into
`buildAgencyBidNotificationEmail`, which is an email change and was out of scope. **The email
is not wrong, it is coarser.** It lands on the same page.

**RFP closed.** The in-app link now selects the Closed tab; the email still lands on Open,
where the row it is about is deliberately not rendered. **The email is now the worse of the
two, and it was the worse of the two before as well - this run just fixed one side.** Adding
`?tab=closed` to `app/api/agency/rfp-closure/route.ts:474` is a one-line change and is the
smallest remaining item on this list.

### THREE INERT QUERY PARAMETERS ALREADY IN PRODUCTION

Not created here; found while reading destinations. `/partner/projects/[projectId]` reads NO
search parameters and `/partner/onboarding` reads none either, so
`/partner/projects/{id}?tab=onboarding` (the dormant in-app link) and
`/partner/onboarding?project={id}` (the dormant email) have always ignored their parameters.
The in-app one is dropped by this run; the email is untouched.

### EMAILS WITH NO IN-APP COUNTERPART AT ALL

RFP broadcast, bid feedback, bid declined, vendor status update, agency status-update
resolution, project messages, project agreements, pool re-invite, admin grant. This is R5's gap
seen from the email side. Out of scope.

---

## 5. PHASE 3, R6, AND THE TRAP IN IT

**The instruction was to mirror the agency-side ceiling rather than invent a number. The number
is 500.** What took care was *where*.

`docs/vendor-attention-queue.md` section 2 points at
`app/api/agency/dashboard/route.ts:148-149` as "its equivalent read... bounded at the database",
and it is: `.order("created_at", { ascending: false }).limit(500)`. **But that read is already
narrowed to the caller's own company** (`.in("lead_org_id", callerOrgIds)`), so its 500 means
"the newest 500 rows that are mine".

**The vendor read has no WHERE clause at all.** It selects `partner_rfp_inbox` unfiltered and is
narrowed afterwards, in JavaScript, by `vendorOwnsPartnerRfpInboxRow` - the deliberate
belt-and-braces shape `app/api/partner/rfps/route.ts:215-229` sets out and explains.

So a SQL `.limit(500)` there would have meant **"the newest 500 rows RLS lets me see"**, then
thrown most of them away. For a dual-role account - one organization that is the lead agency in
some partnerships and the vendor in others, which is `gmarkant@gmail.com` exactly - RLS returns
their own OUTBOUND broadcast rows too. **An agency that had broadcast 500 RFPs recently would
have had its entire vendor queue consumed by its own outbound rows and seen an EMPTY queue,
with no error, from a change whose stated purpose was a safety ceiling.** The filter's existing
log line ("acting-role filter dropped rows the caller sees as the lead agency") exists precisely
because that count is not zero.

**So the ceiling is applied to the vendor's own rows**, which is the thing the agency's 500
actually bounds. Specifically to the queue array, not to `inboxRows`, because `inboxRows` also
feeds the Recent activity union and the response-to-inbox join, and capping it would cost a bid
its scope name and its deep link. Sliced after the loop, so `expiredCount` is still counted
over every row.

**WHAT A VENDOR AT THE CEILING SEES.** The 500 most recent unanswered requests, and a header
reading 500. `needsResponse.items`, the header count (`app/partner/page.tsx:579`,
`queueRows.length`) and the funnel's "open RFPs" tile (`:790`, `funnel.openRfps`) all read the
same capped array, so **they cannot disagree** - which is the header-versus-body contradiction
R5 fixed in this same component. The empty-state condition (`:597`) tests the same two arrays.

**Nothing is lost.** `/partner/rfps` lists every request from its own read, which has no
ceiling. The cap bounds the dashboard, not access.

**The number in the doc and the number in the brief disagree and I did not reconcile them.**
`docs/vendor-attention-queue.md` records 67 rows for the April vendor; the brief for this run
says 64. Both are live measurements taken on different days and neither is in source. Q7
settles whether any vendor is near 500 at all.

---

## 6. THE GATES. EXACT EXIT CODES, ALL EXECUTED.

Branch at `d5aba30`, working tree clean. `main` measured in a throwaway worktree at `f61409f`,
`git status --porcelain` empty.

| # | Command | main | **branch** | Verdict |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | 0 | **0** | pass, zero diagnostic lines |
| 2 | `pnpm build` | not run, see note | **0** | pass, compiled in 8.7s, 72/72 static pages, 175 route lines |
| 3 | `pnpm lint` | 1 (**182 problems, 154 errors, 28 warnings**) | **1 (182 / 154 / 28)** | **pre-existing, IDENTICAL count** |
| 4 | `pnpm identity-columns:guard` | 0 | **0** | pass |
| 5 | `pnpm org-id-reads:guard` | 0 | **0** | pass, class A 14 / class B 60, baseline unchanged |
| 6 | `pnpm embed-targets --guard` | 0 | **0** | pass |
| 7 | `pnpm policy-audit:guard` | 1 | **1** | **pre-existing**, reads a static snapshot |
| 8 | `pnpm verify-rls` | **2** | **2** | **pre-existing**, "Could not find the table 'public.pg_class' in the schema cache" |

Non-guard variants of the four scripts, for completeness, all on the branch: `pnpm
embed-targets` 0, `pnpm identity-columns` 0, `pnpm org-id-reads` 0, `pnpm policy-audit` 0.

**HOW main WAS MEASURED, AND ONE FALSE READING I THREW AWAY.** `git worktree add` at `main`,
then the gates run with `node` and the eslint binary **invoked directly, never through pnpm**.
My first attempt ran them through `pnpm` with a `node_modules` symlink, and pnpm's
dependency-status check tried to reinstall, aborted for want of a TTY, and returned **its own**
exit codes - 1, 1 and 1. Reported here because those three numbers looked like a plausible
result and one of them (`verify-rls` = 1) silently contradicted the brief's stated 2. They were
pnpm failing, not the gates running. The numbers in the table above are the second run.

`pnpm build` was not run in the worktree: Next writes `.next/` and needs a real install, and the
build is not one of the known-failing gates the brief asked to confirm. It exits 0 on the
branch, which is the claim that matters.

Also executed on the branch: `grep -rl "\](http://" app/ lib/ components/` returns nothing
(markdown link corruption sweep, per CLAUDE.md). And **zero em dashes or en dashes were added by
this run** - verified per file against `git diff main...HEAD`. Four pre-existing ones remain in
files I touched (`app/partner/network/page.tsx` x3, `components/partner-rfp-surface.tsx` x1,
`app/partner/projects/[projectId]/page.tsx` x1 in demo data) and were left alone as out of
scope.

---

## 7. WHAT I COULD NOT ESTABLISH. QUERIES FOR GREG. NONE WERE RUN.

**Q1 (not a query, one click). WHICH MECHANISM WAS OBSERVED ON 2026-09-14?** Live checklist
step 1. It decides nothing about the fix - both are closed - but it is the only way to know
which one Greg actually hit, and the answer belongs in the record.

**Q2. Does the live CHECK hold exactly the thirteen?**
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
```
Any value live and absent from section 2 is a type that can exist and that the resolver does
not know about. It would fall to the stored-link fallback, which is the safe direction, but it
would not be in the table.

**Q3. THE MOST VALUABLE ONE. Which types have rows, and do they all carry a link?**
```sql
SELECT type, count(*) AS n, count(link) AS with_link FROM public.notifications
GROUP BY type ORDER BY n DESC;
```
EXPECTED: zero rows for `new_message` and `document_uploaded`; `with_link = n` for every type.
**`with_link < n` for any type would falsify section 1's central claim** that `n.link` was never
null, and would mean some rows genuinely were dead clicks for the plainest possible reason.

**Q4. Does `notifications` have the columns this code writes?** There is no `CREATE TABLE` for
it anywhere in this repository, so the column list cannot be read from source at all.
```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='notifications' ORDER BY ordinal_position;
```

**Q5. Any `project_assignment` row carrying neither key?**
```sql
SELECT count(*) FROM public.notifications WHERE type='project_assignment'
  AND data->>'projectId' IS NULL AND data->>'inboxId' IS NULL;
```
EXPECTED 0. Non-zero means a third payload shape I did not find. Those rows route to
`/partner/rfps` rather than to a URL containing "undefined", which is handled, but the shape
should be known.

**Q6. How many `bid_submitted` rows actually carry `responseId`?**
```sql
SELECT count(*) AS total, count(data->>'responseId') AS with_response_id
FROM public.notifications WHERE type='bid_submitted';
```
This is how much of the headline fix is real on existing data. Rows without it fall back to
`/agency/bids`, which is today's behaviour.

**Q7. Is any vendor near the Phase 3 ceiling?**
```sql
SELECT vendor_org_id, count(*) FROM public.partner_rfp_inbox
GROUP BY 1 HAVING count(*) > 400 ORDER BY 2 DESC;
```
EXPECTED no rows. Any row at or above 500 is a vendor for whom Phase 3 changes what is on
screen today.

**Q8. Do the partnership notification types have any rows at all?** Relevant to the checklist,
not to the code. `lib/notifications.ts` records that the counterparty INSERT arm is
active-partnership-only, so `partnership_invitation` and `partnership_declined` are still
RLS-refused at write time for a pending or terminated partnership. **If those types have zero
rows, checklist steps 6 and 7 cannot be performed, and that is a pre-existing gap (OPEN-G in
`docs/refusals-and-notifications-report.md`), not a routing failure.** Covered by Q3's output.

**Also not established:** whether `/partner/projects/[projectId]`'s `found && engagements.length
=== 0` branch is reachable. The route computes `found: engagements.length > 0`
(`active-engagement/route.ts:333`, `:340`), which makes that branch dead by construction. I did
not delete it; deleting dead branches was not this run's job.

---

## 8. WHICH PHASES ARE INDEPENDENTLY MERGEABLE

**All four. None depends on another.** In dependency terms:

| Phase | Commit | Ships alone? | Depends on |
|---|---|---|---|
| 0, the baseline doc | `8590fd6` | **yes**, it is a document | nothing |
| 1, routing | `a5d20d3` | **yes** | nothing. Does not need Phase 0's doc to exist. |
| 2, the project page copy | `80db2e7` | **yes** | nothing. The misleading sentence is wrong today, with or without routing. |
| 3, the queue ceiling | `d5aba30` | **yes, and it is unrelated** | nothing. Different file, different feature, different surface. |

Phase 2 is the one with the mildest argument for shipping WITH Phase 1: routing makes that
empty state easier to reach, since a `project_awarded` notification now lands there more often.
It is still correct on its own.

## 9. WHAT TO REVERT IF ONE IS WRONG

Every phase is one commit, and none of them touches a migration, a policy, an emitter, an
access predicate, or the service role. `git revert <sha>` is clean for each.

| If this is wrong | Revert | Blast radius of the revert |
|---|---|---|
| Cross-portal rows should not be inert (R1 should have been (b) or left alone) | **Do not revert the commit.** Change `resolveNotificationDestination` in `lib/notification-routing.ts`. The portal gate is four lines at the end of that function. | none outside that file |
| `bid_submitted` should not deep-link, or the notice copy is wrong | Revert the `app/agency/bids/page.tsx` hunk of `a5d20d3` only. The page returns to reading no search parameters, and `lib/notification-routing.ts` then produces a `?response=` nobody reads, which is harmless and inert. | `/agency/bids` returns to static-with-no-params. Keep the `Suspense` wrapper or the build fails if any other parameter reader is added later. |
| A `?tab=` parameter is wrong | Revert the `components/partner-rfp-surface.tsx` or `app/partner/network/page.tsx` hunk. Both are a single `useState` initialiser. | the surface returns to its hardcoded default tab |
| Per-row mark-read is unwanted | Delete `markOneRead` and make `onRowActivate` only `setOpen(false)`. | none. No endpoint or schema was added. |
| Rows should be buttons again, not links | Revert the render hunk of `a5d20d3`. | loses cmd-click and the link role |
| Phase 2's copy is wrong | `git revert 80db2e7`. One JSX string. | none |
| **Phase 3's ceiling is wrong** | `git revert d5aba30`. | The queue returns to unbounded. **Note the two things a revert also undoes:** the `expiredCount`-preserving slice position, and the server log line that measures when the ceiling bites. |

**The riskiest single thing in this run** is Phase 1's `Suspense` wrapper on `/agency/bids` and
`/partner/network`, because it changes how those two pages are rendered rather than what they
show. Both still build as static (`○`) in the verified `pnpm build`, matching
`/agency/pool`, which reached the same shape the same way.

---

## 10. NUMBERED LIVE CHECKLIST

**Two accounts.** `A` = `gmarkant@gmail.com`, the "m a r k a n t" lead agency. `V` = a vendor
account; `LIGAMENT_CONTEXT.md` lists `gmarkant@icloud.com` as the primary partner test account
and `gmarkant+partner8@gmail.com` as the manual one.

**Before you start:** run **Q3** from section 7. It tells you which notification types actually
have rows, and therefore which of steps 5 to 12 you can perform at all. A step for a type with
zero rows is not a failure; skip it and note the type.

**Two notes on reading the results.**
- The bell shows the SAME rows in both portals. Seeing a vendor-side notification while in the
  agency portal is correct and expected, not a bug.
- `A` holds both roles. To test a "foreign portal" step, you do not need a second login; switch
  portal with the "Switch to Vendor Mode" / "Switch to Lead Agency" control.

### The defect itself

1. **Confirm which mechanism was the original report (Q1).** As `A`, in the **agency** portal,
   go to `/agency/dashboard` - NOT `/agency/bids`. Open the bell. Click the
   "...updated their bid on..." row. **EXPECT:** the URL becomes
   `/agency/bids?response=<uuid>` and that bid's detail sheet opens on top of the list. Note
   what the URL was before you clicked; that is the answer to Q1.

2. **The same click from the page it used to fail on.** As `A`, go to `/agency/bids` first, then
   open the bell and click the same row. **EXPECT:** the same bid's detail sheet opens. This is
   the case that used to do visibly nothing.

3. **Clicking marks one row read.** Pick any UNREAD row (it has a dot and a tinted background).
   Note the bell's badge number. Click the row. Reopen the bell. **EXPECT:** that row has lost
   its dot, and the badge has gone down by exactly one. Other unread rows keep their dots.

4. **Keyboard and cmd-click.** Open the bell and press Tab until a routed row has focus.
   **EXPECT:** a visible focus ring, and Enter navigates. Then cmd-click (Mac) a routed row.
   **EXPECT:** it opens in a new tab AND is marked read in this one.

### Every routed type, on its native side

For each, `[how to produce one]` is in brackets if you need to create it.

5. **`bid_submitted`, AGENCY side.** Covered by steps 1 and 2. [`V` submits or edits a bid on an
   RFP from `A`.] **EXPECT:** `/agency/bids?response=<id>`, detail sheet open on that vendor's
   bid.

6. **`partnership_accepted`, AGENCY side.** [`A` invites `V` to the partner pool; `V` accepts.]
   As `A`, agency portal, click the "Partnership Accepted" row. **EXPECT:** `/agency/pool`. This
   is a LIST destination by design - see R2. Nothing should open.

7. **`partnership_declined`, AGENCY side.** [`V` declines an invitation. **See Q8: this type may
   have no rows, because the counterparty INSERT arm is active-partnership-only.**] **EXPECT:**
   `/agency/pool`.

8. **`project_accepted` or `project_declined`, AGENCY side.** [`V` accepts or declines a project
   assignment.] **EXPECT:** `/agency/bids`, list, no sheet.

9. **`partnership_invitation`, VENDOR side.** [`A` invites `V`.] As `V`, vendor portal, click the
   "New Partnership Invitation" row. **EXPECT:** `/partner/network?tab=invitations`, landing on
   the **Invitations** tab with the invitation visible. **If it lands on "My Agencies", the tab
   parameter regressed.**

10. **`project_assignment`, VENDOR side, BOTH SHAPES.**
    (a) [`A` invites `V` to bid on a project via project assignments.] **EXPECT:**
    `/partner/projects/<uuid>`.
    (b) [`A` sends `V` a Lightning RFP magic link; `V` loads their portal so the attach runs.]
    **EXPECT:** `/partner/rfps/<uuid>`, that RFP's detail page. **These two are the same
    notification type with different payloads; both must work.**

11. **`project_awarded`, VENDOR side.** [`A` awards `V` a bid.] **EXPECT:**
    `/partner/projects/<uuid>` showing the awarded engagement.

12. **`rfp_closed` and `rfp_not_selected`, VENDOR side.** [As `A` on `/agency/bids`, use the
    closure action on an unanswered request: once for the whole RFP, once declining one vendor.]
    As `V`, click each row. **EXPECT:** `/partner/rfps?tab=closed`, landing on the **Closed**
    tab with that request listed. **If it lands on "Open", the tab parameter regressed and the
    request will not be visible - which is the old behaviour.** Also confirm the grey category
    label reads **"RFP"** and not "Rfp closed" or "Rfp not selected".

13. **`onboarding_deployed`, VENDOR side.** [`A` sends an onboarding package.] **EXPECT:**
    `/partner/onboarding`.

### An unrouted row must not look clickable (MANDATORY)

14. **The cross-portal case, from the agency side.** As `A`, in the **agency** portal, find a
    vendor-side row in the bell - "Project Awarded!", "New RFP in your inbox", "An RFP you were
    invited to has closed", or "New Partnership Invitation". **EXPECT ALL OF:**
    - hovering it changes **nothing** (no background change, no pointer cursor, the arrow stays
      an arrow);
    - clicking it does nothing at all, and **in particular does not take you to `/partner`**;
    - Tab does not stop on it;
    - the row still shows its category, title, message and timestamp in full.

    **The thing that would be a failure:** clicking it and landing on `/partner` or
    `/agency/dashboard`. That is the old behaviour.

15. **The cross-portal case, from the vendor side.** Switch `A` to Vendor Mode. Find an
    agency-side row - "New Vendor Bid", "Vendor Bid Updated", "Partnership Accepted".
    **EXPECT:** the same four things as step 14, and in particular clicking does not take you to
    `/agency/dashboard`.

### Editing an identifier in a destination URL must be refused (MANDATORY)

For each of these, you need one id belonging to a company that is not yours. The
cheapest source is the other test account: as `V`, copy a uuid out of one of `V`'s own URLs,
then paste it into `A`'s URL, and vice versa. **Do not use a random uuid alone** - a random
uuid proves only that a non-existent id is refused, not that another company's real id is.

16. **`/agency/bids?response=<a real response id that is not A's>`.** As `A`, agency portal.
    **EXPECT:** the bids page renders normally, no detail sheet opens, and ONE notice sits above
    the list reading "That bid could not be opened. It may have been withdrawn, or it may no
    longer be available to your company." **EXPECT SPECIFICALLY NOT:** the bid's contents, the
    vendor's name, the budget, any part of that record, a redirect to the dashboard, or a
    message that names the record or distinguishes "does not exist" from "not yours".

17. **The same URL with a random uuid.** **EXPECT: the identical notice, word for word.** If the
    two differ, the page has become an existence oracle.

18. **`/partner/rfps/<a real inbox id that is not V's>`.** As `V`, vendor portal. **EXPECT:** a
    red panel reading "Not found" with a "Back to Open RFPs" link, and the same for a random
    uuid.

19. **`/partner/projects/<a real project id that is not V's>`.** As `V`. **EXPECT:** "There is
    no awarded engagement to show here. Either the lead agency has not awarded this scope yet,
    or this project is no longer available to your company. If you were expecting to see work
    here, the lead agency is the one to ask." **EXPECT SPECIFICALLY NOT** the old sentence
    "You'll see details here after the lead agency awards your bid", and not the project's name,
    the agency's name, or any engagement detail.

20. **The deleted-target case.** Load `/partner/projects/<id>` for a project that has been
    deleted, if one exists. **EXPECT:** the identical step 19 message. It must not differ from
    the not-yours case.

### Phase 3, the queue ceiling

21. **Nothing changed for a normal vendor.** As `V`, load `/partner`. **EXPECT:** the "Needs
    your response (N)" header, and N equal to what it was before this branch. The ceiling is
    500 and no vendor is known to be near it (Q7). **This step is checking that the ceiling did
    NOT change anything today.**

22. **Header and body still agree.** On the same page, expand "Needs your response" fully.
    **EXPECT:** the number of rows equals the N in the header, and the "Open RFPs" funnel tile
    further down shows the same N.

23. **The dual-role case, which is where a careless ceiling would have shown.** As `A` - who is
    a lead agency with many outbound broadcast rows AND a vendor - switch to Vendor Mode and
    load `/partner`. **EXPECT:** the queue shows `A`'s own incoming requests, exactly as it did
    before this branch. **A queue that has gone empty or much smaller here is the failure mode
    section 5 exists to prevent**, and would mean the ceiling landed on the wrong side of the
    ownership filter.

### Nothing else broke

24. **The bell's existing behaviour.** Open it and confirm: "Mark all read" still clears every
    dot and zeroes the badge; "Load more" still appears if there are more than 20 rows and still
    loads them; the panel is opaque on the agency side, not see-through.

25. **The two pages that gained a Suspense wrapper.** Load `/agency/bids` with no query string
    and `/partner/network` with no query string. **EXPECT:** both render exactly as before,
    `/agency/bids` with no notice banner and `/partner/network` on "My Agencies".

26. **`/partner/rfps` and `/partner/bids` with no parameters.** **EXPECT:** Open and My Bids
    respectively, as before. The `?tab=` parameter is validated against the tabs each surface
    renders, so `/partner/rfps?tab=history` should fall back to Open rather than showing a tab
    with no strip.
