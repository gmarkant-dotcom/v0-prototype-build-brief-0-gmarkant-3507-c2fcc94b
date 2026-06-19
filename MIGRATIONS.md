# Migrations

## Sequence for every migration

1. Create the SQL file at `supabase/migrations/[number]_[description].sql`
2. Run it in the Supabase SQL Editor
3. Confirm "Success. No rows returned" (or row count for data mutations)
4. Update `LIGAMENT_CONTEXT.md` with the new migration number and description
5. If the migration creates a new table with RLS or modifies policies, run:
   ```
   npm run verify-rls
   ```
   and confirm output shows `PASS` before deploying dependent code

## RLS checklist for new tables

Any `CREATE TABLE` migration that enables RLS must include ALL of the following or the
table will be inaccessible to authenticated users:

```sql
-- 1. Enable RLS
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

-- 2. Create at least one policy (required -- RLS with zero policies locks everyone out)
CREATE POLICY "Users manage their own rows"
  ON my_table FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Grant permissions to roles (dashboard does this automatically; SQL migrations do not)
GRANT SELECT, INSERT, UPDATE, DELETE ON my_table TO authenticated;
GRANT SELECT ON my_table TO anon;  -- only if anonymous read is intended
```

**Omitting the GRANT is the most common migration mistake.** Tables created via the
Supabase dashboard get auto-grants; tables created via raw SQL do not. Both will show
`relrowsecurity = true` in `pg_class`, giving a false sense of security.

## Verify after every RLS migration

```bash
npm run verify-rls
```

This script queries `pg_class` and `pg_policy` and prints a warning for any table
that has RLS enabled but zero policies attached - the exact failure mode that causes
a 403 on all reads and writes with no obvious error message.

Run this before every deployment of code that depends on the migrated table.
