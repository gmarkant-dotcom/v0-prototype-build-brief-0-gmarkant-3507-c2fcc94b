# S4 / Phase 2 Migrations Runbook

Updated Aug 11, 2026 during the Phase 2 trio run. **Nothing in this run was applied.** No SQL of
any kind was executed against any database. This doc is the exact procedure for applying the
three outstanding files, in order, with the result to expect from each verification query.

## Current state

| File | Status | Backs |
| --- | --- | --- |
| `071_requirement_tiers.sql` | **APPLIED** (confirmed Aug 11 - `business_criteria_acknowledgments` is live on `partner_rfp_responses`) | Requirement tiers (S4-1) |
| `072_budget_structure.sql` | **NOT APPLIED, and re-authored Aug 11** | Budget structure (P2-1) |
| `074_magic_token_response_deadline.sql` | **APPLIED** (confirmed Aug 11 - live token rows carry real `response_deadline` values) | Magic-link response deadline (F2) |
| `075_rfp_evaluation_criteria.sql` | NOT APPLIED (new) | Per-RFP evaluation criteria (P2-3) |
| `076_structured_proposal_and_bid_close.sql` | NOT APPLIED (new) | Structured proposal sub-fields (P2-2), close bidding at deadline (P2-4) |

There is no 073 on disk. That gap predates this run and is not filled by it - renumbering a
sequence other people have already read is worse than a gap.

## 072 was replaced, not amended

The Aug 5 draft of 072 created two relational tables, `rfp_budget_categories` and
`bid_budget_lines`. Neither exists live, so the draft was never applied and replacing it is
free. It was replaced because `broadcast-rfp` writes one `partner_rfp_inbox` row per (scope item
x recipient), so categories parented on `inbox_item_id` would be duplicated per row with
distinct UUIDs, and two vendors bidding the same scope item would hold lines pointing at
different category rows with the same name. Full reasoning in `docs/p2-reconciliation.md`
section 3 and in the migration file's own header.

The replacement stores budget categories and budget lines as JSONB on rows that already exist,
following the `business_criteria_required` precedent. Two consequences for this runbook:

- **The old "write RLS policies for both new tables before shipping Phase 2 code" step is gone.**
  There are no new tables. Budget data inherits the policies already governing
  `partner_rfp_inbox`, `rfp_magic_tokens`, and `partner_rfp_responses`.
- If the old draft was applied somewhere by accident, drop those two tables before applying the
  new 072 (`DROP TABLE IF EXISTS bid_budget_lines; DROP TABLE IF EXISTS rfp_budget_categories;`).
  They are unreferenced by any code in any branch.

## Order

Apply **072, then 075, then 076.** They do not depend on each other, so the order is only about
blast radius: 072 and 076 are purely additive nullable columns and can be reasoned about in
seconds; 075 alters a live NOT NULL and adds a CHECK to the scoring table, so it goes in the
middle where it gets attention rather than last where it gets rushed.

All Phase 2 application code is written to run **identically with or without all three.** Every
write is guarded to retry without the new field on Postgres `42703` (undefined_column), and
every read treats a missing column as "feature not configured". Applying is what makes the new
data persist; not applying is not a broken state.

---

## Applying 072 (budget structure)

1. Open the Supabase SQL Editor.
2. Paste everything in `supabase/migrations/072_budget_structure.sql` above the `Verification`
   comment block.
3. Run. Expect **Success. No rows returned.**
4. Verification:

   ```sql
   SELECT table_name, column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE (table_name = 'rfp_magic_tokens' AND column_name = 'budget_categories')
      OR (table_name = 'partner_rfp_responses' AND column_name = 'budget_lines')
   ORDER BY table_name;
   ```
   **Expected:** 2 rows, both `data_type = jsonb`, `is_nullable = YES`, `column_default = NULL`.

   ```sql
   SELECT count(*) FROM rfp_magic_tokens WHERE budget_categories IS NOT NULL;
   SELECT count(*) FROM partner_rfp_responses WHERE budget_lines IS NOT NULL;
   ```
   **Expected:** `0`, `0`.

### Rollback (072)

```sql
ALTER TABLE rfp_magic_tokens DROP COLUMN IF EXISTS budget_categories;
ALTER TABLE partner_rfp_responses DROP COLUMN IF EXISTS budget_lines;
```

Safe at any point. Rolling back after deploy means categories defined on the magic-link flow and
category subtotals entered by vendors silently stop persisting - the forms still render and
still submit, they just lose the structured numbers. Note this does **not** remove
`master_rfp_json.budget_categories` from wizard-flow inbox rows, because that data lives inside
an existing column; to clear it as well, run
`UPDATE partner_rfp_inbox SET master_rfp_json = master_rfp_json - 'budget_categories';`.

---

## Applying 075 (per-RFP evaluation criteria)

Read the file's header before running. It is the only outstanding migration that changes an
existing constraint.

1. Paste everything above the `Verification` comment block. The file contains a `DO $$ ... $$`
   block for the CHECK constraint (Postgres `ADD CONSTRAINT` has no `IF NOT EXISTS`), so paste
   it whole - do not split it at the semicolons inside the block.
2. Run. Expect **Success. No rows returned.**
3. Verification:

   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'bid_evaluation_scores'
     AND column_name IN ('criterion_id', 'rfp_criterion_key', 'criterion_name_snapshot')
   ORDER BY column_name;
   ```
   **Expected:** 3 rows. `criterion_id` `is_nullable = YES` (it was `NO`);
   `criterion_name_snapshot` text YES; `rfp_criterion_key` text YES.

   ```sql
   SELECT conname FROM pg_constraint WHERE conname = 'bid_evaluation_scores_exactly_one_criterion';
   SELECT indexname FROM pg_indexes WHERE indexname = 'bid_evaluation_scores_one_per_rfp_criterion';
   ```
   **Expected:** one row each.

   ```sql
   SELECT count(*) FROM bid_evaluation_scores WHERE criterion_id IS NOT NULL;
   SELECT count(*) FROM bid_evaluation_scores WHERE rfp_criterion_key IS NOT NULL;
   ```
   **Expected:** the first count unchanged from before applying (write it down first - nothing
   should have been rewritten); the second `0`.

   ```sql
   SELECT column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_name = 'rfp_magic_tokens' AND column_name = 'evaluation_criteria';
   ```
   **Expected:** one row, `jsonb`, `YES`.

### Rollback (075)

```sql
DROP INDEX IF EXISTS bid_evaluation_scores_one_per_rfp_criterion;
ALTER TABLE bid_evaluation_scores DROP CONSTRAINT IF EXISTS bid_evaluation_scores_exactly_one_criterion;
ALTER TABLE bid_evaluation_scores DROP COLUMN IF EXISTS criterion_name_snapshot;
ALTER TABLE bid_evaluation_scores DROP COLUMN IF EXISTS rfp_criterion_key;
ALTER TABLE rfp_magic_tokens DROP COLUMN IF EXISTS evaluation_criteria;
```

**Order matters** - drop the index and the constraint before the columns they reference.

Restoring `criterion_id NOT NULL` is deliberately **not** part of this rollback. If any bid was
scored against a per-RFP rubric while the migration was live, those rows have a NULL
`criterion_id`, and re-adding NOT NULL would fail. Delete them first if you genuinely want the
original constraint back:
`DELETE FROM bid_evaluation_scores WHERE criterion_id IS NULL;` then
`ALTER TABLE bid_evaluation_scores ALTER COLUMN criterion_id SET NOT NULL;`. That deletes real
evaluation work - do it knowingly.

---

## Applying 076 (structured proposal + close bidding)

1. Paste everything above the `Verification` comment block. Run. Expect
   **Success. No rows returned.**
2. Verification:

   ```sql
   SELECT table_name, column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE (table_name = 'partner_rfp_responses' AND column_name = 'proposal_sections')
      OR (table_name = 'partner_rfp_inbox' AND column_name = 'close_bidding_at_deadline')
      OR (table_name = 'rfp_magic_tokens' AND column_name = 'close_bidding_at_deadline')
   ORDER BY table_name, column_name;
   ```
   **Expected:** 3 rows - `partner_rfp_inbox.close_bidding_at_deadline` boolean `NO` `false`;
   `partner_rfp_responses.proposal_sections` jsonb `YES` `NULL`;
   `rfp_magic_tokens.close_bidding_at_deadline` boolean `NO` `false`.

   ```sql
   SELECT count(*) FROM partner_rfp_responses WHERE proposal_sections IS NOT NULL;
   SELECT count(*) FROM partner_rfp_inbox WHERE close_bidding_at_deadline;
   SELECT count(*) FROM rfp_magic_tokens WHERE close_bidding_at_deadline;
   ```
   **Expected:** `0`, `0`, `0`. The last two are the ones that matter: anything other than zero
   means applying this migration closed live RFPs, which is the exact outcome `DEFAULT false`
   exists to prevent. Roll back immediately if so.

### Rollback (076)

```sql
ALTER TABLE partner_rfp_responses DROP COLUMN IF EXISTS proposal_sections;
ALTER TABLE partner_rfp_inbox DROP COLUMN IF EXISTS close_bidding_at_deadline;
ALTER TABLE rfp_magic_tokens DROP COLUMN IF EXISTS close_bidding_at_deadline;
```

Safe at any point. After deploy, rolling back means structured proposal sub-fields stop
persisting (prose is unaffected) and every RFP reverts to staying open past its deadline, which
is the pre-Phase-2 behavior.

---

## After applying

Update the migrations table in `LIGAMENT_CONTEXT.md` with a row per applied file, then push. The
exact order for the morning is in `docs/p2-run-report.md`'s Morning Checklist.

## What NOT to do

- Do not apply anything before reading the file's own header. Every one of the three explains a
  decision that is not obvious from the SQL alone.
- Do not skip the verification queries. They are the only confirmation that the live schema
  matches what the application code assumes.
- Do not push before applying. Phase 2 code is safe pre-migration by construction, but
  discovering a migration problem after a deploy is a strictly worse position than before one.
- Do not re-add `criterion_id NOT NULL` casually during a 075 rollback (see above).
