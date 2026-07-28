-- Bid Management rebuild Phase 1: AI summaries on partner_rfp_responses, plus
-- bid_decompositions (per-bid cost breakdown) and bid_comparisons (cached
-- multi-bid comparison narratives, keyed by a hash of the response set).
-- RLS pattern matches client_cash_flow (scripts/037-client-cash-flow.sql):
-- a single FOR ALL policy scoped to agency_id = auth.uid(), since both new
-- tables are agency-owned analysis artifacts with no partner-facing read path.

ALTER TABLE partner_rfp_responses ADD COLUMN IF NOT EXISTS ai_summary_short text;
ALTER TABLE partner_rfp_responses ADD COLUMN IF NOT EXISTS ai_summary_detailed text;
ALTER TABLE partner_rfp_responses ADD COLUMN IF NOT EXISTS ai_summary_generated_at timestamptz;

CREATE TABLE IF NOT EXISTS bid_decompositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES partner_rfp_responses(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL,
  scope_type text,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  narrative_summary text,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(response_id)
);

CREATE INDEX IF NOT EXISTS idx_bid_decompositions_agency ON bid_decompositions(agency_id);

CREATE TABLE IF NOT EXISTS bid_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL,
  response_ids_hash text NOT NULL,
  response_ids jsonb NOT NULL,
  scope_description text,
  narrative text NOT NULL,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(agency_id, response_ids_hash)
);

CREATE INDEX IF NOT EXISTS idx_bid_comparisons_agency ON bid_comparisons(agency_id);

ALTER TABLE bid_decompositions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencies manage own bid decompositions"
  ON bid_decompositions
  FOR ALL
  TO authenticated
  USING (agency_id = auth.uid())
  WITH CHECK (agency_id = auth.uid());

ALTER TABLE bid_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencies manage own bid comparisons"
  ON bid_comparisons
  FOR ALL
  TO authenticated
  USING (agency_id = auth.uid())
  WITH CHECK (agency_id = auth.uid());
