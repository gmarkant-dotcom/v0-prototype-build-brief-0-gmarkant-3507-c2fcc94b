# Unattended session, 2026-08-20

**Started at:** `e4d7d24` plus the uncommitted bid-decline scope name fix
**Ended at:** `383b28d`
**Pushed:** nothing. Six commits, all local, each item on its own commit.
**Database:** not written to. No migration applied, authored or run.

---

## Baseline check, before any work

All eight gates matched the stated baseline exactly:

| Gate | Expected | Observed |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `pnpm build` | 0 | 0 |
| `pnpm lint` | 1 (183 / 154 err / 29 warn) | 1 (183 / 154 / 29) |
| `verify-rls` | 2 | 2 |
| `policy-audit:guard` | 1 | 1 |
| `identity-columns:guard` | 0 | 0 |
| `embed-targets` | 0 | 0 |
| `org-id-reads:guard` | 0, Class A 14, Class B 62 | 0, Class A 14, Class B 62 |

Nothing else differed, so I proceeded. The pending fix was committed first and alone as
`bc5cedc`.

---

## Gates at the end

| Gate | Baseline | Now | Moved? |
|---|---|---|---|
| `tsc --noEmit` | 0 | 0 | no |
| `pnpm build` | 0 | 0 | no |
| `pnpm lint` | 183 / 154 / 29 | **182 / 154 / 28** | **yes, down 1 warning** |
| `verify-rls` | 2 | 2 | no |
| `policy-audit:guard` | 1 | 1 | no |
| `identity-columns:guard` | 0 | 0 | no (moved to 1 mid-session, fixed properly - below) |
| `embed-targets` | 0 | 0 | no |
| `org-id-reads:guard` | 0, A 14, B 62 | 0, A 14, **B 61** | **yes, one Class B site gone** |

**No allow-list was added to or widened anywhere.** Both movements are reductions caused by
deleting dead code, and both are reported here rather than absorbed:

1. **lint 29 -> 28 warnings.** `lib/vouch-counts.ts` line 81 carried an
   `eslint-disable @typescript-eslint/no-explicit-any` on the `from` member of
   `VouchCapableClient`. That directive was itself being reported as an *unused* directive in
   the baseline run. `from` existed only to serve the two 082 fallbacks, so it left with them
   (item 3) and took its warning with it. Errors unchanged at 154.

2. **Class B 62 -> 61.** The deleted fallback contained
   `.eq("vendor_org_id", partnerId)`, a recorded Class B site. Verified by restoring the old
   file, which puts it straight back to 62. The guard still exits 0.
   **One thing for you:** the guard now prints `lib/vouch-counts.ts recorded 1, found 0` -
   its `KNOWN_OPEN_MIRROR` still lists a site that no longer exists. Pruning that stale
   record is a one-line edit I deliberately did not make, since the gate passes without it
   and editing a guard script was off limits.

3. **identity-columns:guard 0 -> 1 -> 0, mid-session.** My first draft of a replacement
   comment in `lib/vouch-counts.ts` spelled the pre-079 vouched-partner column name in order
   to explain what would break if the RPC were recreated from an old file. The guard scans
   comments too and flagged it - which is the guard doing its job. I reworded the comment to
   describe the column without naming it. I did not add an exemption.

---

## What was done

| # | Item | Outcome | Commit |
|---|---|---|---|
| 0 | Pending bid-decline fix | committed alone | `bc5cedc` |
| 1 | `next.config.mjs` hygiene | 3 of 4 fixed, 4th reported | `f843574` |
| 2 | Stale comments + dead 42P01 branch | fixed | `affeb4c` |
| 3 | Dead 082 fallbacks | deleted | `7232919` |
| 4 | Placeholder audit | 1 found and fixed, 2 reported | `4a25e0c` |
| 5 | Notification writer | fixed | `383b28d` |
| 6 | Guest feedback CTA | report only | below |
| 7 | Multi-scope broadcast count | report only | below |
| 8 | Migration 081 | report only | below |
| 9 | Company naming at signup | report only | below |
| 10 | Cleanup inventory | report only | below |
| 11 | The two non-gates | report only | below |

Nothing was timeboxed out. Nothing needed a product ruling mid-flight that stopped an item,
though items 4 and 9 each surfaced one, and both are written up rather than guessed at.

---

# Items 1-5: what changed

## 1. `next.config.mjs` hygiene - three fixed, one reported

Every claim was checked against the installed package rather than from memory.

**Fixed:**

- **`experimental.instrumentationHook`** - removed in Next 15. The key does not appear
  anywhere in `next/dist/server/config-shared.d.ts` at 16.1.6, and the build logged it as
  unrecognised. `instrumentation.ts` has therefore been loading on its filename alone the
  whole time. Deleting the key changes nothing but the warning.
- **`experimental.turbo` -> top-level `turbopack`** - graduated in Next 15.3. Same
  `TurbopackOptions` type (`config-shared.d.ts:1017`, `resolveExtensions` at `:113`).
- **Sentry `disableLogger` -> `webpack.treeshake.removeDebugLogging`** - this is the exact
  rewrite the SDK's own compatibility shim performs before warning
  (`config/withSentryConfig/deprecatedWebpackOptions.js:76-83`). Worth knowing: **neither
  form does anything on this project.** The `webpack.*` options are documented in the SDK's
  own types as having no effect under Turbopack, which is what Next 16 builds with. So this
  trades a no-op that warns for a no-op that does not. Kept rather than deleted so the intent
  survives if this ever builds under webpack again.

Build output before: four warnings. After: one.

**NOT done - the `middleware` -> `proxy` rename. It is not mechanical.**

`next/dist/build/entries.js` `runDependingOnPageType()` routes a **proxy** file to
`onServer()` unconditionally, while a **middleware** file goes to `onEdgeServer()` unless it
exports `runtime = 'nodejs'`. `middleware.ts` exports no `runtime`, and the built
`middleware-manifest.json` confirms it lands in the edge bundle today
(`server/edge/chunks/...`).

So the rename moves the auth gate for **every non-API request in the product** from the edge
runtime to Node.js. It also requires renaming the export: the entry template resolves
`(isProxy ? mod.proxy : mod.middleware) || mod.default`, so `proxy.ts` must export `proxy`.

Mechanically it is: `git mv middleware.ts proxy.ts`, rename `export async function middleware`
to `proxy`, and update the two references in `CLAUDE.md`. About ten minutes. The runtime
change underneath it is the part that needs your call, not mine - cold start behaviour,
region behaviour and `createMiddlewareClient` all move. Next has not set a removal date, so
the warning is not urgent.

## 2. Six stale comments, and a branch that never once fired

**The comments.** Six sites stated that `milestone_events.org_id` has no foreign key, so a
user id written there "raises nothing" and costs only visibility. 080 as applied puts
`milestone_events_org_id_org_fkey REFERENCES organizations(id) ON DELETE CASCADE` on that
column (`080:227-229`). The write now raises **23503**. The comments described the opposite of
the behaviour.

The same six also quoted the policy as `org_id = ANY (current_user_org_ids())`. The applied
policy is `org_id IN (SELECT public.current_user_org_ids())` (`080:341`). `= ANY` on a
`SETOF`-returning function raises **42809** - the bug that made 080 fail the first time.
Quoting the wrong form in six call-site comments is exactly how it comes back.

Sites: `lib/milestone-events.ts:153`, the three emit blocks in
`app/api/agency/rfp-responses/[id]/route.ts`, `broadcast-rfp/route.ts:555`,
`partnerships/route.ts:626`, plus the module header, which still announced 080 as
authored-and-unapplied.

**The branch.** `recordMilestones` special-cased `error.code === "42P01"` to log a missing
table at WARN naming migration 080. **It never fired, not once.** A PostgREST request against
an unknown relation never reaches the planner - the table is absent from the schema cache and
the client is answered `PGRST205`. So the one readable "migration not applied yet" signal
this module was built to produce, during the entire window when 080 genuinely was not
applied, went out at ERROR through the generic branch instead, every single time.

I kept the branch rather than deleting it, because the distinction it draws is still real:
"the table is not there" needs different action from "the insert was rejected". It now tests
`PGRST205` first and `42P01` second - which is precisely what `lib/notifications.ts:57` has
always done, so the precedent was already in the repo. `42P01` stays because a direct SQL
path would return it and this module takes whatever client it is handed. The message is
rewritten: with 080 applied, a missing table means a stale cache or the wrong database.

Also corrected `count: events.length` to `usable.length` in that branch - it reported the
pre-filter count for a post-filter insert, unlike the two branches beside it.

## 3. The two 082 fallbacks, deleted

`lib/vouch-counts.ts:54` carried the instruction: *"AFTER 082 PHASE 2 IS APPLIED AND
VERIFIED, DELETE THE FALLBACK."* Both phases are applied and verified. Both blocks are gone,
along with `isFunctionMissing()`, the `PGRST202` constant, and the `from` member of
`VouchCapableClient` that existed only to serve them. The module can no longer reach
`partner_vouches` directly even by accident.

**These were not merely unreachable - they were a trap.** The fallback was correct only while
the `USING (true)` policy existed to permit the table read. 082 phase 2 dropped that policy,
and a filtered count does not fail, it returns 0. A fallback firing today would answer every
vouch badge in the product with a silent zero: no error, no log line, no 500, and a vendor
with no vouches looking identical to a vendor whose count stopped working. That is the exact
failure 082's own STOP GATE was written to prevent. Dead code that cannot run is untidy; dead
code that can run and quietly answers wrong is something else.

An RPC error is now just an RPC error: log the code, return an empty count, which is what all
three call sites already did on a failed query. A `PGRST202` in those logs now means the 082
functions are missing from the schema cache and every badge is reading zero - that log line
is the entire warning system, which is why the code is in it.

## 4. Placeholder audit - all six emitters, every payload field

**Found and fixed: one, the exact sibling of the scope title.** `bid.award` wrote
`project_name: projectName`, and `projectName` is `rawProjectName || "Project"` - the string
composed for the award email. Now `rawProjectName || null`.

It is **not currently visible**, and I fixed it anyway. `lib/activity-feed.ts` resolves the
project name from `project_id` and never from a payload, and `payloadString` reads exactly one
key, `scope_item_name`. So nothing renders this field today. But `bid.award` is on the
vendor-visible whitelist and RLS grants the whole row, so the payload as written tells a
vendor their project is called "Project" - and the next reader of the field walks into the
same trap the scope title just sprang, where a placeholder is non-empty enough to pass every
guard and defeat the fallback below it.

**Clean: the other five.** `bid.decline` and `bid.feedback` already write `raw... || null`.
`rfp.broadcast` reads all four fields straight off the row with `?? null`. The three
`partnerships` emits carry only real values - a normalized email, booleans, a timestamp, and
the literal `'terminated'`, which is a fact about the branch rather than a stand-in.

**Reported, not fixed: two.**

**(a) `broadcast-rfp/route.ts:186` persists the literal `"Scope"`** into
`partner_rfp_inbox.scope_item_name`, upstream of every emitter that later reads it. If it ever
fires, `rawScopeItemName` is `"Scope"` - non-empty - so `bid.award`, `bid.decline` and
`bid.feedback` all store it, `payloadString` accepts it as a real title, the feed renders
"awarded the bid on Scope", and the email subject reads "You've been awarded Scope".

**This is not the same defect, which is why I stopped.** `scope_item_name` is
`TEXT NOT NULL` (`scripts/013-partner-rfp-inbox.sql:12`). The writer *cannot* pass null; the
placeholder is a constraint guard, not laziness. What makes it worth a ruling is that the
guest writer disagrees with it: `magic-link/route.ts:103` stores
`String(body.scope_item_name || "").trim() || null` for the same value. Two writers of one
column, two conventions, and only the NOT NULL one poisons the source every downstream reader
trusts.

Options:

| Option | Cost | Note |
|---|---|---|
| Write `""` instead of `"Scope"` | ~5 min, one line | Satisfies NOT NULL. Every reader in the repo already does `.trim() \|\| fallback`, and `payloadString` rejects empty strings, so a blank flows correctly through all of them. Cheapest honest fix. |
| Reject the broadcast with a 400 | ~15 min | The route already 400s on a missing `scopeItem.id` two lines above; this is symmetric. Hardest to get wrong later, but it can fail a broadcast that works today. |
| Drop the NOT NULL, write null | migration + code | Matches the guest writer exactly. Not worth a migration on its own. |
| Leave it | 0 | Defensible if a nameless scope item is unreachable. |

I could not settle reachability from source: `si.name` originates in the brief/scope-item
builder and the route validates `scopeItem.id` but never `scopeItem.name`. **A live check
settles it:** `SELECT count(*) FROM partner_rfp_inbox WHERE scope_item_name = 'Scope';`

**(b) `notifyProjectAwarded`** receives the same `"Project"` / `"Lead agency"` placeholders
and persists them into `notifications.message` and `notifications.data`. Left alone
deliberately: `message` is a rendered sentence that genuinely needs some string, `data` merely
mirrors it, nothing reads `data.projectName`, and the fate of that whole table was the open
question in item 5.

## 5. The in-app notification writer

**The WARN was right that the fallback was wrong. It was wrong about why.** The reason it
fired is narrower and worse than a missing migration.

`org_members` carries exactly one SELECT policy, and it is self-row-only:
`USING (user_id = auth.uid())` (`079:1736`). `079:1731` explains that this is deliberate - a
policy on `org_members` that subqueries `org_members` recurses until 42P17 aborts the query -
so the shape is load-bearing and is not going to change.

On the caller's own client that policy makes `resolveOrgMemberUserIds` unable to answer its
own question:

- Notifying a **counterparty** organization, which is what nearly every call site here does -
  an agency telling a vendor they won, a vendor telling an agency a bid landed - matched
  **zero rows**. The caller holds no membership row in the other company. Straight to the
  fallback, every time, for every account, legacy sixteen included.
- Notifying the caller's **own** organization matched exactly **one** row: the caller's. So
  *"EVERY MEMBER OF THE ORGANIZATION"* - the ruling this file opens with and claims for all
  sixteen call sites - could not have been carried out even in the best case. A colleague was
  never going to be told anything.

**One correction to the brief.** On a session client the bad row is usually not written and
left unreadable; it is **refused**. The INSERT policy is
`user_id = auth.uid() OR user_id IN (current_user_active_counterparty_user_ids())`, and that
helper returns **user ids** (`079:801-803`). An organization id created after 079 is in no
`org_members.user_id`, so the insert fails RLS and logs. The unreadable-row outcome is real
but confined to the service-role call sites (the guest token routes), which bypass RLS - and
those are precisely the sites where the member read *worked* all along.

**The fix.** The member read now runs on the service role, in the narrow shape
`lib/server/account-existence.ts` already established: one query, for one organization the
calling route has already authorized action on. Nothing about who *may* act is decided there,
only who is told.

**The fallback is deleted, not relocated.** With a read that can see rows, empty means the
organization has no members - and every organization has an owner row by construction:
`079:366` backfills one per profile, and the PHASE 12 signup trigger (`079:1918`) inserts one
for every account since. Empty is a bad org id or a broken invariant, and writing a row
addressed to an organization id repairs neither. It logs at ERROR and writes nothing.

**One thing the fix forced.** A multi-row INSERT is a single statement, so a `WITH CHECK`
failure on any row rolls back all of them. That did not matter while this resolved one id; it
does now that it resolves a real member list, because a mixed batch is reachable - notifying
your own organization permits your row and refuses every colleague's, which would have
discarded your own notification along with theirs. On a batch error it now retries per
recipient and delivers what is permitted, logging what landed. No row faces a weaker policy
than it faced inside the batch. In practice a no-op today: all 16 orgs have exactly one
member, so every batch is one row.

**Still yours, still unchanged: the INSERT policy.** Its helper is active-partnership-only
(`079:779-803`), so invitations and declines stay refused, exactly as
`partnerships/route.ts:1145` already documents. What *does* change: for an **active**
partnership the resolved ids are exactly the ids that helper returns, so those notifications
now land, and land for every member instead of for one coincidental id.

### I did not conclude the table should be retired

You asked me to stop and say so if I thought it was due for deletion. I do not think it is,
and here is the reasoning so you can overrule it cheaply.

`notifications` and `milestone_events` are not two implementations of one idea:

| | `notifications` | `milestone_events` |
|---|---|---|
| Grain | one row per **recipient** | one row per **event** |
| Lifecycle | mutable - read/unread | append-only |
| Reads | `user_id = auth.uid()` | org-scoped + counterparty-scoped |
| Actor | none | `actor_id` / `actor_side`, the whole point |
| Purpose | an inbox you clear | an attribution log you cannot |

Collapsing them means giving `milestone_events` per-user read state, which makes an
append-only attribution log mutable and per-recipient - which is the thing it was created not
to be. The honest criticism of `notifications` is not that it duplicates the feed, it is that
**its INSERT policy is too narrow for its own call sites** - and that is one policy decision,
not a table retirement. Fixing that is a smaller change than the migration a merge would cost.

---

# Items 6-11: reports only, nothing changed

## 6. Where a guest with no inbox row lands

**The link.** The feedback email's CTA is
`` `${baseUrl}/partner/rfps/${existing.inbox_item_id}` ``. On a row where `inbox_item_id` is
null, JS template interpolation renders the string `"null"`, so the CTA is
`/partner/rfps/null`. The decline mail links the unparameterised `/partner/rfps` and is fine.

**Where it lands, in order:**

1. `middleware.ts` protects `/partner`. An addressee with no session is redirected to
   `/auth/login?next=/partner/rfps/null`. A guest bidder has no account by definition, so for
   them the CTA never resolves to anything at all - they are asked to log in to an account
   they do not have.
2. With a partner session, the page loads. `app/partner/rfps/[id]/page.tsx:511` takes
   `id = "null"` (a legitimate string) and fetches `/api/partner/rfps/null`.
3. The route runs `.eq("id", "null")` against a `uuid` column
   (`app/api/partner/rfps/[id]/route.ts:24`). It returns either **404 "Not found"** or
   **500 "Failed to load RFP"** depending on how PostgREST coerces the literal `null` in an
   `eq` filter. **I could not settle which without hitting the database, and I did not.**
   It does not change the outcome: both land on the page's error branch and the RFP is never
   shown.

**The mail usually does not ship at all, which narrows this.** The feedback email is guarded
by `if (partner?.email)`, and `partner` comes from
`resolveOrgNotificationRecipients(existing.vendor_org_id, supabase)`, which returns `[]`
immediately when `vendor_org_id` is null. The sample guest row in
`docs/bid-decline-scope-name-fix.md` has `vendor_org_id: null`. So the broken CTA only
materialises for a bid with **a vendor org but no inbox row** - a magic-link invite to an
account that already exists, or a guest who has since claimed one. The count that matters is
the intersection, not the eight:

```sql
SELECT count(*) FROM partner_rfp_responses
 WHERE inbox_item_id IS NULL AND vendor_org_id IS NOT NULL;
```

**Options for where they should land:**

| Option | Cost | Note |
|---|---|---|
| **`/partner/rfps` (recommended)** | ~5 min | Match the decline mail, which is already correct. The index page **already handles this shape**: `app/partner/rfps/page.tsx:238` guards `if (bid.inbox_item_id)` before rendering a link. Consistent with the award mail, which also links `/partner/rfps`. |
| Link the magic token instead | ~30 min | `/rfp/respond/${token}` is the surface the guest actually knows and needs no account. Best experience; needs the token fetched at send time and a think about re-exposing a live token in a second email. |
| Conditional: token if guest, inbox if not | ~45 min | Strictly best, most branches. |
| Suppress the CTA when unresolvable | ~10 min | `buildBrandedEmailHtml` would need to tolerate a missing CTA. |

My recommendation is the first, and it is the same one-line shape as the decline mail
alongside it. **Not changed, as instructed.**

## 7. The multi-scope broadcast count, and whether `batch_id` breaks the invariant

**Confirmed, and it is worse than "one timestamp".** The loop at
`broadcast-rfp/route.ts:176` iterates scope items and accumulates into one `rows` array;
`recordMilestones` is then called **once** with `rows.map(...)`. So for 3 scopes to 20
vendors, all 60 rows share:

- one `created_at` (one statement, one transaction, one `now()`)
- one `event_type`, one `actor_id`, one `subject_type`
- **one `subject_id`** - `row.project_id`, and all three scopes belong to the same project

`milestoneGroupKey` (`lib/activity-feed.ts:158`) is
`event_type | actor | subject_type | subject_id | created_at`. Every component is identical
across all 60. They collapse into **one group of 60**, and `recipients()` renders
"to 60 vendors" for 20 vendors. Three times the truth.

### The tension you named, argued

The invariant at the emit site says every payload field must be about the one recipient this
row is for. A `batch_id` is about the batch. Taken literally, it is a violation.

**I think it is acceptable, and the reason is that the invariant's purpose survives it.**

That invariant exists because `rfp.broadcast` is on the vendor-visible whitelist and RLS
grants the **whole row**, `payload` included, to the vendor behind that row's
`partnership_id`. The thing it was written to prevent is a vendor learning about *other
vendors*. `recipient_count: rows.length` was removed because it did exactly that: a plain
integer telling each vendor the size of the field they were bidding against.

A `batch_id` is not that. It is an opaque uuid. A vendor reading their own row sees a random
identifier and can learn nothing from it: not the batch's size, not its membership, not
whether anyone else exists. They cannot enumerate rows sharing it, because RLS filters by
partnership, not by payload - a `WHERE payload->>'batch_id' = ...` from a vendor returns only
their own row, the one they already had. **Zero marginal disclosure**, where `recipient_count`
had direct disclosure. The distinction is not "is this field about the batch" but "can the
counterparty *learn* anything from it", and on that test an opaque token passes cleanly.

**That said, I would not put it in the payload.** If it can go in a column it should, because
then the invariant is not even engaged and the feed can index and group on it directly. That
needs a migration, which is yours.

### The proposal that needs neither, and is what I actually recommend

**Do not add `batch_id` at all. Count distinct vendors instead of counting rows.**

The sentence claims "to N vendors". Today `count` is `rows`. Make it distinct
`vendor_org_id` within the group, falling back to `partnership_id`, then row identity:

- In `groupMilestoneRows` (`lib/activity-feed.ts:213`), `MilestoneGroup` gains a
  `Set<string>` of vendor keys; `count` becomes that set's size rather than an increment.
- `MilestoneFeedRow` already carries `vendor_org_id` and `partnership_id`, so **nothing new is
  read, stored or disclosed**.
- `countIsPartial` still works: a group cut by the fetch ceiling makes the distinct count a
  floor, exactly as it makes the row count a floor.

3 scopes to 20 vendors then reads "to 20 vendors", which is true. It costs one file, no
migration, no emitter change, and no argument about the invariant at all. The only thing lost
is "across 3 scopes", which was never rendered.

The grouping **key** stays as it is. The bug is in what is counted, not in what is grouped.

**Not implemented, as instructed.**

## 8. Migration 081

| | |
|---|---|
| **What it is** | `081_scope_document_and_message_inserts.sql` - gives the `project_documents` and `project_messages` INSERT policies the project scoping they had never had. Two `DROP POLICY` (deliberately without `IF EXISTS`, so a stale name aborts rather than silently leaving the unscoped policy beside the new one) and two `CREATE POLICY`. |
| **Size** | 309 lines, 14,465 bytes. Roughly 110 lines of statements; the rest is header, stop gate and verification. |
| **Applied?** | **Yes.** Its own header: *"APPLIED 2026-08-17 and VERIFIED. This file records what actually ran."* With recorded results: both new names present, both old gone, exactly one INSERT policy per table, totals 5 and 4, schema-wide total 104. |
| **`BEGIN;`** | line **147** |
| **`COMMIT;`** | line **255** |

**The `= ANY (...)` at 167 and 178 are inside comments.** They are `079:` instruction comments
telling a *future* migration what the predicate should become. They were never executed, so
they never had the chance to raise 42809 the way 080's did. As authored and run, 081's
policies used the pre-079 columns: `p.agency_id = auth.uid()` and `pt.partner_id = auth.uid()`.

**But 081 is broken now, and not for that reason.** A policy body is stored as a parsed
expression tree referencing columns by attribute number, not as text. 079's PHASE 5 renames
silently rewrote both predicates into `p.org_id = auth.uid()` and
`pt.vendor_org_id = auth.uid()` - **an organization column compared to a user id, in both
halves** - and raised nothing, because from Postgres' point of view nothing changed. 079's
PHASE 4 drop list could not have caught it: 081's policies did not exist when that list was
written.

Not a lockout today, because the 16 backfilled organizations have
`organizations.id = profiles.id`. **It becomes a hard lockout at the first signup after 079** -
`new row violates row-level security policy` on every document upload and every message send,
for every new customer, from their first day.

**Repairing it is already written: migration `083_orphaned_insert_policies.sql`**, with a down
file. It drops and recreates both policies using
`IN (SELECT public.current_user_org_ids())` - the correct form, not `= ANY` (`083:230, 241,
281, 295`). It carries a STOP GATE and its header says **AUTHORED, NOT APPLIED**.

**One caveat I could not resolve without the database.** Those headers are self-reported.
084, 085 and 086 also say "NOT APPLIED", yet you have told me 087 *is* applied, and the live
policy count is 113 against the 104 that 081 recorded - a delta of 9 that something must
account for. So at least one of those headers is stale. Before doing anything with 083:

```sql
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('project_documents','project_messages')
   AND cmd = 'INSERT';
```

If `with_check` still reads `auth.uid()`, 083 is genuinely unapplied and is the repair. **I
did not repair or apply anything.**

## 9. Company naming at signup

**Where the name is set.** Exactly one place: the `handle_new_user()` trigger, PHASE 12 of
079 (`079:1896-1901`):

```sql
org_name := COALESCE(
  NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'company_name','')), ''),
  NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'full_name','')),   ''),
  NULLIF(split_part(COALESCE(NEW.email,''), '@', 1),                 ''),
  'Untitled organization'
);
```

**What a real vendor signing up as `sarah@gmail.com` is called.** The signup form
(`app/auth/sign-up/page.tsx:162`) sends `company_name` and `full_name` in the metadata, and
Company Name is marked `required` - so through the UI she is called whatever she typed, and
the chain never advances. That `required` is **HTML-only**: not revalidated server-side, and
`supabase.auth.signUp` accepts any metadata. Bypass the form and she is called **`sarah`** -
the local part of her address. `Untitled organization` needs the email to be empty too, so it
is effectively unreachable.

**On your live values.** `71`, `63`, `64` as organization names are the first branch, not a
fallback: something sent `company_name: "71"`. Consistent with plus-addressed test accounts -
note `split_part('gmarkant+71@gmail.com','@',1)` is `gmarkant+71`, not `71`, so these were
typed, not derived.

**`icloud` is not an organization name and does not come from this trigger.**
`partner_display_name` is a different field with a different source: for a guest bid it is
`` (tokenRow.vendor_name || "").trim() || vendorEmail `` (`app/api/rfp/guest/[token]/route.ts:481-483`),
and `vendor_name` is **free text the agency typed into the magic-link invite**
(`app/agency/page.tsx:1287`). So `icloud`, `g`, `gg`, `pool`, `partner36` are agency-side data
entry, not signup derivation. An email provider did become a display name - but because
someone typed it into an invite box, not because any code split a domain.

**Can they change it? No - and this is the real finding.**

- There is **no code anywhere in the repository that updates `organizations`**. Zero
  `.update()` or `.upsert()` calls against that table in `app/` or `lib/`. `organizations.name`
  is written exactly once, by the trigger, and never again.
- An RLS policy permitting it *does* exist - `"Org admins update their organization"`
  (`079:1797`) - so the database is ready and the product never shipped the UI.
- Both "Company Name" fields users can actually edit write **`profiles.company_name`**:
  `app/agency/settings/profile/page.tsx:258` and `app/partner/profile/page.tsx:632`.
- But counterparties see **`organizations.name`**, via `resolveOrgContact` in
  `lib/org-contact.ts` (its header: *"The company name resolves cleanly to
  organizations.name"*).

**So editing your company name changes what you see and not what your partners see.** The two
are seeded from the same value at signup and diverge permanently at the first edit. That is a
bigger problem than the bad defaults, and it is not a naming bug - it is a missing write path.

**What I would do, in order:**

1. **Ship the org-name edit.** One `PATCH` writing `organizations.name`, wired into both
   existing settings forms alongside the `profiles.company_name` write. The policy already
   permits it. **~1-2 hours**, and it is the fix that matters - it makes every other item here
   self-correcting, because a customer can repair their own name.
2. **Validate Company Name server-side at signup.** Reject empty or whitespace-only rather
   than relying on an HTML attribute. **~30 min.**
3. **Label the invite field.** `vendor_name` is a *display name for the agency's own pool*,
   not the vendor's company name, and it is overwritten by the real profile name the moment
   the vendor is a known partner (`guest/[token]/route.ts:481`). The placeholder should say so.
   **~15 min.**
4. **Do not backfill.** `71`, `63`, `64` are your own test accounts. Once (1) ships, a real
   customer with a bad name fixes it themselves.

I would **not** change the trigger's fallback chain. It only fires when the form is bypassed,
and `sarah` is a reasonable thing to call an organization until someone renames it.

## 10. Cleanup inventory, severity-ranked

Discovery only, nothing fixed. Estimates are for the whole item unless stated.

### S1 - correctness or security, would bite a real customer

**a. `verify-rls` and `policy-audit:guard` cannot detect anything.** Two of your eight gates
are theatre. Full write-up in item 11. **The single most valuable item on this list**, because
it is what would have caught 081/083 automatically. **~4-6 h.**

**b. No rate limiting anywhere in the product.** The only mention in the entire codebase is a
comment at `app/api/contact/route.ts:7` saying it "should live at edge/WAF if abuse becomes an
issue". Eight routes take no authenticated session at all:

```
app/api/admin/notify-new-user/route.ts       app/api/auth/check-email/route.ts
app/api/auth/google-email/callback/route.ts  app/api/auth/microsoft-email/callback/route.ts
app/api/contact/route.ts                     app/api/rfp/guest/[token]/route.ts
app/api/rfp/guest/file/route.ts              app/api/rfp/guest/upload/route.ts
```

`auth/check-email` is an account-enumeration oracle. `rfp/guest/upload` is an unauthenticated
file upload. `rfp/guest/[token]` is token-guarded but unthrottled, so the token is
brute-forceable at whatever rate the platform allows. **Vercel WAF rate limiting is
configuration, not code** - a rule per path, no deploy. Start there, then add BotID on
`check-email` and `contact`. **~2-3 h for the WAF rules**, more if you want per-token limits
in code.

**c. 78 of 111 API routes are off the shared auth wrapper.** Confirmed: 33 import
`@/lib/api-auth`. Of the 78 that do not, **70 hand-roll `auth.getUser()`** and 8 have no auth
call at all (the list above - correct for the callbacks and the guest routes, worth a
second look for `admin/notify-new-user`). The risk is not the 70 doing it by hand, it is that
each one also hand-rolls the **role check and the org scoping** after it, which is where the
Class A/B findings live. **~30-40 min per route, ~40 h total.** Do it in tranches, highest
privilege first, not as one sweep.

### S2 - real bugs, narrower blast radius

**d. `react-hooks/set-state-in-effect` - 68 errors across 42 files.** The largest single rule
in the lint baseline. Worst offenders: `app/auth/sign-up/page.tsx` (4),
`app/partner/payments/page.tsx` (4), `components/bid-compare-view.tsx` (4),
`components/stage-03-onboarding-workflow.tsx` (4). Each is a render-then-correct cycle -
sometimes only a wasted render, sometimes a visible flash, sometimes a loop. React 19 is
stricter about these. Genuinely one-at-a-time work: **~20-45 min each, ~30-40 h.**

**e. `react-hooks/rules-of-hooks` - 43 errors.** Conditional or nested hook calls.
Higher severity per instance than (d) - these can desynchronise hook order and produce state
belonging to a different render - but they are concentrated, with 31 of the 154 total errors
in `app/agency/msa/page.tsx` alone. **Fix that one file and roughly a fifth of the baseline
goes with it. ~6-8 h for the file**; the rest ~10 h.

### S3 - hygiene, no user impact

**f. The ESLint baseline: 154 errors, 28 warnings** (29 at session start; see the gate
table). Complete breakdown:

| Count | Rule | Severity |
|---|---|---|
| 68 | `react-hooks/set-state-in-effect` | error |
| 43 | `react-hooks/rules-of-hooks` | error |
| 25 | `react/no-unescaped-entities` | error |
| 10 | `react-hooks/immutability` | error |
| 6 | `react-hooks/static-components` | error |
| 1 | `react-hooks/purity` | error |
| 1 | `@next/next/no-html-link-for-pages` | error |
| 12 | `@next/next/no-img-element` | warning |
| 9 | `react-hooks/exhaustive-deps` | warning |
| 7 | unused `eslint-disable` directives | warning |

**What it would take to move it:** the 25 `no-unescaped-entities` are `'` and `"` in JSX text
and are **entirely mechanical** - 8 in `app/privacy/page.tsx`, 6 in `app/terms/page.tsx`.
**~1 h removes 16% of the baseline.** The 7 unused directives are pure deletion, **~20 min**.
The 12 `no-img-element` are `<img>` to `next/image`, ~15 min each but `images.unoptimized` is
set so the benefit is small. **Realistic first pass: 154 -> ~128 errors in a day**, and the
rest is (d) and (e), which are real work and not lint work.

**g. ~775 `hover:` utilities across 103 files, 109 literal hex colors across 18 files.**
`hover:` is not itself a bug; the concern is hover styling on touch devices where it sticks
after tap. A `@media (hover: hover)` wrapper is a **global CSS change, not 775 edits** -
**~2 h including a device pass**. The literal hex values are the tokenisation debt: **~4 h**,
and worth doing before any theme work, not before.

**h. Dead code.** Confirmed dead: `notifyNewMessage` and `notifyDocumentUploaded` in
`lib/notifications.ts` (zero call sites, the file says so and I re-verified);
`app/partner/invitations/` still on disk behind a `permanent: false` redirect; the
`/partner/discover` redirect in `next.config.mjs` now points away from a directory that has
already been deleted. **~1 h to remove all of it**, once you are satisfied
`/partner/network` is settled.

**i. Duplicate query paths around `lib/library-documents.ts`.** Milder than expected. The
helper owns `LIBRARY_SECTIONS`, `LIBRARY_KINDS` and one `fetchLibraryDocuments` at line 149;
four route handlers still query `agency_library_documents` directly, but they are the
library's own CRUD routes and legitimately need shapes the helper does not expose. The real
duplication is that each re-derives `.in("org_id", callerOrgIds)` scoping by hand - which is
item (c), not a query-layer problem. **~2 h**, low value.

**Suggested order:** (a) and (b) first - they are the two that can hurt a customer and both
are days, not weeks. Then `app/agency/msa/page.tsx` for (e), which pays out disproportionately.
Then (f)'s mechanical half. Leave (c) as background work in tranches.

## 11. The two gates that cannot detect anything

### `verify-rls` - never reaches the database

Confirmed by running it:

```
Querying pg_class for RLS-enabled tables...
  pg_class query error: Could not find the table 'public.pg_class' in the schema cache
```

Exit 2. `scripts/verify-rls.mjs:62` does `.from("pg_class")`, and PostgREST exposes only the
schemas in its exposure list - `pg_catalog` is not among them and cannot be added. The script
then **prints the SQL for you to run by hand**. It is an honest helper, but its exit code
carries no information about the database: it is 2 on a perfect schema and 2 on a catastrophe.

**To make it a real gate** it needs a `SECURITY DEFINER` function in `public` that returns the
audit, called with `.rpc()`:

```sql
CREATE OR REPLACE FUNCTION public.rls_coverage_audit()
RETURNS TABLE (table_name text, policy_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.relname::text, count(p.polname)::int
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
   GROUP BY c.relname;
$$;
REVOKE EXECUTE ON FUNCTION public.rls_coverage_audit() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rls_coverage_audit() TO service_role;
```

`service_role` only - this enumerates your security posture and no client should read it. Then
`verify-rls` swaps its two `.from()` calls for one `.rpc("rls_coverage_audit")`, exits 1 on any
`policy_count = 0`, and 0 otherwise. **Migration ~20 lines, script ~30 lines changed, about
2 hours.** I did not write it: it is a migration, and that is yours.

Worth noting the gap is wider than coverage. A table can have policies and still be wrong -
081 is the proof. A real gate wants both `rls_coverage_audit()` **and** a `pg_policies`
projection, which is what the second gate should be reading.

### `policy-audit:guard` - a good script pointed at a stale file

This one is less broken than it looks. It is not lying about what it does - `scripts/audit-policy-snapshot.mjs:16-22`
states plainly that it reads a snapshot because `pg_policies` is unreachable through
PostgREST. Its parser is solid: proper RFC4180 CSV handling, an allow-list printed on every
run so it cannot grow silently, and it already tolerates repeated header rows because the
Aug 13 snapshot was assembled from two exports.

The problem is **its input is from 2026-08-13, and 079 has been applied since.** It is
auditing the pre-079 world, where every company-scoped policy legitimately reads
`auth.uid()` - which is exactly the baseline its own header says it should print. It exits 1
because `flagged.length > 0`, and `flagged` cannot change until the snapshot does. Your 113
against its 104 is the same fact from the other side.

**So the fix is not to the script. Re-take the snapshot and the script becomes a real gate on
the same day** - and its header already told you this: *"the snapshot is the thing that must
be kept fresh."* After 079 the flagged count should be **zero**, and any non-zero result is a
genuine finding. That is when to wire `--guard` into the build, and 081's silently-rewritten
policies are exactly what it would have caught.

### The SQL to re-take the snapshot

Supabase truncates an export at 100 rows **silently**, so this counts first and chunks
deliberately. Run each block separately in the SQL Editor.

**Step 0 - the number every later step is checked against.**

```sql
SELECT count(*) AS total_policies
  FROM pg_policies
 WHERE schemaname = 'public';
```

Write it down. It should be 113 today.

**Step 1 - chunked export.** Chunks of 75, comfortably under the truncation point.
`ORDER BY` is deterministic and must be **identical in every chunk** or rows will be dropped
and duplicated across the boundary.

```sql
-- CHUNK 1 of 2  (rows 1-75)
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename, policyname, cmd
 OFFSET 0 LIMIT 75;
```

```sql
-- CHUNK 2 of 2  (rows 76-150)
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename, policyname, cmd
 OFFSET 75 LIMIT 75;
```

Add a chunk at `OFFSET 150` if the count ever exceeds 150. **Check each chunk's row count as
you export it** - if a chunk returns exactly 100 you have hit the truncation and the chunk
size is wrong.

**Step 2 - the arithmetic that proves nothing was lost.** Chunk 1 rows + chunk 2 rows must
equal Step 0's total. If they do not, stop; do not assemble a snapshot from it.

**Step 3 - assemble.** Create `docs/schema-snapshot-2026-08-20.md` and paste both chunks'
CSV, **headers included**, one after the other. The parser locates the block by a line
starting `tablename,policyname,` and reads to the next markdown heading, skips repeated header
rows, and dedupes - so concatenating chunks verbatim is exactly what it expects
(`audit-policy-snapshot.mjs:152-193`). Column order must be
`tablename,policyname,cmd,roles,permissive,qual,with_check`. Do not put a `#` heading between
the chunks; that terminates the block.

**Step 4 - point the script at it.** It takes the snapshot path as its first argument:

```bash
node scripts/audit-policy-snapshot.mjs docs/schema-snapshot-2026-08-20.md
```

Once that reads zero flagged, change `DEFAULT_SNAPSHOT` and wire `--guard` into the build.

**Step 5 - the cross-check worth running while you are in there.** This is the coverage
question `verify-rls` wanted, and it needs no function:

```sql
SELECT c.relname AS table_name, count(p.polname)::int AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
 GROUP BY c.relname
HAVING count(p.polname) = 0
 ORDER BY c.relname;
```

Any row returned is a table with RLS on and no policy - locked out entirely. Expect none.

---

## Open questions for you

1. **Item 1** - do you want `middleware.ts` -> `proxy.ts`, accepting the edge-to-Node runtime
   move on every authenticated request?
2. **Item 4(a)** - `partner_rfp_inbox.scope_item_name` is NOT NULL and the broadcast writer
   stores `"Scope"` while the guest writer stores `null`. Empty string, 400, or leave it?
   `SELECT count(*) FROM partner_rfp_inbox WHERE scope_item_name = 'Scope';` settles urgency.
3. **Item 5** - the `notifications` INSERT policy is still active-partnership-only, so
   invitations and declines are still refused. Unchanged and still yours.
4. **Item 6** - `/partner/rfps` (my recommendation), the magic token, or conditional?
5. **Item 7** - I recommend counting distinct vendors in `lib/activity-feed.ts` over adding a
   `batch_id` at all. Agree?
6. **Item 8** - is 083 genuinely unapplied? The headers on 083-086 say so but at least one
   must be stale given 087 is applied and the policy count moved 104 -> 113.
7. **Item 9** - shipping the organization-name edit is the item that matters, not the bad
   defaults. Worth scheduling?
