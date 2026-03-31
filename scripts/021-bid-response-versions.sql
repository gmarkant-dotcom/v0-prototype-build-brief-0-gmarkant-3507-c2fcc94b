-- Track submission versions for partner bid responses

CREATE TABLE IF NOT EXISTS public.partner_rfp_response_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES public.partner_rfp_responses(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL,
  agency_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  proposal_text TEXT,
  budget_proposal TEXT,
  timeline_proposal TEXT,
  attachments JSONB,
  status_at_submission TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_rfp_response_versions_response_version_idx
  ON public.partner_rfp_response_versions(response_id, version_number);

ALTER TABLE public.partner_rfp_response_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners insert own response versions" ON public.partner_rfp_response_versions;
CREATE POLICY "Partners insert own response versions"
ON public.partner_rfp_response_versions
FOR INSERT
TO authenticated
WITH CHECK (partner_id = auth.uid());

DROP POLICY IF EXISTS "Partners read own response versions" ON public.partner_rfp_response_versions;
CREATE POLICY "Partners read own response versions"
ON public.partner_rfp_response_versions
FOR SELECT
TO authenticated
USING (partner_id = auth.uid());

DROP POLICY IF EXISTS "Agencies read owned response versions" ON public.partner_rfp_response_versions;
CREATE POLICY "Agencies read owned response versions"
ON public.partner_rfp_response_versions
FOR SELECT
TO authenticated
USING (agency_id = auth.uid());
