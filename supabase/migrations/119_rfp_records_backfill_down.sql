-- =====================================================================
-- 119 DOWN: removes the backfill and the client toggle function. Step A records are never touched.
--
--   1. DROP FUNCTION public.rfp_record_set_client_visibility(uuid, boolean).
--   2. UNLINK: on every rfp_magic_tokens row whose rfp_line_id is a line of a record with
--      source = 'backfill': rfp_line_id, attached_inbox_id and client_name_released go to NULL. On
--      every partner_rfp_inbox row linked to such a line: rfp_line_id and client_name_released go
--      to NULL.
--   3. DELETE every rfp_records row with source = 'backfill' (its lines cascade).
--
-- NOT UNDONE, ON PURPOSE: a Lightning inbox row that 119 linked to an EXISTING step A line (an
-- invitation the vendor-side attach created after a step A send) keeps that link. The link is
-- correct, the step A record owns the line, and this file never changes a step A record, line or
-- link. 119's result counts them as "inbox rows linked to an existing step A line".
--
-- AFTER THIS FILE the readers fall back to the inbox copies for every unlinked row, exactly as
-- before 119, and the toggle route answers 503 again. A toggle the agency set on a backfilled record
-- is lost with the record.
--
-- AUTHORED 2026-10-14 on branch feat/rfp-record-b. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] 119 is applied (P1 below answers a non-null function or a non-zero count).
--   [ ] If any backfilled record matters, export it first:
--         SELECT r.*, (SELECT jsonb_agg(l ORDER BY l.sort_order) FROM public.rfp_record_lines l
--                       WHERE l.rfp_id = r.id) AS lines
--         FROM public.rfp_records r WHERE r.source = 'backfill' ORDER BY r.broadcast_at;
--   [ ] 120 (the scrub) is NOT applied. If it is, the inbox copies no longer hold what the readers
--       would fall back to: stop and roll 120 back first.
--
-- P1. SELECT to_regprocedure('public.rfp_record_set_client_visibility(uuid, boolean)'),
--            (SELECT count(*) FROM public.rfp_records WHERE source = 'backfill');
--
-- BEGIN is line 42 and COMMIT is line 93.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm P1 still answers as before.
--
-- VERIFY AFTER A REAL RUN (EXPECTED): P1 answers null, 0; 119's V1 shows no 'backfill' row; the
-- 'wizard' and 'magic_link' rows are exactly as before.
-- =====================================================================

BEGIN;

DO $down$
DECLARE
  v_tokens  integer;
  v_inbox   integer;
  v_records integer;
BEGIN
  IF to_regclass('public.rfp_records') IS NULL THEN
    RAISE EXCEPTION '119 down refuses: public.rfp_records does not exist (118 is not applied).' USING ERRCODE = 'LG119';
  END IF;

  -- 118's trusted path: the link columns are written with no end-user session.
  IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '119 down refuses: it must run with no end-user session (the SQL Editor role). auth.uid() is %, current_user is %.', auth.uid(), current_user
      USING ERRCODE = 'LG119';
  END IF;

  -- 2. Unlink, tokens first (attached_inbox_id points at inbox rows), then inbox rows.
  UPDATE public.rfp_magic_tokens t
     SET rfp_line_id = NULL, attached_inbox_id = NULL, client_name_released = NULL
   WHERE t.rfp_line_id IN (SELECT l.id FROM public.rfp_record_lines l
                             JOIN public.rfp_records r ON r.id = l.rfp_id
                            WHERE r.source = 'backfill');
  GET DIAGNOSTICS v_tokens = ROW_COUNT;

  UPDATE public.partner_rfp_inbox i
     SET rfp_line_id = NULL, client_name_released = NULL
   WHERE i.rfp_line_id IN (SELECT l.id FROM public.rfp_record_lines l
                             JOIN public.rfp_records r ON r.id = l.rfp_id
                            WHERE r.source = 'backfill');
  GET DIAGNOSTICS v_inbox = ROW_COUNT;

  -- 3. The backfilled records only. Lines cascade. Step A records (source wizard / magic_link)
  --    are not named here.
  DELETE FROM public.rfp_records r WHERE r.source = 'backfill';
  GET DIAGNOSTICS v_records = ROW_COUNT;

  IF EXISTS (SELECT 1 FROM public.rfp_records WHERE source = 'backfill') THEN
    RAISE EXCEPTION '119 down stopped: a backfilled record is still present. Nothing was committed.' USING ERRCODE = 'LG119';
  END IF;

  RAISE NOTICE '119 down: % backfilled record(s) deleted; % token(s) and % inbox row(s) unlinked.', v_records, v_tokens, v_inbox;
END
$down$;

-- 1. The function.
DROP FUNCTION IF EXISTS public.rfp_record_set_client_visibility(uuid, boolean);

NOTIFY pgrst, 'reload schema';

COMMIT;
