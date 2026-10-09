-- =====================================================================
-- 114 DOWN: restores the pre-114 WITH CHECKs, grants, default privileges and helper EXECUTE, and
-- drops the partnerships reliability guard.
--
-- AUTHORED 2026-10-09 on branch fix/agency-gate-and-leaks. NOT APPLIED.
--
-- STOP-GATE.
--   [ ] YOU HAVE READ THIS: after this file a vendor can again insert a delivery review (and a score,
--       an MSA row, a magic token) in its own organization naming another organization's partnership
--       or project; anon and authenticated hold TRUNCATE, REFERENCES and TRIGGER again; anon can
--       execute the six helpers again; partnerships.reliability_summary is writable again.
--   [ ] rfp_magic_tokens' policy had NO WITH CHECK before 114. ALTER POLICY cannot remove one, so it
--       is set to the USING expression, which is what an absent WITH CHECK means. pg_policies will
--       show the text where it showed NULL.
--
-- BEGIN is line 21 and COMMIT is line 85.
--
-- DRY RUN: change the COMMIT; to ROLLBACK;, run, then confirm 114's V5 still returns one row.
-- =====================================================================

BEGIN;

ALTER POLICY "Agencies manage own delivery reviews" ON public.delivery_reviews
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

ALTER POLICY "Agencies manage own delivery review scores" ON public.delivery_review_scores
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.delivery_reviews r
    WHERE r.id = delivery_review_scores.review_id
      AND r.org_id IN (SELECT public.current_user_org_ids())));

ALTER POLICY "Agency can manage their MSAs" ON public.msa_agreements
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

ALTER POLICY "Agency can manage their own tokens" ON public.rfp_magic_tokens
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

DO $grants$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I TO anon, authenticated', r.relname);
  END LOOP;
END
$grants$;

DO $defaults$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner
             FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    BEGIN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated', r.owner);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE '114 down: cannot alter default privileges of role % (%)', r.owner, SQLERRM;
    END;
  END LOOP;
END
$defaults$;

DO $helpers$
DECLARE
  f     text;
  v_sig regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'current_user_org_ids', 'current_user_admin_org_ids', 'current_user_counterparty_org_ids',
    'current_user_visible_profile_ids', 'current_user_active_counterparty_user_ids',
    'current_user_commercial_counterparty_org_ids'] LOOP
    v_sig := to_regprocedure('public.' || f || '()');
    IF v_sig IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', v_sig);
    END IF;
  END LOOP;
END
$helpers$;

DROP TRIGGER IF EXISTS partnerships_reliability_columns_guard ON public.partnerships;
DROP FUNCTION IF EXISTS public.partnerships_reliability_columns_guard();

COMMIT;
