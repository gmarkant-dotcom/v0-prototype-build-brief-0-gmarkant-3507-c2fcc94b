-- =====================================================================
-- 106: NULL partnerships.partnership_notes. THIS IS THE FILE THAT CLOSES THE LEAK.
--
-- AUTHORED 2026-10-08 on branch fix/105-notes-column-revoke. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. PARSE-CHECKED ONLY. DO NOT APPLY WITHOUT A GREEN
-- PRE-APPLY RUN OF supabase/migrations/106_preapply_test.sql AND GREG'S SAY-SO.
-- DEPENDS ON 105: APPLY 105 FIRST, DEPLOY THE CODE, WATCH IT, THEN THIS.
--
--   UPDATE public.partnerships SET partnership_notes = NULL WHERE partnership_notes IS NOT NULL;
--
-- THAT IS THE WHOLE CHANGE. THE COLUMN IS NOT DROPPED. A drop is irreversible and the backfill's
-- correctness is unproven until 105's table is live and being read from. Nulling is reversible
-- from the table (the down file copies it back). WHAT WOULD JUSTIFY THE DROP is in
-- docs/105-notes-split-report.md ("Owed").
--
-- >>> UNTIL THIS FILE RUNS, A VENDOR CAN READ THE LEAD AGENCY'S PRIVATE NOTES, <<<
-- >>> THE BLACKLIST FLAG INCLUDED, THROUGH POSTGREST. <<<
--
-- THE FULL FILENAME IS 106_partnership_notes_null.sql. Its rollback sibling is
-- 106_partnership_notes_null_down.sql. DO NOT GLOB.
--
-- =====================================================================
-- STOP-GATE.
-- =====================================================================
--
--   [ ] 105 IS APPLIED AND VERIFIED (105's V1 to V6 returned their expected values).
--   [ ] THE CODE THAT READS THE TABLE HAS BEEN LIVE FOR A WHILE, and the notes feature was
--       exercised on production: a vendor's notes open, a note saves and reloads, the Vendor
--       Pool shows the blacklist flag on a flagged vendor. After this file the legacy column is
--       empty, so any code still reading it sees nothing.
--   [ ] The pre-flight below is clean (P1 = 0 drift). Enforced inside the transaction with LG106.
--   [ ] The pre-apply test has been run and its first line reads "SAFE TO APPLY 106.".
--   [ ] The DRY RUN has been done and PROVED to have rolled back (P2 again shows the old count).
--
-- DRY RUN: change the final COMMIT; to ROLLBACK;, run, then run P2. EXPECTED: with_notes unchanged.
--
-- =====================================================================
-- DRIFT. WHY THE PRE-FLIGHT REFUSES, AND WHAT TO DO ABOUT IT.
-- =====================================================================
--
-- Between 105's backfill and the code reading the table, a write by an old instance of the app
-- would land in the legacy column only. Nulling that column would destroy it. So this file
-- refuses (LG106) if ANY partnership has a legacy value that is not identical to its table row.
-- To resolve: decide which copy is right. The table is the source of truth once the new code is
-- live; if the legacy value is newer, copy it over by hand:
--
--   UPDATE public.partnership_private_notes n SET notes = p.partnership_notes, updated_at = now()
--   FROM public.partnerships p WHERE p.id = n.partnership_id AND p.partnership_notes IS NOT NULL
--     AND p.partnership_notes IS DISTINCT FROM n.notes;          -- only after reading the rows
--   INSERT INTO public.partnership_private_notes (partnership_id, lead_org_id, notes)
--   SELECT p.id, p.lead_org_id, p.partnership_notes FROM public.partnerships p
--   WHERE p.partnership_notes IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM public.partnership_private_notes n WHERE n.partnership_id = p.id);
--
-- =====================================================================
-- PRE-FLIGHT. RUN BEFORE THE REAL APPLY.
-- =====================================================================
--
-- P1. DRIFT. EXPECTED: 0.
--
--   SELECT count(*) AS drift FROM public.partnerships p
--   LEFT JOIN public.partnership_private_notes n ON n.partnership_id = p.id
--   WHERE p.partnership_notes IS NOT NULL AND n.notes IS DISTINCT FROM p.partnership_notes;
--
-- P2. HOW MANY ROWS THIS WILL EMPTY. WRITE IT DOWN.
--
--   SELECT count(*) AS with_notes FROM public.partnerships WHERE partnership_notes IS NOT NULL;
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. THE COLUMN IS EMPTY, STILL PRESENT.
--
--   SELECT count(*) FILTER (WHERE partnership_notes IS NOT NULL) AS still_set, count(*) AS total
--   FROM public.partnerships;
--   EXPECTED: still_set = 0, total unchanged.
--
-- V2. THE NOTES ARE INTACT IN THE TABLE.
--
--   SELECT count(*) FROM public.partnership_private_notes;
--   EXPECTED: P2's with_notes (or more, if the code wrote new rows).
--
-- V3. A VENDOR READING partnerships GETS NO NOTES. Run in the SQL Editor impersonating a vendor
--   user (the pre-apply test does this for you):
--     select partnership_notes from partnerships;   -- EXPECTED: NULL on every row.
--
-- V4. NO POLICY, GRANT OR TRIGGER ON partnerships MOVED. Compare 105's P4 and V6.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 93 and COMMIT is at line 132.

BEGIN;

DO $preflight$
DECLARE
  v_drift bigint;
BEGIN
  IF to_regclass('public.partnership_private_notes') IS NULL THEN
    RAISE EXCEPTION '106 refuses to apply: public.partnership_private_notes does not exist. Apply 105 first.'
      USING ERRCODE = 'LG106';
  END IF;

  SELECT count(*) INTO v_drift
  FROM public.partnerships p
  LEFT JOIN public.partnership_private_notes n ON n.partnership_id = p.id
  WHERE p.partnership_notes IS NOT NULL AND n.notes IS DISTINCT FROM p.partnership_notes;

  IF v_drift <> 0 THEN
    RAISE EXCEPTION '106 refuses to apply: % partnership(s) hold a legacy partnership_notes value that is not identical to the private notes table. Nulling the column would destroy it. See the DRIFT section of this file.', v_drift
      USING ERRCODE = 'LG106';
  END IF;
END
$preflight$;

UPDATE public.partnerships
   SET partnership_notes = NULL
 WHERE partnership_notes IS NOT NULL;

DO $verify$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.partnerships WHERE partnership_notes IS NOT NULL;
  IF v_left <> 0 THEN
    RAISE EXCEPTION '106: % partnership(s) still hold partnership_notes after the update. Nothing was committed.', v_left
      USING ERRCODE = 'LG106';
  END IF;
END
$verify$;

COMMIT;
