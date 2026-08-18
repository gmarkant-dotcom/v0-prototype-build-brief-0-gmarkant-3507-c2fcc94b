-- =====================================================================
-- Migration 087 DOWN. Reverses 087_partnership_vendor_identity.sql.
--
-- This RESTORES A KNOWN PRIVILEGE ESCALATION. Run it only because 087
-- broke something, and read WHAT YOU ARE PUTTING BACK below before you do.
--
-- =====================================================================
-- TRANSACTION CONTROL. This file carries an explicit BEGIN on LINE 64 and an
-- explicit COMMIT on LINE 87. Those are the only executable occurrences.
-- TO DRY RUN: change the COMMIT; on line 87 to ROLLBACK; and run the whole
-- file. Verify before trusting:
--   grep -n '^BEGIN;$'  -> exactly one hit, line 64
--   grep -n '^COMMIT;$' -> exactly one hit, line 87
--
-- =====================================================================
-- WHAT YOU ARE PUTTING BACK
-- =====================================================================
--
-- After this file runs, "Agencies can create partnerships" constrains
-- lead_org_id and says nothing about vendor_org_id again, and nothing
-- pins lead_org_id against being rewritten. That means:
--
--   Any lead agency account can insert a pending partnership naming any
--   organization id it can obtain - and organization ids are obtainable
--   from public.partner_vouches, whose "Anyone can count vouches" policy
--   is SELECT {public} USING (true) until migration 082 is applied - and
--   thereby read that organization's members' whole profiles rows:
--   default_terms, business_criteria, default_nda_url, email, everything.
--
--   Any vendor account holding one real partnership can rewrite that
--   row's lead_org_id to any organization id and get the same read
--   against a lead agency.
--
-- IF YOU ARE RUNNING THIS BECAUSE ONE PART OF 087 MISBEHAVED, PREFER THE
-- PARTIAL ROLLBACKS BELOW OVER THE WHOLE FILE. They are listed first for
-- that reason.
--
-- ---------------------------------------------------------------------
-- PARTIAL ROLLBACK A: the trigger is refusing a legitimate update.
-- Symptom: a 42501 "immutable" or a 23514 "no member whose email matches"
-- from a path that should work. This leaves the INSERT fix in place.
--
--   DROP TRIGGER IF EXISTS partnerships_guard_identity_columns ON public.partnerships;
--
-- The function can stay; a trigger function with no trigger does nothing.
--
-- ---------------------------------------------------------------------
-- PARTIAL ROLLBACK B: the INSERT policy is refusing a legitimate invite.
-- Symptom: 42501 "new row violates row-level security policy for table
-- partnerships" from /agency/pool Add Partner or from awarding a bid.
-- This leaves the trigger, and therefore the lead_org_id pin, in place.
--
--   DROP POLICY IF EXISTS "Agencies can create partnerships" ON public.partnerships;
--   CREATE POLICY "Agencies can create partnerships"
--     ON public.partnerships AS PERMISSIVE FOR INSERT TO authenticated
--     WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));
--
-- BEFORE RUNNING EITHER, CAPTURE THE FAILING CASE: the exact row being
-- written, and the error code. A rollback with no captured case cannot be
-- turned into a corrected 088.
-- =====================================================================


BEGIN;

-- 1. Detach and drop the UPDATE guard.
DROP TRIGGER IF EXISTS partnerships_guard_identity_columns ON public.partnerships;
DROP FUNCTION IF EXISTS public.partnerships_guard_identity_columns();

-- 2. Restore the INSERT policy exactly as migration 079 created it
--    (079_organizations.sql lines 1464-1466), character for character.
DROP POLICY IF EXISTS "Agencies can create partnerships" ON public.partnerships;

CREATE POLICY "Agencies can create partnerships"
  ON public.partnerships AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

-- 3. Drop the helper LAST, after nothing references it.
--
--    Deliberately NOT "DROP ... CASCADE". If something else has started
--    calling this function since 087 was applied, a plain DROP fails with
--    a dependency error and tells you what. CASCADE would silently drop
--    that caller too, which on this schema means silently dropping a
--    policy.
DROP FUNCTION IF EXISTS public.org_has_member_with_email(uuid, text);

COMMIT;


-- =====================================================================
-- VERIFICATION AFTER ROLLING BACK. EXPECTED VALUES STATED.
-- =====================================================================
--
-- D1. The helper and the trigger are gone.
--
--       SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public'
--         AND p.proname IN ('org_has_member_with_email',
--                           'partnerships_guard_identity_columns');
--       -- EXPECTED: 0
--
--       SELECT count(*) FROM pg_trigger
--       WHERE tgrelid = 'public.partnerships'::regclass AND NOT tgisinternal;
--       -- EXPECTED: 0
--
-- D2. Six policies on partnerships, and the INSERT one is back to its
--     079 text.
--
--       SELECT policyname, cmd, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'partnerships'
--       ORDER BY policyname;
--
--     EXPECTED: 6 rows. "Agencies can create partnerships" with_check
--     reads `(lead_org_id IN ( SELECT current_user_org_ids() AS ...))` and
--     mentions vendor_org_id nowhere.
--
-- D3. The six current_user_* helpers are still the six. This file must not
--     have touched any of them, and neither did 087.
--
--       SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%'
--       ORDER BY p.proname;
--       -- EXPECTED: the same 6 names migration 085's V1 lists.
--
-- D4. A legitimate invite still works. As gmarkant@gmail.com, /agency/pool,
--     Add Partner by email. EXPECTED: it succeeds - it did before 087 and
--     it must again.
