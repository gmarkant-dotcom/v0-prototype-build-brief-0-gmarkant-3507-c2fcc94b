-- =====================================================================
-- 118 DOWN: removes the agency-owned RFP record. Drops the two link-column guards (the inbox one also
-- carries the vendor allow-list, rulings O1/O2: rolling back REOPENS F1), the five link columns, the
-- two tables, their guards, and current_user_entitled_lead_org_ids().
--
-- >>> FORCING THIS FILE LOSES EVERY RFP RECORD AND EVERY LINK. <<<
-- Every rfp_records row (the master as broadcast, the rubric, budget categories, requirements, the
-- output template, the client toggle, the per-line released budgets) is deleted, and every
-- partner_rfp_inbox.rfp_line_id, client_name_released, rfp_magic_tokens.rfp_line_id,
-- attached_inbox_id and client_name_released value is dropped with its column. Nothing else keeps a
-- copy of the toggle or the released budgets. The vendor copies in partner_rfp_inbox.master_rfp_json
-- are untouched (step C has not run), so the agency readers keep working from them.
--
-- AUTHORED 2026-10-14 on branch feat/rfp-record-a. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THE WARNING ABOVE. If any record matters, export it first:
--         SELECT r.*, (SELECT jsonb_agg(l ORDER BY l.sort_order) FROM public.rfp_record_lines l
--                       WHERE l.rfp_id = r.id) AS lines
--         FROM public.rfp_records r ORDER BY r.created_at;
--   [ ] The deployed code keeps working without the tables: lib/server/rfp-record.ts skips the record
--       on 42P01 / PGRST205 and drops the link columns on 42703 / PGRST204, logging once.
--   [ ] Step B code (readers moved onto the record) is NOT deployed. If it is, roll it back first.
--
-- REFUSAL. While any rfp_records row exists, or any link column holds a value, this file raises
-- LG118 and changes nothing. To drop it anyway, add this line directly AFTER "BEGIN;" (SET LOCAL only
-- lasts inside the transaction), and say so in the run log:
--     SET LOCAL ligament.allow_drop_rfp_records = 'on';
--
-- BEGIN is line 37 and COMMIT is line 89.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm 118's V1 still returns two rows.
--
-- VERIFY AFTER A REAL RUN (EXPECTED): 118's P2 answers null, null, null and zero rows.
-- =====================================================================

BEGIN;

DO $down$
DECLARE
  v_records bigint;
  v_links   bigint;
BEGIN
  IF to_regclass('public.rfp_records') IS NULL THEN
    RAISE EXCEPTION '118 down refuses: public.rfp_records does not exist, so 118 is not applied.' USING ERRCODE = 'LG118';
  END IF;

  EXECUTE 'SELECT count(*) FROM public.rfp_records' INTO v_records;
  EXECUTE $q$SELECT (SELECT count(*) FROM public.partner_rfp_inbox
                      WHERE rfp_line_id IS NOT NULL OR client_name_released IS NOT NULL)
                  + (SELECT count(*) FROM public.rfp_magic_tokens
                      WHERE rfp_line_id IS NOT NULL OR attached_inbox_id IS NOT NULL OR client_name_released IS NOT NULL)$q$
    INTO v_links;

  IF (v_records > 0 OR v_links > 0)
     AND coalesce(current_setting('ligament.allow_drop_rfp_records', true), '') <> 'on' THEN
    RAISE EXCEPTION '118 down refuses: % RFP record(s) and % linked inbox/token row(s) exist. Dropping loses every record and every link. Read the header.', v_records, v_links
      USING ERRCODE = 'LG118';
  END IF;
END
$down$;

-- The guards first, so dropping the columns fires nothing. This also drops the vendor allow-list.
DROP TRIGGER IF EXISTS partner_rfp_inbox_link_columns_guard ON public.partner_rfp_inbox;
DROP TRIGGER IF EXISTS rfp_magic_tokens_link_columns_guard  ON public.rfp_magic_tokens;
DROP FUNCTION IF EXISTS public.partner_rfp_inbox_link_columns_guard();
DROP FUNCTION IF EXISTS public.rfp_magic_tokens_link_columns_guard();

-- The link columns (and their indexes and foreign keys with them).
ALTER TABLE public.rfp_magic_tokens
  DROP COLUMN IF EXISTS rfp_line_id,
  DROP COLUMN IF EXISTS attached_inbox_id,
  DROP COLUMN IF EXISTS client_name_released;

ALTER TABLE public.partner_rfp_inbox
  DROP COLUMN IF EXISTS rfp_line_id,
  DROP COLUMN IF EXISTS client_name_released;

-- The tables (policies, triggers and indexes go with them), lines first.
DROP TABLE IF EXISTS public.rfp_record_lines;
DROP TABLE IF EXISTS public.rfp_records;

DROP FUNCTION IF EXISTS public.rfp_record_lines_guard();
DROP FUNCTION IF EXISTS public.rfp_records_guard();
DROP FUNCTION IF EXISTS public.current_user_entitled_lead_org_ids();

NOTIFY pgrst, 'reload schema';

COMMIT;
