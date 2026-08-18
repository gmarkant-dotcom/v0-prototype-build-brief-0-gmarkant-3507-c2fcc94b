# The 079 release runbook

The sequence to follow on the day, in order, with what to check after each step and what to
do when a check fails.

Written 2026-08-17, from the branch `feat/079-org-rename`.

**Read `docs/079-rename-execution-report.md` first.** This runbook assumes you know what is
on the branch, and in particular that it lists thirteen PostgREST embeds the rename could not
fix. Step 3 is where you decide whether that blocks the release.

---

## Before anything: what this release is

Migration 079 and the code rename are ONE release. Neither ships alone.

- `main` builds and deploys against today's database and must keep doing so until the moment
  the migration runs.
- `feat/079-org-rename` does NOT build meaningfully against today's database. Merging it
  before 079 is applied breaks production immediately - every query names columns that do
  not exist.
- There is no zero-downtime path. The columns cannot be named both ways at once. Plan for a
  window, and tell people it is coming.

Rough shape of the window: steps 4 through 7 are the outage. Everything before step 4 is
read-only or off-line preparation and can happen a day earlier.

---

## Step 0. THE STORAGE POLICY CHECK. Do this first, and stop if it returns anything.

The 079 header records storage policies as **UNKNOWN, not none**. Nothing in this repository,
in the census, in `--guard` or in the policy audit can see them. If a storage policy
references `agency_id`, the rename breaks file downloads for every customer and the first
person to find out is a customer.

Run in the Supabase SQL editor:

```sql
SELECT
  p.policyname,
  p.cmd,
  p.roles,
  coalesce(p.qual, '')       AS using_expr,
  coalesce(p.with_check, '') AS with_check_expr
FROM pg_policies p
WHERE p.schemaname = 'storage'
ORDER BY p.tablename, p.policyname;
```

Then, narrowing to the thing that matters:

```sql
SELECT p.policyname, p.cmd, coalesce(p.qual,'') || ' | ' || coalesce(p.with_check,'') AS body
FROM pg_policies p
WHERE p.schemaname = 'storage'
  AND (coalesce(p.qual,'') || coalesce(p.with_check,''))
      ~ '\y(agency_id|partner_id|voucher_agency_id|vouched_partner_id)\y';
```

**STOP INSTRUCTION.** If the second query returns ANY row, do not proceed to step 1. Every
row it returns is a storage policy that 079 will break and that nothing else in this release
detects. Write each one down, decide its post-079 predicate, and add the rewrite to 079 as a
new phase before continuing. This is not a "note it and carry on" check.

If it returns zero rows, record that fact with the date - it is the first time this has been
established rather than assumed - and continue.

**Also check the bucket configuration while you are here**, because a public bucket makes a
policy question moot in the other direction:

```sql
SELECT id, name, public FROM storage.buckets ORDER BY name;
```

`avatars` is expected to be public (`CLAUDE.md`, storage split). Anything else being public is
a separate finding worth writing down, and it does not block this release.

---

## Step 1. Capture a fresh `pg_policies` snapshot, and commit it

The Aug 13 snapshot is the authoritative record and it is now **known stale in two rows**:
migration 081 replaced the INSERT policies on `project_documents` and `project_messages` on
2026-08-17. There may be other drift; fifteen live policies already exist in production and
nowhere in this repository.

Supabase **truncates exports at 100 rows silently**, in the clipboard and in the CSV. Split
the query or you will get a snapshot that looks complete and is not.

```sql
-- part 1
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename < 'projects'
ORDER BY tablename, policyname;

-- part 2
SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename >= 'projects'
ORDER BY tablename, policyname;

-- the count that tells you whether you got everything
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
```

**Expected count: 104**, if nothing has changed since Aug 13 other than 081, which was
policy-count neutral. Add 3 if migration 080 has been applied by then (`milestone_events`
carries three policies), giving 107. Add 0 for 082, which is also count-neutral.

**Check:** the number of rows you pasted into the new snapshot file equals the number the
count query returned. If it does not, you truncated. Re-export.

**On failure:** if the count is anything other than 104 or 107 and you cannot account for the
difference, STOP. Something changed outside this repository, and every `DROP POLICY` in 079
that names a policy is unsafe until you know what.

Commit the capture as `docs/schema-snapshot-<today>.md` and diff it against the Aug 13 file.
Every policy that appears, disappears or changes name invalidates a `DROP` in 079 and a
restore in the down migration.

---

## Step 2. Regenerate the down migration from that fresh capture

`supabase/migrations/079_organizations_down.sql` was authored from the Aug 13 capture. It is a
TEMPLATE, not a guarantee. Its `CREATE POLICY` statements restore the policy bodies as they
stood on Aug 13; any policy that has changed since will be restored to the wrong body, which
is worse than not being restored at all, because it looks like a rollback succeeded.

Regenerate it from the step 1 capture, statement by statement, and diff the result against the
committed file. Commit the regenerated version.

**Check:** every policy name in the fresh capture appears exactly once in the regenerated down
migration, and the count matches.

**On failure:** a rollback you have not regenerated is a rollback you do not have. Do not
proceed on the assumption you will not need it.

---

## Step 3. Decide the thirteen broken embeds

`docs/079-rename-execution-report.md` lists thirteen PostgREST embeds of the form
`partner:profiles!partnerships_partner_id_fkey(email, full_name, company_name)`. After 079
the foreign key they traverse points at `organizations`, which has no `email`, no `full_name`
and no `company_name`. They are marked `079-EMBED-BREAK` in the source and were deliberately
left unresolved, because rewriting them means ruling on what an organization's email address
is.

```bash
grep -rn "079-EMBED-BREAK" app/ | wc -l   # expect 13
```

**These break the product.** Vendor names stop rendering in the pool, on projects, on
assignments and in broadcast emails. This is not a cosmetic gap.

**Decide here, before the window opens.** Two workable answers:

- **Embed the organization and read `name`.** `partner:organizations!partnerships_vendor_org_id_org_fkey(id, name)`,
  and every consumer reading `partner.company_name` reads `partner.name`. Email comes from
  `resolveOrgNotificationRecipients()` where it is actually needed. This is the smaller change
  and it is probably right.
- **Drop the embed and resolve separately**, the way the routes already resolve agency names
  by a second query keyed on a map.

**STOP INSTRUCTION.** Do not open the window with these unresolved. A release that renames
correctly and blanks every vendor name is not a successful release.

---

## Step 4. Rebase the branch onto main, and re-run the guard

```bash
git checkout feat/079-org-rename
git rebase main
npx tsc --noEmit                              # expect exit 0
pnpm build                                    # expect exit 0
node scripts/check-identity-columns.mjs --guard   # expect exit 0
```

**A guard that passed last week proves nothing about a branch that has since absorbed new
code.** Anything merged to `main` after this branch was cut names the old columns, because
`main` is still correct against the old schema. The rebase brings that code onto the branch
and the guard is the only thing that will notice.

**On failure:** the guard prints every surviving occurrence with its file, line and the target
name it should take. Fix them on the branch, re-run, and do not proceed until it exits 0.
Remember what the guard does NOT see: constraint names, the thirteen embeds, and any string
built by concatenation.

---

## Step 5. Apply 079

Put the site in maintenance, or accept the outage. Then, in the Supabase SQL editor:

1. **Re-confirm the precondition.** The seven mis-roled accounts were corrected on
   2026-08-17, so 079's Rule A derivation is now right. Verify rather than trust:

   ```sql
   SELECT count(*) FROM public.profiles p
   JOIN auth.users u ON u.id = p.id
   WHERE coalesce(u.raw_user_meta_data->>'role', p.role) IS DISTINCT FROM p.role;
   -- expect 0
   ```

   If it is not 0, the capability flags 079 stamps will be wrong for that many organizations.
   That is a data-quality fault, not a lockout - no policy reads those flags - so it does not
   have to stop you, but fix it first if you can.

2. **Run `supabase/migrations/079_organizations.sql` as one transaction.** It already has
   `BEGIN`/`COMMIT`. Expect "Success. No rows returned".

3. **Run the interleaved verification block at the foot of the file.** Every count it states
   must match. The ones that matter most:

   ```sql
   SELECT count(*) FROM public.organizations;   -- equals the profile count (16)
   SELECT count(*) FROM public.org_members;     -- equals the profile count (16)

   -- 30 renamed columns exist and none of the old names survive
   SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema='public' AND column_name IN ('org_id','lead_org_id','vendor_org_id')
   ORDER BY 1,2;                                -- expect 30 rows

   SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name IN ('agency_id','partner_id','voucher_agency_id','vouched_partner_id')
   ORDER BY 1,2;                                -- expect 0 rows

   -- 30 foreign keys now point at organizations
   SELECT count(*) FROM pg_constraint c
   JOIN pg_class f ON f.oid = c.confrelid
   WHERE c.contype='f' AND f.relname='organizations';   -- expect 30
   ```

**On failure before COMMIT:** `ROLLBACK`. Nothing has changed. Fix and re-run.

**On failure after COMMIT:** you are in the rollback path. Go to the ROLLBACK section at the
bottom of this document and follow it in the stated order.

---

## Step 6. Recreate the 082 functions, if 082 phase 1 has been applied

`partner_vouch_count()` and `partner_vouch_counts()` are SQL-bodied functions that name
`partner_vouches.vouched_partner_id`. 079 renames that column. `partner_vouch_counts()` also
DECLARES its returned column under the old name, and `lib/vouch-counts.ts` on this branch
reads `vendor_org_id` off the result.

Re-run 082 phase 1 with the renamed columns. **Skip this and every vouch count in the product
reads 0, silently** - the same failure the 082 STOP GATE exists to prevent, arriving through a
different door.

```sql
SELECT public.partner_vouch_count('<a vendor org id known to have vouches>');
-- expect a non-zero number matching:
SELECT count(*) FROM public.partner_vouches WHERE vendor_org_id = '<the same id>';
```

If 082 phase 1 has NOT been applied, skip this step. `lib/vouch-counts.ts` falls back to the
direct table read on PGRST202, which still works because phase 2 has not dropped the
`USING (true)` policy either.

---

## Step 7. Merge the branch and deploy

```bash
git checkout main
git merge --no-ff feat/079-org-rename
git push
```

Watch the Vercel deployment to completion. **Do not take the site out of maintenance until the
deploy is live.** Between step 5 and here, the database is renamed and the code is not: every
query in production is failing. Keep that interval short and expected.

**Check:** the deployment succeeds and the build log shows no errors.

**On failure:** a failed build here leaves the database renamed and the old code live, which is
total outage. Revert the merge on `main` and push, then go to ROLLBACK - but note that
reverting to old code against a renamed database is ALSO total outage. You are choosing
between two broken states until the down migration runs. That is why step 2 exists.

---

## Step 8. Smoke tests. Prove the product still works.

Do these in a browser, in this order, as a real user. Write down the "before" numbers where a
step asks for one.

1. **Sign in** as `gmarkant@gmail.com`. The dashboard renders and Recent Activity is not
   empty.
2. **Load the pool.** `/agency/pool` lists the same number of vendors as before. *Write that
   number down before step 5.* This exercises `partnerships.lead_org_id` and the vendor-name
   embed from step 3.
3. **Load a project.** Its client, documents, assignments and milestones all render.
4. **Send an RFP.** Broadcast to a vendor already in the pool. This is the
   `partner_rfp_inbox` write path plus `resolveOrgNotificationRecipients()`.
5. **Upload a document** to that project. It saves. This exercises migration 081's scoped
   INSERT policy against the renamed columns in its policy body - 081's predicates name
   `projects.agency_id` and `partnerships.partner_id`, and 079 must have rewritten both.
6. **Confirm a signup notification arrives.** Create a throwaway account and check the admin
   notification lands. This is `handle_new_user`, which 079 extends to create an organization
   and an owner membership.
7. **Bid as a vendor.** Sign in as `gmarkant+partner71@gmail.com`, open an RFP, submit a bid.
   This is the `vendor_org_id` write path.
8. **The guest path.** Send a magic-link RFP to an address with no account. Open the link in a
   private window, upload a file, submit. This is `rfp_magic_tokens.org_id` plus the largest
   single surface in the rename, and it is the one route where the token, not a session, is
   the authority.
9. **Confirm emails actually arrived** for steps 4, 7 and 8. Ten of the eleven recipient
   lookups used to fail silently; they now log, but a log nobody reads is not a check.
   Absence of an error is not evidence. Look in Resend.

**On failure at any step:** the failure mode tells you which half is wrong. A 42703 ("column
does not exist") means the code and the schema disagree - a missed rename. A row-level
security violation means a policy predicate is wrong for a real caller. An empty list with no
error is the dangerous one: that is a filter comparing an organization column to a user id,
and it is exactly what step 9 of the report warns about.

---

## Step 9. The test that actually validates M1

Everything above would pass with organizations that have exactly one member each, which is
what 079 backfills. It therefore proves the rename and proves nothing about the feature.

1. In SQL, add a **second member to one organization**:

   ```sql
   -- Organization A gets a colleague. Use a real second account.
   INSERT INTO public.org_members (org_id, user_id, role)
   VALUES ('<org A id>', '<a second real user id>', 'member');
   ```

2. **Sign in as that second account, in a real browser session.** Not a SQL query - the
   session is the thing being tested.

   - They see organization A's projects, pool and bids.
   - They can open a project and read its documents and messages.
   - Their AI quota is organization A's, not a fresh one. Check `/api/agency/usage`.

3. **Confirm isolation.** With a third account in a DIFFERENT organization B, signed in from a
   separate live session:

   - Organization B sees **none** of organization A's projects, vendors, bids, documents or
     messages.
   - Organization B's pool count is its own.

**This is the test. Everything before it is a regression check.** If step 2 shows the colleague
an empty portal, a policy is still comparing to `auth.uid()` - run the policy audit against a
fresh capture and it will name which. If step 3 shows organization B anything belonging to
organization A, stop and roll back: that is a cross-tenant data leak and it is the one failure
mode worth an emergency for.

4. **Re-run the policy audit** against the fresh post-079 capture:

   ```bash
   node scripts/audit-policy-snapshot.mjs docs/schema-snapshot-<today>.md --guard
   ```

   **Expect exit 0.** Anything flagged is an organization-scoped policy still comparing to
   `auth.uid()`, which works for a single-member organization and shows a colleague nothing.
   The six allow-listed names are policies that match a person on purpose; adding a seventh is
   a decision, not a fix.

5. **Remove the test membership** when you are done, unless the colleague is real.

---

## Step 10. Record it

- Commit the fresh snapshot as the new authoritative `docs/schema-snapshot-<date>.md` and say
  in `docs/schema-truth.md` section 2 that it supersedes Aug 13.
- Update the migrations table in `LIGAMENT_CONTEXT.md`: 079 applied, with the date.
- Note in `docs/079-rename-execution-report.md` that the branch shipped.
- Diff the new capture against the pre-079 one. The only differences should be the rewritten
  predicates, the folded `profiles` policies, the new policies and the role-list narrowings
  from `public` to `authenticated` that 079's own header enumerates. Anything else changed
  outside this release.

---

## ROLLBACK

**THE ORDER IS NOT NEGOTIABLE: REVERT THE DEPLOY FIRST, THEN RUN THE DOWN MIGRATION.**

Running the down migration while the renamed code is live means every query in the product
fails against columns that no longer exist. You would turn a partial failure into a total one,
and you would do it at the exact moment you were trying to recover.

### The order

1. **Revert the deploy.**

   ```bash
   git checkout main
   git revert --no-edit -m 1 <the merge commit>
   git push
   ```

   Wait for the deployment to go live. Confirm it in Vercel before touching SQL.

   **The product is DOWN for this entire interval**, and it is down hard: the old code is now
   live against a renamed database, so every read and every write returns 42703. Typical
   duration is one Vercel deployment, two to four minutes. Nothing you can do makes this
   window shorter, which is the argument for getting step 8 right rather than for rushing
   this.

2. **Run the down migration** - the version regenerated in step 2, not the committed template.

   ```sql
   -- supabase/migrations/079_organizations_down.sql, regenerated from the step 1 capture
   ```

   Expect "Success. No rows returned".

3. **Verify the reversal.**

   ```sql
   SELECT table_name, column_name FROM information_schema.columns
   WHERE table_schema='public'
     AND column_name IN ('org_id','lead_org_id','vendor_org_id')
     AND table_name NOT IN ('organizations','org_members')
   ORDER BY 1,2;   -- expect 0 rows

   SELECT count(*) FROM pg_policies WHERE schemaname='public';
   -- expect the pre-079 number from step 1
   ```

4. **Smoke test the reverted product**: sign in, load the pool, open a project. The site is
   back once these pass.

### The window in each direction

| Direction | What is broken | For how long |
|---|---|---|
| Forward (step 5 -> step 7) | Old code against a renamed database. Total outage. | One deployment, plus however long step 5's verification takes. Minimise by having the branch already built on a preview. |
| Rollback (step 1 -> step 2 above) | Renamed code reverted, database still renamed - then old code against a renamed database until the down migration lands. Total outage. | One deployment plus one migration. Longer than the forward window, because the down migration is bigger than the deploy. |

### If the down migration itself fails

You are past the point this runbook can help. The recovery is a point-in-time restore from
Supabase's backup to just before step 5. Know before you start where that button is and what
your retention window is - check it during step 0, not now.

### What rollback does NOT undo

- **Rows written between step 7 and the rollback.** An organization created by
  `handle_new_user` while 079 was live has an id belonging to no user. The down migration's
  own header states its limits; read them before you need them.
- **Emails already sent.** Steps 8.4 and 8.8 send real mail to real people.
