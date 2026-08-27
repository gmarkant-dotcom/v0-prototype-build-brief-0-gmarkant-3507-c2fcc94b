# 096 - Phase 0 baseline and the reader census

Recorded before any file in this session was edited, at
`5fa1286 docs: phase 5, gates against the phase 0 baseline and the session report`,
on branch `feat/bid-notification-scope`, working tree clean.

Every number here was EXECUTED, not read from a document. Phase 5 re-runs the same
six commands and compares against this file and nothing else.

---

## 1. The six gates, as measured

| # | Command | Exit | Measured |
|---|---------|------|----------|
| 1 | `npx tsc --noEmit` | **0** | zero diagnostic lines |
| 2 | `pnpm build` | **0** | compiled in 8.1s, 72/72 static pages, 173 route lines |
| 3 | `pnpm lint` | **1** | **182 problems (154 errors, 28 warnings)** |
| 4 | `pnpm identity-columns:guard` | **0** | 387 files scanned, TOTAL 0 in 0 files, GUARD PASSED |
| 5 | `pnpm org-id-reads:guard` | **0** | OPEN 60, REGRESSIONS 0, **IMPROVED 1**, GUARD PASSED |
| 6 | `pnpm embed-targets` | **0** | 387 files scanned, REPOINTED 0, PERSON 0, TOTAL 0 |

`pnpm lint` exits 1 at baseline. That is the pre-existing state of this branch, not a
regression introduced here. The number to hold is **182 / 154 / 28**.

`pnpm org-id-reads:guard` reports at baseline:

```
CLASS B: these files now have FEWER findings than KNOWN_OPEN_MIRROR records.
Lower the count, or delete the entry if it reached zero:
  lib/entitlements.ts   recorded 1, found 0
```

That line is OPEN-BELL-7 and Phase 4 of this session removes it. It is the one
movement expected between this baseline and Phase 5.

**Not run, deliberately:** `pnpm verify-rls` and `pnpm policy-audit:guard`. Neither
reads a `.ts` file, so neither can move on anything this session touches.

---

## 2. Reader census for `current_user_active_counterparty_user_ids()`

The live `pg_policies` query found exactly one policy. This is the code-side half:
every occurrence in the repository, classified as EXECUTABLE or COMMENT.

Search: `grep -rn "current_user_active_counterparty_user_ids" .` excluding
`node_modules`, `.git`, `.next`. 51 hits in 24 files.

### 2a. EXECUTABLE references - all seven, in full

| File:line | Statement | Live? |
|---|---|---|
| `supabase/migrations/079_organizations.sql:779` | `CREATE OR REPLACE FUNCTION` | the definition |
| `supabase/migrations/079_organizations.sql:808` | `REVOKE EXECUTE ... FROM PUBLIC` | applied |
| `supabase/migrations/079_organizations.sql:811` | `GRANT EXECUTE ... TO authenticated` | applied |
| `supabase/migrations/079_organizations.sql:1258` | policy arm, `CREATE POLICY "Scoped insert notifications"` | **superseded by 094** |
| `supabase/migrations/094_notifications_colleague_scope.sql:335` | policy arm, `ALTER POLICY "Scoped insert notifications"` | **THE ONE LIVE READER** |
| `supabase/migrations/094_notifications_colleague_scope_down.sql:102` | policy arm, restated in the rollback | not applied |
| `supabase/migrations/079_organizations_down.sql:553` | `DROP FUNCTION IF EXISTS` | not applied |

### 2b. Test fixtures

- `docs/094-preapply-test.sql:601` - restates the policy predicate inside the test.
- `docs/094-preapply-test.sql:785` - `position(...)` string probe on `with_check`.

Neither is a reader of the function; both are readers of the policy TEXT.

### 2c. Everything else is a comment

44 further hits across 3 migration files (`085`, `087`, `095`), one route
(`app/api/partnerships/route.ts:1190`), one library (`lib/notifications.ts`, four
places), and 15 documents. Verified mechanically - every one of them is on a line
whose first non-space characters are `--`, or is prose in a `.md`.

### 2d. `.rpc()` calls: NONE

Eight `.rpc()` calls exist in `app/`, `lib/`, `components/`, `hooks/`, `contexts/`:
`org_has_member_with_email`, `decline_org_invitation`, `accept_org_invitation`,
`partner_vouch_count`, `partner_vouch_counts`, `set_active_org`. None is this helper,
and no raw SQL string in the repository calls it.

### 2e. No other function body calls it

Checked every `CREATE FUNCTION` block in `supabase/migrations/`. The helper appears
inside no other function's `AS $$ ... $$`.

---

## VERDICT

**The code-side census agrees with the live query exactly.** The helper has ONE
reader that grants anything: the `WITH CHECK` of `"Scoped insert notifications"` on
`public.notifications`, as last written by `094:329-336`.

**No reader was found that would benefit from the wider set**, so prohibition 4's
report-rather-than-change clause is not triggered. The single reader is the one this
session is fixing, and it is being fixed by adding an arm beside the helper rather
than by touching the helper.
