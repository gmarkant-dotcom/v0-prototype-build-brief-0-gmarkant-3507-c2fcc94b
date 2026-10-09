-- =====================================================================
-- 111: DELIVERY REVIEW PRIVATE. THE LEAD AGENCY'S NOTES ON A COMPLETED ENGAGEMENT, IN A TABLE
--      NO VENDOR CAN READ OR WRITE.
--
-- AUTHORED 2026-10-09 on branch fix/109-112-scoring-and-reviews-split. NOT APPLIED.
-- NOT RUN AGAINST POSTGRES. DO NOT APPLY WITHOUT A GREEN PRE-APPLY RUN OF
-- supabase/migrations/111_preapply_test.sql AND GREG'S SAY-SO.
--
-- >>> THIS FILE SUPERSEDES THE NEVER-APPLIED 073 (073_delivery_review_sharing.sql) FOR COLUMN PRIVACY. <<<
-- >>> 073 MUST NEVER BE APPLIED. <<<
-- >>> 073's "SHARED WITH VENDOR" CONCEPT (a per-review flag deciding whether a vendor sees a review at all) <<<
-- >>> IS A SEPARATE, UNRULED PRODUCT DECISION. IT IS NOT IMPLEMENTED HERE, AND NOTHING HERE DEPENDS ON IT. <<<
-- 073 is unapplied (owner-verified 2026-10-09: delivery_reviews has no shared_with_vendor column). It was
-- written against the 066 policy text and pre-dates 079's org_id rename; applied now it would replace the
-- vendor policy with one that reads a flag no code writes, and re-clear a reliability cache that 107 has
-- since moved. If the sharing idea is ever ruled on, it needs a new migration written against this
-- schema, not 073.
--
-- >>> THE LEAK IS NOT CLOSED BY THIS FILE. <<<
-- >>> AFTER 111 AND BEFORE 112 A VENDOR CAN STILL READ THE SIX LEGACY COLUMNS ON ITS COMPLETED REVIEWS. <<<
--
--   CREATE TABLE public.delivery_review_private   (one row per review; the six columns below)
--   CREATE public.delivery_review_private_guard() -> trigger function + BEFORE INSERT OR UPDATE trigger
--   CREATE 3 POLICIES (SELECT, INSERT, UPDATE), all authenticated, all keyed on org_id.
--   NO VENDOR POLICY. NO DELETE POLICY. NO DELETE GRANT.
--   REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT, INSERT, UPDATE to authenticated; ALL to service_role.
--   BACKFILL from the six legacy columns (a copy; they are NOT touched). NOTIFY pgrst.
--
-- THE FULL FILENAME IS 111_delivery_review_private.sql. Its rollback sibling is
-- 111_delivery_review_private_down.sql. Its successor is 112_delivery_review_private_null.sql. DO NOT GLOB.
--
-- =====================================================================
-- THE COLUMNS, AND WHY THEY ARE AGENCY-ONLY (docs/109-112-split-report.md, Phase 0)
-- =====================================================================
--
--   on_time_notes, on_budget_notes, client_feedback, ai_delta_summary   text
--   would_work_again   text, CHECK (yes | likely | unlikely | no), as on delivery_reviews (066)
--   budget_variance_pct numeric(5,2)
--
-- No vendor screen renders any of the six. The vendor reads delivery_reviews in exactly two places and
-- both name their columns: app/partner/projects/page.tsx (id, project_id, composite_score, on_time,
-- on_budget, overall_satisfaction) and app/api/partner/dashboard/route.ts (id, composite_score). Those
-- columns stay on delivery_reviews. 066's own header and 073 called the four text fields agency-private;
-- would_work_again and budget_variance_pct are agency judgements no vendor screen shows.
-- The mechanism failure is the same as 105, 107 and 109: "Partners view own complete delivery reviews"
-- admits the WHOLE row of every completed review on the vendor's partnerships, both parties are
-- `authenticated`, and Postgres has no per-column row level security.
--
-- =====================================================================
-- THE AGENCY KEY IS org_id, NOT lead_org_id
-- =====================================================================
-- delivery_reviews has no lead_org_id. 079 renamed 066's agency_id to org_id (079:653) and rewrote
-- "Agencies manage own delivery reviews" to org_id IN (SELECT current_user_org_ids()) (079:1202-1205).
-- This table uses the same column name and the same predicate.
--
-- KNOWN, NOT FIXED HERE (no policy on delivery_reviews may change in this work): that ALL policy's WITH
-- CHECK tests only org_id, so a vendor can INSERT a delivery_reviews row stamped with its OWN org_id on a
-- partnership it is the vendor on. Such a row is invisible to the agency. This table inherits nothing
-- worse from it: the guard copies org_id from that forged parent, so the vendor could write private notes
-- that only the vendor itself can read. 112's guard stops the forged row carrying the six legacy columns.
--
-- =====================================================================
-- STOP-GATE. EVERY ONE OF THESE MUST BE TRUE BEFORE YOU PASTE THIS FILE.
-- =====================================================================
--
--   [ ] THE CODE IS MERGED, PUSHED AND DEPLOYED FIRST. lib/server/delivery-review-private.ts reads and
--       writes this table and falls back to the legacy columns while it does not exist. Code first is
--       harmless. Migration first is not: old code writes the legacy columns, which 112 empties.
--   [ ] 079 is applied (current_user_org_ids(), organizations, delivery_reviews.org_id).
--   [ ] 073 IS NOT APPLIED (P5). If it were, stop and read the schema: this file was written without it.
--   [ ] The table does not exist (P2 returns zero rows). Enforced below with LG111.
--   [ ] The pre-apply test's first line reads "SAFE TO APPLY 111.". A NO SUBJECT is NOT a pass.
--   [ ] The DRY RUN below has been done and PROVED to have rolled back.
--
-- DRY RUN: change the final COMMIT; to ROLLBACK;, run it, then run P2. EXPECTED: zero rows.
--
-- =====================================================================
-- THE DESIGN (same as 109)
-- =====================================================================
--   review_id   PK, REFERENCES delivery_reviews(id) ON DELETE CASCADE.
--   org_id      NOT NULL, REFERENCES organizations(id). SET BY THE GUARD FROM THE PARENT REVIEW on insert,
--               whatever the caller sent; review_id and org_id are pinned on update, for every caller.
--   created_at / updated_at owned by the guard (created_at frozen; updated_at = clock_timestamp() on update),
--               which 112's drift guard relies on.
-- The guard is NOT SECURITY DEFINER: it reads the parent under the caller's row level security. EXECUTE is
-- revoked from PUBLIC, anon and authenticated, and search_path is pinned.
-- EQUAL OR NARROWER: a new object and a copy; no privilege, policy or trigger on an existing table changes.
--
-- =====================================================================
-- ORDER
-- =====================================================================
--   1. Merge, push, confirm the deploy.
--   2. Pre-apply test: supabase/migrations/111_preapply_test.sql. READ THE ERROR IT RAISES.
--   3. Dry run, prove it rolled back with P2.
--   4. Real apply. Verify V1 to V7.
--   5. On production, as the agency: open a delivery review, edit a note, save, reload.
--   6. THEN 112.
--
-- =====================================================================
-- PRE-FLIGHT. RUN BEFORE THE REAL APPLY. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- P1. THE COLUMNS HOLD DATA TO COPY.
--
--   SELECT count(*) FILTER (WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL
--                            OR client_feedback IS NOT NULL OR ai_delta_summary IS NOT NULL
--                            OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL) AS to_copy,
--          count(*) FILTER (WHERE status = 'complete') AS complete,
--          count(*) AS total
--   FROM public.delivery_reviews;
--
--   WRITE DOWN to_copy. V4 must equal it.
--
-- P2. THE TABLE DOES NOT EXIST.
--
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname = 'delivery_review_private';
--
--   EXPECTED: zero rows.
--
-- P3. SELECT to_regprocedure('public.current_user_org_ids()') IS NOT NULL, to_regclass('public.organizations') IS NOT NULL;
--   EXPECTED: true, true.
--
-- P4. THE POLICY FINGERPRINT AND ACL OF delivery_reviews.
--
--   SELECT count(*) AS n_policies,
--          md5(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, '') || '|' ||
--                         coalesce(with_check, ''), E'\n' ORDER BY policyname)) AS fingerprint
--   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'delivery_reviews';
--   SELECT relacl::text FROM pg_class WHERE oid = 'public.delivery_reviews'::regclass;
--
--   EXPECTED n_policies: 2 ("Agencies manage own delivery reviews", "Partners view own complete delivery reviews").
--
-- P5. 073 IS NOT APPLIED.
--
--   SELECT count(*) FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'delivery_reviews' AND column_name LIKE 'shared_with_vendor%';
--
--   EXPECTED: 0.
--
-- =====================================================================
-- VERIFICATION. RUN AFTER THE REAL COMMIT. EXPECTED VALUES ARE EXACT.
-- =====================================================================
--
-- V1. SELECT relrowsecurity FROM pg_class WHERE oid = 'public.delivery_review_private'::regclass;   EXPECTED: true.
--
-- V2. SELECT policyname, cmd, roles::text, qual, with_check FROM pg_policies
--     WHERE schemaname = 'public' AND tablename = 'delivery_review_private' ORDER BY cmd, policyname;
--   EXPECTED: 3 rows (INSERT, SELECT, UPDATE), roles = {authenticated}, nothing mentions partnerships or vendor_org_id.
--
-- V3. SELECT p.priv,
--            has_table_privilege('anon', 'public.delivery_review_private', p.priv)          AS anon,
--            has_table_privilege('authenticated', 'public.delivery_review_private', p.priv) AS authenticated
--     FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv);
--   EXPECTED: anon false on all seven; authenticated true for SELECT, INSERT, UPDATE only.
--
-- V4. SELECT (SELECT count(*) FROM public.delivery_review_private) AS in_table,
--            (SELECT count(*) FROM public.delivery_reviews d
--               LEFT JOIN public.delivery_review_private n ON n.review_id = d.id
--             WHERE (d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
--                    OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL)
--               AND (n.review_id IS NULL
--                    OR n.on_time_notes IS DISTINCT FROM d.on_time_notes OR n.on_budget_notes IS DISTINCT FROM d.on_budget_notes
--                    OR n.client_feedback IS DISTINCT FROM d.client_feedback OR n.ai_delta_summary IS DISTINCT FROM d.ai_delta_summary
--                    OR n.would_work_again IS DISTINCT FROM d.would_work_again
--                    OR n.budget_variance_pct IS DISTINCT FROM d.budget_variance_pct)) AS mismatched;
--   EXPECTED: in_table = P1's to_copy, mismatched = 0 immediately after commit (later it may rise; see 112).
--
-- V5. SELECT tgname, tgenabled, (tgtype & 2) = 2, (tgtype & 4) = 4, (tgtype & 16) = 16 FROM pg_trigger
--     WHERE tgrelid = 'public.delivery_review_private'::regclass AND NOT tgisinternal;
--   EXPECTED: one row, 'O', true, true, true.
--     SELECT has_function_privilege('authenticated', 'public.delivery_review_private_guard()', 'EXECUTE');   EXPECTED: false.
--
-- V6. Re-run P4. EXPECTED: equal to P4.
--
-- V7. SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.delivery_review_private'::regclass
--       AND contype = 'f' AND confrelid = 'public.delivery_reviews'::regclass;
--   EXPECTED: one row, 'c'.
--
-- BEGIN and COMMIT line numbers of the transaction below:
-- BEGIN is at line 183 and COMMIT is at line 373.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. FAIL-CLOSED PRE-FLIGHT, INSIDE THE TRANSACTION.
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  v_orphans bigint;
BEGIN
  IF to_regclass('public.delivery_reviews') IS NULL OR to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '111 refuses to apply: public.delivery_reviews or public.organizations does not exist.'
      USING ERRCODE = 'LG111';
  END IF;

  IF to_regprocedure('public.current_user_org_ids()') IS NULL THEN
    RAISE EXCEPTION '111 refuses to apply: public.current_user_org_ids() does not exist (migration 079).'
      USING ERRCODE = 'LG111';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'delivery_reviews'
         AND column_name IN ('org_id', 'on_time_notes', 'on_budget_notes', 'client_feedback',
                             'ai_delta_summary', 'would_work_again', 'budget_variance_pct')) <> 7 THEN
    RAISE EXCEPTION '111 refuses to apply: delivery_reviews is missing org_id or one of the six columns to copy.'
      USING ERRCODE = 'LG111';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'delivery_reviews'
                AND column_name LIKE 'shared_with_vendor%') THEN
    RAISE EXCEPTION '111 refuses to apply: delivery_reviews has a shared_with_vendor column, so 073 has been applied. This file was written against a database without it. Read the schema first.'
      USING ERRCODE = 'LG111';
  END IF;

  IF to_regclass('public.delivery_review_private') IS NOT NULL THEN
    RAISE EXCEPTION '111 refuses to apply: public.delivery_review_private already exists. Read the schema before going further.'
      USING ERRCODE = 'LG111';
  END IF;

  SELECT count(*) INTO v_orphans FROM public.delivery_reviews
   WHERE org_id IS NULL
     AND (on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL
          OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL);
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION '111 refuses to apply: % review(s) hold a value to copy but have no org_id.', v_orphans
      USING ERRCODE = 'LG111';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. THE TABLE.
-- ---------------------------------------------------------------------
CREATE TABLE public.delivery_review_private (
  review_id           uuid          PRIMARY KEY REFERENCES public.delivery_reviews (id) ON DELETE CASCADE,
  org_id              uuid          NOT NULL    REFERENCES public.organizations (id),
  on_time_notes       text,
  on_budget_notes     text,
  client_feedback     text,
  ai_delta_summary    text,
  would_work_again    text          CHECK (would_work_again IN ('yes', 'likely', 'unlikely', 'no')),
  budget_variance_pct numeric(5,2),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX delivery_review_private_org_id_idx
  ON public.delivery_review_private (org_id);

COMMENT ON TABLE public.delivery_review_private IS
  'Migration 111. The lead agency''s private notes on a delivery review: on-time and on-budget notes, client feedback, the AI delta summary, would-work-again and budget variance. Agency-only: there is NO vendor policy. Replaces the six columns on delivery_reviews, which the vendor reads through "Partners view own complete delivery reviews". Supersedes the never-applied 073 for column privacy; 073''s shared-with-vendor flag is not implemented.';

-- ---------------------------------------------------------------------
-- 2. THE GUARD. Sets org_id from the parent review; pins both keys; owns the timestamps.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.delivery_review_private_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.review_id IS DISTINCT FROM OLD.review_id
       OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      RAISE EXCEPTION 'delivery_review_private.review_id and org_id cannot be changed'
        USING ERRCODE = 'LG111';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  -- INSERT. Read under the CALLER's row level security; the caller's org_id is ignored.
  SELECT d.org_id INTO v_org FROM public.delivery_reviews d WHERE d.id = NEW.review_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'delivery_review_private: review_id must be an existing delivery review the caller can see'
      USING ERRCODE = 'LG111';
  END IF;

  NEW.org_id     := v_org;
  NEW.created_at := now();
  NEW.updated_at := NEW.created_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER delivery_review_private_guard
  BEFORE INSERT OR UPDATE ON public.delivery_review_private
  FOR EACH ROW
  EXECUTE FUNCTION public.delivery_review_private_guard();

REVOKE EXECUTE ON FUNCTION public.delivery_review_private_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delivery_review_private_guard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.delivery_review_private_guard() FROM authenticated;

-- ---------------------------------------------------------------------
-- 3. PRIVILEGES.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.delivery_review_private FROM PUBLIC;
REVOKE ALL ON TABLE public.delivery_review_private FROM anon;
REVOKE ALL ON TABLE public.delivery_review_private FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.delivery_review_private TO authenticated;
GRANT ALL ON TABLE public.delivery_review_private TO service_role;

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY. THREE POLICIES. NONE IS FOR A VENDOR. NO DELETE POLICY.
-- ---------------------------------------------------------------------
ALTER TABLE public.delivery_review_private ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_review_private_org_select"
  ON public.delivery_review_private AS PERMISSIVE FOR SELECT TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "delivery_review_private_org_insert"
  ON public.delivery_review_private AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "delivery_review_private_org_update"
  ON public.delivery_review_private AS PERMISSIVE FOR UPDATE TO authenticated
  USING      (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

-- ---------------------------------------------------------------------
-- 5. BACKFILL. A COPY. The legacy columns are NOT touched (112 does that).
-- ---------------------------------------------------------------------
INSERT INTO public.delivery_review_private
  (review_id, org_id, on_time_notes, on_budget_notes, client_feedback, ai_delta_summary, would_work_again, budget_variance_pct)
SELECT d.id, d.org_id, d.on_time_notes, d.on_budget_notes, d.client_feedback, d.ai_delta_summary, d.would_work_again, d.budget_variance_pct
FROM public.delivery_reviews d
WHERE d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
   OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL
ON CONFLICT (review_id) DO NOTHING;

DO $backfill_check$
DECLARE
  v_src      bigint;
  v_dst      bigint;
  v_mismatch bigint;
BEGIN
  SELECT count(*) INTO v_src FROM public.delivery_reviews
   WHERE on_time_notes IS NOT NULL OR on_budget_notes IS NOT NULL OR client_feedback IS NOT NULL
      OR ai_delta_summary IS NOT NULL OR would_work_again IS NOT NULL OR budget_variance_pct IS NOT NULL;
  SELECT count(*) INTO v_dst FROM public.delivery_review_private;
  SELECT count(*) INTO v_mismatch
  FROM public.delivery_reviews d
  LEFT JOIN public.delivery_review_private n ON n.review_id = d.id
  WHERE (d.on_time_notes IS NOT NULL OR d.on_budget_notes IS NOT NULL OR d.client_feedback IS NOT NULL
         OR d.ai_delta_summary IS NOT NULL OR d.would_work_again IS NOT NULL OR d.budget_variance_pct IS NOT NULL)
    AND (n.review_id IS NULL
         OR n.org_id              IS DISTINCT FROM d.org_id
         OR n.on_time_notes       IS DISTINCT FROM d.on_time_notes
         OR n.on_budget_notes     IS DISTINCT FROM d.on_budget_notes
         OR n.client_feedback     IS DISTINCT FROM d.client_feedback
         OR n.ai_delta_summary    IS DISTINCT FROM d.ai_delta_summary
         OR n.would_work_again    IS DISTINCT FROM d.would_work_again
         OR n.budget_variance_pct IS DISTINCT FROM d.budget_variance_pct);

  IF v_mismatch <> 0 OR v_dst <> v_src THEN
    RAISE EXCEPTION '111 backfill is not an exact copy: % review(s) with a value, % row(s) in the new table, % mismatched. Nothing was committed.',
      v_src, v_dst, v_mismatch
      USING ERRCODE = 'LG111';
  END IF;
END
$backfill_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
