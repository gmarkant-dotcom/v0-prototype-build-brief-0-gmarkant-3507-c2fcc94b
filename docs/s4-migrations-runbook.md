# S4 Migrations Runbook

Two migration files were authored during the S4 overnight run (Aug 6 2026). **Neither has been applied.** This doc is the exact procedure for applying them - follow the order below, do not skip verification, do not apply 072 tonight.

## Order

1. **071 first, and only 071 for now.** It backs the requirement-tiers feature (S4-1), which is already built and shipped tonight in a pre-migration-safe state - the app works identically with or without this column, but the cannot-meet reason a vendor records won't persist to a second column until 071 is applied (see "What awaits the migration" in the final report).
2. **072 waits.** It backs the Phase 2 budget-structure feature, which has no application code yet (docs/s4-phase2-plan.md is a plan, not a build). Applying it early is harmless (new tables, nothing references them) but there is no reason to before Phase 2 execution day.

## Applying 071

1. Open Supabase SQL Editor.
2. Paste the contents of `supabase/migrations/071_requirement_tiers.sql` (everything above the "Verification" comment block - the verification queries are commented out and run separately, in step 4).
3. Run it. Expect: **Success. No rows returned.**
4. Run the verification queries (uncomment them from the bottom of the file, or copy from below):

   ```sql
   SELECT table_name, column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_name = 'partner_rfp_responses'
     AND column_name = 'business_criteria_acknowledgments';
   ```
   **Expected:** one row - `data_type = jsonb`, `is_nullable = YES`, `column_default = NULL`.

   ```sql
   SELECT count(*) FROM partner_rfp_responses WHERE business_criteria_acknowledgments IS NOT NULL;
   ```
   **Expected:** `0` (no existing bid has ever written this column - it didn't exist until this moment).

5. If both match, the migration is confirmed applied. Update the migrations table in `LIGAMENT_CONTEXT.md` with row `071 | Requirement tiers: business_criteria_acknowledgments jsonb column on partner_rfp_responses for cannot-meet reasons | APPLIED`.
6. **Only then** `git push` the four S4 commits (S4-0, S4-M, S4-1, S4-2P) - see the final report's Morning Checklist for the exact order.

### Rollback (071)

If something is wrong after applying and before pushing/deploying:

```sql
ALTER TABLE partner_rfp_responses DROP COLUMN IF EXISTS business_criteria_acknowledgments;
```

Safe at any point before the app is deployed against it - nothing writes to this column until the S4-1 code (already committed, not yet pushed) is live, and that code's writes are already guarded to retry without the column if it goes missing again (see `saveResponseRow` in `app/api/partner/rfps/[id]/response/route.ts` and `saveGuestResponseRow` in `app/api/rfp/guest/[token]/route.ts`). Rolling back after deploy just means cannot-meet reasons silently stop persisting again (graceful, not broken) until re-applied.

## Applying 072 (Phase 2 execution day - not tonight)

1. Read `docs/s4-phase2-plan.md` in full first - it has open questions this runbook doesn't resolve (RLS policy shape, preset category list finalization).
2. Paste and run `supabase/migrations/072_budget_structure.sql` (everything above "Verification").
3. Verify:

   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_name IN ('rfp_budget_categories', 'bid_budget_lines');
   ```
   **Expected:** both rows present.

   ```sql
   SELECT conname FROM pg_constraint
   WHERE conname IN ('rfp_budget_categories_exactly_one_parent', 'bid_budget_lines_subtotal_has_no_description');
   ```
   **Expected:** both rows present.

   ```sql
   SELECT count(*) FROM rfp_budget_categories;
   SELECT count(*) FROM bid_budget_lines;
   ```
   **Expected:** `0`, `0`.

4. **Before shipping Phase 2 code**, write and apply RLS policies for both new tables (flagged as an open item in the migration file's own comments and in the Phase 2 plan - deliberately not guessed blind tonight).

### Rollback (072)

```sql
DROP TABLE IF EXISTS bid_budget_lines;
DROP TABLE IF EXISTS rfp_budget_categories;
```

Safe any time before Phase 2 application code exists (it doesn't yet).

## What NOT to do

- Do not apply 072 tonight or before Phase 2 execution begins.
- Do not skip the verification queries - they are the only confirmation this run has that the live schema actually matches what these files assume.
- Do not `git push` before 071 is applied and verified. The S4-1 code was built to run safely without 071, but pushing pre-migration and then discovering 071 has a problem is a worse position than applying-then-pushing.
