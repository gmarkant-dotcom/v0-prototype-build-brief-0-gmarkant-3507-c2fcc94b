# Grant posture: what the migrations say, what they cannot say, and the order to find out

**Status:** findings only. No migration was written, nothing was run against a database, nothing was changed. Every query below is unrun; each was parsed with a PostgreSQL 17 grammar parser (pglast 8.3) and parses. Parsing is syntax only, it does not show the query returns what its comment says.

**Merge status:** this is a document on branch `fix/107-reliability-split`. Check with `git merge-base --is-ancestor <this commit> origin/main`; the line is never updated by hand.

## Read these three first

1. **One live measurement exists, and it is the bad one.** `pg_class.relacl` on `partnerships` reads `{postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}` (docs/105-phase0-baseline.md, measured 2026-10-08). Nothing in this repository narrows it, and no live measurement exists for any other table. What follows is an inference from migrations, which docs/schema-snapshot-2026-08-13.md already warns cannot reproduce the live database.
2. **Not one table is confirmed narrowed live.** The migrations that revoke `anon` by name cover 7 tables (103: 4, 104: 2, 105: 1) plus 107 (authored here), and every one of those is authored and not applied as far as this repository can show. Every other table in the repository, 38 of 46 created here, inherits the Supabase default.
3. **I found no table with row level security off, and I found one grant that gives `anon` something on purpose.** The 2026-08-13 snapshot says all 38 public tables had RLS on with at least one policy; all 46 `CREATE TABLE`s in the repository are followed by an `ENABLE ROW LEVEL SECURITY` and there is no `DISABLE`. And `054_brief_interpretations.sql:25` is `grant select on brief_interpretations to anon`, the only migration that grants `anon` anything on a table. Its policy is `auth.uid() = user_id`, which is NULL for `anon`, so it returns no rows. Harmless today, pointless, and it is exactly the kind of grant a later policy change turns into a leak.

## 2a. Which tables were narrowed, which inherit the default

Method: every non-comment `GRANT`, `REVOKE` and `ALTER DEFAULT PRIVILEGES` across `supabase/migrations/` and `scripts/`, and every `CREATE TABLE` and `ENABLE` or `DISABLE ROW LEVEL SECURITY`. EXECUTED: the greps and a small script over the files. READ: the files.

| Table | Where | What it does to `anon` | Applied? |
|---|---|---|---|
| `budget_template_categories`, `budget_project_categories`, `budget_lines`, `budget_category_merges` | 103:517-524 | `REVOKE ALL FROM PUBLIC, anon` | authored; "not applied" per its commit |
| `source_documents`, `ledger_entries` | 104:613-616 | `REVOKE ALL FROM PUBLIC, anon` | authored; same |
| `partnership_private_notes` | 105:294-298 | `REVOKE ALL` from PUBLIC, anon, authenticated, then re-grants `authenticated` S/I/U | authored, not applied |
| `partnership_private_reliability` | 107:297-301 | same as 105 | authored here, not applied |
| `brief_interpretations` | 054:24-25 | **grants** `SELECT` to `anon` | applied (table is live, in the snapshot) |
| `usage_tracking` | 067:28 | grants `authenticated` only, no revoke | applied |

Function `EXECUTE` grants are a separate and well-trodden surface (079, 082, 087, 089, 090, 091, 094, 096, 097, 098 all `REVOKE EXECUTE ... FROM anon` by name; docs/082-repair-report.md records why `FROM PUBLIC` alone is a no-op there). No migration issues `ALTER DEFAULT PRIVILEGES`, so nothing changes what a table created tomorrow receives.

**Not narrowed, so inheriting the default (`anon=arwdDxtm` on the one table measured):** every other table, and the 7 that have no `CREATE TABLE` in the repository at all (`invitation_requests`, `msa_agreements`, `notifications`, `partnership_profile_context`, `payment_milestones`, `project_documents`, `project_messages`), for which the 2026-08-13 snapshot is the only record.

## What RLS currently stands between `anon` and the data (from the 2026-08-13 snapshot)

Policies whose roles include `public` or `anon` (so they apply to an unauthenticated request), read from the snapshot, not from the live database today:

| Table | Policy | Admits `anon`? |
|---|---|---|
| `partner_vouches` | "Anyone can count vouches", SELECT, `USING (true)` | **YES, every row.** 082 phase 2 drops it. 082's own header says it was NOT applied as of 2026-08-19. Whether it is applied now is unknown from here. |
| `contact_submissions` | INSERT, `WITH CHECK (true)`, roles `{anon,authenticated}` | Yes, by design. The app's contact route uses the service role (app/api/contact/route.ts:47), so this policy may not be used at all. |
| `agency_partner_invitations`, `brief_interpretations`, `email_connections`, `partnership_profile_context`, `partner_vouches` (ins/del), `rfp_magic_tokens`, `profiles` (ins/upd), `partnerships` (one UPDATE) | all keyed on `auth.uid()` | No rows: `auth.uid()` is NULL for `anon`, and a comparison with NULL is not true. Safe, but the safety is one expression. |

`partnerships`' `{public}` UPDATE policy in that snapshot predates 087 and 093, which rewrote the partnerships policies; it is listed to show the shape, not as a current finding.

## 2c. Is there a table with RLS off?

**From the migrations: no.** 46 tables are created in the repository; 46 have an `ENABLE ROW LEVEL SECURITY`; zero `DISABLE` statements exist. **From the snapshot: no**, as of 2026-08-13 (38 of 38 enabled, none without a policy). **What neither can say:** tables created out of band after that date, the 7 with no `CREATE TABLE`, and views. A view in `public` owned by `postgres` runs with the owner's rights and ignores RLS on its base tables unless it is `security_invoker`; if `anon` holds `SELECT` on one, that is an open door that no `ENABLE ROW LEVEL SECURITY` grep can see. Query C settles views.

## 2b. The queries (unrun)

Run them as `postgres` in the SQL Editor. All read-only.

**A. Every table in `public` with its `relacl`, flagged for whether `anon` holds more than SELECT.** Uses `has_table_privilege` so inherited and PUBLIC grants are counted, and it counts policies that reach `anon`.

```sql
SELECT c.relname                                              AS table_name,
       c.relkind                                              AS kind,
       c.relrowsecurity                                       AS rls_enabled,
       c.relforcerowsecurity                                  AS rls_forced,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = n.nspname AND p.tablename = c.relname)                         AS n_policies,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = n.nspname AND p.tablename = c.relname
           AND p.roles && ARRAY['anon', 'public']::name[])                                   AS n_policies_reaching_anon,
       has_table_privilege('anon', c.oid, 'SELECT')           AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT')           AS anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE')           AS anon_update,
       has_table_privilege('anon', c.oid, 'DELETE')           AS anon_delete,
       has_table_privilege('anon', c.oid, 'TRUNCATE')         AS anon_truncate,
       (   has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE')
        OR has_table_privilege('anon', c.oid, 'TRUNCATE'))    AS anon_holds_more_than_select,
       c.relacl::text                                         AS relacl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY anon_holds_more_than_select DESC, c.relrowsecurity ASC, n_policies_reaching_anon DESC, c.relname;
```

Read the rows where `anon_holds_more_than_select` is true first, then `rls_enabled` false, then `n_policies_reaching_anon` above 0.

**B. The open door: RLS off and `anon` holds anything.** Expect zero rows.

```sql
SELECT c.relname, c.relkind, c.relacl::text AS relacl,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       (   has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE')
        OR has_table_privilege('anon', c.oid, 'TRUNCATE')) AS anon_can_write
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND NOT c.relrowsecurity
  AND (   has_table_privilege('anon', c.oid, 'SELECT')
       OR has_table_privilege('anon', c.oid, 'INSERT')
       OR has_table_privilege('anon', c.oid, 'UPDATE')
       OR has_table_privilege('anon', c.oid, 'DELETE'))
ORDER BY c.relname;
```

**C. Views and materialized views.** Any `anon_select` true with `security_invoker` false is a bypass of RLS on its base tables.

```sql
SELECT c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner,
       coalesce(c.reloptions::text, '') AS reloptions,
       coalesce(c.reloptions::text[] @> ARRAY['security_invoker=true'], false) AS security_invoker,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('v', 'm')
ORDER BY c.relname;
```

**D. Functions `anon` can execute.** `prosecdef` true ones run with the owner's rights.

```sql
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       p.proacl::text AS proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY p.prosecdef DESC, p.proname;
```

**E. Why new tables get the default.** Shows the default ACL that hands `anon` everything on a table created by a given role.

```sql
SELECT d.defaclrole::regrole AS creating_role,
       d.defaclnamespace::regnamespace AS schema_name,
       d.defaclobjtype AS object_type,
       d.defaclacl::text AS default_acl
FROM pg_default_acl d
ORDER BY 1, 2, 3;
```

**F. Column-level grants,** which the table-level `has_table_privilege` does not show.

```sql
SELECT a.attrelid::regclass AS table_name, a.attname AS column_name, a.attacl::text AS column_acl
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attacl IS NOT NULL
ORDER BY 1, 2;
```

## What the queries would settle, and what they would not

| Question | Settled by |
|---|---|
| How many tables hold `anon` write privilege | A, count of `anon_holds_more_than_select` |
| Whether any table has RLS off | A (`rls_enabled`) and B |
| Whether `partner_vouches` still admits `anon` | A (`n_policies_reaching_anon` on that row) |
| Whether any view bypasses RLS | C |
| Whether the default is the cause, and which role to alter | E |
| Whether the application ever acts as `anon` | **None of them.** That is a code and traffic question, below. |

## Does the application use the `anon` role for table access?

Needed before any revoke, because `anon` is also what a request with no session runs as. EXECUTED greps, not exhaustive:

- The public pages (`app/page.tsx`, pricing, faq, contact, legal, auth, join, rfp/respond) read `profiles` and `org_invitations` only after `auth.getUser()` returns a user. The join page redirects to login when there is none (join-invitation-client.tsx:143-149), and its invitation policy is `TO authenticated`.
- `app/api/contact/route.ts` and `app/api/rfp/guest/[token]/route.ts` use the service role.
- 117 API route files. **9 use the session client and contain no literal `getUser` call** (projects/[id]/assignments, agency/rfp-closure, profile, avatar, documents/delete, documents/[id], documents/upload, notifications, upload/delete). They probably call a shared helper. Each must be read: a session client with no session is `anon`.

So the evidence is that the application does not depend on `anon` holding table privileges. It is not proof, and the 9 files are the gap.

## Proposed order of work, smallest blast radius first

Nothing here is authorised. Each step needs Greg's say-so, and steps 3 onward each need their own census.

0. **Run queries A to F. Change nothing.** One sitting, read-only. Everything after depends on what A returns, and it replaces this document's inference with a measurement.
1. **Settle `partner_vouches`.** If A shows its "Anyone can count vouches" policy is live, that is the one place `anon` can read every row of a table today, and it is already authored (082 phase 2, gated on the vouch RPCs rendering). This is a policy question, not a grant question, and it is the only finding here with an actual reader.
2. **`REVOKE SELECT ON public.brief_interpretations FROM anon;`** One table, one privilege, and a privilege that cannot reach any row today. The smallest possible change; it removes the only grant to `anon` anyone ever wrote on purpose. Reversible by re-granting.
3. **Make new tables safe by default,** a single `ALTER DEFAULT PRIVILEGES FOR ROLE <role from query E> IN SCHEMA public REVOKE ALL ON TABLES FROM anon;`. It touches no existing table, so its blast radius is future tables only. Cost: a future table that genuinely needs `anon` must say so. 103, 104, 105 and 107 already do by hand, which is the argument for making it the default.
4. **Read the 9 session-client route files** and decide whether any can run without a session. This is the census the later revokes need. Zero code change.
5. **Per table, for tables where `n_policies_reaching_anon` is 0 and no anon code path exists:** `REVOKE ALL ON public.<t> FROM anon;`, in small batches, smallest and least-used tables first, one verification (the app's own smoke path plus a re-run of query A) between batches. The payoff here is defence in depth: today RLS is the only barrier, and one mis-written policy (a missing `TO authenticated`, an `OR true`) would expose the table. Do `partnerships`, `profiles` and `organizations` last; they are the tables the most policies were rewritten on.
6. **Tables with a policy that reaches `anon`** (after step 1, probably only `contact_submissions`): decide per table whether the policy should be `TO authenticated` and then revoke. `contact_submissions` may need nothing at all if the route stays on the service role.
7. **Functions** (query D): the 10-odd migrations that already revoke `EXECUTE FROM anon` by name are the model. Anything query D lists that is `prosecdef` and not on that list is the next finding.

Explicitly not proposed: a blanket `REVOKE ALL ... FROM anon` across the schema, or revoking from `authenticated`. The first is step 5 done without the census; the second breaks both portals at once, which is what the 105 baseline found when it tried to reason about column revokes.
