# M1 foundation run report

Branch `feat/m1-foundation`, five commits, **not pushed and not merged**.

## How to read the verification claims in this document

- **EXECUTED** - I ran it in this repository and am reporting its output.
- **READ** - I read the source and am reporting what it says.
- **NOT ESTABLISHED** - I could not settle it. Every one is a numbered checklist item, never a guess.

**No SQL of any kind was run.** Verified rather than assumed, EXECUTED: `which psql` returns
nothing, and `POSTGRES_PASSWORD`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` and
`POSTGRES_PRISMA_URL` in `.env.production.local` each hold a two-character value, which is an
empty pair of quotes.

**Migrations 085 and 086 are AUTHORED and NOT APPLIED.** 079, 080, 082, 083 and 084 were not
edited. EXECUTED: `git diff main --stat` lists no change to any of them.

---

# PART 1. THE RULINGS. Read this first.

Nine decisions. Restated, not answered. Full versions with options and costs in
`docs/m1-phase0-discovery.md` section 0a; this is the index.

| # | The question, in a form one sentence can answer | What it blocks |
|---|---|---|
| **1** | Does a non-owner colleague need to broadcast an RFP and award a bid on day one? | Which roles exist. `orgRoleFor()`. ~60 routes gaining a `can()` call |
| **2** | May somebody other than the owner add a person who costs money? | The Invite button. `org_invitations` write policies |
| **3** | When somebody leaves, should the record still say they did it? | The Remove button. `milestone_events.actor_id`, `partnerships.msa_confirmed_by` |
| **4** | Which organization does a write belong to when a user has more than one? | **Answered by this run: an acting organization. Phase 2.** Ruling 8 can still delete the question |
| **5** | Is the paying entity the company or the person? | Whether an invited colleague is entitled at all. Today they are not |
| **6** | Will anybody ever ask "can they do X" and get "they are a Senior Producer" as the answer? | Whether `profiles.title` is the right home. **This run ships the decorative reading** |
| **7** | Is the portal toggle a consequence of the organization you act as, or independent? | Must be ruled with 4 or the two switchers disagree |
| **8** | Should one Ligament login ever act for two different companies? | **The cheapest answer to 4.** If no, `org_members` should say `UNIQUE(user_id)` and Phase 2 becomes dead code that costs nothing to leave |
| **9** | Does a colleague join by emailed token, or by signing up with the company domain? | The whole invitation entry point |

**Rulings 1, 2, 3 and 9 are what stand between the roster that shipped and a working M1.**
Rulings 4, 6 and 7 have provisional answers in this branch and each says in code which
ruling it is standing in for.

---

# PART 2. PHASE BY PHASE

## Phase 0. Discovery

Committed as `docs/m1-phase0-discovery.md`. Three things worth pulling forward.

**`org_invitations` does not exist.** READ, 079 line 106 states it deliberately created none,
and there is no `CREATE TABLE` for it anywhere in `supabase/migrations/` or `scripts/`.

**`org_members` has exactly one SELECT policy and it is `USING (user_id = auth.uid())`.**
This is in none of the prior documents and it is the reason M1's first page needs a migration.
A colleague list read with a session client returns one row, the caller's own, at HTTP 200,
with no error. It renders, it shows one person, and nothing says it was filtered.

**Both open items are closed.** `lib/milestone-events.ts` changed under the branded-type sweep
(`9408847`); 9 of the 33 lines are the types and the other 24 are a behavioural guard that
drops an event whose organization did not resolve. It touches exactly one table,
`milestone_events`, which 080 has not created, and it already catches `42P01` - **so the module
is entirely inert in production today.** The `partner_rfp_inbox` snapshot has two writers that
fail differently; a stale row is the literal string `Lead agency` on a magic-link row whose
organization has a real name. Detection SQL is checklist steps 1 and 2.

## Phase 1. The live exposure. Migration 085, authored.

### 1a. The status vocabulary

Five values. The authority is `app/api/partnerships/route.ts`, the only route that writes the
column: its PATCH accepts `('active','suspended','terminated','removed')` and its POST writes
`'pending'`.

| Value | What it means in the product | Written by |
|---|---|---|
| `pending` | Invited or discovered, awaiting an answer. Splits into the pool's Invited and Discovered columns on `invitation_sent_at` | partnerships POST, the pool import, the guest flow, the broadcast cue |
| `active` | Live relationship. `isActivePartnership()` is the only test for it, never `vendor_org_id` | partnerships PATCH, `lib/award-partnership-resolution.ts` |
| `suspended` | Paused. Reversible by the same PATCH | partnerships PATCH (agency) |
| `terminated` | **Two things.** The agency ending a relationship, AND the vendor declining an invitation it never accepted (`app/partner/network/page.tsx` `handleDecline` posts `status: 'terminated'`) | partnerships PATCH, both sides |
| `removed` | The agency dismissed the row from its pool. Filtered out of both GET branches with `.neq('status','removed')` | `app/agency/pool/page.tsx` line 587 |

`lib/partnership-state.ts` holds the canonical predicate and treats everything that is not
`pending` as the pool's "network" column, badged for what it is.

**NOT ESTABLISHED, and it can change 085's answer.** `partnerships.status` is probably
UNCONSTRAINED TEXT. The original `CHECK` in `scripts/010-closed-ecosystem-schema.sql` lists
only four values and **has no `removed`**; migration 063, which would have widened it, is
authored and NOT APPLIED. So either `removed` has never been writable - in which case the
pool's Remove button has been raising 23514 - or the constraint was dropped out of band and
anything at all could be in the column. **Checklist step 5.** This is why 085 is written by
exclusion rather than by inclusion.

### 1b. What legitimately depends on the non-active statuses

**Narrowing `current_user_counterparty_org_ids()` itself would be a lockout, not a fix.** It
gates `public.organizations`, which is the only source of a counterparty's company name
anywhere in the product. READ, two sites, both in `app/api/partnerships/route.ts`:

- the agency branch embeds `vendor_org:organizations!vendor_org_id(...)` on every pool row;
- the vendor branch batch-loads `organizations WHERE id IN (lead_org_id...)` for every card.

Narrow that to active-only and **the agency's own pool stops naming the vendors it just
invited**, and **the vendor's invitation card stops naming the agency that invited them**. Both
fall through `lib/org-contact.ts` to an email address and then to the literal "Unknown Agency".
That lands on every account, not just the ended relationships.

Everything else that legitimately reads a non-active counterparty:

| Surface | Needs | Status it depends on |
|---|---|---|
| `/agency/pool`, Invited and Discovered columns | vendor company name and contact | `pending` |
| `/partner/network`, Invitations tab | agency company name and contact | `pending` |
| `/agency/pool`, paused vendors | name, badge, history | `suspended` |
| Re-invitation (`partnerships` POST, `existing.status === 'terminated'` to `pending`) | reads its own `partnerships` row, then flips to pending before notifying. **Safe under 085**, verified by reading the order | `terminated` |
| Historical projects, assignments, invoices, bids | none of them read `profiles` by a counterparty org id. They read `partnerships`, `project_assignments`, `partner_rfp_responses`, whose policies key on `current_user_org_ids()` and are untouched | any |

### 1c. The fix: two helpers, split by sensitivity

`supabase/migrations/085_counterparty_status_boundary.sql` and its down file.

| Tier | Function | Statuses | Gates |
|---|---|---|---|
| Name | `current_user_counterparty_org_ids()` | all five, **UNCHANGED** | `organizations`. A company name and two booleans no policy reads |
| Commercial | `current_user_commercial_counterparty_org_ids()` **NEW** | pending, active, suspended | `profiles`, via `current_user_visible_profile_ids()`. `default_terms`, `business_criteria`, `default_nda_url` |
| Active | `current_user_active_counterparty_user_ids()` | active only, **UNCHANGED** | the `notifications` INSERT policy |

Excluded from the commercial tier: **`terminated`** and **`removed`**. Admitted: `pending`,
`active`, `suspended`. The argument for each is in the migration header and summarised in 1a
above: a vendor who declined an invitation should not have handed over their insurance limits
by declining it, and a pause is not an ending.

**Written by exclusion, not inclusion, deliberately.** Because the column is probably
unconstrained, an unanticipated value is possible. An inclusion list would DENY it, silently
blanking a counterparty's contact with no error anywhere. An exclusion list ADMITS it,
preserving today's behaviour and leaving it visible in checklist step 5. The failure direction
for a VISIBILITY set is one row too many. `IS DISTINCT FROM` rather than `<>` so a NULL status
does not silently drop out.

**Is `current_user_active_counterparty_user_ids()` the right tool? No, and it was found and
read rather than missed.** Two reasons. It is **too strict** - active-only, so substituting it
drops `pending` and `suspended` and produces the same lockout through a different door. And it
**has a live caller that is a WRITE**: the `notifications` INSERT policy. Rescoping it would
widen a write path, which is forbidden outright. It stays exactly as it is. After 085 there are
three counterparty helpers, ordered strictly by breadth, and the migration says so in a comment
so a future reader sees a family rather than drift.

**Not widened.** `current_user_visible_profile_ids()` moves strictly inward: every user id it
returns after the change was already returned before it. Its own-organization half is unchanged
and unconditional, which is what M1 needs. `current_user_counterparty_org_ids()` and the two
policies that call it are not touched at all.

**What 085 does NOT close, stated rather than buried.** Keeping `pending` in the commercial
tier keeps 079's stated residual open: `"Agencies can create partnerships"` constrains
`lead_org_id` and says nothing about `vendor_org_id`, so a lead agency can insert a pending
partnership naming any organization id it obtains and read that company's whole profile row.
Closing it means constraining `vendor_org_id` on insert, which breaks adding a known vendor
from the pool. Greg's call, unchanged by this run.

### 1d. Does application code have to change with 085? Yes, one site, and order matters.

**`app/api/partnerships/route.ts`, the vendor decline branch.** It did this:

1. `UPDATE partnerships SET status = 'terminated'`
2. `resolveOrgNotificationRecipients(lead_org_id, <session client>)`
3. send "X declined your partnership invitation"

Step 2 reads `profiles`. Under 085 the partnership is already terminated when it runs, the lead
organization is no longer a commercial counterparty, the read returns nothing, and **the decline
email is not sent while the request still returns 200**. That is exactly the silent-notification
failure commit `c00ca1a` was written to close, reopening through a policy change.

**Fixed in this branch.** Both lookups now happen BEFORE the update, and the recipient lookup is
in its own try/catch so a lookup failure can never block the decline itself - which it could not
before, because it sat inside the email try/catch, and moving it up without that guard would have
quietly handed it that power.

**ORDER: ship the code first, then apply 085.** The reordering changes nothing today and is
correct with or without the migration, so it is safe on its own. The reverse order leaves a
window in which declines are silently unreported.

**Every other consumer degrades rather than breaks**, because `lib/org-contact.ts` was built for
a null embed and logs at all thirteen sites. Expect more `[org-contact]` warnings for terminated
rows after 085. That is the migration working.

### Found in Phase 1, not fixed, deliberately

**The in-app decline notification is already refused by RLS, today, in both orderings.** The
`notifications` INSERT policy is `user_id = auth.uid() OR user_id IN
(current_user_active_counterparty_user_ids())`, and that helper is active-only. A declined
invitation was `pending` before the handler and `terminated` after it, so the agency's user id
is in neither branch. `createOrgNotification()` logs and returns false; the request returns 200.
**Fixing it means widening a write path**, so it is reported and commented at the call site
rather than patched. The email is the path that actually reaches the agency, which is why its
ordering is the one that was fixed.

## Phase 2. The acting organization

### 2a. Does `lib/acting-role.ts` validate, or trust?

**It TRUSTS.** READ: `actingRole()` reads `profiles.active_role`, normalizes it against two
literals, and does nothing else. That is defensible **there and only there**, for three reasons
that do not transfer: the value space is two literals; an unrecognised value resolves to null
rather than to a portal; and portal entitlement is enforced somewhere else entirely (`canActAs`,
`requireAgencyRole`, and `switch-role`, which checks before it writes). The stored value picks a
branch; it does not grant access.

None of the three is true of an organization id. Its value space is every uuid, an unrecognised
value is indistinguishable from a real one, and **the value IS the authorization scope**.
Reported as a finding about existing code. Not changed - it is correct for what it does.

### 2b / 2c. What was built

`lib/acting-org.ts`. The design point is in the signature: **there is no parameter for a
requested organization id.** A validating resolver that accepts a candidate is one refactor away
from a resolver that trusts one; a resolver that cannot be handed one is not. Inputs are a user
id (which callers get from `auth.getUser()`, never from a payload) and a client. Membership is
read fresh from `org_members` on every call and is the only thing that grants anything. Nothing
is cached and nothing is read from anything a client can influence.

`profiles.active_org_id` is read as a **hint**, only when the caller has more than one
membership. It selects WITHIN the membership set. A value not in that set is discarded, logged
at error as `preference-refused`, and the request **fails closed**. A stored value can never
grant anything; at worst it is ignored. The column does not exist and the read is guarded for
`42703`, the same guard shape migration 074's `response_deadline` already uses here, so the
module is correct before and after the column lands.

`resolveCallerWriteOrgId()` now delegates to it. The owner/admin/member ranking is gone.

### Why it is a no-op, argued rather than asserted

Three facts, each READ from source:

1. 079 PHASE 2 inserts one `org_members` row per profile: `SELECT p.id, p.id, 'owner' FROM public.profiles p`.
2. 079 PHASE 12's trigger inserts one per signup: `VALUES (new_org_id, NEW.id, 'owner')`.
3. **Nothing else writes `org_members`.** EXECUTED grep for insert/update/upsert/delete against
   that table across `app/`, `lib/`, `components/` and `scripts/`: no match.

So every account - the 16 legacy ones and New Org 1 - has exactly one membership, and a
one-element list sorts to itself, so the old ranking and the new resolver return the same id. It
is a no-op in **cost** too: the preference is not read on the single-membership path, so no route
gains a round trip. The only behaviour that differs is the multi-membership case, which did not
exist to change: it used to be an arbitrary pick and is now a refusal.

### What every caller does with null. EXECUTED audit, 34 call sites.

| Behaviour | Count | Examples |
|---|---|---|
| Return **403** "Your account is not linked to an organization yet" | 26 | `broadcast-rfp`, `projects`, `msa`, all `bids/*`, `scoring/*`, `pool/add-partner`, `partnerships` POST |
| Return **403** with a route-specific message | 1 | `partner/rfps/claim` |
| Return **500** with a user-visible message, deliberately | 1 | `partnerships` GET auto-claim - it only runs when there IS an unclaimed invitation, so failing there costs availability only in the case already broken |
| Client component aborts the write | 4 | `agency/pool/[partnerId]`, `partner/marketplace`, `partner/network` (log and return), `request-invitation-modal` (shows the user an error) |
| Best-effort linkage skipped, logged at error, request continues | 5 | `partner/rfps`, `partner/rfps/bids`, `partner/projects`, `pool/resend-invitation`, `auth/callback` |

**None guesses. None falls back to the user id.** `resolveOrgIdForUser()` and
`resolveOrgIdsForUsers()` keep the ranking on purpose - they answer a question about somebody
ELSE, who has no session and therefore no acting organization. `agencyEntitlementId()` keeps its
documented user-id fallback, which is right for a quota row.

### 2d. The adversarial cases. Checklist steps 12 to 15.

| Case | Expected | Why |
|---|---|---|
| Caller names an organization they do not belong to | **Not reachable.** There is no parameter to name one with. If a stored preference names one: `preference-refused`, null, **403** from every API caller, and one error log | The set comes from `org_members` keyed by `auth.uid()`, inside the resolver |
| Caller names an organization that does not exist | Same as above. A nonexistent id is not in the membership set, so it is refused by the same branch | The check is membership, not existence. There is no separate "does it exist" path to get wrong |
| No organization at all | `no-membership`, null, **403**, error log `caller belongs to no organization` | Should be unreachable post-079. If the log appears, the backfill or the trigger is not doing its job |
| More than one, none selected | `ambiguous`, null, **403**, error log | The old code picked one and wrote the record to it |
| `org_members` read errors | `lookup-failed`, null, **403** | Fails closed, not open |

## Phase 3. The colleague surface

### 3a. Migration 086, authored. Three independently revertible sections.

**1. `profiles.title`** - nullable, no default, no backfill. **Identity, never authority**, said
in the column comment and in the form copy. This ships ruling 6's decorative reading and the
migration says so: if the ruling goes the other way this column is the wrong shape, because
authority lives in `org_members.role` which is per organization, and a title on `profiles` is per
user and identical everywhere. Under that ruling it should be dropped and moved, not extended.

**2. The `org_members` roster SELECT policy** - `org_id IN (SELECT public.current_user_org_ids())`.
**This is the one widening in this run and the argument is stated in full in the migration:**

- The helper **cannot be asked a question**: no parameter, `SECURITY DEFINER`, derived from `auth.uid()`.
- It is a **strict superset**, and the existing policy is **kept, not replaced**, so it is additive even if that were wrong.
- It returns **exactly the same rows as today** for all 17 accounts, because every organization has one member. It starts doing work when a second member exists, which is the feature.
- What it exposes is the whole `org_members` row to your own colleagues in your own company. Nothing on that table is private between colleagues.
- **Writes are not touched.** Both write policies still derive from `current_user_admin_org_ids()`.

**3. `public.org_invitations`** - the table, a read policy for org admins, **and no write
policies at all.** The SHAPE of an invitation needs no ruling; WHO MAY SEND ONE is ruling 2.
Postgres denies by default, so the table is read only until the ruling lands. A partial unique
index enforces one live invitation per address per organization over `status = 'pending'` only,
so an address that declined can be re-invited. `expires_at` is `NOT NULL` with no default,
because an invitation that never expires is a credential.

### THE ONE RISK IN 086, and it is not hidden

Section 2 puts a call to `current_user_org_ids()` inside a policy **on the table that function
reads**. Expected to be fine for the standard reason - `SECURITY DEFINER`, and a table owner
bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set - which 079 relies on everywhere. But 079's
own comment says the existing policy is safe *because* it contains no subquery against
`org_members`, which reads as caution about this exact case.

**I could not execute the check.** If the assumption is wrong, Postgres raises `42P17 infinite
recursion detected in policy for relation org_members` on **every** read of the table: loud,
immediate, for everyone, not silent for one account later. Recovery is one statement:
`DROP POLICY "Members read their organization roster" ON public.org_members;` and nothing else in
086 depends on it. Pre-flight F3 checks `relforcerowsecurity` first, and verification V2 is the
behavioural check and runs before anything else is trusted. **Checklist steps 16 and 17.**

### 3b. The roster, at `/agency/settings/team`

Read only. Person, title, role, joined date, primary-contact badge, "You" marker. Linked from the
agency sidebar user menu. Sorted owner, admin, member, then join date, so it does not reorder
between loads.

**It survives both migrations being absent, and it says so rather than looking correct.** Without
`profiles.title` the select is retried on `42703` and titles render as "-", with a note. Without
the roster policy it would show one row and look right while being wrong - so **when the roster
comes back with a single row the page says so, in the interface, and names the migration.** That
is the one design decision on this page worth arguing about: a roster of one is genuinely
ambiguous, and this codebase's whole failure history is results that look like success.

**Where the two buttons go, exactly:**

- **Invite colleague** - a primary button to the right of the `<h1>Team</h1>` header. The place is
  marked with a comment in `app/agency/settings/team/page.tsx`. Blocked on rulings 1, 2, 9 and 5.
- **Remove** - a fifth table column, right aligned, one row action per member. The place is marked
  with a comment in the `<thead>`. Blocked on ruling 3, and it is the one action on this page that
  clicking again does not undo.

### 3c. The title on existing surfaces

**Done:** both user settings pages (`/agency/settings/user`, `/partner/settings/user`) behind a
`titleAvailable` flag; `PATCH /api/profile` with a `42703` retry that reports `titleUnavailable`
rather than returning a success that discarded the value; the roster.

**Deliberately NOT done, with reasons:**

- **The thirteen counterparty embeds** in `lib/org-contact.ts`. Adding `title` to
  `ORG_CONTACT_SELECT`, `ORG_CONTACT_SELECT_RICH` or `ORG_CONTACT_SELECT_MEETING` before 086 is
  applied would `42703` all thirteen simultaneously, and guarding each with a retry doubles the
  query at every one. **This is the follow-on step once 086 is applied**: add `title` to the three
  fragments, add `contact_title` to `orgWireShape()`, and render it where `contact_name` already
  renders (the pool cards, `/partner/network`, `/partner/onboarding`, `/partner/payments`, the two
  onboarding components, `/agency/msa`, `/agency/page.tsx`).
- **The sidebar identity block.** READ, `components/agency-layout.tsx` line 309: it renders
  `company_name || full_name` - the COMPANY name falling back to the person's, not a person
  alongside a company. A job title has no correct slot there, and adding one would be inventing a
  surface.

### 3d. The invitation flow

Written as a design note, no code: `docs/m1-invitation-flow-design.md`. States, emails, the accept
path, and which ruling each step is blocked on. The one finding worth pulling forward: **an
invitee accepting is by definition not yet a member, so no membership-derived policy can authorize
them.** That path needs a `SECURITY DEFINER` function keyed on the token whose security is an
`auth.email()` match against the invitation, or a service-role route. The note recommends the
former and says why. It also names the one-line change easiest to forget: `org_invite` must be
added to `middleware.ts`'s preserved query-parameter list or the token is lost on any
unauthenticated redirect.

---

# PART 3. GATES

EXECUTED, on `feat/m1-foundation`, at `36d03fa`.

| Command | Exit | Same on main? |
|---|---|---|
| `npx tsc --noEmit` | **0** | yes |
| `pnpm build` | **0** | yes |
| `pnpm lint` | **1** | **yes, EXECUTED on main.** Pre-existing, report-only by standing decision |
| `pnpm verify-rls` | **2** | **yes, EXECUTED on main.** PostgREST does not expose `pg_class`; it fails before reading a policy and has never worked |
| `pnpm identity-columns` | **0** | yes |
| `pnpm identity-columns:guard` | **0** | yes |
| `pnpm org-id-reads` | **0** | yes |
| `pnpm org-id-reads:guard` | **0** | **yes, EXECUTED on main.** See below |
| `pnpm embed-targets` | **0** | yes |
| `pnpm policy-audit` | **0** | yes |
| `pnpm policy-audit:guard` | **1** | **yes, EXECUTED on main.** Pre-existing, reads a static pre-079 snapshot |

## org-id-reads: my own count, and it disagrees with the brief

The brief states the known-open baseline is 18. **No number I can measure is 18.** EXECUTED, on
main and again on this branch:

| Measure | main | branch |
|---|---|---|
| Class A, open findings | **14** | **14** |
| Class A, allow-listed | 1 | 3 |
| Class A, `KNOWN_OPEN` recorded total | 25 across 19 file entries | unchanged |
| Class B, open findings | **66** | **66** |
| Class B, `KNOWN_OPEN_MIRROR` recorded total | 91 across 33 entries | unchanged |

The recorded totals exceed the found totals because 8 class A files and 10 class B files have
been fixed without their counts being lowered. **The class did not move in either direction as a
result of this run.**

The guard did fail once, on the new roster page: `found 2, KNOWN_OPEN records 0`. Both are
`.in("id", userIds)` against `profiles` where `userIds` comes from `org_members.user_id` one
statement earlier - a foreign key to `profiles(id)`, so user ids by definition. The NEARBY
heuristic fires because the acting organization id is in scope in the same window. Added to
**ALLOWED, not KNOWN_OPEN** (KNOWN_OPEN means "this IS the bug"), **scoped to lines 152 and 158**
so any future `profiles` read in that file is a real finding, and line scoping fails closed: if
the lines shift the entry stops matching and the guard fails.

## Also EXECUTED

`grep -rl "\](http://" app/ --include="*.ts" --include="*.tsx"` - no matches. No em dash appears
in any file this run created or edited.

---

# PART 4. WHAT I COULD NOT ESTABLISH

Listed rather than resolved by guess. Each maps to a checklist step.

1. **What values `partnerships.status` actually holds, and whether it is constrained.** This can
   change 085's boundary. `scripts/010` declares a `CHECK` without `removed`; 063 would have
   widened it and is unapplied. Steps 5 and 6.
2. **Whether `removed` has ever been writable.** If the 010 constraint is live, the pool's Remove
   button has been raising 23514 the whole time. Step 6.
3. **Whether the 086 roster policy recurses.** Reasoned safe, not proved. Steps 16 and 17.
4. **Whether any `partner_rfp_inbox` row carries a stale `agency_company_name`.** Steps 1 and 2.
5. **Whether every organization has a `primary_contact_user_id`.** Carried forward unresolved from
   the previous run. Step 3.
6. **Whether `org_members.role` holds anything but `owner` live.** Inferred from both writers, not
   observed. Step 4.
7. **Whether RLS nulls or errors on an unreadable embed.** Carried forward unresolved. The code
   handles null either way; the release risk differs (silent blanks versus a visible 400).
8. **Anything about live row counts, statuses or emails.** No SQL was run.

## Two discrepancies between the documentation and the code

- **`formatDate()` does not exist.** `CLAUDE.md` and `LIGAMENT_CONTEXT.md` both instruct that it
  be used from `lib/utils.ts` for date-only display. That file exports `formatDateTime`,
  `formatSubmittedAt` and `formatRelativeTime` and nothing else. The roster uses a local helper
  matching `formatSubmittedAt`'s date half character for character.
- **`PATCH /api/profile` never whitelisted `personal_linkedin_url`.** Both user settings pages
  have been sending it since migration 049 and reporting success while the value went nowhere.
  **Fixed in this branch**, as one line in a function this run was already editing. Called out
  because it is the only change here that was not asked for.

---

# PART 5. MERGING AND REVERTING

## Which phases are independently mergeable

| # | Commit | Depends on | Merge alone? |
|---|---|---|---|
| 1 | `31622c8` Phase 0 discovery | nothing | **Yes.** Documentation only. Zero risk, and it unblocks the next session on its own |
| 2 | `3716ec2` Phase 1, 085 + the decline reorder | nothing | **Yes, and this is the one to take first.** The code half is a pure reordering that is correct with or without the migration |
| 3 | `635e050` Phase 2, acting organization | nothing | **Yes.** A no-op for all 17 accounts |
| 4 | `28e0578` Phase 3, roster + title + 086 | **2 and 3 textually.** The roster imports `resolveActingOrgId` from commit 3 | **Yes, with 3** |
| 5 | `36d03fa` guard allow-list | **4.** It allow-lists lines in commit 4's file | **Only with 4** |

**If only one ships, take 2.** It closes the only live exposure in this run, and its code half is
safe on its own.

**Nothing here is a lockout risk on merge.** No commit changes an access predicate; both
migrations are unapplied.

## What to revert if one turns out wrong

| Phase | Revert | What comes back |
|---|---|---|
| **0** | `git revert 31622c8` | Nothing. Documentation |
| **1, code** | `git revert 3716ec2` | The decline branch resolves its recipient after the update again. **Harmless while 085 is unapplied; silently drops the decline email once it is.** So: if 085 has been applied, DO NOT revert this without also running `085_..._down.sql` |
| **1, migration** | Not applied. If applied and wrong, run `085_counterparty_status_boundary_down.sql` | Counterparties at every status read the whole `profiles` row again. The down file restores the callee first, then drops the caller, because the dependency runs that way |
| **2** | `git revert 635e050` | `resolveCallerWriteOrgId()` returns to owner/admin/member ranking. Identical behaviour for every account that exists, because each has one membership. `lib/acting-org.ts` goes with it, so **revert 4 first** or the roster will not compile |
| **3, code** | `git revert 28e0578` (then `36d03fa` first) | The roster page, the Team link, and the title field disappear. `PATCH /api/profile` stops accepting `title` **and stops saving `personal_linkedin_url` again** |
| **3, migration** | Not applied. If applied and wrong, run `086_..._down.sql` | Sections run in the safe order. **Section 1 (dropping `profiles.title`) is in a separate transaction at the foot and is commented out**, because it destroys every title anybody typed. The roster policy alone is one `DROP POLICY` |
| **guard** | `git revert 36d03fa` | The roster's two `profiles` reads are flagged again and `org-id-reads:guard` exits 1 |

**The asymmetric item is 085 plus its code fix.** The code reverts cleanly on its own only while
the migration is unapplied. Once 085 is live the two are a pair.

---

# PART 6. NUMBERED LIVE CHECKLIST

Two accounts:

- **A** = `gmarkant@gmail.com`, the "m a r k a n t" lead agency. One of the 16 legacy accounts, so
  its organization id EQUALS its user id and it cannot distinguish a correct fix from a broken one.
- **B** = `gmarkant+neworg1@gmail.com`, "New Org 1". User `7cee347d-b224-40c2-a2cf-145c863ade9d`,
  organization `43c6628a-8953-4dc5-96da-fe0ecee5e57c`. **The only account that can falsify any of
  this.** Wherever A and B are both listed, B is the real test.

## Part 1: read-only SQL, before applying anything

Supabase SQL editor. Nothing here writes.

**1.** Stale inbox snapshots, counts.
```sql
SELECT count(*) AS total_rows,
       count(*) FILTER (WHERE i.agency_company_name = 'Lead agency')         AS stamped_literal,
       count(*) FILTER (WHERE i.agency_company_name IS DISTINCT FROM o.name) AS any_drift,
       count(*) FILTER (WHERE o.id IS NULL)                                  AS org_row_missing
FROM public.partner_rfp_inbox i
LEFT JOIN public.organizations o ON o.id = i.lead_org_id;
```
**Expect** `org_row_missing = 0`. `stamped_literal` small and belonging to B. Send me all four.

**2.** The rows themselves, so the two classes can be told apart.
```sql
SELECT i.id, i.lead_org_id, i.agency_company_name, o.name AS organization_name,
       (i.master_rfp_json ? '_magic_token') AS came_from_magic_link, i.created_at
FROM public.partner_rfp_inbox i
LEFT JOIN public.organizations o ON o.id = i.lead_org_id
WHERE i.agency_company_name IS DISTINCT FROM o.name
ORDER BY i.created_at DESC;
```
`came_from_magic_link = true` **and** `agency_company_name = 'Lead agency'` is the bug. Anything
else is ordinary rename drift. The repair UPDATE is in `docs/m1-phase0-discovery.md` as 0c-3 and
**must not be run until this output has been read.**

**3.** Does every organization have a primary contact?
```sql
SELECT count(*) AS orgs, count(primary_contact_user_id) AS with_contact FROM public.organizations;
```
**Expect** the two numbers equal. A gap means those companies show a name and no contact.

**4.** Is anybody not an owner yet?
```sql
SELECT role, count(*) FROM public.org_members GROUP BY role;
```
**Expect** one row, `owner`. This is 079's own PHASE 2 verification and it has not been run in
this session.

**5.** The one that can change 085's answer.
```sql
SELECT status, count(*) FROM public.partnerships GROUP BY status ORDER BY count(*) DESC;
```
**Expect** only `pending`, `active`, `suspended`, `terminated`, `removed`, possibly NULL.
**IF ANY OTHER VALUE APPEARS, STOP AND SEND IT TO ME** before applying 085.

**6.** Is the column constrained?
```sql
SELECT con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'partnerships' AND con.contype = 'c';
```
If a definition lists four values without `removed`, **the pool's Remove button has never
worked** and that is a separate bug worth its own look.

**7.** 085's pre-flight P2 and P3, verbatim from the migration header. Confirms the three helpers
are what the file thinks they are and that exactly one policy calls
`current_user_visible_profile_ids()`. **If P3 returns more than one row, stop.**

**8.** 086's pre-flight F1, F2 and F3, verbatim. **F3 is the important one:** if
`relforcerowsecurity` is true on `org_members`, do not apply 086 section 2.

## Part 2: Phase 1, before and after 085

**9.** As **B**, sign in and open `/partner/network`. Note the Invitations tab and the network
list: **write down every company name you can see.** This is the before picture.

**10.** As **A**, open `/agency/pool`. Note the Invited and Discovered columns. **Write down
every vendor name shown.** Before picture.

**11.** **Deploy the branch code first** (commit `3716ec2` at minimum). Repeat steps 9 and 10. They
must be **identical**. The reordering is behaviour-neutral, so any difference here is a bug in the
code half and 085 must not be applied.

**12.** Apply `085_counterparty_status_boundary.sql`. Expect "Success. No rows returned". Run V1,
V2 and V3 from its verification block. **V3 must return 0** - if it does not, the name tier was
narrowed by mistake and vendor names are about to disappear. Roll back.

**13.** Repeat steps 9 and 10. **Every company name written down must still be there.** A name
that has become an email address or "Unknown Agency" means the wrong tier moved. Roll back with
`085_..._down.sql`.

**14.** Run V4 as **B**, signed in as a real user, not as postgres. `must_be_zero` must be **0**.
`commercial_tier` must be less than or equal to `name_tier`, and the difference must equal B's
count of terminated plus removed relationships from step 5.

**15.** **The behavioural check, on PREVIEW only.** As **B**, decline a partnership invitation
from A (`/partner/network`, Decline). Then:
   - **B** should no longer see the invitation. Its company name in any historical list should
     still render.
   - **A** should receive the email "New Org 1 declined your partnership invitation". **If that
     email does not arrive, the ordering fix is not deployed** - check that commit `3716ec2` is
     live before blaming the migration.
   - The in-app notification will NOT appear. That is the pre-existing RLS refusal reported in
     Phase 1 and it is not caused by 085.
   - As **B**, run V6 from the migration: reading A's profile row must return **0 rows**, and
     reading A's organization row must return **1 row**. That pair is the whole point of 085.

## Part 3: Phase 2, the acting organization

**16.** As **A** and again as **B**, do one ordinary write in each portal - A: create a project at
`/agency/projects`; B: submit or edit a bid. **Both must behave exactly as before.** This is the
no-op claim, and B is the account that tests it, because B's organization id is not its user id.

**17.** As **B**, check the server logs for `[acting-org]`. **Expect nothing.** Any line reading
`caller belongs to no organization`, `ambiguous` or `preference-refused` means the no-op argument
is wrong for a case I did not find.

## Part 4: Phase 3, the roster and 086

**18.** **Before applying 086.** As **A**, open the sidebar user menu, click **Team**. Expect: the
page loads; one row, you; the amber note saying migration 086 has not been applied; a second note
saying job titles are not available; every title cell showing "-". **A blank page or an error is a
bug.** Repeat as **B**.

**19.** As **A**, open `/agency/settings/user`. **The Job Title field should not be visible** -
`titleAvailable` is false because the column does not exist. Change your Display Name and save.
**It must still save.** This is the 42703 retry, and it is the check that the code is safe to
deploy before the migration.

**20.** Apply `086_member_identity_and_invitations.sql`. Expect "Success. No rows returned".

**21.** **RUN THIS IMMEDIATELY, BEFORE ANYTHING ELSE.** Signed in as **A** in the app (not the SQL
editor), load any page that reads `org_members` - `/agency/settings/team` is enough. Then as **B**.
**A `42P17 infinite recursion detected in policy for relation org_members` means the recursion
assumption was wrong.** Recover at once:
```sql
DROP POLICY "Members read their organization roster" ON public.org_members;
```
Everything else in 086 is unaffected and can stay. **Tell me if this fires** - it changes how the
roster has to be built.

**22.** Run 086's V1, V3, V4 and V6. **V3 must show four policies on `org_members` and
"Members read their own membership row" must still be among them.** V4 must show **exactly one**
policy on `org_invitations`.

**23.** Run 086's **V5** as **A**, signed in as a real user: try to `INSERT` into
`org_invitations`. **It must fail** with "new row violates row-level security policy". **If it
succeeds, the deny-by-default assumption is wrong and the table must not be relied on.**

**24.** As **A**, `/agency/settings/user`. **The Job Title field is now visible.** Type
"Senior Producer", save, reload. It must persist. Repeat as **B** at `/partner/settings/user`.

**25.** As **A**, `/agency/settings/team`. Expect: your row, your new title in the Title column,
role Owner, a joined date, and the "Primary contact" badge if step 3 says A has one. **The amber
"only person shown" note is still correct and still shown** - A really is the only member. Repeat
as **B**.

**26.** Confirm **neither an Invite button nor a Remove button appears.** If either does, something
was built that Greg has not ruled on.

## Part 5: what to send back

1. The output of steps 1 to 8, in full.
2. Whether step 11's before-and-after matched, and whether step 13's names all survived.
3. Whether step 15's decline email arrived.
4. **Whether step 21 raised 42P17.** This is the single most important answer in the list.
5. Any `[acting-org]` or `[org-contact]` log line from steps 16 and 17.
6. Rulings 1, 2, 3 and 9 from Part 1 of this report. Those four are what turn the roster into a
   working M1, and none of them can be inferred from the code.
