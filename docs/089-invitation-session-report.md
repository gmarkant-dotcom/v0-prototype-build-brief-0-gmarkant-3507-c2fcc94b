# 089 — colleague invitations. Unattended session report, 2026-08-20

Branch `feat/m1-invitations`, cut from `main` at `216d1c5`. Seven commits, none
pushed. No pull request was opened and nothing was merged.

---

## Read this first

**All seven phases completed.** Nothing was left unfinished, and one phase
(6a) turned out to have been done already in an earlier session — reported
below rather than claimed.

**NOTHING IN THIS SESSION EXECUTED A STATEMENT AGAINST ANY DATABASE.** There is
no psql on PATH and no credential in this environment that could. Every claim
below is marked as one of:

- **EXECUTED** — a command was run in this repository and its output read.
  `tsc`, `pnpm build`, `pnpm lint`, the five guard scripts, and `git`.
- **READ** — a file, a commit or a migration was read and reasoned about.
- **REASONED** — a conclusion drawn from what was read, with no execution
  behind it. Every one of these is a candidate for being wrong.

**MIGRATION 089 IS NOW APPLIED AND VERIFIED IN THE LIVE DATABASE.** It was
authored in this session and applied by Greg afterwards. Everything below that
reads as "before 089 is applied" is describing a state that has passed; it is
kept because a policy can be rolled back and because the failure shapes are
worth having written down. The **SEQUENCING** section at the foot is the
current, correct order.

**THE ONE THING THAT WOULD STOP ME SHIPPING THIS.** Accepting a colleague
invitation makes an account belong to two organizations, and
`resolveActingOrgId()` fails closed on two. Section **OPEN-1** has the detail.
It is the first open item, it needs a decision before this reaches a customer,
and it is not something 089 or Phase 2 can fix on their own.

---

## Gate results — Phase 7 measured against the Phase 0 baseline

Both runs EXECUTED, once each, in this repository.

| Gate | Baseline | Final | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit **0** | exit **0** | none |
| `pnpm build` | exit **0** | exit **0** | none; five new routes appear in the route table |
| `pnpm lint` | exit **1**, **182 problems (154 errors, 28 warnings)** | exit **1**, **182 problems (154 errors, 28 warnings)** | **none — identical** |
| `pnpm verify-rls` | exit **2** | exit **2** | none; output byte-identical |
| `pnpm policy-audit:guard` | exit **1**, parsed 104, 60 company-scoped, **FLAGGED 53** | exit **1**, parsed 104, 60 company-scoped, **FLAGGED 53** | **none — identical** |
| `pnpm identity-columns:guard` | exit **0**, 372 files, TOTAL 0 | exit **0**, **380 files**, TOTAL 0 | **+8 files scanned** |
| `pnpm embed-targets` | exit **0**, 372 files, REPOINTED 0 | exit **0**, **380 files**, REPOINTED 0 | **+8 files scanned** |
| `pnpm org-id-reads:guard` | exit **0**, 371 files, OPEN 14 / 61, **IMPROVED 8 / 11** | exit **0**, **379 files**, OPEN 14 / 61, **IMPROVED 0 / 0** | **+8 files; IMPROVED 8→0 and 11→0** |

### Every movement, explained

**+8 files scanned, in all three file-counting guards.** Eight source files were
added and every one is under a scanned root:

```
lib/org-invitations.ts
app/api/org/invitations/route.ts
app/api/org/invitations/accept/route.ts
app/api/org/invitations/decline/route.ts
app/api/org/invitations/revoke/route.ts
app/join/[token]/page.tsx                      <- server, the feature gate
app/join/[token]/join-invitation-client.tsx    <- client, the surface
app/agency/settings/team/team-roster-client.tsx <- client half of an existing page
```

Six of those are new code. The other two are the **feature-flag split**: a client
component cannot read a server-side env var, so each flagged page is now a
one-line server `page.tsx` beside the client component it renders. That turns
one file into two in each of two places, which is +2 on top of the +6.

`org-id-reads` reads 379 rather than 380 because its roots exclude
`middleware.ts`. 371 + 8 = 379 and 372 + 8 = 380 — both consistent.

**IMPROVED 8 → 0 and 11 → 0** is Phase 6(b), and it is bookkeeping, not repair.
Those nineteen entries recorded MORE findings than the script finds; the
sixteen at zero were deleted and the three that had dropped were lowered.
`OPEN` stayed at **14** and **61** in both classes, which is the check that this
changed the record and not the reality: deleting an entry whose count is zero
removes a row that describes nothing.

**verify-rls exit 2 and policy-audit:guard exit 1 are environmental and are the
pre-existing condition.** `verify-rls` cannot reach `pg_class` through
PostgREST. `policy-audit:guard` reads the point-in-time snapshot
`docs/schema-snapshot-2026-08-13.md`, not the migrations directory, so it
cannot see 089 and correctly did not move.

**Nothing was reworded to satisfy a guard, and no exemption was added.** One
allow-list entry was RENUMBERED — quoted in full in Phase 6 below.

**No gate reads a `.sql` file.** Every gate above is green or unchanged and
that says nothing whatever about migration 089. The SQL Editor dry run is the
only thing that has ever validated one.

---

## THE APPLY ORDER

### 1. Apply migration 089 FIRST. Then push the code.

```
supabase/migrations/089_org_invitation_lifecycle.sql
```

**Does the Phase 2 code break if 089 is not applied first? Yes, and visibly.**
It fails loudly and it fails clean — nothing is half-written and there is no
data to repair afterwards. Exactly what a user sees, per branch (**REASONED**
from the policy state, not executed):

| Surface | Without 089 | Why |
|---|---|---|
| Team page, "Invite colleague" | HTTP 403, *"Invitations are not available yet."* | `org_invitations` has no INSERT policy at all, so the insert returns 42501 and `app/api/org/invitations/route.ts:232` maps it |
| Team page, "Revoke" | HTTP 403, same copy | no UPDATE policy; the update matches no row and `revoke/route.ts:160` catches the silent-success shape |
| Team page, pending list | empty | correct — there is nothing to list, because nothing can be created |
| `/join/<token>` | *"That invitation could not be found."* | the invitee SELECT policy does not exist, so the row is filtered out; an empty result, not an error |
| Accept / decline | HTTP 503, *"Invitations are not available yet."* | PostgREST answers `PGRST202`, mapped at `lib/org-invitations.ts:117` |

**There is deliberately no fallback path anywhere in this code.** The 082
fallback blocks are this repository's own worked example of the alternative: a
fallback that fires silently returns a wrong answer instead of an error.

**The reverse order is completely safe.** Applying 089 without pushing the code
changes nothing for anybody: three functions no caller calls, three policies no
writer exercises, and one CHECK constraint that admits a value nothing writes.
That is the direction to take.

### 2. Nothing else in this session needs a migration

Phases 3, 4, 5 and 6 are code and script changes only, and every one of them is
safe to deploy in any order relative to 089. Phase 3's emitters depend on 088,
which is **already applied**.

---

## The dry run for 089

**File:** `supabase/migrations/089_org_invitation_lifecycle.sql`
**Change the `COMMIT;` on LINE 777 to `ROLLBACK;`**, run the whole file, confirm
no errors, then change it back.

Verify the line numbers before trusting them (**EXECUTED**, and this is the
output as of this commit):

```
$ grep -n -i '^begin\|^commit\|^rollback' supabase/migrations/089_org_invitation_lifecycle.sql
315:BEGIN;
507:BEGIN      <- plpgsql, accept_org_invitation's body. No semicolon.
676:BEGIN      <- plpgsql, decline_org_invitation's body. No semicolon.
777:COMMIT;
```

Four hits is correct. Exactly one line ends in `BEGIN;` and exactly one in
`COMMIT;` — also verified by `grep -c '^BEGIN;$'` and `grep -c '^COMMIT;$'`,
both **1**. Do **not** use that anchored form as your only check: it has
produced false negatives in this repository and 087 nearly burned a dry run on
it.

**"Success. No rows returned" PROVES NOTHING ON ITS OWN.** It is the identical
message for a dry run that rolled everything back, for a real apply that
committed, and for a correct file pasted into the wrong project's tab. The only
thing that distinguishes them is the verification block, so run it.

### The verification query to run afterwards

The file carries nine (V1–V9 at its foot). The one that settles whether it
worked:

```sql
-- V4/V5 together. Four policies on the table, 117 in the schema.
SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'org_invitations'
ORDER BY policyname;
-- EXPECTED: exactly 4 rows, all {authenticated}:
--   Invitees read their own invitation      SELECT
--   Org admins create invitations           INSERT
--   Org admins manage their invitations     UPDATE
--   Org admins read their invitations       SELECT   <- 086's, unchanged
-- and NO row with cmd = 'DELETE'.

SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
-- EXPECTED: 117.  Baseline 114 + 3.
```

And the one that catches the mistake 088 made:

```sql
SELECT 'current_user_email' AS fn,
       has_function_privilege('anon',          'public.current_user_email()', 'EXECUTE') AS anon,
       has_function_privilege('authenticated', 'public.current_user_email()', 'EXECUTE') AS authenticated
UNION ALL
SELECT 'accept_org_invitation',
       has_function_privilege('anon',          'public.accept_org_invitation(text)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.accept_org_invitation(text)', 'EXECUTE')
UNION ALL
SELECT 'decline_org_invitation',
       has_function_privilege('anon',          'public.decline_org_invitation(text)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.decline_org_invitation(text)', 'EXECUTE');
-- EXPECTED: anon = f, authenticated = t, on ALL THREE ROWS.
```

**Predicted policy count after applying: 117.** Stated explicitly so it can be
compared rather than guessed. Baseline 114, three policies added, none dropped.
If the post-apply count is anything else, something moved between the 114
measurement and this apply and it is worth finding before proceeding.

**Rollback file:** `089_org_invitation_lifecycle_down.sql`, `BEGIN;` line 127,
`COMMIT;` line 177. It drops **three** policies, not four — the fourth belongs
to 086 and taking it would silently roll back part of a different migration.
It carries three partial rollbacks, and it records that dropping and recreating
these functions later **re-grants `anon`**, because `DROP` then `CREATE` does
not preserve an ACL while `CREATE OR REPLACE` does.

---

## What was built, per phase

### Phase 0 — the survey (`2a4abdc`)

`docs/089-invitation-write-surface.md`. **EXECUTED**: eight gates once for a
baseline, plus one batched grep pass.

The headline: the entire `org_invitations` code surface was **two comments in
`lib/capabilities.ts` and nothing else** — no route, no client, no write. 086
shipped the table read-only on purpose, so 089 and Phase 2 define the write
convention rather than change one.

Confirmed and load-bearing: `/partner/invitations` is the live vendor
partnership CTA in five places plus the auth callback's default post-login
destination. It was not repurposed.

### Phase 1 — migration 089 (`7a23fdf`)

**Authored in this session; SINCE APPLIED AND VERIFIED by Greg.** 956 lines
up, 245 down.

| | |
|---|---|
| `current_user_email()` | `:350`. No arguments, so unlike 087's `org_has_member_with_email(uuid, text)` it is not a confirm-oracle — there is nothing to pass it |
| status CHECK | `:391` DROP, `:394` ADD. `+ 'declined'`. Zero rows, so it validates against nothing and the new list is a strict superset of the old |
| `"Invitees read their own invitation"` | `:424`. SELECT. **The gap nobody had named** — without it the landing page renders an empty result, not an error |
| `"Org admins create invitations"` | `:451`. INSERT |
| `"Org admins manage their invitations"` | `:473`. UPDATE, covering revoke and the expiry stamp. **No DELETE policy** |
| `accept_org_invitation(text)` | `:495`. Returns jsonb |
| `decline_org_invitation(text)` | `:665` |
| REVOKEs | section 8, `:765-775`. All three carry `REVOKE EXECUTE ... FROM anon` **by name** |

`service_role` is deliberately **not** granted — it inherits, V1 asserts the
inherited value rather than a GRANT pretending to set it (082's precedent), and
no service-role caller exists in this path by ruling.

`IN (SELECT fn())` everywhere, never `= ANY (fn())`.

### Phase 2 — the lifecycle in code (`c3b94d0`, `c493b6b`)

| File | What |
|---|---|
| `lib/org-invitations.ts` | shared vocabulary. TTL, token mint, SQLSTATE→HTTP map, role and status labels |
| `app/api/org/invitations/route.ts` | POST create. Admin only, session client, expiry sweep, 23505 handling, email |
| `app/api/org/invitations/revoke/route.ts` | POST revoke. Reads before updating |
| `app/api/org/invitations/accept/route.ts` | POST accept. One `.rpc()` |
| `app/api/org/invitations/decline/route.ts` | POST decline. One `.rpc()` |
| `app/join/[token]/page.tsx` | the invitee landing surface |
| `app/agency/settings/team/team-roster-client.tsx` | invite form, pending list, revoke, past list, roster-of-one (client half) |
| `app/agency/settings/team/page.tsx` | one-line server component: reads the flag, passes it in |
| `lib/email.ts:192` | `buildColleagueInvitationEmail()` |

**Expiry: 7 days** (`lib/org-invitations.ts:31`). `expires_at` is NOT NULL with
no default, so every writer must pick. Seven and not the magic link's 72 hours
because being asked to join your own company's account is not a deadline and
routinely waits for somebody to come back from leave; seven and not thirty
because it is still a bearer credential sitting in an inbox.

**Token: the same entropy source and shape as the vendor magic link** —
`crypto.randomUUID().replace(/-/g,"") + crypto.randomUUID().replace(/-/g,"")`,
64 hex characters, 256 bits. That is the only other emailed bearer credential
stored in a `text` column in this product, and two shapes for one job is how
one of them ends up weaker than anybody meant. Written once, at
`lib/org-invitations.ts:52`, so the two cannot drift.

**Landing surface: `/join/<token>`, a NEW path.** `/partner/invitations` was
NOT reused, because Phase 0 confirmed it is the vendor partnership CTA at
`app/api/partnerships/route.ts:590,591,723,724`,
`app/api/agency/pool/resend-invitation/route.ts:63`, `lib/notifications.ts:318`
and — the one that would hurt most — `app/auth/callback/route.ts:260,308`,
where it is the default post-login destination for a partner with no explicit
`next`. `/join` is also portal-neutral, which `/agency/...` and `/partner/...`
are not: middleware bounces between the two on `active_role` and would
ping-pong an invitee whose portal does not match.

**`middleware.ts` was not touched and needs no change.** Its matcher already
covers everything except `_next`, favicon, images and `api/`, and `/join` is
not in `publicPaths`, so an unauthenticated visitor is redirected to
`/auth/login?next=/join/<token>` — and `next` is already in the passthrough
list and is honoured by both the login page and the auth callback.

**The expiry setter, and the half of it that does not work.** Both RPC
functions stamp a lapsed invitation `'expired'` and then RAISE — **and the RAISE
rolls the stamp back**, because PostgREST wraps each call in one transaction and
there is no way to both raise and persist inside one. This is flagged at the
top of 089's header, at both call sites in the function bodies, and in
**OPEN-4** below. Both statements were subsequently **deleted** rather than
kept-and-annotated, because a statement that reads as working and provably never
runs to completion is the same class as the dead 42P01 branch in
`lib/milestone-events.ts`. The RAISE was kept exactly as it is: a raise fails
loudly where a returned status code fails silently. **The only durable expiry
writer is the create route's pre-insert sweep**
(`app/api/org/invitations/route.ts:178`), which is also the only place a stale
row is ever felt — a lapsed pending row costs nobody anything until it blocks a
re-invite through the partial unique index.

**Roster-of-one, said in the interface.** Conditioned on
`members.length === 1 && pending.length === 0`, and it names no migration
number. Both of those are the reasons the old 086 banner was removed: it was
unconditional on the row count so it asserted something false to all sixteen
solo accounts, and it named an internal migration in copy no customer can act
on. The half worth keeping is kept.

**No org id is resolved from a user id anywhere in this work.** Every route
derives its organization through `resolveActingOrgId(user.id, supabase)`, which
reads `org_members` keyed by an id the caller cannot choose. `orgId` is typed
explicitly as `OrgId` at each site, because the brand is defeated wherever a
value arrives as `any` from PostgREST.

**Roles are read from `org_members`, not from `can()`.** See **OPEN-2**.

### Phase 3 — verification, then four emitters (`27c47ac`)

**I EXECUTED NOTHING against any database for this phase. Commit `981016b` and
migration 088 were READ.** Everything in the table below is **REASONED** from
those two files.

The seven clauses of `"Vendors insert own company milestone events"` against
what the shipped emitter passes:

| # | Policy requires | Emitter passes | Verdict |
|---|---|---|---|
| 1 | `actor_side = 'vendor'` | `actorSide: "vendor"`, literal | ✅ |
| 2 | `actor_id = auth.uid()` | `actorId: user.id` from `supabase.auth.getUser()` at `:123`, and the route 401s at `:126` when absent | ✅ |
| 3 | `actor_email IS NULL` | not passed. `resolveActorEmail()` returns null when `actorEmail` is absent | ✅ |
| 4 | `vendor_org_id IN (SELECT current_user_org_ids())` | `vendorOrgId: writeOrgId`, from `resolveCallerWriteOrgId(user.id, supabase)` at `:132`, which delegates to `resolveActingOrgId` and returns only an org the caller is a **member** of | ✅ |
| 5 | `event_type = ANY (vendor_emittable_event_types())` | `"bid.submit"`, first of the seven | ✅ |
| 6 | `partnership_id IS NOT NULL` | resolved at `:485-501`, inbox link preferred, `(lead, vendor)` pair as fallback | ⚠️ **can be null** — see below |
| 7 | `EXISTS (p.id = partnership_id AND p.vendor_org_id = … AND p.lead_org_id = org_id)` | `orgId: orgIdFromColumn(inbox.lead_org_id)` — **the AGENCY**, read off the inbox row the route already verified access to | ✅ |

**Clause 7 is the one the brief flagged as most likely wrong, and it is right.**
`org_id` names the agency, not the caller's own organization, and it is
`inbox.lead_org_id`. If it had been the caller's own org the EXISTS would fail,
the insert would be refused with 42501, and `lib/milestone-events.ts` would
swallow it — the event would silently never record. It does not have that
defect.

**Clause 6 is the residual, and it is a silent one.** If the inbox row has no
`partnership_id` and no `(lead_org_id, vendor_org_id)` partnership exists,
`milestonePartnershipId` is `null`, the policy refuses the row with 42501, and
`lib/milestone-events.ts` logs at ERROR and returns void. The bid is unaffected
and the breadcrumb is lost. **Not fixed** — it fails in the safe direction and
fixing it means deciding whether a bid without a partnership should create one,
which is a product question. Logged as **OPEN-6**.

**The payload carries nothing about the competitive field.** It is one key,
`scope_item_name`, taken from `inboxDetail?.scope_item_name` and not from the
already-defaulted `scopeItemName` — no counts, no cross-vendor totals, no
recipient lists. The two worked examples of getting this wrong (the
`recipient_count` leak and the `payment.mark_paid` totals) are both a payload
carrying more than the act; this one does not.

**No second emitter was built.** `bid.submit` fires from two places and always
did: the guest path at `app/api/rfp/guest/[token]/route.ts:857` and this portal
path. They are mutually exclusive — a guest has no session and a portal caller
has no magic token.

#### Coverage: 17 of 23, not 15

**Measured**, by grepping every `eventType:` call site. All sixteen agency-side
types plus `bid.submit`.

The six that were missing are **all policy-unblocked** — every one is already on
`vendor_emittable_event_types()`, so 088 covers them and no migration is needed.
Four needed no ruling and are now implemented:

| Type | Where | Note |
|---|---|---|
| `bid.revise` | `app/api/partner/rfps/[id]/response/route.ts:482` | same emit, `nextVersion > 1` |
| `invitation.accept` | `app/api/partnerships/route.ts:1082` | vendor accepting a **partnership** |
| `invitation.decline` | `app/api/partnerships/route.ts:1225` | the branch whose notification INSERT is already known to be refused by RLS — this is a second channel through a different policy |
| `status_update.post` | `app/api/partner/projects/[projectId]/status-update/route.ts:308` | the POST partnerships select was widened to `id, lead_org_id, vendor_org_id`; the GET is unchanged |

None of the four is in `UNION_REPLACING_EVENT_TYPES`, so `milestoneDedupeKey()`
returns null for each and none can collide with a derived union line.

**Two are left, and both need a ruling rather than a policy** — see
**RULING-4** and **RULING-5**.

### Phase 4 — company names (`d610c16`)

`lib/company-identity.ts` gains `isFreeEmailProviderName()`,
`looksLikeEmailAddress()`, `UNNAMED_ORGANIZATION` and
`companyNameForSignup()`. `app/auth/sign-up/page.tsx:204` uses the last one.

**(a) The trim was already there** — `normalizeCompanyName(companyName)` was
already on that line, added in an earlier session with the Caro
trailing-space mechanism written out beside it. It is preserved:
`companyNameForSignup()` routes both inputs through the same
`normalizeCompanyName()`, so there is still exactly one normaliser.

**(b) The conservative version, and the choice is stated.**
`companyNameForSignup()` is `handle_new_user()`'s own fallback chain with the
**email local part step removed** and `'Untitled organization'` kept as the last
resort. It never returns an empty string, and an empty string is precisely what
sends the trigger down its chain to the email. An organization named "Untitled
organization" reads as unset and gets renamed; one named "icloud" reads as an
answer and nobody ever thinks to change it.

**The reachable path through the form was whitespace.** A single space
satisfies HTML `required` and then normalises to empty — which is exactly the
input that produced the live rows. Lines 141 and 145 now validate the
**normalised** value for both fields, which is what makes the attribute mean
what it looks like it means.

**The provider list deliberately omits `proton`, `mail`, `me`, `hey`,
`fastmail`, `zoho` and `pm`.** Every one of those is a free mail provider AND a
plausible company name. Missing a provider costs one badly named organization
its owner can rename; catching a real company renames it for them without
asking. Sixteen unambiguous tokens are in the list.

**What this does NOT close, stated plainly.** `supabase.auth.signUp` is called
client-side with the anon key, so the form is not a boundary — a crafted request
can send no metadata at all and land straight on the trigger's email branch.
Only the trigger closes that, and the trigger is explicitly out of scope. This
closes every account created through the product, which is where the live
examples came from. **EXECUTED**: `grep -rn "auth.signUp\|signInWithOAuth\|
signInWithOtp\|admin.createUser" app lib` returns exactly one hit, so there is
no second signup path in this repository to also fix.

**No repair SQL was written for the existing rows,** per the brief.

### Phase 5 — `/partner/rfps/null` (`d610c16`)

`app/api/agency/rfp-responses/[id]/route.ts:913`. The feedback email
interpolated `existing.inbox_item_id` into `/partner/rfps/${...}`, which
renders the literal string `/partner/rfps/null` for a guest bid — the common
shape, not an edge case. It now links to the unparameterised `/partner/rfps`
when the id is null.

**Only the safe half was done and no destination was invented.** The
unparameterised route is not a guess: the decline mail (`:1053`) and the award
mail (`:1187`) on this same route already link exactly that way, so a guest
following the feedback link now gets what the other two already give them.
Where a guest with no inbox row should actually land is **RULING-3**.

### Phase 6 — sanctioned cleanups (`fac17ac`)

**(a) Already done. Nothing to remove.** `lib/vouch-counts.ts` is 121 lines and
contains no fallback: the two 082-FALLBACK table reads were deleted in commit
`7232919`, *"refactor: delete the two 082-FALLBACK table reads now that 082 is
applied and verified"*, and the file header already sets out why they had to go
(with the policy dropped, a fallback returns 0 rather than failing, so every
vouch badge reads zero silently). **EXECUTED**: `grep -n "PGRST202\|from("
lib/vouch-counts.ts` finds only two header comments and no query. Reported
rather than claimed.

**(b) Nineteen drifted-low entries trimmed.** Measured at Phase 0 — 8 in
`KNOWN_OPEN`, 11 in `KNOWN_OPEN_MIRROR` — and unchanged by anything this session
did. Both arrays' own rule is *"when a count reaches zero, delete the entry"*,
so the sixteen at zero were deleted and the three that had dropped were
lowered.

**Every line changed, quoted.**

`KNOWN_OPEN` — eight entries deleted, all measured at 0:

```
-  { file: "app/api/partner/payments/route.ts", count: 1 },
-  { file: "app/api/partner/projects/[projectId]/active-engagement/route.ts", count: 1 },
-  { file: "app/api/partner/projects/route.ts", count: 1 },
-  { file: "app/api/partner/rfps/[id]/route.ts", count: 1 },
-  { file: "app/api/partner/rfps/route.ts", count: 1 },
-  { file: "app/api/partnerships/route.ts", count: 4 },
-  { file: "app/partner/profile/page.tsx", count: 1 },
-  { file: "lib/magic-token-attach.ts", count: 1 },
```

`KNOWN_OPEN_MIRROR` — three lowered:

```
  app/api/agency/bids/[responseId]/ai-score/route.ts    -    count: 4,   +    count: 2,
  app/api/agency/broadcast-rfp/route.ts                 -    count: 4,   +    count: 2,
  app/api/partnerships/route.ts                         -    count: 2,   +    count: 1,
```

`KNOWN_OPEN_MIRROR` — eight entries deleted, all measured at 0 (each was a full
block with a `why`; the file/count lines are quoted):

```
-    file: "app/api/partner/network/[agencyId]/route.ts",   count: 3,
-    file: "lib/bid-analysis-context.ts",                   count: 7,
-    file: "lib/bid-summary-generation.ts",                 count: 1,
-    file: "lib/clients-server.ts",                         count: 1,
-    file: "lib/delivery-review.ts",                        count: 1,
-    file: "lib/library-documents.ts",                      count: 4,
-    file: "lib/rfp-evaluation-criteria-server.ts",         count: 3,
-    file: "lib/vouch-counts.ts",                           count: 1,
```

**Nothing was trimmed where the measured count is HIGHER, and no entry was
added.** `app/api/partner/network/[agencyId]/route.ts` stays in `KNOWN_OPEN` at
count 1 — only its `KNOWN_OPEN_MIRROR` entry reached zero.

**ONE ALLOW-LIST ENTRY WAS REPOINTED, AND IT IS NOT AN EXEMPTION.** The scoped
`ALLOWED` entry that already covered two pre-existing `profiles` reads stopped
matching twice: first when the invitation surface landed above them and moved
their line numbers, then when the feature-flag split renamed the file. Both are
relocations of the same two reads. Final state, against what it said at the
start of the session:

```
-    file: "app/agency/settings/team/page.tsx",
-    // 160 and 166 since the two 086 banners were deleted and the file header rewritten to
-    // say why. Same two reads, same reason; only the line numbers moved.
-    lines: [160, 166],
+    // RENAMED, not re-scoped. The roster is now a client component beside a one-line server
+    // page.tsx that reads the COLLEAGUE_INVITATIONS flag, because a client component cannot
+    // read a server-side env var. page.tsx itself contains no query of any kind.
+    file: "app/agency/settings/team/team-roster-client.tsx",
+    // 291 and 297. SAME TWO READS, SAME REASON, SAME CODE - the file was renamed and the
+    // invitation surface landed above them. The scoping is deliberately KEPT: any profiles
+    // read added to this file on a line other than these two is still a real finding.
+    lines: [291, 297],
```

The `why` text is untouched, the entry stays **scoped** to two lines, and no
file was ADDED to `ALLOWED` — the count of entries is unchanged. It is the same
two `.in("id", userIds)` reads against `profiles`, where `userIds` comes from
`org_members.user_id` one statement earlier. The new `page.tsx` contains no
query of any kind and is not on any list.

---

## OPEN — assumptions a database query would have settled

Every one of these is **REASONED**. None was executed. Each carries the query
that settles it.

### OPEN-1. Accepting an invitation may leave the accepting user unable to write anything. **This is the blocker.**

`resolveActingOrgId()` (`lib/acting-org.ts:205`) returns
`{ orgId: null, reason: "ambiguous" }` when a caller belongs to more than one
organization and no stored preference names one. The tie-breaker it looks for,
`profiles.active_org_id`, **does not exist as a column** — `lib/acting-org.ts:169`
guards a 42703 for precisely that reason, and `grep -rn "active_org_id" app lib
components supabase/migrations` (**EXECUTED**) finds it named only in that
module's own comments and in 089's.

`accept_org_invitation()` is the first thing in this product's history that can
give an account a second membership. Both realistic paths end there:

- **Invitee already has an account.** They signed up, `handle_new_user()`
  created their own organization, one membership. Accept → two.
- **Invitee has no account.** They sign up, `handle_new_user()` creates an
  organization, one membership. Accept → two.

So the colleague who accepts is `"ambiguous"` and every write path that calls
`resolveActingOrgId()` or `resolveCallerWriteOrgId()` refuses them.

**089 not touching `profiles.active_org_id` is correct and it is not
sufficient.** Silently repointing somebody's acting organization on accept is
the misattribution `resolveActingOrgId` exists to prevent. But nothing else
sets it either, and the column is not there to set.

**What was done about it:** the accept route counts memberships afterwards
(`accept/route.ts:107`) and the landing page states it plainly to the user
(`app/join/[token]/page.tsx`, the amber block) rather than letting them
discover it. That is honesty, not a fix.

**The query that settles it:**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name = 'active_org_id';
-- EXPECTED per this session's reading: 0 rows.

SELECT user_id, count(*) FROM public.org_members
GROUP BY user_id HAVING count(*) > 1;
-- EXPECTED today: 0 rows. After the first accept: 1.
```

**What it needs:** a migration adding `profiles.active_org_id` plus a switcher,
or a ruling that accept sets it when the accepter's only other membership is
their own auto-created solo organization. The second is a product decision and
was not guessed. **Do not put this in front of a customer until one of them
exists.**

### OPEN-2. `orgRoleFor()` returns "owner" for every caller, and 089 is the moment that stops being true

`lib/capabilities.ts:249` returns `"owner"` unconditionally. Its own header at
`:236-240` says: *"The moment anything can add a SECOND member to an
organization — that is org_invitations and the membership interface, phase two,
not this branch — this function must start reading org_members.role, or every
colleague added is silently an owner."*

**This is not a data hole.** Every relevant policy resolves
`current_user_admin_org_ids()`, which reads `org_members.role` for real, so a
plain member's write is refused with 42501 whatever the client believed. It is
a **surface** problem: the UI would offer actions that fail at the server.

**What was done:** every surface added this session resolves the caller's real
role through `loadOrgRole()` — which was written and deliberately left unused
waiting for exactly this — rather than `can()`. The team page and both admin
routes do this.

**What was NOT done, and why:** changing the body of `orgRoleFor()` alters the
result of every capability check in the product in one commit, which is beyond
this brief. The change is one line:

```ts
// lib/capabilities.ts — orgRoleFor() becomes async and delegates:
return await loadOrgRole(userId, orgId, client)
```

and it has to be made **before the second member exists**, i.e. before or with
089.

**The query that settles the exposure:**

```sql
SELECT role, count(*) FROM public.org_members GROUP BY role;
-- EXPECTED today: one row, owner = 16. Anything else means a non-owner
-- already exists and orgRoleFor() is already lying about them.
```

### OPEN-3. The invitee cannot read the inviting organization's name

`organizations` carries two SELECT policies (079:1748, 079:1794): members read
their own, members read counterparty organizations. **An invitee is neither** —
that is the premise of an invitation — so the row is filtered out and comes back
as null at HTTP 200, not as an error. The inviter's `profiles` row is the same.

**No policy was widened.** A policy blocking a surface is a finding to report,
not a licence to loosen one, and *"let a token holder read an organization's
name"* is a disclosure decision that is not mine to make.

**Consequence:** `/join/<token>` cannot name the company on the pre-decision
screen. It says so honestly and points at the email. The email (which the
invitee is holding) names the company in its subject and first sentence, and
`accept_org_invitation()` returns `org_name`, so the confirmation names it. The
only unnamed moment is that one screen.

**The remedy, if you want it:** a fourth SECURITY DEFINER function in a
follow-up migration —
`org_invitation_preview(p_token text) RETURNS jsonb`, gated on the same email
match the accept function uses, returning org name, role and expiry and nothing
else. It was **not** authored, because it is a disclosure decision and because
089 is already committed with a stated policy count of 117.

**The query that confirms the block:**

```sql
-- As the INVITEE, after 089 is applied and a test invitation exists:
SELECT o.id, o.name FROM public.organizations o
WHERE o.id = (SELECT org_id FROM public.org_invitations
              WHERE token = '<the test token>');
-- EXPECTED per this session's reading: 0 rows.
```

### OPEN-4. A lapsed invitation keeps `status = 'pending'` until somebody re-invites

**RESOLVED AS A CODE DEFECT; THE BEHAVIOUR IT DESCRIBES IS NOW DELIBERATE.**

An earlier draft of 089 wrote `UPDATE ... SET status = 'expired'` immediately
before the `RAISE` in each function. It could never have persisted: PostgREST
wraps every RPC call in one transaction and an exception aborts it, so both
UPDATEs would have been rolled back with the RAISE every single time.

**Both statements are now DELETED** (`:570` and `:702` are the surviving
RAISEs), and a comment naming the reason stands in each place. Annotating a
dead statement is not enough — the next person greps for the UPDATE, finds it,
and believes it. That is exactly what the 42P01 branch in
`lib/milestone-events.ts` did: dead for its entire working life while reading as
a live guard, and it cost a real investigation to find.

**The RAISE was kept unchanged.** Returning a status code instead would let a
stamp persist, but that trade runs the wrong way — a raise fails LOUDLY at the
caller, a returned code fails silently the first time a caller forgets to check
it.

**The only durable expiry writer in this product** is the create route's
pre-insert sweep, `app/api/org/invitations/route.ts:178`. It commits because
nothing raises after it, and it is the only moment a stale pending row is ever
felt — such a row costs nobody anything until it blocks a re-invite through
`org_invitations_one_live_per_email`.

**What remains open, and it is a data-shape fact rather than a defect:** a
lapsed invitation reads `'pending'` in the database until somebody re-invites
that address. **The interface does not repeat the omission** — the team page
reads `expires_at` and renders "Lapsed" rather than trusting the column
(`app/agency/settings/team/team-roster-client.tsx`, the pending table's Expires
cell).

**The query that shows it:**

```sql
SELECT token, status, expires_at, updated_at FROM public.org_invitations
WHERE expires_at <= now() AND status = 'pending';
-- EXPECTED: rows, and that is correct now rather than a bug. Anything
-- reading 'expired' here was stamped by the create route, not by an RPC.
```

### OPEN-5. The email-match convention is assumed to hold for every live profile

089's policy and both functions compare `lower(btrim(x))` on both sides and are
false if either is NULL. The established state says zero profiles have a null
email. **Not re-verified — I cannot query.** If any profile has a null email,
that person can never see or accept an invitation, and the failure is an empty
result rather than an error.

```sql
SELECT count(*) FROM public.profiles WHERE email IS NULL OR btrim(email) = '';
-- EXPECTED: 0.

-- And the case-collision check the partial index makes but the profiles
-- table does not:
SELECT lower(btrim(email)), count(*) FROM public.profiles
GROUP BY 1 HAVING count(*) > 1;
-- EXPECTED: 0 rows. More than one profile sharing a normalised address
-- would make "Invitees read their own invitation" visible to both.
```

### OPEN-6. `bid.submit` can still lose its breadcrumb to a null `partnership_id`

Described in Phase 3. Fails closed and silently — 42501, swallowed by
`lib/milestone-events.ts`. Not fixed.

```sql
SELECT count(*) FROM public.partner_rfp_inbox WHERE partnership_id IS NULL;
-- Every one of these is a bid whose portal milestone will not record.
```

### OPEN-7. The pre-flight assumptions in 089

The file's P1 assumes the status constraint is named `org_invitations_status_check`
and P2 assumes the table is still empty. Both come from 086's `CREATE TABLE` and
from the established state, both **READ, not queried**. P1 is a stopper: if the
name differs, the DROP in section 2 fails and the migration stops. Both queries
are in the file.

---

## RULINGS DEFERRED — product decisions not guessed

**RULING-1. Who may revoke an invitation.** The capability map says
`org.member_invite: 'admin'` and `org.member_revoke: 'owner'`. This session
lets an **owner or admin** do both, on the reasoning that `org.member_revoke` is
about removing a MEMBER — taking a colleague's live access away — and not about
withdrawing an invitation nobody has accepted; an admin who can send one should
be able to take it back, or an admin can create a pending invitation only the
owner can undo. **If that reading is wrong**, the change is one condition in
`app/api/org/invitations/revoke/route.ts:77` and one in the team page's
`mayInvite`.

**RULING-2. Whether the company field should be required at signup.** It is
`required` in HTML today and the normalised value is now validated too, so it is
effectively required. Whether that is right for the conversion funnel — versus
letting it be blank and landing on "Untitled organization" — was not decided.
The conservative version is implemented: the field stays required and the
fallback exists for anything that bypasses the form.

**RULING-3. Where a guest with no inbox row should land.** Phase 5 sends them to
`/partner/rfps`, matching the decline and award mails. The real question is
whether a guest bidder should have a destination that shows them *their own
guest bid* — they have no inbox row, so the list will be empty for them. Not
invented.

**RULING-4. `rfp.view`.** Policy-unblocked; no emitter. Firing an event every
time a vendor opens an RFP tells the agency exactly when the vendor looked, and
how often. That is a volume decision and a surveillance decision, not plumbing.
Not implemented.

**RULING-5. `nda.acknowledge`.** Policy-unblocked, and **there is no vendor act
to record.** `confirm_nda` in `app/api/partnerships/route.ts:842` is gated, and refuses at `:844`,
`if (!isAgency) return 403` — the agency confirms the NDA on the vendor's
behalf and no vendor-side acknowledgement exists in the product. The capability
map lists `nda.acknowledge: admin` under the vendor section, so the intent
exists; the surface does not. Building the surface is a product decision.

**RULING-6. What happens to a removed member's records.** Unchanged and still
open. The remove button is still not rendered on the team page and its place is
still marked.

**RULING-7. Whether accepting should switch the acting organization.** See
OPEN-1. 089 deliberately does not, and says so in a comment at the point of
temptation.

---

## Found and not fixed

**F-1. `invitation.accept` means two different things.** The capability
`invitation.accept` is listed under the vendor section and means a partnership
invitation; the colleague invitation added here also "accepts an invitation".
The new code emits **no** milestone and uses **no** capability name, so nothing
collides today — but the next person to add a colleague-invitation milestone
will reach for that string and put a colleague event on the vendor feed. Named
in `lib/org-invitations.ts`'s header and in the `invitation.accept` emitter's
comment. **Not renamed**, because renaming a capability touches the compile-time
`Capability` union and every call site.

**F-2. `lib/email.ts:246` has an em dash** in
`buildVendorConfirmationEmail`'s subject line — *"Your bid has been submitted —
{project}"* — which the house rule forbids in user-facing copy. Pre-existing,
outside this session's scope, and it ships in a live email. One character.

**F-3. `formatDate()` still does not exist.** CLAUDE.md and LIGAMENT_CONTEXT.md
both instruct using it; `lib/utils.ts` exports `formatDateTime`,
`formatSubmittedAt` and `formatRelativeTime` and nothing else. The team page
still carries its local `formatJoinedDate()` and the comment explaining why.
Already reported in `docs/m1-foundation-report.md`; repeated because it is still
true.

**F-4. `resolveCallerWriteOrgId()` and `agencyEntitlementId()` disagree about
multi-membership.** The first delegates to `resolveActingOrgId` and fails closed
on "ambiguous"; the second (`lib/entitlements.ts:234`) picks owner-then-admin-then-first
and falls back to the **user id** when membership cannot be resolved. Once
OPEN-1's second membership exists, one refuses and the other silently picks.
Not touched — it is the entitlement/quota path and adjacent to the budget
spine, which is a separate workstream.

**F-5. The 154 lint errors are untouched and unrelated.** Baseline and final are
identical at 182 problems. The seven unused `eslint-disable` directives were
**not** deleted, per the prohibition: six name
`@typescript-eslint/no-explicit-any`, which is not in this project's ruleset, so
they are unused because the rule is off and not because the `any` is gone.

---

## Commits

```
2a4abdc  docs: phase 0 - the invitation write surface, measured not assumed
7a23fdf  feat: author migration 089, the colleague-invitation lifecycle
c3b94d0  feat: the colleague-invitation API - create, revoke, accept, decline
c493b6b  feat: the invitee landing page and the team invite surface
27c47ac  feat: four vendor-side milestone emitters, verified against 088 clause by clause
d610c16  fix: company names derived from mail providers, and the /partner/rfps/null CTA
fac17ac  chore: trim the drifted-low org-id-read baselines to their measured values
```

Nothing was pushed. `middleware.ts` was not touched.
`BROADCAST_CUES_PARTNERSHIP` was not read, set or flipped. No migration was
applied and no script connecting to Supabase was written. The budget spine was
not touched.

---

# SEQUENCING

Added after the three follow-up edits (the dead expiry UPDATEs deleted, the
feature flag, and this section). **This supersedes nothing above; it is the
order to actually do things in.**

The colleague-invitation surface is now behind `COLLEAGUE_INVITATIONS`, a
server-side flag in `lib/feature-flags.ts` in the exact
`process.env.X === "true"` form `BROADCAST_CUES_PARTNERSHIP` uses. **Absent
means off.** No env file in this repository sets it and none was touched, so
Vercel not having the variable keeps the whole surface inert.

## The order

### 1. Migration 089 may be applied IMMEDIATELY. ✅ DONE — applied and verified.

It was safe on its own and it was safe alone. With no code deployed against it,
089 adds three functions no caller calls, three policies no writer exercises,
and one CHECK constraint that admits a value nothing writes. **Nothing in the
product changed.**

For the record, and for the rollback path: dry run is `COMMIT;` on **line 777**
→ `ROLLBACK;`, then the verification block. The down file is
`089_org_invitation_lifecycle_down.sql`, `BEGIN;` 127, `COMMIT;` 177.

### 2. The branch may be PUSHED with the flag off.

Everything on `feat/m1-invitations` is safe to merge and deploy without the
variable set. What a user sees with `COLLEAGUE_INVITATIONS` unset:

| Surface | With the flag off |
|---|---|
| `/agency/settings/team` | **exactly what it rendered before 089** — the read-only roster, and a footer reading "Inviting and removing colleagues is not available yet." No invite button, no form, no pending list, no past list |
| `/join/<token>` | **404.** `notFound()`, not a "coming soon" page — the surface genuinely does not exist yet, and a page explaining it would advertise an unreleased feature to anyone who guessed the URL |
| `POST /api/org/invitations` and `/revoke` | reachable, but nothing in the product calls them and no invitation can exist to revoke |
| Phases 3, 4, 5, 6 | **not flagged and not affected.** The four milestone emitters, the signup company-name fix, the `/partner/rfps/null` fix and the guard trims are all live on deploy, and all are independent of 089 |

Order between steps 1 and 2 does not matter **while the flag is off**. If the
branch ships before 089 is applied, the flagged surface is unreachable anyway;
if 089 is applied first, nothing calls it. Either way there is no broken state
and no data to repair.

### 3. Migration 090 must be applied BEFORE the flag is flipped.

**This is the one hard ordering constraint in the whole piece.**

090 does not exist yet. It must add `profiles.active_org_id` and the switcher
that sets it, because `resolveActingOrgId()` (`lib/acting-org.ts:205`) fails
closed with reason `"ambiguous"` the moment an account belongs to more than one
organization — and `accept_org_invitation()` is the first thing in this
product's history that can produce that second membership.
`lib/acting-org.ts:169` guards a 42703 for the missing column, so this is not a
prediction; the column is absent today.

**What happens if the flag is flipped before 090:** the first colleague who
accepts gets an account that can read everything and write nothing, with no
error message that explains why. Every write path resolves through
`resolveActingOrgId()` or `resolveCallerWriteOrgId()`, which delegates to it.
Both realistic paths reach it — an invitee with an account already has one
membership from their own signup, and an invitee without one gets a membership
from `handle_new_user()` before they can accept.

The accept route counts memberships afterwards and the landing page states the
problem to the user in plain language. **That is honesty, not a fix.**

### 4. Only then set `COLLEAGUE_INVITATIONS=true` in Vercel and redeploy.

Production and Preview. To turn it off again, unset it — but note what unsetting
does **not** undo: an `org_members` row an accept already wrote is real and
stays, and so does any `org_invitations` row.

## What the flag deliberately does NOT gate

**The accept and decline API routes.** An invitation that was already sent while
the flag was on must stay answerable if the flag is turned back off. Otherwise
an invitee holds a live link that returns 503 with no way to decline it, and the
pending row nobody can clear then blocks that address permanently through
`org_invitations_one_live_per_email`. **A flag should make a surface unreachable
going forward; it must never strand something already in flight.**

`/join/<token>` being 404 while accept and decline still work is not a
contradiction — it means a link sent under the old regime can still be answered
by anyone who kept the email, and no new one can be created.

**The roster.** Reading who is in your own organization needed no ruling and
needs no flag. It has been live since 086.

**The pending-invitation database read.** `loadInvitations()` still runs when the
flag is false; what the flag decides is whether any of it is rendered or
actionable. `"Org admins read their invitations"` has been live since 086, and a
flag that changed what the database returns would be a different kind of thing
entirely.

## Gates, re-run after these three edits

All eight, once, **EXECUTED**. Every one matches the Phase 0 baseline:

| Gate | Baseline | After the edits |
|---|---|---|
| `npx tsc --noEmit` | 0 | **0** |
| `pnpm build` | 0 | **0** |
| `pnpm lint` | 1, 182 problems (154/28) | **1, 182 problems (154/28)** — identical |
| `pnpm verify-rls` | 2 | **2** — output byte-identical |
| `pnpm policy-audit:guard` | 1, FLAGGED 53 | **1, FLAGGED 53** — identical |
| `pnpm identity-columns:guard` | 0, 372 files | **0, 380 files** |
| `pnpm embed-targets` | 0, 372 files | **0, 380 files** |
| `pnpm org-id-reads:guard` | 0, 371 files, OPEN 14/61 | **0, 379 files, OPEN 14/61, IMPROVED 0/0** |

The only movement is the file count, **+8** rather than the +6 reported earlier:
six new source files, plus two from the feature-flag split, which turns one file
into two in each of the two flagged pages. `org-id-reads` reads one fewer
because its roots exclude `middleware.ts`. Nothing else moved, nothing was
reworded to satisfy a guard, and no exemption was added.

## Transaction control, re-verified after the edits

Deleting the two dead UPDATEs and expanding the comments in their place moved
the `COMMIT;`. **Re-grepped after the last edit, not before** — this is the
mistake 087 nearly burned a dry run on:

```
$ grep -n -i '^begin\|^commit\|^rollback' supabase/migrations/089_org_invitation_lifecycle.sql
315:BEGIN;
507:BEGIN      <- plpgsql, accept_org_invitation's body. No semicolon.
676:BEGIN      <- plpgsql, decline_org_invitation's body. No semicolon.
777:COMMIT;
```

**`BEGIN;` is line 315. `COMMIT;` is line 777.** Both were 299 and 740 before
these edits; the header and the dry-run instruction in the file have been
corrected to the new numbers and re-checked against the grep afterwards.
`grep -c '^BEGIN;$'` and `grep -c '^COMMIT;$'` both return **1**.

The down file is unchanged: `BEGIN;` line 127, `COMMIT;` line 177. It never
referenced the deleted statements — its only mention of `'expired'` is inside
the restored CHECK constraint, which is correct and untouched.

---

# ADDENDUM — the create route was not gated. Closed.

## The gap

`colleagueInvitationsEnabled()` was read in exactly two places —
`app/join/[token]/page.tsx` and `app/agency/settings/team/page.tsx`. **The
create-invitation API route was not gated at all**, so the flag hid a button
while leaving the endpoint live.

**That is worse than not gating at all,** and the failure needs nobody to do
anything clever:

1. An invitation is created while the flag is off — by a direct POST, or by any
   client that still has the page loaded from before the flag was flipped.
2. The email goes out. Its `/join/<token>` link returns **404**, because `/join`
   *is* gated.
3. The invitee holds a link they can neither accept nor decline. The row stays
   `'pending'`.
4. That address is now wedged for that organization through
   `org_invitations_one_live_per_email` — one live pending row per
   `(org_id, lower(email))` — and nothing in the product can clear it, because
   there is no DELETE policy on `org_invitations` by design and the create
   route's sweep only clears rows that have already **lapsed**.

It is the same "never strand something already in flight" failure the flag
header already argued against, reached from the creating side instead of the
resolving side.

## The rule, now written into the flag header

**GATE CREATION, NEVER GATE RESOLUTION.** Creating an invitation is the only
operation in this feature that puts something *new* into the world. Accept,
decline and revoke all resolve something that already exists.

| Operation | Gated? | Why |
|---|---|---|
| `POST /api/org/invitations` (create) | **YES** | the only thing that creates |
| `/join/<token>` | **YES** | presents a surface that should not exist yet |
| team page invite affordance | **YES** | same |
| team roster | no | reading your own organization needed no ruling; live since 086 |
| `POST .../accept` | no | an invitation already sent must stay answerable |
| `POST .../decline` | no | same — otherwise a live link cannot even be refused |
| `POST .../revoke` | **no, and this is the important one** | revoke is the admin's **only escape** from an address wedged in the partial unique index. No DELETE policy exists, and the expiry sweep only clears already-lapsed rows. Gating it would mean flipping the flag off with a live pending invitation outstanding locks that address out of the organization until it expires on its own. The escape hatch has to work when the feature does not |

## 1. The new gate — file and line

**`app/api/org/invitations/route.ts:83`**

```ts
if (!colleagueInvitationsEnabled()) {
  console.warn("[api] POST /org/invitations refused: COLLEAGUE_INVITATIONS is off", { route })
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStoreHeaders })
}
```

Import at `:3`. The comment block above it is `:54-82`.

**Status: 404, chosen to match `/join/[token]`.** That route calls `notFound()`
when the flag is off, which is an HTTP 404, and this answers identically on
purpose — the two are one surface and it either exists or it does not.

- **Not 503.** A 503 says "temporarily unavailable, retry", which invites
  exactly the retry loop this is meant to prevent.
- **Not 403.** That would say the caller lacks permission, when in fact nobody
  has it.

**It sits before the auth check, deliberately.** A caller learns nothing here
that `/join` does not already tell anyone who visits it, and answering
identically whether or not there is a session is what makes the endpoint
indistinguishable from a path that was never built.

## 2. Accept, decline and revoke left ungated

Unchanged, and `revoke` is now named explicitly in
`lib/feature-flags.ts`'s "what this does not gate" section with the
partial-unique-index reasoning above.

## 3. Does the team client actually hide the form, or only take the prop?

**It hides it.** Verified by reading, in
`app/agency/settings/team/team-roster-client.tsx`:

| Line | What it does |
|---|---|
| **`:368`** | `const mayInvite = invitationsEnabled && (callerRole === "owner" \|\| callerRole === "admin")` — the flag and the permission are ANDed, and they answer different questions |
| **`:459`** | `{mayInvite && !inviteOpen && (` — gates the **"Invite colleague" button** |
| **`:476`** | `{mayInvite && inviteOpen && (` — gates the **invite form itself**, independently |
| `:618` | `{invitationsEnabled && pending.length > 0 && (` — the pending list |
| `:679` | `{invitationsEnabled && resolved.length > 0 && (` — the past list |
| `:654` | `{mayInvite && (` — the per-row Revoke button |

`:476` is the answer to the question. The form's guard is **independent of the
button having rendered**, not derived from it: `inviteOpen` starts `false`
(`:161`) and the only thing that sets it true is the button at `:460`, which is
itself behind `mayInvite`. So with `invitationsEnabled === false` there is no
path to the form — and even if `inviteOpen` were somehow true, `:476` would
still refuse to render it.

## 4. Gates, re-run

**EXECUTED**, once each. All match the Phase 0 baseline.

| Gate | Baseline | Now |
|---|---|---|
| `npx tsc --noEmit` | 0 | **0** |
| `pnpm build` | 0 | **0** |
| `pnpm lint` | 1, 182 problems (154 errors, 28 warnings) | **1, 182 problems (154/28)** — identical |
| `pnpm identity-columns:guard` | 0, 372 files, TOTAL 0 | **0, 380 files, TOTAL 0** |
| `pnpm embed-targets` | 0, 372 files, REPOINTED 0 / PERSON 0 | **0, 380 files, REPOINTED 0 / PERSON 0** |
| `pnpm org-id-reads:guard` | 0, 371 files, OPEN 14/61 | **0, 379 files, OPEN 14/61, IMPROVED 0/0, REGRESSIONS 0/0** |

File counts are **unchanged from the previous run** — these edits added no
files. The +8 against the Phase 0 baseline is still the six new source files
plus the two from the feature-flag split.

`verify-rls` (exit 2) and `policy-audit:guard` (exit 1) were not re-run this
time; both are environmental, neither reads a `.ts` file, and nothing in this
change could move them.

## One thing corrected while in the file

`app/api/org/invitations/route.ts`'s header opened with *"Before 089 is
applied…"*. **089 is applied and verified**, so that read as a current
statement about a state that has passed. Reworded to say 089 is applied, with
the 42501 → 403 branch kept and its reason restated: a policy can be rolled
back, and a loud refusal is the intended failure either way. The same
correction was made to this report's opening and to SEQUENCING step 1.
