-- =====================================================================
-- Migration 073 DOWN. Reverses 073_delivery_review_sharing.sql.
--
-- This RE-OPENS A DISCLOSURE ON PURPOSE. Run it only because 073 broke
-- something, and read WHAT YOU ARE PUTTING BACK before you do.
--
-- =====================================================================
-- TRANSACTION CONTROL. This file carries an explicit BEGIN on LINE 82 and an
-- explicit COMMIT on LINE 119. Those are the only executable occurrences.
-- TO DRY RUN: change the COMMIT; on line 119 to ROLLBACK; and run the whole
-- file. Verify before trusting:
--   grep -n '^BEGIN;$'  -> exactly one hit, line 82
--   grep -n '^COMMIT;$' -> exactly one hit, line 119
--
-- =====================================================================
-- WHAT YOU ARE PUTTING BACK
-- =====================================================================
--
-- After this file runs, `status = 'complete'` is once again the ENTIRE
-- vendor-visibility gate on a delivery review. That means:
--
--   Finishing a review publishes it. There is no way to complete one
--   without the vendor being able to read it, and RLS is row level, so a
--   vendor who reads it reads on_time_notes, on_budget_notes,
--   client_feedback and ai_delta_summary as well as the scores. Those four
--   are withheld by ONE QUERY'S SELECT LIST in the app and by nothing else
--   (migration 066:13-16).
--
-- THE CLEARED RELIABILITY CACHE IS NOT RESTORED AND CANNOT BE. STEP 4 of
-- the up file discarded the cached AI paragraphs; the text is gone. This is
-- not a defect in this file - the summaries regenerate on next view, from
-- app/api/agency/pool/[partnerId]/performance/route.ts:160, at the cost of
-- one AI call per partnership. Nothing else about them is lost, because
-- they were a cache and never a source of truth.
--
-- IF YOU ARE RUNNING THIS BECAUSE ONE PART OF 073 MISBEHAVED, PREFER THE
-- PARTIAL ROLLBACKS BELOW OVER THE WHOLE FILE. They are listed first for
-- that reason.
--
-- ---------------------------------------------------------------------
-- PARTIAL ROLLBACK A: the gate is right but a specific vendor needs their
-- reviews back NOW, and the toggle UI does not exist yet.
-- Symptom: a vendor reports their Performance Scores section is empty and
-- the agency wants it restored for them specifically.
--
-- Do NOT roll the policy back for that. Share the reviews instead - that is
-- what the column is for, and it leaves the gate closed for everyone else:
--
--   UPDATE public.delivery_reviews r
--      SET shared_with_vendor = true, shared_with_vendor_at = now()
--     FROM public.partnerships p
--    WHERE p.id = r.partnership_id
--      AND r.status = 'complete'
--      AND p.vendor_org_id = '<the vendor organization id>';
--
-- ---------------------------------------------------------------------
-- PARTIAL ROLLBACK B: the policy itself is refusing a read it should allow,
-- for a reason not yet understood. This restores the old gate and LEAVES
-- THE COLUMNS IN PLACE, so nothing that writes them starts erroring and the
-- shared/unshared decisions already recorded are not lost.
--
--   DROP POLICY IF EXISTS "Partners view own shared delivery reviews" ON public.delivery_reviews;
--   CREATE POLICY "Partners view own complete delivery reviews"
--     ON public.delivery_reviews AS PERMISSIVE FOR SELECT TO authenticated
--     USING (
--       status = 'complete'::text
--       AND EXISTS (
--         SELECT 1 FROM public.partnerships p
--         WHERE p.id = delivery_reviews.partnership_id
--           AND p.vendor_org_id IN (SELECT public.current_user_org_ids())));
--
-- This is strictly preferable to the full file. Prefer it unless the
-- columns themselves are the problem.
--
-- BEFORE RUNNING EITHER, CAPTURE THE FAILING CASE: the exact review id, the
-- vendor organization id, and the error code or the empty result. A
-- rollback with no captured case cannot be turned into a corrected 073.
--
-- =====================================================================


BEGIN;

-- 1. Restore the original gate, exactly as 079 wrote it. Same policy NAME
--    as before 073, so pg_policies reads identically to the P1 capture.
DROP POLICY IF EXISTS "Partners view own shared delivery reviews" ON public.delivery_reviews;

CREATE POLICY "Partners view own complete delivery reviews"
  ON public.delivery_reviews AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    status = 'complete'::text
    AND EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.id = delivery_reviews.partnership_id
        AND p.vendor_org_id IN (SELECT public.current_user_org_ids())));

-- 2. The index. Dropped before the column it depends on, which Postgres
--    would otherwise drop for us as a dependency - explicit is better,
--    because a silent cascade is how an index that was NOT part of this
--    migration disappears unnoticed.
DROP INDEX IF EXISTS public.delivery_reviews_vendor_shared_idx;

-- 3. The columns.
--
--    THIS DISCARDS EVERY SHARING DECISION RECORDED SO FAR, including who
--    made each one and when. There is no way to keep them - the column is
--    where they live. If any review has been shared deliberately, capture
--    the set first and do not run this step:
--
--      SELECT id, shared_with_vendor, shared_with_vendor_at, shared_with_vendor_by
--      FROM public.delivery_reviews WHERE shared_with_vendor;
--
--    Step 1 alone restores the old behaviour. Consider stopping there.
ALTER TABLE public.delivery_reviews
  DROP COLUMN IF EXISTS shared_with_vendor_by,
  DROP COLUMN IF EXISTS shared_with_vendor_at,
  DROP COLUMN IF EXISTS shared_with_vendor;

COMMIT;


-- =====================================================================
-- VERIFICATION AFTER ROLLBACK. READ ONLY.
-- =====================================================================
--
-- R1. Two policies, and the partner one is the ORIGINAL name again.
--
--       SELECT policyname, cmd, qual FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'delivery_reviews'
--       ORDER BY policyname;
--
--     EXPECTED: 2 rows, "Agencies manage own delivery reviews" and
--     "Partners view own complete delivery reviews". The qual of the second
--     must NOT mention shared_with_vendor. If BOTH partner policies are
--     listed, the DROP in step 1 did not match and the gate is still half
--     closed in a way that is now hard to reason about.
--
-- R2. The columns are gone.
--
--       SELECT column_name FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'delivery_reviews'
--         AND column_name LIKE 'shared\_with\_vendor%';
--
--     EXPECTED: 0 rows. If this file was stopped after step 1 on purpose,
--     expect 3 rows and that is correct - note which was intended.
--
-- R3. The vendor read works again. As a vendor account with a completed
--     review:
--
--       SELECT id, status FROM public.delivery_reviews;
--
--     EXPECTED: the rows P3 of the up file captured, back again.
-- =====================================================================
