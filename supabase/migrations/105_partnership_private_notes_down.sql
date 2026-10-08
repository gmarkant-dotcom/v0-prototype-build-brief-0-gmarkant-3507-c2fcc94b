-- =====================================================================
-- 105 DOWN: removes public.partnership_private_notes and restores the legacy column.
--
-- AUTHORED 2026-10-08 on branch fix/105-notes-column-revoke. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: THIS FILE COPIES THE TABLE BACK INTO partnerships.partnership_notes
--       BEFORE IT DROPS THE TABLE, so no note is lost (including notes written after 105, and
--       all of them if 106 had already nulled the column). THE COST: the legacy column is
--       populated again, so a VENDOR CAN READ THE LEAD AGENCY'S PRIVATE NOTES AGAIN. That is
--       today's state, which is what a rollback means. If 106 was applied, this restores what
--       106 removed.
--   [ ] The deployed code falls back to the legacy column when the table is absent, so rolling
--       the table back under live code is safe. Rolling back the CODE while the table exists
--       is not: old code would write the legacy column and its writes would be invisible to
--       the new code. Roll back in the order: this file, then the code.
--
-- BEGIN is line 30 and COMMIT is line 69.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm the table still exists
-- (105's P2 query should return ONE row).
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'partnership_private_notes';       -- zero rows
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'partnership_private_notes_guard';   -- zero rows
-- =====================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.partnership_private_notes') IS NULL THEN
    RAISE EXCEPTION '105 down refuses: public.partnership_private_notes does not exist (already rolled back?).'
      USING ERRCODE = 'LG105';
  END IF;
END
$guard$;

-- Copy back every table row whose legacy copy differs or was nulled by 106.
UPDATE public.partnerships p
   SET partnership_notes = n.notes
  FROM public.partnership_private_notes n
 WHERE n.partnership_id = p.id
   AND p.partnership_notes IS DISTINCT FROM n.notes;

DO $verify$
DECLARE
  v_missing bigint;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.partnership_private_notes n
  LEFT JOIN public.partnerships p ON p.id = n.partnership_id
  WHERE p.partnership_notes IS DISTINCT FROM n.notes;

  IF v_missing <> 0 THEN
    RAISE EXCEPTION '105 down: % note row(s) did not copy back into partnerships.partnership_notes. Nothing was dropped.', v_missing
      USING ERRCODE = 'LG105';
  END IF;
END
$verify$;

DROP TABLE public.partnership_private_notes;
DROP FUNCTION public.partnership_private_notes_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;
