-- =====================================================================
-- 114: HARDENING. Five independent changes, one transaction.
--
-- AUTHORED 2026-10-09 on branch fix/agency-gate-and-leaks. NOT APPLIED. NOT RUN AGAINST POSTGRES.
-- DO NOT APPLY WITHOUT A GREEN RUN OF supabase/migrations/114_preapply_test.sql AND GREG'S SAY-SO.
-- Independent of 113 and 115: needs only 079-112 as applied.
--
--   1. WITH CHECK, NOT USING, on four ALL policies (ALTER POLICY, never DROP-then-CREATE, 099:732):
--        delivery_reviews        "Agencies manage own delivery reviews"
--        delivery_review_scores  "Agencies manage own delivery review scores"  (via its parent)
--        msa_agreements          "Agency can manage their MSAs"
--        rfp_magic_tokens        "Agency can manage their own tokens"          (had no WITH CHECK)
--      A row's org_id must equal the lead organization of the partnership it names and/or the
--      organization of the project it names. USING is unchanged on all four.
--      SKIPPED, the sweep's description does not hold: clients (no partnership_id or project_id
--      column, 077:36-55) and usage_tracking (no foreign reference, 067:1-11). See the report.
--   2. REVOKE TRUNCATE, REFERENCES, TRIGGER ON every public table FROM anon, authenticated.
--      SELECT / INSERT / UPDATE / DELETE untouched: RLS governs them and the app needs them.
--   3. ALTER DEFAULT PRIVILEGES for every role that owns a public table (expected: postgres) to
--      revoke the same three on FUTURE tables. Guarded: a role the migration cannot alter is
--      REPORTED with a NOTICE, not a failure.
--   4. REVOKE EXECUTE FROM anon (and PUBLIC, with an explicit GRANT to authenticated first) on six
--      helpers: current_user_org_ids, current_user_admin_org_ids, current_user_counterparty_org_ids,
--      current_user_visible_profile_ids, current_user_active_counterparty_user_ids,
--      current_user_commercial_counterparty_org_ids. A helper named by any policy that applies to
--      anon or PUBLIC is SKIPPED and reported (revoking it would turn that policy's empty result for
--      anon into a permission error).
--   5. A WRITE GUARD ON partnerships.reliability_summary / reliability_summary_generated_at,
--      mirroring 110's legacy-column guard: BEFORE INSERT OR UPDATE, refuses any write that leaves
--      either non-null, for EVERY caller including the service role (LG114). 108 nulled them; their
--      only home is partnership_private_reliability (107). Every other partnerships write passes.
--
-- THE FULL FILENAME IS 114_hardening.sql. Its rollback sibling is 114_hardening_down.sql.
--
-- =====================================================================
-- STOP-GATE
-- =====================================================================
--   [ ] P1 below returns 0 rows (no existing row breaks the new WITH CHECKs). Enforced: LG114.
--   [ ] P2 below returns 0 (108 still holds). Enforced: LG114.
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 114.".
--   [ ] The DRY RUN (COMMIT -> ROLLBACK) has been done.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 93 and COMMIT is at line 305.
--
-- =====================================================================
-- PRE-FLIGHT (read only; the same counts are enforced inside the transaction)
-- =====================================================================
-- P1. ROWS THE NEW WITH CHECKS WOULD REFUSE ON THEIR NEXT UPDATE. EXPECTED: 0 rows.
--   SELECT 'delivery_reviews' AS t, r.id, r.org_id FROM public.delivery_reviews r
--     LEFT JOIN public.partnerships p ON p.id = r.partnership_id
--     LEFT JOIN public.projects pr ON pr.id = r.project_id
--    WHERE p.lead_org_id IS DISTINCT FROM r.org_id OR pr.org_id IS DISTINCT FROM r.org_id
--   UNION ALL
--   SELECT 'msa_agreements', m.id, m.org_id FROM public.msa_agreements m
--     LEFT JOIN public.partnerships p ON p.id = m.partnership_id
--    WHERE m.partnership_id IS NOT NULL AND p.lead_org_id IS DISTINCT FROM m.org_id
--   UNION ALL
--   SELECT 'rfp_magic_tokens', t.id, t.org_id FROM public.rfp_magic_tokens t
--     LEFT JOIN public.projects pr ON pr.id = t.project_id
--    WHERE t.project_id IS NOT NULL AND pr.org_id IS DISTINCT FROM t.org_id;
--   ANY ROW: read it before anything else. A delivery_reviews row here may be a vendor-forged
--   review (the leak sweep's finding 1); deleting it is an owner decision.
-- P2. SELECT count(*) FROM public.partnerships
--      WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
--   EXPECTED: 0.
--
-- =====================================================================
-- VERIFICATION (after the real COMMIT)
-- =====================================================================
-- V1. SELECT tablename, policyname, with_check FROM pg_policies WHERE schemaname = 'public'
--       AND policyname IN ('Agencies manage own delivery reviews','Agencies manage own delivery review scores',
--                          'Agency can manage their MSAs','Agency can manage their own tokens');
--     EXPECTED: four rows; each with_check names lead_org_id and/or projects.
-- V2. SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
--        AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('anon', c.oid, 'REFERENCES')
--          OR has_table_privilege('anon', c.oid, 'TRIGGER') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
--          OR has_table_privilege('authenticated', c.oid, 'REFERENCES') OR has_table_privilege('authenticated', c.oid, 'TRIGGER'));
--     EXPECTED: 0.
-- V3. SELECT pg_get_userbyid(defaclrole), defaclobjtype, defaclacl FROM pg_default_acl d
--       JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE n.nspname = 'public' AND defaclobjtype = 'r';
--     EXPECTED: no anon= or authenticated= entry containing D, x or t for the table-owning role.
-- V4. SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
--            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.proname LIKE 'current\_user\_%' ORDER BY 1;
--     EXPECTED: anon = f, authenticated = t on all six named above (and on the three earlier
--     migrations already revoked).
-- V5. SELECT tgenabled FROM pg_trigger WHERE tgname = 'partnerships_reliability_columns_guard';  -- 'O'
-- =====================================================================

BEGIN;

DO $preflight$
DECLARE
  v_bad bigint;
  v_pol text;
BEGIN
  FOREACH v_pol IN ARRAY ARRAY[
    'delivery_reviews|Agencies manage own delivery reviews',
    'delivery_review_scores|Agencies manage own delivery review scores',
    'msa_agreements|Agency can manage their MSAs',
    'rfp_magic_tokens|Agency can manage their own tokens'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = split_part(v_pol, '|', 1) AND policyname = split_part(v_pol, '|', 2)
                    AND cmd = 'ALL') THEN
      RAISE EXCEPTION '114 refuses to apply: policy "%" on % is missing or is not FOR ALL.', split_part(v_pol, '|', 2), split_part(v_pol, '|', 1)
        USING ERRCODE = 'LG114';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_bad FROM (
    SELECT r.id FROM public.delivery_reviews r
      LEFT JOIN public.partnerships p ON p.id = r.partnership_id
      LEFT JOIN public.projects pr ON pr.id = r.project_id
     WHERE p.lead_org_id IS DISTINCT FROM r.org_id OR pr.org_id IS DISTINCT FROM r.org_id
    UNION ALL
    SELECT m.id FROM public.msa_agreements m
      LEFT JOIN public.partnerships p ON p.id = m.partnership_id
     WHERE m.partnership_id IS NOT NULL AND p.lead_org_id IS DISTINCT FROM m.org_id
    UNION ALL
    SELECT t.id FROM public.rfp_magic_tokens t
      LEFT JOIN public.projects pr ON pr.id = t.project_id
     WHERE t.project_id IS NOT NULL AND pr.org_id IS DISTINCT FROM t.org_id) x;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '114 refuses to apply: % existing row(s) name a partnership or project of another organization (P1 lists them). Read them first; the next UPDATE of each would be refused.', v_bad
      USING ERRCODE = 'LG114';
  END IF;

  SELECT count(*) INTO v_bad FROM public.partnerships
   WHERE reliability_summary IS NOT NULL OR reliability_summary_generated_at IS NOT NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '114 refuses to apply: % partnership(s) hold a legacy reliability value again (108 nulled them). Find the writer first.', v_bad
      USING ERRCODE = 'LG114';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.partnerships'::regclass
              AND tgname = 'partnerships_reliability_columns_guard') THEN
    RAISE EXCEPTION '114 refuses to apply: partnerships_reliability_columns_guard already exists.'
      USING ERRCODE = 'LG114';
  END IF;
END
$preflight$;

-- 1. WITH CHECK. USING untouched. The subqueries run under the caller's RLS: an agency reads its
--    own partnerships and projects; a vendor reads the partnership but fails lead_org_id = org_id.
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

ALTER POLICY "Agencies manage own delivery review scores" ON public.delivery_review_scores
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.delivery_reviews r
     WHERE r.id = delivery_review_scores.review_id
       AND r.org_id IN (SELECT public.current_user_org_ids())
       AND EXISTS (SELECT 1 FROM public.partnerships p
                    WHERE p.id = r.partnership_id AND p.lead_org_id = r.org_id)
       AND EXISTS (SELECT 1 FROM public.projects pr
                    WHERE pr.id = r.project_id AND pr.org_id = r.org_id)));

ALTER POLICY "Agency can manage their MSAs" ON public.msa_agreements
  WITH CHECK (
    org_id IN (SELECT public.current_user_org_ids())
    AND (partnership_id IS NULL
         OR EXISTS (SELECT 1 FROM public.partnerships p
                     WHERE p.id = msa_agreements.partnership_id
                       AND p.lead_org_id = msa_agreements.org_id))
  );

ALTER POLICY "Agency can manage their own tokens" ON public.rfp_magic_tokens
  WITH CHECK (
    org_id IN (SELECT public.current_user_org_ids())
    AND (project_id IS NULL
         OR EXISTS (SELECT 1 FROM public.projects pr
                     WHERE pr.id = rfp_magic_tokens.project_id
                       AND pr.org_id = rfp_magic_tokens.org_id))
  );

-- 2. TRUNCATE / REFERENCES / TRIGGER off every existing public table for anon and authenticated.
DO $grants$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon, authenticated', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '114: revoked TRUNCATE, REFERENCES, TRIGGER from anon and authenticated on % public table(s)', n;
END
$grants$;

-- 3. FUTURE tables. Every role that owns a public table; reported, not failed, when not permitted.
DO $defaults$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner
             FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    BEGIN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated', r.owner);
      RAISE NOTICE '114: default privileges of role % in schema public no longer grant TRUNCATE, REFERENCES, TRIGGER to anon, authenticated', r.owner;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE '114: REPORTED, NOT CHANGED: cannot alter default privileges of role % (%). Run the same statement as that role.', r.owner, SQLERRM;
    END;
  END LOOP;
END
$defaults$;

-- 4. The six helpers: EXECUTE off anon (and PUBLIC), explicitly kept for authenticated.
DO $helpers$
DECLARE
  f        text;
  v_sig    regprocedure;
  v_users  text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'current_user_org_ids', 'current_user_admin_org_ids', 'current_user_counterparty_org_ids',
    'current_user_visible_profile_ids', 'current_user_active_counterparty_user_ids',
    'current_user_commercial_counterparty_org_ids'] LOOP
    v_sig := to_regprocedure('public.' || f || '()');
    IF v_sig IS NULL THEN
      RAISE NOTICE '114: public.%() does not exist; skipped', f;
      CONTINUE;
    END IF;
    SELECT string_agg(tablename || '."' || policyname || '"', ', ') INTO v_users
      FROM pg_policies
     WHERE schemaname = 'public'
       AND roles && ARRAY['public', 'anon']::name[]
       AND position(f || '(' IN coalesce(qual, '') || ' ' || coalesce(with_check, '')) > 0;
    IF v_users IS NOT NULL THEN
      RAISE NOTICE '114: REPORTED, NOT CHANGED: anon keeps EXECUTE on %() because a policy for anon/PUBLIC calls it: %', f, v_users;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_sig);
  END LOOP;
END
$helpers$;

-- 5. partnerships.reliability_summary / reliability_summary_generated_at stay null. 110's shape.
CREATE FUNCTION public.partnerships_reliability_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set text[] := ARRAY[]::text[];
BEGIN
  IF NEW.reliability_summary              IS NOT NULL THEN v_set := array_append(v_set, 'reliability_summary'); END IF;
  IF NEW.reliability_summary_generated_at IS NOT NULL THEN v_set := array_append(v_set, 'reliability_summary_generated_at'); END IF;

  IF cardinality(v_set) = 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That is not a field that can be stored on a partnership.'
    USING ERRCODE = 'LG114',
          DETAIL  = format(
            'partnerships.%s must stay null. Since migrations 107/108 the agency''s reliability summary lives in partnership_private_reliability, which no vendor can read. This guard refuses every caller, the service role included.',
            array_to_string(v_set, ', partnerships.')
          );
END;
$$;

COMMENT ON FUNCTION public.partnerships_reliability_columns_guard() IS
  'Migration 114. BEFORE INSERT OR UPDATE guard on public.partnerships: reliability_summary and reliability_summary_generated_at must stay NULL for EVERY caller (108 nulled them; their home is partnership_private_reliability, 107). Refuses with LG114; never silently nulls. 110''s shape.';

CREATE TRIGGER partnerships_reliability_columns_guard
  BEFORE INSERT OR UPDATE ON public.partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.partnerships_reliability_columns_guard();

REVOKE EXECUTE ON FUNCTION public.partnerships_reliability_columns_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partnerships_reliability_columns_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.partnerships_reliability_columns_guard() FROM authenticated;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
       AND policyname IN ('Agencies manage own delivery reviews', 'Agencies manage own delivery review scores',
                          'Agency can manage their MSAs', 'Agency can manage their own tokens')
       AND (with_check ILIKE '%lead_org_id%' OR with_check ILIKE '%projects%')) <> 4 THEN
    RAISE EXCEPTION '114: a rewritten WITH CHECK did not land. Nothing was committed.' USING ERRCODE = 'LG114';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')
                AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'))) THEN
    RAISE NOTICE '114: some public table still grants TRUNCATE to anon or authenticated (possibly through PUBLIC or a table this role does not own). Read V2.';
  END IF;
END
$verify$;

COMMIT;
