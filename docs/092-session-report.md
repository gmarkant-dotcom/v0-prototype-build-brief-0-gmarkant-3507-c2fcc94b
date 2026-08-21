# 092 — entitlement moves onto the organization. SESSION REPORT.

**Branch `feat/m1-entitlements-092`, confirmed before anything was written.**
Eight commits. **Nothing pushed. No PR. No migration applied. No database
queried, and this session held no credential that could.**

---

# WHAT WAS NOT COMPLETED

**Nothing.** All eight phases ran. Two things were deliberately *not built*
rather than left undone, and both were instructed:

- **Expiry warnings** (Phase 4e) — Greg deferred them. The predicate a future
  warning would read is named in §6.
- **A DELETE policy on `public.partnerships`** (Phase 6) — the fix that would
  make that route actually work is an RLS widening, which this session is
  forbidden to do and which is a product decision besides. Raised as OPEN-092-1.
- **The two `partnerships` policy findings** from a live `pg_policies` query —
  **logged, not fixed, as instructed.** OPEN-092-8 (ILIKE where equality belongs)
  and OPEN-092-9 (an UPDATE policy with no column restriction). Both fixes are RLS
  or migration changes.

---

# THE APPLY ORDER. THIS IS THE SECTION TO READ FIRST.

```
  1.  Run docs/092-preapply-test.sql          <- one paste, ends in an error
  2.  Dry run 092: COMMIT -> ROLLBACK on LINE 1049, run, put it back
  3.  Run 092 for real
  4.  Run 092's VERIFICATION block            <- V1-V9, after the COMMIT
  5.  Update the migrations table in LIGAMENT_CONTEXT.md
  6.  THEN git push
```

**Step 6 is last and it is not interchangeable with step 3.**

## What Greg sees if he pushes before applying

**PostgREST fails an ENTIRE STATEMENT on one unknown column — it does not skip
the column.** Every read of `organizations.is_paid` raises **42703**, so:

| Surface | What happens |
|---|---|
| `AgencySubscriptionGate` | `resolveAgencyEntitlement()` returns `lookup-failed`, so **every agency user sees the wall** — and it renders the *"We could not confirm your company"* branch, not the lapsed one, because the reason is not `org-not-entitled`. |
| Project create / duplicate | 403 *"Active subscription required"* |
| All four AI routes | 403 |
| The upload route | 403 |
| The admin user list | **500**, deliberately — it refuses to render every customer as lapsed |
| The admin paid toggle | 500, with `hint: "42703 is undefined_column: migration 092 has not been applied"` in the log |

**The window is however long the next apply takes.** Applying first costs
nothing: the column exists, no deployed statement names it, and the guard
early-returns on every write that exists today.

## And the message that will not tell you which happened

> **"Success. No rows returned" in the SQL Editor is the IDENTICAL message for a
> dry run that rolled everything back, for a real apply that committed, and for
> a correct file pasted into the wrong project's tab.**

It proves the batch parsed. It proves nothing else. **The VERIFICATION block at
the foot of 092 is the only thing that distinguishes the three**, and every
query in it states its expected value. Run it.

**The pre-apply test is the opposite** and this trips people: it **ends in an
error on the healthy path**, because the report is carried in a
`RAISE EXCEPTION`. *"Success. No rows returned"* there means the run **did not
work** and you have learned nothing.

## The dry-run instruction, with the line number

```bash
grep -n -i '^begin\|^commit\|^rollback' supabase/migrations/092_org_entitlement.sql
#    459  BEGIN;    <- executable. The transaction.
#    544  BEGIN     <- plpgsql, the backfill assertion block. No semicolon.
#    856  BEGIN     <- plpgsql, the guard function body. No semicolon.
#   1049  COMMIT;   <- THE ONE TO SWAP FOR ROLLBACK;
```

**Change the `COMMIT;` on line 1049 to `ROLLBACK;`.** Re-grep before trusting
those numbers — **they have moved four times across this branch**, twice because
of the header edit that was recording them and twice more when the guard became
a permit list. The down file is now `113 BEGIN;` / `150 COMMIT;`.

---

# PHASE 0 — the baseline, and the three questions

## The eight gates, run once, exact numbers

| Gate | Phase 0 | Phase 7 | Movement |
|---|---|---|---|
| `npx tsc --noEmit` | exit **0** | exit **0** | none |
| `pnpm build` | exit **0**, 202 lines | exit **0**, 202 lines | **none — route table byte-identical** |
| `pnpm lint` | exit **1**, **182 problems (154 errors, 28 warnings)** | exit **1**, **182 problems (154 errors, 28 warnings)** | none *(see §7 — it went to 183 mid-session and was brought back)* |
| `pnpm identity-columns:guard` | exit **0**, 381 files, TOTAL 0 | exit **0**, **382 files**, TOTAL 0 | **+1 file** |
| `pnpm embed-targets` | exit **0**, 381 files, REPOINTED 0, PERSON 0 | exit **0**, **382 files**, REPOINTED 0, PERSON 0 | **+1 file** |
| `pnpm org-id-reads:guard` | exit **0**, 380 files, A: OPEN 14 / B: OPEN 60, IMPROVED 0/1, REGRESSIONS 0/0 | exit **0**, **381 files**, A: OPEN 14 / B: OPEN 60, IMPROVED 0/1, REGRESSIONS 0/0 | **+1 file** *(and one regression found and fixed — §7)* |
| `pnpm verify-rls` | exit **2** | *not re-run* | environmental; reads no `.ts` or `.sql` |
| `pnpm policy-audit:guard` | exit **1**, 60 company-scoped, FLAGGED 53 (44 direct, 9 indirect) | *not re-run* | environmental; parses a point-in-time snapshot |

**Every movement is explained in §7.** The `+1 file` on three gates is one new
`.ts` file, `lib/entitlement-escape.ts`.

> **NO GATE IN THIS REPOSITORY READS A `.sql` FILE.** Six green gates say the
> TypeScript compiles. They say **nothing whatever** about migration 092.

## (a) Does `agencyEntitlementId()` already route through `resolveActingOrgId()`?

**YES.** A previous session shipped it. Current code, `lib/entitlements.ts:320`:

```ts
export async function agencyEntitlementId(userId: string, client: OrgLookupClient): Promise<string> {
  if (!userId) return userId
  const { resolveActingOrgId } = await import("@/lib/acting-org")
  const resolution = await resolveActingOrgId(userId, client)
  return resolution.orgId ?? userId
}
```

**So Phase 3a built on it — but NOT by calling it.** The `?? userId` fallback is
right for accounting and **measurably wrong for entitlement**: `userId` *is* a
valid `organizations.id` for the sixteen accounts 079 backfilled, so the read
would be **correct by the same accident that has hidden every id-confusion
defect in this repository**, and a **total, invisible lockout for the
seventeenth**. `resolveAgencyEntitlement()` therefore calls `resolveActingOrgId()`
**directly**, which returns null rather than guessing.

## (b) Which route writes `is_paid` today, and with which client?

**Two, both admin-gated, both SERVICE ROLE.** The flags route is the expected one:

```ts
// app/api/admin/users/[userId]/flags/route.ts, before this session
const MUTABLE_FLAGS = ["is_paid", "demo_access", "is_admin"] as const   // :32
const service = serviceClient()                                        // :72 → SUPABASE_SERVICE_ROLE_KEY
const { data: updated, error } = await service
  .from("profiles")
  .update({ ...updates, updated_at: new Date().toISOString() })         // :117-119
  .eq("id", targetId)
  .select("id, is_paid, demo_access, is_admin")
```

The second is the magic-link grant, `app/api/admin/grant-access/route.ts:167`,
`.update({ is_paid: true, updated_at })`, also on a client built from
`SUPABASE_SERVICE_ROLE_KEY` after `requireAdminRole()`. **Both moved in Phase 3b.**

## (c) The component that gates the agency layout

**Both names confirmed against the tree.**

- `components/agency-subscription-gate.tsx:14` — `export function AgencySubscriptionGate`
- Mounted at `components/agency-layout.tsx:817`, wrapping `AgencyShell` inside
  `PaidUserProvider`
- Driven by `contexts/paid-user-context.tsx` — `usePaidUser()` at `:15`

**One thing the reports did not say, and it decided Phase 4:** the gate wraps
the **entire** shell — sidebar, organization switcher, sign-out and all. See §5.

---

# PHASE 1 — `supabase/migrations/092_org_entitlement.sql`

**AUTHORED, NOT APPLIED.** Plus `092_org_entitlement_down.sql`.

Contents, in the order the brief specified, because the order is load-bearing:

1. **`ALTER TABLE public.organizations ADD COLUMN is_paid boolean NOT NULL DEFAULT false`**
   — NOT NULL because a three-state entitlement is a bug generator; DEFAULT false
   because it must fail closed. Metadata-only in PG11+, so no table rewrite.
2. **The backfill, BEFORE the guard exists.**
3. **The guard, AFTER the backfill**, so it never evaluates the migration's own
   write. It would be exempt anyway — `auth.uid()` is NULL for a migration — but
   *that is an argument and the ordering is a fact.*
4. **`profiles.is_paid` is NOT dropped**, and the header says why at length.
5. **Verification after the COMMIT** (V1–V9), commented out so a dry run stops
   at the COMMIT line.
6. **A down file** dropping the trigger, the function and the column.
7. **A header written for someone who reads only the header**, carrying real
   line numbers and an ORDERING section.

Plus one thing the brief added at Phase 5: **a `COMMENT ON TABLE public.profiles`**
recording the trigger firing order. It is the only statement in 092 that names
that table, it writes no data and no schema, and §5 explains why it lives there.

## The backfill's expected counts, and why a zero-row backfill cannot pass

**EXPECTED AT AUTHORING TIME: 18 organizations written, 16 `true`, 2 `false`** —
matching the known `profiles.is_paid` distribution across eighteen one-member
organizations.

**A backfill's failure mode is silence:** it matches zero rows, PostgreSQL says
nothing, the transaction commits, every organization stays `false`, and the next
deploy locks out every paying customer with no error anywhere. **Four things make
that impossible**, and each `RAISE`s, which aborts the whole migration:

| # | Assertion | Refuses when |
|---|---|---|
| 1 | **The window is still open** | ANY organization has more than one member — the backfill has no correct answer and Greg owes a ruling |
| 2 | **Every organization has a member** | ANY organization has none — it would silently keep the DEFAULT |
| 3 | **Every row was written** | `ROW_COUNT <> count(*) FROM organizations` |
| — | The 16/2 distribution | **NOT asserted, deliberately.** A signup between authoring and applying legitimately changes both numbers, and a migration that refuses because somebody signed up is worse than one that reports. **V3 and V4 carry the expectation instead.** |

The counts are also raised as a `WARNING` inside the transaction, which the SQL
Editor surfaces where a `NOTICE` is not — so a dry run shows them without a
second query.

**§0 of the design doc said the window closes the moment any organization has
two members. 092 does not rely on that being true — it checks it.**

## The guard, and what the role gate does not buy

`organizations`' UPDATE policy is `"Org admins update their organization"`
(079:1797), qual and with_check both `id IN (SELECT current_user_admin_org_ids())`,
resolving `role IN ('owner','admin')`. **It reads like a privilege check and buys
nothing**, because **every user is the owner of their own organization by
construction** — 079 PHASE 2 backfilled one per profile as `owner`, PHASE 12's
`handle_new_user` creates one per signup as `owner`. **Without the guard, 092
reproduces one level up the exact hole 091 just closed.**

A `WITH CHECK` cannot fix it either: **a `WITH CHECK` has no `OLD`.** "is_paid did
not change" is a statement about two rows.

- **SQLSTATE: `LG008`.** Next free — 089 used LG001–LG004, 090 LG005–LG006, 091
  LG007. Confirmed by grep over `supabase/`, `lib/` and `app/`: LG008 appears in
  `docs/` only, where the design doc reserved it for exactly this.
- **THE API LAYER SHOULD MAP LG008 TO 403.** Not 400 — the request was
  well-formed and the caller is not permitted to make it. Not 500 — it is a
  refusal, not a fault. The map is `lib/org-invitations.ts:77`. **No API route was
  changed in Phase 1**, per the brief.
- `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE EXECUTE … FROM anon BY NAME`.
- **`organizations` had no trigger at all before this.** Verified: the only three
  `CREATE TRIGGER` statements in the repository are 087's on `partnerships` and
  090's and 091's on `profiles`. So there is no firing-order question here and no
  `updated_at` auto-stamp trigger to interact with.

## The guard is a PERMIT LIST of one column, `name` — OPEN-092-4 is closed

**The first draft of 092 carried a deny list of `{is_paid}`, per the brief. That
was wrong and the design doc was right.** The correction is the substance of this
revision.

### Why the logic inverts rather than 091 being wrong

| | `profiles` (091) | `organizations` (092) |
|---|---|---|
| Columns | 44 | **8** |
| Written by a session client | 37, across 24 sites | **1** — `name` |
| A permit list would be | 37 entries, **one omission silently breaks a save** | **1 entry** |
| **What the NEXT column is likely to be** | more profile content — a bio, a preference, a contact field | **AUTHORITY-SHAPED: plan tier, seat limit, billing customer id** |
| Cost of the wrong choice | a broken save, loudly, at development time | **a privilege column ships self-grantable, silently** |

**That last row is the whole ruling.** On `profiles`, adding `bio` is not a
deliberate act and adding a privilege column is, so the deny list carried the
smaller risk. **On `organizations` every plausible future column is
authority-shaped** — this is the billing table now. A deny list leaves each one
unguarded until somebody remembers, and *"somebody remembers"* is not a mechanism.

> **A permit list guards them BY DEFAULT, and its failure mode is a write that
> FAILS LOUDLY rather than a hole that opens silently.**

### The permit list, and the census it came from

```
  PERMITTED:  name
```

**One entry, and it is derived and not guessed.**
`docs/092-organizations-writer-census.md` was written and committed **before 092
was edited**, because getting a permit list one entry short does not fail a
build — **it breaks a write in production on the day the migration is applied.**

It found **five writers** of `public.organizations` in the whole repository, with
every column each writes enumerated, and **its gap table is empty**: all eight
columns have an identified writer, so nothing here is a guess at an unaccounted
column. **Had one been UNACCOUNTED the census would have stopped there and 092
would not have been touched.**

**The rule: a column belongs on the list only if a SESSION-CLIENT writer
legitimately writes it.** The census row that justifies the one entry:

> **W1** — `lib/company-identity.ts:306`, **SESSION** client,
> `.from("organizations").update({ name })`. Every company rename in the product
> goes through that line, and it is the only session write of this table that
> exists.

And the row that excludes each of the other seven is quoted in 092's section 3.
The two worth repeating here:

- **`is_paid` IS NOT ON THE LIST, and a mechanical derivation would have put it
  there.** W2 and W3 write it — so a script asking *"does anything write this
  column"* would have permitted it, **and that would delete the entire point of
  migration 092.** Both use the **service role**, so they pass the
  `auth.uid() IS NULL` exemption **before the permit list is ever consulted**.
  **EXEMPT IS NOT PERMITTED.** Putting it on the list would additionally let a
  **browser** write it, and the browser is the entire threat model.
- **`updated_at` is not on it either, and that one is a near miss.** W2, W3 and
  092's own backfill stamp it — all exempt. **W1 writes `{ name }` and nothing
  else, not even `updated_at`.** That is quoted from the object literal, not
  inferred. **The tripwire is recorded**: if that line ever gains a column, that
  column joins `v_permitted` in the same commit, or every rename starts raising
  LG008.

### The mechanism, and the one thing that decides whether it works

> **THE TEST IS "DID THIS COLUMN CHANGE", NEVER "WAS THIS COLUMN IN THE SET
> CLAUSE".**

**A trigger cannot see the SET clause.** It has `OLD` and `NEW` and nothing else.
**That is not a limitation here — it is the property the shape depends on:**

A caller that sends the **whole row** back with one field altered — which is what
a read-modify-write PATCH produces — names **every** column in its SET clause. A
guard that refused on *"was it named"* would reject that write for **mentioning**
`is_paid` while sending back the identical value. **Every whole-row write in the
product would break.** Comparing **values** makes it pass, because nothing outside
the permit list **moved**.

**T2 in the pre-apply test is that property under test**, and it is not there for
symmetry.

The comparison is expressed over the row with the permitted columns subtracted:

```sql
v_old_rest := to_jsonb(OLD) - v_permitted;   -- v_permitted = ARRAY['name']
v_new_rest := to_jsonb(NEW) - v_permitted;
IF v_new_rest = v_old_rest THEN RETURN NEW; END IF;
```

**An `IS NOT DISTINCT FROM` chain naming the seven guarded columns was rejected**,
because such a chain has to be edited every time a column is added — **which makes
it a deny list wearing a permit list's clothes.** With the projection form, **a
column added to this table next year is guarded from the moment it exists, with
no edit to this function.**

### The function was renamed, and 092 has not been applied so nothing is stranded

`organizations_guard_entitlement()` → **`organizations_guard_columns()`**, and the
trigger `organizations_entitlement_guard` → **`organizations_columns_guard`**. A
name saying *"entitlement"* on a guard that also refuses `is_lead_agency`,
`primary_contact_user_id` and every future column is the kind of lie that makes
somebody add a second trigger for the rest. **No object under the old name has
ever existed**, so there is nothing to rename in any database; the down file says
what to do if an older copy of 092 was applied anyway.

### The DETAIL names columns and never values — reassessed, not inherited

091's rule was *"name the column, never the value, because the caller supplied the
column name."* **This differs on one point and it is written into the header: the
moved-column list is COMPUTED FROM A DIFF, not read back from what the caller
named.** So a caller who sends a whole row and gets `is_paid` back has learned
their stored value differed from what they sent.

**That is not an oracle here, structurally rather than by judgement:** the trigger
only fires on a row **the UPDATE policy already admitted**, and the SELECT policy
*"Members read their organizations"* lets that same caller read every column of
that same row directly. **The DETAIL reveals nothing a single GET does not already
give up.** For a row they do not belong to, the policy filters the UPDATE to zero
rows and the trigger never runs. **Values are still never interpolated.**

## The follow-up this migration owes

> **A LATER MIGRATION MUST `DROP COLUMN public.profiles.is_paid`, and remove its
> entry from 091's authority set in the same migration** — both the
> `IS NOT DISTINCT FROM` chain and the `IS DISTINCT FROM` refusal, plus the
> `COMMENT ON FUNCTION`.

**Preconditions, checkable rather than remembered:**

1. The Phase 3 deploy is **LIVE**, not merely merged.
2. `canUploadVendorFiles()`'s `is_paid` term is deleted **in that same change**,
   with the two vendor routes' select lists — see §4. It is the **one remaining
   reader** and it is a named dependency, not an oversight.

Dropping it before the push lands is the 42703 window at the top of this report.
**Named in 092's header, in `lib/entitlements.ts`, in both vendor routes, and in
the `COMMENT ON TABLE public.profiles`,** so it is not forgotten in four places
rather than one.

---

# PHASE 2 — `docs/092-preapply-test.sql`

**FOURTEEN assertions. Expected: 14 run, 14 PASS, 0 FAIL, 0 INCONCLUSIVE.**
*(It was seven when the guard was a deny list. The permit list needs a refusal
per guarded column and a whole-row case, so the count doubled.)*

Same shape as `docs/091-preapply-test.sql`, same mechanism, and **no fourth
mechanism was invented**: notices are invisible in the Supabase SQL Editor, that
session has no temp namespace (3F000), psql is not installed. **The report is
carried in a `RAISE EXCEPTION`.** Headline first, tally second, detail last,
because a client that truncates a long message truncates the end. The self-check
(`verdicts logged` vs `assertions run`) **overrides the headline**: unequal means
the report is incomplete and no verdict drawn from it can be trusted, including a
clean one.

| # | Assertion | **PASS is** |
|---|---|---|
| T1 | The company rename, **bare** `{ name }`, as an org admin | **SUCCEEDS**, 1 row |
| **T2** | **A WHOLE-ROW write naming all 8 columns, altering only `name`** | **SUCCEEDS**, 1 row — *the 2(a) property under test* |
| T3 | A whole-row **no-op**, every column sent back unchanged | **SUCCEEDS**, 1 row |
| T4a | `is_paid` moved | **RAISES LG008** |
| T4b | `updated_at` moved | **RAISES LG008** |
| T4c | `is_lead_agency` moved | **RAISES LG008** |
| T4d | `is_vendor` moved | **RAISES LG008** |
| T4e | `primary_contact_user_id` moved | **RAISES LG008** |
| T4f | `created_at` moved | **RAISES LG008** |
| T4g | `id` moved | **RAISES LG008** |
| T5 | The backfill agrees with its source, row by row | **0 mismatches** *(read-only)* |
| T6 | A no-session write of `is_paid` | **SUCCEEDS** — the exemption |
| T7 | 091's profiles guard still bites | **RAISES LG007**, *not* LG008 |
| T8 | The column is `boolean`, `NOT NULL`, `DEFAULT false` | all three correct *(read-only)* |

**Seven of the fourteen pass by raising.** Every refusal runs in its own plpgsql
subtransaction, which is what lets all fourteen report from a single paste.

### T2 is the one that matters most, and it is new

**A permit list can be too small in a direction a deny list cannot.** A deny list
can only miss a column that ought to be guarded — a hole. **A permit list can also
omit a column a session client legitimately writes, and that is a write that
starts raising LG008 the moment the migration is applied.** T1, T2 and T3 exercise
the single permitted column three different ways for exactly that reason.

T2 sends **all eight columns** with only `name` altered. If the guard tested the
SET clause rather than the values, it would refuse that write for **mentioning**
`is_paid`, and every whole-row write in the product would break. **A FAIL on T2 is
the single most important failure in the file.**

### Four design points that are not cosmetic

- **T5 RUNS BEFORE T6 AND THE ORDER IS LOAD-BEARING.** T6 deliberately moves
  `is_paid` on the exempt path. If it ran first, T5 would report a mismatch
  **against a backfill that is perfectly correct** — a test failing on its own
  side effects, which is worse than no test because the failure looks real.
- **The subject is selected as an OWNER or ADMIN of the organization under test.**
  A non-admin subject would make every T4 a **zero-row update that proves
  nothing** — the policy would have filtered the row before the trigger fired.
  Reported as **INCONCLUSIVE**, not as a pass.
- **T6 proves "exempt is not permitted".** `is_paid` is not on the permit list and
  that write succeeds anyway, because it has no session behind it. That
  distinction is the one a mechanical derivation gets wrong.
- **T4c/T4d/T4e/T4g carry constraint handlers.** A `23514` or `23503` there would
  mean a CHECK or a foreign key answered **before** the trigger. BEFORE ROW
  triggers are supposed to run first, so that outcome is reported **INCONCLUSIVE
  and flagged as worth reading**, never passed.

**Three ways the run can end, and only one is a verdict** — the header spells all
three out. The second is worth knowing here: **an error reading
`"BACKFILL REFUSED: …"` is 092's own precondition speaking from inside SECTION A.
It is a real answer of DO NOT APPLY, not a crash**, and it names which
precondition failed.

## Why 092 is less dangerous than 091, stated honestly

091 could refuse writes that worked that morning — five guarded columns, thirty
live writers. **092 guards one column that does not exist until line 1 of its own
transaction**, so no write that works today can move it. The risk is *smaller*
and it is not zero, in three specific places named in the header: **the backfill**
(the one statement whose failure mode is silence), **the early return** (`<>`
instead of `IS NOT DISTINCT FROM` would fall through to the refusal), and **the
one live session writer**, `lib/company-identity.ts:306`, through which every
company rename in the product passes.

**The permit list adds a fourth, and it is the one the deny list did not have:
A PERMIT LIST CAN BE TOO SMALL IN THE OTHER DIRECTION.** A column a session
client legitimately writes, left off the list, is a write that starts raising
LG008 on apply. That is why the list is derived from a written census rather
than from reading the code once, and why T1, T2 and T3 exercise the one
permitted column three different ways.

---

# PHASE 3 — the reads and the write

## (a) The read. `resolveAgencyEntitlement()`, and NO FALLBACK

**One choke point** in `lib/entitlements.ts`: demo → null-profile → platform admin
→ `organizations.is_paid` for the organization `resolveActingOrgId()` returns.
It returns a decision, not a boolean:

```ts
type EntitlementDecision = {
  entitled: boolean
  orgId: OrgId | null
  reason: "demo-deployment" | "platform-admin" | "org-entitled" | "org-not-entitled"
        | "no-profile" | "org-unresolved" | "org-row-missing" | "lookup-failed"
  actingOrgReason: ActingOrgReason | null
}
```

**Every refusal path logs.** A person locked out of their own product must leave a
trace somebody can find. **The 42703 branch carries an explicit hint** naming the
unapplied migration, so a deploy that got ahead of its migration is visible on the
first request instead of presenting as *"everybody's subscription lapsed"*.

`hasAgencyEntitlement()`, `canUseAgencyAi()` and `canUploadFiles()` became **async**
and take `(profile, userId, client)`. **The compiler found all nine call sites** —
which is why the signature changed rather than a second function appearing beside
the old one.

## (b) The admin write — and the writer-outcome finding, which way it came out

**THE FLAGS ROUTE NOW WRITES THREE FLAGS TO TWO TABLES:**

| Flag | Table | Because |
|---|---|---|
| `is_paid` | **`organizations`** | entitlement is a company fact |
| `is_admin` | `profiles` | platform staff — a property of a person |
| `demo_access` | `profiles` | same |

**Without this Greg could no longer mark anyone paid.** The toggle would flip a
column nothing reads, report success, and grant nobody anything — the exact
silent-success shape this route was originally written to fix, delivered a second
time through a different door.

> ### THE WRITER-OUTCOME FINDING, VERIFIED NOT ASSUMED
>
> **It came out EXEMPT.** 091's writer-outcome table records, for this same route:
>
> > *"SERVICE ROLE (admin/users/[userId]/flags:118 and admin/grant-access:166): a
> > service_role JWT carries no `sub` claim, so auth.uid() is NULL and the guard
> > EXEMPTS them."*
>
> 092's guard uses the **identical** exemption test — `auth.uid() IS NULL` — on the
> identical clients. **Same client, same mechanism, same answer.** No permit and no
> named exemption is needed, and none was added.
>
> **The corollary is written into both routes:** if either is ever moved to a
> session client, the `is_paid` write **stops working and raises LG008**. That is
> the guard doing its job — being an admin of an organization must not permit
> writing its plan, because every user is an admin of their own organization.

The magic-link grant at `admin/grant-access` moved the same way, and both now
carry `.select()` with a zero-row check, because PostgREST reports a zero-row
update as success.

## (c) The sweep — all fifteen readers, and what happened to each

| # | Site | Outcome |
|---|---|---|
| 1 | `app/api/admin/users/route.ts:15` `ADMIN_USER_COLUMNS` | **MOVED.** `is_paid` removed from the profiles select; the org's flag is composed onto each row in two extra queries. A failed organizations read **fails the request** rather than rendering every customer as lapsed. |
| 2 | `app/api/admin/users/[userId]/flags/route.ts:121` | **MOVED.** Re-read now returns the organization's flag. |
| 3 | `app/api/agency/msa/ai-schedule/route.ts:68` | **MOVED.** Select list drops `is_paid`; gate is `await hasAgencyEntitlement(profile, user.id, supabase)`. |
| 4 | `app/api/agency/payment-synthesis/route.ts:59` | **MOVED.** Same. |
| 5 | `app/api/agency/projects/duplicate/route.ts:43` | **MOVED.** Same. |
| 6 | `app/api/ai/master-brief/route.ts:48` | **MOVED**, via `canUseAgencyAi()`. |
| 7 | `app/api/ai/rfp-output-template/route.ts:40` | **MOVED**, same. |
| 8 | `app/api/ai/route.ts:176` | **MOVED**, same. |
| 9 | `app/api/documents/extract-text/route.ts:31` | **MOVED**, same. |
| 10 | `app/api/partner/documents/upload/route.ts:44` | **LEFT ALONE.** Vendor-side. See below. |
| 11 | `app/api/partner/rfp-bid/upload/route.ts:29` | **LEFT ALONE.** Same. |
| 12 | `app/api/projects/route.ts:541` | **MOVED.** This is the OPEN-1 refusal. |
| 13 | `app/api/upload/route.ts:54` | **MOVED**, via `canUploadFiles()`. |
| 14 | `app/auth/callback/route.ts:17` | **DELETED FROM THE SELECT.** `is_paid` and `demo_access` were **never read** by that branch — grep the file. It is the post-authentication routing decision and would be the first statement to 42703 when the column drops. |
| 15 | `contexts/paid-user-context.tsx:107` | **MOVED.** Calls `resolveAgencyEntitlement()` with the browser client — **the same function every server gate calls**, so the wall a user sees and the 403 a route returns cannot disagree. |

### Why 10 and 11 were left alone — and why it is NOT laziness

`canUploadVendorFiles()` is **the one remaining reader of `profiles.is_paid` in the
application.** Two reasons, both now in its header:

1. **VENDOR ORGANIZATIONS HAVE NO ENTITLEMENT CONCEPT.** Vendor access is free by
   the pricing copy, established four independent ways in the surface doc. Pointing
   this at `organizations.is_paid` would give every vendor organization an
   entitlement it has never had, **defaulting to false** — the lockout the design
   doc names as OPEN-4.
2. **IT IS NOT A BILLING READ.** It is the clause that lets an agency-side caller
   fall through to the *more accurate* refusal underneath. **Measured against both
   routes:** a caller with `is_paid=true`, `role='agency'`, `active_role='agency'`
   passes this gate and is then refused by `"Vendors only"`. Delete the term — the
   obvious "it decides nothing, so remove it" move — and that account gets
   **"Upgrade to upload files"** instead. That is a copy regression and a support
   ticket.

## (d) The vestigial comments

`profiles.is_paid` is annotated as vestigial-pending-drop at **four** definition
sites: `EntitlementProfile` in `lib/entitlements.ts`, `canUploadVendorFiles()`'s
header, both vendor routes' select lists, and the new `COMMENT ON TABLE
public.profiles` in 092.

## One deletion, on a recorded instruction

**`canUseAgencyPortalAi()` is gone.** Zero callers, measured at 091, which
deliberately kept it and wrote down the exact condition for removal:

> *"leave it until entitlement moves onto the organization … If that design lands
> without using it, delete it in the same change — with the two messages resolved."*

The condition is met and the design landed without it: the two routes it named
keep their halves as two statements because they return **two different refusals**,
and collapsing them would tell a caller in the wrong portal that they need a
subscription. **A receipt comment stands where it was.**

---

# PHASE 4 — the lockout (R5) and the escape route (R6)

## (a) The gate refuses everyone in a lapsed organization

No owner carve-out. No read-only tier. **The copy changed with it**: *"Access to
this account has been restricted by an administrator"* was written for the
admin-toggle model and is **wrong for a lapsed payment**, which is not an
administrator action. A user told an administrator restricted them goes looking
for the wrong person.

**And it distinguishes a lapse from an unresolved organization.** `no-membership`,
`ambiguous`, `preference-refused`, `lookup-failed` and `org-row-missing` all
arrive with `isPaid` false. Telling those users their subscription lapsed would
have them paying for something already paid for, so they get a different screen
that says plainly it is not a billing problem.

## (b) The escape route set — one entry, justified

**`lib/entitlement-escape.ts` is the only place it is defined.**

| Route | Why it is in | Why it is the only one |
|---|---|---|
| `/agency/settings/billing` | It is the **only** page that tells a locked-out owner what happened and how to restore access. Without it R6's escape has nowhere to land. | **Every other `/agency` route is the product**, and letting a lapsed company use the product is what R5 rules out. "Small" is doing real work in R6: each extra entry is a piece of the product handed to a company that is not paying, and the argument for the second is always easier than for the first. |

Prefix matching carries a **boundary check**, so `/agency/settings/billing-history`
cannot silently join the exemption via a sloppy `startsWith`.

> ### THAT ROUTE WAS A REDIRECT, AND IT WOULD HAVE MADE THE ESCAPE A LOOP
>
> `app/agency/settings/billing/page.tsx` was three lines: `redirect("/agency/usage")`.
> **`/agency/usage` is not exempt.** A lapsed owner following the wall's only
> button would have been redirected straight back into the wall — by the one
> control offered to them. **It is now the page**, and it does not link on to
> `/agency/usage` while lapsed, for the same reason.

**There is no billing provider in this codebase** — no dependency, no webhook
route, no customer id column. So the page **states the situation and carries
`support@withligament.com`** rather than pretending at a checkout. **It becomes
the real billing screen when a provider arrives**, and the exemption already
points at it.

**The exemption is live and does real work.** A lapsed owner reaching that URL
renders the page; a lapsed member reaching the same URL gets the wall. **Both
branches are exercised by roles that exist** — it is not a check that cannot fire.

## (c) A plain member is told to contact their admin

The wall's copy forks on **org role**, not portal role: an owner or admin is told
what to do **and given the route**; a member is told to *"Ask an owner or admin of
your company to restore the subscription"* **and given no route**. `mayManageBilling()`
treats a null org role as **no** — the conservative direction, and the only safe
one when the reason the role did not resolve is that the organization did not.

## Two trap-breakers on the wall, and why they are not decoration

**The gate wraps the ENTIRE shell** (`agency-layout.tsx:817` wraps `AgencyShell`),
including the sidebar. That was harmless when entitlement was per person and
admin-toggled. **After 092 it creates two traps:**

| | The trap | The fix |
|---|---|---|
| **Sign out** | The sidebar this wall replaces holds the **only** sign-out control in the portal. A locked-out user could not leave, or sign in as somebody else to fix it. | A sign-out button on the wall. |
| **The organization switcher** | 090 made two memberships possible and 092 makes one able to lapse while the other is current. The switcher is the **only** way between them and it lived in that same sidebar — so a person whose **acting** organization lapsed was trapped, holding a perfectly good membership of a paying company they could not reach. | `<OrganizationSwitcher />` on the wall. It renders **nothing** below two memberships, which is every account today, so it costs one indexed read now and is the whole escape later. |

## (d) Vendor organizations — how it was confirmed, and the one leak found

**Five checks, all executed:**

1. `AgencySubscriptionGate` is mounted in **exactly one place** —
   `components/agency-layout.tsx:817`.
2. `components/partner-layout.tsx` mounts **no equivalent** — grepped for
   `SubscriptionGate`, `hasAgencyEntitlement`, `resolveAgencyEntitlement`,
   `isPaid`, `is_paid`: no match.
3. Nothing under `app/partner/` or `app/api/partner/` reads the org entitlement —
   the only hits are **comments**.
4. `checkFeatureAccess()` still returns `true` for `role === "partner" || activeRole === "partner"`
   at `:225`, **before** `isPaid` is consulted at `:228`.
5. `lib/entitlement-escape.ts` is imported by **agency files only**.

> ### ONE REAL LEAK WAS FOUND AND CLOSED
>
> **`PaidUserProvider` is mounted in BOTH portals** — `partner-layout.tsx:346` as
> well as `agency-layout.tsx:816`. So every vendor was going to pay for **two
> extra queries on every route change** and generate `[entitlements] … refusing`
> log lines **for a refusal that never happened** — noise that is worse than
> useless, because the next person to read those logs would believe vendors were
> being locked out.
>
> The provider now **skips the entitlement read entirely** for a vendor-side
> caller. Keyed on **`actingRole(profile) === "partner"`**, not the permissive
> `canActAs()` that `checkFeatureAccess` uses — so an account with
> `role='partner'` and `active_role='agency'`, which **is** gated on the agency
> side, still gets a real answer. Same predicate and same reasoning as
> `canUploadFiles()` on the server.

**No access changed for any vendor.** The leak was in cost and in logs.

## (e) Expiry warnings — FLAGGED, NOT BUILT

**The single predicate a future warning would read:**

```ts
(await resolveAgencyEntitlement(profile, userId, client)).reason === "org-not-entitled"
```

**The one-choke-point property holds** — everything that asks "is the paying
entity behind this caller entitled" goes through `resolveAgencyEntitlement()`,
including all three gate functions and the browser context. **It is written into
that function's own header**, so if a second place ever learns to answer the
question, the reason it must not is on the screen.

---

# PHASE 5 — the flag scope correction, and the trigger-order comment

**Comment changes only. No variable was set, flipped, or added anywhere. Only the
variable NAME was searched for. No env file was read.**

## `BROADCAST_CUES_PARTNERSHIP`

`lib/feature-flags.ts:27` said *"(Production and Preview)"*. **It is the identical
exposure `COLLEAGUE_INVITATIONS` was corrected for, on the identical two facts** —
the correction was made on one flag and not the other, which is the only reason
this line survived. Now **PRODUCTION SCOPE ONLY**, naming *"All Environments"*
explicitly because it is the Vercel default and is the same mistake with a
friendlier name.

**And the reason is worse here than a bad write.** A Preview-scoped flag means
the next broadcast from **any pushed branch** writes pending `partnerships` rows
against production — and **those rows ARE the exposure**, because
`current_user_counterparty_org_ids()` admits partnerships **at any status in both
directions**, so each one makes both companies' entire `profiles` rows readable to
the other. **Unsetting the flag deletes nothing.**

## The trigger firing order, on `profiles`

092 sets a `COMMENT ON TABLE public.profiles` recording:

- Two BEFORE UPDATE guards: `profiles_active_org_guard` (090) and
  `profiles_authority_columns_guard` (091).
- **PostgreSQL fires BEFORE triggers in ALPHABETICAL ORDER BY TRIGGER NAME**, so
  `'a'` runs before `'u'`.
- **THE ORDER IS NOT WHAT MAKES THE PAIR SAFE.** Each early-returns when its own
  columns have not moved, and **neither modifies `NEW`** — each returns `NEW`
  unchanged or `RAISE`s. So at most one has anything to say about any given
  UPDATE and **the two commute**. Renaming either is therefore safe.
- **A future trigger on this table that MUTATES `NEW` would destroy that
  silently**, in an order decided by how somebody spelled its name.

It destroys nothing — `profiles` carried **no** table comment; grep every
migration. **The down file NULLs it rather than inventing a third version**, and
says when to leave that statement out.

---

# PHASE 6 — the seven Class B candidates, read one at a time

**Two were genuinely broken. Five are safe, and the line that makes each safe is
named.** None was judged by grep.

| # | Site | Verdict |
|---|---|---|
| 1 | `agency/bids/[responseId]/evaluation:385` → `partner_rfp_responses` | **SAFE.** `:145-154` reads that exact row with `.eq("id", responseId).in("lead_org_id", callerOrgIds)` and 404s otherwise. The UPDATE policy is `lead_org_id IN (current_user_org_ids())` — **the same predicate the pre-check used.** If the read passed, the write is admitted. |
| 2 | `agency/library-documents/[id]:62` | **BROKEN — AND IT IS A DELETE, NOT AN UPDATE.** The report described it as "a document update (org-scoped)". **FIXED.** |
| 3 | `partner/rfps/[id]/response:331` → `partner_rfp_inbox` | **SAFE.** `partnerCanAccessPartnerRfpInbox()` at `:148-172`, 404/403 otherwise. The UPDATE policy (079:1356) carries **the same disjunction** — `vendor_org_id IN (…) OR recipient_email matches my profile email`. |
| 4 | `partner/rfps/[id]:71` (`viewed_at`) | **SAFE, AND BY DESIGN.** The write carries `.select("*").maybeSingle()` and the zero-row case is handled explicitly by `if (updatedInbox)`. `.is("viewed_at", null)` means it matches **once**; a zero row is the expected second call and **nothing is reported as done**. |
| 5 | `partner/rfps/[id]/nda-notify:116` | **SAFE.** `ownsByPartnerId \|\| ownsByEmail` at `:52-56`, 403 otherwise — **exactly the UPDATE policy's disjunction.** |
| 6 | `partnerships:1355` | **BROKEN, AND IT IS THE WORST ONE IN THE SET. FIXED.** |
| 7 | `documents/delete:36` | **SAFE.** Ownership pre-check, already read and confirmed by the previous session. |

## The one that had never worked

> ### `DELETE /api/partnerships` HAS NEVER DELETED A PARTNERSHIP. NOT FOR ANYBODY.
>
> **`public.partnerships` has no DELETE policy. Not a narrow one — none at all.**
> Its complete policy set is three INSERTs, three SELECTs and three UPDATEs
> (079:1465–1494, 087 replacing the INSERT). **RLS is enabled and Postgres denies
> by default**, so `.delete().eq('id', partnershipId)` matched **zero rows for
> every caller**, including the lead agency that owns the row.
>
> **PostgREST does not report a zero-row delete as an error.** So `deleteError`
> was null, the `throw` never fired, the route logged `[api] success` and returned
> `{ success: true }`.
>
> **Verified by grep over every migration** and against
> `docs/schema-snapshot-2026-08-13.md`, which lists **four** DELETE policies in
> the entire schema and **none** on this table.
>
> **AND SINCE CONFIRMED AGAINST THE LIVE DATABASE.** A `pg_policies` query run
> today returns **six policies on `public.partnerships` and no DELETE among
> them.** This finding has moved from REASONED to EXECUTED — see OPEN-092-1.
>
> Same shape as `admin/grant-agency-access`, **and worse** — that one at least
> worked on the admin's own row. The ownership pre-check above it was never the
> problem: it correctly refuses a partnership the caller does not own, it simply
> had nothing to protect.

**THE FIX MAKES THE ROUTE HONEST. IT DOES NOT MAKE THE DELETE WORK.** It now
returns **501** and says *"Nothing has been changed"*, which is true. Making it
work needs a DELETE policy, which is an **RLS widening** this session is forbidden
to do and a product decision besides. **OPEN-092-1.**

The library-documents delete was the same symptom with a different cause:
`"Agency manages own library documents"` (079:1121) is **`FOR ALL`**, so DELETE
*is* covered for the caller's own organization. The happy path was correct; what
was missing was the ability to tell it apart from the empty one. It now 404s.

---

# PHASE 7 — the gates, and the one movement

**Six re-run. `verify-rls` and `policy-audit:guard` were run once at Phase 0 and
deliberately not again**, per the brief: both are environmental and read no `.ts`
or `.sql` file.

## Every movement, explained

**1. `+1` scanned file on three gates (381→382, 381→382, 380→381).**
One new `.ts` file: **`lib/entitlement-escape.ts`**. The three gates scan
different root sets, which is why the two baselines differ.

**2. Class A REGRESSION — found, diagnosed, and fixed rather than accommodated.**

Mid-Phase-7 the org-id-reads guard went **exit 0 → 1**, class A **OPEN 14 → 15**,
**REGRESSIONS 0 → 1**:

```
app/api/admin/users/[userId]/flags/route.ts
    265  NEARBY .eq("id", targetId)
```

**Cause: my own Phase 3 change.** The handler writes `profiles` keyed
`.eq("id", targetId)` where `targetId` is a **user** id, and I had put the
organizations write — and therefore an **organization** id — inline, inside the
scanner's forty-line proximity window. *"A profiles row fetched by an id an
organization column may have supplied"* is **precisely** the defect class that
scanner exists to catch, and it cannot tell from proximity alone that these are
two different variables.

**THE GUARD WAS NOT WRONG AND NOTHING WAS SILENCED.** No allow-list entry was
added, no `KNOWN_OPEN` count was changed, and **`git diff main..HEAD -- scripts/`
is empty.** The organizations write became `setOrganizationEntitlement()`, defined
near the top of the file, so **the two ids are separated by a function boundary
because they ARE separate things**. Back to **OPEN 14, REGRESSIONS 0, exit 0.**

**3. Lint 182 → 183 → 182.** The extraction's first draft typed its client
parameter `any` with an `eslint-disable-next-line`, which lint reported as an
**unused directive**. A second attempt used
`ReturnType<typeof createSupabaseClient>`, which **tsc rejected with TS2345** on
the generic defaults. The third uses **`OrgLookupClient`** — the loose shape
`lib/entitlements.ts` already uses for exactly this, and the type
`resolveOrgIdForUser()` already takes. All three are recorded because the answer
the codebase had already settled on was the right one.

**4. Class B `IMPROVED 1` is carried, not new.** `lib/entitlements.ts` recorded 1,
found 0 — from the previous session, and unchanged by this one. **The count was
not lowered**; the gate passes either way, since only `REGRESSIONS` fails it.

**Nothing was reworded to satisfy a guard. No exemption was added. No allow-list
entry was touched.**

---

# OPEN — every item, with the query or command that settles it

## OPEN-092-1. `public.partnerships` has no DELETE policy — **NOW CONFIRMED AGAINST THE LIVE DATABASE**

> **THIS IS NO LONGER REASONED. IT IS EXECUTED.** A `pg_policies` query was run
> against the live database today: **`public.partnerships` carries six policies
> and NONE of them is a DELETE.** The finding stands exactly as written — that
> route could never have deleted anything, for anybody — and it is now a measured
> fact rather than an inference from migration files and a snapshot dated
> 2026-08-13.

The route is now honest (501). Making removal work needs a policy, which is a
**widening** and a **product decision**: who may remove a partnership, and whether
"remove" should be a **status change** rather than a delete, given how many rows
reference these.

```sql
-- The query that was run, kept so it can be re-run after any policy change.
SELECT cmd, count(*) FROM pg_policies
WHERE schemaname='public' AND tablename='partnerships'
GROUP BY cmd ORDER BY cmd;
-- MEASURED TODAY: INSERT 1, SELECT 2, UPDATE 3. Six policies. NO DELETE ROW.
-- A DELETE row appearing later means somebody added one outside the migration set.

-- And what a delete would orphan, before anybody writes that policy:
SELECT 'project_assignments' AS t, count(*) FROM public.project_assignments WHERE partnership_id IS NOT NULL
UNION ALL SELECT 'partner_vouches', count(*) FROM public.partner_vouches;
```

## OPEN-092-2. Is the backfill window still open?

**A query, not a ruling** — and 092 refuses to run if the answer is wrong, so this
is for knowing in advance rather than for safety.

```sql
SELECT m.org_id, count(*) AS members
FROM public.org_members m GROUP BY m.org_id HAVING count(*) > 1;
-- 0 rows: the backfill still has one unambiguous source per organization.
-- ANY ROW: 092 will RAISE "BACKFILL REFUSED" and Greg owes a ruling first.
```

## OPEN-092-3. Which two organizations have `id <> profiles.id`

Carried from 091 OPEN-A, and **it matters more now**: those are the accounts on
which the old `agencyEntitlementId()` fallback would have produced a lockout. The
new read has no fallback, so they behave like everyone else — but they are still
the only rows where an id-confusion defect would show.

```sql
SELECT o.id AS org_id, o.name, m.user_id, p.email, (o.id = m.user_id) AS id_coincides
FROM public.organizations o
JOIN public.org_members m ON m.org_id = o.id
JOIN public.profiles    p ON p.id = m.user_id
ORDER BY id_coincides, o.created_at;
-- EXPECTED: 18 rows, 16 with id_coincides = true.
```

## OPEN-092-4. Deny list or permit list on the organizations guard — **CLOSED**

**RULED: PERMIT LIST.** The brief specified a deny list and the design doc argued
for a permit list; **the design doc was right and the brief was wrong.** 092 now
carries a permit list of one column, `name`, derived from
`docs/092-organizations-writer-census.md`. The full reasoning is in Phase 1 above
and in 092's own header; the short form is that **every plausible future column on
`organizations` is authority-shaped — a plan tier, a seat limit, a billing
customer id — so a deny list would leave each one unguarded until somebody
remembered.**

**One thing this leaves owed, and it is small:** the permit list has to gain a
column whenever a **session-client** writer legitimately starts writing one. There
is exactly one such writer, `lib/company-identity.ts:306`, and the tripwire is
recorded in the census, in 092's header, and in the pre-apply test's maintenance
note. **T1, T2 and T3 are what would fail if somebody misses it**, at development
time, which is the failure mode the shape was chosen for.

## OPEN-092-5. LG007 and LG008 are not mapped at the API layer

Both should map to **403** at `lib/org-invitations.ts:77`, alongside LG001→404,
LG002→401, LG003→409, LG004→410. **Neither is wired.** Nothing in the product
raises either on a path a user can reach without trying to, so there is no broken
surface — but a caller who does reach one sees a raw SQLSTATE.

```bash
grep -n "LG00" lib/org-invitations.ts   # EXPECTED today: LG001-LG004 only.
```

## OPEN-092-6. `viewed_at` is never stamped for an email-matched vendor

Noticed while reading Phase 6 candidate 4 and **not fixed** — it is a different
class and a product question. `partner/rfps/[id]:71` scopes the stamp
`.in("vendor_org_id", callerOrgIds)`, which is **narrower than the UPDATE policy's
disjunction**. A vendor who reaches an inbox row by `recipient_email` with no
`vendor_org_id` yet passes the access check, reads the RFP, and **never has their
first view recorded**. Nothing is reported as done, so it is not the
silent-success class — it is a missing breadcrumb, and whether the agency should
see "viewed" for a pre-claim vendor is a ruling.

## OPEN-092-7. `usage_tracking.plan_tier` is still the only tier-shaped thing

Carried from 091 OPEN-D, unchanged. **092 adds a boolean, not a tier.** Nothing in
the repository ever promotes an organization past `'starter'`.

```sql
SELECT plan_tier, count(*) AS rows, count(DISTINCT org_id) AS orgs
FROM public.usage_tracking GROUP BY plan_tier ORDER BY plan_tier;
-- EXPECTED if nothing has been hand-edited: one row, 'starter'.
```

## OPEN-092-8. `"Partners can claim partnership by email"` matches with ILIKE, not equality

**FROM A LIVE `pg_policies` QUERY RUN TODAY. LOGGED, NOT FIXED** — fixing it is an
RLS change and this session is forbidden to make one.

The policy's email comparison uses **`~~*` (ILIKE)** rather than `=`. **In an
ILIKE pattern, `%` and `_` are wildcards**, so an address containing either would
match rows belonging to other people: `a_b@x.com` would match `aXb@x.com`, and an
address containing `%` would match far more.

**Two things bound it, and neither makes it correct:**

1. **No live email contains `%` or `_`.** So it is not currently exploitable.
   That is a property of the current data, not of the policy.
2. **It reads `profiles.email`, which 091 now guards against self-rewriting.**
   Before 091 a user could set their own email to `%@%` and claim every
   unclaimed partnership on the platform. **091 closed that**, so the policy is
   **narrower than it was** — a user can no longer choose the pattern they match
   with. It would take an address containing a wildcard to arrive through signup.

**The fix is a one-word change from `~~*` to `=` with `lower(btrim(...))` on both
sides**, matching the spelling `org_has_member_with_email` and
`accept_org_invitation` already use. It is not made here.

```sql
-- 1. Confirm the operator is still ILIKE.
SELECT policyname, qual FROM pg_policies
WHERE schemaname='public' AND tablename='partnerships'
  AND policyname='Partners can claim partnership by email';
-- Look for ~~* in the qual. A '=' means somebody has already fixed it.

-- 2. Does any address in the system contain a wildcard? THE ONE THAT MATTERS.
SELECT id, email FROM public.profiles WHERE email LIKE '%\%%' OR email LIKE '%\_%';
SELECT id, partner_email FROM public.partnerships
WHERE partner_email LIKE '%\%%' OR partner_email LIKE '%\_%';
-- EXPECTED: 0 rows from both. ANY ROW makes this reachable today.

-- 3. What is claimable at all - the blast radius if it ever is.
SELECT count(*) FROM public.partnerships WHERE vendor_org_id IS NULL;
```

## OPEN-092-9. `"Partners can update partnership status"` has NO column restriction

**FROM THE SAME LIVE QUERY. LOGGED, NOT FIXED.** **This is the same class as the
`profiles` hole 091 closed, one table over, and it is the more serious of the
two findings.**

The policy is `USING (vendor_org_id IN (SELECT current_user_org_ids()))` with the
same `WITH CHECK`. It constrains **which row**, and says nothing about **which
columns**. RLS has no column granularity — that is the whole argument 087, 090,
091 and 092 each reached for a trigger over.

> **So a vendor can rewrite ANY column on a partnership they belong to,
> including `lead_org_id`** — the column that says which agency the partnership
> belongs to. The name of the policy says "status"; **nothing in the database
> restricts it to status.**

**And 087 already guards this table**, which is what makes the gap concrete rather
than theoretical: `partnerships_guard_identity_columns` exists precisely because
identity columns on `partnerships` must not be rewritten. **Whether `lead_org_id`
is inside that guard's set is the first thing to check**, and it is the query
below. If it is, the exposure is much smaller than the policy suggests; if it is
not, a vendor can reassign a partnership to a different lead agency.

**The fix has the same shape as 092's**: extend `partnerships_guard_identity_columns`
rather than touch the policy — a `WITH CHECK` has no `OLD` and cannot express
column immutability. **Not done here: it is a migration, and one that can refuse
writes that work today.**

```sql
-- 1. The policy, confirmed.
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='partnerships' AND cmd='UPDATE'
ORDER BY policyname;

-- 2. THE ONE THAT DECIDES THE SEVERITY: what does 087's guard actually cover?
SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='partnerships_guard_identity_columns';
-- Read the IS DISTINCT FROM lines. If lead_org_id is NOT among them, a vendor
-- can move a partnership to another agency and 087 will not stop them.

-- 3. Is the guard even enabled?
SELECT t.tgname, t.tgenabled FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname='partnerships' AND NOT t.tgisinternal;
-- EXPECTED: partnerships_guard_identity_columns, tgenabled = O.
```

## Carried forward from 091, unresolved and untouched by this session

- **OPEN-091-1** — `admin/grant-agency-access` writing another user's row with a
  session client. *(Fixed at 091b; the OPEN was the `secondary_role` ruling
  behind it.)*
- **OPEN-091-2** — the `secondary_role` split.
- **OPEN-B / OPEN-C / OPEN-F / OPEN-G** from the surface doc.

---

# PRODUCT RULINGS DEFERRED

| # | Ruling | Where it is written up | What it blocks |
|---|---|---|---|
| 1 | **Expiry warnings** | Phase 4e, §6 above | Nothing. The predicate is named and the choke point holds. |
| 2 | **The role escalation** — an admin can currently invite an `owner` and remove the existing owner | `docs/092-entitlements-design.md` §6 | Nothing in 092. **It becomes urgent the day `COLLEAGUE_INVITATIONS` is switched on.** |
| 3 | **Does `organizations.is_paid` mean "entitled" or "entitled AS A LEAD AGENCY"?** | design doc OPEN-4 | The column's name. **Handled in code for now**: no vendor surface reads it, `canUploadVendorFiles()` did not move, and `PaidUserProvider` skips the read on the vendor side. The column is honest as long as that stays true. |
| 4 | **Which member's flag wins if an organization ever has two before 092 lands** | design doc §0 | The backfill. **092 refuses to run rather than guess.** |
| 5 | **Seats** | design doc §3 | Nothing. **R3: no seat column, and no seat check that always passes.** Shape A is a strict prefix of Shape B; nothing built here has to be undone. |
| 6 | **Removing a partnership** | OPEN-092-1 | The DELETE route, which now says so. |

---

# EXECUTED / READ / REASONED

**EXECUTED.** `git branch --show-current`, `git status`, `git log`, `git diff
--stat`, `git diff main..HEAD -- scripts/`; **the eight gates at Phase 0 and the
six code-reading gates at Phase 7**, plus `npx tsc --noEmit` and `pnpm build`
after every phase; roughly forty `grep`/`sed`/`cat` passes; eight `git commit`s.
**No `git push`. No PR. No `vercel` command. No dev server. No network call. No
database query.**

**WRITTEN.** `docs/092-organizations-writer-census.md` — the five writers of
`public.organizations`, every column each one writes, and the gap table the permit
list is derived from. **Committed on its own, before 092 was edited**, because a
permit list derived after the fact is a guess with a citation.

**READ IN FULL.** `docs/092-entitlements-design.md`; `docs/091-entitlements-surface.md`;
`supabase/migrations/091_profiles_column_guard.sql`; `docs/091-preapply-test.sql`;
`lib/entitlements.ts`; `lib/acting-org.ts`; `contexts/paid-user-context.tsx`;
`components/agency-subscription-gate.tsx`;
`app/api/admin/users/[userId]/flags/route.ts`;
`app/api/agency/library-documents/[id]/route.ts`; and each of the seven Class B
candidate handlers around its flagged line.

**READ IN PART.** `079_organizations.sql` (the `organizations` DDL, the policy
blocks for `partnerships`, `partner_rfp_inbox`, `partner_rfp_responses` and
`agency_library_documents`); `docs/schema-snapshot-2026-08-13.md` (the DELETE
policy list); `docs/091b-session-report.md` (the Class B inventory);
`docs/091-session-report.md` (the Phase 0 gate table);
`components/agency-layout.tsx`; `components/organization-switcher.tsx`;
`lib/feature-flags.ts`; `lib/company-identity.ts`; `app/admin/users/page.tsx`;
`app/api/admin/grant-access/route.ts`; `app/auth/callback/route.ts`.

**EXECUTED BY GREG, NOT BY THIS SESSION, AND FOLDED IN.** A `pg_policies` query
against the live `partnerships` table. It settles three things: the **DELETE
finding is now measured** (six policies, none of them DELETE — OPEN-092-1 has
moved from REASONED to EXECUTED), and it surfaced **two new findings that are
logged and NOT fixed**, OPEN-092-8 (an ILIKE email comparison where equality
belongs) and OPEN-092-9 (an UPDATE policy with no column restriction, which is
091's hole one table over). **This session still ran no query itself and holds no
credential that could.**

**REASONED, AND THEREFORE UNVERIFIED AGAINST THE LIVE DATABASE.** Every claim
about what 092 will do when applied — the backfill counts (16/2 is taken from the
brief, not measured), the guard's behaviour under each writer, the pre-apply
test's fourteen outcomes. **The service-role exemption**, which is derived from
091's writer-outcome table rather than observed. **The writer census** — it is
exhaustive over the *repository*, and nothing in a repository can prove a column
is unwritten in *production*; the census carries the one query that would check
it. Everything about a two-membership account, which no account currently has.

**NOT DONE.** No migration applied. No policy widened. `middleware.ts` untouched.
No guard allow-list or `KNOWN_OPEN` count edited. No migration numbered 091 or
lower modified. `COLLEAGUE_INVITATIONS` and `BROADCAST_CUES_PARTNERSHIP` neither
set nor flipped nor added — only their names were searched for. No `.env` file
read. The budget spine untouched.

---

# THE COMMITS

| SHA | Phase | |
|---|---|---|
| `c4dc71b` | 1 | 092 and its down file. Authored, not applied. |
| `8278081` | 2 | The seven-assertion pre-apply test. |
| `7777f09` | 3 | The reads move to the acting organization; the admin write moves with them. |
| `2f0de14` | 4 | The company-wide lockout and the one route that is not a trap. |
| `61f8e3f` | 5 | Flag scope correction; the trigger-order comment on `profiles`. |
| `bc087ee` | 6 | `DELETE /api/partnerships` had never deleted anything. |
| `3c7c2d2` | 6 | The library-document delete reported success for nothing. |
| `04d197b` | 7 | The org-id-reads guard was right; the two ids got a function boundary. |
| `9ee4b5f` | 7 | This report. |
| `bcabf26` | — | **The organizations writer census.** Committed alone, before 092 was edited. |
| *(this one)* | — | **The guard becomes a permit list**, plus the down file, the fourteen-assertion test and this report. |

**Nothing pushed.**

---

# THE REVISION: WHAT CHANGED AFTER THE FIRST EIGHT COMMITS

**OPEN-092-4 was ruled the other way and the guard was rebuilt.** Five files, no
`.ts` or `.tsx` among them:

| File | What changed |
|---|---|
| `docs/092-organizations-writer-census.md` | **NEW.** The derivation the permit list needs. |
| `supabase/migrations/092_org_entitlement.sql` | Guard rewritten as a permit list; function and trigger renamed; header rewritten; **BEGIN/COMMIT now 459 / 1049**. |
| `supabase/migrations/092_org_entitlement_down.sql` | New object names, the rename recorded; **BEGIN/COMMIT now 113 / 150**. |
| `docs/092-preapply-test.sql` | **7 assertions → 14.** SECTION A re-copied. |
| `docs/092-session-report.md` | This. |

**NO GATE WAS RUN, deliberately.** This revision touches only `.sql` and `.md`,
and **no gate in this repository reads either**. The Phase 0 / Phase 7 gate table
above is unchanged and still current: the last `.ts` change on this branch was
`04d197b`.

**The three prohibitions that applied: nothing pushed, no migration numbered 091
or lower touched, no RLS policy widened.** The two new `partnerships` findings are
logged with their queries and left alone — fixing either is exactly the RLS change
that was forbidden.
