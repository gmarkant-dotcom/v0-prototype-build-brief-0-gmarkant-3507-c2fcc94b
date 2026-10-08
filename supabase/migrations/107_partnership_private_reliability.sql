-- =====================================================================
-- 107: PARTNERSHIP PRIVATE RELIABILITY. A TABLE THE LEAD AGENCY OWNS AND NO VENDOR CAN READ.
--
-- AUTHORED 2026-10-08 on branch fix/107-reliability-split. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. READ, NOT PARSED. DO NOT APPLY WITHOUT A GREEN
-- PRE-APPLY RUN OF supabase/migrations/107_preapply_test.sql AND GREG'S SAY-SO.
--
-- >>> THE LEAK IS NOT CLOSED BY THIS FILE. <<<
-- >>> AFTER 107 AND BEFORE 108 A VENDOR CAN STILL READ partnerships.reliability_summary THROUGH POSTGREST. <<<
-- >>> IT CLOSES ONLY WHEN 108 RUNS. 107 ADDS THE SAFE PLACE; 108 EMPTIES THE UNSAFE ONE. <<<
--
--   CREATE TABLE public.partnership_private_reliability   (summary + its timestamp: ONE row, moved together)
--   CREATE public.partnership_private_reliability_guard() -> trigger function + BEFORE INSERT OR UPDATE trigger
--   CREATE 3 POLICIES (SELECT, INSERT, UPDATE), all authenticated, all keyed on lead_org_id.
--   NO VENDOR POLICY. NO DELETE POLICY. NO DELETE GRANT.
--   REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT, INSERT, UPDATE to authenticated.
--   BACKFILL the table from partnerships.reliability_summary / _generated_at (copy; the columns are NOT touched).
--   NOTIFY pgrst 'reload schema' so PostgREST sees the new table at commit.
--
-- THE FULL FILENAME IS 107_partnership_private_reliability.sql. Its rollback sibling is
-- 107_partnership_private_reliability_down.sql. Its successor is 108_partnership_reliability_null.sql.
-- DO NOT GLOB.
--
-- =====================================================================
-- WHY THIS IS THE SAME DEFECT AS 105, AND THE EVIDENCE THAT NO VENDOR SCREEN READS IT
-- =====================================================================
--
-- Migration 073 (header, S4) wrote the finding down in its own words: the two columns "are on
-- `partnerships`, not on `delivery_reviews`", the vendor reads their row through "Partners can view
-- their partnerships", "which is row level and therefore grants BOTH columns", and "the real fix is to
-- move the cache to an agency-only table, which needs the agency route to read the new location and
-- therefore needs CODE TO SHIP FIRST". 073 called the content "agency-facing AI prose about a vendor".
--
-- The summary is generated over EVERY completed review (app/api/agency/pool/[partnerId]/performance/
-- route.ts), whether or not the agency shared that review with the vendor (073's per-review
-- shared_with_vendor flag). A per-review share therefore cannot govern an aggregate of all of them:
-- showing the vendor the summary would restate the unshared reviews in prose. The ruling 073 made is
-- already "agency-only". No vendor screen reads the column (docs/107-reliability-split-report.md, census).
-- What did carry it to the vendor's browser was GET /api/partnerships, whose vendor branch selects '*'
-- and stripped only partnership_notes; the code that ships with this file strips these two as well.
--
-- Same mechanism failure as 105: pg_class.relacl for partnerships gives `authenticated` full
-- table-level privilege, so REVOKE SELECT (reliability_summary) removes nothing, and a table-level
-- revoke would take the column from the agency too (one role). A separate table with an agency-only
-- policy is the only mechanism that separates the two by row ownership.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] THE CODE IS DEPLOYED FIRST. app/api/agency/pool/[partnerId]/performance/route.ts reads and
--       writes through lib/server/partnership-private-reliability.ts, which falls back to the legacy
--       columns while this table does not exist. Code first is harmless.
--   [ ] 093 and 087 are applied (the trigger on this table reads partnerships under the caller's own
--       row level security, and the pre-apply test writes partnerships as the owner).
--   [ ] The table does not exist (P2 returns zero rows). Enforced below with LG107.
--   [ ] The pre-apply test has been run and its first line reads "SAFE TO APPLY 107.". Any INCONCLUSIVE
--       is work to do. A NO SUBJECT is NOT a pass.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back.
--
-- DRY RUN: change the final COMMIT; to ROLLBACK;, run it, then run P2. EXPECTED: zero rows
-- (the table is gone). Change it back. A dry run that was not proved to roll back is a real apply.
--
-- =====================================================================
-- THE DESIGN
-- =====================================================================
--
--   partnership_id  PK, REFERENCES partnerships(id) ON DELETE CASCADE. Deliberate, as in 105: DELETE
--       /api/partnerships must keep working for a partnership that has a cached summary.
--   lead_org_id     NOT NULL, REFERENCES organizations(id). Denormalised so the policy is one indexable
--       predicate. THE GUARD TRIGGER keeps it equal to partnerships.lead_org_id and makes both key columns
--       immutable, for EVERY caller including the service role.
--   reliability_summary / reliability_summary_generated_at  BOTH nullable, ONE ROW. The route decides
--       staleness by comparing the timestamp with the newest review, so they must be written together and
--       read together. Splitting them across two homes would make a fresh summary look stale or a stale one
--       look fresh. The timestamp is the less sensitive of the two (it says when, not what) but it reveals
--       when the agency last completed a review, shared or not, and it has no vendor use.
--
-- EQUAL OR NARROWER, FOR EVERY ROLE. This file creates a new object and copies data into it. It changes no
-- privilege or policy on any existing table (the pre-apply test fingerprints the partnerships policies and
-- its relacl before and after). The vendor GAINS nothing. The agency GAINS a place to keep the cache that no
-- vendor can read.
--
-- =====================================================================
-- ORDER
-- =====================================================================
--   1. Deploy the branch code (harmless before this file: it falls back to the legacy columns).
--   2. Pre-apply test: supabase/migrations/107_preapply_test.sql. READ THE ERROR IT RAISES.
--   3. Dry run (COMMIT -> ROLLBACK), prove it rolled back with P2.
--   4. Real apply. Verify V1 to V7.
--   5. Open a vendor's Performance History on production (it regenerates the summary if none is cached).
--   6. THEN 108, to close the leak.
--
-- =====================================================================
-- PRE-FLIGHT. RUN BEFORE THE REAL APPLY. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- P1. THE COLUMNS EXIST AND HOLD DATA TO COPY.
--
--   SELECT count(*) FILTER (WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL) AS with_cache,
--          count(*) AS total
--   FROM public.partnerships;
--
--   WRITE DOWN with_cache. V4 must show at least that many rows in the new table.
--
-- P2. THE TABLE DOES NOT EXIST.
--
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'partnership_private_reliability';
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
--   WHERE n.nspname = 'public' AND c.relname = 'partnership_private_reliability';
--
--   EXPECTED: one row, relrowsecurity = true.
--
-- V2. THREE POLICIES, ALL authenticated, NO DELETE, NO VENDOR REFERENCE.
--
--   SELECT policyname, cmd, roles::text, qual, with_check FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'partnership_private_reliability' ORDER BY cmd, policyname;
--
--   EXPECTED: 3 rows (INSERT, SELECT, UPDATE), roles = {authenticated}, and no qual or with_check
--   containing vendor_org_id or partnerships.
--
-- V3. anon AND PUBLIC HAVE NOTHING; authenticated HAS NO DELETE.
--
--   SELECT has_table_privilege('anon', 'public.partnership_private_reliability', 'SELECT')   AS anon_select,
--          has_table_privilege('anon', 'public.partnership_private_reliability', 'INSERT')   AS anon_insert,
--          has_table_privilege('authenticated', 'public.partnership_private_reliability', 'SELECT') AS auth_select,
--          has_table_privilege('authenticated', 'public.partnership_private_reliability', 'INSERT') AS auth_insert,
--          has_table_privilege('authenticated', 'public.partnership_private_reliability', 'UPDATE') AS auth_update,
--          has_table_privilege('authenticated', 'public.partnership_private_reliability', 'DELETE') AS auth_delete;
--
--   EXPECTED: false, false, true, true, true, false.
--
-- V4. THE BACKFILL IS COMPLETE AND IDENTICAL.
--
--   SELECT (SELECT count(*) FROM public.partnership_private_reliability) AS in_table,
--          (SELECT count(*) FROM public.partnerships p
--             LEFT JOIN public.partnership_private_reliability n ON n.partnership_id = p.id
--           WHERE (p.reliability_summary IS NOT NULL OR p.reliability_summary_generated_at IS NOT NULL)
--             AND (n.partnership_id IS NULL
--                  OR n.reliability_summary IS DISTINCT FROM p.reliability_summary
--                  OR n.reliability_summary_generated_at IS DISTINCT FROM p.reliability_summary_generated_at)) AS mismatched;
--
--   EXPECTED: in_table = P1's with_cache (plus any rows the new code has written since), mismatched = 0
--   immediately after the commit. LATER, mismatched may be above 0 and that is fine: the app writes only the
--   table now, so a regenerated summary makes the legacy copy older than its table row. 108's guard accepts
--   exactly that and refuses the opposite.
--
-- V5. THE TRIGGER.
--
--   SELECT tgname, tgenabled, (tgtype & 2) = 2 AS before_event, (tgtype & 4) = 4 AS on_insert,
--          (tgtype & 16) = 16 AS on_update FROM pg_trigger
--   WHERE tgrelid = 'public.partnership_private_reliability'::regclass AND NOT tgisinternal;
--
--   EXPECTED: one row, tgenabled = 'O', all three booleans true.
--
--   SELECT has_function_privilege('anon', 'public.partnership_private_reliability_guard()', 'EXECUTE') AS f1,
--          has_function_privilege('authenticated', 'public.partnership_private_reliability_guard()', 'EXECUTE') AS f2;
--
--   EXPECTED: false, false.
--
-- V6. NOTHING ON partnerships MOVED. Re-run P4. EXPECTED: n_policies and fingerprint equal P4's.
--
--   SELECT relacl::text FROM pg_class WHERE oid = 'public.partnerships'::regclass;
--   EXPECTED: unchanged from before.
--
-- V7. THE LEAK WINDOW IS OPEN, AS STATED. (A fact to know, not a pass/fail.)
--
--   SELECT count(*) FROM public.partnerships
--   WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
--
--   EXPECTED: P1's with_cache. Those are readable by the vendor until 108 runs.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 202 and COMMIT is at line 359.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.partnerships') IS NULL OR to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '107 refuses to apply: public.partnerships or public.organizations does not exist.'
      USING ERRCODE = 'LG107';
  END IF;

  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '107 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG107';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'partnerships'
         AND column_name IN ('reliability_summary', 'reliability_summary_generated_at')) <> 2 THEN
    RAISE EXCEPTION '107 refuses to apply: partnerships.reliability_summary or reliability_summary_generated_at does not exist, so there is nothing to copy.'
      USING ERRCODE = 'LG107';
  END IF;

  IF to_regclass('public.partnership_private_reliability') IS NOT NULL THEN
    RAISE EXCEPTION '107 refuses to apply: public.partnership_private_reliability already exists. Read the schema before going further.'
      USING ERRCODE = 'LG107';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. THE TABLE. The summary and its timestamp are ONE row: they are read and written together.
-- ---------------------------------------------------------------------
CREATE TABLE public.partnership_private_reliability (
  partnership_id                   uuid        PRIMARY KEY REFERENCES public.partnerships (id) ON DELETE CASCADE,
  lead_org_id                      uuid        NOT NULL    REFERENCES public.organizations (id),
  reliability_summary              text,
  reliability_summary_generated_at timestamptz,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX partnership_private_reliability_lead_org_id_idx
  ON public.partnership_private_reliability (lead_org_id);

COMMENT ON TABLE public.partnership_private_reliability IS
  'Migration 107. The cached AI reliability narrative about a vendor and the time it was computed. It is computed over EVERY completed delivery review, shared with the vendor or not (073), so it is the lead agency''s private view. Agency-only: there is NO vendor policy. Replaces partnerships.reliability_summary and reliability_summary_generated_at, which a vendor can read through the whole-row SELECT policy.';

-- ---------------------------------------------------------------------
-- 2. THE GUARD. Keeps lead_org_id equal to the partnership's, and both key columns immutable.
--    It runs for every caller, the service role included.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.partnership_private_reliability_guard()
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
      RAISE EXCEPTION 'partnership_private_reliability.partnership_id and lead_org_id cannot be changed'
        USING ERRCODE = 'LG107';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT. Read under the CALLER's row level security: an agency member sees only the
  -- partnerships its own organizations lead, so a partnership it does not lead is "not found".
  SELECT p.lead_org_id INTO v_lead FROM public.partnerships p WHERE p.id = NEW.partnership_id;

  IF v_lead IS NULL OR v_lead IS DISTINCT FROM NEW.lead_org_id THEN
    RAISE EXCEPTION 'partnership_private_reliability: lead_org_id must be the lead organization of an existing partnership the caller can see'
      USING ERRCODE = 'LG107';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER partnership_private_reliability_guard
  BEFORE INSERT OR UPDATE ON public.partnership_private_reliability
  FOR EACH ROW
  EXECUTE FUNCTION public.partnership_private_reliability_guard();

REVOKE EXECUTE ON FUNCTION public.partnership_private_reliability_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partnership_private_reliability_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partnership_private_reliability_guard() FROM authenticated;

-- ---------------------------------------------------------------------
-- 3. PRIVILEGES. anon gets nothing, by name. authenticated gets SELECT, INSERT, UPDATE only.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.partnership_private_reliability FROM PUBLIC;
REVOKE ALL ON TABLE public.partnership_private_reliability FROM anon;
REVOKE ALL ON TABLE public.partnership_private_reliability FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.partnership_private_reliability TO authenticated;
GRANT ALL ON TABLE public.partnership_private_reliability TO service_role;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY. THREE POLICIES. NONE IS FOR A VENDOR. NO DELETE POLICY.
-- ---------------------------------------------------------------------
ALTER TABLE public.partnership_private_reliability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partnership_private_reliability_org_select"
  ON public.partnership_private_reliability AS PERMISSIVE FOR SELECT TO authenticated
  USING (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partnership_private_reliability_org_insert"
  ON public.partnership_private_reliability AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "partnership_private_reliability_org_update"
  ON public.partnership_private_reliability AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (lead_org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (lead_org_id IN (SELECT public.current_user_org_ids()));

-- ---------------------------------------------------------------------
-- 5. BACKFILL. A COPY of every row holding either column. The legacy columns are NOT touched (108 does that).
-- ---------------------------------------------------------------------
INSERT INTO public.partnership_private_reliability
  (partnership_id, lead_org_id, reliability_summary, reliability_summary_generated_at)
SELECT p.id, p.lead_org_id, p.reliability_summary, p.reliability_summary_generated_at
FROM public.partnerships p
WHERE p.reliability_summary IS NOT NULL OR p.reliability_summary_generated_at IS NOT NULL
ON CONFLICT (partnership_id) DO NOTHING;

DO $backfill_check$
DECLARE
  v_src      bigint;
  v_dst      bigint;
  v_mismatch bigint;
BEGIN
  SELECT count(*) INTO v_src FROM public.partnerships
   WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
  SELECT count(*) INTO v_dst FROM public.partnership_private_reliability;
  SELECT count(*) INTO v_mismatch
  FROM public.partnerships p
  LEFT JOIN public.partnership_private_reliability n ON n.partnership_id = p.id
  WHERE (p.reliability_summary IS NOT NULL OR p.reliability_summary_generated_at IS NOT NULL)
    AND (n.partnership_id IS NULL
         OR n.reliability_summary IS DISTINCT FROM p.reliability_summary
         OR n.reliability_summary_generated_at IS DISTINCT FROM p.reliability_summary_generated_at);

  IF v_mismatch <> 0 OR v_dst <> v_src THEN
    RAISE EXCEPTION '107 backfill is not an exact copy: % partnership(s) with a cached summary or timestamp, % row(s) in the new table, % mismatched. Nothing was committed.',
      v_src, v_dst, v_mismatch
      USING ERRCODE = 'LG107';
  END IF;
END
$backfill_check$;

-- PostgREST must see the table at commit, or the code keeps falling back to the legacy columns.
NOTIFY pgrst, 'reload schema';

COMMIT;
