-- =====================================================================
-- 105: PARTNERSHIP PRIVATE NOTES. A TABLE THE LEAD AGENCY OWNS AND NO VENDOR CAN READ.
--
-- AUTHORED 2026-10-08 on branch fix/105-notes-column-revoke. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. PARSE-CHECKED ONLY. DO NOT APPLY WITHOUT A GREEN
-- PRE-APPLY RUN OF supabase/migrations/105_preapply_test.sql AND GREG'S SAY-SO.
--
-- >>> THE LEAK IS NOT CLOSED BY THIS FILE. <<<
-- >>> AFTER 105 AND BEFORE 106 A VENDOR CAN STILL READ partnerships.partnership_notes. <<<
-- >>> IT CLOSES ONLY WHEN 106 RUNS. 105 ADDS THE SAFE PLACE; 106 EMPTIES THE UNSAFE ONE. <<<
--
--   CREATE TABLE public.partnership_private_notes
--   CREATE public.partnership_private_notes_guard() -> trigger function + BEFORE INSERT OR UPDATE trigger
--   CREATE 3 POLICIES (SELECT, INSERT, UPDATE), all authenticated, all keyed on lead_org_id.
--   NO VENDOR POLICY. NO DELETE POLICY. NO DELETE GRANT.
--   REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT, INSERT, UPDATE to authenticated.
--   BACKFILL the table from partnerships.partnership_notes (copy; the column is NOT touched).
--   NOTIFY pgrst 'reload schema' so PostgREST sees the new table at commit.
--
-- THE FULL FILENAME IS 105_partnership_private_notes.sql. Its rollback sibling is
-- 105_partnership_private_notes_down.sql. Its successor is 106_partnership_notes_null.sql.
-- DO NOT GLOB.
--
-- =====================================================================
-- WHY A TABLE AND NOT A REVOKE (measured 2026-10-08 18:03, SQL Editor as postgres)
-- =====================================================================
--
--   pg_attribute.attacl for partnerships.partnership_notes = NULL.
--   pg_class.relacl = {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
--                      authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--
-- `authenticated` holds FULL TABLE-LEVEL privilege, so REVOKE SELECT (partnership_notes) would
-- remove nothing: Postgres accepts the statement and changes no behaviour. And a table-level
-- revoke would take the column from the agency as well, because an agency member and a vendor
-- are the SAME ROLE. The vendor's policy "Partners can view their partnerships" admits the whole
-- row. A separate table with an agency-only policy is the only mechanism that separates the two
-- by row ownership. Migration 073 (S4) reached the same conclusion for reliability_summary.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] THE CODE IS DEPLOYED FIRST. The branch's route changes read and write through
--       lib/server/partnership-private-notes.ts, which falls back to the legacy column while this
--       table does not exist. Code first is harmless. This file first, with old code deployed,
--       leaves the old code writing the legacy column and those writes MISSING from the table
--       (106 refuses to run if it finds any such drift).
--   [ ] 093 and 087 are applied (the trigger on this table reads partnerships under the caller's
--       own row level security, and the pre-apply test writes partnerships as the owner).
--   [ ] The table does not exist (P2 returns zero rows). Enforced below with LG105.
--   [ ] The pre-apply test has been run and its first line reads "SAFE TO APPLY 105.". Any
--       INCONCLUSIVE is work to do. A NO SUBJECT is NOT a pass.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back.
--
-- DRY RUN: change the final COMMIT; to ROLLBACK;, run it, then run P2. EXPECTED: zero rows
-- (the table is gone). Change it back. A dry run that was not proved to roll back is a real apply.
--
-- =====================================================================
-- THE DESIGN, AND WHY EACH PART IS THERE
-- =====================================================================
--
--   partnership_id  PK, REFERENCES partnerships(id) ON DELETE CASCADE.
--       CASCADE IS DELIBERATE and differs from 104's "nothing cascades". DELETE /api/partnerships
--       removes a partnership; with NO ACTION a partnership that has notes could not be deleted,
--       which breaks a live feature. The notes describe the partnership and have no meaning
--       without it, so they go with it.
--   lead_org_id     NOT NULL, REFERENCES organizations(id). Denormalised so the policy is one
--       indexable predicate and needs no join. THE GUARD TRIGGER keeps it equal to
--       partnerships.lead_org_id, and makes both columns immutable, for EVERY caller including
--       the service role (a service-role route that passes the wrong organization is refused
--       rather than trusted).
--   notes           jsonb NOT NULL DEFAULT '{}'. The same object partnership_notes held: notes,
--       notes_log, overall_rating, would_work_again, blacklisted, cued_by_broadcast,
--       imported_meta, matched_profile_id, pool_flag.
--
--   POLICIES: lead_org_id IN (SELECT public.current_user_org_ids()). That is the AUTHORITY set
--   (the caller's own organizations), the same predicate "Agencies can view their partnerships"
--   uses. A vendor organization that is not also a member of the lead organization matches nothing.
--   THERE IS NO VENDOR POLICY AT ALL. `anon` is revoked BY NAME rather than left to the absence
--   of a policy: relacl above shows anon holds full table privilege by Supabase default on
--   everything here, so the absence of a policy is the only thing stopping it elsewhere and that
--   is thinner than it should be. authenticated is revoked and re-granted only SELECT, INSERT,
--   UPDATE, so DELETE and TRUNCATE are not granted either.
--
-- EQUAL OR NARROWER, FOR EVERY ROLE. This file creates a new object and copies data into it.
--   It changes no privilege or policy on any existing table (the pre-apply test fingerprints the
--   partnerships policies and its relacl before and after). No role loses a read it has today.
--   The vendor GAINS nothing: the new table has no vendor policy. The agency GAINS a place to
--   keep notes that no vendor can read.
--
-- =====================================================================
-- ORDER
-- =====================================================================
--   1. Deploy the branch code (harmless before this file: it falls back to the legacy column).
--   2. Pre-apply test: supabase/migrations/105_preapply_test.sql. READ THE ERROR IT RAISES.
--   3. Dry run (COMMIT -> ROLLBACK), prove it rolled back with P2.
--   4. Real apply. Verify V1 to V7.
--   5. Watch the notes feature (read a vendor's notes, save one) on production.
--   6. THEN 106, to close the leak.
--
-- =====================================================================
-- PRE-FLIGHT. RUN BEFORE THE REAL APPLY. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- P1. THE COLUMN EXISTS AND HOLDS DATA TO COPY.
--
--   SELECT count(*) FILTER (WHERE partnership_notes IS NOT NULL) AS with_notes, count(*) AS total
--   FROM public.partnerships;
--
--   WRITE DOWN with_notes. V4 must show the same number of rows in the new table.
--
-- P2. THE TABLE DOES NOT EXIST.
--
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'partnership_private_notes';
--
--   EXPECTED: zero rows. If one exists, STOP.
--
-- P3. THE HELPERS THE POLICY AND THE TRIGGER DEPEND ON.
--
--   SELECT to_regprocedure('public.current_user_org_ids()') IS NOT NULL AS h1,
--          to_regclass('public.organizations') IS NOT NULL AS h2;
--
--   EXPECTED: true, true.
--
-- P4. THE POLICY FINGERPRINT OF partnerships, TO SHOW NOTHING MOVED.
--
--   SELECT count(*) AS n_policies,
--          md5(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' ||
--                         coalesce(with_check, ''), E'\n' ORDER BY policyname)) AS fingerprint
--   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partnerships';
--
--   WRITE DOWN BOTH.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. ROW LEVEL SECURITY IS ON.
--
--   SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'partnership_private_notes';
--
--   EXPECTED: one row, relrowsecurity = true.
--
-- V2. THREE POLICIES, ALL authenticated, NO DELETE, NO VENDOR REFERENCE.
--
--   SELECT policyname, cmd, roles::text, qual, with_check FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'partnership_private_notes' ORDER BY cmd, policyname;
--
--   EXPECTED: 3 rows (INSERT, SELECT, UPDATE), roles = {authenticated}, and no qual or with_check
--   containing vendor_org_id or partnerships.
--
-- V3. anon AND PUBLIC HAVE NOTHING; authenticated HAS NO DELETE.
--
--   SELECT has_table_privilege('anon', 'public.partnership_private_notes', 'SELECT')   AS anon_select,
--          has_table_privilege('anon', 'public.partnership_private_notes', 'INSERT')   AS anon_insert,
--          has_table_privilege('authenticated', 'public.partnership_private_notes', 'SELECT') AS auth_select,
--          has_table_privilege('authenticated', 'public.partnership_private_notes', 'INSERT') AS auth_insert,
--          has_table_privilege('authenticated', 'public.partnership_private_notes', 'UPDATE') AS auth_update,
--          has_table_privilege('authenticated', 'public.partnership_private_notes', 'DELETE') AS auth_delete;
--
--   EXPECTED: false, false, true, true, true, false.
--
-- V4. THE BACKFILL IS COMPLETE AND IDENTICAL.
--
--   SELECT (SELECT count(*) FROM public.partnership_private_notes) AS in_table,
--          (SELECT count(*) FROM public.partnerships p
--             LEFT JOIN public.partnership_private_notes n ON n.partnership_id = p.id
--           WHERE p.partnership_notes IS NOT NULL AND n.notes IS DISTINCT FROM p.partnership_notes) AS mismatched;
--
--   EXPECTED: in_table = P1's with_notes (plus any rows the new code has written since), mismatched = 0.
--
-- V5. THE TRIGGER.
--
--   SELECT tgname, tgenabled, (tgtype & 2) = 2 AS before_event, (tgtype & 4) = 4 AS on_insert,
--          (tgtype & 16) = 16 AS on_update FROM pg_trigger
--   WHERE tgrelid = 'public.partnership_private_notes'::regclass AND NOT tgisinternal;
--
--   EXPECTED: one row, tgenabled = 'O', all three booleans true.
--
--   SELECT has_function_privilege('anon', 'public.partnership_private_notes_guard()', 'EXECUTE') AS f1,
--          has_function_privilege('authenticated', 'public.partnership_private_notes_guard()', 'EXECUTE') AS f2;
--
--   EXPECTED: false, false.
--
-- V6. NOTHING ON partnerships MOVED. Re-run P4. EXPECTED: n_policies and fingerprint equal P4's.
--
--   SELECT relacl::text FROM pg_class WHERE oid = 'public.partnerships'::regclass;
--   EXPECTED: unchanged from before: postgres, anon, authenticated, service_role all arwdDxtm.
--
-- V7. THE LEAK WINDOW IS OPEN, AS STATED. (This is a fact to know, not a pass/fail.)
--
--   SELECT count(*) FROM public.partnerships WHERE partnership_notes IS NOT NULL;
--
--   EXPECTED: P1's with_notes. Those are readable by the vendor until 106 runs.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 201 and COMMIT is at line 351.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.partnerships') IS NULL OR to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '105 refuses to apply: public.partnerships or public.organizations does not exist.'
      USING ERRCODE = 'LG105';
  END IF;

  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '105 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG105';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'partnerships' AND column_name = 'partnership_notes') THEN
    RAISE EXCEPTION '105 refuses to apply: partnerships.partnership_notes does not exist, so there is nothing to copy.'
      USING ERRCODE = 'LG105';
  END IF;

  IF to_regclass('public.partnership_private_notes') IS NOT NULL THEN
    RAISE EXCEPTION '105 refuses to apply: public.partnership_private_notes already exists. Read the schema before going further.'
      USING ERRCODE = 'LG105';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. THE TABLE.
-- ---------------------------------------------------------------------
CREATE TABLE public.partnership_private_notes (
  partnership_id uuid        PRIMARY KEY REFERENCES public.partnerships (id) ON DELETE CASCADE,
  lead_org_id    uuid        NOT NULL    REFERENCES public.organizations (id),
  notes          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX partnership_private_notes_lead_org_id_idx
  ON public.partnership_private_notes (lead_org_id);

COMMENT ON TABLE public.partnership_private_notes IS
  'Migration 105. The lead agency''s PRIVATE notes on a vendor: free text, rating, would-work-again, the blacklist flag, the broadcast cue, import metadata. Agency-only: there is NO vendor policy. Replaces partnerships.partnership_notes, which a vendor can read through the whole-row SELECT policy.';

-- ---------------------------------------------------------------------
-- 2. THE GUARD. Keeps lead_org_id equal to the partnership's, and both columns immutable.
--    It runs for every caller, the service role included.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.partnership_private_notes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.partnership_id IS DISTINCT FROM OLD.partnership_id
       OR NEW.lead_org_id IS DISTINCT FROM OLD.lead_org_id THEN
      RAISE EXCEPTION 'partnership_private_notes.partnership_id and lead_org_id cannot be changed'
        USING ERRCODE = 'LG105';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT. Read under the CALLER's row level security: an agency member sees only the
  -- partnerships its own organizations lead, so a partnership it does not lead is "not found".
  SELECT p.lead_org_id INTO v_lead FROM public.partnerships p WHERE p.id = NEW.partnership_id;

  IF v_lead IS NULL OR v_lead IS DISTINCT FROM NEW.lead_org_id THEN
    RAISE EXCEPTION 'partnership_private_notes: lead_org_id must be the lead organization of an existing partnership the caller can see'
      USING ERRCODE = 'LG105';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER partnership_private_notes_guard
  BEFORE INSERT OR UPDATE ON public.partnership_private_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.partnership_private_notes_guard();

REVOKE EXECUTE ON FUNCTION public.partnership_private_notes_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partnership_private_notes_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partnership_private_notes_guard() FROM authenticated;

-- ---------------------------------------------------------------------
-- 3. PRIVILEGES. anon gets nothing, by name. authenticated gets SELECT, INSERT, UPDATE only.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.partnership_private_notes FROM PUBLIC;
REVOKE ALL ON TABLE public.partnership_private_notes FROM anon;
REVOKE ALL ON TABLE public.partnership_private_notes FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.partnership_private_notes TO authenticated;
GRANT ALL ON TABLE public.partnership_private_notes TO service_role;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY. THREE POLICIES. NONE IS FOR A VENDOR. NO DELETE POLICY.
-- ---------------------------------------------------------------------
ALTER TABLE public.partnership_private_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partnership_private_notes_org_select"
  ON public.partnership_private_notes AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partnership_private_notes_org_insert"
  ON public.partnership_private_notes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partnership_private_notes_org_update"
  ON public.partnership_private_notes AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

-- ---------------------------------------------------------------------
-- 5. BACKFILL. A COPY. partnerships.partnership_notes IS NOT TOUCHED (106 does that).
-- ---------------------------------------------------------------------
INSERT INTO public.partnership_private_notes (partnership_id, lead_org_id, notes)
SELECT p.id, p.lead_org_id, p.partnership_notes
FROM public.partnerships p
WHERE p.partnership_notes IS NOT NULL
ON CONFLICT (partnership_id) DO NOTHING;

DO $backfill_check$
DECLARE
  v_src      bigint;
  v_dst      bigint;
  v_mismatch bigint;
BEGIN
  SELECT count(*) INTO v_src FROM public.partnerships WHERE partnership_notes IS NOT NULL;
  SELECT count(*) INTO v_dst FROM public.partnership_private_notes;
  SELECT count(*) INTO v_mismatch
  FROM public.partnerships p
  LEFT JOIN public.partnership_private_notes n ON n.partnership_id = p.id
  WHERE p.partnership_notes IS NOT NULL AND n.notes IS DISTINCT FROM p.partnership_notes;

  IF v_mismatch <> 0 OR v_dst <> v_src THEN
    RAISE EXCEPTION '105 backfill is not an exact copy: % partnership(s) with notes, % row(s) in the new table, % mismatched. Nothing was committed.',
      v_src, v_dst, v_mismatch
      USING ERRCODE = 'LG105';
  END IF;
END
$backfill_check$;

-- PostgREST must see the table at commit, or the new code keeps falling back to the legacy column.
NOTIFY pgrst, 'reload schema';

COMMIT;
