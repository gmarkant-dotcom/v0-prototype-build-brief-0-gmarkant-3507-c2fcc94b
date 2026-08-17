# Migration 079 authoring report

Run date **2026-08-17**. Branch `main`. Six local commits, **nothing pushed**. No migration
applied, no write query executed, no column renamed in application code. `main` builds and is
deployable at every one of the six commits.

---

## Before you apply anything

Three things, and the first one is the whole run.

### 1. 079 and the code rename are one release. Neither ships alone.

`supabase/migrations/079_organizations.sql` renames 30 columns. The moment it commits, every
application query naming `agency_id` or `partner_id` returns `42703 column does not exist`.
That is **707 references across 103 files**, measured today. There is no partial failure and
no grace period: the dashboard, the vendor pool, the RFP wizard, the bid flow and the whole
vendor portal stop working on the first request after `COMMIT`.

So this run **authored** the migration and **planned** the rename, and renamed nothing.
`docs/079-rename-plan.md` is the plan. It has to be executed, reviewed and deployed to a
preview before 079 is applied, and then the two are promoted together behind a short outage.

**There is a non-obvious dependency inside the plan that changes how long it takes.** The
discovery document assumed `npx tsc --noEmit` would verify the rename exhaustively. It will
not. `lib/supabase/client.ts` and `lib/supabase/server.ts` construct their clients without
generated `Database` types, so `.eq("agency_id", …)` is an untyped string and the compiler
exits 0 whether the column exists or not. The rename needs a grep guard and a policy audit
built for it, both specified in section 8 of the plan. Budget for that.

### 2. Capture a fresh `pg_policies` snapshot immediately before applying.

079 drops **83 policies by their live name**, every one copied from
`docs/schema-snapshot-2026-08-13.md`. Fifteen of those names exist in production and nowhere
in this repository under any spelling. If the live set has drifted since 13 August, a `DROP`
written from that snapshot matches nothing, reports success, and leaves the old policy live
beside whatever 079 creates. That is the exact mechanism that produced the three overlapping
`payment_milestones` partner SELECT policies now in production.

The capture query, split so Supabase's silent 100-row truncation is detectable, is in the
header of 079. `079_organizations_down.sql` must then be **regenerated** from that capture:
the version in the repo is a template written from the August snapshot, and its header says
so twice.

### 3. The release order

1. **Apply the seven per-account role corrections** from `docs/m1-prework-report.md` Item
   1.6. This is a precondition, not housekeeping - see the capability section below.
2. Capture `pg_policies`. Commit it as `docs/schema-snapshot-<date>.md`.
3. Also capture the FK constraint names and the identity-column nullability, both queries in
   the down migration's header. Neither is recoverable afterwards.
4. Regenerate `079_organizations_down.sql` from the step-2 capture.
5. Execute the code rename per `docs/079-rename-plan.md`. Deploy it to a **preview**.
6. Maintenance window, or accept a short outage.
7. Run 079. Expect "Success. No rows returned".
8. Run its verification block. Every count must match.
9. Promote the renamed code.
10. Walk the live checklist in section 10 of the rename plan.
11. Re-take `pg_policies` and commit it as the new authoritative snapshot.
12. Update the migrations table in `LIGAMENT_CONTEXT.md`.

Also, before step 7: **run the storage-policy query in verification note 11 of 079.** It is
the one thing this run could not check at all. See "Storage policies" below.

---

## Capability derivation: the distribution, the rule, and the ruling you owe

### The measured distribution

Read-only against production today, all 16 live profiles:

| Rule | Lead only | Vendor only | Both | Neither |
|---|---:|---:|---:|---:|
| **A** `profiles.role` only | **12** | **4** | 0 | 0 |
| **B** `role` OR `secondary_role` | 0 | 2 | **14** | 0 |
| **A'** signup metadata role, falling back to `profiles.role` | 5 | 11 | 0 | 0 |

Rule B is exactly the failure the brief predicted: 078 writes `secondary_role` as the
opposite of the chosen role for every signup, so 14 of 16 organizations come out as both and
the flag stops meaning anything.

A fourth, purely observational cross-check, from which ids actually appear in company
columns anywhere in the schema: **4 organizations have lead-agency rows, 5 have vendor rows,
2 have both, and 9 have neither.** Nine organizations with no capability at all is not
usable as a derivation rule, but it is useful evidence: the two that genuinely operate both
sides are `gmarkant+partner23@gmail.com` and `gmarkant+partner70@gmail.com`.

### The rule 079 uses, and why

**079 uses Rule A**, expressed as `(role IS DISTINCT FROM 'partner')` for `is_lead_agency`
and `(role = 'partner')` for `is_vendor`. Three reasons, in order:

1. It is the only one of the three that reads a column the product actually maintains and
   that the admin panel actually displays.
2. It produces a meaningful split rather than marking 14 of 16 as both.
3. It is character-for-character the expression migration 078 uses to decide the role at
   signup, so the backfill and the trigger cannot drift apart.

### The problem with Rule A, and the ruling you owe

**`profiles.role` is wrong for seven of the sixteen live accounts.** They chose `partner` on
the signup form and carry `role = 'agency'`, because the pre-078 trigger hardcoded it. That
is the entire gap between Rule A and Rule A'. Confirmed today by joining `public.profiles` to
the GoTrue admin API:

| Email | Stored `role` | Signup metadata role |
|---|---|---|
| `mariannafayn@gmail.com` | agency | **partner** |
| `victoriacaro91@gmail.com` | agency | **partner** |
| `andrea@crescestudio.com` | agency | **partner** |
| `gmarkant+partner23@gmail.com` | agency | **partner** |
| `marcusliwag@gmail.com` | agency | **partner** |
| `info@ceoofgeo.com` | agency | **partner** |
| `gmarkant+partner70@gmail.com` | agency | **partner** |

These are the same seven `docs/m1-prework-report.md` Item 1.6 provides UPDATE statements
for, and **the backfill has not been run.** Applying 079 first stamps seven organizations as
lead agencies that are vendors.

**This is a data-quality fault, not a lockout.** No policy in 079 reads the capability flags.
That is deliberate and is stated in a column comment: access is decided by membership and
only by membership, precisely so that a wrong flag cannot lock anybody out of their own data.
But it is wrong data written into a brand-new table on day one, and fixing it later is
another migration.

**What I need from you:** either run the seven corrections before 079 (recommended, and it
is step 1 of the release order), or rule for Rule A'. 079 carries the Rule A' expression
commented out immediately beneath the Rule A one, reading
`auth.users.raw_user_meta_data->>'role'` directly, so switching is a two-line edit.

I used Rule A and flagged it rather than quietly picking, which is what the brief asked for.

---

## The two parity checks

Both were run. Both pass, and one of them passes more cleanly than the backfill needed.

### Does every auth user have a profile row?

**Yes. 16 of 16, and no orphans in the other direction either.**

```
auth.users (GoTrue admin listUsers):  16
public.profiles:                      16
auth users with NO profile row:        0
profiles with NO auth user:            0
```

**What it means for the backfill.** The backfill inserts one organization per row of
`public.profiles`. The worry was that the auth callback exists precisely because the trigger
does not always fire, so an auth user with no profile would silently get no organization and
be locked out by deny-by-default. That cannot happen today: the two tables are in exact
correspondence. The check should be re-run immediately before applying, because it is a fact
about the data and not about the schema.

### Does every profile have a non-empty `company_name`?

**Yes. 16 of 16 non-empty. Zero null, zero empty string.** Sixteen distinct company names,
zero collisions, so it is one organization per profile with no merge decision - which
independently confirms the A9 result the brief relied on.

**What it means for the backfill.** The fallback chain in 079 fires zero times today. It
still exists, because 078 writes `COALESCE(raw_user_meta_data->>'company_name', '')` and a
signup between now and apply can carry an empty string, and `organizations.name` is
`NOT NULL`. The rule, used identically in the backfill and in the trigger:

```
company_name, else full_name, else the local part of the email, else 'Untitled organization'
```

---

## What 079 creates, renames and rewrites

### Creates

- `public.organizations` - `id` defaulting to `gen_random_uuid()`, `name NOT NULL`,
  `is_lead_agency`, `is_vendor`, a `CHECK` that at least one is true, timestamps, and a table
  comment stating that the id-equals-user-id property is historical and must never be relied
  upon.
- `public.org_members` - `org_id`, `user_id` referencing `profiles(id)`,
  `role CHECK IN ('owner','admin','member')`, `invited_by`, `UNIQUE(org_id, user_id)`. The
  composite key rather than `UNIQUE(user_id)`, because dual-role accounts already exist.
- **Four** no-parameter `SECURITY DEFINER STABLE` helpers, all `SET search_path = public,
  pg_temp`, all `REVOKE EXECUTE FROM PUBLIC` then `GRANT EXECUTE TO authenticated`:
  `current_user_org_ids()`, `current_user_admin_org_ids()`,
  `current_user_visible_profile_ids()`, `current_user_active_counterparty_user_ids()`.

The brief specified one function. **Three more were needed and each has a reason**, given in
the judgment calls below.

### Backfills

16 organizations, 16 owner memberships, **zero UPDATEs** to any of the 312 referencing rows.

### Renames: 30 columns across 23 tables

| Shape | Rule | Tables |
|---|---|---:|
| One company column | `agency_id` becomes `org_id` | 15 |
| Two company columns | `agency_id` becomes `lead_org_id`, `partner_id` becomes `vendor_org_id` | 7 |
| Vendor side only | `partner_id` becomes `vendor_org_id` | 1 |

**A discrepancy with the brief worth stating.** The brief named `partnerships` and
`partner_vouches` as the two-column cases. **The live schema has seven.** The other five are
`agency_partner_invitations`, `partner_access_requests`, `partner_rfp_inbox`,
`partner_rfp_response_versions` and `partner_rfp_responses`. I applied the stated rule to all
seven, because it is the only reading under which "org_id is impossible there" stays true and
because the two-name convention is what makes the compile-time sweep legible. Flagged rather
than assumed.

### Other structural changes

- **Foreign keys**: all 30 columns repointed from `profiles`/`auth.users` to
  `organizations(id)`. This is not optional - organizations created after 079 have ids
  belonging to no user, so a surviving FK to `profiles` would reject every write they make.
  Done in a `DO` block that reads the existing constraint name and `ON DELETE` action from
  `pg_constraint` and re-applies the action unchanged, because the repository does not know
  the names and a guessed `DROP CONSTRAINT` aborts the transaction. The seven tables that had
  no FK at all get one.
- **NOT NULL** on 23 columns: all 15 `org_id`, all 7 `lead_org_id`, and
  `partner_vouches.vendor_org_id`.
- **Indexes**: `org_members(user_id, org_id)`, `org_members(org_id, role)`, and one on every
  renamed column, created through a `DO` block that skips any column already led by an
  existing index rather than duplicating it.

### Policy counts per bucket

| Bucket | Definition | Live | 079 drops | 079 creates |
|---|---|---:|---:|---:|
| (a) | keyed on `agency_id`/`partner_id` = `auth.uid()` | 49 | **49** | **49** |
| (b) | relationship-scoped through a parent table | 34 | **34** | **32** |
| (c) | user-scoped on `user_id`/`sender_id`/`uploaded_by` | 15 | 0 | 0 |
| (d) | identity-independent | 3 | 0 | 0 |
| (U) | matched on an email address | 3 | 0 | 0 |
| new | `organizations` and `org_members` | - | - | **5** |
| | **Total** | **104** | **83** | **86** |

Live policy count afterwards: **107**.

(b) creates two fewer than it drops because the three `profiles` SELECT policies fold into
one. Permissive policies of the same command OR together, so
`Users can view profiles of partnership members` was already the union of the other two; the
folded predicate is a strict superset of that union, adding exactly one thing - colleagues in
your own organization, which is the point of M1. The down migration restores all three.

**Nine policies narrow from `TO public` to `TO authenticated`**: the five on
`agency_partner_invitations`, both on `partner_vouches`,
`partnerships / Partners can claim partnership by email`, and
`rfp_magic_tokens / Agency can manage their own tokens`. This is forced: `EXECUTE` on the
helpers is revoked from `PUBLIC`, so an anon caller hitting a `TO public` policy that calls
one would get `permission denied for function` rather than an empty result. It has no
behavioural effect - `auth.uid()` is NULL for anon, so all nine already matched zero anon
rows.

### Extends `handle_new_user`

Everything the current live (post-078) function does is preserved verbatim: the
`SET search_path = public, pg_temp` pin, the read of `raw_user_meta_data->>'role'` with the
fallback to `'agency'`, the opposite-role derivation for `secondary_role`, the
`ON CONFLICT (id) DO UPDATE` clause with the three role columns deliberately absent from its
update list, and the deliberate absence of `is_paid`, `is_admin`, `demo_access` and any email
literal.

Added: the organization and the owner membership row, guarded by `IF NOT EXISTS` so a
re-fired trigger is idempotent the same way the profile insert already is, and with the
organization getting `gen_random_uuid()` rather than `NEW.id`.

**One honesty note.** The brief said to read the current live function body before touching
it. I could not: PostgREST cannot reach `pg_catalog`, there is no `psql` on this machine, no
Postgres driver is a project dependency, and `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` and
`POSTGRES_PASSWORD` are all empty in `.env.production.local`. **I used
`supabase/migrations/078_signup_role_trigger.sql` as the live body**, on the stated basis
that 078 is applied and verified in production. 079's header carries the `pg_get_functiondef`
query and instructs a diff before applying: everything above the "Organization and owner
membership" comment must match.

---

## Storage policies: not checked, and not checkable from here

**No storage policy SQL exists anywhere in this repository.** Grepped repo-wide across
`*.sql`, `*.SKIP`, `*.ts`, `*.tsx` and `*.md` for `storage.objects`, `storage.buckets`,
`bucket_id` and `CREATE POLICY … storage`: the only two hits are prose lines in
`docs/schema-truth.md` and `docs/schema-truth-and-m1-prep-report.md` noting that the
`avatars` bucket has policies in `storage.objects` and that they are unreconciled.

`pg_policies` for `schemaname = 'storage'` is not reachable through PostgREST, so **I could
not determine whether any storage policy references `agency_id` or `partner_id`.** I am not
going to claim otherwise.

This is a live gap, not a formality: `app/api/upload/route.ts` routes avatars, logos,
`agency-logos` and `partner-logos` to Supabase Storage, so a storage policy that joins a
public table on `agency_id` is entirely plausible. Verification note 11 in 079 carries the
query. **Run it before applying, read every predicate for the four column names, and add a
matching rewrite to 079 for any hit.**

---

## What I could not classify with certainty

Flagged rather than guessed.

1. **The three bucket (U) policies.** They match an email address against the caller's own
   profile email. None names `agency_id` or `partner_id`, so all three survive the rename
   intact and 079 leaves them exactly as they are. But they still need a product ruling,
   because an organization does not have one email address:
   - `invitation_requests / Agencies can view requests to their email` (SELECT)
   - `invitation_requests / Agencies can update requests to their email` (UPDATE, grants write)
   - `partner_rfp_inbox / Partners select inbox rows by recipient email` (SELECT, the
     ghost/unclaimed vendor path)

   The question for the first two: a vendor requests access by typing a lead agency's email
   address; once that agency has several members, whose mailbox counts? For the third: may a
   colleague at a vendor read an RFP addressed to a coworker's mailbox? Three further
   policies carry an email disjunct beside an id predicate and will inherit whatever ruling
   these get - both `agency_partner_invitations` partner policies and
   `partner_rfp_inbox / Partners update own inbox rows`.

2. **`profiles.linked_agency_id`.** It exists on the live table and **zero of the sixteen
   profiles carry a value**. It is read by `contexts/paid-user-context.tsx` and, per grep,
   never written. 079 does not touch it. It looks like a vestige of a half-built organization
   concept and it is now a trap: a future reader will assume it means what `org_id` means.
   Worth dropping on its own schedule, and worth not bundling into 079.

3. **`partner_rfp_response_versions.vendor_org_id` nullability.** Six rows, zero nulls, so
   the data permits `NOT NULL`. I left it nullable anyway, because its parent
   `partner_rfp_responses.vendor_org_id` is nullable for guest bids (7 of 17 rows are null)
   and a `NOT NULL` child would reject the first guest version write. That is a judgment
   about a future write path, not a measurement, and it is the one nullability decision in
   079 I am least sure of.

4. **Which FK `ON DELETE` action the seven no-FK tables should get.** 079 chooses `CASCADE`
   for `NOT NULL` columns and `SET NULL` for nullable ones. Nothing in the repository records
   an intent, because no FK ever existed.

5. **Three measurements in the brief disagree with the live database today.** Not a
   criticism of the brief - the data moved - but the migration is written to what I measured:

   | The brief said | Measured 2026-08-17 |
   |---|---|
   | 16 `partnerships` rows have a null `partner_id` | **27 of 31**, and every one of the 27 carries a `partner_email` |
   | 196 referencing rows | **312** - 211 with `agency_id`, 101 with `partner_id` |
   | 15 accounts (from the pre-work) | **16**; `gmarkant+partner63@gmail.com` signed up today |

   The direction of the first two is the same: the backfill is inserts-only either way, and
   `vendor_org_id` must be nullable either way. Re-measure before applying.

---

## The down migration's honest limits

`supabase/migrations/079_organizations_down.sql`, authored and not applied. Its header lists
ten things it cannot restore. The three that decide whether it is usable at all:

- **Any organization created after 079 is destroyed**, along with every row referencing it,
  by `DROP TABLE organizations CASCADE`. The header carries the `SELECT` that finds them. If
  it returns a row, the rollback needs a bespoke plan that re-parents those rows first, and
  that plan is not this file. **The window in which this file is safe is the window in which
  nobody has signed up.**
- **Any multi-member organization silently loses everyone who is not the founder.** The
  restored predicates are `agency_id = auth.uid()`, so a colleague whose uid is not the
  organization id simply stops seeing anything. No error, no log. The header carries that
  `SELECT` too.
- **It is written from the August snapshot and must be regenerated** from the fresh capture.
  Fifteen of the policies it restores exist only in production, so a stale template restores
  the August rule rather than the rule that was live.

Also lost: `org_members.role`, the capability flags, the original FK constraint names and
`ON DELETE` actions, the pre-079 nullability of the identity columns, and the FKs on the
seven tables that had none. And one restoration is a deliberate regression, called out in the
file: `partnerships / Agencies can update their partnerships` comes back with `USING` and no
`WITH CHECK`, exactly as it is live, which reopens the hole that lets an agency rewrite
`agency_id` to somebody else's. 079 closes that hole while rewriting the predicate anyway;
restoring verbatim means restoring the hole.

Symmetry was checked mechanically: 079 drops 83 policies and creates 86; the down migration
drops those 86 and recreates those 83, with nothing unaccounted for in either direction.

Neither file has ever been parsed by a Postgres server.

---

## The rename plan, headline numbers

`docs/079-rename-plan.md`.

| | |
|---|---:|
| Source references to a renamed column | **707** |
| Files containing at least one | **103** |
| Become `org_id` | 168 |
| Become `lead_org_id` | 158 |
| Become `vendor_org_id` | 207 |
| **Need a human read** | **174** |
| Service-role routes that bypass RLS | 24, plus one `lib/` helper |
| `lib/` choke points taking an `agencyId` parameter | 7 |
| Email-resolution sites that break under an org model | 11, **ten of them silently** |

The 174 are listed individually with the reason: 46 are comments, 46 have no query context
(local type declarations and destructured locals), and 82 have a nearest `.from()` that
resolves to a table carrying neither column, meaning the value arrived through a join and the
property name still has to change because PostgREST returns the renamed key.

The eleven email sites all resolve `profiles.email WHERE id = <a company id>`. They keep
working for every organization 079 backfills, because those ids equal the founding user's id,
and return nothing for every organization created afterwards. Ten use `.maybeSingle()` behind
an `if (recipientEmail)` guard, so the send is skipped with no log line. One
(`app/api/projects/[id]/onboarding-packages/route.ts:317`) uses `.single()` and writes a
`console.error`, which is the only one that leaves a trace.

The recommended sequence is six commits. The load-bearing one is commit 3, which routes every
company-identity read through a resolver **while still naming `agency_id`** - `.in()` with a
one-element array is exactly `.eq()`, so it is a no-op at runtime and it reduces commit 5 to a
find-and-replace a grep can verify. Doing the rename without it means writing the membership
resolution and the substitution in the same 707-line diff, which nobody can review.

---

## The three contained fixes

### 4a. `scripts/007` and `scripts/009` are now `.SKIP`

Both contained a full `CREATE OR REPLACE FUNCTION public.handle_new_user()`. Running either
silently reverts 078: it reinstates the hardcoded `greg@withligament.com` comparisons, drops
the `search_path` pin, stops reading `raw_user_meta_data->>'role'`, and writes `is_paid`,
`is_admin` and `demo_access` at signup again. **009 is worse than 007**: it also adds
`profiles.email_verified` and then writes to it, plus a second trigger to keep it in sync -
and because it adds the column first, it would not fail loudly. It would just create a dead
column and start filling it.

The stake is higher after 079, which extends the same function again. Anything overwriting
`handle_new_user` after 079 destroys the organization and owner-membership insert, and every
subsequent signup lands with no organization, no membership, and deny-by-default locking them
out of their own data. Both headers say so.

Renamed following the existing `scripts/029-msa-payments.SKIP` convention, each with a header
naming the exact lines. **Grepped repo-wide first: no code references either file.** The only
references were `docs/schema-truth.md` and `docs/schema-baseline-2026-08-13.sql`, which cite
009 as the on-disk ancestor of five live policies; those citations are updated to the new
filename with their line numbers shifted by the 32-line header. The dated historical reports
that also name these files are deliberately left alone, since they correctly describe the
state at the time they were written.

### 4b. The admin flag toggle writes `updated_at`

`app/api/admin/users/[userId]/flags/route.ts` now stamps `profiles.updated_at` on every flag
change. It is the only column added, and it is generated server-side, so the allow-list
invariant ("the request body is never spread into the update") is intact.

Measured today: **twelve of the sixteen live profiles carry `updated_at` equal to
`created_at`**, and four differ. That is exactly the signal this preserves - a differing
value becomes evidence that somebody decided something, which is what a read-only census
could not tell before.

`profiles.updated_at` was confirmed to exist by a live zero-row planner probe, and no profile
carries a null in it.

### 4c. The paid status toggle is missing for vendors. REPORT ONLY, and it is an oversight.

**What the interface actually does**, read from `app/admin/users/page.tsx`:

| Column | Condition | Behaviour |
|---|---|---|
| Paid Status (line 310) | `user.role === 'agency'` | Toggle. Renders a literal `-` for any other role |
| Actions (line 363) | `user.role === 'partner'` | A **Grant** button calling `setFlags(userId, { is_paid: true })`, `disabled` once `is_paid` is true, showing "Granted" |
| Summary stat (line 145) | `role === "agency" && !is_paid` | The "restricted" count. A restricted vendor is invisible in it |

**The finding: this is not "vendors are free by design". It is a one-way door.**

If vendors were free by design there would be no Grant button. Its existence proves `is_paid`
is meaningful for a vendor account. What is missing is the other direction: a vendor can be
granted `is_paid` from the panel and can never have it taken away, which is why you had to
use SQL.

**What `is_paid` actually gates for a vendor account**, traced through `lib/entitlements.ts`
as it stands after the pre-work run:

- `canUploadFiles()` returns true for anyone `actingRole()` resolves to `partner`, with no
  billing test. That is the deliberate "vendors upload free" branch and its comment says so.
  `is_paid` decides nothing here.
- `canUseAgencyAi()` and `hasAgencyEntitlement()` do read it. A vendor-primary account
  reaches those the moment it switches portals, and **it can**: 078 grants
  `secondary_role = 'agency'` to every vendor signup, and `POST /api/profile/switch-role`
  admits anyone with `'agency'` in either column.

So `is_paid` on a vendor account is not decorative. It gates the agency-portal AI and
entitlement surfaces that every vendor can reach through the portal switcher. **That is the
capability you could not restrict from the interface.**

**What changing it would affect.** Rendering the toggle for every role, not just `agency`:

- The only functional change is that `is_paid` becomes clearable for a vendor account. The
  grant direction already works.
- It touches no route. `PATCH /api/admin/users/[userId]/flags` already accepts `is_paid` for
  any user id; only the interface withholds it.
- The Grant button in the Actions column becomes redundant and should be removed in the same
  change, or the two controls will disagree about the same column.
- The "restricted" summary stat should drop its `role === "agency"` clause, or a restricted
  vendor stays invisible in the count.
- **The behavioural consequence to decide:** a vendor with `is_paid = false` loses agency-
  portal AI and entitlement. It does not lose anything on the vendor side, because
  `canUploadFiles()` never consulted `is_paid` for a vendor. So the blast radius is smaller
  than it looks, and it is exactly the restriction the toggle claims to apply.

**This needs a ruling, not a guess, and it interacts with 079.** Under the ruled model,
entitlement moves onto the organization and `profiles.is_paid` stops being the answer at all.
If the toggle is fixed now it is fixed twice. My recommendation is to **rule now and build
once**: decide that entitlement is per organization and that the admin panel toggles the
organization's entitlement rather than a person's flag, and let 079's follow-up do it. If a
vendor needs restricting before then, the SQL you already used is the right stopgap.

I did not change any of it, per the brief.

---

## Judgment calls taken

1. **Applied the two-column naming rule to all seven two-column tables**, not just the two
   the brief named. `org_id` is genuinely impossible on a table naming both sides, and the
   explicit names are what make the sweep legible. Flagged above.
2. **`invitation_requests.partner_id` becomes `vendor_org_id`, not `org_id`.** The literal
   rule says "tables with one company column: `agency_id` becomes `org_id`", and this table
   has no `agency_id` at all - it pairs `partner_id` with `agency_email`. `org_id` there
   would not say which side. Zero rows, one caller.
3. **New organizations get `gen_random_uuid()`, not `NEW.id`.** The id-equals-uid property is
   a historical fact about the sixteen backfilled rows and nothing may rely on it. This is
   defusal 3 from the discovery document, and it is what forces the FK repoint.
4. **Repointed all 30 foreign keys to `organizations(id)`.** Not in the brief, and not
   optional: an organization created after 079 has an id belonging to no user, so a surviving
   FK to `profiles(id)` would reject every write it makes. Done by reading `pg_constraint`
   rather than guessing constraint names, and re-applying the existing `ON DELETE` action
   unchanged rather than silently normalising it.
5. **Three helper functions beyond the one the brief specified.** Each has a reason and none
   takes a parameter:
   - `current_user_admin_org_ids()` - the brief requires org_members writes restricted to
     admins "of that organization, verified through the same function", but
     `current_user_org_ids()` carries no role. Verifying admin-ness by subquerying
     `org_members` from a policy is the recursion the brief forbids.
   - `current_user_visible_profile_ids()` - the three `profiles` policies map a user id to an
     organization, and doing that with a `JOIN org_members` inside a policy would be filtered
     by `org_members`' own self-row-only policy and silently return nothing for every
     colleague.
   - `current_user_active_counterparty_user_ids()` - same problem for
     `notifications / Scoped insert notifications`, and it is separate from the one above
     solely to preserve that policy's `status = 'active'` condition rather than quietly
     widening who may be notified.
6. **Folded the three `profiles` SELECT policies into one.** They are three names for a union
   that permissive policies already computed. The folded predicate is a strict superset. The
   down migration restores all three.
7. **Kept every policy name identical to its live name**, even
   `partner_rfp_inbox / "Partners select inbox rows by partner_id"`, which now names a column
   that does not exist. Renaming it would make the down migration asymmetric and make the
   post-apply `pg_policies` diff harder to read. It is a one-line follow-up.
8. **Added a `WITH CHECK` to `partnerships / Agencies can update their partnerships`.** The
   live policy has `USING` only, which lets an agency rewrite the row's owner to somebody
   else. The predicate was being rewritten anyway.
9. **Did not consolidate the three duplicate `payment_milestones` partner SELECT policies.**
   All three are recreated. Consolidating is a separate, reviewable change, and doing it
   inside a migration this large is how a quiet access loss ships. They OR together, so three
   is harmless.
10. **Left every `vendor_org_id` nullable except `partner_vouches`.** Nullability on the
    vendor side is the pre-claim design, not a data-quality accident, and the brief's "NOT
    NULL wherever the data permits" would break the ghost, guest and unclaimed paths if
    applied to it. `partner_vouches` is the exception because a vouch always names a real
    vendor and 053 declared it `NOT NULL`.
11. **Nine policies narrowed from `TO public` to `TO authenticated`.** Forced by
    `REVOKE EXECUTE … FROM PUBLIC`, which the brief mandates. No behavioural effect.
12. **Did not fix the two unscoped INSERT policies** on `project_documents` and
    `project_messages`, which let any authenticated user insert against any project id. They
    are real and they are not an organizations problem. Fixing them inside 079 would hide
    them.
13. **Updated the 009 citations in `docs/schema-truth.md` and
    `docs/schema-baseline-2026-08-13.sql`** after the `.SKIP` rename, including the 32-line
    offset. Left the dated historical reports alone. Completing a rename is not refactoring
    beyond the item; rewriting history would be.
14. **Elided an em dash from one quoted source line** in the rename plan census. The line is
    `app/api/agency/rfp-responses/route.ts:38`, a code comment that carries one. A small
    pre-existing violation, noted here rather than fixed, because fixing it was not asked for.

---

## Not done, and why

- **No migration applied. No write query executed.** Everything against production this run
  was `SELECT` through PostgREST under the service role, or the GoTrue admin `listUsers`
  read.
- **No column renamed in application code.** That is the whole coupling this run exists to
  respect.
- **`org_invitations` not created**, and no membership interface built. Phase two, and the
  table should land with the feature.
- **`profiles.role`, `active_role`, `is_paid`, `is_admin` and `demo_access` untouched
  everywhere.** `lib/acting-role.ts` survives M1 unchanged as the view toggle.
- **Migration 078 untouched.**
- **The live `handle_new_user` body was not read from `pg_proc`.** No route to
  `pg_catalog` from here. 078's file was used as the live body, on the basis that 078 is
  applied and verified; the diff query is in 079's header.
- **Storage policies not checked.** Not reachable. The query is in 079.
- **The seven role corrections not run.** They are Greg's, per account, and they are step 1
  of the release order.
- **No email sent, no invitation triggered, no admin flag written.** Item 4b changes the
  route; it was not fired, because firing it writes to a real account.
- **`pnpm lint` not re-run.** It exited 1 with 178 pre-existing problems at the pre-work run
  and nothing in this run creates a new lint surface: five of the six commits are SQL and
  markdown, and the sixth is a three-line change inside an existing function.
- **Nothing pushed.** Six local commits on `main`.

---

## Honest verification statement

### Executed from this terminal, results observed

| Check | How | Result |
|---|---|---|
| `npx tsc --noEmit` | before each of the six commits | exit **0** every time |
| `pnpm build` | before each of the six commits | exit **0** every time |
| Markdown link corruption grep | `grep -rl "](http://" app/` | no matches |
| Every profile: id, email, company_name, role, active_role, secondary_role, is_paid, is_admin, created_at, updated_at | `SELECT` via the service role, with the PostgREST exact count compared against rows returned to detect truncation | 16 rows, count agrees, **no truncation** |
| Signup metadata role for all 16 | GoTrue admin `listUsers` | 7 mismatches against `profiles.role` |
| Parity: auth users versus profiles | set difference both directions | 16 = 16, **zero missing, zero orphaned** |
| Parity: non-empty `company_name` | per-row inspection of all 16 | **0 null, 0 empty, 16 non-empty** |
| Company name collisions | group by lowercased trimmed name | 16 distinct, **0 collisions** |
| Capability distribution under Rules A, B and A' | computed over all 16 profiles | table above |
| Which tables carry `agency_id`, `partner_id`, `voucher_agency_id`, `vouched_partner_id`, `linked_agency_id`, `domain_match_profile_id`, `partnership_id` | zero-row planner probe per (table, column), the same technique recorded in `docs/078-amendment-note.md` | `agency_id` on **21**, `partner_id` on **7**, 6 tables carry both |
| Row counts and null counts on every identity column | `count(exact, head)` plus `.is(col, null)` per column | 211 `agency_id` rows / 0 nulls; 101 `partner_id` rows / 42 nulls |
| Orphan check: every non-null identity value resolves to a profile | full value read per column, set membership against the 16 profile ids | **zero orphans on all 30 columns** |
| Distinct identity values referenced anywhere | union across all 21 + 7 tables | 4 distinct `agency_id`, 5 distinct `partner_id`, 2 accounts on both sides |
| `partnerships` shape | all 31 rows read, count agrees | 27 `partner_id` NULL, **all 27 carry a `partner_email`** |
| `organizations`, `org_members`, `org_invitations` do not exist | zero-row probe | `PGRST205` on all three |
| `profiles.updated_at` exists, and its distribution | zero-row probe plus per-row read | exists, 0 null, 12 equal to `created_at`, 4 differ |
| `profiles.linked_agency_id` exists, and is empty | zero-row probe plus per-row read | exists, **0 of 16 non-null** |
| Repo-wide grep for storage policy SQL | `*.sql`, `*.SKIP`, `*.ts`, `*.tsx`, `*.md` | **zero policy definitions**, two prose mentions |
| Nothing references `scripts/007` or `scripts/009` from code | repo-wide grep before renaming | confirmed, docs only |
| Supabase clients are constructed without generated types | read `lib/supabase/client.ts`, `lib/supabase/server.ts`, searched for a `Database` type | **no generated types anywhere** |
| The 707-reference census | script over `app/`, `lib/`, `components/`, `contexts/`, `hooks/`, `middleware.ts` | 707 records, 103 files |
| The 24 service-role routes | `grep -rln SUPABASE_SERVICE_ROLE_KEY app/ lib/` | 24 routes plus `lib/server/account-existence.ts` |
| The 11 email-resolution sites, and which send mail | grep for `profiles` selects keyed on a company id, cross-referenced against files calling `sendTransactionalEmail` / `notify*` | **exactly 11 send**, 4 more resolve display names only |
| Which of the 11 fail silently | read the surrounding code in each | **10 use `.maybeSingle()` behind a guard, 1 uses `.single()` and logs** |
| Up/down policy symmetry | parsed both files, compared the sets | 83 dropped / 86 created up; 86 dropped / 83 created down; nothing unaccounted for |
| No em dashes in anything this run wrote | grep across all six commits | zero |

### NOT executed. Claims that rest on reading, not running

- **Neither 079 nor its down migration has ever been run**, locally or anywhere. Neither has
  been parsed by a Postgres server. There is no local database in this project and no staging
  environment in this repository. Every claim about what they do is a claim about what the
  SQL says.
- **The live body of `handle_new_user` was not read.** `pg_catalog` is unreachable from here.
  078's committed file was used as the live body on the stated basis that 078 is applied and
  verified. If it was applied with any edit, 079's extension is built on the wrong base. The
  diff query is in 079's header.
- **Storage policies were not queried.** Whether any references `agency_id` or `partner_id`
  is **unknown**, not "none".
- **`information_schema` was not reachable**, so column nullability, types, defaults, index
  definitions and foreign key constraint names are all unread. Everything 079 does with them
  is done through `pg_constraint` and `pg_index` lookups at runtime, precisely because this
  run could not read them ahead of time. The "zero nulls" claims are counts of live data, not
  readings of the column declaration.
- **`pg_policies` was not re-queried.** Every policy name and predicate in 079 and its down
  migration comes from `docs/schema-snapshot-2026-08-13.md`, which is five days old at time
  of writing.
- **The census heuristic is a heuristic.** 533 of the 707 references were attributed to a
  table by explicit qualification, an embedded selector, or the nearest preceding `.from()`.
  The third is wrong wherever a query joins across tables. The 174 in the needs-a-human-read
  bucket are the ones where it could not decide; it does not follow that the other 533 are
  all correct.
- **The 4c analysis of what `is_paid` gates for a vendor** is traced by reading
  `lib/entitlements.ts`, `lib/acting-role.ts`, `app/admin/users/page.tsx` and
  `app/api/profile/switch-role/route.ts`. **No account was signed into and no portal switch
  was performed.** The claim that a vendor can reach the agency portal rests on 078 writing
  `secondary_role = 'agency'` and on switch-role's OR test, both read from source.
- **Item 4b was not exercised.** The route was not called; calling it writes to a real
  account. That `profiles.updated_at` exists and is writable is established by a read-only
  probe and by the column being in the live table, not by a successful write.
- **No email was sent and no invitation triggered.** Nothing in this run touched a mail path.
- **The rename plan's commit sequence has not been executed**, and the two verification
  mechanisms in its section 8 are specified, not built. The `org_policy_audit()` function is
  SQL in a document; it has never been created.

---

## Commits, in order

| Commit | Item | Subject |
|---|---|---|
| `1c30617` | 1 | `feat: author migration 079, the organizations identity migration` |
| `8493bbd` | 2 | `feat: author the 079 down migration` |
| `177c64e` | 3 | `docs: the 079 rename plan, and the safety net the compiler cannot be` |
| `06b8d61` | 4a | `chore: mark scripts 007 and 009 .SKIP, they revert migration 078` |
| `8822aea` | 4b | `fix: the admin flag toggle writes updated_at` |
| this one | - | `docs: 079 authoring report` |

**Nothing pushed.**
