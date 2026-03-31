-- Ensure partner/agency RLS policies on response versions are correct
ALTER TABLE public.partner_rfp_response_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partners read own response versions" ON public.partner_rfp_response_versions;
CREATE POLICY "Partners read own response versions"
ON public.partner_rfp_response_versions
FOR SELECT
TO authenticated
USING (partner_id = auth.uid());

DROP POLICY IF EXISTS "Partners insert own response versions" ON public.partner_rfp_response_versions;
CREATE POLICY "Partners insert own response versions"
ON public.partner_rfp_response_versions
FOR INSERT
TO authenticated
WITH CHECK (partner_id = auth.uid());

DROP POLICY IF EXISTS "Agencies read owned response versions" ON public.partner_rfp_response_versions;
CREATE POLICY "Agencies read owned response versions"
ON public.partner_rfp_response_versions
FOR SELECT
TO authenticated
USING (agency_id = auth.uid());
