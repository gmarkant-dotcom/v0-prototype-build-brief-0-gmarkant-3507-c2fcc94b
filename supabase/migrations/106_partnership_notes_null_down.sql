-- =====================================================================
-- 106 DOWN: restores partnerships.partnership_notes from public.partnership_private_notes.
--
-- AUTHORED 2026-10-08 on branch fix/105-notes-column-revoke. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: RESTORING THE COLUMN RE-OPENS THE LEAK. A vendor can read the lead
--       agency's private notes again. This returns the database to its state between 105 and 106.
--   [ ] The table exists. It is the only copy of every note written after 106, so this file
--       refuses to run without it.
--
-- BEGIN is line 21 and COMMIT is line 52.
--
-- DRY RUN: change COMMIT; to ROLLBACK;, run, then confirm 106's P2 count is still 0.
--
-- VERIFY AFTER A REAL RUN (EXPECTED):
--   SELECT count(*) FROM public.partnerships WHERE partnership_notes IS NOT NULL;
--   -- equals: SELECT count(*) FROM public.partnership_private_notes;
-- =====================================================================

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.partnership_private_notes') IS NULL THEN
    RAISE EXCEPTION '106 down refuses: public.partnership_private_notes does not exist, so there is nothing to restore from.'
      USING ERRCODE = 'LG106';
  END IF;
END
$guard$;

UPDATE public.partnerships p
   SET partnership_notes = n.notes
  FROM public.partnership_private_notes n
 WHERE n.partnership_id = p.id
   AND p.partnership_notes IS DISTINCT FROM n.notes;

DO $verify$
DECLARE
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.partnership_private_notes n
  LEFT JOIN public.partnerships p ON p.id = n.partnership_id
  WHERE p.partnership_notes IS DISTINCT FROM n.notes;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '106 down: % row(s) did not restore. Nothing was committed.', v_bad USING ERRCODE = 'LG106';
  END IF;
END
$verify$;

COMMIT;
