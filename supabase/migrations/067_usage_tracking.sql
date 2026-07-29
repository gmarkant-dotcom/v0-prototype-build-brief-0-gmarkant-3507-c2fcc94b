CREATE TABLE usage_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month_start date NOT NULL,
  ai_analyses_count integer NOT NULL DEFAULT 0,
  plan_tier text NOT NULL DEFAULT 'starter',
  analyses_limit integer NOT NULL DEFAULT 50,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (agency_id, month_start)
);

-- Active-projects count is derived live from the projects table (status not in
-- ('completed', 'archived')), not stored here - it can change independent of any
-- AI-analysis event and storing it would just be a second, driftable source of truth.

CREATE INDEX idx_usage_tracking_agency_id ON usage_tracking(agency_id);

ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agencies manage own usage tracking"
  ON usage_tracking
  FOR ALL
  TO authenticated
  USING (agency_id = auth.uid())
  WITH CHECK (agency_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON usage_tracking TO authenticated;
