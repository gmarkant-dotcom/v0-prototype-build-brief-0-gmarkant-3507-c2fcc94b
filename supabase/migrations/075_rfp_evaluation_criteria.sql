-- Per-RFP evaluation criteria (Phase 2, P2-3). Authored Aug 11, 2026. NOT APPLIED.
--
-- Today an agency has ONE global rubric: bid_scoring_criteria rows keyed by agency_id, seeded
-- from lib/bid-scoring-defaults.ts, scored per bid through bid_evaluations ->
-- bid_evaluation_scores.criterion_id. Every RFP that agency ever broadcasts is judged against
-- the same seven dimensions. This migration lets a single RFP carry its own rubric while the
-- global one keeps working untouched for every RFP that does not define one.
--
-- Split from 076 deliberately: this file is the scoring model and is the only one of the two
-- that alters an existing constraint. 076 is two additive columns and a flag with no
-- constraint surgery. Keeping them separate means 075 can be rolled back on its own if the
-- constraint change misbehaves, without also reverting the proposal and deadline work.
--
-- ---------------------------------------------------------------------------------------
-- 1. Where the rubric lives
-- ---------------------------------------------------------------------------------------
-- Same dual-flow JSONB precedent as business_criteria_required and budget_categories (072),
-- for the same reason: broadcast-rfp fans one wizard definition out across many
-- partner_rfp_inbox rows, and only stable keys inside a blob survive that fan-out with their
-- identity intact.
--
--   wizard flow     -> partner_rfp_inbox.master_rfp_json.evaluation_criteria (no column needed)
--   magic-link flow -> rfp_magic_tokens.evaluation_criteria                  (added below)
--
--   evaluation_criteria: [
--     { key: string,          -- stable id, generated at authoring time, never reused
--       name: string,
--       description: string,
--       weight: number,       -- defaults to equal (1.0); relative, not required to sum to
--                             -- anything, matching bid_scoring_criteria.default_weight
--       origin: 'default' | 'custom',   -- 'default' = seeded from lib/bid-scoring-defaults.ts
--       sort_order: number }
--   ]
--
-- Cap of 8 is enforced in application code, not here. A CHECK on jsonb array length would
-- reject an otherwise-valid RFP at write time with a Postgres error the UI cannot explain, and
-- the cap is a product guideline, not a data-integrity invariant.

ALTER TABLE rfp_magic_tokens
  ADD COLUMN IF NOT EXISTS evaluation_criteria jsonb NULL;

-- ---------------------------------------------------------------------------------------
-- 2. Scores against a per-RFP rubric, coexisting with legacy scores
-- ---------------------------------------------------------------------------------------
-- bid_evaluation_scores.criterion_id is a NOT NULL FK to bid_scoring_criteria (migration 065).
-- A per-RFP criterion has no row in that table and must never borrow one: two criteria can
-- share a name and mean different things, and writing a per-RFP score under a global
-- criterion's id would silently corrupt every cross-RFP aggregate that reads it.
--
-- So a score row now identifies its criterion one of two ways, never both:
--   * criterion_id       - legacy/global rubric (every existing row, untouched)
--   * rfp_criterion_key  - the per-RFP rubric's stable key from the JSONB above
--
-- Existing rows all have criterion_id set and rfp_criterion_key NULL, so they satisfy the new
-- CHECK the moment it is added. No backfill, no rewrite, no existing bid's score changes.

ALTER TABLE bid_evaluation_scores
  ALTER COLUMN criterion_id DROP NOT NULL;

ALTER TABLE bid_evaluation_scores
  ADD COLUMN IF NOT EXISTS rfp_criterion_key text NULL;

-- The criterion's name as it read when this bid was scored. Global scores resolve their name
-- through the FK; per-RFP scores have no table to join, and the RFP's rubric can be edited
-- after a bid is scored, so the score carries its own label or it loses its meaning.
ALTER TABLE bid_evaluation_scores
  ADD COLUMN IF NOT EXISTS criterion_name_snapshot text NULL;

-- Exactly one identifier, never zero and never both. Guarded so re-running the file is safe -
-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bid_evaluation_scores_exactly_one_criterion'
  ) THEN
    ALTER TABLE bid_evaluation_scores
      ADD CONSTRAINT bid_evaluation_scores_exactly_one_criterion
      CHECK (
        (criterion_id IS NOT NULL AND rfp_criterion_key IS NULL) OR
        (criterion_id IS NULL AND rfp_criterion_key IS NOT NULL)
      );
  END IF;
END $$;

-- 065 already enforces UNIQUE(evaluation_id, criterion_id). That constraint no longer covers
-- per-RFP rows (criterion_id NULL, and NULLs are distinct in a unique constraint), so the
-- per-RFP half needs its own partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS bid_evaluation_scores_one_per_rfp_criterion
  ON bid_evaluation_scores (evaluation_id, rfp_criterion_key)
  WHERE rfp_criterion_key IS NOT NULL;

-- No RLS changes. bid_evaluation_scores' existing policy reaches through bid_evaluations.agency_id
-- (migration 065) and is unaffected by which column identifies the criterion.
--
-- Cross-surface note, implemented in application code, recorded here so the reasoning survives:
-- bid_evaluations.composite_score is still written for per-RFP evaluations, so the vendor
-- reliability index and the composite bid-to-delivery delta keep computing unchanged - a
-- weighted mean on a 0-100 scale is comparable regardless of which rubric produced it. The
-- PER-CRITERION bid-to-delivery delta (lib/delivery-review.ts) matches on criterion_id and will
-- find nothing for a per-RFP-scored bid; it renders an honest "scored against this RFP's own
-- criteria, no shared criterion to compare" statement rather than an empty table, which would
-- read as delivery matching the bid exactly.

-- Verification (run manually after applying; not part of the migration):
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'bid_evaluation_scores'
--   AND column_name IN ('criterion_id', 'rfp_criterion_key', 'criterion_name_snapshot')
-- ORDER BY column_name;
-- -- Expected: 3 rows. criterion_id is_nullable = YES (was NO). rfp_criterion_key text YES.
-- --           criterion_name_snapshot text YES.
--
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name = 'rfp_magic_tokens' AND column_name = 'evaluation_criteria';
-- -- Expected: one row, jsonb, YES
--
-- SELECT conname FROM pg_constraint WHERE conname = 'bid_evaluation_scores_exactly_one_criterion';
-- -- Expected: one row
--
-- SELECT indexname FROM pg_indexes WHERE indexname = 'bid_evaluation_scores_one_per_rfp_criterion';
-- -- Expected: one row
--
-- SELECT count(*) AS legacy_rows_intact FROM bid_evaluation_scores WHERE criterion_id IS NOT NULL;
-- SELECT count(*) AS per_rfp_rows FROM bid_evaluation_scores WHERE rfp_criterion_key IS NOT NULL;
-- -- Expected: legacy_rows_intact = the same count as before applying (nothing was rewritten);
-- --           per_rfp_rows = 0 until Phase 2 code scores its first bid against an RFP rubric
--
-- SELECT count(*) FROM partner_rfp_inbox WHERE master_rfp_json ? 'evaluation_criteria';
-- -- Expected: 0
