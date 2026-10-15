-- =====================================================================
-- 120 DOWN. DROPS THE VENDOR-COPY GUARD ONLY.
--
-- AUTHORED 2026-10-15 on feat/rfp-record-c. NOT RUN.
--
-- >>> THE SCRUBBED JSON CANNOT BE RESTORED FROM THIS FILE. <<<
-- 120 removed client, totalBudget, scopeItems, evaluation_criteria, referenceMaterials, _magic_token
-- and every other non-allow-listed key from partner_rfp_inbox.master_rfp_json, and
-- output_template_config from rfp_magic_tokens.reference_materials. Nothing keeps a copy of what was
-- removed: the agency's RFP records (rfp_records, rfp_record_lines; 118/119) hold the truth, and
-- 120's pre-flight refused to run unless every removed value on a linked row was held there. The one
-- unlinked row 120 scrubbed (inbox 04391718, closed, its token row gone) has no record; its removed
-- keys are gone. Restoring vendor copies would put the leak back, which is not what a rollback of
-- a guard is for.
--
-- WHAT IT DROPS: the two triggers (partner_rfp_inbox_vendor_copy_guard,
-- rfp_magic_tokens_vendor_copy_guard), their two functions, and the two allow-list functions
-- (rfp_vendor_copy_keys, rfp_token_reference_materials_keys). Nothing else. No row is written.
-- After it, writes of any key into the vendor copies are no longer refused by the database; the
-- step C code still writes only allow-listed keys (lib/rfp-vendor-copy.ts).
--
-- RUN ORDER: only if 120's guard must come off (for example, a writer that cannot be fixed quickly
-- is failing with 23514). Paste the whole file into the Supabase SQL Editor and run it once.
-- VERIFY: 120's V2 and V3 return no rows; 161 public policies.
-- =====================================================================

BEGIN;

DO $down$
BEGIN
  IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '120 down refuses to run: it must run with no end-user session (the SQL Editor role).'
      USING ERRCODE = 'LG120';
  END IF;
END
$down$;

DROP TRIGGER IF EXISTS partner_rfp_inbox_vendor_copy_guard ON public.partner_rfp_inbox;
DROP TRIGGER IF EXISTS rfp_magic_tokens_vendor_copy_guard ON public.rfp_magic_tokens;
DROP FUNCTION IF EXISTS public.partner_rfp_inbox_vendor_copy_guard();
DROP FUNCTION IF EXISTS public.rfp_magic_tokens_vendor_copy_guard();
DROP FUNCTION IF EXISTS public.rfp_vendor_copy_keys();
DROP FUNCTION IF EXISTS public.rfp_token_reference_materials_keys();

COMMIT;
