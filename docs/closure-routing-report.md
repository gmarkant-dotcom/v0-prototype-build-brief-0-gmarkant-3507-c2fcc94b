> # MERGED TO `main`. THIS REPORT'S OWN HEADER SAYS IT IS NOT. Do not re-open anything below as unshipped.
>
> **Added 2026-09-15** by the `feat/engagements-one-source` run. The header sentence
> ("Three commits, not pushed, not merged.") was true the moment it was written and is false now.
>
> **How this was verified:** `git merge-base --is-ancestor <sha> main` was EXECUTED for every
> commit this report names. All of them returned 0. No document was taken at its word, this
> one included.
>
> **Commits, all on `main`:** `6ac5509`
>
> **THIS IS THE PROJECT'S MOST EXPENSIVE DOCUMENTATION TRAP, AND IT IS IN EIGHT FILES AT ONCE.**
> Every run report here opens by declaring its own branch unmerged, because that is the truthful
> thing to write while the branch is open, and nothing revisits the sentence when the branch
> lands. A later session reading it concludes the work is still on a branch and either redoes it
> or leaves a shipped defect marked open. The previous run named this pattern
> (`docs/pool-counts-and-payments-report.md` section 3d, "when a fix commits, the report that
> says 'uncommitted' is what strands the diagnosis") and did not sweep for it. This run did.
> The full list is in `docs/engagements-and-counts-report.md` section 1.
>
> **What this banner does NOT say.** It says the code merged. It says nothing about migrations.
> Migration 100 remains **AUTHORED AND NOT APPLIED**, and any section below describing an
> unapplied migration is still accurate.

# Closure routing run report

Branch `feat/closure-routing`, cut from `21ce8de docs: the notification routing run report,
and the live checklist`. **Three commits, not pushed, not merged.**

| # | Commit | Phase |
|---|---|---|
| 1 | `6ac5509 feat: the two closure notifications reach the request they name` | 1 |
| 2 | `a97af0a fix: the vendor completion badge stops rendering a failed read as 0%` | 2 |
| 3 | `cd1caf8 docs: the phase 0 baseline for the six emitter rulings` | 3 |

**No migration was authored.** This run needed none: the identifier it routes on is a column
already on a row the closure route already reads, and nothing about access changed.

**No database was queried at any point, read-only included.** Every question needing a row
count or a live catalog read is in section 7 as a query for Greg. None was run.

The Phase 3 discovery document, which is the largest deliverable here, is
`docs/101-phase0-baseline.md`.

---

## 1. PHASE 1. THE TWO CLOSURE NOTIFICATIONS NOW NAME THE REQUEST.

### 1a. WHAT THE DESTINATION RENDERS AND PERMITS. THE BRIEF'S WORST CASE DOES NOT EXIST.

The brief asked this first, and it was the right order: routing a vendor to a request they
cannot act on is worse than routing them to a list. **Read before the link was added.**

**WHAT IT RENDERS.** `app/partner/rfps/[id]/page.tsx` on a row whose status is `closed` or
`not_selected`: a read-only summary of whatever draft exists, ending in the sentence "This bid
is read-only in its current state." (`:2502`). No inputs, no upload controls, no buttons.

**WHAT IT PERMITS. NOTHING, AND THAT IS ENFORCED IN THREE PLACES.**

1. **The form does not render.** `canEdit` (`:1359-1362`) is an allow-list of nine statuses and
   neither closure status is in it. `currentStatus` resolves to the inbox status because
   closure only ever lands on a row with no response, so `canEdit` is false.
2. **The sticky submit bar does not render.** `activeTab === "bid" && canEdit` (`:2626`). The
   same `canEdit`. There is no second path to a submit button.
3. **The route refuses anyway.** `app/api/partner/rfps/[id]/response/route.ts:179-192` tests
   `isRfpClosureStatus(inbox.status)` and returns **409** with an explanation, before any write.

So the shape the brief warned about - a live form submitting into a guaranteed 42501 from 099's
clause (C) - **is not present, and the "FIX THAT FIRST" instruction did not fire.** Clause (C)
was read in the migration source before this conclusion was drawn: `status =
partner_rfp_inbox_status_before(id) OR (status = 'bid_submitted' AND the previous status is
neither 'closed' nor 'not_selected')`, `099_rfp_closure.sql:831-839`. It is the fourth layer
under three that already hold.

**WHETHER THE PAGE EXPLAINS THE STATE. IT DID NOT ON THE TAB A VENDOR LANDS ON, AND NOW IT
DOES.**

This is the one thing 1a turned up, and the deep link is what made it matter.

The closure banner existed, and it is good copy. It was inside the **My Bid** tab
(now `:1896-1901`). But `shouldDefaultToStatus` (`:943-950`) is true for every status outside
`{submitted, bid_submitted}`, so **a closed row opens on Status & Feedback** - a tab that
rendered a chip reading "Closed" or "Not Selected" and nothing else. Every other terminal
outcome on that tab already says what it means in a sentence: awarded, declined, changes
requested, meeting requested. The two statuses migration 099 added were the only ones that did
not.

That was survivable while the only way in was the vendor's own Closed tab, where they had just
read the status to get here. **A notification and an email both now deep-link straight to this
page**, so the click arrives cold.

**FIXED**, by adding the notice to the Status tab alongside the four outcome blocks that were
already there, and by moving the sentence into `closureVendorNotice()` in
`lib/rfp-closure-copy.ts` so the two tabs read from one function. Two hand-copied versions of a
message whose whole job is not to read as a rejection is two chances for one to drift into
reading as one - the same argument `closureEmailCopy()` above it already makes for the two
emails.

### 1b. THE IDENTIFIER WAS NEVER IMPOSSIBLE. IT WAS UNPASSED.

`docs/notification-routing-report.md` R4 recorded that a record destination was **"impossible,
not deferred"**, because `app/api/agency/rfp-closure/route.ts` passed `scopeItemName` and
`agencyName` and no key.

**That was true of the call and false of the scope.** Inside `emitClosureNotifications`, the
loop variable `row` comes off the UPDATE's own `RETURNING` projection
(`:221-223`, `"id, vendor_org_id, recipient_email, scope_item_name, project_id"`). **`row.id`
is the closed inbox row, in hand, at the exact line the notification is written.** Nothing had
to be restructured and nothing was.

That is the one correction this run makes to the previous run's report.

### 1c. WHAT WAS CHANGED

- `lib/notifications.ts` - `notifyRfpClosed` and `notifyRfpNotSelected` take `inboxId` and write
  it into `data`. **Required, not optional**: an optional id a later emitter forgets would
  compile, write a row, route to the list, and tell nobody. A TypeScript error is the only
  signal in this shape anybody sees.
- `app/api/agency/rfp-closure/route.ts` - passes `row.id` to both.
- `lib/notification-routing.ts` - `rfp_closed` and `rfp_not_selected` read `data.inboxId`
  through the existing `readId()` helper and return `/partner/rfps/{inboxId}`.
  **The existing convention was followed, not a second one invented:** `readId` is the same
  uuid-shape-tested reader `bid_submitted`, `project_assignment`, `project_awarded` and
  `onboarding_deployed` already use, and the value falls back exactly as theirs do.
- **The fallback is still `/partner/rfps?tab=closed`**, and it still matters. Every row written
  before this shipped has no `inboxId`. `components/partner-rfp-surface.tsx` partitions closed
  rows out of the open list, so the unparameterised `/partner/rfps` would take a vendor to a
  list defined as not containing the thing they were told about.

**AND THE EMAIL, WHICH WAS NOT IN THE BRIEF AND IS STATED PLAINLY AS A DELIBERATE EXTENSION.**
`rfp-closure/route.ts` sent `ctaUrl: ${baseUrl}/partner/rfps` - the OPEN list, the same one that
excludes the row. `docs/notification-routing-report.md` section 4 flagged it as "the worse of
the two" and left it because no identifier was being carried. One now is. Fixing only the bell
would have **widened** the in-app/email gap this run exists to close, so the email lands on the
same record: `ctaUrl: ${baseUrl}/partner/rfps/{row.id}`, `ctaText: "View this request"`.
It is one line and it is separately revertible (section 8).

**A recipient with no account is no worse off.** They are sent to sign in exactly as
`/partner/rfps` would have sent them, and `partnerCanAccessPartnerRfpInbox`'s
`recipient_email` arm admits them once they are.

### 1d. SECURITY. WHERE THE CHECK LIVES, AND WHAT A FAILURE SHOWS.

**The identifier on a notification is a claim, not a grant.** The new deep link adds a value a
user can edit in the URL, and the destination does not trust it.

**WHERE THE CHECK LIVES:** `app/api/partner/rfps/[id]/route.ts`, the `GET` handler.

```
:17  requirePartnerRole()                     session + role
:19  resolveCallerOrgIds(user.id, supabase)   MEMBERSHIP. An AUTHORITY set.
:37  partnerCanAccessPartnerRfpInbox(inbox, callerOrgIds, profile?.email)
:65  if (!access.allowed) -> 404 "Not found"
```

`partnerCanAccessPartnerRfpInbox` (`lib/partner-inbox-access.ts:63-82`) calls
`vendorOwnsPartnerRfpInboxRow`, which is `callerOwnsOrg(callerOrgIds, inbox.vendor_org_id)` OR a
case-folded, trimmed `recipient_email` match against the caller's own profile email. **A row
belonging to another company matches neither arm.**

**HOW I CONFIRMED IT:** by reading the route and the helper in full, not by inference. The
resolver is `resolveCallerOrgIds` from `lib/entitlements.ts`, which is the read-side authority
resolver the brief names. **`current_user_counterparty_org_ids()` and
`current_user_visible_profile_ids()` appear nowhere in this path** - checked by grep over the
route and the helper. They are visibility sets and neither is used here.

**WHAT A FAILED CHECK SHOWS, AND WHY IT IS NOT A THIRD BEHAVIOUR.** The route answers **404
`{"error": "Not found"}`** and the page renders that string in a red panel (`:1289`,
`{error || "Not found"}`). **A refused row and a nonexistent row are answered identically**, so
the response confirms nothing to somebody probing identifiers, and the user is told something
rather than silently bounced.

**This matches every other routed destination**, which is what the brief asked for rather than a
third choice: `/partner/projects/{id}` answers `{found: false}` for both cases,
`/agency/bids?response=` matches nothing in a list the caller already owns, and
`app/api/agency/rfp-closure/route.ts:170-177` returns 404 rather than 403 on the write side for
the same stated reason. Nothing was changed here; it was verified and left alone.

**NOTHING WAS WIDENED.** No policy, no predicate, no service role. `lib/notification-routing.ts`
reads nothing from any database and cannot widen anything. The only new capability is that a
URL now contains an id the caller must already be entitled to.

### 1e. THE LIMIT, STATED PLAINLY. THIS IS NOT RETROACTIVE.

**This fixes notifications written from now on.** Every `rfp_closed` and `rfp_not_selected` row
already in `public.notifications` carries `data = {scopeItemName, agencyName}` and
`link = '/partner/rfps'`. They will keep routing to `/partner/rfps?tab=closed`, which is the
tab that does contain them, so they are not broken - just coarse.

**IS A BACKFILL POSSIBLE FROM THE EXISTING PAYLOAD? NOT RELIABLY, AND I WOULD NOT RUN ONE.**

The payload holds two display strings. Joining a notification back to an inbox row would mean
matching `data->>'scopeItemName'` against `partner_rfp_inbox.scope_item_name`, the recipient's
organization, and `closed_at` near `notifications.created_at`. **Scope item names are not
unique** - the unit of an RFP in this codebase is `(project_id, scope_item_name)` precisely
because the name alone does not identify one - so an agency that closed two RFPs with the same
scope name produces an ambiguous match. **A wrong `inboxId` is worse than none**: it routes a
vendor confidently to another request.

**Q1 in section 7 measures how many rows exist and how many are ambiguous.** If it returns a
small number with no ambiguity, a backfill is a reasonable manual act. **It is a database write
this run cannot make, and it is written as a checklist item rather than implied.**

---

## 2. PHASE 2. THE COMPLETION BADGE WAS RENDERING A FAILED READ AS A NUMBER.

### 2a. WHAT COMPUTES IT, AND EVERY INPUT

**ONE CODE PATH.** `app/partner/page.tsx`, a single `useEffect` (`:235-338` after the change).
Grepped for a second: `% Complete`, `totalCompletion`, `profileCompletion` and `ProfileChecklist`
appear in no other file. The other `completionPct` hits are the project status slider and are
unrelated.

Five booleans, `totalCompletion` is their mean rounded (`:449-451`):

| Key | Input | Source |
|---|---|---|
| `capabilities` | `profiles.capabilities` is a non-empty array | `profiles.select("*")` |
| `credentials` | `profiles.credentials` is a non-empty array | same |
| `reel` | `profiles.reel_url` is a non-empty string | same |
| `legal` | five `legal_*` columns ALL non-empty | same |
| `payments` | any of four rate-info fields non-empty | `GET /api/partnerships` then `GET /api/partner/rate-info?partnershipId=` |

`nextIncompleteKey` is the first false in that declaration order, which is what fills the
sentence after the percentage.

### 2b. WHICH READING WAS WRONG. 0% WAS, AND THE SOURCE SETTLES IT WITHOUT A QUERY.

**0% with "Add your capabilities" requires all five false.** All-false had **four** producers
and only one was a measurement:

1. **The initial `useState` value.** Every vendor sees it on every load until a profile read plus
   up to two API round trips complete. There was **no loading flag on this surface at all**.
2. **The `if (!user || cancelled) return` early exit**, which leaves the initial value standing.
3. **The `catch`**, which wrote all-false over a real answer on any throw from either fetch.
4. **A refused or failed `profiles` read.** `.maybeSingle()` answers both a missing row and an
   RLS refusal with `{data: null, error}`, and `profileQuery.data || {}` collapsed them into "a
   vendor who has filled in nothing". `profileQuery.error` was never inspected.

**60% is what a real profile with three of five complete produces**, and `nextIncompleteKey`
resolving to `reel` is consistent with `capabilities` and `credentials` both true - which is
exactly what the 0% reading denies. **Two readings, no edit between: the one produced by four
paths of which three are failures is the wrong one.**

**WHAT I CANNOT ESTABLISH FROM SOURCE, AND DO NOT CLAIM: which of the four paths Greg hit**, and
whether 60% was itself the right number for that account. Both need the profile row. **Q2 in
section 7.** It is not needed to justify the fix: three of the four paths are wrong whichever
one fired.

### 2c. THE FIX, AND WHY IT IS CONTAINED

A `profileChecklistState` of `"loading" | "ready" | "failed"`. The bar renders only in
`"ready"`. Both failure paths log with context. `profileQuery.error` now stops rather than
falling through as an empty profile.

**A genuinely empty profile still reaches `"ready"` through the success path and still reads
0%.** That is the case this must not suppress, and it is the only case that now can.

**WHAT IT DOES NOT DO.** The five completeness predicates are untouched, byte for byte. The
brief's 2c condition - report and stop if the cause reaches into what "complete" means across
several surfaces - was the thing to watch, and this change never approaches it: it is entirely
about telling an answer from a placeholder. CLAUDE.md's standing rule, verbatim, is "Never show
loading/empty states during hydration - wait for `isLoading` to be false."

---

## 3. PHASE 3. THE DISCOVERY DOCUMENT.

`docs/101-phase0-baseline.md`, 713 lines. **No feature code, no migration, no ruling answered.**
The three findings that change what a build session does on day one:

1. **Ruling 5 cannot be built as `docs/emitter-rulings-owed.md` describes it.** It says the bid
   analysis site "holds a `partnership_id` by the same route `bid.feedback` and `bid.decline`
   already use". It does not. That resolver is a private, non-exported function in
   `app/api/agency/rfp-responses/[id]/route.ts:122`, and `loadBidAnalysisContext`, which the two
   analysis routes actually use, selects no `partnership_id` anywhere. **Option A begins with an
   extraction into `lib/` with five existing dependants.**
2. **Two of the six have no organization id in scope, and the failure is silent.** `client.edit`
   resolves a SET and never a single write id; `rfp.generate` resolves no organization at all.
   `recordMilestones()` drops an event with a falsy `orgId` before the insert and logs one line
   (`lib/milestone-events.ts:227-233`). **Neither source document mentions that path.**
3. **The act under ruling 1 has two shapes and one does not work.**
   `DELETE /api/partnerships` cannot delete - no DELETE policy on `public.partnerships`, the
   route detects zero rows and returns 501 (`:1392-1404`). The removal that works is `PATCH`
   with `status: 'removed'`.

Also established and in that file: the three gates restated verbatim from 080 and 088 with four
disagreements against the summary named; the 22-emit-site census and the **four** distinct
silent-loss paths inside `recordMilestones` of which the documents name one; per-ruling
estimates ordered by what could ship independently; six stale items including a headline figure
in `docs/emitter-coverage.md` that **contradicts that document's own table** and was wrong at the
commit that shipped it; and the seventh ruling on closure milestones, framed in four options and
**not answered**.

---

## 4. THE GATES. EXACT EXIT CODES.

Branch at `cd1caf8`, `git status --porcelain` empty. `main` measured in a throwaway worktree at
`21ce8de`, `git status --porcelain` empty, **with `node` and the eslint binary invoked directly
and never through `pnpm`.**

| # | Command | main | **branch** | Verdict |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` | **0** | **0** | pass, zero diagnostic lines both sides |
| 2 | `pnpm build` | **not measurable**, see below | **0** | pass, compiled in 8.3s, 72/72 static pages |
| 3 | `pnpm lint` | **1** (182 / 154 / 28) | **1** (**182 / 154 / 28**) | **pre-existing, IDENTICAL count** |
| 4 | `pnpm identity-columns:guard` | **0** | **0** | pass |
| 5 | `pnpm org-id-reads:guard` | **0** | **0** | pass, class A 14 / class B 60, baseline unchanged |
| 6 | `pnpm embed-targets --guard` | **0** | **0** | pass |
| 7 | `pnpm policy-audit:guard` | **1** | **1** | **pre-existing**, reads a static snapshot |
| 8 | `pnpm verify-rls` | **2** | **2** | **pre-existing**, see the note below |

Non-guard variants on the branch, for completeness: `check-identity-columns.mjs` 0,
`check-org-id-reads.mjs` 0, `check-embed-targets.mjs` 0, `audit-policy-snapshot.mjs` 0.

**THE THREE KNOWN FAILURES ARE CONFIRMED ON `main` RATHER THAN ASSERTED.** 182/154/28 for lint,
1 for policy-audit, 2 for verify-rls. All three match the brief's stated values and the numbers
099 and 100 recorded.

**`pnpm build` ON main: NOT MEASURED, AND THE 1 IT PRODUCED IS DISCARDED.** The worktree run
exited 1 with `TurbopackInternalError: Symlink node_modules is invalid, it points out of the
filesystem root`. That is Turbopack refusing the symlink the worktree needed, not a failure of
`main`. **Reporting it as a main-tree failure would have been exactly the false reading this
section exists to avoid.** The build exits 0 on the branch, which is the claim that matters, and
`main` is three commits behind it with no build-affecting difference.

**`pnpm verify-rls` EXITS 2 ON BOTH SIDES, FOR TWO DIFFERENT REASONS, AND BOTH ARE STATED.**
On the branch, in the repo root where `.env.local` exists: `pg_class query error: Could not find
the table 'public.pg_class' in the schema cache`. **That is the brief's stated cause, confirmed
verbatim.** In the worktree, where `.env.local` is git-ignored and therefore absent:
`NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set`. **Same exit code, different
failure.** No credential file was copied into a temporary directory to make the two match.

**ONE FALSE READING I PRODUCED AND THREW AWAY.** A first pass ran the four guard scripts from a
shell loop as `node scripts/$s` with `$s` holding `"check-identity-columns.mjs --guard"` and the
rest. **zsh does not word-split an unquoted parameter expansion**, so each ran as `node
"scripts/check-identity-columns.mjs --guard"` - one nonexistent filename - and returned **1, 1,
1, 1**. Three of those four are wrong. It is recorded because the shape is the same trap the
last run hit with `pnpm`: four plausible numbers from four commands that never ran. What caught
it was `check-org-id-reads` printing **GUARD PASSED** while allegedly exiting 1. The numbers in
the table are from commands with literal arguments.

**Also executed on the branch:** `grep -rl "\](http://" app/ lib/ components/` returns nothing
(CLAUDE.md's markdown corruption sweep). And `git diff main...HEAD | grep "^+"` finds **zero em
dashes or en dashes added by this run**, in code, comments, commit messages or either document.

---

## 5. WHAT THIS RUN COULD NOT ESTABLISH

**No database was read, so nothing below was measured.**

- **Whether any `rfp_closed` or `rfp_not_selected` row exists at all.** Both types shipped on
  2026-09-14. If none exists, section 1e's limit is theoretical and the backfill question is
  moot. Q1.
- **Whether 60% was the correct number for Greg's account**, and which of Phase 2's four
  all-false paths actually fired. Q2 and Q3.
- **Whether the live policies and the two whitelist functions match their migration text.**
  Everything in `docs/101-phase0-baseline.md` section 2 is read from files. Q4 and Q6 there.
- **Whether `public.partnerships` still has no DELETE policy.** Section 3's ruling 1 finding is
  read from a route comment (`partnerships/route.ts:1375-1385`), not from the catalog. Q6 in the
  baseline.
- **Whether a notification row's `data` actually stores what the write site passes.** There is
  no `CREATE TABLE` for `notifications` anywhere in this repository, so the column list cannot be
  read from source at all. This was already Q4 in `docs/notification-routing-report.md` and is
  still open.
- **Anything about live behaviour.** The app was not run. Section 9 is the checklist.

---

## 6. WHICH PHASES ARE INDEPENDENTLY MERGEABLE

**All three. None depends on another.**

| Phase | Commit | Ships alone? | Depends on |
|---|---|---|---|
| 1, closure routing | `6ac5509` | **yes** | migration 099, already applied. Nothing in this run. |
| 2, the completion badge | `a97af0a` | **yes** | nothing. One file, one component, no shared module. |
| 3, the baseline document | `cd1caf8` | **yes** | it is a document and changes no behaviour. |

Phase 1 touches `lib/notifications.ts`, `lib/notification-routing.ts`,
`lib/rfp-closure-copy.ts`, `app/api/agency/rfp-closure/route.ts` and
`app/partner/rfps/[id]/page.tsx`. Phase 2 touches `app/partner/page.tsx`. **The two file sets
are disjoint.**

---

## 7. QUERIES FOR GREG. NONE WERE RUN.

Further queries specific to the emitter rulings are in `docs/101-phase0-baseline.md` section 8.

**Q1. Do any closure notification rows exist, and could one be backfilled?**
```sql
SELECT n.id, n.type, n.created_at, n.data->>'scopeItemName' AS scope, n.data->>'agencyName' AS agency
FROM public.notifications n
WHERE n.type IN ('rfp_closed', 'rfp_not_selected')
ORDER BY n.created_at DESC;
```
EXPECTED: few rows, all with `data->>'inboxId'` absent (they predate this branch).
**Then, for each one, the ambiguity test that decides whether a backfill is safe:**
```sql
SELECT i.scope_item_name, i.project_id, count(*) AS rows_sharing_the_name
FROM public.partner_rfp_inbox i
WHERE i.status IN ('closed', 'not_selected')
GROUP BY 1, 2 HAVING count(*) > 1;
```
EXPECTED no rows. **Any row here is a scope name that identifies more than one closed request,
and a backfill keyed on the name alone would route some vendor to the wrong one.**

**Q2. THE ONE THAT SETTLES PHASE 2. What does that vendor's profile actually hold?**
Substitute the account that showed 60% and then 0%.
```sql
SELECT id, email,
       coalesce(jsonb_array_length(capabilities), 0) AS capability_count,
       coalesce(jsonb_array_length(credentials), 0)  AS credential_count,
       nullif(btrim(reel_url), '') IS NOT NULL       AS has_reel,
       (nullif(btrim(legal_entity_name),'') IS NOT NULL
        AND nullif(btrim(legal_entity_type),'') IS NOT NULL
        AND nullif(btrim(legal_ein),'') IS NOT NULL
        AND nullif(btrim(legal_address),'') IS NOT NULL
        AND nullif(btrim(legal_state_of_incorporation),'') IS NOT NULL) AS legal_complete
FROM public.profiles WHERE email = 'gmarkant@gmail.com';
```
EXPECTED: `capability_count > 0` and `credential_count > 0`. **If both are zero, 0% was the
correct reading and 60% was the wrong one, and Phase 2's diagnosis in section 2b is inverted** -
the fix still stands, because three of the four all-false paths are failures either way, but the
report would be wrong about which number was true.

**Q3. Does that account have an ACTIVE partnership at all?** `payments` can only ever be true
when one exists, so a vendor with none is capped at 80% by construction and the badge can never
reach 100.
```sql
SELECT status, count(*) FROM public.partnerships
WHERE vendor_org_id IN (SELECT org_id FROM public.org_members WHERE user_id =
  (SELECT id FROM public.profiles WHERE email = 'gmarkant@gmail.com'))
GROUP BY 1;
```
EXPECTED at least one `active`. **No active row means "100% Complete" is unreachable for that
account and the badge never goes away**, which is a product question nobody has asked.

**Q4. Is the notifications type CHECK still the thirteen?** Carried forward from
`docs/notification-routing-report.md` Q2 because this run added no type and relies on both
closure types being permitted.
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
```
EXPECTED: thirteen values including `rfp_closed` and `rfp_not_selected`.

---

## 8. WHAT TO REVERT IF SOMETHING IS WRONG

| If this is wrong | Revert | Cost |
|---|---|---|
| **The whole of Phase 1** | `git revert 6ac5509` | Closure notifications go back to `/partner/rfps?tab=closed` and the email back to `/partner/rfps`. Nothing else moves. |
| **Only the email deep link** (the one item not in the brief) | Restore `ctaUrl: ${baseUrl}/partner/rfps` and `ctaText: "View your requests"` in `app/api/agency/rfp-closure/route.ts` | Three lines. The bell keeps its record destination; the email goes back to being the coarser of the two. |
| **Only the Status-tab closure notice** | Remove the `{rfpClosureState && ...}` block in `app/partner/rfps/[id]/page.tsx` | The My Bid banner is untouched and keeps working. `closureVendorNotice()` can stay; it has one caller either way. |
| **Only the routing, keeping the payload** | Restore the `rfp_closed` / `rfp_not_selected` case in `lib/notification-routing.ts` to `return "/partner/rfps?tab=closed"` | One case block. `data.inboxId` keeps being written and is simply unread, which costs nothing and leaves the identifier there for a later attempt. |
| **The whole of Phase 2** | `git revert a97af0a` | The badge goes back to rendering 0% during load and after a failed read. |
| **Phase 3** | `git revert cd1caf8` | Deletes a document. No behaviour changes. |

**Nothing in this run needs a migration reverted, because none was written.** Nothing needs a
policy restored, because none was touched.

---

## 9. THE LIVE CHECKLIST

Two accounts. **`gmarkant@gmail.com`**, the "m a r k a n t" lead agency. **A vendor account**
with at least one open RFP from that agency, which may be the same login switched to vendor
mode. Where a step needs two different companies it says so, because a dual-role account cannot
perform it.

Steps 1 to 5 are the mandatory three plus what they depend on. **Do them in order** - step 1
creates the state the rest read.

---

**1. CLOSE ONE VENDOR ON AN RFP, AS THE AGENCY.**
Sign in as `gmarkant@gmail.com` in the agency portal. Open an RFP that has at least one vendor
whose status is New or Viewed and who has not bid. Use the per-vendor action to mark that one
vendor **not selected**.
**EXPECT:** a success result naming one row closed. That vendor's row moves out of the open set.
Every other vendor on the same RFP is untouched.
**IF THE ACTION 500s:** migration 099 is not applied on this project. Stop; nothing below can
pass.

**2. THE MANDATORY ONE. CLICK THE NOTIFICATION AND CONFIRM IT LANDS ON THAT REQUEST.**
Sign in as the vendor. Open the notification bell.
**EXPECT:** a row titled "Update on a request from m a r k a n t". **Click it.**
**EXPECT: the browser lands on `/partner/rfps/<a uuid>`, the detail page for the exact scope
item you closed in step 1 - NOT `/partner/rfps` and NOT `/partner/rfps?tab=closed`.** Check the
address bar for the uuid and check the scope name on the page against step 1.
**IF IT LANDS ON THE LIST:** the row was written before this branch and has no `inboxId`, which
is section 1e's limit working as described. Redo step 1 on a second vendor to get a fresh row.

**3. THE MANDATORY ONE. CONFIRM THE PAGE OFFERS NO BID FORM.**
Still on the page from step 2, **on the tab it opened on**, which should be **Status &
Feedback**.
**EXPECT:** a status chip reading **"Not Selected"** in orange, and beneath the outcome blocks a
sentence beginning "m a r k a n t has decided not to move forward with your company on this
request." **That sentence is what Phase 1a added. If the chip is there and the sentence is not,
Phase 1a did not ship.**
Now click **My Bid**.
**EXPECT:** the same sentence at the top, a read-only summary ending "This bid is read-only in
its current state.", **no proposal field, no budget field, no attachments control, and no sticky
Save draft / Submit bar at the foot of the window.** Scroll to the bottom to confirm the bar is
absent.
**IF A SUBMIT BUTTON IS VISIBLE:** stop and report it. That is the 42501 the brief warned about
and section 1a says does not exist.

**4. THE MANDATORY ONE. CONFIRM A VENDOR CANNOT REACH ANOTHER COMPANY'S ROW.**
Still signed in as the vendor, copy the URL from step 2 and **change one character of the uuid**
(for example the last digit).
**EXPECT: a red panel reading "Not found".** No RFP content, no scope name, no agency name, no
bid form.
**Then the real test, which needs a second company.** Take the inbox row id of an RFP belonging
to a DIFFERENT vendor - from the agency portal, or from a second vendor account - and open
`/partner/rfps/<that id>` as the first vendor.
**EXPECT: the identical "Not found" panel.** Byte for byte the same as the invented uuid above.
**IF THE TWO DIFFER IN ANY WAY** - a different message, a different status code visible in the
network tab, a longer pause - report it: a distinguishable answer tells an attacker which
identifiers are real.

**5. THE EMAIL LANDS ON THE SAME RECORD.**
Open the mail sent by step 1, subject "Update on <scope> from m a r k a n t".
**EXPECT:** a button reading **"View this request"**. Click it.
**EXPECT:** the same `/partner/rfps/<uuid>` page as step 2, after a sign-in if the session has
expired. **Not `/partner/rfps`.**
Confirm the mail says nothing about a bid being "declined" or "rejected" anywhere, in any
casing. That vendor never bid.

**6. THE OTHER CLOSURE EVENT READS DIFFERENTLY.**
Back as the agency, on a different RFP, close the **whole RFP** for every vendor who has not bid.
**EXPECT:** a count of rows closed. Then as the vendor: a bell row titled "An RFP you were
invited to has closed", clicking through to that specific request, whose Status tab chip reads
**"Closed"** in grey and whose sentence says the request "ended for everyone who was invited"
and that "It stays here as a record."
**THE POINT OF THIS STEP:** step 3's message and this one must not read as each other. One is a
decision about this vendor; the other is not about them at all. If they read the same, the copy
regressed.

**7. A CLOSURE DOES NOT TOUCH A SUBMITTED BID.**
On an RFP where one vendor HAS submitted a bid, close the whole RFP.
**EXPECT:** the closed count excludes that vendor. Their status stays `bid_submitted` and their
bid is still visible to the agency under Vendor responses. **Closing twice returns the same calm
result with a count of 0 and sends no second notification.**

**8. PHASE 2. THE COMPLETION BADGE.**
Sign in as the vendor and load the dashboard, **watching the top of the page as it loads**.
**EXPECT: no badge at all until the number arrives**, then either a percentage with a next step,
or nothing if the profile is complete. **You should never see "0% Complete - Add your
capabilities" flash and then change.** That flash was the defect.
**THEN, THE HALF THAT NEEDS DEV TOOLS.** Open the network tab, block or throttle
`/api/partnerships` to failure, and reload.
**EXPECT: the badge does not render at all**, and the browser console carries
`[partner/dashboard] profile completion inputs failed, badge suppressed`.
**IF A 0% BADGE APPEARS INSTEAD**, Phase 2 did not ship.

**9. THE PERCENTAGE IS THE RIGHT ONE.**
With the badge showing, compare its number against the profile. Five items at 20 points each:
capabilities, credentials, reel or portfolio link, the five legal fields, and rate information
on an active partnership.
**EXPECT:** the percentage equals 20 x the number complete, and the sentence names the FIRST
incomplete one in that order.
**IF THE NUMBER IS RIGHT AND THE SENTENCE NAMES A LATER ITEM**, report it. **If the badge sits
at 80% with everything filled in**, check Q3 in section 7: rate information needs an active
partnership to be reachable at all.

**10. NOTHING ELSE MOVED.**
As the agency, open the bell and click a **bid submitted** row.
**EXPECT:** `/agency/bids?response=<uuid>`, exactly as before this branch. Phase 1 changed two
notification types and no others, and this is the cheapest confirmation that the routing module
still behaves for the rest.
