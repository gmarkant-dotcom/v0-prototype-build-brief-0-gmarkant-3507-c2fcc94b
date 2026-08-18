# M1 cleanup run

**Branch:** `feat/m1-cleanup`, cut from `main` at `b7e6cb9`. **Four commits. Nothing pushed,
nothing merged.**

**No SQL was executed. Not one statement, not even read-only.** There are no working database
credentials in this environment: `POSTGRES_URL` and `POSTGRES_PASSWORD` are empty strings,
there is no `psql` on PATH and no pg driver installed. Every database fact below is READ from
a file in this repository and is labelled as such. Where a fact needs the live database it is
written as a numbered checklist item rather than asserted.

**Migrations 079, 080, 082, 083, 084, 085 and 086 were read and not edited.** One migration is
authored in this run, 087, and it is **AUTHORED, NOT APPLIED**.

---

## What is in this run

| Phase | What | Commit | Mergeable alone? |
|---|---|---|---|
| 1 | Migration `087` + its down migration. The partnerships write policies. | `f148198` | **Yes.** No code changes at all. Two new files under `supabase/migrations/`. Merging changes nothing until Greg applies it. |
| 2 | Two banner deletions and one pluralisation fix. | `5fd6f32` | **Yes.** Three user-facing edits, no shared modules, no data access. |
| 3 | `docs/m1-invitation-policies.md`. No migration. | `4ba5b0a` | **Yes.** A document. |
| 4 | Guard allow-list line numbers + this report. | this commit | **Depends on Phase 2.** The allow-list edit is a mechanical consequence of Phase 2's line shifts. Merge them together or `pnpm org-id-reads:guard` fails. |

**If one phase is wrong, revert that commit.** They touch disjoint files, with the single
exception noted above. There is no ordering between 1, 2 and 3.

---

## Phase 1. The security residual 085 left open

### 1a. The live policy, quoted

READ from `supabase/migrations/079_organizations.sql` lines 1464-1466. This is the current
text: the only other record, `docs/schema-snapshot-2026-08-13.md` line 177, is the **pre-079**
version and reads `(agency_id = auth.uid())`, which no longer exists as a column.

```sql
CREATE POLICY "Agencies can create partnerships"
  ON public.partnerships AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));
```

**What it constrains:** the lead side only. The row must be filed under an organization the
caller belongs to. `current_user_org_ids()` takes no parameter and derives its set entirely
from `auth.uid()` inside a `SECURITY DEFINER` body, so the caller cannot name a lead
organization it does not belong to.

**What it says nothing about:** `vendor_org_id`, `partner_email`, `status`, and every other
column on the table. `vendor_org_id` is a free-text uuid on insert, checked by nothing except
its foreign key to `organizations(id)`.

**Why that is worth something.** 085 admits `'pending'` to the commercial tier, which gates
`public.profiles` through `current_user_visible_profile_ids()`. RLS is row level. One INSERT
naming organization X therefore grants a read of the **whole profiles row** of every member of
X: `default_terms` (payment terms, kill fee, IP position, rate validity), `business_criteria`
(insurance limits and the certificate-of-insurance URL), `default_nda_url`, `email`,
`full_name`, `capabilities`, `credentials`. The other side is never asked and never told - no
route runs, so no invitation email is sent.

### 1b. How an agency obtains another organization's id

**Freely, by two independent routes. This is not a guessing attack.**

**Route A - `partner_vouches`, and this is the one that matters.** READ from
`docs/schema-snapshot-2026-08-13.md` line 173:

```
partner_vouches,Anyone can count vouches,SELECT,{public},PERMISSIVE,true,null
```

079 dropped and rewrote exactly two policies on that table (`079_organizations.sql` lines
557-558 and 1455-1461): `"Agencies can vouch"` and `"Agencies can remove their vouch"`. **It
never touched the third.** So the open `USING (true)` SELECT survived the column rename and now
publishes the renamed columns. Any holder of the publishable anon key - which every visitor to
withligament.com is served - can run:

```sql
select lead_org_id, vendor_org_id from public.partner_vouches;
```

and read **organization ids for both endpoints of every vouch on the platform**. Migration 082
closes this and is AUTHORED, NOT APPLIED. That 082 exists is known; what does not appear to be
written down anywhere is that after 079 the columns it exposes are organization ids, which is
what makes the partnerships escalation trivial. **This route works for accounts created after
079 too.** It is bounded only by how many rows are in that table - checklist item **L4**.

**Route B - the marketplace, legacy accounts only.** `app/api/marketplace/discoverable/route.ts`
returns `profiles.id` for every profile with `is_discoverable = true`. For the sixteen legacy
accounts 079's backfill set `organizations.id = profiles.id`, so each of those ids **is** an
organization id. The signup trigger issues `gen_random_uuid()` from 2026-08-18, so this route
yields nothing usable for newer accounts. Note that the same route **masks `email` to null**
unless the caller already has an ACTIVE partnership (the `maskedProfiles` block) - which is why
the fix in 1c bites.

**Answer: organization ids are effectively public, so the escalation is trivial rather than
narrow.** Both policies above are read from files in this repository. Neither was executed.

### 1c. The judgment: what constraint permits every legitimate shape

**First, the count, because it is not one policy.** All six live policies on
`public.partnerships`, READ from `079_organizations.sql` lines 1464-1500. There is no DELETE
policy. **Four are writes and three of them are holes:**

| # | Policy | Cmd | Constrains | Hole |
|---|---|---|---|---|
| 1 | Agencies can create partnerships | INSERT | `lead_org_id` | `vendor_org_id` free. **The stated one.** |
| 2 | Agencies can view their partnerships | SELECT | - | - |
| 3 | Agencies can update their partnerships | UPDATE | `lead_org_id` both sides | `vendor_org_id` free. **Insert a ghost row, then update it.** Fixing 1 alone is a no-op. |
| 4 | Partners can view their partnerships | SELECT | - | - |
| 5 | Partners can update partnership status | UPDATE | `vendor_org_id` both sides | `lead_org_id` free. **Symmetric escalation:** a vendor with one real partnership rewrites its `lead_org_id` to a victim organization. |
| 6 | Partners can claim partnership by email | UPDATE | `vendor_org_id` in the CHECK | `lead_org_id` free. Same as 5, needing a ghost row addressed to the caller's own email to exist first. |

**This is the run's own count and it differs from the brief's.** The brief, 079 and 085 all
describe one INSERT policy. It is four write policies and three distinct holes. Holes 5 and 6
are, as far as I can find, not written down anywhere in this repository.

**The legitimate insert shapes, enumerated from the actual writers.** Seven code sites insert
into `partnerships`. Which client each uses decides whether a policy touches it at all - the
service role bypasses RLS entirely.

*Session client (a policy applies):*

| # | Site | `vendor_org_id` | `partner_email` |
|---|---|---|---|
| S1 | `app/api/partnerships/route.ts` POST, invite | `resolveOrgIdForUser(partner.id)` where `partner` is a profiles row the session client just read | `partner.email` lowercased |
| S2 | same route, ghost shape | absent | the payload email, lowercased |
| S3 | `lib/partnership-invitations.ts` via `app/api/agency/pool/resend-invitation` | null (no `partnerId` passed) | the vendor email |
| S4 | `lib/award-partnership-resolution.ts` branch d, via `app/api/agency/rfp-responses/[id]` | `partnerIdForResolution` | the email resolved for that same organization via `resolveOrgNotificationRecipients()` |
| S5 | same file, pure-guest branch | explicitly null | the vendor email |

*Service role (no policy applies, listed so nobody thinks they were missed):*
`app/api/agency/email-scan/import` (null), `lib/server/partner-pool-import.ts` (null),
`app/api/rfp/guest/[token]` (see the defect below), `lib/broadcast-partnership-cue.ts` (behind
`BROADCAST_CUES_PARTNERSHIP`), and `markPartnershipInvited()` from
`app/api/agency/rfp/magic-link`.

**Every legitimate writer derives the organization FROM an email address.** So the invariant
every shape already satisfies, and the escalation cannot:

```
vendor_org_id IS NULL
OR some member of vendor_org_id has profiles.email = partner_email
```

The attack supplies an organization id read out of `partner_vouches` and has no matching email
to go with it, because the marketplace masks `email` to null without an active partnership.

**This constraint exists, so it is proposed rather than the options being punted.** But two
things about it must be said plainly, because they are the difference between "closed" and
"narrowed":

**IT IS NOT A CONSENT GATE.** After 087 an agency that knows a real member email address can
still create a pending partnership and still reads that organization's profiles rows before
anybody accepts. What changes is the identifier required: from *an organization id*, which
`partner_vouches` publishes to the internet, to *a member's email address*, which the product
only reveals to a counterparty.

**Making it consensual is a separate ruling, and here are both options with their costs, not
picked:**

- **C1. Remove `'pending'` from `current_user_commercial_counterparty_org_ids()`.** Then no
  unaccepted partnership discloses a profile at all. **Cost:** 085 admitted `'pending'`
  deliberately. Contact name and email disappear from every invitation card on both sides
  while an invitation is in flight - `/agency/pool` pending cards fall back through
  `lib/org-contact.ts` to `partnerships.partner_email`, and `/partner/network` renders
  "Email not available". That lands on every live invitation, not on the abusive ones.
- **C2. Require `vendor_org_id IS NULL` on every insert,** so only the vendor's own claim path
  can link an organization. Genuinely consensual. **Cost:** `app/api/partnerships/route.ts`
  stops writing `vendor_org_id` when it invites somebody who already has an account, so
  `notifyPartnershipInvitation()` - guarded by `if (partner && partnership.vendor_org_id)` -
  **stops firing silently**, and the agency's own pool renders the invitee as an unclaimed
  ghost until that vendor next loads their portal and the auto-claim in `GET /api/partnerships`
  runs. A silently lost notification is the exact class this project keeps being bitten by.

### 1d. Migration 087

| File | BEGIN | COMMIT |
|---|---|---|
| `supabase/migrations/087_partnership_vendor_identity.sql` | **line 411** | **line 583** |
| `supabase/migrations/087_partnership_vendor_identity_down.sql` | **line 64** | **line 87** |

In each file those are the only executable occurrences of either word - every other appearance
is inside a comment block, and the trigger body's plpgsql `BEGIN`/`END` carries no semicolon.
Both are dry-runnable by the exact procedure 086 broke: change the one `COMMIT;` to `ROLLBACK;`
and run the whole file. Both headers state their own line numbers and give the `grep` that
proves it.

**What 087 does, and why each part is shaped the way it is:**

1. **`public.org_has_member_with_email(uuid, text) RETURNS boolean`**, SECURITY DEFINER,
   STABLE, `SET search_path`, REVOKEd from PUBLIC and GRANTed to `authenticated`.
   SECURITY DEFINER is not optional here: an agency inviting a vendor it has no relationship
   with **cannot read that vendor's profile** - that is the point of the profiles policy - so
   an inline `EXISTS` in the policy body would evaluate as the caller, find nothing, and deny
   every legitimate first invitation, silently and totally.
2. **The INSERT policy, narrowed by an AND.** The lead half is unchanged character for
   character. Written by inclusion, not exclusion - the opposite of 085's choice and for the
   stated reason: 085 built a VISIBILITY set, where showing one row too many is the safe
   direction. This is an AUTHORITY predicate and the safe direction is the other one.
3. **A `BEFORE UPDATE` trigger** pinning `lead_org_id` as immutable and allowing
   `vendor_org_id` only `NULL -> value`, subject to the same invariant.

**Why a trigger and not three more policies.** The thing holes 5 and 6 need is
**immutability**, and `WITH CHECK` sees only the new row. There is no `OLD` in a policy. So
"lead_org_id may not change" is unreachable by any policy that does not also scope the write
by a VISIBILITY set - and scoping a write by `current_user_counterparty_org_ids()` or
`current_user_visible_profile_ids()` is forbidden outright in this project, correctly. The
trigger has a second property that matters more than elegance here: **it raises.** An RLS
UPDATE that matches no row returns HTTP 200 with zero rows and no error, which is the
success-shaped non-event this codebase has lost real behaviour to five times.

**Nothing is widened.** No SELECT policy is touched. None of the six `current_user_*` helpers
is touched - 087's verification V2 hashes all six and tells Greg to diff them. No GRANT is
altered except the new function's own.

**The cost of the trigger, stated:** it fires for the service role too. It is written to guard
transitions **no code path performs**, verified by reading every writer: `lead_org_id` is never
updated anywhere, and every site that writes `vendor_org_id` guards on the old value being null
(`lib/award-partnership-resolution.ts` `...(existingRow.vendor_org_id ? {} : ...)`,
`lib/partnership-award-claim.ts` `.is("vendor_org_id", null)`, `app/api/rfp/guest/[token]`
`else if (!existingPartnership.vendor_org_id)`, and `email-scan/import` whose comment says
"never touch status/profile_status/vendor_org_id here").

**The one thing the new function discloses, said rather than buried.** EXECUTE must be granted
to `authenticated`, because a policy expression is evaluated with the querying role's
privileges, so it is callable over RPC. It is a **membership confirm-oracle**: a caller holding
both a valid organization id and a guessed email can confirm the pairing. It returns one
boolean. It cannot enumerate - it will not yield an email from an organization id or an
organization id from an email, which is exactly why its signature is `(uuid, text) -> boolean`
and not the more convenient `(text) -> uuid`. That is a real but strictly smaller disclosure
than the whole-profiles-row read it closes.

### 1e. Ordering against the code

**087 is safe to apply before any code change. It needs none, and this run ships no code it
depends on.** It has exactly one behaviour change, and unlike 085's decline-email trap **the
failure is loud**:

`app/api/agency/rfp-responses/[id]/route.ts` awarding a bid reaches
`lib/award-partnership-resolution.ts` branch d (shape S4). That branch resolves the vendor's
email through `resolveOrgNotificationRecipients(partnerIdForResolution, supabase)` using the
**session** client. If the agency cannot read any member profile of that organization - which
is possible when no partnership exists yet, because that is exactly what the profiles policy
gates on - `vendorEmail` comes back null and today's insert writes `vendor_org_id` set with
`partner_email` NULL. After 087 that insert is **refused**.

The route catches `insertErr`, logs `[api] bid award: partnership resolution failed` with the
response id, and returns HTTP 500 with "Cannot award this bid: no vendor account or email is
linked to it, so no relationship could be established." Nothing is silently lost. **Pre-flight
P3 in the migration bounds how often this can happen on live data; if it is not 0, ship a code
fix first.**

### Two live defects re-derived while doing Phase 1

Both are **already recorded** in `scripts/check-org-id-reads.mjs`'s `KNOWN_OPEN_MIRROR`, so
these are confirmations, not discoveries. Neither is fixed here and neither is caused by 087.

- **`app/api/agency/rfp-responses/[id]/route.ts` line 373** calls
  `resolvePartnershipForAward(supabase, { agencyId: user.id, ... })` and `agencyId` is written
  to `lead_org_id`. **A user id in an organization column, on a write.** Accidentally correct
  for the sixteen legacy accounts; a `23503` for `gmarkant+neworg1`. The guard's own note at
  `check-org-id-reads.mjs` line 479 names this exact parameter.
- **`app/api/rfp/guest/[token]/route.ts` lines 77 and 88** write `matchedProfileId`, a
  `profiles.id`, into `vendor_org_id`. Same class. It runs as the service role, so 087 does not
  touch it either way.

---

## Phase 2. Two deletions and one typo

### 2a. The roster-of-one banner - DELETED ENTIRELY

`app/agency/settings/team/page.tsx`. Removed, not gated and not reworded. It was
`{!errorMessage && members.length === 1 && ...}`, unconditional on the row count, so with 086
applied it asserted to every solo member - all sixteen accounts today - that a migration "has
not been applied yet" when it has. It also named an internal migration number in customer-facing
copy, which nobody outside this repository can act on.

### 2b. The missing-title banner - DELETED

Same file. `profiles.title` is permanently present, so `titleColumnMissing` could never become
true again. The state variable is removed with it, because a `useState` whose value is never
read is dead weight the next reader has to reason about.

**THE 42703 RETRY GUARD IS KEPT. Here is why.** It is not the banner and it is not dead code.
A PostgREST select naming an absent column fails the **whole** query with 42703 rather than
omitting that column, so the guard is what stands between a rolled-back 086 and a roster page
that renders nothing at all. It costs one extra round trip in a case that should never happen.
It now `console.error`s instead of rendering, so the signal survives without telling a customer
about a migration.

The file header comment described both banners and asserted "Neither is applied yet". That is
now false, so it was rewritten to say what happened and why the retry stayed. **That is part of
the deletion, not an addition** - leaving a header describing deleted code would be a defect I
created.

### 2c. The pluralisation, and its sibling

`app/partner/rfps/page.tsx`. The string was built by appending `"s"` to a ternary:

```
${totalGroups} ${groupBy === "agency" ? "agency" : groupBy === "client" ? "client" : "status"}${totalGroups !== 1 ? "s" : ""}
```

**Two of the three branches were wrong, not one.** `"agency" + "s"` gave the reported
`2 agencys`; `"status" + "s"` would have given `2 statuss` the moment anybody grouped by
status. Only `"client"` was correct. Replaced with a `Record<GroupBy, {one, many}>` table, so
the bug cannot come back branch by branch.

**The sibling counts in the same component were checked, not assumed.** There is exactly one
other pluralisation in the file, line 315, `{rows.length} RFP{rows.length !== 1 ? "s" : ""}`,
which is correct - "RFP" does take a bare "s". A sweep of `app/` and `components/` for the same
naive-append pattern on a noun that does not take a bare "s" found no other instance.

**The layout, the table, the tabs and everything else on the team page are untouched. Three
edits, as asked.**

---

## Phase 3. `docs/m1-invitation-policies.md`

Written; **no migration authored**, because the predicates depend on the ruling. It covers all
twelve columns with type, nullability, default and purpose; all four indexes; three INSERT
predicates (one per answer to Call 2); the revoke UPDATE policy; the accept and decline paths;
DELETE; and a decision sheet the next session fills in and ships from.

**The load-bearing part is the accept asymmetry, and it is worse than "a membership predicate
cannot authorize it".** The accept is **two writes**: flip `org_invitations.status`, and insert
into `org_members`. The only INSERT policy on `org_members` is `"Org admins add members"`,
`WITH CHECK (org_id IN (SELECT current_user_admin_org_ids()))`, and the invitee is not an admin
of that organization. **So no combination of policies on `org_invitations` can produce a working
accept.** Adding an UPDATE policy for the invitee produces a half-accept: the invitation flips
to `'accepted'`, no membership is created, HTTP 200, no error. The document recommends a
`SECURITY DEFINER` function keyed on the token, spells it out, and states exactly what running
as the function owner means - that the function becomes the entire authorization boundary for
joining an organization, so every check the policies would have done it must do itself.

**Three things found in 086 that are not in 086:**

1. **Its verification V6 expects three indexes and there are four.** `pg_indexes` reports
   constraint-backed indexes, and `token text NOT NULL UNIQUE` creates
   `org_invitations_token_key`. **V6 as written will read as a failure when nothing has
   failed.** Checklist item **L5**.
2. **The `status` CHECK has no `'declined'`.** A decline has to be recorded as `'revoked'`
   (which means the sender withdrew it - a different fact) or `'expired'` (which asserts a
   time-based event that did not happen). Recommendation: widen the CHECK in the same
   migration, free now while the table is empty.
3. **Nothing sets `'expired'`.** There is no scheduled job touching this table, so a lapsed
   invitation stays `'pending'` forever - and because `org_invitations_one_live_per_email` is
   `WHERE status = 'pending'`, **it permanently blocks re-inviting that address**, with a
   `23505` about an invitation that expired months ago. The document gives three ways out and
   notes that the obvious one, putting `expires_at > now()` in the index predicate, is rejected
   by Postgres because a partial index predicate must be IMMUTABLE.

Also noted: **the invitee cannot read their own invitation.** The only SELECT policy is
admin-scoped. That is not a patch-casually oversight - it is the reason the token, not the row
id, has to be the credential.

---

## Phase 4. Gates

**Every exit code below was EXECUTED on this branch at its final commit, and again on a clean
`main` worktree for comparison.** The `main` runs used `node scripts/...` directly, because
`pnpm` in a git worktree tries to purge the linked `node_modules` and aborts with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` before the script runs - which is a property of
the worktree, not of the gate.

| Gate | This branch | `main` | Verdict |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | **0** | Passes. The bar CLAUDE.md sets. |
| `pnpm build` | **0** | not re-run | Passes. Full production build. |
| `pnpm lint` | **1** | **1** | Known pre-existing. **183 problems, 154 errors, 29 warnings, identical on both.** Report-only by standing decision. |
| `pnpm verify-rls` | **2** | **2** | Known pre-existing. Fails before reading a single policy - PostgREST does not expose `pg_class` on this project. |
| `pnpm policy-audit:guard` | **1** | **1** | Known pre-existing. Reads a static pre-079 snapshot. |
| `pnpm identity-columns:guard` | **0** | **0** | Passes. 0 legacy column names in application source. |
| `pnpm embed-targets` | **0** | **0** | Passes. 0 embeds traversing a repointed foreign key. |
| `pnpm org-id-reads:guard` | **0** | **0** | Passes. See below. |

**`pnpm lint` produced byte-identical totals on both branches, so Phase 2 added no new lint
problem.** The build was not re-run on `main`; `tsc` and `lint` cover the same source and both
matched, and a `main` build takes minutes to prove something neither of those left in doubt.

### org-id-reads:guard, and whether its numbers reconcile

**They reconcile, and the guard is not mis-reporting its own baseline. It is reporting a
MEASURED total under a label that reads like a baseline.** Here are all four numbers, from the
same run:

| Quantity | Where it comes from | Value |
|---|---|---|
| Class A **measured** now | counted at run time | **14** |
| Class A **recorded ceiling** | `KNOWN_OPEN`, 19 entries, `count` fields summed | **25** |
| Class B **measured** now | counted at run time | **66** |
| Class B **recorded ceiling** | `KNOWN_OPEN_MIRROR`, 33 entries, `count` fields summed | **91** |

The guard prints `open.length` and `mirror.length` - the **measured** totals - through the
strings `"14 known-open sites remain"` and `"Class B: 66 known-open sites, baseline
unchanged."` (lines 941-942). `KNOWN_OPEN` and `KNOWN_OPEN_MIRROR` are **per-file ceilings that
only ever fail upward**, and they have drifted well above what is measured. The guard says so
itself, listing 8 class A files and 10 class B files as IMPROVED, but it never sums them and
never prints the ceiling total, so a reader cannot tell which quantity the headline number is.

Reconciling the two prior accounts:

- **"25 shrinking to 18"** - 25 is the class A **recorded ceiling**, which is still 25 today.
  18 was a class A **measured** total at that time. Today the measured total is 14, so the
  fixes since have taken it 18 -> 14. Nothing measures 18 now, which is why the next run could
  not find it.
- **"14 and 66 with KNOWN_OPEN recording 25"** - both correct, and both **measured** totals.
  Reproduced exactly on this branch and on `main`.

**So both accounts were right about different quantities, and the guard's own wording is what
made them look like a contradiction.** The fix is one line of output: print the ceiling
alongside the measured number, or stop calling a measured count "known-open sites". A
regression detector nobody can read is worse than none, and this one is one label away from
being readable. **Not changed here** - it is not in this run's scope and it would move a
baseline mid-run.

**One guard edit was required by Phase 2.** The allow-list entry for
`app/agency/settings/team/page.tsx` pins line numbers, `lines: [152, 158]`. Deleting the two
banners and rewriting the header moved both reads to **160 and 166**. Updated, with a comment
saying why. **The reason text is unchanged** - the two reads are the same two reads, both
`.in("id", userIds)` against `profiles` where `userIds` came from `org_members.user_id` one
statement earlier. Without this edit the guard fails with
`app/agency/settings/team/page.tsx found 2, KNOWN_OPEN records 0`.

---

## What I could NOT establish

1. **Every database fact.** No SQL ran. Everything above is read from files. Where a live
   answer is needed it is item L1-L9 below.
2. **Whether any live `partnerships` row already violates 087's invariant.** 079 line 952 says
   only 4 of 31 rows had a non-null `vendor_org_id` as of 2026-08-17, so this is small - but it
   is unknown. 087 pre-flight P1. **A violating row would mean a legitimate shape I did not
   enumerate.**
3. **How much `partner_vouches` actually discloses.** The policy is open; the row count is
   unknown. 087 pre-flight P4, checklist item L4.
4. **How often the S4 award branch produces a null `partner_email`.** That is 087's one
   behaviour change. 087 pre-flight P3.
5. **Whether the 086 roster policy actually avoided 42P17 recursion.** 086's own V2 says it must
   be run as a real authenticated user and could not be run from the authoring environment. It
   is applied now, so this run assumes it worked - but I did not verify it. Checklist item L1.
6. **Whether `org_invitations` has any rows.** It has no write policy, so it should have none,
   but a `postgres`-side insert would not have been stopped. Checklist item L6.
7. **Whether the trigger in 087 breaks any service-role path I did not find.** I read every
   `.from("partnerships")` insert and update in `app/` and `lib/` and none performs a guarded
   transition. I could not execute any of them.
8. **Whether the `partner_rfp_inbox` / magic-token paths write `vendor_org_id` in ways that
   would violate the invariant.** Those tables are out of 087's scope, but a shared helper
   could surprise. Not established.

---

## What to revert if a phase is wrong

| Symptom | Revert |
|---|---|
| 087 refuses a legitimate invite or award | **Do not revert the commit** - the migration is not applied, so the commit is inert. Apply `087_partnership_vendor_identity_down.sql`, or one of its two documented PARTIAL rollbacks, which let you keep the INSERT fix while dropping the trigger or the reverse. |
| The team page looks wrong | `git revert 5fd6f32` **and** the allow-list hunk of this commit, together. Reverting Phase 2 alone puts the reads back at 152/158 and makes the guard fail on the 160/166 entry. |
| The RFP count reads wrong | Same commit as the team page. They are one commit; split it first if only one is wrong. |
| The invitation document is wrong | `git revert 4ba5b0a`. Nothing depends on it. |

---

## Live checklist

**Two accounts. Do them in order. Nothing here is optional and nothing here has been run.**

Account A: **gmarkant@gmail.com**, the "m a r k a n t" lead agency, one of the sixteen legacy
accounts, so its organization id **equals** its user id.
Account B: **gmarkant+neworg1@gmail.com**, company "New Org 1", user id
`7cee347d-b224-40c2-a2cf-145c863ade9d`, organization id
`43c6628a-8953-4dc5-96da-fe0ecee5e57c`. **The only account that can tell a correct fix from a
broken one.**

### Part 1 - before applying anything (SQL editor, read only)

**L1. Confirm 086's roster policy is not recursing.** Sign in **as account A in the product**,
open `/agency/settings/team`.
*Expect:* the page renders, showing you, with your title column reading "-" unless you set one.
*Fail:* a red "Could not load your team" box. Open the console: `42P17 infinite recursion
detected in policy for relation org_members` means 086's section 2 must be dropped -
`DROP POLICY "Members read their organization roster" ON public.org_members;` and nothing else.

**L2. Confirm the two deleted banners are gone.** Same page, same session.
*Expect:* no amber box saying migration 086 "has not been applied yet", and no grey box saying
job titles are unavailable. Just the header, the table, and the "Roles and titles are set when
a colleague joins" line at the foot.

**L3. Confirm the RFP count reads correctly.** Sign in **as account B**, open `/partner/rfps`,
Open RFPs tab, grouped by Agency (the default).
*Expect:* "N RFPs across M agencies" - or "1 agency" if M is 1. **Not "agencys".** Then click
**Status** in the group-by row.
*Expect:* "N RFPs across M statuses". **Not "statuss".** Then **Client**: "M clients".

**L4. Measure the vouch exposure.** SQL editor:
```sql
SELECT count(*) AS vouch_rows,
       count(DISTINCT lead_org_id)   AS lead_orgs_exposed,
       count(DISTINCT vendor_org_id) AS vendor_orgs_exposed
FROM public.partner_vouches;
```
*Expect:* whatever it is. **Every organization id in those two columns is readable by anyone
holding the anon key until migration 082 is applied.** If these numbers are non-trivial, 082
moves up the queue ahead of 087.

**L5. Re-run 086's V6 with the corrected expectation.**
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='org_invitations' ORDER BY indexname;
```
*Expect:* **4 rows**, not the 3 that 086 says: `org_invitations_pkey`,
`org_invitations_token_key`, `org_invitations_one_live_per_email` (its definition must END WITH
`WHERE (status = 'pending'::text)`), `org_invitations_org_status_idx`.
*Fail:* 3 rows with no `org_invitations_token_key` means the `UNIQUE` on `token` did not take,
and a token collision would be a silent duplicate rather than a `23505`.

**L6. Confirm `org_invitations` is empty and still unwritable.**
```sql
SELECT count(*) FROM public.org_invitations;
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename='org_invitations';
```
*Expect:* count 0, and **exactly one** policy row, `"Org admins read their invitations"`,
SELECT. More than one means a write policy arrived out of band.

**L7. Run 087's four pre-flight queries** (P1 through P4, in the migration file, above the
`BEGIN`). **P1 is the one that can stop the migration:** it lists partnerships rows that already
violate the invariant, and expects **0 rows**. If any come back, stop and read them - each is
either a shape this run did not enumerate or an already-broken row, and which it is changes the
fix.

### Part 2 - applying 087 (only if L7 passed)

**L8. Dry run first.** Open `087_partnership_vendor_identity.sql`, change the `COMMIT;` on
**line 583** to `ROLLBACK;`, run the whole file.
*Expect:* it completes with no error and nothing persists. Confirm nothing persisted:
`SELECT count(*) FROM pg_proc WHERE proname='org_has_member_with_email';` returns **0**.
*This step exists because 086 shipped with no transaction control, so this exact swap silently
did nothing and what was believed to be a dry run applied for real.*

**L9. Apply for real.** Restore the `COMMIT;`, run the file.
*Expect:* "Success. No rows returned". Then run V1 through V4 in the verification block.
V2 hashes all six `current_user_*` helpers - **capture those hashes before applying too, and
diff them.** Any change means the file did something it does not describe.

### Part 3 - proving it in the product (both accounts)

**L10. The escalation is closed.** As **account A**, signed in, from the browser console on any
authenticated page:
```js
const { createClient } = await import('/lib/supabase/client')  // or use the app's client
await supabase.from('partnerships').insert({
  lead_org_id: '<account A org id>',
  vendor_org_id: '43c6628a-8953-4dc5-96da-fe0ecee5e57c',
  partner_email: 'attacker-supplied@example.com',
  status: 'pending'
})
```
*Expect:* error `42501`, "new row violates row-level security policy for table partnerships".
**Before 087 this succeeded.** Then confirm the read it used to buy is gone:
```js
await supabase.from('profiles').select('id,email,default_terms,business_criteria')
  .eq('id','7cee347d-b224-40c2-a2cf-145c863ade9d')
```
*Expect:* **0 rows.**

**L11. The ghost-then-update bypass is closed.** Same session. Insert the ghost shape - this is
legitimate and **must still succeed**:
```js
await supabase.from('partnerships').insert({
  lead_org_id: '<account A org id>', vendor_org_id: null,
  partner_email: 'ghost-087-test@example.com', status: 'pending'
}).select('id')
```
*Expect:* 1 row. Then try to repoint it to New Org 1.
*Expect:* error `23514`, "partnerships.vendor_org_id ... has no member whose email matches
partner_email ...". **A `23514`, not "0 rows updated".** If you get 0 rows and no error, the
trigger did not attach - run V4.
**Then delete the test row as `postgres` in the SQL editor.** There is no DELETE policy on
partnerships so you cannot remove it from a session, and a stray ghost row shows up in
`/agency/pool` as a Discovered vendor.

**L12. THE ONE THAT CATCHES AN OVER-NARROW FIX. Do not skip it.** As **account A**, in the
product: `/agency/pool`, **Add Partner**, invite **gmarkant+neworg1@gmail.com** by email
address.
*Expect:* the invitation is created, the pool shows the row, and the invitation email arrives.
The route resolves that address to its profile and then to its organization, so `partner_email`
and `vendor_org_id` agree and the new predicate passes.
*Fail:* a 403. **That means the invariant is wrong about a real shape** - roll back with
`087_partnership_vendor_identity_down.sql` and re-read L7's P1 output. **This is the step that
distinguishes account B from the sixteen legacy accounts: B's organization id is not its user
id, so if the invite path is resolving a user id anywhere, this is where it shows.**

**L13. The vendor side still works.** As **account B**, open `/partner/invitations` and
**accept** the invitation from L12.
*Expect:* it accepts and the partnership goes active. That path is "Partners can update
partnership status" writing `status` only, so the trigger sees no change to `lead_org_id` or
`vendor_org_id` and returns the row untouched.
*Then:* as A, invite B again after removing (or invite a second address), and as B **decline**
it. *Expect:* account A receives the "declined your partnership invitation" email. That is
085's ordering constraint rather than 087's, but it runs through the same UPDATE and is worth
confirming in the same pass.

**L14. The award path still works.** As **account A**, award any open bid to a vendor.
*Expect:* it awards. *If it 500s* with "Cannot award this bid: no vendor account or email is
linked to it", that is 087's one documented behaviour change arriving - see 1e. It is loud, not
silent. Capture the response id from the log line and decide whether to ship the code fix or
apply the down migration.

**L15. Finally, the reads that must NOT have moved.** As **account A**, open `/agency/pool` and
`/agency/dashboard`; as **account B**, open `/partner/network` and `/partner/rfps`.
*Expect:* every counterparty **company name** still renders. 087 does not touch the name tier,
and if a name has become "Unknown Agency" or an email address, something narrowed
`current_user_counterparty_org_ids()` - run 085's V3, which expects `0`.
