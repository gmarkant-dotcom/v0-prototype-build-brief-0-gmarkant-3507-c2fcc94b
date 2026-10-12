# Budget spine readiness on main's gate (WS-C), 2026-10-12

Branch `feat/budget-spine-integrated`, cut from `main` at `1a6f53b`, then
`git merge --no-ff feat/budget-spine-server` (merge commit `020432a`). Unattended session. Not pushed,
not merged. Nothing applied; no database access.

## Merge

`feat/budget-spine-server` (3 commits over `40a7286`: `6cadc56`, `cc3af07`, `17f21a4`) and `main`
(11 commits over `40a7286`) touch **disjoint file sets** (29 files on the spine side, 76 on main's;
`git diff --stat 40a7286 <each>` compared). The merge completed with the `ort` strategy and **no
conflicts**. Nothing needed resolving, so main's gate code is untouched.

## Every budget route behind the paid gate

All 20 handlers in the 11 route files authenticate through one function,
`budgetRouteSession()` (`lib/server/budget/http.ts`), either directly or via
`budgetRouteProject()`. The gate was added there, once, using main's wrapper:

- `lib/server/budget/http.ts:40`: `agencyGateRefusal(user.id, supabase)` (from `lib/api-auth.ts`),
  after the 401 and before the spine's own checks; a refusal is returned as-is: **402
  `{"error":"Agency access requires a paid lead-agency account.","code":"agency_entitlement_required","reason":...}`**,
  or 500 `agency_entitlement_unavailable` on a lookup fault, with the spine's `no-store` header.
- The spine's session-scoped checks still run after it, unchanged: org membership from
  `org_members` (403) and the project's `org_id` among the caller's organizations (404), then the
  "Budget spine not enabled" 404 while 103/104 are unapplied.
- No route and no helper under `lib/server/budget/` or `app/api/agency/budget/` reads `role`,
  `active_role` or `secondary_role` (grep: only two comments mention them).

| Route file (`app/api/agency/budget/...`) | Handlers, line of the gate call |
|---|---|
| `templates/route.ts` | GET `:11`, POST `:22` (`budgetRouteSession`) |
| `templates/[categoryId]/route.ts` | PATCH `:10`, DELETE `:27` (`budgetRouteSession`) |
| `projects/[projectId]/chart/route.ts` | GET `:13`, POST `:33` (`budgetRouteProject`) |
| `projects/[projectId]/chart/[categoryId]/route.ts` | POST `:27`, DELETE `:60` |
| `projects/[projectId]/lines/route.ts` | GET `:12`, POST `:25` |
| `projects/[projectId]/lines/[lineId]/route.ts` | PATCH `:12`, DELETE `:35` |
| `projects/[projectId]/ledger/route.ts` | GET `:12`, POST `:26` |
| `projects/[projectId]/ledger/[entryId]/void/route.ts` | POST `:10` |
| `projects/[projectId]/documents/route.ts` | GET `:13`, POST `:30` |
| `projects/[projectId]/documents/[documentId]/route.ts` | PATCH `:13` |
| `projects/[projectId]/summary/route.ts` | GET `:10` |

## Pre-apply tests versus migrations

The tests transcribe each migration statement by statement as `EXECUTE $t103_NN$ ... $t103_NN$;` /
`$t104_NN$`. Three copies exist: 103 in `103_preapply_test.sql` (lines 663-1010), 103 again in
`104_preapply_test.sql` (lines 733-1080, which applies 103 before 104), and 104 in
`104_preapply_test.sql` (lines 1084-1500).

**Machine comparison** (`sed -n '<range>p' <test> | diff -B -I '^ *--' - <migration>`, then the
test-side and migration-side residue listed separately):

| Copy | Statements | Body lines differing | First/last line of each statement (wrapper removed) | Omitted on purpose |
|---|---|---|---|---|
| 103 in 103 test | 65 (`$t103_00`-`$t103_64`) | **none** (only blank lines) | all 65 identical to the migration | the pre-flight DO block (`103_budget_core.sql` after BEGIN) and `NOTIFY pgrst` (test header lines 659-662 say why) |
| 103 in 104 test | 65 | **none**; also identical (whitespace-insensitive) to the 103 test's copy | identical | same |
| 104 in 104 test | 61 (`$t104_00`-`$t104_60`) | **none** | all 61 identical | the pre-flight DO block and `NOTIFY pgrst` |

**Differences found: none.** No test copy and no migration was edited. The "hand-copied, never
compared" caveat is retired for the statement bodies; the wrapper-line pairing (first and last
line of each statement with `EXECUTE $tNNN_NN$` / `$tNNN_NN$;` removed) was read side by side from
the diff output, not by a script, because a second `sed` with a substitution was refused.

## R1-R7 and the 113/114 grant posture

Checked against `docs/budget-spine-build-plan.md` "RULINGS 2026-10-09":

- **R1** `budget_lines_org_delete` USING `(estimate IS NULL OR estimate = 0)` (`103_budget_core.sql:800`);
  `archived_at` on `budget_template_categories` (`:415`), `budget_project_categories` (`:455`),
  `budget_lines` (`:498`). Ledger FKs are NO ACTION. Holds.
- **R2** `ledger_entries`: no DELETE policy, no DELETE grant (`104_budget_ledger.sql:796`);
  `voided_at`/`void_reason`/`duplicate_of` (`:514-516`), composite FK (`:536`), `duplicate_of`
  requires `voided_at` (`:539`) and is not self (`:541`). Holds.
- **R3** `budget_archive_project_documents` / `budget_unarchive_project_documents`
  (`:710`, `:738`): SECURITY INVOKER, pinned, return a row count, touch only `archived_at`, 42501
  unless the caller is the project's agency; the vendor policy ignores `archived_at` (`:837`). Holds.
- **R4** vendor read allow-list `ps.status IN ('active', 'suspended')` plus the authorship exception
  (`:838-853`); the guard refuses a vendor-side INSERT unless active or suspended, service role
  included (`:626-631`). Holds.
- **R5** no Committed/Paid column in either file. Holds.
- **R6** `budget_copy_template_to_project(uuid) RETURNS integer` (`103_budget_core.sql:628`),
  SECURITY INVOKER, pinned, 42501 (`:645`), 23505 (`:652`). Holds.
- **R7 / 113-114 posture.** Every new table: `REVOKE ALL ... FROM PUBLIC`, `FROM anon`, `FROM
  authenticated` by name, then exactly the ruled grants (103: S/I/U/D on the three chart/line
  tables, S/I on merges; 104: S/I/U on `source_documents` and `ledger_entries`); `service_role` ALL.
  **No TRUNCATE, REFERENCES or TRIGGER to authenticated anywhere.** Every grant is used by a policy
  (103: 14 policies, 104: 7, all `TO authenticated`; DELETE granted only where a DELETE policy
  exists). **No function is SECURITY DEFINER**; all six pin `search_path = public, pg_temp`; the
  three trigger functions have EXECUTE revoked from PUBLIC, anon and authenticated; the three
  callable functions have it revoked from PUBLIC and anon and granted to authenticated. Holds.
  The roadmap's "103/104 revoke anon but not authenticated" defect was fixed on
  `fix/103-104-rulings` and is confirmed fixed here.
- **114 interplay.** 114 revoked TRUNCATE/REFERENCES/TRIGGER from tables existing at its apply
  time; 103/104 tables are created later, and their own `REVOKE ALL` by name removes anything a
  default privilege would add (postgres's defaults no longer grant those three; supabase_admin's do
  but do not apply to migration-created tables).

## COMMIT lines for the dry runs (headers verified against the files)

| File | BEGIN | COMMIT |
|---|---|---|
| `103_budget_core.sql` | 369 | **823** |
| `104_budget_ledger.sql` | 368 | **882** |
| `103_budget_core_down.sql` | 36 | 77 |
| `104_budget_ledger_down.sql` | 35 | 62 |

## Gates

`pnpm exec tsc --noEmit`: exit 0. `pnpm lint` (whole repo) exits 1 on pre-existing messages; **no
message in any file under `lib/server/budget/` or `app/api/agency/budget/`**.
