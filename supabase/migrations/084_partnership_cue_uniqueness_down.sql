-- =====================================================================
-- 084 DOWN - drop the two partnership uniqueness indexes
--
-- Safe and complete. An index holds no data, so dropping it destroys
-- nothing and loses nothing that was not derived from the table itself.
--
-- WHAT REVERTING ACTUALLY COSTS. The application-side invariant in
-- lib/broadcast-partnership-cue.ts survives this - in-memory
-- deduplication, the both-keys existence read, and the 23505 branch all
-- keep working. What is lost is the only thing that closes the TOCTOU
-- window between the existence check and the insert: two concurrent
-- broadcasts naming the same recipient could again produce two pending
-- rows for one pair.
--
-- So this is a real regression in guarantee, not a no-op, and it should
-- be paired with turning BROADCAST_CUES_PARTNERSHIP back off unless the
-- duplicate risk is being accepted deliberately.
--
-- IF YOU ARE REVERTING BECAUSE THE UP MIGRATION FAILED: it aborted
-- inside its own transaction and applied nothing. There is nothing to
-- roll back and this file is unnecessary. Run the two duplicate queries
-- in the up migration's STOP GATE instead - a failure there is what a
-- pre-existing duplicate looks like.
-- =====================================================================

BEGIN;

DROP INDEX IF EXISTS public.partnerships_one_per_org_pair;
DROP INDEX IF EXISTS public.partnerships_one_per_ghost_email;

COMMIT;

-- VERIFY - read-only.
--   EXPECT: 0 rows.
-- SELECT i.relname
--   FROM pg_index ix
--   JOIN pg_class i ON i.oid = ix.indexrelid
--   JOIN pg_class t ON t.oid = ix.indrelid
--   JOIN pg_namespace n ON n.oid = t.relnamespace
--  WHERE n.nspname = 'public'
--    AND t.relname = 'partnerships'
--    AND i.relname IN ('partnerships_one_per_org_pair',
--                      'partnerships_one_per_ghost_email');
