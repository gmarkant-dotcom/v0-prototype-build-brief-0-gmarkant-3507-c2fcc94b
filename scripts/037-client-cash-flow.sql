CREATE TABLE IF NOT EXISTS public.client_cash_flow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  expected_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected', 'received')),
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_cash_flow_project ON public.client_cash_flow(project_id);
CREATE INDEX IF NOT EXISTS idx_client_cash_flow_agency ON public.client_cash_flow(agency_id);
CREATE INDEX IF NOT EXISTS idx_client_cash_flow_expected_date ON public.client_cash_flow(expected_date);

ALTER TABLE public.client_cash_flow ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agencies manage own client cash flow" ON public.client_cash_flow;
CREATE POLICY "Agencies manage own client cash flow"
  ON public.client_cash_flow
  FOR ALL
  TO authenticated
  USING (agency_id = auth.uid())
  WITH CHECK (agency_id = auth.uid());
