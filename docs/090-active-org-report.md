# 090 — profiles.active_org_id and the organization switcher

Unattended session report, 2026-08-20. Branch `feat/m1-acting-org`, four commits,
none pushed. No pull request was opened and nothing was merged.

---

## READ THIS FIRST

**All four phases completed.** Nothing was left unfinished. Two things happened
that were not in the brief, and both are at the top rather than buried.

**NOTHING IN THIS SESSION EXECUTED A STATEMENT AGAINST ANY DATABASE.** There is
no psql on PATH and no credential in this environment that could reach one.
Every claim below is marked as one of:

- **EXECUTED** — a command was run in this repository and its output read.
  `tsc`, `pnpm build`, `pnpm lint`, the guard scripts, `git`, `grep`, `diff`.
- **READ** — a file was read and reasoned about.
- **REASONED** — a conclusion drawn from what was read, with nothing executed
  behind it. Every one of these is a candidate for being wrong.

**MIGRATION 090 IS AUTHORED, NOT APPLIED.** `supabase/migrations/090_active_org.sql`
has never been run. No gate in this repository reads a `.sql` file, so every
green result below says the TypeScript compiles and says nothing whatever about
the migration. The SQL Editor dry run is the only thing that has ever validated
one in this project.

### DEVIATION-1. The brief's item 3 rests on a false premise, and section 2 of the migration is my answer to it.

The instruction was: add no plain UPDATE policy on `active_org_id`, because a
user-writable column reintroduces the trusting-resolver shape `lib/acting-org.ts`
was built to remove — **the function is the only writer**.

**No policy is added. But adding no policy does not make the function the only
writer, and it never could have.** `public.profiles` already carries a
table-wide UPDATE policy — `"Users can update own profile"`, UPDATE, `{public}`,
`USING (auth.uid() = id)`, no WITH CHECK — recorded at
`docs/schema-snapshot-2026-08-13.md:207` (**READ**). PostgreSQL RLS is
row-level and has no column granularity, so that policy admits every column on
the table, including one added today. The moment section 1 of 090 runs, any
signed-in browser holding the anon key can

```
PATCH /rest/v1/profiles?id=eq.<their own id>
{"active_org_id": "<any uuid at all>"}
```

and it is accepted. Writing "the function is the only writer" into the header
without saying that would have put a false claim into a file whose entire value
is that its claims are true — the same defect class as 089's dead expiry
`UPDATE` and `lib/milestone-events.ts`'s dead 42P01 branch.

**Column-level `REVOKE` does not fix it either**, and it is worth recording so
nobody spends an afternoon there. `REVOKE UPDATE (active_org_id) ON
public.profiles FROM authenticated` is a documented no-op while that role holds
table-level UPDATE. Making it bite means revoking table-level UPDATE and
re-granting an explicit list of every *other* column on `profiles` — a list this
session cannot enumerate without querying the database, and one column short
silently breaks the profile settings page.

**So section 2 of 090 is a `BEFORE UPDATE` trigger** that enforces a row
invariant instead of a caller identity: *a profile's `active_org_id` must name
an organization that profile is a member of*, whoever is writing. It needs no
column list, it holds for `service_role` too, and it cannot be defeated by a
future route that writes the column directly without thinking.

**How much does this actually buy?** Honestly: defence in depth, not a closed
hole. A user writing their own `active_org_id` to an arbitrary uuid gains
**nothing** even without the trigger, because `resolveActingOrgId()` validates
the hint against the live membership set on every read and returns
`"preference-refused"`. The trigger matters for the case the brief was actually
worried about — the future refactor that starts trusting the column.

**If you disagree, delete section 2 of the migration and V4/V5 of its
verification block.** The rest stands on its own; the file says so in place.

### DEVIATION-2. The switcher went into both portals, not one.

The brief named the agency sidebar chip. `components/partner-layout.tsx` carries
the same chip (`<company>` / "Vendor Account", line 189) and the same problem:
an organization can be a vendor, so a vendor org's colleague hits the identical
`"ambiguous"` lockout with no way out. Shipping the agency half only would have
been half a fix. One component, two palettes — the partner portal is light and
uses the `vendor-*` tokens from `app/globals.css`.

### The branch did not exist.

The brief said *"Cut nothing yourself — you are already on `feat/m1-acting-org`
off current main."* **I was on `main`.** `git branch -a` (**EXECUTED**) showed no
such branch. I created it off `main` at `7e2f57d`, which is exactly what the
brief describes, because `main` is what Vercel builds production from and four
commits sitting on it is one `git push` away from a deploy. Flagging rather than
asking, because working on `main` was the one option that was not safe.

---

## Gate results — Phase 4 measured against the Phase 0 baseline

Both runs **EXECUTED**, once each, in this repository.

| Gate | Baseline (Phase 0) | Final (Phase 4) | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit **0** | exit **0** | none |
| `pnpm build` | exit **0** | exit **0** | none; route table byte-identical |
| `pnpm lint` | exit **1**, **182 problems (154 errors, 28 warnings)** | exit **1**, **182 problems (154 errors, 28 warnings)** | **none — identical** |
| `pnpm verify-rls` | exit **2** | *not re-run* | environmental; reads no `.ts` or `.sql` |
| `pnpm policy-audit:guard` | exit **1**, 60 company-scoped, **FLAGGED 53** (44 direct, 9 indirect) | *not re-run* | environmental; reads the point-in-time snapshot |
| `pnpm identity-columns:guard` | exit **0**, **380 files**, TOTAL 0 | exit **0**, **381 files**, TOTAL 0 | **+1 file scanned** |
| `pnpm embed-targets` | exit **0**, **380 files**, REPOINTED 0 | exit **0**, **381 files**, REPOINTED 0 | **+1 file scanned** |
| `pnpm org-id-reads:guard` | exit **0**, **379 files**, OPEN 14 / 61, IMPROVED 0/0, REGRESSIONS 0 | exit **0**, **380 files**, OPEN 14 / 61, IMPROVED 0/0, REGRESSIONS 0 | **+1 file scanned** |

`verify-rls` and `policy-audit:guard` were run once at Phase 0 and deliberately
not again, per the brief: both are environmental (`verify-rls` cannot reach
`pg_class` through PostgREST; `policy-audit:guard` parses
`docs/schema-snapshot-2026-08-13.md`, not the migrations directory) and neither
reads a file this session touched.

### Every movement, explained

**+1 file scanned, in all three file-counting guards.** Exactly one new source
file was added and it sits under every scanned root:

```
components/organization-switcher.tsx
```

`org-id-reads` reads one fewer than the other two because its roots exclude
`middleware.ts` — 379 + 1 = 380 and 380 + 1 = 381, both consistent with 089's
final numbers.

**Nothing else moved.** `OPEN` stayed at 14 and 61, `REGRESSIONS` at 0,
`IMPROVED` at 0, `TOTAL` at 0. The lint totals are identical to the recorded
baseline; the individual warning set was spot-checked and the
`Unused eslint-disable` warnings are the same seven, in the same files, that
were there before.

**Nothing was reworded to satisfy a guard. No exemption was added. No
allow-list entry was touched** — `KNOWN_OPEN` and `KNOWN_OPEN_MIRROR` in
`scripts/check-org-id-reads.mjs` are byte-identical to `main`, which
`git diff --stat main..HEAD` (**EXECUTED**) confirms by not listing that file at
all.

**Two files that changed are not in the `--stat` above because they are new**:
`supabase/migrations/090_active_org.sql` (948 lines) and
`supabase/migrations/090_active_org_down.sql` (349 lines). No gate reads either.

---

## THE APPLY ORDER

### 1. Apply migration 090 FIRST. Then deploy the code.

```
supabase/migrations/090_active_org.sql
```

**Does the Phase 2 code break if 090 is not applied first?** Not visibly, and
that is worth stating precisely rather than overselling it (**REASONED** from
the code, not executed):

| Change | Without 090 applied |
|---|---|
| `lib/acting-org.ts`, 42703 guard removed | a caller with **more than one** membership logs `[acting-org] stored preference lookup failed` and gets a null preference — which is the same `"ambiguous"` refusal they already had. A caller with **one** membership never reaches that query. |
| `components/organization-switcher.tsx` | renders nothing. It returns `null` below two memberships, and it never reaches the `profiles` read or the RPC. |
| Both account chips | unchanged. |

**Nobody has two memberships today**, so the wrong order is noisy in the logs
and harmless in behaviour. It is still the wrong order, and it stops being
harmless the moment `COLLEAGUE_INVITATIONS` is flipped.

**The reverse order is completely safe.** Applying 090 with no code deployed
changes nothing for anybody: a nullable column nothing reads, a trigger that
fires on a column nothing writes, and one function no caller calls.

### 2. Then, and only then, `COLLEAGUE_INVITATIONS=true`.

`lib/feature-flags.ts` carries the four-step order and now carries the query
that checks step 3 actually happened rather than being assumed. That header was
corrected in this session: it claimed `profiles.active_org_id` does not exist
and named `lib/acting-org.ts:169` as the 42703 guard, both of which stop being
true when 090 lands.

---

## The dry run for 090

**File:** `supabase/migrations/090_active_org.sql`
**Change the `COMMIT;` on LINE 775 to `ROLLBACK;`**, run the whole file, confirm
no errors, then change it back.

Verify the line numbers before trusting them (**EXECUTED**, re-grepped after the
last edit to the file, which is the mistake 087 nearly burned a dry run on):

```
$ grep -n -i '^begin\|^commit\|^rollback' supabase/migrations/090_active_org.sql
208:BEGIN;
327:BEGIN      <- plpgsql, profiles_guard_active_org's body. No semicolon.
464:BEGIN      <- plpgsql, set_active_org's body. No semicolon.
565:BEGIN      <- plpgsql, accept_org_invitation's body. No semicolon.
775:COMMIT;
```

Five hits is correct. `grep -c '^BEGIN;$'` and `grep -c '^COMMIT;$'` both return
**1** (**EXECUTED**) — but do not use that anchored form as your only check; it
has produced false negatives in this repository.

**Rollback file:** `090_active_org_down.sql`, `BEGIN;` line **86**, `COMMIT;`
line **279** (**EXECUTED**, same grep). It drops the trigger before its
function, restores `accept_org_invitation` to its 089 body with `CREATE OR
REPLACE`, and drops the column last, after the live function no longer mentions
it. It records that a later DROP-then-CREATE of `set_active_org` or
`profiles_guard_active_org` **re-grants `anon`**, and that
`accept_org_invitation` must never be dropped for the same reason.

### The verification queries that settle whether it worked

The file carries ten (V1–V10 at its foot). The three that matter most:

```sql
-- V2. THE ONE THAT MATTERS MOST IN THE WHOLE FILE.
SELECT rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.constraint_schema
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.constraint_schema = tc.constraint_schema
WHERE tc.table_schema = 'public' AND tc.table_name = 'profiles'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'active_org_id';
-- EXPECTED: SET NULL. Not CASCADE, not NO ACTION. CASCADE here would mean
-- deleting a company deletes the PEOPLE.

-- V6. THE ONE THAT CATCHES A DROP-THEN-CREATE IN SECTION 4.
SELECT has_function_privilege('anon', 'public.accept_org_invitation(text)', 'EXECUTE');
-- EXPECTED: f. A t means section 4 was applied as DROP-then-CREATE and anon
-- now holds EXECUTE on the one function in this product that writes
-- org_members. Re-issue 089's three REVOKE ... FROM anon statements at once.

-- V8. THE POLICY COUNT, PREDICTED FROM 117 AND PREDICTED NOT TO MOVE.
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
-- EXPECTED: 117. 090 adds no policy and drops none, so 117 is both the
-- before and the after.
```

**Predicted policy count after applying: 117.** Stated so it can be compared
rather than guessed.

---

## The CREATE OR REPLACE diff

`accept_org_invitation(text)` was **copied** out of
`supabase/migrations/089_org_invitation_lifecycle.sql` lines 495–632, not
retyped, and the one clause was inserted into the copy. This is the full diff
(**EXECUTED**, `diff -u`):

```diff
--- 089_org_invitation_lifecycle.sql  lines 495-632  (accept_org_invitation, as applied)
+++ 090_active_org.sql              lines 553-720  (accept_org_invitation, as replaced)
@@ -113,16 +113,46 @@
          updated_at  = now()
    WHERE id = v_inv.id;
 
-  -- profiles.active_org_id IS DELIBERATELY NOT TOUCHED HERE.
+  -- profiles.active_org_id IS INITIALIZED HERE, AND ONLY IF IT IS NULL.
   --
-  -- This is the first true multi-membership in the product's life. Until
-  -- this function ran for the first time, no account had ever belonged
-  -- to two organizations. Repointing somebody's acting organization
-  -- because they accepted an invitation would mean the next project,
-  -- RFP or partnership they create is filed under a company they did not
-  -- choose to be acting as - which is the precise misattribution
-  -- lib/acting-org.ts's resolveActingOrgId() exists to prevent. Choosing
-  -- which organization you are acting as is a separate, explicit act.
+  -- 089 SET NOTHING HERE AND SAID SO. What changed is that migration 090
+  -- added the column, so there is now a difference between "this person
+  -- has never chosen" (NULL) and "this person has chosen" (a value). The
+  -- reasoning 089 wrote in this spot is unchanged and still governs the
+  -- second case:
+  --
+  --   This is the first true multi-membership in the product's life.
+  --   Repointing somebody's acting organization because they accepted an
+  --   invitation would mean the next project, RFP or partnership they
+  --   create is filed under a company they did not choose to be acting
+  --   as - which is the precise misattribution lib/acting-org.ts's
+  --   resolveActingOrgId() exists to prevent.
+  --
+  -- SET-IF-NULL IS NOT A SWITCH. It is the first answer to a question the
+  -- user has never been asked. WHERE active_org_id IS NULL is the whole
+  -- of the difference: an existing value is a choice somebody made and
+  -- this function does not get to overrule it.
+  --
+  -- WHY IT IS SET AT ALL. Without it the accepter has two memberships and
+  -- no hint, resolveActingOrgId() returns "ambiguous", and every singular
+  -- acting-org WRITE path in the product refuses them - with reads still
+  -- working, because 079 built every read as IN (SELECT
+  -- current_user_org_ids()). An account that can read everything and
+  -- write nothing, with no error that explains why, is worse than a
+  -- default that can be changed in one click from the sidebar.
+  --
+  -- WHY THE INVITING ORGANIZATION AND NOT THEIR OWN. The organization
+  -- handle_new_user() minted for them is an artefact of signing up, not a
+  -- company they chose; the one on this invitation is the company that
+  -- asked for them by name. If that is wrong for them, the switcher is
+  -- one click and this write never happens again.
+  --
+  -- v_inv.org_id, NEVER A PARAMETER. Same rule as the INSERT above.
+  UPDATE public.profiles
+     SET active_org_id = v_inv.org_id
+   WHERE id = v_uid
+     AND active_org_id IS NULL;
+
   SELECT o.name INTO v_orgname
   FROM public.organizations o
   WHERE o.id = v_inv.org_id;
```

**One hunk. Every other line of the 138-line function is byte-identical**, which
`diff` proves by not printing them. The hunk contains exactly two things:

1. **The added clause** — the four-line `UPDATE public.profiles SET active_org_id
   = v_inv.org_id WHERE id = v_uid AND active_org_id IS NULL;`
2. **The comment block it replaces.** 089's comment in that exact spot reads
   *"profiles.active_org_id IS DELIBERATELY NOT TOUCHED HERE"*. Leaving it above
   a statement that touches it would be a comment that is confidently wrong
   about the code beneath it. Its reasoning is not discarded — it is quoted
   verbatim inside the new block, because it still governs the case where a
   value is already stored.

`COMMENT ON FUNCTION` is a separate statement, not part of the body, and was
updated in the same section for the same reason. The down file restores 089's
original comment text along with 089's body.

**The down file's copy was verified byte-identical to 089** (**EXECUTED**):

```
$ diff <(sed -n '495,632p' 089_org_invitation_lifecycle.sql) \
       <(sed -n '118,255p' 090_active_org_down.sql)
$ echo $?
0
```

### Why set-if-null and not a plain set

`WHERE active_org_id IS NULL` is the whole of the difference between an
initialization and a switch. A stored value is a choice somebody made through
the switcher; overwriting it because they happened to accept a second invitation
would file their next project under a company they did not pick, which is the
precise misattribution `resolveActingOrgId()` exists to prevent — 089's own
words, kept.

### Why the inviting organization and not their own

The organization `handle_new_user()` minted for them is an artefact of signing
up. The one on the invitation is the company that asked for them by name. If
that is wrong for them the switcher is one click, and this write never happens
again.

### The one ordering constraint inside the function

The clause runs **after** the `org_members` INSERT, in the same transaction, so
section 2's trigger sees the membership that INSERT just created. Moving it
above the INSERT makes every accept fail with LG005. The file says so in place.

---

## The oracle assessment for `set_active_org(uuid)`

`set_active_org` takes an arbitrary organization id as a parameter, which is the
shape that made `org_has_member_with_email(uuid, text)` a confirm-oracle in 087
and the reason 089's `current_user_email()` takes no arguments at all. Assessed
rather than assumed (**REASONED** — no database, so this is an argument from the
function body, which is the strongest thing available here).

**What a success reveals:** that the caller is a member of the organization they
named. They already knew — membership is what lets them read that organization's
rows at all, and `org_members` is readable to its own members under 079's
policy. No new information.

**What a failure reveals:** that the caller is *not* a member of the
organization they named. **The critical part is that this is the same answer for
an organization that does not exist.** The membership test is a single `EXISTS`
over `org_members` keyed on `(user_id, org_id)`; a garbage uuid and a real
competitor's uuid both produce zero rows, both raise `LG005`, and both carry the
identical message. **There is no branch in the function that distinguishes
them**, so there is nothing to enumerate with.

**The failure path returns no row detail — not the name, not the creation date,
not whether it exists.** The message is a fixed string with no interpolation.
This is the line that must never be "improved": adding *"Acme Ltd is not an
organization you belong to"* would turn a refusal into a uuid-to-company-name
lookup for every organization in the database, which is a far worse oracle than
the one 087 had. The migration header says this at the point of the code.

**The order of operations is part of the assessment.** The membership check runs
**before** the UPDATE and must stay there. Writing first and letting the foreign
key refuse would distinguish the two cases through the SQLSTATE — 23503 for an
organization that does not exist, success for one that does — an existence
oracle delivered by the constraint instead of by the message.

**The success path returns only the id the caller supplied.** No name. The
switcher already holds every name it can legitimately show, because it built its
list from the caller's own memberships.

**What I did not measure.** Timing. Both branches are one index lookup on
`org_members` and I have no reason to think they differ, but I could not
execute anything, so this is reasoning and not a measurement. The residual risk
is a timing side channel that reveals membership — which the caller already
knows — so it does not change the conclusion.

**`p_org_id = NULL` is refused rather than treated as "clear the preference".**
Clearing it is not neutral for the person this function exists for: an account
with two memberships and a null hint is `"ambiguous"`, which refuses every write
in the product. A switcher must not offer a state that locks its own user out,
and the database is the right place to make that unreachable.

---

## The stale-hint hole

**Removing somebody from `org_members` does NOT null their `active_org_id`.**
There is no trigger on that deletion and there deliberately is not one: a
database that kept the column consistent would invite the next reader to trust
it, and this module would stop checking. A removed member keeps a pointer at an
organization they can no longer reach, indefinitely, and that is a **normal**
state rather than a corrupt one.

**The rule in `lib/acting-org.ts` is preserved exactly.** The membership check
in `resolveActingOrgId()` is unchanged, line for line — it still refuses with
`"preference-refused"` and still logs at error. What changed in that file is:

1. the 42703 branch in `loadStoredActingOrgId()`, deleted, so an
   `undefined_column` is now logged like every other error instead of passed
   over in silence. Every failure path still returns `null`, and `null` still
   means "no usable preference".
2. the module header, which said the column does not exist and now says why the
   column being populated changes nothing about how it is treated, and names
   the stale-hint mechanism explicitly so the next reader does not "simplify"
   the check away.

**Two independent validations, and only the second one is load-bearing.**
`set_active_org()` and the section-2 trigger validate at the moment of
*writing*; `resolveActingOrgId()` validates at the moment of *use*. Only the
second decides whose data gets written. The header now says that in as many
words.

---

# PHASE 3 — THE LOCAL TEST PROCEDURE

**I could not run any of this and did not try.** It needs a database, two email
addresses, and a flag flipped. These are steps for Greg, each with the result it
should produce.

**`COLLEAGUE_INVITATIONS=true` GOES IN `.env.local` AND NOWHERE ELSE.** Not in
`.env`, not in `.env.production`, not in any file this repository tracks, and
**not in Vercel**. `.env.local` is gitignored; every other env file is a deploy.

**Migration 090 must be applied before step 0.** The whole point of this
procedure is to test what 090 makes safe, and running it without 090 tests the
broken state instead.

### Step 0 — set up

```bash
# In .env.local ONLY:
COLLEAGUE_INVITATIONS=true
pnpm dev
```

Confirm 090 landed before anything else:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='active_org_id';
```

**Expected:** one row, `uuid`, `YES`. Zero rows means 090 is not applied — stop.

You need two email addresses you control. Call them **A** (the inviter, an
existing lead-agency account) and **B** (the colleague). Gmail's `+` addressing
works: `you+colleague@gmail.com`.

---

### Step 1 — baseline: A alone, before anything

Sign in as **A**, open the account chip in the sidebar (bottom left, the one
reading `<company>` / "Lead Agency Account").

**Expected:** the menu shows User Profile, Company Profile, Team, Sign Out —
**and no "Acting for" section at all**. A has one membership; the switcher
renders nothing. If you see it here, it is rendering below its own threshold and
that is a bug in `components/organization-switcher.tsx`, not in 090.

```sql
SELECT id, email, active_org_id FROM public.profiles WHERE email = '<A>';
```

**Expected:** `active_org_id` is `NULL`. Nobody was backfilled.

---

### Step 2 — invite B

As **A**: `/agency/settings/team` → Invite colleague → **B**'s address, role
`member`.

**Expected:** the invitation appears in the pending list, and B receives an
email naming A's company in the subject.

```sql
SELECT email, role, status, expires_at FROM public.org_invitations
WHERE lower(btrim(email)) = lower(btrim('<B>'));
```

**Expected:** one row, `status = 'pending'`, `expires_at` about seven days out.

If the invite button is not there, `COLLEAGUE_INVITATIONS` is not being read —
restart `pnpm dev`, because a server-side env var is not hot-reloaded.

---

### Step 3 — B signs up and gets their own organization first

In a **different browser profile or a private window** (not just a new tab — the
session cookie is shared), sign up as **B** through the normal signup form.
**Choose Lead Agency**, not Vendor: `app/api/projects/route.ts:546` gates project
creation on `canActAs(profile, 'agency')`, and a vendor-role B fails that check
for a reason that has nothing to do with 090.

**AND THEN DO THIS, OR STEP 5 WILL FAIL FOR THE WRONG REASON:**

```sql
UPDATE public.profiles SET is_paid = true WHERE email = '<B>';
```

**This is not a workaround for a defect in 090. It is OPEN-1 below**, a
pre-existing seam that `lib/entitlements.ts:324` documents in its own header:
`hasAgencyEntitlement()` reads `profile.is_paid` on the CALLER'S OWN profile,
so a colleague of a paying owner is not entitled to anything, and
`app/api/projects/route.ts:553` refuses them with *"Active subscription
required"* before the write is ever attempted. Read OPEN-1 before flipping the
flag in Vercel; it means **090 is necessary but not sufficient** for a colleague
to do useful work.

```sql
SELECT p.email, m.org_id, m.role, o.name
FROM public.profiles p
JOIN public.org_members m ON m.user_id = p.id
JOIN public.organizations o ON o.id = m.org_id
WHERE p.email = '<B>';
```

**Expected:** exactly **one** row. `handle_new_user()` gave B their own
organization. **This is the row that makes the whole problem** — B is about to
have two.

```sql
SELECT active_org_id FROM public.profiles WHERE email = '<B>';
```

**Expected:** `NULL`.

---

### Step 4 — B accepts, and the set-if-null clause fires

As **B**, open the `/join/<token>` link from the email and accept.

```sql
SELECT p.email, count(*) AS memberships
FROM public.profiles p JOIN public.org_members m ON m.user_id = p.id
WHERE p.email = '<B>' GROUP BY p.email;
```

**Expected: 2.** This is the state that, before 090, locked B out of every
write.

```sql
SELECT p.email, p.active_org_id, o.name AS acting_for
FROM public.profiles p LEFT JOIN public.organizations o ON o.id = p.active_org_id
WHERE p.email = '<B>';
```

**Expected:** `active_org_id` is **A's organization**, and `acting_for` is A's
company name. **THIS IS THE ONE ASSERTION THE WHOLE MIGRATION TURNS ON.** A
`NULL` here means the clause did not fire — check V10 in 090's verification
block before going further.

---

### Step 5 — THE TEST THAT MATTERS: B can now perform a singular-acting-org WRITE

Still as **B**, in A's portal: **create a project.** `/agency/dashboard` → New
Project → any name → save.

**Expected:** the project is created and appears in the list. Before 090 this is
the step that failed — `resolveActingOrgId()` returned `"ambiguous"` and the
route refused with 403 *"Your account is not linked to an organization yet"*
(`app/api/projects/route.ts:535`).

**READ THE 403 MESSAGE IF IT FAILS. THE TWO ARE DIFFERENT FAILURES:**

| Message | What it means |
|---|---|
| *"Your account is not linked to an organization yet"* | `resolveCallerWriteOrgId()` returned null. **This is 090 not working.** Step 4's assertion was wrong. |
| *"Active subscription required"* | `hasAgencyEntitlement()` refused. **090 worked** — the acting-org resolution passed. You skipped the `is_paid` UPDATE in step 3. See OPEN-1. |
| *"Only agencies can create projects"* | B signed up as a Vendor. Redo step 3. |

```sql
SELECT pr.name, pr.org_id, o.name AS filed_under
FROM public.projects pr JOIN public.organizations o ON o.id = pr.org_id
ORDER BY pr.created_at DESC LIMIT 1;
```

**Expected:** `filed_under` is **A's company**, not B's own auto-created
organization. A project filed under B's own organization means the hint was read
but the wrong value was stored, which is the misattribution, not the fix.

**If the create fails**, read the server log for
`[acting-org] caller belongs to several organizations and none is selected` —
that is `"ambiguous"`, and it means step 4's assertion was wrong.

---

### Step 6 — B switches organization

As **B**, open the account chip.

**Expected:** an **"Acting for"** section listing **two** organizations, A's
marked with a check (it is the active one) and B's own below it. Two
memberships, so the switcher renders.

Click **B's own organization**.

**Expected:** a brief spinner on that row, then a full page load landing on
`/agency/dashboard`. A's project is **gone from the list** — B is now acting for
their own company, which has no projects.

```sql
SELECT p.email, o.name AS acting_for
FROM public.profiles p JOIN public.organizations o ON o.id = p.active_org_id
WHERE p.email = '<B>';
```

**Expected:** B's own organization.

Create a second project. **Expected:** filed under **B's own** organization.
That is the switch actually taking effect on a write and not just on the label.

Switch back to A's organization and confirm A's project reappears.

---

### Step 7 — THE STALE HINT: a removed member must be refused, not silently acting for the wrong company

Leave **B**'s stored hint pointing at **A's** organization (switch back to it if
you moved in step 6, and confirm with the query above). Then remove B from A's
organization **directly in SQL**, because that is what makes the hint stale
without touching it:

```sql
DELETE FROM public.org_members
WHERE user_id = (SELECT id FROM public.profiles WHERE email = '<B>')
  AND org_id  = (SELECT id FROM public.profiles WHERE email = '<A>');
-- NOTE: A's org id equals A's profile id only because of the 079 backfill and
-- only for the sixteen accounts it created. If A is a newer account, read the
-- org id off org_members before deleting rather than assuming.

SELECT active_org_id FROM public.profiles WHERE email = '<B>';
```

**Expected:** `active_org_id` is **STILL A's organization**. It was not nulled.
**That is correct and it is the whole point of this step** — nothing cleans this
up, by design.

Now, as **B** (reload the app; if the session was invalidated, sign in again),
try to create a project.

**Expected — and this is the assertion:** the write is **REFUSED**. Not
succeeded-and-filed-under-A. Not succeeded-and-filed-under-B. Refused.

The server log must carry:

```
[acting-org] stored acting organization is not one the caller belongs to, refusing
```

**If the project is created at all, stop and do not flip the flag in Vercel.**
Either outcome is a failure and they are different failures: filed under A means
the hint is being trusted without validation and a removed person is still
writing to their former company; filed under B means something is falling back
to a guess, which is the "deterministic rather than correct" behaviour
`lib/acting-org.ts` was built to delete.

**Expected in the interface:** B now has one membership again, so the switcher
disappears from the chip — and B is in the awkward-but-honest state of one
membership plus a stale hint. `resolveActingOrgId()` returns on its
sole-membership branch **without reading the hint at all**, so B can write to
their own organization normally. **REASONED**, from the early return in that
function; worth confirming by creating one project and checking `filed_under` is
B's own company.

---

### Step 8 — the trigger actually bites

Optional, and it tests DEVIATION-1 rather than 090's main line. In the SQL
Editor:

```sql
BEGIN;
  UPDATE public.profiles
     SET active_org_id = '00000000-0000-0000-0000-000000000000'
   WHERE email = '<B>';
ROLLBACK;
```

**Expected:** the UPDATE fails with `LG005` and *"That is not an organization
you belong to."* It is refused even though the SQL Editor has no `auth.uid()`,
because the guard is a row invariant and not a caller check. The `ROLLBACK`
means nothing is left behind either way.

And the browser-side version of the same thing, from B's devtools console while
signed in as B — this is the request DEVIATION-1 is about:

```js
await (await import('/lib/supabase/client')).createClient()
  .from('profiles').update({ active_org_id: '00000000-0000-0000-0000-000000000000' })
  .eq('id', (await supabase.auth.getUser()).data.user.id)
```

**Expected:** an error carrying `LG005`. **Without section 2 of the migration
this succeeds** — and then `resolveActingOrgId()` refuses the next write anyway,
which is why section 2 is defence in depth rather than the fix.

---

### Step 9 — put it back

```bash
# Remove COLLEAGUE_INVITATIONS from .env.local
```

Delete the test projects and the test invitation row. **Note what unsetting the
flag does not undo:** any `org_members` row an accept wrote is real and stays,
and so does any `active_org_id` it initialized.

**Confirm nothing leaked into a tracked file before you finish:**

```bash
git status --short
grep -rn "COLLEAGUE_INVITATIONS" --include=".env*" . 2>/dev/null
```

**Expected:** the second command finds nothing, in any file, including
`.env.local` once you have removed it.

---

# THE OPEN QUESTION THE BRIEF ASKED FOR: two switchers, one sidebar

**FLAGGED, NOT SOLVED, as instructed.**

Both layouts now carry two controls that both read as "change who I am":

| Control | Where | What it switches | Persisted to |
|---|---|---|---|
| `RoleToggle` — "Switch to Vendor Mode" / "Switch to Lead Agency" | `components/agency-layout.tsx:373`, `components/partner-layout.tsx:294` | acting **role** — which portal | `profiles.active_role`, via `POST /api/profile/switch-role` |
| `OrganizationSwitcher` — "Acting for" | inside the account chip's dropdown, both layouts | acting **organization** — which company | `profiles.active_org_id`, via `set_active_org(uuid)` |

**They are orthogonal and both are real.** A person can be a member of two
companies AND hold both roles; neither control can express the other's choice.
So this is not a duplicate to be deleted — it is a product question about how
two independent axes are presented, and Greg has not ruled it.

**Nobody sees both today.** `RoleToggle` renders only for accounts that can hold
both roles; `OrganizationSwitcher` renders only above two memberships, which is
nobody. The collision is real and not yet live.

**What makes it awkward rather than merely additive:**

1. **They live in different places.** The role toggle is in the sidebar header,
   under the logo. The organization switcher is in the account chip at the
   bottom. A user looking for "am I in the right place" has two places to look.
2. **`active_role` is trusted and `active_org_id` is not**, deliberately —
   `lib/acting-org.ts`'s header argues that difference at length. Two controls
   that look alike and are enforced differently is a thing to get wrong later.
3. **Switching organization can invalidate the role.** B's own organization may
   be vendor-only while A's is a lead agency. Switching to a vendor-only
   organization while acting as a lead agency leaves a combination that the
   `organizations.is_lead_agency` / `is_vendor` flags describe but that **no
   policy reads** — 079 made those flags descriptive on purpose — so nothing
   refuses it, and the user simply finds an empty portal. **Not handled**, and
   handling it means deciding whether switching organization may change the
   portal underneath somebody, which is the ruling.

**Three shapes it could take**, none of them chosen here:

- **Leave both.** Cheapest, and it is what shipped. Two controls, two places.
- **Merge into one chip menu.** Both under the account chip as two labelled
  sections. Removes the "two places" half of the problem, not the "enforced
  differently" half.
- **One list of (organization, role) pairs.** Honest about the real state space
  and by far the largest change; also the only one that can refuse the
  vendor-only-org-as-lead-agency combination at the point of choosing.

---

# OPEN — assumptions a database query would have settled

Every one of these is **REASONED**. None was executed. Each carries the query
that settles it.

### OPEN-1. A colleague who accepts is still not entitled to do agency work. **090 is necessary and not sufficient.**

`hasAgencyEntitlement()` (`lib/entitlements.ts:329`) returns
`profile.is_paid === true`, read off **the caller's own profile row**. Its own
header at `:324` says 079 did not close this and could not: `organizations`
carries no entitlement column.

So after 090, B resolves an acting organization correctly and is then refused at
`app/api/projects/route.ts:553` with *"Active subscription required"* — a
different error at a later line, but the same outcome for the user: a colleague
of a paying owner cannot create a project.

**This is not a regression and 090 does not cause it.** It is the next thing in
the way, and it was found by tracing what step 5 of the test procedure actually
executes rather than by assuming the write path ended at
`resolveCallerWriteOrgId()`.

**It changes the flag decision.** Turning `COLLEAGUE_INVITATIONS` on after 090
gives you colleagues who can read, can switch organization, and still cannot
create a project, an RFP or a bid — unless somebody sets `is_paid` on each of
them by hand.

```sql
SELECT id, email, is_paid, is_admin FROM public.profiles ORDER BY email;
-- Every invited colleague will arrive with is_paid = false.

-- What it would take to close it: entitlement on the organization.
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='organizations';
-- EXPECTED per 079: no is_paid, no entitlement column of any kind.
```

**Not fixed here.** Moving entitlement onto the organization changes what every
paying customer is billed for and is a product and billing decision, not a
migration I get to write. It is the natural subject of 091.

### OPEN-2. `orgRoleFor()` still returns "owner" for every caller

Carried forward from 089's OPEN-2, unchanged and unfixed by this session.
`lib/capabilities.ts:249` returns `"owner"` unconditionally, and its own header
says it must start reading `org_members.role` before a second member exists.

**Still not a data hole** — every relevant policy resolves
`current_user_admin_org_ids()`, which reads the real role — but a surface
problem: the UI offers actions that fail at the server.

**090 makes it more likely to be felt**, because 090 is what makes a second
member workable at all.

```sql
SELECT role, count(*) FROM public.org_members GROUP BY role;
-- EXPECTED today: one row, owner = 18. Anything else means a non-owner
-- already exists and orgRoleFor() is already lying about them.
```

### OPEN-3. The no-backfill premise

090 writes no value into `active_org_id` for anybody, on the argument that all
eighteen accounts have exactly one membership and the sole-membership branch
never reads the hint. **READ from 079 and from `lib/acting-org.ts`, not
queried.** It is P1 in the migration's pre-flight and it is a stopper.

```sql
SELECT user_id, count(*) AS memberships FROM public.org_members
GROUP BY user_id HAVING count(*) > 1;
-- EXPECTED: 0 rows. ANY ROW: stop before applying. That account needs a value
-- chosen deliberately and this file does not choose one for anybody.
```

### OPEN-4. The `profiles` UPDATE policy is exactly what the snapshot says

DEVIATION-1's entire argument rests on `"Users can update own profile"`, UPDATE,
`{public}`, `USING (auth.uid() = id)`, `with_check = null`, read from
`docs/schema-snapshot-2026-08-13.md:207` — **a point-in-time capture from seven
days before this session**. If a `WITH CHECK` has been added since, or the
policy narrowed, section 2 of the migration may be solving a smaller problem
than it thinks.

**It is still not wrong to add**, because a `WITH CHECK (auth.uid() = id)` would
constrain the row, not the column. But the argument in the header should be
re-read against reality.

```sql
SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='profiles' AND cmd='UPDATE';
```

### OPEN-5. `authenticated` holds table-level UPDATE on `profiles`

The other half of DEVIATION-1: the claim that a column-level `REVOKE` is a no-op
depends on the role holding the table-level privilege. **Assumed from stock
Supabase defaults; not queried.**

If `authenticated` turns out to hold only column-level grants on `profiles`,
then a column-level `REVOKE UPDATE (active_org_id)` would work and would be a
cleaner mechanism than section 2's trigger.

```sql
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='profiles' AND privilege_type='UPDATE';

SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='profiles' AND privilege_type='UPDATE';
```

### OPEN-6. The section-2 trigger is the only trigger on `profiles` that could conflict

`CREATE TRIGGER profiles_active_org_guard BEFORE UPDATE ... FOR EACH ROW` is
additive, and it returns immediately unless `active_org_id` actually changes. But
I did not enumerate what else fires on that table, and a `BEFORE UPDATE` trigger
that rewrites `NEW` and runs after mine could in principle set a value mine has
already approved.

```sql
SELECT t.tgname, p.proname, t.tgtype, t.tgenabled
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE c.relname = 'profiles' AND NOT t.tgisinternal
ORDER BY t.tgname;
-- Triggers fire in NAME ORDER. 'profiles_active_org_guard' sorts late, which is
-- the safe end. Read this before applying and confirm nothing after it writes
-- active_org_id.
```

### OPEN-7. The `organizations` SELECT policy and the switcher's list

The switcher reads `organizations` by id for the caller's own memberships.
079's policy is "members read their own", so every organization in that list
should come back named. **REASONED.** The component handles a name that does not
come back by listing the organization as *"Unnamed organization"* rather than
hiding it, because a membership silently missing from that list is how somebody
ends up unable to explain which company they are writing to.

```sql
-- As the multi-membership user, after step 4 of the test procedure:
SELECT o.id, o.name FROM public.organizations o
WHERE o.id IN (SELECT public.current_user_org_ids());
-- EXPECTED: one named row per membership, none null.
```

### OPEN-8. What the switcher's hard navigation costs

`window.location.assign("/agency/dashboard")` after a successful switch. Chosen
because the current URL can name a project the new organization cannot read, and
a full load clears the SWR cache and the selected-project context together.
**Not measured** — I could not run the app. The failure mode if it is wrong is
cosmetic (a slower switch), not a correctness problem.

The destination is **portal-aware**: `/partner` from the vendor chip,
`/agency/dashboard` from the agency one. An earlier draft hard-coded the agency
route, which would have bounced a vendor into the agency portal on their way to
answering an unrelated question — and middleware would have sent them back on
`active_role`. Switching organization is not switching portal; that is
`RoleToggle`'s job. **This one was found and fixed in this session**, not left
open.

---

# What was EXECUTED, what was READ, what was REASONED

**EXECUTED:** `git` (branch, status, log, diff, commit); `npx tsc --noEmit`
(four times, exit 0 each); `pnpm build` (twice, exit 0, route tables diffed
byte-identical); `pnpm lint` (twice, 182/154/28 both times); the five guard
scripts at Phase 0 and the three code-reading ones again at Phase 4; `grep -n -i
'^begin\|^commit\|^rollback'` on both new migration files, re-run after the last
edit to each; `diff -u` proving the `CREATE OR REPLACE` hunk and `diff` proving
the down file's copy is byte-identical to 089.

**READ:** `docs/089-invitation-session-report.md` in full including SEQUENCING;
`089_org_invitation_lifecycle.sql` including the whole body of
`accept_org_invitation` and its REVOKE section; `089_org_invitation_lifecycle_down.sql`;
`lib/acting-org.ts` in full; `lib/feature-flags.ts` in full; `lib/entitlements.ts`
around `resolveCallerWriteOrgId` and `hasAgencyEntitlement`;
`079_organizations.sql` for the `organizations` and `org_members` DDL, the FK
delete-rule precedent on `primary_contact_user_id`, and
`current_user_org_ids()`; `082_partner_vouches_containment.sql` for the
service_role precedent; `docs/schema-snapshot-2026-08-13.md` for the `profiles`
UPDATE policy; `components/agency-layout.tsx`, `components/partner-layout.tsx`,
`components/role-toggle.tsx`, `app/api/projects/route.ts`, `app/globals.css`.

**REASONED:** everything in OPEN above; the oracle assessment; every "expected"
value in the test procedure; every claim about what happens if the code ships
before the migration.

**NOT DONE, and the brief did not ask for it:** no full repository discovery
pass (089's report has it); no database query of any kind; nothing pushed, no PR,
no merge.

---

# Commits

```
f3e75e3  feat: migration 090 - profiles.active_org_id, set_active_org, and the write guard
06248af  refactor: remove the 42703 guard from loadStoredActingOrgId
47fdfbf  feat: the organization switcher, built into the existing account chip
         chore: correct the now-stale COLLEAGUE_INVITATIONS header + this report
```

All on `feat/m1-acting-org`, cut from `main` at `7e2f57d`. **Not pushed.**
