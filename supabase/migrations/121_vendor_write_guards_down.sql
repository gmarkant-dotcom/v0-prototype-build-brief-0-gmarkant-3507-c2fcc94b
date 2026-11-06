-- =====================================================================
-- 121 DOWN. Removes the vendor write guard on partner_rfp_responses and restores 114's WITH CHECK
-- on "Agencies manage own delivery reviews", exactly as 114:148-157 wrote it.
--
-- AUTHORED 2026-11-06 on feat/121-vendor-write-guards. NOT RUN. OWNER-RUN, in the Supabase SQL Editor.
--
-- READ THIS FIRST. Running it REOPENS V1: a vendor session can again repoint lead_org_id or
-- inbox_item_id, set any status (awarded included), and rewrite agency_feedback and the 069
-- timestamps through raw PostgREST. The 121 code (lib/vendor-bid-status.ts in the vendor and guest
-- routes) keeps applying ruling S1 to the app's own writes; nothing else stops a direct write.
-- No row is written. No other policy, grant or trigger changes; the public policy count stays 161.
--
-- VERIFICATION AFTER IT RUNS:
--   SELECT t.tgname FROM pg_trigger t
--   WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass AND NOT t.tgisinternal;
--     EXPECTED: one row, partner_rfp_responses_private_columns_guard.
--   SELECT to_regprocedure('public.partner_rfp_responses_vendor_write_guard()');   -- EXPECTED: null
--   SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_reviews'
--     AND policyname = 'Agencies manage own delivery reviews';
--     EXPECTED: names lead_org_id and projects, and neither response_id nor assignment_id.
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'public';                  -- EXPECTED: 161
--
-- BEGIN is at line 26 and COMMIT is at line 68.
-- =====================================================================

BEGIN;

DO $preflight$
BEGIN
  IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '121 down refuses to run: it must run with no end-user session (the SQL Editor role).'
      USING ERRCODE = 'LG121';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_reviews'
                  AND policyname = 'Agencies manage own delivery reviews' AND cmd = 'ALL') THEN
    RAISE EXCEPTION '121 down refuses to run: "Agencies manage own delivery reviews" is missing or is not FOR ALL.'
      USING ERRCODE = 'LG121';
  END IF;
END
$preflight$;

DROP TRIGGER IF EXISTS partner_rfp_responses_vendor_write_guard ON public.partner_rfp_responses;
DROP FUNCTION IF EXISTS public.partner_rfp_responses_vendor_write_guard();

-- 114:148-157, verbatim.
ALTER POLICY "Agencies manage own delivery reviews" ON public.delivery_reviews
  WITH CHECK (
    org_id IN (SELECT public.current_user_org_ids())
    AND EXISTS (SELECT 1 FROM public.partnerships p
                 WHERE p.id = delivery_reviews.partnership_id
                   AND p.lead_org_id = delivery_reviews.org_id)
    AND EXISTS (SELECT 1 FROM public.projects pr
                 WHERE pr.id = delivery_reviews.project_id
                   AND pr.org_id = delivery_reviews.org_id)
  );

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.partner_rfp_responses'::regclass
              AND t.tgname = 'partner_rfp_responses_vendor_write_guard') THEN
    RAISE EXCEPTION '121 down stopped: the guard trigger is still there. Nothing was committed.' USING ERRCODE = 'LG121';
  END IF;
  RAISE NOTICE '121 DOWN DONE: vendor write guard removed; delivery review check restored to 114; % public policies.',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public');
END
$post$;

COMMIT;
