# 105 Phase 0 baseline: what a revoke on partnership_notes would break

Branch `fix/105-notes-column-revoke`, from main at 5a270ec. Authored 2026-10-08. Read only: no SQL was run, nothing applied, nothing pushed.

## Read these three first

1. **THE BRIEF IS WRONG ABOUT THE MECHANISM. A column revoke on `authenticated` cannot ship.** The agency reads and writes `partnership_notes` through a session client, as role `authenticated`, the same role a vendor holds. Privileges attach to roles, so any revoke that stops the vendor stops the agency. Migration 073 reached this conclusion about `reliability_summary` (073 lines 151-158) and named the real fix: move the data to an agency-only table, with code shipping first.
2. **It is worse than "breaks the notes feature". It breaks the vendor too.** `GET /api/partnerships` runs `select('*')` as the vendor (route.ts:260, 271) and strips the column afterwards in application code (route.ts:395). Vendor accept/decline runs `.update().select()`, which returns every column (route.ts:1087). Both would fail with `42501 permission denied for column partnership_notes` after the revoke. The agency side fails the same way at route.ts:119, 157, 596, 724, 1390, 1435.
3. **A column-level `REVOKE` is also probably a no-op on its own.** If `authenticated` holds a table-level `SELECT` (the Supabase default), `REVOKE SELECT (partnership_notes)` removes nothing, because column privileges are additive to the table grant. `information_schema.column_privileges` reports table-derived grants too, so the brief's measurement cannot tell the two apart. READ, not measured: I cannot run the catalog query. It needs `pg_class.relacl` versus `pg_attribute.attacl` for `public.partnerships`. A working revoke would be `REVOKE SELECT ON partnerships FROM authenticated` plus an enumerated column re-grant, which turns every `select('*')` into an error and silently excludes every column added later.

**Decision needed before Phase 1** (see "Mechanism"): I recommend a separate agency-only table, delivered as two migrations. I have not written code or SQL for it, because it is a larger change than the brief authorised.

## 0a. Working tree

`git status --porcelain` was empty on main before the branch was cut. Branch created from main (5a270ec == origin/main after fetch).

## 0b. Baseline gates

Run unpiped, one per call, exit code echoed on the next statement. tsc, lint and the four guards ran in a throwaway worktree of origin/main, invoked directly, not through pnpm. `pnpm build` ran in the main repo checkout, which was identical to origin/main (clean tree, no changes). The worktree was removed and `node_modules` was confirmed intact afterwards (45 entries).

| Gate | Exit | Matches known? |
|---|---|---|
| `tsc --noEmit` | 0 | yes |
| `pnpm build` | 0 | yes |
| `eslint .` | 1, "182 problems (154 errors, 28 warnings)" | yes, the full lint triple 182/154/28 |
| `audit-policy-snapshot.mjs --guard` (policy-audit:guard) | 1 | yes, known non-regression |
| `verify-rls.mjs` | 2 | yes, known non-regression |
| `check-embed-targets.mjs --guard` | 0 | |
| `check-identity-columns.mjs --guard` | 0 | |
| `check-org-id-reads.mjs --guard` | 0 ("14 known-open sites remain") | |

EXECUTED: all eight. Logs in the session scratch area, not committed.

## 0c. Census: every read or write of `partnership_notes`

Method: `grep` for the column name across app/, lib/, components/, contexts/, hooks/, scripts/, supabase/; then every `.from("partnerships")` and `partnerships(` embed was inspected for `*`, an empty `.select()`, or a column list that names it. All READ from source, none executed. I did not open each of the roughly 45 explicit-column partnerships queries individually; the filter found no `*` or bare `.select()` outside `app/api/partnerships/route.ts`, and the five `partnership:partnerships(...)` embeds (projects, assignments, onboarding-*) all list explicit columns without the notes column.

| # | Site | Operation | Session | Breaks under a revoke on `authenticated`? |
|---|---|---|---|---|
| 1 | `app/api/agency/pool/[partnerId]/notes/route.ts:73` | SELECT `id, partnership_notes, lead_org_id` | AGENCY, session client | YES. The notes feature itself. |
| 2 | same file `:245` | UPDATE `partnership_notes` | AGENCY, session client | NO for SELECT revoke on the write; but the route's gate read (#1) fails first. |
| 3 | `app/api/partnerships/route.ts:119` (GET agency, rich) | SELECT `*` | AGENCY, session | YES, whole pool list |
| 4 | same `:157` (GET agency, fallback) | SELECT `*` | AGENCY, session | YES |
| 5 | same `:260`, `:271` (GET partner) | SELECT `*`, then strip at `:395` | VENDOR, session | YES. The vendor's network page. This is the leak AND a dependency. |
| 6 | same `:596`, `:724` (POST) | UPDATE/INSERT ... `.select('*')` | AGENCY, session | YES (RETURNING `*`) |
| 7 | same PATCH `:895 :977 :1087 :1237 :1426 :1479` | UPDATE ... `.select()` | `:1087` accept is VENDOR (`isPartner`); the others are agency or either | YES (RETURNING `*`) |
| 8 | same PATCH `:1390`, `:1435` | SELECT `*` | AGENCY, session | YES |
| 9 | `lib/broadcast-partnership-cue.ts:216` via `app/api/agency/broadcast-rfp/route.ts:66` | INSERT `{ cued_by_broadcast }` | AGENCY, session | Not by a SELECT revoke (no RETURNING). Breaks if INSERT is revoked. |
| 10 | `app/api/agency/email-scan/import/route.ts:79,92,114,128` | SELECT, UPDATE, INSERT | SERVICE ROLE | no |
| 11 | `lib/server/partner-pool-import.ts:211,286,318` via `add-partner` and `import-spreadsheet` | SELECT, UPDATE, INSERT | SERVICE ROLE | no |
| 12 | `app/api/partnerships/route.ts:207,231` | reads `matched_profile_id`, `pool_flag` out of the rows from #3/#4 | AGENCY, derived | follows #3/#4 |
| 13 | `app/agency/pool/page.tsx:251,262,576,1490,1984` | reads the field from the GET /api/partnerships payload | derived, no direct DB call | follows #3/#4 |
| 14 | `app/partner/network/page.tsx:885` | `wasCuedByBroadcast(partnership.partnership_notes)` on the vendor payload | derived | See finding below |
| 15 | `lib/server/claim-partnership-invites.ts` | does not read the column (header comment only) | SERVICE ROLE | no |

DB-side readers: `grep` finds `partnership_notes` in migrations only at 068 (comment/column), 084 and 093 (comments/guard text). No view, function or policy body reads it, so a grant change affects no SECURITY DEFINER path.

**Finding, reported not fixed (row 14).** The vendor network page reads `partnership.partnership_notes`, but `GET /api/partnerships` strips that key for vendors (route.ts:395). So `wasCuedByBroadcast` is always false for vendors today. Either the badge is dead code or the product wants vendors to see a cue flag; that is a product question. Any migration that moves the data must not "fix" this by accident.

## 0d. Mechanism

| Option | Verdict | Why |
|---|---|---|
| Column `REVOKE` on `authenticated` | FAILS | Rows 1-8 above run as `authenticated` on both sides. Probably a no-op anyway (table-level grant). |
| Table-level revoke plus enumerated column grants | FAILS as a minimal change | Still hits agency and vendor equally. Every `select('*')` and `.select()` in row 3-8 must become an explicit list; future columns are silently ungranted. |
| Move agency reads to the service role, then revoke | WORKS but is the largest blast radius | Agency routes would run with RLS bypassed, so every one of them must re-implement the `lead_org_id` scoping by hand. Also needs the table-level restructure above. |
| Security-definer view for the agency, base column revoked | WORKS, brittle | PostgREST views do not inherit RLS the same way; writes still hit the base table; needs the same table-level restructure. |
| **Separate agency-only table** | **RECOMMENDED** | Postgres has no per-column RLS, and both parties are one role. A table with its own RLS policy (`lead_org_id IN (SELECT current_user_org_ids())`) is the only mechanism that separates them by row ownership. It needs no grant surgery, `select('*')` on partnerships stays valid, and no `partnerships` policy changes. 073 already named this as the real fix. |

### What the recommended mechanism costs (more than a revoke, as the brief invited me to say)

- Two migrations, not one. **105** (additive): create `partnership_private_notes (partnership_id PK, lead_org_id, notes jsonb, ...)`, RLS agency-only, `REVOKE ALL` from `anon`/`PUBLIC`, backfill from `partnerships.partnership_notes`. **106** (destructive, after code ships): null or drop `partnerships.partnership_notes`. The vendor leak stays open between 105 and 106 and closes only at 106.
- Code, shipped first: rows 1, 2, 6-8 stop reading the column, rows 9, 10, 11 write the new table, rows 3/4 join it for the agency pool list, row 5's strip becomes a no-op.
- Order: code (reads new table, falls back to old column) then 105 then deploy dual-write then 106. A mid-way revert is safe because 105 is additive.
- The brief's mandatory test "an agency member can still read and write `partnership_notes`" becomes "...read and write the notes table", and "the vendor cannot read partnership_notes" becomes "the vendor reads zero rows from the notes table and, after 106, the column is gone".

## 0e. `anon`

`anon` holding SELECT and UPDATE on this column is the same Supabase default. No policy admits an anonymous caller on partnerships, so RLS blocks it today; one policy set is the only barrier. Revoking `anon` is safe (it cannot reach the row) and I recommend doing it, but a column-level revoke would not take effect if `anon` holds a table-level grant either. In the split design: the new table gets `REVOKE ALL ... FROM anon, PUBLIC` explicitly, and the old column is gone after 106, so the `anon` grant question disappears with it. Revoking `anon` on the whole `partnerships` table is a separate decision I did not scope.

## Requests for Greg (catalog queries I did not run)

Not run by me (no credentials, no SQL per the brief). Greg to paste the results if wanted:

```sql
SELECT relacl FROM pg_class WHERE oid = 'public.partnerships'::regclass;
SELECT attname, attacl FROM pg_attribute
 WHERE attrelid = 'public.partnerships'::regclass AND attname = 'partnership_notes';
```

If `relacl` shows `authenticated=arwdDxt` (or any `r`), the column revoke is a no-op, as stated above. If `attacl` is null, the grant is table-level only.

## Stopped here (SUPERSEDED)

Greg ruled the same day: the split table is the only mechanism that works (his catalog query: `attacl` NULL, `relacl` table-wide for `authenticated`). Built in `docs/105-notes-split-report.md`. The paragraph below is the state at the end of Phase 0.

Phase 1 is not started. The choice between the split table, the service-role route and the view is a scope decision about a roughly fifteen-site code change and a two-migration sequence; the brief assumed one revoke. Per the standing rule, I am asking rather than picking a reading.
