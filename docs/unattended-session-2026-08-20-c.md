# Unattended session 2026-08-20 (c)

Seven commits from `3c76d29`. Four new emitters, one enforcement rule, two gate corrections,
one retirement. Three items reported without code. One item declined with reasons.

**No `git push`. No database write. No migration applied. No guard allow-list touched.**

---

## Preconditions

`HEAD` was `3c76d29` on `origin/main`, tree clean. Confirmed before any edit.

### Gates at the stated baseline - all eight matched exactly

| Gate | Stated | Measured at baseline | Measured at HEAD |
|---|---|---|---|
| `npx tsc --noEmit` | 0 | **0** | **0** |
| `pnpm build` | 0 | **0** | **0** |
| `pnpm lint` | 1, 182 problems (154 errors, 28 warnings) | **1, 182 (154 / 28)** | **1, 182 (154 / 28)** |
| `pnpm verify-rls` | 2 | **2** | **2** |
| `pnpm policy-audit:guard` | 1 | **1** | **1** |
| `pnpm identity-columns:guard` | 0 | **0** | **0** |
| `pnpm embed-targets` | 0 | **0** | **0** |
| `pnpm org-id-reads:guard` | 0, Class A 14, Class B 61 | **0, A 14, B 61** | **0, A 14, B 61** |

**Nothing moved.** No allow-list, mirror record or `KNOWN_OPEN` count was edited to keep it
that way; the guards were re-run, not re-baselined.

---

## 1. `bid.shortlist` and `bid.meeting_request` - WRITTEN

Commit `1f81754`. `app/api/agency/rfp-responses/[id]/route.ts`.

Payload is `{ scope_item_name }` and nothing else, as approved. No count, no position, no
"3 of 11". The two conditions that stamped `shortlisted_at` and `meeting_requested_at` inline
are hoisted to named booleans beside `isAwarding` / `isDeclining`, so the expression that
decides "this is the transition" is the same one the milestone fires on.

Scope title and partnership come from a new `resolveBidMilestoneContext()`, which performs the
resolution the feedback path already does inline: the inbox row where `inbox_item_id` is set,
`resolveGuestBidContext()` where it is null. Non-fatal throughout - a failed lookup records the
milestone with a null title rather than failing the status change. The two existing paths were
left alone rather than refactored onto it, so this commit reverts cleanly.

---

## 2. The two missing capability checks - WRITTEN, SEPARATE COMMIT

Commit `5a76f1d`. Separate from `1f81754` because it is a behaviour change on a live route.

`bid.shortlist` and `bid.meeting_request` are declared in `CAPABILITY_MINIMUM_ROLE`
(`lib/capabilities.ts:140-141`, both `"member"`) and neither was checked. The route gated
exactly the three transitions that also send mail, so these two read as gated in the capability
table and were not gated in the route.

Both check now, in the same shape as the three beside them, gated on the transition boolean
rather than on the requested status - a re-save of an already-shortlisted bid is not a
shortlist act and must not be refused as one. Both minimums are `"member"` and every
organization has at least one member who is its owner, so **this denies nobody today.**

**Found while doing it, not fixed, because item 2 scoped this to those two transitions:**
`app/api/agency/msa/milestones/route.ts` has **no capability check at all**, and
`payment.mark_paid` is declared `"owner"` - the only `"owner"` capability in the table with a
route behind it. That is a wider gap than the two closed here, and it is the one worth
looking at next.

---

## 3. `payment.mark_paid` - WRITTEN, TWO COMMITS

### 3a. Prerequisites only, no emitter - `d0cdbc4`

All three widenings, stated in the commit as prerequisites rather than the feature:

- `:543-546` `projects` select `id` -> **`id, org_id`**, under the same
  `.in("org_id", callerOrgIds)`, plus a project -> org map.
- `:556-561` `payment_milestones` pre-read `id` -> **`id, status`**, deriving `wasPaid`.
- The `partnerships` lookup on `row.partnership_id` the GET half does at `:238-242`, with the
  same `.in("lead_org_id", callerOrgIds)` scoping.

The partnership lookup runs **only on the transition**, so an ordinary milestone edit runs no
query it did not run before, and it is non-fatal - it happens after the update has already
succeeded, and a failed lookup logs and leaves that success alone.

### 3b. The emitter - `22c4a5e`

`subject_type: "payment_milestone"`, `subject_id` the milestone id, payload
`{ amount, currency, paid_at }` and nothing else. Nulls where a value is absent, never a
placeholder. **`total_paid`, `total_outstanding` and `total_milestones_amount` are absent** -
all three are computed in the GET half of that same file at `:365-367` and were one variable
away. Each sums across every vendor on the project.

---

## 4. The `actor_email` ruling, made enforceable - WRITTEN

Commit `37f135d`. `lib/milestone-events.ts`.

**`actor_email` may be populated only when `actor_id` is null.** Implemented as
`resolveActorEmail()`, called from `toRow()` - a check in the writer, not a convention in a
comment.

A violation **drops the address and keeps the event**, logging at ERROR. A breadcrumb missing
an email it was never allowed to carry is correct; a dropped breadcrumb is not, and this
module's whole contract is that it never costs the caller anything. The ERROR is because a
call site being wrong is something to go and fix.

### Where current code would violate it: nowhere.

`recordMilestone` / `recordMilestones` is the only writer of `milestone_events` in the
repository - executed grep for `.from("milestone_events")` across `app/`, `lib/`, `components/`
and `scripts/` finds no other insert. **No call site sets `actorEmail` at all today.** Every
other reference to the column in the repo is a read:

| Site | Kind |
|---|---|
| `app/api/agency/dashboard/route.ts:179` | selected, agency feed only |
| `app/api/agency/dashboard/route.ts:709` | read, passed to `guestDisplayName()` |
| `lib/activity-feed.ts:120` | optional on `MilestoneFeedRow`, so the vendor feed omits it |
| `lib/activity-feed.ts:158` | participates in the dedupe key, never rendered |

**One thing the rule now guarantees that was previously only likely.** The grouping key at
`lib/activity-feed.ts:158` is `actor_id ?? actor_email ?? "guest"`. With the two mutually
exclusive by construction, that key can no longer resolve two ways for one actor.

**A durable form exists and was not authored.** A `CHECK (actor_email IS NULL OR actor_id IS
NULL)` on `milestone_events` would enforce this at the database rather than in one module.
That is a migration; the ruling asked for a writer check and that is what shipped. Worth
adding to whatever migration next touches that table.

---

## 5. The vendor-side emitter - HALF WRITTEN, AND THE PREMISE NEEDS CORRECTING

Commit `efea788`.

### The correction first

> Item 5 stated: *"Your item 6 found both vendor bid paths are already service-role, so no new
> INSERT policy is needed."*

**That is right for the guest path and wrong for the portal path.** My previous report named
`app/api/partner/rfps/bids/route.ts` as the authenticated vendor bid submit. **That file is
GET only** - it lists a vendor's bids, and its service client (`:14-18`) serves the guest
linkage backfill, not a submit.

The authenticated portal bid submit is **`app/api/partner/rfps/[id]/response/route.ts`**,
`POST` at `:114`. It uses `createClient()` from `@/lib/supabase/server` at `:119` and the
**session** client for every write in the handler. It is not service-role.

So the portal path is **not** a code-only change, and no emitter was written for it. See 5b.

### 5a. The guest path - SHIPPED

`app/api/rfp/guest/[token]/route.ts`, on the first-submission branch.

`toRow()` hardcoded `actor_side: "agency"` and `MilestoneRow` typed it as that literal.
`MilestoneEvent` gains an optional `actorSide` defaulting to `"agency"`, so every existing
emitter is untouched and this stays one revertable change.

| Parameter | Value | Why |
|---|---|---|
| `actor_side` | `"vendor"` | first one in the product |
| `org_id` | `tokenRow.org_id`, the AGENCY | the column their SELECT policy reads; the acting company is carried by `vendor_org_id` |
| `actor_id` | `null` | a guest has no account |
| `actor_email` | `tokenRow.vendor_email` | from the token row, **never the request body**. Permitted by item 4 precisely because `actor_id` is null |
| `vendor_org_id` | `resolveOrgIdForUser(matchedProfile.id)` | **not** `matchedProfile.id` - see below |
| `partnership_id` | read back by `(lead_org_id, partner_email)` | what makes the row reachable by the vendor |
| `subject_type` / `subject_id` | `"bid"` / the response id | what `UNION_REPLACING_EVENT_TYPES` requires |
| payload | `{ scope_item_name }` | this vendor, this scope, nothing else |

**On `vendor_org_id`.** `insertRow` at `:601-616` writes `matchedProfile.id`, a profiles id,
into `partner_rfp_responses.vendor_org_id`. That is this file's share of the known class B
debt and it was not touched. But `milestone_events.vendor_org_id` REFERENCES
`organizations(id)`, so copying that value would raise 23503 - or, worse, pass silently for the
accounts whose organization id equals their founder's user id. It is resolved properly and left
**null** where the matched person belongs to no organization, which is the true answer.

**Why no new INSERT policy.** The route is service-role throughout and RLS is not enforced for
the service key, so 080's agency-only INSERT policy is never consulted. That is not a loophole:
a magic-link guest is **not `authenticated`** - bearer token, no session, `auth.uid()` null - so
no policy `TO authenticated` could ever serve them, and granting `anon` an INSERT would be
forgeable by anyone holding the anon key. The token check this route already performed is a
stronger constraint than any RLS predicate can express.

### 5b. The portal path - NOT WRITTEN. NEEDS A RULING.

080 ships exactly one INSERT policy (`:373-381`):

```sql
WITH CHECK (
  actor_side = 'agency'
  AND org_id IN (SELECT public.current_user_org_ids())
)
```

A vendor-side row from a session client fails it **twice**: the side is wrong, and on a
vendor-side row `org_id` names the **agency**, which is not one of the vendor's organizations.
The row would be silently dropped with a logged RLS denial on every portal bid submission.

**No allow-list was widened to make this pass.** Three options, with costs:

| | What | Cost | Risk |
|---|---|---|---|
| **A** | Author the vendor INSERT policy as a migration, ship the emitter behind it | ~1 h to author; **the emitter is dead and logs an ERROR on every portal bid until the migration is applied**, and you apply migrations, not me | The `actor_id IS NULL` disjunct is the hole: an authenticated vendor could write a null actor and render as a guest. Constrain it to `actor_id = auth.uid()` on this path, since the portal caller always has one |
| **B** | Give that one route a service client for the emit only | ~30 min, no migration, ships immediately | A session route acquiring a service client for one write is a pattern worth being deliberate about. It is what `rfp-responses/[id]` already does for two identity reads, with a header explaining why |
| **C** | Hold until a portal vendor emitter is actually wanted | 0 | The vendor feed is half-covered: guest bids attribute, portal bids do not, and nothing in the UI explains the difference |

**My recommendation: A, with `actor_id = auth.uid()` rather than the null-permitting disjunct**,
and the emitter in the same commit as the migration so it is never live-and-dead. B is the
faster path and I would not object to it, but it puts the fourth service client in the codebase
to avoid writing a policy that has to exist eventually anyway.

### What the agency sees - executed, not read

`bid.submit` renders through `lib/activity-feed.ts:402` as *"submitted a bid on {scope}"*. The
agency feed's actor resolver (`app/api/agency/dashboard/route.ts:695-710`) takes the
`actor_side !== "agency"` branch, and with `actor_id` null takes the guest branch:

- **Vendor organization resolves:** *"Northwind Studio (via link) submitted a bid on Key Art."*
- **No organization (pure guest):** *"A guest at northwind.com submitted a bid on Key Art."*

The address itself never enters the line - `guestDisplayName()` renders the domain only, and
the raw value rides along for a hover.

**A visible consequence worth naming, because it ships.** This is the **first real collision**
in the merge. The derived source at `dashboard/route.ts:592-609` keys on `bid:<response_id>`
and renders `{ kind: "counterparty", name: partner_display_name }` - the name the guest typed
into the bid form. The milestone keys identically, and on collision the milestone wins by
design. So on the agency dashboard the line for a new guest bid changes from
*"Northwind Studio submitted a bid on Key Art"* to *"A guest at northwind.com submitted a bid
on Key Art"* wherever the vendor organization does not resolve.

That is the ruled identity precedence (design section 5) doing exactly what it was written to
do, and the actor is now correctly marked as unauthenticated, which the derived line never was.
It is still a name getting less specific. If you want the self-declared name back, the fix is
to put `partner_display_name` in the payload - it is about that vendor only, so it does not
leak - and prefer it in the resolver. **Not done; it is a change to the resolver and it is
your call.**

---

## 6. P4, verbatim, from inside migration 073

`supabase/migrations/073_delivery_review_sharing.sql:252-260`. This is a pre-flight query, not
part of the summary, which is why it did not appear before.

```sql
-- P4. How many vendors option A in ORDERING actually affects.
--
--       SELECT count(DISTINCT p.vendor_org_id) AS vendor_orgs_losing_scores
--       FROM public.delivery_reviews r
--       JOIN public.partnerships p ON p.id = r.partnership_id
--       WHERE r.status = 'complete' AND p.vendor_org_id IS NOT NULL;
--
--     EXPECTED: 0 or a small number. If 0, no vendor can see a delivery
--     review today and option A costs nothing at all.
```

Stripped of the comment prefix, the runnable query is:

```sql
SELECT count(DISTINCT p.vendor_org_id) AS vendor_orgs_losing_scores
FROM public.delivery_reviews r
JOIN public.partnerships p ON p.id = r.partnership_id
WHERE r.status = 'complete' AND p.vendor_org_id IS NOT NULL;
```

### Dry-run line numbers - all four confirmed still correct

Executed, not read from the header:

```
$ grep -n '^BEGIN;$'  073_delivery_review_sharing.sql        ->  265:BEGIN;
$ grep -n '^COMMIT;$' 073_delivery_review_sharing.sql        ->  381:COMMIT;
$ grep -n '^BEGIN;$'  073_delivery_review_sharing_down.sql   ->   82:BEGIN;
$ grep -n '^COMMIT;$' 073_delivery_review_sharing_down.sql   ->  119:COMMIT;
```

Exactly one hit each, at the stated lines, in both files. The up file is 473 lines, the down
file 153. To dry run: change `COMMIT;` to `ROLLBACK;` at up:381 / down:119, run the whole file,
confirm no errors, then put it back - and confirm it is back before the real run.

---

## 7. Retired what today proved dead - `16962aa`

Docs and comments only. No behaviour change.

**The role backfill has no members.** Measured 2026-08-17 at 15 accounts, 7 mismatched, with
per-account `UPDATE` statements written into `docs/m1-prework-report.md` Item 1. Live query D4
on 2026-08-20: **18 accounts, every one matching its signup choice, zero mismatches.** Item 1
now carries a **do-not-run banner** - those statements name account ids measured three days
earlier and must never be run against today's data.

**Migration 078 is superseded, not pending.** Its row in `LIGAMENT_CONTEXT.md` said "AUTHORED,
NOT APPLIED", which invites someone to run it. 079 PHASE 12 (`079_organizations.sql:1841-1926`)
`CREATE OR REPLACE`s the same function on the same role-reading body, adding the organization
and owner-membership creation, and **079 is applied**. `CREATE OR REPLACE FUNCTION` replaces a
body wholesale, so 078 is now **strictly older than what is live**: running it would REMOVE the
organization creation and lock out every account created afterwards. The row says so now.

**The stale comment at `app/auth/callback/route.ts:53-61`** described 056's trigger as current.
Rewritten: the forward defect is closed at the trigger, the live data agrees, and the
correction below it stays as a **belt rather than the trousers** - a no-op on every account
today, and the only thing standing between a vendor and the wrong portal if the trigger is ever
bypassed. It was not deleted, because a no-op guard and a dead guard are different things.

**Recorded rather than silently left:** the migration log in `LIGAMENT_CONTEXT.md` **stops at
078**. 079, 080, 082 and 087 are applied and have no row in it.

---

## 8. REPORT ONLY - the `organizations` discoverable read policy

### What exists

`organizations` has exactly **two** SELECT policies, both `TO authenticated`
(`079_organizations.sql:1748-1795`):

```sql
"Members read their organizations"        USING (id IN (SELECT public.current_user_org_ids()))
"Members read counterparty organizations" USING (id IN (SELECT public.current_user_counterparty_org_ids()))
```

Neither has a discoverability disjunct. `profiles` has a third policy the organizations table
has no equivalent of - "Authenticated users can read discoverable profiles", predicate
`is_discoverable = true`.

### Why that gap is what keeps `profiles.company_name` alive

Two routes read a company the caller has **no partnership with**:

- `app/api/partner/network/[agencyId]/route.ts:133`
- `app/api/agency/pool/[partnerId]/route.ts:69`

Both reach the row **only** through the discoverable `profiles` policy, and both take
`company_name` from the `PUBLIC_COLUMNS` list. `current_user_counterparty_org_ids()` does not
return that organization, so moving those reads to `organizations.name` returns null and the
company name renders blank. That is the blocker recorded in `docs/company-name-write-path.md`
section (a), and it is still exactly true.

### What a third policy would have to say

```sql
CREATE POLICY "Authenticated users read discoverable organizations"
  ON public.organizations AS PERMISSIVE FOR SELECT
  TO authenticated
  USING ( <the discoverability predicate> );
```

**The predicate is the whole question, because `organizations` has no `is_discoverable`
column.** Its seven columns are `id`, `name`, `primary_contact_user_id`, `is_lead_agency`,
`is_vendor`, `created_at`, `updated_at`. Three ways to fill that blank:

| | Predicate | What it means | Cost |
|---|---|---|---|
| **A** | `EXISTS (SELECT 1 FROM public.profiles p JOIN public.org_members m ON m.user_id = p.id WHERE m.org_id = organizations.id AND p.is_discoverable)` | An organization is discoverable if **any member** is | No migration. But it makes one person's personal toggle publish the whole company, and after colleague invitations that is a member unilaterally listing their employer |
| **B** | `EXISTS (... WHERE m.user_id = organizations.primary_contact_user_id AND p.is_discoverable)` | The **designated contact's** toggle governs | No migration, one row decides, matches how `lib/org-contact.ts` already treats that person as the org's face. But the toggle still lives on a profile and still reads as personal in the UI |
| **C** | Add `organizations.is_discoverable boolean NOT NULL DEFAULT false`, predicate `is_discoverable` | A company-level setting, set by an org admin | A migration, a backfill decision, a settings surface, and a rule for what happens to the per-profile flag. **The only one that is right after multi-member** |

**A and B are one-liners that produce a defensible answer today and an indefensible one the
day a company has two members. C is the real answer and it is a feature, not a policy.**

### What it would expose

RLS is row-level, so all seven columns of any matched row: the company name, the two type
booleans, both timestamps, and `primary_contact_user_id`. **That id is not contact details** -
reading the person behind it still has to pass the `profiles` policies separately, and under A
or B it would, because that member is discoverable, which is what put the organization in the
set. Under C it would **not** necessarily, and you would get a discoverable company whose
contact is unreadable - a name with nobody behind it. That asymmetry is an argument for pairing
C with a rule, not against C.

### How it compares to the profiles tiers already ruled

| Caller relationship | `profiles` today | `organizations` today | With a third policy |
|---|---|---|---|
| Member | readable | readable | unchanged |
| Partnership, any status | readable | readable | unchanged |
| Pending access request only | not readable unless discoverable | **not readable** | **readable, if discoverable** |
| No relationship at all | not readable unless discoverable | **not readable** | **readable, if discoverable** |
| Anon | not readable | not readable | not readable |

The third policy makes `organizations` visibility **mirror** the `profiles` tiers exactly,
which is the same argument 079 made for the counterparty policy: one predicate, not two that
agree today and diverge at the next edit. **The difference is that the counterparty policy
could reuse `current_user_counterparty_org_ids()` verbatim. This one cannot reuse anything -
there is no discoverability function, and no column to build one from.**

**Not written, as instructed.** My reading: this is a product decision about what publishing a
company means, and option C is the only version of it that survives colleague invitations.

---

## 9. REPORT ONLY - where a guest with no inbox row should land

`app/api/agency/rfp-responses/[id]/route.ts:898` (the feedback email CTA):

```ts
ctaUrl: `${baseUrl}/partner/rfps/${existing.inbox_item_id}`,
```

`inbox_item_id` is null on every guest bid, so the template interpolates the string `"null"`.

### What that URL currently does - traced, in order

1. **Middleware first.** `/partner/rfps/null` is not in `publicPaths` (`middleware.ts:11-23`)
   and starts with `/partner`, so an unauthenticated visitor is redirected to `/auth/login`
   with the return path preserved. **They never reach the page.**
2. **If they are authenticated as a vendor**, the page at `app/partner/rfps/[id]/page.tsx:511`
   takes `"null"` as its `id` and fetches `/api/partner/rfps/null` (`:690`).
3. **The API route** runs `.eq("id", "null")` on a uuid column (`:24`). That is a Postgres type
   error - `invalid input syntax for type uuid`, 22P02 - **not an empty result**. PostgREST
   answers 400, `inboxError` is truthy, and the route returns **500 "Failed to load RFP"**
   (`:27-30`).
4. **The page** throws on `!res.ok` (`:715`) and renders the red error panel at `:1287`.

**So: a red "Failed to load RFP" box, or a login wall before it. Never a 404, and never
anything that explains itself.**

### Who actually receives it

Narrower than eight rows. The feedback email only sends when
`resolveOrgNotificationRecipients(existing.vendor_org_id, ...)` returns someone, and that
helper returns `[]` immediately for a null org (`lib/email.ts:330`). So a **pure** guest - null
`vendor_org_id` - gets **no email at all**, broken link included.

The broken URL reaches exactly the rows where **`inbox_item_id IS NULL AND vendor_org_id IS NOT
NULL`**: a guest bid whose bidder was matched to a real account. Those people **can** log in,
which is why they get past the middleware and all the way to the 500. How many of the eight
that is, the repo cannot say.

### What the unparameterised `/partner/rfps` does

It is the vendor's RFP list page, and it is **response-centric via
`GET /api/partner/rfps/bids`, not inbox-centric** - the route's own header says it "always
reflects every bid the partner has actually submitted, including ones tied to a guest/magic-link
inbox row". Its filter is `.in("vendor_org_id", callerOrgIds)`, which a claimed guest bid
satisfies. **So the guest's bid is already on that page.** It is also exactly where the
**decline** email already sends people (`:1053`, `${baseUrl}/partner/rfps`) - the two mails
disagree today and only one of them is broken.

### The options

| | Change | Cost | What the recipient gets |
|---|---|---|---|
| **A** | `existing.inbox_item_id ? \`${baseUrl}/partner/rfps/${existing.inbox_item_id}\` : \`${baseUrl}/partner/rfps\`` | **one line** | The list, with their bid on it. Same destination the decline mail already uses. One click short of the feedback |
| **B** | Send guests to the magic-link page: `${baseUrl}/rfp/respond/${token}` | ~20 min - the token is on the `rfp_magic_tokens` row `resolveGuestBidContext()` already reads, but it does not currently return it | The exact bid, no login - `/rfp` is in `publicPaths`. **Best for a true guest, and it works for the matched-account case too** |
| **C** | Link the response to a synthesized inbox row first, then A's URL always resolves | The award path already does this (`:283-340`); doing it on feedback means a write on a read-ish path | Correct forever, and it retires the whole guest/portal fork. Biggest change |

**My recommendation: A now, B next.** A is one line and removes a 500 from a live email today.
B is the right destination - a guest with no account should never be sent to an authenticated
portal - and it is small, but it needs `resolveGuestBidContext()` to return the token it
already fetches, which is a signature change and therefore not a one-liner. **Neither written.**

---

## 10. DECLINED, with reasons

Nothing on the severity ranking (`docs/unattended-session-2026-08-20.md` section 10) satisfies
**both** "mechanical" and "behaviour-neutral" at a severity worth the slot. I did not
manufacture one.

**What I picked: nothing. What I rejected, and why:**

- **`react/no-unescaped-entities`, 25 errors - the highest-count mechanical item, rejected.**
  **14 of the 25 are in `app/privacy/page.tsx` and `app/terms/page.tsx`**, and 8 of those are
  on one line of legal copy. Escaping `"` to `&quot;` is behaviour-neutral *in the renderer* -
  that is a claim about how React treats an entity, not a property of the edit. Legal text
  should change where you can eyeball the diff, not unattended. This is the one to do, next
  session, with you watching. **~1 h, removes 16% of the lint baseline.**
- **The 7 unused `eslint-disable` directives - rejected, and this one is a trap.** They are not
  stale suppressions. **Six of the seven name `@typescript-eslint/no-explicit-any`, which is
  not in this project's ruleset at all** - `eslint.config.mjs` is a bare
  `[...nextCoreWebVitals]` with no TypeScript plugin. ESLint calls them unused because **the
  rule is off, not because the `any` is gone**; every one still sits on a real `any`
  (`lib/entitlements.ts:132`, `lib/capabilities.ts:261`, `lib/email.ts:268`,
  `lib/acting-org.ts:95` are all the same `from: (table: string) => any` shape). Deleting them
  lowers the warning count by 7, fixes nothing, and costs six re-additions the day the plugin
  is enabled. **That is moving a gate, not clearing a finding.**
- **`@media (hover: hover)` (item g) - rejected as not behaviour-neutral.** Changing hover
  behaviour on touch devices is the entire point of doing it.
- **Dead code (item h) - already done**, commit `1239a81` last session.
- **S1 (a, b, c) and S2 (d, e) - none are mechanical.** (a) is design work, (b) is WAF
  configuration rather than code, (c) is ~40 h, and (d) and (e) are one-at-a-time judgement
  calls by definition.

---

## ACCEPTANCE

### One line per new emitter - what a vendor reading that row would see

| Emitter | The vendor reads |
|---|---|
| `bid.shortlist` | *"Dana Whitfield shortlisted a bid on Key Art"* - the scope title, and **no indication of how many other vendors were shortlisted.** |
| `bid.meeting_request` | *"Dana Whitfield requested a meeting about Key Art"* - the scope title, and **nothing about who else was asked to meet.** |
| `payment.mark_paid` | *"Dana Whitfield marked a payment milestone paid for Northwind Studio"* - plus **their own** amount, currency and payment date, and **no project-level total of any kind.** |
| `bid.submit` (vendor-side) | This one is read by the **agency**, not the vendor: *"Northwind Studio (via link) submitted a bid on Key Art"*, or *"A guest at northwind.com submitted a bid on Key Art"* where no organization resolves. The vendor's raw address never enters the line. Payload carries only the scope title - nothing about the other recipients of the same broadcast, and no figure from the bid. |

### Each emitter fires only once, on the transition - confirmed

| Emitter | Guard | Why a repeat records nothing |
|---|---|---|
| `bid.shortlist` | `isShortlisting` = `existing.status !== "shortlisted" && nextStatus === "shortlisted"` | `existing.status` is the **prior** value, read at `:149-154` before the update. Same boolean stamps `shortlisted_at` |
| `bid.meeting_request` | `isRequestingMeeting`, same shape | Same. Mutually exclusive with the above - `nextStatus` holds one value - so **at most one row per request** |
| `payment.mark_paid` | `isMarkingPaid` = `!wasPaid && updates.status === "paid"` | `wasPaid` comes from the pre-read widened in `d0cdbc4`. Before that commit the route **could not tell a transition from a repeat**, which is why the widening shipped first and alone |
| `bid.submit` | the first-submission branch | `:416` returns 409 for a token already marked submitted, and the edit branch returns at `:599` before reaching the emit. **One per token** |

**And none of them can change the action they observe.** All four are placed after their write
has already succeeded; `recordMilestone()` catches everything and returns void; the two extra
reads in the guest emitter are inside their own try/catch; the partnership lookup in `3a` is
non-fatal and runs only on the transition.

### The feed still renders `bid.decline` and the four derived sources

**Executed against the compiled module** (`npx tsx`, importing `lib/activity-feed.ts` directly
and calling `groupMilestoneRows` / `mapMilestoneGroup` / `milestoneDedupeKey` /
`mergeActivityEntries`). **17 checks, all passed:**

```
PASS  bid.decline text                      "declined a bid on Key Art"
PASS  bid.decline actor                     {"kind":"teammate","name":"Dana Whitfield"}
PASS  bid.decline source                    "milestone"
PASS  bid.decline dedupeKey is null         null   (does not replace a union source)
PASS  bid.shortlist text                    "shortlisted a bid on Key Art"
PASS  bid.meeting_request text              "requested a meeting about Key Art"
PASS  payment.mark_paid text                "marked a payment milestone paid for Northwind Studio"
PASS  bid.submit text                       "submitted a bid on Key Art"
PASS  bid.submit actor (org resolves)       {"kind":"guest","name":"Northwind Studio (via link)", ...}
PASS  bid.submit actor (no org)             {"kind":"guest","name":"A guest at northwind.com", ...}
PASS  bid.submit dedupeKey                  "bid:resp-1"
PASS  four derived sources alone all survive, newest first
PASS  merged ids: bid.submit REPLACES the derived bid; decline and the other three derived all kept
PASS  nothing derived was lost except the replaced bid
PASS  the surviving bid line is the milestone, not the derived one
PASS  exactly one 'submitted a bid' line survives
PASS  UNION_REPLACING_EVENT_TYPES unchanged
```

`bid.decline` renders unchanged and still keys to `null`, so it cannot collide with anything.
All four derived sources survive a merge among themselves. In a merge that includes the new
vendor-side `bid.submit`, **the derived bid item is replaced and the other three derived items
are untouched** - the designed collision, occurring for the first time, and occurring correctly.

### The eight gates against the baseline

Re-run on the final tree. **All eight identical to the stated baseline** - see the table at the
top of this report. `pnpm lint` is still 182 problems (154 errors, 28 warnings);
`org-id-reads:guard` is still 0 with Class A 14 and Class B 61. **No allow-list, mirror record
or known-open count was edited.**

---

## Commits

| | |
|---|---|
| `1f81754` | feat: emit bid.shortlist and bid.meeting_request, the two unrecorded transitions |
| `5a76f1d` | fix: check bid.shortlist and bid.meeting_request, which were declared and never enforced |
| `d0cdbc4` | fix: widen three reads on the milestone PATCH so a mark-paid can be attributed |
| `22c4a5e` | feat: emit payment.mark_paid on the milestone transition |
| `37f135d` | feat: enforce the actor_email rule in the writer - populated only when actor_id is null |
| `efea788` | feat: emit bid.submit on the guest bid path - the first vendor-side milestone |
| `16962aa` | chore: retire the role backfill and the 056 trigger fix, which today proved dead |

Seven commits, one per numbered item, each revertable alone. **Not pushed.**

---

## What is waiting on you

1. **The portal vendor emitter (5b).** Option A, B or C. My recommendation is A with
   `actor_id = auth.uid()`. Until then, guest bids attribute and portal bids do not.
2. **The guest feedback URL (9).** Option A is one line and removes a 500 from a live email.
3. **The `organizations` discoverable policy (8).** Predicate A, B or C. C is the only one that
   survives colleague invitations, and it is a feature rather than a policy.
4. **`payment.mark_paid` is declared `"owner"` and its route has no capability check at all.**
   Found while doing item 2, out of that item's scope.
5. **The guest bid identity change (5).** New guest bids now read *"A guest at northwind.com"*
   on the agency dashboard where the vendor organization does not resolve, instead of the
   self-declared `partner_display_name`. Ruled behaviour, but visible today.
6. **`react/no-unescaped-entities` (10).** ~1 h, 16% of the lint baseline, and it touches
   privacy and terms - do it where you can see the diff.
7. **The migration log stops at 078.** 079, 080, 082 and 087 have no row in it.
