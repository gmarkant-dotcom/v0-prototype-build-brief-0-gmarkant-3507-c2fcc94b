# The 079 release runbook

Rewritten 2026-08-17 (second pass) to be executable rather than descriptive. Every step is
copy-pasteable and every check states the result it must produce.

Branch: `feat/079-org-rename`.

**If you read nothing else on this page, read these five lines.**

1. Step 0 can stop the release. Run it first, sober, before you announce a window.
2. Steps 1 to 3 are read-only preparation and can be done a day early.
3. Steps 4 to 5 are the outage.
4. Steps 6 and 7 prove the rename did not break anything. **They do not test M1.**
5. Step 8 tests M1, is a separate decision, and creates the first organization with two
   members. It can be done a week later. Its rollback is not the same as step 7's.

---

## What this release is

Migration 079 and the code rename are ONE release. Neither ships alone.

- `main` builds and deploys against today's database and must keep doing so until the
  migration runs.
- `feat/079-org-rename` does NOT work against today's database. Merging it before 079 is
  applied breaks production immediately: every query names columns that do not exist, and
  three routes now read a table (`organizations`) that does not exist either.
- There is no zero-downtime path. The columns cannot be named both ways at once.

---

# PHASE ONE: PREPARATION (read-only, no outage)

---

## STEP 0. THE STORAGE POLICY CHECK. FIRST, AND IT CAN STOP THE RELEASE.

The 079 header records storage policies as **UNKNOWN, not none**. Nothing in this
repository, in either census, in any of the three guards or in the policy audit can see
them: they live on `storage.objects`, outside the `schemaname='public'` snapshot, and the
repository contains no storage policy SQL at all. If one of them references `agency_id`,
the rename breaks file downloads for every customer and the first person to find out is a
customer.

Run in the Supabase SQL editor:

```sql
-- 0a. The full inventory. Read it, then keep it.
SELECT
  p.tablename,
  p.policyname,
  p.cmd,
  p.roles,
  coalesce(p.qual, '')       AS using_expr,
  coalesce(p.with_check, '') AS with_check_expr
FROM pg_policies p
WHERE p.schemaname = 'storage'
ORDER BY p.tablename, p.policyname;
```

**Expected result:** any number of rows, including zero. This one is informational. Save
the output.

```sql
-- 0b. THE ONE THAT DECIDES. Does any storage policy name a column 079 renames?
SELECT p.policyname, p.cmd, coalesce(p.qual,'') || ' | ' || coalesce(p.with_check,'') AS body
FROM pg_policies p
WHERE p.schemaname = 'storage'
  AND (coalesce(p.qual,'') || coalesce(p.with_check,''))
      ~ '\y(agency_id|partner_id|voucher_agency_id|vouched_partner_id)\y';
```

**Expected result: ZERO ROWS.**

> ### STOP INSTRUCTION
>
> If 0b returns **any** row, do not proceed to step 1. Every row it returns is a storage
> policy that 079 will break and that nothing else in this release detects. Write each one
> down, decide its post-079 predicate, add the rewrite to 079 as a new phase, and start
> this runbook again from step 0. This is not a "note it and carry on" check.

If it returns zero rows, **write the date next to this line in the report.** It is the
first time this has been established rather than assumed.

```sql
-- 0c. Bucket configuration, while you are here. A public bucket makes a policy question
-- moot in the other direction.
SELECT id, name, public FROM storage.buckets ORDER BY name;
```

**Expected result:** `avatars` is `public = true` (`CLAUDE.md`, storage split). Anything
else public is a separate finding worth writing down. **It does not block this release.**

```sql
-- 0d. Find the point-in-time-restore window NOW, not when you need it.
--     This is a console check, not SQL: Supabase Dashboard > Database > Backups.
--     Write down the retention window and the restore button's location.
```

**Expected result:** you can state, out loud, how far back you can restore and where the
button is. If you cannot, stop and find out. The recovery path for "the down migration
itself failed" is a point-in-time restore and nothing else.

---

## STEP 1. Capture a fresh `pg_policies` snapshot, and commit it

`docs/schema-snapshot-2026-08-13.md` is the authoritative record and it is **known stale
in at least two rows**: migration 081 replaced the INSERT policies on `project_documents`
and `project_messages` on 2026-08-17. Fifteen live policies already exist in production
and nowhere in this repository.

Supabase **truncates exports at 100 rows silently**, in the clipboard and in the CSV.
Split the query or you will get a snapshot that looks complete and is not.

```sql
-- 1a. part one
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename < 'projects'
ORDER BY tablename, policyname;
```

```sql
-- 1b. part two
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename >= 'projects'
ORDER BY tablename, policyname;
```

```sql
-- 1c. the count that tells you whether you got everything
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
```

**Expected result: 104**, if nothing has changed since Aug 13 other than 081, which was
policy-count neutral.

| If migration 080 is applied | add 3 | `milestone_events` carries three policies |
| If migration 081 is applied | add 0 | count-neutral, replaced two INSERT policies in place |
| If migration 082 is applied | add 0 | count-neutral |

So the acceptable answers are **104** or **107**, and nothing else.

**Check:** the number of rows you pasted into the new snapshot file equals the number 1c
returned. If it does not, you truncated. Re-export.

> **STOP INSTRUCTION.** If the count is neither 104 nor 107 and you cannot account for the
> difference, STOP. Something changed outside this repository, and every `DROP POLICY` in
> 079 that names a policy is unsafe until you know what.

Then:

```bash
# 1d. Commit the capture. Use today's date.
git checkout feat/079-org-rename
$EDITOR docs/schema-snapshot-2026-08-18.md      # paste 1a + 1b
git add docs/schema-snapshot-2026-08-18.md
git commit -m "docs: fresh pg_policies capture immediately before 079"
```

```bash
# 1e. Diff it against the authoritative Aug 13 file. Read every difference.
diff docs/schema-snapshot-2026-08-13.md docs/schema-snapshot-2026-08-18.md
```

**Expected result:** differences confined to the two 081 INSERT policies, plus the three
`milestone_events` policies if 080 is applied. **Every policy that appears, disappears or
changes name invalidates a `DROP` in 079 PHASE 4 and a restore in the down migration.**

---

## STEP 2. Regenerate the down migration from that fresh capture

`supabase/migrations/079_organizations_down.sql` was authored from the Aug 13 capture. Its
own header says it: **it is a TEMPLATE, not a guarantee.** Its `CREATE POLICY` statements
restore the policy bodies as they stood on Aug 13. Any policy that has changed since is
restored to the wrong body, which is worse than not being restored at all, because it
looks like a rollback succeeded.

The procedure is mechanical and is written out in that file's header. In short:

1. For every policy in the fresh capture whose `qual`/`with_check` differs from the Aug 13
   file, replace the corresponding `CREATE POLICY` in the down migration with the fresh
   predicate, **verbatim**, including Postgres's normalized spelling (`~~*` not `ILIKE`,
   column qualification, no `public.` prefix).
2. For every policy present in the fresh capture and absent from the down migration, add
   it.
3. For every policy in the down migration and absent from the fresh capture, delete it.

```bash
git add supabase/migrations/079_organizations_down.sql
git commit -m "fix: regenerate the 079 down migration from the pre-apply capture"
```

**Check:**

```bash
# every policy name in the fresh capture appears exactly once in the down migration
grep -c 'CREATE POLICY' supabase/migrations/079_organizations_down.sql
```

**Expected result:** equal to the number of `DROP POLICY` statements in 079 that the fresh
capture confirms exist, which is **83** if nothing has drifted.

> **On failure: a rollback you have not regenerated is a rollback you do not have.** Do
> not proceed on the assumption you will not need it.

---

## STEP 3. Rebase onto main, and re-run all THREE guards

**A guard that passed yesterday proves nothing about a branch that has since absorbed
commits.** Anything merged to `main` after this branch was cut names the OLD columns,
because `main` is still correct against the old schema. The rebase brings that code onto
the branch, and the guards are the only thing that will notice.

```bash
git checkout main
git pull
git checkout feat/079-org-rename
git rebase main
```

Then, in this order, all five must exit 0:

```bash
npx tsc --noEmit                                   ; echo "tsc=$?"
pnpm build                                         ; echo "build=$?"
node scripts/check-identity-columns.mjs --guard    ; echo "identity=$?"
node scripts/check-embed-targets.mjs   --guard     ; echo "embed=$?"
node scripts/check-org-id-reads.mjs    --guard     ; echo "orgread=$?"
```

**Expected result: `tsc=0 build=0 identity=0 embed=0 orgread=0`.**

What each one means, and what it does NOT mean:

| Guard | Exit 0 means | Exit 0 does NOT mean |
|---|---|---|
| `check-identity-columns` | no source names `agency_id` / `partner_id` / `voucher_agency_id` / `vouched_partner_id` | anything about constraint names, embeds, or strings built by concatenation |
| `check-embed-targets` | no PostgREST embed traverses a foreign key 079 repoints | that any embed RETURNS DATA. A row filtered by row level security comes back as `null` at HTTP 200 |
| `check-org-id-reads` | the profiles-by-organization-id class **did not grow** | that the class is closed. **25 known sites remain open.** See "What will look broken" below |

> **On failure of `identity` or `embed`:** each prints every surviving occurrence with its
> file, line and the name it should take. Fix on the branch, re-run, do not proceed until 0.
>
> **On failure of `orgread`:** it prints the file whose count exceeded the recorded
> baseline. A rebase pulled in a NEW instance of the class. Fix it or add it to
> `KNOWN_OPEN` in that script deliberately - never silently.

```bash
# 3b. Optional but cheap: prove the branch builds as a Vercel PREVIEW before the window,
# so step 6's deploy is not the first time the production build runs.
git push --force-with-lease origin feat/079-org-rename
# then watch the preview deployment in Vercel go green. Do NOT promote it.
```

---

# PHASE TWO: THE OUTAGE

**From here to the end of step 6 the product is down. Announce it or accept it. See "What
happens to in-flight users" below before you decide which.**

---

## STEP 4. Apply 079

### 4.1 Re-confirm the precondition. Verify rather than trust.

The seven mis-roled accounts were corrected on 2026-08-17, which is what makes 079's Rule A
derivation correct. Confirm it is still true:

```sql
SELECT count(*) FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE coalesce(u.raw_user_meta_data->>'role', p.role) IS DISTINCT FROM p.role;
```

**Expected result: 0.**

If it is not 0, the capability flags 079 stamps will be wrong for that many organizations.
**That is a data-quality fault, not a lockout** - no policy reads `is_lead_agency` or
`is_vendor` - so it does not have to stop you. Fix it first if you can.

```sql
-- 4.2 What the live signup trigger actually is. Two documents disagree about whether
-- migration 078 is applied, and PHASE 12 is a CREATE OR REPLACE over whatever is live.
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
```

**Expected result:** a body that reads `NEW.raw_user_meta_data->>'role'` and sets
`secondary_role` to the opposite. Diff it against 079 PHASE 12's block: **everything above
the "Organization and owner membership" comment must match.**

If the live body instead hardcodes `role = 'agency'`, then 078 is NOT applied, `LIGAMENT_CONTEXT.md`
is right and the 079 PHASE 12 header is wrong. **This does not block the release** - PHASE 12
replaces the function wholesale with the correct body either way - but say so out loud, because
every account created between 078's authoring and now carries the wrong role.

```sql
-- 4.3 Write these numbers down BEFORE the migration. You compare against them in step 6.
SELECT count(*) FROM public.profiles;        -- the number of organizations 079 will create
SELECT count(*) FROM public.partnerships;
SELECT count(*) FROM public.projects;
SELECT count(*) FROM public.partner_rfp_inbox;
```

**Expected result:** 16 profiles on 2026-08-17. Write down whatever it actually is; every
later count is compared to it.

### 4.4 Run the migration

Put the site in maintenance, or accept the outage. Then paste
`supabase/migrations/079_organizations.sql` into the SQL editor and run it.

It already carries its own `BEGIN` / `COMMIT`. **Expected result: "Success. No rows
returned".**

> **On failure BEFORE COMMIT:** `ROLLBACK`. Nothing has changed. Fix and re-run.
> A `DROP POLICY` failing on a name that is not there means your step 1 snapshot is stale -
> go back to step 1, this is exactly the abort the missing `IF EXISTS` is there to cause.
>
> **On failure AFTER COMMIT:** you are in the rollback path. Go to ROLLBACK at the bottom
> of this page and follow it in the stated order.

### 4.5 The interleaved verification. Every one of these, in order.

```sql
-- V1. The backfill created one organization and one membership per profile.
SELECT (SELECT count(*) FROM public.profiles)      AS profiles,
       (SELECT count(*) FROM public.organizations) AS orgs,
       (SELECT count(*) FROM public.org_members)   AS members;
```
**Expected result: three identical numbers, equal to 4.3's profile count (16).**

```sql
-- V2. Every membership is an owner, and every organization has a capability.
SELECT count(*) FROM public.org_members     WHERE role <> 'owner';          -- expect 0
SELECT count(*) FROM public.organizations   WHERE NOT (is_lead_agency OR is_vendor);  -- expect 0
```
**Expected result: 0 and 0.**

```sql
-- V3. Every organization has a designated primary contact. This is the one that decides
-- whether thirteen embeds render a name or a fallback on day one.
SELECT count(*) FROM public.organizations WHERE primary_contact_user_id IS NULL;
```
**Expected result: 0.** A non-zero count means that many vendors show the fallback
immediately.

```sql
-- V4. The capability split.
SELECT is_lead_agency, is_vendor, count(*)
FROM public.organizations GROUP BY 1,2 ORDER BY 1,2;
```
**Expected result: `(t,f) = 5` lead agencies, `(f,t) = 11` vendors.**

If you get `(t,f) = 12, (f,t) = 4`, the seven role corrections are not in this database and
seven vendor organizations have just been stamped as lead agencies. **Data-quality fault,
not a lockout. Do not roll back for it; fix the flags with an UPDATE afterwards.**

```sql
-- V5. The rename landed: 30 new columns exist and no old name survives.
SELECT count(*) FROM information_schema.columns
WHERE table_schema='public' AND column_name IN ('org_id','lead_org_id','vendor_org_id');
```
**Expected result: 30.**

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public'
  AND column_name IN ('agency_id','partner_id','voucher_agency_id','vouched_partner_id')
ORDER BY 1,2;
```
**Expected result: 0 rows.**

```sql
-- V6. 30 foreign keys now point at organizations.
SELECT count(*) FROM pg_constraint c
JOIN pg_class f ON f.oid = c.confrelid
WHERE c.contype='f' AND f.relname='organizations';
```
**Expected result: 30.**

```sql
-- V7. The policy count.
SELECT count(*) FROM pg_policies WHERE schemaname='public';
```
**Expected result: 108** (104 before, minus 83 dropped, plus 81 replacements, plus 6 on the
two new tables). **Add 3 if migration 080 was applied**, giving 111.

```sql
-- V8. No table is exposed, and no table is locked out.
SELECT c.relname, c.relrowsecurity, count(p.polname) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid=c.oid
WHERE n.nspname='public' AND c.relkind='r'
GROUP BY 1,2 ORDER BY c.relrowsecurity ASC, policies ASC;
```
**Expected result:** every row has `relrowsecurity = true` and a policy count above 0.
`relrowsecurity = false` is an exposed table. `true` with 0 policies is a locked-out table.
**Either is stop-and-roll-back.**

```sql
-- V9. The five helpers exist, are SECURITY DEFINER, stable, search-path-pinned, and are
-- NOT executable by anon.
SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'current_user_%' ORDER BY 1;
```
**Expected result: 5 rows. `prosecdef = t`, `provolatile = s`,
`proconfig = {"search_path=public, pg_temp"}`, and `proacl` contains `authenticated=X/` and
does NOT contain a bare `=X/`.** A bare `=X/` means PUBLIC can execute it.

```sql
-- V10. The signup trigger is still attached. CREATE OR REPLACE FUNCTION does not touch
-- triggers, but confirm rather than assume.
SELECT tgname, tgrelid::regclass, tgenabled FROM pg_trigger
WHERE NOT tgisinternal AND tgfoid = 'public.handle_new_user'::regproc;
```
**Expected result: one row, `tgenabled = 'O'`.**

---

## STEP 5. Recreate the 082 functions, IF 082 phase 1 is applied

First establish whether it is - the repository cannot tell you:

```sql
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND proname IN ('partner_vouch_count','partner_vouch_counts');
```

**Expected result: either 0 rows or 2 rows.**

- **0 rows: skip this whole step.** `lib/vouch-counts.ts` falls back to the direct table
  read on PGRST202, which still works because 082 phase 2 has not dropped the `USING (true)`
  policy either.
- **2 rows: you must re-run 082 phase 1 now**, with the renamed columns. Both functions are
  SQL-bodied and name `partner_vouches.vouched_partner_id`; 079 renames it.
  `partner_vouch_counts()` also DECLARES its returned column under the old name, and
  `lib/vouch-counts.ts` on this branch reads `vendor_org_id` off the result.

> **Skip this when 082 IS applied and every vouch count in the product reads 0, silently.**
> That is the exact failure the 082 STOP GATE exists to prevent, arriving through a
> different door.

```sql
-- Verification, after re-running 082 phase 1:
SELECT public.partner_vouch_count('<a vendor org id known to have vouches>');
SELECT count(*) FROM public.partner_vouches WHERE vendor_org_id = '<the same id>';
```
**Expected result: two identical non-zero numbers.**

---

## STEP 6. Merge and deploy

```bash
git checkout main
git merge --no-ff feat/079-org-rename
git push
```

Watch the Vercel deployment to completion.

**Expected result:** the deployment succeeds and the build log shows no errors.

**Do not take the site out of maintenance until the deploy is live.** Between step 4.4 and
here the database is renamed and the code is not: every query in production is failing.
Keep that interval short and expected.

> **On failure:** a failed build here leaves the database renamed and the old code live,
> which is total outage. Revert the merge on `main` and push, then go to ROLLBACK - but
> note that reverting to old code against a renamed database is ALSO total outage. You are
> choosing between two broken states until the down migration runs. That is why step 2
> exists.

---

## STEP 7. Smoke tests. In click order.

Do these in a browser, as a real user, in exactly this order.

> ### READ THIS BEFORE STEP 7.1
>
> **Every step from 0 to 7 happens while EVERY ORGANIZATION STILL HOLDS EXACTLY ONE
> MEMBER.** That is the whole two-phase strategy and it is what makes these tests worth
> running.
>
> 079 backfills one organization per profile, one owner membership per profile, and gives
> each organization the founding user's own id. So for all sixteen live accounts an
> organization id and a user id are the same value, membership resolves to exactly the one
> person it used to, and **nothing in the product should look different at all.**
>
> That is the point. Any regression you see in step 7 is visible against known-good
> behaviour, and it is a rename fault, not a membership fault. **Nothing in step 7 tests
> M1.** M1 is step 8, it is a separate decision, and it can wait.

| # | Action | Expected result | What it exercises |
|---:|---|---|---|
| 7.1 | Sign in as `gmarkant@gmail.com` | Dashboard renders. Recent Activity is NOT empty. | session, `current_user_org_ids()`, the whole policy set |
| 7.2 | Load `/agency/pool` | The **same number of vendors as before**. Write the before-number down at 4.3. | `partnerships.lead_org_id`, the vendor-name embed |
| 7.3 | Open a vendor profile from the pool | Name, disciplines and contact render. Not blank. | the two-hop `organizations` -> `primary_contact` embed |
| 7.4 | Load a project | Client, documents, assignments and milestones all render. | `projects.org_id` and four relationship-scoped policies |
| 7.5 | Send an RFP to a vendor already in the pool | The broadcast succeeds and the vendor's row appears in the responses view. | `partner_rfp_inbox` write path, `resolveOrgNotificationRecipients()` |
| 7.6 | Upload a document to that project | It saves and appears in the list. | migration 081's scoped INSERT policy against renamed columns |
| 7.7 | Create a throwaway account and confirm the admin signup notification arrives | The email lands. **Then run V-NEW below.** | `handle_new_user`, extended by PHASE 12 |

```sql
-- V-NEW. Run immediately after 7.7. This is the first organization in the system whose id
-- is NOT a user id, and it is what every latent bug in this release is waiting for.
SELECT p.email, p.role, o.id AS org_id, p.id AS user_id, o.name, o.is_lead_agency, o.is_vendor, m.role
FROM public.profiles p
JOIN public.org_members m ON m.user_id = p.id
JOIN public.organizations o ON o.id = m.org_id
ORDER BY p.created_at DESC LIMIT 3;
```
**Expected result:** the newest row has an organization, membership role `owner`, and
**`org_id` NOT equal to `user_id`.** If they are equal, PHASE 12 did not take.

Optional but valuable, in the same session:

| # | Action | Expected result | What it exercises |
|---:|---|---|---|
| 7.8 | Sign in as `gmarkant+partner71@gmail.com`, open an RFP, submit a bid | The bid saves and the agency sees it. | the `vendor_org_id` write path |
| 7.9 | Send a magic-link RFP to an address with no account; open it in a private window, upload a file, submit | It works end to end. | `rfp_magic_tokens.org_id`, the largest single surface in the rename, and the one route where a token rather than a session is the authority |
| 7.10 | Check Resend for the mail from 7.5, 7.7 and 7.9 | All three present. | ten of eleven recipient lookups used to fail silently. **A log nobody reads is not a check. Absence of an error is not evidence.** |

**On failure at any step, the failure mode tells you which half is wrong:**

| Symptom | Meaning |
|---|---|
| `42703` column does not exist | code and schema disagree. A missed rename. |
| row-level-security violation | a policy predicate is wrong for a real caller. |
| **an empty list, with no error** | **the dangerous one.** A filter comparing an organization column to a user id, or a profiles read keyed on an organization id. This will NOT throw. |

---

### THE DECISION POINT

**You are now done with phase one.** The rename is live, the product works, and every
organization has one member.

**Stop here if you want to.** Step 8 is a separate exercise with a different risk profile
and a different rollback. It is entirely reasonable to run it a day or a week later, on a
weekday morning, with nobody waiting.

---

# PHASE THREE: THE TEST THAT ACTUALLY VALIDATES M1

## STEP 8. Two members in one organization, and a third in another

Everything above would pass with organizations that have exactly one member each, which is
what 079 backfills. **It therefore proves the rename and proves nothing about the feature.**

**This step creates the first organization with a second member.** No invitation interface
exists yet - it ships with the membership feature - so the membership is inserted directly.
That is acceptable and it is written out in full below.

### 8.1 Pick your three accounts and record their ids

```sql
-- Read the ids you are about to use. Do not guess them and do not retype them.
SELECT p.id AS user_id, p.email, p.role, m.org_id, o.name AS org_name
FROM public.profiles p
JOIN public.org_members m ON m.user_id = p.id
JOIN public.organizations o ON o.id = m.org_id
ORDER BY o.name, p.email;
```

**Expected result:** one row per account, each in its own organization, all sixteen with
`org_id = user_id`.

Choose:

- **Organization A** - a lead agency with real projects, vendors and documents. Note its
  `org_id`. Call its existing member **A1**.
- **A2** - a second real account, currently the sole member of its own organization. Note
  its `user_id`.
- **Organization B** - a third account in a DIFFERENT organization, left completely alone.
  Note its login.

> A2 keeps its own organization membership as well. `org_members` has no uniqueness
> constraint on `user_id`, so A2 ends up in two organizations. That is correct under the
> model and it is what makes 8.4's quota check meaningful.

### 8.2 Create the second membership

```sql
-- THE FIRST SECOND MEMBER. Substitute the two ids from 8.1 verbatim.
INSERT INTO public.org_members (org_id, user_id, role)
VALUES ('<ORG A id from 8.1>', '<A2 user_id from 8.1>', 'member');
```

**Expected result: "Success. No rows returned".**

```sql
-- Confirm it, and confirm you did not create a duplicate.
SELECT m.org_id, o.name, m.user_id, p.email, m.role
FROM public.org_members m
JOIN public.organizations o ON o.id = m.org_id
JOIN public.profiles p ON p.id = m.user_id
WHERE m.org_id = '<ORG A id>'
ORDER BY m.role, p.email;
```
**Expected result: exactly two rows.** One `owner` (A1) and one `member` (A2).

> **Note the role.** `'member'`, not `'owner'`. `current_user_admin_org_ids()` returns only
> owner/admin memberships, so A2 must NOT be able to add further members or update the
> organization. That is checked at 8.5.

### 8.3 A2 sees organization A, from a real browser session

**Sign in as A2 in a real browser. Not a SQL query - the session is the thing being
tested.** The `auth.uid()` inside every SECURITY DEFINER helper comes from the JWT, and a
SQL-editor query does not have one.

| Check | Expected result |
|---|---|
| A2 loads the agency dashboard | organization A's projects appear |
| A2 loads `/agency/pool` | **the same vendor count A1 sees.** Compare directly. |
| A2 opens one of A's projects | documents and messages render |
| A2 loads `/api/agency/usage` | the quota is organization A's, not a fresh one |

> **If A2 sees an empty portal, a policy is still comparing to `auth.uid()`.** That is the
> exact failure mode this whole migration exists to remove, and it is NOT a leak - it is a
> lockout, and it is recoverable without rolling anything back. Run the policy audit at 8.6
> and it will name which policy. Note that 080's, 081's and 082's policies were authored
> after the Aug 13 snapshot and are therefore NOT in 079's PHASE 4 drop list: they survive
> the rename mechanically (Postgres rewrites policy expressions on `RENAME COLUMN`) while
> still comparing an organization column to `auth.uid()`. **They are the most likely
> culprits and the audit is what finds them.**

### 8.4 Organization B sees nothing of organization A

**From a separate live session** - a different browser, or a private window. Signed in as B,
at the same time A2 is signed in elsewhere.

| Check | Expected result |
|---|---|
| B's dashboard | **none** of A's projects |
| B's pool | B's own vendor count, not A's |
| B's bids, documents, messages | **none** of A's |
| B pastes a URL to one of A's projects | 404 or "not found", never the project |

**This is the test. Everything before it is a regression check.**

### 8.5 A2 is a member, not an admin

| Check | Expected result |
|---|---|
| A2 attempts to update organization A's name (via `/agency/settings/profile` if it is wired, or a direct PATCH) | refused |
| A2 attempts to insert another `org_members` row for organization A | refused by RLS |

**Expected result: both refused.** `current_user_admin_org_ids()` is the only source of the
org id in both write policies, and it never reads an org id from the request body.

### 8.6 Re-run the policy audit against the fresh post-079 capture

```bash
# Re-capture first: the post-079 policy set is not the one you captured at step 1.
# Same split-at-'projects' trick, into docs/schema-snapshot-2026-08-18-post079.md
node scripts/audit-policy-snapshot.mjs docs/schema-snapshot-2026-08-18-post079.md --guard
```

**Expected result: exit 0.**

Anything flagged is an organization-scoped policy still comparing to `auth.uid()`, which
works for a single-member organization and shows a colleague nothing. **The six
allow-listed names are policies that match a person on purpose; adding a seventh is a
decision, not a fix.**

### 8.7 Clean up

```sql
-- Remove the test membership, UNLESS the colleague is real and staying.
DELETE FROM public.org_members
WHERE org_id = '<ORG A id>' AND user_id = '<A2 user_id>' AND role = 'member';
```
**Expected result: "Success. No rows returned", 1 row affected.**

---

### IF STEP 7 PASSED BUT STEP 8 FAILS: THE TWO ANSWERS ARE DIFFERENT

This is the case the runbook exists to pre-decide, because the instinct in the moment is
wrong in one of the two directions.

| What failed | What it is | What to do |
|---|---|---|
| **8.3 - A2 sees an EMPTY portal** | A **lockout**. A policy still compares an organization column to `auth.uid()`. No data is exposed to anyone; one person cannot see data they are entitled to. | **DO NOT ROLL BACK.** Delete the test membership (8.7) and the product is exactly as it was at the end of step 7 - correct for every real user, because every real organization has one member. Fix the named policies at leisure and re-run step 8. Rolling back a working release to fix a lockout in a feature nobody is using yet is strictly worse. |
| **8.4 - B sees ANY of A's data** | A **cross-tenant leak**. | **STOP. This is the one failure worth an emergency.** Delete the test membership immediately (8.7) - that alone closes it, because the leak requires the second membership to exist. Then decide whether to roll back on the evidence: if the leak is reproducible WITHOUT a second membership, roll back in full, in the ROLLBACK order below. If it needs the second membership, you have already closed it and can fix forward. |
| **8.5 - A2 can administer organization A** | A **privilege escalation**, bounded to one organization the person is already in. | Delete the test membership. Fix the write policies. Not a rollback. |

**The asymmetry is deliberate.** A lockout is invisible to every current user; a leak is not.

---

## STEP 9. Record it

- Commit the post-079 capture as the new authoritative
  `docs/schema-snapshot-<date>-post079.md` and say in `docs/schema-truth.md` section 2 that
  it supersedes Aug 13.
- Add rows for **079, 080, 081 and 082** to the migrations table in `LIGAMENT_CONTEXT.md`
  with their real applied/not-applied status. **None of the four is listed there today**,
  and that gap is why step 5 has to ask the database what is applied.
- Note in `docs/079-rename-execution-report.md` that the branch shipped, with the date.
- Diff the post-079 capture against the pre-079 one. **The only differences should be** the
  rewritten predicates, the folded `profiles` policies, the new policies, and the role-list
  narrowings from `public` to `authenticated` that 079's own header enumerates. Anything
  else changed outside this release.

---

# WHAT HAPPENS TO IN-FLIGHT USERS

Decided deliberately rather than left unconsidered.

**At sixteen accounts, the honest answer is: do it late, announce nothing, invalidate
nothing.** The reasoning, so it can be re-decided at a hundred accounts:

- **Sessions do NOT need invalidating.** Nothing about a session changes. The JWT carries
  `auth.uid()`, which is still the same user id; `org_members` is read fresh on every
  request through a `STABLE` SECURITY DEFINER function, never cached in the token. There is
  no stale-claim problem to solve.
- **A user mid-request during step 4** gets a `42703` and a 500. Their next click works, once
  step 6's deploy is live.
- **A user mid-FORM** - halfway through the RFP wizard, a bid, a profile edit - is the real
  cost. The form state is client-side; the submit is what fails. They lose what they typed
  and see a generic error. **Nothing in this codebase drafts or restores form state.** This
  is the argument for running the window at a time when nobody is typing.
- **A user mid-UPLOAD** gets a failed upload. Vercel Blob and Supabase Storage are not
  touched by 079, so nothing is corrupted; the row that would reference the file is what
  fails to write. They retry.
- **Nothing writes partial state across the boundary.** 079 is one transaction. Either the
  whole rename is live or none of it is. There is no window where half the columns are
  renamed.
- **Emails already queued** still send. They are not transactional with the database.

**Therefore: run it late in the evening, in the customers' timezone. Do not announce.** At
sixteen accounts an announcement costs more attention than the outage costs anyone. **Revisit
this the first time a customer has a team.**

---

# WHAT WILL LOOK BROKEN BUT IS EXPECTED

Read this before chasing a ghost.

### 1. Pending vendor-request cards read "Vendor has not published a profile"

**On `/agency/pool`, in the amber "Vendor Requests Pending" panel.** This is Greg's ruling
(option 3) and it is correct, not a bug.

A `partner_access_requests` row is a vendor asking to *join* an agency's pool. No
partnership exists, so that vendor's organization is not a counterparty, so
`current_user_counterparty_org_ids()` does not return it and the embed comes back null.
Fourteen of the sixteen live accounts have `is_discoverable = false`, so the discoverable
policy does not rescue it either.

**Live blast radius today: zero rows.** The one existing row is `approved`, not `pending`,
and its vendor is one of the two discoverable accounts. **The copy states the cause on
purpose**, so that meeting it in six weeks reads as expected behaviour. The proper fix is
option 2 - snapshot `requested_by_user_id` onto the row - and it ships with the membership
feature.

### 2. `location` is blank wherever a lead agency is shown to a vendor

`location` is a `profiles` column and `organizations` has no equivalent. This has been
blank since the embeds were repointed at `organizations`, which was the previous run, not
this one. It is explicit (`agencyLocation: ''`) in
`contexts/lead-agency-filter-context.tsx` with a comment. **The rename does not cause it and
does not fix it.**

### 3. "Book a call" does not render for lead agencies created after 079

`meeting_url` is also a `profiles` column with no organization equivalent. The read at
`app/api/partner/rfps/route.ts` still fetches it by organization id and will return nothing
for any organization created after 079. **It fails closed - a missing button, not a wrong
one.** Written up in `docs/079-embed-closure-report.md`.

### 4. Twenty-five reads that fetch a PERSON by a COMPANY id

**This is the big one and it is the reason "ready or not" is a qualified yes.**

`node scripts/check-org-id-reads.mjs` lists 25 sites where a `profiles` row is read using
an id that is an organization id after 079. Every one of them:

- **works perfectly for all sixteen existing accounts**, because their organization ids
  equal their user ids;
- **returns nothing, at HTTP 200, with no error anywhere**, for any organization created
  after 079.

**So: nothing in step 7 will show this, and it will start appearing as new customers sign
up and form partnerships.** The affected surfaces are vendor and agency display names on
the MSA pages, payment synthesis, RFP responses, the vendor pool detail page, the vendor's
network page, guest RFP pages, and several email recipient lookups.

**They are recorded in the guard's `KNOWN_OPEN` list so the class cannot grow silently.**
They are NOT fixed on this branch. They should be the first thing that ships after it.

### 5. `full_name` on a company

Anywhere the product shows "the vendor's full name" or "the agency's full name", it is now
the **designated primary contact's** name, not the company's. There is no organization-level
full name and inventing one would be a lie. The field names say so (`contact_name`,
`contact_email`, `contact_capabilities`).

### 6. `capabilities`, `company_logo_url` and `created_at` on a pool card

Same cause. These live on `profiles`, so they describe the CONTACT, not the COMPANY.
`contact_created_at` is when that person signed up, not when the company was created -
`organizations.created_at` exists and is a different date for every organization made after
079.

---

# ROLLBACK

> ## THE ORDER IS NOT NEGOTIABLE.
> ## REVERT THE DEPLOY FIRST. THEN RUN THE DOWN MIGRATION.

Running the down migration while the renamed code is live means every query in the product
fails against columns that no longer exist. You would turn a partial failure into a total
one, and you would do it at the exact moment you were trying to recover.

### R1. Revert the deploy

```bash
git checkout main
git log --oneline -5                     # find the merge commit from step 6
git revert --no-edit -m 1 <the merge commit>
git push
```

Wait for the deployment to go live. **Confirm it in Vercel before touching any SQL.**

**The product is DOWN for this entire interval, and it is down hard:** old code against a
renamed database, so every read and every write returns 42703. Typical duration is one
Vercel deployment, two to four minutes. Nothing makes this window shorter.

### R2. Run the down migration

Use **the version regenerated at step 2**, not the committed template.

```sql
-- supabase/migrations/079_organizations_down.sql, regenerated from the step 1 capture
```
**Expected result: "Success. No rows returned".**

### R3. Verify the reversal

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public'
  AND column_name IN ('org_id','lead_org_id','vendor_org_id')
  AND table_name NOT IN ('organizations','org_members')
ORDER BY 1,2;
```
**Expected result: 0 rows.**

```sql
SELECT count(*) FROM pg_policies WHERE schemaname='public';
```
**Expected result: the pre-079 number from step 1c (104, or 107 with 080).**

### R4. Smoke test the reverted product

Sign in, load the pool, open a project. **The site is back once these pass.**

### The window in each direction

| Direction | What is broken | For how long |
|---|---|---|
| Forward (step 4.4 -> step 6) | Old code against a renamed database. Total outage. | One deployment, plus however long 4.5's verification takes. Minimise by having the preview already built at step 3b. **Realistically 5 to 15 minutes.** |
| Rollback (R1 -> R2) | Renamed code reverted, database still renamed - then old code against a renamed database until the down migration lands. Total outage throughout. | One deployment plus one migration. **Longer than the forward window**, because the down migration is bigger than the deploy. **Realistically 10 to 20 minutes.** |

### If the down migration itself fails

**You are past the point this runbook can help.** The recovery is a point-in-time restore
from Supabase's backup to just before step 4.4. You established where that button is and
what the retention window is at step 0d, which is why 0d is in step 0 and not here.

### What rollback does NOT undo

- **Rows written between step 6 and the rollback.** An organization created by
  `handle_new_user` while 079 was live has an id belonging to no user. The down migration's
  own header states its limits; read them before you need them.
- **The throwaway account from 7.7**, and its organization.
- **Emails already sent.** Steps 7.5, 7.7 and 7.9 send real mail to real people.
- **The `org_members` row from 8.2**, if you got that far. Delete it explicitly.

---

# WHAT I COULD NOT ANSWER FROM THIS PAGE ALONE

Re-read top to bottom as if it were 9am with no context. These are the points where I would
have to stop and ask someone. **This list is a deliverable, not a formality.**

1. **Which of 080, 081 and 082 are actually applied?** The runbook asks the database at
   steps 1c and 5, which is correct, but I have to know the answer at step 1c to interpret
   the count, and the answer is not written anywhere. `LIGAMENT_CONTEXT.md` lists none of
   them. **Someone must write the four statuses down before the window opens.**

2. **Is migration 078 applied?** `LIGAMENT_CONTEXT.md` says "AUTHORED, NOT APPLIED". The
   079 PHASE 12 header says "Migration 078 is applied and verified in production". Both
   cannot be true. Step 4.2 resolves it empirically, and I have said it does not block -
   but I am asserting that, and someone who knows should confirm it.

3. **How do I put the site in maintenance?** Step 4.4 says "put the site in maintenance, or
   accept the outage" and does not say how. There is no maintenance mode in this
   repository that I found. **I would assume the answer is "accept the outage" and proceed -
   but that is an assumption, not an instruction.**

4. **Which account is "A2"?** Step 8.1 says "a second real account". Sixteen exist. I do not
   know which of them belongs to a person who will not be surprised to find themselves in
   somebody else's organization. **Name the account in advance.**

5. **Where exactly does A2 check the AI quota?** Step 8.3 says `/api/agency/usage`. That is
   an API route, not a page. I do not know whether there is a UI for it or whether I am
   meant to hit the JSON directly in a browser tab.

6. **How do I "attempt to update organization A's name" at step 8.5?** I wrote "via
   `/agency/settings/profile` if it is wired". I do not know whether that page writes to
   `organizations` at all after 079, or still writes to `profiles`. **If it still writes to
   `profiles`, step 8.5 is not testing what it claims to test** and I would need a direct
   PATCH, which I cannot construct without knowing the route.

7. **What is the expected `DROP POLICY` count at step 2's check?** I wrote 83 "if nothing
   has drifted". If something HAS drifted, I do not know what number to expect, and the
   step tells me to compare against a number I would have to derive myself under time
   pressure.

8. **Is there a staging or branch database?** Step 3b builds a Vercel preview, but a preview
   points at production. Nothing on this page lets me test the migration anywhere before
   production. **See `docs/079-preflight.md` - the answer is no, and it is the single largest
   unmitigated risk in this release.**

9. **At step 8.4, "B pastes a URL to one of A's projects" - which URL?** I would need to
   know the route shape for an agency project page and whether it is guarded by the
   selected-project context rather than by RLS, in which case a 404 would prove nothing.

10. **How long may I leave the second membership in place?** Step 8.7 says remove it "unless
    the colleague is real". If I run step 8 on a weekday and stop halfway, a real person is
    sitting in two organizations with no interface to leave one. **I do not know whether that
    is harmless.**
