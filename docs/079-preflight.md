# 079 pre-flight

One page. Read it before opening the maintenance window. Then follow
`docs/079-release-runbook.md`.

Written 2026-08-17, second pass, from `feat/079-org-rename` at commit `1f63c04`.

Every answer below carries the evidence and where it came from. Where a check was
**executed from a terminal**, it says so and gives the command. Where the answer rests on
**reading code**, it says that instead. The two are never mixed.

---

## 1. Has this migration ever been executed anywhere, by anything?

# NO.

`supabase/migrations/079_organizations.sql` is 2,062 lines. It has been authored, reviewed
and re-reviewed across four runs. **It has never been parsed by a Postgres server.** Not by
`psql`, not by a driver, not by the Supabase SQL editor, not on a branch database, not on a
scratch database.

**Is a scratch or branch database available? No.** Evidence, executed this run:

```bash
$ grep -oE '^(POSTGRES_URL|POSTGRES_PASSWORD|POSTGRES_URL_NON_POOLING|SUPABASE_JWT_SECRET)=' .env.production.local
POSTGRES_PASSWORD=
POSTGRES_URL=
POSTGRES_URL_NON_POOLING=
SUPABASE_JWT_SECRET=
```

All four keys are **present and empty**. `.env.local` carries `POSTGRES_HOST`,
`POSTGRES_USER` and `POSTGRES_DATABASE` but no password and no URL. There is no `psql` on
this machine and no Postgres driver in `package.json`. The only database credential that
works is the Supabase REST key, and PostgREST cannot execute DDL.

> ### THIS IS THE LARGEST UNMITIGATED RISK IN THE RELEASE.
>
> **If a scratch or branch database can be obtained, running 079 on it is worth more than
> every other check on this page combined.** Not because the logic is doubted - it has been
> read four times - but because none of the reading can catch a syntax error, a typo in a
> policy name, a `DROP POLICY` on a table that does not have it, a function body that does
> not parse, or an ordering fault between phases. All of those abort a transaction
> harmlessly on a scratch database and abort the maintenance window on production.
>
> Supabase offers database branching. **One branch, one paste, ten minutes.** If that is
> available at all, take it.
>
> **If it is not: the release IS the first execution.** 079 is one transaction with its own
> `BEGIN`/`COMMIT`, so a parse or constraint failure rolls back cleanly and costs only the
> window. That is the mitigation, and it is a real one - but it means planning for two or
> three attempts rather than one, and it means the window is "however long it takes",
> not "twenty minutes".

---

## 2. Is every one of the 767 identity-column occurrences resolved?

# YES.

**Executed this run:**

```bash
$ node scripts/check-identity-columns.mjs
Scanned 365 files.
  org_id                 0
  lead_org_id            0
  vendor_org_id          0
  needs-human-read       0
  TOTAL                  0  in 0 files

$ node scripts/check-identity-columns.mjs --guard ; echo $?
0
```

Baseline was **767 occurrences in 105 files** (`docs/079-rename-execution-report.md`, line
144). Zero remain.

**What this does NOT prove**, stated because a green guard is the easiest thing on this page
to over-read: it matches `\bagency_id\b` and its three siblings in source text. It is blind
to constraint names (no word boundary before `partner_id` in
`partnerships_partner_id_fkey`), blind to any query built by string concatenation, and
blind to the right-hand side of a filter - so `.eq('vendor_org_id', user.id)`, an
organization column compared to a user id, passes it cleanly.

---

## 3. Is every embed repointed?

# YES.

**Executed this run:**

```bash
$ node scripts/check-embed-targets.mjs
Repointed (table, column) pairs parsed from 079 PHASE 7: 30
Scanned 365 files.
  REPOINTED      0
  PERSON         0
  TOTAL          0  in 0 files

$ node scripts/check-embed-targets.mjs --guard ; echo $?
0
```

Thirteen embeds were closed in commit `0cf06f5`, plus two more found in the same pass. The
guard parses its truth out of 079 PHASE 7 rather than transcribing it, so it cannot drift
from the migration it checks.

**What this does NOT prove:** that any embed returns data. A to-one embed whose target row
is filtered by row level security comes back as `null` at HTTP 200, not as an error. That is
question 9 below and it is still open.

---

## 4. Are the payload keys renamed, and every consumer traced?

# YES. THE CORRECTED CONSUMER COUNT IS TEN, NOT EIGHT.

The wire keys are `vendor_org` and `lead_org`, matching the foreign keys `vendor_org_id` and
`lead_org_id` that reach them. Fields: `id`, `name`, `contact_user_id`, `contact_email`,
`contact_name`, and the rich trio `contact_capabilities` / `contact_logo_url` /
`contact_created_at`.

**Executed this run:**

```bash
$ grep -rln "vendor_org\b\|lead_org\b" --include="*.ts" --include="*.tsx" app/ components/ contexts/ lib/ | wc -l
21
```

Those 21 files break down as:

| Role | Count | Which |
|---|---:|---|
| Producer routes emitting the shape | 10 | all under `app/api/` |
| **Consumer files reading the shape** | **10** | 6 pages, 3 components, 1 context |
| Shared definition | 1 | `lib/org-contact.ts` |

The original claim in an earlier run was **eight** consumers. The corrected count is **ten**:
`app/agency/msa/page.tsx`, `app/agency/page.tsx`, `app/agency/pool/page.tsx`,
`app/partner/network/page.tsx`, `app/partner/onboarding/page.tsx`,
`app/partner/payments/page.tsx`, `components/marketplace-content.tsx`,
`components/stage-03-onboarding-production.tsx`,
`components/stage-03-onboarding-workflow.tsx`, `contexts/lead-agency-filter-context.tsx`.

A repository-wide sweep for surviving reads of the old keys returns only comments recording
the rewrite, plus genuine `profiles` reads on the marketplace pages (which read discoverable
profiles and are correct), plus three sites in
`app/api/agency/rfp-responses/[id]/route.ts` where the variable is named `partner` but is
sourced from `resolveOrgNotificationRecipients()` and is therefore a real person.

**What this does NOT prove:** TypeScript checked none of it. The Supabase clients are
constructed without generated `Database` types, so every `.select()` argument is an untyped
string and every `row.vendor_org` is a property on an untyped record. **A green `tsc` says
nothing about whether these payloads match.** Each pair was read by hand.

---

## 5. Does 079 drop every affected policy by its LIVE name from the snapshot?

# YES. MECHANICALLY VERIFIED, NOT ASSERTED.

**Executed this run**: every `DROP POLICY "<name>" ON public.<table>` in 079 was parsed out
of the migration and looked up in `docs/schema-snapshot-2026-08-13.md`.

```
DROP POLICY statements in 079:              83
policy rows parsed from the Aug 13 snapshot: 104
DROPs NOT found in the snapshot:              0
duplicate DROP statements:                   []
```

All 83 names exist in the authoritative capture. None is duplicated. **None was taken from a
migration file** - fifteen of them exist in production and nowhere else in this repository,
which is exactly why the on-disk migration history cannot reproduce the live database.

The `DROP POLICY` statements deliberately carry **no `IF EXISTS`**. A name that is not there
must abort the whole transaction, because it means the snapshot is stale.

**The residual risk is drift since Aug 13, and it is real.** Migration 081 replaced two
INSERT policies on 2026-08-17. That is why runbook step 1 re-captures and step 2 regenerates
the down migration. **This check proves 079 matches the Aug 13 capture. It cannot prove the
Aug 13 capture still matches the database.**

---

## 6. Does 079 create the counterparty policy, and does profile visibility call the same helper?

# YES TO BOTH, AND THEY ARE THE SAME PREDICATE BY CONSTRUCTION.

Read from `supabase/migrations/079_organizations.sql`:

- **PHASE 6, line 722** creates `current_user_counterparty_org_ids()` - the organizations on
  the other side of a `partnerships` row involving one of the caller's organizations, in
  either direction, at any status.
- **PHASE 6, line 750** creates `current_user_visible_profile_ids()`, whose body is:

  ```sql
  SELECT m.user_id FROM public.org_members m
  WHERE m.org_id IN (SELECT public.current_user_org_ids())
     OR m.org_id IN (SELECT public.current_user_counterparty_org_ids());
  ```

  It **calls** the counterparty helper. It does not redefine it.
- **PHASE 11, line 1567** creates `"Members read counterparty organizations"` on
  `organizations`, `USING (id IN (SELECT public.current_user_counterparty_org_ids()))`.
- **PHASE 10, line 1562** creates `"Users can view profiles of partnership members"` on
  `profiles`, `USING (id = auth.uid() OR id IN (SELECT public.current_user_visible_profile_ids()))`.

**So the outer hop (organizations) and the nested hop (profiles) resolve through one
function.** They cannot disagree today and they cannot drift apart at the next edit, which
is the whole reason the set was lifted out of the profiles policy into a helper.

**Why only partnerships count as a counterparty:** a `partnerships` row is the only artifact
in this schema recording a two-sided commercial relationship. `partner_access_requests`,
`invitation_requests` and `partner_rfp_inbox` rows are all **unilateral** - one party writes
them alone - so admitting any of them would let a company manufacture visibility of another
by writing a row it already controls.

**The one residual, stated rather than buried:** `"Agencies can create partnerships"`
constrains `lead_org_id` and says nothing about `vendor_org_id`, so a lead agency can insert
a partnership naming any `vendor_org_id` it can guess and add that organization to its own
counterparty set. **That hole is not introduced by 079 - it is live today**, and today it
yields strictly more (a whole `profiles` row) than it will after 079 (a company name, two
booleans and a contact id).

---

## 7. Is `primary_contact_user_id` backfilled, with a query proving zero nulls?

# YES, BY CONSTRUCTION, AND THE QUERY IS IN THE RUNBOOK AT V3.

The backfill (PHASE 2) writes the primary contact **in the same INSERT that creates the
organization**, with no join and no second UPDATE pass:

```sql
INSERT INTO public.organizations (id, name, primary_contact_user_id, ...)
SELECT p.id, COALESCE(...), p.id, ... FROM public.profiles p
```

Under Option C the organization id **is** the founding user's id, so `p.id` is both the
primary key and the contact. This is the one place the id coincidence is legitimately used,
and it is used at backfill time only.

The proof query, runbook step 4.5 V3:

```sql
SELECT count(*) FROM public.organizations WHERE primary_contact_user_id IS NULL;
-- expect 0
```

**A non-zero count means that many vendors render the fallback instead of a contact on day
one.**

The PHASE 12 trigger, for organizations created after the migration, sets
`primary_contact_user_id` **explicitly to `NEW.id`** rather than relying on the coincidence -
because those organizations get `gen_random_uuid()` and their id belongs to no user.

---

## 8. Do the seven role corrections mean the capability flags stamp correctly?

# YES - AND THE EXPECTED RESULT IN THE MIGRATION WAS STALE. IT IS NOW CORRECTED.

The seven mis-roled accounts chose `partner` on the signup form and carried `role='agency'`
because the pre-078 trigger hardcoded it. They were corrected on 2026-08-17 and now read
`role='partner'`, `active_role='partner'`, `secondary_role='agency'`.

079 uses **Rule A** - `profiles.role` alone - which now agrees with Rule A' (signup
metadata). Measured distributions from the PHASE 2 header:

| Rule | Before the corrections | After |
|---|---|---|
| A - `profiles.role` | 12 lead, 4 vendor | **5 lead, 11 vendor** |
| A' - signup metadata | 5 lead, 11 vendor | 5 lead, 11 vendor |

> ### A DEFECT FOUND AND FIXED THIS RUN
>
> 079's own PHASE 2 verification block stated the expected result as
> **`(t,f)=12, (f,t)=4`** - the PRE-correction distribution. Greg would have run the
> verification, seen 5/11, and been told by the migration itself that something was wrong.
>
> **Corrected in this commit.** The block now expects `(t,f)=5, (f,t)=11` and explains that
> a 12/4 result means the seven role corrections are NOT present in the database that was
> just migrated. **It is a comment change only. No executable SQL was touched.**

The precondition query at runbook step 4.1 catches this **before** the transaction:

```sql
SELECT count(*) FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE coalesce(u.raw_user_meta_data->>'role', p.role) IS DISTINCT FROM p.role;
-- expect 0
```

**Severity if it is wrong: data quality, not lockout.** No policy reads `is_lead_agency` or
`is_vendor`. Seven organizations would be labelled wrongly and could be fixed with an UPDATE
after the fact.

---

## 9. What remains UNPROVEN

Listed plainly. Nothing here is hedging: each is a specific thing that has not been
executed, with what it would take to execute it.

### 9.1 The migration has never been parsed by Postgres
Question 1. **The largest one.** Nothing else on this page is a substitute.

### 9.2 Storage policies are UNKNOWN, not none
`storage.objects` policies live outside the `schemaname='public'` snapshot and the
repository contains no storage policy SQL at all (grepped repo-wide, zero hits). If one
references `agency_id`, the rename breaks file downloads and **nothing else in this release
detects it.** Runbook step 0 is the query, and it carries a STOP instruction.

### 9.3 The RLS-filtered embed: null or error?
**Unresolvable in this environment.** `lib/org-contact.ts` is built on the assumption that a
to-one embed whose target row is filtered by row level security returns `null` at HTTP 200
rather than an error. The **null-foreign-key** cause was executed read-only against the live
database on 2026-08-17 and does return `null`. The **row-level-security** cause has not been
executed, because it needs a query issued as a real authenticated user, and the app makes
**zero client-side Supabase calls** that would produce one, while every credential that
would let a terminal produce one (`SUPABASE_JWT_SECRET`, `POSTGRES_URL`,
`POSTGRES_URL_NON_POOLING`, `POSTGRES_PASSWORD`) is present-but-empty.

**The code is correct either way** - it handles null at all thirteen sites. **The release
risk differs:** null means silent blanks, error means a visible HTTP 400. Anyone with a
browser session can settle it in thirty seconds; the exact case is specified in
`docs/079-embed-closure-report.md` Item 2.

### 9.4 Every claim about post-079 behaviour
`organizations`, `org_members`, `current_user_counterparty_org_ids()` and the counterparty
policy **do not exist in any database.** The security matrix is a reading of policy text.

### 9.5 The renamed payloads have never rendered
No route was exercised, no page loaded. Ten consumer files were changed against a payload no
compiler checks.

### 9.6 The notification fan-out has never run
`createOrgNotification()` and `resolveOrgMemberUserIds()` have never been called against a
database where `org_members` exists.

### 9.7 Twenty-five profiles-by-organization-id reads remain OPEN
**Found this run, and the class is four times larger than the previous run reported.**

```bash
$ node scripts/check-org-id-reads.mjs
  OPEN             25
  ALLOW-LISTED      1
```

Each reads a `profiles` row using an id that is an organization id after 079. Each works
perfectly for all sixteen existing accounts, and returns **nothing, at HTTP 200, with no
error**, for any organization created after 079. **Nothing in the smoke tests will show
this.** It appears as new customers sign up and form relationships.

Three were fixed on this branch. The other 25 are recorded in the guard's `KNOWN_OPEN` list
so the class cannot grow silently, and they are enumerated in
`docs/079-embed-closure-report.md`.

### 9.8 Which migrations are actually applied
`LIGAMENT_CONTEXT.md`'s migrations table lists **none of 079, 080, 081 or 082**, and says
078 is "AUTHORED, NOT APPLIED" while 079's PHASE 12 header says 078 **is** applied and
verified in production. **Both cannot be true.** Runbook step 4.2 resolves it empirically
with `pg_get_functiondef`. It does not block the release, because PHASE 12 replaces the
function wholesale either way, but somebody should write the four statuses down before the
window opens.

### 9.9 Policies from 080, 081 and 082 are not in 079's drop list
They were authored after the Aug 13 snapshot, so PHASE 4 does not drop them and PHASE 10
does not replace them. They survive the rename mechanically - Postgres rewrites policy
expressions on `RENAME COLUMN` - **while still comparing an organization column to
`auth.uid()`.** That works for a single-member organization and shows a colleague nothing.
**They are the most likely thing to fail runbook step 8.3**, and the policy audit at step 8.6
is what names them.

---

## The one paragraph to take away

Every mechanical check that can be run without a database has been run and is green: 767
identity columns resolved, every embed repointed, all 83 policy drops verified against the
authoritative capture by name, the counterparty rule shared by construction between both
visibility hops. **What has not happened is that any of it has met a Postgres server or a
browser.** The migration's first execution will be on production unless a branch database
can be found, twenty-five known reads will silently return nothing for the first customer
who signs up after the release, and whether a filtered embed nulls or errors is still an
assumption. **None of those is a reason not to ship. All of them are reasons to ship
deliberately, late, with the rollback regenerated and step 0 run first.**
