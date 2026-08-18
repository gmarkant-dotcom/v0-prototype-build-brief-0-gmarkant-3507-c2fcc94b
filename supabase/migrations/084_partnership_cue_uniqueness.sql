-- =====================================================================
-- 084 - ONE PARTNERSHIP PER AGENCY-VENDOR PAIR, ENFORCED BY POSTGRES
--
-- *** AUTHORED. NOT APPLIED. DO NOT RUN THIS WITHOUT READING THE STOP
-- *** GATE BELOW. IT WILL FAIL, BY DESIGN, IF DUPLICATES ALREADY EXIST.
--
-- WHY THIS EXISTS
--
-- Phase 2 makes an RFP broadcast cue a pending partnerships row per
-- recipient. lib/broadcast-partnership-cue.ts holds the "one row per
-- pair" invariant in application code: it deduplicates targets in
-- memory, reads both identity keys before inserting, and treats 23505
-- as "somebody else got there first" rather than as an error.
--
-- That is check-then-insert, and this product has already lost that
-- race once. LIGAMENT_CONTEXT.md constraint 5 records eight duplicate
-- groups in partner_rfp_inbox, one of them nineteen rows deep, created
-- by two requests eleven milliseconds apart carrying identical dedupe
-- keys. The same shape is present here: /agency/page.tsx can broadcast
-- twice, and the vendor portal fetches two routes in parallel that both
-- run claim logic.
--
-- Application code cannot close a TOCTOU window. Only the database can.
-- These two indexes are what makes the 23505 branch in that helper
-- reachable, which is why the code was written to expect it before the
-- index existed - applying this needs no code change at all.
--
-- WHY TWO INDEXES AND NOT ONE
--
-- A partnership is identified two different ways depending on whether
-- the vendor holds an account:
--
--   * ACCOUNT HOLDER - identified by vendor_org_id.
--   * GHOST (partner_email set, vendor_org_id NULL) - the way this
--     product records a vendor with no account. Identified by email.
--
-- A single index over both columns would treat every ghost row as
-- distinct, because NULL is never equal to NULL in a unique index, and
-- would therefore constrain nothing at all on exactly the rows a
-- broadcast to a typed address creates. Two partial indexes, one per
-- identity, is the only shape that constrains both.
--
-- lower(partner_email) rather than partner_email: every writer in the
-- codebase normalizes to lower case before inserting, but nothing
-- enforces it, and a case difference must not be able to open a second
-- relationship with the same person.
--
-- =====================================================================
-- STOP GATE - RUN THIS FIRST, ALONE, AND READ THE RESULT
-- =====================================================================
--
-- A UNIQUE index cannot be created over a column set that already holds
-- duplicates. If any exist, the CREATE below aborts the whole
-- transaction and nothing is applied - which is the correct failure, but
-- it is a failure, and it should be an expected one rather than a
-- surprise in the SQL editor.
--
-- I COULD NOT RUN THIS. This session had no database credentials
-- (POSTGRES_URL and POSTGRES_PASSWORD empty, no psql, no pg driver), so
-- whether partnerships currently holds duplicates is UNKNOWN and is
-- deliberately not guessed at. The duplicate history documented in this
-- repository is on partner_rfp_inbox, not on partnerships; that is not
-- evidence that partnerships is clean.
--
--   -- A. Account-holder duplicates. EXPECT: 0 rows.
--   SELECT lead_org_id, vendor_org_id, count(*) AS n,
--          array_agg(id ORDER BY created_at, id) AS ids
--     FROM public.partnerships
--    WHERE vendor_org_id IS NOT NULL
--    GROUP BY lead_org_id, vendor_org_id
--   HAVING count(*) > 1;
--
--   -- B. Ghost duplicates. EXPECT: 0 rows.
--   SELECT lead_org_id, lower(partner_email) AS email, count(*) AS n,
--          array_agg(id ORDER BY created_at, id) AS ids
--     FROM public.partnerships
--    WHERE vendor_org_id IS NULL AND partner_email IS NOT NULL
--    GROUP BY lead_org_id, lower(partner_email)
--   HAVING count(*) > 1;
--
-- IF EITHER RETURNS ROWS, STOP AND DO NOT APPLY THIS FILE.
--
-- Collapsing duplicates is DESTRUCTIVE and is deliberately not written
-- here. It is not a mechanical choice: two rows for one pair may hold
-- different statuses, different NDA and MSA state, different
-- payment_terms_requests, and different partnership_notes, and
-- project_assignments and delivery_reviews carry foreign keys to
-- partnership_id that must be repointed at the survivor BEFORE anything
-- is deleted. Which row survives, and what is merged onto it, is Greg's
-- decision on the actual rows - not a rule written in advance by
-- somebody who could not see them.
--
-- There is also a legitimate reason duplicates might exist and be
-- CORRECT: a relationship that was terminated and later re-established.
-- POST /api/partnerships reactivates a terminated row by UPDATE rather
-- than INSERT, so the intended shape is one row per pair - but live data
-- predates that route's current form, and query A is what settles it.
-- If terminated-plus-active pairs turn out to be intentional, these
-- indexes are the wrong shape and need a status predicate, which is a
-- different migration and a different ruling.
--
-- =====================================================================

BEGIN;

-- One relationship per (lead agency, vendor organization).
CREATE UNIQUE INDEX IF NOT EXISTS partnerships_one_per_org_pair
  ON public.partnerships (lead_org_id, vendor_org_id)
  WHERE vendor_org_id IS NOT NULL;

COMMENT ON INDEX public.partnerships_one_per_org_pair IS
  '084. One partnership per agency-vendor pair once the vendor holds an account. Makes the '
  '23505 branch in lib/broadcast-partnership-cue.ts reachable so a concurrent broadcast '
  'cannot duplicate a cued invitation.';

-- One relationship per (lead agency, ghost email), for vendors with no
-- account yet. Case-insensitive: every writer lower-cases, nothing
-- enforced it.
CREATE UNIQUE INDEX IF NOT EXISTS partnerships_one_per_ghost_email
  ON public.partnerships (lead_org_id, lower(partner_email))
  WHERE vendor_org_id IS NULL AND partner_email IS NOT NULL;

COMMENT ON INDEX public.partnerships_one_per_ghost_email IS
  '084. One ghost partnership per agency-email pair. A ghost row (partner_email set, '
  'vendor_org_id NULL) is how this product records a vendor with no account; without this '
  'index NULL <> NULL leaves every such row unconstrained, which is exactly the rows a '
  'broadcast to a typed address creates.';

COMMIT;

-- =====================================================================
-- VERIFY AFTER APPLYING - read-only, with the value each should return
-- =====================================================================
--
--   -- 1. Both indexes exist, are UNIQUE, and are PARTIAL.
--   --    EXPECT: exactly 2 rows; indisunique = t for both; indpred NOT NULL for both.
--   SELECT i.relname                        AS index_name,
--          ix.indisunique,
--          ix.indpred IS NOT NULL           AS is_partial,
--          pg_get_indexdef(ix.indexrelid)   AS definition
--     FROM pg_index ix
--     JOIN pg_class i ON i.oid = ix.indexrelid
--     JOIN pg_class t ON t.oid = ix.indrelid
--     JOIN pg_namespace n ON n.oid = t.relnamespace
--    WHERE n.nspname = 'public'
--      AND t.relname = 'partnerships'
--      AND i.relname IN ('partnerships_one_per_org_pair',
--                        'partnerships_one_per_ghost_email')
--    ORDER BY i.relname;
--
--   -- 2. Row count is UNCHANGED. An index creates and destroys nothing.
--   --    EXPECT: the same number you recorded before applying.
--   SELECT count(*) AS partnerships_rows FROM public.partnerships;
--
--   -- 3. The constraint actually bites. Run inside a transaction and
--   --    ROLL BACK - this deliberately writes nothing.
--   --    EXPECT: the second INSERT raises 23505 unique_violation.
--   -- BEGIN;
--   --   INSERT INTO public.partnerships (lead_org_id, partner_email, status)
--   --   SELECT id, 'gate-test-084@example.invalid', 'pending'
--   --     FROM public.organizations LIMIT 1;
--   --   INSERT INTO public.partnerships (lead_org_id, partner_email, status)
--   --   SELECT id, 'GATE-TEST-084@example.invalid', 'pending'
--   --     FROM public.organizations LIMIT 1;   -- <- must fail, 23505
--   -- ROLLBACK;
--
--   The differing case in step 3 is the point: it proves the
--   lower(partner_email) expression is what is indexed, not the raw
--   column.
--
-- =====================================================================
-- ROLLBACK: supabase/migrations/084_partnership_cue_uniqueness_down.sql
-- =====================================================================
