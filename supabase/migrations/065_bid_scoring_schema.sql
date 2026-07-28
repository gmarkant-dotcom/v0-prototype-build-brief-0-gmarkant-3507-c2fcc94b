-- Bid Management Phase 2: scoring framework. Criteria are agency-owned and reusable
-- across evaluations; bid_evaluations/bid_evaluation_scores capture one evaluation per
-- bid with per-criterion AI and human scores. RLS matches Phase 1 (064) exactly - a
-- single FOR ALL policy per table scoped to agency_id = auth.uid().

CREATE TABLE IF NOT EXISTS bid_scoring_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  category text,
  default_weight numeric(3,1) DEFAULT 1.0,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agency_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bid_scoring_criteria_agency ON bid_scoring_criteria(agency_id);

CREATE TABLE IF NOT EXISTS bid_scoring_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  criteria_weights jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(agency_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bid_scoring_templates_agency ON bid_scoring_templates(agency_id);

CREATE TABLE IF NOT EXISTS bid_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES partner_rfp_responses(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL,
  template_id uuid REFERENCES bid_scoring_templates(id),
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'complete')),
  composite_score numeric(4,1),
  ai_recommendation text,
  ranked_recommendation text,
  ranked_recommendation_group text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(response_id)
);

CREATE INDEX IF NOT EXISTS idx_bid_evaluations_agency ON bid_evaluations(agency_id);

CREATE TABLE IF NOT EXISTS bid_evaluation_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES bid_evaluations(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES bid_scoring_criteria(id),
  weight numeric(3,1) DEFAULT 1.0,
  ai_score numeric(3,1),
  ai_rationale text,
  human_score numeric(3,1),
  human_notes text,
  is_overridden boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(evaluation_id, criterion_id)
);

-- bid_evaluation_scores has no agency_id column (scoped transitively via bid_evaluations),
-- so RLS below reaches through that join instead of a direct agency_id index/policy.
CREATE INDEX IF NOT EXISTS idx_bid_evaluation_scores_evaluation ON bid_evaluation_scores(evaluation_id);

ALTER TABLE partner_rfp_responses ADD COLUMN IF NOT EXISTS composite_score numeric(4,1);

ALTER TABLE bid_scoring_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencies manage own scoring criteria"
  ON bid_scoring_criteria
  FOR ALL
  TO authenticated
  USING (agency_id = auth.uid())
  WITH CHECK (agency_id = auth.uid());

ALTER TABLE bid_scoring_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencies manage own scoring templates"
  ON bid_scoring_templates
  FOR ALL
  TO authenticated
  USING (agency_id = auth.uid())
  WITH CHECK (agency_id = auth.uid());

ALTER TABLE bid_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencies manage own bid evaluations"
  ON bid_evaluations
  FOR ALL
  TO authenticated
  USING (agency_id = auth.uid())
  WITH CHECK (agency_id = auth.uid());

ALTER TABLE bid_evaluation_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencies manage own bid evaluation scores"
  ON bid_evaluation_scores
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bid_evaluations e
      WHERE e.id = bid_evaluation_scores.evaluation_id
        AND e.agency_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bid_evaluations e
      WHERE e.id = bid_evaluation_scores.evaluation_id
        AND e.agency_id = auth.uid()
    )
  );
