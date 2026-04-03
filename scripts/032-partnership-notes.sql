-- Private lead-agency notes on partnerships (JSON). Partners must not receive this field in client APIs.

ALTER TABLE public.partnerships
  ADD COLUMN IF NOT EXISTS partnership_notes JSONB;

-- Allow agencies to read partner profiles for partners they have a relationship with (pool profile, assignments, etc.)
DROP POLICY IF EXISTS "Agencies read partner profiles for their partnerships" ON public.profiles;
CREATE POLICY "Agencies read partner profiles for their partnerships"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.agency_id = auth.uid() AND p.partner_id = profiles.id
    )
  );
