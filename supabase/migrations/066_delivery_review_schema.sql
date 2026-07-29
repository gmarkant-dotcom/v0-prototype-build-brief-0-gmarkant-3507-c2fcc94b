-- Delivery Performance (Bid Management Phase 3): post-project evaluation against the
-- same scoring criteria used at bid time, plus a cached AI reliability summary on
-- partnerships. response_id (not evaluation_id) links back to the original bid, since
-- some awarded bids are never formally scored - the bid_evaluations join is resolved
-- at read time via response_id, not stored redundantly here. RLS matches 065's pattern:
-- delivery_reviews is agency_id = auth.uid() directly; delivery_review_scores has no
-- agency_id column, so it reaches through an EXISTS subquery against
-- delivery_reviews.agency_id, same as bid_evaluation_scores does for bid_evaluations.
--
-- Also grants partners read access to their own COMPLETE reviews only (Delivery &
-- Projects "Performance Scores" section, app/partner/projects/page.tsx) - reached
-- through partnerships.partner_id since delivery_reviews has no partner_id column of
-- its own. Drafts/in-progress reviews stay invisible to partners at the RLS level, not
-- just hidden by the UI - the app layer additionally never selects or renders
-- on_time_notes/on_budget_notes/client_feedback/ai_delta_summary for partners, only the
-- structured scores (composite_score, on_time, on_budget, overall_satisfaction).

CREATE TABLE IF NOT EXISTS delivery_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL,
  assignment_id uuid REFERENCES project_assignments(id),
  response_id uuid REFERENCES partner_rfp_responses(id),
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'complete')),
  composite_score numeric(4,1),
  on_time text CHECK (on_time IN ('yes', 'no', 'partial')),
  on_time_notes text,
  on_budget text CHECK (on_budget IN ('yes', 'no', 'over', 'under')),
  budget_variance_pct numeric(5,2),
  on_budget_notes text,
  would_work_again text CHECK (would_work_again IN ('yes', 'likely', 'unlikely', 'no')),
  overall_satisfaction numeric(3,1),
  client_feedback text,
  ai_delta_summary text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id, partnership_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_reviews_agency ON delivery_reviews(agency_id);
CREATE INDEX IF NOT EXISTS idx_delivery_reviews_project ON delivery_reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_reviews_partnership ON delivery_reviews(partnership_id);
CREATE INDEX IF NOT EXISTS idx_delivery_reviews_response ON delivery_reviews(response_id);

CREATE TABLE IF NOT EXISTS delivery_review_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES delivery_reviews(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES bid_scoring_criteria(id),
  weight numeric(3,1) DEFAULT 1.0,
  score numeric(3,1),
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(review_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_review_scores_review ON delivery_review_scores(review_id);

ALTER TABLE partnerships ADD COLUMN IF NOT EXISTS reliability_summary text;
ALTER TABLE partnerships ADD COLUMN IF NOT EXISTS reliability_summary_generated_at timestamptz;

ALTER TABLE delivery_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencies manage own delivery reviews"
  ON delivery_reviews
  FOR ALL
  TO authenticated
  USING (agency_id = auth.uid())
  WITH CHECK (agency_id = auth.uid());

CREATE POLICY "Partners view own complete delivery reviews"
  ON delivery_reviews
  FOR SELECT
  TO authenticated
  USING (
    status = 'complete'
    AND EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.id = delivery_reviews.partnership_id
        AND p.partner_id = auth.uid()
    )
  );

ALTER TABLE delivery_review_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencies manage own delivery review scores"
  ON delivery_review_scores
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM delivery_reviews r
      WHERE r.id = delivery_review_scores.review_id
        AND r.agency_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM delivery_reviews r
      WHERE r.id = delivery_review_scores.review_id
        AND r.agency_id = auth.uid()
    )
  );
