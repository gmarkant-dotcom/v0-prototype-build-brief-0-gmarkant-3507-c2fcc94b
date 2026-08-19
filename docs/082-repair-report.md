# Migration 082 repair

**Scope.** `supabase/migrations/082_partner_vouches_containment.sql` was authored before 079 and
could not be applied against the post-079 schema. This run repaired it. **Nothing was applied.**
Neither phase was run, and there is no local Postgres in this environment, so no statement in the
file has been executed anywhere.

One line changed in `087_partnership_vendor_identity.sql`: a cross-reference to `082:274-275` that
this edit moved. That file also carries unrelated uncommitted work from a prior session.

---

## 1. The column names

`079:674-675` renamed `voucher_agency_id -> lead_org_id` and `vouched_partner_id -> vendor_org_id`,
and `079:991-992` made both NOT NULL. 082 carried those renames as `079:` notes rather than as code.
That was two live defects, not a cosmetic lag.

| Site | Was | Now |
|---|---|---|
| `partner_vouch_count()` predicate | `v.vouched_partner_id = p_partner_id` | `v.vendor_org_id = p_partner_id` |
| `partner_vouch_counts()` RETURNS TABLE | `(vouched_partner_id uuid, vouch_count bigint)` | `(vendor_org_id uuid, vouch_count bigint)` |
| `partner_vouch_counts()` body | `v.vouched_partner_id` x3 | `v.vendor_org_id` x3 |
| Phase 2 SELECT policy | `voucher_agency_id = auth.uid()` | `lead_org_id IN (SELECT public.current_user_org_ids())` |
| Phase 2 write policies | recreated against `voucher_agency_id` | **removed** - see section 3 |

**The RETURNS TABLE name was the dangerous one.** `lib/vouch-counts.ts:153-154` reads
`row.vendor_org_id` off the result and `continue`s on a falsy key. Under the pre-079 declaration
every key is `undefined`, `fetchVouchCounts` returns an empty map, and every marketplace vendor
renders at zero vouches with no error and no log line. **That failure does not need phase 2** - it
arrives on phase 1 alone, so the STOP GATE would not have caught it.

The phase 2 policy defect was the loud one: `voucher_agency_id` no longer exists, so phase 2 would
have raised 42703 mid-transaction.

**Two names deliberately did NOT follow the column.** `p_partner_id` and `p_partner_ids` stay as
they are: PostgREST matches RPC arguments by name against the JSON body, and `lib/vouch-counts.ts`
posts those keys. Renaming them to match the column would return PGRST202, which
`lib/vouch-counts.ts` swallows into the `082-FALLBACK` table read - silently correct before phase 2
and silently zero after it. Stated at the site in the file.

Both body references in `partner_vouch_counts()` stay alias-qualified (`v.vendor_org_id`). `RETURNS
TABLE` makes `vendor_org_id` an OUT parameter, and an unqualified reference to a name that is both
an OUT parameter and a column raises 42702 in a SQL-language function. The alias is what keeps it a
column. Also stated at the site.

## 2. The anon revoke, and service_role

Both functions now carry `REVOKE EXECUTE ... FROM anon` alongside the existing `REVOKE ... FROM
PUBLIC`. `pg_default_acl` carries two rows for functions in `public` - one from `postgres`, one from
`supabase_admin` - and both contain `anon=X`, so `CREATE FUNCTION` grants `anon` EXECUTE **directly**
and `REVOKE ... FROM PUBLIC` is a no-op against it. 087 proved this against the live database
(`087:16-23`). Both functions take arguments, so without the second REVOKE each is an oracle: one
vendor id per call, the count back, no row access required.

Phase 1 verification **V2** asserts it, expecting `f, t, t` per function across
`anon / authenticated / service_role`, plus the `proacl` reading 087 uses.

**service_role is asserted, not granted.** 087 granted it because its helper is called from a
trigger that is not SECURITY DEFINER, executing as the invoking role, and all three of its call
paths are service-client writes. 082 has no such caller: all four readers of `partner_vouches` are
session-authenticated - two browser clients and one server route that builds its client from request
cookies. Granting `service_role` EXECUTE would widen a SECURITY DEFINER surface for no call site.
It keeps whatever `pg_default_acl` gives it, which today is EXECUTE, and V2 asserts that value
rather than pretending the file set it. If a service-role caller is ever added, the GRANT becomes
required in the same commit.

## 3. Phase 2: the drop, and the read path

**"Anyone can count vouches" is still dropped.** It is the one statement in the file that closes the
disclosure.

**All four readers have a replacement read path before the drop:**

| # | Site | Kind | Replacement |
|---|---|---|---|
| a | `app/api/marketplace/discoverable/route.ts:105` | count | `partner_vouch_counts()` RPC, phase 1 |
| b | `app/partner/profile/page.tsx:225` | count | `partner_vouch_count()` RPC, phase 1 |
| c | `app/agency/pool/[partnerId]/page.tsx:240` | count | `partner_vouch_count()` RPC, phase 1 |
| d | `app/agency/pool/[partnerId]/page.tsx:249-253` | **rows** | the phase 2 SELECT policy |

(a)(b)(c) stop needing row access at all. (d) is the "have I vouched?" check; it reads rows and no
RPC should replace it, because it asks about the caller's own vouches. It filters
`lead_org_id IN callerOrgIds` client-side, with `callerOrgIds` from `resolveCallerOrgIds()`
(`lib/entitlements.ts:156`, an `org_members` lookup for `user.id`). The new policy predicate,
`lead_org_id IN (SELECT public.current_user_org_ids())`, is the server-side twin of that filter -
`current_user_org_ids()` (`079:451`) is the same `org_members` lookup for `auth.uid()`. Same rows,
one of them enforced.

**This matters because "Anyone can count vouches" is the only read policy on the table.** Dropping
it without a replacement leaves reader (d) with zero read access, not reduced access. The header
section on the pre-phase-2 snapshot now says so explicitly.

**The two write policies are no longer recreated.** `079:557-558` dropped them and `079:1455-1461`
recreated them `TO authenticated` with `lead_org_id IN (SELECT public.current_user_org_ids())` -
both the role narrowing 082 wanted and a membership predicate it had no way to write. The live
database carries that shape. Re-authoring them from 082 would leave two migrations claiming one
policy, with the later winning by accident. Phase 2 **asserts** them instead (phase 2 verification
V2, which fails loudly on drift and says so rather than papering over it). The schema-wide policy
count is still unchanged by phase 2 - one dropped, one created instead of three and three.

## 4. Line numbers and gates

| Fact | Value |
|---|---|
| Phase 1 `BEGIN;` | **264** |
| Phase 1 `COMMIT;` | **370** |
| Phase 2 `BEGIN;` | **503** |
| Phase 2 `COMMIT;` | **549** |
| Total lines | **618** (was 401) |

46 executable lines, 572 comment and blank. `087:695` updated from `082:274-275` to `082:395-403`.

**Gates.** EXECUTED on `feat/m1-cleanup` after the edit. Every result is identical to the baseline
recorded in `docs/m1-cleanup-report.md` Phase 4.

| Gate | Exit | vs. baseline |
|---|---|---|
| `npx tsc --noEmit` | **0** | same |
| `pnpm build` | **0** | same |
| `pnpm lint` | **1** | same. **183 problems, 154 errors, 29 warnings** - byte-identical totals |
| `pnpm verify-rls` | **2** | same. Known pre-existing; PostgREST does not expose `pg_class` |
| `pnpm policy-audit:guard` | **1** | same. Known pre-existing; reads a static pre-079 snapshot |
| `pnpm identity-columns:guard` | **0** | same. 0 legacy column names in application source |
| `pnpm embed-targets` | **0** | same |
| `pnpm org-id-reads:guard` | **0** | same. Class A 14, class B 66, neither moved |

Both known failures are pre-existing and unrelated. `policy-audit:guard` in particular reads a
static pre-079 snapshot, so it cannot see this change either way.

`grep -rl "](http://" app/ --include="*.ts" --include="*.tsx"` - no matches. No em dash in either
edited file.

## 5. What this run did not establish

**The SQL was never parsed by Postgres.** No local instance exists here and the instruction was not
to apply it. The two claims worth re-checking at apply time are the ones a parser would settle
instantly: that the alias-qualified `v.vendor_org_id` does not collide with the `vendor_org_id` OUT
parameter, and that `pg_get_function_result` returns the expected string in phase 1 V3. Both are
reasoned in the file at their sites, neither is observed.
