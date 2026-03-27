-- Create partner_access_requests table
-- Tracks requests from partners to join lead agency networks

CREATE TABLE IF NOT EXISTS public.partner_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  request_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(partner_id, agency_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_access_requests_partner_id ON public.partner_access_requests(partner_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_agency_id ON public.partner_access_requests(agency_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON public.partner_access_requests(status);

-- Enable RLS
ALTER TABLE public.partner_access_requests ENABLE ROW LEVEL SECURITY;

-- Partners can see their own requests
CREATE POLICY "Partners can view their requests"
  ON public.partner_access_requests
  FOR SELECT
  TO authenticated
  USING (partner_id = auth.uid());

-- Partners can create requests
CREATE POLICY "Partners can create requests"
  ON public.partner_access_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (partner_id = auth.uid());

-- Agencies can see requests sent to them
CREATE POLICY "Agencies can view requests to them"
  ON public.partner_access_requests
  FOR SELECT
  TO authenticated
  USING (agency_id = auth.uid());

-- Agencies can update requests (approve/decline)
CREATE POLICY "Agencies can update requests to them"
  ON public.partner_access_requests
  FOR UPDATE
  TO authenticated
  USING (agency_id = auth.uid());
